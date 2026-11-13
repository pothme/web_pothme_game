import * as THREE from 'three';
import { AVATAR_LABEL_Y } from './office-avatar';
import { AVATAR_HEAD_CENTER_Y } from '../shared/avatar-rig';
import { formatStockProfile, type StockProfile } from '../shared/stock-profile';

const box = new THREE.Box3(), part = new THREE.Box3(), chain = new THREE.Matrix4();
const restMatrix = new THREE.Matrix4(), restTurn = new THREE.Quaternion(), restAngles = new THREE.Euler();
/** Where a name plate sits for this figure: just above its own hair, ears or
 * hat rather than at one height for all. Measured in the head's rest frame with
 * the ears and antennae at rest, so a nod, a bow, a hop or an ear flick in
 * progress does not change the answer; never above the classic fixed height
 * that every figure is built to clear. */
export function avatarLabelY(model: { head: THREE.Object3D; ears?: readonly THREE.Object3D[] }) {
  box.makeEmpty();
  model.head.traverse(object => {
    const mesh = object as THREE.Mesh; if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    chain.identity();
    for (let node: THREE.Object3D = mesh; node !== model.head && node.parent; node = node.parent) {
      // Ambient life tilts an ear joint about X and Z only; its rest pose has neither.
      if (model.ears?.includes(node)) chain.premultiply(restMatrix.compose(node.position, restTurn.setFromEuler(restAngles.set(0, node.rotation.y, 0, node.rotation.order)), node.scale));
      else { node.updateMatrix(); chain.premultiply(node.matrix); }
    }
    box.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(chain));
  });
  return box.isEmpty() ? AVATAR_LABEL_Y : Math.min(AVATAR_LABEL_Y, AVATAR_HEAD_CENTER_Y + box.max.y + .22);
}

/** Both lines share one texture/draw; the nickname plate keeps its height when
 * the holding line is added above it. `y` comes from avatarLabelY. */
export function createAvatarNameLabel(name: string, mine: boolean, profile: StockProfile | null, y = AVATAR_LABEL_Y) {
  const canvas = document.createElement('canvas');
  canvas.width = profile ? 768 : 512; canvas.height = profile ? 192 : 112;
  const ctx = canvas.getContext('2d')!;
  const center = canvas.width / 2, nameY = profile ? 130 : 50;
  const label = mine ? `${name} · 나` : name;
  ctx.font = '600 37px "Malgun Gothic",sans-serif';
  const width = Math.min(492, ctx.measureText(label).width + 62);
  ctx.fillStyle = mine ? '#305c7c' : '#223749';
  ctx.beginPath(); ctx.roundRect(center - width / 2, nameY - 35, width, 66, 28); ctx.fill();
  ctx.strokeStyle = mine ? '#8fc4e6' : '#6b879b'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#edf3f6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, center, nameY, width - 24);
  if (profile) {
    const holding = formatStockProfile(profile);
    ctx.font = '600 28px "Malgun Gothic",sans-serif';
    const holdingWidth = Math.min(748, ctx.measureText(holding).width + 40);
    ctx.fillStyle = '#143e43'; ctx.beginPath(); ctx.roundRect(center - holdingWidth / 2, 20, holdingWidth, 52, 18); ctx.fill();
    ctx.strokeStyle = '#8bcebb'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#d4f9e7'; ctx.fillText(holding, center, 46, holdingWidth - 24);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: true }));
  const scale = 2.4 / 512;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.userData.lift = profile ? 40 * scale : 0;
  sprite.position.y = y + sprite.userData.lift;
  sprite.renderOrder = 10;
  return sprite;
}

/** Re-seat an existing plate after its figure changed. Absolute rather than a
 * difference, so any number of outfit changes leaves it where a new plate would be. */
export function placeAvatarNameLabel(label: THREE.Sprite, y: number) {
  label.position.y = y + (Number(label.userData.lift) || 0);
}
