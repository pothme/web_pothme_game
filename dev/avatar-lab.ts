import * as THREE from 'three';
import { createOfficeAvatar, type OfficeAvatar } from '../src/office-avatar';
import { avatarConsumeWeight, avatarJumpHeight, poseOfficeAvatar } from '../src/office-avatar-pose';
import { avatarLabelY, createAvatarNameLabel } from '../src/avatar-name-label';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, type AppearanceKey, type AvatarAppearance } from '../shared/avatar-appearance';
import { AVATAR_BODY_SCALE_Y, AVATAR_HAND_LOCAL_Y, AVATAR_SEATED_Y } from '../shared/avatar-rig';
import type { AvatarActionKind, AvatarActionView } from '../shared/avatar-actions';
import { createJumpAction } from '../shared/avatar-jump';

/** Local visual review only (not a production entry point).
 *  ?only=hero,species,back,hair,office   limit the sections
 *  ?grid=top|bottom|shoes|headwear|eyewear|neckwear|backwear|all   every option of a slot on a full figure
 *  ?species=cat                            species used by ?grid, ?only=poses and ?only=strip
 *  ?t=1400                                 frozen animation clock in ms (default 1400)
 *  ?animate=1                              run every section continuously
 *  ?happy=1                                closed "^ ^" eyes on every figure (0…1 = the transition weight)
 *  ?only=poses[&set=2][&yaw=][&list=wave,bow][&scale=330]  pose close-ups; set=2 = dance, heart, market reactions, eat, drink, jump
 *                                          (a row with a jump is taller, so the whole arc stays in frame)
 *  ?only=strip&pose=walk[&n=8&step=50]     one figure at n moments, `step` ms apart, starting at ?t (&plain=1 default outfit)
 *  ?only=office&labels=1[&gap=2.2&blob=0]   name plates and the self ring as in the office; spacing; without contact blobs
 *  ?only=thumbs[&slots=top,shoes&size=240&cols=6]  item thumbnails from the real thumbnail renderer
 *  ?only=table[&n=6&w=390&h=300] | ?only=tower[&walk=1] the real game-room table / jump-tower scenes (own renderers and loops)
 *  ?only=room[&n=50&far=6&w=1400&h=760]    the real office with n visitors arriving in one roster; far = zoom-out steps of the free camera */
type Pose = 'idle' | 'walk' | 'sit' | 'carry' | 'carry-walk' | 'sit-carry' | AvatarActionKind;
type Cast = { label: string; appearance: AvatarAppearance; yaw?: number; pose?: Pose; color?: number; offset?: number };
/** A stand-in for the office tray (same sizes and anchor as src/classroom.ts). */
type Tray = { group: THREE.Group; drink: THREE.Object3D; snack: THREE.Object3D };
type Actor = { model: OfficeAvatar; pose: Pose; offset?: number; tray?: Tray };
const params = new URLSearchParams(location.search);
const only = params.get('only')?.split(',') ?? null;
const frozen = Number(params.get('t') ?? 1400);
const happy = params.get('happy');
const A = (value: Partial<AvatarAppearance>): AvatarAppearance => ({ ...DEFAULT_APPEARANCE, ...value });

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

/** Same lights as src/avatar-preview.ts (dressing room / thumbnails). */
function studioScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f1e6);
  scene.add(new THREE.HemisphereLight(0xfffaf1, 0x929b8b, 1.3));
  const key = new THREE.DirectionalLight(0xfff4e4, 2.3); key.position.set(-3, 5, 5); key.target.position.set(0, 1, 0); scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc8def4, .65); fill.position.set(3, 2, -2); scene.add(fill);
  return scene;
}
/** Same lights, tone mapping, floor tone and follow-camera angle as src/classroom.ts. */
function officeScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd5dee5);
  scene.add(new THREE.HemisphereLight(0xe8f3ff, 0x526274, 2.4));
  const sun = new THREE.DirectionalLight(0xffd9a6, 2.7); sun.position.set(-25, 12, 8); sun.target.position.set(3, 0, -1.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: .5, far: 80 });
  sun.shadow.normalBias = .035; sun.shadow.bias = -.00015; sun.shadow.radius = 3; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xbad3dd, .8); fill.position.set(12, 5, 9); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x617181, roughness: .93 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  return scene;
}

