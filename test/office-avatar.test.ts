import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import { AVATAR_LABEL_Y, createOfficeAvatar, type OfficeAvatar } from '../src/office-avatar';
import { avatarConsumeWeight, avatarJumpHeight, poseOfficeAvatar, poseOfficeShoulderLink } from '../src/office-avatar-pose';
import type { AvatarActionKind, AvatarActionView } from '../shared/avatar-actions';
import { createJumpAction } from '../shared/avatar-jump';
import { AVATAR_BODY_SCALE_Y, AVATAR_FOOT_LOCAL_Y, AVATAR_HAND_LOCAL_Y, AVATAR_HIP_Y, AVATAR_KNEE_OFFSET_Y, AVATAR_SEATED_Y, AVATAR_SHOULDER_Y } from '../shared/avatar-rig';
import type { ShoulderLinkView } from '../shared/shoulder-links';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE } from '../shared/avatar-appearance';

function meshes(avatar: OfficeAvatar) {
  const result: Mesh[] = [];
  avatar.group.traverse(object => { if (object instanceof Mesh) result.push(object); });
  return result;
}
function near(actual: number, expected: number, message = '') {
  assert.ok(Math.abs(actual - expected) < 0.00001, `${message}: ${actual} ≠ ${expected}`);
}

test('all style variants fit the standing silhouette and stay within a mobile render budget', t => {
  for (const color of [0x336699, 0x33669a, 0x33669b]) {
    const avatar = createOfficeAvatar(color); t.after(() => avatar.dispose());
    const parts = meshes(avatar);
    const triangles = parts.reduce((sum, part) => sum + (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3, 0);
    assert.ok(parts.length <= 16, `${parts.length} body draws`);
    assert.ok(triangles <= 12000, `${triangles} body triangles`);
    const bounds = new Box3().setFromObject(avatar.group), size = bounds.getSize(new Vector3());
    assert.ok(bounds.min.y >= -0.01 && bounds.min.y <= 0.08, 'feet remain close to floor');
    assert.ok(size.x <= 1.1 && size.y >= 1.5 && bounds.max.y <= 2.02, 'fits current avatar/camera scale including raised buns');
    assert.ok(AVATAR_LABEL_Y - bounds.max.y >= 0.2, 'nickname has headroom above hair');
    for (const part of parts) {
      const positions = part.geometry.getAttribute('position'), colors = part.geometry.getAttribute('color');
      assert.equal(colors.count, positions.count);
      assert.ok(Array.from(positions.array).every(Number.isFinite), 'no non-finite vertex can break frustum culling');
      assert.ok(Array.from(colors.array).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
      assert.equal(part.geometry.groups.length, 0, 'detail remains merged into one draw per finish');
      assert.equal((part.material as MeshStandardMaterial).vertexColors, true);
    }
    t.diagnostic(`style ${color % 3}: ${parts.length} body draws, ${triangles} triangles, height ${bounds.max.y.toFixed(3)}`);
  }
});

test('the default figure has an oversized head and genuinely shorter standing limbs', t => {
  const avatar=createOfficeAvatar(0x336699,DEFAULT_APPEARANCE); t.after(()=>avatar.dispose());
  const figureSize=new Box3().setFromObject(avatar.group).getSize(new Vector3());
  const headSize=new Box3().setFromObject(avatar.head).getSize(new Vector3());
  assert.ok(headSize.y/figureSize.y>=.47,'the large head, including hair, occupies almost half the figure');
  assert.ok(headSize.x>=.95,'the head is broad, not only stretched taller');
  assert.ok(figureSize.y<=1.76,'the enlarged head does not merely make a taller adult-shaped figure');
  assert.ok(avatar.legs[0].position.y<=.50&&Math.abs(avatar.lowerLegs[0].position.y)<=.21,'hips and knees are actually shorter');
  assert.ok(Math.abs(avatar.forearms[0].position.y)<=.16,'the elbows follow the shorter sleeve');
});

test('every top keeps narrow rounded shoulders without changing the hand or elbow pivots', t => {
  let widest=0,highest=0;
  for(const top of APPEARANCE_OPTIONS.top){
    const avatar=createOfficeAvatar(0x336699,{...DEFAULT_APPEARANCE,top:top.id});
    try{
      for(const [index,arm] of avatar.arms.entries()){
        const side=index===0?-1:1;
        const localBounds=new Box3();
        for(const child of arm.children){
          if(!(child instanceof Mesh))continue;
          child.geometry.computeBoundingBox(); localBounds.union(child.geometry.boundingBox!);
          const normals=child.geometry.getAttribute('normal');
          assert.ok(Array.from(normals.array).every(Number.isFinite),`${top.id}: curved sleeves retain valid lighting normals`);
        }
        const width=localBounds.max.x-localBounds.min.x;
        widest=Math.max(widest,width);highest=Math.max(highest,localBounds.max.y);
        assert.ok(width<=.21,`${top.id}: upper arm does not become a broad block`);
        assert.ok(localBounds.max.y<=.06,`${top.id}: the outer shoulder cap stays below the neckline`);
        assert.ok((side<0?-localBounds.min.x:localBounds.max.x)<=.103,`${top.id}: the shoulder no longer protrudes like a pad`);
        near(arm.position.x,side*.285,'shoulder attachment remains compatible with linked/carrying poses');
        near(avatar.forearms[index].position.y,-.19*AVATAR_BODY_SCALE_Y,'elbow pivot remains compatible with hand props');
      }
    }finally{avatar.dispose();}
  }
  t.diagnostic(`maximum upper-arm width ${widest.toFixed(3)}, cap height ${highest.toFixed(3)}`);
});

test('walking and seated rigs use the short joints while keeping hips at the existing seat height', t => {
  const avatar = createOfficeAvatar(0x336699); t.after(() => avatar.dispose());
  assert.equal(avatar.arms.length, 2); assert.equal(avatar.forearms.length, 2);
  assert.equal(avatar.legs.length, 2); assert.equal(avatar.lowerLegs.length, 2);
  avatar.group.updateMatrixWorld(true);
  for (let index = 0; index < 2; index++) {
    near(avatar.arms[index].getWorldPosition(new Vector3()).y, AVATAR_SHOULDER_Y, 'shoulder height');
    near(avatar.legs[index].getWorldPosition(new Vector3()).y, AVATAR_HIP_Y, 'standing hip');
    near(avatar.lowerLegs[index].getWorldPosition(new Vector3()).y, AVATAR_HIP_Y + AVATAR_KNEE_OFFSET_Y, 'standing knee');
    assert.equal(avatar.forearms[index].parent, avatar.arms[index]);
    assert.equal(avatar.lowerLegs[index].parent, avatar.legs[index]);
  }
  avatar.group.position.y = AVATAR_SEATED_Y;
  avatar.legs.forEach(leg => leg.rotation.x = -Math.PI / 2);
  avatar.lowerLegs.forEach(leg => leg.rotation.x = Math.PI / 2);
  avatar.group.updateMatrixWorld(true);
  for (const knee of avatar.lowerLegs) {
    const point = knee.getWorldPosition(new Vector3());
    near(point.y, 0.72, 'knees stay level with seated hips'); near(point.z, -AVATAR_KNEE_OFFSET_Y, 'thighs point forward');
    const ankle = knee.localToWorld(new Vector3(0, AVATAR_FOOT_LOCAL_Y, 0));
    near(ankle.x, point.x); near(ankle.z, point.z); near(ankle.y, point.y + AVATAR_FOOT_LOCAL_Y, 'shin hangs downward');
  }
  const headBeforeBow = avatar.head.getWorldPosition(new Vector3());
  const kneesBeforeBow = avatar.lowerLegs.map(knee => knee.getWorldPosition(new Vector3()));
  avatar.upperBody.rotation.x = 0.4; avatar.group.updateMatrixWorld(true);
  assert.ok(avatar.head.getWorldPosition(new Vector3()).distanceTo(headBeforeBow) > 0.2, 'upper body can bow');
  avatar.lowerLegs.forEach((knee, index) => near(knee.getWorldPosition(new Vector3()).distanceTo(kneesBeforeBow[index]), 0, 'bow does not move feet'));
});

test('twenty visitors own independent resources; removing one disposes its resources exactly once', t => {
  const avatars = Array.from({length:20}, (_, index) => createOfficeAvatar(0x336699 + index));
  t.after(() => avatars.forEach(avatar => avatar.dispose()));
  const allGeometries = new Set<BufferGeometry>(), allMaterials = new Set<Material>();
  const disposed = new Map<BufferGeometry | Material, number>();
  for (const avatar of avatars) {
    const geometries = new Set(meshes(avatar).map(mesh => mesh.geometry));
    const materials = new Set(meshes(avatar).flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
    for (const resource of [...geometries, ...materials]) {
      assert.ok(!allGeometries.has(resource as BufferGeometry) && !allMaterials.has(resource as Material), 'resources cannot be shared across visitors');
      resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) ?? 0) + 1));
    }
    geometries.forEach(geometry => allGeometries.add(geometry)); materials.forEach(material => allMaterials.add(material));
  }
  avatars[0].dispose(); avatars[0].dispose();
  for (const mesh of meshes(avatars[0])) {
    assert.equal(disposed.get(mesh.geometry), 1);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) assert.equal(disposed.get(material), 1);
  }
  for (const avatar of avatars.slice(1)) for (const mesh of meshes(avatar)) {
    assert.equal(disposed.get(mesh.geometry), undefined);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) assert.equal(disposed.get(material), undefined);
  }
});

