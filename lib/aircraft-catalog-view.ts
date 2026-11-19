import {referenceTypes,referenceSnapshot,type ReferenceType} from './aircraft-reference-types';
export function retainedAircraftReference(data:any,previous:any,type:ReferenceType){const def=referenceTypes[type];return !!previous?.catalogRefs?.[type]&&previous.catalogRefs[type]===data.catalogRefs?.[type]&&previous.catalogSnapshot?.[type]?.revision===data.catalogSnapshot?.[type]?.revision&&previous[def.field]===data[def.field]}
export function aircraftReferenceOptions(rows:any[],data:any,type:ReferenceType,previous?:any){
 const def=referenceTypes[type],parentId=def.parent?data.catalogRefs?.[def.parent]:null,id=data.catalogRefs?.[type]||'',legacy=!id&&data[def.field],matching=rows.filter(r=>r.data.type===type&&(!def.parent||r.data.parentId===parentId||r.id===id));
 const options=matching.map(r=>{const changedParent=!!def.parent&&r.data.parentId!==parentId;return {value:r.id,label:(r.id===id&&retainedAircraftReference(data,previous,type)&&data[def.field]!==r.data.name?data[def.field]+' — المسمى الحالي: '+r.data.name:r.data.name)+(r.data.code?' / '+r.data.code:'')+(r.effectiveActive?'':' — غير نشط')+(changedParent?' — تغير الارتباط؛ أعد الاختيار':''),disabled:!r.effectiveActive||changedParent}});
 if(legacy)options.unshift({value:'__legacy__'+type,label:data[def.field]+' — قيمة محفوظة سابقة',disabled:true});
 if(id&&!matching.some(r=>r.id===id))options.unshift({value:id,label:(data[def.field]||def.singular)+' — غير متاح في القوائم الحالية',disabled:true});
 return {options,value:id||(legacy?'__legacy__'+type:''),parentId,hasActive:matching.some(r=>r.effectiveActive&&(!def.parent||r.data.parentId===parentId)),legacy};
}
export function refreshDraftAircraftReferences(data:any,previous:any,rows:any[]){
 let next=data;for(const type of Object.keys(referenceTypes) as ReferenceType[]){const id=data.catalogRefs?.[type];if(!id||retainedAircraftReference(data,previous,type))continue;const def=referenceTypes[type],row=rows.find(r=>r.id===id&&r.data.type===type);if(!row?.effectiveActive||(row.data.parentId||null)!==(def.parent?data.catalogRefs?.[def.parent]||null:null))continue;
  if(data[def.field]!==row.data.name||data.catalogSnapshot?.[type]?.revision!==row.etag){if(next===data)next={...data,catalogSnapshot:{...data.catalogSnapshot},counterConfirmed:false};next[def.field]=row.data.name;next.catalogSnapshot[type]=referenceSnapshot(row);}
 }return next;
}
export function aircraftCatalogSelectionIssues(data:any,previous:any,rows:any[]){const issues:string[]=[];for(const type of Object.keys(referenceTypes) as ReferenceType[]){const id=data.catalogRefs?.[type];if(!id||retainedAircraftReference(data,previous,type))continue;const def=referenceTypes[type],row=rows.find(r=>r.id===id&&r.data.type===type);if(!row?.effectiveActive||(row.data.parentId||null)!==(def.parent?data.catalogRefs?.[def.parent]||null:null))issues.push('تغيرت إتاحة '+def.singular+' المختارة؛ اختر قيمة نشطة تتبع الاختيار السابق قبل التفعيل');}return issues}
