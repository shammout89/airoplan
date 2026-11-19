import {fileURLToPath} from 'node:url';
import vinext from 'vinext';
import {defineConfig} from 'vite';

// Only the server-side Cloudflare bindings change; the business routes stay shared.
export default defineConfig({
  plugins: [vinext({
    rscOutDir: 'dist-node/server',
    ssrOutDir: 'dist-node/server/ssr',
    clientOutDir: 'dist-node/client',
  })],
  resolve: {alias: {'cloudflare:workers': fileURLToPath(new URL('./runtime.mjs', import.meta.url))}},
  build: {outDir: 'dist-node/client'},
  environments: {client: {build: {outDir: 'dist-node/client'}}},
});
