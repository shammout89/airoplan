import {env} from 'cloudflare:workers';
import {requireAircraftReady} from '../../../lib/aircraft';
import {taskLimits} from '../../../lib/task-validation';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {access,checkOrigin,failure} from '../../../lib/access';
import {AccessError} from '../../../lib/permissions';
import {transitionTask,taskHash} from '../../../lib/task-approval';
import {workflowTaskSnapshot,checkTaskEvidence,evidenceGuard,taskEventWrites,taskActorGuard} from '../../../lib/task-approval-store';
export const dynamic='force-dynamic';
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access();lease=await acquireWrite(a,req);const body:any=await req.json();
 if(JSON.stringify(body).length>12000||!['submit','review','approve','return','close'].includes(body.action))throw Error('إجراء غير صالح');
 const raw=env.DB!,row:any=await raw.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='task'").bind(body.id,a.scope).first();if(!row)throw new AccessError('المهمة غير موجودة',404);
 const original=JSON.parse(row.data);if(original.status==='withdrawn')throw new AccessError('المهمة مسحوبة بخطة انتقال معتمدة',409);
 if(body.action==='close')throw new AccessError('تُغلق المهمة باعتماد سجل إنجازها المستقل؛ افتح الاستحقاق والتنفيذ');
 if(typeof body.expectedRevision!=='string'||!body.expectedRevision||body.expectedRevision!==original._revision)throw new AccessError('تغيرت المهمة أو لم تُثبت النسخة المعروضة؛ حدّث الصفحة وأعد المراجعة',409);
 if(original.status==='closed')throw new AccessError('المهمة مغلقة',409);
 const plane:any=await raw.prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='aircraft'").bind(original.aircraftId,a.scope).first();if(body.action!=='return'){requireAircraftReady(plane?JSON.parse(plane.data):null);taskLimits(original);if(body.expectedAircraftRevision!==JSON.parse(plane.data)._revision)throw new AccessError('تغيرت بطاقة الطائرة أو عداداتها؛ حمّل نسخة المهمة الحالية قبل القرار',409);}
 // Return can recover a request invalidated by another controlled technical process.
 let recover=original;
 if(body.action==='return'&&original.taskApproval){const technicalHash=await taskHash(original,true),w=original.taskApproval,risk=technicalHash!==w.technicalHash?'technical':w.risk;recover={...original,taskApproval:{...w,risk,mode:risk==='technical'?w.policy.technicalMode:w.policy.routineMode,contentHash:await taskHash(original)}};}
 let prepared=await workflowTaskSnapshot(raw,a,row.id,recover);
 prepared=await checkTaskEvidence(raw,a,row.id,prepared,body.action);
 let data=transitionTask(prepared,body,a);if(body.action==='return')data.taskApproval={...data.taskApproval,contentHash:await taskHash(data),technicalHash:await taskHash(data,true)};
 data._revision=crypto.randomUUID();const now=new Date().toISOString(),encoded=JSON.stringify(data),documents=evidenceGuard(a.scope,row.id,body.action==='return'?{taskApproval:null}:data),actor=taskActorGuard(a);
 const results=await raw.batch([
  raw.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND data=?'+(body.action==='return'?'':' AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND data=?)')+documents.sql+actor.sql).bind(encoded,now,row.id,a.scope,row.data,...(body.action==='return'?[]:[original.aircraftId,a.scope,plane.data]),...documents.args,...actor.args),
  ...taskEventWrites(raw,a,row.id,encoded,data,body.action,body.action==='return'?{returnedRequestId:prepared.taskApproval.requestId,reason:body.reason.trim()}:{}),
  raw.prepare('INSERT INTO audit(id,owner,action,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND data=?)').bind(crypto.randomUUID(),a.scope,`${a.email} — ${body.action}: ${data.name}; ${data.taskApproval.mode}; ${data.taskApproval.requestId}`,now,row.id,a.scope,encoded)
 ]);
 if(!results[0].meta.changes)throw new AccessError('تغيرت المهمة أو الطائرة أو صلاحياتك أو الأدلة أثناء العملية؛ حدّث الصفحة',409);
 return Response.json({ok:true,reviewState:data.reviewState,revision:data._revision});
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
