import {newDependencies} from './domain';
import {componentDependencies,resolvedComponentLife} from './component-tree';
import {recalculateOccurrence,nominalLimits,scheduledLimits} from './scheduling';
import {executionRecord} from './execution-record';
import {normalizeAccomplishment} from './recurrence';
import {shortText} from './planning';
import {canonical} from './backup-format';
import {unitExecutionPayload,effectiveUnitExecution} from './unit-execution';
export const unitAmendmentKinds=['unit_execution_correction','unit_variation_revocation'];
export async function normalizeUnitAmendment(kind:string,raw:any,old:any,c:any,db:any,bucket:any,scope:string){
 const dep=newDependencies(),reason=shortText(raw.reason,'سبب التعديل ومراجعة أثره',2000);if(reason.length<10)throw Error('وثق سببًا واضحًا للتعديل');
 if(kind==='unit_variation_revocation'){
  const variation=dep.add('extension_items',c.items.find((r:any)=>r.id===raw.variationId&&r.kind==='unit_variation'&&r.state==='approved'));
  const task=dep.add('extension_items',c.items.find((r:any)=>r.id===variation.data.taskId&&r.kind==='unit_task'&&r.state==='approved'&&r.data.phase==='open'));
  if(task.data.authorizedVariation?.id!==variation.id)throw Error('التصريح لم يعد نشطًا لهذه المرة');if(old&&old.data.variationId!==variation.id)throw Error('التصريح المستهدف ثابت');
  if(c.items.some((r:any)=>r.kind==='unit_execution'&&r.data.taskId===task.id&&r.state!=='draft'))throw Error('أعد توثيق التنفيذ للمسودة قبل إلغاء التصريح');
  return {checks:dep.checks,data:{variationId:variation.id,taskId:task.id,componentId:task.data.componentId,reason,reference:shortText(raw.reference,'مرجع سحب التصريح'),previousAuthorization:task.data.authorizedVariation}};
 }
 const source=dep.add('extension_items',c.items.find((r:any)=>r.id===raw.executionId&&r.kind==='unit_execution'&&r.state==='approved'));
 if(old&&old.data.executionId!==source.id)throw Error('التنفيذ المستهدف ثابت');
 const task=dep.add('extension_items',c.items.find((r:any)=>r.id===source.data.taskId&&r.kind==='unit_task'&&r.state==='approved'&&r.data.phase==='closed'));
 if(task.data.completionId!==source.id)throw Error('التنفيذ لا يطابق المرة المنفذة');
 const unit=dep.add('planning_items',c.planning.find((r:any)=>r.id===task.data.componentId&&r.kind==='component'&&r.state==='approved'));componentDependencies(unit,c.planning,c.records,dep);const life=resolvedComponentLife(unit,c.planning,c.records),before=effectiveUnitExecution(source);
 let target=task.data;
 if(task.data.schedule.previousTaskId){const previous=dep.add('extension_items',c.items.find((r:any)=>r.kind==='unit_execution'&&r.state==='approved'&&r.data.taskId===task.data.schedule.previousTaskId));target={...target,schedule:{...target.schedule,baseline:effectiveUnitExecution(previous)}};}
 const record=await executionRecord(db,bucket,scope,raw,life,{...target,_taskId:task.id},!!old&&old.state!=='draft');if(canonical(before)===canonical(record))throw Error('لا يوجد تغيير في التنفيذ');
 let next:any=null,impact:any=null;
 if(task.data.nextTaskId){
  const child=dep.add('extension_items',c.items.find((r:any)=>r.id===task.data.nextTaskId&&r.kind==='unit_task'&&r.state==='approved'));if(child.data.phase==='withdrawn')throw Error('المرة التالية انتقلت إلى برنامج آخر؛ راجع خطة الانتقال قبل تعديل مرجعها');
  const recalculated=recalculateOccurrence(child.data,record),childCompletion=c.items.find((r:any)=>r.kind==='unit_execution'&&r.data.taskId===child.id);
  if(childCompletion){dep.add('extension_items',childCompletion);if(childCompletion.state!=='draft'&&childCompletion.state!=='approved')throw Error('أعد تنفيذ المرة التالية للمسودة قبل تعديل مرجعها');normalizeAccomplishment(effectiveUnitExecution(childCompletion),life,record)}
  if(child.data.phase==='closed')impact={taskId:child.id,historicalOnly:true,calculatedLimits:recalculated.limits};
  else{
   if(child.data.phase!=='open')throw Error('حالة المرة التالية لا تسمح بإعادة الحساب');
   if(child.data.authorizedVariation&&canonical(nominalLimits(child.data))!==canonical(recalculated.limits))throw Error('يلزم اعتماد سحب تصريح المرة التالية قبل تغيير حدودها ثم طلب التصريح على الحدود الجديدة');
   next={id:child.id,...recalculated};impact={taskId:child.id,historicalOnly:false,before:nominalLimits(child.data),after:recalculated.limits};
  }
 }
 return {checks:dep.checks,data:{...record,executionId:source.id,taskId:task.id,componentId:unit.id,reason,supersedesId:source.data.effectiveExecution?.correctionId||null,before,next,impact}};
}
export function unitAmendmentEffects(db:any,scope:string,kind:string,data:any,c:any,w:any){
 const update=(row:any,d:any,state=row.state)=>db.prepare('UPDATE extension_items SET state=?,data=?,etag=?,updated=? WHERE workspace_id=? AND id=? AND '+w.proof).bind(state,JSON.stringify(d),w.token,w.now,scope,row.id,...w.proofArgs);
 if(kind==='unit_variation_revocation'){
  const variation=c.items.find((r:any)=>r.id===data.variationId),task=c.items.find((r:any)=>r.id===data.taskId);return [update(variation,{...variation.data,revokedBy:w.id},'revoked'),update(task,{...task.data,authorizedVariation:null})];
 }
 const source=c.items.find((r:any)=>r.id===data.executionId),statements=[update(source,{...source.data,effectiveExecution:{correctionId:w.id,data:unitExecutionPayload(data)}})];
 if(data.next){const child=c.items.find((r:any)=>r.id===data.next.id);statements.push(update(child,{...child.data,...data.next.limits,schedule:data.next.schedule,lastExecutionCorrectionId:w.id}))}
 return statements;
}
export function validateUnitAmendmentSnapshot(items:any[]){
 for(const r of items.filter((r:any)=>r.kind==='unit_execution_correction')){
  const d=r.data,source=items.find((x:any)=>x.id===d.executionId&&x.kind==='unit_execution'&&x.state==='approved'),task=items.find((x:any)=>x.id===d.taskId&&x.kind==='unit_task'&&x.state==='approved');
  if(!source||!task||source.data.taskId!==task.id||task.data.completionId!==source.id||source.data.componentId!==d.componentId)throw Error('مصدر تصحيح تنفيذ الوحدة غير مطابق');
  const prior=d.supersedesId?items.find((x:any)=>x.id===d.supersedesId&&x.kind==='unit_execution_correction'&&x.state==='approved'&&x.data.executionId===source.id):source;
  if(!prior||canonical(unitExecutionPayload(prior.data))!==canonical(d.before))throw Error('التنفيذ السابق للتصحيح غير مطابق');
  const seen=new Set([r.id]);let previous=d.supersedesId;while(previous){if(seen.has(previous))throw Error('حلقة في سجل التصحيحات');seen.add(previous);const p=items.find((x:any)=>x.id===previous&&x.kind==='unit_execution_correction'&&x.state==='approved');if(!p)throw Error('تصحيح سابق مفقود');previous=p.data.supersedesId;}
  if(d.next&&(d.next.id!==task.data.nextTaskId||canonical(scheduledLimits(d.next.schedule))!==canonical(d.next.limits)||canonical(d.next.schedule.baseline)!==canonical({date:d.date,hours:d.hours,cycles:d.cycles})))throw Error('حساب أثر التصحيح غير مطابق');
 }
 for(const r of items.filter((r:any)=>r.kind==='unit_execution'&&r.data.effectiveExecution)){
  const effective=r.data.effectiveExecution,correction=items.find((x:any)=>x.id===effective.correctionId&&x.kind==='unit_execution_correction'&&x.state==='approved'&&x.data.executionId===r.id);
  if(!correction||canonical(effective.data)!==canonical(unitExecutionPayload(correction.data)))throw Error('القيمة الفعلية لتنفيذ الوحدة بلا تصحيح معتمد مطابق');
 }
 for(const r of items.filter((r:any)=>r.kind==='unit_task'&&r.state==='approved')){
  const d=r.data;if(d.phase==='open'&&d.schedule.sequence>1){const previous=items.find((x:any)=>x.kind==='unit_execution'&&x.state==='approved'&&x.data.taskId===d.schedule.previousTaskId);if(!previous)throw Error('مرجع المرة المفتوحة مفقود');const value=effectiveUnitExecution(previous);if(canonical(d.schedule.baseline)!==canonical({date:value.date,hours:value.hours,cycles:value.cycles}))throw Error('مرجع المرة المفتوحة لا يطابق التنفيذ الفعلي');}
  if(d.authorizedVariation){const v=items.find((x:any)=>x.id===d.authorizedVariation.id&&x.kind==='unit_variation'&&x.state==='approved'&&x.data.taskId===r.id);if(!v||canonical(v.data.limits)!==canonical(d.authorizedVariation.limits)||canonical(v.data.grant)!==canonical(d.authorizedVariation.grant))throw Error('تصريح الوحدة لا يطابق طلبه المعتمد');}
 }
 for(const r of items.filter((r:any)=>r.kind==='unit_variation_revocation')){
  const d=r.data,v=items.find((x:any)=>x.id===d.variationId&&x.kind==='unit_variation'&&x.data.taskId===d.taskId&&x.data.componentId===d.componentId);if(!v||d.previousAuthorization?.id!==v.id||canonical(d.previousAuthorization.grant)!==canonical(v.data.grant)||r.state==='approved'&&(v.state!=='revoked'||v.data.revokedBy!==r.id))throw Error('سجل سحب تصريح الوحدة غير مطابق');
 }
}
