import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJumpState,getJumpPlatformView,JUMP_COURSE,JUMP_RULES,stepJumpState,type JumpState,type JumpPlatformKind,type JumpHitKind} from '../shared/jump-game';

const step=(state:JumpState,x=0,z=0,jump=false)=>stepJumpState(state,{seq:state.tick+1,x,z,jump});
function onPlatform(kind:JumpPlatformKind,tick=400):JumpState {
  const platform=JUMP_COURSE.find(p=>p.kind===kind)!;
  return {...createJumpState(Math.floor(platform.floor/10)*10,tick),x:platform.x,y:platform.y,z:platform.z,standingFloor:platform.floor,floor:platform.floor,invulnerableUntil:0};
}
function contactState(kind:JumpHitKind) {
  const state=onPlatform(kind),platform=JUMP_COURSE[state.floor]!;
  const phase=kind==='spikes'?130:kind==='pusher'?142:0,period=kind==='pusher'?220:200;
  state.tick=kind==='sweep'?400:(phase-platform.phase+period*3)%period-1;
  state.lastJumpTick=state.tick-100;
  if(kind==='pusher'){const view=getJumpPlatformView(platform,state.tick+1,state);state.x=view.pusherX;state.z=view.pusherZ;}
  return state;
}

test('physical traps throw sideways and upwards without deleting height, checkpoint or progress',()=>{
  for(const kind of ['spikes','sweep','pusher'] as const){
    const before=contactState(kind),{state,died}=step(before);
    assert.equal(died,false,kind);assert.equal(state.deaths,before.deaths);assert.equal(state.floor,before.floor);assert.equal(state.checkpoint,before.checkpoint);
    assert.equal(state.x,before.x);assert.equal(state.z,before.z);assert.ok(state.y>=before.y&&state.y<before.y+.1);
    assert.equal(state.lastHitKind,kind);assert.equal(state.lastHitTick,before.tick+1);assert.equal(state.grounded,false);assert.equal(state.standingFloor,null);
    assert.ok(Math.hypot(state.vx,state.vz)>5);assert.ok(state.vy>5);assert.equal(state.jumps,1);
    assert.equal(state.knockbackUntil-state.tick,JUMP_RULES.knockbackTicks);assert.equal(state.invulnerableUntil-state.tick,JUMP_RULES.hitInvulnerabilityTicks);
  }
});

test('opposite steering cannot instantly cancel recoil and a second jump remains available',()=>{
  for(const kind of ['spikes','sweep','pusher'] as const){
    const hit=step(contactState(kind)).state;let state=hit;
    const length=Math.hypot(hit.vx,hit.vz),dx=hit.vx/length,dz=hit.vz/length;
    for(let tick=0;tick<10;tick++){const result=step(state,-dx,-dz);state=result.state;assert.equal(result.died,false);}
    assert.ok((state.x-hit.x)*dx+(state.z-hit.z)*dz>.6,kind);
    assert.ok(state.vx*dx+state.vz*dz>4,kind);
    const recovered=step(state,-dx,-dz,true).state;assert.equal(recovered.jumps,2);assert.ok(recovered.vy>7);
  }
});

test('brief immunity prevents repeated throws while a hazard stays active',()=>{
  const before=contactState('spikes'),hit=step(before).state;
  let contact={...hit,x:before.x,y:before.y,z:before.z,vx:0,vy:0,vz:0,grounded:true,standingFloor:before.standingFloor};
  for(let i=0;i<12;i++){contact=step(contact).state;assert.equal(contact.lastHitTick,hit.lastHitTick);assert.equal(contact.grounded,true);}
  const later={...before,tick:before.tick+200,lastHitTick:hit.lastHitTick,lastHitKind:hit.lastHitKind,invulnerableUntil:hit.invulnerableUntil};
  assert.equal(step(later).state.lastHitTick,later.tick+1);
});

test('piston warning precedes its stroke and a side route or jump avoids contact',()=>{
  const platform=JUMP_COURSE.find(p=>p.kind==='pusher')!,tick=(phase:number)=>(phase-platform.phase+660)%220;
  const warning=getJumpPlatformView(platform,tick(115));assert.equal(warning.warning,true);assert.equal(warning.hazardActive,false);assert.equal(warning.pusherExtension,0);
  const extended=getJumpPlatformView(platform,tick(142));assert.equal(extended.hazardActive,true);assert.equal(extended.pusherExtension,1);
  const retracted=getJumpPlatformView(platform,tick(180));assert.equal(retracted.hazardActive,false);assert.equal(retracted.pusherExtension,0);
  const state=contactState('pusher'),view=getJumpPlatformView(platform,state.tick+1,state);
  assert.equal(step(state,0,0,true).state.lastHitKind,null);
  const side={...state,x:state.x-view.pushZ*platform.width*.43,z:state.z+view.pushX*platform.depth*.43};
  assert.equal(step(side).state.lastHitKind,null);
});

