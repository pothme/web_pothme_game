import { alignJumpClock, createJumpState, JUMP_HIT_KINDS, JUMP_RULES, respawnJumpState, settleJumpState, stepJumpState, type JumpInput, type JumpLeaderboardRow, type JumpSnapshot, type JumpState } from '../shared/jump-game';
import type { JumpRoomRank } from '../shared/jump-social';
import type { GameProfile } from '../shared/game-room';
import { GameError } from './domain';

/** The tower is played inside a room. The lobby (game hub) owns room membership;
 * this module only asks which tower room a player belongs to:
 *
 *  - `room(id)` returns the id of the player's 점프 타워 room, or null. Without a
 *    room `jump-enter` is refused (JUMP_ROOM).
 *  - Call `syncRooms()` whenever lobby membership may have changed (leave, kick,
 *    room closed, disconnect timeout). Climbers whose room is gone are sent out.
 *  - `roomOf(id)` / `roomRanking(roomId)` scope presence, chat and the live ranking.
 *
 * Every room shares one arena clock (server time / stepMs), so trap timing is the
 * same everywhere. Rewards and the leaderboard stay per character and global.
 *
 * The tower never pauses. A climber whose input stops (pause menu, hidden tab, lost
 * connection, sleeping server) is played forward with no input the next time anything
 * is heard from them, so stopping in mid-air is a fall and stopping on a trap is a hit.
 * The host calls `flushIdle()` about once a second while it returns true, so the exact
 * state of a climber who went quiet is on disk before the object can be put to sleep. */
export interface JumpHooks {
  isConnected(id:string):boolean;
  room(id:string):string|null;
  nickname(id:string):string;
  send(id:string,packet:unknown):void;
  awardFloors(id:string,floors:number[],now:number,commit?:()=>void):number;
  profile(id:string,now:number):GameProfile;
  onEnter?(id:string):void;
  onExit?(id:string):void;
  changed?(id:string):void;
  motion?(id:string):void;
}
/** Bonus paid for the summit of the retired sixty-floor tower. Whoever earned it keeps it. */
const LEGACY_SUMMIT_BONUS=300;
/** A climber counts as quiet this long after their last input. */
const QUIET_MS=1000;
/** `bestFloor` ranks climbs of the hundred-floor tower only; `legacyBest` keeps the best floor of the retired one. */
interface StoredRun {version:2;active:boolean;roomId:string|null;state:JumpState;earnedFloors:number[];summit:boolean;legacyBonus:number;legacyBest:number;bestFloor:number;sessionBest:number;reachedAt:number;nickname:string}
interface Run extends StoredRun {runId:string;ackSeq:number;budgetMs:number;budgetAt:number}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const error=(code:string,message:string):never=>{throw new GameError(code,message);};
const floorNumber=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=JUMP_RULES.floors?value:0;

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const tickNumber=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER/4;
/** A stored position is used again only if every field is well formed; anything else starts on the ground. */
function reviveState(raw:unknown):JumpState|null {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const v=raw as Record<string,unknown>,floorOf=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=JUMP_RULES.floors;
  if(![v.x,v.y,v.z,v.vx,v.vy,v.vz,v.fallFrom].every(finite)||![v.tick,v.lastJumpTick,v.invulnerableUntil,v.lastHitTick,v.knockbackUntil,v.lastBounceTick].every(tickNumber)||(v.tick as number)<0)return null;
  if(Math.abs(v.x as number)>JUMP_RULES.bounds||Math.abs(v.z as number)>JUMP_RULES.bounds||Math.abs(v.y as number)>1000||Math.abs(v.vx as number)>100||Math.abs(v.vy as number)>100||Math.abs(v.vz as number)>100)return null;
  if(typeof v.grounded!=='boolean'||typeof v.jumpHeld!=='boolean'||v.jumps!==0&&v.jumps!==1&&v.jumps!==2||v.status!=='playing'&&v.status!=='complete')return null;
  if(!floorOf(v.floor)||!floorOf(v.lastFloor)||v.standingFloor!==null&&!floorOf(v.standingFloor)||v.grounded!==(v.standingFloor!==null))return null;
  if((v.lastFloor as number)>(v.floor as number)||(v.status==='complete')!==(v.floor===JUMP_RULES.floors))return null;
  if(typeof v.deaths!=='number'||!Number.isSafeInteger(v.deaths)||v.deaths<0||v.lastHitKind!==null&&!JUMP_HIT_KINDS.includes(v.lastHitKind as never))return null;
  if(!v.crumbleAt||typeof v.crumbleAt!=='object'||Array.isArray(v.crumbleAt))return null;
  const crumbleAt:Record<string,number>={};
  for(const [key,value] of Object.entries(v.crumbleAt as Record<string,unknown>)){if(!/^[1-9][0-9]?$/.test(key)||!tickNumber(value))return null;crumbleAt[key]=value;}
  return{x:v.x,y:v.y,z:v.z,vx:v.vx,vy:v.vy,vz:v.vz,tick:v.tick,grounded:v.grounded,jumps:v.jumps,jumpHeld:v.jumpHeld,lastJumpTick:v.lastJumpTick,standingFloor:v.standingFloor,floor:v.floor,lastFloor:v.lastFloor,fallFrom:v.fallFrom,deaths:v.deaths,status:v.status,crumbleAt,invulnerableUntil:v.invulnerableUntil,lastHitTick:v.lastHitTick,lastHitKind:v.lastHitKind,knockbackUntil:v.knockbackUntil,lastBounceTick:v.lastBounceTick} as JumpState;
}
/** Progress written by any earlier version becomes a valid record: paid floors survive, a checkpoint or
 * an in-flight position does not. A best floor of the sixty-floor tower is kept as `legacyBest` but no
 * longer ranks: the leaderboard compares climbs of the same tower only. */
