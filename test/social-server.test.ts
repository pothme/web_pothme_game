import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import type { Miniflare, WebSocket as LocalSocket } from 'miniflare';
import { createHarness } from './harness.mjs';
import { SEATS } from '../shared/classroom-layout';

type Message = Record<string, any>;
const origin = 'http://podeumgo.test';
async function identity(mf: Miniflare) {
  const response = await mf.dispatchFetch(`${origin}/api/session`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}
function observe(socket: LocalSocket) {
  const messages: Message[] = [];
  const listeners = new Set<() => void>();
  socket.addEventListener('message', (event) => { messages.push(JSON.parse(String(event.data))); for (const listener of listeners) listener(); });
  socket.accept();
  return {
    socket, messages,
    send(message: Message) { socket.send(JSON.stringify(message)); },
    wait(predicate: (value: Message) => boolean): Promise<Message> {
      return new Promise((resolve, reject) => {
        const check = () => { const index = messages.findIndex(predicate); if (index < 0) return; clearTimeout(timer); listeners.delete(check); resolve(messages.splice(index, 1)[0]!); };
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`Missing expected message: ${JSON.stringify(messages)}`)); }, 5000);
        listeners.add(check); check();
      });
    },
  };
}
async function join(mf: Miniflare, cookie: string, nickname: string) {
  const response = await mf.dispatchFetch(`${origin}/api/room?nickname=${encodeURIComponent(nickname)}`, { headers: { Upgrade: 'websocket', Cookie: cookie, Origin: origin } });
  assert.equal(response.status, 101);
  const client = observe(response.webSocket!);
  return { ...client, welcome: await client.wait((message) => message.type === 'welcome') };
}

test('real chat authenticates the author, normalizes text, rate limits and expires without wallet changes', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookie = await identity(mf);
    let a = await join(mf, cookie, '말하는학생');
    const b = await join(mf, await identity(mf), '듣는학생');
    const before = await room.testSnapshot();
    const input = { type: 'chat', text: '  안녕\n\t친구\u0000  ', requestId: 'first-chat-request', nickname: '관리자', playerId: b.welcome.me.id, sentAt: -1, expiresAt: 99999999999999 };
    a.send(input);
    const own = await a.wait((message) => message.type === 'chat');
    const heard = await b.wait((message) => message.type === 'chat');
    assert.deepEqual(heard, own);
    assert.equal(heard.message.text, '안녕 친구');
    assert.equal(heard.message.nickname, '말하는학생');
    assert.equal(heard.message.playerId, a.welcome.me.id);
    assert.equal(heard.message.expiresAt - heard.message.sentAt, 8000);
    assert.ok(heard.message.sentAt > 0);
    a.send(input);
    assert.equal((await a.wait((message) => message.type === 'chat')).message.id, own.message.id);
    assert.equal(b.messages.some((message) => message.type === 'chat' && message.message.id === own.message.id), false, 'duplicate is acknowledged only to its author');
    a.send({ ...input, text: '다른 내용' });
    assert.equal((await a.wait((message) => message.requestId === input.requestId)).code, 'REQUEST_REUSED');
    for (const [index, text] of ['', '\u0000', '😀'.repeat(81)].entries()) {
      const requestId = `bad-chat-${index}`;
      a.send({ type: 'chat', text, requestId });
      assert.equal((await a.wait((message) => message.requestId === requestId)).code, 'CHAT_TEXT');
    }
    const c = await join(mf, await identity(mf), '새친구학생');
    assert.equal(c.welcome.chats[0].id, own.message.id);
    a = await join(mf, cookie, '새닉네임학생');
    assert.equal(a.welcome.chats[0].id, own.message.id);
    a.send(input);
    assert.equal((await a.wait((message) => message.type === 'chat')).message.id, own.message.id);
    await room.testClock(own.message.sentAt + 1201, false);
    a.send({ type: 'chat', text: '😀'.repeat(80), requestId: 'unicode-chat-good' });
    const second = await a.wait((message) => message.requestId === 'unicode-chat-good');
    assert.equal(second.message.nickname, '새닉네임학생');
    assert.equal([...second.message.text].length, 80);
    await room.testClock(second.message.expiresAt + 1, false);
    const d = await join(mf, await identity(mf), '나중에온학생');
    assert.deepEqual(d.welcome.chats, []);
    const after = await room.testSnapshot();
    for (const account of before.accounts) {
      const current = after.accounts.find((value) => value.id === account.id)!;
      assert.equal(current.balance, account.balance);
      assert.equal(current.next_play_at, account.next_play_at);
    }
  } finally { await mf.dispose(); }
});

