import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJumpHarness} from './jump-game-harness.mjs';
import {findContact} from './jump-solver';
import {JUMP_COURSE,JUMP_HIT_KINDS,JUMP_RULES,createJumpStateOn,jumpFloorReward,jumpRewardToken,stepJumpState,type JumpInput,type JumpSnapshot} from '../shared/jump-game';
const frame=(seq:number)=>({seq,x:0,z:0,jump:false});
const batch=(state:JumpSnapshot,count=10)=>({type:'jump-input',runId:state.runId,frames:Array.from({length:count},(_,i)=>frame(state.ackSeq+i+1))});
async function enter(jump:any,id='a',now=1000){await jump.connect(id,id,now);const result=await jump.command(id,{type:'jump-enter'},now);assert.equal(result.ok,true,result.message);return result.state as JumpSnapshot;}
async function land(jump:any,id:string,floor:number,now:number){const state=await jump.prepareLanding(id,floor,now);const result=await jump.command(id,batch(state,1),now);assert.equal(result.ok,true,result.message);assert.equal(result.state.state.floor,floor);return result.state as JumpSnapshot;}
const FLOORS=JUMP_RULES.floors,MAX=JUMP_RULES.maxRewardPoints;

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

test('tower validates the room, raw input shape, sequence, replay and elapsed-time credit',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  assert.equal((await jump.command('stranger',{type:'jump-enter'},1000)).code,'NOT_JOINED');
  await jump.connect('a','alpha',1000);await jump.permit(false);
  const refused=await jump.command('a',{type:'jump-enter'},1000);
  assert.equal(refused.code,'JUMP_ROOM','a player who is not in a tower room cannot enter the tower');assert.equal(refused.state.active,false);assert.equal(refused.state.roomId,null);
  await jump.permit(true);let state=await enter(jump);assert.equal(state.roomId,'room-1');assert.equal(state.state.floor,0);
  const request={...batch(state,12),requestId:'batch-1'};const first=await jump.command('a',request,1000);assert.equal(first.ok,true);state=first.state;
  assert.equal(state.ackSeq,12);assert.equal(state.state.tick,Math.floor(1000/JUMP_RULES.stepMs)+12);
  assert.deepEqual((await jump.command('a',request,1000)).state.state,state.state,'duplicates never advance physics');
  assert.equal((await jump.command('a',batch(state,4),1000)).code,'JUMP_RATE');
  assert.equal((await jump.command('a',{...batch(state,1),frames:[frame(14)]},1100)).code,'JUMP_SEQUENCE');
  assert.equal((await jump.command('a',{...batch(state,1),runId:'stale'},1100)).code,'JUMP_RUN');
  for(const invalid of [{...frame(13),floor:FLOORS},{...frame(13),x:null},{...frame(13),seq:1.2},{...frame(13),jump:1},{...frame(13),y:90},{...frame(13),tick:5},{...frame(13),points:500}])assert.equal((await jump.command('a',{...batch(state,1),frames:[invalid]},1100)).code,'JUMP_INPUT');
  assert.equal((await jump.command('a',{...batch(state,1),position:{x:0,y:80,z:0}},1100)).code,'JUMP_INPUT');
  assert.equal((await jump.command('a',{...batch(state,1),roomId:'room-2'},1100)).code,'JUMP_INPUT','the room is never taken from the browser');
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

test('one hundred floors pay one point each and the summit 500 more: exactly 600 lifetime points, independent from the board daily cap',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  assert.equal(JUMP_RULES.floors,100);assert.equal(JUMP_RULES.summitReward,500);assert.equal(MAX,600);
  assert.equal(Array.from({length:FLOORS},(_,i)=>jumpFloorReward(i+1)).reduce((sum,value)=>sum+value,0),MAX);
  assert.equal(jumpFloorReward(FLOORS),501);assert.equal(jumpFloorReward(60),1);assert.equal(jumpFloorReward(0),0);assert.equal(jumpFloorReward(101),0);
  const now=Date.UTC(2026,10,9);await jump.connect('a','alpha',now);await jump.seedDaily('a',500,now);await enter(jump,'a',now);
  let state:JumpSnapshot;
  for(let floor=1;floor<=FLOORS;floor++){
   state=await land(jump,'a',floor,now+floor*1000);
   assert.equal(state.rewards.totalPoints,floor===FLOORS?MAX:floor,`floor ${floor}`);assert.equal(state.profile.points,500+(floor===FLOORS?MAX:floor));
  }
  assert.equal(state!.rewards.earnedFloors.length,FLOORS);assert.equal(state!.rewards.summit,true);assert.equal(state!.rewards.maxPoints,MAX);assert.equal(state!.rewards.legacyBonus,0);
  assert.equal(state!.state.status,'complete');assert.equal(state!.profile.earnedToday,500);
  const rows=await jump.rewards();assert.equal(rows.length,FLOORS);assert.equal(rows.find((row:any)=>row.match_id===jumpRewardToken(FLOORS)).amount,501);
  const retry=await jump.command('a',{type:'jump-retry',runId:state!.runId},now+200000);assert.equal(retry.state.state.floor,0);assert.equal(retry.state.state.status,'playing');assert.equal(retry.state.rewards.totalPoints,MAX);
  // A later calendar date and a restarted DO still cannot pay any floor again.
  await jump.restart();await jump.connect('a','alpha',now+86400000);await jump.command('a',{type:'jump-enter'},now+86400000);
  for(let floor=1;floor<=FLOORS;floor++)state=await land(jump,'a',floor,now+86400000+floor*1000);
  assert.equal(state!.profile.points,500+MAX);assert.equal(state!.rewards.totalPoints,MAX);assert.equal((await jump.rewards()).length,FLOORS);
 }finally{await mf.dispose();}
});

