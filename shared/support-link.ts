import type { OfficeSettings } from './office-settings';

/** Owner-provided public transfer link; app handoff is completed on the phone. */
export const PODEUM_SUPPORT_URL = 'https://qr.kakaopay.com/FK1lkXwy0';
export const DONATION_SETUP_VERSION = 1;

export function normalizeKakaoPayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1000) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !['qr.kakaopay.com', 'link.kakaopay.com'].includes(url.hostname) || url.username || url.password || url.port) return '';
    return url.href;
  } catch { return ''; }
}

/** Initialize once. A later empty setting means the owner disabled support. */
export function initializeSupportDonation(settings: OfficeSettings, previousVersion: unknown) {
  if (typeof previousVersion === 'number' && Number.isFinite(previousVersion) && previousVersion >= DONATION_SETUP_VERSION) {
    return { settings, version: previousVersion, changed: false };
  }
  return {
    settings: settings.donationUrl.trim() ? settings : { ...settings, donationUrl: PODEUM_SUPPORT_URL },
    version: DONATION_SETUP_VERSION,
    changed: true,
  };
}
