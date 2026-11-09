import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Box3, Group, Mesh, Vector3, type MeshStandardMaterial } from 'three';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, type AppearanceKey, type AvatarAppearance } from '../shared/avatar-appearance';
import { createOfficeAvatar, replaceOfficeAvatarAppearance, type OfficeAvatar } from '../src/office-avatar';
import { poseOfficeAvatar } from '../src/office-avatar-pose';
import { AVATAR_HAND_LOCAL_Y } from '../shared/avatar-rig';

function meshes(avatar: OfficeAvatar) {
  const result: Mesh[]=[];
  avatar.group.traverse(object=>{if(object instanceof Mesh) result.push(object);});
  return result;
}
function signature(avatar: OfficeAvatar, attribute='position') {
  const digest=createHash('sha256');
  for(const mesh of meshes(avatar)) digest.update(Buffer.from(mesh.geometry.getAttribute(attribute).array.buffer));
  return digest.digest('hex');
}
function near(actual: number, expected: number) { assert.ok(Math.abs(actual-expected)<.00001,`${actual} ≠ ${expected}`); }

test('all seven species render finite, textured-by-vertex models within the office budget',t=>{
  const silhouettes=new Set<string>();
  for(const option of APPEARANCE_OPTIONS.species){
    const model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,species:option.id});
    t.after(()=>model.dispose());
    const parts=meshes(model), bounds=new Box3().setFromObject(model.group), size=bounds.getSize(new Vector3());
    const triangles=parts.reduce((total,mesh)=>total+mesh.geometry.getAttribute('position').count/3,0);
    assert.ok(parts.length<=16,`${option.id}: ${parts.length} draws`);
    assert.ok(triangles<=12000,`${option.id}: ${triangles} triangles`);
    assert.ok(bounds.min.y>=-.01&&bounds.min.y<=.08,`${option.id}: grounded feet`);
    assert.ok(bounds.max.y<=2.02&&size.x<=1.15,`${option.id}: does not collide with nameplate or adjacent chairs`);
    assert.ok(model.labelY-bounds.max.y>=.20,`${option.id}: label clears ears and antennae`);
    for(const mesh of parts){
      for(const key of ['position','normal','color']){
        const attribute=mesh.geometry.getAttribute(key);
        assert.ok(attribute&&Array.from(attribute.array).every(Number.isFinite),`${option.id}: valid ${key}`);
      }
      assert.equal(mesh.geometry.groups.length,0,'detail is batched by joint and finish');
      const material=mesh.material as MeshStandardMaterial;
      assert.equal(material.vertexColors,true); assert.equal(material.map,null,'no downloaded image dependency');
    }
    silhouettes.add(signature(model));
    t.diagnostic(`${option.id}: ${parts.length} draws, ${triangles} triangles, ${bounds.max.y.toFixed(3)} high`);
  }
  assert.equal(silhouettes.size,7,'species have distinct geometry, not only different colors');
});

test('face, hair, clothes and footwear options alter the actual model and palette',()=>{
  for(const key of Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]){
    if(key==='species') continue;
    const variants=new Set<string>();
    for(const option of APPEARANCE_OPTIONS[key]){
      const appearance={...DEFAULT_APPEARANCE,[key]:option.id} as AvatarAppearance;
      const model=createOfficeAvatar(0x7a9bb4,appearance);
      try { variants.add(signature(model)+signature(model,'color')); }
      finally { model.dispose(); }
    }
    assert.equal(variants.size,APPEARANCE_OPTIONS[key].length,`${key}: no duplicate or ignored selector`);
  }
  for(const species of APPEARANCE_OPTIONS.species){
    const hairstyles=new Set<string>();
    for(const hair of APPEARANCE_OPTIONS.hair){
      const model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,species:species.id,hair:hair.id});
      try { hairstyles.add(signature(model)); }
      finally { model.dispose(); }
    }
    assert.equal(hairstyles.size,6,`${species.id}: six visible hair silhouettes`);
  }
});

