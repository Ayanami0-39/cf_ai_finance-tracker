import type { AccountRecord, FamilyRecord, RegistryStorage } from './registry-operations';

const tables = {
  accounts: { table: 'app_user_accounts', key: 'username_key', value: 'record_json', json: true },
  families: { table: 'app_families', key: 'code', value: 'record_json', json: true },
  membership: { table: 'app_family_memberships', key: 'username_key', value: 'family_code', json: false },
} as const;

type RegistryKey = keyof typeof tables;

/** Per-operation snapshot. Only changed records are written; all changes commit in one D1 transaction. */
export class D1RegistryStorage implements RegistryStorage {
  private original: Record<RegistryKey, Record<string, unknown>> = { accounts: {}, families: {}, membership: {} };
  private pending = new Map<RegistryKey, Record<string, unknown>>();

  private db: D1Database;

  constructor(db: D1Database) { this.db = db; }

  async load(): Promise<void> {
    const keys = Object.keys(tables) as RegistryKey[];
    const results = await this.db.batch<Record<string, unknown>>(
      keys.map((key) => this.db.prepare(`SELECT * FROM ${tables[key].table}`))
    );
    keys.forEach((key, index) => {
      const spec = tables[key];
      this.original[key] = Object.fromEntries(results[index].results.map((row) => [
        String(row[spec.key]), spec.json ? JSON.parse(String(row[spec.value])) : row[spec.value],
      ]));
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!(key in tables)) throw new Error('Unknown registry key');
    return structuredClone(this.pending.get(key as RegistryKey) ?? this.original[key as RegistryKey]) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    if (!(key in tables)) throw new Error('Unknown registry key');
    this.pending.set(key as RegistryKey, structuredClone(value) as Record<string, unknown>);
  }

  async commit(): Promise<void> {
    const statements: D1PreparedStatement[] = [];
    for (const [key, next] of this.pending) {
      const previous = this.original[key];
      const spec = tables[key];
      for (const [id, value] of Object.entries(next)) {
        if (JSON.stringify(previous[id]) === JSON.stringify(value)) continue;
        statements.push(this.db.prepare(
          `INSERT INTO ${spec.table} (${spec.key}, ${spec.value}) VALUES (?, ?)
           ON CONFLICT (${spec.key}) DO UPDATE SET ${spec.value} = excluded.${spec.value}`
        ).bind(id, spec.json ? JSON.stringify(value) : value));
      }
      for (const id of Object.keys(previous)) {
        if (!Object.hasOwn(next, id)) {
          statements.push(this.db.prepare(`DELETE FROM ${spec.table} WHERE ${spec.key} = ?`).bind(id));
        }
      }
    }
    if (statements.length) await this.db.batch(statements);
  }
}

export interface RegistrySnapshot {
  accounts: Record<string, AccountRecord>;
  families: Record<string, FamilyRecord>;
  membership: Record<string, string>;
}
