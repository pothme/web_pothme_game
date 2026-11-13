import * as THREE from 'three';
import { FOOT, FOOT_CENTER, FOREARM, HAND_Y, SHIN, SOLE_Y, THIGH, TORSO_POWER, UPPER_ARM, ball, band, footHalfWidth, footLoft, footRadius, footShape, footTop, limb, limbAt, limbLit, limbRings, pelvis, soleSlab, toeCap, torsoBack, torsoFront, torsoGarment, torsoSection, torsoShell, tuckHip } from './avatar-body';
import { ellipseOutline, polygonOutline, sculptGrid, sculptHorn, sculptLoft, smoothOutline, smoothstep, type SculptRing, type Vec2, type Vec3 } from './avatar-sculpt';
import { darken, lighten, mixColor, type AvatarPainter, type Tint } from './avatar-painter';

/** Clean candy pastels: every garment keeps its hue family from the shop card. */
export const WARDROBE_COLORS: Record<string, number> = {
  'tank-white': 0xfffdf5, 'blazer-blue': 0x9cc3ee, 'blazer-lilac': 0xc9b2ee, 'cardigan-mint': 0xa3e0c4, 'knit-cream': 0xfdeecb, 'blazer-night': 0x52669c, 'cardigan-coral': 0xffa28e, 'blazer-gold': 0xf9d77e,
  'hoodie-peach': 0xffb9a3, 'varsity-mint': 0x8ad8b8, 'sailor-navy': 0xfdfbf2, 'raincoat-yellow': 0xffe27a, 'hanbok-sky': 0xacdaf2, 'overalls-denim': 0x73a3d6, 'explorer-khaki': 0xbcc57c, 'chef-white': 0xfffaf0, 'space-silver': 0xe0eaf5, 'pajama-lavender': 0xd0bbf2,
  'shorts-navy': 0x6f8bc0, 'trousers-slate': 0x6b79a4, 'trousers-plum': 0xa07ba0, 'trousers-cream': 0xeedfbe, 'skirt-navy': 0x5568a0, 'trousers-ivory': 0xfbf4e2,
  'denim-shorts': 0x7cabdc, 'cargo-shorts': 0xb8c184, 'pleated-skirt': 0xf2a2bb, 'sailor-shorts': 0x5574ae, 'hanbok-pants': 0xf5ecd4, 'joggers-mint': 0xa8e3c9, 'adventure-pants': 0xb8a077, 'chef-check': 0xf3f0e8, 'space-pants': 0xd6e2ef, 'pajama-shorts': 0xd0bbf2,
  'slippers-ivory': 0xfff0cf, 'loafers-cream': 0xf8e8c6, 'loafers-navy': 0x5568a0, 'sneakers-white': 0xffffff, 'sneakers-rose': 0xf7a6bd,
  'canvas-red': 0xf5837b, 'high-top-purple': 0xbaa0f2, 'rainboots-yellow': 0xffe27a, 'maryjane-black': 0x4d4b66, 'hiking-tan': 0xcda072, 'clogs-mint': 0xa3e0c4, 'spaceboots-silver': 0xe0eaf5, 'bunny-slippers': 0xffcbd8, 'skate-blue': 0x82abea, 'sandals-sand': 0xe6c896,
};
export const cream = 0xfff6e7, ink = 0x56607c, gold = 0xf4cf6e, navy = 0x5574ae, red = 0xff857c;
/** The deeper shade of a garment. Black would turn the butter yellows olive, so they deepen towards amber. */
const shade = (id: string, color: number, amount = .86) => id.endsWith('yellow') || id.endsWith('gold') ? mixColor(color, 0xf2a742, (1 - amount) * 3.2) : darken(color, amount);

export type DressRig = { body: THREE.Group; arms: THREE.Group[]; forearms: THREE.Group[]; legs: THREE.Group[]; shins: THREE.Group[] };
type Look = { top: string; bottom: string; shoes: string };

/** Draws the body together with its clothes: a covered part is not also drawn
 * as skin underneath, which keeps the triangle count and overdraw low. */
export function dressAvatar(p: AvatarPainter, rig: DressRig, look: Look, skin: number, accent: number): void {
  dressTop(p, rig, look.top, skin, accent);
  dressBottom(p, rig, look.bottom, skin);
  dressShoes(p, rig, look.shoes, skin);
}

export function star(cx: number, cy: number, radius: number): Vec2[] {
  const points: Vec2[] = []; for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? radius * .5 : radius; points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return points;
}
export const rect = (cx: number, cy: number, hw: number, hh: number, power = 4.5, segments = 20) => ellipseOutline(cx, cy, hw, hh, 0, segments, power);
const signedPow = (value: number, exponent: number) => Math.sign(value) * Math.pow(Math.abs(value), exponent);

/** Neckline of the sleeveless undershirt, one height per 11.25° column from the
 * front centre round to the back centre: scoop, strap, armhole, strap, back. */
