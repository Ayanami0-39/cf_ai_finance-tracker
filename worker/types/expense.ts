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
