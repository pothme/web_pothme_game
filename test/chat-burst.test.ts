import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_BURST, chatBurstEmptyUntil, chatBurstReplay, chatBurstTake, chatBurstTokens, createChatBurstMirror } from '../shared/chat-burst';
import { CHAT_HOLD_HINT, createChatOutbox } from '../src/chat-outbox';
import { createGameHubHarness } from './game-hub-harness.mjs';

const SECOND = CHAT_BURST.refillMs;
function spend(fullAt: number | undefined, now: number) { const result = chatBurstTake(fullAt, now); assert.equal(result.ok, true, `a token at ${now}`); return (result as { fullAt: number }).fullAt; }

test('the rule is five messages back to back, then one a second', () => {
  assert.deepEqual({ ...CHAT_BURST }, { capacity: 5, refillMs: 1000 });
  const start = 1_700_000_000_000;
  let bucket: number | undefined;
  assert.equal(chatBurstTokens(bucket, start), 5);
  for (let index = 0; index < 5; index++) { bucket = spend(bucket, start); assert.equal(chatBurstTokens(bucket, start), 4 - index); }
  assert.deepEqual(chatBurstTake(bucket, start), { ok: false, retryAt: start + SECOND }, 'the sixth waits for the first refill');
  assert.deepEqual(chatBurstTake(bucket, start + SECOND - 1), { ok: false, retryAt: start + SECOND });
  // Refill is one token a second, not a full bucket at once.
  bucket = spend(bucket, start + SECOND);
  assert.deepEqual(chatBurstTake(bucket, start + SECOND), { ok: false, retryAt: start + 2 * SECOND });
  assert.equal(chatBurstTokens(bucket, start + 3 * SECOND + 999), 2);
  assert.equal(chatBurstTokens(bucket, start + 4 * SECOND), 3);
  // A refusal costs nothing: asking again and again does not push the next token away.
  for (let index = 0; index < 50; index++) assert.deepEqual(chatBurstTake(bucket, start + SECOND + index), { ok: false, retryAt: start + 2 * SECOND });
  // Sustained flooding is exactly one accepted message a second.
  let accepted = 0;
  for (let time = start + 2 * SECOND; time < start + 62 * SECOND; time += 50) { const result = chatBurstTake(bucket, time); if (result.ok) { bucket = result.fullAt; accepted++; } }
  assert.equal(accepted, 60);
  // A quiet stretch restores the whole burst and no more than that.
  const later = start + 3_600_000;
  assert.equal(chatBurstTokens(bucket, later), 5);
  for (let index = 0; index < 5; index++) bucket = spend(bucket, later + index);
  assert.equal(chatBurstTake(bucket, later + 5).ok, false);
});

test('a bucket from a wrong clock or a damaged value can never lock anyone out for longer than a refill', () => {
  const now = 5_000_000;
  for (const stored of [now + 86_400_000, Infinity]) assert.deepEqual(chatBurstTake(stored, now), { ok: false, retryAt: now + SECOND });
  for (const stored of [undefined, null, 'soon', NaN, -Infinity, 0, -5]) assert.deepEqual(chatBurstTake(stored as number | undefined, now), { ok: true, fullAt: now + SECOND });
});

test('receipts alone rebuild the bucket and never make it stricter than the stored one', () => {
  const start = 9_000_000, times = [0, 10, 20, 30, 40].map(offset => start + offset);
  let bucket: number | undefined; for (const time of times) bucket = spend(bucket, time);
  assert.equal(chatBurstReplay(times), bucket);
  assert.equal(chatBurstReplay([]), 0);
  assert.deepEqual(chatBurstTake(chatBurstReplay(times), start + 50), { ok: false, retryAt: start + SECOND });
  // Only the newest receipts survive; the bucket rebuilt from them is the same or more generous.
  const sustained = Array.from({ length: 30 }, (_, index) => start + index * SECOND);
  let exact: number | undefined; for (const time of [...times, ...sustained.map(time => time + SECOND)]) exact = spend(exact, time);
  assert.ok(chatBurstReplay(sustained.slice(-20).map(time => time + SECOND)) <= exact!);
  assert.deepEqual(chatBurstTake(chatBurstEmptyUntil(start + 700), start), { ok: false, retryAt: start + 700 });
});

