import { getExpenseEntryPrompt, SYSTEM_MESSAGE, AI_CONFIG, type ExpenseCategory } from './prompts/expense-entry';

export interface ProcessedExpense {
  amount: number;
  merchant: string;
  category: ExpenseCategory | 'Income';
  type: 'expense' | 'income';
  date?: string;
  message: string;
  success: boolean;
  /** 解析来源：ai = AI 智能解析成功；fallback = 正则规则兜底 */
  parsedBy: 'ai' | 'fallback';
  error?: string;
}

export async function processExpenseInput(
  AI: Ai,
  input: string,
  memberName?: string
): Promise<ProcessedExpense> {

  try {
    // 注入当前日期，供 AI 推算「昨天/8月31日」等
    const today = new Date().toISOString().split('T')[0];
    const userPrompt = getExpenseEntryPrompt(input, memberName, today);

    const response = await AI.run(
      // workers-types 的 AiModels 未收录该 GA 版模型名，实际可用，断言绕过
      AI_CONFIG.model as unknown as Parameters<typeof AI.run>[0],
      {
        messages: [
          {
            role: 'system',
            content: SYSTEM_MESSAGE
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: AI_CONFIG.temperature,
        max_tokens: AI_CONFIG.max_tokens
      }
    ) as { response?: string; result?: { response?: string } } | string;

    let aiText = '';

    if (typeof response === 'string') {
      aiText = response;
    } else if (response.response) {
      aiText = response.response;
    } else if (response.result?.response) {
      aiText = response.result.response;
    }

    if (!aiText) {
      console.error('[parse-expense] AI returned empty output, fallback to regex. input:', input);
      return fallbackParsing(input);
    }

    const parsed = extractJson(aiText);

    if (!parsed) {
      console.error('[parse-expense] AI output is not valid JSON, fallback to regex. input:', input, 'aiText:', aiText.slice(0, 500));
      return fallbackParsing(input);
    }

    if (
      !parsed.amount ||
      typeof parsed.category !== 'string' ||
      typeof parsed.message !== 'string'
    ) {
      console.error('[parse-expense] AI JSON missing required fields, fallback to regex. input:', input, 'parsed:', JSON.stringify(parsed).slice(0, 500));
      return fallbackParsing(input);
    }

    const merchant = typeof parsed.merchant === 'string' ? parsed.merchant : 'Unknown';
    const category = parsed.category as ExpenseCategory | 'Income';
    const type: 'expense' | 'income' = parsed.type === 'income' ? 'income' : 'expense';

    // 日期校验：仅接受 YYYY-MM-DD，且要求输入中确有日期线索（防止小模型幻觉出日期）
    const date =
      typeof parsed.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
      DATE_CLUE_RE.test(input)
        ? parsed.date
        : undefined;

    return {
      amount: Number(parsed.amount),
      merchant,
      category,
      type,
      date,
      message: parsed.message,
      success: true,
      parsedBy: 'ai'
    };

  } catch (error) {
    console.error('[parse-expense] AI call failed, fallback to regex. input:', input, 'error:', error instanceof Error ? error.message : error);
    return fallbackParsing(input);
  }
}

// 输入中出现任一日期线索（用于抑制 AI 幻觉日期：没有日期词就不该有 date 字段）
const DATE_CLUE_RE =
  /今天|昨天|前天|大前天|\d+\s*天前|[周星期][一二三四五六日天末]|\d{4}[-/.年]|\d{1,2}\s*月|\d{1,2}\s*[日号]|\d{1,2}[-/]\d{1,2}(?!\d)/;

/** 从 AI 输出中稳健提取 JSON：兼容 markdown 代码块、前后缀文字、嵌套对象 */
function extractJson(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) candidates.push(fence[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  const short = text.match(/\{[\s\S]*?\}/);
  if (short) candidates.push(short[0]);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === 'object') return obj as Record<string, unknown>;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// Chinese numeral words → number, e.g. "三十五" → 35, "一百二" → 120, "两百五" → 250
function numeralWordsToNumber(text: string): number | null {
  const digit: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9
  };
  const unit: Record<string, number> = { '十': 10, '百': 100, '千': 1000, '万': 10000 };

  let total = 0;
  let section = 0;
  let current = 0;
  let matched = false;
  let lastUnit: '十' | '百' | '千' | '万' | null = null;

  for (const ch of text) {
    if (ch in digit) {
      current = digit[ch];
      matched = true;
    } else if (ch in unit) {
      matched = true;
      if (ch === '万') {
        section = (section + current) * 10000;
        total += section;
        section = 0;
      } else {
        if (ch === '十' && current === 0) {
          current = 1;
        }
        section += current * unit[ch];
      }
      current = 0;
      lastUnit = ch as '十' | '百' | '千' | '万';
    } else {
      return null;
    }
  }

  if (!matched) return null;

  // Colloquial: X百Y / X千Y without 十 → Y*10 ("一百二" → 120, "两百五" → 250)
  if (current > 0 && (lastUnit === '百' || lastUnit === '千')) {
    current *= 10;
  }

  return total + section + current;
}

// Extract amount supporting $, ¥, 元/块/刀 suffixes and Chinese numeral phrases
function extractAmount(input: string): number {
  // 先剥离日期/时间片段，避免「8月27号工资」的 8、27 被误当成金额
  const cleaned = input
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, ' ') // 8月27号 / 8月27日
    .replace(/\d{1,2}\s*月/g, ' ')                    // 8月
    .replace(/\d{1,2}\s*[日号]/g, ' ')                // 27号 / 27日
    .replace(/\d{4}\s*年/g, ' ')                      // 2026年
    .replace(/\d+\s*天前/g, ' ')                      // 3天前
    .replace(/\d{1,2}:\d{2}/g, ' ');                  // 时间 12:30

  // 1) 千分位数字（如 25,000 / 1,500.50）必然是金额
  const commaMatch = cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/);
  if (commaMatch) {
    const amount = parseFloat(commaMatch[0].replace(/,/g, ''));
    if (amount > 0) return amount;
  }

  // 2) Arabic numbers with optional money affixes, "50块5" → 50.5
  const arabicMatch = cleaned.match(
    /(?:[$¥]\s*)?(\d+(?:\.\d+)?)(?:\s*(?:元|刀)|(\s*块(?:钱)?([05])?))?/
  );
  if (arabicMatch) {
    let amount = parseFloat(arabicMatch[1]);
    if (arabicMatch[3] !== undefined) {
      amount += Number(arabicMatch[3]) * 0.1; // 块X: X毛 → X*0.1元
    }
    if (amount > 0) return amount;
  }

  // 3) Chinese numeral phrase followed by optional money suffix
  const cnMatch = cleaned.match(/([零一二两三四五六七八九十百千万]+)(?:块([五5])|元|刀|块钱)?/);
  if (cnMatch) {
    const value = numeralWordsToNumber(cnMatch[1]);
    if (value !== null && value > 0) {
      if (cnMatch[2] === '五' || cnMatch[2] === '5') return value + 0.5;
      return value;
    }
  }

  return 0;
}

