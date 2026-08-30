export type TrxType = 'expense' | 'income';

export interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string;
  merchant?: string;
  date: string;
  createdAt: number;
  type?: TrxType;
  by?: string;
  byId?: string;
}

export interface AddExpenseRequest {
  userId: string;
  amount: number;
  description: string;
}

export interface AddExpenseResponse {
  success: boolean;
  expense?: Expense;
  error?: string;
}
