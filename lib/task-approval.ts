// Shared, deterministic policy rules. Database state and actor identity are supplied by the server.
import {AccessError, allowed, requirePermission} from './permissions';

export const taskApprovalVersion = 1;
export const approvalModes = {three_person:'مُعدّ ← مراجع فني ← معتمد مستقل',two_person:'مُعدّ ← معتمد مستقل يراجع ويعتمد'};
export const defaultTaskPolicy = {schemaVersion:1,routineMode:'three_person',technicalMode:'three_person',reviewerRoles:['admin','reviewer'],approverRoles:['admin','approver'],requireDocument:false,procedureReference:'',changeReason:'السياسة الافتراضية: مراجعة واعتماد مستقلان',combinedAcknowledged:false};
const internal = new Set(['_revision','reviewState','modifiedBy','submittedBy','reviewedBy','approvedBy','closedBy','closedAt','completionId','nextTaskId','taskApproval','planningApprovalOrigin']);
// The task name can describe maintenance work, so only the dedicated administrative note is nontechnical.
const routine = new Set(['administrativeNote']);
export function stable(value:any):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>stable(v??null)).join(',')+']';
 return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
export function taskBusiness(data:any,technical=false){return Object.fromEntries(Object.entries(data||{}).filter(([key])=>!internal.has(key)&&(!technical||!routine.has(key))))}
export async function taskHash(data:any,technical=false){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(taskBusiness(data,technical))));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
export function normalizeTaskPolicy(raw:any,legacy=false){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('سياسة الاعتماد غير صالحة');
 const d={...defaultTaskPolicy,...raw};
 if(legacy){d.routineMode='three_person';d.technicalMode='three_person';d.schemaVersion=1;d.combinedAcknowledged=false;}
 if(d.schemaVersion!==1||!Object.hasOwn(approvalModes,d.routineMode)||!Object.hasOwn(approvalModes,d.technicalMode))throw Error('إصدار السياسة أو مسارها غير صالح');
 for(const [key,roles] of [['reviewerRoles',['admin','reviewer']],['approverRoles',['admin','approver']]] as const){if(!Array.isArray(d[key])||!d[key].length||new Set(d[key]).size!==d[key].length||d[key].some((r:any)=>!roles.includes(r as never)))throw Error('حدد أدوارًا مؤهلة للمراجعة والاعتماد');}
 if(typeof d.requireDocument!=='boolean'||typeof d.combinedAcknowledged!=='boolean')throw Error('خيارات السياسة غير صالحة');
 if(d.routineMode==='three_person'&&d.technicalMode==='two_person')throw Error('لا يجوز جعل المسار الفني أقل تدقيقًا من المسار الإداري');
 const text=(v:any,min:number,max:number)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max&&!/[\x00-\x1f]/.test(v);
 if(!text(d.changeReason,10,1000)||!text(d.procedureReference,legacy?0:3,200))throw Error('أدخل مرجع الإجراء وسبب التغيير (10 أحرف على الأقل)');
 if([d.routineMode,d.technicalMode].includes('two_person')&&(!d.combinedAcknowledged||!text(d.procedureReference,3,200)))throw Error('يلزم تأكيد مسؤولية المعتمد عن المراجعة الفنية ومرجع إجراء موثّق');
 return {schemaVersion:1,routineMode:d.routineMode,technicalMode:d.technicalMode,reviewerRoles:[...d.reviewerRoles],approverRoles:[...d.approverRoles],requireDocument:d.requireDocument,procedureReference:d.procedureReference.trim(),changeReason:d.changeReason.trim(),combinedAcknowledged:d.combinedAcknowledged};
}
export function taskMode(data:any){return data?.taskApproval?.mode||'three_person'}
export function taskReviewLabel(data:any){const state=data?.reviewState||'draft';return ({draft:'مسودة',submitted:taskMode(data)==='two_person'?'بانتظار المراجعة والاعتماد':'بانتظار المراجعة الفنية',reviewed:'بانتظار الاعتماد المستقل',approved:'معتمد للتخطيط'} as any)[state]||state}
export function taskReviewDecision(body:any){
 const checks=body.reviewConfirmations;
 if(!checks||['identityAndApplicability','limitsAndSource','evidenceAndChanges'].some(k=>checks[k]!==true))throw Error('أكد مراجعة الهوية والانطباق، والحدود ومصادرها، والأدلة والتغييرات');
 const note=typeof body.reviewNote==='string'?body.reviewNote.trim():'';
 if(note.length<10||note.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note))throw Error('أدخل نتيجة مراجعة فنية واضحة من 10 إلى 2000 حرف');
 return {confirmations:{identityAndApplicability:true,limitsAndSource:true,evidenceAndChanges:true},note};
}
export function transitionTask(data:any,body:any,a:any){
 const w=data.taskApproval,action=body.action,state=data.reviewState||'draft';
 if(!w)throw new AccessError('تعذر تثبيت مسار هذه المهمة',409);
 const policy=w.policy,contributors=new Set([...w.contributors,data.modifiedBy,data.submittedBy].filter(Boolean));
 if(action==='return'){
  const eligible=allowed(a,'edit_task')||(allowed(a,'review')&&policy.reviewerRoles.includes(a.role))||(allowed(a,'approve')&&policy.approverRoles.includes(a.role));
  if(!eligible)throw new AccessError('ليس لديك صلاحية إعادة هذا الطلب');
  if(!['submitted','reviewed'].includes(state))throw new AccessError('الإعادة متاحة للطلبات قيد المراجعة فقط',409);
  if(typeof body.reason!=='string'||body.reason.trim().length<10||body.reason.trim().length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.reason))throw Error('أدخل سبب الإعادة (10 إلى 1000 حرف)');
  return {...data,reviewState:'draft',submittedBy:null,reviewedBy:null,approvedBy:null,taskApproval:{...w,requestId:crypto.randomUUID(),decision:null,evidence:[],returnedFrom:w.requestId,returnReason:body.reason.trim()}};
 }
 requirePermission(a,action);
 if(action==='submit'&&state==='draft')return {...data,reviewState:'submitted',submittedBy:a.userId,reviewedBy:null,approvedBy:null,taskApproval:{...w,contributors:[...new Set([...w.contributors,a.userId])],submittedAt:new Date().toISOString()}};
 if(!['review','approve'].includes(action))throw new AccessError('الانتقال غير متاح في حالة المهمة الحالية',409);
 const roles=action==='review'?policy.reviewerRoles:policy.approverRoles;
 if(!roles.includes(a.role))throw new AccessError('دورك غير مؤهل حسب السياسة المثبتة لهذا الطلب');
 if(contributors.has(a.userId))throw new AccessError('يلزم قرار مستقل عن جميع معدّي المهمة ومرسلها');
 if(action==='review'&&state==='submitted'&&w.mode==='three_person')return {...data,reviewState:'reviewed',reviewedBy:a.userId};
 if(action==='approve'&&((w.mode==='two_person'&&state==='submitted')||(w.mode==='three_person'&&state==='reviewed'))){
  if(w.mode==='three_person'&&data.reviewedBy===a.userId)throw new AccessError('يلزم معتمد مستقل عن المراجع الفني');
  const decision=w.mode==='two_person'?taskReviewDecision(body):null;
  return {...data,reviewState:'approved',approvedBy:a.userId,reviewedBy:w.mode==='two_person'?a.userId:data.reviewedBy,taskApproval:{...w,decision:decision?{...decision,combined:true,actorId:a.userId,actorRole:a.role,at:new Date().toISOString()}:null}};
 }
 throw new AccessError('الانتقال غير متاح في مسار المهمة وحالتها الحالية',409);
}
export function validateTaskApproval(data:any){
 const w=data?.taskApproval;if(w===undefined)return; // Historic and system-generated tasks retain their original approval provenance.
 if(!w||w.version!==1||typeof w.requestId!=='string'||!w.requestId||!['routine','technical'].includes(w.risk)||!Object.hasOwn(approvalModes,w.mode)||!Array.isArray(w.contributors)||!w.contributors.length||w.contributors.some((x:any)=>typeof x!=='string'||!x)||new Set(w.contributors).size!==w.contributors.length||![w.contentHash,w.technicalHash].every(h=>/^[a-f0-9]{64}$/.test(h))||typeof w.settingId!=='string')throw Error('أثر سياسة اعتماد المهمة غير صالح');
 const policy=normalizeTaskPolicy(w.policy,w.settingId==='default'||w.legacy===true);if(stable(policy)!==stable(w.policy)||w.mode!==(w.risk==='technical'?policy.technicalMode:policy.routineMode))throw Error('مسار المهمة لا يطابق سياستها المثبتة');
 if(data.reviewState==='reviewed'&&w.mode==='two_person')throw Error('حالة مراجعة منفصلة لا تطابق مسار الشخصين');
 if(!['draft','submitted','reviewed','approved'].includes(data.reviewState))throw Error('حالة طلب اعتماد التخطيط غير صالحة');
 if(['submitted','reviewed','approved'].includes(data.reviewState)&&(!data.submittedBy||!w.contributors.includes(data.submittedBy)))throw Error('هوية مرسل الطلب مفقودة');
 if(['reviewed','approved'].includes(data.reviewState)&&(!data.reviewedBy||w.contributors.includes(data.reviewedBy)))throw Error('المراجعة لا تحقق الاستقلال');
 if(data.reviewState==='approved'){
  if(!data.approvedBy||w.contributors.includes(data.approvedBy)||(w.mode==='three_person'&&data.reviewedBy===data.approvedBy))throw Error('الاعتماد لا يحقق الاستقلال');
  if(w.mode==='two_person'){taskReviewDecision({reviewConfirmations:w.decision?.confirmations,reviewNote:w.decision?.note});if(w.decision?.combined!==true||w.decision.actorId!==data.approvedBy||!policy.approverRoles.includes(w.decision.actorRole)||!allowed(w.decision.actorRole,'approve')||data.reviewedBy!==data.approvedBy)throw Error('نتيجة المراجعة والاعتماد المدمجين غير مكتملة');}
 }
}
