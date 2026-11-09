import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { createHarness } from './harness.mjs';
import { identity, join, login, manage, type Message } from './office-helpers';
import { SHOULDER_LINK_RULES, isShoulderLinkView, type ShoulderLinkView } from '../shared/shoulder-links';
import { isActionNotice } from '../shared/action-notices';
import { repairShoulderLinks, joinShoulderLinks, type ShoulderPlayer } from '../server/shoulder-links';

type Client = Awaited<ReturnType<typeof join>>;
async function command(client: Client, input: Message) { client.send(input); return client.wait(message => message.requestId === input.requestId); }
const toggle = (client: Client, enabled: boolean, requestId: string) => command(client, { type: 'shoulder-link', enabled, requestId });
const cheer = (client: Client, requestId: string, extras: Message = {}) => command(client, { type: 'shoulder-cheer', requestId, ...extras });
const own = (players: Message[], id: string) => players.find(player => player.id === id)!;
async function noNewCheer(client: Client, operation: () => Promise<unknown>) {
  await pause(10); const before = client.messages.filter(message => message.type === 'action-notice' && message.notice.kind === 'shoulder-cheer').length;
  await operation(); await pause(20);
  assert.equal(client.messages.filter(message => message.type === 'action-notice' && message.notice.kind === 'shoulder-cheer').length, before);
}

test('shoulder cheer is server-authored for a consenting group, synchronized and independent of chat', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '으쌰첫동료'), b = await join(mf, await identity(mf), '으쌰옆동료'), observer = await join(mf, await identity(mf), '지켜보는동료');
    await room.testPositions({ [a.welcome.me.id]: { x: 0, z: -4 }, [b.welcome.me.id]: { x: -1.5, z: -4 }, [observer.welcome.me.id]: { x: 10, z: -4 } });
    assert.equal((await cheer(a, 'unlinked-cheer')).code, 'SHOULDER_CHEER_GROUP');
    await toggle(a, true, 'cheer-arm-first');
    await noNewCheer(observer, async () => { assert.equal((await cheer(a, 'singleton-cheer')).code, 'SHOULDER_CHEER_GROUP'); });
    await toggle(b, true, 'cheer-arm-second');
    const auth = await login(mf); assert.equal((await manage(mf, auth, { action: 'settings', notice: '', donationUrl: '', chatEnabled: false })).status, 200);
    const before = await room.testSnapshot();
    const result = await cheer(a, 'group-cheer-first', { playerId: observer.welcome.me.id, groupId: 'forged', text: '가짜 메시지', cheer: { id: 'forged', expiresAt: Infinity } });
    assert.equal(result.type, 'shoulder-cheer-state'); assert.ok(isShoulderLinkView(result.shoulder));
    const phase = result.shoulder.cheer;
    assert.ok(phase);
    assert.equal(phase.startedAt, result.serverTime); assert.equal(phase.expiresAt - phase.startedAt, 6000);
    assert.equal(result.shoulder.cheerNextAt, phase.startedAt + 7000);
    const roster = await observer.wait(message => message.type === 'players' && own(message.players, a.welcome.me.id)?.shoulder?.cheer?.id === phase.id);
    for (const client of [a, b]) {
      assert.deepEqual(own(roster.players, client.welcome.me.id).shoulder.cheer, phase);
      const notice = (await observer.wait(message => message.type === 'action-notice' && message.notice.kind === 'shoulder-cheer' && message.notice.playerId === client.welcome.me.id)).notice;
      assert.ok(isActionNotice(notice)); assert.equal(notice.text, '으쌰! 으쌰! 💪');
      assert.equal(notice.nickname, client.welcome.me.nickname); assert.equal(notice.at, phase.startedAt); assert.equal(notice.expiresAt, phase.expiresAt);
      const self = await client.wait(message => message.type === 'action-notice' && message.notice.id === notice.id); assert.deepEqual(self.notice, notice);
    }
    assert.equal(own(roster.players, observer.welcome.me.id).shoulder, null);
    await noNewCheer(observer, async () => {
      assert.equal((await cheer(observer, 'outsider-cheer', { groupId: result.shoulder.groupId })).code, 'SHOULDER_CHEER_GROUP');
      assert.equal((await cheer(b, 'group-too-soon')).code, 'SHOULDER_CHEER_COOLDOWN');
      assert.equal((await cheer(a, 'group-cheer-first')).shoulder.cheer.id, phase.id);
    });
    const after = await room.testSnapshot();
    assert.deepEqual(after.players.map(p => [p.id, p.x, p.z, p.seat]), before.players.map(p => [p.id, p.x, p.z, p.seat]));
    assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.office, before.office); assert.deepEqual(after.runtime, before.runtime); assert.equal(after.alarmAt, null);
    assert.equal(observer.messages.some(message => message.type === 'chat'), false);
  } finally { await mf.dispose(); }
});

