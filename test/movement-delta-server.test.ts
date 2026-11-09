import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, type Message } from './office-helpers';
import { ROOM_SPAWN, ROOM_BOUNDS, SEATS, NORMAL_MOVE_SPEED } from '../shared/classroom-layout';

test('accepted moves broadcast only authoritative coordinate deltas; roster lifecycle remains complete', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '이동하는동료');
    const b = await join(mf, await identity(mf), '지켜보는동료');
    const id = a.welcome.me.id, start = b.welcome.serverTime;
    await Promise.all([a.wait(m => m.type === 'players' && m.players.length === 2), b.wait(m => m.type === 'players' && m.players.length === 2)]);
    a.messages.length = 0; b.messages.length = 0;

    await room.testClock(start + 1500, false);
    const first = { x: ROOM_SPAWN.x, z: ROOM_SPAWN.z - 2.75 };
    a.send({ type: 'move', ...first });
    const isDelta = (message: Message) => message.type === 'player-moved' && message.player.id === id;
    const [ownDelta, peerDelta] = await Promise.all([a.wait(isDelta), b.wait(isDelta)]);
    assert.deepEqual(ownDelta, { type: 'player-moved', player: { id, ...first } });
    assert.deepEqual(peerDelta, ownDelta);
    for (const client of [a, b]) assert.equal(client.messages.some(m => m.type === 'players'), false, 'movement must not resend the full roster');

    // A burst cannot create additional travel credit without elapsed time.
    a.send({ type: 'move', x: first.x, z: first.z - NORMAL_MOVE_SPEED * 2 });
    await a.wait(m => m.type === 'position-correction');
    const afterRateLimit = (await room.testSnapshot()).players.find(p => p.id === id)!;
    assert.deepEqual({ x: afterRateLimit.x, z: afterRateLimit.z }, first);
    assert.equal(b.messages.some(isDelta), false);

    await room.testClock(start + 3000, false);
    a.send({ type: 'move', x: ROOM_BOUNDS.minX + 1, z: first.z });
    const correction = await a.wait(m => m.type === 'position-correction');
    assert.deepEqual({ x: correction.x, z: correction.z }, first);
    assert.equal(b.messages.some(isDelta), false, 'rejected movement is never broadcast');

    await room.testClock(start + 4500, false);
    const second = { x: first.x, z: first.z - 2 };
    a.send({ type: 'move', ...second });
    const secondDelta = await b.wait(isDelta);
    assert.deepEqual(secondDelta.player, { id, ...second });
    await a.wait(isDelta);

    const c = await join(mf, await identity(mf), '새로운동료');
    const newcomerRoster = c.welcome.players.find((p: Message) => p.id === id)!;
    assert.deepEqual({ x: newcomerRoster.x, z: newcomerRoster.z }, second);
    const joined = await b.wait(m => m.type === 'players' && m.players.length === 3);
    assert.deepEqual(joined.players.map((p: Message) => p.id).sort(), [id, b.welcome.me.id, c.welcome.me.id].sort());
    assert.equal(joined.players.find((p: Message) => p.id === id).nickname, '이동하는동료');

    a.send({ type: 'sit', seat: 0, requestId: 'delta-test-sit' });
    await a.wait(m => m.type === 'seat-state' && m.requestId === 'delta-test-sit');
    const seated = await b.wait(m => m.type === 'players' && m.players.some((p: Message) => p.id === id && p.seat === 0));
    assert.equal(seated.players.length, 3);
    const sitting = seated.players.find((p: Message) => p.id === id)!;
    assert.deepEqual({ x: sitting.x, z: sitting.z }, { x: SEATS[0].x, z: SEATS[0].z });

    a.send({ type: 'stand', requestId: 'delta-test-stand' });
    const stood = await b.wait(m => m.type === 'players' && m.players.some((p: Message) => p.id === id && p.seat === null && p.x === SEATS[0].standX));
    assert.equal(stood.players.length, 3);
    c.socket.close(1000, 'test leave');
    const left = await b.wait(m => m.type === 'players' && m.players.length === 2);
    assert.deepEqual(left.players.map((p: Message) => p.id).sort(), [id, b.welcome.me.id].sort());
    assert.equal((await room.testSnapshot()).accounts.find(account => account.id === id)!.balance, 0);
  } finally { await mf.dispose(); }
});

test('legacy tabs receive full movement rosters and every replacement renegotiates delta support', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const modern = await join(mf, await identity(mf), '새버전동료');
    const legacyCookie = await identity(mf);
    let legacy = await join(mf, legacyCookie, '이전버전동료', null);
    const sleeping = await join(mf, await identity(mf), '기존접속동료', null);
    await room.testLegacyMovement(sleeping.welcome.me.id);
    const actorId = modern.welcome.me.id, start = sleeping.welcome.serverTime;
    await modern.wait(m => m.type === 'players' && m.players.length === 3);
    await legacy.wait(m => m.type === 'players' && m.players.length === 3);
    await sleeping.wait(m => m.type === 'players' && m.players.length === 3);
    for (const client of [modern, legacy, sleeping]) client.messages.length = 0;

    await room.testClock(start + 1500, false);
    const first = { x: ROOM_SPAWN.x, z: ROOM_SPAWN.z - 2 };
    modern.send({ type: 'move', ...first });
    const changedRoster = (message: Message, z: number) => message.type === 'players' && message.players.some((p: Message) => p.id === actorId && p.z === z);
    const [delta, oldRoster, sleepingRoster] = await Promise.all([
      modern.wait(m => m.type === 'player-moved'), legacy.wait(m => changedRoster(m, first.z)), sleeping.wait(m => changedRoster(m, first.z)),
    ]);
    assert.deepEqual(delta.player, { id: actorId, ...first });
    assert.equal(oldRoster.players.length, 3); assert.deepEqual(sleepingRoster, oldRoster);
    assert.equal(modern.messages.some(m => m.type === 'players'), false);
    assert.equal(legacy.messages.some(m => m.type === 'player-moved'), false);
    assert.equal(sleeping.messages.some(m => m.type === 'player-moved'), false);

    // Replacing a legacy tab with the new build must override its old attachment.
    legacy = await join(mf, legacyCookie, '이전버전동료');
    await room.testClock(start + 3000, false);
    const second = { x: first.x, z: first.z - 2 };
    modern.send({ type: 'move', ...second });
    const upgraded = await legacy.wait(m => m.type === 'player-moved' && m.player.z === second.z);
    assert.deepEqual(upgraded.player, { id: actorId, ...second });
    await sleeping.wait(m => changedRoster(m, second.z));

    // The inverse replacement is valid too: never inherit a true capability
    // flag when the newly accepted browser did not request the delta protocol.
    legacy = await join(mf, legacyCookie, '이전버전동료', null);
    await room.testClock(start + 4500, false);
    const third = { x: first.x, z: second.z - 2 };
    modern.send({ type: 'move', ...third });
    const downgraded = await legacy.wait(m => changedRoster(m, third.z));
    assert.equal(downgraded.players.length, 3);
    assert.equal(legacy.messages.some(m => m.type === 'player-moved'), false);
  } finally { await mf.dispose(); }
});
