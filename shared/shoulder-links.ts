/** Opt-in social pose. One member means waiting for a nearby participant. */
export interface ShoulderCheerView { id: string; startedAt: number; expiresAt: number }
export interface ShoulderLinkView { groupId: string; index: number; count: number; facing: number; since: number; cheer?: ShoulderCheerView; cheerNextAt?: number }
export const SHOULDER_LINK_RULES = Object.freeze({ spacing: 0.78, joinRadius: 3, cooldownMs: 700, receiptLimit: 24, cheerDurationMs: 6000, cheerCooldownMs: 7000, cheerReceiptLimit: 16 });
export function isShoulderCheerView(value: unknown): value is ShoulderCheerView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cheer = value as Partial<ShoulderCheerView>;
  return typeof cheer.id === 'string' && cheer.id.length > 0 && cheer.id.length <= 100
    && Number.isFinite(cheer.startedAt) && Number.isFinite(cheer.expiresAt)
    && cheer.expiresAt! - cheer.startedAt! === SHOULDER_LINK_RULES.cheerDurationMs;
}
export function isShoulderLinkView(value: unknown): value is ShoulderLinkView {
  if (!value || typeof value !== 'object') return false;
  const view = value as Partial<ShoulderLinkView>;
  return typeof view.groupId === 'string' && view.groupId.length > 0 && view.groupId.length <= 100
    && Number.isInteger(view.index) && Number.isInteger(view.count) && view.count! >= 1 && view.count! <= 20
    && view.index! >= 0 && view.index! < view.count! && Number.isFinite(view.facing) && Number.isFinite(view.since)
    && (view.cheer === undefined || (view.count! >= 2 && isShoulderCheerView(view.cheer)))
    && (view.cheerNextAt === undefined || Number.isFinite(view.cheerNextAt));
}
