export interface MarketSymbol {
  symbol: string; name: string; kind: 'crypto' | 'stock'; exchange: string;
  region?: 'KR' | 'US'; assetType?: 'stock' | 'etf'; aliases?: readonly string[];
}
export type MarketFilter = 'all' | 'crypto' | 'stock' | 'kr' | 'us' | 'etf';
export const MARKET_FILTERS: readonly MarketFilter[] = ['all', 'crypto', 'stock', 'kr', 'us', 'etf'];
export const DEFAULT_MARKET: MarketSymbol = { symbol: 'BINANCE:BTCUSDT', name: '비트코인 / USDT', kind: 'crypto', exchange: 'BINANCE' };
const CRYPTO_MARKETS: readonly MarketSymbol[] = [
  DEFAULT_MARKET,
  { symbol: 'COINBASE:USDTUSD', name: '테더 USDT / USD', kind: 'crypto', exchange: 'COINBASE', aliases: ['테더', 'Tether', 'USDT'] },
  ...[['ETH', '이더리움'], ['SOL', '솔라나'], ['XRP', '리플'], ['DOGE', '도지코인'], ['BNB', '비앤비'], ['ADA', '에이다'], ['AVAX', '아발란체'], ['LINK', '체인링크'], ['DOT', '폴카닷'], ['LTC', '라이트코인'], ['BCH', '비트코인캐시'], ['TRX', '트론'], ['SUI', '수이']].map(([ticker, name]) => ({ symbol: `BINANCE:${ticker}USDT`, name: `${name} / USDT`, kind: 'crypto' as const, exchange: 'BINANCE' })),
];
const US_STOCK_MARKETS: readonly MarketSymbol[] = [
    ['NASDAQ', 'AAPL', '애플 Apple'], ['NASDAQ', 'MSFT', '마이크로소프트 Microsoft'], ['NASDAQ', 'NVDA', '엔비디아 NVIDIA'], ['NASDAQ', 'TSLA', '테슬라 Tesla'], ['NASDAQ', 'AMZN', '아마존 Amazon'], ['NASDAQ', 'GOOGL', '알파벳 구글 Alphabet Google'], ['NASDAQ', 'META', '메타 Meta'], ['NASDAQ', 'AMD', 'AMD 에이엠디'], ['NASDAQ', 'INTC', '인텔 Intel'], ['NASDAQ', 'NFLX', '넷플릭스 Netflix'], ['NASDAQ', 'AVGO', '브로드컴 Broadcom'], ['NASDAQ', 'COST', '코스트코 Costco'], ['NASDAQ', 'PLTR', '팔란티어 Palantir'], ['NASDAQ', 'COIN', '코인베이스 Coinbase'], ['NASDAQ', 'MSTR', '스트래티지 Strategy'],
    ['NYSE', 'BRK.B', '버크셔 해서웨이 Berkshire Hathaway'], ['NYSE', 'JPM', 'JP모건 JPMorgan'], ['NYSE', 'V', '비자 Visa'], ['NYSE', 'KO', '코카콜라 Coca-Cola'], ['NYSE', 'DIS', '월트 디즈니 Disney'], ['NYSE', 'NKE', '나이키 Nike'], ['NASDAQ', 'WMT', '월마트 Walmart'], ['NYSE', 'TSM', 'TSMC 대만반도체 ADR'], ['NYSE', 'BABA', '알리바바 Alibaba ADR'], ['NYSE', 'XOM', '엑슨모빌 Exxon Mobil'],
].map(([exchange, ticker, name]) => ({ symbol: `${exchange}:${ticker}`, name: name!, kind: 'stock', exchange: exchange!, region: 'US', assetType: 'stock' }));

