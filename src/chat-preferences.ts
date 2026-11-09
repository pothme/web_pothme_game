export interface ChatPreferences { expanded: boolean; transparency: number }
export const CHAT_PREFERENCES_KEY = 'podeumgo.chat-panel.v1';
export const CHAT_LOG_LIMIT = 30;
export const CHAT_VISIBLE_LINES = Object.freeze({ expanded: 10, collapsed: 4 });
export const DEFAULT_CHAT_PREFERENCES: Readonly<ChatPreferences> = Object.freeze({ expanded: true, transparency: 40 });
export interface ChatPreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function normalizeChatPreferences(value: unknown): ChatPreferences {
  const input = value && typeof value === 'object' ? value as Partial<ChatPreferences> : {};
  return {
    expanded: typeof input.expanded === 'boolean' ? input.expanded : DEFAULT_CHAT_PREFERENCES.expanded,
    transparency: typeof input.transparency === 'number' && Number.isFinite(input.transparency) ? Math.round(Math.max(0, Math.min(100, input.transparency))) : DEFAULT_CHAT_PREFERENCES.transparency,
  };
}
export function chatBackgroundOpacity(transparency: number): number { return (100 - normalizeChatPreferences({ transparency }).transparency) / 100; }
export function readChatPreferences(storage?: ChatPreferenceStorage): ChatPreferences {
  try { return normalizeChatPreferences(JSON.parse(storage?.getItem(CHAT_PREFERENCES_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_CHAT_PREFERENCES }; }
}
export function writeChatPreferences(preferences: ChatPreferences, storage?: ChatPreferenceStorage): void {
  try { storage?.setItem(CHAT_PREFERENCES_KEY, JSON.stringify(normalizeChatPreferences(preferences))); } catch { /* Private mode must not disable local controls. */ }
}
