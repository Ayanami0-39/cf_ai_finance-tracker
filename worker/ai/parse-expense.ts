import { getExpenseEntryPrompt, SYSTEM_MESSAGE, AI_CONFIG, EXPENSE_CATEGORIES, type ExpenseCategory } from './prompts/expense-entry';
import { extractAiText, stripThinking } from './extract-ai-text';

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
        max_tokens: AI_CONFIG.max_tokens,
        ...AI_CONFIG.params
      }
    ) as Record<string, unknown>;

    const aiText = stripThinking(extractAiText(response));

    if (!aiText) {
      console.error('[parse-expense] AI returned empty output, fallback to regex. input:', input, 'rawResponse:', JSON.stringify(response).slice(0, 500));
      return fallbackParsing(input);
    }

    const parsed = extractJson(aiText);

    if (!parsed) {
      console.error('[parse-expense] AI output is not valid JSON, fallback to regex. input:', input, 'aiText:', aiText.slice(0, 500));
      return fallbackParsing(input);
    }

    if (!isValidExpenseJson(parsed)) {
      console.error('[parse-expense] AI JSON missing required fields or invalid category, fallback to regex. input:', input, 'parsed:', JSON.stringify(parsed).slice(0, 500));
      return fallbackParsing(input);
    }

    const merchant = typeof parsed.merchant === 'string' ? parsed.merchant : 'Unknown';
    const category = parsed.category as ExpenseCategory | 'Income';
    const type: 'expense' | 'income' = parsed.type === 'income' ? 'income' : 'expense';

    // 日期校验：仅接受 YYYY-MM-DD，且要求输入中确有日期线索（防止小模型幻觉出日期）
    // AI 漏填 date 但输入确有日期线索时，用正则 extractDate 从原文兜底提取，避免静默记成今天
    let date: string | undefined;
    const hasDateClue = DATE_CLUE_RE.test(input);
    if (typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) && hasDateClue) {
      date = parsed.date;
    } else if (!date && hasDateClue) {
      date = extractDate(input);
      if (date) {
        console.warn('[parse-expense] AI omitted date, recovered from input via extractDate:', input, '->', date);
      }
    }

    return {
      amount: Number(parsed.amount),
      merchant,
      category,
      type,
      date,
      // 确认文案由本地模板生成：8B 小模型中文生成不稳定（曾出现乱码），不再采用 AI 文案
      message: buildTemplateMessage(Number(parsed.amount), merchant, type, date),
      success: true,
      parsedBy: 'ai'
    };

  } catch (error) {
    console.error('[parse-expense] AI call failed, fallback to regex. input:', input, 'error:', error instanceof Error ? error.message : error);
    return fallbackParsing(input);
  }
}

/**
 * 本地模板生成确认文案（替代 AI 生成文案）：
 * 8B 级小模型中文生成不稳定，曾出现「很期 11.8 元币存计。」类乱码；
 * 确认语本质是固定信息（金额/商家/日期），模板生成 100% 可靠。
 */
function buildTemplateMessage(
  amount: number,
  merchant: string,
  type: 'expense' | 'income',
  date?: string
): string {
  const today = new Date().toISOString().split('T')[0];
  let prefix = '';
  if (date && date !== today) {
    const [, m, d] = date.split('-');
    prefix = `${Number(m)}月${Number(d)}日 `;
  }

  // 金额显示：整数不带小数，小数最多两位
  const amt = Number(amount.toFixed(2)).toString();
  const amtText = type === 'income' ? `+¥${amt}` : `¥${amt}`;

  const templates = type === 'income'
    ? [
        `已入账：${prefix}${merchant} ${amtText}`,
        `${prefix}${merchant} ${amtText} 到账，记好啦`,
        `收到，${prefix}${merchant} ${amtText} 已入账`
      ]
    : [
        `已记录：${prefix}${merchant} ${amtText}`,
        `${prefix}${merchant} ${amtText} 记好啦`,
        `收到，${prefix}${merchant} ${amtText} 已记下`
      ];

  return templates[Math.floor(Math.random() * templates.length)];
}

// 输入中出现任一日期线索（用于抑制 AI 幻觉日期：没有日期词就不该有 date 字段）
const DATE_CLUE_RE =
  /今天|昨天|前天|大前天|\d+\s*天前|[周星期][一二三四五六日天末]|\d{4}[-/.年]|\d{1,2}\s*月|\d{1,2}\s*[日号]|\d{1,2}[-/]\d{1,2}(?!\d)/;

/** 从 AI 输出中稳健提取 JSON：兼容 markdown 代码块、前后缀文字、嵌套对象、截断输出修复 */
function extractJson(text: string): Record<string, unknown> | null {
  // GLM-4.7-Flash 为 reasoning 模型：先剥离 ɛtoken 与含 think 字样的思考段落，
  // 避免「<}」类思考内容干扰后续的大括号配对扫描
  let cleaned = text
    .replace(/ɛ[\s\S]*?ɛ/g, ' ')
    .replace(/ɛ/g, ' ');

  const candidates: string[] = [];

  // 剥离 markdown 代码块围栏（```json ... ``` / ``` ... ```）
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) candidates.push(fence[1].trim());

  // 完整对象：第一个 { 到最后一个 }（前后有说明文字也能取出）
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(cleaned.slice(first, last + 1));

  // 逐层截取：从每个 { 起，按大括号配对截取，兼容嵌套对象被外层文字干扰的情况
  let pos = cleaned.indexOf('{');
  while (pos !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = pos; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(pos, i + 1));
          break;
        }
      }
    }
    pos = text.indexOf('{', pos + 1);
  }

  // 截断修复：JSON 被 max_tokens 截断时缺右括号/引号，尝试补全
  const truncStart = cleaned.indexOf('{');
  if (truncStart !== -1 && truncStart < cleaned.length - 1) {
    let t = cleaned.slice(truncStart).trim();
    // 去掉残缺的尾部（未闭合的键名前缀、悬空逗号）
    t = t.replace(/,\s*"[^"]*"?\s*:?\s*$/, '').replace(/,\s*$/, '');
    if (!t.endsWith('}')) {
      // 未闭合的字符串先补引号
      const quotes = (t.match(/"/g) || []).length;
      if (quotes % 2 === 1) t += '"';
      // 尾部若为 "key": 悬空，去掉
      t = t.replace(/"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '');
      t += '}';
    }
    candidates.push(t);
  }

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

/** 校验提取结果是否为有效的记账对象（字段类型 + 类目白名单），防小模型幻觉字段 */
function isValidExpenseJson(parsed: Record<string, unknown>): boolean {
  // message 已改为本地模板生成，AI 只需返回结构化字段
  if (!parsed.amount || typeof parsed.category !== 'string') {
    return false;
  }
  const category = parsed.category;
  return category === 'Income' || (EXPENSE_CATEGORIES as readonly string[]).includes(category);
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

  const type: 'expense' | 'income' = isIncome ? 'income' : 'expense';
  const date = extractDate(input);
  return {
    amount,
    merchant,
    category,
    type,
    date,
    message: amount > 0
      ? buildTemplateMessage(amount, merchant, type, date)
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
