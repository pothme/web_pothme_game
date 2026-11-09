import { BINANCE_PUBLIC_QUOTES_URL, QUOTE_COINS, referencePremium, type CoinQuote, type QuotesPayload } from '../shared/quotes';

interface BrowserQuote { price: number; changePercent: number | null; updatedAt: number }
interface BrowserSnapshot { quotes: Record<string, BrowserQuote>; fetchedAt: number }
interface BrowserRequestOptions extends RequestInit { mode: 'cors'; credentials: 'omit' }
interface BrowserFeedOptions { fetch?: (url: string, init: BrowserRequestOptions) => Promise<Response>; now?: () => number; timeoutMs?: number }
const REFRESH_MS = 60_000;
const allowed = new Set(QUOTE_COINS.map(([symbol]) => `${symbol}USDT`));
function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : null;
}
function parseQuotes(value: unknown, now: number): Record<string, BrowserQuote> {
  if (!Array.isArray(value)) throw new Error('Invalid quote response');
  const quotes: Record<string, BrowserQuote> = {};
  for (const row of value) {
    if (!row || typeof row !== 'object' || typeof row.symbol !== 'string' || !allowed.has(row.symbol)) continue;
    const price = numeric(row.lastPrice), open = numeric(row.openPrice), at = numeric(row.closeTime);
    if (price === null || at === null || at < 1_420_070_400_000 || at > now + 300_000) continue;
    const change = open === null ? null : (price / open - 1) * 100;
    quotes[row.symbol.slice(0, -4)] = { price, changePercent: change !== null && Number.isFinite(change) ? change : null, updatedAt: at };
  }
  if (!Object.keys(quotes).length) throw new Error('No valid quote');
  return quotes;
}
function merge(payload: QuotesPayload, snapshot: BrowserSnapshot, now: number, error: string | null): QuotesPayload {
  const originals = new Map(payload.coins.map(coin => [coin.symbol, coin]));
  const coins: CoinQuote[] = [];
  for (const [symbol, name] of QUOTE_COINS) {
    const original = originals.get(symbol), quote = snapshot.quotes[symbol];
    if (original?.upbitKrw == null && original?.bithumbKrw == null && !quote) continue;
    const upbitKrw = original?.upbitKrw ?? null, bithumbKrw = original?.bithumbKrw ?? null, usdKrw = payload.fx?.usdKrw ?? null;
    const reference = quote && usdKrw ? quote.price * usdKrw : null;
    coins.push({
      symbol, name, upbitKrw, bithumbKrw, binanceUsdt: quote?.price ?? null,
      referenceKrw: reference !== null && Number.isFinite(reference) ? reference : null,
      premiumPercent: referencePremium(upbitKrw, quote?.price ?? null, usdKrw),
      bithumbPremiumPercent: referencePremium(bithumbKrw, quote?.price ?? null, usdKrw),
      upbitChangePercent: original?.upbitChangePercent ?? null, binanceChangePercent: quote?.changePercent ?? null,
      bithumbChangePercent: original?.bithumbChangePercent ?? null,
      upbitVolume24hKrw: original?.upbitVolume24hKrw ?? null,
      bithumbVolume24hKrw: original?.bithumbVolume24hKrw ?? null,
      upbitAt: original?.upbitAt ?? null, binanceAt: quote?.updatedAt ?? null,
      bithumbAt: original?.bithumbAt ?? null,
    });
  }
  return {
    ...payload, coins,
    sources: { ...payload.sources, binance: {
      status: error || now - snapshot.fetchedAt > 120_000 ? 'stale' : 'fresh',
      fetchedAt: snapshot.fetchedAt, dataAt: Math.min(...Object.values(snapshot.quotes).map(quote => quote.updatedAt)),
      error, via: 'browser',
    } },
  };
}

/** Direct normal CORS requests only: no credentials, proxy, alternate host or origin override. */
export function createBrowserBinanceFallback(options: BrowserFeedOptions = {}) {
  const fetcher = options.fetch ?? ((url: string, init: BrowserRequestOptions) => fetch(url, init));
  const now = options.now ?? Date.now;
  let snapshot: BrowserSnapshot | null = null, attemptedAt: number | null = null;
  let error: string | null = null, pending: Promise<void> | null = null, disposed = false;
  let controller: AbortController | null = null;
  async function refresh(): Promise<void> {
    if (pending) return pending;
    if (disposed || attemptedAt !== null && now() - attemptedAt < REFRESH_MS) return;
    attemptedAt = now();
    pending = (async () => {
      const active = new AbortController(); controller = active;
      const timeout = setTimeout(() => active.abort(), options.timeoutMs ?? 5_000);
      let reason = '연결 실패';
      try {
        const response = await fetcher(BINANCE_PUBLIC_QUOTES_URL, {
          mode: 'cors', credentials: 'omit', redirect: 'error', signal: active.signal,
        });
        if (!response.ok) { reason = `HTTP ${response.status}`; throw new Error('Upstream unavailable'); }
        reason = '응답 확인 실패';
        const value: unknown = await response.json(), fetchedAt = now();
        const quotes = parseQuotes(value, fetchedAt);
        if (!disposed) { snapshot = { quotes, fetchedAt }; error = null; }
      } catch {
        if (!disposed) error = `바이낸스 브라우저 수신 실패 (${active.signal.aborted ? '시간 초과' : reason})`;
      } finally { clearTimeout(timeout); controller = null; }
    })();
    try { await pending; } finally { pending = null; }
  }
  return {
    async apply(payload: QuotesPayload): Promise<QuotesPayload> {
      const source = payload.sources.binance;
      if (disposed || source.status === 'fresh' && source.fetchedAt !== null && now() - source.fetchedAt <= 120_000) return payload;
      await refresh();
      if (disposed) return payload;
      if (snapshot) return merge(payload, snapshot, now(), error);
      return error ? { ...payload, sources: { ...payload.sources, binance: { ...source, error: `${source.error ? `${source.error} · ` : ''}${error}` } } } : payload;
    },
    dispose() { disposed = true; controller?.abort(); },
  };
}
