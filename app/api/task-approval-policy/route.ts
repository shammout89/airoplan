import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission} from '../../../lib/access';
import {AccessError} from '../../../lib/permissions';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {saveSetting} from '../../../lib/settings';
import {stable,taskBusiness,normalizeTaskPolicy} from '../../../lib/task-approval';
import {currentTaskPolicy,taskEvidence} from '../../../lib/task-approval-store';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const a=await access();requirePermission(a,'read');const db=env.DB!,taskId=new URL(req.url).searchParams.get('taskId');
 if(taskId){
  const task:any=await db.prepare("SELECT id,data FROM records WHERE owner=? AND id=? AND kind='task'").bind(a.scope,taskId).first();if(!task)throw new AccessError('المهمة غير موجودة',404);
  const events=(await db.prepare("SELECT b.id,b.created,b.data FROM approval_bindings b WHERE b.workspace_id=? AND b.entity='task' AND b.target_id=? ORDER BY COALESCE(json_extract(b.data,'$.taskEvent.sequence'),0) DESC,b.created DESC,b.id DESC LIMIT 100").bind(a.scope,taskId).all()).results.map((b:any)=>({id:b.id,created:b.created,...JSON.parse(b.data)}));
  const actorIds=new Set([JSON.parse(task.data).modifiedBy,JSON.parse(task.data).submittedBy,JSON.parse(task.data).reviewedBy,JSON.parse(task.data).approvedBy,...(JSON.parse(task.data).taskApproval?.contributors||[]),...events.flatMap((e:any)=>[e.taskEvent?.actorId,e.taskEvent?.previousApproval?.approvedBy,e.taskEvent?.previousApproval?.reviewedBy])].filter(Boolean));const people=(await db.prepare('SELECT user_id,email FROM members WHERE workspace_id=?').bind(a.scope).all()).results.filter((p:any)=>actorIds.has(p.user_id));
  const total:any=await db.prepare("SELECT COUNT(*) n FROM approval_bindings WHERE workspace_id=? AND entity='task' AND target_id=?").bind(a.scope,taskId).first();const aircraft:any=await db.prepare("SELECT id,data FROM records WHERE owner=? AND id=? AND kind='aircraft'").bind(a.scope,JSON.parse(task.data).aircraftId).first();const prior:any=await db.prepare("SELECT data FROM approval_bindings WHERE workspace_id=? AND entity='task' AND target_id=? AND json_extract(data,'$.taskEvent.previousApproval') IS NOT NULL ORDER BY COALESCE(json_extract(data,'$.taskEvent.sequence'),0) DESC,created DESC,id DESC LIMIT 1").bind(a.scope,taskId).first(),baseline=prior?JSON.parse(prior.data).taskEvent.previousApproval:null,current=JSON.parse(task.data),before=taskBusiness(baseline),after=taskBusiness(current),changes=baseline?[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>stable(before[k]??null)!==stable(after[k]??null)).map(field=>({field,before:before[field]??null,after:after[field]??null})):[];
  return Response.json({task:current,aircraft:aircraft?{id:aircraft.id,data:JSON.parse(aircraft.data)}:null,events,totalEvents:Number(total.n),people,baseline,changes,evidence:await taskEvidence(db,a.scope,taskId),legacy:!current.taskApproval});
 }
 const current=await currentTaskPolicy(db,a.scope),history=(await db.prepare("SELECT id,data,previous_id,created_by,created FROM settings_versions WHERE workspace_id=? AND kind='approval' AND code='task' ORDER BY rowid DESC LIMIT 50").bind(a.scope).all()).results.map((h:any)=>({...h,data:JSON.parse(h.data)}));
 return Response.json({current,history,canEdit:a.isOwner});
 }catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access();if(!a.isOwner)throw new AccessError('تغيير سياسة اعتماد التخطيط متاح لمالك النظام فقط');requirePermission(a,'configure');lease=await acquireWrite(a,req);
 const body:any=await req.json();if(JSON.stringify(body).length>12000)throw Error('سياسة كبيرة');
 const data=normalizeTaskPolicy(body.data);return Response.json(await saveSetting(env.DB!,a,'approval','task',data,body.previousId==='default'?null:body.previousId));
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
