import {integrationControlKinds,normalizeIntegrationControl} from './integration-contracts';
import {reportingKinds,normalizeReporting,reportingEffects} from './reporting-controls';
import {normalizeAccessGrant,accessGrantEffects} from './security-policy';
import {engineeringKinds,normalizeEngineering,engineeringEffects} from './engineering';
import {qualityKinds,normalizeQuality,qualityEffects} from './quality';
import {normalizeSectorPlan,sectorPlanEffects} from './future';
import {normalizeTransition,transitionEffects} from './program-transition';
import {normalizeUnitTask,unitTaskEffects,unitTaskKinds} from './unit-tasks';
import {newDependencies,publishedEvidence,sameContext} from './domain';
import {controlEntities} from './control-types';
export const controlledKinds=controlEntities;
export const controlPermission=(kind:string)=>integrationControlKinds.includes(kind)?'configure':['reliability_action','reliability_review'].includes(kind)?'manage_technical':['access_grant','authorization'].includes(kind)?'manage_members':['calibration','stock_lot','lot_issue'].includes(kind)?'manage_inventory':kind==='work_template'||engineeringKinds.includes(kind)?'manage_technical':kind==='work_card'?'record_execution':kind==='program_transition'?'edit_program':['unit_execution','unit_execution_correction'].includes(kind)?'record_execution':'edit_planning';
export async function normalizeControlled(kind:string,raw:any,old:any,c:any,db:any,bucket:any,scope:string,id:string,strict=false){
 const v=integrationControlKinds.includes(kind)?await normalizeIntegrationControl(kind,raw,old,c):reportingKinds.includes(kind)?await normalizeReporting(kind,raw,old,c,strict):kind==='access_grant'?normalizeAccessGrant(raw,old,c,(await db.prepare('SELECT owner_user_id FROM workspaces WHERE id=?').bind(scope).first())?.owner_user_id):qualityKinds.includes(kind)?normalizeQuality(kind,raw,old,c):engineeringKinds.includes(kind)?normalizeEngineering(kind,raw,old,c):kind==='sector_plan'?normalizeSectorPlan(raw,old,c):kind==='program_transition'?await normalizeTransition(raw,old,c,db,scope,id):await normalizeUnitTask(kind,raw,old,c,db,bucket,scope,id),dep=newDependencies();dep.checks.push(...v.checks);
 const historical='historicalContext' in v&&v.historicalContext===true;
 const evidence=await publishedEvidence(c,raw.evidenceVersionIds||[],dep,bucket,strict&&kind!=='report_snapshot',true),context=historical?old.data.context:dep.checks.map((p:any)=>({table:p.table,id:p.id,column:p.column,proof:p.proof})).sort((a:any,b:any)=>(a.table+a.id+a.column).localeCompare(b.table+b.id+b.column));
 if(historical)sameContext(old.data.evidenceSnapshot,evidence);if(strict)sameContext(old.data.context,context);
 return {...v,data:{...v.data,evidenceVersionIds:evidence.map((e:any)=>e.versionId),evidenceSnapshot:evidence,context},checks:dep.checks};
}
export function controlledEffects(db:any,scope:string,kind:string,data:any,c:any,w:any){return integrationControlKinds.includes(kind)?[]:reportingKinds.includes(kind)?reportingEffects(db,scope,kind,data,c,w):kind==='access_grant'?accessGrantEffects(db,scope,data,c,w):qualityKinds.includes(kind)?qualityEffects(db,scope,kind,data,c,w):engineeringKinds.includes(kind)?engineeringEffects(db,scope,kind,data,c,w):kind==='sector_plan'?sectorPlanEffects(db,scope,data,w):kind==='program_transition'?transitionEffects(db,scope,data,c,w):unitTaskEffects(db,scope,kind,data,c,w)}
