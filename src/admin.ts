import './admin.css';
import { createAdminOperations, type AdminOperationsState } from './admin-operations';
import { createAdminCommunity } from './admin-community';
import { createAdminUsage } from './admin-usage';
import { OFFICE_CHART_COUNT, chartSlotLabel } from '../shared/office-charts';

type AuthMode = 'google' | 'password';
interface AdminSession { authenticated: boolean; authMode: AuthMode; csrfToken?: string; email?: string }
interface AdminState extends AdminOperationsState {
  ok: true;
  roomOpen: boolean;
  onlineCount: number;
  capacity: number;
  selectedSymbol: string;
  selectedName: string;
  voteActive: boolean;
  serverTime: number;
}
class AdminError extends Error {
  constructor(message: string, readonly status: number, readonly retryAt?: number, readonly authMode?: AuthMode) { super(message); }
}
const symbols: Record<string, string> = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  key: '<circle cx="8" cy="9" r="4"/><path d="m11 12 8 8m-3-3 3-3m-6 0 3-3"/>',
  door: '<path d="M4 21h16M6 21V4l11-2v19M10 12h.01M17 5h3v16"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  board: '<rect x="3" y="3" width="18" height="15" rx="2"/><path d="M8 21h8m-4-3v3M6 13l4-5 4 3 4-5"/>',
  coin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
  logout: '<path d="M9 4H4v16h5m5-13 5 5-5 5m-7-5h12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name] ?? ''}</svg>`;

