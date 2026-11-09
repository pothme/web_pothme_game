import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyUsageWindow, usageLevel } from '../shared/usage';
import { assembleUsage, emptyUsage, UsageMonitor, type UsageSnapshotCache } from '../server/usage';
import type { UsageSnapshot } from '../shared/usage';
import { AdminAuth, initialAdmin } from '../server/admin';
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_ANALYTICS_TOKEN: 'local-usage-test-only' };
const now = Date.parse('2026-11-05T03:00:00Z');
// Deliberate fixture names; these do not assert production GraphQL type codes.
const fixtureTypes = { regular: ['fetch'], webSocket: ['ws'] };

test('usage quota window resets at 09:00 Korea and alert boundaries are inclusive', () => {
  assert.deepEqual(dailyUsageWindow(now), { periodStart: Date.parse('2026-11-05T00:00:00Z'), periodEnd: now, resetAt: Date.parse('2026-11-06T00:00:00Z') });
  assert.equal(dailyUsageWindow(Date.parse('2026-11-05T23:59:59Z')).resetAt, Date.parse('2026-11-06T00:00:00Z'));
  assert.deepEqual([null, 79.99, 80, 94.99, 95, 100].map(usageLevel), ['unknown', 'normal', 'warning', 'warning', 'critical', 'exceeded']);
});

test('usage separates billable websocket equivalents and raw traffic; rejects missing counters', () => {
  const result = assembleUsage(env, now, {
    workers: [{ sum: { requests: 81000 } }],
    traffic: [{ dimensions: { scriptName: 'podeumgo' }, sum: { requests: 81000, errors: 0, subrequests: 12 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 2500 } }],
    invocations: [{ dimensions: { type: 'fetch' }, sum: { requests: 100, responseBodySize: 2000 } }, { dimensions: { type: 'ws' }, sum: { requests: 2000, responseBodySize: 0 } }],
    periodic: [{ sum: { duration: 25, rowsRead: 500, rowsWritten: 10, inboundWebsocketMsgCount: 100, outboundWebsocketMsgCount: 5000 } }],
    storage: [{ max: { storedBytes: 20000 } }, { max: { storedBytes: 10000 } }],
  }, fixtureTypes);
  assert.equal(result.status, 'ready'); assert.equal(result.level, 'warning');
  assert.equal(result.metrics.find(item => item.id === 'doRequests')?.used, 205);
  assert.equal(result.traffic.doRequests, 2100); assert.equal(result.traffic.webSocketReceived, 2100);
  assert.equal(result.workers[0].cpuP99Ms, 2.5);
  assert.equal(result.metrics.find(item => item.id === 'storage')?.used, 30000);
  assert.equal(JSON.stringify(result).includes(env.CLOUDFLARE_ANALYTICS_TOKEN), false);
  const partial = assembleUsage(env, now, { workers: [{ sum: { requests: NaN } }] });
  assert.equal(partial.metrics[0].used, null); assert.equal(partial.status, 'unavailable');
  assert.equal(emptyUsage({}, now).status, 'setup');
});

test('usage queries are deduplicated and cached, stale data expires at daily rollover', async () => {
  let clock = now, calls = 0, fail = false;
  const mock = async (_url: unknown, init: RequestInit | undefined) => {
    calls++; assert.equal((init!.headers as Record<string, string>).Authorization, `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`);
    if (fail) return Response.json({ errors: [{ message: `do not leak ${env.CLOUDFLARE_ANALYTICS_TOKEN}` }] });
    const query = JSON.parse(init!.body as string).query as string;
    const row = query.includes('Periodic') ? { sum: { duration: 5, rowsRead: 10, rowsWritten: 2, inboundWebsocketMsgCount: 0, outboundWebsocketMsgCount: 0 } } : query.includes('Storage') ? { max: { storedBytes: 4096 } } : query.includes('InvocationsAdaptiveGroups') ? { dimensions: { type: 'fetch' }, sum: { requests: 3, responseBodySize: 80 } } : query.includes('dimensions') ? { dimensions: { scriptName: 'podeumgo' }, sum: { requests: 5, errors: 0, subrequests: 1 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 2000 } } : { sum: { requests: 5 } };
    return Response.json({ data: { viewer: { accounts: [{ rows: [row] }] } }, errors: null });
  };
  const monitor = new UsageMonitor(env, mock as typeof fetch, () => clock, undefined, fixtureTypes);
  const [first, second] = await Promise.all([monitor.get(), monitor.get()]);
  assert.equal(calls, 5); assert.deepEqual(first, second); assert.equal(first.status, 'ready');
  await monitor.get(); assert.equal(calls, 5);
  clock += 300_001; fail = true;
  const stale = await monitor.get(); assert.equal(stale.stale, true); assert.equal(stale.metrics[0].used, 5);
  assert.equal(JSON.stringify(stale).includes(env.CLOUDFLARE_ANALYTICS_TOKEN), false);
  clock = Date.parse('2026-11-06T00:00:01Z');
  const nextDay = await monitor.get(); assert.equal(nextDay.metrics[0].used, null); assert.equal(nextDay.stale, false);
  const unconfigured = new UsageMonitor({}, mock as typeof fetch, () => clock);
  const before = calls; await unconfigured.get(); assert.equal(calls, before);
});

