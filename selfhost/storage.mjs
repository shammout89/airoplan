import {AuditIntegrity} from './audit-integrity.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {readFile,writeFile,rename,open} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const plain=row=>row?Object.fromEntries(Object.entries(row)):null;
const binding=value=>{if(value===undefined)throw Error('Undefined SQL binding');if(typeof value==='boolean')return Number(value);if(value instanceof ArrayBuffer)return new Uint8Array(value);return value};
class LocalStatement{
 constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args}
 bind(...args){return new LocalStatement(this.db,this.sql,args.map(binding))}
 _execute(mode='all'){
  if(mode==='run'&&!this.db.sqlite.isTransaction)this.db.auditIntegrity?.checkpoint();const statement=this.db.sqlite.prepare(this.sql),start=performance.now();
  if(mode==='raw'){statement.setReturnArrays(true);return statement.all(...this.args)}
  if(mode==='first')return plain(statement.get(...this.args));
  const before=this.db.sqlite.prepare('SELECT total_changes() n').get().n;
  const result=statement.all(...this.args).map(plain);
  const after=this.db.sqlite.prepare('SELECT total_changes() n').get().n;if(mode==='run'&&!this.db.sqlite.isTransaction)this.db.auditCheckpointAfterCommit();
  const last=this.db.sqlite.prepare('SELECT last_insert_rowid() n').get().n;
  return {success:true,results:result,meta:{changes:Number(after-before),last_row_id:Number(last),duration:performance.now()-start,rows_read:result.length,rows_written:Number(after-before),changed_db:after!==before}};
 }
 async all(){return this._execute()}
 async run(){return this._execute('run')}
 async first(column){const row=this._execute('first');if(column===undefined)return row;if(row&&!Object.hasOwn(row,column))throw Error('Column not found');return row?.[column]??null}
 async raw(options){const values=this._execute('raw');if(options?.columnNames){const statement=this.db.sqlite.prepare(this.sql);return [statement.columns().map(c=>c.name),...values]}return values}
}
export class LocalDatabase{
 constructor(filename){mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});this.filename=filename;this.sqlite=new DatabaseSync(filename,{timeout:5000});this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');chmodSync(filename,0o600);if(AuditIntegrity.exists(this.sqlite))new AuditIntegrity(this)}
 prepare(sql){return new LocalStatement(this,sql)}
 auditCheckpointAfterCommit(){try{this.auditIntegrity?.checkpoint()}catch(e){this.auditIntegrity.lastError=String(e.message);console.error('Audit anchor update failed; the signed database commit was retained')}}
 async batch(statements){this.auditIntegrity?.checkpoint();this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>{if(statement.db!==this)throw Error('Mixed database batch');return statement._execute()});this.sqlite.exec('COMMIT');this.auditCheckpointAfterCommit();return results}catch(error){if(this.sqlite.isTransaction)this.sqlite.exec('ROLLBACK');throw error}}
 async exec(sql){const start=performance.now();this.auditIntegrity?.checkpoint();this.sqlite.exec(sql);if(!this.sqlite.isTransaction)this.auditCheckpointAfterCommit();return {count:1,duration:performance.now()-start}}
 withSession(){return this}
 close(){this.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.sqlite.close()}
}
async function bodyBytes(value){if(typeof value==='string')return Buffer.from(value);if(value instanceof ArrayBuffer)return new Uint8Array(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);if(value?.arrayBuffer)return new Uint8Array(await value.arrayBuffer());if(value?.getReader){const reader=value.getReader(),parts=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16*1024*1024){await reader.cancel();throw Error('Object exceeds 16 MiB')}parts.push(r.value)}return Buffer.concat(parts)}throw Error('Unsupported object body')}
export class LocalBucket{
 constructor(db,directory){this.db=db;this.directory=directory;mkdirSync(directory,{recursive:true,mode:0o700});db.sqlite.exec('CREATE TABLE IF NOT EXISTS _local_objects(key TEXT PRIMARY KEY,blob TEXT NOT NULL,size INTEGER NOT NULL,etag TEXT NOT NULL,uploaded TEXT NOT NULL,http TEXT NOT NULL,custom TEXT NOT NULL)')}
 _key(key){if(typeof key!=='string'||!key||Buffer.byteLength(key)>1024||key.includes('\0'))throw Error('Invalid object key');return key}
 async put(key,value,options={}){this._key(key);const bytes=await bodyBytes(value);if(bytes.byteLength>16*1024*1024)throw Error('Object exceeds 16 MiB');const blob=randomUUID(),file=path.join(this.directory,blob),temp=file+'.tmp',etag=createHash('sha256').update(bytes).digest('hex'),uploaded=new Date().toISOString(),http=JSON.stringify(options.httpMetadata||{}),custom=JSON.stringify(options.customMetadata||{});if(http.length+custom.length>32768)throw Error('Object metadata too large');await writeFile(temp,bytes,{mode:0o600,flag:'wx',flush:true});await rename(temp,file);const handle=await open(this.directory,'r');try{await handle.sync()}finally{await handle.close()}this.db.sqlite.prepare('INSERT INTO _local_objects(key,blob,size,etag,uploaded,http,custom) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET blob=excluded.blob,size=excluded.size,etag=excluded.etag,uploaded=excluded.uploaded,http=excluded.http,custom=excluded.custom').run(key,blob,bytes.byteLength,etag,uploaded,http,custom);return this.head(key)}
 _row(key){return this.db.sqlite.prepare('SELECT * FROM _local_objects WHERE key=?').get(this._key(key))}
 _metadata(row){if(!row)return null;return {key:row.key,size:row.size,etag:row.etag,httpEtag:'"'+row.etag+'"',uploaded:new Date(row.uploaded),httpMetadata:JSON.parse(row.http),customMetadata:JSON.parse(row.custom),writeHttpMetadata(headers){const fields={contentType:'Content-Type',contentLanguage:'Content-Language',contentDisposition:'Content-Disposition',contentEncoding:'Content-Encoding',cacheControl:'Cache-Control'};for(const [k,h] of Object.entries(fields))if(this.httpMetadata[k])headers.set(h,this.httpMetadata[k])}}}
 async head(key){return this._metadata(this._row(key))}
 async get(key){const row=this._row(key);if(!row)return null;const file=path.join(this.directory,row.blob),metadata=this._metadata(row),bytes=await readFile(file);if(bytes.byteLength!==row.size||createHash('sha256').update(bytes).digest('hex')!==row.etag)throw Error('Stored object integrity check failed');return {...metadata,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),text:async()=>bytes.toString('utf8'),json:async()=>JSON.parse(bytes.toString('utf8')),blob:async()=>new Blob([bytes],{type:metadata.httpMetadata.contentType}),body:new Blob([bytes]).stream()}}
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.db.sqlite.prepare('DELETE FROM _local_objects WHERE key=?').run(this._key(key));/* Replaced/unreferenced blobs are retained until offline maintenance; never delete an in-flight reader's file. */}
 async list(options={}){const limit=Math.min(1000,Math.max(1,options.limit||1000)),after=options.cursor?Buffer.from(options.cursor,'base64url').toString():options.startAfter||'',prefix=options.prefix||'';const rows=this.db.sqlite.prepare('SELECT * FROM _local_objects WHERE key>? AND substr(key,1,?)=? ORDER BY key LIMIT ?').all(after,prefix.length,prefix,limit+1);return {objects:rows.slice(0,limit).map(r=>this._metadata(r)),truncated:rows.length>limit,cursor:rows.length>limit?Buffer.from(rows[limit-1].key).toString('base64url'):undefined,delimitedPrefixes:[]}}
}
