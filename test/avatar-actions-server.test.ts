import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Miniflare, WebSocket as LocalSocket } from 'miniflare';
import { createHarness } from './harness.mjs';
import { AVATAR_ACTIONS, AVATAR_ACTION_COOLDOWN_MS, getAvatarActionDuration, getAvatarActionCooldown } from '../shared/avatar-actions';
import { createJumpAction, JUMP_RULES } from '../shared/avatar-jump';
import { REFRESHMENT_STATION, ROOM_SPAWN } from '../shared/classroom-layout';

type Message = Record<string, any>;
const origin = 'http://podeumgo.test';
async function identity(mf: Miniflare) { return (await mf.dispatchFetch(`${origin}/api/session`)).headers.get('set-cookie')!.split(';')[0]!; }
function observe(socket: LocalSocket) {
  const messages: Message[] = [], listeners = new Set<() => void>();
  socket.addEventListener('message', event => { messages.push(JSON.parse(String(event.data))); for (const listener of listeners) listener(); }); socket.accept();
  return {
    socket, messages,
    send(message: Message) { socket.send(JSON.stringify(message)); },
    wait(predicate: (value: Message) => boolean): Promise<Message> {
      return new Promise((resolve, reject) => {
        const check = () => { const index = messages.findIndex(predicate); if (index < 0) return; clearTimeout(timer); listeners.delete(check); resolve(messages.splice(index, 1)[0]!); };
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Expected action message missing')); }, 5000);
        listeners.add(check); check();
      });
    },
  };
}
async function join(mf: Miniflare, cookie: string, nickname: string) {
  const response = await mf.dispatchFetch(`${origin}/api/room?nickname=${encodeURIComponent(nickname)}&positions=delta`, { headers: { Upgrade: 'websocket', Cookie: cookie, Origin: origin } });
  assert.equal(response.status, 101); const client = observe(response.webSocket!);
  return { ...client, welcome: await client.wait(message => message.type === 'welcome') };
}

test('actions authenticate the actor, reach peers, reject invalid/reused requests and enforce server timing', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '인사하는사람'), b = await join(mf, await identity(mf), '구경하는사람');
    const before = await room.testSnapshot();
    const command = { type: 'avatar-action', kind: 'wave', requestId: 'action-one-request', playerId: b.welcome.me.id, startedAt: -1, expiresAt: Number.MAX_SAFE_INTEGER };
    a.send(command);
    const own = await a.wait(m => m.type === 'avatar-action'), heard = await b.wait(m => m.type === 'avatar-action');
    assert.deepEqual(heard, own); assert.equal(own.playerId, a.welcome.me.id);
    assert.equal(own.action.kind, 'wave'); assert.ok(own.action.startedAt > 0); assert.equal(own.action.expiresAt - own.action.startedAt, 2500);
    a.send(command); assert.equal((await a.wait(m => m.type === 'avatar-action')).action.id, own.action.id);
    assert.equal(b.messages.some(m => m.type === 'avatar-action'), false, 'retry must not replay for peers');
    a.send({ ...command, kind: 'cheer' }); assert.equal((await a.wait(m => m.requestId === command.requestId)).code, 'REQUEST_REUSED');
    a.send({ ...command, requestId: 'action-too-soon' }); const limited = await a.wait(m => m.requestId === 'action-too-soon');
    assert.equal(limited.code, 'ACTION_COOLDOWN'); assert.equal(limited.retryAt, own.action.startedAt + AVATAR_ACTION_COOLDOWN_MS);
    for (const [index, kind] of ['fly', '__proto__', null, {}].entries()) {
      const requestId = `invalid-action-${index}`; a.send({ type: 'avatar-action', kind, requestId });
      assert.equal((await a.wait(m => m.requestId === requestId)).code, 'ACTION_INVALID');
    }
    for (const [index, definition] of AVATAR_ACTIONS.filter(action => !['eat', 'drink', 'dance', 'heart'].includes(action.kind)).entries()) {
      await room.testClock(own.action.startedAt + (index + 1) * 2600, false);
      const requestId = `valid-action-${index}`; a.send({ type: 'avatar-action', kind: definition.kind, requestId });
      const result = await a.wait(m => m.requestId === requestId); assert.equal(result.action.kind, definition.kind);
    }
    const after = await room.testSnapshot();
    assert.deepEqual(after.players.map(p => [p.id, p.x, p.z, p.seat]), before.players.map(p => [p.id, p.x, p.z, p.seat]));
    assert.deepEqual(after.accounts, before.accounts, 'emotes must not affect wallet/account state');
  } finally { await mf.dispose(); }
});

