/** Curated coverage, not a market-cap ranking. Missing exchange pairs remain null. */
export const QUOTE_COINS = [
  ['BTC', '비트코인'], ['ETH', '이더리움'], ['XRP', '엑스알피'], ['SOL', '솔라나'],
  ['DOGE', '도지코인'], ['ADA', '에이다'], ['AVAX', '아발란체'], ['LINK', '체인링크'],
  ['DOT', '폴카닷'], ['BCH', '비트코인캐시'], ['ETC', '이더리움클래식'], ['TRX', '트론'],
  ['NEAR', '니어프로토콜'], ['ATOM', '코스모스'], ['UNI', '유니스왑'], ['AAVE', '에이브'],
  ['SUI', '수이'], ['APT', '앱토스'], ['SHIB', '시바이누'], ['HBAR', '헤데라'],
] as const;
/** Binance's documented, authentication-free public market-data endpoint. */
export const BINANCE_PUBLIC_QUOTES_URL = `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(QUOTE_COINS.map(([symbol]) => `${symbol}USDT`)))}&type=MINI&symbolStatus=TRADING`;

export type DomesticExchange = 'upbit' | 'bithumb';
export type QuoteSourceName = DomesticExchange | 'binance' | 'fx';
export interface QuoteSourceState {
  status: 'fresh' | 'stale' | 'unavailable';
  fetchedAt: number | null;
  dataAt: number | null;
  error: string | null;
  via?: 'browser';
}
export interface CoinQuote {
  symbol: string;
  name: string;
  upbitKrw: number | null;
  bithumbKrw: number | null;
  binanceUsdt: number | null;
  referenceKrw: number | null;
  premiumPercent: number | null;
  bithumbPremiumPercent: number | null;
  upbitChangePercent: number | null;
  bithumbChangePercent: number | null;
  binanceChangePercent: number | null;
  upbitVolume24hKrw: number | null;
  bithumbVolume24hKrw: number | null;
  upbitAt: number | null;
  bithumbAt: number | null;
  binanceAt: number | null;
}
export interface DomesticUsdtQuote { price: number; changePercent: number | null; updatedAt: number }
export interface QuotesPayload {
  generatedAt: number;
  refreshSeconds: number;
  sources: Record<QuoteSourceName, QuoteSourceState>;
  fx: { usdKrw: number; date: string } | null;
  /** Kept as the Upbit value for older clients. */
  usdtKrw: DomesticUsdtQuote | null;
  bithumbUsdtKrw: DomesticUsdtQuote | null;
  coins: CoinQuote[];
}

/** A USDT=USD reference comparison; this is deliberately not an executable FX quote. */
export function referencePremium(domesticKrw: number | null, binanceUsdt: number | null, usdKrw: number | null): number | null {
  if (![domesticKrw, binanceUsdt, usdKrw].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) return null;
  const premium = (domesticKrw! / (binanceUsdt! * usdKrw!) - 1) * 100;
  return Number.isFinite(premium) ? premium : null;
}

/** Missing fields from an older cached API response must never fall back to another exchange. */
export function getDomesticQuote(coin: CoinQuote, exchange: DomesticExchange) {
  return exchange === 'bithumb'
    ? { price: coin.bithumbKrw ?? null, changePercent: coin.bithumbChangePercent ?? null, volume24hKrw: coin.bithumbVolume24hKrw ?? null, updatedAt: coin.bithumbAt ?? null, premiumPercent: coin.bithumbPremiumPercent ?? null }
    : { price: coin.upbitKrw ?? null, changePercent: coin.upbitChangePercent ?? null, volume24hKrw: coin.upbitVolume24hKrw ?? null, updatedAt: coin.upbitAt ?? null, premiumPercent: coin.premiumPercent ?? null };
}
export function getDomesticUsdt(payload: QuotesPayload, exchange: DomesticExchange): DomesticUsdtQuote | null {
  return (exchange === 'bithumb' ? payload.bithumbUsdtKrw : payload.usdtKrw) ?? null;
}
