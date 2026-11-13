import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TORSO, TORSO_POWER, torsoBack, torsoFront } from './avatar-body';
import { SuperShape, ellipseOutline, polygonOutline, sculptGrid, sculptHorn, sculptLoft, sculptPatch, sculptShell, sculptSweep, smoothOutline, smoothstep, type Vec2, type Vec3 } from './avatar-sculpt';
import { darken, lighten, mixColor, type AvatarPainter, type Tint } from './avatar-painter';

type Accessories = { species: string; headwear?: string; eyewear?: string; neckwear?: string; backwear?: string };
export type HeadFit = { shape: SuperShape; eyeX: number; eyeY: number; hairLift: number };

const TAU = Math.PI * 2;
const WHITE = 0xffffff, CREAM = 0xfff6e7, INK = 0x56607c, GOLD = 0xf4cf6e, CORAL = 0xff857c, MINT = 0x8fdcbc, LILAC = 0xbaa0f2, PINK = 0xff9fb8, LEAF = 0x93d48c;
const signedPow = (value: number, exponent: number) => Math.sign(value) * Math.pow(Math.abs(value), exponent);
const rect = (cx: number, cy: number, hw: number, hh: number, power = 4.5, segments = 20, roll = 0) => ellipseOutline(cx, cy, hw, hh, roll, segments, power);
function star(cx: number, cy: number, outer: number, inner = outer * .5): Vec2[] {
  const points: Vec2[] = []; for (let i = 0; i < 10; i++) { const angle = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? inner : outer; points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]); }
  return points;
}

/* ------------------------------------------------------------------ modelling helpers */
/** Horizontal radius of the skull at height `y` towards azimuth `phi` (0 = front, + = the figure's left). */
function girth(shape: SuperShape, y: number, phi: number): number {
  const power = y >= 0 ? shape.crown : shape.jaw, vertical = Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(y) / (y >= 0 ? shape.top : shape.bottom)), power));
  const sin = Math.abs(Math.sin(phi)), cos = Math.cos(phi);
  return Math.pow(Math.pow(vertical, shape.round / power) / (Math.pow(sin / shape.w, shape.round) + Math.pow(Math.abs(cos) / (cos >= 0 ? shape.front : shape.back), shape.round)), 1 / shape.round);
}
/** A point `lift` outside the skull at height `y`. */
const onSkull = (shape: SuperShape, y: number, phi: number, lift: number): Vec3 => { const r = girth(shape, y, phi) + lift; return [Math.sin(phi) * r, y, Math.cos(phi) * r]; };
const outward = (phi: number): Vec3 => [Math.sin(phi), 0, Math.cos(phi)];
/** Torso half width, half depth and centre z at height `y`. */
function torsoSection(y: number) {
  let index = 0; while (index < TORSO.length - 2 && TORSO[index + 1][0] < y) index++;
  const a = TORSO[index], b = TORSO[index + 1], t = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, (a[3] ?? 0) + ((b[3] ?? 0) - (a[3] ?? 0)) * t];
}
/** A point `grow` outside the torso at height `y`, azimuth `phi`. */
function aroundTorso(y: number, phi: number, grow: number): Vec3 {
  const [w, d, zc] = torsoSection(y), e = 2 / TORSO_POWER;
  return [signedPow(Math.sin(phi), e) * (w + grow), y, zc + signedPow(Math.cos(phi), e) * (d + grow)];
}
/** `count` points evenly spaced along a polyline (a closed one repeats its first point at the end). */
function spaced(path: Vec3[], count: number, closed = false): Vec3[] {
  const lengths = [0]; for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
  const total = lengths[lengths.length - 1], result: Vec3[] = [];
  for (let k = 0, index = 1; k < count; k++) {
    const target = total * k / (closed ? count : count - 1);
    while (index < path.length - 1 && lengths[index] < target) index++;
    const t = (target - lengths[index - 1]) / Math.max(1e-6, lengths[index] - lengths[index - 1]), a = path[index - 1], b = path[index];
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return result;
}

/** A seamless ring through `points`. Its section measures `radius` across and
 * `radius * depth` along `out` (a band lying on a surface when depth < 1). */
function sculptLoop(points: Vec3[], radius: number, out: Vec3 | ((index: number) => Vec3) = [0, 0, 1], depth = 1, segments = 6): THREE.BufferGeometry {
  const n = points.length, tangent = new THREE.Vector3();
  const frames = points.map((_point, index) => {
    const a = points[(index + n - 1) % n], b = points[(index + 1) % n];
    tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const o = new THREE.Vector3(...(typeof out === 'function' ? out(index) : out)); o.addScaledVector(tangent, -o.dot(tangent)).normalize();
    return [o, new THREE.Vector3().crossVectors(tangent, o)];
  });
  const geometry = sculptGrid(segments, n, (u, v, target) => {
    const index = Math.round(v * n) % n, angle = u * TAU, [o, side] = frames[index];
    target.set(...points[index]).addScaledVector(o, Math.cos(angle) * radius * depth).addScaledVector(side, Math.sin(angle) * radius);
  });
  // The ring closes on itself: its first and last sections share their normals, so no seam is lit.
  const normals = geometry.getAttribute('normal'), last = n * (segments + 1), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let k = 0; k <= segments; k++) {
    a.fromBufferAttribute(normals, k).add(b.fromBufferAttribute(normals, last + k)).normalize();
    normals.setXYZ(k, a.x, a.y, a.z); normals.setXYZ(last + k, a.x, a.y, a.z);
  }
  return geometry;
}
/** A soft brim around the skull: a lens-shaped section that leaves the head at
 * height `y`, `inner` outside the skull, and reaches `width(phi)` further out,
 * falling by `slope` per unit of width. A width of zero closes it (a cap's bill). */
function sculptBrim(shape: SuperShape, y: number, inner: number, width: (phi: number) => number, slope: number, thickness: number, columns = 28, from = -Math.PI, to = Math.PI, curl = 0, rows = 8): THREE.BufferGeometry {
  return sculptGrid(columns, rows, (u, v, out) => {
    const phi = from + (to - from) * u, angle = v * TAU, w = width(phi), t = (1 - Math.cos(angle)) / 2, r = girth(shape, y, phi) + inner + w * t;
    out.set(Math.sin(phi) * r, y - slope * w * Math.pow(t, 1.25) + curl * w * Math.pow(t, 4) + Math.sin(angle) * thickness * Math.min(1, w / .06), Math.cos(phi) * r);
  });
}
/** A crown that follows the skull `off` above it, from the top down to height `edge` (its open rim is meant to end inside a brim). */
function sculptCrown(shape: SuperShape, edge: number, off: (y: number) => number, columns = 28, rows = 6): THREE.BufferGeometry {
  const top = shape.top + off(shape.top);
  return sculptGrid(columns, rows, (u, v, out) => {
    const phi = u * TAU, y = edge + (top - edge) * Math.cos(v * Math.PI / 2), grown = shape.grown(off(y)), r = y >= grown.top ? 0 : girth(grown, y, phi);
    out.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
  });
}
/** A moulded hat body that keeps its thickness right down to the rim (hair never shows through it).
 * `rows` run from the crown to the rim as [height (1 = crown, 0 = rim), thickness above the skull,
 * drop below the rim]; the rim height `edge` may vary round the head (phi 0 = front). */
