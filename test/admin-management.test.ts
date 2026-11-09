import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, login, admin, manage, origin, type Message } from './office-helpers';

test('management requires current auth, CSRF and same-origin and validates notices and donation hosts', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const body = { action: 'settings', notice: '안내', donationUrl: '', chatEnabled: true };
  assert.equal((await admin(mf, 'manage', body)).status, 401);
  const auth = await login(mf);
  assert.equal((await admin(mf, 'manage', body, auth.cookie)).status, 403);
  assert.equal((await admin(mf, 'manage', body, auth.cookie, auth.csrf, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await manage(mf, auth, { ...body, notice: '😀'.repeat(201) })).status, 400);
  for (const donationUrl of ['http://qr.kakaopay.com/test', 'https://qr.kakaopay.com.evil.invalid/test', 'https://user:pass@qr.kakaopay.com/test', 'https://qr.kakaopay.com:8443/test', 'javascript:alert(1)', 'https://open.kakao.com/test']) assert.equal((await manage(mf, auth, { ...body, donationUrl })).status, 400);
  assert.equal((await room.testSnapshot()).runtime.audit.length, 0);
  const saved = await manage(mf, auth, { ...body, notice: '  오늘\n\u0000 공지  ', donationUrl: 'https://qr.kakaopay.com/test' }).then(r => r.json()) as Message;
  assert.equal(saved.settings.notice, '오늘 공지'); assert.equal(saved.settings.donationUrl, 'https://qr.kakaopay.com/test');
  assert.equal(saved.audit[0].detail.includes('오늘'), false, 'audit stores action summaries, not notice content');
 } finally { await mf.dispose(); }
});

test('chat pause, clear and resume propagate live without logging chat text and settings persist', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const auth = await login(mf), cookie = await identity(mf); let a = await join(mf, cookie, '대화동료');
  a.send({ type: 'chat', text: '로그에 남기지 않을 대화', requestId: 'private-chat-note' }); await a.wait(m => m.type === 'chat');
  const b = await join(mf, await identity(mf), '옆자리동료'); assert.equal(b.welcome.chats.length, 1);
  const settings = { action: 'settings', notice: '점검 안내', donationUrl: 'https://link.kakaopay.com/test', chatEnabled: false };
  assert.equal((await manage(mf, auth, settings)).status, 200);
  await a.wait(m => m.type === 'settings' && m.settings.chatEnabled === false);
  a.send({ type: 'chat', text: '중지 후 입력', requestId: 'paused-chat-message' }); assert.equal((await a.wait(m => m.requestId === 'paused-chat-message')).code, 'CHAT_DISABLED');
  assert.equal((await manage(mf, auth, { action: 'clear-chat' })).status, 200); await a.wait(m => m.type === 'chat-clear'); await b.wait(m => m.type === 'chat-clear');
  const c = await join(mf, await identity(mf), '늦은동료'); assert.deepEqual(c.welcome.chats, []);
  await restart(); a = await join(mf, cookie, '대화동료'); assert.equal(a.welcome.settings.chatEnabled, false); assert.equal(a.welcome.settings.notice, '점검 안내');
  assert.equal((await manage(mf, auth, { ...settings, notice: '', donationUrl: '', chatEnabled: true })).status, 200);
  a.send({ type: 'chat', text: '다시 대화', requestId: 'resumed-chat-message' }); assert.equal((await a.wait(m => m.requestId === 'resumed-chat-message')).type, 'chat');
  const snapshot = await room.testSnapshot(); assert.equal(JSON.stringify(snapshot.runtime.audit).includes('로그에 남기지'), false); assert.equal(snapshot.alarmAt, null);
 } finally { await mf.dispose(); }
});

test('kicks free seats immediately; blocks bind to browser identity, survive restart and expire without alarms', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const auth = await login(mf), cookie = await identity(mf); let a = await join(mf, cookie, '관리대상'); const id = a.welcome.me.id;
  a.send({ type: 'sit', seat: 0, requestId: 'moderated-seat' }); await a.wait(m => m.requestId === 'moderated-seat');
  let result = await manage(mf, auth, { action: 'kick', id }).then(r => r.json()) as Message;
  assert.equal(result.onlineCount, 0); assert.equal(result.blocks.length, 0); assert.equal((await a.wait(m => m.type === 'kicked')).reason, 'admin-kick');
  a = await join(mf, cookie, '관리대상'); assert.equal(a.welcome.players.find((p: Message) => p.id === id).seat, null);
  result = await manage(mf, auth, { action: 'block', id, minutes: 60 }).then(r => r.json()) as Message;
  assert.equal(result.onlineCount, 0); assert.equal((await a.wait(m => m.type === 'kicked')).reason, 'admin-block');
  const admission = () => mf.dispatchFetch(`${origin}/api/admission`, { headers: { Cookie: cookie } }).then(r => r.json()) as Promise<Message>;
  assert.equal((await admission()).code, 'BLOCKED');
  assert.equal((await mf.dispatchFetch(`${origin}/api/room?nickname=다른닉네임`, { headers: { Cookie: cookie, Origin: origin, Upgrade: 'websocket' } })).status, 403);
  await restart(); assert.equal((await admission()).code, 'BLOCKED'); assert.equal((await room.testSnapshot()).alarmAt, null);
  assert.equal((await mf.dispatchFetch(`${origin}/api/status`, { headers: { Cookie: cookie } })).status, 200, 'read-only market data remains available');
  assert.equal((await manage(mf, auth, { action: 'unblock', id })).status, 200); assert.equal((await admission()).allowed, true);
  a = await join(mf, cookie, '관리대상'); result = await manage(mf, auth, { action: 'block', id, minutes: 60 }).then(r => r.json()) as Message;
  await room.testClock(result.blocks[0].until + 1, false); assert.equal((await admission()).allowed, true); assert.equal((await room.testSnapshot()).alarmAt, null);
 } finally { await mf.dispose(); }
});

test('admin audit keeps only eighty summaries and closed rooms preserve charts and settings', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const auth = await login(mf);
  for (let i = 0; i < 83; i++) assert.equal((await manage(mf, auth, { action: 'settings', notice: `공지 ${i}`, donationUrl: '', chatEnabled: i % 2 === 0 })).status, 200);
  const before = JSON.parse(JSON.stringify(await room.testSnapshot())); assert.equal(before.runtime.audit.length, 80);
  await admin(mf, 'control', { action: 'close' }, auth.cookie, auth.csrf); await restart();
  const after = await room.testSnapshot(); assert.equal(after.runtime.roomOpen, false); assert.deepEqual(after.office, before.office); assert.deepEqual(after.runtime.settings, before.runtime.settings); assert.equal(after.runtime.audit.length, 80); assert.equal(after.runtime.audit.at(-1)!.action, 'close'); assert.equal(after.alarmAt, null);
  const admission = await mf.dispatchFetch(`${origin}/api/admission`).then(r => r.json()) as Message; assert.equal(admission.allowed, false); assert.equal(admission.code, 'ROOM_CLOSED');
 } finally { await mf.dispose(); }
});
