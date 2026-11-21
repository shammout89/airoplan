// Real React components and API/SQLite. DOM simulation is not browser/Windows acceptance.
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {build} from 'esbuild';
import {readFile,readdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {fixture} from './controlled-fixture.mjs';
const f=await fixture(),dom=new JSDOM('<!doctype html><html lang="ar" dir="rtl"><head></head><body><div id="root"></div></body></html>',{url:'https://test.local/',pretendToBeVisual:true}),win=dom.window;
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLAnchorElement','Element','Node','Text','Document','Event','EventTarget','MouseEvent','KeyboardEvent','FocusEvent','InputEvent','PointerEvent','MutationObserver','AbortController','AbortSignal'])Object.defineProperty(globalThis,name,{value:name==='window'?win:name==='document'?win.document:win[name],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=win.getComputedStyle.bind(win);
const cssDir='dist-node/client/_next/static/css',css=(await Promise.all((await readdir(cssDir)).filter(n=>n.endsWith('.css')).map(n=>readFile(cssDir+'/'+n,'utf8')))).join('\n'),style=win.document.createElement('style');style.textContent=css;win.document.head.appendChild(style);
const bindings={name:'bindings',setup(b){b.onResolve({filter:/^(next\/headers|cloudflare:workers)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/headers'?'export async function headers(){return globalThis.__headers}':'export const env=globalThis.__env',loader:'js'}))}};
await build({stdin:{contents:"export {GET as readCompany,POST as saveCompany} from './app/api/company/route';export {GET as readData} from './app/api/data/route';export {GET as readSettings} from './app/api/settings/route';export {GET as readReferences} from './app/api/aircraft-references/route';export {GET as readPrograms} from './app/api/programs/route';",resolveDir:process.cwd(),loader:'ts'},outfile:'.sites-runtime/customer-ui-api.mjs',bundle:true,platform:'node',format:'esm',plugins:[bindings]});
await build({stdin:{contents:"export {default as Page} from './app/page';export {default as CompanySetup} from './app/components/CompanySetup';export {default as DataExport} from './app/components/DataExport';export {permittedSettings} from './lib/settings-navigation';",resolveDir:process.cwd(),loader:'tsx'},outfile:'.sites-runtime/customer-ui.mjs',bundle:true,platform:'node',format:'esm',external:['react','react-dom'],jsx:'automatic',banner:{js:"import {createRequire as __customerCreateRequire} from 'node:module';const require=__customerCreateRequire(import.meta.url);"}});
const api=await import('../.sites-runtime/customer-ui-api.mjs'),{Page,CompanySetup,DataExport,permittedSettings}=await import('../.sites-runtime/customer-ui.mjs'),{createRoot}=await import('react-dom/client'),{getByRole,getByLabelText,getByPlaceholderText,queryByRole,fireEvent,waitFor}=await import('@testing-library/dom'),{default:userEvent}=await import('@testing-library/user-event');
const root=createRoot(win.document.getElementById('root')),user=userEvent.setup({document:win.document,delay:null});
let checks=0,posts=0,changes=0,hold=null,releaseHold=null,getFailure=false,workspaceHold=null,releaseWorkspace=null,actor='owner',navigation=[],blob,filename;
const writes=[],eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++},ok=(value,message)=>{assert(value,message);checks++};
const headers=()=>{globalThis.__headers=new Headers({'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test'})};
async function route(body){headers();return api[body?'saveCompany':'readCompany'](new Request('https://test.local/api/company',{method:body?'POST':'GET',headers:{origin:'https://test.local','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}))}
globalThis.fetch=async(url,init={})=>{assert.equal(new URL(String(url),'https://test.local').pathname,'/api/company');if(init.method==='POST'){posts++;if(hold)await hold;const body=JSON.parse(init.body),r=await route(body);writes.push({body,status:r.status});return r}if(getFailure)return Response.json({error:'SYNTHETIC network read failure'},{status:503});return route()};
const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;URL.createObjectURL=value=>{blob=value;return 'blob:synthetic-view-export'};URL.revokeObjectURL=()=>{};win.HTMLAnchorElement.prototype.click=function(){filename=this.download};
async function settled(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20))})}
async function click(el){await act(async()=>user.click(el));await settled()}
async function change(label,value){await act(async()=>fireEvent.change(getByLabelText(win.document.body,label,{exact:true}),{target:{value}}))}
const button=name=>getByRole(win.document.body,'button',{name,exact:true});
try{
 eq(permittedSettings({isOwner:true,permissions:[]}).some(s=>s.id==='company'),true);eq(permittedSettings({isOwner:false,permissions:['configure','manage_members']}).some(s=>s.id==='company'),false);
 getFailure=true;await act(async()=>root.render(React.createElement(CompanySetup,{onChanged:async()=>{changes++},onNavigate:target=>navigation.push(target)})));await settled();ok(getByRole(win.document.body,'alert').textContent.includes('SYNTHETIC network read failure'));
 getFailure=false;await click(button('إعادة المحاولة'));ok(getByRole(win.document.body,'heading',{name:'خطوات بدء الاستخدام'}));eq(win.document.querySelectorAll('.company-step').length,6);eq(getByLabelText(win.document.body,'اسم الشركة').value,'');ok(win.document.body.textContent.includes('حفظ بيانات الشركة لا يمثل قبولًا تشغيليًا'));
 await click(button('حفظ بيانات الشركة'));eq(posts,0,'Native required validation must prevent an empty company');
 await change('اسم الشركة','SYN Airline UI');await change('اسم القسم','SYN UI Planning');await change('مرجع بيانات الشركة — اختياري','SYN UI SOURCE');
 hold=new Promise(resolve=>{releaseHold=resolve});await act(async()=>user.click(button('حفظ بيانات الشركة')));eq(button('جارٍ الحفظ…').disabled,true);eq(getByLabelText(win.document.body,'اسم الشركة').matches(':disabled'),true);eq(posts,1);
 await act(async()=>{releaseHold();hold=null});await settled();await waitFor(()=>assert.equal(writes.length,1));eq(writes[0].status,200);eq(changes,1);eq(getByLabelText(win.document.body,'اسم الشركة').value,'SYN Airline UI');eq(getByLabelText(win.document.body,'سبب الحفظ أو التغيير').value,'');ok(win.document.body.textContent.includes('حُفظت بيانات الشركة'));
 const stored=await f.db.prepare("SELECT name FROM workspaces WHERE id=?").bind(f.scope).first();eq(stored.name,'SYN Airline UI');eq(win.document.querySelectorAll('tbody tr').length,1);
 // An independent request changes the head. The stale form keeps its unsaved text.
 const current=await (await route()).json();await route({data:{...current.profile,companyName:'SYN Parallel Owner',changeReason:'SYN parallel update'},expectedVersion:current.versionId});
 await change('اسم الشركة','SYN Unsaved Owner');await change('سبب الحفظ أو التغيير','SYN intended revision');await click(button('حفظ بيانات الشركة'));eq(writes.at(-1).status,409);eq(getByLabelText(win.document.body,'اسم الشركة').value,'SYN Unsaved Owner');eq(getByLabelText(win.document.body,'سبب الحفظ أو التغيير').value,'SYN intended revision');ok(getByRole(win.document.body,'alert').textContent.includes('تغيرت بيانات الشركة'));
 await click(button('تحميل آخر نسخة — يستبدل المدخلات الحالية'));eq(getByLabelText(win.document.body,'اسم الشركة').value,'SYN Parallel Owner');eq(win.document.querySelectorAll('tbody tr').length,2);
 await click(button('فتح الأسطول'));await click(button('سياسة الاعتماد'));await click(button('النسخ والاستعادة'));eq(navigation,['aircraft','policy','recovery']);
 eq(getComputedStyle(win.document.querySelector('.company-step-grid')).display,'grid');ok(css.includes('.company-step-grid'));ok(css.includes('760px')||css.includes('47.5rem'));
 for(let i=0;i<53;i++)await f.call('planner','data',{kind:'task',data:{name:'SYN UI export '+i,reference:'SYN-UI-EXPORT-'+i,aircraftId:f.planeId,date:'',hours:1200,cycles:'',status:'open'}});
 actor='owner';headers();const r=await api.readData(new Request('https://test.local/api/data?view=workspace&page=1')),page=await r.json();eq(page.paging.total,53);
 const props={records:page.records,context:{view:'task',page:1,query:'',status:'all',totalTasks:53,matchingTasks:53},isOwner:true,onFullBackup:()=>navigation.push('full-backup')};
 await act(async()=>root.render(React.createElement(DataExport,props)));await click(button('تصدير البيانات'));const region=getByRole(win.document.body,'region',{name:'خيارات تصدير البيانات'});ok(region.textContent.includes('50 مهمة من إجمالي 53'));ok(region.textContent.includes('لا يستخدم للاستعادة'));ok(button('فتح النسخ الكاملة مع المرفقات'));
 await click(button('تنزيل بيانات العرض الحالي'));eq(queryByRole(win.document.body,'region',{name:'خيارات تصدير البيانات'}),null);const payload=JSON.parse(await blob.text());eq(payload.completeWorkspaceExport,false);eq(payload.counts.task,50);eq(payload.context.totalTasks,53);eq(payload.records.length,page.records.length);ok(filename.startsWith('AeroPlan-view-'));
 await click(button('تصدير البيانات'));await click(button('فتح النسخ الكاملة مع المرفقات'));eq(navigation.at(-1),'full-backup');eq(queryByRole(win.document.body,'region',{name:'خيارات تصدير البيانات'}),null);
 await act(async()=>root.render(React.createElement(DataExport,{...props,isOwner:false})));await click(button('تصدير البيانات'));eq(queryByRole(win.document.body,'button',{name:'فتح النسخ الكاملة مع المرفقات'}),null);await act(async()=>user.keyboard('{Escape}'));eq(queryByRole(win.document.body,'region',{name:'خيارات تصدير البيانات'}),null);eq(document.activeElement,button('تصدير البيانات'));
 await click(button('تصدير البيانات'));await click(win.document.body);eq(queryByRole(win.document.body,'region',{name:'خيارات تصدير البيانات'}),null);

 // Follow the new entry point and export through the actual full application page.
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(String(url),'https://test.local').pathname;headers();
  const options={...init};delete options.signal;const request=new Request(new URL(String(url),'https://test.local'),{...options,headers:{origin:'https://test.local',...Object.fromEntries(new Headers(options.headers))}});
  const handler={'/api/data':api.readData,'/api/settings':api.readSettings,'/api/aircraft-references':api.readReferences,'/api/programs':api.readPrograms,'/api/company':api.readCompany}[pathname];
  if(!handler)throw Error('Unexpected full-page request: '+pathname);if(pathname==='/api/data'&&new URL(request.url).searchParams.get('q')==='SYN UI export 52'&&workspaceHold)await workspaceHold;return handler(request);
 };
 await act(async()=>root.render(React.createElement(Page)));await settled();
 await click(button('بيانات الشركة وبدء الاستخدام'));await settled();ok(getByRole(document.body,'heading',{name:'خطوات بدء الاستخدام'}));
 await click(button('خطة الصيانة'));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300))});
 await click(button('تصدير البيانات'));await click(button('تنزيل بيانات العرض الحالي'));let fullPageFile=JSON.parse(await blob.text());eq(fullPageFile.counts.task,50);eq(fullPageFile.context.matchingTasks,53);eq(fullPageFile.context.query,'');
 workspaceHold=new Promise(resolve=>{releaseWorkspace=resolve});await act(async()=>fireEvent.change(getByPlaceholderText(document.body,'بحث باسم المهمة أو المرجع…'),{target:{value:'SYN UI export 52'}}));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300))});
 await click(button('تصدير البيانات'));await click(button('تنزيل بيانات العرض الحالي'));fullPageFile=JSON.parse(await blob.text());eq(fullPageFile.context.query,'','While a new filter is pending, the export describes the loaded response');eq(fullPageFile.counts.task,50);
 await act(async()=>{releaseWorkspace();workspaceHold=null;await new Promise(resolve=>setTimeout(resolve,30))});
 await click(button('تصدير البيانات'));await click(button('تنزيل بيانات العرض الحالي'));fullPageFile=JSON.parse(await blob.text());eq(fullPageFile.context.query,'SYN UI export 52');eq(fullPageFile.counts.task,1);eq(fullPageFile.context.matchingTasks,1);eq(fullPageFile.context.totalTasks,53);
 console.log(`${checks} mounted customer/export checks passed with actual API/SQLite and production CSS: first-use/retry, owner-only navigation, native validation, busy guard, saved history, retained stale inputs, explicit reload, six setup actions, honest 50-of-53 export, full-backup handoff and role/keyboard boundaries. DOM simulation; no browser pixels or Windows/Docker acceptance.`);
}finally{if(releaseWorkspace)releaseWorkspace();if(releaseHold)releaseHold();await act(async()=>root.unmount());URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;dom.window.close();await f.cleanup()}