test('the sender mirror answers at once, waits a little longer than the rule and believes the server', () => {
  let now = 1_000_000;
  const mirror = createChatBurstMirror(() => now, 150);
  for (let index = 0; index < 5; index++) { assert.equal(mirror.retryAt(), 0, `message ${index + 1} needs no wait`); mirror.take(); now += 3; }
  const first = mirror.retryAt();
  assert.ok(first >= 1_000_000 + SECOND && first <= 1_000_000 + SECOND + 150, 'never earlier than the server would allow');
  now = first - 1; assert.equal(mirror.retryAt(), first);
  now = first; assert.equal(mirror.retryAt(), 0); mirror.take();
  assert.ok(mirror.retryAt() >= first + SECOND);
  // The server knows better: a refusal moves the mirror, an older one never moves it back.
  mirror.reset(); assert.equal(mirror.retryAt(), 0);
  mirror.reject(now + 800); assert.equal(mirror.retryAt(), now + 800);
  mirror.reject(now + 100); assert.equal(mirror.retryAt(), now + 800);
  now += 800; assert.equal(mirror.retryAt(), 0);
});

function fakeField() {
  let now = 2_000_000, serial = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const field = { value: '', status: '', changes: 0, returned: 0 };
  const outbox = createChatOutbox({
    now: () => now, timeoutMs: 5000, timeoutText: '시간 초과',
    read: () => field.value, write: text => { field.value = text; }, status: text => { field.status = text; },
    changed: () => { field.changes++; }, returned: () => { field.returned++; },
    setTimer: (run, ms) => { timers.set(++serial, { at: now + ms, run }); return serial; }, clearTimer: timer => { timers.delete(timer as number); },
  });
  const sent: { id: string; text: string }[] = [];
  /** What every chat field does on Enter. */
  function enter() {
    const text = field.value.trim(); if (!text || !outbox.ready()) return false;
    const id = `request-${sent.length + 1}`; sent.push({ id, text }); outbox.sent(id, text); field.value = ''; return true;
  }
  function advance(ms: number) {
    const end = now + ms;
    for (;;) { const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = Math.max(now, due[1].at); timers.delete(due[0]); due[1].run(); }
    now = end;
  }
  return { field, outbox, sent, enter, advance, now: () => now };
}

test('a chat field sends five lines without waiting for an echo and holds the sixth with a hint', () => {
  const { field, outbox, sent, enter, advance } = fakeField();
  for (const text of ['하나', '둘', '셋', '넷', '다섯']) { field.value = text; assert.equal(enter(), true, text); assert.equal(field.value, '', 'the field is free at once'); }
  assert.equal(outbox.size(), 5, 'five messages are in flight together');
  assert.deepEqual(sent.map(item => item.text), ['하나', '둘', '셋', '넷', '다섯']);
  field.value = '여섯';
  assert.equal(enter(), false); assert.equal(field.value, '여섯', 'the held text stays in the field'); assert.equal(field.status, CHAT_HOLD_HINT);
  assert.equal(outbox.waiting(), true);
  // Echoes may arrive in any order and each settles only its own message.
  for (const id of ['request-3', 'request-1', 'request-2', 'request-5', 'request-4']) assert.equal(outbox.ack(id), true);
  assert.equal(outbox.ack('request-1'), false); assert.equal(outbox.size(), 0);
  // The field wakes by itself when the token arrives; the hint goes away and Enter works again.
  const changes = field.changes; advance(1200);
  assert.equal(outbox.waiting(), false); assert.equal(field.status, ''); assert.ok(field.changes > changes, 'the send button is re-enabled without any input');
  assert.equal(enter(), true); assert.equal(sent.at(-1)!.text, '여섯'); assert.equal(field.value, '');
});

test('a refused, timed-out or disconnected message comes back instead of being lost', () => {
  const { field, outbox, enter, advance, now } = fakeField();
  field.value = '첫 번째'; enter(); field.value = '두 번째'; enter();
  // Refused while the field is empty: the text returns to the field with the reason.
  assert.equal(outbox.fail('request-2', '조금만 천천히 말해 주세요.', now() + 900), true);
  assert.equal(field.value, '두 번째'); assert.equal(field.status, '조금만 천천히 말해 주세요.'); assert.equal(field.returned, 1);
  assert.equal(outbox.waiting(), true, 'the server refusal empties the mirror');
  assert.equal(enter(), false); assert.equal(field.value, '두 번째');
  advance(1000); assert.equal(outbox.waiting(), false); assert.equal(enter(), true);
  // Refused while the user is already typing something else: the draft is not overwritten.
  field.value = '쓰는 중';
  assert.equal(outbox.fail('request-1', '보내지 못했어요.'), true);
  assert.equal(field.value, '쓰는 중'); assert.match(field.status, /보내지 못했어요\..*첫 번째/);
  assert.equal(outbox.fail('request-1', '다시'), false, 'an unknown request belongs to someone else');
  // No echo within the limit counts as not sent.
  field.value = ''; assert.equal(outbox.size(), 1); advance(5000);
  assert.equal(outbox.size(), 0); assert.equal(field.value, '두 번째'); assert.equal(field.status, '시간 초과');
  // A lost connection returns everything still in flight, oldest first.
  field.value = '가'; enter(); field.value = '나'; enter();
  outbox.abandon('연결이 끊겼어요.');
  assert.equal(field.value, '가 나'); assert.equal(outbox.size(), 0);
  advance(60_000); assert.equal(field.value, '가 나', 'no timer fires for an abandoned message');
  outbox.reset(); assert.equal(outbox.waiting(), false);
});

