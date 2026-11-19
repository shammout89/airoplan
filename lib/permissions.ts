import {referencePermissions} from './aircraft-reference-types';
export const roleLabels:Record<string,string>={admin:'مدير النظام',planner:'مخطط',reviewer:'مراجع',approver:'معتمد',viewer:'مشاهد'};
export const rolePermissions:Record<string,string[]>={
 admin:[...referencePermissions,'manage_technical','manage_documents','manage_inventory','import_data','edit_planning','record_acceptance','log_usage','request_correction','record_execution','edit_program','read','edit_aircraft','edit_task','configure','manage_members','audit','submit','review','approve','close'],
 planner:['manage_technical','manage_documents','manage_inventory','import_data','edit_planning','log_usage','request_correction','record_execution','edit_program','read','edit_aircraft','edit_task','submit'],
 reviewer:['record_acceptance','read','review','audit'],
 approver:['record_acceptance','read','approve','close','audit'],
 viewer:['read']
};
export function permissionCeiling(role:string){return rolePermissions[role]?[...new Set([...rolePermissions[role],...referencePermissions])]:[]}
export function allowed(role:any,permission:string){const name=typeof role==='string'?role:role?.role;return typeof role==='string'?!!rolePermissions[name]?.includes(permission):permissionCeiling(name).includes(permission)&&(Array.isArray(role?.permissions)?role.permissions:rolePermissions[name]||[]).includes(permission)}
export class AccessError extends Error{constructor(message:string,public status=403){super(message)}}
export function requirePermission(role:any,p:string){if(!allowed(role,p))throw new AccessError('ليس لديك صلاحية لتنفيذ هذا الإجراء')}
export function workflowTransition(data:any,action:string,actor:string,role:string){
 requirePermission(role,action);const state=data.reviewState||'draft';
 if(action==='close'&&state==='approved'&&data.status!=='closed')return {...data,status:'closed',closedBy:actor};
 if(action==='submit'&&state==='draft')return {...data,reviewState:'submitted',submittedBy:actor,reviewedBy:null,approvedBy:null};
 if(action==='review'&&state==='submitted'){if(data.submittedBy===actor||data.modifiedBy===actor)throw new AccessError('لا يمكنك مراجعة المهمة التي أعددتها');return {...data,reviewState:'reviewed',reviewedBy:actor}}
 if(action==='approve'&&state==='reviewed'){if(data.submittedBy===actor||data.reviewedBy===actor||data.modifiedBy===actor)throw new AccessError('يلزم اعتماد مستقل عن الإعداد والمراجعة');return {...data,reviewState:'approved',approvedBy:actor}}
 throw new AccessError('الانتقال غير متاح في حالة المهمة الحالية',409);
}
