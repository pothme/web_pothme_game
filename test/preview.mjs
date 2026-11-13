// Local-only RPC fixture: no production debug endpoints or timers.
import { createInterface } from 'node:readline';
import { createHarness } from './harness.mjs';
// Import-free fixture coordinate mirrors the checked shared v8 room rear band.
const expandedRearSpot = {x:0,z:1.125*Math.SQRT2-53.55*Math.SQRT2/2+(53.55*Math.SQRT2/2-.96)*1.5+.96-4.3};
const {mf,room,restart}=await createHarness({port:8890,assets:true});
console.log(`Fixture ready: ${await mf.ready}`);
console.log('commands: friend [NAME], friend-chat TEXT, friend-seat N, friend-stand, friend-leave, fill [TOTAL=50], empty, seed-community, snapshot, usage-normal, usage-warning, usage-critical, usage-reset, restart, quit');
console.log('game commands: game-state, game-friend-join, game-friend-choice BID|invest|guard|steal|1,2,3, game-friend-leave, game-next');
console.log('tower commands (create a 점프 타워 room in the browser first): tower-friend-enter, tower-friend-move [TICKS], tower-friend-chat TEXT, tower-friend-exit, tower-state');
let friend,friendId,botNumber=0,friendTower;
const friendRequests=new Map();
async function friendCommand(type,extra={}) {
 if(friend?.readyState!==1)throw new Error('Run friend first.');
 const requestId=crypto.randomUUID();
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{friendRequests.delete(requestId);reject(new Error('Friend command timed out'));},5000);friendRequests.set(requestId,{resolve:packet=>{clearTimeout(timer);packet.type==='error'?reject(new Error(packet.message)):resolve(packet.state??packet);}});friend.send(JSON.stringify({type,requestId,...extra}));});
}
let communitySeeded = false;
const bots=[];
async function seedCommunity() {
 if (communitySeeded) return {community:'already seeded'};
 const origin = (await mf.ready).origin;
 const samples = [
  ['로컬 확인 · 긴 본문도 읽기 쉽게', '이 글은 화면 검증용 예시이며 공개 사이트에는 저장되지 않습니다.\n넓어진 인기글 카드에서 제목과 본문을 함께 확인해요.\n문장이 길어지면 줄바꿈하고, 미리보기를 넘는 내용은 말줄임과 전체 글 보기로 안내합니다.\n' + '서로의 관점을 존중하며 차트를 읽는 공간입니다. '.repeat(20)],
  ['로컬 확인 · 창가에서 잠깐 쉬어가기', '창가에서 커피와 다과를 받아 소파에 앉아 보세요.\n이곳의 글은 본문 줄바꿈과 카드 배치를 확인하기 위한 로컬 예시입니다.\n실제 투자 정보나 추천이 아닙니다.'],
  ['로컬 확인 · 오늘의 라운지 소식', '차트가 더 커지고 바닥 가까이 내려왔어요.\n인기글 세 칸에서 제목뿐 아니라 본문도 읽을 수 있습니다.\n글을 누르면 전체 내용과 댓글을 확인할 수 있어요.'],
 ];
 for (const [index, [title, body]] of samples.entries()) {
  const session = await mf.dispatchFetch(origin + '/api/session'), cookie = session.headers.get('set-cookie').split(';')[0];
  const response = await mf.dispatchFetch(origin + '/api/community', {method:'POST', headers:{Cookie:cookie, Origin:origin, 'Content-Type':'application/json'}, body:JSON.stringify({action:'post',requestId:crypto.randomUUID(),nickname:`확인동료${index+1}`,title,body,rulesAccepted:true})});
  if (!response.ok) throw new Error('Local community fixture failed: ' + response.status);
 }
 communitySeeded = true;
 return {community:'three local-only sample posts created'};
}
function usageFixture(mode) {
 const now=Date.now(),date=new Date(now),start=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()),percent=mode==='critical'?95:mode==='warning'?80:22;
 const metrics=[['workers','Worker 요청',100000,'requests','day'],['doRequests','실시간 서버 요청 환산',100000,'requests','day'],['duration','실시간 서버 실행',13000,'GB-s','day'],['reads','DB 읽기',5000000,'rows','day'],['writes','DB 쓰기',100000,'rows','day'],['storage','DB 저장 공간',5000000000,'bytes','storage']].map(([id,label,limit,unit,period],index)=>({id,label,limit,unit,period,used:limit*(index===0?percent:10)/100,percent:index===0?percent:10,level:index===0?mode:'normal',note:'로컬 검증 데이터'}));
 return {ok:true,configured:true,status:'ready',fetchedAt:now,periodStart:start,periodEnd:now,resetAt:start+86400000,refreshAfter:now+300000,stale:false,level:mode,metrics,workers:[{name:'로컬 검증 데이터 · 포듬증권',requests:18000,errors:2,subrequests:100,cpuP50Ms:1.2,cpuP99Ms:7.8},{name:'로컬 검증 데이터 · 차트',requests:4000,errors:0,subrequests:30,cpuP50Ms:.4,cpuP99Ms:2.1}],traffic:{doRequests:1800,webSocketReceived:164000,webSocketSent:320000,responseBytes:1500000},messages:['로컬 검증 데이터입니다. 실제 Cloudflare 사용량이 아닙니다.'],dashboardUrl:'https://dash.cloudflare.com/'};
}
async function addBot() {
 const origin=(await mf.ready).origin,session=await mf.dispatchFetch(origin+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0];
 const response=await mf.dispatchFetch(origin+'/api/room?nickname='+encodeURIComponent(`확인동료${++botNumber}`),{headers:{Upgrade:'websocket',Cookie:cookie,Origin:origin}});
 if(response.status!==101)throw new Error(await response.text());
 const socket=response.webSocket;let ready;const welcome=new Promise(resolve=>{ready=resolve;});
 socket.addEventListener('message',event=>{const data=JSON.parse(String(event.data));if(data.type==='welcome')ready();});socket.accept();await welcome;bots.push(socket);
}
async function addFriend(nickname='테스트동료') {
 if(friend?.readyState===1)return {friend:'already connected'};
 const origin=(await mf.ready).origin,session=await mf.dispatchFetch(origin+'/api/session'),cookie=session.headers.get('set-cookie').split(';')[0];
 const response=await mf.dispatchFetch(origin+'/api/room?nickname='+encodeURIComponent(nickname),{headers:{Upgrade:'websocket',Cookie:cookie,Origin:origin}});
 if(response.status!==101)throw new Error(await response.text());friend=response.webSocket;
 let ready;const welcome=new Promise(resolve=>{ready=resolve;});
 friend.addEventListener('message',event=>{const data=JSON.parse(String(event.data));if(data.type==='welcome'){friendId=data.me.id;ready();}if(data.type==='error')console.log(JSON.stringify({friendError:data}));if(data.requestId&&friendRequests.has(data.requestId)){friendRequests.get(data.requestId).resolve(data);friendRequests.delete(data.requestId);}});friend.accept();await welcome;return {friend:nickname,id:friendId};
}
const input=createInterface({input:process.stdin,terminal:false});
for await(const line of input){const[command,value]=line.trim().split(/\s+/);try{let result;
 if(command==='friend')result=await addFriend(value);
 else if(command==='tower-state')result=(await room.testTowerStates()).map(({nickname,state})=>({nickname,ack:state.ackSeq,state:state.state}));
 else if(command==='tower-preview')result=await room.testTowerPreview(Number(value)||0,line.trim().split(/\s+/)[2]??'standing');
 else if(command==='tower-friend-enter'){if(friend?.readyState!==1)await addFriend();const current=await room.testGames(friendId);if(current.room?.kind!=='jump-tower'){const target=(await room.testGames()).flatMap(peer=>peer.state.rooms).find(table=>table.kind==='jump-tower'&&table.count<table.maxPlayers);if(!target)throw new Error('Create a 점프 타워 room in the browser first.');if(current.room)await friendCommand('game-leave');await friendCommand('game-join',{roomId:target.id});}friendTower=await friendCommand('jump-enter');result={active:friendTower.active,room:friendTower.roomId,floor:friendTower.state.floor};}
 else if(command==='tower-friend-chat')result=await friendCommand('jump-chat',{text:line.trim().slice(command.length).trim()});
 else if(command==='tower-friend-move'){friendTower=await friendCommand('jump-sync');const ticks=Math.min(12,Math.max(1,Number(value)||12));friendTower=await friendCommand('jump-input',{runId:friendTower.runId,frames:Array.from({length:ticks},(_,i)=>({seq:friendTower.ackSeq+i+1,x:1,z:0,jump:false}))});result={x:friendTower.state.x,y:friendTower.state.y,z:friendTower.state.z};}
 else if(command==='tower-friend-exit'){friendTower=await friendCommand('jump-exit',{runId:friendTower.runId});result={active:friendTower.active};}
 else if(command==='game-state')result=await room.testGames();
 else if(command==='game-friend-join') {if(friend?.readyState!==1)await addFriend();const states=await room.testGames(),target=states.flatMap(peer=>peer.state.rooms).find(table=>table.phase==='waiting'&&!table.practice);if(!target)throw new Error('Create a waiting human table in the browser first.');const current=await room.testGames(friendId);if(current.room?.id!==target.id)await friendCommand('game-join',{roomId:target.id});result=await friendCommand('game-ready',{ready:true});}
 else if(command==='game-friend-choice') {const state=await room.testGames(friendId);if(!state.room)throw new Error('Run game-friend-join first.');const choice=state.room.kind==='blind-auction'?Number(value):state.room.kind==='cipher-race'?String(value).split(',').map(Number):value;result=await friendCommand('game-choice',{roomId:state.room.id,matchId:state.room.matchId,round:state.room.round,choice});}
 else if(command==='game-friend-leave')result=await friendCommand('game-exit');
 else if(command==='game-next')result=await room.testNextGameAlarm();
 else if(command==='fill'){const target=Math.max(0,Math.min(50,Number(value)||50));while((await room.testSnapshot()).players.length<target)await addBot();result={online:(await room.testSnapshot()).players.length,fixtureBots:bots.filter(socket=>socket.readyState===1).length};}
 else if(command==='empty'){for(const socket of bots.splice(0))if(socket.readyState===1)socket.close(1000,'fixture cleared');if(friend?.readyState===1)friend.close(1000,'fixture cleared');friend=undefined;await new Promise(resolve=>setTimeout(resolve,50));result={online:(await room.testSnapshot()).players.length};}
 else if(command==='snapshot')result=await room.testSnapshot();
 else if(command==='positions')result=(await room.testSnapshot()).players.map(({nickname,x,z,seat})=>({nickname,x,z,seat}));
 else if(command==='jump-state')result=(await room.testSnapshot()).attachments.map(({nickname,lastAvatarAction,nextJumpAt})=>({nickname,action:lastAvatarAction?.action,nextJumpAt}));
 else if(command==='view-spot'){const spots={sofa:{x:-13,z:-21},table:{x:34,z:-20.5},plant:{x:37,z:-5},pantry:{x:-59.22,z:-10},tower:{x:-56.6,z:-2.8},spawn:{x:0,z:-4},rear:expandedRearSpot,'rear-sofa':{x:-13,z:3},'rear-table':{x:-48,z:0.8}};if(!spots[value])throw new Error('Use view-spot sofa|table|plant|pantry|spawn|rear|rear-sofa|rear-table');result=await room.testViewSpot(spots[value]);}
 else if(command==='seed-community')result=await seedCommunity();
 else if(['usage-normal','usage-warning','usage-critical','usage-reset'].includes(command)){await room.testUsageSnapshot(command==='usage-reset'?null:usageFixture(command.slice(6)));result={usage:command,notice:'로컬 검증 데이터 · 관리자 화면에서 사용량 새로고침'};}
 else if(command==='finishvote')result=await room.testFinishVote();
 else if(command==='friend-propose'&&friend){const slot=Number(line.trim().split(/\s+/)[2]??0);friend.send(JSON.stringify({type:'chart-propose',symbol:value,slot,requestId:crypto.randomUUID()}));result={proposed:value,slot};}
 else if(command==='friend-vote'&&friend){const state=await room.testSnapshot();friend.send(JSON.stringify({type:'chart-vote',voteId:state.office.vote?.id,approve:value==='yes',requestId:crypto.randomUUID()}));result={voted:value};}
 else if(command==='friend-chat'&&friend){friend.send(JSON.stringify({type:'chat',text:line.trim().slice(command.length).trim(),requestId:crypto.randomUUID()}));result={sent:true};}
 else if(command==='seed-chat'&&friend){for(let index=1;index<=12;index++){friend.send(JSON.stringify({type:'chat',text:`로컬 확인 ${String(index).padStart(2,'0')} · 함께 보는 시장, 편하게 이야기해요.`,requestId:crypto.randomUUID()}));await new Promise(resolve=>setTimeout(resolve,1250));}result={chat:'twelve local-only messages'};}
 else if(command==='friend-action'&&friend){friend.send(JSON.stringify({type:'avatar-action',kind:value,requestId:crypto.randomUUID()}));result={action:value};}
 else if(command==='friend-shoulder'&&friend){friend.send(JSON.stringify({type:'shoulder-link',enabled:value!=='off',requestId:crypto.randomUUID()}));result={shoulder:value!=='off'};}
 else if(command==='friend-cheer'&&friend){friend.send(JSON.stringify({type:'shoulder-cheer',requestId:crypto.randomUUID()}));result={cheer:true};}
 else if(command==='bots-shoulder'){for(const socket of bots)if(socket.readyState===1)socket.send(JSON.stringify({type:'shoulder-link',enabled:value!=='off',requestId:crypto.randomUUID()}));result={shoulder:value!=='off'};}
 else if(command==='friend-spot'&&friend){const z=Number(line.trim().split(/\s+/)[2]);result=await room.testPositions({[friendId]:{x:Number(value),z}});}
 else if(command==='friend-seat'&&friend){friend.send(JSON.stringify({type:'sit',seat:Number(value),requestId:crypto.randomUUID()}));result={seat:Number(value)};}
 else if(command==='friend-stand'&&friend){friend.send(JSON.stringify({type:'stand',requestId:crypto.randomUUID()}));result={standing:true};}
 else if(command==='friend-leave'&&friend){friend.close(1000,'fixture friend left');friend=undefined;result={left:true};}
 else if(command==='restart'){await restart();result={restarted:true};}
 else if(command==='quit')break;else continue;console.log(JSON.stringify(result));
 }catch(error){console.error(error.message);}}
await mf.dispose();
