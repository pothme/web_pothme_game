import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {settleJumpState,alignJumpClock,createJumpState,createJumpStateOn,getJumpPlatformReach,getJumpPlatformView,JUMP_COURSE,JUMP_HIT_KINDS,JUMP_PLATFORM_KINDS,JUMP_RULES,JUMP_TIMING,stepJumpState,type JumpState,type JumpPlatform,type JumpPlatformView} from '../shared/jump-game';
import {findContact} from './jump-solver';

const step=(state:JumpState,x=0,z=0,jump=false)=>stepJumpState(state,{seq:state.tick+1,x,z,jump});
const SECOND=1000/JUMP_RULES.stepMs;
/** First pad that carries a mechanic and nothing else. */
function only(kind:string):JumpPlatform {
  const platform=JUMP_COURSE.find(p=>[p.motion,p.surface,p.hazard].includes(kind as never)&&[p.motion!=='static',p.surface!=='plain',p.hazard!==null].filter(Boolean).length===1);
  assert.ok(platform,`${kind} must have a pad of its own`);return platform;
}
const standing=(platform:JumpPlatform,tick=400):JumpState=>({...createJumpStateOn(platform.floor,tick),invulnerableUntil:0});
const cycle=(platform:JumpPlatform)=>Math.max(300,Math.abs(platform.period),platform.hazardPeriod)*3;
/** Tick at which a condition on the view first becomes true after being false. */
function rising(platform:JumpPlatform,test:(view:JumpPlatformView)=>boolean,from=0){
  let tick=from;while(test(getJumpPlatformView(platform,tick)))tick++;while(!test(getJumpPlatformView(platform,tick)))tick++;return tick;
}

test('every platform kind has a complete, finite view on every tick, inside its own envelope',()=>{
  const seen=new Set<string>();
  for(const platform of JUMP_COURSE){
    seen.add(platform.kind);
    const reach=getJumpPlatformReach(platform.floor),state={crumbleAt:{[platform.floor]:40}};
    for(let tick=0;tick<cycle(platform);tick+=platform.floor%3+1){
      const view=getJumpPlatformView(platform,tick,tick%2?state:undefined);
      for(const [key,value] of Object.entries(view)){
        if(typeof value==='boolean')continue;
        assert.equal(typeof value,'number',`${platform.floor}.${key}`);assert.ok(Number.isFinite(value),`floor ${platform.floor} ${platform.kind} ${key} at tick ${tick}`);
      }
      assert.equal(Object.keys(view).length,32,'the view always has the same shape');
      assert.ok(view.width>0&&view.depth>0&&view.scale>0&&view.scale<=1);assert.equal(view.warning,view.padWarning||view.hazardWarning);
      assert.ok(view.x-view.width/2>=reach.minX&&view.x+view.width/2<=reach.maxX&&view.z-view.depth/2>=reach.minZ&&view.z+view.depth/2<=reach.maxZ,`floor ${platform.floor} leaves its envelope`);
      assert.ok(view.hazardX>=reach.minX-.8&&view.hazardX<=reach.maxX+.8&&view.hazardZ>=reach.minZ-.8&&view.hazardZ<=reach.maxZ+.8,`floor ${platform.floor} hazard leaves its envelope`);
      assert.ok(view.y>=platform.y&&view.y<=platform.y+(platform.motion==='lift'?platform.amplitude:0)+1e-9);
      assert.ok([-1,0,1].includes(view.flameSide)&&[-1,0,1].includes(view.flameWarnSide));
      if(!platform.hazard){assert.equal(view.hazardActive,false);assert.equal(view.hazardWarning,false);}
      if(platform.motion==='static'){assert.equal(view.active,true);assert.equal(view.padWarning,false);assert.equal(view.x,platform.x);assert.equal(view.z,platform.z);}
    }
    // The view is a pure function of the tick.
    assert.deepEqual(getJumpPlatformView(platform,777),getJumpPlatformView(platform,777));
    assert.deepEqual(getJumpPlatformView(platform,777+cycle(platform)*1000),getJumpPlatformView(platform,777+cycle(platform)*1000));
  }
  assert.deepEqual([...seen].sort(),[...JUMP_PLATFORM_KINDS].sort());
  assert.ok(JUMP_PLATFORM_KINDS.length>=10+6,'at least six kinds beyond the original ten');
});

