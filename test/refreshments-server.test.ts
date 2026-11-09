import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { createHarness } from './harness.mjs';
import { identity, join, admin, login, origin, type Message } from './office-helpers';
import { MAP_LAYOUT_VERSION, REFRESHMENT_STATION, ROOM_SPAWN, SEATS, isWalkable } from '../shared/classroom-layout';
import { REFRESHMENT_RULES } from '../shared/refreshments';

const coffee = { drink: 'coffee', snack: 'cookie' }, juice = { drink: 'juice', snack: 'sandwich' };
const point = { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ };
const own = (players: Message[], id: string) => players.find(player => player.id === id)!;
async function tick(mf: Awaited<ReturnType<typeof createHarness>>['mf'], room: Awaited<ReturnType<typeof createHarness>>['room'], milliseconds = 1600) {
 const status = await mf.dispatchFetch(`${origin}/api/status`).then(r => r.json()) as Message; await room.testClock(status.serverTime + milliseconds, false);
}

test('refreshment selection is server-owned, validates proximity and keeps trays visible while walking and seated', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const a = await join(mf, await identity(mf), '음료동료'), b = await join(mf, await identity(mf), '옆자리동료'), id = a.welcome.me.id;
  const before = await room.testSnapshot(); assert.equal(own(a.welcome.players, id).refreshments, null);
  a.send({ type: 'refreshments', refreshments: coffee, requestId: 'far-forged-take', ...point, playerId: b.welcome.me.id });
  assert.equal((await a.wait(m => m.requestId === 'far-forged-take')).code, 'REFRESHMENTS_DISTANCE');
  await room.testPositions({ [id]: point });
  for (const [index, refreshments] of [undefined, {}, { drink: 'beer', snack: 'cookie' }, { drink: 'coffee', snack: 'unknown' }, { drink: null, snack: null }, { drink: 'coffee' }, [], false].entries()) {
   const requestId = `invalid-refreshments-${index}`; a.send({ type: 'refreshments', refreshments, requestId }); assert.equal((await a.wait(m => m.requestId === requestId)).code, 'REFRESHMENTS_INVALID');
  }
  await tick(mf, room);
  const take = { type: 'refreshments', refreshments: coffee, requestId: 'valid-coffee-take', playerId: b.welcome.me.id };
  a.send(take); const taken = await a.wait(m => m.requestId === take.requestId); assert.equal(taken.type, 'refreshments-state'); assert.deepEqual(taken.refreshments, coffee);
  const shown = await b.wait(m => m.type === 'players' && own(m.players, id)?.refreshments); assert.deepEqual(own(shown.players, id).refreshments, coffee); assert.equal(own(shown.players, b.welcome.me.id).refreshments, null);
  a.send(take); assert.deepEqual((await a.wait(m => m.requestId === take.requestId)).refreshments, coffee); assert.equal(b.messages.some(m => m.type === 'players' && own(m.players, id)?.refreshments), false);
  a.send({ type: 'refreshments', refreshments: null, requestId: 'too-fast-return' }); assert.equal((await a.wait(m => m.requestId === 'too-fast-return')).code, 'REFRESHMENTS_COOLDOWN');
  await tick(mf, room); a.send({ type: 'move', x: point.x + 0.5, z: point.z }); await b.wait(m => m.type === 'player-moved' && m.player.id === id);
  assert.deepEqual(own((await room.testSnapshot()).players, id).refreshments, coffee);
  a.send({ type: 'sit', seat: 15, requestId: 'tray-on-sofa' }); assert.equal((await a.wait(m => m.requestId === 'tray-on-sofa')).seat, 15);
  assert.deepEqual(own((await room.testSnapshot()).players, id).refreshments, coffee);
  a.send({ type: 'refreshments', refreshments: null, requestId: 'seated-return' }); assert.equal((await a.wait(m => m.requestId === 'seated-return')).refreshments, null);
  a.send({ type: 'refreshments', refreshments: coffee, requestId: 'seated-take' }); assert.equal((await a.wait(m => m.requestId === 'seated-take')).code, 'REFRESHMENTS_SEATED');
  await room.testPositions({ [id]: point }); await tick(mf, room); a.send({ type: 'refreshments', refreshments: null, requestId: 'valid-tray-return' }); assert.equal((await a.wait(m => m.requestId === 'valid-tray-return')).refreshments, null);
  const after = await room.testSnapshot(); assert.equal(own(after.players, id).refreshments, null); assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.office, before.office); assert.deepEqual(after.board, before.board); assert.equal(after.alarmAt, null);
 } finally { await mf.dispose(); }
});

