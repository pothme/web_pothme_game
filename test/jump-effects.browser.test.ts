import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createJumpEffects} from '../src/jump-effects';
import type {JumpFeedbackEvent} from '../src/jump-feedback';

const hit=(id='hit'):JumpFeedbackEvent=>({id,kind:'hit',x:2,y:12,z:-3,tick:100,intensity:1,hitKind:'spikes',vx:5,vz:0});

test('burst pool stays bounded across rapid contacts and expires on elapsed time after hidden tabs',()=>{
  let now=0;const scene=new THREE.Scene(),effects=createJumpEffects(scene,{now:()=>now,reducedMotion:()=>false});
  const pool=scene.children[0];assert.equal(pool.children.length,4);
  const objects=pool.children.flatMap(slot=>slot.children);
  for(let i=0;i<30;i++){now=i*10;effects.play(hit(String(i)));}
  assert.equal(effects.activeCount,4);
  assert.deepEqual(pool.children.flatMap(slot=>slot.children),objects,'events reuse meshes');
  now+=10000;effects.update(now);assert.equal(effects.activeCount,0);
  assert.ok(pool.children.every(slot=>!slot.visible));effects.dispose();
});

test('event ids deduplicate and clear immediately removes active effects',()=>{
  let now=0;const scene=new THREE.Scene(),effects=createJumpEffects(scene,{now:()=>now});
  effects.play(hit());now=100;effects.play(hit());assert.equal(effects.activeCount,1);
  effects.update(660);assert.equal(effects.activeCount,0,'duplicate must not restart duration');
  effects.play(hit('second'));assert.equal(effects.activeCount,1);effects.clear();assert.equal(effects.activeCount,0);
  effects.play({...hit('bad'),x:NaN});assert.equal(effects.activeCount,0);effects.dispose();
});

test('reduced motion uses a short stationary ring without flying particles',()=>{
  const scene=new THREE.Scene(),effects=createJumpEffects(scene,{now:()=>0,reducedMotion:()=>true});
  effects.play(hit());const slot=scene.children[0].children[0],ring=slot.children[0] as THREE.Mesh;
  const scale=ring.scale.x;effects.update(100);
  assert.equal(ring.scale.x,scale);assert.ok(slot.children.slice(1).every(particle=>!particle.visible));
  assert.deepEqual(slot.position.toArray(),[2,12.07,-3]);
  effects.update(180);assert.equal(effects.activeCount,0);effects.dispose();
});

test('enabling reduced motion during a burst stops particles immediately',()=>{
  let reduced=false;const scene=new THREE.Scene(),effects=createJumpEffects(scene,{now:()=>0,reducedMotion:()=>reduced});
  effects.play(hit());const slot=scene.children[0].children[0];effects.update(60);assert.ok(slot.children[1].visible);
  reduced=true;effects.update(80);assert.ok(slot.children.slice(1).every(particle=>!particle.visible));
  effects.update(200);assert.equal(effects.activeCount,0);effects.dispose();
});

test('jump and landing have smaller effects and GPU resources are disposed exactly once',()=>{
  const scene=new THREE.Scene(),effects=createJumpEffects(scene,{now:()=>0,reducedMotion:()=>false});
  effects.play({id:'jump',kind:'jump',x:0,y:0,z:0,tick:1,intensity:.7,doubleJump:false});
  effects.play({id:'land',kind:'land',x:0,y:0,z:0,tick:2,intensity:.5,impactSpeed:7});
  assert.equal(effects.activeCount,2);
  const meshes=scene.children[0].children.flatMap(slot=>slot.children) as THREE.Mesh[];
  const geometries=new Set(meshes.map(mesh=>mesh.geometry)),materials=new Set(meshes.flatMap(mesh=>Array.isArray(mesh.material)?mesh.material:[mesh.material]));
  let geometryDisposals=0,materialDisposals=0;
  geometries.forEach(geometry=>geometry.addEventListener('dispose',()=>geometryDisposals++));
  materials.forEach(material=>material.addEventListener('dispose',()=>materialDisposals++));
  for(const slot of scene.children[0].children.slice(0,2))assert.ok(slot.children.slice(1,9).every(particle=>!particle.visible),'no hit stars on a jump/landing');
  effects.update(301);assert.equal(effects.activeCount,1);effects.update(341);assert.equal(effects.activeCount,0);
  effects.dispose();effects.dispose();assert.equal(scene.children.length,0);
  assert.equal(geometryDisposals,geometries.size);assert.equal(materialDisposals,materials.size);
  effects.play(hit('after-dispose'));assert.equal(effects.activeCount,0);
});
