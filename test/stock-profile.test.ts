import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendStockProfileParams, formatStockProfile, stockProfileFromFields, validateStockProfile } from '../shared/stock-profile';
import { ROOM_CAPACITY } from '../shared/room-rules';
import { RULES } from '../server/domain';

test('optional stock labels require both fields and format KRW/USD without interpreting markup', () => {
  assert.equal(stockProfileFromFields('  ', '', 'KRW'), null);
  const korean = stockProfileFromFields(' 삼성전자 ', '70,000', 'KRW')!;
  assert.deepEqual(korean, { stock: '삼성전자', average: 70000, currency: 'KRW' });
  assert.equal(formatStockProfile(korean), '삼성전자 · 평단 70,000원');
  const us = stockProfileFromFields('SOXL', '23.456789', 'USD')!;
  assert.equal(formatStockProfile(us), 'SOXL · 평단 $23.456789');
  assert.equal(formatStockProfile({ ...us, average: 23.5 }), 'SOXL · 평단 $23.50');
  for (const args of [['SOXL', '', 'USD'], ['', '10', 'USD'], ['SOXL', '0', 'USD'], ['SOXL', '2e3', 'USD'], ['SOXL', '1,23', 'USD'], ['SOXL', '.3', 'USD'], ['SOXL', '1.1234567', 'USD']]) assert.throws(() => stockProfileFromFields(...args as [string, string, string]));
});

test('stock label wire validation bounds text, numeric values and currency and drops forged fields', () => {
  const valid = { stock: 'SOXL', average: 31.5, currency: 'USD' as const };
  for (const patch of [{ stock: '' }, { stock: '<script>' }, { stock: '가'.repeat(21) }, { stock: 'SO\nXL' }, { stock: '\u202eSOXL' }, { average: -1 }, { average: NaN }, { average: Infinity }, { average: '31.5' }, { average: 1e13 }, { average: 1e-7 }, { average: 1.1234567 }, { currency: 'BTC' }]) assert.throws(() => validateStockProfile({ ...valid, ...patch }));
  assert.deepEqual(validateStockProfile({ ...valid, id: 'someone-else', admin: true }), valid);
  const params = new URLSearchParams(); appendStockProfileParams(params, valid); assert.deepEqual(JSON.parse(params.get('profile')!), valid);
  appendStockProfileParams(params, null); assert.equal(params.get('profile'), 'null');
  assert.equal(ROOM_CAPACITY, 50); assert.equal(RULES.capacity, ROOM_CAPACITY);
});