const TANK_EDGE = [.19, .194, .212, .262, .334, .338, .262, .21, .2, .21, .262, .338, .334, .286, .262, .254, .252];
/** Sailor collar: two bands from the shoulders to a point on the chest, and a square flap down the back. */
const sailorLow = (phi: number) => { const a = Math.abs(phi); return a < .8 ? .1 + .2 * Math.pow(a / .8, .8) : a < 1.9 ? .3 : a < 2.1 ? .3 - .16 * (a - 1.9) / .2 : .14; };
const sailorTop = (phi: number) => Math.abs(phi) < .8 ? Math.min(.345, sailorLow(phi) + .115) : .345;
const tankEdge = (phi: number) => { const at = Math.abs(phi) / Math.PI * 16, index = Math.min(15, Math.floor(at)); return TANK_EDGE[index] + (TANK_EDGE[index + 1] - TANK_EDGE[index]) * (at - index); };

function dressTop(p: AvatarPainter, rig: DressRig, id: string, skin: number, accent: number) {
  const { body } = rig, color = WARDROBE_COLORS[id] ?? WARDROBE_COLORS['tank-white'];
  const jacket = id.startsWith('blazer'), cardigan = id.startsWith('cardigan');
  const sleeve: 'bare' | 'short' | 'long' = id === 'tank-white' ? 'bare' : ['sailor-navy', 'overalls-denim', 'explorer-khaki'].includes(id) ? 'short' : 'long';
  const puff = id === 'hanbok-sky' ? 1.16 : id === 'space-silver' ? 1.12 : id === 'hoodie-peach' || id === 'raincoat-yellow' ? 1.06 : 1;
  const fit = id === 'space-silver' ? .02 : id === 'hoodie-peach' || id === 'raincoat-yellow' ? .016 : .01;
  // The hem stands clear of the legs, which swing and waddle underneath it: a long coat needs a real flare.
  const hem = id === 'raincoat-yellow' ? -.108 : id === 'hanbok-sky' ? -.055 : -.04, flare = id === 'raincoat-yellow' ? .054 : id === 'hanbok-sky' ? .018 : .014;
  const base = id === 'overalls-denim' || id === 'explorer-khaki' ? cream : color, dark = shade(id, color), light = lighten(color, .35);
  // The surface of the garment (it flares a little towards the hem), for details drawn on it.
  const swell = (y: number) => fit + flare * smoothstep(hem + .14, hem, y);
  const front = (x: number, y: number) => torsoFront(x, y) + swell(y), back = (x: number, y: number) => torsoBack(x, y) - swell(y);
  const patch = (tint: Tint, outline: Vec2[], lift = .004, dome = 0, gloss = 0) => p.decal(body, tint, front, outline, { rings: 1, lift, dome, bevel: .14 }, gloss);
  /** Long straight runs are subdivided so a line follows the curve of the belly instead of cutting through it. */
  const dense = (points: Vec2[]) => points.flatMap((point, index): Vec2[] => {
    if (index === 0) return [point];
    const from = points[index - 1], steps = Math.max(1, Math.round(Math.hypot(point[0] - from[0], point[1] - from[1]) / .045));
    return Array.from({ length: steps }, (_, step): Vec2 => [from[0] + (point[0] - from[0]) * (step + 1) / steps, from[1] + (point[1] - from[1]) * (step + 1) / steps]);
  });
  const line = (tint: Tint, points: Vec2[], radius: number, lift?: number) => p.trace(body, tint, front, dense(points), radius, 0, lift);
  const button = (x: number, y: number, tint: number = gold, radius = .017, lift = .006) => patch(tint, ellipseOutline(x, y, radius, radius, 0, 10), lift, .006, .5);
  const ring = (y: number, height: number, tint: number, extra = .008) => p.put(body, torsoShell(y, y + height, swell(y + height / 2) + extra), tint);
  /** A hood hanging from the collar: a plump pouch in the cloth of the garment, shaded where it opens at the top. */
  const hood = () => p.decal(body, (x, y) => mixColor(shade(id, color, id === 'raincoat-yellow' ? .9 : .82), color, smoothstep(.5, 1.2, Math.hypot(x / .115, (y - .272) / .04))), back,
    smoothOutline([[-.15, .3], [.15, .3], [.176, .235], [.122, .14], [0, .1], [-.122, .14], [-.176, .235]], 3), { rings: 4, lift: .014, dome: .066, bevel: .1, back: true });

  if (id === 'tank-white') {
    p.put(body, torsoShell(.15, .39, -.003), skin);
    // The neckline, straps and armholes are cut out of the shirt itself.
    p.put(body, torsoGarment(hem, tankEdge, fit, flare, 32, 9), color);
  } else {
    p.put(body, id === 'explorer-khaki' ? torsoShell(.27, .39, fit) : torsoShell(hem, .39, fit, flare), base);
    if (jacket) {
      const collar = lighten(color, .18);
      // The shirt ends inside the lapels, which lie well above it: no edge of one cuts through the other.
      patch(0xffffff, polygonOutline([[-.066, .318], [.066, .318], [0, .13]]), .003);
      for (const side of [-1, 1]) patch(collar, polygonOutline([[side * .056, .33], [side * .152, .3], [side * .124, .208], [side * .012, .1], [side * .03, .235]], 4), .012);
      patch(accent, polygonOutline([[-.022, .305], [.022, .305], [.028, .21], [0, .175], [-.028, .21]], 2), .007);
      line(dark, [[0, .1], [0, hem + .02]], .006);
      // The back vent runs to the hem, a shade deeper than the cloth.
      p.trace(body, shade(id, color, .93), back, dense([[0, .1], [0, hem + .008]]), .005, 0, -.001);
      for (const y of [.055, -.01]) button(.03, y, lighten(color, .6), .015);
      if (id === 'blazer-gold') patch(0xfffdf4, star(-.142, .165, .036), .009, .005, .5);
      p.features.push('tailored-top');
    } else if (cardigan) {
      patch(0xffffff, polygonOutline([[-.08, .335], [.08, .335], [0, .17]]), .003);
      for (const side of [-1, 1]) line(dark, [[side * .086, .33], [side * .045, .25], [0, .165]], .016);
      line(dark, [[0, .165], [0, hem + .03]], .016);
      for (const y of [.115, .05, -.015]) button(0, y, cream, .014, .016);
      ring(hem, .03, dark, .006);
      p.features.push('cardigan-top');
    } else if (id === 'knit-cream') {
      // A chunky roll collar, ribbed hem and one row of knitted diamonds.
      ring(.286, .058, lighten(color, .55), .018); ring(hem, .034, dark, .006);
      for (const x of [-.12, -.06, 0, .06, .12]) patch(0xf4b98f, polygonOutline([[x, .222], [x + .019, .2], [x, .178], [x - .019, .2]], 1), .005);
      p.features.push('knit-top');
    } else if (id === 'hoodie-peach') {
      hood();
      ring(.285, .055, light, .02); ring(hem, .032, dark, .006);
      // Kangaroo pocket: a wide pouch whose slanted sides are the openings.
      patch(dark, polygonOutline([[-.085, .082], [.085, .082], [.142, .012], [.142, -.012], [-.142, -.012], [-.142, .012]], 3), .009);
      for (const side of [-1, 1]) { line(cream, [[side * .04, .3], [side * .046, .2]], .008); button(side * .046, .19, cream, .012); }
    } else if (id === 'varsity-mint') {
      ring(.29, .05, cream, .012); ring(hem, .032, dark, .006);
      line(cream, [[0, .3], [0, hem + .03]], .011);
      for (const y of [.21, .13, .05]) button(.0, y, gold, .014, .013);
      patch(cream, ellipseOutline(-.115, .2, .05, .05, 0, 14), .005);
      line(color, [[-.13, .172], [-.13, .228], [-.105, .228], [-.097, .212], [-.105, .198], [-.13, .198]], .0075, .008);
    } else if (id === 'sailor-navy') {
      p.put(body, torsoGarment(sailorLow, sailorTop, fit + .01, 0, 32, 5), navy);
      // One white stripe just inside the collar edge: down both bands in front, and round the flap (sides and bottom) at the back.
      const onCollar = (phi: number, y: number): Vec3 => { const [w, d, zc] = torsoSection(y), e = 2 / TORSO_POWER; return [signedPow(Math.sin(phi), e) * (w + fit + .011), y, zc + signedPow(Math.cos(phi), e) * (d + fit + .011)]; };
      const piping = (points: Vec3[]) => p.line(body, 0xffffff, points, .0055, 0, { segments: 5, rows: points.length + 2, flat: .75 });
      for (const side of [-1, 1]) piping([.74, .6, .46, .32, .2, .12].map(a => onCollar(side * a, sailorLow(a) + .024)));
      const flap = [.3, .27, .24, .21, .185, .171, .166].map((y, index) => onCollar(index < 5 ? 2.2 : index < 6 ? 2.25 : 2.36, y)), across = [2.55, 2.75, 2.95].map(phi => onCollar(phi, .166));
      piping([...flap, ...across, onCollar(Math.PI, .166), ...across.reverse().map(([x, y, z]): Vec3 => [-x, y, z]), ...flap.reverse().map(([x, y, z]): Vec3 => [-x, y, z])]);
      patch(red, smoothOutline([[-.03, .125], [.03, .125], [.04, .03], [0, .06], [-.04, .03]], 3), .008);
      button(0, .125, darken(red, .9), .02);
    } else if (id === 'raincoat-yellow') {
      hood();
      ring(.29, .05, dark, .016);
      line(dark, [[0, .3], [0, hem + .02]], .007);
      for (const y of [.2, .1, 0]) button(.04, y, 0xd9924e, .016);
    } else if (id === 'hanbok-sky') {
      // Jeogori: the left panel wraps over the right; a white collar band
      // (dongjeong) follows the overlap down to the knot of the goreum.
      ring(.3, .045, 0xffffff, .004);
      patch(light, polygonOutline([[-.14, .335], [-.07, .345], [.0, .255], [-.03, .21]]), .005);
      patch(0xffffff, polygonOutline([[.14, .335], [.07, .345], [-.092, .15], [-.05, .112]]), .006);
      // Goreum: one flat loop to the side and two long tails hanging from the knot.
      const ribbon = 0xff9fb8, kx = -.074, ky = .128;
      patch(darken(ribbon, .93), polygonOutline([[kx - .02, ky], [kx + .004, ky], [kx - .028, -.005], [kx - .062, -.005]], 3), .007);
      patch(ribbon, polygonOutline([[kx - .012, ky], [kx + .022, ky], [kx + .04, -.04], [kx + .002, -.04]], 3), .009);
      patch(ribbon, smoothOutline([[kx + .004, ky + .014], [kx - .07, ky + .05], [kx - .096, ky + .012], [kx - .004, ky - .016]], 4), .009);
      patch(darken(ribbon, .9), rect(kx, ky, .022, .02, 3, 12), .012, .004);
    } else if (id === 'overalls-denim') {
      p.put(body, torsoShell(hem - .004, .04, fit + .008, flare + .004), color);
      patch(color, rect(0, .115, .125, .1, 5), .007);
      patch(dark, rect(0, .11, .06, .042, 4), .01);
      // A small bib at the back; each strap is one flat ribbon from the front bib over the shoulder down to it.
      p.decal(body, color, back, rect(0, .095, .1, .075, 5), { rings: 1, lift: .008, bevel: .14, back: true });
      for (const side of [-1, 1]) {
        const over = (y: number, x: number, behind: boolean): Vec3 => [side * x, y, (behind ? back(side * x, y) - .006 : front(side * x, y) + .006)];
        p.line(body, color, [over(.185, .097, false), over(.25, .108, false), over(.3, .116, false), over(.335, .12, false), over(.351, .121, false), [side * .121, .367, .004],
          over(.351, .121, true), over(.335, .119, true), over(.3, .112, true), over(.25, .1, true), over(.2, .088, true), over(.15, .077, true)], .0055, 0, { segments: 6, rows: 18, flat: 4, up: [1, 0, 0], round: false });
        button(side * .098, .192, gold, .017, .015);
      }
    } else if (id === 'explorer-khaki') {
      p.put(body, torsoShell(hem, .3, fit + .008, flare), color);
      patch(cream, polygonOutline([[-.075, .31], [.075, .31], [0, .15]]), .012);
      line(darken(color, .8), [[0, .15], [0, hem + .03]], .006, .012);
      for (const side of [-1, 1]) { patch(dark, rect(side * .115, .15, .058, .05, 4), .012); button(side * .115, .178, gold, .011); }
      ring(hem + .012, .035, 0xb08c68, .024);
      patch(gold, rect(0, hem + .03, .028, .022, 4), .02, .003, .5);
    } else if (id === 'chef-white') {
      patch(0xf3ecdd, rect(0, .12, .13, .15, 5), .004);
      for (const side of [-1, 1]) for (const y of [.2, .12, .04]) button(side * .07, y, ink, .014);
      patch(red, polygonOutline([[-.085, .335], [.085, .335], [0, .225]]), .006);
      ring(.3, .04, 0xffffff, .012);
    } else if (id === 'space-silver') {
      // A padded suit: thick collar ring, waist ring and one friendly chest console.
      const trim = 0xa9bcd6;
      ring(.285, .06, trim, .03); ring(hem + .005, .035, trim, .01);
      patch(ink, rect(0, .15, .105, .07, 4.5), .006, .004);
      patch(0x86e6d6, rect(-.03, .15, .05, .04, 4), .012, 0, .6);
      for (const [y, tint] of [[.178, 0xffb46a], [.15, 0xa2e68e], [.122, 0xff8f9d]]) button(.062, y, tint, .012);
    } else {
      // Pyjama shirt: notched collar, piping down the front, soft stripes.
      for (const side of [-1, 1]) patch(cream, polygonOutline([[side * .078, .34], [side * .15, .305], [side * .09, .215], [0, .17], [side * .02, .25]]), .006);
      line(cream, [[0, .17], [0, hem + .02]], .0075);
      for (const y of [.115, .05, -.01]) button(.026, y, 0x9a80d0, .013);
      for (const x of [-.15, -.08, .08, .15]) line(light, [[x, .2], [x, .09], [x, -.01]], .008);
    }
  }
  p.features.push(`wardrobe-top:${id}`);

  const sleeveColor = id === 'varsity-mint' || id === 'overalls-denim' || id === 'explorer-khaki' ? cream : color;
  const cuff = id === 'varsity-mint' ? color : id === 'hanbok-sky' ? 0xffffff : id === 'sailor-navy' ? navy : id === 'space-silver' ? 0xa9bcd6 : jacket ? 0xffffff : darken(sleeveColor, .88);
  rig.arms.forEach((arm, index) => {
    const side = index === 0 ? -1 : 1, forearm = rig.forearms[index];
    if (sleeve === 'long') {
      p.put(arm, limb(UPPER_ARM, .006, Infinity, -Infinity, 0, puff), sleeveColor);
      // The sleeve ends inside its cuff, so the cuff has one clean rolled edge.
      p.put(forearm, limb(FOREARM, .006, Infinity, -.112, 0, puff), sleeveColor);
      p.put(forearm, band(FOREARM, jacket ? -.104 : -.108, jacket ? .03 : .036, jacket ? .013 : .016, puff), cuff);
      if (id === 'space-silver') p.put(arm, band(UPPER_ARM, -.075, .034, .009, puff), index === 0 ? 0xff9fb0 : 0x9cc3ee);
    } else {
      p.put(arm, limb(UPPER_ARM), skin); p.put(forearm, limb(FOREARM, 0, Infinity, -.13), skin);
      if (sleeve === 'short') {
        p.put(arm, limb(UPPER_ARM, .012, Infinity, -.085, .008), sleeveColor);
        if (id === 'sailor-navy') p.put(arm, band(UPPER_ARM, -.072, .026, .022), cuff);
      }
    }
    // Round mitten hand with a small thumb: simple, soft, readable at any size.
    p.put(forearm, ball([side * .008, HAND_Y, .004], [.081, .086, .084]), skin);
    p.blob(forearm, skin, [-side * .05, HAND_Y + .014, .052], [.032, .038, .032], [0, 0, 0], 0, 8);
  });
}

