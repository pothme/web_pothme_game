import { compactLayout } from './responsive';
import { createJumpJoystick } from './jump-joystick';
import './jump-joystick.css';
import './mobile-movement.css';

/** The office uses the same round stick as the jump tower. Main supplies admission/connection/view availability. */
export function createMobileMovement(options: {
  /** Screen-space stick vector: x right, z toward the viewer, length 0..1. (0, 0) stops. */
  onMove(x: number, z: number): void;
  onResetView(): void;
}): { setActive(active: boolean): void; dispose(): void } {
  const panel = document.createElement('div'); panel.className = 'mobile-movement'; panel.hidden = true;
  panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', '캐릭터 이동과 내 시점');
  panel.innerHTML = `<p class="mm-hint" hidden>조이스틱: 걷기 · 화면 드래그: 둘러보기</p><div class="mm-pad"></div><button type="button" class="mm-reset" aria-label="내 캐릭터를 따라가는 시점으로 돌아가기"><span aria-hidden="true">⌖</span>내 시점</button>`;
  const pad = panel.querySelector<HTMLDivElement>('.mm-pad')!;
  const hint = panel.querySelector<HTMLElement>('.mm-hint')!;
  const resetButton = panel.querySelector<HTMLButtonElement>('.mm-reset')!;
  let requested = false, active = false, disposed = false, hintShown = false;
  let windowFocused = true, pageSuspended = false;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  function hideHint() { clearTimeout(hintTimer); hintTimer = undefined; hint.hidden = true; }
  const joystick = createJumpJoystick(pad, {
    canUse: () => active,
    onGesture: hideHint,
    onChange: value => options.onMove(value.x, value.z),
  });
  joystick.setEnabled(false);
  function releaseAll() { joystick.reset(); }
  function editing(): boolean {
    const focused = document.activeElement;
    return focused instanceof HTMLElement && (focused.isContentEditable || focused.matches('input,textarea,select'));
  }
  function syncActive() {
    if (disposed) return;
    const next = requested && compactLayout.matches && windowFocused && !pageSuspended && !document.hidden && !document.body.classList.contains('chat-composing') && !document.querySelector('dialog[open]') && !editing();
    if (!next) { releaseAll(); hideHint(); }
    active = next; panel.hidden = !next; joystick.setEnabled(next);
    if (document.body.classList.contains('mobile-movement-active') !== next) document.body.classList.toggle('mobile-movement-active', next);
    resetButton.disabled = !next;
    if (next && !hintShown) { hintShown = true; hint.hidden = false; hintTimer = setTimeout(hideHint, 8000); }
  }
  const stopGesture = (event: Event) => { event.stopPropagation(); };
  const preventGesture = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
  // The stick owns its pointer; nothing on the pad may start an orbit gesture underneath.
  pad.addEventListener('pointerdown', preventGesture);
  panel.addEventListener('pointermove', stopGesture);
  panel.addEventListener('pointerup', stopGesture);
  panel.addEventListener('contextmenu', preventGesture);
  panel.addEventListener('dblclick', preventGesture);
  // Pointer handlers plus touch-action:none own the pad. Do not cancel the reset
  // button's touchstart, which would suppress its native click on Android.
  panel.addEventListener('touchstart', stopGesture, { passive: true });
  panel.addEventListener('touchmove', stopGesture, { passive: true });
  panel.addEventListener('wheel', preventGesture, { passive: false });
  resetButton.addEventListener('pointerdown', stopGesture);
  resetButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); syncActive(); if (active) { releaseAll(); hideHint(); options.onResetView(); } });

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
  window.addEventListener('blur', blur); window.addEventListener('focus', focus);
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
      if (disposed) return; requested = false; syncActive(); disposed = true; releaseAll(); hideHint(); observer.disconnect(); joystick.dispose();
      window.removeEventListener('blur', blur); window.removeEventListener('focus', focus);
      window.removeEventListener('resize', layoutChanged); window.removeEventListener('orientationchange', layoutChanged);
      window.removeEventListener('pagehide', pageHidden); window.removeEventListener('pageshow', pageShown);
      window.visualViewport?.removeEventListener('resize', layoutChanged); window.visualViewport?.removeEventListener('scroll', layoutChanged);
      screen.orientation?.removeEventListener('change', layoutChanged);
      document.removeEventListener('visibilitychange', syncActive); document.removeEventListener('focusin', syncActive); document.removeEventListener('focusout', focused);
      compactLayout.removeEventListener('change', syncActive); document.body.classList.remove('mobile-movement-active'); panel.remove();
    },
  };
}
