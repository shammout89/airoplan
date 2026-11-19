import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission} from '../../../lib/access';
import {AccessError,workflowTransition} from '../../../lib/permissions';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {domainLock,commitDomain} from '../../../lib/domain';
import {openingStatus} from '../../../lib/opening-status';
import {policyGate,policyWrites} from '../../../lib/approval-policy';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{const a=await access(),id=new URL(req.url).searchParams.get('taskId');if(!id||!await env.DB!.prepare("SELECT id FROM records WHERE id=? AND owner=? AND kind='task'").bind(id,a.scope).first())throw new AccessError('المهمة غير موجودة',404);const rows=(await env.DB!.prepare("SELECT * FROM extension_items WHERE workspace_id=? AND kind='opening_status' AND json_extract(data,'$.taskId')=? ORDER BY created DESC").bind(a.scope,id).all()).results;const evidence=(await env.DB!.prepare('SELECT id,file_name,revision FROM document_versions WHERE workspace_id=? AND published IS NOT NULL').bind(a.scope).all()).results;return Response.json({items:rows.map((r:any)=>({...r,data:JSON.parse(r.data)})),evidence})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access(),db=env.DB!;lease=await acquireWrite(a,req);const b:any=await req.json();if(JSON.stringify(b).length>40000)throw Error('طلب كبير');
 const lock=await domainLock(db,a.scope),row:any=b.id?await db.prepare("SELECT * FROM extension_items WHERE id=? AND workspace_id=? AND kind='opening_status'").bind(b.id,a.scope).first():null;
 if(b.id&&!row)throw new AccessError('سجل الحالة غير موجود',404);const old=row?{...row,data:JSON.parse(row.data)}:null;if(old&&b.etag!==old.etag)throw new AccessError('تغير السجل',409);
 const id=old?.id||crypto.randomUUID();let state=old?.state||'draft',actors:any={modified:old?.modified_by||a.userId,submitted:old?.submitted_by,reviewed:old?.reviewed_by,approved:old?.approved_by},valid:any,pending:any;
 if(b.action==='save'){requirePermission(a,'edit_task');if(state!=='draft')throw Error('الحالة مقفلة بعد الإرسال');valid=await openingStatus(db,env.BUCKET,a.scope,id,b.data,old);actors={modified:a.userId};}
 else if(b.action==='return'){requirePermission(a,'edit_task');if(!old||!['submitted','reviewed'].includes(state))throw Error('لا يمكن إعادة هذه الحالة');state='draft';valid={data:old.data,checks:[]};actors={modified:old.modified_by};}
 else{if(!old||!['submit','review','approve'].includes(b.action))throw Error('إجراء غير صالح');pending=await policyGate(db,a,'opening_status',old,b.action);const n=workflowTransition({reviewState:state,modifiedBy:old.modified_by,submittedBy:old.submitted_by,reviewedBy:old.reviewed_by},b.action,a.userId,a.role);state=n.reviewState;actors={modified:old.modified_by,submitted:n.submittedBy,reviewed:n.reviewedBy,approved:n.approvedBy};valid=await openingStatus(db,env.BUCKET,a.scope,id,old.data,old,true);}
 // commitDomain chooses the ID for new records; bind the immutable source to that actual ID.
 if(!old){valid.data.imported.schedule.opening.sourceId=id;const provisional={...valid.data};return Response.json(await commitNew(db,a,lock,id,provisional,valid.checks));}
 return Response.json(await commitDomain(db,a,lock,old,'opening_status',old.code,valid.data,state,actors,valid.checks,(w:any)=>[...policyWrites(db,a,pending,w.id,w.token),...(state==='approved'?[
 db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND '+w.proof).bind(JSON.stringify({...valid.task.data,taskApproval:undefined,planningApprovalOrigin:{type:'opening_status',id:old.id},submittedBy:actors.submitted,...valid.data.imported.limits,schedule:valid.data.imported.schedule,reviewState:'approved',modifiedBy:old.modified_by,reviewedBy:actors.reviewed,approvedBy:a.userId,_revision:w.token,openingStatusId:old.id}),w.now,valid.task.id,a.scope,...w.proofArgs),
 db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND '+w.proof).bind(JSON.stringify({...valid.plane.data,_revision:w.token}),w.now,valid.plane.id,a.scope,...w.proofArgs)]:[])],'حالة افتتاحية / '+b.action));
}catch(e){return failure(e)}finally{await releaseWrite(lease)}}

async function commitNew(db:any,a:any,lock:any,id:string,data:any,checks:any[]){
 // The draft ID is allocated by extWrite. Replace the source reference in a guarded second statement in the same transaction.
 return await commitDomain(db,a,lock,null,'opening_status','OPEN-'+id,data,'draft',{modified:a.userId},checks,(w:any)=>{
  const corrected={...data,imported:{...data.imported,schedule:{...data.imported.schedule,opening:{...data.imported.schedule.opening,sourceId:w.id}}}};
  return [db.prepare('UPDATE extension_items SET data=? WHERE id=? AND workspace_id=? AND etag=?').bind(JSON.stringify(corrected),w.id,a.scope,w.token)];
 },'إنشاء حالة افتتاحية');
}