test('no hazard strikes without a readable warning window, and no surface vanishes unannounced',()=>{
  const WARNING=Math.round(.5*SECOND);
  for(const platform of JUMP_COURSE){
    const span=cycle(platform);
    if(platform.hazard==='spikes'||platform.hazard==='pusher'||platform.hazard==='wind'||platform.hazard==='cannon'||platform.hazard==='flame'){
      let strikes=0;
      for(let tick=1;tick<span;tick++){
        const view=getJumpPlatformView(platform,tick),before=getJumpPlatformView(platform,tick-1);
        const starts=platform.hazard==='flame'?view.flameSide!==0&&before.flameSide!==view.flameSide:view.hazardActive&&!before.hazardActive;
        if(!starts||tick<WARNING)continue;
        strikes++;
        for(let back=1;back<=WARNING;back++){
          const earlier=getJumpPlatformView(platform,tick-back);
          assert.equal(earlier.hazardWarning,true,`floor ${platform.floor} ${platform.hazard} strikes ${back} ticks after silence`);
          if(platform.hazard==='flame')assert.equal(earlier.flameWarnSide,view.flameSide,'the half that is about to burn is the one that glows');
          else assert.equal(earlier.hazardActive,false);
        }
      }
      assert.ok(strikes>=2,`floor ${platform.floor} ${platform.hazard} must cycle`);
      // And it rests: a standing player gets a real chance between strikes.
      let quiet=0,longest=0;for(let tick=0;tick<span;tick++){quiet=getJumpPlatformView(platform,tick).hazardActive?0:quiet+1;longest=Math.max(longest,quiet);}
      assert.ok(longest>=SECOND,`floor ${platform.floor} ${platform.hazard} pauses for at least a second`);
    }
    if(platform.hazard==='sweep'||platform.hazard==='hammer'||platform.hazard==='laser'||platform.hazard==='saw'){
      // Always-on hazards telegraph by moving in plain sight: continuously and never faster than a run.
      for(let tick=1;tick<span;tick++){
        const view=getJumpPlatformView(platform,tick),before=getJumpPlatformView(platform,tick-1);
        assert.equal(view.hazardActive,true);
        if(platform.hazard==='sweep')assert.ok(Math.abs(view.sweepAngle-before.sweepAngle)*SECOND<=1.8,'a sweeper turns slowly enough to read');
        else{
          const moved=Math.hypot(view.hazardX-before.hazardX-(view.x-before.x),view.hazardZ-before.hazardZ-(view.z-before.z));
          assert.ok(moved*SECOND<=JUMP_RULES.speed*1.05,`floor ${platform.floor} ${platform.hazard} outruns the player`);
          assert.ok(Math.abs(Math.abs(view.hazardMove)-moved*SECOND)<1.2||moved===0,'hazardMove reports the real speed');
        }
      }
    }
    if(platform.motion==='blink'||platform.motion==='shrink'){
      let events=0;
      for(let tick=WARNING;tick<span;tick++){
        const view=getJumpPlatformView(platform,tick),before=getJumpPlatformView(platform,tick-1);
        const starts=platform.motion==='blink'?!view.active&&before.active:view.scale<1&&before.scale===1;
        if(!starts)continue;events++;
        for(let back=1;back<=WARNING-5;back++)assert.equal(getJumpPlatformView(platform,tick-back).padWarning,true,`floor ${platform.floor} ${platform.motion} changes ${back} ticks after silence`);
      }
      assert.ok(events>=2);
      if(platform.motion==='blink'){let on=0;for(let tick=0;tick<Math.abs(platform.period);tick++)if(getJumpPlatformView(platform,tick).active)on++;assert.ok(on>=SECOND*1.8,'a blinking pad stays solid long enough to cross');}
    }
    if(platform.motion==='crumble'){
      const state={crumbleAt:{[platform.floor]:1000}},t=JUMP_TIMING.crumble;
      assert.equal(getJumpPlatformView(platform,1000+t.warnAt-1,state).padWarning,false);
      for(let age=t.warnAt;age<t.fallAt;age++){const view=getJumpPlatformView(platform,1000+age,state);assert.equal(view.padWarning,true);assert.equal(view.active,true);}
      assert.ok(t.fallAt-t.warnAt>=WARNING&&t.fallAt>=SECOND*.8,'there is time to leave a crumbling pad');
      assert.equal(getJumpPlatformView(platform,1000+t.fallAt,state).active,false);assert.equal(getJumpPlatformView(platform,1000+t.respawnAt,state).active,true);
      assert.equal(getJumpPlatformView(platform,1000+t.fallAt).active,true,'a pad nobody stepped on never falls');
    }
  }
});

test('all eight impacts throw sideways and upwards without deleting height or progress, and a fall is never a hit',()=>{
  assert.equal(JUMP_HIT_KINDS.length,8);
  for(const kind of JUMP_HIT_KINDS){
    const {state:before,after:state,platform}=findContact(kind);
    assert.equal(state.deaths,before.deaths,kind);assert.equal(state.floor,before.floor);assert.equal(state.lastFloor,platform.floor);
    assert.equal(state.x,before.x);assert.equal(state.z,before.z);assert.ok(state.y>=before.y&&state.y<before.y+.1);
    assert.equal(state.lastHitKind,kind);assert.equal(state.lastHitTick,before.tick+1);assert.equal(state.grounded,false);assert.equal(state.standingFloor,null);
    assert.ok(Math.hypot(state.vx,state.vz)>4.5,kind);assert.ok(state.vy>5);assert.equal(state.jumps,1);
    assert.equal(state.knockbackUntil-state.tick,JUMP_RULES.knockbackTicks);assert.equal(state.invulnerableUntil-state.tick,JUMP_RULES.hitInvulnerabilityTicks);
    // Opposite steering cannot instantly cancel the recoil, and a second jump remains available.
    const length=Math.hypot(state.vx,state.vz),dx=state.vx/length,dz=state.vz/length;let flight=state;
    for(let tick=0;tick<10;tick++){const result=step(flight,-dx,-dz);flight=result.state;assert.equal(result.died,false);}
    assert.ok((flight.x-state.x)*dx+(flight.z-state.z)*dz>.55,kind);assert.ok(flight.vx*dx+flight.vz*dz>3.5,kind);
    if(flight.lastHitTick===state.lastHitTick){const recovered=step(flight,-dx,-dz,true).state;assert.equal(recovered.jumps,2);assert.ok(recovered.vy>7);}
    // Brief immunity prevents repeated throws while the hazard stays in contact.
    let contact={...state,x:before.x,y:before.y,z:before.z,vx:0,vy:0,vz:0,grounded:true,standingFloor:before.standingFloor};
    for(let i=0;i<12;i++){contact=step(contact).state;assert.equal(contact.lastHitTick,state.lastHitTick,kind);}
    // The same contact with spawn protection is harmless.
    assert.equal(step({...before,invulnerableUntil:before.tick+10}).state.lastHitKind,null);
    // The sum of the throw is deterministic.
    assert.deepEqual(step(structuredClone(before)).state,state);
  }
});

