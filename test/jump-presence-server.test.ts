import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, origin, type Message } from './office-helpers';
import { DEFAULT_APPEARANCE } from '../shared/avatar-appearance';
import { JUMP_PORTAL } from '../shared/jump-portal';
import type { JumpPeerMotion, JumpPeerView } from '../shared/jump-social';

type Peer = Awaited<ReturnType<typeof join>>;
const social = (message: Message) => message.type === 'jump-presence' || message.type === 'jump-positions';
const ids = (message: Message) => (message.peers as JumpPeerView[]).map(peer => peer.id).sort();

test('tower roster and movement reach tower peers only, with live appearance, exit and reconnect updates', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookieA = await identity(mf), cookieB = await identity(mf), cookieOffice = await identity(mf);
    const a = await join(mf, cookieA, '첫도전자');
    let b = await join(mf, cookieB, '두번째도전자');
    const office = await join(mf, cookieOffice, '사무실동료');
    const idA = a.welcome.me.id as string, idB = b.welcome.me.id as string;
    const both = [idA, idB].sort();
    let now = await room.testFreezeClock(), request = 0;
    const command = async (peer: Peer, type: string, extra: Record<string, unknown> = {}) => {
      const requestId = `presence-${++request}`;
      peer.send({ type, requestId, ...extra });
      const response = await peer.wait(message => message.requestId === requestId && (message.type === 'jump-state' || message.type === 'error'));
      assert.equal(response.type, 'jump-state', JSON.stringify(response));
      return response.state;
    };
    await room.testPositions({ [idA]: { x: JUMP_PORTAL.x, z: JUMP_PORTAL.z }, [idB]: { x: JUMP_PORTAL.x, z: JUMP_PORTAL.z } });
    let stateA = await command(a, 'jump-enter');
    assert.equal(stateA.active, true);
    assert.deepEqual(ids(await a.wait(message => message.type === 'jump-presence')), [idA]);
    assert.equal(b.messages.some(social), false, 'an office visitor must not receive tower presence');

    let stateB = await command(b, 'jump-enter');
    const rosterA = await a.wait(message => message.type === 'jump-presence' && message.peers.length === 2);
    const rosterB = await b.wait(message => message.type === 'jump-presence' && message.peers.length === 2);
    assert.deepEqual(ids(rosterA), both);
    assert.deepEqual(ids(rosterB), both);
    assert.equal(rosterA.serverTime, now);
    const initialA = (rosterA.peers as JumpPeerView[]).find(peer => peer.id === idA)!;
    assert.equal(initialA.nickname, '첫도전자');
    assert.equal(initialA.color, a.welcome.me.color);
    assert.equal(initialA.updatedAt, now);
    assert.equal(typeof initialA.grounded, 'boolean');
    assert.deepEqual(Object.keys(initialA).sort(), ['id', 'nickname', 'color', 'appearance', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded', 'floor', 'jumps', 'updatedAt'].sort(), 'peer views must not expose private run IDs, inventory or reward receipts');

    await room.testClock(now += 200, false);
    stateA = await command(a, 'jump-input', { runId: stateA.runId, frames: Array.from({ length: 10 }, (_, index) => ({ seq: index + 1, x: 1, z: 0, jump: index === 0 })) });
    assert.equal(stateA.ackSeq, 10);
    const movement = await b.wait(message => message.type === 'jump-positions' && message.serverTime === now);
    assert.equal(movement.players.length, 1, 'stationary peers should not be resent in movement deltas');
    const moved = movement.players[0] as JumpPeerMotion, authority = stateA.state;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    assert.deepEqual(moved, [idA, round(authority.x), round(authority.y), round(authority.z), round(authority.vx), round(authority.vy), round(authority.vz), authority.grounded ? 1 : 0, authority.floor, authority.jumps]);
    assert.ok(moved[1] > initialA.x && moved[2] > initialA.y, 'other participants see both walking and jumping');

    await room.testClock(now += 200, false);
    const appearance = { ...DEFAULT_APPEARANCE, species: 'cat', hair: 'bob', skin: 'rose' };
    const equipped = await mf.dispatchFetch(`${origin}/api/avatar/equip`, { method: 'POST', headers: { Cookie: cookieA, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance, requestId: 'tower-appearance' }) });
    assert.equal(equipped.status, 200, await equipped.clone().text());
    for (const peer of [a, b]) {
      const updated = await peer.wait(message => message.type === 'jump-presence' && message.peers.some((view: JumpPeerView) => view.id === idA && view.appearance.species === 'cat'));
      assert.deepEqual(ids(updated), both);
      assert.deepEqual(updated.peers.find((view: JumpPeerView) => view.id === idA).appearance, appearance);
    }

    assert.equal((await command(b, 'jump-exit', { runId: stateB.runId })).active, false);
    assert.deepEqual(ids(await a.wait(message => message.type === 'jump-presence' && message.peers.length === 1)), [idA]);
    assert.equal((await room.testSnapshot()).players.find(peer => peer.id === idB)?.area, 'office');
    b.messages.length = 0;
    await room.testClock(now += 200, false);
    await command(a, 'jump-input', { runId: stateA.runId, frames: Array.from({ length: 10 }, (_, index) => ({ seq: index + 11, x: 1, z: 0, jump: false })) });
    assert.equal(b.messages.some(social), false, 'leaving the tower unsubscribes the visitor from tower movement');

    stateB = await command(b, 'jump-enter');
    assert.equal(stateB.active, true);
    assert.deepEqual(ids(await a.wait(message => message.type === 'jump-presence' && message.peers.length === 2)), both);
    b.socket.close(1000, 'leave');
    assert.deepEqual(ids(await a.wait(message => message.type === 'jump-presence' && message.peers.length === 1)), [idA], 'disconnect removes the remote model even though its run is resumable');

    b = await join(mf, cookieB, '돌아온도전자');
    const resumed = await b.wait(message => message.type === 'jump-state' && message.state.active === true);
    assert.equal(resumed.state.runId, stateB.runId, 'reconnect keeps the authoritative run');
    const rejoined = await a.wait(message => message.type === 'jump-presence' && message.peers.length === 2);
    assert.deepEqual(ids(rejoined), both);
    assert.equal(rejoined.peers.find((view: JumpPeerView) => view.id === idB).nickname, '돌아온도전자');
    assert.equal(office.messages.some(social), false, 'office visitors never receive private tower roster or movement packets');
  } finally { await mf.dispose(); }
});
