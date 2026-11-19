import {headers} from 'next/headers';
import {getDb} from '../db';
import {members,workspaces,records,audit,extensionItems} from '../db/schema';
import {and,eq,or,isNull,sql,desc} from 'drizzle-orm';
import {AccessError,requirePermission,rolePermissions,permissionCeiling} from './permissions';
import {AircraftScopePolicy,DEFAULT_AIRCRAFT_SCOPE,extractScopedAircraftIds,normalizeAircraftScope,requireAircraftInScope} from './aircraft-scope';
import {programToday} from './program';
const WORKSPACE='maintenance-department';
// Verified Site owner from the Sites access policy. Never grant administration to the first visitor.
const OWNER_EMAIL='shammout89@gmail.com';
export async function access(){
 const h=await headers();const userId=h.get('oai-authenticated-user-id');const email=h.get('oai-authenticated-user-email')?.trim().toLowerCase();
 if(!userId||!email)throw new AccessError('يلزم تسجيل الدخول',401);
 const db=getDb();let ws=(await db.select().from(workspaces).where(eq(workspaces.id,WORKSPACE)))[0];
 if(!ws){if(email!==OWNER_EMAIL)throw new AccessError('ينبغي أن يهيئ مالك الموقع مساحة العمل أولًا');
 const now=new Date().toISOString();await db.insert(workspaces).values({id:WORKSPACE,name:'دائرة تخطيط صيانة الطائرات',ownerUserId:userId,created:now}).onConflictDoNothing();ws=(await db.select().from(workspaces).where(eq(workspaces.id,WORKSPACE)))[0];}
 if(ws.ownerUserId===userId){const now=new Date().toISOString();await db.insert(members).values({id:'workspace-owner',workspaceId:WORKSPACE,email,userId,role:'admin',state:'active',created:now,updated:now}).onConflictDoNothing();
 // Move only the verified owner's legacy records. Other personal records remain isolated.
 await db.batch([db.update(records).set({owner:WORKSPACE}).where(eq(records.owner,userId)),db.update(audit).set({owner:WORKSPACE}).where(eq(audit.owner,userId))]);}
 let member=(await db.select().from(members).where(and(eq(members.workspaceId,WORKSPACE),eq(members.userId,userId))))[0];
 if(!member){const pending=(await db.select().from(members).where(and(eq(members.workspaceId,WORKSPACE),eq(members.email,email),isNull(members.userId),eq(members.state,'active'))))[0];
 if(pending){await db.update(members).set({userId,updated:new Date().toISOString()}).where(and(eq(members.id,pending.id),isNull(members.userId)));member=(await db.select().from(members).where(and(eq(members.workspaceId,WORKSPACE),eq(members.userId,userId))))[0];}}
 if(!member||member.state!=='active')throw new AccessError('حسابك غير مضاف لمساحة العمل أو تم تعطيله');
 const base=rolePermissions[member.role]||[];const grant=ws.ownerUserId===userId?null:(await db.select().from(extensionItems).where(and(eq(extensionItems.workspaceId,WORKSPACE),eq(extensionItems.kind,'access_grant'),eq(extensionItems.state,'approved'),sql`json_extract(${extensionItems.data},'$.userId')=${userId}`)).orderBy(desc(extensionItems.updated)).limit(1))[0];let permissions=base;let aircraftScope:AircraftScopePolicy=DEFAULT_AIRCRAFT_SCOPE;if(grant){const policy=JSON.parse(grant.data);if(!Array.isArray(policy.permissions))throw new AccessError('تعذر توثيق سياسة صلاحيات العضو');permissions=policy.validUntil&&policy.validUntil<programToday()?['read']:permissionCeiling(member.role).filter(p=>policy.permissions.includes(p));try{aircraftScope=normalizeAircraftScope(policy)}catch{aircraftScope=policy?.aircraftScopeMode==='restricted'?{mode:'restricted',aircraftIds:[],models:[]}:DEFAULT_AIRCRAFT_SCOPE}}return {db,userId,email,role:member.role,workspace:ws,scope:WORKSPACE,isOwner:ws.ownerUserId===userId,permissions,aircraftScope,memberId:member.id,memberUpdated:member.updated,grantProof:grant?grant.id+':'+grant.etag:null};
}
export async function requireAircraftIdInScope(a:{db:any,scope:string,isOwner?:boolean,aircraftScope?:AircraftScopePolicy},aircraftId:string|null|undefined){
 if(a.isOwner||!a.aircraftScope||a.aircraftScope.mode!=='restricted')return;
 if(!aircraftId)throw new AccessError('ليس لديك صلاحية على هذا الإجراء خارج نطاق طائراتك',403);
 const row=(await a.db.select().from(records).where(and(eq(records.id,aircraftId),eq(records.owner,a.scope),eq(records.kind,'aircraft'))))[0];
 if(!row)throw new AccessError('الطائرة غير موجودة',404);
 requireAircraftInScope(a,{id:row.id,...JSON.parse(row.data)});
}
export async function scopedAircraftSet(a:{db:any,scope:string,isOwner?:boolean,aircraftScope?:AircraftScopePolicy},planesInput?:any[]):Promise<Set<string>|null>{
 if(a.isOwner||!a.aircraftScope||a.aircraftScope.mode!=='restricted')return null;
 const rows=planesInput||(await a.db.select().from(records).where(and(eq(records.owner,a.scope),eq(records.kind,'aircraft'))));
 const normalized=rows.map((r:any)=>{const d=typeof r.data==='string'?JSON.parse(r.data):(r.data||r);return {id:r.id,model:d.model,type:d.type,name:d.name}});
 return extractScopedAircraftIds(a.aircraftScope,normalized);
}
export function checkOrigin(req:Request){const origin=req.headers.get('origin');if(!origin)throw new AccessError('طلب غير مسموح');let originUrl:URL;try{originUrl=new URL(origin)}catch{throw new AccessError('طلب غير مسموح')}const reqUrl=new URL(req.url);if(originUrl.origin===reqUrl.origin)return;const host=(req.headers.get('x-forwarded-host')||req.headers.get('host')||'').split(',')[0].trim();if(host&&originUrl.host===host)return;throw new AccessError('طلب غير مسموح')}
export function failure(e:unknown){return Response.json({error:e instanceof Error?e.message:'تعذر إتمام العملية'},{status:e instanceof AccessError?e.status:400})}
export {requirePermission,requireAircraftInScope,extractScopedAircraftIds,DEFAULT_AIRCRAFT_SCOPE};

