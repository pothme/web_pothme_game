export const MOBILE_MEDIA_QUERY = '(max-width: 1000px), (pointer: coarse)';
export const compactLayout = window.matchMedia(MOBILE_MEDIA_QUERY);

function updateLayoutClass() {
  document.body.classList.toggle('mobile-layout', compactLayout.matches);
}
updateLayoutClass();
compactLayout.addEventListener('change', updateLayoutClass);
