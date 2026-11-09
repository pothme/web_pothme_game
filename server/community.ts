import { GameError, validateNickname } from './domain';
import { COMMUNITY_LIMITS, type CommunityPostSummary, type CommunityPost, type CommunityTop, type CommunityComment, type CommunityAdminState } from '../shared/community';

interface PostRow extends Record<string, SqlStorageValue> { id: string; author_id: string; nickname: string; title: string; body: string; created_at: number; hidden: number; deleted_at: number | null; like_count: number; comment_count: number; request_id: string; signature: string }
interface CommentRow extends Record<string, SqlStorageValue> { id: string; post_id: string; author_id: string; nickname: string; body: string; created_at: number; hidden: number; deleted_at: number | null; request_id: string; signature: string }
interface ReportRow extends Record<string, SqlStorageValue> { id: string; reporter_id: string; target_type: 'post' | 'comment'; target_id: string; post_id: string; reason: string; created_at: number; resolved_at: number | null }
const DAY = 86_400_000;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
function errorResponse(error: unknown) { return error instanceof GameError ? json({ ok: false, code: error.code, message: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) }, error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'RATE_LIMIT' ? 429 : 400) : json({ ok: false, code: 'SERVER_ERROR', message: '커뮤니티에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' }, 500); }
function id(value: unknown): string { if (typeof value !== 'string' || !ID.test(value)) throw new GameError('INVALID', '게시글이나 댓글을 다시 선택해 주세요.'); return value; }
function text(value: unknown, max: number, label: string, multiline = false): string {
  if (typeof value !== 'string' || value.length > max * 4) throw new GameError('TEXT_LENGTH', `${label}은 1~${max}자로 입력해 주세요.`);
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n');
  const cleaned = normalized.replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
  const result = multiline ? cleaned : cleaned.replace(/\s+/g, ' ');
  if (![...result].length || [...result].length > max) throw new GameError('TEXT_LENGTH', `${label}은 1~${max}자로 입력해 주세요.`);
  return result;
}
function page(value: string | null): number { const number = Number(value ?? '1'); if (!Number.isInteger(number) || number < 1 || number > 5000) throw new GameError('PAGE', '페이지 번호를 확인해 주세요.'); return number; }
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json') || Number(request.headers.get('Content-Length') ?? 0) > 12_000 || !request.body) throw new GameError('INVALID', '요청 내용을 확인해 주세요.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.byteLength; if (bytes > 12_000) { await reader.cancel(); throw new GameError('INVALID', '요청 내용이 너무 길어요.'); } chunks.push(result.value); } } finally { reader.releaseLock(); }
  const all = new Uint8Array(bytes); let at = 0; for (const chunk of chunks) { all.set(chunk, at); at += chunk.byteLength; }
  try { const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(all)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new GameError('INVALID', '요청 내용을 확인해 주세요.'); }
}

