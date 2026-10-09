import type { FinanceMemory } from '../durable-objects/FinanceMemory';
import type { UserRegistry } from '../durable-objects/UserRegistry';

export interface Env {
  AI: Ai;
  "DEEPSEEK-API-KEY"?: string;
  FINANCE_MEMORY: DurableObjectNamespace<FinanceMemory>;
  USER_REGISTRY: DurableObjectNamespace<UserRegistry>;
  DB: D1Database;
  AUTH_PASSWORD?: string;
  STORAGE_MIGRATION_TOKEN?: string;
  APP_STORAGE_MODE?: 'legacy' | 'migration' | 'd1';
  ASSETS: Fetcher;
}
