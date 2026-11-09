import { measureMobileViewport } from '../shared/mobile-viewport';

/** One viewport measurement drives the room, navigation, dialogs and composer. */
export function observeMobileViewport() {
  let frame = 0;
  const viewport = window.visualViewport;
  function update() {
    frame = 0;
    const value = measureMobileViewport({ layoutHeight: window.innerHeight, visualHeight: viewport?.height, visualTop: viewport?.offsetTop, scale: viewport?.scale });
    const style = document.documentElement.style;
    for (const key of ['height', 'top', 'bottom'] as const) style.setProperty(`--mobile-viewport-${key}`, `${value[key]}px`);
    document.body.classList.toggle('mobile-short-viewport', value.short);
  }
  function queue() { if (!frame) frame = requestAnimationFrame(update); }
  window.addEventListener('resize', queue);
  window.addEventListener('orientationchange', queue);
  window.addEventListener('pageshow', queue);
  viewport?.addEventListener('resize', queue);
  viewport?.addEventListener('scroll', queue);
  update();
  return { update, dispose() {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', queue);
    window.removeEventListener('orientationchange', queue);
    window.removeEventListener('pageshow', queue);
    viewport?.removeEventListener('resize', queue);
    viewport?.removeEventListener('scroll', queue);
  } };
}