test('the same server color produces the same mesh and clothing palette after reconnecting', t => {
  const first = createOfficeAvatar(0x33669a), reconnect = createOfficeAvatar(0x33669a);
  t.after(() => { first.dispose(); reconnect.dispose(); });
  const a = meshes(first), b = meshes(reconnect);
  assert.equal(a.length, b.length);
  for (let index=0; index<a.length; index++) {
    assert.deepEqual(a[index].geometry.getAttribute('position').array, b[index].geometry.getAttribute('position').array);
    assert.deepEqual(a[index].geometry.getAttribute('color').array, b[index].geometry.getAttribute('color').array);
  }
});

function basePose(avatar: OfficeAvatar, carrying = false) {
  avatar.arms.forEach(arm => arm.rotation.x = carrying ? -1.15 : 0);
}
function action(kind: AvatarActionKind): AvatarActionView {
  return {id:'local-action', kind, startedAt:10000, expiresAt:12500};
}
function poseSignature(avatar: OfficeAvatar) {
  return [avatar.upperBody, avatar.head, ...avatar.arms, ...avatar.forearms].flatMap(joint => [joint.rotation.x,joint.rotation.y,joint.rotation.z]);
}

test('all four gestures animate distinct joints without changing authoritative position, heading or seated legs', t => {
  const avatar = createOfficeAvatar(0x33669a); t.after(() => avatar.dispose());
  avatar.group.position.set(12,0.1,-9); avatar.group.rotation.y = 1.2;
  avatar.legs.forEach(leg => leg.rotation.x = -Math.PI/2);
  avatar.lowerLegs.forEach(leg => leg.rotation.x = Math.PI/2);
  const worldPosition = avatar.group.position.clone(), heading = avatar.group.rotation.clone();
  const signatures = new Set<string>();
  for (const kind of ['wave','bow','clap','cheer'] as const) {
    basePose(avatar);
    poseOfficeAvatar(avatar,900,10900,action(kind),false,false);
    assert.deepEqual(avatar.group.position,worldPosition,`${kind} cannot move the player`);
    assert.deepEqual(avatar.group.rotation.toArray(),heading.toArray(),`${kind} cannot change heading`);
    avatar.legs.forEach(leg => near(leg.rotation.x,-Math.PI/2,'seated hip remains unchanged'));
    avatar.lowerLegs.forEach(leg => near(leg.rotation.x,Math.PI/2,'seated knee remains unchanged'));
    signatures.add(poseSignature(avatar).map(value=>value.toFixed(4)).join(','));
  }
  assert.equal(signatures.size,4,'the four choices must produce distinct gestures');
});

