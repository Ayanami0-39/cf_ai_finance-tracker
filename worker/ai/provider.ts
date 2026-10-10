import type { Env } from '../types/env';
import { GLM_MODEL } from './extract-ai-text';

type ChatRequest = {
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
};
type Completion = {
  choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
};

/** Adapt the verified DeepSeek endpoint to the deployed app's existing AI.run contract. */
export function financeAI(env: Env): Ai {
  const key = env['DEEPSEEK-API-KEY'];
  if (env.AI_PROVIDER !== 'deepseek' || !key) return env.AI;
  const original = env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> };
  const run = async (model: string, options: ChatRequest) => {
    if (model !== GLM_MODEL) return original.run(model, options);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let status = 0;
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-flash',
          messages: options.messages,
          max_tokens: Math.min(options.max_tokens || 300, 600),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          thinking: { type: 'disabled' },
          stream: false,
        }),
        signal: controller.signal,
      });
      status = response.status;
      if (!response.ok) throw new Error('DeepSeek request failed');
      const result = await response.json() as Completion;
      const choice = result.choices?.[0];
      if (!choice?.message?.content?.trim() || choice.finish_reason === 'length') {
        throw new Error('DeepSeek returned an incomplete response');
      }
      return { response: choice.message.content };
    } catch {
      // Existing callers supply local parsing/report fallbacks. Never expose response
      // bodies, request content or credentials, or add a second slow provider request.
      throw new Error('AI request unavailable');
    } finally {
      clearTimeout(timer);
      console.info('[finance-ai]', JSON.stringify({ provider: 'deepseek', model: 'deepseek-flash', durationMs: Date.now() - startedAt, status }));
    }
  };
  return { run } as unknown as Ai;
}
