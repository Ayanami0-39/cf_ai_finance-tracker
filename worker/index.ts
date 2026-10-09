import { Hono } from 'hono';
import liveWorker from './recovered/live-backend.mjs';
import { deriveToken } from './auth';
import { financeAI } from './ai/provider';
import type { Env } from './types/env';
import { FinanceMemory } from './durable-objects/FinanceMemory';
import { UserRegistry } from './durable-objects/UserRegistry';
import { migrationComplete } from './db/legacy-migration';
import { uiAssets, uiHtml } from './generated/ui-assets';

export { FinanceMemory, UserRegistry };

async function ensureScopeMigrated(env: Env, scope: string): Promise<void> {
  const id = env.FINANCE_MEMORY.idFromName(scope);
  if (await migrationComplete(env.DB, `finance-v1:${id.toString()}`)) return;
  await env.FINANCE_MEMORY.get(id).migrateToD1(scope);
}

function registryStub(c: { env: Env }) {
  return c.env.USER_REGISTRY.get(c.env.USER_REGISTRY.idFromName('global'));
}

/** Carry explicit scope names across RPCs; persisted mappings let alarms recover them after restarts. */
function runtimeEnv(env: Env): Env {
  const namespace = env.FINANCE_MEMORY;
  const bound = new Proxy(namespace, {
    get(target, property) {
      if (property !== 'get') {
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (id: DurableObjectId, options?: Parameters<Env['FINANCE_MEMORY']['get']>[1]) => {
        const stub = target.get(id, options);
        if (!id.name) return stub;
        return new Proxy(stub, {
          get(object, key) {
            const value = Reflect.get(object, key);
            if (typeof value !== 'function' || key === 'bindScope') return value;
            return async (...args: unknown[]) => {
              await object.bindScope(id.name!);
              // RPC methods are callable proxies: `.apply` would itself be a remote
              // method call and try to serialize the Durable Object stub.
              return (object as unknown as Record<PropertyKey, (...parameters: unknown[]) => unknown>)[key](...args);
            };
          },
        });
      };
    },
  });
  const assets = env.ASSETS && new Proxy(env.ASSETS, {
    get(target, property) {
      if (property !== 'fetch') {
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (input: Request | string | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const path = new URL(request.url).pathname;
        const asset = uiAssets[path];
        if (asset) return new Response(request.method === 'HEAD' ? null : asset.body, {
          headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
        });
        const response = await target.fetch(request);
        if (response.status === 200 && response.headers.get('Content-Type')?.includes('text/html')) {
          const headers = new Headers(response.headers);
          headers.delete('Content-Length');
          headers.delete('Content-Encoding');
          headers.delete('ETag');
          headers.set('Cache-Control', 'no-store');
          return new Response(request.method === 'HEAD' ? null : uiHtml, { status: response.status, headers });
        }
        return response;
      };
    },
  });
  return { ...env, AI: financeAI(env), FINANCE_MEMORY: bound, ASSETS: assets };
}

const admin = new Hono<{ Bindings: Env }>();
admin.use('/*', async (c, next) => {
  const expected = c.env.STORAGE_MIGRATION_TOKEN;
  const provided = c.req.header('X-Storage-Migration-Token');
  if (!expected) return c.json({ success: false, error: 'Storage migration is not configured' }, 503);
  if (!provided || await deriveToken(provided) !== await deriveToken(expected)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  await next();
});

// Read-only recovery of the deployed frontend, unavailable without the temporary
// administrator secret. Never forwards credentials to an asset response.
admin.get('/api/admin/storage-migration/assets', async (c) => {
  const path = c.req.query('path') || '/';
  if (path !== '/' && !/^\/(?:assets\/[a-zA-Z0-9_.-]+|manifest\.webmanifest|icon\.png)$/.test(path)) {
    return c.json({ success: false, error: 'Invalid asset path' }, 400);
  }
  const response = await c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
});

admin.get('/api/admin/storage-migration', async (c) => {
  const results = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare('SELECT record_json FROM app_user_accounts'),
    c.env.DB.prepare('SELECT record_json FROM app_families'),
    c.env.DB.prepare('SELECT DISTINCT scope FROM expenses'),
    c.env.DB.prepare('SELECT migration_key, completed_at, source_count FROM app_storage_migrations'),
    c.env.DB.prepare('SELECT object_id, scope FROM app_legacy_objects'),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM app_chat_messages'),
  ]);
  const scopes = new Set<string>(results[2].results.map((row) => String(row.scope)));
  for (const result of results.slice(0, 2)) {
    for (const row of result.results) scopes.add((JSON.parse(String(row.record_json)) as { scopeId: string }).scopeId);
  }
  return c.json({
    success: true,
    accounts: results[0].results.length,
    families: results[1].results.length,
    chatMessages: results[5].results[0].count,
    scopes: [...scopes],
    migrations: results[3].results,
    objects: results[4].results,
  });
});

admin.post('/api/admin/storage-migration', async (c) => {
  try {
    const body = await c.req.json<{ action?: string; scope?: string; objectId?: string }>();
    if (body.action === 'registry') {
      const scopes = await registryStub(c).migrationScopes();
      return c.json({ success: true, scopes });
    }
    if (body.action === 'scope' && typeof body.scope === 'string' && body.scope.length > 0 && body.scope.length <= 256) {
      await ensureScopeMigrated(c.env, body.scope);
      return c.json({ success: true });
    }
    if (body.action === 'archive-registry' && typeof body.objectId === 'string' && /^[a-f0-9]{64}$/i.test(body.objectId)) {
      const id = c.env.USER_REGISTRY.idFromString(body.objectId);
      await c.env.USER_REGISTRY.get(id).archiveToD1();
      return c.json({ success: true });
    }
    if (body.action === 'archive' && typeof body.objectId === 'string' && /^[a-f0-9]{64}$/i.test(body.objectId)) {
      const id = c.env.FINANCE_MEMORY.idFromString(body.objectId);
      await c.env.FINANCE_MEMORY.get(id).archiveToD1();
      return c.json({ success: true });
    }
    if ((body.action === 'verify-registry' || body.action === 'verify-finance') && typeof body.objectId === 'string' && /^[a-f0-9]{64}$/i.test(body.objectId)) {
      const namespace = body.action === 'verify-registry' ? c.env.USER_REGISTRY : c.env.FINANCE_MEMORY;
      const unchanged = await namespace.get(namespace.idFromString(body.objectId)).verifyArchive();
      return c.json({ success: true, unchanged });
    }
    return c.json({ success: false, error: 'Invalid migration action' }, 400);
  } catch {
    // Do not expose SQL bindings, password hashes, or legacy payloads in errors.
    return c.json({ success: false, error: 'Migration failed; original storage is unchanged. Check Worker logs.' }, 500);
  }
});


export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/admin/storage-migration' || pathname === '/api/admin/storage-migration/assets') return admin.fetch(request, env, ctx);
    if (env.APP_STORAGE_MODE === 'migration' && pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ success: false, error: 'Temporarily unavailable. Please try again shortly.' }), {
        status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '30', 'Cache-Control': 'no-store' },
      });
    }
    return liveWorker.fetch(request, runtimeEnv(env), ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.APP_STORAGE_MODE === 'migration') return;
    await liveWorker.scheduled(controller, runtimeEnv(env), ctx);
  },
};
