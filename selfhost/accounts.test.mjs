// Real SQLite account creation, compatibility, atomic failures and restore.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {LocalDatabase,LocalBucket} from './storage.mjs';
import {LocalAuth} from './auth.mjs';
import {migrate,bootstrapWorkspace} from './migrate.mjs';
import {AuditIntegrity} from './audit-integrity.mjs';
import {totp} from './mfa.mjs';
import {captureFullBackup,restoreFullBackup} from './full-backup.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'aeroplan-accounts-')),dataDir=path.join(root,'data'),file=path.join(dataDir,'aeroplan.sqlite');
let db=new LocalDatabase(file),restored,checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++},ok=value=>{assert(value);checks++};
const rejects=async(fn,match)=>{await assert.rejects(fn,match);checks++};
const password=()=>randomBytes(20).toString('base64url')+'-test!';
try{
 await migrate(db);
 let auth=new LocalAuth(db);
 const ownerPassword=password(),owner=await auth.initializeOwner('owner@example.test','SYN ORIGINAL OWNER',ownerPassword);
 await bootstrapWorkspace(db,owner);new AuditIntegrity(db,{initialize:true});
 const legacyPassword=password(),legacy=auth.invite(owner,'legacy@example.test','SYN EXISTING USER','planner');await auth.activate(legacy.token,legacyPassword);
 const setup=await auth.beginMFA(owner,ownerPassword),recovery=auth.enableMFA(owner,totp(setup.secret));
 const ownerLogin=await auth.login(owner.email,ownerPassword,'accounts-test',recovery[0]),legacyLogin=await auth.login(legacy.user.email,legacyPassword,'accounts-test');ok(ownerLogin);ok(legacyLogin);
 const pending=auth.invite(owner,'pending@example.test','SYN PENDING USER','viewer');
 const aircraft=JSON.stringify({name:'TEST-G200-001',msn:'TEST-091',hours:1000,cycles:500,notes:'SYNTHETIC preserve exact bytes'});
 await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind('existing-aircraft','maintenance-department','aircraft',aircraft,new Date().toISOString()).run();
 let bucket=new LocalBucket(db,path.join(dataDir,'objects'));const attachment=Buffer.from('SYNTHETIC ORIGINAL ATTACHMENT');await bucket.put('documents/preserved',attachment);
 const oldIds=[owner.id,legacy.user.id,pending.user.id],snapshot=()=>Object.fromEntries(['_local_users','members','_local_sessions','_local_enrollment','_local_mfa'].map(table=>[table,db.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().filter(r=>oldIds.includes(r.id)||oldIds.includes(r.user_id))]));
 const before=snapshot(),schema=db.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),keys={};
 for(const name of ['authentication.key','audit-signing.key'])keys[name]=await readFile(path.join(dataDir,name));

 // Reopening the same database must not rewrite existing identities or sessions.
 db.close();db=new LocalDatabase(file);auth=new LocalAuth(db);bucket=new LocalBucket(db,path.join(dataDir,'objects'));await migrate(db);await bootstrapWorkspace(db,auth.owner());eq(snapshot(),before);
 const newPasswords={},accounts={};
 for(const role of ['reviewer','approver']){
  newPasswords[role]=password();const created=await auth.createAccount(owner,role+'@example.test',role,role,newPasswords[role]);accounts[role]=created.user;
  eq(created.token,undefined);eq(auth.membership(created.user.id).role,role);eq(auth.membership(created.user.id).state,'active');
  eq(db.sqlite.prepare('SELECT count(*) n FROM _local_enrollment WHERE user_id=?').get(created.user.id).n,0);
  const encoded=db.sqlite.prepare('SELECT password FROM _local_users WHERE id=?').get(created.user.id).password;ok(/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded));ok(!encoded.includes(newPasswords[role]));
  const signed=await auth.login(created.user.email,newPasswords[role],'accounts-test');ok(signed);eq(auth.session('aeroplan_session='+signed.token).user.id,created.user.id);
  eq(await auth.login(created.user.email,'incorrect-password','accounts-test'),null);
 }
 eq(snapshot(),before);eq(db.sqlite.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),schema);
 for(const name of Object.keys(keys))eq(await readFile(path.join(dataDir,name)),keys[name]);
 eq(db.sqlite.prepare('SELECT data FROM records WHERE id=?').get('existing-aircraft').data,aircraft);eq(Buffer.from(await (await bucket.get('documents/preserved')).arrayBuffer()),attachment);
 ok(auth.session('aeroplan_session='+ownerLogin.token));ok(auth.session('aeroplan_session='+legacyLogin.token));eq(db.auditIntegrity.verify().valid,true);
 const count=()=>db.sqlite.prepare('SELECT count(*) n FROM _local_users').get().n,originalCount=count();
 await rejects(()=>auth.createAccount(accounts.reviewer,'forbidden@example.test','Forbidden','admin',password()),/مالك المساحة/);
 await rejects(()=>auth.createAccount(null,'forbidden@example.test','Forbidden','admin',password()),/مالك المساحة/);
 await rejects(()=>auth.createAccount(owner,'REVIEWER@EXAMPLE.TEST','Duplicate','approver',password()),/الحساب موجود/);
 for(const bad of [undefined,null,'','short','x'.repeat(129)])await rejects(()=>auth.createAccount(owner,'bad-password@example.test','Invalid','reviewer',bad),/12 إلى 128/);
 await rejects(()=>auth.createAccount(owner,'invalid-email','Invalid','reviewer',password()),/بريدًا إلكترونيًا صالحًا/);
 await rejects(()=>auth.createAccount(owner,'invalid-role@example.test','Invalid','owner',password()),/دور غير صالح/);eq(count(),originalCount);
 for(const length of [12,128]){const bounded='a'.repeat(length),created=await auth.createAccount(owner,'boundary'+length+'@example.test','Boundary','viewer',bounded);ok(await auth.login(created.user.email,bounded,'accounts-test'))}

 // Two concurrent submissions for the same normalized email create one account.
 const concurrent=await Promise.allSettled([auth.createAccount(owner,'race@example.test','One','viewer',password()),auth.createAccount(owner,'RACE@example.test','Two','viewer',password())]);eq(concurrent.filter(r=>r.status==='fulfilled').length,1);eq(concurrent.filter(r=>r.status==='rejected').length,1);eq(db.sqlite.prepare("SELECT count(*) n FROM members WHERE email='race@example.test'").get().n,1);
 const membershipId=randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO members VALUES(?,'maintenance-department',?,NULL,'viewer','active',?,?)").bind(membershipId,'unlinked@example.test',now,now).run();
 const linked=await auth.createAccount(owner,'unlinked@example.test','Linked','reviewer',password());eq(auth.membership(linked.user.id).id,membershipId);eq(auth.membership(linked.user.id).role,'reviewer');
 await db.prepare("INSERT INTO members VALUES(?,'maintenance-department',?,?,'viewer','active',?,?)").bind(randomUUID(),'conflict@example.test','another-identity',now,now).run();
 const beforeConflict=count();await rejects(()=>auth.createAccount(owner,'conflict@example.test','Conflict','viewer',password()),/مرتبطة بهوية أخرى/);eq(count(),beforeConflict);
 const audit=auth.audit.bind(auth);auth.audit=(actor,action,target)=>{if(action==='create-local-account')throw Error('SYNTHETIC AUDIT FAILURE');return audit(actor,action,target)};
 try{await rejects(()=>auth.createAccount(owner,'rollback@example.test','Rollback','reviewer',password()),/AUDIT FAILURE/)}finally{auth.audit=audit}
 eq(db.sqlite.prepare("SELECT id FROM _local_users WHERE email='rollback@example.test'").get(),undefined);eq(db.sqlite.prepare("SELECT id FROM members WHERE email='rollback@example.test'").get(),undefined);

 // Previously issued links, new invitation links and password resets still work.
 const pendingPassword=password();await auth.activate(pending.token,pendingPassword);ok(await auth.login(pending.user.email,pendingPassword,'accounts-test'));await rejects(()=>auth.activate(pending.token,pendingPassword),/غير صالح أو منتهي/);
 const invitation=auth.invite(owner,'invited@example.test','Invited','viewer');eq(await auth.login(invitation.user.email,password(),'accounts-test'),null);const invitedPassword=password();await auth.activate(invitation.token,invitedPassword);ok(await auth.login(invitation.user.email,invitedPassword,'accounts-test'));
 const reviewerSession=await auth.login(accounts.reviewer.email,newPasswords.reviewer,'accounts-test');auth.transaction(()=>db.sqlite.prepare("UPDATE members SET state='disabled' WHERE user_id=?").run(accounts.reviewer.id));eq(auth.session('aeroplan_session='+reviewerSession.token),null);eq(await auth.login(accounts.reviewer.email,newPasswords.reviewer,'accounts-test'),null);auth.transaction(()=>db.sqlite.prepare("UPDATE members SET state='active' WHERE user_id=?").run(accounts.reviewer.id));
 const reset=auth.resetEnrollment(owner,accounts.reviewer.id);eq(await auth.login(accounts.reviewer.email,newPasswords.reviewer,'accounts-test'),null);newPasswords.reviewer=password();await auth.activate(reset.token,newPasswords.reviewer);ok(await auth.login(accounts.reviewer.email,newPasswords.reviewer,'accounts-test'));
 auth.setMFAPolicy(owner,['reviewer']);const needsSetup=await auth.login(accounts.reviewer.email,newPasswords.reviewer,'accounts-test');eq(needsSetup.needsMFASetup,true);const reviewerSetup=await auth.beginMFA(accounts.reviewer,newPasswords.reviewer),reviewerRecovery=auth.enableMFA(accounts.reviewer,totp(reviewerSetup.secret));eq(await auth.login(accounts.reviewer.email,newPasswords.reviewer,'accounts-test'),null);ok(await auth.login(accounts.reviewer.email,newPasswords.reviewer,'accounts-test',reviewerRecovery[0]));
 ok(auth.session('aeroplan_session='+ownerLogin.token));eq(db.auditIntegrity.verify().valid,true);

 const backupKey=path.join(root,'backup.key');await writeFile(backupKey,randomBytes(32).toString('base64'),{mode:0o600});const backup=await captureFullBackup({db,dataDirectory:dataDir,destination:path.join(root,'backups'),keyFile:backupKey});const target=path.join(root,'restored');await restoreFullBackup(path.join(root,'backups',backup.name),backupKey,target);restored=new LocalDatabase(path.join(target,'aeroplan.sqlite'));const restoredAuth=new LocalAuth(restored);
 for(const role of ['reviewer','approver']){eq(restoredAuth.user(accounts[role].id),auth.user(accounts[role].id));eq(restoredAuth.membership(accounts[role].id),auth.membership(accounts[role].id));eq(restored.sqlite.prepare('SELECT password FROM _local_users WHERE id=?').get(accounts[role].id),db.sqlite.prepare('SELECT password FROM _local_users WHERE id=?').get(accounts[role].id))}
 ok(await restoredAuth.login(accounts.approver.email,newPasswords.approver,'restored-test'));eq(restored.auditIntegrity.verify().valid,true);eq(restored.sqlite.prepare('SELECT data FROM records WHERE id=?').get('existing-aircraft').data,aircraft);
 console.log(`${checks} local-account checks passed: immediate reviewer/approver login, hashing, ownership, atomic failures/race, existing passwords/sessions/MFA/keys/aircraft/documents, old links/reset, disabled membership, MFA policy and full backup/restore.`);
}finally{restored?.close();db.close();await rm(root,{recursive:true,force:true})}
