import './support.css';
import { createSupportContent } from './support-content';

export function createSupport(host: HTMLElement) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'support-button'; button.textContent = '☕ 커피값 후원하기';
  const dialog = document.createElement('dialog'); dialog.className = 'support-dialog';
  const titleId = `support-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `<header><h2 id="${titleId}">커피 한 잔의 응원</h2><button type="button" aria-label="후원 안내 닫기">×</button></header><div class="support-content-host"></div><a class="support-guide-link" href="/support" target="_blank" rel="noopener">후원 안내 페이지 따로 열기 ↗</a>`;
  const content = createSupportContent(dialog.querySelector<HTMLElement>('.support-content-host')!);
  dialog.querySelector('button')!.onclick = () => dialog.close();
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  button.onclick = () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => other.close());
    if (!dialog.open) dialog.showModal();
    content.activate();
  };
  host.append(button); document.body.append(dialog);
  return { setUrl: content.setUrl, dispose() { content.dispose(); dialog.remove(); button.remove(); } };
}