export function initAdmin(): void {
  const container = document.querySelector<HTMLDivElement>('#app');
  if (!container || container.dataset.adminInitialized === 'true') return;
  const app = container;
  app.dataset.adminInitialized = 'true';
  document.body.classList.add('admin-page');
  document.title = '포듬증권 운영실 — 사무실 운영';
  const authMessages: Record<string, string> = {
    denied: '운영실 접근이 허용되지 않은 계정이에요. 등록된 관리자 Google 계정으로 로그인해 주세요.',
    cancelled: 'Google 로그인이 취소되었어요. 다시 시도할 수 있어요.',
    expired: '로그인 확인 시간이 지났어요. Google 계정으로 다시 로그인해 주세요.',
    unavailable: 'Google 로그인 연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  };
  const pageUrl = new URL(window.location.href);
  // Only display our fixed callback messages, never provider or query-string text.
  const authResult = pageUrl.searchParams.get('auth') ?? '';
  const authMessage = Object.hasOwn(authMessages, authResult) ? authMessages[authResult] : '';
  if (pageUrl.searchParams.has('auth')) {
    pageUrl.searchParams.delete('auth');
    window.history.replaceState(window.history.state, '', `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`);
  }
  app.innerHTML = `
    <header class="admin-topbar"><a class="admin-brand" href="/" aria-label="포듬증권 사무실로 이동"><span class="admin-brand-mark">ㅍ</span><span>포듬증권<small>함께 읽는 시장</small></span></a><span class="admin-staff-tag">운영실 <span>STAFF ONLY</span></span><button type="button" class="admin-text-button" id="admin-logout" hidden>${icon('logout')}로그아웃</button></header>
    <main class="admin-main">
      <div class="admin-page-heading"><div><span class="admin-eyebrow">PODEUM SECURITIES · OPERATIONS</span><h1>사무실의 하루를, 여기서.</h1><p>공유 차트, 공지와 접속 참가자를 한곳에서 관리해요.</p></div><a class="admin-classroom-link" href="/">사무실로 가기 ${icon('arrow')}</a></div>
      <p id="admin-notice" class="admin-notice" role="status" aria-live="polite">관리자 세션을 확인하고 있어요…</p>
      <section id="admin-login-view" class="admin-login-layout" hidden aria-label="관리자 로그인">
        <div class="admin-welcome-art" aria-hidden="true"><div class="admin-office-window"><i></i><i></i><i></i><i></i></div><div class="admin-office-desk"></div><div class="admin-monitor-stand"></div><div class="admin-office-monitor"><div class="admin-monitor-top"><span>PODEUM / OPERATIONS</span><span>◈</span></div><strong>시장을 읽고,<br>대화를 이어가는 곳.</strong><div class="admin-monitor-graphic"><svg viewBox="0 0 320 100" fill="none"><path class="admin-monitor-grid" d="M0 25h320M0 50h320M0 75h320M40 0v100M100 0v100M160 0v100M220 0v100M280 0v100"/><path class="admin-monitor-area" d="M0 83 30 76 55 80 82 51 109 64 141 43 166 49 195 24 224 35 255 19 281 29 320 8V100H0Z"/><path class="admin-monitor-line" d="m0 83 30-7 25 4 27-29 27 13 32-21 25 6 29-25 29 11 31-16 26 10 39-21"/></svg></div><span class="admin-art-disclaimer">공간 일러스트 · 실제 시세 아님</span></div><span class="admin-office-keyboard"></span><span class="admin-office-mug"></span><span class="admin-office-caption">MARKET LOUNGE / AFTER HOURS</span></div>
        <div class="admin-login-card"><div class="admin-key-mark">${icon('key')}</div><span class="admin-eyebrow">WELCOME BACK</span><h2>관리자님, 어서 오세요.</h2><p id="admin-login-description">로그인 연결을 확인하고 있어요.</p><form id="admin-login-form" hidden><label for="admin-password">관리자 비밀번호</label><input id="admin-password" name="password" type="password" autocomplete="current-password" required maxlength="512" placeholder="비밀번호를 입력하세요" aria-describedby="admin-login-error"><p id="admin-login-error" class="admin-inline-error" role="alert"></p><button id="admin-login-button" class="admin-button admin-button-primary" type="submit"><span>운영실 입장</span>${icon('arrow')}</button></form><div id="admin-account-login" hidden><a id="admin-account-login-link" class="admin-button admin-button-primary" href="/api/admin/oauth/start"><span>Google 계정으로 로그인</span>${icon('arrow')}</a><p class="admin-account-help">허용된 본인 계정만 운영실을 이용할 수 있어요.</p></div><div class="admin-login-footnote">${icon('door')}사무실 운영을 위한 관리자 전용 공간입니다.</div></div>
      </section>
      <section id="admin-dashboard" hidden aria-label="사무실 운영 현황">
        <p id="admin-account-identity" class="admin-account-identity" hidden></p>
        <div class="admin-dashboard-heading"><span class="admin-eyebrow">트레이딩 라운지 · 운영 현황</span><div><span id="admin-updated">상태 확인 중</span><button id="admin-refresh" class="admin-text-button" type="button">${icon('refresh')}새로고침</button></div></div>
        <div class="admin-overview"><section class="admin-room-card" aria-labelledby="admin-room-title"><div class="admin-room-card-top"><span class="admin-eyebrow">OFFICE STATUS</span><span id="admin-room-badge" class="admin-room-badge">확인 중</span></div><div class="admin-room-door" aria-hidden="true">${icon('door')}</div><h2 id="admin-room-title">사무실 상태를 확인해요.</h2><p id="admin-room-description">잠시만 기다려 주세요.</p><div class="admin-room-bottom"><span>포듬증권 트레이딩 라운지</span><span>정원 <b id="admin-capacity">50</b>명</span></div></section>
          <section class="admin-control-card" aria-labelledby="admin-control-title"><span class="admin-eyebrow">OPEN / CLOSE</span><h2 id="admin-control-title">사무실 문 관리</h2><p class="admin-control-description">함께할 준비가 됐다면 문을 열어 주세요.</p><button type="button" id="admin-open" class="admin-control-button admin-open"><span class="admin-control-symbol">↗</span><span><strong>사무실 열기</strong><small>참가자들의 입장을 허용해요.</small></span><span class="admin-action-arrow">→</span></button><button type="button" id="admin-close" class="admin-control-button admin-close"><span class="admin-control-symbol">↙</span><span><strong>사무실 닫고 모두 퇴실</strong><small>새 입장을 막고, 접속 참가자들을 퇴실시켜요.</small></span><span class="admin-action-arrow">→</span></button><p class="admin-preservation-note">사무실을 닫아도 선택된 차트와 운영 설정은 보관됩니다.</p></section></div>
        <div class="admin-metrics"><article class="admin-metric"><span class="admin-metric-icon">${icon('people')}</span><span class="admin-metric-label">지금 접속 중</span><div><strong id="admin-online-count">—</strong><span id="admin-online-capacity">/ 50명</span></div><div class="admin-occupancy" role="progressbar" aria-label="사무실 접속 인원" aria-valuemin="0" aria-valuemax="50" aria-valuenow="0"><span></span></div></article><article class="admin-metric"><span class="admin-metric-icon">${icon('board')}</span><span class="admin-metric-label">선택된 공유 차트</span><div><strong id="admin-selected-name">—</strong></div><p>모든 참가자가 보는 종목</p></article><article class="admin-metric"><span class="admin-metric-icon">${icon('coin')}</span><span class="admin-metric-label">참가자 채팅</span><div><strong id="admin-vote-status">—</strong></div><p>관리자가 채팅을 켜고 끌 수 있어요</p></article></div>
        <section class="admin-game-card" aria-labelledby="admin-game-title"><span class="admin-game-icon">${icon('clock')}</span><div><span class="admin-eyebrow">SHARED MARKET</span><h2 id="admin-game-title">공유 차트를 확인해요.</h2><p id="admin-game-description">—</p></div><span class="admin-round-tag" id="admin-round-number">공유 차트</span></section>
      </section>
      <footer class="admin-footer"><span>포듬증권 운영실</span><span>해가 기울어도, 이야기는 계속.</span><span>트레이딩 라운지</span></footer>
    </main>`;

  const el = <T extends HTMLElement = HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const loginView = el('admin-login-view');
  const dashboard = el('admin-dashboard');
  const password = el<HTMLInputElement>('admin-password');
  const loginForm = el<HTMLFormElement>('admin-login-form');
  const loginButton = el<HTMLButtonElement>('admin-login-button');
  const accountLogin = el('admin-account-login');
  const accountLink = el<HTMLAnchorElement>('admin-account-login-link');
  const accountIdentity = el('admin-account-identity');
  const notice = el('admin-notice');
  const logout = el<HTMLButtonElement>('admin-logout');
  const refresh = el<HTMLButtonElement>('admin-refresh');
  const openButton = el<HTMLButtonElement>('admin-open');
  const closeButton = el<HTMLButtonElement>('admin-close');
  const chartList = document.createElement('ol');
  chartList.setAttribute('aria-label', '선택된 공유 차트');
  Object.assign(chartList.style, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,220px),1fr))', gap: '8px 20px', listStyle: 'none', padding: '0', margin: '13px 0 0' });
  const chartSummary = el('admin-game-description').parentElement!;
  chartSummary.style.flex = '1'; chartSummary.style.minWidth = 'min(100%,190px)';
  chartSummary.appendChild(chartList);
  let csrfToken = '';
  let authMode: AuthMode | null = null;
  let accountEmail = '';
  let state: AdminState | null = null;
  let busy: 'checking' | 'login' | 'refresh' | 'open' | 'close' | 'logout' | 'manage' | null = 'checking';
  let retryAt = 0;
  let polling = false;
  let lastUpdated = 0;
  let generation = 0;
  const clock = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const operationsHost = document.createElement('div'); dashboard.appendChild(operationsHost);
  const operations = createAdminOperations(operationsHost, { manage });
  const communityHost = document.createElement('div'); dashboard.appendChild(communityHost);
  const community = createAdminCommunity(communityHost, { manage, async read(query) {
    const current = generation;
    try { return await request(`community?${query}`); }
    catch (error) { if (current === generation && error instanceof AdminError && (error.status === 401 || error.status === 403)) handleError(error); throw error; }
  } });
  const usageHost = document.createElement('div'); operationsHost.before(usageHost);
  const usageAlert = document.createElement('div'); dashboard.querySelector('.admin-dashboard-heading')!.after(usageAlert);
  const usage = createAdminUsage(usageHost, { alertHost: usageAlert, async read(signal) {
    const current = generation;
    try { return await request('usage', 'GET', undefined, signal); }
    catch (error) { if (current === generation && error instanceof AdminError && (error.status === 401 || error.status === 403)) handleError(error); throw error; }
  } });
  window.addEventListener('pagehide', event => { if (!event.persisted) usage.dispose(); });

  async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    let response: Response;
    try {
      response = await fetch(`/api/admin/${path}`, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'manual', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    } catch { throw new AdminError('서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.', 0); }
    // API calls must return JSON, never an identity provider's login page.
    // The sign-in link performs the OAuth navigation explicitly.
    if (response.type === 'opaqueredirect' || response.redirected || response.status >= 300 && response.status < 400) {
      throw new AdminError('계정 인증을 다시 확인해 주세요. 로그인 후 이용할 수 있어요.', 401, undefined, authMode ?? undefined);
    }
    let data: Record<string, unknown>;
    try {
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response');
      data = value as Record<string, unknown>;
    } catch {
      if (response.status === 401 || response.status === 403 || response.headers.get('Content-Type')?.includes('text/html')) {
        throw new AdminError('계정 인증을 다시 확인해 주세요. 로그인 후 이용할 수 있어요.', 401, undefined, authMode ?? undefined);
      }
      throw new AdminError('서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', response.status);
    }
    if (!response.ok) throw new AdminError(typeof data.message === 'string' ? data.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.', response.status, typeof data.retryAt === 'number' ? data.retryAt : undefined, data.authMode === 'google' || data.authMode === 'password' ? data.authMode : undefined);
    return data as T;
  }
  function setNotice(text: string, error = false) {
    notice.textContent = text; notice.hidden = !text;
    notice.classList.toggle('is-error', error);
    notice.setAttribute('role', error ? 'alert' : 'status');
  }
  function updateControls() {
    const waiting = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    password.disabled = !!busy || authMode !== 'password';
    loginButton.disabled = !!busy || waiting > 0 || authMode !== 'password';
    loginButton.querySelector('span')!.textContent = busy === 'login' ? '입장 확인 중…' : waiting ? `${waiting}초 후 다시 로그인` : '운영실 입장';
    logout.disabled = !!busy;
    refresh.disabled = !!busy;
    openButton.disabled = !!busy || !state || state.roomOpen;
    closeButton.disabled = !!busy || !state || !state.roomOpen;
    openButton.querySelector('strong')!.textContent = busy === 'open' ? '사무실을 여는 중…' : state?.roomOpen ? '사무실이 열려 있어요' : '사무실 열기';
    closeButton.querySelector('strong')!.textContent = busy === 'close' ? '사무실을 닫는 중…' : state && !state.roomOpen ? '사무실이 닫혀 있어요' : '사무실 닫고 모두 퇴실';
    dashboard.setAttribute('aria-busy', String(!!busy));
    operations.setBusy(!!busy, busy !== 'refresh');
    community.setBusy(!!busy);
    usage.setBusy(!!busy);
    loginForm.setAttribute('aria-busy', String(busy === 'login'));
  }
  function setAuthentication(mode: AuthMode | null, email = '') {
    authMode = mode;
    accountEmail = mode === 'google' ? email : '';
    loginForm.hidden = mode !== 'password';
    accountLogin.hidden = mode === 'password';
    el('admin-login-description').textContent = mode === 'password' ? '관리자 비밀번호로 운영실에 입장하세요.' : mode === 'google' ? '본인의 Google 계정으로 운영실에 입장하세요.' : '로그인 연결을 다시 확인해 주세요.';
    accountLink.querySelector('span')!.textContent = mode === 'google' ? 'Google 계정으로 로그인' : '로그인 연결 다시 확인';
    accountLink.href = mode === 'google' ? '/api/admin/oauth/start' : '/admin';
    accountIdentity.textContent = accountEmail ? `본인 계정으로 접속 중 · ${accountEmail}` : '';
    accountIdentity.hidden = !accountEmail;
  }
  function focusLogin() { if (!loginView.hidden) (authMode === 'password' ? password : accountLink).focus(); }
  function showLogin(message = '') {
    generation++; busy = null;
    csrfToken = ''; state = null; polling = false; password.value = '';
    setAuthentication(authMode);
    operations.reset();
    community.reset();
    usage.reset();
    // The operations module retains its controls for the next sign-in. Remove
    // the previous administrator's roster, audit and unsaved settings from them.
    for (const id of ['admin-roster', 'admin-blocks', 'admin-audit']) el(id).replaceChildren();
    for (const id of ['admin-office-notice', 'admin-donation-url']) el<HTMLInputElement | HTMLTextAreaElement>(id).value = '';
    for (const id of ['admin-roster-count', 'admin-block-count']) el(id).textContent = '0';
    el('admin-login-error').textContent = '';
    loginView.hidden = false; dashboard.hidden = true; logout.hidden = true;
    setNotice(message, !!message);
    updateControls();
  }
  function render(next: AdminState, appliedAction?: string) {
    state = next; polling = true; lastUpdated = Date.now();
    loginView.hidden = true; dashboard.hidden = false; logout.hidden = false;
    const roomCard = app.querySelector('.admin-room-card')!;
    roomCard.classList.toggle('is-closed', !next.roomOpen);
    el('admin-room-badge').textContent = next.roomOpen ? 'OPEN · 입장 가능' : 'CLOSED · 입장 중지';
    el('admin-room-title').textContent = next.roomOpen ? '사무실 문이 열려 있어요.' : '잠시, 쉬어가는 사무실.';
    el('admin-room-description').textContent = next.roomOpen ? '동료들이 자유롭게 들어올 수 있어요.' : '지금은 새로운 참가자의 입장을 받지 않아요.';
    el('admin-capacity').textContent = String(next.capacity);
    el('admin-online-count').textContent = next.onlineCount.toLocaleString('ko-KR');
    el('admin-online-capacity').textContent = `/ ${next.capacity}명`;
    const charts = Array.isArray(next.charts) ? next.charts.slice(0, OFFICE_CHART_COUNT) : [{ name: next.selectedName, symbol: next.selectedSymbol }];
    el('admin-selected-name').textContent = `${charts.length}개`;
    chartList.replaceChildren(...charts.map((chart, slot) => {
      const item = document.createElement('li');
      Object.assign(item.style, { minWidth: '0', padding: '7px 0', borderTop: '1px solid #c7d5df', overflowWrap: 'anywhere' });
      const name = document.createElement('strong'); name.textContent = `${chartSlotLabel(slot)} · ${chart.name}`;
      Object.assign(name.style, { display: 'block', fontSize: '12px', fontWeight: '500', lineHeight: '1.7', color: '#345b71' });
      const symbol = document.createElement('small'); symbol.textContent = chart.symbol;
      Object.assign(symbol.style, { display: 'block', fontSize: '10px', lineHeight: '1.7', color: '#6c8798' });
      item.append(name, symbol); return item;
    }));
    el('admin-vote-status').textContent = next.settings?.chatEnabled === false ? '중지' : '허용';
    const occupancy = app.querySelector<HTMLElement>('.admin-occupancy')!;
    occupancy.setAttribute('aria-valuenow', String(next.onlineCount));
    occupancy.setAttribute('aria-valuemax', String(next.capacity));
    occupancy.querySelector<HTMLElement>('span')!.style.width = `${Math.max(0, Math.min(100, next.onlineCount / Math.max(1, next.capacity) * 100))}%`;
    el('admin-round-number').textContent = `${charts.length}개 공유 차트`;
    el('admin-game-title').textContent = !next.roomOpen ? '사무실 운영을 쉬고 있어요.' : `${charts.length}개 차트를 함께 보고 있어요.`;
    el('admin-game-description').textContent = '아래에서 종목과 차트 간격을 변경하면 모든 참가자의 화면에 적용됩니다.';
    el('admin-updated').textContent = `${clock.format(new Date(lastUpdated))} 확인 · 30초마다 갱신`;
    operations.setState(next, appliedAction);
    community.setAuthenticated(true);
    usage.setAuthenticated(true);
    updateControls();
  }
  async function manage(body: Record<string, unknown>, success: string): Promise<string | null> {
    if (busy || !csrfToken || !state) return '현재 작업이 끝난 뒤 다시 시도해 주세요.';
    const current = generation;
    busy = 'manage'; updateControls(); setNotice('');
    try {
      const next = await request<AdminState>('manage', 'POST', body);
      if (current !== generation) return '관리자 세션이 변경되었어요.';
      render(next, String(body.action)); setNotice(success); return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : '요청을 처리하지 못했어요.';
      if (current === generation) {
        if (error instanceof AdminError && (error.status === 401 || error.status === 403)) handleError(error);
        else setNotice(message, true);
      }
      return message;
    } finally { if (current === generation) { busy = null; updateControls(); } }
  }
  function handleError(error: unknown) {
    polling = false;
    const message = error instanceof Error ? error.message : '상태를 확인하지 못했어요. 다시 시도해 주세요.';
    if (error instanceof AdminError && (error.status === 401 || error.status === 403)) {
      if (error.authMode) setAuthentication(error.authMode);
      showLogin(authMode === 'password' ? '관리자 인증을 다시 확인해 주세요. 비밀번호로 로그인할 수 있어요.' : '계정 인증을 다시 확인해 주세요. Google 계정으로 로그인할 수 있어요.');
    }
    else {
      setNotice(message, true);
      if (state) el('admin-updated').textContent = '자동 갱신 멈춤 · 새로고침해 주세요';
    }
  }
  async function refreshState(automatic = false) {
    if (busy || !csrfToken || (automatic && (!polling || document.hidden))) return;
    busy = 'refresh'; updateControls();
    const current = generation;
    try {
      const next = await request<AdminState>('state');
      if (current !== generation) return;
      render(next); if (!automatic || notice.classList.contains('is-error')) setNotice('');
    } catch (error) { if (current === generation) handleError(error); }
    finally { if (current === generation) { busy = null; updateControls(); } }
  }
  async function loadSession() {
    const current = ++generation;
    busy = 'checking'; updateControls();
    try {
      const session = await request<AdminSession>('session');
      if (current !== generation) return;
      if (session.authMode !== 'google' && session.authMode !== 'password') throw new AdminError('로그인 방식을 확인하지 못했어요. 페이지를 새로 열어 주세요.', 502);
      setAuthentication(session.authMode, session.authenticated && typeof session.email === 'string' ? session.email : '');
      if (!session.authenticated || !session.csrfToken) { showLogin(session.authMode === 'google' ? authMessage : ''); return; }
      csrfToken = session.csrfToken;
      const next = await request<AdminState>('state');
      if (current !== generation) return;
      render(next); setNotice('');
    } catch (error) {
      if (current === generation) {
        if (error instanceof AdminError && error.authMode) setAuthentication(error.authMode);
        showLogin(); setNotice(error instanceof Error ? error.message : '관리자 세션을 확인하지 못했어요.', true);
      }
    }
    finally { if (current === generation) { busy = null; updateControls(); } }
  }
  loginForm.onsubmit = async event => {
    event.preventDefault();
    if (authMode !== 'password' || busy || Date.now() < retryAt || !password.value) return;
    const current = ++generation;
    const value = password.value; password.value = '';
    busy = 'login'; updateControls(); setNotice('');
    el('admin-login-error').textContent = '';
    try {
      const session = await request<AdminSession>('login', 'POST', { password: value });
      if (current !== generation) return;
      if (!session.authenticated || !session.csrfToken) throw new AdminError('관리자 인증을 확인하지 못했어요. 다시 로그인해 주세요.', 401, undefined, session.authMode);
      setAuthentication(session.authMode === 'google' ? 'google' : 'password', typeof session.email === 'string' ? session.email : '');
      csrfToken = session.csrfToken;
      const next = await request<AdminState>('state');
      if (current !== generation) return;
      render(next);
      el('admin-room-title').setAttribute('tabindex', '-1'); el('admin-room-title').focus();
    } catch (error) {
      if (current !== generation) return;
      if (error instanceof AdminError && error.authMode) setAuthentication(error.authMode);
      showLogin();
      retryAt = error instanceof AdminError ? error.retryAt ?? 0 : 0;
      el('admin-login-error').textContent = error instanceof Error ? error.message : '로그인하지 못했어요. 다시 시도해 주세요.';
    } finally { if (current === generation) busy = null; updateControls(); focusLogin(); }
  };
  async function control(action: 'open' | 'close') {
    if (busy || !csrfToken || !state || state.roomOpen === (action === 'open')) return;
    const current = generation;
    busy = action; updateControls(); setNotice('');
    try {
      const next = await request<AdminState>('control', 'POST', { action });
      if (current !== generation) return;
      render(next);
      setNotice(action === 'open' ? '사무실 문을 열었어요. 이제 참가자들이 입장할 수 있어요.' : '사무실 문을 닫고 접속 참가자들을 퇴실시켰어요. 선택된 공유 차트는 보관되어 있어요.');
    } catch (error) { if (current === generation) handleError(error); }
    finally { if (current === generation) { busy = null; updateControls(); } }
  }
  openButton.onclick = () => { void control('open'); };
  closeButton.onclick = () => { void control('close'); };
  refresh.onclick = () => { void refreshState(); };
  logout.onclick = async () => {
    if (busy || !csrfToken) return;
    busy = 'logout'; updateControls();
    try {
      await request('logout', 'POST'); showLogin(); setNotice('운영실에서 로그아웃했어요.');
    } catch (error) {
      handleError(error);
    } finally { busy = null; updateControls(); focusLogin(); }
  };
  setInterval(() => { if (!document.hidden && retryAt > 0) { if (Date.now() >= retryAt) retryAt = 0; updateControls(); } }, 1000);
  setInterval(() => { void refreshState(true); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastUpdated >= 30000) void refreshState(true); });
  void loadSession();
}