test('an echo that arrives after its deadline takes the handed-back copy out of the field again', () => {
  const { field, outbox, enter, advance } = fakeField();
  field.value = '늦은 말'; enter(); advance(5000);
  assert.equal(field.value, '늦은 말'); assert.equal(field.status, '시간 초과'); assert.equal(outbox.size(), 0);
  // The server had taken it after all: the line is in the log, so the field and the notice are cleared.
  assert.equal(outbox.ack('request-1'), true);
  assert.equal(field.value, ''); assert.equal(field.status, '');
  assert.equal(outbox.ack('request-1'), false, 'a second echo of the same request is nothing new');
  // The person already started another line: only the notice goes, the draft stays.
  field.value = '또 늦은 말'; enter(); field.value = '쓰는 중'; advance(5000);
  assert.match(field.status, /시간 초과.*또 늦은 말/);
  assert.equal(outbox.ack('request-2'), true); assert.equal(field.value, '쓰는 중'); assert.equal(field.status, '');
  // A notice about a different message is not wiped by a late echo.
  field.value = '셋째'; enter(); advance(5000); field.value = '';
  field.value = '넷째'; enter(); field.value = ''; assert.equal(outbox.fail('request-4', '조금만 천천히 말해 주세요.'), true);
  assert.equal(outbox.ack('request-3'), true); assert.equal(field.value, '넷째'); assert.equal(field.status, '조금만 천천히 말해 주세요.');
});

test('text that timed out keeps its request number when it is sent again unchanged', () => {
  const { field, outbox, advance } = fakeField();
  let serial = 0; const fresh = () => `fresh-${++serial}`;
  const first = outbox.requestId('다시 보낼 말', fresh); assert.equal(first, 'fresh-1');
  field.value = ''; outbox.sent(first, '다시 보낼 말'); advance(5000);
  assert.equal(field.value, '다시 보낼 말');
  assert.equal(outbox.requestId('다른 말', fresh), 'fresh-2', 'changed text is a new request');
  assert.equal(outbox.requestId('다시 보낼 말', fresh, '다른 사람'), 'fresh-3', 'the same words for someone else are a new request');
  // Pressing Enter on the returned text resends the same request: a server that has it answers with the first copy.
  assert.equal(outbox.requestId('다시 보낼 말', fresh), first);
  field.value = ''; outbox.sent(first, '다시 보낼 말'); assert.equal(outbox.size(), 1); assert.equal(field.status, '', 'sending again answers the notice');
  assert.equal(outbox.ack(first), true); assert.equal(outbox.size(), 0); assert.equal(field.value, '');
  assert.equal(outbox.requestId('다시 보낼 말', fresh), 'fresh-4', 'once echoed, the same words are a new message');
  // The number is not kept for ever.
  const old = outbox.requestId('오래된 말', fresh); outbox.sent(old, '오래된 말'); advance(5000); field.value = ''; advance(61_000);
  assert.notEqual(outbox.requestId('오래된 말', fresh), old);
});

test('editing the field clears a failure notice but not the hold hint', () => {
  const { field, outbox, enter, advance } = fakeField();
  field.value = '하나'; enter(); outbox.fail('request-1', '보내지 못했어요.');
  assert.equal(field.status, '보내지 못했어요.'); outbox.edited(); assert.equal(field.status, '');
  advance(10_000);
  for (const text of ['가', '나', '다', '라', '마']) { field.value = text; enter(); }
  field.value = '바'; assert.equal(enter(), false); assert.equal(field.status, CHAT_HOLD_HINT);
  outbox.edited(); assert.equal(field.status, CHAT_HOLD_HINT, 'the hint stays until a message can go out');
  advance(1200); assert.equal(field.status, '');
});

