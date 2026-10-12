import { FinanceMemory as LiveFinanceMemory, d1GetExpenses, d1UpdateExpense, d1SoftDeleteExpense,
  executeVoiceCommand, d1ClearExpenses, d1ImportExpenses, d1AddExpense, writeDoStorageBackup, readDoStorageBackup } from '../recovered/live-backend.mjs';
import { financeAI } from '../ai/provider';
import type { Expense } from '../types/expense';
import type { ChatMessage } from '../types/chat';
import { d1GetChat, d1AddChat, d1ImportChat, d1ClearChat } from '../db/chat';
import { migrationComplete, migrateFinanceScope, readLegacyStorage, archiveLegacyObject, verifyLegacyArchive } from '../db/legacy-migration';

/** Keep production WebSockets and recurring alarms; all active business records use D1. */
export class FinanceMemory extends LiveFinanceMemory {
  private scopeCache?: string;
  private commandFlights = new Map<string, {input:unknown;promise:Promise<{status:number;body:Record<string,unknown>}>}>();

  private async currentCommandResult(result:{status:number;body:Record<string,unknown>},scope:string):Promise<{status:number;body:Record<string,unknown>}> {
    const original=(result.body.data as {expense?:Expense}|undefined)?.expense;
    if(!original)return result;
    const expense=(await d1GetExpenses(this.env.DB,scope)).find(entry=>entry.id===original.id);
    return {status:result.status,body:{...result.body,message:expense?'This entry is already saved. No duplicate was added.':'This entry was removed. Resending did not restore it.',data:expense?{expense}:undefined}};
  }

