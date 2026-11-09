import { createThemeController, MARKETS_THEME_KEY, type ResolvedTheme, type ThemePreference } from '../shared/markets-theme';
export type { ThemePreference, ResolvedTheme } from '../shared/markets-theme';

export function createMarketsTheme(onChange: (preference: ThemePreference, resolved: ResolvedTheme) => void) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const originalColorScheme = document.documentElement.style.colorScheme;
  const originalMeta = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
  const controller = createThemeController({
    read: () => localStorage.getItem(MARKETS_THEME_KEY),
    write: preference => localStorage.setItem(MARKETS_THEME_KEY, preference),
    systemDark: () => media.matches,
    subscribeSystem(listener) { media.addEventListener('change', listener); return () => media.removeEventListener('change', listener); },
    subscribeStorage(listener) {
      const changed = (event: StorageEvent) => { if (event.key === null || event.key === MARKETS_THEME_KEY) listener(); };
      window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
    },
    apply(preference, resolved) {
      document.body.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0d1721' : '#f5f8f9');
      onChange(preference, resolved);
    },
  });
  return {
    get preference() { return controller.preference; }, get resolved() { return controller.resolved; }, setPreference: controller.setPreference,
    dispose() { controller.dispose(); delete document.body.dataset.theme; document.documentElement.style.colorScheme = originalColorScheme; if (originalMeta != null) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', originalMeta); },
  };
}
