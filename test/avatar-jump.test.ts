import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAvatarActionView } from '../shared/avatar-actions';
import { createJumpAction, jumpHeightAt, jumpStep, JUMP_RULES } from '../shared/avatar-jump';

function near(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual-expected)<.000001,`${message}: ${actual} vs ${expected}`);
}

test('first jump starts on the next frame, reaches 1.36 and lands at 900ms', () => {
  const first=createJumpAction('first',10000);
  assert.equal(jumpStep(first),1);
  assert.equal(first.expiresAt,10900);
  near(jumpHeightAt(first,10000),0,'starts on the floor');
  assert.ok(jumpHeightAt(first,10016)>.09,'no anticipation delay');
  near(jumpHeightAt(first,10450),1.36,'twice the old .68 peak');
  assert.ok(jumpHeightAt(first,10899)<.007,'lands continuously');
  for(const now of [9999,10900,12000,Number.NaN]) near(jumpHeightAt(first,now),0,'outside the active window');
});

test('second jump launches continuously from the current height at every point of the first arc', () => {
  const first=createJumpAction('first',10000);
  for(const delay of [80,100,250,450,650,850,899]) {
    const now=10000+delay,second=createJumpAction('second',now,first);
    assert.equal(jumpStep(second),2);
    near(jumpHeightAt(second,now),jumpHeightAt(first,now),'boost does not teleport vertically');
    assert.ok(jumpHeightAt(second,now+16)>jumpHeightAt(second,now),'even a falling character rises immediately');
    near(jumpHeightAt(second,now+450),jumpHeightAt(first,now)+1.36,'boost adds exactly one full arc');
    for(let time=now;time<=second.expiresAt;time+=5) {
      const y=jumpHeightAt(second,time);
      assert.ok(Number.isFinite(y)&&y>=0&&y<=2.72,'double jump remains bounded');
    }
    assert.ok(jumpHeightAt(second,second.expiresAt-1)<.009,'quadratic landing duration reaches the floor smoothly');
    near(jumpHeightAt(second,second.expiresAt),0,'lands at the authoritative expiry');
  }
  const apexBoost=createJumpAction('apex',10450,first);
  near(jumpHeightAt(apexBoost,10900),2.72,'highest possible double jump');
  assert.ok(apexBoost.expiresAt-apexBoost.startedAt>JUMP_RULES.flightMs,'elevated launch has enough time to land');
});

test('legacy jump snapshots share the first arc and unrelated actions stay grounded', () => {
  const first=createJumpAction('new',10000);
  const {jump: _jump,...legacy}=first;
  assert.equal(jumpStep(legacy),1);
  assert.equal(isAvatarActionView(legacy),true);
  for(let now=10000;now<=10900;now+=16) near(jumpHeightAt(legacy,now),jumpHeightAt(first,now),'legacy rendering');
  assert.equal(jumpStep(null),0);
  near(jumpHeightAt(null,10450),0,'cancelled action');
  const other={...legacy,kind:'wave' as const};
  assert.equal(jumpStep(other),0);
  near(jumpHeightAt(other,10450),0,'ordinary gesture');
});

test('snapshot validation accepts bounded jump metadata only on jumping actions', () => {
  const first=createJumpAction('first',10000),second=createJumpAction('second',10450,first);
  assert.equal(isAvatarActionView(first),true);
  assert.equal(isAvatarActionView(second),true);
  for(const jump of [null,{},[],{step:0,startHeight:0},{step:3,startHeight:0},{step:1,startHeight:.1},
    {step:2,startHeight:-.1},{step:2,startHeight:1.37},{step:2,startHeight:Infinity},{step:2,startHeight:NaN},{step:2,startHeight:'1'}]) {
    assert.equal(isAvatarActionView({...first,jump}),false,`reject malformed metadata ${JSON.stringify(jump)}`);
  }
  assert.equal(isAvatarActionView({...first,kind:'wave'}),false,'other actions cannot claim jump metadata');
});
