import type { MarketSymbol } from '../shared/market-catalog';
import { DEFAULT_CHARTS, normalizeOfficeCharts } from '../shared/office-charts';
import { createMarketChart } from './market-chart';
import { createMarketTapes } from './market-tapes';
import type { ChartInterval } from '../shared/office-settings';
import { compactLayout } from './responsive';
import './market-board.css';

/** Eight feeds shared by two four-panel walls and one flat chart viewer. */
export function createMarketBoard(options: { host: HTMLElement; onActiveSlot: (slot: number) => void }) {
  const element = document.createElement('section'); element.className = 'market-board';
  element.setAttribute('aria-label', '정면과 후면 공유 시장 차트');
  const tapes = createMarketTapes();
  const toolbar = document.createElement('div'); toolbar.className = 'market-board-toolbar';
  const title = document.createElement('strong'); title.textContent = '공유 차트 · 가로 4분할';
  const hint = document.createElement('span'); hint.textContent = '각 칸의 ↗ 버튼으로 크게 보기';
  const tabs = document.createElement('div'); tabs.className = 'market-board-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '종목별 차트 확대');
  const tabButtons = DEFAULT_CHARTS.map((_, slot) => {
    const button = document.createElement('button'); button.type = 'button';
    const number = document.createElement('span'); number.className = 'market-tab-number'; number.textContent = String(slot + 1);
    const name = document.createElement('span'); name.className = 'market-tab-name';
    button.append(number, name);
    button.onclick = () => focus(slot); tabs.append(button); return button;
  });
  const all = document.createElement('button'); all.type = 'button'; all.textContent = '4개 보기'; all.setAttribute('aria-label', '가로 4분할로 돌아가기'); all.hidden = true;
  toolbar.append(title, hint, tabs, all);
  const navigation = document.createElement('nav'); navigation.className = 'market-board-navigation'; navigation.hidden = true;
  navigation.setAttribute('aria-label', '가로 차트 이동');
  const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '← 이전 차트';
  previous.setAttribute('aria-label', '이전 차트 보기');
  const position = document.createElement('span'); position.className = 'market-board-position';
  position.setAttribute('role', 'status'); position.setAttribute('aria-live', 'polite');
  const next = document.createElement('button'); next.type = 'button'; next.textContent = '다음 차트 →';
  next.setAttribute('aria-label', '다음 차트 보기');
  navigation.append(previous, position, next);
  const grid = document.createElement('div'); grid.className = 'market-board-grid';
  grid.tabIndex = 0; grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', '가로 4분할 차트. 좌우 방향키나 이전·다음 버튼으로 이동할 수 있어요.');
  const note = document.createElement('p'); note.className = 'market-board-note';
  note.textContent = 'Vunelix · TradingView 제공 / 주식·ETF 시세는 지연될 수 있어요.';
  element.append(tapes.top, toolbar, navigation, grid, tapes.bottom, note); options.host.appendChild(element);
  const rearElement = document.createElement('section'); rearElement.className = 'market-board market-board-rear';
  rearElement.setAttribute('aria-label', '후면 코인 차트 가로 4분할');
  const rearTitle = document.createElement('div'); rearTitle.className = 'market-board-toolbar'; rearTitle.textContent = 'CRYPTO LOUNGE · 후면 코인 차트';
  const rearGrid = document.createElement('div'); rearGrid.className = 'market-board-grid';
  const rearNote = document.createElement('p'); rearNote.className = 'market-board-note'; rearNote.textContent = 'TradingView 제공 · 거래소별 시세';
  rearElement.append(rearTitle, rearGrid, rearNote);
  let markets = normalizeOfficeCharts(DEFAULT_CHARTS);
  let activeSlot = 0, focusedSlot: number | null = null, disposed = false;
  let wallMode = false;
  let navigationFrame = 0, lastGridWidth = 0;
  const cells = markets.map((market, slot) => {
    const panel = document.createElement('section'); panel.className = 'market-board-cell'; panel.dataset.slot = String(slot);
    const header = document.createElement('header'); header.className = 'market-board-cell-heading';
    const select = document.createElement('button'); select.type = 'button'; select.className = 'market-board-select';
    select.onclick = () => choose(slot);
    const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'market-board-expand'; expand.textContent = '↗';
    expand.onclick = () => focus(slot);
    const host = document.createElement('div'); host.className = 'market-board-cell-host';
    header.append(select, expand); panel.append(header, host); grid.append(panel);
    const chart = createMarketChart({ host, initialMarket: market, showTapes: false, embedded: true });
    return { panel, select, expand, chart };
  });
  function valid(slot: number) { return Number.isInteger(slot) && slot >= 0 && slot < cells.length; }
  function mobilePanel() { return compactLayout.matches && !!element.closest('#mobile-chart-host,#large-chart-host'); }
  const cryptoNames: Record<string, string> = { BTCUSDT: '비트코인', ETHUSDT: '이더리움', XRPUSDT: '리플', USDTUSD: '테더' };
  function shortName(market: MarketSymbol) { return market.kind === 'crypto' ? (cryptoNames[market.symbol.split(':')[1]!] ?? market.symbol.split(':')[1]!) : market.symbol.startsWith('KRX:') ? market.name.replace(/\s+[A-Za-z].*$/, '') : market.symbol.split(':').slice(1).join(':'); }
  function scrollTarget(slot: number) {
    const first = cells.find(cell => !cell.panel.hidden && cell.panel.parentElement === grid) ?? cells[0]!;
    return Math.max(0, Math.min(cells[slot]!.panel.offsetLeft - first.panel.offsetLeft, grid.scrollWidth - grid.clientWidth));
  }
  function updateNavigation() {
    if (disposed) return;
    const mobile = mobilePanel();
    grid.setAttribute('aria-label', mobile ? '공유 차트. 위의 종목 탭으로 전환할 수 있어요.' : '가로 4분할 차트. 좌우 방향키나 이전·다음 버튼으로 이동할 수 있어요.');
    tabButtons.forEach((button, slot) => button.setAttribute('aria-pressed', String(mobile ? activeSlot === slot : focusedSlot === slot)));
    element.setAttribute('aria-label', mobile ? `${activeSlot + 1}번 공유 시장 차트` : focusedSlot === null ? '공유 시장 차트 가로 4분할' : `${focusedSlot + 1}번 공유 시장 차트 크게 보기`);
    const scrollable = !wallMode && focusedSlot === null && grid.clientWidth > 0 && grid.scrollWidth > grid.clientWidth + 2;
    navigation.hidden = !scrollable;
    if (!scrollable) return;
    const firstOffset = cells.find(cell => !cell.panel.hidden && cell.panel.parentElement === grid)?.panel.offsetLeft ?? 0;
    const visible = cells.flatMap((cell, slot) => {
      if (cell.panel.hidden || cell.panel.parentElement !== grid) return [];
      const left = cell.panel.offsetLeft - firstOffset;
      const overlap = Math.min(left + cell.panel.offsetWidth, grid.scrollLeft + grid.clientWidth) - Math.max(left, grid.scrollLeft);
      return overlap > Math.min(64, cell.panel.offsetWidth / 4) ? [slot] : [];
    });
    previous.disabled = grid.scrollLeft <= 2;
    next.disabled = grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 2;
    const first = visible[0] ?? activeSlot, last = visible.at(-1) ?? first;
    const text = first === last ? `${first + 1} / ${cells.length} · ${shortName(markets[first]!)}` : `${first + 1}–${last + 1}번 / ${cells.length} · 좌우 이동`;
    if (position.textContent !== text) position.textContent = text;
  }
  function queueNavigation() {
    cancelAnimationFrame(navigationFrame);
    navigationFrame = requestAnimationFrame(() => {
      updateNavigation();
      if (mobilePanel()) {
        const button = tabButtons[activeSlot]!, tabBox = tabs.getBoundingClientRect(), box = button.getBoundingClientRect();
        if (box.left < tabBox.left) tabs.scrollLeft += box.left - tabBox.left;
        else if (box.right > tabBox.right) tabs.scrollLeft += box.right - tabBox.right;
      }
    });
  }
  function scrollToSlot(slot: number) {
    grid.scrollTo({ left: focusedSlot === null ? scrollTarget(slot) : 0, behavior: 'auto' });
    queueNavigation();
  }
  function render() {
    element.classList.toggle('is-focused', !wallMode && focusedSlot !== null);
    element.setAttribute('aria-label', focusedSlot === null ? '공유 시장 차트 가로 4분할' : `${focusedSlot + 1}번 공유 시장 차트 크게 보기`);
    all.hidden = wallMode || focusedSlot === null; hint.hidden = wallMode || focusedSlot !== null;
    title.textContent = wallMode ? '정면 · 주식·ETF 차트' : focusedSlot === null ? `${activeSlot < 4 ? '정면' : '후면'} 차트 · 가로 4분할` : `${shortName(markets[activeSlot]!)} · 크게 보기`;
    all.textContent = `${activeSlot < 4 ? '정면' : '후면'} 4개 보기`;
    cells.forEach((cell, slot) => {
      const market = markets[slot]!;
      const short = shortName(market);
      cell.panel.hidden = !wallMode && (mobilePanel() ? activeSlot !== slot : focusedSlot !== null ? focusedSlot !== slot : Math.floor(activeSlot / 4) !== Math.floor(slot / 4));
      cell.chart.setVisible(!cell.panel.hidden);
      cell.panel.classList.toggle('is-active', activeSlot === slot);
      cell.panel.setAttribute('aria-label', `${slot + 1}번 차트 · ${market.name}`);
      cell.select.textContent = `${slot + 1}  ${short}`;
      cell.select.title = `${market.name} · ${market.symbol} / 볼 차트 선택`;
      cell.select.setAttribute('aria-label', `${slot + 1}번 차트 선택 · ${short}`);
      cell.select.setAttribute('aria-pressed', String(activeSlot === slot));
      cell.expand.hidden = focusedSlot === slot;
      cell.expand.setAttribute('aria-label', `${slot + 1}번 차트 크게 보기 · ${short}`);
      tabButtons[slot]!.hidden = wallMode && slot >= 4;
      tabButtons[slot]!.setAttribute('aria-label', `${slot < 4 ? '정면' : '후면'} ${slot % 4 + 1}번 차트 확대 · ${short}`);
      tabButtons[slot]!.querySelector('.market-tab-name')!.textContent = short === 'BTCUSDT' ? '비트코인' : short;
      tabButtons[slot]!.title = `${slot + 1} ${short} 크게 보기`;
      tabButtons[slot]!.setAttribute('aria-pressed', String(focusedSlot === slot));
    });
    queueNavigation();
  }
  function resize() { if (!disposed) { cells.forEach(cell => cell.chart.resize()); queueNavigation(); } }
  function setActiveSlot(slot: number) {
    if (!valid(slot) || disposed) return false;
    activeSlot = slot;
    if (focusedSlot !== null) focusedSlot = slot;
    render(); scrollToSlot(slot); resize(); return true;
  }
  function choose(slot: number) { if (setActiveSlot(slot)) options.onActiveSlot(slot); }
  function focus(slot: number) {
    if (!valid(slot) || disposed) return;
    focusedSlot = wallMode ? null : slot; choose(slot); resize();
    (mobilePanel() ? tabButtons[slot]! : all).focus({ preventScroll: true });
  }
  function showAll(focusControl = false) {
    if (disposed) return;
    if (focusedSlot !== null) { focusedSlot = null; render(); scrollToSlot(activeSlot); resize(); }
    if (focusControl) cells[activeSlot]!.expand.focus({ preventScroll: true });
  }
  all.onclick = () => showAll(true);
  function step(direction: number) {
    if (disposed || focusedSlot !== null) return;
    const candidates = cells.map((_, slot) => slot).filter(slot => !cells[slot]!.panel.hidden && (direction > 0 ? scrollTarget(slot) > grid.scrollLeft + 2 : scrollTarget(slot) < grid.scrollLeft - 2));
    const slot = direction > 0 ? candidates[0] : candidates.at(-1);
    if (slot !== undefined) choose(slot);
  }
  previous.onclick = () => step(-1); next.onclick = () => step(1);
  grid.addEventListener('scroll', queueNavigation, { passive: true });
  grid.addEventListener('keydown', event => {
    if (event.target !== grid || focusedSlot !== null || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home' || event.key === 'End') { const slot = event.key === 'Home' ? 0 : cells.length - 1; choose(slot); scrollToSlot(slot); }
    else step(event.key === 'ArrowLeft' ? -1 : 1);
  });
  const resizeObserver = new ResizeObserver(() => {
    if (disposed) return;
    if (grid.clientWidth !== lastGridWidth) { lastGridWidth = grid.clientWidth; scrollToSlot(activeSlot); }
    queueNavigation();
  });
  resizeObserver.observe(grid);
  render(); tapes.connect();
  function moveNode(node: HTMLElement, host: HTMLElement, charts: typeof cells, withTapes = false) {
    if (node.parentElement === host) return;
    const destination = host as HTMLElement & { moveBefore?: (node: Node, reference: Node | null) => void };
    if (destination.moveBefore && node.isConnected && host.isConnected) destination.moveBefore(node, null);
    else {
      charts.forEach(cell => cell.chart.setVisible(false)); if (withTapes) tapes.beforeMove();
      host.appendChild(node); if (withTapes) tapes.afterMove();
    }
  }
  return {
    element, setActiveSlot, focus, showAll, resize,
    setInterval(interval: ChartInterval) {
      cells.forEach(cell => cell.chart.setInterval(interval));
      note.textContent = `${interval === 'D' ? '일봉' : `${interval}분봉`} · 관리자 지정 / Vunelix · TradingView 제공 / 주식·ETF 시세 지연 가능`;
      rearNote.textContent = `${interval === 'D' ? '일봉' : `${interval}분봉`} · 관리자 지정 / TradingView · 거래소별 시세`;
    },
    setMarkets(next: readonly MarketSymbol[]) {
      if (disposed) return;
      markets = normalizeOfficeCharts(next);
      cells.forEach((cell, slot) => { const market = markets[slot]!; cell.chart.setSymbol(market.symbol, market.name, market); });
      render();
    },
    moveTo(host: HTMLElement) {
      if (disposed) return;
      wallMode = false; rearElement.hidden = true;
      moveNode(element, host, cells, true);
      cells.forEach(cell => moveNode(cell.panel, grid, [cell]));
      render(); resize();
    },
    moveToWalls(front: HTMLElement, rear: HTMLElement) {
      if (disposed) return;
      wallMode = true; focusedSlot = null; rearElement.hidden = false;
      moveNode(element, front, cells.slice(0, 4), true);
      moveNode(rearElement, rear, cells.slice(4));
      cells.forEach((cell, slot) => moveNode(cell.panel, slot < 4 ? grid : rearGrid, [cell]));
      render(); resize();
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(navigationFrame); resizeObserver.disconnect();
      cells.forEach(cell => cell.chart.dispose()); tapes.dispose(); element.remove(); rearElement.remove();
    },
  };
}
