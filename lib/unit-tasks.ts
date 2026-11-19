import {unitAmendmentKinds,normalizeUnitAmendment,unitAmendmentEffects,validateUnitAmendmentSnapshot} from './unit-task-amendments';
import {componentAircraftId,componentDependencies,resolvedComponentLife} from './component-tree';
import {initializeSchedule,initializeOpening,nextOccurrence,normalizeVariationGrant,variationLimits,nominalLimits,scheduledLimits,calculationTrace} from './scheduling';
import {newDependencies,publishedEvidence} from './domain';
import {programDefinition,programData} from './program-store';
import {counter} from './recurrence';
import {validDate,programToday} from './program';
import {shortText} from './planning';
import {executionRecord} from './execution-record';
import {canonical} from './backup-format';
import {due} from './due';

export const unitTaskKinds=['unit_task','unit_execution','unit_variation',...unitAmendmentKinds];
export function assertUnitDefinition(unit:any,definition:any){if(!definition?.targetType||definition.targetType!=='component'&&definition.targetType!==(unit.data.unitType||'component')||definition.partNumbers?.length&&!definition.partNumbers.includes(unit.data.partNumber))throw Error('تغير نوع الأصل أو PN؛ يلزم تقييم الانطباق وانتقال البرنامج قبل تنفيذ الواجب');}
export function unitTaskView(row:any,c:any){try{const unit=c.planning.find((p:any)=>p.id===row.data.componentId&&p.kind==='component'&&p.state==='approved');assertUnitDefinition(unit,row.data.definitionSnapshot);const life=resolvedComponentLife(unit,c.planning,c.records);return {...row,aircraftId:componentAircraftId(unit,c.planning),life,due:due({...row.data,status:row.data.phase==='closed'?'closed':row.data.phase==='withdrawn'?'withdrawn':'open'},life,programToday(),'')}}catch(e:any){return {...row,due:{status:'unknown',reason:e.message}}}}
export async function normalizeUnitTask(kind:string,raw:any,old:any,c:any,db:any,bucket:any,scope:string,id:string){
 if(unitAmendmentKinds.includes(kind))return normalizeUnitAmendment(kind,raw,old,c,db,bucket,scope);
 const dep=newDependencies();let data:any;
 if(kind==='unit_task'){
  const unit=dep.add('planning_items',c.planning.find((p:any)=>p.kind==='component'&&p.id===raw.componentId&&p.state==='approved'));componentDependencies(unit,c.planning,c.records,dep);
  const life=resolvedComponentLife(unit,c.planning,c.records),program=dep.add('program_revisions',await db.prepare("SELECT * FROM program_revisions WHERE workspace_id=? AND id=? AND state='approved'").bind(scope,raw.programId).first());
  const def=await programDefinition(db,scope,program,raw.definitionCode);if(!def||!def.targetType||def.targetType!=='component'&&def.targetType!==unit.data.unitType||def.partNumbers?.length&&!def.partNumbers.includes(unit.data.partNumber))throw Error('تعريف البرنامج لا ينطبق على نوع الوحدة أو رقم قطعتها');
  const aircraftId=componentAircraftId(unit,c.planning),programMeta=JSON.parse(program.data);if(aircraftId&&(!programMeta.aircraftIds.includes(aircraftId)||!def.allAircraft&&!def.aircraftIds.includes(aircraftId)))throw Error('الطائرة المركب عليها الأصل خارج نطاق البرنامج');
  if(old&&(old.data.componentId!==unit.id||old.data.programId!==program.id||old.data.definitionCode!==def.code))throw Error('هوية مهمة الوحدة ومصدرها ثابتان');
  if(c.items.some((t:any)=>t.id!==id&&t.kind==='unit_task'&&t.state==='approved'&&t.data.phase==='open'&&t.data.componentId===unit.id&&t.data.programCode===program.code&&t.data.definitionCode===def.code))throw Error('توجد مرة مفتوحة لهذا الواجب على الوحدة');
  const baseline=raw.baseline||{},base={date:String(baseline.date||''),hours:counter(baseline.hours,'ساعات مرجع الوحدة'),cycles:counter(baseline.cycles,'دورات مرجع الوحدة',true)};
  if(!validDate(base.date)||base.date>programToday()||base.hours>life.hours||base.cycles>life.cycles||Math.round(base.hours*1e6)/1e6!==base.hours)throw Error('مرجع بدء حساب الوحدة غير صحيح');
  const basis=raw.basis||'documented';if(!['manufacture','overhaul','installation','documented'].includes(basis))throw Error('حدد أساس حساب الوحدة');
  if(basis==='overhaul'&&canonical(base)!==canonical({date:unit.data.overhaulBaseline?.date,hours:unit.data.overhaulBaseline?.hours,cycles:unit.data.overhaulBaseline?.cycles}))throw Error('المرجع لا يطابق آخر عمرة موثقة');
  const initialized=raw.opening?initializeOpening(def,base,life,raw.opening,id,id):initializeSchedule(def,base,id);
  initialized.schedule.policyEvidence=def.scheduleEvidence||[];
  data={componentId:unit.id,targetType:unit.data.unitType||'component',programId:program.id,programCode:program.code,definitionCode:def.code,definitionSnapshot:def,name:def.title,reference:shortText(raw.reference,'مرجع ترحيل مهمة الوحدة',200),basis,baseline:base,...(raw.opening?{opening:raw.opening}:{}),phase:'open',requiredWorkCard:def.requiredWorkCard===true,...initialized.limits,schedule:initialized.schedule,notes:shortText(raw.notes||'','ملاحظات',2000,false)};
 }else{
  const task=dep.add('extension_items',c.items.find((t:any)=>t.id===raw.taskId&&t.kind==='unit_task'&&t.state==='approved'&&t.data.phase==='open'));if(old&&old.data.taskId!==task.id)throw Error('المرة المستهدفة ثابتة');
  const unit=dep.add('planning_items',c.planning.find((u:any)=>u.id===task.data.componentId&&u.kind==='component'&&u.state==='approved'));componentDependencies(unit,c.planning,c.records,dep);assertUnitDefinition(unit,task.data.definitionSnapshot);const life=resolvedComponentLife(unit,c.planning,c.records);if(task.data.continuationUntil&&task.data.continuationUntil<programToday())throw Error('انتهت مهلة الاستمرار بقواعد البرنامج السابق');
  if(kind==='unit_execution'){
   const record=await executionRecord(db,bucket,scope,raw,life,{...task.data,_taskId:task.id},!!old&&old.state!=='draft');
   const next=nextOccurrence(task.data,record);data={...record,taskId:task.id,componentId:unit.id,next:next?{...next.limits,schedule:{...next.schedule,previousTaskId:task.id}}:null};
  }else{
   if(task.data.authorizedVariation)throw Error('يوجد تصريح قائم لهذه المرة');if(c.items.some((r:any)=>r.kind==='unit_execution'&&r.data.taskId===task.id))throw Error('لا يمنح تصريح بعد بدء توثيق التنفيذ');const nominal=nominalLimits(task.data);if(nominal.date&&nominal.date<=programToday()||nominal.hours!==''&&Number(nominal.hours)<=life.hours||nominal.cycles!==''&&Number(nominal.cycles)<=life.cycles)throw Error('لا يمنح تصريح بعد بلوغ أي حد أصلي');const source=await publishedEvidence(c,task.data.schedule.policy?.evidenceVersionIds||[],dep,bucket,true,true);if(canonical(source)!==canonical(task.data.schedule.policyEvidence))throw Error('دليل سياسة التصريح لا يطابق المصدر');const grant=normalizeVariationGrant(raw.grant,task.data);data={taskId:task.id,componentId:unit.id,grant,limits:variationLimits(task.data,grant),usageAtApproval:{hours:life.hours,cycles:life.cycles},reference:shortText(raw.reference,'مرجع التصريح'),reason:shortText(raw.reason,'مبرر التصريح',2000),nominal:nominalLimits(task.data)};
  }
 }
 return {data,checks:dep.checks};
}
export function unitTaskEffects(db:any,scope:string,kind:string,data:any,c:any,w:any){
 if(unitAmendmentKinds.includes(kind))return unitAmendmentEffects(db,scope,kind,data,c,w);
 if(kind==='unit_task')return [];
 const task=c.items.find((t:any)=>t.id===data.taskId),statements:any[]=[],update=(d:any)=>db.prepare('UPDATE extension_items SET data=?,etag=?,updated=? WHERE workspace_id=? AND id=? AND '+w.proof).bind(JSON.stringify(d),w.token,w.now,scope,task.id,...w.proofArgs);
 if(kind==='unit_variation')return [update({...task.data,authorizedVariation:{id:w.id,grant:data.grant,limits:data.limits,reference:data.reference,approvedAt:w.now,approvedDate:programToday(),approvedUsage:data.usageAtApproval}})];
 const nextId=data.next?crypto.randomUUID():null;statements.push(update({...task.data,phase:'closed',completionId:w.id,nextTaskId:nextId}));
 if(nextId){const next={...task.data,workCardId:null,...data.next,phase:'open',completionId:null,nextTaskId:null,authorizedVariation:null,generatedFromCompletion:w.id};statements.push(db.prepare("INSERT INTO extension_items(id,workspace_id,kind,code,state,data,etag,modified_by,submitted_by,reviewed_by,approved_by,created,updated) SELECT ?,?,'unit_task',?,'approved',?,?,?,?,?,?,?,? WHERE "+w.proof).bind(nextId,scope,task.code+'/R'+next.schedule.sequence,JSON.stringify(next),w.token,task.modified_by,task.submitted_by,task.reviewed_by,task.approved_by,w.now,w.now,...w.proofArgs))}
 return statements;
}
export function validateUnitTaskSnapshot(items:any[],planning:any[],programs:any[]){
 validateUnitAmendmentSnapshot(items);
 for(const row of items.filter((r:any)=>unitTaskKinds.includes(r.kind))){const d=row.data,unit=planning.find((p:any)=>p.kind==='component'&&p.id===d.componentId);if(!unit)throw Error('مرجع وحدة المهمة مفقود');
  if(row.kind==='unit_task'){const p=programs.find((p:any)=>p.id===d.programId),definition=p?.data.tasks.find((t:any)=>t.code===d.definitionCode);if(!definition||canonical(definition)!==canonical(d.definitionSnapshot))throw Error('مصدر مهمة الوحدة غير مطابق');const s=d.schedule,limits=scheduledLimits(s);if(!limits||canonical(limits)!==canonical(nominalLimits(d))||canonical(s.rules)!==canonical({first:definition.first,repeat:definition.repeat})||canonical(s.policy)!==canonical(definition.schedulePolicy||null)||canonical(s.calculation)!==canonical(calculationTrace(s,limits)))throw Error('حساب مهمة الوحدة غير مطابق');const root=items.find((t:any)=>t.id===s.rootTaskId&&t.kind==='unit_task');if(!root||root.data.componentId!==d.componentId||canonical(s.origin)!==canonical(nominalLimits(root.data)))throw Error('مرساة مهمة الوحدة غير مطابقة');if(d.phase==='closed'){const done=items.find((e:any)=>e.id===d.completionId&&e.kind==='unit_execution'&&e.state==='approved'&&e.data.taskId===row.id);if(!done)throw Error('مهمة وحدة مغلقة بلا تنفيذ معتمد');}if(s.sequence>1){const prev=items.find((t:any)=>t.id===s.previousTaskId&&t.kind==='unit_task');if(!prev||prev.data.nextTaskId!==row.id||prev.data.schedule.sequence+1!==s.sequence)throw Error('سلسلة مهمة الوحدة غير متصلة');}}
  else if(!items.some((t:any)=>t.kind==='unit_task'&&t.id===d.taskId&&t.data.componentId===d.componentId))throw Error('مصدر تنفيذ الوحدة أو تصريحها مفقود');
 }
}
