import type { GameProfile } from './game-room';

/** One rule table for the browser prediction and the authority.
 * There are no checkpoints: a fall into the void restarts from the ground pad. */
export const JUMP_RULES={
  stepMs:20,maxBatchFrames:12,networkCreditMs:300,maxStoredCreditMs:1000,
  speed:5.2,gravity:18,jumpVelocity:8.2,minJumpTicks:4,playerRadius:.22,
  knockbackTicks:18,hitInvulnerabilityTicks:50,spawnInvulnerabilityTicks:50,
  floors:100,zoneFloors:10,floorReward:1,summitReward:500,maxRewardPoints:600,
  /** A run resets only this far below the pad last stood on, or outside the box. */
  fallDepth:6,bounds:19,springVelocity:13.5,
  /** Protection that follows the first landing after a hit, so nobody is struck again before they can move. */
  recoveryTicks:25,recoveryWindowTicks:200,
  /** The tower never pauses: ticks without input are played as "no input" up to this many at once (12 s). */
  settleTicks:600,
} as const;

/** Every trap is a function of the shared tick. Fractions are parts of the pad's own period. */
export const JUMP_TIMING={
  moving:{period:340},
  lift:{period:320,dwellLow:.15,travel:.3,dwellHigh:.22},
  orbit:{period:420},
  blink:{period:200,warnAt:.475,offAt:.625},
  crumble:{warnAt:10,fallAt:45,respawnAt:170},
  shrink:{period:260,warnAt:.25,shrinkAt:.35,smallAt:.5,growAt:.7,fullAt:.85,minScale:.42},
  spikes:{period:200,warnAt:.3,onAt:.55,offAt:.8,strip:.2,span:.38},
  sweep:{speed:1.1,reach:.43,halfThickness:.17,hub:.24},
  pusher:{period:220,warnAt:85/220,onAt:125/220,outAt:140/220,holdAt:150/220,offAt:165/220},
  wind:{period:300,warnAt:.35,onAt:.5,offAt:.9,ramp:.05,margin:.8,height:2},
  hammer:{period:170,arm:3.4,halfLength:.45,halfWidth:.55,height:1.25,headY:.55},
  laser:{period:210,halfWidth:.13,inset:.15},
  saw:{period:150,radius:.42,inset:.2},
  cannon:{period:170,warnTicks:50,speed:4,range:7,radius:.5,shotY:.6,muzzle:.7},
  flame:{period:280,warnA:0,onA:.18,offA:.42,warnB:.5,onB:.68,offB:.92,seam:.08},
} as const;

export type JumpMotion='static'|'moving'|'lift'|'orbit'|'blink'|'crumble'|'shrink';
export type JumpSurface='plain'|'ice'|'conveyor'|'spring';
export type JumpHazard='spikes'|'sweep'|'pusher'|'wind'|'hammer'|'laser'|'saw'|'cannon'|'flame';
export type JumpPlatformKind='safe'|Exclude<JumpMotion,'static'>|Exclude<JumpSurface,'plain'>|JumpHazard;
export type JumpHitKind=Exclude<JumpHazard,'wind'>;
/** How the pad is meant to be reached from the pad below it. */
export type JumpNeed='single'|'double'|'lift'|'spring';
export const JUMP_PLATFORM_KINDS:readonly JumpPlatformKind[]=['safe','moving','lift','orbit','blink','crumble','shrink','ice','conveyor','spring','spikes','sweep','pusher','wind','hammer','laser','saw','cannon','flame'];
export const JUMP_HIT_KINDS:readonly JumpHitKind[]=['spikes','sweep','pusher','hammer','laser','saw','cannon','flame'];

export interface JumpPlatform {
  floor:number;zone:number;x:number;y:number;z:number;width:number;depth:number;
  /** Dominant mechanic, for labels and colours: hazard, else surface, else motion, else safe. */
  kind:JumpPlatformKind;motion:JumpMotion;surface:JumpSurface;hazard:JumpHazard|null;
  /** Wide, hazard-free pad that opens a zone. It is a place to breathe, not a checkpoint. */
  rest:boolean;need:JumpNeed;
  /** Motion: tick offset, travel (moving half-travel, lift height, orbit radius, shrink minimum scale) and period in ticks. */
  phase:number;amplitude:number;period:number;
  /** Axis of a moving pad and of the belt. `belt` is the conveyor speed in units per second. */
  dirX:number;dirZ:number;belt:number;
  /** Hazard: tick offset, cycle in ticks, axis and strength (wind speed, sweep rad/s, hammer half-travel, cannon range). */
  hazardPhase:number;hazardPeriod:number;hazDirX:number;hazDirZ:number;power:number;
}
export interface JumpZone {index:number;id:string;name:string;pattern:string;from:number;to:number;restFloor:number}
export interface JumpInput {seq:number;x:number;z:number;jump:boolean}
export interface JumpState {
  x:number;y:number;z:number;vx:number;vy:number;vz:number;tick:number;grounded:boolean;jumps:number;jumpHeld:boolean;lastJumpTick:number;
  standingFloor:number|null;
  /** Highest floor reached in this run; returns to zero after a fall into the void. */
  floor:number;
  /** Pad last stood on (the current position on the course) and its height. */
  lastFloor:number;fallFrom:number;
  deaths:number;status:'playing'|'complete';
  /** Crumbling pads are personal: each climber's own landing starts the timer, so two room-mates
   * can see the same pad in different states. Everything else is a function of the shared tick. */
  crumbleAt:Record<string,number>;
  invulnerableUntil:number;lastHitTick:number;lastHitKind:JumpHitKind|null;knockbackUntil:number;lastBounceTick:number;
}
export interface JumpLeaderboardRow {nickname:string;bestFloor:number;reachedAt:number}
export interface JumpRewards {earnedFloors:number[];summit:boolean;totalPoints:number;maxPoints:number;legacyBonus:number}
export interface JumpSnapshot {runId:string;active:boolean;roomId:string|null;state:JumpState;ackSeq:number;serverTime:number;rewards:JumpRewards;profile:GameProfile;leaderboard:JumpLeaderboardRow[]}
export interface JumpPlatformView {
  x:number;y:number;z:number;width:number;depth:number;
  /** Solid this tick. */
  active:boolean;
  /** padWarning || hazardWarning. */
  warning:boolean;
  /** The surface is about to vanish or shrink. */
  padWarning:boolean;
  /** Telegraph before the hazard becomes dangerous. */
  hazardWarning:boolean;hazardActive:boolean;
  /** Shrink scale already applied to width and depth; lift progress 0..1; orbit angle around the pad's pivot. */
  scale:number;liftT:number;orbitAngle:number;
  sweepAngle:number;windX:number;windZ:number;
  pusherExtension:number;pushX:number;pushZ:number;pusherX:number;pusherZ:number;
  beltX:number;beltZ:number;
  /** Moving hazard element: hammer head, laser beam centre, saw blade, cannon shot (the muzzle while idle). */
  hazardX:number;hazardY:number;hazardZ:number;
  /** Hammer swing angle from vertical. */
  hazardAngle:number;
  /** Signed speed of the element along the hazard axis, units per second. */
  hazardMove:number;hazardDirX:number;hazardDirZ:number;
  /** Which half along the hazard axis burns (-1 near, 1 far) and which is about to. */
  flameSide:-1|0|1;flameWarnSide:-1|0|1;
}

