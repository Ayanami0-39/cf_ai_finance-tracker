import { MemberSwitcher } from "./MemberSwitcher";

export function TopBar({ onMemberChange }: { onMemberChange?: (id: string) => void }) {
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
          数据保存在本设备会话
        </span>
        <MemberSwitcher onChange={onMemberChange} />
      </div>
    </div>
  );
}