test('conveyor carries an idle character, can be counter-steered and stops acting after takeoff',()=>{
  const start=onPlatform('conveyor'),platform=JUMP_COURSE[start.floor]!,view=getJumpPlatformView(platform,start.tick,start);
  let state=start;for(let i=0;i<25;i++)state=step(state).state;
  assert.ok(Math.abs(state.x-start.x-view.beltX*.5)<1e-9);assert.ok(Math.abs(state.z-start.z-view.beltZ*.5)<1e-9);assert.equal(state.grounded,true);
  const speed=Math.hypot(view.beltX,view.beltZ),dx=view.beltX/speed,dz=view.beltZ/speed;
  state=start;for(let i=0;i<12;i++)state=step(state,-dx,-dz).state;
  assert.ok((state.x-start.x)*dx+(state.z-start.z)*dz<0,'opposing direction must beat the belt');
  const air=step(start,0,0,true).state;assert.equal(air.x,start.x);assert.equal(air.z,start.z);assert.equal(air.grounded,false);
});

test('ice preserves momentum after release yet permits braking and jumping',()=>{
  let state={...onPlatform('ice'),vx:3};const start=state;
  for(let i=0;i<10;i++)state=step(state).state;
  assert.ok(state.vx>2.7);assert.ok(state.x-start.x>.5);assert.equal(state.grounded,true);
  const slow=step(state,-1,0).state;assert.ok(slow.vx<state.vx-.1);
  const air=step(slow,0,0,true).state;assert.equal(air.grounded,false);assert.ok(air.vy>7);
});

test('wind visibly carries idle and airborne players while normal directional input can oppose it',()=>{
  const start=onPlatform('wind'),platform=JUMP_COURSE[start.floor]!;
  let state=start;for(let i=0;i<25;i++)state=step(state).state;
  assert.ok(Math.hypot(state.x-start.x,state.z-start.z)>.3,'half a second of wind must create visible displacement');
  assert.equal(state.deaths,0);
  const view=getJumpPlatformView(platform,start.tick+1,start),length=Math.hypot(view.windX,view.windZ);
  state=start;for(let i=0;i<12;i++)state=step(state,-view.windX/length,-view.windZ/length).state;
  assert.ok((state.x-start.x)*view.windX+(state.z-start.z)*view.windZ<0,'walking into the wind must overcome it');
  const air=step(start,0,0,true).state;assert.equal(air.grounded,false);assert.ok(Math.hypot(air.x-start.x,air.z-start.z)>.01);
});

test('vanishing surfaces begin a real fall, and only leaving the course resets to the checkpoint',()=>{
  for(const kind of ['blink','crumble'] as const){
    let state=onPlatform(kind),platform=JUMP_COURSE[state.floor]!;
    if(kind==='blink')state.tick=(155-platform.phase+600)%200-1;
    else{state.tick=154;state.crumbleAt[String(platform.floor)]=100;}
    const result=step(state);assert.equal(result.died,false);assert.equal(result.state.grounded,false);assert.ok(result.state.y<platform.y);assert.equal(result.state.floor,state.floor);
  }
  const start={...createJumpState(30,1000),floor:34,x:0,y:JUMP_COURSE[30]!.y-5.1,z:0,grounded:false,standingFloor:null};
  const fallen=step(start);assert.equal(fallen.died,true);assert.equal(fallen.state.checkpoint,30);assert.equal(fallen.state.standingFloor,30);assert.equal(fallen.state.y,JUMP_COURSE[30]!.y);assert.equal(fallen.state.lastHitKind,null);
});

test('recoil remains deterministic and accepts snapshots from before reaction fields existed',()=>{
  let a=contactState('pusher'),b=structuredClone(a);
  for(let i=0;i<80;i++){const jump=i===9;a=step(a,i>12?-1:0,0,jump).state;b=step(b,i>12?-1:0,0,jump).state;assert.deepEqual(a,b);}
  const old={...createJumpState()} as Partial<JumpState>;delete old.lastHitTick;delete old.lastHitKind;delete old.knockbackUntil;
  const recovered=step(old as JumpState).state;assert.equal(recovered.lastHitKind,null);assert.equal(recovered.lastHitTick,-1);assert.equal(recovered.knockbackUntil,0);
});
