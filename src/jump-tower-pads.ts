import * as THREE from 'three';
import { JUMP_COURSE, JUMP_RULES, JUMP_TIMING, JUMP_ZONES, type JumpPlatform, type JumpPlatformView, type JumpState } from '../shared/jump-game';
import { Kit } from './jump-tower-kit';
import { JUMP_THEMES, jumpThemeIndexOf, type JumpTheme } from './jump-tower-themes';

/** Trap paint is the same in every zone: red strikes, amber warns, steel carries. */
const C={danger:0xe5584e,dangerDeep:0xb5403b,white:0xfbf7ee,warn:0xffc247,metal:0x97a5b2,steel:0x64717e,dark:0x39434d,ice:0xc9f1f7,iceDeep:0x8fd6e8,belt:0x4b5661,beltMark:0xffd45e,spring:0xf4cc52,holo:0xb9a0f2,lift:0x74cf9a,orbit:0x63c2c8,move:0x62b2dd,fire:0xff8a2a,fireCore:0xffe36b,gold:0xf6c84f};
const TAU=Math.PI*2;
const modulo=(value:number,by:number)=>((value%by)+by)%by;
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const mix=(a:number,b:number,t:number)=>{const x=new THREE.Color(a),y=new THREE.Color(b);return x.lerp(y,t).getHex();};
const extent=(p:JumpPlatform,x:number,z:number)=>Math.abs(x)*p.width+Math.abs(z)*p.depth;
/** Distance from the pad centre to its edge along a direction. */
const edge=(p:JumpPlatform,x:number,z:number)=>Math.min(Math.abs(x)>1e-6?p.width/2/Math.abs(x):Infinity,Math.abs(z)>1e-6?p.depth/2/Math.abs(z):Infinity);

export type PadLook='solid'|'warn'|'faded'|'ghost';
/** `targetFloor` is the pad the climber is heading for; the camera position decides which side of a pad faces the viewer. */
export interface PadFrame {tick:number;time:number;reduced:boolean;targetFloor:number;cameraX:number;cameraZ:number;state:Pick<JumpState,'crumbleAt'|'lastBounceTick'|'lastFloor'|'standingFloor'>}
export interface PadModel {
  definition:JumpPlatform;root:THREE.Group;label:THREE.Sprite;
  /** Height of the tallest part above the surface: camera framing and occlusion. */
  height:number;
  update(view:JumpPlatformView,look:PadLook,frame:PadFrame):void;
  dispose():void;
}
export type PadMaterials=ReturnType<typeof createPadMaterials>;

export function createPadMaterials(){
  const solid=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78});
  const warn=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78,color:0xffc56e,emissive:0xff8a00,emissiveIntensity:.5});
  const faded=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,transparent:true,opacity:.1,depthWrite:false});
  // Tall frames of pads already passed: still there, but never a wall in front of the climber.
  const thin=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,transparent:true,opacity:.2,depthWrite:false});
  const ghost=new THREE.MeshBasicMaterial({color:0xe6eef5,transparent:true,opacity:.17,depthWrite:false});
  const glow=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});
  const beam=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.92,depthWrite:false,toneMapped:false});
  const flame=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.9,depthWrite:false,toneMapped:false});
  const streak=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.86,depthWrite:false,toneMapped:false});
  // One warning sign for every pad: a triangle with an exclamation mark, readable without colour.
  const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const ctx=canvas.getContext('2d')!;
  ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(48,10);ctx.lineTo(88,82);ctx.lineTo(8,82);ctx.closePath();ctx.fillStyle='#ffc533';ctx.strokeStyle='#2f2a25';ctx.lineWidth=9;ctx.stroke();ctx.fill();
  ctx.fillStyle='#2f2a25';ctx.beginPath();ctx.roundRect(43,30,10,28,4);ctx.fill();ctx.beginPath();ctx.arc(48,69,6,0,TAU);ctx.fill();
  const alertTexture=new THREE.CanvasTexture(canvas);alertTexture.colorSpace=THREE.SRGBColorSpace;
  const alert=new THREE.SpriteMaterial({map:alertTexture,depthTest:false,depthWrite:false,toneMapped:false});
  const all=[solid,warn,faded,thin,ghost,glow,beam,flame,streak,alert];
  return{solid,warn,faded,thin,ghost,glow,beam,flame,streak,alert,
    /** Shared pulse of every warning light. */
    pulse(time:number,reduced:boolean){const wave=reduced?.6:.5+.5*Math.sin(time*.02);warn.emissiveIntensity=.18+wave*.62;alert.opacity=reduced?1:.72+.28*wave;return wave;},
    dispose(){all.forEach(material=>material.dispose());alertTexture.dispose();}};
}

