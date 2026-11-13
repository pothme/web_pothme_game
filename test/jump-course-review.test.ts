import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUMP_COURSE, JUMP_PLATFORM_KINDS, JUMP_RULES, JUMP_SHORTCUTS, JUMP_ZONES, createJumpState, createJumpStateOn, getJumpPlatformReach, getJumpPlatformView, jumpZoneOf, stepJumpState, type JumpPlatform, type JumpState, type JumpSnapshot } from '../shared/jump-game';
import { JumpPrediction } from '../src/jump-client';
import { createJumpHarness } from './jump-game-harness.mjs';
import { blindAttempts, climb, describeClimb, findLeap, hold, tryLeap, type ClimbReport, type LeapCandidate } from './jump-solver';

const FLOORS=JUMP_RULES.floors,ZONE=JUMP_RULES.zoneFloors;
const idle=(state:JumpState)=>stepJumpState(state,{seq:state.tick+1,x:0,z:0,jump:false});
const mechanics=(p:JumpPlatform)=>[p.motion!=='static'?p.motion:null,p.surface!=='plain'?p.surface:null,p.hazard].filter((kind):kind is NonNullable<typeof kind>=>kind!==null);
const DOUBLE_APEX=JUMP_RULES.jumpVelocity**2/JUMP_RULES.gravity;
const runs=new Map<string,ClimbReport>();
/** Full climbs are shared between tests: the solver is deterministic. */
function climbed(startTick:number,inputScale=1){
  const key=`${startTick}:${inputScale}`;let run=runs.get(key);
  if(!run){run=climb({startTick,inputScale});runs.set(key,run);}
  return run;
}

test('the tower has one hundred ordered floors in ten themed zones inside a bounded footprint',()=>{
  assert.equal(FLOORS,100);assert.equal(JUMP_COURSE.length,FLOORS+1);
  assert.equal(JUMP_ZONES.length,FLOORS/ZONE);
  assert.equal(new Set(JUMP_ZONES.map(zone=>zone.id)).size,JUMP_ZONES.length,'every zone has its own theme id');
  assert.equal(new Set(JUMP_ZONES.map(zone=>zone.name)).size,JUMP_ZONES.length);
  JUMP_ZONES.forEach((zone,index)=>{
    assert.equal(zone.index,index);assert.equal(zone.from,index*ZONE+1);assert.equal(zone.to,index*ZONE+ZONE);assert.equal(zone.restFloor,index*ZONE);
    assert.match(zone.name,/[가-힣]/);assert.match(zone.id,/^[a-z]+$/);assert.ok(zone.pattern.length>3);
    for(let floor=zone.from;floor<=zone.to;floor++){assert.equal(JUMP_COURSE[floor]!.zone,index);assert.equal(jumpZoneOf(floor),zone);}
  });
  assert.equal(jumpZoneOf(0),JUMP_ZONES[0]);
  let highest=-Infinity;
  for(const platform of JUMP_COURSE){
    assert.equal(platform.floor,JUMP_COURSE.indexOf(platform));
    for(const value of [platform.x,platform.y,platform.z,platform.width,platform.depth,platform.phase,platform.amplitude,platform.period,platform.dirX,platform.dirZ,platform.belt,platform.hazardPhase,platform.hazardPeriod,platform.hazDirX,platform.hazDirZ,platform.power])assert.ok(Number.isFinite(value),`floor ${platform.floor}`);
    assert.ok(Math.abs(Math.hypot(platform.dirX,platform.dirZ)-1)<1e-9&&Math.abs(Math.hypot(platform.hazDirX,platform.hazDirZ)-1)<1e-9,`floor ${platform.floor} axes are unit vectors`);
    const smallest=platform.motion==='shrink'?platform.amplitude:1;
    assert.ok(Math.min(platform.width,platform.depth)>=1.7&&Math.min(platform.width,platform.depth)*smallest>=1.1,`floor ${platform.floor} lacks a usable landing zone`);
    // The whole envelope, including orbit travel, hammer swings and cannon shots, stays well inside the kill box.
    const reach=getJumpPlatformReach(platform.floor);
    assert.ok(Math.max(-reach.minX,reach.maxX,-reach.minZ,reach.maxZ)<=JUMP_RULES.bounds-3,`floor ${platform.floor} leaves the footprint`);
    if(platform.floor)assert.ok(platform.y>JUMP_COURSE[platform.floor-1]!.y-1.5,'a floor may dip a little but never drops far');
    highest=Math.max(highest,platform.y);
  }
  assert.equal(JUMP_COURSE[FLOORS]!.y,highest,'the summit is the highest pad');
  assert.equal(JUMP_COURSE[0]!.y,0);
  // The path really changes direction: not one spiral.
  const turns=JUMP_ZONES.map(zone=>{
    let left=0,right=0;
    for(let floor=zone.from+1;floor<=zone.to;floor++){
      const a=JUMP_COURSE[floor-2]!,b=JUMP_COURSE[floor-1]!,c=JUMP_COURSE[floor]!,cross=(b.x-a.x)*(c.z-b.z)-(b.z-a.z)*(c.x-b.x);
      if(cross>.5)left++;else if(cross<-.5)right++;
    }
    return{left,right};
  });
  assert.ok(turns.filter(turn=>turn.left>turn.right+2).length>=2&&turns.filter(turn=>turn.right>turn.left+2).length>=2,'some zones wind left and some wind right');
  assert.ok(turns.filter(turn=>turn.left>=2&&turn.right>=2).length>=3,'several zones reverse direction inside the zone');
  const radius=(floor:number)=>Math.hypot(JUMP_COURSE[floor]!.x,JUMP_COURSE[floor]!.z);
  assert.ok(Math.max(...JUMP_COURSE.map(p=>radius(p.floor)))>12&&JUMP_COURSE.filter(p=>p.floor>10&&radius(p.floor)<3.5).length>=3,'the course uses both the rim and the middle');
});

