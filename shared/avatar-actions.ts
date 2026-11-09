import { JUMP_RULES } from './avatar-jump';

export const AVATAR_ACTIONS = [
  { kind: 'wave', label: '손 흔들기', icon: '👋', durationMs: 2500 },
  { kind: 'bow', label: '인사', icon: '🙇', durationMs: 2500 },
  { kind: 'clap', label: '박수', icon: '👏', durationMs: 2500 },
  { kind: 'cheer', label: '환호', icon: '🙌', durationMs: 2500 },
  { kind: 'lets-go', label: '가즈아!', icon: '🚀', durationMs: 2500 },
  { kind: 'help-me', label: '살려주세요!', icon: '🥺', durationMs: 2500 },
  { kind: 'dance', label: '리듬 댄스', icon: '🪩', durationMs: 2500 },
  { kind: 'heart', label: '하트 보내기', icon: '🫶', durationMs: 2500 },
  { kind: 'jump', label: '점프', icon: '↑', durationMs: JUMP_RULES.flightMs },
  { kind: 'drink', label: '마시기', icon: '☕', durationMs: 2500 },
  { kind: 'eat', label: '먹기', icon: '🍪', durationMs: 2500 },
] as const;

export type AvatarActionKind = typeof AVATAR_ACTIONS[number]['kind'];
export interface AvatarActionView {
  id: string;
  kind: AvatarActionKind;
  startedAt: number;
  expiresAt: number;
  jump?: { step: 1 | 2; startHeight: number };
}
export const AVATAR_ACTION_COOLDOWN_MS = 2500;
/** Market reactions can use a head-only pose when the visitor is holding a tray. */
export function isMarketReaction(kind: AvatarActionKind): boolean { return kind === 'lets-go' || kind === 'help-me'; }
export function getAvatarActionCooldown(kind: AvatarActionKind): number { return kind === 'jump' ? JUMP_RULES.flightMs + JUMP_RULES.landingCooldownMs : AVATAR_ACTION_COOLDOWN_MS; }
export function getAvatarActionDuration(kind: AvatarActionKind): number { return AVATAR_ACTIONS.find(action => action.kind === kind)!.durationMs; }
export function isAvatarActionKind(value: unknown): value is AvatarActionKind {
  return typeof value === 'string' && AVATAR_ACTIONS.some(action => action.kind === value);
}
export function isAvatarActionView(value: unknown): value is AvatarActionView {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<AvatarActionView>;
  const jump = action.jump;
  if (jump !== undefined && (action.kind !== 'jump' || !jump || typeof jump !== 'object'
    || (jump.step !== 1 && jump.step !== 2) || !Number.isFinite(jump.startHeight)
    || jump.startHeight < 0 || jump.startHeight > JUMP_RULES.height
    || (jump.step === 1 && jump.startHeight !== 0))) return false;
  return typeof action.id === 'string' && action.id.length <= 100 && isAvatarActionKind(action.kind)
    && Number.isFinite(action.startedAt) && Number.isFinite(action.expiresAt)
    && action.expiresAt! > action.startedAt! && action.expiresAt! - action.startedAt! <= 3000;
}