/** A bell skirt hung from the hips (torso units). It belongs to the body, so
 * it stays whole while the legs walk under it and drapes over a seated lap. */
function skirtBell(hemY: number, hemWidth: number, hemDepth: number, pleats: number, segments = 28, rows = 5) {
  // The waist hides under the hem of the top; the bell opens just below it.
  const top = .0, waist = -.046, [wt, dt, zc] = torsoSection(top), [w0, d0] = torsoSection(waist), e = 2 / 2.2;
  const flare = (y: number) => Math.pow(Math.min(1, Math.max(0, (y - waist) / (hemY - waist))), .8);
  const width = (y: number) => y > waist ? wt - .004 + (w0 + .008 - wt) * (y - top) / (waist - top) : w0 + .004 + (hemWidth - w0) * flare(y);
  const depth = (y: number) => y > waist ? dt - .004 + (d0 + .008 - dt) * (y - top) / (waist - top) : d0 + .004 + (hemDepth - d0) * flare(y);
  const height = (row: number) => row === 0 ? top : row > rows ? hemY + .008 : waist + (hemY - waist) * (row - 1) / (rows - 1);
  const geometry = sculptGrid(segments, rows + 1, (u, v, out) => {
    const column = Math.round(u * segments) % segments, row = Math.round(v * (rows + 1)), y = height(row), angle = column / segments * Math.PI * 2;
    const fold = (1 + pleats * flare(Math.min(y, waist)) * (column % 2 ? 1 : -1)) * (row > rows ? .95 : 1);
    out.set(signedPow(Math.sin(angle), e) * width(Math.min(y, top)) * fold, y, zc + signedPow(Math.cos(angle), e) * depth(Math.min(y, top)) * fold);
  });
  /** The fold (column of the mesh) and the row a point of the skirt belongs to. */
  const column = (x: number, y: number, z: number) => Math.floor((Math.atan2(signedPow(x / width(y), 1 / e), signedPow((z - zc) / depth(y), 1 / e)) / (Math.PI * 2) + 1) * segments) % segments;
  const row = (y: number) => y > waist ? 0 : 1 + Math.min(rows - 2, Math.floor((y - waist) / (hemY - waist) * (rows - 1)));
  return { geometry, column, row };
}

