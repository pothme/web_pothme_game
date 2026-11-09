import { MARKET_TAPES, type MarketTapeRegion } from '../shared/market-tapes';
import { CHART_INTERVALS, type ChartInterval } from '../shared/office-settings';

const KOREAN_EMBED_SCRIPT = 'https://vunelix.com/assets/bundles/js/widgets/charts/vunelix-advanced-chart.js';
const TAPE_EMBED_SCRIPT = 'https://vunelix.com/assets/bundles/js/widgets/ticker/vunelix-ticker-tape.js';
const MESSAGE_TYPE = 'podeumgo-market-chart';
function html(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function koreanWidgetDocument(symbol: string, token: string, compact: boolean, interval: ChartInterval): string {
  const period = ({ '1': '1m', '5': '5m', '15': '15m', '60': '1H', D: '1D' } as const)[interval];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#0c1823;color-scheme:dark}*{box-sizing:border-box}
    vunelix-advanced-chart{display:block;width:100%;height:100%;min-height:0!important;aspect-ratio:auto!important}iframe{border:0}
    </style></head><body><vunelix-advanced-chart data-symbol="${html(symbol)}" data-period="${period}" data-timezone="Asia/Seoul" data-chart-type="candles" data-show-search="false" data-show-toolbar="false" data-show-timeframes="false" data-show-settings="false" data-show-range="false" ${compact ? 'data-show-sidebar="false" data-show-undo-redo="false"' : ''} data-show-multi-chart="false" data-show-replay="false" data-show-templates="false" data-show-capture="false" data-change-url="false" data-enable-cache="false" data-theme="dark"></vunelix-advanced-chart><script>
    (() => {
      const token = ${scriptJson(token)}, type = ${scriptJson(MESSAGE_TYPE)};
      const signal = phase => parent.postMessage({ type, token, phase }, '*');
      const host = document.querySelector('vunelix-advanced-chart');
      let finished = false, poll;
      const watched = new WeakSet();
      const done = phase => { if (finished) return; finished = true; clearInterval(poll); observer.disconnect(); signal(phase); };
      const inspect = () => {
        if (finished) return;
        const roots = [host];
        if (/Widget could not be loaded\.|Domain not registered/.test(host.shadowRoot?.textContent ?? host.textContent)) { done('error'); return; }
        for (let i = 0; i < roots.length; i++) {
          const root = roots[i];
          if (root.shadowRoot) roots.push(root.shadowRoot);
          for (const child of root.querySelectorAll('*')) if (child.shadowRoot) roots.push(child.shadowRoot);
          for (const frame of root.querySelectorAll('iframe')) {
            if (watched.has(frame)) continue;
            watched.add(frame); frame.title = ${scriptJson(`${symbol} · Vunelix 국내 주식 차트`)};
            frame.addEventListener('load', () => done('loaded'), { once: true });
            frame.addEventListener('error', () => done('error'), { once: true });
          }
          // Some versions render directly instead of hosting an iframe. A
          // visible canvas proves renderer readiness, not quote freshness.
          for (const canvas of root.querySelectorAll('canvas')) {
            if (canvas.width > 1 && canvas.height > 1 && canvas.getBoundingClientRect().width > 1) done('loaded');
          }
        }
      };
      const observer = new MutationObserver(inspect); observer.observe(host, { childList: true, subtree: true });
      window.addEventListener('message', event => {
        if (event.source === parent && event.data?.type === type && event.data?.token === token && event.data?.action === 'resize') { window.dispatchEvent(new Event('resize')); inspect(); }
      });
      const script = document.createElement('script'); script.type = 'module'; script.src = ${scriptJson(KOREAN_EMBED_SCRIPT)};
      script.onerror = () => done('error');
      // Switching to the office can hide this chart before its renderer loads.
      // Continue checking until it becomes visible so late readiness clears
      // the parent's timeout message instead of permanently covering the chart.
      script.onload = () => { inspect(); if (!finished) poll = setInterval(inspect, 500); };
      signal('loading'); document.body.appendChild(script);
      window.addEventListener('pagehide', () => { clearInterval(poll); observer.disconnect(); }, { once: true });
    })();
    </script></body></html>`;
}

export function tickerDocument(region: MarketTapeRegion, token: string): string {
  const symbols = MARKET_TAPES[region].symbols.map(item => item.symbol).join(',');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(MARKET_TAPES[region].label)}</title><style>
    html,body{width:100%;height:100%;margin:0;background:#3179ed;color:#fff;color-scheme:dark;font-family:Arial,sans-serif}*{box-sizing:border-box}body{overflow:hidden}
    vunelix-ticker-tape{display:block;width:100%;min-height:40px}#ticker-loading{position:absolute;inset:0;display:flex;align-items:center;padding:0 12px;font-size:12px;background:#3179ed}
    </style></head><body><div id="ticker-loading">시세를 연결하고 있어요…</div><vunelix-ticker-tape
    data-symbols="${html(symbols)}" data-metrics="active.c,active.ch,active.chp" data-time-period="1d" data-ui-template="inline"
    data-show-symbol="false" data-show-full-name="true" data-show-exchange="false" data-show-flag="true" data-show-hover="false" data-show-metric-label="false"
    data-speed="28" data-direction="auto" data-pause-on-hover="true" data-stop-marquee="false" data-card-style="bordered" data-item-spacing="14" data-show-border="false"
    data-enable-links="true" data-link-target="_blank" data-animation-mode="digits" data-theme="dark" data-loading-placeholder="#ticker-loading"
    data-bg-color="#3179ed,#3179ed" data-bg-secondary-color="#2568cf,#2568cf" data-text-color="#ffffff,#ffffff" data-text-secondary-color="#e2edff,#e2edff"
    data-positive-color="#45ffd5,#45ffd5" data-negative-color="#ffd1d5,#ffd1d5" data-border-color="#7dabff,#7dabff"
    data-custom-css=".ticker-title{height:20px;min-width:0;max-width:190px;overflow:hidden}.ticker-title strong{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px}.ticker-top{min-height:26px}"></vunelix-ticker-tape><script>
    (() => {
      const token=${scriptJson(token)}, type='podeumgo-market-tape';
      const signal=phase=>parent.postMessage({type,token,phase},'*');
      const host=document.querySelector('vunelix-ticker-tape');
      const reduced=matchMedia('(prefers-reduced-motion: reduce)');
      let manualPause=false, finished=false, lastPhase='', poll;
      const pause=()=>host.setAttribute('data-stop-marquee',String(manualPause||reduced.matches));
      reduced.addEventListener('change',pause); pause();
      const done=phase=>{if(finished)return;if(phase==='loaded'){finished=true;clearInterval(poll);}if(phase!==lastPhase){lastPhase=phase;signal(phase);}};
      const inspect=()=>{
        if(finished)return;
        const roots=[host];
        for(let i=0;i<roots.length;i++){
          const root=roots[i];if(root.shadowRoot)roots.push(root.shadowRoot);
          for(const child of root.querySelectorAll('*'))if(child.shadowRoot)roots.push(child.shadowRoot);
          if(/Widget could not be loaded|Domain not registered|Failed to load/i.test(root.textContent||'')){done('error');return;}
        }
        // A rendered quote proves widget readiness, not exchange freshness.
        // Some vendor versions retain the optional loading placeholder.
        if(roots.some(root=>Array.from(root.querySelectorAll('.ticker-price-main')).some(price=>/[0-9]/.test(price.textContent||'')))){
          document.getElementById('ticker-loading')?.remove();done('loaded');
        }
      };
      window.addEventListener('message',event=>{
        if(event.source!==parent||event.data?.type!==type||event.data?.token!==token)return;
        if(event.data.action==='pause'){manualPause=event.data.paused===true;pause();}
        if(event.data.action==='resize')window.dispatchEvent(new Event('resize'));
      });
      const script=document.createElement('script');script.type='module';script.src=${scriptJson(TAPE_EMBED_SCRIPT)};
      // Off-screen wall widgets may defer their data until the chart is opened.
      // A timeout can show retry UI, but later readiness must still recover it.
      script.onerror=()=>done('error');script.onload=()=>{inspect();if(!finished)poll=setInterval(inspect,500);};
      signal('loading');document.body.appendChild(script);
      const timeout=setTimeout(()=>{inspect();if(!finished)done('error');},20000);
      window.addEventListener('pagehide',()=>{clearTimeout(timeout);clearInterval(poll);reduced.removeEventListener('change',pause);},{once:true});
    })();</script></body></html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !['/', '/ticker'].includes(url.pathname)) return new Response('Not found', { status: 404 });
    const symbol = url.searchParams.get('symbol') ?? '';
    const token = url.searchParams.get('token') ?? '';
    const region = url.searchParams.get('market');
    const interval = url.searchParams.get('interval') ?? '1';
    if (url.pathname === '/' && !CHART_INTERVALS.includes(interval as ChartInterval)) return new Response('Invalid interval', { status: 400 });
    if (!/^[a-f0-9-]{36}$/.test(token)) return new Response('Invalid token', { status: 400 });
    if (url.pathname === '/ticker' ? region !== 'us' && region !== 'kr' : !/^KRX:[0-9]{6}$/.test(symbol)) return new Response('Invalid market', { status: 400 });
    const document = url.pathname === '/ticker' ? tickerDocument(region as MarketTapeRegion, token) : koreanWidgetDocument(symbol, token, url.searchParams.get('compact') === '1', interval as ChartInterval);
    return new Response(document, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "frame-ancestors https://podeumgo.podeumgo.workers.dev http://127.0.0.1:8890 http://127.0.0.1:8891",
    } });
  },
} satisfies ExportedHandler;
