import { AVATAR_ACTIONS, getAvatarActionCooldown, isMarketReaction, type AvatarActionKind, type AvatarActionView } from '../shared/avatar-actions';
import type { RefreshmentSelection } from '../shared/refreshments';
import { SHOULDER_LINK_RULES, type ShoulderLinkView } from '../shared/shoulder-links';
import { isStandaloneJumpClick, JumpPrediction } from './jump-prediction';
import './avatar-actions.css';

type Options = {
  now: () => number;
  beforeOpen: () => void;
  send: (kind: AvatarActionKind, requestId: string) => boolean;
  predictJump: (action: AvatarActionView | null | undefined) => void;
  putAway: (requestId: string) => boolean;
  setShoulder: (enabled: boolean, requestId: string) => boolean;
  cheerShoulder: (requestId: string) => boolean;
  notify: (message: string) => void;
};

/** A small opt-in palette; no panel covers the office until the visitor asks. */
export function createAvatarActionsUI(options: Options) {
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.id = 'avatar-actions-trigger'; trigger.className = 'avatar-actions-trigger';
  trigger.innerHTML = '<span aria-hidden="true">✦</span> 액션';
  trigger.setAttribute('aria-label', '캐릭터 액션 선택'); trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'avatar-actions-dialog'); trigger.hidden = true;
  const jump = document.createElement('button'); jump.type = 'button'; jump.id = 'avatar-jump'; jump.className = 'avatar-actions-trigger avatar-jump';
  jump.innerHTML = '<span aria-hidden="true">↑</span> <span>점프</span>'; jump.setAttribute('aria-label', '점프 · Space'); jump.title = '공중에서 한 번 더 누르면 2단 점프 · Space'; jump.hidden = true;
  const dialog = document.createElement('dialog');
  dialog.id = 'avatar-actions-dialog'; dialog.className = 'avatar-actions-dialog';
  dialog.setAttribute('aria-labelledby', 'avatar-actions-title');
  const header = document.createElement('div'); header.className = 'avatar-actions-header';
  const title = document.createElement('h2'); title.id = 'avatar-actions-title'; title.textContent = '캐릭터 액션';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '닫기 ×'; close.setAttribute('aria-label', '캐릭터 액션 닫기');
  close.onclick = () => dialog.close(); header.append(title, close);
  const choices = document.createElement('div'); choices.className = 'avatar-action-choices';
  const caption = document.createElement('p'); caption.textContent = '함께 있는 사람에게 내 동작이 보여요.'; caption.setAttribute('role', 'status');
  let active = false, seated = false, refreshments: RefreshmentSelection | null = null, shoulder: ShoulderLinkView | null = null;
  let retryAt = 0, putAwayRetryAt = 0, shoulderRetryAt = 0, shoulderCheerRetryAt = 0;
  let pending: { id: string; at: number; type: 'action' | 'put-away' | 'shoulder' | 'shoulder-cheer' } | null = null;
  const jumps = new JumpPrediction(() => performance.timeOrigin + performance.now(), options.predictJump);
  let jumpWake: ReturnType<typeof setTimeout> | undefined;
  function updateShoulder(value: ShoulderLinkView | null) {
    if (value?.groupId !== shoulder?.groupId) shoulderCheerRetryAt = 0;
    shoulder = value;
    if (value) shoulderCheerRetryAt = Math.max(shoulderCheerRetryAt, value.cheerNextAt ?? 0, value.cheer ? value.cheer.startedAt + SHOULDER_LINK_RULES.cheerCooldownMs : 0);
  }
  function cheerPlaying(now = options.now()) { return !!shoulder && shoulder.count >= 2 && !!shoulder.cheer && now >= shoulder.cheer.startedAt && now < shoulder.cheer.expiresAt; }
  const buttons = new Map<AvatarActionKind, HTMLButtonElement>();
  let owned = new Set<string>();
  function available(kind: AvatarActionKind) {
    if ((kind === 'dance' || kind === 'heart') && !owned.has(`action-${kind}`)) return false;
    if (kind === 'jump') return !seated;
    if (kind === 'drink') return !!refreshments?.drink;
    if (kind === 'eat') return !!refreshments?.snack;
    if (isMarketReaction(kind)) return true;
    return !refreshments;
  }
  function perform(kind: AvatarActionKind) {
    tick();
    if (kind === 'jump') {
      if (!active || seated || (pending && pending.type !== 'action') || !jumps.nextStep) return;
      const requestId = crypto.randomUUID();
      if (!options.send(kind, requestId)) { options.notify('사무실 연결을 확인해 주세요.'); return; }
      jumps.start(requestId);
      if (dialog.open) dialog.close(); tick(); return;
    }
    if (!active || !available(kind) || pending || jumps.busy || options.now() < retryAt) return;
    const requestId = crypto.randomUUID();
    if (!options.send(kind, requestId)) { dialog.close(); options.notify('사무실 연결을 확인해 주세요.'); return; }
    pending = { id: requestId, at: options.now(), type: 'action' }; retryAt = options.now() + getAvatarActionCooldown(kind);
    if (dialog.open) dialog.close(); tick();
  }
  jump.onclick = event => { event.stopPropagation(); if (isStandaloneJumpClick(event.detail)) perform('jump'); };
  // A second thumb can tap jump without cancelling a held movement direction.
  jump.addEventListener('pointerdown', event => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault(); perform('jump');
  });
  jump.addEventListener('pointerup', event => event.stopPropagation());
  for (const action of AVATAR_ACTIONS.filter(action => action.kind !== 'jump')) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.action = action.kind;
    const symbol = document.createElement('span'); symbol.setAttribute('aria-hidden', 'true'); symbol.textContent = action.icon;
    const label = document.createElement('span'); label.textContent = action.label; button.append(symbol, label);
    button.onclick = () => perform(action.kind);
    buttons.set(action.kind, button); choices.append(button);
  }
  const putAway = document.createElement('button'); putAway.type = 'button'; putAway.dataset.action = 'put-away';
  putAway.innerHTML = '<span aria-hidden="true">▱</span><span>내려놓기</span>';
  putAway.onclick = () => {
    tick(); if (!active || !refreshments || pending || options.now() < putAwayRetryAt) return;
    const requestId = crypto.randomUUID();
    if (!options.putAway(requestId)) { options.notify('사무실 연결을 확인해 주세요.'); return; }
    pending = { id: requestId, at: options.now(), type: 'put-away' }; dialog.close(); tick();
  };
  const shoulderButton = document.createElement('button'); shoulderButton.type = 'button'; shoulderButton.dataset.action = 'shoulder';
  shoulderButton.innerHTML = '<span aria-hidden="true">🫂</span><span>어깨걸어</span>';
  shoulderButton.onclick = () => {
    tick(); if (!active || pending || (!shoulder && (seated || refreshments || options.now() < shoulderRetryAt))) return;
    const requestId = crypto.randomUUID();
    if (!options.setShoulder(!shoulder, requestId)) { options.notify('사무실 연결을 확인해 주세요.'); return; }
    pending = { id: requestId, at: options.now(), type: 'shoulder' }; dialog.close(); tick();
  };
  const shoulderCheerButton = document.createElement('button'); shoulderCheerButton.type = 'button'; shoulderCheerButton.dataset.action = 'shoulder-cheer';
  shoulderCheerButton.innerHTML = '<span aria-hidden="true">💪</span><span>으쌰! 으쌰!</span>';
  shoulderCheerButton.onclick = () => {
    tick(); if (!active || !shoulder || shoulder.count < 2 || seated || refreshments || pending || cheerPlaying() || options.now() < shoulderCheerRetryAt) return;
    const requestId = crypto.randomUUID();
    if (!options.cheerShoulder(requestId)) { options.notify('사무실 연결을 확인해 주세요.'); return; }
    pending = { id: requestId, at: options.now(), type: 'shoulder-cheer' }; dialog.close(); tick();
  };
  choices.append(putAway, shoulderButton, shoulderCheerButton);
  dialog.append(header, choices, caption); document.body.append(trigger, jump, dialog);
  function tick() {
    if (pending && options.now() - pending.at > 7000) pending = null;
    jumps.tick();
    if (jumpWake !== undefined) clearTimeout(jumpWake);
    const wakeDelay = active ? jumps.nextWakeDelay() : undefined;
    jumpWake = wakeDelay === undefined ? undefined : setTimeout(tick, wakeDelay);
    const waiting = !!pending || jumps.busy || options.now() < retryAt;
    // Cleanup and group exit stay accessible during an ordinary emote cooldown.
    trigger.disabled = !active;
    trigger.setAttribute('aria-label', shoulder ? '캐릭터 액션 선택 · 어깨동무 중' : '캐릭터 액션 선택');
    trigger.classList.toggle('avatar-actions-linked', !!shoulder);
    const nextJump = jumps.nextStep;
    jump.disabled = !active || seated || !!(pending && pending.type !== 'action') || !nextJump;
    const jumpLabel = nextJump === 2 ? '2단 점프' : '점프';
    jump.lastElementChild!.textContent = jumpLabel;
    jump.setAttribute('aria-label', seated ? '일어난 뒤 점프할 수 있어요' : `${jumpLabel} · Space`);
    for (const [kind, button] of buttons) { button.hidden = !available(kind); button.disabled = !active || waiting; }
    putAway.hidden = !refreshments; putAway.disabled = !active || !!pending || options.now() < putAwayRetryAt;
    shoulderButton.hidden = !shoulder && (!!refreshments || seated);
    shoulderButton.disabled = !active || !!pending || (!shoulder && options.now() < shoulderRetryAt);
    shoulderButton.setAttribute('aria-pressed', String(!!shoulder));
    shoulderButton.lastElementChild!.textContent = shoulder ? shoulder.count > 1 ? '어깨동무 풀기' : '어깨동무 대기 취소' : '어깨걸어';
    const cheering = cheerPlaying(), cheerCooldown = Math.max(0, Math.ceil((shoulderCheerRetryAt - options.now()) / 1000));
    shoulderCheerButton.hidden = !shoulder || shoulder.count < 2 || !!refreshments || seated;
    shoulderCheerButton.disabled = !active || !!pending || cheering || cheerCooldown > 0;
    shoulderCheerButton.setAttribute('aria-pressed', String(cheering));
    shoulderCheerButton.lastElementChild!.textContent = cheering ? '함께 으쌰! 진행 중' : cheerCooldown ? `${cheerCooldown}초 후 다시 으쌰!` : '으쌰! 으쌰!';
    caption.textContent = shoulder
      ? shoulder.count > 1 ? cheering ? `${shoulder.count}명이 연결한 채 좌우로 으쌰! 으쌰! 이동하거나 풀기를 누르면 빠져나와요.` : `${shoulder.count}명이 어깨동무 중이에요. 으쌰! 으쌰!를 누르면 다 같이 흔들어요. 이동하거나 풀기로 나올 수 있어요.` : '양팔을 벌리고 기다려요. 가까운 사람도 어깨걸어를 누르면 함께 모여요. 두 명부터 으쌰! 으쌰!를 할 수 있어요.'
      : refreshments ? '가즈아!·살려주세요!는 들고 있는 음료·간식을 유지한 채 표현해요. 마시기·먹기는 한 모금·한 입, 내려놓기는 손 비우기예요.'
      : seated ? '가즈아!·살려주세요!를 앉아서도 표현해요. 점프와 어깨동무는 일어난 뒤 할 수 있어요.' : 'PC는 Space, 모바일은 점프 버튼. 공중에서 한 번 더 누르면 2단 점프해요. 이동하면 어깨동무가 풀려요.';
  }
  trigger.onclick = () => {
    if (!active) return;
    options.beforeOpen();
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => other.close());
    tick(); dialog.showModal(); close.focus({ preventScroll: true });
  };
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  const hide = () => { if (dialog.open) dialog.close(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.code === 'Space' && event.target === jump && event.repeat) { event.preventDefault(); return; }
    if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || !active || document.hidden || document.querySelector('dialog[open]') || document.body.classList.contains('chat-composing')) return;
    const target = event.target;
    if (target !== jump && target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,button,a,[role="textbox"]'))) return;
    event.preventDefault(); perform('jump');
  };
  window.addEventListener('blur', hide); document.addEventListener('visibilitychange', hide);
  window.addEventListener('keydown', keydown);
  return {
    setOwned(ids: string[]) { owned = new Set(ids); tick(); },
    setActive(value: boolean) { active = value; trigger.hidden = !value; jump.hidden = !value; if (!value) hide(); tick(); },
    disconnect() { pending = null; jumps.reset(); this.setActive(false); },
    setRefreshments(value: RefreshmentSelection | null) { refreshments = value; tick(); },
    setSeated(value: boolean) { if (value && !seated) jumps.cancel(); seated = value; tick(); },
    setShoulderState(value: ShoulderLinkView | null) { updateShoulder(value); tick(); },
    setJumpAction(action: AvatarActionView | null, serverNow: number) { if (!seated) jumps.seed(action, serverNow); tick(); },
    receiveJump(requestId: unknown, action: AvatarActionView | null, serverNow: number) { const received = jumps.receive(requestId, action, serverNow); tick(); return received; },
    receive(requestId: unknown, startedAt: number, kind: AvatarActionKind) { if (pending?.type === 'action' && pending.id === requestId) pending = null; retryAt = startedAt + getAvatarActionCooldown(kind); tick(); },
    receivePutAway(requestId: unknown) {
      if (pending?.type !== 'put-away' || pending.id !== requestId) return;
      pending = null; refreshments = null; putAwayRetryAt = 0; jumps.cancel(); tick(); options.notify('커피와 간식을 내려놓았어요.');
    },
    receiveShoulder(requestId: unknown, value: ShoulderLinkView | null) {
      updateShoulder(value);
      if (pending?.type === 'shoulder' && pending.id === requestId) {
        pending = null; shoulderRetryAt = 0;
        if (value) jumps.cancel();
        options.notify(value ? value.count > 1 ? '옆 사람과 어깨동무했어요.' : '어깨동무를 기다려요. 가까운 사람도 어깨걸어를 눌러 주세요.' : '어깨동무를 풀었어요.');
      }
      tick();
    },
    receiveShoulderCheer(requestId: unknown, value: ShoulderLinkView | null, serverTime: number) {
      updateShoulder(value);
      if (pending?.type === 'shoulder-cheer' && pending.id === requestId) {
        pending = null;
        if (value && value.count >= 2 && value.cheer && serverTime < value.cheer.expiresAt) options.notify('어깨동무한 사람들과 함께 으쌰! 으쌰!');
      }
      tick();
    },
    error(requestId: unknown, message: string, next?: number) {
      if (jumps.reject(requestId, next, options.now())) { options.notify(message); tick(); return true; }
      if (!pending || requestId !== pending.id) return false;
      if (pending.type === 'action') retryAt = next ?? 0;
      else if (pending.type === 'put-away') putAwayRetryAt = next ?? 0;
      else if (pending.type === 'shoulder-cheer') shoulderCheerRetryAt = next ?? 0;
      else shoulderRetryAt = next ?? 0;
      pending = null; options.notify(message); tick(); return true;
    },
    reset() { pending = null; retryAt = 0; putAwayRetryAt = 0; shoulderRetryAt = 0; shoulderCheerRetryAt = 0; refreshments = null; shoulder = null; seated = false; this.setActive(false); jumps.reset(); },
    tick,
    dispose() { hide(); if (jumpWake !== undefined) clearTimeout(jumpWake); jumps.reset(); window.removeEventListener('blur', hide); window.removeEventListener('keydown', keydown); document.removeEventListener('visibilitychange', hide); trigger.remove(); jump.remove(); dialog.remove(); },
  };
}
