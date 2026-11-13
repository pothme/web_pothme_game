import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGameHubHarness} from './game-hub-harness.mjs';
import {DEFAULT_APPEARANCE} from '../shared/avatar-appearance';
import {resolveRound,hintFor,newMember,type InternalRoom} from '../server/game-rules';
import {GAME_CATALOG,GAME_CATEGORIES,GAME_KINDS,GAME_RULES,gameDefinition,gamesInCategory,isGameKind,isSessionGame} from '../shared/game-room';
import {JUMP_RULES} from '../shared/jump-game';

const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),D='d'.repeat(64);
let serial=0;
const command=(type:string,extra:Record<string,unknown>={})=>({type,requestId:`test-command-${++serial}`,...extra});
const successful=(result:any)=>{assert.equal(result.ok,true,JSON.stringify(result));return result.state;};
async function openMatch(hub:any,kind='blind-auction',ids=[A,B],now=100_000){
 for(const [index,id]of ids.entries())await hub.connect(id,`참가자${index+1}`,now);
 const created=successful(await hub.command(ids[0],command('game-create',{kind}),now));
 for(const id of ids.slice(1))successful(await hub.command(id,command('game-join',{roomId:created.room.id}),now));
 for(const id of ids)successful(await hub.command(id,command('game-ready',{ready:true}),now));
 return successful(await hub.command(ids[0],command('game-start'),now));
}
const choice=(room:any,value:unknown)=>command('game-choice',{roomId:room.id,matchId:room.matchId,round:room.round,choice:value});

test('sealed choices stay private, duplicate commands cannot spend chips twice, rewards persist exactly once', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=100_000,state=await openMatch(hub);const roomId=state.room.id;
  for(let round=1;round<=5;round++){
   const request=choice(state.room,1);
   successful(await hub.command(A,request,now+1));
   const other=await hub.state(B,now+2);
   assert.equal(other.room.myChoice,null);assert.equal(other.room.players.find((p:any)=>p.id===A).submitted,true);
   assert.equal(other.room.history.length,round-1);
   successful(await hub.command(A,request,now+2));
   const changed=await hub.command(A,{...request,choice:2},now+3);assert.equal(changed.code,'REQUEST_REUSED');
   successful(await hub.command(B,choice(state.room,0),now+4));
   const revealed=await hub.state(A,now+4);assert.equal(revealed.room.phase,'reveal');
   assert.equal(revealed.room.players.find((p:any)=>p.id===A).chips,18-round);
   now=revealed.room.deadline;await hub.advance(now);state=await hub.state(A,now);
  }
  assert.equal(state.room.phase,'finished');assert.equal(state.room.id,roomId);
  assert.equal(state.profile.points,60);assert.equal(state.profile.matches,1);assert.equal(state.profile.wins,1);
  assert.equal((await hub.state(B,now)).profile.points,40);
  await hub.advance(now+10);await hub.resetHub();await hub.advance(now+20);
  assert.equal((await hub.state(A,now+20)).profile.points,60);assert.equal((await hub.rewards()).length,2);
 }finally{await mf.dispose();}
});

test('cipher hints and secret never leak before finish and guesses reject duplicate digits', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=200_000,state=await openMatch(hub,'cipher-race',[A,B],now);
  const secret=(await hub.internal()).rooms[0].secret;
  assert.equal(state.room.secret,null);
  assert.equal((await hub.command(A,choice(state.room,[1,1,2]),now+1)).code,'GAME_CHOICE');
  const first=choice(state.room,[1,2,3]);successful(await hub.command(A,first,now+2));
  const other=await hub.state(B,now+3);assert.equal(other.room.myChoice,null);assert.deepEqual(other.room.myHints,[]);assert.equal(other.room.secret,null);
  successful(await hub.command(B,choice(state.room,[4,5,6]),now+4));
  const b=await hub.state(B,now+4);assert.deepEqual(b.room.myHints[0].guess,[4,5,6]);assert.deepEqual(b.room.history[0].choices,[]);
  assert.deepEqual(b.room.lastResult.myHint.guess,[4,5,6]);
  now=b.room.deadline;await hub.advance(now);state=await hub.state(A,now);
  if(!state.room.players.find((p:any)=>p.id===A).solved)successful(await hub.command(A,choice(state.room,secret),now+1));
  const b2=await hub.state(B,now+2);if(!b2.room.players.find((p:any)=>p.id===B).solved)successful(await hub.command(B,choice(b2.room,secret),now+3));
  const revealed=await hub.state(A,now+3);await hub.advance(revealed.room.deadline);
  const done=await hub.state(A,revealed.room.deadline);assert.equal(done.room.phase,'finished');assert.deepEqual(done.room.secret,secret);
 }finally{await mf.dispose();}
});

