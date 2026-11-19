import {AccessError} from './permissions';
import {canonical} from './backup-format';
import {referenceTypes,referenceOrder,referenceKey,referenceSnapshot,referenceSnapshotIssues,type ReferenceType} from './aircraft-reference-types';
export const referenceKind='aircraft_reference',referenceRevisionKind='aircraft_reference_revision';
const decode=(r:any)=>({...r,data:typeof r.data==='string'?JSON.parse(r.data):r.data});
export async function aircraftReferences(db:any,scope:string):Promise<any[]>{return (await db.prepare("SELECT * FROM extension_items WHERE workspace_id=? AND kind=? ORDER BY code").bind(scope,referenceKind).all()).results.map(decode)}
export function referenceActive(row:any,rows:any[],seen=new Set<string>()):boolean{if(!row||seen.has(row.id)||row.state!=='active'||row.data.active!==true)return false;seen.add(row.id);return !row.data.parentId||referenceActive(rows.find(x=>x.id===row.data.parentId),rows,seen)}
export function normalizeReference(raw:any,old:any,rows:any[]){
 const type=old?.data.type||raw.type;if(!Object.hasOwn(referenceTypes,type)||old&&raw.type!==undefined&&raw.type!==type)throw Error('نوع القائمة غير صحيح أو تغير بعد الإنشاء');const def=referenceTypes[type as ReferenceType];
 const text=(v:any,label:string,max=150)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error('تحقق من '+label);return v.normalize('NFC').trim().replace(/\s+/g,' ')};
 const name=text(raw.name,'الاسم'),code=raw.code?text(raw.code,'الرمز',40):'',parentId=def.parent?String(raw.parentId||''):null;
 if(def.parent){const parent=rows.find(x=>x.id===parentId&&x.data.type===def.parent);if(!parent)throw Error('اختر '+referenceTypes[def.parent].singular);if((!old||old.data.parentId!==parentId||raw.active!==false&&!old.data.active)&&!referenceActive(parent,rows))throw Error('القيمة المرتبطة غير نشطة');}
 const data={type,name,nameKey:referenceKey(name),code,codeKey:referenceKey(code),parentId,active:raw.active!==false,notes:typeof raw.notes==='string'?raw.notes.normalize('NFC').trim():''};if(data.notes.length>2000||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(data.notes))throw Error('ملاحظات غير صحيحة');
 if(rows.some(x=>x.id!==old?.id&&x.data.type===type&&(x.data.parentId||null)===parentId&&(x.data.nameKey===data.nameKey||data.codeKey&&x.data.codeKey===data.codeKey)))throw new AccessError('الاسم أو الرمز موجود في هذه القائمة؛ عدّل القيمة الموجودة أو أعد تفعيلها',409);
 return data;
}
export function resolveAircraftReferences(raw:any,previous:any,rows:any[],activate=false){
 const fields=referenceOrder.map(k=>referenceTypes[k].field),hasRefs=raw.catalogRefs&&Object.values(raw.catalogRefs).some(Boolean),unchanged=previous&&fields.every(k=>String(raw[k]??previous[k]??'')===String(previous[k]??''));
 if(previous?.catalogVersion!==1&&unchanged&&!hasRefs&&!activate)return {data:raw,catalog:null,proofs:[]};
 if(raw.catalogRefs!==undefined&&(!raw.catalogRefs||typeof raw.catalogRefs!=='object'||Array.isArray(raw.catalogRefs)||Object.keys(raw.catalogRefs).some(k=>!referenceOrder.includes(k as ReferenceType))||Object.values(raw.catalogRefs).some(v=>v!==null&&v!==''&&(typeof v!=='string'||v.length>100))))throw Error('مراجع قوائم غير صحيحة');
 const refs:any={},snapshot:any={},data={...raw},proofs:any[]=[];
 for(const type of referenceOrder){const def=referenceTypes[type],parentId=def.parent?refs[def.parent]||null:null,value=String(raw[def.field]??previous?.[def.field]??'').trim(),explicit=Object.hasOwn(raw,'catalogRefs')?raw.catalogRefs?.[type]:unchanged&&previous?.catalogVersion===1?previous.catalogRefs?.[type]:undefined;
  if(!explicit&&!value){data[def.field]='';continue;}
  const retained=previous?.catalogVersion===1&&explicit&&explicit===previous.catalogRefs?.[type]&&value===previous[def.field]&&(!def.parent||refs[def.parent]===previous.catalogRefs?.[def.parent]);
  const matches=explicit?rows.filter(r=>r.id===explicit&&r.data.type===type):rows.filter(r=>r.data.type===type&&(r.data.parentId||null)===parentId&&(referenceKey(value)===r.data.nameKey||r.data.codeKey&&referenceKey(value)===r.data.codeKey));if(matches.length>1)throw Error('الاسم أو الرمز يطابق أكثر من '+def.singular+'؛ استخدم معرف الاختيار أو اسمًا غير ملتبس');const row=matches[0];
  if(!row)throw Error('اختر '+def.singular+' من البيانات الأساسية في الإعدادات');if(!retained&&raw.catalogSnapshot?.[type]?.revision&&raw.catalogSnapshot[type].revision!==row.etag)throw new AccessError('تغير '+def.singular+'؛ حدّث القوائم وأعد الاختيار',409);if((row.data.parentId||null)!==parentId)throw Error(def.singular+' لا تتبع الاختيار السابق');if(!retained&&!referenceActive(row,rows))throw Error(def.singular+' غير نشطة للاستخدام الجديد');
  refs[type]=row.id;data[def.field]=retained?previous[def.field]:row.data.name;snapshot[type]=retained?previous.catalogSnapshot[type]:referenceSnapshot(row);proofs.push({id:row.id,etag:row.etag});
 }
 const catalog={version:1,refs,snapshot};Object.assign(data,{catalogVersion:1,catalogRefs:refs,catalogSnapshot:snapshot});
 if(activate){const errors=referenceSnapshotIssues(data);if(errors.length)throw Error(errors.join('؛ '));}
 return {data,catalog,proofs};
}
export async function validateReferenceSnapshot(items:any[],records:any[]){
 const rows=items.filter(x=>x.kind===referenceKind),history=items.filter(x=>x.kind===referenceRevisionKind),ids=new Set(rows.map(r=>r.id));
 for(const row of rows){const d=row.data;if(row.state!==(d.active?'active':'disabled')||canonical(normalizeReference(d,row,rows))!==canonical(d))throw Error('تعريف قائمة طائرات غير صحيح');if(d.parentId&&!ids.has(d.parentId))throw Error('مرجع قائمة طائرات مفقود');}
 for(const version of history){const d=version.data,master=rows.find(r=>r.id===d.entryId);if(!master||version.state!=='recorded'||!d.revision||d.data?.type!==master.data.type||d.snapshot?.id!==d.entryId||d.snapshot?.revision!==d.revision||version.code!==d.entryId+'/'+d.revision||canonical(referenceSnapshot({id:d.entryId,data:d.data,etag:d.revision}))!==canonical(d.snapshot))throw Error('سجل إصدار قائمة غير مطابق');}
 for(const row of rows){const versions=history.filter(v=>v.data.entryId===row.id),byRevision=new Map(versions.map(v=>[v.data.revision,v.data])),seen=new Set<string>();let version=byRevision.get(row.etag);if(!version||canonical(version.data)!==canonical(row.data)||byRevision.size!==versions.length)throw Error('الإصدار الحالي للقائمة غير موثق');while(version){if(seen.has(version.revision))throw Error('دورة في تاريخ القائمة');seen.add(version.revision);if(version.previousRevision===null)break;version=byRevision.get(version.previousRevision);if(!version)throw Error('إصدار سابق للقائمة مفقود');}if(seen.size!==versions.length)throw Error('تاريخ قائمة منفصل عن الإصدار الحالي');}
 for(const row of records.filter(r=>r.kind==='aircraft'&&r.data.catalogVersion===1)){
  const d=row.data;for(const type of referenceOrder){const id=d.catalogRefs?.[type],snap=d.catalogSnapshot?.[type];if(!id){if(d.profileStatus==='verified')throw Error('طائرة متحقق منها دون قوائم مكتملة');continue;}const master=rows.find(r=>r.id===id&&r.data.type===type);if(!master||!snap||snap.parentId!==(referenceTypes[type].parent?d.catalogRefs[referenceTypes[type].parent!]:null))throw Error('مرجع قائمة الطائرة غير مطابق');
   const original=master.etag===snap.revision?referenceSnapshot(master):history.find(v=>v.data.entryId===id&&v.data.revision===snap.revision)?.data.snapshot;if(!original||canonical(original)!==canonical(snap)||d[referenceTypes[type].field]!==snap.name)throw Error('مسميات الطائرة لا تطابق الإصدار المحفوظ من القائمة');}
  if(d.profileStatus==='verified'&&referenceSnapshotIssues(d).length)throw Error('قوائم الطائرة المتحقق منها غير مكتملة');
 }
}
