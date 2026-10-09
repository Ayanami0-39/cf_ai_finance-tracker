import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const recovered = new URL('../frontend/recovered/', import.meta.url);
const refinements = new URL('../frontend/refinements/', import.meta.url);
const translations = Object.fromEntries((await readFile(new URL('translations.txt', refinements), 'utf8')).trim().split('\n').map(line => {
  const separator = line.indexOf('|');
  if (separator < 1) throw new Error('Invalid translation entry');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
const css = await readFile(new URL('ui.css', refinements), 'utf8');
const statsTabs = await readFile(new URL('stats-tabs.js', refinements), 'utf8');
const actionMenu = await readFile(new URL('action-menu.js', refinements), 'utf8');
const bridge = (await readFile(new URL('ui.js', refinements), 'utf8')).replace('__FISCUS_TRANSLATIONS__', JSON.stringify(translations));
const provenance = JSON.parse(await readFile(new URL('provenance.json', recovered), 'utf8'));
for (const [name, expected] of Object.entries(provenance.sha256)) {
  const actual = createHash('sha256').update(await readFile(new URL(name, recovered))).digest('hex');
  if (actual !== expected) throw new Error('Recovered baseline changed: ' + name);
}
const files = await readdir(new URL('assets/', recovered));
const sources = Object.fromEntries(await Promise.all(files.map(async name => [name, await readFile(new URL('assets/' + name, recovered), 'utf8')])));
const version = createHash('sha256').update(JSON.stringify(sources) + css + bridge + statsTabs + actionMenu + await readFile(new URL(import.meta.url))).digest('hex').slice(0, 12);
const base = '/ui/' + version;

function patchJavaScript(name, source) {
  if (name.startsWith('StatsSection-')) source += '\n' + statsTabs;
  if (name.startsWith('index-')) source += '\n' + actionMenu;
  const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  function insert(position, content) { edits.push({ start: position, end: position, content }); }
  function replace(node, content) { edits.push({ start: node.getStart(parsed), end: node.end, content }); }
  const userFields = new Set(['content', 'merchant', 'description', 'displayName', 'username', 'by', 'name']);
  function hasUserField(node) {
    if (ts.isCallExpression(node) && /\.(?:jsx|jsxs)$/.test(node.expression.getText(parsed))) return false;
    if (ts.isPropertyAccessExpression(node) && userFields.has(node.name.text)) return true;
    return ts.forEachChild(node, hasUserField) || false;
  }
  const tagged = new Set();
  const skipped = new Set();
  function tag(object, kind = "field") {
    if (!tagged.has(object.pos)) { tagged.add(object.pos); insert(object.getStart(parsed) + 1, '"data-fiscus-user-content":' + JSON.stringify(kind) + ','); }
  }
  function visit(node) {
    if (skipped.has(node.pos)) return;
    let component = node;
    while (component && !ts.isFunctionDeclaration(component)) component = component.parent;
    const componentName = component?.name?.text;
    if (name.startsWith('index-') && componentName === 'J2' && ts.isCallExpression(node) && node.arguments[0]?.getText(parsed) === 'v.Fragment' && node.arguments[1]?.getText(parsed).includes('absolute right-0 top-11 w-52 bg-card border rounded-xl shadow-lg z-50 overflow-hidden py-1')) {
      replace(node, 'v.jsx(FiscusAccountMenu,{account:n,familyCode:l,role:k,onClose:()=>g(false),onEditProfile:i,onOpenFamily:o,onRefresh:c,onLogout:U})');
      return;
    }
    if (name.startsWith('StatsSection-') && componentName === 'xs' && ts.isCallExpression(node) && node.arguments[0]?.getText(parsed) === '"span"' && node.arguments[1]?.getText(parsed).includes('children:[Number(p),"月"]')) { replace(node, 'null'); return; }
    if (name.startsWith('StatsSection-') && componentName === 'fs' && ts.isCallExpression(node) && node.arguments[0]?.getText(parsed) === '"p"' && node.arguments[1]?.getText(parsed).includes('children:"按月或按周查看收支与分类占比"')) { replace(node, 'null'); return; }
    // Keep the corner avatar badge, but remove the duplicate emoji beside the author.
    if (name.startsWith('index-') && componentName === 'W2' && ts.isBinaryExpression(node) && node.getText(parsed) === 'm&&v.jsx("span",{children:m.emoji})') { replace(node, 'null'); return; }
    if (name.startsWith('index-') && componentName === 'ky' && ts.isPropertyAssignment(node) && node.name.getText(parsed) === 'disabled') {
      if (node.initializer.getText(parsed) === 'o') replace(node.initializer, 'false');
      if (node.initializer.getText(parsed) === '!h.trim()||o') { replace(node.initializer, '!h.trim()'); return; }
    }
    if (name.startsWith('index-') && componentName === 'ky' && ts.isBinaryExpression(node) && node.getText(parsed) === '!h.trim()||o') { replace(node, '!h.trim()'); return; }
    if (name.startsWith('index-') && componentName === 'By' && ts.isTemplateExpression(node) && node.getText(parsed).startsWith('`${et.merchant') && node.getText(parsed).includes('et.amount')) insert(node.getStart(parsed) + 1, '${et.date||""} ');
    if (name.startsWith('index-') && componentName === 'ky' && ts.isCallExpression(node) && node.arguments[0]?.getText(parsed) === '"p"' && node.arguments[1]?.getText(parsed).includes('随口一提，即刻入账')) insert(node.getStart(parsed), 'l.length===0&&');
    if (name.startsWith('index-') && componentName === 'J2' && ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'X') {
      const children = node.initializer.arguments[1].properties.find(p => p.name.getText(parsed) === 'children').initializer;
      replace(children.elements[0], 'v.jsx(FiscusSyncStatus,{online:f,pending:d})');
      replace(children.elements[1], 'null');
      skipped.add(children.elements[0].pos); skipped.add(children.elements[1].pos);
    }
    if (name.startsWith('index-') && componentName === 'J2' && ts.isCallExpression(node) && node.arguments[0]?.getText(parsed) === '"button"' && node.arguments[1]?.getText(parsed).includes('onClick:o,') && node.arguments[1]?.getText(parsed).includes('title:"家庭共享"')) {
      replace(node, 'null'); return;
    }
    if (name.startsWith('index-') && ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'deleteExpense') {
      replace(node.body, '{const result=await ot(`/expenses/${encodeURIComponent(n)}/${encodeURIComponent(i)}`,{method:"DELETE"});if(!result?.success)throw new Error(result?.error||"删除失败");return result}');
      return;
    }
    if (name.startsWith('index-') && componentName === 'ky' && ts.isCallExpression(node) && node.expression.getText(parsed) === 'T.useEffect' && node.getText(parsed).includes('J!==W.last&&k()')) {
      replace(node, node.getText(parsed).replace('J!==W.last&&k()', 'J!==W.last&&(!W.last||fiscusFollow.current||l[l.length-1]?.role==="user")&&k()'));
      return;
    }
    if (name.startsWith('index-') && componentName === 'ky' && ts.isConditionalExpression(node) && node.getText(parsed) === 'Z?"smooth":"auto"') {
      replace(node, 'Z&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches?"smooth":"auto"');
      return;
    }
    if (name.startsWith('index-') && componentName === 'Ly' && ts.isCallExpression(node) && node.arguments[0]?.getText(parsed) === '"select"') {
      insert(node.end, ',v.jsx("span",{className:"fiscus-filter-label","data-fiscus-user-content":n==="all"?undefined:"field",children:n==="all"?(o?`${o} ${l}`:l):f?`${f.emoji?f.emoji+" ":""}${f.label}`:n})');
    }
    if (name.startsWith('StatsSection-') && componentName === 'fs' && ts.isCallExpression(node) && node.arguments[0]?.getText(parsed) === '"select"' && node.arguments[1]?.getText(parsed).includes('按成员筛选统计')) {
      insert(node.end, ',e.jsx("span",{className:"fiscus-filter-label","data-fiscus-user-content":u==="all"?undefined:"field",children:u==="all"?"👥 全部成员":`${xe(u)} ${Z(u)}`})');
    }
    if (name.startsWith('StatsSection-') && componentName === 'Zt' && ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'M' && node.initializer?.getText(parsed) === 'g.ratio*360') replace(node.initializer, 'Math.min(g.ratio*360,359.999)');
    if (name.startsWith('StatsSection-') && componentName === 'fs' && ts.isCallExpression(node) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      if (node.arguments[0].getText(parsed) === 'is') { replace(node, 'null'); return; }
      if (node.arguments[0].getText(parsed) === '$.div') {
        const children = node.arguments[1].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'children');
        if (children && ts.isArrayLiteralExpression(children.initializer) && children.initializer.elements[0]?.getText(parsed).includes('分类消费占比')) {
          replace(node.arguments[0], 'FiscusBreakdown');
          insert(node.arguments[1].getStart(parsed) + 1, 'sources:_e.list,total:_e.total,');
        }
      }
    }
    if (name.startsWith('StatsSection-') && componentName === 'fs' && ts.isTemplateExpression(node) && node.getText(parsed).startsWith('`w-full flex items-center gap-2 rounded-lg px-2 py-1.5')) insert(node.getStart(parsed) + 1, 'fiscus-category-row ');
    // Keep complete merchant names in the statistics lists as well as labels.
    if (name.startsWith('StatsSection-') && componentName === 'fs' && ts.isCallExpression(node) && node.expression.getText(parsed).endsWith('.trim().slice') && node.arguments[0]?.getText(parsed) === '0' && node.arguments[1]?.getText(parsed) === '10') { replace(node, node.expression.expression.getText(parsed)); return; }
    if (ts.isCallExpression(node) && node.arguments[0] && node.arguments[1] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'span' && ts.isObjectLiteralExpression(node.arguments[1])) {
      const heading = node.arguments[1].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'children');
      if (heading && ts.isStringLiteral(heading.initializer) && ['编辑资料', '家庭共享设置', '编辑交易记录'].includes(heading.initializer.text)) replace(node.arguments[0], '"h2"');
      if (heading && name.startsWith('FamilySettings-') && ts.isArrayLiteralExpression(heading.initializer) && heading.initializer.elements.some(e => ts.isStringLiteral(e) && e.text === '家庭共享')) replace(node.arguments[0], '"h2"');
    }
    if (ts.isObjectLiteralExpression(node)) {
      if (name.startsWith('StatsSection-') && componentName === 'xs') {
        const classes = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'className');
        if (classes?.initializer.getText(parsed).startsWith('`flex-1 flex flex-col items-center gap-1')) insert(node.getStart(parsed) + 1, '"aria-label":window.FiscusUI.formatTrendPeriod(c.key),"aria-pressed":c.key===o,');
      }
      if (name.startsWith('index-') && componentName === 'ky' && node.properties.some(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'ref' && p.initializer.getText(parsed) === 'R')) {
        insert(node.getStart(parsed) + 1, 'onScroll:()=>{const scroll=R.current;const away=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight>100;fiscusFollow.current=!away;setFiscusAway(away)},');
      }
      if (name.startsWith('index-') && componentName === 'rw') {
        const classes = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'className');
        const children = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'children');
        if (classes?.initializer?.getText(parsed) === '"text-xs text-muted-foreground"' && children?.initializer.getText(parsed).includes('new Date(n.date)')) {
          replace(classes.initializer, '"fiscus-entry-meta text-xs text-muted-foreground"');
          replace(children.initializer, '[v.jsxs("span",{children:[g?`${g.name} · `:"",h(n.category)]})]');
          tag(node);
          return;
        }
      }
      if (name.startsWith('StatsSection-') && componentName === 'fs') {
        const classes = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'className');
        if (classes?.initializer?.getText(parsed) === '"relative"' && node.getText(parsed).includes('按成员筛选统计')) replace(classes.initializer, '"fiscus-stats-filter fiscus-filter relative"');
      }
      const children = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed).replace(/["']/g, '') === 'children');
      if (children && hasUserField(children.initializer) && ts.isCallExpression(node.parent) && ts.isStringLiteral(node.parent.arguments[0]) && node.parent.arguments[0].text !== 'svg') tag(node);
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      if (name.startsWith('StatsSection-') && node.name.text === 'xs') {
        const returned = node.body.statements.find(s => ts.isReturnStatement(s));
        const object = returned.expression.arguments[1];
        const children = object.properties.find(p => p.name.getText(parsed) === 'children').initializer;
        if (!ts.isArrayLiteralExpression(children) || children.elements.length !== 2) throw new Error('Trend chart no longer matches the reviewed baseline');
        insert(object.getStart(parsed) + 1, 'className:"fiscus-trend-chart",');
        insert(children.elements[0].end, ',e.jsx("div",{className:"fiscus-trend-axis",children:n.map(c=>e.jsxs("button",{type:"button",onClick:()=>r(c.key),"aria-label":window.FiscusUI.formatTrendPeriod(c.key),"aria-pressed":c.key===o,className:c.key===o?"is-selected":c.key===t?"is-current":"",children:[e.jsx("span",{children:window.FiscusUI.formatTrendMonth(c.key)}),e.jsx("span",{children:c===n[0]||c.key.endsWith("-01")?c.key.slice(0,4):"\\u00a0"})]},c.key))})');
      }
      if (name.startsWith('index-') && node.name.text === 'Fw') {
        replace(node.body, '{try{const raw=localStorage.getItem(av);if(!raw)return null;const snapshot=JSON.parse(raw);return [2,3].includes(snapshot.version)&&snapshot.account?.username&&Array.isArray(snapshot.expenses)&&Array.isArray(snapshot.chat?.messages)?snapshot:null}catch{return null}}');
        return;
      }
      if (name.startsWith('index-') && node.name.text === 'Pw') {
        replace(node.body, '{return Boolean(n&&n.account.username===i&&(!l||n.account.scopeId===l))}');
        return;
      }
      if (name.startsWith('index-') && node.name.text === '$w') {
        replace(node.body, '{try{localStorage.setItem(av,JSON.stringify({...n,version:3,completeLedger:true,savedAt:Date.now()}))}catch{/* Preserve the previous snapshot if storage is full or unavailable. */}}');
        return;
      }
      if (name.startsWith('StatsSection-') && node.name.text === 'fs') {
        const returned = node.body.statements.find(s => ts.isReturnStatement(s));
        const childrenOf = object => object.properties.find(p => p.name.getText(parsed) === 'children').initializer;
        const outer = childrenOf(returned.expression.arguments[1]);
        const sections = childrenOf(childrenOf(outer.elements[0].arguments[1]).elements[2].whenTrue.arguments[1]);
        if (sections.elements.length !== 12) throw new Error('Insight tools no longer match the reviewed baseline');
        insert(sections.elements[5].getStart(parsed), 'p==="month"&&e.jsxs("details",{className:"fiscus-insight-tools",children:[e.jsx("summary",{children:"管理工具"}),e.jsxs("div",{className:"fiscus-insight-tools-content",children:[');
        insert(sections.elements[11].end, ']})]})');
      }
      if (name.startsWith('index-') && node.name.text === 'By') {
        const returned = node.body.statements.find(s => ts.isReturnStatement(s));
        const childrenOf = object => object.properties.find(p => p.name.getText(parsed) === 'children').initializer;
        const controls = childrenOf(childrenOf(childrenOf(returned.expression.arguments[1]).elements[1].arguments[1]).elements[0].arguments[1]);
        if (controls.elements.length !== 4) throw new Error('Activity actions no longer match the reviewed baseline');
        insert(controls.elements[1].getStart(parsed), 'v.jsxs(FiscusActionMenu,{children:[');
        insert(controls.elements[3].end, ']})');
      }
      if (name.startsWith('index-') && node.name.text === 'ky') {
        insert(node.body.getStart(parsed) + 1, 'const fiscusFollow=T.useRef(true),[fiscusAway,setFiscusAway]=T.useState(false);');
        const returned = node.body.statements.find(s => ts.isReturnStatement(s));
        const children = returned.expression.arguments[1].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'children').initializer;
        if (!ts.isArrayLiteralExpression(children) || children.elements.length !== 3) throw new Error('Chat layout no longer matches the reviewed baseline');
        replace(children.elements[0], 'null');
        skipped.add(children.elements[0].pos);
        insert(children.elements[2].getStart(parsed), 'fiscusAway&&v.jsx("div",{className:"fiscus-chat-jump",children:v.jsx("button",{type:"button",onClick:()=>{fiscusFollow.current=true;setFiscusAway(false);k()},children:window.FiscusUI.translate("回到最新消息")})}),');
      }
      if (name.startsWith('index-') && node.name.text === 'rw') {
        const returned = node.body.statements.find(s => ts.isReturnStatement(s));
        const object = returned.expression.arguments[1];
        const children = object.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'children').initializer;
        if (!ts.isArrayLiteralExpression(children) || children.elements.length !== 4) throw new Error('Activity row no longer matches the reviewed baseline');
        insert(children.elements[0].getStart(parsed), 'v.jsxs("div",{className:"fiscus-entry-details",children:[');
        insert(children.elements[1].end, ']})');
        const total = children.elements[2].arguments[1];
        const amount = total.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(parsed) === 'children').initializer;
        const actions = children.elements[3];
        let deleteButton;
        const findDelete = current => {
          if (ts.isCallExpression(current) && current.arguments[0]?.getText(parsed) === '"button"' && current.arguments[1]?.getText(parsed).includes('"aria-label":"删除该记录"')) deleteButton = current;
          ts.forEachChild(current, findDelete);
        };
        findDelete(actions);
        if (!deleteButton) throw new Error('Record delete action no longer matches the reviewed baseline');
        replace(children.elements[2], amount.getText(parsed).replace('`text-sm font-semibold tabular-nums', '`fiscus-entry-amount text-sm font-semibold tabular-nums'));
        skipped.add(children.elements[2].pos);
        const originalActions = actions.getText(parsed);
        const deleteStart = deleteButton.getStart(parsed) - actions.getStart(parsed), deleteEnd = deleteButton.end - actions.getStart(parsed);
        const actionSource = (originalActions.slice(0, deleteStart) + 'v.jsx(FiscusActionMenu,{label:"记录操作",compact:true,children:' + deleteButton.getText(parsed) + '})' + originalActions.slice(deleteEnd))
          .replace('className:"flex-shrink-0 -mr-1 flex items-center gap-0.5"', 'className:c?"fiscus-entry-confirmation":"flex-shrink-0 -mr-1 flex items-center gap-0.5"')
          .replace('children:"确认删除？"', 'children:window.FiscusUI.translate("确认删除？")');
        if (!actionSource.includes('fiscus-entry-confirmation')) throw new Error('Delete confirmation no longer matches the reviewed baseline');
        replace(actions, 'v.jsxs("div",{className:"fiscus-entry-tools",children:[v.jsx("time",{className:"fiscus-entry-date text-xs text-muted-foreground",dateTime:n.date,children:window.FiscusUI.formatRecordDate(n.date)}),'+actionSource+']})');
        skipped.add(actions.pos);
      }
      // Keep the original IndexedDB schema and entries; never evict pending work.
      if (name.startsWith('index-') && node.name.text === 'kM') {
        replace(node.body, '{const i=await gd();await new Promise((resolve,reject)=>{const tx=i.transaction(An,"readwrite");tx.objectStore(An).put(n);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});window.dispatchEvent(new Event("fiscus:queue-changed"))}');
        return;
      }
      if (name.startsWith('index-') && node.name.text === 'n0') {
        const body = node.body.getText(parsed).replace('clientMutationId:crypto.randomUUID()', 'clientMutationId:i?.idempotencyKey||crypto.randomUUID()').replace('return kM(l),l', 'return kM(l).then(()=>l)');
        replace(node.body, body);
        return;
      }
      if (name.startsWith('index-') && node.name.text === 'HM') {
        const body = node.body.getText(parsed).replaceAll('Yi', 'active');
        replace(node.body, '{if(window.__fiscusSyncFlight)return window.__fiscusSyncFlight;const active=Yi;const run=(async()=>'+body+')();window.__fiscusSyncFlight=run;try{return await run}finally{window.__fiscusSyncFlight=null}}');
        return;
      }
      if (name.startsWith('index-') && node.name.text === 'Z2') replace(node.body, '{return window.FiscusUI.getLanguage()}');
      if (name.startsWith('index-') && node.name.text === 'XM') insert(node.body.getStart(parsed) + 1, '_f();const fiscusPendingReplies=T.useRef(0);');
      if (name.startsWith('index-') && node.name.text === 'Q2') {
        const last = node.body.statements.find(s => ts.isReturnStatement(s));
        insert(last.getStart(parsed), 'T.useEffect(()=>window.FiscusUI.subscribeLanguage(()=>l(window.FiscusUI.getLanguage())),[]);');
      }
      if (name.startsWith('index-') && ['W2', 'rw'].includes(node.name.text)) {
        const returned = node.body.statements.find(s => ts.isReturnStatement(s));
        if (returned?.expression && ts.isCallExpression(returned.expression) && ts.isObjectLiteralExpression(returned.expression.arguments[1])) tag(returned.expression.arguments[1], "history");
      }
    }
    // A queued retry must reuse the key sent before a response was lost.
    if (name.startsWith('index-') && ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'dn' && ts.isArrowFunction(node.initializer)) {
      insert(node.initializer.body.getStart(parsed) + 1, 'const mutationId=crypto.randomUUID();');
    }
    let owner = node.parent;
    while (owner && !(ts.isVariableDeclaration(owner) && owner.name.getText(parsed) === 'dn')) owner = owner.parent;
    if (name.startsWith('index-') && owner && ts.isCallExpression(node) && node.expression.getText(parsed) === 'd') {
      if (node.arguments[0]?.getText(parsed) === '!0') { replace(node, '(fiscusPendingReplies.current++,d(true))'); return; }
      if (node.arguments[0]?.getText(parsed) === '!1') { replace(node, '(fiscusPendingReplies.current=Math.max(0,fiscusPendingReplies.current-1),d(fiscusPendingReplies.current>0))'); return; }
    }
    if (name.startsWith('index-') && owner && ts.isCallExpression(node) && ['n0','Kt.sendVoiceCommand'].includes(node.expression.getText(parsed))) {
      const object = node.arguments[node.expression.getText(parsed) === 'n0' ? 1 : 0];
      insert(object.getStart(parsed) + 1, 'idempotencyKey:mutationId,');
      if (node.expression.getText(parsed) === 'n0') insert(node.getStart(parsed), 'await ');
    }
    if (name.startsWith('index-') && ts.isCallExpression(node) && node.expression.getText(parsed) === 'T.useEffect' && node.arguments[0]?.getText(parsed).includes('HM(Kt.sendVoiceCommand.bind(Kt))')) {
      replace(node, `T.useEffect(()=>{let stopped=false,warned=false;const sync=async()=>{zt(jf());if(stopped||!h?.username||!dt||!jf())return;window.dispatchEvent(new CustomEvent("fiscus:sync-state",{detail:true}));try{St(await qi());const result=await HM(Kt.sendVoiceCommand.bind(Kt));if(stopped)return;St(await qi());if(!warned&&(result.skipped||result.failed)){warned=true;f(result.skipped?"待同步记录属于其他账户或账本，请切换回原账户或账本同步。":"同步暂未成功，记录已保留，将自动重试。","warning")}if(result.flushed>0){f(\`离线记账已同步 \${result.flushed} 条\`,"success");mt()}}catch{/* Retain entries and retry after a transient failure. */}finally{window.dispatchEvent(new CustomEvent("fiscus:sync-state",{detail:false}))}};const changed=()=>{qi().then(count=>{if(!stopped)St(count)});};const offline=()=>zt(false);const visible=()=>{if(document.visibilityState==="visible")sync()};window.addEventListener("online",sync);window.addEventListener("offline",offline);window.addEventListener("focus",sync);window.addEventListener("fiscus:retry-sync",sync);window.addEventListener("fiscus:queue-changed",changed);document.addEventListener("visibilitychange",visible);const timer=setInterval(()=>{if(document.visibilityState==="visible")sync()},20000);sync();return()=>{stopped=true;clearInterval(timer);window.removeEventListener("online",sync);window.removeEventListener("offline",offline);window.removeEventListener("focus",sync);window.removeEventListener("fiscus:retry-sync",sync);window.removeEventListener("fiscus:queue-changed",changed);document.removeEventListener("visibilitychange",visible)}},[dt,h?.username])`);
      return;
    }
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'localStorage.setItem' && node.arguments[0]?.getText(parsed) === 'h0') {
      replace(node, 'window.FiscusUI.setLanguage(' + node.arguments[1].getText(parsed) + ')');
    }
    if (name.startsWith('index-') && componentName === 'XM' && ts.isCallExpression(node) && node.expression.getText(parsed) === 'localStorage.removeItem' && node.arguments[0]?.getText(parsed) === '"app_bootstrap_snapshot"') {
      let owner = node.parent;
      while (owner && !ts.isFunctionDeclaration(owner)) {
        if (ts.isCallExpression(owner) && owner.expression.getText(parsed) === 'T.useEffect' && owner.getText(parsed).includes('Kt.getBootstrap()')) { replace(node, 'void 0'); break; }
        owner = owner.parent;
      }
    }
    if (ts.isStringLiteral(node)) {
      if (name.startsWith('StatsSection-') && componentName === 'xs' && node.text === 'relative h-36 pl-9') { replace(node, JSON.stringify('fiscus-trend-plot ' + node.text)); return; }
      if (name.startsWith('StatsSection-') && componentName === 'xs' && node.text === 'absolute left-11 right-0 bottom-0 top-0 flex items-end justify-between gap-1.5') { replace(node, JSON.stringify('fiscus-trend-bars ' + node.text)); return; }
      if (name.startsWith('StatsSection-') && componentName === 'fs' && node.text === '统计分析 / Statistics') { replace(node, '"财务概览"'); return; }
      if (name.startsWith('index-') && componentName === 'By' && node.text === 'flex flex-col h-full') { replace(node, '"fiscus-activity flex flex-col h-full"'); return; }
      if (name.startsWith('index-') && componentName === 'By' && node.text.startsWith('flex-1 flex items-center gap-1.5 bg-card border rounded-full')) { replace(node, JSON.stringify('fiscus-search ' + node.text)); return; }
      if (name.startsWith('index-') && componentName === 'W2' && node.text === 'relative max-w-[85%] md:max-w-[75%]') { replace(node, JSON.stringify('fiscus-message-content ' + node.text)); return; }
      if (name.startsWith('index-') && componentName === 'By' && node.text === '搜索商户、备注、金额…') { replace(node, '"搜索 / YYYY-MM"'); return; }
      if (name.startsWith('index-') && componentName === 'ky' && node.text === '输入收支，如「午饭花了30块」…') { replace(node, '"记一笔收支"'); return; }
      if (name.startsWith('index-') && componentName === 'ky' && node.text === '智能记账助手') { replace(node, '"记账助手"'); return; }
      if (name.startsWith('StatsSection-') && componentName === 'fs' && node.text === 'space-y-4') { replace(node, '"fiscus-insight-sections space-y-4"'); return; }
      if (name.startsWith('StatsSection-') && componentName === 'fs' && node.text === 'text-xs text-muted-foreground tabular-nums whitespace-nowrap flex-shrink-0') { replace(node, JSON.stringify('fiscus-category-amount ' + node.text)); return; }
      if (name.startsWith('StatsSection-') && componentName === 'fs' && node.text === 'text-xs text-muted-foreground/70 tabular-nums w-12 text-right flex-shrink-0') { replace(node, JSON.stringify('fiscus-category-share ' + node.text)); return; }
      if (name.startsWith('index-') && componentName === 'rw' && node.text.startsWith('flex items-center gap-3 py-3 px-4 border-b')) { replace(node, JSON.stringify('fiscus-entry-row ' + node.text)); return; }
      if (name.startsWith('index-') && componentName === 'rw' && node.text === 'text-right flex-shrink-0') { replace(node, JSON.stringify('fiscus-entry-total ' + node.text)); return; }
      if (name.startsWith('StatsSection-') && componentName === 'fs' && node.text === 'flex items-center justify-between mb-4 gap-2') { replace(node, JSON.stringify('fiscus-stats-header ' + node.text)); return; }
      if (name.startsWith('index-') && componentName === 'Ly' && node.text === 'relative') { replace(node, '"fiscus-filter relative "+(d?"fiscus-filter-selected":"")'); return; }
      if (name.startsWith('index-') && componentName === 'sw' && node.text === 'grid grid-cols-3 lg:grid-cols-3 gap-2 md:gap-3') { replace(node, JSON.stringify('fiscus-summary ' + node.text)); return; }
      if (name.startsWith('index-') && componentName === 'sw' && node.text.includes('tabular-nums') && node.text.includes('truncate')) { replace(node, JSON.stringify('fiscus-summary-amount ' + node.text)); return; }
      const classes = {
        'h-screen h-dvh flex flex-col bg-background': 'fiscus-app h-screen h-dvh flex flex-col bg-background',
        'hidden md:flex flex-1 overflow-hidden': 'fiscus-desktop hidden md:flex flex-1 overflow-hidden',
        'md:hidden flex-1 overflow-hidden flex flex-col pt-12': 'fiscus-mobile md:hidden flex-1 overflow-hidden flex flex-col pt-12',
        'fixed top-0 left-0 right-0 z-30 h-12 bg-card/95 backdrop-blur border-b shadow-sm flex items-center justify-between pl-1.5 pr-3': 'fiscus-mobile-header fixed top-0 left-0 right-0 z-30 h-12 bg-card/95 backdrop-blur border-b shadow-sm flex items-center justify-between pl-1.5 pr-3',
        'flex flex-col h-full': 'fiscus-chat flex flex-col h-full',
        'p-4 pt-2 mx-auto w-full max-w-3xl': 'fiscus-composer p-4 pt-2 mx-auto w-full max-w-3xl',
      };
      let ancestor = node.parent;
      while (ancestor && !ts.isFunctionDeclaration(ancestor)) ancestor = ancestor.parent;
      if (classes[node.text] && (node.text !== 'flex flex-col h-full' || ancestor?.name?.text === 'ky')) replace(node, JSON.stringify(classes[node.text]));
      else if (componentName === 'ky' && node.text.startsWith('flex-1 overflow-y-auto px-4 md:px-6 py-3')) replace(node, JSON.stringify('fiscus-chat-messages ' + node.text));
      else if (node.text.startsWith('assets/')) replace(node, JSON.stringify(base.slice(1) + '/' + node.text));
      else if (node.text === 'zh-CN' && ts.isCallExpression(node.parent) && /toLocale(?:Date|Time)String$/.test(node.parent.expression.getText(parsed))) replace(node, 'window.FiscusUI.locale()');
    }
    if (name.startsWith('index-') && componentName === 'W2' && ts.isTemplateExpression(node) && node.getText(parsed).startsWith('`rounded-xl px-4 py-2.5')) insert(node.getStart(parsed) + 1, 'fiscus-message-bubble ');
    if (name.startsWith('StatsSection-') && componentName === 'fs' && ts.isTemplateExpression(node) && node.getText(parsed).startsWith('`inline-flex items-center gap-0.5 text-[10px] tabular-nums')) insert(node.getStart(parsed) + 1, 'fiscus-category-trend ');
    if (name.startsWith('index-') && componentName === 'rw' && ts.isTemplateExpression(node) && node.getText(parsed).startsWith('`text-sm font-semibold tabular-nums')) insert(node.getStart(parsed) + 1, 'fiscus-entry-amount ');
    if (name.startsWith('StatsSection-') && componentName === 'le' && ts.isTemplateExpression(node) && node.getText(parsed).startsWith('`text-base md:text-lg font-semibold truncate')) insert(node.getStart(parsed) + 1, 'fiscus-stat-amount ');
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  // Expanded by default, with a full-height, safe-area-aware header.
  if (name.startsWith('index-')) {
    const header = source.indexOf('function J2('), next = source.indexOf('function W2(', header);
    const initial = source.slice(header, next);
    const match = /\[x,S\]=T\.useState\(!1\)/.exec(initial);
    if (!match) throw new Error('Recovered header no longer matches the reviewed baseline');
    edits.push({ start: header + match.index, end: header + match.index + match[0].length, content: '[x,S]=T.useState(!0)' });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.content + source.slice(edit.end);
  return source;
}
const assets = {};
for (const [name, source] of Object.entries(sources)) assets[base + '/assets/' + name] = { contentType: name.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', body: name.endsWith('.js') ? patchJavaScript(name, source) : source };
assets[base + '/ui.js'] = { contentType: 'application/javascript; charset=utf-8', body: bridge };
assets[base + '/ui.css'] = { contentType: 'text/css; charset=utf-8', body: css };
let html = await readFile(new URL('index.html', recovered), 'utf8');
html = html.replace(/\/assets\//g, base + '/assets/');
html = html.replace('<script type="module" crossorigin', '<script src="' + base + '/ui.js"></script>\n    <script type="module" crossorigin');
html = html.replace('</head>', '<link rel="stylesheet" href="' + base + '/ui.css">\n  </head>');
html = html.replace('initial-scale=1.0, viewport-fit=cover', 'initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content');
html = html.replace('<meta name="mobile-web-app-capable"', '<meta name="apple-mobile-web-app-capable" content="yes" />\n    <meta name="mobile-web-app-capable"');
await mkdir(new URL('../worker/generated/', import.meta.url), { recursive: true });
await writeFile(new URL('../worker/generated/ui-assets.ts', import.meta.url), '// Generated by scripts/build-ui.mjs from immutable recovered assets and reviewed refinements.\nexport const uiHtml = ' + JSON.stringify(html) + ';\nexport const uiAssets: Record<string, { contentType: string; body: string }> = ' + JSON.stringify(assets) + ';\n');
console.log('Built recovered frontend refinements:', version, Object.keys(assets).length, 'assets');