test('purchases are atomic and idempotent, locked equipment cannot be forged and ownership survives reload', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  await hub.connect(A,'꾸미기',300_000);await hub.seedPoints(A,100);
  const premium={...DEFAULT_APPEARANCE,top:'blazer-night'};
  assert.equal((await hub.command(A,command('avatar-equip',{appearance:premium}),300_001)).code,'AVATAR_INVALID');
  const buy=command('shop-buy',{itemId:'outfit-night'});
  const bought=successful(await hub.command(A,buy,300_002));assert.equal(bought.profile.points,0);assert.deepEqual(bought.profile.owned,['outfit-night']);
  successful(await hub.command(A,buy,300_003));assert.equal((await hub.state(A,300_003)).profile.points,0);
  assert.equal((await hub.command(A,{...buy,itemId:'action-dance'},300_004)).code,'REQUEST_REUSED');
  successful(await hub.command(A,command('avatar-equip',{appearance:premium}),300_005));
  assert.equal((await hub.command(A,command('shop-buy',{itemId:'action-dance'}),300_006)).code,'SHOP_POINTS');
  await hub.resetHub();const restored=await hub.state(A,300_010);assert.equal(restored.profile.appearance.top,'blazer-night');assert.equal(restored.profile.points,0);
  const invalid=await hub.request('https://example.com/api/avatar/profile',null);assert.equal(invalid.status,401);
 }finally{await mf.dispose();}
});

test('practice games are clearly labeled, reconnect preserves submitted choice, deadlines default missing inputs', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=400_000;await hub.connect(A,'연습참가자',now);
  let state=successful(await hub.command(A,command('game-create',{kind:'blind-auction',practice:true}),now));
  assert.equal(state.room.practice,true);assert.equal(state.room.players.filter((p:any)=>p.bot).length,1);assert.match(state.room.players.find((p:any)=>p.bot).nickname,/연습봇/);
  successful(await hub.command(A,command('game-ready',{ready:true}),now));state=successful(await hub.command(A,command('game-start'),now));
  successful(await hub.command(A,choice(state.room,2),now+1));await hub.disconnect(A,now+2);await hub.resetHub();state=await hub.connect(A,'연습참가자',now+3);
  assert.equal(state.room.myChoice,2);assert.equal(state.room.phase,'reveal');
  for(let i=0;i<12&&state.room.phase!=='finished';i++){now=state.room.deadline;await hub.advance(now);state=await hub.state(A,now);}
  assert.equal(state.room.phase,'finished');assert.equal(state.profile.points,0);assert.equal(state.profile.matches,0);
  assert.equal((await hub.rewards()).length,0);
 }finally{await mf.dispose();}
});

test('stale match input is rejected, early leaving cancels without rewards, close stops all alarms', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  const now=500_000,state=await openMatch(hub,'blind-auction',[A,B],now);
  assert.equal((await hub.command(A,{...choice(state.room,1),matchId:'previous-match'},now+1)).code,'GAME_ROUND');
  successful(await hub.command(B,command('game-exit'),now+2));
  const done=await hub.state(A,now+3);assert.equal(done.room.phase,'finished');assert.match(done.room.finishReason,/포인트/);assert.equal(done.profile.points,0);
  await hub.close(now+5);assert.equal(await hub.nextAlarm(),null);assert.equal((await hub.state(A,now+5)).area,'office');
 }finally{await mf.dispose();}
});