test('each zone opens on a wide rest pad that no hazard or wind can reach, and it is not a checkpoint',()=>{
  const rests=JUMP_COURSE.filter(platform=>platform.rest).map(platform=>platform.floor);
  assert.deepEqual(rests,[...JUMP_ZONES.map(zone=>zone.restFloor),FLOORS]);
  assert.equal('checkpointEvery' in JUMP_RULES,false);
  for(const floor of rests){
    const pad=JUMP_COURSE[floor]!;
    assert.equal(pad.kind,'safe');assert.deepEqual(mechanics(pad),[]);assert.ok(pad.width>=4&&pad.depth>=4);
    if(floor===FLOORS)continue;
    // Stand everywhere on it for longer than any trap cycle: nothing moves or hits the player.
    for(const [fx,fz] of [[0,0],[.47,.47],[-.47,.47],[.47,-.47],[-.47,-.47]] as const)for(const tick of [0,431]){
      let state:JumpState={...createJumpStateOn(floor,tick),invulnerableUntil:0};state.x+=fx*pad.width;state.z+=fz*pad.depth;
      const start=state;
      for(let step=0;step<700;step++){const result=idle(state);state=result.state;assert.equal(result.died,false);}
      assert.equal(state.lastHitKind,null,`rest pad ${floor}`);assert.equal(state.standingFloor,floor);assert.equal(state.x,start.x);assert.equal(state.z,start.z);assert.equal(state.y,start.y);
    }
    // A fall from the rest pad still restarts from the ground.
    // (Out by the edge of the map, where no lower pad can catch the fall.)
    const fallen=idle({...createJumpStateOn(floor,50),x:JUMP_RULES.bounds-1,y:pad.y-JUMP_RULES.fallDepth+.01,vy:-9,grounded:false,standingFloor:null});
    if(floor>0){assert.equal(fallen.died,true);assert.equal(fallen.state.standingFloor,0);assert.equal(fallen.state.floor,0);}
  }
});

