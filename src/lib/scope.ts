/**
 * 数据作用域管理：
 * - 个人模式：scopeId = 成员 id（每设备独立）
 * - 家庭模式：scopeId = family_{code}（所有设备共享同一存储）
 * 成员身份（memberId/memberName）与数据作用域分离，加入家庭后
 * 账单和聊天统一写入家庭作用域，跨设备同步。
 */

import { getMembers, getActiveMemberId } from "./family";
import { api } from "./api";

const FAMILY_KEY = "finance_tracker_family"; // { code, scopeId }

export interface FamilyBinding {
  code: string; // 6 位数字家庭码
  scopeId: string; // family_{code}
}

export function getFamilyBinding(): FamilyBinding | null {
  try {
    const raw = localStorage.getItem(FAMILY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.code && parsed.scopeId) return parsed as FamilyBinding;
  } catch {
    // 数据损坏则视为未加入
  }
  return null;
}

export function setFamilyBinding(b: FamilyBinding): void {
  localStorage.setItem(FAMILY_KEY, JSON.stringify(b));
}

export function clearFamilyBinding(): void {
  localStorage.removeItem(FAMILY_KEY);
}

/** 当前数据作用域：家庭绑定优先，否则回落到活跃成员 id */
export function getScopeId(): string {
  const family = getFamilyBinding();
  if (family) return family.scopeId;
  return getActiveMemberId(getMembers());
}

/** 当前是否处于家庭共享模式 */
export function isFamilyMode(): boolean {
  return getFamilyBinding() !== null;
}

/** 校验本机是否仍在已绑定的家庭中；已被移出时自动解除绑定（退回个人模式） */
export async function verifyFamilyMembership(): Promise<boolean> {
  const family = getFamilyBinding();
  if (!family) return true;
  try {
    const res = await api.getFamilyMembers(family.scopeId);
    if (!res.success) return true; // 查询失败时不误清本地绑定
    const members = getMembers();
    const activeId = getActiveMemberId(members);
    if (res.members.some((m) => m.id === activeId)) return true;
    clearFamilyBinding();
    return false;
  } catch {
    return true;
  }
}
