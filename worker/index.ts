import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { FinanceMemory } from './durable-objects/FinanceMemory';
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

export { FinanceMemory };

interface Env {
  AI: Ai;
  FINANCE_MEMORY: DurableObjectNamespace<FinanceMemory>;
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
    const { userId, input } = body;

    if (!userId) {
      return c.json({ success: false, error: 'userId required' }, 400);
    }

    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return c.json({ success: false, error: 'input required' }, 400);
    }

    const aiResult = await processExpenseInput(c.env.AI, input);

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
      date: new Date().toISOString().split('T')[0],
      createdAt: Date.now()
    };

    try {
      const id = c.env.FINANCE_MEMORY.idFromName(userId);
      const stub = c.env.FINANCE_MEMORY.get(id);

      // Retry logic for Durable Object connection issues in dev mode
      let retries = 3;
      while (retries > 0) {
        try {
          await stub.addExpense(expense);
          break;
        } catch (err: any) {
          retries--;
          if (retries === 0 || !err.retryable) {
            throw err;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      return c.json({
        success: true,
        message: aiResult.message,
        expense: {
          id: expense.id,
          amount: expense.amount,
          category: expense.category,
          merchant: expense.merchant,
          date: expense.date
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
      createdAt: Date.now()
    };

    const id = c.env.FINANCE_MEMORY.idFromName(body.userId);
    const stub = c.env.FINANCE_MEMORY.get(id);

    // Retry logic for Durable Object connection issues
    let retries = 3;
    while (retries > 0) {
      try {
        await stub.addExpense(expense);
        break;
      } catch (err: any) {
        retries--;
        if (retries === 0 || !err.retryable) {
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return c.json({ success: true, expense });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get('/api/expenses/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const id = c.env.FINANCE_MEMORY.idFromName(userId);
    const stub = c.env.FINANCE_MEMORY.get(id);
    const expenses = await stub.getExpenses();

    return c.json({ success: true, expenses, count: expenses.length });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.delete('/api/expenses/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const id = c.env.FINANCE_MEMORY.idFromName(userId);
    const stub = c.env.FINANCE_MEMORY.get(id);
    await stub.clearExpenses();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Chat history endpoints
app.get('/api/chat/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const id = c.env.FINANCE_MEMORY.idFromName(userId);
    const stub = c.env.FINANCE_MEMORY.get(id);
    const messages = await stub.getChatMessages();

    return c.json({ success: true, messages, count: messages.length });
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
    const { userId, input } = await c.req.json();

    if (!userId || !input) {
      return c.json({ success: false, error: 'Missing userId or input' }, 400);
    }

    const intent = await classifyIntent(c.env.AI, input);


    if (intent === INTENTS.ADD_EXPENSE) {
      const aiResult = await processExpenseInput(c.env.AI, input);

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
        date: new Date().toISOString().split('T')[0],
        createdAt: Date.now(),
        type: aiResult.type
      };

      try {
        const id = c.env.FINANCE_MEMORY.idFromName(userId);
        const stub = c.env.FINANCE_MEMORY.get(id);

        // Retry logic for Durable Object connection issues in dev mode
        let retries = 3;
        while (retries > 0) {
          try {
            await stub.addExpense(expense);
            break;
          } catch (err: any) {
            retries--;
            if (retries === 0 || !err.retryable) {
              throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        return c.json({
          success: true,
          message: aiResult.message,
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
      const id = c.env.FINANCE_MEMORY.idFromName(userId);
      const stub = c.env.FINANCE_MEMORY.get(id);
      const expenses = await stub.getExpenses();

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
      const id = c.env.FINANCE_MEMORY.idFromName(userId);
      const stub = c.env.FINANCE_MEMORY.get(id);
      const expenses = await stub.getExpenses();

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
          const deleted = await stub.deleteExpense(expenseId);
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
      const deleted = await stub.deleteExpense(deleteResult.expenseId!);

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

export default app;
