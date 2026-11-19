import {componentLife} from './planning';

export function componentCounterSource(row:any,components:any[],seen=new Set<string>()):any{
 if(!row||seen.has(row.id)||seen.size>=50)throw Error('مصدر عدادات المكوّن دائري أو غير موجود');seen.add(row.id);
 if(row.data.counterMode==='independent')return {type:'component',id:row.id};
 if(row.data.assembly)return componentCounterSource(components.find((p:any)=>p.id===row.data.assembly.parentId&&p.state==='approved'),components,seen);
 return row.data.installation?{type:'aircraft',id:row.data.installation.aircraftId}:null;
}

export function componentDependencies(row:any,components:any[],records:any[],dep:any,seen=new Set<string>()){
 if(!row||seen.has(row.id)||seen.size>=50)throw Error('شجرة مكونات دائرية أو أعمق من النطاق المدعوم');
 seen.add(row.id);dep.add('planning_items',row);
 if(row.data.assembly)componentDependencies(components.find((p:any)=>p.id===row.data.assembly.parentId&&p.kind==='component'&&p.state==='approved'),components,records,dep,seen);
 else if(row.data.installation)dep.add('records',records.find((p:any)=>p.kind==='aircraft'&&p.id===row.data.installation.aircraftId));
}

export function componentAircraftId(row:any,components:any[],seen=new Set<string>()):string|null{
 if(!row||seen.has(row.id)||seen.size>=50)throw Error('شجرة مكونات دائرية أو أعمق من النطاق المدعوم');
 seen.add(row.id);
 if(row.data.assembly){const parent=components.find((p:any)=>p.id===row.data.assembly.parentId&&p.kind==='component'&&p.state==='approved');if(!parent)throw Error('التجميعة الأم غير موجودة أو غير معتمدة');return componentAircraftId(parent,components,seen)}
 return row.data.installation?.aircraftId||null;
}

export function resolvedComponentLife(row:any,components:any[],records:any[],seen=new Set<string>()):any{
 if(!row||seen.has(row.id)||seen.size>=50)throw Error('شجرة مكونات دائرية أو أعمق من النطاق المدعوم');
 seen.add(row.id);
 if(row.data.installation&&row.data.assembly)throw Error('المكوّن مركب على طائرة وتجميعة في الوقت نفسه');
 if(row.data.assembly){const parent=components.find((p:any)=>p.id===row.data.assembly.parentId&&p.kind==='component'&&p.state==='approved');if(!parent)throw Error('التجميعة الأم غير موجودة أو غير معتمدة');const parentLife=resolvedComponentLife(parent,components,records,seen);return {...componentLife(row.data,{...parentLife,componentId:parent.id}),componentId:row.id,parentId:parent.id};}
 const plane=records.find((p:any)=>p.kind==='aircraft'&&p.id===row.data.installation?.aircraftId);
 return {...componentLife(row.data,plane?.data),componentId:row.id,parentId:null};
}
