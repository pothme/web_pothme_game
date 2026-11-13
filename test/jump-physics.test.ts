import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJumpState,createJumpStateOn,getJumpPlatformView,JUMP_COURSE,JUMP_RULES,stepJumpState,type JumpState} from '../shared/jump-game';
import {climb} from './jump-solver';
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
 // Garbage directions are treated as no direction, never as NaN positions.
 let c=createJumpState();for(const value of [NaN,Infinity,-Infinity,undefined as never,'1' as never])c=step(c,false,value,value).state;
 assert.ok(Number.isFinite(c.x)&&Number.isFinite(c.z)&&Number.isFinite(c.vx));assert.equal(c.standingFloor,0);
});

test('a state never mutates: every step returns a new snapshot and leaves its input intact',()=>{
 const run=climb({untilFloor:9});let state=createJumpState();
 for(const frame of run.frames.slice(0,400)){
  const frozen=structuredClone(state),result=stepJumpState(state,frame);
  assert.deepEqual(state,frozen);assert.notEqual(result.state,state);state=result.state;
 }
 assert.ok(Object.keys(state.crumbleAt).length<=4,'crumble timers do not accumulate');
});

test('the rule constants give the reach the course is built on',()=>{
 const g=JUMP_RULES.gravity,v=JUMP_RULES.jumpVelocity;
 let state=step(createJumpState(),true).state,apex=0,ticks=1;
 while(!state.grounded&&ticks<200){apex=Math.max(apex,state.y);state=step(state).state;ticks++;}
 assert.ok(Math.abs(apex-v*v/(2*g))<.1,'single jump apex about 1.87');assert.ok(Math.abs(ticks*JUMP_RULES.stepMs/1000-2*v/g)<.06,'single jump air time about 0.91 s');
 state=step(createJumpState(),true).state;apex=0;
 for(let i=0;i<200&&!state.grounded;i++){state=step(state,state.vy<=.2&&state.jumps===1&&!state.jumpHeld).state;apex=Math.max(apex,state.y);}
 assert.ok(Math.abs(apex-(v*v/g-v*JUMP_RULES.stepMs/1000))<.05,'double jump apex about 3.57 in fixed steps');
 assert.ok(JUMP_RULES.springVelocity**2/(2*g)>v*v/g+1,'a spring throws higher than any double jump');
 assert.equal(JUMP_RULES.floors%JUMP_RULES.zoneFloors,0);
 assert.equal(JUMP_RULES.maxRewardPoints,JUMP_RULES.floors*JUMP_RULES.floorReward+JUMP_RULES.summitReward);
});

test('a physically crossed higher platform is solid, pays every crossed floor once and keeps no checkpoint',()=>{
 const p=JUMP_COURSE[11]!,state={...createJumpState(),x:p.x,y:p.y+.01,z:p.z,vy:-1,grounded:false,standingFloor:null};
 const result=step(state);assert.equal(result.landedFloor,11);assert.equal(result.state.floor,11);assert.equal(result.state.lastFloor,11);assert.equal(result.state.fallFrom,p.y);
 assert.equal('checkpoint' in result.state,false);
 const again=step({...result.state,y:p.y+.01,vy:-1,grounded:false,standingFloor:null});assert.equal(again.landedFloor,null,'the same floor is not a new landing');
 const summit=JUMP_COURSE[JUMP_RULES.floors]!,top=step({...createJumpStateOn(JUMP_RULES.floors-1,900),x:summit.x,y:summit.y+.01,z:summit.z,vy:-1,grounded:false,standingFloor:null});
 assert.equal(top.landedFloor,JUMP_RULES.floors);assert.equal(top.state.status,'complete');
 const frozen=step(top.state,true,1,1).state;assert.equal(frozen.x,top.state.x);assert.equal(frozen.y,top.state.y);assert.equal(frozen.tick,top.state.tick+1,'a finished run only keeps time');
 // Pads are one-way: rising through one from below never lands on it.
 const under=step({...createJumpState(),x:p.x,y:p.y-.05,z:p.z,vy:6,grounded:false,standingFloor:null,jumps:2});assert.equal(under.state.grounded,false);assert.ok(under.state.y>p.y);
});

test('one step looks only at the pads near the player: the authority can afford every player at 50 Hz',()=>{
 // Fifty players for one minute are 150,000 steps. A scan of all 101 pads per step would be many times slower.
 const run=climb({untilFloor:40}),frames=run.frames;let state=createJumpState(),steps=0;const started=performance.now();
 for(let round=0;round<40;round++){state=createJumpState();for(const frame of frames){state=stepJumpState(state,frame).state;steps++;}}
 const micros=(performance.now()-started)*1000/steps;
 assert.equal(state.floor,40);assert.ok(steps>60_000);
 assert.ok(micros<25,`one step took ${micros.toFixed(2)} µs`);
 // The same holds far from the ground: cost does not grow with the floor number.
 let high:JumpState={...createJumpStateOn(96,5000),invulnerableUntil:1e9};const highStart=performance.now();
 for(let i=0;i<60_000;i++)high=step(high,i%60===0,Math.sin(i/40)*.3,Math.cos(i/40)*.3).state;
 assert.ok((performance.now()-highStart)*1000/60_000<25);
 for(const platform of JUMP_COURSE)assert.ok(Number.isFinite(getJumpPlatformView(platform,5000).y));
});