test('team investments, guards and betrayal resolve deterministically with rotating guard priority',()=>{
 const members=[newMember(A,'A1'),newMember(B,'B1'),newMember(C,'A2'),newMember(D,'B2')];members.forEach((m,i)=>m.team=i%2?'B':'A');
 const room:InternalRoom={id:'room',kind:'vault-dilemma',hostId:A,practice:false,phase:'playing',members,round:1,deadline:30_000,updatedAt:0,secret:[],vaults:{A:0,B:0},history:[],results:[],finishReason:null,matchId:'match',awarded:false,chats:[]};
 members[0]!.choice='invest';members[2]!.choice='steal';members[1]!.choice='guard';members[3]!.choice='steal';
 resolveRound(room,1);
 assert.equal(room.vaults.A,1);assert.equal(members[2]!.score,4);assert.equal(room.vaults.B,1);assert.equal(members[3]!.score,-1);
 assert.equal(room.history[0]!.choices.length,4);
 assert.deepEqual(hintFor([1,2,3],[1,3,4]),{exact:1,misplaced:1});
});

test('first-round cipher solvers receive rewards despite having no further legal guesses', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=600_000,state=await openMatch(hub,'cipher-race',[A,B],now);
  const secret=(await hub.internal()).rooms[0].secret;
  successful(await hub.command(A,choice(state.room,secret),now+1));
  const wrong=[...secret].reverse();successful(await hub.command(B,choice(state.room,wrong),now+2));
  state=await hub.state(A,now+3);now=state.room.deadline;await hub.advance(now);
  state=await hub.state(B,now);successful(await hub.command(B,choice(state.room,secret),now+1));
  state=await hub.state(A,now+2);await hub.advance(state.room.deadline);
  assert.equal((await hub.state(A,state.room.deadline)).profile.points,60);
  assert.equal((await hub.state(B,state.room.deadline)).profile.points,40);
 }finally{await mf.dispose();}
});

test('abandoned practice rooms cannot consume all lobby capacity', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=700_000;await hub.connect(A,'연습하는사람',now);
  for(let i=0;i<16;i++){
   successful(await hub.command(A,command('game-create',{kind:'blind-auction',practice:true}),now++));
   successful(await hub.command(A,command('game-ready',{ready:true}),now++));
   successful(await hub.command(A,command('game-start'),now++));
   successful(await hub.command(A,command('game-leave'),now++));
  }
  const state=await hub.state(A,now);assert.deepEqual(state.rooms,[]);assert.equal(await hub.nextAlarm(),null);
  assert.equal(state.profile.points,0);assert.equal((await hub.internal()).rooms.length,0);
 }finally{await mf.dispose();}
});

test('lobby-only disconnects remove receipt records even after returning to the office', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  await hub.connect(A,'잠깐방문',800_000);successful(await hub.command(A,command('game-enter'),800_001));successful(await hub.command(A,command('game-exit'),800_002));
  assert.ok((await hub.internal()).receipts[A]);await hub.disconnect(A,800_003);assert.equal((await hub.internal()).receipts[A],undefined);assert.equal(await hub.nextAlarm(),null);
 }finally{await mf.dispose();}
});

test('an active host leaving transfers table control to a remaining participant', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  const now=900_000;await openMatch(hub,'blind-auction',[A,B,C],now);
  successful(await hub.command(A,command('game-exit'),now+1));const remaining=await hub.state(B,now+2);
  assert.equal(remaining.room.phase,'playing');assert.equal(remaining.room.hostId,B);assert.equal(remaining.room.players.find((p:any)=>p.id===A).forfeited,true);
 }finally{await mf.dispose();}
});

test('rewards clamp at the daily cap and the KST day resets the allowance without losing inventory points', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=1_000_000,state=await openMatch(hub,'blind-auction',[A,B],now);await hub.seedDaily(A,490,now);await hub.seedDaily(B,500,now);
  for(let round=0;round<5;round++){
   successful(await hub.command(A,choice(state.room,1),now+1));successful(await hub.command(B,choice(state.room,0),now+2));
   state=await hub.state(A,now+2);now=state.room.deadline;await hub.advance(now);state=await hub.state(A,now);
  }
  assert.equal(state.profile.points,500);assert.equal(state.profile.earnedToday,500);assert.equal(state.room.results.find((p:any)=>p.playerId===A).reward,10);
  const other=await hub.state(B,now);assert.equal(other.profile.points,500);assert.equal(other.room.results.find((p:any)=>p.playerId===B).reward,0);
  await hub.resetHub();const nextDay=await hub.state(A,now+24*3600000);assert.equal(nextDay.profile.points,500);assert.equal(nextDay.profile.earnedToday,0);assert.equal((await hub.rewards()).length,2);
 }finally{await mf.dispose();}
});

