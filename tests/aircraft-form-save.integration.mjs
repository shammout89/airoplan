import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {fixture} from './controlled-fixture.mjs';
import {fixtureAircraft} from './reference-fixture.mjs';

const f=await fixture({initialPlane:false,referenceFixtures:false});
const dom=new JSDOM('<!doctype html><html lang="ar" dir="rtl"><head></head><body><div id="root"></div></body></html>',{url:'https://test.local/',pretendToBeVisual:true}),win=dom.window;
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLButtonElement','Element','Node','NodeFilter','Text','Document','ShadowRoot','SVGElement','Event','EventTarget','MouseEvent','KeyboardEvent','FocusEvent','InputEvent','MutationObserver','AbortController','AbortSignal'])Object.defineProperty(globalThis,name,{value:name==='window'?win:name==='document'?win.document:win[name],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.getComputedStyle=win.getComputedStyle.bind(win);
globalThis.requestAnimationFrame=win.requestAnimationFrame.bind(win);globalThis.cancelAnimationFrame=win.cancelAnimationFrame.bind(win);
win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
win.HTMLElement.prototype.scrollIntoView=function(){};win.HTMLElement.prototype.scrollTo=function(){};
const cssDirectory='dist-node/client/_next/static/css',cssFiles=(await readdir(cssDirectory)).filter(name=>name.endsWith('.css')).sort();assert(cssFiles.length,'Build production before the full-page form check');
const style=win.document.createElement('style');style.textContent=(await Promise.all(cssFiles.map(name=>readFile(cssDirectory+'/'+name,'utf8')))).join('\n');win.document.head.append(style);console.log('Mounted production CSS: '+cssFiles.join(', '));
await mkdir('.sites-runtime',{recursive:true});
const bindings={name:'bindings',setup(b){b.onResolve({filter:/^(next\/headers|cloudflare:workers)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/headers'?'export async function headers(){return globalThis.__headers}':'export const env=globalThis.__env',loader:'js'}))}};
await build({stdin:{contents:"export {GET as readData} from './app/api/data/route';export {GET as readSettings} from './app/api/settings/route';export {GET as readReferences} from './app/api/aircraft-references/route';",resolveDir:process.cwd(),loader:'ts'},outfile:'.sites-runtime/form-read-api.mjs',bundle:true,platform:'node',format:'esm',plugins:[bindings]});
const readApi=await import('../.sites-runtime/form-read-api.mjs');
let posts=0,holdWrite=null,releaseWrite=null;
const requests=[],writeResults=[];
globalThis.fetch=async(url,init={})=>{
 globalThis.__headers=new Headers({'oai-authenticated-user-id':'admin','oai-authenticated-user-email':'admin@example.test'});
 const {signal,...options}=init,pathname=new URL(String(url),'https://test.local').pathname;
 requests.push([init.method||'GET',pathname]);
 const request=new Request(new URL(String(url),'https://test.local'),{...options,headers:{origin:'https://test.local',...Object.fromEntries(new Headers(options.headers))}});
 if(pathname==='/api/data'){if(init.method==='POST'){posts++;if(holdWrite)await holdWrite;const response=await f.api.data(request);writeResults.push({status:response.status,body:await response.clone().json()});return response}return readApi.readData(request)}
 if(pathname==='/api/settings')return readApi.readSettings(request);
 if(pathname==='/api/aircraft-references')return readApi.readReferences(request);
 return Response.json({error:'Unrelated read route in mounted page test'},{status:404});
};
await build({entryPoints:['app/page.tsx'],outfile:'.sites-runtime/form-page.mjs',bundle:true,platform:'node',format:'esm',external:['react','react-dom'],jsx:'automatic',plugins:[bindings],banner:{js:"import {createRequire as __formCreateRequire} from 'node:module';const require=__formCreateRequire(import.meta.url);"}});
const {default:Page}=await import('../.sites-runtime/form-page.mjs');
const {createRoot}=await import('react-dom/client');
const {getByRole,getByLabelText,fireEvent,waitFor}=await import('@testing-library/dom');
const {default:userEvent}=await import('@testing-library/user-event');
const root=createRoot(win.document.getElementById('root')),user=userEvent.setup({document:win.document,delay:null});
let checks=0;const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++};
async function click(element){await act(async()=>{await user.click(element)})}
async function settled(ms=25){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms))})}
const button=(name,where=win.document.body)=>getByRole(where,'button',{name,exact:true});
const field=name=>getByLabelText(win.document.querySelector('.modal'),name,{exact:true});
const change=async(element,value)=>{await act(async()=>{fireEvent.change(element,{target:{value}})})};
async function open(){await click(button('إضافة طائرة'));await settled();return win.document.querySelector('.modal')}
async function saved(){await settled();await waitFor(()=>assert.equal(win.document.querySelector('.modal'),null))}
try{
 await act(async()=>root.render(React.createElement(Page)));await settled();
 await click(button('الأسطول'));await settled(300);
 await open();await change(getByLabelText(win.document.querySelector('.modal'),/تسجيل الطائرة/),'SYN-FORM-DRAFT');
 const date=field('تاريخ التصنيع');await change(date,'2024-09-30');await change(date,'202600-09-30');
 console.log(JSON.stringify({stage:'rejected-year-before-save',displayed:date.value,valid:date.checkValidity(),message:date.validationMessage}));
 eq(date.value,'2024-09-30');eq(date.checkValidity(),true,'A rejected candidate must not leave a valid visible date unsavable');
 await act(async()=>{date.form.requestSubmit(button('حفظ المسودة / التغييرات'))});await saved();eq(posts,1);
 let stored=(await f.db.prepare("SELECT data FROM records WHERE kind='aircraft'").all()).results.map(row=>JSON.parse(row.data));eq(stored.length,1);eq(stored[0].name,'SYN-FORM-DRAFT');eq(stored[0].manufactureDate,'2024-09-30');eq(stored[0].hours,null);
 await open();await change(getByLabelText(win.document.querySelector('.modal'),/تسجيل الطائرة/),'SYN-FORM-DRAFT');await click(button('حفظ المسودة / التغييرات'));await settled();
 eq(posts,2);const serverError=getByRole(win.document.querySelector('.modal'),'alert',{name:'نتيجة حفظ الطائرة'});console.log(JSON.stringify({stage:'duplicate-save',result:writeResults.at(-1),visible:serverError.textContent}));eq(writeResults.at(-1).status,400);eq(serverError.textContent.includes(writeResults.at(-1).body.error),true);eq(getByLabelText(win.document.querySelector('.modal'),/تسجيل الطائرة/).value,'SYN-FORM-DRAFT');
 await change(getByLabelText(win.document.querySelector('.modal'),/تسجيل الطائرة/),'SYN-FORM-ACTIVATE');await click(button('التحقق من البيانات وتفعيل التخطيط'));await settled();eq(posts,3);eq(writeResults.at(-1).status,400);eq(getByRole(win.document.querySelector('.modal'),'alert',{name:'نتيجة حفظ الطائرة'}).textContent.includes(writeResults.at(-1).body.error),true);
 const invalidDate=field('تاريخ التصنيع');await change(invalidDate,'2999-01-01');await click(button('حفظ المسودة / التغييرات'));await settled();eq(posts,3);eq(getByRole(win.document.querySelector('.modal'),'alert',{name:'نتيجة حفظ الطائرة'}).textContent.includes('تاريخ التصنيع'),true);eq(invalidDate.validity.valid,false);
 await change(invalidDate,'2024-02-29');
 holdWrite=new Promise(resolve=>{releaseWrite=resolve});await click(button('حفظ المسودة / التغييرات'));await settled();
 eq(button('جارٍ الحفظ…').disabled,true);eq(button('التحقق من البيانات وتفعيل التخطيط').disabled,true);eq(posts,4);
 await act(async()=>{releaseWrite();await new Promise(resolve=>setTimeout(resolve,25))});holdWrite=null;await saved();
 stored=(await f.db.prepare("SELECT data FROM records WHERE kind='aircraft'").all()).results.map(row=>JSON.parse(row.data));eq(stored.length,2);eq(stored.find(row=>row.name==='SYN-FORM-ACTIVATE').manufactureDate,'2024-02-29');eq(stored.every(row=>row.profileStatus==='draft'),true);
 await open();const firstGrid=win.document.querySelector('.aircraft-fields .formgrid');eq(getComputedStyle(firstGrid).alignItems,'start');eq(getComputedStyle(firstGrid).padding,'0px');
 const manufacturer=getByRole(win.document.querySelector('.modal'),'combobox',{name:'الشركة المصنّعة',exact:true}).closest('.reference-select-field');eq(getComputedStyle(manufacturer).display,'flex');eq(getComputedStyle(manufacturer).flexDirection,'column');eq(getComputedStyle(manufacturer).alignSelf,'start');
 const registration=getByLabelText(win.document.querySelector('.modal'),/تسجيل الطائرة/);eq(getComputedStyle(registration.previousElementSibling).minHeight,'36px');eq(getComputedStyle(manufacturer.querySelector('label')).minHeight,'36px');
 const refs=await fixtureAircraft(f.db,f.scope,{manufacturer:'SYN FORM MAKER',family:'SYN FORM FAMILY',model:'SYN FORM VARIANT',registrationCountry:'SYN FORM COUNTRY',authority:'SYN FORM AUTHORITY'});
 await click(button('تحديث القوائم',win.document.querySelector('.modal')));await settled();
 async function choose(label,name){const control=getByRole(win.document.querySelector('.modal'),'combobox',{name:label,exact:true});await act(async()=>{control.focus();await user.keyboard('{ArrowDown}');await user.type(control,name)});await settled();await click(getByRole(win.document.body,'option',{name,exact:true}));eq(control.value,name)}
 await change(registration,'SYN-FORM-VERIFIED');
 await choose('الشركة المصنّعة',refs.manufacturer);await choose('عائلة الطراز',refs.family);await choose('الطراز الدقيق / Variant',refs.model);await choose('بلد التسجيل',refs.registrationCountry);await choose('جهة الإشراف الرقابي',refs.authority);
 const modal=win.document.querySelector('.modal');await change(getByLabelText(modal,/الرقم المصنعي للهيكل MSN/),'SYN FORM MSN');await change(getByLabelText(modal,/إجمالي ساعات الهيكل FH/),'200');await change(getByLabelText(modal,/إجمالي دورات الهيكل FC/),'100');await change(field('مرجع الرصيد الافتتاحي — التاريخ والوقت UTC'),'2026-01-01T10:30');await change(getByLabelText(modal,/مرجع مصدر الرصيد الافتتاحي/),'SYN FORM SOURCE');await change(getByRole(modal,'combobox',{name:'حالة الطائرة في إدارة الأسطول',exact:true}),'in_service');await click(getByRole(modal,'checkbox',{name:/أؤكد مراجعة هوية الطائرة/}));
 await click(button('التحقق من البيانات وتفعيل التخطيط'));await saved();eq(posts,5);eq(writeResults.at(-1).status,200);
 const active=JSON.parse((await f.db.prepare("SELECT data FROM records WHERE kind='aircraft' AND json_extract(data,'$.name')='SYN-FORM-VERIFIED'").first()).data);eq(active.profileStatus,'verified');eq(active.catalogRefs,refs.catalogRefs);eq(active.hours,200);eq(active.cycles,100);eq(active.counterAsOf,'2026-01-01T10:30:00.000Z');eq(active.counterSnapshot.reference,'SYN FORM SOURCE');
 console.log(`${checks} mounted full-page aircraft form checks passed with actual read/write API and SQLite: valid draft and fully activated aircraft saves through the real modal, all five dropdown selections, rejected-date recovery without blur, visible duplicate/activation/native validation errors, preserved form values, pending-write buttons and saved records, plus scoped layout CSS. DOM simulation; no pixel or target-Windows claim.`);
}finally{if(releaseWrite)releaseWrite();await act(async()=>root.unmount());dom.window.close();await f.cleanup()}
