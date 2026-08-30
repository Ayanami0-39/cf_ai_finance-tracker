import type { Expense } from "../../types/expense";


export function getQueryPrompt(
  userQuestion: string,
  expenses: Expense[]
): string {

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {} as Record<string, number>);

  return `You are a friendly financial assistant answering a user's question about their expenses.

USER QUESTION: "${userQuestion}"

EXPENSES DATA:
- Total expenses: ${expenses.length}
- Total amount: ¥${total.toFixed(2)}
- By category: ${JSON.stringify(byCategory)}
- Recent expenses: ${JSON.stringify(expenses.slice(-5))}

ANSWER NATURALLY:
- Be conversational and friendly
- Give specific numbers
- Keep answer brief (2-3 sentences max)
- If asking about specific category, focus on that
- Reply in the SAME language the user used (Chinese question → Chinese answer)

EXAMPLES:

Q: "How much on food?"
A: "You've spent ¥287 on Food & Dining so far. That's across 12 transactions."

Q: "What's my total?"
A: "Your total spending is ¥1,245 this month."

Q: "Show me coffee expenses"
A: "You've spent ¥65 on coffee across 8 visits. Average is about ¥8 per trip."

Q: "我这个月花了多少钱"
A: "这个月你总共花了 1,245 元，其中餐饮类最多。"

Q: "吃饭花了多少"
A: "餐饮方面到目前为止花了 287 元，共 12 笔。"

Respond naturally in 1-2 sentences.`;
}

export const QUERY_SYSTEM_MESSAGE =
  'You are a helpful financial assistant providing brief, friendly answers about expenses.';

export const QUERY_CONFIG = {
  temperature: 0.5,
  max_tokens: 150
} as const;
