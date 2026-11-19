import {env} from 'cloudflare:workers';
import {access,failure,requirePermission} from '../../../lib/access';
import {insightRows} from '../../../lib/insights';
import {settings} from '../../../lib/settings';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{const a=await access();requirePermission(a,'import_data');const system=new URL(req.url).searchParams.get('system');if(!['operations','inventory'].includes(system||''))throw Error('اختر العمليات أو المخزون');const rows=await insightRows(env.DB!,a.scope),config=await settings(env.DB!,a.scope);return Response.json({schema:'AeroPlan-exchange-v1',system,generatedAt:new Date().toISOString(),connectionStatus:'file_exchange_only',connector:config.find((s:any)=>s.kind==='connector'&&s.code===system)?.data||null,data:system==='operations'?{aircraft:rows.aircraft,flights:rows.flights,tasks:rows.task}:{stock:rows.inventory,requests:rows.materials}},{headers:{'Content-Disposition':`attachment; filename="AeroPlan-${system}-exchange.json"`,'Cache-Control':'no-store'}})}catch(e){return failure(e)}}
