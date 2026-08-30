import type { VoiceCommandResponse, ExpenseResponse, ChatResponse, Message } from '@/types';
import { accountHeaders } from '@/lib/account';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem('auth_token');
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // localStorage 不可用时仅依赖 Cookie
  }
  return {};
}

export const api = {
  async sendVoiceCommand(
    payload: {
      userId: string;
      input: string;
      memberName?: string;
      memberId?: string;
    }
  ): Promise<VoiceCommandResponse> {
    const response = await fetch(`${API_BASE}/voice-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to process command');
    }

    return response.json();
  },

  async getExpenses(userId: string): Promise<ExpenseResponse> {
    const response = await fetch(`${API_BASE}/expenses/${userId}`, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch expenses');
    }

    return response.json();
  },

  async addExpense(
    payload: {
      userId: string;
      input: string;
      memberName?: string;
      memberId?: string;
    }
  ): Promise<VoiceCommandResponse> {
    const response = await fetch(`${API_BASE}/expense-natural`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error('Failed to add expense');
    }

    return response.json();
  },

  async clearExpenses(userId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/expenses/${userId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to clear expenses');
    }
  },

  async deleteExpense(userId: string, expenseId: string): Promise<void> {
    const response = await fetch(
      `${API_BASE}/expenses/${userId}/${expenseId}`,
      { method: 'DELETE', headers: authHeaders() }
    );

    if (!response.ok) {
      throw new Error('Failed to delete expense');
    }
  },

  async getChatHistory(userId: string): Promise<ChatResponse> {
    const response = await fetch(`${API_BASE}/chat/${userId}`, {
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch chat history');
    }

    return response.json();
  },

  async saveChatMessage(userId: string, message: Message): Promise<void> {
    const response = await fetch(`${API_BASE}/chat/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error('Failed to save chat message');
    }
  },

  async clearChatHistory(userId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/chat/${userId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error('Failed to clear chat history');
    }
  },

  async mergeIdentity(
    sourceScopeId: string,
    targetScopeId: string
  ): Promise<{ success: boolean; importedExpenses?: number; importedChat?: number }> {
    const response = await fetch(`${API_BASE}/identity/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify({ sourceScopeId, targetScopeId }),
    });
    return response.json();
  },

  // ---- Family（账号制） ----

  async createFamily(): Promise<{
    success: boolean;
    family?: { code: string; scopeId: string; isOwner: boolean };
    importedExpenses?: number;
    importedChat?: number;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify({ mergePersonalData: true }),
    });
    return response.json();
  },

  async joinFamily(code: string): Promise<{
    success: boolean;
    family?: { code: string; scopeId: string; isOwner: boolean };
    importedExpenses?: number;
    importedChat?: number;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify({ code, mergePersonalData: true }),
    });
    return response.json();
  },

  async getMyFamily(): Promise<{
    success: boolean;
    family: { code: string; scopeId: string; isOwner: boolean } | null;
    members: Array<{ username: string; displayName: string; emoji: string; isOwner: boolean }>;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/mine`, {
      headers: accountHeaders(),
    });
    return response.json();
  },

  async removeFamilyMember(
    username: string
  ): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(
      `${API_BASE}/family/members/${encodeURIComponent(username)}`,
      { method: 'DELETE', headers: accountHeaders() }
    );
    return response.json();
  },

  async leaveFamily(): Promise<{
    success: boolean;
    dissolved?: boolean;
    newOwner?: string | null;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify({}),
    });
    return response.json();
  },

  async regenerateFamilyCode(): Promise<{
    success: boolean;
    family?: { code: string; scopeId: string; isOwner: boolean };
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/regenerate-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify({}),
    });
    return response.json();
  },
};
