import './market-panel-collapse.css';

/** Keep the shared chart controls reachable without covering the office. */
export function createMarketPanelCollapse(panel: HTMLElement) {
  const key = 'podeumgo.market-panel.collapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(key) === '1'; } catch { /* Optional preference. */ }
  const toolbar = document.createElement('div');
  toolbar.className = 'market-panel-toolbar';
  const label = document.createElement('span'); label.textContent = '차트 · 안내';
  const toggle = document.createElement('button'); toggle.type = 'button';
  toggle.setAttribute('aria-controls', panel.id);
  toolbar.append(label, toggle); panel.prepend(toolbar);
  function render() {
    panel.classList.toggle('is-minimized', collapsed);
    toggle.textContent = collapsed ? '펼치기 ＋' : '접기 −';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '공유 차트·안내 펼치기' : '공유 차트·안내 최소화');
  }
  toggle.onclick = () => {
    collapsed = !collapsed; render();
    try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch { /* Optional preference. */ }
  };
  render();
}
