/**
 * INTENT CLASSIFICATION PROMPT
 */

export const INTENTS = {
  ADD_EXPENSE: 'ADD_EXPENSE',
  QUERY: 'QUERY',
  DELETE_EXPENSE: 'DELETE_EXPENSE',  // NEW!
  HELP: 'HELP',
  UNKNOWN: 'UNKNOWN'
} as const;

export type Intent = typeof INTENTS[keyof typeof INTENTS];

export function getIntentPrompt(input: string): string {
  return `Classify the user's intent from their input.

USER INPUT: "${input}"

INTENTS:
1. ADD_EXPENSE - User is logging/adding a new expense
   Examples:
   - "I spent $50 on coffee"
   - "Bought groceries for $120"
   - "Gas was $60"
   - "我在星巴克花了35块买拿铁"
   - "今天午饭花了三十五块五"
   - "打车去机场花了45"

2. QUERY - User is asking about their expenses/spending
   Examples:
   - "How much did I spend on food?"
   - "What's my total this week?"
   - "Show me my coffee expenses"
   - "我这个月花了多少钱"
   - "查一下我吃饭花了多少"

3. DELETE_EXPENSE - User wants to delete/remove an expense
   Examples:
   - "Delete the pizza expense"
   - "Remove the Starbucks payment"
   - "Delete that $50 coffee"
   - "Remove last expense"
   - "Delete the wrong one"
   - "删除上一笔记录"
   - "把刚才那笔星巴克删掉"

4. HELP - User needs help
   Examples:
   - "What can you do?"
   - "Help"
   - "你能做什么"

5. UNKNOWN - Cannot determine intent

RULES:
- If mentions "delete", "remove", "cancel", "undo" or 删除/去掉/撤销/删掉 → DELETE_EXPENSE
- If mentions spending/buying WITH amount or 收入/到账 keywords → ADD_EXPENSE
- If asks questions about money or 怎么花/花了多少/查 → QUERY
- Chinese input follows the same semantic rules

OUTPUT (JSON only):
{
  "intent": "DELETE_EXPENSE",
  "confidence": 0.95
}`;
}

export const INTENT_SYSTEM_MESSAGE =
  'You classify user intent accurately. Respond with JSON only.';

export const INTENT_CONFIG = {
  temperature: 0.1,
  max_tokens: 50
} as const;
