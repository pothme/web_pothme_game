import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { DEFAULT_CHARTS, OFFICE_CHART_LAYOUT_VERSION } from '../shared/office-charts';
import { CURATED_MARKETS } from '../shared/market-catalog';
import { identity, join, login, admin, manage, setCharts, origin, type Message } from './office-helpers';
const defaults = ['KRX:005930', 'KRX:000660', 'NASDAQ:TQQQ', 'AMEX:SOXL', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:XRPUSDT', 'COINBASE:USDTUSD'];
const symbols = (charts: Message[]) => charts.map(m => m.symbol);

test('admin-only eight charts and one-minute settings reach status, welcome and live clients and survive restart', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  assert.deepEqual(DEFAULT_CHARTS.map(m => m.symbol), defaults);
  const auth = await login(mf), cookie = await identity(mf); let client = await join(mf, cookie);
  assert.deepEqual(symbols(client.welcome.market.charts), defaults); assert.equal(client.welcome.settings.interval, '1');
  const requested = [...defaults]; requested[2] = 'NASDAQ:NVDA'; requested[7] = 'BINANCE:SOLUSDT';
  const result = await setCharts(mf, auth, requested, '15');
  assert.deepEqual(symbols(result.charts), requested); assert.equal(result.voteActive, false); assert.equal(result.settings.interval, '15');
  await client.wait(m => m.type === 'market' && m.state.charts[2].symbol === 'NASDAQ:NVDA');
  await client.wait(m => m.type === 'settings' && m.settings.interval === '15');
  await restart(); client = await join(mf, cookie);
  assert.deepEqual(symbols(client.welcome.market.charts), requested); assert.equal(client.welcome.settings.interval, '15');
  const status = await mf.dispatchFetch(`${origin}/api/status`).then(r => r.json()) as Message;
  assert.deepEqual(symbols(status.market.charts), requested); assert.deepEqual(symbols(status.charts), requested); assert.equal(status.settings.interval, '15'); assert.equal(status.onlineCount, 1); assert.equal(status.capacity, 50); assert.equal(status.overflowUrl, '/markets');
  assert.equal((await room.testSnapshot()).alarmAt, null);
 } finally { await mf.dispose(); }
});

test('management migration resets old charts exactly once, cancels votes and preserves closed state and financial records', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const auth = await login(mf); await room.testLegacy(false);
  const selected = CURATED_MARKETS.find(m => m.symbol === 'NASDAQ:TSLA')!;
  await room.testStoreOffice({ selected, vote: { id: 'old-vote', slot: 0, proposal: selected, deadline: Date.now() + 30000 }, lastResult: null });
  await restart(); let snapshot = await room.testSnapshot();
  assert.equal(snapshot.runtime.roomOpen, false); assert.equal(snapshot.runtime.managementVersion, 1); assert.deepEqual(snapshot.office.charts.map(m => m.symbol), defaults);
  assert.equal(snapshot.office.vote, null); assert.equal(snapshot.alarmAt, null); assert.equal(snapshot.accounts[0]!.balance, 12345); assert.equal(snapshot.board[0]!.text, '보존할 글');
  const changed = ['NASDAQ:TSLA', 'NASDAQ:AAPL', 'BINANCE:ETHUSDT', 'NASDAQ:QQQ', ...defaults.slice(4)];
  await setCharts(mf, auth, changed, 'D'); await restart(); snapshot = await room.testSnapshot();
  assert.deepEqual(snapshot.office.charts.map(m => m.symbol), changed); assert.equal(snapshot.runtime.settings.interval, 'D'); assert.equal(snapshot.runtime.roomOpen, false); assert.equal(snapshot.accounts[0]!.balance, 12345);
  assert.equal((await admin(mf, 'state', undefined, auth.cookie)).status, 200);
 } finally { await mf.dispose(); }
});

