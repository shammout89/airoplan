import {headers} from 'next/headers';
import {getDb} from '../db';
import {members,workspaces,records,audit,extensionItems} from '../db/schema';
import {and,eq,or,isNull,sql,desc} from 'drizzle-orm';
import {AccessError,requirePermission,rolePermissions,permissionCeiling} from './permissions';
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
 const base=rolePermissions[member.role]||[];const grant=ws.ownerUserId===userId?null:(await db.select().from(extensionItems).where(and(eq(extensionItems.workspaceId,WORKSPACE),eq(extensionItems.kind,'access_grant'),eq(extensionItems.state,'approved'),sql`json_extract(${extensionItems.data},'$.userId')=${userId}`)).orderBy(desc(extensionItems.updated)).limit(1))[0];let permissions=base;if(grant){const policy=JSON.parse(grant.data);if(!Array.isArray(policy.permissions))throw new AccessError('تعذر توثيق سياسة صلاحيات العضو');permissions=policy.validUntil&&policy.validUntil<programToday()?['read']:permissionCeiling(member.role).filter(p=>policy.permissions.includes(p));}return {db,userId,email,role:member.role,workspace:ws,scope:WORKSPACE,isOwner:ws.ownerUserId===userId,permissions,memberId:member.id,memberUpdated:member.updated,grantProof:grant?grant.id+':'+grant.etag:null};
}
export function checkOrigin(req:Request){if(req.headers.get('origin')!==new URL(req.url).origin)throw new AccessError('طلب غير مسموح')}
export function failure(e:unknown){return Response.json({error:e instanceof Error?e.message:'تعذر إتمام العملية'},{status:e instanceof AccessError?e.status:400})}
export {requirePermission};
