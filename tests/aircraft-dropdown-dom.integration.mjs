import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {fixture} from './controlled-fixture.mjs';
const f=await fixture({initialPlane:false,referenceFixtures:false});
const dom=new JSDOM('<!doctype html><html dir="rtl" lang="ar"><head></head><body><div id="root"></div></body></html>',{url:'https://test.local/',pretendToBeVisual:true});
const win=dom.window;
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLButtonElement','Element','Node','NodeFilter','Text','Document','ShadowRoot','SVGElement','Event','EventTarget','MouseEvent','KeyboardEvent','FocusEvent','InputEvent','MutationObserver','AbortController','AbortSignal'])Object.defineProperty(globalThis,name,{value:name==='window'?win:name==='document'?win.document:win[name],configurable:true,writable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.getComputedStyle=win.getComputedStyle.bind(win);globalThis.requestAnimationFrame=win.requestAnimationFrame.bind(win);globalThis.cancelAnimationFrame=win.cancelAnimationFrame.bind(win);
win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
win.HTMLElement.prototype.scrollIntoView=function(){};win.HTMLElement.prototype.scrollTo=function(){};
const cssDirectory='dist-node/client/_next/static/css',cssFiles=(await readdir(cssDirectory)).filter(name=>name.endsWith('.css')).sort();assert(cssFiles.length,'Run npm run build:docker before this integration check');
const css=win.document.createElement('style');css.textContent=(await Promise.all(cssFiles.map(name=>readFile(cssDirectory+'/'+name,'utf8')))).join('\n');win.document.head.append(css);console.log('Mounted production CSS: '+cssFiles.join(', '));
globalThis.fetch=async(url,init={})=>{globalThis.__headers=new Headers({'oai-authenticated-user-id':'admin','oai-authenticated-user-email':'admin@example.test'});const {signal,...options}=init;if(signal?.aborted)throw Error('aborted');const req=new Request(new URL(String(url),'https://test.local'),{...options,headers:{origin:'https://test.local',...Object.fromEntries(new Headers(options.headers))}});if(String(url).startsWith('/api/aircraft-references'))return init.method==='POST'?f.api.references(req):f.api.referenceList(req);if(url==='/api/data')return f.api.data(req);throw Error('Unexpected fixture URL '+url)};
await mkdir('.sites-runtime',{recursive:true});
await build({stdin:{contents:`import React,{useState} from 'react';import {AircraftCatalogProvider} from './app/components/AircraftCatalogProvider';import AircraftFields from './app/components/AircraftFields';import AircraftReferences from './app/components/AircraftReferences';import {referencePermissions} from './lib/aircraft-reference-types';import {apiFetch} from './app/client-fetch';
export function Probe(){const [view,setView]=useState('settings'),[data,setData]=useState({name:'SYN-UI-PLANE',msn:'SYN-UI-MSN',hours:200,cycles:100,counterAsOf:'2026-11-01T00:00:00.000Z',counterSource:'SYNTHETIC UI SOURCE',fleetStatus:'in_service',catalogVersion:1,catalogRefs:{},catalogSnapshot:{}}),[result,setResult]=useState('');async function save(e){e.preventDefault();const r=await apiFetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'aircraft',action:'activateAircraft',data})});const j=await r.json();setResult(r.ok?'SYN PLANE SAVED':j.error)}return <AircraftCatalogProvider identity="admin" epoch="initial">{view==='settings'?<><button onClick={()=>setView('plane')}>فتح نموذج الطائرة للاختبار</button><AircraftReferences permissions={referencePermissions} onChanged={()=>{}}/></>:<div className="overlay"><section className="modal" role="dialog" aria-label="إضافة طائرة"><form onSubmit={save}><AircraftFields data={data} onChange={setData}/><button type="submit">حفظ الطائرة للاختبار</button><button type="button" onClick={()=>setView('settings')}>العودة للإعدادات</button><output data-testid="selected-ids">{JSON.stringify(data.catalogRefs)}</output><output data-testid="save-result">{result}</output></form></section></div>}</AircraftCatalogProvider>}`,loader:'tsx',resolveDir:process.cwd()},outfile:'.sites-runtime/dropdown-dom-probe.mjs',bundle:true,platform:'node',format:'esm',external:['react','react-dom'],jsx:'automatic',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
const {Probe}=await import('../.sites-runtime/dropdown-dom-probe.mjs');const {createRoot}=await import('react-dom/client'),{getByRole,getByLabelText,getByTestId,waitFor}=await import('@testing-library/dom'),{default:userEvent}=await import('@testing-library/user-event');
const user=userEvent.setup({document:win.document,delay:null}),root=createRoot(win.document.getElementById('root'));let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
const click=async(element)=>{await act(async()=>{await user.click(element)})};
async function settled(){await act(async()=>{await new Promise(resolve=>setImmediate(resolve))})}
async function choose(label,name,{checkLayer=false,search='',keyboard=false}={}){
 const input=getByRole(win.document.body,'combobox',{name:label,exact:true});eq(input.disabled,false);
 await act(async()=>{input.focus();await user.keyboard('{ArrowDown}')});await settled();
 if(search)await act(async()=>{await user.type(input,search)});await settled();
 const option=getByRole(win.document.body,'option',{name,exact:true});
 if(checkLayer){
  const popup=win.document.querySelector('.aircraft-reference-popup'),positioner=popup.parentElement,overlay=win.document.querySelector('.overlay'),popupZ=Number(getComputedStyle(positioner).zIndex)||0,overlayZ=Number(getComputedStyle(overlay).zIndex)||0;
  console.log(JSON.stringify({renderedOption:option.textContent,positionerZ:popupZ,overlayZ}));
  assert(popupZ>overlayZ,'Popup must be above the aircraft dialog; values arrived but were behind it');checks++;eq(popup.closest('.overlay'),null);
 }
 if(keyboard)await act(async()=>{await user.keyboard('{ArrowDown}{Enter}')});else await click(option);
 eq(input.value,name);
}
try{
 await act(async()=>{root.render(React.createElement(React.StrictMode,null,React.createElement(Probe)))});await settled();
 async function add(typeLabel,addLabel,name,parentLabel,parentName,active=true){await click(getByRole(win.document.body,'button',{name:typeLabel,exact:true}));await click(getByRole(win.document.body,'button',{name:addLabel,exact:true}));await act(async()=>{await user.type(getByLabelText(win.document.body,/^الاسم/),name)});if(parentLabel)await choose(parentLabel,parentName);if(!active)await click(getByRole(win.document.body,'checkbox',{name:'نشط للاختيار الجديد'}));await click(getByRole(win.document.body,'button',{name:'حفظ التعريف',exact:true}));await settled();await waitFor(()=>assert.equal(win.document.querySelector('.reference-editor'),null));eq(win.document.body.textContent.includes(name),true)}
 await add('الشركات المصنّعة','إضافة الشركة المصنّعة','SYN UI MAKER');
 await add('الشركات المصنّعة','إضافة الشركة المصنّعة','SYN UI INACTIVE',undefined,undefined,false);
 await add('عائلات الطراز','إضافة عائلة الطراز','SYN UI FAMILY','الشركة المصنّعة','SYN UI MAKER');
 await add('الطرازات الدقيقة','إضافة الطراز الدقيق / Variant','SYN UI VARIANT','عائلة الطراز','SYN UI FAMILY');
 await add('بلدان التسجيل','إضافة بلد التسجيل','SYN UI COUNTRY');
 await add('الجهات الرقابية','إضافة جهة الإشراف الرقابي','SYN UI AUTHORITY','بلد التسجيل','SYN UI COUNTRY');
 eq((await f.db.prepare("SELECT count(*) n FROM extension_items WHERE kind='aircraft_reference'").first()).n,6);
 await click(getByRole(win.document.body,'button',{name:'فتح نموذج الطائرة للاختبار'}));await settled();eq(getByRole(win.document.body,'combobox',{name:'عائلة الطراز',exact:true}).disabled,true);
 await choose('الشركة المصنّعة','SYN UI MAKER',{checkLayer:true,search:'MAKER',keyboard:true});await choose('عائلة الطراز','SYN UI FAMILY',{checkLayer:true});await choose('الطراز الدقيق / Variant','SYN UI VARIANT',{checkLayer:true});await choose('بلد التسجيل','SYN UI COUNTRY',{checkLayer:true});await choose('جهة الإشراف الرقابي','SYN UI AUTHORITY',{checkLayer:true});
 const countryInput=getByRole(win.document.body,'combobox',{name:'بلد التسجيل',exact:true}),clear=countryInput.closest('.reference-select-field').querySelector('[data-slot="combobox-clear"]');assert(clear,'Selected country must have a clear control');checks++;await click(clear);eq(countryInput.value,'');eq(getByRole(win.document.body,'combobox',{name:'جهة الإشراف الرقابي',exact:true}).disabled,true);await choose('بلد التسجيل','SYN UI COUNTRY',{checkLayer:true,search:'COUNTRY',keyboard:true});await choose('جهة الإشراف الرقابي','SYN UI AUTHORITY',{checkLayer:true});
 const selected=JSON.parse(getByTestId(win.document.body,'selected-ids').textContent);eq(Object.keys(selected).sort(),['authority','country','family','manufacturer','variant']);
 await click(getByRole(win.document.body,'checkbox',{name:/أؤكد مراجعة هوية الطائرة/}));await click(getByRole(win.document.body,'button',{name:'حفظ الطائرة للاختبار'}));await settled();eq(getByTestId(win.document.body,'save-result').textContent,'SYN PLANE SAVED');
 console.log(`${checks} actual-component DOM/API checks passed: settings create linked values and an inactive value, aircraft options render above the modal, search/keyboard selection and mouse selection work, clearing a parent clears its child, selected IDs are preserved and the server accepts the activated aircraft. DOM simulation; no browser pixel-rendering claim.`);
}finally{await act(async()=>{root.unmount()});dom.window.close();await f.cleanup()}
