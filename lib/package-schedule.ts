import {counter} from './recurrence';
import {validDate} from './program';

export type TaskSlot={taskId:string,start:string,end:string,manHours:number,dependencies:string[],resourceIds:string[]};
const instant=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

export function packageSchedule(raw:any,tasks:any[],allocations:any[],resources:any[]){
 const ids=new Set<string>(tasks.map(t=>t.id));
 const source=raw.taskPlan??tasks.map(t=>({taskId:t.id,start:raw.start,end:raw.end,manHours:Number(raw.plannedManHours)/tasks.length,dependencies:[],resourceIds:[]}));
 if(!Array.isArray(source)||source.length!==tasks.length||new Set(source.map(s=>s.taskId)).size!==tasks.length)throw Error('يلزم موعد تنفيذ واحد لكل مهمة في الحزمة');
 const rows:TaskSlot[]=source.map(s=>{
  if(!ids.has(s.taskId)||!instant(s.start)||!instant(s.end)||s.start>=s.end||s.start<raw.start||s.end>raw.end)throw Error('نافذة المهمة يجب أن تقع داخل نافذة الحزمة');
  const dependencies=s.dependencies||[],resourceIds=s.resourceIds||[];
  if(!Array.isArray(dependencies)||new Set(dependencies).size!==dependencies.length||dependencies.some(id=>id===s.taskId||!ids.has(id)))throw Error('مراجع تسلسل المهام غير صالحة');
  if(!Array.isArray(resourceIds)||new Set(resourceIds).size!==resourceIds.length||resourceIds.some(id=>!allocations.some(a=>a.resourceId===id)))throw Error('مورد المهمة غير محجوز للحزمة');
  return {taskId:s.taskId,start:s.start,end:s.end,manHours:counter(s.manHours,'جهد المهمة'),dependencies,resourceIds};
 });
 const map=new Map(rows.map(r=>[r.taskId,r])),visiting=new Set<string>(),done=new Set<string>();
 const visit=(id:string)=>{if(visiting.has(id))throw Error('اعتماد دائري بين مهام الحزمة');if(done.has(id))return;visiting.add(id);const row=map.get(id)!;for(const d of row.dependencies){visit(d);if(map.get(d)!.end>row.start)throw Error('تبدأ مهمة قبل نهاية المهمة السابقة لها')}visiting.delete(id);done.add(id)};
 for(const id of ids)visit(id);
 const total=rows.reduce((n,r)=>n+r.manHours,0);
 if(Math.abs(total-Number(raw.plannedManHours))>0.000001)throw Error('مجموع جهد المهام لا يطابق ساعات الحزمة');
 const manpower=allocations.reduce((n,a)=>n+(resources.find(r=>r.id===a.resourceId)?.data.type==='manpower'?a.quantity:0),0);
 for(const at of rows.map(r=>r.start)){
  const active=rows.filter(r=>r.start<=at&&r.end>at),required=active.reduce((n,r)=>n+r.manHours/((Date.parse(r.end)-Date.parse(r.start))/3600000),0);
  if(required>manpower+0.000001)throw Error('تتجاوز المهام المتزامنة طاقة الأفراد في جدول الحزمة');
  for(const a of allocations)if(resources.find(r=>r.id===a.resourceId)?.data.type!=='manpower'&&active.filter(r=>r.resourceIds.includes(a.resourceId)).length>a.quantity)throw Error('مورد مشترك محجوز لمهام متزامنة فوق سعته');
 }
 const byDuration=new Map<string,number>();
 const depth=(id:string):number=>{if(byDuration.has(id))return byDuration.get(id)!;const r=map.get(id)!,n=(Date.parse(r.end)-Date.parse(r.start))/3600000+Math.max(0,...r.dependencies.map(depth));byDuration.set(id,n);return n};
 for(const id of ids)depth(id);
 return {rows,totalManHours:Math.round(total*1e6)/1e6,criticalPathHours:Math.max(0,...byDuration.values()),explicit:raw.taskPlan!==undefined};
}

export function packageDueWarnings(tasks:any[],schedule:ReturnType<typeof packageSchedule>,forecasts:any[]){
 return tasks.flatMap(t=>{
  const slot=schedule.rows.find(r=>r.taskId===t.id)!,f=forecasts.find(r=>r.taskId===t.id),calendar=t.data.date;
  if(calendar&&!validDate(calendar))throw Error('تاريخ استحقاق غير صالح في الحزمة');
  const atEnd=slot.end.slice(0,10),calendarRisk=!!calendar&&calendar<atEnd;
  return calendarRisk||f?.overdue||f?.date&&f.date<atEnd?[{taskId:t.id,message:'يحتاج الإنجاز المخطط مراجعة مقابل حد المهمة',date:calendarRisk?calendar:f.date,plannedEnd:slot.end,authorizedDate:f?.authorized?.date||null,variationReference:f?.variationReference||null}]:[];
 });
}