test('the catalog shelves every game under one category and the tower is the open-session action game',()=>{
 assert.deepEqual(GAME_CATEGORIES.map(category=>category.id),['strategy','action']);
 assert.deepEqual(GAME_CATEGORIES.map(category=>category.name),['전략 게임','액션 게임']);
 assert.deepEqual(gamesInCategory('strategy').map(game=>game.id),['blind-auction','vault-dilemma','cipher-race']);
 assert.deepEqual(gamesInCategory('action').map(game=>game.id),['jump-tower']);
 assert.deepEqual(GAME_CATALOG.map(game=>game.id),[...GAME_KINDS],'every kind has exactly one catalog entry');
 for(const game of GAME_CATALOG){
  assert.ok(GAME_CATEGORIES.some(category=>category.id===game.category),game.id);
  assert.equal(isSessionGame(game.id),game.category==='action');assert.equal(game.mode,game.category==='action'?'session':'match');
  assert.ok(game.minPlayers>=1&&game.maxPlayers>=game.minPlayers&&game.rules.length>0&&game.tag.length>0);
 }
 const tower=gameDefinition('jump-tower');
 assert.equal(tower.name,'점프 타워');assert.equal(tower.minPlayers,1);assert.equal(tower.maxPlayers,12);assert.equal(tower.rounds,0);
 assert.equal(isGameKind('jump-tower'),true);assert.equal(isGameKind('jump'),false);
 const text=tower.rules.join(' ');
 assert.match(text,/1층부터/);assert.match(text,new RegExp(`${JUMP_RULES.summitReward}PT`));assert.match(text,new RegExp(`${JUMP_RULES.maxRewardPoints}PT`));
 assert.equal(JUMP_RULES.floors*JUMP_RULES.floorReward+JUMP_RULES.summitReward,600);
});

