import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUMP_COURSE, JUMP_RULES, createJumpState, getJumpPlatformView, stepJumpState, type JumpState, type JumpInput, type JumpSnapshot } from '../shared/jump-game';
import { createJumpHarness } from './jump-game-harness.mjs';

/** A player-like controller: directional keys, then at most one airborne boost.
 * It has no ability to set a position after launch or claim a floor. */
function attemptFloor(floor:number,startTick:number,boostTick:number,side:number,lookAhead:number) {
  const source=JUMP_COURSE[floor-1]!;
  let state:JumpState={...createJumpState(Math.floor((floor-1)/10)*10),floor:floor-1,standingFloor:floor-1,tick:startTick,invulnerableUntil:0};
  const start=getJumpPlatformView(source,startTick,state);
  if(!start.active)return null;
  state.x=start.x;state.y=start.y;state.z=start.z;
  if(source.kind==='spikes')state.x+=source.width*.34;
  if(source.kind==='sweep') {
    state.x+=Math.cos(start.sweepAngle+Math.PI/2)*source.width*.34;
    state.z+=Math.sin(start.sweepAngle+Math.PI/2)*source.depth*.34;
  }
  if(source.kind==='crumble')state.crumbleAt[String(source.floor)]=startTick-5;
  return jumpFromState(state,boostTick,side,lookAhead);
}

function jumpFromState(initial:JumpState,boostTick:number,side:number,lookAhead:number,frames:JumpInput[]=[]) {
  let state=initial;
  const floor=state.floor+1,source=JUMP_COURSE[floor-1]!,target=JUMP_COURSE[floor]!;
  for(let tick=0;tick<160;tick++) {
    const view=getJumpPlatformView(target,state.tick+lookAhead,state);
    // The side of a spike/sweep pad is deliberately safe; aim away from its center.
    const aimX=view.x+side*target.width*.34,aimZ=view.z;
    const x=Math.max(-1,Math.min(1,(aimX-state.x)*2.3-state.vx*.14));
    const z=Math.max(-1,Math.min(1,(aimZ-state.z)*2.3-state.vz*.14));
    const frame={seq:state.tick+1,x,z,jump:tick===0||tick===boostTick};frames.push(frame);
    const result=stepJumpState(state,frame);
    state=result.state;
    if(result.died||state.lastHitTick!==initial.lastHitTick)return null;
    if(result.landedFloor===floor)return state;
    if(state.y<source.y-3)return null;
  }
  return null;
}

function findLanding(floor:number,startTick:number,maxWait=200) {
  for(let wait=0;wait<=maxWait;wait+=10) {
    for(const boost of [-1,12,20,28]) {
      for(const side of [0,-1,1]) {
        for(const lookAhead of [0,20]) {
          const state=attemptFloor(floor,startTick+wait,boost,side,lookAhead);
          if(state)return {state,wait,boost,side};
        }
      }
    }
  }
  return null;
}

test('jump course has sixty ordered, increasingly tall floors with safe checkpoints',()=>{
  assert.equal(JUMP_COURSE.length,61);
  let previousRise=0;
  for(let floor=1;floor<=60;floor++) {
    const current=JUMP_COURSE[floor]!,previous=JUMP_COURSE[floor-1]!;
    assert.equal(current.floor,floor);
    const rise=current.y-previous.y;
    assert.ok(rise>=previousRise-1e-9,`floor ${floor} difficulty regressed`);
    assert.ok(rise<JUMP_RULES.jumpVelocity**2/(2*JUMP_RULES.gravity),`floor ${floor} exceeds even a single jump's apex`);
    assert.ok(current.width>=1.8&&current.depth>=1.8,`floor ${floor} lacks a usable landing zone`);
    if(floor%10===0) {
      assert.equal(current.kind,'safe');
      assert.ok(current.width>=4);
      const state=createJumpState(floor);
      assert.equal(state.checkpoint,floor);
      assert.equal(state.standingFloor,floor);
      assert.equal(state.y,current.y);
    }
    previousRise=rise;
  }
  assert.deepEqual(new Set(JUMP_COURSE.map(p=>p.kind)),new Set(['safe','moving','blink','crumble','sweep','spikes','wind','pusher','conveyor','ice']));
});