const trayMaterial = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: .9 });
function createTray(model: OfficeAvatar): Tray {
  const group = new THREE.Group(); group.position.set(0, .86 * AVATAR_BODY_SCALE_Y, .4 * AVATAR_BODY_SCALE_Y); model.group.add(group);
  group.add(new THREE.Mesh(new THREE.BoxGeometry(.8, .035, .5), trayMaterial(0xa88d69)));
  const drink = new THREE.Group(), cup = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .19, 16), trayMaterial(0xf2eee4)); cup.position.y = .095; drink.add(cup); group.add(drink);
  const snack = new THREE.Group(); snack.add(new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .04, 16), trayMaterial(0xc69758))); group.add(snack);
  return { group, drink, snack };
}
const hand = new THREE.Vector3();
function applyPose(actor: Actor, time: number) {
  const { model, pose } = actor;
  const seated = pose === 'sit' || pose === 'sit-carry', moving = pose === 'walk' || pose === 'carry-walk';
  const carrying = pose === 'carry' || pose === 'carry-walk' || pose === 'sit-carry' || pose === 'eat' || pose === 'drink';
  const kinds = ['idle', 'walk', 'sit', 'carry', 'carry-walk', 'sit-carry'];
  // A looping action window so gestures are visible at any frozen time.
  const start = Math.floor(time / 2500) * 2500;
  const action: AvatarActionView | null = kinds.includes(pose) ? null
    : pose === 'jump' ? createJumpAction('lab', Math.floor(time / 900) * 900)
    : { id: 'lab', kind: pose as AvatarActionKind, startedAt: start, expiresAt: start + 2500 };
  // Base locomotion pose exactly as src/classroom.ts writes it each frame.
  model.group.position.y = seated ? AVATAR_SEATED_Y : avatarJumpHeight(action, time) + (moving ? Math.abs(Math.sin(time * .016)) * .04 : 0);
  model.arms.forEach((arm, index) => arm.rotation.x = carrying ? -1.15 : seated ? -.7 : moving ? Math.sin(time * .016 + index * Math.PI) * .5 : 0);
  model.legs.forEach((leg, index) => leg.rotation.x = seated ? -Math.PI / 2 : moving ? Math.sin(time * .016 + index * Math.PI) * -.4 : 0);
  model.lowerLegs.forEach((leg, index) => leg.rotation.x = seated ? Math.PI / 2 : moving ? Math.max(0, Math.sin(time * .016 + index * Math.PI)) * .2 : 0);
  poseOfficeAvatar(model, time, time, action, moving, carrying, seated);
  if (!carrying) return;
  // The tray and the item lifted to the mouth, as in classroom.ts poseRefreshments.
  const tray = actor.tray ??= createTray(model);
  tray.drink.position.set(-.23, .03, -.02); tray.drink.rotation.set(0, 0, 0); tray.snack.position.set(.15, .075, .01); tray.snack.rotation.set(0, 0, 0);
  const weight = avatarConsumeWeight(action, time, moving);
  if (!weight) return;
  const drinking = pose === 'drink', item = drinking ? tray.drink : tray.snack;
  model.group.updateMatrixWorld(true);
  hand.set(0, AVATAR_HAND_LOCAL_Y, .005); model.forearms[drinking ? 0 : 1].localToWorld(hand); tray.group.worldToLocal(hand);
  hand.x += drinking ? .085 : -.06; hand.y += drinking ? -.065 : .05; hand.z += drinking ? .1 : .02;
  item.position.lerp(hand, weight); item.rotation.x = (drinking ? -.65 : 1.05) * weight;
}

