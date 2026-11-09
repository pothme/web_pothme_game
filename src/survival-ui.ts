import type { ChaseView } from './chase-ui';
export type SurvivalChoice = 'rock' | 'paper' | 'scissors';
export type SurvivalGame = 'rps' | 'memory' | 'math' | 'chase';
export interface SurvivalState {
  phase: 'waiting' | 'playing';
  roundId: string | null;
  nextRoundAt: number | null;
  deadline: number | null;
  submitted: boolean;
  choice?: SurvivalChoice;
  game: SurvivalGame | null;
  nextGame: SurvivalGame | null;
  roundNumber?: number;
  nextRoundNumber?: number;
  chase?: ChaseView;
  answer?: number;
  challenge?: { options: string[]; sequence?: string; revealUntil?: number; question?: string };
}
export interface SurvivalResult {
  roundId: string;
  game: SurvivalGame;
  outcome: 'win' | 'draw' | 'lose' | 'correct' | 'wrong' | 'timeout' | 'caught' | 'escaped' | 'robber';
  choice?: SurvivalChoice;
  npcChoice?: SurvivalChoice;
  answer?: number;
  correctAnswer?: number;
  correctLabel?: string;
  penalty: number;
  breadShuttle: boolean;
  nextRoundAt: number | null;
}
const hands: Record<SurvivalChoice, string> = { rock: '✊ 바위', paper: '✋ 보', scissors: '✌ 가위' };
const gameNames: Record<SurvivalGame, string> = { rps: '가위바위보', memory: '기억력 시험', math: '암산 퀴즈', chase: '강도 추격전' };