test('real seating claims are exclusive, preserve appearance and transfer on tab replacement', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookies = [await identity(mf), await identity(mf)];
    const clients = [await join(mf, cookies[0]!, '첫번째학생'), await join(mf, cookies[1]!, '두번째학생')];
    clients[0]!.send({ type: 'sit', seat: 0, requestId: 'concurrent-seat-a' });
    clients[1]!.send({ type: 'sit', seat: 0, requestId: 'concurrent-seat-b' });
    const results = await Promise.all(clients.map((client, index) => client.wait((message) => message.requestId === `concurrent-seat-${index === 0 ? 'a' : 'b'}`)));
    assert.equal(results.filter((message) => message.type === 'seat-state').length, 1);
    assert.equal(results.filter((message) => message.code === 'SEAT_OCCUPIED').length, 1);
    const winnerIndex = results.findIndex((message) => message.type === 'seat-state');
    const loserIndex = 1 - winnerIndex;
    let winner = clients[winnerIndex]!;
    const loser = clients[loserIndex]!;
    loser.send({ type: 'sit', seat: 1, requestId: 'other-free-seat' });
    assert.equal((await loser.wait((message) => message.requestId === 'other-free-seat')).seat, 1);
    loser.send({ type: 'sit', seat: 0, requestId: 'occupied-again' });
    assert.equal((await loser.wait((message) => message.requestId === 'occupied-again')).code, 'SEAT_OCCUPIED');
    assert.equal((await room.testSnapshot()).players.find((player) => player.id === loser.welcome.me.id)!.seat, 1);
    winner.send({ type: 'sit', seat: SEATS.length, requestId: 'invalid-seat-id' });
    assert.equal((await winner.wait((message) => message.requestId === 'invalid-seat-id')).code, 'SEAT_INVALID');
    winner = await join(mf, cookies[winnerIndex]!, '자리를지킨학생');
    assert.equal(winner.welcome.players.filter((player: Message) => player.seat === 0).length, 1);
    assert.equal(winner.welcome.players.find((player: Message) => player.id === winner.welcome.me.id).seat, 0);
    winner.send({ type: 'write', text: '사용하지 않는 칠판', requestId: 'seated-board-write' });
    assert.equal((await winner.wait((message) => message.requestId === 'seated-board-write')).code, 'INVALID');
    winner.send({ type: 'move', x: 5, z: 5 });
    winner.send({ type: 'sit', seat: 0, requestId: 'same-seat-confirm' });
    await winner.wait((message) => message.requestId === 'same-seat-confirm');
    const seated = (await room.testSnapshot()).players.find((player) => player.id === winner.welcome.me.id)!;
    assert.equal(seated.seat, 0);
    assert.equal(seated.x, SEATS[0]!.x);
    assert.equal(seated.z, SEATS[0]!.z);
    assert.equal(seated.breadShuttle, false);
    winner.send({ type: 'stand', requestId: 'stand-up-request' });
    assert.equal((await winner.wait((message) => message.requestId === 'stand-up-request')).seat, null);
    const standing = (await room.testSnapshot()).players.find((player) => player.id === winner.welcome.me.id)!;
    assert.equal(standing.x, SEATS[0]!.standX);
    assert.equal(standing.z, SEATS[0]!.standZ);
    assert.equal(standing.breadShuttle, false);
    loser.socket.close(1000, 'leave seat');
    await pause(40);
    winner.send({ type: 'sit', seat: 1, requestId: 'released-chair' });
    assert.equal((await winner.wait((message) => message.requestId === 'released-chair')).seat, 1);
    const final = await room.testSnapshot();
    assert.equal(final.players.length, 1);
    assert.equal(final.accounts.find((account) => account.id === winner.welcome.me.id)!.next_play_at, 0);
    assert.equal(final.accounts.find((account) => account.id === loser.welcome.me.id)!.balance, 0);
  } finally { await mf.dispose(); }
});
