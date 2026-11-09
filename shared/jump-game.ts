import type { GameProfile } from './game-room';

export const JUMP_RULES={stepMs:20,maxBatchFrames:12,networkCreditMs:300,maxStoredCreditMs:1000,speed:5.2,gravity:18,jumpVelocity:8.2,minJumpTicks:4,playerRadius:.22,knockbackTicks:18,hitInvulnerabilityTicks:50,floors:60,checkpointEvery:10,floorReward:1,summitReward:300,maxRewardPoints:360} as const;
export type JumpPlatformKind='safe'|'moving'|'blink'|'crumble'|'sweep'|'spikes'|'wind'|'pusher'|'conveyor'|'ice';
export type JumpHitKind='spikes'|'sweep'|'pusher';
export interface JumpPlatform {floor:number;x:number;y:number;z:number;width:number;depth:number;kind:JumpPlatformKind;phase:number;amplitude:number}
export interface JumpInput {seq:number;x:number;z:number;jump:boolean}
export interface JumpState {x:number;y:number;z:number;vx:number;vy:number;vz:number;tick:number;grounded:boolean;jumps:number;jumpHeld:boolean;lastJumpTick:number;standingFloor:number|null;floor:number;checkpoint:number;deaths:number;status:'playing'|'complete';crumbleAt:Record<string,number>;invulnerableUntil:number;lastHitTick:number;lastHitKind:JumpHitKind|null;knockbackUntil:number}
export interface JumpLeaderboardRow {nickname:string;bestFloor:number;reachedAt:number}
export interface JumpSnapshot {runId:string;active:boolean;state:JumpState;ackSeq:number;serverTime:number;rewards:{earnedFloors:number[];summit:boolean;totalPoints:number;maxPoints:number};profile:GameProfile;leaderboard:JumpLeaderboardRow[]}
export interface JumpPlatformView {x:number;y:number;z:number;width:number;depth:number;active:boolean;warning:boolean;hazardActive:boolean;sweepAngle:number;windX:number;windZ:number;pusherExtension:number;pushX:number;pushZ:number;pusherX:number;pusherZ:number;beltX:number;beltZ:number}
const kinds:JumpPlatformKind[]=['safe','moving','safe','blink','crumble','safe','spikes','wind','sweep'];
function makeCourse():JumpPlatform[]{
  const platforms:JumpPlatform[]=[{floor:0,x:0,y:0,z:0,width:4.5,depth:4.5,kind:'safe',phase:0,amplitude:0}];
  let height=0;
  for(let floor=1;floor<=JUMP_RULES.floors;floor++){
    const difficulty=(floor-1)/59,checkpoint=floor%10===0,angle=floor*Math.PI/3,radius=2.6+difficulty;
    height+=1.1+difficulty*.32;
    let kind:JumpPlatformKind=checkpoint||floor<=3?'safe':kinds[(floor-1)%9]!;
    // Introduce one new surface at a time after the familiar first ten floors.
    if(floor>=12&&floor%10===2)kind='ice';
    if(floor>=18&&floor%10===8)kind='conveyor';
    if(floor>=24&&floor%10===4)kind='pusher';
    platforms.push({floor,x:Math.cos(angle)*radius,y:height,z:Math.sin(angle)*radius,width:checkpoint?4.2:2.9-difficulty,depth:checkpoint?4.2:2.9-difficulty,kind,phase:(floor*37)%240,amplitude:.35+difficulty*.22});
  }
  return platforms;
}
export const JUMP_COURSE:readonly JumpPlatform[]=makeCourse();
export const getJumpCourse=()=>JUMP_COURSE;
const modulo=(value:number,by:number)=>((value%by)+by)%by;
export function getJumpPlatformView(platform:JumpPlatform,tick:number,state?:JumpState):JumpPlatformView{
  const t=tick*JUMP_RULES.stepMs/1000,phase=modulo(tick+platform.phase,200);
  const view:JumpPlatformView={x:platform.x,y:platform.y,z:platform.z,width:platform.width,depth:platform.depth,active:true,warning:false,hazardActive:false,sweepAngle:t*.9+platform.phase*.08,windX:0,windZ:0,pusherExtension:0,pushX:0,pushZ:0,pusherX:platform.x,pusherZ:platform.z,beltX:0,beltZ:0};
  if(platform.kind==='moving'){view.x+=Math.sin(t*.85+platform.phase)*platform.amplitude;view.z+=Math.cos(t*.85+platform.phase)*platform.amplitude*.55;}
  else if(platform.kind==='blink'){view.warning=phase>=130&&phase<155;view.active=phase<155||phase>=190;}
  else if(platform.kind==='crumble'){
    const started=state?.crumbleAt[String(platform.floor)];
    if(started!==undefined){const age=tick-started;view.warning=age>=15&&age<55;view.active=age<55||age>=180;}
  }else if(platform.kind==='spikes'){view.warning=phase>=90&&phase<115;view.hazardActive=phase>=115&&phase<155;}
  else if(platform.kind==='sweep'){view.hazardActive=true;view.warning=true;}
  else if(platform.kind==='wind'){view.warning=true;const strength=.65+platform.floor/100;view.windX=Math.sin(t*.65+platform.phase)*strength;view.windZ=Math.cos(t*.65+platform.phase)*strength;}
  else if(platform.kind==='pusher'){
    const stroke=modulo(tick+platform.phase,220),axis=Math.floor(platform.floor/10)%4;
    view.pushX=axis===0?1:axis===2?-1:0;view.pushZ=axis===1?1:axis===3?-1:0;
    view.warning=stroke>=100&&stroke<125;view.hazardActive=stroke>=125&&stroke<165;
    view.pusherExtension=stroke<125||stroke>=165?0:stroke<140?(stroke-125)/15:stroke<150?1:(165-stroke)/15;
    const half=(view.pushX?platform.width:platform.depth)/2;
    const travel=-half-.16+view.pusherExtension*(half+.46);
    view.pusherX=platform.x+view.pushX*travel;view.pusherZ=platform.z+view.pushZ*travel;
  }else if(platform.kind==='conveyor'){
    const axis=Math.floor(platform.floor/10)%4,speed=.85+platform.floor/90;
    view.beltX=axis===0?speed:axis===2?-speed:0;view.beltZ=axis===1?speed:axis===3?-speed:0;
  }
  return view;
}
export function createJumpState(checkpoint=0,tick=0):JumpState{
  const cp=Math.max(0,Math.min(60,Math.floor(checkpoint/10)*10)),platform=JUMP_COURSE[cp];
  const clock=Number.isSafeInteger(tick)&&tick>=0?tick:0;
  return{x:platform.x,y:platform.y,z:platform.z,vx:0,vy:0,vz:0,tick:clock,grounded:true,jumps:0,jumpHeld:false,lastJumpTick:clock-100,standingFloor:cp,floor:cp,checkpoint:cp,deaths:0,status:cp===60?'complete':'playing',crumbleAt:{},invulnerableUntil:clock+50,lastHitTick:-1,lastHitKind:null,knockbackUntil:0};
}
/** Align to the shared arena clock without advancing player-controlled physics.
 * A rider is carried by a moving platform even after a pause/reconnection. */
