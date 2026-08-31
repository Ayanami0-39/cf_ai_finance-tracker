import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { TopBar } from "./components/TopBar";
import { ChatSection } from "./components/ChatSection";
import { ExpensesSection } from "./components/ExpensesSection";
import { StatsSection } from "./components/StatsSection";
import type { VoiceExpensePayload } from "./hooks/useVoiceConversation";
import { AuthGate } from "./components/AuthGate";
import { AccountLogin } from "./components/AccountLogin";
import { ProfileEditor } from "./components/ProfileEditor";
import { FamilySettings } from "./components/FamilySettings";
import { EditExpenseModal } from "./components/EditExpenseModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, ReceiptText, BarChart3 } from "lucide-react";
import { api } from "./lib/api";
import { accountApi, getAccount, type AccountInfo } from "./lib/account";
import type { Message, Expense } from "./types";
import "./App.css";

// 语音模式按需加载：不点击麦克风不下载相关代码，减小首屏体积
const VoiceMode = lazy(() =>
  import("./components/VoiceMode").then((m) => ({ default: m.VoiceMode }))
);

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
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // 当前生效数据作用域：家庭共享区优先，否则个人区
  const activeScope = family?.scopeId || account?.scopeId || "";

  // 已有会话：打开应用时一次性刷新服务端资料与家庭归属，再按新作用域加载数据
  // （合并原先两个重复的 useEffect，避免首屏双倍请求）
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

  // 编辑交易记录：乐观更新本地，PATCH 后端，失败回滚并抛错（弹窗内提示）
  const handleUpdateExpense = async (expenseId: string, patch: Partial<Expense>) => {
    if (!activeScope) return;
    setExpenses((prev) =>
      prev.map((e) => (e.id === expenseId ? { ...e, ...patch } : e))
    );
    try {
      const res = await api.updateExpense(activeScope, expenseId, patch);
      if (!res.success) throw new Error(res.error || "保存失败");
      if (res.expense) {
        setExpenses((prev) => prev.map((e) => (e.id === expenseId ? res.expense! : e)));
      }
    } catch (err) {
      if (activeScope) loadExpenses(activeScope);
      throw err instanceof Error ? err : new Error("保存失败");
    }
  };

  // 聊天分页：默认只加载最新 CHAT_PAGE_SIZE 条，更早的按需翻页加载
  const CHAT_PAGE_SIZE = 10;
  const [chatHasMore, setChatHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const oldestChatTsRef = useRef<number | null>(null);

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
      const response = await api.getChatHistory(uid, { limit: CHAT_PAGE_SIZE });
      if (response.success) {
        setMessages(response.messages);
        oldestChatTsRef.current = response.messages.length
          ? response.messages[0].timestamp
          : null;
        setChatHasMore(Boolean(response.hasMore));
      }
    } catch (error) {
      // Error loading chat history
    }
  };

  // 向上翻页：拉取当前最早一条之前的更早消息， prepend 到列表头
  const loadOlderMessages = async () => {
    const uid = activeScope;
    const before = oldestChatTsRef.current;
    if (!uid || before == null || loadingOlder || !chatHasMore) return;
    setLoadingOlder(true);
    try {
      const response = await api.getChatHistory(uid, { before, limit: CHAT_PAGE_SIZE });
      if (response.success) {
        setMessages((prev) => [...response.messages, ...prev]);
        if (response.messages.length > 0) {
          oldestChatTsRef.current = response.messages[0].timestamp;
        }
        setChatHasMore(Boolean(response.hasMore));
      }
    } catch (error) {
      // Error loading older messages
    } finally {
      setLoadingOlder(false);
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
        parsedBy: response.parsedBy,
      };

      if (response.data?.expense) {
        aiMessage.expense = {
          id: response.data.expense.id,
          merchant: response.data.expense.merchant || "Unknown",
          amount: response.data.expense.amount,
          category: response.data.expense.category,
          parsedBy: response.data.expense.parsedBy,
        };
      }

      setMessages((prev) => [...prev, aiMessage]);

      // Save AI message
      saveChatMessage(aiMessage);

      await loadExpenses(activeScope);
    } catch {
      // 失败：保留原文并标记失败态，气泡上提供一键重试
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "ai",
        content: "抱歉，处理失败了，请重试。",
        timestamp: Date.now(),
        status: "failed",
        retryInput: input,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // 失败重试：移除失败气泡后用原文重新发送
  const handleRetryMessage = (failedMessage: Message) => {
    if (!failedMessage.retryInput || isLoading) return;
    setMessages((prev) => prev.filter((m) => m.id !== failedMessage.id));
    handleSendMessage(failedMessage.retryInput);
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

  const handleVoiceMessageReceived = (message: string, expense?: VoiceExpensePayload) => {
    const aiMessage: Message = {
      id: crypto.randomUUID(),
      role: "ai",
      content: message,
      timestamp: Date.now(),
      parsedBy: expense?.parsedBy,
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
            onLoadOlder={loadOlderMessages}
            hasMoreOlder={chatHasMore}
            loadingOlder={loadingOlder}
            onRetry={handleRetryMessage}
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
                onEditExpense={setEditingExpense}
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
          className="h-full flex flex-col flex-1 min-h-0"
        >
          <TabsContent value="chat" className="flex-1 mt-0 overflow-hidden min-h-0">
            <ChatSection
              messages={messages}
              isLoading={isLoading}
              onSendMessage={handleSendMessage}
              onVoiceClick={() => setIsVoiceMode(true)}
              onLoadOlder={loadOlderMessages}
              hasMoreOlder={chatHasMore}
              loadingOlder={loadingOlder}
              onRetry={handleRetryMessage}
            />
          </TabsContent>

          <TabsContent value="expenses" className="flex-1 mt-0 overflow-hidden min-h-0">
            <ExpensesSection
              expenses={expenses}
              onDeleteExpense={handleDeleteExpense}
              onEditExpense={setEditingExpense}
            />
          </TabsContent>

          <TabsContent value="stats" className="flex-1 mt-0 overflow-hidden min-h-0">
            <StatsSection expenses={expenses} />
          </TabsContent>
        </Tabs>

        <MobileTabBar tab={mobileTab} onChange={setMobileTab} />
      </div>

      <Suspense fallback={null}>
        <VoiceMode
          isActive={isVoiceMode}
          onClose={() => setIsVoiceMode(false)}
          onMessageReceived={handleVoiceMessageReceived}
          onUserMessage={handleVoiceUserMessage}
          scopeId={activeScope}
        />
      </Suspense>

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

      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
          onSave={handleUpdateExpense}
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
