import { createJumpGameUI } from './jump-game-ui';
import type { JumpLeaderView } from '../shared/jump-portal';
import './social.css';
import './office.css';
import './mobile-chat.css';
import { createClassroom } from './classroom';
import { connectOfficeCommunity } from './office-community';
import { createRefreshmentsUI } from './refreshments-ui';
import { createSocialUI, type ChatMessage } from './social-ui';
import { createMarketPanelCollapse } from './market-panel-collapse';
import { mountStockProfileFields } from './profile-ui';
import { appendStockProfileParams, type StockProfile } from '../shared/stock-profile';
import { createMarketBoard } from './market-board';
import { DEFAULT_CHARTS } from '../shared/office-charts';
import { normalizeOfficeSettings, type OfficeSettings } from '../shared/office-settings';
import { createSupport } from './support';
import { createKakaoInvite } from './kakao-invite';
import { compactLayout } from './responsive';
import { createMobileShell } from './mobile-shell';
import { createMobileMovement } from './mobile-movement';
import { createAvatarActionsUI } from './avatar-actions-ui';
import { isAvatarActionView } from '../shared/avatar-actions';
import { isShoulderLinkView } from '../shared/shoulder-links';
import { createMarketUI, type MarketSymbol, type MarketState } from './market-ui';
import type { PlayerView } from './scene-types';
import { getMarketAssetType, getMarketRegion } from '../shared/market-catalog';
import { createAvatarCustomizer } from './avatar-customizer';
import { createGameHubUI } from './game-hub-ui';
import { createWhisperUI } from './whisper-ui';
import { createStickerUI } from './sticker-ui';
import { defaultAvatarProfile, type AvatarProfile } from '../shared/avatar-catalog';

