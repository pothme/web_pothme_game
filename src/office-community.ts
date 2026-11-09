import type { CommunityTop } from '../shared/community';
import type { PopularWallPost, PopularWallState } from '../shared/office-displays';

/** Visible-only reads; socket invalidations are coalesced and never poll per frame. */
export function connectOfficeCommunity(options: {
  show(posts: PopularWallPost[], state: PopularWallState): void;
  time(serverTime: number): void;
}) {
  const fallbackMs = 300_000;
  let disposed = false, busy = false, loaded = false, lastRead = 0;
  let invalidated = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  options.show([], 'loading');
  async function refresh() {
    if (disposed || document.hidden || busy) return;
    busy = true; invalidated = false; lastRead = Date.now();
    try {
      const response = await fetch('/api/community/top', { credentials: 'same-origin', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error('Popular posts unavailable');
      const data = await response.json() as CommunityTop;
      if (disposed) return;
      if (!Array.isArray(data.posts)) throw new Error('Invalid popular posts');
      options.show(data.posts.slice(0, 3).map(post => ({ id: post.id, title: post.title, body: typeof post.body === 'string' ? post.body : typeof post.excerpt === 'string' ? post.excerpt : '', author: post.nickname, likes: post.likeCount, comments: post.commentCount })), 'ready');
      if (Number.isFinite(data.serverTime)) options.time(data.serverTime);
      loaded = true;
    } catch { if (!disposed) options.show([], 'error'); }
    finally { busy = false; if (invalidated) invalidate(); }
  }
  function invalidate() {
    invalidated = true;
    if (timer !== undefined || disposed) return;
    timer = setTimeout(() => { timer = undefined; void refresh(); }, Math.max(2000, lastRead + 5000 - Date.now()));
  }
  function visible() { if (!document.hidden && (!loaded || invalidated || Date.now() - lastRead >= fallbackMs)) void refresh(); }
  document.addEventListener('visibilitychange', visible);
  const interval = setInterval(() => { if (Date.now() - lastRead >= fallbackMs) void refresh(); }, fallbackMs);
  void refresh();
  return { invalidate, dispose() { disposed = true; abort.abort(); clearInterval(interval); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); } };
}
