import {initializeOpening} from './scheduling';
import {serviceBaseline} from './recurrence';
import {requireAircraftReady} from './aircraft';
import {newDependencies,publishedEvidence,sameContext} from './domain';
import {programDefinition} from './program-store';
import {applies} from './program';
import {pinScheduleEvidence} from './schedule-evidence';
export async function openingStatus(db:any,bucket:any,scope:string,id:string,raw:any,old:any,strict=false){
 const dep=newDependencies();
 const r:any=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='task'").bind(raw.taskId,scope).first();
 if(!r)throw Error('مهمة الحالة الافتتاحية غير موجودة');
 const task=dep.add('records',{...r,raw:r.data,data:JSON.parse(r.data)}),t=task.data;
 if(['closed','withdrawn'].includes(t.status)||t.schedule||!t.programRevisionId)throw Error('اختر مهمة مفتوحة مرتبطة ببرنامج ولم يهيأ تسلسلها');
 if(old&&old.data.taskId!==task.id)throw Error('مهمة الحالة الافتتاحية ثابتة');
 if(await db.prepare('SELECT id FROM accomplishments WHERE workspace_id=? AND task_id=?').bind(scope,task.id).first())throw Error('يوجد سجل إنجاز لهذه المهمة؛ لا تستبدله بحالة افتتاحية');
 const a:any=await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='aircraft'").bind(t.aircraftId,scope).first();if(!a)throw Error('الطائرة غير موجودة');
 const plane=dep.add('records',{...a,raw:a.data,data:JSON.parse(a.data)});requireAircraftReady(plane.data);
 const p:any=await db.prepare("SELECT * FROM program_revisions WHERE id=? AND workspace_id=? AND state='approved'").bind(t.programRevisionId,scope).first();if(!p)throw Error('يلزم إصدار برنامج حالي معتمد');dep.add('program_revisions',p);
 const definition=await programDefinition(db,scope,p,t.programTaskCode);if(!definition||!applies(JSON.parse(p.data),definition,plane.id))throw Error('تعريف البرنامج غير منطبق');
 if(strict)await pinScheduleEvidence(db,bucket,scope,{tasks:[definition]},true);
 const evidence=await publishedEvidence({versions:(await db.prepare('SELECT * FROM document_versions WHERE workspace_id=?').bind(scope).all()).results},raw.evidenceVersionIds||[],dep,bucket,strict,true);
 const imported=initializeOpening(definition,serviceBaseline(plane.data),plane.data,raw,task.id,id);
 imported.schedule.policyEvidence=definition.scheduleEvidence||[];
 const context={task:task.raw,plane:plane.raw,programEtag:p.etag};if(strict)sameContext(old.data.context,context);
 const data={taskId:task.id,aircraftId:plane.id,programId:p.id,programTaskCode:t.programTaskCode,reference:imported.schedule.opening.reference,ordinal:imported.schedule.opening.ordinal,lastDone:imported.schedule.opening.lastDone,previousDue:imported.schedule.opening.previousDue,nextDue:imported.limits,imported,context,evidenceVersionIds:evidence.map(e=>e.versionId),evidenceSnapshot:evidence,notes:String(raw.notes||'').trim()};
 if(data.notes.length>2000)throw Error('الملاحظات طويلة');
 return {data,task,plane,checks:dep.checks};
}
