import type { VoiceCommandResponse, ExpenseResponse, ChatResponse, Message } from '@/types';

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

  // ---- Family ----

  async createFamily(payload: {
    userId: string;
    members: Array<{ id: string; name: string; emoji: string }>;
    expenses?: unknown[];
    chatMessages?: unknown[];
  }): Promise<{
    success: boolean;
    code?: string;
    scopeId?: string;
    importedExpenses?: number;
    importedChat?: number;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async joinFamily(payload: {
    code: string;
    members: Array<{ id: string; name: string; emoji: string }>;
    expenses?: unknown[];
    chatMessages?: unknown[];
  }): Promise<{
    success: boolean;
    code?: string;
    scopeId?: string;
    importedExpenses?: number;
    importedChat?: number;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async getFamilyMembers(scopeId: string): Promise<{
    success: boolean;
    members: Array<{ id: string; name: string; emoji: string }>;
    ownerId?: string | null;
  }> {
    const response = await fetch(`${API_BASE}/family/${scopeId}/members`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to fetch family members');
    }
    return response.json();
  },

  async removeFamilyMember(
    scopeId: string,
    memberId: string,
    operatorId: string
  ): Promise<{
    success: boolean;
    members?: Array<{ id: string; name: string; emoji: string }>;
    error?: string;
  }> {
    const response = await fetch(`${API_BASE}/family/${scopeId}/members/${memberId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ operatorId }),
    });
    return response.json();
  },

  async mergeIdentity(
    sourceScopeId: string,
    targetScopeId: string
  ): Promise<{ success: boolean; importedExpenses?: number; importedChat?: number }> {
    const response = await fetch(`${API_BASE}/identity/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ sourceScopeId, targetScopeId }),
    });
    return response.json();
  },

  async syncMemberProfile(
    scopeId: string,
    member: { id: string; name: string; emoji: string }
  ): Promise<{
    success: boolean;
    members?: Array<{ id: string; name: string; emoji: string }>;
  }> {
    const response = await fetch(`${API_BASE}/family/${scopeId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(member),
    });
    return response.json();
  },
};
