/* Compiled into the recovered statistics module, using its React imports. */
function FiscusBreakdown({ children, variants, sources, total }) {
  const [mode, setMode] = l.useState('expenses');
  const id = l.useId();
  const tabs = [
    { key: 'expenses', label: '分类消费占比' },
    { key: 'income', label: '收入' },
  ];
  function onKeyDown(event, index) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1
      : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 1 - index : null;
    if (next === null) return;
    event.preventDefault();
    setMode(tabs[next].key);
    document.getElementById(`${id}-${tabs[next].key}-tab`)?.focus();
  }
  return e.jsxs($.div, {
    variants,
    className: 'fiscus-breakdown bg-card border rounded-xl p-4',
    children: [
      e.jsx('div', {
        role: 'tablist', 'aria-label': '收支分析', className: 'fiscus-breakdown-tabs',
        children: tabs.map((tab, index) => e.jsx('button', {
          type: 'button', role: 'tab', id: `${id}-${tab.key}-tab`,
          'aria-controls': `${id}-${tab.key}-panel`, 'aria-selected': mode === tab.key,
          tabIndex: mode === tab.key ? 0 : -1,
          onClick: () => setMode(tab.key), onKeyDown: event => onKeyDown(event, index),
          children: tab.label,
        }, tab.key)),
      }),
      e.jsx('div', {
        role: 'tabpanel', id: `${id}-expenses-panel`, 'aria-labelledby': `${id}-expenses-tab`,
        hidden: mode !== 'expenses', tabIndex: 0, className: 'fiscus-expense-content', children,
      }),
      e.jsx('div', {
        role: 'tabpanel', id: `${id}-income-panel`, 'aria-labelledby': `${id}-income-tab`,
        hidden: mode !== 'income', tabIndex: 0, className: 'fiscus-income-content',
        children: e.jsx(is, { sources, total }),
      }),
    ],
  });
}
