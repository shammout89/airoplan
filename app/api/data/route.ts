import {prepareTaskApproval,taskPolicyHeadGuard,taskEventWrites,taskActorGuard} from '../../../lib/task-approval-store';
import {aircraftReferences,resolveAircraftReferences} from '../../../lib/aircraft-references';
import {programDefinition} from '../../../lib/program-store';
import {workspaceData,selectorRecords} from '../../../lib/workspace-data';
import {taskLimits} from '../../../lib/task-validation';
import {normalizeAircraft,aircraftIdentityKey,aircraftAudit,requireAircraftReady} from '../../../lib/aircraft';
import {normalizeField,applyCustom} from '../../../lib/flexibility';
import {recoveryState,acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission,requireAircraftInScope,requireAircraftIdInScope,scopedAircraftSet} from '../../../lib/access';
import {workflowTransition,AccessError} from '../../../lib/permissions';
import {serviceBaseline,counter} from '../../../lib/recurrence';
import {validDate} from '../../../lib/program';
import {applies,programToday} from '../../../lib/program';
import {getDb} from '../../../db';
import {records,audit,programRevisions} from '../../../db/schema';
import {and,eq,desc} from 'drizzle-orm';
export const dynamic='force-dynamic';
export async function GET(req?:Request){try{const a=await access();const recovery=await recoveryState(a.scope);const url=new URL(req?.url||'https://local/api/data'),view=url.searchParams.get('view');if(view==='record'){const row:any=await env.DB!.prepare('SELECT * FROM records WHERE id=? AND owner=?').bind(url.searchParams.get('id'),a.scope).first();if(!row)throw new AccessError('السجل غير موجود',404);const parsed=JSON.parse(row.data);if(row.kind==='aircraft')requireAircraftInScope(a,{id:row.id,...parsed});if(row.kind==='task')await requireAircraftIdInScope(a,parsed.aircraftId);return Response.json({record:{...row,data:parsed}})}if(view==='selectors')return Response.json({records:await selectorRecords(env.DB!,a.scope,a.aircraftScope)});const workspace=view==='workspace'?await workspaceData(env.DB!,a.scope,url,a.aircraftScope):null;let fullRecords=workspace?.records;if(!fullRecords){const allRows=(await a.db.select().from(records).where(eq(records.owner,a.scope))).map(r=>({...r,data:JSON.parse(r.data)}));const allowedPlanes=await scopedAircraftSet(a,allRows.filter(r=>r.kind==='aircraft'));fullRecords=allowedPlanes?allRows.filter(r=>r.kind==='aircraft'?allowedPlanes.has(r.id):r.kind==='task'?allowedPlanes.has(r.data.aircraftId):true):allRows;}return Response.json({...workspace,session:{authProvider:env.AUTH_PROVIDER||'chatgpt',recoveryEpoch:recovery.epoch,writeMode:recovery.mode,email:a.email,userId:a.userId,role:a.role,permissions:a.permissions,aircraftScope:a.aircraftScope,workspace:a.workspace.name,isOwner:a.isOwner},records:fullRecords,audit:a.permissions.includes('audit')?await a.db.select().from(audit).where(eq(audit.owner,a.scope)).orderBy(desc(audit.created)).limit(100):[]});}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{checkOrigin(req);const a=await access();lease=await acquireWrite(a,req);const owner=a.scope;
 const body:any=await req.json();const {kind,data}=body;if(!['aircraft','task','field'].includes(kind)||!data||JSON.stringify(data).length>20000)throw Error('بيانات غير صالحة');
 requirePermission(a,kind==='field'?'configure':kind==='aircraft'?'edit_aircraft':'edit_task');
 const db=a.db;const all=await db.select().from(records).where(eq(records.owner,owner));
 let programGuard:any=null,planeGuard:any=null;let catalogProofs:any[]=[];let aircraftReason='';
 const prior=body.id?all.find(r=>r.id===body.id&&r.kind===kind):null;
 if(body.id&&!prior)throw new AccessError('السجل غير موجود',404);
 if(kind==='aircraft'){const old=prior?JSON.parse(prior.data):null;if(prior)requireAircraftInScope(a,{id:prior.id,...old});if(prior&&data._revision!==old._revision)throw new AccessError('تغيرت بطاقة الطائرة؛ حدّث الصفحة',409);aircraftReason=String(data.profileChangeReason||'').trim();if(aircraftReason.length>500||/[\x00-\x1f]/.test(aircraftReason))throw Error('سبب التعديل غير صالح');const resolved=resolveAircraftReferences(data,old,await aircraftReferences(env.DB!,a.scope),body.action==='activateAircraft');catalogProofs=resolved.proofs;const normalized=normalizeAircraft(resolved.data,old,{activate:body.action==='activateAircraft',userId:a.userId,email:a.email,reason:aircraftReason,catalog:resolved.catalog});requireAircraftInScope(a,{id:body.id||'__new__',model:normalized.model,type:normalized.type});for(const key of Object.keys(data))delete data[key];Object.assign(data,normalized);}
 if(kind==='task'){const old=prior?JSON.parse(prior.data):null;if(old?.aircraftId)await requireAircraftIdInScope(a,old.aircraftId);for(const key of ['closedBy','closedAt','completionId','nextTaskId','planningApprovalOrigin']){if(old?.[key]!==undefined)data[key]=old[key];else delete data[key];}if(data.authorizedVariation)throw new AccessError('التسامح يدار عبر طلب موثق مستقل');if(old?.schedule||data.schedule)throw new AccessError('المهمة الآلية محمية. استخدم سجل التنفيذ والاعتماد لإعادة حسابها');if(data.status==='closed'&&old?.status!=='closed')throw new AccessError('يتم الإغلاق عبر إجراء الإغلاق بعد اعتماد المهمة');if(data.status==='withdrawn'||old?.status==='withdrawn')throw new AccessError('سحب التخطيط يدار بخطة انتقال معتمدة');if(old?.status==='closed')throw new AccessError('المهمة مغلقة ولا تقبل التعديل');if(prior&&data._revision!==old._revision)throw new AccessError('تغيرت المهمة؛ حدّث الصفحة قبل التعديل',409);data.reviewState='draft';data.modifiedBy=a.userId;data.submittedBy=null;data.reviewedBy=null;data.approvedBy=null;}
 if(kind==='task'){
 const previous=prior?JSON.parse(prior.data):null;
 if(data.programRevisionId){
 const p=(await db.select().from(programRevisions).where(and(eq(programRevisions.id,data.programRevisionId),eq(programRevisions.workspaceId,a.scope))))[0];
 const retained=previous?.programRevisionId===data.programRevisionId&&previous?.programTaskCode===data.programTaskCode&&previous?.aircraftId===data.aircraftId;
 if(!p||!(p.state==='approved'||(p.state==='superseded'&&retained)))throw new AccessError('اختر إصدار برنامج معتمدًا وساريًا');
 programGuard={id:p.id,etag:p.etag};
 const program=JSON.parse(p.data);const definition=await programDefinition(env.DB!,a.scope,p,data.programTaskCode);
 if(program.effectiveDate>programToday()||!definition||!applies(program,definition,data.aircraftId))throw Error('المهمة لا تنطبق على الطائرة المختارة أو لم يحن سريان البرنامج');
 data.requiredWorkCard=definition.requiredWorkCard===true;data.programSnapshot={programCode:p.code,revision:p.revision,taskCode:definition.code,sourceReference:program.sourceReference,sourceRevision:program.sourceRevision,first:definition.first,repeat:definition.repeat};data.reference=definition.reference;data.name=definition.title;
 }else{delete data.programSnapshot;delete data.programTaskCode;delete data.programRevisionId;}
 }
 if(kind==='field'){
 if(prior&&data._revision!==JSON.parse(prior.data)._revision)throw new AccessError('تغير تعريف الحقل. حدّث الصفحة',409);
 const normalized=normalizeField(data,prior?JSON.parse(prior.data):null,all.filter(r=>r.kind==='field').map(r=>JSON.parse(r.data)),all.map(r=>({...r,data:JSON.parse(r.data)})));Object.keys(data).forEach(k=>delete data[k]);Object.assign(data,normalized.field);
 } else {
 if(!data.name?.trim())throw Error('الاسم مطلوب');
 if(kind==='aircraft'&&all.some(r=>r.kind==='aircraft'&&r.id!==body.id&&(String(JSON.parse(r.data).name).trim().toUpperCase()===data.name||(data.identityKey&&aircraftIdentityKey(JSON.parse(r.data))===data.identityKey))))throw Error('تسجيل الطائرة أو هوية المصنع والطراز وMSN موجودة');
 if(kind==='aircraft'){
 const old=prior?JSON.parse(prior.data):null;
 const protectedKeys=['usageOpening','usageMinutes','usageCycles','usageAdjustments','usageLastDeparture','lastCorrectionId'];for(const key of protectedKeys){if(old&&old[key]!==undefined)data[key]=old[key];else delete data[key];}
 const installedComponent=prior?await env.DB!.prepare("SELECT id FROM planning_items WHERE workspace_id=? AND kind='component' AND state='approved' AND json_extract(data,'$.installation.aircraftId')=? LIMIT 1").bind(a.scope,prior.id).first():null;
 const managed=!!installedComponent||old?.usageOpening||all.some(r=>r.kind==='task'&&JSON.parse(r.data).aircraftId===prior?.id&&JSON.parse(r.data).schedule);
 if(managed&&(Number(data.hours)!==Number(old.hours)||Number(data.cycles)!==Number(old.cycles)))throw new AccessError('حدّث العدادات عبر سجل الرحلات أو طلب تصحيح معتمد');
 if(data.hours!==null)counter(data.hours,'الساعات الحالية');if(data.cycles!==null)counter(data.cycles,'الدورات الحالية',true);
 if(old&&((old.hours!=null&&(data.hours==null||Number(data.hours)<Number(old.hours)))||(old.cycles!=null&&(data.cycles==null||Number(data.cycles)<Number(old.cycles)))))throw Error('لا يمكن تخفيض العدادات. التصحيح يحتاج إجراءً معتمدًا منفصلًا');
 const serviceKeys=['serviceDate','serviceHours','serviceCycles'];const hasService=serviceKeys.some(k=>data[k]!==''&&data[k]!==null&&data[k]!==undefined);if(hasService&&data.profileStatus==='verified')serviceBaseline(data);
 if(managed&&old&&['counterAsOf','counterSource','counterEvidenceVersionId'].some(k=>String(old[k]??'')!==String(data[k]??''))&&old.counterSnapshot)throw new AccessError('مرجع الرصيد الافتتاحي محمي بعد بدء الاستخدام؛ وثّق التصحيح عبر الإجراء المعتمد');
 if(managed&&old?.counterSnapshot)data.counterSnapshot=old.counterSnapshot;
 const used=all.some(r=>r.kind==='task'&&JSON.parse(r.data).aircraftId===prior?.id&&JSON.parse(r.data).schedule);
 if(used&&serviceKeys.some(k=>String(old?.[k]??'')!==String(data[k]??'')))throw new AccessError('مرجع بدء الخدمة مستخدم في حسابات محفوظة ولا يمكن تغييره مباشرة');
 }
 if(kind==='task') {planeGuard=all.find(r=>r.id===data.aircraftId&&r.kind==='aircraft');requireAircraftReady(planeGuard?JSON.parse(planeGuard.data):null);if(!planeGuard)throw Error('اختر طائرة');requireAircraftInScope(a,{id:planeGuard.id,...JSON.parse(planeGuard.data)});Object.assign(data,taskLimits(data));if(!['open','closed'].includes(data.status))throw Error('حالة غير صحيحة');}
 Object.assign(data,applyCustom(all.filter(r=>r.kind==='field').map(r=>JSON.parse(r.data)),kind,data,prior?JSON.parse(prior.data):null,true,kind==='aircraft'&&data.profileStatus!=='verified').data);
 }
 if(kind==='aircraft'&&data.counterEvidenceVersionId){
 const version:any=await env.DB!.prepare('SELECT * FROM document_versions WHERE id=? AND workspace_id=? AND published IS NOT NULL').bind(data.counterEvidenceVersionId,a.scope).first();const doc:any=version?await env.DB!.prepare("SELECT * FROM extension_items WHERE id=? AND workspace_id=? AND kind='document'").bind(version.document_id,a.scope).first():null;const meta=doc?JSON.parse(doc.data):null,old=prior?JSON.parse(prior.data):null,retained=old?.counterEvidenceVersionId===data.counterEvidenceVersionId&&old?.counterEvidenceSnapshot?.digest===version?.digest;if(!body.id||!version||!meta||(!retained&&(meta.activeLinks||[]).every((l:any)=>l.type!=='aircraft'||l.id!==body.id)))throw Error('اختر إصدار مستند منشور مرتبط بهذه الطائرة');data.counterEvidenceSnapshot={versionId:version.id,documentId:version.document_id,digest:version.digest,fileName:version.file_name,revision:version.revision};
 }else if(kind==='aircraft')delete data.counterEvidenceSnapshot;
 const id=body.id||crypto.randomUUID();if(body.id&&!all.some(r=>r.id===id&&r.kind===kind))throw Error('السجل غير موجود');
 let taskPrepared:any=null;
 if(kind==='task'){taskPrepared=await prepareTaskApproval(env.DB!,a,id,data,prior?JSON.parse(prior.data):null);if(taskPrepared.unchanged)return Response.json({ok:true,unchanged:true});Object.keys(data).forEach(k=>delete data[k]);Object.assign(data,taskPrepared.data);}
 const now=new Date().toISOString();data._revision=crypto.randomUUID();const encoded=JSON.stringify(data);const raw=env.DB!;
 const taskGuard=kind==='task'?taskPolicyHeadGuard(a.scope,taskPrepared.policyHead):{sql:'',args:[]},actorGuard=kind==='task'?taskActorGuard(a):{sql:'',args:[]};
 const catalogGuard=catalogProofs.map(()=>" AND EXISTS(SELECT 1 FROM extension_items WHERE id=? AND workspace_id=? AND etag=? AND kind='aircraft_reference')").join('');
 const guard=taskGuard.sql+actorGuard.sql+catalogGuard+(planeGuard?' AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND data=?)':'')+(programGuard?' AND EXISTS (SELECT 1 FROM program_revisions WHERE id=? AND workspace_id=? AND etag=?)':'')+(kind==='aircraft'?" AND NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='aircraft' AND id<>? AND (upper(trim(json_extract(data,'$.name')))=? OR (?<>'' AND json_extract(data,'$.identityKey')=?)))":'');
 const args:any[]=[...taskGuard.args,...actorGuard.args,...catalogProofs.flatMap(p=>[p.id,a.scope,p.etag]),...(planeGuard?[planeGuard.id,a.scope,planeGuard.data]:[]),...(programGuard?[programGuard.id,a.scope,programGuard.etag]:[])];if(kind==='aircraft')args.push(a.scope,id,data.name,data.identityKey,data.identityKey);
 const write=prior?raw.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND data=?'+guard).bind(encoded,now,id,owner,prior.data,...args):raw.prepare('INSERT INTO records (id,owner,kind,data,updated) SELECT ?,?,?,?,? WHERE 1=1'+guard).bind(id,owner,kind,encoded,now,...args);
 const fieldHistory=kind==='field'?[raw.prepare('INSERT INTO settings_versions(id,workspace_id,kind,code,data,previous_id,created_by,created) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND data=?)').bind(crypto.randomUUID(),a.scope,'field',data.key,encoded,prior?JSON.parse(prior.data)._revision||null:null,a.email,now,id,owner,encoded)]:[];
 const taskHistory=kind==='task'?taskEventWrites(raw,a,id,encoded,data,'prepared',taskPrepared.archived?{previousApproval:taskPrepared.archived}:{}):[];
 const result=await raw.batch([write,...fieldHistory,...taskHistory,raw.prepare('INSERT INTO audit (id,owner,action,created) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM records WHERE id=? AND owner=? AND data=?)').bind(crypto.randomUUID(),owner,a.email+' — '+(kind==='aircraft'?aircraftAudit(prior?JSON.parse(prior.data):null,data,aircraftReason):((body.id?'تعديل':'إضافة')+' — '+(data.name||data.label))),now,id,owner,encoded)]);
 if(!result[0].meta.changes)throw new AccessError('تغير السجل أو بيانات الطائرة أثناء الحفظ، أو تكررت هويتها. حدّث الصفحة',409);
 return Response.json({ok:true});
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