test('admin usage route requires same-origin authentication and rechecks logout after fetch', async () => {
  let security = initialAdmin(), lookups = 0;
  const password = 'podeumgo-local-fixture-admin-2026-only';
  const auth = new AdminAuth(() => security, next => { security = next; }, () => password);
  const state = () => Response.json({ ok: true }), control = async () => state();
  const origin = 'http://local.test';
  const usage = async () => { lookups++; return emptyUsage({}, now); };
  const read = (headers = {}) => new Request(`${origin}/api/admin/usage`, { headers });
  assert.equal((await auth.route(read(), control, state, undefined, undefined, usage)).status, 401);
  assert.equal(lookups, 0);
  const login = await auth.route(new Request(`${origin}/api/admin/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }), control, state);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await auth.route(read({ Cookie: cookie, Origin: 'https://evil.test' }), control, state, undefined, undefined, usage)).status, 403);
  assert.equal((await auth.route(read({ Cookie: cookie }), control, state, undefined, undefined, usage)).status, 200);
  const pending = auth.route(read({ Cookie: cookie }), control, state, undefined, undefined, async () => { security = { ...security, sessions: [] }; return emptyUsage({}, now); });
  assert.equal((await pending).status, 401);
});

test('safe analytics cache survives monitor recreation and persists failed-query cooldown without credentials', async () => {
  let calls = 0, clock = now, fail = false;
  const saved = new Map<string, string>();
  const store: UsageSnapshotCache = { read: account => saved.has(account) ? JSON.parse(saved.get(account)!) : null, write: (account, snapshot) => { saved.set(account, JSON.stringify(snapshot)); } };
  const mock = async (_url: unknown, init: RequestInit | undefined) => {
    calls++; assert.equal(init?.redirect, 'manual');
    if (fail) return Response.json({ errors: [{ message: env.CLOUDFLARE_ANALYTICS_TOKEN }] });
    return Response.json({ data: { viewer: { accounts: [{ rows: [{ sum: { requests: 15 } }] }] } } });
  };
  const make = (config = env) => new UsageMonitor(config, mock as typeof fetch, () => clock, store, fixtureTypes);
  const first = await make().get(); assert.equal(first.status, 'partial'); assert.equal(calls, 5);
  const restored = await make().get(); assert.deepEqual(restored, first); assert.equal(calls, 5, 'hibernation does not trigger new upstream requests inside the shared TTL');
  assert.equal(saved.get(env.CLOUDFLARE_ACCOUNT_ID)!.includes(env.CLOUDFLARE_ANALYTICS_TOKEN), false);
  clock += 300_001; fail = true; const failed = await make().get(); assert.equal(failed.stale, true); assert.equal(failed.metrics[0].used, 15); assert.equal(calls, 10);
  assert.deepEqual(await make().get(), failed); assert.equal(calls, 10, 'failed refresh cooldown survives recreation as well');
  const another = await make({ ...env, CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) }).get(); assert.equal(another.metrics[0].used, null); assert.equal(calls, 15, 'account switch never reuses another account snapshot');
  await make({ ...env, CLOUDFLARE_ANALYTICS_TOKEN: '' }).get(); assert.equal(calls, 15);
  clock = Date.parse('2026-11-06T00:00:01Z'); const next = await make().get(); assert.equal(next.stale, false); assert.equal(next.metrics[0].used, null); assert.equal(calls, 20);
});

test('in-flight midnight rollover discards old daily counters before caching or returning to any caller', async () => {
  let clock = Date.parse('2026-11-05T23:59:59Z'), calls = 0;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { started = resolve; });
  const persisted: UsageSnapshot[] = [];
  const mock = async (_url: unknown, init: RequestInit | undefined) => {
    calls++; const before = calls <= 5;
    if (calls === 5) started();
    if (before) await gate;
    const payload = JSON.parse(init!.body as string); if (!before && !payload.query.includes('Storage')) assert.equal(payload.variables.start, '2026-11-06T00:00:00.000Z');
    return Response.json({ data: { viewer: { accounts: [{ rows: [{ sum: { requests: before ? 88000 : 2 } }] }] } } });
  };
  const monitor = new UsageMonitor(env, mock as typeof fetch, () => clock, { read: () => null, write: (_account, snapshot) => { persisted.push(snapshot); } }, fixtureTypes);
  const first = monitor.get(); await reading; clock = Date.parse('2026-11-06T00:00:01Z'); const second = monitor.get(); release();
  const [a, b] = await Promise.all([first, second]); assert.deepEqual(a, b); assert.equal(a.periodStart, Date.parse('2026-11-06T00:00:00Z')); assert.equal(a.metrics[0].used, 2); assert.equal(calls, 10);
  assert.equal(persisted.length, 1); assert.equal(persisted[0].periodStart, a.periodStart); assert.equal(JSON.stringify(persisted).includes('88000'), false);
});

test('unverified invocation types, absent storage samples and truncated or malformed traffic remain unknown', () => {
  const data = {
    workers: [{ sum: { requests: 5 } }],
    traffic: [{ dimensions: { scriptName: 'local-fixture' }, sum: { requests: 5, errors: 0, subrequests: 1 } }],
    invocations: [{ dimensions: { type: 'fetch' }, sum: { requests: 3, responseBodySize: 80 } }],
    periodic: [{ sum: { duration: 5, rowsRead: 10, rowsWritten: 2, inboundWebsocketMsgCount: 0, outboundWebsocketMsgCount: 0 } }],
    storage: [{ max: { storedBytes: 4096 } }],
  };
  const unknownTypes = assembleUsage(env, now, data); assert.equal(unknownTypes.metrics.find(metric => metric.id === 'doRequests')!.used, null); assert.equal(unknownTypes.level, 'unknown');
  const futureType = assembleUsage(env, now, { ...data, invocations: [{ dimensions: { type: 'new-unknown-type' }, sum: { requests: 100 } }] }, fixtureTypes); assert.equal(futureType.traffic.webSocketReceived, null);
  const emptyStorage = assembleUsage(env, now, { ...data, storage: [] }, fixtureTypes); assert.equal(emptyStorage.metrics.find(metric => metric.id === 'storage')!.used, null);
  const truncated = assembleUsage(env, now, { ...data, traffic: Array.from({ length: 100 }, () => data.traffic[0]) }, fixtureTypes); assert.equal(truncated.status, 'partial'); assert.deepEqual(truncated.workers, []);
  const malformed = assembleUsage(env, now, { ...data, traffic: [{ dimensions: { scriptName: 'bad-fixture' }, sum: { requests: 2 } }] }, fixtureTypes); assert.equal(malformed.status, 'partial'); assert.deepEqual(malformed.workers, []);
  const partial = assembleUsage(env, now, { workers: data.workers }, fixtureTypes); assert.equal(partial.level, 'unknown');
});

test('verified live invocation types produce the observed account request equivalent without rescaling GB-seconds', () => {
  const data = {
    workers: [{ sum: { requests: 487 } }],
    traffic: [{ dimensions: { scriptName: 'worker-fixture-a' }, sum: { requests: 299, errors: 0, subrequests: 0 } }, { dimensions: { scriptName: 'worker-fixture-b' }, sum: { requests: 188, errors: 0, subrequests: 0 } }],
    invocations: [{ dimensions: { type: 'http' }, sum: { requests: 233, responseBodySize: 0 } }, { dimensions: { type: 'alarm' }, sum: { requests: 2, responseBodySize: 0 } }, { dimensions: { type: 'hibernation' }, sum: { requests: 391, responseBodySize: 0 } }],
    periodic: [{ sum: { duration: 0.273459072, rowsRead: 467, rowsWritten: 83, inboundWebsocketMsgCount: 0, outboundWebsocketMsgCount: 964 } }],
  };
  const result = assembleUsage(env, now, data), metric = (id: string) => result.metrics.find(item => item.id === id)!.used;
  assert.equal(metric('workers'), 487); assert.equal(result.workers.reduce((total, worker) => total + worker.requests, 0), 487);
  assert.equal(metric('doRequests'), 254.55); assert.equal(result.traffic.doRequests, 626); assert.equal(result.traffic.webSocketReceived, 391); assert.equal(result.traffic.webSocketSent, 964);
  assert.equal(metric('duration'), 0.273459072); assert.equal(metric('reads'), 467); assert.equal(metric('writes'), 83); assert.equal(metric('storage'), null);
  assert.ok(result.messages.some(message => message.includes('표본')));
  const unknown = assembleUsage(env, now, { ...data, invocations: [...data.invocations, { dimensions: { type: 'future-rpc-type' }, sum: { requests: 1, responseBodySize: 0 } }] });
  assert.equal(unknown.metrics.find(item => item.id === 'doRequests')!.used, null); assert.equal(unknown.traffic.webSocketReceived, null); assert.equal(unknown.traffic.doRequests, 627, 'raw invocation totals do not require billing classification');
});

test('injected fetch executes as a standalone function without binding the UsageMonitor receiver', async () => {
  const receivers: unknown[] = [];
  const strictFetch = async function(this: unknown): Promise<Response> { receivers.push(this); return Response.json({ data: { viewer: { accounts: [{ rows: [{ sum: { requests: 5 } }] }] } } }); };
  const result = await new UsageMonitor(env, strictFetch as typeof fetch, () => now).get();
  assert.equal(receivers.length, 5); assert.ok(receivers.every(receiver => receiver === undefined)); assert.equal(result.metrics[0].used, 5);
});
