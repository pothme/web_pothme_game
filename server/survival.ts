import { GameError, RULES, outcomeFor, type Account, type Choice } from './domain';
import { CHASE_RULES, nearestWalkable } from '../shared/classroom-layout';
import type { ChasePublic, ChaseRound } from './chase';

export type SurvivalGame = 'rps' | 'memory' | 'math' | 'chase';
export type SurvivalOutcome = 'win' | 'draw' | 'lose' | 'correct' | 'wrong' | 'timeout' | 'caught' | 'escaped' | 'robber';
export interface QuizChallenge { options: string[]; correctAnswer: number; sequence?: string; revealUntil?: number; question?: string }
export interface SurvivalParticipant {
  game: SurvivalGame;
  npcChoice?: Choice;
  challenge?: QuizChallenge;
  requestId?: string;
  choice?: Choice;
  answer?: number;
}
export interface SurvivalRound {
  id: string;
  number: number;
  startedAt: number;
  deadline: number;
  participants: Record<string, SurvivalParticipant>;
  chase?: ChaseRound;
}
export interface SurvivalResult {
  roundId: string;
  roundNumber: number;
  game: SurvivalGame;
  outcome: SurvivalOutcome;
  choice?: Choice;
  answer?: number;
  npcChoice?: Choice;
  correctAnswer?: number;
  correctLabel?: string;
  nominalPenalty: number;
  penalty?: number;
  me?: Account;
  breadShuttle?: boolean;
}
export interface SurvivalState {
  roundNumber: number;
  nextRoundAt: number | null;
  round: SurvivalRound | null;
  lastRound: { id: string; startedAt: number; finishedAt: number; results: Record<string, SurvivalResult> } | null;
}
export interface SurvivalPublicState {
  phase: 'waiting' | 'playing';
  roundId: string | null;
  nextRoundAt: number | null;
  deadline: number | null;
  submitted: boolean;
  roundNumber: number;
  nextRoundNumber: number;
  game: SurvivalGame | null;
  nextGame: 'chase' | null;
  chase?: ChasePublic;
  choice?: Choice;
  answer?: number;
  challenge?: { options: string[]; sequence?: string; revealUntil?: number; question?: string };
  lastOutcome?: SurvivalOutcome;
}

export function initialSurvival(): SurvivalState {
  return { roundNumber: 0, nextRoundAt: null, round: null, lastRound: null };
}

/** Upgrade an unreleased local preview's shared round into per-person tasks. */
export function normalizeSurvival(value: SurvivalState): SurvivalState {
  const roundNumber = Number.isSafeInteger(value.roundNumber) && value.roundNumber >= 0 ? value.roundNumber : value.round ? 1 : 0;
  const round = value.round as (SurvivalRound & { game?: SurvivalGame; npcChoice?: Choice; challenge?: QuizChallenge }) | null;
  if (!round?.game) return { ...value, roundNumber, ...(round ? { round: { ...round, number: round.number ?? roundNumber } } : {}) };
  const participants = Object.fromEntries(Object.entries(round.participants).map(([id, participant]) => [id, { ...participant, game: participant.game ?? round.game!, npcChoice: participant.npcChoice ?? round.npcChoice, challenge: participant.challenge ?? round.challenge }]));
  return { roundNumber, nextRoundAt: value.nextRoundAt, round: { id: round.id, number: roundNumber, startedAt: round.startedAt, deadline: round.deadline, participants }, lastRound: null };
}

export function randomInt(max: number): number {
  const ceiling = Math.floor(0x1_0000_0000 / max) * max;
  let value: number;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]!; } while (value >= ceiling);
  return value % max;
}

function challengeFor(game: SurvivalGame, now: number, random: (max: number) => number): QuizChallenge | undefined {
  if (game === 'rps') return undefined;
  const correctAnswer = random(4);
  if (game === 'memory') {
    const symbols = ['★', '●', '▲', '■', '◆', '♥'];
    const decode = (code: number) => [Math.floor(code / 36), Math.floor(code / 6) % 6, code % 6].map((index) => symbols[index]).join(' ');
    const correctCode = random(216);
    // Independent sequences avoid making the answer reconstructable by a fixed
    // per-position majority across the choices after the reveal disappears.
    const pool = Array.from({ length: 216 }, (_, code) => code).filter((code) => code !== correctCode);
    const sequence = decode(correctCode);
    const options = Array.from({ length: 4 }, (_, index) => index === correctAnswer ? sequence : decode(pool.splice(random(pool.length), 1)[0]!));
    return { options, correctAnswer, sequence, revealUntil: now + RULES.survivalRevealMs };
  }
  const a = 12 + random(19);
  const b = 2 + random(10);
  const plus = random(2) === 0;
  const answer = plus ? a + b : a - b;
  const offsets = [-3, -1, 2];
  const options = Array.from({ length: 4 }, (_, index) => String(index === correctAnswer ? answer : answer + offsets[index < correctAnswer ? index : index - 1]!));
  return { options, correctAnswer, question: `${a} ${plus ? '+' : '−'} ${b} = ?` };
}

