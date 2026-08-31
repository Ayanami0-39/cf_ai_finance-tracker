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

  // 编辑交易记录（日期、金额、类型、商家、分类、描述）
  async updateExpense(
    userId: string,
    expenseId: string,
    patch: Partial<Pick<
      import('@/types').Expense,
      'amount' | 'date' | 'type' | 'merchant' | 'category' | 'description'
    >>
  ): Promise<{ success: boolean; expense?: import('@/types').Expense; error?: string }> {
    const response = await fetch(
      `${API_BASE}/expenses/${userId}/${expenseId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(patch),
      }
    );
    return response.json();
  },

  async getChatHistory(
    userId: string,
    opts?: { before?: number; limit?: number }
  ): Promise<ChatResponse> {
    const params = new URLSearchParams();
    if (opts?.before != null) params.set('before', String(opts.before));
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const response = await fetch(`${API_BASE}/chat/${userId}${qs ? `?${qs}` : ''}`, {
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

  // AI 月报：按月（可选按成员）生成自然语言消费总结
  async getMonthlyReport(
    userId: string,
    month: string,
    member?: string
  ): Promise<{ success: boolean; report?: string; error?: string }> {
    const response = await fetch(`${API_BASE}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ userId, month, member: member || 'all' }),
    });
    return response.json();
  },
};

// ---- CSV 导出：客户端生成，无需后端 ----

/** 把账单列表导出为 CSV 并触发下载（BOM 头保证 Excel 中文不乱码） */
export function exportExpensesToCsv(expenses: import('@/types').Expense[]): void {
  const header = ['日期', '类型', '分类', '商家', '描述', '金额', '记录人', '来源'];
  const escape = (v: string | number | undefined) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [...expenses]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) =>
      [
        e.date,
        e.type === 'income' ? '收入' : '支出',
        e.category,
        e.merchant || '',
        e.description || '',
        e.amount.toFixed(2),
        e.by || '',
        e.parsedBy === 'fallback' ? '规则' : e.parsedBy === 'ai' ? 'AI' : '',
      ]
        .map(escape)
        .join(',')
    );

  const csv = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `账单导出_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