// TradingView canonical exchange symbols checked 2026-11-05, including current
// CBOE:ARKK / CBOE:FBTC and NYSE:SGOV listings. These are chart choices, not recommendations.
export const US_ETF_MARKETS: readonly MarketSymbol[] = [
  ['AMEX', 'SPY', 'S&P 500 SPDR ETF'],
  ['NASDAQ', 'QQQ', '나스닥 100 Invesco QQQ ETF'],
  ['AMEX', 'VOO', 'S&P 500 Vanguard ETF'],
  ['AMEX', 'VTI', '미국 전체 주식 Vanguard ETF'],
  ['AMEX', 'IVV', 'S&P 500 iShares ETF'],
  ['AMEX', 'DIA', '다우존스 30 SPDR ETF'],
  ['AMEX', 'IWM', '러셀 2000 중소형주 iShares ETF'],
  ['NASDAQ', 'TQQQ', '나스닥 100 일일 3배 ProShares ETF'],
  ['NASDAQ', 'SQQQ', '나스닥 100 일일 인버스 3배 ProShares ETF'],
  ['AMEX', 'SOXL', '반도체 일일 3배 Direxion ETF'],
  ['AMEX', 'SOXS', '반도체 일일 인버스 3배 Direxion ETF'],
  ['AMEX', 'QLD', '나스닥 100 일일 2배 ProShares ETF'],
  ['AMEX', 'UPRO', 'S&P 500 일일 3배 ProShares ETF'],
  ['AMEX', 'SPXL', 'S&P 500 일일 3배 Direxion ETF'],
  ['NASDAQ', 'TLT', '미국 장기 국채 20년 이상 iShares ETF'],
  ['NASDAQ', 'IEF', '미국 중기 국채 7–10년 iShares ETF'],
  ['NASDAQ', 'SHY', '미국 단기 국채 1–3년 iShares ETF'],
  ['NYSE', 'SGOV', '미국 초단기 국채 0–3개월 iShares ETF'],
  ['AMEX', 'GLD', '금 SPDR Gold ETF'],
  ['AMEX', 'IAU', '금 iShares Gold ETF'],
  ['AMEX', 'SLV', '은 iShares Silver ETF'],
  ['AMEX', 'SCHD', '미국 배당주 Schwab Dividend ETF'],
  ['AMEX', 'JEPI', '미국 주식 프리미엄 인컴 JPMorgan ETF'],
  ['NASDAQ', 'JEPQ', '나스닥 프리미엄 인컴 JPMorgan ETF'],
  ['CBOE', 'ARKK', '혁신기업 ARK Innovation ETF'],
  ['NASDAQ', 'SMH', '반도체 VanEck ETF'],
  ['NASDAQ', 'SOXX', '반도체 iShares ETF'],
  ['AMEX', 'XLK', '미국 기술주 Technology Select Sector SPDR ETF'],
  ['AMEX', 'XLF', '미국 금융주 Financial Select Sector SPDR ETF'],
  ['AMEX', 'XLE', '미국 에너지 Energy Select Sector SPDR ETF'],
  ['NASDAQ', 'IBIT', '비트코인 현물 iShares Bitcoin Trust ETF'],
  ['CBOE', 'FBTC', '비트코인 현물 Fidelity Wise Origin ETF'],
].map(([exchange, ticker, name]) => ({ symbol: `${exchange}:${ticker}`, name: name!, kind: 'stock', exchange: exchange!, region: 'US', assetType: 'etf' }));

