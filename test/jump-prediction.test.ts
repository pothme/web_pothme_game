import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AvatarActionView } from '../shared/avatar-actions';
import { createJumpAction, jumpHeightAt } from '../shared/avatar-jump';
import { isStandaloneJumpClick, JumpPrediction } from '../src/jump-prediction';

function fixture() {
  let now = 10000;
  const frames: (AvatarActionView | null | undefined)[] = [];
  const prediction = new JumpPrediction(() => now, action => frames.push(action));
  return { prediction, frames, at(time: number) { now = time; prediction.tick(); } };
}

test('first and second inputs animate immediately while both server acknowledgements are delayed', () => {
  const f = fixture(), p = f.prediction;
  assert.equal(p.nextStep, 1);
  assert.equal(p.start('first'), true);
  const first = p.current!;
  assert.equal(f.frames.length, 1, 'prediction renders in the input call');
  assert.equal(first.startedAt, 10000);
  f.at(10016); assert.ok(jumpHeightAt(p.current, 10016) > .09);
  assert.equal(p.nextStep, 0, 'accidental rapid duplicate is ignored');
  f.at(10080); assert.equal(p.nextStep, 2);
  f.at(10300); assert.equal(p.start('second'), true);
  const second = p.current!;
  assert.equal(second.jump?.step, 2);
  assert.equal(jumpHeightAt(second, 10300), jumpHeightAt(first, 10300));
  assert.equal(p.start('third'), false);

  f.at(10500);
  const serverFirst = createJumpAction('server-first', 60000);
  assert.equal(p.receive('first', serverFirst, 60000), true);
  assert.equal(p.current, second, 'late first acknowledgement cannot rewind the second jump');
  assert.equal(p.receive('first', null, 60500), true);
  p.seed(serverFirst, 60100);
  assert.equal(p.current, second, 'full rosters cannot replace local input timing');
  f.at(10600);
  p.receive('second', createJumpAction('server-second', 60300, serverFirst), 60300);
  assert.equal(p.current, second, 'server clock can differ without shifting local animation');
  f.at(second.expiresAt); assert.equal(p.current, null, 'suppress delayed server arc after local landing');
  assert.equal(p.nextStep, 0, 'authoritative landing remains guarded');
  f.at(13000); assert.equal(p.current, undefined); assert.equal(p.nextStep, 1);
});

test('rejected second input restores the first arc and can retry only when server allows it', () => {
  const f = fixture(), p = f.prediction;
  p.start('first'); const first = p.current!;
  f.at(10100); p.start('second');
  f.at(10120);
  assert.equal(p.reject('second', 50200, 50120), true);
  assert.equal(p.current, first);
  assert.equal(p.nextStep, 0);
  f.at(10200); assert.equal(p.nextStep, 2);
  p.start('retry'); const retried = p.current;
  p.receive('second', null, 50200);
  assert.equal(p.current, retried, 'retired rejected receipts cannot cancel a later boost');
});

test('rejection of first request cancels its dependent boost and late packets cannot resurrect it', () => {
  const f = fixture(), p = f.prediction;
  p.start('first'); f.at(10100); p.start('second');
  assert.equal(p.reject('first', 50250, 50100), true);
  assert.equal(p.current, null);
  assert.equal(p.nextStep, 0);
  p.receive('second', createJumpAction('late', 50100), 50100);
  assert.equal(p.current, null);
  f.at(10250); assert.equal(p.nextStep, 1);
});

test('lost acknowledgements recover after timeout and old receipts do not affect the next chain', () => {
  const f = fixture(), p = f.prediction;
  p.start('lost'); f.at(12000);
  assert.equal(p.nextStep, 0);
  f.at(17000); assert.equal(p.nextStep, 1);
  p.start('fresh'); const fresh = p.current;
  p.receive('lost', createJumpAction('old', 10000), 10000);
  assert.equal(p.current, fresh);
  assert.equal(p.receive('unrelated', null, 17000), false);
});

test('seating cancels the arc without resetting landing guard, while disconnect reset discards late packets', () => {
  const f = fixture(), p = f.prediction;
  p.start('first'); f.at(10200); p.cancel();
  assert.equal(p.current, null);
  assert.equal(p.nextStep, 0);
  p.seed(createJumpAction('server', 10000), 10200);
  assert.equal(p.current, null, 'cancelled flight is not restored by a roster');
  f.at(11020); assert.equal(p.nextStep, 1);
  p.start('next'); p.reset(); assert.equal(p.current, undefined);
  p.receive('next', createJumpAction('late', 11020), 11020);
  assert.equal(p.current, undefined);
});

test('reconnect can resume the first arc and boost it, with rejection restoring the reconnect arc', () => {
  const f = fixture(), p = f.prediction;
  const server = createJumpAction('server', 50000);
  p.seed(server, 50200);
  const resumed = p.current!;
  assert.equal(resumed.startedAt, 9800);
  assert.equal(p.nextStep, 2);
  p.start('boost'); assert.equal(p.current?.jump?.step, 2);
  p.reject('boost', undefined, 50200);
  assert.equal(p.current, resumed);
});

test('acknowledgement duplicates do not extend cooldown, and readiness wakes at the 80ms input boundary', () => {
  const f = fixture(), p = f.prediction;
  p.start('first'); assert.equal(p.nextWakeDelay(), 80);
  f.at(10080); assert.equal(p.nextStep, 2);
  const server = createJumpAction('server', 50000);
  p.receive('first', server, 50080);
  f.at(10800); p.receive('first', server, 50080);
  f.at(11020); assert.equal(p.nextStep, 1, 'duplicate packet did not add another flight time');
  assert.equal(p.nextWakeDelay(), undefined);
  assert.equal(isStandaloneJumpClick(1), false, 'release click after pointerdown does not cause a boost');
  assert.equal(isStandaloneJumpClick(0), true, 'keyboard and assistive click remains available');
});
