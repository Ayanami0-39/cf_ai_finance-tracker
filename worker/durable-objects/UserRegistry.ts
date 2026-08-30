import { DurableObject } from "cloudflare:workers";

/**
 * UserRegistry DO：账号注册表（单例 DO）
 * - 用户名 + 密码哈希（SHA-256 加盐）注册/验证
 * - 服务端保存用户资料（昵称/头像）与数据作用域（scopeId = user_{username小写}）
 * - 任意设备用同一用户名+密码登录 → 同名同头像同数据
 */

export interface AccountRecord {
  username: string; // 原始用户名（保留大小写展示）
  passHash: string; // SHA-256(usernameLower + ':' + password)
  displayName: string; // 昵称（可修改）
  emoji: string; // 头像 emoji
  scopeId: string; // 数据作用域 user_{usernameLower}
  createdAt: number;
}

export class UserRegistry extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async accounts(): Promise<Record<string, AccountRecord>> {
    return (
      (await this.ctx.storage.get<Record<string, AccountRecord>>('accounts')) || {}
    );
  }

  private async saveAccounts(map: Record<string, AccountRecord>): Promise<void> {
    await this.ctx.storage.put('accounts', map);
  }

  async register(
    username: string,
    password: string
  ): Promise<{ ok: boolean; error?: string; account?: AccountRecord }> {
    const key = username.trim().toLowerCase();
    if (!key || key.length > 24) return { ok: false, error: '用户名需为 1-24 个字符' };
    if (!password || password.length < 4)
      return { ok: false, error: '密码至少 4 位' };
    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim()))
      return { ok: false, error: '用户名仅支持字母/数字/下划线/中划线' };

    const map = await this.accounts();
    if (map[key]) return { ok: false, error: '用户名已被占用' };

    const account: AccountRecord = {
      username: username.trim(),
      passHash: await sha256Hex(`${key}:${password}`),
      displayName: username.trim(),
      emoji: '🙂',
      scopeId: `user_${key}`,
      createdAt: Date.now(),
    };
    map[key] = account;
    await this.saveAccounts(map);
    return { ok: true, account };
  }

  async verify(
    username: string,
    password: string
  ): Promise<{ ok: boolean; error?: string; account?: AccountRecord }> {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: '用户不存在' };
    const hash = await sha256Hex(`${key}:${password}`);
    if (hash !== account.passHash) return { ok: false, error: '密码不正确' };
    return { ok: true, account };
  }

  async getProfile(username: string): Promise<AccountRecord | null> {
    const key = username.trim().toLowerCase();
    return (await this.accounts())[key] || null;
  }

  async updateProfile(
    username: string,
    patch: { displayName?: string; emoji?: string }
  ): Promise<{ ok: boolean; error?: string; account?: AccountRecord }> {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: '用户不存在' };
    if (patch.displayName !== undefined) {
      const name = patch.displayName.trim();
      if (!name || name.length > 12)
        return { ok: false, error: '昵称需为 1-12 个字符' };
      account.displayName = name;
    }
    if (patch.emoji !== undefined) account.emoji = patch.emoji;
    map[key] = account;
    await this.saveAccounts(map);
    return { ok: true, account };
  }

  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string
  ): Promise<{ ok: boolean; error?: string }> {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: '用户不存在' };
    if (await sha256Hex(`${key}:${oldPassword}`) !== account.passHash)
      return { ok: false, error: '旧密码不正确' };
    if (!newPassword || newPassword.length < 4)
      return { ok: false, error: '新密码至少 4 位' };
    account.passHash = await sha256Hex(`${key}:${newPassword}`);
    map[key] = account;
    await this.saveAccounts(map);
    return { ok: true };
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
