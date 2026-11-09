import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJumpHarness} from './jump-game-harness.mjs';
import {JUMP_COURSE,JUMP_RULES,createJumpState,getJumpPlatformView,stepJumpState,type JumpInput,type JumpSnapshot} from '../shared/jump-game';
const frame=(seq:number)=>({seq,x:0,z:0,jump:false});
const batch=(state:JumpSnapshot,count=10)=>({type:'jump-input',runId:state.runId,frames:Array.from({length:count},(_,i)=>frame(state.ackSeq+i+1))});
async function enter(jump:any,id='a',now=1000){await jump.connect(id,id,now);const result=await jump.command(id,{type:'jump-enter'},now);assert.equal(result.ok,true);return result.state as JumpSnapshot;}
async function land(jump:any,id:string,floor:number,now:number){const state=await jump.prepareLanding(id,floor,now);const result=await jump.command(id,batch(state,1),now);assert.equal(result.ok,true,result.message);assert.equal(result.state.state.floor,floor);return result.state as JumpSnapshot;}

/** Uses only directional input and the two jump presses available to a player. */
function planSecondFloor(snapshot:JumpSnapshot){
 let state=snapshot.state;const frames:JumpInput[]=[],target=JUMP_COURSE[2]!;
 for(let tick=0;tick<100;tick++){
  const input={seq:snapshot.ackSeq+tick+1,x:Math.max(-1,Math.min(1,(target.x-state.x)*2.3-state.vx*.14)),z:Math.max(-1,Math.min(1,(target.z-state.z)*2.3-state.vz*.14)),jump:tick===0||tick===20};
  frames.push(input);const result=stepJumpState(state,input);state=result.state;
  assert.equal(result.died,false);assert.notEqual(result.landedFloor,1,'this route must skip the first platform');
  if(result.landedFloor===2)return{state,frames};
 }
 assert.fail('ordinary double-jump input did not reach the second platform');
}
async function sendFrames(jump:any,snapshot:JumpSnapshot,frames:JumpInput[],now:number){
 for(let offset=0;offset<frames.length;offset+=JUMP_RULES.maxBatchFrames){
  const inputs=frames.slice(offset,offset+JUMP_RULES.maxBatchFrames);now+=inputs.length*JUMP_RULES.stepMs;
  const result=await jump.command('a',{type:'jump-input',runId:snapshot.runId,frames:inputs},now);assert.equal(result.ok,true,result.message);snapshot=result.state;
 }
 return{snapshot,now};
}

test('tower validates entry, raw input shape, sequence, replay and elapsed-time credit',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  assert.equal((await jump.command('stranger',{type:'jump-enter'},1000)).code,'NOT_JOINED');
  await jump.connect('a','alpha',1000);await jump.permit(false);
  assert.equal((await jump.command('a',{type:'jump-enter'},1000)).code,'JUMP_DOOR');
  await jump.permit(true);let state=await enter(jump);
  const request={...batch(state,12),requestId:'batch-1'};const first=await jump.command('a',request,1000);assert.equal(first.ok,true);state=first.state;
  assert.equal(state.ackSeq,12);assert.equal(state.state.tick,Math.floor(1000/JUMP_RULES.stepMs)+12);
  assert.deepEqual((await jump.command('a',request,1000)).state.state,state.state,'duplicates never advance physics');
  assert.equal((await jump.command('a',batch(state,4),1000)).code,'JUMP_RATE');
  assert.equal((await jump.command('a',{...batch(state,1),frames:[frame(14)]},1100)).code,'JUMP_SEQUENCE');
  assert.equal((await jump.command('a',{...batch(state,1),runId:'stale'},1100)).code,'JUMP_RUN');
  for(const invalid of [{...frame(13),floor:60},{...frame(13),x:null},{...frame(13),seq:1.2},{...frame(13),jump:1}])assert.equal((await jump.command('a',{...batch(state,1),frames:[invalid]},1100)).code,'JUMP_INPUT');
  assert.equal((await jump.command('a',{...batch(state,1),position:{x:0,y:80,z:0}},1100)).code,'JUMP_INPUT');
  assert.equal((await jump.command('a',batch(state,13),1100)).code,'JUMP_INPUT');
  const mixed=await jump.command('a',{type:'jump-input',runId:state.runId,frames:[frame(11),frame(12),frame(13),frame(14)]},1100);assert.equal(mixed.ok,true);assert.equal(mixed.state.ackSeq,14);
  const packets=await jump.messages();assert.ok(packets.some((p:any)=>p.packet.requestId==='batch-1'&&p.packet.type==='jump-state'));
  // Reconnecting/retrying cannot replenish network credit repeatedly.
  await jump.disconnect('a',1100);await jump.connect('a','alpha',1100);state=await jump.state('a',1100);
  assert.equal((await jump.command('a',batch(state,1),1100)).code,'JUMP_RATE');
  const retried=await jump.command('a',{type:'jump-retry',runId:state.runId},1100);assert.equal(retried.state.ackSeq,0);assert.notEqual(retried.state.runId,state.runId);
  assert.equal((await jump.command('a',batch(retried.state,1),1100)).code,'JUMP_RATE');
 }finally{await mf.dispose();}
});

