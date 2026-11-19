import {AccessError} from './permissions';
import {normalizeProgram} from './program';
import {canonical,sha256} from './backup-format';

export const maxProgramTasks=10000;
export async function programData(db:any,scope:string,row:any){
 const data=typeof row.data==='string'?JSON.parse(row.data):row.data;
 if(data.taskStorage!=='definitions-v1')return data;
 const rows=(await db.prepare("SELECT data FROM extension_items WHERE workspace_id=? AND kind='program_definition' AND json_extract(data,'$.programId')=? ORDER BY code").bind(scope,row.id).all()).results;
 if(rows.length!==data.taskCount)throw Error('عدد تعريفات البرنامج لا يطابق الفهرس');
 return {...data,tasks:rows.map((r:any)=>JSON.parse(r.data).definition)};
}

export async function programDefinition(db:any,scope:string,row:any,code:string){
 const data=typeof row.data==='string'?JSON.parse(row.data):row.data;
 if(data.taskStorage!=='definitions-v1')return data.tasks.find((d:any)=>d.code===code);
 const r=await db.prepare("SELECT data FROM extension_items WHERE workspace_id=? AND kind='program_definition' AND code=? AND json_extract(data,'$.programId')=?").bind(scope,row.id+'|'+code,row.id).first();
 return r?JSON.parse(r.data).definition:null;
}

export function storedProgram(data:any){return data.tasks.length>100?{...data,tasks:[],taskCount:data.tasks.length,taskStorage:'definitions-v1'}:data}

export function definitionWrites(db:any,a:any,id:string,data:any,etag:string,now:string){
 const proof='EXISTS(SELECT 1 FROM program_revisions WHERE id=? AND workspace_id=? AND etag=?)',args=[id,a.scope,etag];
 const result=[db.prepare("DELETE FROM extension_items WHERE workspace_id=? AND kind='program_definition' AND json_extract(data,'$.programId')=? AND "+proof).bind(a.scope,id,...args)];
 if(data.tasks.length<=100)return result;
 for(let offset=0;offset<data.tasks.length;offset+=100){
  const rows=data.tasks.slice(offset,offset+100).map((definition:any)=>({id:crypto.randomUUID(),code:id+'|'+definition.code,data:{programId:id,definition}}));
  result.push(db.prepare("INSERT INTO extension_items(id,workspace_id,kind,code,state,data,etag,modified_by,created,updated) SELECT json_extract(value,'$.id'),?,'program_definition',json_extract(value,'$.code'),'active',json_extract(value,'$.data'),?,?,?,? FROM json_each(?) WHERE "+proof).bind(a.scope,etag,a.userId,now,now,JSON.stringify(rows),...args));
 }
 return result;
}

export async function previewProgramChange(db:any,a:any,row:any,body:any){
 if(row.state!=='draft')throw new AccessError('تعريفات الإصدار مقفلة؛ أنشئ مسودة إصدار جديد');
 if(row.etag!==body.etag)throw new AccessError('تغير البرنامج؛ أعد المعاينة',409);
 if(!['append','upsert','replace','remove'].includes(body.mode)||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>1000)throw Error('اختر 1–1000 تعريف في الدفعة وطريقة استيراد صالحة');
 const current=await programData(db,a.scope,row),map=new Map<string,any>(body.mode==='replace'?[]:current.tasks.map((t:any)=>[t.code,t]));
 const seen=new Set<string>();
 for(const raw of body.rows){const code=String(raw.code||'').trim().toUpperCase();if(!code||seen.has(code))throw Error('رمز تعريف فارغ أو مكرر في الدفعة');seen.add(code);if(body.mode==='remove'){if(!map.delete(code))throw Error('تعريف الإزالة غير موجود: '+code)}else{if(body.mode==='append'&&map.has(code))throw Error('التعريف موجود: '+code);map.set(code,raw)}}
 const planes=(await db.prepare("SELECT id FROM records WHERE owner=? AND kind='aircraft'").bind(a.scope).all()).results.map((r:any)=>r.id);
 const data=normalizeProgram({...current,tasks:[...map.values()]},planes);
 const digest=await sha256(canonical({programId:row.id,etag:row.etag,mode:body.mode,rows:body.rows}));
 return {data,digest,summary:{before:current.tasks.length,after:data.tasks.length,changed:body.rows.length,mode:body.mode,codes:[...seen].slice(0,50)}};
}
