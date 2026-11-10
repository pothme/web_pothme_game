import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JumpFeedbackTracker, jumpFallCue } from '../src/jump-feedback';
import { JumpPrediction } from '../src/jump-client';
import { createJumpState, createJumpStateOn, getJumpPlatformView, JUMP_COURSE, stepJumpState, respawnJumpState, type JumpState } from '../shared/jump-game';

test('actual prediction steps emit immediate first jump, second jump and soft landing once',()=>{
  const feedback=new JumpFeedbackTracker();let state=createJumpState(),sequence=0;
  feedback.reset('a',state,0);const events=[];
  while(sequence<130){
    const before=state,jump=sequence===0||sequence===5;
    state=stepJumpState(state,{seq:++sequence,x:0,z:0,jump}).state;
    events.push(...feedback.step('a',sequence,before,state));
  }
  assert.deepEqual(events.map(event=>event.kind),['jump','jump','land']);
  assert.equal(events[0].kind==='jump'&&events[0].doubleJump,false);
  assert.equal(events[1].kind==='jump'&&events[1].doubleJump,true);
  assert.ok(events[2].kind==='land'&&events[2].impactSpeed>0);
  assert.ok(events.every(event=>event.intensity>0&&event.intensity<=1));
});

test('authority reconciliation and duplicate or retired input sequences cannot repeat cues',()=>{
  const initial=createJumpState(),client=new JumpPrediction({runId:'a',ackSeq:0,state:initial}),feedback=new JumpFeedbackTracker();
  feedback.reset('a',initial,0);client.advance({x:0,z:0,jump:true});
  assert.equal(feedback.step('a',1,initial,client.state).length,1);
  client.reconcile({runId:'a',ackSeq:0,state:initial});
  assert.deepEqual(feedback.step('a',1,initial,client.state),[]);
  feedback.reset('a',initial,0);
  assert.deepEqual(feedback.step('a',1,initial,client.state),[],'reconnect reset preserves already played input sequence');
  feedback.reset('b',initial,0);
  assert.equal(feedback.step('b',1,initial,client.state).length,1,'a new run may start at input one');
});

test('join history and respawn are silent, while a fresh knockback is not also a jump',()=>{
  const initial=createJumpState(),feedback=new JumpFeedbackTracker();
  const hit:JumpState={...initial,tick:100,grounded:false,standingFloor:null,jumps:1,lastJumpTick:100,lastHitTick:100,lastHitKind:'spikes',vx:5.3,vy:6.4};
  feedback.reset('a',hit,50);
  const next={...hit,tick:101,y:hit.y+.1};
  assert.deepEqual(feedback.step('a',51,hit,next),[],'historical hit is only a baseline');
  const respawn=respawnJumpState({...hit,vy:-14});respawn.tick++;
  assert.deepEqual(feedback.step('a',52,hit,respawn),[],'the restart on the ground pad is not a landing');
  const freshHit={...hit,tick:200,lastHitTick:200,lastJumpTick:200,deaths:respawn.deaths};
  const events=feedback.step('a',53,respawn,freshHit);
  assert.deepEqual(events.map(event=>event.kind),['hit']);
  assert.ok(events[0].kind==='hit'&&events[0].hitKind==='spikes');
  assert.deepEqual(feedback.step('a',55,respawn,{...freshHit,tick:205,lastHitTick:205}),[],'clock correction cannot replay the same invulnerable contact');
  assert.equal(feedback.step('a',56,respawn,{...freshHit,tick:260,lastHitTick:260}).length,1,'a real hit after a pause is audible even with few new inputs');
  assert.equal(feedback.step('a',110,respawn,{...freshHit,tick:320,lastHitTick:320}).length,1,'later contact is audible');
});

