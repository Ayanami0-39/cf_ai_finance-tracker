/* A shared language and viewport bridge for the recovered React application. */
(() => {
  const dictionary = __FISCUS_TRANSLATIONS__;
  const root = document.documentElement;
  const subscribers = new Set();
  let memoryLanguage = 'zh';
  let initialized = false;
  const normalize = value => value === 'en' ? 'en' : 'zh';
  const getLanguage = () => {
    if (!initialized) {
      initialized = true;
      try { memoryLanguage = normalize(localStorage.getItem('ui-lang')); } catch { /* Storage can be unavailable in private browsing. */ }
    }
    return memoryLanguage;
  };
  const translate = value => {
    if (getLanguage() !== 'en' || typeof value !== 'string') return value;
    const key = value.trim();
    if (dictionary[key]) return value.replace(key, dictionary[key]);
    if (/^(?:·\s*)?(收入|支出)\s*¥[\d.,+-]+$/.test(key)) return value.replace(/收入|支出/, word => word === '收入' ? 'Income' : 'Expenses');
    const month = /^(\d{4})\s*年\s*(\d{1,2})\s*月(\s*（本月）)?$/.exec(key);
    if (month) return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(Number(month[1]), Number(month[2]) - 1, 1)) + (month[3] ? ' (this month)' : '');
    const count = /^共\s*(\d+)\s*笔(?:记录)?$/.exec(key);
    if (count) return `${count[1]} entries`;
    return value;
  };
  const originals = new WeakMap();
  const attributes = new WeakMap();
  let queued = false;
  let activeDialog = null;
  let activeConfirmation = null;
  let confirmationRow = null;
  const generatedDialogLabels = new WeakSet();
  let previousFocus = null;
  function fitAmounts() {
    for (const element of document.querySelectorAll('.fiscus-summary-amount,.fiscus-stat-amount,.fiscus-entry-amount,.fiscus-entry-meta')) {
      if (!element.getBoundingClientRect().width) continue;
      element.style.removeProperty('font-size');
      const style = getComputedStyle(element), base = parseFloat(style.fontSize);
      const range = document.createRange();
      range.selectNodeContents(element);
      const measured = range.getBoundingClientRect().width;
      const available = element.clientWidth;
      if (measured > available && available > 0) {
        // Keep the sign, currency and digits on one line as the device narrows.
        const size = Math.max(10, Math.min(base, base * (available - 2) / measured));
        element.style.fontSize = `${size}px`;
      }
    }
    for (const row of document.querySelectorAll('.fiscus-entry-row')) {
      if (!row.getBoundingClientRect().width) continue;
      const style = getComputedStyle(row);
      const contentHeight = Math.max(...[...row.children].map(child => child.getBoundingClientRect().height));
      const naturalHeight = contentHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      // Scale each record from its natural content height without accumulating on refresh.
      row.style.minHeight = `${naturalHeight * 1.25}px`;
    }
  }
  function updateDialogs() {
    const dialogs = [...document.querySelectorAll('[class*="fixed"][class*="inset-0"] > [class*="max-w-"]')]
      .filter(dialog => dialog.getBoundingClientRect().width > 0 && dialog.querySelector('button'));
    const dialog = dialogs.at(-1) || null;
    for (const item of dialogs) {
      item.setAttribute('role', 'dialog'); item.setAttribute('aria-modal', 'true'); item.tabIndex = -1;
      const heading = item.querySelector('h2,h3,[class*="font-semibold"]');
      if (heading && (!item.hasAttribute('aria-label') || generatedDialogLabels.has(item))) {
        generatedDialogLabels.add(item);
        if (item.getAttribute('aria-label') !== heading.textContent) item.setAttribute('aria-label', heading.textContent);
      }
    }
    if (dialog !== activeDialog) {
      if (dialog) {
        previousFocus = document.activeElement;
        if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
      } else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      activeDialog = dialog;
    }
  }
  function updateConfirmation() {
    const confirmation = [...document.querySelectorAll('.fiscus-entry-confirmation')]
      .find(element => element.getBoundingClientRect().width > 0) || null;
    if (confirmation === activeConfirmation) return;
    if (confirmation) {
      confirmationRow = confirmation.closest('.fiscus-entry-row');
      // Start on Cancel so Enter cannot accidentally confirm a deletion.
      confirmation.querySelector('button:last-of-type')?.focus({ preventScroll: true });
    } else if (confirmationRow?.isConnected && !activeDialog) {
      (confirmationRow.querySelector('.fiscus-entry-tools summary') || confirmationRow.querySelector('.fiscus-entry-tools button:last-of-type'))?.focus({ preventScroll: true });
    }
    activeConfirmation = confirmation;
  }
  document.addEventListener('pointerdown', event => {
    for (const menu of document.querySelectorAll('.fiscus-action-menu[open]')) {
      if (!menu.contains(event.target)) menu.open = false;
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const menus = [...document.querySelectorAll('.fiscus-action-menu[open]')];
      const menu = menus.find(item => item.contains(document.activeElement)) || menus.at(-1);
      if (menu) { event.preventDefault(); menu.open = false; menu.querySelector('summary')?.focus({ preventScroll: true }); return; }
    }
    if (event.key === 'Escape' && !activeDialog && activeConfirmation?.isConnected) {
      event.preventDefault();
      activeConfirmation.querySelector('button:last-of-type')?.click();
      return;
    }
    if (!activeDialog?.isConnected) return;
    if (event.key === 'Escape') {
      const close = activeDialog.querySelector('button[aria-label="Close"],button[aria-label="关闭"],button[aria-label="Close recycle bin"],button[aria-label="关闭回收站"]');
      if (close) { event.preventDefault(); close.click(); }
    }
    if (event.key === 'Tab') {
      const controls = [...activeDialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')]
        .filter(element => element.getBoundingClientRect().width > 0);
      const first = controls[0], last = controls.at(-1);
      if (first && event.shiftKey && (document.activeElement === first || document.activeElement === activeDialog)) { event.preventDefault(); last.focus(); }
      else if (first && !event.shiftKey && (document.activeElement === last || document.activeElement === activeDialog)) { event.preventDefault(); first.focus(); }
    }
  });
  function protectedContent(element) {
    const protectedNode = element.closest('[data-fiscus-user-content]');
    return protectedNode && (protectedNode.dataset.fiscusUserContent === 'field' || !element.closest('button,label,[role="button"]'));
  }
  function localize() {
    queued = false;
    root.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('script,style,textarea,[contenteditable="true"]') || protectedContent(parent)) continue;
      const last = originals.get(node);
      const original = last && last.result === node.nodeValue ? last.original : node.nodeValue;
      const result = translate(original);
      if (result !== original || last) {
        originals.set(node, { original, result });
        if (node.nodeValue !== result) node.nodeValue = result;
      }
    }
    for (const element of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
      if (protectedContent(element)) continue;
      const stored = attributes.get(element) || {};
      for (const attribute of ['placeholder', 'title', 'aria-label']) {
        const value = element.getAttribute(attribute);
        if (value === null) continue;
        const last = stored[attribute];
        const original = last && value === last.result ? last.original : value;
        const result = translate(original);
        stored[attribute] = { original, result };
        if (value !== result) element.setAttribute(attribute, result);
      }
      attributes.set(element, stored);
    }
    updateDialogs();
    updateConfirmation();
    fitAmounts();
    for (const form of document.querySelectorAll('.fiscus-composer form')) {
      const voice = form.querySelector('button[type="button"]');
      const send = form.querySelector('button[type="submit"]');
      if (voice) voice.setAttribute('aria-label', getLanguage() === 'en' ? 'Start voice entry' : '开始语音记账');
      if (send) send.setAttribute('aria-label', getLanguage() === 'en' ? 'Send message' : '发送消息');
    }
  }
  function scheduleLocalization() {
    if (!queued) { queued = true; requestAnimationFrame(localize); }
  }
  function setLanguage(value) {
    initialized = true;
    memoryLanguage = normalize(value);
    try { localStorage.setItem('ui-lang', memoryLanguage); } catch { /* Keep a working in-memory preference. */ }
    root.lang = memoryLanguage === 'en' ? 'en' : 'zh-CN';
    for (const callback of subscribers) callback();
    scheduleLocalization();
  }
  window.FiscusUI = {
    getLanguage, setLanguage, translate,
    formatRecordDate(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value || '');
      // A calendar date has no time zone. Keep it on its recorded day everywhere.
      const options = { month: 'numeric', day: 'numeric' };
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) options.timeZone = 'UTC';
      return date.toLocaleDateString(getLanguage() === 'en' ? 'en-US' : 'zh-CN', options);
    },
    locale: () => getLanguage() === 'en' ? 'en-US' : 'zh-CN',
    subscribeLanguage(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
  };
  window.addEventListener('storage', event => {
    if (event.key === 'ui-lang') setLanguage(event.newValue);
  });
  let largestHeight = innerHeight;
  function updateViewport() {
    const viewport = window.visualViewport;
    if (viewport && viewport.scale > 1.05) return; // Preserve pinch-to-zoom accessibility.
    const height = viewport?.height || innerHeight;
    const top = viewport?.offsetTop || 0;
    largestHeight = Math.max(largestHeight, innerHeight);
    const focused = document.activeElement?.matches('input,textarea,[contenteditable="true"]');
    root.dataset.keyboardOpen = String(Boolean(focused && largestHeight - height > 140));
    root.style.setProperty('--fiscus-viewport-height', `${Math.round(height)}px`);
    root.style.setProperty('--fiscus-viewport-top', `${Math.round(top)}px`);
  }
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  window.addEventListener('resize', updateViewport);
  window.addEventListener('resize', scheduleLocalization);
  window.addEventListener('orientationchange', () => { largestHeight = innerHeight; updateViewport(); });
  document.addEventListener('focusin', updateViewport);
  document.addEventListener('focusout', () => requestAnimationFrame(updateViewport));
  updateViewport();
  root.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
  new MutationObserver(scheduleLocalization).observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
  document.addEventListener('DOMContentLoaded', scheduleLocalization, { once: true });
  scheduleLocalization();
})();
