import * as THREE from 'three';
import { AVATAR_LABEL_Y } from './office-avatar';
import { formatStockProfile, type StockProfile } from '../shared/stock-profile';

/** Both lines share one texture/draw. The nickname stays at its original height. */
export function createAvatarNameLabel(name: string, mine: boolean, profile: StockProfile | null) {
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
  sprite.position.y = AVATAR_LABEL_Y + (profile ? 40 * scale : 0);
  sprite.renderOrder = 10;
  return sprite;
}
