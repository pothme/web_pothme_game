import { DEFAULT_APPEARANCE, normalizeAvatarAppearance, type AvatarAppearance } from '../shared/avatar-appearance';
import { SHOP_ITEMS, defaultAvatarProfile, shopItem, validateOwnedAppearance, type AvatarProfile } from '../shared/avatar-catalog';
import { GAME_RULES, gameDefinition, isGameKind, isSessionGame, type GameProfile, type GameRoomSummary, type GameRoomView, type GameSnapshot, type GameRoundResult } from '../shared/game-room';
import { JUMP_RULES, jumpFloorReward, jumpRewardFloor } from '../shared/jump-game';
import { GameError } from './domain';
import { normalizeChat, socialRequestId } from './social';
import { chatBurstTake } from '../shared/chat-burst';
import { advanceRoom, AUCTION_PRIZES, finishRoom, newMember, resolveRound, roundComplete, startRoom, validateChoice, type InternalRoom } from './game-rules';

type Receipt = { id:string; signature:string };
interface StoredProfile extends AvatarProfile { wins:number; rewardDay:string; dailyEarned:number; receipts:Receipt[] }
interface HallState { version:1; visitors:string[]; rooms:InternalRoom[]; receipts:Record<string,Receipt[]> }
interface HubPlayer { id:string; nickname:string }
interface HubHooks {
  players():HubPlayer[]; send(id:string,packet:unknown):void; changed?(id?:string):void;
  /** Pad a player stands on inside the jump tower right now, or null when they are not climbing. */
  towerFloor?(id:string):number|null;
  /** Best floor the player ever reached in the jump tower. */
  towerBest?(id:string):number;
}
const dayKey=(now:number)=>new Date(now+9*60*60*1000).toISOString().slice(0,10);
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

