import {test} from 'node:test';
import assert from 'node:assert/strict';
import {APPEARANCE_OPTIONS,DEFAULT_APPEARANCE,normalizeAvatarAppearance,validateAvatarAppearance} from '../shared/avatar-appearance';
import {ACCESSORY_ADDITIONS,CLOTHING_ADDITIONS,ACCESSORY_SLOTS} from '../shared/avatar-wardrobe';
import {SHOP_ITEMS,appearanceUnlock,validateOwnedAppearance} from '../shared/avatar-catalog';
import {createGameHubHarness} from './game-hub-harness.mjs';

test('wardrobe contains exactly 30 new garments and 30 independent accessories with unique valid shop mappings',()=>{
  assert.equal(CLOTHING_ADDITIONS.length,30);assert.equal(ACCESSORY_ADDITIONS.length,30);
  assert.equal(new Set(SHOP_ITEMS.map(item=>item.id)).size,SHOP_ITEMS.length);
  for(const item of [...CLOTHING_ADDITIONS,...ACCESSORY_ADDITIONS]){
    const offer=appearanceUnlock(item.slot,item.id);assert.ok(offer);
    assert.equal(offer.price,item.price);assert.equal(offer.value,item.id);
    assert.ok(APPEARANCE_OPTIONS[item.slot].some(option=>option.id===item.id));
    const appearance={...DEFAULT_APPEARANCE,[item.slot]:item.id};
    assert.throws(()=>validateOwnedAppearance(appearance,[]),/구매/);
    assert.deepEqual(validateOwnedAppearance(appearance,[offer.id]),appearance);
  }
  assert.deepEqual(validateOwnedAppearance(DEFAULT_APPEARANCE,[]),DEFAULT_APPEARANCE);
  assert.equal(DEFAULT_APPEARANCE.top,'tank-white');assert.equal(DEFAULT_APPEARANCE.bottom,'shorts-navy');assert.equal(DEFAULT_APPEARANCE.shoes,'slippers-ivory');
});

test('old appearance records gain empty accessory slots without losing a selected face or outfit',()=>{
  const old={species:'cat',face:'soft',hair:'bob',skin:'tan',hairColor:'rose',top:'cardigan-coral',bottom:'trousers-ivory',shoes:'sneakers-rose'};
  const migrated=validateAvatarAppearance(old);
  for(const key of Object.keys(old) as (keyof typeof old)[])assert.equal(migrated[key],old[key]);
  for(const key of ACCESSORY_SLOTS)assert.equal(migrated[key],'none');
  assert.deepEqual(normalizeAvatarAppearance(old),migrated);
  assert.throws(()=>validateAvatarAppearance({...old,headwear:'unregistered-hat'}));
  assert.throws(()=>validateAvatarAppearance({...old,headwear:null}));
  const repaired=normalizeAvatarAppearance({...migrated,top:'deleted-id'});
  assert.equal(repaired.top,'tank-white');assert.equal(repaired.hair,'bob');assert.equal(repaired.species,'cat');
});

test('four accessories purchase and equip independently, reject forgery, survive reload and can be removed', {timeout:30_000},async()=>{
  const {mf,hub}=await createGameHubHarness(),id='9'.repeat(64);let now=500_000,sequence=0;
  const command=async(type:string,extra:Record<string,unknown>={})=>hub.command(id,{type,requestId:`wardrobe-${++sequence}`,...extra},now+=1000);
  try{
    await hub.connect(id,'꾸미기확인',now);await hub.seedPoints(id,1000);
    const selected={...DEFAULT_APPEARANCE,headwear:'cap-mint',eyewear:'round-glasses',neckwear:'camera',backwear:'backpack-mint'};
    assert.equal((await command('avatar-equip',{appearance:selected})).code,'AVATAR_INVALID');
    let spent=0;
    for(const slot of ACCESSORY_SLOTS){const item=appearanceUnlock(slot,selected[slot])!;const request={type:'shop-buy',requestId:`accessory-${slot}`,itemId:item.id};const bought=await hub.command(id,request,now+=1000);assert.equal(bought.ok,true);spent+=item.price;await hub.command(id,request,now+=1);assert.equal((await hub.state(id,now)).profile.points,1000-spent);}
    assert.equal((await command('avatar-equip',{appearance:selected})).ok,true);
    await hub.resetHub();const restored=(await hub.state(id,now)).profile;
    assert.deepEqual(restored.appearance,selected);assert.equal(restored.owned.length,4);assert.equal(restored.points,1000-spent);
    const removed={...selected,headwear:'none',eyewear:'none',neckwear:'none',backwear:'none'};
    assert.equal((await command('avatar-equip',{appearance:removed})).ok,true);
    assert.deepEqual((await hub.state(id,now)).profile.appearance,removed);
  }finally{await mf.dispose();}
});

test('persisted pre-accessory profiles retain earned points and owned clothes after migration', {timeout:30_000},async()=>{
  const {mf,hub}=await createGameHubHarness(),id='8'.repeat(64);
  try{
    const old={species:'fox',face:'round',hair:'curtain',skin:'rose',hairColor:'chestnut',top:'blazer-night',bottom:'trousers-slate',shoes:'loafers-cream'};
    await hub.seedProfile(id,{appearance:old,points:275,owned:['outfit-night'],earned:900,matches:15});
    const p=(await hub.state(id,0)).profile;assert.equal(p.points,275);assert.equal(p.earned,900);assert.equal(p.matches,15);assert.deepEqual(p.owned,['outfit-night']);assert.equal(p.appearance.top,'blazer-night');
    for(const key of ACCESSORY_SLOTS)assert.equal(p.appearance[key],'none');
  }finally{await mf.dispose();}
});
