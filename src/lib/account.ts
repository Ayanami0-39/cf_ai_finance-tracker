/**
 * 账号客户端：用户名+密码登录，资料存服务端。
 * - 会话令牌存 localStorage（account_token）
 * - scopeId 由服务端账号决定（user_{username小写}），任意设备登录同一账号数据一致
 */

export interface AccountInfo {
  username: string;
  displayName: string;
  emoji: string;
  scopeId: string;
}

const TOKEN_KEY = 'account_token';
const ACCOUNT_KEY = 'account_info';

export function getAccountToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getAccount(): AccountInfo | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as AccountInfo) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, account: AccountInfo): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // localStorage 不可用时静默
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // 静默
  }
}

export function accountHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Account ${token}` } : {};
}

export const accountApi = {
  async register(username: string, password: string) {
    const res = await fetch('/api/account/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return res.json();
  },

  async login(username: string, password: string) {
    const res = await fetch('/api/account/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return res.json();
  },

  /** 拉取当前账号资料（打开应用时刷新昵称/头像） */
  async me(): Promise<{ success: boolean; account?: AccountInfo }> {
    try {
      const res = await fetch('/api/account/me', { headers: accountHeaders() });
      if (res.status === 401) {
        clearSession(); // 会话失效（改密码等）→ 登出
        return { success: false };
      }
      return res.json();
    } catch {
      return { success: false };
    }
  },

  /** 修改昵称/头像（服务端保存，全设备生效） */
  async updateProfile(patch: {
    displayName?: string;
    emoji?: string;
  }): Promise<{ success: boolean; account?: AccountInfo; error?: string }> {
    const res = await fetch('/api/account/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...accountHeaders() },
      body: JSON.stringify(patch),
    });
    return res.json();
  },

  /** 批量查询他人资料（账单/聊天展示用） */
  async getProfiles(usernames: string[]): Promise<Record<string, { displayName: string; emoji: string }>> {
    const results = await Promise.all(
      usernames.map(async (u) => {
        try {
          const res = await fetch(`/api/account/profile/${encodeURIComponent(u)}`, {
            headers: accountHeaders(),
          });
          const data = await res.json();
          return [u, data.profile] as const;
        } catch {
          return [u, null] as const;
        }
      })
    );
    const map: Record<string, { displayName: string; emoji: string }> = {};
    for (const [u, p] of results) if (p) map[u] = p;
    return map;
  },
};
