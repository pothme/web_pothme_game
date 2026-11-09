import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteService } from '../server/quotes';
import { getDomesticQuote, getDomesticUsdt, referencePremium, type QuotesPayload } from '../shared/quotes';

const START = Date.parse('2026-11-05T02:00:00Z');
const request = () => new Request('https://office.example/api/quotes');
const upbit = (at = START, price = 105_000_000) => [
  { market: 'KRW-BTC', trade_price: price, signed_change_rate: 0.02, acc_trade_price_24h: 15_000_000_000, timestamp: at },
  { market: 'KRW-USDT', trade_price: 1410, signed_change_rate: -0.005, acc_trade_price_24h: 100_000, timestamp: at },
];
const binance = (at = START, price = '70000') => [{ symbol: 'BTCUSDT', lastPrice: price, openPrice: '68000', quoteVolume: '10000000', closeTime: at }];
const bithumb = (at = START) => [
  { market: 'KRW-BTC', trade_price: 104_000_000, signed_change_rate: -0.01, acc_trade_price_24h: 11_000_000_000, timestamp: at },
  { market: 'KRW-USDT', trade_price: 1405, signed_change_rate: 0.001, acc_trade_price_24h: 90_000, timestamp: at },
];
const fx = { date: '2026-11-05', base: 'USD', quote: 'KRW', rate: 1400 };
function provider(url: string): 'upbit' | 'bithumb' | 'binance' | 'fx' { return url.includes('api.upbit.com') ? 'upbit' : url.includes('api.bithumb.com') ? 'bithumb' : url.includes('data-api.binance.vision') ? 'binance' : 'fx'; }
function mockFetch(handler: (source: ReturnType<typeof provider>, url: string, init?: RequestInit) => unknown | Promise<unknown>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).pathname === '/v1/market/all') return Response.json(bithumb().map(row => ({ market: row.market })));
    return new Response(JSON.stringify(await handler(provider(url), url, init)), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}
async function body(service: ReturnType<typeof createQuoteService>, req = request()): Promise<QuotesPayload> { return await (await service(req)).json() as QuotesPayload; }

test('premium calculation uses explicit USDT=USD reference FX and refuses invalid arithmetic', () => {
  assert.ok(Math.abs(referencePremium(105_000_000, 70_000, 1400)! - 7.14285714285714) < 1e-9);
  assert.equal(referencePremium(98_000_000, 70_000, 1400), 0);
  assert.ok(referencePremium(97_000_000, 70_000, 1400)! < 0);
  for (const value of [0, -1, NaN, Infinity, null]) {
    assert.equal(referencePremium(100, value, 1400), null);
    assert.equal(referencePremium(100, 5, value), null);
  }
});

test('quotes keep real USDT/KRW separate from the reference comparison and retain source timestamps', async () => {
  const service = createQuoteService({ now: () => START + 5_000, fetch: mockFetch(source => source === 'upbit' ? upbit() : source === 'binance' ? binance() : source === 'bithumb' ? bithumb() : fx) });
  const result = await body(service), btc = result.coins[0];
  assert.equal(btc.symbol, 'BTC');
  assert.equal(btc.referenceKrw, 98_000_000);
  assert.ok(Math.abs(btc.premiumPercent! - 7.14285714285714) < 1e-9);
  assert.equal(btc.upbitChangePercent, 2);
  assert.ok(Math.abs(btc.binanceChangePercent! - (70_000 / 68_000 - 1) * 100) < 1e-9);
  assert.equal(result.usdtKrw?.price, 1410);
  assert.equal(result.bithumbUsdtKrw?.price, 1405);
  assert.equal(btc.bithumbKrw, 104_000_000);
  assert.equal(btc.bithumbChangePercent, -1);
  assert.equal(btc.bithumbVolume24hKrw, 11_000_000_000);
  assert.ok(Math.abs(btc.bithumbPremiumPercent! - (104_000_000 / 98_000_000 - 1) * 100) < 1e-9);
  assert.equal(btc.bithumbAt, START);
  assert.equal(result.sources.bithumb.status, 'fresh');
  assert.equal(result.fx?.usdKrw, 1400);
  assert.equal(result.sources.upbit.dataAt, START);
  assert.equal(result.sources.upbit.fetchedAt, START + 5_000);
  assert.equal(result.sources.upbit.status, 'fresh');
});