export function beginSurvival(state: SurvivalState, ids: string[], now: number, id = crypto.randomUUID(), random = randomInt, positions: Record<string, { x: number; z: number; nickname: string; color?: number; breadShuttle?: boolean }> = {}): SurvivalState {
  if (state.round || state.nextRoundAt === null || now < state.nextRoundAt) return state;
  if (!ids.length) return { ...state, nextRoundAt: null };
  const number = state.roundNumber + 1;
  if (number % 3 === 0 && ids.length >= 2) {
    const robberId = ids[random(ids.length)]!;
    const startsAt = now + CHASE_RULES.prepMs, endsAt = startsAt + CHASE_RULES.durationMs;
    const chase: ChaseRound = {
      robberId, robberName: positions[robberId]?.nickname ?? '강도', startsAt, endsAt,
      positions: Object.fromEntries(ids.map((playerId) => [playerId, { ...nearestWalkable(positions[playerId]?.x ?? 5, positions[playerId]?.z ?? 4.5), updatedAt: now }])),
      profiles: Object.fromEntries(ids.map((playerId) => [playerId, { nickname: positions[playerId]?.nickname ?? '학생', color: positions[playerId]?.color ?? 0x688571, breadShuttle: positions[playerId]?.breadShuttle ?? false }])),
      caught: {},
    };
    return { ...state, roundNumber: number, nextRoundAt: now + RULES.survivalIntervalMs, round: { id, number, startedAt: now, deadline: endsAt, participants: Object.fromEntries(ids.map((playerId) => [playerId, { game: 'chase' as const }])), chase } };
  }
  const participants = Object.fromEntries(ids.map((playerId) => {
    const game = (['rps', 'memory', 'math'] as const)[random(3)]!;
    const participant: SurvivalParticipant = { game, ...(game === 'rps' ? { npcChoice: (['rock', 'paper', 'scissors'] as const)[random(3)]! } : { challenge: challengeFor(game, now, random)! }) };
    return [playerId, participant];
  }));
  return { ...state, roundNumber: number, nextRoundAt: now + RULES.survivalIntervalMs, round: { id, number, startedAt: now, deadline: now + RULES.survivalDurationMs, participants } };
}

export function survivalView(state: SurvivalState, id: string, now: number): SurvivalPublicState {
  const round = state.round;
  const player = round?.participants[id];
  const challenge = player?.challenge;
  return {
    phase: player ? 'playing' : 'waiting',
    roundId: player ? round!.id : null,
    nextRoundAt: state.nextRoundAt,
    deadline: player ? round!.deadline : null,
    submitted: Boolean(player?.requestId),
    roundNumber: state.roundNumber,
    nextRoundNumber: state.roundNumber + 1,
    game: player?.game ?? null,
    nextGame: (state.roundNumber + 1) % 3 === 0 ? 'chase' : null,
    ...(round?.chase ? { chase: { roundId: round.id, robberId: round.chase.robberId, robberName: round.chase.robberName, startsAt: round.chase.startsAt, endsAt: round.chase.endsAt, role: !player ? 'spectator' as const : round.chase.robberId === id ? 'robber' as const : 'runner' as const, caughtIds: Object.keys(round.chase.caught), participantCount: Object.keys(round.participants).length } } : {}),
    ...(player?.choice ? { choice: player.choice } : {}),
    ...(player?.answer !== undefined ? { answer: player.answer } : {}),
    ...(challenge ? { challenge: {
      options: [...challenge.options],
      ...(challenge.question ? { question: challenge.question } : {}),
      ...(challenge.revealUntil !== undefined ? { revealUntil: challenge.revealUntil } : {}),
      ...(challenge.sequence && now < challenge.revealUntil! ? { sequence: challenge.sequence } : {}),
    } } : {}),
    ...(state.lastRound?.results[id] ? { lastOutcome: state.lastRound.results[id]!.outcome } : {}),
  };
}

