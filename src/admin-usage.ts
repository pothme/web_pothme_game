import { usageLevel, type UsageMetric, type UsageSnapshot, type UsageLevel } from '../shared/usage';
import './admin-usage.css';

const POLL_MS = 300_000;
const LEVEL_NAMES: Record<UsageLevel, string> = { normal: '여유', warning: '주의', critical: '한도 임박', exceeded: '한도 도달', unknown: '확인 필요' };
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function number(value: number | null | undefined, decimals = 0): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: decimals });
}
function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let size = value, unit = 0;
  while (size >= 1000 && unit < units.length - 1) { size /= 1000; unit++; }
  return `${number(size, unit ? 2 : 0)} ${units[unit]}`;
}
function quantity(value: number | null, unit: UsageMetric['unit']): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return unit === 'bytes' ? bytes(value) : `${number(value, unit === 'GB-s' ? 2 : 0)} ${unit === 'requests' ? '건' : unit === 'rows' ? '행' : 'GB-s'}`;
}
function date(value: number | null): string {
  return value == null || !Number.isFinite(value) ? '수신 기록 없음' : new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Account quota reads are independent of the admin's thirty-second room polling. */
export function createAdminUsage(host: HTMLElement, options: { read(signal: AbortSignal): Promise<UsageSnapshot>; alertHost?: HTMLElement }) {
  host.className = 'admin-operations admin-usage';
  host.id = 'admin-usage';
  const summary = options.alertHost;
  if (summary) { summary.className = 'au-summary'; summary.hidden = true; summary.setAttribute('role', 'status'); }
  host.innerHTML = `<section class="admin-operation-card"><header class="admin-operation-card-heading"><div><span class="admin-eyebrow">CLOUDFLARE · FREE PLAN</span><h3>무료 사용량과 트래픽</h3><p>계정 전체의 무료 한도와 Worker별 트래픽을 구분해서 확인해요.</p></div><button type="button" class="admin-secondary-action" data-usage-refresh>새로고침</button></header>
    <div class="au-alert" data-usage-alert role="status"><strong>사용량 연결을 확인하고 있어요.</strong><span>확인되지 않은 값은 0으로 표시하지 않습니다.</span></div>
    <div class="au-meta"><p data-usage-updated>수신 기록 없음</p><a data-usage-dashboard href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer">Cloudflare 대시보드 ↗</a></div>
    <div class="au-setup" data-usage-setup hidden><h4>계정 분석 연결이 필요해요</h4><p>Cloudflare의 <strong>Account Analytics: Read</strong> 권한이 있는 API 토큰을 운영 배포 환경의 Worker 비밀값으로 연결해 주세요.</p><p>토큰은 이 관리자 화면에 입력하거나 저장하지 않습니다. 연결 전 사용량은 ‘확인 불가’로 표시합니다.</p></div>
    <ul class="au-messages" data-usage-messages></ul><p class="au-read-status" data-usage-message role="status"></p>
    <section class="au-account" aria-labelledby="au-account-title"><div class="au-section-heading"><h4 id="au-account-title">계정 전체 · 무료 한도</h4><span>80% 주의 · 95% 임박 · 100% 도달</span></div><p class="au-explanation">같은 Cloudflare 계정의 다른 서비스 사용량도 포함됩니다. 일일 한도는 매일 한국시간 오전 9시에 초기화되며, 저장 용량은 관측 구간의 저장 공간 사용값입니다.</p><div class="au-metrics" data-usage-metrics></div><p class="au-period" data-usage-period></p></section>
    <section class="au-worker-section" aria-labelledby="au-worker-title"><div class="au-section-heading"><h4 id="au-worker-title">Worker별 트래픽</h4><span>계정 전체 한도와 별도</span></div><p class="au-explanation">이 계정에 있는 Worker 각각의 집계이며, 일일 사용량과 같은 UTC 날짜 범위를 사용합니다.</p><div class="au-worker-table-wrap" tabindex="0" role="region" aria-label="Worker별 트래픽, 좁은 화면에서 좌우 스크롤"><table class="au-worker-table"><thead><tr><th scope="col">Worker</th><th scope="col">요청</th><th scope="col">오류</th><th scope="col">하위 요청</th><th scope="col">CPU 중앙값</th><th scope="col">CPU p99</th></tr></thead><tbody data-usage-workers></tbody></table></div><p data-usage-workers-empty class="au-explanation">수신 대기 중입니다.</p></section>
    <section aria-labelledby="au-room-title"><div class="au-section-heading"><h4 id="au-room-title">계정 Durable Objects 트래픽</h4><span>같은 날짜 범위</span></div><div class="au-traffic" data-usage-traffic></div><p class="au-explanation">DO 전체 호출에는 WebSocket 호출이 포함됩니다. 응답 본문 관측량은 사이트 전체 대역폭·정적 파일·차트 제공사 트래픽을 뜻하지 않습니다.</p></section>
    <footer class="au-footnote">관리자 화면이 보이는 동안 5분 간격으로 확인합니다. 새로고침도 서버 캐시를 사용하며, Cloudflare 분석 반영에는 지연이 있을 수 있습니다.</footer></section>`;
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const refreshButton = el<HTMLButtonElement>('[data-usage-refresh]');
  let authenticated = false, busy = false, loading = false, disposed = false, generation = 0;
  let nextRefreshAt = 0, data: UsageSnapshot | null = null, controller: AbortController | null = null;
  const trafficLabels = [
    ['doRequests', 'DO 전체 호출'], ['webSocketReceived', 'WebSocket 수신 메시지'], ['webSocketSent', 'WebSocket 송신 메시지'], ['responseBytes', 'DO 응답 본문 관측량'],
  ] as const;
  function controls() { refreshButton.disabled = loading || busy || !authenticated; host.setAttribute('aria-busy', String(loading)); }
  function showError(text: string) { el('[data-usage-message]').textContent = text; }
  function renderMetrics(metrics: UsageMetric[]) {
    const list = el('[data-usage-metrics]'); list.replaceChildren();
    for (const metric of metrics) {
      const measured = metric.used != null && Number.isFinite(metric.used) && metric.percent != null && Number.isFinite(metric.percent);
      const level = measured ? usageLevel(metric.percent) : 'unknown';
      const card = node('article', `au-metric au-${level}`), heading = node('div', 'au-metric-heading');
      heading.append(node('h5', '', metric.label), node('span', 'au-level', LEVEL_NAMES[level]));
      const amounts = node('p', 'au-amounts'); amounts.append(node('strong', '', quantity(metric.used, metric.unit)), node('span', '', `/ ${quantity(metric.limit, metric.unit)}`));
      const progress = node('div', 'au-progress');
      progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', `${metric.label} 무료 한도 사용률`);
      progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100');
      const fill = node('span'); fill.style.width = measured ? `${Math.max(0, Math.min(100, metric.percent!))}%` : '0%'; progress.append(fill);
      if (measured) { progress.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, metric.percent!)))); progress.setAttribute('aria-valuetext', `${number(metric.percent, 1)}% 사용`); }
      else progress.setAttribute('aria-valuetext', '사용량 확인 불가');
      const footer = node('div', 'au-metric-footer'); footer.append(node('span', '', metric.period === 'storage' ? '저장 공간 관측값' : '오늘 누적'), node('strong', '', measured ? `${number(metric.percent, 1)}%` : '확인 불가'));
      card.append(heading, amounts, progress, footer);
      if (metric.note) card.append(node('p', 'au-metric-note', metric.note)); list.append(card);
    }
    if (!metrics.length) list.append(node('p', 'au-explanation', '사용량을 아직 확인하지 못했습니다. Cloudflare 연결 상태를 확인해 주세요.'));
  }
  function render(next: UsageSnapshot) {
    data = next;
    const alert = el('[data-usage-alert]');
    alert.className = `au-alert au-${next.level}${next.stale ? ' is-stale' : ''}`;
    const headline = !next.configured || next.status === 'setup' ? '분석 연결 전 · 사용량 확인 불가'
      : next.stale ? `마지막 수신 기준 ${LEVEL_NAMES[next.level]} · 지연된 사용량`
      : next.level === 'exceeded' ? '무료 한도에 도달한 항목이 있어요'
      : next.level === 'critical' ? '무료 한도가 임박했어요 · 95% 이상'
      : next.level === 'warning' ? '무료 한도 사용량을 확인해 주세요 · 80% 이상'
      : next.status === 'unavailable' ? '사용량을 확인하지 못했어요'
      : next.status === 'partial' ? '일부 항목의 사용량만 확인되었어요'
      : next.level === 'unknown' ? '무료 한도 사용량 확인이 필요해요' : '확인된 무료 한도에 여유가 있어요';
    const description = next.stale ? '현재 사용량과 다를 수 있습니다. 다시 연결되면 최신 값으로 갱신합니다.'
      : next.level === 'exceeded' || next.level === 'critical' ? 'Cloudflare 대시보드에서 해당 항목과 서비스 상태를 확인해 주세요.'
      : '확인되지 않은 항목은 ‘— / 확인 불가’로 표시합니다.';
    alert.replaceChildren(node('strong', '', headline), node('span', '', description));
    if (summary) {
      summary.hidden = false; summary.className = `au-summary au-${next.level}`;
      const link = node('a', '', '사용량 자세히 ↓'); link.href = '#admin-usage';
      summary.replaceChildren(node('strong', '', headline), link);
    }
    el('[data-usage-setup]').hidden = next.configured && next.status !== 'setup';
    el('[data-usage-updated]').textContent = `${date(next.fetchedAt)}${next.fetchedAt ? ' KST 수신' : ''}${next.stale ? ' · 지연값' : ''}`;
    el('[data-usage-period]').textContent = `집계 범위 ${date(next.periodStart)} ~ ${date(next.periodEnd)} KST · 다음 일일 초기화 ${date(next.resetAt)} KST`;
    const messages = el('[data-usage-messages]'); messages.replaceChildren(...next.messages.map(text => node('li', '', text)));
    try { const url = new URL(next.dashboardUrl); if (url.protocol === 'https:' && (url.hostname === 'cloudflare.com' || url.hostname.endsWith('.cloudflare.com'))) el<HTMLAnchorElement>('[data-usage-dashboard]').href = url.href; } catch { /* Retain the official default link. */ }
    renderMetrics(next.metrics);
    const workers = el<HTMLTableSectionElement>('[data-usage-workers]'); workers.replaceChildren();
    for (const worker of next.workers) {
      const row = node('tr'); row.append(node('th', '', worker.name), node('td', '', number(worker.requests)), node('td', '', number(worker.errors)), node('td', '', number(worker.subrequests)), node('td', '', worker.cpuP50Ms == null ? '—' : `${number(worker.cpuP50Ms, 2)} ms`), node('td', '', worker.cpuP99Ms == null ? '—' : `${number(worker.cpuP99Ms, 2)} ms`));
      row.querySelector('th')!.scope = 'row'; workers.append(row);
    }
    el('[data-usage-workers-empty]').hidden = !!next.workers.length;
    el('[data-usage-workers-empty]').textContent = 'Worker별 트래픽을 확인하지 못했습니다. 0건으로 간주하지 않습니다.';
    const traffic = el('[data-usage-traffic]'); traffic.replaceChildren();
    for (const [key, label] of trafficLabels) {
      const metric = node('article'); metric.append(node('span', '', label), node('strong', '', next.traffic[key] == null ? '—' : key === 'responseBytes' ? bytes(next.traffic[key]!) : `${number(next.traffic[key])}건`)); traffic.append(metric);
    }
  }
  async function refresh(manual = false) {
    if (disposed || !authenticated || busy || loading || document.hidden || (!manual && Date.now() < nextRefreshAt)) return;
    const version = generation; loading = true; controller = new AbortController(); controls(); showError('사용량을 확인하고 있어요…');
    nextRefreshAt = Date.now() + POLL_MS;
    try {
      const next = await options.read(controller.signal);
      if (disposed || version !== generation || !authenticated) return;
      if (!next || !Array.isArray(next.metrics) || !Array.isArray(next.workers) || !Array.isArray(next.messages) || !next.traffic) throw new Error('사용량 응답을 확인하지 못했어요.');
      nextRefreshAt = Math.max(Date.now() + POLL_MS, Number.isFinite(next.refreshAfter) ? next.refreshAfter : 0);
      render(next); showError('');
    } catch (error) {
      if (!disposed && version === generation && authenticated) {
        showError(error instanceof Error ? error.message : '사용량을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
        if (data) render({ ...data, stale: true });
        else {
          const alert = el('[data-usage-alert]'); alert.className = 'au-alert au-unknown';
          alert.replaceChildren(node('strong', '', '사용량 연결을 확인하지 못했어요'), node('span', '', 'Cloudflare 대시보드에서도 사용량을 확인할 수 있습니다.'));
          if (summary) { summary.hidden = false; summary.className = 'au-summary au-unknown'; const link = node('a', '', '사용량 자세히 ↓'); link.href = '#admin-usage'; summary.replaceChildren(node('strong', '', '사용량 연결 확인 필요'), link); }
        }
      }
    } finally { if (!disposed && version === generation) { loading = false; controller = null; controls(); } }
  }
  function reset() {
    generation++; authenticated = false; controller?.abort(); controller = null; loading = false; nextRefreshAt = 0; data = null;
    if (summary) { summary.hidden = true; summary.replaceChildren(); }
    el('[data-usage-metrics]').replaceChildren(); el('[data-usage-workers]').replaceChildren(); el('[data-usage-traffic]').replaceChildren(); el('[data-usage-messages]').replaceChildren();
    el('[data-usage-setup]').hidden = true; el('[data-usage-updated]').textContent = '수신 기록 없음'; el('[data-usage-period]').textContent = '';
    el('[data-usage-workers-empty]').hidden = false; el('[data-usage-workers-empty]').textContent = '수신 대기 중입니다.';
    const alert = el('[data-usage-alert]'); alert.className = 'au-alert'; alert.replaceChildren(node('strong', '', '사용량 연결을 확인하고 있어요.'), node('span', '', '확인되지 않은 값은 0으로 표시하지 않습니다.'));
    showError(''); controls();
  }
  const visible = () => { if (!document.hidden) void refresh(); };
  const timer = window.setInterval(visible, POLL_MS);
  refreshButton.onclick = () => { void refresh(true); };
  document.addEventListener('visibilitychange', visible);
  controls();
  return {
    setAuthenticated(value: boolean) { if (!value) reset(); else if (!authenticated) { authenticated = true; controls(); void refresh(); } },
    setBusy(value: boolean) { busy = value; controls(); if (!value) void refresh(); },
    reset,
    dispose() { if (disposed) return; reset(); disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); },
  };
}