const sections: { draw(time: number): void }[] = [];
const host = document.getElementById('lab')!;
function addSection(id: string, title: string, width: number, height: number, scene: THREE.Scene, camera: THREE.Camera, exposure: number, cast: Actor[], labels?: { text: string; x: number }[]) {
  const section = document.createElement('section'), heading = document.createElement('h2'), canvas = document.createElement('canvas'), wrap = document.createElement('div');
  section.id = id; heading.textContent = title; canvas.width = width; canvas.height = height; wrap.className = 'frame'; wrap.style.width = `${width}px`; wrap.append(canvas);
  for (const label of labels ?? []) { const tag = document.createElement('span'); tag.textContent = label.text; tag.style.left = `${label.x}px`; wrap.append(tag); }
  section.append(heading, wrap); host.append(section);
  const context = canvas.getContext('2d')!;
  sections.push({
    draw(time) {
      cast.forEach(actor => { applyPose(actor, time + (actor.offset ?? 0)); if (happy) actor.model.setExpression('happy', Number(happy)); });
      renderer.toneMappingExposure = exposure; renderer.setSize(width, height, false); renderer.render(scene, camera);
      context.drawImage(renderer.domElement, 0, 0);
    },
  });
}
/** Orthographic line-up; `scale` is pixels per world unit, `cell` the spacing. */
function row(id: string, title: string, people: Cast[], scale = 150, cell = 1.5, wrapAt = 10) {
  if (only && !id.startsWith('grid-') && !only.includes(id)) return;
  for (let offset = 0; offset < people.length; offset += wrapAt) {
    const chunk = people.slice(offset, offset + wrapAt), scene = studioScene(), cast: Actor[] = [];
    // A jump lifts the figure by 1.36: such rows get the headroom and keep the floor where it is.
    const headroom = chunk.some(person => person.pose === 'jump') ? 1.45 : 0;
    const worldWidth = chunk.length * cell, worldHeight = 2.45 + headroom;
    chunk.forEach((person, index) => {
      // Same paint for everyone; the bits above the RGB only vary `lifePhase`,
      // so a row does not blink and flick its ears in unison.
      const model = createOfficeAvatar(person.color ?? 0x7a9bb4 + (offset + index) * 0x1000000, person.appearance);
      model.group.position.x = (index + .5) * cell - worldWidth / 2; model.group.rotation.y = person.yaw ?? -.28;
      scene.add(model.group); cast.push({ model, pose: person.pose ?? 'idle', offset: person.offset });
    });
    const camera = new THREE.OrthographicCamera(-worldWidth / 2, worldWidth / 2, worldHeight / 2, -worldHeight / 2, .1, 30);
    camera.position.set(0, 1.25 + headroom / 2, 8); camera.lookAt(0, 1.02 + headroom / 2, 0);
    addSection(id, offset ? `${title} (계속)` : title, Math.round(worldWidth * scale), Math.round(worldHeight * scale), scene, camera, 1, cast,
      chunk.map((person, index) => ({ text: person.label, x: (index + .5) * cell * scale })));
  }
}

const hero: Cast[] = [
  { label: '기본 사람', appearance: A({ face: 'soft', hairColor: 'chestnut' }) },
  { label: '스트리트 고양이', appearance: A({ species: 'cat', top: 'hoodie-peach', bottom: 'joggers-mint', shoes: 'high-top-purple', headwear: 'cap-mint', backwear: 'backpack-mint' }) },
  { label: '한복', appearance: A({ hair: 'bob', hairColor: 'chestnut', top: 'hanbok-sky', bottom: 'hanbok-pants', shoes: 'maryjane-black', headwear: 'flower-crown', backwear: 'satchel-brown' }) },
  { label: '우주 토끼', appearance: A({ species: 'rabbit', skin: 'porcelain', hairColor: 'rose', top: 'space-silver', bottom: 'space-pants', shoes: 'spaceboots-silver', headwear: 'space-helmet', backwear: 'rocket-pack' }) },
  { label: '오피스', appearance: A({ hair: 'pony', hairColor: 'black', skin: 'tan', top: 'blazer-blue', bottom: 'skirt-navy', shoes: 'loafers-navy', eyewear: 'round-glasses' }) },
];
row('hero', '01 · 대표 캐릭터 (정면 3/4)', hero, 290, 1.45);
const speciesCast: Cast[] = APPEARANCE_OPTIONS.species.map((species, index) => ({
  label: species.label,
  appearance: A({ species: species.id, hair: APPEARANCE_OPTIONS.hair[index % 6].id, hairColor: APPEARANCE_OPTIONS.hairColor[index % 6].id,
    top: (['tank-white', 'cardigan-mint', 'knit-cream', 'blazer-lilac', 'overalls-denim', 'sailor-navy', 'pajama-lavender'] as const)[index],
    bottom: (['shorts-navy', 'trousers-slate', 'pleated-skirt', 'trousers-cream', 'denim-shorts', 'sailor-shorts', 'pajama-shorts'] as const)[index],
    shoes: (['slippers-ivory', 'sneakers-white', 'maryjane-black', 'loafers-cream', 'canvas-red', 'sandals-sand', 'bunny-slippers'] as const)[index] }),
}));
row('species', '02 · 7개 종 (정면)', speciesCast.map(person => ({ ...person, yaw: 0 })), 205);
row('back', '03 · 7개 종 (뒤 3/4 · 옆)', speciesCast.map((person, index) => ({ ...person, yaw: index % 2 ? Math.PI / 2 : Math.PI - .5 })), 205);
row('hair', '04 · 헤어 6종 × 피부 · 얼굴형', APPEARANCE_OPTIONS.hair.map((hair, index) => ({
  label: `${hair.label} · ${APPEARANCE_OPTIONS.face[index % 3].label}`,
  appearance: A({ hair: hair.id, face: APPEARANCE_OPTIONS.face[index % 3].id, skin: APPEARANCE_OPTIONS.skin[index].id, hairColor: APPEARANCE_OPTIONS.hairColor[(index + 2) % 6].id,
    top: (['knit-cream', 'blazer-night', 'cardigan-coral', 'varsity-mint', 'raincoat-yellow', 'chef-white'] as const)[index],
    bottom: (['trousers-plum', 'trousers-ivory', 'skirt-navy', 'joggers-mint', 'cargo-shorts', 'chef-check'] as const)[index],
    shoes: (['sneakers-rose', 'loafers-cream', 'maryjane-black', 'skate-blue', 'rainboots-yellow', 'clogs-mint'] as const)[index] }),
})), 240);