test('chart mutations validate all symbols and intervals atomically and roll back audit/settings on failed storage', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const auth = await login(mf), before = JSON.parse(JSON.stringify(await room.testSnapshot()));
  for (const body of [
   { action: 'charts', symbols: defaults.slice(1), interval: '1' },
   { action: 'charts', symbols: [...defaults.slice(0, 7), 'https://bad.invalid'], interval: '1' },
   { action: 'charts', symbols: defaults, interval: '2' },
   { action: 'charts', symbols: defaults, interval: 1 },
  ]) assert.equal((await manage(mf, auth, body)).status, 400);
  await room.testFailSave(); assert.equal((await manage(mf, auth, { action: 'charts', symbols: ['NASDAQ:NVDA', ...defaults.slice(1)], interval: '60' })).status, 500);
  const after = JSON.parse(JSON.stringify(await room.testSnapshot())); assert.deepEqual(after.office, before.office); assert.deepEqual(after.runtime, before.runtime);
  await setCharts(mf, auth, ['NASDAQ:NVDA', ...defaults.slice(1)], '60');
  assert.equal((await room.testSnapshot()).runtime.audit.length, 1);
 } finally { await mf.dispose(); }
});

test('four-chart offices upgrade once while closed, preserving settings, identity access and unrelated stored data', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const auth = await login(mf); await join(mf, await identity(mf));
  await manage(mf, auth, { action: 'settings', notice: '보존할 운영 공지', donationUrl: 'https://qr.kakaopay.com/test', chatEnabled: false });
  await admin(mf, 'control', { action: 'close' }, auth.cookie, auth.csrf);
  const oldCharts = ['NASDAQ:TSLA', 'NASDAQ:AAPL', 'BINANCE:BTCUSDT', 'AMEX:SOXL'].map(symbol => CURATED_MARKETS.find(m => m.symbol === symbol)!);
  await room.testStoreOffice({ selected: oldCharts[0], charts: oldCharts, vote: null, lastResult: null });
  const before = JSON.parse(JSON.stringify(await room.testSnapshot()));
  await restart(); const migrated = await room.testSnapshot();
  assert.equal(migrated.office.chartLayoutVersion, OFFICE_CHART_LAYOUT_VERSION); assert.deepEqual(migrated.office.charts.map(m => m.symbol), defaults);
  assert.deepEqual(migrated.runtime, before.runtime); assert.deepEqual(migrated.accounts, before.accounts); assert.deepEqual(migrated.board, before.board);
  assert.equal((await admin(mf, 'state', undefined, auth.cookie)).status, 200);
  const stale = await manage(mf, auth, { action: 'charts', symbols: oldCharts.map(m => m.symbol), interval: '1' });
  assert.equal(stale.status, 400); assert.match((await stale.json() as Message).message, /새로고침/);
  const changed = [...defaults]; changed[0] = 'NASDAQ:AAPL'; changed[7] = 'BINANCE:DOGEUSDT';
  await setCharts(mf, auth, changed, '5'); await restart(); const after = await room.testSnapshot();
  assert.deepEqual(after.office.charts.map(m => m.symbol), changed); assert.equal(after.office.chartLayoutVersion, OFFICE_CHART_LAYOUT_VERSION);
  assert.equal(after.runtime.roomOpen, false); assert.equal(after.runtime.settings.notice, '보존할 운영 공지'); assert.equal(after.runtime.settings.donationUrl, 'https://qr.kakaopay.com/test');
  assert.equal((await admin(mf, 'manage', { action: 'charts', symbols: defaults, interval: '1' })).status, 401);
 } finally { await mf.dispose(); }
});

test('all public proposal/vote requests including saved legacy receipts are rejected without SQL mutations', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const client = await join(mf, await identity(mf)), request = { type: 'chart-propose', symbol: 'NASDAQ:AAPL', requestId: 'legacy-proposal-id' };
  await room.testLegacyReceipt(client.welcome.me.id, request.symbol, request.requestId);
  const before = JSON.parse(JSON.stringify(await room.testSnapshot()));
  for (const input of [request, { ...request, slot: 3 }, { type: 'chart-vote', voteId: 'old', approve: true, requestId: 'old-ballot' }]) { client.send(input); assert.equal((await client.wait(m => m.requestId === input.requestId)).code, 'FEATURE_DISABLED'); }
  const after = JSON.parse(JSON.stringify(await room.testSnapshot()));
  assert.deepEqual(after.office, before.office); assert.deepEqual(after.runtime, before.runtime); assert.deepEqual(after.accounts, before.accounts); assert.equal(after.alarmAt, null);
 } finally { await mf.dispose(); }
});