function sculptCap(shape: SuperShape, edge: (phi: number) => number, rows: number[][], columns = 32): THREE.BufferGeometry {
  return sculptGrid(columns, rows.length - 1, (u, v, out) => {
    const phi = u * TAU - Math.PI, [h, off, drop = 0] = rows[Math.round(v * (rows.length - 1))], grown = shape.grown(off), low = edge(phi);
    const y = h >= 1 ? grown.top : low + (grown.top - low) * h - drop, r = h >= 1 ? 0 : girth(grown, y, phi);
    out.set(Math.sin(phi) * r, y, Math.cos(phi) * r);
  });
}
/** Rows for sculptCap: a dome from the crown down to height fraction `to`, evenly spaced along its curve.
 * `low` is roughly rim height / crown height (how far short of the skull's equator the hat stops). */
const domeRows = (count: number, off: number, low = .35, to = 0): number[][] => {
  const span = Math.acos(low + (1 - low) * to), end = Math.cos(span);
  return Array.from({ length: count + 1 }, (_, k) => [k ? to + (1 - to) * (Math.cos(k / count * span) - end) / (1 - end) : 1, off]);
};
/** A hat turned on the skull's own outline at height `base`: rows of [height above base, distance outside the skull, pleat depth, scale]. */
function sculptStack(shape: SuperShape, base: number, profile: number[][], pleats = 0, lean = 0, columns = 30): THREE.BufferGeometry {
  const height = profile[profile.length - 1][0];
  return sculptGrid(columns, profile.length - 1, (u, v, out) => {
    const phi = u * TAU, [dy, off, pleat = 0, scale = 1] = profile[Math.round(v * (profile.length - 1))];
    const r = (girth(shape, base, phi) + off) * scale * (1 + pleats * pleat * Math.cos(phi * 6)), shift = lean * smoothstep(.3, 1, dy / height);
    out.set(Math.sin(phi) * r + shift, base + dy - shift * .5 * Math.sin(phi) * scale, Math.cos(phi) * r - shift * .3);
  });
}
/** A cushion: `outline` in the x/y plane (star-shaped around `center`), domed to
 * `thickness` on the +z side and `thickness * back` behind. */
function sculptPillow(outline: Vec2[], thickness: number, center?: Vec2, back = 1, form: 'soft' | 'flat' | 'thin' = 'soft'): THREE.BufferGeometry {
  const n = outline.length, c = center ?? [outline.reduce((sum, point) => sum + point[0], 0) / n, outline.reduce((sum, point) => sum + point[1], 0) / n];
  const half = form === 'thin' ? [[0, 1], [.9, 1], [1, 0]] : form === 'flat' ? [[0, 1], [.78, 1], [.95, .7], [1, 0]] : [[0, 1], [.58, .82], [.9, .45], [1, 0]];
  const rows = [...half, ...half.slice(0, -1).reverse().map(([rho, h]) => [rho, -h * back])];
  return sculptGrid(n, rows.length - 1, (u, v, out) => {
    const point = outline[Math.round(u * n) % n], [rho, h] = rows[Math.round(v * (rows.length - 1))];
    out.set(c[0] + (point[0] - c[0]) * rho, c[1] + (point[1] - c[1]) * rho, h * thickness);
  });
}
const Z_AXIS = new THREE.Vector3(0, 0, 1), Y_AXIS = new THREE.Vector3(0, 1, 0);
/** Rotation taking `axis` onto `normal`, placed at `at`. */
function aim(axis: THREE.Vector3, normal: Vec3, at: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(...normal).normalize())).setPosition(...at);
}
/** A little five-petal blossom lying on a surface whose outward direction is `normal`. */
function flower(p: AvatarPainter, owner: THREE.Object3D, at: Vec3, normal: Vec3, color: number, radius: number, heart = GOLD, plump = false) {
  // A plump blossom has fuller, rounder petals whose edge rolls under, so it still reads as a soft bud when it is seen from the side.
  const frame = aim(Z_AXIS, normal, at), profile = plump ? [[0, .5], [.6, .46], [1, .12], [.84, -.07]] : [[0, .36], [.55, .34], [1, 0]];
  const lobes = plump ? [.72, .95, 1, .95] : [.46, .92, 1, .92], columns = 20, rows = profile.length - 1;
  const petals = sculptGrid(columns, rows, (u, v, out) => {
    const k = Math.round(u * columns) % columns, angle = k / columns * TAU, [rho, h] = profile[Math.round(v * rows)], lobe = rho > 0 ? lobes[k % lobes.length] : 1;
    out.set(Math.cos(angle) * radius * rho * lobe, Math.sin(angle) * radius * rho * lobe, radius * h);
  }, [0, 0, 1]);
  petals.applyMatrix4(frame); p.put(owner, petals, color);
  const centre = sculptHorn(radius * .34, radius * .34, radius * .3, 1.2, [0, 0], 6, plump ? 1 : 2); centre.rotateX(Math.PI / 2); centre.translate(0, 0, radius * (plump ? .38 : .28)); centre.applyMatrix4(frame);
  p.put(owner, centre, heart, .3);
}