test('every floor can be reached using ordinary direction and double-jump inputs across trap phases',()=>{
  const failures:string[]=[];
  for(let floor=1;floor<=60;floor++) {
    // Includes early, late and wrapped hazard phases rather than only fresh-run tick zero.
    for(const startTick of [250,317,449,710]) {
      const result=findLanding(floor,startTick);
      if(!result)failures.push(`${floor}:${JUMP_COURSE[floor]!.kind}@${startTick}`);
      else {
        assert.equal(result.state.floor,floor);
        assert.equal(result.state.standingFloor,floor);
        assert.equal(result.state.deaths,0);
      }
    }
  }
  assert.deepEqual(failures,[],`Unreachable transitions: ${failures.join(', ')}`);
});

test('standing players are carried by moving platforms without involuntary drift or death',()=>{
  for(const platform of JUMP_COURSE.filter(p=>p.kind==='moving')) {
    let state:JumpState={...createJumpState(Math.floor(platform.floor/10)*10),floor:platform.floor,standingFloor:platform.floor,tick:250,invulnerableUntil:0};
    const initial=getJumpPlatformView(platform,state.tick,state);
    state.x=initial.x;state.y=initial.y;state.z=initial.z;
    for(let tick=0;tick<400;tick++) {
      const result=stepJumpState(state,{seq:tick,x:0,z:0,jump:false});state=result.state;
      const view=getJumpPlatformView(platform,state.tick,state);
      assert.equal(result.died,false);
      assert.equal(state.standingFloor,platform.floor);
      assert.ok(Math.hypot(state.x-view.x,state.z-view.z)<1e-8);
    }
  }
});

function planFullRoute(startTick=0) {
  let state=createJumpState(0,startTick);
  const frames:JumpInput[]=[];
  const checkpoints:number[]=[];
  for(let floor=1;floor<=60;floor++) {
    const original=state;
    let landing:JumpState|null=null;
    for(let wait=0;wait<=80&&!landing;wait+=5) {
      let candidate=original,valid=true;
      const waitFrames:JumpInput[]=[];
      for(let step=0;step<wait;step++) {
        const view=getJumpPlatformView(JUMP_COURSE[floor-1]!,candidate.tick,candidate);
        const frame={seq:candidate.tick+1,x:Math.max(-1,Math.min(1,(view.x-candidate.x)*2.3-candidate.vx*.14)),z:Math.max(-1,Math.min(1,(view.z-candidate.z)*2.3-candidate.vz*.14)),jump:false};waitFrames.push(frame);
        const result=stepJumpState(candidate,frame);
        candidate=result.state;
        if(result.died||candidate.lastHitTick!==original.lastHitTick){valid=false;break;}
      }
      if(!valid)continue;
      for(const boost of [-1,12,20,28]) {
        for(const side of [0,-1,1]) {
          for(const lookAhead of [0,20]) {
            const jumpFrames:JumpInput[]=[];
            landing=jumpFromState(candidate,boost,side,lookAhead,jumpFrames);
            if(landing){frames.push(...waitFrames,...jumpFrames);break;}
          }
          if(landing)break;
        }
        if(landing)break;
      }
    }
    assert.ok(landing,`continuous route stopped at floor ${floor}: ${JUMP_COURSE[floor]!.kind}`);
    state=landing;
    assert.equal(state.deaths,0);
    if(floor%10===0)checkpoints.push(state.checkpoint);
  }
  assert.equal(state.floor,60);
  assert.equal(state.status,'complete');
  assert.deepEqual(checkpoints,[10,20,30,40,50,60]);
  assert.ok(state.tick-startTick>60*20,'all floors require actual simulated travel time');
  return {state,frames};
}

test('continuous sixty-floor routes preserve momentum and trap timers across phases without teleporting or taking hits',()=>{
  for(const startTick of [0,67,199,460]){
    const {state,frames}=planFullRoute(startTick);
    assert.equal(state.tick,frames.length+startTick);
    assert.equal(frames.at(-1)?.seq,state.tick);
    assert.equal(state.lastHitTick,-1);
  }
});

