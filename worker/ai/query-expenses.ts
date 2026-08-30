import { getQueryPrompt, QUERY_SYSTEM_MESSAGE, QUERY_CONFIG } from './prompts/query-expenses';
import type { Expense } from '../types/expense';

export async function queryExpenses(
  AI: Ai | undefined,
  question: string,
  expenses: Expense[]
): Promise<string> {

  if (expenses.length === 0) {
    return fallbackQueryResponse(question, expenses);
  }

  if (!AI) {
    return fallbackQueryResponse(question, expenses);
  }

  try {
    const prompt = getQueryPrompt(question, expenses);

    const response = await AI.run(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      {
        messages: [
          { role: 'system', content: QUERY_SYSTEM_MESSAGE },
          { role: 'user', content: prompt }
        ],
        temperature: QUERY_CONFIG.temperature,
        max_tokens: QUERY_CONFIG.max_tokens
      }
    ) as { response?: string } | string;

    let text = '';
    if (typeof response === 'string') {
      text = response;
    } else if (response.response) {
      text = response.response;
    }

    if (text) {
      return text.trim();
    }

  } catch (error) {
    // Query error
  }

  return fallbackQueryResponse(question, expenses);
}

function fallbackQueryResponse(question: string, expenses: Expense[]): string {
  if (expenses.length === 0) {
    return /(花了|多少钱|支出|查|汇总)/.test(question)
      ? "你还没有记账记录！试着说「我花了 50 块买咖啡」开始记账吧。"
      : "You haven't logged any expenses yet! Start by saying 'I spent $X on something'.";
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const count = expenses.length;

  const lower = question.toLowerCase();
  const isChinese = /(花了|多少钱|支出|查|汇总|总共)/.test(question);

  if (lower.includes('total') || /(总共|汇总|一共)/.test(question)) {
    return isChinese
      ? `你目前共有 ${count} 笔记录，总计 ${total.toFixed(2)} 元。`
      : `Your total spending is $${total.toFixed(2)} across ${count} expenses.`;
  }

  if (lower.includes('food') || /(吃|饭|餐饮)/.test(question)) {
    const food = expenses.filter(e => e.category === 'Food & Dining');
    const foodTotal = food.reduce((sum, e) => sum + e.amount, 0);
    return isChinese
      ? `餐饮方面你花了 ${foodTotal.toFixed(2)} 元。`
      : `You've spent $${foodTotal.toFixed(2)} on Food & Dining.`;
  }

  return isChinese
    ? `你共有 ${count} 笔记录，总计 ${total.toFixed(2)} 元。`
    : `You have ${count} expenses totaling $${total.toFixed(2)}.`;
}
