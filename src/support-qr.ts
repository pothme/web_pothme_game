import QRCode from 'qrcode';
import { normalizeKakaoPayUrl } from '../shared/support-link';

let cached: { url: string; image: Promise<string> } | undefined;

/** Encode the operator's exact link locally; no third-party QR service. */
export function createSupportQr(value: string): Promise<string> {
  const url = normalizeKakaoPayUrl(value);
  if (!url) return Promise.reject(new Error('카카오페이 송금 링크를 확인해 주세요.'));
  if (cached?.url === url) return cached.image;
  const image = QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, scale: 8, color: { dark: '#000000ff', light: '#ffffffff' } });
  cached = { url, image };
  void image.catch(() => { if (cached?.image === image) cached = undefined; });
  return image;
}
