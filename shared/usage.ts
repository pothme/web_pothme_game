export type UsageLevel = 'normal' | 'warning' | 'critical' | 'exceeded' | 'unknown';
export interface UsageMetric {
  id: string;
  label: string;
  used: number | null;
  limit: number;
  unit: 'requests' | 'rows' | 'GB-s' | 'bytes';
  percent: number | null;
  level: UsageLevel;
  period: 'day' | 'storage';
  note?: string;
}
export interface WorkerTraffic { name: string; requests: number; errors: number; subrequests: number; cpuP50Ms: number | null; cpuP99Ms: number | null }
export interface UsageSnapshot {
  ok: true;
  configured: boolean;
  status: 'ready' | 'partial' | 'unavailable' | 'setup';
  fetchedAt: number | null;
  periodStart: number;
  periodEnd: number;
  resetAt: number;
  refreshAfter: number;
  stale: boolean;
  level: UsageLevel;
  metrics: UsageMetric[];
  workers: WorkerTraffic[];
  traffic: { doRequests: number | null; webSocketReceived: number | null; webSocketSent: number | null; responseBytes: number | null };
  messages: string[];
  dashboardUrl: string;
}
export function usageLevel(percent: number | null): UsageLevel {
  return percent == null ? 'unknown' : percent >= 100 ? 'exceeded' : percent >= 95 ? 'critical' : percent >= 80 ? 'warning' : 'normal';
}
export function dailyUsageWindow(now: number) {
  const date = new Date(now), start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { periodStart: start, periodEnd: now, resetAt: start + 86_400_000 };
}
