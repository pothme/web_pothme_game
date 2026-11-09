import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Miniflare } from 'miniflare';
import { createHarness } from './harness.mjs';
import { identity, join, login, admin, manage, origin, type Message } from './office-helpers';

const postInput = (patch: Message = {}) => ({ action: 'post', requestId: crypto.randomUUID(), nickname: '시세동료', title: '오늘의 시장 이야기', body: '서로의 생각을 나눠요.', rulesAccepted: true, ...patch });
const commentInput = (postId: string, patch: Message = {}) => ({ action: 'comment', requestId: crypto.randomUUID(), nickname: '댓글동료', postId, body: '좋은 의견 감사합니다.', rulesAccepted: true, ...patch });
function write(mf: Miniflare, cookie: string, body: Message, extra: Record<string, string> = {}) { return mf.dispatchFetch(`${origin}/api/community`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) }); }
async function read(mf: Miniflare, path = 'posts', cookie = '') { const response = await mf.dispatchFetch(`${origin}/api/community/${path}`, { headers: { Cookie: cookie } }); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<Message>; }
async function create(mf: Miniflare, cookie: string, input: Message = postInput()) { const response = await write(mf, cookie, input); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<Message>; }
async function adminCommunity(mf: Miniflare, cookie: string, status = 'all') { const response = await admin(mf, `community?status=${status}`, undefined, cookie); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<Message>; }

