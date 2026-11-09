import { CURATED_MARKETS, MARKET_FILTERS, searchMarkets, type MarketFilter, type MarketSymbol } from '../shared/market-catalog';
const ENDPOINT = 'https://data-api.binance.vision/api/v3/exchangeInfo';
let cached: MarketSymbol[] | null = null, expiresAt = 0, pending: Promise<MarketSymbol[]> | null = null;
export function parseBinanceMarkets(body: unknown): MarketSymbol[] {
  const symbols = body && typeof body === 'object' ? (body as { symbols?: unknown }).symbols : null;
  if (!Array.isArray(symbols)) throw new Error('Invalid exchange catalog');
  return symbols.filter((value) => value && value.status === 'TRADING' && value.quoteAsset === 'USDT' && value.isSpotTradingAllowed === true && /^[A-Z0-9]{2,25}USDT$/.test(value.symbol) && /^[A-Z0-9]{2,25}$/.test(value.baseAsset)).slice(0, 3000).map((value) => ({ symbol: `BINANCE:${value.symbol}`, name: `${value.baseAsset} / USDT`, kind: 'crypto', exchange: 'BINANCE' }));
}
async function binanceMarkets(): Promise<MarketSymbol[]> {
  if (cached && Date.now() < expiresAt) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const cache = caches.default;
      const request = new Request(ENDPOINT);
      let response = await cache.match(request);
      if (!response) {
        response = await fetch(request, { signal: AbortSignal.timeout(4500) });
        if (!response.ok) throw new Error('Catalog unavailable');
        const body = await response.text();
        const markets = parseBinanceMarkets(JSON.parse(body));
        await cache.put(request, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=3600' } }));
        cached = markets;
      } else cached = parseBinanceMarkets(await response.json());
      expiresAt = Date.now() + 3_600_000;
    } catch { expiresAt = Date.now() + 60_000; cached ??= []; }
    return cached!;
  })().finally(() => { pending = null; });
  return pending;
}
export async function findMarket(symbol: unknown): Promise<MarketSymbol | null> {
  if (typeof symbol !== 'string' || !/^[A-Z]{2,10}:[A-Z0-9.]{1,30}$/.test(symbol)) return null;
  return CURATED_MARKETS.find((market) => market.symbol === symbol) ?? (symbol.startsWith('BINANCE:') ? (await binanceMarkets()).find((market) => market.symbol === symbol) ?? null : null);
}
export async function findMarkets(query: string, kind = 'all'): Promise<MarketSymbol[]> {
  if (!MARKET_FILTERS.includes(kind as MarketFilter)) return [];
  const curated = searchMarkets(CURATED_MARKETS, query, kind);
  if (!query.trim() || curated.length || (kind !== 'all' && kind !== 'crypto')) return curated;
  return searchMarkets(await binanceMarkets(), query, kind);
}
