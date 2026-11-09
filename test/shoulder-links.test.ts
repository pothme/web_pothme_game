import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import type { Miniflare, WebSocket as LocalSocket } from 'miniflare';
import { joinShoulderLinks, repairShoulderLinks, type ShoulderPlayer } from '../server/shoulder-links';
import { SHOULDER_LINK_RULES, isShoulderLinkView } from '../shared/shoulder-links';
import { ROOM_BOUNDS, ROOM_SPAWN, REFRESHMENT_STATION, isWalkable } from '../shared/classroom-layout';

type Message = Record<string, any>;
const origin = 'http://podeumgo.test';
async function identity(mf: Miniflare) { return (await mf.dispatchFetch(`${origin}/api/session`)).headers.get('set-cookie')!.split(';')[0]!; }
function observe(socket: LocalSocket) {
  const messages: Message[] = [], listeners = new Set<() => void>();
  socket.addEventListener('message', event => { messages.push(JSON.parse(String(event.data))); for (const listener of listeners) listener(); }); socket.accept();
  return { socket, messages, send(value: Message) { socket.send(JSON.stringify(value)); }, wait(predicate: (value: Message) => boolean): Promise<Message> {
    return new Promise((resolve, reject) => { const check = () => { const index = messages.findIndex(predicate); if (index < 0) return; clearTimeout(timer); listeners.delete(check); resolve(messages.splice(index, 1)[0]!); }; const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Expected shoulder message missing')); }, 5000); listeners.add(check); check(); });
  } };
}
async function join(mf: Miniflare, cookie: string, nickname: string) {
  const response = await mf.dispatchFetch(`${origin}/api/room?nickname=${encodeURIComponent(nickname)}&positions=delta`, { headers: { Upgrade: 'websocket', Cookie: cookie, Origin: origin } });
  assert.equal(response.status, 101); const client = observe(response.webSocket!); return { ...client, welcome: await client.wait(message => message.type === 'welcome') };
}
async function toggle(client: ReturnType<typeof observe>, enabled: boolean, requestId: string, extra: Message = {}) {
  client.send({ type: 'shoulder-link', enabled, requestId, ...extra }); return client.wait(message => message.requestId === requestId);
}
const own = (players: Message[], id: string) => players.find(player => player.id === id)!;

test('shoulder chains join only consenting nearby people and preserve existing positions', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '어깨첫사람'), b = await join(mf, await identity(mf), '어깨둘째'), c = await join(mf, await identity(mf), '어깨셋째'), visitor = await join(mf, await identity(mf), '자유로운사람');
    const [aid, bid, cid, vid] = [a, b, c, visitor].map(client => client.welcome.me.id);
    await room.testPositions({ [aid]: { x: 0, z: -4 }, [bid]: { x: -1.5, z: -4 }, [cid]: { x: 1.5, z: -4 }, [vid]: { x: 2, z: -5 } });
    const before = await room.testSnapshot();
    const first = await toggle(a, true, 'shoulder-first', { playerId: vid, x: 99, groupId: 'forged', index: 99 });
    assert.equal(first.shoulder.count, 1); assert.ok(isShoulderLinkView(first.shoulder));
    const second = await toggle(b, true, 'shoulder-second'); assert.equal(second.shoulder.groupId, first.shoulder.groupId); assert.equal(second.shoulder.count, 2);
    const correction = await b.wait(m => m.type === 'position-correction' && m.reason === 'shoulder-link'); assert.equal(correction.x, -SHOULDER_LINK_RULES.spacing); assert.equal(correction.z, -4);
    const third = await toggle(c, true, 'shoulder-third'); assert.equal(third.shoulder.count, 3);
    const after = await room.testSnapshot();
    const linked = (after.players as Message[]).filter(p => p.shoulder);
    assert.deepEqual(linked.map(p => p.x).sort((x, y) => x - y), [-0.78, 0, 0.78]);
    assert.equal(own(after.players, aid).x, 0); assert.equal(own(after.players, vid).shoulder, null); assert.equal(own(after.players, vid).x, 2);
    for (const player of linked) { assert.equal(player.shoulder.groupId, first.shoulder.groupId); assert.equal(player.shoulder.count, 3); assert.equal(player.shoulder.facing, 0); assert.ok(isWalkable(player.x, player.z)); }
    assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.office, before.office); assert.equal(after.alarmAt, null);
  } finally { await mf.dispose(); }
});

test('movement splits a chain without pulling others, retries cannot re-enable cancelled membership', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '가운데사람'), b = await join(mf, await identity(mf), '왼쪽사람'), c = await join(mf, await identity(mf), '오른쪽사람');
    const [aid, bid, cid] = [a, b, c].map(client => client.welcome.me.id);
    await room.testPositions({ [aid]: { x: 0, z: -4 }, [bid]: { x: -1.5, z: -4 }, [cid]: { x: 1.5, z: -4 } });
    const first = await toggle(a, true, 'middle-first'); await toggle(b, true, 'left-second'); await toggle(c, true, 'right-third');
    await room.testClock(first.serverTime + 1500, false);
    a.send({ type: 'move', x: 0, z: -5 }); await b.wait(m => m.type === 'player-moved' && m.player.id === aid);
    const state = await room.testSnapshot();
    assert.equal(own(state.players, aid).shoulder, null); assert.equal(own(state.players, aid).z, -5);
    assert.equal(own(state.players, bid).x, -0.78); assert.equal(own(state.players, cid).x, 0.78);
    assert.equal(own(state.players, bid).shoulder.count, 1); assert.equal(own(state.players, cid).shoulder.count, 1); assert.notEqual(own(state.players, bid).shoulder.groupId, own(state.players, cid).shoulder.groupId);
    assert.equal((await toggle(a, true, 'middle-first')).shoulder, null);
    assert.equal((await toggle(a, false, 'middle-first')).code, 'REQUEST_REUSED');
    await toggle(b, false, 'left-disable');
    assert.equal((await toggle(b, true, 'left-second')).shoulder, null);
    assert.equal((await toggle(b, true, 'left-too-fast')).code, 'SHOULDER_COOLDOWN');
  } finally { await mf.dispose(); }
});