test('the reward ledger accepts only real floors at their own price and never pays one twice',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  await jump.connect('a','alpha',1000);
  const rejected=[
   [{token:'jump-v1:floor:0',amount:1}],[{token:`jump-v1:floor:${FLOORS+1}`,amount:1}],[{token:'jump-v1:floor:101',amount:501}],[{token:'jump-v1:floor:1000',amount:1}],
   [{token:'jump-v1:floor:01',amount:1}],[{token:'jump-v1:floor:-1',amount:1}],[{token:'jump-v1:floor:1.5',amount:1}],[{token:'jump-v1:floor:',amount:1}],[{token:'jump-v2:floor:1',amount:1}],[{token:'jump-v1:floor:1 ',amount:1}],
   [{token:jumpRewardToken(5),amount:2}],[{token:jumpRewardToken(5),amount:0}],[{token:jumpRewardToken(5),amount:-1}],[{token:jumpRewardToken(60),amount:301}],[{token:jumpRewardToken(FLOORS),amount:1}],[{token:jumpRewardToken(FLOORS),amount:500}],[{token:jumpRewardToken(FLOORS),amount:1001}],
   [{token:jumpRewardToken(7),amount:1},{token:jumpRewardToken(7),amount:1}],
   [...Array.from({length:FLOORS},(_,i)=>({token:jumpRewardToken(i+1),amount:jumpFloorReward(i+1)})),{token:'jump-v1:floor:1',amount:1}],
   [{token:jumpRewardToken(3),amount:1},{token:'jump-v1:floor:999',amount:1}],
  ];
  for(const awards of rejected){const result=await jump.award('a',awards,2000);assert.equal(result.ok,false,JSON.stringify(awards).slice(0,80));assert.equal(result.code,'JUMP_REWARD');assert.equal(result.points,0);}
  assert.equal((await jump.rewards()).length,0,'a rejected batch pays nothing, not even its valid entries');
  const summit=[{token:jumpRewardToken(FLOORS),amount:501},{token:jumpRewardToken(1),amount:1}];
  assert.deepEqual({...await jump.award('a',summit,3000)},{ok:true,paid:502,points:502});
  assert.deepEqual({...await jump.award('a',summit,4000)},{ok:true,paid:0,points:502});
  assert.deepEqual({...await jump.award('a',[{token:jumpRewardToken(1),amount:1},{token:jumpRewardToken(2),amount:1}],5000)},{ok:true,paid:1,points:503});
  assert.deepEqual({...await jump.award('b',[{token:jumpRewardToken(1),amount:1}],5000)},{ok:true,paid:1,points:1},'the ledger is per character');
  assert.equal((await jump.rewards()).length,4);
 }finally{await mf.dispose();}
});

