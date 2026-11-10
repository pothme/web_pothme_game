import * as THREE from 'three';
import { normalizeAvatarAppearance, type AvatarAppearance } from '../shared/avatar-appearance';
import { AVATAR_BODY_SCALE_Y, AVATAR_HEAD_CENTER_Y, AVATAR_TORSO_Y } from '../shared/avatar-rig';
import { buildHead, buildSpeciesBody, type HeadLook, type Species } from './avatar-head';
import { createAvatarPainter, mixColor } from './avatar-painter';
import { createVinylMaterial } from './avatar-vinyl-material';
import { dressAvatar, renderAvatarAccessories } from './avatar-wardrobe';

export const AVATAR_LABEL_Y = 2.22;

/** Bright, clean paint. Ids come from shared/avatar-appearance.ts and never change. */
const SKIN: Record<string, number> = { porcelain: 0xffe7d6, peach: 0xfdd2b3, rose: 0xf2bca6, tan: 0xe2ab7e, brown: 0xb57d58, deep: 0x84543d };
const HAIR: Record<string, number> = { espresso: 0x5c3f35, chestnut: 0xa86a42, black: 0x3b3947, ash: 0xab9a8d, silver: 0xdde0ec, rose: 0xe896b0 };
/** Coat colours. The six skin ids are a real fur ramp on an animal, in the order
 * of the swatches: ivory, the species' own colour, rose, honey, mocha, deep brown. */
const SKIN_IDS = Object.keys(SKIN);
const FUR: Record<string, number[]> = {
  cat: [0xfff0dc, 0xfad09b, 0xfcc3b6, 0xf4bb78, 0xbd8862, 0x86604f],
  rabbit: [0xfffbf7, 0xfff0e4, 0xffd6da, 0xf4d0a0, 0xc79d7c, 0x8c695a],
  fox: [0xfde2c2, 0xf9b071, 0xfaa38c, 0xec9a52, 0xba7040, 0x7e5345],
  bear: [0xfff0dc, 0xdaa474, 0xf3b8ab, 0xf0bd72, 0xa8734f, 0x775140],
  bee: [0xfff4c8, 0xffe196, 0xffcdaa, 0xffce6c, 0xe0a560, 0x8f6546],
  butterfly: [0xf2e7fc, 0xd8beed, 0xf7bfdf, 0xbd9ae8, 0x9d7cc9, 0x786199],
};
/** Hats that swallow ears and antennae whole (the rabbit's long ears still stand through a beret). */
const coversEars = (headwear: string, species: string) => headwear === 'chef-hat' || (headwear === 'beret-cream' && ['cat', 'fox', 'bear'].includes(species));
/** 0…1 from any id; neighbouring ids land far apart. */
function phaseOf(seed: string | number): number {
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 15; hash = Math.imul(hash, 2246822519); hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

/** A soft vinyl-toy figure: a huge round head on a small pear body with stubby
 * limbs. Everything is procedural and merged into one draw per joint; the
 * joints (and their positions) are the same ones the office, the jump tower
 * and the game room have always posed. Extra joints — eyes, ears, tail, wings —
 * exist only for ambient life and are driven by poseOfficeAvatar. `seed` (the
 * player's id) spreads the ambient-life clocks; without it the colour decides. */
export function createOfficeAvatar(color: number, requested?: AvatarAppearance, seed?: string | number) {
  const appearance = normalizeAvatarAppearance(requested, color);
  const group = new THREE.Group(); group.name = 'podeum-collectible-avatar';
  const upperBody = new THREE.Group(); upperBody.position.y = AVATAR_TORSO_Y; group.add(upperBody);
  const head = new THREE.Group(); head.position.y = AVATAR_HEAD_CENTER_Y - AVATAR_TORSO_Y; upperBody.add(head);
  const arms: THREE.Group[] = [], forearms: THREE.Group[] = [], legs: THREE.Group[] = [], lowerLegs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(side * .285, .35 * AVATAR_BODY_SCALE_Y, 0); arm.rotation.z = side * .12; upperBody.add(arm); arms.push(arm);
    const forearm = new THREE.Group(); forearm.position.y = -.19 * AVATAR_BODY_SCALE_Y; arm.add(forearm); forearms.push(forearm);
    const leg = new THREE.Group(); leg.position.set(side * .12, .62 * AVATAR_BODY_SCALE_Y, 0); group.add(leg); legs.push(leg);
    const lowerLeg = new THREE.Group(); lowerLeg.position.y = -.25 * AVATAR_BODY_SCALE_Y; leg.add(lowerLeg); lowerLegs.push(lowerLeg);
  }
  const species = appearance.species as Species, animal = species !== 'human';
  const humanSkin = SKIN[appearance.skin] ?? SKIN.peach;
  const skin = animal ? FUR[species][Math.max(0, SKIN_IDS.indexOf(appearance.skin))] : humanSkin;
  // The player's server colour becomes a pastel accent (tie, hair band).
  const accent = mixColor(mixColor(color & 0xffffff, 0xffffff, .38), 0x8fd6c4, .25);
  const look: HeadLook = { species, face: appearance.face, hair: appearance.hair, skin, hairColor: HAIR[appearance.hairColor] ?? HAIR.espresso, accent, hatted: appearance.headwear !== 'none' && appearance.headwear !== 'flower-crown',
    earsCovered: coversEars(appearance.headwear, species), hooded: appearance.top === 'hoodie-peach' || appearance.top === 'raincoat-yellow' };

  const { painter, finish } = createAvatarPainter();
  const { shape, eyes, ears, eyeX, eyeY } = buildHead(painter, head, look);
  dressAvatar(painter, { body: upperBody, arms, forearms, legs, shins: lowerLegs }, appearance, skin, accent);
  const { tail, wings } = buildSpeciesBody(painter, upperBody, look);
  renderAvatarAccessories(painter, appearance, head, upperBody, { shape, eyeX, eyeY, hairLift: animal ? .014 : .046 });

  const heartEffect = new THREE.Group(); heartEffect.position.set(0, .4, .47); heartEffect.visible = false; upperBody.add(heartEffect);
  const heartShape = new THREE.Shape(); heartShape.moveTo(0, -.09);
  heartShape.bezierCurveTo(-.02, -.06, -.112, -.015, -.112, .047);
  heartShape.bezierCurveTo(-.112, .115, -.035, .138, 0, .079);
  heartShape.bezierCurveTo(.035, .138, .112, .115, .112, .047);
  heartShape.bezierCurveTo(.112, -.015, .02, -.06, 0, -.09);
  painter.put(heartEffect, new THREE.ExtrudeGeometry(heartShape, { depth: .03, bevelEnabled: true, bevelSegments: 2, bevelSize: .014, bevelThickness: .014, curveSegments: 6 }), 0xff8fa8, .6);

  const material = createVinylMaterial(), geometries = finish(material), happy = material.userData.happy as { value: number };
  // The eyes lie flush on the face and the heart floats in front of the chest:
  // neither adds to the floor shadow, so both stay out of the shadow pass.
  for (const flat of [eyes, heartEffect]) flat.traverse(part => { part.castShadow = false; });
  group.userData.species = species; group.userData.features = painter.features;
  let disposed = false;
  return {
    group, upperBody, head, arms, forearms, legs, lowerLegs, heartEffect,
    /** Ambient-life joints (optional for callers; never needed for gameplay poses). */
    eyes, ears, tail, wings,
    /** 0…1, stable per player: keeps fifty figures from blinking in unison. */
    lifePhase: seed === undefined ? ((color >>> 0) % 9973) / 9973 : phaseOf(seed),
    /** How loosely the ears follow a hop (long rabbit ears and antennae most). */
    earFlex: look.earsCovered ? 0 : species === 'rabbit' ? 1.5 : species === 'bee' || species === 'butterfly' ? 1.8 : species === 'bear' ? .5 : 1,
    /** Wing beats per ms (radians): bees buzz, butterflies fan slowly. */
    wingBeat: species === 'bee' ? .05 : .0055,
    labelY: AVATAR_LABEL_Y,
    /** 'happy' swaps the open eyes for closed "^ ^" arcs (joyful gestures); no extra
     * draw. `weight` 0…1 eases it: the eyes squeeze shut, then the arcs spring open.
     * Call it every frame after poseAvatarLife, which owns the blink. */
    setExpression(name: 'normal' | 'happy', weight = 1) {
      const w = name === 'happy' ? Math.min(1, Math.max(0, weight)) : 0;
      happy.value = w > .5 ? 1 : 0;
      if (w > 0) eyes.scale.y = w > .5 ? Math.min(1, .12 + (w - .5) * 2.6) : Math.min(eyes.scale.y, 1 - w * 1.76);
    },
    dispose() { if (disposed) return; disposed = true; geometries.forEach(geometry => geometry.dispose()); material.dispose(); },
  };
}