/** Community lives in separate tables and never consumes one of the twenty room seats. */
export class Community {
  private sql: SqlStorage;
  private topCache: { expiresAt: number; posts: PostRow[] } | null = null;
  constructor(private storage: DurableObjectStorage, private changed: () => void) {
    this.sql = storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS community_posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, nickname TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, like_count INTEGER NOT NULL DEFAULT 0, comment_count INTEGER NOT NULL DEFAULT 0, request_id TEXT NOT NULL, signature TEXT NOT NULL, UNIQUE(author_id,request_id))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS community_posts_recent ON community_posts(created_at DESC,id DESC)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS community_posts_visible_recent ON community_posts(created_at DESC,id DESC) WHERE hidden=0 AND deleted_at IS NULL');
    this.sql.exec('CREATE TABLE IF NOT EXISTS community_comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, author_id TEXT NOT NULL, nickname TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, request_id TEXT NOT NULL, signature TEXT NOT NULL, UNIQUE(author_id,request_id))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS community_comments_post ON community_comments(post_id,created_at,id)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS community_comments_hidden ON community_comments(created_at DESC,id DESC) WHERE hidden=1 AND deleted_at IS NULL');
    this.sql.exec('CREATE TABLE IF NOT EXISTS community_likes (post_id TEXT NOT NULL, author_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(post_id,author_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS community_reports (id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, post_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER, UNIQUE(reporter_id,target_type,target_id))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS community_reports_open ON community_reports(resolved_at,created_at DESC)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS community_rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL)');
  }
  private post(postId: string, visible = true): PostRow { const row = this.sql.exec<PostRow>('SELECT * FROM community_posts WHERE id=?', postId).toArray()[0]; if (!row || visible && (row.hidden || row.deleted_at !== null)) throw new GameError('NOT_FOUND', '글이 없거나 삭제·숨김 처리되었어요.'); return row; }
  private comment(commentId: string, visible = true): CommentRow { const row = this.sql.exec<CommentRow>('SELECT * FROM community_comments WHERE id=?', commentId).toArray()[0]; if (!row || visible && (row.hidden || row.deleted_at !== null)) throw new GameError('NOT_FOUND', '댓글이 없거나 삭제·숨김 처리되었어요.'); return row; }
  private summary(row: PostRow, viewer: string | null, likedIds?: Set<string>): CommunityPostSummary { return { id: row.id, title: row.title, excerpt: [...row.body].slice(0, 140).join(''), nickname: row.nickname, createdAt: row.created_at, likeCount: row.like_count, commentCount: row.comment_count, isMine: row.author_id === viewer, liked: !!viewer && (likedIds ? likedIds.has(row.id) : this.sql.exec('SELECT 1 FROM community_likes WHERE post_id=? AND author_id=?', row.id, viewer).toArray().length > 0) }; }
  private summaries(rows: PostRow[], viewer: string | null): CommunityPostSummary[] {
    const likedIds = new Set<string>();
    if (viewer && rows.length) for (const row of this.sql.exec<{ post_id: string }>(`SELECT post_id FROM community_likes WHERE author_id=? AND post_id IN (${rows.map(() => '?').join(',')})`, viewer, ...rows.map(row => row.id)).toArray()) likedIds.add(row.post_id);
    return rows.map(row => this.summary(row, viewer, likedIds));
  }
  private full(row: PostRow, viewer: string | null): CommunityPost { return { ...this.summary(row, viewer), body: row.body }; }
  private commentView(row: CommentRow, viewer: string | null): CommunityComment { return { id: row.id, body: row.body, nickname: row.nickname, createdAt: row.created_at, isMine: row.author_id === viewer }; }
  private limit(key: string, maximum: number, duration: number): void {
    const now = Date.now(), row = this.sql.exec<{ count: number; until_at: number }>('SELECT count,until_at FROM community_rate WHERE key=?', key).toArray()[0];
    if (row && row.until_at > now && row.count >= maximum) throw new GameError('RATE_LIMIT', '조금만 천천히 이용해 주세요. 잠시 후 다시 시도할 수 있어요.', row.until_at);
    const count = row && row.until_at > now ? row.count + 1 : 1, until = row && row.until_at > now ? row.until_at : now + duration;
    this.sql.exec('INSERT INTO community_rate(key,count,until_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,until_at=excluded.until_at', key, count, until);
  }
  private limits(actor: string, address: string, action: string): void {
    if (action === 'post') { this.limit(`post:${actor}`, 1, 60_000); this.limit(`post-day:${actor}`, 30, DAY); this.limit(`post-ip:${address}`, 60, 3_600_000); }
    if (action === 'comment') { this.limit(`comment:${actor}`, 1, 10_000); this.limit(`comment-hour:${actor}`, 120, 3_600_000); this.limit(`comment-ip:${address}`, 600, 3_600_000); }
    if (action === 'like') { this.limit(`like:${actor}`, 60, 60_000); this.limit(`like-ip:${address}`, 600, 60_000); }
    if (action === 'report') { this.limit(`report:${actor}`, 10, 3_600_000); this.limit(`report-ip:${address}`, 60, 3_600_000); }
  }
  async route(request: Request, actor: string | null, address: string, isBlocked: () => boolean = () => false): Promise<Response> {
    try {
      const url = new URL(request.url), path = url.pathname;
      if (request.method === 'GET') {
        if (path === '/api/community/top') {
          const now = Date.now();
          if (!this.topCache || this.topCache.expiresAt <= now) {
            let rows = this.sql.exec<PostRow>('SELECT * FROM community_posts WHERE hidden=0 AND deleted_at IS NULL AND created_at>=? ORDER BY like_count DESC,comment_count DESC,created_at DESC,id DESC LIMIT 3', now - 7 * DAY).toArray();
            if (!rows.length) rows = this.sql.exec<PostRow>('SELECT * FROM community_posts WHERE hidden=0 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 3').toArray();
            this.topCache = { posts: rows, expiresAt: now + 60_000 };
          }
          // Only shared ranking rows are cached. Ownership and recommendation flags
          // are resolved for this browser, never shared between anonymous sessions.
          const rows = this.topCache.posts;
          const posts = this.summaries(rows, actor).map((post, index) => ({ ...post, body: rows[index]!.body }));
          return json({ ok: true, posts, popularWindowDays: 7, serverTime: now } satisfies CommunityTop);
        }
        if (path === '/api/community/posts') {
          const current = page(url.searchParams.get('page')), sort = url.searchParams.get('sort') ?? 'latest';
          if (!['latest', 'popular'].includes(sort)) throw new GameError('INVALID', '최신글 또는 인기글을 선택해 주세요.');
          const rows = sort === 'popular' ? this.sql.exec<PostRow>('SELECT * FROM community_posts WHERE hidden=0 AND deleted_at IS NULL AND created_at>=? ORDER BY like_count DESC,comment_count DESC,created_at DESC,id DESC LIMIT 21 OFFSET ?', Date.now() - 7 * DAY, (current - 1) * 20).toArray() : this.sql.exec<PostRow>('SELECT * FROM community_posts WHERE hidden=0 AND deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?', (current - 1) * 20).toArray();
          return json({ ok: true, posts: this.summaries(rows.slice(0, 20), actor), page: current, hasMore: rows.length > 20, popularWindowDays: 7, serverTime: Date.now() });
        }
        const match = path.match(/^\/api\/community\/posts\/([^/]+)$/);
        if (match) {
          const row = this.post(id(match[1])), current = page(url.searchParams.get('commentPage'));
          const comments = this.sql.exec<CommentRow>('SELECT * FROM community_comments WHERE post_id=? AND hidden=0 AND deleted_at IS NULL ORDER BY created_at,id LIMIT 51 OFFSET ?', row.id, (current - 1) * 50).toArray();
          return json({ ok: true, post: this.full(row, actor), comments: comments.slice(0, 50).map(comment => this.commentView(comment, actor)), commentPage: current, hasMoreComments: comments.length > 50, serverTime: Date.now() });
        }
        return json({ ok: false, code: 'NOT_FOUND', message: '요청 경로를 확인해 주세요.' }, 404);
      }
      if (request.method !== 'POST' || path !== '/api/community') return json({ ok: false, code: 'METHOD', message: '요청 방식을 확인해 주세요.' }, 405);
      if (!actor) return json({ ok: false, code: 'SESSION', message: '브라우저 연결을 확인한 뒤 다시 시도해 주세요.' }, 401);
      if (isBlocked()) return json({ ok: false, code: 'BLOCKED', message: '관리자가 이용을 일시 제한했어요.' }, 403);
      // Count malformed attempts too. Cloudflare supplies the original client IP;
      // the Worker hashes it before forwarding, and only hashes are persisted.
      this.storage.transactionSync(() => { this.sql.exec('DELETE FROM community_rate WHERE until_at<=?', Date.now()); this.limit('global-write', 600, 60_000); this.limit(`write-ip:${address}`, 180, 60_000); });
      const input = await body(request);
      if (isBlocked()) return json({ ok: false, code: 'BLOCKED', message: '관리자가 이용을 일시 제한했어요.' }, 403);
      let changed = false;
      const result = this.storage.transactionSync(() => {
        const action = input.action, now = Date.now();
        if (action === 'post' || action === 'comment') {
          if (input.rulesAccepted !== true) throw new GameError('RULES', '기본 이용 규칙을 확인해 주세요.');
          const requestId = id(input.requestId), nickname = validateNickname(input.nickname), content = text(input.body, action === 'post' ? COMMUNITY_LIMITS.post : COMMUNITY_LIMITS.comment, action === 'post' ? '본문' : '댓글', true);
          if (action === 'post') {
            const title = text(input.title, COMMUNITY_LIMITS.title, '제목'), signature = JSON.stringify([nickname, title, content]);
            const previous = this.sql.exec<PostRow>('SELECT * FROM community_posts WHERE author_id=? AND request_id=?', actor, requestId).toArray()[0];
            if (previous) { if (previous.signature !== signature) throw new GameError('REQUEST_REUSED', '이미 사용한 요청 내용은 바꿀 수 없어요.'); return { ok: true, postId: previous.id }; }
            this.limits(actor, address, action);
            const postId = crypto.randomUUID(); this.sql.exec('INSERT INTO community_posts(id,author_id,nickname,title,body,created_at,request_id,signature) VALUES(?,?,?,?,?,?,?,?)', postId, actor, nickname, title, content, now, requestId, signature); changed = true;
            return { ok: true, postId, post: this.full(this.post(postId), actor) };
          }
          const post = this.post(id(input.postId)), signature = JSON.stringify([post.id, nickname, content]);
          const previous = this.sql.exec<CommentRow>('SELECT * FROM community_comments WHERE author_id=? AND request_id=?', actor, requestId).toArray()[0];
          if (previous) { if (previous.signature !== signature) throw new GameError('REQUEST_REUSED', '이미 사용한 요청 내용은 바꿀 수 없어요.'); return { ok: true, postId: post.id, comment: this.commentView(previous, actor) }; }
          this.limits(actor, address, action);
          const commentId = crypto.randomUUID(); this.sql.exec('INSERT INTO community_comments(id,post_id,author_id,nickname,body,created_at,request_id,signature) VALUES(?,?,?,?,?,?,?,?)', commentId, post.id, actor, nickname, content, now, requestId, signature); this.sql.exec('UPDATE community_posts SET comment_count=comment_count+1 WHERE id=?', post.id); changed = true;
          return { ok: true, postId: post.id, comment: this.commentView(this.comment(commentId), actor) };
        }
        if (action === 'like') {
          const post = this.post(id(input.postId)); if (typeof input.liked !== 'boolean') throw new GameError('INVALID', '추천 상태를 확인해 주세요.');
          if (post.author_id === actor && input.liked) throw new GameError('SELF_LIKE', '자신의 글에는 추천할 수 없어요.');
          const exists = !!this.sql.exec('SELECT 1 FROM community_likes WHERE post_id=? AND author_id=?', post.id, actor).toArray().length;
          if (exists !== input.liked) { this.limits(actor, address, action); if (input.liked) this.sql.exec('INSERT INTO community_likes(post_id,author_id,created_at) VALUES(?,?,?)', post.id, actor, now); else this.sql.exec('DELETE FROM community_likes WHERE post_id=? AND author_id=?', post.id, actor); this.sql.exec('UPDATE community_posts SET like_count=MAX(0,like_count+?) WHERE id=?', input.liked ? 1 : -1, post.id); changed = true; }
          return { ok: true, postId: post.id, liked: input.liked, post: this.full(this.post(post.id), actor) };
        }
        if (action === 'delete-post') { const post = this.post(id(input.postId), false); if (post.author_id !== actor) throw new GameError('FORBIDDEN', '본인이 작성한 글만 삭제할 수 있어요.'); if (post.deleted_at === null) { this.sql.exec('UPDATE community_posts SET deleted_at=? WHERE id=?', now, post.id); changed = true; } return { ok: true, postId: post.id }; }
        if (action === 'delete-comment') { const comment = this.comment(id(input.commentId), false); if (comment.author_id !== actor) throw new GameError('FORBIDDEN', '본인이 작성한 댓글만 삭제할 수 있어요.'); if (comment.deleted_at === null) { this.sql.exec('UPDATE community_comments SET deleted_at=? WHERE id=?', now, comment.id); if (!comment.hidden) this.sql.exec('UPDATE community_posts SET comment_count=MAX(0,comment_count-1) WHERE id=?', comment.post_id); changed = true; } return { ok: true, postId: comment.post_id }; }
        if (action === 'report') {
          const targetType = input.commentId ? 'comment' : 'post', targetId = id(input.commentId ?? input.postId), comment = targetType === 'comment' ? this.comment(targetId) : null, post = this.post(comment ? comment.post_id : targetId);
          const reason = text(input.reason, 200, '신고 사유');
          if (!this.sql.exec('SELECT 1 FROM community_reports WHERE reporter_id=? AND target_type=? AND target_id=?', actor, targetType, targetId).toArray().length) { this.limits(actor, address, action); this.sql.exec('INSERT INTO community_reports(id,reporter_id,target_type,target_id,post_id,reason,created_at) VALUES(?,?,?,?,?,?,?)', crypto.randomUUID(), actor, targetType, targetId, post.id, reason, now); }
          return { ok: true, postId: post.id };
        }
        throw new GameError('INVALID', '지원하지 않는 요청이에요.');
      });
      if (changed) { this.topCache = null; this.changed(); }
      return json(result);
    } catch (error) { return errorResponse(error); }
  }
  adminState(request: Request): Response {
    try {
      const url = new URL(request.url), current = page(url.searchParams.get('page')), status = url.searchParams.get('status') ?? 'reported';
      if (!['reported', 'all'].includes(status)) throw new GameError('INVALID', '조회 상태를 확인해 주세요.');
      const posts = this.sql.exec<PostRow>(`SELECT * FROM community_posts ${status === 'reported' ? 'WHERE EXISTS(SELECT 1 FROM community_reports WHERE community_reports.post_id=community_posts.id AND resolved_at IS NULL)' : ''} ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?`, (current - 1) * 30).toArray();
      const reports = this.sql.exec<ReportRow>('SELECT * FROM community_reports WHERE resolved_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?', status === 'reported' ? (current - 1) * 50 : 0).toArray();
      // Hidden comments remain recoverable after their reports are resolved.
      // Author-deleted comments/posts stay out of the restore queue permanently.
      const hiddenComments = status === 'all' ? this.sql.exec<CommentRow & { title: string; post_hidden: number }>('SELECT c.*,p.title,p.hidden AS post_hidden FROM community_comments c JOIN community_posts p ON p.id=c.post_id WHERE c.hidden=1 AND c.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY c.created_at DESC,c.id DESC LIMIT 31 OFFSET ?', (current - 1) * 30).toArray() : [];
      const state: CommunityAdminState = { ok: true, posts: posts.slice(0, 30).map(row => ({ id: row.id, title: row.title, nickname: row.nickname, createdAt: row.created_at, likeCount: row.like_count, commentCount: row.comment_count, hidden: !!row.hidden, deleted: row.deleted_at !== null })), reports: reports.slice(0, 50).flatMap(row => {
        try { const post = this.post(row.post_id, false), target = row.target_type === 'post' ? post : this.comment(row.target_id, false); return [{ id: row.id, targetType: row.target_type, targetId: row.target_id, postId: row.post_id, title: post.title, nickname: target.nickname, text: target.body, reason: row.reason, createdAt: row.created_at, hidden: !!target.hidden, deleted: target.deleted_at !== null }]; } catch { return []; }
      }), hiddenComments: hiddenComments.slice(0, 30).map(row => ({ id: row.id, postId: row.post_id, title: row.title, nickname: row.nickname, body: row.body, createdAt: row.created_at, postHidden: !!row.post_hidden })), page: current, hasMore: status === 'reported' ? reports.length > 50 : posts.length > 30 || hiddenComments.length > 30, pendingReports: this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM community_reports WHERE resolved_at IS NULL').toArray()[0]!.count };
      return json(state);
    } catch (error) { return errorResponse(error); }
  }
  /** Caller wraps this with the operation audit in one transaction after admin reauthorization. */
  moderate(input: Record<string, unknown>): string {
    if (input.action === 'community-report-dismiss') { const reportId = id(input.reportId); if (!this.sql.exec('SELECT 1 FROM community_reports WHERE id=?', reportId).toArray().length) throw new GameError('NOT_FOUND', '신고를 찾지 못했어요.'); this.sql.exec('UPDATE community_reports SET resolved_at=? WHERE id=?', Date.now(), reportId); return '커뮤니티 신고 확인 완료'; }
    if (!['community-hide', 'community-restore'].includes(String(input.action)) || !['post', 'comment'].includes(String(input.targetType))) throw new GameError('INVALID', '관리 대상을 확인해 주세요.');
    this.topCache = null;
    const targetId = id(input.id), hidden = input.action === 'community-hide' ? 1 : 0;
    if (input.targetType === 'post') { const target = this.post(targetId, false); this.sql.exec('UPDATE community_posts SET hidden=? WHERE id=?', hidden, target.id); }
    else { const target = this.comment(targetId, false); if (target.hidden !== hidden && target.deleted_at === null) this.sql.exec('UPDATE community_posts SET comment_count=MAX(0,comment_count+?) WHERE id=?', hidden ? -1 : 1, target.post_id); this.sql.exec('UPDATE community_comments SET hidden=? WHERE id=?', hidden, target.id); }
    if (hidden) this.sql.exec('UPDATE community_reports SET resolved_at=? WHERE target_type=? AND target_id=? AND resolved_at IS NULL', Date.now(), input.targetType as string, targetId);
    return `커뮤니티 ${input.targetType === 'post' ? '글' : '댓글'} ${hidden ? '숨김' : '복원'} · ${targetId.slice(0, 8)}`;
  }
}