test('a raw double jump from zero to two pays both crossed floors once across retries',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  let now=Date.UTC(2026,10,9),state=await enter(jump,'a',now);const points=state.profile.points;
  for(let attempt=0;attempt<2;attempt++){
   const planned=planSecondFloor(state),result=await sendFrames(jump,state,planned.frames,now);state=result.snapshot;now=result.now;
   assert.deepEqual(state.state,planned.state);assert.equal(state.state.floor,2);assert.deepEqual(state.rewards.earnedFloors,[1,2]);
   assert.equal(state.profile.points,points+2);assert.equal(state.rewards.totalPoints,2);assert.equal((await jump.rewards()).length,2);
   if(attempt===0){const retry=await jump.command('a',{type:'jump-retry',runId:state.runId},now);assert.equal(retry.ok,true);state=retry.state;assert.equal(state.state.floor,0);assert.equal(state.state.deaths,1);}
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

test('every trap impact is server-authoritative: it keeps position, throws the player and never resets or pays',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  for(const kind of JUMP_HIT_KINDS){
   const {platform,state,after:predicted}=findContact(kind),now=state.tick*JUMP_RULES.stepMs;await enter(jump,kind,now);
   const prepared:JumpSnapshot=await jump.prepareState(kind,state,now),input=frame(prepared.ackSeq+1);
   assert.deepEqual(stepJumpState(state,input).state,predicted);
   const result=await jump.command(kind,{type:'jump-input',runId:prepared.runId,frames:[input]},now+JUMP_RULES.stepMs);
   assert.equal(result.ok,true,result.message);assert.deepEqual(result.state.state,predicted,`${kind}: browser prediction and authority agree`);
   assert.equal(result.state.state.lastHitKind,kind);assert.equal(result.state.state.deaths,0);assert.equal(result.state.state.floor,platform.floor);assert.equal(result.state.state.x,state.x);assert.equal(result.state.state.z,state.z);
   assert.equal(result.state.state.grounded,false);assert.ok(Math.hypot(result.state.state.vx,result.state.state.vz)>3);assert.ok(result.state.state.vy>0);
   const nextInputs=Array.from({length:10},(_,i)=>({...frame(input.seq+i+1),x:predicted.vx===0?0:-Math.sign(predicted.vx),z:predicted.vz===0?0:-Math.sign(predicted.vz)}));
   let expected=predicted;for(const nextInput of nextInputs)expected=stepJumpState(expected,nextInput).state;
   const moved=await jump.command(kind,{type:'jump-input',runId:prepared.runId,frames:nextInputs},now+11*JUMP_RULES.stepMs);
   assert.equal(moved.ok,true,moved.message);assert.deepEqual(moved.state.state,expected);assert.equal(moved.state.state.deaths,0);
   assert.ok(Math.hypot(expected.x-state.x,expected.z-state.z)>.5,'counter-steering must not erase the impact immediately');
   assert.equal(moved.state.profile.points,prepared.profile.points,'getting hit is not a reward claim');
  }
 }finally{await mf.dispose();}
});

test('there are no checkpoints: a fall, a retry and a new visit all start on the ground pad',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  await enter(jump,'a',1000);let state=await land(jump,'a',34,2000);
  assert.equal(state.state.floor,34);assert.equal('checkpoint' in state.state,false);
  // Falling far below the pad last stood on, inside the course, restarts the run.
  const pad=JUMP_COURSE[34]!,falling={...state.state,x:pad.x+pad.width,z:pad.z+pad.depth,y:pad.y-JUMP_RULES.fallDepth+.05,vy:-9,grounded:false,standingFloor:null};
  let prepared:JumpSnapshot=await jump.prepareState('a',falling,3000);
  const fallen=await jump.command('a',batch(prepared,1),3000);
  assert.equal(fallen.ok,true,fallen.message);assert.equal(fallen.state.state.floor,0);assert.equal(fallen.state.state.standingFloor,0);assert.equal(fallen.state.state.lastFloor,0);assert.equal(fallen.state.state.y,0);assert.equal(fallen.state.state.deaths,1);
  assert.equal(fallen.state.rewards.earnedFloors.length,34,'rewards already paid stay paid');assert.equal(JSON.parse((await jump.records())[0].state_json).state.floor,0,'the reset is durable');
  state=await land(jump,'a',52,4000);
  const retry=await jump.command('a',{type:'jump-retry',runId:state.runId},5000);assert.equal(retry.state.state.floor,0);assert.equal(retry.state.state.y,0);assert.equal(retry.state.state.deaths,state.state.deaths+1);
  state=await land(jump,'a',70,6000);
  const exit=await jump.command('a',{type:'jump-exit',runId:state.runId},7000);assert.equal(exit.state.active,false);assert.equal(exit.state.roomId,null);
  const again=await jump.command('a',{type:'jump-enter'},8000);
  assert.equal(again.state.active,true);assert.equal(again.state.state.floor,0);assert.equal(again.state.state.standingFloor,0);assert.notEqual(again.state.runId,state.runId);
  assert.equal(again.state.rewards.earnedFloors.length,70);assert.equal((await jump.leaders())[0].bestFloor,70);
 }finally{await mf.dispose();}
});