export const JUMP_ZONES:readonly JumpZone[]=([
  ['garden','새싹 나선','완만한 나선'],
  ['cliff','지그재그 절벽','한 면을 오르는 지그재그'],
  ['bridge','구름다리','멀리 나갔다 돌아오는 직선 다리'],
  ['factory','네모 공장','방향이 바뀌는 사각 계단'],
  ['sky','허공 건너뛰기','탑 중심을 가로지르는 도약'],
  ['shaft','수직 통로','좁은 통로의 엇갈린 작은 발판'],
  ['ridge','S자 능선','바깥으로 나갔다 안으로 감기는 곡선'],
  ['storm','역회전 폭풍','반대로 감기는 나선'],
  ['ruins','징검다리 갈림길','지름길이 있는 흩어진 징검돌'],
  ['summit','정상 시련','모든 장치가 섞인 마지막 구간'],
] as const).map(([id,name,pattern],index)=>({index,id,name,pattern,from:index*10+1,to:index*10+10,restFloor:index*10}));
/** Optional harder routes among the stepping stones: `to` can be reached straight from `from` with a
 * high double jump, skipping two pads. These are the only places where more than one pad can be
 * skipped. Skipping a single pad with a long double jump is possible on much of the tower and is
 * left in as a skill move: it spends the recovery jump and every crossed floor is still paid. */
export const JUMP_SHORTCUTS:readonly {from:number;to:number}[]=[{from:80,to:83},{from:81,to:84},{from:84,to:87},{from:85,to:88}];
export function jumpZoneOf(floor:number):JumpZone {return JUMP_ZONES[Math.max(0,Math.min(JUMP_ZONES.length-1,Math.floor((Math.max(1,floor)-1)/JUMP_RULES.zoneFloors)))]!;}
/** Points for reaching a floor for the first time. The summit bonus rides on the last floor. */
export function jumpFloorReward(floor:number):number {
  if(!Number.isSafeInteger(floor)||floor<1||floor>JUMP_RULES.floors)return 0;
  return JUMP_RULES.floorReward+(floor===JUMP_RULES.floors?JUMP_RULES.summitReward:0);
}
/** The namespace is unchanged from the sixty-floor tower, so a paid floor is never paid twice. */
export const jumpRewardToken=(floor:number)=>`jump-v1:floor:${floor}`;
export function jumpRewardFloor(token:unknown):number|null {
  const match=typeof token==='string'?/^jump-v1:floor:([1-9][0-9]{0,2})$/.exec(token):null,floor=match?Number(match[1]):0;
  return floor>=1&&floor<=JUMP_RULES.floors?floor:null;
}

type Side='along'|'back'|'left'|'right'|readonly [number,number];
interface PadOptions {w?:number;d?:number;motion?:JumpMotion;surface?:JumpSurface;hazard?:JumpHazard;rest?:boolean;need?:JumpNeed;phase?:number;amp?:number;period?:number;dir?:Side;belt?:number;hazardPhase?:number;hazardPeriod?:number;hazDir?:Side;power?:number}
const HAZARD_PERIOD:Record<JumpHazard,number>={spikes:JUMP_TIMING.spikes.period,sweep:0,pusher:JUMP_TIMING.pusher.period,wind:JUMP_TIMING.wind.period,hammer:JUMP_TIMING.hammer.period,laser:JUMP_TIMING.laser.period,saw:JUMP_TIMING.saw.period,cannon:JUMP_TIMING.cannon.period,flame:JUMP_TIMING.flame.period};
const HAZARD_SIDE:Record<JumpHazard,Side>={spikes:'along',sweep:'along',pusher:'left',wind:'left',hammer:'left',laser:'along',saw:'left',cannon:'left',flame:'along'};
const MOTION_PERIOD:Record<JumpMotion,number>={static:0,moving:JUMP_TIMING.moving.period,lift:JUMP_TIMING.lift.period,orbit:JUMP_TIMING.orbit.period,blink:JUMP_TIMING.blink.period,crumble:0,shrink:JUMP_TIMING.shrink.period};
const MOTION_AMPLITUDE:Record<JumpMotion,number>={static:0,moving:.8,lift:3.2,orbit:.9,blink:0,crumble:0,shrink:JUMP_TIMING.shrink.minScale};
const extent=(p:{width:number;depth:number},x:number,z:number)=>Math.abs(x)*p.width+Math.abs(z)*p.depth;
const TAU=Math.PI*2,SECONDS=JUMP_RULES.stepMs/1000;
/** sin(2π·turns) built from + − × ÷ only. The built-in sine, cosine and hypot may differ in the last
 * bit between engines; these give the browser and the server exactly the same pad and trap positions. */
function sinTurns(turns:number):number {
  let u=turns-Math.floor(turns),sign=1;
  if(u>=.5){u-=.5;sign=-1;}
  if(u>.25)u=.5-u;
  const x=u*TAU,x2=x*x;
  return sign*x*(1+x2*(-1/6+x2*(1/120+x2*(-1/5040+x2*(1/362880+x2*(-1/39916800+x2*(1/6227020800+x2*(-1/1307674368000))))))))+0;
}
const cosTurns=(turns:number)=>sinTurns(turns+.25);
const length2=(x:number,z:number)=>Math.sqrt(x*x+z*z);

