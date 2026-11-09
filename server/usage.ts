import { dailyUsageWindow, usageLevel, type UsageMetric, type UsageSnapshot, type WorkerTraffic } from '../shared/usage';

export interface UsageEnv { CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_ANALYTICS_TOKEN?: string }
export interface UsageInvocationTypes { regular: readonly string[]; webSocket: readonly string[] }
/** Verified against the account's live GraphQL schema and response on 2026-11-05. */
export const VERIFIED_INVOCATION_TYPES: UsageInvocationTypes = Object.freeze({ regular: ['http', 'alarm'], webSocket: ['hibernation'] });
export interface UsageSnapshotCache { read(accountId: string): UsageSnapshot | null; write(accountId: string, snapshot: UsageSnapshot): void }
type Row = { sum?: Record<string, number>; max?: Record<string, number>; quantiles?: Record<string, number>; dimensions?: Record<string, string> };
interface Result { data?: { viewer?: { accounts?: Record<string, Row[]>[] } }; errors?: unknown[] | null }
const API = 'https://api.cloudflare.com/client/v4/graphql', CACHE_MS = 300_000;
const DEFINITIONS: Omit<UsageMetric, 'used' | 'percent' | 'level'>[] = [
  { id: 'workers', label: 'Worker 요청', limit: 100_000, unit: 'requests', period: 'day' },
  { id: 'doRequests', label: '실시간 서버 요청 환산', limit: 100_000, unit: 'requests', period: 'day', note: '일반 호출 + 수신 WebSocket 메시지 ÷ 20. Analytics 기반 과금 환산 추정치입니다.' },
  { id: 'duration', label: '실시간 서버 실행', limit: 13_000, unit: 'GB-s', period: 'day' },
  { id: 'reads', label: 'DB 읽기', limit: 5_000_000, unit: 'rows', period: 'day' },
  { id: 'writes', label: 'DB 쓰기', limit: 100_000, unit: 'rows', period: 'day' },
  { id: 'storage', label: 'DB 저장 공간', limit: 5_000_000_000, unit: 'bytes', period: 'storage', note: '최근 24시간 SQL 네임스페이스별 관측 최대 저장량의 합계입니다.' },
];
export function usageMetric(definition: typeof DEFINITIONS[number], used: number | null): UsageMetric {
  const value = used != null && Number.isFinite(used) && used >= 0 ? used : null;
  const percent = value == null ? null : value / definition.limit * 100;
  return { ...definition, used: value, percent, level: usageLevel(percent) };
}
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function sum(rows: Row[], field: string): number | null {
  if (rows.some(row => !validNumber(row?.sum?.[field]))) return null;
  const total = rows.reduce((count, row) => count + row.sum![field]!, 0);
  return validNumber(total) ? total : null;
}
function highest(metrics: UsageMetric[]): UsageSnapshot['level'] {
  const order = ['unknown', 'normal', 'warning', 'critical', 'exceeded'] as const;
  const level = order[Math.max(...metrics.map(metric => order.indexOf(metric.level)))];
  return level === 'normal' && metrics.some(metric => metric.level === 'unknown') ? 'unknown' : level;
}
export function emptyUsage(env: UsageEnv, now: number): UsageSnapshot {
  const configured = Boolean(env.CLOUDFLARE_ANALYTICS_TOKEN && /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? ''));
  return { ok: true, configured, status: configured ? 'unavailable' : 'setup', fetchedAt: null, ...dailyUsageWindow(now), refreshAfter: now + CACHE_MS, stale: false, level: 'unknown', metrics: DEFINITIONS.map(def => usageMetric(def, null)), workers: [], traffic: { doRequests: null, webSocketReceived: null, webSocketSent: null, responseBytes: null }, messages: [configured ? 'Cloudflare 사용량을 아직 불러오지 못했어요.' : 'Cloudflare 분석 읽기 토큰을 서버 비밀 설정에 연결하면 실제 사용량이 표시됩니다.'], dashboardUrl: /^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') ? `https://dash.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/workers-and-pages` : 'https://dash.cloudflare.com/' };
}

