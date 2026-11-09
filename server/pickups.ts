import { ROOM_BOUNDS, ROOM_SPAWN, MAP_LAYOUT_VERSION, isWalkable, isWalkableSegment, nearestWalkable, CHASE_RULES } from '../shared/classroom-layout';
import { randomInt } from './survival';
export const PICKUP_RULES = Object.freeze({ intervalMs: 10_000, ttlMs: 120_000, maxItems: 12, radius: 0.65, normalSpeed: CHASE_RULES.runnerSpeed, normalCreditMs: 1500 });
export interface Drop { id: string; x: number; z: number; kind: 'coin' | 'bill'; value: 500 | 1000; spawnedAt: number; expiresAt: number }
export interface RuntimeState { roomOpen: boolean; drops: Drop[]; nextDropAt: number | null; layoutVersion?: number }
export const initialRuntime = (): RuntimeState => ({ roomOpen: true, drops: [], nextDropAt: null, layoutVersion: MAP_LAYOUT_VERSION });
let reachable: { x: number; z: number }[] | undefined;
/** Connected floor samples prevent spawning inside furniture or unreachable pockets. */
function floorPoints() {
  if (reachable) return reachable;
  const start = nearestWalkable(ROOM_SPAWN.x, ROOM_SPAWN.z), step = 0.5;
  const queue = [{ x: Math.round(start.x * 2) / 2, z: Math.round(start.z * 2) / 2 }];
  const seen = new Set<string>(); reachable = [];
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i]!, key = `${point.x},${point.z}`;
    if (seen.has(key)) continue; seen.add(key);
    if (!isWalkable(point.x, point.z)) continue;
    reachable.push(point);
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const next = { x: point.x + dx!, z: point.z + dz! };
      if (next.x >= ROOM_BOUNDS.minX && next.x <= ROOM_BOUNDS.maxX && next.z >= ROOM_BOUNDS.minZ && next.z <= ROOM_BOUNDS.maxZ && !seen.has(`${next.x},${next.z}`) && isWalkableSegment(point.x, point.z, next.x, next.z)) queue.push(next);
    }
  }
  return reachable;
}
export function spawnDrop(existing: Drop[], players: { x: number; z: number }[], now: number, random = randomInt): Drop | null {
  const candidates = floorPoints().filter((point) => [...players, ...existing].every((other) => Math.hypot(point.x - other.x, point.z - other.z) > 0.9));
  if (!candidates.length) return null;
  const point = candidates[random(candidates.length)]!;
  const bill = random(100) < 15;
  return { id: crypto.randomUUID(), ...point, kind: bill ? 'bill' : 'coin', value: bill ? 1000 : 500, spawnedAt: now, expiresAt: now + PICKUP_RULES.ttlMs };
}
export function acceptedNormalMove(previous: { x: number; z: number; at: number; credit: number }, x: unknown, z: unknown, now: number) {
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const credit = Math.min(PICKUP_RULES.normalSpeed * PICKUP_RULES.normalCreditMs / 1000, Math.max(0, previous.credit) + Math.max(0, now - previous.at) * PICKUP_RULES.normalSpeed / 1000);
  const distance = Math.hypot(x - previous.x, z - previous.z);
  if (distance > credit + 1e-8 || !isWalkable(x, z)) return null;
  return { x, z, at: now, credit: Math.max(0, credit - distance) };
}
export function collectsDrop(from: { x: number; z: number }, to: { x: number; z: number }, drop: Drop): boolean {
  const dx = to.x - from.x, dz = to.z - from.z, length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((drop.x - from.x) * dx + (drop.z - from.z) * dz) / length)) : 0;
  const point = { x: from.x + dx * t, z: from.z + dz * t };
  return Math.hypot(point.x - drop.x, point.z - drop.z) <= PICKUP_RULES.radius && isWalkableSegment(point.x, point.z, drop.x, drop.z);
}
