import * as THREE from 'three';
import { SuperShape, bump, ellipseOutline, sculptGrid, sculptHorn, sculptShell, sculptSweep, smoothOutline, smoothstep, type Vec2, type Vec3 } from './avatar-sculpt';
import { darken, mixColor, type AvatarPainter, type Tint } from './avatar-painter';

export type Species = 'human' | 'cat' | 'rabbit' | 'fox' | 'bear' | 'bee' | 'butterfly';
export type HeadLook = {
  species: Species; face: string; hair: string; skin: number; hairColor: number; accent: number;
  /** A hat hides buns, tails and animal forelocks. */ hatted?: boolean;
  /** The hat swallows the ears or antennae whole: they are not modelled (their joints stay). */ earsCovered?: boolean;
  /** The top has a hood on the upper back: wings start behind it. */ hooded?: boolean;
};

const WHITE = 0xffffff, CREAM = 0xfff6e6, INK = 0x2b2028;
/** 0 (white) … 1 (black) for a skin or coat colour, and how far it counts as a dark one. */
const depthOf = (color: number) => 1 - (((color >> 16) & 255) * .5 + ((color >> 8) & 255) * .4 + (color & 255) * .1) / 255;
const darkness = (color: number) => smoothstep(.3, .52, depthOf(color));
/** Pushes a colour away from its own grey (1 = unchanged). */
const vivid = (color: number, amount: number) => {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255, grey = .3 * r + .59 * g + .11 * b;
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(grey + (value - grey) * amount)));
  return channel(r) << 16 | channel(g) << 8 | channel(b);
};
/** Markings follow the coat: ginger stripes on a pale cat, deeper ones on a dark cat. */
const tabby = (coat: number) => mixColor(mixColor(coat, 0xd9893f, .55), darken(coat, .74), darkness(coat));
/** A bee's bands: soft brown on a light coat, cream on a dark one. */
const beeBand = (coat: number) => mixColor(mixColor(coat, 0x7a4f3a, .5), mixColor(coat, CREAM, .6), darkness(coat));
/** Expression tags ride on the `gloss` attribute (see avatar-vinyl-material.ts):
 * +2 marks the open eyes, +4 the closed happy arcs; the shader shows one set. */
export const EYES_OPEN = 2, EYES_HAPPY = 4;
/** [half width, crown, chin, front, back, roundness, crown power, jaw power] in head units. */
const HEADS: Record<Species, number[]> = {
  human: [.485, .43, .405, .40, .435, 2.15, 2.15, 2.55],
  cat: [.5, .415, .395, .40, .43, 2.2, 2.1, 2.6],
  rabbit: [.47, .44, .40, .40, .43, 2.15, 2.2, 2.5],
  fox: [.495, .41, .39, .40, .43, 2.2, 2.1, 2.3],
  bear: [.5, .425, .41, .40, .435, 2.2, 2.2, 2.7],
  bee: [.47, .43, .41, .40, .43, 2.1, 2.15, 2.4],
  butterfly: [.465, .43, .41, .40, .43, 2.1, 2.15, 2.4],
};
export function headShape(species: Species, face: string): SuperShape {
  const base = HEADS[species] ?? HEADS.human;
  // Round is the reference; the egg is narrower with a longer, tapering chin; soft cheeks are wide, low and full.
  const [width, crown, chin, jaw] = face === 'oval' ? [.925, 1.03, 1.065, -.5] : face === 'soft' ? [1.06, .97, .955, .62] : [1, 1, 1, 0];
  return new SuperShape(base[0] * width, base[1] * crown, base[2] * chin, base[3], base[4], base[5], base[6], base[7] + jaw);
}

/** Latitudes of the skull mesh (degrees from the crown): the rings crowd together
 * below the cheeks, where the jaw turns fastest, so the outline stays round up close. */
const SKULL_ROWS = [0, 11, 22, 33, 44, 55, 66, 77, 88, 98, 107, 115, 122, 129, 136, 143, 150, 157, 164, 172, 180];
function skullMesh(shape: SuperShape, columns = 32): THREE.BufferGeometry {
  const rows = SKULL_ROWS.length - 1;
  return sculptGrid(columns, rows, (u, v, out) => {
    const phi = u * Math.PI * 2, theta = SKULL_ROWS[Math.round(v * rows)] * Math.PI / 180, x = Math.sin(theta) * Math.sin(phi), y = Math.cos(theta), z = Math.sin(theta) * Math.cos(phi);
    out.set(x, y, z).multiplyScalar(shape.radius(x, y, z));
  });
}

/** Paint that hugs the skull all the way round a cheek: the outline is drawn in
 * the face plane (or on the back), then lifted along the skull's own radius, so
 * it neither sinks in nor floats where the surface turns away from the viewer. */
