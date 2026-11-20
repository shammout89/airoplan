import {programToday} from './program';
import {aircraftPlanningBlock} from './aircraft';
import {due} from './due';
import {AircraftScopePolicy,DEFAULT_AIRCRAFT_SCOPE,extractScopedAircraftIds} from './aircraft-scope';

export async function workspaceData(db:any,scope:string,url:URL,aircraftScope:AircraftScopePolicy=DEFAULT_AIRCRAFT_SCOPE){
 const allBase=(await db.prepare("SELECT * FROM records WHERE owner=? AND kind IN ('aircraft','field') ORDER BY kind,id").bind(scope).all()).results.map((r:any)=>({...r,data:JSON.parse(r.data)}));
 const allPlanes=allBase.filter((r:any)=>r.kind==='aircraft');
 const restricted=aircraftScope?.mode==='restricted';
 const scopedPlaneIds=restricted?extractScopedAircraftIds(aircraftScope,allPlanes.map((r:any)=>({id:r.id,model:r.data.model,type:r.data.type,name:r.data.name}))):null;
 const base=scopedPlaneIds?allBase.filter((r:any)=>r.kind!=='aircraft'||scopedPlaneIds.has(r.id)):allBase;
 const planes=new Map<string,any>(base.filter((r:any)=>r.kind==='aircraft').map((r:any)=>[r.id,r.data]));
 const allProjection=(await db.prepare("SELECT id,json_extract(data,'$.name') name,json_extract(data,'$.aircraftId') aircraftId,json_extract(data,'$.reference') reference,json_extract(data,'$.date') date,json_extract(data,'$.hours') hours,json_extract(data,'$.cycles') cycles,json_extract(data,'$.status') status,json_extract(data,'$.reviewState') reviewState,json_extract(data,'$.continuationUntil') continuationUntil FROM records WHERE owner=? AND kind='task' ORDER BY id").bind(scope).all()).results;
 const projection=scopedPlaneIds?allProjection.filter((t:any)=>scopedPlaneIds.has(t.aircraftId)):allProjection;
 const rawLocks=(await db.prepare("SELECT json_extract(data,'$.installation.aircraftId') aircraftId FROM planning_items WHERE workspace_id=? AND kind='component' AND state='approved' AND json_extract(data,'$.installation.aircraftId') IS NOT NULL").bind(scope).all()).results.map((r:any)=>r.aircraftId);
 const locks=scopedPlaneIds?rawLocks.filter((id:string)=>scopedPlaneIds.has(id)):rawLocks;
 const rawScheduled=(await db.prepare("SELECT DISTINCT json_extract(data,'$.aircraftId') aircraftId FROM records WHERE owner=? AND kind='task' AND json_extract(data,'$.schedule') IS NOT NULL").bind(scope).all()).results.map((r:any)=>r.aircraftId);
 const scheduled=scopedPlaneIds?rawScheduled.filter((id:string)=>scopedPlaneIds.has(id)):rawScheduled;
 const rawAssignments=(await db.prepare("SELECT id,kind,code,state,data,etag,modified_by,updated FROM extension_items WHERE workspace_id=? AND kind='planner_assignment' ORDER BY updated DESC").bind(scope).all()).results.map((r:any)=>({...r,data:JSON.parse(r.data)}));
 let assignments=rawAssignments;
 if(scopedPlaneIds&&rawAssignments.length){
  const taskPlaneMap=new Map<string,string>(allProjection.map((t:any)=>[t.id,t.aircraftId]));
  const pkgRows=(await db.prepare("SELECT id,json_extract(data,'$.aircraftId') aircraftId FROM planning_items WHERE workspace_id=? AND kind='package'").bind(scope).all()).results;
  const pkgPlaneMap=new Map<string,string>(pkgRows.map((p:any)=>[p.id,p.aircraftId]));
  assignments=rawAssignments.filter((a:any)=>{
   const planeId=a.data?.targetType==='package'?pkgPlaneMap.get(a.data.targetId):taskPlaneMap.get(a.data?.targetId);
   return !!planeId&&scopedPlaneIds.has(planeId);
  });
 }
 const rawAccomplishments=(await db.prepare("SELECT id,task_id,state,etag,modified_by,submitted_by,reviewed_by,approved_by,updated,data FROM accomplishments WHERE workspace_id=? ORDER BY updated DESC").bind(scope).all()).results;
 const scopedTaskSet=scopedPlaneIds?new Set<string>(projection.map((t:any)=>t.id)):null;
 const accomplishments=(scopedTaskSet?rawAccomplishments.filter((r:any)=>scopedTaskSet.has(r.task_id)):rawAccomplishments).map((r:any)=>({...r,data:JSON.parse(r.data)}));
 const counts={tasks:projection.length,open:0,overdue:0,soon:0};
 const statuses=new Map(),today=programToday(),readiness=new Map([...planes.entries()].map(([id,data])=>[id,aircraftPlanningBlock(data)]));
 for(const t of projection){const state=due(t,planes.get(t.aircraftId),today,readiness.get(t.aircraftId)).status;statuses.set(t.id,state);if(!['closed','withdrawn'].includes(t.status))counts.open++;if(state==='overdue')counts.overdue++;if(state==='soon')counts.soon++;}
 const q=String(url.searchParams.get('q')||'').slice(0,200).toLowerCase(),filter=url.searchParams.get('status')||'all',selected=projection.filter((t:any)=>(!q||[t.name,t.reference,planes.get(t.aircraftId)?.name].join(' ').toLowerCase().includes(q))&&(filter==='all'||statuses.get(t.id)===filter));
 const limit=50,page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1)),taskIds=selected.slice((page-1)*limit,page*limit).map((t:any)=>t.id),tasks=taskIds.length?(await db.prepare('SELECT * FROM records WHERE owner=? AND id IN ('+taskIds.map(()=>'?').join(',')+') ORDER BY id').bind(scope,...taskIds).all()).results.map((r:any)=>({...r,data:JSON.parse(r.data)})):[];
 return {records:[...base,...tasks],assignments,accomplishments,paging:{page,limit,total:selected.length,counts},aircraftLocks:{counters:[...new Set([...locks,...scheduled])],baseline:scheduled}};
}

export async function selectorRecords(db:any,scope:string,aircraftScope:AircraftScopePolicy=DEFAULT_AIRCRAFT_SCOPE){
 const all=(await db.prepare("SELECT id,kind,json_object('name',json_extract(data,'$.name'),'aircraftId',json_extract(data,'$.aircraftId'),'reference',json_extract(data,'$.reference'),'status',json_extract(data,'$.status'),'reviewState',json_extract(data,'$.reviewState')) data FROM records WHERE owner=? AND kind='task' ORDER BY id").bind(scope).all()).results.map((r:any)=>({...r,data:JSON.parse(r.data)}));
 if(!aircraftScope||aircraftScope.mode!=='restricted')return all;
 const planes=(await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='aircraft'").bind(scope).all()).results.map((r:any)=>{const d=JSON.parse(r.data);return {id:r.id,model:d.model,type:d.type,name:d.name};});
 const scopedPlaneIds=extractScopedAircraftIds(aircraftScope,planes);
 return all.filter((r:any)=>scopedPlaneIds.has(r.data.aircraftId));
}