function makeCourse():JumpPlatform[]{
  const platforms:JumpPlatform[]=[];
  const resolve=(side:Side,x:number,z:number):[number,number]=>{
    if(typeof side!=='string'){const length=length2(side[0],side[1])||1;return[side[0]/length,side[1]/length];}
    // Adding zero turns a negative zero into a plain one, which JSON cannot carry.
    return side==='along'?[x+0,z+0]:side==='back'?[0-x,0-z]:side==='left'?[0-z,x+0]:[z+0,0-x];
  };
  const pad=(x:number,z:number,rise:number,o:PadOptions={})=>{
    const floor=platforms.length,previous=platforms[floor-1];
    let tx=1,tz=0;
    if(previous){const length=length2(x-previous.x,z-previous.z);if(length>.01){tx=(x-previous.x)/length;tz=(z-previous.z)/length;}}
    const motion=o.motion??'static',surface=o.surface??'plain',hazard=o.hazard??null;
    const [dirX,dirZ]=resolve(o.dir??(motion==='moving'?'left':'along'),tx,tz),[hazDirX,hazDirZ]=resolve(o.hazDir??(hazard?HAZARD_SIDE[hazard]:'along'),tx,tz);
    const width=o.w??2.6,depth=o.d??o.w??2.6,size={width,depth};
    const power=o.power??(hazard==='wind'?1.9:hazard==='sweep'?JUMP_TIMING.sweep.speed:hazard==='hammer'?extent(size,hazDirX,hazDirZ)/2+.9:hazard==='cannon'?JUMP_TIMING.cannon.range:0);
    platforms.push({
      floor,zone:floor===0?0:Math.floor((floor-1)/JUMP_RULES.zoneFloors),x,y:(previous?.y??0)+(previous?rise:0),z,width,depth,
      kind:hazard??(surface!=='plain'?surface:motion!=='static'?motion:'safe'),motion,surface,hazard,rest:o.rest??false,
      need:o.need??(previous?.motion==='lift'?'lift':previous?.surface==='spring'?'spring':'single'),
      phase:o.phase??(floor*37)%200,amplitude:o.amp??MOTION_AMPLITUDE[motion],period:o.period??MOTION_PERIOD[motion],
      dirX,dirZ,belt:surface==='conveyor'?o.belt??1.3:0,
      hazardPhase:o.hazardPhase??(floor*53)%220,hazardPeriod:o.hazardPeriod??(hazard?HAZARD_PERIOD[hazard]:0),hazDirX,hazDirZ,power,
    });
  };
  const rest=(x:number,z:number,rise:number,o:PadOptions={})=>pad(x,z,rise,{w:4.2,rest:true,...o});
  const polar=(radius:number,degrees:number):[number,number]=>[cosTurns(degrees/360)*radius,sinTurns(degrees/360)*radius];
  const ring=(radius:number,degrees:number,rise:number,o:PadOptions={})=>{const [x,z]=polar(radius,degrees);pad(x,z,rise,o);};

  rest(0,0,0,{w:4.5});

  // Zone 1 · gentle spiral. One mechanic per pad, each on a wide, slow pad. Three floors rise more
  // than a double jump, so the pad across the spiral cannot be reached directly.
  ring(4.2,60,1.2,{w:3});ring(4.2,120,1.2,{w:3});ring(4.2,180,1.2,{w:3});
  ring(4.2,240,1.2,{w:3,motion:'moving',amp:.6,period:360});
  ring(4.2,300,1.2,{w:2.8});
  ring(4.2,360,1.2,{w:3,motion:'blink'});
  ring(4.2,420,1.2,{w:2.8});
  ring(4.2,480,1.2,{w:3,motion:'crumble'});
  ring(4.2,540,1.2,{w:3.2,hazard:'spikes'});
  {const [x,z]=polar(4.6,600);rest(x,z,1.2);}

  // Zone 2 · switchbacks up the south face: east, a tall turn, west, back north.
  pad(1.5,-7,1.2);
  pad(5.1,-7,1.2,{surface:'ice'});
  pad(8.7,-7,1.2,{w:3,hazard:'sweep'});
  pad(8.7,-10.5,2.4,{need:'double'});
  pad(5.1,-10.5,1.2,{surface:'conveyor',belt:1.2});
  pad(1.5,-10.5,1.2,{motion:'moving',amp:.9});
  pad(-2.2,-10.5,1.2,{w:3,hazard:'pusher'});
  pad(-5.9,-10.5,1.2,{w:3,hazard:'wind'});
  pad(-5.9,-7.4,1.25,{motion:'blink',phase:60});
  rest(-10.3,-6.7,1.25);

  // Zone 3 · a long bridge north along the west side, then back at a higher level.
  // The bridge opens on a solid pad: a newcomer waits here for the lift instead of on a vanishing one.
  pad(-10.6,-3,1.4,{w:2.2,d:2.6});
  pad(-10.6,.6,.7,{motion:'lift',amp:3.2,period:400});
  pad(-10.6,4.2,4.4,{w:2.8,motion:'crumble'});
  pad(-10.6,7.7,.4,{surface:'spring'});
  pad(-10.6,11.1,4.4,{w:3,hazard:'pusher',hazDir:'right'});
  pad(-7.1,11.3,1,{w:3,motion:'shrink'});
  pad(-7.3,7.5,2.4,{w:2.4,need:'double'});
  pad(-7.3,3.6,1,{w:2.8,d:3.6,hazard:'laser'});
  pad(-7.3,-.3,1.1,{w:2.4,motion:'moving',amp:1,period:300});
  rest(-7.6,-4.2,1.2);

  // Zone 4 · square staircase: clockwise outside, back through the inside, out again.
  pad(-4.6,-.2,1.25);
  pad(-4.6,4.6,1.25,{motion:'orbit',amp:.9});
  pad(0,4.8,1.25);
  pad(4.6,4.6,1.25,{w:3,hazard:'hammer'});
  pad(2.1,2.1,1.25,{w:2.2});
  pad(-2.1,2.1,1.25,{w:2.8,hazard:'saw'});
  pad(-2.1,-2.1,1.25,{w:3,hazard:'flame'});
  pad(-4.9,-4.9,1.25);
  pad(0,-4.9,1.25,{w:3,hazard:'cannon'});
  rest(5.2,-5.2,1.25);

  // Zone 5 · leaps across the centre (a five-pointed star) joined by rim hops.
  ring(4.5,-45,1.2,{w:2.4,surface:'ice',motion:'moving',amp:.5});
  ring(4.5,99,1.45,{need:'double'});
  ring(4.5,171,1.1,{w:2.4,surface:'conveyor',belt:1.4,hazard:'spikes'});
  ring(4.5,315,1.45,{need:'double',surface:'ice',hazard:'spikes',w:2.8});
  ring(4.5,27,1.1,{w:2.6,motion:'moving',amp:.7,hazard:'wind',power:1.6});
  ring(4.5,171,1.45,{need:'double',surface:'conveyor',belt:1.5,dir:'back',hazard:'flame',w:2.8});
  ring(4.5,243,1.1,{w:2.6,surface:'ice',hazard:'pusher'});
  ring(4.5,27,1.45,{need:'double',motion:'blink',period:240});
  ring(4.5,99,1.1,{w:2.4,surface:'conveyor',belt:1.6,dir:'left',hazard:'hammer'});
  {const [x,z]=polar(4.7,243);rest(x,z,1.45,{need:'double'});}

  // Zone 6 · a narrow shaft: small pads on four corners, straight across with a tall double jump, then back
  // on the diagonal. The same corner comes round only every fourth floor, so a miss has nothing to land on.
  pad(-3.3,-6.3,1.4,{w:1.8,motion:'moving',amp:.5,dir:[0,1]});
  pad(-.5,-6.3,2.4,{w:1.8,need:'double',motion:'blink'});
  pad(-3.3,-8.7,1.5,{w:1.8,motion:'crumble',surface:'ice'});
  pad(-.5,-8.7,2.5,{w:2.4,need:'double',motion:'shrink',amp:.6});
  pad(-3.3,-6.3,1.5,{w:1.9,surface:'ice',hazard:'wind',hazDir:[0,1],power:1.6});
  pad(-.5,-6.3,1.4,{w:1.9,motion:'lift',amp:3,period:280});
  // No crumbling here: with nothing underneath, a pad that drops away while the next one is blinked out would be a coin toss.
  pad(-3.3,-8.7,4.2,{w:1.9,surface:'conveyor',belt:1.3,dir:'back',hazard:'spikes'});
  pad(-.5,-8.7,2.5,{w:1.8,need:'double',motion:'blink',phase:150});
  pad(-3.3,-6.3,1.6,{w:1.9,motion:'moving',amp:.5,dir:[0,1],hazard:'laser'});
  rest(-1.8,-10.9,2.3,{need:'double'});

  // Zone 7 · S curves: the path swings in toward the tower and back out on small pads, with two long leaps.
  const ridge:readonly (readonly [number,number])[]=[[10.36,-73.4],[9.6,-50],[7,6],[10.2,28],[6.8,48],[10,68],[6.4,96],[10.6,150],[7.4,170]];
  const s=(index:number,rise:number,o:PadOptions={})=>ring(ridge[index-1]![0],ridge[index-1]![1],rise,{w:2.2,...o});
  s(1,1.2,{w:1.8,motion:'blink',hazard:'wind',power:1.7});
  s(2,1.2,{w:1.8,surface:'conveyor',belt:1.5,hazard:'hammer'});
  s(3,1.3,{need:'double',hazard:'cannon',hazDir:'back',power:5,w:2.6});
  s(4,1.2,{w:2,surface:'ice',hazard:'saw'});
  s(5,1.2,{motion:'moving',amp:.8,hazard:'flame',w:2.6});
  s(6,1.2,{surface:'spring'});
  s(7,4.5,{w:2.6});
  s(8,1.3,{need:'double',surface:'conveyor',belt:1.6,dir:'back',hazard:'laser',w:2.6});
  s(9,1.2,{motion:'orbit',amp:.8,hazard:'spikes',w:2.6});
  ring(7.6,198.6,1.3,{w:4.2,rest:true});

  // Zone 8 · reverse spiral: short hops alternate with long double jumps, hazards on consecutive pads.
  const r=(degrees:number,rise:number,o:PadOptions={})=>ring(6.8,degrees,rise,{w:2,...o});
  r(162,1.3,{motion:'blink',hazard:'spikes',w:2.3});
  r(92,1.3,{need:'double',surface:'ice',hazard:'sweep',power:1.4,w:2.6});
  r(56,1.3,{motion:'crumble'});
  r(-14,1.3,{need:'double',motion:'crumble',hazard:'flame',w:2.4});
  r(-50,1.3,{motion:'moving',amp:1.1,period:280,hazard:'laser',w:2.4});
  r(-120,1.3,{need:'double',motion:'shrink',amp:.55,w:2.8});
  r(-156,1.3,{surface:'conveyor',belt:1.8,dir:'back',hazard:'pusher',w:2.4});
  r(-226,1.3,{need:'double',motion:'orbit',amp:.7,hazard:'saw',w:2.4});
  r(-262,1.3,{surface:'ice',hazard:'wind',power:2.2});
  ring(6.6,16,1.3,{w:4.2,rest:true,need:'double'});

  // Zone 9 · scattered stepping stones. Stone by stone is the safe way round; JUMP_SHORTCUTS lists the leaps that skip two.
  pad(10.6,2.6,1.2,{w:2.2});
  pad(12.89,6.19,1,{w:1.7,motion:'moving',amp:.6,hazard:'saw'});
  pad(9.7,9.3,.9,{w:1.8,hazard:'wind',power:1.8});
  pad(6.51,5.97,.9,{w:1.8,surface:'ice',hazard:'spikes'});
  pad(2.55,8.83,1.2,{w:2.2,hazard:'flame'});
  pad(.35,12.57,1,{w:1.7,motion:'crumble',surface:'ice'});
  pad(4.31,13.01,.9,{w:1.7,surface:'conveyor',belt:1.6,dir:'left',hazard:'laser'});
  pad(7.61,10.15,.9,{w:1.9,motion:'shrink',amp:.62,hazard:'sweep',power:1.3});
  pad(9.15,13.01,2.5,{w:1.7,need:'double',motion:'blink',period:240,phase:30});
  rest(12.6,8.6,1.3);

  // Zone 10 · final gauntlet down the east side and in to the summit at the centre.
  pad(12.4,-.2,1.3,{w:2,need:'double',motion:'moving',amp:.9,period:260,hazard:'saw'});
  pad(10.6,-7.4,1.3,{w:2.2,need:'double',surface:'ice',hazard:'sweep',power:1.5});
  // 93 is the one steady foothold of the stretch. 94, the lift and its hammer share one rhythm: whenever 94
  // is there to stand on, the lift is on its way down and the hammer is out at the side; the hammer crosses
  // once while the lift carries its rider up and is away again at the top. Reading, not luck.
  pad(8.2,-5,1.3,{w:1.8,motion:'moving',amp:.7,period:300});
  pad(4.6,-6,1.3,{w:1.8,motion:'blink',period:260,phase:92});
  pad(1,-6.6,1.2,{w:2.8,motion:'lift',amp:3,period:260,phase:0,hazard:'hammer',hazardPeriod:260,hazardPhase:45});
  pad(-2.6,-5,4.2,{w:2.2,surface:'conveyor',belt:1.8,dir:'back',hazard:'laser'});
  pad(-6.8,1.6,1.3,{w:2.4,need:'double',motion:'shrink',amp:.6,hazard:'flame'});
  pad(-3.6,5.4,.6,{w:2,surface:'spring'});
  pad(1,7.4,4.5,{w:2.2,motion:'orbit',amp:.6,hazard:'spikes'});
  // The summit stands too high for the spring on 98 to reach: the last pad cannot be skipped.
  pad(0,0,2.7,{w:5,rest:true,need:'double'});
  return platforms;
}
export const JUMP_COURSE:readonly JumpPlatform[]=makeCourse();
export const getJumpCourse=()=>JUMP_COURSE;

