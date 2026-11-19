// Optional independent QR acceptance check. Pass a directory containing jsqr@1.4.0.
// Example: node tests/qr-decode.external.mjs /tmp/aeroplan-qr-qa
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {enrollmentQR,enrollmentMarkup} from '../selfhost/mfa-enrollment.mjs';
import {base32} from '../selfhost/mfa.mjs';
if(!process.argv[2])throw Error('Pass a QA-only directory containing jsqr@1.4.0; no additional runtime dependency is required.');
const require=createRequire(import.meta.url),decoderRequire=createRequire(path.join(path.resolve(process.argv[2]),'package.json'));
const sharp=require('sharp'),jsQR=decoderRequire('jsqr');
const secret=base32(Buffer.from('12345678901234567890'));
let decodedImages=0,checks=0;
for(const email of ['synthetic@example.test','فحص@مثال.اختبار','long-'+ 'a'.repeat(170)+'@example.test']){
 const uri='otpauth://totp/'+encodeURIComponent('AeroPlan:'+email)+'?secret='+secret+'&issuer=AeroPlan&algorithm=SHA1&digits=6&period=30';
 const svg=enrollmentQR(uri);
 assert(!/<(?:script|image|foreignObject)\b/i.test(svg));checks++;
 for(const width of [240,320,640]){
  const {data,info}=await sharp(Buffer.from(svg)).resize(width,width,{kernel:'nearest'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const decoded=jsQR(new Uint8ClampedArray(data),info.width,info.height,{inversionAttempts:'dontInvert'});
  assert(decoded,`QR decode failed for a ${email.length}-character synthetic email at ${width}px`);
  assert.equal(decoded.data,uri);
  const actual=new URL(decoded.data);assert.equal(actual.searchParams.get('secret'),secret);assert.equal(actual.searchParams.get('digits'),'6');assert.equal(actual.searchParams.get('period'),'30');
  decodedImages++;checks+=5;
 }
 const html=enrollmentMarkup({secret,uri});assert(html.includes('<details class="mfa-manual">'));assert(!/<script|<img|https:\/\//.test(html));checks+=2;
 assert.throws(()=>enrollmentMarkup({secret:'WRONG',uri}));checks++;
}
for(const uri of ['https://example.test/qr','otpauth://totp/test?secret=INVALID','otpauth://totp/test?secret='+secret+'&algorithm=SHA1&digits=8&period=30']){assert.throws(()=>enrollmentQR(uri));checks++;}
const report={generatedAt:new Date().toISOString(),scope:'Synthetic test fixtures only; no live user keys or codes',decoder:'jsQR '+decoderRequire('jsqr/package.json').version,rasterizer:'sharp '+sharp.versions.sharp,checks,decodedImages,widths:[240,320,640],fixtures:['ASCII email','Unicode email','Long email'],result:'passed',phoneCameraScan:'not performed',browserLayout:'Chromium exited during startup before page open'};
const destination=path.resolve(process.argv[3]||'docs/proof/mfa-qr-2026-11-16/qr-decode.json');
await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
