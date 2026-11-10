import { JUMP_PORTAL, nearJumpPortal } from '../shared/jump-portal';
import { createJumpPortal } from './jump-portal-scene';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { NORMAL_MOVE_SPEED, MOVE_INTERVAL_MS, SOFAS, LOUNGE_TABLES, REFRESHMENT_STATION, ROOM_BOUNDS, ROOM_FEATURES, OFFICE_GEOMETRY, OFFICE_EXPANSION_SCALE, WALL_CHART_GEOMETRY, REAR_WALL_CHART_GEOMETRY, WALL_CLOCK_GEOMETRY, COMMUNITY_WALL_GEOMETRY, SEATS, findWalkPath, isWalkable as isRoomWalkable, isWalkableSegment, type ChartWallSide } from '../shared/classroom-layout';
import { isRefreshmentSelection, type RefreshmentSelection } from '../shared/refreshments';
import type { ChatMessageView, PlayerView } from './scene-types';
import { compactLayout } from './responsive';
import { FREE_CAMERA, FOLLOW_CAMERA, constrainInteriorCamera, followCameraPosition, followCameraFov, resetFollowCamera, frameInteriorChart, frameInteriorCommunity, panCameraPosition, tiltCameraPosition } from './office-camera';
import { formatSeoulTime, paintSeoulClock, paintPopularWall, popularPostAtUv, POPULAR_WALL_CANVAS, type PopularWallPost, type PopularWallState } from './office-displays';
import { createOfficeOcclusion } from './office-occlusion';
import { createOfficeAvatar, replaceOfficeAvatarAppearance, type OfficeAvatar } from './office-avatar';
import { appearanceKey, normalizeAvatarAppearance, type AvatarAppearance } from '../shared/avatar-appearance';
import { AVATAR_BODY_SCALE_Y, AVATAR_HAND_LOCAL_Y, AVATAR_SEATED_Y } from '../shared/avatar-rig';
import { avatarLabelY, createAvatarNameLabel, placeAvatarNameLabel } from './avatar-name-label';
import type { StockProfile } from '../shared/stock-profile';
import type { AvatarActionView } from '../shared/avatar-actions';
import { poseOfficeAvatar, poseOfficeShoulderLink, avatarJumpHeight, avatarConsumeWeight } from './office-avatar-pose';
import { officePixelRatio, createOfficeShadowBudget, freezeOfficeArchitecture, createChartTransformTracker, applyOfficeMovementDelta } from './render-performance';
import './pantry-interaction.css';

export type { ChatMessageView, PlayerView } from './scene-types';

type Callbacks = {
  isConnected?: () => boolean;
  onMove: (x: number, z: number) => void;
  onInteract: (target: 'chart', side?: ChartWallSide) => void;
  onSit: (seat: number) => void;
  onStand: () => void;
  onViewChange?: (view: 'room' | 'chart') => void;
  onFollowChange?: (following: boolean) => void;
  onCommunityPost?: (postId: string | null) => void;
  onRefreshments?: () => void;
  onJumpPortal?: () => void;
};
type RefreshmentTray = { group: THREE.Group; drink: THREE.Group; snack: THREE.Group; drinkRest: THREE.Vector3; snackRest: THREE.Vector3 };
type Avatar = {
  blob: THREE.Mesh;
  group: THREE.Group;
  model: OfficeAvatar;
  action: PlayerView['action'];
  shoulder: PlayerView['shoulder'];
  shoulderLocallyLeft: boolean;
  target: THREE.Vector3;
  arms: THREE.Group[];
  legs: THREE.Group[];
  lowerLegs: THREE.Group[];
  label: THREE.Sprite;
  ring: THREE.Mesh;
  nickname: string;
  stockProfile: StockProfile | null;
  color: number;
  appearance: AvatarAppearance;
  seat: number | null;
  bubble: { message: ChatMessageView; element: HTMLDivElement; width: number; height: number; visible: boolean; transform: string; opacity: string } | null;
  disconnected: boolean;
  refreshments: RefreshmentSelection | null;
  tray: THREE.Group;
  trayContent: RefreshmentTray | null;
};

const INK = 0x273442;
const CREAM = 0x364452;
const PALETTE = [0x23364f, 0x3b4653, 0x293845, 0x374b55, 0x424453, 0x2b424c];
const BOUNDS = ROOM_BOUNDS;
const ROOM = OFFICE_GEOMETRY;
const BACK_Z = ROOM.centerZ - ROOM.depth / 2;
const LEFT_X = -ROOM.width / 2;
const FRONT_Z = ROOM.centerZ + ROOM.depth / 2;
const WALL_CHART = WALL_CHART_GEOMETRY;
const ROOM_SCALE = OFFICE_EXPANSION_SCALE;

