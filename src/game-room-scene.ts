import * as THREE from 'three';
import { createOfficeAvatar, type OfficeAvatar } from './office-avatar';
import { poseAvatarLife } from './office-avatar-pose';
import type { AvatarAppearance } from '../shared/avatar-appearance';
import { AVATAR_SEATED_Y } from '../shared/avatar-rig';

export interface TableGuest {
  id: string;
  nickname: string;
  appearance?: AvatarAppearance;
  color?: number;
  team?: 'A' | 'B' | null;
}

/** One small, shared renderer for the game table. While guests are seated and
 * the table is on screen it idles at 30 Hz (breathing, blinking, a glance
 * around); with nobody seated, hidden or inactive it sleeps between changes. */
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
  // The table top sits at chest height of the seated, short-bodied figures, so
  // their outfits and resting hands stay visible above it.
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, .16, 48), new THREE.MeshStandardMaterial({ color: 0x9f8050, roughness: .65 }));
  rim.position.y = .78; rim.scale.z = .67; scene.add(rim); fixed.push(rim);
  const felt = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, .17, 48), new THREE.MeshStandardMaterial({ color: 0x2f6360, roughness: 1 }));
  felt.position.y = .82; felt.scale.z = .65; scene.add(felt); fixed.push(felt);
  box(.35, .71, .35, 0x182431, -1.35, .345, 0); box(.35, .71, .35, 0x182431, 1.35, .345, 0);
  // Three physical card stacks make the empty table legible without a busy backdrop.
  for (let i = 0; i < 3; i++) {
    const card = box(.44, .035, .64, [0xddd2b5, 0x638e86, 0x879db8][i], (i - 1) * .66, .93, 0);
    card.rotation.y = (i - 1) * -.12;
  }
  type Guest = { model: OfficeAvatar; chair: THREE.Group };
  let guests: Guest[] = [];
  // The seats of the previous roster, already off the scene. They are released
  // after the new guests have been painted once: all figures share one shader
  // program, and dropping its last user would recompile it for the newcomers.
  let retired: Guest[] = [];
  let signature = '', yaw = .12, disposed = false, scheduled = 0, active = true, dirty = true, lastPaint = -Infinity, lastWidth = 0, lastHeight = 0;
  function paint(time: number) {
    scheduled = 0; if (disposed || !active || document.hidden) return;
    const width = host.clientWidth, height = host.clientHeight;
    // A hidden tab panel has no size: sleep until the ResizeObserver wakes us.
    if (!width || !height) return;
    if (guests.length) scheduled = requestAnimationFrame(paint);
    if (!dirty && time - lastPaint < 1000 / 30 - 1) return;
    dirty = false; lastPaint = time;
    for (const { model } of guests) {
      poseAvatarLife(model, time, false);
      // Each guest glances around the table at their own unhurried pace.
      const glance = time * .00045 + model.lifePhase * 40;
      model.head.rotation.y = Math.sin(glance) * .2 + Math.sin(glance * 2.7) * .06;
      model.head.rotation.z = Math.sin(glance * 1.3) * .035;
    }
    if (width !== lastWidth || height !== lastHeight) { lastWidth = width; lastHeight = height; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
    // Close enough for faces to read, far enough for every seat to fit a narrow phone panel.
    const distance = THREE.MathUtils.clamp(3.75 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect), 8.2, 11.4);
    camera.position.set(Math.sin(yaw) * distance, distance * .47, Math.cos(yaw) * distance);
    camera.lookAt(0, .9, 0); renderer.render(scene, camera);
    if (retired.length) { disposeGuests(retired); retired = []; }
  }
  function draw() { dirty = true; if (!scheduled && !disposed && active) scheduled = requestAnimationFrame(paint); }
  function disposeGuests(list: Guest[]) {
    for (const guest of list) {
      scene.remove(guest.model.group, guest.chair); guest.model.dispose();
      guest.chair.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
    }
  }
  function clearGuests() { disposeGuests(guests); disposeGuests(retired); guests = []; retired = []; }
  function update(players: readonly TableGuest[]) {
    const next = JSON.stringify(players.map(({ id, appearance, color, team }) => ({ id, appearance, color, team })));
    if (next === signature) return; signature = next;
    for (const guest of guests) scene.remove(guest.model.group, guest.chair);
    // Several rosters between two paints: the painted one already waiting is enough.
    if (retired.length) disposeGuests(guests); else retired = guests;
    guests = [];
    const count = players.length;
    players.slice(0, 8).forEach((player, index) => {
      const angle = count <= 2 ? Math.PI * (index + .5) : Math.PI * 2 * index / count + Math.PI / 4;
      const x = Math.sin(angle) * 2.98, z = Math.cos(angle) * 2.18;
      const model = createOfficeAvatar(player.color ?? (0x718da8 + index * 71), player.appearance, player.id);
      model.group.position.set(x, AVATAR_SEATED_Y - .02, z); model.group.rotation.y = Math.atan2(-x, -z);
      model.legs.forEach(leg => { leg.rotation.x = -Math.PI / 2; });
      model.lowerLegs.forEach(leg => { leg.rotation.x = Math.PI / 2; });
      model.arms.forEach(arm => { arm.rotation.x = -.75; });
      scene.add(model.group);
      const chair = new THREE.Group(); chair.position.set(x, 0, z); chair.rotation.y = model.group.rotation.y;
      const chairColor = player.team === 'A' ? 0x566d99 : player.team === 'B' ? 0x94714f : 0x365364;
      // A low stool-back chair: the back stops under the big head, so a guest
      // seen from behind is still a character rather than a slab.
      const chairMaterial = new THREE.MeshStandardMaterial({ color: chairColor, roughness: .9 });
      const cushion = new THREE.Mesh(new THREE.CylinderGeometry(.4, .36, .13, 24), chairMaterial);
      cushion.position.y = .675; chair.add(cushion);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, .36, 20, 1, true, Math.PI - .95, 1.9), chairMaterial);
      chairMaterial.side = THREE.DoubleSide; back.position.set(0, .9, 0); chair.add(back);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.07, .2, .62, 12), new THREE.MeshStandardMaterial({ color: 0x182431, roughness: .8 }));
      post.position.y = .31; chair.add(post); scene.add(chair);
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
