import { JUMP_RULES, type JumpHitKind, type JumpState } from '../shared/jump-game';

type FeedbackBase={id:string;x:number;y:number;z:number;tick:number;intensity:number};
export type JumpFeedbackEvent=FeedbackBase & (
  {kind:'jump';doubleJump:boolean} |
  {kind:'land';impactSpeed:number} |
  {kind:'hit';hitKind:JumpHitKind;vx:number;vz:number}
);

/** Local presentation only: call step after advance(), never inside a replay.
 * Snapshots establish a silent baseline; they cannot replay a historical sound. */
export class JumpFeedbackTracker {
  private runId='';
  private sequence=-1;
  private lastHit:{sequence:number;tick:number;deaths:number;kind:JumpHitKind}|null=null;
  private lastLanding:{sequence:number;tick:number;deaths:number;floor:number|null}|null=null;

  reset(runId:string,_state:JumpState,sequence:number){
    if(runId!==this.runId){this.runId=runId;this.sequence=sequence;this.lastHit=null;this.lastLanding=null;}
    else this.sequence=Math.max(this.sequence,sequence);
  }

  step(runId:string,sequence:number,before:JumpState,after:JumpState):JumpFeedbackEvent[]{
    if(runId!==this.runId){this.reset(runId,after,sequence);return[];}
    if(!Number.isSafeInteger(sequence)||sequence<=this.sequence)return[];
    this.sequence=sequence;
    if(after.deaths!==before.deaths||after.tick<=before.tick)return[];
    const base={x:after.x,y:after.y,z:after.z,tick:after.tick};
    const hit=after.lastHitKind;
    if(hit&&after.lastHitTick>=0&&after.lastHitTick!==before.lastHitTick){
      // Authority can align its clock while replaying the same contact. A real
      // second hit is impossible during the simulator's invulnerability window.
      if(this.lastHit&&this.lastHit.deaths===after.deaths&&this.lastHit.kind===hit&&sequence-this.lastHit.sequence<JUMP_RULES.hitInvulnerabilityTicks-5&&after.tick-this.lastHit.tick<JUMP_RULES.hitInvulnerabilityTicks)return[];
      this.lastHit={sequence,tick:after.tick,deaths:after.deaths,kind:hit};
      return[{...base,id:`${runId}:${sequence}:hit`,kind:'hit',hitKind:hit,vx:after.vx,vz:after.vz,intensity:1}];
    }
    if(after.lastJumpTick!==before.lastJumpTick&&after.jumps>before.jumps){
      return[{...base,id:`${runId}:${sequence}:jump`,kind:'jump',doubleJump:after.jumps>=2,intensity:after.jumps>=2?1:.72}];
    }
    if(!before.grounded&&after.grounded){
      const impactSpeed=Math.max(0,-before.vy);
      if(impactSpeed<.7)return[];
      if(this.lastLanding&&this.lastLanding.deaths===after.deaths&&this.lastLanding.floor===after.standingFloor&&sequence-this.lastLanding.sequence<10&&after.tick-this.lastLanding.tick<10)return[];
      this.lastLanding={sequence,tick:after.tick,deaths:after.deaths,floor:after.standingFloor};
      return[{...base,id:`${runId}:${sequence}:land`,kind:'land',impactSpeed,intensity:Math.min(1,Math.max(.12,impactSpeed/14))}];
    }
    return[];
  }
}
