// Actual manual dialog, production CSS and real execution/document API + SQLite.
// DOM/CSS checks are not browser-pixel or Windows/Docker acceptance.
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {fixture} from './controlled-fixture.mjs';

const f=await fixture();
const dom=new JSDOM('<!doctype html><html lang="ar" dir="rtl"><head></head><body><div id="root"></div></body></html>',{url:'https://test.local/',pretendToBeVisual:true}),win=dom.window;
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLButtonElement','Element','Node','Text','Document','Event','EventTarget','MouseEvent','KeyboardEvent','FocusEvent','InputEvent','MutationObserver','AbortController','AbortSignal'])Object.defineProperty(globalThis,name,{value:name==='window'?win:name==='document'?win.document:win[name],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.getComputedStyle=win.getComputedStyle.bind(win);
win.HTMLElement.prototype.scrollIntoView=function(){};
const cssDirectory='dist-node/client/_next/static/css',cssFiles=(await readdir(cssDirectory)).filter(f=>f.endsWith('.css'));
assert(cssFiles.length,'Build production first');
const css=(await Promise.all(cssFiles.map(f=>readFile(cssDirectory+'/'+f,'utf8')))).join('\n'),style=win.document.createElement('style');style.textContent=css;win.document.head.append(style);
await mkdir('.sites-runtime',{recursive:true});
const bindings={name:'bindings',setup(b){b.onResolve({filter:/^(next\/headers|cloudflare:workers)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/headers'?'export async function headers(){return globalThis.__headers}':'export const env=globalThis.__env',loader:'js'}))}};
await build({stdin:{contents:"export {GET as executions} from './app/api/execution/route';export {GET as documents} from './app/api/documents/route';export {rolePermissions} from './lib/permissions';",resolveDir:process.cwd(),loader:'ts'},outfile:'.sites-runtime/manual-dialog-reads.mjs',bundle:true,platform:'node',format:'esm',plugins:[bindings]});
const reads=await import('../.sites-runtime/manual-dialog-reads.mjs');
await build({entryPoints:['app/components/ManualExecution.tsx'],outfile:'.sites-runtime/manual-dialog.mjs',bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom','lucide-react']});
const {default:ManualExecution}=await import('../.sites-runtime/manual-dialog.mjs'),{createRoot}=await import('react-dom/client'),{getByRole,getByLabelText,queryByRole,fireEvent,waitFor}=await import('@testing-library/dom'),{default:userEvent}=await import('@testing-library/user-event');
const root=createRoot(win.document.getElementById('root')),user=userEvent.setup({document:win.document,delay:null});
let actor='planner',selectedTask,props,checks=0,closed=0,hold=null,releaseHold=null;
const writes=[];
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++},ok=(value,message)=>{assert(value,message);checks++};
const headers=who=>{globalThis.__headers=new Headers({'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'})};
async function snapshot(){headers(actor);const response=await reads.executions(new Request('https://test.local/api/execution'));assert.equal(response.status,200);return {task:await f.row(selectedTask,'records'),aircraft:await f.row(f.planeId,'records'),entries:(await response.json()).accomplishments}}
async function refresh(){props={...props,...await snapshot()};root.render(React.createElement(ManualExecution,props))}
globalThis.fetch=async(url,init={})=>{
 const who=actor,{signal,...options}=init,request=new Request(new URL(String(url),'https://test.local'),{...options,headers:{origin:'https://test.local',...Object.fromEntries(new Headers(options.headers))}}),pathname=new URL(request.url).pathname;
 if(pathname==='/api/documents'){headers(who);return reads.documents(request)}
 if(pathname==='/api/execution'&&init.method==='POST'){
  const body=await request.clone().json();if(hold)await hold;headers(who);const response=await f.api.execute(request);writes.push({who,body,status:response.status,result:await response.clone().json()});return response;
 }
 throw Error('Unexpected dialog fetch: '+pathname);
};
async function settled(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25))})}
async function mount(who,taskId=selectedTask){actor=who;selectedTask=taskId;props={...await snapshot(),permissions:reads.rolePermissions[who],onChanged:refresh,onClose:()=>{closed++;root.render(null)}};await act(async()=>root.render(React.createElement(ManualExecution,props)));await settled()}
const dialog=()=>win.document.querySelector('[role=dialog]'),footer=()=>dialog().querySelector('.manual-execution-footer');
const button=name=>getByRole(footer(),'button',{name,exact:true});
const field=name=>getByLabelText(dialog(),name,{exact:true});
async function click(el){await act(async()=>{await user.click(el)});await settled()}
async function change(el,value){await act(async()=>{fireEvent.change(el,{target:{value}})})}
async function action(name,expected){const before=writes.length;await click(button(name));await waitFor(()=>assert.equal(writes.length,before+1));eq(writes.at(-1).status,expected)}

try{
 selectedTask=await f.newTask('TEST-MX-001',{name:'TEST-MX-001 — اختبار حساب الاستحقاق',hours:1100,cycles:550});
 const originalPlane=(await f.row(f.planeId,'records')).data;
 const originalTask=(await f.row(selectedTask,'records')).data;
 const publication=await f.db.prepare('SELECT published FROM document_versions WHERE id=?').bind(f.evidence).first();await f.db.prepare('UPDATE document_versions SET published=NULL WHERE id=?').bind(f.evidence).run();
 win.document.documentElement.style.setProperty('overflow','auto','important');win.document.body.style.overflow='scroll';
 await mount('planner');
 const body=dialog().querySelector('.manual-execution-body'),head=dialog().querySelector('.sectionhead'),foot=footer(),computed=x=>win.getComputedStyle(x);
 eq(dialog().children[0],head);eq(dialog().children[1],body);eq(dialog().children[2],foot);
 eq(computed(dialog()).display,'flex');eq(computed(dialog()).flexDirection,'column');eq(computed(dialog()).overflow,'hidden');
 eq(computed(body).overflowY,'auto');eq(computed(body).minHeight,'0px');ok(parseFloat(computed(body).paddingRight)>0);ok(parseFloat(computed(body).paddingBottom)>0);
 eq(computed(head).flexShrink,'0');eq(computed(foot).flexShrink,'0');eq(computed(foot).flexWrap,'wrap');ok(parseFloat(computed(foot).paddingBottom)>0);
 ok(!body.contains(foot));ok(!body.contains(button('حفظ مسودة الإنجاز')));eq(button('حفظ مسودة الإنجاز').form,body.querySelector('form'));
 ok(body.textContent.includes('معتمد للتخطيط'));ok(!body.textContent.includes('approved'));ok(body.textContent.includes('لا توجد مستندات منشورة'));
 eq(win.document.body.style.overflow,'hidden');eq(win.document.documentElement.style.overflow,'hidden');eq(writes.length,0);
 eq(field('FH عند الإنجاز').value,'1000');eq(field('FC عند الإنجاز').value,'500');
 await click(button('حفظ مسودة الإنجاز'));eq(writes.length,0,'External submit button must still enforce native required inputs');
 await change(field('مرجع أمر العمل / الشهادة'),'TEST-WO-001');await change(field('منفذ العمل حسب السجل'),'TEST-TECH-001');await change(field('ملاحظات'),'SYNTHETIC UI TEST ONLY');
 hold=new Promise(resolve=>{releaseHold=resolve});await act(async()=>{await user.click(button('حفظ مسودة الإنجاز'))});
 eq(button('حفظ مسودة الإنجاز').disabled,true);eq(button('إغلاق النافذة').disabled,true);eq(field('مرجع أمر العمل / الشهادة').disabled,false);eq(field('مرجع أمر العمل / الشهادة').matches(':disabled'),true);
 eq(head.querySelector('button').disabled,true);
 await act(async()=>{releaseHold();hold=null});await settled();await waitFor(()=>assert.equal(writes.length,1));eq(writes[0].status,200);
 eq(props.entries.find(e=>e.task_id===selectedTask).state,'draft');eq(props.task.data.status,'open');ok(footer().querySelector('[role=status]'));
 const stored=props.entries.find(e=>e.task_id===selectedTask);eq(stored.data.reference,'TEST-WO-001');eq(stored.data.performedBy,'TEST-TECH-001');eq(stored.data.hours,1000);eq(stored.data.cycles,500);eq(stored.data.notes,'SYNTHETIC UI TEST ONLY');
 await action('إرسال الإنجاز',200);eq(props.entries.find(e=>e.task_id===selectedTask).state,'submitted');eq(queryByRole(footer(),'button',{name:'حفظ مسودة الإنجاز'}),null);
 await action('إعادة للمسودة',200);eq(props.entries.find(e=>e.task_id===selectedTask).state,'draft');ok(button('حفظ مسودة الإنجاز'));await action('إرسال الإنجاز',200);
 await mount('reviewer');ok(button('مراجعة مستقلة'));eq(queryByRole(footer(),'button',{name:'اعتماد الإنجاز وإغلاق المهمة'}),null);eq(field('مرجع أمر العمل / الشهادة').matches(':disabled'),true);
 await action('مراجعة مستقلة',200);eq(props.entries.find(e=>e.task_id===selectedTask).state,'reviewed');
 const beforeDenied=props.entries.find(e=>e.task_id===selectedTask);await f.call('reviewer','execute',{action:'approve',taskId:selectedTask,etag:beforeDenied.etag},403);eq((await snapshot()).entries.find(e=>e.task_id===selectedTask).state,'reviewed');
 await mount('approver');ok(button('اعتماد الإنجاز وإغلاق المهمة'));eq(queryByRole(footer(),'button',{name:'حفظ مسودة الإنجاز'}),null);
 await action('اعتماد الإنجاز وإغلاق المهمة',200);eq(props.task.data.status,'closed');eq(props.entries.find(e=>e.task_id===selectedTask).state,'approved');eq(dialog().querySelector('form'),null);eq(footer().querySelectorAll('button').length,1);ok(dialog().textContent.includes('TEST-WO-001'));
 eq(props.task.data.hours,originalTask.hours);eq(props.task.data.cycles,originalTask.cycles);
 const {_revision:oldRevision,...oldCard}=originalPlane,{_revision:newRevision,...currentCard}=(await f.row(f.planeId,'records')).data;
 eq(currentCard,oldCard,'Recording completion must preserve aircraft counters and business values');ok(newRevision!==oldRevision,'Existing execution API advances the concurrency token');
 await click(button('إغلاق النافذة'));eq(closed,1);eq(win.document.documentElement.style.getPropertyValue('overflow'),'auto');eq(win.document.documentElement.style.getPropertyPriority('overflow'),'important');eq(win.document.body.style.overflow,'scroll');

 // External evidence failure stays visible in the fixed footer and preserves inputs.
 await f.db.prepare('UPDATE document_versions SET published=? WHERE id=?').bind(publication.published,f.evidence).run();
 const external=await f.newTask('SYN-EXTERNAL-DIALOG',{name:'SYN external dialog task',hours:1100,cycles:550});await mount('planner',external);
 await waitFor(()=>assert.equal(dialog().querySelectorAll('.checklist input').length,1));
 await change(field('مرجع أمر العمل / الشهادة'),'TEST-EXT-001');await change(field('منفذ العمل حسب السجل'),'TEST-TECH-EXT');await change(field('طريقة الإثبات'),'external');
 const beforeRequired=writes.length;await click(button('حفظ مسودة الإنجاز'));eq(writes.length,beforeRequired,'External organisation remains natively required');
 await change(field('مؤسسة الصيانة'),'SYNTHETIC MRO');await action('حفظ مسودة الإنجاز',400);ok(footer().querySelector('[role=alert]'));eq(field('مرجع أمر العمل / الشهادة').value,'TEST-EXT-001');eq(field('مؤسسة الصيانة').value,'SYNTHETIC MRO');eq((await snapshot()).entries.some(e=>e.task_id===external),false);
 await click(dialog().querySelector('.checklist input'));await action('حفظ مسودة الإنجاز',200);const savedExternal=props.entries.find(e=>e.task_id===external);eq(savedExternal.data.method,'external');eq(savedExternal.data.organisation,'SYNTHETIC MRO');eq(savedExternal.data.evidenceVersionIds,[f.evidence]);
 await click(dialog().querySelector('.sectionhead button'));eq(closed,2);eq(win.document.body.style.overflow,'scroll');
 await mount('viewer',external);eq(queryByRole(footer(),'button',{name:'حفظ مسودة الإنجاز'}),null);eq(footer().querySelectorAll('button').length,1);eq(field('مرجع أمر العمل / الشهادة').matches(':disabled'),true);await click(button('إغلاق النافذة'));eq(closed,3);
 // Responsive rules are checked in delivered CSS; no pixel/viewport simulation claim.
 ok(css.includes('.manual-execution-dialog'));ok(css.includes('100dvh'));ok(css.includes('.manual-execution-body .formgrid')||css.includes('.manual-execution-body .formgrid'.replace(' ','')));ok(css.includes('760px')||css.includes('47.5rem'));
 console.log(`${checks} manual accomplishment dialog checks passed with actual React, production CSS and execution/document API/SQLite: padded scroll body, fixed header/footer structure, native external-form submission, busy protection, Arabic planning state, error visibility, internal/external evidence save, independent review/approval/closure, view-only roles and restored page scrolling. ${writes.length} actual UI POSTs; no browser pixels or Windows/Docker claim.`);
}finally{await act(async()=>root.unmount());dom.window.close();await f.cleanup()}
