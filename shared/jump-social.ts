import type { AvatarAppearance } from './avatar-appearance';

export const JUMP_SOCIAL_RULES = Object.freeze({ presenceMs: 200, rankingMs: 1000, chatMaxLength: 80, chatTtlMs: 8000, historyLimit: 40, historyTtlMs: 10 * 60_000 });
/** Everything below is shared only among the members of one tower room. */
export interface JumpPeerView {
  id: string; nickname: string; color: number; appearance: AvatarAppearance;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  /** Pad the peer last stood on, not the best floor of the run. */
  grounded: boolean; floor: number; jumps: number; updatedAt: number;
}
export interface JumpChatMessage {
  id: string; playerId: string; nickname: string; text: string; sentAt: number; expiresAt: number;
}
export type JumpPeerMotion = [id: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, grounded: 0 | 1, floor: number, jumps: number];
/** One row of the live in-room ranking: where the member stands now and the best floor of this visit. */
export interface JumpRoomRank { id: string; nickname: string; floor: number; bestFloor: number }
/** `jump-room` packet: sent to the members of a tower room when its ranking changes. */
export interface JumpRoomPacket { type: 'jump-room'; roomId: string; ranking: JumpRoomRank[]; serverTime: number }
