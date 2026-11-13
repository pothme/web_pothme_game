import { JUMP_COURSE, JUMP_RULES, createJumpState, createJumpStateOn, getJumpPlatformView, stepJumpState, type JumpHitKind, type JumpInput, type JumpPlatform, type JumpState } from '../shared/jump-game';

/** A scripted player for the shared simulation. It only ever produces legal
 * inputs (a direction of at most `inputScale` and a jump button) and learns what
 * they do by running stepJumpState, exactly as a browser predicts it. Reviewers
 * can reuse it to measure any course change:
 *
 *   const run=climb({startTick:0});          // run.state.floor===100
 *   console.log(describeClimb(run));         // per-zone time, waiting, tries, double jumps, tight jumps
 *   console.log(blindAttempts());            // how often a careless climber gets through each zone
 */
export interface SolverOptions {
  /** Arena tick at which the run begins (decides every trap phase). */
  startTick?:number;
  /** Largest direction magnitude the bot may hold; below 1 proves a horizontal margin. */
  inputScale?:number;
  /** Forbid the second jump (to prove a gap really needs it). */
  singleOnly?:boolean;
  /** A plainer player: always aims at the middle of the next pad and never leads a moving one. */
  plain?:boolean;
  /** Stop after reaching this floor. */
  untilFloor?:number;
  maxTicks?:number;
}
export interface LeapCandidate {takeoff:'now'|'edge';boost:number|null;along:number;across:number;lead:number}
export interface LeapPlan {
  frames:JumpInput[];state:JumpState;candidate:LeapCandidate;tries:number;
  /** The same manoeuvre still lands when every jump press comes one and two ticks (20/40 ms) late. */
  forgiving:boolean;
  /** The landing spot can be held without being hit. */
  calm:boolean;
}
export interface FloorReport {floor:number;zone:number;waitTicks:number;leapTicks:number;tries:number;usedDouble:boolean;forgiving:boolean}
export interface ZoneReport {zone:number;ticks:number;waitTicks:number;tries:number;doubles:number;tight:number;hits:number;falls:number;setbacks:number}
export interface ClimbReport {state:JumpState;frames:JumpInput[];floors:FloorReport[];zones:ZoneReport[];hits:number;falls:number;setbacks:number}

const clamp=(value:number,limit:number)=>Math.max(-limit,Math.min(limit,value));
const HOLD_STEP=4,HOLD_HORIZON=36,LEAP_TICKS=150,PATIENCE=80;
const BOOSTS=[2,-1,-4,-7] as const,OFFSETS=[0,-.6,.6] as const,LEADS=[0,20] as const;

function steer(state:JumpState,x:number,z:number,scale:number,jump:boolean):JumpInput {
  let ix=(x-state.x)*2.3-state.vx*.14,iz=(z-state.z)*2.3-state.vz*.14;
  const length=Math.hypot(ix,iz);
  if(length>scale){ix*=scale/length;iz*=scale/length;}
  return{seq:state.tick+1,x:clamp(ix,scale),z:clamp(iz,scale),jump};
}
const position=(state:JumpState)=>state.standingFloor??state.lastFloor;

function candidates(single:boolean):LeapCandidate[] {
  const list:LeapCandidate[]=[];
  // Single jumps first, so the report shows a second jump only where one was needed.
  for(const boost of single?[null]:[null,...BOOSTS])for(const lead of LEADS)for(const along of OFFSETS)for(const across of OFFSETS)for(const takeoff of ['edge','now'] as const)list.push({takeoff,boost,along,across,lead});
  return list;
}
const SINGLE=candidates(true),ALL=candidates(false);
const isPlain=(candidate:LeapCandidate)=>candidate.along===0&&candidate.across===0&&candidate.lead===0;
const PLAIN_SINGLE=SINGLE.filter(isPlain),PLAIN_ALL=ALL.filter(isPlain);
const choices=(options:SolverOptions)=>options.plain?(options.singleOnly?PLAIN_SINGLE:PLAIN_ALL):options.singleOnly?SINGLE:ALL;

/** Play one candidate from a state: run or drift toward an aim point on the target, jump, optionally jump again.
 * `slip` delays every jump press by that many ticks, the way a late thumb would. */
