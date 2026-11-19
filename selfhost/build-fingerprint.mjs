import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';
export async function sourceFingerprint(root=process.cwd()){
 const files=[];
 async function collect(relative){let info;try{info=await stat(path.join(root,relative))}catch(e){if(e.code==='ENOENT')return;throw e}if(info.isDirectory()){for(const name of (await readdir(path.join(root,relative))).sort())await collect(path.posix.join(relative,name))}else if(info.isFile()&&!relative.endsWith('.test.mjs'))files.push(relative)}
 for(const relative of ['app','components','lib','db','drizzle','selfhost','package.json','package-lock.json','release.json','next.config.ts','vite.config.ts','Dockerfile'])await collect(relative);
 const hash=createHash('sha256');for(const file of files.sort()){hash.update(file+'\0');hash.update(await readFile(path.join(root,file)));hash.update('\0')}
 return {algorithm:'SHA-256',fingerprint:hash.digest('hex'),sourceFiles:files.length};
}
