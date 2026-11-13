import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createJumpState,getJumpPlatformView,JUMP_COURSE,JUMP_RULES} from '../shared/jump-game';
import {fitJumpCamera,jumpCameraAnchors,jumpCameraHeading,jumpPlatformOccludes,nextJumpCameraFloor,turnJumpCamera,JUMP_CAMERA_PITCH} from '../src/jump-camera';

test('default and orbited cameras frame the whole avatar and next landing inside PC and phone UI',()=>{
  for(const [width,height] of [[1920,855],[390,844],[320,740],[844,390]])for(const floor of [0,6,8,9,18,22,24,33,48,58,66,77,84,95,99])for(const rise of [0,1.6,3.1]){
    const platform=JUMP_COURSE[floor],state={...createJumpState(),x:platform.x,y:platform.y+rise,z:platform.z,floor,standingFloor:rise?null:floor,grounded:rise===0};
    const nextPlatform=JUMP_COURSE[floor+1],next={...getJumpPlatformView(nextPlatform,1234,state),cameraHeight:nextPlatform.kind==='pusher'?.85:nextPlatform.kind==='spikes'?.6:nextPlatform.kind==='sweep'?.5:0},baseYaw=Math.atan2(state.x-next.x,state.z-next.z);
    // Long leaps and spring launches put the landing far away; the camera may pull back in proportion to that span.
    const span=Math.hypot(next.x-state.x,next.y-state.y,next.z-state.z)+Math.max(next.width,next.depth)/2;
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
      assert.ok(frame.distance<Math.max(28,span*6.2),'even a narrow phone side view must stay near the current steps');
      if(orbit===0)assert.ok(frame.distance<Math.max(18,span*4.2),'the default view must keep the character readable');
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
  assert.equal(nextJumpCameraFloor({...state,floor:JUMP_RULES.floors,standingFloor:JUMP_RULES.floors}),JUMP_RULES.floors);
});

test('the camera heading follows the route: behind a straight leap, across a reversal, unchanged on a lift',()=>{
  const turn=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
  const here={x:0,z:0},ahead={x:0,y:1,z:-4};
  // A leap toward -z is watched from behind (+z side): yaw 0 by the scene's convention.
  assert.ok(turn(jumpCameraHeading(here,ahead,null,2),0)<1e-9);
  assert.ok(turn(jumpCameraHeading(here,ahead,{x:0,y:2,z:-8},2),0)<1e-9,'a straight route keeps the same view');
  // Straight up or down has no direction of its own: the view stays where it is.
  assert.equal(jumpCameraHeading(here,{x:.2,y:4,z:.1},{x:5,y:5,z:0},1.23),1.23);
  // Where the route doubles back, a wide screen looks across it from the side it is already on.
  const back={x:0,y:2,z:0},fromLeft=jumpCameraHeading(here,ahead,back,Math.PI/2),fromRight=jumpCameraHeading(here,ahead,back,-Math.PI/2);
  assert.ok(turn(fromLeft,Math.PI/2)<1e-9&&turn(fromRight,-Math.PI/2)<1e-9,'the nearer side view wins');
  assert.ok(turn(jumpCameraHeading(here,ahead,back,.3),0)>1,'a reversal is not watched from behind');
  // A portrait phone cannot fit a long leap sideways: it stays behind it, but still turns side-on for short hops.
  assert.ok(turn(jumpCameraHeading(here,ahead,back,Math.PI/2,.46),0)<1e-9);
  assert.ok(turn(jumpCameraHeading(here,{x:0,y:1,z:-2.8},back,Math.PI/2,.46),Math.PI/2)<1e-9);
  // On every pad of the real course the heading is a finite angle.
  for(let floor=0;floor<JUMP_RULES.floors;floor++){
    const a=JUMP_COURSE[floor]!,b=JUMP_COURSE[floor+1]!,c=JUMP_COURSE[floor+2]??null;
    for(const aspect of [.46,1,2.2])assert.ok(Number.isFinite(jumpCameraHeading(a,b,c,0,aspect)),`floor ${floor}`);
  }
});

test('the camera turn has a dead zone and a capped rate, and always arrives',()=>{
  // Small differences are ignored while the camera is at rest, so it does not fidget.
  assert.deepEqual(turnJumpCamera(1,1.3,.016,false),{yaw:1,turning:false});
  // Once a turn is under way it is finished, even inside the dead zone.
  const finishing=turnJumpCamera(1,1.3,.016,true);assert.equal(finishing.turning,true);assert.ok(finishing.yaw>1&&finishing.yaw<1.3);
  assert.deepEqual(turnJumpCamera(1,1.01,.016,true),{yaw:1.01,turning:false});
  // A half turn never whips round: at most 2.1 rad/s, the shorter way, without overshoot.
  let yaw=2.5,turning=false,time=0,fastest=0;const target=-2.5;
  while(time<5){const next=turnJumpCamera(yaw,target,1/60,turning);fastest=Math.max(fastest,Math.abs(Math.atan2(Math.sin(next.yaw-yaw),Math.cos(next.yaw-yaw)))*60);yaw=next.yaw;turning=next.turning;time+=1/60;if(!turning&&time>.1)break;}
  assert.equal(turning,false);assert.ok(Math.abs(Math.atan2(Math.sin(yaw-target),Math.cos(yaw-target)))<1e-9);
  assert.ok(fastest<=2.1+1e-9,`turn rate ${fastest}`);
  // A stalled frame (dt 0) or a negative one moves nothing.
  assert.equal(turnJumpCamera(0,2,0,false).yaw,0);assert.equal(turnJumpCamera(0,2,-1,false).yaw,0);
});
