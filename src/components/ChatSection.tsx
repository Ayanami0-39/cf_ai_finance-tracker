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
}

export function ChatSection({
  onSendMessage,
  onVoiceClick,
  messages,
  isLoading,
  onLoadOlder,
  hasMoreOlder,
  loadingOlder,
}: ChatSectionProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  };

  // 新消息（追加在尾部）时滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, isLoading]);

  // 翻页加载更早消息后：保持视口位置（记录加载前的滚动高度差，恢复到同一批消息上）
  const prevScrollHeightRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !loadingOlder) return;
    prevScrollHeightRef.current = el.scrollHeight - el.scrollTop;
  }, [loadingOlder]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loadingOlder || prevScrollHeightRef.current === 0) return;
    el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    prevScrollHeightRef.current = 0;
  }, [messages, loadingOlder]);

  const handleLoadOlder = async () => {
    if (!onLoadOlder || loadingOlder) return;
    // 记录当前视口底部位置，加载后恢复
    const el = scrollRef.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight - el.scrollTop;
    await onLoadOlder();
    if (!loadingOlder) prevScrollHeightRef.current = 0;
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
          <MessageBubble key={message.id} message={message} />
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
