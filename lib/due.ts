import {aircraftPlanningBlock} from './aircraft';
import {programToday,validDate} from './program';
import {taskLimits} from './task-validation';
import {counter} from './recurrence';
type LimitRow={label:string,left:number,unit:string};
type DueResult={limits:LimitRow[],reason:string|null,status:string,authorizedLimits:LimitRow[],variationStatus:string|null};

export function due(task:any,aircraft:any,today=programToday(),knownBlock?:string|null):DueResult {
  const unknown=(reason:string):DueResult=>({limits:[],status:task.status==='closed'?'closed':'unknown',reason,authorizedLimits:[],variationStatus:null});
  const blocked=knownBlock===undefined?aircraftPlanningBlock(aircraft):knownBlock;
  if(blocked)return unknown(blocked);
  try {
    const bounds=taskLimits(task);if(task.status==='withdrawn')return {limits:[],reason:'سُحب التخطيط بخطة انتقال معتمدة؛ سجل الصيانة السابق محفوظ',status:'withdrawn',authorizedLimits:[],variationStatus:null};if(task.continuationUntil&&task.continuationUntil<today)throw Error('انتهى تصريح الاستمرار بقواعد الإصدار السابق؛ يلزم انتقال معتمد');
    if(!validDate(today))throw Error('تاريخ تقييم الاستحقاق غير صالح');
    const limits:LimitRow[]=[];
    if(bounds.date)limits.push({label:'التاريخ',left:Math.round((Date.parse(bounds.date)-Date.parse(today))/86400000),unit:'يوم'});
    if(bounds.hours!=='')limits.push({label:'الساعات',left:Math.round((bounds.hours-counter(aircraft?.hours,'FH الحالي'))*1e6)/1e6,unit:'ساعة'});
    if(bounds.cycles!=='')limits.push({label:'الدورات',left:bounds.cycles-counter(aircraft?.cycles,'FC الحالي',true),unit:'دورة'});
    if(limits.some(x=>!Number.isFinite(x.left)))throw Error('تعذر حساب حد الاستحقاق');
    const authorized=task.schedule?.engine==='schedule-v2'&&task.authorizedVariation?
      due({...task,...task.authorizedVariation.limits,authorizedVariation:null},aircraft,today,knownBlock):null;
    if(authorized?.reason)return unknown('حدود التصريح غير صالحة: '+authorized.reason);
    return {limits,reason:null,status:task.status==='closed'?'closed':!aircraft?'unknown':limits.some(x=>x.left<=0)?'overdue':
      limits.some(x=>x.left<=(x.unit==='يوم'?30:x.unit==='ساعة'?100:50))?'soon':'ok',
      authorizedLimits:authorized?.limits||[],variationStatus:authorized?(authorized.limits.some(x=>x.left<=0)?'exceeded':'within'):null};
  }catch(e){return unknown(e instanceof Error?e.message:'بيانات الاستحقاق غير صالحة')}
}