test('gesture windows use server time and expire smoothly into the walking or carrying base pose', t => {
  const avatar = createOfficeAvatar(0x336699); t.after(() => avatar.dispose());
  const wave = action('wave');
  for (const [now,moving,carrying] of [[9999,false,false],[12500,false,false],[10900,true,false],[10900,false,true]] as const) {
    basePose(avatar); poseOfficeAvatar(avatar,900,10900,wave,false,false);
    const raisedHand = avatar.forearms[1].localToWorld(new Vector3(0,AVATAR_HAND_LOCAL_Y,.005));
    const shoulder = avatar.arms[1].getWorldPosition(new Vector3());
    assert.ok(raisedHand.y>shoulder.y+.15, 'precondition: waving hand is raised above the shoulder');
    basePose(avatar,carrying); poseOfficeAvatar(avatar,900,now,wave,moving,carrying);
    avatar.arms.forEach(arm => near(arm.rotation.x,carrying?-1.15:0,'base shoulder pose restored'));
    avatar.forearms.forEach(arm => { near(arm.rotation.x,carrying?-.12:0); near(arm.rotation.z,0); });
    near(avatar.upperBody.rotation.x,0); near(avatar.head.rotation.z,0);
  }
  basePose(avatar); poseOfficeAvatar(avatar,900,12499,wave,false,false);
  assert.ok(Math.abs(avatar.arms[1].rotation.x)<.001,'gesture fades before expiration, avoiding a hard pop');
  basePose(avatar); poseOfficeAvatar(avatar,900,10001,wave,false,false);
  assert.ok(Math.abs(avatar.arms[1].rotation.x)<.001,'gesture eases into the start');
});

