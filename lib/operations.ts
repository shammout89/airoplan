import {counter} from './recurrence';
export function roundHours(n:number){return Math.round(n*1e6)/1e6}
export function normalizedFlight(raw:any,now=Date.now()){
 const text=(k:string,max:number)=>{const v=typeof raw?.[k]==='string'?raw[k].trim().toUpperCase():'';if(!v||v.length>max)throw Error('تحقق من حقل الرحلة: '+k);return v};
 const reference=text('reference',120),flightNumber=text('flightNumber',30),from=text('from',4),to=text('to',4);
 if(!/^[A-Z0-9]{3,4}$/.test(from)||!/^[A-Z0-9]{3,4}$/.test(to))throw Error('رمز المطار يجب أن يتكون من 3 أو 4 أحرف/أرقام');
 const departure=String(raw.departure||'');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(departure)||!Number.isFinite(Date.parse(departure))||new Date(departure).toISOString()!==departure||Date.parse(departure)<Date.UTC(1900,0,1))throw Error('أدخل وقت الإقلاع الفعلي بتوقيت UTC وبدقة الدقيقة');
 const durationMinutes=counter(raw.durationMinutes,'مدة الطيران بالدقائق',true),cycles=counter(raw.cycles,'دورات الرحلة',true);if(durationMinutes<1||durationMinutes>2880||cycles<1||cycles>100)throw Error('تحقق من مدة الرحلة ودوراتها');
 if(Date.parse(departure)+durationMinutes*60000>now)throw Error('لا يمكن ترحيل رحلة لم تنتهِ بعد');
 const notes=String(raw.notes||'').trim();if(notes.length>2000)throw Error('الملاحظات طويلة');return {reference,flightNumber,from,to,departure,durationMinutes,cycles,notes};
}
export function ledgerTotals(plane:any,minutesDelta=0,cyclesDelta=0){if(!plane.usageOpening)throw Error('لم يُحدد الرصيد الافتتاحي');const minutes=Number(plane.usageMinutes||0)+minutesDelta,cycles=Number(plane.usageCycles||0)+cyclesDelta;if(!Number.isSafeInteger(minutes)||minutes<0||!Number.isSafeInteger(cycles)||cycles<0)throw Error('رصيد استخدام غير صالح');const hours=counter(roundHours(Number(plane.usageOpening.hours)+minutes/60+Number(plane.usageAdjustments?.hours||0)),'رصيد الساعات'),totalCycles=counter(Number(plane.usageOpening.cycles)+cycles+Number(plane.usageAdjustments?.cycles||0),'رصيد الدورات',true);return {usageMinutes:minutes,usageCycles:cycles,hours,cycles:totalCycles};}
export function effectiveCompletion(original:any,overrides:any[]){const o=overrides.find(v=>v.kind==='completion'&&v.target_id===original.id);return o?{...original.data,...o.data}:original.data}
