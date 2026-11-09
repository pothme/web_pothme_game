import * as THREE from 'three';
import { createOfficeAvatar, type OfficeAvatar } from './office-avatar';
import type { AvatarAppearance } from '../shared/avatar-appearance';
import { AVATAR_SEATED_Y } from '../shared/avatar-rig';

export interface TableGuest {
  id: string;
  nickname: string;
  appearance?: AvatarAppearance;
  color?: number;
  team?: 'A' | 'B' | null;
}

/** One small, shared renderer for the game table. It sleeps between changes. */
export function createGameRoomScene(host: HTMLElement) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101c29);
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 60);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.4));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.setAttribute('aria-label', '참가자들이 둘러앉은 게임 테이블. 드래그해서 둘러볼 수 있어요.');
  renderer.domElement.setAttribute('role', 'img'); host.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfff8e9, 0x36516c, 3));
  const light = new THREE.DirectionalLight(0xffddb3, 3.1); light.position.set(4, 8, 5); scene.add(light);
  const fill = new THREE.DirectionalLight(0x8cb8e7, 1.8); fill.position.set(-5, 3, -3); scene.add(fill);
  const fixed: THREE.Mesh[] = [];
  function box(width: number, height: number, depth: number, color: number, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color, roughness: .75 }));
    mesh.position.set(x, y, z); scene.add(mesh); fixed.push(mesh); return mesh;
  }
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, .1, 48), new THREE.MeshStandardMaterial({ color: 0x1d3041, roughness: .96 }));
  floor.position.y = -.08; scene.add(floor); fixed.push(floor);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, .16, 48), new THREE.MeshStandardMaterial({ color: 0x9f8050, roughness: .65 }));
  rim.position.y = 1.02; rim.scale.z = .67; scene.add(rim); fixed.push(rim);
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, .17, 48), new THREE.MeshStandardMaterial({ color: 0x254d4c, roughness: 1 }));
  felt.position.y = 1.06; felt.scale.z = .65; scene.add(felt); fixed.push(felt);
  box(.35, .95, .35, 0x182431, -1.35, .46, 0); box(.35, .95, .35, 0x182431, 1.35, .46, 0);
  // Three physical card stacks make the empty table legible without a busy backdrop.
  for (let i = 0; i < 3; i++) {
    const card = box(.44, .035, .64, [0xddd2b5, 0x638e86, 0x879db8][i], (i - 1) * .66, 1.17, 0);
    card.rotation.y = (i - 1) * -.12;
  }
  let guests: { model: OfficeAvatar; chair: THREE.Group }[] = [];
  let signature = '', yaw = .12, disposed = false, scheduled = 0, active = true;
  function paint() {
    scheduled = 0; if (disposed || !active || document.hidden) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.position.set(Math.sin(yaw) * 10.6, 5.2, Math.cos(yaw) * 10.6);
    camera.lookAt(0, .95, 0); camera.updateProjectionMatrix(); renderer.render(scene, camera);
  }
  function draw() { if (!scheduled && !disposed && active) scheduled = requestAnimationFrame(paint); }
  function clearGuests() {
    for (const guest of guests) {
      scene.remove(guest.model.group, guest.chair); guest.model.dispose();
      guest.chair.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
    }
    guests = [];
  }
  function update(players: readonly TableGuest[]) {
    const next = JSON.stringify(players.map(({ id, appearance, color, team }) => ({ id, appearance, color, team })));
    if (next === signature) return; signature = next; clearGuests();
    const count = players.length;
    players.slice(0, 8).forEach((player, index) => {
      const angle = count <= 2 ? Math.PI * (index + .5) : Math.PI * 2 * index / count + Math.PI / 4;
      const x = Math.sin(angle) * 3.15, z = Math.cos(angle) * 2.35;
      const model = createOfficeAvatar(player.color ?? (0x718da8 + index * 71), player.appearance);
      model.group.position.set(x, AVATAR_SEATED_Y - .02, z); model.group.rotation.y = Math.atan2(-x, -z);
      model.legs.forEach(leg => { leg.rotation.x = -Math.PI / 2; });
      model.lowerLegs.forEach(leg => { leg.rotation.x = Math.PI / 2; });
      model.arms.forEach(arm => { arm.rotation.x = -.6; });
      scene.add(model.group);
      const chair = new THREE.Group(); chair.position.set(x, 0, z); chair.rotation.y = model.group.rotation.y;
      const chairColor = player.team === 'A' ? 0x566d99 : player.team === 'B' ? 0x94714f : 0x365364;
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(.76, .12, .7), new THREE.MeshStandardMaterial({ color: chairColor, roughness: .9 }));
      cushion.position.y = .68; chair.add(cushion);
      const back = new THREE.Mesh(new THREE.BoxGeometry(.76, .73, .1), new THREE.MeshStandardMaterial({ color: chairColor, roughness: .9 }));
      back.position.set(0, 1.03, -.3); chair.add(back); scene.add(chair);
      guests.push({ model, chair });
    });
    draw();
  }
  let drag: { id: number; x: number } | null = null;
  const down = (event: PointerEvent) => { if (event.button !== 0) return; drag = { id: event.pointerId, x: event.clientX }; renderer.domElement.setPointerCapture(event.pointerId); };
  const move = (event: PointerEvent) => { if (!drag || event.pointerId !== drag.id) return; yaw -= (event.clientX - drag.x) * .008; drag.x = event.clientX; draw(); };
  const up = () => { drag = null; };
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up);
  const observer = new ResizeObserver(draw); observer.observe(host); document.addEventListener('visibilitychange', draw);
  draw();
  return {
    update,
    setActive(value: boolean) { active = value; if (value) draw(); else { cancelAnimationFrame(scheduled); scheduled = 0; } },
    resetView() { yaw = .12; draw(); },
    dispose() {
      disposed = true; cancelAnimationFrame(scheduled); observer.disconnect(); document.removeEventListener('visibilitychange', draw);
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up); renderer.domElement.removeEventListener('pointercancel', up);
      clearGuests(); for (const mesh of fixed) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
