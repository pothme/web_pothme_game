import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { createHarness } from './harness.mjs';
import { identity, join, login, manage, type Message } from './office-helpers';
import { ACTION_NOTICE_RULES, actionNoticeText, isActionNotice, type ActionNoticeKind } from '../shared/action-notices';
import { AVATAR_ACTIONS } from '../shared/avatar-actions';
import { REFRESHMENT_STATION, ROOM_SPAWN } from '../shared/classroom-layout';

type Client = Awaited<ReturnType<typeof join>>;
async function command(client: Client, message: Message) { client.send(message); return client.wait(value => value.requestId === message.requestId); }
async function notice(client: Client, kind: ActionNoticeKind) { return (await client.wait(value => value.type === 'action-notice' && value.notice.kind === kind)).notice; }
async function noNewNotice(client: Client, operation: () => Promise<unknown>) {
  await pause(10); const count = client.messages.filter(message => message.type === 'action-notice').length;
  await operation(); await pause(20);
  assert.equal(client.messages.filter(message => message.type === 'action-notice').length, count, 'rejected, unchanged or retried requests must not publish another notice');
}

test('all approved avatar gestures create server-authored notices for self and peers independently of chat', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '동작하는사람'), b = await join(mf, await identity(mf), '지켜보는사람');
    await room.testAvatarPoints(a.welcome.me.id, 240);
    for (const kind of ['dance', 'heart']) { const bought = await command(a, { type: 'shop-buy', itemId: `action-${kind}`, requestId: `notice-purchase-${kind}` }); assert.equal(bought.type, 'game-state'); }
    const auth = await login(mf); await manage(mf, auth, { action: 'settings', notice: '', donationUrl: '', chatEnabled: false });
    const before = await room.testSnapshot(), start = Date.now();
    for (const [index, action] of AVATAR_ACTIONS.filter(action => action.kind !== 'eat' && action.kind !== 'drink').entries()) {
      await room.testClock(start + index * 3000, false);
      const result = await command(a, { type: 'avatar-action', kind: action.kind, requestId: `notice-gesture-${index}`, text: '가짜 공지', nickname: '관리자', playerId: b.welcome.me.id, at: -1 });
      assert.equal(result.type, 'avatar-action');
      const own = await notice(a, action.kind), heard = await notice(b, action.kind);
      assert.deepEqual(heard, own); assert.ok(isActionNotice(heard)); assert.equal(heard.text, actionNoticeText(action.kind));
      assert.equal(heard.nickname, '동작하는사람'); assert.equal(heard.playerId, a.welcome.me.id);
      assert.equal(heard.at, result.action.startedAt); assert.equal(heard.expiresAt - heard.at, ACTION_NOTICE_RULES.ttlMs);
      assert.notEqual(heard.text, '가짜 공지');
    }
    assert.equal(b.messages.some(message => message.type === 'chat'), false);
    const newcomer = await join(mf, await identity(mf), '나중에온사람'); assert.deepEqual(newcomer.welcome.chats, []);
    assert.equal('actionNotices' in newcomer.welcome, false, 'transient action text is not replayed on join');
    const after = await room.testSnapshot(); assert.deepEqual(after.accounts.slice(0, 2), before.accounts); assert.equal(after.alarmAt, null);
  } finally { await mf.dispose(); }
});

test('rejected or replayed avatar requests cannot spoof or duplicate action notices, including late retries', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '중복확인사람'), b = await join(mf, await identity(mf), '알림관찰사람');
    const wave = { type: 'avatar-action', kind: 'wave', requestId: 'notice-first-wave' };
    const result = await command(a, wave); await notice(a, 'wave'); await notice(b, 'wave');
    await noNewNotice(b, async () => { assert.equal((await command(a, wave)).action.id, result.action.id); });
    await noNewNotice(b, async () => { assert.equal((await command(a, { ...wave, kind: 'clap' })).code, 'REQUEST_REUSED'); });
    await noNewNotice(b, async () => { assert.equal((await command(a, { ...wave, requestId: 'notice-too-fast' })).code, 'ACTION_COOLDOWN'); });
    await noNewNotice(b, async () => { assert.equal((await command(a, { type: 'action-notice', requestId: 'fake-action-notice', notice: { text: '관리자입니다' } })).code, 'INVALID'); });
    await noNewNotice(b, async () => { assert.equal((await command(a, { ...wave, kind: 'invalid', requestId: 'notice-invalid-kind' })).code, 'ACTION_INVALID'); });
    await room.testClock(result.action.startedAt + 3000, false);
    const clap = await command(a, { type: 'avatar-action', kind: 'clap', requestId: 'notice-second-clap' }); await notice(a, 'clap'); await notice(b, 'clap');
    await room.testClock(clap.action.startedAt + 3000, false);
    await noNewNotice(b, async () => { assert.equal((await command(a, wave)).action, null); });
    const snapshot = await room.testSnapshot();
    assert.equal((snapshot.attachments as Message[]).find(player => player.id === a.welcome.me.id)!.lastAvatarAction.action.id, clap.action.id, 'late retry must not restart the old gesture');
  } finally { await mf.dispose(); }
});