const modulo=(value:number,by:number)=>((value%by)+by)%by;
const smooth=(t:number)=>t*t*(3-2*t);
const within=(u:number,from:number,to:number)=>u>=from&&u<to;
function liftWave(u:number){
  const {dwellLow,travel,dwellHigh}=JUMP_TIMING.lift,top=dwellLow+travel,down=top+dwellHigh;
  return u<dwellLow?0:u<top?smooth((u-dwellLow)/travel):u<down?1:u<down+travel?1-smooth((u-down)/travel):0;
}
function shrinkScale(u:number,minimum:number){
  const t=JUMP_TIMING.shrink;
  return u<t.shrinkAt?1:u<t.smallAt?1-(1-minimum)*(u-t.shrinkAt)/(t.smallAt-t.shrinkAt):u<t.growAt?minimum:u<t.fullAt?minimum+(1-minimum)*(u-t.growAt)/(t.fullAt-t.growAt):1;
}

/** Everything the renderer, the effects and the simulation need to know about one pad at one tick. */
export function getJumpPlatformView(platform:JumpPlatform,tick:number,state?:Pick<JumpState,'crumbleAt'>):JumpPlatformView{
  const p=platform;
  const view:JumpPlatformView={x:p.x,y:p.y,z:p.z,width:p.width,depth:p.depth,active:true,warning:false,padWarning:false,hazardWarning:false,hazardActive:false,scale:1,liftT:0,orbitAngle:0,sweepAngle:0,windX:0,windZ:0,pusherExtension:0,pushX:0,pushZ:0,pusherX:p.x,pusherZ:p.z,beltX:p.dirX*p.belt,beltZ:p.dirZ*p.belt,hazardX:p.x,hazardY:p.y,hazardZ:p.z,hazardAngle:0,hazardMove:0,hazardDirX:p.hazDirX,hazardDirZ:p.hazDirZ,flameSide:0,flameWarnSide:0};
  if(p.motion!=='static'){
    const u=p.period?modulo(tick+p.phase,Math.abs(p.period))/Math.abs(p.period):0;
    if(p.motion==='moving'){const offset=sinTurns(u)*p.amplitude;view.x+=p.dirX*offset;view.z+=p.dirZ*offset;}
    else if(p.motion==='lift'){view.liftT=liftWave(u);view.y+=p.amplitude*view.liftT;}
    else if(p.motion==='orbit'){const turns=p.period<0?-u:u;view.orbitAngle=turns*TAU;view.x+=cosTurns(turns)*p.amplitude;view.z+=sinTurns(turns)*p.amplitude;}
    else if(p.motion==='blink'){view.padWarning=within(u,JUMP_TIMING.blink.warnAt,JUMP_TIMING.blink.offAt);view.active=u<JUMP_TIMING.blink.offAt;}
    else if(p.motion==='crumble'){
      const started=state?.crumbleAt[String(p.floor)];
      if(started!==undefined){const age=tick-started,t=JUMP_TIMING.crumble;view.padWarning=age>=t.warnAt&&age<t.fallAt;view.active=age<t.fallAt||age>=t.respawnAt;}
    }else if(p.motion==='shrink'){
      view.scale=shrinkScale(u,p.amplitude);view.width*=view.scale;view.depth*=view.scale;
      view.padWarning=within(u,JUMP_TIMING.shrink.warnAt,JUMP_TIMING.shrink.smallAt);
    }
  }
  view.pusherX=view.hazardX=view.x;view.pusherZ=view.hazardZ=view.z;view.hazardY=view.y;
  if(p.hazard){
    const hx=p.hazDirX,hz=p.hazDirZ,raw=tick+p.hazardPhase,u=p.hazardPeriod?modulo(raw,p.hazardPeriod)/p.hazardPeriod:0,length=extent(p,hx,hz);
    if(p.hazard==='spikes'){const t=JUMP_TIMING.spikes;view.hazardWarning=within(u,t.warnAt,t.onAt);view.hazardActive=within(u,t.onAt,t.offAt);}
    else if(p.hazard==='sweep'){view.hazardActive=true;view.sweepAngle=raw*SECONDS*p.power;view.hazardAngle=view.sweepAngle;view.hazardMove=p.power;}
    else if(p.hazard==='pusher'){
      const t=JUMP_TIMING.pusher;
      view.pushX=hx;view.pushZ=hz;view.hazardWarning=within(u,t.warnAt,t.onAt);view.hazardActive=within(u,t.onAt,t.offAt);
      view.pusherExtension=!view.hazardActive?0:u<t.outAt?(u-t.onAt)/(t.outAt-t.onAt):u<t.holdAt?1:(t.offAt-u)/(t.offAt-t.holdAt);
      const half=length/2,travel=-half-.16+view.pusherExtension*(half+.46);
      view.pusherX=view.hazardX=view.x+hx*travel;view.pusherZ=view.hazardZ=view.z+hz*travel;
    }else if(p.hazard==='wind'){
      const t=JUMP_TIMING.wind;
      view.hazardWarning=within(u,t.warnAt,t.onAt);view.hazardActive=within(u,t.onAt,t.offAt);
      if(view.hazardActive){const gust=p.power*Math.min(1,(u-t.onAt)/t.ramp,(t.offAt-u)/t.ramp);view.windX=hx*gust;view.windZ=hz*gust;}
    }else if(p.hazard==='hammer'){
      const offset=sinTurns(u)*p.power;
      view.hazardActive=true;view.hazardX=view.x+hx*offset;view.hazardZ=view.z+hz*offset;view.hazardY=view.y+JUMP_TIMING.hammer.headY;
      // The swing angle is for drawing only; nothing in the simulation reads it.
      view.hazardAngle=Math.asin(Math.max(-1,Math.min(1,offset/JUMP_TIMING.hammer.arm)));view.hazardMove=cosTurns(u)*p.power*TAU/(p.hazardPeriod*SECONDS);
    }else if(p.hazard==='laser'){
      const reach=Math.max(0,length/2-JUMP_TIMING.laser.inset),offset=sinTurns(u)*reach;
      view.hazardActive=true;view.hazardX=view.x+hx*offset;view.hazardZ=view.z+hz*offset;view.hazardMove=cosTurns(u)*reach*TAU/(p.hazardPeriod*SECONDS);
    }else if(p.hazard==='saw'){
      const reach=Math.max(0,length/2-JUMP_TIMING.saw.inset),triangle=u<.5?u*4-1:3-u*4;
      view.hazardActive=true;view.hazardX=view.x+hx*triangle*reach;view.hazardZ=view.z+hz*triangle*reach;view.hazardMove=(u<.5?1:-1)*reach*4/(p.hazardPeriod*SECONDS);
    }else if(p.hazard==='cannon'){
      const t=JUMP_TIMING.cannon,age=modulo(raw,p.hazardPeriod),travel=age*SECONDS*t.speed,start=-length/2-t.muzzle;
      view.hazardActive=travel<=p.power;view.hazardWarning=age>=p.hazardPeriod-t.warnTicks;view.hazardMove=view.hazardActive?t.speed:0;
      const along=start+(view.hazardActive?travel:0);
      view.hazardX=view.x+hx*along;view.hazardZ=view.z+hz*along;view.hazardY=view.y+t.shotY;
    }else if(p.hazard==='flame'){
      const t=JUMP_TIMING.flame;
      view.flameWarnSide=within(u,t.warnA,t.onA)?-1:within(u,t.warnB,t.onB)?1:0;view.flameSide=within(u,t.onA,t.offA)?-1:within(u,t.onB,t.offB)?1:0;
      view.hazardWarning=view.flameWarnSide!==0;view.hazardActive=view.flameSide!==0;
    }
  }
  view.warning=view.padWarning||view.hazardWarning;
  return view;
}

