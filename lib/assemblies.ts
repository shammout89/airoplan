import {componentAircraftId,resolvedComponentLife,componentDependencies} from './component-tree';
import {newDependencies,publishedEvidence,isoTime,sameContext} from './domain';
import {shortText} from './planning';
import {requireAircraftReady} from './aircraft';

export async function normalizeAssembly(raw:any,old:any,c:any,bucket:any,strict=false){
 const dep=newDependencies(),child=dep.add('planning_items',c.planning.find((p:any)=>p.kind==='component'&&p.id===raw.componentId&&p.state==='approved'));
 if(old&&(old.data.componentId!==child.id||old.data.operation!==raw.operation))throw Error('نوع الحركة والمكوّن ثابتان؛ أنشئ إجراء آخر');
 if(!['attach','detach'].includes(raw.operation))throw Error('اختر تركيبًا داخل تجميعة أو فكًا منها');
 const reference=shortText(raw.reference,'مرجع إجراء التجميعة',200),at=isoTime(raw.at,'وقت مرجع التركيب');
 if(old&&old.data.reference!==reference)throw Error('مرجع الإجراء ثابت');
 const d=child.data,parentId=raw.operation==='detach'?d.assembly?.parentId:raw.parentId;
 const parent=dep.add('planning_items',c.planning.find((p:any)=>p.kind==='component'&&p.id===parentId&&p.state==='approved'));
 componentDependencies(parent,c.planning,c.records,dep);
 if(parent.id===child.id)throw Error('لا يمكن تركيب المكوّن داخل نفسه');
 const parentLife=resolvedComponentLife(parent,c.planning,c.records,new Set([child.id]));
 const aircraftId=componentAircraftId(parent,c.planning),plane=aircraftId?dep.add('records',c.records.find((p:any)=>p.kind==='aircraft'&&p.id===aircraftId)):null;
 if(plane)requireAircraftReady(plane.data);
 const latest=[d.lastAssemblyEventAt,d.lastUnitEventAt,parent.data.lastAssemblyEventAt,parent.data.lastUnitEventAt].filter(Boolean).sort().at(-1);
 if(latest&&at<latest)throw Error('الإجراء يسبق آخر مرجع للعدادات أو التجميعة؛ وثق التسلسل أولًا');
 const lastFlight=c.flights.filter((f:any)=>f.aircraft_id===aircraftId).map((f:any)=>new Date(Date.parse(f.data.departure)+f.data.durationMinutes*60000).toISOString()).sort().at(-1);
 if(lastFlight&&at<lastFlight)throw Error('الإجراء يسبق آخر استخدام مرحل؛ استورد التكوين الافتتاحي على مرجع عدادات حالي');
 let after:any,position:string;
 if(raw.operation==='attach'){
  if(d.installation||d.assembly)throw Error('المكوّن مركب بالفعل؛ فكه قبل نقله');
  const life=resolvedComponentLife(child,c.planning,c.records);
  if(d.condition!=='serviceable'||life.status==='expired'||parent.data.condition==='scrapped')throw Error('حالة أو عمر المكوّن لا يسمحان بالتركيب');
  position=shortText(raw.position,'الموضع داخل التجميعة',100).toUpperCase();
  if(c.planning.some((p:any)=>p.id!==child.id&&p.kind==='component'&&p.data.assembly?.parentId===parent.id&&p.data.assembly?.position===position))throw Error('الموضع داخل التجميعة مشغول');
  after={...d,assembly:{parentId:parent.id,position,parentHours:parentLife.hours,parentCycles:parentLife.cycles,at,recordType:raw.recordType==='opening'?'opening':'movement'},lastAssemblyEventAt:at};
 }else{
  if(!d.assembly)throw Error('المكوّن غير مركب داخل تجميعة');
  const life=resolvedComponentLife(child,c.planning,c.records);position=d.assembly.position;
  if(!['serviceable','quarantine','scrapped'].includes(raw.afterCondition)||raw.afterCondition==='serviceable'&&life.status==='expired')throw Error('حدد حالة صحيحة بعد الفك؛ لا يعاد جزء منتهي العمر للخدمة');
  after={...d,totalHours:life.hours,totalCycles:life.cycles,assembly:null,condition:raw.afterCondition,location:shortText(raw.location,'موقع التخزين بعد الفك',100),lastAssemblyEventAt:at};
 }
 const evidence=await publishedEvidence(c,raw.evidenceVersionIds||[],dep,bucket,strict,true);
 const context=dep.checks.map(d=>({table:d.table,id:d.id,column:d.column,proof:d.proof})).sort((a,b)=>(a.table+a.id).localeCompare(b.table+b.id));if(strict)sameContext(old.data.context,context);
 const data={componentId:child.id,parentId:parent.id,aircraftId,operation:raw.operation,position,at,recordType:raw.recordType==='opening'?'opening':'movement',reference,afterCondition:after.condition,location:after.location||'',notes:shortText(raw.notes||'','ملاحظات',2000,false),before:d,after,parentCounters:{hours:parentLife.hours,cycles:parentLife.cycles},context,evidenceVersionIds:evidence.map(e=>e.versionId),evidenceSnapshot:evidence};
 return {data,child,parent,plane,checks:dep.checks};
}
