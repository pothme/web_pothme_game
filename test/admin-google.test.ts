import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminAuth, initialAdmin } from '../server/admin';
import type { GoogleOAuth, GoogleAuthEnv, GoogleIdentity } from '../server/google-auth';
import { GoogleOAuth as RealGoogleOAuth } from '../server/google-auth';

const origin = 'https://admin-fixture.test', owner = 'owner@example.com';
const configured: GoogleAuthEnv = { ADMIN_AUTH_MODE: 'google', GOOGLE_CLIENT_ID: '123-localfixture.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fixture-secret-at-least-16-characters', ADMIN_OWNER_EMAIL: owner, ADMIN_BASE_URL: origin };
type Message = Record<string, any>;
function request(path: string, cookie = '', body?: BodyInit, csrf = '') {
  return new Request(`${origin}/api/admin/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body, duplex: 'half' }) } as RequestInit);
}
function fixture() {
  let security = initialAdmin(), env = { ...configured }, identity: GoogleIdentity | null = { email: owner, subject: 'owner-subject' }, exchanges = 0, mutations = 0;
  const real = new RealGoogleOAuth(() => env);
  let exchange = async (_code: string, verifier: string, nonce: string) => { exchanges++; assert.match(verifier, /^[a-f0-9]{64}$/); assert.match(nonce, /^[a-f0-9]{64}$/); return identity; };
  const google: Pick<GoogleOAuth, 'mode' | 'config' | 'authorize' | 'exchange'> = { mode: () => real.mode(), config: () => real.config(), authorize: input => real.authorize(input), exchange: (...args) => exchange(...args) };
  const auth = new AdminAuth(() => security, next => { security = next; }, () => 'local-password-at-least-24-characters', google);
  const state = () => Response.json({ ok: true }), control = async () => { mutations++; return state(); };
  const route = (req: Request) => auth.route(req, control, state);
  const start = async (ip = 'local') => {
    const req = request('oauth/start'); req.headers.set('CF-Connecting-IP', ip);
    const response = await route(req); assert.equal(response.status, 303);
    const url = new URL(response.headers.get('Location')!), cookie = response.headers.get('Set-Cookie')!.split(';')[0]!;
    return { response, url, cookie, state: url.searchParams.get('state')! };
  };
  const callback = (flow: Awaited<ReturnType<typeof start>>, extra = 'code=local-code', cookie = flow.cookie) => new Request(`${origin}/api/admin/oauth/callback?state=${flow.state}&${extra}`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
  return { auth, route, state, control, start, callback, security: () => security, setEnv: (next: GoogleAuthEnv) => { env = next; }, setIdentity: (next: GoogleIdentity | null) => { identity = next; }, setExchange: (next: typeof exchange) => { exchange = next; }, exchanges: () => exchanges, mutations: () => mutations };
}

test('Google login uses bound short-lived one-use state and PKCE, pins owner, preserves CSRF and logout', async () => {
  const f = fixture(), flow = await f.start();
  assert.equal(flow.url.origin, 'https://accounts.google.com');
  assert.equal(flow.url.searchParams.get('redirect_uri'), `${origin}/api/admin/oauth/callback`);
  assert.equal(flow.url.searchParams.get('scope'), 'openid email');
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(flow.response.headers.get('Set-Cookie')!, /HttpOnly; Secure; SameSite=Lax; Path=\/api\/admin\/oauth; Max-Age=300/);
  assert.equal(JSON.stringify(f.security()).includes(flow.state), false);
  assert.equal(JSON.stringify(f.security()).includes(flow.cookie.split('=')[1]!), false);
  const forged = await f.route(f.callback(flow, 'code=local-code', `podeumgo_google_oauth=${'0'.repeat(64)}`));
  assert.equal(forged.headers.get('Location'), '/admin?auth=expired'); assert.equal(f.exchanges(), 0);
  const logged = await f.route(f.callback(flow));
  assert.equal(logged.headers.get('Location'), '/admin'); assert.equal(f.exchanges(), 1);
  const cookie = logged.headers.get('Set-Cookie')!.match(/podeumgo_admin=[a-f0-9]{64}/)![0];
  assert.deepEqual(f.security().googleOwner, { email: owner, subject: 'owner-subject' });
  assert.equal((await f.route(f.callback(flow))).headers.get('Location'), '/admin?auth=expired'); assert.equal(f.exchanges(), 1);
  const session = await f.route(request('session', cookie)).then(r => r.json()) as Message;
  assert.equal(session.authMode, 'google'); assert.equal(session.authenticated, true); assert.equal(session.email, owner);
  assert.equal((await f.route(request('state', cookie))).status, 200);
  assert.equal((await f.route(request('control', cookie, '{"action":"close"}'))).status, 403);
  assert.equal(f.mutations(), 0);
  assert.equal((await f.route(request('control', cookie, '{"action":"close"}', session.csrfToken))).status, 200);
  assert.equal(f.mutations(), 1);
  const changed = await f.start(); f.setIdentity({ email: owner, subject: 'different-google-account' });
  assert.equal((await f.route(f.callback(changed))).headers.get('Location'), '/admin?auth=denied');
  assert.equal(f.security().googleOwner!.subject, 'owner-subject');
  assert.equal((await f.route(request('logout', cookie, '{}', session.csrfToken))).status, 200);
  assert.equal((await f.route(request('state', cookie))).status, 401);
});

test('Google state expiration, cancellation, hostile callbacks, and password fallback are rejected', async () => {
  const f = fixture();
  f.setEnv({});
  const old = await f.route(request('login', '', '{"password":"local-password-at-least-24-characters"}'));
  const oldCookie = old.headers.get('Set-Cookie')!.split(';')[0]!;
  f.setEnv({ ...configured });
  assert.equal((await f.route(request('state', oldCookie))).status, 401);
  assert.equal((await f.route(request('login', '', '{"password":"local-password-at-least-24-characters"}'))).status, 403);
  const flow = await f.start(); f.security().googleFlows![0]!.expiresAt = Date.now() - 1;
  assert.equal((await f.route(f.callback(flow))).headers.get('Location'), '/admin?auth=expired'); assert.equal(f.exchanges(), 0);
  const cancelled = await f.start();
  assert.equal((await f.route(f.callback(cancelled, 'error=access_denied&error_description=untrusted'))).headers.get('Location'), '/admin?auth=cancelled');
  assert.equal(f.exchanges(), 0);
  const duplicate = await f.start();
  assert.equal((await f.route(f.callback(duplicate, `state=${duplicate.state}&code=local-code`))).headers.get('Location'), '/admin?auth=expired');
  const crossSiteStart = request('oauth/start'); crossSiteStart.headers.set('Sec-Fetch-Site', 'cross-site');
  assert.equal((await f.route(crossSiteStart)).status, 403);
  f.setEnv({ ...configured, GOOGLE_CLIENT_SECRET: undefined });
  assert.equal((await f.route(request('oauth/start'))).headers.get('Location'), '/admin?auth=unavailable');
  assert.equal((await f.route(request('session')).then(r => r.json()) as Message).authMode, 'google');
});

test('Google flow storage and login attempts remain bounded', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.start(`fixture-ip-${i}`);
  assert.equal(f.security().googleFlows!.length, 16);
  const g = fixture();
  for (let i = 0; i < 5; i++) await g.start();
  assert.equal((await g.route(request('oauth/start'))).status, 429);
  assert.equal(g.security().googleFlows!.length, 5);
});

test('pending Google callback cannot recreate a session after logout or overwrite a competing owner pin', async () => {
  const f = fixture(), first = await f.start(), logged = await f.route(f.callback(first));
  const cookie = logged.headers.get('Set-Cookie')!.match(/podeumgo_admin=[a-f0-9]{64}/)![0];
  const session = await f.route(request('session', cookie)).then(r => r.json()) as Message;
  const next = await f.start();
  let begin!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  f.setExchange(async () => { begin(); await waiting; return { email: owner, subject: 'owner-subject' }; });
  const pending = f.route(f.callback(next)); await started;
  assert.equal((await f.route(f.callback(next))).headers.get('Location'), '/admin?auth=expired', 'state consumed before network call');
  await f.route(request('logout', cookie, '{}', session.csrfToken)); release();
  assert.equal((await pending).headers.get('Location'), '/admin?auth=expired');
  assert.equal(f.security().sessions.length, 0);
});

test('Google sessions recheck configuration after slow mutations and in-flight usage logout', async () => {
  const f = fixture(), flow = await f.start(), logged = await f.route(f.callback(flow));
  const cookie = logged.headers.get('Set-Cookie')!.match(/podeumgo_admin=[a-f0-9]{64}/)![0], session = await f.route(request('session', cookie)).then(r => r.json()) as Message;
  let begin!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  const slow = new ReadableStream<Uint8Array>({ async pull(controller) { begin(); await waiting; controller.enqueue(new TextEncoder().encode('{"action":"close"}')); controller.close(); } }, { highWaterMark: 0 });
  const pending = f.route(request('control', cookie, slow, session.csrfToken));
  await started; f.setEnv({ ...configured, GOOGLE_CLIENT_SECRET: 'rotated-fixture-client-secret' }); release();
  assert.equal((await pending).status, 401); assert.equal(f.mutations(), 0);
  f.setEnv({ ...configured });
  let ready!: () => void, finish!: () => void;
  const prepared = new Promise<void>(resolve => { ready = resolve; }), fetching = new Promise<void>(resolve => { finish = resolve; });
  const usage = f.auth.route(request('usage', cookie), f.control, f.state, undefined, undefined, async () => { ready(); await fetching; return { sensitive: true }; });
  await prepared; await f.route(request('logout', cookie, '{}', session.csrfToken)); finish();
  assert.equal((await usage).status, 401);
});
