import * as THREE from 'three';
import { SuperShape, loftSurface, refineRings, sculptGrid, sculptLoft, smoothstep, type SculptRing } from './avatar-sculpt';

/** Shared body volumes in joint units (the rig in shared/avatar-rig.ts fixes
 * where shoulders, elbows, hips and knees are; these shapes are built around
 * those pivots so every joint is a ball inside its neighbour: no gaps when a
 * limb swings, sits, waves or carries). */
export const TORSO_POWER = 2.3;
/** Pear-shaped torso: [y, half width, half depth, centre z] from crotch to neck. */
export const TORSO: SculptRing[] = refineRings([
  [-.125, 0, 0], [-.119, .085, .075], [-.098, .168, .14], [-.06, .214, .172], [-.01, .234, .19, .002], [.05, .24, .197, .004], [.12, .236, .194, .004],
  [.19, .224, .182, .002], [.25, .212, .168], [.30, .2, .15], [.335, .16, .125], [.36, .115, .1], [.39, .09, .088]], 2);
export const torsoFront = loftSurface(TORSO, TORSO_POWER);
export const torsoBack = loftSurface(TORSO, TORSO_POWER, true);
function torsoAt(y: number) {
  let index = 0; while (index < TORSO.length - 2 && TORSO[index + 1][0] < y) index++;
  const a = TORSO[index], b = TORSO[index + 1], t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, (a[3] ?? 0) + ((b[3] ?? 0) - (a[3] ?? 0)) * t];
}
/** The torso (or a garment `inflate` thicker than it) between two heights.
 * Both open ends curl back under the surface, so a hem reads as soft and thick. */
export function torsoShell(from: number, to: number, inflate = 0, flare = 0, segments = 22): THREE.BufferGeometry {
  const rings: SculptRing[] = [], steps = Math.max(3, Math.round((to - from) / .04)), low = (y: number) => torsoAt(Math.max(y, -.05));
  const ring = (y: number, extra: number): SculptRing => { const [w, d, zc] = from < -.05 ? low(y) : torsoAt(y); return [y, Math.max(.01, w + extra), Math.max(.01, d + extra), zc]; };
  if (inflate > 0 || from > -.12) rings.push(ring(from + .006, Math.min(0, inflate - .014)));
  for (let step = 0; step <= steps; step++) { const y = from + (to - from) * step / steps; rings.push(ring(y, inflate + flare * smoothstep(from + .14, from, y))); }
  rings.push(ring(to + .004, Math.min(0, inflate - .012)));
  return sculptLoft(rings, segments, 1, TORSO_POWER);
}
/** The seat between the legs. Below the hem of a top it is slimmer than the
 * thighs, so only the crotch shows between them and the legs can swing and
 * waddle without cutting through it; above, it widens to the torso and closes
 * the open hem from underneath. */
export function pelvis(inflate = 0): THREE.BufferGeometry {
  const [w, d, zc] = torsoAt(-.03), [wt, dt, zt] = torsoAt(-.008);
  return sculptLoft([[-.128, 0, 0], [-.124, .05, .03], [-.112, .1, .044], [-.09, .15, .05], [-.055, .172, .052], [-.034, .176, .054],
    [-.03, w + inflate, d + inflate, zc], [-.008, wt + inflate, dt + inflate, zt], [-.004, wt - .012, dt - .012, zt]], 22, 1, TORSO_POWER);
}

const signedPow = (value: number, exponent: number) => Math.sign(value) * Math.pow(Math.abs(value), exponent);
/** A garment on the torso whose edges vary around the body: `edge(phi)` is the
 * height where it ends at azimuth phi (0 = front, +-PI = back) and `from` where
 * it starts (a height, or a function of phi), so necklines, straps, armholes
 * and collar flaps are real cut-outs instead of painted patches. */
