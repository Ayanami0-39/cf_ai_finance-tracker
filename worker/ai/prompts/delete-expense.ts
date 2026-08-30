import type { Expense } from "../../types/expense";

export function getDeletePrompt(
  userInput: string,
  expenses: Expense[]
): string {

  const recentExpenses = expenses.slice(-10).map((e, idx) =>
    `${idx + 1}. ¥${e.amount} - ${e.merchant} (${e.category}) on ${e.date}`
  ).join('\n');

  return `User wants to delete an expense. Identify which one.

USER SAID: "${userInput}"

RECENT EXPENSES:
${recentExpenses}

RULES:
- Match by merchant name (e.g., "pizza" → expense with merchant "Pizza")
- Match by amount (e.g., "¥50" → expense with amount 50)
- Match by category (e.g., "food expense" → Food & Dining category)
- If says "last" or "recent" or 上一笔/最近一笔 → pick most recent (highest index)
- Chinese input: 刚才那笔/那笔XX/45块的那笔 → match by merchant, amount or recency
- If unclear, return expenseIndex: null

OUTPUT (JSON only):
{
  "expenseIndex": 5,
  "confidence": 0.9,
  "message": "Deleted ¥12 Pizza Hut expense."
}

If can't determine which expense:
{
  "expenseIndex": null,
  "confidence": 0,
  "message": "Which expense do you want to delete? I found multiple."
}`;
}

export const DELETE_SYSTEM_MESSAGE =
  'You help identify which expense to delete based on user description.';

export const DELETE_CONFIG = {
  temperature: 0.2,
  max_tokens: 100
} as const;