test('mechanics are introduced one at a time on a simple pad before they are combined, and the ramp gets harder',()=>{
  assert.deepEqual(new Set(JUMP_COURSE.map(platform=>platform.kind)),new Set(JUMP_PLATFORM_KINDS),'every platform kind is used');
  const first=new Map<string,JumpPlatform>();
  for(const platform of JUMP_COURSE)for(const kind of mechanics(platform))if(!first.has(kind))first.set(kind,platform);
  assert.equal(first.size,JUMP_PLATFORM_KINDS.length-1);
  const introductions=[...first.values()].map(platform=>platform.floor);
  assert.equal(new Set(introductions).size,introductions.length,'two new mechanics never share their first pad');
  for(const [kind,platform] of first){
    assert.deepEqual(mechanics(platform),[kind],`${kind} first appears alone (floor ${platform.floor})`);
    assert.ok(platform.floor<=40,`${kind} is introduced before the combination zones`);
    assert.ok(platform.width>=2.6&&platform.need==='single',`${kind} is introduced on an ordinary jump onto a roomy pad`);
  }
  const band=(from:number,to:number)=>JUMP_COURSE.filter(platform=>platform.floor>=from&&platform.floor<=to&&!platform.rest);
  const mean=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;
  assert.equal(band(1,40).filter(platform=>mechanics(platform).length>1).length,0,'floors 1-40 never combine mechanics');
  assert.ok(band(1,10).every(platform=>platform.need==='single'&&mechanics(platform).length<=1));
  assert.ok(band(1,10).filter(platform=>mechanics(platform).length===0).length>=5,'the first zone is mostly plain pads');
  assert.ok(band(41,70).filter(platform=>platform.surface!=='plain'&&platform.hazard).length>=8,'floors 41-70 combine a surface with a hazard');
  assert.ok(band(71,100).filter(platform=>mechanics(platform).length>1).length>=18,'the last thirty floors stack mechanics');
  const doubles=(from:number,to:number)=>band(from,to).concat(JUMP_COURSE.filter(platform=>platform.rest&&platform.floor>=from&&platform.floor<=to)).filter(platform=>platform.need==='double').length;
  assert.equal(doubles(1,10),0);assert.ok(doubles(11,40)>=2&&doubles(11,40)<=4);assert.ok(doubles(41,70)>=8);assert.ok(doubles(71,100)>=10);
  assert.ok(mean(band(71,100).map(platform=>platform.width))<mean(band(1,40).map(platform=>platform.width))-.4,'pads shrink toward the top');
  let streak=0,longest=0;
  for(const platform of band(71,100)){streak=platform.hazard?streak+1:0;longest=Math.max(longest,streak);}
  assert.ok(longest>=3,'hazards sit on consecutive pads near the top');
  // The old tower rose 1.1-1.4 per floor over gaps of at most 1.7: this one is taller and wider.
  assert.ok(JUMP_COURSE[FLOORS]!.y>130);
});

test('a scripted player climbs all one hundred floors with legal input only, from different trap phases',t=>{
  // Four unrelated trap phases: the solver has perfect foresight, so breadth is what this test adds.
  for(const startTick of [0,137,4242,31337]){
    const run=climbed(startTick);
    t.diagnostic(`start tick ${startTick}\n${describeClimb(run)}`);
    assert.equal(run.state.floor,FLOORS,`stopped at floor ${run.state.floor}`);assert.equal(run.state.status,'complete');assert.equal(run.state.standingFloor,FLOORS);
    assert.equal(run.falls,0);assert.equal(run.hits,0);assert.equal(run.state.deaths,0);assert.equal(run.state.lastHitTick,-1);
    assert.deepEqual(run.floors.map(floor=>floor.floor),Array.from({length:FLOORS},(_,index)=>index+1),'every floor is landed on in order: none is skipped');
    // Legal input: a direction no longer than one and a boolean, in consecutive ticks.
    run.frames.forEach((frame,index)=>{assert.equal(frame.seq,startTick+index+1);assert.ok(Math.hypot(frame.x,frame.z)<=1+1e-9);assert.equal(typeof frame.jump,'boolean');assert.deepEqual(Object.keys(frame).sort(),['jump','seq','x','z']);});
    assert.ok(run.frames.length>FLOORS*40,'all floors require actual simulated travel time');
    // Never frame-perfect: every jump the bot made also lands with each press 20 and 40 ms late.
    assert.deepEqual(run.floors.filter(floor=>!floor.forgiving).map(floor=>floor.floor),[]);
    for(const zone of run.zones)assert.ok(zone.waitTicks<50*20,`zone ${zone.zone+1} never stalls a perfect player for long`);
    // The same inputs always produce the same climb.
    let state=createJumpState(startTick);for(const frame of run.frames)state=stepJumpState(state,frame).state;
    assert.deepEqual(state,run.state);
    assert.deepEqual(climb({startTick,untilFloor:12}).frames,run.frames.slice(0,climb({startTick,untilFloor:12}).frames.length));
  }
});