/** Four simultaneous slots, merged into the head and torso batches. */
export function renderAvatarAccessories(p: AvatarPainter, a: Accessories, head: THREE.Group, body: THREE.Group, fit: HeadFit): void {
  const hat = a.headwear ?? 'none', eyes = a.eyewear ?? 'none', neck = a.neckwear ?? 'none', back = a.backwear ?? 'none';
  const { shape } = fit, lift = fit.hairLift, insect = a.species === 'bee' || a.species === 'butterfly';
  /** A small low-cost ball (beads, buttons, bow loops). */
  const bead = (owner: THREE.Object3D, tint: Tint, at: Vec3, size: number | Vec3, gloss = 0, rotation?: Vec3, segments = 8) =>
    p.put(owner, new THREE.SphereGeometry(1, segments, 5), tint, gloss, at, typeof size === 'number' ? [size, size, size] : size, rotation);
  /** A flat strap through `points`, thin along the direction it is laid on. */
  const strap = (owner: THREE.Object3D, tint: Tint, points: Vec3[], radius: number, rows = points.length * 2) => p.line(owner, tint, points, radius, 0, { segments: 4, rows, round: false, flat: .45 });

  /* ---------------------------------------------------------------- headwear */
  if (hat !== 'none') {
    /** A point `extra` outside a hat that is `off` thick, at height `y`. */
    const onHat = (y: number, phi: number, off: number, extra = 0): Vec3 => { const r = girth(shape.grown(off), y, phi) + extra; return [Math.sin(phi) * r, y, Math.cos(phi) * r]; };
    /** A ring round the hat (its seam at the back): a flat band when `depth` is small, a rolled hem when it is 1. */
    const hatRing = (edge: (phi: number) => number, off: number, extra: number, radius: number, tint: Tint, columns = 32, depth = 1, segments = 4) => {
      const phis = Array.from({ length: columns }, (_, index) => index / columns * TAU - Math.PI);
      p.put(head, sculptLoop(phis.map(phi => onHat(edge(phi), phi, off, extra)), radius, index => outward(phis[index]), depth, segments), tint);
    };
    if (hat === 'cap-mint') {
      // The shell is thicker than any hairstyle all the way to its rim; hair only shows below the rolled hem.
      const mint = 0x8fdcbc, shell = lift + .024, edge = (phi: number) => .194 - .07 * (1 - Math.cos(phi)) / 2;
      p.put(head, sculptCap(shape, edge, [...domeRows(7, shell, .32), [0, lift - .012, .016]], 32), mint);
      hatRing(edge, shell, -.013, .021, mint, 32);
      // The bill grows out of the front of the crown and dips a little.
      p.put(head, sculptBrim(shape, .195, shell - .035, phi => .225 * Math.pow(Math.max(0, Math.cos(phi * 1.5)), .7), .42, .022, 16, -1.045, 1.045), darken(mint, .84));
      bead(head, darken(mint, .86), [0, shape.top + shell, 0], [.034, .018, .034]);
      p.decal(head, CREAM, shape.grown(shell).frontZ, rect(0, .33, .075, .05, 4), { rings: 2, lift: .004, bevel: .15 });
    } else if (hat === 'bucket-yellow') {
      // Soft crown with straight-ish sides and a short brim that slopes down all round.
      const lemon = 0xffe27a, shell = lift + .028, flare = (y: number) => shell + .03 * smoothstep(.42, .2, y);
      p.put(head, sculptCrown(shape, .195, flare, 32), lemon);
      p.put(head, sculptBrim(shape, .202, lift - .012, () => .175, .8, .024, 32, -Math.PI, Math.PI, 0, 6), mixColor(lemon, 0xffc23f, .35));
      hatRing(() => .262, flare(.262), .002, .026, lighten(lemon, .6), 32, .3);
    } else if (hat === 'straw-ribbon') {
      // Round crown, a wide sun brim, a ribbon and a bow at the side.
      const straw = 0xf4dca6, shell = lift + .034, bow = .95;
      p.put(head, sculptCrown(shape, .205, () => shell, 32), straw);
      p.put(head, sculptBrim(shape, .212, lift - .012, () => .195, .26, .021, 32, -Math.PI, Math.PI, .12, 6), (x, _y, z) => mixColor(straw, 0xe3bf7c, smoothstep(.52, .68, Math.hypot(x, z))));
      hatRing(() => .27, shell, .002, .032, PINK, 32, .3);
      const knot = onHat(.264, bow, shell, .012), along: Vec3 = [Math.cos(bow), 0, -Math.sin(bow)];
      for (const side of [-1, 1]) {
        bead(head, PINK, [knot[0] + along[0] * side * .066, knot[1] + .012, knot[2] + along[2] * side * .066], [.074, .05, .03], 0, [0, bow, side * .3]);
        bead(head, darken(PINK, .93), [knot[0] + along[0] * side * .03 + Math.sin(bow) * .012, knot[1] - .045, knot[2] + along[2] * side * .03 + Math.cos(bow) * .012], [.026, .05, .018], 0, [0, bow, side * .4], 6);
      }
      bead(head, darken(PINK, .93), [knot[0] + Math.sin(bow) * .012, knot[1] + .004, knot[2] + Math.cos(bow) * .012], [.03, .036, .03], 0, [0, bow, 0], 6);
    } else if (hat === 'chef-hat') {
      // A tall band and a pleated puff that leans a little to one side.
      const base = .3, band = 0xf6eee0, puff = 0xfffdf8, wide = lift < .03 ? .02 : 0;
      p.put(head, sculptStack(shape, base, [[-.03, lift - .014], [0, lift + .03 + wide], [.07, lift + .033 + wide], [.14, lift + .036 + wide], [.156, lift + .022 + wide],
        [.19, lift + .09, .6], [.25, lift + .135, 1], [.32, lift + .13, 1], [.385, lift + .08, .9, .93], [.43, lift, .7, .72], [.455, 0, .4, .4], [.465, 0, 0, 0]], .06, .05), (_x, y) => y < base + .16 ? band : puff);
    } else if (hat === 'flower-crown') {
      // A full garland of plump blossoms resting on the slope of the crown (higher on insects, clear of the bee's stripes).
      const rise = insect ? .8 : .74, up = Math.sin(rise), flat = Math.cos(rise), points: Vec3[] = [];
      for (let i = 0; i < 20; i++) { const phi = i / 20 * TAU; points.push(shape.along(Math.sin(phi) * flat, up, Math.cos(phi) * flat, lift + .016)); }
      p.put(head, sculptLoop(points, .021, [0, 1, 0], 1, 3), LEAF);
      for (let i = 0; i < 8; i++) {
        const phi = (i + .5) / 8 * TAU, d: Vec3 = [Math.sin(phi) * flat, up, Math.cos(phi) * flat], pale = i % 4 === 1;
        // Each blossom looks outward and up, so the ones at the sides still show their faces.
        flower(p, head, shape.along(...d, lift + .024), [d[0], d[1] + .65, d[2]], [0xffa9c2, 0xfffaf0, 0xffdf8a, 0xffc4d6][i % 4], i % 2 ? .092 : .106, pale ? 0xffb6c8 : GOLD, true);
      }
    } else if (hat === 'space-helmet') {
      const shell = 0xf7f9fc, trim = 0xa9bcd6;
      p.put(head, sculptShell(shape, { columns: 28, rows: 6, pole: 'back', edge: () => -.15, thickness: () => lift + .045 }), shell, .45);
      const rim: Vec3[] = [];
      for (let i = 0; i < 32; i++) {
        // The point of the skull's z = .15 section in direction `phi`: where the shell ends.
        const phi = i / 32 * TAU, sin = Math.sin(phi), cos = Math.cos(phi); let low = 0, high = Math.PI / 2;
        for (let step = 0; step < 18; step++) { const theta = (low + high) / 2, d: Vec3 = [Math.sin(theta) * sin, Math.sin(theta) * cos, Math.cos(theta)]; if (d[2] * shape.radius(...d) > .15) low = theta; else high = theta; }
        rim.push(shape.along(Math.sin(low) * sin, Math.sin(low) * cos, Math.cos(low), lift + .05));
      }
      p.put(head, sculptLoop(rim, .036, [0, 0, 1], 1, 5), trim, .3);
      const cupX = shape.w + lift + .06;
      for (const side of [-1, 1]) p.blob(head, 0xff9fb0, [side * cupX, -.03, -.02], [.045, .11, .11], [0, 0, 0], .4, 10);
      // Ears leave the shell through soft grommets: [how far below the joint the ear starts, its outward lean, backward lean, half width and half depth where it crosses the shell].
      const hole = ({ cat: [.075, .4, -.07, .107, .067], fox: [.075, .36, -.07, .119, .077], rabbit: [.05, .13, -.06, .088, .05], bear: [-.03, .756, -.04, .118, .046] } as Record<string, number[]>)[a.species];
      if (hole) for (const ear of head.children) {
        if (ear.name !== 'avatar-ear' || !ear.visible) continue;
        const side = ear.position.x < 0 ? -1 : 1, n = ear.position.clone().normalize(), axis = new THREE.Vector3(side * Math.sin(hole[1]), Math.cos(hole[1]), hole[2]).normalize();
        const centre = ear.position.clone().addScaledVector(Y_AXIS, -hole[0]).addScaledVector(axis, (lift + .041 + hole[0] * n.y) / axis.dot(n));
        const wide = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize(), deep = new THREE.Vector3().crossVectors(n, wide);
        const ring = Array.from({ length: 14 }, (_, index) => { const t = index / 14 * TAU, at = centre.clone().addScaledVector(wide, Math.cos(t) * (hole[3] + .006)).addScaledVector(deep, Math.sin(t) * (hole[4] + .006)); return [at.x, at.y, at.z] as Vec3; });
        p.put(head, sculptLoop(ring, .031, [n.x, n.y, n.z], .9, 5), trim, .3);
      }
      // The aerial stands behind the crown; long ears and antennae take that place, so there it rises from an ear cup instead.
      const aerial: Vec3[] = a.species === 'rabbit' || insect ? [[cupX + .012, .05, -.03], [cupX + .04, .25, -.04]] : [[.2, shape.top + .02, -.12], [.23, shape.top + .17, -.13]], tip = aerial[1];
      p.line(head, trim, aerial, .012, 0, { segments: 6, rows: 2 });
      p.blob(head, 0xff8a7a, [tip[0] + .002, tip[1] + .02, tip[2]], [.03, .03, .03], [0, 0, 0], .5, 10);
    } else if (hat === 'beanie-rose') {
      // A knitted dome pulled well down over the hairline, with a soft turned-up cuff and a pompom.
      const rose = 0xf5adc6, cuff = 0xe58fae, knit = lift + .03, fold = knit + .017, edge = (phi: number) => .085 - .05 * (1 - Math.cos(phi)) / 2;
      p.put(head, sculptCap(shape, edge, [...domeRows(6, knit, .12, .3), [.275, knit + .006], [.25, fold], [.13, fold + .003], [.03, fold], [0, fold - .012, .008], [0, lift - .012, .02]], 32),
        (x, y, z) => y < edge(Math.atan2(x, z)) + (shape.top + knit - edge(Math.atan2(x, z))) * .288 ? cuff : rose);
      p.blob(head, 0xffd3e2, [0, shape.top + knit + .05, -.01], [.078, .074, .078], [0, 0, 0], 0, 12);
    } else if (hat === 'beret-cream') {
      // A soft disc slouching to one side over a snug band, with a little stalk.
      const felt = 0xf6e7c3, band = 0xe2cfa4, base = .245;
      p.put(head, sculptStack(shape, base, [[-.03, lift - .014], [0, lift + .03], [.03, lift + .034], [.046, lift + .024],
        [.066, lift + .075], [.105, lift + .105], [.15, lift + .1, 0, .97], [.2, lift + .055, 0, .86], [.238, lift, 0, .62], [.256, 0, 0, .3], [.262, 0, 0, 0]], 0, .07, 28), (_x, y) => y < base + .048 ? band : felt);
      p.line(head, band, [[.07, base + .25, -.02], [.084, base + .298, -.022]], .014, 0, { segments: 6, rows: 2 });
    }
    p.features.push(`accessory-headwear:${hat}`);
  }

  /* ---------------------------------------------------------------- eyewear */
  if (eyes !== 'none') {
    // Frames are drawn on the face itself, so they wrap it on every species.
    const { eyeX } = fit, z = shape.frontZ, k = insect ? 1.12 : 1, cy = fit.eyeY + .004, float = .037;
    const on = (x: number, y: number, off = float): Vec3 => [x, y, z(x, y) + off];
    const rim = (outline: Vec2[], radius: number, tint: Tint, gloss = .5, off = float, segments = 6) => p.put(head, sculptLoop(outline.map(([x, y]) => on(x, y, off)), radius, [0, 0, 1], 1, segments), tint, gloss);
    /** Temple arms from the outer edge of the frame back to the ears. */
    const arms = (tint: Tint, reach: number, radius = .0095, y = cy + .02) => {
      for (const side of [-1, 1]) {
        const x = eyeX + reach, start = Math.atan2(x, z(x, y)), hinge = on(side * (x - .012), y, float - .004);
        // Under hair the arm simply disappears into it; on a bare head it is short and ends in a rounded, slightly drooping tip.
        if (lift > .03) p.line(head, tint, [hinge, onSkull(shape, y + .004, side * (start + .2), .018), onSkull(shape, y + .01, side * 1.25, .009), onSkull(shape, y + .012, side * 1.72, .003)], radius, .5, { segments: 5, rows: 6, round: false });
        else p.line(head, tint, [hinge, onSkull(shape, y + .004, side * (start + .17), .018), onSkull(shape, y + .004, side * (start + .36), .012), onSkull(shape, y - .012, side * (start + .5), .01)],
          t => radius * (1 + .3 * smoothstep(.72, 1, t)), .5, { segments: 5, rows: 6 });
      }
    };
    const bridge = (tint: Tint, gap: number, radius = .0095, y = cy + .022) => p.line(head, tint, [on(-gap, y), on(0, y + .012, float + .004), on(gap, y)], radius, .5, { segments: 5, rows: 3, round: false });
    const lens = (tint: Tint, outline: Vec2[], off = .028, gloss = .9, dome = .008) => p.decal(head, tint, z, outline, { rings: 2, lift: off, dome, bevel: .1 }, gloss);

    if (eyes === 'round-glasses') {
      const frame = 0x9a745a;
      for (const side of [-1, 1]) rim(ellipseOutline(side * eyeX, cy, .102 * k, .102 * k, 0, 20), .0105, frame);
      bridge(frame, eyeX - .1 * k); arms(frame, .1 * k);
    } else if (eyes === 'square-glasses') {
      for (const side of [-1, 1]) rim(rect(side * eyeX, cy, .112 * k, .096 * k, 4.2, 20), .0125, INK);
      bridge(INK, eyeX - .11 * k, .011); arms(INK, .11 * k, .011);
    } else if (eyes === 'heart-glasses') {
      const pink = 0xff8fae;
      for (const side of [-1, 1]) rim(smoothOutline(([[0, .086], [.062, .124], [.126, .098], [.138, .028], [.084, -.062], [0, -.128], [-.084, -.062], [-.138, .028], [-.126, .098], [-.062, .124]] as Vec2[]).map(([x, y]) => [side * eyeX + x * k, cy - .006 + y * k] as Vec2), 2), .014, pink);
      bridge(pink, eyeX - .13 * k, .011, cy + .04); arms(pink, .132 * k, .011, cy + .03);
    } else if (eyes === 'star-glasses') {
      for (const side of [-1, 1]) rim(polygonOutline(star(side * eyeX, cy - .012, .15 * k, .098 * k), 2), .0155, GOLD, .6);
      bridge(GOLD, eyeX - .135 * k, .011, cy + .034); arms(GOLD, .135 * k, .011, cy + .034);
    } else if (eyes === 'sport-glasses') {
      // One wrap-around shield with a nose notch and a bright top bar.
      const s = eyeX / .192, frame = 0x6f9fd8, top: Vec2[] = [[-.335, .066], [-.2, .096], [0, .088], [.2, .096], [.335, .066]];
      const shield = smoothOutline(([...top, [.35, 0], [.3, -.082], [.17, -.108], [.065, -.074], [0, -.03], [-.065, -.074], [-.17, -.108], [-.3, -.082], [-.35, 0]] as Vec2[]).map(([x, y]) => [x * s * (k + 1) / 2, cy + y * k] as Vec2), 2);
      p.decal(head, (_x, y) => mixColor(0xb4ecf2, 0x7fb2ee, smoothstep(cy - .1, cy + .09, y)), z, shield, { rings: 2, lift: .03, dome: .01, bevel: .08, center: [0, cy + .01] }, .95);
      p.line(head, frame, top.map(([x, y]) => on(x * .94 * s * (k + 1) / 2, cy + y * k + .006, .045)), .015, .4, { segments: 6, rows: 10 });
      p.decal(head, WHITE, (x, y) => z(x, y) + .041, ellipseOutline(-eyeX - .03, cy + .03, .045, .012, .5, 8), { lift: .002, bevel: .3 }, .3);
      arms(frame, .14 * s, .012, cy + .05);
    } else if (eyes === 'monocle') {
      // Worn on the figure's right eye; its fine chain runs down the cheek and away under the jaw, towards the collar.
      rim(ellipseOutline(-eyeX, cy, .104 * k, .104 * k, 0, 22), .012, GOLD, .75, float, 7);
      const low = -shape.bottom, chain: Vec3[] = [on(-eyeX - .08 * k, cy - .066 * k, .03), onSkull(shape, cy - .15, -.96, .012), onSkull(shape, low * .68, -1.2, .01), onSkull(shape, low * .86, -1.42, .008), onSkull(shape, low * .97, -1.55, -.02)];
      p.line(head, GOLD, chain, .0058, .75, { segments: 5, rows: 12, round: false });
    } else if (eyes === 'goggles') {
      const tan = 0xdcae7c, glass = 0xa9e6e2, strap = 0xb98a62, y = cy + .004;
      for (const side of [-1, 1]) {
        rim(ellipseOutline(side * eyeX, cy, .106 * k, .106 * k, 0, 18), .021, tan, .25, float + .006, 5);
        rim(ellipseOutline(side * eyeX, cy, .082 * k, .082 * k, 0, 14), .009, glass, .9, float + .02, 4);
      }
      bridge(tan, eyeX - .1 * k, .016, cy);
      // A flat elastic band right round the head: it leaves each rim, lies on the hair (or the fur) and never stands off it.
      const from = Math.atan2(eyeX + .1 * k, z(eyeX + .1 * k, y)), over = lift > .03 ? lift + .02 : .009, phis = Array.from({ length: 21 }, (_, index) => from + (TAU - 2 * from) * index / 20);
      p.line(head, strap, phis.map((phi, index) => onSkull(shape, y, phi, index % 20 ? over : float - .012)), .02, 0, { segments: 4, rows: 22, round: false, flat: .3, up: outward(from) });
    } else if (eyes === 'pixel-glasses') {
      // Chunky stair-stepped shades with two pixel glints.
      const dark = 0x4d4b66, w = .128 * k, u = .034 * k, top = cy + .098 * k, low = cy - .1 * k;
      for (const side of [-1, 1]) {
        const x = side * eyeX;
        lens(dark, polygonOutline([[x - w, top], [x + w, top], [x + w, low + 2 * u], [x + w - u, low + 2 * u], [x + w - u, low + u], [x + w - 2 * u, low + u], [x + w - 2 * u, low],
          [x - w + 2 * u, low], [x - w + 2 * u, low + u], [x - w + u, low + u], [x - w + u, low + 2 * u], [x - w, low + 2 * u]], 2), .03, .85, .004);
        for (const [dx, dy] of [[-.07, .052], [-.036, .018]]) p.decal(head, 0xcfcdea, (px, py) => z(px, py) + .033, polygonOutline([[x + dx * k - .017, top - .046 + dy * k - .017], [x + dx * k + .017, top - .046 + dy * k - .017], [x + dx * k + .017, top - .046 + dy * k + .017], [x + dx * k - .017, top - .046 + dy * k + .017]], 1), { lift: .002, bevel: .1 }, .5);
      }
      lens(dark, polygonOutline([[-(eyeX - w) - .01, top], [eyeX - w + .01, top], [eyeX - w + .01, top - u * 1.3], [-(eyeX - w) - .01, top - u * 1.3]], 2), .03, .85, .002);
      arms(dark, w, .013, top - .03);
    }
    p.features.push(`accessory-eyewear:${eyes}`);
  }

  /* ---------------------------------------------------------------- neckwear */
  if (neck !== 'none') {
    // Everything rests on the garment: a little outside the bare torso.
    const chest = (x: number, y: number) => torsoFront(x, y) + .024, spine = (x: number, y: number) => torsoBack(x, y) - .024;
    const ringPhis = (count: number) => Array.from({ length: count }, (_, index) => index / count * TAU);
    /** A band round the base of the neck. */
    const collar = (tint: Tint, radius: number, depth = .4, y = .328, grow = .012, columns = 16) => {
      const phis = ringPhis(columns); p.put(body, sculptLoop(phis.map(phi => aroundTorso(y, phi, grow)), radius, index => outward(phis[index]), depth, 4), tint);
    };
    /** A necklace line: high behind the neck, dipping to `low` on the chest. */
    const necklace = (low: number, grow: number, from = 0, to = TAU, steps = 40, high = .33): Vec3[] =>
      Array.from({ length: steps + 1 }, (_, index) => { const phi = from + (to - from) * index / steps; return aroundTorso(high - (high - low) * Math.pow((1 + Math.cos(phi)) / 2, 1.5), phi, grow); });

    if (neck === 'scarf-red') {
      // A chunky wrap, one tail down the chest and one thrown over the back.
      // Two plump turns: the lower one rests on the shoulders, the upper one is wound a little tighter and askew.
      const wool = 0xff857c, pale = 0xffd2c6, phis = ringPhis(24), turn = ringPhis(16);
      // (It sags a little in front and tucks in between neck and shoulder at the sides.)
      p.put(body, sculptLoop(phis.map(phi => aroundTorso(.288 - .014 * Math.cos(phi), phi, .034 - .03 * Math.sin(phi) ** 2)), .055, index => outward(phis[index]), .95, 6), wool);
      p.put(body, sculptLoop(turn.map(phi => aroundTorso(.326 + .014 * Math.sin(phi + .9), phi, .028 - .02 * Math.sin(phi) ** 2)), .044, index => outward(turn[index]), 1, 4), lighten(wool, .1));
      const tail = (surface: (x: number, y: number) => number, cx: number, roll: number, behind: boolean) => {
        p.decal(body, wool, surface, rect(cx, .185, .046, .115, 3.6, 18, roll), { rings: 2, lift: .016, dome: .012, bevel: .16, back: behind });
        for (const y of [.115, .15]) p.decal(body, pale, (px, py) => surface(px, py) + (behind ? -.03 : .03), rect(cx + (y - .185) * Math.sin(-roll), y, .04, .009, 4, 10, roll), { lift: .002, bevel: .2, back: behind });
      };
      tail(chest, .082, -.1, false); tail(spine, -.085, .1, true);
      p.blob(body, darken(wool, .95), [.082, .272, chest(.082, .272) + .04], [.058, .052, .046], [0, 0, -.1], 0, 10);
    } else if (neck === 'bowtie-mint') {
      const y = .268, zc = chest(0, y) + .016, deep = 0x6fc7a4;
      collar(deep, .019);
      for (const side of [-1, 1]) {
        const wing = sculptPillow(smoothOutline(([[0, .02], [.055, .05], [.105, .06], [.124, 0], [.105, -.06], [.055, -.05], [0, -.02]] as Vec2[]).map(([x, wy]) => [side * x, wy] as Vec2), 2), .022, [side * .066, 0]);
        p.put(body, wing, MINT, .1, [side * .008, y, zc], [1, 1, 1], [0, side * .32, 0]);
      }
      bead(body, deep, [0, y, zc + .012], [.027, .034, .026], .1);
    } else if (neck === 'headphones') {
      // Resting round the neck: the band behind, the cups on the collarbones.
      const cups = [-1, 1].map(side => aroundTorso(.268, side * .66, .058));
      // The band swings out over each shoulder before it goes behind the neck, so it shows from the front too.
      const band = (side: number): Vec3[] => [aroundTorso(.296, side * .95, .056), aroundTorso(.32, side * 1.4, .038), aroundTorso(.326, side * 2, .03), aroundTorso(.328, side * 2.6, .03)];
      p.line(body, INK, [cups[1], ...band(1), aroundTorso(.328, Math.PI, .03), ...band(-1).reverse(), cups[0]], .024, .2, { segments: 6, rows: 18, round: false, up: [0, 1, 0] });
      cups.forEach((centre, index) => {
        const side = index ? 1 : -1, n = new THREE.Vector3(Math.sin(side * .66), .3, Math.cos(side * .66)).normalize();
        const cup = sculptLoft([[-.034, 0, 0], [-.032, .046, .046], [-.016, .07, .07], [.012, .076, .076], [.034, .064, .064], [.044, .03, .03], [.046, 0, 0]], 16);
        cup.applyMatrix4(aim(Y_AXIS, [n.x, n.y, n.z], centre));
        p.put(body, cup, (x, y, zz) => (x - centre[0]) * n.x + (y - centre[1]) * n.y + (zz - centre[2]) * n.z > -.002 ? LILAC : CREAM, .25);
        bead(body, lighten(LILAC, .45), [centre[0] + n.x * .046, centre[1] + n.y * .046, centre[2] + n.z * .046], .026, .4);
      });
    } else if (neck === 'pearl-necklace') {
      const pearl = 0xfffaf2, front = spaced(necklace(.225, .027, -1.7, 1.7), 13);
      front.forEach((at, index) => p.put(body, new THREE.SphereGeometry(index === 6 ? .031 : .025, 8, 5), pearl, .85, at));
      p.line(body, 0xf1e4cc, necklace(.225, .02, 1.7, TAU - 1.7, 8), .009, .6, { segments: 4, rows: 10, round: false });
    } else if (neck === 'camera') {
      const slate = 0x7684b0, y = .15, zc = chest(0, y) + .036, tan = 0xc9a17a;
      p.box(body, slate, [0, y - .014, zc], [.2, .1, .084], .03);
      p.box(body, CREAM, [0, y + .042, zc], [.206, .05, .09], .022);
      p.put(body, new THREE.CylinderGeometry(.052, .056, .05, 14), CREAM, .2, [.012, y - .012, zc + .058], [1, 1, 1], [Math.PI / 2, 0, 0]);
      bead(body, 0x6f93d6, [.012, y - .012, zc + .08], [.038, .038, .016], .95, undefined, 10);
      bead(body, WHITE, [-.002, y + .002, zc + .093], [.011, .011, .005], 0, undefined, 6);
      p.box(body, slate, [-.058, y + .074, zc - .004], [.056, .03, .05], .012);
      bead(body, CORAL, [.066, y + .07, zc + .004], [.019, .012, .019], .4, undefined, 6);
      // One strap: up from the camera, round the back of the neck and down again.
      const hang = (side: number): Vec3[] => [[side * .088, y + .04, chest(side * .088, y + .04) - .01], [side * .096, .23, chest(side * .096, .23) + .004], [side * .1, .31, chest(side * .1, .31) + .004]];
      strap(body, tan, [...hang(1), ...[.62, 1.2, 1.9, 2.5, Math.PI, -2.5, -1.9, -1.2, -.62].map(phi => aroundTorso(.332, phi, .014)), ...hang(-1).reverse()], .016, 22);
    } else if (neck === 'flower-lei') {
      const path = necklace(.215, .022), colors = [0xffa9c2, 0xffe08f, 0xfffaf0, 0xffb9a3];
      p.put(body, sculptLoop(spaced(path, 14, true), .013, [0, 1, 0], 1, 3), LEAF);
      spaced(necklace(.215, .036), 10, true).forEach((at, index) => {
        const reach = Math.hypot(at[0], at[2]) || 1;
        flower(p, body, at, [at[0] / reach, .45, at[2] / reach], colors[index % 4], index % 2 ? .068 : .076, index % 4 === 2 ? 0xffb6c8 : GOLD);
      });
    } else if (neck === 'medal-star') {
      const ribbon = 0x8fb4f0, my = .132;
      for (const side of [-1, 1]) {
        const top: Vec2 = [side * .1, .328], low: Vec2 = [side * .014, my + .05], length = Math.hypot(top[0] - low[0], top[1] - low[1]), nx = (top[1] - low[1]) / length * .023, ny = -(top[0] - low[0]) / length * .023;
        p.decal(body, ribbon, chest, polygonOutline([[top[0] - nx, top[1] - ny], [top[0] + nx, top[1] + ny], [low[0] + nx, low[1] + ny], [low[0] - nx, low[1] - ny]], 4), { lift: .005, bevel: .1 });
      }
      p.line(body, ribbon, [.6, 1.2, 1.9, 2.5, Math.PI, -2.5, -1.9, -1.2, -.6].map(phi => aroundTorso(.33, phi, .014)), .02, 0, { segments: 4, rows: 10, round: false, flat: .35, up: [0, 1, 0] });
      p.decal(body, darken(GOLD, .9), chest, ellipseOutline(0, my, .071, .071, 0, 18), { rings: 2, lift: .012, bevel: .12 }, .6);
      p.decal(body, GOLD, (x, y) => chest(x, y) + .012, ellipseOutline(0, my, .058, .058, 0, 18), { rings: 2, lift: .008, dome: .008, bevel: .14 }, .75);
      p.decal(body, CREAM, (x, y) => chest(x, y) + .029, polygonOutline(star(0, my - .002, .037), 1), { lift: .003, bevel: .12 }, .3);
    }
    p.features.push(`accessory-neckwear:${neck}`);
  }

  /* ---------------------------------------------------------------- backwear */
  if (back !== 'none') {
    // Bees carry their gear above the abdomen; butterflies wear it over the wing roots.
    // A fox's brush and a rabbit's scut sit right below: there the gear is a size smaller and rides higher.
    const bee = a.species === 'bee', butterfly = a.species === 'butterfly', tailed = a.species === 'fox' || a.species === 'rabbit', wings = back === 'angel-wings' || back === 'bat-wings';
    const frame = new THREE.Matrix4(), local = new THREE.Matrix4(), turn = new THREE.Quaternion();
    if (bee) frame.makeTranslation(0, .345, -.2).multiply(local.makeScale(.8, .8, .8)).multiply(new THREE.Matrix4().makeTranslation(0, -.345, .19));
    else if (butterfly) frame.makeTranslation(0, 0, -.04);
    else if (tailed && !wings) frame.makeTranslation(0, .255, -.19).multiply(local.makeScale(.88, .88, .88)).multiply(new THREE.Matrix4().makeTranslation(0, -.2, .19));
    // Worn wings take the place of an insect's own pair (one clear silhouette instead of a four-wing clump).
    if (wings) for (const part of body.children) if (part.name === 'avatar-wing') part.visible = false;
    const at = (point: Vec3): Vec3 => { const v = new THREE.Vector3(...point).applyMatrix4(frame); return [v.x, v.y, v.z]; };
    /** Adds a piece modelled for the plain back, moved to where this species carries it. */
    const B = (geometry: THREE.BufferGeometry, tint: Tint, gloss = 0, position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]) => {
      geometry.applyMatrix4(local.compose(new THREE.Vector3(...position), turn.setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)).premultiply(frame));
      p.put(body, geometry, tint, gloss);
    };
    const front = (x: number, y: number, off = .024): Vec3 => [x, y, torsoFront(x, y) + off], rear = (x: number, y: number, off = .024): Vec3 => [x, y, torsoBack(x, y) - off];
    /** Shoulder straps: out of the pack, over the shoulder, down the chest and away into the armpit. They lie a garment's thickness off the torso all the way. */
    const straps = (tint: number, x = .15, top: Vec3 = [.12, .29, -.2]) => {
      for (const side of [-1, 1]) strap(body, tint, [at([side * top[0], top[1], top[2]]), rear(side * (x - .01), .322, .03), [side * x, .356, -.02], front(side * x, .322, .03), front(side * (x + .008), .26, .03), front(side * (x + .022), .2, .03),
        aroundTorso(.16, side * .96, .03), aroundTorso(.136, side * 1.26, .02), aroundTorso(.122, side * 1.52, 0)], .02, 14);
    };
    /** One strap slung from the left shoulder to the right hip and back up behind: the torso cut by a slanted plane, so it lies on the body all the way round. */
    const sling = (tint: number) => {
      const points: Vec3[] = [];
      for (let index = 0; index < 24; index++) {
        const phi = Math.PI / 2 - index / 24 * TAU; let y = .2;
        for (let step = 0; step < 12; step++) y += (.2 + .86 * aroundTorso(y, phi, .03)[0] - y) * .5;
        points.push(aroundTorso(Math.min(y, .37), phi, .03));
      }
      p.put(body, sculptLoop(points, .019, index => { const [x, y, z] = points[index]; return [x, y > .32 ? .32 : 0, z]; }, .45, 4), tint);
    };
    if (back === 'backpack-mint') {
      B(new RoundedBoxGeometry(.36, .3, .19, 2, .075), MINT, 0, [0, .17, -.275]);
      B(new RoundedBoxGeometry(.23, .115, .06, 1, .026), lighten(MINT, .4), 0, [0, .098, -.362]);
      B(new RoundedBoxGeometry(.31, .085, .06, 1, .028), darken(MINT, .86), 0, [0, .258, -.352]);
      B(new THREE.SphereGeometry(.02, 8, 5), GOLD, .5, [0, .222, -.386]);
      B(sculptSweep([[-.045, .31, -.27], [0, .348, -.27], [.045, .31, -.27]], .013, { segments: 5, rows: 6, round: false }), darken(MINT, .86));
      straps(darken(MINT, .86));
    } else if (back === 'satchel-brown') {
      // Slung from the right shoulder to the left hip, clear of every tail.
      const tan = 0xc99a6c;
      sling(tan);
      p.box(body, tan, [-.215, -.03, -.105], [.13, .185, .235], .045, [0, -.25, 0], 0, 2);
      p.box(body, lighten(tan, .3), [-.278, .008, -.088], [.03, .11, .2], .014, [0, -.25, 0]);
      bead(body, GOLD, [-.298, -.03, -.083], [.012, .018, .018], .5, undefined, 6);
    } else if (back === 'rocket-pack') {
      const silver = 0xdfe8f2, trim = 0xa9bcd6;
      for (const side of [-1, 1]) {
        B(sculptSweep([[side * .1, .1, -.275], [side * .1, .275, -.275]], .078, { segments: 10, rows: 2 }), silver, .5);
        B(sculptHorn(.078, .078, .115, 1.5, [0, 0], 10, 4), 0xff8a7a, .4, [side * .1, .29, -.275]);
        B(new THREE.CylinderGeometry(.056, .074, .056, 10), INK, 0, [side * .1, .07, -.275]);
        B(sculptHorn(.045, .045, .085, 1.4, [0, 0], 8, 3), 0xffc45e, 0, [side * .1, .046, -.275], [0, 0, 0], [1, -1, 1]);
      }
      B(new RoundedBoxGeometry(.1, .13, .1, 1, .03), trim, 0, [0, .19, -.3]);
      B(new THREE.SphereGeometry(1, 8, 5), 0x86e6d6, .6, [0, .205, -.352], [0, 0, 0], [.024, .024, .012]);
      straps(trim, .15, [.1, .27, -.22]);
    } else if (back === 'angel-wings' || back === 'bat-wings') {
      const angel = back === 'angel-wings', deep = bee || butterfly ? -.03 : 0;
      for (const side of [-1, 1]) {
        const mirror = (points: number[][]) => points.map(([x, y]) => [side * x, y] as Vec2);
        if (angel) {
          // A plump feathered wing: four rounded flight feathers under a soft shoulder.
          const pose: [Vec3, Vec3] = [[side * .05, .2, -.205 + deep], [0, side * .36, side * .1]];
          const outline = smoothOutline(mirror([[0, .07], [.17, .2], [.35, .265], [.5, .255], [.6, .2], [.63, .14], [.585, .085], [.5, .11], [.535, .03], [.49, -.01], [.4, .05], [.42, -.05], [.37, -.085], [.29, -.01], [.3, -.11], [.24, -.135], [.17, -.06], [.13, -.11], [.06, -.1], [0, -.03]]), 2);
          B(sculptPillow(outline, .034, [side * .3, .11]), (_x, y) => mixColor(0xd9e3fb, WHITE, smoothstep(.1, .3, y)), .15, ...pose);
          const covert = sculptPillow(smoothOutline(mirror([[.01, .06], [.15, .17], [.31, .225], [.44, .205], [.47, .15], [.36, .1], [.22, .05], [.08, .0]]), 2), .03); covert.translate(0, 0, -.026);
          B(covert, WHITE, .15, ...pose);
        } else {
          // Small membrane wings: an arm along the top, two fingers and soft scallops between them (a shade deeper on a butterfly, whose own lilac they replace).
          const membrane = butterfly ? 0xa78fe6 : 0xbda4ee, bone = butterfly ? 0x8268cc : 0x977fd6, pose: [Vec3, Vec3] = [[side * .05, .225, -.2 + deep], [0, side * .34, side * .16]];
          const outline = smoothOutline(mirror([[0, .08], [.15, .21], [.32, .275], [.47, .26], [.56, .19], [.46, .1], [.4, 0], [.31, .07], [.24, -.06], [.16, .02], [.1, -.075], [0, -.03]]), 3);
          B(sculptPillow(outline, .015, [side * .24, .13], 1, 'thin'), membrane, .1, ...pose);
          const finger = (points: number[][], radius: number) => B(sculptSweep(points.map(([x, y]) => [side * x, y, -.014] as Vec3), t => radius * (1 - .7 * t * t), { segments: 5, rows: 5, round: false }), bone, .1, ...pose);
          finger([[.02, .09], [.15, .2], [.31, .262], [.45, .25], [.54, .195]], .016);
          finger([[.32, .25], [.37, .12], [.395, .015]], .009); finger([[.29, .25], [.27, .08], [.242, -.045]], .009);
        }
      }
    } else if (back === 'turtle-shell') {
      const shellColor = 0x8fd08a, scute = 0xb9e6a4, rim = 0xf8e9b8, cy = .185, zc = -.185;
      const dome = new SuperShape(.255, .245, .225, .05, .175, 2.4, 2.2, 2.2);
      B(dome.geometry(18, 9), shellColor, .15, [0, cy, zc]);
      const edge = Array.from({ length: 20 }, (_, index) => { const angle = index / 20 * TAU; return [signedPow(Math.cos(angle), 2 / 2.4) * .255, cy + signedPow(Math.sin(angle), 2 / 2.4) * (Math.sin(angle) > 0 ? .245 : .225), zc - .012] as Vec3; });
      B(sculptLoop(edge, .03, [0, 0, -1], 1, 4), rim);
      const surface = (x: number, y: number) => zc + dome.backZ(x, y - cy);
      const plate = (x: number, y: number, r: number) => B(sculptPatch(surface, polygonOutline(ellipseOutline(x, y, r, r * 1.05, Math.PI / 6, 6), 2), { back: true, lift: .007, dome: .008, bevel: .22 }), scute, .15);
      plate(0, cy + .005, .074);
      for (let i = 0; i < 6; i++) { const angle = i / 6 * TAU + Math.PI / 6; plate(Math.cos(angle) * .148, cy + .005 + Math.sin(angle) * .15, .056); }
      straps(rim);
    } else if (back === 'guitar') {
      // Slung low across the back, the neck rising past the left shoulder (clear of long hair).
      const wood = 0xeebd80, dark = 0xa87c5c, pose: [Vec3, Vec3] = [[-.1, .1, -.245 + (butterfly ? -.075 : 0)], [-.1, 0, -1.1]];
      const part = (geometry: THREE.BufferGeometry, tint: Tint, x: number, y: number, z: number, gloss = 0) => { geometry.translate(x, y, z); B(geometry, tint, gloss, ...pose); };
      const half: number[][] = [[0, -.145], [.085, -.128], [.142, -.05], [.138, .04], [.1, .11], [.098, .16], [.112, .215], [.08, .275], [0, .295]];
      const outline = smoothOutline([...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x, y] as Vec2), 2);
      part(sculptPillow(outline, .042, [0, .05], 1, 'flat'), wood, 0, 0, 0, .15);
      part(new THREE.CircleGeometry(.058, 18).rotateY(Math.PI), CREAM, 0, .075, -.0428);
      part(new THREE.CircleGeometry(.041, 18).rotateY(Math.PI), dark, 0, .075, -.0436);
      part(new RoundedBoxGeometry(.085, .02, .014, 1, .006), dark, 0, -.065, -.046);
      part(new RoundedBoxGeometry(.046, .36, .03, 1, .012), dark, 0, .44, -.032);
      part(new RoundedBoxGeometry(.074, .1, .03, 1, .014), wood, 0, .655, -.032);
      for (const side of [-1, 1]) for (const y of [.63, .68]) part(new THREE.SphereGeometry(.014, 5, 3), CREAM, side * .044, y, -.032, .5);
      sling(0x7fcfb0);
    }
    p.features.push(`accessory-backwear:${back}`);
  }
}
