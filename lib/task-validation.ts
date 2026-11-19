import {validDate} from './program';
import {counter} from './recurrence';

export type TaskLimits = {date:string; hours:number|''; cycles:number|''};
const empty=(v:unknown)=>v===undefined||v===null||v==='';

/** Shared by interactive entry, imports, approvals, forecasts and restore. */
export function taskLimits(raw:Record<string,unknown>,required=true):TaskLimits {
  if(!raw||typeof raw!=='object')throw Error('بيانات حدود المهمة غير صالحة');
  const date=empty(raw.date)?'':raw.date;
  if(typeof date!=='string'||date&&!validDate(date))throw Error('تاريخ الاستحقاق يجب أن يكون يومًا صحيحًا بصيغة YYYY-MM-DD');
  const hours=empty(raw.hours)?'':counter(raw.hours,'حد الاستحقاق FH');
  const cycles=empty(raw.cycles)?'':counter(raw.cycles,'حد الاستحقاق FC',true);
  if(hours!==''&&Math.round(hours*1e6)/1e6!==hours)throw Error('دقة ساعات الاستحقاق لا تتجاوز ست منازل عشرية');
  if(required&&!date&&hours===''&&cycles==='')throw Error('حدد حد استحقاق واحدًا على الأقل');
  return {date,hours,cycles};
}

export function taskLimitIssue(raw:Record<string,unknown>):string|null {
  try{taskLimits(raw);return null}catch(e){return e instanceof Error?e.message:'حدود المهمة غير صالحة'}
}
