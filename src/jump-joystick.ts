export interface JumpJoystickVector { x: number; z: number; strength: number }
interface JoystickPosition extends JumpJoystickVector { thumbX: number; thumbY: number }

const REST: JoystickPosition = { x: 0, z: 0, strength: 0, thumbX: 0, thumbY: 0 };

/** Circular input range; the inner dead zone is removed from the usable speed range. */
export function jumpJoystickPosition(dx: number, dy: number, radius: number, deadZone = .12): JoystickPosition {
  if (![dx, dy, radius].every(Number.isFinite) || radius <= 0) return { ...REST };
  const distance = Math.hypot(dx, dy);
  if (!distance) return { ...REST };
  const magnitude = Math.min(1, distance / radius);
  const zone = Number.isFinite(deadZone) ? Math.max(0, Math.min(.95, deadZone)) : .12;
  const strength = Math.max(0, (magnitude - zone) / (1 - zone));
  return {
    x: strength ? dx / distance * strength : 0,
    z: strength ? dy / distance * strength : 0,
    strength,
    thumbX: dx / distance * magnitude * radius,
    thumbY: dy / distance * magnitude * radius,
  };
}

/** Keeps the left thumb independent from another finger holding the jump button. */
export class JumpJoystickPointer {
  private owner: number | null = null;
  private centerX = 0;
  private centerY = 0;
  private radius = 1;
  private current: JoystickPosition = { ...REST };

  get pointerId() { return this.owner; }
  get position(): JoystickPosition { return { ...this.current }; }

  begin(pointerId: number, x: number, y: number, centerX: number, centerY: number, radius: number) {
    if (this.owner !== null) return false;
    this.owner = pointerId;
    this.centerX = centerX;
    this.centerY = centerY;
    this.radius = radius;
    this.move(pointerId, x, y);
    return true;
  }

  move(pointerId: number, x: number, y: number) {
    if (this.owner !== pointerId) return false;
    this.current = jumpJoystickPosition(x - this.centerX, y - this.centerY, this.radius);
    return true;
  }

  end(pointerId: number) {
    if (this.owner !== pointerId) return false;
    this.reset();
    return true;
  }

  reset() { this.owner = null; this.current = { ...REST }; }
}

export interface JumpJoystickOptions {
  canUse: () => boolean;
  onGesture?: (event: Event) => void;
  onChange?: (value: JumpJoystickVector) => void;
}

export function createJumpJoystick(host: HTMLElement, options: JumpJoystickOptions) {
  const element = document.createElement('div');
  element.className = 'jg-joystick';
  element.tabIndex = 0;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', '이동 조이스틱');
  element.setAttribute('aria-disabled', 'false');
  element.setAttribute('aria-description', '원 안에서 손가락을 움직여 이동합니다. 멀리 밀수록 빨라집니다. 키보드는 방향키로 이동하고 Escape로 멈춥니다.');
  element.innerHTML = '<span class="jg-joystick-ring" aria-hidden="true"></span><span class="jg-joystick-guides" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="jg-joystick-thumb" aria-hidden="true"><span>✥</span></span><span class="jg-joystick-label" aria-hidden="true">이동</span>';
  host.append(element);
  const thumb = element.querySelector<HTMLElement>('.jg-joystick-thumb')!;
  const pointer = new JumpJoystickPointer();
  const arrows = new Set<string>();
  const arrowKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  let enabled = true;
  let disposed = false;
  let latest: JumpJoystickVector = { x: 0, z: 0, strength: 0 };
  const usable = () => enabled && !disposed && options.canUse();
  const radius = () => Math.max(1, (element.getBoundingClientRect().width - thumb.offsetWidth) / 2 - 4);
  const currentPosition = (): JoystickPosition => {
    if (pointer.pointerId !== null) return pointer.position;
    return jumpJoystickPosition(
      Number(arrows.has('ArrowRight')) - Number(arrows.has('ArrowLeft')),
      Number(arrows.has('ArrowDown')) - Number(arrows.has('ArrowUp')),
      1,
    );
  };
  function paint() {
    const position = currentPosition();
    const keyboardScale = pointer.pointerId === null && position.strength > 0 ? radius() : 1;
    thumb.style.transform = `translate(${position.thumbX * keyboardScale}px, ${position.thumbY * keyboardScale}px)`;
    element.dataset.active = String(pointer.pointerId !== null || arrows.size > 0);
    element.dataset.x = position.x.toFixed(3);
    element.dataset.z = position.z.toFixed(3);
    element.dataset.strength = position.strength.toFixed(3);
    const changed = latest.x !== position.x || latest.z !== position.z || latest.strength !== position.strength;
    latest = { x: position.x, z: position.z, strength: position.strength };
    if (changed) options.onChange?.({ ...latest });
  }
  function reset() {
    const owner = pointer.pointerId;
    pointer.reset();
    arrows.clear();
    if (owner !== null && element.hasPointerCapture(owner)) element.releasePointerCapture(owner);
    paint();
  }
  function onDown(event: PointerEvent) {
    if (!usable() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = element.getBoundingClientRect();
    if (!pointer.begin(event.pointerId, event.clientX, event.clientY, rect.left + rect.width / 2, rect.top + rect.height / 2, radius())) return;
    event.preventDefault();
    arrows.clear();
    element.setPointerCapture(event.pointerId);
    options.onGesture?.(event);
    paint();
  }
  function onMove(event: PointerEvent) {
    if (pointer.pointerId !== event.pointerId) return;
    if (!usable()) { reset(); return; }
    event.preventDefault();
    pointer.move(event.pointerId, event.clientX, event.clientY);
    paint();
  }
  function onEnd(event: PointerEvent) {
    if (pointer.pointerId !== event.pointerId) return;
    reset();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      reset();
      return; // The room's Escape handler can still pause the game.
    }
    if (!arrowKeys.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!usable() || pointer.pointerId !== null) return;
    if (!event.repeat) options.onGesture?.(event);
    arrows.add(event.key);
    paint();
  }
  function onKeyUp(event: KeyboardEvent) {
    if (!arrowKeys.has(event.key)) return;
    event.preventDefault();
    // Let the room clear an arrow first pressed before focus reached this pad.
    arrows.delete(event.key);
    paint();
  }
  function onVisibility() { if (document.hidden) reset(); }
  const events = new AbortController();
  const signal = events.signal;
  element.addEventListener('pointerdown', onDown, { signal });
  element.addEventListener('pointermove', onMove, { signal });
  element.addEventListener('pointerup', onEnd, { signal });
  element.addEventListener('pointercancel', onEnd, { signal });
  element.addEventListener('lostpointercapture', onEnd, { signal });
  element.addEventListener('keydown', onKeyDown, { signal });
  element.addEventListener('keyup', onKeyUp, { signal });
  element.addEventListener('blur', reset, { signal });
  element.addEventListener('contextmenu', event => event.preventDefault(), { signal });
  window.addEventListener('blur', reset, { signal });
  window.addEventListener('resize', reset, { signal });
  window.addEventListener('orientationchange', reset, { signal });
  document.addEventListener('visibilitychange', onVisibility, { signal });
  paint();
  return {
    element,
    value(): JumpJoystickVector {
      if (!usable() && (latest.strength || pointer.pointerId !== null || arrows.size)) reset();
      return { ...latest };
    },
    reset,
    setEnabled(value: boolean) {
      if (enabled === value) return;
      enabled = value;
      element.setAttribute('aria-disabled', String(!value));
      element.tabIndex = value ? 0 : -1;
      if (!value) reset();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      events.abort();
      element.remove();
    },
  };
}
