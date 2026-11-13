import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join } from './office-helpers';
import { CHAT_BURST } from '../shared/chat-burst';

const SECOND = CHAT_BURST.refillMs;

test('office chat takes five lines back to back, refuses the sixth with the refill time and refills a token a second', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const now = await room.testFreezeClock();
    const cookie = await identity(mf);
    let a = await join(mf, cookie, '연속으로말해요');
    const b = await join(mf, await identity(mf), '듣는동료');
    const say = (requestId: string, text: string) => { a.send({ type: 'chat', text, requestId }); return a.wait(message => message.requestId === requestId); };
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      const own = await say(`office-burst-${index}`, `연속 ${index}`);
      assert.equal(own.type, 'chat', `message ${index + 1} needs no wait`); assert.equal(own.message.sentAt, now); ids.push(own.message.id);
    }
    // Everyone hears all five, in the order they were sent.
    const heard: string[] = [];
    for (let index = 0; index < 5; index++) heard.push((await b.wait(message => message.type === 'chat')).message.id);
    assert.deepEqual(heard, ids);
    const sixth = await say('office-burst-sixth', '여섯 번째');
    assert.equal(sixth.code, 'CHAT_COOLDOWN'); assert.equal(sixth.retryAt, now + SECOND);
    // A resent request returns the same message and costs nothing.
    assert.equal((await say('office-burst-4', '연속 4')).message.id, ids[4]);
    assert.equal(b.messages.some(message => message.type === 'chat'), false, 'a replay is acknowledged only to its author');
    await room.testClock(now + SECOND - 1, false);
    assert.equal((await say('office-burst-sixth', '여섯 번째')).retryAt, now + SECOND, 'a refusal does not push the next token away');
    await room.testClock(now + SECOND, false);
    const refilled = await say('office-burst-sixth', '여섯 번째');
    assert.equal(refilled.type, 'chat', 'the refused request goes through under the same number once a token arrives');
    assert.equal((await b.wait(message => message.type === 'chat')).message.id, refilled.message.id);
    assert.equal((await say('office-refill-one-only', '일곱 번째')).retryAt, now + 2 * SECOND, 'one second buys one message, not a new burst');
    // A late joiner still sees the newest bubble of each speaker.
    const late = await join(mf, await identity(mf), '늦게온동료');
    assert.deepEqual(late.welcome.chats.map((message: { id: string }) => message.id), [refilled.message.id]);
    // Reopening the tab does not refill the allowance.
    a = await join(mf, cookie, '연속으로말해요');
    assert.equal((await say('office-reconnect-empty', '다시 접속')).retryAt, now + 2 * SECOND);
    // The 2,048-byte socket attachment carries the bucket as one number.
    await room.testClock(now + 3 * SECOND, false);
    assert.equal((await say('office-two-left-0', '둘 중 하나')).type, 'chat');
    assert.equal((await say('office-two-left-1', '둘 중 둘')).type, 'chat');
    assert.equal((await say('office-two-left-2', '셋은 아직')).retryAt, now + 4 * SECOND);
    // A quiet stretch restores the whole burst.
    await room.testClock(now + 60 * SECOND, false);
    for (let index = 0; index < 5; index++) assert.equal((await say(`office-second-burst-${index}`, `다시 ${index}`)).type, 'chat');
    assert.equal((await say('office-second-burst-sixth', '또 여섯 번째')).retryAt, now + 61 * SECOND);
  } finally { await mf.dispose(); }
});

test('closing the socket and joining again does not buy a new burst, and any request of the burst can be replayed', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const now = await room.testFreezeClock();
    const cookie = await identity(mf);
    let a = await join(mf, cookie, '나갔다오는사람');
    const b = await join(mf, await identity(mf), '듣는동료');
    const say = (requestId: string, text: string) => { a.send({ type: 'chat', text, requestId }); return a.wait(message => message.requestId === requestId); };
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) ids.push((await say(`office-leave-${index}`, `나가기 전 ${index}`)).message.id);
    for (let index = 0; index < 5; index++) await b.wait(message => message.type === 'chat');
    // An earlier request of the same burst, not only the newest, is answered with its own message and costs nothing.
    assert.equal((await say('office-leave-0', '나가기 전 0')).message.id, ids[0]);
    assert.equal((await say('office-leave-2', '나가기 전 2')).message.id, ids[2]);
    assert.equal((await say('office-leave-2', '바꾼 말')).code, 'REQUEST_REUSED');
    assert.equal(b.messages.some(message => message.type === 'chat'), false, 'a replay is not broadcast again');
    // The tab really closes: the room no longer lists the player, so nothing is carried over from an open socket.
    a.socket.close(1000);
    await b.wait(message => message.type === 'players' && message.players.length === 1);
    a = await join(mf, cookie, '나갔다오는사람');
    assert.equal((await say('office-back-0', '돌아왔어요')).retryAt, now + SECOND, 'the allowance is the same one as before leaving');
    assert.equal((await say('office-leave-4', '나가기 전 4')).message.id, ids[4], 'a request sent before the disconnect is still recognised');
    await room.testClock(now + SECOND, false);
    assert.equal((await say('office-back-0', '돌아왔어요')).type, 'chat');
    a.socket.close(1000);
    await b.wait(message => message.type === 'players' && message.players.length === 1);
    a = await join(mf, cookie, '나갔다오는사람');
    assert.equal((await say('office-back-1', '또 돌아왔어요')).retryAt, now + 2 * SECOND);
    assert.equal(b.messages.filter(message => message.type === 'chat').length, 1, 'six lines in all reached the room');
  } finally { await mf.dispose(); }
});
