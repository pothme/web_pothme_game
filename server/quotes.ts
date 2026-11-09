import { BINANCE_PUBLIC_QUOTES_URL, QUOTE_COINS, referencePremium, type CoinQuote, type QuotesPayload, type QuoteSourceName, type QuoteSourceState } from '../shared/quotes';

type JsonRecord = Record<string, unknown>;
interface ExchangeQuote { price: number; changePercent: number | null; volume24h: number | null; updatedAt: number }
type ExchangeData = Record<string, ExchangeQuote>;
interface FxData { usdKrw: number; date: string }
interface Snapshot { data: ExchangeData | FxData; fetchedAt: number; attemptedAt: number; error: string | null }
interface QuoteCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<unknown> }
interface QuoteServiceOptions {
  fetch?: typeof fetch;
  now?: () => number;
  cache?: () => QuoteCache | undefined;
  timeoutMs?: number;
}

const PRICE_REFRESH_MS = 60_000;
const FX_REFRESH_MS = 3_600_000;
const RETAIN_MS = 7 * 86_400_000;
const SYMBOLS = new Set<string>(QUOTE_COINS.map(([symbol]) => symbol));
const BINANCE_SYMBOLS = new Set(QUOTE_COINS.map(([symbol]) => `${symbol}USDT`));
const URLS: Record<QuoteSourceName, string> = {
  upbit: 'https://api.upbit.com/v1/ticker/all?quote_currencies=KRW',
  bithumb: 'https://api.bithumb.com/v1/ticker',
  // Official market-data-only host: no API keys, account or order endpoints.
  binance: BINANCE_PUBLIC_QUOTES_URL,
  fx: 'https://api.frankfurter.dev/v2/rate/USD/KRW',
};
const BITHUMB_MARKETS_URL = 'https://api.bithumb.com/v1/market/all?isDetails=false';
const SOURCE_LABELS = { upbit: '업비트', bithumb: '빗썸', binance: '바이낸스', fx: '환율' };

