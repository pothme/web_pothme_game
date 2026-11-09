import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSeoulTime, popularPostAtUv, POPULAR_WALL_CANVAS, wrapWallText, type PopularWallPost } from '../shared/office-displays';

test('Seoul LED clock crosses midnight at UTC 15:00 and never uses 24:00', () => {
  for (const [utc, expected] of [
    ['2026-11-05T00:01:02Z', '09:01:02'], ['2026-11-05T14:59:59Z', '23:59:59'],
    ['2026-11-05T15:00:00Z', '00:00:00'], ['2026-12-31T15:00:01Z', '00:00:01'],
    ['2026-07-01T00:00:00Z', '09:00:00'],
  ]) assert.equal(formatSeoulTime(Date.parse(utc)), expected);
});

test('wall click targets correspond to real rows and ignore headers, gaps and absent posts', () => {
  const posts: PopularWallPost[] = ['one', 'two', 'three'].map(id => ({ id, title: id, body: '본문\n두 번째 줄', author: 'tester', likes: 1, comments: 0 }));
  const layout = POPULAR_WALL_CANVAS;
  const hit = (x: number, y: number, source = posts) => popularPostAtUv(source, x / layout.width, 1 - y / layout.height);
  for (let row = 0; row < 3; row++) {
    const top = layout.cardTop + row * (layout.cardHeight + layout.cardGap);
    assert.equal(hit(500, top + 30), posts[row].id);
    assert.equal(hit(500, top + layout.cardHeight + 10), null);
    assert.equal(hit(10, top + 30), null);
  }
  assert.equal(hit(500, 100), null);
  assert.equal(hit(500, layout.height - 60), null);
  assert.equal(hit(500, layout.cardTop + 20, []), null);
  assert.equal(hit(500, layout.cardTop + 2 * (layout.cardHeight + layout.cardGap) + 20, posts.slice(0, 1)), null);
  assert.equal(popularPostAtUv(posts, NaN, Infinity), null);
  assert.equal(popularPostAtUv(posts, 1.01, .5), null);
  assert.equal(popularPostAtUv(posts, .5, -.01), null);
  assert.equal(hit(layout.cardLeft + layout.cardWidth, layout.cardTop + 20), null);
  assert.equal(hit(500, layout.cardTop + layout.cardHeight), null);
});

const graphemeCount = (text: string) => [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)].length;

test('wall previews preserve paragraphs and normalize line endings without interpreting markup', () => {
  assert.deepEqual(wrapWallText('첫 줄\r\n\r\n둘째 줄\r셋째 줄', 20, 5, graphemeCount), { lines: ['첫 줄', '', '둘째 줄', '셋째 줄'], truncated: false });
  assert.deepEqual(wrapWallText('<img src=x> & 안녕', 100, 5, graphemeCount), { lines: ['<img src=x> & 안녕'], truncated: false });
  assert.deepEqual(wrapWallText(' \n\t ', 20, 5, graphemeCount), { lines: [], truncated: false });
});

test('long bodies fit the line budget and visibly truncate instead of losing remaining paragraphs silently', () => {
  const preview = wrapWallText('가나다라마바사아자차카타파하', 4, 3, graphemeCount);
  assert.deepEqual(preview, { lines: ['가나다라', '마바사아', '자차카…'], truncated: true });
  assert.ok(preview.lines.every(line => graphemeCount(line) <= 4));
  assert.deepEqual(wrapWallText('1\n2\n3\n4\n5\n6', 8, 5, graphemeCount), { lines: ['1', '2', '3', '4', '5…'], truncated: true });
  assert.deepEqual(wrapWallText('1\n2\n3\n4\n5', 8, 5, graphemeCount), { lines: ['1', '2', '3', '4', '5'], truncated: false });
});

test('wrapping keeps emoji families, flags and combining characters intact', () => {
  const result = wrapWallText('👨‍👩‍👧‍👦🇰🇷e\u0301가나', 2, 3, graphemeCount);
  assert.deepEqual(result, { lines: ['👨‍👩‍👧‍👦🇰🇷', 'é가', '나'], truncated: false });
  assert.deepEqual(wrapWallText('글자', 0, 5, graphemeCount), { lines: [], truncated: true });
  assert.deepEqual(wrapWallText('가나다', 1, 1, graphemeCount), { lines: ['…'], truncated: true });
});

test('five-line body cards and their click areas fit the 28 by 24 mobile-safe texture', () => {
  const layout = POPULAR_WALL_CANVAS;
  assert.equal(layout.width / layout.height, 28 / 24);
  assert.ok(layout.width <= 2048 && layout.height <= 2048);
  assert.ok(layout.cardTop + 3 * layout.cardHeight + 2 * layout.cardGap < layout.height);
  assert.equal(layout.bodyLines, 5);
});
