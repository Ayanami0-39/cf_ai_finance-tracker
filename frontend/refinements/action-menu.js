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
function FiscusSyncStatus({ online, pending, account, scopeId }) {
  const queue = FiscusUseQueue();
  const [busy, setBusy] = T.useState(false);
  T.useEffect(() => {
    const changed = event => setBusy(Boolean(event.detail));
    window.addEventListener('fiscus:sync-state', changed);
    return () => window.removeEventListener('fiscus:sync-state', changed);
  }, []);
  if (!pending && !queue.error) return v.jsx('span', {
    className: 'fiscus-sync-status', title: window.FiscusUI.translate(online ? '此设备没有待同步记录' : '离线记录保存在此设备，联网后自动同步'),
    children: window.FiscusUI.translate(online ? '已同步' : '离线'),
  });
  return v.jsxs(FiscusActionMenu, {
    label: `${pending} ${window.FiscusUI.translate('待同步')}`,
    children: [
      v.jsx('p', { className: 'fiscus-sync-explanation', children: window.FiscusUI.translate('记录保存在此设备，同步成功前请勿清除网站数据。如记录属于其他账本，请切换回原账本。') }),
      v.jsx(FiscusPendingEntries, { account, scopeId }),
      v.jsx('button', {
        type: 'button', disabled: !online || busy, 'aria-label': busy ? '同步中…' : '重试同步',
        onClick: () => window.dispatchEvent(new Event('fiscus:retry-sync')),
        children: '↻',
      }),
    ],
  });
}

/* A grouped account popover that keeps the original profile, ledger and auth handlers. */
function FiscusAccountMenu({ account, familyCode, role, onClose, onEditProfile, onOpenFamily, onRefresh, onLogout }) {
  const panel = T.useRef(null);
  const [position, setPosition] = T.useState({});
  const translate = window.FiscusUI.translate;
  T.useEffect(() => {
    const element = panel.current;
    // The recovered header renders desktop and mobile copies; only manage the visible one.
    if (!element?.getBoundingClientRect().width) return;
    const anchor = [...document.querySelectorAll('button[aria-label="账号菜单"],button[aria-label="Account menu"]')]
      .find(button => button.getBoundingClientRect().width > 0);
    const place = () => {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect(), viewport = window.visualViewport;
      const height = viewport?.height || innerHeight, top = viewport?.offsetTop || 0;
      const width = Math.min(300, innerWidth - 24), panelHeight = Math.min(element.scrollHeight, height - 24);
      setPosition({ left: Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)), top: Math.max(top + 12, Math.min(rect.bottom + 8, top + height - panelHeight - 12)) });
    };
    place();
    element.querySelector('.fiscus-account-action')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      if (anchor?.isConnected && (element.contains(document.activeElement) || document.activeElement === document.body)) anchor.focus({ preventScroll: true });
    };
  }, []);
  const paths = {
    profile: ['M20 21v-2a7 7 0 0 0-14 0v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
    family: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M6.1 7a7 7 0 0 1 11.55-2L20 8', 'M4 16l2.35 3A7 7 0 0 0 17.9 17'],
    logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  };
  const icon = kind => v.jsx('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, children: paths[kind].map((d, index) => v.jsx('path', { d }, index)) });
  const action = (kind, label, handler, navigate = false) => v.jsxs('button', {
    type: 'button', className: 'fiscus-account-action' + (kind === 'logout' ? ' fiscus-account-signout' : ''),
    onClick: () => { onClose(); handler(); },
    children: [v.jsx('span', { className: 'fiscus-account-action-icon', children: icon(kind) }), v.jsx('span', { children: translate(label) }), navigate && v.jsx('span', { className: 'fiscus-account-chevron', 'aria-hidden': true, children: '›' })],
  }, kind);
  return v.jsxs(v.Fragment, { children: [
    v.jsx('div', { className: 'fiscus-account-backdrop', onClick: onClose, 'aria-hidden': true }),
    v.jsxs('section', {
      ref: panel, className: 'fiscus-account-panel', style: position, 'aria-label': translate('账号菜单'),
      onKeyDown: event => {
        if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        const buttons = [...panel.current.querySelectorAll('.fiscus-account-action')];
        const index = buttons.indexOf(document.activeElement);
        let next;
        if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
        if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        if (next !== undefined) { event.preventDefault(); buttons[next].focus(); }
      },
      children: [
        v.jsxs('div', { className: 'fiscus-account-identity', children: [
          v.jsx('span', { className: 'fiscus-account-avatar', 'data-fiscus-user-content': 'field', children: account.emoji }),
          v.jsxs('div', { children: [
            v.jsx('p', { className: 'fiscus-account-name', 'data-fiscus-user-content': 'field', children: account.displayName || account.username }),
            v.jsx('p', { className: 'fiscus-account-username', 'data-fiscus-user-content': 'field', children: '@' + account.username }),
            v.jsxs('div', { className: 'fiscus-account-badges', children: [v.jsx('span', { children: translate(familyCode ? '家庭账本' : '个人账本') }), role && v.jsx('span', { children: translate(role) })] }),
          ] }),
        ] }),
        v.jsxs('div', { className: 'fiscus-account-group', children: [
          v.jsx('p', { className: 'fiscus-account-group-title', children: translate('账户与共享') }),
          action('profile', '编辑资料（昵称/头像）', onEditProfile, true),
          action('family', familyCode ? '家庭共享' : '创建 / 加入家庭', onOpenFamily, true),
        ] }),
        v.jsxs('div', { className: 'fiscus-account-group', children: [v.jsx('p', { className: 'fiscus-account-group-title', children: translate('数据') }), action('refresh', '刷新数据', onRefresh)] }),
        v.jsx('div', { className: 'fiscus-account-group fiscus-account-last-group', children: action('logout', '退出登录', onLogout) }),
      ],
    }),
  ] });
}