function skinPatch(shape: SuperShape, boundary: Vec2[], lift = .004, back = false, minRings = 2): THREE.BufferGeometry {
  const cx = boundary.reduce((sum, point) => sum + point[0], 0) / boundary.length, cy = boundary.reduce((sum, point) => sum + point[1], 0) / boundary.length;
  const reach = boundary.reduce((max, point) => Math.max(max, Math.hypot(point[0] - cx, point[1] - cy)), 0), rings = Math.max(minRings, Math.ceil(reach / .045));
  // The rim meets the skull exactly (never below it: the skull's own facets lie
  // just under the true surface, so a sunken rim would look torn).
  const rim = 1 - Math.min(.3, .012 / reach);
  return sculptGrid(boundary.length, rings + 1, (u, v, out) => {
    const point = boundary[Math.round(u * boundary.length) % boundary.length], ring = Math.round(v * (rings + 1));
    const rho = ring > rings ? 1 : ring / rings * rim, x = cx + (point[0] - cx) * rho, y = cy + (point[1] - cy) * rho;
    const z = back ? Math.min(shape.backZ(x, y), -1e-4) : Math.max(shape.frontZ(x, y), 1e-4);
    out.fromArray(shape.along(x, y, z, ring > rings ? .0008 : lift));
  }, [0, 0, back ? -1 : 1]);
}

/** Horizontal radius of the skull at height `y` towards azimuth `phi` (0 = front, + = the figure's left). */
function girthAt(shape: SuperShape, y: number, phi: number): number {
  const power = y >= 0 ? shape.crown : shape.jaw, vertical = Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(y) / (y >= 0 ? shape.top : shape.bottom)), power));
  const sin = Math.abs(Math.sin(phi)), cos = Math.cos(phi);
  return Math.pow(Math.pow(vertical, shape.round / power) / (Math.pow(sin / shape.w, shape.round) + Math.pow(Math.abs(cos) / (cos >= 0 ? shape.front : shape.back), shape.round)), 1 / shape.round);
}
/** An oval of paint that wraps round the skull (a cheek seen from the front and
 * from the side alike): centred at azimuth `phi` and height `y`, `across` and
 * `tall` are its half sizes in head units and `roll` tilts it. */
function wrapPatch(shape: SuperShape, phi: number, y: number, across: number, tall: number, roll = 0, lift = .004, segments = 20): THREE.BufferGeometry {
  const rings = Math.max(2, Math.ceil(Math.max(across, tall) / .058)), c = Math.cos(roll), s = Math.sin(roll), scale = girthAt(shape, y, phi);
  return sculptGrid(segments, rings + 1, (u, v, out) => {
    const ring = Math.round(v * (rings + 1)), rho = ring > rings ? 1 : ring / rings * .95, angle = u * Math.PI * 2;
    const du = Math.cos(angle) * across * rho, dv = Math.sin(angle) * tall * rho, at = phi + (du * c - dv * s) / scale, height = y + du * s + dv * c, girth = girthAt(shape, height, at);
    out.fromArray(shape.along(Math.sin(at) * girth, height, Math.cos(at) * girth, ring > rings ? .0008 : lift));
  }, [Math.sin(phi), 0, Math.cos(phi)]);
}

/** The whole head: skull, painted face, species features and hair. Eyes and
 * ears get their own joints so the pose layer can blink and wiggle them. */
