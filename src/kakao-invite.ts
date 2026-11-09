import './kakao-invite.css';

const ROOM_URL = 'https://open.kakao.com/o/gIK0nTnf';
const ENTRY_CODE = '1148';
const INVITE_TEXT = `포듬이네 카카오톡방에 초대합니다.\n${ROOM_URL}\n입장코드: ${ENTRY_CODE}`;
const speechBubble = '<svg viewBox="0 0 28 26" width="23" height="23" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14 2C7.4 2 2 6.1 2 11.1c0 3.1 2.1 5.8 5.3 7.4L6 23.2c-.1.4.3.7.6.5l5.5-3.5c.6.1 1.3.1 1.9.1 6.6 0 12-4.1 12-9.2S20.6 2 14 2Z"/><path d="M8 11h.1m5.9 0h.1m5.9 0h.1" fill="none" stroke="#fee500" stroke-width="2.8" stroke-linecap="round"/></svg>';

export function createKakaoInvite({ beforeOpen }: { beforeOpen?: () => void } = {}) {
  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (!topbar || topbar.querySelector('.kakao-invite-trigger')) return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'kakao-invite-trigger';
  trigger.setAttribute('aria-label', '카카오톡방 초대하기');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'kakao-invite-dialog');
  trigger.innerHTML = `${speechBubble}<span class="kakao-invite-label-full">포듬이네 들어가기</span><span class="kakao-invite-label-short">포듬이네</span>`;
  topbar.insertBefore(trigger, topbar.querySelector('.identity'));
  topbar.classList.add('has-kakao-invite');

  const dialog = document.createElement('dialog');
  dialog.id = 'kakao-invite-dialog';
  dialog.className = 'kakao-invite-dialog';
  dialog.setAttribute('aria-labelledby', 'kakao-invite-title');
  dialog.setAttribute('aria-describedby', 'kakao-invite-description');
  dialog.innerHTML = `
    <div class="kakao-invite-heading"><div><span class="kakao-invite-eyebrow">KAKAO OPEN CHAT</span><h2 id="kakao-invite-title">카카오톡방 초대하기</h2></div><button type="button" class="kakao-invite-close" aria-label="카카오톡방 초대 닫기">×</button></div>
    <div class="kakao-invite-room"><span class="kakao-invite-room-icon">${speechBubble}</span><div><small>함께 이야기하는 오픈채팅방</small><h3>포듬이네</h3></div></div>
    <p id="kakao-invite-description">링크와 입장코드를 함께 전달해 주세요.</p>
    <div class="kakao-invite-code"><span>입장코드</span><strong>${ENTRY_CODE}</strong></div>
    <a class="kakao-invite-enter" href="${ROOM_URL}" target="_blank" rel="noopener noreferrer">포듬이네 들어가기<span aria-hidden="true">↗</span></a>
    <div class="kakao-invite-actions"><button type="button" data-invite-action="copy">초대 내용 복사</button><button type="button" data-invite-action="share">공유하기</button></div>
    <div class="kakao-invite-manual" hidden><label for="kakao-invite-text">초대 내용 직접 복사</label><textarea id="kakao-invite-text" readonly rows="4" spellcheck="false"></textarea><p>선택된 내용을 길게 누르거나 Ctrl/Cmd+C로 복사해 주세요.</p></div>
    <p class="kakao-invite-status" role="status" aria-live="polite"></p>
  `;
  document.body.appendChild(dialog);

  const closeButton = dialog.querySelector<HTMLButtonElement>('.kakao-invite-close')!;
  const copyButton = dialog.querySelector<HTMLButtonElement>('[data-invite-action="copy"]')!;
  const shareButton = dialog.querySelector<HTMLButtonElement>('[data-invite-action="share"]')!;
  const message = dialog.querySelector<HTMLParagraphElement>('.kakao-invite-status')!;
  const manual = dialog.querySelector<HTMLDivElement>('.kakao-invite-manual')!;
  const text = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
  text.value = INVITE_TEXT;
  let busy = false;

  function setBusy(value: boolean) {
    busy = value;
    copyButton.disabled = value;
    shareButton.disabled = value;
  }
  async function copyInvite() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(INVITE_TEXT);
      message.textContent = '초대 링크와 입장코드를 함께 복사했어요.';
      manual.hidden = true;
    } catch {
      message.textContent = '자동 복사가 안 돼요. 표시된 초대 내용을 직접 복사해 주세요.';
      manual.hidden = false;
      if (dialog.open) {
        text.focus({ preventScroll: true });
        text.select();
        text.scrollIntoView({ block: 'nearest' });
      }
    }
  }
  copyButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    await copyInvite();
    setBusy(false);
  });
  shareButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    message.textContent = '';
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: '포듬이네 카카오톡방 초대', text: INVITE_TEXT });
        message.textContent = '초대 내용 공유를 마쳤어요.';
      } else {
        await copyInvite();
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) await copyInvite();
    } finally {
      setBusy(false);
    }
  });

  trigger.addEventListener('click', () => {
    beforeOpen?.();
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => {
      if (other !== dialog) other.close();
    });
    message.textContent = '';
    manual.hidden = true;
    if (!dialog.open) dialog.showModal();
    closeButton.focus({ preventScroll: true });
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));
}
