import './community-ui.css';
import { COMMUNITY_LIMITS, COMMUNITY_RULES as RULES, type CommunityPost as Post, type CommunityList as ListPayload, type CommunityDetail as DetailPayload } from '../shared/community';
interface MutationPayload { ok: boolean; postId?: string; liked?: boolean }
type Action = { action: 'report' | 'delete-post' | 'delete-comment'; postId: string; commentId?: string };
class CommunityError extends Error { constructor(text: string, readonly status: number) { super(text); } }

const NICKNAME_KEY = 'podeumgo.nickname';
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
}
function button(text: string, className = 'pc-button'): HTMLButtonElement {
  const result = element('button', className, text); result.type = 'button'; return result;
}
function length(value: string): number { return [...value].length; }
function storedNickname(): string { try { return localStorage.getItem(NICKNAME_KEY) ?? ''; } catch { return ''; } }
function rememberNickname(value: string) { try { localStorage.setItem(NICKNAME_KEY, value); } catch { /* Preference is optional. */ } }
function formattedDate(value: number): string {
  return new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
}
function postUrl(id: string): string {
  const url = new URL(location.href); url.pathname = '/markets'; url.searchParams.set('view', 'community'); url.searchParams.set('post', id); url.hash = ''; return `${url.pathname}${url.search}`;
}
function message(error: unknown): string { return error instanceof Error ? error.message : '연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'; }