/** Static envelopes: where a pad, its wind and its hazard can ever be. They keep
 * the per-tick work to the handful of pads near the player. */
interface Reach {minX:number;maxX:number;minZ:number;maxZ:number;minY:number;maxY:number}
function reachOf(p:JumpPlatform):Reach {
  const moveX=p.motion==='moving'?Math.abs(p.dirX)*p.amplitude:p.motion==='orbit'?p.amplitude:0,moveZ=p.motion==='moving'?Math.abs(p.dirZ)*p.amplitude:p.motion==='orbit'?p.amplitude:0;
  let minX=p.x-moveX-p.width/2,maxX=p.x+moveX+p.width/2,minZ=p.z-moveZ-p.depth/2,maxZ=p.z+moveZ+p.depth/2;
  const grow=(x:number,z:number,radius:number)=>{minX=Math.min(minX,x-radius);maxX=Math.max(maxX,x+radius);minZ=Math.min(minZ,z-radius);maxZ=Math.max(maxZ,z+radius);};
  const length=extent(p,p.hazDirX,p.hazDirZ);
  if(p.hazard==='wind'){minX-=JUMP_TIMING.wind.margin;maxX+=JUMP_TIMING.wind.margin;minZ-=JUMP_TIMING.wind.margin;maxZ+=JUMP_TIMING.wind.margin;}
  else if(p.hazard==='hammer')for(const side of [-1,1])for(const [x,z] of [[p.x-moveX,p.z-moveZ],[p.x+moveX,p.z+moveZ]])grow(x+p.hazDirX*p.power*side,z+p.hazDirZ*p.power*side,.7);
  else if(p.hazard==='cannon')for(const along of [-length/2-JUMP_TIMING.cannon.muzzle,-length/2-JUMP_TIMING.cannon.muzzle+p.power])for(const [x,z] of [[p.x-moveX,p.z-moveZ],[p.x+moveX,p.z+moveZ]])grow(x+p.hazDirX*along,z+p.hazDirZ*along,JUMP_TIMING.cannon.radius+.1);
  return{minX:minX-.1,maxX:maxX+.1,minZ:minZ-.1,maxZ:maxZ+.1,minY:p.y-2.2,maxY:p.y+(p.motion==='lift'?p.amplitude:0)+2.2};
}
const REACH:readonly Reach[]=JUMP_COURSE.map(reachOf);
/** Envelope of one pad including its hazard and wind, for layout checks and culling. */
export const getJumpPlatformReach=(floor:number):Readonly<Reach>=>REACH[floor]!;
const BUCKET=2,BUCKET_OFFSET=Math.ceil((JUMP_RULES.fallDepth+4)/BUCKET);
const BUCKETS:number[][]=[];
for(const p of JUMP_COURSE){
  const reach=REACH[p.floor]!;
  for(let bucket=Math.floor(reach.minY/BUCKET)+BUCKET_OFFSET;bucket<=Math.floor(reach.maxY/BUCKET)+BUCKET_OFFSET;bucket++)if(bucket>=0)(BUCKETS[bucket]??=[]).push(p.floor);
}
const NONE:readonly number[]=[];
function nearby(y:number):readonly number[] {return BUCKETS[Math.floor(y/BUCKET)+BUCKET_OFFSET]??NONE;}