test('the mirror follows the times the server accepted the burst at, not the times it was typed at', () => {
  let now = 3_000_000;
  const mirror = createChatBurstMirror(() => now, 150);
  // An ordinary line is accepted 40 ms after it leaves.
  mirror.take(); mirror.confirm(now + 40, now); now += 60_000;
  // Five lines leave together on a stalled connection and reach the server 400 ms later.
  const left = now; for (let index = 0; index < 5; index++) mirror.take();
  const typed = mirror.retryAt(); assert.ok(typed <= left + SECOND + 150);
  now += 450; for (let index = 0; index < 5; index++) mirror.confirm(left + 400, left);
  // The connection is quick again: a line sent at `served` arrives 40 ms later, when the server has its token.
  const served = mirror.retryAt();
  assert.ok(served + 40 >= left + 400 + SECOND, 'not before the server has a token');
  assert.ok(served <= left + 400 + SECOND + 150);
  // A steady delay cancels out: echoes never make a part-used bucket wait, and the sixth waits what the rule says.
  mirror.reset(); now += 60_000; const start = now;
  for (let index = 0; index < 4; index++) { mirror.take(); mirror.confirm(now + 300, now); }
  assert.equal(mirror.retryAt(), 0); mirror.take(); mirror.confirm(now + 300, now);
  assert.ok(mirror.retryAt() >= start + SECOND && mirror.retryAt() <= start + SECOND + 150);
  // The outbox passes the echo time on.
  const { field, outbox, enter, advance, now: clock } = fakeField();
  outbox.burst.confirm(clock() - 9_960, clock() - 10_000);
  const sent = clock(); for (const text of ['가', '나', '다', '라', '마']) { field.value = text; enter(); }
  advance(450); for (let index = 1; index <= 5; index++) outbox.ack(`request-${index}`, sent + 400);
  advance(SECOND + 150 - 450); field.value = '바';
  assert.equal(enter(), false, 'the send times alone would let this one go, and the server would refuse it');
  assert.ok(outbox.burst.retryAt() + 40 >= sent + 400 + SECOND);
});

test('game room chat takes a burst of five, charges nothing for a replay and names the retry time', { timeout: 30_000 }, async () => {
  const { mf, hub } = await createGameHubHarness(); try {
    const A = 'a'.repeat(64), B = 'b'.repeat(64), now = 500_000;
    await hub.connect(A, '말하는사람', now); await hub.connect(B, '듣는사람', now);
    const created = await hub.command(A, { type: 'game-create', kind: 'jump-tower', requestId: 'burst-room-create' }, now); assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((await hub.command(B, { type: 'game-join', roomId: created.state.room.id, requestId: 'burst-room-join' }, now)).ok, true);
    const say = (index: number, at: number, id = A) => hub.command(id, { type: 'game-chat', text: `연속 ${index}`, requestId: `burst-room-chat-${id[0]}-${index}` }, at);
    for (let index = 0; index < 5; index++) assert.equal((await say(index, now + index)).ok, true, `message ${index + 1}`);
    assert.deepEqual((await hub.state(B, now + 5)).room.chats.map((chat: { text: string }) => chat.text), [0, 1, 2, 3, 4].map(index => `연속 ${index}`));
    const sixth = await say(5, now + 5); assert.equal(sixth.code, 'CHAT_COOLDOWN'); assert.equal(sixth.retryAt, now + SECOND);
    // A resent request is answered from its receipt and costs nothing.
    assert.equal((await say(4, now + 6)).ok, true); assert.equal((await hub.state(A, now + 6)).room.chats.length, 5);
    assert.equal((await say(5, now + SECOND - 1)).retryAt, now + SECOND, 'the refused request can be retried under the same number');
    assert.equal((await say(5, now + SECOND)).ok, true);
    assert.equal((await say(6, now + SECOND)).retryAt, now + 2 * SECOND);
    // Each member has an allowance of their own.
    for (let index = 0; index < 5; index++) assert.equal((await say(index, now + SECOND, B)).ok, true);
    assert.equal((await say(5, now + SECOND, B)).code, 'CHAT_COOLDOWN');
    for (let index = 7; index < 12; index++) assert.equal((await say(index, now + 10 * SECOND)).ok, true, 'a quiet stretch restores the whole burst');
    assert.equal((await say(12, now + 10 * SECOND)).retryAt, now + 11 * SECOND);
    // Dropping the connection and coming back to the same room does not refill the allowance.
    await hub.disconnect(A, now + 10 * SECOND + 1); await hub.connect(A, '말하는사람', now + 10 * SECOND + 2);
    assert.equal((await say(12, now + 10 * SECOND + 3)).retryAt, now + 11 * SECOND);
    assert.equal((await say(12, now + 11 * SECOND)).ok, true);
  } finally { await mf.dispose(); }
});