test('active actions survive live tab replacement and are omitted from late join snapshots after expiry', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookie = await identity(mf), a = await join(mf, cookie, '액션주인');
    a.send({ type: 'avatar-action', kind: 'clap', requestId: 'active-snapshot-action' });
    const event = await a.wait(m => m.type === 'avatar-action');
    const b = await join(mf, await identity(mf), '들어온사람');
    assert.deepEqual(b.welcome.players.find((p: Message) => p.id === a.welcome.me.id).action, event.action);
    const replacement = await join(mf, cookie, '액션주인');
    assert.deepEqual(replacement.welcome.players.find((p: Message) => p.id === a.welcome.me.id).action, event.action);
    await room.testClock(event.action.expiresAt + 1, false);
    const c = await join(mf, await identity(mf), '나중에온사람');
    assert.equal(c.welcome.players.find((p: Message) => p.id === a.welcome.me.id).action, null);
  } finally { await mf.dispose(); }
});

test('walking cancels an action for peers and snapshots, and carrying a tray prevents arm gestures', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '걷는사람'), b = await join(mf, await identity(mf), '보는사람'), id = a.welcome.me.id;
    const command = { type: 'avatar-action', kind: 'cheer', requestId: 'cancel-by-walking' };
    a.send(command); const started = await a.wait(m => m.type === 'avatar-action'); await b.wait(m => m.type === 'avatar-action');
    await room.testClock(started.action.startedAt + 1000, false);
    a.send({ type: 'move', x: ROOM_SPAWN.x, z: ROOM_SPAWN.z - 1 });
    const moved = await b.wait(m => m.type === 'player-moved'); assert.equal(moved.player.action, null);
    const snapshot = await join(mf, await identity(mf), '새로운사람');
    assert.equal(snapshot.welcome.players.find((p: Message) => p.id === id).action, null);
    a.send(command); assert.equal((await a.wait(m => m.type === 'avatar-action')).action, null, 'retry does not restart a cancelled action');
    await room.testClock(started.action.expiresAt + 1, false);
    await room.testPositions({ [id]: { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ } });
    a.send({ type: 'refreshments', refreshments: { drink: 'coffee', snack: 'cookie' }, requestId: 'take-for-action-check' });
    await a.wait(m => m.type === 'refreshments-state');
    a.send({ type: 'avatar-action', kind: 'wave', requestId: 'action-with-full-hands' });
    assert.equal((await a.wait(m => m.requestId === 'action-with-full-hands')).code, 'ACTION_HANDS_BUSY');
  } finally { await mf.dispose(); }
});

test('jump uses a short server cooldown, survives movement, keeps movement limits and rejects seated jumps', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '점프하는사람'), b = await join(mf, await identity(mf), '점프보는사람'), id = a.welcome.me.id;
    a.send({ type: 'avatar-action', kind: 'jump', requestId: 'first-jump-request' });
    const first = await a.wait(m => m.type === 'avatar-action'); await b.wait(m => m.type === 'avatar-action');
    assert.equal(first.action.expiresAt - first.action.startedAt, getAvatarActionDuration('jump'));
    await room.testClock(first.action.startedAt + 400, false);
    a.send({ type: 'move', x: ROOM_SPAWN.x, z: ROOM_SPAWN.z - 1 });
    const movement = await b.wait(m => m.type === 'player-moved'); assert.equal('action' in movement.player, false, 'valid movement preserves the jump');
    const newcomer = await join(mf, await identity(mf), '점프중입장');
    assert.deepEqual(newcomer.welcome.players.find((p: Message) => p.id === id).action, first.action);
    a.send({ type: 'move', x: 60, z: ROOM_SPAWN.z });
    const correction = await a.wait(m => m.type === 'position-correction'); assert.equal(correction.z, ROOM_SPAWN.z - 1);
    await room.testClock(first.action.expiresAt + 20, false);
    a.send({ type: 'avatar-action', kind: 'jump', requestId: 'jump-too-soon' });
    const limited = await a.wait(m => m.requestId === 'jump-too-soon'); assert.equal(limited.code, 'ACTION_COOLDOWN');
    assert.equal(limited.retryAt, first.action.startedAt + getAvatarActionCooldown('jump'));
    await room.testClock(first.action.startedAt + getAvatarActionCooldown('jump') + 1, false);
    a.send({ type: 'avatar-action', kind: 'jump', requestId: 'second-jump-request' });
    const second = await a.wait(m => m.requestId === 'second-jump-request'); assert.equal(second.action.kind, 'jump');
    a.send({ type: 'sit', seat: 0, requestId: 'sit-between-jumps' }); await a.wait(m => m.type === 'seat-state');
    await room.testClock(second.action.startedAt + 1101, false);
    a.send({ type: 'avatar-action', kind: 'jump', requestId: 'seated-jump-request' });
    assert.equal((await a.wait(m => m.requestId === 'seated-jump-request')).code, 'ACTION_SEATED');
  } finally { await mf.dispose(); }
});

