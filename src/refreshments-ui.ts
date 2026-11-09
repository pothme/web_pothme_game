import { REFRESHMENT_DRINKS, REFRESHMENT_SNACKS, REFRESHMENT_RULES, isRefreshmentSelection, type RefreshmentSelection, type RefreshmentDrink, type RefreshmentSnack } from '../shared/refreshments';
import './refreshments-ui.css';

const DRINK_ICONS: Record<RefreshmentDrink, string> = { coffee: '☕', juice: '🥤', tea: '🍵', water: '💧' };
const SNACK_ICONS: Record<RefreshmentSnack, string> = { cookie: '🍪', donut: '🍩', sandwich: '🥪' };
function label(selection: RefreshmentSelection): string {
  return [REFRESHMENT_DRINKS.find(item => item.id === selection.drink)?.label, REFRESHMENT_SNACKS.find(item => item.id === selection.snack)?.label].filter(Boolean).join(' · ');
}

export function createRefreshmentsUI(options: {
  now(): number;
  beforeOpen(): void;
  send(selection: RefreshmentSelection | null, requestId: string): boolean;
}) {
  const dialog = document.createElement('dialog'); dialog.id = 'refreshments-dialog'; dialog.className = 'modal refreshments-dialog'; dialog.setAttribute('aria-labelledby', 'refreshments-title');
  dialog.innerHTML = `<header class="modal-header"><div><span class="eyebrow">WINDOWSIDE SNACK BAR</span><h2 id="refreshments-title">스낵바</h2></div><button type="button" class="tool-button rf-close" aria-label="스낵바 닫기">×</button></header>
    <p class="rf-intro">커피 한 잔, 간식 하나, 또는 둘 다.<br>마음에 드는 메뉴를 골라 들고 가세요.</p>
    <div class="rf-tray"><div class="rf-tray-art" aria-hidden="true"><span data-drink-art>☕</span><span data-snack-art hidden></span><i></i></div><div><span class="eyebrow" data-tray-caption>YOUR PICK</span><strong data-tray-title>커피</strong><p data-tray-status>음료나 간식을 하나 이상 골라 주세요.</p></div></div>
    <form class="rf-form"><div class="rf-modes" role="group" aria-label="가져갈 메뉴 구성"><button type="button" data-mode="drink" aria-pressed="true">음료만</button><button type="button" data-mode="snack" aria-pressed="false">간식만</button><button type="button" data-mode="set" aria-pressed="false">음료 + 간식</button></div><fieldset><legend>음료</legend><div class="rf-choices rf-drinks"></div></fieldset><fieldset><legend>간식</legend><div class="rf-choices rf-snacks"></div></fieldset><p class="rf-message" role="status" aria-live="polite"></p><footer><button type="button" class="button button-outline rf-return">내려놓기</button><button type="submit" class="button button-primary rf-take">가져가기 ↗</button><button type="button" class="button button-primary rf-done" hidden>들고 나가기 ↗</button></footer></form><p class="rf-footnote">가져가기는 창가 스낵바 앞에서 할 수 있어요.<br>들고 있는 메뉴는 액션 → 내려놓기로 어디서든 비울 수 있어요.</p>`;
  document.body.append(dialog);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const take = dialog.querySelector<HTMLButtonElement>('.rf-take')!, returnButton = dialog.querySelector<HTMLButtonElement>('.rf-return')!;
  const done = dialog.querySelector<HTMLButtonElement>('.rf-done')!;
  const modes = [...dialog.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  const message = dialog.querySelector<HTMLElement>('.rf-message')!;
  const radios: HTMLInputElement[] = [];
  function addChoices(name: 'drink' | 'snack', choices: readonly { id: string; label: string }[], target: HTMLElement, icons: Record<string, string>, initial: string) {
    [...choices, { id: 'none', label: '선택 안 함' }].forEach(choice => {
      const label = document.createElement('label'); label.className = 'rf-choice';
      const input = document.createElement('input'); input.type = 'radio'; input.name = name; input.value = choice.id; input.defaultChecked = choice.id === initial; input.checked = choice.id === initial;
      const content = document.createElement('span'), icon = document.createElement('i'), text = document.createElement('strong');
      icon.setAttribute('aria-hidden', 'true'); icon.textContent = icons[choice.id] ?? '—'; text.textContent = choice.label; content.append(icon, text); label.append(input, content); target.append(label); radios.push(input);
    });
  }
  addChoices('drink', REFRESHMENT_DRINKS, dialog.querySelector<HTMLElement>('.rf-drinks')!, DRINK_ICONS, 'coffee');
  addChoices('snack', REFRESHMENT_SNACKS, dialog.querySelector<HTMLElement>('.rf-snacks')!, SNACK_ICONS, 'none');
  let connected = false, disposed = false, held: RefreshmentSelection | null = null;
  let pending: { id: string; selection: RefreshmentSelection | null; timer: ReturnType<typeof setTimeout> } | null = null;
  let cooldownUntil = 0;
  function selected(): RefreshmentSelection | null {
    const drink = (form.elements.namedItem('drink') as RadioNodeList).value, snack = (form.elements.namedItem('snack') as RadioNodeList).value;
    const selection = { drink: drink === 'none' ? null : drink, snack: snack === 'none' ? null : snack };
    return isRefreshmentSelection(selection) ? selection : null;
  }
  function clearPending() { if (pending) clearTimeout(pending.timer); pending = null; }
  function controls() {
    const cooling = options.now() < cooldownUntil;
    radios.forEach(input => { input.disabled = !connected || !!held || !!pending; });
    modes.forEach(button => { button.disabled = !connected || !!held || !!pending; });
    take.disabled = !connected || !!held || !!pending || cooling || !selected();
    returnButton.disabled = !connected || !held || !!pending || cooling;
    returnButton.hidden = !held;
    take.hidden = !!held;
    done.hidden = !held;
    take.textContent = pending?.selection ? '준비하고 있어요…' : '가져가기 ↗';
    returnButton.textContent = pending && pending.selection === null ? '내려놓고 있어요…' : cooling && held ? '잠시 후 내려놓기' : '내려놓기';
    form.setAttribute('aria-busy', String(!!pending));
  }
  function render() {
    const choice = held ?? selected();
    const drinkArt = dialog.querySelector<HTMLElement>('[data-drink-art]')!, snackArt = dialog.querySelector<HTMLElement>('[data-snack-art]')!;
    drinkArt.textContent = choice?.drink ? DRINK_ICONS[choice.drink] : ''; drinkArt.hidden = !choice?.drink;
    snackArt.textContent = choice?.snack ? SNACK_ICONS[choice.snack] : ''; snackArt.hidden = !choice?.snack;
    dialog.querySelector<HTMLElement>('[data-tray-title]')!.textContent = choice ? label(choice) : '메뉴를 골라 주세요';
    dialog.querySelector<HTMLElement>('[data-tray-caption]')!.textContent = held ? 'ON YOUR TRAY' : 'YOUR PICK';
    dialog.querySelector<HTMLElement>('[data-tray-status]')!.textContent = held ? '지금 캐릭터가 들고 있어요. 액션에서 먹기·마시기·내려놓기를 할 수 있어요.' : '음료나 간식을 하나 이상 골라 주세요.';
    const mode = choice?.drink && choice.snack ? 'set' : choice?.drink ? 'drink' : choice?.snack ? 'snack' : null;
    modes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    dialog.querySelector<HTMLElement>('.rf-modes')!.hidden = !!held;
    form.querySelectorAll('fieldset').forEach(fieldset => { fieldset.hidden = !!held; });
    dialog.classList.toggle('rf-holding', !!held); controls();
  }
  function request(selection: RefreshmentSelection | null) {
    if (disposed || !connected || pending || options.now() < cooldownUntil) return;
    if (selection && held) { message.textContent = '지금 쟁반을 반납한 뒤 새로 골라 주세요.'; return; }
    const id = crypto.randomUUID();
    if (!options.send(selection, id)) { message.textContent = '연결을 복구한 뒤 다시 눌러 주세요.'; return; }
    message.textContent = '';
    pending = { id, selection, timer: setTimeout(() => { clearPending(); message.textContent = '응답을 아직 확인하지 못했어요. 현재 쟁반을 확인한 뒤 다시 눌러 주세요.'; controls(); }, 6000) };
    controls();
  }
  form.addEventListener('change', () => { message.textContent = ''; render(); });
  modes.forEach(button => button.onclick = () => {
    const choice = selected(), mode = button.dataset.mode;
    for (const input of radios) input.checked = input.name === 'drink' ? input.value === (mode === 'snack' ? 'none' : choice?.drink ?? 'coffee') : input.value === (mode === 'drink' ? 'none' : choice?.snack ?? 'cookie');
    message.textContent = ''; render();
  });
  form.addEventListener('submit', event => { event.preventDefault(); const choice = selected(); if (choice) request(choice); else { message.textContent = '음료나 간식을 하나 이상 골라 주세요.'; controls(); } });
  returnButton.onclick = () => request(null);
  done.onclick = () => dialog.close();
  dialog.querySelector<HTMLButtonElement>('.rf-close')!.onclick = () => dialog.close();
  render();
  return {
    open() {
      if (disposed) return;
      options.beforeOpen();
      document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(other => { if (other !== dialog) other.close(); });
      if (!connected) message.textContent = '사무실에 입장한 뒤 창가 카운터를 이용해 주세요.';
      else if (!pending) message.textContent = '';
      render(); if (!dialog.open) dialog.showModal(); dialog.querySelector<HTMLButtonElement>('.rf-close')!.focus({ preventScroll: true });
    },
    setSession(value: boolean) { connected = value; if (!value) { clearPending(); message.textContent = '사무실 연결을 확인하고 있어요.'; } controls(); },
    setCurrent(value: unknown) { if (value === null || isRefreshmentSelection(value)) { held = value; render(); } },
    receive(requestId: unknown, value: unknown) {
      if (value !== null && !isRefreshmentSelection(value)) return;
      held = value;
      if (pending?.id === requestId) { clearPending(); cooldownUntil = options.now() + REFRESHMENT_RULES.cooldownMs; message.textContent = value ? `${label(value)} 가져왔어요. 들고 나가 소파에서 쉬어가세요.` : '쟁반을 반납했어요. 새 메뉴를 골라 보세요.'; }
      render();
    },
    error(requestId: unknown, text: string, retryAt?: number): boolean {
      if (!pending || pending.id !== requestId) return false;
      clearPending(); if (typeof retryAt === 'number' && Number.isFinite(retryAt)) cooldownUntil = retryAt;
      message.textContent = text; controls(); return true;
    },
    tick() { if (!disposed && dialog.open) controls(); },
    reset() { clearPending(); connected = false; held = null; cooldownUntil = 0; form.reset(); message.textContent = ''; if (dialog.open) dialog.close(); render(); },
    dispose() { if (disposed) return; disposed = true; clearPending(); dialog.remove(); },
  };
}
