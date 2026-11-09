import { createSupportContent } from './support-content';
import { createMarketsTheme, type ThemePreference } from './markets-theme';
import './support-page.css';

/** Public guide only: no room admission, WebSocket, payment, or session creation. */
export function initSupportPage() {
  document.title = '포듬증권 후원 안내 — 커피 한 잔의 응원';
  document.querySelector('meta[name="description"]')?.setAttribute('content', '포듬증권에 커피 한 잔의 응원을 보내세요. PC에서는 QR코드를 스캔하고, 휴대폰에서는 카카오페이 송금 링크를 열 수 있습니다.');
  document.body.classList.add('support-page');
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <header class="ps-header"><div class="ps-header-inner">
      <a class="ps-brand" href="/" aria-label="포듬증권 사무실로"><span class="ps-brand-mark" aria-hidden="true">포</span><span>포듬증권<small>PODEUM SECURITIES</small></span></a>
      <nav aria-label="포듬증권 메뉴"><a href="/">사무실</a><a href="/markets">시세 · 커뮤니티</a></nav>
      <label class="ps-theme"><span class="ps-sr-only">화면 테마</span><select aria-label="화면 테마"><option value="system">시스템 테마</option><option value="light">라이트</option><option value="dark">다크</option></select></label>
    </div></header>
    <main class="ps-main">
      <section class="ps-intro" aria-labelledby="ps-title">
        <span class="ps-eyebrow">PODEUM SUPPORT</span>
        <div class="ps-coffee" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><path d="M20 30h35v17c0 11-7 18-17.5 18S20 58 20 47V30Z" stroke="currentColor" stroke-width="3"/><path d="M55 33h4a10 10 0 0 1 0 20h-5M16 69h46M29 20c-5-5 4-7 0-12M39 20c-5-5 4-7 0-12M49 20c-5-5 4-7 0-12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>
        <h1 id="ps-title">커피 한 잔의<br><em>응원.</em></h1>
        <p class="ps-intro-copy">함께 시장을 읽고, 이야기를 나누는 곳.<br>포듬증권 운영에 작은 응원을 보내 주세요.</p>
        <p class="ps-free-note"><span aria-hidden="true">✓</span> 후원은 자유롭게.<br>사무실과 시세 페이지는 늘 무료로 이용할 수 있어요.</p>
      </section>
      <section class="ps-card" aria-labelledby="ps-card-title">
        <div class="ps-card-heading"><span class="ps-card-dot" aria-hidden="true"></span><span>포듬증권 후원 안내</span></div>
        <h2 id="ps-card-title">편한 기기로 마음을 전하세요.</h2>
        <div class="ps-load-status" role="status" aria-live="polite"><p>송금 안내를 불러오는 중이에요.</p><button type="button" hidden>다시 불러오기</button></div>
        <div id="support-page-content" hidden></div>
      </section>
    </main>
    <footer class="ps-footer"><p>함께하는 모든 시간에 감사드립니다.</p><a href="/">포듬증권으로 돌아가기 <span aria-hidden="true">↗</span></a></footer>
  `;
  const themeInput = app.querySelector<HTMLSelectElement>('.ps-theme select')!;
  const theme = createMarketsTheme(preference => { themeInput.value = preference; });
  themeInput.value = theme.preference;
  themeInput.onchange = () => theme.setPreference(themeInput.value as ThemePreference);
  const host = app.querySelector<HTMLElement>('#support-page-content')!;
  const status = app.querySelector<HTMLElement>('.ps-load-status')!;
  const statusText = status.querySelector('p')!;
  const retry = status.querySelector<HTMLButtonElement>('button')!;
  const content = createSupportContent(host);
  content.activate();
  let disposed = false;
  let pending: AbortController | null = null;
  async function load() {
    if (pending || disposed) return;
    const controller = new AbortController(); pending = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    retry.hidden = true; status.hidden = false; host.hidden = true;
    statusText.textContent = '송금 안내를 불러오는 중이에요.';
    try {
      const response = await fetch('/api/status', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok) throw new Error('status');
      const data: unknown = await response.json();
      const value = data && typeof data === 'object' && 'settings' in data ? data.settings : null;
      const url = value && typeof value === 'object' && 'donationUrl' in value ? value.donationUrl : null;
      if (typeof url !== 'string') throw new Error('settings');
      if (disposed) return;
      content.setUrl(url); host.hidden = false; status.hidden = true;
    } catch {
      if (disposed) return;
      content.setUrl('');
      statusText.textContent = '송금 안내를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
      retry.hidden = false;
    } finally {
      clearTimeout(timeout); if (pending === controller) pending = null;
    }
  }
  retry.onclick = () => { void load(); };
  void load();
  return { dispose() { disposed = true; pending?.abort(); content.dispose(); theme.dispose(); document.body.classList.remove('support-page'); } };
}