test('a server restart is not a checkpoint: the saved state, in the air or not, is played forward',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  for(const id of ['a','b','c','d'])await enter(jump,id,1000);
  await land(jump,'b',10,2000);await land(jump,'a',10,3000);await land(jump,'c',20,4000);await land(jump,'d',9,5000);
  let leaders=await jump.leaders();assert.deepEqual(leaders.map((r:any)=>r.nickname),['c','b','a']);assert.deepEqual(leaders.map((r:any)=>r.bestFloor),[20,10,10]);
  await land(jump,'a',11,6000);const old=await jump.state('a',6000);
  // b leaves the browser in the middle of a fall beside the pad: that position is what gets saved.
  const air=await jump.state('b',6000);await jump.prepareState('b',{...air.state,x:air.state.x+12,y:air.state.y+1.5,vy:-3,grounded:false,standingFloor:null},6000);await jump.disconnect('b',6000);
  await jump.restart();
  // a was standing on a plain pad: the same spot a second later, under a new run id.
  const restored=(await jump.command('a',{type:'jump-sync'},7000)).state;
  assert.equal(restored.active,true);assert.equal(restored.roomId,'room-1');assert.equal(restored.state.floor,11);assert.equal(restored.state.standingFloor,11);assert.equal(restored.state.y,JUMP_COURSE[11]!.y);
  assert.equal(restored.state.x,old.state.x);assert.equal(restored.state.z,old.state.z);
  assert.equal(restored.state.tick,Math.floor(7000/JUMP_RULES.stepMs));assert.notEqual(restored.runId,old.runId);assert.equal(restored.ackSeq,0);assert.deepEqual(restored.rewards,old.rewards);
  // b comes back: the fall went on while nobody was watching.
  await jump.connect('b','b',9000);const dropped=await jump.state('b',9000);
  assert.equal(dropped.active,true);assert.equal(dropped.state.floor,0);assert.equal(dropped.state.standingFloor,0);assert.equal(dropped.state.deaths,air.state.deaths+1);assert.equal(dropped.rewards.earnedFloors.length,10);
  leaders=await jump.leaders();assert.deepEqual(leaders.map((r:any)=>r.nickname),['c','a','b']);assert.equal(leaders[1].reachedAt,6000);
  assert.equal((await jump.command('a',batch(old,1),7000)).code,'JUMP_RUN');
  await jump.close(10000);await jump.restart();for(const id of ['a','b','c','d'])assert.equal((await jump.state(id,11000)).active,false);
  assert.equal((await jump.leaders())[0].bestFloor,20);
 }finally{await mf.dispose();}
});

/** Runs off the pad the climber stands on until they are in the air beside it, as a browser would: input only. */
async function stepOff(jump:any,id:string,snapshot:JumpSnapshot,now:number){
 const pad=JUMP_COURSE[snapshot.state.standingFloor!]!,x=pad.x>=0?1:-1;let state=snapshot;
 for(let i=0;i<30&&state.state.grounded;i++){
  now+=100;const result=await jump.command(id,{type:'jump-input',runId:state.runId,frames:Array.from({length:5},(_,k)=>({seq:state.ackSeq+k+1,x,z:0,jump:false}))},now);
  assert.equal(result.ok,true,result.message);state=result.state;
 }
 assert.equal(state.state.grounded,false);assert.equal(state.state.deaths,snapshot.state.deaths,'still falling, not yet reset');
 return{state,now};
}