export function tryLeap(start:JumpState,target:number,candidate:LeapCandidate,scale=1,slip=0):{frames:JumpInput[];state:JumpState}|null {
  const pad=JUMP_COURSE[target]!,source=position(start),frames:JumpInput[]=[];
  const from=JUMP_COURSE[source]!;
  let tx=pad.x-from.x,tz=pad.z-from.z;const length=Math.hypot(tx,tz)||1;tx/=length;tz/=length;
  const floorY=Math.min(start.y,pad.y)-3.2;
  let state=start,launched=!start.grounded,boosted=start.jumps>=2,takeoffSlip=slip,boostSlip=slip;
  for(let tick=0;tick<LEAP_TICKS;tick++){
    const view=getJumpPlatformView(pad,state.tick+candidate.lead,state);
    const reachAlong=(Math.abs(tx)*view.width+Math.abs(tz)*view.depth)*.5,reachAcross=(Math.abs(tz)*view.width+Math.abs(tx)*view.depth)*.5;
    const aimX=view.x+tx*candidate.along*reachAlong*.62-tz*candidate.across*reachAcross*.62,aimZ=view.z+tz*candidate.along*reachAlong*.62+tx*candidate.across*reachAcross*.62;
    let jump=false;
    if(!state.jumpHeld){
      if(state.grounded&&!launched){
        let ready=candidate.takeoff==='now';
        if(!ready){
          const under=getJumpPlatformView(JUMP_COURSE[state.standingFloor!]!,state.tick+1,state),nextX=state.x+state.vx*.08,nextZ=state.z+state.vz*.08;
          ready=!under.active||Math.abs(nextX-under.x)>under.width/2-.02||Math.abs(nextZ-under.z)>under.depth/2-.02;
        }
        if(ready&&takeoffSlip-->0)ready=false;
        jump=ready;
      }else if(!state.grounded&&!boosted&&candidate.boost!==null&&state.jumps<2&&state.vy<=candidate.boost&&state.tick+1-state.lastJumpTick>=JUMP_RULES.minJumpTicks)jump=boostSlip--<=0;
    }
    const frame=steer(state,aimX,aimZ,scale,jump);frames.push(frame);
    const before=state,result=stepJumpState(state,frame);state=result.state;
    if(jump){if(before.grounded)launched=true;else boosted=true;}
    if(result.died||state.lastHitTick!==start.lastHitTick)return null;
    if(state.standingFloor===target||result.landedFloor===target||state.lastFloor===target&&state.lastBounceTick===state.tick)return{frames,state};
    if(state.grounded&&state.standingFloor!==source)return null;
    if(!state.grounded&&before.grounded&&!jump)launched=true;
    if(state.y<floorY)return null;
  }
  return null;
}