test('jump rises immediately to twice the old height and lands without overshoot', () => {
  const jump = createJumpAction('jump',10000);
  for (const now of [9999,10000,10900,11000]) near(avatarJumpHeight(jump,now),0,`grounded at ${now}`);
  near(avatarJumpHeight(jump,10450),1.36,'peak height');
  assert.ok(avatarJumpHeight(jump,10016)>0,'the first animation frame rises without a windup');
  assert.ok(avatarJumpHeight(jump,10200)>0 && avatarJumpHeight(jump,10200)<1.36);
  assert.ok(avatarJumpHeight(jump,10600)>0 && avatarJumpHeight(jump,10600)<1.36);
  for (let now=9900; now<=11000; now+=10) {
    const height=avatarJumpHeight(jump,now);
    assert.ok(Number.isFinite(height) && height>=0 && height<=1.36,'jump never clips below the floor or above its intended peak');
  }
  near(avatarJumpHeight(jump,10450,true),0,'seated players do not jump');
  near(avatarJumpHeight(action('wave'),10450),0,'other actions do not move vertically');
  near(avatarJumpHeight(null,10450),0,'cancelled jump lands');
});

test('jump can play while walking without moving X/Z, changing heading or overriding carried items', t => {
  const avatar=createOfficeAvatar(0x336699); t.after(()=>avatar.dispose());
  const jump=createJumpAction('jump',10000);
  avatar.group.position.set(14,0,-11); avatar.group.rotation.y=.7;
  const heading=avatar.group.rotation.toArray();
  for(const moving of [false,true]) {
    basePose(avatar); avatar.lowerLegs.forEach(leg=>leg.rotation.x=0);
    const before=avatar.group.position.clone();
    poseOfficeAvatar(avatar,500,10450,jump,moving,false);
    assert.deepEqual(avatar.group.position,before,'gesture does not change the movement distance or teleport the body');
    assert.deepEqual(avatar.group.rotation.toArray(),heading);
    avatar.lowerLegs.forEach(leg=>assert.ok(leg.rotation.x>.2,'knees bend during both walking and standing jumps'));
    near(avatarJumpHeight(jump,10450),1.36);
  }
  basePose(avatar,true); avatar.lowerLegs.forEach(leg=>leg.rotation.x=0);
  poseOfficeAvatar(avatar,500,10450,jump,true,true);
  avatar.arms.forEach(arm=>near(arm.rotation.x,-1.15,'hands keep holding the tray while jumping'));
  avatar.legs.forEach(leg=>leg.rotation.x=-Math.PI/2); avatar.lowerLegs.forEach(leg=>leg.rotation.x=Math.PI/2);
  basePose(avatar); poseOfficeAvatar(avatar,500,10450,jump,false,false,true);
  avatar.lowerLegs.forEach(leg=>near(leg.rotation.x,Math.PI/2,'seated knees stay in the seated pose'));
  avatar.arms.forEach(arm=>near(arm.rotation.x,0));
  basePose(avatar); avatar.lowerLegs.forEach(leg=>leg.rotation.x=0);
  poseOfficeAvatar(avatar,500,10900,jump,true,false);
  avatar.lowerLegs.forEach(leg=>near(leg.rotation.x,0,'expired jump returns to the locomotion base pose'));
});