export function torsoGarment(from: number | ((phi: number) => number), edge: (phi: number) => number, inflate = 0, flare = 0, segments = 32, rows = 7): THREE.BufferGeometry {
  const e = 2 / TORSO_POWER;
  return sculptGrid(segments, rows + 2, (u, v, out) => {
    const column = Math.round(u * segments) % segments, row = Math.round(v * (rows + 2));
    const angle = column / segments * Math.PI * 2, phi = angle > Math.PI ? angle - Math.PI * 2 : angle, top = edge(phi), low = typeof from === 'number' ? from : Math.min(top - .004, from(phi));
    const y = row === 0 ? low + Math.min(.006, (top - low) / 2) : row === rows + 2 ? top - Math.min(.003, (top - low) / 2) : low + (top - low) * (row - 1) / rows;
    const extra = row === 0 ? Math.min(0, inflate - .014) : row === rows + 2 ? Math.min(0, inflate - .012) : inflate + (typeof from === 'number' ? flare * smoothstep(from + .14, from, y) : 0);
    const [w, d, zc] = torsoAt(y);
    out.set(signedPow(Math.sin(angle), e) * Math.max(.01, w + extra), y, zc + signedPow(Math.cos(angle), e) * Math.max(.01, d + extra));
  });
}
/** Half width, half depth and centre z of the torso at a height (for skirts, belts and bags). */
export const torsoSection = (y: number) => torsoAt(y);

/** Limb profiles, each drawn around its own pivot at y=0 and pointing down. */
export const UPPER_ARM: SculptRing[] = [[.046, 0, 0], [.041, .034, .036], [.03, .06, .063], [.008, .077, .081], [-.04, .082, .086], [-.1, .08, .084], [-.152, .077, .08], [-.158, .0767, .0796], [-.168, .0715, .0745], [-.196, .06, .062], [-.218, .04, .042], [-.232, 0, 0]];
export const FOREARM: SculptRing[] = [[.076, 0, 0], [.064, .042, .044], [.043, .064, .067], [.02, .0735, .0765], [0, .0755, .0785], [-.06, .075, .077], [-.115, .07, .072], [-.15, .064, .066]];
/** Legs taper softly from a full thigh to a slim ankle that sits in a big round shoe.
 * Each joint end continues straight for a moment past the pivot and then drops
 * well inside its neighbour, which is a hair slimmer there: a straight limb is
 * lit as one piece, with no band or flicker where the two halves meet. */
export const THIGH: SculptRing[] = [[.1, 0, 0], [.084, .06, .064], [.05, .096, .102], [0, .109, .118], [-.1, .109, .114], [-.2, .101, .104], [-.207, .1004, .1034], [-.218, .094, .097], [-.246, .083, .085], [-.278, .056, .057], [-.296, 0, 0]];
export const SHIN: SculptRing[] = [[.094, 0, 0], [.08, .054, .055], [.052, .083, .085], [.024, .0975, .1005], [0, .099, .102], [-.07, .094, .097], [-.14, .082, .085], [-.2, .07, .073], [-.25, .066, .069]];
export const HAND_Y = -.162, ANKLE_Y = -.2, SOLE_Y = -.296;
/** How a limb is lit: like its profile, except that the ring where its end
 * drops inside the neighbouring limb is kept on the straight line of the
 * joint (see sculptLoft), so both halves are lit alike where they meet. */
const LIT = new Map<SculptRing[], SculptRing[]>([
  [UPPER_ARM, UPPER_ARM.map((ring): SculptRing => ring[0] === -.168 ? [-.168, .0762, .0791] : ring)],
  [FOREARM, FOREARM.map((ring): SculptRing => ring[0] === .02 ? [.02, .0767, .0797] : ring)],
  [THIGH, THIGH.map((ring): SculptRing => ring[0] === -.218 ? [-.218, .0995, .1025] : ring)],
  [SHIN, SHIN.map((ring): SculptRing => ring[0] === .024 ? [.024, .1009, .1039] : ring)],
]);
export const limbLit = (profile: SculptRing[]) => LIT.get(profile) ?? profile;