if (!only || only.includes('office')) {
  const scene = officeScene(), cast: Actor[] = [];
  const blobCanvas = document.createElement('canvas'); blobCanvas.width = blobCanvas.height = 64;
  const blobContext = blobCanvas.getContext('2d')!, blobGradient = blobContext.createRadialGradient(32, 32, 2, 32, 32, 31);
  blobGradient.addColorStop(0, 'rgba(255,255,255,1)'); blobGradient.addColorStop(.55, 'rgba(255,255,255,.55)'); blobGradient.addColorStop(1, 'rgba(255,255,255,0)');
  blobContext.fillStyle = blobGradient; blobContext.fillRect(0, 0, 64, 64);
  const blobGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobCanvas), color: 0x16222f, transparent: true, opacity: params.get('blob') === '0' ? 0 : .34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const poses: Pose[] = ['idle', 'walk', 'wave', 'sit', 'cheer', 'walk', 'carry', 'clap', 'idle', 'bow', 'walk', 'sit'];
  const people = [...hero, ...speciesCast];
  poses.forEach((pose, index) => {
    const model = createOfficeAvatar(0x336699 + index * 97, people[index % people.length].appearance);
    model.group.position.set((index % 6 - 2.5) * Number(params.get('gap') ?? 1.55), 0, Math.floor(index / 6) * 2.2 - 1.2);
    model.group.rotation.y = pose === 'walk' ? .58 + index : .58;
    model.group.traverse(part => { if (part instanceof THREE.Mesh) part.castShadow = true; });
    if (params.get('labels')) {
      model.group.add(createAvatarNameLabel(people[index % people.length].label, index === 0, index % 4 === 1 ? { stock: '삼성전자', average: 71200, currency: 'KRW' } : null, avatarLabelY(model)));
      if (index === 0) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(.32, .4, 32), new THREE.MeshBasicMaterial({ color: 0x73b8eb, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = .025; model.group.add(ring);
      }
    }
    // The contact blob of src/classroom.ts (hidden for seated figures there).
    if (pose !== 'sit') { const blob = new THREE.Mesh(blobGeometry, blobMaterial); blob.position.y = .018; blob.scale.set(.84, 1, .66); model.group.add(blob); }
    scene.add(model.group); cast.push({ model, pose });
  });
  // FOLLOW_CAMERA.defaultOffset / focusHeight / FREE_CAMERA.fov from src/office-camera.ts.
  const width = 1500, height = 760, camera = new THREE.PerspectiveCamera(62, width / height, .1, 200);
  camera.position.set(4, 1.05 + 3.4, 6); camera.lookAt(0, 1.05, 0);
  addSection('office', '05 · 실제 사무실 조명 · 기본 추적 카메라 거리 (걷기 · 앉기 · 인사 · 들기)', width, height, scene, camera, 1.1, cast);
}

const grid = params.get('grid');
if (grid) {
  const slots = grid === 'all' ? ['top', 'bottom', 'shoes', 'headwear', 'eyewear', 'neckwear', 'backwear'] : grid.split(',');
  const species = (params.get('species') ?? 'human') as AvatarAppearance['species'];
  for (const slot of slots as AppearanceKey[]) {
    const options = APPEARANCE_OPTIONS[slot].filter(option => option.id !== 'none');
    for (const [suffix, yaw] of slot === 'backwear' ? [['뒤', Math.PI - .45], ['앞', -.28]] as const : [['앞', -.28]] as const)
      row(`grid-${slot}`, `GRID · ${slot} · ${species} · ${suffix}`, options.map(option => ({ label: option.label, yaw, appearance: A({ species, [slot]: option.id } as Partial<AvatarAppearance>) })), 190, 1.5, 8);
  }
}

