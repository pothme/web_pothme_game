import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface GoogleAuthEnv {
  ADMIN_AUTH_MODE?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ADMIN_OWNER_EMAIL?: string;
  ADMIN_BASE_URL?: string;
}
export interface GoogleIdentity { email: string; subject: string }
export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  ownerEmail: string;
  baseUrl: string;
  redirectUri: string;
  /** Sensitive: hash before persisting; never log this value. */
  fingerprintInput: string;
}
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const MAX_RESPONSE_BYTES = 32_768;
const opaqueValue = (value: string) => /^[A-Za-z0-9_-]{32,256}$/.test(value);
const validVerifier = (value: string) => /^[A-Za-z0-9._~-]{43,128}$/.test(value);
let googleKeys: JWTVerifyGetKey | undefined;
function keys(): JWTVerifyGetKey {
  return googleKeys ??= createRemoteJWKSet(new URL(CERTS_URL), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 600_000 });
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')
    || Number(response.headers.get('Content-Length') ?? 0) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel(); throw new Error('Invalid token response');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing token response');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Token response too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
}

/** Server-only Google identity authentication; no Google API access is retained. */
export class GoogleOAuth {
  constructor(private env: () => GoogleAuthEnv, private testKeys?: JWTVerifyGetKey, private fetcher: typeof fetch = fetch) {}

  mode(): 'google' | 'password' {
    const mode = this.env().ADMIN_AUTH_MODE;
    return mode === undefined || mode === 'password' ? 'password' : 'google';
  }

  config(): GoogleOAuthConfig | null {
    const env = this.env(), clientId = env.GOOGLE_CLIENT_ID ?? '', clientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
    const ownerEmail = (env.ADMIN_OWNER_EMAIL ?? '').trim().toLowerCase(), baseUrl = env.ADMIN_BASE_URL ?? '';
    if (env.ADMIN_AUTH_MODE !== 'google' || clientId.length > 256 || !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)
      || clientSecret.length < 16 || clientSecret.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(clientSecret)
      || ownerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return null;
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== 'https:' || url.origin !== baseUrl || url.username || url.password || url.port) return null;
    } catch { return null; }
    return { clientId, clientSecret, ownerEmail, baseUrl, redirectUri: `${baseUrl}/api/admin/oauth/callback`, fingerprintInput: JSON.stringify([clientId, clientSecret, ownerEmail, baseUrl]) };
  }

  async authorize(input: { state: string; nonce: string; verifier: string }): Promise<string | null> {
    const current = this.config();
    if (!current || !opaqueValue(input.state) || !opaqueValue(input.nonce) || !validVerifier(input.verifier)) return null;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (this.config()?.fingerprintInput !== current.fingerprintInput) return null;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: current.clientId, redirect_uri: current.redirectUri, response_type: 'code', scope: 'openid email',
      access_type: 'online', prompt: 'select_account', state: input.state, nonce: input.nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return url.href;
  }

  async exchange(code: string, verifier: string, nonce: string): Promise<GoogleIdentity | null> {
    const current = this.config();
    if (!current || !code || code.length > 4096 || /[\u0000-\u0020\u007f]/.test(code) || !validVerifier(verifier) || !opaqueValue(nonce)) return null;
    try {
      // Keep native fetch unbound. Never follow a token-endpoint redirect with credentials.
      const fetcher = this.fetcher;
      const response = await fetcher(TOKEN_URL, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: current.clientId, client_secret: current.clientSecret,
          redirect_uri: current.redirectUri, code, code_verifier: verifier }).toString() });
      if (response.status !== 200) { await response.body?.cancel(); return null; }
      const data = await boundedJson(response);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const token = (data as Record<string, unknown>).id_token;
      if (typeof token !== 'string' || token.length > 16_384 || token.split('.').length !== 3) return null;
      const { payload } = await jwtVerify(token, this.testKeys ?? keys(), {
        algorithms: ['RS256'], issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: current.clientId,
        requiredClaims: ['exp', 'iat', 'sub', 'email', 'email_verified', 'iss', 'aud', 'nonce'], clockTolerance: 0,
      });
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      const audiences = typeof payload.aud === 'string' ? [payload.aud] : payload.aud;
      if (email !== current.ownerEmail || payload.email_verified !== true || payload.nonce !== nonce
        || typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(payload.sub)
        || !Array.isArray(audiences) || !audiences.length || audiences.some(value => typeof value !== 'string')
        || payload.azp !== undefined && payload.azp !== current.clientId || audiences.length > 1 && payload.azp !== current.clientId
        || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) || payload.iat! <= 0
        || payload.iat! > Date.now() / 1000 + 30 || payload.exp! <= payload.iat!
        || this.config()?.fingerprintInput !== current.fingerprintInput) return null;
      return { email, subject: payload.sub };
    } catch { return null; }
  }
}
