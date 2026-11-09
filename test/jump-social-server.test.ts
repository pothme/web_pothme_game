import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import type { FixtureRoom } from './harness.mjs';
import { identity, join, login, manage } from './office-helpers';
import { JUMP_PORTAL } from '../shared/jump-portal';
import { JUMP_SOCIAL_RULES } from '../shared/jump-social';

type Client = Awaited<ReturnType<typeof join>>;
async function enter(room: FixtureRoom, client: Client, requestId: string) {
  await room.testPositions({ [client.welcome.me.id]: { x: JUMP_PORTAL.x, z: JUMP_PORTAL.z } });
  client.send({ type: 'jump-enter', requestId });
  const state = await client.wait(message => message.type === 'jump-state' && message.requestId === requestId);
  assert.equal(state.state.active, true);
  const history = await client.wait(message => message.type === 'jump-chat-history');
  return { state: state.state, history: history.messages };
}
async function barrier(client: Client, requestId: string) {
  client.send({ type: 'jump-sync', requestId });
  await client.wait(message => message.type === 'jump-state' && message.requestId === requestId);
}

test('tower chat uses server identity/time, normalizes Unicode, and isolates office participants', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const now = await room.testFreezeClock();
    const a = await join(mf, await identity(mf), '타워친구');
    const b = await join(mf, await identity(mf), '점프친구');
    const office = await join(mf, await identity(mf), '사무실친구');
    await enter(room, a, 'tower-enter-first');
    await enter(room, b, 'tower-enter-second');

    office.send({ type: 'jump-chat', requestId: 'office-cannot-chat', text: '밖에서 보내기', playerId: a.welcome.me.id });
    assert.equal((await office.wait(message => message.requestId === 'office-cannot-chat')).code, 'JUMP_INACTIVE');
    a.send({ type: 'jump-chat', requestId: 'tower-author-check', text: '  \u110b\u1161\u11ab\u1102\u1167\u11bc\n\t친구\u0000  ', nickname: '관리자', playerId: office.welcome.me.id, sentAt: -1, expiresAt: Number.MAX_SAFE_INTEGER });
    const own = await a.wait(message => message.requestId === 'tower-author-check');
    const heard = await b.wait(message => message.type === 'jump-chat');
    assert.deepEqual(heard, own);
    assert.equal(heard.message.nickname, '타워친구');
    assert.equal(heard.message.playerId, a.welcome.me.id);
    assert.equal(heard.message.text, '안녕 친구');
    assert.equal(heard.message.sentAt, now);
    assert.equal(heard.message.expiresAt, now + JUMP_SOCIAL_RULES.chatTtlMs);

    office.send({ type: 'chat', text: '사무실에서만 하는 대화', requestId: 'office-room-chat' });
    await office.wait(message => message.requestId === 'office-room-chat');
    await barrier(a, 'tower-office-barrier');
    assert.equal(office.messages.some(message => message.type === 'jump-chat'), false);
    assert.equal(a.messages.some(message => message.type === 'chat' && message.requestId === 'office-room-chat'), false, 'office messages must not reach tower participants');
    a.send({ type: 'chat', text: '타워에서 사무실 채팅 우회', requestId: 'tower-office-spoof' });
    assert.equal((await a.wait(message => message.requestId === 'tower-office-spoof')).code, 'JUMP_AREA');
    const newcomer = await join(mf, await identity(mf), '방금온친구');
    assert.equal(newcomer.welcome.chats.some((message: { id: string }) => message.id === own.message.id), false, 'tower history is never part of the office welcome');
  } finally { await mf.dispose(); }
});

test('tower chat retries are idempotent across reconnect and cooldown and length cannot be bypassed', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const now = await room.testFreezeClock();
    const cookie = await identity(mf);
    let a = await join(mf, cookie, '보내는친구');
    const b = await join(mf, await identity(mf), '받는친구');
    await enter(room, a, 'retry-enter-first');
    await enter(room, b, 'retry-enter-second');
    const input = { type: 'jump-chat', requestId: 'tower-retry-message', text: '함께 올라가자' };
    a.send(input);
    const first = await a.wait(message => message.requestId === input.requestId);
    await b.wait(message => message.type === 'jump-chat');
    a.send(input);
    assert.deepEqual(await a.wait(message => message.requestId === input.requestId), first);
    await barrier(b, 'retry-peer-barrier');
    assert.equal(b.messages.some(message => message.type === 'jump-chat'), false, 'retry acknowledges only its sender');
    a.send({ ...input, text: '같은 번호의 다른 내용' });
    assert.equal((await a.wait(message => message.requestId === input.requestId)).code, 'REQUEST_REUSED');
    a.send({ ...input, requestId: 'tower-too-fast' });
    assert.equal((await a.wait(message => message.requestId === 'tower-too-fast')).code, 'CHAT_COOLDOWN');
    for (const [index, text] of ['', '\u0000\n', '😀'.repeat(81), 123].entries()) {
      const requestId = `tower-invalid-${index}`;
      a.send({ type: 'jump-chat', requestId, text });
      assert.equal((await a.wait(message => message.requestId === requestId)).code, 'CHAT_TEXT');
    }
    a.send({ type: 'jump-chat', requestId: 'short', text: '번호 오류' });
    assert.equal((await a.wait(message => message.requestId === 'short')).code, 'INVALID');
    a = await join(mf, cookie, '새닉네임');
    assert.equal(a.welcome.me.area, 'jump');
    const restored = await a.wait(message => message.type === 'jump-chat-history');
    assert.equal(restored.messages.length, 1);
    a.send(input);
    assert.equal((await a.wait(message => message.requestId === input.requestId)).message.id, first.message.id);
    await room.testClock(now + JUMP_SOCIAL_RULES.chatCooldownMs - 1, false);
    a.send({ ...input, requestId: 'reconnect-too-soon' });
    assert.equal((await a.wait(message => message.requestId === 'reconnect-too-soon')).code, 'CHAT_COOLDOWN');
    await room.testClock(now + JUMP_SOCIAL_RULES.chatCooldownMs, false);
    a.send({ type: 'jump-chat', requestId: 'tower-emoji-eighty', text: '😀'.repeat(80) });
    const next = await a.wait(message => message.requestId === 'tower-emoji-eighty');
    assert.equal(next.type, 'jump-chat');
    assert.equal(next.message.nickname, '새닉네임');
    assert.equal([...next.message.text].length, 80);
    assert.notEqual(next.message.id, first.message.id);
  } finally { await mf.dispose(); }
});