/** A new run always begins on the ground pad. */
export function createJumpState(tick=0):JumpState{return createJumpStateOn(0,tick);}
/** Standing in the middle of a pad at an arena tick: fixtures, previews and recovery after a server restart. */
export function createJumpStateOn(floor:number,tick=0):JumpState{
  const index=Number.isSafeInteger(floor)?Math.max(0,Math.min(JUMP_RULES.floors,floor)):0,clock=Number.isSafeInteger(tick)&&tick>=0?tick:0;
  const view=getJumpPlatformView(JUMP_COURSE[index]!,clock);
  return{x:view.x,y:view.y,z:view.z,vx:0,vy:0,vz:0,tick:clock,grounded:true,jumps:0,jumpHeld:false,lastJumpTick:clock-100,standingFloor:index,floor:index,lastFloor:index,fallFrom:view.y,deaths:0,status:index===JUMP_RULES.floors?'complete':'playing',crumbleAt:{},invulnerableUntil:clock+JUMP_RULES.spawnInvulnerabilityTicks,lastHitTick:-1,lastHitKind:null,knockbackUntil:0,lastBounceTick:-1};
}
/** States from the sixty-floor tower or a truncated payload gain safe defaults. */
function upgrade(previous:JumpState):JumpState {
  const state={...previous};
  state.lastHitTick??=-1;state.lastHitKind??=null;state.knockbackUntil??=0;state.lastBounceTick??=-1;state.crumbleAt??={};
  if(!Number.isSafeInteger(state.floor)||state.floor<0||state.floor>JUMP_RULES.floors)state.floor=0;
  if(state.standingFloor!==null&&(!Number.isSafeInteger(state.standingFloor)||state.standingFloor<0||state.standingFloor>JUMP_RULES.floors))state.standingFloor=null;
  if(!Number.isSafeInteger(state.lastFloor)||state.lastFloor<0||state.lastFloor>JUMP_RULES.floors)state.lastFloor=state.standingFloor??0;
  if(!Number.isFinite(state.fallFrom))state.fallFrom=state.y;
  return state;
}
/** Move a state to a later arena tick without playing the ticks in between; a rider is carried by a
 * moving, lifting or orbiting pad. Gameplay must use `settleJumpState`: this skips gravity and every
 * trap, so it is only for previews and for the remainder of a very long absence. */
export function alignJumpClock(previous:JumpState,targetTick:number):JumpState{
  const tick=Number.isSafeInteger(targetTick)?Math.max(previous.tick,targetTick):previous.tick;
  if(tick===previous.tick)return previous;
  const state={...previous,tick,crumbleAt:{...previous.crumbleAt}};
  const platform=previous.standingFloor===null?undefined:JUMP_COURSE[previous.standingFloor];
  if(previous.grounded&&platform&&platform.motion!=='static'){
    const before=getJumpPlatformView(platform,previous.tick,previous),after=getJumpPlatformView(platform,tick,state);
    state.x+=after.x-before.x;state.z+=after.z-before.z;state.y+=after.y-before.y;state.fallFrom=state.y;
  }
  return state;
}
const restingOn=(state:JumpState)=>state.grounded&&state.standingFloor!==null&&JUMP_COURSE[state.standingFloor]!.rest&&state.vx===0&&state.vz===0;
/** The tower never pauses. Whenever a climber's clock is behind the arena (a pause menu, a hidden tab,
 * a stalled or closed connection, a sleeping server) the missing ticks are played with no input:
 * gravity, moving pads and every trap apply, so pausing in mid-air is a fall and pausing on a trap
 * is a hit. Rest pads are the place to stop. Only the first `settleTicks` are played one by one;
 * by then an idle climber is somewhere stable and the remainder moves the clock alone. */
