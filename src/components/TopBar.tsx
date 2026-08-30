import { useState } from "react";
import { clearSession, type AccountInfo } from "@/lib/account";

export function TopBar({ account, onEditProfile }: { account: AccountInfo; onEditProfile: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    clearSession();
    window.location.reload();
  };

  return (
    <div className="h-14 bg-card border-b flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <img src="/icon.png" alt="Fiscus" className="w-8 h-8 rounded-lg" />
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-base font-semibold text-foreground">Fiscus</h1>
          <span className="text-xs text-muted-foreground hidden sm:inline truncate">
            智能记账 · AI Finance Tracker
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground hidden sm:block">
          云端同步 · 云端账号
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-full border bg-card hover:bg-muted transition-colors"
            aria-label="账号菜单"
          >
            <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-sm">
              {account.emoji}
            </span>
            <span className="text-xs font-medium text-foreground max-w-[88px] truncate">
              {account.displayName}
            </span>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-11 w-52 bg-card border rounded-xl shadow-lg z-50 overflow-hidden py-1">
                <div className="px-3 py-2">
                  <p className="text-[10px] text-muted-foreground">账号</p>
                  <p className="text-xs text-foreground truncate">{account.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEditProfile();
                  }}
                  className="w-full px-3 h-9 text-left text-xs text-foreground hover:bg-muted transition-colors"
                >
                  编辑资料（昵称/头像）
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full px-3 h-9 text-left text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
