import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response as LocalResponse, convertV4MiniflareOptions } from 'miniflare';
import type { UsageSnapshot } from '../shared/usage';

test('analytics uses native Workerd fetch without illegal receiver errors and retains one upstream batch', { timeout: 30_000 }, async () => {
 const bundled = await build({ stdin: { contents: "import {UsageMonitor} from './server/usage'; const env={CLOUDFLARE_ACCOUNT_ID:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',CLOUDFLARE_ANALYTICS_TOKEN:'local-native-fetch-fixture-only'}; const monitor=new UsageMonitor(env); export default {async fetch(request){const selected=new URL(request.url).pathname==='/redirect'?new UsageMonitor(env):monitor;return Response.json(await selected.get());}};", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral' });
 let calls = 0, redirect = false;
 const mf = new Miniflare(convertV4MiniflareOptions({ port: 0, host: '127.0.0.1', cf: false, modules: true, compatibilityDate: '2026-11-04', script: bundled.outputFiles[0].text, outboundService: async request => {
   calls++; assert.equal(new URL(request.url).hostname, 'api.cloudflare.com');
   if (redirect) return new LocalResponse(null, { status: 302, headers: { Location: 'https://untrusted-fixture.invalid/collect' } });
   const { query } = await request.json() as { query: string };
   const row = query.includes('Periodic') ? { sum: { duration: 0.25, rowsRead: 467, rowsWritten: 83, inboundWebsocketMsgCount: 0, outboundWebsocketMsgCount: 964 } }
     : query.includes('SqlStorage') ? { max: { storedBytes: 126976 } }
     : query.includes('InvocationsAdaptiveGroups') ? { dimensions: { type: 'hibernation' }, sum: { requests: 400, responseBodySize: 0 } }
     : query.includes('dimensions') ? { dimensions: { scriptName: 'local-native-fixture' }, sum: { requests: 487, errors: 0, subrequests: 1 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 2000 } }
     : { sum: { requests: 487 } };
   return new LocalResponse(JSON.stringify({ data: { viewer: { accounts: [{ rows: [row] }] } }, errors: null }), { headers: { 'Content-Type': 'application/json' } });
 } }));
 try {
   const result = await mf.dispatchFetch('https://local-fixture.test/api/admin/usage').then(response => response.json()) as UsageSnapshot;
   assert.equal(result.status, 'ready'); assert.equal(calls, 5); assert.equal(result.metrics.find(metric => metric.id === 'doRequests')!.used, 20); assert.equal(result.metrics.find(metric => metric.id === 'storage')!.used, 126976);
   assert.equal(JSON.stringify(result).includes('local-native-fetch-fixture-only'), false);
   await mf.dispatchFetch('https://local-fixture.test/api/admin/usage'); assert.equal(calls, 5);
   redirect = true; const rejected = await mf.dispatchFetch('https://local-fixture.test/redirect').then(response => response.json()) as UsageSnapshot;
   assert.equal(rejected.status, 'unavailable'); assert.equal(calls, 10, 'redirects are never followed or sent the account token');
 } finally { await mf.dispose(); }
});
