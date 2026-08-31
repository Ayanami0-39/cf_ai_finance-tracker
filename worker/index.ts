import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { FinanceMemory } from './durable-objects/FinanceMemory';
import { UserRegistry } from './durable-objects/UserRegistry';
import type { Expense } from './types/expense';
import { processExpenseInput } from "./ai/parse-expense";
import { INTENTS } from "./ai/prompts/intent-classification";
import { classifyIntent } from "./ai/classify-intent";
import { queryExpenses } from "./ai/query-expenses";
import { identifyExpenseToDelete } from "./ai/delete-expense";
import {
  deriveToken,
  verifyRequest,
  handleAuthVerify,
  authNotConfiguredResponse,
  loginPageResponse,
} from './auth';
import {
  d1GetExpenses,
  d1AddExpense,
  d1DeleteExpense,
  d1UpdateExpense,
  d1ImportExpenses,
  d1ClearExpenses,
} from './db/expenses';

/**
 * 读取某 scope 的交易记录（D1 为主存储）。
 * 首次读取且 D1 为空时，从旧 DO 存储按 id 去重搬迁到 D1（幂等：搬迁后再查 D1），
 * 实现「零手工操作」的历史数据迁移；旧 DO 数据保留不删，作为冷备份。
 */
async function getExpensesWithMigration(env: Env, scope: string): Promise<Expense[]> {
  const d1Expenses = await d1GetExpenses(env.DB, scope);
  if (d1Expenses.length > 0) return d1Expenses;

  try {
    const legacyStub = env.FINANCE_MEMORY.get(env.FINANCE_MEMORY.idFromName(scope));
    const legacy = await legacyStub.getExpenses();
    if (legacy.length > 0) {
      await d1ImportExpenses(env.DB, scope, legacy);
      return await d1GetExpenses(env.DB, scope);
    }
  } catch (e) {
    console.error(`[migration] legacy DO read failed for ${scope}:`, e);
  }
  return d1Expenses;
}

export { FinanceMemory };
export { UserRegistry } from './durable-objects/UserRegistry';

