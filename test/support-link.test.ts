import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OFFICE_SETTINGS } from '../shared/office-settings';
import { DONATION_SETUP_VERSION, PODEUM_SUPPORT_URL, initializeSupportDonation, normalizeKakaoPayUrl } from '../shared/support-link';

test('support links preserve the exact user code and only allow official HTTPS transfer hosts', () => {
  assert.equal(normalizeKakaoPayUrl(` ${PODEUM_SUPPORT_URL} `), PODEUM_SUPPORT_URL);
  assert.equal(normalizeKakaoPayUrl('https://link.kakaopay.com/transfer/example?token=test'), 'https://link.kakaopay.com/transfer/example?token=test');
  for (const value of ['', null, undefined, 42, 'javascript:alert(1)', 'http://qr.kakaopay.com/FK1lkXwy0', 'https://qr.kakaopay.com.evil.invalid/x', 'https://user:pass@qr.kakaopay.com/x', 'https://qr.kakaopay.com:8443/x', 'https://open.kakao.com/x', `https://qr.kakaopay.com/${'x'.repeat(1000)}`]) {
    assert.equal(normalizeKakaoPayUrl(value), '');
  }
});

test('support initialization is one-time and preserves current or future operator choices', () => {
  const settings = { ...DEFAULT_OFFICE_SETTINGS, notice: '운영 공지', interval: '5' as const, chatEnabled: false };
  assert.deepEqual(initializeSupportDonation(settings, undefined), { version: DONATION_SETUP_VERSION, changed: true, settings: { ...settings, donationUrl: PODEUM_SUPPORT_URL } });
  const custom = { ...settings, donationUrl: 'https://link.kakaopay.com/owner-current' };
  assert.equal(initializeSupportDonation(custom, undefined).settings, custom);
  assert.equal(initializeSupportDonation(settings, DONATION_SETUP_VERSION).settings, settings, 'an explicit empty value remains disabled after setup');
  assert.equal(initializeSupportDonation(custom, 2).settings, custom);
  assert.equal(initializeSupportDonation(settings, 2).version, 2);
  assert.equal(initializeSupportDonation(settings, 2).changed, false);
});