export function submitSurvival(state: SurvivalState, id: string, input: Record<string, unknown>, now: number) {
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)) throw new GameError('INVALID', '요청 번호를 확인해 주세요.');
  const round = state.round;
  if (!round || now >= round.deadline) throw new GameError('ROUND_CLOSED', '이번 시험의 제출 시간이 끝났어요.');
  if (input.roundId !== round.id) throw new GameError('WRONG_ROUND', '현재 진행 중인 시험에 답해 주세요.');
  const existing = round.participants[id];
  if (!existing) throw new GameError('NOT_PARTICIPANT', '다음 시험부터 참가할 수 있어요.');
  if (existing.game === 'chase') throw new GameError('CHASE_MOVE', '추격전에서는 이동해서 피하거나 잡아 주세요.');
  let submission: { requestId: string; choice?: Choice; answer?: number };
  if (existing.game === 'rps') {
    if (input.choice !== 'rock' && input.choice !== 'paper' && input.choice !== 'scissors') throw new GameError('INVALID_CHOICE', '가위, 바위, 보 중 하나를 골라 주세요.');
    submission = { requestId: input.requestId, choice: input.choice };
  } else {
    if (existing.game === 'memory' && now < existing.challenge!.revealUntil!) throw new GameError('MEMORIZE', '아직 암기 시간이에요. 기호가 사라지면 답을 골라 주세요.', existing.challenge!.revealUntil);
    if (!Number.isInteger(input.answer) || (input.answer as number) < 0 || (input.answer as number) > 3) throw new GameError('INVALID_ANSWER', '보기 네 개 중 하나를 골라 주세요.');
    submission = { requestId: input.requestId, answer: input.answer as number };
  }
  if (existing.requestId) {
    if (existing.requestId !== submission.requestId) throw new GameError('ALREADY_SUBMITTED', '이미 제출했어요. 답은 바꿀 수 없어요.');
    if (existing.choice !== submission.choice || existing.answer !== submission.answer) throw new GameError('REQUEST_REUSED', '이미 제출한 요청의 답을 바꿀 수 없어요.');
    return { state, response: { type: 'survival-accepted' as const, roundId: round.id, ...submission, replayed: true }, replayed: true };
  }
  const next = { ...state, round: { ...round, participants: { ...round.participants, [id]: { ...existing, ...submission } } } };
  return { state: next, response: { type: 'survival-accepted' as const, roundId: round.id, ...submission }, replayed: false };
}

export function settleSurvival(state: SurvivalState, onlineIds: string[], now: number): SurvivalState {
  const round = state.round;
  if (!round || now < round.deadline) return state;
  const results: Record<string, SurvivalResult> = {};
  for (const [id, player] of Object.entries(round.participants)) {
    if (player.game === 'chase') {
      const captured = round.chase!.caught[id];
      results[id] = { roundId: round.id, roundNumber: round.number, game: 'chase', outcome: id === round.chase!.robberId ? 'robber' : captured ? 'caught' : 'escaped', nominalPenalty: captured ? CHASE_RULES.penalty : 0, penalty: captured?.penalty ?? 0 };
      continue;
    }
    const outcome: SurvivalOutcome = !player.requestId ? 'timeout' : player.game === 'rps' ? outcomeFor(player.choice!, player.npcChoice!) : player.answer === player.challenge!.correctAnswer ? 'correct' : 'wrong';
    results[id] = {
      roundId: round.id, roundNumber: round.number, game: player.game, outcome,
      ...(player.choice ? { choice: player.choice } : {}),
      ...(player.answer !== undefined ? { answer: player.answer } : {}),
      ...(player.game === 'rps' ? { npcChoice: player.npcChoice! } : { correctAnswer: player.challenge!.correctAnswer, correctLabel: player.challenge!.options[player.challenge!.correctAnswer]! }),
      nominalPenalty: outcome === 'lose' || outcome === 'wrong' || outcome === 'timeout' ? 1000 : 0,
    };
  }
  const nextRoundAt = onlineIds.length ? (round.startedAt + RULES.survivalIntervalMs > now ? round.startedAt + RULES.survivalIntervalMs : now + RULES.survivalIntervalMs) : null;
  return { roundNumber: state.roundNumber, round: null, nextRoundAt, lastRound: { id: round.id, startedAt: round.startedAt, finishedAt: now, results } };
}

export function applySurvivalPenalty(account: Account, result: SurvivalResult): SurvivalResult & { penalty: number; me: Account; breadShuttle: boolean } {
  const penalty = Math.min(account.balance, result.nominalPenalty);
  const balance = account.balance - penalty;
  const me = { ...account, balance, breadShuttle: balance === 0 };
  return { ...result, penalty, me, breadShuttle: me.breadShuttle };
}
