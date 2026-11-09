import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { createHarness } from './harness.mjs';
import { identity, join, type Message } from './office-helpers';
import { OFFICE_GEOMETRY, ROOM_BOUNDS, ROOM_SPAWN, SEATS, isWalkable } from '../shared/classroom-layout';

test('all four room edges reject short outward steps and stay safe through seating and reconnect', { timeout: 30_000 }, async () => {
  const inside = ({ x, z }: { x: number; z: number }) => x >= ROOM_BOUNDS.minX && x <= ROOM_BOUNDS.maxX && z >= ROOM_BOUNDS.minZ && z <= ROOM_BOUNDS.maxZ;
  assert.ok(ROOM_BOUNDS.minX > -OFFICE_GEOMETRY.width / 2 && ROOM_BOUNDS.maxX < OFFICE_GEOMETRY.width / 2);
  assert.ok(ROOM_BOUNDS.minZ > OFFICE_GEOMETRY.centerZ - OFFICE_GEOMETRY.depth / 2 && ROOM_BOUNDS.maxZ < OFFICE_GEOMETRY.centerZ + OFFICE_GEOMETRY.depth / 2);
  assert.ok(isWalkable(ROOM_SPAWN.x, ROOM_SPAWN.z));
  for (const seat of SEATS) {
    assert.ok(inside(seat));
    assert.ok(isWalkable(seat.standX, seat.standZ));
  }

  const { mf, room } = await createHarness();
  try {
    const cookie = await identity(mf);
    let client = await join(mf, cookie, '경계확인동료');
    const id = client.welcome.me.id;
    const edges = [
      { start: { x: ROOM_BOUNDS.minX + 0.1, z: 0 }, edge: { x: ROOM_BOUNDS.minX, z: 0 }, outside: { x: ROOM_BOUNDS.minX - 0.1, z: 0 } },
      { start: { x: ROOM_BOUNDS.maxX - 0.1, z: 0 }, edge: { x: ROOM_BOUNDS.maxX, z: 0 }, outside: { x: ROOM_BOUNDS.maxX + 0.1, z: 0 } },
      { start: { x: 0, z: ROOM_BOUNDS.minZ + 0.1 }, edge: { x: 0, z: ROOM_BOUNDS.minZ }, outside: { x: 0, z: ROOM_BOUNDS.minZ - 0.1 } },
      { start: { x: 0, z: ROOM_BOUNDS.maxZ - 0.1 }, edge: { x: 0, z: ROOM_BOUNDS.maxZ }, outside: { x: 0, z: ROOM_BOUNDS.maxZ + 0.1 } },
    ];
    for (const { start, edge, outside } of edges) {
      assert.ok(isWalkable(start.x, start.z) && isWalkable(edge.x, edge.z));
      const positioned = await room.testPositions({ [id]: start });
      const baseline = positioned.attachments.find((player: Message) => player.id === id)!;
      await room.testClock(baseline.normalMoveAt + 1500, false);
      // This 0.2-unit step is well within the 4.2-unit accumulated speed allowance.
      // Rejection must come from the room boundary, not the teleport limit.
      client.send({ type: 'move', ...outside });
      const correction = await client.wait(message => message.type === 'position-correction');
      assert.deepEqual({ x: correction.x, z: correction.z }, start);
      const rejected = (await room.testSnapshot()).attachments.find((player: Message) => player.id === id)!;
      assert.equal(rejected.normalMoveAt, baseline.normalMoveAt);
      assert.equal(rejected.normalMoveCredit, baseline.normalMoveCredit);
      client.send({ type: 'move', ...edge });
      await client.wait(message => message.type === 'player-moved' && message.player.id === id && message.player.x === edge.x && message.player.z === edge.z);
    }

    client = await join(mf, cookie, '경계확인동료');
    const restored = client.welcome.players.find((player: Message) => player.id === id)!;
    assert.deepEqual({ x: restored.x, z: restored.z }, edges[3]!.edge);
    assert.ok(inside(restored), 'live replacement retains the last authoritative in-room position');
    client.socket.close(1000, 'leave');
    await pause(40);
    client = await join(mf, cookie, '경계확인동료');
    const returned = client.welcome.players.find((player: Message) => player.id === id)!;
    assert.deepEqual({ x: returned.x, z: returned.z }, ROOM_SPAWN);
    assert.ok(inside(returned), 'fresh reconnect uses the safe server spawn');
    assert.equal((await room.testSnapshot()).alarmAt, null);
  } finally { await mf.dispose(); }
});
