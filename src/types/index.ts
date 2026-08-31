export interface Expense {
  id: string;
  amount: number;
  category: string;
  merchant?: string;
  description: string;
  date: string;
  createdAt: number;
  type?: 'expense' | 'income';
  by?: string;
  byId?: string;
  /** 记录来源：ai = AI 智能解析，fallback = 规则兜底 */
  parsedBy?: 'ai' | 'fallback';
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  by?: string;
  byId?: string;
  /** AI 消息来源：ai = AI 智能解析，fallback = 规则兜底（决定气泡角标显示 🤖 还是 💻） */
  parsedBy?: 'ai' | 'fallback';
  /** 发送状态：failed = 处理失败（仅本地态，不持久化到服务端） */
  status?: 'ok' | 'failed';
  /** 失败消息附带的原始输入，用于一键重试（不持久化） */
  retryInput?: string;
  expense?: {
    id?: string;
    merchant: string;
    amount: number;
    category: string;
    parsedBy?: 'ai' | 'fallback';
  };
  timestamp: number;
}

export interface VoiceCommandResponse {
  success: boolean;
  message: string;
  parsedBy?: 'ai' | 'fallback';
  data?: {
    expense?: Expense;
    count?: number;
  };
}

export interface ExpenseResponse {
  success: boolean;
  expenses: Expense[];
  count: number;
}

export interface ChatResponse {
  success: boolean;
  messages: Message[];
  count: number;
  /** 分页加载：是否还有更早的消息 */
  hasMore?: boolean;
}
