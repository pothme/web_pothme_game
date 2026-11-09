/** The rendered office and server-authoritative seating share these coordinates. */
export const MAP_LAYOUT_VERSION = 9;
/** Furniture keeps its human scale when the room shell expands. */
export const OFFICE_EXPANSION_SCALE = Math.sqrt(6);
const scale = OFFICE_EXPANSION_SCALE;
const rounded = (value: number) => Math.round(value * 100) / 100;
const previousDepth = 53.55 * Math.SQRT2;
const chartWallZ = 1.125 * Math.SQRT2 - previousDepth / 2;
const chartWallInset = 0.48;
/** Keep the front wall fixed and expand the actual display-to-display gap by 1.5x. */
const officeDepth = (previousDepth / 2 - chartWallInset * 2) * 1.5 + chartWallInset * 2;
export const OFFICE_GEOMETRY = Object.freeze({ width: 60.3 * Math.SQRT2 * 1.5, depth: officeDepth, centerZ: chartWallZ + officeDepth / 2, wallHeight: 31.5 });
/** CSS pixels stay fixed; its world-space surface grows without stretching its ratio. */
export const WALL_CHART_GEOMETRY = Object.freeze({ width: 30 * scale * 1.5, height: 6.5 * scale * 1.5, x: 0, y: 0.4 + 6.5 * scale * 1.5 / 2, z: chartWallZ + chartWallInset, pixelWidth: 2400, pixelHeight: 520, yaw: 0 });
/** Matching inward-facing rear display follows the expanded rear wall. */
export const REAR_WALL_CHART_GEOMETRY = Object.freeze({ ...WALL_CHART_GEOMETRY, z: OFFICE_GEOMETRY.centerZ + OFFICE_GEOMETRY.depth / 2 - chartWallInset, yaw: Math.PI });
export type ChartWallSide = 'front' | 'rear';
/** Small back-wall fixtures leave the entire display surface unobstructed. */
export const WALL_CLOCK_GEOMETRY = Object.freeze({ width: 17, height: 3.8, x: 0, y: WALL_CHART_GEOMETRY.y + WALL_CHART_GEOMETRY.height / 2 + 2.5, z: WALL_CHART_GEOMETRY.z + 0.03 });
/** width runs along z on the right wall; the surface faces the room (-x). */
export const COMMUNITY_WALL_GEOMETRY = Object.freeze({ width: 28, height: 24, x: OFFICE_GEOMETRY.width / 2 - 0.32, y: 13, z: OFFICE_GEOMETRY.centerZ });
export const SOFAS = Object.freeze([
  ...[-19, -6.8].flatMap((z, row) => [-13, 13].map((x, column) => Object.freeze({ id: row * 2 + column, firstSeatId: (row * 2 + column) * 4, x, z, width: 6.8, depth: 1.75, yaw: Math.PI }))),
  ...[-34, 34].map((x, index) => Object.freeze({ id: 4 + index, firstSeatId: 16 + index * 4, x, z: -6.8, width: 6.8, depth: 1.75, yaw: Math.PI })),
  // Fill the new rear lounge band while leaving both displays and the central aisle open.
  ...[-34, -13, 13, 34].map((x, index) => Object.freeze({ id: 6 + index, firstSeatId: 32 + index * 4, x, z: 6, width: 6.8, depth: 1.75, yaw: Math.PI })),
]);
export const LOUNGE_TABLES = Object.freeze([
  ...[-34, 34].map((x, id) => Object.freeze({ id, firstSeatId: 24 + id * 4, x, z: -17.5, radius: 1.4 })),
  ...[-48, 48].map((x, index) => Object.freeze({ id: 2 + index, firstSeatId: 48 + index * 4, x, z: 4.5, radius: 1.4 })),
]);
export interface ClassroomSeat { id: number; x: number; z: number; standX: number; standZ: number; kind: 'sofa' | 'chair'; sofaId?: number; tableId?: number; yaw: number; label: string }
const sofaSeats: readonly ClassroomSeat[] = SOFAS.flatMap(sofa => [-2.1, -0.7, 0.7, 2.1].map((offset, index) => ({
  id: sofa.firstSeatId + index, x: rounded(sofa.x + offset), z: rounded(sofa.z - 0.1), standX: rounded(sofa.x + offset), standZ: rounded(sofa.z - 1.7),
  kind: 'sofa', sofaId: sofa.id, yaw: sofa.yaw, label: `${String.fromCharCode(65 + sofa.id)} 소파 · ${index + 1}번`,
})));
const tableSeats: readonly ClassroomSeat[] = LOUNGE_TABLES.flatMap(table => [
  { dx: 0, dz: -1, yaw: 0 }, { dx: 1, dz: 0, yaw: -Math.PI / 2 },
  { dx: 0, dz: 1, yaw: Math.PI }, { dx: -1, dz: 0, yaw: Math.PI / 2 },
].map(({ dx, dz, yaw }, index) => ({
  id: table.firstSeatId + index, x: rounded(table.x + dx * 2.4), z: rounded(table.z + dz * 2.4),
  standX: rounded(table.x + dx * 3.5), standZ: rounded(table.z + dz * 3.5),
  kind: 'chair', tableId: table.id, yaw, label: `${table.id + 1}번 테이블 · 의자 ${index + 1}`,
})));
/** Stable IDs preserve every occupied v8 seat; index and ID remain identical. */
export const SEATS: readonly ClassroomSeat[] = Object.freeze([...sofaSeats, ...tableSeats].sort((a, b) => a.id - b.id));

