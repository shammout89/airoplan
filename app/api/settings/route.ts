import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure,requirePermission} from '../../../lib/access';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {normalizeSetting,saveSetting,settings,reportBase} from '../../../lib/settings';
import {AccessError} from '../../../lib/permissions';
import {normalizeField,baseFields} from '../../../lib/flexibility';
export const dynamic='force-dynamic';
export async function GET(){try{const a=await access(),all=await settings(env.DB!,a.scope);const history=a.permissions.includes('configure')?(await env.DB!.prepare('SELECT id,kind,code,previous_id,created_by,created FROM settings_versions WHERE workspace_id=? ORDER BY rowid DESC LIMIT 100').bind(a.scope).all()).results:[];return Response.json({settings:all.filter((s:any)=>s.kind==='layout'||a.permissions.includes('configure')||['report','alert'].includes(s.kind)),history,baseFields,reportBase})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{checkOrigin(req);const a=await access();requirePermission(a,'configure');lease=await acquireWrite(a,req);const b:any=await req.json();if(JSON.stringify(b).length>40000)throw Error('إعداد كبير');const rows=(await env.DB!.prepare('SELECT * FROM records WHERE owner=?').bind(a.scope).all()).results.map((r:any)=>({...r,data:JSON.parse(r.data)})),fields=rows.filter((r:any)=>r.kind==='field').map((r:any)=>r.data);
 if(b.kind==='fieldPreview'){const prior=rows.find((r:any)=>r.id===b.id&&r.kind==='field');if(b.id&&!prior)throw Error('الحقل غير موجود');return Response.json(normalizeField(b.data,prior?.data,fields,rows))}
 if(b.kind==='approval'&&b.code==='task')throw new AccessError('استخدم الإعدادات ← سياسة الاعتماد لإدارة مسار المهام');
 const data=normalizeSetting(b.kind,b.code,b.data,fields);if(b.preview)return Response.json({data,appliesToNextSubmission:b.kind==='approval',priorVersionsPreserved:true});return Response.json(await saveSetting(env.DB!,a,b.kind,b.code,data,b.previousId));
 }catch(e){return failure(e)}finally{await releaseWrite(lease)}}
