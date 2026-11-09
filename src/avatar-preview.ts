import * as THREE from 'three';
import { createOfficeAvatar } from './office-avatar';
import { APPEARANCE_OPTIONS, type AvatarAppearance } from '../shared/avatar-appearance';

/** The dressing room renders the same jointed model used in the office. It only
 * draws on a change, resize or drag; an open picker does not run a second loop. */
export function createAvatarPreview(host: HTMLElement, initial: AvatarAppearance) {
  const root = document.createElement('div');
  root.className = 'avatar-model-preview';
  root.style.cssText = 'position:relative;width:100%;height:100%;min-height:180px;overflow:hidden;border-radius:20px;background:radial-gradient(ellipse at 50% 35%,#fffaf1,#e6e8da);';
  host.append(root);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, powerPreference:'low-power'});
  } catch {
    const fallback = document.createElement('p');
    fallback.textContent = '이 브라우저에서는 3D 미리보기를 열 수 없어요. 선택한 캐릭터 설정은 저장됩니다.';
    fallback.style.cssText = 'padding:28px;color:#3d505a;font-size:14px;line-height:1.6;';
    root.append(fallback);
    return {update(_value: AvatarAppearance) {}, dispose() { root.remove(); }};
  }
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;outline-offset:-3px;';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  root.append(canvas);

  const hint = document.createElement('span');
  hint.textContent = '드래그해서 돌려보기 · ← →';
  hint.style.cssText = 'position:absolute;bottom:12px;left:0;right:0;text-align:center;pointer-events:none;color:#5b6b70;font-size:11px;letter-spacing:.02em;';
  root.append(hint);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfffaf1,0x929b8b,1.3));
  const keyLight = new THREE.DirectionalLight(0xfff4e4,2.3);
  keyLight.position.set(-3,5,5); keyLight.target.position.set(0,1,0);
  scene.add(keyLight,keyLight.target);
  const fill = new THREE.DirectionalLight(0xc8def4,.65);
  fill.position.set(3,2,-2); scene.add(fill);
  const camera = new THREE.OrthographicCamera(-1.6,1.6,1.6,-1.6,.1,20);
  camera.position.set(0,1.6,5); camera.lookAt(0,1,0);
  // A soft contact patch grounds the figure without a second shadow pass.
  // The actual office retains its existing shared, budgeted shadow map.
  const contactCanvas = document.createElement('canvas'); contactCanvas.width = contactCanvas.height = 128;
  const context = contactCanvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64,64,2,64,64,62);
  gradient.addColorStop(0,'rgba(57,75,60,.28)'); gradient.addColorStop(.45,'rgba(57,75,60,.15)'); gradient.addColorStop(1,'rgba(57,75,60,0)');
  context.fillStyle = gradient; context.fillRect(0,0,128,128);
  const contactTexture = new THREE.CanvasTexture(contactCanvas);
  const floorGeometry = new THREE.PlaneGeometry(1.55,1.15);
  const floorMaterial = new THREE.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false});
  const floor = new THREE.Mesh(floorGeometry,floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.y = .005; scene.add(floor);
  let avatar = createOfficeAvatar(0x7a9bb4,initial);
  let yaw = -.28, disposed = false, pendingFrame = 0, pointerId: number | null = null, lastX = 0;
  avatar.group.rotation.y = yaw; scene.add(avatar.group);
  function describe(value: AvatarAppearance) {
    const name = APPEARANCE_OPTIONS.species.find(option=>option.id===value.species)?.label ?? '캐릭터';
    canvas.setAttribute('aria-label',`${name} 3D 미리보기. 드래그 또는 좌우 방향키로 회전합니다.`);
  }
  function draw() {
    pendingFrame = 0;
    if (disposed || renderer.getContext().isContextLost()) return;
    const width = root.clientWidth, height = root.clientHeight;
    if (!width || !height) return;
    const aspect = width / height, halfHeight = Math.max(1.22,.73/aspect);
    camera.left = -halfHeight*aspect; camera.right = halfHeight*aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
    renderer.render(scene,camera);
  }
  function requestDraw() { if (!disposed && !pendingFrame) pendingFrame = requestAnimationFrame(draw); }
  function pointerDown(event: PointerEvent) {
    if (pointerId !== null || (event.pointerType==='mouse' && event.button!==0)) return;
    pointerId=event.pointerId; lastX=event.clientX; canvas.setPointerCapture(event.pointerId); canvas.style.cursor='grabbing';
  }
  function pointerMove(event: PointerEvent) {
    if (pointerId!==event.pointerId) return;
    yaw+=(event.clientX-lastX)*.012; lastX=event.clientX; avatar.group.rotation.y=yaw; requestDraw();
  }
  function pointerEnd(event: PointerEvent) {
    if (pointerId!==event.pointerId) return;
    pointerId=null; canvas.style.cursor='grab';
    if(canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key!=='ArrowLeft' && event.key!=='ArrowRight' && event.key!=='Home') return;
    event.preventDefault(); yaw=event.key==='Home'?-.28:yaw+(event.key==='ArrowLeft'?-.3:.3);
    avatar.group.rotation.y=yaw; requestDraw();
  }
  function contextLost(event: Event) { event.preventDefault(); hint.textContent='3D 미리보기를 다시 연결하고 있어요…'; }
  function contextRestored() { hint.textContent='드래그해서 돌려보기 · ← →'; requestDraw(); }
  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointermove',pointerMove);
  canvas.addEventListener('pointerup',pointerEnd);
  canvas.addEventListener('pointercancel',pointerEnd);
  canvas.addEventListener('lostpointercapture',pointerEnd);
  canvas.addEventListener('keydown',keyboard);
  canvas.addEventListener('webglcontextlost',contextLost);
  canvas.addEventListener('webglcontextrestored',contextRestored);
  const resize = new ResizeObserver(requestDraw); resize.observe(root);
  describe(initial); requestDraw();
  return {
    update(value: AvatarAppearance) {
      if (disposed) return;
      const next=createOfficeAvatar(0x7a9bb4,value);
      next.group.rotation.y=yaw; scene.remove(avatar.group); avatar.dispose(); avatar=next; scene.add(avatar.group);
      describe(value); requestDraw();
    },
    dispose() {
      if (disposed) return;
      disposed=true; resize.disconnect(); cancelAnimationFrame(pendingFrame);
      canvas.removeEventListener('pointerdown',pointerDown); canvas.removeEventListener('pointermove',pointerMove);
      canvas.removeEventListener('pointerup',pointerEnd); canvas.removeEventListener('pointercancel',pointerEnd);
      canvas.removeEventListener('lostpointercapture',pointerEnd); canvas.removeEventListener('keydown',keyboard);
      canvas.removeEventListener('webglcontextlost',contextLost); canvas.removeEventListener('webglcontextrestored',contextRestored);
      avatar.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); contactTexture.dispose(); renderer.dispose(); renderer.forceContextLoss(); root.remove();
    },
  };
}
