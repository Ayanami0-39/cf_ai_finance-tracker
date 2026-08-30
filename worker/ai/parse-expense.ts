import { getExpenseEntryPrompt, SYSTEM_MESSAGE, AI_CONFIG, type ExpenseCategory } from './prompts/expense-entry';

export interface ProcessedExpense {
  amount: number;
  merchant: string;
  category: ExpenseCategory | 'Income';
  type: 'expense' | 'income';
  message: string;
  success: boolean;
  error?: string;
}

export async function processExpenseInput(
  AI: Ai,
  input: string
): Promise<ProcessedExpense> {

  try {
    const userPrompt = getExpenseEntryPrompt(input);

    const response = await AI.run(
      AI_CONFIG.model,
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
      return fallbackParsing(input);
    }

    const jsonMatch = aiText.match(/\{[\s\S]*?\}/);

    if (!jsonMatch) {
      return fallbackParsing(input);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.amount || !parsed.category || !parsed.message) {
      return fallbackParsing(input);
    }

    const type: 'expense' | 'income' = parsed.type === 'income' ? 'income' : 'expense';

    return {
      amount: Number(parsed.amount),
      merchant: parsed.merchant || 'Unknown',
      category: parsed.category,
      type,
      message: parsed.message,
      success: true
    };

  } catch (error) {
    return fallbackParsing(input);
  }
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
  // Arabic numbers with optional money affixes, "50块5" → 50.5
  const arabicMatch = input.match(/(?:[$¥]|\b)\s*(\d+(?:\.\d+)?)(?:\s*(?:元|刀)|(?:\s*块(?:钱)?([05])?))?/);
  if (arabicMatch) {
    let amount = parseFloat(arabicMatch[1]);
    if (arabicMatch[2] !== undefined) {
      amount += Number(arabicMatch[2]) * 0.1; // 块X: X毛 → X*0.1元
    }
    if (amount > 0) return amount;
  }

  // Chinese numeral phrase followed by optional money suffix
  const cnMatch = input.match(/([零一二两三四五六七八九十百千万]+)(?:块([五5])|元|刀|块钱)?/);
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

  const amountText = category === 'Income' ? `+${amount.toFixed(2)}` : `${amount.toFixed(2)}`;
  return {
    amount,
    merchant,
    category,
    type: isIncome ? 'income' : 'expense',
    message: amount > 0
      ? (isIncome
        ? `记录收入 ${amountText}（${merchant}）。`
        : `已记录 ${amountText}（${merchant} · ${category}）。`)
      : '请告诉我具体金额。',
    success: amount > 0
  };
}