function record(value: unknown): value is JsonRecord { return !!value && typeof value === 'object' && !Array.isArray(value); }
function number(value: unknown, positive = false): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const result = Number(value);
  return Number.isFinite(result) && (!positive || result > 0) ? result : null;
}
function timestamp(value: unknown, now: number): number | null {
  const result = number(value, true);
  return result !== null && result >= 1_420_070_400_000 && result <= now + 300_000 ? result : null;
}
function bithumbTimestamp(row: JsonRecord, now: number): number | null {
  // The documented UTC trade date/time remains unambiguous even when Bithumb's
  // Unix timestamp is emitted with a KST offset (observed in the live REST API).
  // Parse those source fields, never subtract a guessed offset or use receipt time.
  if (row.trade_date !== undefined || row.trade_time !== undefined) {
    if (typeof row.trade_date !== 'string' || !/^\d{8}$/.test(row.trade_date) || typeof row.trade_time !== 'string' || !/^\d{6}$/.test(row.trade_time)) return null;
    const d = row.trade_date, t = row.trade_time;
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.000Z`;
    const at = Date.parse(iso);
    return Number.isFinite(at) && new Date(at).toISOString() === iso ? timestamp(at, now) : null;
  }
  return timestamp(row.timestamp, now);
}
function parseDomestic(value: unknown, now: number, source: 'upbit' | 'bithumb'): ExchangeData {
  if (!Array.isArray(value)) throw new Error('잘못된 시세 응답');
  const data: ExchangeData = {};
  for (const row of value) {
    if (!record(row) || typeof row.market !== 'string' || !row.market.startsWith('KRW-')) continue;
    const symbol = row.market.slice(4);
    if (!SYMBOLS.has(symbol) && symbol !== 'USDT') continue;
    const price = number(row.trade_price, true), updatedAt = source === 'bithumb' ? bithumbTimestamp(row, now) : timestamp(row.timestamp, now);
    if (price === null || updatedAt === null) continue;
    const change = number(row.signed_change_rate), volume = number(row.acc_trade_price_24h);
    data[symbol] = { price, changePercent: change === null || !Number.isFinite(change * 100) ? null : change * 100, volume24h: volume !== null && volume >= 0 ? volume : null, updatedAt };
  }
  if (!Object.keys(data).length) throw new Error('유효한 원화 시세가 없습니다');
  return data;
}
function parseBinance(value: unknown, now: number): ExchangeData {
  if (!Array.isArray(value)) throw new Error('잘못된 시세 응답');
  const data: ExchangeData = {};
  for (const row of value) {
    if (!record(row) || typeof row.symbol !== 'string' || !BINANCE_SYMBOLS.has(row.symbol)) continue;
    const price = number(row.lastPrice, true), open = number(row.openPrice, true), updatedAt = timestamp(row.closeTime, now);
    if (price === null || updatedAt === null) continue;
    const volume = number(row.quoteVolume);
    data[row.symbol.slice(0, -4)] = { price, changePercent: open === null ? null : (price / open - 1) * 100, volume24h: volume !== null && volume >= 0 ? volume : null, updatedAt };
  }
  if (!Object.keys(data).length) throw new Error('유효한 USDT 시세가 없습니다');
  return data;
}
function parseFx(value: unknown, now: number): FxData {
  if (!record(value) || value.base !== 'USD' || value.quote !== 'KRW' || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('잘못된 USD/KRW 응답');
  const usdKrw = number(value.rate, true), date = Date.parse(`${value.date}T00:00:00Z`);
  if (usdKrw === null || usdKrw > 100_000 || !Number.isFinite(date) || date > now + 86_400_000 || new Date(date).toISOString().slice(0, 10) !== value.date) throw new Error('유효하지 않은 기준 환율');
  return { usdKrw, date: value.date };
}
function parse(source: QuoteSourceName, value: unknown, now: number): ExchangeData | FxData {
  return source === 'upbit' || source === 'bithumb' ? parseDomestic(value, now, source) : source === 'binance' ? parseBinance(value, now) : parseFx(value, now);
}
function isFx(data: ExchangeData | FxData): data is FxData { return typeof data.usdKrw === 'number'; }
function validSnapshot(value: unknown, source: QuoteSourceName, now: number): value is Snapshot {
  if (!record(value) || !record(value.data) || typeof value.fetchedAt !== 'number' || typeof value.attemptedAt !== 'number' || !Number.isFinite(value.fetchedAt) || !Number.isFinite(value.attemptedAt) || value.fetchedAt > now + 300_000 || value.attemptedAt > now + 300_000 || (value.error !== null && typeof value.error !== 'string')) return false;
  if (value.fetchedAt === 0) return !!value.error && Object.keys(value.data).length === 0 && value.attemptedAt >= now - PRICE_REFRESH_MS;
  if (value.fetchedAt < now - RETAIN_MS || value.attemptedAt < value.fetchedAt) return false;
  if (source === 'fx') return typeof value.data.usdKrw === 'number' && value.data.usdKrw > 0 && Number.isFinite(value.data.usdKrw) && typeof value.data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.data.date);
  return Object.entries(value.data).every(([symbol, row]) => (SYMBOLS.has(symbol) || (source === 'upbit' || source === 'bithumb') && symbol === 'USDT') && record(row) && typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 && timestamp(row.updatedAt, now) !== null);
}
function state(snapshot: Snapshot | null, now: number, source: QuoteSourceName): QuoteSourceState {
  if (!snapshot || !Object.keys(snapshot.data).length) return { status: 'unavailable', fetchedAt: null, dataAt: null, error: snapshot?.error ?? `${SOURCE_LABELS[source]} 데이터를 불러오지 못했습니다` };
  const dataAt = isFx(snapshot.data) ? Date.parse(`${snapshot.data.date}T00:00:00Z`) : Math.min(...Object.values(snapshot.data).map(row => row.updatedAt));
  // A quiet pair can keep its last tick for minutes while the exchange API is healthy.
  // Quote ages remain on each row; they must not mark the entire provider as delayed.
  const stale = !!snapshot.error || now - snapshot.fetchedAt > (source === 'fx' ? FX_REFRESH_MS * 2 : 120_000) || source === 'fx' && now - dataAt > 7 * 86_400_000;
  return { status: stale ? 'stale' : 'fresh', fetchedAt: snapshot.fetchedAt, dataAt, error: snapshot.error };
}

/** One isolate coalesces requests; Cloudflare's shared edge cache preserves each source independently. */
export function createQuoteService(options: QuoteServiceOptions = {}) {
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? Date.now;
  const memory = new Map<QuoteSourceName, Snapshot>();
  const pending = new Map<QuoteSourceName, Promise<Snapshot | null>>();
  const cache = () => { try { return options.cache?.(); } catch { return undefined; } };

  async function sourceData(source: QuoteSourceName, origin: string): Promise<Snapshot | null> {
    const existing = pending.get(source);
    if (existing) return existing;
    const operation = (async () => {
      const currentTime = now();
      const cacheKey = new Request(`${origin}/__quotes-cache/v1/${source}`);
      const store = cache();
      let previous = memory.get(source);
      if (previous && currentTime - (previous.fetchedAt || previous.attemptedAt) > RETAIN_MS) previous = undefined;
      if (!previous && store) {
        try {
          const cached = await store.match(cacheKey), value: unknown = cached ? await cached.json() : null;
          if (validSnapshot(value, source, currentTime)) { previous = value; memory.set(source, value); }
        } catch { /* The API continues when the optional platform cache is unavailable. */ }
      }
      const refreshMs = previous?.error ? PRICE_REFRESH_MS : source === 'fx' ? FX_REFRESH_MS : PRICE_REFRESH_MS;
      if (previous && currentTime - previous.attemptedAt < refreshMs) return previous;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
      let next: Snapshot;
      // Public diagnostics are deliberately limited to a bounded HTTP code or category.
      // Never expose upstream bodies, request headers, exception text or credentials.
      let failureReason = '네트워크 연결 실패';
      try {
        const readJson = async (url: string): Promise<unknown> => {
          failureReason = '네트워크 연결 실패';
          // Workers does not implement redirect:'error'. Manual + !ok also rejects redirects.
          const response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'manual' });
          if (!response.ok) { failureReason = `HTTP ${response.status}`; throw new Error('Upstream rejected'); }
          failureReason = '응답 형식 확인 실패';
          return await response.json();
        };
        let url = URLS[source];
        let bithumbMarkets: Set<string> | null = null;
        if (source === 'bithumb') {
          // One unsupported pair makes Bithumb reject the entire batch, even with HTTP 200.
          // Discover live KRW pairs before the one curated batch. Both calls share this
          // source's 60s cache/coalescing/timeout; clients never choose upstream symbols.
          const markets = await readJson(BITHUMB_MARKETS_URL);
          if (!Array.isArray(markets)) throw new Error('Invalid market list');
          bithumbMarkets = new Set(markets.filter(row => record(row) && typeof row.market === 'string' && row.market.startsWith('KRW-') && (SYMBOLS.has(row.market.slice(4)) || row.market === 'KRW-USDT')).map(row => row.market as string));
          if (!bithumbMarkets.size) throw new Error('No supported KRW market');
          url += `?markets=${encodeURIComponent([...bithumbMarkets].sort().join(','))}`;
        }
        const raw = await readJson(url);
        const body = bithumbMarkets && Array.isArray(raw) ? raw.filter(row => record(row) && typeof row.market === 'string' && bithumbMarkets.has(row.market)) : raw;
        const fetchedAt = now();
        const data = parse(source, body, fetchedAt);
        // A listed pair with a missing/malformed ticker is a provider failure, not proof
        // that this exchange does not trade it. Keep the last complete snapshot instead.
        if (bithumbMarkets && [...bithumbMarkets].some(market => !(market.slice(4) in data))) throw new Error('Incomplete ticker response');
        next = { data, fetchedAt, attemptedAt: fetchedAt, error: null };
      } catch {
        if (controller.signal.aborted) failureReason = '응답 시간 초과';
        next = previous ? { ...previous, attemptedAt: now(), error: `${SOURCE_LABELS[source]} 갱신 실패 · 마지막 수신값 (${failureReason})` } : { data: {}, fetchedAt: 0, attemptedAt: now(), error: `${SOURCE_LABELS[source]} 연결 대기 (${failureReason})` };
      } finally { clearTimeout(timeout); }
      memory.set(source, next);
      if (store) {
        try { await store.put(cacheKey, new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${RETAIN_MS / 1000}` } })); } catch { /* In-memory caching still applies. */ }
      }
      return next;
    })();
    pending.set(source, operation);
    try { return await operation; } finally { pending.delete(source); }
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    const origin = new URL(request.url).origin;
    const [upbit, bithumb, binance, fx] = await Promise.all([sourceData('upbit', origin), sourceData('bithumb', origin), sourceData('binance', origin), sourceData('fx', origin)]);
    const generatedAt = now(), u = upbit && !isFx(upbit.data) ? upbit.data : {}, h = bithumb && !isFx(bithumb.data) ? bithumb.data : {}, b = binance && !isFx(binance.data) ? binance.data : {};
    const rate = fx && isFx(fx.data) ? fx.data : null;
    const coins: CoinQuote[] = QUOTE_COINS.filter(([symbol]) => u[symbol] || h[symbol] || b[symbol]).map(([symbol, name]) => ({
      symbol, name,
      upbitKrw: u[symbol]?.price ?? null, bithumbKrw: h[symbol]?.price ?? null, binanceUsdt: b[symbol]?.price ?? null,
      referenceKrw: b[symbol] && rate ? b[symbol].price * rate.usdKrw : null,
      premiumPercent: referencePremium(u[symbol]?.price ?? null, b[symbol]?.price ?? null, rate?.usdKrw ?? null),
      bithumbPremiumPercent: referencePremium(h[symbol]?.price ?? null, b[symbol]?.price ?? null, rate?.usdKrw ?? null),
      upbitChangePercent: u[symbol]?.changePercent ?? null, bithumbChangePercent: h[symbol]?.changePercent ?? null, binanceChangePercent: b[symbol]?.changePercent ?? null,
      upbitVolume24hKrw: u[symbol]?.volume24h ?? null, bithumbVolume24hKrw: h[symbol]?.volume24h ?? null,
      upbitAt: u[symbol]?.updatedAt ?? null, bithumbAt: h[symbol]?.updatedAt ?? null, binanceAt: b[symbol]?.updatedAt ?? null,
    }));
    const payload: QuotesPayload = {
      generatedAt, refreshSeconds: PRICE_REFRESH_MS / 1000,
      sources: { upbit: state(upbit, generatedAt, 'upbit'), bithumb: state(bithumb, generatedAt, 'bithumb'), binance: state(binance, generatedAt, 'binance'), fx: state(fx, generatedAt, 'fx') },
      fx: rate, usdtKrw: u.USDT ? { price: u.USDT.price, changePercent: u.USDT.changePercent, updatedAt: u.USDT.updatedAt } : null, coins,
      bithumbUsdtKrw: h.USDT ? { price: h.USDT.price, changePercent: h.USDT.changePercent, updatedAt: h.USDT.updatedAt } : null,
    };
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=15, s-maxage=30', 'X-Content-Type-Options': 'nosniff' } });
  };
}

export const handleQuotes = createQuoteService({ cache: () => typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: QuoteCache }).default });
