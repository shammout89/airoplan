// Public session labels scope notifications; they are never authentication tokens.
const channelName='aeroplan.session.v1';
const storageKey='aeroplan.session.event.v1';
const label=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const metadata=value=>value&&typeof value.userId==='string'&&label(value.sessionId);
const notice=value=>metadata(value)&&value.type==='session-ended'&&typeof value.all==='boolean';

function leaveProtectedPage(){
  const message=document.createElement('p');
  message.textContent='انتهت الجلسة، جارٍ الانتقال إلى صفحة الدخول…';
  message.setAttribute('role','status');
  document.body.replaceChildren(message);
  window.location.replace('/auth/login');
}

export function mountSessionSync(){
  let current=null,disposed=false,ended=false,sequence=0,channel=null;
  const controllers=new Set(),busyForms=new WeakSet();
  const exit=()=>{if(disposed||ended)return;ended=true;leaveProtectedPage()};
  try{channel=new BroadcastChannel(channelName)}catch{/* Storage notifications remain available. */}

  async function check(){
    if(disposed||ended)return;
    const generation=++sequence,controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/auth/session',{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(disposed||ended||generation!==sequence)return;
      if(response.status===401){exit();return}
      if(!response.ok)return;
      const next=await response.json();
      if(disposed||ended||generation!==sequence||!metadata(next))return;
      if(current&&(current.sessionId!==next.sessionId||current.userId!==next.userId)){
        // A later sign-in can replace the cookie. Refresh identity without revoking it.
        disposed=true;document.body.replaceChildren();window.location.replace('/');return;
      }
      current=next;
    }catch{/* A network failure is not proof that a session has ended. */}
    finally{clearTimeout(timer);controllers.delete(controller)}
  }

  function receive(value){
    if(!notice(value))return;
    if(!current||value.sessionId===current.sessionId||(value.all&&value.userId===current.userId)){
      // Confirm revocation on the server: stale/forged notices cannot end a valid session.
      void check();
    }
  }
  function publish(value){
    if(!notice(value))return;
    try{channel?.postMessage(value)}catch{/* The local session has still ended. */}
    try{localStorage.setItem(storageKey,JSON.stringify(value))}catch{/* BroadcastChannel may still work. */}
  }
  const onMessage=event=>receive(event.data);
  const onStorage=event=>{if(event.key!==storageKey||!event.newValue)return;try{receive(JSON.parse(event.newValue))}catch{/* Ignore unrelated malformed data. */}};
  const onFocus=()=>{void check()};
  const onVisibility=()=>{if(document.visibilityState==='visible')void check()};
  const onPageShow=event=>{if(event.persisted)void check()};

  async function submit(event){
    const form=event.target;
    if(!form?.matches?.('form[data-auth-action]'))return;
    const action=new URL(form.action,window.location.href);
    if(action.origin!==window.location.origin||!['/auth/logout','/auth/logout-all','/auth/password'].includes(action.pathname))return;
    event.preventDefault();
    if(busyForms.has(form))return;
    busyForms.add(form);
    const buttons=[...form.querySelectorAll('button[type="submit"]')],prior=buttons.map(button=>button.disabled);
    buttons.forEach(button=>{button.disabled=true});form.setAttribute('aria-busy','true');
    let error=form.querySelector('[data-auth-error]');
    if(error)error.remove();
    const controller=new AbortController();controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const body=new URLSearchParams();
      for(const [name,value] of new FormData(form))if(typeof value==='string')body.append(name,value);
      const response=await fetch(action.pathname,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},body,signal:controller.signal});
      if(disposed||ended)return;
      if(response.status===401){exit();return}
      const result=await response.json();
      if(!response.ok||!result.ok||!notice(result.event))throw Error(result.error||'تعذر إتمام العملية؛ أعد المحاولة');
      publish(result.event);exit();
    }catch(e){
      if(disposed||ended)return;
      error=document.createElement('p');error.className='error';error.setAttribute('data-auth-error','');error.setAttribute('role','alert');
      error.textContent=e instanceof Error&&e.name!=='AbortError'?e.message:'تعذر الاتصال بالخادم؛ أعد المحاولة';form.append(error);
    }finally{
      clearTimeout(timer);controllers.delete(controller);busyForms.delete(form);form.removeAttribute('aria-busy');
      buttons.forEach((button,index)=>{button.disabled=prior[index]});
    }
  }
  channel?.addEventListener('message',onMessage);
  window.addEventListener('storage',onStorage);window.addEventListener('focus',onFocus);window.addEventListener('pageshow',onPageShow);
  document.addEventListener('visibilitychange',onVisibility);document.addEventListener('submit',submit,true);
  const interval=setInterval(()=>{if(document.visibilityState==='visible')void check()},15000);
  void check();
  return ()=>{
    disposed=true;sequence++;clearInterval(interval);controllers.forEach(controller=>controller.abort());controllers.clear();
    channel?.removeEventListener('message',onMessage);channel?.close();
    window.removeEventListener('storage',onStorage);window.removeEventListener('focus',onFocus);window.removeEventListener('pageshow',onPageShow);
    document.removeEventListener('visibilitychange',onVisibility);document.removeEventListener('submit',submit,true);
  };
}
