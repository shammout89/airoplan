import {fixtureRequest} from './reference-fixture.mjs';
// Exercises actual route handlers against disposable D1 or local SQLite; only identity headers are mocked.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {mkdir,readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalDatabase,LocalBucket} from '../selfhost/storage.mjs';
await mkdir('.sites-runtime',{recursive:true});
await build({stdin:{contents:`export {GET as read,POST as write} from './app/api/data/route';export {GET as team,POST as member} from './app/api/team/route';export {POST as workflow} from './app/api/workflow/route';export {GET as programs,POST as program} from './app/api/programs/route';export {GET as executions,POST as execute} from './app/api/execution/route';export {GET as operations,POST as operate} from './app/api/operations/route';export {GET as acceptance,POST as accept} from './app/api/acceptance/route';export {GET as planning,POST as plan} from './app/api/planning/route';export {GET as technical,POST as tech} from './app/api/technical/route';export {GET as documents,POST as document} from './app/api/documents/route';export {GET as inventory,POST as stock} from './app/api/inventory/route';export {GET as settings,POST as configure} from './app/api/settings/route';export {GET as imports,POST as ingest} from './app/api/imports/route';export {GET as insights,POST as alertRead} from './app/api/insights/route';export {GET as exchange} from './app/api/exchange/route';export {GET as recovery,POST as recover} from './app/api/recovery/route';export {POST as service} from './app/api/backup-service/route';`,resolveDir:process.cwd(),loader:'ts'},outfile:'.sites-runtime/routes-test.mjs',bundle:true,platform:'node',format:'esm',plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^(next\/headers|cloudflare:workers)$/},args=>({path:args.path,namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='next/headers'?'export async function headers(){return globalThis.__testHeaders}':'export const env=globalThis.__testEnv',loader:'js'}))}}]});
const local=process.env.AEROPLAN_TEST_STORAGE==='local',directory=local?await mkdtemp(path.join(os.tmpdir(),'aeroplan-api-test-')):null;
const localDB=local?new LocalDatabase(path.join(directory,'test.sqlite')):null;
const mf=local?{getD1Database:async()=>localDB,getR2Bucket:async()=>new LocalBucket(localDB,path.join(directory,'objects')),dispose:async()=>{localDB.close();await rm(directory,{recursive:true,force:true})}}:new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',d1Databases:['DB'],r2Buckets:['BUCKET'],cf:false}));
try{const db=await mf.getD1Database('DB');globalThis.__testEnv={DB:db,BUCKET:await mf.getR2Bucket('BUCKET'),BACKUP_SERVICE_TOKEN:'test-only-secret-012345678901234567890123456789'};
for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){const text=await readFile('drizzle/'+file,'utf8');for(const stmt of text.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(stmt).run()}
const api=await import('../.sites-runtime/routes-test.mjs');let checks=0;
const owner={id:'owner-id',email:'shammout89@gmail.com'},planner={id:'planner-id',email:'planner@example.test'},reviewer={id:'reviewer-id',email:'reviewer@example.test'},approver={id:'approver-id',email:'approver@example.test'},viewer={id:'viewer-id',email:'viewer@example.test'},outsider={id:'outsider',email:'outsider@example.test'};
async function callRaw(who,fn,body,expected=200,origin='https://test.local'){body=await fixtureRequest(db,'maintenance-department',fn,body);globalThis.__testHeaders=new Headers(who?{'oai-authenticated-user-id':who.id,'oai-authenticated-user-email':who.email}:{});const r=await api[fn](new Request('https://test.local/api/'+fn,{method:body?'POST':'GET',headers:{origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}));const j=await r.json();assert.equal(r.status,expected,`${fn}: ${JSON.stringify(j)}`);checks++;return j}
async function call(who,fn,body,expected=200,origin='https://test.local'){
 if(fn==='write'&&body?.kind==='aircraft')body={...body,action:'activateAircraft',data:{manufacturer:'SYNTHETIC',msn:'TEST-'+body.data.name,registrationCountry:'TEST',fleetStatus:'in_service',counterAsOf:'2026-09-01T00:00:00.000Z',counterSource:'SYNTHETIC TEST ONLY',profileChangeReason:'Synthetic fixture amendment',...body.data,counterConfirmed:true}};
 return callRaw(who,fn,body,expected,origin);
}
async function closeManual(taskId){
 const t=await db.prepare('SELECT data FROM records WHERE id=?').bind(taskId).first(),p=await db.prepare('SELECT data FROM records WHERE id=?').bind(JSON.parse(t.data).aircraftId).first(),d=JSON.parse(p.data);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await call(planner,'execute',{action:'save',taskId,data:{date,hours:d.hours,cycles:d.cycles,reference:'SYN-MANUAL-'+taskId,performedBy:'SYNTHETIC ENGINEER',notes:''}});
 for(const [who,action] of [[planner,'submit'],[reviewer,'review'],[approver,'approve']]){const e=await db.prepare('SELECT etag FROM accomplishments WHERE task_id=?').bind(taskId).first();await call(who,'execute',{action,taskId,etag:e.etag});}
}
await call(null,'read',null,401);await call(outsider,'read',null,403);
// Existing owner records migrate; unrelated legacy records do not.
await db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').bind('legacy','owner-id','aircraft',JSON.stringify({name:'LEGACY',model:'A320',hours:0,cycles:0}),'2026-01-01').run();
await db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').bind('foreign','someone-else','aircraft','{}','2026-01-01').run();
let data=await call(owner,'read');assert.equal(data.session.role,'admin');assert.deepEqual(data.records.map(r=>r.id),['legacy']);
await call(owner,'write',{kind:'aircraft',id:'legacy',data:data.records[0].data});
for(const [person,role] of [[planner,'planner'],[reviewer,'reviewer'],[approver,'approver'],[viewer,'viewer']])await call(owner,'member',{email:person.email,role});
await call(owner,'member',{email:viewer.email,role:'admin'},400);await call(owner,'member',{id:'workspace-owner',role:'viewer',state:'disabled'},403);
await call(planner,'team',null,403);await call(planner,'member',{email:'a@example.test',role:'admin'},403);await call(viewer,'read');
await call(viewer,'write',{kind:'aircraft',data:{name:'NO',model:'A',hours:0,cycles:0}},403);
await call(planner,'write',{kind:'field',data:{label:'NO',entity:'task',type:'text'}},403);
await call(planner,'write',{kind:'aircraft',data:{name:'TEST-001',model:'A320',hours:100,cycles:30,custom:{}}});
data=await call(viewer,'read');const plane=data.records.find(r=>r.data.name==='TEST-001');assert(plane);assert.equal(data.audit.length,0);
await call(planner,'write',{id:'foreign',kind:'aircraft',data:{name:'Steal',model:'A',hours:0,cycles:0}},404);
await call(planner,'write',{kind:'task',data:{name:'Test task',aircraftId:plane.id,date:'',hours:200,cycles:'',status:'open',reviewState:'approved',custom:{}}});
data=await call(planner,'read');let task=data.records.find(r=>r.kind==='task');assert.equal(task.data.reviewState,'draft');
await call(planner,'workflow',{id:task.id,action:'approve'},403);await call(approver,'workflow',{id:task.id,action:'approve'},409);
await call(planner,'workflow',{id:task.id,action:'submit'});await call(planner,'workflow',{id:task.id,action:'review'},403);
await call(reviewer,'workflow',{id:task.id,action:'review'});await call(approver,'workflow',{id:task.id,action:'approve'});
data=await call(owner,'read');task=data.records.find(r=>r.id===task.id);assert.equal(task.data.reviewState,'approved');
await call(planner,'write',{id:task.id,kind:'task',data:{...task.data,name:'Edited'}});data=await call(owner,'read');task=data.records.find(r=>r.id===task.id);assert.equal(task.data.reviewState,'draft');
await call(owner,'workflow',{id:task.id,action:'submit'});await call(owner,'workflow',{id:task.id,action:'review'},403);
await call(reviewer,'workflow',{id:task.id,action:'review'});await call(owner,'workflow',{id:task.id,action:'approve'},403);await call(approver,'workflow',{id:task.id,action:'approve'});await call(approver,'workflow',{id:task.id,action:'close'},403);await closeManual(task.id);
await call(planner,'write',{id:task.id,kind:'task',data:task.data},403);

// Program revision lifecycle and linkage tests use the same real D1 database.
await call(null,'programs',null,401);await call(outsider,'programs',null,403);
const program={code:'amp-test',name:'Test program — synthetic',revision:'01',sourceReference:'TEST AMP',sourceRevision:'A',effectiveDate:'2026-01-01',approvalReference:'TEST ONLY',aircraftIds:[plane.id,'legacy'],notes:'Not operational data',tasks:[{code:'task-01',title:'Program task',ata:'05',reference:'TEST MPD 001',aircraftIds:[plane.id],allAircraft:false,first:{hours:500,cycles:100,calendar:12,unit:'months'},repeat:{hours:250,cycles:50,calendar:6,unit:'months'},notes:''}]};
await call(viewer,'program',{action:'save',data:program},403);await call(approver,'program',{action:'save',data:program},403);
for(const invalid of [
 {...program,aircraftIds:[]},
 {...program,effectiveDate:'2026-02-30'},
 {...program,tasks:[program.tasks[0],program.tasks[0]]},
 {...program,tasks:[{...program.tasks[0],first:{...program.tasks[0].first,cycles:1.5}}]},
 {...program,tasks:[{...program.tasks[0],repeat:{...program.tasks[0].repeat,hours:0}}]},
 {...program,tasks:[{...program.tasks[0],aircraftIds:[],allAircraft:false}]},
 {...program,tasks:[{...program.tasks[0],first:{...program.tasks[0].first,hours:null}}]},
 {...program,aircraftIds:['foreign']}
])await call(planner,'program',{action:'save',data:invalid},400);
let created=await call(planner,'program',{action:'save',data:program});const pid=created.id;
async function revision(id){return (await call(owner,'programs')).revisions.find(p=>p.id===id)}
let p=await revision(pid);assert.equal(p.code,'AMP-TEST');assert.equal(p.data.tasks[0].code,'TASK-01');
await call(planner,'program',{action:'save',data:program},400);
await call(planner,'program',{action:'save',id:pid,etag:'stale',data:p.data},409);
await call(planner,'program',{action:'approve',id:pid,etag:p.etag},403);
await call(approver,'program',{action:'approve',id:pid,etag:p.etag},409);
await call(planner,'program',{action:'submit',id:pid,etag:p.etag});p=await revision(pid);
await call(planner,'program',{action:'save',id:pid,etag:p.etag,data:p.data},403);
await call(planner,'program',{action:'review',id:pid,etag:p.etag},403);
await call(owner,'program',{action:'review',id:pid,etag:p.etag});p=await revision(pid);
await call(owner,'program',{action:'approve',id:pid,etag:p.etag},403);
await call(approver,'program',{action:'approve',id:pid,etag:p.etag});p=await revision(pid);
await call(planner,'program',{action:'save',id:pid,etag:p.etag,data:{...p.data,name:'Overwrite approved'}},403);
await call(planner,'program',{action:'return',id:pid,etag:p.etag},409);
const instance={name:'Untrusted name',reference:'Untrusted reference',aircraftId:plane.id,date:'',hours:500,cycles:100,status:'open',custom:{},programRevisionId:pid,programTaskCode:'TASK-01',programSnapshot:{revision:'FORGED'}};
await call(planner,'write',{kind:'task',data:{...instance,aircraftId:'legacy'}},400);
await call(planner,'write',{kind:'task',data:{...instance,programTaskCode:'MISSING'}},400);
await call(planner,'write',{kind:'task',data:instance});data=await call(owner,'read');let linked=data.records.find(r=>r.data.programRevisionId===pid);assert.equal(linked.data.name,'Program task');assert.equal(linked.data.reference,'TEST MPD 001');assert.equal(linked.data.programSnapshot.revision,'01');
let next=await call(planner,'program',{action:'revise',id:pid,newRevision:'02'});let p2=await revision(next.id);assert.equal(p2.state,'draft');assert.equal(p2.data.approvalReference,'');assert.equal(p.state,'approved');
await call(planner,'program',{action:'revise',id:pid,newRevision:'02'},400);
await call(planner,'write',{kind:'task',data:{...instance,programRevisionId:p2.id}},403);
await call(planner,'program',{action:'save',id:p2.id,etag:p2.etag,data:{...p2.data,revision:'03'}},400);
await call(planner,'program',{action:'submit',id:p2.id,etag:p2.etag});p2=await revision(p2.id);await call(reviewer,'program',{action:'review',id:p2.id,etag:p2.etag});p2=await revision(p2.id);await call(approver,'program',{action:'approve',id:p2.id,etag:p2.etag},400);
await call(planner,'program',{action:'return',id:p2.id,etag:p2.etag});p2=await revision(p2.id);assert.equal(p2.reviewed_by,null);
const changedData={...p2.data,approvalReference:'TEST REF 02',tasks:p2.data.tasks.map(t=>({...t,repeat:{...t.repeat,hours:300}}))};
const oldEtag=p2.etag;await call(planner,'program',{action:'save',id:p2.id,etag:p2.etag,data:changedData});p2=await revision(p2.id);await call(planner,'program',{action:'submit',id:p2.id,etag:oldEtag},409);
await call(planner,'program',{action:'submit',id:p2.id,etag:p2.etag});p2=await revision(p2.id);await call(reviewer,'program',{action:'review',id:p2.id,etag:p2.etag});p2=await revision(p2.id);await call(approver,'program',{action:'approve',id:p2.id,etag:p2.etag});
p=await revision(pid);assert.equal(p.state,'superseded');await call(planner,'write',{kind:'task',data:instance},403);
await call(planner,'write',{id:linked.id,kind:'task',data:{...linked.data,hours:600,programSnapshot:{revision:'FORGED'}}});data=await call(owner,'read');linked=data.records.find(r=>r.id===linked.id);assert.equal(linked.data.programSnapshot.revision,'01');assert.equal(linked.data.programSnapshot.repeat.hours,250);assert.equal((await revision(p2.id)).data.tasks[0].repeat.hours,300);
await call(planner,'write',{kind:'task',data:{...instance,programRevisionId:p2.id}});
await call(planner,'program',{action:'save',id:'foreign',etag:'x',data:program},404);
await call(owner,'program',{action:'save',data:{...program,code:'OWNER-DRAFT'}});let own=(await call(owner,'programs')).revisions.find(p=>p.code==='OWNER-DRAFT');await call(owner,'program',{action:'submit',id:own.id,etag:own.etag});own=await revision(own.id);await call(owner,'program',{action:'review',id:own.id,etag:own.etag},403);

// Initialize a linked task, review the planning record, then independently approve its accomplishment.
await call(null,'executions',null,401);await call(viewer,'execute',{action:'initialize',taskId:linked.id},403);
let allData=await call(owner,'read');let currentPlane=allData.records.find(r=>r.id===plane.id);
await call(planner,'write',{id:plane.id,kind:'aircraft',data:{...currentPlane.data,serviceDate:'2026-01-01',serviceHours:0,serviceCycles:0}});
allData=await call(owner,'read');let automatic=allData.records.find(r=>r.data.programRevisionId===p2.id&&r.kind==='task');
await call(planner,'execute',{action:'initialize',taskId:automatic.id,taskRevision:'stale'},409);
await call(planner,'execute',{action:'initialize',taskId:automatic.id,taskRevision:automatic.data._revision});
allData=await call(owner,'read');automatic=allData.records.find(r=>r.id===automatic.id);assert.equal(automatic.data.hours,500);assert.equal(automatic.data.cycles,100);assert.equal(automatic.data.date,'2027-01-01');
await call(planner,'execute',{action:'initialize',taskId:automatic.id,taskRevision:automatic.data._revision},409);
await call(planner,'write',{id:automatic.id,kind:'task',data:{...automatic.data,hours:9999}},403);
await call(planner,'write',{kind:'task',data:{...instance,schedule:{mode:'automatic'}}},403);
await call(owner,'workflow',{id:automatic.id,action:'close'},403);
currentPlane=allData.records.find(r=>r.id===plane.id);await call(planner,'write',{id:plane.id,kind:'aircraft',data:{...currentPlane.data,serviceHours:1}},403);
await call(planner,'write',{id:plane.id,kind:'aircraft',data:{...currentPlane.data,hours:99}},403);
const completionData={date:'2026-06-30',hours:90,cycles:25,reference:'TEST WO-EXEC',performedBy:'Synthetic mechanic',notes:'test only'};
await call(viewer,'execute',{action:'save',taskId:automatic.id,data:completionData},403);
for(const bad of [{...completionData,hours:101},{...completionData,cycles:31},{...completionData,date:'2025-12-31'},{...completionData,reference:''}])await call(planner,'execute',{action:'save',taskId:automatic.id,data:bad},400);
await call(planner,'execute',{action:'save',taskId:automatic.id,data:completionData});
async function accomplishment(taskId){return (await call(owner,'executions')).accomplishments.find(e=>e.task_id===taskId)}
let done=await accomplishment(automatic.id);await call(planner,'execute',{action:'submit',taskId:automatic.id,etag:done.etag},409);
await call(planner,'workflow',{id:automatic.id,action:'submit'});await call(reviewer,'workflow',{id:automatic.id,action:'review'});await call(approver,'workflow',{id:automatic.id,action:'approve'});
await call(planner,'execute',{action:'submit',taskId:automatic.id,etag:'stale'},409);await call(planner,'execute',{action:'submit',taskId:automatic.id,etag:done.etag});done=await accomplishment(automatic.id);
await call(planner,'execute',{action:'save',taskId:automatic.id,etag:done.etag,data:completionData},403);await call(planner,'execute',{action:'review',taskId:automatic.id,etag:done.etag},403);
await call(reviewer,'execute',{action:'review',taskId:automatic.id,etag:done.etag});done=await accomplishment(automatic.id);await call(reviewer,'execute',{action:'approve',taskId:automatic.id,etag:done.etag},403);
// Concurrent approval retries must produce exactly one successor.
globalThis.__testHeaders=new Headers({'oai-authenticated-user-id':approver.id,'oai-authenticated-user-email':approver.email});
const concurrentBody={action:'approve',taskId:automatic.id,etag:done.etag};const results=await Promise.all([1,2].map(()=>api.execute(new Request('https://test.local/api/execute',{method:'POST',headers:{origin:'https://test.local','Content-Type':'application/json'},body:JSON.stringify(concurrentBody)}))));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);checks+=2;
done=await accomplishment(automatic.id);allData=await call(owner,'read');let oldOccurrence=allData.records.find(r=>r.id===automatic.id);assert.equal(oldOccurrence.data.status,'closed');let nextOccurrence=allData.records.find(r=>r.id===done.data.nextTaskId);assert(nextOccurrence);assert.equal(nextOccurrence.data.hours,390);assert.equal(nextOccurrence.data.cycles,75);assert.equal(nextOccurrence.data.date,'2026-12-30');assert.equal(nextOccurrence.data.schedule.sequence,2);assert.equal(nextOccurrence.data.schedule.baseline.date,'2026-06-30');assert.equal(allData.records.filter(r=>r.data.schedule?.rootTaskId===automatic.id).length,2);
await call(approver,'execute',{action:'approve',taskId:automatic.id,etag:done.etag},409);await call(planner,'execute',{action:'save',taskId:automatic.id,data:completionData,etag:done.etag},409);
await call(planner,'execute',{action:'save',taskId:nextOccurrence.id,data:{...completionData,hours:89}},400);
await call(owner,'execute',{action:'save',taskId:nextOccurrence.id,data:{...completionData,date:'2026-07-31',hours:95,cycles:28}});let second=await accomplishment(nextOccurrence.id);await call(owner,'execute',{action:'submit',taskId:nextOccurrence.id,etag:second.etag});second=await accomplishment(nextOccurrence.id);await call(owner,'execute',{action:'review',taskId:nextOccurrence.id,etag:second.etag},403);await call(reviewer,'execute',{action:'review',taskId:nextOccurrence.id,etag:second.etag});second=await accomplishment(nextOccurrence.id);await call(owner,'execute',{action:'approve',taskId:nextOccurrence.id,etag:second.etag},403);await call(approver,'execute',{action:'approve',taskId:nextOccurrence.id,etag:second.etag});
// A one-time task closes without generating another occurrence.
const onceProgram={...program,code:'ONCE',tasks:[{...program.tasks[0],first:{hours:50,cycles:null,calendar:null,unit:'days'},repeat:{hours:null,cycles:null,calendar:null,unit:'days'}}]};let onceCreated=await call(planner,'program',{action:'save',data:onceProgram});let onceP=await revision(onceCreated.id);await call(planner,'program',{action:'submit',id:onceP.id,etag:onceP.etag});onceP=await revision(onceP.id);await call(reviewer,'program',{action:'review',id:onceP.id,etag:onceP.etag});onceP=await revision(onceP.id);await call(approver,'program',{action:'approve',id:onceP.id,etag:onceP.etag});await call(planner,'write',{kind:'task',data:{...instance,programRevisionId:onceP.id}});allData=await call(owner,'read');let onceTask=allData.records.find(r=>r.data.programRevisionId===onceP.id);await call(planner,'execute',{action:'initialize',taskId:onceTask.id,taskRevision:onceTask.data._revision});await call(planner,'workflow',{id:onceTask.id,action:'submit'});await call(reviewer,'workflow',{id:onceTask.id,action:'review'});await call(approver,'workflow',{id:onceTask.id,action:'approve'});await call(planner,'execute',{action:'save',taskId:onceTask.id,data:{...completionData,date:'2026-08-01',hours:99,cycles:29}});let onceDone=await accomplishment(onceTask.id);await call(planner,'execute',{action:'submit',taskId:onceTask.id,etag:onceDone.etag});onceDone=await accomplishment(onceTask.id);await call(reviewer,'execute',{action:'review',taskId:onceTask.id,etag:onceDone.etag});onceDone=await accomplishment(onceTask.id);await call(approver,'execute',{action:'approve',taskId:onceTask.id,etag:onceDone.etag});onceDone=await accomplishment(onceTask.id);assert.equal(onceDone.data.nextTaskId,null);allData=await call(owner,'read');assert.equal(allData.records.filter(r=>r.data.schedule?.rootTaskId===onceTask.id).length,1);
// Foreign tasks and CSRF do not reach the execution engine.
await call(planner,'execute',{action:'initialize',taskId:'foreign'},404);await call(owner,'execute',{action:'save',taskId:nextOccurrence.id,data:completionData},403,'https://evil.test');

// Superseded rules require an explicit independently approved continuation reference.
let thirdRevision=await call(planner,'program',{action:'revise',id:p2.id,newRevision:'03'});let p3=await revision(thirdRevision.id);await call(planner,'program',{action:'save',id:p3.id,etag:p3.etag,data:{...p3.data,approvalReference:'TEST P3',tasks:p3.data.tasks.map(t=>({...t,repeat:{...t.repeat,hours:400}}))}});p3=await revision(p3.id);await call(planner,'program',{action:'submit',id:p3.id,etag:p3.etag});p3=await revision(p3.id);await call(reviewer,'program',{action:'review',id:p3.id,etag:p3.etag});p3=await revision(p3.id);await call(approver,'program',{action:'approve',id:p3.id,etag:p3.etag});
second=await accomplishment(nextOccurrence.id);const thirdTaskId=second.data.nextTaskId;await call(planner,'execute',{action:'save',taskId:thirdTaskId,data:{...completionData,date:'2026-08-02',hours:99,cycles:29}});let thirdDone=await accomplishment(thirdTaskId);await call(planner,'execute',{action:'submit',taskId:thirdTaskId,etag:thirdDone.etag});thirdDone=await accomplishment(thirdTaskId);await call(reviewer,'execute',{action:'review',taskId:thirdTaskId,etag:thirdDone.etag});thirdDone=await accomplishment(thirdTaskId);
await call(approver,'execute',{action:'approve',taskId:thirdTaskId,etag:thirdDone.etag},400);await call(approver,'execute',{action:'approve',taskId:thirdTaskId,etag:thirdDone.etag,acknowledgeSuperseded:true,continuationReference:''},400);await call(approver,'execute',{action:'approve',taskId:thirdTaskId,etag:thirdDone.etag,acknowledgeSuperseded:true,continuationReference:'TEST internal continuation decision'});thirdDone=await accomplishment(thirdTaskId);assert.equal(thirdDone.data.continuedSupersededProgram,true);allData=await call(owner,'read');const fourth=allData.records.find(r=>r.id===thirdDone.data.nextTaskId);assert.equal(fourth.data.hours,399);assert.equal(fourth.data.programRevisionId,p2.id);assert.equal(fourth.data.schedule.rules.repeat.hours,300);
await call(planner,'execute',{action:'initialize',taskId:linked.id,taskRevision:linked.data._revision},400);

// Flight ledger and append-only correction acceptance using synthetic role identities.
await call(null,'operations',null,401);await call(outsider,'operations',null,403);
async function livePlane(){return (await call(owner,'read')).records.find(r=>r.id===plane.id)}
let lp=await livePlane();const flightData={reference:'LOG-100/1',flightNumber:'TEST100',from:'AMM',to:'AQJ',departure:'2026-09-01T10:00:00.000Z',durationMinutes:60,cycles:1,notes:'synthetic'};
const baseFlight={action:'flight',aircraftId:plane.id,aircraftRevision:lp.data._revision,openingAsOf:'2026-09-01T00:00:00.000Z',confirmOpening:true,data:flightData};
await call(viewer,'operate',baseFlight,403);await call(planner,'operate',{...baseFlight,confirmOpening:false},400);await call(planner,'operate',{...baseFlight,aircraftRevision:'stale'},409);await call(planner,'operate',{...baseFlight,data:{...flightData,durationMinutes:1.5}},400);await call(planner,'operate',{...baseFlight,data:{...flightData,from:'X'}},400);await call(planner,'operate',{...baseFlight,data:{...flightData,departure:'2099-01-01T00:00:00.000Z'}},400);
await call(planner,'operate',baseFlight);lp=await livePlane();assert.equal(lp.data.hours,101);assert.equal(lp.data.cycles,31);assert.equal(lp.data.usageMinutes,60);assert.equal(lp.data.usageOpening.hours,100);
let operations=await call(owner,'operations');let firstFlight=operations.flights.find(f=>f.reference==='LOG-100/1');assert(firstFlight);const originalFlightRow=await db.prepare('SELECT data FROM flights WHERE id=?').bind(firstFlight.id).first();
await call(planner,'operate',{...baseFlight,aircraftRevision:lp.data._revision},409);await call(planner,'operate',{...baseFlight,aircraftRevision:lp.data._revision,data:{...flightData,reference:'DIFFERENT'}},409);
await call(planner,'operate',{...baseFlight,aircraftRevision:lp.data._revision,data:{...flightData,reference:'OVERLAP',departure:'2026-09-01T10:30:00.000Z'}},400);
await call(planner,'write',{id:plane.id,kind:'aircraft',data:{...lp.data,hours:9999,usageOpening:null}},403);
await call(planner,'operate',{...baseFlight,aircraftRevision:lp.data._revision,data:{...flightData,reference:'LOG-100/2',flightNumber:'TEST101',departure:'2026-09-01T12:00:00.000Z',durationMinutes:30}});lp=await livePlane();assert.equal(lp.data.hours,101.5);assert.equal(lp.data.cycles,32);
const makeCorrection=async(kind,targetId,proposed,label='TEST correction')=>call(planner,'operate',{action:'saveCorrection',kind,targetId,proposed,reason:'Synthetic documented correction',reference:label});
const correction=async(id)=>(await call(owner,'operations')).corrections.find(c=>c.id===id);
const approval=async(id)=>{let r=await correction(id);await call(planner,'operate',{action:'submit',id,etag:r.etag});r=await correction(id);await call(reviewer,'operate',{action:'review',id,etag:r.etag});r=await correction(id);await call(approver,'operate',{action:'approve',id,etag:r.etag});return correction(id)};
await call(viewer,'operate',{action:'saveCorrection',kind:'counters',targetId:plane.id,proposed:{hours:100,cycles:30}},403);
await call(planner,'operate',{action:'saveCorrection',kind:'counters',targetId:'foreign',proposed:{hours:100,cycles:30},reason:'test reason',reference:'TEST'},404);
// Explicitly verify rejection status (rather than accepting an unexpected exception).
await call(planner,'operate',{action:'saveCorrection',kind:'counters',targetId:plane.id,proposed:{hours:80,cycles:20},reason:'Below accomplishment',reference:'TEST'},400);
const flightChange=await makeCorrection('flight',firstFlight.id,{durationMinutes:90,cycles:2});let fc=await correction(flightChange.id);assert.equal((await livePlane()).data.hours,101.5);
await call(planner,'operate',{action:'review',id:fc.id,etag:fc.etag},403);await approval(fc.id);lp=await livePlane();assert.equal(lp.data.hours,102);assert.equal(lp.data.cycles,33);operations=await call(owner,'operations');firstFlight=operations.flights.find(f=>f.id===firstFlight.id);assert.equal(firstFlight.data.durationMinutes,90);assert.equal(firstFlight.originalData.durationMinutes,60);assert.equal((await db.prepare('SELECT data FROM flights WHERE id=?').bind(firstFlight.id).first()).data,originalFlightRow.data);
fc=await correction(fc.id);await call(planner,'operate',{action:'saveCorrection',id:fc.id,etag:fc.etag,proposed:{durationMinutes:80,cycles:1},reason:'Attempt overwrite',reference:'TEST'},403);await call(approver,'operate',{action:'approve',id:fc.id,etag:fc.etag},409);
// A correction cannot extend a flight over its next sector.
await call(planner,'operate',{action:'saveCorrection',kind:'flight',targetId:firstFlight.id,proposed:{durationMinutes:180,cycles:2},reason:'Overlap test',reference:'TEST'},400);
const counterChange=await makeCorrection('counters',plane.id,{hours:101.25,cycles:32});await approval(counterChange.id);lp=await livePlane();assert.equal(lp.data.hours,101.25);assert.equal(lp.data.usageAdjustments.hours,-0.75);assert.equal(lp.data.cycles,32);
await call(planner,'operate',{...baseFlight,aircraftRevision:lp.data._revision,data:{...flightData,reference:'LOG-100/3',departure:'2026-09-02T10:00:00.000Z',durationMinutes:15}});lp=await livePlane();assert.equal(lp.data.hours,101.5);assert.equal(lp.data.cycles,33);
// Correct the latest approved accomplishment: original remains immutable, open successor is recalculated.
const originalCompletionRow=await db.prepare('SELECT data FROM accomplishments WHERE id=?').bind(thirdDone.id).first();const changeDone=await makeCorrection('completion',thirdDone.id,{...thirdDone.data,date:'2026-08-03',hours:98.5,cycles:29});await approval(changeDone.id);let currentEntries=await call(owner,'executions');let effectiveDone=currentEntries.accomplishments.find(e=>e.id===thirdDone.id);assert.equal(effectiveDone.data.hours,98.5);assert.equal(effectiveDone.originalData.hours,99);assert.equal((await db.prepare('SELECT data FROM accomplishments WHERE id=?').bind(thirdDone.id).first()).data,originalCompletionRow.data);allData=await call(owner,'read');let correctedFourth=allData.records.find(r=>r.id===fourth.id);assert.equal(correctedFourth.data.hours,398.5);assert.equal(correctedFourth.data.date,'2027-02-03');assert.equal(allData.records.filter(r=>r.data.schedule?.rootTaskId===automatic.id).length,4);
// Altering an ancestor must not invalidate its next approved execution.
await call(planner,'operate',{action:'saveCorrection',kind:'completion',targetId:done.id,proposed:{...done.data,hours:99},reason:'Invalid chronology',reference:'TEST'},400);
const earlierChange=await makeCorrection('completion',done.id,{...done.data,hours:89,notes:'Historical addition'});await approval(earlierChange.id);const earlierRecord=await correction(earlierChange.id);assert.equal(earlierRecord.data.impacts[0].historicalOnly,true);
// Rebase a reviewed request after another flight changes its context.
lp=await livePlane();const staleChange=await makeCorrection('counters',plane.id,{hours:103,cycles:35});let stale=await correction(staleChange.id);await call(planner,'operate',{action:'submit',id:stale.id,etag:stale.etag});stale=await correction(stale.id);
await call(planner,'operate',{...baseFlight,aircraftRevision:lp.data._revision,data:{...flightData,reference:'LOG-100/4',departure:'2026-09-03T10:00:00.000Z',durationMinutes:15}});await call(reviewer,'operate',{action:'review',id:stale.id,etag:stale.etag},409);await call(planner,'operate',{action:'return',id:stale.id,etag:stale.etag});stale=await correction(stale.id);await call(planner,'operate',{action:'saveCorrection',id:stale.id,etag:stale.etag,proposed:{hours:103,cycles:35},reason:stale.data.reason,reference:stale.data.reference});await approval(stale.id);
// Two flight posts sharing one opening state apply only once.
lp=await livePlane();const raceFlight={...baseFlight,aircraftRevision:lp.data._revision,data:{...flightData,reference:'LOG-RACE',departure:'2026-09-04T10:00:00.000Z',durationMinutes:1}};globalThis.__testHeaders=new Headers({'oai-authenticated-user-id':planner.id,'oai-authenticated-user-email':planner.email});const flightRace=await Promise.all([1,2].map(()=>api.operate(new Request('https://test.local/api/operate',{method:'POST',headers:{origin:'https://test.local','Content-Type':'application/json'},body:JSON.stringify(raceFlight)}))));assert.deepEqual(flightRace.map(r=>r.status).sort(),[200,409]);checks+=2;lp=await livePlane();assert.equal(lp.data.hours,103.016667);
// Self-prepared changes cannot be reviewed/approved by that same administrator.
let ownChange=await call(owner,'operate',{action:'saveCorrection',kind:'counters',targetId:plane.id,proposed:{hours:104,cycles:37},reason:'Independent approval test',reference:'TEST OWNER'});let oc=await correction(ownChange.id);await call(owner,'operate',{action:'submit',id:oc.id,etag:oc.etag});oc=await correction(oc.id);await call(owner,'operate',{action:'review',id:oc.id,etag:oc.etag},403);await call(reviewer,'operate',{action:'review',id:oc.id,etag:oc.etag});oc=await correction(oc.id);await call(owner,'operate',{action:'approve',id:oc.id,etag:oc.etag},403);
await call(owner,'operate',{action:'flight',...baseFlight},403,'https://evil.test');
// Acceptance starts empty; user evidence is appended and synthetic checks never become real sign-off.
await call(null,'acceptance',null,401);let acceptance=await call(owner,'acceptance');assert.equal(acceptance.checks.length,0);assert(acceptance.cases.length>=47);const evidence={release:acceptance.release,definitions:acceptance.definitions,caseId:'duplicate-flight',result:'passed',evidenceType:'synthetic',engineeringReviewed:false,observed:'Duplicate posting rejected in a disposable test database',reference:'TEST SUITE'};await call(planner,'accept',evidence,403);await call(reviewer,'accept',evidence);await call(owner,'accept',{...evidence,result:'blocked',observed:'Real browser sign-in and engineering records are still pending'});acceptance=await call(owner,'acceptance');assert.equal(acceptance.checks.length,2);assert(acceptance.checks.every(r=>r.data.evidenceType==='synthetic'));

// Forecasts, work-pack reservations and component life/movement controls.
await call(null,'planning',null,401);await call(viewer,'plan',{action:'save',kind:'resource',data:{}},403);
const planningState=async()=>call(owner,'planning');const item=async(id)=>(await planningState()).items.find(i=>i.id===id);
const approvePlanning=async(id)=>{let r=await item(id);await call(planner,'plan',{action:'submit',id,etag:r.etag});r=await item(id);await call(reviewer,'plan',{action:'review',id,etag:r.etag});r=await item(id);await call(approver,'plan',{action:'approve',id,etag:r.etag});return item(id)};
const profileData={aircraftId:plane.id,mode:'manual',hoursPerDay:10,cyclesPerDay:2,windowDays:30,reference:'TEST MANUAL UTILIZATION',notes:''};let pr=await call(planner,'plan',{action:'save',kind:'profile',data:profileData});let planState=await planningState();let predicted=planState.forecasts.find(f=>f.taskId===fourth.id);assert.equal(predicted.basis,'FC');assert.equal(predicted.partial,false);allData=await call(owner,'read');assert.equal(allData.records.find(r=>r.id===fourth.id).data.hours,398.5);
await call(planner,'plan',{action:'save',kind:'profile',data:profileData},400);let prof=await item(pr.id);await call(planner,'plan',{action:'save',kind:'profile',id:prof.id,etag:'stale',data:profileData},409);
await call(planner,'plan',{action:'save',kind:'profile',id:prof.id,etag:prof.etag,data:{...profileData,mode:'observed',windowDays:365}});planState=await planningState();assert.equal(planState.forecasts.find(f=>f.taskId===fourth.id).rates.source,'observed');prof=await item(pr.id);await call(planner,'plan',{action:'save',kind:'profile',id:prof.id,etag:prof.etag,data:profileData});
const resourceData={code:'TOOL',name:'Synthetic tool',type:'tool',capacity:1,reference:'TEST AVAILABILITY',availableFrom:'',availableTo:'',skills:'',notes:''};const tool=await call(planner,'plan',{action:'save',kind:'resource',data:resourceData});const labor=await call(planner,'plan',{action:'save',kind:'resource',data:{...resourceData,code:'LABOR',name:'Synthetic mechanics',type:'manpower',capacity:2}});
await call(planner,'plan',{action:'save',kind:'resource',data:resourceData},400);await call(planner,'plan',{action:'save',kind:'resource',data:{...resourceData,code:'BAD',capacity:1.5}},400);
async function plannedTask(name){await call(planner,'write',{kind:'task',data:{name,aircraftId:plane.id,hours:1000,cycles:'',date:'',status:'open',reference:'TEST',custom:{}}});const t=(await call(owner,'read')).records.find(r=>r.data.name===name);await call(planner,'workflow',{id:t.id,action:'submit'});await call(reviewer,'workflow',{id:t.id,action:'review'});await call(approver,'workflow',{id:t.id,action:'approve'});return t}
const taskA=await plannedTask('Package synthetic A'),taskB=await plannedTask('Package synthetic B');const tomorrow=new Date(Date.now()+86400000),later=new Date(Date.now()+100800000);const packData={code:'WP-1',name:'Synthetic work pack',aircraftId:plane.id,start:tomorrow.toISOString(),end:later.toISOString(),station:'TEST',taskIds:[taskA.id],resources:[{resourceId:tool.id,quantity:1},{resourceId:labor.id,quantity:2}],plannedManHours:4,reference:'TEST WP',riskReference:'',notes:''};
await call(planner,'plan',{action:'save',kind:'package',data:{...packData,taskIds:['foreign']}},400);await call(planner,'plan',{action:'save',kind:'package',data:{...packData,plannedManHours:100}},400);await call(planner,'plan',{action:'save',kind:'package',data:{...packData,resources:[{resourceId:tool.id,quantity:2}]}},400);
let pack1=await call(planner,'plan',{action:'save',kind:'package',data:packData});let pack2=await call(planner,'plan',{action:'save',kind:'package',data:{...packData,code:'WP-2',taskIds:[taskB.id]}});
for(const id of [pack1.id,pack2.id]){let p=await item(id);await call(planner,'plan',{action:'submit',id,etag:p.etag});p=await item(id);await call(reviewer,'plan',{action:'review',id,etag:p.etag})}
let p1=await item(pack1.id),p2pack=await item(pack2.id);globalThis.__testHeaders=new Headers({'oai-authenticated-user-id':approver.id,'oai-authenticated-user-email':approver.email});const booking=await Promise.all([p1,p2pack].map(p=>api.plan(new Request('https://test.local/api/plan',{method:'POST',headers:{origin:'https://test.local','Content-Type':'application/json'},body:JSON.stringify({action:'approve',id:p.id,etag:p.etag})}))));const bookStatuses=booking.map(r=>r.status);assert.equal(bookStatuses.filter(s=>s===200).length,1);assert(bookStatuses.some(s=>[400,409].includes(s)));checks+=2;
planState=await planningState();const reserved=planState.items.find(p=>p.kind==='package'&&p.state==='approved');let toolRow=await item(tool.id);await call(planner,'plan',{action:'save',kind:'resource',id:tool.id,etag:toolRow.etag,data:{...resourceData,capacity:3}},400);await call(planner,'plan',{action:'start',id:reserved.id,etag:reserved.etag},400);await call(approver,'plan',{action:'cancel',id:reserved.id,etag:reserved.etag,reason:'Synthetic capacity release'});
// A current work pack retains reservations until its tasks are actually closed.
const nowStart=new Date(Date.now()-1800000).toISOString(),nowEnd=new Date(Date.now()+1800000).toISOString();const livePack=await call(planner,'plan',{action:'save',kind:'package',data:{...packData,code:'WP-LIVE',start:nowStart,end:nowEnd,plannedManHours:1}});let live=await approvePlanning(livePack.id);await call(planner,'plan',{action:'start',id:live.id,etag:live.etag});live=await item(live.id);await call(planner,'plan',{action:'complete',id:live.id,etag:live.etag},400);await call(planner,'plan',{action:'save',kind:'package',data:{...packData,code:'WP-CONFLICT',taskIds:[taskB.id]}},400);await closeManual(taskA.id);await call(planner,'plan',{action:'complete',id:live.id,etag:live.etag});assert.equal((await item(live.id)).state,'completed');
// Approved registration and movement preserve lifetime and prevent occupied/expired installations.
const componentData={name:'Synthetic LLP',partNumber:'PN-TEST',serialNumber:'SN-01',ata:'32',category:'LLP',condition:'serviceable',totalHours:50,totalCycles:20,limitHours:100,limitCycles:50,expiryDate:'2099-01-01',reference:'TEST LIFE RECORD',location:'TEST STORE',notes:''};
await call(planner,'plan',{action:'save',kind:'component',data:{...componentData,limitHours:'',limitCycles:'',expiryDate:''}},400);const part1=await call(planner,'plan',{action:'save',kind:'component',data:componentData});await call(planner,'plan',{action:'save',kind:'component',data:{...componentData,partNumber:'pn-test',serialNumber:'sn-01'}},400);let pc=await approvePlanning(part1.id);await call(planner,'plan',{action:'save',kind:'component',id:pc.id,etag:pc.etag,data:{...componentData,totalHours:0}},403);
const installData={componentId:pc.id,action:'install',aircraftId:plane.id,position:'LEFT-01',reference:'TEST INSTALL',notes:''};let installation=await call(planner,'plan',{action:'save',kind:'movement',data:installData});await approvePlanning(installation.id);planState=await planningState();let partLife=planState.components.find(c=>c.id===pc.id);assert.equal(partLife.life.hours,50);assert.equal(partLife.data.installation.position,'LEFT-01');await call(planner,'plan',{action:'save',kind:'movement',data:installData},400);
const otherPart=await call(planner,'plan',{action:'save',kind:'component',data:{...componentData,serialNumber:'SN-02'}});await approvePlanning(otherPart.id);await call(planner,'plan',{action:'save',kind:'movement',data:{...installData,componentId:otherPart.id}},400);
const expired=await call(planner,'plan',{action:'save',kind:'component',data:{...componentData,serialNumber:'EXPIRED',limitHours:40}});await approvePlanning(expired.id);await call(planner,'plan',{action:'save',kind:'movement',data:{...installData,componentId:expired.id,position:'RIGHT-01'}},400);
// Installation baseline guards reject retroactive flights or negative aircraft deltas.
lp=await livePlane();await call(planner,'operate',{...baseFlight,aircraftRevision:lp.data._revision,data:{...flightData,reference:'OLD-AFTER-INSTALL',departure:'2026-09-05T10:00:00.000Z'}},400);await call(planner,'operate',{action:'saveCorrection',kind:'counters',targetId:plane.id,proposed:{hours:100,cycles:36},reason:'Below component installation',reference:'TEST'},400);
const removeData={componentId:pc.id,action:'remove',afterCondition:'quarantine',location:'TEST REPAIR',reference:'TEST REMOVE',notes:''};const removal=await call(planner,'plan',{action:'save',kind:'movement',data:removeData});let rm=await item(removal.id);await call(planner,'plan',{action:'submit',id:rm.id,etag:rm.etag});rm=await item(rm.id);
lp=await livePlane();const increase=await makeCorrection('counters',plane.id,{hours:Number(lp.data.hours)+10,cycles:Number(lp.data.cycles)+5},'TEST COUNTER COMPONENT IMPACT');await approval(increase.id);planState=await planningState();partLife=planState.components.find(c=>c.id===pc.id);assert.equal(partLife.life.hours,60);assert.equal(partLife.life.cycles,25);await call(reviewer,'plan',{action:'review',id:rm.id,etag:rm.etag},409);await call(planner,'plan',{action:'return',id:rm.id,etag:rm.etag});rm=await item(rm.id);await call(planner,'plan',{action:'save',kind:'movement',id:rm.id,etag:rm.etag,data:removeData});await approvePlanning(rm.id);planState=await planningState();partLife=planState.components.find(c=>c.id===pc.id);assert.equal(partLife.data.installation,null);assert.equal(partLife.life.hours,60);assert.equal(partLife.life.cycles,25);assert.equal(partLife.data.registrationSnapshot.totalHours,50);
await call(planner,'plan',{action:'save',kind:'movement',data:{...installData,aircraftId:'legacy'}},400);const release=await call(planner,'plan',{action:'save',kind:'movement',data:{componentId:pc.id,action:'condition',afterCondition:'serviceable',location:'TEST RELEASED',reference:'TEST INSPECTION CERT',notes:''}});await approvePlanning(release.id);const reinstall=await call(planner,'plan',{action:'save',kind:'movement',data:{...installData,aircraftId:'legacy'}});await approvePlanning(reinstall.id);planState=await planningState();partLife=planState.components.find(c=>c.id===pc.id);assert.equal(partLife.life.hours,60);assert.equal(partLife.life.cycles,25);assert.equal(partLife.data.installation.aircraftId,'legacy');assert.equal(planState.items.filter(i=>i.kind==='movement'&&i.data.componentId===pc.id&&i.state==='approved').length,4);
// Workspaces, role separation and origin protection apply to all planning writes.
await call(outsider,'planning',null,403);await call(planner,'plan',{action:'save',kind:'profile',id:'foreign',data:profileData},404);await call(owner,'plan',{action:'save',kind:'profile',data:profileData},403,'https://evil.test');const ownedPart=await call(owner,'plan',{action:'save',kind:'component',data:{...componentData,serialNumber:'OWNER-PART'}});let ownPart=await item(ownedPart.id);await call(owner,'plan',{action:'submit',id:ownPart.id,etag:ownPart.etag});ownPart=await item(ownPart.id);await call(owner,'plan',{action:'review',id:ownPart.id,etag:ownPart.etag},403);
const team=await call(owner,'team');const member=team.members.find(m=>m.email===planner.email);await call(owner,'member',{id:member.id,role:'planner',state:'disabled'});await call(planner,'read',null,403);await call(planner,'write',{kind:'aircraft',data:{}},403);await call(owner,'member',{id:member.id,role:'viewer',state:'active'});await call(planner,'write',{kind:'aircraft',data:{}},403);
await call(owner,'member',{email:'csrf@example.test',role:'viewer'},403,'https://evil.test');await call(outsider,'read',null,403);
await call({...viewer,id:'wrong-id'},'read',null,403);
await import('./extensions.cases.mjs').then(m=>m.runExtensions({api,call,db,mf,owner,planner,reviewer,approver,viewer,plane}));
await import('./technical.cases.mjs').then(m=>m.runTechnical({api,call,db,owner,reviewer,approver,viewer,plane}));
await import('./aircraft.cases.mjs').then(m=>m.runAircraft({api,call:callRaw,db,owner,reviewer,approver,viewer,plane}));
async function service(body,token,expected){const r=await api.service(new Request('https://test.local/api/backup-service',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}));assert.equal(r.status,expected);checks++;return r.json()}
await service({action:'create'},'wrong',401);await service({action:'restore'},globalThis.__testEnv.BACKUP_SERVICE_TOKEN,403);
await call(planner,'recovery',null,403);
const backup=await call(owner,'recover',{action:'create'});
assert(backup.digest.length===64);assert(backup.manifest.totalRows>0);
const beforeRecords=JSON.stringify((await call(owner,'read')).records.sort((a,b)=>a.id.localeCompare(b.id)));
const drill=await call(owner,'recover',{action:'drill',backupId:backup.id});assert.equal(drill.state,'verified');
assert.equal(JSON.stringify((await call(owner,'read')).records.sort((a,b)=>a.id.localeCompare(b.id))),beforeRecords);
const bucket=globalThis.__testEnv.BUCKET;const catalog=await db.prepare('SELECT * FROM backup_catalog WHERE id=?').bind(backup.id).first();const original=await (await bucket.get(catalog.storage_key)).text();
const fileRef=JSON.parse(original).files[0],savedFile=await (await bucket.get(fileRef.backupKey)).arrayBuffer();await bucket.put(fileRef.backupKey,'corrupt');await call(owner,'recover',{action:'drill',backupId:backup.id},400);await bucket.put(fileRef.backupKey,savedFile);
// Security and evidence changes made after the snapshot must survive a live restore.
await call(owner,'member',{id:member.id,role:'viewer',state:'disabled'});await call(owner,'accept',{...evidence,observed:'Late acceptance evidence must remain after restore',reference:'AFTER SNAPSHOT'});