// Large pose close-ups, only with ?only=poses (and ?yaw=, ?species=, ?set=2).
const who = (params.get('species') ?? 'human') as AvatarAppearance['species'];
const outfit = who === 'human' ? A({ top: 'blazer-blue', bottom: 'trousers-cream', shoes: 'sneakers-white', hair: 'bob' }) : A({ species: who, top: 'hoodie-peach', bottom: 'pleated-skirt', shoes: 'canvas-red' });
if (only?.includes('poses')) {
  const yaw = Number(params.get('yaw') ?? -.5);
  const list: Pose[] = params.get('list') ? params.get('list')!.split(',') as Pose[] : params.get('set') === '2' ? ['dance', 'heart', 'lets-go', 'help-me', 'eat', 'drink', 'jump', 'carry-walk', 'sit-carry'] : ['idle', 'walk', 'sit', 'wave', 'cheer', 'carry', 'bow', 'clap', 'heart'];
  row('poses', '06 · 포즈 클로즈업', list.map((pose, index) => ({ label: pose, pose, yaw, appearance: index % 2 ? outfit : A({ species: who }) })), Number(params.get('scale') ?? 230), 1.45);
}
// The same figure at several moments: reads like an animation contact sheet.
if (only?.includes('strip')) {
  const pose = (params.get('pose') ?? 'walk') as Pose, count = Number(params.get('n') ?? 8), step = Number(params.get('step') ?? 50), yaw = Number(params.get('yaw') ?? -.5);
  row('strip', `07 · ${pose} · ${step}ms 간격`, Array.from({ length: count }, (_, index) => ({ label: `+${index * step}ms`, pose, yaw, offset: index * step, color: 0x7a9bb4, appearance: params.get('plain') ? A({ species: who }) : outfit })), Number(params.get('scale') ?? 230), 1.45);
}

