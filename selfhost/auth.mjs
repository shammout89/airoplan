import {MFAStore} from './mfa.mjs';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback),hash=value=>createHash('sha256').update(value).digest('hex');
export const localRoles=['admin','planner','reviewer','approver','viewer'];
export function emailAddress(value){const email=String(value||'').trim().toLowerCase();if(email.length>200||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||/[\x00-\x20<>"'\\]/.test(email))throw Error('أدخل بريدًا إلكترونيًا صالحًا');return email}
export function passwordPolicy(value){if(typeof value!=='string'||value.length<12||value.length>128)throw Error('كلمة المرور مطلوبة بطول 12 إلى 128 حرفًا');return value}
async function encodePassword(password){passwordPolicy(password);const salt=randomBytes(16),key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return salt.toString('hex')+':'+Buffer.from(key).toString('hex')}
async function verifyPassword(password,encoded){const [salt,key]=String(encoded||'00'.repeat(16)+':'+ '00'.repeat(64)).split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(key))return false;const derived=await scrypt(String(password||'').slice(0,128),Buffer.from(salt,'hex'),64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return timingSafeEqual(Buffer.from(derived),Buffer.from(key,'hex'))}
export class LocalAuth{
 constructor(db,options={}){this.db=db;this.mfa=new MFAStore(db,options);this.sql=db.sqlite;this.sql.exec(`
 CREATE TABLE IF NOT EXISTS _local_users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password TEXT,enabled INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS _local_auth_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS _local_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS _local_enrollment(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,created_by TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS _local_login_limits(key TEXT PRIMARY KEY,failures INTEGER NOT NULL,window_start INTEGER NOT NULL,blocked_until INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS _local_auth_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created TEXT NOT NULL);`)}
 transaction(fn){this.db.auditIntegrity?.checkpoint();this.sql.exec('BEGIN IMMEDIATE');try{const result=fn();this.sql.exec('COMMIT');this.db.auditCheckpointAfterCommit();return result}catch(e){if(this.sql.isTransaction)this.sql.exec('ROLLBACK');throw e}}
 audit(actor,action,target){if(!this.sql.isTransaction)this.db.auditIntegrity?.checkpoint();this.sql.prepare('INSERT INTO _local_auth_audit VALUES(?,?,?,?,?)').run(randomUUID(),actor,action,target,new Date().toISOString());if(!this.sql.isTransaction)this.db.auditCheckpointAfterCommit()}
 owner(){const id=this.sql.prepare("SELECT value FROM _local_auth_meta WHERE key='owner_id'").get()?.value;return id?this.user(id):null}
 user(id){const row=this.sql.prepare('SELECT id,email,name,enabled,created FROM _local_users WHERE id=?').get(id);return row?{...row}:null}
 async initializeOwner(email,name,password){email=emailAddress(email);name=String(name||'مدير النظام').trim().slice(0,100);const encoded=await encodePassword(password);return this.transaction(()=>{if(this.owner())throw Error('تمت تهيئة المدير مسبقًا؛ لن تُستبدل الملكية');const id='local:'+randomUUID(),created=new Date().toISOString();this.sql.prepare('INSERT INTO _local_users(id,email,name,password,created) VALUES(?,?,?,?,?)').run(id,email,name,encoded,created);this.sql.prepare("INSERT INTO _local_auth_meta VALUES('owner_id',?)").run(id);this.audit(id,'initialize-owner',id);return this.user(id)})}
 membership(id){const exists=this.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='members'").get();return exists?this.sql.prepare("SELECT * FROM members WHERE workspace_id='maintenance-department' AND user_id=?").get(id):null}
 blocked(email,ip){const now=Date.now();return ['email:'+email+'|'+ip,'ip:'+ip].some(key=>(this.sql.prepare('SELECT blocked_until FROM _local_login_limits WHERE key=?').get(hash(key))?.blocked_until||0)>now)}
 failure(email,ip){const now=Date.now();for(const [key,maximum] of [['email:'+email+'|'+ip,10],['ip:'+ip,100]]){const id=hash(key),old=this.sql.prepare('SELECT * FROM _local_login_limits WHERE key=?').get(id),within=old&&now-old.window_start<15*60*1000,failures=within?old.failures+1:1,start=within?old.window_start:now;this.sql.prepare('INSERT INTO _local_login_limits VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,window_start=excluded.window_start,blocked_until=excluded.blocked_until').run(id,failures,start,failures>=maximum?now+15*60*1000:0)}}
 async login(email,password,ip,otp=''){
  email=emailAddress(email);if(this.blocked(email,ip))throw Error('محاولات كثيرة؛ أعد المحاولة بعد 15 دقيقة');
  const user=this.sql.prepare('SELECT * FROM _local_users WHERE email=?').get(email),correct=await verifyPassword(password,user?.password),member=user?this.membership(user.id):null;
  if(!user||!user.password||!correct||!user.enabled||member?.state!=='active'){this.failure(email,ip);return null}
  const result=this.transaction(()=>{const latest=this.sql.prepare('SELECT password,enabled FROM _local_users WHERE id=?').get(user.id);if(latest?.password!==user.password||!latest.enabled||this.membership(user.id)?.state!=='active')return null;if(this.mfa.state(user.id).enabled&&!this.mfa.consume(user.id,otp))return null;const token=randomBytes(32).toString('hex'),now=Date.now();this.sql.prepare('DELETE FROM _local_sessions WHERE expires<=?').run(now);this.sql.prepare('INSERT INTO _local_sessions VALUES(?,?,?,?)').run(hash(token),user.id,now+8*60*60*1000,now);this.sql.prepare('DELETE FROM _local_login_limits WHERE key=?').run(hash('email:'+email+'|'+ip));this.audit(user.id,'login',user.id);return {token,user:this.user(user.id),needsMFASetup:this.requiresMFA(user.id)&&!this.mfa.state(user.id).enabled}});
  if(!result)this.failure(email,ip);return result;
 }
 mfaRoles(){return JSON.parse(this.sql.prepare("SELECT value FROM _local_auth_meta WHERE key='mfa_required_roles'").get()?.value||'[]')}
 requiresMFA(userId){return this.mfaRoles().includes(this.membership(userId)?.role)}
 setMFAPolicy(actor,roles){this.requireOwner(actor);if(!Array.isArray(roles)||roles.some(r=>!localRoles.includes(r))||new Set(roles).size!==roles.length)throw Error('أدوار سياسة المصادقة غير صالحة');if(roles.includes(this.membership(actor.id)?.role)&&!this.mfa.state(actor.id).enabled)throw Error('فعّل المصادقة الإضافية لحسابك قبل إلزام دوره');this.transaction(()=>{this.sql.prepare("INSERT INTO _local_auth_meta VALUES('mfa_required_roles',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(roles));this.audit(actor.id,'mfa-policy',roles.join(','))})}
 mfaAttempt(userId,purpose,fn){const key='mfa:'+userId;if(this.blocked(key,purpose))throw Error('محاولات كثيرة؛ أعد المحاولة بعد 15 دقيقة');try{return fn()}catch(e){this.failure(key,purpose);throw e}}
 async beginMFA(user,password){const encoded=this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password;if(this.blocked('mfa:'+user.id,'begin'))throw Error('محاولات كثيرة؛ أعد المحاولة لاحقًا');if(!await verifyPassword(password,encoded)){this.failure('mfa:'+user.id,'begin');throw Error('كلمة المرور الحالية غير صحيحة')}return this.transaction(()=>{if(this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password!==encoded)throw Error('تغيرت كلمة المرور');const result=this.mfa.begin(user);this.audit(user.id,'mfa-enrollment-started',user.id);return result})}
 enableMFA(user,otp){return this.mfaAttempt(user.id,'enable',()=>this.transaction(()=>{const result=this.mfa.enable(user.id,otp);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(user.id);this.audit(user.id,'mfa-enabled',user.id);return result}))}
 async rotateMFARecovery(user,password,otp){if(this.blocked('mfa:'+user.id,'recovery'))throw Error('محاولات كثيرة؛ أعد المحاولة لاحقًا');const encoded=this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password;if(!await verifyPassword(password,encoded)){this.failure('mfa:'+user.id,'recovery');throw Error('كلمة المرور الحالية غير صحيحة')}return this.mfaAttempt(user.id,'recovery',()=>this.transaction(()=>{if(this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password!==encoded)throw Error('تغيرت كلمة المرور');const codes=this.mfa.rotateRecovery(user.id,otp);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(user.id);this.audit(user.id,'mfa-recovery-codes-rotated',user.id);return codes}))}
 async disableMFA(user,password,otp){if(this.blocked('mfa:'+user.id,'disable'))throw Error('محاولات كثيرة؛ أعد المحاولة لاحقًا');if(this.requiresMFA(user.id))throw Error('سياسة دورك تلزم المصادقة الإضافية');const encoded=this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password;if(!await verifyPassword(password,encoded)){this.failure('mfa:'+user.id,'disable');throw Error('كلمة المرور الحالية غير صحيحة')}return this.mfaAttempt(user.id,'disable',()=>this.transaction(()=>{if(this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password!==encoded||!this.mfa.consume(user.id,otp))throw Error('إثبات المصادقة غير صحيح أو مستخدم');this.mfa.remove(user.id);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(user.id);this.audit(user.id,'mfa-disabled',user.id)}))}
 async proveMFA(user,password,otp){if(this.blocked('mfa:'+user.id,'sensitive'))throw Error('محاولات كثيرة؛ أعد المحاولة لاحقًا');const encoded=this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password;if(!await verifyPassword(password,encoded)){this.failure('mfa:'+user.id,'sensitive');throw Error('كلمة المرور الحالية غير صحيحة')}return this.mfaAttempt(user.id,'sensitive',()=>this.transaction(()=>{if(this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password!==encoded||!this.mfa.consume(user.id,otp))throw Error('رمز المصادقة غير صحيح أو مستخدم');return true}))}
 resetMFAFromConsole(userId){if(!this.user(userId))throw Error('المستخدم غير موجود');this.transaction(()=>{this.mfa.remove(userId);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(userId);this.audit(userId,'console-mfa-recovery',userId)})}

 session(cookie=''){const values=cookie.split(';').map(v=>v.trim()).filter(v=>v.startsWith('aeroplan_session='));if(values.length!==1)return null;const token=values[0].slice('aeroplan_session='.length);if(!/^[a-f0-9]{64}$/.test(token))return null;const row=this.sql.prepare('SELECT user_id FROM _local_sessions WHERE token_hash=? AND expires>?').get(hash(token),Date.now()),user=row?this.user(row.user_id):null;return user?.enabled&&this.membership(user.id)?.state==='active'?{user,tokenHash:hash(token),scope:hash('aeroplan-public-session-v1:'+hash(token))}:null}
 logout(tokenHash){this.transaction(()=>{const prior=this.sql.prepare('SELECT user_id FROM _local_sessions WHERE token_hash=?').get(tokenHash);this.sql.prepare('DELETE FROM _local_sessions WHERE token_hash=?').run(tokenHash);if(prior)this.audit(prior.user_id,'logout-current-session',prior.user_id)})}
 logoutAll(userId){this.transaction(()=>{this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(userId);this.audit(userId,'logout-all-sessions',userId)})}
 requireOwner(actor){if(!actor||actor.id!==this.owner()?.id)throw Error('إدارة الحسابات المحلية متاحة لمالك المساحة فقط')}
 invite(actor,email,name,role,state='active'){return this.#createLocalAccount(actor,email,name,role,null,state)}
 async createAccount(actor,email,name,role,password,state='active'){
  this.requireOwner(actor);
  const encoded=await encodePassword(password);
  return this.#createLocalAccount(actor,email,name,role,encoded,state);
 }
 #createLocalAccount(actor,email,name,role,encoded,state){
  this.requireOwner(actor);email=emailAddress(email);name=String(name||email).trim().slice(0,100);
  if(!localRoles.includes(role))throw Error('دور غير صالح');
  if(!['active','disabled'].includes(state))throw Error('حالة غير صالحة');
  return this.transaction(()=>{
   if(this.sql.prepare('SELECT id FROM _local_users WHERE email=?').get(email))throw Error('الحساب موجود؛ استخدم إعادة ضبط كلمة المرور');
   const prior=this.sql.prepare("SELECT * FROM members WHERE workspace_id='maintenance-department' AND email=?").get(email);
   if(prior?.user_id)throw Error('العضوية مرتبطة بهوية أخرى؛ لن يُعاد ربطها تلقائيًا');
   const id='local:'+randomUUID(),created=new Date().toISOString();
   this.sql.prepare('INSERT INTO _local_users(id,email,name,password,created) VALUES(?,?,?,?,?)').run(id,email,name,encoded,created);
   if(prior)this.sql.prepare('UPDATE members SET user_id=?,role=?,state=?,updated=? WHERE id=?').run(id,role,state,created,prior.id);
   else this.sql.prepare("INSERT INTO members VALUES(?,'maintenance-department',?,?,?,?,?,?)").run(randomUUID(),email,id,role,state,created,created);
   const result={user:this.user(id)};
   if(!encoded){
    result.token=randomBytes(32).toString('hex');
    this.sql.prepare('INSERT INTO _local_enrollment VALUES(?,?,?,?)').run(hash(result.token),id,Date.now()+24*60*60*1000,actor.id);
   }
   this.audit(actor.id,encoded?'create-local-account':'invite-local-account',id);
   return result;
  });
 }
 resetEnrollment(actor,id){this.requireOwner(actor);if(id===actor.id)throw Error('غيّر كلمة مرورك من صفحة حسابي');const user=this.user(id);if(!user)throw Error('الحساب غير موجود');return this.transaction(()=>{const token=randomBytes(32).toString('hex');this.sql.prepare('UPDATE _local_users SET password=NULL WHERE id=?').run(id);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(id);this.sql.prepare('DELETE FROM _local_enrollment WHERE user_id=?').run(id);this.sql.prepare('INSERT INTO _local_enrollment VALUES(?,?,?,?)').run(hash(token),id,Date.now()+24*60*60*1000,actor.id);this.audit(actor.id,'reset-local-account',id);return {token,user}})}
 async activate(token,password){if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('رمز تفعيل غير صالح أو منتهي');const encoded=await encodePassword(password);return this.transaction(()=>{const enrollment=this.sql.prepare('SELECT * FROM _local_enrollment WHERE token_hash=? AND expires>?').get(hash(token),Date.now());if(!enrollment)throw Error('رمز تفعيل غير صالح أو منتهي');this.sql.prepare('UPDATE _local_users SET password=? WHERE id=?').run(encoded,enrollment.user_id);this.sql.prepare('DELETE FROM _local_enrollment WHERE user_id=?').run(enrollment.user_id);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(enrollment.user_id);this.audit(enrollment.user_id,'activate-local-account',enrollment.user_id);return this.user(enrollment.user_id)})}
 async changePassword(user,oldPassword,newPassword){const encoded=this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password;if(!await verifyPassword(oldPassword,encoded))throw Error('كلمة المرور الحالية غير صحيحة');const next=await encodePassword(newPassword);this.transaction(()=>{if(this.sql.prepare('SELECT password FROM _local_users WHERE id=?').get(user.id)?.password!==encoded)throw Error('تغيرت كلمة المرور أثناء الطلب؛ أعد تسجيل الدخول');this.sql.prepare('UPDATE _local_users SET password=? WHERE id=?').run(next,user.id);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(user.id);this.audit(user.id,'change-password',user.id)})}
 async recoverOwner(password){const owner=this.owner();if(!owner)throw Error('لا يوجد مدير مهيأ');const encoded=await encodePassword(password);this.transaction(()=>{this.sql.prepare('UPDATE _local_users SET password=?,enabled=1 WHERE id=?').run(encoded,owner.id);this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(owner.id);this.audit(owner.id,'console-owner-password-recovery',owner.id)})}
 requireManager(actor){const user=actor&&this.user(actor.id),member=user&&this.membership(user.id);if(!user?.enabled||member?.state!=='active'||(user.id!==this.owner()?.id&&member.role!=='admin'))throw Error('إدارة المستخدمين تتطلب صلاحية إدارة الفريق')}
 directory(actor){
  this.requireManager(actor);
  const accounts=this.sql.prepare("SELECT m.id,u.id AS accountId,u.id AS userId,u.email,u.name,u.enabled,u.password IS NOT NULL AS enrolled,m.role,m.state,m.updated FROM _local_users u LEFT JOIN members m ON m.user_id=u.id AND m.workspace_id='maintenance-department' ORDER BY u.created").all();
  const pending=this.sql.prepare("SELECT m.id,NULL AS accountId,m.user_id AS userId,m.email,m.email AS name,NULL AS enabled,0 AS enrolled,m.role,m.state,m.updated FROM members m LEFT JOIN _local_users u ON u.id=m.user_id WHERE m.workspace_id='maintenance-department' AND u.id IS NULL ORDER BY m.created").all();
  return [...accounts,...pending].map(row=>({...row,role:row.role||'viewer',state:row.id?row.state:'disabled'}));
 }
 updateAccount(actor,{id,accountId,role,state}){
  this.requireManager(actor);
  if(!localRoles.includes(role)||!['active','disabled'].includes(state))throw Error('دور أو حالة غير صحيحة');
  return this.transaction(()=>{
   const member=id?this.sql.prepare("SELECT * FROM members WHERE id=? AND workspace_id='maintenance-department'").get(id):null;
   if(id&&!member)throw Error('المستخدم غير موجود');
   if(member&&accountId&&member.user_id!==accountId)throw Error('هوية الحساب لا تطابق العضوية');
   const user=this.user(member?.user_id||accountId);
   if(!user)throw Error('استكمل إنشاء حساب الدخول لهذا المستخدم أولًا');
   if(user.id===this.owner()?.id)throw Error('صلاحيات المالك محمية ولا يمكن تعطيله أو تغيير دوره');
   const now=new Date().toISOString();
   if(member)this.sql.prepare('UPDATE members SET role=?,state=?,updated=? WHERE id=?').run(role,state,now,member.id);
   else{
    if(this.sql.prepare("SELECT id FROM members WHERE workspace_id='maintenance-department' AND (user_id=? OR email=?)").get(user.id,user.email))throw Error('العضوية موجودة؛ حدّث قائمة المستخدمين');
    this.sql.prepare("INSERT INTO members VALUES(?,'maintenance-department',?,?,?,?,?,?)").run(randomUUID(),user.email,user.id,role,state,now,now);
   }
   this.sql.prepare('UPDATE _local_users SET enabled=? WHERE id=?').run(state==='active'?1:0,user.id);
   if(state==='disabled')this.sql.prepare('DELETE FROM _local_sessions WHERE user_id=?').run(user.id);
   this.sql.prepare('INSERT INTO audit(id,owner,action,created) VALUES(?,?,?,?)').run(randomUUID(),'maintenance-department',`${actor.email} — تحديث مستخدم: ${user.email} / ${role} / ${state}`,now);
   this.audit(actor.id,'update-local-account',user.id);
   return this.user(user.id);
  });
 }
 accounts(actor){this.requireOwner(actor);return this.sql.prepare("SELECT u.id,u.email,u.name,u.password IS NOT NULL AS enrolled,u.enabled,m.role,m.state FROM _local_users u LEFT JOIN members m ON m.user_id=u.id AND m.workspace_id='maintenance-department' ORDER BY u.created").all().map(r=>({...r}))}
}
