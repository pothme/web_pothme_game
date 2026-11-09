import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, observe, origin, type Message } from './office-helpers';
import { appendStockProfileParams, type StockProfile } from '../shared/stock-profile';

test('public stock labels are optional, shared, identity-scoped and survive reconnect until explicitly cleared', { timeout: 30000 }, async () => {
  const { mf, restart } = await createHarness();
  try {
    const cookie = await identity(mf), watcher = await join(mf, await identity(mf), '보는동료');
    assert.equal(watcher.welcome.me.stockProfile, null); assert.equal(watcher.welcome.players[0].stockProfile, null);
    const connect = async (profile?: StockProfile | null) => {
      const url = new URL('/api/room?nickname=평단동료&positions=delta', origin);
      if (profile !== undefined) appendStockProfileParams(url.searchParams, profile);
      const response = await mf.dispatchFetch(url.toString(), { headers: { Cookie: cookie, Origin: origin, Upgrade: 'websocket' } });
      assert.equal(response.status, 101); const client = observe(response.webSocket!);
      return { ...client, welcome: await client.wait(value => value.type === 'welcome') };
    };
    const profile = { stock: '삼성전자', average: 70000, currency: 'KRW' as const };
    let client = await connect(profile), id = client.welcome.me.id;
    assert.deepEqual(client.welcome.me.stockProfile, profile);
    const roster = await watcher.wait(value => value.type === 'players' && value.players.some((player: Message) => player.id === id));
    assert.deepEqual(roster.players.find((player: Message) => player.id === id).stockProfile, profile);
    client = await connect(); assert.deepEqual(client.welcome.me.stockProfile, profile);
    assert.equal(client.welcome.players.find((player: Message) => player.id === watcher.welcome.me.id).stockProfile, null);
    await restart(); client = await connect(); assert.deepEqual(client.welcome.me.stockProfile, profile);
    const changed = { stock: 'SOXL', average: 31.55, currency: 'USD' as const };
    client = await connect(changed); assert.deepEqual(client.welcome.me.stockProfile, changed);
    client = await connect(null); assert.equal(client.welcome.me.stockProfile, null);
    client = await connect(); assert.equal(client.welcome.me.stockProfile, null);
  } finally { await mf.dispose(); }
});

test('invalid stock labels are rejected before admission and successful preflight does not persist them', { timeout: 30000 }, async () => {
  const { mf } = await createHarness();
  try {
    const cookie = await identity(mf);
    for (const raw of ['{bad', JSON.stringify({ stock: '<script>', average: 4, currency: 'USD' }), JSON.stringify({ stock: 'SOXL', average: 'NaN', currency: 'USD' }), 'x'.repeat(401)]) {
      const url = new URL('/api/join-check', origin); url.searchParams.set('nickname', '잘못된평단'); url.searchParams.set('profile', raw);
      const response = await mf.dispatchFetch(url.toString(), { headers: { Cookie: cookie, Origin: origin } });
      assert.equal(response.status, 400); assert.equal((await response.json() as Message).code, 'STOCK_PROFILE');
    }
    const url = new URL('/api/join-check?nickname=사전검사', origin); appendStockProfileParams(url.searchParams, { stock: 'TQQQ', average: 42, currency: 'USD' });
    assert.equal((await mf.dispatchFetch(url.toString(), { headers: { Cookie: cookie, Origin: origin } })).status, 200);
    const client = await join(mf, cookie, '사전검사'); assert.equal(client.welcome.me.stockProfile, null);
  } finally { await mf.dispose(); }
});
