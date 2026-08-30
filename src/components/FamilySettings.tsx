import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { getAccount, type AccountInfo } from "@/lib/account";
import { Loader2, X, Copy, Check, Users } from "lucide-react";

interface FamilySettingsProps {
  onClose: () => void;
  /** 家庭状态变化（创建/加入/退出/被移出）后通知 App 重载数据 */
  onChanged: () => void;
}

interface MemberRow {
  username: string;
  displayName: string;
  emoji: string;
  isOwner: boolean;
}

/** 家庭共享面板：创建家庭 / 凭码加入 / 成员管理（头像+昵称实时取自账号） */
export function FamilySettings({ onClose, onChanged }: FamilySettingsProps) {
  const account: AccountInfo | null = getAccount();
  const [family, setFamily] = useState<{ code: string; scopeId: string; isOwner: boolean } | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // 加入表单
  const [codeInput, setCodeInput] = useState("");
  const [mode, setMode] = useState<"idle" | "join">("idle");
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getMyFamily();
      if (res.success) {
        setFamily(res.family);
        setMembers(res.members || []);
      } else {
        setError(res.error || "加载失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.createFamily();
      if (!res.success || !res.family) {
        setError(res.error || "创建失败");
        return;
      }
      setFamily(res.family);
      await refresh();
      onChanged();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    const code = codeInput.replace(/\D/g, "");
    if (code.length !== 6) {
      setError("请输入 6 位数字家庭码");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await api.joinFamily(code);
      if (!res.success || !res.family) {
        setError(res.error || "加入失败");
        return;
      }
      setFamily(res.family);
      setMode("idle");
      setCodeInput("");
      await refresh();
      onChanged();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (username: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await api.removeFamilyMember(username);
      if (!res.success) {
        setError(res.error || "移除失败");
        return;
      }
      setConfirmingRemove(null);
      setNotice(`已移除 ${username}，对方下次打开应用将回到个人记账`);
      await refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.leaveFamily();
      if (!res.success) {
        setError(res.error || "退出失败");
        return;
      }
      setConfirmingLeave(false);
      setNotice(res.dissolved ? "已退出并解散家庭" : "已退出家庭");
      await refresh();
      onChanged();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await api.regenerateFamilyCode();
      if (!res.success || !res.family) {
        setError(res.error || "更换失败");
        return;
      }
      setFamily(res.family);
      setNotice("家庭码已更换，旧码立即失效");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!family) return;
    try {
      await navigator.clipboard.writeText(family.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时静默
    }
  };

  const isOwner = !!family?.isOwner;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-card border rounded-xl p-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Users className="w-4 h-4" />
            家庭共享
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : family ? (
          <div>
            {/* 家庭码卡片 */}
            <div className="rounded-xl border bg-background p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">家庭码（家人输入此码加入）</p>
                  <p className="text-xl font-bold tracking-[0.3em] text-foreground">{family.code}</p>
                </div>
                <button
                  type="button"
                  onClick={copyCode}
                  className="h-8 px-2.5 rounded-lg border text-xs flex items-center gap-1 hover:bg-muted transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              {isOwner && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={busy}
                  className="mt-2.5 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-50"
                >
                  更换家庭码（旧码立即失效）
                </button>
              )}
            </div>

            {/* 成员列表：头像+昵称实时来自账号资料 */}
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground mb-1.5">成员（{members.length}）</p>
              <div className="rounded-xl border overflow-hidden">
                {members.map((m) => {
                  const isMe = account && m.username.toLowerCase() === account.username.toLowerCase();
                  return (
                    <div key={m.username} className="flex items-center gap-2.5 px-3 h-12 border-b last:border-b-0">
                      <span className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-base flex-shrink-0">
                        {m.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">
                          {m.displayName}
                          {isMe && <span className="text-muted-foreground font-normal">（我）</span>}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">@{m.username}</p>
                      </div>
                      {m.isOwner && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex-shrink-0">
                          创建者
                        </span>
                      )}
                      {isOwner && !isMe && (
                        confirmingRemove === m.username ? (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRemove(m.username)}
                              disabled={busy}
                              className="h-7 px-2 rounded-lg bg-destructive text-white text-[10px] disabled:opacity-50"
                            >
                              确认移出
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingRemove(null)}
                              className="h-7 px-2 rounded-lg border text-[10px] text-muted-foreground"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingRemove(m.username)}
                            className="h-7 px-2 rounded-lg text-[10px] text-destructive hover:bg-destructive/10 flex-shrink-0"
                          >
                            移出
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}
            {notice && <p className="text-[11px] text-green-600 mt-2">{notice}</p>}

            {/* 退出家庭 */}
            <div className="mt-3">
              {confirmingLeave ? (
                <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <span className="text-[11px] text-foreground">
                    {isOwner ? "退出后所有权将转移给最早加入的成员" : "确定退出这个家庭？"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleLeave}
                      disabled={busy}
                      className="h-7 px-2.5 rounded-lg bg-destructive text-white text-[10px] disabled:opacity-50"
                    >
                      确认退出
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingLeave(false)}
                      className="h-7 px-2.5 rounded-lg border text-[10px] text-muted-foreground"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingLeave(true)}
                  className="w-full h-9 rounded-lg border text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  退出家庭
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              和家人共用一本账：创建家庭生成家庭码，家人登录后凭码加入。加入后双方的新记录都会进入家庭账本，成员列表显示各自的头像和昵称。
            </p>

            {mode === "idle" ? (
              <div className="mt-4 space-y-2.5">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={busy}
                  className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  创建家庭
                </button>
                <button
                  type="button"
                  onClick={() => setMode("join")}
                  disabled={busy}
                  className="w-full h-10 rounded-lg border text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  输入家庭码加入
                </button>
              </div>
            ) : (
              <div className="mt-4">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  inputMode="numeric"
                  autoFocus
                  placeholder="6 位数字家庭码"
                  className="w-full h-10 px-3 text-sm text-center tracking-[0.3em] rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex gap-2 mt-2.5">
                  <button
                    type="button"
                    onClick={handleJoin}
                    disabled={busy || codeInput.length !== 6}
                    className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    加入
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("idle");
                      setCodeInput("");
                      setError("");
                    }}
                    className="h-10 px-4 rounded-lg border text-sm text-muted-foreground"
                  >
                    返回
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}
            <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
              创建或加入时，你在个人模式下的历史记录会自动并入家庭账本（按记录去重，不会重复）。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