test('double jump starts immediately after an emote, uses server physics, and rejects third jumps and replay boosts', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const cookie = await identity(mf), a = await join(mf, cookie, '이단점프'), b = await join(mf, await identity(mf), '이단관찰');
    a.send({ type: 'avatar-action', kind: 'wave', requestId: 'emote-before-jump' });
    const emote = await a.wait(m => m.requestId === 'emote-before-jump'); await b.wait(m => m.requestId === 'emote-before-jump');
    const firstRequest = { type: 'avatar-action', kind: 'jump', requestId: 'chain-first-request', jump: { step: 2, startHeight: 500 }, startedAt: -1, expiresAt: 1e15 };
    a.send(firstRequest);
    const first = await a.wait(m => m.requestId === firstRequest.requestId); await b.wait(m => m.requestId === firstRequest.requestId);
    assert.ok(first.action.startedAt < emote.action.expiresAt, 'jump interrupts the ordinary emote cooldown');
    assert.deepEqual(first.action.jump, { step: 1, startHeight: 0 });
    assert.equal(first.action.expiresAt - first.action.startedAt, JUMP_RULES.flightMs);
    a.send(firstRequest);
    assert.deepEqual((await a.wait(m => m.requestId === firstRequest.requestId)).action, first.action, 'retrying a launch never boosts');

    await room.testClock(first.action.startedAt + 5, false);
    a.send({ type: 'avatar-action', kind: 'jump', requestId: 'chain-boost-too-early' });
    const early = await a.wait(m => m.requestId === 'chain-boost-too-early');
    assert.equal(early.code, 'ACTION_COOLDOWN'); assert.equal(early.retryAt, first.action.startedAt + JUMP_RULES.minBoostDelayMs);
    await room.testClock(first.action.startedAt + 450, false);
    const secondRequest = { ...firstRequest, requestId: 'chain-second-request', jump: { step: 1, startHeight: -100 } };
    a.send(secondRequest);
    const second = await a.wait(m => m.requestId === secondRequest.requestId), heard = await b.wait(m => m.requestId === secondRequest.requestId);
    assert.deepEqual(heard.action, second.action);
    assert.deepEqual(second.action, createJumpAction(second.action.id, second.action.startedAt, first.action));
    assert.ok(second.action.jump);
    assert.equal(second.action.jump.step, 2); assert.ok(second.action.jump.startHeight > 1.3);
    assert.ok(second.action.expiresAt > first.action.expiresAt);
    a.send({ ...firstRequest, requestId: 'chain-third-request' });
    const third = await a.wait(m => m.requestId === 'chain-third-request');
    assert.equal(third.code, 'ACTION_COOLDOWN'); assert.equal(third.retryAt, second.action.expiresAt + JUMP_RULES.landingCooldownMs);

    a.send(firstRequest);
    assert.equal((await a.wait(m => m.requestId === firstRequest.requestId)).action, null, 'a delayed first receipt cannot replay or reset the chain');
    a.send(secondRequest);
    assert.deepEqual((await a.wait(m => m.requestId === secondRequest.requestId)).action, second.action);
    assert.equal(b.messages.some(m => m.type === 'avatar-action'), false, 'retries and rejected boosts are sender-only');
    a.send({ type: 'avatar-action', kind: 'cheer', requestId: 'cheer-during-boost' });
    const airborneEmote = await a.wait(m => m.requestId === 'cheer-during-boost');
    assert.equal(airborneEmote.code, 'ACTION_COOLDOWN'); assert.equal(airborneEmote.retryAt, second.action.expiresAt);

    const replacement = await join(mf, cookie, '이단점프');
    assert.deepEqual(replacement.welcome.players.find((p: Message) => p.id === a.welcome.me.id).action, second.action, 'live reconnection keeps the boosted trajectory');
    replacement.send(secondRequest);
    assert.deepEqual((await replacement.wait(m => m.requestId === secondRequest.requestId)).action, second.action, 'live reconnection keeps receipts');
    await room.testClock(second.action.expiresAt + 5, false);
    replacement.send({ type: 'avatar-action', kind: 'jump', requestId: 'landing-too-early' });
    const landing = await replacement.wait(m => m.requestId === 'landing-too-early');
    assert.equal(landing.code, 'ACTION_COOLDOWN'); assert.equal(landing.retryAt, second.action.expiresAt + JUMP_RULES.landingCooldownMs);
    await room.testClock(second.action.expiresAt + JUMP_RULES.landingCooldownMs + 5, false);
    replacement.send({ type: 'avatar-action', kind: 'jump', requestId: 'next-ground-jump' });
    assert.deepEqual((await replacement.wait(m => m.requestId === 'next-ground-jump')).action.jump, { step: 1, startHeight: 0 });
    assert.equal((await room.testSnapshot()).alarmAt, null, 'jump trajectories do not schedule server timers');
  } finally { await mf.dispose(); }
});

