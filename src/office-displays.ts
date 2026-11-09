import { POPULAR_WALL_CANVAS, wrapWallText, type PopularWallPost, type PopularWallState } from '../shared/office-displays';
export { formatSeoulTime, popularPostAtUv, POPULAR_WALL_CANVAS, type PopularWallPost, type PopularWallState } from '../shared/office-displays';

const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgecd', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd',
};
const SEGMENTS: Record<string, readonly (readonly [number, number])[]> = {
  a: [[17, 0], [95, 0], [103, 7], [95, 14], [17, 14], [9, 7]],
  b: [[105, 10], [112, 17], [112, 70], [105, 77], [98, 70], [98, 17]],
  c: [[105, 88], [112, 95], [112, 148], [105, 155], [98, 148], [98, 95]],
  d: [[17, 151], [95, 151], [103, 158], [95, 165], [17, 165], [9, 158]],
  e: [[7, 88], [14, 95], [14, 148], [7, 155], [0, 148], [0, 95]],
  f: [[7, 10], [14, 17], [14, 70], [7, 77], [0, 70], [0, 17]],
  g: [[17, 76], [95, 76], [103, 83], [95, 90], [17, 90], [9, 83]],
};

/** Redrawn once per second, never rasterized on every animation frame. */
export function paintSeoulClock(ctx: CanvasRenderingContext2D, time: string): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#09131c'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#728393'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, width - 4, height - 4);
  ctx.textAlign = 'center'; ctx.font = '600 21px sans-serif'; ctx.fillStyle = '#becad5';
  ctx.fillText('SEOUL  ·  KOREA STANDARD TIME  ·  UTC+9', width / 2, 36);
  let x = (width - 936) / 2;
  for (const char of time) {
    ctx.save(); ctx.translate(x, 65);
    if (char === ':') {
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#dceeff'; ctx.shadowBlur = 12;
      for (const y of [48, 114]) ctx.fillRect(7, y, 12, 12);
      x += 48;
    } else {
      const active = DIGIT_SEGMENTS[char] ?? '';
      for (const [segment, vertices] of Object.entries(SEGMENTS)) {
        const lit = active.includes(segment);
        ctx.fillStyle = lit ? '#ffffff' : '#172633'; ctx.shadowColor = '#dceeff'; ctx.shadowBlur = lit ? 12 : 0;
        ctx.beginPath(); vertices.forEach(([px, py], index) => index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath(); ctx.fill();
      }
      x += 140;
    }
    ctx.restore();
  }
}

function singleLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  return wrapWallText(text.replace(/\s+/g, ' '), maxWidth, 1, value => ctx.measureText(value).width).lines[0] ?? '';
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
}

export function paintPopularWall(ctx: CanvasRenderingContext2D, posts: readonly PopularWallPost[], state: PopularWallState): void {
  const layout = POPULAR_WALL_CANVAS;
  // A failed refresh must not leave a removed or moderated post visible on the wall.
  const visible = state === 'ready' ? posts.slice(0, 3) : [];
  ctx.save();
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = '#0b1827'; ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.strokeStyle = '#294253'; ctx.lineWidth = 2; ctx.strokeRect(14, 14, layout.width - 28, layout.height - 28);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f0f7ff'; ctx.font = '700 78px "Malgun Gothic",sans-serif'; ctx.fillText('인기글 TOP 3', 70, 114);
  ctx.fillStyle = '#9bb5c9'; ctx.font = '33px "Malgun Gothic",sans-serif'; ctx.fillText('포듬 커뮤니티  ·  최근 7일 추천순  ·  본문 미리보기', 74, 178);
  ctx.textAlign = 'right'; ctx.fillStyle = '#74d5ce'; ctx.font = '600 27px sans-serif'; ctx.fillText('PODEUM / COMMUNITY', layout.width - 74, 113); ctx.textAlign = 'left';
  ctx.fillStyle = '#61c8c2'; ctx.fillRect(74, 207, 112, 4);
  for (let index = 0; index < 3; index++) {
    const post = visible[index], top = layout.cardTop + index * (layout.cardHeight + layout.cardGap), left = layout.cardLeft, right = left + layout.cardWidth;
    ctx.fillStyle = post ? '#142a3f' : '#102233'; roundedRect(ctx, left, top, layout.cardWidth, layout.cardHeight, 20);
    ctx.strokeStyle = post ? '#2b485d' : '#213a4c'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = post ? '#224a53' : '#1b3444'; roundedRect(ctx, left + 28, top + 24, 70, 52, 12);
    ctx.fillStyle = post ? '#8be3d9' : '#527889'; ctx.font = '700 32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(index + 1).padStart(2, '0'), left + 63, top + 62); ctx.textAlign = 'left';
    if (!post) {
      const title = state === 'loading' ? '인기글을 불러오는 중이에요' : state === 'error' ? '인기글에 연결하지 못했어요' : '다음 이야기를 기다리고 있어요';
      const description = state === 'loading' ? '잠시 후 커뮤니티의 이야기가 이곳에 표시됩니다.' : state === 'error' ? '커뮤니티에서 최신 글을 확인해 주세요.' : '새로운 글이 올라오면 이 자리에 소개됩니다.';
      ctx.fillStyle = '#8ca8ba'; ctx.font = '600 46px "Malgun Gothic",sans-serif'; ctx.fillText(title, left + 40, top + 180);
      ctx.fillStyle = '#66869d'; ctx.font = '36px "Malgun Gothic",sans-serif'; ctx.fillText(description, left + 40, top + 249);
      ctx.textAlign = 'right'; ctx.fillStyle = '#719d9f'; ctx.font = '30px "Malgun Gothic",sans-serif'; ctx.fillText('눌러서 커뮤니티로 이동 ↗', right - 36, top + 402); ctx.textAlign = 'left';
      continue;
    }
    ctx.fillStyle = '#eff7ff'; ctx.font = '700 50px "Malgun Gothic",sans-serif'; ctx.fillText(singleLine(ctx, post.title, layout.cardWidth - 164), left + 124, top + 60);
    ctx.fillStyle = '#c8dbe9'; ctx.font = '54px "Malgun Gothic",sans-serif';
    const body = wrapWallText(post.body, layout.cardWidth - 80, layout.bodyLines, text => ctx.measureText(text).width);
    const bodyLines = body.lines.length ? body.lines : ['본문이 없습니다.'];
    bodyLines.forEach((line, lineIndex) => ctx.fillText(line, left + 40, top + 125 + lineIndex * 58));
    ctx.strokeStyle = '#2a465a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left + 40, top + 376); ctx.lineTo(right - 40, top + 376); ctx.stroke();
    const count = (value: number) => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)).toLocaleString('ko-KR');
    ctx.fillStyle = '#8caabe'; ctx.font = '27px "Malgun Gothic",sans-serif';
    ctx.fillText(singleLine(ctx, `${post.author}   ·   추천 ${count(post.likes)}   ·   댓글 ${count(post.comments)}`, 1120), left + 40, top + 410);
    ctx.textAlign = 'right'; ctx.fillStyle = '#81d9d1'; ctx.font = '600 29px "Malgun Gothic",sans-serif'; ctx.fillText('눌러서 전체 글 보기 ↗', right - 38, top + 410); ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#7594aa'; ctx.font = '29px "Malgun Gothic",sans-serif'; ctx.fillText('서로 존중하는 투자 이야기  ·  최근 글이 없으면 이전 글을 소개합니다.', 74, 1624);
  ctx.restore();
}
