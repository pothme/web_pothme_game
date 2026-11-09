import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJumpJoystick, JumpJoystickPointer, jumpJoystickPosition} from '../src/jump-joystick';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);

test('rest and small thumb drift do not move the character, while gentle movement retains analog speed', () => {
  assert.equal(jumpJoystickPosition(0, 0, 50).strength, 0);
  assert.equal(jumpJoystickPosition(4, 3, 50).strength, 0);
  assert.equal(jumpJoystickPosition(6, 0, 50).strength, 0);
  const gentle = jumpJoystickPosition(28, 0, 50);
  near(gentle.strength, .5);
  near(gentle.x, .5);
  assert.equal(gentle.z, 0);
  const initial = jumpJoystickPosition(6.001, 0, 50);
  assert.ok(initial.strength > 0 && initial.strength < .001, 'crossing the dead zone must not cause a speed jump');
});

test('diagonal and out-of-circle drags cannot exceed the normal movement speed or thumb boundary', () => {
  for (const [x, z] of [[40, 40], [-400, 800], [10000, 0], [0, -900]]) {
    const value = jumpJoystickPosition(x, z, 40);
    near(Math.hypot(value.x, value.z), 1);
    near(Math.hypot(value.thumbX, value.thumbY), 40);
    near(value.strength, 1);
    assert.equal(Math.sign(value.x), Math.sign(x));
    assert.equal(Math.sign(value.z), Math.sign(z));
  }
  const diagonal = jumpJoystickPosition(40, -40, 40);
  near(diagonal.x, Math.SQRT1_2);
  near(diagonal.z, -Math.SQRT1_2);
});

test('pressing the fixed center and then dragging starts movement without a second touch', () => {
  const input = new JumpJoystickPointer();
  assert.equal(input.begin(17, 100, 120, 100, 120, 40), true);
  assert.equal(input.position.strength, 0);
  assert.equal(input.move(17, 140, 120), true);
  assert.equal(input.position.x, 1);
  assert.equal(input.position.z, 0);
  input.move(17, 100, 80);
  assert.equal(input.position.x, 0);
  assert.equal(input.position.z, -1);
});

test('the jump finger cannot steal, steer, or release an active movement finger', () => {
  const input = new JumpJoystickPointer();
  input.begin(11, 140, 100, 100, 100, 40);
  assert.equal(input.begin(22, 50, 50, 100, 100, 40), false);
  assert.equal(input.move(22, 10, 10), false);
  assert.equal(input.end(22), false);
  assert.equal(input.pointerId, 11);
  assert.equal(input.position.x, 1);
  assert.equal(input.end(11), true);
  assert.equal(input.pointerId, null);
  assert.equal(input.position.strength, 0);
  assert.equal(input.move(11, 140, 100), false, 'stale captured events cannot revive released movement');
});

test('cancellation resets ownership and movement; a new pointer uses the new layout center', () => {
  const input = new JumpJoystickPointer();
  input.begin(1, 140, 100, 100, 100, 40);
  input.reset();
  assert.equal(input.pointerId, null);
  assert.equal(input.position.strength, 0);
  input.begin(2, 200, 200, 200, 200, 30);
  input.move(1, 500, 500);
  assert.equal(input.position.strength, 0);
  input.move(2, 170, 200);
  assert.equal(input.position.x, -1);
  const exposed = input.position;
  exposed.x = 1;
  assert.equal(input.position.x, -1, 'consumers cannot mutate owned input state');
});

test('unmeasurable and nonfinite geometry remains neutral instead of leaking invalid movement', () => {
  for (const [x, z, radius] of [[10, 10, 0], [10, 10, -1], [NaN, 0, 40], [0, Infinity, 40]]) {
    const value = jumpJoystickPosition(x, z, radius);
    assert.deepEqual(value, { x: 0, z: 0, strength: 0, thumbX: 0, thumbY: 0 });
  }
});

