export interface StockProfile { stock: string; average: number; currency: 'KRW' | 'USD' }
export const STOCK_PROFILE_LIMITS = Object.freeze({ stockLength: 20, maxAverage: 1_000_000_000_000, decimals: 6 });

/** This is a visitor's optional public label, never a broker position or quote. */
export function validateStockProfile(value: unknown): StockProfile | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('종목과 평단을 확인해 주세요.');
  const profile = value as Partial<StockProfile>;
  const stock = typeof profile.stock === 'string' ? profile.stock.normalize('NFC').trim() : '';
  if (!stock || [...stock].length > STOCK_PROFILE_LIMITS.stockLength || /[\p{C}<>]/u.test(stock)) throw new Error('표시할 종목은 줄바꿈 없이 1~20자로 입력해 주세요.');
  if (typeof profile.average !== 'number' || !Number.isFinite(profile.average) || profile.average <= 0 || profile.average > STOCK_PROFILE_LIMITS.maxAverage) throw new Error('평단은 0보다 큰 금액으로 입력해 주세요.');
  const average = Math.round(profile.average * 1e6) / 1e6;
  if (average <= 0 || Math.abs(average - profile.average) > Number.EPSILON * Math.max(1, profile.average) * 2) throw new Error('평단은 소수점 여섯 자리까지 입력해 주세요.');
  if (profile.currency !== 'KRW' && profile.currency !== 'USD') throw new Error('평단의 통화를 선택해 주세요.');
  return { stock, average, currency: profile.currency };
}

export function stockProfileFromFields(stock: string, average: string, currency: string): StockProfile | null {
  const name = stock.trim(), price = average.trim();
  if (!name && !price) return null;
  if (!name || !price) throw new Error('표시하려면 종목과 평단을 함께 입력해 주세요. 비워두면 표시하지 않아요.');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(price)) throw new Error('평단은 숫자와 소수점으로 입력해 주세요.');
  return validateStockProfile({ stock: name, average: Number(price.replaceAll(',', '')), currency });
}

export function formatStockProfile(profile: StockProfile): string {
  const amount = profile.average.toLocaleString('ko-KR', { maximumFractionDigits: 6, minimumFractionDigits: profile.currency === 'USD' ? 2 : 0 });
  return `${profile.stock} · 평단 ${profile.currency === 'USD' ? `$${amount}` : `${amount}원`}`;
}

/** Explicit null clears a saved label; omitted parameter preserves older clients. */
export function appendStockProfileParams(params: URLSearchParams, profile: StockProfile | null): void {
  params.set('profile', JSON.stringify(validateStockProfile(profile)));
}
