import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/korean-chart-worker';

const base = 'https://podeumgo-charts.podeumgo.workers.dev';
const token = '18dd4af2-9cf5-4bbe-9a84-53239def81f8';

test('ticker wrapper only accepts fixed market selections and isolates embeds', async () => {
  const response = await worker.fetch(new Request(`${base}/ticker?market=kr&token=${token}&symbol=FAKE:INJECT`));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /KRX:005930,KRX:000660/);
  assert.doesNotMatch(body, /FAKE:INJECT/);
  assert.match(response.headers.get('Content-Security-Policy')!, /frame-ancestors https:\/\/podeumgo\.podeumgo\.workers\.dev/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  for (const query of [`market=other&token=${token}`, `market=us&token=<script>`, `market=us`]) {
    assert.equal((await worker.fetch(new Request(`${base}/ticker?${query}`))).status, 400);
  }
  assert.equal((await worker.fetch(new Request(`${base}/ticker?market=us&token=${token}`, { method: 'POST' }))).status, 404);
});

test('existing Korean chart path remains available alongside ticker route', async () => {
  const response = await worker.fetch(new Request(`${base}/?symbol=KRX:005930&token=${token}&compact=1`));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /vunelix-advanced-chart/);
  assert.match(body, /data-show-sidebar="false"/);
  assert.match(body, /data-period="1m"/);
  assert.match(body, /data-show-timeframes="false"/);
  assert.doesNotMatch(body, /vunelix-ticker-tape/);
});

test('Korean chart intervals translate to vendor units and reject untrusted input', async () => {
  for (const [interval, period] of [['1', '1m'], ['5', '5m'], ['15', '15m'], ['60', '1H'], ['D', '1D']]) {
    const response = await worker.fetch(new Request(`${base}/?symbol=KRX:005930&token=${token}&interval=${interval}`));
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(`data-period="${period}"`));
  }
  for (const interval of ['0', '1m', '999', '%22%3E%3Cscript%3E']) {
    assert.equal((await worker.fetch(new Request(`${base}/?symbol=KRX:005930&token=${token}&interval=${interval}`))).status, 400);
  }
});
