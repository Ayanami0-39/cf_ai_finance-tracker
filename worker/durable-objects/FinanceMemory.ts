import { DurableObject } from "cloudflare:workers";
import type { Env } from '../types/env';
import type { Expense } from '../types/expense';
import type { ChatMessage } from '../types/chat';

export class FinanceMemory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  // RPC method: Add expense
  async addExpense(expense: Expense): Promise<void> {
    let expenses = await this.ctx.storage.get<Expense[]>('expenses');
    if (!expenses) {
      expenses = [];
    }

    expenses.push(expense);
    await this.ctx.storage.put('expenses', expenses);
  }

  // RPC method: Get expenses
  async getExpenses(): Promise<Expense[]> {
    let expenses = await this.ctx.storage.get<Expense[]>('expenses');
    if (!expenses) {
      expenses = [];
    }

    return expenses;
  }

  async deleteExpense(expenseId: string): Promise<boolean> {
    let expenses = await this.ctx.storage.get<Expense[]>('expenses');
    if (!expenses) {
      return false;
    }

    const initialLength = expenses.length;
    expenses = expenses.filter(e => e.id !== expenseId);

    if (expenses.length === initialLength) {
      return false;
    }

    await this.ctx.storage.put('expenses', expenses);
    return true;
  }

  // RPC method: Clear expenses
  async clearExpenses(): Promise<void> {
    await this.ctx.storage.delete('expenses');
  }

  // ---- Family registry（家庭码 → 成员列表，服务端共享） ----

  async getFamilyMembers(): Promise<Array<{ id: string; name: string; emoji: string }>> {
    return (await this.ctx.storage.get('familyMembers')) || [];
  }

  async setFamilyMembers(
    members: Array<{ id: string; name: string; emoji: string }>
  ): Promise<void> {
    await this.ctx.storage.put('familyMembers', members);
  }

  async getFamilyOwnerId(): Promise<string | null> {
    return (await this.ctx.storage.get<string>('familyOwnerId')) || null;
  }

  async setFamilyOwnerId(ownerId: string): Promise<void> {
    await this.ctx.storage.put('familyOwnerId', ownerId);
  }

  async removeFamilyMember(
    memberId: string
  ): Promise<Array<{ id: string; name: string; emoji: string }>> {
    const members =
      (await this.ctx.storage.get<
        Array<{ id: string; name: string; emoji: string }>
      >('familyMembers')) || [];
    const next = members.filter((m) => m.id !== memberId);
    if (next.length !== members.length) {
      await this.ctx.storage.put('familyMembers', next);
    }
    return next;
  }

  // ---- Bulk import（加入家庭时迁移本机历史数据） ----

  async importExpenses(list: Expense[]): Promise<number> {
    const existing = (await this.ctx.storage.get<Expense[]>('expenses')) || [];
    const seen = new Set(existing.map((e) => e.id));
    let added = 0;
    for (const e of list) {
      if (e && e.id && !seen.has(e.id)) {
        existing.push(e);
        seen.add(e.id);
        added++;
      }
    }
    if (added > 0) {
      existing.sort((a, b) => a.createdAt - b.createdAt);
      await this.ctx.storage.put('expenses', existing);
    }
    return added;
  }

  async importChatMessages(
    list: ChatMessage[]
  ): Promise<number> {
    let existing =
      (await this.ctx.storage.get<ChatMessage[]>('chatMessages')) || [];
    const seen = new Set(existing.map((m) => m.id));
    let added = 0;
    for (const m of list) {
      if (m && m.id && !seen.has(m.id)) {
        existing.push(m);
        seen.add(m.id);
        added++;
      }
    }
    if (added > 0) {
      existing.sort((a, b) => a.timestamp - b.timestamp);
      if (existing.length > 100) existing = existing.slice(-100);
      await this.ctx.storage.put('chatMessages', existing);
    }
    return added;
  }

  // RPC method: Add chat message
  async addChatMessage(message: ChatMessage): Promise<void> {
    let messages = await this.ctx.storage.get<ChatMessage[]>('chatMessages');
    if (!messages) {
      messages = [];
    }

    messages.push(message);

    // Keep only last 100 messages to prevent storage bloat
    if (messages.length > 100) {
      messages = messages.slice(-100);
    }

    await this.ctx.storage.put('chatMessages', messages);
  }

  // RPC method: Get chat messages
  async getChatMessages(): Promise<ChatMessage[]> {
    let messages = await this.ctx.storage.get<ChatMessage[]>('chatMessages');
    if (!messages) {
      messages = [];
    }

    return messages;
  }

  // RPC method: Clear chat history
  async clearChatMessages(): Promise<void> {
    await this.ctx.storage.delete('chatMessages');
  }
}