export function buildHead(p: AvatarPainter, head: THREE.Group, look: HeadLook) {
  const { species, skin } = look, animal = species !== 'human', insect = species === 'bee' || species === 'butterfly';
  const shape = headShape(species, look.face), z = shape.frontZ, k = shape.w / .485;
  p.put(head, skullMesh(shape), skin);

  // Big glossy bean eyes, low and wide apart. One joint: scale.y blinks.
  const eyes = new THREE.Group(); eyes.name = 'avatar-eyes'; head.add(eyes);
  const eyeX = .192 * k, eyeY = -.062, rx = insect ? .071 : .063, ry = insect ? .097 : .086;
  eyes.position.y = eyeY;
  const iris = insect ? 0x6a4a8c : 0x7a4b3a;
  // Lines and blush have to read on every tone: on dark skin the mouth and the happy
  // arcs are near-black and a quarter bolder, and the rouge is deeper and redder.
  const depth = depthOf(skin), dark = darkness(skin), bold = 1 + .25 * dark;
  const rouge = smoothstep(.12, .4, depth), blush = mixColor(skin, mixColor(0xff7d92, 0xe8505c, rouge), (animal ? .34 : .4) + .14 * rouge - .07 * smoothstep(.45, .6, depth));
  for (const side of [-1, 1]) {
    const cx = side * eyeX, at: Vec3 = [0, -eyeY, 0];
    p.decal(eyes, (_x, y) => mixColor(iris, INK, smoothstep(-ry * .95, -ry * .15, y)), z, ellipseOutline(cx, eyeY, rx, ry, -side * .05, 20, 2.3), { rings: 3, lift: .003, dome: .017, bevel: .1 }, EYES_OPEN + .9, at);
    p.decal(eyes, WHITE, z, ellipseOutline(cx - .02, eyeY + .035, .022, .026, 0, 10), { rings: 1, lift: .0185, dome: .003, bevel: .3 }, EYES_OPEN, at);
    p.decal(eyes, WHITE, z, ellipseOutline(cx + .022, eyeY - .042, .0105, .012, 0, 8), { rings: 1, lift: .0165, bevel: .3 }, EYES_OPEN, at);
    // Closed happy eyes ("^ ^"): a chunky arch in the same place, shown instead of the open eye.
    const arch = [-1, -.62, 0, .62, 1].map(t => { const x = cx + t * rx * 1.12, y = eyeY - .012 + ry * .62 * (1 - t * t) - Math.abs(t) * .004; return [x, y, z(x, y) + .006] as Vec3; });
    p.put(eyes, sculptSweep(arch, .0135 * bold, { segments: 5, rows: 6, flat: .6 }), mixColor(mixColor(iris, INK, .7), 0x1c1016, dark), EYES_HAPPY + .35, at);
    // Round blush low on the cheek, airbrushed so it fades into the skin. The fox wears it on its cream mask.
    const fox = species === 'fox', bx = side * (fox ? .262 : .305) * k, by = fox ? -.2 : -.19, brx = fox ? .062 : .074, bry = fox ? .04 : .047, under = fox ? CREAM : skin;
    const rouged = fox ? mixColor(CREAM, 0xff7d92, .42) : blush;
    p.put(head, skinPatch(shape, ellipseOutline(bx, by, brx, bry, 0, 14), fox ? .0105 : .0028, false, 3), (x, y) => mixColor(rouged, under, smoothstep(.45, 1.02, Math.hypot((x - bx) / brx, (y - by) / bry))));
  }
  const mouth = mixColor(mixColor(skin, 0x6e2a36, .72), 0x2e1014, .9 * dark);
  /** A smile painted flush on the face, so it never shows as a tick on the profile. */
  const smile = (y: number, half = .04, curve = .02) => p.line(head, mouth, [-1, -.5, 0, .5, 1].map(t => { const x = t * half, at = y + curve * t * t; return [x, at, z(x, at) + .0012] as Vec3; }), .0085 * bold, .2, { segments: 6, rows: 8, flat: .36 });

  const ears: THREE.Group[] = [], bare = !look.earsCovered;
  const earJoint = (side: number, x: number, y: number, zDir: number) => {
    const ear = new THREE.Group(); ear.name = 'avatar-ear'; ear.position.set(...shape.along(side * x, y, zDir)); head.add(ear); ears.push(ear); return ear;
  };
  /** The fox's cheek ruff: broad flat points fanning down and back along the jaw,
   * given as [height, angle from straight up, length]. They are rooted deep inside
   * the skull and overlap, so they read as one soft ruff of fur, not as a second ear. */
  const cheekFluff = (side: number, tufts: number[][]) => {
    for (const [y, angle, length] of tufts) {
      const x = shape.w * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(y) / shape.bottom, shape.jaw)), 1 / shape.jaw);
      p.put(head, sculptHorn(.084, .04, length, 1.2, [0, 0], 10, 4), CREAM, 0, [side * (x - .07), y, -.012], [1, 1, 1], [0, side * .42, -side * angle]);
    }
  };
  if (species === 'human') {
    smile(-.232);
    // Small round ears, only where the hairstyle leaves them uncovered.
    if (['pony', 'bun', 'crop'].includes(look.hair)) for (const side of [-1, 1]) p.blob(head, skin, [side * (shape.w - .014), -.09, -.04], [.046, .066, .044], [0, 0, 0], 0, 12);
  } else if (species === 'cat') {
    const stripe = tabby(skin);
    p.decal(head, mixColor(CREAM, WHITE, smoothstep(.1, .04, depth)), z, ellipseOutline(0, -.208, .118, .072, 0, 20, 2.2), { rings: 3, lift: .003, dome: .012, bevel: .2 });
    p.decal(head, 0xff8fa3, z, smoothOutline([[-.026, -.158], [.026, -.158], [0, -.186]], 4), { rings: 1, lift: .014, dome: .006, bevel: .3 }, .6);
    for (const side of [-1, 1]) p.trace(head, mouth, z, [[0, -.186], [side * .012, -.206], [side * .03, -.212], [side * .046, -.2]], .0065, .2, .012);
    for (const [x, y, h] of [[0, .3, .075], [-.085, .28, .055], [.085, .28, .055]]) p.decal(head, stripe, z, ellipseOutline(x, y, .02, h, -x * 2.2, 12), { rings: 1, lift: .003, bevel: .3 });
    // The tabby stripes carry on down the back of the head.
    for (const [x, y, w, h] of [[0, .2, .034, .1], [-.13, .15, .03, .08], [.13, .15, .03, .08], [-.25, .06, .026, .06], [.25, .06, .026, .06]]) p.put(head, skinPatch(shape, ellipseOutline(x, y, w, h, x * 1.5, 10), .004, true), stripe);
    for (const side of [-1, 1]) {
      for (const y of [-.075, -.135]) p.decal(head, stripe, z, ellipseOutline(side * .42 * k, y, .05, .014, side * (.5 + y * 2), 12), { rings: 1, lift: .003, bevel: .3 });
      const ear = earJoint(side, .56, .8, -.06), tilt: Vec3 = [-.08, 0, -side * .4];
      if (!bare) continue;
      p.put(ear, sculptHorn(.135, .085, .27, 1.45, [side * .02, 0]), (x, y, ez) => mixColor(skin, stripe, .8 * smoothstep(.135, .2, Math.hypot(x, y)) * smoothstep(.03, -.03, ez)), 0, [0, -.075, 0], [1, 1, 1], tilt);
      p.put(ear, sculptHorn(.085, .03, .175, 1.45, [side * .015, 0], 10, 5), 0xffb6c0, 0, [side * .012, -.025, .04], [1, 1, 1], tilt);
    }
    p.features.push('animal-muzzle', 'point-ear');
  } else if (species === 'rabbit') {
    p.decal(head, WHITE, z, ellipseOutline(0, -.2, .1, .066, 0, 18, 2.2), { rings: 3, lift: .003, dome: .014, bevel: .25 });
    p.decal(head, 0xff8fa3, z, smoothOutline([[-.024, -.158], [.024, -.158], [0, -.182]], 4), { rings: 1, lift: .016, dome: .005, bevel: .3 }, .6);
    p.trace(head, mouth, z, [[0, -.182], [0, -.2]], .006, .2, .014);
    for (const side of [-1, 1]) {
      p.trace(head, mouth, z, [[0, -.2], [side * .018, -.214], [side * .036, -.206]], .006, .2, .013);
      const ear = earJoint(side, .33, .93, -.1), tilt: Vec3 = [-.06, 0, -side * .13];
      if (!bare) continue;
      p.put(ear, sculptHorn(.088, .05, .4, 3.4, [0, 0], 14, 9), skin, 0, [0, -.05, 0], [1, 1, 1], tilt);
      // The pink lining lies in the ear, a little inside its rim on every side.
      p.put(ear, sculptHorn(.05, .0215, .3, 3.4, [0, 0], 12, 8), 0xffc2cc, 0, [0, -.005, .0312], [1, 1, 1], tilt);
    }
    p.features.push('animal-muzzle', 'long-ear');
  } else if (species === 'fox') {
    const tip = mixColor(0x6b4338, darken(skin, .55), dark);
    // The cream mask: a chin patch and two soft oval cheeks that pass under the eyes and
    // rise towards the ruff, so both eyes sit on the coat and the coat runs down to the nose.
    p.put(head, wrapPatch(shape, 0, -.275, .21 * k, .09, 0, .0048, 16), CREAM);
    for (const side of [-1, 1]) p.put(head, wrapPatch(shape, side * .84, -.226, .335, .104, side * .26), CREAM);
    p.blob(head, CREAM, [0, -.195, z(0, -.195) - .025], [.105, .078, .085]);
    p.blob(head, INK, [0, -.168, z(0, -.168) + .052], [.036, .027, .024], [0, 0, 0], .75, 10);
    p.trace(head, mouth, z, [-1, -.5, 0, .5, 1].map(t => [t * .028, -.236 + .012 * t * t] as Vec2), .0065, .2, .05);
    for (const side of [-1, 1]) {
      // The ruff carries the mask round the cheek.
      cheekFluff(side, [[-.152, 1.78, .132], [-.222, 2.2, .125]]);
      const ear = earJoint(side, .55, .8, -.06), tilt: Vec3 = [-.08, 0, -side * .36];
      if (!bare) continue;
      // Dark ear tips; on the back the dark socks reach further down.
      p.put(ear, sculptHorn(.14, .09, .31, 1.6, [side * .02, 0]), (x, y, ez) => mixColor(skin, tip, smoothstep(.13 - .07 * smoothstep(.02, -.04, ez), .2 - .05 * smoothstep(.02, -.04, ez), Math.hypot(x, y))), 0, [0, -.075, 0], [1, 1, 1], tilt);
      p.put(ear, sculptHorn(.085, .03, .19, 1.6, [side * .015, 0], 10, 5), CREAM, 0, [side * .012, -.03, .042], [1, 1, 1], tilt);
    }
    p.features.push('animal-muzzle', 'point-ear');
  } else if (species === 'bear') {
    const pale = mixColor(skin, CREAM, .62);
    p.blob(head, pale, [0, -.185, z(0, -.185) - .03], [.15, .112, .085], [0, 0, 0], 0, 18);
    p.blob(head, 0x4a322c, [0, -.14, z(0, -.14) + .05], [.047, .033, .026], [0, 0, 0], .75, 12);
    p.blob(head, 0x4a322c, [0, -.205, z(0, -.205) + .052], [.007, .03, .007], [0, 0, 0], 0, 6);
    for (const side of [-1, 1]) {
      p.line(head, 0x4a322c, [[0, -.232, z(0, -.232) + .046], [side * .022, -.244, z(0, -.244) + .04], [side * .04, -.232, z(.04, -.232) + .03]], .0065, .2, { segments: 6 });
      const ear = earJoint(side, .68, .72, -.04);
      if (!bare) continue;
      p.blob(ear, skin, [0, .03, 0], [.128, .122, .062]);
      p.blob(ear, pale, [0, .03, .032], [.076, .072, .036], [0, 0, 0], 0, 12);
    }
    // A fur whorl painted flush on the back of the head.
    p.line(head, mixColor(skin, CREAM, .42), Array.from({ length: 11 }, (_, i) => { const a = i * .92, r = .014 + i * .0062, x = Math.cos(a) * r, y = .1 + Math.sin(a) * r; return [x, y, shape.backZ(x, y) - .001] as Vec3; }), .0085, 0, { segments: 5, rows: 20, flat: .3 });
    p.features.push('animal-muzzle', 'round-ear');
  } else {
    smile(-.225);
    const stalk = species === 'bee' ? 0x5c4038 : 0x8f6fd2;
    for (const side of [-1, 1]) {
      const ear = earJoint(side, .3, .93, .1);
      if (!bare) continue;
      p.line(ear, stalk, [[0, -.04, 0], [side * .015, .09, .01], [side * .06, .17, .03], [side * .125, .215, .05]], .014, 0, { segments: 6, rows: 8, round: false });
      p.blob(ear, species === 'bee' ? stalk : 0xffc7e3, [side * .135, .225, .054], [.042, .042, .042], [0, 0, 0], .3, 10);
    }
    if (species === 'bee') {
      // Two soft bands are painted on the back of the head, like the stripes on the abdomen:
      // flush with the skull, tapering to round ends well inside the outline.
      for (const [height, half] of [[.205, .029], [.075, .033]]) {
        const reach = .78 * shape.w * Math.pow(1 - Math.pow(height / shape.top, shape.crown), 1 / shape.crown);
        p.put(head, sculptGrid(18, 2, (u, v, out) => {
          const s = u * 2 - 1, x = s * reach, fade = Math.pow(Math.max(0, 1 - s * s), .5), y = height - .03 * s * s + (v * 2 - 1) * half * fade;
          out.fromArray(shape.along(x, y, Math.min(shape.backZ(x, y), -1e-4), .0008 + (v === .5 ? .0037 * fade : 0)));
        }, [0, 0, -1]), beeBand(skin));
      }
    } else {
      // A little heart, in the colours of the wings (near-white on a coat that is itself pink).
      const pink = 0xffbcdc, alike = Math.abs((skin >> 16 & 255) - (pink >> 16 & 255)) + Math.abs((skin >> 8 & 255) - (pink >> 8 & 255)) + Math.abs((skin & 255) - (pink & 255)) < 70;
      const heart = smoothOutline([[0, -.07], [.075, .0], [.085, .055], [.045, .08], [0, .05], [-.045, .08], [-.085, .055], [-.075, .0]].map(([x, y]) => [x * 1.35, y * 1.35 + .1] as Vec2), 3);
      p.put(head, skinPatch(shape, heart, .004, true), alike ? 0xfff4fa : pink);
    }
    p.features.push('antennae', 'compound-eye-face');
  }
  buildHair(p, head, shape, look, animal, insect);
  return { shape, eyes, ears, eyeX, eyeY };
}

