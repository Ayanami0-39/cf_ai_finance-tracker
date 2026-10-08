/* Preserve the recovered handlers while presenting secondary actions by name. */
function FiscusActionMenu({ children, label = '更多', compact = false }) {
  const details = T.useRef(null);
  const [position, setPosition] = T.useState({});
  function actions(nodes) {
    return T.Children.toArray(nodes).flatMap(node => {
      if (!T.isValidElement(node)) return [];
      if (node.type === T.Fragment) return actions(node.props.children);
      if (node.type !== 'button') return [node];
      const name = window.FiscusUI.translate(node.props['aria-label'] || node.props.title || '操作');
      return [T.cloneElement(node, {
        className: 'fiscus-menu-item', title: undefined,
        onClick: event => {
          details.current.open = false;
          details.current.querySelector('summary')?.focus({ preventScroll: true });
          node.props.onClick?.(event);
        },
      }, [node.props.children, v.jsx('span', { children: name }, 'label')])];
    });
  }
  return v.jsxs('details', {
    ref: details, className: 'fiscus-action-menu' + (compact ? ' fiscus-record-menu' : ''),
    onToggle: event => {
      if (event.currentTarget.open) {
        const rect = event.currentTarget.querySelector('summary').getBoundingClientRect();
        const panel = event.currentTarget.querySelector('.fiscus-menu-panel');
        const height = Math.min(panel.scrollHeight, innerHeight - 24);
        setPosition({ left: Math.max(12, Math.min(rect.right - 220, innerWidth - 232)), top: Math.max(12, Math.min(rect.bottom + 6, innerHeight - height - 12)) });
        for (const menu of document.querySelectorAll('.fiscus-action-menu[open]')) {
          if (menu !== event.currentTarget) menu.open = false;
        }
      }
    },
    children: [
      v.jsx('summary', { 'aria-label': window.FiscusUI.translate(label), children: compact ? '⋯' : window.FiscusUI.translate(label) }),
      v.jsx('div', { className: 'fiscus-menu-panel', style: position, children: actions(children) }),
    ],
  });
}
function FiscusSyncStatus({ online, pending }) {
  const [busy, setBusy] = T.useState(false);
  T.useEffect(() => {
    const changed = event => setBusy(Boolean(event.detail));
    window.addEventListener('fiscus:sync-state', changed);
    return () => window.removeEventListener('fiscus:sync-state', changed);
  }, []);
  if (!pending) return v.jsx('span', {
    className: 'fiscus-sync-status', title: window.FiscusUI.translate(online ? '此设备没有待同步记录' : '离线记录保存在此设备，联网后自动同步'),
    children: window.FiscusUI.translate(online ? '在线' : '离线'),
  });
  return v.jsxs(FiscusActionMenu, {
    label: `${pending} ${window.FiscusUI.translate('待同步')}`,
    children: [
      v.jsx('p', { className: 'fiscus-sync-explanation', children: window.FiscusUI.translate('记录保存在此设备，同步成功前请勿清除网站数据。如记录属于其他账本，请切换回原账本。') }),
      v.jsx('button', {
        type: 'button', disabled: !online || busy, 'aria-label': busy ? '同步中…' : '重试同步',
        onClick: () => window.dispatchEvent(new Event('fiscus:retry-sync')),
        children: '↻',
      }),
    ],
  });
}
