import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission,requireAircraftIdInScope,scopedAircraftSet} from '../../../lib/access';
import {AccessError,workflowTransition} from '../../../lib/permissions';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {domainContext,domainLock,commitDomain} from '../../../lib/domain';
import {policyGate,policyWrites} from '../../../lib/approval-policy';
import {controlledKinds,controlPermission,normalizeControlled,controlledEffects} from '../../../lib/controlled';
import {unitTaskView} from '../../../lib/unit-tasks';
import {componentAircraftId} from '../../../lib/component-tree';
export const dynamic='force-dynamic';
function controlAircraftIds(kind:string,d:any,c:any):string[]|null{
 if(!d)return null;
 if(['storage_plan','return_to_service','sector_plan'].includes(kind))return d.aircraftId?[d.aircraftId]:[];
 if(kind==='engineering_change'){
  if(d.aircraftId)return [d.aircraftId];
  if(d.targetType==='aircraft'&&d.targetId)return [d.targetId];
  if(d.targetType==='component'&&d.targetId){const comp=c.planning.find((p:any)=>p.id===d.targetId&&p.kind==='component');const aid=comp?componentAircraftId(comp,c.planning):null;return aid?[aid]:[];}
  return [];
 }
 if(['reliability_action','reliability_review','report_snapshot'].includes(kind))return Array.isArray(d.aircraftIds)?d.aircraftIds:[];
 if(kind==='program_transition'){
  const ids:string[]=[...(Array.isArray(d.aircraftIds)?d.aircraftIds:[])];
  for(const cid of Array.isArray(d.componentIds)?d.componentIds:[]){const comp=c.planning.find((p:any)=>p.id===cid&&p.kind==='component');const aid=comp?componentAircraftId(comp,c.planning):null;if(aid)ids.push(aid);}
  return ids;
 }
 if(kind==='work_card'){
  if(d.aircraftId)return [d.aircraftId];
  if(d.taskType==='task'){const t=c.records.find((r:any)=>r.id===d.taskId&&r.kind==='task');return t?.data?.aircraftId?[t.data.aircraftId]:[];}
  if(d.taskType==='unit_task'){const ut=c.items.find((r:any)=>r.id===d.taskId&&r.kind==='unit_task');const comp=ut?c.planning.find((p:any)=>p.id===ut.data.componentId&&p.kind==='component'):null;const aid=comp?componentAircraftId(comp,c.planning):null;return aid?[aid]:[];}
  return [];
 }
 if(kind==='lot_issue'){
  if(d.targetType==='task'){const t=c.records.find((r:any)=>r.id===d.targetId&&r.kind==='task');return t?.data?.aircraftId?[t.data.aircraftId]:[];}
  if(d.targetType==='package'){const pkg=c.planning.find((p:any)=>p.id===d.targetId&&p.kind==='package');return pkg?.data?.aircraftId?[pkg.data.aircraftId]:[];}
  if(d.targetType==='unit_task'){const ut=c.items.find((r:any)=>r.id===d.targetId&&r.kind==='unit_task');const comp=ut?c.planning.find((p:any)=>p.id===ut.data.componentId&&p.kind==='component'):null;const aid=comp?componentAircraftId(comp,c.planning):null;return aid?[aid]:[];}
  return [];
 }
 if(['unit_task','unit_execution','unit_variation','unit_classification','unit_usage','unit_correction','unit_service'].includes(kind)){
  let cid=d.componentId;
  if(!cid&&d.taskId){const ut=c.items.find((r:any)=>r.id===d.taskId&&r.kind==='unit_task');cid=ut?.data?.componentId;}
  const comp=cid?c.planning.find((p:any)=>p.id===cid&&p.kind==='component'):null;
  const aid=comp?componentAircraftId(comp,c.planning):null;
  return aid?[aid]:[];
 }
 return null;
}
function itemInAircraftScope(r:any,c:any,allowedPlanes:Set<string>|null){
 if(!allowedPlanes)return true;
 const ids=controlAircraftIds(r.kind,r.data,c);
 if(ids===null)return true;
 if(!ids.length)return ['program_transition','engineering_change','unit_task','unit_execution','unit_variation','unit_classification','unit_usage','unit_correction','unit_service'].includes(r.kind);
 return ids.every((id:string)=>allowedPlanes.has(id));
}
export async function GET(req:Request){try{const a=await access(),c=await domainContext(env.DB!,a.scope),u=new URL(req.url),kind=u.searchParams.get('kind'),componentId=u.searchParams.get('componentId'),q=(u.searchParams.get('q')||'').slice(0,150).toLowerCase(),offset=Math.max(0,Math.floor(Number(u.searchParams.get('offset'))||0)),allowedPlanes=await scopedAircraftSet(a,c.records.filter((r:any)=>r.kind==='aircraft'));const all=c.items.slice().sort((a:any,b:any)=>b.updated.localeCompare(a.updated)||a.id.localeCompare(b.id)).filter((r:any)=>controlledKinds.includes(r.kind)&&(!kind||r.kind===kind)&&(!componentId||r.data.componentId===componentId)&&(!q||r.code.toLowerCase().includes(q)||String(r.data.name||r.data.reference||'').toLowerCase().includes(q))&&itemInAircraftScope(r,c,allowedPlanes));const programs=(await env.DB!.prepare("SELECT * FROM program_revisions WHERE workspace_id=? ORDER BY updated DESC").bind(a.scope).all()).results.map((p:any)=>({...p,data:{...JSON.parse(p.data),tasks:[]}}));return Response.json({ownerUserId:a.workspace.ownerUserId,items:all.slice(offset,offset+50).map((r:any)=>r.kind==='unit_task'?unitTaskView(r,c):r),total:all.length,offset,limit:50,programs,tasks:c.records.filter((r:any)=>r.kind==='task'&&(!allowedPlanes||allowedPlanes.has(r.data.aircraftId))).map((r:any)=>({id:r.id,kind:r.kind,data:{name:r.data.name,aircraftId:r.data.aircraftId,status:r.data.status,reference:r.data.reference}})),registers:c.items.filter((r:any)=>[...controlledKinds,'stock','material','defect','integration_event'].includes(r.kind)&&['approved','superseded','active','open','deferred','closed','applied'].includes(r.state)&&(!allowedPlanes||(r.kind==='defect'?allowedPlanes.has(r.data.aircraftId):itemInAircraftScope(r,c,allowedPlanes)))),packages:c.planning.filter((r:any)=>r.kind==='package'&&(!allowedPlanes||allowedPlanes.has(r.data.aircraftId))),resources:c.planning.filter((r:any)=>r.kind==='resource'),members:c.members.filter((r:any)=>r.state==='active').map((r:any)=>({id:r.user_id,name:r.email,role:r.role})),components:c.planning.filter((p:any)=>p.kind==='component'&&p.state==='approved'&&(!allowedPlanes||!componentAircraftId(p,c.planning)||allowedPlanes.has(componentAircraftId(p,c.planning)!))),aircraft:c.records.filter((p:any)=>p.kind==='aircraft'&&(!allowedPlanes||allowedPlanes.has(p.id))),evidence:c.versions.filter((v:any)=>v.published).map((v:any)=>{const item={...v};delete item.storage_key;return item})})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access(),db=env.DB!;lease=await acquireWrite(a,req);const b:any=await req.json();if(JSON.stringify(b).length>400000)throw Error('السجل كبير؛ قسم العمل إلى سجلات أصغر');const lock=await domainLock(db,a.scope),c=await domainContext(db,a.scope),old=b.id?c.items.find((r:any)=>r.id===b.id&&controlledKinds.includes(r.kind)):null;if(b.id&&!old)throw new AccessError('السجل غير موجود',404);if(old&&b.etag!==old.etag)throw new AccessError('تغير السجل؛ حدّث الصفحة',409);const kind=old?.kind||b.kind;if(!controlledKinds.includes(kind))throw Error('نوع سجل غير صالح');const id=old?.id||crypto.randomUUID();let state=old?.state||'draft',valid:any,actors:any={modified:old?.modified_by||a.userId},pending:any;
 if(old){const oldIds=controlAircraftIds(kind,old.data,c);if(oldIds)for(const aid of oldIds)await requireAircraftIdInScope(a,aid);}
 if(b.action==='save'){requirePermission(a,controlPermission(kind));if(state!=='draft')throw Error('السجل مقفل بعد الإرسال');valid=await normalizeControlled(kind,b.data,old,c,db,env.BUCKET,a.scope,id);actors={modified:a.userId};}
 else if(b.action==='return'){requirePermission(a,controlPermission(kind));if(!old||!['submitted','reviewed'].includes(state))throw Error('لا يمكن إعادة السجل');state='draft';valid={data:old.data,checks:[]};}
 else{if(!old||!['submit','review','approve'].includes(b.action))throw Error('إجراء غير صالح');if(kind==='authorization'&&['review','approve'].includes(b.action)&&old.data.userId===a.userId)throw new AccessError('لا يمكنك مراجعة أو اعتماد تفويضك المهني');pending=await policyGate(db,a,kind,old,b.action);const n=workflowTransition({reviewState:state,modifiedBy:old.modified_by,submittedBy:old.submitted_by,reviewedBy:old.reviewed_by},b.action,a.userId,a.role);state=n.reviewState;actors={modified:old.modified_by,submitted:n.submittedBy,reviewed:n.reviewedBy,approved:n.approvedBy};valid=await normalizeControlled(kind,old.data,old,c,db,env.BUCKET,a.scope,id,true);}
 const targetIds=controlAircraftIds(kind,valid.data,c);
 if(targetIds)for(const aid of targetIds)await requireAircraftIdInScope(a,aid);
 if(kind==='authorization'&&Array.isArray(valid.data?.aircraftIds))for(const aid of valid.data.aircraftIds)await requireAircraftIdInScope(a,aid);
 return Response.json(await commitDomain(db,a,lock,old,kind,old?.code||kind+'-'+id,valid.data,state,actors,valid.checks,w=>[...policyWrites(db,a,pending,w.id,w.token),...(state==='approved'?controlledEffects(db,a.scope,kind,valid.data,c,w):[])],kind+' / '+b.action,id));
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