test('community uses browser identity, validates bounded plain text and accepts no forged owner or cross-site mutations', { timeout: 30000 }, async () => {
 const { mf } = await createHarness(); try {
  assert.equal((await read(mf, 'top')).posts.length, 0, 'new rooms never get fabricated posts');
  const cookie = await identity(mf), other = await identity(mf);
  assert.equal((await write(mf, '', postInput(), { 'X-Podeumgo-Player': 'a'.repeat(64) })).status, 401);
  assert.equal((await write(mf, cookie, postInput(), { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await write(mf, cookie, postInput(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  for (const patch of [{ title: '가'.repeat(61) }, { body: '가'.repeat(2001) }, { nickname: '한' }, { nickname: '가'.repeat(13) }, { requestId: 'invalid' }, { rulesAccepted: false }]) assert.equal((await write(mf, cookie, postInput(patch))).status, 400);
  const excessive = await mf.dispatchFetch(`${origin}/api/community`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: ' '.repeat(12_001) }); assert.equal(excessive.status, 400);
  const payload = postInput({ title: '  <img src=x onerror=alert(1)>  ', body: '<script>alert(1)</script>\r\n다음 줄' });
  const created = await create(mf, cookie, payload), detail = await read(mf, `posts/${created.postId}`, cookie);
  assert.equal(detail.post.title, payload.title.trim()); assert.equal(detail.post.body, '<script>alert(1)</script>\n다음 줄'); assert.equal(detail.post.isMine, true);
  const publicDetail = await read(mf, `posts/${created.postId}`, other); assert.equal(publicDetail.post.isMine, false);
  const encoded = JSON.stringify(publicDetail); for (const secret of ['author_id', 'signature', 'request_id', cookie.split('=')[1]!, 'reporter_id']) assert.equal(encoded.includes(secret), false);
  assert.equal((await write(mf, other, { action: 'delete-post', postId: created.postId }, { 'X-Podeumgo-Player': created.post.author_id ?? 'a'.repeat(64) })).status, 403);
  assert.equal((await mf.dispatchFetch(`${origin}/api/community/posts?page=0`)).status, 400);
 } finally { await mf.dispose(); }
});

test('post/comment retries and concurrent recommendations are idempotent, with ownership separate from nicknames', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const author = await identity(mf), reader = await identity(mf), input = postInput(), saved = await create(mf, author, input);
  const retries = await Promise.all(Array.from({ length: 5 }, () => write(mf, author, input).then(r => r.json()) as Promise<Message>)); assert.ok(retries.every(r => r.postId === saved.postId)); assert.equal((await read(mf)).posts.length, 1);
  assert.equal((await write(mf, author, { ...input, body: '바뀐 본문' })).status, 400);
  assert.equal((await write(mf, author, { action: 'like', postId: saved.postId, liked: true })).status, 400);
  const votes = await Promise.all(Array.from({ length: 8 }, () => write(mf, reader, { action: 'like', postId: saved.postId, liked: true })));
  assert.ok(votes.every(r => r.status === 200)); assert.equal((await read(mf, `posts/${saved.postId}`, reader)).post.likeCount, 1); assert.equal((await read(mf, `posts/${saved.postId}`, reader)).post.liked, true);
  const commentPayload = commentInput(saved.postId, { nickname: input.nickname }), comment = await create(mf, reader, commentPayload);
  await create(mf, reader, commentPayload); const detail = await read(mf, `posts/${saved.postId}`, author); assert.equal(detail.post.commentCount, 1); assert.equal(detail.comments.length, 1); assert.equal(detail.comments[0].isMine, false);
  assert.equal((await write(mf, author, { action: 'delete-comment', commentId: comment.comment.id })).status, 403);
  assert.equal((await write(mf, reader, { action: 'delete-post', postId: saved.postId })).status, 403);
  for (let i = 0; i < 2; i++) assert.equal((await write(mf, reader, { action: 'delete-comment', commentId: comment.comment.id })).status, 200);
  await write(mf, reader, { action: 'like', postId: saved.postId, liked: false }); await write(mf, reader, { action: 'like', postId: saved.postId, liked: false });
  const empty = await read(mf, `posts/${saved.postId}`); assert.equal(empty.post.commentCount, 0); assert.equal(empty.post.likeCount, 0); assert.equal(empty.comments.length, 0);
  const status = await room.testSnapshot(); assert.equal(status.players.length, 0); assert.equal(status.accounts.length, 0, 'community readers never occupy an office seat');
  assert.equal((await write(mf, author, { action: 'delete-post', postId: saved.postId })).status, 200); assert.equal((await mf.dispatchFetch(`${origin}/api/community/posts/${saved.postId}`)).status, 404); assert.equal((await read(mf, 'top')).posts.length, 0);
 } finally { await mf.dispose(); }
});

test('community enforces identity cooldowns and shared address limits even after cookie rotation', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const cookie = await identity(mf), saved = await create(mf, cookie);
  const limited = await write(mf, cookie, postInput()); assert.equal(limited.status, 429); const retry = await limited.json() as Message; assert.equal(typeof retry.retryAt, 'number');
  await create(mf, cookie, commentInput(saved.postId)); assert.equal((await write(mf, cookie, commentInput(saved.postId))).status, 429);
  await room.testClock(retry.retryAt + 1, false); assert.equal((await write(mf, cookie, postInput())).status, 200);
  // Invalid requests still consume the address-level limit; changing browser tokens cannot bypass it.
  let blocked = 0;
  for (let i = 0; i < 181; i++) { const response = await write(mf, `podeumgo_session=${i.toString(16).padStart(64, '0')}`, { action: 'invalid' }, { 'CF-Connecting-IP': '192.0.2.9', 'X-Podeumgo-Address': `forged-${i}` }); if (response.status === 429) blocked++; else assert.equal(response.status, 400); }
  assert.equal(blocked, 1);
  assert.equal((await write(mf, cookie, { action: 'invalid' }, { 'CF-Connecting-IP': '192.0.2.10' })).status, 400, 'an unrelated address keeps its own budget');
 } finally { await mf.dispose(); }
});

test('popular list and wall top three use recent recommendations then visible comments, and paginate', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const a = await identity(mf), b = await identity(mf), c = await identity(mf), d = await identity(mf), voter = await identity(mf);
  const first = await create(mf, a, postInput({ title: '첫 번째' })), second = await create(mf, b, postInput({ title: '두 번째' })), third = await create(mf, c, postInput({ title: '세 번째' })), fourth = await create(mf, d, postInput({ title: '네 번째' }));
  for (const postId of [first.postId, second.postId, third.postId]) await write(mf, voter, { action: 'like', postId, liked: true });
  await write(mf, d, { action: 'like', postId: first.postId, liked: true }); await create(mf, voter, commentInput(second.postId));
  const top = await read(mf, 'top'); assert.deepEqual(top.posts.map((p: Message) => p.id), [first.postId, second.postId, third.postId]); assert.equal(top.popularWindowDays, 7); assert.ok(top.serverTime > 0);
  assert.deepEqual((await read(mf, 'posts?sort=popular')).posts.map((p: Message) => p.id), [first.postId, second.postId, third.postId, fourth.postId]);
  const current = (await mf.dispatchFetch(`${origin}/api/status`).then(r => r.json()) as Message).serverTime;
  await room.testClock(current + 8 * 86_400_000, false);
  assert.equal((await read(mf, 'posts?sort=popular')).posts.length, 0); assert.equal((await read(mf, 'top')).posts.length, 3, 'with no recent post the wall uses real older posts');
  const fresh = await create(mf, voter, postInput({ title: '이번 주 새 글' })); assert.deepEqual((await read(mf, 'top')).posts.map((p: Message) => p.id), [fresh.postId]);
  for (let i = 0; i < 17; i++) await create(mf, await identity(mf), postInput({ title: `추가 게시글 ${i}` }));
  const pageOne = await read(mf), pageTwo = await read(mf, 'posts?page=2'); assert.equal(pageOne.posts.length, 20); assert.equal(pageOne.hasMore, true); assert.equal(pageTwo.posts.length, 2); assert.equal(pageTwo.hasMore, false); assert.equal(new Set([...pageOne.posts, ...pageTwo.posts].map((p: Message) => p.id)).size, 22);
 } finally { await mf.dispose(); }
});

