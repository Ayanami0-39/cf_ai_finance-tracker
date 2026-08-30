import { getUserId } from "./user";

export interface FamilyMember {
  id: string; // 同时作为后端 userId，数据按成员隔离
  name: string;
  emoji: string;
  origin?: "local" | "family"; // 本机成员 or 家庭同步成员
}

const MEMBERS_KEY = "finance_tracker_members";
const ACTIVE_KEY = "finance_tracker_active_member";

function normalize(members: FamilyMember[]): FamilyMember[] {
  return members
    .filter((m) => m && m.id && m.name)
    .map((m) => ({ ...m, origin: m.origin || "local" }));
}

export function getMembers(): FamilyMember[] {
  try {
    const raw = localStorage.getItem(MEMBERS_KEY);
    if (raw) {
      const members = JSON.parse(raw) as FamilyMember[];
      if (Array.isArray(members) && members.length > 0) {
        return normalize(members);
      }
    }
  } catch {
    // 数据损坏时走默认初始化
  }

  // 首次启用：把既有 userId 作为默认成员「我」，保证老数据不丢
  const legacy = getUserId();
  const members: FamilyMember[] = [{ id: legacy, name: "我", emoji: "🙂" }];
  saveMembers(members);
  return members;
}

export function saveMembers(members: FamilyMember[]): void {
  localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
}

export function getActiveMemberId(members: FamilyMember[]): string {
  const id = localStorage.getItem(ACTIVE_KEY);
  if (id && members.some((m) => m.id === id)) return id;
  return members[0].id;
}

export function setActiveMemberId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function createMember(name: string, emoji: string): FamilyMember {
  return {
    id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    name,
    emoji,
    origin: "local",
  };
}

/** 编辑成员资料（改名/换头像），并同步到家庭注册表（家庭成员可见） */
export function updateMember(
  id: string,
  patch: { name: string; emoji: string }
): FamilyMember[] {
  const next = getMembers().map((m) =>
    m.id === id ? { ...m, ...patch } : m
  );
  saveMembers(next);
  return next;
}