test('a reconciled landing edge is deduplicated, and tiny settling contacts are quiet',()=>{
  const feedback=new JumpFeedbackTracker(),ground=createJumpState();
  feedback.reset('a',ground,0);
  const before={...ground,tick:20,grounded:false,vy:-5,y:.05,standingFloor:null},after={...ground,tick:21};
  assert.equal(feedback.step('a',20,before,after).length,1);
  assert.deepEqual(feedback.step('a',22,before,{...after,tick:23}),[]);
  assert.equal(feedback.step('a',40,before,{...after,tick:41}).length,1);
  assert.deepEqual(feedback.step('a',60,{...before,vy:-.2},{...after,tick:61}),[]);
});

test('trap cues fire once on each rising edge of a watched pad, never on plain pads and never twice',()=>{
  const idle=(state:JumpState)=>stepJumpState(state,{seq:state.tick+1,x:0,z:0,jump:false}).state;
  const watch=(floor:number,ticks:number,x=0)=>{
    const feedback=new JumpFeedbackTracker();let state:JumpState={...createJumpStateOn(floor,1000),invulnerableUntil:1e9};state.x+=x;
    feedback.reset('run',state,0);const events=[];
    for(let sequence=1;sequence<=ticks;sequence++){const before=state;state=idle(state);events.push(...feedback.step('run',sequence,before,state));}
    return events.flatMap(event=>event.kind==='trap'?[event]:[]);
  };
  // Floors 1-3 are plain: nothing to announce, however long the wait.
  assert.deepEqual(watch(1,600),[]);
  // Standing beside the strip on the spike pad: one warning and one firing per cycle, each on the first tick of its window.
  const spikes=JUMP_COURSE[9]!;assert.equal(spikes.hazard,'spikes');
  const near=watch(9,spikes.hazardPeriod*3,spikes.width*.45).filter(event=>event.trap==='spikes');
  const warns=near.filter(event=>event.phase==='warn'),fires=near.filter(event=>event.phase==='fire');
  assert.equal(warns.length,3);assert.equal(fires.length,3);assert.equal(new Set(near.map(event=>event.id)).size,near.length,'every cue has its own id');
  for(const event of warns){assert.equal(getJumpPlatformView(spikes,event.tick).hazardWarning,true);assert.equal(getJumpPlatformView(spikes,event.tick-1).hazardWarning,false);}
  for(const event of fires){assert.equal(getJumpPlatformView(spikes,event.tick).hazardActive,true);assert.equal(getJumpPlatformView(spikes,event.tick-1).hazardActive,false);}
  // A replayed or duplicate sequence repeats nothing.
  const feedback=new JumpFeedbackTracker();let state:JumpState={...createJumpStateOn(9,1000),invulnerableUntil:1e9};state.x+=spikes.width*.45;feedback.reset('run',state,0);
  let total=0;for(let sequence=1;sequence<=spikes.hazardPeriod;sequence++){const before=state;state=idle(state);total+=feedback.step('run',sequence,before,state).length;assert.deepEqual(feedback.step('run',sequence,before,state),[]);}
  assert.ok(total>=2);
});

test('the restart cue exists only when the fall count rises, and is scaled by the height lost',()=>{
  const high={...createJumpStateOn(60,500),floor:60},low={...createJumpStateOn(3,500),floor:3};
  assert.equal(jumpFallCue('run',7,high,stepJumpState(high,{seq:1,x:0,z:0,jump:false}).state),null,'no fall, no cue');
  const fallen=respawnJumpState(high),cue=jumpFallCue('run',7,high,fallen);
  assert.ok(cue&&cue.kind==='trap');assert.equal(cue.id,'run:7:fall');assert.equal(cue.trap,'fall');assert.equal(cue.floor,60);
  assert.equal(cue.x,fallen.x);assert.equal(cue.y,fallen.y);assert.equal(cue.tick,fallen.tick);assert.equal(cue.intensity,1);
  const small=jumpFallCue('run',8,low,respawnJumpState(low))!;assert.ok(small.intensity<cue.intensity&&small.intensity>=.35);
  // The tracker itself stays silent across the restart, so the cue is never doubled.
  const feedback=new JumpFeedbackTracker();feedback.reset('run',high,0);assert.deepEqual(feedback.step('run',1,high,fallen),[]);
});
