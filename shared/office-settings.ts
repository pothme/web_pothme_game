export const CHART_INTERVALS = ['1', '5', '15', '60', 'D'] as const;
export type ChartInterval = typeof CHART_INTERVALS[number];
export interface OfficeSettings { interval: ChartInterval; notice: string; donationUrl: string; chatEnabled: boolean }
export const DEFAULT_OFFICE_SETTINGS: Readonly<OfficeSettings> = Object.freeze({ interval: '1', notice: '', donationUrl: '', chatEnabled: true });
export function normalizeOfficeSettings(value: unknown): OfficeSettings {
  const settings = value && typeof value === 'object' ? value as Partial<OfficeSettings> : {};
  return {
    interval: CHART_INTERVALS.includes(settings.interval as ChartInterval) ? settings.interval as ChartInterval : '1',
    notice: typeof settings.notice === 'string' ? settings.notice : '',
    donationUrl: typeof settings.donationUrl === 'string' ? settings.donationUrl : '',
    chatEnabled: typeof settings.chatEnabled === 'boolean' ? settings.chatEnabled : true,
  };
}