export function settleJumpState(previous:JumpState,targetTick:number):{state:JumpState;landedFloor:number|null;died:boolean}{
  let state=previous,landedFloor:number|null=null,died=false;
  if(!Number.isSafeInteger(targetTick)||targetTick<=state.tick)return{state,landedFloor,died};
  for(let played=0;state.tick<targetTick&&played<JUMP_RULES.settleTicks&&state.status==='playing'&&!restingOn(state);played++){
    const result=stepJumpState(state,{seq:0,x:0,z:0,jump:false});state=result.state;died ||= result.died;
    if(result.landedFloor!==null)landedFloor=Math.max(landedFloor??0,result.landedFloor);
  }
  return{state:alignJumpClock(state,targetTick),landedFloor,died};
}
/** The void sends the player back to the ground pad; only the fall count survives. */
export function respawnJumpState(previous:JumpState):JumpState{
  const result=createJumpState(previous.tick);result.deaths=(previous.deaths||0)+1;return result;
}
const inside=(x:number,z:number,p:JumpPlatformView,margin=JUMP_RULES.playerRadius*.35)=>Math.abs(x-p.x)<=p.width/2+margin&&Math.abs(z-p.z)<=p.depth/2+margin;
const approach=(value:number,target:number,amount:number)=>value<target?Math.min(target,value+amount):Math.max(target,value-amount);
const HIT_SPEED:Record<JumpHitKind,number>={spikes:5.3,sweep:5.7,pusher:6.1,hammer:6.4,laser:4.8,saw:5.5,cannon:5.8,flame:5};
const HIT_LIFT:Record<JumpHitKind,number>={spikes:6.4,sweep:5.5,pusher:5.5,hammer:5.8,laser:5.2,saw:5.5,cannon:5.5,flame:6};
let hitX=0,hitZ=0;
/** Contact test of one pad's hazard. Floor hazards need a standing player; the hammer and cannon shots are volumes. */
function contact(p:JumpPlatform,view:JumpPlatformView,state:JumpState,standing:boolean):JumpHitKind|null {
  const hx=p.hazDirX,hz=p.hazDirZ,dx=state.x-view.x,dz=state.z-view.z;
  if(p.hazard==='hammer'||p.hazard==='cannon'){
    const rx=state.x-view.hazardX,rz=state.z-view.hazardZ,height=state.y-view.y;
    if(p.hazard==='hammer'){
      const t=JUMP_TIMING.hammer;
      if(height<-.1||height>=t.height||Math.abs(rx*hx+rz*hz)>=t.halfLength||Math.abs(-rx*hz+rz*hx)>=t.halfWidth)return null;
      const side=view.hazardMove<0?-1:1;hitX=hx*side;hitZ=hz*side;return 'hammer';
    }
    if(!view.hazardActive||height<=-.9||height>=.8||rx*rx+rz*rz>=JUMP_TIMING.cannon.radius*JUMP_TIMING.cannon.radius)return null;
    hitX=hx;hitZ=hz;return 'cannon';
  }
  if(!standing||!view.hazardActive)return null;
  const along=dx*hx+dz*hz,across=-dx*hz+dz*hx;
  if(p.hazard==='spikes'){
    // Red spikes occupy a strip across the path; the margins before and after it remain usable.
    if(Math.abs(along)>=extent(p,hx,hz)*JUMP_TIMING.spikes.strip||Math.abs(across)>=extent(p,-hz,hx)*JUMP_TIMING.spikes.span)return null;
    const side=along<0?-1:1;hitX=hx*side;hitZ=hz*side;return 'spikes';
  }
  if(p.hazard==='sweep'){
    // The bar turns on a hub: the very middle of the pad, the natural place to land, is always safe.
    const t=JUMP_TIMING.sweep;if(dx*dx+dz*dz<t.hub*t.hub)return null;
    const cos=cosTurns(view.sweepAngle/TAU),sin=sinTurns(view.sweepAngle/TAU),bar=dx*cos+dz*sin,off=-dx*sin+dz*cos;
    if(Math.abs(bar)>=Math.min(p.width,p.depth)*t.reach||Math.abs(off)>=t.halfThickness)return null;
    const side=bar<0?-1:1;hitX=-sin*side;hitZ=cos*side;return 'sweep';
  }
  if(p.hazard==='pusher'){
    const px=state.x-view.pusherX,pz=state.z-view.pusherZ;
    if(Math.abs(px*hx+pz*hz)>=.3||Math.abs(-px*hz+pz*hx)>=Math.min(p.width,p.depth)*.34)return null;
    hitX=hx;hitZ=hz;return 'pusher';
  }
  if(p.hazard==='laser'){
    const rx=state.x-view.hazardX,rz=state.z-view.hazardZ;
    if(Math.abs(rx*hx+rz*hz)>=JUMP_TIMING.laser.halfWidth)return null;
    const side=view.hazardMove<0?-1:1;hitX=hx*side;hitZ=hz*side;return 'laser';
  }
  if(p.hazard==='saw'){
    const rx=state.x-view.hazardX,rz=state.z-view.hazardZ,off=-rx*hz+rz*hx;
    if(Math.abs(rx*hx+rz*hz)>=JUMP_TIMING.saw.radius||Math.abs(off)>=JUMP_TIMING.saw.radius)return null;
    const side=off<0?-1:1;hitX=-hz*side;hitZ=hx*side;return 'saw';
  }
  if(p.hazard==='flame'){
    if(along*view.flameSide<=JUMP_TIMING.flame.seam)return null;
    hitX=-hx*view.flameSide;hitZ=-hz*view.flameSide;return 'flame';
  }
  return null;
}

/** Pure fixed-step simulation shared by browser prediction and the authority.
 * Inputs never contain a position, a floor, a clock delta, or a point amount. */