test('sitting, standing, shoulder linking and putting away a tray cannot reset the jump landing cooldown', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '점프초기화방지'), id = a.welcome.me.id;
    let nextAt = Date.now() + 10_000;
    for (const cancellation of ['sit-stand', 'stand', 'shoulder', 'refreshments']) {
      await room.testClock(nextAt, false);
      if (cancellation === 'refreshments') {
        await room.testPositions({ [id]: { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ } });
        a.send({ type: 'refreshments', refreshments: { drink: 'coffee', snack: null }, requestId: 'tray-before-jump-cancel' });
        await a.wait(m => m.type === 'refreshments-state');
        await room.testClock(nextAt + 2500, false);
      }
      a.send({ type: 'avatar-action', kind: 'jump', requestId: `cancel-${cancellation}-jump` });
      const first = await a.wait(m => m.requestId === `cancel-${cancellation}-jump`);
      await room.testClock(first.action.startedAt + 200, false);
      if (cancellation === 'sit-stand') {
        a.send({ type: 'sit', seat: 0, requestId: 'cancel-jump-by-sitting' }); await a.wait(m => m.type === 'seat-state');
        a.send({ type: 'avatar-action', kind: 'jump', requestId: 'cancel-seated-jump' });
        assert.equal((await a.wait(m => m.requestId === 'cancel-seated-jump')).code, 'ACTION_SEATED');
      }
      if (cancellation === 'sit-stand' || cancellation === 'stand') {
        a.send({ type: 'stand', requestId: `cancel-jump-by-standing-${cancellation}` }); await a.wait(m => m.type === 'seat-state');
      } else if (cancellation === 'shoulder') {
        a.send({ type: 'shoulder-link', enabled: true, requestId: 'cancel-jump-by-shoulder' }); await a.wait(m => m.type === 'shoulder-state');
      } else {
        a.send({ type: 'refreshments', refreshments: null, requestId: 'cancel-jump-by-put-away' }); await a.wait(m => m.type === 'refreshments-state');
      }
      a.send({ type: 'avatar-action', kind: 'jump', requestId: `reset-exploit-${cancellation}` });
      const blocked = await a.wait(m => m.requestId === `reset-exploit-${cancellation}`);
      assert.equal(blocked.code, 'ACTION_COOLDOWN', cancellation);
      assert.equal(blocked.retryAt, first.action.expiresAt + JUMP_RULES.landingCooldownMs, cancellation);
      await room.testClock(first.action.expiresAt + 5, false);
      a.send({ type: 'avatar-action', kind: 'cheer', requestId: `replace-cancelled-${cancellation}` });
      assert.equal((await a.wait(m => m.requestId === `replace-cancelled-${cancellation}`)).action.kind, 'cheer');
      a.send({ type: 'avatar-action', kind: 'jump', requestId: `replace-exploit-${cancellation}` });
      const replaced = await a.wait(m => m.requestId === `replace-exploit-${cancellation}`);
      assert.equal(replaced.code, 'ACTION_COOLDOWN', 'replacing the cancelled action cannot clear landing debt');
      assert.equal(replaced.retryAt, blocked.retryAt);
      await room.testClock(blocked.retryAt + 5, false);
      a.send({ type: 'avatar-action', kind: 'jump', requestId: `legal-next-${cancellation}` });
      const legal = await a.wait(m => m.requestId === `legal-next-${cancellation}`);
      assert.deepEqual(legal.action.jump, { step: 1, startHeight: 0 }, cancellation);
      nextAt = legal.action.expiresAt + 5000;
    }
  } finally { await mf.dispose(); }
});

