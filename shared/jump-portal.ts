import { REFRESHMENT_STATION, ROOM_BOUNDS } from './classroom-layout';

/** Walkable doorway beside (not inside) the snack counter. */
export const JUMP_PORTAL = Object.freeze({
  x: ROOM_BOUNDS.minX + 2.4,
  z: REFRESHMENT_STATION.z + 7.2,
  width: 2.8,
  height: 4.1,
  entryRadius: 2.5,
});
export function nearJumpPortal(x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - JUMP_PORTAL.x, z - JUMP_PORTAL.z) <= JUMP_PORTAL.entryRadius;
}
export type JumpLeaderView = { nickname: string; bestFloor: number; reachedAt: number };
