import { insertStatements } from './insert-statements';
import type { ChatMessage } from '../types/chat';
import type { RegistrySnapshot } from './registry';

export async function readLegacyStorage(storage: DurableObjectStorage): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  let startAfter: string | undefined;
  for (;;) {
    const page = await storage.list<unknown>({ limit: 1000, ...(startAfter ? { startAfter } : {}) });
    for (const entry of page) result.set(...entry);
    if (page.size < 1000) return result;
    startAfter = [...page.keys()].at(-1);
  }
}

export async function migrationComplete(db: D1Database, key: string): Promise<boolean> {
  return !!await db.prepare('SELECT migration_key FROM app_storage_migrations WHERE migration_key = ?').bind(key).first();
}

function archive(db: D1Database, objectId: string, scope: string | null, source: Map<string, unknown>): D1PreparedStatement[] {
  const now = Date.now();
  return [db.prepare(
    'INSERT INTO app_legacy_objects (object_id, scope) VALUES (?, ?) ON CONFLICT (object_id) DO UPDATE SET scope = COALESCE(app_legacy_objects.scope, excluded.scope)'
  ).bind(objectId, scope), ...insertStatements(
    db, 'app_legacy_snapshots', ['object_id', 'key', 'scope', 'value_json', 'captured_at'],
    [...source].map(([key, value]) => [objectId, key, scope, JSON.stringify(value), now]),
    'ON CONFLICT (object_id, key) DO NOTHING'
  )];
}

function marker(db: D1Database, key: string, count: number): D1PreparedStatement {
  return db.prepare('INSERT INTO app_storage_migrations (migration_key, completed_at, source_count) VALUES (?, ?, ?)')
    .bind(key, Date.now(), count);
}

/** A single atomic batch: conflicts or failures roll everything back; never overwrite D1 accounts. */
export async function migrateRegistry(db: D1Database, objectId: string, source: Map<string, unknown>): Promise<void> {
  const key = 'registry-v1';
  if (await migrationComplete(db, key)) return;
  const snapshot: RegistrySnapshot = {
    accounts: (source.get('accounts') as RegistrySnapshot['accounts']) ?? {},
    families: (source.get('families') as RegistrySnapshot['families']) ?? {},
    membership: (source.get('membership') as RegistrySnapshot['membership']) ?? {},
  };
  const statements = archive(db, objectId, null, source);
  statements.push(...insertStatements(db, 'app_user_accounts', ['username_key', 'record_json'],
    Object.entries(snapshot.accounts).map(([username, account]) => [username, JSON.stringify(account)])));
  statements.push(...insertStatements(db, 'app_families', ['code', 'record_json'],
    Object.entries(snapshot.families).map(([code, family]) => [code, JSON.stringify(family)])));
  statements.push(...insertStatements(db, 'app_family_memberships', ['username_key', 'family_code'],
    Object.entries(snapshot.membership)));
  statements.push(marker(db, key, source.size));
  await db.batch(statements);
}

/** Preserve every legacy key and import chats once. Existing D1 expenses are deliberately untouched. */
export async function migrateFinanceScope(db: D1Database, objectId: string, scope: string, source: Map<string, unknown>): Promise<void> {
  const key = `finance-v1:${objectId}`;
  if (await migrationComplete(db, key)) return;
  const statements = archive(db, objectId, scope, source);
  const messages = (source.get('chatMessages') as ChatMessage[] | undefined) ?? [];
  statements.push(...insertStatements(db, 'app_chat_messages', ['scope', 'id', 'timestamp', 'record_json'],
    messages.map((message) => [scope, message.id, message.timestamp, JSON.stringify(message)])));
  statements.push(...insertStatements(db, 'app_scope_metadata', ['scope', 'key', 'value_json'],
    [...source].filter(([name]) => name !== 'chatMessages' && name !== 'expenses')
      .map(([name, value]) => [scope, name, JSON.stringify(value)])));
  statements.push(marker(db, key, source.size));
  await db.batch(statements);
}

export async function archiveLegacyObject(db: D1Database, objectId: string, source: Map<string, unknown>): Promise<void> {
  const key = `archive-v1:${objectId}`;
  if (await migrationComplete(db, key)) return;
  await db.batch([...archive(db, objectId, null, source), marker(db, key, source.size)]);
}

/** Compare snapshots inside the Worker; never return credentials or source values. */
export async function verifyLegacyArchive(db: D1Database, objectId: string, storage: DurableObjectStorage): Promise<boolean> {
  const source = await readLegacyStorage(storage);
  const { results } = await db.prepare('SELECT key, value_json FROM app_legacy_snapshots WHERE object_id = ?')
    .bind(objectId).all<{ key: string; value_json: string }>();
  return results.length === source.size && results.every((row) =>
    source.has(row.key) && JSON.stringify(source.get(row.key)) === row.value_json);
}
