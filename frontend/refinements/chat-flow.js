/* Per-message cancellation and stable command IDs preserve financial effects on resend. */
const FiscusChatState = (() => {
  let entries = new Map(); const listeners = new Set();
  const publish = () => { entries = new Map(entries); for (const listener of listeners) listener(entries); };
  return { get entries() { return entries; }, key(scope, username, id) { return JSON.stringify([scope,username,id]); },
    set(key, value) { entries.set(key, value); publish(); },
    finish(key, requestId, phase) { const current=entries.get(key); if(current?.requestId===requestId){entries.set(key,{...current,phase,controller:null});publish();} },
    contextChanged() { for (const [key,entry] of entries) {const [scope,username]=JSON.parse(key);if(scope!==Yi?.scopeId||username!==Yi?.username){entry.controller?.abort();entries.delete(key);}}publish(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
})();
window.addEventListener('fiscus:chat-context-changed',()=>FiscusChatState.contextChanged());
function FiscusMergeMessages(incoming,current,scopeId,username) {
  const map=new Map(incoming.map(message=>[message.id,message]));
  for(const message of current){if(!message.requestId||message.scopeId!==scopeId||message.byId!==username)continue;const remote=map.get(message.id);if(!remote||(message.attemptNo||0)>(remote.attemptNo||0)||message.requestId===remote.requestId)map.set(message.id,message);}
  const cancelled=new Set([...FiscusChatState.entries].filter(([key])=>{const [scope,owner]=JSON.parse(key);return scope===scopeId&&owner===username;}).map(([,entry])=>entry.supersededReplyId).filter(Boolean));
  return [...map.values()].filter(message=>(!cancelled.has(message.id)||(message.replyTo&&map.get(message.replyTo)?.requestId===message.requestId))&&(message.role!=='ai'||!message.replyTo||(!map.has(message.replyTo)||map.get(message.replyTo)?.requestId===message.requestId))).sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id));
}
async function FiscusRunChat(context, text, previous, completedResult) {
  const {account,scopeId,contextRef}=context;
  if (!account || (!context.canWrite && !previous) || !scopeId) return;
  if (previous && previous.byId && previous.byId !== account.username) return;
  const id=previous?.id || crypto.randomUUID(), key=FiscusChatState.key(scopeId,account.username,id);
  const last=FiscusChatState.entries.get(key); last?.controller?.abort();
  const requestId=crypto.randomUUID(), attemptNo=Math.max(previous?.attemptNo || 0,last?.attemptNo || 0)+1;
  const controller=new AbortController();
  const message={...(previous || {}),id,role:'user',content:text,timestamp:previous?.timestamp || Date.now(),by:previous?.by || account.displayName,byId:account.username,clientMutationId:previous?.clientMutationId || id,attemptNo,requestId,scopeId};
  const active=()=>!controller.signal.aborted && FiscusChatState.entries.get(key)?.requestId===requestId && contextRef.current?.scopeId===scopeId && contextRef.current?.username===account.username;
  const setPhase=phase=>{if(active())FiscusChatState.set(key,{...FiscusChatState.entries.get(key),phase});};
  const index=context.messages.findIndex(item=>item.id===id),next=context.messages[index+1];
  const hintedReply=previous&&scopeId===account.scopeId&&next?.role==='ai'&&!next.replyTo?next.id:undefined;
  FiscusChatState.set(key,{requestId,attemptNo,controller,phase:'saving',supersededReplyId:hintedReply});
  context.setMessages(items=>previous ? items.map(item=>item.id===id?message:item).filter(item=>item.replyTo!==id&&item.id!==hintedReply) : [...items,message]);
  const enqueue=async()=>{const queued=(await FiscusLedger.readQueue()).some(entry=>entry.clientMutationId===message.clientMutationId&&entry.username===account.username&&entry.scopeId===scopeId);if(!queued)await n0(text,{idempotencyKey:message.clientMutationId,memberName:account.displayName,memberId:account.username,username:account.username,scopeId,chatMessage:message});context.onQueue(await qi());};
  if (!context.online && !completedResult) {
    try {await enqueue();setPhase('queued');if(!active())return;context.setMessages(items=>[...items,{id:'offline:'+id,role:'ai',replyTo:id,content:'📴 当前离线，已加入待同步队列，联网后自动入账。',timestamp:Date.now()}]);}
    catch {setPhase('error');}
    return;
  }
  context.pendingCounter.current++;context.setLoading(true);
  try {
    const prepared=await ot('/chat/'+encodeURIComponent(scopeId),{...Xt('POST',message),signal:controller.signal});
    if (!prepared?.success) throw new Error('Message could not be saved');
    if (!active())return;
    if(prepared.supersededReplyId){FiscusChatState.set(key,{...FiscusChatState.entries.get(key),supersededReplyId:prepared.supersededReplyId});context.setMessages(items=>items.filter(item=>item.id!==prepared.supersededReplyId));}
    setPhase('waiting');
    const result=completedResult || await ot('/voice-command',{...Xt('POST',{userId:scopeId,input:text,memberName:account.displayName,memberId:account.username,commandId:message.clientMutationId,idempotencyKey:message.clientMutationId,resend:Boolean(previous),readOnlyResend:Boolean(prepared.legacyResend || !context.canWrite)}),timeoutMs:45000,signal:controller.signal}).catch(error=>{if(error.status>=400&&error.status<500&&error.body)return {success:false,needsReview:!error.body.safeToRetry,message:error.body.message||error.body.error||'请求未完成，请检查记录后重试'};throw error;});
    if (!active()) return;
    const reply={id:'reply:'+id,role:'ai',replyTo:id,requestId,attemptNo,content:result.message || '请求未完成，请检查记录后重试',timestamp:message.timestamp+0.1,updatedAt:Date.now(),parsedBy:result.parsedBy,byId:account.username,scopeId,needsReview:Boolean(result.needsReview)};
    if(result.data?.expense)reply.expense={...result.data.expense,explanation:result.data.explanation};
    const saved=await ot('/chat/'+encodeURIComponent(scopeId),{...Xt('POST',reply),signal:controller.signal});
    if (!saved?.success) throw new Error('Reply could not be saved');
    if (!active())return;
    context.setMessages(items=>{const clean=items.filter(item=>item.id!==reply.id&&item.replyTo!==id);let index=clean.findIndex(item=>item.id===id);if(index<0){clean.push(message);index=clean.length-1;}clean.splice(index+1,0,reply);return clean;});
    setPhase(result.needsReview?'review':result.success===false?'error':'done');
    // Refresh ledger data without holding the finished reply behind more network requests.
    Promise.resolve(context.refresh(scopeId)).catch(()=>{});
    Promise.resolve(context.refreshOther()).catch(()=>{});
  } catch(error) {
    if(!active())return;
    if(error.status>=400&&error.status<500){setPhase('review');return;}
    try {await enqueue();setPhase('error');context.setMessages(items=>[...items.filter(item=>item.id!=='error:'+id),{id:'error:'+id,role:'ai',replyTo:id,content:'📴 网络异常，已加入待同步队列，联网后自动入账。',timestamp:Date.now()}]);}
    catch {setPhase('error');}
  } finally {
    FiscusChatState.finish(key,requestId,FiscusChatState.entries.get(key)?.phase==='waiting'?'error':FiscusChatState.entries.get(key)?.phase);
    context.pendingCounter.current=Math.max(0,context.pendingCounter.current-1);context.setLoading(context.pendingCounter.current>0);
  }
}
function FiscusMessageActions({message,children}) {
  const [entries,setEntries]=T.useState(FiscusChatState.entries),[open,setOpen]=T.useState(false),[seconds,setSeconds]=T.useState(0);
  const gesture=T.useRef(null),opener=T.useRef(null),menu=T.useRef(null),t=window.FiscusUI.translate;
  const account=Jo(),scope=Yi?.scopeId || account?.scopeId;
  const own=message.role==='user' && (message.byId===account?.username || (!message.byId && scope===account?.scopeId));
  const key=FiscusChatState.key(scope,account?.username,message.id),entry=entries.get(key);
  const currentEntry=entry?.requestId===message.requestId?entry:null;
  const pending=currentEntry && ['saving','waiting'].includes(entry.phase);
  T.useEffect(()=>FiscusChatState.subscribe(setEntries),[]);
  T.useEffect(()=>{if(!pending)return;setSeconds(0);const start=Date.now(),timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[pending,entry?.requestId]);
  const clear=()=>{if(gesture.current)clearTimeout(gesture.current.timer);gesture.current=null;};
  T.useEffect(()=>()=>clear(),[]);
  T.useEffect(()=>{if(!open)return;opener.current=document.activeElement;menu.current?.querySelector('button')?.focus();const close=event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}const buttons=[...menu.current.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End','Tab'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+((event.key==='ArrowUp'||(event.key==='Tab'&&event.shiftKey))?-1:1)+buttons.length)%buttons.length;buttons[next]?.focus();}};window.addEventListener('keydown',close);return()=>{window.removeEventListener('keydown',close);if(opener.current?.isConnected)opener.current.focus({preventScroll:true});};},[open]);
  const resend=()=>{setOpen(false);window.dispatchEvent(new CustomEvent('fiscus:resend-message',{detail:{message,scopeId:scope,username:account?.username}}));};
  return v.jsxs('div',{className:'fiscus-message-actions'+(own?' fiscus-message-own':''),tabIndex:own?0:undefined,'aria-label':own?t('用户消息，长按可重新发送'):undefined,'aria-haspopup':own?'menu':undefined,
    onPointerDown:event=>{if(!own||event.button!==0||event.target.closest('button,a,input'))return;clear();gesture.current={x:event.clientX,y:event.clientY,timer:setTimeout(()=>{setOpen(true);gesture.current=null;},500)};},
    onPointerMove:event=>{if(gesture.current&&Math.hypot(event.clientX-gesture.current.x,event.clientY-gesture.current.y)>10)clear();},onPointerUp:clear,onPointerCancel:clear,onPointerLeave:clear,
    onContextMenu:event=>{if(own){event.preventDefault();clear();setOpen(true);}},onKeyDown:event=>{if(own&&(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))){event.preventDefault();setOpen(true);}},children:[children,
    own&&currentEntry&&entry.phase!=='done'&&v.jsx('p',{className:'fiscus-chat-request-status',role:'status',children:[t(entry.phase==='saving'?'正在保存消息':entry.phase==='queued'?'已存于此设备':entry.phase==='error'?'需要重试':entry.phase==='review'?'请检查记录后再记账':seconds>=8?'响应较慢，可长按消息重新发送':'正在生成回复') ,pending&&v.jsx('span',{'aria-hidden':true,children:` · ${seconds}s`})]}),
    open&&v.jsx('div',{className:'fiscus-message-menu-backdrop',onPointerDown:event=>{event.stopPropagation();if(event.target===event.currentTarget)setOpen(false);},children:v.jsxs('div',{className:'fiscus-message-menu',role:'menu','aria-label':t('消息操作'),ref:menu,children:[v.jsx('p',{children:t('消息操作')}),v.jsx('button',{type:'button',role:'menuitem',onClick:resend,children:t('重新发送消息')}),v.jsx('p',{className:'fiscus-message-menu-hint',children:t('替换此前的回复，不重复执行已完成的记账操作')}),v.jsx('button',{type:'button',role:'menuitem',onClick:()=>setOpen(false),children:t('关闭')})]})})
  ]});
}