  /** Durable receipts prevent a resend from repeating any financial action. */
  async runChatCommand(body: Record<string, unknown>, headers: Record<string,string>, username: string): Promise<{status:number;body:Record<string,unknown>}> {
    this.assertAvailable();
    const scope=await this.scope();
    if (body.userId !== scope || typeof body.commandId !== 'string') throw new Error('Invalid command scope');
    const key='chat-command:'+JSON.stringify([username,body.commandId]);
    const flight=this.commandFlights.get(key);
    if (flight) {
      if(flight.input!==body.input)return {status:409,body:{success:false,message:'Message content changed; resend refused.'}};
      const result=await flight.promise;
      if (!(body.resend && (result.body.commandKind === 'QUERY' || result.body.safeToRetry === true))) return this.currentCommandResult(result,scope);
    }
    const run=(async()=>{
      const cached=await this.metadata<{input:string;state:string;result?:{status:number;body:Record<string,unknown>}}|null>(key,null);
      if (cached && cached.input !== body.input) return {status:409,body:{success:false,message:'Message content changed; resend refused.'}};
      if(cached?.result&&cached.result.status>=500){const expense=(await d1GetExpenses(this.env.DB,scope)).find(entry=>entry.idempotencyKey===body.commandId);if(expense){const result={status:200,body:{success:true,commandKind:'ADD_EXPENSE',message:'This entry is already saved. No duplicate was added.',data:{expense}}};await this.setMetadata(key,{input:body.input,state:'done',result});return result;}return {status:200,body:{success:true,needsReview:true,message:'The previous request could not be verified. Check Activity before adding another entry.'}};}
      if (cached?.result && !(body.resend && (cached.result.body.commandKind === 'QUERY' || cached.result.body.safeToRetry === true))) return this.currentCommandResult(cached.result,scope);
      if(!cached){const attempt=await this.metadata<{username?:string;legacyReceipt?:Record<string,unknown>}|null>('chat-attempt:'+body.commandId,null);if(attempt?.username===username&&attempt.legacyReceipt){const result={status:200,body:attempt.legacyReceipt};await this.setMetadata(key,{input:body.input,state:'done',result});return this.currentCommandResult(result,scope);}}
      if (cached?.state === 'running') {
        const expense=(await d1GetExpenses(this.env.DB,scope)).find(entry=>entry.idempotencyKey===body.commandId);
        if(expense){const result={status:200,body:{success:true,commandKind:'ADD_EXPENSE',message:'This entry is already saved. No duplicate was added.',parsedBy:expense.parsedBy,data:{expense}}};await this.setMetadata(key,{input:body.input,state:'done',result});return result;}
        return {status:200,body:{success:true,needsReview:true,message:'The previous request may have been interrupted. Check Activity before adding another entry.'}};
      }
      await this.setMetadata(key,{input:body.input,state:'running'});
      const resultRequest=new Request('https://internal.invalid/command',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...body,idempotencyKey:body.commandId,readOnlyResend:Boolean(body.readOnlyResend || (body.resend && cached?.result?.body.commandKind === 'QUERY'))})});
      let result;
      try {
        const response=await executeVoiceCommand(resultRequest,{...this.env,AI:financeAI(this.env)});
        result={status:response.status,body:await response.json() as Record<string,unknown>};
      } catch {result={status:503,body:{success:false,message:'Unable to finish the request. Check your records before resending.'}};}
      await this.setMetadata(key,{input:body.input,state:'done',result});
      return result;
    })();
    const entry={input:body.input,promise:run};
    this.commandFlights.set(key,entry);
    try {return await run;} finally {if(this.commandFlights.get(key) === entry)this.commandFlights.delete(key);}
  }


  private assertAvailable(): void {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
  }

  async bindScope(scope: string): Promise<void> {
    if (this.scopeCache && this.scopeCache !== scope) throw new Error('Scope identity mismatch');
    this.scopeCache = scope;
    if (this.env.APP_STORAGE_MODE === 'd1') await this.migrateToD1(scope);
  }

  override extractScope(): string {
    return this.scopeCache || this.ctx.id.name || 'default';
  }

  private async scope(): Promise<string> {
    if (this.scopeCache) return this.scopeCache;
    const row = await this.env.DB.prepare('SELECT scope FROM app_legacy_objects WHERE object_id = ?')
      .bind(this.ctx.id.toString()).first<{ scope: string | null }>();
    const scope = row?.scope || this.ctx.id.name;
    if (!scope) throw new Error('Scope identity is unknown; refusing to read/write a default scope');
    this.scopeCache = scope;
    return scope;
  }

  async migrateToD1(scope: string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const objectId = this.ctx.id.toString();
      const mapping = await this.env.DB.prepare('SELECT scope FROM app_legacy_objects WHERE object_id = ?')
        .bind(objectId).first<{ scope: string | null }>();
      if (mapping?.scope && mapping.scope !== scope) throw new Error('Scope identity mismatch');
      if (!await migrationComplete(this.env.DB, `finance-v1:${objectId}`)) {
        await migrateFinanceScope(this.env.DB, objectId, scope, await readLegacyStorage(this.ctx.storage));
      }
      this.scopeCache = scope;
    });
  }

  async verifyArchive(): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(() =>
      verifyLegacyArchive(this.env.DB, this.ctx.id.toString(), this.ctx.storage));
  }

  async archiveToD1(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const objectId = this.ctx.id.toString();
      if (await migrationComplete(this.env.DB, `archive-v1:${objectId}`)) return;
      await archiveLegacyObject(this.env.DB, objectId, await readLegacyStorage(this.ctx.storage));
    });
  }

  override async scheduleNextAlarm(): Promise<void> {
    if (this.env.APP_STORAGE_MODE === 'legacy' || !this.env.APP_STORAGE_MODE) return super.scheduleNextAlarm();
    // Operational alarm state stays with Cloudflare; never update legacy business keys.
    await this.ctx.storage.setAlarm(this.getNextOccurrence().getTime());
  }

  override async alarm(): Promise<void> {
    if (this.env.APP_STORAGE_MODE === 'migration') {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      return;
    }
    if (this.env.APP_STORAGE_MODE === 'd1') await this.scope();
    await super.alarm();
  }

  override async addExpense(expense: Expense): Promise<void> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.addExpense(expense);
    await d1AddExpense(this.env.DB, await this.scope(), expense);
  }
  override async getExpenses(): Promise<Expense[]> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.getExpenses();
    return d1GetExpenses(this.env.DB, await this.scope());
  }
  override async deleteExpense(id: string): Promise<boolean> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.deleteExpense(id);
    return !!await d1SoftDeleteExpense(this.env.DB, await this.scope(), id);
  }
  override async updateExpense(id: string, patch: Partial<Expense>): Promise<Expense | null> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.updateExpense(id, patch);
    return d1UpdateExpense(this.env.DB, await this.scope(), id, patch);
  }
  override async clearExpenses(): Promise<void> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.clearExpenses();
    await d1ClearExpenses(this.env.DB, await this.scope());
  }
  override async importExpenses(expenses: Expense[]): Promise<number> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.importExpenses(expenses);
    return d1ImportExpenses(this.env.DB, await this.scope(), expenses);
  }
  override async getChatMessages(): Promise<ChatMessage[]> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.getChatMessages();
    return d1GetChat(this.env.DB, await this.scope());
  }
  override async addChatMessage(message: ChatMessage): Promise<void> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.addChatMessage(message);
    await d1AddChat(this.env.DB, await this.scope(), message);
  }
  override async importChatMessages(messages: ChatMessage[]): Promise<number> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.importChatMessages(messages);
    return d1ImportChat(this.env.DB, await this.scope(), messages);
  }
  override async clearChatMessages(): Promise<void> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.clearChatMessages();
    await d1ClearChat(this.env.DB, await this.scope());
  }

  private async metadata<T>(key: string, fallback: T): Promise<T> {
    const row = await this.env.DB.prepare('SELECT value_json FROM app_scope_metadata WHERE scope = ? AND key = ?')
      .bind(await this.scope(), key).first<{ value_json: string }>();
    return row ? JSON.parse(row.value_json) as T : fallback;
  }
  private async setMetadata(key: string, value: unknown): Promise<void> {
    await this.env.DB.prepare('INSERT INTO app_scope_metadata (scope, key, value_json) VALUES (?, ?, ?) ON CONFLICT (scope, key) DO UPDATE SET value_json = excluded.value_json')
      .bind(await this.scope(), key, JSON.stringify(value)).run();
  }
  override async getFamilyMembers() {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.getFamilyMembers();
    return this.metadata<Array<{ id: string; name: string; emoji: string }>>('familyMembers', []);
  }
  override async setFamilyMembers(members: Array<{ id: string; name: string; emoji: string }>): Promise<void> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.setFamilyMembers(members);
    await this.setMetadata('familyMembers', members);
  }
  override async getFamilyOwnerId(): Promise<string | null> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.getFamilyOwnerId();
    return this.metadata<string | null>('familyOwnerId', null);
  }
  override async setFamilyOwnerId(id: string): Promise<void> {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.setFamilyOwnerId(id);
    await this.setMetadata('familyOwnerId', id);
  }
  override async removeFamilyMember(id: string) {
    this.assertAvailable();
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.removeFamilyMember(id);
    const next = (await this.getFamilyMembers()).filter((member) => member.id !== id);
    await this.setFamilyMembers(next);
    return next;
  }
  override async dumpStorageForBackup(): Promise<Record<string, unknown>> {
    if (this.env.APP_STORAGE_MODE !== 'd1') return Object.fromEntries(await readLegacyStorage(this.ctx.storage));
    const scope = await this.scope();
    const { results } = await this.env.DB.prepare('SELECT key, value_json FROM app_scope_metadata WHERE scope = ?')
      .bind(scope).all<{ key: string; value_json: string }>();
    return { ...Object.fromEntries(results.map((row) => [row.key, JSON.parse(row.value_json)])),
      expenses: await d1GetExpenses(this.env.DB, scope), chatMessages: await d1GetChat(this.env.DB, scope) };
  }
  override async backupKeysToD1(_keys: string[]): Promise<void> {
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.backupKeysToD1(_keys);
    await writeDoStorageBackup(this.env.DB, 'FinanceMemory', await this.scope(), await this.dumpStorageForBackup());
  }
  override async restoreStorageFromBackup(opts?: { keys?: string[] }): Promise<{ restored: string[]; missing: string[] }> {
    if (this.env.APP_STORAGE_MODE !== 'd1') throw new Error('Restore requires D1 storage mode');
    const rows = await readDoStorageBackup(this.env.DB, 'FinanceMemory', await this.scope());
    const wanted = opts?.keys?.length ? new Set(opts.keys) : null;
    const restored: string[] = [];
    for (const row of rows) {
      if (wanted && !wanted.has(row.key)) continue;
      if (row.key === 'chatMessages') await this.importChatMessages(JSON.parse(row.value) as ChatMessage[]);
      // Financial records are already authoritative in D1; never revive old/deleted expenses.
      else if (row.key === 'expenses') continue;
      else if (await this.metadata(row.key, null) === null) await this.setMetadata(row.key, JSON.parse(row.value));
      restored.push(row.key);
    }
    this.broadcastChange({ type: 'sync-refresh', by: 'system' });
    return { restored, missing: wanted ? [...wanted].filter((key) => !restored.includes(key)) : [] };
  }
}
