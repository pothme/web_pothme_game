import test from 'node:test';
import assert from 'node:assert/strict';
import { measureMobileViewport } from '../shared/mobile-viewport';

test('Android overlay keyboard aligns all controls to the same visible bottom', () => {
  assert.deepEqual(measureMobileViewport({ layoutHeight: 740, visualHeight: 390, visualTop: 20 }), { height: 390, top: 20, bottom: 330, short: true });
});
test('resized content, rotation and dismissed keyboard leave no stale bottom inset', () => {
  for (const height of [390, 360, 740]) {
    const result = measureMobileViewport({ layoutHeight: height, visualHeight: height, visualTop: 0 });
    assert.equal(result.bottom, 0); assert.equal(result.height, height);
    assert.equal(result.short, height <= 500);
  }
});
test('pinch zoom retains the layout instead of shrinking controls a second time', () => {
  assert.deepEqual(measureMobileViewport({ layoutHeight: 740, visualHeight: 370, visualTop: 100, scale: 2 }), { height: 740, top: 0, bottom: 0, short: false });
});
test('viewport transitions tolerate missing, oversized and non-finite measurements', () => {
  assert.deepEqual(measureMobileViewport({ layoutHeight: 740 }), { height: 740, top: 0, bottom: 0, short: false });
  assert.equal(measureMobileViewport({ layoutHeight: 360, visualHeight: 740, visualTop: 300 }).top, 0);
  assert.deepEqual(measureMobileViewport({ layoutHeight: 740, visualHeight: NaN, visualTop: Infinity }), { height: 740, top: 0, bottom: 0, short: false });
});
