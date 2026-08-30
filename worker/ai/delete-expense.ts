import type { Expense } from "../types/expense";
import { GLM_MODEL, GLM_THINKING_OFF, extractAiText, stripThinking } from './extract-ai-text';
import { getDeletePrompt, DELETE_SYSTEM_MESSAGE, DELETE_CONFIG } from './prompts/delete-expense';

export interface DeleteResult {
  expenseId: string | null;
  expenseIds?: string[]; // For bulk delete
  message: string;
  success: boolean;
  isBulkDelete?: boolean;
}

export async function identifyExpenseToDelete(
  AI: Ai | undefined,
  userInput: string,
  expenses: Expense[]
): Promise<DeleteResult> {

  if (expenses.length === 0) {
    return {
      expenseId: null,
      message: "You don't have any expenses to delete!",
      success: false
    };
  }

  if (!AI) {
    return fallbackDeleteIdentification(userInput, expenses);
  }

  try {
    const prompt = getDeletePrompt(userInput, expenses);

    const response = await AI.run(
      GLM_MODEL as unknown as Parameters<typeof AI.run>[0],
      {
        messages: [
          { role: 'system', content: DELETE_SYSTEM_MESSAGE },
          { role: 'user', content: prompt }
        ],
        temperature: DELETE_CONFIG.temperature,
        max_tokens: DELETE_CONFIG.max_tokens,
        ...GLM_THINKING_OFF
      }
    ) as unknown;

    const text = stripThinking(extractAiText(response));

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.expenseIndex !== null && parsed.expenseIndex >= 0) {
        const expenseIdx = parsed.expenseIndex - 1;
        const recentExpenses = expenses.slice(-10);

        if (expenseIdx >= 0 && expenseIdx < recentExpenses.length) {
          const expense = recentExpenses[expenseIdx];
          return {
            expenseId: expense.id,
            message: parsed.message || `Deleted ¥${expense.amount} ${expense.merchant} expense.`,
            success: true
          };
        }
      }

      return {
        expenseId: null,
        message: parsed.message || "Could you be more specific? Which expense?",
        success: false
      };
    }

  } catch (error) {
    // Delete identification error
  }

  return fallbackDeleteIdentification(userInput, expenses);
}

function fallbackDeleteIdentification(userInput: string, expenses: Expense[]): DeleteResult {
  const lower = userInput.toLowerCase();

  // Check for "all" keyword for bulk delete
  const isBulkDelete = /(?:all|every)/.test(lower) || /(全部|所有)/.test(userInput);

  if (/(?:last|recent|latest)/.test(lower) || /(上一笔|最近一笔|刚才那笔|最后一笔)/.test(userInput)) {
    if (!isBulkDelete) {
    const lastExpense = expenses[expenses.length - 1];
    return {
      expenseId: lastExpense.id,
      message: `Deleted your last expense: ¥${lastExpense.amount} for ${lastExpense.merchant}.`,
      success: true
    };
    }
  }

  for (const expense of expenses.reverse()) {
    const merchantLower = (expense.merchant || '').toLowerCase();
    if (merchantLower && lower.includes(merchantLower)) {
      return {
        expenseId: expense.id,
        message: `Deleted ¥${expense.amount} ${expense.merchant} expense.`,
        success: true
      };
    }
  }

  const amountMatch = userInput.match(/\$?(\d+(?:\.\d{2})?)/);
  if (amountMatch) {
    const amount = parseFloat(amountMatch[1]);

    // Bulk delete: find ALL expenses with this amount
    if (isBulkDelete) {
      const matchingExpenses = expenses.filter(e => e.amount === amount);
      if (matchingExpenses.length > 0) {
        return {
          expenseId: null,
          expenseIds: matchingExpenses.map(e => e.id),
          message: `Deleted all ${matchingExpenses.length} expense(s) of ¥${amount.toFixed(2)}.`,
          success: true,
          isBulkDelete: true
        };
      }
    } else {
      // Single delete: find first matching expense
      const matchingExpense = expenses.reverse().find(e => e.amount === amount);
      if (matchingExpense) {
        return {
          expenseId: matchingExpense.id,
          message: `Deleted ¥${amount} expense.`,
          success: true
        };
      }
    }
  }

  return {
    expenseId: null,
    message: "I couldn't find that expense. Can you be more specific?",
    success: false
  };
}