test('animals have protruding muzzles and tails; insects retain exposed antennae and wings',()=>{
  for(const species of APPEARANCE_OPTIONS.species.filter(item=>item.id!=='human')){
    const model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,species:species.id});
    try {
      const bounds=new Box3().setFromObject(model.group);
      const features=model.group.userData.features as string[];
      if(species.id==='bee'||species.id==='butterfly'){
        assert.ok(features.includes('antennae')&&features.includes('compound-eye-face'));
        assert.ok(bounds.max.y>1.8,'antennae remain above the round insect head');
        assert.ok(bounds.min.z<-.3,'wings and abdomen are real geometry behind the clothing');
        if(species.id==='butterfly')assert.ok(bounds.getSize(new Vector3()).x>1,'four patterned wings form a visible silhouette');
      }else{
        assert.ok(features.includes('animal-muzzle'));
        const headBounds=new Box3().setFromObject(model.head);
        assert.ok(headBounds.max.z>.32,'muzzle protrudes beyond the human face');
        assert.ok(features.some(feature=>feature.includes('tail')),'body has an animal tail');
      }
    }finally{model.dispose();}
  }
});

test('mirrored animal ears retain outward winding after geometry batching',()=>{
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3(),edge=new Vector3();
  for(const species of ['cat','fox'] as const){
    const model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,species});
    try{
      model.head.traverse(object=>{
        if(!(object instanceof Mesh))return;
        const positions=object.geometry.getAttribute('position'),normals=object.geometry.getAttribute('normal');
        for(let index=0;index<positions.count;index+=3){
          a.fromBufferAttribute(positions,index);b.fromBufferAttribute(positions,index+1);c.fromBufferAttribute(positions,index+2);
          normal.fromBufferAttribute(normals,index).add(new Vector3().fromBufferAttribute(normals,index+1)).add(new Vector3().fromBufferAttribute(normals,index+2));
          edge.subVectors(c,a);b.sub(a).cross(edge);
          assert.ok(b.dot(normal)>=-1e-7,`${species}: front faces must not be culled after mirroring`);
        }
      });
    }finally{model.dispose();}
  }
});

test('all species preserve carried-item attachment points, seated poses and gesture joints',()=>{
  const reference=createOfficeAvatar(0x7a9bb4,DEFAULT_APPEARANCE);
  try{
    for(const species of APPEARANCE_OPTIONS.species){
      const model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,species:species.id,top:'knit-cream',bottom:'skirt-navy',shoes:'sneakers-white'});
      try{
        assert.equal(model.arms.length,2);assert.equal(model.forearms.length,2);assert.equal(model.legs.length,2);assert.equal(model.lowerLegs.length,2);
        for(const kind of ['wave','bow','clap','cheer','eat','drink','jump'] as const){
          for(const rig of [reference,model]){
            rig.group.position.set(3,.1,-4);rig.group.rotation.y=.8;
            rig.arms.forEach(arm=>arm.rotation.set(-1.15,0,0));
            rig.legs.forEach(leg=>leg.rotation.set(-Math.PI/2,0,0));
            rig.lowerLegs.forEach(leg=>leg.rotation.set(Math.PI/2,0,0));
            poseOfficeAvatar(rig,900,10900,{id:'test',kind,startedAt:10000,expiresAt:12500},false,kind==='eat'||kind==='drink',true);
            rig.group.updateMatrixWorld(true);
          }
          for(let index=0;index<2;index++){
            const localHand=new Vector3(0,AVATAR_HAND_LOCAL_Y,.005);
            const actual=model.forearms[index].localToWorld(localHand.clone());
            const expected=reference.forearms[index].localToWorld(localHand.clone());
            near(actual.distanceTo(expected),0);
            near(model.legs[index].rotation.x,-Math.PI/2);near(model.lowerLegs[index].rotation.x,Math.PI/2);
          }
          assert.deepEqual(model.group.position.toArray(),[3,.1,-4]);
          const bounds=new Box3().setFromObject(model.group);
          assert.ok([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite));
        }
      }finally{model.dispose();}
    }
  }finally{reference.dispose();}
});

