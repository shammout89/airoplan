import {SELFHOST_VERSION} from './release.mjs';
import {totp} from './mfa.mjs';
// Exercises the built production server over real HTTP, in a disposable data directory.
import assert from 'node:assert/strict';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {LocalDatabase} from './storage.mjs';
import {LocalAuth} from './auth.mjs';

const directory=await mkdtemp(path.join(os.tmpdir(),'aeroplan-http-test-'));
const containerMode=process.env.AEROPLAN_HTTP_DOCKER==='1';
const volume='aeroplan-test-'+randomUUID(),container=volume+'-app',image=process.env.AEROPLAN_DOCKER_IMAGE||'aeroplan:test';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let child,base,output='',checks=0;
let origin='http://localhost:8080';
async function launch(){
  if(containerMode){
    docker('run','--detach','--init','--name',container,'--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--env','PUBLIC_URL='+origin,'--publish','127.0.0.1::3000','--volume',volume+':/var/lib/aeroplan',image);
    base='http://'+docker('port',container,'3000/tcp');
    for(let n=0;n<100;n++){
      try{await request('/healthz');docker('exec',container,'node','selfhost/healthcheck.mjs');return}catch{await new Promise(resolve=>setTimeout(resolve,200))}
    }
    throw Error('Container health timed out: '+docker('logs',container));
  }
  output='';
  child=spawn(process.execPath,['selfhost/server.mjs'],{env:{...process.env,AEROPLAN_DATA_DIR:directory,PORT:'0',HOST:'127.0.0.1',PUBLIC_URL:origin},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',b=>{output+=b});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Production server startup timed out: '+output)),20000);
    const failed=code=>{clearTimeout(timeout);reject(Error('Production server exited '+code+': '+output))};
    child.once('exit',failed);
    child.stdout.on('data',b=>{output+=b;const port=output.match(/listening on port (\d+)/)?.[1];if(port){base='http://127.0.0.1:'+port;clearTimeout(timeout);child.off('exit',failed);resolve()}});
  });
}
async function stop(){
  if(containerMode){
    try{docker('inspect',container)}catch{return}
    docker('stop','--time','15',container);const code=docker('inspect','--format','{{.State.ExitCode}}',container),logs=docker('logs',container);docker('rm',container);assert.equal(code,'0',logs);return;
  }
  if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;assert.equal(child.exitCode,0,output)}
}
async function request(url,{cookie,body,form,method=body||form?'POST':'GET',headers={},status=200}={}){
  if(url==='/api/workflow'&&body?.id&&body.expectedRevision===undefined&&cookie){const current=await (await request('/api/data?view=record&id='+encodeURIComponent(body.id),{cookie})).json();const plane=await (await request('/api/data?view=record&id='+encodeURIComponent(current.record.data.aircraftId),{cookie})).json();body={...body,expectedRevision:current.record.data._revision,expectedAircraftRevision:plane.record.data._revision};}
  const h={host:'localhost:8080',...(!['GET','HEAD'].includes(method)?{origin}:{}),...(cookie?{cookie}:{}),...headers};
  if(h.origin===null)delete h.origin;
  if(body)h['Content-Type']='application/json';
  let bytes=body?Buffer.from(JSON.stringify(body)):undefined;
  if(form){const encoded=new Request(base+url,{method,body:form});bytes=Buffer.from(await encoded.arrayBuffer());h['Content-Type']=encoded.headers.get('content-type')}
  if(bytes)h['Content-Length']=String(bytes.length);
  const response=await new Promise((resolve,reject)=>{
    const req=http.request(base+url,{method,headers:h,timeout:15000},res=>{
      const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers:res.headers})));
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP test timeout')));req.end(bytes);
  });
  assert.equal(response.status,status,`${url}: ${await (response.status!==status?response.clone().text():Promise.resolve(''))}`);assert.equal(response.headers.get('referrer-policy'),'same-origin',url+' must preserve browser form origins');assert.equal(response.headers.get('x-aeroplan-release'),SELFHOST_VERSION);checks++;return response;
}
const form=value=>new URLSearchParams(value);
async function login(email,password='Docker-test-only!123'){
  const response=await request('/auth/login',{form:form({email,password}),status:303});
  const set=response.headers.get('set-cookie');assert.match(set,/HttpOnly/);assert.match(set,/SameSite=Strict/);
  if(origin.startsWith('https:'))assert.match(set,/; Secure/);
  return set.split(';')[0];
}
try{
  if(containerMode){
    docker('volume','create',volume);
    docker('run','--rm','--network','none','--volume',volume+':/var/lib/aeroplan','--entrypoint','node',image,'--input-type=module','-e',"import {localRuntime} from './selfhost/runtime.mjs';import {LocalAuth} from './selfhost/auth.mjs';const {db}=localRuntime();await new LocalAuth(db).initializeOwner('docker-owner@example.test','Synthetic owner','Docker-test-only!123');db.close();");
  }else{
    const db=new LocalDatabase(path.join(directory,'aeroplan.sqlite'));
    await new LocalAuth(db).initializeOwner('docker-owner@example.test','مدير تجريبي','Docker-test-only!123');db.close();
  }
  await launch();
  if(!containerMode){const result=spawnSync(process.execPath,['selfhost/healthcheck.mjs'],{env:{...process.env,PUBLIC_URL:origin,PORT:new URL(base).port}});assert.equal(result.status,0,result.stderr.toString())}
  assert.equal((await (await request('/healthz')).json()).status,'ok');
  assert.equal((await (await request('/healthz')).json()).version,SELFHOST_VERSION);
  await request('/auth/session',{status:401});
  for(const asset of ['/auth/session-sync.js','/auth/session-page.js']){const resource=await request(asset);assert.match(resource.headers.get('content-type'),/javascript/);assert((await resource.text()).length>0)}
  await request('/api/schedule-variations',{status:401});
  await request('/api/data',{status:401,headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'shammout89@gmail.com'}});
  assert.equal((await request('/',{status:303})).headers.get('location'),'/auth/login');
  assert.match(await (await request('/auth/login')).text(),/dir="rtl"/);
  await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Docker-test-only!123'}),headers:{origin:'https://evil.test'},status:403});
  for(const invalidOrigin of [null,'null'])await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Docker-test-only!123'}),headers:{origin:invalidOrigin,referer:origin+'/auth/login'},status:403});
  await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'wrong'}),status:401});
  await request('/healthz',{headers:{host:'evil.test'},status:421});
  let ownerCookie=await login('docker-owner@example.test');
  const state=await (await request('/api/data',{cookie:ownerCookie})).json();assert.equal(state.session.role,'admin');assert.equal(state.session.authProvider,'local');
  const ownerId=state.session.userId,epoch=state.session.recoveryEpoch;
  const setupBefore=await (await request('/api/company',{cookie:ownerCookie})).json();assert.equal(setupBefore.versionId,null);assert.equal(setupBefore.operationalAcceptance,'requires_independent_verification');
  await request('/api/company',{status:401});
  await request('/api/company',{cookie:ownerCookie,body:{data:{companyName:'SYN HTTP Airline',departmentName:'SYN Planning',reference:'SYNTHETIC ONLY',changeReason:'SYN initial company setup'},expectedVersion:null},headers:{origin:'https://evil.test'},status:403});
  const companyBody={data:{companyName:'SYN HTTP Airline',departmentName:'SYN Planning',reference:'SYNTHETIC ONLY',changeReason:'SYN initial company setup'},expectedVersion:null};
  const setupSaved=await (await request('/api/company',{cookie:ownerCookie,body:companyBody})).json();assert(setupSaved.versionId);assert.equal(setupSaved.profile.companyName,'SYN HTTP Airline');
  assert.equal((await (await request('/api/data?view=workspace',{cookie:ownerCookie})).json()).session.workspace,'SYN HTTP Airline');
  await request('/api/company',{cookie:ownerCookie,body:companyBody,status:409});
  assert.equal((await (await request('/api/company',{cookie:ownerCookie})).json()).history.length,1);

  const variations=await (await request('/api/schedule-variations',{cookie:ownerCookie})).json();assert.deepEqual(variations,{items:[],evidence:[]});await request('/api/schedule-variations',{cookie:ownerCookie,body:{action:'save'},headers:{origin:'https://evil.test'},status:403});
  await request('/api/local-services',{status:401});await request('/api/local-metrics',{status:401});await request('/readyz');
  await request('/api/system-service',{body:{action:'state'},headers:{Authorization:'Bearer forged-service-secret'},status:404});
  const services=(await (await request('/api/local-services',{cookie:ownerCookie})).json());assert.equal(services.configured.operations,false);assert.equal(services.configured.smtp,false);assert.equal(services.policy.email.enabled,false);
  const metrics=(await (await request('/api/local-metrics',{cookie:ownerCookie})).json());assert(metrics.requests>0);assert(metrics.memory.rssBytes>0);assert.equal(metrics.version,SELFHOST_VERSION);
  await request('/api/local-services',{cookie:ownerCookie,body:{action:'preview',source:'operations'},status:409});
  await request('/api/local-services',{cookie:ownerCookie,body:{action:'configure',policy:{integrations:{operations:{enabled:false,autoCommit:false,intervalMinutes:30}},email:{enabled:false,intervalMinutes:5}}}});
  await request('/api/local-services',{cookie:ownerCookie,body:{action:'reload'},headers:{origin:'https://evil.test'},status:403});
  const provenance=await (await request('/healthz')).json(),acceptanceBuild=await (await request('/api/acceptance',{cookie:ownerCookie})).json();assert.match(provenance.buildFingerprint,/^[a-f0-9]{64}$/);assert.equal(acceptanceBuild.buildFingerprint,provenance.buildFingerprint);
  const identity=await (await request('/auth/session',{cookie:ownerCookie})).json();assert.equal(identity.userId,state.session.userId);assert.match(identity.sessionId,/^[a-f0-9]{64}$/);
  assert.notEqual(identity.sessionId,ownerCookie.split('=')[1]);assert.notEqual(identity.sessionId,createHash('sha256').update(ownerCookie.split('=')[1]).digest('hex'));
  await request('/api/data',{cookie:'aeroplan_session='+identity.sessionId,status:401});
  const account=await (await request('/auth/account',{cookie:ownerCookie})).text();
  assert.match(account,/<details><summary>تغيير كلمة المرور/);assert.match(account,/action="\/auth\/logout" data-auth-action="logout"/);assert.match(account,/action="\/auth\/logout-all"/);assert.match(account,/src="\/auth\/session-page.js"/);
  for(const path of ['/auth/logout','/auth/logout-all']){
    await request(path,{cookie:ownerCookie,status:405});
    for(const bad of ['https://evil.test','null',null])await request(path,{cookie:ownerCookie,form:form({}),headers:{origin:bad},status:403});
  }
  assert.equal((await (await request('/auth/session',{cookie:ownerCookie})).json()).sessionId,identity.sessionId);

  assert.match(await (await request('/',{cookie:ownerCookie})).text(),/AeroPlan/);
  const home=await (await request('/',{cookie:ownerCookie})).text();
  const asset=home.match(/(?:src|href)="([^"\s]+\.(?:js|css))"/)?.[1];assert(asset,'SSR must reference a client asset');
  assert((await (await request(asset,{cookie:ownerCookie})).arrayBuffer()).byteLength>0);
  await request('/api/data',{cookie:ownerCookie,body:{kind:'aircraft',data:{}},headers:{origin:'https://evil.test'},status:403});
  // Legacy entry points only lead to the single settings screen; they do not create users.
  assert.equal((await request('/auth/admin',{cookie:ownerCookie,status:303})).headers.get('location'),'/?settings=team');
  assert.match(account,/href="\/\?settings=team"/);
  for(const action of ['create','invite','reset'])assert.equal((await request('/auth/admin/'+action,{cookie:ownerCookie,form:form({email:'legacy-path@example.test',role:'viewer'}),status:303})).headers.get('location'),'/?settings=team');
  assert(!(await (await request('/api/team',{cookie:ownerCookie})).json()).members.some(member=>member.email==='legacy-path@example.test'));
  const createForm={action:'create',name:'مراجع الاختبار',email:'no-partial-account@example.test',role:'reviewer',password:'Docker-test-only!123',confirm:'different-password!123'};
  await request('/api/team',{body:createForm,status:401});
  for(const badOrigin of ['https://evil.test','null',null])await request('/api/team',{cookie:ownerCookie,body:createForm,headers:{origin:badOrigin},status:403});
  const beforeFailure=await (await request('/api/team',{cookie:ownerCookie})).json();
  const mismatched=await (await request('/api/team',{cookie:ownerCookie,body:createForm,status:400})).json();
  assert.match(mismatched.error,/كلمتا المرور غير متطابقتين/);assert(!JSON.stringify(mismatched).includes(createForm.password));assert(!JSON.stringify(mismatched).includes(createForm.confirm));
  for(const badPassword of ['', 'short', 'x'.repeat(129)]){const rejected=await (await request('/api/team',{cookie:ownerCookie,body:{...createForm,password:badPassword,confirm:badPassword},status:400})).json();assert.match(rejected.error,/12 إلى 128/)}
  await request('/api/team',{cookie:ownerCookie,body:{...createForm,password:'Docker-test-only!123',confirm:'Docker-test-only!123',role:'owner'},status:400});
  await request('/api/team',{cookie:ownerCookie,body:{email:'membership-only@example.test',role:'viewer'},status:400});
  assert.deepEqual((await (await request('/api/team',{cookie:ownerCookie})).json()).members,beforeFailure.members);
  const people={};
  for(const role of ['planner','reviewer','approver','viewer']){
    const direct=['reviewer','approver'].includes(role),response=await request('/api/team',{cookie:ownerCookie,body:{action:direct?'create':'invite',email:role+'@example.test',name:role,role,...(direct?{password:'Docker-test-only!123',confirm:'Docker-test-only!123'}:{})}});
    const result=await response.json(),token=result.activationURL?new URL(result.activationURL).searchParams.get('token'):undefined;
    if(direct){assert.equal(token,undefined);assert(!JSON.stringify(result).includes('Docker-test-only!123'));await request('/auth/login',{form:form({email:role+'@example.test',password:'wrong-password!123'}),status:401})}
    else{assert(token);assert.equal(new URL(result.activationURL).origin,origin);await request('/auth/activate',{form:form({token,password:'Docker-test-only!123',confirm:'Docker-test-only!123'})});await request('/auth/activate',{form:form({token,password:'Docker-test-only!123',confirm:'Docker-test-only!123'}),status:400})}
    people[role]=await login(role+'@example.test');
  }
  for(const role of ['reviewer','approver','viewer'])await request('/api/team',{cookie:people[role],body:createForm,status:403});
  await request('/api/team',{cookie:ownerCookie,body:{action:'create',email:'REVIEWER@example.test',name:'Duplicate',role:'approver',password:'Docker-test-only!456',confirm:'Docker-test-only!456'},status:400});
  const originalOwner=await (await request('/auth/session',{cookie:ownerCookie})).json();assert.equal(originalOwner.userId,ownerId);assert.equal(originalOwner.sessionId,identity.sessionId);
  await request('/auth/admin',{cookie:people.viewer,status:403});
  const viewer=await (await request('/api/data',{cookie:people.viewer,headers:{'oai-authenticated-user-id':ownerId,'oai-authenticated-user-email':'docker-owner@example.test','x-forwarded-host':'evil.test','x-forwarded-proto':'https'}})).json();
  assert.equal(viewer.session.role,'viewer');
  const guard={'X-AeroPlan-Epoch':epoch};
  await request('/api/data',{cookie:people.planner,headers:guard,body:{kind:'aircraft',data:{name:'HTTP-DRAFT',profileStatus:'verified',profileVerifiedBy:'forged'}}});
  await request('/api/local-services',{cookie:people.viewer,status:403});await request('/api/local-metrics',{cookie:people.planner,status:403});await request('/api/notifications',{cookie:people.viewer});
  const draftCard=(await (await request('/api/data',{cookie:ownerCookie})).json()).records.find(r=>r.data.name==='HTTP-DRAFT');assert.equal(draftCard.data.profileStatus,'draft');assert.equal(draftCard.data.hours,null);assert.equal(draftCard.data.profileVerifiedBy,undefined);
  await request('/api/data',{cookie:people.planner,headers:guard,status:400,body:{kind:'aircraft',id:draftCard.id,action:'activateAircraft',data:draftCard.data}});
  await request('/api/data',{cookie:people.planner,headers:guard,status:409,body:{kind:'task',data:{name:'Blocked incomplete aircraft',aircraftId:draftCard.id,hours:100,cycles:'',date:'',status:'open'}}});
  const catalogue={};
  for(const [type,name,parent] of [['manufacturer','SYNTHETIC',null],['family','SYNTHETIC FAMILY','manufacturer'],['variant','A320','family'],['country','TEST',null],['authority','SYNTHETIC AUTHORITY','country']]){const created=await (await request('/api/aircraft-references',{cookie:ownerCookie,headers:guard,body:{action:'save',data:{type,name,parentId:parent?catalogue[parent]:null,active:true}}})).json();catalogue[type]=created.id;}
  const aircraft={kind:'aircraft',action:'activateAircraft',data:{name:'HTTP-TEST-001',catalogRefs:catalogue,family:'SYNTHETIC FAMILY',authority:'SYNTHETIC AUTHORITY',manufacturer:'SYNTHETIC',model:'A320',msn:'HTTP-SYNTHETIC-001',registrationCountry:'TEST',fleetStatus:'in_service',counterAsOf:'2026-01-01T00:00:00.000Z',counterSource:'HTTP TEST ONLY',counterConfirmed:true,hours:100,cycles:30,custom:{}}};
  await request('/api/data',{cookie:people.viewer,body:aircraft,headers:{...guard,'oai-authenticated-user-id':ownerId,'oai-authenticated-user-email':'docker-owner@example.test'},status:403});
  await request('/api/data',{cookie:people.planner,body:aircraft,headers:guard});
  const plane=(await (await request('/api/data',{cookie:ownerCookie})).json()).records.find(r=>r.data.name===aircraft.data.name);assert(plane);
  await request('/api/data',{cookie:people.planner,headers:guard,body:{kind:'task',data:{name:'HTTP task',aircraftId:plane.id,date:'',hours:200,cycles:'',status:'open',custom:{}}}});
  const task=(await (await request('/api/data',{cookie:ownerCookie})).json()).records.find(r=>r.kind==='task');assert(task);
  await request('/api/workflow',{cookie:people.planner,headers:guard,body:{id:task.id,action:'submit'}});
  await request('/api/workflow',{cookie:people.planner,headers:guard,body:{id:task.id,action:'review'},status:403});
  await request('/api/workflow',{cookie:people.reviewer,headers:guard,body:{id:task.id,action:'review'}});
  await request('/api/workflow',{cookie:people.approver,headers:guard,body:{id:task.id,action:'approve'}});
  // Versioned task policy and both approval routes over real authenticated production HTTP.
  await request('/api/task-approval-policy',{status:401});await request('/?settings=policy',{cookie:ownerCookie});
  const originalPolicy=await (await request('/api/task-approval-policy',{cookie:ownerCookie})).json();assert.equal(originalPolicy.current.id,'default');
  assert.equal((await (await request('/api/task-approval-policy',{cookie:people.reviewer})).json()).canEdit,false);
  const twoPolicy={...originalPolicy.current.data,routineMode:'two_person',technicalMode:'two_person',procedureReference:'SYN-HTTP-PROC',changeReason:'SYNTHETIC two-person HTTP policy test',combinedAcknowledged:true};
  await request('/api/task-approval-policy',{cookie:people.reviewer,headers:guard,body:{previousId:'default',data:twoPolicy},status:403});
  await request('/api/task-approval-policy',{cookie:ownerCookie,headers:{...guard,origin:'https://evil.test'},body:{previousId:'default',data:twoPolicy},status:403});
  const twoSaved=await (await request('/api/task-approval-policy',{cookie:ownerCookie,headers:guard,body:{previousId:'default',data:twoPolicy}})).json();
  await request('/api/settings',{cookie:ownerCookie,headers:guard,body:{kind:'approval',code:'task',previousId:twoSaved.id,data:twoPolicy},status:403});
  await request('/api/data',{cookie:people.planner,headers:guard,body:{kind:'task',data:{name:'SYN HTTP combined approval',reference:'HTTP-TWO-001',aircraftId:plane.id,date:'',hours:220,cycles:60,status:'open'}}});
  const httpTwo=(await (await request('/api/data',{cookie:ownerCookie})).json()).records.find(r=>r.data.reference==='HTTP-TWO-001');assert.equal(httpTwo.data.taskApproval.mode,'two_person');
  await request('/api/workflow',{cookie:people.planner,headers:guard,body:{id:httpTwo.id,action:'submit'}});
  await request('/api/task-approval-policy',{cookie:ownerCookie,headers:guard,body:{previousId:twoSaved.id,data:{...twoPolicy,routineMode:'three_person',technicalMode:'three_person',combinedAcknowledged:false,changeReason:'SYNTHETIC switch policy with request pending'}}});
  const reviewConfirmations={identityAndApplicability:true,limitsAndSource:true,evidenceAndChanges:true};
  await request('/api/workflow',{cookie:people.reviewer,headers:guard,body:{id:httpTwo.id,action:'review'},status:409});
  await request('/api/workflow',{cookie:people.reviewer,headers:guard,body:{id:httpTwo.id,action:'approve',reviewConfirmations,reviewNote:'SYNTHETIC unauthorized review'},status:403});
  await request('/api/workflow',{cookie:people.approver,headers:guard,body:{id:httpTwo.id,action:'approve'},status:400});
  const frozen=await (await request('/api/task-approval-policy?taskId='+httpTwo.id,{cookie:people.approver})).json();assert.equal(frozen.task.taskApproval.settingId,twoSaved.id);
  await request('/api/workflow',{cookie:people.approver,headers:guard,body:{id:httpTwo.id,action:'approve',expectedRevision:frozen.task._revision,expectedAircraftRevision:frozen.aircraft.data._revision,reviewConfirmations,reviewNote:'SYNTHETIC HTTP technical review and independent approval'}});
  await request('/api/workflow',{cookie:people.approver,headers:guard,body:{id:httpTwo.id,action:'approve',expectedRevision:frozen.task._revision,expectedAircraftRevision:frozen.aircraft.data._revision,reviewConfirmations,reviewNote:'SYNTHETIC duplicate stale approval'},status:409});
  const decided=await (await request('/api/task-approval-policy?taskId='+httpTwo.id,{cookie:people.viewer})).json();assert.equal(decided.task.reviewState,'approved');assert.equal(decided.task.reviewedBy,decided.task.approvedBy);assert.equal(decided.task.taskApproval.decision.combined,true);assert.equal(decided.events[0].taskEvent.event,'approve');assert.deepEqual(decided.events.map(e=>e.taskEvent.sequence),[3,2,1]);
  const bytes=Buffer.from('%PDF-1.4\n% synthetic Docker test evidence\n%%EOF\n');
  const upload=new FormData();upload.set('file',new Blob([bytes],{type:'application/pdf'}),'evidence.pdf');upload.set('code','DOCKER-HTTP');upload.set('title','مستند تجريبي');upload.set('revision','01');upload.set('linkType','aircraft');upload.set('linkId',plane.id);
  await request('/api/documents',{cookie:ownerCookie,headers:guard,form:upload});
  const docs=await (await request('/api/documents',{cookie:ownerCookie})).json();const version=docs.versions[0];assert(version);
  assert.deepEqual(Buffer.from(await (await request('/api/documents?version='+version.id,{cookie:ownerCookie})).arrayBuffer()),bytes);
  await request('/api/documents?version='+version.id,{cookie:people.viewer,status:403});
  const backup=await (await request('/api/recovery',{cookie:ownerCookie,body:{action:'create'}})).json();assert.equal(backup.manifest.files.length,1);assert.equal(backup.manifest.files[0].digest,version.digest);assert.equal(backup.digest.length,64);
  const drill=await (await request('/api/recovery',{cookie:ownerCookie,body:{action:'drill',backupId:backup.id}})).json();assert.equal(drill.state,'verified');
  const team=await (await request('/api/team',{cookie:ownerCookie})).json(),member=team.members.find(m=>m.email==='viewer@example.test');
  await request('/api/team',{cookie:ownerCookie,headers:guard,body:{id:member.id,role:'viewer',state:'disabled'}});
  await request('/api/data',{cookie:people.viewer,status:401});
  await stop();await launch();
  const recovered=await (await request('/api/data',{cookie:ownerCookie})).json();
  assert.equal(recovered.records.find(r=>r.id===task.id).data.reviewState,'approved');
  assert(recovered.records.some(r=>r.id===plane.id));assert.equal(recovered.records.find(r=>r.id===httpTwo.id).data.taskApproval.decision.combined,true);
  assert.deepEqual(Buffer.from(await (await request('/api/documents?version='+version.id,{cookie:ownerCookie})).arrayBuffer()),bytes);
  assert((await (await request('/api/recovery',{cookie:ownerCookie})).json()).backups.some(b=>b.id===backup.id));
  const independent=await login('docker-owner@example.test');
  const currentBefore=await (await request('/auth/session',{cookie:ownerCookie})).json();
  const endedResponse=await request('/auth/logout',{cookie:ownerCookie,form:form({}),headers:{Accept:'application/json'}});
  const ended=await endedResponse.json();assert.equal(ended.event.all,false);assert.equal(ended.event.sessionId,currentBefore.sessionId);assert.match(endedResponse.headers.get('set-cookie'),/Max-Age=0/);
  await request('/auth/session',{cookie:ownerCookie,status:401});await request('/api/data',{cookie:ownerCookie,status:401});await request('/api/documents',{cookie:ownerCookie,status:401});
  await request('/api/data',{cookie:independent});
  ownerCookie=independent;
  const secondDevice=await login('docker-owner@example.test');
  const plannerIdentity=await (await request('/auth/session',{cookie:people.planner})).json();
  const allResponse=await request('/auth/logout-all',{cookie:ownerCookie,form:form({userId:plannerIdentity.userId}),headers:{Accept:'application/json'}});
  const allEnded=await allResponse.json();assert.equal(allEnded.event.all,true);assert.equal(allEnded.event.userId,ownerId);assert.match(allResponse.headers.get('set-cookie'),/Max-Age=0/);
  await request('/api/data',{cookie:ownerCookie,status:401});await request('/api/data',{cookie:secondDevice,status:401});await request('/api/data',{cookie:people.planner});
  await request('/auth/logout-all',{form:form({}),headers:{Accept:'application/json'},status:401});
  ownerCookie=await login('docker-owner@example.test');
  const passwordDevice=await login('docker-owner@example.test');
  await request('/auth/password',{cookie:ownerCookie,form:form({current:'wrong',password:'Changed-test-only!456',confirm:'Changed-test-only!456'}),headers:{Accept:'application/json'},status:400});
  await request('/api/data',{cookie:ownerCookie});await request('/api/data',{cookie:passwordDevice});
  const passwordChanged=await (await request('/auth/password',{cookie:ownerCookie,form:form({current:'Docker-test-only!123',password:'Changed-test-only!456',confirm:'Changed-test-only!456'}),headers:{Accept:'application/json'}})).json();
  assert.equal(passwordChanged.event.all,true);await request('/api/data',{cookie:passwordDevice,status:401});

  await request('/api/data',{cookie:ownerCookie,status:401});
  const newCookie=await login('docker-owner@example.test','Changed-test-only!456');
  await request('/auth/logout',{cookie:newCookie,form:form({}),status:303});
  await request('/api/data',{cookie:newCookie,status:401});
  await stop();origin='https://localhost:8080';await launch();
  const secureCookie=await login('docker-owner@example.test','Changed-test-only!456');
  const secureState=await (await request('/api/data',{cookie:secureCookie})).json();
  assert.equal(secureState.session.role,'admin');const strictTransport=await request('/readyz');assert.equal(strictTransport.headers.get('strict-transport-security'),'max-age=31536000');
  await request('/api/data',{cookie:secureCookie,body:{...aircraft,data:{...aircraft.data,name:'HTTPS-PROXY-TEST',msn:'HTTP-SYNTHETIC-002'}},headers:{'X-AeroPlan-Epoch':secureState.session.recoveryEpoch}});
  const nativeOther=await login('docker-owner@example.test','Changed-test-only!456');
  await request('/auth/logout-all',{cookie:secureCookie,form:form({}),status:303});
  await request('/api/data',{cookie:secureCookie,status:401});await request('/api/data',{cookie:nativeOther,status:401});await request('/api/data',{cookie:people.planner});
  const auditCookie=await login('docker-owner@example.test','Changed-test-only!456');const auditStatus=await (await request('/api/local-audit',{cookie:auditCookie})).json();assert.equal(auditStatus.valid,true);assert(auditStatus.events>0);await request('/auth/audit',{cookie:auditCookie});await request('/api/local-audit',{cookie:people.planner,status:403});const signedAudit=await (await request('/api/local-audit?format=export',{cookie:auditCookie})).json();const {verifyAuditExport}=await import('./audit-integrity.mjs');assert.equal(verifyAuditExport(signedAudit,auditStatus.anchor.keyId).valid,true);
  const mfaCookie=await login('docker-owner@example.test','Changed-test-only!456');
  await request('/auth/mfa',{cookie:mfaCookie});
  await request('/auth/mfa/begin',{cookie:mfaCookie,form:form({current:'Changed-test-only!456'}),headers:{origin:null},status:403});
  await request('/auth/mfa/begin',{cookie:mfaCookie,form:form({current:'wrong'}),status:400});
  const setupHTML=await (await request('/auth/mfa/begin',{cookie:mfaCookie,form:form({current:'Changed-test-only!456'})})).text();
  const secret=setupHTML.match(/<strong>([A-Z2-7]{32})<\/strong>/)?.[1];assert(secret,'setup secret must appear only in the authenticated setup response');
  assert(setupHTML.includes('<svg class="mfa-qr"'),'setup must provide an inline local QR code');assert(setupHTML.includes('الإدخال اليدوي بدل المسح'));
  const failedSetup=await (await request('/auth/mfa/enable',{cookie:mfaCookie,form:form({otp:'not-a-code'}),status:400})).text();
  assert(failedSetup.includes('action="/auth/mfa/enable"'),'an invalid code must preserve the confirmation step');assert(!failedSetup.includes(secret),'failed confirmation must not expose the key without a password');assert(!failedSetup.includes('<svg class="mfa-qr"'));
  const resumedSetup=await (await request('/auth/mfa',{cookie:mfaCookie})).text();assert(resumedSetup.includes('action="/auth/mfa/enable"'));assert(!resumedSetup.includes(secret));
  const token=totp(secret),formattedToken=token.replace(/\d/g,d=>String.fromCharCode(0x660+Number(d))).replace(/(.{3})/,'$1 '),enabledHTML=await (await request('/auth/mfa/enable',{cookie:mfaCookie,form:form({otp:formattedToken})})).text();
  const recoveryCodes=enabledHTML.match(/\b[A-F0-9]{4}(?:-[A-F0-9]{4}){7}\b/g);assert.equal(recoveryCodes.length,10);
  await request('/api/data',{cookie:mfaCookie,status:401});
  await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Changed-test-only!456'}),status:401});
  await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Changed-test-only!456',otp:token}),status:401});
  const mfaSigned=await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Changed-test-only!456',otp:recoveryCodes[0]}),status:303}),mfaSession=mfaSigned.headers.get('set-cookie').split(';')[0];
  await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Changed-test-only!456',otp:recoveryCodes[0]}),status:401});
  await request('/api/data',{cookie:mfaSession});
  await request('/auth/mfa/policy',{cookie:mfaSession,form:form({current:'Changed-test-only!456',otp:recoveryCodes[1],role_admin:'1',role_planner:'1'})});
  const enrollmentRequired=await (await request('/api/data',{cookie:people.planner,status:403})).json();assert.equal(enrollmentRequired.setupURL,'/auth/mfa');
  await request('/auth/mfa',{cookie:people.planner});
  await request('/auth/mfa/disable',{cookie:mfaSession,form:form({current:'Changed-test-only!456',otp:recoveryCodes[2]}),status:400});
  await request('/auth/mfa/policy',{cookie:mfaSession,form:form({current:'Changed-test-only!456',otp:recoveryCodes[2]})});
  await request('/api/data',{cookie:people.planner});
  await request('/auth/mfa/recovery',{cookie:mfaSession,form:form({current:'Changed-test-only!456',otp:recoveryCodes[3]}),headers:{origin:null},status:403});
  await request('/auth/mfa/recovery',{cookie:mfaSession,form:form({current:'wrong',otp:recoveryCodes[3]}),status:400});
  const renewedHTML=await (await request('/auth/mfa/recovery',{cookie:mfaSession,form:form({current:'Changed-test-only!456',otp:recoveryCodes[3]})})).text(),renewedCodes=renewedHTML.match(/\b[A-F0-9]{4}(?:-[A-F0-9]{4}){7}\b/g);assert.equal(renewedCodes.length,10);
  await request('/api/data',{cookie:mfaSession,status:401});
  await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Changed-test-only!456',otp:recoveryCodes[4]}),status:401});
  const renewedLogin=await request('/auth/login',{form:form({email:'docker-owner@example.test',password:'Changed-test-only!456',otp:renewedCodes[0]}),status:303}),renewedSession=renewedLogin.headers.get('set-cookie').split(';')[0];
  await request('/auth/mfa/disable',{cookie:renewedSession,form:form({current:'Changed-test-only!456',otp:renewedCodes[1]}),status:303});
  await request('/api/data',{cookie:mfaSession,status:401});
  await login('docker-owner@example.test','Changed-test-only!456');
  console.log(`${checks} production HTTP checks passed (${containerMode?'Docker image':'Node process'}): local authentication, spoof/CSRF denial, SSR/assets, four roles, independent approval, file integrity, backup/drill, disabled membership, session revocation and restart persistence.`);
}finally{await stop();if(containerMode)docker('volume','rm',volume);await rm(directory,{recursive:true,force:true})}
