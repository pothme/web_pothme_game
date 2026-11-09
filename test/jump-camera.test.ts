import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createJumpState,getJumpPlatformView,JUMP_COURSE} from '../shared/jump-game';
import {fitJumpCamera,jumpCameraAnchors,jumpPlatformOccludes,nextJumpCameraFloor,JUMP_CAMERA_PITCH} from '../src/jump-camera';

test('default and orbited cameras frame the whole avatar and next landing inside PC and phone UI',()=>{
  for(const [width,height] of [[1920,855],[390,844],[320,740],[844,390]])for(const floor of [0,6,8,9,18,23,29,48,58])for(const rise of [0,1.6,3.1]){
    const platform=JUMP_COURSE[floor],state={...createJumpState(),x:platform.x,y:platform.y+rise,z:platform.z,floor,standingFloor:rise?null:floor,grounded:rise===0};
    const nextPlatform=JUMP_COURSE[floor+1],next={...getJumpPlatformView(nextPlatform,1234,state),cameraHeight:nextPlatform.kind==='pusher'?.85:nextPlatform.kind==='spikes'?.6:nextPlatform.kind==='sweep'?.5:0},baseYaw=Math.atan2(state.x-next.x,state.z-next.z);
    for(const orbit of [0,.8,Math.PI/2,Math.PI]){
      const frame=fitJumpCamera(state,next,baseYaw+orbit,JUMP_CAMERA_PITCH,width/height,8.5,height);
      const camera=new THREE.PerspectiveCamera(51,width/height,.1,140);camera.position.set(frame.position.x,frame.position.y,frame.position.z);camera.lookAt(frame.focus.x,frame.focus.y,frame.focus.z);camera.updateMatrixWorld();
      const samples=jumpCameraAnchors(state,next);
      for(const point of [...samples.avatar,...samples.landing]){
        const screen=new THREE.Vector3(point.x,point.y,point.z).project(camera);
        assert.ok(Math.abs(screen.x)<=frame.limits.horizontal+.001,`horizontal clip ${width}/${floor}/${rise}/${orbit}`);
        assert.ok(screen.y<=frame.limits.top+.001&&screen.y>=-frame.limits.bottom-.001,`HUD overlap ${width}/${floor}/${rise}/${orbit}`);
        assert.ok(screen.z<1&&screen.z>-1);
      }
      assert.ok(frame.distance<28,'even a narrow phone side view must stay near the current steps');
      if(orbit===0)assert.ok(frame.distance<18,'the default view must keep the character readable');
    }
  }
});

test('body and landing edge samples detect slabs missed by a single center ray',()=>{
  const camera={x:0,y:4,z:8},platform={x:.9,y:2.4,z:4,width:.45,depth:1};
  assert.equal(jumpPlatformOccludes(platform,camera,[{x:0,y:0,z:0}]),false);
  assert.equal(jumpPlatformOccludes(platform,camera,[{x:1.7,y:1.5,z:0}]),true);
  assert.equal(jumpPlatformOccludes({...platform,z:-4},camera,[{x:1.7,y:1.5,z:0}]),false,'objects behind the destination are not blockers');
  assert.equal(jumpPlatformOccludes({...platform,x:0,y:4,z:8},camera,[{x:0,y:1,z:0}]),true,'a camera inside an upper slab must fade it');
});

test('landing guidance follows lower physical footing and stays stable in flight',()=>{
  const state={...createJumpState(),floor:27,standingFloor:21,grounded:true};
  assert.equal(nextJumpCameraFloor(state,28),22);
  assert.equal(nextJumpCameraFloor({...state,standingFloor:null,grounded:false},22),22);
  assert.equal(nextJumpCameraFloor({...state,floor:60,standingFloor:60}),60);
});