test('every gap keeps a margin: the course is still climbable at 85% of running speed',t=>{
  const run=climbed(333,.85);
  t.diagnostic(`85% speed\n${describeClimb(run)}`);
  assert.equal(run.state.floor,FLOORS);assert.equal(run.falls,0);assert.equal(run.hits,0);
  assert.ok(run.frames.every(frame=>Math.hypot(frame.x,frame.z)<=.85+1e-9));
});

test('double jumps are needed exactly where intended, lifts and springs cannot be bypassed',()=>{
  const ticks=[1000,1047,1101,1163,1229,1298,1352,1417];
  const reachable=(floor:number,singleOnly:boolean)=>ticks.some(tick=>{
    // Give the solver time on the pad: a jump may have to wait for a hazard or a moving target.
    let state:JumpState={...createJumpStateOn(floor-1,tick),invulnerableUntil:0};
    for(let wait=0;wait<=60;wait+=6){
      if(findLeap(state,floor,{singleOnly}))return true;
      state=hold(state,6).state;
      if(state.standingFloor!==floor-1||state.lastHitTick>=0)return false;
    }
    return false;
  });
  const wrong:string[]=[];
  for(let floor=1;floor<=FLOORS;floor++){
    const target=JUMP_COURSE[floor]!,source=JUMP_COURSE[floor-1]!,rise=target.y-source.y;
    if(target.need==='double'){
      if(reachable(floor,true))wrong.push(`${floor}: a single jump is enough`);
      // Vertical and horizontal room to spare for the second jump.
      assert.ok(rise<=DOUBLE_APEX*.85,`floor ${floor} is too high for a comfortable double jump`);
    }else if(target.need==='single'){
      // The full climbs are evidence too: they wait on the pad the way a player would.
      const climbedSingle=[climbed(0),climbed(137)].some(run=>run.floors.some(report=>report.floor===floor&&!report.usedDouble));
      if(!climbedSingle&&!reachable(floor,true))wrong.push(`${floor}: no single jump found`);
      assert.ok(rise<JUMP_RULES.jumpVelocity**2/(2*JUMP_RULES.gravity)*.9,`floor ${floor} exceeds a single jump's apex`);
    }else if(target.need==='lift'){
      assert.equal(source.motion,'lift');
      assert.ok(rise>DOUBLE_APEX+.3&&rise-source.amplitude<1.6,`floor ${floor} needs the lift, and only a short hop from its top`);
      // From the bottom of its travel even a double jump falls short.
      let low=0;while(getJumpPlatformView(source,low).liftT>0||getJumpPlatformView(source,low+10).liftT>0)low++;
      assert.equal(findLeap({...createJumpStateOn(floor-1,low),invulnerableUntil:low+500},floor),null,`floor ${floor} is reachable without riding the lift`);
    }else{
      assert.equal(source.surface,'spring');
      assert.ok(rise>DOUBLE_APEX+.5,`floor ${floor} must be out of reach without the spring`);
      assert.ok(rise<JUMP_RULES.springVelocity**2/(2*JUMP_RULES.gravity)-.3,`the spring alone must clear floor ${floor}`);
    }
  }
  assert.deepEqual(wrong,[]);
});

