import { insertStatements } from './insert-statements';
import type { ChatMessage } from '../types/chat';

export async function d1GetChat(db: D1Database, scope: string): Promise<ChatMessage[]> {
  const { results } = await db.prepare(
    'SELECT record_json FROM app_chat_messages WHERE scope = ? ORDER BY timestamp ASC, id ASC'
  ).bind(scope).all<{ record_json: string }>();
  return results.map((row) => JSON.parse(row.record_json) as ChatMessage);
}

export async function d1AddChat(db: D1Database, scope: string, message: ChatMessage): Promise<void> {
  // Idempotent RPC retries must not duplicate messages or replace existing content.
  await db.prepare(
    'INSERT INTO app_chat_messages (scope, id, timestamp, record_json) VALUES (?, ?, ?, ?) ON CONFLICT (scope, id) DO NOTHING'
  ).bind(scope, message.id, message.timestamp, JSON.stringify(message)).run();
}

export async function d1ImportChat(db: D1Database, scope: string, messages: ChatMessage[]): Promise<number> {
  if (!messages.length) return 0;
  const results = await db.batch(insertStatements(db, 'app_chat_messages', ['scope', 'id', 'timestamp', 'record_json'],
    messages.map((message) => [scope, message.id, message.timestamp, JSON.stringify(message)]),
    'ON CONFLICT (scope, id) DO NOTHING'
  ));
  return results.reduce((count, result) => count + result.meta.changes, 0);
}

export async function d1ClearChat(db: D1Database, scope: string): Promise<void> {
  await db.prepare('DELETE FROM app_chat_messages WHERE scope = ?').bind(scope).run();
}

export async function d1GetChatPage(db: D1Database, scope: string, before: number | null, limit: number): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const boundedLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 20;
  const hasCursor = before !== null && Number.isFinite(before);
  const sql = `SELECT record_json FROM app_chat_messages WHERE scope = ? ${hasCursor ? 'AND timestamp < ?' : ''} ORDER BY timestamp DESC, id DESC LIMIT ?`;
  const values = hasCursor ? [scope, before, boundedLimit + 1] : [scope, boundedLimit + 1];
  const { results } = await db.prepare(sql).bind(...values).all<{ record_json: string }>();
  return {
    messages: results.slice(0, boundedLimit).reverse().map((row) => JSON.parse(row.record_json) as ChatMessage),
    hasMore: results.length > boundedLimit,
  };
}
