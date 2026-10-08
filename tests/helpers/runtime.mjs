import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import ts from 'typescript';

const modules = new Map();
const cloudflareShim = 'data:text/javascript;base64,' + Buffer.from(`
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
`).toString('base64');

export async function loadWorker(relativePath) {
  const url = new URL('../../' + relativePath, import.meta.url);
  return import(compile(url));
}

function compile(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  const source = readFileSync(url, 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const parsed = ts.createSourceFile('compiled.mjs', outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const replacements = [];
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    const path = specifier.text;
    let resolved;
    if (path === 'cloudflare:workers') resolved = cloudflareShim;
    else if (path.startsWith('.')) {
      const dependency = new URL(/\.(?:ts|mts|mjs|js)$/.test(path) ? path : path + '.ts', url);
      resolved = compile(dependency);
    } else resolved = import.meta.resolve(path);
    replacements.push([specifier.getStart(parsed), specifier.end, JSON.stringify(resolved)]);
  }
  for (const [start, end, value] of replacements.reverse()) {
    outputText = outputText.slice(0, start) + value + outputText.slice(end);
  }

  const compiled = 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
  modules.set(url.href, compiled);
  return compiled;
}

export async function sqliteDatabase(t) {
  const child = spawn('python3', [new URL('./sqlite-server.py', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const result = JSON.parse(line);
    const next = pending.shift();
    if (result.error) next.reject(new Error(result.error));
    else next.resolve(result.result);
  });
  child.on('exit', () => {
    for (const next of pending.splice(0)) next.reject(new Error('SQLite fixture exited'));
  });
  t.after(() => child.stdin.end());
  function send(message) {
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      child.stdin.write(JSON.stringify(message) + '\n');
    });
  }
  const db = {
    async schema(sql) { await send({ schema: sql }); },
    prepare(sql) {
      const make = (values = []) => ({
        sql, values,
        bind(...next) { return make(next); },
        async all() { return (await send({ statements: [{ sql, values }] }))[0]; },
        async first() { return (await this.all()).results[0] ?? null; },
        async run() { return this.all(); },
      });
      return make();
    },
    async batch(statements) {
      return send({ statements: statements.map(({ sql, values }) => ({ sql, values })) });
    },
  };
  await db.schema(readFileSync(new URL('../../migrations/0001_expenses.sql', import.meta.url), 'utf8'));
  for (const name of ['0002_recurring.sql', '0003_budgets_audit.sql', '0004_consistency_features.sql', '0005_backup_dedup.sql', '0006_do_backups.sql']) {
    await db.schema(readFileSync(new URL('../../migrations/' + name, import.meta.url), 'utf8'));
  }
  await db.schema(readFileSync(new URL('../../migrations/20261008_d1_app_storage.sql', import.meta.url), 'utf8'));
  return db;
}

export function legacyContext(id, source = new Map()) {
  const original = structuredClone(source);
  let queue = Promise.resolve();
  const ctx = {
    id: { toString: () => id },
    storage: {
      async list({ limit = 1000, startAfter } = {}) {
        return new Map([...source].sort(([a], [b]) => a.localeCompare(b))
          .filter(([key]) => !startAfter || key > startAfter).slice(0, limit));
      },
      async setAlarm() { /* Operational alarm only; legacy keys stay immutable. */ },
      async get(key) { return structuredClone(source.get(key)); },
      async put() { throw new Error('Legacy storage must never be changed'); },
      async delete() { throw new Error('Legacy storage must never be deleted'); },
    },
    blockConcurrencyWhile(operation) {
      const next = queue.then(operation);
      queue = next.catch(() => {});
      return next;
    },
    assertUnchanged() { assert.deepEqual(source, original); },
  };
  return ctx;
}
