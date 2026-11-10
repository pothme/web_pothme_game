import * as THREE from 'three';
import { createOfficeAvatar, replaceOfficeAvatarAppearance, type OfficeAvatar } from './office-avatar';
import { avatarLabelY, createAvatarNameLabel } from './avatar-name-label';
import { poseAvatarLife } from './office-avatar-pose';
import { isJumpPeerNearby, sampleJumpMotion, updateJumpMotion, type JumpMotionSample, type JumpMotionTrack } from './jump-peer-motion';
import type { JumpPeerView, JumpChatMessage } from '../shared/jump-social';
import './jump-peer-scene.css';
import type { AvatarAppearance } from '../shared/avatar-appearance';
import { appearanceKey } from '../shared/avatar-appearance';
import { JUMP_COURSE, JUMP_RULES, JUMP_ZONES, getJumpPlatformView, type JumpHazard, type JumpPlatform, type JumpState } from '../shared/jump-game';
import { fitJumpCamera, jumpCameraAnchors, jumpCameraFocus, jumpCameraHeading, jumpPlatformOccludes, nextJumpCameraFloor, turnJumpCamera, JUMP_CAMERA_PITCH, type JumpCameraPoint } from './jump-camera';
import { createJumpEffects } from './jump-effects';
import { Kit } from './jump-tower-kit';
import { createPadMaterials, createPadModel, type PadFrame, type PadLook, type PadModel } from './jump-tower-pads';
import { JUMP_SHAFT_CENTRE, JUMP_THEMES, buildJumpBackdrop, createJumpSky, jumpZoneBase, jumpZoneBlend } from './jump-tower-themes';

const KINDS:Record<JumpPlatform['kind'],string>={safe:'쉼터',moving:'이동',blink:'점멸',crumble:'붕괴',sweep:'회전',spikes:'가시',wind:'바람',pusher:'밀대',conveyor:'컨베이어',ice:'얼음',lift:'승강',orbit:'공전',shrink:'수축',spring:'스프링',hammer:'망치',laser:'레이저',saw:'톱날',cannon:'대포',flame:'화염'};
/** Raised parts of the next pad that must stay inside the frame. */
const HAZARD_HEIGHT:Record<JumpHazard,number>={pusher:.85,hammer:1.3,flame:1.2,spikes:.85,cannon:1.1,sweep:.5,laser:.4,saw:.3,wind:1};
const BEHIND=9,AHEAD=2,KEEP_BEHIND=15,KEEP_AHEAD=7,CLOUDS=16,MOTES=64,CONFETTI=72,RESTART_MS=2100;
/** Pre-converted theme colours: blending two zones allocates nothing. */
const THEME_COLORS=JUMP_THEMES.map(theme=>({skyTop:new THREE.Color(theme.skyTop),skyBottom:new THREE.Color(theme.skyBottom),fog:new THREE.Color(theme.fog),cloud:new THREE.Color(theme.cloud),hemiSky:new THREE.Color(theme.hemiSky),hemiGround:new THREE.Color(theme.hemiGround),sun:new THREE.Color(theme.sun),mote:new THREE.Color(theme.mote.color)}));

/** One lightweight renderer, driven by the owning UI only while it is visible.
 * Two passes share the camera: the backdrop (sky, clouds, zone scenery) is drawn
 * first and the depth buffer is cleared, so scenery can never hide a pad. */
