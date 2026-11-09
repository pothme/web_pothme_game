import * as THREE from 'three';
import { JUMP_PORTAL, type JumpLeaderView } from '../shared/jump-portal';

export function createJumpPortal() {
  const group = new THREE.Group();
  group.position.set(JUMP_PORTAL.x, 0, JUMP_PORTAL.z);
  group.rotation.y = Math.PI / 2;
  const metal = new THREE.MeshStandardMaterial({ color: 0x122538, roughness: .4, metalness: .55 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8cf1dd });
  function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x,y,z); group.add(mesh); return mesh;
  }
  for (const x of [-1.56,1.56]) { box(.24,4.5,.48,x,2.25,0,metal); box(.055,4.1,.03,x,2.1,.26,glow); }
  box(3.36,.3,.48,0,4.4,0,metal);
  box(2.9,.035,1.5,0,.02,.22,glow);
  const doorway = box(2.85,4.1,.04,0,2.05,0,new THREE.MeshBasicMaterial({color:0x51c5d1,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide}));
  doorway.userData.jumpPortal = true;
  const hit = box(3.35,4.6,.75,0,2.3,0,new THREE.MeshBasicMaterial({visible:false})); hit.userData.jumpPortal=true;
  const canvas = document.createElement('canvas'); canvas.width=768; canvas.height=720;
  const ctx=canvas.getContext('2d')!;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(4.05,3.8),new THREE.MeshBasicMaterial({map:texture}));
  sign.position.set(-4.05,2.55,.28);group.add(sign);
  box(4.22,3.98,.3,-4.05,2.55,.08,metal);
  function setLeaderboard(leaders: JumpLeaderView[]) {
    ctx.fillStyle='#091a29';ctx.fillRect(0,0,768,720);
    ctx.fillStyle='#8cf1dd';ctx.font='600 22px sans-serif';ctx.fillText('PODEUM ARCADE / 60 FLOORS',45,55);
    ctx.fillStyle='#f1f7ff';ctx.font='800 64px sans-serif';ctx.fillText('점프 타워',45,140);
    ctx.fillStyle='#91a9bd';ctx.font='25px sans-serif';ctx.fillText('문을 통과해서 도전하세요  →',45,190);
    ctx.strokeStyle='#2e465b';ctx.beginPath();ctx.moveTo(45,225);ctx.lineTo(723,225);ctx.stroke();
    ctx.fillStyle='#8cf1dd';ctx.font='700 24px sans-serif';ctx.fillText('TOP 3  ·  최고 도달 층',45,275);
    for(let i=0;i<3;i++) {
      const y=338+i*83, leader=leaders[i];
      ctx.fillStyle=i===0?'#f6d995':'#91a9bd';ctx.font='700 30px sans-serif';ctx.fillText(String(i+1).padStart(2,'0'),45,y);
      ctx.fillStyle='#e8f2ff';ctx.font='600 28px sans-serif';ctx.fillText(leader?[...leader.nickname].slice(0,12).join(''):'첫 도전자를 기다려요',112,y,450);
      if(leader){ctx.fillStyle='#8cf1dd';ctx.textAlign='right';ctx.fillText(`${leader.bestFloor}F`,723,y);ctx.textAlign='left';}
    }
    ctx.fillStyle='#91a9bd';ctx.font='23px sans-serif';ctx.fillText('각 층 +1 PT   정상 +300 PT',45,610);
    ctx.font='20px sans-serif';ctx.fillText('캐릭터당 최초 1회 · 10층마다 재시작 지점',45,655);
    texture.needsUpdate=true;
  }
  setLeaderboard([]);
  return {group,hit,setLeaderboard};
}
