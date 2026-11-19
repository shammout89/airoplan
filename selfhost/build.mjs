import {rm,writeFile} from 'node:fs/promises';
import {sourceFingerprint} from './build-fingerprint.mjs';
import {randomBytes} from 'node:crypto';

process.env.NODE_ENV='production';
process.env.__VINEXT_SHARED_BUILD_ID=randomBytes(16).toString('hex');
process.env.__VINEXT_SHARED_REVALIDATE_SECRET=randomBytes(32).toString('hex');
await rm('dist-node',{recursive:true,force:true});
const {createBuilder}=await import('vite');
await (await createBuilder({configFile:'selfhost/vite.config.ts',mode:'production'})).buildApp();

await writeFile('dist-node/build-fingerprint.json',JSON.stringify(await sourceFingerprint())+'\n');