test('sixty floors and summit pay exactly 360 lifetime points, independent from board daily cap',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  const now=Date.UTC(2026,10,9);await jump.connect('a','alpha',now);await jump.seedDaily('a',500,now);await enter(jump,'a',now);
  let state:JumpSnapshot;
  for(let floor=1;floor<=60;floor++)state=await land(jump,'a',floor,now+floor*1000);
  assert.equal(state!.rewards.totalPoints,360);assert.equal(state!.rewards.earnedFloors.length,60);assert.equal(state!.rewards.summit,true);assert.equal(state!.profile.points,860);assert.equal(state!.profile.earnedToday,500);
  assert.equal((await jump.rewards()).length,60);
  const retry=await jump.command('a',{type:'jump-retry',runId:state!.runId},now+70000);assert.equal(retry.state.state.floor,0);assert.equal(retry.state.rewards.totalPoints,360);
  // A later calendar date and a restarted DO still cannot pay any floor again.
  await jump.restart();await jump.connect('a','alpha',now+86400000);
  for(let floor=1;floor<=60;floor++)state=await land(jump,'a',floor,now+86400000+floor*1000);
  assert.equal(state!.profile.points,860);assert.equal(state!.rewards.totalPoints,360);assert.equal((await jump.rewards()).length,60);
 }finally{await mf.dispose();}
});

test('a raw double jump from zero to two pays both crossed floors once across retries',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  let now=Date.UTC(2026,10,9),state=await enter(jump,'a',now);const points=state.profile.points;
  for(let attempt=0;attempt<2;attempt++){
   const planned=planSecondFloor(state),result=await sendFrames(jump,state,planned.frames,now);state=result.snapshot;now=result.now;
   assert.deepEqual(state.state,planned.state);assert.equal(state.state.floor,2);assert.deepEqual(state.rewards.earnedFloors,[1,2]);
   assert.equal(state.profile.points,points+2);assert.equal(state.rewards.totalPoints,2);assert.equal((await jump.rewards()).length,2);
   if(attempt===0){const retry=await jump.command('a',{type:'jump-retry',runId:state.runId},now);assert.equal(retry.ok,true);state=retry.state;assert.equal(state.state.floor,0);}
  }
 }finally{await mf.dispose();}
});

test('two crossed floor awards, profile and progress roll back atomically and retry without cache ghosts',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  const initial=await enter(jump),planned=planSecondFloor(initial),flight=await sendFrames(jump,initial,planned.frames.slice(0,-1),1000),before=flight.snapshot,now=flight.now+JUMP_RULES.stepMs;
  const request={type:'jump-input',runId:before.runId,frames:planned.frames.slice(-1)},profileBefore=before.profile.points;
  assert.equal(before.state.floor,0);assert.deepEqual(before.rewards.earnedFloors,[]);
  await jump.failNext();const failed=await jump.command('a',request,now);
  assert.equal(failed.ok,false);assert.match(failed.message,/injected/);assert.equal(failed.state.ackSeq,before.ackSeq);assert.deepEqual(failed.state.state,before.state);assert.equal(failed.state.profile.points,profileBefore);assert.equal((await jump.rewards()).length,0);
  const records=await jump.records();assert.equal(records[0].best_floor,0);assert.equal(JSON.parse(records[0].state_json).earnedFloors.length,0);
  const retried=await jump.command('a',request,now);assert.equal(retried.ok,true);assert.equal(retried.state.profile.points,profileBefore+2);assert.equal(retried.state.rewards.totalPoints,2);assert.deepEqual(retried.state.rewards.earnedFloors,[1,2]);assert.equal((await jump.rewards()).length,2);
  assert.deepEqual(retried.state.state,planned.state);
  assert.equal((await jump.command('a',request,now)).state.profile.points,profileBefore+2);
 }finally{await mf.dispose();}
});

