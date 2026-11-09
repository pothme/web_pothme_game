import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JumpPrediction } from '../src/jump-client';
import { createJumpState, stepJumpState, type JumpInput } from '../shared/jump-game';

const input=(seq:number):JumpInput=>({seq,x:seq<12?.4:0,z:seq<18?.6:0,jump:seq===1||seq===14});

test('tower input predicts immediately and replays unacknowledged steps over a corrected authority',()=>{
  const initial=createJumpState(),client=new JumpPrediction({runId:'a',ackSeq:0,state:initial});
  for(let seq=1;seq<=25;seq++)client.advance(input(seq));
  assert.ok(client.state.y>initial.y,'the jump responds before any socket acknowledgement');
  let authority=initial;
  for(let seq=1;seq<=10;seq++)authority=stepJumpState(authority,input(seq)).state;
  authority={...authority,x:authority.x+.3};
  let expected=authority;
  for(let seq=11;seq<=25;seq++)expected=stepJumpState(expected,input(seq)).state;
  client.reconcile({runId:'a',ackSeq:10,state:authority});
  assert.deepEqual(client.state,expected);
  assert.equal(client.queued,15);
  assert.equal(client.ackSeq,10);
});

test('acknowledged prefixes are retired and reconnect resends only the pending sequence',()=>{
  const initial=createJumpState(),client=new JumpPrediction({runId:'a',ackSeq:0,state:initial});
  for(let seq=1;seq<=18;seq++)client.advance(input(seq));
  const first=client.outgoing(10);assert.deepEqual(first.map(frame=>frame.seq),[1,2,3,4,5,6,7,8,9,10]);
  client.markSent(first);assert.equal(client.outgoing()[0].seq,11);
  let authority=initial;for(let seq=1;seq<=7;seq++)authority=stepJumpState(authority,input(seq)).state;
  client.reconcile({runId:'a',ackSeq:7,state:authority},true);
  assert.equal(client.outgoing()[0].seq,8,'lost inputs remain replayable after reconnect');
  assert.equal(client.queued,11);
  const before=client.state;
  client.reconcile({runId:'a',ackSeq:7,state:authority},true);
  assert.deepEqual(client.state,before,'a duplicate acknowledgement cannot advance physics twice');
  client.markSent(client.outgoing());assert.deepEqual(client.outgoing(),[]);
});

test('late snapshots cannot rewind a run and a retry cannot replay inputs from the old run',()=>{
  const client=new JumpPrediction({runId:'a',ackSeq:15,state:createJumpState(10)});
  client.advance({x:1,z:0,jump:true});const before=client.state;
  assert.equal(client.reconcile({runId:'a',ackSeq:14,state:createJumpState()}),false);
  assert.strictEqual(client.state,before);
  const retry=createJumpState(10);client.reconcile({runId:'b',ackSeq:0,state:retry});
  assert.deepEqual(client.state,retry);assert.equal(client.queued,0);assert.deepEqual(client.outgoing(),[]);
  client.advance({x:0,z:0,jump:true});assert.equal(client.outgoing()[0].seq,1);
});

test('prediction is bounded during network stalls and stops at the summit',()=>{
  const client=new JumpPrediction({runId:'a',ackSeq:0,state:createJumpState()});
  for(let i=0;i<150;i++)assert.equal(client.advance({x:0,z:0,jump:false}),true);
  const tick=client.state.tick;assert.equal(client.advance({x:1,z:0,jump:true}),false);assert.equal(client.state.tick,tick);
  assert.equal(client.outgoing(100).length,12,'server batch limit remains enforced');
  client.reconcile({runId:'summit',ackSeq:0,state:createJumpState(60)});
  assert.equal(client.advance({x:1,z:0,jump:true}),false);assert.equal(client.queued,0);
});