function dressBottom(p: AvatarPainter, rig: DressRig, id: string, skin: number) {
  const color = WARDROBE_COLORS[id] ?? WARDROBE_COLORS['shorts-navy'], dark = darken(color, .87), light = lighten(color, .4);
  const skirt = id.includes('skirt'), shorts = id.includes('shorts'), hanbok = id === 'hanbok-pants';
  const wide = id === 'trousers-plum' || id === 'trousers-ivory' ? 1.1 : hanbok ? 1.2 : id === 'joggers-mint' || id === 'space-pants' ? 1.08 : 1;
  const hem = id === 'cargo-shorts' ? -.155 : id === 'pajama-shorts' ? -.105 : id === 'shorts-navy' ? -.13 : -.125;
  // Gingham and stripes are woven from the mesh itself, so every check has crisp edges.
  const white = 0xfbfaf6, mid = 0xb7c4e2, deep = 0x7f93c8;
  const weave = (rings: SculptRing[]): Tint => (x, y, z) => {
    const column = Math.floor((Math.atan2(x, z) / (Math.PI * 2) + 1) * 16) % 2; let row = 0; for (const ring of rings) if (ring[0] > y) row++;
    return column && row % 2 ? deep : column || row % 2 ? mid : white;
  };
  const stripes = (base: number, other: number): Tint => (x, _y, z) => Math.floor((Math.atan2(x, z) / (Math.PI * 2) + 1) * 14) % 2 === 0 ? other : base;
  // The seat wears the same cloth as the legs.
  if (id === 'chef-check') p.facets(rig.body, pelvis(.004), (x, y) => { const column = Math.floor((x + 1) / .034) % 2, row = Math.floor((y + 1) / .034) % 2; return column && row ? deep : column || row ? mid : white; });
  else if (id === 'pajama-shorts') p.facets(rig.body, pelvis(.004), x => Math.floor((x + 1) / .03) % 2 ? light : color);
  else p.put(rig.body, pelvis(.004), skirt ? dark : color);
  if (skirt) {
    const pleated = id === 'pleated-skirt', hemY = -.18, rows = 6;
    // Pleats are real folds; every other fold face is a shade deeper. The plain skirt gets one hem stripe.
    const bell = skirtBell(hemY, pleated ? .312 : .3, pleated ? .268 : .256, pleated ? .05 : 0, pleated ? 32 : 28, rows);
    const stripe = (y: number) => bell.row(y) === rows - 2;
    p.facets(rig.body, bell.geometry, pleated ? (x, y, z) => stripe(y) ? 0xffffff : bell.column(x, y, z) % 2 ? color : darken(color, .93) : (_x, y) => stripe(y) ? cream : color);
  }
  // Roomy trousers fit at the hip (inside the hem of the top) and widen below it.
  const roomy = (fitted: SculptRing[], loose: SculptRing[]) => wide === 1 ? fitted : fitted.map((ring, index): SculptRing => { const t = smoothstep(-.02, -.12, ring[0]); return [ring[0], ring[1] + (loose[index][1] - ring[1]) * t, ring[2] + (loose[index][2] - ring[2]) * t]; });
  rig.legs.forEach((leg, index) => {
    const side = index === 0 ? -1 : 1, shin = rig.shins[index];
    /** The thigh, or a trouser leg around it; its hip end is tucked under the body. */
    const thighRings = (profile: SculptRing[], inflate = 0, from = Infinity, to = -Infinity, flare = 0, step = 0) => tuckHip(roomy(limbRings(profile, inflate, from, to, flare, 1, step), limbRings(profile, inflate, from, to, flare, wide, step)), side);
    const thigh = (inflate = 0, from = Infinity, to = -Infinity, flare = 0) => sculptLoft(tuckHip(limbRings(THIGH, inflate, from, to, flare), side), 14, 1, 2, tuckHip(limbRings(limbLit(THIGH), inflate, from, to, flare), side));
    if (skirt) {
      p.put(leg, thigh(), skin); p.put(shin, limb(SHIN), skin);
    } else if (shorts) {
      p.put(leg, thigh(0, hem + .05), skin); p.put(shin, limb(SHIN), skin);
      if (id === 'pajama-shorts') p.facets(leg, thigh(.012, Infinity, hem, .014), stripes(color, light));
      else p.put(leg, thigh(.012, Infinity, hem, .014), color);
      if (id === 'denim-shorts') p.put(leg, band(THIGH, hem + .016, .034, .028), light);
      else if (id === 'sailor-shorts') for (const y of [hem + .02, hem + .048]) p.put(leg, band(THIGH, y, .013, .028), cream);
      else if (id === 'cargo-shorts') p.box(leg, dark, [side * .096, -.085, .005], [.05, .08, .105], .018);
      else if (id === 'shorts-navy') p.put(leg, band(THIGH, hem + .012, .022, .026), dark);
    } else {
      const hemY = -.196, flare = wide > 1.09 ? .016 : .008, check = id === 'chef-check', step = check ? .045 : hanbok ? .035 : 0;
      const upper = thighRings(THIGH, .008, Infinity, -Infinity, 0, step), upperLit = thighRings(limbLit(THIGH), .008, Infinity, -Infinity, 0, step);
      // Hanbok trousers balloon over the calf and are gathered tightly at the ankle.
      const shinRings = (profile: SculptRing[]) => limbRings(profile, .008, Infinity, hemY, hanbok ? 0 : flare, wide, step).map((ring): SculptRing => {
        if (!hanbok || ring[1] <= 0 || ring[0] > hemY + .003 && ring[0] < hemY + .008) return ring;
        const [w, d] = limbAt(SHIN, ring[0]), gather = smoothstep(-.105, -.185, ring[0]), puff = 1 + .1 * smoothstep(0, -.09, ring[0]);
        return [ring[0], ring[1] * puff + (w + .016 - ring[1] * puff) * gather, ring[2] * puff + (d + .016 - ring[2] * puff) * gather];
      });
      const lower = shinRings(SHIN), lowerLit = shinRings(limbLit(SHIN));
      if (check) { p.facets(leg, sculptLoft(upper, 16, 1, 2, upperLit), weave(upper)); p.facets(shin, sculptLoft(lower, 16, 1, 2, lowerLit), weave(lower)); }
      else { p.put(leg, sculptLoft(upper, 14, 1, 2, upperLit), color); p.put(shin, sculptLoft(lower, 14, 1, 2, lowerLit), color); }
      // Daenim: the ankle ties of hanbok trousers, in the blue of the jeogori.
      if (hanbok) { p.put(shin, band(SHIN, hemY + .03, .05, .021), 0xacdaf2); p.blob(shin, 0xacdaf2, [side * .088, hemY + .026, .03], [.016, .024, .022], [0, 0, side * .5], 0, 8); }
      if (id === 'joggers-mint') p.put(shin, band(SHIN, hemY + .024, .04, .016), dark);
      if (id === 'joggers-mint' || id === 'space-pants') {
        // A side stripe: a flat ribbon lying on the cloth, unbroken across the knee.
        const tint = id === 'joggers-mint' ? cream : 0x8fb0d8;
        const along = (rings: SculptRing[], ys: number[]) => ys.map((y): Vec3 => { let k = 0; while (k < rings.length - 2 && rings[k + 1][0] > y) k++; const a = rings[k], b = rings[k + 1], t = Math.min(1, Math.max(0, (a[0] - y) / (a[0] - b[0]))); return [(a[4] ?? 0) + (b[4] ?? 0) * t - (a[4] ?? 0) * t + side * (a[1] + (b[1] - a[1]) * t + .0015), y, 0]; });
        p.line(leg, tint, along(upper, [-.035, -.08, -.14, -.2, -.214]), .0035, 0, { segments: 6, rows: 8, flat: 3.4, up: [0, 0, 1] });
        p.line(shin, tint, along(lower, [.012, -.04, -.1, id === 'joggers-mint' ? -.15 : -.156]), .0035, 0, { segments: 6, rows: 6, flat: 3.4, up: [0, 0, 1] });
      }
      if (id === 'adventure-pants') p.box(leg, dark, [side * .096, -.1, .005], [.05, .1, .105], .018);
      if (id === 'space-pants') p.put(shin, band(SHIN, hemY + .022, .036, .018, wide), 0xa9bcd6);
    }
  });
  p.features.push(`wardrobe-bottom:${id}`);
}

