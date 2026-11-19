import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission,requireAircraftInScope,scopedAircraftSet} from '../../../lib/access';
import {AccessError,workflowTransition} from '../../../lib/permissions';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {domainContext,domainLock,newDependencies,publishedEvidence,commitDomain,sameContext} from '../../../lib/domain';
import {policyGate,policyWrites} from '../../../lib/approval-policy';
import {requireAircraftReady} from '../../../lib/aircraft';
import {normalizeVariationGrant,nominalLimits,variationLimits} from '../../../lib/scheduling';
import {programToday} from '../../../lib/program';
export const dynamic='force-dynamic';
const text=(v:any,label:string,max=500)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw Error('أدخل '+label);return v.trim()};
export async function GET(req:Request){try{const a=await access(),taskId=new URL(req.url).searchParams.get('taskId'),db=env.DB!,allowedPlanes=await scopedAircraftSet(a);const rows=await db.prepare("SELECT * FROM extension_items WHERE workspace_id=? AND kind='schedule_variation' ORDER BY created DESC,id").bind(a.scope).all();const evidence=await db.prepare('SELECT id,document_id,revision,file_name,digest FROM document_versions WHERE workspace_id=? AND published IS NOT NULL ORDER BY created DESC').bind(a.scope).all();return Response.json({items:rows.results.map((r:any)=>({...r,data:JSON.parse(r.data)})).filter((r:any)=>(!taskId||r.data.taskId===taskId)&&(!allowedPlanes||allowedPlanes.has(r.data.aircraftId))),evidence:evidence.results})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access(),db=env.DB!;lease=await acquireWrite(a,req);const b:any=await req.json();if(JSON.stringify(b).length>24000)throw Error('حجم طلب التسامح كبير');
 const lock=await domainLock(db,a.scope),c=await domainContext(db,a.scope),old=b.id?c.items.find((r:any)=>r.id===b.id&&r.kind==='schedule_variation'):null;
 if(b.id&&!old)throw new AccessError('طلب التسامح غير موجود',404);if(old&&b.etag!==old.etag)throw new AccessError('تغير الطلب؛ حدّث الصفحة',409);
 const raw=b.action==='save'?b.data:old?.data;if(!raw)throw Error('طلب غير صالح');
 const task=c.records.find((r:any)=>r.id===raw.taskId&&r.kind==='task'),plane=c.records.find((r:any)=>r.id===task?.data.aircraftId&&r.kind==='aircraft');if(!task||!plane)throw Error('المهمة أو الطائرة غير موجودة');requireAircraftInScope(a,{id:plane.id,...plane.data});requireAircraftReady(plane.data);
 if(['closed','withdrawn'].includes(task.data.status))throw new AccessError('المرة مغلقة؛ لا يمكن تغيير تصريحها',409);
 const dep=newDependencies();dep.add('records',task,'data');dep.add('records',plane,'data');let state=old?.state||'draft',data:any,actors:any={modified:old?.modified_by||a.userId},pending:any;
 if(b.action==='cancel'){
  requirePermission(a,'edit_task');if(!old||state!=='approved'||task.data.authorizedVariation?.id!==old.id)throw Error('لا يوجد تسامح نشط لهذا الطلب');
  if(c.completions.some((e:any)=>e.task_id===task.id&&e.state!=='draft'))throw Error('أعد التنفيذ للمسودة قبل إلغاء التسامح');
  data={...old.data,cancelReason:text(b.reason,'سبب الإلغاء'),cancelledBy:a.userId,cancelledAt:new Date().toISOString()};state='cancelled';actors={modified:old.modified_by,submitted:old.submitted_by,reviewed:old.reviewed_by,approved:old.approved_by};
 }else if(b.action==='return'){
  requirePermission(a,'edit_task');if(!old||!['submitted','reviewed'].includes(state))throw Error('لا يمكن إعادة الطلب للمسودة');data=old.data;state='draft';
 }else{
  if(task.data.reviewState!=='approved')throw Error('اعتمد تخطيط المهمة أولًا');
  if(task.data.authorizedVariation)throw Error('يوجد تسامح معتمد لهذه المرة؛ لا يُسمح بتراكم التمديدات');
  if(c.items.some((v:any)=>v.kind==='schedule_variation'&&v.id!==old?.id&&v.data.taskId===task.id&&v.state==='approved'))throw Error('يوجد تصريح سابق للمرة لم تتم تسويته');
  if(c.completions.some((e:any)=>e.task_id===task.id))throw Error('لا يمكن منح تسامح بعد تسجيل التنفيذ؛ سجّل التجاوز الفعلي بمراجعة مستقلة');
  // Mandatory technical links follow the entire recurrence chain, including superseded source revisions.
  const roots=new Set([task.id,task.data.schedule?.rootTaskId]);for(const assessment of c.items.filter((r:any)=>r.kind==='applicability'&&r.state==='approved'&&r.data.decision==='applicable')){
   const linked=assessment.data.taskIds.some((id:string)=>roots.has(id)||roots.has(c.records.find((t:any)=>t.id===id)?.data.schedule?.rootTaskId));
   if(linked){const revision=c.items.find((r:any)=>r.id===assessment.data.revisionId);if(!revision||revision.data.type==='AD'||revision.data.type==='OTHER')throw Error('المهمة مرتبطة بمتطلب إلزامي أو غير مصنف؛ لا يسمح مسار التسامح العام بتمديدها');dep.add('extension_items',assessment);dep.add('extension_items',revision)}
  }
  const nominal=nominalLimits(task.data),today=programToday();if(nominal.date&&nominal.date<=today||nominal.hours!==''&&Number(nominal.hours)<=Number(plane.data.hours)||nominal.cycles!==''&&Number(nominal.cycles)<=Number(plane.data.cycles))throw Error('لا يعتمد تسامح بأثر رجعي أو بعد بلوغ أي حد أصلي');
  const grant=normalizeVariationGrant(raw.grant,task.data),source=await publishedEvidence(c,task.data.schedule.policy.evidenceVersionIds,dep,env.BUCKET,true,true),evidence=await publishedEvidence(c,raw.evidenceVersionIds,dep,env.BUCKET,true,true);
  if(JSON.stringify(source)!==JSON.stringify(task.data.schedule.policyEvidence))throw Error('دليل السياسة المحفوظ غير مطابق');
  data={taskId:task.id,aircraftId:plane.id,taskName:task.data.name,sequence:task.data.schedule.sequence,grant,limits:variationLimits(task.data,grant),reason:text(raw.reason,'مبرر التسامح',2000),authorityReference:text(raw.authorityReference,'مرجع إجراء التسامح وصلاحية الموافقة'),evidenceVersionIds:raw.evidenceVersionIds,evidenceSnapshot:evidence,context:{nominal,schedule:task.data.schedule,policyEvidence:source}};
  if(old&&old.data.taskId!==task.id)throw Error('هوية المهمة ثابتة');
  if(b.action==='save'){requirePermission(a,'edit_task');if(state!=='draft')throw Error('أعد الطلب للمسودة قبل تعديله');actors={modified:a.userId}}
  else{if(!old||!['submit','review','approve'].includes(b.action))throw Error('إجراء غير صالح');sameContext(old.data,data);pending=await policyGate(db,a,'schedule_variation',old,b.action);const next=workflowTransition({reviewState:state,modifiedBy:old.modified_by,submittedBy:old.submitted_by,reviewedBy:old.reviewed_by},b.action,a.userId,a.role);state=next.reviewState;actors={modified:old.modified_by,submitted:next.submittedBy,reviewed:next.reviewedBy,approved:next.approvedBy}}
 }
 return Response.json(await commitDomain(db,a,lock,old,'schedule_variation',old?.code||'PV-'+crypto.randomUUID(),data,state,actors,dep.checks,w=>{
  const extra=policyWrites(db,a,pending,w.id,w.token);
  if(state==='approved'||state==='cancelled'){
   const t={...task.data,_revision:w.token};if(state==='approved')t.authorizedVariation={id:w.id,approvedBy:a.userId,approvedAt:w.now,approvedDate:programToday(),approvedUsage:{hours:Number(plane.data.hours),cycles:Number(plane.data.cycles)},nominal:data.context.nominal,grant:data.grant,limits:data.limits,reference:data.authorityReference,evidenceSnapshot:data.evidenceSnapshot};else delete t.authorizedVariation;
   extra.push(db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND '+w.proof).bind(JSON.stringify(t),w.now,task.id,a.scope,...w.proofArgs));
  }
  // Serializes all flight, correction and execution writes that share the aircraft.
  extra.push(db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND '+w.proof).bind(JSON.stringify({...plane.data,_revision:w.token}),w.now,plane.id,a.scope,...w.proofArgs));return extra;
 },'تسامح الاستحقاق / '+b.action+' — '+task.data.name));
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