test('shoulder state survives tab replacement, rejects seated/full hands, leaves for jump and disconnect', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookie = await identity(mf); let a = await join(mf, cookie, '연결유지사람'); const b = await join(mf, await identity(mf), '함께하는사람');
    const aid = a.welcome.me.id, bid = b.welcome.me.id;
    const first = await toggle(a, true, 'persisted-first'); await toggle(b, true, 'persisted-second');
    a = await join(mf, cookie, '연결유지사람'); assert.equal(own(a.welcome.players, aid).shoulder.count, 2); assert.equal(own(a.welcome.players, aid).shoulder.groupId, first.shoulder.groupId);
    a.send({ type: 'avatar-action', kind: 'jump', requestId: 'jump-leaves-shoulder' }); assert.equal((await a.wait(m => m.requestId === 'jump-leaves-shoulder')).action.kind, 'jump');
    let snapshot = await room.testSnapshot(); assert.equal(own(snapshot.players, aid).shoulder, null); assert.equal(own(snapshot.players, bid).shoulder.count, 1);
    await room.testClock(first.serverTime + 3000, false);
    a.send({ type: 'sit', seat: 0, requestId: 'sit-before-shoulder' }); await a.wait(m => m.requestId === 'sit-before-shoulder');
    assert.equal((await toggle(a, true, 'seated-shoulder')).code, 'SHOULDER_SEATED');
    await room.testPositions({ [aid]: { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ } });
    a.send({ type: 'refreshments', refreshments: { drink: 'coffee', snack: null }, requestId: 'held-before-shoulder' }); await a.wait(m => m.requestId === 'held-before-shoulder');
    assert.equal((await toggle(a, true, 'held-shoulder')).code, 'SHOULDER_HANDS_BUSY');
    assert.equal((await toggle(a, true, 'invalid-enabled', { enabled: 'true' })).code, 'SHOULDER_INVALID');
    b.socket.close(1000, 'leave');
    await a.wait(m => m.type === 'players' && !m.players.some((p: Message) => p.id === bid));
    snapshot = await room.testSnapshot(); assert.equal(snapshot.players.length, 1); assert.equal(own(snapshot.players, aid).shoulder, null);
  } finally { await mf.dispose(); }
});

test('disconnect releases the remaining shoulder and reconnect requires opting in again', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '남아있는사람'), cookie = await identity(mf), b = await join(mf, cookie, '잠시떠나는사람');
    const aid = a.welcome.me.id, bid = b.welcome.me.id;
    await toggle(a, true, 'disconnect-first'); await toggle(b, true, 'disconnect-second');
    b.socket.close(1000, 'leave');
    const remaining = await a.wait(m => m.type === 'players' && m.players.length === 1 && own(m.players, aid)?.shoulder?.count === 1);
    assert.equal(own(remaining.players, aid).shoulder.count, 1); assert.equal(own(remaining.players, aid).shoulder.index, 0);
    const returned = await join(mf, cookie, '잠시떠나는사람');
    assert.equal(own(returned.welcome.players, bid).shoulder, null);
    assert.equal(own((await room.testSnapshot()).players, aid).shoulder.count, 1);
  } finally { await mf.dispose(); }
});

test('formation endpoints respect walls, bystanders and proximity; repair splits absent middle members', () => {
  const armed = (id: string, x: number, z: number, index = 0, count = 1): ShoulderPlayer => ({ id, x, z, seat: null, shoulder: { groupId: 'test-group', index, count, facing: 0, since: 1 } });
  const idle = (id: string, x: number, z: number): ShoulderPlayer => ({ id, x, z, seat: null, shoulder: null });
  const anchor = armed('a', 0, ROOM_SPAWN.z), actor = idle('b', 1, ROOM_SPAWN.z);
  const blocked = joinShoulderLinks([anchor, actor, idle('left', -0.78, ROOM_SPAWN.z), idle('right', 0.78, ROOM_SPAWN.z)], actor, 2);
  assert.equal(blocked.length, 1); assert.equal(blocked[0]!.shoulder.count, 1); assert.equal(blocked[0]!.x, undefined);
  const far = idle('far', 20, ROOM_SPAWN.z); assert.equal(joinShoulderLinks([anchor, far], far, 2)[0]!.shoulder.count, 1);
  const edge = armed('edge', ROOM_BOUNDS.maxX, ROOM_BOUNDS.minZ + 3), near = idle('near', ROOM_BOUNDS.maxX - 1.5, edge.z);
  assert.ok(isWalkable(edge.x, edge.z));
  const edgeJoined = joinShoulderLinks([edge, near], near, 2); assert.equal(edgeJoined.length, 2); assert.equal(edgeJoined.find(p => p.id === 'near')!.x, edge.x - 0.78);
  const split = repairShoulderLinks([armed('left', -0.78, -4, 0, 3), armed('right', 0.78, -4, 2, 3)]);
  assert.equal(split.length, 2); assert.ok(split.every(p => p.shoulder.index === 0 && p.shoulder.count === 1)); assert.notEqual(split[0]!.shoulder.groupId, split[1]!.shoulder.groupId);
  assert.equal(isShoulderLinkView({ groupId: 'x', index: 2, count: 2, facing: 0, since: 1 }), false);
});
