/** Fixed views of the same model, so a shoe does not look like a full outfit. */
export type AvatarThumbnailFrame = {
  target: readonly [number, number, number];
  camera: readonly [number, number, number];
  halfSize: number;
  yaw: number;
};

const frames: Record<string, AvatarThumbnailFrame> = {
  top: {target:[0,.65,0],camera:[0,.84,5],halfSize:.43,yaw:-.13},
  bottom: {target:[0,.29,0],camera:[0,.45,5],halfSize:.32,yaw:-.13},
  shoes: {target:[0,.095,.04],camera:[0,.85,3],halfSize:.29,yaw:-.18},
  headwear: {target:[0,1.39,0],camera:[0,1.43,5],halfSize:.66,yaw:-.12},
  eyewear: {target:[0,1.25,.1],camera:[0,1.28,5],halfSize:.51,yaw:0},
  neckwear: {target:[0,.77,.13],camera:[0,.85,5],halfSize:.31,yaw:-.08},
  backwear: {target:[0,.69,-.24],camera:[0,.81,-5],halfSize:.59,yaw:.18},
  hair: {target:[0,1.31,0],camera:[0,1.4,5],halfSize:.61,yaw:-.18},
  hairColor: {target:[0,1.31,0],camera:[0,1.4,5],halfSize:.61,yaw:-.18},
  face: {target:[0,1.25,.1],camera:[0,1.3,5],halfSize:.53,yaw:-.12},
  skin: {target:[0,1.25,.1],camera:[0,1.3,5],halfSize:.53,yaw:-.12},
  species: {target:[0,.99,0],camera:[0,1.24,5],halfSize:1.06,yaw:-.2},
};

export function avatarThumbnailFrame(slot:string):AvatarThumbnailFrame {
  return frames[slot]??frames.species;
}
