import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_PREFERENCES_KEY, CHAT_VISIBLE_LINES, DEFAULT_CHAT_PREFERENCES, normalizeChatPreferences, readChatPreferences, writeChatPreferences, chatBackgroundOpacity } from '../src/chat-preferences';

test('first visit expands to ten lines, with a four-line collapsed mode and translucent background', () => {
  assert.equal(DEFAULT_CHAT_PREFERENCES.expanded, true);
  assert.deepEqual(CHAT_VISIBLE_LINES, { expanded: 10, collapsed: 4 });
  assert.deepEqual(readChatPreferences({ getItem: () => null, setItem() {} }), DEFAULT_CHAT_PREFERENCES);
  assert.deepEqual(readChatPreferences(), DEFAULT_CHAT_PREFERENCES);
  assert.equal(chatBackgroundOpacity(DEFAULT_CHAT_PREFERENCES.transparency), .6);
});
test('saved expanded mode and transparency survive reload without retaining extra data', () => {
  const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  writeChatPreferences({ expanded: false, transparency: 85 }, storage);
  assert.equal(map.size, 1); assert.ok(map.has(CHAT_PREFERENCES_KEY));
  assert.deepEqual(readChatPreferences(storage), { expanded: false, transparency: 85 });
  assert.equal(chatBackgroundOpacity(readChatPreferences(storage).transparency), .15);
  assert.deepEqual(normalizeChatPreferences({ expanded: false, transparency: 25, token: 'discard' }), { expanded: false, transparency: 25 });
});
test('invalid or unavailable storage recovers safely and transparency endpoints invert correctly', () => {
  const bad = { getItem: () => '{broken', setItem() { throw new Error('disabled'); } };
  assert.deepEqual(readChatPreferences(bad), DEFAULT_CHAT_PREFERENCES);
  assert.doesNotThrow(() => writeChatPreferences({ expanded: false, transparency: 50 }, bad));
  assert.deepEqual(readChatPreferences({ getItem() { throw new Error('disabled'); }, setItem() {} }), DEFAULT_CHAT_PREFERENCES);
  assert.deepEqual(normalizeChatPreferences({ expanded: 'false', transparency: '50' }), DEFAULT_CHAT_PREFERENCES);
  assert.equal(chatBackgroundOpacity(0), 1); assert.equal(chatBackgroundOpacity(100), 0);
  assert.equal(chatBackgroundOpacity(-10), 1); assert.equal(chatBackgroundOpacity(120), 0);
  assert.equal(chatBackgroundOpacity(NaN), .6);
});