export function alignJumpClock(previous:JumpState,targetTick:number):JumpState{
  const tick=Number.isSafeInteger(targetTick)?Math.max(previous.tick,targetTick):previous.tick;
  if(tick===previous.tick)return previous;
  const state={...previous,tick,crumbleAt:{...previous.crumbleAt}};
  const platform=previous.standingFloor===null?null:JUMP_COURSE[previous.standingFloor];
  if(previous.grounded&&platform?.kind==='moving'){
    const before=getJumpPlatformView(platform,previous.tick,previous),after=getJumpPlatformView(platform,tick,state);
    state.x+=after.x-before.x;state.z+=after.z-before.z;
  }
  return state;
}
export function respawnJumpState(previous:JumpState):JumpState{
  const result=createJumpState(previous.checkpoint,previous.tick);result.deaths=previous.deaths+1;return result;
}
const inside=(x:number,z:number,p:JumpPlatformView,margin=JUMP_RULES.playerRadius*.35)=>Math.abs(x-p.x)<=p.width/2+margin&&Math.abs(z-p.z)<=p.depth/2+margin;
const approach=(value:number,target:number,amount:number)=>value<target?Math.min(target,value+amount):Math.max(target,value-amount);

/** Pure fixed-step simulation shared by browser prediction and the authority.
 * Inputs never contain a position, a floor, a clock delta, or a point amount. */
