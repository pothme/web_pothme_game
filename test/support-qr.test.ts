import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { createSupportQr } from '../src/support-qr';
import { PODEUM_SUPPORT_URL } from '../shared/support-link';

test('support QR decodes to the exact case-sensitive user-provided payment link', async () => {
  const dataUrl = await createSupportQr(PODEUM_SUPPORT_URL);
  assert.ok(dataUrl.startsWith('data:image/png;base64,'));
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, 'https://qr.kakaopay.com/FK1lkXwy0');
  assert.deepEqual([...png.data.subarray(0,4)], [255,255,255,255], 'opaque white quiet zone survives dark mode');
  assert.equal(await createSupportQr(PODEUM_SUPPORT_URL), dataUrl, 'reuse the generated image');
});

test('QR helper rejects unsafe origins and follows an updated operator URL', async () => {
  for (const url of ['javascript:alert(1)', 'https://qr.kakaopay.com.evil.test/FK1lkXwy0', 'http://qr.kakaopay.com/FK1lkXwy0', '']) {
    await assert.rejects(createSupportQr(url));
  }
  const changed = 'https://qr.kakaopay.com/local-test-only';
  const dataUrl = await createSupportQr(changed);
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, changed);
});