export function stepJumpState(previous:JumpState,input:JumpInput):{state:JumpState;landedFloor:number|null;died:boolean}{
  const state=upgrade(previous);state.tick++;
  if(state.status==='complete'){state.jumpHeld=input.jump;return{state,landedFloor:null,died:false};}
  const dt=SECONDS,standing=state.standingFloor===null?undefined:JUMP_COURSE[state.standingFloor];
  let under:JumpPlatformView|null=null;
  if(state.grounded&&standing){
    under=getJumpPlatformView(standing,state.tick,state);
    if(standing.motion!=='static'){
      const before=getJumpPlatformView(standing,previous.tick,state);
      state.x+=under.x-before.x;state.z+=under.z-before.z;state.y=under.y;
    }
    if(!under.active||!inside(state.x,state.z,under)){state.grounded=false;state.standingFloor=null;state.jumps=Math.max(1,state.jumps);under=null;}
  }else if(state.grounded){state.grounded=false;state.standingFloor=null;state.jumps=Math.max(1,state.jumps);}
  const pressed=input.jump&&!previous.jumpHeld;state.jumpHeld=input.jump;
  if(pressed&&state.jumps<2&&state.tick-state.lastJumpTick>=JUMP_RULES.minJumpTicks){state.vy=JUMP_RULES.jumpVelocity;state.grounded=false;state.standingFloor=null;state.jumps++;state.lastJumpTick=state.tick;under=null;}
  let x=Number.isFinite(input.x)?Math.max(-1,Math.min(1,input.x)):0,z=Number.isFinite(input.z)?Math.max(-1,Math.min(1,input.z)):0;
  const magnitude=length2(x,z);if(magnitude>1){x/=magnitude;z/=magnitude;}
  const onIce=state.grounded&&standing?.surface==='ice';
  const acceleration=state.tick<state.knockbackUntil?3.5:onIce?(magnitude>.01?6:1.2):state.grounded?30:22;
  state.vx=approach(state.vx,x*JUMP_RULES.speed,acceleration*dt);state.vz=approach(state.vz,z*JUMP_RULES.speed,acceleration*dt);
  if(state.grounded&&under&&standing!.belt){state.x+=under.beltX*dt;state.z+=under.beltZ*dt;}
  const close=nearby(state.y);
  // Surface airflow carries even an idle player. Treating it as a tiny input
  // acceleration would let the normal braking cancel the gust every tick.
  for(const floor of close){
    const platform=JUMP_COURSE[floor]!;if(platform.hazard!=='wind')continue;
    const reach=REACH[floor]!;if(state.x<reach.minX||state.x>reach.maxX||state.z<reach.minZ||state.z>reach.maxZ)continue;
    const view=getJumpPlatformView(platform,state.tick,state);
    if(view.hazardActive&&Math.abs(state.y-view.y)<JUMP_TIMING.wind.height&&inside(state.x,state.z,view,JUMP_TIMING.wind.margin)){state.x+=view.windX*dt;state.z+=view.windZ*dt;}
  }
  state.x+=state.vx*dt;state.z+=state.vz*dt;
  const oldY=state.y;
  if(!state.grounded){state.vy-=JUMP_RULES.gravity*dt;state.y+=state.vy*dt;}
  else if(under&&!inside(state.x,state.z,under)){state.grounded=false;state.standingFloor=null;state.jumps=Math.max(1,state.jumps);}
  let landedFloor:number|null=null;
  if(!state.grounded&&state.vy<=0){
    // Check every physically crossed surface near this height, not only the next
    // floor: a reachable pad must never be visually solid but non-collidable.
    let best=-1,bestY=-Infinity,bestView:JumpPlatformView|null=null;
    for(const floor of close){
      const reach=REACH[floor]!;if(state.x<reach.minX||state.x>reach.maxX||state.z<reach.minZ||state.z>reach.maxZ)continue;
      const platform=JUMP_COURSE[floor]!,view=getJumpPlatformView(platform,state.tick,state);
      // A rising lift may meet a slowly falling player: compare with where its deck was.
      const deck=platform.motion==='lift'?Math.min(view.y,getJumpPlatformView(platform,state.tick-1,state).y):view.y;
      if(!view.active||oldY<deck-.001||state.y>view.y||!inside(state.x,state.z,view))continue;
      if(view.y>bestY||view.y===bestY&&floor>best){best=floor;bestY=view.y;bestView=view;}
    }
    if(bestView){
      const platform=JUMP_COURSE[best]!;
      state.y=bestView.y;state.vy=0;state.grounded=true;state.jumps=0;state.standingFloor=best;state.lastFloor=best;
      // The knockback flight outlasts the protection a hit gives. The first landing after a hit renews it
      // briefly, so a trap cannot strike again before the player can move. `invulnerableUntil` still holding
      // the value the hit gave it is what marks that first landing.
      if(state.lastHitTick>=0&&state.invulnerableUntil===state.lastHitTick+JUMP_RULES.hitInvulnerabilityTicks&&state.tick-state.lastHitTick<=JUMP_RULES.recoveryWindowTicks)state.invulnerableUntil=Math.max(state.invulnerableUntil+1,state.tick+JUMP_RULES.recoveryTicks);
      if(platform.motion==='crumble'){
        const started=state.crumbleAt[String(best)];
        if(started===undefined||state.tick-started>=JUMP_TIMING.crumble.respawnAt){
          const crumbleAt:Record<string,number>={};
          for(const key in state.crumbleAt)if(state.tick-state.crumbleAt[key]!<JUMP_TIMING.crumble.respawnAt)crumbleAt[key]=state.crumbleAt[key]!;
          crumbleAt[String(best)]=state.tick;state.crumbleAt=crumbleAt;
        }
      }
      if(best>state.floor){state.floor=best;landedFloor=best;if(best===JUMP_RULES.floors)state.status='complete';}
    }
  }
  if(state.grounded)state.fallFrom=state.y;
  // A spring never lets anyone rest: touching it launches the rider with one air jump left.
  if(state.grounded&&state.standingFloor!==null&&JUMP_COURSE[state.standingFloor]!.surface==='spring'&&state.status==='playing'){
    state.vy=JUMP_RULES.springVelocity;state.grounded=false;state.standingFloor=null;state.jumps=1;state.lastJumpTick=state.tick;state.lastBounceTick=state.tick;
  }
  let hit:JumpHitKind|null=null;
  if(state.tick>=state.invulnerableUntil&&state.status==='playing'){
    if(state.standingFloor!==null){
      const platform=JUMP_COURSE[state.standingFloor]!;
      if(platform.hazard&&platform.hazard!=='wind')hit=contact(platform,getJumpPlatformView(platform,state.tick,state),state,true);
    }
    if(!hit)for(const floor of close){
      const platform=JUMP_COURSE[floor]!;if(platform.hazard!=='hammer'&&platform.hazard!=='cannon'||floor===state.standingFloor)continue;
      const reach=REACH[floor]!;if(state.x<reach.minX||state.x>reach.maxX||state.z<reach.minZ||state.z>reach.maxZ)continue;
      hit=contact(platform,getJumpPlatformView(platform,state.tick,state),state,false);if(hit)break;
    }
  }
  if(hit){
    // Contact throws the player into ordinary air physics. Steering returns
    // gradually and one aerial jump remains available to recover onto a pad.
    state.vx=hitX*HIT_SPEED[hit]+0;state.vz=hitZ*HIT_SPEED[hit]+0;state.vy=HIT_LIFT[hit];
    state.y+=.025;state.grounded=false;state.standingFloor=null;state.jumps=1;state.jumpHeld=input.jump;
    state.lastJumpTick=state.tick;state.lastHitTick=state.tick;state.lastHitKind=hit;
    state.knockbackUntil=state.tick+JUMP_RULES.knockbackTicks;state.invulnerableUntil=state.tick+JUMP_RULES.hitInvulnerabilityTicks;
  }
  // Landing on any lower pad is only a setback. The run restarts from the
  // ground pad once the player is far below the pad last stood on, or outside.
  if(state.y<state.fallFrom-JUMP_RULES.fallDepth||Math.abs(state.x)>JUMP_RULES.bounds||Math.abs(state.z)>JUMP_RULES.bounds||!Number.isFinite(state.x+state.y+state.z))return{state:respawnJumpState(state),landedFloor:null,died:true};
  return{state,landedFloor,died:false};
}
