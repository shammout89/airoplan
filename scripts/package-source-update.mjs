// Package committed source against explicitly supplied, locally verified release archives.
// Runtime files are never part of an in-place update. No archive is downloaded by this script.
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';

const [output,...baselines]=process.argv.slice(2);
if(!output||!baselines.length)throw Error('Usage: node scripts/package-source-update.mjs OUTPUT_DIR BASELINE_ZIP...');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim(),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
if(git('status','--porcelain','--untracked-files=normal'))throw Error('Commit all verified source and documentation before packaging');
if(git('ls-files','--stage').split('\n').some(line=>line.startsWith('120000 ')))throw Error('Symlinks cannot be shipped in a source release');
const commit=git('rev-parse','HEAD'),prefix='AeroPlan-Docker/',fullBytes=execFileSync('git',['archive','--format=zip','--prefix='+prefix,commit],{maxBuffer:64*1024*1024});
function source(bytes){const entries=unzipSync(new Uint8Array(bytes)),result={};for(const [name,value] of Object.entries(entries)){if(name.endsWith('/'))continue;if(!name.startsWith(prefix)||name.includes('..')||name.includes('\\')||name.includes('\0'))throw Error('Unsafe source archive path');result[name.slice(prefix.length)]=value;}return result;}
const current=source(fullBytes),release=JSON.parse(strFromU8(current['release.json'])).version;
const protectedPath=file=>file==='compose.yaml'||/^compose\.(production|backup|services|full-restore)\.yaml$/.test(file)||file==='Start-AeroPlan-Restored.ps1'||file==='backup-policy.json'||file==='full-backup-policy.json'||(/^\.env(?:$|\.)/.test(file)&&file!=='.env.example')||/^(data|secrets|node_modules|\.sites-runtime|qa-data)\//.test(file);
if(Object.keys(current).some(file=>/^(data|secrets|node_modules|\.sites-runtime)\//.test(file)||/\.(key|pem|sqlite|apbackup)$/.test(file)||/^\.env(?:$|\.)/.test(file)&&file!=='.env.example'))throw Error('Runtime data/secrets must never be tracked in a release');
const paths=new Set(),baseArchives=[];
for(const archive of baselines){const bytes=await readFile(archive),old=source(bytes),version=JSON.parse(strFromU8(old['release.json'])).version;if(baseArchives.some(b=>b.release===version))throw Error('Duplicate baseline release');
 const deleted=Object.keys(old).filter(file=>!Object.hasOwn(current,file)&&!protectedPath(file));if(deleted.length)throw Error('Deletion-aware upgrade needed: '+deleted.join(', '));
 for(const [file,value] of Object.entries(current))if(!protectedPath(file)&&(!old[file]||sha(value)!==sha(old[file])))paths.add(file);
 baseArchives.push({release:version,sha256:sha(bytes)});
}
const files=[...paths].sort().map(file=>({path:file,sha256:sha(current[file]),bytes:current[file].length})),entries=Object.fromEntries(files.map(file=>[file.path,current[file.path]]));
entries['UPDATE_MANIFEST.json']=strToU8(JSON.stringify({release,sourceCommit:commit,compatibleSourceVersions:baseArchives.map(b=>b.release),baseArchives,files,protected:['compose.yaml','.env* except .env.example','data/','secrets/','generated Compose overlays','backup policies','Start-AeroPlan-Restored.ps1']},null,2)+'\n');
const directory=path.resolve(output);await mkdir(directory,{recursive:true});
const full=path.join(directory,`AeroPlan-Docker-${release}.zip`),patch=path.join(directory,`AeroPlan-Update-${release}.zip`),patchBytes=zipSync(entries,{level:9});await writeFile(full,fullBytes);await writeFile(patch,patchBytes);
const result={release,sourceCommit:commit,compatibleSourceVersions:baseArchives.map(b=>b.release),patchFiles:files.length,full:{path:full,bytes:fullBytes.length,sha256:sha(fullBytes)},patch:{path:patch,bytes:patchBytes.length,sha256:sha(patchBytes)}};
await writeFile(path.join(directory,`AeroPlan-${release}-package-manifest.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
