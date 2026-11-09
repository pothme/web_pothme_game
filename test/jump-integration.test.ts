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

test('tower authenticates entry at the door, separates presence, accepts normal 5Hz input, resumes and closes with the office',{timeout:30000},async()=>{
  const {mf,room,restart}=await createHarness();
  try{
    const cookie=await identity(mf);let peer=await join(mf,cookie,'타워도전자');
    let now=await room.testFreezeClock();let request=0;
    const command=async(type:string,extra:Record<string,unknown>={})=>{
      const requestId=`jump-integration-${++request}`;peer.send({type,requestId,...extra});
      return peer.wait(m=>m.requestId===requestId&&(m.type==='jump-state'||m.type==='error'));
    };
    assert.equal((await command('jump-enter')).type,'error','remote entrance must be rejected');
    await room.testPositions({[peer.welcome.me.id]:{x:JUMP_PORTAL.x,z:JUMP_PORTAL.z}});
    let response=await command('jump-enter');assert.equal(response.type,'jump-state',JSON.stringify(response));let state=response.state;
    assert.equal(state.active,true);assert.equal((await room.testSnapshot()).players.find(p=>p.id===peer.welcome.me.id)?.area,'jump');
    assert.equal((await command('game-enter')).code,'JUMP_AREA');
    for(let batch=0;batch<40;batch++){
      await room.testClock(now+=200,false);
      const frames=Array.from({length:10},(_,i)=>({seq:batch*10+i+1,x:0,z:0,jump:false}));
      response=await command('jump-input',{runId:state.runId,frames});assert.equal(response.type,'jump-state',JSON.stringify(response));state=response.state;
      assert.equal(state.ackSeq,(batch+1)*10);
    }
    assert.equal(state.profile.points,0);assert.equal(state.rewards.totalPoints,0);
    assert.equal(peer.socket.readyState,1,'legitimate gameplay must not trip the general chat rate limit');
    await restart();peer=await join(mf,cookie,'타워도전자');response=await command('jump-sync');state=response.state;assert.equal(state.active,true);
    response=await command('jump-exit',{runId:state.runId});assert.equal(response.state.active,false);
    assert.equal((await room.testSnapshot()).players.find(p=>p.id===peer.welcome.me.id)?.area,'office');
    const ranking=await mf.dispatchFetch(`${origin}/api/jump/leaderboard`);assert.equal(ranking.status,200);assert.equal(ranking.headers.has('set-cookie'),false);
    assert.deepEqual((await ranking.json() as Message).leaders,[]);
    assert.equal((await mf.dispatchFetch(`${origin}/api/jump/leaderboard`,{method:'POST'})).status,405);
    assert.equal((await mf.dispatchFetch(`${origin}/api/jump/leaderboard`,{headers:{Origin:'https://elsewhere.test'}})).status,403);
    await room.testPositions({[peer.welcome.me.id]:{x:JUMP_PORTAL.x,z:JUMP_PORTAL.z}});await command('jump-enter');
    const auth=await login(mf);assert.equal((await admin(mf,'control',{action:'close'},auth.cookie,auth.csrf)).status,200);
    assert.equal((await room.testSnapshot()).players.length,0);
  }finally{await mf.dispose();}
});
