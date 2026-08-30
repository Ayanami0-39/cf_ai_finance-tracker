import { useEffect, useState } from "react";
import type { Message } from "@/types";
import { accountApi } from "@/lib/account";
import { Bot, Monitor } from "lucide-react";

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

  // AI 消息来源：ai = 机器人（智能解析），fallback = 电脑（规则兜底）。
  // 历史消息无 parsedBy 时按兜底回复的固定句式推断展示。
  const fallbackRe = /已记录|记录收入|请告诉我具体金额|没太听懂|没太理解|couldn'?t|didn'?t/i;
  const isFallbackSource = !isUser && (
    message.parsedBy === "fallback" ||
    (message.parsedBy === undefined && fallbackRe.test(message.content))
  );
  const sourceIcon = isUser
    ? null
    : isFallbackSource
      ? <Monitor className="w-3 h-3" />
      : <Bot className="w-3 h-3" />;
  const sourceTitle = isUser
    ? null
    : message.parsedBy === "ai"
      ? "AI 智能解析"
      : message.parsedBy === "fallback"
        ? "规则兜底解析"
        : isFallbackSource
          ? "规则兜底解析（历史消息推断）"
          : "AI 智能解析（历史消息推断）";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3 items-end gap-1.5`}>
      {/* 来源角标：位于气泡左外侧，形如「解析者头像」，不遮挡气泡内容 */}
      {!isUser && sourceIcon && (
        <span
          title={sourceTitle || undefined}
          className={`w-5 h-5 rounded-full border shadow-sm flex items-center justify-center flex-shrink-0 ${
            isFallbackSource
              ? "bg-muted text-muted-foreground border-border"
              : "bg-card text-primary border-primary/20"
          }`}
        >
          {sourceIcon}
        </span>
      )}
      <div className="max-w-[85%] md:max-w-[75%]">
        <div
          className={`rounded-xl px-4 py-2.5 ${
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
    </div>
  );
}