function restore(raw:string|undefined,nickname:string):{stored:StoredRun;current:boolean} {
  let value:Record<string,unknown>={};
  try{const parsed=raw?JSON.parse(raw):null;if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))value=parsed;}catch{/* an unreadable record is an empty one */}
  const current=value.version===2;
  const earned=Array.isArray(value.earnedFloors)?[...new Set(value.earnedFloors.filter((floor):floor is number=>floorNumber(floor)>0))].sort((a,b)=>a-b):[];
  const state=current&&value.state&&typeof value.state==='object'?value.state as JumpState:createJumpState();
  return{current,stored:{
    version:2,active:current&&value.active===true,roomId:current&&typeof value.roomId==='string'?value.roomId:null,state,earnedFloors:earned,
    summit:current&&value.summit===true,legacyBonus:current?(value.legacyBonus===LEGACY_SUMMIT_BONUS?LEGACY_SUMMIT_BONUS:0):value.summit===true?LEGACY_SUMMIT_BONUS:0,
    legacyBest:floorNumber(current?value.legacyBest:value.bestFloor),bestFloor:current?floorNumber(value.bestFloor):0,sessionBest:current?floorNumber(value.sessionBest):0,
    reachedAt:current&&typeof value.reachedAt==='number'&&Number.isFinite(value.reachedAt)?value.reachedAt:0,nickname:typeof value.nickname==='string'?value.nickname:nickname,
  }};
}

/** Room-scoped arenas with per-character progress. Only timed, sequenced raw input crosses the
 * trust boundary. Durable progress is saved on landings, on lifecycle events and when a climber goes quiet. */