test('floor hazards can be jumped, the hammer and the cannon shot can be sidestepped or waited out',()=>{
  for(const kind of ['spikes','sweep','pusher','laser','saw','flame'] as const){
    const {state,platform}=findContact(kind);
    const jumped=step(state,0,0,true);assert.equal(jumped.died,false);assert.equal(jumped.state.lastHitKind,null,`${kind} is avoidable with a jump`);
    let air=jumped.state;for(let i=0;i<20&&!air.grounded;i++){air=step(air).state;assert.equal(air.lastHitKind,null,`${kind} must not reach an airborne player`);}
    assert.equal(platform.hazard,kind);
  }
  // Spikes, pusher, saw and flame leave part of the pad safe for a whole cycle.
  for(const kind of ['spikes','pusher','saw','flame'] as const){
    const platform=only(kind),span=platform.hazardPeriod*2;
    const spots=[[.42,0],[-.42,0],[0,.42],[0,-.42]].filter(([fx,fz])=>{
      for(const from of kind==='flame'?[0]:[0,span/2]){
        let state=standing(platform,400+from);state.x+=fx!*platform.width;state.z+=fz!*platform.depth;
        for(let tick=0;tick<(kind==='flame'?JUMP_TIMING.flame.onB*platform.hazardPeriod-5:span);tick++){state=step(state).state;if(state.lastHitKind)return false;}
      }
      return true;
    });
    if(kind!=='flame')assert.ok(spots.length>=1,`${kind} leaves a safe place to stand`);
  }
  // Flame alternates halves: moving to the other half in the warning window avoids both bursts.
  const flame=only('flame');let state=standing(flame,rising(flame,view=>view.flameWarnSide===-1));
  state.x+=flame.hazDirX*flame.width*.3;state.z+=flame.hazDirZ*flame.depth*.3;
  for(let tick=0;tick<flame.hazardPeriod;tick++){
    const ahead=getJumpPlatformView(flame,state.tick+12),side=ahead.flameSide||ahead.flameWarnSide,target=side===0?0:-side*.3;
    const along=(state.x-flame.x)*flame.hazDirX+(state.z-flame.z)*flame.hazDirZ,push=Math.max(-1,Math.min(1,(target*flame.width-along)*3));
    state=step(state,flame.hazDirX*push,flame.hazDirZ*push).state;assert.equal(state.lastHitKind,null,`flame at tick ${tick}`);assert.equal(state.standingFloor,flame.floor);
  }
  // Hammer: off its swing line nothing happens; on the line it hits, and it also hits a low hop.
  const hammer=only('hammer'),beside=standing(hammer);beside.x+=-hammer.hazDirZ*hammer.width*.4;beside.z+=hammer.hazDirX*hammer.depth*.4;
  let safe=beside;for(let tick=0;tick<hammer.hazardPeriod*2;tick++){safe=step(safe).state;assert.equal(safe.lastHitKind,null);}
  const struck=findContact('hammer').state,hop=step({...struck,y:struck.y+.6,grounded:false,standingFloor:null,vy:0});
  assert.equal(hop.state.lastHitKind,'hammer','the hammer head is a volume, not a floor trap');
  assert.equal(step({...struck,y:struck.y+JUMP_TIMING.hammer.height+.2,grounded:false,standingFloor:null,vy:0}).state.lastHitKind,null);
  // Cannon: a shot hits a low flyer too, passes under a high one, and never touches someone beside its line.
  const {state:shot,platform:cannon}=findContact('cannon');
  assert.equal(step({...shot,y:shot.y+.5,grounded:false,standingFloor:null,vy:0}).state.lastHitKind,'cannon');
  assert.equal(step({...shot,y:shot.y+1.4,grounded:false,standingFloor:null,vy:2}).state.lastHitKind,null);
  let aside=standing(cannon);aside.x+=-cannon.hazDirZ*cannon.width*.4;aside.z+=cannon.hazDirX*cannon.depth*.4;
  for(let tick=0;tick<cannon.hazardPeriod*2;tick++){aside=step(aside).state;assert.equal(aside.lastHitKind,null);}
  const t=JUMP_TIMING.cannon,fire=rising(cannon,view=>view.hazardActive),muzzle=getJumpPlatformView(cannon,fire),later=getJumpPlatformView(cannon,fire+25);
  assert.ok(Math.abs(Math.hypot(later.hazardX-muzzle.hazardX,later.hazardZ-muzzle.hazardZ)-t.speed*25/SECOND)<1e-9,'shots fly at a fixed slow speed');
  assert.ok(t.speed<JUMP_RULES.speed,'a shot is slower than a running player');
  assert.equal(getJumpPlatformView(cannon,fire+Math.ceil(cannon.power/t.speed*SECOND)+1).hazardActive,false,'a shot expires at its range');
});

