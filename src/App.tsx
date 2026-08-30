import { useState, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { ChatSection } from "./components/ChatSection";
import { ExpensesSection } from "./components/ExpensesSection";
import { VoiceMode } from "./components/VoiceMode";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <div className="px-3 pt-2">
          <SummaryCardsInline expenses={expenses} />
        </div>
        <Tabs defaultValue="chat" className="h-full flex flex-col flex-1">
          <TabsList className="w-full grid grid-cols-2 rounded-none h-11 bg-muted">
            <TabsTrigger
              value="chat"
              className="rounded-lg mx-2 data-[state=active]:bg-card"
            >
              对话
            </TabsTrigger>
            <TabsTrigger
              value="expenses"
              className="rounded-lg mx-2 data-[state=active]:bg-card"
            >
              记录
            </TabsTrigger>
          </TabsList>

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
      </div>

      <VoiceMode
        isActive={isVoiceMode}
        onClose={() => setIsVoiceMode(false)}
        onMessageReceived={handleVoiceMessageReceived}
        onUserMessage={handleVoiceUserMessage}
      />
    </div>
  );
}

// Mobile: compact summary band above tabs
import { SummaryCards } from "./components/SummaryCard";
function SummaryCardsInline({ expenses }: { expenses: Expense[] }) {
  return <SummaryCards expenses={expenses} />;
}

export default App;
