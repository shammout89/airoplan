import {referencePermissions} from './aircraft-reference-types';
export const settingsSections=[
 {id:'company',title:'بيانات الشركة وبدء الاستخدام',description:'تعريف الشركة وخطوات تجهيز الفريق والأسطول وبرامج الصيانة والتحقق من التشغيل.',permissions:[],ownerOnly:true},
 {id:'policy',title:'سياسة الاعتماد',description:'مسارا اعتماد التخطيط حسب نوع التغيير، مع حفظ سياسة كل طلب وسجل القرارات.',permissions:['configure','review','approve']},
 {id:'catalog',title:'البيانات الأساسية للطائرات',description:'الشركات المصنّعة وعائلات الطراز والطرازات الدقيقة وبلدان التسجيل والجهات الرقابية.',permissions:referencePermissions},
 {id:'field',title:'تهيئة النظام',description:'الحقول والنماذج وسياسات المراجعة والتنبيهات والتقارير.',permissions:['configure']},
 {id:'team',title:'المستخدمون والصلاحيات',description:'إنشاء المستخدمين وإدارة حساباتهم وأدوارهم وحالة وصولهم والتفويضات.',permissions:['manage_members']},
 {id:'audit',title:'سجل التغييرات',description:'مراجعة الإضافات والتعديلات والجهة التي نفذتها.',permissions:['audit']},
 {id:'recovery',title:'النسخ والاستعادة',description:'النسخ والتحقق والتعافي وإدارة نافذة الصيانة.',permissions:[],ownerOnly:true}
];
export function permittedSettings(session:any){return settingsSections.filter(s=>s.ownerOnly?session?.isOwner===true:s.permissions.some(p=>session?.permissions?.includes(p)))}
export function settingsVisible(session:any){return permittedSettings(session).length>0}
export const dailyNavigation=['dashboard','aircraft','usage','task','program','forecast','packages','resources','components','powerunits','defects','execution','corrections','acceptance','documents','technical','inventory','insights','reliability','notifications'];
export function mainNavigation(session:any){return [...dailyNavigation,...(session?.isOwner&&session?.authProvider==='local'?['services']:[]),...(session?.permissions?.includes('import_data')?['imports']:[]),...(settingsVisible(session)?['settings']:[])]}
