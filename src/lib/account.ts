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

// 模块级资料缓存（公开信息，页面会话内有效）：
// - 成功资料缓存，避免 N 条消息/记录重复请求同一账号
// - 404（账号不存在，如旧本地成员昵称「coco 爸」）负缓存为 null，不再反复请求刷屏
// - 网络错误 / 5xx 不缓存，保留下次重试机会
const profileCache = new Map<string, { displayName: string; emoji: string } | null>();
const profileInflight = new Map<string, Promise<{ displayName: string; emoji: string } | null>>();

async function fetchProfile(username: string): Promise<{ displayName: string; emoji: string } | null> {
  const cached = profileCache.get(username);
  if (cached !== undefined) return cached;

  const inflight = profileInflight.get(username);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const res = await fetch(`/api/account/profile/${encodeURIComponent(username)}`, {
        headers: accountHeaders(),
      });
      if (res.status === 404) {
        profileCache.set(username, null); // 账号不存在 → 负缓存，停止重试
        return null;
      }
      if (!res.ok) return null; // 5xx 等临时错误不缓存
      const data = await res.json();
      const profile = (data?.profile ?? null) as { displayName: string; emoji: string } | null;
      if (profile) profileCache.set(username, profile);
      return profile;
    } catch {
      return null; // 网络异常不缓存
    } finally {
      profileInflight.delete(username);
    }
  })();
  profileInflight.set(username, task);
  return task;
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

  /** 批量查询他人资料（账单/聊天展示用）：带缓存 + 去重，404 负缓存不再重试 */
  async getProfiles(usernames: string[]): Promise<Record<string, { displayName: string; emoji: string }>> {
    const results = await Promise.all(
      usernames.map(async (u) => [u, await fetchProfile(u)] as const)
    );
    const map: Record<string, { displayName: string; emoji: string }> = {};
    for (const [u, p] of results) if (p) map[u] = p;
    return map;
  },
};
