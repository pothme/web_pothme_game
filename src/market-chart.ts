import './market-chart.css';
import { getMarketAssetType, getMarketRegion, type MarketSymbol } from '../shared/market-catalog';
import { compactLayout } from './responsive';
import { createMarketTapes } from './market-tapes';
import { CHART_INTERVALS, type ChartInterval } from '../shared/office-settings';
import { chartPresentation, tradingViewChartConfig } from '../shared/chart-presentation';

/** TradingView's hosted widget includes its own market feed; no API key or proxy. */
const EMBED_SCRIPT = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
const KOREAN_CHART_HOST = 'https://podeumgo-charts.podeumgo.workers.dev/';
const MESSAGE_TYPE = 'podeumgo-market-chart';
export const DEFAULT_MARKET_SYMBOL = 'BINANCE:BTCUSDT';

export interface MarketChartOptions {
  /** An explicitly sized wall or modal host. The component fills its content box. */
  host: HTMLElement;
  initialMarket?: MarketSymbol;
  showTapes?: boolean;
  embedded?: boolean;
  interval?: ChartInterval;
}
export interface MarketChart {
  element: HTMLElement;
  setSymbol: (symbol: string, name?: string, market?: MarketSymbol) => boolean;
  setInterval: (interval: ChartInterval) => void;
  moveTo: (host: HTMLElement) => void;
  /** Hiding unloads the feed; showing recreates the selected symbol. */
  setVisible: (visible: boolean) => void;
  resize: () => void;
  dispose: () => void;
}

function chartUrl(symbol: string): string {
  if (symbol.startsWith('KRX:')) return `https://vunelix.com/symbols/${encodeURIComponent(symbol.replace(':', '-'))}`;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}