test('an upstream outage preserves its original snapshot while other markets continue updating', async () => {
  let now = START, failUpbit = false;
  const calls = { upbit: 0, bithumb: 0, binance: 0, fx: 0 };
  const service = createQuoteService({ now: () => now, fetch: mockFetch(source => {
    calls[source]++;
    if (source === 'upbit' && failUpbit) throw new Error('upstream offline');
    return source === 'upbit' ? upbit(now) : source === 'binance' ? binance(now, now === START ? '70000' : '71000') : source === 'bithumb' ? bithumb(now) : fx;
  }) });
  await body(service);
  failUpbit = true; now += 61_000;
  const result = await body(service);
  assert.equal(result.sources.upbit.status, 'stale');
  assert.equal(result.sources.upbit.fetchedAt, START);
  assert.equal(result.coins[0].upbitAt, START);
  assert.equal(result.coins[0].upbitKrw, 105_000_000);
  assert.equal(result.coins[0].binanceUsdt, 71000);
  assert.equal(result.sources.binance.status, 'fresh');
  assert.equal(result.sources.binance.fetchedAt, now);
  assert.equal(calls.fx, 1, 'daily reference FX must not be refetched every minute');
});

test('one quiet coin does not make a freshly fetched provider or active BTC appear delayed', async () => {
  const quietAt = START - 10 * 60_000;
  const service = createQuoteService({ now: () => START, fetch: mockFetch(source => source === 'upbit' ? [
    ...upbit(), { ...upbit()[0], market: 'KRW-ATOM', trade_price: 3000, timestamp: quietAt },
  ] : source === 'binance' ? binance() : source === 'bithumb' ? bithumb() : fx) });
  const result = await body(service);
  assert.equal(result.sources.upbit.status, 'fresh');
  assert.equal(result.sources.upbit.fetchedAt, START);
  assert.equal(result.coins.find(coin => coin.symbol === 'BTC')?.upbitAt, START);
  assert.equal(result.coins.find(coin => coin.symbol === 'ATOM')?.upbitAt, quietAt, 'original per-coin age remains available for the UI');
  assert.equal(result.sources.upbit.dataAt, quietAt, 'oldest quote timestamp is informational, not provider health');
});

test('initial failures coalesce across concurrent requests and respect the 60-second cooldown', async () => {
  let now = START, fail = true;
  const calls = { upbit: 0, bithumb: 0, binance: 0, fx: 0 };
  const service = createQuoteService({ now: () => now, fetch: mockFetch(async source => {
    calls[source]++;
    await Promise.resolve();
    if (fail) throw new Error('upstream offline');
    return source === 'upbit' ? upbit(now) : source === 'binance' ? binance(now) : source === 'bithumb' ? bithumb(now) : fx;
  }) });
  const initial = await Promise.all(Array.from({ length: 12 }, () => body(service)));
  assert.deepEqual(calls, { upbit: 1, bithumb: 1, binance: 1, fx: 1 });
  assert.equal(initial[0].coins.length, 0);
  assert.equal(initial[0].sources.fx.status, 'unavailable');
  now += 59_999; await body(service);
  assert.deepEqual(calls, { upbit: 1, bithumb: 1, binance: 1, fx: 1 });
  fail = false; now += 1;
  const recovered = await body(service);
  assert.deepEqual(calls, { upbit: 2, bithumb: 2, binance: 2, fx: 2 });
  assert.equal(recovered.sources.upbit.status, 'fresh');
  assert.equal(recovered.coins.length, 1);
});

test('shared cache carries initial-failure cooldown to another Worker isolate', async () => {
  const saved = new Map<string, Response>();
  const cache = () => ({ match: async (key: Request) => saved.get(key.url)?.clone(), put: async (key: Request, value: Response) => { saved.set(key.url, value.clone()); } });
  let calls = 0;
  const unavailable = mockFetch(() => { calls++; throw new Error('offline'); });
  await body(createQuoteService({ now: () => START, fetch: unavailable, cache }));
  await body(createQuoteService({ now: () => START + 30_000, fetch: unavailable, cache }));
  assert.equal(calls, 4, 'second isolate should reuse all four recent failure records');
});

