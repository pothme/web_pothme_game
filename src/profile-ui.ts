import { stockProfileFromFields, validateStockProfile, type StockProfile } from '../shared/stock-profile';
import './profile-ui.css';

const STORAGE_KEY = 'podeumgo.stock-profile.v1';
export function mountStockProfileFields(form: HTMLFormElement) {
  const details = document.createElement('details');
  details.className = 'stock-profile-fields';
  details.innerHTML = `<summary>종목 · 평단 표시 <span>선택</span></summary><p>입력하면 캐릭터 닉네임 위에 모두에게 보여요.<br>두 칸을 비워두면 표시하지 않아요.</p><label for="profile-stock">표시할 종목</label><input id="profile-stock" name="stock" placeholder="예: 삼성전자, SOXL" maxlength="20" autocomplete="off"><div class="stock-profile-price"><div><label for="profile-average">내 평단</label><input id="profile-average" name="average" placeholder="예: 70,000" inputmode="decimal" autocomplete="off" maxlength="22"></div><div><label for="profile-currency">통화</label><select id="profile-currency" name="currency"><option value="KRW">원 (₩)</option><option value="USD">달러 ($)</option></select></div></div>`;
  form.insertBefore(details, form.querySelector('button[type="submit"]'));
  const stock = details.querySelector<HTMLInputElement>('#profile-stock')!;
  const average = details.querySelector<HTMLInputElement>('#profile-average')!;
  const currency = details.querySelector<HTMLSelectElement>('#profile-currency')!;
  function restoreInput(profile: StockProfile | null) {
    stock.value = profile?.stock ?? ''; average.value = profile ? String(profile.average) : ''; currency.value = profile?.currency ?? 'KRW';
    details.open = !!profile;
  }
  try { restoreInput(validateStockProfile(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))); } catch { /* Optional invalid/unavailable storage is ignored. */ }
  return {
    read: () => stockProfileFromFields(stock.value, average.value, currency.value),
    restoreInput,
    save(profile: StockProfile | null) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* Storage is optional. */ } },
  };
}
