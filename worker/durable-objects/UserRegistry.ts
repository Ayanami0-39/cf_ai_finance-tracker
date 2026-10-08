import { UserRegistry as LiveUserRegistry, writeDoStorageBackup, readDoStorageBackup } from '../recovered/live-backend.mjs';
import { RegistryOperations } from '../db/registry-operations';
import { D1RegistryStorage } from '../db/registry';
import { migrationComplete, migrateRegistry, readLegacyStorage, archiveLegacyObject, verifyLegacyArchive } from '../db/legacy-migration';

export type { AccountRecord, FamilyRecord } from '../db/registry-operations';

/** Compatibility coordinator only. All active account/family storage is D1.
 * Blocking interleaving keeps read-modify-write domain operations serialized;
 * D1 batch commits account/family/membership changes atomically.
 */
export class UserRegistry extends LiveUserRegistry {
  private async runD1<T>(operation: (registry: RegistryOperations) => Promise<T>): Promise<T> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!await migrationComplete(this.env.DB, 'registry-v1')) {
        await migrateRegistry(this.env.DB, this.ctx.id.toString(), await readLegacyStorage(this.ctx.storage));
      }
      const storage = new D1RegistryStorage(this.env.DB);
      await storage.load();
      const result = await operation(new RegistryOperations(storage));
      await storage.commit();
      return result;
    });
  }

  async register(...args: Parameters<RegistryOperations['register']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.register(...args);
    return this.runD1((registry) => registry.register(...args));
  }

  async verify(...args: Parameters<RegistryOperations['verify']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.verify(...args);
    return this.runD1((registry) => registry.verify(...args));
  }

  async getProfile(...args: Parameters<RegistryOperations['getProfile']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.getProfile(...args);
    return this.runD1((registry) => registry.getProfile(...args));
  }

  async updateProfile(...args: Parameters<RegistryOperations['updateProfile']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.updateProfile(...args);
    return this.runD1((registry) => registry.updateProfile(...args));
  }

  async changePassword(...args: Parameters<RegistryOperations['changePassword']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.changePassword(...args);
    return this.runD1((registry) => registry.changePassword(...args));
  }

  async createFamily(...args: Parameters<RegistryOperations['createFamily']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.createFamily(...args);
    return this.runD1((registry) => registry.createFamily(...args));
  }

  async getFamilyByCode(...args: Parameters<RegistryOperations['getFamilyByCode']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.getFamilyByCode(...args);
    return this.runD1((registry) => registry.getFamilyByCode(...args));
  }

  async joinFamily(...args: Parameters<RegistryOperations['joinFamily']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.joinFamily(...args);
    return this.runD1((registry) => registry.joinFamily(...args));
  }

  async listFamilyMembers(...args: Parameters<RegistryOperations['listFamilyMembers']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.listFamilyMembers(...args);
    return this.runD1((registry) => registry.listFamilyMembers(...args));
  }

  async removeFamilyMember(...args: Parameters<RegistryOperations['removeFamilyMember']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.removeFamilyMember(...args);
    return this.runD1((registry) => registry.removeFamilyMember(...args));
  }

  async leaveFamily(...args: Parameters<RegistryOperations['leaveFamily']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.leaveFamily(...args);
    return this.runD1((registry) => registry.leaveFamily(...args));
  }

  async regenerateFamilyCode(...args: Parameters<RegistryOperations['regenerateFamilyCode']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.regenerateFamilyCode(...args);
    return this.runD1((registry) => registry.regenerateFamilyCode(...args));
  }


  async getMemberRole(...args: Parameters<RegistryOperations['getMemberRole']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.getMemberRole(...args);
    return this.runD1((registry) => registry.getMemberRole(...args));
  }

  async setMemberRole(...args: Parameters<RegistryOperations['setMemberRole']>) {
    if (this.env.APP_STORAGE_MODE === 'migration') throw new Error('Storage migration in progress');
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.setMemberRole(...args);
    return this.runD1((registry) => registry.setMemberRole(...args));
  }

  async dumpStorageForBackup(): Promise<Record<string, unknown>> {
    if (this.env.APP_STORAGE_MODE !== 'd1') return Object.fromEntries(await readLegacyStorage(this.ctx.storage));
    return this.runD1(async () => {
      const storage = new D1RegistryStorage(this.env.DB);
      await storage.load();
      const { results } = await this.env.DB.prepare('SELECT key, value_json FROM app_legacy_snapshots WHERE object_id = ?')
        .bind(this.ctx.id.toString()).all<{ key: string; value_json: string }>();
      const snapshot = Object.fromEntries(results.map((row) => [row.key, JSON.parse(row.value_json)]));
      return { ...snapshot, accounts: await storage.get('accounts'), families: await storage.get('families'), membership: await storage.get('membership') };
    });
  }

  async listBackupScopes(): Promise<string[]> {
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.listBackupScopes();
    return this.migrationScopes();
  }

  async mirrorToD1(): Promise<void> {
    if (this.env.APP_STORAGE_MODE !== 'd1') return super.mirrorToD1();
    await writeDoStorageBackup(this.env.DB, 'UserRegistry', 'global', await this.dumpStorageForBackup());
  }

  async restoreStorageFromBackup(opts?: { keys?: string[] }): Promise<{ restored: string[]; missing: string[] }> {
    if (this.env.APP_STORAGE_MODE !== 'd1') throw new Error('Restore requires D1 storage mode');
    // Merge missing records only: a stale mirror must never overwrite current accounts/hashes.
    const rows = await readDoStorageBackup(this.env.DB, 'UserRegistry', 'global');
    const wanted = opts?.keys?.length ? new Set(opts.keys) : null;
    return this.ctx.blockConcurrencyWhile(async () => {
      const storage = new D1RegistryStorage(this.env.DB);
      await storage.load();
      const restored: string[] = [];
      for (const row of rows) {
        if (wanted && !wanted.has(row.key)) continue;
        if (!['accounts', 'families', 'membership'].includes(row.key)) continue;
        const current = await storage.get<Record<string, unknown>>(row.key) ?? {};
        const source = JSON.parse(row.value) as Record<string, unknown>;
        await storage.put(row.key, { ...source, ...current });
        restored.push(row.key);
      }
      await storage.commit();
      return { restored, missing: wanted ? [...wanted].filter((key) => !restored.includes(key)) : [] };
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

  async migrationScopes(): Promise<string[]> {
    return this.runD1(async () => {
      const results = await this.env.DB.batch<{ record_json: string }>([
        this.env.DB.prepare('SELECT record_json FROM app_user_accounts'),
        this.env.DB.prepare('SELECT record_json FROM app_families'),
      ]);
      return [...new Set(results.flatMap((result) => result.results.map((row) =>
        (JSON.parse(row.record_json) as { scopeId: string }).scopeId
      )))];
    });
  }
}