test('missing or malformed FX does not invent a premium or erase available exchange prices', async () => {
  const service = createQuoteService({ now: () => START, fetch: mockFetch(source => source === 'upbit' ? upbit() : source === 'binance' ? binance() : source === 'bithumb' ? bithumb() : { ...fx, base: 'EUR' }) });
  const result = await body(service);
  assert.equal(result.sources.fx.status, 'unavailable');
  assert.equal(result.fx, null);
  assert.equal(result.coins[0].upbitKrw, 105_000_000);
  assert.equal(result.coins[0].binanceUsdt, 70000);
  assert.equal(result.coins[0].referenceKrw, null);
  assert.equal(result.coins[0].premiumPercent, null);
  assert.equal(result.coins[0].bithumbKrw, 104_000_000);
  assert.equal(result.coins[0].bithumbPremiumPercent, null);
});

test('unknown currencies, zero prices and future timestamps are excluded from arithmetic', async () => {
  const service = createQuoteService({ now: () => START, fetch: mockFetch(source => source === 'upbit' ? [
    ...upbit(), { ...upbit()[0], market: 'BTC-ETH', trade_price: 1 },
    { ...upbit()[0], market: 'KRW-ETH', trade_price: 0 },
    { ...upbit()[0], market: 'KRW-XRP', timestamp: START + 900_000 },
    { ...upbit()[0], market: 'KRW-INJECT', trade_price: 100 },
  ] : source === 'binance' ? [...binance(), { ...binance()[0], symbol: 'ETHBTC' }] : source === 'bithumb' ? bithumb() : fx) });
  const result = await body(service);
  assert.deepEqual(result.coins.map(coin => coin.symbol), ['BTC']);
});

test('request parameters cannot choose upstream URLs, symbols or arbitrary currencies', async () => {
  const requested: string[] = [];
  const service = createQuoteService({ now: () => START, fetch: mockFetch((source, url) => { requested.push(url); return source === 'upbit' ? upbit() : source === 'binance' ? binance() : source === 'bithumb' ? bithumb() : fx; }) });
  const denied = await service(new Request('https://office.example/api/quotes', { method: 'POST' }));
  assert.equal(denied.status, 405); assert.equal(requested.length, 0);
  await body(service, new Request('https://office.example/api/quotes?url=https://evil.example&symbols=BAD&currency=EUR'));
  assert.deepEqual(requested.map(url => new URL(url).hostname).sort(), ['api.bithumb.com', 'api.frankfurter.dev', 'api.upbit.com', 'data-api.binance.vision']);
  assert.ok(requested.every(url => !url.includes('evil') && !url.includes('BAD') && !url.includes('EUR')));
});

test('a timed out source ends independently and returns the remaining price data', async () => {
  const service = createQuoteService({ now: () => START, timeoutMs: 10, fetch: mockFetch((source, _url, init) => {
    if (source === 'upbit') return new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
    return source === 'binance' ? binance() : source === 'bithumb' ? bithumb() : fx;
  }) });
  const result = await body(service);
  assert.equal(result.sources.upbit.status, 'unavailable');
  assert.equal(result.sources.binance.status, 'fresh');
  assert.equal(result.coins[0].upbitKrw, null);
  assert.equal(result.coins[0].premiumPercent, null);
  assert.equal(result.coins[0].binanceUsdt, 70000);
});

test('upstream failure diagnostics expose HTTP status but never response bodies or exception details', async () => {
  const service = createQuoteService({ now: () => START, fetch: (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (provider(url) === 'binance') return new Response('private upstream diagnostic must not leak', { status: 451 });
    if (provider(url) === 'upbit') throw new Error('sensitive network exception must not leak');
    return new Response(JSON.stringify(fx));
  }) as typeof fetch });
  const result = await body(service);
  assert.match(result.sources.binance.error!, /HTTP 451/);
  assert.match(result.sources.upbit.error!, /네트워크 연결 실패/);
  assert.doesNotMatch(JSON.stringify(result), /private|sensitive|must not leak/);
});

function withBithumb(handler: (url: URL, init?: RequestInit) => unknown | Promise<unknown>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const source = provider(url.href);
    const result = source === 'bithumb' ? await handler(url, init) : source === 'upbit' ? upbit() : source === 'binance' ? binance() : fx;
    return result instanceof Response ? result : Response.json(result);
  }) as typeof fetch;
}