test('eating and drinking require the corresponding held item and never consume or replace the selection', { timeout: 30_000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const a = await join(mf, await identity(mf), '간식즐기는사람'), id = a.welcome.me.id;
    for (const [kind, code] of [['drink', 'ACTION_NO_DRINK'], ['eat', 'ACTION_NO_SNACK']]) {
      a.send({ type: 'avatar-action', kind, requestId: `empty-hands-${kind}` });
      assert.equal((await a.wait(m => m.requestId === `empty-hands-${kind}`)).code, code);
    }
    await room.testPositions({ [id]: { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ } });
    a.send({ type: 'refreshments', refreshments: { drink: 'coffee', snack: null }, requestId: 'take-only-coffee' });
    await a.wait(m => m.type === 'refreshments-state');
    a.send({ type: 'avatar-action', kind: 'eat', requestId: 'no-snack-on-tray' });
    assert.equal((await a.wait(m => m.requestId === 'no-snack-on-tray')).code, 'ACTION_NO_SNACK');
    a.send({ type: 'avatar-action', kind: 'drink', requestId: 'one-sip-coffee' });
    const sip = await a.wait(m => m.requestId === 'one-sip-coffee'); assert.equal(sip.action.kind, 'drink');
    const observed = await join(mf, await identity(mf), '한모금관찰');
    const held = observed.welcome.players.find((p: Message) => p.id === id);
    assert.deepEqual(held.refreshments, { drink: 'coffee', snack: null }); assert.deepEqual(held.action, sip.action);
    await room.testClock(sip.action.startedAt + 2600, false);
    a.send({ type: 'refreshments', refreshments: null, requestId: 'return-coffee-tray' }); await a.wait(m => m.type === 'refreshments-state');
    await room.testClock(sip.action.startedAt + 4200, false);
    a.send({ type: 'refreshments', refreshments: { drink: null, snack: 'cookie' }, requestId: 'take-only-cookie' }); await a.wait(m => m.type === 'refreshments-state');
    a.send({ type: 'avatar-action', kind: 'drink', requestId: 'no-drink-on-tray' });
    assert.equal((await a.wait(m => m.requestId === 'no-drink-on-tray')).code, 'ACTION_NO_DRINK');
    a.send({ type: 'avatar-action', kind: 'eat', requestId: 'one-bite-cookie' });
    const bite = await a.wait(m => m.requestId === 'one-bite-cookie'); assert.equal(bite.action.kind, 'eat');
    await room.testClock(bite.action.expiresAt + 1, false);
    const after = await join(mf, await identity(mf), '간식보존확인');
    assert.deepEqual(after.welcome.players.find((p: Message) => p.id === id).refreshments, { drink: null, snack: 'cookie' });
    a.send({ type: 'avatar-action', kind: 'jump', requestId: 'jump-with-cookie' });
    assert.equal((await a.wait(m => m.requestId === 'jump-with-cookie')).action.kind, 'jump');
  } finally { await mf.dispose(); }
});
