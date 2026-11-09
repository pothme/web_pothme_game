import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChat, classroomSeat } from '../server/social';
import { SEATS, SOFAS, LOUNGE_TABLES, isWalkable } from '../shared/classroom-layout';

test('chat normalizes controls and spacing, and counts Unicode characters rather than UTF-16 units', () => {
  assert.equal(normalizeChat('  안녕\n\t친구\u0000  '), '안녕 친구');
  assert.equal(normalizeChat('e\u0301'), 'é');
  assert.equal(normalizeChat('😀'.repeat(80)), '😀'.repeat(80));
  for (const text of ['', '\u0000 \t\n', '가'.repeat(81), '😀'.repeat(81), null, 123, {}]) assert.throws(() => normalizeChat(text), { code: 'CHAT_TEXT' });
  assert.equal(normalizeChat('<img src=x>'), '<img src=x>', 'text stays plain content for textContent rendering');
});

test('all sofa and table-chair ids remain sequential with safe standing positions', () => {
  assert.equal(SEATS.length, 56);
  for (const [index, seat] of SEATS.entries()) {
    assert.equal(seat.id, index);
    if (seat.kind === 'sofa') {
      assert.ok(seat.sofaId !== undefined && SOFAS.some(sofa => sofa.id === seat.sofaId));
      assert.ok(Math.abs(seat.x - SOFAS[seat.sofaId!].x) < SOFAS[seat.sofaId!].width / 2);
      assert.equal(seat.standX, seat.x); assert.ok(seat.standZ < seat.z);
    } else assert.ok(seat.tableId !== undefined && LOUNGE_TABLES.some(table => table.id === seat.tableId));
    assert.ok(isWalkable(seat.standX, seat.standZ));
    assert.deepEqual(classroomSeat(index), seat);
  }
  for (const sofa of SOFAS) assert.equal(SEATS.filter(seat => seat.kind === 'sofa' && seat.sofaId === sofa.id).length, 4);
  for (const table of LOUNGE_TABLES) assert.equal(SEATS.filter(seat => seat.kind === 'chair' && seat.tableId === table.id).length, 4);
  for (const invalid of [-1, SEATS.length, 1.5, '0', null, Infinity, NaN]) assert.throws(() => classroomSeat(invalid), { code: 'SEAT_INVALID' });
});
