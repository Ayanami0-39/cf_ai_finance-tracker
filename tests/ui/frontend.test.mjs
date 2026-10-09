import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
import ts from 'typescript';

const generated = await readFile(new URL('../../worker/generated/ui-assets.ts', import.meta.url), 'utf8');
const { uiHtml, uiAssets } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(generated, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })).toString('base64'));
const account = { username: 'tester', displayName: '保存', emoji: '🌱', scopeId: 'user_tester' };
const chatText = '保存 · 午饭花了30块 · Keep my original message';
const messages = [{ id: 'preserved', role: 'user', content: chatText, timestamp: 1 }];
const expenses = [{ id: 'entry', amount: 30, category: 'Food', merchant: '保存', description: 'Lunch', date: new Date().toISOString().slice(0, 10), createdAt: 1 }];

async function fixture(t, engine) {
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path.startsWith('/api/') || path === '/auth') {
      response.setHeader('Content-Type', 'application/json');
      const result = { success: true, ok: true, token: 'synthetic', account, family: null, members: [], expenses, messages, notifications: [], rules: [], accounts: [], budgets: [], recurring: [], subscriptions: [], records: [], items: [], logs: [], hasMore: false, role: null };
      if (path === '/api/bootstrap') result.chat = { messages, hasMore: false };
      response.end(JSON.stringify(result)); return;
    }
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end(uiHtml); return; }
    if (uiAssets[path]) { response.setHeader('Content-Type', uiAssets[path].contentType); response.end(uiAssets[path].body); return; }
    try {
      const body = await readFile(new URL('../../frontend/recovered' + path, import.meta.url));
      response.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'application/json'); response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await engine.launch(engine === chromium && existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] } : {});
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  async function page(width = 390, height = 844, options = {}) {
    const selectedAccount = options.account || account;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768, timezoneId: options.timezone || 'UTC', reducedMotion: options.reducedMotion || 'no-preference' });
    await page.addInitScript(({ account, options }) => {
      localStorage.setItem('account_info', JSON.stringify(account)); localStorage.setItem('auth_token', 'synthetic');
      if (options.cache && !localStorage.getItem('app_bootstrap_snapshot')) localStorage.setItem('app_bootstrap_snapshot', JSON.stringify(options.cache));
      if (!localStorage.getItem('ui-lang')) localStorage.setItem('ui-lang', options.language || 'zh');
      if (options.blockStorage) Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
      if (options.mockSync) {
        window.__testSockets = [];
        window.WebSocket = class extends EventTarget {
          static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
          constructor() { super(); this.readyState = 1; window.__testSockets.push(this); }
          send() {}
          close() { this.readyState = 3; }
        };
      }
    }, { account: selectedAccount, options });
    page.setDefaultTimeout(5000);
    await page.route('https://**', route => route.abort());
    if (options.expenses || options.messages || options.cache || options.account) {
      await page.route('**/api/bootstrap', async route => {
        if (options.failBootstrap) return route.abort();
        if (options.bootstrapDelay) await new Promise(resolve => setTimeout(resolve, options.bootstrapDelay));
        return route.fulfill({ json: { success: true, account: selectedAccount, family: options.family || null, expenses: options.expenses || expenses, chat: { messages: options.messages || messages, hasMore: false } } });
      });
      await page.route('**/api/expenses/**', route => route.fulfill({ json: { success: true, expenses: options.expenses || expenses } }));
    }
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('.fiscus-mobile-header, .fiscus-desktop').filter({ visible: true }).first().waitFor();
    await page.waitForFunction(() => document.body.textContent.includes('Keep my original message'));
    return page;
  }
  return { page };
}