// Domestic symbols are routed to the verified Korean-market embed by the client;
// TradingView widgets do not carry KRX data.
export const KR_MARKETS: readonly MarketSymbol[] = [
  ['005930', '삼성전자 Samsung Electronics', '삼전'],
  ['000660', 'SK하이닉스 SK hynix', '하이닉스'],
  ['373220', 'LG에너지솔루션 LG Energy Solution', '엘지에너지솔루션'],
  ['207940', '삼성바이오로직스 Samsung Biologics', '삼바'],
  ['005380', '현대자동차 Hyundai Motor', '현대차'],
  ['000270', '기아 Kia', '기아자동차'],
  ['035420', '네이버 NAVER', ''],
  ['035720', '카카오 Kakao', ''],
  ['005490', 'POSCO홀딩스 POSCO Holdings', '포스코홀딩스 포스코'],
  ['051910', 'LG화학 LG Chem', '엘지화학'],
  ['006400', '삼성SDI Samsung SDI', '삼성에스디아이'],
  ['105560', 'KB금융 KB Financial', '국민은행'],
  ['055550', '신한지주 Shinhan Financial', '신한은행'],
  ['086790', '하나금융지주 Hana Financial', '하나은행'],
  ['316140', '우리금융지주 Woori Financial', '우리은행'],
  ['012330', '현대모비스 Hyundai Mobis', ''],
  ['028260', '삼성물산 Samsung C&T', ''],
  ['068270', '셀트리온 Celltrion', ''],
  ['012450', '한화에어로스페이스 Hanwha Aerospace', '한화에어로'],
  ['329180', 'HD현대중공업 HD Hyundai Heavy Industries', '현대중공업'],
  ['267260', 'HD현대일렉트릭 HD Hyundai Electric', '현대일렉트릭'],
  ['064350', '현대로템 Hyundai Rotem', ''],
  ['030200', 'KT 케이티', '한국통신'],
  ['017670', 'SK텔레콤 SK Telecom', '에스케이텔레콤'],
  ['003670', '포스코퓨처엠 POSCO Future M', ''],
  ['042660', '한화오션 Hanwha Ocean', ''],
  ['034020', '두산에너빌리티 Doosan Enerbility', ''],
  ['010120', 'LS ELECTRIC LS일렉트릭', '엘에스일렉트릭'],
  ['196170', '알테오젠 Alteogen', ''],
  ['247540', '에코프로비엠 Ecopro BM', ''],
  ['086520', '에코프로 Ecopro', ''],
  ['028300', 'HLB 에이치엘비', ''],
  ['141080', '리가켐바이오 LigaChem Biosciences', '레고켐바이오'],
  ['087010', '펩트론 Peptron', ''],
  ['058470', '리노공업 Leeno Industrial', ''],
  ['039030', '이오테크닉스 EO Technics', ''],
].map(([ticker, name, aliases]) => ({ symbol: `KRX:${ticker}`, name: name!, kind: 'stock', exchange: 'KRX', region: 'KR', assetType: 'stock', aliases: aliases ? aliases.split(' ') : [] }));

export const CURATED_MARKETS: readonly MarketSymbol[] = [...CRYPTO_MARKETS, ...KR_MARKETS, ...US_STOCK_MARKETS, ...US_ETF_MARKETS];
const ETF_SYMBOLS = new Set(US_ETF_MARKETS.map(market => market.symbol));
export function getMarketRegion(market: MarketSymbol): 'KR' | 'US' | undefined {
  if (market.kind !== 'stock') return undefined;
  return market.region ?? (market.exchange === 'KRX' ? 'KR' : 'US');
}
export function getMarketAssetType(market: MarketSymbol): 'stock' | 'etf' | undefined {
  if (market.kind !== 'stock') return undefined;
  return market.assetType ?? (ETF_SYMBOLS.has(market.symbol) ? 'etf' : 'stock');
}
export function matchesMarketFilter(market: MarketSymbol, filter: string): boolean {
  switch (filter) {
    case 'all': return true;
    case 'crypto': return market.kind === 'crypto';
    case 'stock': return market.kind === 'stock';
    case 'kr': return getMarketRegion(market) === 'KR';
    case 'us': return getMarketRegion(market) === 'US' && getMarketAssetType(market) === 'stock';
    case 'etf': return getMarketRegion(market) === 'US' && getMarketAssetType(market) === 'etf';
    default: return false;
  }
}
const normalized = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
export function searchMarkets(markets: readonly MarketSymbol[], query: string, filter: string = 'all'): MarketSymbol[] {
  const needle = normalized(query);
  const matches = markets.filter(market => matchesMarketFilter(market, filter) && (!needle || normalized(`${market.symbol} ${market.name} ${market.exchange} ${(market.aliases ?? []).join(' ')}`).includes(needle)));
  if (!needle && filter === 'all') {
    // Initial results represent every enabled market; ETFs must not disappear
    // behind the 40-result bound when the equity catalog grows.
    const groups = ['crypto', 'kr', 'us', 'etf'].map(kind => matches.filter(market => matchesMarketFilter(market, kind)));
    const balanced: MarketSymbol[] = [];
    for (let row = 0; groups.some(group => row < group.length) && balanced.length < 40; row++) {
      for (const group of groups) if (group[row] && balanced.length < 40) balanced.push(group[row]!);
    }
    return balanced;
  }
  if (needle) matches.sort((a, b) => Number(normalized(b.symbol.split(':')[1]!) === needle) - Number(normalized(a.symbol.split(':')[1]!) === needle));
  return matches.slice(0, 40);
}
