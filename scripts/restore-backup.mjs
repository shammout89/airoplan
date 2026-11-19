// Restores only into a new disposable D1 database. Never accepts a production binding.
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export async function verifyIsolated(snapshot,options={}){
 await mkdir('.sites-runtime',{recursive:true});
 await build({entryPoints:['lib/backup-format.ts'],outfile:'.sites-runtime/backup-format.mjs',bundle:true,platform:'node',format:'esm'});
 const {validateSnapshot,backupTables,tableDigest,orderedRows}=await import('../.sites-runtime/backup-format.mjs');
 const source=await validateSnapshot(snapshot);const started=Date.now();
 const isolated=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("isolated")}}',d1Databases:['RESTORED'],r2Buckets:['FILES'],cf:false}));
 try{const db=await isolated.getD1Database('RESTORED');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()){for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run()}
 for(const table of Object.keys(snapshot.tables)){const spec=backupTables[table],rows=snapshot.tables[table];for(let i=0;i<rows.length;i+=50)await db.batch(rows.slice(i,i+50).map(row=>db.prepare(`INSERT INTO ${table}(${spec.columns.join(',')}) VALUES(${spec.columns.map(()=>'?').join(',')})`).bind(...spec.columns.map(c=>row[c]))))}
 const recovered={};for(const table of Object.keys(snapshot.tables)){const spec=backupTables[table];recovered[table]=(await db.prepare(`SELECT ${spec.columns.join(',')} FROM ${table}`).all()).results;if(await tableDigest(table,recovered[table])!==source.tableDigests[table])throw Error('Restored digest mismatch: '+table)}
 // Revalidate relationships and calculated balances after reading the independent database.
 for(const t of Object.keys(recovered))recovered[t]=orderedRows(t,recovered[t]);await validateSnapshot({...snapshot,tables:recovered},snapshot.workspaceId,snapshot.digest);
 const bucket=await isolated.getR2Bucket('FILES');const {createHash}=await import('node:crypto');for(const f of snapshot.files||[]){if(!/^[a-f0-9-]{36}$/.test(f.versionId))throw Error('Invalid file id');const bytes=options.fileLoader?await options.fileLoader(f):await readFile(options.filesDirectory+'/'+f.versionId);const hash=createHash('sha256').update(new Uint8Array(bytes)).digest('hex');if(hash!==f.digest||bytes.byteLength!==f.size)throw Error('Attachment mismatch');await bucket.put(f.sourceKey,bytes);const restored=await (await bucket.get(f.sourceKey)).arrayBuffer();if(createHash('sha256').update(new Uint8Array(restored)).digest('hex')!==f.digest)throw Error('Restored attachment mismatch')}

 const report={ok:true,isolation:'independent disposable D1 database',rows:source.totalRows,tables:Object.keys(snapshot.tables).length,files:(snapshot.files||[]).length,digest:snapshot.digest,durationMs:Date.now()-started};console.log(JSON.stringify(report));return report;
 }finally{await isolated.dispose()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(!process.argv[2])throw Error('Usage: node scripts/restore-backup.mjs <snapshot.json>');await verifyIsolated(JSON.parse(await readFile(process.argv[2],'utf8')),{filesDirectory:process.argv[3]||process.argv[2]+'.files'})}