test('reports and moderation require current admin session/CSRF and hide content without restoring user deletions', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const author = await identity(mf), reporter = await identity(mf), saved = await create(mf, author), comment = await create(mf, reporter, commentInput(saved.postId)), auth = await login(mf);
  for (let i = 0; i < 2; i++) assert.equal((await write(mf, reporter, { action: 'report', postId: saved.postId, reason: '확인해 주세요' })).status, 200);
  await write(mf, author, { action: 'report', commentId: comment.comment.id, reason: '댓글 확인 요청' });
  assert.equal((await admin(mf, 'community')).status, 401); const reported = await adminCommunity(mf, auth.cookie, 'reported'); assert.equal(reported.pendingReports, 2); assert.equal(reported.reports.length, 2); assert.equal(reported.posts.length, 1);
  assert.equal(JSON.stringify(reported).includes('reporter_id'), false);
  const hideComment = { action: 'community-hide', targetType: 'comment', id: comment.comment.id };
  assert.equal((await admin(mf, 'manage', hideComment)).status, 401); assert.equal((await admin(mf, 'manage', hideComment, auth.cookie)).status, 403); assert.equal((await manage(mf, auth, hideComment)).status, 200);
  let detail = await read(mf, `posts/${saved.postId}`); assert.equal(detail.comments.length, 0); assert.equal(detail.post.commentCount, 0); assert.equal((await adminCommunity(mf, auth.cookie)).pendingReports, 1);
  const hidden = await adminCommunity(mf, auth.cookie); assert.deepEqual(hidden.hiddenComments.map((row: Message) => row.id), [comment.comment.id]); assert.equal(hidden.hiddenComments[0].title, saved.post.title); assert.equal(hidden.hiddenComments[0].postHidden, false); assert.equal(hidden.reports.some((row: Message) => row.targetId === comment.comment.id), false, 'resolved comment report is gone but the restore queue keeps its target');
  await manage(mf, auth, { ...hideComment, action: 'community-restore' }); detail = await read(mf, `posts/${saved.postId}`); assert.equal(detail.comments.length, 1); assert.equal(detail.post.commentCount, 1);
  assert.equal((await adminCommunity(mf, auth.cookie)).hiddenComments.length, 0);
  await manage(mf, auth, { action: 'community-hide', targetType: 'post', id: saved.postId }); assert.equal((await mf.dispatchFetch(`${origin}/api/community/posts/${saved.postId}`)).status, 404); assert.equal((await read(mf, 'top')).posts.length, 0); assert.equal((await adminCommunity(mf, auth.cookie)).pendingReports, 0);
  await write(mf, author, { action: 'delete-post', postId: saved.postId }); await manage(mf, auth, { action: 'community-restore', targetType: 'post', id: saved.postId }); assert.equal((await mf.dispatchFetch(`${origin}/api/community/posts/${saved.postId}`)).status, 404, 'moderator cannot resurrect an author deletion');
  const audit = JSON.stringify((await room.testSnapshot()).runtime.audit); assert.equal(audit.includes('서로의 생각'), false); assert.equal(audit.includes('확인해 주세요'), false);
  await admin(mf, 'logout', {}, auth.cookie, auth.csrf); assert.equal((await manage(mf, auth, hideComment)).status, 401); assert.equal((await admin(mf, 'community', undefined, auth.cookie)).status, 401);
 } finally { await mf.dispose(); }
});

