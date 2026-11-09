import { compactLayout } from './responsive';
import { createDirectionHolds, type MoveDirection } from '../shared/mobile-movement';
import './mobile-movement.css';

/** A small held-direction control. Main supplies admission/connection/view availability. */
export function createMobileMovement(options: {
  onMove(direction: MoveDirection, pressed: boolean): void;
  onResetView(): void;
}): { setActive(active: boolean): void; dispose(): void } {
  const panel = document.createElement('div'); panel.className = 'mobile-movement'; panel.hidden = true;
  panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', '캐릭터 이동과 내 시점');
  panel.innerHTML = `<p class="mm-hint" hidden>방향 버튼: 걷기 · 화면 드래그: 둘러보기</p><div class="mm-pad" role="group" aria-label="누르는 동안 캐릭터 걷기"><span class="mm-center" aria-hidden="true">걷기</span></div><button type="button" class="mm-reset" aria-label="내 캐릭터를 따라가는 시점으로 복귀"><span aria-hidden="true">◎</span> 내 캐릭터</button>`;
  const pad = panel.querySelector<HTMLDivElement>('.mm-pad')!;
  const hint = panel.querySelector<HTMLElement>('.mm-hint')!;
  const resetButton = panel.querySelector<HTMLButtonElement>('.mm-reset')!;
  const labels: Record<MoveDirection, [string, string]> = { forward: ['↑', '앞으로'], back: ['↓', '뒤로'], left: ['←', '왼쪽으로'], right: ['→', '오른쪽으로'] };
  const buttons = new Map<MoveDirection, HTMLButtonElement>();
  const captured = new Map<number, HTMLButtonElement>();
  let requested = false, active = false, disposed = false, hintShown = false;
  let windowFocused = true, pageSuspended = false;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const holds = createDirectionHolds((direction, pressed) => {
    const button = buttons.get(direction)!;
    button.classList.toggle('is-held', pressed); button.setAttribute('aria-pressed', String(pressed));
    options.onMove(direction, pressed);
  });
  function hideHint() { clearTimeout(hintTimer); hintTimer = undefined; hint.hidden = true; }
  function releasePointer(pointerId: number) {
    holds.release(`pointer:${pointerId}`);
    const button = captured.get(pointerId); captured.delete(pointerId);
    if (button?.hasPointerCapture(pointerId)) { try { button.releasePointerCapture(pointerId); } catch { /* Browser already canceled this pointer. */ } }
  }
  function releaseAll() {
    holds.releaseAll();
    for (const pointerId of [...captured.keys()]) releasePointer(pointerId);
  }
  function editing(): boolean {
    const focused = document.activeElement;
    return focused instanceof HTMLElement && (focused.isContentEditable || focused.matches('input,textarea,select'));
  }
  function syncActive() {
    if (disposed) return;
    const next = requested && compactLayout.matches && windowFocused && !pageSuspended && !document.hidden && !document.body.classList.contains('chat-composing') && !document.querySelector('dialog[open]') && !editing();
    holds.setEnabled(next);
    if (!next) { releaseAll(); hideHint(); }
    active = next; panel.hidden = !next;
    if (document.body.classList.contains('mobile-movement-active') !== next) document.body.classList.toggle('mobile-movement-active', next);
    for (const button of buttons.values()) button.disabled = !next;
    resetButton.disabled = !next;
    if (next && !hintShown) { hintShown = true; hint.hidden = false; hintTimer = setTimeout(hideHint, 8000); }
  }
  const stopGesture = (event: Event) => { event.stopPropagation(); };
  const preventGesture = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  for (const [direction, [arrow, name]] of Object.entries(labels) as [MoveDirection, [string, string]][]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `mm-direction mm-${direction}`;
    button.textContent = arrow; button.setAttribute('aria-label', `${name} 걷기, 누르고 있기`); button.setAttribute('aria-pressed', 'false'); button.disabled = true;
    buttons.set(direction, button); pad.append(button);
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      syncActive(); if (!active || event.button !== 0) return;
      hideHint();
      // Capture each contact independently, including non-primary touch contacts.
      captured.set(event.pointerId, button);
      try { button.setPointerCapture(event.pointerId); } catch { /* Window up/cancel listeners still release it. */ }
      holds.press(`pointer:${event.pointerId}`, direction);
    });
    button.addEventListener('pointerup', event => { event.preventDefault(); event.stopPropagation(); releasePointer(event.pointerId); });
    button.addEventListener('pointercancel', event => { event.stopPropagation(); releasePointer(event.pointerId); });
    button.addEventListener('lostpointercapture', event => { event.stopPropagation(); releasePointer(event.pointerId); });
    button.addEventListener('keydown', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation(); syncActive();
      // An old key repeat after a modal/rotation must not restart walking.
      if (!active || event.repeat) return; hideHint(); holds.press(`key:${direction}:${event.key}`, direction);
    });
    button.addEventListener('keyup', event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation(); holds.release(`key:${direction}:${event.key}`);
    });
    button.addEventListener('blur', () => { holds.release(`key:${direction}: `); holds.release(`key:${direction}:Enter`); });
    button.addEventListener('click', preventGesture);
  }
  // Empty pad areas never start an orbit gesture underneath the controls.
  pad.addEventListener('pointerdown', preventGesture);
  panel.addEventListener('pointermove', event => {
    event.stopPropagation(); if (event.pointerType === 'mouse' && event.buttons === 0) releasePointer(event.pointerId);
  });
  panel.addEventListener('contextmenu', preventGesture);
  panel.addEventListener('dblclick', preventGesture);
  // Pointer handlers plus touch-action:none own the pad. Do not cancel the reset
  // button's touchstart, which would suppress its native click on Android.
  panel.addEventListener('touchstart', stopGesture, { passive: true });
  panel.addEventListener('touchmove', stopGesture, { passive: true });
  panel.addEventListener('wheel', preventGesture, { passive: false });
  resetButton.addEventListener('pointerdown', stopGesture);
  resetButton.addEventListener('pointerup', stopGesture);
  resetButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); syncActive(); if (active) { releaseAll(); hideHint(); options.onResetView(); } });

  const released = (event: PointerEvent) => releasePointer(event.pointerId);
  const blur = () => { windowFocused = false; syncActive(); };
  const focus = () => { windowFocused = true; syncActive(); };
  const focused = () => { queueMicrotask(syncActive); };
  const layoutChanged = () => { releaseAll(); hideHint(); syncActive(); };
  const pageHidden = () => { pageSuspended = true; syncActive(); };
  const pageShown = () => { pageSuspended = false; windowFocused = true; syncActive(); };
  const modeClasses = ['chat-composing', 'mobile-office-view', 'market-open'];
  const observer = new MutationObserver(records => {
    // Catch even a modal/mode opened and closed within one task. Its previous
    // contact cannot safely continue after the control's coordinate space moved.
    if (records.some(record => record.attributeName === 'open' || record.target === document.body && record.attributeName === 'class' && modeClasses.some(name => (record.oldValue?.split(/\s+/).includes(name) ?? false) !== document.body.classList.contains(name)))) releaseAll();
    if (records.some(record => record.target === document.body || record.attributeName === 'open' || record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('dialog[open]') || node.querySelector('dialog[open]'))))) syncActive();
  });
  document.body.append(panel);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'open'] });
  window.addEventListener('pointerup', released, true); window.addEventListener('pointercancel', released, true); window.addEventListener('blur', blur); window.addEventListener('focus', focus);
  window.addEventListener('resize', layoutChanged); window.addEventListener('orientationchange', layoutChanged);
  window.addEventListener('pagehide', pageHidden); window.addEventListener('pageshow', pageShown);
  window.visualViewport?.addEventListener('resize', layoutChanged); window.visualViewport?.addEventListener('scroll', layoutChanged);
  screen.orientation?.addEventListener('change', layoutChanged);
  document.addEventListener('visibilitychange', syncActive); document.addEventListener('focusin', syncActive); document.addEventListener('focusout', focused);
  compactLayout.addEventListener('change', syncActive);
  syncActive();
  return {
    setActive(value: boolean) { if (disposed) return; requested = value; syncActive(); },
    dispose() {
      if (disposed) return; requested = false; syncActive(); disposed = true; releaseAll(); hideHint(); observer.disconnect();
      window.removeEventListener('pointerup', released, true); window.removeEventListener('pointercancel', released, true); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
      window.removeEventListener('resize', layoutChanged); window.removeEventListener('orientationchange', layoutChanged);
      window.removeEventListener('pagehide', pageHidden); window.removeEventListener('pageshow', pageShown);
      window.visualViewport?.removeEventListener('resize', layoutChanged); window.visualViewport?.removeEventListener('scroll', layoutChanged);
      screen.orientation?.removeEventListener('change', layoutChanged);
      document.removeEventListener('visibilitychange', syncActive); document.removeEventListener('focusin', syncActive); document.removeEventListener('focusout', focused);
      compactLayout.removeEventListener('change', syncActive); document.body.classList.remove('mobile-movement-active'); panel.remove();
    },
  };
}