test('network delay can release two legitimate input batches together without a resync rejection',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  let state=await enter(jump);
  for(let burst=1;burst<=10;burst++){
   const now=1000+burst*480;
   for(let packet=0;packet<2;packet++){
    const result=await jump.command('a',batch(state,12),now);assert.equal(result.ok,true,result.message);state=result.state;
   }
  }
  assert.equal(state.ackSeq,240);assert.equal(state.state.tick,50+240);
 }finally{await mf.dispose();}
});

test('server-authoritative spike, sweep and piston impacts keep position and predict physical knockback instead of respawning',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  for(const kind of ['spikes','sweep','pusher'] as const){
   const platform=JUMP_COURSE.find(candidate=>candidate.kind===kind)!;assert.ok(platform,`${kind} must be present in the course`);
   let tick=1000;while(!getJumpPlatformView(platform,tick+1).hazardActive||(kind==='pusher'&&getJumpPlatformView(platform,tick+1).pusherExtension<.5))tick++;
   const now=tick*JUMP_RULES.stepMs;await enter(jump,kind,now);
   const view=getJumpPlatformView(platform,tick+1),state={...createJumpState(Math.floor(platform.floor/10)*10,tick),floor:platform.floor,standingFloor:platform.floor,x:view.x,y:view.y,z:view.z,invulnerableUntil:0};
   if(kind==='pusher'){state.x=view.pusherX;state.z=view.pusherZ;}
   const prepared:JumpSnapshot=await jump.prepareState(kind,state,now),input=frame(prepared.ackSeq+1),predicted=stepJumpState(state,input);
   assert.equal(predicted.died,false);assert.equal(predicted.state.lastHitKind,kind,`${kind} fixture must genuinely contact the active hazard`);
   const result=await jump.command(kind,{type:'jump-input',runId:prepared.runId,frames:[input]},now+JUMP_RULES.stepMs);
   assert.equal(result.ok,true,result.message);assert.deepEqual(result.state.state,predicted.state);
   assert.equal(result.state.state.deaths,0);assert.equal(result.state.state.floor,platform.floor);assert.equal(result.state.state.x,state.x);assert.equal(result.state.state.z,state.z);
   assert.equal(result.state.state.grounded,false);assert.ok(Math.hypot(result.state.state.vx,result.state.state.vz)>3);assert.ok(result.state.state.vy>0);
   const nextInputs=Array.from({length:10},(_,i)=>({...frame(input.seq+i+1),x:predicted.state.vx===0?0:-Math.sign(predicted.state.vx),z:predicted.state.vz===0?0:-Math.sign(predicted.state.vz)}));
   let expected=predicted.state;for(const nextInput of nextInputs)expected=stepJumpState(expected,nextInput).state;
   const moved=await jump.command(kind,{type:'jump-input',runId:prepared.runId,frames:nextInputs},now+11*JUMP_RULES.stepMs);
   assert.equal(moved.ok,true,moved.message);assert.deepEqual(moved.state.state,expected);assert.equal(moved.state.state.deaths,0);
   assert.ok(Math.hypot(expected.x-state.x,expected.z-state.z)>.5,'counter-steering must not erase the impact immediately');
   assert.equal(moved.state.profile.points,prepared.profile.points,'getting hit is not a reward claim');
  }
 }finally{await mf.dispose();}
});

test('checkpoint resume, lifetime leaderboard tie ordering and admin close persist across restarts',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  for(const id of ['a','b','c','d'])await enter(jump,id,1000);
  await land(jump,'b',10,2000);await land(jump,'a',10,3000);await land(jump,'c',20,4000);await land(jump,'d',9,5000);
  let leaders=await jump.leaders();assert.deepEqual(leaders.map((r:any)=>r.nickname),['c','b','a']);assert.deepEqual(leaders.map((r:any)=>r.bestFloor),[20,10,10]);
  await land(jump,'a',11,6000);const old=await jump.state('a',6000);await jump.restart();const restored=await jump.state('a',7000);
  assert.equal(restored.active,true);assert.equal(restored.state.floor,10);assert.equal(restored.state.checkpoint,10);assert.notEqual(restored.runId,old.runId);assert.equal(restored.ackSeq,0);assert.deepEqual(restored.rewards,old.rewards);
  leaders=await jump.leaders();assert.deepEqual(leaders.map((r:any)=>r.nickname),['c','a','b']);assert.equal(leaders[1].reachedAt,6000);
  assert.equal((await jump.command('a',batch(old,1),7000)).code,'JUMP_RUN');
  await jump.close(8000);await jump.restart();for(const id of ['a','b','c','d'])assert.equal((await jump.state(id,9000)).active,false);
  assert.equal((await jump.leaders())[0].bestFloor,20);
 }finally{await mf.dispose();}
});