/** A server-driven UI: the browser never decides whether a player survives. */
export function createSurvivalUI(options: {
  now: () => number;
  sendChoice: (roundId: string, selection: { choice?: SurvivalChoice; answer?: number }, requestId: string) => boolean;
  onActive: (active: boolean) => void;
  onChase: (state: ChaseView | null) => void;
}) {
  const chip = document.createElement('button');
  chip.className = 'survival-chip';
  chip.hidden = true;
  chip.type = 'button';
  chip.innerHTML = '<span class="survival-chip-icon">◈</span><span><small>2분마다 새 게임</small><strong>다음 게임 준비 중</strong></span><span class="survival-chip-arrow">↗</span>';
  document.querySelector('.world')!.appendChild(chip);
  const label = chip.querySelector('strong')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'survival-dialog';
  dialog.className = 'modal survival-modal';
  dialog.setAttribute('aria-labelledby', 'survival-title');
  dialog.innerHTML = `
    <div class="modal-header"><span class="eyebrow">EVERY TWO MINUTES</span><button class="tool-button survival-close" type="button" aria-label="생존 게임 닫기">×</button></div>
    <div class="survival-symbol">✌</div><span class="npc-name">나에게 주어진 랜덤 시험</span>
    <h2 id="survival-title">랜덤 시험, 잔액을 지켜라!</h2>
    <p class="survival-explanation">승리·무승부는 잔액 유지. 패배하거나 시간을 넘기면 1,000원 차감.</p>
    <div class="survival-time"><span>선택까지 남은 시간</span><strong>20초</strong></div>
    <p class="survival-message" role="status" aria-live="polite">20초 안에 손을 골라 주세요.</p>
    <div class="survival-challenge" hidden><strong></strong><small></small></div>
    <div class="rps-options survival-options"><button type="button" data-survival-choice="scissors"><span>✌</span>가위</button><button type="button" data-survival-choice="rock"><span>✊</span>바위</button><button type="button" data-survival-choice="paper"><span>✋</span>보</button></div>
    <div class="survival-answers" hidden></div>
    <div class="survival-progress"><div></div></div>
    <p class="survival-footnote">잔액은 0원 아래로 내려가지 않아요. 0원이면 빵셔틀로 변신! 강퇴는 없어요.</p>
    <button class="button button-primary full survival-done" type="button" hidden>교실로 돌아가기</button>`;
  document.body.appendChild(dialog);
  const message = dialog.querySelector<HTMLParagraphElement>('.survival-message')!;
  const time = dialog.querySelector<HTMLElement>('.survival-time strong')!;
  const timeLabel = dialog.querySelector<HTMLElement>('.survival-time span')!;
  const progress = dialog.querySelector<HTMLElement>('.survival-progress div')!;
  const done = dialog.querySelector<HTMLButtonElement>('.survival-done')!;
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-survival-choice]')];
  const answers = dialog.querySelector<HTMLDivElement>('.survival-answers')!;
  const challenge = dialog.querySelector<HTMLDivElement>('.survival-challenge')!;
  const explanation = dialog.querySelector<HTMLElement>('.survival-explanation')!;
  let state: SurvivalState | null = null;
  let pendingId: string | null = null;
  let pendingTimeout: ReturnType<typeof setTimeout> | undefined;
  let showingResult = false;

  function clearPending() { clearTimeout(pendingTimeout); pendingId = null; }
  function open() {
    if (!dialog.open) {
      document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => other.close());
      dialog.showModal();
    }
  }
  chip.onclick = () => { if (!state?.chase && (state?.phase === 'playing' || showingResult)) open(); };
  dialog.querySelector<HTMLButtonElement>('.survival-close')!.onclick = () => dialog.close();
  done.onclick = () => { dialog.close(); showingResult = false; };
  function submit(selection: { choice?: SurvivalChoice; answer?: number }) {
    if (!state?.roundId || state.chase || state.phase !== 'playing' || state.submitted || pendingId || options.now() >= (state.deadline ?? 0)) return;
    const requestId = crypto.randomUUID();
    if (!options.sendChoice(state.roundId, selection, requestId)) {
      message.textContent = '연결을 복구하고 있어요. 연결되면 다시 선택해 주세요.';
      return;
    }
    pendingId = requestId;
    message.textContent = '선택을 선생님께 전달하는 중…';
    pendingTimeout = setTimeout(() => {
      if (pendingId !== requestId) return;
      pendingId = null;
      message.textContent = '응답을 확인하지 못했어요. 다시 눌러 확인해 주세요.';
      tick();
    }, 5000);
    tick();
  }
  for (const button of buttons) button.onclick = () => submit({ choice: button.dataset.survivalChoice as SurvivalChoice });
  function tick() {
    if (!state) return;
    const now = options.now();
    if (state.chase) {
      const preparing = now < state.chase.startsAt;
      const seconds = Math.ceil(Math.max(0, (preparing ? state.chase.startsAt : state.chase.endsAt) - now) / 1000);
      label.textContent = preparing ? `추격 준비 ${seconds}초` : `추격전 ${seconds}초 남음`;
      chip.querySelector('small')!.textContent = `${state.roundNumber ?? ''}번째 게임 · 강도 추격전`;
      chip.setAttribute('aria-label', label.textContent);
      chip.classList.add('is-playing');
      return;
    }
    if (state.phase === 'playing') {
      const left = Math.max(0, (state.deadline ?? now) - now);
      label.textContent = left > 0 ? `${Math.ceil(left / 1000)}초 · ${state.submitted ? '선택 완료' : '지금 참여하기'}` : '선생님이 결과를 확인 중';
      time.textContent = left > 0 ? `${Math.ceil(left / 1000)}초` : '결과 확인 중';
      timeLabel.textContent = state.submitted ? '결과 발표까지' : '선택까지 남은 시간';
      progress.style.width = `${Math.min(100, left / 20000 * 100)}%`;
      const revealing = state.game === 'memory' && now < (state.challenge?.revealUntil ?? 0);
      [...buttons, ...answers.querySelectorAll<HTMLButtonElement>('button')].forEach(button => button.disabled = state!.submitted || !!pendingId || left <= 0 || revealing);
      if (state.game === 'memory') {
        answers.hidden = revealing;
        challenge.querySelector('strong')!.textContent = revealing ? (state.challenge?.sequence || '기호를 기억하세요') : '●  ●  ●';
        challenge.querySelector('small')!.textContent = revealing ? `${Math.ceil(((state.challenge?.revealUntil ?? now) - now) / 1000)}초 동안 순서를 기억하세요` : '방금 본 기호의 순서를 고르세요';
      }
      chip.classList.add('is-playing');
    } else {
      const left = state.nextRoundAt == null ? null : Math.max(0, state.nextRoundAt - now);
      const seconds = left == null ? 0 : Math.ceil(left / 1000);
      label.textContent = left == null ? '친구들을 기다리는 중' : left <= 0 ? '곧 시작해요' : `다음 게임 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      chip.classList.remove('is-playing');
      buttons.forEach(button => button.disabled = true);
    }
    chip.querySelector('small')!.textContent = state.phase === 'playing' && state.game ? `내 시험 · ${gameNames[state.game]}` : state.nextGame === 'chase' ? `다음 ${state.nextRoundNumber ?? ''}번째 · 강도 추격전` : `다음 ${state.nextRoundNumber ?? ''}번째 · 랜덤 시험`;
    chip.setAttribute('aria-label', `랜덤 미니게임 ${state.game ? gameNames[state.game] : ''} · ${label.textContent}`);
  }
  function setState(next: SurvivalState) {
    const isNewRound = next.phase === 'playing' && (state?.roundId !== next.roundId || state?.phase !== 'playing');
    const priorRoundId = state?.roundId;
    const wasPlaying = state?.phase === 'playing';
    const previousChase = state?.chase?.roundId;
    state = next;
    chip.hidden = false;
    options.onActive(next.phase === 'playing' || !!next.chase);
    options.onChase(next.chase ?? null);
    if (next.chase) {
      clearPending(); showingResult = false;
      if (previousChase !== next.chase.roundId) {
        document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => other.close());
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
      dialog.close(); tick(); return;
    }
    if (next.phase === 'playing') {
      if (isNewRound) {
        clearPending(); showingResult = false;
        dialog.classList.remove('survived', 'lost');
        done.hidden = true;
        dialog.querySelector<HTMLElement>('.survival-options')!.hidden = next.game !== 'rps';
        answers.hidden = next.game === 'rps';
        challenge.hidden = next.game === 'rps';
        dialog.querySelector<HTMLElement>('.survival-progress')!.hidden = false;
        dialog.querySelector<HTMLElement>('.survival-explanation')!.hidden = false;
        dialog.querySelector('#survival-title')!.textContent = next.game === 'rps' ? '가위바위보, 잔액을 지켜라.' : next.game === 'memory' ? '기억이 널 구할 거야.' : '정답만이 돈을 지킨다.';
        dialog.querySelector('.survival-symbol')!.textContent = next.game === 'rps' ? '✌' : next.game === 'memory' ? '◈' : '×';
        explanation.textContent = next.game === 'rps' ? '승리·무승부는 잔액 유지. 패배하거나 선택하지 않으면 1,000원이 차감됩니다.' : next.game === 'memory' ? '5초 동안 기호를 기억하고 같은 순서를 고르세요. 오답·시간 초과는 1,000원 차감.' : '20초 안에 정답을 고르세요. 오답·시간 초과는 1,000원 차감.';
        answers.replaceChildren();
        if (next.game !== 'rps') {
          next.challenge?.options.forEach((text, index) => {
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = text; button.dataset.answer = String(index);
            button.onclick = () => submit({ answer: index }); answers.appendChild(button);
          });
          if (next.game === 'math') {
            challenge.querySelector('strong')!.textContent = next.challenge?.question || '';
            challenge.querySelector('small')!.textContent = '계산하고, 하나만 선택하세요';
          }
        }
        buttons.forEach(button => button.classList.remove('selected'));
        open();
      }
      if (next.submitted) {
        clearPending();
        const selection = next.choice ? hands[next.choice] : (next.answer != null ? next.challenge?.options[next.answer] : undefined);
        message.textContent = `${selection || '답'} 선택 완료. 결과 발표를 기다리세요.`;
        buttons.forEach(button => button.classList.toggle('selected', button.dataset.survivalChoice === next.choice));
        answers.querySelectorAll('button').forEach(button => button.classList.toggle('selected', Number(button.dataset.answer) === next.answer));
      } else if (isNewRound || priorRoundId !== next.roundId) message.textContent = '선택은 단 한 번. 제한 시간 안에 결정하세요.';
    } else {
      clearPending();
      // Reconnecting after the deadline can skip the result notification.
      if (wasPlaying && !showingResult) dialog.close();
    }
    tick();
  }
  function accepted(data: { roundId: string; choice?: SurvivalChoice; answer?: number; requestId: string }) {
    if (!state || data.roundId !== state.roundId) return;
    clearPending();
    setState({ ...state, submitted: true, choice: data.choice, answer: data.answer });
  }
  function error(requestId: string | undefined, text: string): boolean {
    if (!requestId || requestId !== pendingId) return false;
    clearPending(); message.textContent = text; tick(); return true;
  }
  function showResult(result: SurvivalResult) {
    clearPending();
    state = { phase: 'waiting', roundId: null, nextRoundAt: result.nextRoundAt, deadline: null, submitted: false, game: null, nextGame: null };
    options.onActive(false);
    options.onChase(null);
    showingResult = true;
    const lost = ['lose', 'wrong', 'timeout', 'caught'].includes(result.outcome);
    dialog.classList.toggle('survived', !lost);
    dialog.classList.toggle('lost', lost);
    dialog.querySelector('#survival-title')!.textContent = lost ? (result.breadShuttle ? '0원. 빵셔틀 당첨!' : `시험 실패. −${result.penalty.toLocaleString('ko-KR')}원`) : result.outcome === 'draw' ? '무승부. 잔액을 지켰다.' : '시험 통과. 잔액을 지켰다!';
    dialog.querySelector('.survival-symbol')!.textContent = result.breadShuttle ? '🍞' : lost ? '×' : '◈';
    dialog.querySelector<HTMLElement>('.survival-explanation')!.hidden = true;
    dialog.querySelector<HTMLElement>('.survival-options')!.hidden = true;
    dialog.querySelector<HTMLElement>('.survival-progress')!.hidden = true;
    answers.hidden = true; challenge.hidden = true;
    timeLabel.textContent = result.game === 'rps' ? '트럼프쌤의 선택' : '정답';
    time.textContent = result.npcChoice ? hands[result.npcChoice] : result.correctLabel || '정답';
    message.textContent = lost ? (result.breadShuttle ? '머리와 가방에 빵이 가득! 용돈을 다시 벌면 칭호와 빵이 사라져요. 계속 교실에 머물 수 있어요.' : `${result.outcome === 'timeout' ? '시간을 놓쳤어요.' : '이번 시험은 실패했어요.'} ${result.penalty.toLocaleString('ko-KR')}원이 차감됐어요. 다음에는 잔액을 지켜봐요.`) : '이번 시험에서는 돈을 잃지 않았어요. 다음 시험은 다시 무작위로 정해져요.';
    if (result.game === 'chase') {
      dialog.querySelector('#survival-title')!.textContent = result.outcome === 'robber' ? '강도 추격전 종료!' : lost ? (result.breadShuttle ? '잡혔어요. 0원, 빵셔틀 당첨!' : '잡혔지만, 다음 기회가 있어요.') : '도망 성공! 용돈을 지켰다.';
      dialog.querySelector('.survival-symbol')!.textContent = result.breadShuttle ? '🍞' : result.outcome === 'robber' ? '◈' : lost ? '×' : '✓';
      timeLabel.textContent = '이번 추격전 차감';
      time.textContent = `${result.penalty ? '−' : ''}${result.penalty.toLocaleString('ko-KR')}원`;
      message.textContent = result.outcome === 'robber' ? '강도 역할이 끝났어요. 잡힌 친구의 돈만 차감되며 강도에게 지급되는 돈은 없어요.' : lost ? `잡혔을 때 ${result.penalty.toLocaleString('ko-KR')}원이 차감됐어요. 추가 차감이나 강퇴는 없어요.${result.breadShuttle ? ' 돈을 다시 벌면 빵셔틀 모습이 해제돼요.' : ''}` : '30초 동안 강도를 피해 살아남았어요. 이번 판에서는 돈을 잃지 않았어요.';
    }
    done.hidden = false;
    open(); tick();
  }
  function reset() { clearPending(); state = null; showingResult = false; chip.hidden = true; dialog.close(); options.onActive(false); options.onChase(null); }
  return { setState, accepted, error, showResult, tick, reset };
}
