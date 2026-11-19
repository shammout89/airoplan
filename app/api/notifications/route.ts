import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure} from '../../../lib/access';
import {notificationSummary,acknowledgeIncident} from '../../../lib/notifications';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{const a=await access(),url=new URL(req.url),offset=Math.max(0,Math.min(100000,Number(url.searchParams.get('offset'))||0)),s=await notificationSummary(env.DB!,100,offset);return Response.json(a.isOwner?s:{incidents:s.incidents.filter((r:any)=>r.data.roles.includes(a.role)||r.data.escalationRoles.includes(a.role)),jobs:s.jobs.filter((r:any)=>r.data.recipientId===a.userId),counts:[]})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{checkOrigin(req);const a=await access();lease=await acquireWrite(a,req);const b:any=await req.json();if(b.action!=='acknowledge')throw Error('إجراء غير صالح');return Response.json(await acknowledgeIncident(env.DB!,a,b.id,String(b.reason||'')))}catch(e){return failure(e)}finally{await releaseWrite(lease)}}
