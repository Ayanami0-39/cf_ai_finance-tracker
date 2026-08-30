import { useState, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { ChatSection } from "./components/ChatSection";
import { ExpensesSection } from "./components/ExpensesSection";
import { VoiceMode } from "./components/VoiceMode";
import { AuthGate } from "./components/AuthGate";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { MessageCircle, ReceiptText } from "lucide-react";
import { api } from "./lib/api";
import { getUserId } from "./lib/user";
import type { Message, Expense } from "./types";
import "./App.css";

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [mobileTab, setMobileTab] = useState<"chat" | "expenses">("chat");

  // Initialize userId and load data
  useEffect(() => {
    const id = getUserId();
    setUserId(id);
    loadExpenses(id);
    loadChatHistory(id);
  }, []);

  const loadExpenses = async (uid: string) => {
    try {
      const response = await api.getExpenses(uid);
      if (response.success) {
        setExpenses(response.expenses);
      }
    } catch (error) {
      // Error loading expenses
    }
  };

  const loadChatHistory = async (uid: string) => {
    try {
      const response = await api.getChatHistory(uid);
      if (response.success) {
        setMessages(response.messages);
      }
    } catch (error) {
      // Error loading chat history
    }
  };

  const saveChatMessage = async (message: Message) => {
    try {
      await api.saveChatMessage(userId, message);
    } catch (error) {
      // Error saving chat message
    }
  };

  const handleSendMessage = async (input: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Save user message
    saveChatMessage(userMessage);

    setIsLoading(true);

    try {
      const response = await api.sendVoiceCommand(userId, input);

      const aiMessage: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: response.message,
        timestamp: Date.now(),
      };

      if (response.data?.expense) {
        aiMessage.expense = {
          merchant: response.data.expense.merchant || "Unknown",
          amount: response.data.expense.amount,
          category: response.data.expense.category,
        };
      }

      setMessages((prev) => [...prev, aiMessage]);

      // Save AI message
      saveChatMessage(aiMessage);

      await loadExpenses(userId);
    } catch {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: "抱歉，处理失败了，请重试。",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);

      // Save error message
      saveChatMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceUserMessage = (message: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Save user voice message
    saveChatMessage(userMessage);
  };

  const handleVoiceMessageReceived = (message: string, expense?: unknown) => {
    const aiMessage: Message = {
      id: crypto.randomUUID(),
      role: "ai",
      content: message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, aiMessage]);

    // Save voice message
    saveChatMessage(aiMessage);

    if (expense) {
      loadExpenses(userId);
    }
  };

  return (
    <AuthGate>
      <div className="h-screen flex flex-col bg-background">
        <TopBar />

      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="w-[50%] h-full ml-[8%]">
          <ChatSection
            messages={messages}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onVoiceClick={() => setIsVoiceMode(true)}
          />
        </div>
        <div className="w-[38%] h-full px-4 py-2 overflow-y-auto">
          <ExpensesSection expenses={expenses} />
        </div>
      </div>

      <div className="md:hidden flex-1 overflow-hidden flex flex-col">
        <Tabs
          value={mobileTab}
          onValueChange={(v) => setMobileTab(v as "chat" | "expenses")}
          className="h-full flex flex-col flex-1"
        >
          <TabsContent value="chat" className="flex-1 mt-0 overflow-hidden">
            <ChatSection
              messages={messages}
              isLoading={isLoading}
              onSendMessage={handleSendMessage}
              onVoiceClick={() => setIsVoiceMode(true)}
            />
          </TabsContent>

          <TabsContent value="expenses" className="flex-1 mt-0 overflow-hidden">
            <ExpensesSection expenses={expenses} />
          </TabsContent>
        </Tabs>

        <MobileTabBar tab={mobileTab} onChange={setMobileTab} />
      </div>

      <VoiceMode
        isActive={isVoiceMode}
        onClose={() => setIsVoiceMode(false)}
        onMessageReceived={handleVoiceMessageReceived}
        onUserMessage={handleVoiceUserMessage}
      />
      </div>
    </AuthGate>
  );
}

// Mobile: bottom tab bar with safe-area padding
function MobileTabBar({
  tab,
  onChange,
}: {
  tab: "chat" | "expenses";
  onChange: (t: "chat" | "expenses") => void;
}) {
  return (
    <nav
      className="md:hidden bg-card border-t grid grid-cols-2"
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 6px)",
        paddingTop: "6px",
      }}
    >
      <MobileTabButton
        active={tab === "chat"}
        onClick={() => onChange("chat")}
        icon={<MessageCircle className="w-5 h-5" />}
        label="对话"
      />
      <MobileTabButton
        active={tab === "expenses"}
        onClick={() => onChange("expenses")}
        icon={<ReceiptText className="w-5 h-5" />}
        label="记录"
      />
    </nav>
  );
}

function MobileTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-0.5 h-12 text-xs transition-colors ${
        active ? "text-primary font-medium" : "text-muted-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default App;
