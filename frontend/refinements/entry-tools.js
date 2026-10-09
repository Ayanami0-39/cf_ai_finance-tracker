/* Durable, account-scoped entry tools. Existing queue and D1 records keep their IDs. */
const FiscusLedger = (() => {
  let snapshot = { entries: [], receipts: [], loaded: false, error: false };
  let loading = null, dirty = false;
  const listeners = new Set();
  const publish = value => { snapshot = { ...snapshot, ...value }; for (const listener of listeners) listener(snapshot); };
  async function readQueue() {
    const db = await gd();
    return new Promise((resolve, reject) => {
      const request = db.transaction(An, 'readonly').objectStore(An).getAll();
      request.onsuccess = () => resolve((request.result || []).sort((a, b) => a.queuedAt - b.queuedAt));
      request.onerror = () => reject(request.error);
    });
  }
  async function refresh() {
    if (loading) { dirty = true; return loading; }
    loading = (async () => {
      try { publish({ entries: await readQueue(), loaded: true, error: false }); }
      catch { publish({ loaded: true, error: true }); }
    })();
    try { await loading; } finally { loading = null; if (dirty) { dirty = false; refresh(); } }
  }
  window.addEventListener('fiscus:queue-changed', refresh);
  const filterKey = scope => 'fiscus:activity-filters:v1:' + encodeURIComponent(Jo()?.username || '') + ':' + encodeURIComponent(scope || '');
  const loadFilters = scope => {
    const defaults = { category: 'all', member: 'all', query: '', month: 'all' };
    try {
      const value = JSON.parse(localStorage.getItem(filterKey(scope)) || 'null');
      if (!value || typeof value !== 'object') return defaults;
      return { category: typeof value.category === 'string' ? value.category.slice(0, 80) : 'all', member: typeof value.member === 'string' ? value.member.slice(0, 160) : 'all', query: typeof value.query === 'string' ? value.query.slice(0, 200) : '', month: /^(?:all|\d{4}-(?:0[1-9]|1[0-2]))$/.test(value.month) ? value.month : 'all' };
    } catch { return defaults; }
  };
  return {
    get snapshot() { return snapshot; }, readQueue, refresh, loadFilters,
    subscribe(listener) { listeners.add(listener); refresh(); return () => listeners.delete(listener); },
    saveFilters(scope, value) { try { localStorage.setItem(filterKey(scope), JSON.stringify(value)); } catch { /* In-memory controls continue to work. */ } },
    owns(entry, account, scope) { return Boolean(account?.username && entry.username === account.username && entry.scopeId === scope); },
    today() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; },
    monthLabel(month) { return new Intl.DateTimeFormat(window.FiscusUI.locale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T12:00:00Z')); },
    async sendManual(body) { return ot('/expenses', { ...Xt('POST', body), timeoutMs: 20000 }); },
    complete(entry, result, context) {
      const expense = result.expense || result.data?.expense;
      const receipt = { ...entry, syncState: 'synced', completedAt: Date.now() };
      publish({ receipts: [...snapshot.receipts.filter(item => item.completedAt > Date.now() - 300000 && item.id !== entry.id), receipt].slice(-5) });
      window.dispatchEvent(new CustomEvent('fiscus:ledger-changed', { detail: { scopeId: context.scopeId, username: context.username, expense } }));
    },
    async retry(entry) { try { await kM({ ...entry, syncState: 'retry', lastAttemptAt: Date.now() }); } catch { await refresh(); } },
    async saveManual(expense, scopeId) {
      const account = Jo();
      if (!account?.username || !scopeId) throw new Error('无法确定账本，请重新打开表单');
      const entry = { id: crypto.randomUUID(), clientMutationId: crypto.randomUUID(), kind: 'manual', expense, input: expense.merchant || expense.description, username: account.username, scopeId, memberName: account.displayName, memberId: account.username, queuedAt: Date.now(), syncState: 'saved' };
      await kM(entry); // A successful submission always has a durable copy before the network request.
      if (jf()) {
        (async () => {
          try {
            await HM(Kt.sendVoiceCommand.bind(Kt));
            const remaining = (await readQueue()).find(item => item.id === entry.id);
            if (remaining && !remaining.lastAttemptAt) await HM(Kt.sendVoiceCommand.bind(Kt));
          } catch { /* The durable entry remains available for retry. */ }
        })();
      }
      window.dispatchEvent(new Event('fiscus:queue-changed'));
      return { pending: true, expense, entryId: entry.id };
    },
  };
})();
function FiscusUseQueue() {
  const [value, setValue] = T.useState(FiscusLedger.snapshot);
  T.useEffect(() => FiscusLedger.subscribe(setValue), []);
  return value;
}
function FiscusPendingEntries({ account, scopeId }) {
  const queue = FiscusUseQueue(), t = window.FiscusUI.translate;
  const entries = queue.entries.filter(entry => FiscusLedger.owns(entry, account, scopeId));
  const otherLedgers = queue.entries.filter(entry => entry.username === account?.username && entry.scopeId !== scopeId).length;
  if (queue.error) return v.jsx('p', { className: 'fiscus-pending-error', role: 'status', children: t('暂时无法读取设备记录，请保留网站数据并重试') });
  return v.jsxs('div', { className: 'fiscus-pending-entries', children: [
    ...entries.map(entry => v.jsxs('div', { className: 'fiscus-pending-entry', children: [
      v.jsxs('div', { children: [
        v.jsx('p', { className: 'fiscus-pending-name', 'data-fiscus-user-content': 'field', children: entry.input }),
        entry.kind === 'manual' && v.jsx('p', { className: 'fiscus-pending-detail', children: `${entry.expense.date} · ${entry.expense.type === 'income' ? '+' : '-'}¥${Number(entry.expense.amount).toFixed(2)}` }),
      ] }),
      v.jsx('span', { className: 'fiscus-entry-sync-status ' + (entry.syncState === 'retry' ? 'needs-retry' : ''), children: t(entry.syncState === 'syncing' ? '正在同步' : entry.syncState === 'retry' ? '需要重试' : '已存于此设备') }),
    ] }, entry.id)),
    otherLedgers > 0 && v.jsx('p', { className: 'fiscus-pending-detail', children: t('其他账本的待同步记录已保留，请切换回对应账本') }),
  ] });
}
function FiscusManualEntry({ scopeId, categories, onClose, onSaved }) {
  const t = window.FiscusUI.translate;
  const [form, setForm] = T.useState({ type: 'expense', amount: '', merchant: '', date: FiscusLedger.today(), category: 'Food & Dining', description: '' });
  const [busy, setBusy] = T.useState(false), [error, setError] = T.useState('');
  const saving = T.useRef(false), mounted = T.useRef(true), opener = T.useRef(document.activeElement);
  T.useEffect(() => () => { mounted.current = false; if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }, []);
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const options = [...new Set([...Object.keys(Ws), ...categories])];
  async function submit(event) {
    event.preventDefault();
    if (saving.current) return;
    const amount = Number(form.amount), normalized = form.amount.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100)) || !form.merchant.trim()) { setError(t('请输入名称和有效金额，最多两位小数')); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      const result = await FiscusLedger.saveManual({ ...form, amount, merchant: form.merchant.trim(), description: form.description.trim() }, scopeId);
      onSaved(result); onClose();
    } catch { if (mounted.current) setError(t('未能保存，请保留表单并重试')); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }
  const field = (label, key, extra = {}) => v.jsxs('label', { className: 'fiscus-entry-field', children: [v.jsx('span', { children: t(label) }), v.jsx('input', { value: form[key], onChange: event => change(key, event.target.value), disabled: busy, ...extra })] });
  return v.jsx('div', { className: 'fiscus-manual-backdrop fixed inset-0 z-50 flex items-center justify-center', children: v.jsxs('section', { className: 'fiscus-manual-dialog max-w-md w-full bg-card', children: [
    v.jsxs('header', { className: 'fiscus-manual-header', children: [v.jsx('h2', { children: t('新增记录') }), v.jsx('button', { type: 'button', 'aria-label': t('关闭'), disabled: busy, onClick: onClose, children: '×' })] }),
    v.jsx('p', { className: 'fiscus-manual-hint', children: t('填写信息即可保存') }),
    v.jsxs('form', { onSubmit: submit, children: [
      v.jsxs('div', { className: 'fiscus-entry-type', role: 'group', 'aria-label': t('记录类型'), children: ['expense', 'income'].map(type => v.jsx('button', { type: 'button', disabled: busy, 'aria-pressed': form.type === type, onClick: () => setForm(previous => ({ ...previous, type, category: type === 'income' ? 'Income' : 'Food & Dining' })), children: t(type === 'income' ? '收入' : '支出') }, type)) }),
      field('金额', 'amount', { className: 'fiscus-manual-amount', inputMode: 'decimal', required: true, placeholder: '0.00', maxLength: 18, autoFocus: true, 'aria-label': t('金额') }),
      field('名称', 'merchant', { required: true, maxLength: 160, placeholder: t('咖啡、工资等'), 'aria-label': t('名称') }),
      v.jsxs('div', { className: 'fiscus-entry-field-row', children: [field('日期', 'date', { type: 'date', required: true, 'aria-label': t('日期') }), v.jsxs('label', { className: 'fiscus-entry-field', children: [v.jsx('span', { children: t('分类') }), v.jsxs('div', { className: 'fiscus-filter', children: [v.jsx('span', { className: 'fiscus-filter-label', 'data-fiscus-user-content': Ws[form.category] ? undefined : 'field', children: ow(form.category, window.FiscusUI.getLanguage()) }), v.jsx('select', { value: form.category, disabled: busy, 'aria-label': t('分类'), onChange: event => change('category', event.target.value), children: options.map(category => v.jsx('option', { value: category, children: ow(category, window.FiscusUI.getLanguage()) }, category)) }), v.jsx('span', { className: 'fiscus-month-chevron', 'aria-hidden': true, children: '⌄' })] })] })] }),
      field('备注（选填）', 'description', { maxLength: 500, 'aria-label': t('备注（选填）') }),
      error && v.jsx('p', { className: 'fiscus-entry-form-error', role: 'alert', children: error }),
      v.jsx('button', { className: 'fiscus-entry-save', type: 'submit', disabled: busy, children: t(busy ? '正在保存' : '保存记录') }),
    ] }),
  ] }) });
}
function FiscusActivityTools({ expenses, scopeId, month, onMonthChange, canWrite, onSaved }) {
  const t = window.FiscusUI.translate, queue = FiscusUseQueue();
  const [open, setOpen] = T.useState(false), [notice, setNotice] = T.useState('');
  const [pendingId, setPendingId] = T.useState(null);
  const account = Jo(), entries = queue.entries.filter(entry => FiscusLedger.owns(entry, account, scopeId));
  const months = [...new Set([...expenses.map(expense => expense.date?.slice(0, 7)), ...entries.filter(entry => entry.kind === 'manual').map(entry => entry.expense.date.slice(0, 7)), month === 'all' ? null : month].filter(value => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)))].sort().reverse();
  T.useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  T.useEffect(() => { if (pendingId && queue.receipts.some(item => item.id === pendingId && FiscusLedger.owns(item, account, scopeId))) { setNotice('已同步'); setPendingId(null); } }, [pendingId, queue.receipts, account?.username, scopeId]);
  return v.jsxs('div', { className: 'fiscus-activity-tools', children: [
    v.jsxs('div', { className: 'fiscus-month-actions', children: [
      v.jsxs('label', { className: 'fiscus-filter fiscus-month-picker', children: [v.jsx('span', { className: 'fiscus-filter-label', children: month === 'all' ? t('所有月份') : FiscusLedger.monthLabel(month) }), v.jsxs('select', { value: month, 'aria-label': t('选择月份'), onChange: event => onMonthChange(event.target.value), children: [v.jsx('option', { value: 'all', children: t('所有月份') }), ...months.map(value => v.jsx('option', { value, children: FiscusLedger.monthLabel(value) }, value))] }), v.jsx('span', { className: 'fiscus-month-chevron', 'aria-hidden': true, children: '⌄' })] }),
      canWrite && v.jsxs('button', { type: 'button', className: 'fiscus-new-entry', onClick: () => setOpen(true), children: [v.jsx('span', { 'aria-hidden': true, children: '+' }), t('新增记录')] }),
    ] }),
    (entries.length > 0 || queue.error) && v.jsxs('details', { className: 'fiscus-pending-card', children: [v.jsx('summary', { children: t('设备上的待同步记录') + (entries.length ? ` · ${entries.length}` : '') }), v.jsx(FiscusPendingEntries, { account, scopeId })] }),
    notice && v.jsx('p', { className: 'fiscus-save-notice', role: 'status', children: t(notice) }),
    open && v.jsx(FiscusManualEntry, { scopeId, categories: expenses.map(expense => expense.category), onClose: () => setOpen(false), onSaved: result => { setNotice('已存于此设备，将自动同步'); setPendingId(result.entryId); onSaved(result.expense); } }),
  ] });
}
function FiscusUndoToast({ items, onUndo, onDismiss }) {
  const t = window.FiscusUI.translate;
  T.useEffect(() => {
    const expiring = items.filter(item => item.status !== 'restoring');
    if (!expiring.length) return;
    const timer = setTimeout(() => { for (const item of expiring) if (item.expiresAt <= Date.now()) onDismiss(item.token); }, Math.max(0, Math.min(...expiring.map(item => item.expiresAt)) - Date.now()));
    return () => clearTimeout(timer);
  }, [items, onDismiss]);
  if (!items.length) return null;
  return v.jsx('div', { className: 'fiscus-undo-stack', 'aria-live': 'polite', children: items.slice(-3).map(item => v.jsxs('div', { className: 'fiscus-undo-toast', children: [
    v.jsxs('div', { children: [v.jsx('p', { children: t('记录已删除') }), v.jsx('p', { className: 'fiscus-undo-name', 'data-fiscus-user-content': 'field', children: item.expense?.merchant || item.expense?.description || '' })] }),
    v.jsx('button', { type: 'button', disabled: item.status === 'restoring', onClick: () => onUndo(item), children: t(item.status === 'restoring' ? '正在恢复' : item.status === 'error' ? '重试撤销' : '撤销') }),
    v.jsx('button', { type: 'button', className: 'fiscus-undo-dismiss', 'aria-label': t('关闭撤销提示'), disabled: item.status === 'restoring', onClick: () => onDismiss(item.token), children: '×' }),
  ] }, item.token)) });
}
