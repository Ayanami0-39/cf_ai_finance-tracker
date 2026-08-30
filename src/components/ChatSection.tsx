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
}

export function ChatSection({
  onSendMessage,
  onVoiceClick,
  messages,
  isLoading,
}: ChatSectionProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
      <div className="px-6 pt-5 pb-3">
        <h2 className="text-base font-semibold text-foreground">
          智能记账助手
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          说出或输入你的收支，我来帮你记录 · Speak Chinese or English
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1">
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
      <div className="p-4 pt-2">
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