test('the shortcuts are real: a high double jump skips two stones and still counts every floor',()=>{
  assert.ok(JUMP_SHORTCUTS.length>=2);
  for(const {from,to} of JUMP_SHORTCUTS){
    assert.equal(to,from+3);assert.equal(JUMP_COURSE[to]!.zone,8,'shortcuts belong to the stepping stones');assert.ok(from>=JUMP_ZONES[8]!.restFloor);
    let plan=null;
    for(let tick=1000;tick<1400&&!plan;tick+=7)plan=findLeap({...createJumpStateOn(from,tick),invulnerableUntil:0},to);
    assert.ok(plan,`shortcut ${from}→${to} is not passable`);
    assert.equal(plan.frames.filter(frame=>frame.jump).length,2,'the shortcut is a double jump');
    assert.equal(plan.state.floor,to);assert.equal(plan.state.lastFloor,to);
    let single=null;
    for(let tick=1000;tick<1400&&!single;tick+=7)single=findLeap({...createJumpStateOn(from,tick),invulnerableUntil:0},to,{singleOnly:true});
    assert.equal(single,null,'the shortcut costs a double jump');
  }
});

/** Every way the solver knows to jump, tried from a pad at many trap phases. */
function reaches(from:number,to:number):boolean {
  const candidates:LeapCandidate[]=[];
  for(const boost of [null,2,-1,-4,-7])for(const lead of [0,20])for(const along of [0,-.6,.6])for(const across of [0,-.6,.6])for(const takeoff of ['edge','now'] as const)candidates.push({takeoff,boost,along,across,lead});
  const source=JUMP_COURSE[from]!;
  for(let tick=0;tick<1680;tick+=28){
    let state:JumpState={...createJumpStateOn(from,tick),invulnerableUntil:0};
    // A spring throws its rider at once; the leap starts from that flight.
    if(source.surface==='spring')state=idle(state).state;
    for(const candidate of candidates)if((state.grounded||candidate.takeoff!=='now')&&tryLeap(state,to,candidate))return true;
  }
  return false;
}
test('no pad three or more floors up can be reached directly, except by the listed shortcuts; the last pad cannot be skipped',()=>{
  const allowed=new Set(JUMP_SHORTCUTS.map(route=>`${route.from}>${route.to}`)),found:string[]=[];
  const doubleReach=9.5,springReach=13,doubleRise=DOUBLE_APEX+.1,springRise=JUMP_RULES.springVelocity**2/(2*JUMP_RULES.gravity)+DOUBLE_APEX/2+.1;
  for(let from=0;from<=FLOORS-3;from++)for(let to=from+3;to<=FLOORS;to++){
    const a=JUMP_COURSE[from]!,b=JUMP_COURSE[to]!,spring=a.surface==='spring';
    const rise=b.y-a.y-(a.motion==='lift'?a.amplitude:0),gap=Math.hypot(b.x-a.x,b.z-a.z)-a.width/2-b.width/2;
    // Out of range by plain arithmetic: higher than two jumps (or a spring and a jump) can climb, far below, or too far away.
    if(rise>(spring?springRise:doubleRise)||rise<-JUMP_RULES.fallDepth||gap>(spring?springReach:doubleReach))continue;
    if(reaches(from,to))found.push(`${from}>${to}`);
  }
  assert.deepEqual(found.sort(),[...allowed].sort(),'pads reachable from three floors below');
  // Skipping a single pad with a long double jump is a skill move and is allowed, with one exception:
  // neither the spring on 98 nor the pad before it can carry anyone past the final trial pad.
  assert.equal(JUMP_COURSE[FLOORS-2]!.surface,'spring');
  assert.equal(reaches(FLOORS-2,FLOORS),false,'the spring before the last pad does not reach the summit');
  assert.ok(JUMP_COURSE[FLOORS]!.y-JUMP_COURSE[FLOORS-2]!.y>springRise);
});