// A minimal DOM port: production listeners and their AbortSignal cleanup run on
// real EventTargets. Geometry/capture are the only browser operations supplied.
class JoystickElement extends EventTarget {
  className = '';
  tabIndex = 0;
  innerHTML = '';
  offsetWidth = 54;
  dataset: Record<string, string> = {};
  style = { transform: '' };
  attributes = new Map<string, string>();
  captures = new Set<number>();
  removed = false;
  children: JoystickElement[] = [];
  thumb?: JoystickElement;
  append(child: JoystickElement) { this.children.push(child); }
  remove() { this.removed = true; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  querySelector() { return this.thumb ??= new JoystickElement(); }
  getBoundingClientRect() { return { left: 20, top: 30, width: 142, height: 142 }; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
    this.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: id }));
  }
}
class JoystickDocument extends EventTarget {
  hidden = false;
  createElement() { return new JoystickElement(); }
}
const pointerEvent = (type: string, id = 1, x = 131, y = 101) => Object.assign(new Event(type, { cancelable: true }), {
  pointerId: id, clientX: x, clientY: y, pointerType: 'touch', button: 0,
});
const keyEvent = (type: string, key: string) => Object.assign(new Event(type, { cancelable: true }), { key, repeat: false });

test('mounted joystick resets on browser interruptions and preserves independent jump touch events', () => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentPort = new JoystickDocument();
  const windowPort = new EventTarget();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentPort });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowPort });
  try {
    let canUse = true;
    const gestures: Event[] = [];
    const host = new JoystickElement();
    const joystick = createJumpJoystick(host as unknown as HTMLElement, {
      canUse: () => canUse,
      onGesture: event => gestures.push(event),
    });
    const element = host.children[0];
    const start = () => {
      const event = pointerEvent('pointerdown');
      element.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, 'a claimed drag blocks native page scrolling');
      assert.equal(joystick.value().x, 1);
      assert.equal(element.hasPointerCapture(1), true);
      assert.strictEqual(gestures.at(-1), event, 'the real gesture reaches the audio unlock callback');
    };
    const neutral = () => {
      assert.deepEqual(joystick.value(), { x: 0, z: 0, strength: 0 });
      assert.equal(element.hasPointerCapture(1), false);
      assert.equal(element.dataset.active, 'false');
      assert.equal(element.dataset.strength, '0.000');
    };
    start();
    const secondTouch = pointerEvent('pointerdown', 2, 91, 61);
    element.dispatchEvent(secondTouch);
    assert.equal(secondTouch.defaultPrevented, false, 'unowned fingers remain available for other controls');
    element.dispatchEvent(pointerEvent('pointercancel', 2));
    assert.equal(joystick.value().x, 1);
    element.dispatchEvent(pointerEvent('pointercancel'));
    neutral();
    for (const eventName of ['pointerup', 'lostpointercapture', 'blur']) {
      start();
      element.dispatchEvent(eventName === 'blur' ? new Event(eventName) : pointerEvent(eventName));
      neutral();
    }
    for (const eventName of ['blur', 'resize', 'orientationchange']) {
      start();
      windowPort.dispatchEvent(new Event(eventName));
      neutral();
    }
    start();
    documentPort.hidden = true;
    documentPort.dispatchEvent(new Event('visibilitychange'));
    neutral();
    documentPort.hidden = false;
    start();
    canUse = false;
    neutral();
    canUse = true;
    start();
    joystick.setEnabled(false);
    neutral();
    element.dispatchEvent(pointerEvent('pointerdown'));
    neutral();
    assert.equal(element.attributes.get('aria-disabled'), 'true');
    assert.equal(element.tabIndex, -1);
    joystick.setEnabled(true);
    const arrow = keyEvent('keydown', 'ArrowUp');
    element.dispatchEvent(arrow);
    assert.equal(joystick.value().z, -1);
    assert.strictEqual(gestures.at(-1), arrow);
    element.dispatchEvent(keyEvent('keydown', 'ArrowRight'));
    near(Math.hypot(joystick.value().x, joystick.value().z), 1);
    element.dispatchEvent(keyEvent('keyup', 'ArrowUp'));
    assert.equal(joystick.value().x, 1);
    assert.equal(joystick.value().z, 0);
    element.dispatchEvent(new Event('blur'));
    neutral();
    start();
    joystick.dispose();
    neutral();
    assert.equal(element.removed, true);
    element.dispatchEvent(pointerEvent('pointerdown'));
    element.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    neutral();
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
