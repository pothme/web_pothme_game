import { MARKET_TAPES } from '../shared/market-tapes';
import './market-tapes.css';

const TAPE_ORIGIN = 'https://podeumgo-charts.podeumgo.workers.dev';
const MESSAGE_TYPE = 'podeumgo-market-tape';
type TapeMarket = keyof typeof MARKET_TAPES;

export function createMarketTapes() {
  let disposed = false;
  let visible = true;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motionPreference.matches;
  let userSetPause = false;
  let infoTrigger: HTMLButtonElement | null = null;
  const info = document.createElement('dialog');
  info.className = 'market-tape-info';
  const infoId = `market-tape-info-${crypto.randomUUID()}`;
  info.id = infoId;
  info.setAttribute('aria-labelledby', `${infoId}-title`);
  info.innerHTML = `<header class="market-tape-info-header"><h2 id="${infoId}-title"></h2><button type="button" aria-label="시세띠 안내 닫기">닫기 ×</button></header><div class="market-tape-info-body"></div>`;
  document.body.appendChild(info);
  const infoTitle = info.querySelector<HTMLHeadingElement>('h2')!;
  const infoBody = info.querySelector<HTMLDivElement>('.market-tape-info-body')!;
  const infoClose = info.querySelector<HTMLButtonElement>('button')!;
  const pauseButton = document.createElement('button'); pauseButton.type = 'button'; pauseButton.className = 'market-tape-pause';
  function updatePauseButton() {
    pauseButton.textContent = paused ? '시세띠 흐름 다시 시작' : '시세띠 흐름 멈추기';
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.title = '위·아래 시세띠의 흐름을 함께 조절합니다.';
  }
  pauseButton.onclick = () => {
    userSetPause = true; paused = !paused;
    updatePauseButton(); top.syncPause(); bottom.syncPause();
  };
  updatePauseButton();
  infoClose.onclick = () => info.close();
  info.addEventListener('close', () => {
    infoTrigger?.setAttribute('aria-expanded', 'false');
    if (infoTrigger?.isConnected) infoTrigger.focus({ preventScroll: true });
  });
  info.addEventListener('click', event => {
    if (event.target !== info) return;
    const bounds = info.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) info.close();
  });
  function openInfo(market: TapeMarket, trigger: HTMLButtonElement) {
    const metadata = MARKET_TAPES[market];
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
    infoTrigger = trigger;
    infoTitle.textContent = metadata.label;
    const scope = Object.assign(document.createElement('p'), { className: 'market-tape-info-scope', textContent: metadata.scope });
    const basis = Object.assign(document.createElement('p'), { textContent: `선정 기준일: ${metadata.asOf}. 표시 종목과 순서는 이 날짜의 시가총액 기준으로 고정한 목록이며, 실시간으로 순위를 계산하지 않습니다.` });
    const delay = Object.assign(document.createElement('p'), { textContent: '시세는 Vunelix 제공 데이터로 갱신됩니다. 거래소·종목별로 지연되거나 표시가 제한될 수 있으며, 시세의 갱신과 순위의 기준일은 서로 다릅니다.' });
    const list = document.createElement('ol');
    for (const item of metadata.symbols) {
      const row = document.createElement('li');
      const name = document.createElement('span'); name.textContent = item.name;
      const symbol = document.createElement('small'); symbol.textContent = item.symbol;
      row.append(name, symbol); list.appendChild(row);
    }
    const sources = document.createElement('p'); sources.className = 'market-tape-info-sources';
    sources.append(document.createTextNode('선정 자료: '));
    for (const [index, item] of metadata.sources.entries()) {
      if (index) sources.append(document.createTextNode(' · '));
      const link = document.createElement('a'); link.textContent = item.title; link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      sources.appendChild(link);
    }
    infoBody.replaceChildren(scope, basis, delay, pauseButton, list, sources);
    trigger.setAttribute('aria-expanded', 'true');
    info.showModal(); infoClose.focus({ preventScroll: true });
  }

  function createTape(market: TapeMarket) {
    const metadata = MARKET_TAPES[market];
    const element = document.createElement('section');
    element.className = `market-tape market-tape-${market}`;
    element.setAttribute('aria-label', `${metadata.label} 시세띠`);
    const details = document.createElement('button');
    details.type = 'button'; details.className = 'market-tape-details';
    details.setAttribute('aria-label', `${metadata.label} 선정 기준과 시세 안내`);
    details.setAttribute('aria-haspopup', 'dialog'); details.setAttribute('aria-controls', infoId); details.setAttribute('aria-expanded', 'false');
    details.title = `${metadata.label} · ${metadata.asOf} 선정 · 시세 지연 가능`;
    const label = document.createElement('strong'); label.textContent = market === 'us' ? '미국 TOP10' : '국내 TOP10';
    const hint = Object.assign(document.createElement('span'), { textContent: 'ⓘ' }); hint.setAttribute('aria-hidden', 'true');
    details.append(label, hint);
    const viewport = document.createElement('div'); viewport.className = 'market-tape-viewport';
    const status = document.createElement('div'); status.className = 'market-tape-status'; status.setAttribute('role', 'status');
    const statusText = document.createElement('span');
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '다시 연결'; retry.hidden = true;
    retry.setAttribute('aria-label', `${metadata.label} 시세 다시 연결`);
    status.append(statusText, retry); viewport.appendChild(status); element.append(details, viewport);
    let frame: HTMLIFrameElement | null = null;
    let token = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    function showStatus(phase: 'loading' | 'error') {
      status.hidden = false;
      statusText.textContent = phase === 'loading' ? '시세 연결 중…' : '시세 연결 실패 ·';
      retry.hidden = phase !== 'error';
      element.setAttribute('aria-busy', String(phase === 'loading'));
    }
    function unmount() {
      clearTimeout(timer); timer = undefined; token = '';
      frame?.remove(); frame = null;
    }
    function syncPause() {
      frame?.contentWindow?.postMessage({ type: MESSAGE_TYPE, token, action: 'pause', paused }, TAPE_ORIGIN);
    }
    function mount() {
      if (disposed || !visible) return;
      unmount(); showStatus('loading');
      token = crypto.randomUUID();
      frame = document.createElement('iframe'); frame.className = 'market-tape-frame';
      frame.title = `${metadata.label} · Vunelix 시세 · ${metadata.asOf} 선정`;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      const url = new URL('/ticker', TAPE_ORIGIN); url.searchParams.set('market', market); url.searchParams.set('token', token);
      frame.src = url.href;
      frame.addEventListener('load', syncPause);
      const currentFrame = frame;
      frame.addEventListener('error', () => {
        if (disposed || currentFrame !== frame) return;
        clearTimeout(timer); showStatus('error');
      });
      viewport.prepend(frame);
      timer = setTimeout(() => { if (!disposed && visible && frame) showStatus('error'); }, 20000);
    }
    function onMessage(event: MessageEvent) {
      if (disposed || !frame || event.origin !== TAPE_ORIGIN || event.source !== frame.contentWindow || !event.data || event.data.type !== MESSAGE_TYPE || event.data.token !== token) return;
      if (event.data.phase === 'loaded') {
        clearTimeout(timer); timer = undefined;
        status.hidden = true; element.setAttribute('aria-busy', 'false');
        syncPause();
      } else if (event.data.phase === 'error') {
        clearTimeout(timer); timer = undefined; showStatus('error');
      }
    }
    details.onclick = () => openInfo(market, details);
    retry.onclick = mount;
    window.addEventListener('message', onMessage);
    // The owner attaches both tapes before requesting the initial connections.
    showStatus('loading');
    return {
      element, mount, unmount, syncPause,
      dispose() {
        unmount(); window.removeEventListener('message', onMessage);
        details.onclick = null; retry.onclick = null; element.remove();
      },
    };
  }
  const top = createTape('us');
  const bottom = createTape('kr');
  const onMotionChange = () => {
    if (userSetPause) return;
    paused = motionPreference.matches;
    updatePauseButton(); top.syncPause(); bottom.syncPause();
  };
  motionPreference.addEventListener('change', onMotionChange);
  return {
    top: top.element,
    bottom: bottom.element,
    connect() { top.mount(); bottom.mount(); },
    beforeMove() { top.unmount(); bottom.unmount(); },
    afterMove() { top.mount(); bottom.mount(); },
    setVisible(next: boolean) {
      if (disposed || next === visible) return;
      visible = next;
      if (visible) { top.mount(); bottom.mount(); }
      else { top.unmount(); bottom.unmount(); if (info.open) info.close(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; top.dispose(); bottom.dispose();
      motionPreference.removeEventListener('change', onMotionChange);
      pauseButton.onclick = null;
      infoTrigger = null; infoClose.onclick = null; info.remove();
    },
  };
}