function dressShoes(p: AvatarPainter, rig: DressRig, id: string, skin: number) {
  const color = WARDROBE_COLORS[id] ?? WARDROBE_COLORS['slippers-ivory'], dark = shade(id, color, .84);
  const open = id === 'slippers-ivory' || id === 'sandals-sand';
  const sneaker = id.includes('sneakers') || ['canvas-red', 'high-top-purple', 'skate-blue'].includes(id);
  // Where the collar of the shoe (or the shaft of a boot) ends, and how much wider than the ankle it is.
  const boot = id === 'rainboots-yellow' ? -.085 : id === 'spaceboots-silver' ? -.1 : id === 'hiking-tan' ? -.125 : id === 'high-top-purple' ? -.132 : 0;
  const neck = open ? .002 : id === 'rainboots-yellow' ? .02 : id === 'spaceboots-silver' ? .028 : id === 'hiking-tan' ? .017 : id === 'clogs-mint' || id === 'bunny-slippers' ? .016 : id === 'high-top-purple' ? .013 : .011;
  const soleColor = sneaker ? 0xffffff : id === 'hiking-tan' ? 0x8a7262 : id === 'spaceboots-silver' ? 0xa9bcd6 : id === 'maryjane-black' || id === 'loafers-navy' ? darken(color, .78) : dark;
  const glossy = id === 'rainboots-yellow' || id === 'maryjane-black' || id.startsWith('loafers') ? .55 : .1;
  const size = open ? .93 : id === 'clogs-mint' || id === 'bunny-slippers' || id === 'spaceboots-silver' ? 1.06 : 1, shape = size === 1 ? FOOT : footShape(size);
  const [, fy, fz] = FOOT_CENTER, top = (z: number, x = 0) => fy + footTop(x / size, fz + (z - fz) / size) * size, halfWidth = (z: number) => footHalfWidth(fz + (z - fz) / size) * size;
  const cap = id === 'sneakers-white' ? 0xdfe6f2 : sneaker ? 0xffffff : id === 'hiking-tan' ? soleColor : null;
  // Loafers and Mary Janes are cut low: a wide mouth around the ankle.
  const low = id.startsWith('loafers') || id === 'maryjane-black';
  rig.shins.forEach((shin, index) => {
    const side = index === 0 ? -1 : 1;
    // The shoe grows out of the ankle as one piece (collar, upper and heel); a bare foot is the leg itself.
    p.put(shin, footLoft(neck, boot || (open ? -.164 : low ? -.184 : -.174), shape), open ? skin : color, open ? 0 : glossy);
    p.put(shin, soleSlab(open ? .032 : sneaker || boot ? .028 : .022, id === 'slippers-ivory' ? .024 : open ? .013 : cap !== null ? .016 : .005, shape), open ? color : soleColor);
    if (cap !== null) p.put(shin, toeCap(.21 * Math.PI, .005, shape), cap);
    /** A flat band over the foot at depth z, from sole to sole. */
    const strap = (z: number, tint: number, width = .03, lift = .005, span = 1) => {
      const half = halfWidth(z), points: Vec3[] = span < 1 ? [] : [[-half - .003, SOLE_Y + .028, z]];
      for (const k of [-.94, -.7, -.36, 0, .36, .7, .94]) points.push([half * k * span, top(z, half * k * span) + (span < 1 && Math.abs(k) > .9 ? -.004 : lift), z]);
      if (span === 1) points.push([half + .003, SOLE_Y + .028, z]);
      p.line(shin, tint, points, .0055, 0, { segments: 8, rows: 12, flat: width / .011, up: [0, 0, 1] });
    };
    const laces = (tint: number) => { for (const z of [.106, .138]) p.line(shin, tint, [[-.052, top(z, -.052) + .003, z], [0, top(z) + .005, z], [.052, top(z, .052) + .003, z]], .008, 0, { segments: 6, rows: 4 }); };
    const stud = (z: number, tint = gold) => { const x = side * halfWidth(z) * .8; p.blob(shin, tint, [x, top(z, x) + .008, z], [.014, .014, .014], [0, 0, 0], .5, 8); };
    /** A point on the outside of the collar or shaft. */
    const onNeck = (y: number, angle: number, lift = 0): Vec3 => { const sin = Math.sin(angle), cos = Math.cos(angle), radius = footRadius(y, sin, cos, neck, shape) + lift; return [sin * radius, y, cos * radius]; };
    if (id === 'slippers-ivory') {
      // A padded upper over the toes, open at the heel: reads as a slipper from every side.
      p.put(shin, toeCap(around => (.37 - .1 * Math.max(0, Math.sin(around))) * Math.PI, .012, shape, 16, 5), color);
    } else if (id === 'sandals-sand') {
      strap(.118, color, .03);
      p.put(shin, band(SHIN, -.156, .022, .006), color);
      p.blob(shin, gold, onNeck(-.156, side * Math.PI / 2, .006), [.013, .013, .013], [0, 0, 0], .5, 8);
    } else if (id.startsWith('loafers')) {
      strap(.118, dark, .026, .002, .78);
      p.blob(shin, gold, [0, top(.118) + .006, .118], [.02, .007, .012], [0, 0, 0], .5, 8);
    } else if (id === 'maryjane-black') {
      strap(.112, color, .02, .005); stud(.112);
      p.put(shin, band(SHIN, -.16, .06, .007), 0xffffff);
    } else if (id === 'clogs-mint') {
      for (const x of [-.042, 0, .042]) p.blob(shin, dark, [x, top(.13, x) - .001, .13], [.013, .007, .013], [0, 0, 0], 0, 6);
      // The heel strap follows the shoe round the back, from one rivet to the other.
      p.line(shin, dark, [.56, .68, .84, 1, 1.16, 1.32, 1.44].map(turn => onNeck(-.205, turn * Math.PI, .004)), .006, 0, { segments: 5, rows: 10, flat: 2, up: [0, 1, 0] });
      for (const s of [-1, 1]) p.blob(shin, lighten(color, .5), onNeck(-.205, s * .56 * Math.PI, .008), [.012, .012, .012], [0, 0, 0], .3, 8);
    } else if (id === 'bunny-slippers') {
      const z = fz + FOOT.front * size * .93;
      for (const s of [-1, 1]) {
        p.put(shin, sculptHorn(.026, .017, .085, 3, [0, 0], 8, 4), color, 0, [s * .042, top(.118, s * .042) - .012, .118], [1, 1, 1], [-.35, 0, -s * .25]);
        p.blob(shin, ink, [s * .042, fy + .024, z - .014], [.012, .014, .008], [0, 0, 0], .6, 8);
      }
      p.blob(shin, 0xff8fa3, [0, fy + .006, z + .002], [.011, .009, .007], [0, 0, 0], .4, 8);
      p.blob(shin, 0xffffff, [0, fy + .012, fz - FOOT.back * size - .004], [.03, .03, .03], [0, 0, 0], 0, 8);
    }
    if (cap !== null) laces(id === 'hiking-tan' ? cream : id === 'sneakers-white' ? 0xc4d0e6 : 0xffffff);
    // A stripe lying on the outer side of the shoe.
    if (id === 'skate-blue') p.line(shin, cream, [[.66, -.212], [.52, -.224], [.38, -.236]].map(([turn, y]) => onNeck(y, side * turn * Math.PI, 0)), .005, 0, { segments: 5, rows: 5, flat: 2.6, up: [0, 1, 0] });
    if (boot) {
      if (id === 'rainboots-yellow' || id === 'hiking-tan') p.put(shin, band(SHIN, boot - .013, .026, neck + .007), dark);
      else if (id === 'spaceboots-silver') for (const y of [boot - .016, -.14]) p.put(shin, band(SHIN, y, .024, neck + .007), 0xa9bcd6);
      else p.blob(shin, cream, onNeck(-.158, side * Math.PI / 2, .001), [.007, .024, .024], [0, 0, 0], 0, 10);
    }
  });
  p.features.push(`wardrobe-shoes:${id}`);
}

/* ---------------------------------------------------------------- accessories */
export { renderAvatarAccessories, type HeadFit } from './avatar-accessories';
