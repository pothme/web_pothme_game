import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, createAccount, applyCommand } from '../server/domain';
import { applySurvivalPenalty, beginSurvival, initialSurvival, settleSurvival, submitSurvival, survivalView, type SurvivalState } from '../server/survival';

const start = 1_000_000;
const waiting = (): SurvivalState => ({ ...initialSurvival(), nextRoundAt: start });
const startRound = (ids = ['student-a', 'student-b', 'student-c', 'student-d']) => beginSurvival(waiting(), ids, start, 'round-example', () => 0);
const submit = (state: SurvivalState, id: string, choice: string, now = start) => submitSurvival(state, id, { type: 'survival-choice', roundId: state.round!.id, requestId: `request-${id}`, choice }, now).state;

test('round starts at the server deadline and gives 20 seconds without leaking private hands', () => {
  const ready = waiting();
  assert.equal(beginSurvival(ready, ['student-a'], start - 1), ready);
  const state = startRound();
  assert.equal(state.round!.startedAt, start);
  assert.equal(state.round!.deadline, start + 20_000);
  assert.equal(state.nextRoundAt, start + 120_000, 'round cadence is start-to-start');
  const view = survivalView(state, 'student-a', start);
  assert.equal(view.game, 'rps');
  assert.equal(view.nextGame, null);
  assert.equal('npcChoice' in view, false);
  assert.equal('participants' in view, false);
});

test('win/draw preserve money; lose/timeout incur the nominal 1,000 penalty with no elimination field', () => {
  let state = startRound();
  state = submit(state, 'student-a', 'paper');
  state = submit(state, 'student-b', 'rock');
  state = submit(state, 'student-c', 'scissors');
  assert.equal(settleSurvival(state, ['student-a'], start + 19_999), state);
  const ended = settleSurvival(state, ['student-a', 'student-b', 'student-c', 'student-d'], start + 20_000);
  assert.equal(ended.round, null);
  assert.deepEqual(Object.values(ended.lastRound!.results).map((result) => [result.outcome, result.nominalPenalty]), [['win', 0], ['draw', 0], ['lose', 1000], ['timeout', 1000]]);
  assert.ok(Object.values(ended.lastRound!.results).every((result) => !('kicked' in result)));
  assert.equal(ended.nextRoundAt, start + 120_000);
  assert.equal(settleSurvival(ended, ['student-a'], start + 25_000), ended, 'duplicate settlement is inert');
});

test('penalties clamp balances at zero; zero enables bread shuttle and a normal cash-RPS win removes it', () => {
  const ended = settleSurvival(startRound(), ['student-a'], start + 20_000);
  const result = ended.lastRound!.results['student-a']!;
  for (const [balance, deducted, next] of [[5000, 1000, 4000], [500, 500, 0], [0, 0, 0]]) {
    const account = { ...createAccount('student-a', '학생이'), balance: balance!, nextPlayAt: 123 };
    const settled = applySurvivalPenalty(account, result);
    assert.equal(settled.penalty, deducted);
    assert.equal(settled.me.balance, next);
    assert.equal(settled.breadShuttle, next === 0);
    assert.equal(settled.me.nextPlayAt, 123, 'scheduled round does not consume cash-RPS cooldown');
  }
  const zero = applySurvivalPenalty({ ...createAccount('student-a', '학생이'), balance: 500 }, result).me;
  const recovered = applyCommand(zero, [], { type: 'rps', choice: 'paper', requestId: 'cash-rps-win' }, start, 'rock', 'entry-none');
  assert.equal(recovered.account.balance, 1000);
  assert.equal(recovered.account.breadShuttle, false);
});

test('submission is immutable, identity-bound, idempotent and rejected exactly at deadline', () => {
  const active = startRound();
  const input = { roundId: active.round!.id, requestId: 'request-first', choice: 'paper' };
  const accepted = submitSurvival(active, 'student-a', input, start);
  assert.equal(submitSurvival(accepted.state, 'student-a', input, start + 1).replayed, true);
  assert.throws(() => submitSurvival(accepted.state, 'student-a', { ...input, choice: 'rock' }, start + 1), { code: 'REQUEST_REUSED' });
  assert.throws(() => submitSurvival(accepted.state, 'student-a', { ...input, requestId: 'requestId-new' }, start + 1), { code: 'ALREADY_SUBMITTED' });
  assert.throws(() => submitSurvival(active, 'intruder', input, start), { code: 'NOT_PARTICIPANT' });
  assert.throws(() => submitSurvival(active, 'student-a', { ...input, roundId: 'wrong-round' }, start), { code: 'WRONG_ROUND' });
  assert.throws(() => submitSurvival(active, 'student-a', input, start + 20_000), { code: 'ROUND_CLOSED' });
  assert.equal(survivalView(accepted.state, 'student-a', start + 1).choice, 'paper');
  assert.equal(survivalView(accepted.state, 'student-b', start + 1).choice, undefined);
});

