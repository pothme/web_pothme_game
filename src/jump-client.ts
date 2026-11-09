import { JUMP_RULES, stepJumpState, type JumpInput, type JumpState } from '../shared/jump-game';

export type JumpAuthority = {runId:string;ackSeq:number;state:JumpState};
/** Prediction only. Rewards and point totals are never calculated here. */
export class JumpPrediction {
  state:JumpState;
  runId:string;
  ackSeq:number;
  private nextSeq:number;
  private sentSeq:number;
  private pending:JumpInput[]=[];
  constructor(snapshot:JumpAuthority){this.runId=snapshot.runId;this.state=snapshot.state;this.ackSeq=snapshot.ackSeq;this.nextSeq=this.sentSeq=snapshot.ackSeq;}
  get queued(){return this.pending.length;}
  /** Last locally simulated input, also used to deduplicate presentation events. */
  get sequence(){return this.nextSeq;}
  advance(input:Omit<JumpInput,'seq'>){
    if(this.pending.length>=150||this.state.status==='complete')return false;
    const frame:JumpInput={...input,seq:++this.nextSeq};
    this.state=stepJumpState(this.state,frame).state;this.pending.push(frame);return true;
  }
  outgoing(limit:number=JUMP_RULES.maxBatchFrames){return this.pending.filter(frame=>frame.seq>this.sentSeq).slice(0,Math.min(limit,JUMP_RULES.maxBatchFrames));}
  markSent(frames:readonly JumpInput[]){if(frames.length)this.sentSeq=Math.max(this.sentSeq,frames[frames.length-1].seq);}
  /** Explicit recovery after rejection/queue overflow. Replaying the same full
   * queue here would fail advance() again before any input could be sent. */
  reset(snapshot:JumpAuthority){
    this.runId=snapshot.runId;this.state=snapshot.state;this.ackSeq=snapshot.ackSeq;
    this.nextSeq=this.sentSeq=snapshot.ackSeq;this.pending=[];
  }
  /** Replay unacknowledged input over authority, including authoritative deaths. */
  reconcile(snapshot:JumpAuthority,resend=false){
    if(snapshot.runId!==this.runId){this.runId=snapshot.runId;this.pending=[];this.nextSeq=this.sentSeq=snapshot.ackSeq;}
    else if(snapshot.ackSeq<this.ackSeq)return false;
    this.ackSeq=snapshot.ackSeq;
    this.pending=this.pending.filter(frame=>frame.seq>snapshot.ackSeq);
    this.state=snapshot.state;
    for(const frame of this.pending)this.state=stepJumpState(this.state,frame).state;
    this.nextSeq=Math.max(snapshot.ackSeq,...this.pending.map(frame=>frame.seq));
    this.sentSeq=resend?snapshot.ackSeq:Math.max(this.sentSeq,snapshot.ackSeq);
    return true;
  }
}
