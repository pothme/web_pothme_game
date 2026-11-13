import { JUMP_COURSE, JUMP_RULES, getJumpPlatformView, type JumpHitKind, type JumpPlatform, type JumpState, type JumpSurface } from '../shared/jump-game';

type FeedbackBase={id:string;x:number;y:number;z:number;tick:number;intensity:number};
/** A trap near the climber announcing itself (`warn`) or going off (`fire`); `fall` is the restart from the ground pad. */
export type JumpTrapCue='spikes'|'pusher'|'wind'|'cannon'|'flame'|'blink'|'crumble'|'shrink'|'fall';
export type JumpFeedbackEvent=FeedbackBase & (
  {kind:'jump';doubleJump:boolean;spring?:boolean} |
  {kind:'land';impactSpeed:number;surface?:JumpSurface} |
  {kind:'hit';hitKind:JumpHitKind;vx:number;vz:number} |
  {kind:'trap';trap?:JumpTrapCue;phase?:'warn'|'fire';floor?:number}
);
const cueOf=(p:JumpPlatform):{hazard:JumpTrapCue|null;motion:JumpTrapCue|null}=>({
  hazard:p.hazard==='spikes'||p.hazard==='pusher'||p.hazard==='wind'||p.hazard==='cannon'||p.hazard==='flame'?p.hazard:null,
  motion:p.motion==='blink'||p.motion==='crumble'||p.motion==='shrink'?p.motion:null,
});
/** The restart after a fall into the void. The tracker stays silent across a
 * respawn, so the owner of the loop may play this one cue when `deaths` rises. */
export function jumpFallCue(runId:string,sequence:number,before:JumpState,after:JumpState):JumpFeedbackEvent|null {
  if(after.deaths<=before.deaths)return null;
  return{id:`${runId}:${sequence}:fall`,kind:'trap',trap:'fall',phase:'fire',floor:before.lastFloor,x:after.x,y:after.y,z:after.z,tick:after.tick,intensity:Math.max(.35,Math.min(1,before.lastFloor/30))};
}

/** Local presentation only: call step after advance(), never inside a replay.
 * Snapshots establish a silent baseline; they cannot replay a historical sound. */
export class JumpFeedbackTracker {
  private runId='';
  private sequence=-1;
  private lastHit:{sequence:number;tick:number;deaths:number;kind:JumpHitKind}|null=null;
  private lastLanding:{sequence:number;tick:number;deaths:number;floor:number|null}|null=null;
  /** Last seen warning / active bits of the pad stood on and the next one. */
  private watched=new Map<number,{tick:number;flags:number}>();

  reset(runId:string,_state:JumpState,sequence:number){
    if(runId!==this.runId){this.runId=runId;this.sequence=sequence;this.lastHit=null;this.lastLanding=null;this.watched.clear();}
    else this.sequence=Math.max(this.sequence,sequence);
  }

  step(runId:string,sequence:number,before:JumpState,after:JumpState):JumpFeedbackEvent[]{
    if(runId!==this.runId){this.reset(runId,after,sequence);return[];}
    if(!Number.isSafeInteger(sequence)||sequence<=this.sequence)return[];
    this.sequence=sequence;
    if(after.deaths!==before.deaths||after.tick<=before.tick){this.watched.clear();return[];}
    const cues=this.trapCues(runId,sequence,after),own=this.motion(runId,sequence,before,after);
    return cues.length?[...own,...cues]:own;
  }

