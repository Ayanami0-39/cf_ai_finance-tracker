// Recovered from live Worker d0a9ffeb-47cb-4013-9390-2a4e450af330.
// Original TypeScript/frontend sources were not available; preserve this baseline during refactoring.
import { DurableObject } from 'cloudflare:workers';
import { Hono as Hono2 } from 'hono';
import { cors } from 'hono/cors';

function rowToRecurring(r) {
  return {
    id: String(r.id),
    name: String(r.name),
    amount: Number(r.amount),
    category: String(r.category),
    merchant: r.merchant === null || r.merchant === void 0 ? void 0 : String(r.merchant),
    dayOfMonth: Number(r.day_of_month),
    active: Number(r.active) !== 0,
    createdAt: Number(r.created_at),
    lastRun: r.last_run === null || r.last_run === void 0 ? void 0 : String(r.last_run),
    lastRemind: r.last_remind === null || r.last_remind === void 0 ? void 0 : String(r.last_remind)
  };
}
async function d1GetRecurring(db, scope) {
  const { results } = await db.prepare("SELECT * FROM recurring_expenses WHERE scope = ? AND active = 1 ORDER BY day_of_month ASC").bind(scope).all();
  return (results || []).map(rowToRecurring);
}
async function d1AddRecurring(db, scope, r) {
  const rec = {
    ...r,
    createdAt: Date.now()
  };
  await db.prepare(
    `INSERT INTO recurring_expenses (id, scope, name, amount, category, merchant, day_of_month, active, created_at, last_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    rec.id,
    scope,
    rec.name,
    rec.amount,
    rec.category,
    rec.merchant ?? null,
    rec.dayOfMonth,
    rec.active ? 1 : 0,
    rec.createdAt,
    rec.lastRun ?? null
  ).run();
  return rec;
}
async function d1UpdateRecurring(db, scope, id, patch) {
  const sets = [];
  const vals = [];
  const push = (col, v) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.name !== void 0) push("name", patch.name);
  if (patch.amount !== void 0) push("amount", patch.amount);
  if (patch.category !== void 0) push("category", patch.category);
  if (patch.merchant !== void 0) push("merchant", patch.merchant || null);
  if (patch.dayOfMonth !== void 0) push("day_of_month", patch.dayOfMonth);
  if (patch.active !== void 0) push("active", patch.active ? 1 : 0);
  if (patch.lastRun !== void 0) push("last_run", patch.lastRun);
  if (sets.length === 0) return null;
  vals.push(scope, id);
  await db.prepare(`UPDATE recurring_expenses SET ${sets.join(", ")} WHERE scope = ? AND id = ?`).bind(...vals).run();
  const existing = await db.prepare("SELECT * FROM recurring_expenses WHERE scope = ? AND id = ?").bind(scope, id).first();
  return existing ? rowToRecurring(existing) : null;
}
async function d1MarkRecurringRun(db, scope, id, month) {
  await db.prepare("UPDATE recurring_expenses SET last_run = ? WHERE scope = ? AND id = ?").bind(month, scope, id).run();
}
async function d1MarkRecurringRemind(db, scope, id, month) {
  await db.prepare("UPDATE recurring_expenses SET last_remind = ? WHERE scope = ? AND id = ?").bind(month, scope, id).run();
}
async function d1DeleteRecurring(db, scope, id) {
  const res = await db.prepare("UPDATE recurring_expenses SET active = 0 WHERE scope = ? AND id = ?").bind(scope, id).run();
  return (res.meta.changes || 0) > 0;
}
function recurringToExpense(rec, dateStr) {
  return {
    id: crypto.randomUUID(),
    amount: rec.amount,
    category: rec.category,
    merchant: rec.merchant || rec.name,
    description: `周期订阅：${rec.name}`,
    date: dateStr,
    createdAt: Date.now(),
    parsedBy: "ai"
  };
}
function rowToNotification(r) {
  return {
    id: String(r.id),
    scope: String(r.scope),
    kind: String(r.kind),
    title: String(r.title),
    body: r.body == null ? void 0 : String(r.body),
    targetId: r.target_id == null ? void 0 : String(r.target_id),
    read: Number(r.read || 0) !== 0,
    createdAt: Number(r.created_at)
  };
}
async function d1AddNotification(db, input) {
  const cutoff = Date.now() - 24 * 36e5;
  if (input.targetId) {
    const dup = await db.prepare("SELECT id FROM notifications WHERE scope = ? AND kind = ? AND target_id = ? AND created_at >= ? LIMIT 1").bind(input.scope, input.kind, input.targetId, cutoff).first();
    if (dup) return false;
  }
  await db.prepare(
    `INSERT INTO notifications (id, scope, kind, title, body, target_id, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(
    crypto.randomUUID(),
    input.scope,
    input.kind,
    input.title.slice(0, 120),
    input.body?.slice(0, 500) ?? null,
    input.targetId ?? null,
    Date.now()
  ).run();
  return true;
}
async function d1GetNotifications(db, scope, opts) {
  const limit = Math.min(Math.max(opts?.limit || 50, 1), 100);
  const { results } = await db.prepare(
    `SELECT * FROM notifications WHERE scope = ? ${opts?.unreadOnly ? "AND read = 0" : ""}
       ORDER BY created_at DESC LIMIT ?`
  ).bind(scope, limit).all();
  return (results || []).map(rowToNotification);
}
async function d1CountUnread(db, scope) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE scope = ? AND read = 0").bind(scope).first();
  return Number(row?.n || 0);
}
async function d1MarkNotificationRead(db, scope, id) {
  await db.prepare("UPDATE notifications SET read = 1 WHERE scope = ? AND id = ?").bind(scope, id).run();
}
async function d1MarkAllNotificationsRead(db, scope) {
  await db.prepare("UPDATE notifications SET read = 1 WHERE scope = ? AND read = 0").bind(scope).run();
}
async function d1DeleteNotification(db, scope, id) {
  await db.prepare("DELETE FROM notifications WHERE scope = ? AND id = ?").bind(scope, id).run();
}
async function writeDoStorageBackup(db, doClass, scope, entries, now = Date.now()) {
  const stmts = [];
  let bytes = 0;
  for (const [key, value] of Object.entries(entries)) {
    const json = JSON.stringify(value);
    if (typeof json !== "string") continue;
    const size = new TextEncoder().encode(json).length;
    bytes += size;
    stmts.push(
      db.prepare(
        `INSERT INTO do_backups (do_class, scope, key, value, bytes, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (do_class, scope, key)
           DO UPDATE SET value = excluded.value, bytes = excluded.bytes, updated_at = excluded.updated_at`
      ).bind(doClass, scope, key, json, size, now)
    );
  }
  if (stmts.length > 0) await db.batch(stmts);
  return { keys: stmts.length, bytes };
}
async function deleteDoBackupKeys(db, doClass, scope, keys) {
  if (keys.length === 0) return;
  const placeholders = keys.map(() => "?").join(", ");
  await db.prepare(
    `DELETE FROM do_backups WHERE do_class = ? AND scope = ? AND key IN (${placeholders})`
  ).bind(doClass, scope, ...keys).run();
}
async function readDoStorageBackup(db, doClass, scope) {
  const res = await db.prepare(
    `SELECT do_class, scope, key, value, bytes, updated_at
       FROM do_backups WHERE do_class = ? AND scope = ? ORDER BY key ASC`
  ).bind(doClass, scope).all();
  return (res.results || []).map((row) => {
    const r = row;
    return {
      doClass: String(r.do_class),
      scope: String(r.scope),
      key: String(r.key),
      value: String(r.value),
      bytes: Number(r.bytes) || 0,
      updatedAt: Number(r.updated_at) || 0
    };
  });
}
async function listDoBackupStatus(db) {
  const res = await db.prepare(
    `SELECT do_class, scope, COUNT(*) AS keys, COALESCE(SUM(bytes), 0) AS bytes, MAX(updated_at) AS updated_at
       FROM do_backups GROUP BY do_class, scope ORDER BY do_class ASC, scope ASC`
  ).all();
  return (res.results || []).map((row) => {
    const r = row;
    return {
      doClass: String(r.do_class),
      scope: String(r.scope),
      keys: Number(r.keys) || 0,
      bytes: Number(r.bytes) || 0,
      updatedAt: Number(r.updated_at) || 0
    };
  });
}
async function recordDoBackupRun(db, run) {
  await db.prepare(
    `INSERT INTO do_backup_runs (id, trigger, started_at, finished_at, scopes, keys, bytes, ok, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    run.trigger,
    run.startedAt,
    run.finishedAt,
    run.scopes,
    run.keys,
    run.bytes,
    run.ok ? 1 : 0,
    run.detail ?? null
  ).run();
}
async function listDoBackupRuns(db, limit = 10) {
  const res = await db.prepare(
    `SELECT id, trigger, started_at, finished_at, scopes, keys, bytes, ok, detail
       FROM do_backup_runs ORDER BY started_at DESC LIMIT ?`
  ).bind(Math.max(1, Math.min(50, limit))).all();
  return (res.results || []).map((row) => {
    const r = row;
    return {
      id: String(r.id),
      trigger: String(r.trigger),
      startedAt: Number(r.started_at) || 0,
      finishedAt: r.finished_at == null ? null : Number(r.finished_at),
      scopes: Number(r.scopes) || 0,
      keys: Number(r.keys) || 0,
      bytes: Number(r.bytes) || 0,
      ok: Number(r.ok) === 1,
      detail: r.detail == null ? null : String(r.detail)
    };
  });
}
async function purgeDoBackupRuns(db, keepMs = 30 * 24 * 3600 * 1e3) {
  await db.prepare("DELETE FROM do_backup_runs WHERE started_at < ?").bind(Date.now() - keepMs).run();
}
class FinanceMemory extends DurableObject {
  static ALARM_KEY = "nextAlarm";
  /** 实时同步：scope 内所有在线 WebSocket 连接 */
  sockets = /* @__PURE__ */ new Set();
  constructor(ctx, env) {
    super(ctx, env);
    void this.scheduleNextAlarm();
  }
  // ==================== WebSocket 实时同步 ====================
  /**
   * Worker 转发来的 WebSocket 升级请求：接受连接并注册到广播组。
   * 客户端断开时自动清理；服务端事件通过 broadcast 变更推送。
   */
  async fetch(request) {
    const url = new URL(request.url);
    const isWsUpgrade = (url.pathname.endsWith("sync-ws") || url.pathname.endsWith("/ws")) && request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    if (isWsUpgrade) {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      this.sockets.add(pair[1]);
      pair[1].addEventListener("close", () => this.sockets.delete(pair[1]));
      pair[1].addEventListener("error", () => this.sockets.delete(pair[1]));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return new Response("Expected WebSocket path", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  }
  async webSocketMessage(ws, message) {
    try {
      if (typeof message === "string" && message === "ping") ws.send("pong");
    } catch {
    }
  }
  /** 广播数据变更事件：scope 内所有在线设备立即收到（多设备实时同步） */
  broadcastChange(event) {
    const data = JSON.stringify({ kind: "fiscus-change", ...event, ts: Date.now() });
    for (const ws of this.sockets) {
      try {
        ws.send(data);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }
  async scheduleNextAlarm() {
    const next = this.getNextOccurrence();
    await this.ctx.storage.put(FinanceMemory.ALARM_KEY, next.getTime());
    await this.ctx.storage.setAlarm(next.getTime());
  }
  /** 计算最近一个触发日：若本月触发日已过，取下个月对应日，否则取本月对应日 */
  getNextOccurrence(reference = /* @__PURE__ */ new Date()) {
    const tomorrow = new Date(reference);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 5, 0, 0);
    return tomorrow;
  }
  async alarm() {
    const scope = this.extractScope();
    const today = /* @__PURE__ */ new Date();
    const dateStr = today.toISOString().slice(0, 10);
    const month = dateStr.slice(0, 7);
    try {
      const recs = await d1GetRecurring(this.env.DB, scope);
      if (recs.length === 0) return;
      const todayDay = today.getDate();
      await Promise.all(
        recs.filter((r) => r.active && r.lastRun !== month && todayDay >= Math.min(r.dayOfMonth, daysInMonth(today))).map(async (rec) => {
          try {
            const dayToUse = Math.min(rec.dayOfMonth, daysInMonth(today));
            const expense = recurringToExpense(rec, `${month}-${String(dayToUse).padStart(2, "0")}`);
            expense.id = `sub-${rec.id}-${month}`;
            const inserted = await addExpenseToD1(this.env, scope, expense);
            await d1MarkRecurringRun(this.env.DB, scope, rec.id, month);
            if (!inserted) return;
            const msg = {
              id: crypto.randomUUID(),
              role: "ai",
              content: `⏰ 已自动入「${rec.name}」，金额 ¥${rec.amount.toFixed(2)}，已入 ${expense.date}。`,
              timestamp: Date.now()
            };
            await this.addChatMessage(msg);
            await addAuditToD1(this.env, scope, {
              actorUsername: "system",
              actorDisplay: "自动任务",
              action: "sub_auto",
              targetType: "expense",
              targetId: expense.id,
              summary: `订阅「${rec.name}」自动入账 ¥${rec.amount.toFixed(2)}（${expense.date}）`
            });
            this.broadcastChange({ type: "expense-added", by: "system", payload: { expenseId: expense.id } });
          } catch (err) {
            console.error(`[alarm] auto expense failed for ${rec.name}:`, err);
            try {
              await d1AddNotification(this.env.DB, {
                scope,
                kind: "auto_task",
                title: `订阅「${rec.name}」自动入账失败`,
                body: `本月（${month}）应入 ¥${rec.amount.toFixed(2)}，写入时出错：${String(err).slice(0, 200)}。可重试或手动补记。`,
                targetId: rec.id
              });
            } catch {
            }
          }
        })
      );
      await Promise.all(
        recs.filter((r) => {
          if (!r.active || r.lastRemind === month) return false;
          const dueDay = Math.min(r.dayOfMonth, daysInMonth(today));
          const dueDate = new Date(today.getFullYear(), today.getMonth(), dueDay);
          const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / 864e5);
          return diffDays >= 0 && diffDays <= 3;
        }).map(async (rec) => {
          const dueDay = Math.min(rec.dayOfMonth, daysInMonth(today));
          const msg = {
            id: crypto.randomUUID(),
            role: "ai",
            content: `🔔 提醒：「${rec.name}」将在 ${dueDay} 号扣费 ¥${rec.amount.toFixed(2)}，请留意账户余额。`,
            timestamp: Date.now()
          };
          await this.addChatMessage(msg);
          await d1MarkRecurringRemind(this.env.DB, scope, rec.id, month);
          this.broadcastChange({ type: "chat-message", by: "system" });
        })
      );
    } catch (err) {
      console.error(`Recurring alarm failed for scope ${scope}:`, err);
    } finally {
      await this.scheduleNextAlarm();
    }
  }
  extractScope() {
    return this.ctx.id.name || "default";
  }
  // RPC method: Add expense
  async addExpense(expense) {
    let expenses = await this.ctx.storage.get("expenses");
    if (!expenses) {
      expenses = [];
    }
    expenses.push(expense);
    await this.ctx.storage.put("expenses", expenses);
  }
  // RPC method: Get expenses
  async getExpenses() {
    let expenses = await this.ctx.storage.get("expenses");
    if (!expenses) {
      expenses = [];
    }
    return expenses;
  }
  async deleteExpense(expenseId) {
    let expenses = await this.ctx.storage.get("expenses");
    if (!expenses) {
      return false;
    }
    const initialLength = expenses.length;
    expenses = expenses.filter((e) => e.id !== expenseId);
    if (expenses.length === initialLength) {
      return false;
    }
    await this.ctx.storage.put("expenses", expenses);
    return true;
  }
  // RPC method: Update expense（编辑交易记录：日期、金额、类型、商家、分类等）
  async updateExpense(expenseId, patch) {
    const expenses = await this.ctx.storage.get("expenses") || [];
    const idx = expenses.findIndex((e) => e.id === expenseId);
    if (idx === -1) return null;
    const updated = { ...expenses[idx], ...patch, id: expenses[idx].id };
    expenses[idx] = updated;
    await this.ctx.storage.put("expenses", expenses);
    return updated;
  }
  // RPC method: Clear expenses
  async clearExpenses() {
    await this.ctx.storage.delete("expenses");
  }
  // ---- Family registry（家庭码 → 成员列表，服务端共享） ----
  async getFamilyMembers() {
    return await this.ctx.storage.get("familyMembers") || [];
  }
  async setFamilyMembers(members) {
    await this.ctx.storage.put("familyMembers", members);
  }
  async getFamilyOwnerId() {
    return await this.ctx.storage.get("familyOwnerId") || null;
  }
  async setFamilyOwnerId(ownerId) {
    await this.ctx.storage.put("familyOwnerId", ownerId);
  }
  async removeFamilyMember(memberId) {
    const members = await this.ctx.storage.get("familyMembers") || [];
    const next = members.filter((m) => m.id !== memberId);
    if (next.length !== members.length) {
      await this.ctx.storage.put("familyMembers", next);
    }
    return next;
  }
  // ---- Bulk import（加入家庭时迁移本机历史数据） ----
  async importExpenses(list) {
    const existing = await this.ctx.storage.get("expenses") || [];
    const seen = new Set(existing.map((e) => e.id));
    let added = 0;
    for (const e of list) {
      if (e && e.id && !seen.has(e.id)) {
        existing.push(e);
        seen.add(e.id);
        added++;
      }
    }
    if (added > 0) {
      existing.sort((a, b) => a.createdAt - b.createdAt);
      await this.ctx.storage.put("expenses", existing);
    }
    return added;
  }
  async importChatMessages(list) {
    let existing = await this.ctx.storage.get("chatMessages") || [];
    const seen = new Set(existing.map((m) => m.id));
    let added = 0;
    for (const m of list) {
      if (m && m.id && !seen.has(m.id)) {
        existing.push(m);
        seen.add(m.id);
        added++;
      }
    }
    if (added > 0) {
      existing.sort((a, b) => a.timestamp - b.timestamp);
      if (existing.length > 100) existing = existing.slice(-100);
      await this.ctx.storage.put("chatMessages", existing);
      await this.backupKeysToD1(["chatMessages"]);
    }
    return added;
  }
  // RPC method: Add chat message
  async addChatMessage(message) {
    let messages = await this.ctx.storage.get("chatMessages");
    if (!messages) {
      messages = [];
    }
    messages.push(message);
    if (messages.length > 100) {
      messages = messages.slice(-100);
    }
    await this.ctx.storage.put("chatMessages", messages);
    await this.backupKeysToD1(["chatMessages"]);
    this.broadcastChange({ type: "chat-message", by: message.byId || message.by });
  }
  // RPC method: Get chat messages
  async getChatMessages() {
    let messages = await this.ctx.storage.get("chatMessages");
    if (!messages) {
      messages = [];
    }
    return messages;
  }
  // RPC method: Clear chat history
  async clearChatMessages() {
    await this.ctx.storage.delete("chatMessages");
    await this.backupKeysToD1(["chatMessages"]);
  }
  // ==================== DO 存储内部备份（D1 镜像，灾备专用） ====================
  /** 全量导出本实例存储（内部备份用，配合 D1 镜像表 do_backups） */
  async dumpStorageForBackup() {
    const map = await this.ctx.storage.list();
    return Object.fromEntries(map);
  }
  /** 指定存储键实时镜像到 D1（写路径同步；失败仅记日志，不影响主流程） */
  async backupKeysToD1(keys) {
    try {
      const scope = this.extractScope();
      const entries = {};
      const missing = [];
      for (const key of keys) {
        const value = await this.ctx.storage.get(key);
        if (value === void 0) missing.push(key);
        else entries[key] = value;
      }
      if (Object.keys(entries).length > 0) {
        await writeDoStorageBackup(this.env.DB, "FinanceMemory", scope, entries);
      }
      if (missing.length > 0) {
        await deleteDoBackupKeys(this.env.DB, "FinanceMemory", scope, missing);
      }
    } catch (err) {
      console.error("[do-backup] FinanceMemory mirror failed:", err);
    }
  }
  /** 从 D1 镜像恢复本实例存储（灾备恢复：只写不删，避免误伤现有数据） */
  async restoreStorageFromBackup(opts) {
    const rows = await readDoStorageBackup(this.env.DB, "FinanceMemory", this.extractScope());
    const wanted = opts?.keys && opts.keys.length > 0 ? new Set(opts.keys) : null;
    const restored = [];
    const seen = /* @__PURE__ */ new Set();
    for (const row of rows) {
      if (wanted && !wanted.has(row.key)) continue;
      seen.add(row.key);
      try {
        await this.ctx.storage.put(row.key, JSON.parse(row.value));
        restored.push(row.key);
      } catch (err) {
        console.error(`[do-backup] FinanceMemory restore key "${row.key}" failed:`, err);
      }
    }
    const missing = wanted ? [...wanted].filter((k) => !seen.has(k)) : [];
    this.broadcastChange({ type: "sync-refresh", by: "system" });
    return { restored, missing };
  }
}
function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
async function addAuditToD1(env, scope, entry) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (id, scope, actor_username, actor_display, action, target_id, target_type, summary, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      scope,
      entry.actorUsername,
      entry.actorDisplay ?? null,
      entry.action,
      entry.targetId ?? null,
      entry.targetType ?? null,
      entry.summary.slice(0, 300),
      null,
      Date.now()
    ).run();
  } catch (err) {
    console.error("[audit] auto task audit write failed:", err);
  }
}
async function addExpenseToD1(env, scope, expense) {
  try {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO expenses
         (id, scope, amount, category, merchant, description, date, created_at, type, by, by_id, parsed_by, idempotency_key, dedup_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      expense.id,
      scope,
      expense.amount,
      expense.category,
      expense.merchant ?? null,
      expense.description,
      expense.date,
      expense.createdAt,
      expense.type ?? "expense",
      expense.by ?? null,
      expense.byId ?? null,
      expense.parsedBy ?? null,
      expense.id,
      `${scope}|${expense.id}`
    ).run();
    return (res.meta.changes || 0) > 0;
  } catch (err) {
    console.warn("[alarm] idempotent insert failed, fallback to plain insert:", err);
    await env.DB.prepare(
      `INSERT INTO expenses (id, scope, amount, category, merchant, description, date, created_at, type, by, by_id, parsed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      expense.id,
      scope,
      expense.amount,
      expense.category,
      expense.merchant ?? null,
      expense.description,
      expense.date,
      expense.createdAt,
      expense.type ?? "expense",
      expense.by ?? null,
      expense.byId ?? null,
      expense.parsedBy ?? null
    ).run();
    return true;
  }
}
class UserRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }
  async accounts() {
    return await this.ctx.storage.get("accounts") || {};
  }
  async saveAccounts(map) {
    await this.ctx.storage.put("accounts", map);
    await this.mirrorToD1();
  }
  async register(username, password) {
    const key = username.trim().toLowerCase();
    if (!key || key.length > 24) return { ok: false, error: "用户名需为 1-24 个字符" };
    if (!password || password.length < 4)
      return { ok: false, error: "密码至少 4 位" };
    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim()))
      return { ok: false, error: "用户名仅支持字母/数字/下划线/中划线" };
    const map = await this.accounts();
    if (map[key]) return { ok: false, error: "用户名已被占用" };
    const account = {
      username: username.trim(),
      passHash: await pbkdf2Hash(key, password),
      displayName: username.trim(),
      emoji: "🙂",
      scopeId: `user_${key}`,
      createdAt: Date.now()
    };
    map[key] = account;
    await this.saveAccounts(map);
    return { ok: true, account };
  }
  async verify(username, password) {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: "用户不存在" };
    if (isLegacyHash(account.passHash)) {
      const legacy = await sha256Hex$1(`${key}:${password}`);
      if (legacy !== account.passHash) return { ok: false, error: "密码不正确" };
      account.passHash = await pbkdf2Hash(key, password);
      map[key] = account;
      await this.saveAccounts(map);
      return { ok: true, account };
    }
    if (!await pbkdf2Verify(key, password, account.passHash))
      return { ok: false, error: "密码不正确" };
    return { ok: true, account };
  }
  async getProfile(username) {
    const key = username.trim().toLowerCase();
    return (await this.accounts())[key] || null;
  }
  async updateProfile(username, patch) {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: "用户不存在" };
    if (patch.displayName !== void 0) {
      const name = patch.displayName.trim();
      if (!name || name.length > 12)
        return { ok: false, error: "昵称需为 1-12 个字符" };
      account.displayName = name;
    }
    if (patch.emoji !== void 0) account.emoji = patch.emoji;
    map[key] = account;
    await this.saveAccounts(map);
    return { ok: true, account };
  }
  async changePassword(username, oldPassword, newPassword) {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: "用户不存在" };
    const oldOk = isLegacyHash(account.passHash) ? await sha256Hex$1(`${key}:${oldPassword}`) === account.passHash : await pbkdf2Verify(key, oldPassword, account.passHash);
    if (!oldOk) return { ok: false, error: "旧密码不正确" };
    if (!newPassword || newPassword.length < 4)
      return { ok: false, error: "新密码至少 4 位" };
    account.passHash = await pbkdf2Hash(key, newPassword);
    map[key] = account;
    await this.saveAccounts(map);
    return { ok: true };
  }
  // ==================== 家庭注册表 ====================
  familiesKey = "families";
  // Record<code, FamilyRecord>
  membershipKey = "membership";
  // Record<usernameLower, code>
  async families() {
    return await this.ctx.storage.get(this.familiesKey) || {};
  }
  async saveFamilies(map) {
    await this.ctx.storage.put(this.familiesKey, map);
    await this.mirrorToD1();
  }
  async memberships() {
    return await this.ctx.storage.get(this.membershipKey) || {};
  }
  async saveMemberships(map) {
    await this.ctx.storage.put(this.membershipKey, map);
    await this.mirrorToD1();
  }
  // ==================== DO 存储内部备份（D1 镜像，灾备专用） ====================
  /** 全量导出注册表存储（内部备份用） */
  async dumpStorageForBackup() {
    const map = await this.ctx.storage.list();
    return Object.fromEntries(map);
  }
  /** 注册表变更后同步 D1 镜像（灾备专用；失败仅记日志，不影响主流程） */
  async mirrorToD1() {
    try {
      const entries = await this.dumpStorageForBackup();
      await writeDoStorageBackup(this.env.DB, "UserRegistry", "global", entries);
    } catch (err) {
      console.error("[do-backup] UserRegistry mirror failed:", err);
    }
  }
  /** 列出全部数据作用域（内部备份用：由账号与家庭推导 user_x / family_x） */
  async listBackupScopes() {
    const accounts = await this.accounts();
    const families = await this.families();
    const scopes = /* @__PURE__ */ new Set();
    for (const account of Object.values(accounts)) scopes.add(account.scopeId);
    for (const family of Object.values(families)) scopes.add(family.scopeId);
    return [...scopes];
  }
  /** 从 D1 镜像恢复注册表存储（灾备恢复：只写不删，避免误伤现有数据） */
  async restoreStorageFromBackup(opts) {
    const rows = await readDoStorageBackup(this.env.DB, "UserRegistry", "global");
    const wanted = opts?.keys && opts.keys.length > 0 ? new Set(opts.keys) : null;
    const restored = [];
    const seen = /* @__PURE__ */ new Set();
    for (const row of rows) {
      if (wanted && !wanted.has(row.key)) continue;
      seen.add(row.key);
      try {
        await this.ctx.storage.put(row.key, JSON.parse(row.value));
        restored.push(row.key);
      } catch (err) {
        console.error(`[do-backup] UserRegistry restore key "${row.key}" failed:`, err);
      }
    }
    const missing = wanted ? [...wanted].filter((k) => !seen.has(k)) : [];
    return { restored, missing };
  }
  /** 生成不重复的 6 位家庭码（排除易混淆的 0/1） */
  async genFamilyCode() {
    const digits = "23456789";
    const map = await this.families();
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += digits[Math.floor(Math.random() * digits.length)];
      }
      if (!map[code]) return code;
    }
    throw new Error("无法生成家庭码，请重试");
  }
  /** 家庭成员的实时资料（从账号表读取，改名/换头像自动生效；创建者排最前） */
  resolveMembers(family, accounts) {
    return family.memberUsernames.map((u) => {
      const a = accounts[u];
      return a ? {
        username: a.username,
        displayName: a.displayName,
        emoji: a.emoji,
        isOwner: u === family.ownerUsername,
        role: this.roleOf(family, u)
      } : null;
    }).filter((m) => m !== null);
  }
  /** 成员角色：未迁移的老家庭无 memberRoles 时，创建者视为 admin，其余默认 contributor */
  roleOf(family, username) {
    if (family.memberRoles && family.memberRoles[username]) return family.memberRoles[username];
    return username === family.ownerUsername ? "admin" : "contributor";
  }
  /** 创建家庭：账号需不在任何家庭中 */
  async createFamily(username) {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    const account = map[key];
    if (!account) return { ok: false, error: "用户不存在" };
    const memberships = await this.memberships();
    if (memberships[key]) return { ok: false, error: "你已在一个家庭中，请先退出" };
    const code = await this.genFamilyCode();
    const family = {
      code,
      scopeId: `family_${code}`,
      ownerId: account.scopeId,
      ownerUsername: key,
      memberUsernames: [key],
      memberRoles: { [key]: "admin" },
      createdAt: Date.now()
    };
    const families = await this.families();
    families[code] = family;
    memberships[key] = code;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, family };
  }
  /** 按家庭码查询家庭（含成员实时资料） */
  async getFamilyByCode(code) {
    const normalized = String(code).replace(/\D/g, "");
    const families = await this.families();
    const family = families[normalized];
    if (!family) return { ok: false, error: "家庭码不存在" };
    const accounts = await this.accounts();
    return { ok: true, family, members: this.resolveMembers(family, accounts) };
  }
  /** 加入家庭：账号需不在任何家庭中 */
  async joinFamily(username, code) {
    const key = username.trim().toLowerCase();
    const map = await this.accounts();
    if (!map[key]) return { ok: false, error: "用户不存在" };
    const normalized = String(code).replace(/\D/g, "");
    if (normalized.length !== 6) return { ok: false, error: "家庭码应为 6 位数字" };
    const memberships = await this.memberships();
    if (memberships[key]) return { ok: false, error: "你已在一个家庭中，请先退出" };
    const families = await this.families();
    const family = families[normalized];
    if (!family) return { ok: false, error: "家庭码不存在，请核对后重试" };
    family.memberUsernames.push(key);
    if (!family.memberRoles) family.memberRoles = {};
    family.memberRoles[key] = "contributor";
    memberships[key] = normalized;
    families[normalized] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, family };
  }
  /** 当前账号的家庭与成员列表（实时资料） */
  async listFamilyMembers(username) {
    const key = username.trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: "你还没有加入家庭" };
    return this.getFamilyByCode(code);
  }
  /** 移除成员：仅创建者可操作，不能移除自己 */
  async removeFamilyMember(username, targetUsername) {
    const key = username.trim().toLowerCase();
    const targetKey = String(targetUsername).trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: "你还没有加入家庭" };
    const families = await this.families();
    const family = families[code];
    if (!family) return { ok: false, error: "家庭不存在" };
    if (family.ownerUsername !== key)
      return { ok: false, error: "只有家庭创建者可以移除成员" };
    if (targetKey === key)
      return { ok: false, error: "不能移除自己，请使用退出家庭" };
    const accounts = await this.accounts();
    if (!accounts[targetKey]) return { ok: false, error: "目标用户不存在" };
    family.memberUsernames = family.memberUsernames.filter((u) => u !== targetKey);
    delete memberships[targetKey];
    families[code] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, members: this.resolveMembers(family, accounts) };
  }
  /** 退出家庭；创建者退出时所有权转移给最早的剩余成员（无成员则解散） */
  async leaveFamily(username) {
    const key = username.trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: "你还没有加入家庭" };
    const families = await this.families();
    const family = families[code];
    if (!family) {
      delete memberships[key];
      await this.saveMemberships(memberships);
      return { ok: true, dissolved: true };
    }
    family.memberUsernames = family.memberUsernames.filter((u) => u !== key);
    delete memberships[key];
    if (family.ownerUsername === key) {
      const nextOwner = family.memberUsernames[0];
      if (nextOwner) {
        family.ownerUsername = nextOwner;
        family.ownerId = `user_${nextOwner}`;
        families[code] = family;
        await this.saveFamilies(families);
        await this.saveMemberships(memberships);
        return { ok: true, dissolved: false, newOwner: nextOwner };
      }
      delete families[code];
      await this.saveFamilies(families);
      await this.saveMemberships(memberships);
      return { ok: true, dissolved: true };
    }
    families[code] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, dissolved: false };
  }
  /** 更换家庭码（创建者操作；旧码立即失效） */
  async regenerateFamilyCode(username) {
    const key = username.trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[key];
    if (!code) return { ok: false, error: "你还没有加入家庭" };
    const families = await this.families();
    const family = families[code];
    if (!family) return { ok: false, error: "家庭不存在" };
    if (family.ownerUsername !== key)
      return { ok: false, error: "只有家庭创建者可以更换家庭码" };
    const newCode = await this.genFamilyCode();
    delete families[code];
    family.code = newCode;
    family.scopeId = `family_${newCode}`;
    families[newCode] = family;
    await this.saveFamilies(families);
    await this.saveMemberships(memberships);
    return { ok: true, family };
  }
  // ==================== 成员角色（只读 / 可记账 / 管理员） ====================
  /** 查询某成员在家庭中的角色（无家庭返回 null） */
  async getMemberRole(username, familyCode) {
    const key = username.trim().toLowerCase();
    const families = await this.families();
    let family;
    if (familyCode) {
      family = families[String(familyCode).replace(/\D/g, "")];
    } else {
      const memberships = await this.memberships();
      const code = memberships[key];
      family = code ? families[code] : void 0;
    }
    if (!family || !family.memberUsernames.includes(key)) return { ok: false };
    return { ok: true, role: this.roleOf(family, key), scopeId: family.scopeId };
  }
  /**
   * 设置成员角色（仅 admin 可操作）：
   * - 不能修改自己的角色（防止最后一个管理员自降导致无人管理）
   * - 只有家庭内现存成员可被设置
   */
  async setMemberRole(operator, targetUsername, role) {
    const opKey = operator.trim().toLowerCase();
    const targetKey = targetUsername.trim().toLowerCase();
    const memberships = await this.memberships();
    const code = memberships[opKey];
    if (!code) return { ok: false, error: "你还没有加入家庭" };
    const families = await this.families();
    const family = families[code];
    if (!family) return { ok: false, error: "家庭不存在" };
    if (this.roleOf(family, opKey) !== "admin")
      return { ok: false, error: "只有管理员可以设置成员角色" };
    if (targetKey === opKey)
      return { ok: false, error: "不能修改自己的角色" };
    if (!family.memberUsernames.includes(targetKey))
      return { ok: false, error: "该成员不在家庭中" };
    if (!["admin", "contributor", "viewer"].includes(role))
      return { ok: false, error: "无效的角色" };
    if (!family.memberRoles) family.memberRoles = {};
    family.memberRoles[targetKey] = role;
    families[code] = family;
    await this.saveFamilies(families);
    const accounts = await this.accounts();
    return { ok: true, members: this.resolveMembers(family, accounts) };
  }
}
async function sha256Hex$1(text) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const PBKDF2_ITERATIONS = 1e5;
function isLegacyHash(hash) {
  return /^[0-9a-f]{64}$/.test(hash);
}
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
async function pbkdf2Hash(usernameKey, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${usernameKey}:${password}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${toHex(bits)}`;
}
async function pbkdf2Verify(usernameKey, password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!Number.isFinite(iterations) || iterations <= 0 || !saltHex || !expectedHex)
    return false;
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${usernameKey}:${password}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromHex(saltHex),
      iterations
    },
    material,
    expectedHex.length * 4
  );
  return timingSafeEqualHex(toHex(bits), expectedHex);
}
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const GLM_MODEL = "@cf/zai-org/glm-4.7-flash";
const GLM_THINKING_OFF = {
  chat_template_kwargs: {
    enable_thinking: false,
    clear_thinking: true
  }
};
function stripThinking(text) {
  return text.replace(/ɛ[\s\S]*?ɛ/g, " ").replace(/ɛ/g, " ");
}
function extractAiText(response) {
  if (typeof response === "string") return response;
  const r = response;
  if (!r || typeof r !== "object") return "";
  if (typeof r.response === "string") return r.response;
  if (typeof r.result === "object" && r.result !== null && typeof r.result.response === "string") {
    return r.result.response;
  }
  if (Array.isArray(r.choices) && r.choices.length > 0) {
    const message = r.choices[0].message;
    if (message && typeof message.content === "string") return message.content;
  }
  if (Array.isArray(r.candidates) && r.candidates.length > 0) {
    const content = r.candidates[0].content;
    const parts = content?.parts;
    if (Array.isArray(parts) && parts.length > 0) {
      const texts = parts.map((p) => typeof p.text === "string" ? p.text : "").filter(Boolean);
      if (texts.length > 0) return texts.join("");
    }
  }
  return "";
}
const EXPENSE_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Bills & Utilities",
  "Healthcare",
  "Education",
  "Personal Care",
  "Travel",
  "Other"
];
function getExpenseEntryPrompt(input, memberName, today) {
  const memberLine = memberName ? `
CURRENT USER: This entry is recorded by family member "${memberName}". You may address them naturally in the reply.
` : "";
  const ex = (offsetDays) => {
    const d = new Date(Date.now() + 8 * 36e5 + offsetDays * 864e5);
    return d.toISOString().split("T")[0];
  };
  const yesterday = ex(-1);
  const yesterMonthDay = `${Number(yesterday.slice(5, 7))}月${Number(yesterday.slice(8))}日`;
  const lastMonthDay = `${Number(yesterday.slice(5, 7))}月${Number(yesterday.slice(8))}日`;
  const todayLine = today ? `
TODAY'S DATE: ${today} (Beijing time). Resolve ALL relative dates strictly from TODAY'S DATE by ARITHMETIC: 昨天 = TODAY minus 1 day, 前天 = TODAY minus 2 days. Compute the date yourself from TODAY'S DATE - NEVER guess, copy an example date, or use a cached/stale date.
` : "";
  return `You are a bilingual (Chinese/English) financial assistant helping a user log a transaction. The user may speak Chinese or English.
${memberLine}${todayLine}
USER SAID: "${input}"

YOUR TASK:
1. FIRST determine transaction type: "expense" (user spent money) or "income" (user received money)
2. Extract the amount
3. Identify the merchant/source name
4. Categorize the transaction
5. Extract the transaction date if the user mentions one (see DATE RULES)
6. Reply in the SAME language the user used (Chinese input → Chinese reply)
7. Do NOT write any confirmation message - the reply text is generated by the app. Only output the structured JSON fields.

TRANSACTION TYPE RULES:
- Spent/paid/bought or 花了/买了/付了/消费/打车/充了 → expense
- received/salary or 工资/到账/收了/收红包/转账收入/卖二手/报销/退款/奖金/奖励/补贴/利息 → income
- Reward/received nouns WITHOUT a giving verb (红包/奖励/奖金/补贴/稿费/劳务费/奖学金/中奖/佣金/分红 as the thing the user GOT, e.g. "宣讲会提问红包300", "活动奖励100", "稿费800") → income
- Giving verbs 给/发给/送给 + 红包/奖金 mean the user PAID OUT → expense (e.g. "给妈妈发红包500")
- Income keywords take priority; mixed sentence picks the DOMINANT transaction by amount
- Example: "工资到账8000，花了50买咖啡" → type=income, amount=8000, category=Income, merchant=工资

DATE RULES (IMPORTANT):
- "昨天花了50" → yesterday's date = TODAY minus 1 day (${yesterday}). Compute it from TODAY'S DATE, do not copy example dates
- "今天" → TODAY'S DATE; "前天" → TODAY minus 2 days; "上周五/X天前" → resolve from TODAY'S DATE
- Spaces inside dates are still dates: "7 月 5 日" → "YYYY-07-05", "8 月 15 号" → "YYYY-08-15" - ALWAYS fill the "date" field when the input mentions any date
- "${yesterMonthDay}工资3000" → date="${yesterday}" (year = current year unless it would be in the future, then last year)
- "2025-08-31" / "2025年8月31日" → that exact date
- NO date mentioned → omit the "date" field entirely (defaults to today)
- Return date ONLY in "YYYY-MM-DD" format

AMOUNT EXTRACTION RULES:
- "$50", "50 dollars", "fifty dollars", "50 bucks", "80刀" → 80
- "¥35", "35元", "七块" → 7
- "50块" → 50, "35块5" → 35.5, "五十三块五" → 53.5
- "25,000" / "1,500" → strip thousands separators → 25000 / 1500 (commas are NOT decimal points)
- Numbers inside dates ("8月27号", "2026年") are DATES, never amounts
- Chinese numerals: 一~十百千万, 两 → digits; 十五→15; 二十三→23; 一百二→120; 两百五→250
- If ambiguous, best guess. Always return a number.

CATEGORIZATION RULES (Chinese hints):
- 咖啡,餐厅,外卖,奶茶,三餐,买菜,超市,火锅,水果 → Food & Dining
- 打车,滴滴,地铁,公交,加油,停车,高铁,机票,快递 → Transportation
- 淘宝,京东,拼多多,衣服,鞋子,数码,网购 → Shopping
- 电影,游戏,会员,演唱会,桌游,KTV,娱乐 → Entertainment
- 房租,水电,煤气,网费,话费,物业 → Bills & Utilities
- 医院,药店,买药,看病,体检,牙医 → Healthcare
- 书,课程,学费,培训,考试,网课 → Education
- 理发,健身,瑜伽,美容,护肤 → Personal Care
- 酒店,民宿,签证,旅游 → Travel
- English: coffee/restaurant → Food & Dining; gas/uber/parking → Transportation; clothes/electronics → Shopping; movies/games → Entertainment; rent/utilities → Bills & Utilities; doctor/pharmacy → Healthcare; books/courses → Education; haircut/gym → Personal Care; hotels/flights → Travel; else → Other

INCOME RULES:
- All income transactions use category "Income" (not in the list above)

MERCHANT EXTRACTION RULES:
- Extract brand/store names: 星巴克,瑞幸,麦当劳,美团,淘宝,盒马 etc.
- No clear merchant → use main subject ("咖啡" → "咖啡", "coffee" → "Coffee")
- Keep it short and clean
- INCOME source: strip verbs and suffixes, keep the CORE NOUN ONLY.
  "卖了课件收入300" → merchant "课件" (NOT 卖课件/卖了课件收入); "收到红包200" → "红包"; "工资到账8000" → "工资"

EXAMPLES (bilingual):

Input: "I spent $50 on Starbucks"
Output: { "type": "expense", "amount": 50, "merchant": "Starbucks", "category": "Food & Dining" }

Input: "我在星巴克花了35块买拿铁"
Output: { "type": "expense", "amount": 35, "merchant": "星巴克", "category": "Food & Dining" }

Input: "今天午饭花了三十五块五"
Output: { "type": "expense", "amount": 35.5, "merchant": "午饭", "category": "Food & Dining", "date": "${today ?? "TODAY"}" }

Input: "工资到账8000"
Output: { "type": "income", "amount": 8000, "merchant": "工资", "category": "Income" }

Input: "${lastMonthDay}工资3000¥"
Output: { "type": "income", "amount": 3000, "merchant": "工资", "category": "Income", "date": "${yesterday}" }

Input: "8月27号工资25,000"
Output: { "type": "income", "amount": 25000, "merchant": "工资", "category": "Income", "date": "TODAY_YEAR-08-27" }

Input: "昨天打车花了30"
Output: { "type": "expense", "amount": 30, "merchant": "打车", "category": "Transportation", "date": "${yesterday}" }

Input: "收了个红包 200 块"
Output: { "type": "income", "amount": 200, "merchant": "红包", "category": "Income" }

Input: "宣讲会提问红包300"
Output: { "type": "income", "amount": 300, "merchant": "宣讲会提问红包", "category": "Income" }

Input: "给妈妈发红包500"
Output: { "type": "expense", "amount": 500, "merchant": "红包", "category": "Other" }

Input: "卖课件收入500块"
Output: { "type": "income", "amount": 500, "merchant": "课件", "category": "Income" }

Input: "打车去机场花了45"
Output: { "type": "expense", "amount": 45, "merchant": "打车", "category": "Transportation" }

OUTPUT FORMAT (CRITICAL - your ENTIRE response is machine-parsed as JSON):
{
  "type": "<expense|income>",
  "amount": <number>,
  "merchant": "<string>",
  "category": "<category or Income>",
  "date": "<YYYY-MM-DD, only when the user mentioned a date>"
}

CRITICAL:
1. Your ENTIRE response must be ONE raw JSON object: the first character is { and the last character is }
2. NO markdown code blocks (never wrap output in triple backticks), NO explanation, NO text before or after the JSON
3. Field names and string values use double quotes; "amount" is a bare number (35, never "35元")
4. Output ONLY the fields shown in OUTPUT FORMAT - never add extra fields, never write any confirmation text`;
}
const SYSTEM_MESSAGE$1 = `You are a transaction-parsing engine. Convert the user's message into ONE structured JSON object. Chinese and English input both supported. Accuracy of extraction is your only goal.`;
const AI_CONFIG = {
  model: GLM_MODEL,
  max_tokens: 4e3,
  params: {
    // OpenAI 兼容端点参数：关闭深度思考；单轮任务无需保留思考上下文
    ...GLM_THINKING_OFF
  }
};
function toTodayStr() {
  const bj = new Date(Date.now() + 8 * 36e5);
  return `${bj.getUTCFullYear()}-${String(bj.getUTCMonth() + 1).padStart(2, "0")}-${String(bj.getUTCDate()).padStart(2, "0")}`;
}
async function processExpenseInput(AI, input, memberName) {
  try {
    const today = toTodayStr();
    const userPrompt = getExpenseEntryPrompt(input, memberName, today);
    const response = await AI.run(
      AI_CONFIG.model,
      {
        messages: [
          {
            role: "system",
            content: SYSTEM_MESSAGE$1
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        max_tokens: AI_CONFIG.max_tokens,
        ...AI_CONFIG.params
      }
    );
    const aiText = stripThinking(extractAiText(response));
    if (!aiText) {
      console.error("[parse-expense] AI returned empty output, fallback to regex. input:", input, "rawResponse:", JSON.stringify(response).slice(0, 500));
      return fallbackParsing(input);
    }
    const parsed = extractJson(aiText);
    if (!parsed) {
      console.error("[parse-expense] AI output is not valid JSON, fallback to regex. input:", input, "aiText:", aiText.slice(0, 500));
      return fallbackParsing(input);
    }
    if (!isValidExpenseJson(parsed)) {
      console.error("[parse-expense] AI JSON missing required fields or invalid category, fallback to regex. input:", input, "parsed:", JSON.stringify(parsed).slice(0, 500));
      return fallbackParsing(input);
    }
    let category = parsed.category;
    let type = parsed.type === "income" ? "income" : "expense";
    let directionCorrected = false;
    if (type === "expense" && REWARD_INCOME_KW_RE.test(input) && !GIVING_VERB_RE.test(input) && !EXPENSE_ACTION_RE.test(input)) {
      type = "income";
      category = "Income";
      directionCorrected = true;
      console.warn("[parse-expense] reward-like expression corrected expense→income. input:", input);
    }
    const rawMerchant = typeof parsed.merchant === "string" ? parsed.merchant : "Unknown";
    const merchant = type === "income" ? normalizeIncomeMerchant(rawMerchant) : rawMerchant;
    let date;
    const hasDateClue = DATE_CLUE_RE.test(input);
    if (typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) && hasDateClue) {
      date = parsed.date;
    } else if (!date && hasDateClue) {
      date = extractDate(input);
      if (date) {
        console.warn("[parse-expense] AI omitted date, recovered from input via extractDate:", input, "->", date);
      }
    }
    const notes = [];
    if (hasDateClue && RELATIVE_DATE_RE.test(input)) {
      const localDate = extractDate(input);
      if (localDate && localDate !== date) {
        console.warn("[parse-expense] AI relative date mismatch, corrected to local rule. input:", input, "ai:", date, "-> local:", localDate);
        date = localDate;
      }
    }
    notes.push({ field: "金额", used: String(Number(parsed.amount)), from: "ai", why: "AI 从输入中识别" });
    if (type === "income") {
      notes.push({
        field: "商家",
        used: merchant,
        from: "rule",
        why: `收入来源归一化：AI 原始值「${rawMerchant}」去掉动作词与后缀`
      });
    } else {
      notes.push({ field: "商家", used: merchant, from: "ai", why: "AI 从输入中识别" });
    }
    notes.push({
      field: "分类",
      used: category,
      from: directionCorrected ? "rule" : "ai",
      why: directionCorrected ? "随类型复核修正为 Income" : type === "income" ? "识别为收入" : "AI 分类白名单内"
    });
    notes.push({
      field: "类型",
      used: type === "income" ? "收入" : "支出",
      from: directionCorrected ? "rule" : "ai",
      why: directionCorrected ? "奖励/红包类获得性表述，本地复核纠正 AI 的支出判断" : "AI 判定"
    });
    if (date) {
      const aiDate = typeof parsed.date === "string" ? parsed.date : void 0;
      if (aiDate && aiDate === date) {
        notes.push({ field: "日期", used: date, from: "ai", why: "AI 解析输入中的日期线索" });
      } else if (aiDate && aiDate !== date) {
        notes.push({ field: "日期", used: date, from: "rule", why: `本地规则校正：AI 原判 ${aiDate}，相对日期以规则计算为准` });
      } else {
        notes.push({ field: "日期", used: date, from: "rule", why: "AI 漏填日期，从原文提取" });
      }
    }
    console.log(
      "[parse-expense] ai ok:",
      JSON.stringify({ type, amount: Number(parsed.amount), merchant, category, date })
    );
    return {
      amount: Number(parsed.amount),
      merchant,
      category,
      type,
      date,
      // 确认文案由本地模板生成：8B 小模型中文生成不稳定（曾出现乱码），不再采用 AI 文案
      message: buildTemplateMessage(Number(parsed.amount), merchant, type, date),
      success: true,
      parsedBy: "ai",
      explanation: {
        raw: {
          amount: typeof parsed.amount === "number" ? parsed.amount : Number(parsed.amount),
          merchant: rawMerchant,
          category: typeof parsed.category === "string" ? parsed.category : void 0,
          type: typeof parsed.type === "string" ? parsed.type : void 0,
          date: typeof parsed.date === "string" ? parsed.date : void 0
        },
        notes
      }
    };
  } catch (error) {
    console.error("[parse-expense] AI call failed, fallback to regex. input:", input, "error:", error instanceof Error ? error.message : error);
    return fallbackParsing(input);
  }
}
function normalizeIncomeMerchant(merchant) {
  let m = merchant.trim();
  if (!m) return "收入";
  m = m.replace(/(收入|进账|入账|到账|款项|货款)+$/g, "").trim();
  m = m.replace(/^(卖了|卖掉|卖出|售出|卖|收到|收到了|进账|入账|到账|收入|转账|退了|退款|报销了|报销)+/g, "").trim();
  return m || "收入";
}
function buildTemplateMessage(amount, merchant, type, date) {
  const today = toTodayStr();
  let prefix = "";
  if (date && date !== today) {
    const [, m, d] = date.split("-");
    prefix = `${Number(m)}月${Number(d)}日 `;
  }
  const amt = Number(amount.toFixed(2)).toString();
  const amtText = type === "income" ? `+¥${amt}` : `¥${amt}`;
  const templates = type === "income" ? [
    `已入账：${prefix}${merchant} ${amtText}`,
    `${prefix}${merchant} ${amtText} 到账，记好啦`,
    `收到，${prefix}${merchant} ${amtText} 已入账`
  ] : [
    `已记录：${prefix}${merchant} ${amtText}`,
    `${prefix}${merchant} ${amtText} 记好啦`,
    `收到，${prefix}${merchant} ${amtText} 已记下`
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}
const REWARD_INCOME_KW_RE = /(红包|奖励|奖金|补贴|稿费|奖学金|中奖|佣金|分红|利息|劳务费|感谢费|出场费|报销|退款|退税|工资|薪水)/;
const GIVING_VERB_RE = /(给|发|送|赠|请客|买单|支出)/;
const EXPENSE_ACTION_RE = /(花|买|付|消费|充|打车|吃|喝|购|下单|订|缴|交费|停车|加油)/;
const DATE_CLUE_RE = /今天|昨天|前天|大前天|\d+\s*天前|[周星期][一二三四五六日天末]|\d{4}[-/.年]|\d{1,2}\s*月|\d{1,2}\s*[日号]|\d{1,2}[-/]\d{1,2}(?!\d)/;
const RELATIVE_DATE_RE = /^(?!.*\d{4})[\s\S]*?(今天|昨天|前天|大前天|today|yesterday)/i;
function extractJson(text) {
  const cleaned = text.replace(/ɛ[\s\S]*?ɛ/g, " ").replace(/ɛ/g, " ");
  const candidates = [];
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(cleaned.slice(first, last + 1));
  let pos = cleaned.indexOf("{");
  while (pos !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = pos; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(pos, i + 1));
          break;
        }
      }
    }
    pos = text.indexOf("{", pos + 1);
  }
  const truncStart = cleaned.indexOf("{");
  if (truncStart !== -1 && truncStart < cleaned.length - 1) {
    let t = cleaned.slice(truncStart).trim();
    t = t.replace(/,\s*"[^"]*"?\s*:?\s*$/, "").replace(/,\s*$/, "");
    if (!t.endsWith("}")) {
      const quotes = (t.match(/"/g) || []).length;
      if (quotes % 2 === 1) t += '"';
      t = t.replace(/"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
      t += "}";
    }
    candidates.push(t);
  }
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object") return obj;
    } catch {
    }
  }
  return null;
}
function isValidExpenseJson(parsed) {
  if (!parsed.amount || typeof parsed.category !== "string") {
    return false;
  }
  const category = parsed.category;
  return category === "Income" || EXPENSE_CATEGORIES.includes(category);
}
function numeralWordsToNumber(text) {
  const digit = {
    "零": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9
  };
  const unit = { "十": 10, "百": 100, "千": 1e3, "万": 1e4 };
  let total = 0;
  let section = 0;
  let current = 0;
  let matched = false;
  let lastUnit = null;
  for (const ch of text) {
    if (ch in digit) {
      current = digit[ch];
      matched = true;
    } else if (ch in unit) {
      matched = true;
      if (ch === "万") {
        section = (section + current) * 1e4;
        total += section;
        section = 0;
      } else {
        if (ch === "十" && current === 0) {
          current = 1;
        }
        section += current * unit[ch];
      }
      current = 0;
      lastUnit = ch;
    } else {
      return null;
    }
  }
  if (!matched) return null;
  if (current > 0 && (lastUnit === "百" || lastUnit === "千")) {
    current *= 10;
  }
  return total + section + current;
}
function extractAmount(input) {
  const cleaned = input.replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g, " ").replace(/\d{1,2}\s*月/g, " ").replace(/\d{1,2}\s*[日号]/g, " ").replace(/\d{4}\s*年/g, " ").replace(/\d+\s*天前/g, " ").replace(/\d{1,2}:\d{2}/g, " ");
  const commaMatch = cleaned.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/);
  if (commaMatch) {
    const amount = parseFloat(commaMatch[0].replace(/,/g, ""));
    if (amount > 0) return amount;
  }
  const arabicMatch = cleaned.match(
    /(?:[$¥]\s*)?(\d+(?:\.\d+)?)(?:\s*(?:元|刀)|(\s*块(?:钱)?([05])?))?/
  );
  if (arabicMatch) {
    let amount = parseFloat(arabicMatch[1]);
    if (arabicMatch[3] !== void 0) {
      amount += Number(arabicMatch[3]) * 0.1;
    }
    if (amount > 0) return amount;
  }
  const cnMatch = cleaned.match(/([零一二两三四五六七八九十百千万]+)(?:块([五5])|元|刀|块钱)?/);
  if (cnMatch) {
    const value = numeralWordsToNumber(cnMatch[1]);
    if (value !== null && value > 0) {
      if (cnMatch[2] === "五" || cnMatch[2] === "5") return value + 0.5;
      return value;
    }
  }
  return 0;
}
const CN_CATEGORY_KEYWORDS = [
  ["Food & Dining", /(咖啡|餐厅|外卖|奶茶|三餐|早饭|午饭|晚饭|买菜|超市|火锅|烧烤|水果|零食|小吃)/],
  ["Transportation", /(打车|滴滴|地铁|公交|加油|停车|高铁|火车|机票|共享单车|快递|邮费)/],
  ["Shopping", /(淘宝|京东|拼多多|天猫|衣服|鞋子|数码|手机|电脑|网购|日用)/],
  ["Entertainment", /(电影|游戏|会员|演唱会|桌游|剧本杀|KTV|娱乐|爱奇艺|腾讯视频|Steam)/],
  ["Bills & Utilities", /(房租|水电|煤气|网费|话费|物业|水电费)/],
  ["Healthcare", /(医院|药店|买药|看病|挂号|体检|牙医|诊所)/],
  ["Education", /(书|课程|学费|培训|考试|教材|网课|教辅)/],
  ["Personal Care", /(理发|健身|瑜伽|美容|护肤|化妆品|洗牙)/],
  ["Travel", /(酒店|民宿|签证|旅游)/]
];
function fallbackParsing(input) {
  const amount = extractAmount(input);
  const isIncome = /(收到|到账|收入|工资|薪水|薪|红包|报销|退款|退了|奖金|奖励|补贴|稿费|奖学金|中奖|佣金|分红|利息|劳务费|退税|卖二手|卖了|涨薪|salary|received|refund|bonus)/i.test(input);
  let category = "Other";
  let merchant = "Unknown";
  if (isIncome) {
    category = "Income";
    const incMatch = input.match(/(工资|薪水|红包|报销|退款|奖金|奖励|补贴|稿费|中奖|利息|salary|bonus|refund)/i);
    merchant = normalizeIncomeMerchant(incMatch ? incMatch[1] : "收入");
  } else {
    for (const [cat, pattern] of CN_CATEGORY_KEYWORDS) {
      const m = input.match(pattern);
      if (m) {
        category = cat;
        merchant = m[1];
        break;
      }
    }
    if (category === "Other") {
      if (/(coffee|starbucks|food|lunch|dinner|breakfast|restaurant|cafe|pizza|burger|groceries)/i.test(input)) {
        category = "Food & Dining";
      } else if (/(gas|uber|lyft|taxi|parking|metro|bus|train|flight)/i.test(input)) {
        category = "Transportation";
      } else if (/(shop|amazon|walmart|target|store|bought|purchase|clothes)/i.test(input)) {
        category = "Shopping";
      } else if (/(movie|netflix|spotify|game|concert)/i.test(input)) {
        category = "Entertainment";
      } else if (/(rent|electric|water|internet|phone bill|utilit)/i.test(input)) {
        category = "Bills & Utilities";
      } else if (/(doctor|hospital|pharmacy|medicine|medical|dental)/i.test(input)) {
        category = "Healthcare";
      }
    }
  }
  if (merchant === "Unknown" && !isIncome) {
    const words = input.split(/\s+/);
    const capitalizedWords = words.filter(
      (w) => w.length > 2 && w[0] === w[0].toUpperCase() && !["I", "A", "The", "On", "At", "In", "For"].includes(w)
    );
    if (capitalizedWords.length > 0) {
      merchant = capitalizedWords[0];
    }
  }
  const type = isIncome ? "income" : "expense";
  const date = extractDate(input);
  return {
    amount,
    merchant,
    category,
    type,
    date,
    message: amount > 0 ? buildTemplateMessage(amount, merchant, type, date) : "请告诉我具体金额。",
    success: amount > 0,
    parsedBy: "fallback",
    explanation: {
      raw: {},
      notes: [
        { field: "金额", used: String(amount), from: "rule", why: "AI 不可用，正则规则提取金额" },
        { field: "分类", used: category, from: "rule", why: "关键词匹配分类" },
        ...date ? [{ field: "日期", used: date, from: "rule", why: "正则提取日期线索" }] : []
      ]
    }
  };
}
function extractDate(input) {
  const today = new Date(Date.now() + 8 * 36e5);
  if (/今天|today/i.test(input)) return toBJDateStr(today);
  if (/昨天|yesterday/i.test(input)) {
    today.setUTCDate(today.getUTCDate() - 1);
    return toBJDateStr(today);
  }
  if (/前天/i.test(input)) {
    today.setUTCDate(today.getUTCDate() - 2);
    return toBJDateStr(today);
  }
  const fullMatch = input.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (fullMatch) {
    return buildDateStr(Number(fullMatch[1]), Number(fullMatch[2]), Number(fullMatch[3]));
  }
  const monthDay = input.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/) || input.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?!\d)/);
  if (monthDay) {
    const year = monthDay[1] ? Number(monthDay[1]) : void 0;
    return buildDateStr(year, Number(monthDay[2]), Number(monthDay[3]));
  }
  const daysAgo = input.match(/(\d+)\s*天前/);
  if (daysAgo) {
    today.setUTCDate(today.getUTCDate() - Number(daysAgo[1]));
    return toBJDateStr(today);
  }
  return void 0;
}
function toBJDateStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function buildDateStr(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return void 0;
  let year = y ?? new Date(Date.now() + 8 * 36e5).getUTCFullYear();
  const dt = new Date(year, m - 1, d);
  if (dt.getFullYear() !== year || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return void 0;
  }
  if (!y && dt.getTime() > Date.now()) {
    year -= 1;
  }
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const INTENTS = {
  ADD_EXPENSE: "ADD_EXPENSE",
  QUERY: "QUERY",
  DELETE_EXPENSE: "DELETE_EXPENSE",
  MANAGE_SUBSCRIPTION: "MANAGE_SUBSCRIPTION",
  // 新增/修改/删除周期账单
  HELP: "HELP",
  UNKNOWN: "UNKNOWN"
};
function getIntentPrompt(input) {
  return `Classify the user's intent from their input.

USER INPUT: "${input}"

INTENTS:
1. ADD_EXPENSE - User is logging/adding a new expense
   Examples:
   - "I spent $50 on coffee"
   - "Bought groceries for $120"
   - "Gas was $60"
   - "我在星巴克花了35块买拿铁"
   - "今天午饭花了三十五块五"
   - "打车去机场花了45"
   - "宣讲会提问奖励300"
   - "收到活动奖金 500"

2. QUERY - User is asking about their expenses/spending
   Examples:
   - "How much did I spend on food?"
   - "What's my total this week?"
   - "Show me my coffee expenses"
   - "我这个月花了多少钱"
   - "查一下我吃饭花了多少"

3. DELETE_EXPENSE - User wants to delete/remove an expense
   Examples:
   - "Delete the pizza expense"
   - "Remove the Starbucks payment"
   - "Delete that $50 coffee"
   - "Remove last expense"
   - "Delete the wrong one"
   - "删除上一笔记录"
   - "把刚才那笔星巴克删掉"

4. HELP - User needs help
   Examples:
   - "What can you do?"
   - "Help"
   - "你能做什么"

5. MANAGE_SUBSCRIPTION - User wants to create/update/delete a recurring subscription
   Examples:
   - "每月 10 号记房租 3500 元，分类居住"
   - "添加一个 iCloud 订阅，每月 6 号 6 元"
   - "把房租改成 4000"
   - "删掉 Netflix 订阅"
   - "每月 5 号宽带费 99 元"

6. UNKNOWN - Cannot determine intent

RULES:
- If mentions 每月/每月X号/订阅/扣款/自动重复/固定支出 or recurring/subscription → MANAGE_SUBSCRIPTION
- IMPORTANT: a ONE-OFF reward / received-money statement is NOT a subscription. "宣讲会提问奖励300", "收了个红包200", "收到活动奖金500", "工资到账8000" → ADD_EXPENSE (income), never MANAGE_SUBSCRIPTION
- If mentions "delete", "remove", "cancel", "undo" or 删除/去掉/撤销/删掉 → DELETE_EXPENSE
- If mentions spending/buying WITH amount or 收入/到账/红包/奖励/奖金 keywords → ADD_EXPENSE
- If asks questions about money or 怎么花/花了多少/查 → QUERY
- Chinese input follows the same semantic rules

OUTPUT (JSON only):
{
  "intent": "DELETE_EXPENSE",
  "confidence": 0.95
}`;
}
const INTENT_SYSTEM_MESSAGE = "You classify user intent accurately. Respond with JSON only.";
const INTENT_CONFIG = {
  temperature: 0.1,
  max_tokens: 50
};
async function classifyIntent(AI, input) {
  if (!AI) {
    return quickIntentDetection(input);
  }
  try {
    const prompt = getIntentPrompt(input);
    const response = await AI.run(
      GLM_MODEL,
      {
        messages: [
          { role: "system", content: INTENT_SYSTEM_MESSAGE },
          { role: "user", content: prompt }
        ],
        temperature: INTENT_CONFIG.temperature,
        max_tokens: INTENT_CONFIG.max_tokens,
        ...GLM_THINKING_OFF
      }
    );
    const text = stripThinking(extractAiText(response));
    if (!text || typeof text !== "string") {
      return quickIntentDetection(input);
    }
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const intent = parsed.intent;
      if (intent === INTENTS.MANAGE_SUBSCRIPTION && REWARD_INCOME_HINT_RE.test(input) && !SUBSCRIPTION_HINT_RE.test(input) && quickIntentDetection(input) === INTENTS.ADD_EXPENSE) {
        console.warn("[classify-intent] subscription misroute corrected → ADD_EXPENSE. input:", input);
        return INTENTS.ADD_EXPENSE;
      }
      return intent;
    }
  } catch {
  }
  return quickIntentDetection(input);
}
const REWARD_INCOME_HINT_RE = /(红包|奖励|奖金|补贴|稿费|奖学金|中奖|佣金|分红|利息|劳务费|退税|报销|退款|到账|工资|薪水)/;
const SUBSCRIPTION_HINT_RE = /(每月|每个月|月结|订阅|扣款|定期|固定|自动|recurring|subscription|续费|改成|涨价|变更|修改)/i;
function quickIntentDetection(input) {
  const lower = input.toLowerCase();
  if (/(?:delete|remove|cancel|undo|erase|get rid of)/.test(lower)) {
    return INTENTS.DELETE_EXPENSE;
  }
  if (/(删除|删掉|去掉|撤销|清除)/.test(input)) {
    return INTENTS.DELETE_EXPENSE;
  }
  if (/(每月|每个月|月结|订阅|扣款|定期|固定支出|recurring|subscription)/i.test(input)) {
    return INTENTS.MANAGE_SUBSCRIPTION;
  }
  if (/(?:how much|what.*spent|show.*expense|total|sum)/i.test(lower)) {
    return INTENTS.QUERY;
  }
  if (/(花了多少|多少钱|查一下|看看.*支出|汇总|统计|总共)/.test(input)) {
    return INTENTS.QUERY;
  }
  if (/(?:spent|bought|paid|purchased|cost|was|got).*\$?\d+/.test(lower)) {
    return INTENTS.ADD_EXPENSE;
  }
  if (/\$?\d+.*(?:spent|bought|paid|for|on)/.test(lower)) {
    return INTENTS.ADD_EXPENSE;
  }
  if (/(\d+(?:\.\d+)?\s*(?:块|元|刀|¥)|[¥$]\s*\d+(?:\.\d+)?|花了|买了|付了|消费|到账|工资|红包|奖励|奖金|补贴|稿费|报销|退款|收入)/.test(input)) {
    return INTENTS.ADD_EXPENSE;
  }
  if (/(?:help|what can|how do|commands)/i.test(lower)) {
    return INTENTS.HELP;
  }
  if (/(你能做什么|怎么用|帮助)/.test(input)) {
    return INTENTS.HELP;
  }
  return INTENTS.UNKNOWN;
}
function getQueryPrompt(userQuestion, expenses) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {});
  return `You are a friendly financial assistant answering a user's question about their expenses.

USER QUESTION: "${userQuestion}"

EXPENSES DATA:
- Total expenses: ${expenses.length}
- Total amount: ¥${total.toFixed(2)}
- By category: ${JSON.stringify(byCategory)}
- Recent expenses: ${JSON.stringify(expenses.slice(-5))}

ANSWER NATURALLY:
- Be conversational and friendly
- Give specific numbers
- Keep answer brief (2-3 sentences max)
- If asking about specific category, focus on that
- Reply in the SAME language the user used (Chinese question → Chinese answer)

EXAMPLES:

Q: "How much on food?"
A: "You've spent ¥287 on Food & Dining so far. That's across 12 transactions."

Q: "What's my total?"
A: "Your total spending is ¥1,245 this month."

Q: "Show me coffee expenses"
A: "You've spent ¥65 on coffee across 8 visits. Average is about ¥8 per trip."

Q: "我这个月花了多少钱"
A: "这个月你总共花了 1,245 元，其中餐饮类最多。"

Q: "吃饭花了多少"
A: "餐饮方面到目前为止花了 287 元，共 12 笔。"

Respond naturally in 1-2 sentences.`;
}
const QUERY_SYSTEM_MESSAGE = "You are a helpful financial assistant providing brief, friendly answers about expenses.";
const QUERY_CONFIG = {
  temperature: 0.5,
  max_tokens: 150
};
async function queryExpenses(AI, question, expenses) {
  if (expenses.length === 0) {
    return fallbackQueryResponse(question, expenses);
  }
  if (!AI) {
    return fallbackQueryResponse(question, expenses);
  }
  try {
    const prompt = getQueryPrompt(question, expenses);
    const response = await AI.run(
      GLM_MODEL,
      {
        messages: [
          { role: "system", content: QUERY_SYSTEM_MESSAGE },
          { role: "user", content: prompt }
        ],
        temperature: QUERY_CONFIG.temperature,
        max_tokens: QUERY_CONFIG.max_tokens,
        ...GLM_THINKING_OFF
      }
    );
    const text = stripThinking(extractAiText(response));
    if (text) {
      return text.trim();
    }
  } catch {
  }
  return fallbackQueryResponse(question, expenses);
}
function fallbackQueryResponse(question, expenses) {
  if (expenses.length === 0) {
    return /(花了|多少钱|支出|查|汇总)/.test(question) ? "你还没有记账记录！试着说「我花了 50 块买咖啡」开始记账吧。" : "You haven't logged any expenses yet! Start by saying 'I spent ¥50 on something'.";
  }
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const count = expenses.length;
  const lower = question.toLowerCase();
  const isChinese = /(花了|多少钱|支出|查|汇总|总共)/.test(question);
  if (lower.includes("total") || /(总共|汇总|一共)/.test(question)) {
    return isChinese ? `你目前共有 ${count} 笔记录，总计 ¥${total.toFixed(2)}。` : `Your total spending is ¥${total.toFixed(2)} across ${count} expenses.`;
  }
  if (lower.includes("food") || /(吃|饭|餐饮)/.test(question)) {
    const food = expenses.filter((e) => e.category === "Food & Dining");
    const foodTotal = food.reduce((sum, e) => sum + e.amount, 0);
    return isChinese ? `餐饮方面你花了 ¥${foodTotal.toFixed(2)}。` : `You've spent ¥${foodTotal.toFixed(2)} on Food & Dining.`;
  }
  return isChinese ? `你共有 ${count} 笔记录，总计 ¥${total.toFixed(2)}。` : `You have ${count} expenses totaling ¥${total.toFixed(2)}.`;
}
function getDeletePrompt(userInput, expenses) {
  const recentExpenses = expenses.slice(-10).map(
    (e, idx) => `${idx + 1}. ¥${e.amount} - ${e.merchant} (${e.category}) on ${e.date}`
  ).join("\n");
  return `User wants to delete an expense. Identify which one.

USER SAID: "${userInput}"

RECENT EXPENSES:
${recentExpenses}

RULES:
- Match by merchant name (e.g., "pizza" → expense with merchant "Pizza")
- Match by amount (e.g., "¥50" → expense with amount 50)
- Match by category (e.g., "food expense" → Food & Dining category)
- If says "last" or "recent" or 上一笔/最近一笔 → pick most recent (highest index)
- Chinese input: 刚才那笔/那笔XX/45块的那笔 → match by merchant, amount or recency
- If unclear, return expenseIndex: null

OUTPUT (JSON only):
{
  "expenseIndex": 5,
  "confidence": 0.9,
  "message": "Deleted ¥12 Pizza Hut expense."
}

If can't determine which expense:
{
  "expenseIndex": null,
  "confidence": 0,
  "message": "Which expense do you want to delete? I found multiple."
}`;
}
const DELETE_SYSTEM_MESSAGE = "You help identify which expense to delete based on user description.";
const DELETE_CONFIG = {
  temperature: 0.2,
  max_tokens: 100
};
async function identifyExpenseToDelete(AI, userInput, expenses) {
  if (expenses.length === 0) {
    return {
      expenseId: null,
      message: "You don't have any expenses to delete!",
      success: false
    };
  }
  if (!AI) {
    return fallbackDeleteIdentification(userInput, expenses);
  }
  try {
    const prompt = getDeletePrompt(userInput, expenses);
    const response = await AI.run(
      GLM_MODEL,
      {
        messages: [
          { role: "system", content: DELETE_SYSTEM_MESSAGE },
          { role: "user", content: prompt }
        ],
        temperature: DELETE_CONFIG.temperature,
        max_tokens: DELETE_CONFIG.max_tokens,
        ...GLM_THINKING_OFF
      }
    );
    const text = stripThinking(extractAiText(response));
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.expenseIndex !== null && parsed.expenseIndex >= 0) {
        const expenseIdx = parsed.expenseIndex - 1;
        const recentExpenses = expenses.slice(-10);
        if (expenseIdx >= 0 && expenseIdx < recentExpenses.length) {
          const expense = recentExpenses[expenseIdx];
          return {
            expenseId: expense.id,
            message: parsed.message || `Deleted ¥${expense.amount} ${expense.merchant} expense.`,
            success: true
          };
        }
      }
      return {
        expenseId: null,
        message: parsed.message || "Could you be more specific? Which expense?",
        success: false
      };
    }
  } catch {
  }
  return fallbackDeleteIdentification(userInput, expenses);
}
function fallbackDeleteIdentification(userInput, expenses) {
  const lower = userInput.toLowerCase();
  const isBulkDelete = /(?:all|every)/.test(lower) || /(全部|所有)/.test(userInput);
  const merchantHit = [...expenses].reverse().find((expense) => {
    const merchantLower = (expense.merchant || "").toLowerCase();
    return merchantLower && lower.includes(merchantLower);
  });
  if (merchantHit) {
    return {
      expenseId: merchantHit.id,
      message: `Deleted ¥${merchantHit.amount} ${merchantHit.merchant} expense.`,
      success: true
    };
  }
  if (/(?:last|recent|latest)/.test(lower) || /(上一笔|最近一笔|刚才那笔|最后一笔)/.test(userInput)) {
    if (!isBulkDelete) {
      const lastExpense = expenses[expenses.length - 1];
      return {
        expenseId: lastExpense.id,
        message: `Deleted your last expense: ¥${lastExpense.amount} for ${lastExpense.merchant}.`,
        success: true
      };
    }
  }
  const amountMatch = userInput.match(/\$?(\d+(?:\.\d{2})?)/);
  if (amountMatch) {
    const amount = parseFloat(amountMatch[1]);
    if (isBulkDelete) {
      const matchingExpenses = expenses.filter((e) => e.amount === amount);
      if (matchingExpenses.length > 0) {
        return {
          expenseId: null,
          expenseIds: matchingExpenses.map((e) => e.id),
          message: `Deleted all ${matchingExpenses.length} expense(s) of ¥${amount.toFixed(2)}.`,
          success: true,
          isBulkDelete: true
        };
      }
    } else {
      const matchingExpense = expenses.find((e) => e.amount === amount);
      if (matchingExpense) {
        return {
          expenseId: matchingExpense.id,
          message: `Deleted ¥${amount} expense.`,
          success: true
        };
      }
    }
  }
  return {
    expenseId: null,
    message: "I couldn't find that expense. Can you be more specific?",
    success: false
  };
}
const SYSTEM_MESSAGE = "你是一个家庭记账分析师。根据用户给出的月度账单数据，输出一段简洁的中文消费报告：先用 1-2 句概括整体收支；再给出 2-3 条具体观察（最大支出分类、环比变化、值得注意的商户或收入来源）；最后给 1 条简短可执行的建议。只用纯文本段落，不要 markdown 列表、标题和表情符号，总长 150-250 字。";
function round2(n) {
  return Math.round(n * 100) / 100;
}
async function generateMonthlyReport(AI, month, expenses) {
  const [y, m] = month.split("-").map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const inMonth = expenses.filter((e) => e.date?.slice(0, 7) === month);
  const inPrev = expenses.filter((e) => e.date?.slice(0, 7) === prevKey);
  const sumBy = (list, type) => list.filter((e) => type === "income" ? e.type === "income" : e.type !== "income").reduce((s, e) => s + e.amount, 0);
  const expenseTotal = sumBy(inMonth, "expense");
  const incomeTotal = sumBy(inMonth, "income");
  const prevExpenseTotal = sumBy(inPrev, "expense");
  const byCategory = {};
  const byMerchant = {};
  const incomeBySource = {};
  for (const e of inMonth) {
    if (e.type === "income") {
      const src = normalizeIncomeMerchant((e.merchant || e.description || "其他收入").trim()) || "其他收入";
      incomeBySource[src] = (incomeBySource[src] || 0) + e.amount;
      continue;
    }
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const merch = (e.merchant || e.description || "其他").trim().slice(0, 12) || "其他";
    byMerchant[merch] = (byMerchant[merch] || 0) + e.amount;
  }
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  const data = {
    month,
    totalExpense: round2(expenseTotal),
    totalIncome: round2(incomeTotal),
    balance: round2(incomeTotal - expenseTotal),
    recordCount: inMonth.length,
    prevMonthExpense: round2(prevExpenseTotal),
    momChange: prevExpenseTotal > 0 ? `${((expenseTotal - prevExpenseTotal) / prevExpenseTotal * 100).toFixed(1)}%` : "N/A（上月无数据）",
    topCategories: top(byCategory, 5).map(([name, v]) => ({
      name,
      amount: round2(v),
      share: expenseTotal > 0 ? `${(v / expenseTotal * 100).toFixed(1)}%` : "0%"
    })),
    topMerchants: top(byMerchant, 5).map(([name, v]) => ({ name, amount: round2(v) })),
    incomeSources: top(incomeBySource, 5).map(([name, v]) => ({ name, amount: round2(v) }))
  };
  if (!AI || inMonth.length === 0) {
    return fallbackReport(month, data);
  }
  try {
    const response = await AI.run(
      GLM_MODEL,
      {
        messages: [
          { role: "system", content: SYSTEM_MESSAGE },
          { role: "user", content: `账单数据（JSON）：
${JSON.stringify(data)}` }
        ],
        temperature: 0.6,
        max_tokens: 600,
        ...GLM_THINKING_OFF
      }
    );
    const text = stripThinking(extractAiText(response));
    if (text) return text.trim();
  } catch {
  }
  return fallbackReport(month, data);
}
function fallbackReport(month, d) {
  if (d.recordCount === 0) {
    return `${month} 还没有记账记录，暂时无法生成报告。记几笔之后再来找我总结吧。`;
  }
  const parts = [];
  parts.push(
    `${month} 共支出 ¥${d.totalExpense.toFixed(2)}（${d.recordCount} 笔），收入 ¥${d.totalIncome.toFixed(2)}，结余 ¥${d.balance.toFixed(2)}。`
  );
  if (d.momChange !== "N/A（上月无数据）") {
    parts.push(`相比上月（¥${d.prevMonthExpense.toFixed(2)}），支出变化 ${d.momChange}。`);
  }
  if (d.topCategories.length > 0) {
    const c = d.topCategories[0];
    parts.push(`支出最大的分类是${c.name}，共 ¥${c.amount.toFixed(2)}，占 ${c.share}。`);
  }
  if (d.topMerchants.length > 0) {
    parts.push(
      `消费较多的商户有 ${d.topMerchants.slice(0, 3).map((x) => `${x.name}（¥${x.amount.toFixed(0)}）`).join("、")}。`
    );
  }
  parts.push("继续保持记账习惯，定期回顾分类占比，会让预算更健康。");
  return parts.join("");
}
async function generateWeeklyReport(AI, weekStart, expenses) {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - 6);
  const inWeek = expenses.filter((e) => e.date >= weekStart && e.date <= weekEnd);
  const inPrev = expenses.filter(
    (e) => e.date >= prevStart.toISOString().slice(0, 10) && e.date <= prevEnd.toISOString().slice(0, 10)
  );
  const expenseTotal = inWeek.filter((e) => e.type !== "income").reduce((s, e) => s + e.amount, 0);
  const incomeTotal = inWeek.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const prevExpenseTotal = inPrev.filter((e) => e.type !== "income").reduce((s, e) => s + e.amount, 0);
  const byCategory = {};
  const byMerchant = {};
  const byMember = {};
  const daily = {};
  for (const e of inWeek) {
    if (e.type === "income") continue;
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const merch = (e.merchant || e.description || "其他").trim().slice(0, 12) || "其他";
    byMerchant[merch] = (byMerchant[merch] || 0) + e.amount;
    const member = e.by || "未知";
    byMember[member] = (byMember[member] || 0) + e.amount;
    daily[e.date] = (daily[e.date] || 0) + e.amount;
  }
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  const data = {
    weekStart,
    weekEnd,
    totalExpense: round2(expenseTotal),
    totalIncome: round2(incomeTotal),
    recordCount: inWeek.length,
    prevWeekExpense: round2(prevExpenseTotal),
    wowChange: prevExpenseTotal > 0 ? `${((expenseTotal - prevExpenseTotal) / prevExpenseTotal * 100).toFixed(1)}%` : "N/A（上周无数据）",
    topCategories: top(byCategory, 5).map(([name, v]) => ({
      name,
      amount: round2(v),
      share: expenseTotal > 0 ? `${(v / expenseTotal * 100).toFixed(1)}%` : "0%"
    })),
    topMerchants: top(byMerchant, 5).map(([name, v]) => ({ name, amount: round2(v) })),
    byMember: top(byMember, 5).map(([name, v]) => ({ name, amount: round2(v) })),
    dailySpend: Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0])).map(([date, amount]) => ({ date, amount: round2(amount) }))
  };
  const sys = "你是一个家庭记账分析师。根据用户给出的周度账单数据，输出一段简洁的中文周报：1-2 句概括本周收支与环比；1-2 条具体观察（最大分类、高频商户、成员消费）；1 条下周建议。纯文本，不用 markdown，150 字以内。";
  if (AI && data.recordCount > 0) {
    try {
      const response = await AI.run(
        GLM_MODEL,
        {
          messages: [
            { role: "system", content: sys },
            { role: "user", content: `周账单数据（JSON）：
${JSON.stringify(data)}` }
          ],
          temperature: 0.6,
          max_tokens: 500,
          ...GLM_THINKING_OFF
        }
      );
      const text = stripThinking(extractAiText(response));
      if (text) return text.trim();
    } catch {
    }
  }
  const parts = [];
  if (data.recordCount === 0) {
    return `${weekStart} 这一周还没有记账记录。`;
  }
  parts.push(`本周（${weekStart} ~ ${weekEnd}）支出 ¥${data.totalExpense.toFixed(2)}（${data.recordCount} 笔），收入 ¥${data.totalIncome.toFixed(2)}。`);
  if (data.wowChange !== "N/A（上周无数据）") {
    parts.push(`环比上周（¥${data.prevWeekExpense.toFixed(2)}）变化 ${data.wowChange}。`);
  }
  if (data.topCategories.length > 0) {
    parts.push(`最大分类 ${data.topCategories[0].name}（¥${data.topCategories[0].amount.toFixed(0)}，占 ${data.topCategories[0].share}）。`);
  }
  if (data.byMember.length > 1) {
    parts.push(`成员消费：${data.byMember.slice(0, 3).map((m) => `${m.name} ¥${m.amount.toFixed(0)}`).join("、")}。`);
  }
  parts.push("建议保持每日记账，周末花 5 分钟回顾分类占比。");
  return parts.join("");
}
function detectAnomalies(expenses, budgets) {
  const now = /* @__PURE__ */ new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const inMonth = expenses.filter((e) => e.date?.slice(0, 7) === month && e.type !== "income");
  const monthSpend = inMonth.reduce((s, e) => s + e.amount, 0);
  const hints = [];
  for (const b of budgets) {
    const spent = b.kind === "total" ? monthSpend : inMonth.filter((e) => e.category === b.category).reduce((s, e) => s + e.amount, 0);
    if (b.amount > 0 && spent > b.amount) {
      const label = b.kind === "total" ? "总预算" : b.category || "分类预算";
      hints.push(`⚠️ ${month} ${label} 已超支：预算 ¥${b.amount.toFixed(0)}，实际 ¥${spent.toFixed(0)}（超出 ¥${(spent - b.amount).toFixed(0)}）`);
    } else if (b.amount > 0 && spent > b.amount * 0.8) {
      const label = b.kind === "total" ? "总预算" : b.category || "分类预算";
      hints.push(`🔔 ${month} ${label} 已用 ${(spent / b.amount * 100).toFixed(0)}%（¥${spent.toFixed(0)} / ¥${b.amount.toFixed(0)}），接近上限`);
    }
  }
  const dayOfMonth = now.getDate();
  const avgDaily = monthSpend / Math.max(dayOfMonth, 1);
  const bigOnes = inMonth.filter((e) => e.amount > 500 && e.amount > avgDaily * 3);
  if (bigOnes.length > 0) {
    const b = bigOnes.sort((x, y) => y.amount - x.amount)[0];
    hints.push(`💸 本月最大单笔 ¥${b.amount.toFixed(0)}（${b.merchant || b.category}，${b.date}），约为日均的 ${(b.amount / avgDaily).toFixed(1)} 倍`);
  }
  const incomeThisMonth = expenses.filter((e) => e.date?.slice(0, 7) === month && e.type === "income");
  if (monthSpend > 3e3 && incomeThisMonth.length === 0) {
    hints.push(`📉 ${month} 已支出 ¥${monthSpend.toFixed(0)} 但尚无收入记录，如属遗漏建议补记`);
  }
  return hints.slice(0, 3);
}
const COOKIE_NAME = "app_auth";
const SALT = "cf-ai-finance-tracker::auth-v1";
function jsonHeaders() {
  return { "Content-Type": "application/json; charset=utf-8" };
}
async function deriveToken(password) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${password}::${SALT}`)
  );
  const bytes = new Uint8Array(digest);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function tokenFromRequest(req) {
  const auth = req.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookie = req.headers.get("Cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq) === COOKIE_NAME) return pair.slice(eq + 1);
  }
  return null;
}
function makeAuthCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}
function verifyRequest(req, expectedToken) {
  const provided = tokenFromRequest(req);
  return !!provided && safeEqual(provided, expectedToken);
}
function authNotConfiguredResponse(pathname) {
  if (pathname.startsWith("/api/") || pathname === "/auth") {
    return new Response(
      JSON.stringify({ ok: false, configured: false, error: "AUTH_PASSWORD is not configured" }),
      { status: 503, headers: { ...jsonHeaders(), "Cache-Control": "no-store" } }
    );
  }
  return loginPageResponse();
}
function loginPageResponse() {
  return new Response(LOGIN_PAGE_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
async function handleAuthVerify(req, password) {
  if (!password) {
    return new Response(
      JSON.stringify({
        ok: false,
        configured: false,
        error: "服务器未配置 AUTH_PASSWORD（运行 wrangler secret put AUTH_PASSWORD）"
      }),
      { status: 503, headers: { ...jsonHeaders(), "Cache-Control": "no-store" } }
    );
  }
  const expected = await deriveToken(password);
  let provided = null;
  let isPassword = false;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      provided = typeof body.password === "string" ? body.password : null;
    } catch {
      provided = null;
    }
    isPassword = true;
  } else {
    provided = tokenFromRequest(req);
  }
  const providedValid = provided ? isPassword ? safeEqual(await deriveToken(provided), expected) : safeEqual(provided, expected) : false;
  if (providedValid) {
    return new Response(JSON.stringify({ ok: true, token: expected }), {
      status: 200,
      headers: {
        ...jsonHeaders(),
        "Set-Cookie": makeAuthCookie(expected),
        "Cache-Control": "no-store"
      }
    });
  }
  await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 150)));
  return new Response(JSON.stringify({ ok: false, error: "密码不正确" }), {
    status: 401,
    headers: { ...jsonHeaders(), "Cache-Control": "no-store" }
  });
}
const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Finance Tracker · 访问验证</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 600px at 20% -10%,#1e293b,#0f172a 60%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#e2e8f0;padding:16px}
.card{width:100%;max-width:380px;background:rgba(30,41,59,.75);border:1px solid rgba(148,163,184,.15);border-radius:18px;padding:36px 30px;box-shadow:0 24px 60px rgba(0,0,0,.45);backdrop-filter:blur(10px)}
.icon{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 18px}
h1{font-size:19px;text-align:center;margin-bottom:6px;font-weight:600}
p.sub{font-size:13px;color:#94a3b8;text-align:center;margin-bottom:24px}
input{width:100%;height:46px;border-radius:12px;border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.6);color:#e2e8f0;padding:0 14px;font-size:15px;outline:none;transition:border .15s}
input:focus{border-color:#f59e0b}
button{width:100%;height:46px;margin-top:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#f97316);color:#1c1917;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.9}
button:disabled{opacity:.55;cursor:wait}
.err{margin-top:14px;font-size:13px;color:#fca5a5;text-align:center;min-height:18px}
.tip{margin-top:18px;font-size:12px;color:#64748b;text-align:center;line-height:1.6}
</style>
</head>
<body>
<div class="card">
<div class="icon">🔐</div>
<h1>Finance Tracker</h1>
<p class="sub">私人应用 · 请输入访问密码继续</p>
<form id="f" autocomplete="off">
<input id="p" type="password" placeholder="访问密码" autofocus autocomplete="current-password">
<button id="b" type="submit">解锁</button>
<div class="err" id="e"></div>
</form>
<p class="tip">解锁一次后长期有效，无需重复输入</p>
</div>
<script>
var f=document.getElementById('f'),p=document.getElementById('p'),b=document.getElementById('b'),e=document.getElementById('e');
f.addEventListener('submit',function(ev){
ev.preventDefault();
var v=p.value;
if(!v)return;
b.disabled=true;e.textContent='';
fetch('/auth',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:v})}).then(function(r){
return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){
if(x.ok){location.reload()}
else{e.textContent=(x.j&&x.j.configured===false)?'服务器尚未配置 AUTH_PASSWORD（运行 wrangler secret put AUTH_PASSWORD）':'密码不正确，请重试';b.disabled=false}
}).catch(function(){e.textContent='网络错误，请重试';b.disabled=false})});
<\/script>
</body>
</html>`;
function rowToExpense(r) {
  const e = {
    id: String(r.id),
    amount: Number(r.amount),
    category: String(r.category),
    merchant: r.merchant === null || r.merchant === void 0 ? void 0 : String(r.merchant),
    description: String(r.description ?? ""),
    date: String(r.date),
    createdAt: Number(r.created_at),
    type: r.type === "income" ? "income" : "expense"
  };
  if (r.by !== null && r.by !== void 0) e.by = String(r.by);
  if (r.by_id !== null && r.by_id !== void 0) e.byId = String(r.by_id);
  if (r.parsed_by !== null && r.parsed_by !== void 0) e.parsedBy = String(r.parsed_by);
  if (r.idempotency_key !== null && r.idempotency_key !== void 0) e.idempotencyKey = String(r.idempotency_key);
  if (r.account_id !== null && r.account_id !== void 0) e.accountId = String(r.account_id);
  if (r.paid_by !== null && r.paid_by !== void 0) e.paidBy = String(r.paid_by);
  if (r.split_with !== null && r.split_with !== void 0) e.splitWith = String(r.split_with);
  if (r.dedup_hash !== null && r.dedup_hash !== void 0) e.dedupHash = String(r.dedup_hash);
  if (r.deleted_at !== null && r.deleted_at !== void 0) e.deletedAt = Number(r.deleted_at);
  return e;
}
async function d1GetExpenses(db, scope) {
  const { results } = await db.prepare("SELECT * FROM expenses WHERE scope = ? AND deleted_at IS NULL ORDER BY date ASC, created_at ASC").bind(scope).all();
  return (results || []).map(rowToExpense);
}
async function d1GetRecentExpenses(db, scope, limit) {
  const { results } = await db.prepare(
    "SELECT * FROM expenses WHERE scope = ? AND deleted_at IS NULL ORDER BY date DESC, created_at DESC LIMIT ?"
  ).bind(scope, Math.min(Math.max(limit, 1), 500)).all();
  return (results || []).map(rowToExpense).reverse();
}
function amountKey(amount) {
  return (Math.round(amount * 100) / 100).toFixed(2);
}
function dedupHashOf(scope, e) {
  const merchant = (e.merchant || e.description || "").trim().toLowerCase().slice(0, 30);
  return `${scope}|${amountKey(e.amount)}|${merchant}|${e.date}`;
}
async function d1AddExpense(db, scope, e, protectDeleted = false) {
  const hash = e.dedupHash || dedupHashOf(scope, e);
  const sql = `INSERT ${e.idempotencyKey ? "OR IGNORE " : ""}INTO expenses
    (id, scope, amount, category, merchant, description, date, created_at, type, by, by_id, parsed_by,
     idempotency_key, account_id, paid_by, split_with, dedup_hash)
    ${protectDeleted && e.idempotencyKey ? "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE scope = ? AND idempotency_key = ? AND deleted_at IS NOT NULL)" : "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"}`;
  const res = await db.prepare(sql).bind(
    e.id,
    scope,
    e.amount,
    e.category,
    e.merchant ?? null,
    e.description,
    e.date,
    e.createdAt,
    e.type ?? "expense",
    e.by ?? null,
    e.byId ?? null,
    e.parsedBy ?? null,
    e.idempotencyKey ?? null,
    e.accountId ?? null,
    e.paidBy ?? null,
    e.splitWith ?? null,
    hash,
    ...(protectDeleted && e.idempotencyKey ? [scope, e.idempotencyKey] : [])
  ).run();
  if (e.idempotencyKey && (res.meta.changes || 0) === 0) {
    const existing = await db.prepare("SELECT * FROM expenses WHERE scope = ? AND idempotency_key = ? AND deleted_at IS NULL").bind(scope, e.idempotencyKey).first();
    return existing ? rowToExpense(existing) : null;
  }
  return { ...e, dedupHash: hash };
}
async function d1FindDuplicate(db, scope, e) {
  const hash = dedupHashOf(scope, e);
  const { results } = await db.prepare(
    `SELECT * FROM expenses WHERE scope = ? AND dedup_hash = ? AND deleted_at IS NULL AND id != ? LIMIT 1`
  ).bind(scope, hash, e.excludeId || "__none__").all();
  return results && results[0] ? rowToExpense(results[0]) : null;
}
async function d1SoftDeleteExpense(db, scope, expenseId) {
  const now = Date.now();
  await db.prepare("UPDATE expenses SET deleted_at = ? WHERE scope = ? AND id = ? AND deleted_at IS NULL").bind(now, scope, expenseId).run();
  const row = await db.prepare("SELECT * FROM expenses WHERE scope = ? AND id = ?").bind(scope, expenseId).first();
  return row ? rowToExpense(row) : null;
}
async function d1SoftDeleteMany(db, scope, ids) {
  if (ids.length === 0) return 0;
  const now = Date.now();
  let changed = 0;
  const stmt = db.prepare("UPDATE expenses SET deleted_at = ? WHERE scope = ? AND id = ? AND deleted_at IS NULL");
  const results = await db.batch(ids.map((id) => stmt.bind(now, scope, id)));
  for (const r of results) changed += r.meta.changes || 0;
  return changed;
}
async function d1GetRecycleBin(db, scope) {
  const cutoff = Date.now() - 30 * 864e5;
  const { results } = await db.prepare(
    "SELECT * FROM expenses WHERE scope = ? AND deleted_at IS NOT NULL AND deleted_at >= ? ORDER BY deleted_at DESC LIMIT 200"
  ).bind(scope, cutoff).all();
  return (results || []).map(rowToExpense);
}
async function d1RestoreExpense(db, scope, expenseId) {
  await db.prepare("UPDATE expenses SET deleted_at = NULL WHERE scope = ? AND id = ? AND deleted_at IS NOT NULL").bind(scope, expenseId).run();
  const row = await db.prepare("SELECT * FROM expenses WHERE scope = ? AND id = ?").bind(scope, expenseId).first();
  return row ? rowToExpense(row) : null;
}
async function d1ClearExpenses(db, scope) {
  const now = Date.now();
  await db.prepare("UPDATE expenses SET deleted_at = ? WHERE scope = ? AND deleted_at IS NULL").bind(now, scope).run();
}
async function d1GetExpenseById(db, scope, expenseId) {
  const row = await db.prepare("SELECT * FROM expenses WHERE scope = ? AND id = ?").bind(scope, expenseId).first();
  return row ? rowToExpense(row) : null;
}
async function d1UpdateExpense(db, scope, expenseId, patch) {
  const sets = [];
  const vals = [];
  const push = (col, v) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.amount !== void 0) push("amount", patch.amount);
  if (patch.date !== void 0) push("date", patch.date);
  if (patch.type !== void 0) push("type", patch.type);
  if (patch.category !== void 0) push("category", patch.category);
  if (patch.merchant !== void 0) push("merchant", patch.merchant || null);
  if (patch.description !== void 0) push("description", patch.description);
  if (patch.accountId !== void 0) push("account_id", patch.accountId || null);
  if (patch.paidBy !== void 0) push("paid_by", patch.paidBy || null);
  if (patch.splitWith !== void 0) push("split_with", patch.splitWith || null);
  if (sets.length === 0) return null;
  const before = await db.prepare("SELECT * FROM expenses WHERE scope = ? AND id = ?").bind(scope, expenseId).first();
  if (!before) return null;
  const merged = { ...rowToExpense(before), ...patch };
  push("dedup_hash", dedupHashOf(scope, merged));
  vals.push(scope, expenseId);
  await db.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE scope = ? AND id = ?`).bind(...vals).run();
  const after = await db.prepare("SELECT * FROM expenses WHERE scope = ? AND id = ?").bind(scope, expenseId).first();
  return after ? rowToExpense(after) : rowToExpense(before);
}
async function d1BatchUpdateExpenses(db, scope, ids, patch) {
  if (ids.length === 0 || Object.keys(patch).length === 0) return 0;
  const cols = [];
  const vals = [];
  if (patch.category !== void 0) {
    cols.push("category = ?");
    vals.push(patch.category);
  }
  if (patch.date !== void 0) {
    cols.push("date = ?");
    vals.push(patch.date);
  }
  if (patch.accountId !== void 0) {
    cols.push("account_id = ?");
    vals.push(patch.accountId || null);
  }
  const sql = `UPDATE expenses SET ${cols.join(", ")} WHERE scope = ? AND id = ? AND deleted_at IS NULL`;
  const stmt = db.prepare(sql);
  const results = await db.batch(ids.map((id) => stmt.bind(...vals, scope, id)));
  let changed = 0;
  for (const r of results) changed += r.meta.changes || 0;
  return changed;
}
async function d1ImportExpenses(db, scope, list) {
  const existing = await d1GetExpenses(db, scope);
  const seen = new Set(existing.map((e) => e.id));
  let added = 0;
  for (const e of list) {
    if (e && e.id && !seen.has(e.id)) {
      await d1AddExpense(db, scope, { ...e, idempotencyKey: void 0 });
      seen.add(e.id);
      added++;
    }
  }
  return added;
}
async function d1MonthlyStats(db, scope, month) {
  const [totals, byCat] = await Promise.all([
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income
       FROM expenses WHERE scope = ? AND date LIKE ? AND deleted_at IS NULL`
    ).bind(scope, `${month}%`).first(),
    db.prepare(
      `SELECT category, SUM(amount) AS total FROM expenses
       WHERE scope = ? AND date LIKE ? AND type = 'expense' AND deleted_at IS NULL
       GROUP BY category ORDER BY total DESC`
    ).bind(scope, `${month}%`).all()
  ]);
  const byCategory = {};
  for (const row of byCat.results || []) byCategory[row.category] = Number(row.total);
  return {
    expense: Number(totals?.expense || 0),
    income: Number(totals?.income || 0),
    byCategory
  };
}
function rowToBudget(r) {
  const b = {
    id: String(r.id),
    scope: String(r.scope),
    kind: r.kind === "category" ? "category" : "monthly",
    amount: Number(r.amount),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
  if (r.category !== null && r.category !== void 0) b.category = String(r.category);
  return b;
}
async function d1GetBudgets(db, scope) {
  const { results } = await db.prepare("SELECT * FROM budgets WHERE scope = ? ORDER BY kind DESC, category ASC").bind(scope).all();
  return (results || []).map(rowToBudget);
}
async function d1SetBudget(db, scope, input) {
  const kind = input.kind === "category" ? "category" : "monthly";
  const category = kind === "category" ? input.category?.trim() || "Other" : null;
  const now = Date.now();
  const existing = await db.prepare("SELECT * FROM budgets WHERE scope = ? AND kind = ? AND category IS ?").bind(scope, kind, category).first();
  if (existing) {
    await db.prepare("UPDATE budgets SET amount = ?, updated_at = ? WHERE id = ?").bind(input.amount, now, existing.id).run();
    return { ...rowToBudget(existing), amount: input.amount, updatedAt: now };
  }
  const budget = {
    id: crypto.randomUUID(),
    scope,
    kind,
    category: category ?? void 0,
    amount: input.amount,
    createdAt: now,
    updatedAt: now
  };
  await db.prepare("INSERT INTO budgets (id, scope, kind, category, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(budget.id, scope, kind, category, budget.amount, now, now).run();
  return budget;
}
async function d1DeleteBudget(db, scope, id) {
  const res = await db.prepare("DELETE FROM budgets WHERE scope = ? AND id = ?").bind(scope, id).run();
  return (res.meta.changes || 0) > 0;
}
async function d1ImportBudgets(db, scope, list) {
  const existing = await d1GetBudgets(db, scope);
  const keyOf = (b) => `${b.kind}:${b.category ?? ""}`;
  const seen = new Set(existing.map(keyOf));
  let added = 0;
  for (const b of list) {
    if (!b || typeof b.amount !== "number" || !(b.amount > 0)) continue;
    const kind = b.kind === "category" ? "category" : "monthly";
    if (kind === "category" && !b.category) continue;
    if (seen.has(keyOf({ kind, category: b.category }))) continue;
    await d1SetBudget(db, scope, { kind, category: b.category, amount: b.amount });
    seen.add(keyOf({ kind, category: b.category }));
    added++;
  }
  return added;
}
async function d1AddAudit(db, entry) {
  await db.prepare(
    `INSERT INTO audit_log (id, scope, actor_username, actor_display, action, target_id, target_type, summary, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    entry.id || crypto.randomUUID(),
    entry.scope,
    entry.actorUsername,
    entry.actorDisplay ?? null,
    entry.action,
    entry.targetId ?? null,
    entry.targetType ?? null,
    String(entry.summary).slice(0, 300),
    entry.detail ?? null,
    Date.now()
  ).run();
}
async function d1GetAudit(db, scope, opts = {}) {
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
  const conds = ["scope = ?"];
  const vals = [scope];
  if (opts.actor) {
    conds.push("actor_username = ?");
    vals.push(opts.actor);
  }
  if (opts.action) {
    conds.push("action = ?");
    vals.push(opts.action);
  }
  if (opts.before != null && Number.isFinite(opts.before)) {
    conds.push("created_at < ?");
    vals.push(Number(opts.before));
  }
  if (opts.since != null && Number.isFinite(opts.since)) {
    conds.push("created_at >= ?");
    vals.push(Number(opts.since));
  }
  const { results } = await db.prepare(
    `SELECT * FROM audit_log WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
  ).bind(...vals, limit + 1).all();
  const rows = results || [];
  const hasMore = rows.length > limit;
  const entries = rows.slice(0, limit).map((r) => ({
    id: String(r.id),
    scope: String(r.scope),
    actorUsername: String(r.actor_username),
    actorDisplay: r.actor_display == null ? void 0 : String(r.actor_display),
    action: String(r.action),
    targetType: r.target_type == null ? void 0 : String(r.target_type),
    targetId: r.target_id == null ? void 0 : String(r.target_id),
    summary: String(r.summary ?? ""),
    detail: r.detail == null ? void 0 : String(r.detail),
    createdAt: Number(r.created_at)
  }));
  return { entries, hasMore };
}
async function d1GetAuditRetention(db, scope) {
  const row = await db.prepare("SELECT retention_days FROM audit_settings WHERE scope = ?").bind(scope).first();
  const days = Number(row?.retention_days || 0);
  return [0, 90, 180, 365].includes(days) ? days : 0;
}
async function d1SetAuditRetention(db, scope, days) {
  await db.prepare(
    `INSERT INTO audit_settings (scope, retention_days) VALUES (?, ?)
       ON CONFLICT(scope) DO UPDATE SET retention_days = excluded.retention_days`
  ).bind(scope, days).run();
}
async function d1ExportAudit(db, scope, limit = 5e3) {
  const { results } = await db.prepare("SELECT * FROM audit_log WHERE scope = ? ORDER BY created_at DESC LIMIT ?").bind(scope, Math.min(limit, 1e4)).all();
  return (results || []).map((r) => ({
    id: String(r.id),
    scope: String(r.scope),
    actorUsername: String(r.actor_username),
    actorDisplay: r.actor_display == null ? void 0 : String(r.actor_display),
    action: String(r.action),
    targetType: r.target_type == null ? void 0 : String(r.target_type),
    targetId: r.target_id == null ? void 0 : String(r.target_id),
    summary: String(r.summary ?? ""),
    detail: r.detail == null ? void 0 : String(r.detail),
    createdAt: Number(r.created_at)
  }));
}
async function parseSubscription(AI, input) {
  const fallback = () => {
    const monthRe = /每月(?:(\d{1,2})号?(?:[一二三四五六日]？)?)?/;
    const amountRe = /(\d+(?:\.\d{1,2})?)(块|元|¥|￥)/;
    const md = input.match(monthRe);
    const am = input.match(amountRe);
    if (!md || !am) return null;
    const day = Math.min(Math.max(Number(md[1] || 1), 1), 31);
    const amount = Number(am[1]);
    const name = input.replace(monthRe, "").replace(amountRe, "").trim() || "周期支出";
    let category = "Other";
    if (/住/i.test(name) || /租/i.test(name)) category = "Bills & Utilities";
    if (/衣|商|礼品|工资|裤/i.test(name)) category = "Shopping";
    if (/账/i.test(name) || /服|衣服/i.test(name)) category = "Bills & Utilities";
    if (/云订阅|icloud|网费|流量/i.test(name)) category = "Bills & Utilities";
    if (/健|医保|健身/i.test(name)) category = "Healthcare";
    if (/教|课程|学校/i.test(name)) category = "Education";
    if (/交通|油|加油|phone|话/i.test(name)) category = "Transportation";
    return {
      name,
      amount,
      category,
      dayOfMonth: day
    };
  };
  if (!AI) return fallback();
  const prompt = `将用户的自然语言解析成一个结构化 JSON，格式如下：
{
  "action": "create|update|delete|unknown",
  "name": "订阅名称（如房租、iCloud）",
  "amount": 3500.00,
  "category": "Bills & Utilities",
  "type": "expense|income",
  "dayOfMonth": 10
}

规则：
- category 必须从列表 [Food & Dining, Transportation, Shopping, Entertainment, Bills & Utilities, Healthcare, Education, Personal Care, Travel, Income, Other] 中选
- dayOfMonth = 每月几号入账（1 - 31，默认当月日期），“每月 > 28”月份会按当月最大日自动折算
- type 默认 expense，提到“工资/收入/到账”则 income
- 如果用户是明确删除或停用（删除、去掉、停用、uranium）则 action=delete
- 如果用户只是修改价格/日期/名称则 action=update
- 输出只返回 JSON，不要额外解释

用户输入：${input}`;
  try {
    const response = await AI.run(
      GLM_MODEL,
      {
        messages: [
          { role: "system", content: "You convert natural language subscription commands into a structured JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 200,
        ...GLM_THINKING_OFF
      }
    );
    const text = stripThinking(extractAiText(response));
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return fallback();
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.name || !parsed.dayOfMonth || !parsed.amount) return fallback();
    return {
      name: String(parsed.name),
      amount: Number(parsed.amount),
      category: parsed.category && EXPENSE_CATEGORIES.includes(String(parsed.category)) ? String(parsed.category) : "Other",
      dayOfMonth: Math.min(Math.max(Number(parsed.dayOfMonth), 1), 31)
    };
  } catch {
    return fallback();
  }
}
async function parseSubscriptionAction(AI, input) {
  if (!AI) {
    if (/(删除|删掉|去掉|停用|取消)/.test(input)) return { action: "delete" };
    if (/(修改|改成|调整为|update)/i.test(input)) return { action: "update" };
    return { action: "create" };
  }
  const prompt = `判断用户意图要执行的操作：create / update / delete。只输出 {"action": "create"} 等 JSON。用户： ${input}`;
  try {
    const response = await AI.run(
      GLM_MODEL,
      {
        messages: [
          { role: "system", content: "You classify subscription intent into JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.05,
        max_tokens: 20,
        ...GLM_THINKING_OFF
      }
    );
    const text = stripThinking(extractAiText(response));
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.action === "delete") return { action: "delete" };
      if (parsed.action === "update") return { action: "update" };
    }
  } catch {
  }
  if (/(删除|删掉|去掉|停用|取消)/.test(input)) return { action: "delete" };
  if (/(修改|改成|调整为|update)/i.test(input)) return { action: "update" };
  return { action: "create" };
}
const SESSION_TTL_MS = 30 * 864e5;
const PEPPER = "fiscus-session-v1";
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function createSession(db, username, userAgent) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  const token = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO account_sessions (id, username, token_hash, user_agent, created_at, expires_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).bind(sessionId, username, await sha256Hex(`${token}::${PEPPER}`), userAgent?.slice(0, 200) ?? null, now, now + SESSION_TTL_MS).run();
  await db.prepare(
    `INSERT INTO login_devices (key, username, session_id, user_agent, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET last_seen = excluded.last_seen`
  ).bind(`${username}|${sessionId}`, username, sessionId, userAgent?.slice(0, 200) ?? null, now, now).run();
  return { sessionId, token, expiresAt: now + SESSION_TTL_MS };
}
async function verifySession(db, token) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const tokenHash = await sha256Hex(`${token}::${PEPPER}`);
  const row = await db.prepare(
    "SELECT id, username, expires_at FROM account_sessions WHERE token_hash = ? AND revoked = 0"
  ).bind(tokenHash).first();
  if (!row) return null;
  const now = Date.now();
  if (Number(row.expires_at) < now) {
    await db.prepare("UPDATE account_sessions SET revoked = 1 WHERE id = ?").bind(row.id).run();
    return null;
  }
  await db.prepare("UPDATE account_sessions SET expires_at = ? WHERE id = ?").bind(now + SESSION_TTL_MS, row.id).run();
  await db.prepare("UPDATE login_devices SET last_seen = ? WHERE username = ? AND session_id = ?").bind(now, row.username, row.id).run();
  return row.username;
}
async function listDevices(db, username) {
  const { results } = await db.prepare(
    `SELECT d.session_id, d.user_agent, d.first_seen, d.last_seen, s.revoked, s.expires_at
       FROM login_devices d JOIN account_sessions s ON s.id = d.session_id
       WHERE d.username = ? AND s.revoked = 0 AND s.expires_at > ?
       ORDER BY d.last_seen DESC LIMIT 20`
  ).bind(username, Date.now()).all();
  return (results || []).map((r) => ({
    sessionId: String(r.session_id),
    userAgent: r.user_agent == null ? void 0 : String(r.user_agent),
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen)
  }));
}
async function revokeSession(db, username, sessionId) {
  const res = await db.prepare("UPDATE account_sessions SET revoked = 1 WHERE id = ? AND username = ?").bind(sessionId, username).run();
  return (res.meta.changes || 0) > 0;
}
async function revokeAllSessions(db, username, exceptSessionId) {
  if (exceptSessionId) {
    await db.prepare("UPDATE account_sessions SET revoked = 1 WHERE username = ? AND id != ?").bind(username, exceptSessionId).run();
  } else {
    await db.prepare("UPDATE account_sessions SET revoked = 1 WHERE username = ?").bind(username).run();
  }
}
async function sessionIdOfToken(db, token) {
  const tokenHash = await sha256Hex(`${token}::${PEPPER}`);
  const row = await db.prepare("SELECT id FROM account_sessions WHERE token_hash = ? AND revoked = 0").bind(tokenHash).first();
  return row?.id ?? null;
}
const MAX_FAILS = 8;
const WINDOW_MS = 15 * 6e4;
const LOCK_MS = 15 * 6e4;
async function checkLoginRateLimit(db, ip, username) {
  const key = `${ip}|${username}`;
  const row = await db.prepare("SELECT fail_count, locked_until FROM login_attempts WHERE key = ?").bind(key).first();
  if (!row) return null;
  const lockedUntil = Number(row.locked_until || 0);
  if (lockedUntil > Date.now()) return lockedUntil - Date.now();
  return null;
}
async function recordLoginFailure(db, ip, username) {
  const key = `${ip}|${username}`;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO login_attempts (key, fail_count, window_start, last_fail_at, locked_until)
       VALUES (?, 1, ?, ?, 0)
       ON CONFLICT(key) DO UPDATE SET
         fail_count = CASE WHEN last_fail_at < ? THEN 1 ELSE fail_count + 1 END,
         window_start = CASE WHEN last_fail_at < ? THEN ? ELSE window_start END,
         last_fail_at = ?,
         locked_until = CASE WHEN fail_count + 1 >= ? THEN ? ELSE locked_until END`
  ).bind(key, now, now, now - WINDOW_MS, now - WINDOW_MS, now, now, MAX_FAILS, now + LOCK_MS).run();
}
async function clearLoginFailures(db, ip, username) {
  await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(`${ip}|${username}`).run();
}
function rowToAccount(r) {
  return {
    id: String(r.id),
    scope: String(r.scope),
    name: String(r.name),
    type: ["cash", "bank", "alipay", "wechat", "other"].includes(String(r.type)) ? r.type : "other",
    icon: r.icon == null ? void 0 : String(r.icon),
    initialBalance: Number(r.initial_balance || 0),
    note: r.note == null ? void 0 : String(r.note),
    archived: Number(r.archived || 0) !== 0,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}
function rowToTransfer(r) {
  return {
    id: String(r.id),
    scope: String(r.scope),
    fromAccount: String(r.from_account),
    toAccount: String(r.to_account),
    amount: Number(r.amount),
    date: String(r.date),
    note: r.note == null ? void 0 : String(r.note),
    createdAt: Number(r.created_at)
  };
}
async function d1GetAccounts(db, scope, includeArchived = false) {
  const { results } = await db.prepare(
    `SELECT * FROM accounts WHERE scope = ? ${includeArchived ? "" : "AND archived = 0"} ORDER BY created_at ASC`
  ).bind(scope).all();
  return (results || []).map(rowToAccount);
}
async function d1AddAccount(db, scope, input) {
  const now = Date.now();
  const account = {
    id: input.id,
    scope,
    name: input.name,
    type: input.type,
    icon: input.icon,
    initialBalance: input.initialBalance,
    note: input.note,
    archived: false,
    createdAt: now,
    updatedAt: now
  };
  await db.prepare(
    `INSERT INTO accounts (id, scope, name, type, icon, initial_balance, note, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(
    account.id,
    scope,
    account.name,
    account.type,
    account.icon ?? null,
    account.initialBalance,
    account.note ?? null,
    now,
    now
  ).run();
  return account;
}
async function d1UpdateAccount(db, scope, id, patch) {
  const sets = [];
  const vals = [];
  const push = (col, v) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.name !== void 0) push("name", patch.name);
  if (patch.type !== void 0) push("type", patch.type);
  if (patch.icon !== void 0) push("icon", patch.icon || null);
  if (patch.initialBalance !== void 0) push("initial_balance", patch.initialBalance);
  if (patch.note !== void 0) push("note", patch.note || null);
  if (patch.archived !== void 0) push("archived", patch.archived ? 1 : 0);
  if (sets.length === 0) return null;
  push("updated_at", Date.now());
  vals.push(scope, id);
  await db.prepare(`UPDATE accounts SET ${sets.join(", ")} WHERE scope = ? AND id = ?`).bind(...vals).run();
  const row = await db.prepare("SELECT * FROM accounts WHERE scope = ? AND id = ?").bind(scope, id).first();
  return row ? rowToAccount(row) : null;
}
async function d1DeleteAccount(db, scope, id) {
  const res = await db.prepare("UPDATE accounts SET archived = 1, updated_at = ? WHERE scope = ? AND id = ? AND archived = 0").bind(Date.now(), scope, id).run();
  return (res.meta.changes || 0) > 0;
}
async function d1AddTransfer(db, scope, input) {
  const t = { ...input, createdAt: Date.now() };
  await db.prepare(
    `INSERT INTO transfers (id, scope, from_account, to_account, amount, date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(t.id, scope, t.fromAccount, t.toAccount, t.amount, t.date, t.note ?? null, t.createdAt).run();
  return t;
}
async function d1GetTransfers(db, scope, limit = 50) {
  const { results } = await db.prepare("SELECT * FROM transfers WHERE scope = ? ORDER BY date DESC, created_at DESC LIMIT ?").bind(scope, Math.min(Math.max(limit, 1), 200)).all();
  return (results || []).map(rowToTransfer);
}
async function d1DeleteTransfer(db, scope, id) {
  const res = await db.prepare("DELETE FROM transfers WHERE scope = ? AND id = ?").bind(scope, id).run();
  return (res.meta.changes || 0) > 0;
}
async function d1AccountBalances(db, scope, month) {
  const accounts = await d1GetAccounts(db, scope);
  if (accounts.length === 0) return [];
  const [flows, monthFlows, transfersOut, transfersIn] = await Promise.all([
    db.prepare(
      `SELECT account_id, type, SUM(amount) AS total FROM expenses
       WHERE scope = ? AND account_id IS NOT NULL AND deleted_at IS NULL
       GROUP BY account_id, type`
    ).bind(scope).all(),
    db.prepare(
      `SELECT account_id, type, SUM(amount) AS total FROM expenses
       WHERE scope = ? AND account_id IS NOT NULL AND deleted_at IS NULL AND date LIKE ?
       GROUP BY account_id, type`
    ).bind(scope, `${month}%`).all(),
    db.prepare(
      `SELECT from_account AS acc, SUM(amount) AS total FROM transfers
       WHERE scope = ? GROUP BY from_account`
    ).bind(scope).all(),
    db.prepare(
      `SELECT to_account AS acc, SUM(amount) AS total FROM transfers
       WHERE scope = ? GROUP BY to_account`
    ).bind(scope).all()
  ]);
  const incomeOf = /* @__PURE__ */ new Map();
  const expenseOf = /* @__PURE__ */ new Map();
  for (const r of flows.results || []) {
    const m = r.type === "income" ? incomeOf : expenseOf;
    m.set(r.account_id, (m.get(r.account_id) || 0) + Number(r.total));
  }
  const monthIn = /* @__PURE__ */ new Map();
  const monthOut = /* @__PURE__ */ new Map();
  for (const r of monthFlows.results || []) {
    const m = r.type === "income" ? monthIn : monthOut;
    m.set(r.account_id, (m.get(r.account_id) || 0) + Number(r.total));
  }
  const outOf = /* @__PURE__ */ new Map();
  for (const r of transfersOut.results || []) outOf.set(r.acc, (outOf.get(r.acc) || 0) + Number(r.total));
  const inOf = /* @__PURE__ */ new Map();
  for (const r of transfersIn.results || []) inOf.set(r.acc, (inOf.get(r.acc) || 0) + Number(r.total));
  return accounts.map((a) => {
    const balance = a.initialBalance + (incomeOf.get(a.id) || 0) - (expenseOf.get(a.id) || 0) + (inOf.get(a.id) || 0) - (outOf.get(a.id) || 0);
    const monthDelta = (monthIn.get(a.id) || 0) - (monthOut.get(a.id) || 0);
    const expenseCount = (expenseOf.get(a.id) || 0) > 0 ? 1 : 0;
    return { account: a, balance, monthDelta, expenseCount };
  });
}
function rowToRule(r) {
  return {
    id: String(r.id),
    scope: String(r.scope),
    kind: r.kind === "keyword" ? "keyword" : "merchant",
    pattern: String(r.pattern),
    category: String(r.category),
    priority: Number(r.priority || 100),
    active: Number(r.active || 0) !== 0,
    hitCount: Number(r.hit_count || 0),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}
async function d1GetRules(db, scope) {
  const { results } = await db.prepare("SELECT * FROM category_rules WHERE scope = ? AND active = 1 ORDER BY priority ASC, created_at ASC").bind(scope).all();
  return (results || []).map(rowToRule);
}
async function d1AddRule(db, scope, input) {
  const now = Date.now();
  const rule = {
    id: crypto.randomUUID(),
    scope,
    kind: input.kind,
    pattern: input.pattern.trim().slice(0, 60),
    category: input.category,
    priority: input.priority ?? 100,
    active: true,
    hitCount: 0,
    createdAt: now,
    updatedAt: now
  };
  await db.prepare(
    `INSERT INTO category_rules (id, scope, kind, pattern, category, priority, active, hit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  ).bind(rule.id, scope, rule.kind, rule.pattern, rule.category, rule.priority, now, now).run();
  return rule;
}
async function d1DeleteRule(db, scope, id) {
  const res = await db.prepare("DELETE FROM category_rules WHERE scope = ? AND id = ?").bind(scope, id).run();
  return (res.meta.changes || 0) > 0;
}
async function d1IncrementRuleHits(db, scope, ids) {
  if (ids.length === 0) return;
  const stmt = db.prepare("UPDATE category_rules SET hit_count = hit_count + 1 WHERE scope = ? AND id = ?");
  await db.batch(ids.map((id) => stmt.bind(scope, id)));
}
function applyRules(rules, input) {
  const matchedRuleIds = [];
  let category = input.category;
  let note;
  for (const rule of rules) {
    if (!rule.active) continue;
    const pattern = rule.pattern.toLowerCase();
    const haystack = rule.kind === "merchant" ? (input.merchant || "").toLowerCase() : `${input.merchant || ""} ${input.description || ""}`.toLowerCase();
    if (pattern && haystack.includes(pattern) && rule.category !== category) {
      category = rule.category;
      matchedRuleIds.push(rule.id);
      note = `规则「${rule.pattern} → ${rule.category}」`;
    }
  }
  return { category, matchedRuleIds, note };
}
const RETENTION_MS = 30 * 864e5;
async function d1CreateRestorePoint(db, scope, reason, payload, counts) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO restore_points (id, scope, reason, payload, counts, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, scope, reason, JSON.stringify(payload), JSON.stringify(counts), now, now + RETENTION_MS).run();
  const { results } = await db.prepare("SELECT id FROM restore_points WHERE scope = ? ORDER BY created_at DESC LIMIT 5").bind(scope).all();
  const keep = new Set((results || []).map((r) => r.id));
  const all = await db.prepare("SELECT id FROM restore_points WHERE scope = ?").bind(scope).all();
  const toDelete = (all.results || []).filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (toDelete.length > 0) {
    const stmt = db.prepare("DELETE FROM restore_points WHERE id = ?");
    await db.batch(toDelete.map((rid) => stmt.bind(rid)));
  }
  return id;
}
async function d1ListRestorePoints(db, scope) {
  const { results } = await db.prepare(
    "SELECT id, scope, reason, counts, created_at, expires_at FROM restore_points WHERE scope = ? AND expires_at > ? ORDER BY created_at DESC"
  ).bind(scope, Date.now()).all();
  return (results || []).map((r) => ({
    id: String(r.id),
    scope: String(r.scope),
    reason: String(r.reason),
    counts: r.counts == null ? void 0 : String(r.counts),
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at)
  }));
}
async function d1GetRestorePoint(db, scope, id) {
  const row = await db.prepare("SELECT * FROM restore_points WHERE scope = ? AND id = ? AND expires_at > ?").bind(scope, id, Date.now()).first();
  if (!row) return null;
  return {
    id: String(row.id),
    scope: String(row.scope),
    reason: String(row.reason),
    payload: String(row.payload),
    counts: row.counts == null ? void 0 : String(row.counts),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at)
  };
}
function validateBackup(backup) {
  if (!backup || typeof backup !== "object") return { error: "备份内容不是有效对象" };
  const b = backup;
  if (b.format !== "fiscus-backup") return { error: "不是有效的 Fiscus 备份文件（缺少 format 标识）" };
  const version = Number(b.version || 1);
  if (version > 2) return { error: `备份版本 v${version} 高于当前支持版本，请先升级应用` };
  const warnings = [];
  const expenses = Array.isArray(b.expenses) ? b.expenses : null;
  if (!expenses) return { error: "备份缺少账单（expenses）数组" };
  for (const e of expenses) {
    if (!e || typeof e !== "object" || !("id" in e) || !("amount" in e) || !("date" in e)) {
      return { error: "账单数据结构不完整（存在缺少 id/amount/date 的行）" };
    }
  }
  const recurring = Array.isArray(b.recurring) ? b.recurring.length : 0;
  const budgets = Array.isArray(b.budgets) ? b.budgets.length : 0;
  const chat = Array.isArray(b.chat) ? b.chat.length : 0;
  if (version < 2) warnings.push("旧版本备份：建议重新导出以获得完整字段");
  return { ok: true, counts: { expenses: expenses.length, recurring, budgets, chat }, warnings };
}
const SCOPE_SOURCE_TABLES = [
  "expenses",
  "recurring_expenses",
  "budgets",
  "audit_log",
  "notifications",
  "category_rules",
  "transfers",
  "restore_points"
];
async function collectBackupScopes(env) {
  const scopes = /* @__PURE__ */ new Set();
  try {
    const registry = env.USER_REGISTRY.get(env.USER_REGISTRY.idFromName("global"));
    for (const scope of await registry.listBackupScopes()) scopes.add(scope);
  } catch (err) {
    console.error("[do-backup] registry scope list failed:", err);
  }
  for (const table of SCOPE_SOURCE_TABLES) {
    try {
      const res = await env.DB.prepare(`SELECT DISTINCT scope FROM ${table}`).all();
      for (const row of res.results || []) {
        const scope = String(row.scope || "");
        if (scope) scopes.add(scope);
      }
    } catch {
    }
  }
  return [...scopes].sort();
}
async function runFullDoBackup(env, trigger) {
  const startedAt = Date.now();
  const errors = [];
  let scopes = 0;
  let keys = 0;
  let bytes = 0;
  try {
    const registry = env.USER_REGISTRY.get(env.USER_REGISTRY.idFromName("global"));
    const dump = await registry.dumpStorageForBackup();
    const written = await writeDoStorageBackup(env.DB, "UserRegistry", "global", dump);
    scopes += 1;
    keys += written.keys;
    bytes += written.bytes;
  } catch (err) {
    errors.push(`UserRegistry: ${String(err)}`);
  }
  for (const scope of await collectBackupScopes(env)) {
    try {
      const stub = env.FINANCE_MEMORY.get(env.FINANCE_MEMORY.idFromName(scope));
      const dump = await stub.dumpStorageForBackup();
      const written = await writeDoStorageBackup(env.DB, "FinanceMemory", scope, dump);
      scopes += 1;
      keys += written.keys;
      bytes += written.bytes;
    } catch (err) {
      errors.push(`FinanceMemory/${scope}: ${String(err)}`);
    }
  }
  const summary = {
    ok: errors.length === 0,
    trigger,
    scopes,
    keys,
    bytes,
    errors
  };
  try {
    await recordDoBackupRun(env.DB, {
      trigger,
      startedAt,
      finishedAt: Date.now(),
      scopes,
      keys,
      bytes,
      ok: summary.ok,
      detail: errors.length > 0 ? errors.slice(0, 8).join(" | ") : null
    });
    await purgeDoBackupRuns(env.DB);
  } catch (err) {
    console.error("[do-backup] run log write failed:", err);
  }
  return summary;
}
async function restoreDoBackup(env, doClass, scope, keys) {
  if (doClass === "UserRegistry") {
    const stub = env.USER_REGISTRY.get(env.USER_REGISTRY.idFromName("global"));
    return stub.restoreStorageFromBackup({ keys });
  }
  if (doClass === "FinanceMemory") {
    const stub = env.FINANCE_MEMORY.get(env.FINANCE_MEMORY.idFromName(scope));
    return stub.restoreStorageFromBackup({ keys });
  }
  throw new Error("未知的 doClass，仅支持 FinanceMemory / UserRegistry");
}
async function getDoBackupStatus(env) {
  const [scopes, runs] = await Promise.all([
    listDoBackupStatus(env.DB),
    listDoBackupRuns(env.DB, 8)
  ]);
  return { scopes, runs };
}
async function getExpensesWithMigration(env, scope) {
  // Legacy arrays are archived separately; never resurrect edited/deleted D1 expenses.
  return d1GetExpenses(env.DB, scope);
}