test('piston warning precedes its stroke and a side route or jump avoids contact',()=>{
  const platform=only('pusher'),warn=rising(platform,view=>view.hazardWarning),strike=rising(platform,view=>view.hazardActive,warn);
  const warning=getJumpPlatformView(platform,warn+5);assert.equal(warning.hazardActive,false);assert.equal(warning.pusherExtension,0);
  let peak=0;for(let tick=strike;getJumpPlatformView(platform,tick).hazardActive;tick++)peak=Math.max(peak,getJumpPlatformView(platform,tick).pusherExtension);
  assert.equal(peak,1);assert.equal(getJumpPlatformView(platform,strike+60).pusherExtension,0);
  const {state}=findContact('pusher'),view=getJumpPlatformView(platform,state.tick+1,state);
  assert.equal(step(state,0,0,true).state.lastHitKind,null);
  const side={...state,x:view.pusherX-view.pushZ*platform.width*.43,z:view.pusherZ+view.pushX*platform.depth*.43};
  assert.equal(step(side).state.lastHitKind,null);
});

test('conveyor carries an idle character, can be counter-steered and stops acting after takeoff',()=>{
  const platform=only('conveyor'),start=standing(platform),view=getJumpPlatformView(platform,start.tick,start);
  assert.ok(Math.abs(Math.hypot(view.beltX,view.beltZ)-platform.belt)<1e-9&&platform.belt>=1);
  let state=start;for(let i=0;i<25;i++)state=step(state).state;
  assert.ok(Math.abs(state.x-start.x-view.beltX*.5)<1e-9);assert.ok(Math.abs(state.z-start.z-view.beltZ*.5)<1e-9);assert.equal(state.grounded,true);
  const speed=Math.hypot(view.beltX,view.beltZ),dx=view.beltX/speed,dz=view.beltZ/speed;
  state=start;for(let i=0;i<12;i++)state=step(state,-dx,-dz).state;
  assert.ok((state.x-start.x)*dx+(state.z-start.z)*dz<0,'opposing direction must beat the belt');
  const air=step(start,0,0,true).state;assert.equal(air.x,start.x);assert.equal(air.z,start.z);assert.equal(air.grounded,false);
  for(const belt of JUMP_COURSE.filter(p=>p.surface==='conveyor'))assert.ok(belt.belt<JUMP_RULES.speed*.5,'no belt is stronger than half a run');
});

test('ice preserves momentum after release yet permits braking and jumping',()=>{
  let state={...standing(only('ice')),vx:3};const start=state;
  for(let i=0;i<10;i++)state=step(state).state;
  assert.ok(state.vx>2.7);assert.ok(state.x-start.x>.5);assert.equal(state.grounded,true);
  const slow=step(state,-1,0).state;assert.ok(slow.vx<state.vx-.1);
  const air=step(slow,0,0,true).state;assert.equal(air.grounded,false);assert.ok(air.vy>7);
});

test('wind blows in announced gusts, carries idle and airborne players, and can be walked against',()=>{
  const platform=only('wind'),gust=rising(platform,view=>view.hazardActive)+Math.ceil(JUMP_TIMING.wind.ramp*platform.hazardPeriod)+1;
  const start=standing(platform,gust),view=getJumpPlatformView(platform,gust+1),length=Math.hypot(view.windX,view.windZ);
  assert.ok(Math.abs(length-platform.power)<1e-9,'a gust reaches its full strength');assert.ok(length<JUMP_RULES.speed*.6);
  let state=start;for(let i=0;i<25;i++)state=step(state).state;
  assert.ok(Math.hypot(state.x-start.x,state.z-start.z)>.3,'half a second of wind must create visible displacement');assert.equal(state.deaths,0);
  state=start;for(let i=0;i<12;i++)state=step(state,-view.windX/length,-view.windZ/length).state;
  assert.ok((state.x-start.x)*view.windX+(state.z-start.z)*view.windZ<0,'walking into the wind must overcome it');
  const air=step(start,0,0,true).state;assert.equal(air.grounded,false);assert.ok(Math.hypot(air.x-start.x,air.z-start.z)>.01);
  // Between gusts the pad is an ordinary pad, and the wind stops a little above and beside it.
  const calm=rising(platform,candidate=>!candidate.hazardActive&&!candidate.hazardWarning,gust);
  let still=standing(platform,calm);for(let i=0;i<20;i++)still=step(still).state;
  assert.equal(still.x,platform.x);assert.equal(still.z,platform.z);
  const high=step({...start,y:start.y+JUMP_TIMING.wind.height+.5,grounded:false,standingFloor:null,vy:0}).state;assert.equal(high.x,start.x);assert.equal(high.z,start.z);
  const far=step({...start,x:start.x+platform.width/2+JUMP_TIMING.wind.margin+.3,y:start.y+.5,grounded:false,standingFloor:null,vy:0}).state;assert.equal(far.z,start.z);
});

