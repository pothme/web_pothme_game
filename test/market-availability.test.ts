import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './harness.mjs';
import { identity, join, login, setCharts, manage, origin, type Message } from './office-helpers';
import { DEFAULT_CHARTS } from '../shared/office-charts';
const rear = DEFAULT_CHARTS.slice(4).map(m => m.symbol);

test('Korean charts require explicit enablement for discovery and administrator chart changes', { timeout: 30000 }, async () => {
  for (const koreanChartsEnabled of [null, false]) {
    const { mf, room } = await createHarness({ koreanChartsEnabled });
    try {
      const status = await mf.dispatchFetch(`${origin}/api/status`).then(response => response.json()) as Message;
      assert.equal(status.koreanChartsEnabled, false);
      const lookup = async (kind: string, q = '') => await mf.dispatchFetch(`${origin}/api/markets/search?kind=${kind}&q=${encodeURIComponent(q)}`).then(response => response.json()) as Message;
      for (const kind of ['all', 'stock', 'kr']) {
        const result = await lookup(kind);
        assert.equal(result.koreanChartsEnabled, false);
        assert.ok(result.markets.every((market: Message) => market.region !== 'KR' && !market.symbol.startsWith('KRX:')));
        if (kind === 'all') { assert.equal(result.markets.length, 40); assert.ok(result.markets.some((market: Message) => market.assetType === 'etf')); }
        if (kind === 'kr') assert.deepEqual(result.markets, []);
      }
      assert.deepEqual((await lookup('all', '삼전')).markets, []);
      assert.deepEqual((await lookup('stock', '005930')).markets, []);
      assert.equal((await lookup('etf', 'QQQ')).markets[0].symbol, 'NASDAQ:QQQ');
      const client = await join(mf, await identity(mf));
      assert.equal(client.welcome.koreanChartsEnabled, false);
      client.send({ type: 'chart-propose', symbol: 'KRX:005930', region: 'US', requestId: 'disabled-kr-proposal' });
      const rejected = await client.wait(message => message.requestId === 'disabled-kr-proposal');
      assert.equal(rejected.type, 'error'); assert.equal(rejected.code, 'FEATURE_DISABLED');
      assert.equal((await room.testSnapshot()).office.selected.symbol, 'KRX:005930');
      const auth=await login(mf);
      const rejectedChange = await manage(mf,auth,{action:'charts',symbols:['KRX:005930','NASDAQ:QQQ','BINANCE:BTCUSDT','AMEX:SOXL',...rear],interval:'1'});
      assert.equal(rejectedChange.status,400);assert.equal((await rejectedChange.json() as Message).code,'KOREAN_CHARTS_DISABLED');
      await setCharts(mf,auth,['NASDAQ:QQQ','NASDAQ:AAPL','BINANCE:BTCUSDT','AMEX:SOXL',...rear]);
      assert.equal((await room.testSnapshot()).office.selected.symbol, 'NASDAQ:QQQ');
    } finally { await mf.dispose(); }
  }
});

test('disabling Korean charts across a restart preserves the previously selected chart and office records', { timeout: 30000 }, async () => {
  const { mf, room, restart } = await createHarness({ koreanChartsEnabled: true });
  try {
    const status = await mf.dispatchFetch(`${origin}/api/status`).then(response => response.json()) as Message;
    assert.equal(status.koreanChartsEnabled, true);
    const search = await mf.dispatchFetch(`${origin}/api/markets/search?kind=kr`).then(response => response.json()) as Message;
    assert.equal(search.koreanChartsEnabled, true); assert.equal(search.markets.length, 36);
    const cookie = await identity(mf), client = await join(mf, cookie);
    assert.equal(client.welcome.koreanChartsEnabled, true);
    const auth=await login(mf);await setCharts(mf,auth,['KRX:000660','KRX:005930','BINANCE:BTCUSDT','AMEX:SOXL',...rear]);
    const before = JSON.parse(JSON.stringify(await room.testSnapshot()));
    await restart({ koreanChartsEnabled: false });
    const after = JSON.parse(JSON.stringify(await room.testSnapshot()));
    assert.deepEqual(after.office, before.office); assert.deepEqual(after.accounts, before.accounts); assert.deepEqual(after.runtime, before.runtime);
    const disabled = await mf.dispatchFetch(`${origin}/api/status`).then(response => response.json()) as Message;
    assert.equal(disabled.koreanChartsEnabled, false); assert.equal(disabled.market.selected.symbol, 'KRX:000660');
    const returned = await join(mf, cookie);
    assert.equal(returned.welcome.koreanChartsEnabled, false); assert.equal(returned.welcome.market.selected.symbol, 'KRX:000660');
    returned.send({ type: 'chart-propose', symbol: 'KRX:005930', requestId: 'after-provider-disabled' });
    assert.equal((await returned.wait(message => message.requestId === 'after-provider-disabled')).code, 'FEATURE_DISABLED');
  } finally { await mf.dispose(); }
});
