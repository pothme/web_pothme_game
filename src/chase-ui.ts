export interface ChaseView {
  roundId: string;
  robberId: string;
  robberName: string;
  startsAt: number;
  endsAt: number;
  role: 'robber' | 'runner' | 'spectator';
  caughtIds: string[];
  participantCount: number;
}
type MoveDirection = 'forward' | 'back' | 'left' | 'right';

export function createChaseUI(options: {
  now: () => number;
  selfId: () => string | null;
  onMoveInput: (direction: MoveDirection, pressed: boolean) => void;
}) {
  const hud = document.createElement('section');
  hud.className = 'chase-hud'; hud.hidden = true;
  hud.setAttribute('aria-label', '강도 추격전');
  hud.innerHTML = `<div class="chase-heading"><span>매 세 번째 게임 · 강도 추격전</span><strong class="chase-clock">30초</strong></div><h2></h2><p class="chase-description"></p><div class="chase-footer"><span class="chase-robber"></span><span class="chase-count"></span></div><div class="chase-track"><span></span></div>`;
  const pad = document.createElement('div');
  pad.className = 'chase-pad'; pad.hidden = true;
  pad.setAttribute('aria-label', '추격전 이동 버튼');
  const directions: { direction: MoveDirection; arrow: string; label: string }[] = [
    { direction: 'forward', arrow: '↑', label: '앞으로 이동' },
    { direction: 'left', arrow: '←', label: '왼쪽으로 이동' },
    { direction: 'back', arrow: '↓', label: '뒤로 이동' },
    { direction: 'right', arrow: '→', label: '오른쪽으로 이동' },
  ];
  const held = new Map<number, MoveDirection>();
  for (const { direction, arrow, label } of directions) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = arrow;
    button.dataset.direction = direction;
    button.setAttribute('aria-label', label);
    button.onpointerdown = event => {
      event.preventDefault();
      if (!state || state.role === 'spectator') return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      button.focus({ preventScroll: true });
      button.setPointerCapture(event.pointerId);
      held.set(event.pointerId, direction); button.classList.add('pressed');
      options.onMoveInput(direction, true);
    };
    const release = (event: PointerEvent) => {
      const old = held.get(event.pointerId);
      if (!old) return;
      held.delete(event.pointerId);
      if (![...held.values()].includes(old)) { options.onMoveInput(old, false); button.classList.remove('pressed'); }
    };
    button.onpointerup = release; button.onpointercancel = release; button.onlostpointercapture = release;
    // Keyboard and assistive button activation produces a short movement pulse.
    button.onclick = event => {
      if (event.detail !== 0 || !state || state.role === 'spectator') return;
      options.onMoveInput(direction, true);
      setTimeout(() => options.onMoveInput(direction, false), 180);
    };
    pad.appendChild(button);
  }
  document.querySelector('.world')!.append(hud, pad);
  let state: ChaseView | null = null;
  function releaseAll() {
    for (const direction of new Set(held.values())) options.onMoveInput(direction, false);
    held.clear(); pad.querySelectorAll('button').forEach(button => button.classList.remove('pressed'));
  }
  window.addEventListener('blur', releaseAll);
  function tick() {
    if (!state) return;
    const now = options.now();
    const preparing = now < state.startsAt;
    const caught = state.caughtIds.includes(options.selfId() ?? '');
    const seconds = Math.ceil(Math.max(0, (preparing ? state.startsAt : state.endsAt) - now) / 1000);
    hud.classList.toggle('is-robber', state.role === 'robber');
    hud.classList.toggle('is-caught', caught);
    hud.querySelector('.chase-clock')!.textContent = preparing ? `준비 ${seconds}초` : `${seconds}초`;
    hud.querySelector('h2')!.textContent = state.role === 'spectator' ? '이번 판은 관전 중' : preparing ? (state.role === 'robber' ? '당신이 강도입니다!' : '강도가 온다. 도망칠 준비!') : state.role === 'robber' ? '친구들을 따라잡으세요!' : caught ? '잡혔어요. 이번 판 추가 차감 없음' : '잡히기 전에 도망쳐요!';
    hud.querySelector('.chase-description')!.textContent = state.role === 'spectator' ? '진행 중 입장했어요. 다음 게임부터 함께해요.' : state.role === 'robber' ? '가까이 닿으면 잡혀요. 잡힌 친구만 최대 3,000원 차감, 강도 보상은 없어요.' : caught ? '계속 움직여도 괜찮아요. 한 사람당 한 번만 차감돼요.' : 'WASD·바닥 클릭·방향 버튼으로 이동하세요. 잡히면 최대 3,000원 차감.';
    hud.querySelector('.chase-robber')!.textContent = `강도 · ${state.robberName}`;
    hud.querySelector('.chase-count')!.textContent = `${state.caughtIds.length} / ${Math.max(0, state.participantCount - 1)}명 잡힘`;
    (hud.querySelector('.chase-track span') as HTMLElement).style.width = `${preparing ? 100 : Math.max(0, Math.min(100, (state.endsAt - now) / 30000 * 100))}%`;
  }
  function setState(next: ChaseView | null) {
    if (state?.roundId !== next?.roundId) releaseAll();
    state = next;
    hud.hidden = !next;
    pad.hidden = !next || next.role === 'spectator';
    document.body.classList.toggle('chase-active', !!next);
    tick();
  }
  return { setState, tick };
}
