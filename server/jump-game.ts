import { alignJumpClock, createJumpState, JUMP_RULES, respawnJumpState, stepJumpState, type JumpInput, type JumpLeaderboardRow, type JumpSnapshot, type JumpState } from '../shared/jump-game';
import type { GameProfile } from '../shared/game-room';
import { GameError } from './domain';

export interface JumpHooks {
  isConnected(id:string):boolean;
  canEnter(id:string):boolean;
  nickname(id:string):string;
  send(id:string,packet:unknown):void;
  awardFloors(id:string,floors:number[],now:number,commit?:()=>void):number;
  profile(id:string,now:number):GameProfile;
  onEnter?(id:string):void;
  onExit?(id:string):void;
  changed?(id:string):void;
  motion?(id:string):void;
}
interface StoredRun {version:1;active:boolean;state:JumpState;earnedFloors:number[];summit:boolean;bestFloor:number;reachedAt:number;nickname:string}
interface Run extends StoredRun {runId:string;ackSeq:number;budgetMs:number;budgetAt:number}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const error=(code:string,message:string):never=>{throw new GameError(code,message);};

/** Shared arena with per-character progress. Only timed, sequenced raw input crosses the
 * trust boundary. Durable progress is saved on landings and lifecycle events. */
export class JumpGame {
  private runs=new Map<string,Run>();
  private inactive=new Set<string>();
  private leaders:JumpLeaderboardRow[]|null=null;
  constructor(private storage:DurableObjectStorage,private hooks:JumpHooks){
    storage.sql.exec('CREATE TABLE IF NOT EXISTS jump_runs(id TEXT PRIMARY KEY,nickname TEXT NOT NULL,best_floor INTEGER NOT NULL,reached_at INTEGER NOT NULL,active INTEGER NOT NULL,state_json TEXT NOT NULL)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS jump_rank ON jump_runs(best_floor DESC,reached_at ASC)');
  }
  private read(id:string,now:number):Run {
    const cached=this.runs.get(id);if(cached)return cached;
    if(this.runs.size>=256)for(const cachedId of this.runs.keys())if(!this.hooks.isConnected(cachedId)){this.runs.delete(cachedId);break;}
    const row=this.storage.sql.exec<{state_json:string;active:number}>('SELECT state_json,active FROM jump_runs WHERE id=?',id).toArray()[0];
    const stored:StoredRun=row?JSON.parse(row.state_json):{version:1,active:false,state:createJumpState(),earnedFloors:[],summit:false,bestFloor:0,reachedAt:0,nickname:this.hooks.nickname(id)};
    // After a cold restore, resume at the last safe checkpoint with a fresh
    // run ID. Old browser batches cannot replay into the new simulation.
    const state=createJumpState(stored.state.checkpoint,Math.floor(now/JUMP_RULES.stepMs));state.deaths=stored.state.deaths;
    const run:Run={...stored,active:row?row.active===1:false,state,runId:crypto.randomUUID(),ackSeq:0,budgetMs:JUMP_RULES.networkCreditMs,budgetAt:now};
    this.runs.set(id,run);return run;
  }
  private persist(id:string,run:Run){
    const stored:StoredRun={version:1,active:run.active,state:run.state,earnedFloors:run.earnedFloors,summit:run.summit,bestFloor:run.bestFloor,reachedAt:run.reachedAt,nickname:run.nickname};
    this.storage.sql.exec('INSERT INTO jump_runs(id,nickname,best_floor,reached_at,active,state_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,best_floor=excluded.best_floor,reached_at=excluded.reached_at,active=excluded.active,state_json=excluded.state_json',id,run.nickname,run.bestFloor,run.reachedAt,run.active?1:0,JSON.stringify(stored));
  }
  private save(id:string,run:Run){this.storage.transactionSync(()=>this.persist(id,run));this.runs.set(id,run);if(run.active)this.inactive.delete(id);this.leaders=null;}
  active(id:string):boolean {
    const run=this.runs.get(id);if(run)return run.active;if(this.inactive.has(id))return false;
    const active=this.storage.sql.exec<{active:number}>('SELECT active FROM jump_runs WHERE id=?',id).toArray()[0]?.active===1;
    // Office presence is read frequently; do not query SQL repeatedly for
    // every visitor who has never entered the tower.
    if(!active){if(this.inactive.size>=512)this.inactive.delete(this.inactive.values().next().value!);this.inactive.add(id);}return active;
  }
  isActive(id:string):boolean{return this.active(id);}
  peerState(id:string,now=Date.now()){
    if(!this.active(id))return null;const run=this.read(id,now),s=run.state;
    return {x:s.x,y:s.y,z:s.z,vx:s.vx,vy:s.vy,vz:s.vz,grounded:s.grounded,floor:s.floor,jumps:s.jumps,updatedAt:run.budgetAt};
  }
  leaderboard():JumpLeaderboardRow[]{
    if(!this.leaders)this.leaders=this.storage.sql.exec<{nickname:string;best_floor:number;reached_at:number}>('SELECT nickname,best_floor,reached_at FROM jump_runs WHERE best_floor>0 ORDER BY best_floor DESC,reached_at ASC,id ASC LIMIT 3').toArray().map(row=>({nickname:row.nickname,bestFloor:row.best_floor,reachedAt:row.reached_at}));
    return this.leaders.map(row=>({...row}));
  }
  snapshot(id:string,now=Date.now()):JumpSnapshot {
    const run=this.read(id,now);return{runId:run.runId,active:run.active,state:clone(run.state),ackSeq:run.ackSeq,serverTime:now,rewards:{earnedFloors:[...run.earnedFloors],summit:run.summit,totalPoints:run.earnedFloors.length+(run.summit?JUMP_RULES.summitReward:0),maxPoints:JUMP_RULES.maxRewardPoints},profile:this.hooks.profile(id,now),leaderboard:this.leaderboard()};
  }
  private emit(id:string,now:number,requestId?:string){this.hooks.send(id,{type:'jump-state',state:this.snapshot(id,now),...(requestId?{requestId}:{})});}
  joined(id:string,now=Date.now()){
    if(!this.active(id))return;
    const run=this.read(id,now);run.state=alignJumpClock(run.state,Math.floor(now/JUMP_RULES.stepMs));run.budgetAt=now;run.budgetMs=0;
    const nickname=this.hooks.nickname(id);if(nickname!==run.nickname){const updated={...run,nickname};this.save(id,updated);this.hooks.changed?.(id);}
    this.hooks.onEnter?.(id);this.emit(id,now);
  }
  left(id:string,now=Date.now()){
    const run=this.runs.get(id);if(!run)return;
    this.save(id,{...run,budgetAt:now,budgetMs:0});
  }
  close(now=Date.now()){
    const next=[...this.runs].map(([id,run])=>[id,{...run,active:false,budgetAt:now,budgetMs:0}] as const);
    this.storage.transactionSync(()=>{for(const [id,run] of next)this.persist(id,run);this.storage.sql.exec('UPDATE jump_runs SET active=0');});
    for(const [id,run] of next){const wasActive=this.runs.get(id)!.active;this.runs.set(id,run);if(wasActive){this.hooks.onExit?.(id);if(this.hooks.isConnected(id))this.emit(id,now);}}
  }
  private input(id:string,run:Run,input:Record<string,unknown>,now:number){
    if(!run.active)error('JUMP_INACTIVE','먼저 점프 타워에 입장해 주세요.');
    if(input.runId!==run.runId)error('JUMP_RUN','현재 점프 기록을 다시 연결해 주세요.');
    if(Object.keys(input).some(key=>!['type','runId','frames','requestId'].includes(key)))error('JUMP_INPUT','이동 입력만 보낼 수 있어요.');
    if(!Array.isArray(input.frames)||input.frames.length<1||input.frames.length>JUMP_RULES.maxBatchFrames)error('JUMP_INPUT','한 번에 보낼 이동 입력 수를 확인해 주세요.');
    const frames:JumpInput[]=[];
    for(const value of input.frames as unknown[]){
      if(!value||typeof value!=='object'||Array.isArray(value))error('JUMP_INPUT','이동 입력을 확인해 주세요.');
      const frame=value as Record<string,unknown>;
      if(Object.keys(frame).some(key=>!['seq','x','z','jump'].includes(key))||!Number.isSafeInteger(frame.seq)||Number(frame.seq)<1||typeof frame.x!=='number'||!Number.isFinite(frame.x)||typeof frame.z!=='number'||!Number.isFinite(frame.z)||typeof frame.jump!=='boolean')error('JUMP_INPUT','이동 입력을 확인해 주세요.');
      const normalized:JumpInput={seq:Number(frame.seq),x:Math.max(-1,Math.min(1,Number(frame.x))),z:Math.max(-1,Math.min(1,Number(frame.z))),jump:frame.jump as boolean};
      if(frames.length&&normalized.seq!==frames[frames.length-1]!.seq+1)error('JUMP_SEQUENCE','이동 입력 순서가 맞지 않아요.');frames.push(normalized);
    }
    const fresh=frames.filter(frame=>frame.seq>run.ackSeq);if(!fresh.length)return;
    if(fresh[0]!.seq!==run.ackSeq+1)error('JUMP_SEQUENCE','이동 입력을 다시 연결해 주세요.');
    const budget=Math.min(JUMP_RULES.maxStoredCreditMs,run.budgetMs+Math.max(0,now-run.budgetAt)),cost=fresh.length*JUMP_RULES.stepMs;
    if(cost>budget)error('JUMP_RATE','입력 속도가 너무 빨라요. 잠시 후 다시 연결해 주세요.');
    const next:Run={...run,state:alignJumpClock(run.state,Math.max(run.state.tick,Math.floor((now-budget)/JUMP_RULES.stepMs))),earnedFloors:[...run.earnedFloors],budgetAt:Math.max(run.budgetAt,now),budgetMs:budget-cost,ackSeq:fresh[fresh.length-1]!.seq,nickname:this.hooks.nickname(id)};
    const landings:number[]=[];let died=false;
    for(const frame of fresh){const stepped=stepJumpState(next.state,frame);next.state=stepped.state;died ||= stepped.died;if(stepped.landedFloor!==null)landings.push(stepped.landedFloor);}
    if(landings.length){
      const highest=Math.max(...landings),floors=Array.from({length:highest},(_,index)=>index+1).filter(floor=>!next.earnedFloors.includes(floor));
      next.earnedFloors.push(...floors);next.earnedFloors.sort((a,b)=>a-b);if(highest===60)next.summit=true;
      if(highest>next.bestFloor){next.bestFloor=highest;next.reachedAt=now;}
      // Several crossed floors and any two landings in a network batch share
      // one transaction with the final simulation state.
      this.hooks.awardFloors(id,floors,now,()=>this.persist(id,next));
      this.runs.set(id,next);this.leaders=null;this.hooks.changed?.(id);
    }else if(died){this.save(id,next);}else this.runs.set(id,next);
    this.hooks.motion?.(id);
  }
  handle(id:string,input:Record<string,unknown>,now=Date.now()):boolean {
    if(typeof input.type!=='string'||!input.type.startsWith('jump-'))return false;
    if(!this.hooks.isConnected(id))error('NOT_JOINED','먼저 사무실에 입장해 주세요.');
    if(!['jump-enter','jump-sync','jump-input','jump-retry','jump-exit'].includes(input.type))error('JUMP_COMMAND','점프 요청을 확인해 주세요.');
    const requestId=typeof input.requestId==='string'&&input.requestId.length<=100?input.requestId:undefined;
    const run=this.read(id,now);
    if(input.type==='jump-enter'){
      if(!run.active){
        if(!this.hooks.canEnter(id))error('JUMP_DOOR','휴게실의 점프 타워 입구 가까이 이동해 주세요.');
        const next:Run={...run,active:true,state:createJumpState(run.state.checkpoint,Math.floor(now/JUMP_RULES.stepMs)),runId:crypto.randomUUID(),ackSeq:0,budgetMs:JUMP_RULES.networkCreditMs,budgetAt:now,nickname:this.hooks.nickname(id)};
        this.save(id,next);this.hooks.onEnter?.(id);this.hooks.changed?.(id);
      }
    }else if(input.type==='jump-sync'){run.state=alignJumpClock(run.state,Math.floor(now/JUMP_RULES.stepMs));this.hooks.motion?.(id);}
    else if(input.type==='jump-input')this.input(id,run,input,now);
    else if(input.type==='jump-retry'||input.type==='jump-exit'){
      if(!run.active||input.runId!==run.runId)error('JUMP_RUN','현재 점프 기록을 다시 연결해 주세요.');
      if(input.type==='jump-exit'){
        this.save(id,{...run,active:false,budgetAt:now,budgetMs:0});this.hooks.onExit?.(id);this.hooks.changed?.(id);
      }else{
        const state=run.state.status==='complete'?createJumpState(0,Math.floor(now/JUMP_RULES.stepMs)):respawnJumpState(alignJumpClock(run.state,Math.floor(now/JUMP_RULES.stepMs)));
        this.save(id,{...run,state,runId:crypto.randomUUID(),ackSeq:0,budgetMs:0,budgetAt:now});this.hooks.changed?.(id);
      }
    }
    this.emit(id,now,requestId);return true;
  }
}