test('the tower never pauses: a climber who stops sending input in mid-air has fallen when they come back',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  await enter(jump,'a',1000);const top=await land(jump,'a',38,2000);
  const {state:falling,now}=await stepOff(jump,'a',top,2000);
  assert.ok(falling.state.y>JUMP_COURSE[38]!.y-JUMP_RULES.fallDepth);
  // The pause menu: nothing is sent for ten seconds, then the browser asks for the current state.
  const resumed=(await jump.command('a',{type:'jump-sync'},now+10000)).state;
  assert.equal(resumed.state.deaths,falling.state.deaths+1,'the fall was not suspended');assert.equal(resumed.state.floor,0);assert.equal(resumed.state.standingFloor,0);
  assert.equal(resumed.state.tick,Math.floor((now+10000)/JUMP_RULES.stepMs));assert.equal(resumed.runId,falling.runId);
  assert.equal(resumed.rewards.earnedFloors.length,38,'paid floors stay paid');

  // Withholding frames while a trap is up does not dodge it either: the gap is played with no input.
  await enter(jump,'b',1000);
  const {state:before}=findContact('spikes');
  const tick=before.tick-60,at=tick*JUMP_RULES.stepMs;
  await jump.prepareState('b',{...before,tick,invulnerableUntil:0},at);
  const later=(await jump.command('b',{type:'jump-sync'},(before.tick+3)*JUMP_RULES.stepMs)).state;
  assert.equal(later.state.lastHitKind,'spikes','standing in the strip when the spikes come up is a hit, input or not');assert.equal(later.state.lastHitTick,before.tick+1);assert.equal(later.state.grounded,false);

  // A late batch after a stall is not an escape: only the stored credit (one second) is forgiven.
  await enter(jump,'c',1000);const high=await land(jump,'c',38,2000);
  const stalled=await stepOff(jump,'c',high,2000);
  const late=await jump.command('c',{type:'jump-input',runId:stalled.state.runId,frames:[{seq:stalled.state.ackSeq+1,x:0,z:0,jump:true}]},stalled.now+5000);
  assert.equal(late.ok,true,late.message);assert.equal(late.state.state.deaths,stalled.state.state.deaths+1);assert.equal(late.state.state.floor,0);

  // A rest pad is the place to stop: ten idle minutes change nothing but the clock.
  await enter(jump,'d',1000);const rest=await land(jump,'d',30,2000);
  const waited=(await jump.command('d',{type:'jump-sync'},2000+600000)).state;
  assert.equal(waited.state.standingFloor,30);assert.equal(waited.state.x,rest.state.x);assert.equal(waited.state.z,rest.state.z);assert.equal(waited.state.y,rest.state.y);assert.equal(waited.state.lastHitTick,-1);
  assert.equal(waited.state.tick,Math.floor(602000/JUMP_RULES.stepMs));
  // A floor reached while nobody was sending input (carried over the edge of a pad in flight) is still paid once.
  await enter(jump,'e',1000);const flying=await jump.prepareLanding('e',5,3000);
  const settled=(await jump.command('e',{type:'jump-sync'},3500)).state;
  assert.equal(settled.state.floor,5);assert.deepEqual(settled.rewards.earnedFloors,[1,2,3,4,5]);assert.equal(settled.profile.points,5);assert.equal(flying.state.grounded,false);
  assert.equal((await jump.rewards()).filter((row:any)=>row.player_id==='e').length,5);
 }finally{await mf.dispose();}
});

