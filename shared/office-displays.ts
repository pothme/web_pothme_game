export interface PopularWallPost { id: string; title: string; body: string; author: string; likes: number; comments: number }
export type PopularWallState = 'ready' | 'loading' | 'error';

const seoulFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Explicit timezone and hour cycle keep midnight correct on any visitor device. */
export function formatSeoulTime(timestamp: number): string {
  const parts = seoulFormatter.formatToParts(timestamp);
  return ['hour', 'minute', 'second'].map(type => parts.find(part => part.type === type)!.value).join(':');
}

/** Matches the 28 × 24 wall board; dimensions stay below mobile GPU texture limits. */
export const POPULAR_WALL_CANVAS = Object.freeze({ width: 1960, height: 1680, cardTop: 232, cardHeight: 432, cardGap: 18, cardLeft: 64, cardWidth: 1832, bodyLines: 5 });

const graphemeSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
function graphemes(value: string): string[] { return graphemeSegmenter ? [...graphemeSegmenter.segment(value)].map(part => part.segment) : Array.from(value); }

/** Preserve paragraphs and graphemes while fitting a bounded, measured plain-text preview. */
export function wrapWallText(value: string, maxWidth: number, maxLines: number, measure: (text: string) => number): { lines: string[]; truncated: boolean } {
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ').trim();
  const limit = Math.floor(maxLines);
  if (!text) return { lines: [], truncated: false };
  if (!Number.isFinite(maxWidth) || maxWidth <= 0 || !Number.isFinite(limit) || limit < 1 || measure('…') > maxWidth) return { lines: [], truncated: true };
  const lines: string[] = [];
  let truncated = false;
  outer: for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of graphemes(paragraph)) {
      if (measure(line + char) <= maxWidth) { line += char; continue; }
      if (!line) { truncated = true; break outer; }
      lines.push(line.trimEnd());
      if (lines.length >= limit) { truncated = true; break outer; }
      line = /^\s+$/.test(char) ? '' : char;
      if (line && measure(line) > maxWidth) { truncated = true; break outer; }
    }
    if (lines.length >= limit) { truncated = true; break; }
    lines.push(line.trimEnd());
  }
  if (truncated) {
    if (!lines.length) lines.push('');
    const last = graphemes(lines[lines.length - 1].trimEnd());
    while (last.length && measure(`${last.join('')}…`) > maxWidth) last.pop();
    lines[lines.length - 1] = `${last.join('')}…`;
  }
  return { lines, truncated };
}

/** Three.js UVs start at the bottom; blank cards never open an invented post. */
export function popularPostAtUv(posts: readonly PopularWallPost[], u: number, v: number): string | null {
  const layout = POPULAR_WALL_CANVAS, x = u * layout.width, y = (1 - v) * layout.height;
  const boundaryTolerance = 1e-7; // UV round trips can land a fraction of a pixel inside an excluded edge.
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1 || x < layout.cardLeft || x >= layout.cardLeft + layout.cardWidth - boundaryTolerance) return null;
  const row = Math.floor((y - layout.cardTop) / (layout.cardHeight + layout.cardGap));
  if (row < 0 || row > 2 || y >= layout.cardTop + row * (layout.cardHeight + layout.cardGap) + layout.cardHeight - boundaryTolerance) return null;
  return posts[row]?.id ?? null;
}