/** A procedural brokerage office. The server supplies every visitor. */
export function createClassroom(container: HTMLElement, callbacks: Callbacks) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd5dee5);
  scene.fog = new THREE.FogExp2(0xd5dee5, 0.004 / ROOM_SCALE);
  const camera = new THREE.PerspectiveCamera(FREE_CAMERA.fov, 1.5, 0.05, FREE_CAMERA.far);
  camera.position.copy(FREE_CAMERA.defaultPosition);
  camera.lookAt(FREE_CAMERA.defaultTarget.x, FREE_CAMERA.defaultTarget.y, FREE_CAMERA.defaultTarget.z);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: compactLayout.matches ? 'low-power' : 'high-performance' });
  renderer.setPixelRatio(officePixelRatio(window.devicePixelRatio, compactLayout.matches, container.clientWidth, container.clientHeight));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const shadowBudget = createOfficeShadowBudget();
  const chartTransforms = createChartTransformTracker();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.setAttribute('aria-label', '포듬 증권 사무실 자유 카메라. 드래그로 회전하고 오른쪽 드래그 또는 Shift 드래그로 화면을 이동하세요. 휠이나 두 손가락으로 이동·확대할 수 있습니다. 내 캐릭터 버튼으로 나를 찾고 차트 보기로 벽 화면을 볼 수 있어요.');
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.cursor = 'grab';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.style.outline = 'none';
  // setSize(..., false) changes the drawing buffer, including devicePixelRatio.
  // Keep the displayed canvas in CSS pixels so it matches the chart and tap rays.
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '1' });
  const cssScene = new THREE.Scene();
  const cssRenderer = new CSS3DRenderer();
  Object.assign(cssRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '0' });
  container.appendChild(cssRenderer.domElement);
  container.appendChild(renderer.domElement);
  const bubbleLayer = document.createElement('div');
  bubbleLayer.className = 'classroom-chat-bubbles';
  Object.assign(bubbleLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' });
  bubbleLayer.setAttribute('aria-hidden', 'true');
  container.appendChild(bubbleLayer);
  const seatHint = document.createElement('div');
  Object.assign(seatHint.style, { position: 'absolute', padding: '7px 10px', borderRadius: '9px', background: 'rgba(20,35,45,.94)', border: '1px solid #779ba3', color: '#e8f0e9', font: '600 12px "Malgun Gothic",sans-serif', whiteSpace: 'nowrap', pointerEvents: 'none', display: 'none' });
  bubbleLayer.appendChild(seatHint);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(FREE_CAMERA.defaultTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = compactLayout.matches ? 0.3 : 0.7;
  controls.panSpeed = 0.75;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = FREE_CAMERA.minPolarAngle;
  controls.maxPolarAngle = FREE_CAMERA.maxPolarAngle;
  controls.minDistance = FREE_CAMERA.minDistance;
  controls.maxDistance = FREE_CAMERA.maxDistance;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.update();

  const room = new THREE.Group();
  scene.add(room);
  const backWall = new THREE.Group();
  const rearWall = new THREE.Group();
  const leftWall = new THREE.Group();
  room.add(backWall, rearWall, leftWall);
  let architectureParent: THREE.Object3D = room;
  let canOccludeView = false;
  const viewOccluders = new Set<THREE.Mesh>();
  function place(object: THREE.Object3D, parent: THREE.Object3D, x: number, y: number, z: number) {
    // Architecture and shared collision coordinates use the same world units.
    object.position.set(x, y, z);
  }
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  const afternoonTint = new THREE.Color(0xc2ccd5);
  function material(color: number) {
    if (!materials.has(color)) {
      const muted = new THREE.Color(color).lerp(afternoonTint, 0.08);
      materials.set(color, new THREE.MeshStandardMaterial({ color: muted, roughness: 0.9 }));
    }
    return materials.get(color)!;
  }
  function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D = architectureParent) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    place(mesh, parent, x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (canOccludeView) viewOccluders.add(mesh);
    return mesh;
  }
  function cylinder(radius: number, height: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D = architectureParent, top = radius) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, radius, height, 16), material(color));
    place(mesh, parent, x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (canOccludeView) viewOccluders.add(mesh);
    return mesh;
  }
  function sphere(radius: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D = architectureParent, scale?: [number, number, number]) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material(color));
    place(mesh, parent, x, y, z);
    if (scale) mesh.scale.set(...scale);
    mesh.castShadow = true;
    parent.add(mesh);
    if (canOccludeView) viewOccluders.add(mesh);
    return mesh;
  }
  function planeTexture(canvas: HTMLCanvasElement) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
  function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d')!);
    return planeTexture(canvas);
  }
  function picture(w: number, h: number, texture: THREE.Texture, x: number, y: number, z: number, parent: THREE.Object3D = architectureParent) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
    place(mesh, parent, x, y, z);
    parent.add(mesh);
    if (canOccludeView) viewOccluders.add(mesh);
    return mesh;
  }
  const hemisphere = new THREE.HemisphereLight(0xe8f3ff, 0x526274, 2.4);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffd9a6, 2.7);
  sun.position.set(-25, 12, 8).multiplyScalar(ROOM_SCALE);
  sun.target.position.set(3, 0, -1.5).multiplyScalar(ROOM_SCALE);
  sun.castShadow = true;
  const shadowSize = compactLayout.matches ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -30 * ROOM_SCALE;
  sun.shadow.camera.right = 30 * ROOM_SCALE;
  sun.shadow.camera.top = 30 * ROOM_SCALE;
  sun.shadow.camera.bottom = -30 * ROOM_SCALE;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 90 * ROOM_SCALE;
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xbad3dd, 0.8);
  fill.position.set(12, 5, 9).multiplyScalar(ROOM_SCALE);
  scene.add(fill);

  // One bounded floor closes the room; camera movement never leaves its shell.
  const floorTexture = canvasTexture(1024, 1024, ctx => {
    ctx.fillStyle = '#617181'; ctx.fillRect(0, 0, 1024, 1024);
    const tones = ['#7e8b96', '#83909b', '#778591', '#87939d'];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      ctx.fillStyle = tones[(row * 3 + col) % tones.length];
      ctx.fillRect(col * 128 + 1, row * 128 + 1, 126, 126);
      ctx.strokeStyle = 'rgba(220,230,236,.06)'; ctx.lineWidth = 1;
      for (let fiber = 0; fiber < 12; fiber++) {
        ctx.beginPath(); ctx.moveTo(col * 128 + 7, row * 128 + fiber * 10 + 5);
        ctx.lineTo(col * 128 + 120, row * 128 + fiber * 10 + 5); ctx.stroke();
      }
    }
  });
  floorTexture.wrapS = THREE.RepeatWrapping; floorTexture.wrapT = THREE.RepeatWrapping;
  // Preserve the established tile size as the floor grows toward the rear wall.
  const originalTileDepth = (53.55 * Math.SQRT2 / 2) / (2.6 * ROOM_SCALE);
  floorTexture.repeat.set(2.6 * ROOM_SCALE, ROOM.depth / originalTileDepth);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.width, ROOM.depth), new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.93 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.015, ROOM.centerZ);
  floor.receiveShadow = true;
  room.add(floor);
  architectureParent = backWall;
  box(ROOM.width, ROOM.wallHeight, 0.18, CREAM, 0, ROOM.wallHeight / 2, BACK_Z);
  box(ROOM.width, 1.1, 0.05, 0x293745, 0, 0.55, BACK_Z + 0.12);
  box(ROOM.width, 0.045, 0.095, 0x8a9cae, 0, 1.12, BACK_Z + 0.17);
  box(ROOM.width + 0.075, 0.12, 0.16, 0x263544, 0, 0.08, BACK_Z + 0.22);
  architectureParent = leftWall;
  box(0.18, ROOM.wallHeight, ROOM.depth, CREAM, LEFT_X, ROOM.wallHeight / 2, ROOM.centerZ);
  box(0.18, 1.35, ROOM.depth, 0x314555, LEFT_X, 0.675, ROOM.centerZ);
  box(0.24, 0.1, ROOM.depth + 0.075, 0x95a7b8, LEFT_X + 0.02, 1.36, ROOM.centerZ);
  box(0.18, 0.58 * ROOM_SCALE, ROOM.depth, CREAM, LEFT_X, 4.21 * ROOM_SCALE, ROOM.centerZ);
  box(0.24, 0.12, ROOM.depth + 0.075, 0x667885, LEFT_X, 4.51 * ROOM_SCALE, ROOM.centerZ);
  box(0.21, 0.12, ROOM.depth + 0.075, 0x354b54, LEFT_X + 0.14, 0.08, ROOM.centerZ);

  // Sunset panes remain visible from inside the fully enclosed office.
  const skyTexture = canvasTexture(128, 256, ctx => {
    const sky = ctx.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#b9d2db'); sky.addColorStop(0.68, '#f0d8aa'); sky.addColorStop(1, '#d7cca2');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 9; i++) {
      const x = i * 17 - 9, height = 47 + ((i * 37) % 85);
      ctx.fillStyle = i % 2 ? '#8198a8' : '#90a5b1'; ctx.fillRect(x, 256 - height, 15, height);
      ctx.fillStyle = '#c9d6d8';
      for (let row = 0; row < height / 10 - 1; row++) for (let column = 0; column < 2; column++) ctx.fillRect(x + 3 + column * 6, 260 - height + row * 10, 3, 5);
    }
    ctx.fillStyle = 'rgba(255,247,223,.5)'; ctx.beginPath(); ctx.ellipse(37, 52, 30, 8, -0.08, 0, Math.PI * 2); ctx.fill();
  });
  // Keep architectural rows at a human scale throughout the current room depth.
  // The expanded rear area gets windows and ceiling fixtures, not a blank shell.
  const windowCount = Math.max(2, Math.round(ROOM.depth / 12.1));
  const windowPositions = Array.from({ length: windowCount }, (_, index) => BACK_Z + 6.8 + index * (ROOM.depth - 13.6) / (windowCount - 1));
  const windowSpan = 1.85;
  for (const z of windowPositions) {
    box(0.2, 2.58 * ROOM_SCALE, 5.31 * windowSpan, 0x576976, LEFT_X + 0.03, 2.66 * ROOM_SCALE, z);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(4.95 * windowSpan, 2.3 * ROOM_SCALE), new THREE.MeshBasicMaterial({ map: skyTexture }));
    sky.rotation.y = Math.PI / 2;
    place(sky, leftWall, LEFT_X + 0.15, 2.67 * ROOM_SCALE, z);
    leftWall.add(sky);
    for (const dz of [-1.72, 0, 1.72]) box(0.17, 2.5 * ROOM_SCALE, 0.075, 0x8d9ba6, LEFT_X + 0.24, 2.67 * ROOM_SCALE, z + dz * windowSpan);
    for (const y of [1.45, 2.65, 3.88]) box(0.18, 0.07, 5.25 * windowSpan, 0x8d9ba6, LEFT_X + 0.25, y * ROOM_SCALE, z);
    box(0.54, 0.12, 5.46 * windowSpan, 0x7a8a93, LEFT_X + 0.27, 1.42 * ROOM_SCALE, z);
    // Slim roller-blind housings, instead of school curtains.
    box(0.24, 0.18, 5.28 * windowSpan, 0xa4b1bb, LEFT_X + 0.37, 3.87 * ROOM_SCALE, z);
  }
  const afternoonSun = new THREE.Mesh(new THREE.CircleGeometry(0.25 * ROOM_SCALE, 32), new THREE.MeshBasicMaterial({ color: 0xffedbf }));
  afternoonSun.rotation.y = Math.PI / 2; place(afternoonSun, leftWall, LEFT_X + 0.17, 3.2 * ROOM_SCALE, windowPositions[0]! + 0.3); leftWall.add(afternoonSun);
  architectureParent = room;
  const sunPatchMaterial = new THREE.MeshBasicMaterial({ color: 0xffdf95, transparent: true, opacity: 0.14, depthWrite: false });
  for (const z of windowPositions) {
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(10.95 * ROOM_SCALE, 3.45 * ROOM_SCALE), sunPatchMaterial);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = -0.38;
    patch.position.set(LEFT_X + 6 * ROOM_SCALE, 0.022, z + 0.45 * ROOM_SCALE);
    room.add(patch);
  }

  // Right wall, rear entry wall and ceiling complete a genuine interior.
  architectureParent = room;
  box(0.18, ROOM.wallHeight, ROOM.depth, 0x415361, -LEFT_X, ROOM.wallHeight / 2, ROOM.centerZ);
  box(ROOM.width, ROOM.wallHeight, 0.18, 0x415361, 0, ROOM.wallHeight / 2, FRONT_Z);
  box(ROOM.width, 0.18, ROOM.depth, 0xaab9c5, 0, ROOM.wallHeight, ROOM.centerZ);
  box(0.12, 1.1, ROOM.depth, 0x293745, -LEFT_X - 0.12, 0.55, ROOM.centerZ);
  box(ROOM.width, 1.1, 0.12, 0x293745, 0, 0.55, FRONT_Z - 0.12);
  box(0.1, 0.045, ROOM.depth, 0x8a9cae, -LEFT_X - 0.18, 1.12, ROOM.centerZ);
  box(ROOM.width, 0.045, 0.1, 0x8a9cae, 0, 1.12, FRONT_Z - 0.18);
  for (const z of windowPositions) {
    box(0.035, 7.9 * ROOM_SCALE, 0.055, 0x718697, -LEFT_X - 0.11, 5.9 * ROOM_SCALE, z);
    box(0.04, 1.65 * ROOM_SCALE, 3.1 * ROOM_SCALE, 0x2c4558, -LEFT_X - 0.13, 3.1 * ROOM_SCALE, z);
  }
  // Leave the rear display's full width clear; the entry fits beside its bezel.
  const entryX = ROOM.width / 2 - 4.2;
  box(2.7, 3.35, 0.12, 0x728b9d, entryX, 1.69, FRONT_Z - 0.16);
  box(2.43, 3.08, 0.08, 0x294657, entryX, 1.68, FRONT_Z - 0.26);
  box(2.1, 1.72, 0.045, 0x7895a8, entryX, 2.22, FRONT_Z - 0.32);
  box(0.07, 0.5, 0.08, 0xd2dce2, entryX - 0.9, 1.5, FRONT_Z - 0.38);
  const roomSign = canvasTexture(768, 192, ctx => {
    ctx.fillStyle = '#263d51'; ctx.fillRect(0, 0, 768, 192); ctx.textAlign = 'center';
    ctx.fillStyle = '#bdd4e2'; ctx.font = '500 53px sans-serif'; ctx.fillText('PODEUM SECURITIES', 384, 85);
    ctx.fillStyle = '#82a6bf'; ctx.font = '25px sans-serif'; ctx.fillText('MARKET LOUNGE', 384, 139);
  });
  const entrySign = picture(6, 1.5, roomSign, entryX, 4.6, FRONT_Z - 0.12); entrySign.rotation.y = Math.PI;
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xe7f2ff });
  for (const x of [-9, 0, 9]) for (const z of windowPositions) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4 * ROOM_SCALE, 0.05, 0.5 * ROOM_SCALE), lampMaterial);
    lamp.position.set(x * ROOM_SCALE, ROOM.wallHeight - 0.12, z); room.add(lamp);
  }
  const ceilingFill = new THREE.PointLight(0xd5e8ff, 18 * ROOM_SCALE ** 2, 38 * ROOM_SCALE, 2); ceilingFill.position.set(0, 8.5 * ROOM_SCALE, ROOM.centerZ); scene.add(ceilingFill);

  // The wall monitor contains a real DOM chart, projected by the same camera.
  // A zero-alpha, depth-tested aperture reveals the projected chart below.
  // Foreground people/furniture retain their depth and naturally cover the chart.
  function createChartWall(side: ChartWallSide, geometry: Omit<typeof WALL_CHART_GEOMETRY, 'yaw'> & { yaw: number }, parent: THREE.Group) {
    const inward = Math.cos(geometry.yaw);
    box(geometry.width + 0.3, geometry.height + 0.3, 0.2, 0x172330, geometry.x, geometry.y, geometry.z - inward * 0.18, parent);
    box(geometry.width + 0.12, geometry.height + 0.12, 0.06, 0x668295, geometry.x, geometry.y, geometry.z - inward * 0.05, parent);
    const aperture = new THREE.Mesh(new THREE.PlaneGeometry(geometry.width, geometry.height), new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending, depthWrite: true, side: THREE.FrontSide, fog: false, toneMapped: false }));
    // Each aperture, iframe surface and hit plane uses the same orientation.
    // Keep the aperture .02 units roomward of its bezel on either wall.
    aperture.position.set(geometry.x, geometry.y, geometry.z); aperture.rotation.y = geometry.yaw;
    aperture.renderOrder = 1; parent.add(aperture);
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(geometry.width, geometry.height), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(aperture.position); hit.position.z += inward * 0.01; hit.rotation.copy(aperture.rotation);
    hit.userData.interaction = 'chart'; hit.userData.chartSide = side; parent.add(hit);
    const host = document.createElement('div');
    host.className = 'office-wall-chart'; host.dataset.chartSide = side; host.inert = true;
    host.setAttribute('aria-hidden', 'true');
    // The camera stays between the screens. Depth-tested WebGL apertures reveal
    // these fixed CSS3D surfaces without angle-based show/hide or DOM remounting.
    Object.assign(host.style, { position: 'relative', width: `${geometry.pixelWidth}px`, height: `${geometry.pixelHeight}px`, background: '#101b2b', overflow: 'visible', pointerEvents: 'none', color: '#a9bed2', font: '500 24px sans-serif' });
    const placeholder = document.createElement('div'); placeholder.className = 'office-wall-chart-placeholder';
    Object.assign(placeholder.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', height: '100%', letterSpacing: '4px' });
    placeholder.textContent = `${side === 'front' ? 'FRONT' : 'REAR'} MARKET SCREEN · 차트 연결 중`; host.appendChild(placeholder);
    const object = new CSS3DObject(host); object.position.copy(aperture.position); object.rotation.copy(aperture.rotation);
    object.scale.setScalar(geometry.width / geometry.pixelWidth); cssScene.add(object);
    return { host, object, hit, aperture, geometry };
  }
  const chartWalls = {
    front: createChartWall('front', WALL_CHART, backWall),
    rear: createChartWall('rear', REAR_WALL_CHART_GEOMETRY, rearWall),
  };
  const boardHits = [chartWalls.front.hit, chartWalls.rear.hit];
  const chartPointerStyle = document.createElement('style');
  chartPointerStyle.textContent = '.office-wall-chart, .office-wall-chart * { pointer-events: none !important; } .office-wall-chart:has(> :nth-child(2)) > .office-wall-chart-placeholder { display: none !important; }';
  cssRenderer.domElement.appendChild(chartPointerStyle);
  function setMarketLabel(label: string, side: ChartWallSide = 'front') {
    // The chart now begins near the floor; a separate front-facing label there
    // would cover the lower candles. Keep its description on the chart host.
    chartWalls[side].host.setAttribute('aria-label', Array.from(label).slice(0, 120).join(''));
  }
  setMarketLabel('PODEUM SECURITIES  /  MARKET LOUNGE');
  setMarketLabel('PODEUM SECURITIES  /  CRYPTO LOUNGE', 'rear');
  const boardLight = new THREE.PointLight(0xb9dfff, 2.5 * ROOM_SCALE ** 2, 13 * ROOM_SCALE, 2);
  boardLight.position.set(-1.5 * ROOM_SCALE, 5.4 * ROOM_SCALE, BACK_Z + 3 * ROOM_SCALE); scene.add(boardLight);
  architectureParent = room;

  const clock = WALL_CLOCK_GEOMETRY;
  const clockCanvas = document.createElement('canvas'); clockCanvas.width = 1280; clockCanvas.height = 286;
  const clockTexture = planeTexture(clockCanvas);
  const clockFace = picture(clock.width, clock.height, clockTexture, clock.x, clock.y, clock.z, backWall);
  (clockFace.material as THREE.MeshBasicMaterial).toneMapped = false;
  box(clock.width + 0.22, clock.height + 0.22, 0.16, 0x172330, clock.x, clock.y, clock.z - 0.12, backWall);
  let serverTimeOffset = 0, paintedClockSecond = -1;
  function updateWallClock() {
    const now = Date.now() + serverTimeOffset, second = Math.floor(now / 1000);
    if (second === paintedClockSecond) return;
    paintedClockSecond = second;
    const text = formatSeoulTime(now);
    paintSeoulClock(clockCanvas.getContext('2d')!, text); clockTexture.needsUpdate = true;
    clockFace.userData.seoulTime = text;
  }
  function setServerTime(timestamp: number) {
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return;
    serverTimeOffset = timestamp - Date.now(); updateWallClock();
  }
  updateWallClock();

  const community = COMMUNITY_WALL_GEOMETRY;
  const communityCanvas = document.createElement('canvas'); communityCanvas.width = POPULAR_WALL_CANVAS.width; communityCanvas.height = POPULAR_WALL_CANVAS.height;
  const communityTexture = planeTexture(communityCanvas);
  const communityFace = picture(community.width, community.height, communityTexture, community.x, community.y, community.z, room);
  communityFace.rotation.y = -Math.PI / 2;
  (communityFace.material as THREE.MeshBasicMaterial).toneMapped = false;
  communityFace.userData.community = true;
  box(0.14, community.height + 0.3, community.width + 0.3, 0x172330, community.x + 0.12, community.y, community.z, room);
  let popularPosts: PopularWallPost[] = [];
  function setPopularPosts(posts: readonly PopularWallPost[], state: PopularWallState = 'ready') {
    popularPosts = posts.slice(0, 3).map(post => ({ ...post }));
    paintPopularWall(communityCanvas.getContext('2d')!, popularPosts, state); communityTexture.needsUpdate = true;
  }
  setPopularPosts([], 'loading');

  // Only furnishing can dissolve for camera clearance. The closed room shell,
  // market display and its depth/interaction planes stay intact.
  canOccludeView = true;

  function plant(x: number, z: number, y = 0, size = 1, parent: THREE.Object3D = room) {
    const group = new THREE.Group(); place(group, parent, x, y, z); group.scale.setScalar(size); parent.add(group);
    cylinder(0.3, 0.45, 0x667b89, 0, 0.24, 0, group, 0.37);
    cylinder(0.35, 0.035, 0x3d4849, 0, 0.47, 0, group);
    cylinder(0.045, 0.73, 0x758768, 0, 0.84, 0, group);
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4;
      const leaf = sphere(0.24, [0x5d8a72, 0x7a9b80, 0x51785f][i % 3], Math.cos(angle) * 0.23, 0.65 + (i % 4) * 0.19, Math.sin(angle) * 0.23, group, [0.9, 0.45, 1.7]);
      leaf.rotation.set(0.3, -angle, -0.35);
    }
  }
  plant(ROOM_FEATURES.teacher.x, ROOM_FEATURES.teacher.z, 0, 1.2);
  plant(ROOM_FEATURES.cornerPlant.x, ROOM_FEATURES.cornerPlant.z, 0, 1.2); plant(LEFT_X + 0.65, -2.5, 1.49 * ROOM_SCALE, 0.48, leftWall);
  const cabinet = ROOM_FEATURES.cabinet;
  box(1.8, 1.05, 0.65, 0x405363, cabinet.x, 0.53, cabinet.z);
  box(1.86, 0.08, 0.7, 0x9baeb9, cabinet.x, 1.08, cabinet.z);
  for (const dx of [-0.43, 0.43]) for (const y of [0.29, 0.76]) {
    box(0.78, 0.41, 0.035, 0x617789, cabinet.x + dx, y, cabinet.z + 0.345);
    box(0.22, 0.025, 0.04, 0xc2cdd3, cabinet.x + dx, y + 0.1, cabinet.z + 0.375);
  }
  plant(cabinet.x - 0.55, cabinet.z, 1.13, 0.55);

  // Human-scale lounge sofas face the market wall with a broad center aisle.
  const seatHitboxes: THREE.Mesh[] = [];
  const seatHitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  for (const sofa of SOFAS) {
    const upholstery = sofa.id % 2 ? 0x426770 : 0x3b5369;
    box(sofa.width, 0.3, sofa.depth, 0x223b4c, sofa.x, 0.42, sofa.z);
    box(sofa.width - 0.25, 0.85, 0.25, upholstery, sofa.x, 1.02, sofa.z + 0.65);
    for (const side of [-1, 1]) {
      box(0.35, 0.69, sofa.depth, upholstery, sofa.x + side * (sofa.width / 2 - 0.17), 0.78, sofa.z);
      for (const dz of [-0.57, 0.57]) cylinder(0.065, 0.29, 0x78858e, sofa.x + side * (sofa.width / 2 - 0.4), 0.145, sofa.z + dz);
    }
    for (const seat of SEATS.filter(seat => seat.sofaId === sofa.id)) {
      box(1.3, 0.16, 1.2, upholstery, seat.x, 0.64, seat.z - 0.04);
      box(1.3, 0.6, 0.2, sofa.id % 2 ? 0x5d7b83 : 0x526c80, seat.x, 1.04, sofa.z + 0.46);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.15), seatHitMaterial);
      hit.position.set(seat.x, 0.75, seat.z); hit.userData.seat = seat.id;
      room.add(hit); seatHitboxes.push(hit);
    }
    const sofaLabel = canvasTexture(256, 96, ctx => {
      ctx.fillStyle = '#b9d8dd'; ctx.font = '600 40px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('LOUNGE ' + String.fromCharCode(65 + sofa.id), 128, 65);
    });
    const label = picture(2.05, 0.77, sofaLabel, sofa.x, 0.38, sofa.z - sofa.depth / 2 - 0.015, room);
    label.rotation.y = Math.PI;
  }

  for (const table of LOUNGE_TABLES) {
    cylinder(table.radius, 0.13, 0xb5a38a, table.x, 0.98, table.z);
    cylinder(0.16, 0.87, 0x526773, table.x, 0.48, table.z);
    cylinder(0.65, 0.07, 0x344b5b, table.x, 0.075, table.z);
    box(0.43, 0.025, 0.6, 0x36566a, table.x - 0.45, 1.06, table.z + 0.15);
    box(0.39, 0.03, 0.56, 0xc4c5b3, table.x - 0.42, 1.085, table.z + 0.12);
    cylinder(0.12, 0.24, 0xd7e1df, table.x + 0.42, 1.17, table.z - 0.27);
    for (const seat of SEATS.filter(seat => seat.tableId === table.id)) {
      const chair = new THREE.Group(); chair.position.set(seat.x, 0, seat.z); chair.rotation.y = seat.yaw; room.add(chair);
      box(0.72, 0.12, 0.68, 0x486b76, 0, 0.66, 0, chair);
      box(0.7, 0.62, 0.12, 0x597c87, 0, 1.01, -0.29, chair);
      for (const x of [-0.27, 0.27]) for (const z of [-0.24, 0.24]) cylinder(0.035, 0.58, 0x8d9da5, x, 0.3, z, chair);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.9), seatHitMaterial);
      hit.position.set(seat.x, 0.75, seat.z); hit.userData.seat = seat.id;
      room.add(hit); seatHitboxes.push(hit);
    }
  }

  function refreshmentTray(selection: RefreshmentSelection): RefreshmentTray {
    const tray = new THREE.Group();
    const drink = new THREE.Group(), snack = new THREE.Group(); tray.add(drink, snack);
    const drinkRest = new THREE.Vector3(selection.snack ? -0.23 : 0, 0.03, -0.02);
    const snackRest = new THREE.Vector3(selection.drink ? 0.15 : 0, 0.075, 0.01);
    drink.position.copy(drinkRest); snack.position.copy(snackRest);
    box(0.8, 0.035, 0.5, 0xa88d69, 0, 0, 0, tray);
    for (const side of [-1, 1]) box(0.025, 0.055, 0.5, 0xc2a47e, side * 0.39, 0.02, 0, tray);
    if (selection.drink) {
    const hotDrink = selection.drink === 'coffee' || selection.drink === 'tea';
    cylinder(0.085, 0.19, hotDrink ? 0xf2eee4 : 0xa6d5e7, 0, 0.095, 0, drink);
    const drinkColor = { coffee: 0x533120, tea: 0x9a8648, juice: 0xe7a72e, water: 0x8dc9e4 }[selection.drink];
    cylinder(0.072, 0.012, drinkColor, 0, 0.189, 0, drink);
    if (hotDrink) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.017, 8, 16), material(0xf2eee4));
      handle.position.set(-0.09, 0.115, 0); drink.add(handle);
      if (canOccludeView) viewOccluders.add(handle);
    }
    }
    if (selection.snack) cylinder(0.19, 0.025, 0xecede8, snackRest.x, 0.04, 0.01, tray);
    if (selection.snack === 'cookie') {
      cylinder(0.12, 0.04, 0xc69758, 0, 0, 0, snack);
      for (const [dx, dz] of [[-0.05, 0.02], [0.04, -0.04], [0.03, 0.07], [-0.02, -0.06]]) sphere(0.015, 0x513722, dx, 0.025, dz, snack, [1, 0.4, 1]);
    } else if (selection.snack === 'donut') {
      const donut = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.039, 10, 20), material(0xdbac72));
      donut.rotation.x = Math.PI / 2; donut.position.set(0, 0.015, 0); snack.add(donut);
      if (canOccludeView) viewOccluders.add(donut);
      const icing = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.026, 8, 20), material(0xe4b9be));
      icing.rotation.x = Math.PI / 2; icing.position.set(0, 0.038, 0); snack.add(icing);
      if (canOccludeView) viewOccluders.add(icing);
    } else if (selection.snack === 'sandwich') {
      for (const [y, color] of [[0, 0xe3c68b], [0.025, 0x71a360], [0.045, 0xcc735e], [0.07, 0xe7d2a4]]) box(0.22, 0.027, 0.17, color, 0, y, 0, snack);
    }
    return {group: tray, drink, snack, drinkRest, snackRest};
  }

  // The refreshment counter stands below the windows, facing into the lounge.
  const station = REFRESHMENT_STATION;
  box(station.width, 1.03, station.depth, 0x536b77, station.x, 0.52, station.z);
  box(station.width + 0.2, 0.12, station.depth + 0.18, 0xd1c5ad, station.x, 1.1, station.z);
  for (const dz of [-2.65, -0.9, 0.9, 2.65]) {
    box(0.03, 0.78, 1.58, 0x667f89, station.x + station.width / 2 + 0.02, 0.55, station.z + dz);
    box(0.05, 0.05, 0.46, 0xb1bcc0, station.x + station.width / 2 + 0.04, 0.84, station.z + dz);
  }
  box(0.8, 0.81, 1.12, 0x273c49, station.x, 1.56, station.z - 2.45);
  box(0.055, 0.28, 0.61, 0xb5c7cc, station.x + 0.42, 1.69, station.z - 2.45);
  box(0.3, 0.04, 0.48, 0x9faeb4, station.x + 0.47, 1.24, station.z - 2.45);
  cylinder(0.075, 0.16, 0xefede5, station.x + 0.44, 1.36, station.z - 2.45);
  for (const [dz, color] of [[-0.7, 0xdfa935], [0, 0x88b9cd], [0.7, 0x9ba46c]]) {
    cylinder(0.19, 0.62, color, station.x - 0.15, 1.47, station.z + dz);
    cylinder(0.2, 0.04, 0x5d6f7a, station.x - 0.15, 1.8, station.z + dz);
  }
  const counterTray = refreshmentTray({ drink: 'juice', snack: 'cookie' }).group; counterTray.position.set(station.x + 0.06, 1.2, station.z + 1.8); counterTray.rotation.y = Math.PI / 2; room.add(counterTray);
  const extraTray = refreshmentTray({ drink: 'tea', snack: 'sandwich' }).group; extraTray.position.set(station.x + 0.06, 1.2, station.z + 2.8); extraTray.rotation.y = Math.PI / 2; room.add(extraTray);
  const counterSign = canvasTexture(1024, 256, ctx => {
    ctx.fillStyle = '#183e48'; ctx.fillRect(0, 0, 1024, 256); ctx.textAlign = 'center';
    ctx.fillStyle = '#e1ece9'; ctx.font = '600 68px \"Malgun Gothic\",sans-serif'; ctx.fillText('커피 & 스낵바', 512, 113);
    ctx.fillStyle = '#a4d6cc'; ctx.font = '42px \"Malgun Gothic\",sans-serif'; ctx.fillText('터치해서 고르기 · 가까이에서 E', 512, 197);
  });
  const refreshmentSign = picture(6.2, 1.55, counterSign, station.x - 0.6, 2.85, station.z, room); refreshmentSign.rotation.y = Math.PI / 2;
  const refreshmentHit = new THREE.Mesh(new THREE.BoxGeometry(station.width + 0.5, 3.6, station.depth + 0.3), new THREE.MeshBasicMaterial({ visible: false }));
  refreshmentHit.position.set(station.x, 1.8, station.z); refreshmentHit.userData.refreshments = true; room.add(refreshmentHit);
  const jumpPortal = createJumpPortal(); room.add(jumpPortal.group);
  // A touch screen has no E key to press: the prompt itself is the button.
  const jumpPromptText = matchMedia('(pointer:coarse)').matches ? '♟ 게임룸 입장' : '♟ 게임룸 입장 · E';
  const jumpInteract = document.createElement('button'); jumpInteract.type='button'; jumpInteract.className='pantry-interact'; jumpInteract.hidden=true; jumpInteract.textContent=jumpPromptText; jumpInteract.onclick=()=>approachJumpPortal(); container.append(jumpInteract);
  const pantryInteract=document.createElement('button');
  pantryInteract.type='button'; pantryInteract.className='pantry-interact'; pantryInteract.hidden=true;
  pantryInteract.textContent='☕ 스낵바 이용 · E'; pantryInteract.setAttribute('aria-label','가까운 스낵바에서 음료와 간식 고르기');
  pantryInteract.onclick=()=>{if(approachingRefreshments){resumeDestination=null;clearMovement();}else approachRefreshments();};
  container.append(pantryInteract);

  // Batch immutable colored meshes by material. Hundreds of desk components
  // become a few dozen draws, leaving room for the animated visitors.
  room.updateMatrixWorld(true);
  canOccludeView = false;
  const furnitureBatch = new THREE.Group(); room.add(furnitureBatch);
  const batches = new Map<THREE.Object3D, Map<THREE.Material, THREE.Mesh[]>>();
  const staticMaterials = new Set(materials.values());
  room.traverse(object => {
    if (object instanceof THREE.Mesh && staticMaterials.has(object.material)) {
      let owner: THREE.Object3D = room;
      for (let ancestor = object.parent; ancestor && ancestor !== room; ancestor = ancestor.parent) {
        if (ancestor === backWall || ancestor === rearWall || ancestor === leftWall) { owner = ancestor; break; }
      }
      if (viewOccluders.has(object)) owner = furnitureBatch;
      const ownerBatches = batches.get(owner) ?? new Map<THREE.Material, THREE.Mesh[]>();
      const list = ownerBatches.get(object.material) ?? [];
      list.push(object); ownerBatches.set(object.material, list); batches.set(owner, ownerBatches);
    }
  });
  for (const [owner, ownerBatches] of batches) {
    for (const [mat, meshes] of ownerBatches) {
      if (meshes.length < 2) continue;
      const transformed = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      const merged = mergeGeometries(transformed, false);
      transformed.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = true; mesh.receiveShadow = true;
      meshes.forEach(original => { viewOccluders.delete(original); original.removeFromParent(); original.geometry.dispose(); });
      owner.add(mesh);
      if (owner === furnitureBatch) viewOccluders.add(mesh);
    }
  }
  const viewClearance = createOfficeOcclusion([...viewOccluders]);
  const viewFocus = new THREE.Vector3();
  // The immutable room is complete. Later avatars, limbs and markers retain
  // their normal transform updates; the large architecture need not repeat it.
  freezeOfficeArchitecture(room);

  // The room's one shadow map spans the whole office, so a figure's cast shadow
  // is a soft smear. A shared blob (one texture, one material, one extra draw
  // per visitor) pins each character to the floor; other visitors' invisible
  // selection rings are no longer drawn, so the draw count does not grow.
  const blobCanvas = document.createElement('canvas'); blobCanvas.width = blobCanvas.height = 64;
  const blobContext = blobCanvas.getContext('2d')!, blobGradient = blobContext.createRadialGradient(32, 32, 2, 32, 32, 31);
  blobGradient.addColorStop(0, 'rgba(255,255,255,1)'); blobGradient.addColorStop(.55, 'rgba(255,255,255,.55)'); blobGradient.addColorStop(1, 'rgba(255,255,255,0)');
  blobContext.fillStyle = blobGradient; blobContext.fillRect(0, 0, 64, 64);
  const blobTexture = new THREE.CanvasTexture(blobCanvas), blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // The blob lies 3 mm above the floor. From the far end of the free camera
  // that is less than one depth step, so it is pulled forward in depth instead.
  const blobMaterial = new THREE.MeshBasicMaterial({ map: blobTexture, color: 0x16222f, transparent: true, opacity: .34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const BLOB_WIDTH = .84, BLOB_DEPTH = .66, BLOB_Y = .018;
  function createAvatar(nickname: string, color: number, mine: boolean, stockProfile: StockProfile | null, appearance: AvatarAppearance, seed?: string): Avatar {
    const model = createOfficeAvatar(color, appearance, seed);
    const {group, arms, legs, lowerLegs} = model;
    const label = createAvatarNameLabel(nickname, mine, stockProfile, avatarLabelY(model)); group.add(label);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 32), new THREE.MeshBasicMaterial({ color: 0x73b8eb, transparent: true, opacity: mine ? 0.8 : 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; ring.visible = mine; group.add(ring);
    const blob = new THREE.Mesh(blobGeometry, blobMaterial); blob.position.y = BLOB_Y; blob.scale.set(BLOB_WIDTH, 1, BLOB_DEPTH); group.add(blob);
    const tray = new THREE.Group(); tray.position.set(0, 0.86 * AVATAR_BODY_SCALE_Y, 0.4 * AVATAR_BODY_SCALE_Y); tray.visible = false; group.add(tray);
    group.rotation.y = 0.58; room.add(group);
    return { blob, group, model, action: null, shoulder: null, shoulderLocallyLeft: false, target: new THREE.Vector3(), arms, legs, lowerLegs, label, ring, nickname, stockProfile, color, appearance, seat: null, bubble: null, disconnected: false, refreshments: null, tray, trayContent: null };
  }
  const avatars = new Map<string, Avatar>();
  // Building a figure takes a few milliseconds on a desktop and tens on a
  // phone. A full room arriving at once is therefore spread over frames: mine
  // at once, the others a couple per frame, nearest first. Until its turn a
  // visitor is only the latest roster entry, kept up to date by the deltas.
  const pendingPlayers = new Map<string, PlayerView>();
  const latestChats = new Map<string, ChatMessageView>();
  let selfId: string | null = null;
  // Input prediction uses a monotonic clock, independently of network clock updates.
  // null holds the ground pose until a delayed server jump finishes; undefined
  // returns ownership to the authoritative action stream.
  let selfJumpPrediction: AvatarActionView | null | undefined;
  let frameServerNow = 0, frameLocalNow = 0;
  function predictJump(action: AvatarActionView | null | undefined) {
    selfJumpPrediction = action;
    const self = selfId ? avatars.get(selfId) : undefined;
    if (action && self?.shoulder) self.shoulderLocallyLeft = true;
    shadowBudget.invalidate();
  }
  function renderedAction(avatar: Avatar) {
    if (selfId && avatars.get(selfId) === avatar && selfJumpPrediction !== undefined) {
      if (selfJumpPrediction) return selfJumpPrediction;
      if (avatar.action?.kind === 'jump') return null;
    }
    return avatar.action;
  }
  let selfNeedsSync = true;
  let firstJoinFocus = false;
  let path: THREE.Vector2[] = [];
  let resumeDestination: THREE.Vector2 | null = null;
  let approachingRefreshments = false;
  let approachingJumpPortal = false;
  let jumpPortalLatched = false;
  let pendingSeatAction: { kind: 'sit' | 'stand' | 'external'; seat?: number; expires: number } | null = null;
  let dirtyPosition = false;
  let lastSent = 0;
  let disposed = false;
  let renderingActive = true;
  let view: 'room' | 'chart' = 'room';
  let followingSelf = true;
  const followAim = { elevation: 0 };
  let chartPresetActive = false;
  let activeChartSide: ChartWallSide = 'front';
  let communityPresetActive = false;
  const keys = new Set<string>();
  const touchKeys = new Set<string>();
  /** Analog stick input in screen space: x right, z toward the viewer; length 0..1. */
  const touchStick = { x: 0, z: 0 };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 32), new THREE.MeshBasicMaterial({ color: 0x95d8dc, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.035; marker.visible = false; room.add(marker);
  const seatHighlight = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.49, 40), new THREE.MeshBasicMaterial({ color: 0x9ad8cf, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  seatHighlight.rotation.x = -Math.PI / 2; seatHighlight.visible = false; room.add(seatHighlight);

  function clearMovement() {
    keys.clear(); touchKeys.clear(); touchStick.x = touchStick.z = 0; path = []; dirtyPosition = false; marker.visible = false; approachingRefreshments = false; approachingJumpPortal = false;
  }
  function prepareShoulderLink() {
    const self = selfId ? avatars.get(selfId) : undefined;
    // Commit the last predicted step before the server chooses a nearby group.
    if (self && dirtyPosition && self.seat === null) {
      callbacks.onMove(Math.round(self.group.position.x * 100) / 100, Math.round(self.group.position.z * 100) / 100);
      lastSent = performance.now();
    }
    resumeDestination = null; clearMovement();
  }
  function correctPosition(x: number, z: number) {
    const self = selfId ? avatars.get(selfId) : undefined;
    if (!self || !Number.isFinite(x) || !Number.isFinite(z)) return;
    shadowBudget.invalidate();
    self.group.position.x = THREE.MathUtils.clamp(x, BOUNDS.minX, BOUNDS.maxX);
    self.group.position.z = THREE.MathUtils.clamp(z, BOUNDS.minZ, BOUNDS.maxZ);
    self.target.copy(self.group.position);
    path = []; dirtyPosition = false; marker.visible = false; lastSent = performance.now();
    trackSelf();
  }
  function setMoveStick(x: number, z: number) {
    const length = Number.isFinite(x) && Number.isFinite(z) ? Math.hypot(x, z) : 0;
    if (length < .01) { touchStick.x = touchStick.z = 0; return; }
    if (!renderingActive || document.hidden || !selfId || modalOpen() || focusedInput(document.activeElement) || pendingSeatAction?.kind === 'sit' || pendingSeatAction?.kind === 'external') { touchStick.x = touchStick.z = 0; return; }
    if (avatars.get(selfId)?.seat !== null) requestStand();
    const scale = length > 1 ? 1 / length : 1;
    touchStick.x = x * scale; touchStick.z = z * scale; path = []; approachingRefreshments = false; approachingJumpPortal = false;
  }
  function setMoveInput(direction: 'forward' | 'back' | 'left' | 'right', pressed: boolean) {
    const key = { forward: 'w', back: 's', left: 'a', right: 'd' }[direction];
    if (!key) return;
    if (!pressed) { touchKeys.delete(key); return; }
    if (!renderingActive || document.hidden || !selfId || modalOpen() || focusedInput(document.activeElement) || pendingSeatAction?.kind === 'sit' || pendingSeatAction?.kind === 'external') return;
    if (avatars.get(selfId)?.seat !== null) requestStand();
    touchKeys.add(key); path = []; approachingRefreshments = false; approachingJumpPortal = false;
  }
  function stopMovement() {
    clearMovement();
    // The accessible DOM seat picker calls this before sending its own request.
    // Hold local movement until the authoritative seat change or an error.
    if (!pendingSeatAction) pendingSeatAction = { kind: 'external', expires: performance.now() + 4000 };
  }
  function cancelSeatAction() { pendingSeatAction = null; resumeDestination = null; clearMovement(); }
  function requestSit(seat: number) {
    if (!selfId || pendingSeatAction || !SEATS.some(candidate => candidate.id === seat)) return;
    if (avatars.get(selfId)?.seat === seat) { requestStand(); return; }
    stopMovement(); resumeDestination = null;
    pendingSeatAction = { kind: 'sit', seat, expires: performance.now() + 4000 };
    callbacks.onSit(seat);
  }
  function requestStand(destination: THREE.Vector2 | null = null) {
    const self = selfId ? avatars.get(selfId) : undefined;
    if (!self || self.seat === null) return;
    if (pendingSeatAction) { if (pendingSeatAction.kind === 'stand' && destination) resumeDestination = destination; return; }
    stopMovement(); resumeDestination = destination;
    pendingSeatAction = { kind: 'stand', expires: performance.now() + 4000 };
    callbacks.onStand();
  }
  function approachRefreshments() {
    const self = selfId ? avatars.get(selfId) : undefined;
    if (!self || !renderingActive || modalOpen() || callbacks.isConnected?.()===false) return;
    if(self.seat===null&&Math.hypot(self.group.position.x-station.x,self.group.position.z-station.z)<=station.interactionRadius-.1) {
      // Flush a final predicted step before the menu request reaches the server.
      if(dirtyPosition){ callbacks.onMove(Math.round(self.group.position.x*100)/100,Math.round(self.group.position.z*100)/100); lastSent=performance.now(); }
      clearMovement(); callbacks.onRefreshments?.(); return;
    }
    clearMovement(); setFollow(true);
    const destination = new THREE.Vector2(station.standX, station.standZ);
    if (self.seat !== null) requestStand(destination);
    else {
      path = findPath(self.group.position.x, self.group.position.z, destination.x, destination.y);
      if (path.length) { marker.position.set(destination.x, 0.035, destination.y); marker.visible = true; }
    }
    approachingRefreshments = true;
  }
  function enterJumpPortal() {
    const self=selfId?avatars.get(selfId):undefined;
    if(!self || self.seat!==null || callbacks.isConnected?.()===false) return;
    if(dirtyPosition){callbacks.onMove(Math.round(self.group.position.x*100)/100,Math.round(self.group.position.z*100)/100);lastSent=performance.now();}
    clearMovement(); resumeDestination=null; jumpPortalLatched=true; callbacks.onJumpPortal?.();
  }
  function approachJumpPortal() {
    const self=selfId?avatars.get(selfId):undefined;
    if(!self || !renderingActive || modalOpen() || callbacks.isConnected?.()===false) return;
    if(self.seat===null && nearJumpPortal(self.group.position.x,self.group.position.z)){enterJumpPortal();return;}
    clearMovement(); setFollow(true);
    const destination=new THREE.Vector2(JUMP_PORTAL.x-.2,JUMP_PORTAL.z);
    if(self.seat!==null) requestStand(destination);
    else {path=findPath(self.group.position.x,self.group.position.z,destination.x,destination.y);if(path.length){marker.position.set(destination.x,.035,destination.y);marker.visible=true;}}
    approachingJumpPortal=true; jumpPortalLatched=false;
  }
  function updatePantryInteraction() {
    const self=selfId?avatars.get(selfId):undefined;
    const portalNear=!!self&&self.seat===null&&nearJumpPortal(self.group.position.x,self.group.position.z);
    jumpInteract.hidden=!renderingActive||view!=='room'||callbacks.isConnected?.()===false||modalOpen()||(!portalNear&&!approachingJumpPortal);
    jumpInteract.textContent=approachingJumpPortal?'게임룸 입구로 이동 중':jumpPromptText;
    const near=!!self&&self.seat===null&&Math.hypot(self.group.position.x-station.x,self.group.position.z-station.z)<=station.interactionRadius-.1;
    const hidden=!renderingActive||view!=='room'||callbacks.isConnected?.()===false||modalOpen()||(!near&&!approachingRefreshments);
    if(pantryInteract.hidden!==hidden)pantryInteract.hidden=hidden;
    const text=approachingRefreshments?'스낵바로 이동 중 · 취소':'☕ 스낵바 이용 · E';
    if(pantryInteract.textContent!==text){pantryInteract.textContent=text;pantryInteract.setAttribute('aria-label',approachingRefreshments?'스낵바로 이동 취소':'가까운 스낵바에서 음료와 간식 고르기');}
  }
  const bubbleSizes = new Map<Element, NonNullable<Avatar['bubble']>>();
  const bubbleResizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const bubble = bubbleSizes.get(entry.target); if (!bubble) continue;
      const size = entry.borderBoxSize[0];
      // ResizeObserver batches measurement after layout, avoiding one forced
      // layout per speaker while camera/avatars move every animation frame.
      bubble.width = size?.inlineSize ?? bubble.element.offsetWidth;
      bubble.height = size?.blockSize ?? bubble.element.offsetHeight;
    }
  });
  function removeBubble(avatar: Avatar) {
    if (avatar.bubble) { bubbleResizeObserver.unobserve(avatar.bubble.element); bubbleSizes.delete(avatar.bubble.element); avatar.bubble.element.remove(); }
    avatar.bubble = null;
  }
  function attachBubble(avatar: Avatar, message: ChatMessageView) {
    if (avatar.bubble?.message.id === message.id || message.expiresAt <= Date.now()) return;
    removeBubble(avatar);
    const element = document.createElement('div');
    const isAction = message.channel === 'action', background = isAction ? '#dff7eb' : '#edf0e6', border = isAction ? '#86c9ae' : '#c1d2cc';
    element.className = `classroom-chat-bubble${isAction ? ' is-action' : ''}`;
    Object.assign(element.style, { position: 'absolute', left: '0', top: '0', transform: 'translate3d(-1000px,-1000px,0)', width: 'max-content', maxWidth: 'min(220px, 65%)', padding: '10px 13px', borderRadius: '13px', border: '1px solid #c1d2cc', background: '#edf0e6', color: '#203740', font: '600 13px/1.5 "Malgun Gothic",sans-serif', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', boxShadow: '0 4px 18px rgba(0,0,0,.26)', pointerEvents: 'none' });
    element.style.background = background; element.style.borderColor = border;
    if (isAction) { const badge = document.createElement('small'); badge.className = 'bubble-action-badge'; badge.textContent = '액션'; element.appendChild(badge); }
    const text = document.createElement('span'); text.textContent = message.text; element.appendChild(text);
    const tail = document.createElement('i');
    Object.assign(tail.style, { position: 'absolute', width: '9px', height: '9px', bottom: '-5px', left: 'calc(50% - 5px)', transform: 'rotate(45deg)', background: '#edf0e6', borderRight: '1px solid #c1d2cc', borderBottom: '1px solid #c1d2cc' });
    tail.style.background = background; tail.style.borderColor = border;
    element.appendChild(tail); bubbleLayer.appendChild(element);
    avatar.bubble = { message, element, width: 0, height: 0, visible: true, transform: '', opacity: '' };
    bubbleSizes.set(element, avatar.bubble); bubbleResizeObserver.observe(element);
  }
  function showChat(message: ChatMessageView) {
    if (!message.id || !message.playerId || !Number.isFinite(message.expiresAt) || message.expiresAt <= Date.now()) return;
    const previous = latestChats.get(message.playerId);
    if (previous && previous.sentAt > message.sentAt) return;
    const safeMessage = { ...message, text: Array.from(String(message.text)).slice(0, 80).join('') };
    latestChats.set(message.playerId, safeMessage);
    const avatar = avatars.get(message.playerId); if (avatar) attachBubble(avatar, safeMessage);
    for (const [id, latest] of latestChats) if (latest.expiresAt <= Date.now()) latestChats.delete(id);
  }
  function clearChats() { latestChats.clear(); for (const avatar of avatars.values()) removeBubble(avatar); }

  function disposeObject(object: THREE.Object3D) {
    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.MeshBasicMaterial) child.material.dispose();
      }
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose(); child.material.dispose();
      }
    });
  }
  function refreshAvatarLabel(avatar: Avatar, mine: boolean) {
    avatar.group.remove(avatar.label);
    avatar.label.material.map?.dispose(); avatar.label.material.dispose();
    const displayName = avatar.disconnected ? `${avatar.nickname} (자리 비움)` : avatar.nickname;
    avatar.label = createAvatarNameLabel(displayName, mine, avatar.stockProfile, avatarLabelY(avatar.model));
    avatar.group.add(avatar.label);
    const ring = avatar.ring.material as THREE.MeshBasicMaterial;
    ring.color.set(0x73b8eb);
    ring.opacity = mine ? 0.8 : 0; avatar.ring.visible = mine;
  }
  function setSelfId(id: string | null) {
    selfJumpPrediction = undefined;
    firstJoinFocus = !!id && !selfId;
    selfId = id;
    selfNeedsSync = true;
    cancelSeatAction();
    for (const [playerId, avatar] of avatars) {
      const mine = playerId === id;
      refreshAvatarLabel(avatar, mine);
    }
    if (!id) setFollow(false);
    else if (firstJoinFocus) setFollow(true);
    else trackSelf();
  }
  function setPlayers(players: PlayerView[]) {
    shadowBudget.invalidate();
    let selfRelocated = false;
    const ids = new Set(players.map(player => player.id));
    for (const [id, avatar] of avatars) {
      if (!ids.has(id)) { removeBubble(avatar); room.remove(avatar.group); disposeObject(avatar.tray); avatar.label.material.map?.dispose(); avatar.label.material.dispose(); avatar.ring.geometry.dispose(); (avatar.ring.material as THREE.Material).dispose(); avatar.model.dispose(); avatars.delete(id); }
    }
    for (const id of pendingPlayers.keys()) if (!ids.has(id)) pendingPlayers.delete(id);
    for (const player of players) {
      if (!Number.isFinite(player.x) || !Number.isFinite(player.z)) continue;
      // A newcomer other than me waits for a build slot; its own copy of the
      // entry is what later movement and action deltas update.
      if (player.id !== selfId && !avatars.has(player.id)) { pendingPlayers.set(player.id, { ...player }); continue; }
      pendingPlayers.delete(player.id);
      if (applyPlayer(player)) selfRelocated = true;
    }
    if (selfRelocated) focusRelocatedSelf();
    // One or two newcomers appear with this roster, as they always have.
    buildPendingAvatars();
  }
  function buildPendingAvatars() {
    if (!pendingPlayers.size) return;
    const started = performance.now(), self = selfId ? avatars.get(selfId) : undefined;
    let selfRelocated = false;
    // At least one per frame, more only while the frame can afford it.
    for (let built = 0; pendingPlayers.size && built < 3 && (!built || performance.now() - started < 6); built++) {
      let next = selfId ? pendingPlayers.get(selfId) : undefined, nearest = Infinity;
      if (!next) for (const player of pendingPlayers.values()) {
        const distance = self ? Math.hypot(player.x - self.group.position.x, player.z - self.group.position.z) : 0;
        if (distance < nearest) { nearest = distance; next = player; }
      }
      if (!next) break;
      pendingPlayers.delete(next.id);
      if (applyPlayer(next)) selfRelocated = true;
    }
    if (selfRelocated) focusRelocatedSelf();
    shadowBudget.invalidate();
  }
  function focusRelocatedSelf() {
    const self = selfId ? avatars.get(selfId) : undefined;
    if (firstJoinFocus && self && view === 'room') {
      resetFollowCamera(camera, controls.target, { x: self.group.position.x, z: self.group.position.z, seated: self.seat !== null }, followAim, compactLayout.matches);
      controls.update(); enforceInterior();
    }
    firstJoinFocus = false; trackSelf();
  }
  /** Creates or updates one visitor from a roster entry. True when it moved my own figure. */
  function applyPlayer(player: PlayerView) {
    let selfRelocated = false;
    let avatar = avatars.get(player.id);
    const color = Number.isFinite(player.color) && player.color > 255 ? player.color : PALETTE[Math.abs(player.color || 0) % PALETTE.length];
    const appearance = normalizeAvatarAppearance(player.appearance, color);
    if (!avatar) {
      avatar = createAvatar(player.nickname, color, player.id === selfId, player.stockProfile ?? null, appearance, player.id);
      avatar.group.position.set(THREE.MathUtils.clamp(player.x, BOUNDS.minX, BOUNDS.maxX), 0, THREE.MathUtils.clamp(player.z, BOUNDS.minZ, BOUNDS.maxZ));
      avatars.set(player.id, avatar);
    } else if (color !== avatar.color || appearanceKey(appearance) !== appearanceKey(avatar.appearance)) {
      // Keep the root, local prediction target, held items and seated pose.
      // A clothing update must not act like a reconnect/position correction.
      avatar.model = replaceOfficeAvatarAppearance(avatar.model, color, appearance);
      placeAvatarNameLabel(avatar.label, avatarLabelY(avatar.model));
      avatar.arms = avatar.model.arms; avatar.legs = avatar.model.legs; avatar.lowerLegs = avatar.model.lowerLegs;
      avatar.color = color; avatar.appearance = appearance;
    }
    // An ordinary emote sent before the jump can still arrive in a late roster.
    // Do not revive that interrupted gesture after the local flight lands.
    avatar.action = player.id === selfId && selfJumpPrediction !== undefined && player.action?.kind !== 'jump' ? null : player.action ?? null;
    avatar.shoulder = player.shoulder ?? null;
    if (!avatar.shoulder) avatar.shoulderLocallyLeft = false;
    const disconnected = player.disconnected === true;
    const selection = isRefreshmentSelection(player.refreshments) ? player.refreshments : null;
    if (avatar.refreshments?.drink !== selection?.drink || avatar.refreshments?.snack !== selection?.snack) {
      for (const child of [...avatar.tray.children]) { disposeObject(child); child.removeFromParent(); }
      avatar.trayContent = selection ? refreshmentTray(selection) : null;
      if (avatar.trayContent) avatar.tray.add(avatar.trayContent.group);
      avatar.refreshments = selection ? { ...selection } : null; avatar.tray.visible = !!selection;
    }
    const stockProfile = player.stockProfile ?? null;
    const labelChanged = avatar.nickname !== player.nickname || avatar.disconnected !== disconnected || avatar.stockProfile?.stock !== stockProfile?.stock || avatar.stockProfile?.average !== stockProfile?.average || avatar.stockProfile?.currency !== stockProfile?.currency;
    avatar.stockProfile = stockProfile;
    avatar.disconnected = disconnected;
    if (labelChanged) { avatar.nickname = player.nickname; refreshAvatarLabel(avatar, player.id === selfId); }
    const seat = Number.isInteger(player.seat) && SEATS.some(candidate => candidate.id === player.seat) ? player.seat! : null;
    const seatChanged = avatar.seat !== seat;
    if (player.id === selfId && selfNeedsSync) {
      avatar.group.position.set(player.x, seat === null ? 0 : AVATAR_SEATED_Y, player.z); avatar.target.copy(avatar.group.position);
      selfNeedsSync = false; cancelSeatAction(); selfRelocated = true;
    }
    if (seatChanged) {
      avatar.seat = seat;
      const position = seat !== null ? SEATS.find(candidate => candidate.id === seat)! : player;
      avatar.group.position.set(position.x, seat !== null ? AVATAR_SEATED_Y : 0, position.z);
      avatar.target.copy(avatar.group.position);
      applySeatPose(avatar);
      if (player.id === selfId) {
        selfRelocated = true;
        path = []; dirtyPosition = false; marker.visible = false;
        if (seat !== null) keys.clear();
      }
    }
    if (player.id === selfId && pendingSeatAction && ((pendingSeatAction.kind === 'sit' && seat === pendingSeatAction.seat) || (pendingSeatAction.kind === 'stand' && seat === null) || (pendingSeatAction.kind === 'external' && seatChanged))) {
      pendingSeatAction = null;
      if (seat === null && resumeDestination) {
        path = findPath(avatar.group.position.x, avatar.group.position.z, resumeDestination.x, resumeDestination.y);
        resumeDestination = null;
        if (path.length) { const end = path[path.length - 1]; marker.position.set(end.x, 0.035, end.y); marker.visible = true; }
      }
    }
    if (seat !== null) {
      const seatPosition = SEATS.find(candidate => candidate.id === seat)!;
      avatar.target.set(seatPosition.x, AVATAR_SEATED_Y, seatPosition.z);
    } else if (player.id !== selfId) avatar.target.set(player.x, 0, player.z);
    else avatar.target.copy(avatar.group.position);
    const chat = latestChats.get(player.id); if (chat) attachBubble(avatar, chat);
    return selfRelocated;
  }
  function updatePlayerMovement(player: { id: string; x: number; z: number; action?: null }) {
    const avatar = avatars.get(player.id);
    if (!avatar) {
      const queued = pendingPlayers.get(player.id);
      if (queued && Number.isFinite(player.x) && Number.isFinite(player.z)) { queued.x = player.x; queued.z = player.z; if (player.action === null) queued.action = null; }
      return;
    }
    if (applyOfficeMovementDelta(avatar, player, player.id === selfId)) shadowBudget.invalidate();
  }
  function updatePlayerAction(id: string, action: PlayerView['action']) {
    const avatar = avatars.get(id);
    if (!avatar) { const queued = pendingPlayers.get(id); if (queued) queued.action = action; return; }
    avatar.action = id === selfId && selfJumpPrediction !== undefined && action?.kind !== 'jump' ? null : action;
    shadowBudget.invalidate();
  }
  function isWalkable(x: number, z: number) {
    return isRoomWalkable(x, z);
  }
  function findPath(startX: number, startZ: number, goalX: number, goalZ: number) {
    return findWalkPath(startX, startZ, goalX, goalZ).map(point => new THREE.Vector2(point.x, point.z));
  }
  function modalOpen() {
    return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].some(element=>!element.closest('[hidden]'));
  }
  function focusedInput(target: EventTarget | null) {
    return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]');
  }
  function keyDown(event: KeyboardEvent) {
    if (!renderingActive || document.hidden || !selfId) return;
    if (focusedInput(event.target) || modalOpen()) { pauseForInput(); return; }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if(key==='e'&&!event.repeat){const self=avatars.get(selfId);if(self&&self.seat===null&&nearJumpPortal(self.group.position.x,self.group.position.z)){event.preventDefault();approachJumpPortal();return;}if(self&&self.seat===null&&Math.hypot(self.group.position.x-station.x,self.group.position.z-station.z)<=station.interactionRadius-.1){event.preventDefault();approachRefreshments();}return;}
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
      event.preventDefault();
      if (pendingSeatAction?.kind === 'sit' || pendingSeatAction?.kind === 'external') return;
      if (avatars.get(selfId)?.seat !== null) requestStand();
      keys.add(key); path = []; approachingRefreshments = false; approachingJumpPortal = false;
    }
  }
  function keyUp(event: KeyboardEvent) { keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key); }
  function pauseForInput() { keys.clear(); touchKeys.clear(); touchStick.x = touchStick.z = 0; path = []; resumeDestination = null; marker.visible = false; approachingRefreshments = false; approachingJumpPortal = false; }
  function focusIn(event: FocusEvent) { if (focusedInput(event.target)) pauseForInput(); }
  function blur() { pauseForInput(); activePointers.clear(); gestureDragged = true; seatHint.style.display = 'none'; seatHighlight.visible = false; }
  const activePointers = new Set<number>();
  let downX = 0, downY = 0, gestureDragged = false;
  let tapSlop = 6;
  function pointerDown(event: PointerEvent) {
    // A short phone swipe should not swing from the character to the ceiling.
    // Keep the full angle range, with finer one-finger control than a mouse.
    controls.rotateSpeed = event.pointerType === 'touch' ? 0.3 : 0.7;
    if (!renderingActive || document.hidden) return;
    renderer.domElement.focus({ preventScroll: true });
    if (!activePointers.size) { downX = event.clientX; downY = event.clientY; gestureDragged = false; tapSlop = event.pointerType === 'touch' ? 8 : 6; }
    else gestureDragged = true;
    const panGesture = event.button === 2 || event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey) || event.pointerType === 'touch' && activePointers.size > 0;
    if (panGesture) { setFollow(false); gestureDragged = true; }
    activePointers.add(event.pointerId);
    seatHint.style.display = 'none'; seatHighlight.visible = false;
  }
  function setPointer(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }
  function pointerUp(event: PointerEvent) {
    const isTap = activePointers.has(event.pointerId) && activePointers.size === 1 && !gestureDragged && event.button === 0 && Math.hypot(event.clientX - downX, event.clientY - downY) <= tapSlop;
    activePointers.delete(event.pointerId);
    renderer.domElement.style.cursor = 'grab';
    if (!renderingActive || document.hidden || !isTap || modalOpen()) return;
    setPointer(event);
    const pickableSeats = seatHitboxes;
    const interaction = raycaster.intersectObjects([...boardHits, communityFace, refreshmentHit, jumpPortal.hit, ...pickableSeats], true)[0];
    if (interaction?.object.userData.jumpPortal) { approachJumpPortal(); return; }
    if (interaction?.object.userData.refreshments) { approachRefreshments(); return; }
    if (interaction?.object.userData.community) { callbacks.onCommunityPost?.(interaction.uv ? popularPostAtUv(popularPosts, interaction.uv.x, interaction.uv.y) : null); return; }
    if (interaction?.object.userData.interaction) { callbacks.onInteract(interaction.object.userData.interaction, interaction.object.userData.chartSide); return; }
    if (Number.isInteger(interaction?.object.userData.seat)) { requestSit(interaction!.object.userData.seat); return; }
    if (!selfId) return;
    const intersection = raycaster.intersectObject(floor)[0];
    const self = avatars.get(selfId);
    if (!intersection || !self) return;
    approachingRefreshments = false; approachingJumpPortal = false;
    const x = THREE.MathUtils.clamp(intersection.point.x, BOUNDS.minX, BOUNDS.maxX), z = THREE.MathUtils.clamp(intersection.point.z, BOUNDS.minZ, BOUNDS.maxZ);
    if (self.seat !== null) { requestStand(new THREE.Vector2(x, z)); return; }
    if (pendingSeatAction) return;
    path = findPath(self.group.position.x, self.group.position.z, x, z);
    if (path.length) { const destination = path[path.length - 1]; marker.position.set(destination.x, 0.035, destination.y); marker.visible = true; }
  }
  function pointerCancel(event: PointerEvent) { activePointers.delete(event.pointerId); gestureDragged = true; }
  function pointerMove(event: PointerEvent) {
    if (!renderingActive || document.hidden) return;
    if (activePointers.has(event.pointerId)) {
      // Remember the maximum excursion, so a drag out and back never counts as
      // a floor tap. Multi-touch gestures likewise cannot trigger movement.
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > tapSlop) gestureDragged = true;
      // OrbitControls receives pointermove on the document after this handler.
      // Ignore finger jitter until an intentional drag starts, so a tap doesn't
      // rotate the camera before its floor/seat raycast is evaluated.
      if (event.pointerType === 'touch' && activePointers.size === 1 && !gestureDragged) event.stopPropagation();
      renderer.domElement.style.cursor = gestureDragged ? 'grabbing' : 'grab';
      return;
    }
    setPointer(event);
    const pickableSeats = seatHitboxes;
    const interaction = raycaster.intersectObjects([...boardHits, communityFace, refreshmentHit, jumpPortal.hit, ...pickableSeats], true)[0];
    renderer.domElement.style.cursor = interaction ? 'pointer' : 'grab';
    if (Number.isInteger(interaction?.object.userData.seat)) {
      const seat = SEATS.find(candidate => candidate.id === interaction!.object.userData.seat)!;
      const occupant = [...avatars.entries()].find(([, avatar]) => avatar.seat === seat.id) ?? [...pendingPlayers.entries()].find(([, player]) => player.seat === seat.id);
      const mine = occupant?.[0] === selfId;
      (seatHighlight.material as THREE.MeshBasicMaterial).color.set(occupant && !mine ? 0xce9b73 : 0x9ad8cf);
      seatHighlight.position.set(seat.x, 0.035, seat.z); seatHighlight.visible = true;
      seatHint.textContent = mine ? '클릭하여 일어나기' : occupant ? `${seat.label} · 사용 중` : `${seat.label} · 클릭하여 앉기`;
      const rect = renderer.domElement.getBoundingClientRect();
      seatHint.style.left = `${Math.max(8, Math.min(rect.width - 170, event.clientX - rect.left + 14))}px`;
      seatHint.style.top = `${Math.max(8, Math.min(rect.height - 36, event.clientY - rect.top + 14))}px`;
      seatHint.style.display = 'block';
    } else { seatHint.style.display = 'none'; seatHighlight.visible = false; }
  }
  function pointerLeave() { if (!activePointers.size) { seatHint.style.display = 'none'; seatHighlight.visible = false; } }
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  window.addEventListener('focusin', focusIn);
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointercancel', pointerCancel);
  renderer.domElement.addEventListener('lostpointercapture', pointerCancel);
  renderer.domElement.addEventListener('pointerleave', pointerLeave);

  let aspect = 1.5, viewportWidth = 1, viewportHeight = 1;
  function resize() {
    if (disposed || !renderingActive || document.hidden) return;
    const width = container.clientWidth, height = container.clientHeight;
    if (width < 2 || height < 2) return;
    const sizeChanged = width !== viewportWidth || height !== viewportHeight;
    if (activePointers.size && sizeChanged) gestureDragged = true;
    viewportWidth = width; viewportHeight = height;
    aspect = width / height;
    const pixelRatio = officePixelRatio(window.devicePixelRatio, compactLayout.matches, width, height);
    const ratioChanged = renderer.getPixelRatio() !== pixelRatio;
    if (ratioChanged) renderer.setPixelRatio(pixelRatio);
    if (sizeChanged) {
      renderer.setSize(width, height, false);
      cssRenderer.setSize(width, height);
      chartTransforms.invalidate();
    }
    updateFrustum();
    if (view === 'chart' && chartPresetActive) frameChart();
    if (communityPresetActive) frameCommunity();
    trackSelf(); controls.update(); enforceInterior();
  }
  const savedRoomPosition = camera.position.clone();
  const savedRoomTarget = controls.target.clone();
  let savedRoomFov: number = FREE_CAMERA.fov;
  let savedRoomFollow = false;
  function trackSelf() {
    const self = selfId ? avatars.get(selfId) : undefined;
    followCameraPosition(camera, controls.target, self ? { x: self.group.position.x, z: self.group.position.z, seated: self.seat !== null } : null, view === 'room' && followingSelf, followAim);
  }
  function applyViewControls() {
    controls.enablePan = true;
    controls.minDistance = followingSelf ? FOLLOW_CAMERA.minDistance : FREE_CAMERA.minDistance;
    controls.maxDistance = followingSelf ? FOLLOW_CAMERA.maxDistance : FREE_CAMERA.maxDistance;
    controls.minPolarAngle = followingSelf ? FOLLOW_CAMERA.minPolarAngle : FREE_CAMERA.minPolarAngle;
    controls.maxPolarAngle = followingSelf ? FOLLOW_CAMERA.maxPolarAngle : FREE_CAMERA.maxPolarAngle;
  }
  function updateFrustum() {
    camera.aspect = aspect;
    if (view === 'room' && followingSelf) camera.fov = followCameraFov(aspect, compactLayout.matches);
    camera.updateProjectionMatrix();
  }
  function availableViewFraction() {
    const viewportLeft = container.getBoundingClientRect().left;
    const panelEdges = compactLayout.matches ? [] : Array.from(document.querySelectorAll<HTMLElement>('#market-panel, #admission'))
      .filter(panel => !panel.hidden && panel.getClientRects().length > 0)
      .map(panel => panel.getBoundingClientRect().left - viewportLeft - 25);
    const availableRight = compactLayout.matches ? viewportWidth : Math.max(viewportWidth * 0.5, Math.min(viewportWidth - 25, ...panelEdges));
    return availableRight / viewportWidth;
  }
  function frameChart() {
    updateFrustum();
    frameInteriorChart(camera, controls.target, chartWalls[activeChartSide].geometry, availableViewFraction());
  }
  function frameCommunity() {
    updateFrustum();
    frameInteriorCommunity(camera, controls.target, community, availableViewFraction());
  }
  function viewCommunity() {
    clearMovement(); stopCameraMotion();
    const viewChanged = view !== 'room', wasFollowing = followingSelf;
    view = 'room'; followingSelf = false; chartPresetActive = false; communityPresetActive = true;
    applyViewControls(); frameCommunity(); controls.update(); enforceInterior();
    if (viewChanged) callbacks.onViewChange?.(view);
    if (wasFollowing) callbacks.onFollowChange?.(false);
  }
  function setFollow(enabled: boolean) {
    if (enabled) {
      stopCameraMotion();
      const viewChanged = view !== 'room', followChanged = !followingSelf;
      view = 'room'; followingSelf = true; chartPresetActive = false; communityPresetActive = false; applyViewControls();
      const self = selfId ? avatars.get(selfId) : undefined;
      resetFollowCamera(camera, controls.target, self ? { x: self.group.position.x, z: self.group.position.z, seated: self.seat !== null } : null, followAim, compactLayout.matches);
      updateFrustum(); controls.update(); enforceInterior();
      if (viewChanged) callbacks.onViewChange?.(view);
      if (followChanged) callbacks.onFollowChange?.(true);
      return;
    }
    if (!followingSelf) return;
    followingSelf = false; applyViewControls();
    callbacks.onFollowChange?.(false);
  }
  function setView(next: 'room' | 'chart' | 'board', side: ChartWallSide = 'front') {
    clearMovement(); stopCameraMotion();
    communityPresetActive = false;
    if (next === 'room') {
      if (view === 'room') return;
      view = 'room'; followingSelf = savedRoomFollow; chartPresetActive = false; applyViewControls();
      camera.position.copy(savedRoomPosition); controls.target.copy(savedRoomTarget); camera.fov = savedRoomFov; camera.zoom = 1;
      trackSelf(); updateFrustum(); controls.update(); enforceInterior();
      callbacks.onViewChange?.(view); callbacks.onFollowChange?.(followingSelf); return;
    }
    if (view === 'room') {
      savedRoomPosition.copy(camera.position); savedRoomTarget.copy(controls.target);
      savedRoomFov = camera.fov; savedRoomFollow = followingSelf;
    }
    const changed = view !== 'chart', wasFollowing = followingSelf;
    activeChartSide = side;
    view = 'chart'; followingSelf = false; chartPresetActive = true; applyViewControls(); camera.zoom = 1;
    frameChart(); controls.update(); enforceInterior();
    if (changed) callbacks.onViewChange?.(view);
    if (wasFollowing) callbacks.onFollowChange?.(false);
  }
  function stopCameraMotion() {
    // Flush residual orbit damping before a deliberate preset/button action.
    controls.enableDamping = false; controls.update(); controls.enableDamping = true; enforceInterior();
  }
  function resetView() { clearMovement(); setFollow(true); }
  function rotateView(direction: -1 | 1) {
    chartPresetActive = false; communityPresetActive = false; stopCameraMotion();
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * Math.PI / 6);
    camera.position.copy(controls.target).add(offset); controls.update(); enforceInterior();
  }
  function zoomView(delta: number) {
    if (!Number.isFinite(delta)) return;
    chartPresetActive = false; communityPresetActive = false; stopCameraMotion();
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() / 1.2 ** delta, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setLength(distance));
    controls.update(); enforceInterior();
  }
  function tiltView(direction: 'up' | 'down') {
    if (disposed) return;
    chartPresetActive = false; communityPresetActive = false; stopCameraMotion();
    tiltCameraPosition(camera, controls.target, direction, followingSelf, followAim);
    controls.update(); enforceInterior();
  }
  function panView(direction: 'up' | 'down' | 'left' | 'right') {
    if (disposed) return;
    chartPresetActive = false; communityPresetActive = false; setFollow(false); stopCameraMotion();
    const step = Math.min(4, 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.12);
    panCameraPosition(camera, controls.target, direction === 'left' ? -step : direction === 'right' ? step : 0, direction === 'down' ? -step : direction === 'up' ? step : 0);
    controls.update(); enforceInterior();
  }
  function enforceInterior() {
    constrainInteriorCamera(camera, controls.target, followingSelf, followAim);
    // Fixed CSS3D mounting avoids provider flicker as the user turns between walls.
    chartWalls.front.object.visible = true; chartWalls.rear.object.visible = true;
  }
  controls.addEventListener('start', () => { chartPresetActive = false; communityPresetActive = false; });
  function updateCamera(blocked: boolean) {
    controls.enabled = renderingActive && !document.hidden && !blocked;
    // Follow/interior constraints are applied once after player prediction.
    controls.update();
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);
  compactLayout.addEventListener('change', resize);
  let previousTime = performance.now(), animationId = 0;
  const direction = new THREE.Vector2();
  const cameraForward = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const bubblePoint = new THREE.Vector3();
  function updateBubbles(now: number) {
    for (const [id, avatar] of avatars) {
      const bubble = avatar.bubble;
      if (!bubble) continue;
      const remaining = bubble.message.expiresAt - now;
      if (remaining <= 0) {
        removeBubble(avatar);
        if (latestChats.get(id)?.id === bubble.message.id) latestChats.delete(id);
        continue;
      }
      bubblePoint.set(0, avatar.label.position.y + avatar.label.scale.y * 0.55 + 0.1, 0).applyMatrix4(avatar.group.matrixWorld).project(camera);
      const visible = bubblePoint.z >= -1 && bubblePoint.z <= 1 && Math.abs(bubblePoint.x) < 1.25 && Math.abs(bubblePoint.y) < 1.2;
      if (bubble.visible !== visible) { bubble.visible = visible; bubble.element.style.visibility = visible ? 'visible' : 'hidden'; }
      if (!visible) continue;
      const halfWidth = bubble.width / 2;
      const x = THREE.MathUtils.clamp((bubblePoint.x + 1) * viewportWidth / 2, halfWidth + 8, viewportWidth - halfWidth - 8);
      const y = Math.max(bubble.height + 10, (1 - bubblePoint.y) * viewportHeight / 2 - 5);
      const transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) translate(-50%,-100%)`;
      const opacity = Math.min(1, remaining / 1000).toFixed(2);
      if (bubble.transform !== transform) { bubble.transform = transform; bubble.element.style.transform = transform; }
      if (bubble.opacity !== opacity) { bubble.opacity = opacity; bubble.element.style.opacity = opacity; }
    }
    for (const [id, message] of latestChats) if (message.expiresAt <= now) latestChats.delete(id);
  }
  function animate(time: number) {
    animationId = 0;
    if (disposed || !renderingActive || document.hidden) { previousTime = time; return; }
    // While someone types on a phone the room is mostly covered by the keyboard and the
    // composer; drawing it at 20 Hz leaves the main thread and GPU to the text field.
    if (compactLayout.matches && time - previousTime < 45 && focusedInput(document.activeElement)) { animationId = requestAnimationFrame(animate); return; }
    frameServerNow = Date.now() + serverTimeOffset;
    frameLocalNow = performance.timeOrigin + performance.now();
    const dt = Math.min((time - previousTime) / 1000, 0.05); previousTime = time;
    const smooth = 1 - Math.exp(-dt * 4);
    const blocked = modalOpen(), inputFocused = focusedInput(document.activeElement);
    buildPendingAvatars();
    updateCamera(blocked);
    if (pendingSeatAction && time >= pendingSeatAction.expires) cancelSeatAction();
    if (inputFocused || blocked) pauseForInput();
    const connected = callbacks.isConnected?.() ?? true;
    if (!connected) clearMovement();
    const self = selfId ? avatars.get(selfId) : undefined;
    let shadowActorsAnimating = false;
    if (connected && self && self.seat === null && !pendingSeatAction && !blocked && !inputFocused) {
      direction.set(0, 0);
      camera.getWorldDirection(cameraForward); cameraForward.y = 0; cameraForward.normalize();
      cameraRight.crossVectors(cameraForward, camera.up).normalize();
      const pressed = (key: string) => keys.has(key) || touchKeys.has(key);
      if (pressed('w') || pressed('ArrowUp')) { direction.x += cameraForward.x; direction.y += cameraForward.z; }
      if (pressed('s') || pressed('ArrowDown')) { direction.x -= cameraForward.x; direction.y -= cameraForward.z; }
      if (pressed('a') || pressed('ArrowLeft')) { direction.x -= cameraRight.x; direction.y -= cameraRight.z; }
      if (pressed('d') || pressed('ArrowRight')) { direction.x += cameraRight.x; direction.y += cameraRight.z; }
      const distance = dt * NORMAL_MOVE_SPEED;
      // Keys always walk at full speed; the stick alone walks slower when pushed only part-way.
      let pace = 1;
      if (direction.lengthSq() === 0 && (touchStick.x || touchStick.z)) {
        direction.set(cameraRight.x * touchStick.x - cameraForward.x * touchStick.z, cameraRight.z * touchStick.x - cameraForward.z * touchStick.z);
        pace = Math.max(.35, Math.min(1, Math.hypot(touchStick.x, touchStick.z)));
      }
      if (direction.lengthSq() > 0) direction.normalize().multiplyScalar(distance * pace);
      else if (path.length) {
        const p = path[0]; direction.set(p.x - self.group.position.x, p.y - self.group.position.z);
        const length = direction.length();
        if (length > distance) direction.multiplyScalar(distance / length);
      }
      const oldX = self.group.position.x, oldZ = self.group.position.z;
      const permitted = isWalkableSegment;
      if (permitted(oldX, oldZ, oldX + direction.x, oldZ + direction.y)) { self.group.position.x += direction.x; self.group.position.z += direction.y; }
      else {
        if (permitted(oldX, oldZ, oldX + direction.x, oldZ)) self.group.position.x += direction.x;
        if (permitted(self.group.position.x, oldZ, self.group.position.x, oldZ + direction.y)) self.group.position.z += direction.y;
      }
      if (path.length && Math.hypot(path[0].x - self.group.position.x, path[0].y - self.group.position.z) < 0.025) path.shift();
      const dx = self.group.position.x - oldX, dz = self.group.position.z - oldZ;
      const moving = Math.abs(dx) + Math.abs(dz) > 0.0001;
      shadowActorsAnimating ||= moving;
      // Don't return to the old linked pose while the final movement packet is
      // still in flight, even if the player releases the controls immediately.
      if (moving && self.shoulder) self.shoulderLocallyLeft = true;
      animateAvatar(self, moving, dx, dz, time);
      if (moving) dirtyPosition = true;
      if (!path.length) marker.visible = false;
    } else if (self) animateAvatar(self, false, 0, 0, time);
    const movementInterval = MOVE_INTERVAL_MS;
    if (connected && self && self.seat === null && !pendingSeatAction && dirtyPosition && time - lastSent >= movementInterval) {
      lastSent = time; dirtyPosition = false;
      const x = Math.round(self.group.position.x * 100) / 100, z = Math.round(self.group.position.z * 100) / 100;
      callbacks.onMove(x, z);
    }
    if (approachingRefreshments && self && self.seat === null && !pendingSeatAction && !path.length && !dirtyPosition && Math.hypot(self.group.position.x - station.standX, self.group.position.z - station.standZ) < 0.2) {
      approachingRefreshments = false; approachingJumpPortal = false; self.group.rotation.y = -Math.PI / 2;
      callbacks.onRefreshments?.();
    }
    if(self && connected && self.seat===null && !pendingSeatAction && !blocked && !inputFocused) {
      const distance=Math.hypot(self.group.position.x-JUMP_PORTAL.x,self.group.position.z-JUMP_PORTAL.z);
      if(distance>JUMP_PORTAL.entryRadius+.5) jumpPortalLatched=false;
      if(!jumpPortalLatched && distance<.75) enterJumpPortal();
    }
    for (const [id, avatar] of avatars) {
      if (id === selfId) continue;
      const dx = avatar.target.x - avatar.group.position.x, dz = avatar.target.z - avatar.group.position.z;
      shadowActorsAnimating ||= Math.abs(dx) + Math.abs(dz) > 0.0001;
      avatar.group.position.x += dx * smooth; avatar.group.position.z += dz * smooth;
      animateAvatar(avatar, Math.abs(dx) + Math.abs(dz) > 0.03, dx, dz, time);
    }
    const serverNow = frameServerNow;
    for (const avatar of avatars.values()) {
      const action = renderedAction(avatar), now = action && action === selfJumpPrediction ? frameLocalNow : serverNow;
      if (action && now < action.expiresAt || avatar.shoulder?.cheer && serverNow < avatar.shoulder.cheer.expiresAt) { shadowActorsAnimating = true; break; }
    }
    marker.rotation.z = time * 0.0005;
    // Only explicit follow mode tracks after prediction/interpolation. Free
    // and chart views keep the user's pose through all player-state changes.
    if (view === 'room' && followingSelf) trackSelf();
    else enforceInterior();
    updateWallClock();
    updatePantryInteraction();
    // The real body remains the focus even when an upward orbit raises the aim.
    if (view === 'room' && followingSelf && self) viewFocus.copy(self.group.position).y += 0.9;
    else viewFocus.copy(controls.target);
    viewClearance.update(camera, viewFocus, followingSelf ? 1.3 : 1.6);
    camera.updateMatrixWorld();
    if (chartTransforms.changed(camera, viewportWidth, viewportHeight)) cssRenderer.render(cssScene, camera);
    renderer.shadowMap.needsUpdate = shadowBudget.shouldUpdate(time, shadowActorsAnimating);
    renderer.render(scene, camera);
    updateBubbles(Date.now());
    animationId = requestAnimationFrame(animate);
  }
  function syncRendering() {
    cancelAnimationFrame(animationId); animationId = 0;
    previousTime = performance.now();
    if (disposed) return;
    const active = renderingActive && !document.hidden;
    controls.enabled = active && !modalOpen();
    if (!active) { blur(); return; }
    chartTransforms.invalidate(); shadowBudget.invalidate();
    resize();
    animationId = requestAnimationFrame(animate);
  }
  /** Pause the scene without detaching avatars, chat, or authoritative updates. */
  function setRenderingActive(active: boolean) {
    if (disposed || renderingActive === active) return;
    renderingActive = active;
    syncRendering();
  }
  function applySeatPose(avatar: Avatar) {
    const seated = avatar.seat !== null;
    avatar.group.position.y = seated ? AVATAR_SEATED_Y : 0;
    // Seat IDs survive furniture additions even when the catalog is regrouped.
    const seat = seated ? SEATS.find(candidate => candidate.id === avatar.seat) : undefined;
    if (seat) avatar.group.rotation.y = seat.yaw;
    avatar.legs.forEach(leg => { leg.rotation.x = seated ? -Math.PI / 2 : 0; });
    avatar.lowerLegs.forEach(leg => { leg.rotation.x = seated ? Math.PI / 2 : 0; });
    avatar.arms.forEach(arm => { arm.rotation.x = avatar.refreshments ? -1.15 : seated ? -0.7 : 0; });
    // Thighs rest on the sofa cushion while the lower legs hang over its edge.
    avatar.ring.position.y = .025 - (seated ? AVATAR_SEATED_Y : 0);
    // Furniture already grounds a seated figure.
    avatar.blob.visible = !seated;
  }
  const refreshmentHand = new THREE.Vector3();
  function poseRefreshments(avatar:Avatar,now:number,moving:boolean,action:PlayerView['action']) {
    const props=avatar.trayContent;
    if(!props)return;
    props.drink.position.copy(props.drinkRest); props.drink.rotation.set(0,0,0);
    props.snack.position.copy(props.snackRest); props.snack.rotation.set(0,0,0);
    const weight=avatarConsumeWeight(action,now,moving);
    if(!weight)return;
    const drinking=action?.kind==='drink';
    if(drinking?!avatar.refreshments?.drink:!avatar.refreshments?.snack)return;
    // The actual selected item follows its animated hand; the plate stays on the tray.
    refreshmentHand.set(0,AVATAR_HAND_LOCAL_Y,.005);
    avatar.model.forearms[drinking?0:1].localToWorld(refreshmentHand);
    props.group.worldToLocal(refreshmentHand);
    refreshmentHand.x+=drinking?.085:-.06; refreshmentHand.y+=drinking?-.065:.05; refreshmentHand.z+=drinking?.1:.02;
    const item=drinking?props.drink:props.snack;
    item.position.lerp(refreshmentHand,weight);
    item.rotation.x=(drinking?-.65:1.05)*weight;
  }
  function animateAvatar(avatar: Avatar, moving: boolean, dx: number, dz: number, time: number) {
    const action = renderedAction(avatar), now = action && action === selfJumpPrediction ? frameLocalNow : frameServerNow;
    if (avatar.seat !== null) { applySeatPose(avatar); poseOfficeAvatar(avatar.model, time, frameServerNow, avatar.action, false, !!avatar.refreshments, true); poseRefreshments(avatar,frameServerNow,false,avatar.action); return; }
    const jump=avatarJumpHeight(action,now);
    avatar.group.position.y = jump+(moving ? Math.abs(Math.sin(time * 0.016)) * 0.04 : 0);
    avatar.ring.position.y=.025-jump;
    // The blob stays on the floor and tightens as the figure leaves it.
    const lift=avatar.group.position.y, tight=1-.42*Math.min(1,lift/1.4);
    avatar.blob.visible=true; avatar.blob.position.y=BLOB_Y-lift; avatar.blob.scale.set(BLOB_WIDTH*tight,1,BLOB_DEPTH*tight);
    if (moving) {
      const targetAngle = Math.atan2(dx, dz);
      const difference = Math.atan2(Math.sin(targetAngle - avatar.group.rotation.y), Math.cos(targetAngle - avatar.group.rotation.y));
      avatar.group.rotation.y += difference * 0.2;
    }
    avatar.arms.forEach((arm, index) => arm.rotation.x = avatar.refreshments ? -1.15 : moving ? Math.sin(time * 0.016 + index * Math.PI) * 0.5 : 0);
    avatar.legs.forEach((leg, index) => leg.rotation.x = moving ? Math.sin(time * 0.016 + index * Math.PI) * -0.4 : 0);
    avatar.lowerLegs.forEach((leg,index) => { leg.rotation.x = moving ? Math.max(0,Math.sin(time*.016+index*Math.PI))*.2 : 0; });
    poseOfficeAvatar(avatar.model, time, now, action, moving, !!avatar.refreshments);
    if (action?.kind !== 'jump' && avatar.shoulder && !avatar.shoulderLocallyLeft && !moving && !avatar.refreshments) {
      avatar.group.rotation.y = avatar.shoulder.facing;
      poseOfficeShoulderLink(avatar.model, avatar.shoulder, frameServerNow);
    }
    poseRefreshments(avatar,now,moving,action);
  }
  document.addEventListener('visibilitychange', syncRendering);
  applyViewControls();
  camera.position.copy(controls.target).add(new THREE.Vector3().copy(FOLLOW_CAMERA.defaultOffset));
  syncRendering();
  function dispose() {
    disposed = true; cancelAnimationFrame(animationId); resizeObserver.disconnect(); bubbleResizeObserver.disconnect(); bubbleSizes.clear(); pendingPlayers.clear();
    compactLayout.removeEventListener('change', resize);
    document.removeEventListener('visibilitychange', syncRendering);
    window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur);
    window.removeEventListener('focusin', focusIn);
    renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointermove', pointerMove);
    renderer.domElement.removeEventListener('pointercancel', pointerCancel);
    renderer.domElement.removeEventListener('lostpointercapture', pointerCancel);
    renderer.domElement.removeEventListener('pointerleave', pointerLeave);
    controls.dispose();
    viewClearance.dispose();
    const geometries = new Set<THREE.BufferGeometry>(), allMaterials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        if ('geometry' in object) geometries.add(object.geometry as THREE.BufferGeometry);
        for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
          allMaterials.add(mat);
          const textured = mat as THREE.MeshStandardMaterial;
          if (textured.map) textures.add(textured.map);
        }
      }
    });
    geometries.add(blobGeometry); allMaterials.add(blobMaterial); textures.add(blobTexture);
    geometries.forEach(geometry => geometry.dispose()); allMaterials.forEach(mat => mat.dispose()); textures.forEach(texture => texture.dispose());
    latestChats.clear(); renderer.dispose(); renderer.domElement.remove(); cssRenderer.domElement.remove();
    chartWalls.front.host.remove(); chartWalls.rear.host.remove(); bubbleLayer.remove(); pantryInteract.remove(); jumpInteract.remove();
  }
  return { setSelfId, setPlayers, updatePlayerMovement, updatePlayerAction, predictJump, setView, viewFrontCharts: () => setView('chart', 'front'), viewRearCharts: () => setView('chart', 'rear'), viewCommunity, approachRefreshments, approachJumpPortal, setJumpLeaderboard: jumpPortal.setLeaderboard, prepareShoulderLink, resetView, setFollow, isFollowing: () => followingSelf, panView, rotateView, tiltView, zoomView, correctPosition, setMoveInput, setMoveStick, setRenderingActive, getWallChartHost: (side: ChartWallSide = 'front') => chartWalls[side].host, setMarketLabel, setPopularPosts, setServerTime, showChat, clearChats, pauseMovement: clearMovement, stopMovement, cancelSeatAction, dispose };
}
