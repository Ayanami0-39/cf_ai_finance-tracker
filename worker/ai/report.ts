import { GLM_MODEL, GLM_THINKING_OFF, extractAiText, stripThinking } from './extract-ai-text';
import type { Expense } from '../types/expense';

const SYSTEM_MESSAGE =
  '你是一个家庭记账分析师。根据用户给出的月度账单数据，输出一段简洁的中文消费报告：' +
  '先用 1-2 句概括整体收支；再给出 2-3 条具体观察（最大支出分类、环比变化、值得注意的商户或收入来源）；' +
  '最后给 1 条简短可执行的建议。只用纯文本段落，不要 markdown 列表、标题和表情符号，总长 150-250 字。';

interface ReportData {
  month: string;
  totalExpense: number;
  totalIncome: number;
  balance: number;
  recordCount: number;
  prevMonthExpense: number;
  momChange: string;
  topCategories: Array<{ name: string; amount: number; share: string }>;
  topMerchants: Array<{ name: string; amount: number }>;
  incomeSources: Array<{ name: string; amount: number }>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 基于当月与上月数据生成自然语言消费报告，AI 不可用或出错时回退到模板报告 */
export async function generateMonthlyReport(
  AI: Ai | undefined,
  month: string,
  expenses: Expense[]
): Promise<string> {
  const [y, m] = month.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const inMonth = expenses.filter((e) => e.date?.slice(0, 7) === month);
  const inPrev = expenses.filter((e) => e.date?.slice(0, 7) === prevKey);

  const sumBy = (list: Expense[], type: 'expense' | 'income'): number =>
    list
      .filter((e) => (type === 'income' ? e.type === 'income' : e.type !== 'income'))
      .reduce((s, e) => s + e.amount, 0);

  const expenseTotal = sumBy(inMonth, 'expense');
  const incomeTotal = sumBy(inMonth, 'income');
  const prevExpenseTotal = sumBy(inPrev, 'expense');

  const byCategory: Record<string, number> = {};
  const byMerchant: Record<string, number> = {};
  const incomeBySource: Record<string, number> = {};
  for (const e of inMonth) {
    if (e.type === 'income') {
      const src = (e.merchant || e.description || '其他收入').trim().slice(0, 12) || '其他收入';
      incomeBySource[src] = (incomeBySource[src] || 0) + e.amount;
      continue;
    }
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const merch = (e.merchant || e.description || '其他').trim().slice(0, 12) || '其他';
    byMerchant[merch] = (byMerchant[merch] || 0) + e.amount;
  }

  const top = (obj: Record<string, number>, n: number) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  const data: ReportData = {
    month,
    totalExpense: round2(expenseTotal),
    totalIncome: round2(incomeTotal),
    balance: round2(incomeTotal - expenseTotal),
    recordCount: inMonth.length,
    prevMonthExpense: round2(prevExpenseTotal),
    momChange:
      prevExpenseTotal > 0
        ? `${(((expenseTotal - prevExpenseTotal) / prevExpenseTotal) * 100).toFixed(1)}%`
        : 'N/A（上月无数据）',
    topCategories: top(byCategory, 5).map(([name, v]) => ({
      name,
      amount: round2(v),
      share: expenseTotal > 0 ? `${((v / expenseTotal) * 100).toFixed(1)}%` : '0%',
    })),
    topMerchants: top(byMerchant, 5).map(([name, v]) => ({ name, amount: round2(v) })),
    incomeSources: top(incomeBySource, 5).map(([name, v]) => ({ name, amount: round2(v) })),
  };

  if (!AI || inMonth.length === 0) {
    return fallbackReport(month, data);
  }

  try {
    const response = await AI.run(
      GLM_MODEL as unknown as Parameters<typeof AI.run>[0],
      {
        messages: [
          { role: 'system', content: SYSTEM_MESSAGE },
          { role: 'user', content: `账单数据（JSON）：\n${JSON.stringify(data)}` },
        ],
        temperature: 0.6,
        max_tokens: 600,
        ...GLM_THINKING_OFF
      }
    ) as unknown;

    const text = stripThinking(extractAiText(response));
    if (text) return text.trim();
  } catch (error) {
    // 报表生成失败，回退模板报告
  }

  return fallbackReport(month, data);
}

function fallbackReport(month: string, d: ReportData): string {
  if (d.recordCount === 0) {
    return `${month} 还没有记账记录，暂时无法生成报告。记几笔之后再来找我总结吧。`;
  }
  const parts: string[] = [];
  parts.push(
    `${month} 共支出 ¥${d.totalExpense.toFixed(2)}（${d.recordCount} 笔），收入 ¥${d.totalIncome.toFixed(2)}，结余 ¥${d.balance.toFixed(2)}。`
  );
  if (d.momChange !== 'N/A（上月无数据）') {
    parts.push(`相比上月（¥${d.prevMonthExpense.toFixed(2)}），支出变化 ${d.momChange}。`);
  }
  if (d.topCategories.length > 0) {
    const c = d.topCategories[0];
    parts.push(`支出最大的分类是${c.name}，共 ¥${c.amount.toFixed(2)}，占 ${c.share}。`);
  }
  if (d.topMerchants.length > 0) {
    parts.push(
      `消费较多的商户有 ${d.topMerchants.slice(0, 3).map((x) => `${x.name}（¥${x.amount.toFixed(0)}）`).join('、')}。`
    );
  }
  parts.push('继续保持记账习惯，定期回顾分类占比，会让预算更健康。');
  return parts.join('');
}
