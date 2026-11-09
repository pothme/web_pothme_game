import { CURATED_MARKETS, searchMarkets, type MarketSymbol } from '../shared/market-catalog';
import { normalizeOfficeCharts, OFFICE_CHART_COUNT, CHARTS_PER_WALL, chartSlotLabel } from '../shared/office-charts';
import { CHART_INTERVALS, normalizeOfficeSettings, type OfficeSettings } from '../shared/office-settings';
import './admin-operations.css';

export interface AdminOperationsState {
  charts: MarketSymbol[];
  settings: OfficeSettings;
  koreanChartsEnabled: boolean;
  players: { id: string; nickname: string; seat: number | null }[];
  blocks: { id: string; nickname: string; until: number }[];
  audit: { at: number; action: string; detail: string }[];
  serverTime: number;
}

export function createAdminOperations(host: HTMLElement, options: {
  manage: (body: Record<string, unknown>, success: string) => Promise<string | null>;
}) {
  host.className = 'admin-operations';
  host.innerHTML = `
    <div class="admin-operations-heading"><div><span class="admin-eyebrow">OFFICE DESK</span><h2>화면과 공간을 관리해요.</h2></div><a href="/markets" target="_blank" rel="noopener">시세 페이지 열기 ↗</a></div>
    <p class="admin-operation-message" role="status" aria-live="polite" hidden></p>
    <fieldset class="admin-operation-fields"><legend class="admin-visually-hidden">사무실 관리</legend>
      <section class="admin-operation-card" aria-labelledby="admin-charts-title">
        <div class="admin-operation-card-heading"><div><span class="admin-eyebrow">WALL DISPLAY</span><h3 id="admin-charts-title">앞벽·뒷벽 공유 차트 8개</h3><p>각 벽을 바라봤을 때 왼쪽부터 1~4번입니다. 차트를 고른 뒤 종목을 선택하고 적용하면 모두의 화면이 바뀝니다.</p></div><span id="admin-charts-draft" class="admin-draft-tag" hidden>저장 전</span></div>
        <form id="admin-charts-form">
          <div class="admin-chart-slots" role="group" aria-label="편집할 차트"></div>
          <div class="admin-catalog"><label for="admin-catalog-search">종목 검색</label><div class="admin-search-row"><input id="admin-catalog-search" type="search" maxlength="80" autocomplete="off" placeholder="이름 또는 코드 · 비트코인, AAPL, SOXL"><select id="admin-catalog-filter" aria-label="시장 필터"><option value="all">모든 시장</option><option value="crypto">코인</option><option value="kr">국내 주식</option><option value="us">미국 주식</option><option value="etf">미국 ETF</option></select></div><p id="admin-catalog-status" class="admin-field-note" role="status"></p><div class="admin-catalog-results" aria-label="종목 검색 결과"></div></div>
          <div class="admin-operation-actions"><label class="admin-interval-label" for="admin-chart-interval">차트 봉 간격 <select id="admin-chart-interval">${CHART_INTERVALS.map(value => `<option value="${value}">${value === 'D' ? '1일' : value === '60' ? '1시간' : `${value}분`}</option>`).join('')}</select></label><button type="button" class="admin-secondary-action" id="admin-charts-reset">변경 취소</button><button type="submit" class="admin-primary-action" id="admin-charts-save">차트 8개 적용</button></div>
        </form>
      </section>
      <section class="admin-operation-card" aria-labelledby="admin-settings-title">
        <div class="admin-operation-card-heading"><div><span class="admin-eyebrow">LOUNGE SETTINGS</span><h3 id="admin-settings-title">공지 · 후원 · 채팅</h3><p>사무실을 열어 둔 상태에서도 바로 변경할 수 있어요.</p></div><span id="admin-settings-draft" class="admin-draft-tag" hidden>저장 전</span></div>
        <form id="admin-settings-form" class="admin-settings-form">
          <label for="admin-office-notice">참가자 공지 <span id="admin-notice-count">0 / 200자</span></label><textarea id="admin-office-notice" rows="3" placeholder="모든 참가자에게 보여 줄 안내를 적어 주세요."></textarea><p class="admin-field-note">비워서 저장하면 공지가 숨겨집니다.</p>
          <label for="admin-donation-url">카카오페이 후원 링크</label><input id="admin-donation-url" type="url" maxlength="1000" inputmode="url" placeholder="https://qr.kakaopay.com/…" aria-describedby="admin-donation-help"><p id="admin-donation-help" class="admin-field-note">qr.kakaopay.com 또는 link.kakaopay.com의 https 링크를 입력하세요. 비우면 후원 연결이 비활성화됩니다. <a href="https://contents.kakaopay.com/contents/2325" target="_blank" rel="noopener noreferrer">카카오페이 공식 안내 ↗</a></p>
          <label class="admin-chat-switch"><input id="admin-chat-enabled" type="checkbox"><span><strong>참가자 채팅 허용</strong><small>끄면 새로운 채팅 전송을 잠시 멈춥니다.</small></span></label>
          <div class="admin-operation-actions"><button type="button" class="admin-secondary-action" id="admin-settings-reset">변경 취소</button><button type="submit" class="admin-primary-action" id="admin-settings-save">운영 설정 저장</button></div>
        </form>
      </section>
      <div class="admin-moderation-grid">
        <section class="admin-operation-card" aria-labelledby="admin-roster-title"><div class="admin-operation-card-heading"><div><span class="admin-eyebrow">VISITORS</span><h3 id="admin-roster-title">접속 참가자 <span id="admin-roster-count">0</span></h3><p>퇴실은 다시 입장할 수 있고, 입장 제한은 60분 동안 유지됩니다.</p></div></div><div id="admin-roster" class="admin-person-list"></div><div class="admin-clear-chat"><p>현재 대화 목록과 말풍선을 모두 지웁니다.</p><button type="button" class="admin-secondary-action" id="admin-clear-chat">현재 대화 지우기</button></div></section>
        <section class="admin-operation-card" aria-labelledby="admin-blocks-title"><div class="admin-operation-card-heading"><div><span class="admin-eyebrow">ADMISSION</span><h3 id="admin-blocks-title">입장 제한 <span id="admin-block-count">0</span></h3><p>제한을 해제하면 바로 다시 입장할 수 있어요.</p></div></div><div id="admin-blocks" class="admin-person-list"></div></section>
      </div>
      <section class="admin-operation-card" aria-labelledby="admin-audit-title"><div class="admin-operation-card-heading"><div><span class="admin-eyebrow">ACTIVITY</span><h3 id="admin-audit-title">최근 운영 기록</h3><p>최근 작업 80개를 최신순으로 표시합니다.</p></div></div><ol id="admin-audit" class="admin-audit-list"></ol></section>
    </fieldset>`;
  const el = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const fields = host.querySelector<HTMLFieldSetElement>('fieldset')!;
  const slots = host.querySelector<HTMLElement>('.admin-chart-slots')!;
  const resultList = host.querySelector<HTMLElement>('.admin-catalog-results')!;
  const query = el<HTMLInputElement>('admin-catalog-search');
  const filter = el<HTMLSelectElement>('admin-catalog-filter');
  const interval = el<HTMLSelectElement>('admin-chart-interval');
  const noticeInput = el<HTMLTextAreaElement>('admin-office-notice');
  const donationInput = el<HTMLInputElement>('admin-donation-url');
  const chatInput = el<HTMLInputElement>('admin-chat-enabled');
  const message = host.querySelector<HTMLElement>('.admin-operation-message')!;
  let latest: AdminOperationsState | null = null;
  let draftCharts = normalizeOfficeCharts(undefined), activeSlot = 0;
  let chartDirty = false, settingsDirty = false, busy = false;
  let results: MarketSymbol[] = [], searchVersion = 0;
  let controller: AbortController | null = null, debounce: ReturnType<typeof setTimeout> | undefined;
  const time = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = '') => Object.assign(document.createElement(tag), { textContent: text, className });
  const slotButtons = Array.from({ length: OFFICE_CHART_COUNT }, (_, slot) => {
    if (slot % CHARTS_PER_WALL === 0) slots.append(node('h4', slot === 0 ? '앞벽 · 주식·ETF' : '뒷벽 · 코인', 'admin-chart-wall-title'));
    const button = document.createElement('button'); button.type = 'button';
    button.onclick = () => { activeSlot = slot; renderSlots(); renderResults(); };
    slots.append(button); return button;
  });

  function setMessage(text: string, error = false) { message.textContent = text; message.hidden = !text; message.classList.toggle('is-error', error); message.setAttribute('role', error ? 'alert' : 'status'); }
  function updateButtons() {
    host.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy; });
    for (const id of ['admin-charts-save', 'admin-charts-reset']) el<HTMLButtonElement>(id).disabled = busy || !chartDirty;
    for (const id of ['admin-settings-save', 'admin-settings-reset']) el<HTMLButtonElement>(id).disabled = busy || !settingsDirty;
    resultList.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy || button.dataset.symbol === draftCharts[activeSlot].symbol; });
    el('admin-charts-draft').hidden = !chartDirty; el('admin-settings-draft').hidden = !settingsDirty;
    const count = Array.from(noticeInput.value.normalize('NFC')).length;
    el('admin-notice-count').textContent = `${count} / 200자`; el('admin-notice-count').classList.toggle('is-error', count > 200);
  }
  function renderSlots() {
    slotButtons.forEach((button, slot) => {
      const market = draftCharts[slot];
      button.replaceChildren(node('span', `${chartSlotLabel(slot)} 차트`), node('strong', market.name), node('small', market.symbol));
      button.setAttribute('aria-pressed', String(slot === activeSlot));
      button.setAttribute('aria-label', `${chartSlotLabel(slot)} 차트 편집 · ${market.name}`);
    });
    updateButtons();
  }
  function renderResults() {
    const visible = results.filter(market => latest?.koreanChartsEnabled || !market.symbol.startsWith('KRX:'));
    resultList.replaceChildren(...visible.map(market => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.symbol = market.symbol;
      button.append(node('strong', market.name), node('small', market.symbol));
      button.setAttribute('aria-label', `${chartSlotLabel(activeSlot)} 차트에 ${market.name} 선택`);
      button.onclick = () => { draftCharts[activeSlot] = market; chartDirty = true; renderSlots(); renderResults(); setMessage(`${chartSlotLabel(activeSlot)} 차트에 ${market.name}을 선택했어요. 차트 8개 적용을 눌러 저장하세요.`); };
      return button;
    }));
    if (!visible.length) resultList.append(node('p', filter.value === 'kr' && !latest?.koreanChartsEnabled ? '국내 차트 연결을 준비하고 있어요.' : '검색 결과가 없어요. 이름이나 종목 코드를 바꿔 보세요.', 'admin-empty-list'));
    updateButtons();
  }
  async function search() {
    if (!latest) return;
    const version = ++searchVersion; controller?.abort(); const requestController = new AbortController(); controller = requestController;
    el('admin-catalog-status').textContent = '종목을 검색하고 있어요…';
    try {
      const response = await fetch(`/api/markets/search?q=${encodeURIComponent(query.value.trim())}&kind=${filter.value}`, { signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(10000)]), cache: 'no-store' });
      const data = await response.json();
      if (version !== searchVersion || !latest) return;
      if (!response.ok || !Array.isArray(data.markets)) throw new Error(typeof data.message === 'string' ? data.message : '종목 검색에 연결하지 못했어요.');
      results = data.markets; renderResults(); el('admin-catalog-status').textContent = `${results.filter(market => latest?.koreanChartsEnabled || !market.symbol.startsWith('KRX:')).length}개 결과 · 선택한 차트에 적용할 종목을 고르세요.`;
    } catch (error) {
      if (version !== searchVersion || requestController.signal.aborted) return;
      results = searchMarkets(CURATED_MARKETS, query.value, filter.value); renderResults();
      el('admin-catalog-status').textContent = '검색 연결이 지연되어 기본 종목 목록을 표시해요. 검색어를 바꾸면 다시 연결합니다.';
    }
  }
  function scheduleSearch() { clearTimeout(debounce); debounce = setTimeout(() => { void search(); }, 250); }
  query.addEventListener('input', event => { if (!(event instanceof InputEvent) || !event.isComposing) scheduleSearch(); });
  query.addEventListener('compositionstart', () => clearTimeout(debounce));
  query.addEventListener('compositionend', scheduleSearch);
  query.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); clearTimeout(debounce); void search(); } });
  filter.onchange = () => { clearTimeout(debounce); results = []; renderResults(); void search(); };
  interval.onchange = () => { chartDirty = true; updateButtons(); };
  for (const input of [noticeInput, donationInput, chatInput]) input.addEventListener('input', () => { settingsDirty = true; updateButtons(); });

  async function run(body: Record<string, unknown>, success: string) {
    if (busy || !latest) return;
    setMessage('변경 사항을 적용하고 있어요…');
    const error = await options.manage(body, success);
    if (latest) setMessage(error ?? success, !!error);
  }
  el<HTMLFormElement>('admin-charts-form').onsubmit = event => { event.preventDefault(); if (chartDirty) void run({ action: 'charts', symbols: draftCharts.map(market => market.symbol), interval: interval.value }, '공유 차트 8개와 봉 간격을 저장했어요.'); };
  el<HTMLFormElement>('admin-settings-form').onsubmit = event => {
    event.preventDefault(); if (!settingsDirty) return;
    const notice = noticeInput.value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (Array.from(notice).length > 200) { setMessage('공지는 200자까지 입력할 수 있어요.', true); noticeInput.focus(); return; }
    const donationUrl = donationInput.value.trim();
    if (donationUrl) {
      let valid = false;
      try { const url = new URL(donationUrl); valid = url.protocol === 'https:' && ['qr.kakaopay.com', 'link.kakaopay.com'].includes(url.hostname) && !url.username && !url.password && !url.port; } catch { /* Show the field-specific message below. */ }
      if (!valid) { setMessage('https 카카오페이 공식 후원 링크를 입력해 주세요.', true); donationInput.focus(); return; }
    }
    void run({ action: 'settings', notice, donationUrl, chatEnabled: chatInput.checked }, '공지·후원·채팅 설정을 저장했어요.');
  };
  el<HTMLButtonElement>('admin-charts-reset').onclick = () => { chartDirty = false; if (latest) setState(latest); setMessage('저장된 공유 차트로 되돌렸어요.'); };
  el<HTMLButtonElement>('admin-settings-reset').onclick = () => { settingsDirty = false; if (latest) setState(latest); setMessage('저장된 운영 설정으로 되돌렸어요.'); };
  el<HTMLButtonElement>('admin-clear-chat').onclick = () => { void run({ action: 'clear-chat' }, '현재 대화 목록과 말풍선을 지웠어요.'); };

  function actionButton(label: string, name: string, action: string, id: string, success: string) {
    const button = node('button', label, action === 'unblock' ? 'admin-secondary-action' : 'admin-moderation-action'); button.type = 'button';
    button.setAttribute('aria-label', `${name} · ${label}`);
    button.onclick = () => { void run({ action, id, ...(action === 'block' ? { minutes: 60 } : {}) }, success); };
    return button;
  }
  function renderPeople() {
    if (!latest) return;
    const roster = el('admin-roster'); el('admin-roster-count').textContent = String(latest.players.length);
    roster.replaceChildren(...latest.players.map(player => {
      const row = node('div', '', 'admin-person-row'), identity = node('div', '', 'admin-person-identity');
      identity.append(node('strong', player.nickname), node('small', `${player.seat === null ? '이동 중' : `${player.seat + 1}번 좌석`} · ${player.id.slice(0, 8)}`));
      const actions = node('div', '', 'admin-person-actions');
      actions.append(actionButton('퇴실', player.nickname, 'kick', player.id, `${player.nickname}님을 퇴실시켰어요.`), actionButton('60분 제한', player.nickname, 'block', player.id, `${player.nickname}님의 입장을 60분 동안 제한했어요.`));
      row.append(identity, actions); return row;
    }));
    if (!latest.players.length) roster.append(node('p', '현재 접속한 참가자가 없어요.', 'admin-empty-list'));
    const blocks = el('admin-blocks'); el('admin-block-count').textContent = String(latest.blocks.length);
    blocks.replaceChildren(...latest.blocks.map(player => {
      const row = node('div', '', 'admin-person-row'), identity = node('div', '', 'admin-person-identity');
      identity.append(node('strong', player.nickname), node('small', `${time.format(new Date(player.until))}까지 · ${player.id.slice(0, 8)}`));
      row.append(identity, actionButton('제한 해제', player.nickname, 'unblock', player.id, `${player.nickname}님의 입장 제한을 해제했어요.`)); return row;
    }));
    if (!latest.blocks.length) blocks.append(node('p', '입장이 제한된 참가자가 없어요.', 'admin-empty-list'));
    const labels: Record<string, string> = { open: '사무실 열기', close: '사무실 닫기', charts: '공유 차트 변경', settings: '운영 설정 변경', kick: '참가자 퇴실', block: '60분 입장 제한', unblock: '입장 제한 해제', 'clear-chat': '대화 지우기', 'community-hide': '커뮤니티 내용 숨김', 'community-restore': '커뮤니티 내용 복구', 'community-report-dismiss': '커뮤니티 신고 처리' };
    const audit = el('admin-audit');
    audit.replaceChildren(...latest.audit.slice().reverse().map(entry => {
      const row = node('li', '', 'admin-audit-row'), detail = node('div', '');
      detail.append(node('strong', labels[entry.action] ?? entry.action), node('span', entry.detail));
      row.append(node('time', time.format(new Date(entry.at))), detail); return row;
    }));
    if (!latest.audit.length) audit.append(node('li', '아직 운영 기록이 없어요.', 'admin-empty-list'));
  }
  function setState(next: AdminOperationsState, appliedAction?: string) {
    const first = !latest;
    latest = { ...next, settings: normalizeOfficeSettings(next.settings), players: next.players ?? [], blocks: next.blocks ?? [], audit: next.audit ?? [] };
    if (appliedAction === 'charts') chartDirty = false;
    if (appliedAction === 'settings') settingsDirty = false;
    if (!chartDirty) { draftCharts = normalizeOfficeCharts(next.charts); interval.value = latest.settings.interval; }
    if (!settingsDirty) { noticeInput.value = latest.settings.notice; donationInput.value = latest.settings.donationUrl; chatInput.checked = latest.settings.chatEnabled; }
    renderSlots(); renderPeople(); renderResults(); updateButtons();
    if (first) { results = searchMarkets(CURATED_MARKETS, '', 'all'); renderResults(); void search(); }
  }
  return {
    setState,
    setBusy(value: boolean, lockInputs: boolean) { busy = value; fields.disabled = value && lockInputs; host.setAttribute('aria-busy', String(value)); updateButtons(); },
    reset() { latest = null; searchVersion++; controller?.abort(); clearTimeout(debounce); chartDirty = settingsDirty = false; query.value = ''; filter.value = 'all'; activeSlot = 0; setMessage(''); },
  };
}
