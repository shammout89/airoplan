import {AccessError} from './permissions';
import {currentSetting} from './settings';
import {defaultTaskPolicy,normalizeTaskPolicy,stable,taskBusiness,taskHash,validateTaskApproval} from './task-approval';

export async function currentTaskPolicy(db:any,scope:string){const row=await currentSetting(db,scope,'approval','task');return {id:row?.id||'default',data:normalizeTaskPolicy(row?.data||defaultTaskPolicy,!row?.data?.schemaVersion),created:row?.created||null,createdBy:row?.created_by||null}}
async function legacyPolicy(db:any,scope:string,id:string){const binding=await db.prepare("SELECT data FROM approval_bindings WHERE workspace_id=? AND entity='task' AND target_id=? ORDER BY COALESCE(json_extract(data,'$.taskEvent.sequence'),0) DESC,created DESC,id DESC LIMIT 1").bind(scope,id).first();const old=binding?JSON.parse(binding.data):defaultTaskPolicy;return {id:old.settingId||'default',data:normalizeTaskPolicy(old,true)}}
async function newWorkflow(data:any,policy:any,actor:string,risk='technical',legacy=false){return {version:1,requestId:crypto.randomUUID(),settingId:policy.id,policy:policy.data,mode:risk==='technical'?policy.data.technicalMode:policy.data.routineMode,risk,legacy,createdAt:new Date().toISOString(),contributors:[actor],contentHash:await taskHash(data),technicalHash:await taskHash(data,true),baselineTechnicalHash:null,decision:null,evidence:[] as any[]}}