test('falling resets to the last safe checkpoint while preserving the death count',()=>{
  for(const checkpoint of [0,10,20,30,40,50]) {
    const state={...createJumpState(checkpoint),x:JUMP_COURSE[checkpoint]!.x+4.5,y:JUMP_COURSE[checkpoint]!.y-4.9,vx:0,vy:-8,grounded:false,standingFloor:null,deaths:3,tick:800};
    const result=stepJumpState(state,{seq:1,x:0,z:0,jump:false});
    assert.equal(result.died,true);
    assert.equal(result.state.checkpoint,checkpoint);
    assert.equal(result.state.floor,checkpoint);
    assert.equal(result.state.standingFloor,checkpoint);
    assert.equal(result.state.deaths,4);
    assert.equal(result.state.x,JUMP_COURSE[checkpoint]!.x);
    assert.equal(result.state.y,JUMP_COURSE[checkpoint]!.y);
    assert.equal(result.state.z,JUMP_COURSE[checkpoint]!.z);
  }
});

test('the actual server accepts a full input-only climb and awards exactly sixty floor rewards plus summit',async()=>{
  const {mf,jump}=await createJumpHarness();
  try {
    // This route was planned from arena tick zero. The server's global clock
    // must begin at the same phase to compare deterministic trap positions.
    let now=0;
    await jump.connect('climber','independent-review',now);
    const entered=await jump.command('climber',{type:'jump-enter'},now);
    assert.equal(entered.ok,true);
    let snapshot:JumpSnapshot=entered.state;
    const basePoints=snapshot.profile.points,{state:expected,frames}=planFullRoute();
    for(let offset=0;offset<frames.length;offset+=JUMP_RULES.maxBatchFrames) {
      const batch=frames.slice(offset,offset+JUMP_RULES.maxBatchFrames);
      now+=batch.length*JUMP_RULES.stepMs;
      const result=await jump.command('climber',{type:'jump-input',runId:snapshot.runId,frames:batch},now);
      assert.equal(result.ok,true,`input ${offset}: ${result.code} ${result.message}`);
      snapshot=result.state;
    }
    assert.deepEqual(snapshot.state,expected,'predicted and authoritative simulations agree for the complete course');
    assert.equal(snapshot.profile.points,basePoints+360);
    assert.equal(snapshot.rewards.totalPoints,360);
    assert.equal((await jump.rewards()).length,60);
    assert.equal(snapshot.leaderboard[0]?.bestFloor,60);

    const replay=await jump.command('climber',{type:'jump-input',runId:snapshot.runId,frames:frames.slice(-12)},now);
    assert.equal(replay.ok,true);assert.equal(replay.state.profile.points,basePoints+360);
    assert.equal(replay.state.state.tick,snapshot.state.tick);
  } finally {await mf.dispose();}
});

test('a second character cannot replay another run, and idle time cannot bank unlimited simulation credit',async()=>{
  const {mf,jump}=await createJumpHarness();
  try {
    for(const id of ['alice','bob']){await jump.connect(id,id,1000);await jump.command(id,{type:'jump-enter'},1000);}
    const alice:JumpSnapshot=await jump.state('alice',1000),bob:JumpSnapshot=await jump.state('bob',1000);
    const frames=(first:number,count:number)=>Array.from({length:count},(_,i)=>({seq:first+i,x:0,z:0,jump:false}));
    const stolen=await jump.command('bob',{type:'jump-input',runId:alice.runId,frames:frames(1,1)},1000);
    assert.equal(stolen.code,'JUMP_RUN');assert.equal(stolen.state.ackSeq,0);
    const allowance=Math.floor(JUMP_RULES.maxStoredCreditMs/JUMP_RULES.stepMs);
    for(let offset=0;offset<allowance;offset+=JUMP_RULES.maxBatchFrames){
      const first=await jump.command('bob',{type:'jump-input',runId:bob.runId,frames:frames(offset+1,Math.min(JUMP_RULES.maxBatchFrames,allowance-offset))},1_000_000);
      assert.equal(first.ok,true,first.message);
    }
    const excess=await jump.command('bob',{type:'jump-input',runId:bob.runId,frames:frames(allowance+1,1)},1_000_000);
    assert.equal(excess.code,'JUMP_RATE');assert.equal(excess.state.ackSeq,allowance);
    assert.equal(excess.state.profile.points,bob.profile.points);
    assert.equal((await jump.state('alice',1_000_000)).ackSeq,0);
  } finally {await mf.dispose();}
});
