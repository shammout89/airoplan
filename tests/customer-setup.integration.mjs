// Real routes/SQLite, owner and recovery controls, restore semantics and view-export boundaries.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {fixture} from './controlled-fixture.mjs';
const f=await fixture();let checks=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++},ok=(value,message)=>{assert(value,message);checks++};
const bindings={name:'bindings',setup(b){b.onResolve({filter:/^(next\/headers|cloudflare:workers)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/headers'?'export async function headers(){return globalThis.__headers}':'export const env=globalThis.__env',loader:'js'}))}};
await build({stdin:{contents:"export {GET as getCompany,POST as saveCompany} from './app/api/company/route';export {GET as readData} from './app/api/data/route';export {POST as genericSetting} from './app/api/settings/route';export {viewExport} from './lib/view-export';export {sealSnapshot} from './lib/backup-format';",loader:'ts',resolveDir:process.cwd()},outfile:'.sites-runtime/customer-setup-api.mjs',bundle:true,platform:'node',format:'esm',plugins:[bindings]});
const api=await import('../.sites-runtime/customer-setup-api.mjs');
async function call(actor,fn,body,status=200,{origin='https://test.local',epoch='initial',query=''}={}){
 globalThis.__headers=new Headers(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test'}:{});
 const r=await api[fn](new Request('https://test.local/api/company'+query,{method:body===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json','X-AeroPlan-Epoch':epoch},body:body===undefined?undefined:JSON.stringify(body)}));
 const j=await r.json();eq(r.status,status,JSON.stringify(j));return j;
}
const profile={companyName:'SYN Airline A',departmentName:'SYN Planning',reference:'SYNTHETIC REFERENCE',changeReason:'SYNTHETIC initial customer setup'};
const state=()=>f.db.prepare('SELECT name,owner_user_id FROM workspaces WHERE id=?').bind(f.scope).first();
const versions=()=>f.db.prepare("SELECT * FROM settings_versions WHERE workspace_id=? AND kind='company' ORDER BY rowid").bind(f.scope).all();
try{
 const recordsBefore=(await f.db.prepare('SELECT * FROM records ORDER BY id').all()).results;
 await call(null,'getCompany',undefined,401);
 for(const actor of ['admin','planner','reviewer','approver','viewer']){await call(actor,'getCompany',undefined,403);await call(actor,'saveCompany',{data:profile,expectedVersion:null},403)}
 const fresh=await call('owner','getCompany');eq(fresh.profile,null);eq(fresh.versionId,null);eq(fresh.counts.aircraft,{total:1,verified:1});eq(fresh.operationalAcceptance,'requires_independent_verification');
 await call('owner','saveCompany',{data:profile,expectedVersion:null},403,{origin:'https://foreign.test'});
 for(const data of [{...profile,companyName:''},{...profile,departmentName:'x'},{...profile,companyName:'a'.repeat(121)},{...profile,reference:'x\u0000'},{...profile,changeReason:''},{...profile,ownerUserId:'planner'},{...profile,schemaVersion:99}])await call('owner','saveCompany',{data,expectedVersion:null},400);
 await call('owner','saveCompany',{data:profile},400);await call('owner','saveCompany',{data:profile,expectedVersion:null,scope:'foreign'},400);
 const saved=await call('owner','saveCompany',{data:{...profile,companyName:'  SYN   Airline A  '},expectedVersion:null});eq(saved.profile.companyName,profile.companyName);ok(saved.versionId);eq((await state()).name,profile.companyName);eq((await state()).owner_user_id,'owner');
 eq((await f.db.prepare('SELECT * FROM records ORDER BY id').all()).results,recordsBefore,'Setup must not rewrite aircraft or tasks');
 const data=await call('owner','readData',undefined,200,{query:'?view=workspace'});eq(data.session.workspace,profile.companyName);
 const view=await call('owner','getCompany');eq(view.history.length,1);eq(view.history[0].data.companyName,profile.companyName);
 await call('owner','saveCompany',{data:{...profile,companyName:'SYN stale'},expectedVersion:null},409);
 eq((await state()).name,profile.companyName);eq((await versions()).results.length,1);
 await call('owner','genericSetting',{kind:'company',code:'profile',data:profile,previousId:saved.versionId},400);
 // Two owners' requests sharing a version cannot overwrite each other silently.
 const responses=await Promise.all([call('owner','saveCompany',{data:{...profile,companyName:'SYN Race A'},expectedVersion:saved.versionId}),call('owner','saveCompany',{data:{...profile,companyName:'SYN Race B'},expectedVersion:saved.versionId},409)]);
 eq((await versions()).results.length,2);eq((await state()).name,'SYN Race A');
 const beforeFailure=await state(),head=responses[0].versionId;
 await f.db.prepare("CREATE TRIGGER synthetic_company_audit BEFORE INSERT ON audit WHEN instr(NEW.action,'تحديث بيانات الشركة')>0 BEGIN SELECT RAISE(ABORT,'SYNTHETIC AUDIT FAILURE'); END").run();
 await call('owner','saveCompany',{data:{...profile,companyName:'SYN rollback'},expectedVersion:head},400);
 eq(await state(),beforeFailure);eq((await versions()).results.length,2);
 await f.db.prepare('DROP TRIGGER synthetic_company_audit').run();
 await f.db.prepare("UPDATE recovery_control SET mode='maintenance' WHERE workspace_id=?").bind(f.scope).run();
 await call('owner','saveCompany',{data:profile,expectedVersion:head},503);await call('owner','getCompany');
 await f.db.prepare("UPDATE recovery_control SET mode='open',epoch='customer-new-epoch' WHERE workspace_id=?").bind(f.scope).run();
 await call('owner','saveCompany',{data:profile,expectedVersion:head},409);
 await f.db.prepare("UPDATE recovery_control SET epoch='initial' WHERE workspace_id=?").bind(f.scope).run();
 const backup=await f.api.captureBackup(f.db,f.bucket,f.scope,'SYNTHETIC OWNER'),loaded=await f.api.loadBackup(f.db,f.bucket,f.scope,backup.id);eq(loaded.snapshot.schema,'aeroplan-business-v12');
 ok(loaded.snapshot.tables.settings_versions.some(r=>r.id===head));
 const invalid=structuredClone(loaded.snapshot.tables);invalid.settings_versions.find(r=>r.id===head).data=JSON.stringify({...profile,companyName:''});
 const badSnapshot=await api.sealSnapshot(f.scope,invalid,loaded.snapshot.createdAt,loaded.snapshot.files);await assert.rejects(()=>f.api.validateSnapshot(badSnapshot,f.scope));checks++;
 const staged=await f.api.stageRestore(f.db,f.bucket,f.scope,backup.id,'SYNTHETIC OWNER');eq(staged.state,'verified');
 const newest=await call('owner','saveCompany',{data:{...profile,companyName:'SYN Current Customer'},expectedVersion:head});
 await f.db.prepare("UPDATE recovery_control SET mode='maintenance' WHERE workspace_id=?").bind(f.scope).run();
 await f.api.applyLiveRestore(f.db,f.bucket,f.scope,staged.id,'SYNTHETIC OWNER','RESTORE '+backup.id);
 eq((await state()).name,'SYN Current Customer');eq((await call('owner','getCompany')).versionId,newest.versionId,'Business restore must protect current customer configuration');
 await f.db.prepare("UPDATE recovery_control SET mode='open',epoch='initial' WHERE workspace_id=?").bind(f.scope).run();
 // A separate workspace remains untouched and does not appear in owner setup/history.
 const now=new Date().toISOString();await f.db.prepare('INSERT INTO workspaces VALUES(?,?,?,?)').bind('foreign','SYN Foreign Customer','foreign-owner',now).run();await f.db.prepare("INSERT INTO settings_versions(id,workspace_id,kind,code,data,previous_id,created_by,created) VALUES(?,'foreign','company','profile',?,NULL,'foreign',?)").bind(randomUUID(),JSON.stringify({...profile,companyName:'SYN Foreign Customer'}),now).run();
 const isolated=await call('owner','getCompany');eq(isolated.history.some(r=>r.data.companyName==='SYN Foreign Customer'),false);eq((await f.db.prepare("SELECT name FROM workspaces WHERE id='foreign'").first()).name,'SYN Foreign Customer');
 // Pagination is real: the list is 50 rows but the export explicitly describes a view.
 for(let i=0;i<53;i++)await f.call('planner','data',{kind:'task',data:{name:'SYN export '+i,reference:'SYN-EXPORT-'+i,aircraftId:f.planeId,date:'',hours:1200,cycles:'',status:'open'}});
 const page=await call('owner','readData',undefined,200,{query:'?view=workspace&page=1'}),viewFile=api.viewExport(page.records,{view:'task',page:1,query:'',status:'all',totalTasks:page.paging.counts.tasks,matchingTasks:page.paging.total});
 eq(page.paging.total,53);eq(viewFile.counts.task,50);eq(viewFile.context.totalTasks,53);eq(viewFile.completeWorkspaceExport,false);eq(viewFile.scope,'currently_loaded_records');eq(viewFile.records.length,page.records.length);eq(viewFile.records.some(r=>r.owner==='foreign'),false);
 const original=viewFile.records[0].data.name;page.records[0].data.name='SYN changed after export';eq(viewFile.records[0].data.name,original);
 eq((await f.db.prepare('SELECT COUNT(*) n FROM write_leases').first()).n,0);
 console.log(`${checks} customer setup/export checks passed: actual routes/SQLite, owner-only access, CSRF, validation, scoped history, atomic conflict/rollback, recovery epoch, protected semantic restore, unchanged aircraft and explicit 50-of-53 view export. No company acceptance claim.`);
}finally{await f.cleanup()}
