import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, type Message } from './office-helpers';
import { SEATS, isWalkable } from '../shared/classroom-layout';

test('new sofa and table-chair seats are authoritative, exclusive and release to their own aisle', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '테이블동료'), b = await join(mf, await identity(mf), '소파동료');
    assert.equal(a.welcome.rules.seatCount, 56); assert.equal(a.welcome.capacity, 50);
    a.send({ type: 'sit', seat: 48, requestId: 'new-table-seat' });
    assert.equal((await a.wait(m => m.requestId === 'new-table-seat')).seat, 48);
    const chair = await b.wait(m => m.type === 'players' && m.players.some((p: Message) => p.id === a.welcome.me.id && p.seat === 48));
    const seated = chair.players.find((p: Message) => p.id === a.welcome.me.id);
    assert.deepEqual({ x: seated.x, z: seated.z }, { x: SEATS[48].x, z: SEATS[48].z });
    b.send({ type: 'sit', seat: 48, requestId: 'occupied-table-seat' });
    assert.equal((await b.wait(m => m.requestId === 'occupied-table-seat')).code, 'SEAT_OCCUPIED');
    b.send({ type: 'sit', seat: 47, requestId: 'new-sofa-seat' });
    assert.equal((await b.wait(m => m.requestId === 'new-sofa-seat')).seat, 47);
    a.send({ type: 'stand', requestId: 'leave-table-seat' }); await a.wait(m => m.requestId === 'leave-table-seat');
    const stood = (await room.testSnapshot()).players.find(p => p.id === a.welcome.me.id)!;
    assert.equal(stood.seat, null); assert.deepEqual({ x: stood.x, z: stood.z }, { x: SEATS[48].standX, z: SEATS[48].standZ });
    assert.ok(isWalkable(stood.x, stood.z));
    b.send({ type: 'stand', requestId: 'leave-new-sofa' }); await b.wait(m => m.requestId === 'leave-new-sofa');
    const sofaExit = (await room.testSnapshot()).players.find(p => p.id === b.welcome.me.id)!;
    assert.deepEqual({ x: sofaExit.x, z: sofaExit.z }, { x: SEATS[47].standX, z: SEATS[47].standZ });
    assert.ok(isWalkable(sofaExit.x, sofaExit.z));
    b.send({ type: 'sit', seat: 48, requestId: 'released-table-seat' });
    assert.equal((await b.wait(m => m.requestId === 'released-table-seat')).seat, 48);
  } finally { await mf.dispose(); }
});

test('v9 sofa and final table seats reject simultaneous claims and keep the winner through tab replacement', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookies = [await identity(mf), await identity(mf)];
    const clients = [await join(mf, cookies[0], '첫자리동료'), await join(mf, cookies[1], '둘째자리동료')];
    for (const seatId of [32, 55]) {
      clients.forEach((client, index) => client.send({ type: 'sit', seat: seatId, requestId: `v9-race-${seatId}-${index}` }));
      const results = await Promise.all(clients.map((client, index) => client.wait(m => m.requestId === `v9-race-${seatId}-${index}`)));
      assert.equal(results.filter(result => result.type === 'seat-state' && result.seat === seatId).length, 1);
      assert.equal(results.filter(result => result.code === 'SEAT_OCCUPIED').length, 1);
      const winnerIndex = results.findIndex(result => result.type === 'seat-state'), loserIndex = 1 - winnerIndex;
      clients[winnerIndex] = await join(mf, cookies[winnerIndex], `자리유지${seatId}`);
      const winner = clients[winnerIndex], loser = clients[loserIndex];
      const owned = winner.welcome.players.filter((p: Message) => p.seat === seatId);
      assert.equal(owned.length, 1); assert.equal(owned[0].id, winner.welcome.me.id);
      assert.deepEqual({ x: owned[0].x, z: owned[0].z }, { x: SEATS[seatId].x, z: SEATS[seatId].z });
      const requestId = `v9-free-${seatId}`; winner.send({ type: 'stand', requestId });
      assert.equal((await winner.wait(m => m.requestId === requestId)).seat, null);
      const standing = (await room.testSnapshot()).players.find(p => p.id === winner.welcome.me.id)!;
      assert.deepEqual({ x: standing.x, z: standing.z }, { x: SEATS[seatId].standX, z: SEATS[seatId].standZ });
      assert.ok(isWalkable(standing.x, standing.z));
      const claim = `v9-reclaim-${seatId}`; loser.send({ type: 'sit', seat: seatId, requestId: claim });
      assert.equal((await loser.wait(m => m.requestId === claim)).seat, seatId);
      const snapshot = await room.testSnapshot();
      assert.equal(snapshot.players.filter(p => p.seat === seatId).length, 1);
      assert.equal(snapshot.players.find(p => p.id === loser.welcome.me.id)!.seat, seatId);
    }
  } finally { await mf.dispose(); }
});