export class JumpGame {
  private runs=new Map<string,Run>();
  private inactive=new Set<string>();
  private leaders:JumpLeaderboardRow[]|null=null;
  /** Climbers whose state in memory is newer than the one on disk. */
  private dirty=new Set<string>();
  constructor(private storage:DurableObjectStorage,private hooks:JumpHooks){
    storage.sql.exec('CREATE TABLE IF NOT EXISTS jump_runs(id TEXT PRIMARY KEY,nickname TEXT NOT NULL,best_floor INTEGER NOT NULL,reached_at INTEGER NOT NULL,active INTEGER NOT NULL,state_json TEXT NOT NULL)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS jump_rank ON jump_runs(best_floor DESC,reached_at ASC)');
    // Records of the sixty-floor tower leave the ranking; their JSON (paid floors, old best) is untouched until the player returns.
    storage.sql.exec(`UPDATE jump_runs SET best_floor=0,reached_at=0 WHERE best_floor>0 AND state_json NOT LIKE '{"version":2,%'`);
  }
  private read(id:string,now:number):Run {
    const cached=this.runs.get(id);if(cached)return cached;
    if(this.runs.size>=256)for(const cachedId of this.runs.keys())if(!this.hooks.isConnected(cachedId)){this.runs.delete(cachedId);break;}
    const row=this.storage.sql.exec<{state_json:string;active:number}>('SELECT state_json,active FROM jump_runs WHERE id=?',id).toArray()[0];
    const {stored,current}=restore(row?.state_json,this.hooks.nickname(id)),tick=Math.floor(now/JUMP_RULES.stepMs);
    // A run stays open across a restart only while its room still exists.
    const active=current&&row?.active===1&&stored.roomId!==null&&this.hooks.room(id)===stored.roomId;
    // After a cold restore the browser gets a fresh run ID, so old batches cannot replay. An open run
    // continues from exactly the state that was saved, in the air or not, at the tick it was saved:
    // whoever speaks next is played forward from there like any other absence, so a sleeping or
    // restarted server is never a checkpoint. An inactive run and anything unreadable start on the ground.
    const saved=active?reviveState(stored.state):null,state=saved??createJumpState(tick),deaths=(stored.state as {deaths?:unknown}|null)?.deaths;
    if(!saved)state.deaths=typeof deaths==='number'&&Number.isSafeInteger(deaths)&&deaths>=0?deaths:0;
    const run:Run={...stored,active,roomId:active?stored.roomId:null,sessionBest:active?stored.sessionBest:0,state,runId:crypto.randomUUID(),ackSeq:0,budgetMs:JUMP_RULES.networkCreditMs,budgetAt:now};
    this.runs.set(id,run);return run;
  }
  private persist(id:string,run:Run){
    const stored:StoredRun={version:2,active:run.active,roomId:run.roomId,state:run.state,earnedFloors:run.earnedFloors,summit:run.summit,legacyBonus:run.legacyBonus,legacyBest:run.legacyBest,bestFloor:run.bestFloor,sessionBest:run.sessionBest,reachedAt:run.reachedAt,nickname:run.nickname};
    this.storage.sql.exec('INSERT INTO jump_runs(id,nickname,best_floor,reached_at,active,state_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,best_floor=excluded.best_floor,reached_at=excluded.reached_at,active=excluded.active,state_json=excluded.state_json',id,run.nickname,run.bestFloor,run.reachedAt,run.active?1:0,JSON.stringify(stored));
  }
  private save(id:string,run:Run){this.storage.transactionSync(()=>this.persist(id,run));this.runs.set(id,run);this.dirty.delete(id);if(run.active)this.inactive.delete(id);this.leaders=null;}
  /** Writes the exact state of every climber who has stopped sending input. Returns true while someone still
   * has unsaved movement; the host keeps a timer running until it returns false, which also keeps the
   * object awake until a paused climber's position (a fall included) is on disk. */
  flushIdle(now=Date.now()):boolean {
    for(const id of [...this.dirty]){
      const run=this.runs.get(id);
      if(!run||!run.active)this.dirty.delete(id);else if(now-run.budgetAt>=QUIET_MS)this.save(id,run);
    }
    return this.dirty.size>0;
  }
  /** Best floor reached on the hundred-floor tower. */
  bestFloor(id:string,now=Date.now()):number {return this.read(id,now).bestFloor;}
  active(id:string,now=Date.now()):boolean {
    const run=this.runs.get(id);if(run)return run.active;if(this.inactive.has(id))return false;
    const stored=this.storage.sql.exec<{active:number}>('SELECT active FROM jump_runs WHERE id=?',id).toArray()[0]?.active===1;
    // Office presence is read frequently; do not query SQL repeatedly for
    // every visitor who has never entered the tower.
    const active=stored&&this.read(id,now).active;
    if(!active){if(this.inactive.size>=512)this.inactive.delete(this.inactive.values().next().value!);this.inactive.add(id);}return active;
  }
  isActive(id:string):boolean{return this.active(id);}
  /** Tower room of a player who is inside the tower right now. */
  roomOf(id:string):string|null {return this.active(id)?this.runs.get(id)?.roomId??null:null;}
  peerState(id:string,now=Date.now()){
    if(!this.active(id,now))return null;const run=this.read(id,now),s=run.state;
    return {x:s.x,y:s.y,z:s.z,vx:s.vx,vy:s.vy,vz:s.vz,grounded:s.grounded,floor:s.lastFloor,jumps:s.jumps,updatedAt:run.budgetAt};
  }
  /** Live ranking of the connected climbers in one room: where each stands now and the best floor of this visit. */
  roomRanking(roomId:string):JumpRoomRank[] {
    const rows:JumpRoomRank[]=[];
    for(const [id,run] of this.runs)if(run.active&&run.roomId===roomId&&this.hooks.isConnected(id))rows.push({id,nickname:run.nickname,floor:run.state.status==='complete'?JUMP_RULES.floors:run.state.lastFloor,bestFloor:run.sessionBest});
    return rows.sort((a,b)=>b.bestFloor-a.bestFloor||b.floor-a.floor||(a.id<b.id?-1:1));
  }
  /** Rooms that currently have a connected climber. */
  rooms():string[] {
    const rooms=new Set<string>();
    for(const [id,run] of this.runs)if(run.active&&run.roomId!==null&&this.hooks.isConnected(id))rooms.add(run.roomId);
    return [...rooms];
  }
  leaderboard():JumpLeaderboardRow[]{
    if(!this.leaders)this.leaders=this.storage.sql.exec<{nickname:string;best_floor:number;reached_at:number}>('SELECT nickname,best_floor,reached_at FROM jump_runs WHERE best_floor>0 ORDER BY best_floor DESC,reached_at ASC,id ASC LIMIT 3').toArray().map(row=>({nickname:row.nickname,bestFloor:row.best_floor,reachedAt:row.reached_at}));
    return this.leaders.map(row=>({...row}));
  }
  snapshot(id:string,now=Date.now()):JumpSnapshot {
    const run=this.read(id,now);
    return{runId:run.runId,active:run.active,roomId:run.active?run.roomId:null,state:clone(run.state),ackSeq:run.ackSeq,serverTime:now,
      rewards:{earnedFloors:[...run.earnedFloors],summit:run.summit,legacyBonus:run.legacyBonus,totalPoints:run.earnedFloors.length*JUMP_RULES.floorReward+(run.summit?JUMP_RULES.summitReward:0)+run.legacyBonus,maxPoints:JUMP_RULES.maxRewardPoints+run.legacyBonus},
      profile:this.hooks.profile(id,now),leaderboard:this.leaderboard()};
  }
  private emit(id:string,now:number,requestId?:string){this.hooks.send(id,{type:'jump-state',state:this.snapshot(id,now),...(requestId?{requestId}:{})});}
  private leave(id:string,run:Run,now:number){
    this.save(id,{...run,active:false,roomId:null,sessionBest:0,budgetAt:now,budgetMs:0});this.hooks.onExit?.(id);this.hooks.changed?.(id);
  }
  /** Lobby membership changed: nobody keeps climbing in a room they no longer belong to. */
  syncRooms(now=Date.now()){
    for(const [id,run] of [...this.runs])if(run.active&&this.hooks.room(id)!==run.roomId){this.leave(id,run,now);if(this.hooks.isConnected(id))this.emit(id,now);}
  }
  joined(id:string,now=Date.now()){
    if(!this.active(id,now))return;
    let run=this.read(id,now);
    if(this.hooks.room(id)!==run.roomId){this.leave(id,run,now);this.emit(id,now);return;}
    // Time went on while they were away: a climber who dropped out in mid-air has fallen.
    const nickname=this.hooks.nickname(id),renamed=nickname!==run.nickname;
    run=this.play(id,run,now,Math.floor(now/JUMP_RULES.stepMs),[],{budgetAt:now,budgetMs:0,nickname});
    this.hooks.motion?.(id);
    if(renamed){this.save(id,run);this.hooks.changed?.(id);}
    this.hooks.onEnter?.(id);this.emit(id,now);
  }
  left(id:string,now=Date.now()){
    const run=this.runs.get(id);if(!run)return;
    this.save(id,{...run,budgetAt:now,budgetMs:0});if(run.active)this.hooks.changed?.(id);
  }
  close(now=Date.now()){
    const next=[...this.runs].map(([id,run])=>[id,{...run,active:false,roomId:null,sessionBest:0,budgetAt:now,budgetMs:0}] as const);
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
    // Input that arrives later than the stored credit allows leaves a gap; the gap is played with no input.
    this.play(id,run,now,Math.floor((now-budget)/JUMP_RULES.stepMs),fresh,{budgetAt:Math.max(run.budgetAt,now),budgetMs:budget-cost,ackSeq:fresh[fresh.length-1]!.seq,nickname:this.hooks.nickname(id)});
    this.hooks.motion?.(id);
  }
  /** Advances a run: first the ticks nobody sent input for, up to `tick`, then the frames.
   * New floors are paid in the same transaction as the state that earned them. */
  private play(id:string,run:Run,now:number,tick:number,frames:readonly JumpInput[],patch:Partial<Run>={}):Run {
    const next:Run={...run,...patch,earnedFloors:[...run.earnedFloors]},before=run.state;
    const settled=settleJumpState(next.state,tick);next.state=settled.state;
    let died=settled.died,highest=settled.landedFloor??0;
    for(const frame of frames){const stepped=stepJumpState(next.state,frame);next.state=stepped.state;died ||= stepped.died;if(stepped.landedFloor!==null)highest=Math.max(highest,stepped.landedFloor);}
    if(highest>0){
      const floors=Array.from({length:highest},(_,index)=>index+1).filter(floor=>!next.earnedFloors.includes(floor));
      next.earnedFloors.push(...floors);next.earnedFloors.sort((a,b)=>a-b);if(highest===JUMP_RULES.floors)next.summit=true;
      if(highest>next.bestFloor){next.bestFloor=highest;next.reachedAt=now;}
      next.sessionBest=Math.max(next.sessionBest,highest);
      // Several crossed floors and any two landings in a network batch share
      // one transaction with the final simulation state.
      this.hooks.awardFloors(id,floors,now,()=>this.persist(id,next));
      this.runs.set(id,next);this.dirty.delete(id);this.leaders=null;this.hooks.changed?.(id);
    }else if(died||next.state.lastFloor!==before.lastFloor){
      // A fall and every change of pad go to disk at once; movement in between waits for `flushIdle`.
      this.save(id,next);this.hooks.changed?.(id);
    }else{
      this.runs.set(id,next);
      if(next.state!==before)this.dirty.add(id);
    }
    return next;
  }
  handle(id:string,input:Record<string,unknown>,now=Date.now()):boolean {
    if(typeof input.type!=='string'||!input.type.startsWith('jump-'))return false;
    if(!this.hooks.isConnected(id))error('NOT_JOINED','먼저 사무실에 입장해 주세요.');
    if(!['jump-enter','jump-sync','jump-input','jump-retry','jump-exit'].includes(input.type))error('JUMP_COMMAND','점프 요청을 확인해 주세요.');
    const requestId=typeof input.requestId==='string'&&input.requestId.length<=100?input.requestId:undefined;
    const run=this.read(id,now);
    if(input.type==='jump-enter'){
      const roomId=this.hooks.room(id);
      if(roomId===null){
        if(run.active)this.leave(id,run,now);
        error('JUMP_ROOM','게임룸에서 점프 타워 방을 만들거나 참가한 뒤 입장해 주세요.');
      }
      if(run.active&&run.roomId===roomId){this.play(id,run,now,Math.floor(now/JUMP_RULES.stepMs),[]);this.hooks.motion?.(id);}
      else{
        // Every visit starts on the ground pad: there is no saved floor to return to.
        const next:Run={...run,active:true,roomId,sessionBest:0,state:createJumpState(Math.floor(now/JUMP_RULES.stepMs)),runId:crypto.randomUUID(),ackSeq:0,budgetMs:JUMP_RULES.networkCreditMs,budgetAt:now,nickname:this.hooks.nickname(id)};
        if(run.active)this.hooks.onExit?.(id);
        this.save(id,next);this.hooks.onEnter?.(id);this.hooks.changed?.(id);
      }
    }else if(input.type==='jump-sync'){
      // Resuming from a pause or a hidden tab: the world did not wait. The credit for late input starts again.
      if(run.active){const budget=Math.min(JUMP_RULES.maxStoredCreditMs,run.budgetMs+Math.max(0,now-run.budgetAt));this.play(id,run,now,Math.floor(now/JUMP_RULES.stepMs),[],{budgetAt:Math.max(run.budgetAt,now),budgetMs:Math.min(budget,JUMP_RULES.networkCreditMs)});}
      this.hooks.motion?.(id);
    }
    else if(input.type==='jump-input')this.input(id,run,input,now);
    else if(input.type==='jump-retry'||input.type==='jump-exit'){
      if(!run.active||input.runId!==run.runId)error('JUMP_RUN','현재 점프 기록을 다시 연결해 주세요.');
      if(input.type==='jump-exit')this.leave(id,run,now);
      else{
        const tick=Math.floor(now/JUMP_RULES.stepMs),state=run.state.status==='complete'?createJumpState(tick):respawnJumpState(alignJumpClock(run.state,tick));
        this.save(id,{...run,state,runId:crypto.randomUUID(),ackSeq:0,budgetMs:0,budgetAt:now});this.hooks.changed?.(id);
      }
    }
    this.emit(id,now,requestId);return true;
  }
}