// Freeze at preparation, not when a later policy happens to be published. A routine
// edit can escalate inside this same policy but can never downgrade a technical request.
export async function prepareTaskApproval(db:any,a:any,id:string,data:any,old:any,selectedPolicy?:any){
 delete data.taskApproval;
 if(data.administrativeNote!==undefined){if(typeof data.administrativeNote!=='string'||data.administrativeNote.length>2000)throw Error('الملاحظة الإدارية لا تتجاوز 2000 حرف');data.administrativeNote=data.administrativeNote.trim();}
 if(old&&stable(taskBusiness(data))===stable(taskBusiness(old)))return {data:old,unchanged:true,policyHead:null,archived:null};
 const contentHash=await taskHash(data),technicalHash=await taskHash(data,true);
 let w:any,policyHead:string|null=null;
 if(old?.taskApproval&&old.reviewState!=='approved'){
  validateTaskApproval(old);w={...old.taskApproval,requestId:crypto.randomUUID(),decision:null,evidence:[],contributors:[...new Set([...old.taskApproval.contributors,a.userId])]};
  if(w.risk==='technical'||technicalHash!==(w.baselineTechnicalHash||w.technicalHash))w.risk='technical';
  w.mode=w.risk==='technical'?w.policy.technicalMode:w.policy.routineMode;
 }else{
  const legacy=!!old&&old.reviewState!=='approved',policy=legacy?await legacyPolicy(db,a.scope,id):selectedPolicy||await currentTaskPolicy(db,a.scope);
  const baseline=old?.reviewState==='approved'?await taskHash(old,true):null;
  w=await newWorkflow(data,policy,a.userId,baseline===technicalHash?'routine':'technical',legacy);
  w.baselineTechnicalHash=baseline;if(!legacy)policyHead=policy.id;
  if(legacy)w.contributors=[...new Set([old.modifiedBy,a.userId].filter(Boolean))];
 }
 w.contentHash=contentHash;w.technicalHash=technicalHash;
 return {data:{...data,reviewState:'draft',modifiedBy:a.userId,submittedBy:null,reviewedBy:null,approvedBy:null,taskApproval:w},unchanged:false,policyHead,archived:old?.reviewState==='approved'?old:null};
}
export function taskPolicyHeadGuard(scope:string,head:string|null){return head===null?{sql:'',args:[]}: {sql:" AND COALESCE((SELECT id FROM settings_versions WHERE workspace_id=? AND kind='approval' AND code='task' ORDER BY rowid DESC LIMIT 1),'default')=?",args:[scope,head]}}
export async function workflowTaskSnapshot(db:any,a:any,id:string,data:any){
 if(data.taskApproval){validateTaskApproval(data);if(data.taskApproval.contentHash!==await taskHash(data))throw new AccessError('تغير محتوى المهمة خارج الطلب المثبت؛ أعدها للمسودة وراجع التغيير',409);return data;}
 // Legacy requests always retain the independent three-person path. No data rewrite on read/upgrade.
 const policy=await legacyPolicy(db,a.scope,id),w=await newWorkflow(data,policy,data.modifiedBy||data.submittedBy||a.userId,'technical',true);
 w.contributors=[...new Set([data.modifiedBy,data.submittedBy].filter(Boolean))];if(!w.contributors.length)w.contributors=[a.userId];
 w.evidence=await taskEvidence(db,a.scope,id);
 return {...data,taskApproval:w};
}
export async function taskEvidence(db:any,scope:string,id:string){
 const rows=await db.prepare("SELECT id,etag,data FROM extension_items WHERE workspace_id=? AND kind='document' AND json_extract(data,'$.activeVersionId') IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.activeLinks')) WHERE json_extract(value,'$.id')=? AND json_extract(value,'$.type')='task') ORDER BY id").bind(scope,id).all();
 const result=[];for(const row of rows.results){const meta=JSON.parse(row.data),version=await db.prepare('SELECT id,digest,file_name,revision FROM document_versions WHERE id=? AND workspace_id=? AND published IS NOT NULL').bind(meta.activeVersionId,scope).first();if(version)result.push({id:row.id,etag:row.etag,versionId:version.id,digest:version.digest,fileName:version.file_name,revision:version.revision});}return result;
}
export async function checkTaskEvidence(db:any,a:any,id:string,data:any,action:string){
 if(action==='return')return data;
 const evidence=await taskEvidence(db,a.scope,id);
 if(data.taskApproval.policy.requireDocument&&!evidence.length)throw Error('يلزم مستند منشور مرتبط بالمهمة قبل الإرسال والاعتماد');
 if(action==='submit')return {...data,taskApproval:{...data.taskApproval,evidence}};
 if(stable(evidence)!==stable(data.taskApproval.evidence))throw new AccessError('تغير الدليل المنشور منذ الإرسال؛ أعد الطلب للمسودة لمراجعته مجددًا',409);
 return data;
}
export function evidenceGuard(scope:string,id:string,data:any){
 if(!data.taskApproval)return {sql:'',args:[]};
 const proofs=data.taskApproval.evidence||[];
 const countSql=" AND (SELECT COUNT(*) FROM extension_items d JOIN document_versions v ON v.id=json_extract(d.data,'$.activeVersionId') AND v.workspace_id=d.workspace_id WHERE d.workspace_id=? AND d.kind='document' AND v.published IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(json_extract(d.data,'$.activeLinks')) WHERE json_extract(value,'$.id')=? AND json_extract(value,'$.type')='task'))=?";
 return {sql:proofs.map(()=>" AND EXISTS(SELECT 1 FROM extension_items WHERE id=? AND workspace_id=? AND etag=?) AND EXISTS(SELECT 1 FROM document_versions WHERE id=? AND workspace_id=? AND digest=? AND published IS NOT NULL)").join('')+countSql,args:[...proofs.flatMap((p:any)=>[p.id,scope,p.etag,p.versionId,scope,p.digest]),scope,id,proofs.length]};
}
export function taskEventWrites(db:any,a:any,id:string,proof:string,data:any,event:string,extra:any={}){
 const w=data.taskApproval;
 const policy=w?{...w.policy,settingId:w.settingId}:{...defaultTaskPolicy,settingId:'default'};
 const now=new Date().toISOString(),payload={...policy,taskEvent:{version:1,requestId:w?.requestId||'legacy:'+data._revision,event,actorId:a.userId,actorRole:a.role,at:now,mode:w?.mode||'three_person',risk:w?.risk||'technical',contentHash:w?.contentHash||null,snapshot:data,...extra}};
 // rowid changes during semantic restore. Persist the causal order inside each immutable event.
 return [db.prepare("INSERT OR IGNORE INTO approval_bindings(id,workspace_id,entity,target_id,source_etag,data,created) SELECT ?,?,'task',?,?,json_set(?,'$.taskEvent.sequence',(SELECT COALESCE(MAX(CAST(json_extract(data,'$.taskEvent.sequence') AS INTEGER)),0)+1 FROM approval_bindings WHERE workspace_id=? AND entity='task' AND target_id=?)),? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND data=?)").bind(crypto.randomUUID(),a.scope,id,proof,JSON.stringify(payload),a.scope,id,now,id,a.scope,proof)];
}

// access() supplies these proofs from the same role/grant used to authorize this request.
export function taskActorGuard(a:any){
 let sql=" AND EXISTS(SELECT 1 FROM members WHERE id=? AND workspace_id=? AND user_id=? AND state='active' AND role=? AND updated=?)";const args:any[]=[a.memberId,a.scope,a.userId,a.role,a.memberUpdated];
 if(!a.isOwner){sql+=" AND COALESCE((SELECT id||':'||etag FROM extension_items WHERE workspace_id=? AND kind='access_grant' AND state='approved' AND json_extract(data,'$.userId')=? ORDER BY updated DESC LIMIT 1),'')=?";args.push(a.scope,a.userId,a.grantProof||'');}
 return {sql,args};
}