test('put-away works away from the counter, broadcasts empty hands and late retries never erase a new selection', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const cookie = await identity(mf), a = await join(mf, cookie, '내려놓는동료'), b = await join(mf, await identity(mf), '빈손확인동료'), id = a.welcome.me.id;
  await room.testPositions({ [id]: point });
  a.send({ type: 'refreshments', refreshments: coffee, requestId: 'take-before-away' }); await a.wait(m => m.requestId === 'take-before-away');
  await room.testPositions({ [id]: ROOM_SPAWN }); await tick(mf, room);
  const clear = { type: 'refreshments', refreshments: null, requestId: 'clear-away-from-counter', playerId: b.welcome.me.id };
  a.send(clear); assert.equal((await a.wait(m => m.requestId === clear.requestId)).refreshments, null);
  const empty = await b.wait(m => m.type === 'players' && own(m.players, id)?.refreshments === null);
  assert.equal(own(empty.players, id).refreshments, null);
  a.send(clear); assert.equal((await a.wait(m => m.requestId === clear.requestId)).refreshments, null);
  await tick(mf, room);
  a.send({ type: 'refreshments', refreshments: juice, requestId: 'take-away-still-forbidden' }); assert.equal((await a.wait(m => m.requestId === 'take-away-still-forbidden')).code, 'REFRESHMENTS_DISTANCE');
  await room.testPositions({ [id]: point });
  a.send({ type: 'refreshments', refreshments: juice, requestId: 'new-menu-after-put-away' }); await a.wait(m => m.requestId === 'new-menu-after-put-away');
  a.send(clear); assert.deepEqual((await a.wait(m => m.requestId === clear.requestId)).refreshments, juice);
  const replacement = await join(mf, cookie, '다시온동료'); assert.deepEqual(own(replacement.welcome.players, id).refreshments, juice);
  assert.equal(own(replacement.welcome.players, b.welcome.me.id).refreshments, null, 'a forged playerId cannot change another inventory');
 } finally { await mf.dispose(); }
});

test('drink-only and snack-only selections retain authoritative state, retry safety and reconnect persistence', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const cookie = await identity(mf); let a = await join(mf, cookie, '메뉴하나동료'); const id = a.welcome.me.id;
  const b = await join(mf, await identity(mf), '메뉴확인동료'); await room.testPositions({ [id]: point });
  const drinkOnly = { drink: 'coffee', snack: null }, snackOnly = { drink: null, snack: 'donut' };
  const takeDrink = { type: 'refreshments', refreshments: drinkOnly, requestId: 'one-drink-take' };
  a.send(takeDrink); assert.deepEqual((await a.wait(m => m.requestId === takeDrink.requestId)).refreshments, drinkOnly);
  assert.deepEqual(own((await b.wait(m => m.type === 'players' && own(m.players,id)?.refreshments?.drink === 'coffee')).players,id).refreshments, drinkOnly);
  a = await join(mf, cookie, '메뉴하나동료'); assert.deepEqual(own(a.welcome.players,id).refreshments, drinkOnly);
  a.send(takeDrink); assert.deepEqual((await a.wait(m => m.requestId === takeDrink.requestId)).refreshments, drinkOnly);
  await tick(mf, room);
  a.send({ type: 'refreshments', refreshments: null, requestId: 'one-drink-return' }); assert.equal((await a.wait(m => m.requestId === 'one-drink-return')).refreshments, null);
  a.send(takeDrink); assert.equal((await a.wait(m => m.requestId === takeDrink.requestId)).refreshments, null, 'late retry must not refill a returned single item');
  a.send({ ...takeDrink, refreshments: snackOnly }); assert.equal((await a.wait(m => m.requestId === takeDrink.requestId)).code, 'REQUEST_REUSED');
  await tick(mf, room);
  a.send({ type: 'refreshments', refreshments: snackOnly, requestId: 'one-snack-take' }); assert.deepEqual((await a.wait(m => m.requestId === 'one-snack-take')).refreshments, snackOnly);
  a.socket.close(1011, 'temporary connection failure'); await pause(30); await restart();
  a = await join(mf, cookie, '메뉴하나동료'); assert.deepEqual(own(a.welcome.players,id).refreshments, snackOnly);
  const stranger = await join(mf, await identity(mf), '빈손동료'); assert.equal(own(stranger.welcome.players,stranger.welcome.me.id).refreshments,null);
 } finally { await mf.dispose(); }
});

