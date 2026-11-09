/** Manually verified market-cap selection; quotes come only from the hosted widget. */
export const MARKET_TAPES = {
  us: {
    label: '미국 시총 TOP 10',
    scope: '미국 증시 상장 기업 · ADR 포함 · ETF·기업 중복 제외',
    asOf: '2026-11-05',
    sources: [
      { title: 'Stock Analysis 시가총액 순위', url: 'https://stockanalysis.com/list/biggest-companies/' },
      { title: 'TradingView 미국 기업 목록', url: 'https://www.tradingview.com/markets/stocks-usa/market-movers-large-cap/' },
    ],
    symbols: [
      { symbol: 'NASDAQ:AAPL', name: '애플' },
      { symbol: 'NASDAQ:NVDA', name: '엔비디아' },
      { symbol: 'NASDAQ:MSFT', name: '마이크로소프트' },
      { symbol: 'NASDAQ:GOOGL', name: '알파벳' },
      { symbol: 'NASDAQ:AMZN', name: '아마존' },
      { symbol: 'NASDAQ:SPCX', name: '스페이스X' },
      { symbol: 'NYSE:TSM', name: 'TSMC' },
      { symbol: 'NASDAQ:META', name: '메타' },
      { symbol: 'NASDAQ:AVGO', name: '브로드컴' },
      { symbol: 'NASDAQ:TSLA', name: '테슬라' },
    ],
  },
  kr: {
    label: '국내 시총 TOP 10',
    scope: '국내 상장 보통주 · ETF·우선주·기업 중복 제외',
    asOf: '2026-11-05',
    sources: [{ title: 'TradingView 국내 시가총액 목록', url: 'https://www.tradingview.com/markets/stocks-korea/market-movers-large-cap/' }],
    symbols: [
      { symbol: 'KRX:005930', name: '삼성전자' },
      { symbol: 'KRX:000660', name: 'SK하이닉스' },
      { symbol: 'KRX:402340', name: 'SK스퀘어' },
      { symbol: 'KRX:009150', name: '삼성전기' },
      { symbol: 'KRX:373220', name: 'LG에너지솔루션' },
      { symbol: 'KRX:207940', name: '삼성바이오로직스' },
      { symbol: 'KRX:005380', name: '현대차' },
      { symbol: 'KRX:105560', name: 'KB금융' },
      { symbol: 'KRX:028260', name: '삼성물산' },
      { symbol: 'KRX:032830', name: '삼성생명' },
    ],
  },
} as const;

export type MarketTapeRegion = keyof typeof MARKET_TAPES;