test('a tower room is an open session: no bots, ready check or rounds, joinable while members climb, capped at twelve', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=2_000_000;const ids=Array.from({length:14},(_,index)=>index.toString(16).padStart(2,'0').repeat(32));
  for(const [index,id]of ids.entries())await hub.connect(id,`등반가${index+1}`,now);
  const [host,second,outsider]=ids as [string,string,string];
  assert.equal(await hub.towerRoom(host),null,'the lobby alone is not a tower room');
  const created=successful(await hub.command(host,command('game-create',{kind:'jump-tower',practice:true}),++now));
  assert.equal(created.room.kind,'jump-tower');assert.equal(created.room.practice,false);assert.equal(created.room.players.length,1,'no practice bots');
  assert.equal(created.room.phase,'waiting');assert.equal(created.room.maxPlayers,12);assert.equal(created.room.hostName,'등반가1');assert.equal(created.area,'games');
  assert.equal(await hub.towerRoom(host),created.room.id);
  const listed=(await hub.state(second,now)).rooms;
  assert.deepEqual(listed.map((row:any)=>[row.kind,row.name,row.hostName,row.count,row.maxPlayers,row.phase]),[['jump-tower','점프 타워','등반가1',1,12,'waiting']]);
  // A strategy table is never a tower room, and one seat at a time still applies.
  const table=successful(await hub.command(outsider,command('game-create',{kind:'blind-auction'}),++now));
  assert.equal(await hub.towerRoom(outsider),null);
  assert.equal((await hub.command(outsider,command('game-join',{roomId:created.room.id}),++now)).code,'GAME_ROOM');
  assert.equal((await hub.command(host,command('game-join',{roomId:table.room.id}),++now)).code,'GAME_ROOM');
  successful(await hub.command(outsider,command('game-leave'),++now));
  // The host is already climbing when the second member arrives.
  await hub.setTower(host,37);
  const joined=successful(await hub.command(second,command('game-join',{roomId:created.room.id}),++now));
  assert.equal(await hub.towerRoom(second),created.room.id);
  assert.deepEqual(joined.room.players.map((player:any)=>[player.nickname,player.floor,player.score]),[['등반가1',37,0],['등반가2',null,0]]);
  for(const [type,extra]of [['game-ready',{ready:true}],['game-start',{}],['game-rematch',{}],['game-choice',{roomId:created.room.id,matchId:'',round:0,choice:1}],['game-unknown',{}]] as const)
   assert.equal((await hub.command(host,command(type,extra),++now)).code,'GAME_SESSION_ROOM',type);
  assert.equal((await hub.state(host,now)).room.phase,'waiting');
  const chatted=successful(await hub.command(second,command('game-chat',{text:'같이 올라가요'}),++now));
  assert.equal(chatted.room.chats.at(-1).text,'같이 올라가요');
  // Progress comes from the jump authority; the room keeps each member's best floor.
  await hub.clearMessages();await hub.towerProgress(created.room.id,[{id:host,bestFloor:41},{id:'f'.repeat(64),bestFloor:99}],++now);
  assert.equal((await hub.messages(host)).length,0,'a climber is not interrupted by lobby state');
  const pushed=(await hub.messages(second)).at(-1);assert.equal(pushed.type,'game-state');
  assert.deepEqual(pushed.state.room.players.map((player:any)=>[player.floor,player.score]),[[37,41],[null,0]]);
  await hub.towerProgress(created.room.id,[{id:host,bestFloor:12},{id:second,bestFloor:1000}],++now);
  const scores=async()=>(await hub.state(second,now)).room.players.map((player:any)=>player.score);
  assert.deepEqual(await scores(),[41,JUMP_RULES.floors],'a best floor never drops and never exceeds the tower');
  await hub.towerProgress(table.room.id,[{id:outsider,bestFloor:50}],++now);await hub.towerProgress('missing',[{id:host,bestFloor:50}],++now);
  assert.equal((await scores())[0],41);
  // One ranking for the tower panel and the room view: a member who stepped out and climbs again
  // (the jump authority restarts its count at 0) keeps the best floor of the whole stay.
  const merged=await hub.towerRanking(created.room.id,[{id:second,nickname:'등반가2',floor:3,bestFloor:3},{id:host,nickname:'등반가1',floor:5,bestFloor:5},{id:'f'.repeat(64),nickname:'손님',floor:9,bestFloor:9}]);
  assert.deepEqual(merged.map((row:any)=>[row.nickname,row.floor,row.bestFloor]),[['등반가2',3,JUMP_RULES.floors],['등반가1',5,41],['손님',9,9]]);
  assert.deepEqual(await hub.towerRanking('missing',[{id:host,nickname:'등반가1',floor:5,bestFloor:5}]),[{id:host,nickname:'등반가1',floor:5,bestFloor:5}]);
  // Ranking ticks do not rewrite the stored lobby; the scores are written when a climber steps out.
  assert.deepEqual((await hub.internal()).rooms[0].members.map((member:any)=>member.score),[0,0]);
  await hub.towerPresence(host,++now);
  assert.deepEqual((await hub.internal()).rooms[0].members.map((member:any)=>member.score),[41,JUMP_RULES.floors]);
  await hub.towerRanking(created.room.id,[{id:host,nickname:'등반가1',floor:50,bestFloor:50}]);
  assert.equal((await hub.internal()).rooms[0].members[0].score,41,'not written yet');
  now+=5_000;successful(await hub.command(second,command('game-chat',{text:'50층!'}),now));
  assert.equal((await hub.internal()).rooms[0].members[0].score,50,'any room change stores the raised floors');
  // Lobby changes reach members who wait in the room, not the ones inside the tower.
  await hub.clearMessages();successful(await hub.command(outsider,command('game-enter'),++now));
  assert.equal((await hub.messages(second)).some((packet:any)=>packet.type==='game-state'),true);assert.equal((await hub.messages(host)).length,0);
  // Stepping out of the tower refreshes the room view of everyone who is not climbing.
  await hub.setTower(host,null);await hub.clearMessages();await hub.towerPresence(host,++now);
  assert.equal((await hub.messages(host)).at(-1).state.room.players[0].floor,null);assert.equal((await hub.messages(second)).length,1);
  // Ten more members fill the room; the thirteenth is refused.
  for(const id of ids.slice(2,12))successful(await hub.command(id,command('game-join',{roomId:created.room.id}),++now));
  assert.equal((await hub.state(host,now)).room.players.length,12);assert.equal((await hub.state(ids[12]!,now)).rooms[0].count,12);
  assert.equal((await hub.command(ids[12]!,command('game-join',{roomId:created.room.id}),++now)).code,'GAME_ROOM_FULL');
  // Leaving returns to the lobby and hands the room on; the last member closes it.
  const left=successful(await hub.command(host,command('game-leave'),++now));
  assert.equal(left.room,null);assert.equal(left.area,'games');assert.equal(await hub.towerRoom(host),null);assert.equal(left.rooms[0].hostName,'등반가2');assert.equal(left.rooms[0].count,11);
  const rejoined=successful(await hub.command(host,command('game-join',{roomId:created.room.id}),++now));
  assert.equal(rejoined.room.players.find((player:any)=>player.id===host).score,0,'the best floor belongs to one stay in the room');
  for(const id of ids.slice(0,12).reverse()){const out=successful(await hub.command(id,command('game-exit'),++now));assert.equal(out.area,'office');assert.equal(await hub.location(id),'office');}
  assert.deepEqual((await hub.internal()).rooms,[]);assert.equal(await hub.nextAlarm(),null);
 }finally{await mf.dispose();}
});