const dummy=new THREE.Object3D();
function place(mesh:THREE.InstancedMesh,index:number,x:number,y:number,z:number,ry:number,sx:number,sy:number,sz:number){
  dummy.position.set(x,y,z);dummy.rotation.set(0,ry,0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
}

function drawLabel(definition:JumpPlatform){
  const canvas=document.createElement('canvas');canvas.width=176;canvas.height=72;const ctx=canvas.getContext('2d')!;
  const marks=definition.need==='double'?2:definition.need==='single'?0:1,width=marks?168:132,left=(176-width)/2;
  ctx.fillStyle=definition.rest?'rgba(255,249,224,.97)':'rgba(252,251,244,.96)';ctx.beginPath();ctx.roundRect(left,5,width,62,22);ctx.fill();
  ctx.strokeStyle=definition.rest?'rgba(214,160,52,.9)':'rgba(52,84,94,.28)';ctx.lineWidth=4;ctx.stroke();
  ctx.fillStyle=definition.rest?'#8a5a12':'#2f4c55';ctx.font='800 34px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(definition.floor===0?"출발":`${definition.floor}F`,marks?left+62:88,38);
  // How to get here, drawn rather than written: two chevrons = double jump, one = ride the lift or the spring.
  if(marks){
    ctx.strokeStyle=definition.need==='double'?'#d9534a':definition.need==='lift'?'#2f9a64':'#c8931a';ctx.lineWidth=7;ctx.lineCap='round';ctx.lineJoin='round';
    for(let i=0;i<marks;i++){const y=(marks===2?30:38)+i*16;ctx.beginPath();ctx.moveTo(left+118,y+7);ctx.lineTo(left+134,y-7);ctx.lineTo(left+150,y+7);ctx.stroke();}
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
function drawBanner(title:string,subtitle:string,theme:JumpTheme){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=144;const ctx=canvas.getContext('2d')!,hex=(value:number)=>`#${value.toString(16).padStart(6,'0')}`;
  ctx.fillStyle=hex(mix(theme.dark,0x18212c,.6));ctx.beginPath();ctx.roundRect(6,6,500,132,30);ctx.fill();ctx.strokeStyle=hex(theme.rim);ctx.lineWidth=7;ctx.stroke();
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=hex(mix(theme.rim,0xffffff,.45));ctx.font='700 30px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';ctx.fillText(subtitle,256,44);
  ctx.fillStyle='#ffffff';ctx.font='800 50px "Malgun Gothic","Apple SD Gothic Neo",sans-serif';ctx.fillText(title,256,96);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

/** The slab itself, dressed for its zone. The walkable top is always y = 0. */
function slab(kit:Kit,p:JumpPlatform,theme:JumpTheme,top:number,rim:number){
  const w=p.width,d=p.depth,small=Math.min(w,d),b=.11;
  kit.box(top,0,-.05,0,w-b*2,.1,d-b*2);
  for(const side of [-1,1]){kit.box(rim,0,-.055,side*(d/2-b/2),w,.11,b);kit.box(rim,side*(w/2-b/2),-.055,0,b,.11,d-b*2);}
  kit.box(theme.side,0,-.24,0,w-.07,.27,d-.07);
  const id=theme.id;
  if(id==='garden'){kit.cyl(mix(theme.side,0x000000,.12),0,-.6,0,small*.36,small*.1,.48,7);for(const [x,z] of [[-1,-1],[1,1],[1,-1]] as const)kit.ball(theme.dark,x*(w/2-.2),.03,z*(d/2-.2),.14,.07,.14,5);kit.ball(theme.accent,w/2-.24,.07,d/2-.3,.07,.05,.07,5);}
  else if(id==='cliff'){kit.box(mix(theme.side,0x000000,.15),.1,-.5,0,w*.7,.3,d*.62,.3);kit.box(theme.dark,-.15,-.72,.1,w*.4,.24,d*.36,.9);kit.box(mix(theme.side,0xffffff,.25),0,-.2,0,w-.05,.05,d-.05);}
  else if(id==='bridge'){const planks=Math.max(3,Math.round(w/.55));for(let i=0;i<planks;i++)kit.box(i%2?mix(top,0x000000,.09):mix(top,0xffffff,.08),-w/2+b+(i+.5)*(w-b*2)/planks,.002,0,(w-b*2)/planks-.03,.012,d-b*2);
    for(const x of [-1,1]){kit.box(theme.dark,x*w*.3,-.44,0,.16,.16,d+.2);for(const z of [-1,1])kit.cyl(theme.accent,x*(w/2-.07),.06,z*(d/2-.07),.07,.07,.14,6);}}
  else if(id==='factory'){for(const x of [-1,1])for(const z of [-1,1]){kit.box(theme.dark,x*(w/2-b/2),-.05,z*(d/2-.34),b+.004,.112,.14);kit.box(theme.dark,x*(w/2-.34),-.05,z*(d/2-b/2),.14,.112,b+.004);kit.cyl(theme.side,x*(w/2-.26),.012,z*(d/2-.26),.045,.045,.03,6);}
    kit.box(theme.dark,0,-.46,0,w*.8,.2,.2);kit.box(theme.side,0,-.58,0,w*.8,.06,.46);kit.box(theme.dark,0,-.46,0,.2,.2,d*.8);}
  else if(id==='sky'){for(const [x,z,s] of [[-.3,-.2,.5],[.28,.22,.46],[.3,-.28,.36],[-.26,.3,.38],[0,0,.55]] as const)kit.ball(0xffffff,x*w,-.42,z*d,s*small*.6,.26,s*small*.6,7);}
  else if(id==='shaft'){kit.box(theme.dark,0,-.5,0,w*.66,.26,d*.66);kit.box(mix(theme.side,0x000000,.2),0,-.7,0,w*.36,.16,d*.36);for(const x of [-1,1])kit.box(theme.accent,x*(w/2-.03),-.2,0,.05,.1,d*.4);}
  else if(id==='ridge'){kit.cyl(theme.side,0,-.66,0,small*.4,small*.08,.6,6);for(const [x,z] of [[-1,1],[1,-1]] as const)kit.ball(0xffffff,x*(w/2-.3),.02,z*(d/2-.3),.24,.08,.2,5);}
  else if(id==='storm'){kit.cyl(theme.dark,0,-.62,0,small*.38,small*.12,.5,6);kit.cyl(theme.accent,0,-1,0,.09,0,.3,5);for(const x of [-1,1])kit.cyl(theme.rim,x*(w/2-.1),.08,-(d/2-.1),.025,.035,.16,5);}
  else if(id==='ruins'){kit.box(mix(top,0x000000,.07),-w*.2,.002,-d*.18,w*.34,.012,d*.3);kit.box(mix(top,0xffffff,.1),w*.18,.002,d*.2,w*.3,.012,d*.32);kit.ball(theme.rim,w/2-.34,.01,-d/2+.34,.3,.04,.24,6);kit.cyl(theme.side,0,-.72,0,small*.2,small*.24,.7,8);kit.box(theme.dark,0,-1.1,0,small*.56,.1,small*.56);}
  else{kit.box(theme.side,0,-.45,0,w*.78,.16,d*.78);kit.cyl(theme.dark,0,-.72,0,small*.3,small*.06,.4,6);kit.ball(theme.accent,0,-.98,0,.13,.16,.13,6);for(const x of [-1,1])for(const z of [-1,1])kit.ball(theme.side,x*(w/2-b/2),.01,z*(d/2-b/2),.09,.06,.09,6);}
}

/** Builds one pad: a merged static body, a few merged moving parts and its
 * label. `update` only poses those parts from the shared view of this tick. */
export function createPadModel(definition:JumpPlatform,materials:PadMaterials):PadModel {
  const p=definition,w=p.width,d=p.depth,small=Math.min(w,d);
  const theme=JUMP_THEMES[jumpThemeIndexOf(p.floor)]!;
  const root=new THREE.Group(),group=new THREE.Group(),scaled=new THREE.Group(),parts=new THREE.Group();root.add(group);group.add(scaled,parts);
  const geometries:THREE.BufferGeometry[]=[],textures:THREE.Texture[]=[],owned:THREE.Material[]=[];
  const body=new Kit(),fixed=p.motion==='shrink'?new Kit():body,anchor=new Kit(),core=new Kit();
  const animators:((view:JumpPlatformView,frame:PadFrame)=>void)[]=[];
  const mesh=(kit:Kit,material:THREE.Material=materials.solid,parent:THREE.Object3D=parts)=>{const geometry=kit.build();geometries.push(geometry);const value=new THREE.Mesh(geometry,material);parent.add(value);return value;};
  const flow=(geometry:THREE.BufferGeometry,material:THREE.Material,count:number)=>{const value=new THREE.InstancedMesh(geometry,material,count);value.frustumCulled=false;parts.add(value);return value;};
  let height=.5,alertX=0,alertY=1.25,alertZ=-d*.32;
  const inside=(x:number,z:number,margin:number)=>Math.abs(x)<=w/2-margin&&Math.abs(z)<=d/2-margin;

  // Surface and motion decide the colour of the walkable top, so a mechanic reads before its details do.
  const top=p.surface==='ice'?C.ice:p.surface==='conveyor'?C.belt:p.motion==='blink'?mix(theme.top,C.holo,.55):p.motion==='crumble'?mix(theme.top,0xd9b98c,.6):theme.top;
  const rim=p.surface==='ice'?0xffffff:p.surface==='conveyor'?C.metal:p.motion==='blink'?0xe9dcff:p.rest?C.gold:theme.rim;

  let springMesh:THREE.Mesh|null=null,debris:THREE.Mesh|null=null;
  if(p.surface==='spring'){
    // The whole pad is the spring: a base, a coil and a striped cap that squashes when someone lands.
    body.box(C.steel,0,-.47,0,w,.08,d);
    const cap=new Kit(),radius=small*.44;
    for(let i=0;i<3;i++)cap.torus(i%2?C.metal:C.white,0,-.38+i*.09,0,radius*.7,.045);
    cap.box(C.danger,0,-.07,0,w-.12,.14,d-.12);
    for(const side of [-1,1]){cap.box(C.white,0,-.07,side*(d/2-.03),w,.14,.06);cap.box(C.white,side*(w/2-.03),-.07,0,.06,.14,d-.12);}
    cap.ring(C.spring,0,.004,0,radius*.55,radius*.84,24);cap.cyl(C.spring,0,.004,0,radius*.28,radius*.28,.008,14);
    for(const [x,z,ry] of [[1,0,0],[-1,0,Math.PI],[0,1,-Math.PI/2],[0,-1,Math.PI/2]] as const)cap.chevron(C.white,x*radius*.69,.006,z*radius*.69,radius*.2,ry,.012);
    springMesh=mesh(cap,materials.solid,scaled);
  }else slab(body,p,theme,top,rim);

  // ---- motion ----
  if(p.motion==='moving'){
    const ry=-Math.atan2(p.dirZ,p.dirX),reach=edge(p,p.dirX,p.dirZ);
    for(const side of [-1,1]){body.chevron(C.move,p.dirX*side*reach*.56,.008,p.dirZ*side*reach*.56,small*.2,ry+(side<0?Math.PI:0));body.cyl(C.steel,p.dirX*side*(reach+.03),-.2,p.dirZ*side*(reach+.03),.09,.09,.2,8);}
    const length=p.amplitude*2+reach*2+.3;anchor.box(C.steel,0,-.56,0,length,.07,.12,ry);
    for(const side of [-1,1]){anchor.box(C.move,p.dirX*side*length/2,-.5,p.dirZ*side*length/2,.12,.2,.3,ry);}
  }else if(p.motion==='lift'){
    for(const [x,z] of [[-1,-1],[1,1]] as const){
      const px=x*(w/2+.09),pz=z*(d/2+.09);
      anchor.cyl(C.steel,px,p.amplitude/2+.2,pz,.045,.045,p.amplitude+1.6,6);anchor.cyl(C.lift,px,p.amplitude+1.05,pz,.1,.1,.1,8);anchor.cyl(C.lift,px,-.6,pz,.1,.1,.1,8);
      for(let mark=1;mark<p.amplitude;mark++)anchor.cyl(C.white,px,mark,pz,.06,.06,.05,6);
      body.box(C.lift,px,-.19,pz,.24,.36,.24);
    }
    for(const side of [-1,1]){body.box(C.lift,side*(w/2-.03),-.21,0,.012,.12,d*.5);body.box(C.lift,0,-.21,side*(d/2-.03),w*.5,.12,.012);}
    body.chevron(C.lift,0,.008,0,small*.3,Math.PI/2);body.chevron(C.lift,0,.008,small*.2,small*.3,Math.PI/2);
    height=Math.max(height,1.2);
  }else if(p.motion==='orbit'){
    anchor.torus(C.steel,0,-.56,0,p.amplitude,.035,0,0,0,28);anchor.cyl(C.orbit,0,-.5,0,.16,.2,.26,10);
    body.ring(C.orbit,0,.008,0,small*.2,small*.27,20);body.chevron(C.orbit,small*.235,.009,0,small*.16,(p.period<0?1:-1)*Math.PI/2);
    const arm=new Kit();arm.box(C.steel,p.amplitude/2,-.5,0,p.amplitude,.07,.1);arm.cyl(C.orbit,p.amplitude,-.44,0,.09,.09,.18,8);
    const armMesh=mesh(arm,materials.solid,root);armMesh.position.set(p.x,p.y,p.z);animators.push(view=>{armMesh.rotation.y=-view.orbitAngle;});
  }else if(p.motion==='blink'){
    for(const x of [-1,1])for(const z of [-1,1]){body.cyl(C.holo,x*(w/2-.13),.03,z*(d/2-.13),.07,.09,.07,6);}
    body.box(0xe9dcff,0,.006,0,w*.62,.012,.04);body.box(0xe9dcff,0,.006,0,.04,.012,d*.62);body.ring(0xe9dcff,0,.007,0,small*.14,small*.18,16);
  }else if(p.motion==='crumble'){
    for(const [ry,x,z,length] of [[.5,-.1,.1,.72],[-.75,.2,-.12,.5],[1.9,-.25,-.2,.34],[2.6,.22,.24,.3]] as const)body.box(theme.dark,x*w,.006,z*d,length*small,.012,.035,ry);
    for(const [x,z] of [[-.42,.3],[.38,-.36],[.1,.44]] as const)body.box(mix(top,0x000000,.2),x*w,-.44,z*d,.26,.16,.22,x*5);
    // The same slab cut into pieces: shown only while it is falling away.
    const chunks=new Kit();
    for(let ix=0;ix<3;ix++)for(let iz=0;iz<2;iz++)chunks.box((ix+iz)%2?top:mix(top,0x000000,.12),(ix-1)*w/3,-.19+((ix*3+iz)%3)*.05,(iz-.5)*d/2,w/3-.07,.36,d/2-.07,((ix*5+iz*3)%5-2)*.07,((ix+iz)%3-1)*.1);
    debris=mesh(chunks,materials.solid,group);debris.visible=false;
  }else if(p.motion==='shrink'){
    const size=small*p.amplitude;
    // The part that never goes away keeps its size while everything else on the deck shrinks with it.
    core.box(mix(theme.top,C.holo,.7),0,.006,0,size*.92,.014,size*.92);core.ring(C.white,0,.016,0,size*.2,size*.27,16);
    for(const [x,z,ry] of [[1,0,Math.PI],[-1,0,0],[0,1,Math.PI/2],[0,-1,-Math.PI/2]] as const)body.chevron(C.holo,x*w*.41,.008,z*d*.41,small*.13,ry);
  }

  // ---- surface ----
  let belt:THREE.InstancedMesh|null=null;
  if(p.surface==='ice'){
    for(const [ry,x,z,length] of [[.6,-.18,-.1,.5],[.6,.14,.2,.34],[.6,.26,-.26,.2]] as const)body.box(0xffffff,x*w,.006,z*d,length*small,.012,.05,ry);
    const count=Math.max(6,Math.round((w+d)*1.7));
    for(let i=0;i<count;i++){const t=i/count*4,side=Math.floor(t),f=t-side-.5,x=side===0?f*w:side===2?-f*w:side===1?w/2-.06:-w/2+.06,z=side===1?f*d:side===3?-f*d:side===0?d/2-.06:-d/2+.06,length=.2+((i*7)%5)*.07;body.cyl(C.iceDeep,x*.94,-.4-length/2,z*.94,.055,0,length,5);}
    for(const [x,z] of [[-1,-1],[1,1]] as const)body.ball(0xffffff,x*(w/2-.26),.02,z*(d/2-.26),.2,.07,.17,5);
  }else if(p.surface==='conveyor'){
    const chevron=new Kit();chevron.chevron(C.beltMark,0,.014,0,1,0,.02);const geometry=chevron.build();geometries.push(geometry);
    const reach=edge(p,p.dirX,p.dirZ)-.12,count=Math.max(3,Math.round(reach*2/.6)),size=Math.min(.62,small*.3),ry=-Math.atan2(p.dirZ,p.dirX);
    const marks=belt=flow(geometry,materials.solid,count);
    for(const side of [-1,1])body.cyl(C.metal,p.dirX*side*reach,-.02,p.dirZ*side*reach,.05,.05,small*.5,8,Math.PI/2,ry);
    animators.push((_,frame)=>{
      const travel=frame.tick*JUMP_RULES.stepMs/1000*p.belt,spacing=reach*2/count;
      for(let i=0;i<count;i++){const along=modulo(i*spacing+travel,reach*2)-reach,fade=clamp01(Math.min(along+reach,reach-along)/.3);place(marks,i,p.dirX*along,0,p.dirZ*along,ry,size*fade,1,size*(.4+.6*fade));}
      marks.instanceMatrix.needsUpdate=true;
    });
  }

  // ---- hazard ----
  const hx=p.hazDirX,hz=p.hazDirZ,yaw=-Math.atan2(hz,hx),along=extent(p,hx,hz),across=extent(p,-hz,hx);
  /** Hazard frame: `a` along the hazard axis, `c` across it. */
  const fx=(a:number,c:number)=>a*hx-c*hz,fz=(a:number,c:number)=>a*hz+c*hx;
  const cycle=(tick:number)=>p.hazardPeriod?modulo(tick+p.hazardPhase,p.hazardPeriod)/p.hazardPeriod:0;
  const wobble=(frame:PadFrame,amount:number)=>frame.reduced?0:Math.sin(frame.time*.09)*amount;
  if(p.hazard==='spikes'){
    const t=JUMP_TIMING.spikes,halfA=along*t.strip,halfC=across*t.span,rows=Math.max(2,Math.round(halfA*2/.3)),columns=Math.max(3,Math.round(halfC*2/.3)),spikes=new Kit(),peek=new Kit(),plate=new Kit();
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
      const a=-halfA+(i+.5)*halfA*2/rows,c=-halfC+(j+.5)*halfC*2/columns,x=fx(a,c),z=fz(a,c);if(!inside(x,z,.1))continue;
      fixed.cyl(C.dark,x,.008,z,.1,.1,.016,6);spikes.cyl(C.danger,x,.21,z,.05,.11,.42,6);spikes.cyl(C.white,x,.6,z,0,.05,.36,6);peek.cyl(C.warn,x,.085,z,0,.08,.17,6);
    }
    for(const side of [-1,1])for(let j=0;j<columns*2;j++){const c=-halfC+(j+.5)*halfC/columns,x=fx(side*(halfA+.06),c),z=fz(side*(halfA+.06),c);if(inside(x,z,.1))fixed.box(j%2?C.danger:C.white,x,.007,z,.05,.014,halfC/columns,yaw);}
    // Amber warns, red strikes: short amber tips on an amber strip first, then tall red spikes on a red strip.
    plate.shade=0;plate.box(0xffffff,0,.02,0,halfA*2+.08,.008,halfC*2+.04,yaw);
    const plateMaterial=new THREE.MeshBasicMaterial({color:C.warn,transparent:true,opacity:.4,depthWrite:false,toneMapped:false});owned.push(plateMaterial);
    const spikeMesh=mesh(spikes),peekMesh=mesh(peek),plateMesh=mesh(plate,plateMaterial);alertX=0;alertZ=0;alertY=1.2;height=Math.max(height,.85);
    animators.push((view,frame)=>{
      const u=cycle(frame.tick),on=view.hazardActive,warned=view.hazardWarning&&!on;
      // They are never short while they can hurt: the first and last dangerous ticks already stand tall, with a small overshoot.
      const rise=on?Math.min(1,.7+(u-t.onAt)*p.hazardPeriod/5)*(1+.16*Math.max(0,1-(u-t.onAt)*p.hazardPeriod/9))*Math.min(1,.7+(t.offAt-u)*p.hazardPeriod/5):0;
      spikeMesh.visible=on;spikeMesh.scale.y=Math.max(.01,rise);
      // Tips peek out and rattle during the warning.
      peekMesh.visible=warned;if(warned){peekMesh.scale.y=1+.45*Math.abs(wobble(frame,1));peekMesh.position.x=wobble(frame,.012);}
      plateMesh.visible=on||warned;plateMaterial.color.setHex(on?C.danger:C.warn);plateMaterial.opacity=on?.66:frame.reduced?.4:.28+.24*Math.abs(Math.sin(frame.time*.01));
    });
  }else if(p.hazard==='sweep'){
    const t=JUMP_TIMING.sweep,half=small*t.reach,bar=new Kit(),segments=6;
    fixed.cyl(C.dark,0,.03,0,.24,.28,.06,12);
    bar.cyl(C.steel,0,.2,0,.14,.18,.4,10);bar.cyl(C.warn,0,.43,0,.1,.14,.08,10);
    for(let i=0;i<segments;i++)bar.cyl(i%2?C.white:C.danger,-half+(i+.5)*half*2/segments,.26,0,t.halfThickness*.88,t.halfThickness*.88,half*2/segments,10,0,0,Math.PI/2);
    for(const side of [-1,1])bar.ball(C.warn,side*half,.26,0,t.halfThickness*1.08,t.halfThickness*1.08,t.halfThickness*1.08,8);
    const barMesh=mesh(bar);height=Math.max(height,.55);
    animators.push(view=>{barMesh.rotation.y=-view.sweepAngle;});
  }else if(p.hazard==='pusher'){
    const half=along/2,headWidth=small*.68,head=new Kit(),rod=new Kit(),lamp=new Kit(),back=-half-.95;
    fixed.box(C.steel,fx(back,0),.36,fz(back,0),.5,.8,headWidth+.24,yaw);fixed.box(C.dark,fx(back+.26,0),.36,fz(back+.26,0),.04,.5,headWidth*.5,yaw);
    fixed.box(C.steel,fx(-half-.55,0),-.3,fz(-half-.55,0),1.2,.14,headWidth*.7,yaw);
    for(let i=0;i<3;i++){const a=-half+.55+i*((half+.2)/3),x=fx(a,0),z=fz(a,0);if(inside(x,z,.05))fixed.chevron(C.danger,x,.007,z,headWidth*.42,yaw,.014);}
    head.box(C.danger,0,.36,0,.5,.62,headWidth);head.box(C.white,.27,.36,0,.07,.66,headWidth+.04);
    for(const c of [-1,0,1])head.box(C.danger,.3,.36,c*headWidth*.3,.03,.66,headWidth*.14);
    rod.box(C.metal,.5,.36,0,1,.14,.14);rod.box(C.metal,.5,.36,0,1,.07,.3);
    lamp.ball(C.warn,fx(back,0),.84,fz(back,0),.13,.13,.13,8);
    const headMesh=mesh(head),rodMesh=mesh(rod),lampMesh=mesh(lamp,materials.glow);headMesh.rotation.y=rodMesh.rotation.y=yaw;
    alertX=fx(back,0);alertZ=fz(back,0);alertY=1.5;height=Math.max(height,.9);
    animators.push((view,frame)=>{
      // The head is drawn where the shared view puts it; the warning only pulls it back and shakes it.
      const windUp=view.hazardWarning?-.1+wobble(frame,.025):0,travel=(view.pusherX-view.x)*hx+(view.pusherZ-view.z)*hz+windUp;
      headMesh.position.set(hx*travel,0,hz*travel);
      const start=back+.25;rodMesh.position.set(hx*start,0,hz*start);rodMesh.scale.x=Math.max(.02,travel-.25-start);
      lampMesh.visible=view.hazardWarning||view.hazardActive;
    });
  }else if(p.hazard==='wind'){
    const reach=edge(p,hx,hz),fanA=-reach-.6,blades=new Kit(),streak=new Kit();
    fixed.torus(C.steel,fx(fanA,0),.78,fz(fanA,0),.62,.07,0,yaw,Math.PI/2,16);fixed.cyl(C.steel,fx(fanA,0),-.05,fz(fanA,0),.07,.1,.5,6);
    fixed.box(C.steel,fx(-reach-.3,0),-.3,fz(-reach-.3,0),.8,.12,.4,yaw);fixed.box(C.dark,fx(fanA-.1,0),.78,fz(fanA-.1,0),.06,1.2,.07,yaw);fixed.box(C.dark,fx(fanA-.1,0),.78,fz(fanA-.1,0),.06,.07,1.2,yaw);
    // Floor arrows march downwind while it blows, so the push and its direction read on any sky.
    const mark=new Kit();mark.chevron(mix(C.move,0xffffff,.25),0,.016,0,1,0,.02);const markGeometry=mark.build();geometries.push(markGeometry);
    const lane=Math.max(.3,reach-.12),lanes=Math.max(3,Math.round(lane*2/.62)),marks=flow(markGeometry,materials.solid,lanes),markSize=Math.min(.6,small*.2);let march=0,marchTick=-1;
    for(let i=0;i<3;i++)blades.box(i?C.white:C.warn,0,Math.cos(i*TAU/3)*.27,Math.sin(i*TAU/3)*.27,.05,.5,.2,0,i*TAU/3);
    blades.cyl(C.danger,.04,0,0,.05,.12,.14,8,0,0,-Math.PI/2);
    const holder=new THREE.Group();holder.position.set(fx(fanA,0),.78,fz(fanA,0));holder.rotation.y=yaw;parts.add(holder);const bladeMesh=mesh(blades,materials.solid,holder);
    // A white gust with a deep blue edge: visible against pale skies and white pads alike.
    streak.shade=0;streak.box(0xffffff,0,0,0,1,.06,.1);for(const side of [-1,1])streak.box(0x2f7fc4,0,side*.042,0,1,.026,.13);streak.box(0x2f7fc4,.5,0,0,.05,.11,.13);
    const streakGeometry=streak.build();geometries.push(streakGeometry);
    const count=12,streaks=flow(streakGeometry,materials.streak,count),length=along+JUMP_TIMING.wind.margin*2+.6;let spin=p.floor;
    alertX=fx(fanA,0);alertZ=fz(fanA,0);alertY=1.75;height=Math.max(height,1.4);
    animators.push((view,frame)=>{
      const gust=Math.hypot(view.windX,view.windZ)/Math.max(.1,p.power),power=view.hazardActive?.25+gust*.75:view.hazardWarning?.22:.03;
      spin+=frame.reduced?0:power*.9;bladeMesh.rotation.x=spin;
      const ticks=marchTick<0?0:Math.max(0,Math.min(10,frame.tick-marchTick));marchTick=frame.tick;march+=ticks*JUMP_RULES.stepMs/1000*Math.hypot(view.windX,view.windZ)*.9;
      for(let i=0;i<lanes;i++){const a=modulo(i*lane*2/lanes+march,lane*2)-lane,fade=clamp01(Math.min(a+lane,lane-a)/.3);place(marks,i,fx(a,0),0,fz(a,0),yaw,markSize*fade,1,markSize*(.4+.6*fade));}
      marks.instanceMatrix.needsUpdate=true;
      streaks.visible=view.hazardActive||view.hazardWarning;if(!streaks.visible)return;
      // Streaks cover exactly the volume that pushes: the pad plus its margin, up to wind height.
      const drift=frame.tick*JUMP_RULES.stepMs/1000*(view.hazardActive?p.power*2.4:.7);
      for(let i=0;i<count;i++){
        const a=modulo(i*length/count*1.7+drift,length)-length/2-.1,c=((i*5)%count/(count-1)-.5)*across*.86,y=.3+((i*7)%count)/count*1.35,fade=clamp01(Math.min(a+length/2+.1,length/2-.1-a)/.5);
        place(streaks,i,fx(a,c),y,fz(a,c),yaw,(view.hazardActive?.55+gust*.7:.22)*fade,view.hazardActive?1:.6,view.hazardActive?1:.6);
      }
      streaks.instanceMatrix.needsUpdate=true;
    });
  }else if(p.hazard==='hammer'){
    const t=JUMP_TIMING.hammer,rail=2.95,post=edge(p,-hz,hx),hammer=new Kit(),shade=new Kit(),gantry=new Kit();
    for(const side of [-1,1]){const x=fx(0,side*post),z=fz(0,side*post);gantry.cyl(C.steel,x,rail/2,z,.06,.08,rail,6);fixed.box(C.warn,x,.05,z,.26,.1,.26,yaw);}
    gantry.box(C.steel,0,rail,0,.12,.12,post*2+.2,yaw);gantry.box(C.metal,0,rail-.1,0,p.power*2+1.1,.07,.1,yaw);
    for(const side of [-1,1]){
      gantry.box(C.warn,fx(side*(p.power+.55),0),rail-.1,fz(side*(p.power+.55),0),.1,.26,.3,yaw);
      // Braces from the arch to both ends of the rail: the overhang is visibly held up.
      for(const arm of [-1,1]){const a=side*(p.power+.5),c=arm*post,length=Math.hypot(a,c);gantry.box(C.steel,fx(a/2,c/2),rail-.02,fz(a/2,c/2),length,.06,.06,yaw-Math.atan2(-c,a));}
    }
    // Head box = the hit box: 0.9 along, 1.1 across, from the floor to 1.25.
    const cy=t.headY+.07;
    hammer.box(C.steel,0,rail-.2-cy,0,.4,.16,.3);
    for(let i=0;i<7;i++)hammer.box(i%2?C.metal:C.dark,0,rail-.4-i*.22-cy,0,i%2?.05:.13,.2,i%2?.13:.05);
    hammer.box(C.dark,0,0,0,t.halfLength*2-.16,t.height-.2,t.halfWidth*2);
    for(const side of [-1,1]){hammer.box(C.danger,side*(t.halfLength-.05),0,0,.1,t.height-.28,t.halfWidth*2-.06);hammer.box(C.white,side*(t.halfLength-.045),0,0,.1,.16,t.halfWidth*2-.02);}
    hammer.box(C.warn,0,t.height/2-.12,0,t.halfLength*2-.1,.1,t.halfWidth*2+.06);hammer.box(C.warn,0,-t.height/2+.14,0,t.halfLength*2-.1,.1,t.halfWidth*2+.06);
    shade.box(0x1f2a33,0,.008,0,t.halfLength*2,.012,t.halfWidth*2);
    const hammerMesh=mesh(hammer),shadeMesh=mesh(shade,materials.ghost),gantryMesh=mesh(gantry);hammerMesh.rotation.order=shadeMesh.rotation.order='YXZ';hammerMesh.rotation.y=shadeMesh.rotation.y=yaw;
    height=Math.max(height,3.1);
    animators.push((view,frame)=>{
      const x=view.hazardX-view.x,z=view.hazardZ-view.z;
      hammerMesh.position.set(x,cy,z);shadeMesh.position.set(x,0,z);
      // Once the pad is reached or passed its tall frame turns see-through: it must not stand between the camera and the climber.
      gantryMesh.material=p.floor<frame.targetFloor?materials.thin:materials.solid;
      // The head leans into its travel: slow at the ends of the swing, fast through the middle.
      hammerMesh.rotation.z=frame.reduced?0:Math.max(-.16,Math.min(.16,-view.hazardMove*.03));
    });
  }else if(p.hazard==='laser'){
    const t=JUMP_TIMING.laser,beam=new Kit(),emitter=new Kit();
    beam.shade=0;beam.box(0xfff0f0,0,.17,0,1,.045,.045);beam.box(0xff3d55,0,.17,0,1,.1,.1);beam.box(0xff7a8a,0,.012,0,1,.012,t.halfWidth*2);
    emitter.cyl(C.dark,0,.11,0,.1,.13,.22,8);emitter.ball(0xff5568,0,.2,0,.085,.085,.085,6);emitter.cyl(C.warn,0,.27,0,.04,.1,.05,8);
    const beamMesh=mesh(beam,materials.beam),a=mesh(emitter),b=new THREE.Mesh(a.geometry,materials.solid);parts.add(b);beamMesh.rotation.y=yaw-Math.PI/2;
    // Wherever the beam can travel, the floor is scored.
    const reach=Math.max(0,along/2-t.inset);for(const side of [-1,1])for(let j=0;j<8;j++){const c=((j+.5)/8-.5)*across,x=fx(side*reach,c),z=fz(side*reach,c);if(inside(x,z,.08))fixed.box(j%2?C.danger:C.white,x,.007,z,.04,.014,across/8*.8,yaw);}
    height=Math.max(height,.5);
    animators.push((view,frame)=>{
      // The beam spans the chord of the pad at the offset the shared view reports.
      const cx=view.hazardX-view.x,cz=view.hazardZ-view.z,dx=-hz,dz=hx;let from=-Infinity,to=Infinity;
      if(Math.abs(dx)>1e-6){const one=(-w/2-cx)/dx,two=(w/2-cx)/dx;from=Math.max(from,Math.min(one,two));to=Math.min(to,Math.max(one,two));}else if(Math.abs(cx)>w/2){from=0;to=0;}
      if(Math.abs(dz)>1e-6){const one=(-d/2-cz)/dz,two=(d/2-cz)/dz;from=Math.max(from,Math.min(one,two));to=Math.min(to,Math.max(one,two));}else if(Math.abs(cz)>d/2){from=0;to=0;}
      const length=Math.max(0,to-from),middle=(from+to)/2,flicker=frame.reduced?1:.85+.3*Math.abs(Math.sin(frame.time*.045));
      beamMesh.visible=length>.05;beamMesh.position.set(cx+dx*middle,0,cz+dz*middle);beamMesh.scale.set(length,flicker,1);
      a.position.set(cx+dx*from,0,cz+dz*from);b.position.set(cx+dx*to,0,cz+dz*to);a.visible=b.visible=beamMesh.visible;
    });
  }else if(p.hazard==='saw'){
    const t=JUMP_TIMING.saw,reach=Math.max(0,along/2-t.inset),blade=new Kit(),sparks=new Kit();
    fixed.box(C.dark,0,.007,0,reach*2+.2,.014,.11,yaw);for(const side of [-1,1])fixed.box(C.warn,fx(side*(reach+.14),0),.03,fz(side*(reach+.14),0),.08,.06,.26,yaw);
    blade.cyl(0xdfe6ec,0,.1,0,t.radius*.93,t.radius*.93,.045,18);blade.cyl(C.danger,0,.11,0,t.radius*.42,t.radius*.42,.06,12);blade.cyl(C.dark,0,.12,0,.07,.07,.1,8);
    for(let i=0;i<12;i++){const angle=i/12*TAU;blade.box(0xffffff,Math.cos(angle)*t.radius*.94,.1,Math.sin(angle)*t.radius*.94,.14,.04,.14,-angle+Math.PI/4);}
    blade.box(C.dark,t.radius*.55,.126,0,.2,.012,.05);
    sparks.shade=0;for(let i=0;i<4;i++)sparks.box(i%2?0xfff3b0:0xffc247,-.2-i*.13,.08+i*.05,(i%2?.07:-.06),.11,.03,.03,0,0,.5);
    const bladeMesh=mesh(blade),sparkMesh=mesh(sparks,materials.glow);height=Math.max(height,.4);
    animators.push((view,frame)=>{
      const x=view.hazardX-view.x,z=view.hazardZ-view.z,forward=view.hazardMove<0?-1:1;
      bladeMesh.position.set(x,0,z);bladeMesh.rotation.y=-frame.tick*.75*forward;
      // Sparks trail behind the blade, so its direction of travel is visible at a glance.
      sparkMesh.position.set(x+hx*forward*t.radius*.2,0,z+hz*forward*t.radius*.2);sparkMesh.rotation.y=yaw+(forward<0?Math.PI:0);
      sparkMesh.visible=frame.reduced||frame.tick%3!==0;sparkMesh.scale.setScalar(frame.reduced?1:.8+.4*Math.abs(Math.sin(frame.time*.05)));
    });
  }else if(p.hazard==='cannon'){
    const t=JUMP_TIMING.cannon,muzzle=-along/2-t.muzzle,barrel=new Kit(),shot=new Kit(),flash=new Kit();
    fixed.box(C.steel,fx(muzzle-.35,0),-.3,fz(muzzle-.35,0),1.9,.14,.8,yaw);fixed.cyl(C.steel,fx(muzzle-.6,0),.05,fz(muzzle-.6,0),.2,.3,.58,8);
    const range=Math.min(p.power,along+t.muzzle);for(let i=0;i<Math.ceil(range/.5);i++){const a=muzzle+.6+i*.5,x=fx(a,0),z=fz(a,0);if(inside(x,z,.1))fixed.box(i%2?C.white:C.danger,x,.007,z,.3,.014,.07,yaw);}
    barrel.cyl(C.dark,-.55,0,0,.52,.4,1.1,14,0,0,-Math.PI/2);barrel.torus(C.gold,-.04,0,0,.52,.07,0,0,Math.PI/2,16);barrel.torus(C.gold,-.75,0,0,.44,.06,0,0,Math.PI/2,16);
    barrel.ball(C.dark,-1.12,0,0,.38,.38,.38,10);barrel.ball(C.gold,-1.5,0,0,.1,.1,.1,6);barrel.cyl(0x15191d,-.006,0,0,.4,.4,.02,14,0,0,-Math.PI/2);
    shot.ball(0x2f3742,0,0,0,t.radius,t.radius,t.radius,12);shot.torus(C.danger,0,0,0,t.radius*.98,.06,0,0,Math.PI/2,16);shot.ball(0xffffff,-.2,.26,.2,.1,.1,.1,6);
    flash.shade=0;flash.ball(0xfff0a8,0,0,0,1,1,1,8);
    const barrelMesh=mesh(barrel),shotMesh=mesh(shot),flashMesh=mesh(flash,materials.flame);barrelMesh.rotation.y=shotMesh.rotation.y=yaw;shotMesh.rotation.order='YXZ';
    alertX=fx(muzzle-.5,0);alertZ=fz(muzzle-.5,0);alertY=1.75;height=Math.max(height,1.2);
    animators.push((view,frame)=>{
      const age=modulo(frame.tick+p.hazardPhase,p.hazardPeriod),left=p.hazardPeriod-age,end=p.power/(t.speed*JUMP_RULES.stepMs/1000);
      // Recoil on the shot, then a slow swell and shake while the next one loads.
      const recoil=.4*Math.exp(-age/7),charge=view.hazardWarning?1-left/t.warnTicks:0,back=muzzle-recoil+(charge?wobble(frame,.02*charge):0);
      barrelMesh.position.set(hx*back,t.shotY,hz*back);barrelMesh.scale.set(1-charge*.08,1+charge*.14,1+charge*.14);
      shotMesh.visible=view.hazardActive;shotMesh.position.set(view.hazardX-view.x,view.hazardY-view.y,view.hazardZ-view.z);shotMesh.rotation.z=-frame.tick*.16;
      const pop=age-end;
      if(age<6){flashMesh.visible=true;flashMesh.position.set(hx*(muzzle+.2),t.shotY,hz*(muzzle+.2));flashMesh.scale.setScalar(.75*(1-age/6)+.1);}
      else if(pop>=0&&pop<7){flashMesh.visible=true;flashMesh.position.set(hx*(muzzle+p.power),t.shotY,hz*(muzzle+p.power));flashMesh.scale.setScalar(.25+pop*.08);}
      else if(charge>0){flashMesh.visible=true;flashMesh.position.set(hx*(muzzle+.05),t.shotY,hz*(muzzle+.05));flashMesh.scale.setScalar(.1+charge*.24);}
      else flashMesh.visible=false;
    });
  }else if(p.hazard==='flame'){
    const t=JUMP_TIMING.flame,cell=.44,rows=Math.max(1,Math.round((along/2-t.seam)/cell)),columns=Math.max(2,Math.round(across/cell));
    const halves=[-1,1].map(side=>{
      const fire=new Kit(),pilot=new Kit();fire.shade=0;pilot.shade=0;let sumX=0,sumZ=0,total=0;
      for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
        const a=side*(t.seam+.06+(i+.5)*(along/2-t.seam-.06)/rows),c=((j+.5)/columns-.5)*across,x=fx(a,c),z=fz(a,c);if(!inside(x,z,.12))continue;
        const tall=.85+((i*7+j*5)%4)*.14;sumX+=x;sumZ+=z;total++;
        fixed.cyl(C.dark,x,.008,z,.13,.13,.016,8);fixed.cyl(mix(C.fire,C.dark,.45),x,.012,z,.07,.07,.02,6);
        fire.cyl(C.fire,x,tall*.55,z,0,.2,tall*1.1,6);fire.cyl(C.fireCore,x,tall*.3,z,0,.11,tall*.6,5);
        pilot.cyl(C.fireCore,x,.07,z,0,.06,.14,5);
      }
      const fireMesh=mesh(fire,materials.flame),pilotMesh=mesh(pilot,materials.glow);fireMesh.visible=pilotMesh.visible=false;
      return{side,fireMesh,pilotMesh,x:total?sumX/total:0,z:total?sumZ/total:0};
    });
    for(let j=0;j<columns*2;j++){const c=((j+.5)/(columns*2)-.5)*across,x=fx(0,c),z=fz(0,c);if(inside(x,z,.1)&&j%2)fixed.box(C.white,x,.007,z,t.seam*1.6,.014,across/(columns*2)*.9,yaw);}
    const alert={x:0,z:0};height=Math.max(height,1.3);alertY=1.5;
    animators.push((view,frame)=>{
      for(const half of halves){
        const burning=view.flameSide===half.side,warning=view.flameWarnSide===half.side;
        half.fireMesh.visible=burning;half.pilotMesh.visible=warning||burning;
        // A pilot light sputters on the half that is about to burn; the jets roar unevenly while it does.
        if(burning)half.fireMesh.scale.y=frame.reduced?1:.86+.2*Math.abs(Math.sin(frame.time*.021+half.side))+.08*Math.sin(frame.time*.057);
        if(warning){half.pilotMesh.scale.y=frame.reduced?1.6:1+1.6*Math.abs(Math.sin(frame.time*.03));alert.x=half.x;alert.z=half.z;}
        else half.pilotMesh.scale.y=1;
      }
      alertX=alert.x;alertZ=alert.z;
    });
  }

  // ---- rest pads: a zone gate with its name, and the summit ----
  let banner:THREE.Sprite|null=null,crown:THREE.Mesh|null=null,pillar:THREE.Mesh|null=null,gateMesh:THREE.Mesh|null=null,dressMesh:THREE.Mesh|null=null,gateX=0,gateZ=0;
  if(p.rest){
    const summit=p.floor===JUMP_RULES.floors,zone=JUMP_ZONES[jumpThemeIndexOf(p.floor)]!,tall=summit?3.3:p.floor===0?1.9:2.5,gate=new Kit();
    body.ring(theme.accent,0,.006,0,small*.25,small*.3,28);body.ring(mix(theme.accent,0xffffff,.5),0,.007,0,small*.12,small*.16,20);
    // The gate stands on the edge the climber arrives toward (the ground pad: the edge facing 1F),
    // so it is behind the pad as seen on the way in and never between the camera and the climber.
    const before=JUMP_COURSE[p.floor-1],after=JUMP_COURSE[p.floor+1],ox=before?p.x-before.x:after?after.x-p.x:0,oz=before?p.z-before.z:after?after.z-p.z:-1;
    const alongZ=Math.abs(oz)>=Math.abs(ox),sign=(alongZ?oz:ox)<0?-1:1,wide=alongZ?w:d,out=(alongZ?d:w)/2-.16;gateX=alongZ?0:sign;gateZ=alongZ?sign:0;
    const at=(lateral:number,outward=out):[number,number]=>alongZ?[lateral,sign*outward]:[sign*outward,lateral];
    for(const side of [-1,1]){
      const [x,z]=at(side*(wide/2-.16)),[lx,lz]=at(side*(wide/2-.16),out-.14);
      gate.cyl(theme.dark,x,tall/2,z,.05,.07,tall,6);gate.ball(C.gold,x,tall+.07,z,.1,.1,.1,8);body.box(theme.dark,x,.06,z,.24,.12,.24);
      gate.cyl(C.dark,lx,tall*.62,lz,.02,.02,.2,4);gate.box(0xfff0b8,lx,tall*.62-.2,lz,.16,.22,.16);
    }
    const flags=Math.round(wide/.42);for(let i=0;i<flags;i++){const [x,z]=at(-wide/2+.4+(i+.5)*(wide-.8)/flags),sag=Math.sin((i+.5)/flags*Math.PI)*.14;gate.cyl([theme.accent,C.white,theme.rim,C.danger][i%4]!,x,tall*.56-sag,z,.11,0,.24,3);}
    {const [x,z]=at(0);gate.box(theme.dark,x,tall*.56+.11,z,wide-.4,.025,.025,alongZ?0:Math.PI/2);}
    gateMesh=mesh(gate,materials.solid,group);
    // The ground pad has no banner: it could only be seen while standing under it, where it would cover the way to 1F.
    if(p.floor>0){
      const texture=drawBanner(summit?`정상 ${p.floor}F`:zone.name,summit?'축하해요! 모든 구역 돌파':`${zone.index+1}구역 · ${p.floor}F 쉼터`,theme);textures.push(texture);
      const material=new THREE.SpriteMaterial({map:texture,depthWrite:false});owned.push(material);
      const [x,z]=at(0);banner=new THREE.Sprite(material);banner.scale.set(3.3,3.3*144/512,1);banner.position.set(x,tall+.75,z);group.add(banner);
    }
    height=Math.max(height,tall+1.3);
    if(summit){
      // Summit set piece: golden steps, gem obelisks, a turning star and a pillar of light.
      // Steps and obelisks are a mesh of their own: a see-through summit is only its top slab, not a stack of layers.
      const dress=new Kit();dress.box(C.gold,0,-.5,0,w+.5,.18,d+.5);dress.box(theme.side,0,-.68,0,w+1.1,.18,d+1.1);dress.box(C.gold,0,-.86,0,w+1.7,.18,d+1.7);
      for(const x of [-1,1])for(const z of [-1,1]){const px=x*(w/2+.45),pz=z*(d/2+.45);dress.cyl(C.gold,px,.05,pz,.16,.24,1.3,4,0,Math.PI/4);dress.cyl(theme.accent,px,.95,pz,0,.2,.5,4,0,Math.PI/4);dress.cyl(theme.accent,px,.6,pz,.2,0,.2,4,0,Math.PI/4);}
      dressMesh=mesh(dress,materials.solid,group);
      for(let i=0;i<8;i++){const angle=i/8*TAU;body.box(C.gold,Math.cos(angle)*small*.2,.008,Math.sin(angle)*small*.2,small*.16,.012,.07,-angle);}
      const star=new Kit();star.shade=.1;for(let i=0;i<5;i++)star.cyl(C.gold,Math.cos(i*TAU/5)*.34,Math.sin(i*TAU/5)*.34,0,0,.2,.56,4,0,0,i*TAU/5-Math.PI/2);star.ball(0xfff3c0,0,0,0,.3,.3,.16,8);star.torus(theme.accent,0,0,0,.78,.035,Math.PI/2,0,0,24);
      crown=mesh(star,materials.glow,group);crown.position.y=3.6;
      const light=new Kit();light.shade=0;light.cyl(0xfff2c0,0,6,0,.5,.9,12,12);
      const lightMaterial=new THREE.MeshBasicMaterial({color:0xfff2c0,transparent:true,opacity:.2,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});owned.push(lightMaterial);
      pillar=mesh(light,lightMaterial,group);
      animators.push((_,frame)=>{crown!.rotation.y=frame.reduced?0:frame.time*.0012;crown!.position.y=3.6+(frame.reduced?0:Math.sin(frame.time*.002)*.14);lightMaterial.opacity=frame.reduced?.18:.14+.08*Math.sin(frame.time*.003);});
    }
  }

  const bodyMesh=mesh(body,materials.solid,scaled);
  const fixedMesh=fixed===body||fixed.empty?null:mesh(fixed);
  const coreMesh=core.empty?null:mesh(core,materials.solid,group);
  let anchorMesh:THREE.Mesh|null=null;if(!anchor.empty){anchorMesh=mesh(anchor,materials.solid,root);anchorMesh.position.set(p.x,p.y,p.z);}
  const labelTexture=drawLabel(p);textures.push(labelTexture);
  const labelMaterial=new THREE.SpriteMaterial({map:labelTexture,depthWrite:false});owned.push(labelMaterial);
  const label=new THREE.Sprite(labelMaterial);label.position.set(0,.5,-d*.32);group.add(label);
  const canWarn=p.motion==='blink'||p.motion==='crumble'||p.motion==='shrink'||p.hazard==='spikes'||p.hazard==='pusher'||p.hazard==='wind'||p.hazard==='cannon'||p.hazard==='flame';
  const alertSprite=canWarn?new THREE.Sprite(materials.alert):null;if(alertSprite){alertSprite.scale.set(.62,.62,1);alertSprite.visible=false;alertSprite.renderOrder=5;group.add(alertSprite);}
  const padAlert=p.hazard===null||!(p.hazard==='spikes'||p.hazard==='pusher'||p.hazard==='wind'||p.hazard==='cannon'||p.hazard==='flame');

  return{definition,root,label,height,
    update(view,look,frame){
      const reduced=frame.reduced;let shake=0,drop=0,grow=1;
      if(p.motion==='blink'){
        const u=modulo(frame.tick+p.phase,Math.abs(p.period))/Math.abs(p.period);
        // A flicker before it goes, and it swells back in over the last moments of the gap.
        if(view.padWarning&&!reduced)shake=.02;
        if(!view.active)grow=.82+.18*clamp01((u-.86)/.14);
      }else if(p.motion==='shrink'&&view.padWarning&&!reduced)shake=.014;
      let showDebris=false;
      if(p.motion==='crumble'){
        const started=frame.state.crumbleAt[String(p.floor)],age=started===undefined?-1:frame.tick-started,t=JUMP_TIMING.crumble;
        if(age>=t.warnAt&&age<t.fallAt&&!reduced)shake=.012+.03*(age-t.warnAt)/(t.fallAt-t.warnAt);
        if(age>=t.fallAt&&age<t.fallAt+34&&debris){const fall=(age-t.fallAt)*JUMP_RULES.stepMs/1000;showDebris=true;drop=-9*fall*fall;debris.scale.setScalar(Math.max(.05,1-fall*1.1));debris.rotation.set(fall*.9,0,fall*-.6);}
        if(age>=t.respawnAt&&age<t.respawnAt+8)grow=.7+.3*(age-t.respawnAt)/8;
      }
      const jitterX=shake?Math.sin(frame.time*.11+p.floor)*shake:0,jitterZ=shake?Math.cos(frame.time*.13+p.floor)*shake:0;
      group.position.set(view.x+jitterX,view.y,view.z+jitterZ);
      scaled.scale.set(view.scale*grow,1,view.scale*grow);
      if(debris){debris.visible=showDebris&&look!=='faded';debris.position.y=drop;}
      const hidden=look==='ghost'&&showDebris;
      bodyMesh.visible=!hidden;bodyMesh.material=look==='solid'?materials.solid:look==='warn'?materials.warn:look==='faded'?materials.faded:materials.ghost;
      if(springMesh){
        // Squash on the landing tick, then a damped rebound.
        const age=frame.state.lastFloor===p.floor&&frame.state.lastBounceTick>=0?frame.tick-frame.state.lastBounceTick:99;
        const squash=reduced||age>40?1:1-.5*Math.exp(-age/7)*Math.cos(age*.62);
        springMesh.scale.y=squash;springMesh.position.y=-.43*(1-squash);springMesh.material=bodyMesh.material;
      }
      if(anchorMesh)anchorMesh.material=look==='faded'?materials.faded:materials.solid;
      parts.visible=look==='solid'||look==='warn';
      // Traps on a shrinking deck shrink with it; nothing hangs past the edge.
      if(p.motion==='shrink')parts.scale.set(view.scale,1,view.scale);
      if(coreMesh)coreMesh.visible=parts.visible;
      // A gate is shown on the way up to it and only from its open side. A pad already passed, a
      // see-through pad and a gate that would stand between the camera and the climber have none.
      // Once the climber has landed its name has been read, so the banner goes and the way on stays clear.
      if(gateMesh){
        const shown=parts.visible&&p.floor>=frame.state.lastFloor&&(frame.cameraX-view.x)*gateX+(frame.cameraZ-view.z)*gateZ<0;
        gateMesh.visible=shown;if(banner)banner.visible=shown&&(frame.state.lastFloor!==p.floor||p.floor===JUMP_RULES.floors);
      }
      if(dressMesh)dressMesh.visible=look!=='faded';
      if(crown)crown.visible=look!=='faded';
      if(pillar)pillar.visible=look!=='faded';
      if(parts.visible||anchorMesh||crown)for(const animate of animators)animate(view,frame);
      if(fixedMesh)fixedMesh.visible=parts.visible;
      if(alertSprite){
        const show=view.active&&look!=='faded'&&(padAlert?view.padWarning:view.hazardWarning||view.padWarning);
        alertSprite.visible=show;
        if(show){const pad=view.padWarning&&!view.hazardWarning;alertSprite.position.set(pad?0:alertX,(pad?1.3:alertY)+(reduced?0:Math.abs(Math.sin(frame.time*.012))*.12),pad?-d*.32:alertZ);}
      }
    },
    dispose(){root.removeFromParent();geometries.forEach(geometry=>geometry.dispose());textures.forEach(texture=>texture.dispose());owned.forEach(material=>material.dispose());},
  };
}