// Query each dataset independently, so a temporarily unavailable product does not
// hide the other counters. All requests share the same UTC daily billing window.
export const USAGE_SELECTIONS = {
  workers: 'workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end}) { sum { requests } }',
  traffic: 'workersInvocationsAdaptive(limit: 100, filter: {datetime_geq: $start, datetime_lt: $end}) { dimensions { scriptName } sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } }',
  invocations: 'durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: {datetime_geq: $start, datetime_lt: $end}) { dimensions { type } sum { requests responseBodySize } }',
  periodic: 'durableObjectsPeriodicGroups(limit: 1, filter: {datetime_geq: $start, datetime_lt: $end}) { sum { duration rowsRead rowsWritten inboundWebsocketMsgCount outboundWebsocketMsgCount } }',
  storage: 'durableObjectsSqlStorageGroups(limit: 10000, filter: {datetime_geq: $start, datetime_lt: $end}) { dimensions { namespaceId } max { storedBytes } }',
} as const;
type Dataset = keyof typeof USAGE_SELECTIONS;
export function usageQuery(dataset: Dataset): string { return `query Usage($account: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: {accountTag: $account}) { rows: ${USAGE_SELECTIONS[dataset]} } } }`; }

export function assembleUsage(env: UsageEnv, now: number, data: Partial<Record<Dataset, Row[]>>, types = VERIFIED_INVOCATION_TYPES): UsageSnapshot {
  const snapshot = emptyUsage(env, now), values: Record<string, number | null> = {}, messages: string[] = [];
  const workers = data.workers, traffic = data.traffic, invocations = data.invocations, periodic = data.periodic, storage = data.storage;
  values.workers = workers ? sum(workers, 'requests') : null;
  values.duration = periodic ? sum(periodic, 'duration') : null;
  values.reads = periodic ? sum(periodic, 'rowsRead') : null;
  values.writes = periodic ? sum(periodic, 'rowsWritten') : null;
  values.storage = storage && storage.length > 0 && storage.length < 10000 && storage.every(row => validNumber(row?.max?.storedBytes)) ? storage.reduce((total, row) => total + row.max!.storedBytes, 0) : null;
  // Unknown/new invocation types must not silently count as ordinary requests.
  const websocketTypes = new Set(types?.webSocket ?? []), regularTypes = new Set(types?.regular ?? []);
  let regular = 0, hibernated = 0;
  if (invocations) for (const row of invocations) {
    if (invocations.length >= 100 || !validNumber(row?.sum?.requests)) { regular = NaN; break; }
    const type = row.dimensions?.type ?? '';
    if (websocketTypes.has(type)) hibernated += row.sum!.requests;
    else if (regularTypes.has(type)) regular += row.sum!.requests;
    else { regular = NaN; break; }
  }
  const periodicReceived = periodic ? sum(periodic, 'inboundWebsocketMsgCount') : null;
  const received = invocations && periodicReceived != null && Number.isFinite(regular) ? hibernated + periodicReceived : null;
  values.doRequests = received != null ? regular + received / 20 : null;
  const metrics = DEFINITIONS.map(def => usageMetric(def, values[def.id] ?? null));
  const trafficComplete = !!traffic && traffic.length < 100 && traffic.every(row => typeof row?.dimensions?.scriptName === 'string' && row.dimensions.scriptName.length > 0 && row.dimensions.scriptName.length <= 256 && ['requests', 'errors', 'subrequests'].every(field => validNumber(row.sum?.[field])));
  const workerTraffic: WorkerTraffic[] = !trafficComplete ? [] : traffic!.map(row => ({ name: row.dimensions!.scriptName, requests: row.sum!.requests, errors: row.sum!.errors, subrequests: row.sum!.subrequests, cpuP50Ms: validNumber(row.quantiles?.cpuTimeP50) ? row.quantiles.cpuTimeP50 / 1000 : null, cpuP99Ms: validNumber(row.quantiles?.cpuTimeP99) ? row.quantiles.cpuTimeP99 / 1000 : null }));
  const complete = metrics.every(metric => metric.used != null) && trafficComplete;
  const any = metrics.some(metric => metric.used != null);
  if (!complete) messages.push('일부 사용량을 조회하지 못했어요. 확인되지 않은 항목은 0으로 표시하지 않습니다.');
  messages.push('계정 전체의 Free 한도 기준이며, 일일 한도는 한국시간 오전 9시에 초기화됩니다. Cloudflare 집계는 수 분 지연될 수 있습니다.');
  messages.push('요청 수는 지연·표본 집계에 따른 추정치입니다. WebSocket 연결 자체는 종료 후 반영될 수 있어 실제 과금 수치와 차이가 있을 수 있습니다.');
  messages.push('요청 수 기반 트래픽입니다. 정적 파일·외부 차트 공급자·WebSocket 전체 전송량은 아래 응답 바이트에 포함되지 않습니다.');
  return { ...snapshot, status: complete ? 'ready' : any ? 'partial' : 'unavailable', fetchedAt: any ? now : null, metrics, workers: workerTraffic, traffic: { doRequests: invocations && invocations.length < 100 ? sum(invocations, 'requests') : null, webSocketReceived: received, webSocketSent: periodic ? sum(periodic, 'outboundWebsocketMsgCount') : null, responseBytes: invocations && invocations.length < 100 ? sum(invocations, 'responseBodySize') : null }, level: highest(metrics), messages };
}