interface Env {
  AI: Ai;
  FINANCE_MEMORY: DurableObjectNamespace<FinanceMemory>;
  USER_REGISTRY: DurableObjectNamespace<UserRegistry>;
  DB: D1Database;
  AUTH_PASSWORD?: string;
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();

// ---- 密码门禁：所有请求（页面、静态资源、API）先过鉴权 ----
app.use('/*', async (c, next) => {
  const { pathname } = new URL(c.req.raw.url);
  const password = c.env.AUTH_PASSWORD;

  // /auth 端点本身：未配置密码时也响应（登录页会给出配置提示）
  if (pathname === '/auth') {
    if (!password) {
      return c.req.method === 'GET'
        ? authNotConfiguredResponse(pathname)
        : handleAuthVerify(c.req.raw, '');
    }
    return handleAuthVerify(c.req.raw, password);
  }

  // 未配置密码 → 锁定全部内容（fail-closed）
  if (!password) {
    return authNotConfiguredResponse(pathname);
  }

  const expected = await deriveToken(password);
  if (!verifyRequest(c.req.raw, expected)) {
    return loginPageResponse();
  }

  // 鉴权通过后，非 API 请求转发给静态资源服务（页面、JS、CSS 等）
  if (!pathname.startsWith('/api/')) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  await next();
});

app.use('/*', cors());

app.get('/', (c) => {
  return c.json({
    name: 'Finance Tracker API',
    version: '2.0.0',
    status: 'running',
    features: ['Natural Language Processing', 'AI Categorization']
  });
});

app.post('/api/expense-natural', async (c) => {
  try {
  const body = await c.req.json();
  const { userId, input, memberName, memberId } = body;

  if (!userId) {
    return c.json({ success: false, error: 'userId required' }, 400);
  }

  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return c.json({ success: false, error: 'input required' }, 400);
  }

  const aiResult = await processExpenseInput(c.env.AI, input, memberName);

    if (!aiResult.success) {
      return c.json({
        success: false,
        error: 'Could not understand expense'
      }, 400);
    }

    const expense: Expense = {
      id: crypto.randomUUID(),
      amount: aiResult.amount,
      category: aiResult.category,
      merchant: aiResult.merchant,
      description: input,
      date: aiResult.date || new Date().toISOString().split('T')[0],
      createdAt: Date.now(),
      type: aiResult.type,
      by: memberName,
      byId: memberId,
      parsedBy: aiResult.parsedBy
    };

    try {
      await d1AddExpense(c.env.DB, userId, expense);

      return c.json({
        success: true,
        message: aiResult.message,
        parsedBy: aiResult.parsedBy,
        expense: {
          id: expense.id,
          amount: expense.amount,
          category: expense.category,
          merchant: expense.merchant,
          parsedBy: expense.parsedBy
        }
      });

    } catch (dbError) {
      console.error('❌ Database error:', dbError);

      return c.json({
        success: false,
        message: "Sorry, couldn't save your expense.",
        error: 'Database error'
      }, 500);
    }

  } catch (error) {
    console.error('❌ API Error:', error);

    return c.json({
      success: false,
      message: "Something went wrong. Please try again.",
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.post('/api/expenses', async (c) => {
  try {
    const body = await c.req.json();

    if (!body.userId || !body.amount || !body.description) {
      return c.json({ error: 'Missing fields' }, 400);
    }

    const expense: Expense = {
      id: crypto.randomUUID(),
      amount: Number(body.amount),
      category: body.category || 'Other',
      description: body.description,
      merchant: body.merchant,
      date: new Date().toISOString().split('T')[0],
      createdAt: Date.now(),
      by: body.memberName || undefined,
      byId: body.memberId || undefined
    };

    const id = crypto.randomUUID();
    void id;
    await d1AddExpense(c.env.DB, body.userId, expense);

    return c.json({ success: true, expense });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/expenses/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const expenses = await getExpensesWithMigration(c.env, userId);

    return c.json({ success: true, expenses, count: expenses.length });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.delete('/api/expenses/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    await d1ClearExpenses(c.env.DB, userId);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Delete a single expense by id
app.delete('/api/expenses/:userId/:expenseId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const expenseId = c.req.param('expenseId');

    const deleted = await d1DeleteExpense(c.env.DB, userId, expenseId);
    if (!deleted) {
      return c.json({ success: false, error: 'Expense not found' }, 404);
    }
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Edit a single expense（弹窗修改日期、金额、类型、商家、分类、描述）
app.patch('/api/expenses/:userId/:expenseId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const expenseId = c.req.param('expenseId');
    const body = await c.req.json().catch(() => ({}));

    // 白名单字段校验：金额必须为正数，日期必须合法，类型仅限收支两种
    const patch: Record<string, unknown> = {};
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return c.json({ success: false, error: '金额必须是大于 0 的数字' }, 400);
      }
      patch.amount = amount;
    }
    if (body.date !== undefined) {
      const date = String(body.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
        return c.json({ success: false, error: '日期格式应为 YYYY-MM-DD' }, 400);
      }
      patch.date = date;
    }
    if (body.type !== undefined) {
      if (body.type !== 'expense' && body.type !== 'income') {
        return c.json({ success: false, error: '类型仅支持 expense / income' }, 400);
      }
      patch.type = body.type;
    }
    if (body.merchant !== undefined) patch.merchant = String(body.merchant).slice(0, 100) || undefined;
    if (body.description !== undefined) patch.description = String(body.description).slice(0, 500) || undefined;
    if (body.category !== undefined) patch.category = String(body.category).slice(0, 50) || 'Other';

    if (Object.keys(patch).length === 0) {
      return c.json({ success: false, error: '没有需要修改的字段' }, 400);
    }

    const updated = await d1UpdateExpense(c.env.DB, userId, expenseId, patch as Partial<Expense>);
    if (!updated) {
      return c.json({ success: false, error: '记录不存在' }, 404);
    }

    return c.json({ success: true, expense: updated });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// Chat history endpoints
app.get('/api/chat/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');

    // 游标分页：?before=<timestamp> 返回该时间戳之前的消息（新→旧取一页，返回旧→新升序）。
    // 首屏（不带 before）：只返回最新 limit 条，避免长会话一次全量下发。
    const beforeParam = c.req.query('before');
    const before = beforeParam ? Number(beforeParam) : null;
    const limit = Math.min(Math.max(Number(c.req.query('limit') || 20), 1), 100);

    const id = c.env.FINANCE_MEMORY.idFromName(userId);
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

app.post('/api/chat/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const body = await c.req.json();

    if (!body.role || !body.content) {
      return c.json({ error: 'Missing role or content' }, 400);
    }

    const message = {
      id: body.id || crypto.randomUUID(),
      role: body.role,
      content: body.content,
      timestamp: body.timestamp || Date.now(),
      by: body.by || undefined,
      expense: body.expense
    };

    const id = c.env.FINANCE_MEMORY.idFromName(userId);
    const stub = c.env.FINANCE_MEMORY.get(id);

    // Retry logic for Durable Object connection issues
    let retries = 3;
    while (retries > 0) {
      try {
        await stub.addChatMessage(message);
        break;
      } catch (err: any) {
        retries--;
        if (retries === 0 || !err.retryable) {
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return c.json({ success: true, message });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.delete('/api/chat/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const id = c.env.FINANCE_MEMORY.idFromName(userId);
    const stub = c.env.FINANCE_MEMORY.get(id);
    await stub.clearChatMessages();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.post('/api/voice-command', async (c) => {
  try {
    const { userId, input, memberName, memberId } = await c.req.json();

    if (!userId || !input) {
      return c.json({ success: false, error: 'Missing userId or input' }, 400);
    }

    const intent = await classifyIntent(c.env.AI, input);


    if (intent === INTENTS.ADD_EXPENSE) {
      const aiResult = await processExpenseInput(c.env.AI, input, memberName);

      if (!aiResult.success) {
        return c.json({
          success: false,
          message: /(花了|买|付|记账|记录|块|元)/.test(input)
            ? "没太听懂这笔记录，试试说「我花了 50 块买咖啡」"
            : "Sorry, I couldn't understand that expense. Try: 'I spent $50 on coffee'"
        }, 400);
      }

      const expense: Expense = {
        id: crypto.randomUUID(),
        amount: aiResult.amount,
        category: aiResult.category,
        merchant: aiResult.merchant,
        description: input,
        date: aiResult.date || new Date().toISOString().split('T')[0],
        createdAt: Date.now(),
        type: aiResult.type,
        by: memberName,
        byId: memberId,
        parsedBy: aiResult.parsedBy
      };

      try {
        await d1AddExpense(c.env.DB, userId, expense);

      // 指定日期记账时在确认语中明示，避免用户误以为记到今天
      const datedMsg =
        aiResult.date && aiResult.date !== new Date().toISOString().split('T')[0]
          ? `${aiResult.message}（记在 ${aiResult.date}）`
          : aiResult.message;

      return c.json({
        success: true,
        message: datedMsg,
        parsedBy: aiResult.parsedBy,
        data: { expense }
      });

      } catch (dbError) {
        return c.json({
          success: false,
          message: /(花了|买|付|记账|记录)/.test(input)
            ? "抱歉，保存这笔记录失败了。"
            : "Sorry, couldn't save your expense."
        }, 500);
      }
    }

    else if (intent === INTENTS.QUERY) {
      const expenses = await getExpensesWithMigration(c.env, userId);

      const answer = await queryExpenses(c.env.AI, input, expenses);

      return c.json({
        success: true,
        message: answer,
        data: { count: expenses.length }
      });
    }

    else if (intent === INTENTS.HELP) {
      return c.json({
        success: true,
        message: "我可以帮你记账！试试说「我花了 50 块买咖啡」或「这个月花了多少钱」。I can also help in English: 'I spent $50 on coffee'."
      });
    }

    else if (intent === INTENTS.DELETE_EXPENSE) {
      const expenses = await getExpensesWithMigration(c.env, userId);

      const deleteResult = await identifyExpenseToDelete(c.env.AI, input, expenses);

      if (!deleteResult.success || (!deleteResult.expenseId && !deleteResult.expenseIds)) {
        return c.json({
          success: false,
          message: deleteResult.message
        });
      }

      // Bulk delete: delete all matching expenses
      if (deleteResult.isBulkDelete && deleteResult.expenseIds) {
        let deletedCount = 0;
        for (const expenseId of deleteResult.expenseIds) {
          const deleted = await d1DeleteExpense(c.env.DB, userId, expenseId);
          if (deleted) deletedCount++;
        }

        return c.json({
          success: true,
          message: deletedCount > 0
            ? deleteResult.message
            : "Couldn't delete those expenses. They might already be gone."
        });
      }

      // Single delete
      const deleted = await d1DeleteExpense(c.env.DB, userId, deleteResult.expenseId!);

      if (deleted) {
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
    }

    else {
      return c.json({
        success: true,
        message: "我没太理解你的意思。试试说「我花了 50 块买咖啡」或「这个月花了多少钱」。 Or try: 'I spent $X on something'."
      });
    }

  } catch (error) {
    return c.json({
      success: false,
      message: "Oops! Something went wrong."
    }, 500);
  }
});

// ---- Family endpoints（账号制：家庭注册表存 UserRegistry，数据存 family_ 作用域） ----

// 创建家庭：生成 6 位家庭码；可选把个人数据并入家庭共享区
app.post('/api/family/create', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

    const body = await c.req.json().catch(() => ({}));
    const result = await registry.createFamily(account.username);
    if (!result.ok || !result.family) {
      return c.json({ success: false, error: result.error }, 400);
    }

    // 可选迁移：把个人账单/聊天并入家庭共享作用域
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
        isOwner: true,
      },
      importedExpenses,
      importedChat,
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 凭家庭码加入家庭
app.post('/api/family/join', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

    const { code, mergePersonalData } = await c.req.json().catch(() => ({}));
    if (!code) return c.json({ success: false, error: '请输入家庭码' }, 400);

    const result = await registry.joinFamily(account.username, String(code));
    if (!result.ok || !result.family) {
      return c.json({ success: false, error: result.error }, 400);
    }

    // 默认把个人数据并入家庭共享区
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
        isOwner: false,
      },
      importedExpenses,
      importedChat,
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 我的家庭（含成员实时资料；未加入返回 family: null）
app.get('/api/family/mine', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

    const result = await registry.listFamilyMembers(account.username);
    if (!result.ok) {
      return c.json({ success: true, family: null, members: [] });
    }
    return c.json({
      success: true,
      family: result.family
        ? { code: result.family.code, scopeId: result.family.scopeId, isOwner: result.family.ownerUsername === account.username.toLowerCase() }
        : null,
      members: result.members,
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 移除成员（仅创建者）
app.delete('/api/family/members/:username', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

    const result = await registry.removeFamilyMember(account.username, c.req.param('username'));
    if (!result.ok) return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true, members: result.members });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 退出家庭（创建者退出则所有权转移给最早成员；无人则解散）
app.post('/api/family/leave', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

    const result = await registry.leaveFamily(account.username);
    if (!result.ok) return c.json({ success: false, error: result.error }, 400);
    return c.json({
      success: true,
      dissolved: result.dissolved || false,
      newOwner: result.newOwner || null,
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 更换家庭码（仅创建者；旧码立即失效）
app.post('/api/family/regenerate-code', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

    const result = await registry.regenerateFamilyCode(account.username);
    if (!result.ok || !result.family) {
      return c.json({ success: false, error: result.error }, 400);
    }
    return c.json({
      success: true,
      family: { code: result.family.code, scopeId: result.family.scopeId, isOwner: true },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 把源作用域的账单/聊天按 id 去重合并进目标作用域（家庭加入/创建时迁移个人数据用）
async function mergeScopes(
  env: Env,
  sourceScopeId: string,
  targetScopeId: string
): Promise<{ importedExpenses: number; importedChat: number }> {
  if (sourceScopeId === targetScopeId) return { importedExpenses: 0, importedChat: 0 };
  const sourceStub = env.FINANCE_MEMORY.get(
    env.FINANCE_MEMORY.idFromName(sourceScopeId)
  );
  const targetStub = env.FINANCE_MEMORY.get(
    env.FINANCE_MEMORY.idFromName(targetScopeId)
  );
  const [expenses, chat] = await Promise.all([
    d1GetExpenses(env.DB, sourceScopeId),
    sourceStub.getChatMessages(),
  ]);
  const importedExpenses = expenses.length
    ? await d1ImportExpenses(env.DB, targetScopeId, expenses)
    : 0;
  const importedChat = chat.length ? await targetStub.importChatMessages(chat) : 0;
  return { importedExpenses, importedChat };
}


// ---- Identity merge: 把源作用域（旧设备 ID）的数据合并到目标作用域（本机 ID） ----
app.post('/api/identity/merge', async (c) => {
  try {
    const { sourceScopeId, targetScopeId } = await c.req.json();

    if (!sourceScopeId || !targetScopeId || sourceScopeId === targetScopeId) {
      return c.json({ success: false, error: 'sourceScopeId and targetScopeId required' }, 400);
    }

    const sourceId = c.env.FINANCE_MEMORY.idFromName(sourceScopeId);
    const sourceStub = c.env.FINANCE_MEMORY.get(sourceId);
    const targetId = c.env.FINANCE_MEMORY.idFromName(targetScopeId);
    const targetStub = c.env.FINANCE_MEMORY.get(targetId);

    // 读取源作用域的全部数据（交易记录在 D1，聊天记录在 DO）
    const [expenses, chat] = await Promise.all([
      d1GetExpenses(c.env.DB, sourceScopeId),
      sourceStub.getChatMessages(),
    ]);

    // 合并（按 id 去重）到目标作用域
    const importedExpenses = expenses.length
      ? await d1ImportExpenses(c.env.DB, targetScopeId, expenses)
      : 0;
    const importedChat = chat.length
      ? await targetStub.importChatMessages(chat)
      : 0;

    return c.json({
      success: true,
      importedExpenses,
      importedChat,
      sourceCount: expenses.length,
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// ---- Account endpoints（用户名+密码登录，资料存服务端） ----

function registryStub(c: { env: Env }) {
  const id = c.env.USER_REGISTRY.idFromName('global');
  return c.env.USER_REGISTRY.get(id);
}

function makeSessionToken(username: string, passHash: string): string {
  // base64url(username:passHash) —— 无状态会话，密码修改后自动失效
  const raw = `${username}:${passHash}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseSessionToken(
  token: string
): { username: string; passHash: string } | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const bin = atob(b64 + pad);
    const idx = bin.indexOf(':');
    if (idx <= 0) return null;
    return { username: bin.slice(0, idx), passHash: bin.slice(idx + 1) };
  } catch {
    return null;
  }
}

async function sessionFromRequest(
  c: { req: { raw: Request } },
  registry: Awaited<ReturnType<typeof registryStub>>
) {
  const req = c.req.raw;
  let token: string | null = null;
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Account ')) token = auth.slice(8).trim();
  if (!token) {
    const cookie = req.headers.get('Cookie') || '';
    for (const pair of cookie.split(/;\s*/)) {
      const eq = pair.indexOf('=');
      if (eq > 0 && pair.slice(0, eq) === 'account_session') token = pair.slice(eq + 1);
    }
  }
  if (!token) return null;
  const session = parseSessionToken(token);
  if (!session) return null;
  const account = await registry.getProfile(session.username);
  if (!account || account.passHash !== session.passHash) return null; // 改密码后旧会话失效
  return account;
}

app.post('/api/account/register', async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password)
      return c.json({ success: false, error: '用户名和密码不能为空' }, 400);

    const registry = registryStub(c);
    const result = await registry.register(username, password);
    if (!result.ok || !result.account) {
      return c.json({ success: false, error: result.error }, 400);
    }

    const token = makeSessionToken(result.account.username, result.account.passHash);
    return c.json({
      success: true,
      token,
      account: {
        username: result.account.username,
        displayName: result.account.displayName,
        emoji: result.account.emoji,
        scopeId: result.account.scopeId,
      },
    }, 200, {
      'Set-Cookie':
        `account_session=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

app.post('/api/account/login', async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password)
      return c.json({ success: false, error: '用户名和密码不能为空' }, 400);

    const registry = registryStub(c);
    const result = await registry.verify(username, password);
    if (!result.ok || !result.account) {
      await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 150)));
      return c.json({ success: false, error: result.error }, 401);
    }

    const token = makeSessionToken(username, result.account.passHash);
    return c.json({
      success: true,
      token,
      account: {
        username: result.account.username,
        displayName: result.account.displayName,
        emoji: result.account.emoji,
        scopeId: result.account.scopeId,
      },
    }, 200, {
      'Set-Cookie':
        `account_session=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 当前账号资料（按会话令牌）
app.get('/api/account/me', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);
    return c.json({
      success: true,
      account: {
        username: account.username,
        displayName: account.displayName,
        emoji: account.emoji,
        scopeId: account.scopeId,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 修改昵称/头像（服务端，全设备生效）
app.patch('/api/account/me', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

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
        scopeId: result.account.scopeId,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 修改密码（旧会话全部失效，需重新登录）
app.post('/api/account/me/password', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await sessionFromRequest(c, registry);
    if (!account) return c.json({ success: false, error: '未登录' }, 401);

    const { oldPassword, newPassword } = await c.req.json();
    const result = await registry.changePassword(
      account.username,
      String(oldPassword || ''),
      String(newPassword || '')
    );
    if (!result.ok) return c.json({ success: false, error: result.error }, 400);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// 按用户名查询公开资料（昵称+头像）——账单/聊天展示"谁记的"用
app.get('/api/account/profile/:username', async (c) => {
  try {
    const registry = registryStub(c);
    const account = await registry.getProfile(c.req.param('username'));
    if (!account) return c.json({ success: false, error: '用户不存在' }, 404);
    return c.json({
      success: true,
      profile: { displayName: account.displayName, emoji: account.emoji },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export default app;
