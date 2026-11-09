import type { GoogleOAuth } from './google-auth';

const COOKIE = 'podeumgo_admin';
const OAUTH_COOKIE = 'podeumgo_google_oauth';
const SESSION_MS = 8 * 60 * 60 * 1000;
const OAUTH_MS = 5 * 60 * 1000;
interface Session { hash: string; csrf: string; expiresAt: number; secretHash: string; authMode?: 'google'; email?: string; subject?: string }
interface GoogleFlow { stateHash: string; browserHash: string; verifier: string; nonce: string; configHash: string; expiresAt: number; generation: number }
interface GoogleOwner { email: string; subject: string }
interface Window { count: number; until: number }
export interface AdminSecurity { sessions: Session[]; global: Window; ips: Record<string, Window>; googleFlows?: GoogleFlow[]; googleOwner?: GoogleOwner; googleGeneration?: number }
export const initialAdmin = (): AdminSecurity => ({ sessions: [], global: { count: 0, until: 0 }, ips: {} });
export const adminJson = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export const adminError = (code: string, message: string, status: number, retryAt?: number) => adminJson({ ok: false, code, message, ...(retryAt ? { retryAt } : {}) }, status);
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, '0')).join('');
async function hash(value: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, '0')).join(''); }
function equal(a: string, b: string): boolean { let difference = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return difference === 0; }
function cookie(request: Request, name = COOKIE): string { return (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? ''; }
function cookieHeader(token: string, age: number): string { return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${age}`; }
function oauthCookie(token: string, age: number): string { return `${OAUTH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/admin/oauth; Max-Age=${age}`; }
function oauthRedirect(result?: 'denied' | 'cancelled' | 'expired' | 'unavailable', clear = true): Response {
  return new Response(null, { status: 303, headers: { Location: result ? `/admin?auth=${result}` : '/admin', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(clear ? { 'Set-Cookie': oauthCookie('', 0) } : {}) } });
}
async function limitedBody(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get('Content-Length') ?? 0) > maxBytes) throw new Error('Body too large');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
}

/** Bounded persistent security state. Passwords, bearer tokens and login codes are never stored. */
export class AdminAuth {
  constructor(private read: () => AdminSecurity, private save: (state: AdminSecurity) => void, private password: () => string | undefined, private google?: Pick<GoogleOAuth, 'mode' | 'config' | 'authorize' | 'exchange'>) {}

  private mode(): 'google' | 'password' { return this.google?.mode() ?? 'password'; }
  private async attempt(request: Request): Promise<Response | null> {
    const now = Date.now(), ip = await hash(request.headers.get('CF-Connecting-IP') ?? 'local'), current = this.read();
    const global = current.global.until > now ? current.global : { count: 0, until: now + 60_000 };
    const local = current.ips[ip]?.until > now ? current.ips[ip]! : { count: 0, until: now + 60_000 };
    if (global.count >= 30 || local.count >= 5) return adminError('LOGIN_LIMIT', '로그인 시도가 많아요. 잠시 후 다시 시도해 주세요.', 429, Math.max(global.count >= 30 ? global.until : 0, local.count >= 5 ? local.until : 0));
    this.save({ ...current, global: { ...global, count: global.count + 1 }, ips: { ...Object.fromEntries(Object.entries(current.ips).filter(([, value]) => value.until > now).slice(-63)), [ip]: { ...local, count: local.count + 1 } } });
    return null;
  }

  private async startGoogle(request: Request): Promise<Response> {
    const configured = this.google?.config();
    if (!configured || new URL(request.url).origin !== configured.baseUrl) return oauthRedirect('unavailable');
    const limited = await this.attempt(request); if (limited) return limited;
    const state = randomToken(), browser = randomToken(), verifier = randomToken(), nonce = randomToken(), now = Date.now(), generation = this.read().googleGeneration ?? 0;
    const [stateHash, browserHash, configHash, location] = await Promise.all([hash(state), hash(browser), hash(configured.fingerprintInput), this.google!.authorize({ state, verifier, nonce })]);
    if (!location || this.google?.config()?.fingerprintInput !== configured.fingerprintInput || generation !== (this.read().googleGeneration ?? 0)) return oauthRedirect('unavailable');
    const flow: GoogleFlow = { stateHash, browserHash, verifier, nonce, configHash, expiresAt: now + OAUTH_MS, generation };
    this.save({ ...this.read(), googleFlows: [...(this.read().googleFlows ?? []).filter(item => item.expiresAt > now).slice(-15), flow] });
    return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': oauthCookie(browser, OAUTH_MS / 1000) } });
  }

  private async finishGoogle(request: Request): Promise<Response> {
    const url = new URL(request.url), configured = this.google?.config(), state = url.searchParams.get('state') ?? '', browser = cookie(request, OAUTH_COOKIE);
    if (!configured || url.origin !== configured.baseUrl) return oauthRedirect('unavailable');
    if (url.searchParams.getAll('state').length !== 1 || !/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(browser)) return oauthRedirect('expired', false);
    const [stateHash, browserHash, configHash] = await Promise.all([hash(state), hash(browser), hash(configured.fingerprintInput)]), now = Date.now();
    const current = this.read(), flow = current.googleFlows?.find(item => equal(item.stateHash, stateHash) && equal(item.browserHash, browserHash));
    if (!flow) return oauthRedirect('expired', false);
    // Single-use before awaiting the token endpoint, so parallel callbacks cannot
    // exchange the same code or race the first successful owner's subject pin.
    this.save({ ...current, googleFlows: (current.googleFlows ?? []).filter(item => item !== flow && item.expiresAt > now) });
    if (flow.expiresAt <= now || flow.configHash !== configHash || flow.generation !== (current.googleGeneration ?? 0)) return oauthRedirect('expired');
    if (url.searchParams.has('error')) return oauthRedirect(url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'denied');
    const code = url.searchParams.get('code') ?? '';
    if (url.searchParams.getAll('code').length !== 1 || !code || code.length > 4096) return oauthRedirect('denied');
    const identity = await this.google!.exchange(code, flow.verifier, flow.nonce);
    if (!identity || identity.email !== configured.ownerEmail || !identity.subject) return oauthRedirect('denied');
    const token = randomToken(), csrf = randomToken(), [digest, freshHash] = await Promise.all([hash(token), hash(this.google?.config()?.fingerprintInput ?? '')]);
    const latest = this.read(), pin = latest.googleOwner;
    if (flow.expiresAt <= Date.now() || freshHash !== flow.configHash || this.mode() !== 'google' || flow.generation !== (latest.googleGeneration ?? 0)) return oauthRedirect('expired');
    if (pin && (pin.email !== identity.email || pin.subject !== identity.subject)) return oauthRedirect('denied');
    const session: Session = { hash: digest, csrf, expiresAt: Date.now() + SESSION_MS, secretHash: freshHash, authMode: 'google', email: identity.email, subject: identity.subject };
    this.save({ ...latest, googleOwner: pin ?? { email: identity.email, subject: identity.subject }, sessions: [...latest.sessions.filter(item => item.authMode === 'google' && item.expiresAt > Date.now()).slice(-7), session] });
    const response = oauthRedirect(); response.headers.append('Set-Cookie', cookieHeader(token, SESSION_MS / 1000)); return response;
  }

  async authenticate(request: Request): Promise<Session | null> {
    if (this.mode() === 'google') {
      const configured = this.google?.config(), token = cookie(request);
      if (!configured || new URL(request.url).origin !== configured.baseUrl || !/^[a-f0-9]{64}$/.test(token)) return null;
      const [digest, configHash] = await Promise.all([hash(token), hash(configured.fingerprintInput)]), pin = this.read().googleOwner;
      if (!pin || pin.email !== configured.ownerEmail || this.google?.config()?.fingerprintInput !== configured.fingerprintInput) return null;
      return this.read().sessions.find(session => session.authMode === 'google' && session.expiresAt > Date.now()
        && session.email === pin.email && session.subject === pin.subject && session.secretHash === configHash && equal(session.hash, digest)) ?? null;
    }
    const secret = this.password();
    if (!secret || secret.length < 24) return null;
    const token = cookie(request);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const [digest, secretHash] = await Promise.all([hash(token), hash(secret)]);
    return this.read().sessions.find((session) => !session.authMode && session.expiresAt > Date.now() && session.secretHash === secretHash && equal(session.hash, digest)) ?? null;
  }

  async route(request: Request, control: (action: 'open' | 'close') => Promise<Response>, state: () => Response, manage?: (input: Record<string, unknown>, reauthorize: () => Promise<boolean>) => Promise<Response>, community?: (request: Request) => Response, usage?: () => Promise<unknown>): Promise<Response> {
    const path = new URL(request.url).pathname;
    const isPost = request.method === 'POST';
    // Google's top-level callback is cross-site by design. Its short-lived state
    // and HttpOnly browser-binding cookie replace Origin checks on this one GET.
    if (path === '/api/admin/oauth/callback' && request.method === 'GET' && this.mode() === 'google') return this.finishGoogle(request);
    if (isPost && (request.headers.get('Origin') !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')) return adminError('ORIGIN', '같은 사이트에서 요청해 주세요.', 403);
    if (!isPost && (request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin)) return adminError('ORIGIN', '같은 사이트에서 요청해 주세요.', 403);
    const authMode = this.mode();
    if (path === '/api/admin/oauth/start' && request.method === 'GET' && authMode === 'google') return this.startGoogle(request);
    if (path === '/api/admin/login' && isPost) {
      if (authMode === 'google') return adminJson({ ok: false, code: 'ACCOUNT_LOGIN_REQUIRED', authMode, message: '본인 Google 계정으로 로그인해 주세요.', loginUrl: '/api/admin/oauth/start' }, 403);
      const secret = this.password();
      if (!secret || secret.length < 24) return adminError('ADMIN_UNAVAILABLE', '관리자 비밀번호가 설정되지 않았어요.', 503);
      const now = Date.now(), limited = await this.attempt(request); if (limited) return limited;
      if (!request.headers.get('Content-Type')?.startsWith('application/json') || Number(request.headers.get('Content-Length') ?? 0) > 2048) return adminError('INVALID', '로그인 요청을 확인해 주세요.', 400);
      let supplied: unknown;
      try { supplied = (JSON.parse(await limitedBody(request, 2048)) as { password?: unknown }).password; } catch { return adminError('INVALID', '로그인 요청을 확인해 주세요.', 400); }
      const secretHash = await hash(secret);
      if (typeof supplied !== 'string' || !equal(await hash(supplied), secretHash)) return adminError('LOGIN_FAILED', '비밀번호가 올바르지 않아요.', 401);
      const token = randomToken(), csrf = randomToken();
      const session = { hash: await hash(token), csrf, expiresAt: now + SESSION_MS, secretHash };
      this.save({ ...this.read(), sessions: [...this.read().sessions.filter((item) => item.expiresAt > now).slice(-7), session] });
      return adminJson({ ok: true, authenticated: true, authMode, csrfToken: csrf }, 200, { 'Set-Cookie': cookieHeader(token, SESSION_MS / 1000) });
    }
    const session = await this.authenticate(request);
    if (path === '/api/admin/session' && request.method === 'GET') return adminJson({ authenticated: Boolean(session), authMode, ...(session ? { csrfToken: session.csrf, ...(session.email ? { email: session.email } : {}) } : authMode === 'google' ? { loginUrl: '/api/admin/oauth/start' } : {}) });
    if (!session) return adminJson({ ok: false, code: 'ADMIN_AUTH', authMode, message: authMode === 'google' ? '본인 Google 계정으로 로그인해 주세요.' : '관리자 로그인이 필요해요.' }, 401);
    if (path === '/api/admin/state' && request.method === 'GET') return state();
    if (path === '/api/admin/community' && request.method === 'GET' && community) return community(request);
    if (path === '/api/admin/usage' && request.method === 'GET' && usage) {
      const result = await usage();
      // Analytics can take a few seconds; a logout must invalidate an in-flight read.
      if ((await this.authenticate(request))?.hash !== session.hash) return adminError('ADMIN_AUTH', '관리자 로그인이 필요해요.', 401);
      return adminJson(result);
    }
    if (isPost && !equal(request.headers.get('X-CSRF-Token') ?? '', session.csrf)) return adminError('CSRF', '인증 정보를 새로 확인해 주세요.', 403);
    if (path === '/api/admin/logout' && isPost) {
      this.save({ ...this.read(), sessions: this.read().sessions.filter((item) => item.hash !== session.hash), ...(authMode === 'google' ? { googleFlows: [], googleGeneration: (this.read().googleGeneration ?? 0) + 1 } : {}) });
      return adminJson({ ok: true, authenticated: false, authMode }, 200, { 'Set-Cookie': cookieHeader('', 0) });
    }
    if (path === '/api/admin/control' && isPost) {
      try {
        const text = await limitedBody(request, 256);
        const { action } = JSON.parse(text) as { action?: unknown };
        if (action !== 'open' && action !== 'close') throw new Error();
        // Logout may interleave while JSON is read. Recheck the exact session before mutation.
        if ((await this.authenticate(request))?.hash !== session.hash) return adminError('ADMIN_AUTH', '관리자 로그인이 필요해요.', 401);
        return control(action);
      } catch { return adminError('INVALID', '열기 또는 닫기를 선택해 주세요.', 400); }
    }
    if (path === '/api/admin/manage' && isPost && manage) {
      let input: Record<string, unknown>;
      try {
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error();
        const value: unknown = JSON.parse(await limitedBody(request, 4096));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        input = value as Record<string, unknown>;
      } catch { return adminError('INVALID', '관리 요청 내용을 확인해 주세요.', 400); }
      const reauthorize = async () => (await this.authenticate(request))?.hash === session.hash;
      if (!await reauthorize()) return adminError('ADMIN_AUTH', '관리자 로그인이 필요해요.', 401);
      // The handler also rechecks after any asynchronous catalog lookup.
      return manage(input, reauthorize);
    }
    return adminError('NOT_FOUND', '요청 경로를 확인해 주세요.', 404);
  }
}
