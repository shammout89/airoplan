import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {backupKey,captureFullBackup,verifyFullBackup,restoreFullBackup} from './full-backup.mjs';
import {normalizeBackupPolicy} from './backup-manager.mjs';
import {atomicJSON} from './full-backup.mjs';
import {localRuntime} from './runtime.mjs';
const [action,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw Error('استخدم --key-file و--archive و--target حسب الإجراء');options[args[i].slice(2)]=args[i+1]}
try{if(action==='init-key'){const file=options['key-file'];if(!file)throw Error('--key-file مطلوب');await mkdir(path.dirname(file),{recursive:true,mode:0o700});try{await writeFile(file,randomBytes(32).toString('base64')+'\n',{mode:0o600,flag:'wx',flush:true})}catch(e){if(e.code!=='EEXIST')throw e;await backupKey(file)}console.log(JSON.stringify({ok:true,keyFile:file,message:'المفتاح محفوظ؛ احتفظ بنسخة مستقلة آمنة. لم تُعرض قيمته.'}));}
else if(action==='init-destination'){if(!options.destination)throw Error('--destination مطلوب');await mkdir(options.destination,{recursive:true,mode:0o700});const file=path.join(options.destination,'.aeroplan-destination.json');let marker={format:'AeroPlan-destination-v1',id:randomUUID(),createdAt:new Date().toISOString()};try{await writeFile(file,JSON.stringify(marker),{flag:'wx',mode:0o600,flush:true})}catch(e){if(e.code!=='EEXIST')throw e;marker=JSON.parse(await readFile(file,'utf8'));if(marker.format!=='AeroPlan-destination-v1')throw Error('علامة وجهة غير صالحة')}console.log(JSON.stringify(marker))}
else if(action==='configure'){if(!options.policy)throw Error('--policy مطلوب');const policy=normalizeBackupPolicy(JSON.parse(await readFile(options.policy,'utf8'))),directory=path.resolve(process.env.AEROPLAN_DATA_DIR||'data');await atomicJSON(path.join(directory,'full-backup-policy.json'),policy);console.log(JSON.stringify({ok:true,policy}))}
else if(action==='verify')console.log(JSON.stringify(await verifyFullBackup(options.archive,options['key-file'])));
else if(action==='restore'){if(!options.archive||!options.target||!options['key-file'])throw Error('--archive و--key-file و--target مطلوبة');console.log(JSON.stringify(await restoreFullBackup(options.archive,options['key-file'],options.target)))}
else if(action==='capture'){const runtime=localRuntime();try{console.log(JSON.stringify(await captureFullBackup({db:runtime.db,dataDirectory:runtime.directory,destination:options.destination,keyFile:options['key-file']})))}finally{runtime.db.close()}}
else throw Error('الإجراءات: init-key، capture، verify، restore');}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1}
