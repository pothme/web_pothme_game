import './markets-page.css';
import { createSupport } from './support';
import { initCommunity } from './community-ui';
import { createMarketsTheme, type ResolvedTheme, type ThemePreference } from './markets-theme';
import { createBrowserBinanceFallback } from './markets-browser-quotes';
import { QUOTE_COINS, getDomesticQuote, getDomesticUsdt, type CoinQuote, type QuotesPayload, type QuoteSourceName, type DomesticExchange } from '../shared/quotes';

const FAVORITES_KEY = 'podeum-markets-favorites-v1';
const EXCHANGE_KEY = 'podeum-markets-exchange-v1';
const SOURCE_NAMES: Record<QuoteSourceName, string> = { upbit: '업비트', bithumb: '빗썸', binance: '바이낸스', fx: 'Frankfurter 기준 환율' };
type SortKey = 'default' | 'premium' | 'price' | 'change' | 'volume';
const won = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const number2 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function price(value: number | null, currency: 'KRW' | 'USDT' = 'KRW'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const decimals = value < 1 ? 8 : value < 100 ? 4 : currency === 'USDT' ? 2 : 0;
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: decimals }).format(value);
}
function percent(value: number | null): string { return value === null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`; }
function tone(value: number | null): string { return value === null || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative'; }
function time(value: number | null): string { return value ? new Date(value).toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' }) : '수신 대기'; }
function dateTime(value: number | null): string { return value ? new Date(value).toLocaleString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' }) : '수신 대기'; }
function quoteAge(value: number | null | undefined): string {
  if (!value || Date.now() - value < 120_000) return '';
  const minutes = Math.floor((Date.now() - value) / 60_000);
  return `시세 ${minutes >= 1440 ? `${Math.floor(minutes / 1440)}일` : minutes >= 60 ? `${Math.floor(minutes / 60)}시간` : `${minutes}분`} 전`;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function loadFavorites(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    const allowed = new Set<string>(QUOTE_COINS.map(([symbol]) => symbol));
    return new Set(Array.isArray(value) ? value.filter((symbol): symbol is string => typeof symbol === 'string' && allowed.has(symbol)) : []);
  } catch { return new Set(); }
}
function loadExchange(): DomesticExchange { try { return localStorage.getItem(EXCHANGE_KEY) === 'bithumb' ? 'bithumb' : 'upbit'; } catch { return 'upbit'; } }

/** Independent public page: no WebSocket or room admission is started here. */
export function initMarketsPage(): { dispose(): void } {
  document.title = '포듬 시세 — 국내외 코인 가격을 한눈에';
  document.body.classList.add('markets-page');
  let reflectTheme: (preference: ThemePreference, resolved: ResolvedTheme) => void = () => {};
  let repaintChart: ((resolved: ResolvedTheme) => void) | null = null;
  // Apply the stored / system theme before inserting visible page content.
  const theme = createMarketsTheme((preference, resolved) => reflectTheme(preference, resolved));
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <header class="pm-header"><div class="pm-header-inner">
      <a class="pm-brand" href="/markets" aria-label="포듬 시세 홈"><span class="pm-brand-icon" aria-hidden="true">↗</span><strong>포듬<span>시세</span></strong></a>
      <nav class="pm-top-nav" aria-label="포듬 메뉴"><a href="/markets" data-pm-view="prices" aria-current="page">코인 시세</a><a href="/markets?view=community" data-pm-view="community">커뮤니티</a><a href="/">증권 사무실</a></nav>
      <label class="pm-theme-control"><span>테마</span><select id="pm-theme" aria-label="화면 테마"><option value="system">시스템</option><option value="light">밝게</option><option value="dark">어둡게</option></select></label>
      <a class="pm-room-link" href="/"><span class="pm-room-label-desktop">사무실 입장</span><span class="pm-room-label-mobile">사무실</span><span aria-hidden="true">↗</span></a>
    </div></header>
    <main class="pm-main">
      <div class="pm-overflow" id="pm-overflow" hidden><span class="pm-overflow-icon" aria-hidden="true">i</span><div><strong>사무실이 만석이어도, 시장은 계속 볼 수 있어요.</strong><p>50명 정원이 가득 찼습니다. 여기서 시세를 확인하고 자리가 나면 다시 입장해 주세요.</p></div><a href="/">입장 다시 시도 →</a></div>
      <div class="pm-notice" id="pm-notice" hidden></div>
      <span class="pm-visually-hidden" id="pm-preference-message" role="status"></span>
      <nav class="pm-section-tabs" aria-label="시세와 커뮤니티"><button type="button" id="pm-prices-tab" data-pm-view="prices" aria-pressed="true" aria-controls="pm-prices-view">코인 시세</button><button type="button" id="pm-community-tab" data-pm-view="community" aria-pressed="false" aria-controls="pm-community-view">커뮤니티 <span>이야기 나누기</span></button></nav>
      <section id="pm-prices-view" aria-labelledby="pm-prices-tab">
      <section class="pm-intro" aria-labelledby="pm-title"><div><span class="pm-eyebrow">PODEUM MARKETS</span><h1 id="pm-title">국내와 해외,<br class="pm-mobile-break"> 가격의 차이를 한눈에.</h1><p id="pm-compare-description">업비트·빗썸 원화 시세를 바이낸스 USDT 시세와 비교하세요.</p></div><div class="pm-update"><span class="pm-live-dot" aria-hidden="true"></span><span id="pm-update-text" role="status">시세 연결 중</span><button type="button" id="pm-refresh" aria-label="시세 새로고침">↻ <span>새로고침</span></button></div></section>
      <div class="pm-exchange-toolbar"><span class="pm-exchange-label" id="pm-exchange-label">국내 거래소</span><div class="pm-exchanges" role="group" aria-labelledby="pm-exchange-label"><button type="button" data-exchange="upbit" aria-pressed="true">업비트</button><button type="button" data-exchange="bithumb" aria-pressed="false">빗썸</button></div><span class="pm-compare-target">↔ 바이낸스 <b>USDT</b></span><span class="pm-exchange-note">가격 · 프리미엄 · 거래대금에 적용</span></div>
      <section class="pm-metrics" aria-label="주요 시장 지표">
        <article class="pm-metric pm-metric-featured"><div class="pm-metric-label"><span>비트코인 참고 김치프리미엄</span><span class="pm-coin-mini">₿</span></div><strong id="pm-btc-premium">—</strong><p id="pm-btc-detail">업비트 · 바이낸스 가격 비교</p></article>
        <article class="pm-metric"><div class="pm-metric-label"><span id="pm-btc-source-label">비트코인 · 업비트</span><span class="pm-tag">KRW</span></div><strong id="pm-btc-price">—</strong><p id="pm-btc-change">전일 종가 대비 · 수신 대기</p></article>
        <article class="pm-metric"><div class="pm-metric-label"><span>달러 / 원 기준 환율</span><span class="pm-tag">DAILY</span></div><strong id="pm-fx-price">—</strong><p id="pm-fx-date">일 단위 참고 환율 · 실시간 아님</p></article>
        <article class="pm-metric"><div class="pm-metric-label"><span id="pm-usdt-source-label">테더 · 업비트</span><span class="pm-tag">USDT/KRW</span></div><strong id="pm-usdt-price">—</strong><p id="pm-usdt-change">실제 원화 거래 가격 · 수신 대기</p></article>
      </section>
      <div class="pm-workspace">
        <section class="pm-table-panel" aria-labelledby="pm-table-title">
          <header class="pm-panel-heading"><div><h2 id="pm-table-title">코인 시세 비교 <span id="pm-coin-count">20</span></h2><p>관심 있는 코인을 모아, 가격 차이를 빠르게</p></div><span class="pm-refresh-tag">60초 갱신</span></header>
          <div class="pm-table-tools"><div class="pm-filters" role="group" aria-label="종목 필터"><button type="button" data-filter="all" aria-pressed="true">전체</button><button type="button" data-filter="favorites" aria-pressed="false">☆ 관심 코인</button></div><label class="pm-search"><span aria-hidden="true">⌕</span><input id="pm-search" type="search" placeholder="코인명 / 심볼 검색" aria-label="코인명 또는 심볼 검색" autocomplete="off" maxlength="40"></label></div>
          <div class="pm-sort-bar"><label for="pm-sort">정렬</label><select id="pm-sort"><option value="default">기본 순서</option><option value="premium">김치프리미엄 높은 순</option><option value="price">업비트 가격 높은 순</option><option value="change">업비트 상승률 높은 순</option><option value="volume">24시간 거래대금 높은 순</option></select><span id="pm-results-count" aria-live="polite"></span></div>
          <div class="pm-table-scroll" tabindex="0" role="region" aria-label="코인 가격 비교표, 좁은 화면에서 좌우 스크롤 가능"><table class="pm-table"><thead><tr><th scope="col">코인명</th><th scope="col"><span id="pm-domestic-column">업비트</span><small>KRW · 전일 종가 대비</small></th><th scope="col">바이낸스 <small>USDT / 참고 원화</small></th><th scope="col">김치프리미엄 <small>참고값</small></th><th scope="col" class="pm-volume-column">거래대금 <small id="pm-volume-source">업비트 · 24시간</small></th></tr></thead><tbody id="pm-tbody"></tbody></table></div>
          <div class="pm-empty" id="pm-empty" role="status">공식 거래소에서 시세를 불러오는 중입니다.</div>
          <footer class="pm-table-footer">★ 관심 코인은 이 브라우저에 저장됩니다. <span>선정 20종 · 시가총액 순위가 아닙니다.</span></footer>
        </section>
        <aside class="pm-sidebar">
          <section class="pm-chart-panel" aria-labelledby="pm-chart-title"><header class="pm-panel-heading"><div><h2 id="pm-chart-title"><span class="pm-btc-mark">₿</span> 비트코인 차트</h2><p>BINANCE · BTC/USDT</p></div><span class="pm-tag">1분봉</span></header><div class="pm-chart-host" id="pm-chart-host"></div><p class="pm-chart-caption">국내 거래소 선택과 별개인 바이낸스 BTC/USDT 차트입니다. TradingView의 별도 피드로 표와 갱신 시점이 다를 수 있습니다. 테마 변경 시 차트를 다시 불러옵니다.</p></section>
          <section class="pm-room-panel" aria-labelledby="pm-room-title"><span class="pm-eyebrow">PODEUM OFFICE</span><h2 id="pm-room-title">같이 보고, 같이 이야기해요.</h2><p>차트 여덟 개와 실시간 채팅이 있는<br>우리의 증권 사무실.</p><div class="pm-room-status"><span id="pm-room-state">사무실 상태 확인 중</span><strong id="pm-room-count">— / 50</strong></div><a class="pm-room-cta" href="/">입장 다시 시도 <span aria-hidden="true">→</span></a><small>이 페이지를 보는 동안에는 입장 대기열에 등록되지 않습니다.</small></section>
          <div id="market-support-host" class="pm-support-host"></div>
          <section class="pm-source-panel" aria-labelledby="pm-source-title"><h2 id="pm-source-title">데이터 수신 상태</h2><ul id="pm-source-list"></ul><p id="pm-network-note" role="status"></p></section>
        </aside>
      </div>
      <section class="pm-method" aria-labelledby="pm-method-title"><h2 id="pm-method-title">가격 비교는 이렇게 계산해요</h2><p class="pm-formula" id="pm-formula">(업비트 KRW ÷ (바이낸스 USDT × USD/KRW 기준 환율) − 1) × 100</p><p>해외 가격은 <strong>1 USDT = 1 USD로 가정한 참고 환산값</strong>입니다. USDT의 실제 달러 가격이나 환전·거래·출금 수수료는 반영하지 않으므로, 거래 가능한 수익률을 뜻하지 않습니다. 달러/원은 Frankfurter의 일 단위 혼합 기준 환율이며 휴일에는 이전 영업일 값일 수 있습니다.</p><p>전일 종가의 기준 시각은 업비트 UTC 0시(한국시간 9시), 빗썸 한국시간 0시입니다. 바이낸스 등락률은 최근 24시간 기준입니다. 한쪽 데이터가 없으면 비교값을 표시하지 않습니다. 갱신 실패 시 마지막 수신값과 지연 상태를 표시합니다.</p><div class="pm-source-links"><a href="https://docs.upbit.com/kr/reference/list-quote-tickers" target="_blank" rel="noopener noreferrer">Upbit Open API ↗</a><a href="https://apidocs.bithumb.com/reference/%ED%98%84%EC%9E%AC%EA%B0%80-%EC%A1%B0%ED%9A%8C" target="_blank" rel="noopener noreferrer">Bithumb Open API ↗</a><a href="https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints" target="_blank" rel="noopener noreferrer">Binance Spot API ↗</a><a href="https://frankfurter.dev/" target="_blank" rel="noopener noreferrer">Frankfurter ↗</a></div></section>
      </section><section id="pm-community-view" aria-labelledby="pm-community-tab" hidden><div id="pm-community-host"></div></section>
      <footer class="pm-footer"><a class="pm-brand" href="/markets"><span class="pm-brand-icon" aria-hidden="true">↗</span><strong>포듬<span>시세</span></strong></a><p>함께 읽는 시장, 포듬.</p><a href="/">증권 사무실로 →</a></footer>
    </main>`;

  const get = <T extends HTMLElement = HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const favorites = loadFavorites();
  const support = createSupport(get('market-support-host'));
  const community = initCommunity(get('pm-community-host'));
  const browserQuotes = createBrowserBinanceFallback();
  let payload: QuotesPayload | null = null;
  let exchange = loadExchange();
  let filter: 'all' | 'favorites' = 'all', sort: SortKey = 'default', query = '';
  let quoteBusy = false, roomBusy = false, disposed = false, networkFailed = false;
  let activeView: 'prices' | 'community' = 'prices';
  let nextRefreshAt = 0, nextRoomRefreshAt = 0;
  const controllers = new Set<AbortController>();
  const refreshButton = get<HTMLButtonElement>('pm-refresh');
  const body = get<HTMLTableSectionElement>('pm-tbody');
  const empty = get('pm-empty');
  get('pm-overflow').hidden = new URLSearchParams(location.search).get('reason') !== 'full';
  const themeSelect = get<HTMLSelectElement>('pm-theme'); themeSelect.value = theme.preference;
  reflectTheme = (preference, resolved) => { themeSelect.value = preference; if (activeView === 'prices') repaintChart?.(resolved); };
  themeSelect.addEventListener('change', () => {
    const saved = theme.setPreference(themeSelect.value);
    get('pm-preference-message').textContent = saved ? `화면 테마를 ${themeSelect.selectedOptions[0]?.textContent ?? '시스템'}으로 적용했습니다.` : '테마를 적용했습니다. 브라우저 저장을 사용할 수 없어 이번 방문에만 유지됩니다.';
  });

  function renderExchangeLabels() {
    const name = SOURCE_NAMES[exchange];
    app.querySelectorAll<HTMLButtonElement>('[data-exchange]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.exchange === exchange)));
    get('pm-compare-description').textContent = `${name} 원화 시세와 바이낸스 USDT 시세를 비교하고 있어요.`;
    get('pm-btc-source-label').textContent = `비트코인 · ${name}`; get('pm-usdt-source-label').textContent = `테더 · ${name}`;
    get('pm-domestic-column').textContent = name; get('pm-volume-source').textContent = `${name} · 24시간`;
    get('pm-domestic-column').nextElementSibling!.textContent = `KRW · ${exchange === 'bithumb' ? '한국시간' : 'UTC'} 0시 대비`;
    get<HTMLSelectElement>('pm-sort').querySelector<HTMLOptionElement>('[value="price"]')!.textContent = `${name} 가격 높은 순`;
    get<HTMLSelectElement>('pm-sort').querySelector<HTMLOptionElement>('[value="change"]')!.textContent = `${name} 상승률 높은 순`;
    get<HTMLSelectElement>('pm-sort').querySelector<HTMLOptionElement>('[value="volume"]')!.textContent = `${name} 24시간 거래대금 높은 순`;
    get('pm-formula').textContent = `(${name} KRW ÷ (바이낸스 USDT × USD/KRW 기준 환율) − 1) × 100`;
  }
  app.querySelectorAll<HTMLButtonElement>('[data-exchange]').forEach(button => button.addEventListener('click', () => {
    exchange = button.dataset.exchange === 'bithumb' ? 'bithumb' : 'upbit';
    try { localStorage.setItem(EXCHANGE_KEY, exchange); } catch { get('pm-preference-message').textContent = '거래소 선택은 이번 방문에만 유지됩니다.'; }
    renderExchangeLabels(); renderMetrics(); renderTable(); renderSources(); renderClock();
  }));
  renderExchangeLabels();

  function showView(view: 'prices' | 'community', changeUrl = false) {
    activeView = view;
    if (changeUrl) {
      const url = new URL(location.href); url.searchParams.delete('post');
      if (view === 'community') url.searchParams.set('view', 'community'); else url.searchParams.delete('view');
      history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    get('pm-prices-view').hidden = view !== 'prices'; get('pm-community-view').hidden = view !== 'community';
    app.querySelectorAll<HTMLElement>('[data-pm-view]').forEach(control => {
      const selected = control.dataset.pmView === view;
      if (control.tagName === 'BUTTON') control.setAttribute('aria-pressed', String(selected));
      else if (selected) control.setAttribute('aria-current', 'page'); else control.removeAttribute('aria-current');
    });
    document.title = view === 'community' ? '포듬 커뮤니티 — 함께 읽는 시장' : '포듬 시세 — 국내외 코인 가격을 한눈에';
    community.setActive(view === 'community');
    if (view === 'prices') repaintChart?.(theme.resolved);
    refreshVisiblePrices();
  }
  function refreshVisiblePrices() {
    if (activeView !== 'prices' || document.hidden || disposed) return;
    if (Date.now() >= nextRefreshAt) void refreshQuotes();
    if (Date.now() >= nextRoomRefreshAt) void refreshRoom();
  }
  function syncView() { const params = new URLSearchParams(location.search); showView(params.has('post') || params.get('view') === 'community' ? 'community' : 'prices'); }
  app.querySelectorAll<HTMLElement>('[data-pm-view]').forEach(control => control.addEventListener('click', event => {
    if (event instanceof MouseEvent && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    event.preventDefault(); showView(control.dataset.pmView === 'community' ? 'community' : 'prices', true);
  }));
  window.addEventListener('popstate', syncView); syncView();

  function sourceStale(source: QuoteSourceName): boolean {
    const state = payload?.sources[source];
    return !state || state.status !== 'fresh' || (state.fetchedAt !== null && Date.now() - state.fetchedAt > (source === 'fx' ? 7_200_000 : 120_000));
  }
  function setMetric(id: string, value: string, color?: number | null) { const element = get(id); element.textContent = value; element.className = color === undefined ? '' : `pm-${tone(color)}`; }
  function renderMetrics() {
    const btc = payload?.coins.find(coin => coin.symbol === 'BTC');
    const domestic = btc ? getDomesticQuote(btc, exchange) : null;
    const tether = payload ? getDomesticUsdt(payload, exchange) : null;
    const baseline = exchange === 'bithumb' ? '한국시간 0시 대비' : 'UTC 0시 대비';
    setMetric('pm-btc-premium', percent(domestic?.premiumPercent ?? null));
    get('pm-btc-detail').textContent = domestic?.premiumPercent != null ? `${SOURCE_NAMES[exchange]} · USDT=USD 참고 비교${sourceStale(exchange) || sourceStale('binance') || sourceStale('fx') ? ' · 지연값 포함' : ''}` : `${SOURCE_NAMES[exchange]} · 비교 데이터 수신 대기`;
    setMetric('pm-btc-price', domestic?.price != null ? `${price(domestic.price)} 원` : '—');
    setMetric('pm-btc-change', domestic?.price == null ? sourceStale(exchange) ? '시세 수신 대기' : '현재 제공되는 시세가 없습니다' : `${percent(domestic.changePercent)} · ${baseline}${sourceStale(exchange) ? ' · 지연' : quoteAge(domestic.updatedAt) ? ` · ${quoteAge(domestic.updatedAt)}` : ''}`, domestic?.changePercent ?? null);
    setMetric('pm-fx-price', payload?.fx ? `${number2.format(payload.fx.usdKrw)} 원` : '—');
    get('pm-fx-date').textContent = payload?.fx ? `${payload.fx.date} 기준 · 실시간 아님${sourceStale('fx') ? ' · 갱신 지연' : ''}` : '일 단위 참고 환율 · 수신 대기';
    setMetric('pm-usdt-price', tether ? `${price(tether.price)} 원` : '—');
    setMetric('pm-usdt-change', !tether ? sourceStale(exchange) ? '시세 수신 대기' : '현재 제공되는 시세가 없습니다' : `${percent(tether.changePercent)} · ${baseline}${sourceStale(exchange) ? ' · 지연' : quoteAge(tether.updatedAt) ? ` · ${quoteAge(tether.updatedAt)}` : ''}`, tether?.changePercent ?? null);
  }
  function renderTable() {
    body.replaceChildren();
    const allCoins = payload?.coins ?? [];
    const rows = allCoins.filter(coin => (filter !== 'favorites' || favorites.has(coin.symbol)) && (!query || `${coin.symbol} ${coin.name}`.toLocaleLowerCase().includes(query)));
    const sortValue = (coin: CoinQuote): number | null => { const quote = getDomesticQuote(coin, exchange); return sort === 'premium' ? quote.premiumPercent : sort === 'price' ? quote.price : sort === 'change' ? quote.changePercent : quote.volume24hKrw; };
    if (sort !== 'default') rows.sort((a, b) => { const first = sortValue(a), second = sortValue(b); return first === null ? second === null ? 0 : 1 : second === null ? -1 : second - first; });
    for (const coin of rows) {
      const row = node('tr');
      const identity = node('td', 'pm-identity-cell');
      const favorite = node('button', 'pm-favorite', favorites.has(coin.symbol) ? '★' : '☆');
      favorite.type = 'button'; favorite.setAttribute('aria-label', `${coin.name} 관심 코인 ${favorites.has(coin.symbol) ? '해제' : '추가'}`); favorite.setAttribute('aria-pressed', String(favorites.has(coin.symbol)));
      favorite.addEventListener('click', () => {
        if (favorites.has(coin.symbol)) favorites.delete(coin.symbol); else favorites.add(coin.symbol);
        try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites])); } catch { get('pm-network-note').textContent = '브라우저 저장 공간을 사용할 수 없어 관심 코인은 이번 방문에만 유지됩니다.'; }
        const oldScroll = app.querySelector('.pm-table-scroll')!.scrollLeft;
        renderTable(); app.querySelector('.pm-table-scroll')!.scrollLeft = oldScroll;
        body.querySelector<HTMLButtonElement>(`button[data-coin="${coin.symbol}"]`)?.focus({ preventScroll: true });
      });
      favorite.dataset.coin = coin.symbol;
      const coinLabel = node('div', 'pm-coin-label'); coinLabel.append(node('strong', '', coin.name), node('small', '', coin.symbol));
      identity.append(favorite, node('span', `pm-coin-icon pm-coin-${coin.symbol.toLowerCase()}`, coin.symbol === 'BTC' ? '₿' : coin.symbol.slice(0, 1)), coinLabel);
      const quote = getDomesticQuote(coin, exchange);
      const domestic = node('td'); domestic.append(node('strong', 'pm-price', price(quote.price)), node('small', `pm-${tone(quote.changePercent)}`, quote.price === null ? sourceStale(exchange) ? '수신 대기' : '시세 없음' : percent(quote.changePercent)));
      domestic.title = `${SOURCE_NAMES[exchange]} 마지막 시세 시각: ${dateTime(quote.updatedAt)}. 등락률은 ${exchange === 'bithumb' ? '한국시간 0시' : 'UTC 0시(한국시간 9시)'} 전일 종가 기준입니다. 거래가 뜸한 종목은 새 체결 전까지 이전 시세가 유지될 수 있습니다.`;
      if (sourceStale(exchange) && quote.price !== null) domestic.append(node('span', 'pm-stale-mini', '지연'));
      else if (quoteAge(quote.updatedAt)) domestic.append(node('small', '', quoteAge(quote.updatedAt)));
      const foreign = node('td'); foreign.append(node('strong', 'pm-price', coin.binanceUsdt === null ? '—' : `${price(coin.binanceUsdt, 'USDT')} USDT`), node('small', '', coin.referenceKrw === null ? '원화 환산 대기' : `≈ ${price(coin.referenceKrw)} 원`));
      foreign.title = `바이낸스 데이터 시각: ${dateTime(coin.binanceAt)} · 24시간 ${percent(coin.binanceChangePercent)}`;
      if (sourceStale('binance') && coin.binanceUsdt !== null) foreign.append(node('span', 'pm-stale-mini', '지연'));
      else if (quoteAge(coin.binanceAt)) foreign.append(node('small', '', quoteAge(coin.binanceAt)));
      const premium = node('td'); premium.append(node('span', `pm-premium pm-${tone(quote.premiumPercent)}`, percent(quote.premiumPercent)));
      if (quote.premiumPercent !== null && (sourceStale(exchange) || sourceStale('binance') || sourceStale('fx'))) premium.append(node('small', 'pm-stale-text', '지연값 포함'));
      const volume = node('td', 'pm-volume-column'); volume.append(node('strong', 'pm-price', quote.volume24hKrw === null ? '—' : `${number2.format(quote.volume24hKrw / 100_000_000)} 억`));
      row.append(identity, domestic, foreign, premium, volume); body.append(row);
    }
    get('pm-coin-count').textContent = String(allCoins.length || (payload ? 0 : 20));
    get('pm-results-count').textContent = `${rows.length}개 종목`;
    empty.hidden = rows.length > 0;
    empty.textContent = !payload ? networkFailed ? '시세 연결에 실패했습니다. 새로고침으로 다시 확인해 주세요.' : '공식 거래소에서 시세를 불러오는 중입니다.' : !allCoins.length ? '현재 거래소 시세를 받을 수 없습니다. 잠시 후 자동으로 다시 확인합니다.' : filter === 'favorites' && !favorites.size ? '코인 옆 별표를 눌러 관심 코인을 추가해 주세요.' : '검색 결과가 없습니다.';
  }
  function renderSources() {
    const list = get('pm-source-list'); list.replaceChildren();
    for (const source of ['upbit', 'bithumb', 'binance', 'fx'] as const) {
      const state = payload?.sources[source], missing = !state || state.status === 'unavailable';
      const stale = sourceStale(source);
      const li = node('li');
      const top = node('div'); top.append(node('strong', '', `${SOURCE_NAMES[source]}${source === exchange ? ' · 선택' : ''}${state?.via === 'browser' ? ' · 브라우저 수신' : ''}`), node('span', `pm-source-state ${missing ? 'is-offline' : stale ? 'is-stale' : 'is-fresh'}`, missing ? '연결 대기' : stale ? '지연' : source === 'fx' ? '기준값' : '정상'));
      li.append(top, node('small', '', `마지막 수신 ${state?.fetchedAt ? dateTime(state.fetchedAt) : '—'}`));
      if (state?.error) li.append(node('small', 'pm-source-error', state.error));
      list.append(li);
    }
  }
  function renderClock() {
    const text = get('pm-update-text');
    text.textContent = quoteBusy ? '시세 확인 중' : !navigator.onLine ? '오프라인 · 마지막 수신값' : networkFailed ? '연결 지연 · 자동 재시도 예정' : payload ? `${time(payload.generatedAt)} 확인 · ${Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000))}초 후 갱신` : '시세 연결 중';
    app.querySelector('.pm-live-dot')?.classList.toggle('is-delayed', networkFailed || !navigator.onLine || !!payload && (sourceStale(exchange) || sourceStale('binance')));
  }
  async function fetchJson(path: string): Promise<unknown> {
    const controller = new AbortController(); controllers.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 18_000);
    try { const response = await fetch(path, { signal: controller.signal, headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.json(); }
    finally { window.clearTimeout(timeout); controllers.delete(controller); }
  }
  async function refreshQuotes() {
    if (quoteBusy || disposed || activeView !== 'prices') return;
    quoteBusy = true; refreshButton.disabled = true; renderClock();
    try {
      const value = await fetchJson('/api/quotes') as QuotesPayload;
      if (!value || !Array.isArray(value.coins) || !value.sources || !Number.isFinite(value.generatedAt)) throw new Error('Invalid quote payload');
      if (disposed) return;
      const resolved = await browserQuotes.apply(value);
      if (disposed) return;
      payload = resolved; networkFailed = false;
      const direct = (['upbit', 'bithumb', 'binance'] as const).filter(source => resolved.sources[source]?.via === 'browser').map(source => SOURCE_NAMES[source]);
      get('pm-network-note').textContent = direct.length ? `${direct.join('·')} 시세는 이 브라우저가 공식 공개 API에서 직접 받습니다. 수신 가능 여부는 사용자의 네트워크에 따라 다릅니다.` : '';
    } catch {
      if (disposed) return;
      networkFailed = true;
      get('pm-network-note').textContent = payload ? '시세 서버 연결이 지연되어 마지막 수신값을 보여드립니다.' : '시세 서버에 연결하지 못했습니다. 60초 후 다시 확인합니다.';
    } finally {
      quoteBusy = false; nextRefreshAt = Date.now() + 60_000;
      if (!disposed) { refreshButton.disabled = false; renderMetrics(); renderTable(); renderSources(); renderClock(); }
    }
  }
  async function refreshRoom() {
    if (roomBusy || disposed || activeView !== 'prices') return;
    roomBusy = true;
    try {
      const status = await fetchJson('/api/status') as { roomOpen?: boolean; onlineCount?: number; capacity?: number; settings?: { notice?: string; donationUrl?: string } };
      if (disposed) return;
      const count = Number.isInteger(status.onlineCount) && status.onlineCount! >= 0 ? status.onlineCount! : null;
      const capacity = Number.isInteger(status.capacity) && status.capacity! > 0 ? status.capacity! : 20;
      get('pm-room-count').textContent = `${count ?? '—'} / ${capacity}`;
      get('pm-room-state').textContent = status.roomOpen === false ? '현재 사무실 휴장 중' : count !== null && count >= capacity ? '만석 · 시세 페이지는 이용 가능' : status.roomOpen === true ? '사무실 운영 중' : '운영 상태 확인 중';
      const notice = typeof status.settings?.notice === 'string' ? status.settings.notice.trim() : '';
      get('pm-notice').textContent = notice; get('pm-notice').hidden = !notice;
      support.setUrl(typeof status.settings?.donationUrl === 'string' ? status.settings.donationUrl : '');
    } catch { if (!disposed) get('pm-room-state').textContent = '사무실 상태 확인 지연'; }
    finally { roomBusy = false; nextRoomRefreshAt = Date.now() + 60_000; }
  }

  get<HTMLInputElement>('pm-search').addEventListener('input', event => { query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase(); renderTable(); });
  get<HTMLSelectElement>('pm-sort').addEventListener('change', event => { sort = (event.target as HTMLSelectElement).value as SortKey; renderTable(); });
  app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.filter === 'favorites' ? 'favorites' : 'all';
    app.querySelectorAll('[data-filter]').forEach(candidate => candidate.setAttribute('aria-pressed', String(candidate === button)));
    renderTable();
  }));
  refreshButton.addEventListener('click', () => { void refreshQuotes(); void refreshRoom(); });
  const frame = document.createElement('iframe'); frame.title = 'TradingView 비트코인 USDT 1분봉 차트';
  frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  let chartTheme: ResolvedTheme | null = null;
  repaintChart = resolved => {
    if (chartTheme === resolved || disposed) return;
    chartTheme = resolved;
    const config = { autosize: true, symbol: 'BINANCE:BTCUSDT', interval: '1', timezone: 'Asia/Seoul', theme: resolved, style: '1', locale: 'ko', allow_symbol_change: false, hide_side_toolbar: true, hide_top_toolbar: false, hide_legend: false, save_image: false, calendar: false, support_host: 'https://www.tradingview.com' };
    frame.srcdoc = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;background:${resolved === 'dark' ? '#131e2b' : '#fff'};color-scheme:${resolved}}.tradingview-widget-container{height:100%;width:100%}.tradingview-widget-container__widget{height:calc(100% - 28px);width:100%}.tradingview-widget-copyright{height:28px;line-height:28px;text-align:center;font:11px/28px Arial,sans-serif}a{color:${resolved === 'dark' ? '#a5c0d1' : '#587d8f'};text-decoration:none}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/symbols/BTCUSDT/?exchange=BINANCE" rel="noopener nofollow" target="_blank">BTCUSDT chart by TradingView</a></div><script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>${JSON.stringify(config)}</script></div></body></html>`;
  };
  get('pm-chart-host').append(frame);
  if (activeView === 'prices') repaintChart(theme.resolved);
  const visible = refreshVisiblePrices;
  const timer = window.setInterval(() => { if (activeView === 'prices' && !document.hidden) renderClock(); refreshVisiblePrices(); }, 1_000);
  const staleTimer = window.setInterval(() => { if (!disposed && payload && activeView === 'prices' && !document.hidden) { renderMetrics(); renderSources(); } }, 30_000);
  document.addEventListener('visibilitychange', visible);
  renderMetrics(); renderSources(); renderTable();
  const dispose = () => { if (disposed) return; disposed = true; window.clearInterval(timer); window.clearInterval(staleTimer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('popstate', syncView); window.removeEventListener('pagehide', onPageHide); controllers.forEach(controller => controller.abort()); browserQuotes.dispose(); support.dispose(); community.dispose(); theme.dispose(); frame.remove(); document.body.classList.remove('markets-page'); };
  const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) dispose(); };
  window.addEventListener('pagehide', onPageHide);
  return { dispose };
}