test('late take retries never refill a returned tray, changed request ids are rejected and retained receipts are bounded', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const a = await join(mf, await identity(mf), '재시도동료'), id = a.welcome.me.id; await room.testPositions({ [id]: point });
  const first = { type: 'refreshments', refreshments: coffee, requestId: 'take-once-request' }; a.send(first); await a.wait(m => m.requestId === first.requestId);
  await tick(mf, room); a.send({ type: 'refreshments', refreshments: juice, requestId: 'replace-full-tray' }); assert.equal((await a.wait(m => m.requestId === 'replace-full-tray')).code, 'REFRESHMENTS_HELD');
  a.send({ type: 'refreshments', refreshments: null, requestId: 'return-once-request' }); assert.equal((await a.wait(m => m.requestId === 'return-once-request')).refreshments, null);
  await room.testPositions({ [id]: ROOM_SPAWN }); a.send(first); assert.equal((await a.wait(m => m.requestId === first.requestId)).refreshments, null);
  a.send({ ...first, refreshments: juice }); assert.equal((await a.wait(m => m.requestId === first.requestId)).code, 'REQUEST_REUSED');
  await room.testPositions({ [id]: point });
  for (let i = 0; i < REFRESHMENT_RULES.receiptLimit; i++) {
   await tick(mf, room); const requestId = `bounded-receipt-${i}`; a.send({ type: 'refreshments', refreshments: i % 2 === 0 ? coffee : null, requestId }); assert.equal((await a.wait(m => m.requestId === requestId)).type, 'refreshments-state');
  }
  // Old request ids are explicitly evicted from the bounded retry history.
  await tick(mf, room); a.send({ ...first, refreshments: juice }); assert.deepEqual((await a.wait(m => m.requestId === first.requestId)).refreshments, juice);
  a.send({ type: 'refreshments', refreshments: coffee, requestId: 'bounded-receipt-15' }); assert.equal((await a.wait(m => m.requestId === 'bounded-receipt-15')).code, 'REQUEST_REUSED');
 } finally { await mf.dispose(); }
});

test('carried refreshments persist through tab replacement, disconnect, Worker restart and layout migration', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const cookie = await identity(mf); let a = await join(mf, cookie, '쟁반동료'); const id = a.welcome.me.id; await room.testPositions({ [id]: point });
  a.send({ type: 'refreshments', refreshments: juice, requestId: 'persistent-tray-take' }); await a.wait(m => m.requestId === 'persistent-tray-take');
  a = await join(mf, cookie, '이름바꾼동료'); assert.deepEqual(own(a.welcome.players, id).refreshments, juice);
  a.send({ type: 'sit', seat: 15, requestId: 'persisted-sofa-seat' }); await a.wait(m => m.requestId === 'persisted-sofa-seat');
  const before = await room.testPreviousLayout({ [id]: { x: 0, z: 999, seat: 15 } }, MAP_LAYOUT_VERSION - 1); const migrated = await room.testMigratePlayers();
  const seated = own(migrated.players, id); assert.equal(seated.seat, 15); assert.equal(seated.x, SEATS[15]!.x); assert.equal(seated.z, SEATS[15]!.z); assert.deepEqual(seated.refreshments, juice); assert.deepEqual(migrated.runtime.settings, before.runtime.settings); assert.equal(migrated.runtime.roomOpen, before.runtime.roomOpen);
  a.socket.close(1000, 'refresh page'); await pause(30); assert.equal((await room.testSnapshot()).players.length, 0);
  await restart(); a = await join(mf, cookie, '다시입장동료'); const restored = own(a.welcome.players, id); assert.deepEqual(restored.refreshments, juice); assert.ok(isWalkable(restored.x, restored.z));
  a.send({ type: 'refreshments', refreshments: juice, requestId: 'persistent-tray-take' }); assert.deepEqual((await a.wait(m => m.requestId === 'persistent-tray-take')).refreshments, juice);
  const stranger = await join(mf, await identity(mf), '쟁반없는동료'); assert.equal(own(stranger.welcome.players, stranger.welcome.me.id).refreshments, null);
  const auth = await login(mf); await admin(mf, 'control', { action: 'close' }, auth.cookie, auth.csrf); await restart(); assert.equal((await room.testSnapshot()).runtime.roomOpen, false);
  await admin(mf, 'control', { action: 'open' }, auth.cookie, auth.csrf); a = await join(mf, cookie, '개장후동료'); assert.deepEqual(own(a.welcome.players, id).refreshments, juice);
 } finally { await mf.dispose(); }
});
