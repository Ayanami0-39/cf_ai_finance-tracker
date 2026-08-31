import { useState, useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mic, Send } from "lucide-react";
import type { Message } from "@/types";

interface ChatSectionProps {
  onSendMessage: (input: string) => Promise<void>;
  onVoiceClick: () => void;
  messages: Message[];
  isLoading: boolean;
  /** 向上翻页：加载更早的消息 */
  onLoadOlder?: () => Promise<void> | void;
  /** 是否还有更早的消息可加载 */
  hasMoreOlder?: boolean;
  /** 正在加载更早的消息 */
  loadingOlder?: boolean;
  /** 失败消息一键重试 */
  onRetry?: (failed: Message) => void;
}

export function ChatSection({
  onSendMessage,
  onVoiceClick,
  messages,
  isLoading,
  onLoadOlder,
  hasMoreOlder,
  loadingOlder,
  onRetry,
}: ChatSectionProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 上一批消息的首/尾 id：区分「前插更早消息」与「追加新消息」
  const prevEdgeRef = useRef<{ first: string | undefined; last: string | undefined }>({
    first: undefined,
    last: undefined,
  });
  // 翻页前记录的视口锚点（视口顶距内容底部的偏移），前插渲染后按高度差恢复，避免视口跳动
  const pendingRestoreRef = useRef<number | null>(null);

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    const first = messages[0]?.id;
    const last = messages[messages.length - 1]?.id;
    const prev = prevEdgeRef.current;

    if (pendingRestoreRef.current != null && scrollRef.current) {
      // 前插更早消息：视口保持停在原来那条消息上，不回滚
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight - pendingRestoreRef.current;
      pendingRestoreRef.current = null;
    } else if (last !== prev.last) {
      // 追加新消息（含首屏加载）：滚动到底部
      scrollToBottom();
    }
    prevEdgeRef.current = { first, last };
  }, [messages, isLoading]);

  const handleLoadOlder = async () => {
    if (!onLoadOlder || loadingOlder) return;
    // 在 setState 前同步记录视口锚点，前插渲染完成后由上面的 effect 恢复
    const el = scrollRef.current;
    if (el) pendingRestoreRef.current = el.scrollHeight - el.scrollTop;
    await onLoadOlder();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput("");
    await onSendMessage(message);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 pt-4 md:pt-5 pb-3">
        <h2 className="text-base font-semibold text-foreground">
          智能记账助手
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          说出或输入你的收支，我来帮你记录 · Speak Chinese or English
        </p>
      </div>

      {/* Messages：限高滚动，超出部分通过「加载更早」翻页查看 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 md:px-6 py-3 space-y-1 mx-auto w-full max-w-3xl min-h-0"
      >
        {hasMoreOlder && messages.length > 0 && (
          <div className="flex justify-center py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loadingOlder}
              onClick={handleLoadOlder}
              className="text-xs text-muted-foreground hover:text-foreground h-7 px-3 rounded-full"
            >
              {loadingOlder ? "加载中…" : "↑ 加载更早的消息"}
            </Button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-muted-foreground">开始对话吧…</p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              试试：「我在星巴克花了35块买拿铁」或「这个月花了多少钱」
            </p>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRetry={onRetry}
          />
        ))}

        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="bg-card border rounded-xl px-4 py-3">
              <div className="flex gap-1">
                <div
                  className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div
        className="p-4 pt-2 mx-auto w-full max-w-3xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom) + 4px)" }}
      >
        <form
          onSubmit={handleSubmit}
          className="flex gap-2 items-center bg-card border rounded-full px-4 py-2"
        >
          <Input
            value={input}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setInput(e.target.value)
            }
            placeholder="输入收支，如「午饭花了30块」…"
            className="flex-1 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent placeholder:text-muted-foreground/60"
            disabled={isLoading}
          />

          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onVoiceClick}
            className="rounded-full h-9 w-9 hover:bg-secondary hover:text-primary transition-colors"
          >
            <Mic className="w-4 h-4" />
          </Button>

          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="rounded-full h-9 w-9 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