test('Bithumb discovers only supported KRW pairs and keeps missing exchange quotes null', async () => {
  const requests: string[] = [];
  const service = createQuoteService({ now: () => START, fetch: withBithumb(url => {
    requests.push(url.href);
    if (url.pathname === '/v1/market/all') return [{ market: 'KRW-ETH' }, { market: 'KRW-USDT' }, { market: 'BTC-BTC' }, { market: 'KRW-INJECT' }, { market: 'KRW-ETH' }, { market: 'https://evil.example' }, null];
    assert.equal(url.searchParams.get('markets'), 'KRW-ETH,KRW-USDT');
    return [{ ...bithumb()[0], market: 'KRW-ETH', trade_price: 3_000_000 }, bithumb()[1], bithumb()[0]];
  }) });
  const result = await body(service), btc = result.coins.find(coin => coin.symbol === 'BTC')!, eth = result.coins.find(coin => coin.symbol === 'ETH')!;
  assert.equal(requests.length, 2);
  assert.equal(result.sources.bithumb.status, 'fresh');
  assert.equal(btc.bithumbKrw, null, 'unrequested ticker rows cannot fabricate a listed pair');
  assert.equal(btc.bithumbPremiumPercent, null);
  assert.equal(eth.bithumbKrw, 3_000_000);
  assert.equal(eth.upbitKrw, null);
  assert.equal(eth.binanceUsdt, null);
  assert.equal(eth.bithumbPremiumPercent, null);
  assert.deepEqual(getDomesticQuote(eth, 'bithumb'), { price: 3_000_000, changePercent: -1, volume24hKrw: 11_000_000_000, updatedAt: START, premiumPercent: null });
  assert.equal(getDomesticQuote(eth, 'upbit').price, null);
  assert.equal(getDomesticUsdt(result, 'upbit')?.price, 1410);
  assert.equal(getDomesticUsdt(result, 'bithumb')?.price, 1405);
  const legacy = { ...btc } as Partial<typeof btc>;
  delete legacy.bithumbKrw; delete legacy.bithumbChangePercent; delete legacy.bithumbAt; delete legacy.bithumbPremiumPercent; delete legacy.bithumbVolume24hKrw;
  assert.deepEqual(getDomesticQuote(legacy as typeof btc, 'bithumb'), { price: null, changePercent: null, volume24hKrw: null, updatedAt: null, premiumPercent: null });
  const legacyPayload = { ...result } as Partial<QuotesPayload>; delete legacyPayload.bithumbUsdtKrw;
  assert.equal(getDomesticUsdt(legacyPayload as QuotesPayload, 'bithumb'), null, 'an old response must not show Upbit USDT under Bithumb');
});

test('Bithumb market discovery and ticker calls coalesce and share a cache across Worker isolates', async () => {
  const saved = new Map<string, Response>();
  const cache = () => ({ match: async (key: Request) => saved.get(key.url)?.clone(), put: async (key: Request, value: Response) => { saved.set(key.url, value.clone()); } });
  let now = START;
  const paths: string[] = [];
  const fetch = withBithumb(async url => {
    paths.push(url.pathname); await Promise.resolve();
    return url.pathname === '/v1/market/all' ? bithumb().map(row => ({ market: row.market })) : bithumb(now);
  });
  const service = createQuoteService({ now: () => now, fetch, cache });
  const initial = await Promise.all(Array.from({ length: 20 }, () => body(service)));
  assert.equal(initial[0].sources.bithumb.status, 'fresh');
  assert.deepEqual(paths, ['/v1/market/all', '/v1/ticker']);
  now += 30_000;
  const otherIsolate = createQuoteService({ now: () => now, fetch, cache });
  const cached = await body(otherIsolate);
  assert.equal(paths.length, 2);
  assert.equal(cached.bithumbUsdtKrw?.price, 1405, 'shared cache accepts Bithumb USDT as well as curated coin rows');
  now += 30_000;
  await body(otherIsolate);
  assert.deepEqual(paths, ['/v1/market/all', '/v1/ticker', '/v1/market/all', '/v1/ticker']);
});

