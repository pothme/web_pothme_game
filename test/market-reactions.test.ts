import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createOfficeAvatar } from '../src/office-avatar';
import { poseOfficeAvatar } from '../src/office-avatar-pose';
import { getAvatarActionDuration, isMarketReaction, type AvatarActionView } from '../shared/avatar-actions';
import { actionNoticeText } from '../shared/action-notices';
import { REFRESHMENT_STATION } from '../shared/classroom-layout';
import { createHarness } from './harness.mjs';
import { identity, join, type Message } from './office-helpers';

const kinds = ['lets-go', 'help-me'] as const;
function action(kind: typeof kinds[number]): AvatarActionView { return { id: `reaction-${kind}`, kind, startedAt: 10000, expiresAt: 12500 }; }

test('market reactions animate distinct upper-body poses while seated knees, feet and world position stay fixed', t => {
  const avatar = createOfficeAvatar(0x336699); t.after(() => avatar.dispose());
  avatar.group.position.set(12, .1, -9); avatar.group.rotation.y = .8;
  avatar.legs.forEach(leg => { leg.rotation.x = -Math.PI / 2; });
  avatar.lowerLegs.forEach(leg => { leg.rotation.x = Math.PI / 2; });
  avatar.group.updateMatrixWorld(true);
  const position = avatar.group.position.clone(), heading = avatar.group.rotation.toArray();
  const feet = avatar.lowerLegs.map(leg => leg.localToWorld(new Vector3(0, -.25, 0)));
  const signatures = new Set<string>();
  for (const kind of kinds) {
    avatar.arms.forEach(arm => { arm.rotation.x = -.7; });
    poseOfficeAvatar(avatar, 900, 10900, action(kind), false, false, true);
    const signature = [avatar.upperBody, avatar.head, ...avatar.arms, ...avatar.forearms].flatMap(joint => [joint.rotation.x, joint.rotation.y, joint.rotation.z]);
    assert.ok(signature.every(angle => Number.isFinite(angle) && Math.abs(angle) < 2.7));
    signatures.add(signature.map(angle => angle.toFixed(4)).join(','));
    assert.deepEqual(avatar.group.position, position); assert.deepEqual(avatar.group.rotation.toArray(), heading);
    avatar.legs.forEach(leg => assert.equal(leg.rotation.x, -Math.PI / 2));
    avatar.lowerLegs.forEach((leg, index) => {
      assert.equal(leg.rotation.x, Math.PI / 2);
      assert.ok(leg.localToWorld(new Vector3(0, -.25, 0)).distanceTo(feet[index]) < 1e-9, 'reaction cannot move a seated foot');
    });
  }
  assert.equal(signatures.size, 2, 'enthusiasm and pleading have visibly different poses');
});

test('busy-hand reactions keep tray-supporting joints steady and use only the head; expired or walking reactions reset', t => {
  const avatar = createOfficeAvatar(0x336699); t.after(() => avatar.dispose());
  for (const kind of kinds) {
    avatar.arms.forEach(arm => { arm.rotation.x = -1.15; });
    poseOfficeAvatar(avatar, 900, 10900, action(kind), false, true, true);
    assert.ok(Math.abs(avatar.head.rotation.x) + Math.abs(avatar.head.rotation.z) > .02, 'hands-busy reaction still shows expression');
    assert.equal(avatar.upperBody.rotation.x, 0); assert.equal(avatar.upperBody.rotation.z, 0);
    avatar.arms.forEach((arm, index) => { assert.equal(arm.rotation.x, -1.15); assert.equal(arm.rotation.z, (index === 0 ? -1 : 1) * .12); });
    avatar.forearms.forEach(arm => assert.equal(arm.rotation.x, -.12));
    for (const [now, moving] of [[9999, false], [12500, false], [10900, true]] as const) {
      poseOfficeAvatar(avatar, 900, now, action(kind), moving, true, true);
      assert.equal(avatar.head.rotation.x, 0); assert.equal(avatar.head.rotation.z, 0);
      assert.equal(avatar.upperBody.rotation.z, 0);
    }
    assert.equal(isMarketReaction(kind), true); assert.equal(getAvatarActionDuration(kind), 2500);
  }
  assert.equal(isMarketReaction('cheer'), false, 'ordinary arm gestures retain their carrying restriction');
});

test('both market reactions work while seated, including with a tray, and publish only head-bubble notices', { timeout: 30000 }, async () => {
  const { mf, room } = await createHarness();
  try {
    const actor = await join(mf, await identity(mf), '앉아서외치는사람');
    const peer = await join(mf, await identity(mf), '옆자리사람'), id = actor.welcome.me.id;
    async function command(message: Message) { actor.send(message); return actor.wait(value => value.requestId === message.requestId); }
    await command({ type: 'sit', seat: 0, requestId: 'reaction-sit' });
    let now = Date.now();
    for (const holding of [false, true]) {
      if (holding) {
        await room.testPositions({ [id]: { x: REFRESHMENT_STATION.standX, z: REFRESHMENT_STATION.standZ } });
        await command({ type: 'refreshments', refreshments: { drink: 'coffee', snack: 'cookie' }, requestId: 'reaction-take' });
        await command({ type: 'sit', seat: 1, requestId: 'reaction-sit-with-tray' });
      }
      const before = (await room.testSnapshot()).players.find(player => player.id === id)!;
      assert.ok('refreshments' in before, 'snapshot includes the current held selection');
      for (const kind of kinds) {
        now += 3000; await room.testClock(now, false);
        const requestId = `reaction-${kind}-${holding}`, result = await command({ type: 'avatar-action', kind, requestId });
        assert.equal(result.type, 'avatar-action'); assert.equal(result.action.kind, kind);
        const heard = await peer.wait(message => message.type === 'action-notice' && message.notice.kind === kind);
        assert.equal(heard.notice.playerId, id); assert.equal(heard.notice.text, actionNoticeText(kind));
        assert.equal(peer.messages.some(message => message.type === 'chat'), false, 'action text must stay out of normal chat');
        const after = (await room.testSnapshot()).players.find(player => player.id === id)!;
        assert.ok('refreshments' in after, 'reaction must not remove the held-selection field');
        assert.deepEqual([after.x, after.z, after.seat, after.refreshments], [before.x, before.z, before.seat, before.refreshments]);
        assert.equal((await command({ type: 'avatar-action', kind, requestId })).action.id, result.action.id, 'retry acknowledges without restarting');
        assert.equal((await command({ type: 'avatar-action', kind, requestId: `${requestId}-fast` })).code, 'ACTION_COOLDOWN');
      }
    }
  } finally { await mf.dispose(); }
});
