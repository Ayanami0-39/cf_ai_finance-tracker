import { useState, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { ChatSection } from "./components/ChatSection";
import { ExpensesSection } from "./components/ExpensesSection";
import { StatsSection } from "./components/StatsSection";
import { VoiceMode } from "./components/VoiceMode";
import { AuthGate } from "./components/AuthGate";
import { AccountLogin } from "./components/AccountLogin";
import { ProfileEditor } from "./components/ProfileEditor";
import { FamilySettings } from "./components/FamilySettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, ReceiptText, BarChart3 } from "lucide-react";
import { api } from "./lib/api";
import { accountApi, getAccount, type AccountInfo } from "./lib/account";
import type { Message, Expense } from "./types";
import "./App.css";

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(() => getAccount());
  const [showProfile, setShowProfile] = useState(false);
  const [showFamily, setShowFamily] = useState(false);
  const [family, setFamily] = useState<{ code: string; scopeId: string; isOwner: boolean } | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "expenses" | "stats">("chat");

  // 当前生效数据作用域：家庭共享区优先，否则个人区
  const activeScope = family?.scopeId || account?.scopeId || "";

  // 已有会话：打开应用时刷新服务端资料与家庭归属，再加载数据
  useEffect(() => {
    if (!account) return;
    (async () => {
      const meRes = await accountApi.me();
      const acct = meRes.success && meRes.account ? meRes.account : account;
      setAccount(acct);

      const famRes = await api.getMyFamily();
      const fam = famRes.success ? famRes.family : null;
      setFamily(fam);

      const scope = fam?.scopeId || acct.scopeId;
      loadExpenses(scope);
      loadChatHistory(scope);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFamilyChanged = () => {
    // 创建/加入/退出家庭后：刷新家庭归属并按新作用域重载数据
    api.getMyFamily().then((res) => {
      const fam = res.success ? res.family : null;
      setFamily(fam);
      const scope = fam?.scopeId || account?.scopeId;
      if (scope) {
        setExpenses([]);
        setMessages([]);
        loadExpenses(scope);
        loadChatHistory(scope);
      }
    });
  };

  // 已有会话：打开应用时刷新服务端资料（其他设备改过昵称/头像也能同步）并加载数据
  useEffect(() => {
    if (!account) return;
    accountApi.me().then((res) => {
      if (res.success && res.account) {
        setAccount(res.account);
        loadExpenses(res.account.scopeId);
        loadChatHistory(res.account.scopeId);
      } else if (res.success === false && !res.account) {
        // 未登录（无会话）：仅加载数据，交由 AccountLogin 处理登录
        loadExpenses(account.scopeId);
        loadChatHistory(account.scopeId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (acct: AccountInfo) => {
    setAccount(acct);
    setExpenses([]);
    setMessages([]);
    loadExpenses(acct.scopeId);
    loadChatHistory(acct.scopeId);

    // 一次性迁移：把本机旧数据（升级前的随机 userId 作用域）并入账号
    try {
      const legacyId = localStorage.getItem("finance_tracker_user_id");
      const migrated = localStorage.getItem("account_migrated");
      if (legacyId && !migrated && legacyId !== acct.scopeId) {
        api.mergeIdentity(legacyId, acct.scopeId).finally(() => {
          localStorage.setItem("account_migrated", "1");
          loadExpenses(acct.scopeId);
        });
      }
    } catch {
      // 迁移失败不影响登录
    }
  };

  const handleProfileSaved = (acct: AccountInfo) => {
    setAccount(acct);
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!activeScope) return;
    // 乐观更新：先移除本地，再请求后端
    setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
    try {
      await api.deleteExpense(activeScope, expenseId);
    } catch {
      // 失败时回滚重新拉取
      loadExpenses(activeScope);
    }
  };

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
    if (!activeScope) return;
    try {
      await api.saveChatMessage(activeScope, message);
    } catch (error) {
      // Error saving chat message
    }
  };

  const handleSendMessage = async (input: string) => {
    if (!account) return;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      timestamp: Date.now(),
      by: account.displayName,
      byId: account.username,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Save user message
    saveChatMessage(userMessage);

    setIsLoading(true);

    try {
      const response = await api.sendVoiceCommand({
        userId: activeScope,
        input,
        memberName: account.displayName,
        memberId: account.username,
      });

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

      await loadExpenses(activeScope);
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
    if (!account) return;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      timestamp: Date.now(),
      by: account.displayName,
      byId: account.username,
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

    if (expense && activeScope) {
      loadExpenses(activeScope);
    }
  };

  // 未登录：显示账号登录/注册页（包在 AuthGate 内，仍需先过访问密码）
  if (!account) {
    return (
      <AuthGate>
        <AccountLogin onLogin={handleLogin} />
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <div className="h-screen flex flex-col bg-background">
        <TopBar
          account={account}
          onEditProfile={() => setShowProfile(true)}
          familyCode={family?.code}
          onOpenFamily={() => setShowFamily(true)}
        />

      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="w-[50%] h-full ml-[8%]">
          <ChatSection
            messages={messages}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onVoiceClick={() => setIsVoiceMode(true)}
          />
        </div>
        <div className="w-[38%] h-full px-4 py-2 overflow-hidden">
          <Tabs defaultValue="expenses" className="h-full flex flex-col">
            <div className="flex justify-end pb-2 flex-shrink-0">
              <TabsList className="h-8">
                <TabsTrigger value="expenses" className="text-xs px-3 h-7">
                  记录
                </TabsTrigger>
                <TabsTrigger value="stats" className="text-xs px-3 h-7">
                  统计
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="expenses" className="flex-1 mt-0 overflow-hidden">
              <ExpensesSection
                expenses={expenses}
                onDeleteExpense={handleDeleteExpense}
              />
            </TabsContent>
            <TabsContent value="stats" className="flex-1 mt-0 overflow-hidden">
              <StatsSection expenses={expenses} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <div className="md:hidden flex-1 overflow-hidden flex flex-col">
        <Tabs
          value={mobileTab}
          onValueChange={(v) => setMobileTab(v as "chat" | "expenses" | "stats")}
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
            <ExpensesSection expenses={expenses} onDeleteExpense={handleDeleteExpense} />
          </TabsContent>

          <TabsContent value="stats" className="flex-1 mt-0 overflow-hidden">
            <StatsSection expenses={expenses} />
          </TabsContent>
        </Tabs>

        <MobileTabBar tab={mobileTab} onChange={setMobileTab} />
      </div>

      <VoiceMode
        isActive={isVoiceMode}
        onClose={() => setIsVoiceMode(false)}
        onMessageReceived={handleVoiceMessageReceived}
        onUserMessage={handleVoiceUserMessage}
        scopeId={activeScope}
      />

      {showProfile && (
        <ProfileEditor
          account={account}
          onClose={() => setShowProfile(false)}
          onSaved={handleProfileSaved}
        />
      )}

      {showFamily && (
        <FamilySettings
          onClose={() => setShowFamily(false)}
          onChanged={handleFamilyChanged}
        />
      )}
      </div>
    </AuthGate>
  );
}

// Mobile: bottom tab bar with safe-area padding
function MobileTabBar({
  tab,
  onChange,
}: {
  tab: "chat" | "expenses" | "stats";
  onChange: (t: "chat" | "expenses" | "stats") => void;
}) {
  return (
    <nav
      className="md:hidden bg-card border-t grid grid-cols-3"
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
      <MobileTabButton
        active={tab === "stats"}
        onClick={() => onChange("stats")}
        icon={<BarChart3 className="w-5 h-5" />}
        label="统计"
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
