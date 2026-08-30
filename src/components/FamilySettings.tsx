import { useState, useEffect } from "react";
import { getMembers, getActiveMemberId, saveMembers, type FamilyMember } from "@/lib/family";
import {
  getFamilyBinding,
  setFamilyBinding,
  clearFamilyBinding,
  isFamilyMode,
  getScopeId,
} from "@/lib/scope";
import { api } from "@/lib/api";
import { Users, Copy, Check, LogOut, Loader2, UserMinus, X } from "lucide-react";

interface FamilySettingsProps {
  onScopeChange: () => void;
}

export function FamilySettings({ onScopeChange }: FamilySettingsProps) {
  const [inFamily, setInFamily] = useState<boolean>(() => isFamilyMode());
  const [binding, setBinding] = useState(() => getFamilyBinding());
  const [remoteMembers, setRemoteMembers] = useState<FamilyMember[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null | undefined>(undefined);

  const localMembers = getMembers();
  const activeId = getActiveMemberId(localMembers);
  const active = localMembers.find((m) => m.id === activeId) || localMembers[0];

  const refreshRemoteMembers = async (scopeId: string) => {
    try {
      const res = await api.getFamilyMembers(scopeId);
      if (res.success) {
        setRemoteMembers(res.members as FamilyMember[]);
        setOwnerId(res.ownerId ?? null);
        // 服务端注册表合并回本地成员列表，标记为家庭成员
        const local = getMembers();
        const merged = [...local];
        for (const rm of res.members) {
          const idx = merged.findIndex((m) => m.id === rm.id);
          if (idx >= 0) {
            merged[idx] = { ...merged[idx], origin: "family" };
          } else {
            merged.push({ ...rm, origin: "family" as const });
          }
        }
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
          saveMembers(merged);
        }
      }
    } catch {
      // 静默失败
    }
  };

  useEffect(() => {
    if (inFamily && binding) {
      refreshRemoteMembers(binding.scopeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 创建家庭：迁移本机全部数据到新家庭作用域
  const handleCreate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const members = getMembers();
      const scopeIdBefore = getScopeId();
      const [expenses, chat] = await Promise.all([
        api.getExpenses(scopeIdBefore),
        api.getChatHistory(scopeIdBefore),
      ]);

      const res = await api.createFamily({
        userId: scopeIdBefore,
        members,
        expenses: expenses.success ? expenses.expenses : [],
        chatMessages: chat.success ? chat.messages : [],
      });

      if (!res.success || !res.code || !res.scopeId) {
        setMsg(res.error || "创建失败，请重试");
        return;
      }

      setFamilyBinding({ code: res.code, scopeId: res.scopeId });
      setBinding({ code: res.code, scopeId: res.scopeId });
      setInFamily(true);
      setMsg(
        `家庭已创建！家庭码 ${res.code}，已迁移 ${res.importedExpenses ?? 0} 笔账单、${res.importedChat ?? 0} 条聊天记录。把家庭码告诉家人即可共同记账。`
      );
      onScopeChange();
    } catch {
      setMsg("创建失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  };

  // 加入家庭：校验家庭码，迁移本机数据，合并成员表
  const handleJoin = async () => {
    const code = codeInput.replace(/\D/g, "");
    if (code.length !== 6) {
      setMsg("请输入 6 位数字家庭码");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const members = getMembers();
      const scopeIdBefore = getScopeId();
      const [expenses, chat] = await Promise.all([
        api.getExpenses(scopeIdBefore),
        api.getChatHistory(scopeIdBefore),
      ]);

      const res = await api.joinFamily({
        code,
        members,
        expenses: expenses.success ? expenses.expenses : [],
        chatMessages: chat.success ? chat.messages : [],
      });

      if (!res.success || !res.scopeId) {
        setMsg(res.error || "加入失败，请重试");
        return;
      }

      setFamilyBinding({ code: res.code || code, scopeId: res.scopeId });
      setBinding({ code: res.code || code, scopeId: res.scopeId });
      setInFamily(true);
      refreshRemoteMembers(res.scopeId);
      setMsg(
        `已加入家庭！本机 ${res.importedExpenses ?? 0} 笔账单、${res.importedChat ?? 0} 条聊天记录已同步到家庭。`
      );
      setCodeInput("");
      onScopeChange();
    } catch {
      setMsg("加入失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  };

  // 退出家庭：仅解除本机绑定，家庭数据保留在云端
  const handleLeave = () => {
    clearFamilyBinding();
    setInFamily(false);
    setBinding(null);
    setRemoteMembers([]);
    setMsg("已退出家庭，本机记录不再共享。家庭云端数据保留，可随时重新加入。");
    onScopeChange();
  };

  const handleCopy = async () => {
    if (!binding) return;
    try {
      await navigator.clipboard.writeText(binding.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  // 仅家庭创建者可移除其他成员（服务端二次校验）
  const isOwner = !!binding && ownerId != null && active?.id === ownerId;

  const removeMember = async (memberId: string) => {
    if (!binding || !active) return;
    setBusy(true);
    try {
      const res = await api.removeFamilyMember(binding.scopeId, memberId, active.id);
      if (!res.success) {
        setMsg(res.error || "移除失败，请重试");
        return;
      }
      // 清理本地成员列表中被移除者，避免残留
      const next = getMembers().filter((m) => m.id !== memberId);
      saveMembers(next);
      setRemoteMembers(res.members || []);
      setRemovingId(null);
      setMsg("已将成员移出家庭，其设备将退回个人记账模式。");
    } catch {
      setMsg("移除失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card border rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">家庭共享</span>
        {inFamily && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            已开启
          </span>
        )}
      </div>

      {!inFamily ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            创建家庭码或输入家人的家庭码，账单与聊天将多设备实时同步。创建时会自动迁移本机现有记录。
          </p>
          <button
            type="button"
            onClick={handleCreate}
            disabled={busy}
            className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            创建家庭
          </button>
          <div className="flex gap-2">
            <input
              value={codeInput}
              onChange={(e) =>
                setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              placeholder="输入 6 位家庭码加入"
              className="flex-1 h-9 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 tabular-nums tracking-widest"
            />
            <button
              type="button"
              onClick={handleJoin}
              disabled={busy || codeInput.replace(/\D/g, "").length !== 6}
              className="px-4 h-9 rounded-lg border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
            >
              加入
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 家庭码展示 */}
          <div className="flex items-center justify-between bg-muted/60 rounded-lg px-3 py-2.5">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">家庭码</p>
              <p className="text-lg font-bold tabular-nums tracking-[0.3em] text-foreground">
                {binding?.code}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="复制家庭码"
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"
            >
              {copied ? (
                <Check className="w-4 h-4 text-income" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* 成员列表（远端注册表） */}
          {remoteMembers.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground">
                家庭成员（{remoteMembers.length}）
              </p>
              {remoteMembers.map((m) => (
                <div key={m.id} className="flex items-center gap-2 py-1">
                  <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-sm">
                    {m.emoji}
                  </span>
                  <span className="text-xs text-foreground flex-1 truncate">
                    {m.name}
                    {m.id === active?.id && (
                      <span className="text-muted-foreground">（我）</span>
                    )}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 bg-muted text-muted-foreground">
                    {m.id === active?.id ? "本人" : "家庭"}
                  </span>
                  {isOwner && m.id !== active?.id && (
                    removingId === m.id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-[10px] text-muted-foreground">移出？</span>
                        <button
                          type="button"
                          aria-label="确认移出"
                          onClick={() => removeMember(m.id)}
                          disabled={busy}
                          className="w-6 h-6 rounded-md bg-destructive text-white flex items-center justify-center hover:bg-destructive/90 active:scale-95 transition-all"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="取消移出"
                          onClick={() => setRemovingId(null)}
                          className="w-6 h-6 rounded-md bg-muted text-muted-foreground flex items-center justify-center hover:bg-muted/80 active:scale-95 transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={`移出成员 ${m.name}`}
                        onClick={() => setRemovingId(m.id)}
                        disabled={busy}
                        className="w-6 h-6 rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center flex-shrink-0 transition-colors"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleLeave}
            className="w-full h-8 rounded-lg border text-xs text-destructive hover:bg-destructive/10 flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            退出家庭
          </button>
        </div>
      )}

      {msg && <p className="text-[11px] text-muted-foreground mt-2">{msg}</p>}
    </div>
  );
}