test('moving, orbiting and lifting pads carry a standing rider exactly, without drift or death',()=>{
  for(const platform of JUMP_COURSE.filter(p=>(p.motion==='moving'||p.motion==='orbit'||p.motion==='lift')&&p.surface==='plain'&&p.hazard!=='wind')){
    let state={...standing(platform,250),invulnerableUntil:1e9};
    const offsetX=.3,offsetZ=-.2;state.x+=offsetX;state.z+=offsetZ;
    let low=Infinity,high=-Infinity;
    for(let tick=0;tick<Math.abs(platform.period)+40;tick++){
      const result=step(state);state=result.state;
      const view=getJumpPlatformView(platform,state.tick,state);
      assert.equal(result.died,false);assert.equal(state.standingFloor,platform.floor,`${platform.motion} pad ${platform.floor} dropped its rider`);
      assert.ok(Math.hypot(state.x-view.x-offsetX,state.z-view.z-offsetZ)<1e-8);assert.equal(state.y,view.y);assert.equal(state.fallFrom,view.y);assert.equal(state.vy,0);
      low=Math.min(low,view.y);high=Math.max(high,view.y);
    }
    if(platform.motion==='lift')assert.ok(Math.abs(high-low-platform.amplitude)<1e-6,'a lift travels its full height');
    else assert.equal(high,low);
  }
  // A lift waits at both ends, so its top is a platform and not an instant.
  const lift=only('lift'),t=JUMP_TIMING.lift;let top=0,bottom=0;
  for(let tick=0;tick<lift.period;tick++){const view=getJumpPlatformView(lift,tick);if(view.liftT===1)top++;if(view.liftT===0)bottom++;}
  assert.ok(top>=t.dwellHigh*lift.period-2&&top>=SECOND*.7);assert.ok(bottom>=SECOND*.7);
  let fastest=0;for(let tick=1;tick<lift.period;tick++)fastest=Math.max(fastest,Math.abs(getJumpPlatformView(lift,tick).y-getJumpPlatformView(lift,tick-1).y)*SECOND);
  assert.ok(fastest<3,'a lift is slower than a jump');
  // Landing on a lift works while it rises and while it sinks.
  for(const rise of [true,false]){
    const tick=rising(lift,view=>rise?view.liftT>.3&&view.liftT<.5&&getJumpPlatformView(lift,1).y>=0:view.liftT>.5&&view.liftT<.7,rise?0:rising(lift,view=>view.liftT===1));
    const moving=getJumpPlatformView(lift,tick+1).y-getJumpPlatformView(lift,tick).y;
    if(rise)assert.ok(moving>0);else assert.ok(moving<0);
    let state:JumpState={...createJumpStateOn(lift.floor-1,tick),x:lift.x,z:lift.z,y:getJumpPlatformView(lift,tick).y+.4,vy:0,grounded:false,standingFloor:null};
    for(let i=0;i<30&&!state.grounded;i++)state=step(state).state;
    assert.equal(state.standingFloor,lift.floor,`landing on a ${rise?'rising':'sinking'} lift`);assert.equal(state.y,getJumpPlatformView(lift,state.tick).y);
  }
  // Shared-clock alignment carries a rider vertically too.
  const rider=standing(lift,rising(lift,view=>view.liftT===0)),aligned=alignJumpClock(rider,rider.tick+Math.round(lift.period*(t.dwellLow+t.travel))+2);
  assert.ok(aligned.y>rider.y+lift.amplitude*.9);assert.equal(aligned.fallFrom,aligned.y);assert.equal(aligned.x,rider.x);
  // An orbiting pad travels a full circle around its pivot.
  const orbit=only('orbit'),angles=new Set<number>();
  for(let tick=0;tick<Math.abs(orbit.period);tick+=5){const view=getJumpPlatformView(orbit,tick);assert.ok(Math.abs(Math.hypot(view.x-orbit.x,view.z-orbit.z)-orbit.amplitude)<1e-9);angles.add(Math.floor(Math.atan2(view.z-orbit.z,view.x-orbit.x)/(Math.PI/4)));}
  assert.equal(angles.size,8);
});

test('a spring launches whoever touches it, high enough for the pad it serves, with one air jump left',()=>{
  const springs=JUMP_COURSE.filter(platform=>platform.surface==='spring');assert.ok(springs.length>=3);
  for(const platform of springs){
    let state:JumpState={...createJumpStateOn(platform.floor-1,300),x:platform.x,z:platform.z,y:platform.y+.5,vy:-2,grounded:false,standingFloor:null,jumps:2,floor:platform.floor-1};
    let landed:number|null=null;
    while(state.lastBounceTick<0){const result=step(state);state=result.state;landed??=result.landedFloor;}
    assert.equal(landed,platform.floor,'touching the spring counts as reaching its floor');
    assert.equal(state.vy,JUMP_RULES.springVelocity);assert.equal(state.grounded,false);assert.equal(state.standingFloor,null);assert.equal(state.lastFloor,platform.floor);assert.equal(state.jumps,1);assert.equal(state.lastBounceTick,state.tick);
    let apex=state.y,flight=state;for(let i=0;i<120;i++){flight=step(flight).state;apex=Math.max(apex,flight.y);if(flight.lastBounceTick!==state.tick)break;}
    assert.ok(Math.abs(apex-platform.y-JUMP_RULES.springVelocity**2/(2*JUMP_RULES.gravity))<.2);
    assert.ok(apex>JUMP_COURSE[platform.floor+1]!.y+.3,'the launch clears the next pad');
    assert.notEqual(flight.lastBounceTick,state.tick,'coming back down bounces again: nobody rests on a spring');
    const boosted=step(step(step(step(state).state).state).state,0,0,true).state;assert.equal(boosted.jumps,2);assert.ok(boosted.vy>7&&boosted.vy<=JUMP_RULES.jumpVelocity);
  }
  let state=createJumpStateOn(springs[0]!.floor,500);state=step(state).state;
  assert.equal(state.grounded,false);assert.equal(state.vy,JUMP_RULES.springVelocity);
});