await bucket.put(catalog.storage_key,original.replace('AeroPlan-backup-v1','tampered'));
await call(owner,'recover',{action:'drill',backupId:backup.id},400);await bucket.put(catalog.storage_key,original);
await call(owner,'recover',{action:'restore',runId:drill.id,confirmation:'RESTORE '+backup.id},400);
await call(owner,'recover',{action:'maintenance'});
for(const fn of ['write','member','workflow','program','execute','operate','plan','accept'])await call(owner,fn,{},503);
await db.prepare('INSERT INTO write_leases VALUES(?,?,?,?)').bind('busy','maintenance-department','test','now').run();
await call(owner,'recover',{action:'restore',runId:drill.id,confirmation:'RESTORE '+backup.id},400);
await db.prepare('DELETE FROM write_leases WHERE id=?').bind('busy').run();
await call(owner,'recover',{action:'restore',runId:drill.id,confirmation:'WRONG'},400);
await db.prepare("UPDATE records SET data=json_set(data,'$.name','CHANGED') WHERE id='legacy'").run();
const auditBefore=await db.prepare('SELECT count(*) n FROM audit').first();
const restored=await call(owner,'recover',{action:'restore',runId:drill.id,confirmation:'RESTORE '+backup.id});assert(restored.result.preRestoreBackupId);
assert.equal(JSON.stringify((await call(owner,'read')).records.sort((a,b)=>a.id.localeCompare(b.id))),beforeRecords);
assert((await db.prepare('SELECT count(*) n FROM audit').first()).n>auditBefore.n);
assert.equal((await db.prepare('SELECT state FROM members WHERE id=?').bind(member.id).first()).state,'disabled');assert((await call(owner,'acceptance')).checks.some(c=>c.data.reference==='AFTER SNAPSHOT'));
await call(owner,'recover',{action:'resume',confirmation:'WRONG'},400);
await call(owner,'recover',{action:'resume',confirmation:'RESUME WRITES'});
await call(owner,'write',{kind:'aircraft',data:{}},409);
await import('../scripts/restore-backup.mjs').then(m=>m.verifyIsolated(JSON.parse(original),{fileLoader:async f=>(await bucket.get(f.backupKey)).arrayBuffer()}));
const format=await import('../.sites-runtime/backup-format.mjs');const corrupt=JSON.parse(original);corrupt.tables.records=corrupt.tables.records.filter(r=>r.kind!=='aircraft');const broken=await format.sealSnapshot(corrupt.workspaceId,corrupt.tables,corrupt.createdAt);await assert.rejects(()=>format.validateSnapshot(broken));
await assert.rejects(()=>format.validateSnapshot(JSON.parse(original),'other-workspace'));
const session=(await call(owner,'read')).session;const goodRequest=new Request('https://test.local/api/data',{method:'POST',headers:{origin:'https://test.local','Content-Type':'application/json','X-AeroPlan-Epoch':session.recoveryEpoch},body:JSON.stringify({kind:'aircraft',data:{name:'AFTER-RESTORE',hours:0,cycles:0,custom:{}}})});assert.equal((await api.write(goodRequest)).status,200);checks++;

console.log(`${checks} API checks passed: prior regressions plus forecast profiles, capacity conflicts, concurrent reservations, package completion, component life, occupied/expired installation rejection, removal/reinstallation without life reset, movement staleness and independent approvals.`);
}finally{await mf.dispose()}
