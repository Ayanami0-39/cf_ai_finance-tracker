import { useEffect, useState } from "react";
import type { Message } from "@/types";
import { accountApi } from "@/lib/account";

interface MessageBubbleProps {
  message: Message;
}

/** 聊天气泡：用户消息显示发送者头像+昵称（按 byId 实时解析服务端账号资料，改名自动生效） */
export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  // 发送者资料：按 byId 优先解析（家庭模式下可区分不同成员）
  const [sender, setSender] = useState<{ displayName: string; emoji: string } | null>(null);

  useEffect(() => {
    if (!isUser) return;
    const key = message.byId || message.by;
    if (!key) return;
    let cancelled = false;
    accountApi.getProfiles([key]).then((map) => {
      if (!cancelled && map[key]) setSender(map[key]);
    });
    return () => {
      cancelled = true;
    };
  }, [isUser, message.byId, message.by]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] md:max-w-[75%] rounded-xl px-4 py-2.5 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card border text-foreground"
        }`}
      >
        {isUser && (sender?.displayName || message.by) && (
          <p className="text-[10px] opacity-70 mb-0.5 flex items-center gap-1">
            {sender && <span>{sender.emoji}</span>}
            <span>{sender?.displayName || message.by}</span>
          </p>
        )}
        <p className="text-sm leading-relaxed">{message.content}</p>

        {message.expense && (
          <div
            className={`mt-2 pt-2 border-t text-xs ${
              isUser
                ? "border-primary-foreground/20 text-primary-foreground/80"
                : "border-border text-muted-foreground"
            }`}
          >
            {message.expense.merchant} • ¥
            {message.expense.amount.toFixed(2)} • {message.expense.category}
          </div>
        )}
      </div>
    </div>
  );
}
