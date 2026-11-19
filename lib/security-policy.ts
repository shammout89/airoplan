import {permissionCeiling} from './permissions';import {shortText} from './planning';import {validDate} from './program';import {normalizeAircraftScope} from './aircraft-scope';
export function normalizeAccessGrant(raw:any,old:any,c:any,ownerId:string){
 const member=c.members.find((r:any)=>r.user_id===raw.userId&&r.state==='active');if(!member||member.user_id===ownerId)throw Error('اختر عضوًا فعالًا؛ صلاحيات المالك محمية');
 if(old&&old.data.userId!==raw.userId)throw Error('العضو المستهدف ثابت');if(old&&old.state!=='draft'&&old.data.roleAtReview!==member.role)throw Error('تغير الدور؛ أعد الحفظ والمراجعة');
 const allowed=permissionCeiling(member.role),permissions=raw.permissions;if(!Array.isArray(permissions)||!permissions.includes('read')||new Set(permissions).size!==permissions.length||permissions.some((p:any)=>typeof p!=='string'||!allowed.includes(p)))throw Error('حدد الصلاحيات ضمن الدور أو قوائم الطائرات القابلة للتفويض مع إبقاء القراءة');
 const validUntil=String(raw.validUntil||'');if(validUntil&&!validDate(validUntil))throw Error('انتهاء صلاحيات غير صحيح');const prior=c.items.find((r:any)=>r.kind==='access_grant'&&r.state==='approved'&&r.data.userId===member.user_id);
 const planes=(c.records||[]).filter((r:any)=>r.kind==='aircraft').map((r:any)=>({id:r.id,...r.data}));
 const scope=normalizeAircraftScope(raw,planes);
 return {data:{userId:member.user_id,roleAtReview:member.role,permissions:permissions.slice().sort(),validUntil,aircraftScopeMode:scope.mode,aircraftIds:scope.aircraftIds,aircraftModels:scope.models,reference:shortText(raw.reference,'مرجع قرار الصلاحيات'),reason:shortText(raw.reason,'سبب التقييد أو المراجعة',2000),supersedesId:prior?.id||null,notes:shortText(raw.notes||'','ملاحظات',2000,false)},checks:prior?[{table:'extension_items',id:prior.id,column:'etag',scopeColumn:'workspace_id',proof:prior.etag}]:[]};
}
export function accessGrantEffects(db:any,scope:string,data:any,c:any,w:any){return data.supersedesId?[db.prepare("UPDATE extension_items SET state='superseded',etag=?,updated=? WHERE id=? AND workspace_id=? AND "+w.proof).bind(w.token,w.now,data.supersedesId,scope,...w.proofArgs)]:[]}