export const REFRESHMENT_STATION = Object.freeze({ x: rounded(-OFFICE_GEOMETRY.width / 2 + 2.2), z: -10, standX: rounded(-OFFICE_GEOMETRY.width / 2 + 4.74), standZ: -10, interactionRadius: 3.5, width: 1.5, depth: 7.2 });

export const ROOM_BOUNDS = Object.freeze({ minX: rounded(-OFFICE_GEOMETRY.width / 2 + 2.7), maxX: rounded(OFFICE_GEOMETRY.width / 2 - 2.7), minZ: rounded(chartWallZ + 2.3), maxZ: rounded(chartWallZ + OFFICE_GEOMETRY.depth - 1.3) });
export const ROOM_SPAWN = Object.freeze({ x: 0, z: -4 });
export const ROOM_FEATURES = Object.freeze({
  cabinet: Object.freeze({ x: -27, z: -2 }),
  teacher: Object.freeze({ x: -34, z: -2.5 }),
  cornerPlant: Object.freeze({ x: 37, z: -2.5 }),
});
export const NORMAL_MOVE_SPEED = 5.6;
export const MOVE_INTERVAL_MS = 1000;
/** Legacy pure-domain fixtures only; not used by the office scene or server. */
export const CHASE_RULES = Object.freeze({ moveIntervalMs: 250, runnerSpeed: 2.8, robberSpeed: 3.2, prepMs: 3000, durationMs: 30_000, catchRadius: 0.65, penalty: 3000, movementCreditMs: 750 });
export interface WalkObstacle { x: number; z: number; w: number; d: number }
/** w/d are inflated half-extents, matching the avatar collision geometry. */
export const WALK_OBSTACLES: readonly WalkObstacle[] = [
  ...SOFAS.map(sofa => ({ x: sofa.x, z: sofa.z, w: sofa.width / 2 + 0.25, d: sofa.depth / 2 + 0.25 })),
  ...LOUNGE_TABLES.map(table => ({ x: table.x, z: table.z, w: table.radius + 0.25, d: table.radius + 0.25 })),
  ...tableSeats.map(seat => ({ x: seat.x, z: seat.z, w: 0.54, d: 0.54 })),
  { x: REFRESHMENT_STATION.x, z: REFRESHMENT_STATION.z, w: REFRESHMENT_STATION.width / 2 + 0.3, d: REFRESHMENT_STATION.depth / 2 + 0.3 },
  { ...ROOM_FEATURES.cabinet, w: 1.05, d: 0.54 },
  { ...ROOM_FEATURES.teacher, w: 0.59, d: 0.59 },
  { ...ROOM_FEATURES.cornerPlant, w: 0.59, d: 0.59 },
];
export function isWalkable(x: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z) && x >= ROOM_BOUNDS.minX && x <= ROOM_BOUNDS.maxX && z >= ROOM_BOUNDS.minZ && z <= ROOM_BOUNDS.maxZ && !WALK_OBSTACLES.some((obstacle) => Math.abs(x - obstacle.x) < obstacle.w - 1e-8 && Math.abs(z - obstacle.z) < obstacle.d - 1e-8);
}
export function isWalkableSegment(x1: number, z1: number, x2: number, z2: number): boolean {
  if (!isWalkable(x1, z1) || !isWalkable(x2, z2)) return false;
  return !WALK_OBSTACLES.some((obstacle) => {
    let enter = 0, leave = 1;
    for (const [start, end, low, high] of [[x1, x2, obstacle.x - obstacle.w + 1e-8, obstacle.x + obstacle.w - 1e-8], [z1, z2, obstacle.z - obstacle.d + 1e-8, obstacle.z + obstacle.d - 1e-8]]) {
      const delta = end! - start!;
      if (Math.abs(delta) < 1e-10) { if (start! <= low! || start! >= high!) return false; }
      else {
        const a = (low! - start!) / delta, b = (high! - start!) / delta;
        enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
        if (enter > leave) return false;
      }
    }
    return enter <= leave && leave >= 0 && enter <= 1;
  });
}
export function nearestWalkable(x: number, z: number): { x: number; z: number } {
  if (isWalkable(x, z)) return { x, z };
  let best: { x: number; z: number } = { ...ROOM_SPAWN }, distance = Infinity;
  const originX = Number.isFinite(x) ? x : ROOM_SPAWN.x, originZ = Number.isFinite(z) ? z : ROOM_SPAWN.z;
  const clamped = { x: Math.max(ROOM_BOUNDS.minX, Math.min(ROOM_BOUNDS.maxX, originX)), z: Math.max(ROOM_BOUNDS.minZ, Math.min(ROOM_BOUNDS.maxZ, originZ)) };
  if (isWalkable(clamped.x, clamped.z)) return clamped;
  const columns = Math.ceil((ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX) / 0.2);
  const rows = Math.ceil((ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ) / 0.2);
  for (let column = 0; column <= columns; column++) for (let row = 0; row <= rows; row++) {
    const point = { x: rounded(Math.min(ROOM_BOUNDS.maxX, ROOM_BOUNDS.minX + column * 0.2)), z: rounded(Math.min(ROOM_BOUNDS.maxZ, ROOM_BOUNDS.minZ + row * 0.2)) };
    const d = (point.x - originX) ** 2 + (point.z - originZ) ** 2;
    if (d < distance && isWalkable(point.x, point.z)) { best = point; distance = d; }
  }
  return best;
}

