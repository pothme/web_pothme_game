import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirectionHolds, type MoveDirection } from '../shared/mobile-movement';

test('multi-touch can hold diagonal directions and releases each direction independently', () => {
  const events: [MoveDirection, boolean][] = [], hold = createDirectionHolds((direction, pressed) => events.push([direction, pressed]));
  hold.press('pointer:1', 'forward'); hold.press('pointer:2', 'right');
  hold.release('pointer:1'); hold.release('pointer:2');
  assert.deepEqual(events, [['forward', true], ['right', true], ['forward', false], ['right', false]]);
});

test('repeated contacts on the same arrow do not cancel movement when just one is released', () => {
  const events: [MoveDirection, boolean][] = [], hold = createDirectionHolds((direction, pressed) => events.push([direction, pressed]));
  hold.press('pointer:1', 'left'); hold.press('pointer:2', 'left'); hold.press('pointer:2', 'left');
  hold.release('pointer:1'); assert.deepEqual(events, [['left', true]]);
  hold.release('pointer:2'); hold.release('pointer:2'); assert.deepEqual(events, [['left', true], ['left', false]]);
});

test('cancel, modal/visibility release and disposal drain every active touch or keyboard contact once', () => {
  const events: [MoveDirection, boolean][] = [], hold = createDirectionHolds((direction, pressed) => events.push([direction, pressed]));
  hold.press('pointer:1', 'back'); hold.press('key:back:Enter', 'back'); hold.press('pointer:2', 'right');
  hold.releaseAll(); hold.releaseAll(); hold.release('pointer:1');
  assert.deepEqual(events, [['back', true], ['right', true], ['back', false], ['right', false]]);
  hold.press('pointer:3', 'forward'); hold.release('pointer:3');
  assert.deepEqual(events.slice(-2), [['forward', true], ['forward', false]]);
});

test('reusing a pointer for a new direction releases the old hold first', () => {
  const events: [MoveDirection, boolean][] = [], hold = createDirectionHolds((direction, pressed) => events.push([direction, pressed]));
  hold.press('pointer:1', 'left'); hold.press('pointer:1', 'right'); hold.releaseAll();
  assert.deepEqual(events, [['left', true], ['left', false], ['right', true], ['right', false]]);
});

test('unavailable views drain diagonal input and ignore contacts until fresh presses after reopening', () => {
  const events: [MoveDirection, boolean][] = [], hold = createDirectionHolds((direction, pressed) => events.push([direction, pressed]));
  hold.press('pointer:1', 'forward'); hold.press('pointer:2', 'left');
  hold.setEnabled(false); hold.setEnabled(false);
  hold.press('pointer:3', 'back'); hold.press('key:right:Enter', 'right');
  hold.release('pointer:1'); hold.release('pointer:2');
  assert.deepEqual(events, [['forward', true], ['left', true], ['forward', false], ['left', false]]);
  hold.setEnabled(true);
  assert.equal(events.length, 4, 'reopening never resumes old touches');
  hold.press('pointer:1', 'forward'); hold.release('pointer:1');
  assert.deepEqual(events.slice(-2), [['forward', true], ['forward', false]]);
});

test('rotation clears all contact sources without making subsequent touch input unavailable', () => {
  const events: [MoveDirection, boolean][] = [], hold = createDirectionHolds((direction, pressed) => events.push([direction, pressed]));
  hold.press('pointer:1', 'back'); hold.press('key:back:Enter', 'back');
  hold.releaseAll(); hold.release('pointer:1'); hold.release('key:back:Enter');
  hold.press('pointer:2', 'right'); hold.setEnabled(false); hold.setEnabled(true);
  hold.press('pointer:3', 'left'); hold.releaseAll();
  assert.deepEqual(events, [['back', true], ['back', false], ['right', true], ['right', false], ['left', true], ['left', false]]);
});