// The real game-room table and jump tower, each with its own renderer and loop.
if (only?.includes('table')) {
  const section = document.createElement('section'), box = document.createElement('div');
  section.innerHTML = '<h2>08 · 게임룸 테이블 (실제 장면)</h2>'; box.className = 'frame'; box.style.cssText = `width:${Number(params.get('w') ?? 1100)}px;height:${Number(params.get('h') ?? 620)}px`; section.append(box); host.append(section);
  void import('../src/game-room-scene').then(({ createGameRoomScene }) => {
    const table = createGameRoomScene(box); box.querySelector('canvas')!.style.cssText = 'width:100%;height:100%;display:block';
    Object.assign(window, { labTable: table }); // for the console: labTable.update([...]) with another roster
    table.update([...hero, ...speciesCast].slice(0, Number(params.get('n') ?? 6)).map((person, index) => ({ id: `guest-${index}`, nickname: person.label, appearance: person.appearance, color: 0x336699 + index * 977, team: index % 2 ? 'A' as const : 'B' as const })));
  });
}
if (only?.includes('tower')) {
  const section = document.createElement('section'), box = document.createElement('div');
  section.innerHTML = '<h2>09 · 점프 타워 (실제 장면)</h2>'; box.className = 'frame'; box.style.cssText = 'position:relative;width:1100px;height:620px'; section.append(box); host.append(section);
  void Promise.all([import('../src/jump-game-scene'), import('../shared/jump-game')]).then(([{ createJumpGameScene }, { createJumpState, JUMP_COURSE }]) => {
    const tower = createJumpGameScene(box, hero[1].appearance); tower.canvas.style.cssText = 'width:100%;height:100%;display:block';
    const state = { ...createJumpState(), vx: params.get('walk') ? 2 : 0 }, floor = JUMP_COURSE[0];
    const peers = speciesCast.slice(1, 4).map((person, index) => ({ id: `peer-${index}`, nickname: person.label, appearance: person.appearance, color: 0x336699 + index * 977, x: floor.x + (index - 1) * .9, y: state.y, z: floor.z - .9, vx: index === 1 ? 1.5 : 0, vy: 0, vz: 0, floor: 0, grounded: true, updatedAt: Date.now() }));
    let last = performance.now();
    const loop = (time: number) => {
      tower.setPeers('me', [{ ...peers[0], id: 'me', nickname: '나', x: state.x, z: state.z }, ...peers.map(peer => ({ ...peer, updatedAt: Date.now() }))] as never);
      tower.render(state, Math.min(.05, (time - last) / 1000), time); last = time; requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
// The real office with a full roster arriving at once. The heading reports how
// long the roster call blocked and the longest frame while the figures were built.
if (only?.includes('room')) {
  const section = document.createElement('section'), heading = document.createElement('h2'), box = document.createElement('div');
  heading.textContent = '11 · 사무실 (실제 장면)'; box.className = 'frame'; box.style.cssText = `position:relative;width:${Number(params.get('w') ?? 1400)}px;height:${Number(params.get('h') ?? 760)}px`; section.append(heading, box); host.append(section);
  void Promise.all([import('../src/classroom'), import('../shared/classroom-layout')]).then(([{ createClassroom }, { ROOM_SPAWN, SEATS }]) => {
    const room = createClassroom(box, { onMove() {}, onInteract() {}, onSit() {}, onStand() {} });
    const count = Number(params.get('n') ?? 50), people = [...hero, ...speciesCast], now = Date.now();
    const gestures: AvatarActionKind[] = ['wave', 'cheer', 'heart', 'clap', 'dance'];
    const players = Array.from({ length: count }, (_, index) => {
      // A sunflower spiral around the spawn point, so near and far visitors are mixed in roster order.
      const turn = index * 2.39996, reach = index ? 1.3 + Math.sqrt((index * 7) % count) * 1.3 : 0;
      return {
        id: `lab-${index}`, nickname: index ? people[index % people.length].label : '나', color: 0x336699 + index * 9973 * 7, appearance: people[index % people.length].appearance,
        x: ROOM_SPAWN.x + Math.sin(turn) * reach, z: ROOM_SPAWN.z + Math.cos(turn) * reach * .8,
        seat: index % 9 === 4 ? SEATS[(index * 3) % SEATS.length].id : null,
        action: index % 5 === 2 ? { id: `lab-action-${index}`, kind: gestures[index % gestures.length], startedAt: now, expiresAt: now + 60000 } : null,
      };
    });
    room.setSelfId('lab-0');
    const started = performance.now(); room.setPlayers(players); const blocked = performance.now() - started;
    if (params.get('far')) { room.setFollow(false); for (let step = 0; step < Number(params.get('far')); step++) room.zoomView(-1); }
    const scene = box.querySelector('canvas')!, sample = { frames: 0, worst: 0, last: performance.now() };
    const watch = (time: number) => {
      sample.frames++; sample.worst = Math.max(sample.worst, time - sample.last); sample.last = time;
      heading.textContent = `11 · 사무실 (실제 장면) · ${count}명 · setPlayers ${blocked.toFixed(0)} ms · ${sample.frames} 프레임 경과 · 가장 긴 프레임 ${sample.worst.toFixed(0)} ms`;
      if (sample.frames < 240 && scene.isConnected) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
}

// Every item thumbnail exactly as the dressing room and the shop render it.
if (only?.includes('thumbs')) {
  const size = Number(params.get('size') ?? 160), slots = (params.get('slots') ?? 'top,bottom,shoes,headwear,eyewear,neckwear,backwear').split(',') as AppearanceKey[];
  void import('../src/avatar-thumbnail-renderer').then(({ createAvatarThumbnailRenderer }) => {
    const engine = createAvatarThumbnailRenderer(size);
    for (const slot of slots) {
      const section = document.createElement('section'), grid = document.createElement('div');
      section.innerHTML = `<h2>10 · 썸네일 · ${slot}</h2>`; grid.style.cssText = `display:grid;grid-template-columns:repeat(${Number(params.get('cols') ?? 9)},${size}px);gap:8px`;
      for (const option of APPEARANCE_OPTIONS[slot]) {
        if (option.id === 'none') continue;
        const figure = document.createElement('figure'), image = new Image(size, size), caption = document.createElement('figcaption');
        figure.style.cssText = 'margin:0;text-align:center;font-size:11px'; image.src = engine.render(slot, option.id); image.style.cssText = 'display:block;border-radius:12px'; caption.textContent = option.label;
        figure.append(image, caption); grid.append(figure);
      }
      section.append(grid); host.append(section);
    }
    engine.dispose(); document.title = 'avatar-lab thumbs ready';
  });
}

function drawAll(time: number) { sections.forEach(section => section.draw(time)); }
if (params.get('animate')) { const loop = (time: number) => { drawAll(time); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
else drawAll(frozen);
document.title = `avatar-lab ready (${sections.length})`;
