import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartPresentation, tradingViewChartConfig, isBoatsSessionWindow } from '../shared/chart-presentation';
import type { MarketSymbol } from '../shared/market-catalog';

const daytime = Date.parse('2026-11-06T18:00:00Z'); // Friday 13:00 America/New_York.
const nighttime = Date.parse('2026-11-06T07:00:00Z'); // Friday 02:00 America/New_York.

test('US daytime intraday embeds request extended hours and keep the primary exchange source', () => {
  for (const symbol of ['AMEX:SOXL', 'NASDAQ:TQQQ', 'NASDAQ:AAPL', 'NYSE:BRK.B']) {
    const config = tradingViewChartConfig(symbol, '1', true, undefined, daytime);
    assert.equal(config.extended_hours, true); assert.equal(config.symbol, symbol); assert.equal(config.interval, '1');
    assert.equal(config.allow_symbol_change, false); assert.equal(config.timezone, 'Asia/Seoul');
    const presentation = chartPresentation(symbol, '1', undefined, daytime);
    assert.match(presentation.sessionNote, /프리·애프터/); assert.match(presentation.dataNote, /지연/); assert.doesNotMatch(presentation.dataNote, /실시간/);
  }
  assert.equal(chartPresentation('AMEX:SOXL', '1').overnightUrl, 'https://www.tradingview.com/symbols/BOATS-SOXL/');
  assert.equal(chartPresentation('NASDAQ:TQQQ', '1').overnightUrl, 'https://www.tradingview.com/symbols/BOATS-TQQQ/');
  assert.equal(chartPresentation('NASDAQ:AAPL', '1').overnightUrl, null);
});

test('SOXL and TQQQ use verified BOATS widgets overnight while stored market identity stays primary', () => {
  for (const [base, effective] of [['AMEX:SOXL', 'BOATS:SOXL'], ['NASDAQ:TQQQ', 'BOATS:TQQQ']]) {
    const presentation = chartPresentation(base!, '1', undefined, nighttime);
    assert.equal(presentation.market.symbol, base); assert.equal(presentation.chartSymbol, effective);
    assert.equal(presentation.overnightActive, true); assert.match(presentation.sessionNote, /야간 BOATS/);
    assert.match(presentation.dataNote, /휴장 시 마지막 체결가/); assert.doesNotMatch(presentation.dataNote, /실시간/);
    assert.equal(tradingViewChartConfig(base!, '1', true, undefined, nighttime).symbol, effective);
    assert.equal(tradingViewChartConfig(base!, 'D', true, undefined, nighttime).symbol, base);
    assert.equal(tradingViewChartConfig(base!, '1', true, undefined, daytime).symbol, base);
  }
  for (const symbol of ['NASDAQ:AAPL', 'AMEX:SOXS', 'BINANCE:BTCUSDT', 'COINBASE:USDTUSD', 'KRX:005930']) {
    assert.equal(tradingViewChartConfig(symbol, '1', true, undefined, nighttime).symbol, symbol);
    assert.equal(chartPresentation(symbol, '1', undefined, nighttime).overnightActive, false);
  }
});

test('BOATS scheduled sessions start Sunday evening, end Friday morning and exclude weekends', () => {
  for (const [timestamp, expected] of [
    ['2026-11-02T00:59:59Z', false], // Sunday 19:59:59 EST.
    ['2026-11-02T01:00:00Z', true], // Sunday 20:00 EST.
    ['2026-11-02T08:59:59Z', true], // Monday 03:59:59 EST.
    ['2026-11-02T09:00:00Z', false], // Monday 04:00 EST.
    ['2026-11-06T08:59:59Z', true], // Friday 03:59:59 EST.
    ['2026-11-06T09:00:00Z', false], // Friday 04:00 EST.
    ['2026-11-07T01:00:00Z', false], // Friday 20:00 EST.
    ['2026-11-07T07:00:00Z', false], // Saturday 02:00 EST.
    ['2026-11-08T01:00:00Z', false], // Saturday 20:00 EST.
  ] as const) assert.equal(isBoatsSessionWindow(Date.parse(timestamp)), expected, timestamp);
  assert.equal(isBoatsSessionWindow(NaN), false);
});

test('New York daylight-saving transitions keep BOATS opening at 20:00 and closing at 04:00 local time', () => {
  for (const [timestamp, expected] of [
    ['2026-03-06T08:30:00Z', true], // Friday 03:30 EST before spring transition.
    ['2026-03-09T00:00:00Z', true], // Sunday 20:00 EDT after spring transition.
    ['2026-03-09T07:30:00Z', true], // Monday 03:30 EDT.
    ['2026-03-09T08:00:00Z', false], // Monday 04:00 EDT.
    ['2026-10-30T07:30:00Z', true], // Friday 03:30 EDT before fall transition.
    ['2026-11-02T00:30:00Z', false], // Sunday 19:30 EST after fall transition.
    ['2026-11-02T01:00:00Z', true], // Sunday 20:00 EST.
    ['2026-11-02T08:30:00Z', true], // Monday 03:30 EST.
    ['2026-11-02T09:00:00Z', false], // Monday 04:00 EST.
  ] as const) assert.equal(isBoatsSessionWindow(Date.parse(timestamp)), expected, timestamp);
});

test('Coinbase Tether and Binance pairs remain crypto with no US extended or overnight session labels', () => {
  const tether: MarketSymbol = { symbol: 'COINBASE:USDTUSD', name: '테더 / USD', exchange: 'COINBASE', kind: 'crypto' };
  for (const symbol of ['COINBASE:USDTUSD', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:XRPUSDT']) {
    const presentation = chartPresentation(symbol, '1', symbol === tether.symbol ? tether : undefined);
    assert.equal(presentation.crypto, true); assert.equal(presentation.market.kind, 'crypto');
    assert.equal(tradingViewChartConfig(symbol, '1', true, presentation.market).extended_hours, false);
    assert.equal(presentation.sessionNote, ''); assert.equal(presentation.overnightUrl, null);
    assert.match(presentation.dataNote, /암호화폐/); assert.doesNotMatch(presentation.dataNote, /주식|ETF|프리|애프터|실시간/);
  }
  assert.equal(chartPresentation(tether.symbol, '1').crypto, true, 'bare valid Coinbase symbol still classifies correctly');
  assert.equal(chartPresentation('AMEX:SOXL', '1', tether).crypto, false, 'stale metadata never classifies a different symbol');
});

test('daily, Korean and unsupported exchanges do not acquire US intraday session promises', () => {
  for (const [symbol, interval] of [['AMEX:SOXL', 'D'], ['NASDAQ:TQQQ', 'D'], ['KRX:005930', '1'], ['KRX:000660', '1'], ['LSE:VOD', '1']] as const) {
    assert.equal(tradingViewChartConfig(symbol, interval, false).extended_hours, false);
    assert.equal(chartPresentation(symbol, interval).sessionNote, '');
  }
  assert.match(chartPresentation('KRX:005930', '1').dataNote, /Vunelix/);
  assert.equal(chartPresentation('KRX:005930', '1').overnightUrl, null);
});
