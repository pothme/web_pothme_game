import { GAME_CATALOG, gameDefinition, type GameKind, type GameRoomView, type GameSnapshot, type GameProfile } from '../shared/game-room';
import { SHOP_ITEMS, defaultAvatarProfile, type AvatarProfile, type ShopItem } from '../shared/avatar-catalog';
import { APPEARANCE_OPTIONS, type AvatarAppearance, type AppearanceKey } from '../shared/avatar-appearance';
import { createGameRoomScene } from './game-room-scene';
import { gameChoiceSubmission, reconcileGameChoiceDraft, type GameChoiceDraft } from './game-choice-state';
import './game-hub-ui.css';

type Session = { id: string; nickname: string };
type Person = Session & { appearance?: AvatarAppearance; color?: number };
type Tab = 'rooms' | 'shop' | 'inventory';
type Options = {
  send: (input: Record<string, unknown>) => boolean;
  now: () => number;
  onOpen?: () => void;
  onExit: () => void;
  onAppearance: (selection?: {key:AppearanceKey;value:string}) => void;
  onWhisper: (targetId: string) => void;
  onNotify: (message: string) => void;
  onProfile?: (profile: AvatarProfile) => void;
};
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const points = (value: number) => Math.max(0, Math.trunc(value)).toLocaleString('ko-KR');
const phaseText = { waiting: '입장 가능', playing: '진행 중', reveal: '라운드 결과', finished: '경기 종료' };
const speciesIcon: Record<string, string> = { human: '●', cat: '🐱', rabbit: '🐰', fox: '🦊', bear: '🐻', bee: '🐝', butterfly: '🦋' };