test('Bithumb HTTP-200 error, malformed tick and listing outage retain timestamps without leaking diagnostics', async () => {
  let now = START, mode = 'good';
  const service = createQuoteService({ now: () => now, fetch: withBithumb(url => {
    if (url.pathname === '/v1/market/all') {
      if (mode === 'listing-outage') return new Response('private listing diagnostic', { status: 503 });
      return bithumb().map(row => ({ market: row.market }));
    }
    if (mode === 'error') return { error: { name: 404, message: 'private application diagnostic' } };
    if (mode === 'malformed') return [{ ...bithumb(now)[0], timestamp: now + 900_000 }, bithumb(now)[1]];
    if (mode === 'missing') return [bithumb(now)[1]];
    return bithumb(now);
  }) });
  await body(service);
  for (mode of ['error', 'malformed', 'missing', 'listing-outage']) {
    now += 60_000;
    const result = await body(service);
    assert.equal(result.sources.bithumb.status, 'stale', mode);
    assert.equal(result.sources.bithumb.fetchedAt, START, mode);
    assert.equal(result.coins[0].bithumbAt, START, mode);
    assert.equal(result.coins[0].bithumbKrw, 104_000_000, mode);
    assert.equal(result.bithumbUsdtKrw?.updatedAt, START, mode);
    assert.equal(result.sources.upbit.status, 'fresh', mode);
    assert.doesNotMatch(JSON.stringify(result), /private|application diagnostic/);
  }
  mode = 'good'; now += 60_000;
  const recovered = await body(service);
  assert.equal(recovered.sources.bithumb.status, 'fresh');
  assert.equal(recovered.sources.bithumb.error, null);
  assert.equal(recovered.coins[0].bithumbAt, now);
});

test('Bithumb unavailable listings avoid an invalid ticker call and an actual delisting removes old quotes', async () => {
  let now = START, mode = 'error', ticks = 0;
  const service = createQuoteService({ now: () => now, fetch: withBithumb(url => {
    if (url.pathname === '/v1/market/all') return mode === 'error' ? { error: { name: 503 } } : mode === 'delisted' ? [{ market: 'KRW-USDT' }] : bithumb().map(row => ({ market: row.market }));
    ticks++;
    return mode === 'delisted' ? [bithumb(now)[1]] : bithumb(now);
  }) });
  const initial = await body(service);
  assert.equal(initial.sources.bithumb.status, 'unavailable');
  assert.equal(initial.coins[0].bithumbKrw, null);
  assert.equal(ticks, 0);
  mode = 'good'; now += 60_000;
  assert.equal((await body(service)).coins[0].bithumbKrw, 104_000_000);
  mode = 'delisted'; now += 60_000;
  const result = await body(service);
  assert.equal(result.sources.bithumb.status, 'fresh');
  assert.equal(result.coins[0].bithumbKrw, null, 'delisted quotes cannot survive a successful replacement snapshot');
  assert.equal(result.coins[0].bithumbAt, null);
  assert.equal(result.coins[0].bithumbPremiumPercent, null);
});

test('Bithumb uses documented UTC trade fields when live epoch fields contain a nine-hour offset', async () => {
  const now = Date.parse('2026-11-05T04:50:38.063Z');
  const service = createQuoteService({ now: () => now, fetch: withBithumb(url => url.pathname === '/v1/market/all' ? [{ market: 'KRW-BTC' }] : [{
    market: 'KRW-BTC', trade_date: '20261105', trade_time: '045036', trade_date_kst: '20261105', trade_time_kst: '135036',
    trade_timestamp: 1793886636209, timestamp: 1793886636209, trade_price: 108352000, signed_change_rate: 0.0182, acc_trade_price_24h: 77003258284.60806,
  }]) });
  const result = await body(service);
  assert.equal(result.sources.bithumb.status, 'fresh');
  assert.equal(result.coins[0].bithumbAt, Date.parse('2026-11-05T04:50:36Z'));
  assert.equal(result.coins[0].bithumbChangePercent, 1.82);
  assert.equal(result.sources.bithumb.fetchedAt, now);
});

test('Bithumb invalid or future UTC fields are rejected even if a second timestamp looks valid', async () => {
  for (const [trade_date, trade_time] of [['20260230', '020000'], ['20261105', '246000'], ['20261106', '020000'], ['20261105', 'bad'], ['20261105', undefined]]) {
    const service = createQuoteService({ now: () => START, fetch: withBithumb(url => url.pathname === '/v1/market/all' ? [{ market: 'KRW-BTC' }] : [{ ...bithumb()[0], trade_date, trade_time }]) });
    const result = await body(service);
    assert.equal(result.sources.bithumb.status, 'unavailable');
    assert.equal(result.coins[0].bithumbKrw, null);
  }
});