test('tower history keeps the newest forty messages across restart, then expires independently of bubbles', { timeout: 30_000 }, async () => {
  const { mf, room, restart } = await createHarness();
  try {
    const start = await room.testFreezeClock();
    const cookie = await identity(mf);
    let a = await join(mf, cookie, '기록친구');
    await enter(room, a, 'history-enter-first');
    const sent: string[] = [];
    let lastTime = start;
    for (let index = 0; index < 43; index++) {
      lastTime = start + index * JUMP_SOCIAL_RULES.chatCooldownMs;
      await room.testClock(lastTime, false);
      const requestId = `tower-history-${index}`;
      a.send({ type: 'jump-chat', requestId, text: `기록 ${index}` });
      const response = await a.wait(message => message.requestId === requestId);
      assert.equal(response.type, 'jump-chat');
      sent.push(response.message.id);
    }
    await restart();
    await room.testFreezeClock(lastTime + JUMP_SOCIAL_RULES.chatTtlMs + 1);
    a = await join(mf, cookie, '기록친구');
    const history = await a.wait(message => message.type === 'jump-chat-history');
    assert.deepEqual(history.messages.map((message: { id: string }) => message.id), sent.slice(-JUMP_SOCIAL_RULES.historyLimit));
    assert.ok(history.messages.every((message: { expiresAt: number }) => message.expiresAt < lastTime + JUMP_SOCIAL_RULES.chatTtlMs + 1), 'recent log remains after speech bubbles expire');
    await room.testClock(lastTime + JUMP_SOCIAL_RULES.historyTtlMs, false);
    const newcomer = await join(mf, await identity(mf), '나중친구');
    assert.deepEqual((await enter(room, newcomer, 'history-expired-enter')).history, []);
  } finally { await mf.dispose(); }
});

test('admin chat pause, clear and resume cover the tower and clear persists without putting text in audit', { timeout: 30_000 }, async () => {
  const { mf, room, restart } = await createHarness();
  try {
    await room.testFreezeClock();
    const auth = await login(mf), cookie = await identity(mf);
    let a = await join(mf, cookie, '관리대상친구');
    const b = await join(mf, await identity(mf), '같은타워친구');
    const office = await join(mf, await identity(mf), '바깥친구');
    await enter(room, a, 'admin-enter-first');
    await enter(room, b, 'admin-enter-second');
    const input = { type: 'jump-chat', requestId: 'tower-admin-message', text: '감사 기록에 남기지 않을 타워 대화' };
    a.send(input);
    const first = await a.wait(message => message.requestId === input.requestId);
    await b.wait(message => message.type === 'jump-chat');
    const settings = { action: 'settings', notice: '', donationUrl: '', chatEnabled: false };
    assert.equal((await manage(mf, auth, settings)).status, 200);
    await a.wait(message => message.type === 'settings' && message.settings.chatEnabled === false);
    a.send(input);
    assert.equal((await a.wait(message => message.requestId === input.requestId)).code, 'CHAT_DISABLED', 'disabled chat also rejects duplicate receipts');
    assert.equal((await manage(mf, auth, { action: 'clear-chat' })).status, 200);
    await a.wait(message => message.type === 'jump-chat-clear');
    await b.wait(message => message.type === 'jump-chat-clear');
    await office.wait(message => message.type === 'chat-clear');
    assert.equal(office.messages.some(message => message.type === 'jump-chat-clear'), false);
    await restart();
    a = await join(mf, cookie, '관리대상친구');
    assert.equal(a.welcome.settings.chatEnabled, false);
    assert.deepEqual((await a.wait(message => message.type === 'jump-chat-history')).messages, []);
    assert.equal((await manage(mf, auth, { ...settings, chatEnabled: true })).status, 200);
    a.send(input);
    const resumed = await a.wait(message => message.requestId === input.requestId);
    assert.equal(resumed.type, 'jump-chat');
    assert.notEqual(resumed.message.id, first.message.id, 'cleared receipts cannot resurrect old messages');
    assert.equal(JSON.stringify((await room.testSnapshot()).runtime.audit).includes(input.text), false);
  } finally { await mf.dispose(); }
});
