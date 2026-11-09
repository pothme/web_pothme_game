import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserBinanceFallback } from '../src/markets-browser-quotes';
import { BINANCE_PUBLIC_QUOTES_URL, type QuotesPayload } from '../shared/quotes';

const START = Date.parse('2026-11-05T02:00:00Z');
function server(at = START): QuotesPayload {
  return {
    generatedAt: at, refreshSeconds: 60,
    sources: {
      upbit: { status: 'fresh', fetchedAt: at, dataAt: at, error: null },
      bithumb: { status: 'fresh', fetchedAt: at, dataAt: at, error: null },
      binance: { status: 'unavailable', fetchedAt: null, dataAt: null, error: 'HTTP 403' },
      fx: { status: 'fresh', fetchedAt: at, dataAt: at, error: null },
    },
    fx: { usdKrw: 1400, date: '2026-11-05' }, usdtKrw: null, bithumbUsdtKrw: { price: 1405, changePercent: 0.1, updatedAt: at },
    coins: [{ symbol: 'BTC', name: '비트코인', upbitKrw: 105_000_000, bithumbKrw: 104_000_000, binanceUsdt: null, referenceKrw: null, premiumPercent: null, bithumbPremiumPercent: null, upbitChangePercent: 1, bithumbChangePercent: -1, binanceChangePercent: null, upbitVolume24hKrw: 1_000_000, bithumbVolume24hKrw: 2_000_000, upbitAt: at, bithumbAt: at, binanceAt: null }],
  };
}
const ticks = (at = START) => [{ symbol: 'BTCUSDT', lastPrice: '70000', openPrice: '68000', closeTime: at }];

test('browser fallback merges real Binance quotes with server Upbit/FX and labels its original timestamp', async () => {
  const feed = createBrowserBinanceFallback({ now: () => START + 5_000, fetch: (async (url, init) => {
    assert.equal(url, BINANCE_PUBLIC_QUOTES_URL);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.mode, 'cors');
    assert.equal(init?.headers, undefined, 'no origin, authentication or proxy headers are injected');
    return new Response(JSON.stringify(ticks()));
  }) });
  const input = server(), result = await feed.apply(input);
  assert.equal(result.coins[0].binanceUsdt, 70000);
  assert.equal(result.coins[0].referenceKrw, 98_000_000);
  assert.ok(Math.abs(result.coins[0].premiumPercent! - 7.14285714285714) < 1e-9);
  assert.equal(result.sources.binance.via, 'browser');
  assert.equal(result.sources.binance.status, 'fresh');
  assert.equal(result.sources.binance.fetchedAt, START + 5_000);
  assert.equal(result.coins[0].binanceAt, START);
  assert.equal(result.coins[0].upbitAt, START);
  assert.equal(result.coins[0].bithumbAt, START);
  assert.equal(result.coins[0].bithumbKrw, 104_000_000);
  assert.equal(result.coins[0].bithumbChangePercent, -1);
  assert.equal(result.coins[0].bithumbVolume24hKrw, 2_000_000);
  assert.ok(Math.abs(result.coins[0].bithumbPremiumPercent! - (104_000_000 / 98_000_000 - 1) * 100) < 1e-9);
  assert.deepEqual(result.bithumbUsdtKrw, input.bithumbUsdtKrw);
  assert.equal(input.coins[0].binanceUsdt, null, 'server response is not mutated');
});

test('healthy server cache avoids browser upstream requests entirely', async () => {
  const feed = createBrowserBinanceFallback({ now: () => START, fetch: (async () => { throw new Error('must not fetch'); }) });
  const input = server(); input.sources.binance = { status: 'fresh', fetchedAt: START, dataAt: START, error: null };
  assert.equal(await feed.apply(input), input);
});

