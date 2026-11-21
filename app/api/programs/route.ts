import {programData,storedProgram,definitionWrites} from '../../../lib/program-store';
import {pinScheduleEvidence} from '../../../lib/schedule-evidence';
import {requireAircraftReady} from '../../../lib/aircraft';
import {routePolicy,policyWrites} from '../../../lib/approval-policy';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission,requireAircraftIdInScope} from '../../../lib/access';
import {AccessError,workflowTransition} from '../../../lib/permissions';
import {normalizeProgram,programToday} from '../../../lib/program';
export const dynamic='force-dynamic';
export async function GET(req?:Request){try{const a=await access(),u=new URL(req?.url||'https://local/api/programs'),id=u.searchParams.get('id'),summary=u.searchParams.get('summary')==='1';const result=await env.DB!.prepare('SELECT * FROM program_revisions WHERE workspace_id=?'+(id?' AND id=?':'')+' ORDER BY updated DESC,id').bind(a.scope,...(id?[id]:[])).all();return Response.json({revisions:await Promise.all(result.results.map(async(r:any)=>({...r,data:summary?JSON.parse(r.data):await programData(env.DB!,a.scope,r)})))})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{checkOrigin(req);const a=await access();lease=await acquireWrite(a,req);const body:any=await req.json();const pendingPolicy=await routePolicy(env.DB!,a,'program',body);if(!body||JSON.stringify(body).length>6*1024*1024)throw Error('حجم بيانات البرنامج أكبر من المسموح');
 const db=env.DB!;const now=new Date().toISOString(),etag=crypto.randomUUID();
 const aircraft=await db.prepare("SELECT id,data FROM records WHERE owner=? AND kind='aircraft' ORDER BY id").bind(a.scope).all();
 const row:any=body.id?await db.prepare('SELECT * FROM program_revisions WHERE id=? AND workspace_id=?').bind(body.id,a.scope).first():null;if(body.id&&!row)throw new AccessError('الإصدار غير موجود',404);
 if(['save','revise'].includes(body.action)){
 requirePermission(a,'edit_program');
 if(body.action==='save'&&row&&row.state!=='draft')throw new AccessError('هذا الإصدار مقفل. أنشئ إصدارًا جديدًا أو أعده إلى المسودة');
 if(body.action==='revise'&&(!row||!['approved','superseded'].includes(row.state)))throw new AccessError('إنشاء إصدار جديد متاح من إصدار معتمد أو سابق');
 const raw=body.action==='revise'?{...await programData(db,a.scope,row),revision:body.newRevision,approvalReference:''}:body.data;
 const data=await pinScheduleEvidence(db,env.BUCKET!,a.scope,normalizeProgram(raw,aircraft.results.map((x:any)=>x.id)));
 for(const aid of data.aircraftIds)await requireAircraftIdInScope(a,aid);
 if(row&&body.action==='save'&&(data.code!==row.code||data.revision!==row.revision))throw Error('رمز البرنامج ورقم الإصدار ثابتان بعد الإنشاء');
 const existing=await db.prepare('SELECT id FROM program_revisions WHERE workspace_id=? AND code=? AND revision=?').bind(a.scope,data.code,data.revision).first();
 if(existing&&(!row||body.action==='revise'||(existing as any).id!==row.id))throw Error('رقم هذا الإصدار موجود بالفعل للبرنامج');
 const updating=row&&body.action==='save';if(updating&&body.etag!==row.etag)throw new AccessError('تغير الإصدار. حدّث الصفحة قبل الحفظ',409);
 const id=updating?row.id:crypto.randomUUID();const encoded=JSON.stringify(storedProgram(data));
 const write=updating?db.prepare("UPDATE program_revisions SET data=?,modified_by=?,etag=?,updated=? WHERE id=? AND workspace_id=? AND etag=? AND state='draft'").bind(encoded,a.userId,etag,now,id,a.scope,body.etag):db.prepare("INSERT INTO program_revisions (id,workspace_id,code,revision,state,data,etag,modified_by,created,updated) VALUES (?,?,?,?,'draft',?,?,?,?,?)").bind(id,a.scope,data.code,data.revision,encoded,etag,a.userId,now,now);
 const result=await db.batch([write,...definitionWrites(db,a,id,data,etag,now),db.prepare('INSERT INTO audit (id,owner,action,created) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM program_revisions WHERE id=? AND workspace_id=? AND etag=?)').bind(crypto.randomUUID(),a.scope,`${a.email} — ${updating?'تعديل':'إنشاء'} برنامج: ${data.code} / ${data.revision}`,now,id,a.scope,etag)]);
 if(!result[0].meta.changes)throw new AccessError('تغير الإصدار أثناء الحفظ',409);return Response.json({ok:true,id});
 }
 if(!row)throw new AccessError('الإصدار غير موجود',404);if(body.etag!==row.etag)throw new AccessError('تغير الإصدار. حدّث الصفحة وأعد العملية',409);
 let state:string,submitted=row.submitted_by,reviewed=row.reviewed_by,approved=row.approved_by;
 if(body.action==='return'){
 requirePermission(a,'edit_program');const data=await programData(db,a.scope,row);for(const aid of data.aircraftIds||[])await requireAircraftIdInScope(a,aid);if(!['submitted','reviewed'].includes(row.state))throw new AccessError('لا يمكن إعادة هذا الإصدار للمسودة',409);state='draft';submitted=null;reviewed=null;approved=null;
 }else{
 if(!['submit','review','approve'].includes(body.action))throw Error('إجراء غير صالح');
 const data=await programData(db,a.scope,row);normalizeProgram(data,aircraft.results.map((x:any)=>x.id));for(const aid of data.aircraftIds)await requireAircraftIdInScope(a,aid);await pinScheduleEvidence(db,env.BUCKET!,a.scope,data,true);
 const next=workflowTransition({reviewState:row.state,submittedBy:row.submitted_by,reviewedBy:row.reviewed_by,modifiedBy:row.modified_by},body.action,a.userId,a.role);state=next.reviewState;submitted=next.submittedBy??submitted;reviewed=next.reviewedBy??reviewed;approved=next.approvedBy??approved;
 if(body.action==='approve')for(const id of data.aircraftIds){const p:any=aircraft.results.find((r:any)=>r.id===id);requireAircraftReady(p?JSON.parse(p.data):null);}
 if(body.action==='approve'&&(!data.approvalReference||data.effectiveDate>programToday()))throw Error('أدخل مرجع الموافقة، ويجب أن يكون تاريخ السريان قد حلّ قبل الاعتماد');
 }
 const planeGuard=body.action==='approve'?" AND (SELECT json_group_array(id || ':' || data) FROM (SELECT id,data FROM records WHERE owner=? AND kind='aircraft' ORDER BY id))=?":'',planeArgs:any[]=body.action==='approve'?[a.scope,JSON.stringify(aircraft.results.map((r:any)=>r.id+':'+r.data))]:[];
 const batch=[db.prepare('UPDATE program_revisions SET state=?,submitted_by=?,reviewed_by=?,approved_by=?,etag=?,updated=? WHERE id=? AND workspace_id=? AND etag=?'+planeGuard).bind(state,submitted,reviewed,approved,etag,now,row.id,a.scope,row.etag,...planeArgs)];
 batch.push(...policyWrites(db,a,pendingPolicy,row.id,etag));
 if(state==='approved')batch.push(db.prepare("UPDATE program_revisions SET state='superseded',etag=?,updated=? WHERE workspace_id=? AND code=? AND id<>? AND state='approved' AND EXISTS (SELECT 1 FROM program_revisions WHERE id=? AND etag=?)").bind(crypto.randomUUID(),now,a.scope,row.code,row.id,row.id,etag));
 batch.push(db.prepare('INSERT INTO audit (id,owner,action,created) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM program_revisions WHERE id=? AND workspace_id=? AND etag=?)').bind(crypto.randomUUID(),a.scope,`${a.email} — ${body.action}: ${row.code} / ${row.revision}`,now,row.id,a.scope,etag));
 const result=await db.batch(batch);if(!result[0].meta.changes)throw new AccessError('تغير الإصدار أثناء العملية',409);return Response.json({ok:true});
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
