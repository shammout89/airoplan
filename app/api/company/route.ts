import {env} from 'cloudflare:workers';
import {access,checkOrigin,failure} from '../../../lib/access';
import {acquireWrite,releaseWrite} from '../../../lib/write-gate';
import {companySetup,requireCompanyOwner,saveCompanyProfile} from '../../../lib/company-profile';
export const dynamic='force-dynamic';
export async function GET(){try{const a=await access();return Response.json(await companySetup(env.DB!,a),{headers:{'Cache-Control':'no-store'}})}catch(e){return failure(e)}}
export async function POST(req:Request){let lease:string|null=null;try{
 checkOrigin(req);const a=await access();requireCompanyOwner(a);lease=await acquireWrite(a,req);
 const body:any=await req.json();if(!body||Array.isArray(body)||JSON.stringify(body).length>8000||Object.keys(body).some(k=>!['data','expectedVersion'].includes(k))||!Object.hasOwn(body,'expectedVersion'))throw Error('طلب بيانات الشركة غير صالح');
 return Response.json(await saveCompanyProfile(env.DB!,a,body.data,body.expectedVersion),{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e)}finally{await releaseWrite(lease)}}
