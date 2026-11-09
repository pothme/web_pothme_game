import type { AvatarAppearance } from './avatar-appearance';

export const JUMP_SOCIAL_RULES = Object.freeze({ presenceMs: 200, chatMaxLength: 80, chatCooldownMs: 1200, chatTtlMs: 8000, historyLimit: 40, historyTtlMs: 10 * 60_000 });
export interface JumpPeerView {
  id: string; nickname: string; color: number; appearance: AvatarAppearance;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  grounded: boolean; floor: number; jumps: number; updatedAt: number;
}
export interface JumpChatMessage {
  id: string; playerId: string; nickname: string; text: string; sentAt: number; expiresAt: number;
}
export type JumpPeerMotion = [id: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, grounded: 0 | 1, floor: number, jumps: number];
