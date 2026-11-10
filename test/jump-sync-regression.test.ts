import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JumpPrediction } from '../src/jump-client';
import { alignJumpClock, createJumpState, createJumpStateOn, getJumpPlatformView, JUMP_COURSE, JUMP_RULES, stepJumpState, type JumpInput, type JumpState } from '../shared/jump-game';

function doubleJumpToSecondFloor() {
  let state=createJumpState(); const frames:JumpInput[]=[];
  const target=JUMP_COURSE[2];
  for(let tick=0;tick<100;tick++){
    const frame={seq:tick+1,x:Math.max(-1,Math.min(1,(target.x-state.x)*2.3-state.vx*.14)),z:Math.max(-1,Math.min(1,(target.z-state.z)*2.3-state.vz*.14)),jump:tick===0||tick===20};
    frames.push(frame); const result=stepJumpState(state,frame);state=result.state;
    if(result.landedFloor===2)return{state,frames};
    if(result.died)break;
  }
  return{state,frames};
}

test('a real double jump can land on floor two without touching floor one',()=>{
  const {state}=doubleJumpToSecondFloor();
  assert.equal(state.floor,2,'the visible second platform must have collision');
  assert.equal(state.standingFloor,2);
  assert.equal(state.deaths,0);
});

test('a full pending queue can reset to authority and immediately accept fresh inputs',()=>{
  const client=new JumpPrediction({runId:'run',ackSeq:0,state:createJumpState()});
  for(let i=0;i<150;i++)client.advance({x:0,z:0,jump:false});
  assert.equal(client.advance({x:0,z:0,jump:true}),false);
  const authority={runId:'run',ackSeq:40,state:{...createJumpState(),tick:40}};
  client.reset(authority);
  assert.equal(client.queued,0);
  assert.equal(client.advance({x:0,z:0,jump:true}),true);
  assert.deepEqual(client.outgoing().map(frame=>frame.seq),[41]);
});

test('the server batch allowance keeps up with 50Hz physics at a 22ms render cadence',()=>{
  const client=new JumpPrediction({runId:'run',ackSeq:0,state:createJumpState()});
  let authority=createJumpState(),accumulator=0,lastFlush=0,maxQueued=0;
  for(let now=22;now<=120000;now+=22){
    accumulator+=22;
    while(accumulator>=20){accumulator-=20;assert.equal(client.advance({x:0,z:0,jump:false}),true);}
    maxQueued=Math.max(maxQueued,client.queued);
    if(now-lastFlush>=200){
      const frames=client.outgoing();client.markSent(frames);
      for(const frame of frames)authority=stepJumpState(authority,frame).state;
      client.reconcile({runId:'run',ackSeq:frames.at(-1)!.seq,state:authority});lastFlush=now;
    }
  }
  assert.ok(maxQueued<=12,`queued input grew to ${maxQueued}`);
});

test('shared-clock alignment carries a moving-platform rider without simulating unreceived movement',()=>{
  const platform=JUMP_COURSE.find(p=>p.kind==='moving')!,tick=12000;
  const state=createJumpStateOn(platform.floor,tick);
  const start=getJumpPlatformView(platform,tick,state);state.x=start.x+.2;state.y=start.y;state.z=start.z-.1;
  const aligned=alignJumpClock(state,tick+150),end=getJumpPlatformView(platform,tick+150,aligned);
  assert.equal(aligned.tick,tick+150);assert.ok(Math.abs(aligned.x-end.x-.2)<1e-10);assert.ok(Math.abs(aligned.z-end.z+.1)<1e-10);
  assert.equal(aligned.y,state.y);assert.equal(aligned.vx,state.vx);assert.equal(aligned.vy,state.vy);assert.equal(aligned.vz,state.vz);
  assert.equal(state.tick,tick,'alignment must not mutate a snapshot retained by prediction');
  assert.strictEqual(alignJumpClock(aligned,tick),aligned,'old clock observations cannot rewind hazards');
});

test('shared-clock creation and air alignment preserve relative jump guards without teleporting',()=>{
  const tick=85_000_000_000,initial=createJumpStateOn(10,tick);
  assert.equal(initial.tick,tick);assert.equal(initial.lastJumpTick,tick-100);assert.equal(initial.invulnerableUntil,tick+JUMP_RULES.spawnInvulnerabilityTicks);assert.equal(createJumpState(tick).standingFloor,0);
  const jumped=stepJumpState(initial,{seq:1,x:1,z:0,jump:true}).state;
  const aligned=alignJumpClock(jumped,tick+100);
  assert.equal(aligned.tick,tick+100);assert.equal(aligned.x,jumped.x);assert.equal(aligned.y,jumped.y);assert.equal(aligned.z,jumped.z);
  assert.equal(aligned.jumps,1);assert.equal(aligned.vy,jumped.vy);
});

test('prediction reconciliation preserves an authoritative trap impulse and replays airborne steering',()=>{
  const platform=JUMP_COURSE.find(candidate=>candidate.kind==='spikes')!;
  let tick=12000;while(!getJumpPlatformView(platform,tick+1).hazardActive)tick++;
  const view=getJumpPlatformView(platform,tick+1),initial:JumpState={...createJumpStateOn(platform.floor,tick),x:view.x,y:view.y,z:view.z,invulnerableUntil:0};
  const client=new JumpPrediction({runId:'hit-run',ackSeq:0,state:initial});
  const frames=Array.from({length:12},(_,index)=>({seq:index+1,x:index===0?0:-.5,z:0,jump:index===8}));
  let expected=initial,first=initial;
  for(const frame of frames){assert.equal(client.advance(frame),true);expected=stepJumpState(expected,frame).state;if(frame.seq===1)first=expected;}
  assert.equal(first.lastHitKind,'spikes');assert.equal(first.deaths,0);assert.equal(first.grounded,false);
  client.markSent(client.outgoing());client.reconcile({runId:'hit-run',ackSeq:1,state:first});
  assert.deepEqual(client.state,expected);assert.equal(client.queued,11);
  client.reconcile({runId:'hit-run',ackSeq:12,state:expected});assert.equal(client.queued,0);
  assert.equal(client.state.floor,platform.floor);assert.equal(client.state.deaths,0);
});
