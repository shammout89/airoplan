import {env} from 'cloudflare:workers';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {access,checkOrigin,failure,requirePermission} from '../../../lib/access';
import {members,audit} from '../../../db/schema';
import {and,eq} from 'drizzle-orm';
import {roleLabels,AccessError} from '../../../lib/permissions';
export const dynamic='force-dynamic';
function localAuth(){const auth=(env as any).LOCAL_AUTH;if(!auth)throw new AccessError('تعذر الوصول إلى إدارة المستخدمين المحلية',503);return auth}
export async function GET(){try{const a=await access();requirePermission(a,'manage_members');if(env.AUTH_PROVIDER==='local'){const auth=localAuth();return Response.json({members:auth.directory(auth.user(a.userId)),ownerUserId:a.workspace.ownerUserId,local:true,canCreate:a.isOwner})}return Response.json({members:await a.db.select().from(members).where(eq(members.workspaceId,a.scope)),ownerUserId:a.workspace.ownerUserId})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{checkOrigin(req);const a=await access();requirePermission(a,'manage_members');lease=await acquireWrite(a,req);const text=await req.text();if(new TextEncoder().encode(text).length>16384)throw new AccessError('الطلب أكبر من الحد المسموح',413);let body:any;try{body=JSON.parse(text)}catch{throw new Error('طلب غير صالح')}if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('طلب غير صالح');const now=new Date().toISOString();
 if(env.AUTH_PROVIDER==='local'){
  const auth=localAuth(),actor=auth.user(a.userId),action=body.action||(body.id?'update':'create');
  if(!['create','invite','update','reset'].includes(action))throw new Error('إجراء غير صالح');
  if(action==='update'){auth.updateAccount(actor,{id:body.id,accountId:body.accountId,role:body.role,state:body.state||'active'});return Response.json({ok:true,message:'تم حفظ الدور وحالة المستخدم'})}
  if(!a.isOwner)throw new AccessError('إنشاء الحسابات وإعادة ضبط كلمات المرور متاحان لمالك المساحة فقط');
  let result;
  if(action==='reset')result=auth.resetEnrollment(actor,body.accountId);
  else{
   if(!Object.hasOwn(roleLabels,body.role)||!['active','disabled'].includes(body.state||'active'))throw new Error('دور أو حالة غير صحيحة');
   if(action==='invite')result=auth.invite(actor,body.email,body.name,body.role,body.state||'active');
   else{
    if(body.password!==body.confirm)throw new Error('كلمتا المرور غير متطابقتين');
    const run=(env as any).LOCAL_PASSWORD_OPERATION;if(!run)throw new AccessError('تعذر إنشاء الحساب الآن؛ أعد المحاولة',503);
    try{result=await run(()=>auth.createAccount(actor,body.email,body.name,body.role,body.password,body.state||'active'))}catch(e:any){if(e.status===429)throw new AccessError(e.message,429);throw e}
   }
  }
  return Response.json({ok:true,message:action==='reset'?'تم إصدار رابط إعادة ضبط كلمة المرور':action==='invite'?'تم إنشاء المستخدم ورابط تفعيله':'تم إنشاء المستخدم',...(result.token?{activationURL:new URL('/auth/activate?token='+result.token,(env as any).LOCAL_PUBLIC_ORIGIN||new URL(req.url).origin).href}:{}),user:result.user});
 }
 const role=body.role,state=body.state||'active';if(!Object.hasOwn(roleLabels,role)||!['active','disabled'].includes(state))throw new Error('دور أو حالة غير صحيحة');
 let member;if(body.id){member=(await a.db.select().from(members).where(and(eq(members.workspaceId,a.scope),eq(members.id,body.id))))[0];if(!member)throw new AccessError('العضو غير موجود',404);if(member.userId===a.workspace.ownerUserId)throw new AccessError('صلاحيات المالك محمية ولا يمكن تعطيله أو تغيير دوره');}
 const email=member?.email||String(body.email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Error('أدخل بريدًا إلكترونيًا صحيحًا');
 const same=(await a.db.select().from(members).where(and(eq(members.workspaceId,a.scope),eq(members.email,email))))[0];if(!body.id&&same)throw new Error('هذا البريد موجود بالفعل');
 const write=member?a.db.update(members).set({role,state,updated:now}).where(and(eq(members.id,member.id),eq(members.workspaceId,a.scope))):a.db.insert(members).values({id:crypto.randomUUID(),workspaceId:a.scope,email,userId:null,role,state,created:now,updated:now});
 await a.db.batch([write,a.db.insert(audit).values({id:crypto.randomUUID(),owner:a.scope,action:`${a.email} — ${member?'تحديث عضوية':'إضافة عضوية'}: ${email} / ${roleLabels[role]} / ${state}`,created:now})]);return Response.json({ok:true});
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
