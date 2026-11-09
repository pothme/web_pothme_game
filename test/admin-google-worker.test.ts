import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response as LocalResponse, convertV4MiniflareOptions } from 'miniflare';
import { createHash } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

const origin = 'https://google-native-fixture.test', clientId = '123-nativefixture.apps.googleusercontent.com', clientSecret = 'fixture-google-client-secret-at-least-16', owner = 'owner@example.com';
const pair = await generateKeyPair('RS256'), jwk = { ...await exportJWK(pair.publicKey), kid: 'google-native-fixture', use: 'sig', alg: 'RS256' };
const bundle = await build({ stdin: { contents: "export {default, Classroom} from './server/index';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:*'] });
type Message = Record<string, any>;

test('native Google code/PKCE exchange, signed ID token, cross-site callback, owner pin and existing session migration', { timeout: 30_000 }, async () => {
  let tokenCalls = 0, keyCalls = 0, count = 0;
  const codes = new Map<string, { nonce: string; challenge: string; claims: JWTPayload }>();
  const bindings: Record<string, string> = { ADMIN_PASSWORD: 'old-fixture-password-at-least-24', GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, ADMIN_OWNER_EMAIL: owner, ADMIN_BASE_URL: origin };
  const options = { port: 0, host: '127.0.0.1', cf: false, workers: [{
    name: 'google-native-fixture', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-04', bindings,
    durableObjects: { CLASSROOM: { className: 'Classroom', useSQLite: true } }, serviceBindings: { ASSETS: async () => new LocalResponse('public login asset fixture') },
    outboundService: async (request: Request) => {
      if (request.url === 'https://www.googleapis.com/oauth2/v3/certs') { keyCalls++; assert.equal(request.headers.has('Cookie'), false); return new LocalResponse(JSON.stringify({ keys: [jwk] }), { headers: { 'Content-Type': 'application/json' } }); }
      assert.equal(request.url, 'https://oauth2.googleapis.com/token'); tokenCalls++;
      const body = new URLSearchParams(await request.text()), fixture = codes.get(body.get('code')!);
      assert.ok(fixture); assert.equal(body.get('client_id'), clientId); assert.equal(body.get('client_secret'), clientSecret);
      assert.equal(body.get('redirect_uri'), `${origin}/api/admin/oauth/callback`); assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), fixture.challenge);
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({ iss: 'https://accounts.google.com', aud: clientId, sub: 'native-owner-subject', email: owner, email_verified: true, nonce: fixture.nonce, iat: now, exp: now + 3600, ...fixture.claims }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(pair.privateKey);
      return new LocalResponse(JSON.stringify({ id_token: idToken, access_token: 'unused-fixture-access-token', expires_in: 3600 }), { headers: { 'Content-Type': 'application/json' } });
    },
  }] };
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  const get = (path: string, cookie = '', headers: Record<string, string> = {}) => mf.dispatchFetch(`${origin}${path}`, { redirect: 'manual', headers: { ...headers, Cookie: cookie } });
  const post = (path: string, body: unknown, cookie = '', csrf = '') => mf.dispatchFetch(`${origin}${path}`, { redirect: 'manual', method: 'POST', headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const start = async (claims: JWTPayload = {}) => {
    const result = await get('/api/admin/oauth/start', '', { 'CF-Connecting-IP': `fixture-${++count}` }); assert.equal(result.status, 303);
    const authorization = new URL(result.headers.get('Location')!), state = authorization.searchParams.get('state')!, cookie = result.headers.get('Set-Cookie')!.split(';')[0]!, code = `fixture-code-${count}`;
    codes.set(code, { nonce: authorization.searchParams.get('nonce')!, challenge: authorization.searchParams.get('code_challenge')!, claims });
    return { state, cookie, callback: `/api/admin/oauth/callback?state=${state}&code=${code}` };
  };
  try {
    const legacy = await post('/api/admin/login', { password: bindings.ADMIN_PASSWORD });
    const oldCookie = legacy.headers.get('Set-Cookie')!.split(';')[0]!;
    assert.equal((await get('/api/admin/state', oldCookie)).status, 200);
    bindings.ADMIN_AUTH_MODE = 'google'; await mf.setOptions(convertV4MiniflareOptions(options));
    assert.equal((await get('/api/admin/state', oldCookie)).status, 401);
    assert.equal((await post('/api/admin/login', { password: bindings.ADMIN_PASSWORD })).status, 403);
    assert.equal(await get('/').then(r => r.text()), 'public login asset fixture');
    assert.equal(await get('/markets').then(r => r.text()), 'public login asset fixture');
    assert.equal(await get('/admin').then(r => r.text()), 'public login asset fixture');
    assert.equal((await get('/api/status')).status, 200);
    assert.equal((await get('/api/admin/state', '', { 'Cf-Access-Authenticated-User-Email': owner })).status, 401);
    const anonymous = await get('/api/admin/session').then(r => r.json()) as Message;
    assert.deepEqual(anonymous, { authenticated: false, authMode: 'google', loginUrl: '/api/admin/oauth/start' });
    const ownerFlow = await start();
    assert.equal((await get(ownerFlow.callback, `podeumgo_google_oauth=${'0'.repeat(64)}`, { 'Sec-Fetch-Site': 'cross-site' })).headers.get('Location'), '/admin?auth=expired');
    assert.equal(tokenCalls, 0);
    const success = await get(ownerFlow.callback, ownerFlow.cookie, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(success.status, 303); assert.equal(success.headers.get('Location'), '/admin');
    const cookie = success.headers.get('Set-Cookie')!.match(/podeumgo_admin=[a-f0-9]{64}/)![0];
    assert.equal(tokenCalls, 1); assert.equal(keyCalls, 1);
    assert.equal((await get(ownerFlow.callback, ownerFlow.cookie, { 'Sec-Fetch-Site': 'cross-site' })).headers.get('Location'), '/admin?auth=expired'); assert.equal(tokenCalls, 1);
    const session = await get('/api/admin/session', cookie).then(r => r.json()) as Message;
    assert.equal(session.email, owner); assert.equal(session.authenticated, true);
    assert.equal((await get('/api/admin/state', cookie)).status, 200);
    assert.equal((await post('/api/admin/control', { action: 'open' }, cookie)).status, 403);
    assert.equal((await post('/api/admin/control', { action: 'open' }, cookie, session.csrfToken)).status, 200);
    for (const claims of [{ email: 'outsider@example.com' }, { email_verified: false }, { sub: 'different-account-same-email' }, { nonce: 'wrong-nonce' }]) {
      const flow = await start(claims);
      assert.equal((await get(flow.callback, flow.cookie, { 'Sec-Fetch-Site': 'cross-site' })).headers.get('Location'), '/admin?auth=denied');
    }
    assert.equal(keyCalls, 1, 'native jose JWKS fetch is cached');
    assert.equal((await get('/api/admin/oauth/start', '', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await get('/api/admin/state', cookie, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post('/api/admin/logout', {}, cookie, session.csrfToken)).status, 200);
    assert.equal((await get('/api/admin/state', cookie)).status, 401);
  } finally { await mf.dispose(); }
});

test('native Google token endpoint redirects fail closed without sending credentials to another host', { timeout: 30_000 }, async () => {
  let tokenCalls = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ port: 0, host: '127.0.0.1', cf: false, workers: [{
    name: 'google-redirect-fixture', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-04',
    bindings: { ADMIN_AUTH_MODE: 'google', GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, ADMIN_OWNER_EMAIL: owner, ADMIN_BASE_URL: origin },
    durableObjects: { CLASSROOM: { className: 'Classroom', useSQLite: true } }, serviceBindings: { ASSETS: async () => new LocalResponse('static fixture') },
    outboundService: async (request: Request) => { tokenCalls++; assert.equal(request.url, 'https://oauth2.googleapis.com/token'); return new LocalResponse(null, { status: 302, headers: { Location: 'https://untrusted-fixture.invalid/collect' } }); },
  }] }));
  try {
    const start = await mf.dispatchFetch(`${origin}/api/admin/oauth/start`, { redirect: 'manual' });
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!, cookie = start.headers.get('Set-Cookie')!.split(';')[0]!;
    const rejected = await mf.dispatchFetch(`${origin}/api/admin/oauth/callback?state=${state}&code=local-code`, { redirect: 'manual', headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(rejected.headers.get('Location'), '/admin?auth=denied'); assert.equal(tokenCalls, 1);
  } finally { await mf.dispose(); }
});
