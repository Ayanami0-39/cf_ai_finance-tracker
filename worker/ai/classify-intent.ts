import { GLM_MODEL, GLM_THINKING_OFF, extractAiText, stripThinking } from './extract-ai-text';
import { getIntentPrompt, INTENT_SYSTEM_MESSAGE, INTENT_CONFIG, INTENTS, type Intent } from './prompts/intent-classification';

export async function classifyIntent(
  AI: Ai | undefined,
  input: string
): Promise<Intent> {

  if (!AI) {
    return quickIntentDetection(input);
  }

  try {
    const prompt = getIntentPrompt(input);

    const response = await AI.run(
      GLM_MODEL as unknown as Parameters<typeof AI.run>[0],
      {
        messages: [
          { role: 'system', content: INTENT_SYSTEM_MESSAGE },
          { role: 'user', content: prompt }
        ],
        temperature: INTENT_CONFIG.temperature,
        max_tokens: INTENT_CONFIG.max_tokens,
        ...GLM_THINKING_OFF
      }
    ) as unknown;

    const text = stripThinking(extractAiText(response));

    // Ensure text is a string before calling .match()
    if (!text || typeof text !== 'string') {
      return quickIntentDetection(input);
    }

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.intent as Intent;
    }

  } catch {
    // Intent classification error
  }

  return quickIntentDetection(input);
}

// Quick pattern-based detection (UPDATED!)
function quickIntentDetection(input: string): Intent {
  const lower = input.toLowerCase();

  // DELETE_EXPENSE patterns (English + Chinese)
  if (/(?:delete|remove|cancel|undo|erase|get rid of)/.test(lower)) {
    return INTENTS.DELETE_EXPENSE;
  }
  if (/(删除|删掉|去掉|撤销|清除)/.test(input)) {
    return INTENTS.DELETE_EXPENSE;
  }

  // QUERY patterns (check before ADD to catch "花了多少" style questions)
  if (/(?:how much|what.*spent|show.*expense|total|sum)/i.test(lower)) {
    return INTENTS.QUERY;
  }
  if (/(花了多少|多少钱|查一下|看看.*支出|汇总|统计|总共)/.test(input)) {
    return INTENTS.QUERY;
  }

  // ADD_EXPENSE patterns (English + Chinese, including income)
  if (/(?:spent|bought|paid|purchased|cost|was|got).*\$?\d+/.test(lower)) {
    return INTENTS.ADD_EXPENSE;
  }
  if (/\$?\d+.*(?:spent|bought|paid|for|on)/.test(lower)) {
    return INTENTS.ADD_EXPENSE;
  }
  if (/(\d+(?:\.\d+)?\s*(?:块|元|刀)|花了|买了|付了|消费|到账|工资|红包|收入)/.test(input)) {
    return INTENTS.ADD_EXPENSE;
  }

  // HELP patterns
  if (/(?:help|what can|how do|commands)/i.test(lower)) {
    return INTENTS.HELP;
  }
  if (/(你能做什么|怎么用|帮助)/.test(input)) {
    return INTENTS.HELP;
  }

  return INTENTS.UNKNOWN;
}