test('a sleeping server is not a checkpoint: the fall of a climber who went quiet is on disk before it can sleep',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  await enter(jump,'a',1000);const top=await land(jump,'a',38,2000);
  const stored=async()=>JSON.parse((await jump.records()).find((row:any)=>row.id==='a').state_json).state;
  assert.equal((await stored()).standingFloor,38,'a landing is saved at once');
  const {state:falling,now}=await stepOff(jump,'a',top,2000);
  assert.equal((await stored()).standingFloor,38,'movement between landings is not written on every batch');
  assert.equal(await jump.flush(now+200),true,'still moving a moment ago: nothing to write yet');
  assert.equal((await stored()).standingFloor,38);
  // One second without input: the exact falling state goes to disk and nothing is left to flush.
  assert.equal(await jump.flush(now+1000),false);
  assert.deepEqual(await stored(),falling.state);
  // The object is evicted while the socket stays open (hibernation), then the climber resumes.
  await jump.restart();
  const woke=await jump.state('a',now+60000);
  assert.equal(woke.active,true);assert.deepEqual(woke.state,falling.state,'the cold restore is the saved state, not a pad');assert.notEqual(woke.runId,falling.runId);
  const resumed=(await jump.command('a',{type:'jump-sync'},now+60000)).state;
  assert.equal(resumed.state.deaths,falling.state.deaths+1);assert.equal(resumed.state.floor,0);assert.equal(resumed.state.standingFloor,0);
  // A setback landing is saved too, so a restart cannot lift anyone back to a pad they fell from.
  const low=await land(jump,'a',20,now+70000);await jump.prepareLanding('a',20,now+71000);
  const lower={...createJumpStateOn(12,Math.floor((now+72000)/JUMP_RULES.stepMs)),floor:20,y:JUMP_COURSE[12]!.y+.3,vy:-1,grounded:false,standingFloor:null,lastFloor:20,fallFrom:JUMP_COURSE[12]!.y+3,invulnerableUntil:0};
  await jump.prepareState('a',lower,now+72000);
  const setback=await jump.command('a',batch(await jump.state('a',now+72000),10),now+72200);assert.equal(setback.ok,true,setback.message);
  assert.equal(setback.state.state.standingFloor,12);assert.equal(setback.state.state.floor,20);assert.equal((await stored()).standingFloor,12);assert.equal(low.state.floor,20);
  // A record whose saved position is not a well-formed state starts on the ground instead of being trusted.
  for(const [id,patch] of [['x1',{x:1e9}],['x2',{y:'high'}],['x3',{standingFloor:400,floor:400,lastFloor:400}],['x4',{grounded:true,standingFloor:null}],['x5',{crumbleAt:{later:1}}],['x6',{tick:-5}],['x7',{floor:3,lastFloor:9}]] as const){
   await jump.seedRun(id,id,12,5,true,JSON.stringify({version:2,active:true,roomId:'room-1',state:{...createJumpStateOn(12,100),...patch},earnedFloors:[1,2,3],summit:false,legacyBonus:0,legacyBest:0,bestFloor:12,sessionBest:12,reachedAt:5,nickname:id}));
   await jump.connect(id,id,9000);const back:JumpSnapshot=await jump.state(id,9000);
   assert.equal(back.active,true,id);assert.equal(back.state.floor,0,id);assert.equal(back.state.standingFloor,0,id);assert.equal(back.state.y,0,id);assert.deepEqual(back.rewards.earnedFloors,[1,2,3]);
  }
 }finally{await mf.dispose();}
});

test('rooms: presence scope, live ranking and membership follow the lobby room, on one shared arena clock',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  await jump.setRoom('c','room-2');await jump.setRoom('d',null);
  const a=await enter(jump,'a',1000),b=await enter(jump,'b',1000),c=await enter(jump,'c',1000);
  await jump.connect('d','d',1000);assert.equal((await jump.command('d',{type:'jump-enter'},1000)).code,'JUMP_ROOM');
  assert.deepEqual([a.roomId,b.roomId,c.roomId],['room-1','room-1','room-2']);
  assert.deepEqual([await jump.roomOf('a'),await jump.roomOf('c'),await jump.roomOf('d')],['room-1','room-2',null]);
  assert.equal(a.state.tick,c.state.tick,'every room runs on the same arena tick');assert.deepEqual(a.state,c.state);
  await land(jump,'a',7,2000);await land(jump,'b',12,3000);await land(jump,'c',30,4000);
  assert.deepEqual(await jump.ranking('room-1'),[{id:'b',nickname:'b',floor:12,bestFloor:12},{id:'a',nickname:'a',floor:7,bestFloor:7}]);
  assert.deepEqual(await jump.ranking('room-2'),[{id:'c',nickname:'c',floor:30,bestFloor:30}],'another room never appears in the ranking');
  assert.deepEqual(await jump.ranking('room-3'),[]);
  // A setback lowers the current floor, not the best floor of the visit.
  const low=createJumpStateOn(9,Math.floor(5000/JUMP_RULES.stepMs));await jump.prepareState('b',{...low,floor:12},5000);
  assert.deepEqual((await jump.ranking('room-1'))[0],{id:'b',nickname:'b',floor:9,bestFloor:12});
  assert.equal((await jump.peer('b',5000)).floor,9,'peers see where a climber stands');assert.equal(await jump.peer('d',5000),null);
  // The global leaderboard stays global.
  assert.deepEqual((await jump.leaders()).map((row:any)=>row.bestFloor),[30,12,7]);
  // Leaving the lobby room ends the climb; rewards and the best floor stay.
  await jump.clearMessages();await jump.setRoom('b',null);await jump.syncRooms(6000);
  const gone=await jump.state('b',6000);assert.equal(gone.active,false);assert.equal(gone.roomId,null);assert.equal(gone.rewards.earnedFloors.length,12);
  assert.ok((await jump.messages()).some((p:any)=>p.id==='b'&&p.packet.type==='jump-state'&&p.packet.state.active===false),'the evicted climber is told');
  assert.deepEqual((await jump.ranking('room-1')).map((row:any)=>row.id),['a']);assert.equal((await jump.state('a',6000)).active,true);
  assert.equal((await jump.command('b',batch(gone,1),6000)).code,'JUMP_INACTIVE');
  // Moving to another room starts a new visit there: ground pad, fresh session best.
  await jump.setRoom('a','room-2');await jump.syncRooms(7000);assert.equal((await jump.state('a',7000)).active,false);
  const moved=await jump.command('a',{type:'jump-enter'},7000);assert.equal(moved.state.roomId,'room-2');assert.equal(moved.state.state.floor,0);
  assert.deepEqual((await jump.ranking('room-2')).map((row:any)=>[row.id,row.bestFloor]),[['c',30],['a',0]]);
  // Disconnected members drop out of the live ranking; a room that vanished during a restart closes the run.
  await jump.disconnect('c',8000);assert.deepEqual((await jump.ranking('room-2')).map((row:any)=>row.id),['a']);
  await jump.setRoom('c',null);await jump.restart();await jump.connect('c','c',9000);assert.equal((await jump.state('c',9000)).active,false);
 }finally{await mf.dispose();}
});