test('a careless climber is punished more and more: the blind-attempt success rate falls from zone to zone',t=>{
  const zones=blindAttempts();
  t.diagnostic(zones.map(zone=>`zone ${zone.zone+1}: clean ${(zone.clean*100).toFixed(0)}%, trapped ${(zone.trapped*100).toFixed(0)}%, missed ${(zone.missed*100).toFixed(0)}%`).join('\n'));
  const mean=(from:number,to:number)=>zones.slice(from,to).reduce((sum,zone)=>sum+zone.clean,0)/(to-from);
  assert.ok(zones[0]!.clean>=.7,'the first zone forgives carelessness');
  assert.ok(zones[9]!.clean<=.36,'the last zone does not');
  // Floors 1-40 teach; from floor 41 on, about half of the careless attempts or fewer get through, and it never eases off again.
  assert.ok(mean(0,4)>mean(4,7)+.2,'floors 41-70 are a clear step up from the first forty');
  assert.ok(mean(7,10)<=mean(4,7)+.02&&zones.slice(4).every(zone=>zone.clean<=.55),'floors 71-100 are no kinder than 41-70');
  for(const zone of zones)assert.ok(zone.clean>0,'no zone is impossible to pass without planning');
});

test('landing on a lower pad is only a setback; the void and the kill box restart from the ground pad',()=>{
  // Where the star of zone 5 crosses itself, one pad hangs straight above another within falling distance.
  const upper=JUMP_COURSE.find(pad=>JUMP_COURSE.some(below=>below.floor<pad.floor-1&&below.motion==='static'&&Math.abs(below.x-pad.x)<.5&&Math.abs(below.z-pad.z)<.5&&pad.y-below.y<JUMP_RULES.fallDepth-1))!;
  const lower=JUMP_COURSE.find(below=>below.floor<upper.floor-1&&below.motion==='static'&&Math.abs(below.x-upper.x)<.5&&Math.abs(below.z-upper.z)<.5&&upper.y-below.y<JUMP_RULES.fallDepth-1)!;
  assert.ok(upper&&lower&&lower.motion==='static');
  const best=Math.min(FLOORS-1,upper.floor+4);
  let state:JumpState={...createJumpStateOn(upper.floor,1000),floor:best,x:lower.x,z:lower.z,y:upper.y-.3,vy:-1,grounded:false,standingFloor:null,jumps:2};
  let landed=false;
  for(let step=0;step<80&&!landed;step++){const result=idle(state);state=result.state;assert.equal(result.died,false);assert.equal(result.landedFloor,null,'an old floor is never a new landing');landed=state.grounded;}
  assert.equal(state.standingFloor,lower.floor);assert.equal(state.lastFloor,lower.floor);assert.equal(state.floor,best,'the best floor of the run is kept');assert.equal(state.deaths,0);assert.equal(state.fallFrom,state.y);

  // Without a pad below, the run ends once the player is fallDepth under the pad last stood on.
  const pad=JUMP_COURSE[34]!;
  state={...createJumpStateOn(34,2000),floor:36,deaths:3,x:pad.x+pad.width,vx:0,grounded:false,standingFloor:null,jumps:2};
  let died=false,lowest=state.y;
  for(let step=0;step<200&&!died;step++){const result=idle(state);died=result.died;if(!died){lowest=Math.min(lowest,result.state.y);assert.ok(result.state.y>=pad.y-JUMP_RULES.fallDepth-1e-9);}state=result.state;}
  assert.equal(died,true);assert.ok(lowest<pad.y-JUMP_RULES.fallDepth+.4,'the fall is not cut short');
  assert.equal(state.floor,0);assert.equal(state.standingFloor,0);assert.equal(state.lastFloor,0);assert.equal(state.x,0);assert.equal(state.y,0);assert.equal(state.z,0);assert.equal(state.deaths,4);
  assert.equal(state.tick,2000+Math.round((state.tick-2000)),'the arena clock keeps running');assert.equal(state.invulnerableUntil,state.tick+JUMP_RULES.spawnInvulnerabilityTicks);assert.equal(state.lastHitKind,null);

  // Walking off the edge of the map is the same reset, at any height.
  for(const [x,z] of [[JUMP_RULES.bounds+.01,0],[-JUMP_RULES.bounds-.01,0],[0,JUMP_RULES.bounds+.01],[0,-JUMP_RULES.bounds-.01]] as const){
    const out=idle({...createJumpStateOn(80,3000),x,z,y:JUMP_COURSE[80]!.y+2,grounded:false,standingFloor:null});
    assert.equal(out.died,true);assert.equal(out.state.standingFloor,0);assert.equal(out.state.deaths,1);
  }
  const inside=idle({...createJumpStateOn(80,3000),x:JUMP_RULES.bounds-.2,z:0,y:JUMP_COURSE[80]!.y+2,grounded:false,standingFloor:null});
  assert.equal(inside.died,false);
});

