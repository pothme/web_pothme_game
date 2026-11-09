import assert from 'node:assert/strict';
import test from 'node:test';
import { gameChoiceSubmission, reconcileGameChoiceDraft, type GameChoiceDraft } from '../src/game-choice-state';
import type { GameRoomView } from '../shared/game-room';

type ChoiceRoom = Parameters<typeof reconcileGameChoiceDraft>[0];
function room(overrides: Partial<ChoiceRoom> = {}): ChoiceRoom {
  return { id: 'table-a', matchId: 'match-1', kind: 'blind-auction', round: 1, phase: 'playing', myChoice: null,
    players: [{ id: 'self', nickname: '나', bot: false, connected: true, ready: true, submitted: false, team: null, score: 0, chips: 18, solved: false, forfeited: false }], ...overrides };
}
const selected: GameChoiceDraft = { key: 'table-a:match-1:1', bid: 5, vault: 'steal', cipher: [6, 5, 4] };

test('a new match or round discards the previous secret draft', () => {
  const next = room({ matchId: 'match-2' });
  const draft = reconcileGameChoiceDraft(next, selected, 'self');
  assert.deepEqual(draft, { key: 'table-a:match-2:1', bid: 0, vault: 'invest', cipher: [1, 2, 3] });
  assert.equal(gameChoiceSubmission(next, selected, 'self'), null);
  assert.equal(gameChoiceSubmission(room({ round: 2 }), selected, 'self'), null);
});

test('reconnecting restores an acknowledged bid even after its chips were spent', () => {
  const received = room({ myChoice: 6 }); received.players[0].chips = 0; received.players[0].submitted = true;
  assert.equal(reconcileGameChoiceDraft(received, selected, 'self').bid, 6);
  assert.equal(gameChoiceSubmission(received, selected, 'self'), null);
});

test('acknowledged private code is restored without sharing mutable arrays', () => {
  const received = room({ kind: 'cipher-race', myChoice: [2, 4, 6] });
  const draft = reconcileGameChoiceDraft(received, selected, 'self');
  assert.deepEqual(draft.cipher, [2, 4, 6]);
  draft.cipher[0] = 1;
  assert.deepEqual(received.myChoice, [2, 4, 6]);
});

test('submissions bind to the current table, match and round and copy the code', () => {
  const received = room({ kind: 'cipher-race' });
  const draft = reconcileGameChoiceDraft(received, selected, 'self');
  const submission = gameChoiceSubmission(received, draft, 'self');
  assert.deepEqual(submission, { roomId: 'table-a', matchId: 'match-1', round: 1, choice: [6, 5, 4] });
  draft.cipher[0] = 2;
  assert.deepEqual(submission?.choice, [6, 5, 4]);
});

test('a spectator, disconnected player, completed choice or finished round cannot submit', () => {
  assert.equal(gameChoiceSubmission(room(), selected, 'missing'), null);
  for (const flag of ['forfeited', 'solved', 'submitted'] as const) {
    const received = room(); received.players[0][flag] = true;
    assert.equal(gameChoiceSubmission(received, selected, 'self'), null);
  }
  const disconnected = room(); disconnected.players[0].connected = false;
  assert.equal(gameChoiceSubmission(disconnected, selected, 'self'), null);
  for (const phase of ['waiting', 'reveal', 'finished'] as GameRoomView['phase'][]) assert.equal(gameChoiceSubmission(room({ phase }), selected, 'self'), null);
});

test('invalid cipher and over-budget bids cannot leave the frontend', () => {
  for (const cipher of [[1, 1, 2], [0, 1, 2], [1, 2, 7], [1, 2], [1, 2, 3.5]]) assert.equal(gameChoiceSubmission(room({ kind: 'cipher-race' }), { ...selected, cipher }, 'self'), null);
  const received = room(); received.players[0].chips = 4;
  assert.equal(gameChoiceSubmission(received, selected, 'self'), null);
  assert.equal(reconcileGameChoiceDraft(received, selected, 'self').bid, 4);
  assert.equal(gameChoiceSubmission(received, { ...selected, bid: 0 }, 'self')?.choice, 0);
});
