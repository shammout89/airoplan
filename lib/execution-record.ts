import {controlledExecution,completionCompliance} from './scheduling';
import {normalizeAccomplishment} from './recurrence';
import {publishedEvidence,newDependencies} from './domain';
import {AccessError} from './permissions';

export async function executionRecord(db:any,bucket:any,scope:string,raw:any,aircraft:any,task:any,strict=false) {
  const baseline=task.schedule?.baseline||{date:aircraft.serviceDate||aircraft.manufactureDate||'1900-01-01',hours:0,cycles:0};
  let workCardProof:any=null;const cardId=task.workCardId||raw.workCardId;if(task.requiredWorkCard&&!cardId)throw Error('مصدر المهمة يشترط بطاقة عمل معتمدة قبل توثيق التنفيذ');if(cardId){const card=await db.prepare("SELECT * FROM extension_items WHERE workspace_id=? AND id=? AND kind='work_card' AND state='approved'").bind(scope,cardId).first();const d=card?JSON.parse(card.data):null;if(!card||d.taskId!==(task.taskId||task.id||task._taskId)||d.taskType!==(task.componentId?'unit_task':'task'))throw Error('بطاقة العمل غير معتمدة أو لا تخص المرة');if(raw.date<new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d.endAt)))throw Error('تاريخ الإنجاز يسبق انتهاء بطاقة العمل');workCardProof={id:card.id,etag:card.etag,reference:d.reference};if(strict&&JSON.stringify(raw.workCardProof||null)!==JSON.stringify(workCardProof))throw new AccessError('تغيرت بطاقة العمل المعتمدة؛ أعد حفظ التنفيذ ومراجعته',409);}
  const normalized=controlledExecution(raw,aircraft,baseline,normalizeAccomplishment,task);
  const method=raw.method||'internal';
  if(!['internal','external'].includes(method))throw Error('حدد تنفيذًا داخليًا أو شهادة خارجية');
  const organisation=String(raw.organisation||'').trim();
  if(organisation.length>200||method==='external'&&!organisation)throw Error('حدد مؤسسة الصيانة المصدرة للشهادة الخارجية');
  const dep=newDependencies();
  const c={versions:(await db.prepare('SELECT * FROM document_versions WHERE workspace_id=?').bind(scope).all()).results};
  const evidence=await publishedEvidence(c,raw.evidenceVersionIds||[],dep,bucket,method==='external',true);
  if(strict&&JSON.stringify(raw.evidenceSnapshot||[])!==JSON.stringify(evidence))throw new AccessError('تغير دليل التنفيذ؛ أعد السجل للمسودة واحفظه وراجعه',409);
  const compliance=completionCompliance(task,normalized);
  const exceptionReference=String(raw.exceptionReference||'').trim();
  if(exceptionReference.length>500||!task.schedule&&compliance.status==='late'&&!exceptionReference)throw Error('وثق مرجع معالجة التنفيذ المتجاوز لحد الاستحقاق');
  return {...normalized,...(workCardProof?{workCardId:workCardProof.id,workCardProof}:{}),method,organisation,evidenceVersionIds:evidence.map(e=>e.versionId),evidenceSnapshot:evidence,
    ...(!task.schedule?{compliance,exceptionReference}:{} )};
}
