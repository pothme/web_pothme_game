import type { AvatarActionView } from './avatar-actions';

const height = 1.36;
const flightMs = 900;
const riseSeconds = flightMs / 2000;

/** One arc is twice the old jump height, with no anticipation delay. */
export const JUMP_RULES = {
  height,
  maxHeight: height * 2,
  flightMs,
  minBoostDelayMs: 80,
  landingCooldownMs: 120,
  launchVelocity: 2 * height / riseSeconds,
  gravity: 2 * height / (riseSeconds * riseSeconds),
} as const;

/** Older server snapshots without jump metadata remain a first jump. */
export function jumpStep(action: AvatarActionView | null | undefined): 0 | 1 | 2 {
  return action?.kind === 'jump' ? (action.jump?.step === 2 ? 2 : 1) : 0;
}

/** Cosmetic Y only; the same server-clock trajectory is used for prediction and rendering. */
export function jumpHeightAt(action: AvatarActionView | null | undefined, now: number): number {
  if (action?.kind !== 'jump' || !Number.isFinite(now) || now < action.startedAt || now >= action.expiresAt) return 0;
  const elapsed = (now - action.startedAt) / 1000;
  const startHeight = action.jump?.startHeight ?? 0;
  const y = startHeight + JUMP_RULES.launchVelocity * elapsed - JUMP_RULES.gravity * elapsed * elapsed / 2;
  return Math.max(0, Math.min(JUMP_RULES.maxHeight, y));
}

/** Callers enforce membership, the two-jump limit and landing cooldown before creating an action. */
export function createJumpAction(id: string, now: number, previous?: AvatarActionView | null): AvatarActionView {
  const boost = jumpStep(previous) === 1 && previous != null
    && now >= previous.startedAt + JUMP_RULES.minBoostDelayMs && now < previous.expiresAt;
  const step = boost ? 2 : 1;
  const startHeight = boost ? Math.min(JUMP_RULES.height, jumpHeightAt(previous, now)) : 0;
  const flight = step === 1 ? JUMP_RULES.flightMs : Math.ceil(1000 * (
    JUMP_RULES.launchVelocity + Math.sqrt(JUMP_RULES.launchVelocity ** 2 + 2 * JUMP_RULES.gravity * startHeight)
  ) / JUMP_RULES.gravity);
  return { id, kind: 'jump', startedAt: now, expiresAt: now + flight, jump: { step, startHeight } };
}
