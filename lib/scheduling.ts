import {addCalendar,calculateLimits,counter} from './recurrence';
import {validDate,programToday,type Limit} from './program';
import {taskLimits} from './task-validation';
export const scheduleEngine='schedule-v2';
export const basisLabels:Record<string,string>={accomplishment:'التنفيذ الفعلي',previous_due:'الاستحقاق الأصلي السابق',fixed_origin:'جدول ثابت من أول استحقاق'};
export type Basis='accomplishment'|'previous_due'|'fixed_origin';
export type SchedulePolicy={version:1,classification:'standard'|'AD'|'ALI'|'CMR'|'LLP'|'mandatory',basis:{hours:Basis,cycles:Basis,calendar:Basis},reference:string,evidenceVersionIds:string[],variation:{enabled:boolean,hours:number,cycles:number,days:number}};
const axes=['hours','cycles','calendar'] as const;
export function normalizeSchedulePolicy(raw:any):SchedulePolicy|undefined{
 if(raw==null)return undefined;
 if(raw.version!==1||!['standard','AD','ALI','CMR','LLP','mandatory'].includes(raw.classification))throw Error('حدد تصنيف المهمة وإصدار سياسة الاستحقاق');
 const basis:any={};for(const key of axes){if(!Object.keys(basisLabels).includes(raw.basis?.[key]))throw Error('حدد أساس حساب '+key);basis[key]=raw.basis[key]}
 const reference=String(raw.reference||'').trim();if(!reference||reference.length>300)throw Error('يلزم مرجع سياسة الاستحقاق المعتمد');
 const ids=raw.evidenceVersionIds;if(!Array.isArray(ids)||!ids.length||ids.length>12||ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw Error('اختر إصدار دليل منشور لسياسة الاستحقاق');
 if(typeof raw.variation?.enabled!=='boolean')throw Error('حدد إتاحة التسامح صراحة');const variation:any={enabled:raw.variation.enabled};
 for(const key of ['hours','cycles','days']){const value=counter(raw.variation[key], 'الحد الأقصى للتسامح',key!=='hours');if(key==='hours'&&value!==round(value)||key==='days'&&value>3650)throw Error('تحقق من دقة أو مدى حد التسامح');variation[key]=value}
 if(variation.enabled&&(raw.classification!=='standard'||![variation.hours,variation.cycles,variation.days].some(x=>x>0)))throw Error('التسامح العام متاح لمهمة غير إلزامية بحد موجب موثق فقط');
 if(!variation.enabled&&[variation.hours,variation.cycles,variation.days].some(x=>x!==0))throw Error('صفّر حدود التسامح عند تعطيله');
 return {version:1,classification:raw.classification,basis,reference,evidenceVersionIds:[...ids],variation};
}
const round=(v:number)=>Math.round(v*1e6)/1e6;
export function nominalLimits(t:any){return {hours:t.hours??'',cycles:t.cycles??'',date:t.date||''}}
export function initializeSchedule(definition:any,baseline:any,taskId:string){
 const limits=calculateLimits(definition.first,baseline);if(!limits)throw Error('لا توجد حدود أولية');
 const policy=normalizeSchedulePolicy(definition.schedulePolicy);
 const schedule:any={mode:'automatic',engine:scheduleEngine,sequence:1,rootTaskId:taskId,previousTaskId:null,baseline,rules:{first:definition.first,repeat:definition.repeat},policy:policy||null,origin:limits,previousNominal:null,previousVariation:false};
 schedule.calculation=calculationTrace(schedule,limits);return {limits,schedule};
}
export function initializeOpening(definition:any,service:any,current:any,raw:any,taskId:string,sourceId:string){
 const ordinal=counter(raw.ordinal,'رقم المرة الافتتاحية',true);
 if(ordinal<2||ordinal>1000000)throw Error('رقم المرة بعد آخر إنجاز من 2 إلى 1000000');
 const last=raw.lastDone||{};
 if(!validDate(last.date)||last.date>programToday()||last.date<service.date)throw Error('تاريخ آخر إنجاز خارج مرجع الخدمة واليوم');
 const lastDone={date:last.date,hours:counter(last.hours,'FH آخر إنجاز'),cycles:counter(last.cycles,'FC آخر إنجاز',true)};
 if(lastDone.hours<service.hours||lastDone.cycles<service.cycles||lastDone.hours>current.hours||lastDone.cycles>current.cycles)throw Error('عدادات آخر إنجاز خارج مرجع الخدمة والرصيد الحالي');
 const originalOrigin=calculateLimits(definition.first,service);if(!originalOrigin)throw Error('تعريف بلا فحص أول');
 const initialized=initializeSchedule(definition,lastDone,taskId),nextDue=taskLimits(raw.nextDue),previousDue=taskLimits(raw.previousDue||{},false);
 const reference=String(raw.reference||'').trim();if(!reference||reference.length>300)throw Error('مرجع كشف الحالة الافتتاحية مطلوب');
 const schedule={...initialized.schedule,origin:nextDue,opening:{sourceId,ordinal,lastDone,previousDue,serviceBaseline:service,originalOrigin,reference}};
 const expected=openingLimits(schedule);
 if(['hours','cycles','date'].some(k=>(nextDue as any)[k]!==expected[k]))throw Error('Next Due لا يطابق Last Done وأساس البرنامج؛ راجع الاستحقاق السابق أو رقم المرة');
 schedule.calculation=calculationTrace(schedule,nextDue);return {limits:nextDue,schedule};
}
function openingLimits(s:any){
 const o=s.opening,result:any={hours:'',cycles:'',date:''};
 if(!o||!o.sourceId||!Number.isInteger(o.ordinal)||o.ordinal<2||o.ordinal>1000000)throw Error('مرجع حالة افتتاحية غير صالح');
 const original=calculateLimits(s.rules.first,o.serviceBaseline);
 if(JSON.stringify(original)!==JSON.stringify(o.originalOrigin))throw Error('مرساة الحالة الافتتاحية لا تطابق برنامجها');
 for(const key of axes){const step=s.rules.repeat[key];if(step===null)continue;if(!(step>0))throw Error('فاصل تكرار افتتاحي غير صالح');const col=key==='calendar'?'date':key,basis=s.policy?.basis?.[key]||'accomplishment';
  const source=basis==='fixed_origin'?o.originalOrigin:basis==='previous_due'?o.previousDue:o.lastDone;
  if(source[col]===''||source[col]==null)throw Error('مرجع محور الحالة الافتتاحية مفقود: '+key);
  const amount=step*(basis==='fixed_origin'?o.ordinal-1:1);
  result[col]=key==='calendar'?addCalendar(source.date,amount,s.rules.repeat.unit):counter(round(Number(source[col])+amount),'حد الحالة الافتتاحية',key==='cycles');
 }
 if(!result.date&&result.hours===''&&result.cycles==='')throw Error('المهمة غير متكررة؛ لا تستورد مرة بعد آخر إنجاز');
 return result;
}
export function scheduledLimits(s:any){
 if(s.engine&&s.engine!==scheduleEngine)throw Error('إصدار محرك غير مدعوم');
 if(s.engine!==scheduleEngine)return calculateLimits(s.sequence===1?s.rules.first:s.rules.repeat,s.baseline);
 if(!Number.isInteger(s.sequence)||s.sequence<1||s.sequence>1000000)throw Error('تسلسل الاستحقاق غير صالح');
 if(s.sequence===1)return s.opening?openingLimits(s):calculateLimits(s.rules.first,s.baseline);
 const result:any={hours:'',cycles:'',date:''},rules=s.rules.repeat as Limit;
 for(const key of axes){const step=rules[key];if(step==null)continue;if(!(step>0))throw Error('فاصل تكرار غير صالح');const col=key==='calendar'?'date':key;
 const configured=s.policy?.basis?.[key]||'accomplishment';if(!Object.keys(basisLabels).includes(configured))throw Error('أساس الاستحقاق غير معروف');
 const basis=s.previousVariation?.[key]&&configured==='accomplishment'?'previous_due':configured;
 if(key==='calendar'){
  const date=basis==='fixed_origin'?(s.opening?.originalOrigin.date||s.origin.date):basis==='previous_due'?s.previousNominal.date:s.baseline.date;
  result.date=addCalendar(date,step*(basis==='fixed_origin'?s.sequence-1+(s.opening?s.opening.ordinal-1:0):1),rules.unit);
 }else{const base=basis==='fixed_origin'?(s.opening?.originalOrigin[key]??s.origin[key]):basis==='previous_due'?s.previousNominal[key]:s.baseline[key];if(base===''||base==null)throw Error('مرجع الاستحقاق السابق مفقود');result[key]=counter(round(Number(base)+step*(basis==='fixed_origin'?s.sequence-1+(s.opening?s.opening.ordinal-1:0):1)),'الاستحقاق المحسوب',key==='cycles')}
 }
 return result.hours===''&&result.cycles===''&&result.date===''?null:result;
}
export function calculationTrace(s:any,limits:any){return {engine:s.engine||'legacy',sequence:s.sequence,sourceReference:s.policy?.reference||'',axes:Object.fromEntries(axes.map(key=>[key,{basis:s.sequence===1?(s.opening?'opening_status':'service_baseline'):s.previousVariation?.[key]&&(!s.policy?.basis?.[key]||s.policy.basis[key]==='accomplishment')?'previous_due':s.policy?.basis?.[key]||'accomplishment',interval:(s.sequence===1&&!s.opening?s.rules.first:s.rules.repeat)[key],unit:key==='calendar'?(s.sequence===1&&!s.opening?s.rules.first:s.rules.repeat).unit:key==='hours'?'FH':'FC',result:limits?.[key==='calendar'?'date':key]??'',variationReset:!!s.previousVariation?.[key]}]))}}
export function nextOccurrence(task:any,completion:any){
 const s=task.schedule,variation=task.authorizedVariation;
 const next:any={...s,sequence:s.sequence+1,baseline:{date:completion.date,hours:completion.hours,cycles:completion.cycles},previousNominal:nominalLimits(task),previousVariation:variation?{hours:variation.grant.hours>0,cycles:variation.grant.cycles>0,calendar:variation.grant.days>0}:false};
 const limits=scheduledLimits(next);if(!limits)return null;next.calculation=calculationTrace(next,limits);return {limits,schedule:next};
}
export function recalculateOccurrence(task:any,completion:any){const schedule={...task.schedule,baseline:{date:completion.date,hours:completion.hours,cycles:completion.cycles}};const limits=scheduledLimits(schedule);if(!limits)throw Error('قواعد المرة التالية مفقودة');schedule.calculation=calculationTrace(schedule,limits);return {limits,schedule}}
export function variationLimits(task:any,grant:any){const result=nominalLimits(task);for(const key of ['hours','cycles']){if(grant[key]>0){if(result[key as 'hours']==='')throw Error('لا يمكن تمديد حد غير موجود');(result as any)[key]=counter(round(Number((result as any)[key])+grant[key]),'الحد المصرح به',key==='cycles')}}if(grant.days>0){if(!result.date)throw Error('لا يوجد حد تقويمي للتمديد');result.date=addCalendar(result.date,grant.days,'days')}return result}
export function normalizeVariationGrant(raw:any,task:any){const cap=task.schedule?.policy?.variation;if(task.schedule?.engine!==scheduleEngine||task.schedule?.policy?.classification!=='standard'||!cap?.enabled)throw Error('لا يوجد تسامح عام موثق ومتاح لهذه المهمة');const grant:any={};for(const key of ['hours','cycles','days']){grant[key]=counter(raw?.[key],'التسامح المطلوب',key!=='hours');if(grant[key]>cap[key]||key==='hours'&&round(grant[key])!==grant[key])throw Error('التسامح المطلوب يتجاوز الحد الموثق أو الدقة المدعومة')}if(!Object.values(grant).some((v:any)=>v>0))throw Error('أدخل تسامحًا موجبًا واحدًا على الأقل');variationLimits(task,grant);return grant}
export function completionCompliance(task:any,completion:any){
 const nominal=nominalLimits(task),authorization=task.authorizedVariation;
 const validAuthorization=authorization&&(!authorization.approvedAt||completion.date>=(authorization.approvedDate||authorization.approvedAt.slice(0,10)))&&(!authorization.approvedUsage||completion.hours>=authorization.approvedUsage.hours&&completion.cycles>=authorization.approvedUsage.cycles);
 const effective=validAuthorization?authorization.limits:nominal;
 const exceeded=(limits:any)=>['hours','cycles','date'].filter(k=>limits[k]!==''&&limits[k]!=null&&(k==='date'?completion.date>limits[k]:Number(completion[k])>Number(limits[k])));
 const nominalExceeded=exceeded(nominal),authorizedExceeded=exceeded(effective);
 return {status:authorizedExceeded.length?'late':nominalExceeded.length?'within_variation':'on_time',nominalExceeded,authorizedExceeded,nominal,effective,variationId:validAuthorization?authorization.id:null};
}
export function controlledExecution(raw:any,aircraft:any,baseline:any,normalize:any,task:any){const data:any=normalize(raw,aircraft,baseline);if(task.schedule?.engine===scheduleEngine){const compliance=completionCompliance(task,data);data.exceptionReference=String(raw.exceptionReference||'').trim();if(data.exceptionReference.length>500)throw Error('مرجع تجاوز التنفيذ طويل');if(task.schedule.policy&&compliance.status==='late'&&!data.exceptionReference)throw Error('التنفيذ تجاوز حدًا مصرحًا به؛ سجل مرجع معالجة التجاوز الفعلي');data.compliance=compliance}return data}
