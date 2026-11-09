import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, observe, origin } from './office-helpers';
import { NORMAL_MOVE_SPEED, ROOM_SPAWN, SEATS } from '../shared/classroom-layout';

async function resume(mf: any, cookie: string, nickname: string) {
  const response = await mf.dispatchFetch(`${origin}/api/room?nickname=${encodeURIComponent(nickname)}&positions=delta&resume=1`, { headers: { Cookie: cookie, Origin: origin, Upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  const client = observe(response.webSocket!);
  return { ...client, welcome: await client.wait(message => message.type === 'welcome') };
}

test('automatic reconnect restores the last accepted position after the old socket has closed', { timeout: 30_000 }, async () => {
  const { mf, room, restart } = await createHarness();
  try {
    const cookie = await identity(mf), a = await join(mf, cookie, '다시오는동료');
    const observer = await join(mf, await identity(mf), '연결확인동료');
    await a.wait(m => m.type === 'players' && m.players.length === 2);
    await observer.wait(m => m.type === 'players' && m.players.length === 2);
    await room.testClock(a.welcome.serverTime + 1500, false);
    const destination = { x: 2, z: ROOM_SPAWN.z };
    a.send({ type: 'move', ...destination });
    await a.wait(m => m.type === 'player-moved');
    a.socket.close(1011, 'temporary network failure');
    await observer.wait(m => m.type === 'players' && m.players.length === 1);
    // The saved point survives a Durable Object restart as well as disconnection.
    await restart();
    const reconnected = await resume(mf, cookie, '다시오는동료');
    const own = reconnected.welcome.players.find((p: any) => p.id === a.welcome.me.id);
    assert.deepEqual({ x: own.x, z: own.z, seat: own.seat }, { ...destination, seat: null });
    const attachment = (await room.testSnapshot()).attachments.find(p => p.id === own.id)!;
    assert.ok(attachment.normalMoveCredit <= NORMAL_MOVE_SPEED * 0.3 + 0.01, 'reconnect must not carry old movement credit');
  } finally { await mf.dispose(); }
});

test('arrival jitter does not silently drop valid walking updates or force a later rollback', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '빠르게걷는동료'), start = a.welcome.serverTime;
    for (const [step, elapsed] of [[1, 1000], [2, 1900], [3, 3000]]) {
      await room.testClock(start + elapsed, false);
      const x = Math.round(NORMAL_MOVE_SPEED * step * 100) / 100;
      a.send({ type: 'move', x, z: ROOM_SPAWN.z });
      const response = await a.wait(m => m.type === 'player-moved' || m.type === 'position-correction');
      assert.equal(response.type, 'player-moved', `step ${step} must tolerate a 100 ms arrival variation`);
      assert.equal(response.player.x, x);
    }
    // A burst cannot create additional travel credit without elapsed time.
    a.send({ type: 'move', x: NORMAL_MOVE_SPEED * 6, z: ROOM_SPAWN.z });
    const correction = await a.wait(m => m.type === 'position-correction');
    assert.equal(correction.x, Math.round(NORMAL_MOVE_SPEED * 3 * 100) / 100);
    a.send({ type: 'sit', seat: 0, requestId: 'jitter-sit' });
    await a.wait(m => m.type === 'seat-state' && m.requestId === 'jitter-sit');
    a.send({ type: 'stand', requestId: 'jitter-stand' });
    await a.wait(m => m.type === 'seat-state' && m.requestId === 'jitter-stand');
    const stoodAt = (await room.testSnapshot()).attachments.find(p => p.id === a.welcome.me.id)!.normalMoveAt;
    for (const [step, elapsed] of [[1, 1000], [2, 1900]]) {
      await room.testClock(stoodAt + elapsed, false);
      const x = Math.round((SEATS[0].standX + NORMAL_MOVE_SPEED * step) * 100) / 100;
      a.send({ type: 'move', x, z: SEATS[0].standZ });
      const response = await a.wait(m => m.type === 'player-moved' || m.type === 'position-correction');
      assert.equal(response.type, 'player-moved', 'standing up must preserve tolerance for packet jitter');
      assert.equal(response.player.x, x);
    }
  } finally { await mf.dispose(); }
});

test('occupied seats, explicit leave and expired reconnect records do not restore stale positions', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookie = await identity(mf), a = await join(mf, cookie, '앉았던동료');
    const b = await join(mf, await identity(mf), '새로앉는동료');
    await b.wait(m => m.type === 'players' && m.players.length === 2);
    a.send({ type: 'sit', seat: 0, requestId: 'resume-seat-a' });
    await b.wait(m => m.type === 'players' && m.players.some((p: any) => p.id === a.welcome.me.id && p.seat === 0));
    a.socket.close(1011, 'temporary network failure');
    await b.wait(m => m.type === 'players' && m.players.length === 1);
    b.send({ type: 'sit', seat: 0, requestId: 'resume-seat-b' });
    await b.wait(m => m.type === 'seat-state');
    let restored = await resume(mf, cookie, '앉았던동료');
    let own = restored.welcome.players.find((p: any) => p.id === a.welcome.me.id);
    assert.deepEqual({ x: own.x, z: own.z, seat: own.seat }, { x: SEATS[0].standX, z: SEATS[0].standZ, seat: null });
    restored.socket.close(1000, 'leave');
    await b.wait(m => m.type === 'players' && m.players.length === 1);
    restored = await resume(mf, cookie, '앉았던동료');
    own = restored.welcome.players.find((p: any) => p.id === a.welcome.me.id);
    assert.deepEqual({ x: own.x, z: own.z }, ROOM_SPAWN);
    await room.testPositions({ [own.id]: { x: 4, z: ROOM_SPAWN.z } });
    restored.socket.close(1011, 'temporary network failure');
    await b.wait(m => m.type === 'players' && m.players.length === 1);
    await room.testClock(restored.welcome.serverTime + 6 * 60_000, false);
    restored = await resume(mf, cookie, '앉았던동료');
    own = restored.welcome.players.find((p: any) => p.id === a.welcome.me.id);
    assert.deepEqual({ x: own.x, z: own.z }, ROOM_SPAWN);
  } finally { await mf.dispose(); }
});
