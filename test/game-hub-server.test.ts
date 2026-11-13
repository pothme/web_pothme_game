import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
import {identity,join,observe,origin,login,admin,type Message} from './office-helpers';
import {DEFAULT_APPEARANCE} from '../shared/avatar-appearance';
import {CHAT_BURST} from '../shared/chat-burst';

test('whispers authenticate both names, reach only the two peers, deduplicate and stay out of public history', {timeout:30_000},async()=>{
 const {mf,room}=await createHarness();try{
  const cookie=await identity(mf),a=await join(mf,cookie,'귓말보내는사람'),b=await join(mf,await identity(mf),'귓말받는사람'),c=await join(mf,await identity(mf),'구경하는사람');
  a.messages.length=b.messages.length=c.messages.length=0;
  const input={type:'whisper',to:b.welcome.me.id,text:'  비밀\n전략  ',requestId:'whisper-original',fromId:c.welcome.me.id,fromNickname:'가짜이름'};
  a.send(input);const own=await a.wait(m=>m.type==='whisper'),heard=await b.wait(m=>m.type==='whisper');
  assert.equal(own.message.fromId,a.welcome.me.id);assert.equal(own.message.fromNickname,'귓말보내는사람');assert.equal(own.message.toNickname,'귓말받는사람');assert.equal(own.message.text,'비밀 전략');assert.deepEqual(heard.message,own.message);
  assert.equal(c.messages.some(m=>m.type==='whisper'||m.type==='chat'||m.type==='action-notice'),false);
  a.send(input);assert.equal((await a.wait(m=>m.type==='whisper')).message.id,own.message.id);assert.equal(b.messages.some(m=>m.type==='whisper'),false);
  a.send({...input,text:'바뀐 내용'});assert.equal((await a.wait(m=>m.requestId===input.requestId)).code,'REQUEST_REUSED');
  // A burst of five goes straight through (the replay above cost nothing); the sixth names the time of the next token.
  for(let index=0;index<4;index++){const requestId=`whisper-burst-${index}`;a.send({...input,text:`연속 ${index}`,requestId});assert.equal((await a.wait(m=>m.requestId===requestId)).type,'whisper');assert.equal((await b.wait(m=>m.type==='whisper')).message.text,`연속 ${index}`);}
  a.send({...input,requestId:'whisper-fast'});const limited=await a.wait(m=>m.requestId==='whisper-fast');assert.equal(limited.code,'WHISPER_COOLDOWN');assert.equal(limited.retryAt,own.message.sentAt+CHAT_BURST.refillMs);
  a.send({...input,to:a.welcome.me.id,requestId:'whisper-self'});assert.equal((await a.wait(m=>m.requestId==='whisper-self')).code,'WHISPER_RECIPIENT');
  await room.testClock(own.message.sentAt+1100,false);
  a.send({...input,to:'0'.repeat(64),requestId:'whisper-missing'});assert.equal((await a.wait(m=>m.requestId==='whisper-missing')).code,'WHISPER_OFFLINE');
  a.send({...input,text:'<script>',requestId:'whisper-invalid'});assert.equal((await a.wait(m=>m.requestId==='whisper-invalid')).code,'WHISPER_TEXT');
  const replacement=await join(mf,cookie,'새닉네임');assert.deepEqual(replacement.welcome.chats,[]);
  replacement.send(input);assert.equal((await replacement.wait(m=>m.type==='whisper')).message.id,own.message.id);assert.equal(b.messages.some(m=>m.type==='whisper'),false);
  const newcomer=await join(mf,await identity(mf),'새방문자');assert.deepEqual(newcomer.welcome.chats,[]);
 }finally{await mf.dispose();}
});

