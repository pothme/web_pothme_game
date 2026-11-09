import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from './harness.mjs';
import {identity,join,observe,origin,login,admin,type Message} from './office-helpers';
import {DEFAULT_APPEARANCE} from '../shared/avatar-appearance';

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
  a.send({...input,requestId:'whisper-fast'});assert.equal((await a.wait(m=>m.requestId==='whisper-fast')).code,'WHISPER_COOLDOWN');
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
