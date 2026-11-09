import type { MarketSymbol } from '../shared/market-catalog';
import { DEFAULT_CHARTS, normalizeOfficeCharts } from '../shared/office-charts';
import './market-slot-ui.css';
export { type MarketSymbol } from '../shared/market-catalog';
export interface MarketState {
  selected: MarketSymbol;
  charts?: readonly MarketSymbol[];
  vote: unknown;
  lastResult: unknown;
  nextProposalAt: number;
}

/** Public controls select a viewing slot only. Shared changes require admin auth. */
export function createMarketUI(options: {
  onSelected: (market: MarketSymbol, slot: number) => void;
  onCharts?: (charts: readonly MarketSymbol[]) => void;
  onKoreanChartsEnabled?: (enabled: boolean) => void;
}) {
  let charts: readonly MarketSymbol[] = DEFAULT_CHARTS;
  let activeSlot = 0;
  const host = document.getElementById('shared-chart-slots')!;
  host.className = 'market-slot-selector';
  const heading = document.createElement('h3'); heading.textContent = '정면 주식·ETF / 후면 코인 차트';
  const group = document.createElement('div'); group.className = 'market-slot-buttons';
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', '볼 차트 선택');
  const buttons = DEFAULT_CHARTS.map((_, slot) => {
    const button = document.createElement('button'); button.type = 'button';
    button.onclick = () => setActiveSlot(slot); group.append(button); return button;
  });
  host.append(heading, group);
  function render() {
    buttons.forEach((button, slot) => {
      const market = charts[slot]!;
      const short = market.symbol.startsWith('KRX:') ? market.name.replace(/\s+[A-Za-z].*$/, '') : market.symbol.split(':').slice(1).join(':');
      button.textContent = `${slot < 4 ? '정면' : '후면'} ${slot % 4 + 1} · ${short}`;
      button.title = `${market.name} · ${market.symbol}`;
      button.setAttribute('aria-pressed', String(activeSlot === slot));
    });
  }
  function setActiveSlot(slot: number) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= charts.length) return false;
    activeSlot = slot; render(); options.onSelected(charts[slot]!, slot); return true;
  }
  render();
  return {
    setActiveSlot,
    setKoreanChartsEnabled(enabled: boolean) { options.onKoreanChartsEnabled?.(enabled); },
    setState(state: MarketState) {
      charts = normalizeOfficeCharts(state.charts, state.selected);
      options.onCharts?.(charts); render(); options.onSelected(charts[activeSlot]!, activeSlot);
    },
  };
}
