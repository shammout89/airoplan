import {AccessError} from './permissions';
import {currentSetting} from './settings';
import {aircraftPlanningReady} from './aircraft';

export type CompanyProfile={schemaVersion:1,companyName:string,departmentName:string,reference:string,changeReason:string};
const text=(value:unknown,label:string,max:number,required=false)=>{
 if(typeof value!=='string')throw Error('أدخل '+label);
 const normalized=value.normalize('NFC').trim().replace(/\s+/g,' ');
 if(/[\u0000-\u001f\u007f]/.test(value)||normalized.length>max||(required&&normalized.length<2))throw Error('تحقق من '+label);
 return normalized;
};
export function normalizeCompanyProfile(raw:any):CompanyProfile{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['schemaVersion','companyName','departmentName','reference','changeReason'].includes(k))||(raw.schemaVersion!==undefined&&raw.schemaVersion!==1))throw Error('بيانات الشركة غير صالحة');
 return {schemaVersion:1,companyName:text(raw.companyName,'اسم الشركة',120,true),departmentName:text(raw.departmentName,'اسم القسم',120,true),reference:text(raw.reference??'','مرجع بيانات الشركة',300),changeReason:text(raw.changeReason,'سبب حفظ البيانات',500,true)};
}
export function requireCompanyOwner(a:any){if(a.isOwner!==true)throw new AccessError('إعداد الشركة متاح لمالك مساحة العمل فقط');}
export async function companySetup(db:any,a:any){
 requireCompanyOwner(a);
 const [profile,aircraft,members,programs,tasks,history]=await Promise.all([
  currentSetting(db,a.scope,'company','profile'),
  db.prepare("SELECT data FROM records WHERE owner=? AND kind='aircraft'").bind(a.scope).all(),
  db.prepare("SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN state='active' AND user_id IS NOT NULL THEN 1 ELSE 0 END),0) active FROM members WHERE workspace_id=?").bind(a.scope).first(),
  db.prepare("SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN state='approved' THEN 1 ELSE 0 END),0) approved FROM program_revisions WHERE workspace_id=?").bind(a.scope).first(),
  db.prepare("SELECT COUNT(*) total FROM records WHERE owner=? AND kind='task'").bind(a.scope).first(),
  db.prepare("SELECT id,data,created_by,created FROM settings_versions WHERE workspace_id=? AND kind='company' AND code='profile' ORDER BY rowid DESC LIMIT 20").bind(a.scope).all()
 ]);
 return {profile:profile?.data||null,versionId:profile?.id||null,workspaceName:a.workspace.name,counts:{aircraft:{total:aircraft.results.length,verified:aircraft.results.filter((r:any)=>aircraftPlanningReady(JSON.parse(r.data))).length},members:{total:Number(members.total),active:Number(members.active)},programs:{total:Number(programs.total),approved:Number(programs.approved)},tasks:Number(tasks.total)},history:history.results.map((r:any)=>({...r,data:JSON.parse(r.data)})),operationalAcceptance:'requires_independent_verification'};
}
export async function saveCompanyProfile(db:any,a:any,raw:any,expectedVersion:any){
 requireCompanyOwner(a);
 if(expectedVersion!==null&&(typeof expectedVersion!=='string'||expectedVersion.length>100))throw Error('أعد تحميل إصدار بيانات الشركة');
 const data=normalizeCompanyProfile(raw),prior=await currentSetting(db,a.scope,'company','profile');
 if((prior?.id||null)!==expectedVersion)throw new AccessError('تغيرت بيانات الشركة. احتفظ بتعديلاتك ثم حمّل آخر نسخة للمقارنة.',409);
 const id=crypto.randomUUID(),now=new Date().toISOString(),encoded=JSON.stringify(data);
 const result=await db.batch([
  db.prepare("INSERT INTO settings_versions(id,workspace_id,kind,code,data,previous_id,created_by,created) SELECT ?,?,'company','profile',?,?,?,? WHERE COALESCE((SELECT id FROM settings_versions WHERE workspace_id=? AND kind='company' AND code='profile' ORDER BY rowid DESC LIMIT 1),'')=? AND EXISTS(SELECT 1 FROM workspaces WHERE id=? AND owner_user_id=?) AND EXISTS(SELECT 1 FROM members WHERE workspace_id=? AND user_id=? AND state='active')").bind(id,a.scope,encoded,prior?.id||null,a.email,now,a.scope,prior?.id||'',a.scope,a.userId,a.scope,a.userId),
  db.prepare('UPDATE workspaces SET name=? WHERE id=? AND owner_user_id=? AND EXISTS(SELECT 1 FROM settings_versions WHERE id=? AND workspace_id=?)').bind(data.companyName,a.scope,a.userId,id,a.scope),
  db.prepare('INSERT INTO audit(id,owner,action,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM settings_versions WHERE id=? AND workspace_id=?)').bind(crypto.randomUUID(),a.scope,a.email+' — تحديث بيانات الشركة: '+data.companyName+' — '+data.changeReason,now,id,a.scope)
 ]);
 if(!result[0].meta.changes)throw new AccessError('تغير الإصدار أو صلاحية المالك أثناء الحفظ. أعد تحميل البيانات.',409);
 return {versionId:id,profile:data,updatedAt:now};
}
