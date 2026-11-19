// Usage: node THIS_SCRIPT BASELINE_SOURCE TARGET_SOURCE
// Both source folders are inputs; all account/data writes use a disposable folder.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const baseline=path.resolve(process.argv[2]),target=path.resolve(process.argv[3]),root=await mkdtemp(path.join(os.tmpdir(),'aeroplan-0145-accounts-upgrade-'));
const load=(folder,file)=>import(pathToFileURL(path.join(folder,file)).href);
const {LocalDatabase:OldDatabase,LocalBucket:OldBucket}=await load(baseline,'selfhost/storage.mjs'),{LocalAuth:OldAuth}=await load(baseline,'selfhost/auth.mjs'),{migrate,bootstrapWorkspace}=await load(baseline,'selfhost/migrate.mjs'),{AuditIntegrity}=await load(baseline,'selfhost/audit-integrity.mjs'),{totp}=await load(baseline,'selfhost/mfa.mjs');
const {LocalDatabase}=await load(target,'selfhost/storage.mjs');
let db,child,base,output='',checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++},ok=value=>{assert(value);checks++};
const newPassword=()=>randomBytes(24).toString('base64url')+'!';
async function request(route,{cookie,form,status=200}={}){
 const bytes=form?Buffer.from(new URLSearchParams(form).toString()):undefined,headers={host:'localhost:8080',...(cookie?{cookie}:{}),...(bytes?{origin:'http://localhost:8080','Content-Type':'application/x-www-form-urlencoded','Content-Length':bytes.length}:{})};
 const response=await new Promise((resolve,reject)=>{const req=http.request(base+route,{method:bytes?'POST':'GET',headers,timeout:15000},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers:res.headers})))});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP timeout')));req.end(bytes)});
 eq(response.status,status);return response;
}
try{
 eq(JSON.parse(await readFile(path.join(baseline,'release.json'))).version,'0.14.5');
 db=new OldDatabase(path.join(root,'aeroplan.sqlite'));await migrate(db,baseline);const auth=new OldAuth(db),ownerPassword=newPassword(),owner=await auth.initializeOwner('previous-owner@example.test','SYN ORIGINAL OWNER',ownerPassword);await bootstrapWorkspace(db,owner);new AuditIntegrity(db,{initialize:true});
 const oldPassword=newPassword(),legacy=auth.invite(owner,'previous-user@example.test','SYN ORIGINAL USER','planner');await auth.activate(legacy.token,oldPassword);const setup=await auth.beginMFA(owner,ownerPassword),recovery=auth.enableMFA(owner,totp(setup.secret)),session=await auth.login(owner.email,ownerPassword,'upgrade-test',recovery[0]),legacySession=await auth.login(legacy.user.email,oldPassword,'upgrade-test');ok(session);ok(legacySession);
 const pending=auth.invite(owner,'previous-pending@example.test','SYN ORIGINAL PENDING','viewer');
 const plane=JSON.stringify({name:'TEST-G200-001',msn:'TEST-091',hours:1000,cycles:500,notes:'SYNTHETIC preserved aircraft'}),task=JSON.stringify({name:'TEST-MX-001',aircraftId:'original-plane',hours:1100,cycles:550,date:'',status:'open',reviewState:'draft',modifiedBy:owner.id});
 for(const [id,kind,data] of [['original-plane','aircraft',plane],['original-task','task',task]])await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(id,'maintenance-department',kind,data,new Date().toISOString()).run();
 const bucket=new OldBucket(db,path.join(root,'objects')),document=Buffer.from('SYNTHETIC ORIGINAL PRIVATE DOCUMENT');await bucket.put('documents/original',document);
 const tables=['_local_users','_local_auth_meta','members','_local_sessions','_local_enrollment','_local_mfa'],prior=Object.fromEntries(tables.map(table=>[table,db.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),migrations=db.sqlite.prepare('SELECT * FROM _local_migrations ORDER BY name').all(),keys={};for(const key of ['authentication.key','audit-signing.key'])keys[key]=await readFile(path.join(root,key));db.close();db=null;
 child=spawn(process.execPath,['selfhost/server.mjs'],{cwd:target,env:{...process.env,AEROPLAN_DATA_DIR:root,PORT:'0',HOST:'127.0.0.1',PUBLIC_URL:'http://localhost:8080'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timed out')),20000);child.once('exit',code=>{clearTimeout(timeout);reject(Error('Server exited: '+code+' '+output))});child.stderr.on('data',part=>{output+=part});child.stdout.on('data',part=>{output+=part;const port=output.match(/listening on port (\d+)/)?.[1];if(port){base='http://127.0.0.1:'+port;clearTimeout(timeout);resolve()}})});
 const cookie='aeroplan_session='+session.token,health=await (await request('/healthz')).json();eq(health.version,'0.14.6');eq(health.buildFingerprint,JSON.parse(await readFile(path.join(target,'dist-node/build-fingerprint.json'))).fingerprint);
 const data=await (await request('/api/data',{cookie})).json();eq(data.session.userId,owner.id);eq(data.records.find(r=>r.id==='original-plane').data,JSON.parse(plane));eq(data.records.find(r=>r.id==='original-task').data,JSON.parse(task));await request('/api/data',{cookie:'aeroplan_session='+legacySession.token});
 for(const role of ['reviewer','approver']){const password=newPassword(),email='upgrade-'+role+'@example.test';const html=await (await request('/auth/admin/create',{cookie,form:{name:role,email,role,password,confirm:password}})).text();ok(html.includes('تم إنشاء الحساب وتفعيله'));ok(!html.includes(password));const logged=await request('/auth/login',{form:{email,password},status:303});ok(logged.headers.get('set-cookie')?.includes('aeroplan_session='))}
 const exit=once(child,'exit');child.kill('SIGTERM');await exit;eq(child.exitCode,0);child=null;
 db=new LocalDatabase(path.join(root,'aeroplan.sqlite'));
 for(const table of tables){const after=db.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();for(const row of prior[table])ok(after.some(candidate=>JSON.stringify(candidate)===JSON.stringify(row)))}
 eq(db.sqlite.prepare('SELECT * FROM _local_migrations ORDER BY name').all(),migrations);eq(db.sqlite.prepare("SELECT data FROM records WHERE id='original-plane'").get().data,plane);eq(db.sqlite.prepare("SELECT data FROM records WHERE id='original-task'").get().data,task);for(const key of Object.keys(keys))eq(await readFile(path.join(root,key)),keys[key]);const {LocalBucket}=await load(target,'selfhost/storage.mjs');eq(Buffer.from(await (await new LocalBucket(db,path.join(root,'objects')).get('documents/original')).arrayBuffer()),document);eq(db.auditIntegrity.verify().valid,true);
 const {LocalAuth}=await load(target,'selfhost/auth.mjs'),current=new LocalAuth(db),pendingPassword=newPassword();await current.activate(pending.token,pendingPassword);ok(await current.login(pending.user.email,pendingPassword,'upgrade-test'));ok(await current.login(legacy.user.email,oldPassword,'upgrade-test'));ok(await current.login(owner.email,ownerPassword,'upgrade-test',recovery[1]));eq(db.auditIntegrity.verify().valid,true);
 console.log(JSON.stringify({checks,baseline:'0.14.5',target:'0.14.6',actualPreviousAuthUsed:true,newProductionHttp:true,oldOwnerPasswordsSessionsMembershipMFAKeysAndPendingLink:'preserved',aircraftTaskAndDocument:'exact original bytes',newReviewerApproverLogin:'passed',newMigrations:0,syntheticFixture:true,windowsDockerExecuted:false}));
}finally{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit}db?.close();await rm(root,{recursive:true,force:true})}
