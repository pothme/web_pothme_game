import { CURATED_MARKETS, type MarketSymbol } from './market-catalog';
import type { ChartInterval } from './office-settings';

const CRYPTO_EXCHANGES = new Set(['BINANCE', 'COINBASE', 'KRAKEN', 'BITSTAMP', 'BITFINEX', 'UPBIT', 'BITHUMB']);
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSEARCA', 'ARCA']);
const OVERNIGHT_SYMBOLS: Readonly<Record<string, string>> = { 'AMEX:SOXL': 'BOATS:SOXL', 'NASDAQ:TQQQ': 'BOATS:TQQQ' };
const NEW_YORK_SESSION = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });

/** Scheduled BOATS window, not a live exchange-open assertion. Holidays and
 * suspensions remain the provider's visible status; never synthesize prices. */
export function isBoatsSessionWindow(now: number): boolean {
  if (!Number.isFinite(now)) return false;
  const parts = NEW_YORK_SESSION.formatToParts(now);
  const weekday = parts.find(part => part.type === 'weekday')?.value;
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return hour >= 20 ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(weekday ?? '')
    : hour < 4 && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday ?? '');
}

export function chartPresentation(symbol: string, interval: ChartInterval, metadata?: MarketSymbol, now = Date.now()) {
  const exchange = symbol.split(':')[0]!;
  const market = (metadata?.symbol === symbol ? metadata : undefined) ?? CURATED_MARKETS.find(entry => entry.symbol === symbol)
    ?? { symbol, name: symbol, exchange, kind: CRYPTO_EXCHANGES.has(exchange) ? 'crypto' as const : 'stock' as const };
  const crypto = market.kind === 'crypto', korean = exchange === 'KRX';
  const extendedHours = !crypto && US_EXCHANGES.has(exchange) && interval !== 'D';
  const overnightSymbol = OVERNIGHT_SYMBOLS[symbol];
  const overnightActive = !!overnightSymbol && interval !== 'D' && isBoatsSessionWindow(now);
  return {
    market, crypto, extendedHours, overnightActive,
    chartSymbol: overnightActive ? overnightSymbol : symbol,
    sessionNote: overnightActive ? '야간 BOATS · 거래소 제공' : extendedHours ? '프리·애프터 / 지연 가능' : '',
    dataNote: korean ? 'Vunelix 제공 · 국내 주식 · 시세 지연 가능'
      : crypto ? 'TradingView 제공 · 암호화폐 시세'
      : overnightActive ? 'TradingView 제공 · 미국 심야 BOATS 시세 · 휴장 시 마지막 체결가'
      : extendedHours ? 'TradingView 제공 · 프리·애프터 포함 · 시세 지연 가능'
      : '주식·ETF 시세는 지연되거나 표시가 제한될 수 있어요. 차트의 지연 표시를 확인하세요.',
    // Stored/admin symbols remain on the primary exchange. Only these two
    // verified hosted widgets use the explicitly labelled overnight feed.
    overnightUrl: overnightSymbol ? `https://www.tradingview.com/symbols/${overnightSymbol.replace(':', '-')}/` : null,
  };
}

export function tradingViewChartConfig(symbol: string, interval: ChartInterval, compact: boolean, metadata?: MarketSymbol, now = Date.now()) {
  const presentation = chartPresentation(symbol, interval, metadata, now);
  return {
    autosize: true, symbol: presentation.chartSymbol, interval, timezone: 'Asia/Seoul', theme: 'dark', style: '1', locale: 'ko',
    allow_symbol_change: false, hide_top_toolbar: true, hide_side_toolbar: compact,
    hide_legend: false, hide_volume: false, withdateranges: false, save_image: false,
    calendar: false, details: false, hotlist: false, watchlist: [], compareSymbols: [], studies: [],
    // The hosted embed loader's supported option is extended_hours (not
    // show_extended_hours). It selects pre/post-market, not BOATS overnight.
    // https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js
    extended_hours: presentation.extendedHours,
    backgroundColor: '#0c1823', gridColor: 'rgba(95, 125, 145, 0.12)', support_host: 'https://www.tradingview.com',
  };
}
