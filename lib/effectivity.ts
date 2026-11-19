export function normalizeEffectivity(raw:any){
 if(raw==null)return undefined;
 if(typeof raw!=='object'||Array.isArray(raw))throw Error('قواعد انطباق غير صالحة');
 const result:any={};
 for(const key of ['manufacturers','models','partNumbers','serialNumbers','requiredModifications','excludedModifications']){
  const values=raw[key]||[];
  if(!Array.isArray(values)||values.length>200||values.some((v:any)=>typeof v!=='string'||!v.trim()||v.length>150)||new Set(values.map((v:string)=>v.trim().toUpperCase())).size!==values.length)throw Error('قائمة انطباق غير صالحة: '+key);
  result[key]=values.map((v:string)=>v.trim().toUpperCase()).sort();
 }
 if(raw.serialRange){const {minimum,maximum}=raw.serialRange;if(!['string','number'].includes(typeof minimum)||!['string','number'].includes(typeof maximum)||String(minimum).trim()===''||String(maximum).trim()===''||!Number.isSafeInteger(Number(minimum))||!Number.isSafeInteger(Number(maximum))||Number(minimum)<0||Number(maximum)>1e9||Number(minimum)>Number(maximum))throw Error('نطاق تسلسل رقمي غير صالح');result.serialRange={minimum:Number(minimum),maximum:Number(maximum)}}
 if(result.requiredModifications.some((v:string)=>result.excludedModifications.includes(v)))throw Error('التعديل مطلوب ومستبعد في القاعدة نفسها');
 return result;
}
export function evaluateEffectivity(raw:any,identity:any){
 const rule=normalizeEffectivity(raw);if(!rule)return {configured:false,matches:null,unknown:[],reasons:[]};
 const reasons:string[]=[],unknown:string[]=[];
 for(const [key,field] of [['manufacturers','manufacturer'],['models','model'],['partNumbers','partNumber'],['serialNumbers',identity.msn!==undefined?'msn':'serialNumber']])if(rule[key].length){const value=String(identity[field]||'').trim().toUpperCase();if(!value)unknown.push(field);else if(!rule[key].includes(value))reasons.push(field+' خارج النطاق')}
 if(rule.serialRange){const serial=String(identity.msn??identity.serialNumber??'');if(!/^\d+$/.test(serial))unknown.push('serialRange');else if(Number(serial)<rule.serialRange.minimum||Number(serial)>rule.serialRange.maximum)reasons.push('التسلسل خارج المجال الرقمي')}
 const mods=identity.modifications||[],states=identity.modificationStates||{};for(const code of rule.requiredModifications){if(mods.includes(code)||states[code]===true)continue;if(states[code]===false)reasons.push('تعديل مطلوب غير مجسد: '+code);else unknown.push('modification:'+code)}for(const code of rule.excludedModifications){if(mods.includes(code)||states[code]===true)reasons.push('تعديل مستبعد مجسد: '+code);else if(states[code]!==false)unknown.push('modification:'+code)}
 return {configured:true,matches:reasons.length?false:unknown.length?null:true,unknown,reasons};
}
export function targetModifications(c:any,type:string,id:string){
 if(c.records||c.planning){const target=(type==='aircraft'?c.records:c.planning)?.find((r:any)=>r.id===id);if(target?.data.modificationStatus)return Object.entries(target.data.modificationStatus).filter(([,v]:any)=>v.embodied).map(([k])=>k).sort();}
 const rows=c.items.filter((r:any)=>r.kind==='engineering_change'&&r.state==='approved'&&r.data.targetType===type&&r.data.targetId===id&&r.data.changeType==='modification').sort((a:any,b:any)=>b.data.at.localeCompare(a.data.at)||b.updated.localeCompare(a.updated)),seen=new Set<string>();
 return rows.filter((r:any)=>{if(seen.has(r.data.modificationCode))return false;seen.add(r.data.modificationCode);return r.data.embodied}).map((r:any)=>r.data.modificationCode).sort();
}