/** Stay alive where we are: choose, by looking a short way ahead, between standing, sidestepping and hopping. */
export function hold(start:JumpState,ticks=HOLD_STEP,scale=1):{frames:JumpInput[];state:JumpState} {
  const pad=JUMP_COURSE[position(start)]!;
  const play=(dx:number,dz:number,hop:boolean,length:number)=>{
    let state=start,score=0;const frames:JumpInput[]=[];
    for(let tick=0;tick<length;tick++){
      const view=getJumpPlatformView(pad,state.tick+1,state);
      const frame=steer(state,view.x+dx*view.width*.3,view.z+dz*view.depth*.3,scale,hop&&tick===0&&!state.jumpHeld);
      if(tick<ticks)frames.push(frame);
      const result=stepJumpState(state,frame);state=result.state;
      if(result.died){score-=1e6;break;}
      if(state.lastHitTick!==start.lastHitTick){score-=1e4;break;}
    }
    const view=getJumpPlatformView(pad,state.tick,state);
    // Holding means staying put; from the air, any pad is better than none and a higher one is better still.
    score+=!state.grounded?-200:start.grounded&&state.standingFloor===start.standingFloor?1000:500+(state.standingFloor??0);
    score-=Math.hypot(state.x-view.x,state.z-view.z)+(hop?.5:0)+Math.hypot(dx,dz)*.2;
    return{frames,score};
  };
  let best:{frames:JumpInput[];score:number}|null=null;
  for(const hop of [false,true])for(const [dx,dz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const){
    const option=play(dx,dz,hop,HOLD_HORIZON);
    if(!best||option.score>best.score)best=option;
  }
  let state=start;
  for(const frame of best!.frames)state=stepJumpState(state,frame).state;
  return{frames:best!.frames,state};
}
/** Can this spot be held for a while without a hit, a fall or leaving the pad? */
export function calm(state:JumpState,ticks:number,scale=1):boolean {
  const floor=state.standingFloor;let current=state;
  for(let done=0;done<ticks;done+=HOLD_STEP){
    current=hold(current,HOLD_STEP,scale).state;
    if(current.lastHitTick!==state.lastHitTick||current.deaths!==state.deaths||current.standingFloor!==floor)return false;
  }
  return true;
}

/** Best jump available on this very tick. A forgiving jump onto a spot that can be held wins outright;
 * otherwise a forgiving one, then a calm one, then anything that lands. */
export function findLeap(state:JumpState,target:number,options:SolverOptions={}):LeapPlan|null {
  const scale=options.inputScale??1,settle=JUMP_COURSE[target]!.motion==='crumble'?20:48;
  let forgiving:LeapPlan|null=null,calmOnly:LeapPlan|null=null,any:LeapPlan|null=null,tries=0,checked=0;
  for(const candidate of choices(options)){
    if(!state.grounded&&candidate.takeoff==='now')continue;
    tries++;const result=tryLeap(state,target,candidate,scale);
    if(!result)continue;
    const lenient=!!tryLeap(state,target,candidate,scale,1)&&!!tryLeap(state,target,candidate,scale,2);
    const settled=lenient||checked++<4?!result.state.grounded||calm(result.state,settle,scale):false;
    const plan:LeapPlan={...result,candidate,tries,forgiving:lenient,calm:settled};
    if(lenient&&settled)return plan;
    if(lenient)forgiving??=plan;else if(settled)calmOnly??=plan;else any??=plan;
  }
  const plan=forgiving??calmOnly??any;
  return plan?{...plan,tries}:null;
}

/** Climb from the ground pad, one floor at a time, waiting on each pad until a good jump works. */
export function climb(options:SolverOptions={}):ClimbReport {
  const scale=options.inputScale??1,until=options.untilFloor??JUMP_RULES.floors,maxTicks=options.maxTicks??120_000;
  let state=createJumpState(options.startTick??0);
  const frames:JumpInput[]=[],floors:FloorReport[]=[],start=state.tick;
  const zones:ZoneReport[]=Array.from({length:JUMP_RULES.floors/JUMP_RULES.zoneFloors},(_,zone)=>({zone,ticks:0,waitTicks:0,tries:0,doubles:0,tight:0,hits:0,falls:0,setbacks:0}));
  let hits=0,falls=0,setbacks=0,waited=0,tried=0;
  const zoneAt=(floor:number)=>zones[Math.max(0,Math.min(zones.length-1,Math.floor((Math.max(1,floor)-1)/JUMP_RULES.zoneFloors)))]!;
  const commit=(next:{frames:JumpInput[];state:JumpState},target:number)=>{
    const zone=zoneAt(target);
    if(next.state.deaths!==state.deaths){falls++;zone.falls++;}
    else if(next.state.lastHitTick!==state.lastHitTick){hits++;zone.hits++;}
    if(next.state.grounded&&next.state.standingFloor!==null&&next.state.standingFloor<position(state)&&next.state.deaths===state.deaths){setbacks++;zone.setbacks++;}
    zone.ticks+=next.frames.length;frames.push(...next.frames);state=next.state;
  };
  while(state.floor<until&&state.status!=='complete'&&state.tick-start<maxTicks){
    const target=position(state)+1,plan=findLeap(state,target,options);
    // A jump that is tight or lands somewhere dangerous is taken only when waiting is no better.
    const good=plan&&plan.forgiving&&plan.calm,patient=!good&&state.grounded&&waited<PATIENCE&&calm(state,HOLD_STEP*2,scale);
    if(plan&&!patient){
      const usedDouble=plan.frames.filter(frame=>frame.jump).length>=2,fresh=target>state.floor,zone=zoneAt(target);
      commit(plan,target);
      if(fresh){
        floors.push({floor:target,zone:zone.zone,waitTicks:waited,leapTicks:plan.frames.length,tries:tried+plan.tries,usedDouble,forgiving:plan.forgiving});
        zone.waitTicks+=waited;zone.tries+=tried+plan.tries;zone.doubles+=usedDouble?1:0;zone.tight+=plan.forgiving?0:1;
      }
      waited=0;tried=0;
    }else{
      tried+=plan?plan.tries:choices(options).length;waited+=HOLD_STEP;
      commit(hold(state,HOLD_STEP,scale),target);
    }
  }
  return{state,frames,floors,zones,hits,falls,setbacks};
}

/** One line per zone for test output and course tuning. */
export function describeClimb(report:ClimbReport):string {
  const seconds=(ticks:number)=>(ticks*JUMP_RULES.stepMs/1000).toFixed(1);
  return report.zones.map(zone=>`zone ${zone.zone+1}: ${seconds(zone.ticks)}s, waiting ${seconds(zone.waitTicks)}s, ${zone.tries} tries, ${zone.doubles} double jumps, ${zone.tight} tight jumps, ${zone.hits} hits, ${zone.setbacks} setbacks, ${zone.falls} falls`).join('\n');
}

/** A real contact with one hazard kind: a standing state one tick before the hit, found by search
 * rather than by copying the trap's timing numbers into a test. */
export function findContact(kind:JumpHitKind,options:{plain?:boolean;from?:number}={}):{platform:JumpPlatform;state:JumpState;after:JumpState} {
  const plain=options.plain??true;
  for(const platform of JUMP_COURSE){
    if(platform.hazard!==kind||plain&&(platform.motion!=='static'||platform.surface!=='plain'))continue;
    for(let tick=options.from??1000;tick<(options.from??1000)+700;tick++){
      const view=getJumpPlatformView(platform,tick+1);
      for(let ix=-4;ix<=4;ix++)for(let iz=-4;iz<=4;iz++){
        const state:JumpState={...createJumpStateOn(platform.floor,tick),x:view.x+ix*view.width*.11,z:view.z+iz*view.depth*.11,invulnerableUntil:0};
        const after=stepJumpState(state,{seq:state.tick+1,x:0,z:0,jump:false}).state;
        if(after.lastHitKind===kind&&after.lastHitTick===tick+1)return{platform,state,after};
      }
    }
  }
  throw new Error(`no contact found for ${kind}`);
}

/** A careless climber: stands still for half a second, then runs to the edge and jumps at roughly the middle
 * of the next pad without looking at any trap, and stands still again. The share of such attempts that end
 * clean is a difficulty figure a perfect solver cannot give. */
export function blindAttempts(samples=40):{zone:number;clean:number;trapped:number;missed:number}[] {
  const zones=Array.from({length:JUMP_RULES.floors/JUMP_RULES.zoneFloors},(_,zone)=>({zone,clean:0,trapped:0,missed:0,total:0}));
  for(let floor=1;floor<=JUMP_RULES.floors;floor++){
    const target=JUMP_COURSE[floor]!,source=JUMP_COURSE[floor-1]!,zone=zones[target.zone]!;
    if(source.surface==='spring')continue;
    for(let sample=0;sample<samples;sample++){
      let state:JumpState={...createJumpStateOn(floor-1,1000+sample*23),invulnerableUntil:0},failed=false;zone.total++;
      for(let tick=0;tick<25&&!failed;tick++){const result=stepJumpState(state,{seq:state.tick+1,x:0,z:0,jump:false});state=result.state;failed=result.died||state.lastHitTick>=0||state.standingFloor!==floor-1;}
      if(failed){zone.trapped++;continue;}
      // Nobody lands on the exact middle every time: the aim wanders by about a third of a unit.
      const leap=tryLeap(state,floor,{takeoff:'edge',boost:target.need==='double'?-1:target.need==='lift'?0:null,along:(sample%3-1)*.4,across:((sample>>2)%3-1)*.4,lead:0});
      if(!leap){zone.missed++;continue;}
      state=leap.state;
      for(let tick=0;tick<50&&!failed;tick++){
        const result=stepJumpState(state,{seq:state.tick+1,x:0,z:0,jump:false});state=result.state;
        failed=result.died||state.lastHitTick!==leap.state.lastHitTick||state.standingFloor!==floor&&target.surface!=='spring'&&target.motion!=='crumble';
      }
      if(failed)zone.trapped++;else zone.clean++;
    }
  }
  return zones.map(({zone,clean,trapped,missed,total})=>({zone,clean:clean/total,trapped:trapped/total,missed:missed/total}));
}