test('initial browser failures coalesce and remain unavailable until the 60-second retry window', async () => {
  let now = START, calls = 0;
  const feed = createBrowserBinanceFallback({ now: () => now, fetch: (async () => { calls++; return new Response('no access', { status: 403 }); }) });
  const results = await Promise.all(Array.from({ length: 10 }, () => feed.apply(server())));
  assert.equal(calls, 1);
  assert.equal(results[0].sources.binance.status, 'unavailable');
  assert.equal(results[0].coins[0].binanceUsdt, null);
  assert.equal(results[0].coins[0].premiumPercent, null);
  assert.match(results[0].sources.binance.error!, /HTTP 403/);
  now += 59_999; await feed.apply(server(now)); assert.equal(calls, 1);
  now += 1; await feed.apply(server(now)); assert.equal(calls, 2);
});

test('failed browser refresh retains last real prices and timestamp while recomputing against new server prices', async () => {
  let now = START, fails = false;
  const feed = createBrowserBinanceFallback({ now: () => now, fetch: (async () => {
    if (fails) throw new Error('Network failed');
    return new Response(JSON.stringify(ticks()));
  }) });
  await feed.apply(server()); fails = true; now += 61_000;
  const freshServer = server(now); freshServer.coins[0].upbitKrw = 98_000_000;
  freshServer.coins[0].bithumbKrw = 97_000_000;
  const result = await feed.apply(freshServer);
  assert.equal(result.sources.binance.status, 'stale');
  assert.equal(result.sources.binance.fetchedAt, START);
  assert.equal(result.coins[0].binanceAt, START);
  assert.equal(result.coins[0].upbitAt, now);
  assert.equal(result.coins[0].binanceUsdt, 70000);
  assert.equal(result.coins[0].premiumPercent, 0);
  assert.ok(result.coins[0].bithumbPremiumPercent! < 0);
  assert.equal(result.coins[0].bithumbAt, now);
  assert.equal(result.sources.upbit.status, 'fresh');
});

test('browser data validation excludes unknown symbols, wrong currencies, zero and future quotes', async () => {
  const feed = createBrowserBinanceFallback({ now: () => START, fetch: (async () => new Response(JSON.stringify([
    ...ticks(), { ...ticks()[0], symbol: 'EVILUSDT' }, { ...ticks()[0], symbol: 'ETHBTC' },
    { ...ticks()[0], symbol: 'ETHUSDT', lastPrice: '0' },
    { ...ticks()[0], symbol: 'XRPUSDT', closeTime: START + 900_000 },
    { ...ticks()[0], symbol: 'ADAUSDT', lastPrice: 'Infinity' },
  ]))) });
  const input = server(); input.fx = null;
  const result = await feed.apply(input);
  assert.deepEqual(result.coins.map(coin => coin.symbol), ['BTC']);
  assert.equal(result.coins[0].binanceUsdt, 70000);
  assert.equal(result.coins[0].referenceKrw, null);
  assert.equal(result.coins[0].premiumPercent, null);
});

test('browser request timeout preserves the server partial response without fabricating Binance data', async () => {
  const feed = createBrowserBinanceFallback({ now: () => START, timeoutMs: 10, fetch: ((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })) });
  const result = await feed.apply(server());
  assert.equal(result.coins[0].upbitKrw, 105_000_000);
  assert.equal(result.coins[0].binanceUsdt, null);
  assert.match(result.sources.binance.error!, /시간 초과/);
  feed.dispose();
});

test('browser fallback preserves a Bithumb-only coin without inventing a Binance pair or premium', async () => {
  const feed = createBrowserBinanceFallback({ now: () => START, fetch: async () => Response.json(ticks()) });
  const input = server();
  input.coins.push({ ...input.coins[0], symbol: 'ETH', name: '이더리움', upbitKrw: null, upbitAt: null, upbitChangePercent: null, upbitVolume24hKrw: null, bithumbKrw: 3_000_000 });
  const result = await feed.apply(input), eth = result.coins.find(coin => coin.symbol === 'ETH')!;
  assert.equal(eth.bithumbKrw, 3_000_000);
  assert.equal(eth.bithumbAt, START);
  assert.equal(eth.binanceUsdt, null);
  assert.equal(eth.bithumbPremiumPercent, null);
  assert.equal(eth.referenceKrw, null);
  assert.deepEqual(result.sources.bithumb, input.sources.bithumb);
  feed.dispose();
});
