import { CHASE_RULES, isWalkableSegment } from '../shared/classroom-layout';

export interface ChasePosition { x: number; z: number; updatedAt: number }
export interface ChaseCapture { caughtAt: number; penalty: number }
export interface ChaseRound {
  robberId: string;
  robberName: string;
  startsAt: number;
  endsAt: number;
  positions: Record<string, ChasePosition>;
  profiles: Record<string, { nickname: string; color: number; breadShuttle: boolean }>;
  caught: Record<string, ChaseCapture>;
}
export interface ChasePublic {
  roundId: string;
  robberId: string;
  robberName: string;
  startsAt: number;
  endsAt: number;
  role: 'robber' | 'runner' | 'spectator';
  caughtIds: string[];
  participantCount: number;
}

/** A bounded travel budget tolerates jitter without granting extra distance per packet. */
export function acceptedChaseMove(previous: { x: number; z: number; at: number; credit: number }, x: unknown, z: unknown, now: number, robber: boolean) {
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const speed = robber ? CHASE_RULES.robberSpeed : CHASE_RULES.runnerSpeed;
  const credit = Math.min(speed * CHASE_RULES.movementCreditMs / 1000, Math.max(0, previous.credit) + Math.max(0, now - previous.at) * speed / 1000);
  const distance = Math.hypot(x - previous.x, z - previous.z);
  if (distance > credit + 1e-8 || !isWalkableSegment(previous.x, previous.z, x, z)) return null;
  return { x, z, at: now, credit: Math.max(0, credit - distance) };
}

/** Test proximity along an accepted path, requiring line-of-sight at its closest point. */
export function touchesPath(from: { x: number; z: number }, to: { x: number; z: number }, other: { x: number; z: number }): boolean {
  const dx = to.x - from.x, dz = to.z - from.z;
  const denominator = dx * dx + dz * dz;
  const t = denominator ? Math.max(0, Math.min(1, ((other.x - from.x) * dx + (other.z - from.z) * dz) / denominator)) : 0;
  const closest = { x: from.x + t * dx, z: from.z + t * dz };
  return Math.hypot(closest.x - other.x, closest.z - other.z) <= CHASE_RULES.catchRadius && isWalkableSegment(closest.x, closest.z, other.x, other.z);
}