test('late arrivals get a waiting view and disconnected existing participants retain timeout liability', () => {
  const state = startRound();
  const late = survivalView(state, 'late-visitor', start);
  assert.equal(late.phase, 'waiting');
  assert.equal(late.game, null);
  assert.equal(late.roundId, null);
  assert.equal(late.nextRoundAt, start + 120_000);
  const ended = settleSurvival(state, [], start + 20_000);
  assert.equal(ended.lastRound!.results['student-a']!.outcome, 'timeout');
  assert.equal(ended.nextRoundAt, null);
  assert.equal(ended.lastRound!.results['late-visitor'], undefined);
});

test('each person independently receives a private random game; memory hides at five seconds', () => {
  const randomValues = [0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0];
  const state = beginSurvival(waiting(), ['rps-player', 'memory-player', 'math-player'], start, 'mixed-round', (max) => (randomValues.shift() ?? 0) % max);
  assert.deepEqual(Object.values(state.round!.participants).map((player) => player.game), ['rps', 'memory', 'math']);
  assert.equal(survivalView(state, 'rps-player', start).challenge, undefined);
  const memory = state.round!.participants['memory-player']!;
  assert.ok(survivalView(state, 'memory-player', start + 4_999).challenge!.sequence);
  const hidden = survivalView(state, 'memory-player', start + 5_000);
  assert.equal(hidden.challenge!.sequence, undefined);
  assert.equal('correctAnswer' in hidden.challenge!, false);
  assert.equal(new Set(hidden.challenge!.options).size, 4);
  const input = { roundId: state.round!.id, requestId: 'memory-request', answer: memory.challenge!.correctAnswer };
  assert.throws(() => submitSurvival(state, 'memory-player', input, start + 4_999), { code: 'MEMORIZE', retryAt: start + 5_000 });
  const answered = submitSurvival(state, 'memory-player', input, start + 5_000).state;
  assert.equal(answered.round!.participants['rps-player']!.requestId, undefined);
  assert.equal(answered.round!.participants['math-player']!.requestId, undefined);
  const ended = settleSurvival(answered, ['memory-player'], start + 20_000);
  assert.equal(ended.lastRound!.results['memory-player']!.outcome, 'correct');
  assert.equal(ended.lastRound!.results['memory-player']!.nominalPenalty, 0);
  assert.match(survivalView(state, 'math-player', start).challenge!.question!, /^\d+ [+−] \d+ = \?$/);
});

test('invalid quiz indices fail; wrong costs money; late alarm schedules one future round without catch-up', () => {
  let first = true;
  const state = beginSurvival(waiting(), ['student-a'], start, 'math-round', () => { if (first) { first = false; return 2; } return 0; });
  for (const answer of [-1, 4, 1.5, '0', null, Infinity]) {
    assert.throws(() => submitSurvival(state, 'student-a', { roundId: state.round!.id, requestId: 'quiz-invalid', answer }, start), { code: 'INVALID_ANSWER' });
  }
  const accepted = submitSurvival(state, 'student-a', { roundId: state.round!.id, requestId: 'quiz-wrong', answer: 1 }, start).state;
  const late = start + 1_000_000;
  const ended = settleSurvival(accepted, ['student-a'], late);
  assert.equal(ended.lastRound!.results['student-a']!.outcome, 'wrong');
  assert.equal(ended.lastRound!.results['student-a']!.nominalPenalty, 1000);
  assert.equal(ended.nextRoundAt, late + RULES.survivalIntervalMs);
  const empty = beginSurvival(waiting(), [], start);
  assert.equal(empty.round, null);
  assert.equal(empty.nextRoundAt, null);
});
