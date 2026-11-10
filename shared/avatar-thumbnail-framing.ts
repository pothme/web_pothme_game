/** Fixed views of the same model, so a shoe does not look like a full outfit. */
export type AvatarThumbnailFrame = {
  target: readonly [number, number, number];
  camera: readonly [number, number, number];
  halfSize: number;
  yaw: number;
};

const frames: Record<string, AvatarThumbnailFrame> = {
  top: {target:[0,.65,0],camera:[0,.84,5],halfSize:.43,yaw:-.13},
  bottom: {target:[0,.33,0],camera:[0,.5,5],halfSize:.38,yaw:-.13},
  shoes: {target:[0,.06,.04],camera:[0,.82,3],halfSize:.27,yaw:-.18},
  headwear: {target:[0,1.39,0],camera:[0,1.43,5],halfSize:.7,yaw:-.12},
  eyewear: {target:[0,1.25,.1],camera:[0,1.28,5],halfSize:.6,yaw:0},
  neckwear: {target:[0,.73,.13],camera:[0,.83,5],halfSize:.34,yaw:-.08},
  backwear: {target:[0,.69,-.24],camera:[0,.81,-5],halfSize:.68,yaw:.18},
  hair: {target:[0,1.31,0],camera:[0,1.4,5],halfSize:.61,yaw:-.18},
  hairColor: {target:[0,1.31,0],camera:[0,1.4,5],halfSize:.61,yaw:-.18},
  face: {target:[0,1.25,.1],camera:[0,1.3,5],halfSize:.53,yaw:-.12},
  skin: {target:[0,1.25,.1],camera:[0,1.3,5],halfSize:.53,yaw:-.12},
  species: {target:[0,.99,0],camera:[0,1.24,5],halfSize:1.06,yaw:-.2},
};

/** Back items differ a lot in size. The slot's own frame has to hold the widest
 * wings; a bag, a shell or a jet pack fills a closer one, so its card shows the
 * item rather than a small torso in an empty square. */
const closeUps: Record<string, Partial<AvatarThumbnailFrame>> = {
  'backwear/backpack-mint': {target:[0,.66,-.24],halfSize:.43},
  'backwear/satchel-brown': {target:[0,.62,-.24],halfSize:.43},
  'backwear/turtle-shell': {target:[0,.66,-.24],halfSize:.43},
  'backwear/rocket-pack': {target:[0,.66,-.24],halfSize:.43},
  'backwear/guitar': {target:[0,.7,-.24],halfSize:.55},
  'backwear/bat-wings': {target:[0,.74,-.24],halfSize:.66},
  'backwear/angel-wings': {target:[0,.74,-.24],halfSize:.72},
};

/** `item` is the option id. Without it (or for an item with no view of its own)
 * the slot's frame is returned, which fits every item of that slot. */
export function avatarThumbnailFrame(slot:string,item?:string):AvatarThumbnailFrame {
  const frame=frames[slot]??frames.species,closeUp=item===undefined?undefined:closeUps[`${slot}/${item}`];
  return closeUp?{...frame,...closeUp}:frame;
}