test('vanishing and shrinking surfaces begin a real fall instead of a reset',()=>{
  const blink=only('blink'),off=rising(blink,view=>!view.active);
  let result=step(standing(blink,off-1));
  assert.equal(result.died,false);assert.equal(result.state.grounded,false);assert.ok(result.state.y<blink.y);assert.equal(result.state.floor,blink.floor);assert.equal(result.state.jumps,1,'one air jump is left to recover');
  const crumble=only('crumble'),landing:JumpState={...createJumpStateOn(crumble.floor-1,600),x:crumble.x,z:crumble.z,y:crumble.y+.02,vy:-1,grounded:false,standingFloor:null};
  let state=step(landing).state;assert.equal(state.standingFloor,crumble.floor);assert.equal(state.crumbleAt[String(crumble.floor)],state.tick);
  for(let i=0;i<JUMP_TIMING.crumble.fallAt-1;i++){state=step(state).state;assert.equal(state.standingFloor,crumble.floor);}
  result=step(state);assert.equal(result.state.grounded,false);assert.equal(result.died,false);
  assert.equal(getJumpPlatformView(crumble,state.tick+JUMP_TIMING.crumble.respawnAt,state).active,true);
  // A shrinking pad drops a rider at its rim and keeps one at its centre through the whole cycle.
  const shrink=only('shrink'),full=rising(shrink,view=>view.scale===1,rising(shrink,view=>view.scale<1));
  let centre=standing(shrink,full),rim=standing(shrink,full);rim.x+=shrink.width*.46;
  let smallest=1,rimFell=false;
  for(let tick=0;tick<Math.abs(shrink.period);tick++){
    centre=step(centre).state;assert.equal(centre.standingFloor,shrink.floor);
    if(!rimFell){const stepped=step(rim);rim=stepped.state;assert.equal(stepped.died,false);rimFell=!rim.grounded;}
    smallest=Math.min(smallest,getJumpPlatformView(shrink,centre.tick).scale);
  }
  assert.equal(rimFell,true);assert.ok(Math.abs(smallest-shrink.amplitude)<1e-9);assert.ok(shrink.width*smallest>=1.1);
});

test('traps stay deterministic and accept snapshots from before the newer state fields existed',()=>{
  let a=findContact('pusher').state,b=structuredClone(a);
  for(let i=0;i<80;i++){const jump=i===9;a=step(a,i>12?-1:0,0,jump).state;b=step(b,i>12?-1:0,0,jump).state;assert.deepEqual(a,b);}
  const old={...createJumpState()} as Partial<JumpState>;delete old.lastHitTick;delete old.lastHitKind;delete old.knockbackUntil;delete old.lastBounceTick;delete old.lastFloor;delete old.fallFrom;
  const recovered=step(old as JumpState).state;
  assert.equal(recovered.lastHitKind,null);assert.equal(recovered.lastHitTick,-1);assert.equal(recovered.knockbackUntil,0);assert.equal(recovered.lastBounceTick,-1);assert.equal(recovered.lastFloor,0);assert.equal(recovered.fallFrom,0);
  assert.deepEqual(recovered,step(createJumpState()).state);
});