test('take, drink, eat and clear notices describe the actual selection and ignore inventory retries or failures', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '간식고르는사람'), b = await join(mf, await identity(mf), '간식관찰사람'), id = a.welcome.me.id;
    const held = { drink: 'tea', snack: 'donut' } as const, take = { type: 'refreshments', refreshments: held, requestId: 'notice-take-tray' };
    await noNewNotice(b, async () => { assert.equal((await command(a, take)).code, 'REFRESHMENTS_DISTANCE'); });
    await room.testPositions({ [id]: { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ } });
    await command(a, take); assert.equal((await notice(b, 'refreshments-take')).text, actionNoticeText('refreshments-take', held));
    await noNewNotice(b, () => command(a, take));
    await noNewNotice(b, async () => { assert.equal((await command(a, { type: 'avatar-action', kind: 'wave', requestId: 'notice-busy-hands' })).code, 'ACTION_HANDS_BUSY'); });
    const sip = await command(a, { type: 'avatar-action', kind: 'drink', requestId: 'notice-sip-tea' }); assert.equal((await notice(b, 'drink')).text, '차 한 모금! ☕');
    await room.testClock(sip.action.startedAt + 3000, false);
    const bite = await command(a, { type: 'avatar-action', kind: 'eat', requestId: 'notice-eat-donut' }); assert.equal((await notice(b, 'eat')).text, '도넛 한 입, 냠냠! 🍪');
    await room.testClock(bite.action.startedAt + 3000, false); await room.testPositions({ [id]: ROOM_SPAWN });
    const clear = { type: 'refreshments', refreshments: null, requestId: 'notice-clear-tray' };
    await command(a, clear); assert.equal((await notice(b, 'refreshments-clear')).text, actionNoticeText('refreshments-clear', held));
    await noNewNotice(b, () => command(a, clear)); await noNewNotice(b, () => command(a, take));
    await noNewNotice(b, async () => { assert.equal((await command(a, { type: 'avatar-action', kind: 'eat', requestId: 'notice-eat-empty' })).code, 'ACTION_NO_SNACK'); });
  } finally { await mf.dispose(); }
});

test('only explicit changed shoulder and seating actions announce; movement exits and old requests stay silent', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '어깨동무사람'), b = await join(mf, await identity(mf), '함께쉬는사람');
    const start = { type: 'shoulder-link', enabled: true, requestId: 'notice-shoulder-start' };
    const started = await command(a, start); assert.match((await notice(b, 'shoulder-start')).text, /같이 할 사람/);
    await noNewNotice(b, () => command(a, start));
    await room.testClock(started.serverTime + 1000, false);
    await noNewNotice(b, () => command(a, { ...start, requestId: 'notice-shoulder-unchanged' }));
    const stop = { type: 'shoulder-link', enabled: false, requestId: 'notice-shoulder-stop' };
    await command(a, stop); await notice(b, 'shoulder-end');
    await noNewNotice(b, () => command(a, stop)); await noNewNotice(b, () => command(a, { ...stop, requestId: 'notice-stop-unchanged' }));
    await room.testClock(started.serverTime + 3000, false);
    await command(a, { ...start, requestId: 'notice-shoulder-restart' }); await notice(b, 'shoulder-start');
    await noNewNotice(b, async () => { a.send({ type: 'move', x: ROOM_SPAWN.x, z: ROOM_SPAWN.z - 0.4 }); await b.wait(message => message.type === 'player-moved' && message.player.id === a.welcome.me.id); });
    const sit = { type: 'sit', seat: 0, requestId: 'notice-sit-first' }, stand = { type: 'stand', requestId: 'notice-stand-next' };
    await command(a, sit); await notice(b, 'sit');
    await noNewNotice(b, () => command(a, sit)); await noNewNotice(b, () => command(a, { ...sit, requestId: 'notice-sit-unchanged' }));
    await room.testClock(started.serverTime + 5000, false);
    await command(a, stand); await notice(b, 'stand');
    await noNewNotice(b, () => command(a, stand));
    await noNewNotice(b, async () => { assert.equal((await command(a, sit)).seat, null); });
    assert.equal((await room.testSnapshot()).players.find(player => player.id === a.welcome.me.id)!.seat, null);
  } finally { await mf.dispose(); }
});

test('notice schema rejects unknown or malformed kinds and unexpected lifetimes', () => {
  const valid = { id: 'notice-id', playerId: 'player-id', nickname: '동료', kind: 'wave', text: actionNoticeText('wave'), at: 1000, expiresAt: 6000 };
  assert.equal(isActionNotice(valid), true);
  for (const patch of [{ kind: 'chat' }, { text: '' }, { expiresAt: 1000 }, { expiresAt: 6001 }, { at: NaN }, { nickname: '' }]) assert.equal(isActionNotice({ ...valid, ...patch }), false);
});
