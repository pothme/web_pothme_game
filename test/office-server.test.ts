import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {createHarness} from './harness.mjs';
import {identity,join,admin,login,origin,password,type Message} from './office-helpers';
import {ROOM_SPAWN,ROOM_BOUNDS,isWalkable} from '../shared/classroom-layout';

test('office welcome has eight requested shared charts and no money, board, games, drops or automatic alarms', {timeout:30000}, async()=>{const{mf,room}=await createHarness();try{
 const client=await join(mf,await identity(mf));assert.equal(client.welcome.market.selected.symbol,'KRX:005930');for(const key of ['balance','nextPlayAt','breadShuttle'])assert.equal(client.welcome.me[key],undefined);for(const key of ['board','survival','drops'])assert.equal(client.welcome[key],undefined);assert.equal((await room.testSnapshot()).alarmAt,null);
 for(const[type,index]of ['rps','write','erase','survival-choice','pickup','chase-catch'].map((v,i)=>[v,i]as const)){client.send({type,requestId:`disabled-${index}`,choice:'rock',text:'forbidden',amount:99999});assert.equal((await client.wait(m=>m.requestId===`disabled-${index}`)).code,'INVALID');}
 await room.testClock(client.welcome.serverTime+3_600_000);const state=await room.testSnapshot();assert.equal(state.accounts[0]!.balance,0);assert.equal(state.alarmAt,null);assert.deepEqual(state.runtime.drops,[]);
}finally{await mf.dispose();}});

test('migration cancels old games/drops without penalties and preserves closed status, balances, board and admin authentication', {timeout:30000},async()=>{const{mf,room,restart}=await createHarness();try{
 const auth=await login(mf);await room.testLegacy(false);await restart();const status=await mf.dispatchFetch(`${origin}/api/status`).then(r=>r.json())as Message;assert.equal(status.roomOpen,false);assert.equal(status.market.selected.symbol,'KRX:005930');const state=await room.testSnapshot();assert.equal(state.accounts[0]!.balance,12345);assert.equal(state.accounts[0]!.next_play_at,987654321);assert.equal(state.accounts[0]!.receipts_json,'[{"legacy":true}]');assert.equal(state.board[0]!.text,'보존할 글');assert.equal(state.legacy!.round,null);assert.equal(state.legacy!.lastRound,null);assert.equal(state.legacy!.nextRoundAt,null);assert.equal(state.legacy!.roundNumber,7);assert.equal(state.alarmAt,null);assert.deepEqual(state.runtime.drops,[]);assert.equal((await admin(mf,'state',undefined,auth.cookie)).status,200);
 assert.equal((await admin(mf,'control',{action:'open'},auth.cookie,auth.csrf)).status,200);assert.equal((await room.testSnapshot()).alarmAt,null);
}finally{await mf.dispose();}});

test('administrator close evicts everyone and blocks reconnect until reopened', {timeout:30000},async()=>{const{mf,room}=await createHarness();try{
 assert.equal((await admin(mf,'state')).status,401);assert.equal((await admin(mf,'control',{action:'close'})).status,401);const auth=await login(mf);assert.equal((await admin(mf,'control',{action:'close'},auth.cookie)).status,403);const cookie=await identity(mf),a=await join(mf,cookie,'첫동료');await join(mf,await identity(mf),'둘동료');a.send({type:'chart-propose',symbol:'NASDAQ:AAPL',requestId:'close-during-vote'});assert.equal((await a.wait(m=>m.requestId==='close-during-vote')).code,'FEATURE_DISABLED');const response=await admin(mf,'control',{action:'close'},auth.cookie,auth.csrf);const state=await response.json()as Message;assert.equal(state.onlineCount,0);assert.equal(state.voteActive,false);assert.equal(state.selectedSymbol,'KRX:005930');await a.wait(m=>m.type==='room-closed');assert.equal((await room.testSnapshot()).alarmAt,null);assert.equal((await mf.dispatchFetch(`${origin}/api/room?nickname=again`,{headers:{Cookie:cookie,Origin:origin,Upgrade:'websocket'}})).status,503);
 await admin(mf,'control',{action:'open'},auth.cookie,auth.csrf);const returned=await join(mf,cookie);assert.equal(returned.welcome.market.vote,null);assert.equal((await admin(mf,'logout',{},auth.cookie,auth.csrf)).status,200);assert.equal((await admin(mf,'state',undefined,auth.cookie)).status,401);
}finally{await mf.dispose();}});

