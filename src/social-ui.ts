import { SEATS } from '../shared/classroom-layout';
import type { PlayerView } from './scene-types';
import { compactLayout } from './responsive';
import { isActionNotice } from '../shared/action-notices';
import { createSocialFeedGuard } from './social-feed';
import { readChatPreferences, writeChatPreferences, chatBackgroundOpacity, CHAT_LOG_LIMIT, CHAT_VISIBLE_LINES, type ChatPreferenceStorage } from './chat-preferences';
import './action-notices.css';
import './social-panel.css';

export interface ChatMessage {
  id: string;
  playerId: string;
  nickname: string;
  text: string;
  sentAt: number;
  expiresAt: number;
  channel?: 'action';
}

export function createSocialUI(options: {
  now: () => number;
  sendChat: (text: string, requestId: string) => boolean;
  sendSeat: (seat: number | null, requestId: string) => boolean;
  onSeatError: () => void;
  onBubble: (message: ChatMessage) => void;
}) {
  const panel = document.createElement('section');
  panel.id = 'lounge-chat-panel';
  panel.className = 'social-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '라운지 채팅');
  panel.innerHTML = `<div class="social-header"><strong>라운지 채팅 <span>LIVE</span></strong><div><button type="button" class="seat-picker">좌석 선택</button><button type="button" class="chat-settings-toggle" aria-label="채팅 배경 투명도 설정" aria-controls="chat-appearance" aria-expanded="false">배경</button><button type="button" class="chat-toggle" aria-label="최근 대화 4줄로 축소" aria-expanded="true">축소 ▾</button><button type="button" class="chat-compose-close" aria-label="채팅 입력 닫기">×</button></div></div>
    <div id="chat-appearance" class="chat-appearance" hidden><label for="chat-transparency">배경 투명도 <output for="chat-transparency">40%</output></label><input id="chat-transparency" type="range" min="0" max="100" step="5" value="40" aria-label="채팅 배경 투명도"><div><span>선명한 배경</span><span>완전 투명</span></div></div>
    <div class="chat-log" role="log" aria-label="최근 대화" aria-live="polite" aria-relevant="additions"><p class="chat-empty">작게 건넨 말도, 모두에게 닿아요.</p></div>
    <form class="chat-form"><input aria-label="채팅 내용" placeholder="Enter로 대화 시작 · 80자" autocomplete="off" maxlength="160" enterkeyhint="send"><button type="submit" aria-label="채팅 보내기">보내기 ↗</button></form>
    <div class="social-footer"><span class="seat-status">빈 소파나 의자를 눌러 앉아보세요</span><button type="button" class="stand-button" hidden>일어나기 ↑</button><small class="chat-count">0 / 80</small></div>
    <p class="social-message" role="status"></p>`;
  document.querySelector('.world')!.appendChild(panel);
  const input = panel.querySelector<HTMLInputElement>('.chat-form input')!;
  const form = panel.querySelector<HTMLFormElement>('form')!;
  const sendButton = form.querySelector<HTMLButtonElement>('button')!;
  const log = panel.querySelector<HTMLDivElement>('.chat-log')!;
  let pinnedToLatest = true;
  let logWidth = log.clientWidth, logHeight = log.clientHeight;
  function scrollToLatest() { pinnedToLatest = true; log.scrollTop = log.scrollHeight; }
  log.addEventListener('scroll', () => {
    // A browser-generated scroll during rotation must not overwrite the state
    // captured before the viewport changed; ResizeObserver settles that first.
    if (log.clientWidth !== logWidth || log.clientHeight !== logHeight) return;
    pinnedToLatest = log.scrollHeight - log.scrollTop - log.clientHeight < 35;
  }, { passive: true });
  const logResizeObserver = new ResizeObserver(() => {
    const changed = log.clientWidth !== logWidth || log.clientHeight !== logHeight;
    logWidth = log.clientWidth; logHeight = log.clientHeight;
    if (changed && pinnedToLatest && logWidth > 0 && logHeight > 0) scrollToLatest();
  });
  logResizeObserver.observe(log);
  const message = panel.querySelector<HTMLParagraphElement>('.social-message')!;
  const standButton = panel.querySelector<HTMLButtonElement>('.stand-button')!;
  const seatStatus = panel.querySelector<HTMLElement>('.seat-status')!;
  const seatPicker = panel.querySelector<HTMLButtonElement>('.seat-picker')!;
  const toggle = panel.querySelector<HTMLButtonElement>('.chat-toggle')!;
  const closeButton = panel.querySelector<HTMLButtonElement>('.chat-compose-close')!;
  const appearance = panel.querySelector<HTMLElement>('.chat-appearance')!;
  const appearanceButton = panel.querySelector<HTMLButtonElement>('.chat-settings-toggle')!;
  const transparency = panel.querySelector<HTMLInputElement>('#chat-transparency')!;
  const transparencyValue = appearance.querySelector<HTMLOutputElement>('output')!;
  let preferenceStorage: ChatPreferenceStorage | undefined;
  try { preferenceStorage = window.localStorage; } catch { /* Keep the controls usable when browser storage is disabled. */ }
  const preferences = readChatPreferences(preferenceStorage);
  function updateVisibleRows() {
    const rows = [...log.querySelectorAll<HTMLElement>('.chat-line')];
    rows.forEach((row, index) => { row.hidden = !preferences.expanded && index < rows.length - CHAT_VISIBLE_LINES.collapsed; });
  }
  function applyPreferences(scroll = false) {
    panel.classList.toggle('is-collapsed', !preferences.expanded);
    panel.style.setProperty('--chat-background-opacity', String(chatBackgroundOpacity(preferences.transparency)));
    panel.style.setProperty('--chat-visible-lines', String(preferences.expanded ? CHAT_VISIBLE_LINES.expanded : CHAT_VISIBLE_LINES.collapsed));
    toggle.textContent = preferences.expanded ? '축소 ▾' : '펼침 ▴';
    toggle.setAttribute('aria-expanded', String(preferences.expanded));
    toggle.setAttribute('aria-label', preferences.expanded ? '최근 대화 4줄로 축소' : '최근 대화 10줄로 펼치기');
    transparency.value = String(preferences.transparency); transparencyValue.value = `${preferences.transparency}%`;
    transparency.setAttribute('aria-valuetext', `${preferences.transparency}% 투명`);
    log.hidden = false; updateVisibleRows();
    if (scroll) scrollToLatest();
  }
  function closeAppearance() { appearance.hidden = true; appearanceButton.setAttribute('aria-expanded', 'false'); }
  appearanceButton.onclick = () => { appearance.hidden = !appearance.hidden; appearanceButton.setAttribute('aria-expanded', String(!appearance.hidden)); };
  transparency.oninput = () => { preferences.transparency = Number(transparency.value); applyPreferences(); };
  transparency.onchange = () => writeChatPreferences(preferences, preferenceStorage);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !appearance.hidden) { event.preventDefault(); event.stopPropagation(); closeAppearance(); appearanceButton.focus(); } });
  applyPreferences();
  const launcher = document.createElement('button');
  launcher.type = 'button'; launcher.className = 'chat-launch'; launcher.hidden = true;
  launcher.setAttribute('aria-label', '채팅 입력 열기');
  launcher.setAttribute('aria-controls', panel.id); launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z"/></svg><span>채팅</span>';
  document.getElementById('mobile-actions')!.appendChild(launcher);
  const mobile = compactLayout;
  let composing = false;
  function openComposer(focus = true) {
    if (!selfId || !connected || !chatEnabled || document.querySelector('dialog[open]')) return;
    if (mobile.matches) {
      composing = true; panel.classList.add('is-composing'); document.body.classList.add('chat-composing');
      launcher.setAttribute('aria-expanded', 'true');
      closeAppearance(); applyPreferences();
      panel.scrollTop = 0; scrollToLatest();
    }
    if (focus) input.focus({ preventScroll: true });
  }
  function closeComposer() {
    if (composing && document.activeElement === input) input.blur();
    composing = false; panel.classList.remove('is-composing'); document.body.classList.remove('chat-composing');
    launcher.setAttribute('aria-expanded', 'false');
    closeAppearance();
    // Keep any unsent draft. The next open resumes the same text.
  }
  launcher.onclick = () => openComposer(); closeButton.onclick = closeComposer;
  mobile.addEventListener('change', () => { closeComposer(); });
  const dialog = document.createElement('dialog');
  dialog.className = 'modal seat-dialog';
  dialog.id = 'seat-dialog';
  dialog.setAttribute('aria-labelledby', 'seat-title');
  dialog.innerHTML = `<div class="modal-header"><div><span class="eyebrow">TAKE A SEAT</span><h2 id="seat-title">편한 자리에 앉아 이야기해요.</h2></div><button type="button" class="tool-button" aria-label="좌석 선택 닫기">×</button></div><p class="modal-description">빈 좌석을 고르거나 사무실의 소파·의자를 직접 누르세요.<br>이동 키나 ‘일어나기’를 누르면 다시 걸을 수 있어요.</p><div class="seat-board-label">라운지 좌석 · 총 ${SEATS.length}석</div><div class="seat-grid"></div><p class="seat-message" role="status"></p>`;
  document.body.appendChild(dialog);
  const seatMessage = dialog.querySelector<HTMLParagraphElement>('.seat-message')!;
  const grid = dialog.querySelector<HTMLDivElement>('.seat-grid')!;
  const seatButtons = SEATS.map(seat => {
    const button = document.createElement('button');
    button.type = 'button';
    button.onclick = () => requestSeat(seat.id);
    grid.appendChild(button);
    return button;
  });
  let selfId: string | null = null;
  let connected = false;
  let chatEnabled = true;
  let players: PlayerView[] = [];
  let cooldownUntil = 0;
  let pendingChat: { id: string; text: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let pendingSeat: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  const feed = createSocialFeedGuard();

  function clearChatPending() { if (pendingChat) clearTimeout(pendingChat.timer); pendingChat = null; }
  function clearSeatPending() { if (pendingSeat) clearTimeout(pendingSeat.timer); pendingSeat = null; }
  function setMessage(text: string) { message.textContent = text; seatMessage.textContent = text; }
  function tick() {
    const count = Array.from(input.value).length;
    panel.querySelector('.chat-count')!.textContent = `${count} / 80`;
    sendButton.disabled = !connected || !chatEnabled || !!pendingChat || !input.value.trim() || count > 80 || options.now() < cooldownUntil;
    input.disabled = !connected || !chatEnabled;
    input.placeholder = chatEnabled ? 'Enter로 대화 시작 · 80자' : '관리자가 채팅을 잠시 껐어요';
    launcher.disabled = !connected || !chatEnabled;
    seatPicker.disabled = !connected;
    standButton.disabled = !connected || !!pendingSeat;
  }
  function updateSeats() {
    const mine = players.find(player => player.id === selfId);
    const seated = mine?.seat != null;
    standButton.hidden = !seated;
    seatStatus.textContent = seated ? `${SEATS.find(seat => seat.id === mine.seat)?.label ?? '좌석'}에 앉아 있어요` : '빈 소파나 의자를 눌러 앉아보세요';
    for (const [index, button] of seatButtons.entries()) {
      const occupant = players.find(player => player.seat === SEATS[index]!.id);
      const isMine = !!occupant && occupant.id === selfId;
      const label = occupant ? (isMine ? '내 자리 · 일어나기' : occupant.nickname) : '비어 있음';
      button.replaceChildren(Object.assign(document.createElement('strong'), { textContent: SEATS[index]!.label }), Object.assign(document.createElement('span'), { textContent: label }));
      button.classList.toggle('is-mine', isMine);
      button.disabled = !connected || !!pendingSeat || (!!occupant && !isMine);
      button.setAttribute('aria-label', `${SEATS[index]!.label} · ${label}`);
    }
    tick();
  }
  function requestSeat(seat: number | null) {
    if (!connected || pendingSeat) return;
    if (seat != null && players.find(player => player.id === selfId)?.seat === seat) seat = null;
    const id = crypto.randomUUID();
    if (!options.sendSeat(seat, id)) { setMessage('연결을 복구한 뒤 다시 눌러 주세요.'); return; }
    setMessage('');
    pendingSeat = { id, timer: setTimeout(() => { clearSeatPending(); options.onSeatError(); setMessage('자리 응답을 확인하지 못했어요. 다시 눌러 주세요.'); updateSeats(); }, 5000) };
    updateSeats();
  }
  form.onsubmit = event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!connected || !chatEnabled || pendingChat || options.now() < cooldownUntil || !text) return;
    if (Array.from(text).length > 80) { setMessage('채팅은 80자까지 보낼 수 있어요.'); return; }
    const id = crypto.randomUUID();
    if (!options.sendChat(text, id)) { setMessage('연결을 복구한 뒤 다시 보내 주세요.'); return; }
    setMessage('');
    pendingChat = { id, text, timer: setTimeout(() => { clearChatPending(); setMessage('전송을 확인하지 못했어요. 내용을 남겨두었으니 다시 보내 주세요.'); if (mobile.matches) openComposer(false); tick(); }, 5000) };
    tick();
  };
  input.addEventListener('input', () => { message.textContent = ''; tick(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
    if (event.key === 'Escape' && !event.isComposing) { if (mobile.matches) closeComposer(); else input.blur(); }
  });
  window.addEventListener('keydown', event => {
    if(document.body.classList.contains('jump-game-open'))return;
    if (event.key === 'Escape' && !event.isComposing && composing && !document.querySelector('dialog[open]')) { event.preventDefault(); closeComposer(); return; }
    if (event.key !== 'Enter' || event.isComposing || !connected || !selfId || document.querySelector('dialog[open]')) return;
    if (event.target instanceof HTMLElement && event.target.closest('input,textarea,button,select,[contenteditable="true"]')) return;
    event.preventDefault(); openComposer();
  });
  toggle.onclick = () => {
    preferences.expanded = !preferences.expanded; applyPreferences(true); writeChatPreferences(preferences, preferenceStorage);
  };
  standButton.onclick = () => requestSeat(null);
  seatPicker.onclick = () => {
    closeComposer();
    setMessage(''); updateSeats();
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => other.close());
    dialog.showModal();
  };
  dialog.querySelector<HTMLButtonElement>('.tool-button')!.onclick = () => dialog.close();
  function receiveChat(chat: ChatMessage, requestId?: string, history = false) {
    if (chat.playerId === selfId && pendingChat && pendingChat.id === requestId) {
      if (input.value.trim() === pendingChat.text) input.value = '';
      clearChatPending(); cooldownUntil = chat.sentAt + 1200; tick();
      if (mobile.matches && !input.value.trim()) closeComposer();
    }
    appendMessage({ ...chat, channel: undefined }, history);
  }
  function appendMessage(chat: ChatMessage, history = false) {
    const accepted = feed.accept(chat, options.now(), history);
    if (!accepted) return;
    if (accepted.bubble) options.onBubble(chat);
    if (!accepted.log) return;
    log.querySelector('.chat-empty')?.remove();
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 35;
    const row = document.createElement('p');
    row.className = `chat-line${chat.playerId === selfId ? ' is-self' : ''}`;
    const name = document.createElement('strong'); name.textContent = chat.nickname;
    const text = document.createElement('span'); text.textContent = chat.text;
    row.append(name, text); log.appendChild(row);
    while (log.childElementCount > CHAT_LOG_LIMIT) log.firstElementChild?.remove();
    updateVisibleRows();
    if (nearBottom || chat.playerId === selfId) scrollToLatest();
  }
  function receiveActionNotice(value: unknown) {
    if (!isActionNotice(value)) return;
    appendMessage({ id: value.id, playerId: value.playerId, nickname: value.nickname, text: value.text, sentAt: value.at, expiresAt: value.expiresAt, channel: 'action' });
  }
  function seatState(requestId: string) {
    if (pendingSeat?.id !== requestId) return;
    clearSeatPending(); setMessage(''); dialog.close(); updateSeats();
  }
  function error(requestId: string | undefined, text: string, retryAt?: number) {
    if (!requestId) return false;
    if (pendingChat?.id === requestId) {
      clearChatPending();
      if (retryAt) cooldownUntil = retryAt;
      setMessage(text); if (mobile.matches) openComposer(false); tick(); return true;
    }
    if (pendingSeat?.id === requestId) { clearSeatPending(); options.onSeatError(); setMessage(text); updateSeats(); return true; }
    return false;
  }
  function setSession(id: string | null, live: boolean) {
    selfId = id; connected = live;
    panel.hidden = !id;
    launcher.hidden = !id; launcher.disabled = !live;
    if (!live) { closeComposer(); clearChatPending(); clearSeatPending(); options.onSeatError(); }
    updateSeats();
  }
  function reset() {
    setSession(null, false); players = []; feed.clear(); cooldownUntil = 0;
    input.value = ''; log.replaceChildren(); pinnedToLatest = true; setMessage(''); dialog.close();
  }
  return {
    setChatEnabled(enabled: boolean) { chatEnabled = enabled; if (!enabled) { closeComposer(); clearChatPending(); } tick(); },
    clearChats() { feed.clear(); log.replaceChildren(Object.assign(document.createElement('p'), { className: 'chat-empty', textContent: '관리자가 최근 대화를 비웠어요.' })); pinnedToLatest = true; },
    setSession, setPlayers(next: PlayerView[]) { players = next; updateSeats(); }, receiveChat, receiveActionNotice, requestSeat, seatState, error, tick, reset, openComposer, closeComposer,
  };
}