export function createJumpGameScene(host:HTMLElement,appearance:AvatarAppearance){
  const scene=new THREE.Scene(),backdrop=new THREE.Scene(),fog=new THREE.Fog(0xe0f2e6,34,105),haze=new THREE.Fog(0xe0f2e6,6,92);scene.fog=fog;scene.background=null;
  // Scenery sits in thicker air than the pads, so the route always stands out from it.
  backdrop.fog=haze;
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.4));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.autoClear=false;renderer.info.autoReset=false;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${JUMP_RULES.floors}층 점프 타워. 드래그로 시점 회전, WASD 또는 방향키로 이동, Space로 2단 점프.`);host.append(canvas);
  const speechLayer=document.createElement('div');speechLayer.className='jg-speech-layer';speechLayer.setAttribute('aria-hidden','true');host.append(speechLayer);
  // The restart after a fall: one short card with the height lost, no blame.
  const restart=document.createElement('div');restart.className='jg-restart';restart.setAttribute('aria-hidden','true');restart.hidden=true;
  const restartLost=document.createElement('b'),restartText=document.createElement('small');restart.append(restartLost,restartText);host.append(restart);
  const media=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
  const camera=new THREE.PerspectiveCamera(51,1,.1,150);
  const effects=createJumpEffects(scene);
  const hemi=new THREE.HemisphereLight(0xfff9e8,0x6c929d,2.2),sun=new THREE.DirectionalLight(0xffead5,2.5),fill=new THREE.DirectionalLight(0xd0e9f6,.8);
  sun.position.set(-8,18,10);fill.position.set(9,6,-9);scene.add(hemi,sun,fill);
  const farHemi=new THREE.HemisphereLight(0xfff9e8,0x6c929d,2.3),farSun=new THREE.DirectionalLight(0xffead5,1.9);farSun.position.set(-8,18,10);backdrop.add(farHemi,farSun);
  const geometries:THREE.BufferGeometry[]=[],materials:THREE.Material[]=[],textures:THREE.Texture[]=[];
  const padMaterials=createPadMaterials();

  // ---- backdrop pass: sky dome, drifting clouds and one merged scenery mesh per zone ----
  const sky=createJumpSky();backdrop.add(sky.mesh);
  const sceneryMaterial=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});materials.push(sceneryMaterial);
  // The zone being left dissolves and the one ahead fades in: at most one of each at a time.
  const sceneryLeaving=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true}),sceneryArriving=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true});materials.push(sceneryLeaving,sceneryArriving);
  const scenery:(THREE.Mesh|null)[]=JUMP_ZONES.map(()=>null);
  const cloudGeometry=new THREE.SphereGeometry(1,9,6),cloudMaterial=new THREE.MeshLambertMaterial({color:0xffffff,transparent:true,opacity:.82,depthWrite:false});geometries.push(cloudGeometry);materials.push(cloudMaterial);
  const clouds=new THREE.InstancedMesh(cloudGeometry,cloudMaterial,CLOUDS);clouds.frustumCulled=false;backdrop.add(clouds);
  const dummy=new THREE.Object3D();
  for(let i=0;i<CLOUDS;i++){const angle=i*2.399,radius=30+i%4*6;dummy.position.set(Math.cos(angle)*radius,(i%5)*7-15,Math.sin(angle)*radius);dummy.rotation.set(0,angle,0);dummy.scale.set(5+i%3*1.6,1.3+i%2*.5,3.3);dummy.updateMatrix();clouds.setMatrixAt(i,dummy.matrix);}

  // ---- drifting specks of the current zone: petals, sparks, snow, rain, fireflies ----
  const moteCanvas=document.createElement('canvas');moteCanvas.width=moteCanvas.height=32;const moteContext=moteCanvas.getContext('2d')!,moteGradient=moteContext.createRadialGradient(16,16,2,16,16,15);
  moteGradient.addColorStop(0,'rgba(255,255,255,1)');moteGradient.addColorStop(.6,'rgba(255,255,255,.7)');moteGradient.addColorStop(1,'rgba(255,255,255,0)');moteContext.fillStyle=moteGradient;moteContext.fillRect(0,0,32,32);
  const moteTexture=new THREE.CanvasTexture(moteCanvas);textures.push(moteTexture);
  const motePositions=new Float32Array(MOTES*3),moteGeometry=new THREE.BufferGeometry();moteGeometry.setAttribute('position',new THREE.BufferAttribute(motePositions,3));geometries.push(moteGeometry);
  for(let i=0;i<MOTES;i++){motePositions[i*3]=((i*37)%MOTES/MOTES-.5)*18;motePositions[i*3+1]=((i*53)%MOTES/MOTES-.5)*12;motePositions[i*3+2]=((i*71)%MOTES/MOTES-.5)*18;}
  const moteMaterial=new THREE.PointsMaterial({size:.14,map:moteTexture,transparent:true,opacity:.85,depthWrite:false,sizeAttenuation:true});materials.push(moteMaterial);
  const motes=new THREE.Points(moteGeometry,moteMaterial);motes.frustumCulled=false;scene.add(motes);

  // ---- pads: built when they first come near, released when far behind ----
  const models:(PadModel|null)[]=JUMP_COURSE.map(()=>null);
  function model(floor:number){let value=models[floor];if(!value){value=createPadModel(JUMP_COURSE[floor]!,padMaterials);models[floor]=value;scene.add(value.root);}return value;}
  function release(floor:number){models[floor]?.dispose();models[floor]=null;}

  // ---- guidance: outline and beacon on the next pad, a marching arrow on the current one.
  // Sky blue belongs to guidance alone: amber warns and red strikes on every floor. ----
  const guideMaterial=new THREE.MeshBasicMaterial({color:0x35c9f2,transparent:true,opacity:.92,depthWrite:false,toneMapped:false});materials.push(guideMaterial);
  const boxGeometry=new THREE.BoxGeometry(1,1,1);geometries.push(boxGeometry);
  const nextFrame=new THREE.Group();scene.add(nextFrame);
  for(const side of [-1,1]){const a=new THREE.Mesh(boxGeometry,guideMaterial);a.position.set(side*.5,0,0);a.scale.set(.04,.03,1);const b=new THREE.Mesh(boxGeometry,guideMaterial);b.position.set(0,0,side*.5);b.scale.set(1,.03,.04);nextFrame.add(a,b);}
  const beaconKit=new Kit();beaconKit.shade=.12;beaconKit.cyl(0x35c9f2,0,.16,0,.2,0,.32,4);beaconKit.cyl(0xd8f6ff,0,.4,0,.09,.09,.16,4);
  const beaconGeometry=beaconKit.build();geometries.push(beaconGeometry);const beacon=new THREE.Mesh(beaconGeometry,padMaterials.glow);scene.add(beacon);
  const arrowKit=new Kit();arrowKit.shade=0;for(let i=0;i<3;i++)arrowKit.chevron(0xffffff,i*.42,0,0,.34-i*.03,0,.02);
  const arrowGeometry=arrowKit.build();geometries.push(arrowGeometry);
  const arrowMaterial=new THREE.MeshBasicMaterial({color:0x35c9f2,transparent:true,opacity:.9,depthWrite:false,toneMapped:false});materials.push(arrowMaterial);
  const arrow=new THREE.Mesh(arrowGeometry,arrowMaterial);arrow.visible=false;scene.add(arrow);
  /** How sharply the route turns at each floor: the arrow grows where it matters. */
  const turns=JUMP_COURSE.map((pad,floor)=>{const before=JUMP_COURSE[floor-1],after=JUMP_COURSE[floor+1];if(!before||!after)return 0;const a=Math.atan2(pad.z-before.z,pad.x-before.x),b=Math.atan2(after.z-pad.z,after.x-pad.x);return Math.abs(Math.atan2(Math.sin(b-a),Math.cos(b-a)));});

  // ---- the climber ----
  let avatar=createOfficeAvatar(0x7a9bb4,appearance),appearanceId=appearanceKey(appearance);scene.add(avatar.group);
  const ringGeometry=new THREE.RingGeometry(.36,.47,32);geometries.push(ringGeometry);
  const ringMaterial=new THREE.MeshBasicMaterial({color:0x4c9b88,transparent:true,opacity:.35,depthWrite:false});materials.push(ringMaterial);
  const shadow=new THREE.Mesh(ringGeometry,ringMaterial);shadow.rotation.x=-Math.PI/2;scene.add(shadow);
  // A shimmering ring while a hit or a fresh start cannot hurt.
  const shieldMaterial=new THREE.MeshBasicMaterial({color:0xfff0a8,transparent:true,opacity:.6,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});materials.push(shieldMaterial);
  const shield=new THREE.Mesh(ringGeometry,shieldMaterial);shield.rotation.x=-Math.PI/2;shield.visible=false;scene.add(shield);

  // ---- summit confetti, only once the run is complete ----
  const confettiGeometry=new THREE.PlaneGeometry(.14,.2),confettiMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide,toneMapped:false});geometries.push(confettiGeometry);materials.push(confettiMaterial);
  const confetti=new THREE.InstancedMesh(confettiGeometry,confettiMaterial,CONFETTI);confetti.frustumCulled=false;confetti.visible=false;scene.add(confetti);
  {const color=new THREE.Color(),palette=[0xffd76a,0xff8fa3,0x9be8ff,0xb9a0f2,0xffffff,0x8fe0a8];for(let i=0;i<CONFETTI;i++)confetti.setColorAt(i,color.setHex(palette[i%palette.length]!));}

  const target=new THREE.Vector3(),smoothed=new THREE.Vector3(),cameraPosition=new THREE.Vector3();
  let yaw=0,pitch=JUMP_CAMERA_PITCH,distance=8.5,initialized=false,disposed=false,lastDeaths=-1,lastWidth=0,lastHeight=0,turning=false;
  let targetFloor=1,autoDirection=true,hasMovementInput=false,keptFloor=-1;
  let lastFloor=0,lastHeightStood=0,restartUntil=0,spawnTick=-1000,chosenRestart=false;
  type PeerActor={peer:JumpPeerView;track:JumpMotionTrack;model:OfficeAvatar|null;label:THREE.Sprite|null;appearanceId:string;labelName:string};
  const peerActors=new Map<string,PeerActor>();
  const bubbles=new Map<string,{message:JumpChatMessage;element:HTMLDivElement}>();
  const bubblePoint=new THREE.Vector3();
  /** Authoritative height of each figure, without the cosmetic walking hop. */
  const standingY=new WeakMap<THREE.Object3D,number>();
  let selfId='',selfName='',selfLabel:THREE.Sprite|null=null,serverOffset=0;
  function disposeName(sprite:THREE.Sprite|null){if(!sprite)return;sprite.removeFromParent();sprite.material.map?.dispose();sprite.material.dispose();}
  function disposePeer(actor:PeerActor){if(actor.model){scene.remove(actor.model.group);actor.model.dispose();actor.model=null;}disposeName(actor.label);actor.label=null;}
  function setPeers(id:string,peers:JumpPeerView[]){
    if(selfId!==id){selfId=id;selfName='';disposeName(selfLabel);selfLabel=null;}
    const ids=new Set<string>();
    for(const peer of peers.slice(0,50)){
      if(![peer.x,peer.y,peer.z,peer.vx,peer.vy,peer.vz,peer.floor,peer.updatedAt].every(Number.isFinite))continue;
      if(peer.id===selfId){
        if(selfName!==peer.nickname){selfName=peer.nickname;disposeName(selfLabel);selfLabel=createAvatarNameLabel(selfName,true,null,avatarLabelY(avatar));avatar.group.add(selfLabel);}continue;
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
  function poseActor(model:OfficeAvatar,motion:Pick<JumpMotionSample,'vx'|'vy'|'vz'|'grounded'>,dt:number,time:number){
    const speed=Math.hypot(motion.vx,motion.vz),walking=motion.grounded&&speed>.1;
    if(speed>.15){const heading=Math.atan2(motion.vx,motion.vz);model.group.rotation.y+=Math.atan2(Math.sin(heading-model.group.rotation.y),Math.cos(heading-model.group.rotation.y))*Math.min(1,dt*15);}
    // Same stride clock as the office walk, so the waddle and squash of
    // poseAvatarLife land on the footsteps. The hop is cosmetic: physics,
    // camera and the ground ring all keep using the authoritative height.
    const stride=Math.sin(time*.016);
    standingY.set(model.group,model.group.position.y);
    if(walking)model.group.position.y+=Math.abs(stride)*.04;
    poseAvatarLife(model,time,walking,motion.grounded?undefined:motion.vy/JUMP_RULES.jumpVelocity);
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
      if(!isJumpPeerNearby(actor.peer,{floor:state.lastFloor,y:state.y})){disposePeer(actor);continue;}
      const key=appearanceKey(actor.peer.appearance)+':'+actor.peer.color;
      if((!actor.model||actor.appearanceId!==key)&&modelBudget>0){
        modelBudget--;actor.model=actor.model?replaceOfficeAvatarAppearance(actor.model,actor.peer.color,actor.peer.appearance):createOfficeAvatar(actor.peer.color,actor.peer.appearance,actor.peer.id);actor.appearanceId=key;
        if(!actor.model.group.parent)scene.add(actor.model.group);
        if(actor.label)actor.label.position.y=avatarLabelY(actor.model);
      }
      if(!actor.model)continue;
      if(actor.labelName!==actor.peer.nickname||!actor.label){disposeName(actor.label);actor.label=createAvatarNameLabel(actor.peer.nickname,false,null,avatarLabelY(actor.model));actor.labelName=actor.peer.nickname;actor.model.group.add(actor.label);}
      const motion=sampleJumpMotion(actor.track,now);actor.model.group.position.set(motion.x,motion.y,motion.z);
      poseActor(actor.model,now-actor.peer.updatedAt>1000?{...motion,vx:0,vz:0}:motion,dt,time);
    }
  }
  function renderSpeech(now:number,width:number,height:number){
    for(const [id,bubble]of bubbles){
      if(bubble.message.expiresAt<=now){bubble.element.remove();bubbles.delete(id);continue;}
      const actor=id===selfId?avatar:peerActors.get(id)?.model;
      if(!actor){bubble.element.hidden=true;continue;}
      // Anchored to where the figure stands, so a bubble does not bob with each step.
      bubblePoint.copy(actor.group.position);bubblePoint.y=(standingY.get(actor.group)??bubblePoint.y)+2.62;bubblePoint.project(camera);
      const hidden=bubblePoint.z < -1||bubblePoint.z>1||Math.abs(bubblePoint.x)>1.15||Math.abs(bubblePoint.y)>1.15;
      bubble.element.hidden=hidden;if(hidden)continue;
      const x=Math.max(95,Math.min(width-95,(bubblePoint.x*.5+.5)*width)),y=(-bubblePoint.y*.5+.5)*height;
      bubble.element.style.left=`${Math.round(x)}px`;bubble.element.style.top=`${Math.round(y)}px`;
    }
  }
  let drag:{id:number;x:number;y:number}|null=null;
  function down(event:PointerEvent){if(event.button!==0||disposed)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);}
  function move(event:PointerEvent){if(!drag||drag.id!==event.pointerId)return;autoDirection=false;turning=false;yaw-=(event.clientX-drag.x)*.007;pitch=THREE.MathUtils.clamp(pitch+(event.clientY-drag.y)*.005,.28,1.2);drag.x=event.clientX;drag.y=event.clientY;}
  function up(event:PointerEvent){if(drag?.id!==event.pointerId)return;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}
  function wheel(event:WheelEvent){event.preventDefault();distance=THREE.MathUtils.clamp(distance+event.deltaY*.006,5.5,13);}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);canvas.addEventListener('wheel',wheel,{passive:false});
  const padAt=(floor:number,state:JumpState)=>{const definition=JUMP_COURSE[floor];return definition?getJumpPlatformView(definition,state.tick,state):null;};
  /** `reason:'retry'` marks the restart that follows as the player's own choice: the card then
   * says so instead of reporting a slip. */
  function resetCamera(state?:JumpState,reason?:'retry'){
    effects.clear();if(reason==='retry')chosenRestart=true;
    targetFloor=state?nextJumpCameraFloor(state):1;
    const next=state?padAt(targetFloor,state):null;
    yaw=state&&next?jumpCameraHeading(state,next,padAt(targetFloor+1,state),Math.atan2(state.x-next.x,state.z-next.z),Math.max(1,host.clientWidth)/Math.max(1,host.clientHeight)):0;
    pitch=JUMP_CAMERA_PITCH;distance=8.5;initialized=false;autoDirection=true;turning=false;
  }
  /** Sky, fog, light and specks of the zone at this height, blended across each gate. */
  function applyTheme(height:number,dt:number,reduced:boolean){
    const blend=jumpZoneBlend(height),index=Math.min(JUMP_THEMES.length-1,Math.floor(blend)),t=blend-index,a=THEME_COLORS[index]!,b=THEME_COLORS[Math.min(JUMP_THEMES.length-1,index+1)]!,from=JUMP_THEMES[index]!,to=JUMP_THEMES[Math.min(JUMP_THEMES.length-1,index+1)]!;
    sky.top.lerpColors(a.skyTop,b.skyTop,t);sky.bottom.lerpColors(a.skyBottom,b.skyBottom,t);fog.color.lerpColors(a.fog,b.fog,t);haze.color.copy(fog.color);
    hemi.color.lerpColors(a.hemiSky,b.hemiSky,t);hemi.groundColor.lerpColors(a.hemiGround,b.hemiGround,t);sun.color.lerpColors(a.sun,b.sun,t);
    farHemi.color.copy(hemi.color);farHemi.groundColor.copy(hemi.groundColor);farSun.color.copy(sun.color);
    const light=from.light+(to.light-from.light)*t;hemi.intensity=2.2*light;sun.intensity=2.5*light;farHemi.intensity=2.3*light;
    cloudMaterial.color.lerpColors(a.cloud,b.cloud,t);moteMaterial.color.lerpColors(a.mote,b.mote,t);
    // One scenery mesh is built per frame at most, and those two zones away are released.
    const zone=t>.5?Math.min(JUMP_THEMES.length-1,index+1):index;let built=false;
    for(let i=0;i<scenery.length;i++){
      const base=jumpZoneBase(i),top=jumpZoneBase(i+1),shaft=JUMP_THEMES[i]!.id==='shaft';
      const near=shaft?height>base-6&&height<top+6:height>base-9&&height<top+5;
      if(near&&!scenery[i]&&!built){const mesh=new THREE.Mesh(buildJumpBackdrop(i),sceneryMaterial);mesh.frustumCulled=false;scenery[i]=mesh;backdrop.add(mesh);built=true;}
      else if(scenery[i]&&Math.abs(i-zone)>=2&&!near){backdrop.remove(scenery[i]!);scenery[i]!.geometry.dispose();scenery[i]=null;}
      if(scenery[i])scenery[i]!.visible=near;
      // The zone ahead rises into place as its gate comes near; a zone left behind drops away faster
      // than the climb and dissolves within a few floors: each zone has the sky to itself.
      if(scenery[i]&&!shaft){
        const mesh=scenery[i]!;
        if(height>top){mesh.position.y=-(height-top)*2;sceneryLeaving.opacity=Math.max(0,1-(height-top)/5);mesh.material=sceneryLeaving;}
        else if(height<base-6){mesh.position.y=-(base-height)*1.5;sceneryArriving.opacity=Math.max(0,(height-base+9)/3);mesh.material=sceneryArriving;}
        else{mesh.position.y=height<base?-(base-height)*1.5:0;mesh.material=sceneryMaterial;}
      }
      // The shaft wall closes in from the haze as the climber enters and opens out again at the top,
      // instead of appearing around the route all at once.
      if(scenery[i]&&shaft&&near){const open=1-Math.max(0,Math.min(1,(height-base+6)/5,(top+6-height)/5)),size=1+2.6*open*open;scenery[i]!.scale.set(size,1,size);scenery[i]!.position.set(JUMP_SHAFT_CENTRE[0]*(1-size),0,JUMP_SHAFT_CENTRE[1]*(1-size));}
    }
    motes.visible=!reduced;if(reduced)return;
    const mote=t>.5?to.mote:from.mote,step=Math.min(.05,dt);moteMaterial.size=mote.size;
    for(let i=0;i<MOTES;i++){
      const o=i*3,sway=Math.sin(height*.2+i*1.7+motePositions[o+1]!*.9)*mote.sway;
      let x=motePositions[o]!+(mote.vx+sway)*step,y=motePositions[o+1]!+mote.vy*(.6+(i%5)*.2)*step,z=motePositions[o+2]!+(mote.vz+sway*.6)*step;
      if(x>9)x-=18;else if(x<-9)x+=18;if(y>6)y-=12;else if(y<-6)y+=12;if(z>9)z-=18;else if(z<-9)z+=18;
      motePositions[o]=x;motePositions[o+1]=y;motePositions[o+2]=z;
    }
    moteGeometry.attributes.position!.needsUpdate=true;
  }
  const frame:PadFrame={tick:0,time:0,reduced:false,targetFloor:1,cameraX:0,cameraZ:0,state:{crumbleAt:{},lastBounceTick:-1,lastFloor:0,standingFloor:0}};
  const peerFloors=new Set<number>();
  /** Centre and corners of the pad under the climber: nothing see-through may be drawn across it. */
  const ground:JumpCameraPoint[]=Array.from({length:5},()=>({x:0,y:0,z:0}));
  function showPad(floor:number,state:JumpState,samples:ReturnType<typeof jumpCameraAnchors>,preview:boolean){
    const definition=JUMP_COURSE[floor]!,view=getJumpPlatformView(definition,state.tick,state);
    const hide=()=>{if(models[floor])models[floor]!.root.visible=false;};
    if(Math.abs(view.y-state.y)>=24){hide();return;}
    // Raised machinery fades with its slab; a gate's banner poles are too thin to count.
    const tall=definition.hazard?Math.min(1.3,HAZARD_HEIGHT[definition.hazard]+.15):.72;
    const hidesAvatar=floor!==state.standingFloor&&jumpPlatformOccludes(view,cameraPosition,samples.avatar,tall);
    const hidesNext=floor!==targetFloor&&jumpPlatformOccludes(view,cameraPosition,samples.landing,tall);
    // The next pad and the one after it are drawn in full. Whatever would cover
    // the climber, the pad under them or the landing is not a route marker but a
    // ceiling: a pad further up the route or one already passed is left out, and
    // only the next two (or one a friend stands on) remain as a bare, faint slab.
    const far=preview||floor>targetFloor+1,passed=floor<targetFloor-1;
    if((far||passed&&!peerFloors.has(floor))&&(hidesAvatar||hidesNext||jumpPlatformOccludes(view,cameraPosition,ground,tall))){hide();return;}
    const entry=model(floor);entry.root.visible=true;
    const faded=far||hidesAvatar||hidesNext;
    const look:PadLook=!view.active?'ghost':faded?'faded':view.padWarning?'warn':'solid';
    entry.update(view,look,frame);
    // The number of the pad under the climber's feet is on the HUD; on the pad it would only cover them.
    const isNext=floor===targetFloor,size=(definition.rest?1.25:1)*(isNext?1.22:1);
    entry.label.visible=isNext||!faded&&floor!==state.lastFloor;
    entry.label.material.opacity=isNext?1:.7;entry.label.material.depthTest=!isNext;entry.label.scale.set(size,size*72/176,1);entry.label.renderOrder=isNext?4:0;
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
    setAppearance(value:AvatarAppearance){const key=appearanceKey(value);if(key===appearanceId)return;appearanceId=key;avatar=replaceOfficeAvatarAppearance(avatar,0x7a9bb4,value);if(selfLabel)selfLabel.position.y=avatarLabelY(avatar);},
    /** Review tools only: draw calls and triangles of the last frame (both passes). */
    stats(){return{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures};},
    /** Review tools only: orbit the automatic view by an angle and set its pitch. */
    orbit(angle:number,tilt=pitch){yaw+=angle;pitch=THREE.MathUtils.clamp(tilt,.28,1.2);autoDirection=false;turning=false;},
    render(state:JumpState,dt:number,time:number,now=Date.now()+serverOffset){
      if(disposed||renderer.getContext().isContextLost())return;
      const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight),reduced=media?.matches??false;
      if(width!==lastWidth||height!==lastHeight){lastWidth=width;lastHeight=height;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
      targetFloor=nextJumpCameraFloor(state,targetFloor);
      const nextDefinition=JUMP_COURSE[targetFloor]!,nextView={...getJumpPlatformView(nextDefinition,state.tick,state),cameraHeight:nextDefinition.rest?1:nextDefinition.hazard?HAZARD_HEIGHT[nextDefinition.hazard]:0};
      const afterView=padAt(targetFloor+1,state);
      // Grounded and idle only: never rotate the movement basis under a held
      // direction or during a jump. A manual orbit remains in the user's hands.
      if(autoDirection&&!hasMovementInput&&state.grounded&&Math.hypot(state.vx,state.vz)<.18){
        const result=turnJumpCamera(yaw,jumpCameraHeading(state,nextView,afterView,yaw,width/height),dt,turning);yaw=result.yaw;turning=result.turning;
      }else turning=false;
      const focus=jumpCameraFocus(state,nextView);target.set(focus.x,focus.y,focus.z);
      // A fall is announced here, with the height it cost, and the view cuts straight to the ground pad.
      const fell=lastDeaths>=0&&state.deaths>lastDeaths;
      if(fell){
        const lost=Math.max(0,lastHeightStood-state.y);
        if(chosenRestart){restartLost.textContent='다시 도전';restartText.textContent='1층부터 새로 올라가요!';}
        else{restartLost.textContent=`−${lost.toFixed(lost<10?1:0)}m`;restartText.textContent=lastFloor>0?`${lastFloor}층에서 미끄러졌어요 · 1층부터 다시 가요!`:'1층부터 다시 가요!';}
        restart.dataset.kind=chosenRestart?'retry':'fall';restart.hidden=false;restartUntil=time+RESTART_MS;spawnTick=state.tick;
        effects.play({id:`fall:${state.deaths}:${state.tick}`,kind:'trap',trap:'fall',phase:'fire',floor:lastFloor,x:state.x,y:state.y,z:state.z,tick:state.tick,intensity:1});
      }
      if(!restart.hidden){
        // Driven by the render clock: in, hold, out. Reduced motion keeps the card still.
        const progress=1-(restartUntil-time)/RESTART_MS;
        if(progress>=1)restart.hidden=true;
        else{const enter=Math.min(1,progress/.08),leave=Math.min(1,(1-progress)/.16);restart.style.opacity=String(Math.min(enter,leave));restart.style.transform=reduced?'translate(-50%,0)':`translate(-50%,${((1-enter)*12-(1-leave)*10).toFixed(1)}px) scale(${(.9+.1*enter+.05*Math.sin(Math.min(1,progress/.16)*Math.PI)).toFixed(3)})`;}
      }
      chosenRestart=false;
      const teleported=lastDeaths!==state.deaths||smoothed.distanceTo(target)>12;
      if(!initialized||teleported){smoothed.copy(target);initialized=true;}else smoothed.lerp(target,1-Math.exp(-dt*9));lastDeaths=state.deaths;
      if(state.grounded){lastFloor=state.lastFloor;lastHeightStood=state.fallFrom;}
      avatar.group.position.set(state.x,state.y,state.z);
      poseActor(avatar,state,dt,time);
      const hitAge=state.lastHitTick>=0?state.tick-state.lastHitTick:100;
      if(hitAge<24){const recoil=1-hitAge/24;avatar.upperBody.rotation.z=Math.sin(hitAge*.55)*.3*recoil;avatar.arms.forEach((arm,index)=>arm.rotation.z=(index===0?-1:1)*(.55+recoil*.7));}
      else avatar.upperBody.rotation.z=0;
      // Back on the ground pad the figure pops in rather than simply appearing.
      const spawnAge=state.tick-spawnTick,pop=reduced||spawnAge>14?1:.55+.45*Math.sin(Math.min(1,spawnAge/14)*Math.PI/2)+.12*Math.sin(Math.min(1,spawnAge/14)*Math.PI);
      avatar.group.scale.setScalar(pop);
      renderPeers(state,dt,time,now);
      const fit=fitJumpCamera(state,nextView,yaw,pitch,width/height,distance,height,smoothed,afterView);
      cameraPosition.set(fit.position.x,fit.position.y,fit.position.z);
      const samples=jumpCameraAnchors(state,nextView);
      frame.tick=state.tick;frame.time=time;frame.reduced=reduced;frame.state=state;frame.targetFloor=targetFloor;frame.cameraX=cameraPosition.x;frame.cameraZ=cameraPosition.z;
      {const pad=padAt(state.lastFloor,state)!;for(let i=0;i<5;i++){const point=ground[i]!;point.x=pad.x+(i?(i&1?-.45:.45)*pad.width:0);point.y=pad.y+.05;point.z=pad.z+(i?(i>2?-.45:.45)*pad.depth:0);}}
      const pulse=padMaterials.pulse(time,reduced);

      // Pads: only the stretch around the climber exists; the rest is neither built nor updated.
      const from=Math.max(0,targetFloor-BEHIND),to=Math.min(JUMP_RULES.floors,targetFloor+AHEAD);
      if(keptFloor!==targetFloor){keptFloor=targetFloor;for(let floor=0;floor<models.length;floor++)if(models[floor]&&(floor<targetFloor-KEEP_BEHIND||floor>targetFloor+KEEP_AHEAD))release(floor);}
      for(let floor=0;floor<models.length;floor++)if(models[floor]&&(floor<from||floor>to))models[floor]!.root.visible=false;
      // A friend keeps a platform beneath them: a pad already passed stays, one further up is a faint slab, as long as it hides nothing.
      peerFloors.clear();for(const actor of peerActors.values())if(actor.model&&actor.peer.grounded&&actor.peer.floor>=from&&actor.peer.floor<=Math.min(JUMP_RULES.floors,targetFloor+KEEP_AHEAD))peerFloors.add(actor.peer.floor);
      for(let floor=from;floor<=to;floor++)showPad(floor,state,samples,false);
      for(const floor of peerFloors)if(floor>to)showPad(floor,state,samples,true);

      const complete=state.status==='complete',bob=reduced?0:Math.sin(time*.006);
      nextFrame.visible=!complete;nextFrame.position.set(nextView.x,nextView.y+.07,nextView.z);nextFrame.scale.set(nextView.width+.12+bob*.03,1,nextView.depth+.12+bob*.03);
      guideMaterial.opacity=nextView.active?.78+.18*pulse:.38;
      beacon.visible=!complete;beacon.position.set(nextView.x,nextView.y+(nextDefinition.rest?4.6:Math.min(1.5,HAZARD_HEIGHT[nextDefinition.hazard??'saw']+.4)+1.25)+bob*.14,nextView.z);beacon.rotation.y=reduced?0:time*.002;
      const under=state.standingFloor!==null?JUMP_COURSE[state.standingFloor]:undefined,underView=under?getJumpPlatformView(under,state.tick,state):null;
      if(underView){shadow.visible=underView.active;shadow.position.set(state.x,underView.y+.055,state.z);}else shadow.visible=false;
      // Route arrow: from the climber toward the next pad, larger where the path turns.
      const ax=nextView.x-state.x,az=nextView.z-state.z,reach=Math.hypot(ax,az);
      arrow.visible=!complete&&!!underView&&reach>1.6&&!hasMovementInput;
      if(arrow.visible){
        const sharp=turns[under!.floor]!>1?1.3:1,march=reduced?0:(time*.0016)%1;
        arrow.position.set(state.x+ax/reach*(.75+march*.25),underView!.y+.05,state.z+az/reach*(.75+march*.25));arrow.rotation.y=-Math.atan2(az,ax);arrow.scale.setScalar(sharp);arrowMaterial.opacity=reduced?.85:.9-march*.45;
      }
      const safe=state.tick<state.invulnerableUntil&&!complete;
      shield.visible=safe;if(safe){const left=(state.invulnerableUntil-state.tick)/JUMP_RULES.hitInvulnerabilityTicks;shield.position.set(state.x,state.y+.08,state.z);shield.scale.setScalar(1.5+(reduced?0:Math.sin(time*.02)*.12));shieldMaterial.opacity=Math.min(.7,.25+left*.5);}
      confetti.visible=complete;
      if(complete){
        const summit=JUMP_COURSE[JUMP_RULES.floors]!,clock=reduced?0:time*.001;
        for(let i=0;i<CONFETTI;i++){const angle=i*2.399+clock*(.2+(i%5)*.05),radius=1+(i%9)*.42,fall=((i*.37+clock*(.5+(i%4)*.12))%1);dummy.position.set(summit.x+Math.cos(angle)*radius,summit.y+5.2-fall*5,summit.z+Math.sin(angle)*radius);dummy.rotation.set(clock*(2+i%3)+i,i*1.3,clock*(1.5+i%4));dummy.scale.setScalar(1);dummy.updateMatrix();confetti.setMatrixAt(i,dummy.matrix);}
        confetti.instanceMatrix.needsUpdate=true;
      }
      applyTheme(smoothed.y,dt,reduced);
      motes.position.copy(smoothed);
      clouds.position.set(0,smoothed.y*.86,0);clouds.rotation.y=reduced?0:time*.000012;
      camera.position.copy(cameraPosition);camera.lookAt(smoothed);sky.mesh.position.copy(camera.position);effects.update(time,camera);
      renderer.info.reset();renderer.clear();renderer.render(backdrop,camera);renderer.clearDepth();renderer.render(scene,camera);renderSpeech(now,width,height);
    },
    dispose(){
      disposed=true;effects.dispose();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);canvas.removeEventListener('wheel',wheel);
      disposeName(selfLabel);peerActors.forEach(disposePeer);peerActors.clear();bubbles.clear();speechLayer.remove();restart.remove();avatar.dispose();
      for(let floor=0;floor<models.length;floor++)release(floor);scenery.forEach(mesh=>mesh?.geometry.dispose());sky.dispose();padMaterials.dispose();clouds.dispose();confetti.dispose();
      geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());textures.forEach(value=>value.dispose());renderer.dispose();renderer.forceContextLoss();canvas.remove();
    },
  };
}

export function jumpTrapLabel(platform?:JumpPlatform){return platform?KINDS[platform.kind]:'쉼터';}
