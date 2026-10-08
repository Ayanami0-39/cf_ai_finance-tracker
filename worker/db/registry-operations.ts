import { verifyStoredPassword, hashPbkdf2Password } from './password-verification';

/**
 * UserRegistry DO：账号注册表（单例 DO）
 * - 用户名 + 密码哈希（SHA-256 加盐）注册/验证
 * - 服务端保存用户资料（昵称/头像）与数据作用域（scopeId = user_{username小写}）
 * - 任意设备用同一用户名+密码登录 → 同名同头像同数据
 */

export type MemberRole = 'admin' | 'contributor' | 'viewer';

export interface AccountRecord {
  username: string; // 原始用户名（保留大小写展示）
  passHash: string; // SHA-256(usernameLower + ':' + password)
  displayName: string; // 昵称（可修改）
  emoji: string; // 头像 emoji
  scopeId: string; // 数据作用域 user_{usernameLower}
  createdAt: number;
}

export interface FamilyRecord {
  code: string; // 6 位家庭码
  scopeId: string; // 共享数据作用域 family_{code}
  ownerId: string; // 创建者 scopeId（user_xxx）
  ownerUsername: string;
  memberRoles?: Record<string, MemberRole>;
  memberUsernames: string[]; // 小写用户名，按加入顺序
  createdAt: number;
}

export interface RegistryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/** Domain operations run against a per-request snapshot; the coordinator commits it atomically. */
export class RegistryOperations {
  private storage: RegistryStorage;

  constructor(storage: RegistryStorage) { this.storage = storage; }

  private async accounts(): Promise<Record<string, AccountRecord>> {
    return (
      (await this.storage.get<Record<string, AccountRecord>>('accounts')) || {}
    );
  }

  private async saveAccounts(map: Record<string, AccountRecord>): Promise<void> {
    await this.storage.put('accounts', map);
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
      passHash: await hashPbkdf2Password(key, password),
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
    if (!await verifyStoredPassword(key, password, account.passHash)) return { ok: false, error: '密码不正确' };
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
    if (!await verifyStoredPassword(key, oldPassword, account.passHash))
      return { ok: false, error: '旧密码不正确' };
    if (!newPassword || newPassword.length < 4)
      return { ok: false, error: '新密码至少 4 位' };
    account.passHash = await hashPbkdf2Password(key, newPassword);
    map[key] = account;
    await this.saveAccounts(map);
    return { ok: true };
  }

  // ==================== 家庭注册表 ====================

  private familiesKey = 'families'; // Record<code, FamilyRecord>
  private membershipKey = 'membership'; // Record<usernameLower, code>

  private async families(): Promise<Record<string, FamilyRecord>> {
    return (await this.storage.get<Record<string, FamilyRecord>>(this.familiesKey)) || {};
  }

  private async saveFamilies(map: Record<string, FamilyRecord>): Promise<void> {
    await this.storage.put(this.familiesKey, map);
  }

  private async memberships(): Promise<Record<string, string>> {
    return (await this.storage.get<Record<string, string>>(this.membershipKey)) || {};
  }

  private async saveMemberships(map: Record<string, string>): Promise<void> {
    await this.storage.put(this.membershipKey, map);
  }