function buildHair(p: AvatarPainter, head: THREE.Group, shape: SuperShape, look: HeadLook, animal: boolean, insect: boolean) {
  const style = look.hair, base = look.hairColor, light = mixColor(base, 0xfff2e0, .22), shade = darken(base, .9);
  const tint: Tint = (_x, y) => mixColor(shade, light, smoothstep(-.3, .42, y));
  const H = (y: number) => y >= 0 ? y * shape.top / .43 : y * shape.bottom / .405;
  /** Hairline height for the front, the side (in front of the ear) and the back. */
  const blend = (f: number, front: number, side: number, back: number, a = .85, b = 1.18, c = 1.85, d = 2.55) => {
    const s = smoothstep(a, b, f), r = smoothstep(c, d, f); return (front * (1 - s) + side * s) * (1 - r) + back * r;
  };
  let coat = (_phi: number, _theta: number) => .03;
  const cap = (edge: (phi: number, f: number) => number, thickness: (phi: number, theta: number, f: number) => number, columns = 48, rows = 13) => {
    coat = (phi, theta) => thickness(phi, theta, Math.abs(phi));
    p.put(head, sculptShell(shape, { columns, rows, edge: phi => H(edge(phi, Math.abs(phi))), thickness: coat }), tint, .25);
  };
  /** The hair whorl: a small pale spiral where the hair turns, high on the back of the head. */
  const whorl = (phi: number, theta: number) => {
    const points: Vec3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = i * .95, r = .015 + i * .0078, p2 = phi + Math.cos(a) * r / (.45 * Math.sin(theta)), t2 = theta - Math.sin(a) * r / .45;
      points.push(shape.along(Math.sin(t2) * Math.sin(p2), Math.cos(t2), Math.sin(t2) * Math.cos(p2), coat(p2, t2) + .0006));
    }
    // Nearly flush: it is paint on the hair, not a tube that breaks the profile.
    p.line(head, mixColor(base, 0xfff2e0, .42), points, .0085, .25, { segments: 5, rows: 18, flat: .3, up: points[0] });
  };
  /** A chunky moulded lock lying on the skull, given as [azimuth, polar, lift?]
   * steps. It grows out of the cap, swells and ends in a soft point. */
  const lock = (steps: number[][], width: number, flat = .5, lift = .028) => {
    const points = steps.map(([phi, theta, own]) => shape.along(Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi), own ?? lift));
    p.line(head, tint, points, t => width * Math.pow(Math.sin(Math.PI * (.14 + .86 * t)), .7), .25, { segments: 10, rows: 10, flat, up: points[Math.floor(points.length / 2)], round: false });
  };
  if (!animal) {
    if (style === 'bob') {
      // Full straight fringe and a rounded bell that ends at the chin.
      cap((phi, f) => blend(f, .082 + .016 * Math.cos(phi * 2.4), -.335, -.345, .86, 1.14),
        (_phi, theta) => .036 + .027 * bump(theta, 1.72, .86), 56, 15);
      if (!look.hatted) whorl(Math.PI - .3, .8);
    } else if (style === 'curtain') {
      // Centre parting: two curtains sweep down to the cheeks.
      cap((_phi, f) => blend(f, .31 * Math.pow(1 - smoothstep(0, .78, f), 1.25) - .01, -.25, -.275 - .04 * bump(f, Math.PI, 1), .7, 1.12),
        (_phi, theta, f) => .038 + .012 * smoothstep(1.2, .4, theta) - .018 * bump(f, 0, .16) * smoothstep(.2, .6, theta));
      if (!look.hatted) whorl(Math.PI, .72);
    } else if (style === 'pony') {
      // Side-swept fringe, tidy sides, and a tail that swings out behind one shoulder.
      cap((phi, f) => blend(f, .115 + .1 * smoothstep(-.55, .75, phi) - .04 * bump(phi, -.38, .4), -.0 - .13 * bump(f, 1.2, .2), -.27, .85, 1.18, 1.75, 2.3), () => .032);
      if (!look.hatted) {
        const root = shape.along(.45, .45, -.75, -.02), out: Vec3 = [.46, .46, -.76];
        p.line(head, tint, [root, [root[0] + .09, root[1] + .06, root[2] - .1], [.41, .16, -.44], [.452, -.04, -.39], [.435, -.21, -.33], [.38, -.31, -.3]],
          t => .042 + .07 * Math.sin(Math.PI * Math.pow(t, .72)), .25, { segments: 10, rows: 12 });
        p.put(head, new THREE.TorusGeometry(.078, .03, 8, 16), look.accent, .15, [root[0] + out[0] * .075, root[1] + out[1] * .075, root[2] + out[2] * .075], [1, 1, 1], [Math.atan2(out[1], -out[2]) - Math.PI, -Math.asin(out[0] / Math.hypot(...out)), 0]);
      }
    } else if (style === 'bun') {
      // Soft parted fringe and a round bun tied on top.
      cap((phi, f) => blend(f, .1 + .075 * bump(phi, 0, .2) - .025 * bump(f, .5, .3), -.0 - .13 * bump(f, 1.2, .2), -.27 - .04 * bump(f, Math.PI - .42, .3), .85, 1.18, 1.75, 2.3), () => .032);
      if (!look.hatted) {
        p.blob(head, tint, shape.along(0, .95, -.3, .1), [.17, .15, .16], [.3, 0, 0], .25, 16);
        p.put(head, new THREE.TorusGeometry(.105, .026, 8, 18), look.accent, .15, shape.along(0, .95, -.3, .012), [1, 1, 1], [Math.PI / 2 + .31, 0, 0]);
      }
    } else if (style === 'crop') {
      // Short and neat: a choppy fringe of three soft points, a nape point and one cowlick.
      cap((phi, f) => blend(f, .22 - .075 * bump(phi, -.52, .3) - .1 * bump(phi, .02, .3) - .07 * bump(phi, .54, .3), .04 - .1 * bump(f, 1.2, .2), -.24 - .045 * bump(f, Math.PI, .55), .85, 1.18, 1.75, 2.3),
        (_phi, theta) => .026 + .016 * smoothstep(.9, .2, theta));
      if (!look.hatted) {
        const sprig = shape.along(.1, 1, .16, .0);
        p.line(head, tint, [sprig, [sprig[0] - .01, sprig[1] + .065, sprig[2] + .01], [sprig[0] + .035, sprig[1] + .115, sprig[2] + .02], [sprig[0] + .095, sprig[1] + .105, sprig[2] + .025]], t => .04 - .016 * t, .25, { segments: 8, rows: 8 });
        whorl(Math.PI + .35, .8);
      }
    } else {
      // Fluffy and side-parted: big soft locks sweep over the forehead.
      cap((phi, f) => blend(f, .2, -.15 - .05 * bump(f, 1.3, .26), -.33 + .02 * Math.cos(phi * 5), .85, 1.18, 1.5, 2.15),
        (phi, theta, f) => .034 + .026 * smoothstep(1.3, .35, theta) - .011 * Math.cos(phi * 5) * smoothstep(.55, 1.3, theta) * smoothstep(1.25, 2.1, f));
      if (!look.hatted) whorl(Math.PI + .3, .8);
      if (look.hatted) {
        // Under a hat only the tips of the fringe show below the brim.
        lock([[.3, 1.05, 0], [.08, 1.15], [-.2, 1.29], [-.42, 1.38]], .062, .4, .01);
        lock([[.72, 1.05, 0], [.86, 1.19], [.96, 1.38]], .058, .4, .01);
        lock([[-.58, 1.05, 0], [-.78, 1.2], [-.92, 1.4]], .06, .4, .01);
      } else {
        lock([[.62, .32, .0], [.3, .78], [-.08, 1.16], [-.42, 1.36]], .12);
        lock([[.66, .4, .0], [.86, .92], [.96, 1.36]], .085);
        lock([[-.3, .42, .0], [-.72, .95], [-.92, 1.4]], .09);
      }
    }
    p.features.push(`hair-${style}`);
    return;
  }
  // Animals keep ears, muzzle and antennae clear. Their "hair" is a tuft of fur
  // standing on the crown: it grows out of the coat (fur-coloured at the root,
  // the chosen hair colour softened towards the fur at the tips, like a dipped
  // paintbrush), so it reads as fluff rather than a hairpiece. Each of the six
  // styles has its own silhouette between the ears.
  if (!look.hatted) {
    // Espresso on a pale coat becomes soft caramel, never a dark blob or grey mud.
    const fur = look.skin, tipTone = mixColor(vivid(mixColor(base, fur, .58), 1.5), 0xfff4e6, .18);
    const s = insect ? 1 : 1.1, seat = shape.along(0, 1, .26, -.012);
    const dipped = (reach: number): Tint => (x, y, z) => mixColor(fur, tipTone, smoothstep(.04, reach, Math.hypot(x - seat[0], y - seat[1], z - seat[2])));
    const fluff = dipped(.15);
    const from = (x: number, y: number, z = 0): Vec3 => [seat[0] + x * s, seat[1] + y * s, seat[2] + z * s];
    /** A plump round-ended curl through points given relative to the seat; `girth` maps 0…1 along it to a radius. */
    const curl = (points: number[][], girth: (t: number) => number, rows = 8) =>
      p.line(head, fluff, points.map(([x, y, z]) => from(x, y, z ?? 0)), t => s * girth(t), .2, { segments: 10, rows });
    const band = (y: number, radius: number) => p.put(head, new THREE.TorusGeometry(radius * s, .019 * s, 6, 12), look.accent, .15, from(0, y, 0), [1, 1, 1], [Math.PI / 2, 0, 0]);
    if (style === 'bob') {
      // A cloud: three round puffs.
      for (const [x, y, r] of [[0, .06, .094], [-.112, .022, .072], [.112, .022, .072]]) p.blob(head, fluff, from(x, y, x ? -.004 : .004), [r * s, r * s * .95, r * s * .92], [0, 0, 0], .2, 12);
    } else if (style === 'curtain') {
      // A seedling: two round leaves part in the middle.
      for (const side of [-1, 1]) curl([[side * .012, -.035], [side * .04, .05], [side * .1, .12], [side * .15, .13]], t => .034 + .03 * Math.sin(Math.PI * Math.min(1, .1 + .75 * t)), 7);
    } else if (style === 'pony') {
      // A sprout tied with a band: it stands straight up, swells and ends in a soft point with a little flick.
      curl([[0, -.02], [0, .05], [.004, .115], [.03, .17]], t => (.036 + .024 * smoothstep(.08, .45, t)) * (1 - .8 * smoothstep(.5, 1, t)), 10);
      band(.04, .05);
    } else if (style === 'bun') {
      // A round pom sitting in its band.
      p.blob(head, fluff, from(0, .1, 0), [.108 * s, .1 * s, .104 * s], [0, 0, 0], .2, 14);
      band(.03, .07);
    } else if (style === 'crop') {
      // A short crown of three fluffy spikes.
      for (const [lean, height, roll] of [[0, .165, 0], [-1, .12, .62], [1, .12, -.62]])
        p.put(head, sculptHorn(.058 * s, .05 * s, height * s, 1.2, [lean * .02, lean ? 0 : .03], 10, 5), dipped(.105), .2, from(lean * .04, -.012, 0), [1, 1, 1], [.2, 0, roll]);
    } else {
      // A chick's cowlick: three short wisps fan out of one spot, their soft tips all blown the same way.
      const wisp = dipped(.1);
      for (const [points, girth] of [
        [[[0, -.03, 0], [.002, .04, .008], [.026, .084, .024], [.068, .102, .042]], .042],
        [[[-.026, -.03, .004], [-.042, .026, .012], [-.036, .062, .03], [-.006, .08, .052]], .036],
        [[[.034, -.03, -.006], [.058, .016, -.004], [.094, .04, .006], [.134, .042, .02]], .033]] as [number[][], number][])
        p.line(head, wisp, points.map(([x, y, z]) => from(x, y, z)), t => s * girth * Math.pow(Math.sin(Math.PI * (.3 + .7 * t)), .8), .2, { segments: 7, rows: 6 });
    }
  }
  p.features.push(`tuft-${style}`);
}

