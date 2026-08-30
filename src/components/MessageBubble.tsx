import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] md:max-w-[75%] rounded-xl px-4 py-2.5 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card border text-foreground"
        }`}
      >
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
