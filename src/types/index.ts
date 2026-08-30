export interface Expense {
  id: string;
  amount: number;
  category: string;
  merchant?: string;
  description: string;
  date: string;
  createdAt: number;
  type?: 'expense' | 'income';
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  expense?: {
    merchant: string;
    amount: number;
    category: string;
  };
  timestamp: number;
}

export interface VoiceCommandResponse {
  success: boolean;
  message: string;
  data?: {
    expense?: Expense;
    count?: number;
  };
}export interface ExpenseResponse {
  success: boolean;
  expenses: Expense[];
  count: number;
}

export interface ChatResponse {
  success: boolean;
  messages: Message[];
  count: number;
}
