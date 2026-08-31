import { useEffect, useState } from "react";
import type { Message } from "@/types";
import { accountApi } from "@/lib/account";
import { Bot, Monitor, RotateCcw } from "lucide-react";

interface MessageBubbleProps {
  message: Message;
  /** 失败消息一键重试 */
  onRetry?: (failed: Message) => void;
}

/** 打字机逐字渲染 AI 回复；历史消息与用户消息直接整条显示 */
function useTypewriter(text: string, enabled: boolean): { shown: string; done: boolean } {
  const [len, setLen] = useState(enabled ? 0 : text.length);

  useEffect(() => {
    if (!enabled) {
      setLen(text.length);
      return;
    }
    setLen(0);
    // 每 16ms 输出 2 个字符：中文场景约 120 字/秒，接近真人阅读速度
    const step = 2;
    const timer = window.setInterval(() => {
      setLen((prev) => {
        const next = prev + step;
        if (next >= text.length) {
          window.clearInterval(timer);
          return text.length;
        }
        return next;
      });
    }, 16);
    return () => window.clearInterval(timer);
  }, [text, enabled]);

  return { shown: text.slice(0, len), done: len >= text.length };
}

/** 聊天气泡：用户消息显示发送者头像+昵称（按 byId 实时解析服务端账号资料，改名自动生效） */
export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isUser = message.role === "user";
  // 仅对「刚生成的 AI 消息」启用打字机：历史加载的消息时间戳较早，直接整条显示
  // 通过时间戳判断：AI 消息且时间戳在近 30 秒内视为新消息（历史加载不会命中）
  const isNewAi = !isUser && Date.now() - message.timestamp < 30_000;
  const { shown, done } = useTypewriter(message.content, isNewAi);

  // 发送者资料：按 byId 优先解析（家庭模式下可区分不同成员）
  const [sender, setSender] = useState<{ displayName: string; emoji: string } | null>(null);

  useEffect(() => {
    if (!isUser) return;
    // 只按 byId（账号名）查服务端资料；旧本地消息仅有 by 显示名（如「coco 爸」，非账号）→ 不请求，直接展示原文
    const key = message.byId;
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

  const failed = message.status === "failed";

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
            failed
              ? "bg-destructive/10 border border-destructive/30 text-destructive"
              : isUser
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
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {shown}
            {!done && <span className="inline-block w-[2px] h-3.5 align-middle bg-current animate-pulse ml-0.5" />}
          </p>

          {message.expense && !failed && (
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

          {failed && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(message)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-destructive hover:text-destructive/80 active:scale-95 transition-all border border-destructive/40 rounded-full px-2.5 py-1 hover:bg-destructive/10"
            >
              <RotateCcw className="w-3 h-3" />
              重试
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
