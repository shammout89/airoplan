export const referenceTypes={
 manufacturer:{label:'الشركات المصنّعة',singular:'الشركة المصنّعة',field:'manufacturer',parent:null,permission:'manage_aircraft_manufacturers'},
 family:{label:'عائلات الطراز',singular:'عائلة الطراز',field:'family',parent:'manufacturer',permission:'manage_aircraft_families'},
 variant:{label:'الطرازات الدقيقة',singular:'الطراز الدقيق / Variant',field:'model',parent:'family',permission:'manage_aircraft_variants'},
 country:{label:'بلدان التسجيل',singular:'بلد التسجيل',field:'registrationCountry',parent:null,permission:'manage_aircraft_countries'},
 authority:{label:'الجهات الرقابية',singular:'جهة الإشراف الرقابي',field:'authority',parent:'country',permission:'manage_aircraft_authorities'}
} as const;
export type ReferenceType=keyof typeof referenceTypes;
export const referenceOrder=Object.keys(referenceTypes) as ReferenceType[];
export const referencePermissions=referenceOrder.map(k=>referenceTypes[k].permission);
export const referencePermissionLabels=Object.fromEntries(referenceOrder.map(k=>[referenceTypes[k].permission,'إدارة '+referenceTypes[k].label]));
export const referenceKey=(value:any)=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleUpperCase('en-US');
export function referenceSnapshot(row:any){return {id:row.id,type:row.data.type,parentId:row.data.parentId||null,name:row.data.name,code:row.data.code||'',revision:row.etag}}
export function changeAircraftReference(data:any,type:ReferenceType,row?:any){
 const def=referenceTypes[type];if(row&&(row.data.type!==type||(row.data.parentId||null)!==(def.parent?data.catalogRefs?.[def.parent]||null:null)))throw Error('الاختيار لا يتبع القائمة المرتبطة');
 if(row?.effectiveActive===false){if(data.catalogRefs?.[type]===row.id)return data;throw Error('الاختيار غير نشط');}
 const refs={...data.catalogRefs},snapshots={...data.catalogSnapshot},next={...data,catalogVersion:1,counterConfirmed:false};
 const clear=(key:ReferenceType)=>{delete refs[key];delete snapshots[key];next[referenceTypes[key].field]='';for(const child of referenceOrder.filter(k=>referenceTypes[k].parent===key))clear(child)};
 clear(type);if(row){refs[type]=row.id;snapshots[type]=referenceSnapshot(row);next[def.field]=row.data.name}next.catalogRefs=refs;next.catalogSnapshot=snapshots;return next;
}
export function referenceSnapshotIssues(data:any){
 if(data?.catalogVersion!==1)return [];
 const errors:string[]=[];
 for(const type of referenceOrder){const def=referenceTypes[type],id=data.catalogRefs?.[type],snap=data.catalogSnapshot?.[type];if(!id||!snap||snap.id!==id||snap.type!==type||snap.name!==data[def.field]||!snap.revision||snap.parentId!==(def.parent?data.catalogRefs?.[def.parent]||null:null))errors.push('استكمل '+def.singular+' من القوائم المعتمدة');}
 return errors;
}
