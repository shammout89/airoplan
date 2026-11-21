import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission} from '../../../lib/access';
import {AccessError} from '../../../lib/permissions';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {previewProgramChange,storedProgram,definitionWrites} from '../../../lib/program-store';
import {pinScheduleEvidence} from '../../../lib/schedule-evidence';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{
 const a=await access(),db=env.DB!,u=new URL(req.url),id=u.searchParams.get('programId'),q=(u.searchParams.get('q')||'').slice(0,150).toLowerCase(),offset=Math.max(0,Math.min(100000,Number(u.searchParams.get('offset'))||0));
 const row:any=await db.prepare('SELECT * FROM program_revisions WHERE workspace_id=? AND id=?').bind(a.scope,id).first();if(!row)throw new AccessError('البرنامج غير موجود',404);
 const target=u.searchParams.get('targetType');if(target&&!['aircraft','component','engine','apu'].includes(target))throw Error('نوع أصل غير صالح');const meta=JSON.parse(row.data);let tasks:any[],total:number;
 if(meta.taskStorage==='definitions-v1'){
  const where="workspace_id=? AND kind='program_definition' AND json_extract(data,'$.programId')=? AND instr(lower(data),?)>0"+(target?" AND COALESCE(json_extract(data,'$.definition.targetType'),'aircraft')=?":'');
  const count:any=await db.prepare('SELECT count(*) n FROM extension_items WHERE '+where).bind(a.scope,row.id,q,...(target?[target]:[])).first();total=Number(count?.n||0);
  tasks=(await db.prepare('SELECT data FROM extension_items WHERE '+where+' ORDER BY code LIMIT 50 OFFSET ?').bind(a.scope,row.id,q,...(target?[target]:[]),offset).all()).results.map((r:any)=>JSON.parse(r.data).definition);
 }else{const all=meta.tasks.filter((t:any)=>(!target||(t.targetType||'aircraft')===target)&&(!q||[t.code,t.title,t.reference,t.ata].join(' ').toLowerCase().includes(q)));total=all.length;tasks=all.slice(offset,offset+50)}
 return Response.json({tasks,total,offset,limit:50,etag:row.etag,state:row.state});
}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access();requirePermission(a,'edit_program');lease=await acquireWrite(a,req);const db=env.DB!,b:any=await req.json();if(JSON.stringify(b).length>6*1024*1024)throw Error('دفعة كبيرة؛ قسم التعريفات إلى دفعات أصغر');
 const row:any=await db.prepare('SELECT * FROM program_revisions WHERE workspace_id=? AND id=?').bind(a.scope,b.programId).first();if(!row)throw new AccessError('البرنامج غير موجود',404);
 const p=await previewProgramChange(db,a,row,b);await pinScheduleEvidence(db,env.BUCKET!,a.scope,p.data);
 if(b.action==='preview')return Response.json({digest:p.digest,...p.summary});
 if(b.action!=='commit'||b.previewDigest!==p.digest)throw Error('يلزم اعتماد معاينة الدفعة نفسها قبل الحفظ');
 const token=crypto.randomUUID(),now=new Date().toISOString();
 const result=await db.batch([db.prepare("UPDATE program_revisions SET data=?,etag=?,modified_by=?,updated=? WHERE id=? AND workspace_id=? AND etag=? AND state='draft'").bind(JSON.stringify(storedProgram(p.data)),token,a.userId,now,row.id,a.scope,row.etag),...definitionWrites(db,a,row.id,p.data,token,now),db.prepare('INSERT INTO audit(id,owner,action,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM program_revisions WHERE id=? AND workspace_id=? AND etag=?)').bind(crypto.randomUUID(),a.scope,a.email+' — استيراد تعريفات برنامج '+row.code+' / '+p.summary.changed,now,row.id,a.scope,token)]);
 if(!result[0].meta.changes)throw new AccessError('تغير البرنامج أثناء الحفظ',409);
 return Response.json({ok:true,id:row.id,etag:token,...p.summary});
}catch(e){return failure(e)}finally{await releaseWrite(lease)}}