export type OfficeAvatar = ReturnType<typeof createOfficeAvatar>;

/** Replace only the rendered body. The scene root and its external attachments
 * (nameplate, held tray, selection ring) keep their identity and world position. */
export function replaceOfficeAvatarAppearance(current: OfficeAvatar, color: number, appearance: AvatarAppearance): OfficeAvatar {
  const next = createOfficeAvatar(color, appearance);
  // The same player keeps the same clock: a new outfit does not restart a blink or an ear flick.
  next.lifePhase = current.lifePhase;
  const oldJoints = [current.upperBody, current.head, ...current.arms, ...current.forearms, ...current.legs, ...current.lowerLegs];
  const newJoints = [next.upperBody, next.head, ...next.arms, ...next.forearms, ...next.legs, ...next.lowerLegs];
  for (let index = 0; index < oldJoints.length; index++) {
    newJoints[index].position.copy(oldJoints[index].position);
    newJoints[index].quaternion.copy(oldJoints[index].quaternion);
    newJoints[index].scale.copy(oldJoints[index].scale);
  }
  next.heartEffect.visible = current.heartEffect.visible;
  next.heartEffect.position.copy(current.heartEffect.position);
  next.heartEffect.scale.copy(current.heartEffect.scale);
  const root = current.group;
  root.remove(current.upperBody, ...current.legs);
  root.add(next.upperBody, ...next.legs);
  root.userData.species = next.group.userData.species;
  root.userData.features = next.group.userData.features;
  next.group = root;
  current.dispose();
  return next;
}
