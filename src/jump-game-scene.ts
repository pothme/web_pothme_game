import * as THREE from 'three';
import { createOfficeAvatar, replaceOfficeAvatarAppearance, type OfficeAvatar } from './office-avatar';
import { createAvatarNameLabel } from './avatar-name-label';
import { isJumpPeerNearby, sampleJumpMotion, updateJumpMotion, type JumpMotionSample, type JumpMotionTrack } from './jump-peer-motion';
import type { JumpPeerView, JumpChatMessage } from '../shared/jump-social';
import './jump-peer-scene.css';
import type { AvatarAppearance } from '../shared/avatar-appearance';
import { appearanceKey } from '../shared/avatar-appearance';
import { JUMP_COURSE, getJumpPlatformView, type JumpPlatform, type JumpState } from '../shared/jump-game';
import { fitJumpCamera, jumpCameraAnchors, jumpCameraFocus, jumpPlatformOccludes, nextJumpCameraFloor, JUMP_CAMERA_PITCH } from './jump-camera';
import { createJumpEffects } from './jump-effects';

const PALETTE:Record<JumpPlatform['kind'],number>={safe:0x8abdaf,moving:0x79bbd0,blink:0xab94ce,crumble:0xdcb17c,sweep:0xd68383,spikes:0xc98199,wind:0x91b8da,pusher:0xd7986c,conveyor:0x699fbd,ice:0x9bdce5};
const KINDS:Record<JumpPlatform['kind'],string>={safe:'쉼터',moving:'이동',blink:'점멸',crumble:'붕괴',sweep:'회전',spikes:'가시',wind:'바람',pusher:'밀대',conveyor:'컨베이어',ice:'얼음'};