// Chinese keyword based fallback detection for income and categories
const CN_CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ['Food & Dining', /(咖啡|餐厅|外卖|奶茶|三餐|早饭|午饭|晚饭|买菜|超市|火锅|烧烤|水果|零食|小吃)/],
  ['Transportation', /(打车|滴滴|地铁|公交|加油|停车|高铁|火车|机票|共享单车|快递|邮费)/],
  ['Shopping', /(淘宝|京东|拼多多|天猫|衣服|鞋子|数码|手机|电脑|网购|日用)/],
  ['Entertainment', /(电影|游戏|会员|演唱会|桌游|剧本杀|KTV|娱乐|爱奇艺|腾讯视频|Steam)/],
  ['Bills & Utilities', /(房租|水电|煤气|网费|话费|物业|水电费)/],
  ['Healthcare', /(医院|药店|买药|看病|挂号|体检|牙医|诊所)/],
  ['Education', /(书|课程|学费|培训|考试|教材|网课|教辅)/],
  ['Personal Care', /(理发|健身|瑜伽|美容|护肤|化妆品|洗牙)/],
  ['Travel', /(酒店|民宿|签证|旅游)/]
];

function fallbackParsing(input: string): ProcessedExpense {
  const amount = extractAmount(input);

  // Income detection (Chinese + English), income keywords take priority
  const isIncome = /(收到|到账|收入|工资|薪水|薪|红包|报销|退款|退了|奖金|利息|卖二手|卖了|涨薪|salary|received|refund|bonus)/i.test(input);

  let category: ExpenseCategory | 'Income' = 'Other';
  let merchant = 'Unknown';

  if (isIncome) {
    category = 'Income';
    const incMatch = input.match(/(工资|薪水|红包|报销|退款|奖金|利息|salary|bonus|refund)/i);
    merchant = incMatch ? incMatch[1] : '收入';
  } else {
    // Chinese keyword categories first
    for (const [cat, pattern] of CN_CATEGORY_KEYWORDS) {
      const m = input.match(pattern);
      if (m) {
        category = cat as ExpenseCategory;
        merchant = m[1];
        break;
      }
    }

    if (category === 'Other') {
      if (/(coffee|starbucks|food|lunch|dinner|breakfast|restaurant|cafe|pizza|burger|groceries)/i.test(input)) {
        category = 'Food & Dining';
      } else if (/(gas|uber|lyft|taxi|parking|metro|bus|train|flight)/i.test(input)) {
        category = 'Transportation';
      } else if (/(shop|amazon|walmart|target|store|bought|purchase|clothes)/i.test(input)) {
        category = 'Shopping';
      } else if (/(movie|netflix|spotify|game|concert)/i.test(input)) {
        category = 'Entertainment';
      } else if (/(rent|electric|water|internet|phone bill|utilit)/i.test(input)) {
        category = 'Bills & Utilities';
      } else if (/(doctor|hospital|pharmacy|medicine|medical|dental)/i.test(input)) {
        category = 'Healthcare';
      }
    }
  }

  // English merchant extraction from capitalized words
  if (merchant === 'Unknown' && !isIncome) {
    const words = input.split(/\s+/);
    const capitalizedWords = words.filter((w: string) =>
      w.length > 2 && w[0] === w[0].toUpperCase() &&
      !['I', 'A', 'The', 'On', 'At', 'In', 'For'].includes(w)
    );
    if (capitalizedWords.length > 0) {
      merchant = capitalizedWords[0];
    }
  }

  const amountText = category === 'Income' ? `+¥${amount.toFixed(2)}` : `¥${amount.toFixed(2)}`;
  return {
    amount,
    merchant,
    category,
    type: isIncome ? 'income' : 'expense',
    date: extractDate(input),
    message: amount > 0
      ? (isIncome
        ? `记录收入 ${amountText}（${merchant}）。`
        : `已记录 ${amountText}（${merchant} · ${category}）。`)
      : '请告诉我具体金额。',
    success: amount > 0,
    parsedBy: 'fallback'
  };
}

