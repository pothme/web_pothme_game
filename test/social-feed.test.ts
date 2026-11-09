import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocialFeedGuard } from '../src/social-feed';

const event = (id: string, sentAt: number, channel?: 'action', playerId = 'player-one') => ({ id, playerId, sentAt, expiresAt: sentAt + 5000, channel });
test('live action notices display once even when transport repeats an acknowledged action', () => {
  const feed = createSocialFeedGuard(), notice = event('wave-once', 1000, 'action');
  assert.deepEqual(feed.accept(notice, 1100), { bubble: true, log: false });
  assert.equal(feed.accept(notice, 1200), null);
  assert.deepEqual(feed.accept(event('jump-next', 1300, 'action'), 1400), { bubble: true, log: false });
  assert.equal(feed.accept(notice, 1500), null);
});
test('rejoining or stale delivery never replays a historical action or chat bubble', () => {
  const feed = createSocialFeedGuard(), history = event('recent-history', 1000);
  assert.deepEqual(feed.accept(history, 1100, true), { bubble: false, log: true });
  assert.equal(feed.accept(history, 1200), null);
  assert.deepEqual(feed.accept(event('old-action', 1000, 'action'), 7000), { bubble: false, log: false });
  assert.deepEqual(feed.accept(event('future-action', 20000, 'action'), 7000), { bubble: false, log: false });
});
test('newest live message wins the shared head bubble regardless of chat or action channel', () => {
  const feed = createSocialFeedGuard();
  assert.deepEqual(feed.accept(event('cheer', 2000, 'action'), 2100), { bubble: true, log: false });
  assert.deepEqual(feed.accept(event('late-chat', 1500), 2200), { bubble: false, log: true });
  assert.deepEqual(feed.accept(event('answer', 2300), 2400), { bubble: true, log: true });
  assert.deepEqual(feed.accept(event('late-action', 2200, 'action'), 2500), { bubble: false, log: false });
  assert.deepEqual(feed.accept(event('other-person', 1000, 'action', 'player-two'), 2500), { bubble: true, log: false });
});
test('clearing the feed resets message suppression and rejects invalid clocks', () => {
  const feed = createSocialFeedGuard(), notice = event('notice', 1000, 'action');
  assert.deepEqual(feed.accept(notice, 1001), { bubble: true, log: false }); feed.clear();
  assert.deepEqual(feed.accept(notice, 1002), { bubble: true, log: false });
  assert.equal(feed.accept({ ...notice, id: 'invalid', sentAt: NaN }, 1002), null);
  assert.equal(feed.accept({ ...notice, id: 'invalid', expiresAt: Infinity }, 1002), null);
});
test('frequent avatar actions cannot consume the thirty-message conversation history', () => {
  const feed = createSocialFeedGuard(), logged: string[] = [];
  for (let i = 0; i < 30; i++) {
    const chat = event(`chat-${i}`, i * 1000);
    if (feed.accept(chat, i * 1000)?.log) logged.push(chat.id);
    for (let action = 0; action < 3; action++) {
      const notice = event(`action-${i}-${action}`, i * 1000 + action, 'action');
      if (feed.accept(notice, i * 1000 + action)?.log) logged.push(notice.id);
    }
  }
  assert.equal(logged.length, 30); assert.ok(logged.every(id => id.startsWith('chat-')));
});
