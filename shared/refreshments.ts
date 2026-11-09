export const REFRESHMENT_DRINKS = [
  { id: 'coffee', label: '커피' },
  { id: 'juice', label: '주스' },
  { id: 'tea', label: '차' },
  { id: 'water', label: '물' },
] as const;
export const REFRESHMENT_SNACKS = [
  { id: 'cookie', label: '쿠키' },
  { id: 'donut', label: '도넛' },
  { id: 'sandwich', label: '샌드위치' },
] as const;
export type RefreshmentDrink = typeof REFRESHMENT_DRINKS[number]['id'];
export type RefreshmentSnack = typeof REFRESHMENT_SNACKS[number]['id'];
/** null omits one category; an inventory still needs at least one item. */
export interface RefreshmentSelection { drink: RefreshmentDrink | null; snack: RefreshmentSnack | null }
export const REFRESHMENT_RULES = Object.freeze({ cooldownMs: 1500, receiptLimit: 16 });
export function isRefreshmentSelection(value: unknown): value is RefreshmentSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (input.drink !== null || input.snack !== null)
    && (input.drink === null || REFRESHMENT_DRINKS.some(item => item.id === input.drink))
    && (input.snack === null || REFRESHMENT_SNACKS.some(item => item.id === input.snack));
}
