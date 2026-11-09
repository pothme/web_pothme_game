import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, GameError, applyCommand, canJoin, createAccount, outcomeFor, parseCommand, validateNickname, validatePosition, type BoardEntry, type Choice } from '../server/domain';
import { RECEIPT_LIMIT, rememberReceipt, type Receipt } from '../server/receipts';

const now = 1_000_000;
const account = () => createAccount('player-test', '포듬학생');
const entry: BoardEntry = { id: 'entry-existing', text: '안녕하세요', author: '다른학생', color: '#fff' };

test('new identity receives exactly the configured 5,000 starting balance', () => {
  assert.equal(account().balance, 5000);
  assert.equal(account().nextPlayAt, 0);
});

test('all nine RPS combinations have the expected unbiased game outcome', () => {
  const choices: Choice[] = ['rock', 'paper', 'scissors'];
  const outcomes = choices.flatMap((player) => choices.map((npc) => outcomeFor(player, npc)));
  assert.equal(outcomes.filter((value) => value === 'win').length, 3);
  assert.equal(outcomes.filter((value) => value === 'draw').length, 3);
  assert.equal(outcomes.filter((value) => value === 'lose').length, 3);
  assert.equal(outcomeFor('rock', 'scissors'), 'win');
});

test('winning awards 1,000; ties and losses cost nothing; all consume cooldown', () => {
  for (const [npc, balance] of [['scissors', 6000], ['rock', 5000], ['paper', 5000]] as const) {
    const before = account();
    const result = applyCommand(before, [], { type: 'rps', choice: 'rock', requestId: 'request-1' }, now, npc, 'entry-new');
    assert.equal(result.account.balance, balance);
    assert.equal(result.account.nextPlayAt, now + 60_000);
    assert.equal(before.balance, 5000, 'input state remains unchanged');
    assert.throws(() => applyCommand(result.account, [], { type: 'rps', choice: 'rock', requestId: 'request-2' }, now + 59_999, npc, 'entry-new'), (error: unknown) => error instanceof GameError && error.code === 'COOLDOWN' && error.retryAt === now + 60_000);
    assert.doesNotThrow(() => applyCommand(result.account, [], { type: 'rps', choice: 'rock', requestId: 'request-2' }, now + 60_000, npc, 'entry-new'));
  }
});

test('writing debits 5,000 once and failed second write does not mutate state', () => {
  const written = applyCommand(account(), [], { type: 'write', text: '오늘도 좋은 하루', requestId: 'request-1' }, now, 'rock', 'entry-new');
  assert.equal(written.account.balance, 0);
  assert.equal(written.board[0]?.text, '오늘도 좋은 하루');
  assert.throws(() => applyCommand(written.account, written.board, { type: 'write', text: '추가 글', requestId: 'request-2' }, now, 'rock', 'entry-new2'), { code: 'INSUFFICIENT_FUNDS' });
  assert.equal(written.board.length, 1);
  assert.equal(written.account.balance, 0);
});

test('erasing another student’s selected entry costs 1,000 and preserves other entries', () => {
  const second = { ...entry, id: 'entry-second' };
  const erased = applyCommand(account(), [entry, second], { type: 'erase', entryId: entry.id, requestId: 'request-1' }, now, 'rock', 'entry-new');
  assert.equal(erased.account.balance, 4000);
  assert.deepEqual(erased.board, [second]);
  assert.throws(() => applyCommand(erased.account, erased.board, { type: 'erase', entryId: entry.id, requestId: 'request-2' }, now, 'rock', 'entry-new'), { code: 'ENTRY_NOT_FOUND' });
  assert.equal(erased.account.balance, 4000);
});

test('board capacity and insufficient erase funds are enforced', () => {
  assert.throws(() => applyCommand(account(), Array.from({ length: RULES.maxBoardEntries }, (_, i) => ({ ...entry, id: `entry-${i}` })), { type: 'write', text: '넘침', requestId: 'request-1' }, now, 'rock', 'entry-new'), { code: 'BOARD_FULL' });
  assert.throws(() => applyCommand({ ...account(), balance: 999 }, [entry], { type: 'erase', entryId: entry.id, requestId: 'request-1' }, now, 'rock', 'entry-new'), { code: 'INSUFFICIENT_FUNDS' });
});

test('nickname boundaries, control characters and canonical duplicates are checked', () => {
  assert.equal(validateNickname('  포듬이  '), '포듬이');
  for (const invalid of ['', '가', '가'.repeat(13), '<script>', '학생\u202e이름', null]) assert.throws(() => validateNickname(invalid), { code: 'NICKNAME' });
  assert.throws(() => canJoin('new', 'student', [{ id: 'old', nickname: 'Student' }]), { code: 'NICKNAME_TAKEN' });
});

test('the fifty-first distinct visitor is rejected while an existing identity can reconnect', () => {
  const online = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, nickname: `학생${i}` }));
  assert.throws(() => canJoin('id-new', '새학생', online), { code: 'ROOM_FULL' });
  assert.doesNotThrow(() => canJoin('id-0', '새이름', online));
});

test('commands reject forged fields, oversized text, invalid choices and controls', () => {
  assert.deepEqual(parseCommand({ type: 'rps', choice: 'rock', requestId: 'request-1', balance: 999999, outcome: 'win' }), { type: 'rps', choice: 'rock', requestId: 'request-1' });
  for (const input of [null, [], { type: 'rps', choice: 'gun', requestId: 'request-1' }, { type: 'write', text: '가'.repeat(51), requestId: 'request-1' }, { type: 'write', text: '줄\n바꿈', requestId: 'request-1' }, { type: 'erase', entryId: 'invalid', requestId: 'request-1' }, { type: 'write', text: '좋은 날', requestId: '' }]) assert.throws(() => parseCommand(input));
  assert.equal(parseCommand({ type: 'write', text: '가'.repeat(50), requestId: 'request-1' }).type, 'write');
});

test('positions reject non-numeric values and clamp outside the room', () => {
  assert.deepEqual(validatePosition(900, -900), { x: 6, z: -4.5 });
  for (const invalid of [NaN, Infinity, '5', null]) assert.throws(() => validatePosition(invalid, 0), { code: 'POSITION' });
});

test('retry protection retains the latest 64 successful actions and explicitly evicts older ones', () => {
  let receipts: Receipt[] = [];
  for (let index = 0; index < 100; index++) {
    receipts = rememberReceipt(receipts, { requestId: `request-${index}`, signature: `payload-${index}`, response: { outcome: 'win' } });
    assert.ok(receipts.length <= RECEIPT_LIMIT);
  }
  assert.equal(receipts.length, 64);
  assert.equal(receipts[0]?.requestId, 'request-36');
  assert.equal(receipts[63]?.requestId, 'request-99');
  assert.equal(receipts.some((receipt) => receipt.requestId === 'request-35'), false, 'evicted IDs have no permanent replay guarantee');
});
