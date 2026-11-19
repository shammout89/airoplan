import {programToday,validDate} from './program';

export function aircraftDateInputError(value:string,withTime=false,allowFuture=false){
 if(!value)return '';
 if(!/^\d{4}-/.test(value))return 'السنة يجب أن تتكوّن من أربعة أرقام.';
 const shape=withTime?/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/:/^\d{4}-\d{2}-\d{2}$/;
 if(!shape.test(value))return withTime?'أكمل التاريخ والوقت الصحيحين.':'أكمل اليوم والشهر والسنة بأربعة أرقام.';
 if(!validDate(value.slice(0,10)))return 'تاريخ غير صحيح؛ تحقق من عدد أيام الشهر والسنة الكبيسة.';
 if(!withTime)return !allowFuture&&value>programToday()?'التاريخ لا يمكن أن يكون في المستقبل.':'';
 const date=new Date(value+'Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,16)!==value)return 'أدخل وقتًا صحيحًا من 00:00 إلى 23:59 بتوقيت UTC.';
 return !allowFuture&&date.getTime()>Date.now()?'مرجع العدادات لا يمكن أن يكون في المستقبل.':'';
}

export function aircraftDateInputValue(value:string,withTime=false){return withTime?value.slice(0,16):value}
