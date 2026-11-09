import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginSurvival, initialSurvival, normalizeSurvival, settleSurvival, submitSurvival, survivalView, type SurvivalState } from '../server/survival';
import { acceptedChaseMove, touchesPath } from '../server/chase';
import { CHASE_RULES, SOFAS, ROOM_BOUNDS, isWalkable, isWalkableSegment } from '../shared/classroom-layout';

test('every third global round is a chase; counter and 120-second cadence survive serialization', () => {
  let state: SurvivalState = { ...initialSurvival(), nextRoundAt: 1000 };
  for (let number = 1; number <= 6; number++) {
    const started = state.nextRoundAt!;
    state = beginSurvival(state, ['one', 'two'], started, `round-${number}`, () => 0, { one: { x: 5, z: 0, nickname: '강도학생' }, two: { x: 5, z: 4, nickname: '달리는학생' } });
    assert.equal(state.roundNumber, number);
    assert.equal(Boolean(state.round!.chase), number % 3 === 0);
    assert.equal(state.nextRoundAt, started + 120_000);
    if (state.round!.chase) {
      assert.equal(state.round!.chase.robberId, 'one');
      assert.equal(state.round!.chase.startsAt, started + 3000);
      assert.equal(state.round!.deadline, started + 33_000);
      assert.equal(survivalView(state, 'one', started).chase!.role, 'robber');
      assert.equal(survivalView(state, 'two', started).chase!.role, 'runner');
      assert.equal(survivalView(state, 'late', started).chase!.role, 'spectator');
      assert.equal(survivalView(state, 'late', started).phase, 'waiting');
      assert.throws(() => submitSurvival(state, 'one', { requestId: 'not-a-quiz', roundId: state.round!.id, choice: 'rock' }, started), { code: 'CHASE_MOVE' });
    }
    state = normalizeSurvival(JSON.parse(JSON.stringify(state)));
    state = settleSurvival(state, ['one', 'two'], state.round!.deadline);
    assert.equal(state.roundNumber, number);
    assert.equal(survivalView(state, 'one', started).nextGame, (number + 1) % 3 === 0 ? 'chase' : null);
  }
});

test('a scheduled chase with one player falls back to an ordinary quiz but advances the global count', () => {
  const state = beginSurvival({ ...initialSurvival(), roundNumber: 2, nextRoundAt: 1000 }, ['solo'], 1000, 'solo-round', () => 0);
  assert.equal(state.roundNumber, 3);
  assert.equal(state.round!.chase, undefined);
  assert.equal(state.round!.participants.solo!.game, 'rps');
  assert.equal(state.round!.deadline, 21_000);
});

test('capture settlement reports the already-paid amount without granting money to the robber', () => {
  let state = beginSurvival({ ...initialSurvival(), roundNumber: 2, nextRoundAt: 1000 }, ['one', 'two'], 1000, 'capture-round', () => 0);
  state.round!.chase!.caught.two = { caughtAt: 5000, penalty: 500 };
  state = settleSurvival(state, ['one', 'two'], state.round!.deadline);
  assert.equal(state.lastRound!.results.one!.outcome, 'robber');
  assert.equal(state.lastRound!.results.one!.penalty, 0);
  assert.equal(state.lastRound!.results.two!.outcome, 'caught');
  assert.equal(state.lastRound!.results.two!.nominalPenalty, 3000);
  assert.equal(state.lastRound!.results.two!.penalty, 500);
});

test('movement credit enforces speed, finite coordinates, room bounds and whole-path collision', () => {
  const previous = { x: 5, z: -3, at: 1000, credit: 0 };
  assert.ok(acceptedChaseMove(previous, 5, -2.3, 1250, false));
  assert.equal(acceptedChaseMove(previous, 5, -2.2, 1250, false), null);
  assert.ok(acceptedChaseMove(previous, 5, -2.2, 1250, true));
  for (const [x, z] of [[NaN, 0], [Infinity, 0], [ROOM_BOUNDS.maxX + 1, 0], [5, ROOM_BOUNDS.maxZ + 1], ['5', 0], [null, 0]]) assert.equal(acceptedChaseMove(previous, x, z, 10_000, true), null);
  assert.equal(acceptedChaseMove(previous, -5, 0, 999_999, true), null, 'idle time cannot accumulate a whole-room teleport');
  const sofa = SOFAS[1];
  assert.ok(isWalkable(sofa.x, sofa.z - 1.3));
  assert.ok(isWalkable(sofa.x, sofa.z + 1.3));
  assert.equal(isWalkableSegment(sofa.x, sofa.z - 1.3, sofa.x, sofa.z + 1.3), false);
  assert.equal(acceptedChaseMove({ x: sofa.x, z: sofa.z - 1.3, at: 1000, credit: 0 }, sofa.x, sofa.z + 1.3, 2000, true), null);
  assert.equal(isWalkable(Math.round((sofa.x - sofa.width / 2 - 0.25) * 100) / 100, sofa.z), true, 'quantized obstacle boundaries have consistent epsilon');
});

test('splitting a movement into packets never replenishes its travel credit without elapsed time', () => {
  let previous = { x: 5, z: -3, at: 1000, credit: 0 };
  let acceptedDistance = 0;
  for (let index = 0; index < 20; index++) {
    const next = acceptedChaseMove(previous, 5, previous.z + 0.3, 2000, false);
    if (!next) break;
    acceptedDistance += 0.3;
    previous = next;
  }
  assert.ok(acceptedDistance <= CHASE_RULES.runnerSpeed * CHASE_RULES.movementCreditMs / 1000 + 1e-8);
  assert.ok(touchesPath({ x: 5, z: -3 }, { x: 5, z: -2 }, { x: 5, z: -2.5 }));
  assert.equal(touchesPath({ x: 5, z: -3 }, { x: 5, z: -3 }, { x: 5, z: -2.34 }), false);
});
