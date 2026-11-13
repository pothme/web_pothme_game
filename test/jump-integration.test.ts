import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, origin, login, admin, type Message } from './office-helpers';
import { JUMP_PORTAL, nearJumpPortal } from '../shared/jump-portal';
import { isWalkable, findWalkPath, ROOM_SPAWN } from '../shared/classroom-layout';

test('snack-bar tower door has a walkable route from the office entrance',()=>{
  assert.ok(isWalkable(JUMP_PORTAL.x-.2,JUMP_PORTAL.z));
  assert.ok(findWalkPath(ROOM_SPAWN.x,ROOM_SPAWN.z,JUMP_PORTAL.x-.2,JUMP_PORTAL.z).length);
  assert.equal(nearJumpPortal(ROOM_SPAWN.x,ROOM_SPAWN.z),false);
});

test('tower needs a tower room to enter, separates presence, accepts normal 5Hz input, resumes and closes with the office',{timeout:30000},async()=>{
  const {mf,room,restart}=await createHarness();
  try{
    const cookie=await identity(mf);let peer=await join(mf,cookie,'타워도전자');
    let now=await room.testFreezeClock();let request=0;
    const command=async(type:string,extra:Record<string,unknown>={})=>{
      const requestId=`jump-integration-${++request}`;peer.send({type,requestId,...extra});
      return peer.wait(m=>m.requestId===requestId&&(m.type==='jump-state'||m.type==='error'));
    };
    let response=await command('jump-enter');assert.equal(response.type,'error');assert.equal(response.code,'JUMP_ROOM','nobody enters the tower without a tower room');
    // Standing at the door is not enough either: the door now leads to the game room lobby.
    await room.testPositions({[peer.welcome.me.id]:{x:JUMP_PORTAL.x,z:JUMP_PORTAL.z}});
    assert.equal((await command('jump-enter')).code,'JUMP_ROOM');
    await room.testTowerRoom(peer.welcome.me.id,'integration-room');
    response=await command('jump-enter');assert.equal(response.type,'jump-state',JSON.stringify(response));let state=response.state;
    assert.equal(state.active,true);assert.equal(state.roomId,'integration-room');assert.equal(state.state.floor,0);assert.equal(state.rewards.maxPoints,600);
    assert.equal((await room.testSnapshot()).players.find(p=>p.id===peer.welcome.me.id)?.area,'jump');
    const ranking=await peer.wait(m=>m.type==='jump-room');assert.equal(ranking.roomId,'integration-room');assert.deepEqual(ranking.ranking,[{id:peer.welcome.me.id,nickname:'타워도전자',floor:0,bestFloor:0}]);
    assert.equal((await command('game-enter')).code,'JUMP_AREA');
    for(let batch=0;batch<40;batch++){
      await room.testClock(now+=200,false);
      const frames=Array.from({length:10},(_,i)=>({seq:batch*10+i+1,x:0,z:0,jump:false}));
      response=await command('jump-input',{runId:state.runId,frames});assert.equal(response.type,'jump-state',JSON.stringify(response));state=response.state;
      assert.equal(state.ackSeq,(batch+1)*10);
    }
    assert.equal(state.profile.points,0);assert.equal(state.rewards.totalPoints,0);
    assert.equal(peer.socket.readyState,1,'legitimate gameplay must not trip the general chat rate limit');
    // The tower never pauses: run off the ground pad, stop sending input in mid-air (the pause menu), come back later.
    for(let batch=0;batch<4;batch++){
      await room.testClock(now+=200,false);
      response=await command('jump-input',{runId:state.runId,frames:Array.from({length:10},(_,i)=>({seq:state.ackSeq+i+1,x:1,z:0,jump:false}))});assert.equal(response.type,'jump-state',JSON.stringify(response));state=response.state;
    }
    assert.equal(state.state.grounded,false);assert.equal(state.state.deaths,0);
    await room.testClock(now+=8000,false);
    response=await command('jump-sync');state=response.state;
    assert.equal(state.state.deaths,1,'the fall went on during the pause');assert.equal(state.state.standingFloor,0);assert.equal(state.state.x,0);assert.equal(state.state.tick,Math.floor(now/20));
    await restart();peer=await join(mf,cookie,'타워도전자');response=await command('jump-sync');state=response.state;assert.equal(state.active,true);assert.equal(state.roomId,'integration-room');
    response=await command('jump-exit',{runId:state.runId});assert.equal(response.state.active,false);
    assert.equal((await room.testSnapshot()).players.find(p=>p.id===peer.welcome.me.id)?.area,'office');
    const leaders=await mf.dispatchFetch(`${origin}/api/jump/leaderboard`);assert.equal(leaders.status,200);assert.equal(leaders.headers.has('set-cookie'),false);
    assert.deepEqual((await leaders.json() as Message).leaders,[]);
    assert.equal((await mf.dispatchFetch(`${origin}/api/jump/leaderboard`,{method:'POST'})).status,405);
    assert.equal((await mf.dispatchFetch(`${origin}/api/jump/leaderboard`,{headers:{Origin:'https://elsewhere.test'}})).status,403);
    response=await command('jump-enter');assert.equal(response.state.active,true);assert.notEqual(response.state.runId,state.runId,'a new visit is a new run from the ground pad');
    // Losing the tower room (left the lobby room, room closed) ends the climb at once.
    await room.testTowerRoom(peer.welcome.me.id,null);
    const evicted=await peer.wait(m=>m.type==='jump-state'&&m.state.active===false);assert.equal(evicted.state.roomId,null);
    assert.equal((await room.testSnapshot()).players.find(p=>p.id===peer.welcome.me.id)?.area,'office');
    assert.equal((await command('jump-enter')).code,'JUMP_ROOM');
    await room.testTowerRoom(peer.welcome.me.id,'integration-room');assert.equal((await command('jump-enter')).state.active,true);
    const auth=await login(mf);assert.equal((await admin(mf,'control',{action:'close'},auth.cookie,auth.csrf)).status,200);
    assert.equal((await room.testSnapshot()).players.length,0);
  }finally{await mf.dispose();}
});
