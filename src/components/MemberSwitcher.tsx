import { useState, useRef, useEffect } from "react";
import {
  getMembers,
  saveMembers,
  getActiveMemberId,
  setActiveMemberId,
  createMember,
  updateMember,
  type FamilyMember,
} from "@/lib/family";
import { isFamilyMode, getScopeId } from "@/lib/scope";
import { api } from "@/lib/api";
import { FamilySettings } from "./FamilySettings";
import { Check, Plus, Users, Settings2, Pencil } from "lucide-react";

const EMOJI_CHOICES = ["🙂", "😎", "👩", "👨", "👧", "👦", "👴", "👵", "🐱", "🐶"];

export function MemberSwitcher({
  onChange,
  onScopeChange,
}: {
  onChange?: (memberId: string) => void;
  onScopeChange?: () => void;
}) {
  const [members, setMembers] = useState<FamilyMember[]>(() => getMembers());
  const [activeId, setActiveId] = useState<string>(() =>
    getActiveMemberId(getMembers())
  );
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showFamily, setShowFamily] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);
  const panelRef = useRef<HTMLDivElement>(null);

  const active = members.find((m) => m.id === activeId) || members[0];

  // 点击面板外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const switchTo = (id: string) => {
    if (editingId === id) return; // 编辑中不触发切换
    if (id === activeId) {
      setOpen(false);
      return;
    }
    setActiveMemberId(id);
    setActiveId(id);
    setOpen(false);
    onChange?.(id);
  };

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const member = createMember(trimmed, emoji);
    const next = [...members, member];
    saveMembers(next);
    setMembers(next);
    setName("");
    setEmoji(EMOJI_CHOICES[0]);
    setAdding(false);
    switchTo(member.id);
  };

  const startEdit = (m: FamilyMember) => {
    setEditingId(m.id);
    setName(m.name);
    setEmoji(m.emoji);
  };

  // 保存编辑：本地立即生效；家庭模式下同步到服务端注册表
  const handleSaveEdit = () => {
    if (!editingId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = updateMember(editingId, { name: trimmed, emoji });
    setMembers(next);
    setEditingId(null);
    setName("");
    if (isFamilyMode()) {
      const m = next.find((x) => x.id === editingId);
      if (m) {
        api.syncMemberProfile(getScopeId(), {
          id: m.id,
          name: m.name,
          emoji: m.emoji,
        }).catch(() => {
          // 同步失败不影响本地生效
        });
      }
    }
  };

  const handleRemove = (id: string) => {
    if (members.length <= 1) return; // 至少保留一个成员
    const next = members.filter((m) => m.id !== id);
    saveMembers(next);
    setMembers(next);
    if (id === activeId) {
      setActiveMemberId(next[0].id);
      setActiveId(next[0].id);
      onChange?.(next[0].id);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-full border bg-card hover:bg-muted transition-colors"
        aria-label="切换家庭成员"
      >
        <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-sm">
          {active?.emoji}
        </span>
        <span className="text-xs font-medium text-foreground max-w-[72px] truncate">
          {active?.name}
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-11 w-64 bg-card border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-3 pt-3 pb-1 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">
              成员
            </span>
            {isFamilyMode() && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                家庭模式
              </span>
            )}
          </div>

          <div className="px-1.5 pb-1.5 max-h-64 overflow-y-auto">
            {members.map((m) =>
              editingId === m.id ? (
                /* 编辑态 */
                <div key={m.id} className="px-1 py-2 space-y-2">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    maxLength={12}
                    className="w-full h-8 px-2.5 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="flex flex-wrap gap-1">
                    {EMOJI_CHOICES.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setEmoji(e)}
                        className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center transition-colors ${
                          emoji === e
                            ? "bg-primary/15 ring-1 ring-primary"
                            : "hover:bg-muted"
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={!name.trim()}
                      className="flex-1 h-7 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="flex-1 h-7 rounded-lg border text-xs text-muted-foreground"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* 普通态 */
                <div
                  key={m.id}
                  className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                    m.id === activeId ? "bg-muted" : "hover:bg-muted/60"
                  }`}
                  onClick={() => switchTo(m.id)}
                >
                  <span className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-base flex-shrink-0">
                    {m.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate leading-tight">
                      {m.name}
                    </p>
                    <p className="text-[9px] text-muted-foreground leading-tight">
                      {m.origin === "family" ? "家庭成员" : "本机成员"}
                    </p>
                  </div>
                  {m.id === activeId ? (
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  ) : (
                    <button
                      type="button"
                      aria-label={`编辑成员 ${m.name}`}
                      className="text-muted-foreground/50 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(m);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {members.length > 1 && m.id !== activeId && (
                    <button
                      type="button"
                      aria-label={`删除成员 ${m.name}`}
                      className="text-xs text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 px-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(m.id);
                      }}
                    >
                      移除
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          {/* Add member */}
          <div className="border-t p-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setShowFamily(true);
              }}
              className="w-full flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium text-foreground hover:bg-muted transition-colors mb-1"
            >
              <Settings2 className="w-4 h-4" />
              家庭共享 / 多设备同步
            </button>
            {!adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-medium text-primary hover:bg-muted transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加成员
              </button>
            ) : (
              <div className="space-y-2 p-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  placeholder="成员昵称"
                  maxLength={12}
                  className="w-full h-9 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex flex-wrap gap-1">
                  {EMOJI_CHOICES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEmoji(e)}
                      className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-colors ${
                        emoji === e
                          ? "bg-primary/15 ring-1 ring-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!name.trim()}
                    className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40"
                  >
                    添加
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setName("");
                    }}
                    className="flex-1 h-8 rounded-lg border text-xs text-muted-foreground"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Family settings modal */}
      {showFamily && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setShowFamily(false)}
          />
          <div className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto">
            <FamilySettings
              onScopeChange={() => {
                setShowFamily(false);
                onScopeChange?.();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