  /** 生成不重复的 6 位家庭码（排除易混淆的 0/1） */
  private async genFamilyCode(): Promise<string> {
    const digits = '23456789';
    const map = await this.families();
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += digits[Math.floor(Math.random() * digits.length)];
      }
      if (!map[code]) return code;
    }
    throw new Error('无法生成家庭码，请重试');
  }

  /** 家庭成员的实时资料（从账号表读取，改名/换头像自动生效；创建者排最前） */
  private resolveMembers(family: FamilyRecord, accounts: Record<string, AccountRecord>) {
    return family.memberUsernames
      .map((u) => {
        const a = accounts[u];
        return a
          ? {
              username: a.username,
              displayName: a.displayName,
              emoji: a.emoji,
              isOwner: u === family.ownerUsername,
              role: this.roleOf(family, u),
            }
          : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }

  /** 创建家庭：账号需不在任何家庭中 */
  async createFamily(
    username: string
  ): Promise<{ ok: boolean; error?: string; family?: FamilyRecord }> {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: '用户不存在' };

    const memberships = await this.memberships();
    if (memberships[key]) return { ok: false, error: '你已在一个家庭中，请先退出' };

    const code = await this.genFamilyCode();
    const family: FamilyRecord = {
      code,
      scopeId: `family_${code}`,
      ownerId: account.scopeId,
      ownerUsername: key,
      memberUsernames: [key],
      memberRoles: { [key]: 'admin' },
      createdAt: Date.now(),
    };

    const families = await this.families();
    families[code] = family;
    memberships[key] = code;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, family };
  }

  /** 按家庭码查询家庭（含成员实时资料） */
  async getFamilyByCode(
    code: string
  ): Promise<{ ok: boolean; error?: string; family?: FamilyRecord; members?: Array<{ username: string; displayName: string; emoji: string; isOwner: boolean }> }> {
    const normalized = String(code).replace(/\D/g, '');
    const families = await this.families();
    const family = families[normalized];
    if (!family) return { ok: false, error: '家庭码不存在' };

    const accounts = await this.accounts();
    return { ok: true, family, members: this.resolveMembers(family, accounts) };
  }

  /** 加入家庭：账号需不在任何家庭中 */
  async joinFamily(
    username: string,
    code: string
  ): Promise<{ ok: boolean; error?: string; family?: FamilyRecord }> {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    if (!map[key]) return { ok: false, error: '用户不存在' };

    const normalized = String(code).replace(/\D/g, '');
    if (normalized.length !== 6) return { ok: false, error: '家庭码应为 6 位数字' };

    const memberships = await this.memberships();
    if (memberships[key]) return { ok: false, error: '你已在一个家庭中，请先退出' };

    const families = await this.families();
    const family = families[normalized];
    if (!family) return { ok: false, error: '家庭码不存在，请核对后重试' };

    family.memberUsernames.push(key);
    family.memberRoles ??= {};
    family.memberRoles[key] = 'contributor';
    memberships[key] = normalized;
    families[normalized] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, family };
  }

  /** 当前账号的家庭与成员列表（实时资料） */
  async listFamilyMembers(
    username: string
  ): Promise<{ ok: boolean; error?: string; family?: FamilyRecord; members?: Array<{ username: string; displayName: string; emoji: string; isOwner: boolean }> }> {
    const key = username.trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: '你还没有加入家庭' };
    return this.getFamilyByCode(code);
  }

  /** 移除成员：仅创建者可操作，不能移除自己 */
  async removeFamilyMember(
    username: string,
    targetUsername: string
  ): Promise<{ ok: boolean; error?: string; members?: Array<{ username: string; displayName: string; emoji: string; isOwner: boolean }> }> {
    const key = username.trim().toLowerCase();
    const targetKey = String(targetUsername).trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: '你还没有加入家庭' };

    const families = await this.families();
    const family = families[code];
    if (!family) return { ok: false, error: '家庭不存在' };
    if (family.ownerUsername !== key)
      return { ok: false, error: '只有家庭创建者可以移除成员' };
    if (targetKey === key)
      return { ok: false, error: '不能移除自己，请使用退出家庭' };

    const accounts = await this.accounts();
    if (!accounts[targetKey]) return { ok: false, error: '目标用户不存在' };
    if (memberships[targetKey] !== code) return { ok: false, error: '目标用户不在此家庭中' };

    family.memberUsernames = family.memberUsernames.filter((u) => u !== targetKey);
    if (family.memberRoles) delete family.memberRoles[targetKey];
    delete memberships[targetKey];
    families[code] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);

    return { ok: true, members: this.resolveMembers(family, accounts) };
  }

  /** 退出家庭；创建者退出时所有权转移给最早的剩余成员（无成员则解散） */
  async leaveFamily(
    username: string
  ): Promise<{ ok: boolean; error?: string; dissolved?: boolean; newOwner?: string }> {
    const key = username.trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: '你还没有加入家庭' };

    const families = await this.families();
    const family = families[code];
    if (!family) {
      delete memberships[key];
      await this.saveMemberships(memberships);
      return { ok: true, dissolved: true };
    }

    family.memberUsernames = family.memberUsernames.filter((u) => u !== key);
    if (family.memberRoles) delete family.memberRoles[key];
    delete memberships[key];

    if (family.ownerUsername === key) {
      const nextOwner = family.memberUsernames[0];
      if (nextOwner) {
        family.memberRoles ??= {};
        family.memberRoles[nextOwner] = 'admin';
        family.ownerUsername = nextOwner;
        family.ownerId = `user_${nextOwner}`;
        families[code] = family;
        await this.saveFamilies(families);
        await this.saveMemberships(memberships);
        return { ok: true, dissolved: false, newOwner: nextOwner };
      }
      // 没有其他成员 → 解散家庭（共享区数据保留在 family_ 作用域，无法再凭码访问）
      delete families[code];
      await this.saveFamilies(families);
      await this.saveMemberships(memberships);
      return { ok: true, dissolved: true };
    }

    families[code] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, dissolved: false };
  }

  /** 更换家庭码（创建者操作；旧码立即失效） */
  async regenerateFamilyCode(
    username: string
  ): Promise<{ ok: boolean; error?: string; family?: FamilyRecord }> {
    const key = username.trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: '你还没有加入家庭' };

    const families = await this.families();
    const family = families[code];
    if (!family) return { ok: false, error: '家庭不存在' };
    if (family.ownerUsername !== key)
      return { ok: false, error: '只有家庭创建者可以更换家庭码' };

    const newCode = await this.genFamilyCode();
    delete families[code];
    family.code = newCode;
    // An invitation code is not the storage identity. Preserve all shared records.
    for (const member of family.memberUsernames) memberships[member] = newCode;
    families[newCode] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, family };
  }
  private roleOf(family: FamilyRecord, username: string): MemberRole {
    return family.memberRoles?.[username] ?? (username === family.ownerUsername ? 'admin' : 'contributor');
  }

  async getMemberRole(username: string, familyCode?: string): Promise<{ ok: boolean; role?: MemberRole; scopeId?: string }> {
    const key = username.trim().toLowerCase();
    const families = await this.families();
    const code = familyCode ? String(familyCode).replace(/\D/g, '') : (await this.memberships())[key];
    const family = code ? families[code] : undefined;
    if (!family || !family.memberUsernames.includes(key)) return { ok: false };
    return { ok: true, role: this.roleOf(family, key), scopeId: family.scopeId };
  }

  async setMemberRole(operator: string, targetUsername: string, role: MemberRole) {
    const opKey = operator.trim().toLowerCase();
    const targetKey = targetUsername.trim().toLowerCase();
    const code = (await this.memberships())[opKey];
    if (!code) return { ok: false, error: '你还没有加入家庭' };
    const families = await this.families();
    const family = families[code];
    if (!family) return { ok: false, error: '家庭不存在' };
    if (this.roleOf(family, opKey) !== 'admin') return { ok: false, error: '只有管理员可以设置成员角色' };
    if (targetKey === opKey) return { ok: false, error: '不能修改自己的角色' };
    if (!family.memberUsernames.includes(targetKey)) return { ok: false, error: '该成员不在家庭中' };
    if (!['admin', 'contributor', 'viewer'].includes(role)) return { ok: false, error: '无效的角色' };
    family.memberRoles ??= {};
    family.memberRoles[targetKey] = role;
    families[code] = family;
    await this.saveFamilies(families);
    return { ok: true, members: this.resolveMembers(family, await this.accounts()) };
  }

}