test('the tower never pauses: missing ticks are played with no input, so a pause dodges nothing',()=>{
  const neutral=(state:JumpState)=>stepJumpState(state,{seq:0,x:0,z:0,jump:false});
  // Same result as sending the empty frames one by one, including landings and deaths along the way.
  for(const [floor,tick,ticks] of [[9,400,260],[13,777,200],[34,1000,170],[56,300,400],[62,5,300],[95,90,500]] as const){
    let stepped=standing(JUMP_COURSE[floor]!,tick),died=false;
    for(let i=0;i<ticks;i++){const result=neutral(stepped);stepped=result.state;died ||= result.died;}
    const settled=settleJumpState(standing(JUMP_COURSE[floor]!,tick),tick+ticks);
    assert.deepEqual(settled.state,stepped,`floor ${floor}`);assert.equal(settled.died,died);
  }
  // Stopping in mid-air beside a pad is a fall, however long the pause.
  const pad=JUMP_COURSE[38]!,air:JumpState={...standing(pad,2000),x:pad.x+pad.width,y:pad.y+1,grounded:false,standingFloor:null,jumps:1,floor:38};
  for(const pause of [60,400,50_000]){
    const result=settleJumpState(air,air.tick+pause);
    assert.equal(result.died,true,`a pause of ${pause} ticks`);assert.equal(result.state.standingFloor,0);assert.equal(result.state.floor,0);assert.equal(result.state.deaths,1);assert.equal(result.state.tick,air.tick+pause);
  }
  assert.equal(settleJumpState(air,air.tick+10).died,false,'a pause shorter than the fall is only part of the fall');
  assert.ok(settleJumpState(air,air.tick+10).state.y<air.y);
  // Hanging above a blink pad that is gone does not wait for it to come back.
  const blink=only('blink'),gone=rising(blink,view=>!view.active),hang:JumpState={...standing(blink,gone),y:blink.y+.4,vy:-1,grounded:false,standingFloor:null,jumps:2};
  const back=rising(blink,view=>view.active,gone),dropped=settleJumpState(hang,back+20);
  assert.ok(dropped.state.standingFloor!==blink.floor,'the frozen climber does not land on the returning pad');
  assert.ok(dropped.died||dropped.state.y<blink.y-1);
  // Standing in a spike strip through a cycle is a hit, with or without frames.
  const {platform:spikes,state:before}=findContact('spikes'),idleStart={...before,tick:before.tick-60,invulnerableUntil:0};
  const struck=settleJumpState(idleStart,before.tick+2);
  assert.equal(struck.state.lastHitKind,'spikes');assert.equal(struck.state.lastHitTick,before.tick+1);assert.equal(spikes.hazard,'spikes');
  // A rest pad is where to stop: any wait changes nothing but the clock, and costs no simulation.
  for(const rest of JUMP_COURSE.filter(platform=>platform.rest)){
    const start={...standing(rest,123),x:rest.x+.8,z:rest.z-.6},waited=settleJumpState(start,123+3_000_000);
    assert.equal(waited.died,false);assert.deepEqual(waited.state,{...start,tick:123+3_000_000});
  }
  // A long absence anywhere is bounded work: the first settleTicks are played, the rest moves the clock.
  const rider=standing(only('moving'),50),far=settleJumpState(rider,50+10_000_000);
  assert.equal(far.state.tick,50+10_000_000);assert.equal(far.state.standingFloor,rider.standingFloor);assert.equal(far.died,false);
  const view=getJumpPlatformView(only('moving'),far.state.tick,far.state);assert.ok(Math.abs(far.state.x-view.x)<1e-6&&Math.abs(far.state.z-view.z)<1e-6,'the rider is still on the moving pad');
  // The clock never runs backwards, and a finished run only moves its clock.
  assert.strictEqual(settleJumpState(rider,rider.tick-5).state,rider);assert.strictEqual(settleJumpState(rider,Number.NaN).state,rider);
  const done=createJumpStateOn(JUMP_RULES.floors,10);assert.deepEqual(settleJumpState(done,500).state,{...done,tick:500});
  // A floor crossed while nobody sent input is reported, so the authority can pay it.
  const target=JUMP_COURSE[5]!,flying:JumpState={...standing(JUMP_COURSE[4]!,600),floor:4,lastFloor:4,x:target.x,z:target.z,y:target.y+.2,vy:-1,grounded:false,standingFloor:null,jumps:1,fallFrom:target.y};
  const landed=settleJumpState(flying,flying.tick+30);assert.equal(landed.landedFloor,5);assert.equal(landed.state.floor,5);
});

test('the first landing after a hit renews the protection, so no trap strikes twice before the player can move',()=>{
  const recovery=JUMP_RULES.recoveryTicks;assert.ok(recovery>=20&&recovery<=40);
  let checked=0;
  for(const kind of JUMP_HIT_KINDS){
    const {platform,after}=findContact(kind);
    // Fly back to the middle of the same pad, as a player steering home would, and land there.
    let state=after,landedAt=-1;
    for(let i=0;i<200&&landedAt<0;i++){
      const view=getJumpPlatformView(platform,state.tick,state),result=step(state,Math.max(-1,Math.min(1,(view.x-state.x)*2.3-state.vx*.14)),Math.max(-1,Math.min(1,(view.z-state.z)*2.3-state.vz*.14)));
      state=result.state;if(result.died)break;if(state.grounded)landedAt=state.tick;
    }
    if(landedAt<0||state.standingFloor!==platform.floor)continue;
    checked++;
    assert.ok(landedAt-after.lastHitTick>JUMP_RULES.hitInvulnerabilityTicks-recovery,`${kind}: the flight outlasts most of the protection a hit gives`);
    assert.ok(state.invulnerableUntil>=landedAt+recovery,`${kind}: protection is renewed on landing`);
    // Standing still on the trap for the whole recovery window is safe; afterwards the trap works again.
    for(let i=0;i<recovery-1;i++){state=step(state).state;assert.equal(state.lastHitTick,after.lastHitTick,`${kind} struck again ${i+1} ticks after landing`);}
    // The renewal happens once per hit: a second landing does not extend it again.
    const until=state.invulnerableUntil;let hop=step(state,0,0,true).state;
    for(let i=0;i<120&&!hop.grounded&&hop.lastHitTick===after.lastHitTick;i++)hop=step(hop).state;
    if(hop.grounded&&hop.lastHitTick===after.lastHitTick)assert.equal(hop.invulnerableUntil,until,`${kind}: no second renewal`);
  }
  assert.ok(checked>=4,`recoveries checked for ${checked} kinds`);
  // Protection is not a shield for good: a climber who stays in the strip is hit again by the next cycle.
  const {platform:spikes,after:hit}=findContact('spikes');
  let state:JumpState={...standing(spikes,hit.tick),x:hit.x,z:hit.z,lastHitTick:hit.tick-70,lastHitKind:'spikes',invulnerableUntil:hit.tick-70+JUMP_RULES.hitInvulnerabilityTicks+1};
  let again=false;for(let i=0;i<spikes.hazardPeriod+60&&!again;i++){state=step(state).state;again=state.lastHitTick>hit.tick;}
  assert.equal(again,true);
  // A fresh spawn is not a hit: landing during spawn protection changes nothing.
  const spawn=createJumpState(700),hopped=step(spawn,0,0,true).state;let down=hopped;while(!down.grounded)down=step(down).state;
  assert.equal(down.invulnerableUntil,spawn.invulnerableUntil);
});