test('late group joiners share the phase, expired cheer is not inherited, and the group cooldown survives expiry', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '시작동료'), b = await join(mf, await identity(mf), '함께동료');
    await toggle(a, true, 'phase-arm-first'); await toggle(b, true, 'phase-arm-second');
    const first = await cheer(a, 'phase-first-cheer'), phase = first.shoulder.cheer;
    await room.testClock(phase.startedAt + 2000, false);
    const c = await join(mf, await identity(mf), '중간합류동료');
    await room.testPositions({ [c.welcome.me.id]: { x: 1.5, z: -4 } });
    const joined = await toggle(c, true, 'phase-late-join');
    assert.deepEqual(joined.shoulder.cheer, phase); assert.equal(joined.shoulder.count, 3);
    assert.equal(joined.shoulder.cheerNextAt, first.shoulder.cheerNextAt);
    await room.testClock(phase.expiresAt + 10, false);
    const d = await join(mf, await identity(mf), '끝난뒤합류동료');
    await room.testPositions({ [d.welcome.me.id]: { x: 2, z: -4 } });
    const expiredJoin = await toggle(d, true, 'phase-expired-join');
    assert.equal(expiredJoin.shoulder.count, 4); assert.equal(expiredJoin.shoulder.cheer, undefined);
    assert.equal(expiredJoin.shoulder.cheerNextAt, first.shoulder.cheerNextAt);
    const tooSoon = await cheer(d, 'phase-cooldown-left'); assert.equal(tooSoon.code, 'SHOULDER_CHEER_COOLDOWN'); assert.equal(tooSoon.retryAt, first.shoulder.cheerNextAt);
    await room.testClock(first.shoulder.cheerNextAt + 1, false);
    const next = await cheer(d, 'phase-next-cheer'); assert.equal(next.type, 'shoulder-cheer-state'); assert.notEqual(next.shoulder.cheer.id, phase.id);
    const snapshot = await room.testSnapshot();
    assert.ok((snapshot.players as Message[]).every(player => player.shoulder.cheer.id === next.shoulder.cheer.id));
    assert.equal(snapshot.alarmAt, null);
  } finally { await mf.dispose(); }
});

test('leaving and disconnecting stop the pose; old retries and tab replacement cannot restart it', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookie = await identity(mf); let a = await join(mf, cookie, '재접속으쌰동료');
    const b = await join(mf, await identity(mf), '남은으쌰동료');
    await toggle(a, true, 'exit-arm-first'); await toggle(b, true, 'exit-arm-second');
    const first = await cheer(a, 'exit-first-cheer');
    a = await join(mf, cookie, '재접속으쌰동료');
    assert.deepEqual(own(a.welcome.players, a.welcome.me.id).shoulder.cheer, first.shoulder.cheer);
    await noNewCheer(b, async () => { assert.equal((await cheer(a, 'exit-first-cheer')).shoulder.cheer.id, first.shoulder.cheer.id); });
    assert.equal((await command(a, { type: 'avatar-action', kind: 'jump', requestId: 'jump-out-of-cheer' })).action.kind, 'jump');
    let snapshot = await room.testSnapshot();
    assert.equal(own(snapshot.players, a.welcome.me.id).shoulder, null);
    assert.equal(own(snapshot.players, b.welcome.me.id).shoulder.count, 1); assert.equal(own(snapshot.players, b.welcome.me.id).shoulder.cheer, undefined);
    await noNewCheer(b, async () => { assert.equal((await cheer(a, 'exit-first-cheer')).shoulder, null); });
    await room.testClock(first.serverTime + 1000, false);
    await toggle(a, true, 'rejoin-with-cooldown');
    assert.equal((await cheer(a, 'rejoined-too-soon')).code, 'SHOULDER_CHEER_COOLDOWN');
    await room.testClock(first.serverTime + 7100, false);
    const second = await cheer(a, 'exit-second-cheer'); assert.equal(second.type, 'shoulder-cheer-state');
    a.socket.close(1000, 'leave group');
    const remaining = await b.wait(message => message.type === 'players' && message.players.length === 1);
    assert.equal(remaining.players[0].shoulder.count, 1); assert.equal(remaining.players[0].shoulder.cheer, undefined);
    snapshot = await room.testSnapshot(); assert.equal(snapshot.alarmAt, null);
  } finally { await mf.dispose(); }
});