// Date extraction: absolute dates (8月31日/8-31/2026-08-31) + relative dates (今天/昨天/前天)
export function extractDate(input: string): string | undefined {
  const today = new Date();

  // Relative dates
  if (/今天|today/i.test(input)) return toLocalDateStr(today);
  if (/昨天|yesterday/i.test(input)) {
    today.setDate(today.getDate() - 1);
    return toLocalDateStr(today);
  }
  if (/前天/i.test(input)) {
    today.setDate(today.getDate() - 2);
    return toLocalDateStr(today);
  }

  // 2026-08-31 / 2026/8/31
  const fullMatch = input.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (fullMatch) {
    return buildDateStr(Number(fullMatch[1]), Number(fullMatch[2]), Number(fullMatch[3]));
  }

  // 8月31日 / 8月31号 / 8-31 / 8/31（年份取当前或 12 月时回退一年）
  // 注意：裸月日不再接受 "." 分隔（避免「晚饭 11.8」的金额小数点被当成 11月8日）；
  // "2025.11.8" 这类完整三段式日期仍由上面的 fullMatch（[-/.]）覆盖
  const monthDay = input.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
    || input.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?!\d)/);
  if (monthDay) {
    const year = monthDay[1] ? Number(monthDay[1]) : undefined;
    return buildDateStr(year, Number(monthDay[2]), Number(monthDay[3]));
  }

  // X 天前
  const daysAgo = input.match(/(\d+)\s*天前/);
  if (daysAgo) {
    today.setDate(today.getDate() - Number(daysAgo[1]));
    return toLocalDateStr(today);
  }

  return undefined;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildDateStr(y: number | undefined, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  let year = y ?? new Date().getFullYear();
  const dt = new Date(year, m - 1, d);
  if (dt.getFullYear() !== year || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return undefined; // 无效日期（如 2月30日）
  }
  // 未指定年份且日期在今天之后 → 视为去年（如 1 月说「12月31日」）
  if (!y && dt.getTime() > Date.now()) {
    year -= 1;
  }
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