test('a disconnected tower member keeps the seat for a minute, then the empty room closes and the room limit is shared', {timeout:30_000},async()=>{
 const {mf,hub}=await createGameHubHarness();try{
  let now=3_000_000;await hub.connect(A,'혼자오른사람',now);await hub.connect(B,'친구',now);
  const created=successful(await hub.command(A,command('game-create',{kind:'jump-tower'}),++now));
  successful(await hub.command(B,command('game-join',{roomId:created.room.id}),++now));
  await hub.disconnect(A,++now);const lostAt=now;
  assert.equal(await hub.towerRoom(A),created.room.id,'the seat is kept while reconnecting');
  const waiting=await hub.state(B,now);assert.equal(waiting.room.players.find((player:any)=>player.id===A).connected,false);assert.equal(waiting.room.hostId,B,'a connected member takes over the room');
  assert.equal(await hub.nextAlarm(),lostAt+60_000);
  // Back within the minute: the same seat.
  await hub.connect(A,'혼자오른사람',lostAt+30_000);assert.equal(await hub.towerRoom(A),created.room.id);assert.equal(await hub.nextAlarm(),null);
  assert.equal((await hub.state(A,lostAt+30_000)).area,'games');
  await hub.disconnect(A,lostAt+40_000);await hub.disconnect(B,lostAt+41_000);
  const changes=await hub.changeCount();await hub.advance(lostAt+100_000);
  assert.equal(await hub.towerRoom(A),null);assert.equal(await hub.towerRoom(B),created.room.id);assert.ok(await hub.changeCount()>changes,'membership changes are announced to the jump authority');
  await hub.advance(lostAt+101_000);
  assert.equal(await hub.towerRoom(B),null);assert.deepEqual((await hub.internal()).rooms,[]);assert.deepEqual((await hub.internal()).visitors,[]);assert.equal(await hub.nextAlarm(),null);
  // Tower rooms count against the same table limit as every other game.
  now=lostAt+200_000;const ids=Array.from({length:GAME_RULES.maxRooms+1},(_,index)=>(index+32).toString(16).padStart(2,'0').repeat(32));
  for(const [index,id]of ids.entries())await hub.connect(id,`방장${index+1}`,now);
  for(const [index,id]of ids.slice(0,GAME_RULES.maxRooms).entries())successful(await hub.command(id,command('game-create',{kind:index%2?'jump-tower':'cipher-race'}),++now));
  assert.equal((await hub.command(ids.at(-1)!,command('game-create',{kind:'jump-tower'}),++now)).code,'GAME_ROOM_FULL');
  await hub.close(++now);assert.equal(await hub.towerRoom(ids[1]!),null);assert.deepEqual((await hub.internal()).rooms,[]);
 }finally{await mf.dispose();}
});
