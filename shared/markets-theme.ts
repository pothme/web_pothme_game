export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const MARKETS_THEME_KEY = 'podeum-markets-theme-v1';

export function themePreference(value: unknown): ThemePreference { return value === 'light' || value === 'dark' ? value : 'system'; }
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme { return preference === 'system' ? systemDark ? 'dark' : 'light' : preference; }

interface ThemeEnvironment {
  read(): unknown;
  write(preference: ThemePreference): void;
  systemDark(): boolean;
  subscribeSystem(listener: () => void): () => void;
  subscribeStorage(listener: () => void): () => void;
  apply(preference: ThemePreference, resolved: ResolvedTheme): void;
}

/** Preference state is isolated so OS changes never overwrite an explicit user choice. */
export function createThemeController(environment: ThemeEnvironment) {
  const read = () => { try { return themePreference(environment.read()); } catch { return 'system' as const; } };
  let preference = read(), resolved = resolveTheme(preference, environment.systemDark()), disposed = false;
  function apply() { if (disposed) return; resolved = resolveTheme(preference, environment.systemDark()); environment.apply(preference, resolved); }
  const unsubscribeSystem = environment.subscribeSystem(() => { if (preference === 'system') apply(); });
  const unsubscribeStorage = environment.subscribeStorage(() => { preference = read(); apply(); });
  apply();
  return {
    get preference() { return preference; },
    get resolved() { return resolved; },
    setPreference(value: unknown): boolean {
      if (disposed) return false;
      preference = themePreference(value); let saved = true;
      try { environment.write(preference); } catch { saved = false; }
      apply(); return saved;
    },
    dispose() { if (disposed) return; disposed = true; unsubscribeSystem(); unsubscribeStorage(); },
  };
}
