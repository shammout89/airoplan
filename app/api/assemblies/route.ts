import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission} from '../../../lib/access';
import {AccessError,workflowTransition} from '../../../lib/permissions';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {domainContext,domainLock,commitDomain} from '../../../lib/domain';
import {normalizeAssembly} from '../../../lib/assemblies';
import {componentAircraftId,resolvedComponentLife} from '../../../lib/component-tree';
import {policyGate,policyWrites} from '../../../lib/approval-policy';
export const dynamic='force-dynamic';
export async function GET(){try{const a=await access(),c=await domainContext(env.DB!,a.scope),components=c.planning.filter((p:any)=>p.kind==='component'&&p.state==='approved').map((p:any)=>{try{return {...p,aircraftId:componentAircraftId(p,c.planning),life:resolvedComponentLife(p,c.planning,c.records)}}catch(e:any){return {...p,error:e.message}}});return Response.json({components,items:c.items.filter((r:any)=>r.kind==='assembly'),evidence:c.versions.filter((v:any)=>v.published).map(({storage_key,...v}:any)=>v),aircraft:c.records.filter((r:any)=>r.kind==='aircraft')})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access(),db=env.DB!;lease=await acquireWrite(a,req);const b:any=await req.json();if(JSON.stringify(b).length>100000)throw Error('طلب كبير');const lock=await domainLock(db,a.scope),c=await domainContext(db,a.scope),old=b.id?c.items.find((r:any)=>r.id===b.id&&r.kind==='assembly'):null;
 if(b.id&&!old)throw new AccessError('إجراء التجميعة غير موجود',404);if(old&&b.etag!==old.etag)throw new AccessError('تغير السجل',409);
 let state=old?.state||'draft',actors:any={modified:old?.modified_by||a.userId,submitted:old?.submitted_by,reviewed:old?.reviewed_by,approved:old?.approved_by},valid:any,pending:any;
 if(b.action==='save'){requirePermission(a,'edit_planning');if(state!=='draft')throw Error('السجل مقفل');valid=await normalizeAssembly(b.data,old,c,env.BUCKET);actors={modified:a.userId};}
 else if(b.action==='return'){requirePermission(a,'edit_planning');if(!old||!['submitted','reviewed'].includes(state))throw Error('لا يمكن إعادة السجل');state='draft';actors={modified:old.modified_by};valid={data:old.data,checks:[]};}
 else{if(!old||!['submit','review','approve'].includes(b.action))throw Error('إجراء غير صالح');pending=await policyGate(db,a,'assembly',old,b.action);const n=workflowTransition({reviewState:state,modifiedBy:old.modified_by,submittedBy:old.submitted_by,reviewedBy:old.reviewed_by},b.action,a.userId,a.role);state=n.reviewState;actors={modified:old.modified_by,submitted:n.submittedBy,reviewed:n.reviewedBy,approved:n.approvedBy};valid=await normalizeAssembly(old.data,old,c,env.BUCKET,true);}
 return Response.json(await commitDomain(db,a,lock,old,'assembly',old?.code||'ASM-'+crypto.randomUUID(),valid.data,state,actors,valid.checks,(w:any)=>[...policyWrites(db,a,pending,w.id,w.token),...(state==='approved'?[
 db.prepare('UPDATE planning_items SET data=?,etag=?,updated=? WHERE id=? AND workspace_id=? AND '+w.proof).bind(JSON.stringify(valid.data.after),w.token,w.now,valid.child.id,a.scope,...w.proofArgs),
 db.prepare('UPDATE planning_items SET data=?,etag=?,updated=? WHERE id=? AND workspace_id=? AND '+w.proof).bind(JSON.stringify({...valid.parent.data,lastAssemblyEventAt:valid.data.at}),w.token,w.now,valid.parent.id,a.scope,...w.proofArgs),
 ...(valid.plane?[db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND '+w.proof).bind(JSON.stringify({...valid.plane.data,_revision:w.token,configurationAsOf:valid.data.at}),w.now,valid.plane.id,a.scope,...w.proofArgs)]:[])]:[])],'تجميعة / '+b.action));
}catch(e){return failure(e)}finally{await releaseWrite(lease)}}