function chartProvider(symbol: string): string { return symbol.startsWith('KRX:') ? 'Vunelix' : 'TradingView'; }
function html(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Official iframe-format embed, isolated so each symbol change/dispose releases
 * the vendor script's listeners as well as its iframe and data connection.
 * https://www.tradingview.com/widget-docs/tutorials/iframe/build-page/widget-integration/
 */
function widgetDocument(symbol: string, token: string, compact: boolean, interval: ChartInterval, metadata?: MarketSymbol, now = Date.now()): string {
  const config = tradingViewChartConfig(symbol, interval, compact, metadata, now);
  const displayedSymbol = config.symbol;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#0c1823;color:#a8b9c7;color-scheme:dark;font-family:Arial,sans-serif}
    *{box-sizing:border-box}.tradingview-widget-container{width:100%;height:100%}.tradingview-widget-container__widget{height:calc(100% - 32px);width:100%}
    .tradingview-widget-copyright{height:32px;line-height:32px;white-space:nowrap;text-align:center;font-size:12px;color:#a8b9c7!important;background:#0c1823}
    .tradingview-widget-copyright a{color:#7eacff;text-decoration:none}.tradingview-widget-copyright a:focus-visible{outline:2px solid #7eacff;outline-offset:3px}
    iframe{border:0}
    </style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="${html(chartUrl(displayedSymbol))}" rel="noopener nofollow" target="_blank"><span class="blue-text">${html(displayedSymbol)} 차트</span></a><span class="trademark"> by TradingView</span></div></div><script>
    (() => {
      const token = ${scriptJson(token)}, type = ${scriptJson(MESSAGE_TYPE)};
      const signal = phase => parent.postMessage({ type, token, phase }, '*');
      const container = document.querySelector('.tradingview-widget-container');
      const observer = new MutationObserver(() => {
        const frame = container.querySelector('iframe');
        if (!frame) return;
        observer.disconnect();
        frame.title = ${scriptJson(`${displayedSymbol} · TradingView 시장 차트`)};
        frame.addEventListener('load', () => signal('loaded'));
        frame.addEventListener('error', () => signal('error'));
      });
      observer.observe(container, { childList: true, subtree: true });
      window.addEventListener('message', event => {
        if (event.source === parent && event.data?.type === type && event.data?.token === token && event.data?.action === 'resize') window.dispatchEvent(new Event('resize'));
      });
      const script = document.createElement('script');
      script.type = 'text/javascript'; script.async = true;
      script.src = ${scriptJson(EMBED_SCRIPT)};
      script.textContent = JSON.stringify(${scriptJson(config)});
      script.onerror = () => signal('error');
      signal('loading'); container.appendChild(script);
    })();
    </script></body></html>`;
}

export function createMarketChart(options: MarketChartOptions): MarketChart {
  const element = document.createElement('section');
  element.className = options.embedded ? 'market-chart market-chart-embedded' : 'market-chart';
  element.setAttribute('aria-label', '공유 시장 차트');
  const heading = document.createElement('header');
  heading.className = 'market-chart-heading';
  const identity = document.createElement('div'); identity.className = 'market-chart-identity';
  const title = document.createElement('strong');
  const code = document.createElement('span');
  identity.append(title, code);
  const kind = document.createElement('span'); kind.className = 'market-chart-kind';
  heading.append(identity, kind);
  const viewport = document.createElement('div'); viewport.className = 'market-chart-viewport';
  const message = document.createElement('div'); message.className = 'market-chart-message';
  message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const messageTitle = document.createElement('strong');
  const messageText = document.createElement('span');
  message.append(messageTitle, messageText);
  const footer = document.createElement('footer'); footer.className = 'market-chart-footer';
  const dataNote = document.createElement('span'); dataNote.className = 'market-chart-data-note';
  const sessionNote = document.createElement('span'); sessionNote.className = 'market-chart-session-note'; sessionNote.hidden = true;
  const actions = document.createElement('div'); actions.className = 'market-chart-actions';
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '다시 연결';
  retry.title = '시장 차트를 새로 불러오기';
  const source = document.createElement('a'); source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = '원본 차트 ↗';
  const overnight = document.createElement('a'); overnight.className = 'market-chart-overnight'; overnight.target = '_blank'; overnight.rel = 'noopener noreferrer'; overnight.textContent = '야간 시세 ↗'; overnight.hidden = true;
  actions.append(retry, source, overnight); footer.append(dataNote, sessionNote, actions);
  const tapes = options.showTapes === false ? null : createMarketTapes();
  viewport.append(message);
  if (tapes) element.append(tapes.top);
  element.append(heading, viewport);
  if (tapes) element.append(tapes.bottom);
  element.append(footer); options.host.appendChild(element);
  tapes?.connect();

  let symbol = options.initialMarket?.symbol ?? DEFAULT_MARKET_SYMBOL;
  let name = options.initialMarket?.name ?? '비트코인 / 테더';
  let metadata: MarketSymbol | undefined = options.initialMarket;
  let interval: ChartInterval = options.interval ?? '1';
  let frame: HTMLIFrameElement | null = null;
  let mountedSymbol: string | null = null;
  let token = '';
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let retryLock: ReturnType<typeof setTimeout> | undefined;
  let resizeFrame = 0;
  let lastResize: { frame: HTMLIFrameElement; token: string; width: number; height: number; scale: number } | null = null;
  let visible = true;
  let disposed = false;
  let sourceTimer: ReturnType<typeof setInterval> | undefined;

  function labels(now = Date.now()) {
    const presentation = chartPresentation(symbol, interval, metadata, now), { crypto, market } = presentation;
    title.textContent = name;
    code.textContent = `${presentation.chartSymbol} · ${interval === 'D' ? '일봉' : `${interval}분봉`}`;
    kind.textContent = crypto ? 'CRYPTO · 현물' : getMarketAssetType(market) === 'etf' ? 'US ETF · 미국 ETF' : getMarketRegion(market) === 'KR' ? 'KR STOCK · 국내 주식' : 'US STOCK · 미국 주식';
    kind.classList.toggle('is-stock', !crypto);
    // A loaded chart does not prove freshness. Keep the US extended session
    // distinct from BOATS overnight and retain the vendor's delay disclosure:
    // https://www.tradingview.com/widget-docs/faq/data/
    dataNote.textContent = presentation.dataNote;
    sessionNote.textContent = presentation.sessionNote; sessionNote.hidden = !presentation.sessionNote;
    sessionNote.title = presentation.overnightActive ? '미국 심야 BOATS 거래 시세입니다. 휴장·거래 중단 때는 마지막 체결가가 표시될 수 있어요.' : '미국 정규장·프리마켓·애프터마켓 시세입니다. 거래소 시세가 지연될 수 있어요.';
    overnight.hidden = !presentation.overnightUrl;
    if (presentation.overnightUrl) overnight.href = presentation.overnightUrl; else overnight.removeAttribute('href');
    overnight.title = `${name} · TradingView BOATS 야간 시세를 새 창에서 확인`;
    overnight.textContent = presentation.overnightActive ? '야간 원본 ↗' : '야간 시세 ↗';
    overnight.setAttribute('aria-label', `${name} 야간 시세를 TradingView BOATS 원본에서 새 창으로 열기`);
    source.href = chartUrl(symbol);
    source.textContent = presentation.overnightUrl ? '정규·시간외 ↗' : '원본 차트 ↗';
    source.setAttribute('aria-label', `${name} ${presentation.overnightUrl ? '정규·시간외' : '원본'} 차트를 ${chartProvider(symbol)}에서 새 창으로 열기`);
    element.setAttribute('aria-label', `${name} · ${presentation.chartSymbol} 시장 차트`);
    if (frame) frame.title = `${name} · ${presentation.chartSymbol} ${chartProvider(symbol)} 차트`;
  }
  function showMessage(phase: 'loading' | 'error' | 'timeout') {
    message.hidden = false;
    message.classList.toggle('is-error', phase !== 'loading');
    messageTitle.textContent = phase === 'loading' ? '실제 시장 데이터를 불러오는 중' : '차트 연결을 확인해 주세요';
    messageText.textContent = phase === 'loading' ? `${name} · ${symbol}` : phase === 'timeout' ? '표시가 늦어지고 있어요. 다시 연결하거나 원본 차트에서 확인할 수 있어요.' : '외부 차트를 불러오지 못했어요. 다시 연결하거나 원본 차트에서 확인해 주세요.';
    element.setAttribute('aria-busy', String(phase === 'loading'));
  }
  function unmount() {
    clearTimeout(timeout); timeout = undefined;
    cancelAnimationFrame(resizeFrame); resizeFrame = 0; lastResize = null;
    token = '';
    frame?.remove(); frame = null; mountedSymbol = null;
  }
  function mount() {
    if (disposed || !visible) return;
    unmount();
    const now = Date.now(); mountedSymbol = chartPresentation(symbol, interval, metadata, now).chartSymbol;
    token = crypto.randomUUID();
    frame = document.createElement('iframe');
    frame.className = 'market-chart-frame';
    labels(now);
    // KRX runs on a separate origin: the vendor has a normal document origin
    // for its embed checks but cannot read the office's DOM or session cookies.
    // TradingView keeps its existing isolated srcdoc lifecycle.
    const korean = symbol.startsWith('KRX:');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    if (korean) {
      const url = new URL(KOREAN_CHART_HOST); url.searchParams.set('symbol', symbol); url.searchParams.set('token', token);
      url.searchParams.set('interval', interval);
      if (options.embedded || compactLayout.matches) url.searchParams.set('compact', '1');
      frame.src = url.href;
    } else frame.srcdoc = widgetDocument(symbol, token, !!options.embedded || compactLayout.matches, interval, metadata, now);
    showMessage('loading');
    viewport.prepend(frame);
    resize();
    timeout = setTimeout(() => { if (!disposed && visible && frame) showMessage('timeout'); }, 20000);
  }
  function refreshSessionSource() {
    if (disposed || !visible || document.hidden) return;
    const now = Date.now(), effective = chartPresentation(symbol, interval, metadata, now).chartSymbol;
    if (frame && mountedSymbol !== effective) mount();
    else labels(now);
  }
  function updateSourceTimer() {
    clearInterval(sourceTimer); sourceTimer = undefined;
    if (disposed || !visible || document.hidden) return;
    refreshSessionSource();
    sourceTimer = setInterval(refreshSessionSource, 60_000);
  }
  function onMessage(event: MessageEvent) {
    if (disposed || !frame || event.source !== frame.contentWindow || !event.data || event.data.type !== MESSAGE_TYPE || event.data.token !== token) return;
    if (event.data.phase === 'loaded') {
      // A loaded renderer proves neither quote availability nor market freshness.
      // Availability/errors remain the provider's visible responsibility.
      clearTimeout(timeout); timeout = undefined;
      message.hidden = true; element.setAttribute('aria-busy', 'false');
      // The mount-time message may precede the vendor's resize listener.
      // Readiness is a new sizing baseline, even at unchanged dimensions.
      lastResize = null; resize();
    } else if (event.data.phase === 'error') {
      clearTimeout(timeout); timeout = undefined; showMessage('error');
    }
  }
  function resize() {
    if (disposed || !visible || !frame) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (disposed || !visible || !frame) return;
      // A half-width phone cell needs room for the vendor's axes and toolbar.
      // Scale its full chart surface; keep our cell heading/expand control native.
      const width = viewport.clientWidth, height = viewport.clientHeight;
      // Hidden tabs have no usable plotting area. Invalidate the previous size
      // so showing one again delivers a resize even if its dimensions match.
      if (width <= 0 || height <= 0) { lastResize = null; return; }
      const scale = options.embedded && width < 300 ? width / 380 : 1;
      if (lastResize?.frame === frame && lastResize.token === token && lastResize.width === width && lastResize.height === height && lastResize.scale === scale) return;
      frame.style.width = scale < 1 ? '380px' : '100%';
      frame.style.height = scale < 1 ? `${height / scale}px` : '100%';
      frame.style.transformOrigin = 'top left';
      frame.style.transform = scale < 1 ? `scale(${scale})` : '';
      const target = frame.contentWindow;
      if (!target) return;
      target.postMessage({ type: MESSAGE_TYPE, token, action: 'resize' }, '*');
      lastResize = { frame, token, width, height, scale };
    });
  }
  const resizeObserver = new ResizeObserver(entries => {
    // Preserve a hidden observation even if the tab reopens before the queued
    // animation frame measures its final nonzero size.
    if (entries.some(entry => entry.contentRect.width <= 0 || entry.contentRect.height <= 0)) lastResize = null;
    resize();
  });
  resizeObserver.observe(element);
  window.addEventListener('message', onMessage);
  const onLayoutChange = () => { if (options.embedded) resize(); else if (visible && !disposed) mount(); };
  compactLayout.addEventListener('change', onLayoutChange);
  retry.onclick = () => {
    if (disposed || !visible || retry.disabled) return;
    retry.disabled = true; mount();
    clearTimeout(retryLock); retryLock = setTimeout(() => { retry.disabled = false; }, 1500);
  };
  document.addEventListener('visibilitychange', updateSourceTimer);
  labels(); mount(); updateSourceTimer();
  return {
    element,
    setInterval(next: ChartInterval) {
      if (disposed || !CHART_INTERVALS.includes(next) || interval === next) return;
      interval = next; labels(); if (visible) mount();
    },
    setSymbol(next: string, nextName?: string, nextMarket?: MarketSymbol) {
      if (disposed || typeof next !== 'string' || !/^[A-Z0-9_]{1,24}:[A-Z0-9_.-]{1,64}$/.test(next)) return false;
      const changed = symbol !== next;
      symbol = next; name = nextName?.trim().slice(0, 120) || next;
      metadata = nextMarket?.symbol === next ? nextMarket : undefined;
      labels();
      if (visible && (changed || mountedSymbol !== chartPresentation(symbol, interval, metadata).chartSymbol)) mount();
      return true;
    },
    moveTo(host: HTMLElement) {
      if (disposed || host === element.parentElement) { resize(); return; }
      const destination = host as HTMLElement & { moveBefore?: (node: Node, reference: Node | null) => void };
      if (destination.moveBefore && element.isConnected && host.isConnected) destination.moveBefore(element, null);
      else {
        // appendChild recreates an iframe's browsing context in older browsers.
        // Remove it first, then mount explicitly so the fresh connection gets
        // a new token, loading state, and timeout instead of a silent reload.
        unmount();
        tapes?.beforeMove();
        host.appendChild(element);
        mount();
        tapes?.afterMove();
      }
      resize();
    },
    setVisible(next: boolean) {
      if (disposed || visible === next) return;
      visible = next; element.hidden = !next;
      tapes?.setVisible(next);
      if (next) mount(); else { unmount(); element.setAttribute('aria-busy', 'false'); }
      updateSourceTimer();
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true; unmount(); clearTimeout(retryLock); clearInterval(sourceTimer); cancelAnimationFrame(resizeFrame);
      tapes?.dispose();
      resizeObserver.disconnect(); window.removeEventListener('message', onMessage);
      compactLayout.removeEventListener('change', onLayoutChange);
      document.removeEventListener('visibilitychange', updateSourceTimer);
      retry.onclick = null; element.remove();
    },
  };
}
