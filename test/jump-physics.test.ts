import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJumpState,getJumpPlatformView,JUMP_COURSE,JUMP_RULES,stepJumpState,type JumpState} from '../shared/jump-game';
const step=(state:JumpState,jump=false,x=0,z=0)=>stepJumpState(state,{seq:state.tick+1,x,z,jump});

test('jump responds in the same fixed step, requires rising edges and permits only two airborne jumps',()=>{
 let state=createJumpState();state=step(state,true).state;assert.ok(state.y>0);assert.equal(state.jumps,1);
 for(let i=0;i<8;i++)state=step(state,true).state;assert.equal(state.jumps,1);
 state=step(state,false).state;const boost=step(state,true);state=boost.state;assert.equal(state.jumps,2);assert.ok(state.vy>7);
 for(let i=0;i<5;i++)state=step(state,false).state;const before=state.vy;state=step(state,true).state;assert.equal(state.jumps,2);assert.ok(state.vy<before);
});

test('fixed-step input is deterministic, diagonal speed bounded and input clamped',()=>{
 let a=createJumpState(),b=createJumpState();
 for(let i=0;i<100;i++){a=step(a,i===0||i===20,1,1).state;b=step(b,i===0||i===20,999,999).state;assert.deepEqual(a,b);assert.ok(Math.hypot(a.vx,a.vz)<=JUMP_RULES.speed+1e-9);}
});

test('blink and crumble publish warning windows before losing collision and then recover',()=>{
 const blink=JUMP_COURSE.find(p=>p.kind==='blink')!;
 const tick=(phase:number)=>(phase-blink.phase+400)%200;
 assert.equal(getJumpPlatformView(blink,tick(140)).warning,true);assert.equal(getJumpPlatformView(blink,tick(140)).active,true);assert.equal(getJumpPlatformView(blink,tick(170)).active,false);assert.equal(getJumpPlatformView(blink,tick(195)).active,true);
 const crumble=JUMP_COURSE.find(p=>p.kind==='crumble')!,state={...createJumpState(),crumbleAt:{[crumble.floor]:100}};
 assert.equal(getJumpPlatformView(crumble,120,state).warning,true);assert.equal(getJumpPlatformView(crumble,154,state).active,true);assert.equal(getJumpPlatformView(crumble,155,state).active,false);assert.equal(getJumpPlatformView(crumble,280,state).active,true);
});

test('spikes and rotating sweeper hit center hazards, preserve side paths and can be jumped',()=>{
 for(const kind of ['spikes','sweep']){
  const platform=JUMP_COURSE.find(p=>p.kind===kind)!;const tick=kind==='spikes'?(130-platform.phase+400)%200:400;
  const base={...createJumpState(),x:platform.x,y:platform.y,z:platform.z,tick:tick-1,floor:platform.floor,standingFloor:platform.floor,invulnerableUntil:0};
  const hit=step(base);assert.equal(hit.died,false,`${kind} must throw instead of teleporting`);assert.equal(hit.state.lastHitKind,kind);assert.equal(hit.state.grounded,false);
  const avoided=step(base,true);assert.equal(avoided.died,false,`${kind} is avoidable with jump`);assert.equal(avoided.state.lastHitKind,null);
  const view=getJumpPlatformView(platform,tick,base),side=kind==='spikes'?{x:platform.x+platform.width*.42,z:platform.z}:{x:platform.x-Math.sin(view.sweepAngle)*platform.width*.4,z:platform.z+Math.cos(view.sweepAngle)*platform.depth*.4};
  const edge=step({...base,...side});assert.equal(edge.died,false,`${kind} must retain a safe edge`);assert.equal(edge.state.lastHitKind,null);
 }
});

test('a physically crossed higher platform is solid and a crossed checkpoint is retained',()=>{
 const p=JUMP_COURSE[11]!,state={...createJumpState(),x:p.x,y:p.y+.01,z:p.z,vy:-1,grounded:false,standingFloor:null};
 const result=step(state);assert.equal(result.landedFloor,11);assert.equal(result.state.floor,11);assert.equal(result.state.checkpoint,10);
});