test('community survives Worker restart, remains available with closed or full offices, and broadcasts visible changes', { timeout: 30000 }, async () => {
 const { mf, room, restart } = await createHarness(); try {
  const auth = await login(mf), author = await identity(mf), reader = await identity(mf), occupant = await join(mf, author, '작성동료'), saved = await create(mf, author);
  await occupant.wait(m => m.type === 'community-changed'); await write(mf, reader, { action: 'like', postId: saved.postId, liked: true }); await occupant.wait(m => m.type === 'community-changed');
  for (let i = 0; i < 19; i++) await join(mf, await identity(mf), `입장동료${i}`);
  assert.equal((await room.testSnapshot()).players.length, 20); await create(mf, reader, commentInput(saved.postId));
  const overflow = await create(mf, await identity(mf), postInput({ title: '사무실 바깥에서도 작성' })); assert.ok(overflow.postId); assert.equal((await room.testSnapshot()).players.length, 20);
  await admin(mf, 'control', { action: 'close' }, auth.cookie, auth.csrf); await restart();
  const detail = await read(mf, `posts/${saved.postId}`, reader); assert.equal(detail.post.likeCount, 1); assert.equal(detail.post.liked, true); assert.equal(detail.comments.length, 1); assert.equal((await read(mf, `posts/${saved.postId}`, author)).post.isMine, true);
  await create(mf, await identity(mf), postInput({ title: '문 닫은 뒤에도 작성' })); const snapshot = await room.testSnapshot(); assert.equal(snapshot.runtime.roomOpen, false); assert.equal(snapshot.players.length, 0); assert.equal(snapshot.alarmAt, null);
 } finally { await mf.dispose(); }
});

test('an active browser block prevents community writes while preserving read access', { timeout: 30000 }, async () => {
 const { mf } = await createHarness(); try {
  const cookie = await identity(mf), author = await join(mf, cookie, '제한대상'), auth = await login(mf), saved = await create(mf, cookie);
  await manage(mf, auth, { action: 'block', id: author.welcome.me.id, minutes: 60 });
  assert.equal((await write(mf, cookie, commentInput(saved.postId, { nickname: '다른별명' }))).status, 403); assert.equal((await read(mf)).posts.length, 1);
 } finally { await mf.dispose(); }
});

test('cached wall rankings keep ownership private and report pages include every pending report exactly once', { timeout: 30000 }, async () => {
 const { mf } = await createHarness(); try {
  const author = await identity(mf), reader = await identity(mf), saved = await create(mf, author), auth = await login(mf);
  assert.equal((await read(mf, 'top', author)).posts[0].isMine, true);
  assert.equal((await read(mf, 'top', reader)).posts[0].isMine, false);
  await write(mf, reader, { action: 'like', postId: saved.postId, liked: true });
  assert.equal((await read(mf, 'top', reader)).posts[0].liked, true);
  const ownerView = (await read(mf, 'top', author)).posts[0]; assert.equal(ownerView.liked, false); assert.equal(ownerView.likeCount, 1, 'recommendation invalidates cached ranking immediately');
  for (let i = 0; i < 51; i++) assert.equal((await write(mf, await identity(mf), { action: 'report', postId: saved.postId, reason: `신고 사유 ${i}` })).status, 200);
  const first = await adminCommunity(mf, auth.cookie, 'reported'), second = await admin(mf, 'community?status=reported&page=2', undefined, auth.cookie).then(r => r.json()) as Message;
  assert.equal(first.pendingReports, 51); assert.equal(first.reports.length, 50); assert.equal(first.hasMore, true); assert.equal(second.reports.length, 1); assert.equal(second.hasMore, false); assert.equal(second.page, 2);
  assert.equal(new Set([...first.reports, ...second.reports].map((r: Message) => r.id)).size, 51);
  assert.equal((await manage(mf, auth, { action: 'community-report-dismiss', reportId: second.reports[0].id })).status, 200); const resolved = await adminCommunity(mf, auth.cookie, 'reported'); assert.equal(resolved.pendingReports, 50); assert.equal(resolved.hasMore, false);
  await manage(mf, auth, { action: 'community-hide', targetType: 'post', id: saved.postId }); assert.equal((await read(mf, 'top', author)).posts.length, 0, 'moderation invalidates the wall cache too');
 } finally { await mf.dispose(); }
});

