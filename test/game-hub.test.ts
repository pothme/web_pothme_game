import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGameHubHarness} from './game-hub-harness.mjs';
import {DEFAULT_APPEARANCE} from '../shared/avatar-appearance';
import {resolveRound,hintFor,newMember,type InternalRoom} from '../server/game-rules';

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