interface WalkPoint { x: number; z: number }
/** Cache one modest grid for the enlarged room; clear floor taps skip it entirely. */
const NAVIGATION_STEP = 0.32;
let navigationGrid: { width: number; height: number; xs: Float64Array; zs: Float64Array; walkable: Uint8Array } | null = null;
function getNavigationGrid() {
  if (navigationGrid) return navigationGrid;
  const width = Math.ceil((ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX) / NAVIGATION_STEP) + 1;
  const height = Math.ceil((ROOM_BOUNDS.maxZ - ROOM_BOUNDS.minZ) / NAVIGATION_STEP) + 1;
  const xs = new Float64Array(width * height), zs = new Float64Array(width * height), walkable = new Uint8Array(width * height);
  for (let i = 0; i < walkable.length; i++) {
    xs[i] = Math.min(ROOM_BOUNDS.maxX, ROOM_BOUNDS.minX + (i % width) * NAVIGATION_STEP);
    zs[i] = Math.min(ROOM_BOUNDS.maxZ, ROOM_BOUNDS.minZ + Math.floor(i / width) * NAVIGATION_STEP);
    walkable[i] = Number(isWalkable(xs[i], zs[i]));
  }
  return navigationGrid = { width, height, xs, zs, walkable };
}

/** Local click routing only; authoritative movement is still checked by the server. */
export function findWalkPath(startX: number, startZ: number, goalX: number, goalZ: number): WalkPoint[] {
  if (![startX, startZ, goalX, goalZ].every(Number.isFinite) || !isWalkable(startX, startZ)) return [];
  const destination = nearestWalkable(goalX, goalZ);
  if (isWalkableSegment(startX, startZ, destination.x, destination.z)) return [destination];
  const { width, height, xs, zs, walkable } = getNavigationGrid();
  let start = -1, goal = -1, startDistance = Infinity, goalDistance = Infinity;
  for (let i = 0; i < walkable.length; i++) if (walkable[i]) {
    const sd = (xs[i] - startX) ** 2 + (zs[i] - startZ) ** 2;
    const gd = (xs[i] - destination.x) ** 2 + (zs[i] - destination.z) ** 2;
    if (sd < startDistance && isWalkableSegment(startX, startZ, xs[i], zs[i])) { start = i; startDistance = sd; }
    if (gd < goalDistance && isWalkableSegment(xs[i], zs[i], destination.x, destination.z)) { goal = i; goalDistance = gd; }
  }
  if (start < 0 || goal < 0) return [];
  const costs = new Float64Array(walkable.length); costs.fill(Infinity); costs[start] = 0;
  const previous = new Int32Array(walkable.length); previous.fill(-1);
  const closed = new Uint8Array(walkable.length);
  const heap: { index: number; score: number }[] = [];
  const heuristic = (index: number) => Math.hypot(xs[index] - xs[goal], zs[index] - zs[goal]);
  function push(index: number, score: number) {
    const entry = { index, score }; let i = heap.length; heap.push(entry);
    while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].score <= score) break; heap[i] = heap[parent]; i = parent; }
    heap[i] = entry;
  }
  function pop() {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
        if (heap[child].score >= last.score) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first.index;
  }
  push(start, heuristic(start));
  while (heap.length) {
    const current = pop(); if (closed[current]) continue;
    if (current === goal) {
      const route: WalkPoint[] = [destination];
      for (let index = current; index >= 0; index = previous[index]) route.push({ x: xs[index], z: zs[index] });
      route.reverse();
      // Keep only corners with a clear segment, reducing tiny zigzags and frame work.
      const simplified: WalkPoint[] = []; let from = { x: startX, z: startZ }, next = 0;
      while (next < route.length) {
        let end = route.length - 1;
        while (end > next && !isWalkableSegment(from.x, from.z, route[end].x, route[end].z)) end--;
        from = route[end]; simplified.push(from); next = end + 1;
      }
      return simplified;
    }
    closed[current] = 1;
    const cx = current % width, cz = Math.floor(current / width);
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
      const next = nz * width + nx;
      if (!walkable[next] || closed[next] || !isWalkableSegment(xs[current], zs[current], xs[next], zs[next])) continue;
      const cost = costs[current] + Math.hypot(xs[next] - xs[current], zs[next] - zs[current]);
      if (cost < costs[next]) { costs[next] = cost; previous[next] = current; push(next, cost + heuristic(next)); }
    }
  }
  return [];
}