test('avatar HTTP identity, equipped appearance and premium actions/stickers are server-owned', {timeout:30_000},async()=>{
 const {mf,room,restart}=await createHarness();try{
  const cookieA=await identity(mf),cookieB=await identity(mf),a=await join(mf,cookieA,'꾸미는사람'),b=await join(mf,cookieB,'구경하는사람');
  // Freeze the worker's clock: wall-clock setup under the full parallel suite can
  // exceed 500ms, so a client-side initial timestamp could move time backwards.
  let clock=await room.testFreezeClock();
  const profile=async(cookie:string)=>await(await mf.dispatchFetch(`${origin}/api/avatar/profile`,{headers:{Cookie:cookie}})).json() as Message;
  const post=async(path:string,body:unknown,cookie=cookieA,extra:Record<string,string>={})=>mf.dispatchFetch(`${origin}/api/avatar/${path}`,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal(a.welcome.avatarProfile.points,0);assert.equal(a.welcome.me.appearance.species,'human');
  assert.equal((await mf.dispatchFetch(`${origin}/api/avatar/profile`,{headers:{'X-Podeumgo-Player':a.welcome.me.id}})).status,401);
  assert.equal((await post('equip',{},cookieA,{Origin:'https://elsewhere.test'})).status,403);
  assert.equal((await mf.dispatchFetch(`${origin}/api/avatar/purchase`,{method:'GET',headers:{Cookie:cookieA}})).status,405);
  a.send({type:'avatar-action',kind:'dance',requestId:'locked-dance'});assert.equal((await a.wait(m=>m.requestId==='locked-dance')).code,'ITEM_LOCKED');
  a.send({type:'chat-sticker',itemId:'emoji-cat',requestId:'locked-sticker'});assert.equal((await a.wait(m=>m.requestId==='locked-sticker')).code,'ITEM_LOCKED');
  const locked=await post('equip',{appearance:{...DEFAULT_APPEARANCE,top:'blazer-night'},requestId:'locked-outfit'});assert.equal((await locked.json() as Message).code,'AVATAR_INVALID');
  await room.testAvatarPoints(a.welcome.me.id,300);
  const forged=await post('purchase',{itemId:'action-dance',requestId:'forged-purchase'},cookieB,{'X-Podeumgo-Player':a.welcome.me.id});assert.equal((await forged.json() as Message).code,'SHOP_POINTS');assert.equal((await profile(cookieA)).profile.points,300);
  for(const [index,itemId]of ['action-dance','emoji-cat','outfit-night'].entries()){
   await room.testClock(clock+=500,false);
   const request={itemId,requestId:`purchase-${index}`},response=await post('purchase',request);assert.equal(response.status,200,await response.clone().text());assert.equal((await post('purchase',request)).status,200);
  }
  assert.equal((await profile(cookieA)).profile.points,20);
  const limited=await post('purchase',{itemId:'outfit-night',requestId:'rate-limited-purchase'});assert.equal((await limited.json() as Message).code,'AVATAR_COOLDOWN');
  b.messages.length=0;await post('purchase',{itemId:'outfit-night',requestId:'purchase-2'});assert.equal(b.messages.some(m=>m.type==='players'),false,'receipt replays do not broadcast another roster');
  await room.testClock(clock+=500,false);
  const appearance={...DEFAULT_APPEARANCE,species:'cat',hair:'bob',top:'blazer-night'};
  const equipped=await post('equip',{appearance,requestId:'equip-owned'});assert.equal(equipped.status,200);assert.deepEqual((await equipped.json() as Message).profile.appearance,appearance);
  const roster=await b.wait(m=>m.type==='players'&&m.players.some((p:Message)=>p.id===a.welcome.me.id&&p.appearance.top==='blazer-night'));assert.equal(roster.players.find((p:Message)=>p.id===a.welcome.me.id).appearance.species,'cat');
  a.send({type:'avatar-action',kind:'dance',requestId:'owned-dance'});assert.equal((await a.wait(m=>m.requestId==='owned-dance'&&m.type==='avatar-action')).action.kind,'dance');
  a.send({type:'chat-sticker',itemId:'emoji-cat',text:'forged',requestId:'owned-sticker'});assert.equal((await b.wait(m=>m.type==='chat'&&m.requestId==='owned-sticker')).message.text,'😺 할 수 있어!');
  await restart();assert.deepEqual((await profile(cookieA)).profile.appearance,appearance);assert.equal((await profile(cookieA)).profile.points,20);assert.equal((await profile(cookieB)).profile.points,0);
 }finally{await mf.dispose();}
});

test('join preflight validates without saving appearance, and actual join persists only owned options', {timeout:30_000},async()=>{
 const {mf}=await createHarness();try{
  const cookie=await identity(mf),appearance={...DEFAULT_APPEARANCE,species:'butterfly',skin:'tan',hair:'pony'};
  const query=`nickname=${encodeURIComponent('나비친구')}&appearance=${encodeURIComponent(JSON.stringify(appearance))}`;
  const check=await mf.dispatchFetch(`${origin}/api/join-check?${query}`,{headers:{Cookie:cookie,Origin:origin}});assert.equal(check.status,200);
  let profile=await(await mf.dispatchFetch(`${origin}/api/avatar/profile`,{headers:{Cookie:cookie}})).json() as Message;assert.equal(profile.profile.appearance.species,'human');
  const response=await mf.dispatchFetch(`${origin}/api/room?${query}`,{headers:{Cookie:cookie,Origin:origin,Upgrade:'websocket'}});assert.equal(response.status,101);const peer=observe(response.webSocket!);const welcome=await peer.wait(m=>m.type==='welcome');assert.deepEqual(welcome.me.appearance,appearance);
  profile=await(await mf.dispatchFetch(`${origin}/api/avatar/profile`,{headers:{Cookie:cookie}})).json() as Message;assert.deepEqual(profile.profile.appearance,appearance);
  const invalid=await mf.dispatchFetch(`${origin}/api/join-check?nickname=valid&appearance=${encodeURIComponent(JSON.stringify({...appearance,top:'blazer-gold'}))}`,{headers:{Cookie:cookie,Origin:origin}});assert.equal(invalid.status,400);
 }finally{await mf.dispose();}
});

test('24 long Unicode whisper receipts survive hibernation without overflowing socket attachments and expire privately', {timeout:30_000},async()=>{
 const {mf,room,restart}=await createHarness();try{
  const cookieA=await identity(mf),cookieB=await identity(mf);let a=await join(mf,cookieA,'긴귓말보내기'),b=await join(mf,cookieB,'긴귓말받기');
  let now=Date.now(),last:Message|undefined,lastInput:Message|undefined;
  for(let i=0;i<26;i++){
   await room.testClock(now+=1100,false);
   lastInput={type:'whisper',to:b.welcome.me.id,text:'😀'.repeat(160),requestId:`unicode-whisper-${String(i).padStart(2,'0')}-${'x'.repeat(65)}`};a.send(lastInput);
   last=await a.wait(m=>m.requestId===lastInput!.requestId);assert.equal(last.type,'whisper',JSON.stringify(last));assert.equal([...last.message.text].length,160);
   assert.equal((await b.wait(m=>m.type==='whisper'&&m.message.id===last!.message.id)).message.text,last.message.text);
  }
  const snapshot=await room.testSnapshot();assert.ok(snapshot.alarmAt);assert.equal('whisperReceipts' in snapshot.attachments.find(p=>p.id===a.welcome.me.id)!,false);assert.ok(new TextEncoder().encode(JSON.stringify(snapshot.attachments[0])).length<16384);
  await restart();a=await join(mf,cookieA,'긴귓말보내기');b=await join(mf,cookieB,'긴귓말받기');a.send(lastInput!);assert.equal((await a.wait(m=>m.type==='whisper')).message.id,last!.message.id);assert.equal(b.messages.some(m=>m.type==='whisper'),false);assert.deepEqual(b.welcome.chats,[]);
  await room.testClock(last!.message.sentAt+10*60_000+1);assert.equal((await room.testSnapshot()).alarmAt,null);
 }finally{await mf.dispose();}
});

test('game tables integrate with room presence, private choices, shared alarms and administrator closure', {timeout:30_000},async()=>{
 const {mf,room}=await createHarness();try{
  const a=await join(mf,await identity(mf),'경매참가자'),b=await join(mf,await identity(mf),'경매친구'),observer=await join(mf,await identity(mf),'사무실친구');let request=0;
  const cmd=async(peer:typeof a,type:string,extra:Record<string,unknown>={})=>{const requestId=`table-command-${++request}`;peer.send({type,requestId,...extra});const response=await peer.wait(m=>m.requestId===requestId&&(m.type==='game-state'||m.type==='error'));assert.equal(response.type,'game-state',JSON.stringify(response));return response.state;};
  await cmd(a,'game-enter');let state=await cmd(a,'game-create',{kind:'blind-auction'});await cmd(b,'game-join',{roomId:state.room.id});await cmd(a,'game-ready',{ready:true});await cmd(b,'game-ready',{ready:true});state=await cmd(a,'game-start');
  const snapshot=await room.testSnapshot();assert.equal((snapshot.players.find(p=>p.id===a.welcome.me.id) as any).area,'games');assert.equal(snapshot.alarmAt,state.room.deadline);
  await cmd(a,'game-choice',{roomId:state.room.id,matchId:state.room.matchId,round:state.room.round,choice:4});const privateB=await cmd(b,'game-enter');assert.equal(privateB.room.myChoice,null);assert.equal(privateB.room.players.find((p:Message)=>p.id===a.welcome.me.id).submitted,true);
  assert.equal(observer.messages.some(m=>m.type==='game-state'&&m.state.room),false,'office observers must never receive a private table snapshot');
  await room.testClock(state.room.deadline);const revealed=await cmd(b,'game-enter');assert.equal(revealed.room.phase,'reveal');assert.equal(revealed.room.players.find((p:Message)=>p.id===a.welcome.me.id).chips,14);
  const auth=await login(mf);const closed=await admin(mf,'control',{action:'close'},auth.cookie,auth.csrf);assert.equal(closed.status,200);assert.equal((await room.testSnapshot()).alarmAt,null);
  const body=await closed.json() as Message;assert.equal(body.roomOpen,false);
 }finally{await mf.dispose();}
});

test('the game room is the way into the tower: lobby, tower room, tower and back keep one consistent area', {timeout:60_000},async()=>{
 const {mf,room}=await createHarness();try{
  const cookieA=await identity(mf),cookieB=await identity(mf);
  let a=await join(mf,cookieA,'타워방장'),b=await join(mf,cookieB,'타워친구');const office=await join(mf,await identity(mf),'사무실손님');let request=0;
  const idA=a.welcome.me.id,idB=b.welcome.me.id;
  const ask=async(peer:typeof a,type:string,extra:Record<string,unknown>={})=>{const requestId=`door-command-${++request}`;peer.send({type,requestId,...extra});return peer.wait(m=>m.requestId===requestId&&['game-state','jump-state','error'].includes(m.type));};
  const game=async(peer:typeof a,type:string,extra:Record<string,unknown>={})=>{const response=await ask(peer,type,extra);assert.equal(response.type,'game-state',JSON.stringify(response));return response.state;};
  const climb=async(peer:typeof a,type:string,extra:Record<string,unknown>={})=>{const response=await ask(peer,type,extra);assert.equal(response.type,'jump-state',JSON.stringify(response));return response.state;};
  const area=async(id:string)=>((await room.testSnapshot()).players.find(player=>player.id===id) as any)?.area;
  assert.equal(a.welcome.me.area,'office');

  // The lobby alone is not enough: no tower without a tower room. A strategy table does not count either.
  // The socket allows a short burst of commands; a real player is never this fast.
  const breathe=()=>new Promise(resolve=>setTimeout(resolve,1300));
  let lobby=await game(a,'game-enter');assert.equal(lobby.area,'games');assert.equal(lobby.room,null);assert.equal(lobby.towerBest,0);assert.equal(await area(idA),'games');
  assert.equal((await ask(a,'jump-enter')).code,'JUMP_ROOM');
  await game(a,'game-create',{kind:'blind-auction'});
  assert.equal((await ask(a,'jump-enter')).code,'JUMP_ROOM','a strategy table is not a tower room');
  assert.equal((await ask(a,'game-create',{kind:'jump-tower'})).code,'GAME_ROOM','one room at a time');
  await game(a,'game-leave');

  // Create and join a tower room from the lobby list.
  const created=await game(a,'game-create',{kind:'jump-tower'}),roomId=created.room.id;
  assert.equal(created.room.kind,'jump-tower');assert.equal(created.room.players[0].floor,null);
  lobby=await game(b,'game-enter');
  assert.deepEqual(lobby.rooms.map((row:Message)=>[row.id,row.kind,row.hostName,row.count,row.maxPlayers]),[[roomId,'jump-tower','타워방장',1,12]]);
  await game(b,'game-join',{roomId});

  // Into the tower: the member stays in the room, the area becomes 'jump' and lobby commands wait.
  await breathe();let run=await climb(a,'jump-enter');assert.equal(run.active,true);assert.equal(run.roomId,roomId);assert.equal(run.state.floor,0);
  assert.equal(await area(idA),'jump');assert.equal(await area(idB),'games');
  const watching=await b.wait(m=>m.type==='game-state'&&m.state.room?.players.some((player:Message)=>player.id===idA&&player.floor===0));
  assert.equal(watching.state.room.players.find((player:Message)=>player.id===idB).floor,null,'the room view tells who is climbing');
  for(const type of ['game-leave','game-exit','game-chat','game-create'])assert.equal((await ask(a,type,{kind:'jump-tower',text:'안녕'})).code,'JUMP_AREA',type);
  assert.equal((await room.testGames(idA)).room?.id,roomId,'refused commands leave the room untouched');

  // Others may enter while the tower is running; only the room hears about it.
  a.messages.length=0;const second=await climb(b,'jump-enter');assert.equal(second.roomId,roomId);
  const presence=await a.wait(m=>m.type==='jump-presence'&&m.peers.length===2);assert.equal(presence.roomId,roomId);
  const ranking=await a.wait(m=>m.type==='jump-room'&&m.ranking.length===2);assert.equal(ranking.roomId,roomId);
  assert.equal(office.messages.some(m=>m.type.startsWith('jump-')&&m.type!=='jump-leaderboard'||m.type==='game-state'&&m.state.room),false,'the office never receives room traffic');

  // Out of the tower lands in the room view, still a member.
  await breathe();a.messages.length=0;run=await climb(a,'jump-exit',{runId:run.runId});assert.equal(run.active,false);assert.equal(run.roomId,null);
  assert.equal(await area(idA),'games');
  const back=await a.wait(m=>m.type==='game-state'&&m.state.room?.id===roomId);
  assert.equal(back.state.area,'games');assert.equal(back.state.room.players.find((player:Message)=>player.id===idA).floor,null);assert.equal(back.state.room.players.find((player:Message)=>player.id===idB).floor,0);

  // A member who drops keeps the seat for a minute; then the climb ends with the membership.
  b.socket.close(1000,'lost');await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal((await game(a,'game-enter')).room.players.find((player:Message)=>player.id===idB).connected,false);
  await room.testClock(Date.now()+61_000);
  assert.deepEqual((await game(a,'game-enter')).room.players.map((player:Message)=>player.id),[idA]);
  b=await join(mf,cookieB,'타워친구');assert.equal(b.welcome.me.area,'office','the climb ended when the seat was given up');
  assert.equal((await ask(b,'jump-enter')).code,'JUMP_ROOM');

  // Room -> lobby (the empty room closes) -> office.
  lobby=await game(a,'game-leave');assert.equal(lobby.room,null);assert.deepEqual(lobby.rooms,[]);assert.equal(await area(idA),'games');
  lobby=await game(a,'game-exit');assert.equal(lobby.area,'office');assert.equal(await area(idA),'office');

  // Reconnecting while inside the tower restores both layers: the room underneath and the climb on top.
  const again=await game(a,'game-create',{kind:'jump-tower'});run=await climb(a,'jump-enter');assert.equal(run.roomId,again.room.id);
  a=await join(mf,cookieA,'타워방장');assert.equal(a.welcome.me.area,'jump');
  const restoredRoom=await a.wait(m=>m.type==='game-state');assert.equal(restoredRoom.state.area,'games');assert.equal(restoredRoom.state.room.id,again.room.id);assert.equal(typeof restoredRoom.state.room.players[0].floor,'number');
  const restoredRun=await a.wait(m=>m.type==='jump-state');assert.equal(restoredRun.state.active,true);assert.equal(restoredRun.state.roomId,again.room.id);
  run=await climb(a,'jump-exit',{runId:restoredRun.state.runId});assert.equal(run.active,false);
  lobby=await game(a,'game-exit');assert.equal(lobby.area,'office');assert.equal(lobby.room,null);assert.deepEqual(lobby.rooms,[]);
  assert.equal(await area(idA),'office');assert.equal((await ask(a,'jump-enter')).code,'JUMP_ROOM');
 }finally{await mf.dispose();}
});