test('progress from the sixty-floor tower loads: paid floors stay, checkpoints, positions and old ranks do not',async()=>{
 const {mf,jump}=await createJumpHarness();try{
  const now=Date.UTC(2026,10,10);
  const legacyState=(floor:number,checkpoint:number)=>({x:3.1,y:55.2,z:-1.4,vx:1,vy:-2,vz:0,tick:999,grounded:false,jumps:1,jumpHeld:false,lastJumpTick:990,standingFloor:null,floor,checkpoint,deaths:4,status:'playing',crumbleAt:{'5':900},invulnerableUntil:0,lastHitTick:-1,lastHitKind:null,knockbackUntil:0});
  const range=(count:number)=>Array.from({length:count},(_,i)=>i+1);
  // A climber who was in the tower at floor 45 with a floor-40 checkpoint.
  await jump.seedRewards('mid',range(45).map(floor=>[jumpRewardToken(floor),1]),now-5000);
  await jump.seedRun('mid','mid',45,now-5000,true,JSON.stringify({version:1,active:true,state:legacyState(45,40),earnedFloors:range(45),summit:false,bestFloor:45,reachedAt:now-5000,nickname:'mid'}));
  // A climber who finished the old tower and was paid its 300 point summit bonus on floor 60.
  await jump.seedRewards('top',range(60).map(floor=>[jumpRewardToken(floor),floor===60?301:1]),now-9000);
  await jump.seedRun('top','top',60,now-9000,false,JSON.stringify({version:1,active:false,state:{...legacyState(60,60),status:'complete'},earnedFloors:range(60),summit:true,bestFloor:60,reachedAt:now-9000,nickname:'top'}));
  // Damaged or foreign records are empty records, never an error.
  await jump.seedRun('odd','odd',17,now-1000,true,'{"version":1,"state":null,"earnedFloors":[3,"x",3,400,-2,2.5],"bestFloor":"many"}');
  await jump.seedRun('nil','nil',0,0,false,'null');
  await jump.seedRun('bad','bad',0,0,true,'{"version":2,"active":true,"roomId":"room-1","state":{"grounded":true,"standingFloor":4');

  // The board compares climbs of the hundred-floor tower only; the old best floor is kept in the record, not ranked.
  assert.deepEqual(await jump.leaders(),[],'best floors of the sixty-floor tower do not rank');
  assert.deepEqual((await jump.records()).map((row:any)=>row.best_floor),[0,0,0,0,0]);
  await jump.connect('mid','mid',now);let mid:JumpSnapshot=await jump.state('mid',now);
  assert.equal(mid.active,false,'an old open run is closed: there is no room for it');assert.equal(mid.state.floor,0);assert.equal(mid.state.standingFloor,0);assert.equal(mid.state.y,0);assert.equal('checkpoint' in mid.state,false);
  assert.equal(mid.rewards.earnedFloors.length,45);assert.equal(mid.rewards.totalPoints,45);assert.equal(mid.rewards.summit,false);assert.equal(mid.rewards.legacyBonus,0);assert.equal(mid.rewards.maxPoints,MAX);assert.equal(mid.profile.points,45);
  mid=(await jump.command('mid',{type:'jump-enter'},now)).state;assert.equal(mid.active,true);assert.equal(mid.state.floor,0);
  for(const floor of [1,30,45])mid=await land(jump,'mid',floor,now+floor*1000);
  assert.equal(mid.profile.points,45,'floors paid in the old tower are never paid twice');
  mid=await land(jump,'mid',46,now+50000);assert.equal(mid.profile.points,46);mid=await land(jump,'mid',61,now+70000);assert.equal(mid.profile.points,61);assert.equal(mid.rewards.earnedFloors.length,61);
  assert.deepEqual((await jump.leaders()).map((row:any)=>[row.nickname,row.bestFloor]),[['mid',61]]);
  const kept=JSON.parse((await jump.records()).find((row:any)=>row.id==='mid').state_json);assert.equal(kept.legacyBest,45,'the old best floor is still on record');assert.equal(kept.bestFloor,61);

  await jump.connect('top','top',now);let top:JumpSnapshot=(await jump.command('top',{type:'jump-enter'},now)).state;
  assert.equal(top.state.floor,0);assert.equal(top.state.status,'playing');assert.equal(top.rewards.summit,false,'the old summit is not the new summit');
  assert.equal(top.rewards.legacyBonus,300);assert.equal(top.rewards.totalPoints,360);assert.equal(top.rewards.maxPoints,MAX+300);assert.equal(top.profile.points,360,'the old summit bonus is kept');
  top=await land(jump,'top',60,now+1000);assert.equal(top.profile.points,360);assert.equal(top.state.status,'playing');
  top=await land(jump,'top',FLOORS,now+2000);assert.equal(top.state.status,'complete');assert.equal(top.rewards.summit,true);
  assert.equal(top.profile.points,360+40+500);assert.equal(top.rewards.totalPoints,MAX+300);assert.equal(top.rewards.earnedFloors.length,FLOORS);
  await jump.restart();await jump.connect('top','top',now+3000);top=await jump.state('top',now+3000);
  assert.equal(top.rewards.legacyBonus,300,'the kept bonus survives being saved in the new format');assert.equal(top.rewards.totalPoints,MAX+300);
  assert.deepEqual((await jump.leaders()).map((row:any)=>[row.nickname,row.bestFloor]),[['top',FLOORS],['mid',61]],'new climbs rank, and a restart does not wipe them');

  for(const id of ['odd','nil','bad']){
   await jump.connect(id,id,now);const state:JumpSnapshot=await jump.state(id,now);
   assert.equal(state.active,false);assert.equal(state.state.floor,0);assert.equal(state.rewards.totalPoints,id==='odd'?1:0);assert.deepEqual(state.rewards.earnedFloors,id==='odd'?[3]:[]);
   const entered=await jump.command(id,{type:'jump-enter'},now);assert.equal(entered.ok,true,entered.message);
   assert.equal((await land(jump,id,2,now+1000)).state.floor,2);
  }
 }finally{await mf.dispose();}
});