const icons: Record<string, string> = {
  chart: '<path d="M4 3v17h17M7 15l4-5 4 3 5-7"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4v.1"/>',
  exit: '<path d="M9 4H4v16h5m5-13 5 5-5 5m-7-5h12"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
};
const icon = (name: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ''}</svg>`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="포듬증권 홈"><span class="brand-mark">ㅍ</span><span>포듬증권<small>PODEUM SECURITIES</small></span></a>
    <div class="floor-badge"><i class="live-dot"></i>MARKET LOUNGE<span id="population">정원 50명</span></div>
    <span id="header-support-host"></span>
    <div class="identity"><div><small id="identity-status">무료 입장 · 닉네임으로 시작</small><strong id="identity-name">방문자</strong></div></div>
  </header>
  <main class="world">
    <section id="mobile-chart-panel" aria-label="모바일 공유 차트"><div id="mobile-chart-host"></div></section>
    <div id="classroom" aria-label="포듬증권 3D 사무실. 바닥을 누르거나 방향키로 이동하세요."></div>
    <div class="world-heading"><div class="eyebrow">A ROOM FOR YOUR PERSPECTIVE</div><h1>같은 차트.<br><em>다른 관점.</em></h1><p>함께 보고, 이야기하고, 시장을 읽으세요.</p></div>
    <div class="market-ticker"><span class="ticker-dot"></span><span>지금 함께 보는 차트</span><strong id="ticker-symbol">BTCUSDT</strong><small id="ticker-exchange">BINANCE · CRYPTO</small><button id="ticker-open-chart" aria-label="현재 차트 확대">↗</button></div>
    <aside class="market-panel" id="market-panel" aria-label="공유 차트와 사무실 안내">
      <section class="selected-market"><div class="panel-heading"><span class="eyebrow">ON THE BIG SCREEN</span><span class="tag" id="selected-kind">CRYPTO</span></div><h2 id="selected-name">비트코인 / USDT</h2><p class="selected-symbol" id="selected-symbol">BINANCE:BTCUSDT</p><button class="button button-outline full" id="open-chart">${icon('chart')}정면·후면 차트 보기<span>↗</span></button><p class="data-note" id="selected-data-note">TradingView 제공 · 암호화폐 실시간 시세</p></section>
      <div id="shared-chart-slots"></div><p class="data-note" id="chart-policy">1분봉 · 종목과 분봉은 관리자만 변경할 수 있어요.</p>
      <p id="office-notice" class="office-notice" role="status" hidden></p>
      <div class="office-services"><a href="/markets">시세·김치프리미엄 ↗</a><span id="office-support-host"></span></div>
      <section class="attendance"><span>${icon('people')} 함께 보는 사람들</span><div id="classmates"><small>첫 번째 자리가 비어 있어요.</small></div></section>
    </aside>
    <div class="bottom-bar"><div class="move-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span class="hint-text">드래그 회전 · 우클릭 드래그 이동 · 휠 확대</span></div><div class="world-tools"><button class="tool-button view-preset" id="free-view" aria-label="자유 시점" aria-pressed="true">자유 시점</button><button class="tool-button" id="pan-left" aria-label="화면 왼쪽으로 이동">←</button><button class="tool-button" id="pan-up" aria-label="화면 위로 이동">↑</button><button class="tool-button" id="pan-down" aria-label="화면 아래로 이동">↓</button><button class="tool-button" id="pan-right" aria-label="화면 오른쪽으로 이동">→</button><button class="tool-button" id="rotate-left" title="왼쪽으로 시점 회전" aria-label="왼쪽으로 시점 회전">↶</button><button class="tool-button" id="rotate-right" title="오른쪽으로 시점 회전" aria-label="오른쪽으로 시점 회전">↷</button><button class="tool-button" id="zoom-out" title="축소" aria-label="축소">−</button><button class="tool-button" id="zoom-in" title="확대" aria-label="확대">＋</button><button class="tool-button view-preset" id="view-button" aria-label="대형 차트 정면 보기">차트 보기</button><button class="tool-button view-preset" id="reset-view" title="내 캐릭터로 돌아가 따라가기" aria-label="내 캐릭터 따라가기">내 캐릭터</button><button class="tool-button" id="help-button" title="이용 안내" aria-label="이용 안내">${icon('help')}</button><button class="tool-button" id="leave-button" title="사무실 나가기" aria-label="사무실 나가기" hidden>${icon('exit')}</button></div><span class="connection-label" id="connection"><i></i>입장 대기</span></div>
    <div class="mobile-actions" id="mobile-actions"><button id="mobile-chart">${icon('chart')}차트 확대</button><button id="mobile-market" aria-controls="market-panel" aria-expanded="false">${icon('search')}차트·안내</button></div>
    <section class="admission" id="admission" aria-label="포듬증권 입장"><div class="admission-top"><span class="entry-number">VISITOR PASS / 001</span><span>↗</span></div><div class="eyebrow">WELCOME TO THE MARKET LOUNGE</div><h2>오늘의 관점,<br><em>한 자리 보태세요.</em></h2><p>같은 차트를 보며 나누는 작은 대화.<br>나만의 캐릭터로, 포듬증권에 함께해 볼까요?</p><form id="join-form"><label for="nickname">사무실에서 불릴 이름</label><div class="input-wrap"><input id="nickname" name="nickname" autocomplete="nickname" placeholder="닉네임을 입력해 주세요" minlength="2" maxlength="12" required><span>2–12자</span></div><button type="submit" class="button button-primary full" id="join-button">사무실에 들어가기${icon('arrow')}</button><p class="form-message" id="join-message" role="status"></p></form><div class="admission-footer"><span class="live-dot"></span>무료 입장<span>·</span>최대 50명<span>·</span>회원가입 없이</div></section>
    <div id="render-error" class="render-error" hidden>3D 화면을 열 수 없어요. WebGL을 지원하는 브라우저에서 다시 열어 주세요. 차트 확대는 계속 이용할 수 있어요.</div>
  </main>
  <dialog id="chart-dialog" class="modal chart-dialog" aria-labelledby="chart-dialog-title"><div class="modal-header"><div><span class="eyebrow">THE SHARED MARKET SCREEN</span><h2 id="chart-dialog-title">함께 보는 시장</h2></div><button class="tool-button close-modal" aria-label="차트 닫기">${icon('close')}</button></div><div id="large-chart-host"></div><p class="chart-footnote">공유 종목과 분봉은 관리자만 변경합니다. 각 차트는 확대해서 볼 수 있어요. 주식·ETF 시세는 지연되거나 표시가 제한될 수 있어요.</p></dialog>
  <dialog id="help-dialog" class="modal help-modal" aria-labelledby="help-title"><div class="modal-header"><div><span class="eyebrow">WELCOME TO PODEUM SECURITIES</span><h2 id="help-title">포듬증권 이용 안내</h2></div><button class="tool-button close-modal" aria-label="안내 닫기">${icon('close')}</button></div><ol class="office-rules"><li><b>같은 차트, 다른 관점</b><p>최대 50명이 앞뒤 벽에 네 개씩 놓인 여덟 종목의 차트를 함께 봅니다. 정면은 삼성전자·SK하이닉스·TQQQ·SOXL, 후면은 비트코인·이더리움·리플·테더의 1분봉으로 시작하고, 각 칸의 ↗ 버튼으로 하나만 크게 볼 수 있어요. 모바일 차트 탭에서는 위의 종목 이름을 눌러 한 종목씩 넓게 볼 수 있어요. 닉네임만 정하면 무료로 입장할 수 있어요.</p></li><li><b>관리자가 정하는 공유 차트</b><p id="help-chart-policy">종목과 분봉은 관리자만 변경할 수 있어요. 참가자는 여덟 차트 중 원하는 차트를 선택해서 확대할 수 있습니다. 사무실에 50명이 접속 중이면 새 참가자는 포듬 시세 페이지로 자동 연결됩니다.</p></li><li><b>실제 시장 데이터</b><p id="help-chart-data">코인·미국 주식·ETF는 TradingView 차트입니다. 국내 주식은 Vunelix 연결을 준비 중이며, 연결 상태는 차트에서 확인할 수 있어요. 바이낸스 암호화폐 시세는 실시간이며 주식·ETF는 지연되거나 표시가 제한될 수 있어요. 차트의 데이터 안내를 확인하세요.</p></li><li><b>대화와 자리 선택</b><p>Enter 또는 모바일의 채팅 버튼을 눌러 80자까지 대화하세요. 모바일 입력창은 메시지를 보낸 뒤 접히며, 사무실 화면에서는 최근 대화만 작게 표시됩니다. 말풍선은 머리 위에 8초 동안 표시됩니다. 빈 소파·의자나 채팅창의 좌석 선택으로 앉고, 이동 키나 일어나기로 다시 걸을 수 있어요.</p></li><li><b>내가 편한 시점으로</b><p>벽과 천장이 있는 사무실 안에서 자유롭게 둘러보세요. 카메라와 캐릭터는 실내 범위 안에서만 이동합니다. 드래그로 회전, 오른쪽 버튼·Shift 드래그로 화면 이동, 휠로 확대·축소하세요. 두 손가락으로도 화면 이동과 확대가 가능해요. 위 보기·아래 보기로 고개 각도를 조절하고, 차트 보기로 벽을 정면에서 보세요. 내 캐릭터 버튼은 편한 기본 각도로 돌아와 따라가기를 켭니다. 화면을 옮기면 따라가기가 해제됩니다. 바닥 클릭·WASD·방향키는 캐릭터 이동입니다. 모바일에서는 왼쪽 아래 방향 버튼을 누르고 있으면 걷고, 화면 드래그로 둘러봅니다. 오른쪽 내 캐릭터 버튼으로 시점을 복구할 수 있어요.</p></li></ol><p class="data-note">함께 시장을 보는 소셜 공간입니다. 이곳에서 실제 주문이나 결제는 이루어지지 않아요.</p></dialog>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
createMarketPanelCollapse(el('market-panel'));
const nicknameInput = el<HTMLInputElement>('nickname');
const stockProfileFields = mountStockProfileFields(el<HTMLFormElement>('join-form'));
try { nicknameInput.value = localStorage.getItem('podeumgo.nickname') || ''; } catch { /* Optional preference. */ }
type Me = { id: string; nickname: string; stockProfile?: StockProfile | null };
let me: Me | null = null;
let players: PlayerView[] = [];
let playersById = new Map<string, PlayerView>();
let socket: WebSocket | null = null;
let intentionalClose = false;
let isConnecting = false;
let connectionGeneration = 0;
let serverOffset = 0;
let retryCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let view: 'room' | 'chart' = 'room';
let activeNickname = '';
let activeStockProfile: StockProfile | null = null;
let roomOpen = true;
let scene: ReturnType<typeof createClassroom> | null = null;
let mobileShell: ReturnType<typeof createMobileShell> | null = null;
let mobileMovement: ReturnType<typeof createMobileMovement> | null = null;
let gameHub: ReturnType<typeof createGameHubUI> | null = null;
let jumpGame: ReturnType<typeof createJumpGameUI> | null = null;
let avatarProfile: AvatarProfile = defaultAvatarProfile();

function send(body: Record<string, unknown>): boolean {
  if (!me || socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(body)); return true;
}
const social = createSocialUI({
  now: () => Date.now() + serverOffset,
  sendChat(text, requestId) { return send({ type: 'chat', text, requestId }); },
  sendSeat(seat, requestId) {
    if (!me || socket?.readyState !== WebSocket.OPEN) return false;
    scene?.stopMovement();
    return send(seat == null ? { type: 'stand', requestId } : { type: 'sit', seat, requestId });
  },
  onBubble(chat) { scene?.showChat({ ...chat, sentAt: chat.sentAt - serverOffset, expiresAt: chat.expiresAt - serverOffset }); },
  onSeatError() { scene?.cancelSeatAction(); },
});
const refreshments = createRefreshmentsUI({
  now: () => Date.now() + serverOffset,
  beforeOpen() { social.closeComposer(); scene?.pauseMovement(); },
  send(selection, requestId) { return send({ type: 'refreshments', refreshments: selection, requestId }); },
});
const avatarActions = createAvatarActionsUI({
  now: () => Date.now() + serverOffset,
  predictJump(action) {
    if (action && me) {
      const player = playersById.get(me.id);
      if (player) player.action = null;
      scene?.updatePlayerAction(me.id, null);
    }
    scene?.predictJump(action);
  },
  beforeOpen() { social.closeComposer(); scene?.prepareShoulderLink(); },
  send(kind, requestId) { if (kind !== 'jump') scene?.pauseMovement(); return send({ type: 'avatar-action', kind, requestId }); },
  putAway(requestId) { return send({ type: 'refreshments', refreshments: null, requestId }); },
  setShoulder(enabled, requestId) { if (enabled) scene?.prepareShoulderLink(); return send({ type: 'shoulder-link', enabled, requestId }); },
  cheerShoulder(requestId) { scene?.pauseMovement(); return send({ type: 'shoulder-cheer', requestId }); },
  notify: toast,
});
function beforePrivatePanel() { social.closeComposer(); scene?.pauseMovement(); }
const whispers = createWhisperUI({send: (to, text, requestId) => send({type:'whisper',to,text,requestId}), notify:toast, beforeOpen:beforePrivatePanel,onUnread:count=>gameHub?.setWhisperUnread(count)});
const studio = createAvatarCustomizer({onSaved:applyAvatarProfile,notify:toast,onShop:()=>gameHub?.openShop(),beforeOpen:beforePrivatePanel});
const stickers = createStickerUI({send:(itemId,requestId)=>send({type:'chat-sticker',itemId,requestId}),notify:toast,onShop:()=>gameHub?.openShop(),beforeOpen:beforePrivatePanel});
function applyAvatarProfile(value:AvatarProfile) { avatarProfile=value; studio.setProfile(value); avatarActions.setOwned(value.owned); stickers.setOwned(value.owned); gameHub?.setProfile(value); jumpGame?.setProfile(value); }
el('join-form').querySelector('.stock-profile-fields')!.before(studio.button);
gameHub = createGameHubUI({send, now:()=>Date.now()+serverOffset,
  onOpen(){ beforePrivatePanel(); document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close()); el('app').inert=true; scene?.stopMovement(); scene?.setRenderingActive(false); updateMobileMovement(); },
  onExit(){ el('app').inert=false; updateChartPlacement(); },
  onAppearance:selection=>void studio.open(selection),onWhisper:id=>whispers.open(id),onNotify:toast,onProfile:applyAvatarProfile,
});
jumpGame=createJumpGameUI({send,now:()=>Date.now()+serverOffset,
  onOpen(){beforePrivatePanel();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());el('app').inert=true;scene?.pauseMovement();scene?.setRenderingActive(false);updateMobileMovement();},
  onExit(){el('app').inert=false;scene?.cancelSeatAction();updateChartPlacement();},
  onProfile:applyAvatarProfile,onNotify:toast,
});
const extraTools=document.createElement('div');extraTools.className='podeum-extra-tools';
const gamesButton=document.createElement('button');gamesButton.type='button';gamesButton.id='game-room-button';gamesButton.textContent='♟ 게임룸';
gamesButton.onclick=()=>{if(!me){toast('닉네임과 캐릭터를 정해 먼저 입장해 주세요.');mobileShell?.openAdmission();return;}gameHub?.open();};
const studioButton=document.createElement('button');studioButton.type='button';studioButton.textContent='✦ 캐릭터 꾸미기';studioButton.onclick=()=>void studio.open();
extraTools.append(gamesButton,studioButton,whispers.button,stickers.button);el('market-panel').append(extraTools);
const directGameButton=gamesButton.cloneNode(true) as HTMLButtonElement;directGameButton.id='game-room-launch';directGameButton.className='tool-button view-preset podeum-extra-tool';directGameButton.onclick=gamesButton.onclick;document.querySelector('.world-tools')!.prepend(directGameButton);
createKakaoInvite({ beforeOpen: () => social.closeComposer() });
try {
  scene = createClassroom(el('classroom'), {
    isConnected: () => socket?.readyState === WebSocket.OPEN && !isConnecting && !gameHub?.isOpen() && !jumpGame?.isOpen(),
    onMove(x, z) { send({ type: 'move', x, z }); },
    onSit(seat) { social.requestSeat(seat); },
    onStand() { social.requestSeat(null); },
    onInteract(_target, side) { if (side === 'rear') market.setActiveSlot(4); else market.setActiveSlot(0); openModal('chart-dialog'); },
    onViewChange(next) { view = next; updateViewLabel(); },
    onFollowChange(enabled) { el('free-view').setAttribute('aria-pressed', String(!enabled)); el('reset-view').setAttribute('aria-pressed', String(enabled)); },
    onCommunityPost(postId) { window.open(postId ? `/markets?post=${encodeURIComponent(postId)}` : '/markets?view=community', '_blank', 'noopener'); },
    onRefreshments() { refreshments.open(); },
    onJumpPortal() { jumpGame?.open(); },
  });
} catch (error) { console.error(error); el('render-error').hidden = false; }
function returnToCharacter() { scene?.resetView(); view = 'room'; updateViewLabel(); }
mobileMovement = createMobileMovement({
  onMove(direction, pressed) { scene?.setMoveInput(direction, pressed); },
  onResetView: returnToCharacter,
});
function updateMobileMovement() {
  mobileMovement?.setActive(!gameHub?.isOpen() && !jumpGame?.isOpen() && !!scene && !!me && socket?.readyState === WebSocket.OPEN && compactLayout.matches && !!mobileShell?.isOfficeView());
  avatarActions.setActive(!gameHub?.isOpen() && !jumpGame?.isOpen() && !!scene && !!me && socket?.readyState === WebSocket.OPEN && (!compactLayout.matches || !!mobileShell?.isOfficeView()));
  stickers.setConnected(!gameHub?.isOpen() && !jumpGame?.isOpen() && !!me && socket?.readyState === WebSocket.OPEN);
  avatarActions.setJumpAction(me ? playersById.get(me.id)?.action ?? null : null, Date.now() + serverOffset);
}
el('free-view').setAttribute('aria-pressed', 'false');
el('reset-view').setAttribute('aria-pressed', 'true');
const communityButton = document.createElement('button');
communityButton.id = 'community-view';
communityButton.className = 'tool-button view-preset'; communityButton.type = 'button';
communityButton.textContent = '인기글 보기'; communityButton.setAttribute('aria-label', '오른쪽 벽 인기글 보기');
communityButton.onclick = () => { scene?.viewCommunity(); view = 'room'; updateViewLabel(); };
el('view-button').after(communityButton);
const refreshmentsButton = document.createElement('button');
refreshmentsButton.id = 'refreshments-button'; refreshmentsButton.type = 'button'; refreshmentsButton.className = 'tool-button view-preset';
refreshmentsButton.textContent = '☕ 스낵바'; refreshmentsButton.setAttribute('aria-label', '스낵바로 이동해서 음료나 간식 가져가기');
refreshmentsButton.onclick = () => {
  if (!me || socket?.readyState !== WebSocket.OPEN || !scene) { refreshments.open(); return; }
  social.closeComposer(); document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  mobileShell?.setView('office'); scene.approachRefreshments(); view = 'room'; updateViewLabel();
};
communityButton.after(refreshmentsButton);
const jumpButton=document.createElement('button');jumpButton.id='jump-tower-button';jumpButton.type='button';jumpButton.className='tool-button view-preset';jumpButton.textContent='↟ 점프 타워';
jumpButton.onclick=()=>{if(!me||socket?.readyState!==WebSocket.OPEN){toast('먼저 사무실에 입장해 주세요.');mobileShell?.openAdmission();return;}social.closeComposer();document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>dialog.close());mobileShell?.setView('office');scene?.approachJumpPortal();};
refreshmentsButton.after(jumpButton);
const jumpPanelButton=jumpButton.cloneNode(true) as HTMLButtonElement;jumpPanelButton.id='jump-tower-panel-button';jumpPanelButton.onclick=jumpButton.onclick;extraTools.prepend(jumpPanelButton);
let jumpLeaderboardKey='';
function setJumpLeaderboard(leaders:JumpLeaderView[]){const key=JSON.stringify(leaders);if(key===jumpLeaderboardKey)return;jumpLeaderboardKey=key;scene?.setJumpLeaderboard(leaders);jumpGame?.setLeaderboard(leaders);}
let rankingFetchedAt=0;
async function refreshJumpLeaderboard(){if(document.hidden||Date.now()-rankingFetchedAt<60000)return;rankingFetchedAt=Date.now();try{const response=await fetch('/api/jump/leaderboard');if(!response.ok)return;const data=await response.json();if(Array.isArray(data.leaders))setJumpLeaderboard(data.leaders);}catch{/* Keep the last readable sign when offline. */}}
void refreshJumpLeaderboard();document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshJumpLeaderboard();});
const rearChartsButton = document.createElement('button');
rearChartsButton.id = 'rear-charts-view'; rearChartsButton.type = 'button'; rearChartsButton.className = 'tool-button view-preset';
rearChartsButton.textContent = '후면 코인 차트'; rearChartsButton.setAttribute('aria-label', '후면 코인 차트 정면 보기');
rearChartsButton.onclick = () => { scene?.viewRearCharts(); view = 'chart'; updateViewLabel(); };
el('view-button').after(rearChartsButton);
const communityLink = document.createElement('a');
communityLink.className = 'text-link'; communityLink.href = '/markets?view=community'; communityLink.target = '_blank'; communityLink.rel = 'noopener';
communityLink.textContent = '커뮤니티 글 읽기 · 쓰기 ↗';
el('office-support-host').before(communityLink);
const popular = connectOfficeCommunity({ show(posts, state) { scene?.setPopularPosts(posts, state); }, time(serverTime) { scene?.setServerTime(serverTime); } });
window.addEventListener('pagehide', event => { if (!event.persisted) { popular.dispose(); refreshments.dispose(); avatarActions.dispose(); mobileMovement?.dispose(); mobileShell?.dispose(); studio.dispose(); whispers.dispose(); stickers.dispose(); gameHub?.dispose(); jumpGame?.dispose(); } });
const refreshmentsHelp = document.createElement('li');
const refreshmentsHelpTitle = document.createElement('b'); refreshmentsHelpTitle.textContent = '스낵바에서 골라 들고 가기';
const refreshmentsHelpText = document.createElement('p'); refreshmentsHelpText.textContent = '☕ 스낵바 버튼이나 창가 카운터를 누르면 그 앞으로 이동합니다. 음료·간식·세트를 골라 들고 다니며 액션 메뉴에서 먹거나 마실 수 있어요. 비우고 싶으면 어디서든 액션 → 내려놓기를 누르세요. 새 메뉴는 스낵바에서 가져갈 수 있어요.';
refreshmentsHelp.append(refreshmentsHelpTitle, refreshmentsHelpText); el('help-dialog').querySelector('.office-rules')!.append(refreshmentsHelp);
const shoulderHelp = document.createElement('li');
shoulderHelp.innerHTML = '<b>함께 어깨동무하기</b><p>빈손으로 서서 액션 → 어깨걸어를 누르세요. 가까운 사람도 같은 버튼을 누르면 옆으로 모여 어깨동무해요. 두 명 이상 모이면 액션 → 으쌰! 으쌰!로 6초 동안 함께 상체를 좌우로 흔들 수 있어요. 이동·다른 액션 또는 어깨동무 풀기로 언제든 빠져나올 수 있어요.</p>';
el('help-dialog').querySelector('.office-rules')!.append(shoulderHelp);
const actionNoticeHelp = document.createElement('li');
actionNoticeHelp.innerHTML = '<b>동작도 함께 보여요</b><p>점프·인사·먹기 같은 액션을 하면 머리 위에 5초 동안 동작 말풍선이 떠요. 액션 문구는 채팅 기록에 쌓이지 않으며 다른 참가자도 머리 위에서 볼 수 있어요.</p>';
el('help-dialog').querySelector('.office-rules')!.append(actionNoticeHelp);
const chatDisplayHelp = document.createElement('li');
chatDisplayHelp.innerHTML = '<b>편하게 읽는 채팅창</b><p>채팅창을 펼치면 최근 대화 약 10개, 접으면 최근 4줄을 볼 수 있어요. 투명도 설정으로 배경만 투명하게 만들 수 있고 글자는 선명하게 유지돼요. 설정은 이 브라우저에 저장됩니다. 모바일에서는 채팅 버튼을 누를 때 입력창이 열려요.</p>';
el('help-dialog').querySelector('.office-rules')!.append(chatDisplayHelp);
const profileHelp = document.createElement('li');
profileHelp.innerHTML = '<b>종목과 평단, 나만의 반응</b><p>입장할 때 종목·평단 표시를 열어 원하는 종목과 원화·달러 평단을 함께 입력하면 닉네임 위에 표시돼요. 두 칸을 비우면 표시하지 않습니다. 액션 메뉴의 가즈아!·살려주세요!는 앉아서도 사용할 수 있어요. 오른쪽 차트·안내는 접기 버튼으로 최소화할 수 있습니다.</p>';
el('help-dialog').querySelector('.office-rules')!.append(profileHelp);
const jumpHelp=document.createElement('li');
jumpHelp.innerHTML='<b>스낵바 옆 점프 타워</b><p>↟ 점프 타워 버튼을 누르면 스낵바 옆 문으로 걸어갑니다. 문을 지나면 60층 점프 게임장이 열려요. WASD·방향키 또는 모바일 방향 버튼으로 이동하고, Space·점프 버튼을 공중에서 한 번 더 눌러 2단 점프하세요. 가시·회전 막대·밀대에 닿으면 튕겨 나가며 공중 점프로 회복할 수 있어요. 컨베이어·얼음·점멸·붕괴·바람 발판도 기다립니다. 추락하면 10층마다 저장된 재시작 지점으로 돌아갑니다. 각 층 최초 도달 1PT, 정상 최초 도달 추가 300PT로 캐릭터당 최대 360PT를 받아 의상·액세서리 상점에서 사용할 수 있어요. 전광판은 최고 도달 층 상위 3명이며, 동점이면 먼저 도달한 순서입니다.</p>';
el('help-dialog').querySelector('.office-rules')!.append(jumpHelp);
// Keep a connected parking host even if WebGL is unavailable, so the same chart
// can still be moved into the accessible enlarged dialog.
const fallbackHost = document.createElement('div');
fallbackHost.hidden = true; document.body.appendChild(fallbackHost);
const wallHost = scene?.getWallChartHost() ?? fallbackHost;
const rearWallHost = scene?.getWallChartHost('rear') ?? fallbackHost;
function chartHome() {
  // Mobile has two surfaces: a readable flat chart tab and the actual office wall.
  // Parking the board in the hidden flat tab made the office wall permanently empty.
  return compactLayout.matches && !mobileShell?.isOfficeView() ? el('mobile-chart-host') : wallHost;
}
const chart = createMarketBoard({ host: chartHome(), onActiveSlot: slot => market.setActiveSlot(slot) });
mobileShell = createMobileShell({ closeComposer: social.closeComposer, openComposer: social.openComposer, onViewChange: updateChartPlacement, onResetView: returnToCharacter, onGameRoom:()=>gamesButton.click() });
function updateChartPlacement() {
  const enlarged = el<HTMLDialogElement>('chart-dialog').open;
  const home = chartHome();
  if (!enlarged && home === wallHost) chart.moveToWalls(wallHost, rearWallHost);
  else chart.moveTo(enlarged ? el('large-chart-host') : home);
  document.body.classList.toggle('chart-docked', compactLayout.matches && home !== wallHost);
  scene?.setRenderingActive(!gameHub?.isOpen() && !jumpGame?.isOpen() && (!compactLayout.matches || (!!mobileShell?.isOfficeView() && !enlarged)));
  for (const host of [wallHost, rearWallHost]) {
    const placeholder = host.querySelector<HTMLElement>('.office-wall-chart-placeholder');
    if (placeholder) placeholder.textContent = enlarged ? '공유 차트 · 확대해서 보는 중' : 'MARKET SCREEN · 차트 연결 중';
  }
  chart.resize();
  updateMobileMovement();
}
updateChartPlacement();
const market = createMarketUI({ onSelected: updateSelected,
  onCharts(charts) { chart.setMarkets(charts); scene?.setMarketLabel(charts.slice(0, 4).map(m => m.symbol.split(':').slice(1).join(':')).join('  /  ')); scene?.setMarketLabel(charts.slice(4).map(m => m.symbol.split(':').slice(1).join(':')).join('  /  '), 'rear'); },
  onKoreanChartsEnabled: updateKoreanChartHelp });
const support = createSupport(el('office-support-host'));
const headerSupport = createSupport(el('header-support-host'));
const headerSupportButton = el('header-support-host').querySelector('button')!;
headerSupportButton.setAttribute('aria-label', '커피값 후원하기');
headerSupportButton.title = '커피값 후원하기'; headerSupportButton.innerHTML = '<span aria-hidden="true">☕</span><span class="support-label"> 후원</span>';
function applySettings(value: unknown) {
  const settings: OfficeSettings = normalizeOfficeSettings(value);
  chart.setInterval(settings.interval);
  support.setUrl(settings.donationUrl);
  headerSupport.setUrl(settings.donationUrl);
  social.setChatEnabled(settings.chatEnabled); jumpGame?.setChatEnabled(settings.chatEnabled);
  el('office-notice').textContent = settings.notice;
  el('office-notice').hidden = !settings.notice;
  el('chart-policy').textContent = `${settings.interval === 'D' ? '일봉' : `${settings.interval}분봉`} · 종목과 분봉은 관리자만 변경할 수 있어요.`;
}
applySettings(undefined);

function updateKoreanChartHelp(enabled: boolean) {
  const domesticSource = enabled
    ? '국내 주식은 Vunelix가 제공하는 차트를 사무실 안에서 함께 봅니다. 국내 시세는 지연될 수 있어요.'
    : '국내 주식은 Vunelix 연결을 준비 중이며, 연결 상태는 차트에서 확인할 수 있어요.';
  el('help-chart-data').textContent = `코인·미국 주식·ETF는 TradingView 차트입니다. ${domesticSource} 바이낸스 암호화폐 시세는 실시간이며 주식·ETF는 지연되거나 표시가 제한될 수 있어요. 차트의 데이터 안내를 확인하세요.`;
}

function updateSelected(selected: MarketSymbol, slot = 0) {
  document.body.classList.toggle('market-korean', getMarketRegion(selected) === 'KR');
  const category = selected.kind === 'crypto' ? 'CRYPTO' : getMarketAssetType(selected) === 'etf' ? 'US ETF' : getMarketRegion(selected) === 'KR' ? 'KR STOCK' : 'US STOCK';
  el('selected-name').textContent = selected.name;
  el('selected-symbol').textContent = `${slot < 4 ? '정면' : '후면'} ${slot % 4 + 1}번 차트 · ${selected.symbol}`;
  el('selected-kind').textContent = category;
  el('ticker-symbol').textContent = selected.symbol.split(':').slice(1).join(':');
  el('ticker-exchange').textContent = `${selected.exchange} · ${category}`;
  el('selected-data-note').textContent = getMarketRegion(selected) === 'KR' ? 'Vunelix 제공 · 국내 주식 · 시세 지연 가능' : selected.kind === 'crypto' ? 'TradingView 제공 · 암호화폐 실시간 시세' : 'TradingView 제공 · 주식·ETF 시세 지연 가능';
  el('chart-dialog-title').textContent = '함께 보는 시장 · 정면·후면 차트';
  chart.setActiveSlot(slot);
}
market.setState({ selected: DEFAULT_CHARTS[0], charts: DEFAULT_CHARTS, vote: null, lastResult: null, nextProposalAt: 0 });

function toast(message: string) {
  clearTimeout(toastTimer); el('toast').textContent = message; el('toast').hidden = false;
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, 4300);
}
function status(text: string, connected = false) {
  el('connection').replaceChildren(Object.assign(document.createElement('i'), { className: connected ? 'connected' : '' }), document.createTextNode(text));
  if (me) el('identity-status').textContent = connected ? 'MARKET LOUNGE · 접속 중' : '연결 복구 중';
}
function setRoomOpen(open: boolean) {
  roomOpen = open; document.body.classList.toggle('room-closed', !open);
  if (!me && !isConnecting) {
    el('join-message').textContent = open ? '' : '관리자가 사무실을 닫았어요. 다시 열리면 입장할 수 있어요.';
    status(open ? '입장 대기' : '사무실 운영 종료');
  }
}
function roomClosed() { leave(); setRoomOpen(false); toast('관리자가 사무실을 닫았어요. 다시 열리면 입장해 주세요.'); }
function goToMarkets() {
  intentionalClose = true; clearTimeout(reconnectTimer);
  socket?.close(1000, 'room full');
  location.replace('/markets?reason=full');
}
type Admission = { allowed: boolean; code?: string; message?: string };
async function admission(): Promise<Admission> {
  const response = await fetch('/api/admission', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('입장 인원을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return response.json() as Promise<Admission>;
}
function openModal(id: string) {
  social.closeComposer();
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => { if (other.id !== id) other.close(); });
  const dialog = el<HTMLDialogElement>(id);
  if (id === 'chart-dialog') chart.moveTo(el('large-chart-host'));
  if (!dialog.open) dialog.showModal();
  if (id === 'chart-dialog') updateChartPlacement();
}
el<HTMLDialogElement>('chart-dialog').addEventListener('close', updateChartPlacement);
document.querySelectorAll<HTMLButtonElement>('.close-modal').forEach(button => button.onclick = () => button.closest('dialog')?.close());
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
el('ticker-open-chart').onclick = el('open-chart').onclick = () => openModal('chart-dialog');
el('help-button').onclick = () => openModal('help-dialog');
function updateViewLabel() {
  document.body.classList.toggle('chart-view', view === 'chart');
  el('view-button').textContent = '차트 보기';
  el('view-button').setAttribute('aria-label', '대형 차트 정면 보기');
}
el('view-button').onclick = () => { view = 'chart'; scene?.setView('chart'); updateViewLabel(); };
el('reset-view').onclick = () => { scene?.resetView(); view = 'room'; updateViewLabel(); };
el('free-view').onclick = () => { scene?.setView('room'); scene?.setFollow(false); view = 'room'; updateViewLabel(); };
for (const direction of ['up', 'down', 'left', 'right'] as const) el(`pan-${direction}`).onclick = () => scene?.panView(direction);
el('rotate-left').onclick = () => scene?.rotateView(-1);
el('rotate-right').onclick = () => scene?.rotateView(1);
for (const [direction, label] of [['up', '위 보기'], ['down', '아래 보기']] as const) {
  const button = document.createElement('button');
  button.id = `tilt-${direction}`; button.type = 'button'; button.className = 'tool-button view-preset';
  button.textContent = `${direction === 'up' ? '↟' : '↡'} ${label}`;
  button.setAttribute('aria-label', `카메라 ${label}`);
  button.onclick = () => scene?.tiltView(direction);
  el('zoom-out').before(button);
}
el('zoom-in').onclick = () => scene?.zoomView(1);
el('zoom-out').onclick = () => scene?.zoomView(-1);

function updatePlayers() {
  playersById = new Map(players.map(player => [player.id, player]));
  const officePlayers=players.filter(player=>player.area!=='games'&&player.area!=='jump');
  scene?.setPlayers(officePlayers); social.setPlayers(officePlayers);
  whispers.setPlayers(players); gameHub?.setPlayers(players);
  const self = me ? playersById.get(me.id) : undefined;
  const held = self?.refreshments ?? null;
  refreshments.setCurrent(held);
  avatarActions.setRefreshments(held); avatarActions.setSeated(self?.seat != null);
  avatarActions.setJumpAction(self?.action ?? null, Date.now() + serverOffset);
  avatarActions.setShoulderState(self?.shoulder ?? null);
  refreshmentsButton.textContent = held ? '☕ 쟁반 반납' : '☕ 스낵바';
  refreshmentsButton.setAttribute('aria-label', held ? '스낵바로 이동해서 쟁반 반납' : '스낵바로 이동해서 음료나 간식 가져가기');
  el('population').textContent = me ? `${players.length} / 50명` : '정원 50명';
  const list = el('classmates'); list.replaceChildren();
  for (const player of players) {
    const badge = document.createElement('button'); badge.type='button'; badge.className = 'classmate';
    badge.title=player.id===me?.id?'내 캐릭터 꾸미기':`${player.nickname}님에게 귓속말`;
    badge.onclick=()=>{if(player.id===me?.id)void studio.open();else whispers.open(player.id);};
    const dot = document.createElement('i'); dot.style.backgroundColor = `#${player.color.toString(16).padStart(6, '0')}`;
    badge.append(dot, document.createTextNode(player.nickname + (player.id === me?.id ? ' · 나' : '')+(player.area==='games'?' · 게임룸':player.area==='jump'?' · 점프 타워':''))); list.append(badge);
  }
  if (!players.length) list.append(Object.assign(document.createElement('small'), { textContent: '첫 번째 자리가 비어 있어요.' }));
}
setInterval(() => { social.tick(); refreshments.tick(); avatarActions.tick(); }, 200);
function scheduleReconnect() {
  if (intentionalClose || !me) return;
  clearTimeout(reconnectTimer);
  if (retryCount < 5) {
    status('연결 복구 중…');
    const delay = Math.min(10000, 1000 * 2 ** retryCount++);
    reconnectTimer = setTimeout(() => { void connect(activeNickname, true); }, delay);
  } else {
    leave(); el('join-message').textContent = '연결이 끊겼어요. 다시 입장해 주세요.';
  }
}
async function connect(nickname: string, reconnecting = false) {
  if (isConnecting) return;
  const generation = ++connectionGeneration;
  clearTimeout(reconnectTimer); isConnecting = true; intentionalClose = false; activeNickname = nickname;
  const joinButton = el<HTMLButtonElement>('join-button'); joinButton.disabled = true;
  el('join-message').textContent = reconnecting ? '사무실에 다시 연결하고 있어요…' : '사무실 문을 여는 중…'; status('사무실에 연결 중');
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (generation !== connectionGeneration) return;
    if (!response.ok) throw new Error('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    const session = await response.json();
    if (generation !== connectionGeneration) return;
    if (session.roomOpen === false) { roomClosed(); return; }
    setRoomOpen(true);
    const joinParams = new URLSearchParams({ nickname });
    appendStockProfileParams(joinParams, activeStockProfile);
    const checkResponse = await fetch(`/api/join-check?${joinParams}`, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (generation !== connectionGeneration) return;
    const check = await checkResponse.json();
    if (generation !== connectionGeneration) return;
    if (check.code === 'ROOM_FULL') { goToMarkets(); return; }
    if (check.code === 'ROOM_CLOSED') { roomClosed(); return; }
    if (['BLOCKED', 'NICKNAME_TAKEN', 'NICKNAME'].includes(check.code)) { leave(); el('join-message').textContent = check.message || '지금은 입장할 수 없어요.'; return; }
    if (!checkResponse.ok || !check.ok) throw new Error(check.message || '사무실에 입장할 수 없어요.');
    const available = await admission();
    if (generation !== connectionGeneration) return;
    if (available.code === 'ROOM_FULL') { goToMarkets(); return; }
    if (available.code === 'ROOM_CLOSED') { roomClosed(); return; }
    if (available.code === 'BLOCKED') { leave(); el('join-message').textContent = available.message || '관리자가 입장을 일시 제한했어요.'; return; }
    if (!available.allowed) throw new Error(available.message || '지금은 입장할 수 없어요.');
    const url = new URL('/api/room', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('nickname', nickname); url.searchParams.set('positions', 'delta');
    appendStockProfileParams(url.searchParams, activeStockProfile);
    if (reconnecting) url.searchParams.set('resume', '1');
    const currentSocket = new WebSocket(url); socket = currentSocket;
    const connectTimeout = setTimeout(() => { if (generation === connectionGeneration && socket === currentSocket && isConnecting) currentSocket.close(); }, 12000);
    currentSocket.onmessage = event => {
      if (generation !== connectionGeneration || socket !== currentSocket) return;
      let data;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (typeof data.serverTime === 'number') { serverOffset = data.serverTime - Date.now(); scene?.setServerTime(data.serverTime); }
      if (data.type === 'welcome') {
        market.setKoreanChartsEnabled(data.koreanChartsEnabled === true);
        applySettings(data.settings);
        clearTimeout(connectTimeout); isConnecting = false; retryCount = 0;
        me = data.me as Me; players = data.players; roomOpen = true;
        document.body.classList.remove('room-closed'); document.body.classList.add('joined');
        social.setSession(me.id, true); scene?.setSelfId(me.id);
        whispers.setSession(me.id,true);gameHub?.setSession(me);gameHub?.setConnected(true);jumpGame?.setSession(me);jumpGame?.setConnected(true);
        if(data.avatarProfile)applyAvatarProfile(data.avatarProfile);
        refreshments.setSession(true);
        el('admission').hidden = true; el('leave-button').hidden = false; el('join-message').textContent = '';
        el('identity-name').textContent = me.nickname;
        try { localStorage.setItem('podeumgo.nickname', nickname); } catch { /* Optional preference. */ }
        activeStockProfile = me.stockProfile ?? null;
        stockProfileFields.save(activeStockProfile);
        updatePlayers();
        const ownPosition = players.find(player => player.id === me?.id);
        if (ownPosition) scene?.correctPosition(ownPosition.x, ownPosition.z);
        if (!reconnecting) scene?.resetView();
        if (document.activeElement === nicknameInput) nicknameInput.blur();
        mobileShell?.setSession(true);
        if (data.market) market.setState(data.market as MarketState);
        if (Array.isArray(data.chats)) data.chats.forEach((chat: ChatMessage) => social.receiveChat(chat, undefined, true));
        status('사무실 연결됨', true);
        toast(reconnecting ? '다시 연결됐어요.' : `${me.nickname}님, 포듬증권에 오신 것을 환영해요.`);
      } else if (data.type === 'game-state') { if(Number.isFinite(data.state?.serverTime))serverOffset=data.state.serverTime-Date.now(); gameHub?.receive(data); updateMobileMovement(); }
      else if(data.type==='jump-state'){jumpGame?.receive(data);if(Array.isArray(data.state?.leaderboard))setJumpLeaderboard(data.state.leaderboard);updateMobileMovement();}
      else if(['jump-presence','jump-positions','jump-chat','jump-chat-history','jump-chat-clear'].includes(data.type)){jumpGame?.receive(data);}
      else if(data.type==='jump-leaderboard'){if(Array.isArray(data.leaders))setJumpLeaderboard(data.leaders);}
      else if (data.type === 'avatar-profile') { if(data.profile)applyAvatarProfile(data.profile); }
      else if (data.type === 'whisper') whispers.receive(data.message,data.requestId);
      else if (data.type === 'avatar-action') {
        if (typeof data.playerId === 'string' && (data.action === null || isAvatarActionView(data.action))) {
          const mine = data.playerId === me?.id;
          const predictedJump = mine && avatarActions.receiveJump(data.requestId, data.action, Date.now() + serverOffset);
          const player = playersById.get(data.playerId);
          // Self jump acknowledgements only confirm the predicted input. Applying
          // them again could rewind a boost, or replay a late/retired request.
          if (player && !predictedJump) { player.action = data.action; scene?.updatePlayerAction(player.id, data.action); }
          if (mine && data.action && !predictedJump) avatarActions.receive(data.requestId, data.action.startedAt, data.action.kind);
        }
      } else if (data.type === 'chat') { stickers.receive(data.requestId);social.receiveChat(data.message, data.requestId); }
      else if (data.type === 'action-notice') social.receiveActionNotice(data.notice);
      else if (data.type === 'settings') applySettings(data.settings);
      else if (data.type === 'chat-clear') { social.clearChats(); scene?.clearChats(); }
      else if (data.type === 'community-changed') popular.invalidate();
      else if (data.type === 'kicked') { leave(); el('join-message').textContent = data.message || '관리자가 퇴장시켰어요.'; toast(el('join-message').textContent!); }
      else if (data.type === 'room-closed') roomClosed();
      else if (data.type === 'position-correction') { if (data.reason === 'shoulder-link') scene?.pauseMovement(); scene?.correctPosition(data.x, data.z); }
      else if (data.type === 'seat-state') social.seatState(data.requestId);
      else if (data.type === 'refreshments-state') { refreshments.receive(data.requestId, data.refreshments); if (data.refreshments === null) avatarActions.receivePutAway(data.requestId); }
      else if (data.type === 'shoulder-state') avatarActions.receiveShoulder(data.requestId, data.shoulder ?? null);
      else if (data.type === 'shoulder-cheer-state' && (data.shoulder === null || isShoulderLinkView(data.shoulder))) {
        avatarActions.receiveShoulderCheer(data.requestId, data.shoulder, Number.isFinite(data.serverTime) ? data.serverTime : Date.now() + serverOffset);
      }
      else if (data.type === 'players') { players = data.players; updatePlayers(); }
      else if (data.type === 'player-moved') {
        const moved = data.player;
        if (moved && typeof moved.id === 'string' && Number.isFinite(moved.x) && Number.isFinite(moved.z)) {
          const player = playersById.get(moved.id);
          if (player) { player.x = moved.x; player.z = moved.z; if (moved.action === null) player.action = null; scene?.updatePlayerMovement(moved); }
        }
      }
      else if (data.type === 'market') market.setState(data.state);
      else if (data.type === 'error') {
        if (data.code === 'ROOM_CLOSED') { roomClosed(); return; }
        if (data.code === 'ROOM_FULL') { goToMarkets(); return; }
        const message = data.message || '잠시 후 다시 시도해 주세요.';
        if(jumpGame?.receive(data))return;
        if(gameHub?.receive(data))return;
        if(whispers.error(data.requestId,message))return;
        if(stickers.error(data.requestId,message))return;
        if (avatarActions.error(data.requestId, message, data.retryAt)) return;
        if (refreshments.error(data.requestId, message, data.retryAt)) return;
        if (social.error(data.requestId, message, data.retryAt)) return;
        if (['SESSION_REPLACED', 'BLOCKED', 'NICKNAME_TAKEN', 'NICKNAME'].includes(data.code)) {
          leave(); el('join-message').textContent = message; toast(message); return;
        }
        el('join-message').textContent = message; toast(message);
        if (!me) intentionalClose = true;
      }
    };
    currentSocket.onclose = async event => {
      clearTimeout(connectTimeout);
      if (generation !== connectionGeneration || socket !== currentSocket) return;
      socket = null; isConnecting = false; joinButton.disabled = false;
      scene?.stopMovement();
      social.setSession(me?.id ?? null, false);
      whispers.setSession(me?.id??null,false);gameHub?.setConnected(false);jumpGame?.setConnected(false);stickers.setConnected(false);
      refreshments.setSession(false);
      avatarActions.setActive(false);
      avatarActions.disconnect();
      if (me) mobileShell?.setSession(true, false);
      status('사무실 연결 끊김');
      if (event.code === 4003) { roomClosed(); return; }
      if (event.code === 4004 || event.code === 4005) { leave(); el('join-message').textContent = event.code === 4005 ? '관리자가 입장을 일시 제한했어요.' : '관리자가 퇴장시켰어요.'; return; }
      if (intentionalClose) return;
      // Upgrade failures do not expose their HTTP body to WebSocket clients.
      // Recheck identity-aware capacity to resolve simultaneous last-seat races.
      if (event.code === 1006) {
        try {
          const available = await admission();
          if (generation !== connectionGeneration) return;
          if (available.code === 'ROOM_FULL') { goToMarkets(); return; }
          if (available.code === 'ROOM_CLOSED') { roomClosed(); return; }
          if (!available.allowed) { leave(); el('join-message').textContent = available.message || '지금은 입장할 수 없어요.'; return; }
        } catch { /* Retain reconnect controls when the status service is unreachable. */ }
      }
      if (generation !== connectionGeneration) return;
      if (!me) { el('join-message').textContent = event.reason || '입장하지 못했어요. 만석이거나 사용 중인 이름일 수 있어요. 다시 시도해 주세요.'; return; }
      if (event.code === 4001 || event.code === 4000) { leave(); toast('다른 창에서 같은 계정으로 접속했어요.'); return; }
      scheduleReconnect();
    };
    currentSocket.onerror = () => { if (generation === connectionGeneration && socket === currentSocket) el('join-message').textContent = '서버 연결을 확인해 주세요. 사무실이 가득 찼거나 닉네임이 사용 중일 수 있어요.'; };
  } catch (error) {
    if (generation !== connectionGeneration) return;
    isConnecting = false; joinButton.disabled = false;
    el('join-message').textContent = error instanceof Error ? error.message : '서버에 연결할 수 없어요.';
    status('서버 연결 대기');
    if (reconnecting && me) scheduleReconnect();
  }
}
el<HTMLFormElement>('join-form').onsubmit = event => {
  event.preventDefault(); const nickname = nicknameInput.value.trim();
  if (Array.from(nickname).length < 2 || Array.from(nickname).length > 12) { el('join-message').textContent = '닉네임은 2~12자로 지어 주세요.'; return; }
  try { activeStockProfile = stockProfileFields.read(); }
  catch (error) { el('join-message').textContent = error instanceof Error ? error.message : '종목과 평단을 확인해 주세요.'; return; }
  void connect(nickname);
};
function leave() {
  connectionGeneration++; intentionalClose = true; clearTimeout(reconnectTimer);
  socket?.close(1000, 'leave'); socket = null; isConnecting = false; retryCount = 0;
  me = null; players = []; social.reset(); mobileShell?.setSession(false);
  whispers.setSession(null,false);gameHub?.setSession(null);jumpGame?.setSession(null);gameHub?.setConnected(false);jumpGame?.setConnected(false);stickers.setConnected(false);
  refreshments.reset();
  avatarActions.reset();
  scene?.setSelfId(null); updatePlayers();
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  el('admission').hidden = false; el('leave-button').hidden = true; el<HTMLButtonElement>('join-button').disabled = false;
  el('join-message').textContent = ''; el('identity-name').textContent = '방문자'; el('identity-status').textContent = '무료 입장 · 닉네임으로 시작';
  el('market-panel').classList.remove('mobile-open'); el('mobile-market').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('joined', 'market-open'); status('입장 대기');
  if (!roomOpen) setRoomOpen(false);
}
el('leave-button').onclick = leave;
// One public read initializes the shared screen without polling an empty room.
const statusGeneration = connectionGeneration;
void fetch('/api/status', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
  .then(async response => {
    if (!response.ok) return;
    const state = await response.json();
    if (typeof state.serverTime === 'number') scene?.setServerTime(state.serverTime);
    if (statusGeneration !== connectionGeneration || me || isConnecting) return;
    market.setKoreanChartsEnabled(state.koreanChartsEnabled === true);
    applySettings(state.settings);
    if (typeof state.roomOpen === 'boolean') setRoomOpen(state.roomOpen);
    if (state.market?.selected) market.setState({ selected: state.market.selected, charts: state.market.charts, vote: null, lastResult: null, nextProposalAt: 0 });
    if (state.roomOpen && state.onlineCount >= state.capacity) {
      const available = await admission();
      if (statusGeneration === connectionGeneration && !me && !isConnecting && available.code === 'ROOM_FULL') goToMarkets();
    }
  }).catch(() => { /* Joining provides a useful connection error if needed. */ });