test('double jump stays within the existing joint range while holding a tray', t => {
  const avatar=createOfficeAvatar(0x336699); t.after(()=>avatar.dispose());
  const first=createJumpAction('first',10000),second=createJumpAction('second',10450,first);
  avatar.group.position.set(8,0,-6); avatar.group.rotation.y=1.1;
  const position=avatar.group.position.clone(),heading=avatar.group.rotation.toArray();
  basePose(avatar,true); avatar.lowerLegs.forEach(leg=>leg.rotation.x=0);
  poseOfficeAvatar(avatar,500,10900,second,true,true);
  near(avatarJumpHeight(second,10900),2.72,'boost at the first apex doubles the maximum height');
  avatar.lowerLegs.forEach(leg=>near(leg.rotation.x,.28,'height does not overbend the knees'));
  avatar.arms.forEach(arm=>near(arm.rotation.x,-1.15,'tray stays supported'));
  assert.deepEqual(avatar.group.position,position);
  assert.deepEqual(avatar.group.rotation.toArray(),heading);
});

test('eating uses the right hand and drinking uses the left, with movement, possession and time guards', t => {
  const avatar=createOfficeAvatar(0x336699); t.after(()=>avatar.dispose());
  avatar.group.position.set(5,0,-8);
  const location=avatar.group.position.clone();
  for(const kind of ['drink','eat'] as const) {
    const consume=action(kind), selected=kind==='drink'?0:1, other=1-selected;
    near(avatarConsumeWeight(consume,11250),1,'fully raised midway through the action');
    for(const now of [9999,10000,12500,12501]) near(avatarConsumeWeight(consume,now),0,'outside the consume animation window');
    near(avatarConsumeWeight(consume,11250,true),0,'walking cancels item presentation');
    basePose(avatar,true); poseOfficeAvatar(avatar,300,11250,consume,false,true);
    assert.ok(avatar.arms[selected].rotation.x<-2,'selected hand reaches the face');
    near(avatar.arms[other].rotation.x,-1.15,'other hand continues supporting the tray');
    assert.deepEqual(avatar.group.position,location,'eating cannot change movement coordinates');
    for(const [now,moving,carrying,active] of [
      [11250,true,true,consume], [11250,false,false,consume],
      [9999,false,true,consume], [12500,false,true,consume], [11250,false,true,null],
    ] as const) {
      basePose(avatar,carrying); poseOfficeAvatar(avatar,300,now,active,moving,carrying);
      avatar.arms.forEach(arm=>near(arm.rotation.x,carrying?-1.15:0,'inactive consume action restores the base shoulder pose'));
      avatar.forearms.forEach(arm=>near(arm.rotation.x,carrying?-.12:0));
      near(avatar.head.rotation.x,0); near(avatar.head.rotation.z,0);
    }
  }
  near(avatarConsumeWeight(action('jump'),11250),0);
  near(avatarConsumeWeight(null,11250),0);
});

function shoulder(index:number,count:number):ShoulderLinkView {
  return {groupId:'local-shoulder-group',index,count,facing:0,since:10000};
}

