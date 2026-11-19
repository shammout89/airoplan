import {env} from 'cloudflare:workers';
import {access,failure} from '../../../lib/access';
import {reliabilityReport} from '../../../lib/reliability';
import {csv} from '../../../lib/flexibility';
import {currentSetting} from '../../../lib/settings';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{const a=await access(),url=new URL(req.url),to=url.searchParams.get('to')||new Date().toISOString().slice(0,10),from=url.searchParams.get('from')||new Date(Date.parse(to+'T00:00:00Z')-89*86400000).toISOString().slice(0,10),policy=await currentSetting(env.DB!,a.scope,'reliability','thresholds'),d=await reliabilityReport(env.DB!,a.scope,{from,to,aircraftId:url.searchParams.get('aircraft')||'',...policy?.data});if(url.searchParams.get('format')==='csv')return new Response(csv(d.byAircraft,['id','registration','sectors','hours','cycles','defects','defectsPer1000FH','defectsPer1000FC','unscheduledRemovals','removalsPer1000FH','unclassifiedRemovals','delays','delayMinutes','cancellations','onTime','withinVariation','late','unknownCompliance','compliancePercent','authorizedCompliancePercent']),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="AeroPlan-reliability.csv"','Cache-Control':'no-store'}});return Response.json(d,{headers:{'Cache-Control':'no-store'}})}catch(e){return failure(e)}}