/** One shared cache in the room DO; never queried by unauthenticated clients. */
export class UsageMonitor {
  private cached: UsageSnapshot | null = null;
  private inflight: Promise<UsageSnapshot> | null = null;
  private restored = false;
  constructor(private env: UsageEnv, private fetcher: typeof fetch = fetch, private now: () => number = Date.now, private persistent?: UsageSnapshotCache, private types = VERIFIED_INVOCATION_TYPES) {}
  async get(): Promise<UsageSnapshot> {
    const now = this.now(), empty = emptyUsage(this.env, now);
    if (!empty.configured) return empty;
    if (!this.restored) {
      this.restored = true;
      try {
        const saved = this.persistent?.read(this.env.CLOUDFLARE_ACCOUNT_ID!);
        if (saved?.ok && saved.configured && saved.periodStart === empty.periodStart && validNumber(saved.periodEnd) && saved.periodEnd <= now && saved.refreshAfter <= now + CACHE_MS && Array.isArray(saved.metrics) && Array.isArray(saved.workers) && Array.isArray(saved.messages) && saved.traffic) this.cached = saved;
      } catch { /* A missing/obsolete cache never prevents a fresh analytics read. */ }
    }
    if (this.cached && this.cached.periodStart === empty.periodStart && this.cached.refreshAfter > now) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }
  private remember(snapshot: UsageSnapshot): UsageSnapshot {
    this.cached = snapshot;
    try { this.persistent?.write(this.env.CLOUDFLARE_ACCOUNT_ID!, snapshot); } catch { /* Keep the in-memory cache if storage is temporarily unavailable. */ }
    return snapshot;
  }
  private async refresh(): Promise<UsageSnapshot> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const next = await this.load(this.now()), finishedAt = this.now();
      // Every caller sharing an in-flight read gets the current billing day.
      // A result crossing midnight is discarded before it can reach storage/UI.
      if (next.periodStart !== dailyUsageWindow(finishedAt).periodStart) continue;
      next.refreshAfter = finishedAt + CACHE_MS;
      if (next.fetchedAt !== null) next.fetchedAt = finishedAt;
      if (next.status === 'unavailable' && this.cached?.fetchedAt && this.cached.periodStart === next.periodStart) {
        return this.remember({ ...this.cached, stale: true, status: 'unavailable', refreshAfter: next.refreshAfter, messages: ['현재 조회에 실패해 마지막 성공 수치를 표시합니다. 최신 사용량은 Cloudflare 대시보드에서 확인해 주세요.', ...next.messages] });
      }
      return this.remember(next);
    }
    return this.remember(emptyUsage(this.env, this.now()));
  }
  private async load(now: number): Promise<UsageSnapshot> {
    const data: Partial<Record<Dataset, Row[]>> = {}, start = dailyUsageWindow(now).periodStart;
    // Workerd's native fetch rejects a UsageMonitor receiver (illegal invocation).
    const fetcher = this.fetcher;
    await Promise.allSettled((Object.keys(USAGE_SELECTIONS) as Dataset[]).map(async dataset => {
      // Workers does not implement redirect:'error'. Manual + !ok rejects redirects
      // without forwarding the account's authorization header to another endpoint.
      const response = await fetcher(API, { method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${this.env.CLOUDFLARE_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: usageQuery(dataset), variables: { account: this.env.CLOUDFLARE_ACCOUNT_ID, start: new Date(dataset === 'storage' ? now - 86_400_000 : start).toISOString(), end: new Date(now).toISOString() } }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Analytics unavailable');
      const body = await response.json() as Result;
      if (body.errors?.length || body.data?.viewer?.accounts?.length !== 1 || !Array.isArray(body.data.viewer.accounts[0].rows) || body.data.viewer.accounts[0].rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Analytics unavailable');
      data[dataset] = body.data.viewer.accounts[0].rows;
    }));
    return assembleUsage(this.env, now, data, this.types);
  }
}
