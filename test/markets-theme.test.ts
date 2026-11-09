import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThemeController, resolveTheme, themePreference, type ResolvedTheme, type ThemePreference } from '../shared/markets-theme';

test('theme choices default to the OS and reject corrupt saved values', () => {
  assert.equal(themePreference(null), 'system'); assert.equal(themePreference('blue'), 'system');
  assert.equal(resolveTheme('system', true), 'dark'); assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light'); assert.equal(resolveTheme('dark', false), 'dark');
});

test('live OS changes follow system mode, manual choices persist, and cross-tab changes synchronize', () => {
  let stored: unknown = null, systemDark = false, systemListener: (() => void) | null = null, storageListener: (() => void) | null = null;
  const applied: [ThemePreference, ResolvedTheme][] = [];
  const controller = createThemeController({
    read: () => stored, write: value => { stored = value; }, systemDark: () => systemDark,
    subscribeSystem(listener) { systemListener = listener; return () => { systemListener = null; }; },
    subscribeStorage(listener) { storageListener = listener; return () => { storageListener = null; }; },
    apply: (preference, resolved) => applied.push([preference, resolved]),
  });
  const emitSystem = () => { (systemListener as (() => void) | null)?.(); };
  const emitStorage = () => { (storageListener as (() => void) | null)?.(); };
  assert.deepEqual(applied.at(-1), ['system', 'light']);
  systemDark = true; emitSystem(); assert.equal(controller.resolved, 'dark'); assert.equal(stored, null);
  assert.equal(controller.setPreference('light'), true); assert.equal(stored, 'light');
  const count = applied.length; systemDark = false; emitSystem(); assert.equal(applied.length, count);
  stored = 'dark'; emitStorage(); assert.deepEqual(applied.at(-1), ['dark', 'dark']);
  stored = null; emitStorage(); assert.deepEqual(applied.at(-1), ['system', 'light']);
  controller.dispose(); assert.equal(systemListener, null); assert.equal(storageListener, null);
  assert.equal(controller.setPreference('dark'), false);
});

test('blocked browser storage still allows an in-memory theme choice', () => {
  let last: ResolvedTheme | null = null;
  const controller = createThemeController({ read() { throw new Error('blocked'); }, write() { throw new Error('blocked'); }, systemDark: () => true,
    subscribeSystem: () => () => {}, subscribeStorage: () => () => {}, apply: (_, resolved) => { last = resolved; },
  });
  assert.equal(last, 'dark'); assert.equal(controller.setPreference('light'), false); assert.equal(last, 'light'); assert.equal(controller.preference, 'light'); controller.dispose();
});