test('hidden comment recovery paginates independently and never offers author-deleted content for restoration', { timeout: 30000 }, async () => {
 const { mf } = await createHarness(); try {
  const author = await identity(mf), saved = await create(mf, author), auth = await login(mf), comments: { id: string; cookie: string }[] = [];
  for (let i = 0; i < 31; i++) {
   const cookie = await identity(mf), created = await create(mf, cookie, commentInput(saved.postId, { body: `숨김 댓글 ${i}` })); comments.push({ id: created.comment.id, cookie });
   assert.equal((await manage(mf, auth, { action: 'community-hide', targetType: 'comment', id: created.comment.id })).status, 200);
  }
  const first = await adminCommunity(mf, auth.cookie), second = await admin(mf, 'community?status=all&page=2', undefined, auth.cookie).then(r => r.json()) as Message;
  assert.equal(first.posts.length, 1); assert.equal(first.hiddenComments.length, 30); assert.equal(first.hasMore, true); assert.equal(second.posts.length, 0); assert.equal(second.hiddenComments.length, 1); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.hiddenComments, ...second.hiddenComments].map((row: Message) => row.id)).size, 31);
  await manage(mf, auth, { action: 'community-hide', targetType: 'post', id: saved.postId }); assert.equal((await adminCommunity(mf, auth.cookie)).hiddenComments.every((row: Message) => row.postHidden), true);
  await write(mf, comments[0]!.cookie, { action: 'delete-comment', commentId: comments[0]!.id }); const reduced = await adminCommunity(mf, auth.cookie); assert.equal(reduced.hiddenComments.length, 30); assert.equal(reduced.hasMore, false); assert.equal(reduced.hiddenComments.some((row: Message) => row.id === comments[0]!.id), false);
  await write(mf, author, { action: 'delete-post', postId: saved.postId }); assert.equal((await adminCommunity(mf, auth.cookie)).hiddenComments.length, 0, 'deleted parent posts cannot become visible again');
 } finally { await mf.dispose(); }
});

test('wall top posts include complete public Unicode bodies while lists stay summaries and moderation clears cached bodies', { timeout: 30000 }, async () => {
 const { mf, room } = await createHarness(); try {
  const author = await identity(mf), reader = await identity(mf);
  const body = '📈'.repeat(800) + '\n\n' + '한'.repeat(1198); assert.equal([...body].length, 2000);
  const created = await create(mf, author, postInput({ title: '긴 본문이 있는 인기글', body }));
  const ownerTop = await read(mf, 'top', author); assert.equal(ownerTop.posts[0].body, body); assert.equal(ownerTop.posts[0].excerpt, '📈'.repeat(140)); assert.equal(ownerTop.posts[0].isMine, true);
  for (const path of ['posts', 'posts?sort=popular']) { const list = await read(mf, path, author); assert.equal(Object.hasOwn(list.posts[0], 'body'), false); assert.equal([...list.posts[0].excerpt].length, 140); }
  await write(mf, reader, { action: 'like', postId: created.postId, liked: true });
  const readerTop = (await read(mf, 'top', reader)).posts[0]; assert.equal(readerTop.body, body); assert.equal(readerTop.isMine, false); assert.equal(readerTop.liked, true);
  const cachedOwner = (await read(mf, 'top', author)).posts[0]; assert.equal(cachedOwner.isMine, true); assert.equal(cachedOwner.liked, false);
  const publicPost = (await read(mf, 'top')).posts[0]; assert.equal(publicPost.body, body); assert.equal(publicPost.isMine, false); assert.equal(publicPost.liked, false);
  assert.deepEqual(Object.keys(publicPost).sort(), ['id', 'title', 'excerpt', 'nickname', 'createdAt', 'likeCount', 'commentCount', 'isMine', 'liked', 'body'].sort());
  const serialized = JSON.stringify(publicPost); for (const privateValue of ['author_id', 'request_id', 'signature', author.split('=')[1]!, reader.split('=')[1]!]) assert.equal(serialized.includes(privateValue), false);
  await room.testClock(ownerTop.serverTime + 8 * 86_400_000, false);
  assert.equal((await read(mf, 'top')).posts[0].body, body, 'older real-post fallback includes the same full text');
  // Start an administrator session after advancing the fixture clock.
  const freshAuth = await login(mf);
  assert.equal((await manage(mf, freshAuth, { action: 'community-hide', targetType: 'post', id: created.postId })).status, 200);
  assert.deepEqual((await read(mf, 'top', author)).posts, [], 'hidden bodies are removed immediately, before the 60-second cache expires');
  await manage(mf, freshAuth, { action: 'community-restore', targetType: 'post', id: created.postId }); assert.equal((await read(mf, 'top')).posts[0].body, body);
  await write(mf, author, { action: 'delete-post', postId: created.postId }); assert.deepEqual((await read(mf, 'top')).posts, [], 'author deletion also invalidates cached full text');
 } finally { await mf.dispose(); }
});