/** Half width and half depth of a limb profile at a height. */
export function limbAt(profile: SculptRing[], y: number): [number, number] {
  let index = 0; while (index < profile.length - 2 && profile[index + 1][0] > y) index++;
  const a = profile[index], b = profile[index + 1], t = Math.min(1, Math.max(0, (a[0] - y) / (a[0] - b[0])));
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
/** The rings of a limb (or of a sleeve/trouser leg `inflate` thicker, `scale`
 * wider) from `from` down to `to`. A cut end gets a rolled hem, optionally
 * flared. `step` adds rings so that no row is taller than it (crisp patterns). */
export function limbRings(profile: SculptRing[], inflate = 0, from = Infinity, to = -Infinity, flare = 0, scale = 1, step = 0): SculptRing[] {
  const at = (y: number) => limbAt(profile, y);
  const rings: SculptRing[] = [], grow = (size: number, y: number) => size <= 0 ? 0 : size * scale + inflate + (flare ? flare * smoothstep(to + .09, to, y) : 0);
  const body: number[] = [];
  if (from < profile[0][0]) { const [w, d] = at(from); rings.push([from - .004, w * scale - .004, d * scale - .004]); body.push(from); }
  for (const ring of profile) if (ring[0] < from && ring[0] > to) body.push(ring[0]);
  if (to > profile[profile.length - 1][0]) body.push(to);
  body.forEach((y, index) => {
    const [w, d] = at(y), pole = w === 0;
    rings.push([y + (pole ? Math.sign(y) * inflate : 0), grow(w, y), grow(d, y)]);
    const next = body[index + 1];
    if (step && next !== undefined && !pole) for (let k = 1, n = Math.round((y - next) / step); k < n; k++) { const yy = y + (next - y) * k / n, [ww, dd] = at(yy); if (ww > 0) rings.push([yy, grow(ww, yy), grow(dd, yy)]); }
  });
  if (to > profile[profile.length - 1][0]) { const [w, d] = at(to); rings.push([to + .006, w * scale - .006, d * scale - .006]); }
  return rings;
}
/** A limb (or a sleeve/trouser leg `inflate` thicker, `scale` wider) from `from`
 * down to `to`. A cut end gets a rolled hem, optionally flared. */
export function limb(profile: SculptRing[], inflate = 0, from = Infinity, to = -Infinity, flare = 0, scale = 1, segments = 14): THREE.BufferGeometry {
  return sculptLoft(limbRings(profile, inflate, from, to, flare, scale), segments, 1, 2, limbRings(limbLit(profile), inflate, from, to, flare, scale));
}
/** Tucks the hip end of a thigh under the body: its outer side moves well
 * inward (and the inner side a little, so the two legs close up at the
 * crotch). The hem of a top then overhangs the leg, which can swing and
 * waddle underneath without cutting through the cloth. */
export function tuckHip(rings: SculptRing[], side: number, amount = .0105): SculptRing[] {
  return rings.map((ring): SculptRing => { const tuck = ring[1] > 0 ? Math.min(ring[1] - .004, amount * smoothstep(-.11, -.03, ring[0])) : 0; return [ring[0], ring[1] - tuck, ring[2], ring[3] ?? 0, (ring[4] ?? 0) - side * tuck * 1.5]; });
}
/** A soft ball built from the same rings as a limb, so it joins one along a clean line (hands). */
export function ball(center: [number, number, number], size: [number, number, number], segments = 14, rows = 8): THREE.BufferGeometry {
  return sculptLoft(Array.from({ length: rows + 1 }, (_, row): SculptRing => { const theta = row / rows * Math.PI, s = row === 0 || row === rows ? 0 : Math.sin(theta); return [center[1] + size[1] * Math.cos(theta), size[0] * s, size[2] * s, center[2], center[0]]; }), segments);
}
/** A short band around a limb (cuffs, sock tops, stripes). */
export function band(profile: SculptRing[], y: number, height: number, inflate: number, scale = 1, segments = 14): THREE.BufferGeometry {
  return limb(profile, inflate, y + height / 2, y - height / 2, 0, scale, segments);
}

/** A round bun of a foot: wider than the ankle, with a big soft toe. */
export const FOOT = new SuperShape(.105, .082, .05, .168, .108, 2.3, 2.1, 4.2);
export const SOLE = new SuperShape(.109, .017, .017, .173, .113, 2.3, 3.5, 3.5);
export const FOOT_CENTER: [number, number, number] = [0, -.246, .02];
/** The foot as a mesh whose pole is the toe: its rows ring the toe, so a toe cap can be painted crisply. */
export function footMesh(columns = 16, rows = 10): THREE.BufferGeometry {
  return sculptGrid(columns, rows, (u, v, out) => {
    const phi = u * Math.PI * 2, theta = v * Math.PI, x = Math.sin(theta) * Math.cos(phi), y = Math.sin(theta) * Math.sin(phi), z = Math.cos(theta);
    out.set(x, y, z).multiplyScalar(FOOT.radius(x, y, z));
  });
}
/** Distance from the leg's axis to the surface of the foot at height y (shin
 * units), in the direction (sin, cos) of the ground plane; 0 above and below it. */
export function footReach(y: number, sin: number, cos: number, shape: SuperShape = FOOT): number {
  const dy = y - FOOT_CENTER[1], power = dy >= 0 ? shape.crown : shape.jaw, level = 1 - Math.pow(Math.min(1, Math.abs(dy) / (dy >= 0 ? shape.top : shape.bottom)), power);
  if (level <= 0) return 0;
  const limit = Math.pow(level, shape.round / power);
  let near = 0, far = .34;
  for (let step = 0; step < 16; step++) {
    const middle = (near + far) / 2, dz = middle * cos - FOOT_CENTER[2];
    if (Math.pow(Math.abs(middle * sin) / shape.w, shape.round) + Math.pow(Math.abs(dz) / (dz >= 0 ? shape.front : shape.back), shape.round) < limit) near = middle; else far = middle;
  }
  return near;
}
/** The FOOT form, `scale` larger in every direction but down (the sole stays on the ground). */
export const footShape = (scale: number) => new SuperShape(FOOT.w * scale, FOOT.top * scale, FOOT.bottom, FOOT.front * scale, FOOT.back * scale, FOOT.round, FOOT.crown, FOOT.jaw);
/** Leg and foot as one form: the distance from the leg's axis to whichever of
 * the two is further out at height y (the leg `neck` thicker), melted into
 * each other where they meet. */
export function footRadius(y: number, sin: number, cos: number, neck = .002, shape: SuperShape = FOOT): number {
  const [w, d] = limbAt(SHIN, y), leg = 1 / Math.hypot(sin / (w + neck), cos / (d + neck)), foot = footReach(y, sin, cos, shape), blend = Math.max(0, .02 - Math.abs(leg - foot)) / .02;
  return Math.max(leg, foot) + blend * blend * .005;
}
/** A foot, shoe or boot whose rings are stacked along the leg, like the rings
 * of the shin itself: it starts as a neck around the ankle at height `top`
 * (`neck` wider than the leg: next to nothing for a bare foot that grows out of
 * it, more for the collar of a shoe or the shaft of a boot) and swells into the
 * foot below, so leg and foot meet along one clean ring instead of a ragged
 * intersection. The lip of the neck rolls in against the leg. */
export function footLoft(neck = .002, top = -.164, shape: SuperShape = FOOT, columns = 20): THREE.BufferGeometry {
  // A bare foot has no lip: it simply continues the leg.
  const heights = neck < .004 ? [top] : [top + .002, top];
  for (const y of [-.11, -.14, -.172, -.182, -.194, -.208, -.226, -.246, -.266, -.283]) if (y < top - .006) heights.push(y);
  heights.push(SOLE_Y);
  return sculptGrid(columns, heights.length - 1, (u, v, out) => {
    const row = Math.round(v * (heights.length - 1)), y = heights[row], angle = u * Math.PI * 2, sin = Math.sin(angle), cos = Math.cos(angle);
    const [w, d] = limbAt(SHIN, y), radius = row === heights.length - 1 ? 0 : row === 0 && neck >= .004 ? 1 / Math.hypot(sin / (w - .006), cos / (d - .006)) : footRadius(y, sin, cos, neck, shape);
    out.set(sin * radius, y, cos * radius);
  });
}
const CENTER = new THREE.Vector3(...FOOT_CENTER);
/** A cap over the front of the foot, `lift` above it: the rubber toe of a
 * sneaker or, reaching further back, the upper of a slipper. Its rows ring the
 * toe, so the edge is crisp; `reach` is the angle from the toe where it ends
 * (optionally depending on the angle round the toe: PI/2 = on top). */
export function toeCap(reach: number | ((around: number) => number), lift = .004, shape: SuperShape = FOOT, columns = 14, rows = 4): THREE.BufferGeometry {
  return sculptGrid(columns, rows + 1, (u, v, out) => {
    const row = Math.round(v * (rows + 1)), phi = u * Math.PI * 2, theta = Math.min(row, rows) / rows * (typeof reach === 'number' ? reach : reach(phi));
    const x = Math.sin(theta) * Math.cos(phi), y = Math.sin(theta) * Math.sin(phi), z = Math.cos(theta);
    out.set(x, y, z).multiplyScalar(shape.radius(x, y, z) + (row > rows ? -.004 : lift * Math.min(1, .55 + row / rows))).add(CENTER);
    out.y = Math.max(out.y, SOLE_Y + .004); // its underside rests inside the sole
  });
}
/** The sole: a slab under the foot, `rim` wider than it all round, with a rounded edge. */
export function soleSlab(thick: number, rim = .004, shape: SuperShape = FOOT, columns = 20): THREE.BufferGeometry {
  const bevel = Math.min(.009, thick * .32), rows: [inset: number, y: number][] = [[-1, 0], [-bevel - .01, 0], [0, bevel], [0, thick - bevel], [-bevel, thick], [-.045, thick]];
  return sculptGrid(columns, rows.length - 1, (u, v, out) => {
    const [inset, y] = rows[Math.round(v * (rows.length - 1))], angle = u * Math.PI * 2, sin = Math.sin(angle), cos = Math.cos(angle);
    const radius = inset === -1 ? 0 : Math.max(.01, footReach(FOOT_CENTER[1], sin, cos, shape) + rim + inset);
    out.set(sin * radius, SOLE_Y + y, cos * radius);
  });
}
/** Height of the foot's upper surface above its centre at (x, z) in shin units; 0 outside. */
export function footTop(x: number, z: number): number {
  const dz = z - FOOT_CENTER[2], lateral = Math.pow(Math.abs(x) / FOOT.w, FOOT.round) + Math.pow(Math.abs(dz) / (dz >= 0 ? FOOT.front : FOOT.back), FOOT.round);
  return lateral >= 1 ? 0 : FOOT.top * Math.pow(1 - Math.pow(lateral, FOOT.crown / FOOT.round), 1 / FOOT.crown);
}
/** Half width of the foot at depth z. */
export function footHalfWidth(z: number): number {
  const dz = z - FOOT_CENTER[2], along = Math.pow(Math.abs(dz) / (dz >= 0 ? FOOT.front : FOOT.back), FOOT.round);
  return along >= 1 ? 0 : FOOT.w * Math.pow(1 - along, 1 / FOOT.round);
}
