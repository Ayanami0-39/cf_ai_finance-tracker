/**
 * Workers AI 响应文本提取与 GLM 思考剥离的公共工具。
 * 全部 AI 调用点统一使用 @cf/zai-org/glm-4.7-flash（reasoning 模型）。
 */

/** 全部 AI 调用统一使用的模型 */
export const GLM_MODEL = '@cf/zai-org/glm-4.7-flash';

/** GLM-4.7-Flash（reasoning 模型）通用调用参数：关闭思考以降低延迟、避免思考内容混入输出 */
export const GLM_THINKING_OFF = {
  chat_template_kwargs: {
    enable_thinking: false,
    clear_thinking: true
  }
} as const;

/** 剥离 GLM reasoning 模型可能混出的思考片段（ɛ...ɛ 及残留 ɛ 标记） */
export function stripThinking(text: string): string {
  return text.replace(/ɛ[\s\S]*?ɛ/g, ' ').replace(/ɛ/g, ' ');
}

/**
 * 从 Workers AI 响应中稳健提取文本，兼容多种返回形态：
 * 1. string：旧版直接返回文本
 * 2. { response: string }：Workers AI 常规格式
 * 3. { result: { response: string } }：部分模型包装格式
 * 4. { choices: [{ message: { content: string } }] }：OpenAI 兼容格式
 * 5. { candidates: [{ content: { parts: [{ text }] } }] }：Gemini 兼容格式
 */
export function extractAiText(response: unknown): string {
  if (typeof response === 'string') return response;

  const r = response as Record<string, unknown>;
  if (!r || typeof r !== 'object') return '';

  if (typeof r.response === 'string') return r.response;

  if (
    typeof r.result === 'object' && r.result !== null &&
    typeof (r.result as Record<string, unknown>).response === 'string'
  ) {
    return (r.result as Record<string, unknown>).response as string;
  }

  if (Array.isArray(r.choices) && r.choices.length > 0) {
    const message = (r.choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string') return message.content;
  }

  if (Array.isArray(r.candidates) && r.candidates.length > 0) {
    const content = (r.candidates[0] as Record<string, unknown>).content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      const texts = parts
        .map((p) => (typeof (p as Record<string, unknown>).text === 'string' ? ((p as Record<string, unknown>).text as string) : ''))
        .filter(Boolean);
      if (texts.length > 0) return texts.join('');
    }
  }

  return '';
}
