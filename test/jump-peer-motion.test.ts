import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isJumpPeerNearby,sampleJumpMotion,updateJumpMotion,type JumpMotionSample} from '../src/jump-peer-motion';
const sample=(x:number,updatedAt:number):JumpMotionSample=>({x,y:1.1,z:0,vx:5,vy:0,vz:0,grounded:true,floor:1,updatedAt});
test('remote jump movement interpolates between server samples and rejects reordered packets',()=>{
  let track=updateJumpMotion(undefined,sample(0,1000));track=updateJumpMotion(track,sample(1,1200));
  assert.equal(sampleJumpMotion(track,1220).x,.5);
  assert.strictEqual(updateJumpMotion(track,sample(-4,1100)),track);
  assert.equal(sampleJumpMotion(track,1320).x,1);
});
test('remote jump extrapolation is capped and restart teleports do not slide through floors',()=>{
  let track=updateJumpMotion(undefined,sample(0,1000));track=updateJumpMotion(track,sample(1,1200));
  assert.equal(sampleJumpMotion(track,9000).x,1.5);
  track=updateJumpMotion(track,{...sample(2,1400),y:25,floor:20});
  assert.equal(sampleJumpMotion(track,1400).y,25);
  assert.equal(sampleJumpMotion(track,1400).x,2);
});
test('only nearby floors create detailed remote avatar models',()=>{
  assert.equal(isJumpPeerNearby({floor:16,y:18},{floor:10,y:11}),true);
  assert.equal(isJumpPeerNearby({floor:17,y:18},{floor:10,y:11}),false);
  assert.equal(isJumpPeerNearby({floor:16,y:23},{floor:10,y:11}),false);
});