test('shoulder linking opens waiting arms and reaches only the neighbors beside each participant', t=>{
  const avatar=createOfficeAvatar(0x336699); t.after(()=>avatar.dispose());
  for(const [index,count] of [[0,1],[0,3],[1,3],[2,3]] as const) {
    basePose(avatar); poseOfficeAvatar(avatar,11000,11000,null,false,false);
    poseOfficeShoulderLink(avatar,shoulder(index,count),11000);
    avatar.group.updateMatrixWorld(true);
    for(let armIndex=0;armIndex<2;armIndex++) {
      const side=armIndex===0?-1:1;
      const hand=avatar.forearms[armIndex].localToWorld(new Vector3(0,AVATAR_HAND_LOCAL_Y,.005));
      const linked=armIndex===0?index>0:index<count-1;
      if(count===1) {
        assert.ok(Math.abs(hand.x)>.55,'both hands invite nearby participants');
        assert.ok(hand.y>.75*AVATAR_BODY_SCALE_Y,'waiting hands are raised');
      } else if(linked) {
        const neighborShoulder=new Vector3(side*(.78-.285),AVATAR_SHOULDER_Y,-.05);
        assert.ok(hand.distanceTo(neighborShoulder)<.23,'the hand reaches around the adjacent shoulder');
        assert.ok(hand.z<-.08,'elbow curls behind the neighbor rather than covering their face');
      } else {
        assert.ok(hand.y<.72,'outer endpoint arm hangs naturally');
        assert.ok(Math.abs(hand.x)<.4,'free arm does not reach for a missing participant');
      }
    }
  }
});

test('shoulder poses use server time, remain bounded and reset when a participant leaves', t=>{
  const first=createOfficeAvatar(0x336699),second=createOfficeAvatar(0x33669a);
  t.after(()=>{first.dispose();second.dispose();});
  first.group.position.set(12,0,-9); first.group.rotation.y=.8;
  const location=first.group.position.clone(),heading=first.group.rotation.toArray();
  for(const now of [9999,10000,10001,10160,10320,11000,1_000_000]) {
    for(const avatar of [first,second]) {
      basePose(avatar); poseOfficeAvatar(avatar,now,now,null,false,false);
      poseOfficeShoulderLink(avatar,shoulder(1,3),now);
    }
    assert.deepEqual(poseSignature(first),poseSignature(second),'same membership and clock yield the same pose across clients');
    assert.ok(poseSignature(first).every(angle=>Number.isFinite(angle)&&Math.abs(angle)<2.1),'poses stay finite and within human joint limits');
    assert.deepEqual(first.group.position,location,'shoulder posing never changes authoritative positions');
    assert.deepEqual(first.group.rotation.toArray(),heading,'formation facing is owned by the caller');
    first.legs.forEach(leg=>near(leg.rotation.x,0,'the standing feet remain planted'));
    if(now<=10000) first.arms.forEach(arm=>assert.ok(Math.abs(arm.rotation.z)<=.12,'the pose does not start before server membership'));
  }
  basePose(first); poseOfficeAvatar(first,11000,11000,null,false,false);
  const ordinary=poseSignature(first);
  poseOfficeShoulderLink(first,shoulder(1,3),11000);
  assert.notDeepEqual(poseSignature(first),ordinary);
  basePose(first); poseOfficeAvatar(first,11000,11000,null,false,false);
  poseOfficeShoulderLink(first,null,11000);
  assert.deepEqual(poseSignature(first),ordinary,'leaving returns to the normal locomotion base pose without sticky elbows');
});

function cheeringShoulder(index:number,count=3):ShoulderLinkView {
  return {...shoulder(index,count),cheer:{id:'shared-cheer',startedAt:20000,expiresAt:26000},cheerNextAt:27000};
}

