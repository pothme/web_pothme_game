import { compactLayout } from './responsive';
import { observeMobileViewport } from './mobile-viewport';
import './mobile-shell.css';

type ShellOptions = { closeComposer: () => void; openComposer: () => void; onViewChange: () => void; onResetView: () => void; onGameRoom?:()=>void };

export function createMobileShell(options: ShellOptions) {
  const viewport = observeMobileViewport();
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const nav = el('mobile-actions');
  const chartButton = el<HTMLButtonElement>('mobile-chart');
  const marketButton = el<HTMLButtonElement>('mobile-market');
  const chatButton = nav.querySelector<HTMLButtonElement>('.chat-launch')!;
  const admission = el('admission');
  const market = el('market-panel');
  const tools = document.querySelector<HTMLElement>('.world-tools')!;
  let officeView = false;
  let joined = false;
  const slots = [admission, market, tools].map(node => {
    const slot = document.createComment('mobile-shell-return');
    node.before(slot);
    return { node, slot };
  });

  const officeButton = document.createElement('button');
  officeButton.type = 'button'; officeButton.id = 'mobile-office';
  officeButton.innerHTML = '<span aria-hidden="true">▦</span><span>사무실</span>';
  chartButton.innerHTML = '<span aria-hidden="true">↗</span><span>차트</span>';
  chartButton.setAttribute('aria-label', '공유 차트 보기');
  chartButton.after(officeButton);
  marketButton.innerHTML = '<span aria-hidden="true">⌕</span><span>차트·안내</span>';
  marketButton.setAttribute('aria-controls', 'mobile-market-dialog');
  const enterButton = document.createElement('button');
  enterButton.type = 'button'; enterButton.id = 'mobile-enter';
  enterButton.innerHTML = '<span aria-hidden="true">→</span><span>입장</span>';
  enterButton.setAttribute('aria-haspopup', 'dialog');
  nav.appendChild(enterButton);
  const gameButton=document.createElement('button');gameButton.type='button';gameButton.id='mobile-games';gameButton.innerHTML='<span aria-hidden="true">♟</span><span>게임룸</span>';gameButton.hidden=true;gameButton.onclick=()=>options.onGameRoom?.();officeButton.after(gameButton);
  nav.setAttribute('aria-label', '모바일 화면 메뉴');
  const toolsButton = document.createElement('button');
  toolsButton.type = 'button'; toolsButton.className = 'mobile-tools-trigger';
  toolsButton.textContent = '도구'; toolsButton.setAttribute('aria-label', '시점과 이용 도구 열기');
  toolsButton.setAttribute('aria-haspopup', 'dialog');
  const topbar = document.querySelector<HTMLElement>('.topbar')!;
  topbar.insertBefore(toolsButton, topbar.querySelector('.identity'));

  function createSheet(id: string, title: string) {
    const dialog = document.createElement('dialog');
    dialog.id = id; dialog.className = 'mobile-sheet';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.innerHTML = `<div class="mobile-sheet-header"><h2 id="${id}-title">${title}</h2><button type="button" class="mobile-sheet-close" aria-label="${title} 닫기">닫기 ×</button></div><div class="mobile-sheet-body"></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector<HTMLButtonElement>('.mobile-sheet-close')!.onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      if (dialog === marketDialog) {
        document.body.classList.remove('market-open');
        marketButton.setAttribute('aria-expanded', 'false');
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    return dialog;
  }
  const admissionDialog = createSheet('mobile-admission-dialog', '사무실 입장');
  const admissionHint = document.createElement('p');
  admissionHint.className = 'mobile-admission-hint';
  admissionHint.textContent = '닉네임으로 입장하면 내 캐릭터가 생기고, 조이스틱으로 걸어 다닐 수 있어요.';
  admissionDialog.querySelector('.mobile-sheet-body')!.prepend(admissionHint);
  const marketDialog = createSheet('mobile-market-dialog', '공유 차트·안내');
  const toolsDialog = createSheet('mobile-tools-dialog', '사무실 도구');
  const sheets = [admissionDialog, marketDialog, toolsDialog];
  const destinations = [admissionDialog, marketDialog, toolsDialog].map(dialog => dialog.querySelector<HTMLElement>('.mobile-sheet-body')!);

  function closeDialogs() {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  }
  function openSheet(dialog: HTMLDialogElement) {
    if (!compactLayout.matches) return;
    options.closeComposer(); closeDialogs(); viewport.update();
    if (dialog === marketDialog) {
      document.body.classList.add('market-open');
      marketButton.setAttribute('aria-expanded', 'true');
    }
    dialog.showModal();
    // Keep the close control visible; tapping an input opens the phone keyboard.
    dialog.querySelector<HTMLButtonElement>('.mobile-sheet-close')!.focus({ preventScroll: true });
  }
  function setView(next: 'chart' | 'office') {
    if (next === 'office' && compactLayout.matches && !joined) {
      openSheet(admissionDialog); return false;
    }
    officeView = next === 'office';
    options.closeComposer();
    document.body.classList.toggle('mobile-office-view', compactLayout.matches && officeView);
    chartButton.setAttribute('aria-pressed', String(!officeView));
    officeButton.setAttribute('aria-pressed', String(officeView));
    options.onViewChange();
    return true;
  }
  chartButton.onclick = () => setView('chart');
  officeButton.onclick = () => { if (setView('office')) options.onResetView(); };
  marketButton.onclick = () => openSheet(marketDialog);
  enterButton.onclick = () => openSheet(admissionDialog);
  toolsButton.onclick = () => openSheet(toolsDialog);
  chatButton.onclick = () => { closeDialogs(); options.openComposer(); };

  // Resume and measure the office before the button applies its camera action.
  tools.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!compactLayout.matches || !button || !toolsDialog.open) return;
    if (['rotate-left', 'rotate-right', 'tilt-up', 'tilt-down', 'zoom-out', 'zoom-in', 'view-button', 'rear-charts-view', 'community-view', 'reset-view', 'free-view', 'pan-left', 'pan-right', 'pan-up', 'pan-down'].includes(button.id)) {
      if (!joined) {
        event.preventDefault(); event.stopImmediatePropagation(); openSheet(admissionDialog); return;
      }
      toolsDialog.close(); setView('office');
    }
  }, { capture: true });

  function syncLayout() {
    options.closeComposer();
    sheets.forEach(dialog => { if (dialog.open) dialog.close(); });
    market.classList.remove('mobile-open'); document.body.classList.remove('market-open');
    slots.forEach(({ node, slot }, index) => {
      if (compactLayout.matches) destinations[index]!.appendChild(node);
      else slot.after(node);
    });
    document.body.classList.toggle('mobile-office-view', compactLayout.matches && officeView);
    marketButton.setAttribute('aria-expanded', 'false');
    chartButton.setAttribute('aria-pressed', String(!officeView));
    officeButton.setAttribute('aria-pressed', String(officeView));
    viewport.update();
    // The caller performs the initial chart placement after construction.
  }
  compactLayout.addEventListener('change', () => { syncLayout(); options.onViewChange(); });
  syncLayout();

  return {
    dispose: viewport.dispose,
    isOfficeView: () => officeView,
    setView,
    openAdmission: () => openSheet(admissionDialog),
    setSession(active: boolean, connected = active) {
      const entering = active && !joined;
      joined = active;
      enterButton.hidden = joined;
      gameButton.hidden = !joined;gameButton.disabled=joined&&!connected;nav.classList.toggle('has-games',joined);
      chatButton.hidden = !joined;
      chatButton.disabled = joined && !connected;
      if (joined && admissionDialog.open) admissionDialog.close();
      if (!connected) {
        options.closeComposer();
        sheets.forEach(dialog => { if (dialog.open) dialog.close(); });
      }
      if (!joined) setView('chart');
      else if (entering && connected && compactLayout.matches) setView('office');
      else options.onViewChange();
    },
  };
}