export function stepJumpState(previous:JumpState,input:JumpInput):{state:JumpState;landedFloor:number|null;died:boolean}{
  // Old in-flight snapshots may not have the newly added reaction fields.
  const state:JumpState={...previous,lastHitTick:previous.lastHitTick??-1,lastHitKind:previous.lastHitKind??null,knockbackUntil:previous.knockbackUntil??0,crumbleAt:{...previous.crumbleAt}};state.tick++;
  if(state.status==='complete'){state.jumpHeld=input.jump;return{state,landedFloor:null,died:false};}
  const dt=JUMP_RULES.stepMs/1000,standing=state.standingFloor===null?null:JUMP_COURSE[state.standingFloor];
  if(state.grounded&&standing){
    const before=getJumpPlatformView(standing,previous.tick,previous),current=getJumpPlatformView(standing,state.tick,state);
    state.x+=current.x-before.x;state.z+=current.z-before.z;
    if(!current.active||!inside(state.x,state.z,current)){state.grounded=false;state.standingFloor=null;state.jumps=Math.max(1,state.jumps);}
  }
  const pressed=input.jump&&!previous.jumpHeld;state.jumpHeld=input.jump;
  if(pressed&&state.jumps<2&&state.tick-state.lastJumpTick>=JUMP_RULES.minJumpTicks){state.vy=JUMP_RULES.jumpVelocity;state.grounded=false;state.standingFloor=null;state.jumps++;state.lastJumpTick=state.tick;}
  let x=Number.isFinite(input.x)?Math.max(-1,Math.min(1,input.x)):0,z=Number.isFinite(input.z)?Math.max(-1,Math.min(1,input.z)):0;
  const magnitude=Math.hypot(x,z);if(magnitude>1){x/=magnitude;z/=magnitude;}
  const onIce=state.grounded&&standing?.kind==='ice';
  const acceleration=state.tick<state.knockbackUntil?3.5:onIce?(magnitude>.01?6:1.2):state.grounded?30:22;
  state.vx=approach(state.vx,x*JUMP_RULES.speed,acceleration*dt);state.vz=approach(state.vz,z*JUMP_RULES.speed,acceleration*dt);
  if(state.grounded&&standing?.kind==='conveyor'){
    const belt=getJumpPlatformView(standing,state.tick,state);state.x+=belt.beltX*dt;state.z+=belt.beltZ*dt;
  }
  // Surface airflow carries even an idle player. Treating it as a tiny input
  // acceleration would let the normal braking cancel the gust every tick.
  for(const platform of JUMP_COURSE){
    if(platform.kind!=='wind')continue;
    const view=getJumpPlatformView(platform,state.tick,state);
    if(Math.abs(state.y-platform.y)<2&&inside(state.x,state.z,view,.8)){state.x+=view.windX*dt;state.z+=view.windZ*dt;}
  }
  state.x+=state.vx*dt;state.z+=state.vz*dt;
  const oldY=state.y;
  if(!state.grounded){state.vy-=JUMP_RULES.gravity*dt;state.y+=state.vy*dt;}
  else if(standing&&!inside(state.x,state.z,getJumpPlatformView(standing,state.tick,state))){state.grounded=false;state.standingFloor=null;state.jumps=Math.max(1,state.jumps);}
  let landedFloor:number|null=null;
  if(!state.grounded&&state.vy<=0){
    // Check every physically crossed surface. Restricting this to floor+1
    // makes a reachable second platform visually solid but non-collidable.
    for(let floor=60;floor>=0;floor--){
      const platform=JUMP_COURSE[floor],view=getJumpPlatformView(platform,state.tick,state);
      if(!view.active||oldY<view.y-.001||state.y>view.y||!inside(state.x,state.z,view))continue;
      state.y=view.y;state.vy=0;state.grounded=true;state.jumps=0;state.standingFloor=floor;
      if(platform.kind==='crumble'&&(state.crumbleAt[String(floor)]===undefined||state.tick-state.crumbleAt[String(floor)]>=180))state.crumbleAt[String(floor)]=state.tick;
      if(floor>state.floor){state.floor=floor;landedFloor=floor;state.checkpoint=Math.max(state.checkpoint,Math.floor(floor/10)*10);if(floor===60)state.status='complete';}
      break;
    }
  }
  let hit:JumpHitKind|null=null,hitX=0,hitZ=0;
  if(state.tick>=state.invulnerableUntil&&state.standingFloor!==null){
    const platform=JUMP_COURSE[state.standingFloor],view=getJumpPlatformView(platform,state.tick,state);
    const dx=state.x-view.x,dz=state.z-view.z;
    // Red spikes occupy only a center strip; the side margins remain usable.
    if(platform.kind==='spikes'&&view.hazardActive&&Math.abs(dx)<platform.width*.2&&Math.abs(dz)<platform.depth*.35){hit='spikes';const length=Math.hypot(dx,dz);hitX=length>.05?dx/length:platform.x/Math.hypot(platform.x,platform.z);hitZ=length>.05?dz/length:platform.z/Math.hypot(platform.x,platform.z);}
    if(platform.kind==='sweep'&&view.hazardActive){const along=dx*Math.cos(view.sweepAngle)+dz*Math.sin(view.sweepAngle),across=-dx*Math.sin(view.sweepAngle)+dz*Math.cos(view.sweepAngle);if(Math.abs(along)<Math.min(platform.width,platform.depth)*.43&&Math.abs(across)<.17){hit='sweep';const side=along<0?-1:1;hitX=-Math.sin(view.sweepAngle)*side;hitZ=Math.cos(view.sweepAngle)*side;}}
    if(platform.kind==='pusher'&&view.hazardActive){const px=state.x-view.pusherX,pz=state.z-view.pusherZ,along=px*view.pushX+pz*view.pushZ,across=-px*view.pushZ+pz*view.pushX;if(Math.abs(along)<.3&&Math.abs(across)<Math.min(platform.width,platform.depth)*.34){hit='pusher';hitX=view.pushX;hitZ=view.pushZ;}}
  }
  if(hit){
    // Contact throws the player into ordinary air physics. Steering returns
    // gradually and one aerial jump remains available to recover onto a pad.
    const speed=hit==='pusher'?6.1:hit==='sweep'?5.7:5.3;
    state.vx=hitX*speed;state.vz=hitZ*speed;state.vy=hit==='spikes'?6.4:5.5;
    state.y+=.025;state.grounded=false;state.standingFloor=null;state.jumps=1;state.jumpHeld=input.jump;
    state.lastJumpTick=state.tick;state.lastHitTick=state.tick;state.lastHitKind=hit;
    state.knockbackUntil=state.tick+JUMP_RULES.knockbackTicks;state.invulnerableUntil=state.tick+JUMP_RULES.hitInvulnerabilityTicks;
  }
  const checkpoint=JUMP_COURSE[state.checkpoint];
  if(state.y<checkpoint.y-5||Math.abs(state.x)>12||Math.abs(state.z)>12)return{state:respawnJumpState(state),landedFloor:null,died:true};
  return{state,landedFloor,died:false};
}