test('shoulder cheer shares its left/right rhythm across clients while feet and server positions stay planted', t=>{
  const first=createOfficeAvatar(0x336699),second=createOfficeAvatar(0x33669a);
  t.after(()=>{first.dispose();second.dispose();});
  first.group.position.set(12,0,-9); first.group.rotation.y=.8;
  first.group.updateMatrixWorld(true);
  const location=first.group.position.clone(),heading=first.group.rotation.toArray();
  const feet=first.lowerLegs.map(leg=>leg.localToWorld(new Vector3(0,AVATAR_FOOT_LOCAL_Y,0)));
  for(const now of [20000,20300,20900,21500,22100,25500,25999]) {
    for(const [avatar,localTime] of [[first,1700],[second,930_000]] as const) {
      basePose(avatar); poseOfficeAvatar(avatar,localTime,now,null,false,false);
      poseOfficeShoulderLink(avatar,cheeringShoulder(1),now);
    }
    assert.deepEqual(poseSignature(first),poseSignature(second),'different browser animation clocks use the same server cheer phase');
    assert.ok(poseSignature(first).every(angle=>Number.isFinite(angle)&&Math.abs(angle)<2.1));
    assert.deepEqual(first.group.position,location);
    assert.deepEqual(first.group.rotation.toArray(),heading);
    first.lowerLegs.forEach((leg,index)=>near(leg.localToWorld(new Vector3(0,AVATAR_FOOT_LOCAL_Y,0)).distanceTo(feet[index]),0,'sway does not slide or lift feet'));
    if(now===20300) near(first.upperBody.rotation.z,.14,'first full beat leans left');
    if(now===20900) near(first.upperBody.rotation.z,-.14,'next beat leans right');
  }
});

test('cheering keeps linked hands near the actual swaying neighbor shoulders throughout the formation', t=>{
  const avatars=Array.from({length:3},(_,index)=>createOfficeAvatar(0x336699+index));
  t.after(()=>avatars.forEach(avatar=>avatar.dispose()));
  avatars.forEach((avatar,index)=>avatar.group.position.x=index*.78);
  for(let now=20000;now<=26000;now+=150) {
    avatars.forEach((avatar,index)=>{
      basePose(avatar); poseOfficeAvatar(avatar,now,now,null,false,false);
      poseOfficeShoulderLink(avatar,cheeringShoulder(index),now);
      avatar.group.updateMatrixWorld(true);
    });
    avatars.forEach((avatar,index)=>avatar.arms.forEach((_,armIndex)=>{
      const neighbor=avatars[index+(armIndex===0?-1:1)];
      const hand=avatar.forearms[armIndex].localToWorld(new Vector3(0,AVATAR_HAND_LOCAL_Y,.005));
      if(neighbor) {
        const neighborShoulder=neighbor.arms[1-armIndex].getWorldPosition(new Vector3());
        neighborShoulder.z-=.05;
        assert.ok(hand.distanceTo(neighborShoulder)<.28,`hand stays around the neighboring shoulder at ${now}: ${hand.distanceTo(neighborShoulder)}`);
        assert.ok(hand.z<-.08,'linked hand stays behind the neighbor rather than in front of their face');
      } else {
        assert.ok(hand.y<.78,'the free outer arm remains relaxed');
      }
    }));
  }
});

test('cheer eases in and out, then returns to linked idle without leaving an old lean behind', t=>{
  const avatar=createOfficeAvatar(0x336699); t.after(()=>avatar.dispose());
  const render=(state:ShoulderLinkView|null,now:number)=>{
    basePose(avatar); poseOfficeAvatar(avatar,now,now,null,false,false);
    poseOfficeShoulderLink(avatar,state,now);
    return poseSignature(avatar);
  };
  for(const now of [19999,20000,26000,27000]) {
    assert.deepEqual(render(cheeringShoulder(1),now),render(shoulder(1,3),now),'outside the cheer window the linked idle pose is unchanged');
  }
  for(const now of [20001,25999]) {
    const active=render(cheeringShoulder(1),now),idle=render(shoulder(1,3),now);
    active.forEach((angle,index)=>near(angle,idle[index],'soft envelope avoids a start/end snap'));
  }
  render(cheeringShoulder(1),20300);
  assert.deepEqual(render(cheeringShoulder(0,1),20900),render(shoulder(0,1),20900),'a singleton immediately returns to the waiting pose');
  render(cheeringShoulder(1),20300);
  const released=render(null,20900);
  basePose(avatar); poseOfficeAvatar(avatar,20900,20900,null,false,false);
  assert.deepEqual(released,poseSignature(avatar),'leaving removes the group lean and linked arms');
});