/** One lightweight renderer, driven by the owning UI only while it is visible. */
export function createJumpGameScene(host:HTMLElement,appearance:AvatarAppearance){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xc7e0df);scene.fog=new THREE.Fog(0xc7e0df,32,95);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.4));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','60층 점프 타워. 드래그로 시점 회전, WASD 또는 방향키로 이동, Space로 2단 점프.');host.append(canvas);
  const speechLayer=document.createElement('div');speechLayer.className='jg-speech-layer';speechLayer.setAttribute('aria-hidden','true');host.append(speechLayer);
  const camera=new THREE.PerspectiveCamera(51,1,.1,140);
  const effects=createJumpEffects(scene);
  scene.add(new THREE.HemisphereLight(0xfff9e8,0x6c929d,2.2));
  const sun=new THREE.DirectionalLight(0xffead5,2.5);sun.position.set(-8,18,10);scene.add(sun);
  const fill=new THREE.DirectionalLight(0xd0e9f6,.8);fill.position.set(9,6,-9);scene.add(fill);
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
  const boxGeometry=new THREE.BoxGeometry(1,1,1),coneGeometry=new THREE.ConeGeometry(.19,.55,6),sphereGeometry=new THREE.SphereGeometry(1,10,7);
  geometries.push(boxGeometry,coneGeometry,sphereGeometry);
  const material=(color:number,opacity=1)=>{const m=new THREE.MeshStandardMaterial({color,roughness:.85,transparent:opacity<1,opacity,depthWrite:opacity===1});materials.push(m);return m;};
  const baseMaterials=Object.fromEntries(Object.entries(PALETTE).map(([kind,color])=>[kind,material(color)])) as unknown as Record<JumpPlatform['kind'],THREE.Material>;
  const fadedMaterials=Object.fromEntries(Object.entries(PALETTE).map(([kind,color])=>[kind,material(color,.075)])) as unknown as Record<JumpPlatform['kind'],THREE.Material>;
  const edgeMat=material(0xf9f3e5),darkMat=material(0x4e7076),dangerMat=material(0xdb6b6b),warningMat=material(0xe7bd63),inactiveMat=material(0xcad6dc,.15),metalMat=material(0x6e8b98),cloudMat=material(0xe9f0e9,.6);
  function box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,mat:THREE.Material){const mesh=new THREE.Mesh(boxGeometry,mat);mesh.position.set(x,y,z);mesh.scale.set(w,h,d);parent.add(mesh);return mesh;}
  function label(text:string,color='#31535b',size=1.1){
    const c=document.createElement('canvas');c.width=256;c.height=96;const ctx=c.getContext('2d')!;
    ctx.fillStyle='rgba(250,249,235,.96)';ctx.beginPath();ctx.roundRect(3,3,250,90,23);ctx.fill();ctx.strokeStyle='rgba(66,103,107,.15)';ctx.lineWidth=4;ctx.stroke();
    ctx.fillStyle=color;ctx.font='bold 34px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,128,49);
    const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
    const mat=new THREE.SpriteMaterial({map:texture,depthWrite:false});materials.push(mat);const sprite=new THREE.Sprite(mat);sprite.scale.set(size,size*96/256,1);return sprite;
  }
  type PlatformObject={definition:JumpPlatform;group:THREE.Group;decorations:THREE.Group;body:THREE.Mesh;rim:THREE.Mesh;label:THREE.Sprite;trap?:THREE.Group;arrow?:THREE.Group;belt?:THREE.Group;pusherHead?:THREE.Mesh;pusherRod?:THREE.Mesh};
  const platforms:PlatformObject[]=JUMP_COURSE.map(definition=>{
    const group=new THREE.Group();scene.add(group);const decorations=new THREE.Group();group.add(decorations);
    const body=box(group,0,-.19,0,definition.width,.38,definition.depth,baseMaterials[definition.kind]);
    const rim=box(group,0,-.015,0,definition.width+.045,.06,definition.depth+.045,edgeMat);
    const marker=label(`${definition.floor}F${definition.floor%10===0?' · SAVE':''}`,definition.floor%10===0?'#347e69':'#42636d',definition.floor%10===0?1.55:1.0);
    marker.position.set(0,.46,-definition.depth*.3);group.add(marker);
    let trap:THREE.Group|undefined,arrow:THREE.Group|undefined,belt:THREE.Group|undefined,pusherHead:THREE.Mesh|undefined,pusherRod:THREE.Mesh|undefined;
    if(definition.kind==='sweep'){
      const length=Math.min(definition.width,definition.depth)*.86;
      trap=new THREE.Group();trap.position.y=.3;decorations.add(trap);box(trap,0,0,0,length,.16,.34,dangerMat);
      for(const side of [-1,1]){const ball=new THREE.Mesh(sphereGeometry,warningMat);ball.scale.setScalar(.15);ball.position.x=side*length*.5;trap.add(ball);}
      const hub=new THREE.Mesh(sphereGeometry,metalMat);hub.scale.setScalar(.18);trap.add(hub);
    }else if(definition.kind==='spikes'){
      trap=new THREE.Group();trap.position.y=.27;decorations.add(trap);
      for(const x of [-.11,.11])for(const z of [-.23,0,.23]){const spike=new THREE.Mesh(coneGeometry,dangerMat);spike.scale.set(definition.width*.4,.95,definition.depth*.4);spike.position.set(x*definition.width,0,z*definition.depth);trap.add(spike);}
    }else if(definition.kind==='crumble'){
      for(const angle of [-.7,.65]){const crack=box(decorations,0,.025,0,definition.width*.65,.012,.018,darkMat);crack.rotation.y=angle;}
    }else if(definition.kind==='moving'||definition.kind==='wind'){
      arrow=new THREE.Group();arrow.position.set(0,.05,definition.depth*.22);decorations.add(arrow);
      box(arrow,0,0,0,.13,.035,.43,definition.kind==='wind'?baseMaterials.wind:darkMat);
      const triangle=new THREE.ConeGeometry(.18,.27,3);geometries.push(triangle);const tip=new THREE.Mesh(triangle,definition.kind==='wind'?baseMaterials.wind:darkMat);tip.rotation.x=-Math.PI/2;tip.position.z=-.28;arrow.add(tip);
    }
    if(definition.kind==='pusher'){
      trap=new THREE.Group();trap.position.y=.34;decorations.add(trap);
      const length=definition.width*.5;
      box(trap,-length,.08,0,.24,.65,definition.depth*.76,metalMat);
      pusherHead=box(trap,-length+.15,0,0,.6,.55,Math.min(definition.width,definition.depth)*.68,dangerMat);
      pusherRod=box(trap,-length*.5,0,0,length,.12,.12,warningMat);
    }else if(definition.kind==='conveyor'){
      belt=new THREE.Group();belt.position.y=.035;decorations.add(belt);
      for(const z of [-1,1])box(belt,0,.03,z*definition.depth*.39,definition.width*.92,.07,.08,metalMat);
      arrow=new THREE.Group();belt.add(arrow);
      for(let i=0;i<5;i++)for(const side of [-1,1]){const stripe=box(arrow,0,.025,side*.16,.31,.018,.055,edgeMat);stripe.rotation.y=side*Math.PI/4;stripe.userData.beltIndex=i;}
    }else if(definition.kind==='ice'){
      for(const angle of [0,Math.PI/3,-Math.PI/3]){const line=box(decorations,0,.035,0,definition.width*.65,.015,.055,edgeMat);line.rotation.y=angle;}
      for(const side of [-1,1])box(decorations,side*definition.width*.32,.035,definition.depth*.25,.28,.015,.035,edgeMat);
    }
    if(definition.floor%10===0){
      box(decorations,-definition.width*.38,.42,-definition.depth*.32,.055,.84,.055,darkMat);
      box(decorations,-definition.width*.38+.22,.69,-definition.depth*.32,.43,.27,.035,baseMaterials.safe);
    }
    return{definition,group,decorations,body,rim,label:marker,trap,arrow,belt,pusherHead,pusherRod};
  });
  const clouds=new THREE.Group();scene.add(clouds);
  for(let i=0;i<14;i++){const cloud=new THREE.Mesh(sphereGeometry,cloudMat);const angle=i*2.399;cloud.position.set(Math.cos(angle)*(26+i%4*5),i%5*8-16,Math.sin(angle)*(26+i%4*5));cloud.scale.set(5+i%3,1.3,3.3);clouds.add(cloud);}
  const base=box(scene,0,-1,0,28,.35,28,material(0xa9c9bd));
  const grid=new THREE.GridHelper(28,14,0x8eb4a6,0x9bbfb0);grid.position.y=-.8;scene.add(grid);geometries.push(grid.geometry);materials.push(...(Array.isArray(grid.material)?grid.material:[grid.material]));
  let avatar=createOfficeAvatar(0x7a9bb4,appearance),appearanceId=appearanceKey(appearance);scene.add(avatar.group);
  const ringGeometry=new THREE.RingGeometry(.36,.47,32);geometries.push(ringGeometry);
  const ringMaterial=new THREE.MeshBasicMaterial({color:0x4c9b88,transparent:true,opacity:.35,depthWrite:false});materials.push(ringMaterial);
  const shadow=new THREE.Mesh(ringGeometry,ringMaterial);shadow.rotation.x=-Math.PI/2;scene.add(shadow);
  const target=new THREE.Vector3(),smoothed=new THREE.Vector3(),cameraPosition=new THREE.Vector3();
  const nextFrame=new THREE.Group();scene.add(nextFrame);
  const nextFrameMaterial=new THREE.MeshBasicMaterial({color:0xffe6a0,transparent:true,opacity:.92,depthWrite:false});materials.push(nextFrameMaterial);
  for(const side of [-1,1]){box(nextFrame,side*.5,0,0,.035,.025,1,nextFrameMaterial);box(nextFrame,0,0,side*.5,1,.025,.035,nextFrameMaterial);}
  let yaw=0,pitch=JUMP_CAMERA_PITCH,distance=8.5,initialized=false,disposed=false,lastDeaths=-1,lastWidth=0,lastHeight=0;
  let targetFloor=1,autoDirection=true,hasMovementInput=false;
  type PeerActor={peer:JumpPeerView;track:JumpMotionTrack;model:OfficeAvatar|null;label:THREE.Sprite|null;appearanceId:string;labelName:string};
  const peerActors=new Map<string,PeerActor>();
  const bubbles=new Map<string,{message:JumpChatMessage;element:HTMLDivElement}>();
  const bubblePoint=new THREE.Vector3();
  let selfId='',selfName='',selfLabel:THREE.Sprite|null=null,serverOffset=0;
  function disposeName(sprite:THREE.Sprite|null){if(!sprite)return;sprite.removeFromParent();sprite.material.map?.dispose();sprite.material.dispose();}
  function disposePeer(actor:PeerActor){if(actor.model){scene.remove(actor.model.group);actor.model.dispose();actor.model=null;}disposeName(actor.label);actor.label=null;}
  function setPeers(id:string,peers:JumpPeerView[]){
    if(selfId!==id){selfId=id;selfName='';disposeName(selfLabel);selfLabel=null;}
    const ids=new Set<string>();
    for(const peer of peers.slice(0,50)){
      if(![peer.x,peer.y,peer.z,peer.vx,peer.vy,peer.vz,peer.floor,peer.updatedAt].every(Number.isFinite))continue;
      if(peer.id===selfId){
        if(selfName!==peer.nickname){selfName=peer.nickname;disposeName(selfLabel);selfLabel=createAvatarNameLabel(selfName,true,null);avatar.group.add(selfLabel);}continue;
      }
      ids.add(peer.id);const actor=peerActors.get(peer.id);
      if(actor){actor.peer=peer;actor.track=updateJumpMotion(actor.track,peer);}
      else peerActors.set(peer.id,{peer,track:updateJumpMotion(undefined,peer),model:null,label:null,appearanceId:'',labelName:''});
    }
    for(const [id,actor]of peerActors)if(!ids.has(id)){disposePeer(actor);peerActors.delete(id);bubbles.get(id)?.element.remove();bubbles.delete(id);}
  }
  function showChat(message:JumpChatMessage){
    const previous=bubbles.get(message.playerId);if(previous?.message.id===message.id)return;
    if(previous&&previous.message.sentAt>message.sentAt)return;
    previous?.element.remove();
    const element=document.createElement('div');element.className='jg-speech';element.textContent=message.text;element.hidden=true;speechLayer.append(element);
    bubbles.set(message.playerId,{message,element});
  }
  function clearChats(){for(const bubble of bubbles.values())bubble.element.remove();bubbles.clear();}
  function poseActor(model:OfficeAvatar,motion:Pick<JumpMotionSample,'vx'|'vz'|'grounded'>,dt:number,time:number){
    const speed=Math.hypot(motion.vx,motion.vz),walking=motion.grounded&&speed>.1;
    if(speed>.15){const heading=Math.atan2(motion.vx,motion.vz);model.group.rotation.y+=Math.atan2(Math.sin(heading-model.group.rotation.y),Math.cos(heading-model.group.rotation.y))*Math.min(1,dt*15);}
    const stride=Math.sin(time*.015);
    model.arms.forEach((arm,index)=>{const side=index===0?-1:1;arm.rotation.set(motion.grounded?(walking?stride*side*.48:0):-.6,0,side*(motion.grounded?.12:.55));});
    model.forearms.forEach(arm=>arm.rotation.set(motion.grounded?0:-.2,0,0));
    model.legs.forEach((leg,index)=>leg.rotation.x=walking?stride*(index===0?-1:1)*.42:motion.grounded?0:-.16);
    model.lowerLegs.forEach(leg=>leg.rotation.x=motion.grounded?0:.36);
    model.head.rotation.z=motion.grounded?Math.sin(time*.002)*.015:0;
  }
  function renderPeers(state:JumpState,dt:number,time:number,now:number){
    let modelBudget=2;
    const ordered=[...peerActors.values()].sort((a,b)=>Math.abs(a.peer.y-state.y)-Math.abs(b.peer.y-state.y));
    for(const actor of ordered){
      if(!isJumpPeerNearby(actor.peer,state)){disposePeer(actor);continue;}
      const key=appearanceKey(actor.peer.appearance)+':'+actor.peer.color;
      if((!actor.model||actor.appearanceId!==key)&&modelBudget>0){
        modelBudget--;actor.model=actor.model?replaceOfficeAvatarAppearance(actor.model,actor.peer.color,actor.peer.appearance):createOfficeAvatar(actor.peer.color,actor.peer.appearance);actor.appearanceId=key;
        if(!actor.model.group.parent)scene.add(actor.model.group);
      }
      if(!actor.model)continue;
      if(actor.labelName!==actor.peer.nickname||!actor.label){disposeName(actor.label);actor.label=createAvatarNameLabel(actor.peer.nickname,false,null);actor.labelName=actor.peer.nickname;actor.model.group.add(actor.label);}
      const motion=sampleJumpMotion(actor.track,now);actor.model.group.position.set(motion.x,motion.y,motion.z);
      poseActor(actor.model,now-actor.peer.updatedAt>1000?{...motion,vx:0,vz:0}:motion,dt,time);
    }
  }
  function renderSpeech(now:number,width:number,height:number){
    for(const [id,bubble]of bubbles){
      if(bubble.message.expiresAt<=now){bubble.element.remove();bubbles.delete(id);continue;}
      const actor=id===selfId?avatar:peerActors.get(id)?.model;
      if(!actor){bubble.element.hidden=true;continue;}
      bubblePoint.copy(actor.group.position);bubblePoint.y+=2.62;bubblePoint.project(camera);
      const hidden=bubblePoint.z < -1||bubblePoint.z>1||Math.abs(bubblePoint.x)>1.15||Math.abs(bubblePoint.y)>1.15;
      bubble.element.hidden=hidden;if(hidden)continue;
      const x=Math.max(95,Math.min(width-95,(bubblePoint.x*.5+.5)*width)),y=(-bubblePoint.y*.5+.5)*height;
      bubble.element.style.left=`${Math.round(x)}px`;bubble.element.style.top=`${Math.round(y)}px`;
    }
  }
  let drag:{id:number;x:number;y:number}|null=null;
  function down(event:PointerEvent){if(event.button!==0||disposed)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);}
  function move(event:PointerEvent){if(!drag||drag.id!==event.pointerId)return;autoDirection=false;yaw-=(event.clientX-drag.x)*.007;pitch=THREE.MathUtils.clamp(pitch+(event.clientY-drag.y)*.005,.28,1.2);drag.x=event.clientX;drag.y=event.clientY;}
  function up(event:PointerEvent){if(drag?.id!==event.pointerId)return;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
  function wheel(event:WheelEvent){event.preventDefault();distance=THREE.MathUtils.clamp(distance+event.deltaY*.006,5.5,13);}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);canvas.addEventListener('wheel',wheel,{passive:false});
  function resetCamera(state?:JumpState){
    effects.clear();
    targetFloor=state?nextJumpCameraFloor(state):1;const next=JUMP_COURSE[targetFloor];
    yaw=state?Math.atan2(state.x-next.x,state.z-next.z):0;pitch=JUMP_CAMERA_PITCH;distance=8.5;initialized=false;autoDirection=true;
  }
  return{
    canvas,
    resetCamera,
    setPeers,
    showChat,
    clearChats,
    playEffect:effects.play,
    setServerTime(serverTime:number){if(Number.isFinite(serverTime))serverOffset=serverTime-Date.now();},
    movement(x:number,z:number){hasMovementInput=Math.abs(x)+Math.abs(z)>.01;return{x:x*Math.cos(yaw)+z*Math.sin(yaw),z:z*Math.cos(yaw)-x*Math.sin(yaw)};},
    setAppearance(value:AvatarAppearance){const key=appearanceKey(value);if(key===appearanceId)return;appearanceId=key;avatar=replaceOfficeAvatarAppearance(avatar,0x7a9bb4,value);},
    render(state:JumpState,dt:number,time:number,now=Date.now()+serverOffset){
      if(disposed||renderer.getContext().isContextLost())return;
      const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
      if(width!==lastWidth||height!==lastHeight){lastWidth=width;lastHeight=height;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
      targetFloor=nextJumpCameraFloor(state,targetFloor);
      const nextDefinition=JUMP_COURSE[targetFloor],nextView={...getJumpPlatformView(nextDefinition,state.tick,state),cameraHeight:nextDefinition.kind==='pusher'?.85:nextDefinition.kind==='spikes'?.6:nextDefinition.kind==='sweep'?.5:0};
      // Grounded and idle only: never rotate the movement basis under a held
      // direction or during a jump. A manual orbit remains in the user's hands.
      if(autoDirection&&!hasMovementInput&&state.grounded&&Math.hypot(state.vx,state.vz)<.18){
        const desired=Math.atan2(state.x-nextView.x,state.z-nextView.z),delta=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));yaw+=delta*(1-Math.exp(-dt*3));
      }
      const focus=jumpCameraFocus(state,nextView);target.set(focus.x,focus.y,focus.z);
      const teleported=lastDeaths!==state.deaths||smoothed.distanceTo(target)>12;
      if(!initialized||teleported){smoothed.copy(target);initialized=true;}else smoothed.lerp(target,1-Math.exp(-dt*9));lastDeaths=state.deaths;
      avatar.group.position.set(state.x,state.y,state.z);
      poseActor(avatar,state,dt,time);
      const hitAge=state.lastHitTick>=0?state.tick-state.lastHitTick:100;
      if(hitAge<24){const recoil=1-hitAge/24;avatar.upperBody.rotation.z=Math.sin(hitAge*.55)*.3*recoil;avatar.arms.forEach((arm,index)=>arm.rotation.z=(index===0?-1:1)*(.55+recoil*.7));}
      else avatar.upperBody.rotation.z=0;
      renderPeers(state,dt,time,now);
      const frame=fitJumpCamera(state,nextView,yaw,pitch,width/height,distance,height,smoothed);
      cameraPosition.set(frame.position.x,frame.position.y,frame.position.z);
      const samples=jumpCameraAnchors(state,nextView);
      nextFrame.visible=state.status!=='complete';nextFrame.position.set(nextView.x,nextView.y+.065,nextView.z);nextFrame.scale.set(nextView.width+.10,1,nextView.depth+.10);nextFrameMaterial.opacity=nextView.active?.92:.38;
      const peerFloors=new Set<number>();
      for(const actor of peerActors.values())if(actor.model&&actor.peer.grounded){const floor=JUMP_COURSE.find(platform=>Math.abs(platform.y-actor.peer.y)<.1)?.floor;if(floor!==undefined)peerFloors.add(floor);}
      for(const entry of platforms){
        const {definition}=entry,view=getJumpPlatformView(definition,state.tick,state);
        // Show every landing reachable by a double jump. More distant peers
        // keep a translucent platform beneath them without hiding the next step.
        const futurePeer=definition.floor>targetFloor+2&&peerFloors.has(definition.floor);
        entry.group.visible=(definition.floor<=targetFloor+2||futurePeer)&&definition.floor>=Math.max(0,targetFloor-9)&&Math.abs(view.y-state.y)<24;
        if(!entry.group.visible)continue;
        entry.group.position.set(view.x,view.y,view.z);
        const hidesAvatar=definition.floor!==state.standingFloor&&jumpPlatformOccludes(view,cameraPosition,samples.avatar);
        const hidesNext=definition.floor!==targetFloor&&jumpPlatformOccludes(view,cameraPosition,samples.landing);
        // Higher reachable steps remain as faint previews. Their opaque rims,
        // labels and raised traps must not become a ceiling over the landing.
        const occludes=hidesAvatar||hidesNext||definition.floor>targetFloor;
        entry.body.material=!view.active?inactiveMat:occludes?fadedMaterials[definition.kind]:view.warning?warningMat:baseMaterials[definition.kind];
        entry.rim.material=!view.active||occludes?inactiveMat:view.warning?warningMat:edgeMat;
        entry.decorations.visible=view.active&&!occludes;
        const isNext=definition.floor===targetFloor;
        const labelSize=(definition.floor%10===0?1.55:1)*(isNext?1.15:1);entry.label.material.opacity=isNext?1:occludes?.16:.68;entry.label.material.depthTest=!isNext;entry.label.scale.set(labelSize,labelSize*96/256,1);
        if(entry.trap&&definition.kind==='sweep'){entry.trap.rotation.y=-view.sweepAngle;entry.trap.visible=view.active;}
        if(entry.trap&&definition.kind==='spikes'){entry.trap.scale.y=view.hazardActive?1:.1;entry.trap.position.y=view.hazardActive?.27:.035;entry.trap.visible=view.active;}
        if(entry.arrow&&definition.kind==='wind')entry.arrow.rotation.y=Math.atan2(-view.windX,-view.windZ);
        if(entry.trap&&definition.kind==='pusher'){
          entry.trap.rotation.y=-Math.atan2(view.pushZ,view.pushX);
          const along=(view.pusherX-view.x)*view.pushX+(view.pusherZ-view.z)*view.pushZ,start=-definition.width*.5;
          entry.pusherHead!.position.x=along;entry.pusherHead!.material=view.warning?warningMat:dangerMat;
          entry.pusherRod!.position.x=(start+along)/2;entry.pusherRod!.scale.x=Math.max(.04,along-start);
        }
        if(entry.belt&&entry.arrow&&definition.kind==='conveyor'){
          entry.belt.rotation.y=-Math.atan2(view.beltZ,view.beltX);
          const length=definition.width*.85,phase=state.tick*.02*Math.hypot(view.beltX,view.beltZ);
          entry.arrow.children.forEach(child=>{child.position.x=((Number(child.userData.beltIndex)*length/5+phase)%length)-length*.5;});
        }
      }
      const under=state.standingFloor!==null?JUMP_COURSE.find(platform=>platform.floor===state.standingFloor):undefined;
      if(under){const view=getJumpPlatformView(under,state.tick,state);shadow.visible=view.active;shadow.position.set(state.x,view.y+.055,state.z);}else shadow.visible=false;
      clouds.position.y=state.y;base.visible=state.y<25;grid.visible=base.visible;
      camera.position.copy(cameraPosition);camera.lookAt(smoothed);effects.update(time,camera);renderer.render(scene,camera);renderSpeech(now,width,height);
    },
    dispose(){disposed=true;effects.dispose();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);canvas.removeEventListener('wheel',wheel);disposeName(selfLabel);peerActors.forEach(disposePeer);peerActors.clear();bubbles.clear();speechLayer.remove();avatar.dispose();geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());textures.forEach(value=>value.dispose());renderer.dispose();renderer.forceContextLoss();canvas.remove();},
  };
}

export function jumpTrapLabel(platform?:JumpPlatform){return platform?KINDS[platform.kind]:'쉼터';}
