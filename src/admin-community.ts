import type { CommunityAdminState } from '../shared/community';
import './admin-community.css';

export function createAdminCommunity(host: HTMLElement, options: {
  read(query: string): Promise<CommunityAdminState>;
  manage(body: Record<string, unknown>, success: string): Promise<string | null>;
}) {
  host.className = 'admin-operations admin-community';
  host.innerHTML = `<section class="admin-operation-card"><div class="admin-operation-card-heading"><div><span class="admin-eyebrow">COMMUNITY MODERATION</span><h3>커뮤니티 관리 <span data-count></span></h3><p>신고 내용을 확인하고 글·댓글을 숨기거나 복구할 수 있어요.<br>숨긴 글은 사무실 인기글에서도 제외됩니다.</p></div><a href="/markets?view=community" target="_blank" rel="noopener">커뮤니티 ↗</a></div><div class="admin-community-toolbar"><label>목록 <select aria-label="커뮤니티 관리 목록"><option value="reported">미처리 신고</option><option value="all">전체 게시글</option></select></label><button type="button" class="admin-secondary-action" data-refresh>새로고침</button></div><p role="status" data-message></p><div data-list></div><nav class="admin-community-pages" aria-label="커뮤니티 관리 페이지"><button type="button" class="admin-secondary-action" data-prev>이전</button><span data-page></span><button type="button" class="admin-secondary-action" data-next>다음</button></nav></section>`;
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const filter = el<HTMLSelectElement>('select');
  const list = el('[data-list]'), message = el('[data-message]');
  let authenticated = false, busy = false, loading = false, generation = 0, page = 1;
  let data: CommunityAdminState | null = null;
  const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function controls() {
    host.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy || loading || !authenticated || button.dataset.unavailable === 'true'; });
    filter.disabled = busy || loading || !authenticated;
    el<HTMLButtonElement>('[data-prev]').disabled ||= page <= 1;
    el<HTMLButtonElement>('[data-next]').disabled ||= !data?.hasMore;
    host.setAttribute('aria-busy', String(loading));
  }
  function note(text: string, error = false) { message.textContent = text; message.classList.toggle('is-error', error); }
  async function act(body: Record<string, unknown>, success: string) {
    if (busy || loading || !authenticated) return;
    const version = generation;
    const error = await options.manage(body, success);
    if (version !== generation) return;
    if (error) note(error, true); else { await refresh(); note(success); }
  }
  function action(label: string, body: Record<string, unknown>, success: string, unavailable = false) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'admin-moderation-action'; button.textContent = label;
    button.dataset.unavailable = String(unavailable); button.onclick = () => { void act(body, success); }; return button;
  }
  function row(title: string, metadata: string, postId: string, text?: string) {
    const item = document.createElement('article'); item.className = 'admin-community-row';
    const info = document.createElement('div'); info.className = 'admin-community-content';
    const link = document.createElement('a'); link.textContent = title; link.href = `/markets?post=${encodeURIComponent(postId)}`; link.target = '_blank'; link.rel = 'noopener';
    const small = document.createElement('small'); small.textContent = metadata; info.append(link, small);
    if (text) { const body = document.createElement('p'); body.textContent = text; info.append(body); }
    const actions = document.createElement('div'); actions.className = 'admin-community-actions'; item.append(info, actions); list.append(item); return actions;
  }
  function render() {
    list.replaceChildren();
    if (!data) return;
    el('[data-count]').textContent = `미처리 신고 ${data.pendingReports}건`;
    el('[data-page]').textContent = `${page}페이지`;
    if (filter.value === 'reported') for (const report of data.reports) {
      const actions = row(report.title || '댓글 신고', `${report.targetType === 'post' ? '게시글' : '댓글'} · ${report.nickname} · ${date.format(report.createdAt)}${report.hidden ? ' · 숨김' : ''}${report.deleted ? ' · 작성자 삭제' : ''}`, report.postId, `신고 사유: ${report.reason}\n\n${report.text}`);
      actions.append(action(report.hidden ? '복구' : '숨기기', { action: report.hidden ? 'community-restore' : 'community-hide', targetType: report.targetType, id: report.targetId }, report.hidden ? '신고된 내용을 복구했어요.' : '신고된 내용을 숨겼어요.', report.deleted), action('신고 처리 완료', { action: 'community-report-dismiss', reportId: report.id }, '신고를 처리 완료했어요.'));
    } else for (const post of data.posts) {
      const actions = row(post.title, `${post.nickname} · ${date.format(post.createdAt)} · 추천 ${post.likeCount} · 댓글 ${post.commentCount}${post.hidden ? ' · 숨김' : ''}${post.deleted ? ' · 작성자 삭제' : ''}`, post.id);
      actions.append(action(post.hidden ? '복구' : '숨기기', { action: post.hidden ? 'community-restore' : 'community-hide', targetType: 'post', id: post.id }, post.hidden ? '게시글을 복구했어요.' : '게시글을 숨겼어요.', post.deleted));
    }
    if (filter.value === 'all' && data.hiddenComments?.length) {
      const heading = document.createElement('h4'); heading.textContent = '숨긴 댓글 · 복구'; list.append(heading);
      for (const comment of data.hiddenComments) {
        const actions = row(comment.title, `${comment.nickname} · ${date.format(comment.createdAt)} · 숨긴 댓글${comment.postHidden ? ' · 원글도 숨김 중: 원글을 복구해야 공개됩니다.' : ''}`, comment.postId, comment.body);
        actions.append(action('댓글 복구', { action: 'community-restore', targetType: 'comment', id: comment.id }, '댓글을 복구했어요.'));
      }
    }
    if (!list.childElementCount) { const empty = document.createElement('p'); empty.className = 'admin-empty-list'; empty.textContent = filter.value === 'reported' ? '미처리 신고가 없어요.' : '등록된 게시글이 없어요.'; list.append(empty); }
    controls();
  }
  async function refresh() {
    if (!authenticated || loading) return;
    const version = generation; loading = true; controls(); note('목록을 확인하고 있어요…');
    try {
      const next = await options.read(`status=${filter.value}&page=${page}`);
      if (version !== generation) return;
      data = next; note(''); render();
    } catch (error) { if (version === generation) note(error instanceof Error ? error.message : '목록을 확인하지 못했어요.', true); }
    finally { if (version === generation) { loading = false; controls(); } }
  }
  filter.onchange = () => { page = 1; void refresh(); };
  el('[data-refresh]').onclick = () => { void refresh(); };
  el('[data-prev]').onclick = () => { if (page > 1) { page--; void refresh(); } };
  el('[data-next]').onclick = () => { if (data?.hasMore) { page++; void refresh(); } };
  return {
    setAuthenticated(value: boolean) { if (value && !authenticated) { authenticated = true; void refresh(); } },
    setBusy(value: boolean) { busy = value; controls(); },
    reset() { generation++; authenticated = false; loading = false; data = null; page = 1; filter.value = 'reported'; list.replaceChildren(); note(''); el('[data-count]').textContent = ''; controls(); },
    refresh,
  };
}
