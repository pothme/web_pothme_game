import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response as LocalResponse, convertV4MiniflareOptions } from 'miniflare';
import type { QuotesPayload } from '../shared/quotes';

test('quote fetch options run in Workerd and reject upstream redirects without following them', { timeout: 30_000 }, async () => {
  const bundled = await build({ stdin: { contents: "import {handleQuotes} from './server/quotes'; export default {fetch:handleQuotes};", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral' });
  const calls: string[] = [];
  const at = Date.now();
  const mf = new Miniflare(convertV4MiniflareOptions({
    port: 0, host: '127.0.0.1', cf: false, modules: true, compatibilityDate: '2026-11-04', script: bundled.outputFiles[0].text,
    outboundService: async request => {
      const host = new URL(request.url).hostname; calls.push(host);
      if (host === 'api.upbit.com') return new LocalResponse(JSON.stringify([{ market: 'KRW-BTC', trade_price: 105_000_000, signed_change_rate: 0.02, timestamp: at }]));
      if (host === 'api.bithumb.com') return new LocalResponse(JSON.stringify(new URL(request.url).pathname === '/v1/market/all' ? [{ market: 'KRW-BTC' }] : [{ market: 'KRW-BTC', trade_price: 104_000_000, signed_change_rate: -0.01, timestamp: at }]));
      if (host === 'data-api.binance.vision') return new LocalResponse(JSON.stringify([{ symbol: 'BTCUSDT', lastPrice: '70000', openPrice: '68000', closeTime: at }]));
      if (host === 'api.frankfurter.dev') return new LocalResponse(null, { status: 302, headers: { Location: 'https://untrusted.example/rate' } });
      throw new Error(`Unexpected upstream: ${host}`);
    },
  }));
  try {
    const response = await mf.dispatchFetch('https://office.example/api/quotes');
    const result = await response.json() as QuotesPayload;
    assert.equal(response.status, 200);
    assert.equal(result.sources.upbit.status, 'fresh');
    assert.equal(result.sources.bithumb.status, 'fresh');
    assert.equal(result.sources.binance.status, 'fresh');
    assert.equal(result.sources.fx.status, 'unavailable');
    assert.equal(result.coins[0].upbitKrw, 105_000_000);
    assert.equal(result.coins[0].bithumbKrw, 104_000_000);
    assert.equal(result.coins[0].premiumPercent, null);
    assert.deepEqual(calls.sort(), ['api.bithumb.com', 'api.bithumb.com', 'api.frankfurter.dev', 'api.upbit.com', 'data-api.binance.vision']);
    await mf.dispatchFetch('https://office.example/api/quotes');
    assert.equal(calls.length, 5, 'Worker cache must also retain initial provider failures and both Bithumb calls');
  } finally { await mf.dispose(); }
});