test('admission remains atomic at fifty, names are unique and cross-origin sockets are rejected', {timeout:30000},async()=>{const{mf}=await createHarness();try{
 const cookies=await Promise.all(Array.from({length:51},()=>identity(mf)));const responses=await Promise.all(cookies.map((cookie,i)=>mf.dispatchFetch(`${origin}/api/room?nickname=office${i}`,{headers:{Cookie:cookie,Origin:origin,Upgrade:'websocket'}})));assert.equal(responses.filter(r=>r.status===101).length,50);assert.equal(responses.filter(r=>r.status===503).length,1);const index=responses.findIndex(r=>r.status===101);for(const r of responses)r.webSocket?.accept();const replacement=await join(mf,cookies[index]!,'자리유지');assert.equal(replacement.welcome.players.length,50);
 const readAdmission=async(cookie='',extra:Record<string,string>={})=>await mf.dispatchFetch(`${origin}/api/admission`,{headers:{Cookie:cookie,...extra}}).then(r=>r.json())as Message;
 const visitor=await readAdmission();assert.equal(visitor.allowed,false);assert.equal(visitor.code,'ROOM_FULL');assert.equal(visitor.overflowUrl,'/markets');assert.equal(visitor.onlineCount,50);
 const returning=await readAdmission(cookies[index]!);assert.equal(returning.allowed,true);assert.equal(returning.reconnecting,true);
 assert.equal((await readAdmission('',{'X-Podeumgo-Player':replacement.welcome.me.id})).code,'ROOM_FULL');
 assert.equal((await mf.dispatchFetch(`${origin}/api/room?nickname=attack`,{headers:{Cookie:cookies[index]!,Origin:'https://evil.invalid',Upgrade:'websocket'}})).status,403);
}finally{await mf.dispose();}});

test('public search returns supported US-stock Korean aliases and kind filters without waking the room', {timeout:30000},async()=>{const{mf,room}=await createHarness();try{
 const response=await mf.dispatchFetch(`${origin}/api/markets/search?kind=stock&q=${encodeURIComponent('테슬라')}`).then(r=>r.json())as Message;assert.equal(response.markets[0].symbol,'NASDAQ:TSLA');const stocks=await mf.dispatchFetch(`${origin}/api/markets/search?kind=stock`).then(r=>r.json())as Message;assert.ok(stocks.markets.length>20);assert.ok(stocks.markets.every((m:Message)=>m.kind==='stock'));const crypto=await mf.dispatchFetch(`${origin}/api/markets/search?kind=crypto`).then(r=>r.json())as Message;assert.ok(crypto.markets.every((m:Message)=>m.kind==='crypto'));assert.equal((await room.testSnapshot()).alarmAt,null);
}finally{await mf.dispose();}});

test('admin login limits persist, sessions expire and normal movement cannot teleport or change balances', {timeout:30000},async()=>{const{mf,room,restart}=await createHarness();try{
 for(let i=0;i<5;i++)assert.equal((await admin(mf,'login',{password:'wrong'})).status,401);await restart();assert.equal((await admin(mf,'login',{password})).status,429);await room.testClock(Date.now()+61000,false);const auth=await login(mf);const a=await join(mf,await identity(mf));await room.testClock(a.welcome.serverTime+1500,false);const destination={x:ROOM_SPAWN.x,z:ROOM_SPAWN.z-2.75};assert.ok(isWalkable(destination.x,destination.z));a.send({type:'move',...destination});await a.wait(m=>m.type==='player-moved'&&m.player.id===a.welcome.me.id&&m.player.z===destination.z);await room.testClock(a.welcome.serverTime+3000,false);a.send({type:'move',x:ROOM_BOUNDS.minX+1,z:destination.z});const correction=await a.wait(m=>m.type==='position-correction');assert.equal(correction.x,destination.x);assert.equal(correction.z,destination.z);assert.equal((await room.testSnapshot()).accounts[0]!.balance,0);await room.testClock(Date.now()+9*3600000,false);assert.equal((await admin(mf,'state',undefined,auth.cookie)).status,401);
}finally{await mf.dispose();}});