test('changing appearance preserves root identity, attachments and every interpolated joint while disposing the old body',()=>{
  const original=createOfficeAvatar(0x7a9bb4,DEFAULT_APPEARANCE);
  const root=original.group, scene=new Group(), tray=new Group();scene.add(root);root.add(tray);
  root.position.set(17.4,1.16,-8.72);root.rotation.y=1.28;
  original.legs.forEach(leg=>leg.rotation.x=-Math.PI/2);
  original.lowerLegs.forEach(leg=>leg.rotation.x=Math.PI/2);
  poseOfficeAvatar(original,900,10900,{id:'test',kind:'heart',startedAt:10000,expiresAt:12500},false,false,true);
  root.updateMatrixWorld(true);
  const originalTransform=root.matrixWorld.clone(), hands=original.forearms.map(arm=>arm.localToWorld(new Vector3(0,AVATAR_HAND_LOCAL_Y,.005)));
  const geometries=meshes(original).map(mesh=>mesh.geometry), disposed=new Set();
  geometries.forEach(geometry=>geometry.addEventListener('dispose',()=>disposed.add(geometry)));
  const replacement=replaceOfficeAvatarAppearance(original,0x7a9bb4,{...DEFAULT_APPEARANCE,species:'rabbit',hair:'bun',bottom:'skirt-navy'});
  try{
    assert.equal(replacement.group,root);assert.equal(root.parent,scene);assert.equal(tray.parent,root);
    root.updateMatrixWorld(true);assert.deepEqual(root.matrixWorld.elements,originalTransform.elements);
    replacement.forearms.forEach((arm,index)=>near(arm.localToWorld(new Vector3(0,AVATAR_HAND_LOCAL_Y,.005)).distanceTo(hands[index]),0));
    assert.equal(replacement.heartEffect.visible,true,'an active emote is not flashed off during replacement');
    replacement.legs.forEach(leg=>near(leg.rotation.x,-Math.PI/2));
    replacement.lowerLegs.forEach(leg=>near(leg.rotation.x,Math.PI/2));
    assert.equal(disposed.size,geometries.length,'only the discarded model resources are released');
    assert.ok(!root.children.includes(original.upperBody));assert.ok(root.children.includes(replacement.upperBody));
  }finally{replacement.dispose();}
});

test('dance and heart animate distinct seated upper-body gestures without moving the player or occupied legs',()=>{
  const model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,species:'cat'});
  try{
    model.group.position.set(3,.1,7);model.group.rotation.y=1.2;
    model.legs.forEach(leg=>leg.rotation.x=-Math.PI/2);model.lowerLegs.forEach(leg=>leg.rotation.x=Math.PI/2);
    const poses=new Set();
    for(const kind of ['dance','heart'] as const){
      model.arms.forEach(arm=>arm.rotation.x=-.7);
      poseOfficeAvatar(model,900,10900,{id:'paid-action',kind,startedAt:10000,expiresAt:12500},false,false,true);
      poses.add([model.upperBody,...model.arms,...model.forearms].map(joint=>joint.rotation.toArray().join(',')).join('/'));
      assert.deepEqual(model.group.position.toArray(),[3,.1,7]);near(model.group.rotation.y,1.2);
      model.legs.forEach(leg=>near(leg.rotation.x,-Math.PI/2));model.lowerLegs.forEach(leg=>near(leg.rotation.x,Math.PI/2));
      assert.equal(model.heartEffect.visible,kind==='heart');
    }
    assert.equal(poses.size,2);
    poseOfficeAvatar(model,900,10900,{id:'heart',kind:'heart',startedAt:10000,expiresAt:12500},true,false);
    assert.equal(model.heartEffect.visible,false,'moving cancels the cosmetic heart');
    poseOfficeAvatar(model,900,10900,{id:'heart',kind:'heart',startedAt:10000,expiresAt:12500},false,true);
    assert.equal(model.heartEffect.visible,false,'held food keeps both hands free of other emotes');
    poseOfficeAvatar(model,2600,12600,{id:'heart',kind:'heart',startedAt:10000,expiresAt:12500},false,false);
    assert.equal(model.heartEffect.visible,false,'the effect is removed at action expiry');
  }finally{model.dispose();}
});
