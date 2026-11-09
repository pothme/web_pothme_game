import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Vector3 } from 'three';
import { createOfficeAvatar, type OfficeAvatar } from '../src/office-avatar';
import { poseOfficeAvatar } from '../src/office-avatar-pose';
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, type AvatarAppearance } from '../shared/avatar-appearance';
import { ACCESSORY_ADDITIONS, CLOTHING_ADDITIONS } from '../shared/avatar-wardrobe';

function modelStats(model:OfficeAvatar){
  let draws=0,triangles=0;
  model.group.traverse(part=>{
    if(!(part instanceof Mesh))return;
    draws++;triangles+=(part.geometry.index?.count??part.geometry.getAttribute('position').count)/3;
    for(const name of ['position','normal','color']){
      const values=part.geometry.getAttribute(name);
      assert.ok(values&&Array.from(values.array).every(Number.isFinite),`finite ${name}`);
    }
    assert.equal(part.geometry.groups.length,0,'accessory details are part of a joint batch');
  });
  return{draws,triangles,bounds:new Box3().setFromObject(model.group)};
}

test('all sixty additions produce bounded renderable parts, not only inventory labels',()=>{
  for(const item of [...CLOTHING_ADDITIONS,...ACCESSORY_ADDITIONS]){
    const appearance={...DEFAULT_APPEARANCE,[item.slot]:item.id} as AvatarAppearance;
    const model=createOfficeAvatar(0x7a9bb4,appearance);
    try{
      const stats=modelStats(model);
      const prefix=item.slot==='top'?'wardrobe-top':item.slot==='bottom'?'wardrobe-bottom':item.slot==='shoes'?'wardrobe-shoes':`accessory-${item.slot}`;
      assert.ok(model.group.userData.features.includes(`${prefix}:${item.id}`),`${item.id}: actual model implementation exists`);
      assert.ok(stats.draws<=18,`${item.id}: ${stats.draws} draws`);
      assert.ok(stats.triangles<=18000,`${item.id}: ${stats.triangles} triangles`);
      assert.ok(stats.bounds.max.y<=model.labelY-.1,`${item.id}: accessory must clear nickname`);
    }finally{model.dispose();}
  }
});

test('most expensive accessories combine within the budget on every species and keep pose ownership',t=>{
  const heavy:AvatarAppearance={...DEFAULT_APPEARANCE};
  // Measure each slot rather than assuming which hats or clothes are expensive.
  for(const slot of ['top','bottom','shoes','headwear','eyewear','neckwear','backwear'] as const){
    let max=-1;
    for(const option of APPEARANCE_OPTIONS[slot]){
      const model=createOfficeAvatar(0x7a9bb4,{...DEFAULT_APPEARANCE,[slot]:option.id});
      try{const {triangles}=modelStats(model);if(triangles>max){max=triangles;(heavy as Record<string,string>)[slot]=option.id;}}finally{model.dispose();}
    }
  }
  for(const species of APPEARANCE_OPTIONS.species){
    let peak=0;
    for(const hair of APPEARANCE_OPTIONS.hair){
    const model=createOfficeAvatar(0x7a9bb4,{...heavy,species:species.id,hair:hair.id});
    try{
      const stats=modelStats(model),size=stats.bounds.getSize(new Vector3());
      peak=Math.max(peak,stats.triangles);
      assert.ok(stats.draws<=18,`${species.id}: ${stats.draws} draws`);
      assert.ok(stats.triangles<=18000,`${species.id}: ${stats.triangles} triangles`);
      assert.ok(stats.bounds.max.y<=model.labelY-.1,`${species.id}: nickname clearance`);
      assert.ok(size.x<=1.4&&size.z<=1.5,`${species.id}: equipment stays within a nearby player's personal space`);
      model.group.position.set(4,.1,-3);
      model.legs.forEach(leg=>leg.rotation.x=-Math.PI/2);
      model.lowerLegs.forEach(leg=>leg.rotation.x=Math.PI/2);
      poseOfficeAvatar(model,1400,1400,{id:'wardrobe-test-wave',kind:'wave',startedAt:1000,expiresAt:3500},false,false,true);
      assert.deepEqual(model.group.position.toArray(),[4,.1,-3],'new clothes never change authoritative position');
      assert.ok(model.legs.every(leg=>leg.rotation.x===-Math.PI/2),'seated legs keep their pose while the wearer waves');
      modelStats(model);
    }finally{model.dispose();}
    }
    t.diagnostic(`${species.id}: maximum across six hairstyles ${peak} triangles`);
  }
  t.diagnostic(`most detailed slots: ${JSON.stringify(heavy)}`);
});