test('an in-flight state of the old course never crashes the simulation: it falls and restarts on the ground pad',()=>{
 const old={x:2.9,y:60.4,z:1.7,vx:0,vy:0,vz:0,tick:5000,grounded:true,jumps:0,jumpHeld:false,lastJumpTick:4000,standingFloor:47,floor:47,checkpoint:40,deaths:2,status:'playing',crumbleAt:{},invulnerableUntil:0} as never;
 let state=old as import('../shared/jump-game').JumpState,died=false,ticks=0;
 while(!died&&ticks<400){const result=stepJumpState(state,{seq:++ticks,x:0,z:0,jump:false});state=result.state;died=result.died;for(const value of [state.x,state.y,state.z,state.fallFrom])assert.ok(Number.isFinite(value));}
 assert.equal(died,true);assert.equal(state.floor,0);assert.equal(state.standingFloor,0);assert.equal(state.y,0);assert.equal(state.deaths,3);assert.equal(state.lastHitKind,null);
 for(const broken of [{...old as object,floor:900,standingFloor:900},{...old as object,x:NaN},{...old as object,standingFloor:-3,lastFloor:'x'},{tick:1,x:0,y:0,z:0,vx:0,vy:0,vz:0,status:'playing'}]){
  let current=broken as never as import('../shared/jump-game').JumpState;
  assert.doesNotThrow(()=>{for(let i=0;i<60;i++)current=stepJumpState(current,{seq:i,x:1,z:1,jump:i%7===0}).state;});
  assert.ok(current.floor>=0&&current.floor<=FLOORS);
 }
});
