import { CURATED_MARKETS, type MarketSymbol } from './market-catalog';

export const CHARTS_PER_WALL = 4;
export const OFFICE_CHART_COUNT = 8;
export const OFFICE_CHART_LAYOUT_VERSION = 2;
/** Front wall first, then rear wall; left-to-right when facing each wall. */
export type OfficeCharts = [MarketSymbol, MarketSymbol, MarketSymbol, MarketSymbol, MarketSymbol, MarketSymbol, MarketSymbol, MarketSymbol];
const symbols = ['KRX:005930', 'KRX:000660', 'NASDAQ:TQQQ', 'AMEX:SOXL', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:XRPUSDT', 'COINBASE:USDTUSD'] as const;
export function chartSlotLabel(slot: number): string { return `${slot < CHARTS_PER_WALL ? '앞벽' : '뒷벽'} ${slot % CHARTS_PER_WALL + 1}번`; }
export const DEFAULT_CHARTS: Readonly<OfficeCharts> = Object.freeze(symbols.map((symbol) => {
  const market = CURATED_MARKETS.find((entry) => entry.symbol === symbol);
  if (!market) throw new Error(`Missing default chart: ${symbol}`);
  return Object.freeze({ ...market });
}) as OfficeCharts);

function isMarket(value: unknown): value is MarketSymbol {
  if (!value || typeof value !== 'object') return false;
  const market = value as Partial<MarketSymbol>;
  return typeof market.symbol === 'string' && typeof market.name === 'string' && typeof market.exchange === 'string' && (market.kind === 'stock' || market.kind === 'crypto');
}

/** Client normalization preserves valid slots. Persisted layout migrations are server-owned. */
export function normalizeOfficeCharts(charts: unknown, selected?: unknown): OfficeCharts {
  return DEFAULT_CHARTS.map((fallback, slot) => {
    const existing = Array.isArray(charts) ? charts[slot] : undefined;
    return isMarket(existing) ? existing : slot === 0 && isMarket(selected) ? selected : { ...fallback };
  }) as OfficeCharts;
}