  /** Rising edges only, for the two pads that matter, and only while they are watched without a gap. */
  private trapCues(runId:string,sequence:number,after:JumpState):JumpFeedbackEvent[]{
    const events:JumpFeedbackEvent[]=[],first=after.lastFloor,second=Math.min(JUMP_RULES.floors,first+1);
    for(const floor of this.watched.keys())if(floor!==first&&floor!==second)this.watched.delete(floor);
    for(const floor of first===second?[first]:[first,second]){
      const platform=JUMP_COURSE[floor];if(!platform)continue;
      const cue=cueOf(platform);if(!cue.hazard&&!cue.motion)continue;
      const view=getJumpPlatformView(platform,after.tick,after);
      const flags=(cue.hazard&&view.hazardWarning?1:0)|(cue.hazard&&view.hazardActive?2:0)|(cue.motion&&view.padWarning?4:0)|(cue.motion&&!view.active?8:0);
      const seen=this.watched.get(floor),rising=seen&&after.tick-seen.tick<=3?flags&~seen.flags:0;
      this.watched.set(floor,{tick:after.tick,flags});
      if(!rising)continue;
      const base={x:view.x,y:view.y,z:view.z,tick:after.tick,floor,intensity:floor===first?1:.55};
      if(rising&1)events.push({...base,id:`${runId}:${sequence}:trap:${floor}:w`,kind:'trap',trap:cue.hazard!,phase:'warn'});
      if(rising&2)events.push({...base,id:`${runId}:${sequence}:trap:${floor}:f`,kind:'trap',trap:cue.hazard!,phase:'fire'});
      if(rising&4)events.push({...base,id:`${runId}:${sequence}:pad:${floor}:w`,kind:'trap',trap:cue.motion!,phase:'warn'});
      if(rising&8)events.push({...base,id:`${runId}:${sequence}:pad:${floor}:f`,kind:'trap',trap:cue.motion!,phase:'fire'});
    }
    return events;
  }

  private motion(runId:string,sequence:number,before:JumpState,after:JumpState):JumpFeedbackEvent[]{
    const base={x:after.x,y:after.y,z:after.z,tick:after.tick};
    const hit=after.lastHitKind;
    if(hit&&after.lastHitTick>=0&&after.lastHitTick!==before.lastHitTick){
      // Authority can align its clock while replaying the same contact. A real
      // second hit is impossible during the simulator's invulnerability window.
      if(this.lastHit&&this.lastHit.deaths===after.deaths&&this.lastHit.kind===hit&&sequence-this.lastHit.sequence<JUMP_RULES.hitInvulnerabilityTicks-5&&after.tick-this.lastHit.tick<JUMP_RULES.hitInvulnerabilityTicks)return[];
      this.lastHit={sequence,tick:after.tick,deaths:after.deaths,kind:hit};
      return[{...base,id:`${runId}:${sequence}:hit`,kind:'hit',hitKind:hit,vx:after.vx,vz:after.vz,intensity:1}];
    }
    // A spring throws the climber without a jump press: its own cue, not a landing.
    if(after.lastBounceTick>=0&&after.lastBounceTick!==before.lastBounceTick&&after.lastBounceTick===after.tick){
      return[{...base,id:`${runId}:${sequence}:spring`,kind:'jump',doubleJump:false,spring:true,intensity:1}];
    }
    if(after.lastJumpTick!==before.lastJumpTick&&after.jumps>before.jumps){
      return[{...base,id:`${runId}:${sequence}:jump`,kind:'jump',doubleJump:after.jumps>=2,intensity:after.jumps>=2?1:.72}];
    }
    if(!before.grounded&&after.grounded){
      const impactSpeed=Math.max(0,-before.vy);
      if(impactSpeed<.7)return[];
      if(this.lastLanding&&this.lastLanding.deaths===after.deaths&&this.lastLanding.floor===after.standingFloor&&sequence-this.lastLanding.sequence<10&&after.tick-this.lastLanding.tick<10)return[];
      this.lastLanding={sequence,tick:after.tick,deaths:after.deaths,floor:after.standingFloor};
      const surface=after.standingFloor===null?undefined:JUMP_COURSE[after.standingFloor]?.surface;
      return[{...base,id:`${runId}:${sequence}:land`,kind:'land',impactSpeed,...(surface&&surface!=='plain'?{surface}:{}),intensity:Math.min(1,Math.max(.12,impactSpeed/14))}];
    }
    return[];
  }
}
