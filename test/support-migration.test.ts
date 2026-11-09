import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { admin, identity, join, login, manage, origin, type Message } from './office-helpers';
import { DONATION_SETUP_VERSION, PODEUM_SUPPORT_URL } from '../shared/support-link';

test('new rooms expose the owner support link and persist its setup marker', { timeout: 30000 }, async () => {
  const { mf, room, restart } = await createHarness();
  try {
    const status = await mf.dispatchFetch(`${origin}/api/status`).then(r => r.json()) as Message;
    assert.equal(status.settings.donationUrl, PODEUM_SUPPORT_URL);
    const before = JSON.parse(JSON.stringify(await room.testSnapshot()));
    assert.equal(before.runtime.donationSetupVersion, DONATION_SETUP_VERSION);
    assert.equal(before.storedRuntime.donationSetupVersion, DONATION_SETUP_VERSION);
    await restart();
    const after = await room.testSnapshot();
    assert.deepEqual(after.runtime, before.runtime);
    assert.deepEqual(after.office, before.office);
    assert.equal(after.alarmAt, null);
  } finally { await mf.dispose(); }
});

test('existing rooms initialize only an empty support link and preserve office and operator state', { timeout: 30000 }, async () => {
  const { mf, room, restart } = await createHarness();
  try {
    const auth = await login(mf);
    await join(mf, await identity(mf), '보존하는동료');
    const settings = { notice: '이 공지는 보존', donationUrl: '', chatEnabled: false };
    assert.equal((await manage(mf, auth, { action: 'settings', ...settings })).status, 200);
    assert.equal((await admin(mf, 'control', { action: 'close' }, auth.cookie, auth.csrf)).status, 200);
    await room.testPreviousSupport({ ...settings, interval: '15' });
    const before = JSON.parse(JSON.stringify(await room.testSnapshot()));
    await restart();
    const after = JSON.parse(JSON.stringify(await room.testSnapshot()));
    assert.deepEqual(after.runtime.settings, { ...settings, interval: '15', donationUrl: PODEUM_SUPPORT_URL });
    assert.equal(after.runtime.roomOpen, false);
    assert.deepEqual(after.runtime.blocks, before.runtime.blocks);
    assert.deepEqual(after.runtime.audit, before.runtime.audit);
    assert.deepEqual(after.office, before.office);
    assert.deepEqual(after.accounts, before.accounts);
    assert.deepEqual(after.board, before.board);
    assert.equal(after.storedRuntime.donationSetupVersion, DONATION_SETUP_VERSION);
    assert.equal((await admin(mf, 'session', undefined, auth.cookie)).status, 200);
    await restart();
    assert.deepEqual((await room.testSnapshot()).runtime, after.runtime);
  } finally { await mf.dispose(); }
});

test('existing configured link, subsequent clearing and replacement all survive server restarts', { timeout: 30000 }, async () => {
  const { mf, room, restart } = await createHarness();
  try {
    const auth = await login(mf), existing = 'https://link.kakaopay.com/current-owner-link';
    await room.testPreviousSupport({ donationUrl: existing }); await restart();
    assert.equal((await room.testSnapshot()).runtime.settings.donationUrl, existing);
    assert.equal((await manage(mf, auth, { action: 'settings', notice: '', donationUrl: '', chatEnabled: true })).status, 200);
    await restart();
    assert.equal((await room.testSnapshot()).runtime.settings.donationUrl, '', 'owner clearing must not be mistaken for an uninitialized setting');
    assert.equal((await room.testSnapshot()).storedRuntime.donationSetupVersion, DONATION_SETUP_VERSION);
    const changed = 'https://qr.kakaopay.com/another-owner-link';
    assert.equal((await manage(mf, auth, { action: 'settings', notice: '유지', donationUrl: changed, chatEnabled: true })).status, 200);
    await restart();
    assert.equal((await room.testSnapshot()).runtime.settings.donationUrl, changed);
    assert.equal((await room.testSnapshot()).runtime.settings.notice, '유지');
  } finally { await mf.dispose(); }
});