const app = new Hono2();
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()"
};
function buildCspHeader(nonce) {
  const scriptSrc = ["'self'", "https://static.cloudflareinsights.com", nonce ? `'nonce-${nonce}'` : ""].filter(Boolean).join(" ");
  return `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws: https://cloudflareinsights.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;
}
function cspNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
app.use("/*", async (c, next) => {
  const { pathname, origin } = new URL(c.req.raw.url);
  const password = c.env.AUTH_PASSWORD;
  if (pathname === "/auth") {
    if (!password) {
      return c.req.method === "GET" ? authNotConfiguredResponse(pathname) : handleAuthVerify(c.req.raw, "");
    }
    return handleAuthVerify(c.req.raw, password);
  }
  if (!password) {
    return authNotConfiguredResponse(pathname);
  }
  const expected = await deriveToken(password);
  if (!verifyRequest(c.req.raw, expected)) {
    if (c.req.header("Sec-Fetch-Mode") === "navigate") {
      return loginPageResponse();
    }
    return new Response(
      JSON.stringify({ ok: false, error: "Unauthorized" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }
  const writeMethod = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  if (writeMethod && pathname.startsWith("/api/")) {
    const reqOrigin = c.req.header("Origin");
    if (reqOrigin && reqOrigin !== origin) {
      return c.json({ success: false, error: "跨站写请求已被拒绝" }, 403);
    }
  }
  if (!pathname.startsWith("/api/")) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    const isHtml = (res.headers.get("Content-Type") || "").includes("text/html");
    headers.set("Content-Security-Policy", buildCspHeader(isHtml ? cspNonce() : void 0));
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    return new Response(res.body, { status: res.status, headers });
  }
  await next();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
});
app.use("/*", cors({
  origin: (origin, c) => {
    const { host } = new URL(c.req.raw.url);
    try {
      if (origin && new URL(origin).host === host) return origin;
    } catch {
    }
    return null;
  },
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"]
}));
app.get("/", (c) => {
  return c.json({
    name: "Finance Tracker API",
    version: "2.0.0",
    status: "running",
    features: ["Natural Language Processing", "AI Categorization"]
  });
});
app.post("/api/expense-natural", async (c) => {
  try {
    const body = await c.req.json();
    const { input, memberName, memberId, idempotencyKey, confirmDuplicate } = body;
    const auth = await requireScopeAccess(c, body.userId);
    if (!auth.ok) return auth.response;
    const userId = auth.scope;
    if (!input || typeof input !== "string" || input.trim().length === 0) {
      return c.json({ success: false, error: "input required" }, 400);
    }
    const aiResult = await processExpenseInput(c.env.AI, input, memberName);
    if (!aiResult.success) {
      return c.json({
        success: false,
        error: "Could not understand expense"
      }, 400);
    }
    const rules = await d1GetRules(c.env.DB, userId);
    let category = aiResult.category;
    let ruleNote;
    let matchedRuleIds = [];
    if (rules.length > 0) {
      const applied = applyRules(rules, {
        merchant: aiResult.merchant,
        description: input,
        category: aiResult.category
      });
      category = applied.category;
      ruleNote = applied.note;
      matchedRuleIds = applied.matchedRuleIds;
      if (matchedRuleIds.length > 0) {
        await d1IncrementRuleHits(c.env.DB, userId, matchedRuleIds);
      }
    }
    const idemKey = typeof idempotencyKey === "string" && idempotencyKey.length >= 8 ? idempotencyKey.slice(0, 100) : void 0;
    const draft = {
      id: crypto.randomUUID(),
      amount: aiResult.amount,
      category,
      merchant: aiResult.merchant,
      description: input,
      date: aiResult.date || toTodayStr(),
      createdAt: Date.now(),
      type: aiResult.type,
      by: memberName,
      byId: memberId,
      parsedBy: aiResult.parsedBy,
      idempotencyKey: idemKey
    };
    if (!idemKey && !confirmDuplicate) {
      const dup = await d1FindDuplicate(c.env.DB, userId, draft);
      if (dup) {
        return c.json({
          success: false,
          duplicate: true,
          message: `疑似重复：${dup.date} 已有 ${dup.merchant || dup.category} ¥${dup.amount.toFixed(2)} 的记录，回复「确认」可强制入账`,
          existing: { id: dup.id, date: dup.date, merchant: dup.merchant, amount: dup.amount, category: dup.category }
        }, 409);
      }
    }
    try {
      const saved = await d1AddExpense(c.env.DB, userId, draft);
      const expense = saved || draft;
      const deduped = saved === null;
      await auditAndBroadcast(
        c.env,
        userId,
        auth.account,
        {
          action: "add",
          targetType: "expense",
          targetId: expense.id,
          summary: `记账 ${expense.type === "income" ? "收入" : "支出"} ¥${expense.amount.toFixed(2)}（${expense.merchant || expense.category}）${deduped ? "（幂等去重）" : ""}${ruleNote ? ` · ${ruleNote}` : ""}`
        },
        { type: "expense-added", by: auth.account.username }
      );
      return c.json({
        success: true,
        message: aiResult.message,
        parsedBy: aiResult.parsedBy,
        explanation: aiResult.explanation,
        deduped,
        expense: {
          id: expense.id,
          amount: expense.amount,
          category: expense.category,
          merchant: expense.merchant,
          parsedBy: expense.parsedBy
        }
      });
    } catch (dbError) {
      console.error("❌ Database error:", dbError);
      return c.json({
        success: false,
        message: "Sorry, couldn't save your expense.",
        error: "Database error"
      }, 500);
    }
  } catch (error) {
    console.error("❌ API Error:", error);
    return c.json({
      success: false,
      message: "Something went wrong. Please try again.",
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});
app.post("/api/expenses", async (c) => {
  try {
    const body = await c.req.json();
    const auth = await requireScopeAccess(c, body.userId);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "expense");
    if (denied) return denied;
    const amount = Number(body.amount);
    const merchant = typeof body.merchant === "string" ? body.merchant.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "Other";
    const type = body.type ?? "expense";
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const key = body.idempotencyKey;
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001 ||
        (!merchant && !description) || merchant.length > 160 || description.length > 500 || !category || category.length > 80 ||
        !["expense", "income"].includes(type) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date ||
        (key !== undefined && (typeof key !== "string" || key.length < 8 || key.length > 100))) {
      return c.json({ success: false, error: "请检查金额、名称和日期" }, 400);
    }
    const expense = {
      id: crypto.randomUUID(),
      amount,
      category,
      description,
      merchant: merchant || void 0,
      date,
      type,
      createdAt: Date.now(),
      by: auth.account.displayName,
      byId: auth.account.username,
      idempotencyKey: key
    };
    const saved = await d1AddExpense(c.env.DB, auth.scope, expense, true);
    if (!saved) return c.json({ success: false, error: "该次记账已处理，请刷新记录" }, 409);
    if (saved.id !== expense.id) {
      if (["amount", "category", "description", "date", "type"].some(field => saved[field] !== expense[field]) || (saved.merchant || "") !== merchant) {
        return c.json({ success: false, error: "该次记账已处理，请刷新记录" }, 409);
      }
      return c.json({ success: true, duplicate: true, expense: saved });
    }
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "add",
        targetType: "expense",
        targetId: expense.id,
        summary: `手动记账 ¥${expense.amount.toFixed(2)}（${expense.merchant || expense.category}）`
      },
      { type: "expense-added", by: auth.account.username }
    );
    return c.json({ success: true, expense: saved });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.get("/api/expenses/:userId", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.param("userId"));
    if (!auth.ok) return auth.response;
    const expenses = await getExpensesWithMigration(c.env, auth.scope);
    return c.json({ success: true, expenses, count: expenses.length });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.delete("/api/expenses/:userId", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.param("userId"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const [expenses, recurring, budgets] = await Promise.all([
      getExpensesWithMigration(c.env, auth.scope),
      d1GetRecurring(c.env.DB, auth.scope),
      d1GetBudgets(c.env.DB, auth.scope)
    ]);
    const stub = c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(auth.scope));
    const chat = await stub.getChatMessages();
    let restorePointId;
    try {
      restorePointId = await d1CreateRestorePoint(c.env.DB, auth.scope, "clear-all", {
        expenses,
        recurring,
        budgets,
        chat
      }, { expenses: expenses.length, recurring: recurring.length, budgets: budgets.length, chat: chat.length });
    } catch (err) {
      console.error("[restore-point] create failed before clear:", err);
    }
    const count = expenses.length;
    await d1ClearExpenses(c.env.DB, auth.scope);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "clear",
        targetType: "expense",
        summary: `清空全部 ${count} 条记录${restorePointId ? "（已建恢复点，30 天内可在恢复中心回退）" : ""}`,
        detail: JSON.stringify({ restorePointId })
      },
      { type: "expenses-cleared", by: auth.account.username }
    );
    return c.json({ success: true, restorePointId });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.delete("/api/expenses/:userId/:expenseId", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.param("userId"));
    if (!auth.ok) return auth.response;
    const expenseId = c.req.param("expenseId");
    const denied = await requireWriteAccess(c, auth, "expense");
    if (denied) return denied;
    const target = await d1GetExpenseById(c.env.DB, auth.scope, expenseId);
    const deleted = await d1SoftDeleteExpense(c.env.DB, auth.scope, expenseId);
    if (!deleted) {
      return c.json({ success: false, error: "Expense not found" }, 404);
    }
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "delete",
        targetType: "expense",
        targetId: expenseId,
        summary: target ? `删除 ${target.type === "income" ? "收入" : "支出"} ¥${target.amount.toFixed(2)}（${target.merchant || target.category}，${target.date}）` : "删除一条记录",
        detail: target ? JSON.stringify(target) : void 0
      },
      { type: "expense-deleted", by: auth.account.username, payload: { expenseId } }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.patch("/api/expenses/:userId/:expenseId", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.param("userId"));
    if (!auth.ok) return auth.response;
    const expenseId = c.req.param("expenseId");
    const body = await c.req.json().catch(() => ({}));
    const patch = {};
    if (body.amount !== void 0) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return c.json({ success: false, error: "金额必须是大于 0 的数字" }, 400);
      }
      patch.amount = amount;
    }
    if (body.date !== void 0) {
      const date = String(body.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
        return c.json({ success: false, error: "日期格式应为 YYYY-MM-DD" }, 400);
      }
      patch.date = date;
    }
    if (body.type !== void 0) {
      if (body.type !== "expense" && body.type !== "income") {
        return c.json({ success: false, error: "类型仅支持 expense / income" }, 400);
      }
      patch.type = body.type;
    }
    if (body.merchant !== void 0) patch.merchant = String(body.merchant).slice(0, 100) || void 0;
    if (body.description !== void 0) patch.description = String(body.description).slice(0, 500) || void 0;
    if (body.category !== void 0) patch.category = String(body.category).slice(0, 50) || "Other";
    if (body.accountId !== void 0) patch.accountId = String(body.accountId).slice(0, 60) || void 0;
    if (body.paidBy !== void 0) patch.paidBy = String(body.paidBy).slice(0, 60) || void 0;
    if (body.splitWith !== void 0) patch.splitWith = String(body.splitWith).slice(0, 300) || void 0;
    if (Object.keys(patch).length === 0) {
      return c.json({ success: false, error: "没有需要修改的字段" }, 400);
    }
    const denied = await requireWriteAccess(c, auth, "expense");
    if (denied) return denied;
    const before = (await getExpensesWithMigration(c.env, auth.scope)).find((e) => e.id === expenseId);
    const updated = await d1UpdateExpense(c.env.DB, auth.scope, expenseId, patch);
    if (!updated) {
      return c.json({ success: false, error: "记录不存在" }, 404);
    }
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "update",
        targetType: "expense",
        targetId: expenseId,
        summary: `修改记录（${Object.keys(patch).join("、")}）`,
        detail: JSON.stringify({ before: before ? { amount: before.amount, date: before.date, category: before.category, merchant: before.merchant, type: before.type } : null, after: patch })
      },
      { type: "expense-updated", by: auth.account.username, payload: { expenseId } }
    );
    return c.json({ success: true, expense: updated });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/bootstrap", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const famRes = await registry.listFamilyMembers(account.username);
    const scope = famRes.ok && famRes.family ? famRes.family.scopeId : account.scopeId;
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 20), 1), 100);
    const [expenses, allMessages] = await Promise.all([
      d1GetExpenses(c.env.DB, scope),
      c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(scope)).getChatMessages()
    ]);
    const hasMore = allMessages.length > limit;
    const messages = hasMore ? allMessages.slice(-limit) : allMessages;
    return c.json({
      success: true,
      account: {
        username: account.username,
        displayName: account.displayName,
        emoji: account.emoji,
        scopeId: account.scopeId
      },
      family: famRes.ok && famRes.family ? {
        code: famRes.family.code,
        scopeId: famRes.family.scopeId,
        isOwner: famRes.family.ownerUsername === account.username.toLowerCase()
      } : null,
      members: famRes.ok ? famRes.members ?? [] : [],
      expenses,
      chat: { messages, hasMore }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/chat/:userId", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.param("userId"));
    if (!auth.ok) return auth.response;
    const beforeParam = c.req.query("before");
    const before = beforeParam ? Number(beforeParam) : null;
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 20), 1), 100);
    const id = c.env.FINANCE_MEMORY.idFromName(auth.scope);
    const stub = c.env.FINANCE_MEMORY.get(id);
    let messages = await stub.getChatMessages();
    let hasMore = false;
    if (before !== null && Number.isFinite(before)) {
      const older = messages.filter((m) => m.timestamp < before);
      hasMore = older.length > limit;
      messages = hasMore ? older.slice(-limit) : older;
    } else {
      hasMore = messages.length > limit;
      if (hasMore) messages = messages.slice(-limit);
    }
    return c.json({ success: true, messages, count: messages.length, hasMore });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/chat/:userId", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.param("userId"));
    if (!auth.ok) return auth.response;
    const body = await c.req.json();
    if (!body.role || !body.content) {
      return c.json({ error: "Missing role or content" }, 400);
    }
    const message = {
      id: body.id || crypto.randomUUID(),
      role: body.role,
      content: body.content,
      timestamp: body.timestamp || Date.now(),
      by: body.by || void 0,
      byId: body.byId || void 0,
      // 解析来源（ai/fallback）：气泡角标的判定依据；此前遗漏导致重新加载后被误判为「规则兜底」
      parsedBy: body.parsedBy === "ai" || body.parsedBy === "fallback" ? body.parsedBy : void 0,
      expense: body.expense
    };
    const id = c.env.FINANCE_MEMORY.idFromName(auth.scope);
    const stub = c.env.FINANCE_MEMORY.get(id);
    let retries = 3;
    while (retries > 0) {
      try {
        await stub.addChatMessage(message);
        break;
      } catch (err) {
        retries--;
        if (retries === 0 || !err.retryable) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return c.json({ success: true, message });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.delete("/api/chat/:userId", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.param("userId"));
    if (!auth.ok) return auth.response;
    const id = c.env.FINANCE_MEMORY.idFromName(auth.scope);
    const stub = c.env.FINANCE_MEMORY.get(id);
    await stub.clearChatMessages();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});
app.post("/api/voice-command", async (c) => {
  try {
    const body = await c.req.json();
    const { input, memberName, memberId } = body;
    const auth = await requireScopeAccess(c, body.userId);
    if (!auth.ok) return auth.response;
    const userId = auth.scope;
    if (!input) {
      return c.json({ success: false, error: "Missing input" }, 400);
    }
    const intent = await classifyIntent(c.env.AI, input);
    if (intent === INTENTS.ADD_EXPENSE) {
      const aiResult = await processExpenseInput(c.env.AI, input, memberName);
      if (!aiResult.success) {
        return c.json({
          success: false,
          message: /(花了|买|付|记账|记录|块|元)/.test(input) ? "没太听懂这笔记录，试试说「我花了 50 块买咖啡」" : "Sorry, I couldn't understand that expense. Try: 'I spent $50 on coffee'"
        }, 400);
      }
      const rules = await d1GetRules(c.env.DB, userId);
      let category = aiResult.category;
      let ruleNote;
      let matchedRuleIds = [];
      if (rules.length > 0) {
        const applied = applyRules(rules, {
          merchant: aiResult.merchant,
          description: input,
          category: aiResult.category
        });
        category = applied.category;
        ruleNote = applied.note;
        matchedRuleIds = applied.matchedRuleIds;
        if (matchedRuleIds.length > 0) {
          await d1IncrementRuleHits(c.env.DB, userId, matchedRuleIds);
        }
      }
      const idemKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.length >= 8 ? body.idempotencyKey.slice(0, 100) : void 0;
      const expense = {
        id: crypto.randomUUID(),
        amount: aiResult.amount,
        category,
        merchant: aiResult.merchant,
        description: input,
        date: aiResult.date || toTodayStr(),
        createdAt: Date.now(),
        type: aiResult.type,
        by: memberName,
        byId: memberId,
        parsedBy: aiResult.parsedBy,
        idempotencyKey: idemKey
      };
      if (!idemKey && !body.confirmDuplicate) {
        const dup = await d1FindDuplicate(c.env.DB, userId, expense);
        if (dup) {
          return c.json({
            success: false,
            duplicate: true,
            message: `疑似重复：${dup.date} 已有 ${dup.merchant || dup.category} ¥${dup.amount.toFixed(2)} 的记录，回复「确认」可强制入账`,
            existing: { id: dup.id, date: dup.date, merchant: dup.merchant, amount: dup.amount, category: dup.category }
          }, 409);
        }
      }
      try {
        const saved = await d1AddExpense(c.env.DB, userId, expense);
        const finalExpense = saved || expense;
        const deduped = saved === null;
        await auditAndBroadcast(
          c.env,
          userId,
          auth.account,
          {
            action: "add",
            targetType: "expense",
            targetId: finalExpense.id,
            summary: `对话记账 ${finalExpense.type === "income" ? "收入" : "支出"} ¥${finalExpense.amount.toFixed(2)}（${finalExpense.merchant || finalExpense.category}）${deduped ? "（幂等去重）" : ""}${ruleNote ? ` · ${ruleNote}` : ""}`
          },
          { type: "expense-added", by: auth.account.username }
        );
        const datedMsg = aiResult.date && aiResult.date !== toTodayStr() ? `${aiResult.message}（记在 ${aiResult.date}）` : aiResult.message;
        return c.json({
          success: true,
          message: datedMsg,
          parsedBy: aiResult.parsedBy,
          deduped,
          data: { expense: finalExpense, explanation: aiResult.explanation }
        });
      } catch (err) {
        console.error("❌ voice-command db error:", err);
        return c.json({
          success: false,
          message: /(花了|买|付|记账|记录)/.test(input) ? "抱歉，保存这笔记录失败了。" : "Sorry, couldn't save your expense."
        }, 500);
      }
    } else if (intent === INTENTS.QUERY) {
      const expenses = await getExpensesWithMigration(c.env, userId);
      const answer = await queryExpenses(c.env.AI, input, expenses);
      return c.json({
        success: true,
        message: answer,
        data: { count: expenses.length }
      });
    } else if (intent === INTENTS.MANAGE_SUBSCRIPTION) {
      const draft = await parseSubscription(c.env.AI, input);
      if (!draft) {
        return c.json({
          success: false,
          message: "没太听懂这条订阅命令，试试说「每月10号记房租3500元」。"
        }, 400);
      }
      const { action } = await parseSubscriptionAction(c.env.AI, input);
      const existing = await d1GetRecurring(c.env.DB, userId);
      if (action === "delete") {
        const target = existing.find((r) => r.name.includes(draft.name) || draft.name.includes(r.name));
        if (!target) {
          return c.json({
            success: false,
            message: `没有找到「${draft.name}」的订阅，要不要先添加？`
          }, 404);
        }
        await d1DeleteRecurring(c.env.DB, userId, target.id);
        await auditAndBroadcast(
          c.env,
          userId,
          auth.account,
          { action: "sub_delete", targetType: "subscription", targetId: target.id, summary: `删除订阅「${target.name}」（对话指令）` },
          { type: "subscription-changed", by: auth.account.username }
        );
        void c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(userId));
        return c.json({ success: true, message: `🗑️ 已删「${target.name}」的月度订阅，从下个月起不再自动记账。` });
      }
      if (action === "update") {
        const target = existing.find((r) => r.name.includes(draft.name) || draft.name.includes(r.name));
        if (!target) {
          return c.json({
            success: false,
            message: `没有找到「${draft.name}」的订阅，是否要新建？`
          }, 404);
        }
        const updated = await d1UpdateRecurring(c.env.DB, userId, target.id, {
          amount: draft.amount ?? target.amount,
          category: draft.category ?? target.category,
          dayOfMonth: draft.dayOfMonth ?? target.dayOfMonth,
          merchant: draft.merchant || target.merchant
        });
        await auditAndBroadcast(
          c.env,
          userId,
          auth.account,
          { action: "sub_update", targetType: "subscription", targetId: target.id, summary: `修改订阅「${target.name}」（对话指令）` },
          { type: "subscription-changed", by: auth.account.username }
        );
        void c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(userId));
        return c.json({ success: true, message: `✔️ 已更新「${updated.name}」订阅：每月 ${updated.dayOfMonth} 号入账 ¥${updated.amount.toFixed(2)}。` });
      }
      const item = await d1AddRecurring(c.env.DB, userId, {
        id: crypto.randomUUID(),
        name: draft.name,
        amount: draft.amount,
        category: draft.category,
        merchant: draft.merchant,
        dayOfMonth: draft.dayOfMonth,
        active: true
      });
      await auditAndBroadcast(
        c.env,
        userId,
        auth.account,
        { action: "sub_create", targetType: "subscription", targetId: item.id, summary: `新增订阅「${item.name}」每月 ${item.dayOfMonth} 号 ¥${item.amount.toFixed(2)}（对话指令）` },
        { type: "subscription-changed", by: auth.account.username }
      );
      return c.json({ success: true, message: `⏰ 已记住「${item.name}」，每月 ${item.dayOfMonth} 号将自动记 ¥${item.amount.toFixed(2)}。` });
    } else if (intent === INTENTS.HELP) {
      return c.json({
        success: true,
        message: "我可以帮你记账！试试说「我花了 50 块买咖啡」或「这个月花了多少钱」。I can also help in English: 'I spent $50 on coffee'."
      });
    } else if (intent === INTENTS.DELETE_EXPENSE) {
      const expenses = await getExpensesWithMigration(c.env, userId);
      const deleteResult = await identifyExpenseToDelete(c.env.AI, input, expenses);
      if (!deleteResult.success || !deleteResult.expenseId && !deleteResult.expenseIds) {
        return c.json({
          success: false,
          message: deleteResult.message
        });
      }
      if (deleteResult.isBulkDelete && deleteResult.expenseIds) {
        const deletedCount = await d1SoftDeleteMany(c.env.DB, userId, deleteResult.expenseIds);
        await auditAndBroadcast(
          c.env,
          userId,
          auth.account,
          { action: "delete", targetType: "expense", summary: `对话指令批量删除 ${deletedCount} 条记录`, detail: JSON.stringify({ ids: deleteResult.expenseIds }) },
          { type: "expenses-cleared", by: auth.account.username }
        );
        return c.json({
          success: true,
          message: deletedCount > 0 ? deleteResult.message : "Couldn't delete those expenses. They might already be gone."
        });
      }
      const target = (await getExpensesWithMigration(c.env, userId)).find((e) => e.id === deleteResult.expenseId);
      const deleted = await d1SoftDeleteExpense(c.env.DB, userId, deleteResult.expenseId);
      if (deleted) {
        await auditAndBroadcast(
          c.env,
          userId,
          auth.account,
          {
            action: "delete",
            targetType: "expense",
            targetId: deleteResult.expenseId,
            summary: target ? `对话指令删除 ${target.type === "income" ? "收入" : "支出"} ¥${target.amount.toFixed(2)}（${target.merchant || target.category}，${target.date}）` : "对话指令删除记录",
            detail: target ? JSON.stringify(target) : void 0
          },
          { type: "expense-deleted", by: auth.account.username, payload: { expenseId: deleteResult.expenseId } }
        );
        return c.json({
          success: true,
          message: deleteResult.message
        });
      } else {
        return c.json({
          success: false,
          message: "Couldn't delete that expense. It might already be gone."
        });
      }
    } else {
      return c.json({
        success: true,
        message: "我没太理解你的意思。试试说「我花了 50 块买咖啡」或「这个月花了多少钱」。 Or try: 'I spent $X on something'."
      });
    }
  } catch {
    return c.json({
      success: false,
      message: "Oops! Something went wrong."
    }, 500);
  }
});
app.get("/api/subscriptions", async (c) => {
  try {
    const scopeParam = c.req.query("scope");
    if (!scopeParam || scopeParam === "") {
      return c.json({ success: true, items: [] });
    }
    const auth = await requireScopeAccess(c, scopeParam);
    if (!auth.ok) return auth.response;
    const items = await d1GetRecurring(c.env.DB, auth.scope);
    return c.json({ success: true, items });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/subscriptions", async (c) => {
  try {
    const { scope, name, amount, category, merchant, dayOfMonth } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    if (!name || !amount || !dayOfMonth) {
      return c.json({ success: false, error: "Missing name, amount, or dayOfMonth" }, 400);
    }
    if (dayOfMonth < 1 || dayOfMonth > 31) {
      return c.json({ success: false, error: "dayOfMonth must be between 1 and 31" }, 400);
    }
    const item = await d1AddRecurring(c.env.DB, auth.scope, {
      id: crypto.randomUUID(),
      name: String(name).slice(0, 100),
      amount: Number(amount),
      category: String(category || "Other"),
      merchant: merchant ? String(merchant).slice(0, 100) : void 0,
      dayOfMonth,
      active: true
    });
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "sub_create",
        targetType: "subscription",
        targetId: item.id,
        summary: `新增订阅「${item.name}」每月 ${item.dayOfMonth} 号 ¥${item.amount.toFixed(2)}`
      },
      { type: "subscription-changed", by: auth.account.username }
    );
    return c.json({ success: true, item });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.patch("/api/subscriptions/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const id = c.req.param("id");
    const patch = await c.req.json();
    const updated = await d1UpdateRecurring(c.env.DB, auth.scope, id, patch);
    if (!updated) return c.json({ success: false, error: "Subscription not found" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "sub_update",
        targetType: "subscription",
        targetId: id,
        summary: `修改订阅「${updated.name}」`,
        detail: JSON.stringify(patch)
      },
      { type: "subscription-changed", by: auth.account.username }
    );
    const stub = c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(auth.scope));
    void stub;
    return c.json({ success: true, item: updated });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/subscriptions/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const id = c.req.param("id");
    const target = (await d1GetRecurring(c.env.DB, auth.scope)).find((r) => r.id === id);
    const done = await d1DeleteRecurring(c.env.DB, auth.scope, id);
    if (!done) return c.json({ success: false, error: "Subscription not found" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "sub_delete",
        targetType: "subscription",
        targetId: id,
        summary: target ? `删除订阅「${target.name}」` : "删除一条订阅"
      },
      { type: "subscription-changed", by: auth.account.username }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/report", async (c) => {
  try {
    const { userId, month, member } = await c.req.json();
    const auth = await requireScopeAccess(c, userId);
    if (!auth.ok) return auth.response;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: "Invalid month (YYYY-MM)" }, 400);
    }
    let expenses = await getExpensesWithMigration(c.env, auth.scope);
    if (member && member !== "all") {
      expenses = expenses.filter(
        (e) => e.byId === member || !e.byId && e.by === member
      );
    }
    const report = await generateMonthlyReport(c.env.AI, month, expenses);
    return c.json({ success: true, report });
  } catch {
    return c.json({ success: false, error: "Report generation failed" }, 500);
  }
});
app.post("/api/report/weekly-insights", async (c) => {
  try {
    const { userId, weekStart, member } = await c.req.json();
    const auth = await requireScopeAccess(c, userId);
    if (!auth.ok) return auth.response;
    const now = /* @__PURE__ */ new Date();
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(monday.getDate() - day);
    const ws = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekStart : monday.toISOString().slice(0, 10);
    let expenses = await getExpensesWithMigration(c.env, auth.scope);
    if (member && member !== "all") {
      expenses = expenses.filter(
        (e) => e.byId === member || !e.byId && e.by === member
      );
    }
    const budgets = await d1GetBudgets(c.env.DB, auth.scope);
    const [report, insights] = await Promise.all([
      generateWeeklyReport(c.env.AI, ws, expenses),
      Promise.resolve(detectAnomalies(expenses, budgets))
    ]);
    return c.json({ success: true, weekStart: ws, report, insights });
  } catch {
    return c.json({ success: false, error: "Weekly report generation failed" }, 500);
  }
});
app.post("/api/family/create", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const result = await registry.createFamily(account.username);
    if (!result.ok || !result.family) {
      return c.json({ success: false, error: result.error }, 400);
    }
    let importedExpenses = 0;
    let importedChat = 0;
    if (body.mergePersonalData !== false) {
      const mergeRes = await mergeScopes(c.env, account.scopeId, result.family.scopeId);
      importedExpenses = mergeRes.importedExpenses;
      importedChat = mergeRes.importedChat;
    }
    return c.json({
      success: true,
      family: {
        code: result.family.code,
        scopeId: result.family.scopeId,
        isOwner: true
      },
      importedExpenses,
      importedChat
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/family/join", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const { code, mergePersonalData } = await c.req.json().catch(() => ({}));
    if (!code) return c.json({ success: false, error: "请输入家庭码" }, 400);
    const result = await registry.joinFamily(account.username, String(code));
    if (!result.ok || !result.family) {
      return c.json({ success: false, error: result.error }, 400);
    }
    let importedExpenses = 0;
    let importedChat = 0;
    if (mergePersonalData !== false) {
      const mergeRes = await mergeScopes(c.env, account.scopeId, result.family.scopeId);
      importedExpenses = mergeRes.importedExpenses;
      importedChat = mergeRes.importedChat;
    }
    return c.json({
      success: true,
      family: {
        code: result.family.code,
        scopeId: result.family.scopeId,
        isOwner: false
      },
      importedExpenses,
      importedChat
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/family/mine", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const result = await registry.listFamilyMembers(account.username);
    if (!result.ok) {
      return c.json({ success: true, family: null, members: [] });
    }
    return c.json({
      success: true,
      family: result.family ? { code: result.family.code, scopeId: result.family.scopeId, isOwner: result.family.ownerUsername === account.username.toLowerCase() } : null,
      members: result.members
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/family/members/:username", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const result = await registry.removeFamilyMember(account.username, c.req.param("username"));
    if (!result.ok) return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true, members: result.members });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/family/leave", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const result = await registry.leaveFamily(account.username);
    if (!result.ok) return c.json({ success: false, error: result.error }, 400);
    return c.json({
      success: true,
      dissolved: result.dissolved || false,
      newOwner: result.newOwner || null
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/family/regenerate-code", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const result = await registry.regenerateFamilyCode(account.username);
    if (!result.ok || !result.family) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({
      success: true,
      family: { code: result.family.code, scopeId: result.family.scopeId, isOwner: true }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
async function mergeScopes(env, sourceScopeId, targetScopeId) {
  if (sourceScopeId === targetScopeId) return { importedExpenses: 0, importedChat: 0 };
  const sourceStub = env.FINANCE_MEMORY.get(
    env.FINANCE_MEMORY.idFromName(sourceScopeId)
  );
  const targetStub = env.FINANCE_MEMORY.get(
    env.FINANCE_MEMORY.idFromName(targetScopeId)
  );
  const [expenses, chat] = await Promise.all([
    d1GetExpenses(env.DB, sourceScopeId),
    sourceStub.getChatMessages()
  ]);
  const importedExpenses = expenses.length ? await d1ImportExpenses(env.DB, targetScopeId, expenses) : 0;
  const importedChat = chat.length ? await targetStub.importChatMessages(chat) : 0;
  return { importedExpenses, importedChat };
}
app.post("/api/identity/merge", async (c) => {
  try {
    const { sourceScopeId, targetScopeId } = await c.req.json();
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    if (!sourceScopeId || !targetScopeId || sourceScopeId === targetScopeId) {
      return c.json({ success: false, error: "sourceScopeId and targetScopeId required" }, 400);
    }
    const scopes = await accessibleScopes(c, account);
    if (targetScopeId !== scopes.personal) {
      return c.json({ success: false, error: "只能合并到自己的个人作用域" }, 403);
    }
    if (sourceScopeId === scopes.personal || sourceScopeId === scopes.family) {
      return c.json({ success: false, error: "源作用域不能是自己当前的作用域" }, 400);
    }
    const sourceIsLegacyDeviceId = /^user_[a-z0-9_]+$/i.test(sourceScopeId) && sourceScopeId.toLowerCase() !== `user_${account.username.trim().toLowerCase()}`;
    const sourceIsFamily = /^family_[0-9]{6}$/.test(sourceScopeId);
    if (!sourceIsLegacyDeviceId && !sourceIsFamily) {
      return c.json({ success: false, error: "非法的源作用域" }, 403);
    }
    const sourceId = c.env.FINANCE_MEMORY.idFromName(sourceScopeId);
    const sourceStub = c.env.FINANCE_MEMORY.get(sourceId);
    const targetId = c.env.FINANCE_MEMORY.idFromName(targetScopeId);
    const targetStub = c.env.FINANCE_MEMORY.get(targetId);
    const [expenses, chat] = await Promise.all([
      d1GetExpenses(c.env.DB, sourceScopeId),
      sourceStub.getChatMessages()
    ]);
    const importedExpenses = expenses.length ? await d1ImportExpenses(c.env.DB, targetScopeId, expenses) : 0;
    const importedChat = chat.length ? await targetStub.importChatMessages(chat) : 0;
    return c.json({
      success: true,
      importedExpenses,
      importedChat,
      sourceCount: expenses.length
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
function registryStub(c) {
  const id = c.env.USER_REGISTRY.idFromName("global");
  return c.env.USER_REGISTRY.get(id);
}
async function accessibleScopes(c, account) {
  const famRes = await registryStub(c).listFamilyMembers(account.username);
  const family = famRes.ok && famRes.family ? famRes.family.scopeId : null;
  return { personal: account.scopeId, family };
}
async function requireScopeAccess(c, requestedScope) {
  const registry = registryStub(c);
  const account = await sessionFromRequest(c, registry);
  if (!account) {
    return {
      ok: false,
      response: c.json({ success: false, error: "未登录" }, 401)
    };
  }
  if (!requestedScope) {
    return {
      ok: false,
      response: c.json({ success: false, error: "scope required" }, 400)
    };
  }
  const scopes = await accessibleScopes(c, account);
  if (requestedScope !== scopes.personal && requestedScope !== scopes.family) {
    return {
      ok: false,
      response: c.json({ success: false, error: "无权访问该作用域" }, 403)
    };
  }
  return { ok: true, scope: requestedScope, account };
}
async function requireWriteAccess(c, auth, level = "expense") {
  const registry = registryStub(c);
  const roleRes = await registry.getMemberRole(auth.account.username);
  if (!roleRes.ok || !roleRes.role) return null;
  if (auth.scope !== roleRes.scopeId) return null;
  if (roleRes.role === "viewer") {
    return c.json({ success: false, error: "你的角色为「只读」，无法进行此操作" }, 403);
  }
  if (roleRes.role === "contributor" && level === "manage") {
    return c.json({ success: false, error: "此操作需要管理员权限" }, 403);
  }
  return null;
}
async function auditAndBroadcast(env, scope, account, entry, broadcast) {
  try {
    await d1AddAudit(env.DB, {
      scope,
      actorUsername: account?.username || "unknown",
      actorDisplay: account?.displayName,
      ...entry
    });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
  if (broadcast) {
    try {
      await env.FINANCE_MEMORY.get(env.FINANCE_MEMORY.idFromName(scope)).broadcastChange(broadcast);
    } catch (err) {
      console.error("[ws] broadcast failed:", err);
    }
  }
}
function accountTokenFromRequest(c) {
  const req = c.req.raw;
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Account ")) {
    const t = auth.slice(8).trim();
    if (t) return t;
  }
  const cookie = req.headers.get("Cookie") || "";
  for (const pair of cookie.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq) === "account_session") return pair.slice(eq + 1);
  }
  return null;
}
async function sessionFromRequest(c, registry) {
  const token = accountTokenFromRequest(c);
  if (!token) return null;
  const username = await verifySession(c.env.DB, token);
  if (!username) return null;
  const account = await registry.getProfile(username);
  if (!account) return null;
  return account;
}
function clientIp(c) {
  return c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}
app.post("/api/account/register", async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password)
      return c.json({ success: false, error: "用户名和密码不能为空" }, 400);
    const ip = clientIp(c);
    const lockLeft = await checkLoginRateLimit(c.env.DB, ip, `reg:${username}`);
    if (lockLeft != null) {
      return c.json(
        { success: false, error: `尝试过于频繁，请 ${Math.ceil(lockLeft / 6e4)} 分钟后再试` },
        429
      );
    }
    const registry = registryStub(c);
    const result = await registry.register(username, password);
    if (!result.ok || !result.account) {
      await recordLoginFailure(c.env.DB, ip, `reg:${username}`);
      return c.json({ success: false, error: result.error }, 400);
    }
    await clearLoginFailures(c.env.DB, ip, `reg:${username}`);
    const session = await createSession(c.env.DB, result.account.username, c.req.header("User-Agent"));
    return c.json({
      success: true,
      account: {
        username: result.account.username,
        displayName: result.account.displayName,
        emoji: result.account.emoji,
        scopeId: result.account.scopeId
      }
    }, 200, {
      "Set-Cookie": `account_session=${session.token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/account/login", async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password)
      return c.json({ success: false, error: "用户名和密码不能为空" }, 400);
    const ip = clientIp(c);
    const lockLeft = await checkLoginRateLimit(c.env.DB, ip, username);
    if (lockLeft != null) {
      return c.json(
        { success: false, error: `尝试过于频繁，请 ${Math.ceil(lockLeft / 6e4)} 分钟后再试` },
        429
      );
    }
    const registry = registryStub(c);
    const result = await registry.verify(username, password);
    if (!result.ok || !result.account) {
      await recordLoginFailure(c.env.DB, ip, username);
      await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 150)));
      return c.json({ success: false, error: result.error }, 401);
    }
    await clearLoginFailures(c.env.DB, ip, username);
    const session = await createSession(c.env.DB, result.account.username, c.req.header("User-Agent"));
    return c.json({
      success: true,
      account: {
        username: result.account.username,
        displayName: result.account.displayName,
        emoji: result.account.emoji,
        scopeId: result.account.scopeId
      }
    }, 200, {
      "Set-Cookie": `account_session=${session.token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/account/devices", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const devices = await listDevices(c.env.DB, account.username);
    return c.json({ success: true, devices });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/account/devices/:sessionId/logout", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const done = await revokeSession(c.env.DB, account.username, c.req.param("sessionId"));
    if (!done) return c.json({ success: false, error: "设备不存在或已登出" }, 404);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/account/logout-others", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const token = accountTokenFromRequest(c);
    const currentId = token ? await sessionIdOfToken(c.env.DB, token) : null;
    await revokeAllSessions(c.env.DB, account.username, currentId || void 0);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/account/me", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    return c.json({
      success: true,
      account: {
        username: account.username,
        displayName: account.displayName,
        emoji: account.emoji,
        scopeId: account.scopeId
      }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.patch("/api/account/me", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const patch = await c.req.json();
    const result = await registry.updateProfile(account.username, patch);
    if (!result.ok || !result.account) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({
      success: true,
      account: {
        username: result.account.username,
        displayName: result.account.displayName,
        emoji: result.account.emoji,
        scopeId: result.account.scopeId
      }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/account/logout", async (c) => {
  return c.json({ success: true }, 200, {
    "Set-Cookie": "account_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
  });
});
app.post("/api/account/me/password", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const { oldPassword, newPassword } = await c.req.json();
    const result = await registry.changePassword(
      account.username,
      String(oldPassword || ""),
      String(newPassword || "")
    );
    if (!result.ok) return c.json({ success: false, error: result.error }, 400);
    const token = accountTokenFromRequest(c);
    const oldSessionId = token ? await sessionIdOfToken(c.env.DB, token) : null;
    await revokeAllSessions(c.env.DB, account.username);
    const session = await createSession(c.env.DB, account.username, c.req.header("User-Agent"));
    if (oldSessionId) {
      try {
        await c.env.DB.prepare("DELETE FROM login_devices WHERE session_id = ?").bind(oldSessionId).run();
      } catch {
      }
    }
    return c.json({ success: true }, 200, {
      "Set-Cookie": `account_session=${session.token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/account/family/members", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const result = await registry.listFamilyMembers(account.username);
    if (!result.ok) return c.json({ success: false, error: result.error }, 404);
    return c.json({ success: true, members: result.members });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/account/profile/:username", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await registry.getProfile(c.req.param("username"));
    if (!account) return c.json({ success: false, error: "用户不存在" }, 404);
    return c.json({
      success: true,
      profile: { displayName: account.displayName, emoji: account.emoji }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/budgets", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const budgets = await d1GetBudgets(c.env.DB, auth.scope);
    return c.json({ success: true, budgets });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/budgets", async (c) => {
  try {
    const { scope, kind, category, amount } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    if (kind !== "monthly" && kind !== "category") {
      return c.json({ success: false, error: "kind 仅支持 monthly / category" }, 400);
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return c.json({ success: false, error: "预算金额需为正数" }, 400);
    }
    if (kind === "category" && !category) {
      return c.json({ success: false, error: "分类预算需指定 category" }, 400);
    }
    const budget = await d1SetBudget(c.env.DB, auth.scope, { kind, category, amount: amt });
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "budget_set",
        targetType: "budget",
        targetId: budget.id,
        summary: kind === "monthly" ? `设置月度总预算 ¥${amt.toFixed(2)}` : `设置「${category}」分类预算 ¥${amt.toFixed(2)}`
      },
      { type: "budget-changed", by: auth.account.username }
    );
    return c.json({ success: true, budget });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/budgets/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const id = c.req.param("id");
    const target = (await d1GetBudgets(c.env.DB, auth.scope)).find((b) => b.id === id);
    const done = await d1DeleteBudget(c.env.DB, auth.scope, id);
    if (!done) return c.json({ success: false, error: "预算不存在" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "budget_delete",
        targetType: "budget",
        targetId: id,
        summary: target ? target.kind === "monthly" ? "删除月度总预算" : `删除「${target.category}」分类预算` : "删除预算"
      },
      { type: "budget-changed", by: auth.account.username }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/audit", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 50), 1), 200);
    const { entries, hasMore } = await d1GetAudit(c.env.DB, auth.scope, {
      actor: c.req.query("actor") || void 0,
      action: c.req.query("action") || void 0,
      before: c.req.query("before") ? Number(c.req.query("before")) : void 0,
      since: c.req.query("since") ? Number(c.req.query("since")) : void 0,
      limit
    });
    return c.json({ success: true, entries, hasMore });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/audit/retention", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const retention = await d1GetAuditRetention(c.env.DB, auth.scope);
    return c.json({ success: true, retention });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/audit/retention", async (c) => {
  try {
    const auth = await requireScopeAccess(c, await c.req.json().then((b) => b.scope).catch(() => null));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const { days } = await c.req.json();
    if (![0, 90, 180, 365].includes(Number(days))) {
      return c.json({ success: false, error: "保留策略仅支持 0（永久）/90/180/365 天" }, 400);
    }
    await d1SetAuditRetention(c.env.DB, auth.scope, Number(days));
    await d1AddAudit(c.env.DB, {
      scope: auth.scope,
      actorUsername: auth.account.username,
      actorDisplay: auth.account.displayName,
      action: "audit_retention",
      targetType: "settings",
      summary: `审计保留策略设为 ${Number(days) === 0 ? "永久" : `${days} 天`}`
    });
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/audit/export", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const entries = await d1ExportAudit(c.env.DB, auth.scope);
    const body = JSON.stringify({
      format: "fiscus-audit-export",
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope: auth.scope,
      count: entries.length,
      entries
    }, null, 2);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="fiscus-audit-${auth.scope}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json"`
      }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/backup/export", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const stub = c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(auth.scope));
    const [expenses, recurring, budgets, chat] = await Promise.all([
      getExpensesWithMigration(c.env, auth.scope),
      d1GetRecurring(c.env.DB, auth.scope),
      d1GetBudgets(c.env.DB, auth.scope),
      stub.getChatMessages()
    ]);
    const body = {
      format: "fiscus-backup",
      version: 2,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      scope: auth.scope,
      counts: {
        expenses: expenses.length,
        recurring: recurring.length,
        budgets: budgets.length,
        chat: chat.length
      },
      expenses,
      recurring,
      budgets,
      // v2：完整预算字段（v1 仅 id/kind/category/amount）
      chat
    };
    const bodyText = JSON.stringify(body);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bodyText));
    const checksum = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const backup = { ...body, checksum };
    await d1AddAudit(c.env.DB, {
      scope: auth.scope,
      actorUsername: auth.account.username,
      actorDisplay: auth.account.displayName,
      action: "export",
      targetType: "backup",
      summary: `导出完整备份 v2（${expenses.length} 笔账单 / ${recurring.length} 个订阅 / ${budgets.length} 条预算）`
    });
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="fiscus-backup-${auth.scope}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json"`
      }
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/backup/restore", async (c) => {
  try {
    const { scope, backup, mode } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const check = validateBackup(backup);
    if ("error" in check) {
      return c.json({ success: false, error: check.error }, 400);
    }
    const b = backup;
    if (typeof b.checksum === "string" && b.checksum.length === 64) {
      const bodyText = JSON.stringify({ ...b, checksum: void 0 });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bodyText));
      const actual = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
      if (actual !== b.checksum) {
        return c.json({ success: false, error: "备份文件校验失败（checksum 不匹配），文件可能被截断或修改" }, 400);
      }
    }
    const stub = c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(auth.scope));
    const backupExpenses = Array.isArray(backup.expenses) ? backup.expenses : [];
    let restorePointId;
    if (mode === "replace") {
      const [curExpenses, curRecurring, curBudgets] = await Promise.all([
        getExpensesWithMigration(c.env, auth.scope),
        d1GetRecurring(c.env.DB, auth.scope),
        d1GetBudgets(c.env.DB, auth.scope)
      ]);
      const curChat = await stub.getChatMessages();
      try {
        restorePointId = await d1CreateRestorePoint(c.env.DB, auth.scope, "replace-restore", {
          expenses: curExpenses,
          recurring: curRecurring,
          budgets: curBudgets,
          chat: curChat
        }, { expenses: curExpenses.length, recurring: curRecurring.length, budgets: curBudgets.length, chat: curChat.length });
      } catch (err) {
        console.error("[restore-point] create failed before replace:", err);
        return c.json({ success: false, error: "恢复点创建失败，已中止覆盖（避免不可逆丢失）" }, 500);
      }
      await d1ClearExpenses(c.env.DB, auth.scope);
      const curRecurringIds = curRecurring.map((r) => r.id);
      for (const rid of curRecurringIds) await d1DeleteRecurring(c.env.DB, auth.scope, rid);
      const curBudgetIds = curBudgets.map((x) => x.id);
      for (const bid of curBudgetIds) await d1DeleteBudget(c.env.DB, auth.scope, bid);
      await stub.clearChatMessages();
    }
    const importedExpenses = await d1ImportExpenses(c.env.DB, auth.scope, backupExpenses);
    const importedChat = Array.isArray(backup.chat) ? await stub.importChatMessages(backup.chat) : 0;
    const importedBudgets = Array.isArray(backup.budgets) ? await d1ImportBudgets(c.env.DB, auth.scope, backup.budgets) : 0;
    let importedRecurring = 0;
    const backupRecurring = Array.isArray(backup.recurring) ? backup.recurring : null;
    if (backupRecurring) {
      const existingSubs = await d1GetRecurring(c.env.DB, auth.scope);
      const seen = new Set(existingSubs.map((r) => r.name));
      for (const r of backupRecurring) {
        if (r && r.name && !seen.has(String(r.name))) {
          await d1AddRecurring(c.env.DB, auth.scope, {
            id: crypto.randomUUID(),
            name: String(r.name).slice(0, 100),
            amount: Number(r.amount) || 0,
            category: String(r.category || "Other"),
            merchant: r.merchant ? String(r.merchant) : void 0,
            dayOfMonth: Number(r.dayOfMonth) || 1,
            active: true
          });
          seen.add(String(r.name));
          importedRecurring++;
        }
      }
    }
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "restore",
        targetType: "backup",
        summary: `恢复备份：账单 +${importedExpenses} · 订阅 +${importedRecurring} · 预算 +${importedBudgets} · 聊天 +${importedChat}${mode === "replace" ? "（全量替换模式）" : ""}`,
        detail: JSON.stringify({ mode: mode || "merge", importedExpenses, importedRecurring, importedBudgets, importedChat, restorePointId })
      },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({
      success: true,
      importedExpenses,
      importedRecurring,
      importedBudgets,
      importedChat,
      restorePointId,
      warnings: check.warnings
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/import/csv", async (c) => {
  try {
    const { scope, rows, step, skipRows: skipRowsRaw } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    if (!Array.isArray(rows) || rows.length === 0) {
      return c.json({ success: false, error: "没有可导入的数据" }, 400);
    }
    const expenses = [];
    const invalid = [];
    rows.forEach((r, i) => {
      const amount = Number(r.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        invalid.push({ row: i + 1, reason: "金额无效" });
        return;
      }
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) {
        invalid.push({ row: i + 1, reason: "日期格式应为 YYYY-MM-DD" });
        return;
      }
      expenses.push({
        id: crypto.randomUUID(),
        amount,
        category: String(r.category || "Other").slice(0, 50),
        merchant: r.merchant ? String(r.merchant).slice(0, 100) : void 0,
        description: String(r.description || "").slice(0, 500),
        date: String(r.date),
        createdAt: Date.now(),
        type: r.type === "income" ? "income" : "expense",
        by: r.by ? String(r.by).slice(0, 50) : void 0,
        byId: r.byId ? String(r.byId).slice(0, 50) : void 0,
        parsedBy: "ai"
      });
    });
    if (step !== "confirm") {
      const duplicates = [];
      for (let i = 0; i < expenses.length && duplicates.length < 20; i++) {
        const dup = await d1FindDuplicate(c.env.DB, auth.scope, expenses[i]);
        if (dup) {
          duplicates.push({
            row: i + 1,
            existing: { id: dup.id, date: dup.date, merchant: dup.merchant, amount: dup.amount }
          });
        }
      }
      return c.json({
        success: true,
        step: "preview",
        valid: expenses.length,
        invalid,
        duplicates,
        preview: expenses.slice(0, 20).map((e) => ({
          date: e.date,
          type: e.type,
          amount: e.amount,
          category: e.category,
          merchant: e.merchant,
          by: e.by
        }))
      });
    }
    const skipRows = new Set(
      Array.isArray(skipRowsRaw) ? skipRowsRaw.filter((n) => Number.isFinite(Number(n))) : []
    );
    const toImport = expenses.filter((_, i) => !skipRows.has(i + 1));
    if (toImport.length === 0) {
      return c.json({ success: false, error: "没有有效数据行（需含日期与金额）" }, 400);
    }
    const imported = await d1ImportExpenses(c.env.DB, auth.scope, toImport);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "import",
        targetType: "expense",
        summary: `CSV 导入 ${imported} 条记录${skipRows.size > 0 ? `（跳过 ${skipRows.size} 行疑似重复）` : ""}`,
        detail: JSON.stringify({ total: rows.length, valid: expenses.length, imported, skipped: skipRows.size })
      },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true, imported });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/family/members/:username/role", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const { role } = await c.req.json();
    if (!["admin", "contributor", "viewer"].includes(role)) {
      return c.json({ success: false, error: "角色仅支持 admin / contributor / viewer" }, 400);
    }
    const result = await registry.setMemberRole(account.username, c.req.param("username"), role);
    if (!result.ok) return c.json({ success: false, error: result.error }, 400);
    const roleRes = await registry.getMemberRole(account.username);
    if (roleRes.ok && roleRes.scopeId) {
      await auditAndBroadcast(
        c.env,
        roleRes.scopeId,
        account,
        {
          action: "role_change",
          targetType: "role",
          targetId: String(c.req.param("username")),
          summary: `将 ${c.req.param("username")} 的角色设为「${role === "admin" ? "管理员" : role === "contributor" ? "可记账" : "只读"}」`
        },
        { type: "role-changed", by: account.username }
      );
    }
    return c.json({ success: true, members: result.members });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/family/my-role", async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: "未登录" }, 401);
    const result = await registry.getMemberRole(account.username);
    return c.json({
      success: true,
      role: result.ok ? result.role : null,
      // null = 无家庭（个人区，不受限）
      scopeId: result.ok ? result.scopeId : null
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/recycle-bin", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const items = await d1GetRecycleBin(c.env.DB, auth.scope);
    return c.json({ success: true, items });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/recycle-bin/:id/restore", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "expense");
    if (denied) return denied;
    const restored = await d1RestoreExpense(c.env.DB, auth.scope, c.req.param("id"));
    if (!restored) return c.json({ success: false, error: "记录不存在或已过保留期" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "restore",
        targetType: "expense",
        targetId: restored.id,
        summary: `从回收站恢复 ¥${restored.amount.toFixed(2)}（${restored.merchant || restored.category}，${restored.date}）`
      },
      { type: "expense-added", by: auth.account.username, payload: { expenseId: restored.id } }
    );
    return c.json({ success: true, expense: restored });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/recycle-bin/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    await c.env.DB.prepare("DELETE FROM expenses WHERE scope = ? AND id = ? AND deleted_at IS NOT NULL").bind(auth.scope, c.req.param("id")).run();
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      { action: "purge", targetType: "expense", targetId: c.req.param("id"), summary: "从回收站彻底删除一条记录" }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/expenses/batch-update", async (c) => {
  try {
    const { scope, ids, patch } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "expense");
    if (denied) return denied;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
      return c.json({ success: false, error: "ids 需为 1-200 条" }, 400);
    }
    const clean = {};
    if (patch.category !== void 0) {
      const cat = String(patch.category).slice(0, 50);
      if (!cat) return c.json({ success: false, error: "分类不能为空" }, 400);
      clean.category = cat;
    }
    if (patch.date !== void 0) {
      const date = String(patch.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ success: false, error: "日期格式应为 YYYY-MM-DD" }, 400);
      clean.date = date;
    }
    if (patch.accountId !== void 0) clean.accountId = String(patch.accountId).slice(0, 60) || void 0;
    if (Object.keys(clean).length === 0) {
      return c.json({ success: false, error: "没有可修改的字段（category/date/accountId）" }, 400);
    }
    const updated = await d1BatchUpdateExpenses(c.env.DB, auth.scope, ids, clean);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "batch-update",
        targetType: "expense",
        summary: `批量修改 ${updated} 条记录（${Object.keys(clean).join("、")}）`,
        detail: JSON.stringify({ count: updated, patch: clean })
      },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true, updated });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/stats/monthly", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const month = c.req.query("month") || (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: "month 格式应为 YYYY-MM" }, 400);
    }
    const stats = await d1MonthlyStats(c.env.DB, auth.scope, month);
    return c.json({ success: true, month, ...stats });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/accounts", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const includeArchived = c.req.query("includeArchived") === "1";
    const accounts = await d1GetAccounts(c.env.DB, auth.scope, includeArchived);
    return c.json({ success: true, accounts });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/accounts", async (c) => {
  try {
    const { scope, name, type, icon, initialBalance, note } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const cleanName = String(name || "").trim().slice(0, 50);
    if (!cleanName) return c.json({ success: false, error: "账户名不能为空" }, 400);
    const validTypes = ["cash", "bank", "alipay", "wechat", "other"];
    const cleanType = validTypes.includes(String(type)) ? type : "other";
    const amt = Number(initialBalance) || 0;
    if (!Number.isFinite(amt)) return c.json({ success: false, error: "初始余额需为数字" }, 400);
    const account = await d1AddAccount(c.env.DB, auth.scope, {
      id: crypto.randomUUID(),
      name: cleanName,
      type: cleanType,
      icon: icon ? String(icon).slice(0, 10) : void 0,
      initialBalance: amt,
      note: note ? String(note).slice(0, 200) : void 0
    });
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      { action: "account_create", targetType: "account", targetId: account.id, summary: `新增账户「${account.name}」（初始余额 ¥${amt.toFixed(2)}）` },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true, account });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.patch("/api/accounts/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const patch = await c.req.json();
    const clean = {};
    if (patch.name !== void 0) clean.name = String(patch.name).trim().slice(0, 50);
    if (patch.type !== void 0 && ["cash", "bank", "alipay", "wechat", "other"].includes(String(patch.type))) {
      clean.type = String(patch.type);
    }
    if (patch.icon !== void 0) clean.icon = String(patch.icon).slice(0, 10);
    if (patch.initialBalance !== void 0) {
      const amt = Number(patch.initialBalance);
      if (!Number.isFinite(amt)) return c.json({ success: false, error: "初始余额需为数字" }, 400);
      clean.initialBalance = amt;
    }
    if (patch.note !== void 0) clean.note = String(patch.note).slice(0, 200);
    if (patch.archived !== void 0) clean.archived = Boolean(patch.archived);
    if (Object.keys(clean).length === 0) {
      return c.json({ success: false, error: "没有可修改的字段" }, 400);
    }
    const updated = await d1UpdateAccount(c.env.DB, auth.scope, c.req.param("id"), clean);
    if (!updated) return c.json({ success: false, error: "账户不存在" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      { action: "account_update", targetType: "account", targetId: updated.id, summary: `修改账户「${updated.name}」（${Object.keys(clean).join("、")}）` },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true, account: updated });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/accounts/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const target = (await d1GetAccounts(c.env.DB, auth.scope, true)).find((a) => a.id === c.req.param("id"));
    const done = await d1DeleteAccount(c.env.DB, auth.scope, c.req.param("id"));
    if (!done) return c.json({ success: false, error: "账户不存在" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      { action: "account_delete", targetType: "account", targetId: c.req.param("id"), summary: target ? `归档账户「${target.name}」` : "归档账户" },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/accounts/balances", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const month = c.req.query("month") || (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: "month 格式应为 YYYY-MM" }, 400);
    }
    const balances = await d1AccountBalances(c.env.DB, auth.scope, month);
    return c.json({ success: true, month, balances });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/transfers", async (c) => {
  try {
    const { scope, fromAccount, toAccount, amount, date, note } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "expense");
    if (denied) return denied;
    if (!fromAccount || !toAccount || fromAccount === toAccount) {
      return c.json({ success: false, error: "转出/转入账户不能为空且不能相同" }, 400);
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return c.json({ success: false, error: "金额需为正数" }, 400);
    }
    const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const transfer = await d1AddTransfer(c.env.DB, auth.scope, {
      id: crypto.randomUUID(),
      scope: auth.scope,
      fromAccount: String(fromAccount).slice(0, 60),
      toAccount: String(toAccount).slice(0, 60),
      amount: amt,
      date: dateStr,
      note: note ? String(note).slice(0, 200) : void 0
    });
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "transfer",
        targetType: "transfer",
        targetId: transfer.id,
        summary: `转账 ¥${amt.toFixed(2)}（${transfer.fromAccount} → ${transfer.toAccount}，${dateStr}）`
      },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true, transfer });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/transfers", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 50), 1), 200);
    const transfers = await d1GetTransfers(c.env.DB, auth.scope, limit);
    return c.json({ success: true, transfers });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/transfers/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "expense");
    if (denied) return denied;
    const done = await d1DeleteTransfer(c.env.DB, auth.scope, c.req.param("id"));
    if (!done) return c.json({ success: false, error: "转账记录不存在" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      { action: "transfer_delete", targetType: "transfer", targetId: c.req.param("id"), summary: "删除一条转账记录" },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/rules", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const rules = await d1GetRules(c.env.DB, auth.scope);
    return c.json({ success: true, rules });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/rules", async (c) => {
  try {
    const { scope, kind, pattern, category } = await c.req.json();
    const auth = await requireScopeAccess(c, scope);
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    if (kind !== "merchant" && kind !== "keyword") {
      return c.json({ success: false, error: "kind 仅支持 merchant / keyword" }, 400);
    }
    const cleanPattern = String(pattern || "").trim();
    if (cleanPattern.length < 1) return c.json({ success: false, error: "匹配内容不能为空" }, 400);
    const cleanCategory = String(category || "").trim().slice(0, 50);
    if (!cleanCategory) return c.json({ success: false, error: "目标分类不能为空" }, 400);
    const rule = await d1AddRule(c.env.DB, auth.scope, {
      kind,
      pattern: cleanPattern,
      category: cleanCategory
    });
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      { action: "rule_create", targetType: "rule", targetId: rule.id, summary: `新增规则「${rule.pattern} → ${rule.category}」` },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true, rule });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/rules/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const done = await d1DeleteRule(c.env.DB, auth.scope, c.req.param("id"));
    if (!done) return c.json({ success: false, error: "规则不存在" }, 404);
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      { action: "rule_delete", targetType: "rule", targetId: c.req.param("id"), summary: "删除一条分类规则" },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/notifications", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const unreadOnly = c.req.query("unreadOnly") === "1";
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 50), 1), 100);
    const [items, unread] = await Promise.all([
      d1GetNotifications(c.env.DB, auth.scope, { unreadOnly, limit }),
      d1CountUnread(c.env.DB, auth.scope)
    ]);
    return c.json({ success: true, items, unread });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/notifications/:id/read", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    await d1MarkNotificationRead(c.env.DB, auth.scope, c.req.param("id"));
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/notifications/read-all", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    await d1MarkAllNotificationsRead(c.env.DB, auth.scope);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.delete("/api/notifications/:id", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    await d1DeleteNotification(c.env.DB, auth.scope, c.req.param("id"));
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.get("/api/restore-points", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const points = await d1ListRestorePoints(c.env.DB, auth.scope);
    return c.json({
      success: true,
      points: points.map((p) => ({
        id: p.id,
        reason: p.reason,
        counts: p.counts ? JSON.parse(p.counts) : void 0,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt
      }))
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/restore-points/:id/rollback", async (c) => {
  try {
    const auth = await requireScopeAccess(c, c.req.query("scope"));
    if (!auth.ok) return auth.response;
    const denied = await requireWriteAccess(c, auth, "manage");
    if (denied) return denied;
    const point = await d1GetRestorePoint(c.env.DB, auth.scope, c.req.param("id"));
    if (!point) return c.json({ success: false, error: "恢复点不存在或已过期" }, 404);
    const payload = JSON.parse(point.payload);
    await d1ClearExpenses(c.env.DB, auth.scope);
    if (Array.isArray(payload.expenses)) {
      await d1ImportExpenses(c.env.DB, auth.scope, payload.expenses);
    }
    const stub = c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(auth.scope));
    const existingSubs = await d1GetRecurring(c.env.DB, auth.scope);
    for (const r of existingSubs) await d1DeleteRecurring(c.env.DB, auth.scope, r.id);
    if (Array.isArray(payload.recurring)) {
      for (const r of payload.recurring) {
        if (r && r.name) {
          await d1AddRecurring(c.env.DB, auth.scope, {
            id: crypto.randomUUID(),
            name: String(r.name).slice(0, 100),
            amount: Number(r.amount) || 0,
            category: String(r.category || "Other"),
            merchant: r.merchant ? String(r.merchant) : void 0,
            dayOfMonth: Number(r.dayOfMonth) || 1,
            active: true
          });
        }
      }
    }
    const existingBudgets = await d1GetBudgets(c.env.DB, auth.scope);
    for (const b of existingBudgets) await d1DeleteBudget(c.env.DB, auth.scope, b.id);
    if (Array.isArray(payload.budgets)) {
      await d1ImportBudgets(c.env.DB, auth.scope, payload.budgets);
    }
    await stub.clearChatMessages();
    if (Array.isArray(payload.chat)) {
      await stub.importChatMessages(payload.chat);
    }
    await auditAndBroadcast(
      c.env,
      auth.scope,
      auth.account,
      {
        action: "rollback",
        targetType: "restore-point",
        targetId: point.id,
        summary: `回退到恢复点（${point.reason === "clear-all" ? "清空前" : "覆盖恢复前"}的快照）`
      },
      { type: "sync-refresh", by: auth.account.username }
    );
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});
app.post("/api/internal/do-backup", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const action = body.action || "status";
    if (action === "status") {
      const status = await getDoBackupStatus(c.env);
      return c.json({ ok: true, coverage: status.scopes, runs: status.runs });
    }
    if (action === "run") {
      const result = await runFullDoBackup(c.env, "manual");
      return c.json(result);
    }
    if (action === "restore") {
      const doClass = body.doClass === "UserRegistry" ? "UserRegistry" : body.doClass === "FinanceMemory" ? "FinanceMemory" : null;
      if (!doClass) return c.json({ ok: false, error: "doClass 需为 FinanceMemory 或 UserRegistry" }, 400);
      const scope = typeof body.scope === "string" ? body.scope : "";
      if (!scope) return c.json({ ok: false, error: "scope 必填" }, 400);
      if (body.confirm !== scope) {
        return c.json({ ok: false, error: "恢复操作需 confirm 与 scope 完全一致以二次确认" }, 400);
      }
      const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string" && k.length > 0) : void 0;
      const result = await restoreDoBackup(c.env, doClass, scope, keys);
      console.log("[do-backup] restore done:", doClass, scope, keys ?? "all", JSON.stringify(result));
      return c.json({ ok: true, doClass, scope, ...result });
    }
    return c.json({ ok: false, error: "未知 action（支持 status / run / restore）" }, 400);
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
app.get("/api/sync-ws", async (c) => {
  const registry = registryStub(c);
  const account = await sessionFromRequest(c, registry);
  if (!account) return c.json({ success: false, error: "未登录" }, 401);
  const scope = c.req.query("scope");
  if (!scope) return c.json({ success: false, error: "scope required" }, 400);
  const scopes = await accessibleScopes(c, account);
  if (scope !== scopes.personal && scope !== scopes.family) {
    return c.json({ success: false, error: "无权访问该作用域" }, 403);
  }
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ success: false, error: "Expected WebSocket" }, 400);
  }
  const stub = c.env.FINANCE_MEMORY.get(c.env.FINANCE_MEMORY.idFromName(scope));
  return stub.fetch(c.req.raw);
});
const index = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  async scheduled(_controller, env) {
    try {
      const result = await runFullDoBackup(env, "cron");
      console.log("[do-backup] cron run finished:", JSON.stringify(result));
    } catch (err) {
      console.error("[do-backup] cron run failed:", err);
    }
  }
};
const workerEntry = index ?? {};
export {
  FinanceMemory,
  UserRegistry,
  workerEntry as default
};

// Typed storage adapters reuse the production behavior without changing route/security contracts.
export { app as liveApp, d1GetExpenses, d1UpdateExpense, d1SoftDeleteExpense, d1ClearExpenses,
  d1ImportExpenses, d1AddExpense, writeDoStorageBackup, readDoStorageBackup,
  deleteDoBackupKeys, createSession, verifySession, revokeSession };