/** Tails, wings and other species parts on the torso. The tail and each wing
 * are joints of their own (secondary motion). Tails curl out to one side so
 * they read from the front and stay clear of a backpack. */
export function buildSpeciesBody(p: AvatarPainter, upperBody: THREE.Group, look: HeadLook) {
  const { species, skin } = look;
  let tail: THREE.Group | null = null; const wings: THREE.Group[] = [];
  if (species === 'human') return { tail, wings };
  if (species === 'bee' || species === 'butterfly') {
    // A hood hangs where the wings would start: they move out behind it.
    const set = look.hooded ? -.062 : 0;
    for (const side of [-1, 1]) { const wing = new THREE.Group(); wing.name = 'avatar-wing'; wing.position.set(side * .05, .2, -.185 + set); upperBody.add(wing); wings.push(wing); }
    /** A wing lobe: a thin lens with a smooth round outline. Its pattern is paint,
     * `tones` being the colour of the middle, of the wing and of its rim. */
    const LENS = [[0, 1], [.48, .92], [.6, .86], [.92, .4], [1, 0], [.92, -.4], [.6, -.86], [.48, -.92], [0, -1]];
    const point = new THREE.Vector3(), frame = new THREE.Matrix4();
    const lobe = (wing: THREE.Group, at: Vec3, rx: number, ry: number, thickness: number, rotation: Vec3, tones: number[], gloss: number, lens = LENS) => {
      const local = frame.compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)).invert().clone();
      const geometry = sculptGrid(24, lens.length - 1, (u, v, out) => {
        const [rho, height] = lens[Math.round(v * (lens.length - 1))], angle = u * Math.PI * 2;
        out.set(Math.cos(angle) * rx * rho, Math.sin(angle) * ry * rho, height * thickness);
      });
      p.put(wing, geometry, (x, y, z) => {
        point.set(x, y, z).applyMatrix4(local);
        const rho = Math.hypot(point.x / rx, point.y / ry);
        return mixColor(mixColor(tones[0], tones[1], smoothstep(.5, .58, rho)), tones[2], smoothstep(.9, .99, rho));
      }, gloss, at, [1, 1, 1], rotation);
    };
    if (species === 'bee') {
      // A plump striped abdomen: one moulded ring per band, so the stripes are crisp. It closes round the stinger.
      const stripe = beeBand(skin), girth = (t: number) => .152 * Math.pow(Math.sin(Math.PI * (.1 + .9 * t)), .62), from = -.13, length = .36;
      const cuts = [0, .34, .49, .66, .8, 1];
      for (let index = 0; index < 5; index++) {
        const start = cuts[index], end = cuts[index + 1];
        p.line(upperBody, index % 2 ? stripe : skin, [[0, -.02 - .03 * start, from - length * start], [0, -.02 - .03 * end, from - length * end]], t => girth(start + (end - start) * t) * (index % 2 ? 1.012 : 1), 0, { segments: 20, rows: index === 4 ? 5 : index % 2 ? 2 : 3, round: false, up: [0, 1, 0] });
      }
      p.put(upperBody, sculptHorn(.03, .03, .065, 1.3, [0, 0], 10, 4), stripe, 0, [0, -.05, from - length + .014], [1, 1, 1], [-Math.PI / 2 - .08, 0, 0]);
      wings.forEach((wing, index) => {
        const side = index === 0 ? -1 : 1, glass = [0xe9f7ff, 0xd6effe, 0xc2e3f8], plain = [[0, 1], [.55, .88], [.92, .4], [1, 0], [.92, -.4], [.55, -.88], [0, -1]];
        // Long enough to peek out past the head and the arms when seen from the front.
        lobe(wing, [side * .29, .2, -.03], .245, .15, .016, [0, side * .25, side * .58], glass, .85, plain);
        lobe(wing, [side * .25, -.03, -.02], .18, .1, .014, [0, side * .25, -side * .25], glass, .85, plain);
      });
      p.features.push('striped-abdomen', 'bee-wings');
    } else {
      if (!look.hooded) p.blob(upperBody, 0xb99be8, [0, .1, -.2], [.07, .19, .06], [0, 0, 0], 0, 12);
      wings.forEach((wing, index) => {
        const side = index === 0 ? -1 : 1;
        // One big painted spot on each wing: pink above, sky blue below.
        lobe(wing, [side * .255, .16, -.02], .235, .245, .021, [0, side * .22, -side * .32], [0xffc9e4, 0xc4a4f2, 0xb193ea], .35);
        lobe(wing, [side * .2, -.115, -.02], .165, .15, .019, [0, side * .22, side * .3], [0xa9e3f5, 0xb797ec, 0xa98be6], .35);
      });
      p.features.push('patterned-butterfly-wings');
    }
    return { tail, wings };
  }
  tail = new THREE.Group(); tail.name = 'avatar-tail'; tail.position.set(0, -.045, -.16); upperBody.add(tail);
  if (species === 'cat') {
    const stripe = tabby(skin);
    p.line(tail, (_x, y) => y > .27 || (y > .15 && y < .2) ? stripe : skin, [[0, 0, .02], [.1, -.04, -.1], [.24, -.03, -.19], [.34, .07, -.22], [.38, .21, -.19], [.35, .33, -.14]], .044, 0, { segments: 10, rows: 16 });
    p.features.push('cat-tail');
  } else if (species === 'fox') {
    p.line(tail, (_x, y) => mixColor(skin, CREAM, smoothstep(.22, .29, y)), [[0, .02, .02], [.1, -.02, -.1], [.25, .0, -.2], [.35, .14, -.23], [.37, .34, -.19]],
      t => .05 + .09 * Math.pow(Math.sin(Math.PI * (.1 + .78 * t)), 1.1), 0, { segments: 12, rows: 12 });
    p.features.push('fox-tail');
  } else {
    const size = species === 'rabbit' ? .095 : .062, fluff = species === 'rabbit' ? WHITE : skin;
    p.blob(tail, fluff, [0, .01, -.045], [size, size * .95, size], [0, 0, 0], 0, 12);
    if (species === 'rabbit') for (const side of [-1, 1]) p.blob(tail, fluff, [side * .045, -.02, -.05], [size * .62, size * .6, size * .62], [0, 0, 0], 0, 8);
    p.features.push('round-tail');
  }
  return { tail, wings };
}