for (const engine of [chromium, ...(process.env.TEST_WEBKIT ? [webkit] : [])]) {
  test(engine.name() + ': responsive layout, keyboard, localization and live feature parity', async t => {
    const { page: open } = await fixture(t, engine);
    const longSource = 'Full salary source with a long company name · 完整工资来源';
    const chartEntries = [
      { ...expenses[0], amount: 12345678.91, category: 'Food & Dining', merchant: 'Complete merchant name beyond ten characters', byId: 'tester' },
      { ...expenses[0], id: 'income', type: 'income', amount: 23456789.12, merchant: longSource, byId: 'tester' },
      { ...expenses[0], id: 'other-income', type: 'income', amount: 80, merchant: 'Other member salary', byId: 'another' },
    ];
    for (const width of [320, 375, 390, 430]) {
      await t.test(`${width}px: complete labels and amounts, with expense/income tabs`, async () => {
        const page = await open(width, 844, { language: 'en', expenses: chartEntries });
        await page.getByRole('button', { name: 'Activity', exact: true }).click();
        await page.locator('.fiscus-mobile .fiscus-filter-label').getByText('All categories', { exact: true }).waitFor();
        const labels = await page.locator('.fiscus-mobile .fiscus-filter-label').evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, scroll: element.scrollWidth })));
        assert.ok(labels.every(label => label.scroll <= label.width + 1));
        const amounts = page.locator('.fiscus-mobile .fiscus-summary-amount');
        assert.equal(await amounts.count(), 3);
        assert.ok((await amounts.allTextContents()).some(value => value.includes('12345678.91')));
        await page.waitForFunction(() => [...document.querySelectorAll('.fiscus-mobile .fiscus-summary-amount,.fiscus-mobile .fiscus-entry-amount')].every(element => element.scrollWidth <= element.clientWidth + 1)).catch(async () => {
          assert.fail(JSON.stringify(await page.locator('.fiscus-mobile .fiscus-summary-amount,.fiscus-mobile .fiscus-entry-amount').evaluateAll(elements => elements.map(element => ({ text: element.textContent, width: element.clientWidth, scroll: element.scrollWidth, font: getComputedStyle(element).fontSize })))));
        });
        const fit = await amounts.evaluateAll(elements => elements.map(element => ({ width: element.clientWidth, scroll: element.scrollWidth, font: parseFloat(getComputedStyle(element).fontSize), overflow: getComputedStyle(element).textOverflow })));
        for (const item of fit) { assert.ok(item.scroll <= item.width + 1, JSON.stringify(item)); assert.ok(item.font >= 10); assert.notEqual(item.overflow, 'ellipsis'); }
        const entryAmounts = await page.locator('.fiscus-mobile .fiscus-entry-amount').evaluateAll(elements => elements.map(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          return { text: element.textContent, lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size, width: element.clientWidth, scroll: element.scrollWidth };
        }));
        assert.ok(entryAmounts.some(item => item.text === '-¥12345678.91'));
        for (const item of entryAmounts) { assert.equal(item.lines, 1, item.text); assert.ok(item.scroll <= item.width + 1, item.text); }
        await page.waitForFunction(() => [...document.querySelectorAll('.fiscus-mobile .fiscus-entry-meta')].every(element => element.scrollWidth <= element.clientWidth + 1));
        const rows = await page.locator('.fiscus-mobile .fiscus-entry-row').evaluateAll(elements => elements.map(row => {
          const amount = row.querySelector('.fiscus-entry-amount'), date = row.querySelector('time'), meta = row.querySelector('.fiscus-entry-meta');
          const range = document.createRange(); range.selectNodeContents(meta.querySelector("span"));
          const dateRect = date.getBoundingClientRect();
          const style = getComputedStyle(row);
          const naturalHeight = Math.max(...[...row.children].map(child => child.getBoundingClientRect().height)) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
          const controls = [...row.querySelectorAll('.fiscus-entry-tools button')].map(button => ({ top: button.getBoundingClientRect().top }));
          const amountRect = amount.getBoundingClientRect(), title = row.querySelector('.fiscus-entry-details > div:nth-child(2) > p:first-child').getBoundingClientRect(), tools = row.querySelector('.fiscus-entry-tools').getBoundingClientRect();
          return { naturalHeight, centerX: row.getBoundingClientRect().x + row.getBoundingClientRect().width / 2, centerY: row.getBoundingClientRect().y + row.getBoundingClientRect().height / 2, amountX: amountRect.x + amountRect.width / 2, amountY: amountRect.y + amountRect.height / 2, dateLeft: dateRect.left, dateY: dateRect.y + dateRect.height / 2, height: row.getBoundingClientRect().height, dateTop: dateRect.top, metaTop: meta.getBoundingClientRect().top, controls, amountLeft: amountRect.left, amountRight: amountRect.right, titleRight: title.right, toolsLeft: tools.left, date: date.dateTime, meta: meta.textContent, lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size };
        }));
        assert.equal(rows.length, 3);
        for (const row of rows) {
          assert.ok(Math.abs(row.height - row.naturalHeight * 1.25) < 2, 'extra vertical spacing is halved');
          assert.ok(row.amountLeft > row.titleRight); assert.ok(row.amountRight < row.toolsLeft, 'amount has its own column between details and controls');
          assert.equal(row.date, expenses[0].date); assert.ok(row.lines >= 1, row.meta); assert.ok(!row.meta.includes(' • '));
          assert.equal(row.controls.length, 2);
          assert.ok(row.dateLeft - row.amountRight <= 8, 'amount sits immediately to the left of the date region');
          assert.ok(Math.abs(row.amountY - row.centerY) < 2, 'amount vertically centered in record');
          assert.ok(Math.abs(row.dateY - row.centerY) < 2, 'date vertically centered in record');
          assert.ok(row.dateLeft > row.amountRight, 'date is on the right of the amount');
        }
        const sizes = await page.locator('.fiscus-mobile .fiscus-entry-row').last().evaluate(row => ({
          icon: row.querySelector('.fiscus-entry-details > div:first-child > div').getBoundingClientRect().width,
          title: parseFloat(getComputedStyle(row.querySelector('.fiscus-entry-details > div:nth-child(2) > p:first-child')).fontSize),
          date: parseFloat(getComputedStyle(row.querySelector('time')).fontSize),
          amount: parseFloat(getComputedStyle(row.querySelector('.fiscus-entry-amount')).fontSize),
        }));
        assert.equal(sizes.icon, 33); assert.equal(sizes.title, 12.9375); assert.equal(sizes.date, 11.25);
        assert.ok(sizes.amount >= 12.375 && sizes.amount <= 14.625, 'ordinary amounts use the reduced font');
        if (process.env.UI_SCREENSHOT_DIR && width === 390) {
          await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/${engine.name()}-full-amounts.png` });
        }
        await page.getByRole('button', { name: 'Insights', exact: true }).click();
        const card = page.locator('.fiscus-mobile .fiscus-breakdown');
        const expenseTab = card.getByRole('tab', { name: 'Expenses by category', exact: true });
        const incomeTab = card.getByRole('tab', { name: 'Income', exact: true });
        await expenseTab.waitFor(); assert.equal(await expenseTab.getAttribute('aria-selected'), 'true');
        await card.getByRole('tabpanel', { name: 'Expenses by category' }).waitFor();
        const categoryRow = card.locator('.fiscus-category-row').first();
        const categoryLayout = await categoryRow.evaluate(row => {
          const label = row.querySelector('span.flex-1');
          const amount = [...row.querySelectorAll('span.tabular-nums')].find(span => span.textContent.startsWith('¥'));
          const labelRect = label.getBoundingClientRect(), amountRect = amount.getBoundingClientRect();
          return { label: labelRect.toJSON(), amount: amountRect.toJSON(), width: row.clientWidth, scroll: row.scrollWidth };
        });
        assert.ok(Math.abs(categoryLayout.label.y - categoryLayout.amount.y) < 2, 'category and amount stay on the same row');
        assert.ok(categoryLayout.scroll <= categoryLayout.width + 1);
        const ring = await card.locator('svg path[fill]').first().evaluate(path => ({ width: path.getBBox().width, height: path.getBBox().height }));
        assert.ok(ring.width > 100 && ring.height > 100, 'a single category must draw a complete ring');
        await card.getByText('Total expenses', { exact: true }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Income sources' }).count(), 0);
        await incomeTab.click();
        await card.getByRole('tabpanel', { name: 'Income', exact: true }).waitFor();
        await card.getByRole('heading', { name: 'Income sources' }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Income sources' }).count(), 1);
        assert.ok((await card.innerText()).includes(longSource));
        if (process.env.UI_SCREENSHOT_DIR && width === 390) {
          await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
          await card.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/${engine.name()}-income-card.png` });
        }
        await page.getByLabel('Filter insights by member').filter({ visible: true }).selectOption('tester');
        assert.ok(!(await card.innerText()).includes('Other member salary'));
        // Keyboard navigation and language changes preserve the active tab/filter.
        await incomeTab.focus(); await incomeTab.press('ArrowLeft');
        assert.equal(await expenseTab.getAttribute('aria-selected'), 'true');
        if (process.env.UI_SCREENSHOT_DIR && width === 390) await card.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/${engine.name()}-expense-card.png` });
        await expenseTab.press('End'); assert.equal(await incomeTab.getAttribute('aria-selected'), 'true');
        await page.getByTitle('Switch to Chinese').filter({ visible: true }).click();
        assert.equal(await card.getByRole('tab', { name: '收入', exact: true }).getAttribute('aria-selected'), 'true');
        assert.ok((await card.innerText()).includes(longSource));
        const clipped = await page.evaluate(() => [...document.querySelectorAll('.fiscus-mobile .truncate')].filter(element => element.getBoundingClientRect().width > 0).filter(element => getComputedStyle(element).textOverflow === 'ellipsis' || element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
        assert.deepEqual(clipped, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await page.close();
      });
    }
    await t.test('the Income tab works for income-only periods and explains empty income periods', async () => {
      const incomeOnly = await open(390, 844, { language: 'en', expenses: chartEntries.filter(entry => entry.type === 'income') });
      await incomeOnly.getByRole('button', { name: 'Insights', exact: true }).click();
      const card = incomeOnly.locator('.fiscus-mobile .fiscus-breakdown');
      await card.getByText('No expenses in this period', { exact: true }).waitFor();
      await card.getByRole('tab', { name: 'Income', exact: true }).click();
      assert.ok((await card.innerText()).includes(longSource));
      await incomeOnly.close();
      const expenseOnly = await open(390, 844, { language: 'en' });
      await expenseOnly.getByRole('button', { name: 'Insights', exact: true }).click();
      await expenseOnly.locator('.fiscus-mobile .fiscus-breakdown').getByRole('tab', { name: 'Income', exact: true }).click();
      await expenseOnly.getByText('No income in this period', { exact: true }).waitFor();
      await expenseOnly.close();
    });
    for (const width of [320, 390]) for (const language of ['en', 'zh']) {
      await t.test(`${width}px ${language}: long content and large amounts remain fully visible`, async () => {
        const merchant = 'InternationalOnlineStoreWithAnUnbrokenLongName完整商家名称';
        const category = 'VeryLongCustomCategoryWithoutSpaces完整自定义分类';
        const text = chatText + ' ' + 'LongUnbrokenMessage'.repeat(12);
        const page = await open(width, 844, { language,
          expenses: [{ ...expenses[0], merchant, category, amount: 987654321012.34, by: '很长的家庭成员姓名 LongFamilyMemberName' }],
          messages: [{ ...messages[0], content: text }],
        });
        const overflow = locator => locator.evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width > 0).flatMap(element => {
          const rect = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element);
          const bad = [...range.getClientRects()].some(part => part.left < rect.left - 1 || part.right > rect.right + 1);
          return bad || element.scrollWidth > element.clientWidth + 1 || getComputedStyle(element).textOverflow === 'ellipsis' ? [element.textContent] : [];
        }));
        assert.deepEqual(await overflow(page.locator('.fiscus-mobile .fiscus-message-bubble p')), []);
        await page.getByRole('button', { name: language === 'en' ? 'Activity' : '记录', exact: true }).click();
        await page.locator('.fiscus-mobile .fiscus-entry-row').first().waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.fiscus-mobile .fiscus-entry-amount')].every(element => element.scrollWidth <= element.clientWidth + 1));
        assert.ok((await page.locator('.fiscus-mobile .fiscus-entry-row').innerText()).includes(merchant));
        assert.ok((await page.locator('.fiscus-mobile .fiscus-entry-row').innerText()).includes(category));
        assert.deepEqual(await overflow(page.locator('.fiscus-mobile .fiscus-summary-amount,.fiscus-mobile .fiscus-entry-amount,.fiscus-mobile .fiscus-entry-details p,.fiscus-mobile .fiscus-entry-date')), []);
        const name = language === 'en' ? 'Insights' : '统计';
        await page.getByRole('button', { name, exact: true }).click();
        await page.locator('.fiscus-mobile .fiscus-breakdown').waitFor();
        assert.deepEqual(await overflow(page.locator('.fiscus-mobile .fiscus-category-row > span,.fiscus-mobile .fiscus-breakdown-tabs button')), []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/${engine.name()}-${width}-${language}-long-content.png` });
        await page.close();
      });
    }
    await t.test('Insights keeps its compact header and month labels aligned across a year boundary', async () => {
      const year = new Date().getUTCFullYear();
      const history = Array.from({ length: 12 }, (_, index) => ({ ...expenses[0], id: 'trend-' + index, date: `${year}-${String(index + 1).padStart(2, '0')}-01` }));
      for (const width of [320, 390]) {
        const page = await open(width, 844, { language: 'en', expenses: history });
        await page.getByRole('button', { name: 'Insights', exact: true }).click();
        const header = page.locator('.fiscus-mobile .fiscus-stats-header');
        await header.getByRole('heading', { name: 'Financial overview', exact: true }).waitFor();
        assert.equal(await header.locator('p').count(), 0);
        const positions = await header.evaluate(element => {
          const title = element.querySelector('h2').getBoundingClientRect(), member = element.querySelector('label').getBoundingClientRect();
          return { titleY: title.y + title.height / 2, memberY: member.y + member.height / 2, titleRight: title.right, memberLeft: member.left };
        });
        assert.ok(Math.abs(positions.titleY - positions.memberY) < 2);
        assert.ok(positions.titleRight < positions.memberLeft);
        for (let count = new Date().getUTCMonth(); count > 0; count--) await page.getByRole('button', { name: 'Previous period', exact: true }).filter({ visible: true }).click();
        const chart = page.locator('.fiscus-mobile .fiscus-trend-chart');
        const axis = chart.locator('.fiscus-trend-axis');
        await axis.scrollIntoViewIfNeeded();
        assert.deepEqual(await axis.locator('button > span:first-child').allTextContents(), ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan']);
        assert.equal((await axis.innerText()).match(new RegExp(String(year - 1), 'g')).length, 1);
        assert.equal((await axis.innerText()).match(new RegExp(String(year), 'g')).length, 1);
        const geometry = await axis.locator('button').evaluateAll(buttons => buttons.map(button => {
          const rect = button.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(button.querySelector('span'));
          const text = range.getBoundingClientRect();
          return { center: rect.x + rect.width / 2, left: rect.left, right: rect.right, textLeft: text.left, textRight: text.right };
        }));
        for (const label of geometry) assert.ok(label.textLeft >= label.left - 1 && label.textRight <= label.right + 1);
        const bars = await chart.locator('.fiscus-trend-bars > button').evaluateAll(buttons => buttons.map(button => { const rect = button.getBoundingClientRect(); return rect.x + rect.width / 2; }));
        for (let index = 0; index < bars.length; index++) assert.ok(Math.abs(bars[index] - geometry[index].center) < 1);
        const selected = axis.locator('button').first();
        await selected.click(); assert.equal(await selected.getAttribute('aria-pressed'), 'true');
        await selected.click(); assert.equal(await selected.getAttribute('aria-pressed'), 'false');
        await page.getByTitle('Switch to Chinese').filter({ visible: true }).click();
        await header.getByRole('heading', { name: '财务概览', exact: true }).waitFor();
        assert.deepEqual(await axis.locator('button > span:first-child').allTextContents(), ['8月', '9月', '10月', '11月', '12月', '1月']);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        if (process.env.UI_SCREENSHOT_DIR) await chart.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/${engine.name()}-${width}-trend-axis.png` });
        await page.close();
      }
    });
    async function seedQueue(page, entries) {
      await page.evaluate(async entries => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('fiscus_offline', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('queue', { keyPath: 'id' });
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('queue', 'readwrite');
          for (const entry of entries) tx.objectStore('queue').put(entry);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
        db.close();
      }, entries);
    }
    async function queue(page) {
      return page.evaluate(async () => {
        const db = await new Promise(resolve => { const r = indexedDB.open('fiscus_offline', 1); r.onsuccess = () => resolve(r.result); });
        const entries = await new Promise(resolve => { const r = db.transaction('queue').objectStore('queue').getAll(); r.onsuccess = () => resolve(r.result); });
        db.close(); return entries;
      });
    }
    const pending = (id, scopeId = 'user_tester') => ({ id, clientMutationId: 'mutation-' + id, input: 'Lunch 30', username: 'tester', scopeId, queuedAt: 1 });
    await t.test('failed sync retries on focus without another online event, retaining its mutation key', async () => {
      const page = await open(); const requests = [];
      await seedQueue(page, [pending('retry')]);
      await page.route('**/api/voice-command', async route => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) await route.abort();
        else await route.fulfill({ json: { success: true, message: 'Saved' } });
      });
      await page.reload(); await page.waitForFunction(() => window.__fiscusSyncFlight === null);
      assert.equal(requests.length, 1); assert.equal((await queue(page)).length, 1);
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
      await page.waitForFunction(() => document.body.textContent.includes('离线记账已同步'));
      assert.equal(requests.length, 2); assert.equal((await queue(page)).length, 0);
      assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
      await page.close();
    });
    await t.test('other ledgers stay queued and are never sent to the current ledger', async () => {
      const page = await open(); let sent = 0;
      await seedQueue(page, [pending('other', 'family_previous')]);
      await page.route('**/api/voice-command', route => { sent++; return route.fulfill({ json: { success: true } }); });
      await page.reload();
      await page.waitForFunction(() => document.body.textContent.includes('待同步记录属于其他账户或账本'));
      assert.equal(sent, 0); assert.equal((await queue(page))[0].scopeId, 'family_previous');
      await page.close();
    });
    await t.test('a lost submission response is queued with the original request ID', async () => {
      const page = await open(); const requests = [];
      await page.route('**/api/voice-command', async route => {
        requests.push(route.request().postDataJSON());
        if (requests.length === 1) await route.abort();
        else await route.fulfill({ json: { success: true, message: 'Saved' } });
      });
      const input = page.locator('.fiscus-mobile .fiscus-composer input');
      await input.fill('Lunch 42'); await input.press('Enter');
      await page.waitForFunction(() => document.body.textContent.includes('网络异常，已加入待同步队列'));
      const entries = await queue(page); assert.equal(entries.length, 1);
      assert.equal(entries[0].clientMutationId, requests[0].idempotencyKey);
      assert.ok(requests[0].idempotencyKey.length >= 8);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(() => document.body.textContent.includes('离线记账已同步'));
      assert.equal(requests.length, 2); assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
      assert.equal((await queue(page)).length, 0); await page.close();
    });
    await t.test('offline submissions preserve more than 50 entries', async () => {
      const page = await open();
      await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
      await seedQueue(page, Array.from({ length: 50 }, (_, index) => pending('old-' + index)));
      const input = page.locator('.fiscus-mobile .fiscus-composer input');
      await input.fill('Lunch 99'); await input.press('Enter');
      await page.waitForFunction(() => document.body.textContent.includes('当前离线，已加入待同步队列'));
      const entries = await queue(page); assert.equal(entries.length, 51); assert.ok(entries.some(entry => entry.id === 'old-0'));
      await page.close();
    });
    for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [667, 375], [820, 1180], [1440, 900]]) {
      await t.test(`${width} × ${height}: content stays inside the viewport`, async () => {
        const page = await open(width, height);
        const bounds = await page.evaluate(() => {
          const app = document.querySelector('.fiscus-app').getBoundingClientRect();
          const input = [...document.querySelectorAll('.fiscus-composer input')].find(e => e.getBoundingClientRect().width > 0);
          const rect = input.getBoundingClientRect();
          return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, app: app.toJSON(), input: rect.toJSON(), font: parseFloat(getComputedStyle(input).fontSize) };
        });
        assert.equal(bounds.scrollWidth, width);
        assert.ok(bounds.app.bottom <= bounds.height + 1);
        assert.ok(bounds.input.right <= bounds.width && bounds.input.bottom <= bounds.height);
        if (width < 768) assert.ok(bounds.font >= 16, 'iOS input zoom must not be triggered');
        await page.close();
      });
    }
    await t.test('safe areas and keyboard keep the composer reachable', async () => {
      const page = await open();
      await page.evaluate(() => { document.documentElement.style.setProperty('--fiscus-safe-top', '47px'); document.documentElement.style.setProperty('--fiscus-safe-bottom', '34px'); });
      const header = await page.locator('.fiscus-mobile-header').boundingBox();
      assert.equal(Math.round(header.height), 103);
      const nav = await page.locator('nav').boundingBox();
      assert.ok(nav.y + nav.height <= 845);
      const input = page.locator('.fiscus-mobile .fiscus-composer input');
      await input.fill('Unsaved draft');
      await page.setViewportSize({ width: 390, height: 490 });
      await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen === 'true');
      assert.equal(await page.locator('nav').isVisible(), false);
      const rect = await input.boundingBox(); assert.ok(rect.y + rect.height <= 491);
      assert.equal(await input.inputValue(), 'Unsaved draft');
      await page.close();
    });
    await t.test('language changes persist while preserving drafts, user names, messages and merchants', async () => {
      const page = await open();
      const input = page.locator('.fiscus-mobile .fiscus-composer input'); await input.fill('My unsaved draft');
      await page.getByTitle('切换到 English').filter({ visible: true }).click();
      await page.getByRole('button', { name: 'Insights', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.equal(await input.inputValue(), 'My unsaved draft');
      assert.ok((await page.locator('body').innerText()).includes(chatText));
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await page.getByPlaceholder('Search or YYYY-MM').filter({ visible: true }).waitFor();
      assert.ok((await page.locator('body').innerText()).includes('保存'), 'merchant must remain unchanged');
      await page.getByTitle('Switch to Chinese').filter({ visible: true }).click();
      await page.getByRole('button', { name: '统计', exact: true }).waitFor();
      await page.getByTitle('切换到 English').filter({ visible: true }).click();
      await page.reload();
      await page.getByRole('button', { name: 'Insights', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      await page.getByRole('button', { name: 'Insights', exact: true }).click();
      await page.locator('.fiscus-mobile .fiscus-insight-tools > summary').click();
      await page.getByText('Budgets', { exact: true }).first().waitFor();
      await page.getByText('Subscriptions', { exact: true }).first().waitFor();
      await page.getByText('Accounts & balances', { exact: true }).first().waitFor();
      await page.getByText('Category rules', { exact: true }).first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
      await page.close();
    });
    await t.test('language controls remain usable when localStorage writes fail', async () => {
      const page = await open(390, 844, { blockStorage: true });
      await page.getByTitle('切换到 English').filter({ visible: true }).click();
      await page.getByRole('button', { name: 'Insights', exact: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      await page.close();
    });
    await t.test('account menus fit long identities, support keyboard navigation and preserve drafts', async () => {
      const identity = { ...account, displayName: '收入 · LongDisplayNameWithoutSpaces完整昵称完整昵称', username: 'long_account_username_without_spaces_1234567890' };
      for (const [width, height, language] of [[320, 568, 'en'], [390, 844, 'zh'], [667, 375, 'en'], [1440, 900, 'en']]) {
        const page = await open(width, height, { language, account: identity });
        const beforeStorage = await page.evaluate(() => ({ account: localStorage.getItem('account_info'), token: localStorage.getItem('account_token') }));
        const composer = page.locator('.fiscus-composer input').filter({ visible: true });
        await composer.fill('Unsent draft · 未发送');
        const trigger = page.getByRole('button', { name: language === 'en' ? 'Account menu' : '账号菜单', exact: true }).filter({ visible: true });
        await trigger.click();
        const panel = page.locator('.fiscus-account-panel').filter({ visible: true });
        await panel.waitFor();
        assert.equal(await panel.locator('.fiscus-account-name').innerText(), identity.displayName);
        assert.equal(await panel.locator('.fiscus-account-username').innerText(), '@' + identity.username);
        assert.equal(await panel.locator('.fiscus-account-action').count(), 4);
        const bounds = await panel.boundingBox();
        assert.ok(bounds.x >= 11 && bounds.x + bounds.width <= width - 11);
        assert.ok(bounds.y >= 11 && bounds.y + bounds.height <= height - 11);
        assert.ok(await panel.locator('.fiscus-account-name,.fiscus-account-username').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1 && getComputedStyle(element).textOverflow !== 'ellipsis')));
        const actions = panel.locator('.fiscus-account-action');
        await actions.first().press('ArrowDown'); assert.equal(await actions.nth(1).evaluate(element => element === document.activeElement), true);
        await actions.nth(1).press('End'); assert.equal(await actions.last().evaluate(element => element === document.activeElement), true);
        await actions.last().press('Escape'); await panel.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
        assert.equal(await composer.inputValue(), 'Unsent draft · 未发送');
        assert.deepEqual(await page.evaluate(() => ({ account: localStorage.getItem('account_info'), token: localStorage.getItem('account_token') })), beforeStorage);
        await trigger.click();
        await page.locator('.fiscus-account-backdrop').filter({ visible: true }).click({ position: { x: 2, y: 2 } });
        await panel.waitFor({ state: 'hidden' });
        await trigger.click();
        if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.UI_SCREENSHOT_DIR}/${engine.name()}-${width}-${language}-account-menu.png` });
        await actions.first().press('Escape');
        await page.close();
      }
    });
    await t.test('profile and family dialogs are reachable and fit the small screen', async () => {
      const page = await open(320, 568, { language: 'en' });
      await page.getByRole('button', { name: 'Account menu', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button', { name: 'Edit profile', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit profile' }).waitFor();
      const input = page.locator('input[value="保存"]');
      assert.ok(await input.count());
      await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Account menu', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button', { name: 'Create or join a family', exact: true }).click();
      await page.getByRole('dialog', { name: 'Family settings' }).waitFor();
      await page.getByRole('heading', { name: 'Family ledger' }).waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await page.getByRole('button', { name: 'Edit entry', exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('dialog', { name: 'Edit transaction' }).waitFor();
      const dialog = await page.getByRole('dialog', { name: 'Edit transaction' }).boundingBox();
      assert.ok(dialog.y >= 0 && dialog.y + dialog.height <= 569);
      await page.getByRole('button', { name: 'Cancel', exact: true }).filter({ visible: true }).first().click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
      await page.close();
    });
    await t.test('delete confirmation fits narrow records, cancels safely and restores rejected deletions', async () => {
      const page = await open(320, 568, { language: 'en', expenses: [chartEntries[0]] });
      let deletes = 0;
      await page.route('**/api/expenses/**', async route => {
        if (route.request().method() === 'DELETE') {
          deletes++;
          await route.fulfill({ json: { success: false, error: 'Synthetic deletion rejection' } });
        } else await route.fulfill({ json: { success: true, expenses } });
      });
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      const row = page.locator('.fiscus-mobile .fiscus-entry-row').first();
      const before = await row.boundingBox();
      await row.locator('.fiscus-record-menu > summary').click();
      await row.getByRole('button', { name: 'Delete entry', exact: true }).click();
      const confirmation = row.locator('.fiscus-entry-confirmation');
      await confirmation.getByText('Delete this entry?', { exact: true }).waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Cancel deletion');
      const bounds = await confirmation.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 321);
      assert.ok(Math.abs((await row.boundingBox()).height - before.height) < 2, 'confirmation does not reflow the record');
      await page.keyboard.press('Escape');
      await confirmation.waitFor({ state: 'detached' });
      assert.equal(deletes, 0, 'opening and canceling never submit a deletion');
      await row.locator('.fiscus-record-menu > summary').click();
      await row.getByRole('button', { name: 'Delete entry', exact: true }).click();
      await row.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
      await page.getByText("Couldn't delete. Restoring your list.", { exact: true }).waitFor();
      await row.getByRole('button', { name: 'Edit entry', exact: true }).waitFor();
      assert.equal(deletes, 1);
      await page.close();
    });
    await t.test('calendar dates keep their recorded day in western time zones and reduced motion is respected', async () => {
      const page = await open(390, 844, { language: 'en', timezone: 'America/Los_Angeles', reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      const [year, month, day] = expenses[0].date.split('-').map(Number);
      assert.equal(await page.locator('.fiscus-mobile .fiscus-entry-date').first().innerText(), `${month}/${day}`);
      assert.equal(await page.evaluate(() => window.FiscusUI.formatRecordDate('2026-01-01')), '1/1');
      assert.equal(await page.evaluate(() => window.FiscusUI.formatRecordDate('not-a-date')), 'not-a-date');
      const duration = await page.locator('.fiscus-mobile .fiscus-entry-row').first().evaluate(row => getComputedStyle(row).transitionDuration);
      assert.ok(parseFloat(duration) < .001);
      assert.ok(year > 2000);
      await page.close();
    });
    await t.test('incoming chat preserves the reading position and offers a jump to latest', async () => {
      const history = [...messages, ...Array.from({ length: 30 }, (_, index) => ({ id: `history-${index}`, role: 'assistant', content: `History ${index}: ` + 'A helpful financial answer. '.repeat(8), timestamp: index + 2 }))];
      const page = await open(390, 844, { language: 'en', messages: history, mockSync: true, reducedMotion: 'reduce' });
      const scroll = page.locator('.fiscus-mobile .fiscus-chat-messages');
      await page.waitForFunction(() => {
        const element = document.querySelector('.fiscus-mobile .fiscus-chat-messages');
        return element.scrollHeight - element.scrollTop - element.clientHeight < 10;
      });
      await scroll.evaluate(element => { element.scrollTop = 250; element.dispatchEvent(new Event('scroll')); });
      await page.getByRole('button', { name: 'Jump to latest', exact: true }).filter({ visible: true }).waitFor();
      const before = await scroll.evaluate(element => element.scrollTop);
      const updated = [...history, { id: 'new-incoming', role: 'assistant', content: 'A new answer arrived while reading history.', timestamp: 99 }];
      await page.route('**/api/bootstrap', route => route.fulfill({ json: { success: true, account, family: null, expenses, chat: { messages: updated, hasMore: false } } }));
      await page.evaluate(() => window.__testSockets.at(-1).onmessage({ data: JSON.stringify({ kind: 'fiscus-change', ts: Date.now(), by: 'another-user' }) }));
      await page.getByText('A new answer arrived while reading history.', { exact: true }).filter({ visible: true }).waitFor();
      assert.ok(Math.abs((await scroll.evaluate(element => element.scrollTop)) - before) < 3, 'incoming message does not pull the reader to the bottom');
      await page.getByRole('button', { name: 'Jump to latest', exact: true }).filter({ visible: true }).click();
      await page.waitForFunction(() => {
        const element = document.querySelector('.fiscus-mobile .fiscus-chat-messages');
        return element.scrollHeight - element.scrollTop - element.clientHeight < 10;
      });
      await page.close();
    });
    await t.test('messages can be sent while AI replies are pending without losing drafts or request IDs', async () => {
      const page = await open(390, 844, { language: 'en' });
      const requests = [], releases = [];
      await page.route('**/api/voice-command', async route => {
        const index = requests.length;
        requests.push(route.request().postDataJSON());
        await new Promise(resolve => { releases[index] = resolve; });
        await route.fulfill({ json: { success: true, message: `Synthetic reply ${index}` } });
      });
      const input = page.locator('.fiscus-mobile .fiscus-composer input');
      await input.fill('Lunch 30'); await input.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.fiscus-mobile .animate-bounce').length === 3);
      assert.equal(await input.isEnabled(), true);
      await input.fill('Coffee 20'); await input.press('Enter');
      await page.getByText('Coffee 20', { exact: true }).filter({ visible: true }).waitFor();
      while (requests.length < 2) await page.waitForTimeout(20);
      await input.fill('My next unsent draft');
      releases[1]();
      await page.getByText('Synthetic reply 1', { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(await page.locator('.fiscus-mobile .animate-bounce').count(), 3, 'another reply is still pending');
      releases[0]();
      await page.getByText('Synthetic reply 0', { exact: true }).filter({ visible: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('.fiscus-mobile .animate-bounce').length === 0);
      assert.equal(await input.inputValue(), 'My next unsent draft');
      assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey);
      assert.equal(requests.length, 2);
      await page.close();
    });
    await t.test('secondary activity actions stay accessible in More and record menus', async () => {
      const page = await open(320, 568, { language: 'en' });
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      const more = page.locator('.fiscus-mobile .fiscus-action-menu').filter({ has: page.locator('summary[aria-label="More"]') });
      assert.equal(await more.getAttribute('open'), null);
      assert.equal(await page.getByRole('button', { name: 'Export CSV', exact: true }).isVisible(), false);
      await more.locator('summary').click();
      for (const label of ['Export CSV', 'Full backup', 'Bulk edit', 'Recycle bin', 'Restore backup', 'Import CSV']) {
        await more.getByRole('button', { name: label, exact: true }).waitFor();
      }
      const bounds = await more.locator('.fiscus-menu-panel').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 321 && bounds.y + bounds.height <= 569);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.fiscus-mobile summary[aria-label="More"]').parentElement.open);
      const row = page.locator('.fiscus-mobile .fiscus-entry-row').first();
      await row.locator('.fiscus-record-menu > summary').click();
      await row.getByRole('button', { name: 'Delete entry', exact: true }).waitFor();
      await page.locator('.fiscus-mobile-header').click({ position: { x: 4, y: 4 } });
      assert.equal(await row.locator('.fiscus-record-menu').getAttribute('open'), null);
      await row.getByRole('button', { name: 'Edit entry', exact: true }).click();
      await page.getByRole('dialog', { name: 'Edit transaction' }).waitFor();
      await page.close();
    });
    await t.test('older months remain discoverable by date search beyond the first hundred records', async () => {
      const entries = Array.from({ length: 130 }, (_, index) => ({ ...expenses[0], id: `older-${index}`, createdAt: index + 1, date: index === 0 ? '2026-08-01' : expenses[0].date, merchant: index === 0 ? 'Preserved August transaction' : `Recent transaction ${index}` }));
      const page = await open(390, 844, { language: 'en', expenses: entries });
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      assert.equal(await page.locator('.fiscus-mobile .fiscus-entry-row').count(), 10);
      const search = page.getByPlaceholder('Search or YYYY-MM').filter({ visible: true });
      await search.fill('2026-08');
      await page.getByText('Preserved August transaction', { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(await page.locator('.fiscus-mobile .fiscus-entry-row').count(), 1);
      await page.getByRole('button', { name: 'Clear search', exact: true }).filter({ visible: true }).click();
      assert.equal(await page.locator('.fiscus-mobile .fiscus-entry-row').count(), 10);
      await page.close();
    });
    await t.test('complete cached ledgers render before refresh and survive failed reloads, including family ledgers', async () => {
      const cached = Array.from({ length: 130 }, (_, index) => ({ ...expenses[0], id: `cached-${index}`, merchant: `Cached entry ${index}`, date: index === 0 ? '2026-08-01' : expenses[0].date }));
      const family = { scopeId: 'family_cached', code: 'SYNTHETIC', isOwner: true };
      const snapshot = { version: 3, completeLedger: true, savedAt: Date.now() - 15 * 86400000, account, family, expenses: cached, chat: { messages, hasMore: false } };
      const page = await open(390, 844, { language: 'en', cache: snapshot, failBootstrap: true });
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await page.getByPlaceholder('Search or YYYY-MM').filter({ visible: true }).fill('2026-08');
      await page.getByText('Cached entry 0', { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('app_bootstrap_snapshot')).expenses.length), 130);
      await page.reload();
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await page.getByPlaceholder('Search or YYYY-MM').filter({ visible: true }).fill('2026-08');
      await page.getByText('Cached entry 0', { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('app_bootstrap_snapshot')).expenses.length), 130);
      await page.close();
      const updated = [...cached, { ...expenses[0], id: 'fresh', merchant: 'Fresh server entry' }];
      const refreshed = await open(390, 844, { language: 'en', cache: snapshot, expenses: updated, family, bootstrapDelay: 1200 });
      assert.equal(await refreshed.evaluate(() => JSON.parse(localStorage.getItem('app_bootstrap_snapshot')).expenses.length), 130, 'cache is usable while the server request is still pending');
      await refreshed.waitForFunction(() => JSON.parse(localStorage.getItem('app_bootstrap_snapshot')).expenses.length === 131);
      assert.equal(await refreshed.evaluate(() => JSON.parse(localStorage.getItem('app_bootstrap_snapshot')).completeLedger), true);
      await refreshed.close();
    });
    await t.test('Insights prioritizes breakdown and preserves collapsed management features', async () => {
      const page = await open(390, 844, { language: 'en' });
      await page.getByRole('button', { name: 'Insights', exact: true }).click();
      const tools = page.locator('.fiscus-mobile .fiscus-insight-tools');
      assert.equal(await tools.getAttribute('open'), null);
      assert.equal(await page.getByRole('button', { name: 'Budgets', exact: true }).isVisible(), false);
      const positions = await page.locator('.fiscus-mobile .fiscus-insight-sections').evaluate(element => [...element.children].map(child => ({ y: child.getBoundingClientRect().y, breakdown: child.classList.contains('fiscus-breakdown') })));
      assert.ok(positions.find(item => item.breakdown).y < positions[1].y, 'breakdown appears before secondary comparisons');
      await tools.locator('summary').click();
      await tools.getByRole('button', { name: 'Budgets', exact: true }).click();
      await tools.getByText('Monthly budget', { exact: true }).waitFor();
      await page.getByTitle('Switch to Chinese').filter({ visible: true }).click();
      assert.notEqual(await tools.getAttribute('open'), null, 'language switching keeps tools open');
      await tools.locator('summary').getByText('管理工具', { exact: true }).waitFor();
      await page.close();
    });
    await t.test('pending sync explains device storage and supports an explicit retry without changing its mutation ID', async () => {
      const page = await open(390, 844, { language: 'en' });
      const requests = [];
      await seedQueue(page, [pending('manual-retry')]);
      await page.route('**/api/voice-command', route => {
        requests.push(route.request().postDataJSON());
        return requests.length === 1 ? route.abort() : route.fulfill({ json: { success: true, message: 'Saved' } });
      });
      await page.reload();
      await page.waitForFunction(() => window.__fiscusSyncFlight === null);
      const status = page.locator('.fiscus-mobile-header summary').filter({ hasText: '1 pending' });
      await status.click();
      await page.getByText('Entries are saved on this device. Keep website data until they sync. For entries from another ledger, switch back to that ledger.', { exact: true }).filter({ visible: true }).waitFor();
      await page.getByRole('button', { name: 'Retry sync', exact: true }).filter({ visible: true }).click();
      await page.waitForFunction(() => document.body.textContent.includes('离线记账已同步'));
      assert.equal(requests.length, 2);
      assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
      assert.equal((await queue(page)).length, 0);
      await page.close();
    });
    if (process.env.UI_SCREENSHOT_DIR) {
      const directory = process.env.UI_SCREENSHOT_DIR; await mkdir(directory, { recursive: true });
      for (const [width, height, language] of [[390, 844, 'zh'], [390, 844, 'en'], [1440, 900, 'en']]) {
        const page = await open(width, height, { language }); await page.waitForTimeout(200);
        await page.screenshot({ path: `${directory}/${engine.name()}-${width}-${language}.png` }); await page.close();
      }
    }
  });
}