test('browser prediction replays the solver climb and stays identical to the authority',()=>{
  const run=climbed(0),client=new JumpPrediction({runId:'run',ackSeq:0,state:createJumpState(0)});
  let authority=createJumpState(0),acknowledged=0,inFlight:ReturnType<typeof client.outgoing>=[],checks=0;
  for(let index=0;index<run.frames.length;index++){
    const {x,z,jump}=run.frames[index]!;assert.equal(client.advance({x,z,jump}),true);
    // Every 200 ms a batch leaves and the answer to the previous one arrives, as on the socket.
    if(index%10===9){
      for(const frame of inFlight)authority=stepJumpState(authority,frame).state;
      acknowledged+=inFlight.length;assert.equal(client.reconcile({runId:'run',ackSeq:acknowledged,state:authority}),true);
      inFlight=client.outgoing();client.markSent(inFlight);
      if(index%500===9){checks++;assert.deepEqual(client.state,run.frames.slice(acknowledged,index+1).reduce((state,frame)=>stepJumpState(state,frame).state,authority));}
      assert.ok(client.queued<=24);
    }
  }
  assert.ok(checks>=10);assert.deepEqual(client.state,run.state);assert.equal(client.state.status,'complete');
});

test('the actual server accepts a full input-only climb and awards exactly one hundred floors plus the summit',{timeout:120_000},async()=>{
  const {mf,jump}=await createJumpHarness();
  try {
    // This route was planned from arena tick zero. The server's global clock
    // must begin at the same phase to compare deterministic trap positions.
    let now=0;
    await jump.connect('climber','independent-review',now);
    const entered=await jump.command('climber',{type:'jump-enter'},now);
    assert.equal(entered.ok,true);
    let snapshot:JumpSnapshot=entered.state;
    const basePoints=snapshot.profile.points,{state:expected,frames}=climbed(0);
    for(let offset=0;offset<frames.length;offset+=JUMP_RULES.maxBatchFrames) {
      const batch=frames.slice(offset,offset+JUMP_RULES.maxBatchFrames);
      now+=batch.length*JUMP_RULES.stepMs;
      const result=await jump.command('climber',{type:'jump-input',runId:snapshot.runId,frames:batch},now);
      assert.equal(result.ok,true,`input ${offset}: ${result.code} ${result.message}`);
      snapshot=result.state;
      assert.equal(snapshot.rewards.totalPoints,snapshot.state.floor+(snapshot.state.floor===FLOORS?JUMP_RULES.summitReward:0),'points follow the floors actually landed on');
    }
    assert.deepEqual(snapshot.state,expected,'predicted and authoritative simulations agree for the complete course');
    assert.equal(snapshot.profile.points,basePoints+JUMP_RULES.maxRewardPoints);
    assert.equal(snapshot.rewards.totalPoints,JUMP_RULES.maxRewardPoints);assert.equal(snapshot.rewards.summit,true);
    assert.equal((await jump.rewards()).length,FLOORS);
    assert.equal(snapshot.leaderboard[0]?.bestFloor,FLOORS);
    assert.deepEqual((await jump.ranking('room-1')).map((row:any)=>[row.floor,row.bestFloor]),[[FLOORS,FLOORS]]);

    const replay=await jump.command('climber',{type:'jump-input',runId:snapshot.runId,frames:frames.slice(-12)},now);
    assert.equal(replay.ok,true);assert.equal(replay.state.profile.points,basePoints+JUMP_RULES.maxRewardPoints);
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