/** A public, cookie-owned board. It never opens a room connection or reserves a seat. */
export function initCommunity(host: HTMLElement): { setActive(active: boolean): void; dispose(): void } {
  host.classList.add('pc-community');
  host.innerHTML = `
    <header class="pc-intro"><div><span class="pm-eyebrow">PODEUM COMMUNITY</span><h1>시장을 읽는<br class="pc-mobile-break"> 우리의 이야기.</h1><p>궁금한 종목부터 오늘의 생각까지, 편하게 나눠요.</p></div><button class="pc-primary" type="button" id="pc-compose">＋ 글쓰기</button></header>
    <p class="pc-announcement" role="status" id="pc-announcement" hidden></p>
    <div class="pc-layout"><section class="pc-board" aria-label="커뮤니티 게시글">
      <header class="pc-board-header"><div class="pc-sort" role="group" aria-label="게시글 정렬"><button type="button" data-pc-sort="latest" aria-pressed="true">최신글</button><button type="button" data-pc-sort="popular" aria-pressed="false">인기글 <span>TOP</span></button></div><button type="button" class="pc-refresh" id="pc-refresh" aria-label="게시글 새로고침">↻ <span>새로고침</span></button></header>
      <p class="pc-sort-note" id="pc-sort-note">가장 최근에 올라온 이야기부터 보여드려요.</p>
      <p class="pc-list-status" id="pc-list-status" role="status"></p><div id="pc-post-list" class="pc-post-list"></div>
      <nav class="pc-pagination" aria-label="게시글 페이지"><button type="button" class="pc-button" id="pc-prev">← 이전</button><span id="pc-page" aria-live="polite">1 페이지</span><button type="button" class="pc-button" id="pc-next">다음 →</button></nav>
    </section><aside class="pc-aside"><section class="pc-wall-note"><span class="pm-eyebrow">OFFICE SPOTLIGHT</span><h2>좋은 이야기는<br>사무실에서도 함께.</h2><p>인기글 3개가 포듬증권<br>차트 오른쪽 벽에 소개됩니다.</p><a href="/">증권 사무실 가기 ↗</a></section>
      <details class="pc-rules" open><summary>함께 지키는 기본 규칙 <span aria-hidden="true">⌄</span></summary><ul id="pc-rules-list"></ul><p>규칙 위반 글·댓글은 신고할 수 있고, 운영자가 숨김 처리할 수 있습니다.</p><small>닉네임은 실명·본인 인증 정보가 아닙니다. 내가 쓴 글의 삭제 권한은 이 브라우저의 쿠키로 확인합니다.</small></details>
    </aside></div>`;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  RULES.forEach(rule => get('pc-rules-list').append(element('li', '', rule)));
  if (matchMedia('(max-width: 680px)').matches) host.querySelector('details')!.open = false;

  const compose = element('dialog', 'pc-dialog pc-compose-dialog');
  compose.setAttribute('aria-labelledby', 'pc-compose-title');
  compose.innerHTML = `<header class="pc-dialog-header"><div><span class="pm-eyebrow">NEW STORY</span><h2 id="pc-compose-title">새 이야기 쓰기</h2></div><button type="button" class="pc-close" aria-label="글쓰기 닫기">×</button></header>
    <form id="pc-compose-form" class="pc-form"><label>닉네임 <input name="nickname" autocomplete="nickname" minlength="2" maxlength="24" required placeholder="2~12자"></label>
    <p class="pc-field-hint">인증된 계정이 아닌, 공개 표시 이름입니다.</p><label>제목 <input name="title" maxlength="120" required placeholder="함께 나누고 싶은 이야기는 무엇인가요?"></label><div class="pc-counter" id="pc-title-count">0 / 60</div>
    <label>내용 <textarea name="body" rows="9" maxlength="4000" required placeholder="종목에 대한 생각이나 질문을 적어 주세요. 개인정보는 적지 마세요."></textarea></label><div class="pc-counter" id="pc-body-count">0 / 2,000</div>
    <div class="pc-form-rules"><strong>함께 지키는 기본 규칙</strong><ul></ul></div><label class="pc-consent"><input name="rules" type="checkbox" required><span>기본 규칙을 읽었으며, 이 글이 공개됨을 확인했습니다.</span></label>
    <p class="pc-form-status" role="status"></p><footer class="pc-form-footer"><span>글은 1분에 한 번 등록할 수 있어요.</span><button type="submit" class="pc-primary">글 등록하기</button></footer></form>`;
  RULES.forEach(rule => compose.querySelector('ul')!.append(element('li', '', rule)));
  const composeForm = compose.querySelector<HTMLFormElement>('form')!;
  const input = <T extends HTMLInputElement | HTMLTextAreaElement>(form: HTMLFormElement, name: string) => form.elements.namedItem(name) as T;
  const composeNickname = input<HTMLInputElement>(composeForm, 'nickname');
  const titleInput = input<HTMLInputElement>(composeForm, 'title');
  const bodyInput = input<HTMLTextAreaElement>(composeForm, 'body');
  const composeStatus = compose.querySelector<HTMLElement>('.pc-form-status')!;
  composeNickname.value = storedNickname();

  const detail = element('dialog', 'pc-dialog pc-detail-dialog'); detail.setAttribute('aria-labelledby', 'pc-detail-title');
  detail.innerHTML = `<header class="pc-dialog-header"><span class="pm-eyebrow">PODEUM COMMUNITY</span><button type="button" class="pc-close" aria-label="게시글 닫기">×</button></header>
    <div class="pc-detail-content"><div class="pc-detail-loading" role="status"></div><article class="pc-detail-article" hidden><h2 id="pc-detail-title"></h2><p class="pc-post-meta" id="pc-detail-meta"></p><div class="pc-post-body"></div><div class="pc-post-actions"></div></article>
    <p class="pc-detail-status pc-form-status" role="status"></p><section class="pc-comments" hidden aria-labelledby="pc-comments-title"><h3 id="pc-comments-title">댓글</h3><div class="pc-comment-list"></div><nav class="pc-comment-pages pc-pagination" aria-label="댓글 페이지"></nav>
      <form class="pc-form pc-comment-form"><label>닉네임 <input name="nickname" autocomplete="nickname" minlength="2" maxlength="24" required placeholder="2~12자"></label><label>댓글 <textarea name="body" rows="3" maxlength="600" required placeholder="서로 존중하는 댓글을 남겨 주세요."></textarea></label><div class="pc-counter">0 / 300</div><label class="pc-consent"><input name="rules" type="checkbox" required><span>욕설·도배·사기·개인정보 공개·수익 보장 금지에 동의합니다.</span></label><p class="pc-form-status" role="status"></p><footer class="pc-form-footer"><span>댓글은 10초에 한 번 등록할 수 있어요.</span><button type="submit" class="pc-primary">댓글 등록</button></footer></form>
    </section></div>`;
  const commentForm = detail.querySelector<HTMLFormElement>('form')!;
  const commentNickname = input<HTMLInputElement>(commentForm, 'nickname');
  const commentInput = input<HTMLTextAreaElement>(commentForm, 'body');
  const commentStatus = commentForm.querySelector<HTMLElement>('.pc-form-status')!;
  commentNickname.value = storedNickname();

  const actionDialog = element('dialog', 'pc-dialog pc-action-dialog'); actionDialog.setAttribute('aria-labelledby', 'pc-action-title');
  actionDialog.innerHTML = `<header class="pc-dialog-header"><h2 id="pc-action-title"></h2><button type="button" class="pc-close" aria-label="확인 창 닫기">×</button></header><form class="pc-form"><p class="pc-action-description"></p><label class="pc-report-reason">신고 사유<select name="category"><option>욕설·혐오·차별·괴롭힘</option><option>도배·광고</option><option>사기·불법 정보</option><option>개인정보 노출</option><option>수익 보장·투자 강요</option><option>기타 규칙 위반</option></select></label><label class="pc-report-detail">추가 설명 (선택)<textarea name="reason" rows="3" maxlength="160" placeholder="운영자가 확인할 내용을 적어 주세요."></textarea></label><p class="pc-form-status" role="status"></p><footer class="pc-form-footer"><button type="button" class="pc-button pc-action-cancel">취소</button><button type="submit" class="pc-primary"></button></footer></form>`;
  const actionForm = actionDialog.querySelector<HTMLFormElement>('form')!;
  document.body.append(compose, detail, actionDialog);

  let active = false, disposed = false, sort: 'latest' | 'popular' = 'latest', page = 1, hasMore = false;
  let listBusy = false, listVersion = 0, detailVersion = 0, mutationBusy = false, lastListAt = 0;
  let currentPost: Post | null = null, currentPostId = '', commentPage = 1, pendingAction: Action | null = null;
  let composeRequest: string = crypto.randomUUID(), commentRequest: string = crypto.randomUUID();
  let sessionPromise: Promise<void> | null = null;
  let suppressCloseHistory = false;
  const controllers = new Set<AbortController>();
  const drafts = new Map<string, { body: string; accepted: boolean; requestId: string }>();
  const announcement = get('pc-announcement');

  async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController(); controllers.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json() as T & { ok?: boolean; message?: string; retryAt?: number };
      if (!response.ok || data.ok === false) {
        const wait = typeof data.retryAt === 'number' ? Math.max(0, Math.ceil((data.retryAt - Date.now()) / 1000)) : 0;
        throw new CommunityError(`${data.message || '요청을 처리하지 못했습니다. 다시 시도해 주세요.'}${wait ? ` (${wait}초 후 다시 시도)` : ''}`, response.status);
      }
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('응답이 지연되고 있습니다. 작성한 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.');
      if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('서버에 연결하지 못했습니다. 작성한 내용은 유지됩니다. 연결을 확인하고 다시 시도해 주세요.');
      throw error;
    } finally { window.clearTimeout(timeout); controllers.delete(controller); }
  }
  async function ensureSession() {
    if (!sessionPromise) sessionPromise = request('/api/session').then(() => undefined).catch(error => { sessionPromise = null; throw error; });
    await sessionPromise;
  }
  function announce(text: string) { announcement.textContent = text; announcement.hidden = !text; }
  function setBusy(value: boolean) {
    mutationBusy = value;
    for (const dialog of [compose, detail, actionDialog]) {
      dialog.setAttribute('aria-busy', String(value));
      dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('button,input,textarea,select').forEach(control => {
        if (value) { control.dataset.pcWasDisabled = String(control.disabled); control.disabled = true; }
        else if (control.dataset.pcWasDisabled !== undefined) { control.disabled = control.dataset.pcWasDisabled === 'true'; delete control.dataset.pcWasDisabled; }
      });
    }
  }
  async function mutate(body: Record<string, unknown>): Promise<MutationPayload> { await ensureSession(); return request<MutationPayload>('/api/community', body); }
  function updatePagination() {
    get<HTMLButtonElement>('pc-prev').disabled = listBusy || page <= 1;
    get<HTMLButtonElement>('pc-next').disabled = listBusy || !hasMore;
    get<HTMLButtonElement>('pc-refresh').disabled = listBusy;
    get('pc-page').textContent = `${page} 페이지`;
    get('pc-post-list').setAttribute('aria-busy', String(listBusy));
  }
  async function loadList(quiet = false) {
    if (disposed || listBusy) return;
    const version = ++listVersion; listBusy = true; updatePagination();
    if (!quiet) get('pc-list-status').textContent = '이야기를 불러오는 중입니다…';
    try {
      await ensureSession();
      const value = await request<ListPayload>(`/api/community/posts?sort=${sort}&page=${page}`);
      if (disposed || version !== listVersion) return;
      if (!Array.isArray(value.posts)) throw new Error('게시글을 불러오지 못했습니다. 다시 시도해 주세요.');
      hasMore = value.hasMore; lastListAt = Date.now();
      const list = get('pc-post-list'); list.replaceChildren();
      for (const post of value.posts) {
        const row = element('article', 'pc-post-row');
        const title = element('a', 'pc-post-title', post.title); title.href = postUrl(post.id);
        title.addEventListener('click', event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); void openPost(post.id, true);
        });
        const meta = element('div', 'pc-post-meta');
        meta.append(element('span', 'pc-author', post.nickname), element('time', '', formattedDate(post.createdAt)));
        const counts = element('span', 'pc-post-counts');
        counts.append(element('span', post.liked ? 'pc-liked' : '', `추천 ${post.likeCount}`), element('span', '', `댓글 ${post.commentCount}`));
        meta.append(counts);
        row.append(title, element('p', 'pc-post-excerpt', post.excerpt), meta); list.append(row);
      }
      get('pc-list-status').textContent = value.posts.length ? '' : page > 1 ? '이 페이지에는 게시글이 없습니다. 이전 페이지를 확인해 주세요.' : '아직 이야기가 없어요. 첫 글을 남겨 주세요.';
    } catch (error) { if (!disposed && version === listVersion) get('pc-list-status').textContent = message(error); }
    finally { listBusy = false; if (!disposed) updatePagination(); }
  }
  function openModal(dialog: HTMLDialogElement, closeOtherRoots = false) {
    if (closeOtherRoots) document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => { if (other !== dialog) other.close(); });
    if (!dialog.open) dialog.showModal();
  }
  function saveCommentDraft() {
    if (currentPostId) drafts.set(currentPostId, { body: commentInput.value, accepted: input<HTMLInputElement>(commentForm, 'rules').checked, requestId: commentRequest });
  }
  function removePostParam() {
    const url = new URL(location.href); url.searchParams.delete('post'); history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  function closePost(fromHistory = false) {
    saveCommentDraft(); ++detailVersion;
    suppressCloseHistory = fromHistory;
    if (detail.open) detail.close();
    else suppressCloseHistory = false;
    if (actionDialog.open) actionDialog.close();
  }
  function detailStatus(text: string) { detail.querySelector<HTMLElement>('.pc-detail-status')!.textContent = text; }
  function actionButton(label: string, action: Action): HTMLButtonElement {
    const result = button(label, 'pc-text-button'); result.addEventListener('click', () => showAction(action)); return result;
  }
  function renderDetail(value: DetailPayload) {
    currentPost = value.post; commentPage = value.commentPage;
    const post = value.post;
    detail.querySelector<HTMLElement>('.pc-detail-article')!.hidden = false;
    detail.querySelector<HTMLElement>('.pc-comments')!.hidden = false;
    detail.querySelector<HTMLElement>('#pc-detail-title')!.textContent = post.title;
    detail.querySelector<HTMLElement>('#pc-detail-meta')!.textContent = `${post.nickname} · ${formattedDate(post.createdAt)} · 한국시간${post.isMine ? ' · 내가 쓴 글' : ''}`;
    detail.querySelector<HTMLElement>('.pc-post-body')!.textContent = post.body;
    const actions = detail.querySelector<HTMLElement>('.pc-post-actions')!; actions.replaceChildren();
    const like = button(`${post.liked ? '♥' : '♡'} 추천 ${post.likeCount}`, `pc-like${post.liked ? ' is-liked' : ''}`); like.setAttribute('aria-pressed', String(post.liked));
    like.disabled = post.isMine; if (post.isMine) like.title = '내 글에는 추천할 수 없습니다.';
    like.addEventListener('click', async () => {
      if (mutationBusy || !currentPost) return;
      const liked = !currentPost.liked; setBusy(true); detailStatus('추천을 반영하고 있습니다…');
      try {
        await mutate({ action: 'like', postId: post.id, liked });
        if (disposed) return;
        // Reload canonical counts; never infer a server-approved count from local clicks.
        await refreshDetail(); detailStatus(liked ? '이 글을 추천했습니다.' : '추천을 취소했습니다.'); void loadList(true);
      } catch (error) { if (!disposed) detailStatus(message(error)); }
      finally { if (!disposed) setBusy(false); }
    });
    actions.append(like, actionButton('신고', { action: 'report', postId: post.id }));
    if (post.isMine) actions.append(actionButton('내 글 삭제', { action: 'delete-post', postId: post.id }));
    const reload = button('새로고침', 'pc-text-button'); reload.addEventListener('click', () => { void refreshDetail(); }); actions.append(reload);
    detail.querySelector<HTMLElement>('#pc-comments-title')!.textContent = `댓글 ${post.commentCount}`;
    const list = detail.querySelector<HTMLElement>('.pc-comment-list')!; list.replaceChildren();
    if (!value.comments.length) list.append(element('p', 'pc-no-comments', '첫 댓글로 이야기를 이어 가세요.'));
    for (const comment of value.comments) {
      const row = element('article', 'pc-comment');
      const meta = element('div', 'pc-post-meta'); meta.append(element('strong', '', comment.nickname), element('time', '', formattedDate(comment.createdAt)));
      if (comment.isMine) meta.append(element('span', 'pc-own-tag', '내 댓글'));
      const controls = element('div', 'pc-comment-controls');
      controls.append(actionButton('신고', { action: 'report', postId: post.id, commentId: comment.id }));
      if (comment.isMine) controls.append(actionButton('삭제', { action: 'delete-comment', postId: post.id, commentId: comment.id }));
      row.append(meta, element('p', 'pc-comment-body', comment.body), controls); list.append(row);
    }
    const pagination = detail.querySelector<HTMLElement>('.pc-comment-pages')!; pagination.replaceChildren(); pagination.hidden = commentPage === 1 && !value.hasMoreComments;
    const prev = button('← 이전'), next = button('다음 →'); prev.disabled = commentPage <= 1; next.disabled = !value.hasMoreComments;
    prev.addEventListener('click', () => { void refreshDetail(Math.max(1, commentPage - 1)); }); next.addEventListener('click', () => { void refreshDetail(commentPage + 1); });
    pagination.append(prev, element('span', '', `${commentPage} 페이지`), next);
    if (mutationBusy) {
      // New controls created by a refresh still obey the in-flight write lock.
      for (const container of [actions, list, pagination]) container.querySelectorAll<HTMLButtonElement>('button').forEach(control => { control.dataset.pcWasDisabled = String(control.disabled); control.disabled = true; });
    }
  }
  async function refreshDetail(pageNumber = commentPage): Promise<void> {
    if (!currentPostId || disposed) return;
    const version = ++detailVersion, id = currentPostId;
    const loading = detail.querySelector<HTMLElement>('.pc-detail-loading')!; loading.textContent = '게시글을 불러오는 중입니다…';
    try {
      await ensureSession();
      const value = await request<DetailPayload>(`/api/community/posts/${encodeURIComponent(id)}?commentPage=${pageNumber}`);
      if (disposed || version !== detailVersion || !detail.open) return;
      if (!value.post || !Array.isArray(value.comments)) throw new Error('게시글을 불러오지 못했습니다.');
      renderDetail(value); loading.textContent = '';
    } catch (error) {
      if (!disposed && version === detailVersion) {
        if (error instanceof CommunityError && error.status === 404) {
          currentPost = null; detail.querySelector<HTMLElement>('.pc-detail-article')!.hidden = true; detail.querySelector<HTMLElement>('.pc-comments')!.hidden = true;
        }
        loading.replaceChildren(element('span', '', message(error)));
        const retry = button('다시 불러오기'); retry.addEventListener('click', () => { void refreshDetail(pageNumber); }); loading.append(retry);
      }
    }
  }
  async function openPost(id: string, updateUrl: boolean) {
    if (disposed || mutationBusy) return;
    if (currentPostId !== id) {
      saveCommentDraft(); currentPostId = id; currentPost = null; commentPage = 1;
      const draft = drafts.get(id); commentInput.value = draft?.body ?? ''; input<HTMLInputElement>(commentForm, 'rules').checked = draft?.accepted ?? false; commentRequest = draft?.requestId ?? crypto.randomUUID();
      commentForm.querySelector<HTMLElement>('.pc-counter')!.textContent = `${length(commentInput.value)} / 300`;
      detail.querySelector<HTMLElement>('.pc-detail-article')!.hidden = true; detail.querySelector<HTMLElement>('.pc-comments')!.hidden = true;
      commentStatus.textContent = ''; detailStatus('');
    }
    if (!detail.open) {
      currentPost = null; detail.querySelector<HTMLElement>('.pc-detail-article')!.hidden = true; detail.querySelector<HTMLElement>('.pc-comments')!.hidden = true;
    }
    if (updateUrl && new URL(location.href).searchParams.get('post') !== id) history.pushState(null, '', postUrl(id));
    openModal(detail, true); await refreshDetail();
  }
  function showAction(action: Action) {
    if (mutationBusy) return;
    pendingAction = action; actionForm.reset(); actionForm.querySelector<HTMLElement>('.pc-form-status')!.textContent = '';
    const reporting = action.action === 'report', comment = !!action.commentId;
    actionDialog.querySelector<HTMLElement>('#pc-action-title')!.textContent = reporting ? `${comment ? '댓글' : '게시글'} 신고` : `내 ${comment ? '댓글' : '게시글'} 삭제`;
    actionDialog.querySelector<HTMLElement>('.pc-action-description')!.textContent = reporting ? '신고 내용은 운영자만 확인합니다. 규칙에 어긋난 이유를 알려 주세요.' : `이 ${comment ? '댓글' : '게시글'}을 공개 목록에서 삭제할까요?`;
    actionDialog.querySelector<HTMLElement>('.pc-report-reason')!.hidden = !reporting; actionDialog.querySelector<HTMLElement>('.pc-report-detail')!.hidden = !reporting;
    actionForm.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent = reporting ? '신고 보내기' : '삭제하기';
    openModal(actionDialog);
  }
  function nicknameError(value: string): string { return length(value.trim()) < 2 || length(value.trim()) > 12 ? '닉네임은 2~12자로 적어 주세요.' : ''; }
  composeForm.addEventListener('submit', async event => {
    event.preventDefault(); if (mutationBusy) return;
    const nickname = composeNickname.value.trim(), title = titleInput.value.trim(), body = bodyInput.value.trim();
    const error = nicknameError(nickname) || (!title || length(title) > 60 ? '제목은 1~60자로 적어 주세요.' : '') || (!body || length(body) > 2000 ? '내용은 1~2,000자로 적어 주세요.' : '');
    if (error) { composeStatus.textContent = error; return; }
    setBusy(true); composeStatus.textContent = '글을 등록하고 있습니다…';
    let createdId: string | undefined;
    try {
      const value = await mutate({ action: 'post', requestId: composeRequest, nickname, title, body, rulesAccepted: input<HTMLInputElement>(composeForm, 'rules').checked });
      if (disposed) return;
      createdId = value.postId; rememberNickname(nickname); commentNickname.value = nickname;
      titleInput.value = ''; bodyInput.value = ''; input<HTMLInputElement>(composeForm, 'rules').checked = false; composeRequest = crypto.randomUUID(); updateComposeCounters();
      composeStatus.textContent = ''; compose.close(); announce('이야기를 등록했습니다.');
    } catch (error) { if (!disposed) composeStatus.textContent = message(error); }
    finally { if (!disposed) setBusy(false); }
    if (createdId && !disposed) { page = 1; sort = 'latest'; updateSort(); void loadList(); await openPost(createdId, true); }
  });
  commentForm.addEventListener('submit', async event => {
    event.preventDefault(); if (mutationBusy || !currentPost) return;
    const nickname = commentNickname.value.trim(), body = commentInput.value.trim(), postId = currentPostId;
    const error = nicknameError(nickname) || (!body || length(body) > 300 ? '댓글은 1~300자로 적어 주세요.' : '');
    if (error) { commentStatus.textContent = error; return; }
    setBusy(true); commentStatus.textContent = '댓글을 등록하고 있습니다…';
    try {
      await mutate({ action: 'comment', requestId: commentRequest, postId, nickname, body, rulesAccepted: input<HTMLInputElement>(commentForm, 'rules').checked });
      if (disposed) return;
      rememberNickname(nickname); composeNickname.value = nickname; commentInput.value = ''; commentRequest = crypto.randomUUID(); input<HTMLInputElement>(commentForm, 'rules').checked = false; drafts.delete(postId);
      commentForm.querySelector<HTMLElement>('.pc-counter')!.textContent = '0 / 300'; commentStatus.textContent = '댓글을 등록했습니다.';
      await refreshDetail(1);
      const lastPage = Math.ceil((currentPost?.commentCount ?? 0) / COMMUNITY_LIMITS.commentPageSize);
      if (lastPage > 1) await refreshDetail(lastPage);
      void loadList(true);
    } catch (error) { if (!disposed) commentStatus.textContent = message(error); }
    finally { if (!disposed) setBusy(false); }
  });
  actionForm.addEventListener('submit', async event => {
    event.preventDefault(); if (mutationBusy || !pendingAction) return;
    const action = { ...pendingAction };
    const reason = `${(actionForm.elements.namedItem('category') as HTMLSelectElement).value}${input<HTMLTextAreaElement>(actionForm, 'reason').value.trim() ? ` · ${input<HTMLTextAreaElement>(actionForm, 'reason').value.trim()}` : ''}`;
    const status = actionForm.querySelector<HTMLElement>('.pc-form-status')!; setBusy(true); status.textContent = '처리하고 있습니다…';
    let deletedPost = false;
    try {
      await mutate({ ...action, ...(action.action === 'report' ? { reason } : {}) });
      if (disposed) return;
      actionDialog.close();
      if (action.action === 'delete-post') { deletedPost = true; closePost(); announce('내 글을 삭제했습니다.'); }
      else if (action.action === 'delete-comment') { await refreshDetail(); detailStatus('내 댓글을 삭제했습니다.'); }
      else detailStatus('신고를 접수했습니다. 운영자가 확인합니다.');
      if (action.action !== 'report') void loadList(true);
    } catch (error) { if (!disposed) status.textContent = message(error); }
    finally { if (!disposed) setBusy(false); }
    if (deletedPost) get<HTMLButtonElement>('pc-compose').focus();
  });
  function updateComposeCounters() {
    compose.querySelector<HTMLElement>('#pc-title-count')!.textContent = `${length(titleInput.value)} / 60`;
    compose.querySelector<HTMLElement>('#pc-body-count')!.textContent = `${length(bodyInput.value).toLocaleString('ko-KR')} / 2,000`;
  }
  composeForm.addEventListener('input', () => { composeRequest = crypto.randomUUID(); updateComposeCounters(); composeStatus.textContent = ''; });
  commentForm.addEventListener('input', () => { commentRequest = crypto.randomUUID(); commentForm.querySelector<HTMLElement>('.pc-counter')!.textContent = `${length(commentInput.value)} / 300`; commentStatus.textContent = ''; });
  get('pc-compose').addEventListener('click', () => { announce(''); openModal(compose, true); });
  for (const dialog of [compose, detail, actionDialog]) {
    dialog.querySelector<HTMLButtonElement>('.pc-close')!.addEventListener('click', () => { if (!mutationBusy) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (mutationBusy) event.preventDefault(); });
  }
  actionDialog.querySelector<HTMLButtonElement>('.pc-action-cancel')!.addEventListener('click', () => { if (!mutationBusy) actionDialog.close(); });
  detail.addEventListener('close', () => {
    // A queued native close event can arrive after Back/Forward has reopened the dialog.
    if (detail.open) { suppressCloseHistory = false; return; }
    saveCommentDraft(); ++detailVersion; if (actionDialog.open) actionDialog.close();
    if (!suppressCloseHistory && new URL(location.href).searchParams.get('post') === currentPostId) removePostParam(); suppressCloseHistory = false;
  });
  function updateSort() {
    host.querySelectorAll<HTMLButtonElement>('[data-pc-sort]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.pcSort === sort)));
    get('pc-sort-note').textContent = sort === 'popular' ? '최근 7일 · 추천, 댓글, 최신순으로 정렬합니다. 최근 글이 없으면 이전 글을 보여드려요.' : '가장 최근에 올라온 이야기부터 보여드려요.';
  }
  host.querySelectorAll<HTMLButtonElement>('[data-pc-sort]').forEach(control => control.addEventListener('click', () => {
    if (listBusy || control.dataset.pcSort === sort) return;
    sort = control.dataset.pcSort === 'popular' ? 'popular' : 'latest'; page = 1; hasMore = false; updateSort(); void loadList();
  }));
  get('pc-prev').addEventListener('click', () => { if (!listBusy && page > 1) { page--; void loadList(); } });
  get('pc-next').addEventListener('click', () => { if (!listBusy && hasMore) { page++; void loadList(); } });
  get('pc-refresh').addEventListener('click', () => { void loadList(); });
  function syncPost() {
    if (!active || mutationBusy) return;
    const id = new URL(location.href).searchParams.get('post');
    if (id && (!detail.open || currentPostId !== id)) void openPost(id, false);
    else if (!id && detail.open) closePost(true);
  }
  const onVisibility = () => { if (active && !document.hidden && Date.now() - lastListAt >= 60_000) void loadList(true); };
  const timer = window.setInterval(onVisibility, 60_000);
  window.addEventListener('popstate', syncPost); document.addEventListener('visibilitychange', onVisibility);
  updatePagination();
  return {
    setActive(value: boolean) {
      active = value;
      if (value) { if (Date.now() - lastListAt >= 60_000) void loadList(); syncPost(); }
      else { closePost(true); if (compose.open) compose.close(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; ++listVersion; ++detailVersion; window.clearInterval(timer); controllers.forEach(controller => controller.abort());
      window.removeEventListener('popstate', syncPost); document.removeEventListener('visibilitychange', onVisibility);
      compose.remove(); detail.remove(); actionDialog.remove(); drafts.clear();
    },
  };
}