/** A single full-screen game space sharing the office session and authoritative socket. */
export function createGameHubUI(options: Options) {
  const root = document.createElement('section'); root.id = 'game-hub'; root.className = 'gh'; root.hidden = true;
  root.setAttribute('aria-label', '포듬 게임룸');
  root.innerHTML = `<header class="gh-header"><div class="gh-brand"><span aria-hidden="true">ㅍ</span><div><small>PODEUM GAME ROOM</small><strong>포듬 게임룸</strong></div></div><div class="gh-header-actions"><span class="gh-wallet" aria-label="보유 게임 포인트"><i>✦</i><b data-wallet>0</b><small>PT</small></span><button type="button" class="gh-mail" data-command="whisper-inbox" title="귓속말" aria-label="귓속말 열기">✉<b data-whisper-count hidden></b></button><button type="button" class="gh-office" data-command="exit">사무실로 ↗</button></div></header><div class="gh-connection" role="status" hidden></div><nav class="gh-tabs" aria-label="게임룸 메뉴"><button type="button" data-tab="rooms" aria-current="page">게임룸</button><button type="button" data-tab="shop">포인트 상점</button><button type="button" data-tab="inventory">내 보관함</button><span>PLAY · THINK · CONNECT</span></nav><div class="gh-scroll"><div class="gh-content"></div></div><div class="gh-status" role="status" aria-live="polite" hidden></div>`;
  document.body.append(root);
  const leaveDialog = document.createElement('dialog'); leaveDialog.className = 'gh-exit-dialog';
  leaveDialog.setAttribute('aria-labelledby', 'gh-exit-title'); leaveDialog.setAttribute('aria-describedby', 'gh-exit-description');
  leaveDialog.innerHTML = '<h2 id="gh-exit-title">게임에서 나갈까요?</h2><p id="gh-exit-description">진행 중인 경기에서 나가면 이번 경기의 포인트를 받을 수 없어요.</p><div><button type="button" data-leave-stay autofocus>계속 플레이</button><button type="button" data-leave-confirm>나가기</button></div>';
  document.body.append(leaveDialog);
  const content = root.querySelector<HTMLDivElement>('.gh-content')!;
  const scroll = root.querySelector<HTMLDivElement>('.gh-scroll')!;
  const status = root.querySelector<HTMLDivElement>('.gh-status')!;
  const connection = root.querySelector<HTMLDivElement>('.gh-connection')!;
  const sceneShell = document.createElement('div'); sceneShell.className = 'gh-scene';
  const sceneHost = document.createElement('div'); sceneHost.className = 'gh-scene-canvas';
  const sceneCaption = document.createElement('span'); sceneCaption.className = 'gh-scene-caption'; sceneCaption.textContent = '같은 테이블, 서로 다른 선택';
  sceneShell.append(sceneHost, sceneCaption);
  let tableScene: ReturnType<typeof createGameRoomScene> | null = null, sceneUnavailable = false;
  let session: Session | null = null, people: Person[] = [], opened = false, connected = false, disposed = false;
  let tab: Tab = 'rooms', shopCategory = 'all', shopQuery = '', shopOwnership = 'all';
  let state: GameSnapshot | null = null;
  let profile: AvatarProfile = defaultAvatarProfile();
  let draft: GameChoiceDraft & { chat: string } = { key: '', bid: 0, vault: 'invest', cipher: [1, 2, 3], chat: '' };
  const pending = new Map<string, { type: string; at: number }>();
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let previousFocus: HTMLElement | null = null;
  let leaveAction: 'game-exit' | 'game-leave' | null = null, leaveContext = '';
  let leaveReturnFocus: HTMLElement | null = null;
  let renderedView = '';
  let storeThumbnailCleanup:(()=>void)|undefined,storeThumbnailGeneration=0;
  function stopStoreThumbnails(){++storeThumbnailGeneration;storeThumbnailCleanup?.();storeThumbnailCleanup=undefined;}
  function startStoreThumbnails(){
    if(disposed||!opened||tab==='rooms'||!content.querySelector('img[data-avatar-slot]'))return;
    const current=++storeThumbnailGeneration;
    void import('./avatar-thumbnails').then(({mountAvatarThumbnails})=>{
      if(disposed||!opened||tab==='rooms'||current!==storeThumbnailGeneration)return;
      storeThumbnailCleanup=mountAvatarThumbnails(content);
    }).catch(()=>{if(current===storeThumbnailGeneration)content.querySelectorAll<HTMLImageElement>('img[data-avatar-slot]').forEach(image=>image.dataset.thumbnailState='error');});
  }

  leaveDialog.querySelector<HTMLButtonElement>('[data-leave-stay]')!.onclick = () => leaveDialog.close();
  leaveDialog.querySelector<HTMLButtonElement>('[data-leave-confirm]')!.onclick = () => {
    const action = leaveAction;
    const currentContext = state?.room ? `${state.room.id}:${state.room.matchId}` : '';
    const stillSameGame = currentContext === leaveContext;
    leaveDialog.close(); leaveAction = null;
    if (!action) return;
    if (!stillSameGame) { notify('게임 상태가 바뀌었어요. 현재 테이블에서 다시 선택해 주세요.'); return; }
    command(action);
  };
  leaveDialog.addEventListener('cancel', event => { event.preventDefault(); leaveDialog.close(); });
  leaveDialog.addEventListener('close', () => {
    leaveAction = null;
    if (!opened || disposed) return;
    const target = leaveReturnFocus?.isConnected ? leaveReturnFocus : root.querySelector<HTMLButtonElement>('.gh-office');
    target?.focus({ preventScroll: true });
  });

  function notify(message: string) {
    status.textContent = message; status.hidden = false;
    clearTimeout(statusTimer); statusTimer = setTimeout(() => { status.hidden = true; }, 4500);
    options.onNotify(message);
  }
  function isBusy() { return [...pending.values()].some(value => value.type !== 'game-chat'); }
  function canAct() { return !!session && connected && !isBusy(); }
  function command(type: string, data: Record<string, unknown> = {}) {
    if (!session || !connected) { notify('사무실 연결을 확인해 주세요.'); return false; }
    const requestId = crypto.randomUUID();
    if (!options.send({ type, ...data, requestId })) { notify('서버에 연결되지 않았어요. 다시 연결한 뒤 시도해 주세요.'); return false; }
    pending.set(requestId, { type, at: Date.now() }); render(); return true;
  }
  function setOpen(value: boolean) {
    if (opened === value) return;
    opened = value; root.hidden = !value; document.body.classList.toggle('game-hub-open', value);
    if (value) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
      options.onOpen?.(); render(); root.querySelector<HTMLButtonElement>('.gh-office')!.focus({ preventScroll: true });
    } else {
      stopStoreThumbnails();
      if (leaveDialog.open) leaveDialog.close();
      tableScene?.setActive(false); options.onExit();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
  }
  function requestDeparture(action: 'game-exit' | 'game-leave') {
    if ([...pending.values()].some(value => value.type === 'game-exit' || value.type === 'game-leave')) return;
    const playing = state?.room && ['playing', 'reveal'].includes(state.room.phase);
    if (!playing) { command(action); return; }
    leaveAction = action; leaveContext = `${state!.room!.id}:${state!.room!.matchId}`;
    leaveReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leaveDialog.querySelector('h2')!.textContent = action === 'game-exit' ? '사무실로 돌아갈까요?' : '테이블에서 나갈까요?';
    leaveDialog.querySelector<HTMLButtonElement>('[data-leave-confirm]')!.textContent = action === 'game-exit' ? '사무실로 돌아가기' : '테이블 나가기';
    if (!leaveDialog.open) leaveDialog.showModal();
    leaveDialog.querySelector<HTMLButtonElement>('[data-leave-stay]')!.focus({ preventScroll: true });
  }
  function badge(label: string, extra = '') { return `<span class="gh-badge ${extra}">${escape(label)}</span>`; }
  function control(label: string, action: string, extra = '', disabled = !canAct(), className = '') {
    return `<button type="button" class="gh-button ${className}" data-command="${action}" ${extra} ${disabled ? 'disabled' : ''}>${label}</button>`;
  }
  function renderLobby() {
    const rooms = state?.rooms ?? [];
    return `<section class="gh-intro"><div><span class="gh-kicker">THE LOUNGE OF CHOICES</span><h1>선택이 쌓이면,<br><em>나만의 스타일이 됩니다.</em></h1><p>숨겨진 입찰, 팀의 약속, 작은 단서.<br>같은 테이블에 앉아 서로의 다음 수를 읽어 보세요.</p></div><div class="gh-season-card"><small>나의 플레이 기록</small><strong>${points(profile.matches)}<span>경기</span></strong><div><span>누적 획득</span><b>${points(profile.earned)} PT</b></div><p>게임으로 얻은 포인트는<br>의상 · 이모티콘 · 액션으로 교환해요.</p></div></section><div class="gh-section-title"><h2>오늘의 세 가지 게임</h2><span>개인전 · 팀전 · 추리전</span></div><div class="gh-games">${GAME_CATALOG.map((game, index) => `<article class="gh-game gh-game-${index + 1}"><div class="gh-game-art"><span class="gh-game-number">0${index + 1}</span><span class="gh-game-symbol" aria-hidden="true">${game.icon}</span><small>${['SECRET AUCTION', 'TEAM VAULT', 'SIGNAL CODE'][index]}</small></div><div class="gh-game-copy"><div class="gh-game-meta">${badge(`${game.minPlayers}–${game.maxPlayers}명`)}${badge(`${game.rounds}라운드`)}</div><h3>${game.name}</h3><p class="gh-game-tagline">${game.subtitle}</p><p>${game.description}</p><details><summary>게임 규칙 보기</summary><ol>${game.rules.map(rule => `<li>${rule}</li>`).join('')}</ol></details><div class="gh-game-buttons">${control('방 만들기', 'create', `data-kind="${game.id}"`, !canAct(), 'gh-primary')}${control('혼자 연습', 'practice', `data-kind="${game.id}"`, !canAct(), 'gh-quiet')}</div></div></article>`).join('')}</div><section class="gh-live-rooms"><div class="gh-section-title"><h2>열려 있는 테이블 <span>${rooms.length}</span></h2>${control('새로고침 ↻', 'sync', '', !connected, 'gh-quiet')}</div>${rooms.length ? `<div class="gh-room-list">${rooms.map(room => `<article class="gh-room-row"><div class="gh-room-kind" aria-hidden="true">${gameDefinition(room.kind).icon}</div><div class="gh-room-copy"><strong>${escape(room.name)}</strong><small>${gameDefinition(room.kind).name} · ${room.count}/${room.maxPlayers}명 ${room.practice ? '· 연습' : ''}</small></div>${badge(phaseText[room.phase], room.phase === 'waiting' ? 'gh-live' : '')}${control('입장', 'join', `data-room="${escape(room.id)}"`, !canAct() || room.phase !== 'waiting' || room.count >= room.maxPlayers || room.practice, 'gh-primary')}</article>`).join('')}</div>` : `<div class="gh-empty"><span aria-hidden="true">◈</span><strong>첫 테이블을 열어 보세요.</strong><p>친구와 함께 방에 입장하거나, 연습봇과 규칙을 익힐 수 있어요.</p></div>`}</section><div class="gh-footnote"><span>✦ 포인트는 게임 안에서만 사용됩니다.</span><span>연습 경기에서는 포인트를 받지 않아요.</span></div>`;
  }
  function playerIcon(player: { appearance?: AvatarAppearance; nickname: string }) {
    const species = player.appearance?.species ?? 'human';
    return `<span class="gh-person-icon gh-species-${species}" aria-hidden="true">${species === 'human' ? escape([...player.nickname][0] ?? '●') : speciesIcon[species] ?? '●'}</span>`;
  }
  function playerList(room: GameRoomView) {
    return `<section class="gh-players-panel"><div class="gh-section-title"><h2>함께 앉은 사람들</h2><span>${room.players.length}/${room.maxPlayers}</span></div><ul class="gh-players">${room.players.map(player => `<li class="${player.id === session?.id ? 'gh-me' : ''}">${playerIcon(player)}<div><strong>${escape(player.nickname)}${player.id === session?.id ? ' <small>나</small>' : ''}</strong><span>${player.bot ? '연습봇' : !player.connected ? '연결 대기' : player.forfeited ? '중도 퇴장' : room.phase === 'waiting' ? player.ready ? '준비 완료' : '준비 중' : player.solved ? '암호 해독 완료' : player.submitted ? '선택 완료' : '생각 중'}${player.team ? ` · ${player.team}팀` : ''}</span></div><b>${player.score}<small>점</small></b>${player.id !== session?.id && !player.bot && player.connected ? `<button type="button" class="gh-whisper" data-command="whisper" data-player="${escape(player.id)}" aria-label="${escape(player.nickname)}에게 귓속말">귓속말</button>` : ''}</li>`).join('')}</ul></section>`;
  }
  function ruleDetails(room: GameRoomView) {
    const game = gameDefinition(room.kind);
    return `<details class="gh-rules"><summary>게임 규칙 · 포인트 안내</summary><ol>${game.rules.map(rule => `<li>${rule}</li>`).join('')}</ol><p>경기 안의 점수와 상점 포인트(PT)는 달라요. 경기가 끝나면 결과표에서 실제 획득 PT를 확인할 수 있습니다. 연습 경기는 PT를 지급하지 않습니다.</p></details>`;
  }
  function roundHistory(room: GameRoomView) {
    const rows = room.history.slice().reverse();
    return `<details class="gh-history" ${room.phase === 'finished' ? 'open' : ''}><summary>지난 라운드 <span>${rows.length}</span></summary>${rows.length ? rows.map(row => `<article><small>ROUND ${row.round}</small><h4>${escape(row.title)}</h4>${row.lines.map(line => `<p>${escape(line)}</p>`).join('')}${row.myHint ? `<div class="gh-hint-row"><b>${row.myHint.guess.join(' · ')}</b><span>자리까지 ${row.myHint.exact} · 숫자만 ${row.myHint.misplaced}</span></div>` : ''}</article>`).join('') : '<p>라운드가 끝나면 결과가 쌓여요.</p>'}</details>`;
  }
  function roomChat(room: GameRoomView) {
    const chats = room.chats ?? [];
    const emotes = SHOP_ITEMS.filter(item => item.category === 'emoji' && profile.owned.includes(item.id));
    return `<section class="gh-chat"><div class="gh-section-title"><h2>테이블 대화</h2><span>같은 방에만 보여요</span></div><div class="gh-chat-lines" role="log" aria-label="게임방 대화">${chats.length ? chats.slice(-10).map(chat => `<p><strong>${escape(chat.nickname)}</strong><span>${escape(chat.text)}</span></p>`).join('') : '<p class="gh-chat-empty">함께 인사하고 작전을 이야기해 보세요.</p>'}</div><form class="gh-chat-form"><label class="gh-sr-only" for="game-chat-input">게임방에 보낼 메시지</label><input id="game-chat-input" data-field="chat" maxlength="80" autocomplete="off" value="${escape(draft.chat)}" placeholder="테이블 대화 · 80자" ${!connected ? 'disabled' : ''}><button type="submit" ${!connected ? 'disabled' : ''}>전송</button></form>${emotes.length ? `<div class="gh-chat-emotes" aria-label="내 채팅 이모티콘">${emotes.map(item => `<button type="button" data-command="chat-emote" data-item="${item.id}" title="${escape(item.name)} 보내기" aria-label="${escape(item.name)} 보내기" ${!connected ? 'disabled' : ''}>${item.icon}</button>`).join('')}</div>` : ''}<p class="gh-private-note">비공개 대화는 참가자 옆 ‘귓속말’을 이용하세요.</p></section>`;
  }
  function renderWaiting(room: GameRoomView) {
    const game = gameDefinition(room.kind), own = room.players.find(player => player.id === session?.id);
    const allReady = room.players.every(player => player.ready && player.connected);
    const canStart = room.players.length >= game.minPlayers && allReady;
    return `<div class="gh-waiting"><span class="gh-kicker">TAKE YOUR SEAT</span><h2>서로 준비되면 시작해요.</h2><p>${room.practice ? '연습봇과 규칙을 익히는 방입니다. 실제 사람과의 대전이 아니며 포인트는 지급되지 않습니다.' : `${game.minPlayers}명 이상 모여 모두 준비를 마치면 방장이 시작할 수 있어요.`}</p><div class="gh-ready-buttons">${control(own?.ready ? '준비 취소' : '준비 완료 ✓', 'ready', `data-ready="${!own?.ready}"`, !canAct(), own?.ready ? 'gh-quiet' : 'gh-primary')}${room.hostId === session?.id ? control('게임 시작 →', 'start', '', !canAct() || !canStart, 'gh-primary') : '<span>방장이 게임을 시작합니다.</span>'}</div>${room.hostId === session?.id && !canStart ? `<small>${room.players.length < game.minPlayers ? `${game.minPlayers - room.players.length}명이 더 필요해요.` : '모든 참가자의 준비를 기다리고 있어요.'}</small>` : ''}</div>`;
  }
  function renderChoice(room: GameRoomView) {
    const own = room.players.find(player => player.id === session?.id), submitted = room.myChoice !== null || !!own?.submitted;
    const disabled = !canAct() || room.phase !== 'playing' || submitted || !!own?.solved || !!own?.forfeited;
    draft = { ...reconcileGameChoiceDraft(room, draft, session?.id), chat: draft.chat };
    const choiceLabel = submitted ? '선택을 제출했어요. 모두의 선택을 기다립니다.' : own?.solved ? '암호를 풀었어요! 남은 참가자의 추리를 지켜보세요.' : '내 선택은 라운드가 끝날 때까지 비공개예요.';
    let body = '';
    if (room.kind === 'blind-auction') {
      const chips = own?.chips ?? 0, maxBid = Math.min(6, chips);
      body = `<div class="gh-auction-prize"><span class="gh-prize-stone" aria-hidden="true">◆</span><div><small>이번 보석</small><strong>${room.prize ?? 0}<span>점</span></strong></div><div class="gh-chip-bank"><small>남은 칩</small><strong>${chips}<span>개</span></strong></div></div><fieldset class="gh-bid-field" ${disabled ? 'disabled' : ''}><legend>얼마를 입찰할까요?</legend><div class="gh-bid-options">${Array.from({ length: 7 }, (_, value) => `<button type="button" data-bid="${value}" aria-pressed="${draft.bid === value}" ${value > maxBid ? 'disabled' : ''}>${value === 0 ? '패스' : value}<small>${value === 0 ? '0칩' : '칩'}</small></button>`).join('')}</div></fieldset>${control(submitted ? '입찰 제출 완료 ✓' : draft.bid === 0 ? '이번 라운드 패스' : `${draft.bid}칩 비공개 입찰`, 'choice', '', disabled, 'gh-primary gh-submit-choice')}<p class="gh-choice-help">입찰한 칩은 돌려받지 못해요. 가장 높은 금액이 겹치면 보석은 누구에게도 지급되지 않습니다.</p>`;
    } else if (room.kind === 'vault-dilemma') {
      body = `<div class="gh-vaults"><div class="${own?.team === 'A' ? 'gh-own-team' : ''}"><small>A팀 금고 ${own?.team === 'A' ? '· 우리 팀' : ''}</small><strong>${room.vaults.A}</strong></div><span>VS</span><div class="${own?.team === 'B' ? 'gh-own-team' : ''}"><small>B팀 금고 ${own?.team === 'B' ? '· 우리 팀' : ''}</small><strong>${room.vaults.B}</strong></div></div><fieldset class="gh-vault-options" ${disabled ? 'disabled' : ''}><legend>팀과 나의 몫, 무엇을 선택할까요?</legend>${[['invest','✦','투자','팀 금고 +3'],['guard','◉','감시','팀 금고 +1 · 배신 한 명 차단'],['steal','↗','빼돌리기','성공하면 개인 +4 · 팀 금고 −2']].map(([value, symbol, title, hint]) => `<button type="button" data-vault="${value}" aria-pressed="${draft.vault === value}"><span aria-hidden="true">${symbol}</span><strong>${title}</strong><small>${hint}</small></button>`).join('')}</fieldset>${control(submitted ? '선택 제출 완료 ✓' : `${({ invest:'투자',guard:'감시',steal:'빼돌리기' } as Record<string,string>)[draft.vault]} 비공개 선택`, 'choice', '', disabled, 'gh-primary gh-submit-choice')}<p class="gh-choice-help">같은 팀에게 귓속말로 계획을 전할 수 있어요. 약속을 지킬지는 각자의 선택입니다.</p>`;
    } else {
      const duplicate = new Set(draft.cipher).size !== 3;
      body = `<div class="gh-cipher-lock" aria-hidden="true"><span>?</span><span>?</span><span>?</span></div><fieldset class="gh-cipher-field" ${disabled ? 'disabled' : ''}><legend>서로 다른 숫자 세 개를 골라 주세요.</legend><div>${draft.cipher.map((value, index) => `<label><span>${index + 1}번째 자리</span><select data-field="cipher-${index}" aria-label="암호 ${index + 1}번째 자리">${[1,2,3,4,5,6].map(number => `<option value="${number}" ${value === number ? 'selected' : ''}>${number}</option>`).join('')}</select></label>`).join('')}</div></fieldset>${control(submitted ? '암호 제출 완료 ✓' : own?.solved ? '암호 해독 완료 ✓' : '이 암호로 추리 제출', 'choice', '', disabled || duplicate, 'gh-primary gh-submit-choice')}<p class="gh-choice-help">${duplicate ? '같은 숫자가 겹쳤어요. 서로 다른 숫자를 골라 주세요.' : '예: 암호 1·2·3에 1·3·4를 내면 자리까지 1개, 숫자만 1개가 맞아요.'}</p><div class="gh-private-hints"><h3>나에게만 보이는 단서</h3>${room.myHints.length ? room.myHints.map(hint => `<div class="gh-hint-row"><small>R${hint.round}</small><b>${hint.guess.join(' · ')}</b><span>자리까지 <strong>${hint.exact}</strong> · 숫자만 <strong>${hint.misplaced}</strong></span></div>`).join('') : '<p>첫 추리를 제출하면 다음 라운드에 단서가 생겨요.</p>'}</div>`;
    }
    return `<div class="gh-round-bar"><div><small>ROUND</small><strong>${room.round}<span> / ${room.totalRounds}</span></strong></div><span class="gh-clock" data-deadline="${room.deadline ?? 0}">—</span></div><div class="gh-choice-status" role="status">${choiceLabel}</div>${body}`;
  }
  function renderReveal(room: GameRoomView) {
    return `<div class="gh-reveal"><span class="gh-kicker">ROUND ${room.round} RESULT</span><h2>${escape(room.lastResult?.title ?? '이번 라운드의 선택')}</h2><div class="gh-reveal-lines">${room.lastResult?.lines.map(line => `<p>${escape(line)}</p>`).join('') ?? ''}</div>${room.lastResult?.myHint ? `<div class="gh-hint-row"><b>${room.lastResult.myHint.guess.join(' · ')}</b><span>자리까지 ${room.lastResult.myHint.exact} · 숫자만 ${room.lastResult.myHint.misplaced}</span></div>` : ''}<span class="gh-next-round">다음 라운드까지 <b data-deadline="${room.deadline ?? 0}">—</b></span></div>`;
  }
  function renderFinished(room: GameRoomView) {
    return `<div class="gh-finished"><span class="gh-kicker">THE FINAL SCORE</span><h2>이번 테이블의 결과</h2>${room.finishReason ? `<p>${escape(room.finishReason)}</p>` : ''}${room.secret ? `<p class="gh-answer">공개된 암호 <b>${room.secret.join(' · ')}</b></p>` : ''}<div class="gh-results"><div class="gh-result-heading"><span>순위 · 참가자</span><span>경기 점수</span><span>획득 PT</span></div>${room.results.map(row => `<div class="gh-result-row ${row.playerId === session?.id ? 'gh-me' : ''}"><span><b>${row.rank}</b>${escape(row.nickname)}${row.forfeited ? '<small>중도 퇴장</small>' : ''}</span><strong>${row.score}</strong><strong class="gh-reward">+${row.reward}</strong></div>`).join('')}</div><p>${room.practice ? '연습 경기는 포인트가 지급되지 않아요. 다른 참가자와 실제 경기를 해보세요.' : '상점 포인트는 서버가 경기 종료 후 지급합니다. 같은 경기의 보상은 한 번만 받을 수 있어요.'}</p><div class="gh-ready-buttons">${room.hostId === session?.id ? control('같은 사람들과 다시 준비', 'rematch', '', !canAct(), 'gh-primary') : '<span>방장이 다음 경기를 열 수 있어요.</span>'}${control('포인트 상점 보기', 'shop', '', false, 'gh-quiet')}</div></div>`;
  }
  function renderRoom(room: GameRoomView) {
    const game = gameDefinition(room.kind);
    return `<div class="gh-room-heading"><div><span class="gh-kicker">${room.practice ? 'PRACTICE TABLE · 포인트 없음' : 'LIVE TABLE'}</span><h1>${game.name}</h1><p>${game.subtitle}</p></div>${control(room.phase === 'playing' || room.phase === 'reveal' ? '게임에서 나가기' : '테이블 나가기', 'leave', '', !connected, 'gh-quiet')}</div><div class="gh-room-layout"><main class="gh-main-table"><div class="gh-table-scene-slot"></div><section class="gh-board">${room.phase === 'waiting' ? renderWaiting(room) : room.phase === 'playing' ? renderChoice(room) : room.phase === 'reveal' ? renderReveal(room) : renderFinished(room)}</section>${ruleDetails(room)}${roundHistory(room)}</main><aside>${playerList(room)}${roomChat(room)}</aside></div>`;
  }
  function itemEquipped(item: ShopItem) { return item.slot && profile.appearance[item.slot] === item.value; }
  function itemTint(item: ShopItem) {
    if (item.slot) { const option=APPEARANCE_OPTIONS[item.slot].find(value => value.id === item.value);return option&&'color'in option?option.color:'#b9b0a0'; }
    return item.category === 'emoji' ? '#d6b25f' : '#9b94bf';
  }
  function resetStoreFilters(){shopCategory='all';shopQuery='';shopOwnership='all';}
  function renderStore(ownedOnly: boolean) {
    const query=shopQuery.trim().toLocaleLowerCase('ko-KR');
    const available=SHOP_ITEMS.filter(item=>!ownedOnly||profile.owned.includes(item.id));
    const displayed = available.filter(item => (shopCategory === 'all' || item.category === shopCategory) && (!query||`${item.name} ${item.description} ${item.concept??''}`.toLocaleLowerCase('ko-KR').includes(query)) && (ownedOnly||shopOwnership==='all'||profile.owned.includes(item.id)===(shopOwnership==='owned')));
    const gameProfile = profile as Partial<GameProfile>;
    return `<section class="gh-shop-intro"><div><span class="gh-kicker">${ownedOnly ? 'MY COLLECTION' : 'PLAY FOR YOUR STYLE'}</span><h1>${ownedOnly ? '내가 모은 작은 취향들' : '플레이로 완성하는 나'}</h1><p>${ownedOnly ? '구매한 의상과 액세서리를 조합하고, 사무실에서 이모티콘과 액션을 사용해 보세요.' : '게임에서 얻은 PT로 의상·액세서리·이모티콘·액션을 모아 보세요. 의상과 장식은 구매 전에 3D로 입어볼 수 있어요.'}</p></div><div class="gh-shop-wallet"><small>사용 가능한 포인트</small><strong>✦ ${points(profile.points)} <span>PT</span></strong><span>${gameProfile.earnedToday !== undefined ? `오늘 획득 ${points(gameProfile.earnedToday)} / ${points(gameProfile.dailyCap ?? 500)} PT` : `누적 획득 ${points(profile.earned)} PT`}</span></div></section><div class="gh-shop-toolbar"><div class="gh-category" aria-label="상점 종류">${[['all','전체'],['outfit','의상'],['accessory','액세서리'],['emoji','이모티콘'],['action','액션']].map(([value,label]) => `<button type="button" data-category="${value}" aria-pressed="${shopCategory === value}">${label}<small>${available.filter(item=>value==='all'||item.category===value).length}</small></button>`).join('')}</div>${control('캐릭터 꾸미기', 'appearance', '', !session, 'gh-quiet')}</div><div class="gh-shop-filters"><label class="gh-shop-search"><span>아이템 검색</span><input type="search" data-field="shop-search" value="${escape(shopQuery)}" placeholder="이름·콘셉트 검색" aria-label="아이템 이름이나 콘셉트 검색" maxlength="60" /></label>${ownedOnly?'':`<label class="gh-shop-ownership"><span>보유 상태</span><select data-field="shop-ownership" aria-label="상점 보유 상태"><option value="all" ${shopOwnership==='all'?'selected':''}>전체 아이템</option><option value="owned" ${shopOwnership==='owned'?'selected':''}>보유한 아이템</option><option value="unowned" ${shopOwnership==='unowned'?'selected':''}>미보유 아이템</option></select></label>`}<span class="gh-shop-count" role="status">${displayed.length}개 아이템</span></div>${displayed.length ? `<div class="gh-shop-grid">${displayed.map(item => {
      const owned = profile.owned.includes(item.id), equipped = itemEquipped(item);
      return `<article class="gh-shop-item"><div class="gh-shop-art gh-item-${item.category}" style="--item-tint:${itemTint(item)}">${item.slot&&item.value?`<span class="gh-item-thumb" aria-hidden="true"><img data-avatar-slot="${item.slot}" data-avatar-value="${item.value}" width="128" height="128" alt="" decoding="async" /><span class="gh-thumb-placeholder">3D</span></span>`:`<span aria-hidden="true">${item.icon}</span>`}<small>${({outfit:'WARDROBE',accessory:'ACCESSORY',emoji:'CHAT EMOTE',action:'ACTION'} as const)[item.category]}</small>${owned ? '<b>보유</b>' : ''}</div><div class="gh-shop-item-copy">${item.concept?`<span class="gh-shop-concept">${escape(item.concept)}</span>`:''}<h2>${item.name}</h2><p>${item.description}</p><div class="gh-shop-price">${owned ? `<span>${equipped ? '지금 착용 중' : item.slot ? '보관함에 있어요' : item.category === 'emoji' ? '채팅 이모티콘 메뉴에서 사용' : '캐릭터 액션 메뉴에서 사용'}</span>` : `<strong>${item.price}<small> PT</small></strong>`}${owned && item.slot ? control(equipped ? '착용 중 ✓' : '착용하기', 'equip', `data-item="${item.id}"`, !canAct() || !!equipped, equipped ? 'gh-quiet' : 'gh-primary') : !owned ? control(profile.points < item.price ? `${item.price - profile.points} PT 부족` : `${item.price} PT 구매`, 'buy', `data-item="${item.id}"`, !canAct() || profile.points < item.price, 'gh-primary') : ''}</div>${item.slot?control('3D로 입어보기','try-on',`data-item="${item.id}"`,!session,'gh-quiet gh-try-on'):''}</div></article>`;
    }).join('')}</div>` : `<div class="gh-empty"><span aria-hidden="true">✦</span><strong>${ownedOnly&&!available.length?'아직 모은 아이템이 없어요.':'조건에 맞는 아이템이 없어요.'}</strong><p>${ownedOnly&&!available.length?'게임을 플레이해 포인트를 얻고, 마음에 드는 아이템을 골라 보세요.':'검색어나 분류를 바꿔 다른 아이템도 살펴보세요.'}</p>${control(ownedOnly&&!available.length?'포인트 상점 둘러보기':'검색 조건 초기화',ownedOnly&&!available.length?'shop':'store-reset','',false,'gh-primary')}</div>`}<div class="gh-footnote"><span>PT는 현금 충전·환전·송금할 수 없는 게임 포인트입니다.</span><span>구매한 아이템은 같은 브라우저의 참가자 정보에 저장됩니다.</span></div>`;
  }
  function render() {
    if (disposed || !opened) return;
    const focused = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement ? document.activeElement : null;
    const focusedField = focused?.dataset.field;
    const selection = focused instanceof HTMLInputElement ? focused.selectionStart : null;
    const oldScroll = scroll.scrollTop;
    const view = `${tab}:${state?.room?.id ?? 'lobby'}:${state?.room?.matchId ?? ''}`;
    const detailsState = renderedView === view ? [...content.querySelectorAll('details')].map(detail => detail.open) : [];
    renderedView = view;
    // Preserve the one canvas between state updates; a state packet must not recreate WebGL.
    sceneShell.remove();
    root.querySelector<HTMLElement>('[data-wallet]')!.textContent = points(profile.points);
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
      if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    connection.hidden = connected;
    connection.textContent = session ? '연결을 복구하고 있어요. 다시 연결되면 현재 게임으로 돌아옵니다.' : '사무실에 입장한 뒤 게임룸을 이용해 주세요.';
    stopStoreThumbnails();
    content.innerHTML = tab === 'rooms' ? state?.room ? renderRoom(state.room) : renderLobby() : renderStore(tab === 'inventory');
    if (tab !== 'rooms' && state?.room && ['playing', 'reveal'].includes(state.room.phase)) {
      const activeGame = document.createElement('div'); activeGame.className = 'gh-active-game';
      activeGame.innerHTML = `<span><b>${gameDefinition(state.room.kind).name}</b> 경기 진행 중 · <strong data-deadline="${state.room.deadline ?? 0}">—</strong></span><button type="button" data-tab="rooms">테이블로 돌아가기 →</button>`;
      content.prepend(activeGame);
    }
    content.querySelectorAll('details').forEach((detail, index) => { if (detailsState[index] !== undefined) detail.open = detailsState[index]; });
    const slot = content.querySelector('.gh-table-scene-slot');
    if (slot && state?.room) {
      slot.append(sceneShell);
      if (!tableScene && !sceneUnavailable) {
        try { tableScene = createGameRoomScene(sceneHost); }
        catch { sceneUnavailable = true; sceneHost.innerHTML = '<div class="gh-scene-fallback"><span>◈</span><p>함께 앉은 게임 테이블</p></div>'; }
      }
      tableScene?.setActive(true);
      tableScene?.update(state.room.players.map(player => ({...player, appearance: player.appearance ?? people.find(person => person.id === player.id)?.appearance })));
    } else tableScene?.setActive(false);
    scroll.scrollTop = oldScroll;
    if (focusedField) {
      const next = content.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${focusedField}"]`);
      if (next && !next.disabled) { next.focus({ preventScroll: true }); if (next instanceof HTMLInputElement && selection !== null) next.setSelectionRange(selection, selection); }
    }
    const chatLines = content.querySelector('.gh-chat-lines'); if (chatLines) chatLines.scrollTop = chatLines.scrollHeight;
    startStoreThumbnails();
    tick();
  }
  function tick() {
    let expired = false;
    for (const [id, value] of pending) if (Date.now() - value.at > 8000) { pending.delete(id); expired = true; }
    if (expired) { notify('응답이 늦어지고 있어요. 상태를 새로고침한 뒤 다시 시도해 주세요.'); render(); return; }
    if (!opened) return;
    root.querySelectorAll<HTMLElement>('[data-deadline]').forEach(element => {
      const deadline = Number(element.dataset.deadline);
      const remaining = Math.max(0, Math.ceil((deadline - options.now()) / 1000));
      element.textContent = remaining ? `${remaining}초` : '결과 확인 중';
      element.classList.toggle('gh-urgent', remaining > 0 && remaining <= 5);
    });
  }
  const timer = setInterval(tick, 500);
  root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!target || target.disabled) return;
    if (target.dataset.tab) { tab = target.dataset.tab as Tab; resetStoreFilters(); scroll.scrollTop = 0; render(); return; }
    if (target.dataset.category) { shopCategory = target.dataset.category; render(); return; }
    if (target.dataset.bid !== undefined) { draft.bid = Number(target.dataset.bid); render(); return; }
    if (target.dataset.vault && ['invest', 'guard', 'steal'].includes(target.dataset.vault)) { draft.vault = target.dataset.vault as GameChoiceDraft['vault']; render(); return; }
    const action = target.dataset.command;
    if (action === 'exit') { requestDeparture('game-exit'); return; }
    if (action === 'shop') { tab = 'shop'; resetStoreFilters(); scroll.scrollTop = 0; render(); return; }
    if (action === 'store-reset') { resetStoreFilters(); render(); return; }
    if (action === 'appearance') { options.onAppearance(); return; }
    if (action === 'try-on') { const item=SHOP_ITEMS.find(item=>item.id===target.dataset.item);if(item?.slot&&item.value)options.onAppearance({key:item.slot,value:item.value});return; }
    if (action === 'whisper-inbox') { options.onWhisper(''); return; }
    if (action === 'whisper' && target.dataset.player) { options.onWhisper(target.dataset.player); return; }
    if (action === 'sync') { command('game-enter'); return; }
    if (action === 'create' || action === 'practice') { command('game-create', { kind: target.dataset.kind as GameKind, practice: action === 'practice' }); return; }
    if (action === 'join') { command('game-join', { roomId: target.dataset.room }); return; }
    if (action === 'leave') {
      requestDeparture('game-leave'); return;
    }
    if (action === 'ready') { command('game-ready', { ready: target.dataset.ready === 'true' }); return; }
    if (action === 'start') { command('game-start'); return; }
    if (action === 'rematch') { command('game-rematch'); return; }
    if (action === 'choice' && state?.room) {
      const submission = gameChoiceSubmission(state.room, draft, session?.id);
      if (submission && canAct()) command('game-choice', submission);
      return;
    }
    if (action === 'chat-emote' && state?.room) {
      const item = SHOP_ITEMS.find(item => item.id === target.dataset.item);
      if (item?.emoji && profile.owned.includes(item.id) && ![...pending.values()].some(value => value.type === 'game-chat')) command('game-chat', { text: item.emoji });
      return;
    }
    if (action === 'buy') { command('shop-buy', { itemId: target.dataset.item }); return; }
    if (action === 'equip') {
      const item = SHOP_ITEMS.find(item => item.id === target.dataset.item);
      if (item?.slot && item.value && profile.owned.includes(item.id)) command('avatar-equip', { appearance: { ...profile.appearance, [item.slot]: item.value } });
    }
  });
  root.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.dataset.field === 'chat') draft.chat = target.value;
    if (target.dataset.field === 'shop-search') { shopQuery=target.value;if(!(event instanceof InputEvent)||!event.isComposing)render(); }
  });
  root.addEventListener('compositionend',event=>{const target=event.target;if(target instanceof HTMLInputElement&&target.dataset.field==='shop-search'){shopQuery=target.value;render();}});
  root.addEventListener('change', event => {
    const target = event.target;
    if(target instanceof HTMLSelectElement&&target.dataset.field==='shop-ownership'){shopOwnership=target.value;render();return;}
    if (!(target instanceof HTMLSelectElement) || !target.dataset.field?.startsWith('cipher-')) return;
    draft.cipher[Number(target.dataset.field.slice(-1))] = Number(target.value); render();
  });
  root.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement) || !event.target.classList.contains('gh-chat-form')) return;
    event.preventDefault(); if (!draft.chat.trim() || [...pending.values()].some(value => value.type === 'game-chat')) return;
    if (command('game-chat', { text: draft.chat.trim() })) { draft.chat = ''; render(); }
  });
  return {
    setSession(value: Session | null) { session = value; if (!value) { pending.clear(); state = null; setOpen(false); } render(); },
    setPlayers(value: Person[]) { people = value; if (opened && tab === 'rooms' && state?.room) tableScene?.update(state.room.players.map(player => ({ ...player, appearance: player.appearance ?? people.find(person => person.id === player.id)?.appearance }))); },
    setConnected(value: boolean) { connected = value; if (!value) pending.clear(); render(); },
    setProfile(value: AvatarProfile) { profile = value; render(); },
    setWhisperUnread(value: number) { const count = root.querySelector<HTMLElement>('[data-whisper-count]')!; count.hidden = value <= 0; count.textContent = value > 99 ? '99+' : String(value); },
    receive(packet: Record<string, unknown>) {
      if (packet.type === 'error' && typeof packet.requestId === 'string' && pending.has(packet.requestId)) {
        pending.delete(packet.requestId); notify(typeof packet.message === 'string' ? packet.message : '요청을 처리하지 못했어요.'); render(); return true;
      }
      if (packet.type !== 'game-state' || !packet.state || typeof packet.state !== 'object') return false;
      const previous = state;
      state = packet.state as GameSnapshot; profile = state.profile;
      if (leaveDialog.open && (!state.room || `${state.room.id}:${state.room.matchId}` !== leaveContext)) leaveDialog.close();
      if (typeof packet.requestId === 'string') pending.delete(packet.requestId);
      options.onProfile?.(profile);
      if ((state.room?.id ?? null) !== (previous?.room?.id ?? null)) { tab = 'rooms'; draft.chat = ''; scroll.scrollTop = 0; }
      if (state.area === 'games') setOpen(true); else setOpen(false);
      render(); return true;
    },
    open() { if (!session) { notify('먼저 닉네임과 캐릭터를 정해 사무실에 입장해 주세요.'); return; } tab = 'rooms'; setOpen(true); command('game-enter'); },
    openShop() { if (!session) { notify('먼저 닉네임과 캐릭터를 정해 사무실에 입장해 주세요.'); return; } tab = 'shop'; resetStoreFilters(); scroll.scrollTop = 0; setOpen(true); command('game-enter'); },
    close() { setOpen(false); },
    isOpen: () => opened,
    dispose() { disposed = true; stopStoreThumbnails();clearInterval(timer); clearTimeout(statusTimer); tableScene?.dispose(); leaveDialog.close(); leaveDialog.remove(); root.remove(); document.body.classList.remove('game-hub-open'); },
  };
}
