export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: number;
  scopeId?: string;
  clientMutationId?: string;
  requestId?: string;
  attemptNo?: number;
  replyTo?: string;
  legacyCommand?: boolean;
  updatedAt?: number;
  needsReview?: boolean;
  by?: string;
  byId?: string;
  /** AI 消息来源：ai = AI 智能解析，fallback = 规则兜底 */
  parsedBy?: 'ai' | 'fallback';
  expense?: {
    id: string;
    amount: number;
    category: string;
    merchant: string;
    parsedBy?: 'ai' | 'fallback';
  };
}