test('a sweep bar turns on a hub: the middle of the pad is safe, everything else in its reach is not',()=>{
  const t=JUMP_TIMING.sweep;assert.ok(t.hub>=.2&&t.hub<=.35);
  const sweeps=JUMP_COURSE.filter(platform=>platform.hazard==='sweep');assert.ok(sweeps.length>=3);
  for(const pad of sweeps.filter(platform=>platform.motion==='static'&&platform.surface==='plain')){
    // Dead centre, and anywhere within the hub: never hit, through several turns.
    for(const [dx,dz] of [[0,0],[t.hub*.6,0],[0,-t.hub*.6],[t.hub*.5,t.hub*.5]] as const){
      let state:JumpState={...standing(pad),x:pad.x+dx,z:pad.z+dz};
      for(let i=0;i<700;i++){state=step(state).state;assert.equal(state.lastHitKind,null,`hub of floor ${pad.floor}`);}
      assert.equal(state.standingFloor,pad.floor);
    }
    // Just outside the hub the bar arrives within one turn.
    for(const radius of [t.hub+.1,Math.min(pad.width,pad.depth)*t.reach-.1]){
      let state:JumpState={...standing(pad),x:pad.x+radius},hit=false;
      for(let i=0;i<Math.ceil(Math.PI*2/(pad.power*JUMP_RULES.stepMs/1000))+5&&!hit;i++){state=step(state).state;hit=state.lastHitKind==='sweep';}
      assert.equal(hit,true,`radius ${radius} on floor ${pad.floor}`);
    }
  }
});

test('the simulation uses no engine-dependent maths: pad and trap positions are the same bits everywhere',()=>{
  const source=readFileSync(new URL('../shared/jump-game.ts',import.meta.url),'utf8');
  // Math.sin, cos, hypot and friends may differ in the last bit between engines. Only exactly specified
  // operations are allowed; Math.asin feeds a drawing-only angle.
  const used=new Set([...source.matchAll(/Math\.([a-zA-Z0-9]+)/g)].map(match=>match[1]));
  assert.deepEqual([...used].filter(name=>!['PI','abs','max','min','floor','ceil','sqrt','asin'].includes(name)),[]);
  assert.equal([...source.matchAll(/Math\.asin/g)].length,1);
  // The replacement is still a sine: positions agree with the engine's own to far below anything visible.
  for(const platform of JUMP_COURSE)for(const tick of [0,17,333,4099,123_456]){
    const view=getJumpPlatformView(platform,tick),u=platform.period?(((tick+platform.phase)%Math.abs(platform.period))+Math.abs(platform.period))%Math.abs(platform.period)/Math.abs(platform.period):0;
    if(platform.motion==='moving'){const offset=Math.sin(u*Math.PI*2)*platform.amplitude;assert.ok(Math.abs(view.x-platform.x-platform.dirX*offset)<1e-9&&Math.abs(view.z-platform.z-platform.dirZ*offset)<1e-9);}
    if(platform.motion==='orbit'){const angle=(platform.period<0?-u:u)*Math.PI*2;assert.ok(Math.abs(view.x-platform.x-Math.cos(angle)*platform.amplitude)<1e-9&&Math.abs(view.z-platform.z-Math.sin(angle)*platform.amplitude)<1e-9);assert.ok(Math.abs(view.orbitAngle-angle)<1e-12);}
    if(platform.hazard==='hammer'){const h=((tick+platform.hazardPhase)%platform.hazardPeriod)/platform.hazardPeriod,offset=Math.sin(h*Math.PI*2)*platform.power;assert.ok(Math.abs(view.hazardX-view.x-platform.hazDirX*offset)<1e-9&&Math.abs(view.hazardZ-view.z-platform.hazDirZ*offset)<1e-9);}
  }
  // No negative zero reaches a snapshot (JSON would turn it into a different bit pattern).
  for(const platform of JUMP_COURSE)for(const value of [platform.x,platform.z,platform.dirX,platform.dirZ,platform.hazDirX,platform.hazDirZ])assert.ok(!Object.is(value,-0),`floor ${platform.floor}`);
});

test('warnings are long enough to read from the pad below: a second for spikes, flames and cannon shots',()=>{
  const longest=(platform:JumpPlatform,flag:(view:JumpPlatformView)=>boolean)=>{
    let best=0,run=0;for(let tick=0;tick<platform.hazardPeriod*3;tick++){run=flag(getJumpPlatformView(platform,tick))?run+1:0;best=Math.max(best,run);}return best;
  };
  for(const platform of JUMP_COURSE){
    if(platform.hazard==='spikes'||platform.hazard==='flame'||platform.hazard==='cannon')assert.ok(longest(platform,view=>view.hazardWarning)>=SECOND,`${platform.hazard} on floor ${platform.floor}`);
    if(platform.hazard==='pusher'||platform.hazard==='wind')assert.ok(longest(platform,view=>view.hazardWarning)>=SECOND*.75,`${platform.hazard} on floor ${platform.floor}`);
  }
});