/** All points, ownership and game choices are authoritative inside the existing room DO. */
export class GameHub {
  private state:HallState;
  private profiles=new Map<string,StoredProfile>();
  /** Room chat burst allowance per player (shared/chat-burst). */
  private chatAt=new Map<string,number>();
  private profileAt=new Map<string,number>();
  constructor(private storage:DurableObjectStorage,private hooks:HubHooks) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS game_hub_state(id INTEGER PRIMARY KEY CHECK(id=1),state_json TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS avatar_profiles(id TEXT PRIMARY KEY,state_json TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS game_rewards(match_id TEXT NOT NULL,player_id TEXT NOT NULL,amount INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(match_id,player_id))');
    const row=storage.sql.exec<{state_json:string}>('SELECT state_json FROM game_hub_state WHERE id=1').toArray()[0];
    this.state=row?JSON.parse(row.state_json):{version:1,visitors:[],rooms:[],receipts:{}};
  }
  private readProfile(id:string):StoredProfile {
    let profile=this.profiles.get(id);
    if(profile)return profile;
    const row=this.storage.sql.exec<{state_json:string}>('SELECT state_json FROM avatar_profiles WHERE id=?',id).toArray()[0];
    profile=row?JSON.parse(row.state_json):{...defaultAvatarProfile(),wins:0,rewardDay:'',dailyEarned:0,receipts:[]};
    profile!.appearance=normalizeAvatarAppearance(profile!.appearance);
    if(this.profiles.size>=256)this.profiles.delete(this.profiles.keys().next().value!);
    this.profiles.set(id,profile!);return profile!;
  }
  private writeProfile(id:string,profile:StoredProfile) {
    this.storage.sql.exec('INSERT INTO avatar_profiles(id,state_json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',id,JSON.stringify(profile));
    this.profiles.set(id,profile);
  }
  /** A stable server-issued token can be paid once per character. The optional
   * progress commit shares this transaction, so neither side can persist alone. */
  awardExternal(id:string,token:string,amount:number,now=Date.now(),commit?:()=>void):number {
    return this.awardExternalBatch(id,[{token,amount}],now,commit);
  }
  awardExternalBatch(id:string,awards:{token:string;amount:number}[],now=Date.now(),commit?:()=>void):number {
    // Only floors of the current tower, each at exactly its own price, are payable.
    if(awards.length>JUMP_RULES.floors||new Set(awards.map(item=>item.token)).size!==awards.length||awards.some(({token,amount})=>{const floor=jumpRewardFloor(token);return floor===null||amount!==jumpFloorReward(floor);}))throw new GameError('JUMP_REWARD','점프 보상 정보를 확인해 주세요.');
    let paid=0;
    try {this.storage.transactionSync(()=>{
      for(const {token,amount} of awards)if(!this.storage.sql.exec('SELECT 1 FROM game_rewards WHERE match_id=? AND player_id=?',token,id).toArray().length){
        this.storage.sql.exec('INSERT INTO game_rewards(match_id,player_id,amount,created_at) VALUES(?,?,?,?)',token,id,amount,now);
        paid+=amount;
      }
      if(paid){const previous=this.readProfile(id);this.writeProfile(id,{...previous,points:previous.points+paid,earned:previous.earned+paid});}
      commit?.();
    });}catch(error){this.profiles.delete(id);throw error;}
    return paid;
  }
  profile(id:string,now=Date.now()):GameProfile {
    const p=this.readProfile(id);
    return {appearance:{...p.appearance},points:p.points,owned:[...p.owned],earned:p.earned,matches:p.matches,wins:p.wins,earnedToday:p.rewardDay===dayKey(now)?p.dailyEarned:0,dailyCap:GAME_RULES.dailyRewardCap};
  }
  appearance(id:string):AvatarAppearance {return {...this.readProfile(id).appearance};}
  owns(id:string,itemId:string):boolean {return this.readProfile(id).owned.includes(itemId);}
  location(id:string):'office'|'games' {return this.state.visitors.includes(id)?'games':'office';}
  /** Best floors raised in memory since the last write of the hub state. */
  private towerDirty=false;
  /** Tower room this player belongs to, or null. The jump authority shares presence, chat and
   * its live ranking only inside this room, and refuses entry without one. */
  towerRoom(id:string):string|null {const room=this.current(id);return room?.kind==='jump-tower'?room.id:null;}
  /** Members of a tower room who are waiting in the room view rather than climbing see its
   * ranking through their lobby state; climbers get the lighter `jump-room` packet instead. */
  private emitTower(room:InternalRoom,now:number) {
    const online=new Set(this.hooks.players().map(player=>player.id));
    for(const member of room.members)if(online.has(member.id)&&(this.hooks.towerFloor?.(member.id)??null)===null)this.emit(member.id,now);
  }
  /** Someone entered or left the tower: refresh the room view of that player's room.
   * Best floors raised during the climb are written here, once, instead of on every ranking tick. */
  towerPresence(id:string,now=Date.now()) {
    const room=this.current(id);if(room?.kind!=='jump-tower')return;
    if(this.towerDirty)this.commit(()=>{room.updatedAt=now;});
    this.emitTower(room,now);
  }
  /** The one room ranking, shown both inside the tower and in the room view. The jump authority
   * reports each climber's best floor of the current climb; the room keeps the best of the whole
   * stay, so stepping out and back in never lowers it. Raised scores stay in memory and are
   * stored with the next room change (any command, a climber stepping out, a disconnect). */
  towerRanking<T extends {id:string;floor:number;bestFloor:number}>(roomId:string,ranking:readonly T[]):T[] {
    const room=this.state.rooms.find(candidate=>candidate.id===roomId);if(!room||room.kind!=='jump-tower')return [...ranking];
    return ranking.map(row=>{
      const member=room.members.find(member=>member.id===row.id&&!member.forfeited);if(!member)return row;
      const best=Number.isSafeInteger(row.bestFloor)?Math.max(0,Math.min(JUMP_RULES.floors,row.bestFloor)):0;
      if(best>member.score){member.score=best;this.towerDirty=true;}
      return member.score===row.bestFloor?row:{...row,bestFloor:member.score};
    }).sort((a,b)=>b.bestFloor-a.bestFloor||b.floor-a.floor||(a.id<b.id?-1:1));
  }
  /** The ranking of a tower room changed: refresh the members who wait in the room view. */
  towerRoomChanged(roomId:string,now=Date.now()) {const room=this.state.rooms.find(candidate=>candidate.id===roomId);if(room?.kind==='jump-tower')this.emitTower(room,now);}
  /** Keeps the best floors of a ranking and refreshes the room view in one call. */
  towerProgress<T extends {id:string;bestFloor:number;floor?:number}>(roomId:string,ranking:readonly T[],now=Date.now()) {
    const room=this.state.rooms.find(candidate=>candidate.id===roomId);if(!room||room.kind!=='jump-tower')return;
    this.towerRanking(roomId,ranking.map(row=>({...row,floor:row.floor??0})));
    this.emitTower(room,now);
  }
  updateAppearance(id:string,value:unknown):AvatarAppearance {
    const previous=this.readProfile(id);let appearance:AvatarAppearance;
    try {appearance=validateOwnedAppearance(value,previous.owned);}catch(error){throw new GameError('AVATAR_INVALID',error instanceof Error?error.message:'캐릭터 설정을 확인해 주세요.');}
    if(JSON.stringify(appearance)!==JSON.stringify(previous.appearance))this.storage.transactionSync(()=>this.writeProfile(id,{...previous,appearance}));
    return {...appearance};
  }
  private current(id:string) {return this.state.rooms.find(room=>room.members.some(member=>member.id===id&&!member.forfeited));}
  private summary(room:InternalRoom):GameRoomSummary {
    return {id:room.id,kind:room.kind,name:gameDefinition(room.kind).name,hostId:room.hostId,hostName:room.members.find(member=>member.id===room.hostId)?.nickname??'',count:room.members.filter(member=>!member.forfeited).length,maxPlayers:gameDefinition(room.kind).maxPlayers,phase:room.phase,practice:room.practice};
  }
  private publicResult(room:InternalRoom,result:GameRoundResult,id:string):GameRoundResult {
    if(room.kind!=='cipher-race')return clone(result);
    const hint=room.members.find(member=>member.id===id)?.hints.find(hint=>hint.round===result.round);
    return {...clone(result),choices:[],...(hint?{myHint:{guess:[...hint.guess],exact:hint.exact,misplaced:hint.misplaced}}:{})};
  }
  snapshot(id:string,now=Date.now()):GameSnapshot {
    const room=this.current(id),online=new Set(this.hooks.players().map(player=>player.id));let view:GameRoomView|null=null;
    if(room){
      const own=room.members.find(member=>member.id===id)!;
      view={...this.summary(room),matchId:room.matchId,round:room.round,totalRounds:gameDefinition(room.kind).rounds,deadline:room.deadline,
        players:room.members.map(member=>({id:member.id,nickname:member.nickname,bot:member.bot,connected:member.bot||online.has(member.id),ready:member.ready,submitted:member.choice!==null,team:member.team,score:member.score,chips:member.chips,solved:member.solved,forfeited:member.forfeited,appearance:member.bot?{...DEFAULT_APPEARANCE,hair:member.id.endsWith('1')?'bob':'curtain'}:this.appearance(member.id),...(room.kind==='jump-tower'?{floor:online.has(member.id)?this.hooks.towerFloor?.(member.id)??null:null}:{})})),
        myChoice:own.choice===null?null:clone(own.choice),myHints:clone(own.hints),prize:room.kind==='blind-auction'&&room.round>0?AUCTION_PRIZES[room.round-1]??null:null,vaults:{...room.vaults},
        lastResult:room.history.length?this.publicResult(room,room.history[room.history.length-1]!,id):null,history:room.history.map(result=>this.publicResult(room,result,id)),results:clone(room.results),secret:room.phase==='finished'&&room.kind==='cipher-race'&&!room.finishReason?[...room.secret]:null,finishReason:room.finishReason,chats:clone(room.chats??[])};
    }
    return {area:this.location(id),rooms:this.state.rooms.filter(room=>room.phase!=='finished'||room.id===view?.id).map(room=>this.summary(room)),room:view,profile:this.profile(id,now),serverTime:now,towerBest:this.hooks.towerBest?.(id)??0};
  }
  private emit(id:string,now:number,requestId?:string) {this.hooks.send(id,{type:'game-state',state:this.snapshot(id,now),...(requestId?{requestId}:{})});}
  private notify(now:number,requestId?:string,actor?:string) {
    // Climbers are busy inside the tower: they get a fresh lobby state when they step back out.
    for(const player of this.hooks.players())if(player.id===actor||this.location(player.id)==='games'&&(this.hooks.towerFloor?.(player.id)??null)===null)this.emit(player.id,now,player.id===actor?requestId:undefined);
  }
  private persist() {this.towerDirty=false;this.storage.sql.exec('INSERT INTO game_hub_state(id,state_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json',JSON.stringify(this.state));}
  private commit(change:()=>void) {
    const before=clone(this.state),profiles=new Map([...this.profiles].map(([id,value])=>[id,clone(value)]));
    try {this.storage.transactionSync(()=>{change();this.persist();});}catch(error){this.state=before;this.profiles=profiles;throw error;}
  }
  private award(room:InternalRoom,now:number) {
    if(room.awarded||room.phase!=='finished')return;room.awarded=true;
    // A solved code locks further guesses; a first-round solver must still qualify.
    const eligible=room.members.filter(member=>!member.bot&&!member.forfeited&&(member.turns>=2||room.kind==='cipher-race'&&member.solved));
    if(room.practice||room.finishReason||eligible.length<2)return;
    for(const member of eligible){
      if(this.storage.sql.exec('SELECT 1 FROM game_rewards WHERE match_id=? AND player_id=?',room.matchId,member.id).toArray().length)continue;
      const result=room.results.find(row=>row.playerId===member.id)!;
      const previous=this.readProfile(member.id),day=dayKey(now),daily=previous.rewardDay===day?previous.dailyEarned:0;
      const amount=Math.max(0,Math.min(GAME_RULES.dailyRewardCap-daily,20+(result.rank===1?40:result.rank===2?20:10)));
      this.storage.sql.exec('INSERT INTO game_rewards(match_id,player_id,amount,created_at) VALUES(?,?,?,?)',room.matchId,member.id,amount,now);
      this.writeProfile(member.id,{...previous,points:previous.points+amount,earned:previous.earned+amount,matches:previous.matches+1,wins:previous.wins+(result.rank===1?1:0),rewardDay:day,dailyEarned:daily+amount});
      result.reward=amount;
    }
  }
  private remove(id:string,now:number,exit:boolean) {
    const room=this.current(id);
    if(room){
      if(room.phase==='waiting'||room.phase==='finished'){
        room.members=room.members.filter(member=>member.id!==id);
        if(!room.members.some(member=>!member.bot))this.state.rooms=this.state.rooms.filter(candidate=>candidate.id!==room.id);
        else if(room.hostId===id)room.hostId=room.members.find(member=>!member.bot)!.id;
      }else{
        const member=room.members.find(member=>member.id===id)!;member.forfeited=true;member.choice=null;
        if(!room.members.some(member=>!member.bot&&!member.forfeited)||!room.practice&&room.members.filter(member=>!member.bot&&!member.forfeited).length<2){finishRoom(room,now,'참가자가 부족해 경기를 종료했어요. 포인트는 지급되지 않습니다.');this.award(room,now);}
        else if(roundComplete(room))resolveRound(room,now);
      }
      room.updatedAt=now;
      if(room.hostId===id){const successor=room.members.find(member=>!member.bot&&!member.forfeited);if(successor)room.hostId=successor.id;}
      if(!room.members.some(member=>!member.bot&&!member.forfeited))this.state.rooms=this.state.rooms.filter(candidate=>candidate.id!==room.id);
    }
    if(exit)this.state.visitors=this.state.visitors.filter(visitor=>visitor!==id);
  }
  joined(id:string,now=Date.now()) {
    const room=this.current(id),member=room?.members.find(member=>member.id===id);
    if(member?.disconnectedAt){this.commit(()=>{delete member.disconnectedAt;});}
    if(room&&!this.state.visitors.includes(id))this.commit(()=>this.state.visitors.push(id));
    this.emit(id,now);this.notify(now);
  }
  left(id:string,now=Date.now()) {
    // The chat allowance outlives the socket: reconnecting must not buy a new burst.
    const room=this.current(id);
    if(room)this.commit(()=>{const member=room.members.find(member=>member.id===id)!;member.disconnectedAt=now;if(room.hostId===id){const next=room.members.find(candidate=>candidate.id!==id&&!candidate.bot&&!candidate.forfeited&&this.hooks.players().some(player=>player.id===candidate.id));if(next)room.hostId=next.id;}});
    else if(this.state.visitors.includes(id)||this.state.receipts[id])this.commit(()=>{this.state.visitors=this.state.visitors.filter(visitor=>visitor!==id);delete this.state.receipts[id];});
    this.notify(now);
  }
  close(now=Date.now()) {
    this.commit(()=>{for(const room of this.state.rooms)if(room.phase==='playing'||room.phase==='reveal'){finishRoom(room,now,'관리자가 게임룸 운영을 종료했어요. 포인트는 지급되지 않습니다.');this.award(room,now);}this.state.visitors=[];this.state.rooms=[];this.state.receipts={};});
    this.chatAt.clear();for(const player of this.hooks.players())this.emit(player.id,now);this.hooks.changed?.();
  }
  nextAlarmAt():number|null {
    const times=this.state.rooms.flatMap(room=>[...(room.deadline!==null?[room.deadline]:[]),...room.members.flatMap(member=>member.disconnectedAt!==undefined&&!member.forfeited?[member.disconnectedAt+60_000]:[]),...(room.phase==='finished'?[room.updatedAt+10*60_000]:[])]);
    return times.length?Math.min(...times):null;
  }
  advance(now=Date.now()) {
    if((this.nextAlarmAt()??Infinity)>now)return;
    this.commit(()=>{
      for(const room of [...this.state.rooms]){
        for(const member of [...room.members])if(member.disconnectedAt!==undefined&&!member.forfeited&&now>=member.disconnectedAt+60_000)this.remove(member.id,now,true);
        if(!this.state.rooms.includes(room))continue;
        advanceRoom(room,now);this.award(room,now);
      }
      this.state.rooms=this.state.rooms.filter(room=>room.phase!=='finished'||now<room.updatedAt+10*60_000);
      const online=new Set(this.hooks.players().map(player=>player.id));
      this.state.visitors=this.state.visitors.filter(id=>online.has(id)||!!this.current(id));
      for(const id of Object.keys(this.state.receipts))if(!online.has(id)&&!this.current(id))delete this.state.receipts[id];
    });
    this.notify(now);this.hooks.changed?.();
  }
  private profileCommand(id:string,input:Record<string,unknown>,now:number) {
    const requestId=socialRequestId(input.requestId),signature=JSON.stringify(input.type==='shop-buy'?{type:input.type,itemId:input.itemId}:{type:input.type,appearance:input.appearance});
    let changed=false;
    try{this.storage.transactionSync(()=>{
      const previous=this.readProfile(id),receipt=previous.receipts.find(receipt=>receipt.id===requestId);
      if(receipt){if(receipt.signature!==signature)throw new GameError('REQUEST_REUSED','이미 보낸 요청의 내용을 바꿀 수 없어요.');return;}
      let profile={...previous,owned:[...previous.owned]};
      if(input.type==='shop-buy'){
        const item=shopItem(input.itemId);if(!item)throw new GameError('SHOP_ITEM','상점 상품을 확인해 주세요.');
        if(!profile.owned.includes(item.id)){if(profile.points<item.price)throw new GameError('SHOP_POINTS','포인트가 부족해요. 친구들과 게임을 마치고 다시 와 주세요.');profile.points-=item.price;profile.owned.push(item.id);}
      }else{
        try{profile.appearance=validateOwnedAppearance(input.appearance,profile.owned);}catch(error){throw new GameError('AVATAR_INVALID',error instanceof Error?error.message:'캐릭터 설정을 확인해 주세요.');}
      }
      changed=profile.points!==previous.points||profile.owned.length!==previous.owned.length||JSON.stringify(profile.appearance)!==JSON.stringify(previous.appearance);
      profile.receipts=[...profile.receipts,{id:requestId,signature}].slice(-GAME_RULES.receiptLimit);this.writeProfile(id,profile);
    });}catch(error){this.profiles.delete(id);throw error;}
    if(changed&&this.hooks.players().some(player=>player.id===id)){this.hooks.changed?.(id);this.notify(now,requestId,id);}
    else this.emit(id,now,requestId);
    return this.profile(id,now);
  }
  handle(id:string,input:Record<string,unknown>,now=Date.now()):boolean {
    const type=input.type;
    if(type==='shop-buy'||type==='avatar-equip'){this.profileCommand(id,input,now);return true;}
    if(typeof type!=='string'||!type.startsWith('game-'))return false;
    const actor=this.hooks.players().find(player=>player.id===id);if(!actor)throw new GameError('GAME_SESSION','사무실에 입장한 뒤 게임룸을 이용해 주세요.');
    this.advance(now);
    if(type==='game-sync'){this.emit(id,now);return true;}
    const requestId=socialRequestId(input.requestId),signature=JSON.stringify({...input,requestId:undefined});
    const previous=this.state.receipts[id]?.find(receipt=>receipt.id===requestId);
    if(previous){if(previous.signature!==signature)throw new GameError('REQUEST_REUSED','이미 보낸 요청의 내용을 바꿀 수 없어요.');this.emit(id,now,requestId);return true;}
    this.commit(()=>{
      const room=this.current(id);
      if(type==='game-enter') {if(!this.state.visitors.includes(id))this.state.visitors.push(id);}
      else if(type==='game-exit')this.remove(id,now,true);
      else if(type==='game-leave')this.remove(id,now,false);
      else if(type==='game-create'){
        if(room)throw new GameError('GAME_ROOM','현재 테이블에서 나온 뒤 새 방을 만들어 주세요.');
        if(!isGameKind(input.kind))throw new GameError('GAME_KIND','게임을 선택해 주세요.');
        if(this.state.rooms.filter(candidate=>candidate.phase!=='finished').length>=GAME_RULES.maxRooms)throw new GameError('GAME_ROOM_FULL','모든 테이블을 사용 중이에요. 열린 방에 참여해 주세요.');
        if(!this.state.visitors.includes(id))this.state.visitors.push(id);
        // A session room is an open room of real players: it has no practice variant.
        const practice=input.practice===true&&!isSessionGame(input.kind),members=[newMember(id,actor.nickname)];
        if(practice)for(let index=1;index<gameDefinition(input.kind).minPlayers;index++)members.push(newMember(`bot-${crypto.randomUUID()}-${index}`,`연습봇 ${index}`,true));
        this.state.rooms.push({id:crypto.randomUUID(),kind:input.kind,hostId:id,practice,phase:'waiting',members,round:0,deadline:null,updatedAt:now,secret:[],vaults:{A:0,B:0},history:[],results:[],finishReason:null,matchId:'',awarded:false,chats:[]});
      }else if(type==='game-join'){
        if(room)throw new GameError('GAME_ROOM','현재 테이블에서 나온 뒤 참여해 주세요.');
        const target=this.state.rooms.find(candidate=>candidate.id===input.roomId);
        if(!target||target.phase!=='waiting'||target.practice)throw new GameError('GAME_JOIN','입장할 수 없는 테이블이에요.');
        if(target.members.length>=gameDefinition(target.kind).maxPlayers)throw new GameError('GAME_ROOM_FULL','테이블의 자리가 모두 찼어요.');
        target.members.push(newMember(id,actor.nickname));target.updatedAt=now;if(!this.state.visitors.includes(id))this.state.visitors.push(id);
      }else{
        if(!room)throw new GameError('GAME_ROOM','먼저 게임 테이블에 참여해 주세요.');
        const member=room.members.find(member=>member.id===id)!;
        // Session rooms have no ready check, rounds or rematch; only the room chat applies.
        if(isSessionGame(room.kind)&&type!=='game-chat')throw new GameError('GAME_SESSION_ROOM','이 방은 준비나 시작 없이 바로 입장하는 방이에요.');
        if(type==='game-ready'){
          if(room.phase!=='waiting'||typeof input.ready!=='boolean')throw new GameError('GAME_READY','대기 중인 테이블에서 준비해 주세요.');member.ready=input.ready;
        }else if(type==='game-start'){
          if(room.hostId!==id)throw new GameError('GAME_HOST','방장만 게임을 시작할 수 있어요.');
          if(room.phase!=='waiting')throw new GameError('GAME_PHASE','이미 게임이 시작됐어요.');
          if(room.members.length<gameDefinition(room.kind).minPlayers||!room.members.every(member=>member.ready&&!member.disconnectedAt))throw new GameError('GAME_READY','필요한 인원이 모두 준비하면 시작할 수 있어요.');
          startRoom(room,now);
        }else if(type==='game-choice'){
          if(room.phase!=='playing'||input.round!==room.round||input.roomId!==room.id||input.matchId!==room.matchId)throw new GameError('GAME_ROUND','라운드가 바뀌었어요. 현재 화면에서 다시 선택해 주세요.');
          if(member.choice!==null)throw new GameError('GAME_SUBMITTED','이미 제출한 선택은 바꿀 수 없어요.');
          member.choice=validateChoice(room,member,input.choice);member.turns++;
          if(roundComplete(room))resolveRound(room,now);
        }else if(type==='game-rematch'){
          if(room.hostId!==id||room.phase!=='finished')throw new GameError('GAME_HOST','경기 종료 후 방장이 다시 열 수 있어요.');
          room.members=room.members.filter(member=>!member.forfeited&&!member.disconnectedAt);room.members=room.members.map(member=>newMember(member.id,member.nickname,member.bot));
          room.phase='waiting';room.round=0;room.deadline=null;room.history=[];room.results=[];room.secret=[];room.finishReason=null;room.vaults={A:0,B:0};
        }else if(type==='game-chat'){
          const text=normalizeChat(input.text),burst=chatBurstTake(this.chatAt.get(id),now);if(!burst.ok)throw new GameError('CHAT_COOLDOWN','조금만 천천히 이야기해 주세요.',burst.retryAt);
          room.chats=[...(room.chats??[]),{id:crypto.randomUUID(),playerId:id,nickname:actor.nickname,text,sentAt:now}].slice(-30);
          if(this.chatAt.size>=256)for(const[key,fullAt]of this.chatAt)if(fullAt<=now)this.chatAt.delete(key);
          this.chatAt.set(id,burst.fullAt);
        }else throw new GameError('GAME_COMMAND','게임 요청을 확인해 주세요.');
        room.updatedAt=now;
      }
      this.state.receipts[id]=[...(this.state.receipts[id]??[]),{id:requestId,signature}].slice(-GAME_RULES.receiptLimit);
    });
    this.notify(now,requestId,id);this.hooks.changed?.(id);return true;
  }
  async route(request:Request,id:string|null,allowed:()=>boolean=()=>true):Promise<Response> {
    if(!id||!/^[a-f0-9]{64}$/.test(id))return json({ok:false,code:'SESSION',message:'브라우저 연결을 확인한 뒤 다시 시도해 주세요.'},401);
    try{
      const path=new URL(request.url).pathname;
      if(request.method==='GET'&&path==='/api/avatar/profile')return json({ok:true,profile:this.profile(id),items:SHOP_ITEMS});
      if(request.method!=='POST'||!['/api/avatar/purchase','/api/avatar/equip','/api/avatar/profile'].includes(path))return json({ok:false,code:'METHOD',message:'요청 방식을 확인해 주세요.'},405);
      const raw=await request.text();if(raw.length>4096)throw new GameError('AVATAR_BODY','요청 내용이 너무 길어요.');
      let value:unknown;try{value=JSON.parse(raw);}catch{throw new GameError('AVATAR_BODY','요청 내용을 확인해 주세요.');}
      if(!value||typeof value!=='object'||Array.isArray(value))throw new GameError('AVATAR_BODY','요청 내용을 확인해 주세요.');
      if(!allowed())throw new GameError('ROOM_CLOSED','입장이 가능한 상태에서 다시 시도해 주세요.');
      const input={...value as Record<string,unknown>,type:path==='/api/avatar/purchase'?'shop-buy':'avatar-equip'},now=Date.now();
      const requestId=socialRequestId((input as Record<string,unknown>).requestId);
      // Receipts remain replayable without broadcasts or repeated writes. New HTTP
      // edits have their own limit because they do not pass the socket bucket.
      if(!this.readProfile(id).receipts.some(receipt=>receipt.id===requestId)){
        if(now<(this.profileAt.get(id)??0)+400)throw new GameError('AVATAR_COOLDOWN','잠깐 기다렸다가 다시 선택해 주세요.');
        if(this.profileAt.size>=256)this.profileAt.delete(this.profileAt.keys().next().value!);
        this.profileAt.set(id,now);
      }
      const profile=this.profileCommand(id,input,now);
      return json({ok:true,profile});
    }catch(error){return json({ok:false,code:error instanceof GameError?error.code:'SERVER_ERROR',message:error instanceof GameError?error.message:'잠시 후 다시 시도해 주세요.'},error instanceof GameError?400:500);}
  }
}
