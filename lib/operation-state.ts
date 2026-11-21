import {effectiveUnitExecution} from './unit-execution';
import {componentAircraftId,resolvedComponentLife} from './component-tree';
import {executionRecord} from './execution-record';
import {recalculateOccurrence,nominalLimits} from './scheduling';
import {requireAircraftReady} from './aircraft';
import {counter,normalizeAccomplishment} from './recurrence';
import {normalizedFlight,ledgerTotals,roundHours,effectiveCompletion} from './operations';
import {AccessError} from './permissions';
export async function operationContext(db:any,scope:string){const rec=await db.prepare('SELECT * FROM records WHERE owner=?').bind(scope).all();const comp=await db.prepare("SELECT * FROM accomplishments WHERE workspace_id=? AND state='approved'").bind(scope).all();const eff=await db.prepare('SELECT * FROM effective_values WHERE workspace_id=?').bind(scope).all();const flight=await db.prepare('SELECT * FROM flights WHERE workspace_id=?').bind(scope).all();return {records:rec.results.map((r:any)=>({...r,raw:r.data,data:JSON.parse(r.data)})),completions:comp.results.map((r:any)=>({...r,data:JSON.parse(r.data)})),overrides:eff.results.map((r:any)=>({...r,data:JSON.parse(r.data)})),flights:flight.results.map((r:any)=>({...r,data:JSON.parse(r.data)}))}}
export async function correctionPlan(db:any,scope:string,kind:string,targetId:string,raw:any,bucket?:any){
 const c=await operationContext(db,scope);let target:any,before:any,plane:any,after:any;const updates:any[]=[];const impacts:any[]=[];
 if(kind==='counters'){target=c.records.find((r:any)=>r.kind==='aircraft'&&r.id===targetId);plane=target;before=target?{hours:Number(target.data.hours),cycles:Number(target.data.cycles)}:null;}
 else if(kind==='flight'){target=c.flights.find((r:any)=>r.id===targetId);const override=c.overrides.find((v:any)=>v.kind==='flight'&&v.target_id===targetId);before=override?.data||target?.data;plane=c.records.find((r:any)=>r.id===target?.aircraft_id&&r.kind==='aircraft');}
 else if(kind==='completion'){target=c.completions.find((r:any)=>r.id===targetId);before=target?effectiveCompletion(target,c.overrides):null;const task=c.records.find((r:any)=>r.kind==='task'&&r.id===target?.task_id);plane=c.records.find((r:any)=>r.kind==='aircraft'&&r.id===task?.data.aircraftId);}
 else throw Error('نوع تصحيح غير صالح');
 if(!target||!plane)throw new AccessError('هدف التصحيح غير موجود ضمن الدائرة',404);
 requireAircraftReady(plane.data);let planeAfter={...plane.data};
 if(kind==='counters'){
 const hours=counter(raw.hours,'الساعات المصححة'),cycles=counter(raw.cycles,'الدورات المصححة',true);if(hours!==roundHours(hours))throw Error('دقة الساعات المدعومة ست منازل عشرية');after={hours,cycles};planeAfter={...planeAfter,...after};
 if(plane.data.usageOpening)planeAfter.usageAdjustments={hours:roundHours(Number(plane.data.usageAdjustments?.hours||0)+hours-Number(plane.data.hours)),cycles:Number(plane.data.usageAdjustments?.cycles||0)+cycles-Number(plane.data.cycles)};
 }
 if(kind==='flight'){
 if(plane.data.configurationAsOf&&before.departure<plane.data.configurationAsOf)throw Error('تصحيح الاستخدام السابق لمرجع التكوين يحتاج مراجعة مرجع المكونات أولًا');
 after={...before,...normalizedFlight({...before,durationMinutes:raw.durationMinutes,cycles:raw.cycles})};const nextFlight=c.flights.filter((f:any)=>f.aircraft_id===plane.id&&f.departure>target.departure).sort((a:any,b:any)=>a.departure.localeCompare(b.departure))[0];if(nextFlight&&Date.parse(after.departure)+after.durationMinutes*60000>Date.parse(nextFlight.departure))throw Error('مدة الرحلة المصححة تتداخل مع رحلة تالية');if(!plane.data.usageOpening)throw Error('رصيد الاستخدام الافتتاحي غير موجود');const totals=ledgerTotals(plane.data,after.durationMinutes-before.durationMinutes,after.cycles-before.cycles);planeAfter={...planeAfter,...totals};
 }
 if(kind==='completion'){
 const task=c.records.find((r:any)=>r.id===target.task_id);if(!task)throw Error('مهمة التنفيذ غير موجودة');const prev=task.data.schedule?c.completions.find((e:any)=>e.task_id===task.data.schedule.previousTaskId):null;const baseline=prev?effectiveCompletion(prev,c.overrides):task.data.schedule?.baseline;const targetTask=task.data.schedule?{...task.data,schedule:{...task.data.schedule,baseline}}:task.data;
 after={...before,...await executionRecord(db,bucket,scope,{...before,...raw,exceptionReference:raw.exceptionReference??before.exceptionReference},plane.data,{...targetTask,_taskId:task.id})};
 const child=c.records.find((r:any)=>r.kind==='task'&&r.id===before.nextTaskId);
 if(child){
 const nextCompletion=c.completions.find((e:any)=>e.task_id===child.id);if(nextCompletion)normalizeAccomplishment(effectiveCompletion(nextCompletion,c.overrides),plane.data,after);
 const recalculated=recalculateOccurrence(child.data,after),limits=recalculated.limits;
 if(child.data.status==='closed')impacts.push({taskId:child.id,historicalOnly:true,message:'تبقى حدود المرة المغلقة كما كانت وقت التنفيذ؛ التصحيح محفوظ كإضافة.',calculatedLimits:limits});
 else{
 const pending:any=await db.prepare('SELECT * FROM accomplishments WHERE workspace_id=? AND task_id=?').bind(scope,child.id).first();if(pending){if(pending.state!=='draft')throw Error('أعد تنفيذ المرة التالية إلى المسودة قبل التصحيح');normalizeAccomplishment(JSON.parse(pending.data),plane.data,after);}
 if(child.data.authorizedVariation&&JSON.stringify(nominalLimits(child.data))!==JSON.stringify(limits))throw Error('تصحيح التنفيذ سيغير حدود مرة لها تسامح معتمد؛ ألغِ التسامح أولًا ثم أعد طلبه على الحدود الجديدة');const data={...child.data,...limits,schedule:recalculated.schedule};updates.push({...child,newData:data});impacts.push({taskId:child.id,before:{hours:child.data.hours,cycles:child.data.cycles,date:child.data.date},after:limits,message:'إعادة حساب المرة التالية المفتوحة دون إنشاء مهمة إضافية'});
 }
 }
 }
 for(const t of c.records.filter((r:any)=>r.kind==='task'&&r.data.aircraftId===plane.id&&r.data.schedule?.opening)){const last=t.data.schedule.opening.lastDone;if(last.hours>planeAfter.hours||last.cycles>planeAfter.cycles)throw Error('التصحيح أقل من آخر إنجاز مثبت في الحالة الافتتاحية');}
 if(Number(planeAfter.hours)<Number(plane.data.serviceHours||0)||Number(planeAfter.cycles)<Number(plane.data.serviceCycles||0))throw Error('العداد المصحح أقل من مرجع بدء الخدمة');
 counter(planeAfter.hours,'إجمالي الساعات بعد التصحيح');counter(planeAfter.cycles,'إجمالي الدورات بعد التصحيح',true);
 for(const e of c.completions){const t=c.records.find((r:any)=>r.id===e.task_id);if(t?.data.aircraftId!==plane.id)continue;const v=kind==='completion'&&e.id===target.id?after:effectiveCompletion(e,c.overrides);if(Number(v.hours)>Number(planeAfter.hours)||Number(v.cycles)>Number(planeAfter.cycles))throw Error('العداد المصحح أقل من تنفيذ معتمد. صحح التنفيذ المتأثر أولًا');}
 if(kind==='counters'||kind==='flight'){
 const installed=await db.prepare("SELECT * FROM planning_items WHERE workspace_id=? AND kind='component' AND state='approved'").bind(scope).all();const parts=installed.results.map((r:any)=>({...r,data:JSON.parse(r.data)}));for(const row of parts){const component=row.data;if(componentAircraftId(row,parts)!==plane.id)continue;if(kind==='flight'&&component.installation&&before.departure<component.installation.at)throw Error('تصحيح رحلة سابقة لتركيب مكوّن يحتاج مراجعة مرجع تركيب المكوّن أولًا');const previousLife=resolvedComponentLife(row,parts,c.records),nextLife=resolvedComponentLife(row,parts,c.records.map((r:any)=>r.id===plane.id?{...r,data:planeAfter}:r));const protectedWork=(await db.prepare("SELECT data,kind FROM extension_items WHERE workspace_id=? AND kind IN ('unit_task','unit_execution') AND state='approved' AND json_extract(data,'$.componentId')=?").bind(scope,row.id).all()).results;for(const r of protectedWork){const d=JSON.parse(r.data),b=r.kind==='unit_task'?d.schedule.baseline:effectiveUnitExecution({data:d});if(nextLife.hours<b.hours||nextLife.cycles<b.cycles)throw Error('العداد المصحح أقل من مرجع أو تنفيذ مهمة وحدة معتمدة');}impacts.push({message:`أثر المكوّن ${component.partNumber} / ${component.serialNumber}: العمر قبل ${previousLife.hours} FH / ${previousLife.cycles} FC، وبعد ${nextLife.hours} FH / ${nextLife.cycles} FC${nextLife.status==='expired'?' — بلغ حد العمر':''}`});}
 }
 if(JSON.stringify(before)===JSON.stringify(after))throw Error('لا يوجد تغيير في القيم');
 if(kind!=='completion')impacts.push({aircraftId:plane.id,before:{hours:Number(plane.data.hours),cycles:Number(plane.data.cycles)},after:{hours:Number(planeAfter.hours),cycles:Number(planeAfter.cycles)},message:'يتغير المتبقي للاستحقاق؛ حدود الصيانة نفسها لا تتغير'});
 return {target,plane,before,after,planeAfter,updates,impacts};
}
