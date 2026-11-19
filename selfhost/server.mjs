import {AuditIntegrity} from './audit-integrity.mjs';
import http from 'node:http';
import {NativeServices} from './services.mjs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {FullBackupManager} from './backup-manager.mjs';
import {SELFHOST_VERSION} from './release.mjs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {startProdServer} from 'vinext/server/prod-server';
import {localRuntime} from './runtime.mjs';
import {migrate,bootstrapWorkspace} from './migrate.mjs';
import {LocalAuth,localRoles} from './auth.mjs';
import {enrollmentMarkup,confirmEnrollmentForm} from './mfa-enrollment.mjs';

const labels={admin:'مدير النظام',planner:'مخطط',reviewer:'مراجع',approver:'معتمد',viewer:'مشاهد'};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(name,label,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" required ${extra}></label>`;
const password=(name,label,autocomplete='new-password')=>input(name,label,'password',`minlength="12" maxlength="128" autocomplete="${autocomplete}"`);
const button=label=>`<button type="submit">${label}</button>`;
const otp=(required=true)=>`<label>رمز تطبيق المصادقة أو رمز الاسترداد<input name="otp" type="text" autocomplete="one-time-code" maxlength="80" ${required?'required':''}></label>`;
function mfaPage(auth,user,{setup,error}={}){
 const state=auth.mfa.state(user.id),owner=auth.owner()?.id===user.id;
 const begin=`<form method="post" action="/auth/mfa/begin">${password('current','كلمة المرور الحالية','current-password')}${button(state.pending?'بدء ربط جديد واستبدال المفتاح السابق':'بدء ربط تطبيق المصادقة')}</form>`;
 let body;
 if(setup)body=enrollmentMarkup(setup);
 else if(state.enabled)body=`<p>رموز الاسترداد المتبقية: ${state.recoveryRemaining}</p><form method="post" action="/auth/mfa/recovery">${password('current','كلمة المرور الحالية','current-password')}${otp()}${button('استبدال رموز الاسترداد وإنهاء الجلسات')}</form>${auth.requiresMFA(user.id)?'<p>سياسة دورك تلزم المصادقة الإضافية.</p>':`<form method="post" action="/auth/mfa/disable">${password('current','كلمة المرور الحالية','current-password')}${otp()}${button('تعطيل المصادقة وإنهاء الجلسات')}</form>`}`;
 else if(state.pending)body=`<p>طلب الربط الحالي ما زال صالحًا. أدخل رمز الحساب الذي أضفته إلى تطبيق المصادقة؛ لم يتغيّر المفتاح بسبب المحاولة المرفوضة.</p>${confirmEnrollmentForm()}<details class="mfa-manual"><summary>مسح رمز QR جديد بدل الطلب الحالي</summary><p>بدء ربط جديد يستبدل المفتاح السابق. بعده امسح رمز QR الجديد في التطبيق.</p>${begin}</details>`;
 else body=begin;
 return page('المصادقة الإضافية',`<nav><a href="/auth/account">حسابي</a><a href="/">النظام</a></nav><section><h2>${state.enabled?'مفعلة':'ربط تطبيق مصادقة'}</h2><p>رمز متغير كل 30 ثانية. الرمز المقبول يستخدم مرة واحدة. احفظ رموز الاسترداد في مكان آمن منفصل.</p>${body}</section>${owner&&state.enabled?`<section><h2>سياسة المصادقة لأدوار الفريق</h2><form method="post" action="/auth/mfa/policy">${localRoles.map(role=>`<label><span>${escape(labels[role])}</span><input type="checkbox" name="role_${role}" value="1" ${auth.mfaRoles().includes(role)?'checked':''}></label>`).join('')}${password('current','كلمة المرور الحالية','current-password')}${otp()}${button('حفظ سياسة الأدوار')}</form></section>`:''}`,error||'',true);
}
function page(title,content,error='',authenticated=false){
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · AeroPlan</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#15253d;font:16px/1.8 system-ui,sans-serif}main{max-width:920px;margin:5vh auto;padding:28px}.brand{font-size:26px;font-weight:800;color:#12584b}h1{font-size:25px;margin:8px 0 20px}h2{font-size:19px}section{background:white;border:1px solid #dce5eb;border-radius:16px;padding:24px;margin:18px 0}form{display:grid;gap:15px;max-width:490px}label{display:grid;gap:5px;font-weight:600}input,select,button{font:inherit;border:1px solid #bccbd6;border-radius:8px;padding:10px;min-width:0}input{direction:ltr;text-align:start;width:100%}input[name=name]{direction:rtl}button{background:#12584b;color:white;border:0;cursor:pointer}a{color:#126655}nav{display:flex;gap:20px;flex-wrap:wrap}.auth-actions{display:flex;gap:12px;flex-wrap:wrap}summary{cursor:pointer;font-weight:700}.muted{color:#5c6b7e;font-size:14px}.error{background:#fff0ef;color:#9c2b20;padding:12px;border-radius:8px}.success{background:#edf9f2;border:1px solid #b5deca;padding:16px;border-radius:10px;overflow-wrap:anywhere}.link{direction:ltr;text-align:left;display:block;word-break:break-all}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:right;border-bottom:1px solid #e0e8ee;padding:10px}td form{display:block}td button{padding:6px 10px;font-size:13px}.table{overflow:auto}@media(max-width:600px){main{padding:16px;margin:0}section{padding:18px}}.mfa-scan{margin:20px 0;text-align:center;max-width:340px}.mfa-qr{display:block;width:320px;max-width:100%;height:auto;background:white;margin:0 auto}.mfa-scan figcaption{font-size:14px;color:#5c6b7e;margin:10px 0}.mfa-manual{margin:20px 0;padding:14px;border:1px solid #dce5eb;border-radius:10px}.mfa-manual strong{overflow-wrap:anywhere}:focus-visible{outline:3px solid #3187cc;outline-offset:3px}
  </style><main><div class="brand" dir="ltr">AeroPlan</div><h1>${escape(title)}</h1>${error?`<p class="error" role="alert">${escape(error)}</p>`:''}${content}<p class="muted">تخطيط صيانة الطائرات · النسخة المحلية ${SELFHOST_VERSION}</p></main>${authenticated?'<script type="module" src="/auth/session-page.js"></script>':''}</html>`;
}
const loginPage=error=>page('تسجيل الدخول',`<section><form method="post" action="/auth/login">${input('email','البريد الإلكتروني','email','maxlength="200" autocomplete="username"')}${password('password','كلمة المرور','current-password')}${otp(false)}${button('دخول النظام')}</form></section><p class="muted">يُنشئ مالك المساحة حسابات الدخول من الإعدادات ← المستخدمون والصلاحيات.</p>`,error);
const activatePage=(token,error)=>page('تفعيل الحساب',`<section><p>اختر كلمة مرور لحسابك. رابط التفعيل صالح لمرة واحدة ولمدة 24 ساعة.</p><form method="post" action="/auth/activate"><input type="hidden" name="token" value="${escape(token)}">${password('password','كلمة المرور')}${password('confirm','تأكيد كلمة المرور')}${button('تفعيل الحساب')}</form></section><a href="/auth/login">العودة لتسجيل الدخول</a>`,error);
const accountPage=(user,isOwner,error)=>page('حسابي',`
<nav><a href="/">العودة للنظام</a><a href="/auth/mfa">المصادقة الإضافية</a>${isOwner?'<a href="/?settings=team">المستخدمون والصلاحيات</a><a href="/auth/audit">فحص التدقيق الموقع</a>':''}</nav>
<section><h2>بيانات الحساب</h2><p>${escape(user.name)} · <span dir="ltr">${escape(user.email)}</span></p></section>
<section><h2>الجلسات</h2><p class="muted">الخروج العادي ينهي الجلسة الحالية في تبويبات هذا المتصفح. خيار جميع الأجهزة ينهي كل جلسات حسابك، ويتطلب تسجيل الدخول مجددًا.</p><div class="auth-actions">
<form method="post" action="/auth/logout" data-auth-action="logout">${button('تسجيل الخروج')}</form>
<form method="post" action="/auth/logout-all" data-auth-action="logout-all">${button('تسجيل الخروج من جميع الأجهزة')}</form>
</div></section>
<section><details${error?' open':''}><summary>تغيير كلمة المرور</summary><p class="muted">اختياري. حفظ كلمة مرور جديدة ينهي جميع جلسات حسابك.</p><form method="post" action="/auth/password" data-auth-action="password">${password('current','كلمة المرور الحالية','current-password')}${password('password','كلمة المرور الجديدة')}${password('confirm','تأكيد كلمة المرور الجديدة')}${button('حفظ كلمة المرور وإنهاء جميع الجلسات')}</form></details></section>`,error,true);
async function formData(req){
  if(!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))throw Error('نوع طلب غير صالح');
  const parts=[];let size=0;
  for await(const part of req){size+=part.length;if(size>16384)throw Error('الطلب أكبر من الحد المسموح');parts.push(part)}
  const form=new URLSearchParams(Buffer.concat(parts).toString('utf8'));
  if([...form.keys()].some(k=>form.getAll(k).length!==1))throw Error('قيم مكررة غير مسموحة');
  return Object.fromEntries(form);
}
function headers(res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-AeroPlan-Release',SELFHOST_VERSION);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  // Native form POSTs use Origin: null under no-referrer. Keep same-origin
  // form origins intact without sending referrers to other sites.
  res.setHeader('Referrer-Policy','same-origin');
}
function html(res,status,body){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(body)}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))}
function redirect(res,to){res.writeHead(303,{Location:to});res.end()}
function matchingPasswords(form){if(form.password!==form.confirm)throw Error('كلمتا المرور غير متطابقتين');return form.password}

export async function startServer(options={}){
  process.umask(0o077);
  // Forwarded headers are never a source of identity, URL, or TLS trust.
  process.env.VINEXT_TRUST_PROXY='false';
  const runtime=options.runtime||localRuntime(),{db}=runtime;
  runtime.serviceToken=randomBytes(32).toString('base64url');
  const build=JSON.parse(await readFile(path.resolve(options.outDir||'dist-node','build-fingerprint.json'),'utf8'));if(!/^[a-f0-9]{64}$/.test(build.fingerprint))throw Error('Invalid build provenance; rebuild the application');runtime.buildFingerprint=build.fingerprint;
  await migrate(db,options.root||process.cwd());
  const backups=await new FullBackupManager(runtime,options.backup||{}).initialize();
  const auth=new LocalAuth(db);runtime.auth=auth;
  await bootstrapWorkspace(db,auth.owner());const auditIntegrity=db.auditIntegrity||new AuditIntegrity(db,{initialize:true});
  const publicURL=new URL(options.publicURL||process.env.PUBLIC_URL||'http://localhost:8080');
  if(!['http:','https:'].includes(publicURL.protocol)||publicURL.pathname!=='/'||publicURL.search||publicURL.hash||publicURL.username||publicURL.password)throw Error('PUBLIC_URL must be an http(s) origin without a path or credentials');
  runtime.publicOrigin=publicURL.origin;
  const cookie=token=>`aeroplan_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?28800:0}${publicURL.protocol==='https:'?'; Secure':''}`;
  const wantsJSON=req=>String(req.headers.accept||'').includes('application/json');
  const finishLogout=(req,res,session,all)=>{
    res.setHeader('Set-Cookie',cookie(''));
    if(wantsJSON(req))json(res,200,{ok:true,event:{type:'session-ended',userId:session.user.id,sessionId:session.scope,all,eventId:randomUUID(),at:Date.now()}});
    else redirect(res,'/auth/login');
  };
  const sessionAssets=new Map(await Promise.all([
    ['/auth/session-sync.js','./session-sync.mjs'],
    ['/auth/session-page.js','./session-page.mjs'],
  ].map(async([url,file])=>[url,await readFile(new URL(file,import.meta.url),'utf8')])));
  // Reuse Vinext's production request listener, then close its temporary loopback socket.
  // Only the authenticated gateway below remains listening; there is no bypass port.
  const native=await startProdServer({port:0,host:'127.0.0.1',outDir:path.resolve(options.outDir||'dist-node'),silent:true});
  const listeners=native.server.listeners('request');
  await new Promise((resolve,reject)=>native.server.close(e=>e?reject(e):resolve()));
  if(listeners.length!==1)throw Error('Unsupported Vinext production request listener');
  const framework=listeners[0];let expensive=0;
  runtime.withPasswordOperation=async operation=>{if(expensive>=2)throw Object.assign(Error('الخادم مشغول؛ أعد المحاولة'),{status:429});expensive++;try{return await operation()}finally{expensive--}};
  const metrics={startedAt:new Date().toISOString(),requests:0,active:0,errors:0,statuses:{},durations:[]};let services;
  const sameSecret=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
  const serviceRequest=async body=>{const control=db.sqlite.prepare("SELECT epoch FROM recovery_control WHERE workspace_id='maintenance-department'").get(),payload=Buffer.from(JSON.stringify(body));return await new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/system-service',method:'POST',headers:{Host:publicURL.host,Origin:publicURL.origin,Authorization:'Bearer '+runtime.serviceToken,'Content-Type':'application/json','Content-Length':payload.length,'X-AeroPlan-Epoch':control?.epoch||'initial'}},res=>{const parts=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024){res.destroy(Error('Service response too large'));return}parts.push(chunk)});res.on('error',reject);res.on('end',()=>{try{const j=JSON.parse(Buffer.concat(parts).toString('utf8'));if(res.statusCode!==200)throw Error(j.error||'Service request failed');resolve(j)}catch(e){reject(e)}})});r.setTimeout(120000,()=>r.destroy(Error('Service request timeout')));r.on('error',reject);r.end(payload)})};
  const server=http.createServer(async(req,res)=>{
    headers(res);
    if(publicURL.protocol==='https:')res.setHeader('Strict-Transport-Security','max-age=31536000');
    const started=performance.now();metrics.requests++;metrics.active++;res.once('finish',()=>{const ms=performance.now()-started;metrics.active--;metrics.statuses[res.statusCode]=(metrics.statuses[res.statusCode]||0)+1;if(res.statusCode>=500)metrics.errors++;metrics.durations.push(ms);if(metrics.durations.length>512)metrics.durations.shift();if(options.requestLogging!==false&&process.env.AEROPLAN_REQUEST_LOG==='true'){const route=String(req.url||'').split('?')[0];console.log(JSON.stringify({event:'request',requestId:randomUUID(),method:req.method,route:route.startsWith('/api/')?route:'/auth-or-page',status:res.statusCode,durationMs:Math.round(ms)}))}});
    try{
      if(req.headers.host?.toLowerCase()!==publicURL.host.toLowerCase()){json(res,421,{error:'عنوان الخادم لا يطابق PUBLIC_URL'});return}
      const url=new URL(req.url,publicURL);
      if(url.origin!==publicURL.origin){json(res,400,{error:'عنوان طلب غير صالح'});return}
      const read=['GET','HEAD'].includes(req.method);
      if(!read&&req.headers.origin!==publicURL.origin){json(res,403,{error:'مصدر الطلب غير مسموح'});return}
      if(Number(req.headers['content-length']||0)>12*1024*1024){json(res,413,{error:'الطلب أكبر من الحد المسموح'});return}
      if(url.pathname==='/healthz'&&read){
        db.sqlite.prepare('SELECT 1').get();json(res,auth.owner()?200:503,{status:auth.owner()?'ok':'initialization_required',version:SELFHOST_VERSION,buildFingerprint:runtime.buildFingerprint,backups:backups.health()});return;
      }
      if(url.pathname==='/readyz'&&read){let ready=true;try{db.sqlite.prepare('SELECT 1').get();const mode=db.sqlite.prepare("SELECT mode FROM recovery_control WHERE workspace_id='maintenance-department'").get()?.mode;if(mode&&mode!=='open'||auditIntegrity.lastError)ready=false}catch{ready=false}json(res,ready&&auth.owner()?200:503,{status:ready&&auth.owner()?'ready':'not_ready',version:SELFHOST_VERSION});return}
      if(url.pathname==='/api/system-service'){
        const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if(!loopback||req.method!=='POST'||!sameSecret(req.headers.authorization,'Bearer '+runtime.serviceToken)){json(res,404,{error:'المسار غير موجود'});return}
        for(const name of Object.keys(req.headers))if(name.startsWith('oai-')||name.startsWith('x-oai-')||name.startsWith('x-forwarded-')||name==='forwarded'||name.startsWith('x-vinext-'))delete req.headers[name];
        req.headers.origin='http://'+publicURL.host;framework.call(native.server,req,res);return;
      }
      if(read&&sessionAssets.has(url.pathname)){res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});res.end(sessionAssets.get(url.pathname));return}
      if(!auth.owner()){html(res,503,page('تهيئة المدير مطلوبة','<section><p>شغّل الأمر التالي من طرفية الخادم لإنشاء المدير، ثم أعد تشغيل الخدمة:</p><pre dir="ltr">docker compose run --rm app node selfhost/admin.mjs init</pre></section>'));return}
      const session=auth.session(req.headers.cookie),user=session?.user;if(user&&auth.requiresMFA(user.id)&&!auth.mfa.state(user.id).enabled&&!url.pathname.startsWith('/auth/')){if(url.pathname.startsWith('/api/'))json(res,403,{error:'دورك يتطلب تفعيل المصادقة الإضافية',setupURL:'/auth/mfa'});else redirect(res,'/auth/mfa');return}
      if(url.pathname==='/api/local-audit'){if(!user||user.id!==auth.owner().id){json(res,user?403:401,{error:'فحص وتصدير التدقيق متاحان للمالك'});return}if(!read){json(res,405,{error:'الفحص يتطلب GET'});return}try{if(url.searchParams.get('format')==='export'){res.setHeader('Content-Disposition','attachment; filename=\"AeroPlan-signed-audit.json\"');json(res,200,auditIntegrity.export())}else json(res,200,auditIntegrity.verify())}catch(e){json(res,409,{valid:false,error:e.message})}return}
      if(url.pathname==='/api/local-services'||url.pathname==='/api/local-metrics'){
        if(!user){json(res,401,{error:'يلزم تسجيل الدخول'});return}if(user.id!==auth.owner().id){json(res,403,{error:'إدارة التشغيل متاحة للمالك فقط'});return}
        if(url.pathname==='/api/local-metrics'){if(!read){json(res,405,{error:'طريقة غير مسموحة'});return}const values=[...metrics.durations].sort((a,b)=>a-b),p=q=>values[Math.min(values.length-1,Math.floor(values.length*q))]||0;json(res,200,{version:SELFHOST_VERSION,startedAt:metrics.startedAt,requests:metrics.requests,active:metrics.active,errors:metrics.errors,statuses:metrics.statuses,latencyMs:{p50:Math.round(p(.5)),p95:Math.round(p(.95)),sampleCount:values.length},memory:{rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed},database:{bytes:db.sqlite.prepare('PRAGMA page_count').get().page_count*db.sqlite.prepare('PRAGMA page_size').get().page_size},backups:backups.health(),services:services.status().configured});return}
        if(read){try{const offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0));json(res,200,{...services.status(),journal:await serviceRequest({action:'status',offset,limit:100})})}catch(e){json(res,503,{error:'تعذر قراءة حالة الخدمات المحلية: '+String(e.message).slice(0,200)})}return}
        if(req.method!=='POST'){json(res,405,{error:'طريقة غير مسموحة'});return}
        try{let text='';for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>32768)throw Error('الطلب كبير')}const b=JSON.parse(text);let result;if(b.action==='configure')result=services.configure(b.policy,user.id);else if(b.action==='reload')result=await services.reload();else if(b.action==='resume')result=await services.resume(b.reason,user.id);else result=await services.execute(b.action,{...b,actor:user.id,to:user.email});json(res,200,{result});}catch(e){json(res,409,{error:e.message})}return;
      }
      if(url.pathname==='/api/local-backups/health'){if(!user){json(res,401,{error:'يلزم تسجيل الدخول'});return}if(!read){json(res,405,{error:'طريقة غير مسموحة'});return}json(res,200,backups.health());return}
      if(url.pathname==='/api/local-backups'){
        if(!user){json(res,401,{error:'يلزم تسجيل الدخول'});return}if(user.id!==auth.owner().id){json(res,403,{error:'إدارة النسخ الكاملة متاحة للمالك فقط'});return}
        if(read){json(res,200,await backups.status());return}if(req.method!=='POST'){json(res,405,{error:'طريقة غير مسموحة'});return}
        try{let text='';for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>8192)throw Error('الطلب كبير')}const b=JSON.parse(text);if(b.action==='configure')json(res,200,await backups.configure(b.policy));else if(b.action==='cancel')json(res,200,backups.cancel());else json(res,202,await backups.run(b.action,b.archiveName,user.id));}catch(e){json(res,409,{error:e.message})}return;
      }
      if(url.pathname.startsWith('/auth/')){
        if(read){
          if(['/auth/logout','/auth/logout-all','/auth/password'].includes(url.pathname)){res.setHeader('Allow','POST');json(res,405,{error:'هذا الإجراء يتطلب POST'});return}
          if(url.pathname==='/auth/session'){if(!user)json(res,401,{error:'يلزم تسجيل الدخول'});else json(res,200,{userId:user.id,sessionId:session.scope});return}
          if(url.pathname==='/auth/login'){if(user)redirect(res,'/');else html(res,200,loginPage());return}
          if(url.pathname==='/auth/activate'){html(res,200,activatePage(url.searchParams.get('token')||''));return}
          if(!user){redirect(res,'/auth/login');return}
          if(url.pathname==='/auth/audit'){if(user.id!==auth.owner().id){json(res,403,{error:'فحص التوقيع متاح للمالك'});return}try{const v=auditIntegrity.verify();html(res,200,page('سلامة سجل التدقيق',`<nav><a href="/auth/account">حسابي</a></nav><section><h2>اجتاز التحقق</h2><p>عدد الأحداث الموقعة: ${v.events}</p><p>وقت الفحص: ${escape(v.checkedAt)}</p><p>بصمة مفتاح التحقق:</p><p dir="ltr">${escape(v.anchor.keyId)}</p><p>يبدأ إثبات السلسلة من وقت تهيئة التوقيع. احتفظ بالبصمة وتصدير موقع في مكان مستقل لمراجعة السجل لاحقًا.</p><a href="/api/local-audit?format=export">تنزيل سجل موقع قابل للتحقق المستقل</a></section>`,undefined,true))}catch(e){html(res,409,page('فشل تحقق التدقيق','<section><p>توقف عن اعتماد هذا السجل حتى معالجة نتيجة الفحص.</p></section>',e.message,true))}return}if(url.pathname==='/auth/mfa'){html(res,200,mfaPage(auth,user));return}if(url.pathname==='/auth/account'){html(res,200,accountPage(user,user.id===auth.owner().id));return}
          if(url.pathname==='/auth/admin'){if(user.id!==auth.owner().id){json(res,403,{error:'إدارة الحسابات متاحة لمالك المساحة فقط'});return}redirect(res,'/?settings=team');return}
          json(res,404,{error:'المسار غير موجود'});return;
        }
        if(req.method!=='POST'){json(res,405,{error:'طريقة غير مسموحة'});return}
        const form=await formData(req);
        if(url.pathname.startsWith('/auth/mfa/')){
          if(!user){json(res,401,{error:'يلزم تسجيل الدخول'});return}
          if(publicURL.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(publicURL.hostname)){json(res,409,{error:'ربط المصادقة يتطلب HTTPS أو بيئة محلية'});return}
          if(expensive>=2){json(res,429,{error:'الخادم مشغول؛ أعد المحاولة'});return}expensive++;
          try{
            if(url.pathname==='/auth/mfa/begin'){const setup=await auth.beginMFA(user,form.current);html(res,200,mfaPage(auth,user,{setup}));return}
            if(['/auth/mfa/enable','/auth/mfa/recovery'].includes(url.pathname)){const codes=url.pathname.endsWith('/enable')?auth.enableMFA(user,form.otp):await auth.rotateMFARecovery(user,form.current,form.otp);res.setHeader('Set-Cookie',cookie(''));html(res,200,page('حُفظت رموز الاسترداد',`<section><p>حُفظت الرموز الجديدة وأُنهيت جميع الجلسات. تظهر رموز الاسترداد هذه مرة واحدة؛ كل رمز صالح لاستخدام واحد.</p><pre dir="ltr">${codes.map(escape).join('\n')}</pre><a href="/auth/login">تسجيل الدخول بالرمز التالي من التطبيق</a></section>`));return}
            if(url.pathname==='/auth/mfa/disable'){await auth.disableMFA(user,form.current,form.otp);finishLogout(req,res,session,true);return}
            if(url.pathname==='/auth/mfa/policy'){auth.requireOwner(user);await auth.proveMFA(user,form.current,form.otp);auth.setMFAPolicy(user,localRoles.filter(role=>form['role_'+role]==='1'));html(res,200,mfaPage(auth,user));return}
            json(res,404,{error:'الإجراء غير موجود'});return;
          }catch(e){html(res,400,mfaPage(auth,user,{error:e.message}));return}finally{expensive--}
        }
        if(url.pathname==='/auth/login'||url.pathname==='/auth/activate'||url.pathname==='/auth/password'){
          // Bound memory use for password hashing instead of admitting an unbounded queue.
          if(expensive>=2){json(res,429,{error:'الخادم مشغول؛ أعد المحاولة بعد قليل'});return}
          expensive++;
          try{
            if(url.pathname==='/auth/login'){
              const signed=await auth.login(form.email,form.password,req.socket.remoteAddress||'local',form.otp);
              if(!signed){html(res,401,loginPage('بيانات الدخول غير صحيحة أو العضوية غير مفعّلة'));return}
              res.setHeader('Set-Cookie',cookie(signed.token));redirect(res,signed.needsMFASetup?'/auth/mfa':'/');return;
            }
            if(url.pathname==='/auth/activate'){
              await auth.activate(form.token,matchingPasswords(form));
              html(res,200,page('تم تفعيل الحساب','<section><a href="/auth/login">انتقل لتسجيل الدخول</a></section>'));return;
            }
            if(!user){json(res,401,{error:'يلزم تسجيل الدخول'});return}
            await auth.changePassword(user,form.current,matchingPasswords(form));
            finishLogout(req,res,session,true);return;
          }catch(e){
            if(wantsJSON(req))json(res,400,{error:e.message});
            else if(url.pathname==='/auth/login')html(res,400,loginPage(e.message));
            else if(url.pathname==='/auth/activate')html(res,400,activatePage(form.token,e.message));
            else html(res,400,accountPage(user,user?.id===auth.owner().id,e.message));
            return;
          }finally{expensive--}
        }
        if(!user){json(res,401,{error:'يلزم تسجيل الدخول'});return}
        if(url.pathname==='/auth/logout'||url.pathname==='/auth/logout-all'){const all=url.pathname==='/auth/logout-all';if(all)auth.logoutAll(user.id);else auth.logout(session.tokenHash);finishLogout(req,res,session,all);return}
        if(['/auth/admin/create','/auth/admin/invite','/auth/admin/reset'].includes(url.pathname)){if(user.id!==auth.owner().id){json(res,403,{error:'إدارة الحسابات متاحة لمالك المساحة فقط'});return}redirect(res,'/?settings=team');return}
        json(res,404,{error:'المسار غير موجود'});return;
      }
      if(!user){if(url.pathname.startsWith('/api/'))json(res,401,{error:'يلزم تسجيل الدخول'});else redirect(res,'/auth/login');return}
      for(const name of Object.keys(req.headers))if(name.startsWith('oai-')||name.startsWith('x-oai-')||name.startsWith('x-forwarded-')||name==='forwarded'||name.startsWith('x-vinext-'))delete req.headers[name];
      req.headers['oai-authenticated-user-id']=user.id;
      req.headers['oai-authenticated-user-email']=user.email;
      // Origin was checked against PUBLIC_URL above. Internal Node requests use http.
      if(!read)req.headers.origin='http://'+publicURL.host;
      framework.call(native.server,req,res);
    }catch(e){console.error('[aeroplan] Request failed:',e.message);if(!res.headersSent)json(res,400,{error:'تعذر إتمام الطلب'});else res.end()}
  });
  server.requestTimeout=60000;server.headersTimeout=15000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
  server.on('clientError',(_e,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')});
  const port=Number(options.port??process.env.PORT??3000),host=options.host||process.env.HOST||'0.0.0.0';
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve)});
  runtime.backups=backups;
  services=new NativeServices(runtime,{...options.services,request:serviceRequest,backupHealth:()=>backups.health()});await services.reload();
  backups.start();services.start();
  const close=async()=>{await services.stop();await backups.stop();return new Promise((resolve,reject)=>server.close(e=>{if(e){reject(e);return}db.close();resolve()}));};
  return {server,auth,backups,services,port:server.address().port,close};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const app=await startServer();
  console.log(`AeroPlan is listening on port ${app.port}. Public URL: ${process.env.PUBLIC_URL||'http://localhost:8080'}. Docker release: ${SELFHOST_VERSION}`);
  let stopping=false;
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(stopping)return;stopping=true;app.close().then(()=>process.exit(0)).catch(()=>process.exit(1));setTimeout(()=>process.exit(1),15000).unref()});
}