test('shoulder cheer keeps bounded socket receipts and retained retries never generate another notice', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '영수증으쌰동료'), b = await join(mf, await identity(mf), '알림검증동료');
    await toggle(a, true, 'receipts-arm-first'); await toggle(b, true, 'receipts-arm-second');
    const start = Date.now(); let last: Message = {};
    for (let i = 0; i < SHOULDER_LINK_RULES.cheerReceiptLimit + 2; i++) {
      await room.testClock(start + i * 8000, false);
      last = await cheer(a, `bounded-cheer-${i}`); assert.equal(last.type, 'shoulder-cheer-state');
    }
    const snapshot = await room.testSnapshot(), actor = own(snapshot.attachments, a.welcome.me.id);
    assert.equal(actor.shoulderCheerReceipts.length, SHOULDER_LINK_RULES.cheerReceiptLimit);
    assert.equal(actor.shoulderCheerReceipts[0], 'bounded-cheer-2');
    await noNewCheer(b, async () => { assert.equal((await cheer(a, 'bounded-cheer-2')).shoulder.cheer.id, last.shoulder.cheer.id); });
    assert.equal(snapshot.alarmAt, null);
  } finally { await mf.dispose(); }
});

test('repair synchronizes contiguous group phases, cancels singletons and never revives expired cheers', () => {
  const phase = { id: 'pure-cheer', startedAt: 1000, expiresAt: 7000 };
  const player = (index: number, hasCheer = true): ShoulderPlayer => ({ id: String(index), x: index * 0.78, z: -4, seat: null, shoulder: { groupId: 'pure-group', index, count: 4, facing: 0, since: 1, ...(hasCheer ? { cheer: phase, cheerNextAt: 8000 } : {}) } });
  const split = repairShoulderLinks([player(0), player(2), player(3, false)], 2000);
  assert.equal(split.find(change => change.id === '0')!.shoulder.cheer, undefined);
  const right = split.filter(change => change.id !== '0');
  assert.ok(right.every(change => change.shoulder.count === 2)); assert.ok(right.every(change => change.shoulder.cheer?.id === phase.id));
  const group = right.map(change => ({ ...player(Number(change.id)), shoulder: change.shoulder }));
  assert.ok(repairShoulderLinks(group, 7100).every(change => change.shoulder.cheer === undefined && change.shoulder.cheerNextAt === 8000));
  const actor: ShoulderPlayer = { id: 'late', x: 3, z: -4, seat: null, shoulder: null };
  assert.ok(joinShoulderLinks([...group, actor], actor, 7100).every(change => change.shoulder.cheer === undefined));
  const valid: ShoulderLinkView = { groupId: 'valid', index: 0, count: 2, facing: 0, since: 1, cheer: phase, cheerNextAt: 8000 };
  assert.ok(isShoulderLinkView(valid)); assert.equal(isShoulderLinkView({ ...valid, count: 1 }), false);
  assert.equal(isShoulderLinkView({ ...valid, cheer: { ...phase, expiresAt: Infinity } }), false);
});
