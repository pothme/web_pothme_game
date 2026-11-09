import { normalizeKakaoPayUrl } from '../shared/support-link';
import './support-content.css';

export function createSupportContent(host: HTMLElement) {
  const content = document.createElement('section'); content.className = 'support-transfer';
  content.innerHTML = `<p class="support-transfer-empty">아직 후원 송금 주소가 등록되지 않았어요.</p>
    <div class="support-transfer-available" hidden>
      <div class="support-device-switch" role="group" aria-label="후원 연결 방법"><button type="button" data-mode="pc">PC · QR 스캔</button><button type="button" data-mode="phone">모바일 · 앱 열기</button></div>
      <div class="support-pc"><p>휴대폰의 카카오톡 <b>더보기 → 코드스캔</b>으로<br>아래 QR코드를 스캔해 주세요.</p><figure class="support-qr"><img alt="카카오페이 송금 QR코드" hidden><figcaption class="support-qr-status" role="status">QR코드를 준비하고 있어요.</figcaption></figure></div>
      <div class="support-phone" hidden><p>휴대폰에서 아래 버튼을 눌러<br>카카오페이 송금 화면으로 이동하세요.</p><a class="support-pay" target="_blank" rel="noopener noreferrer">카카오페이 송금 화면 열기 ↗</a><p class="support-phone-help">앱이 열리지 않으면 카카오톡에서 송금 링크를 열거나, ‘PC · QR 스캔’으로 전환해 다른 휴대폰으로 스캔해 주세요.</p></div>
      <div class="support-copy-actions"><button type="button" class="support-copy">송금 링크 복사</button><button type="button" class="support-share">안내 페이지 공유</button></div>
      <label class="support-link-label">카카오페이 송금 링크<input class="support-link-value" aria-label="카카오페이 송금 링크" readonly></label>
      <input class="support-copy-fallback support-link-value" aria-label="복사할 주소" readonly hidden>
      <p class="support-copy-status" role="status" aria-live="polite"></p>
      <p class="support-transfer-note">카카오페이에서 받는 분과 원하는 금액을 확인해 주세요.<br>후원은 선택 사항이며 사무실과 시세 페이지는 무료예요.</p>
    </div>`;
  host.append(content);
  const query = <T extends HTMLElement>(selector: string) => content.querySelector<T>(selector)!;
  const available = query<HTMLDivElement>('.support-transfer-available');
  const empty = query<HTMLParagraphElement>('.support-transfer-empty');
  const image = query<HTMLImageElement>('.support-qr img');
  const qrStatus = query<HTMLElement>('.support-qr-status');
  const link = query<HTMLAnchorElement>('.support-pay');
  const linkValue = query<HTMLInputElement>('.support-link-value');
  const copyStatus = query<HTMLElement>('.support-copy-status');
  const copyFallback = query<HTMLInputElement>('.support-copy-fallback');
  const media = matchMedia('(max-width:640px)');
  let mode: 'pc' | 'phone' = media.matches ? 'phone' : 'pc';
  let chosen = false, active = false, disposed = false, revision = 0, url = '', qrFor = '';
  async function renderQr() {
    if (!active || mode !== 'pc' || !url || qrFor === url) return;
    const current = url, request = revision; qrFor = url;
    qrStatus.textContent = 'QR코드를 준비하고 있어요.';
    try {
      const { createSupportQr } = await import('./support-qr');
      const source = await createSupportQr(current);
      if (disposed || request !== revision || current !== url) return;
      image.src = source; image.hidden = false;
      qrStatus.textContent = '휴대폰으로 스캔하면 송금 화면이 열려요.';
    } catch {
      if (disposed || request !== revision) return;
      qrFor = ''; image.hidden = true;
      qrStatus.textContent = 'QR코드를 불러오지 못했어요. 송금 링크를 복사해 휴대폰에서 열어 주세요.';
    }
  }
  function renderMode() {
    query<HTMLElement>('.support-pc').hidden = mode !== 'pc';
    query<HTMLElement>('.support-phone').hidden = mode !== 'phone';
    content.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    void renderQr();
  }
  content.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => { button.onclick = () => { chosen = true; mode = button.dataset.mode as 'pc' | 'phone'; renderMode(); }; });
  const onMedia = () => { if (!chosen) { mode = media.matches ? 'phone' : 'pc'; renderMode(); } };
  media.addEventListener('change', onMedia);
  async function copy(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); copyFallback.hidden = true; copyStatus.textContent = success; }
    catch { copyFallback.hidden = false; copyFallback.value = value; copyFallback.focus(); copyFallback.select(); copyStatus.textContent = '선택된 주소를 길게 누르거나 Ctrl+C로 복사해 주세요.'; }
  }
  query<HTMLButtonElement>('.support-copy').onclick = () => { if (url) { linkValue.value = url; void copy(url, '송금 링크를 복사했어요. 휴대폰에서 열어 주세요.'); } };
  query<HTMLButtonElement>('.support-share').onclick = () => { void copy(new URL('/support', location.origin).href, 'PC·모바일 공통 안내 페이지 주소를 복사했어요.'); };
  renderMode();
  return {
    activate() { active = true; void renderQr(); },
    setUrl(value: string) {
      const next = normalizeKakaoPayUrl(value);
      if (next === url) return;
      url = next; revision++; qrFor = ''; image.hidden = true; image.removeAttribute('src'); copyStatus.textContent = ''; copyFallback.hidden = true;
      available.hidden = !url; empty.hidden = !!url; linkValue.value = url;
      if (url) link.href = url; else link.removeAttribute('href');
      void renderQr();
    },
    dispose() { disposed = true; revision++; media.removeEventListener('change', onMedia); content.remove(); },
  };
}
