import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { GoogleOAuth, type GoogleAuthEnv } from '../server/google-auth';

const clientId = '1234567890-ownerfixture.apps.googleusercontent.com';
const config: GoogleAuthEnv = { ADMIN_AUTH_MODE: 'google', GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'local-fixture-client-secret-only', ADMIN_OWNER_EMAIL: 'owner@example.com', ADMIN_BASE_URL: 'https://office-fixture.test' };
const state = 's'.repeat(64), nonce = 'n'.repeat(64), verifier = 'v'.repeat(64);
const pair = await generateKeyPair('RS256'), resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'fixture-key', alg: 'RS256' }] });
async function token(changes: Partial<JWTPayload> = {}, omit: string[] = []) {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = { iss: 'https://accounts.google.com', aud: clientId, iat: now - 10, exp: now + 3600, sub: '112233445566', email: 'owner@example.com', email_verified: true, nonce, ...changes };
  for (const claim of omit) delete payload[claim];
  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' }).sign(pair.privateKey);
}
const jsonResponse = (idToken: string) => Response.json({ id_token: idToken, access_token: 'unused-google-api-token', expires_in: 3599 });

test('Google configuration is explicit, canonical and fails closed on unknown modes', () => {
  const oauth = new GoogleOAuth(() => config, resolver);
  assert.equal(oauth.mode(), 'google');
  assert.equal(oauth.config()!.redirectUri, 'https://office-fixture.test/api/admin/oauth/callback');
  for (const patch of [{ ADMIN_AUTH_MODE: 'typo' }, { GOOGLE_CLIENT_ID: 'bad' }, { GOOGLE_CLIENT_SECRET: '' }, { ADMIN_OWNER_EMAIL: 'bad' },
    { ADMIN_BASE_URL: 'http://office-fixture.test' }, { ADMIN_BASE_URL: 'https://office-fixture.test/' }, { ADMIN_BASE_URL: 'https://office-fixture.test/path' },
    { ADMIN_BASE_URL: 'https://office-fixture.test?x=1' }, { ADMIN_BASE_URL: 'https://office-fixture.test#x' }, { ADMIN_BASE_URL: 'https://user:password@office-fixture.test' }, { ADMIN_BASE_URL: 'https://office-fixture.test:443' }]) {
    assert.equal(new GoogleOAuth(() => ({ ...config, ...patch })).config(), null);
  }
  assert.equal(new GoogleOAuth(() => ({})).mode(), 'password');
  assert.equal(new GoogleOAuth(() => ({ ADMIN_AUTH_MODE: 'typo' })).mode(), 'google');
});

test('Google authorization uses only identity scopes with state, nonce and S256 PKCE', async () => {
  const oauth = new GoogleOAuth(() => config, resolver);
  const url = new URL((await oauth.authorize({ state, nonce, verifier }))!);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'openid email');
  assert.equal(url.searchParams.get('state'), state); assert.equal(url.searchParams.get('nonce'), nonce);
  assert.equal(url.searchParams.get('access_type'), 'online'); assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), oauth.config()!.redirectUri);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url'));
  assert.equal(url.href.includes(config.GOOGLE_CLIENT_SECRET!), false);
  assert.equal(await oauth.authorize({ state: '', nonce, verifier }), null);
  assert.equal(await oauth.authorize({ state, nonce, verifier: 'short' }), null);
});

test('Google exchange verifies identity and sends credentials only to the fixed token endpoint', async () => {
  const signed = await token(); let calls = 0;
  const oauth = new GoogleOAuth(() => config, resolver, async (input, init) => {
    calls++; assert.equal(String(input), 'https://oauth2.googleapis.com/token');
    assert.equal(init!.method, 'POST'); assert.equal(init!.redirect, 'manual');
    const body = new URLSearchParams(init!.body as string);
    assert.equal(body.get('client_id'), clientId); assert.equal(body.get('client_secret'), config.GOOGLE_CLIENT_SECRET);
    assert.equal(body.get('code_verifier'), verifier); assert.equal(body.get('code'), 'local-code');
    assert.equal(body.get('redirect_uri'), 'https://office-fixture.test/api/admin/oauth/callback');
    assert.equal(body.get('grant_type'), 'authorization_code');
    return jsonResponse(signed);
  });
  assert.deepEqual(await oauth.exchange('local-code', verifier, nonce), { email: 'owner@example.com', subject: '112233445566' });
  assert.equal(calls, 1);
  assert.equal(await oauth.exchange('', verifier, nonce), null);
  assert.equal(await oauth.exchange('code', 'short', nonce), null);
  assert.equal(calls, 1);
});

test('Google rejects wrong owner, signature, issuer, audience, nonce, unverified email and invalid dates', async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases: Partial<JWTPayload>[] = [
    { email: 'stranger@example.com' }, { email_verified: false }, { email_verified: 'true' }, { nonce: 'other' },
    { iss: 'https://other-fixture.test' }, { aud: 'other-client' }, { aud: [clientId, 'other-client'] },
    { aud: [clientId, 'other-client'], azp: 'other-client' }, { azp: 'other-client' },
    { exp: now - 1 }, { nbf: now + 100 }, { iat: now + 100 }, { iat: -1 }, { iat: now + 0.5 },
    { sub: '' }, { sub: 'contains space' },
  ];
  for (const claims of cases) {
    const signed = await token(claims);
    assert.equal(await new GoogleOAuth(() => config, resolver, async () => jsonResponse(signed)).exchange('code', verifier, nonce), null, JSON.stringify(claims));
  }
  for (const omitted of ['exp', 'iat', 'sub', 'email', 'email_verified', 'iss', 'aud', 'nonce']) {
    const signed = await token({}, [omitted]);
    assert.equal(await new GoogleOAuth(() => config, resolver, async () => jsonResponse(signed)).exchange('code', verifier, nonce), null, omitted);
  }
  const signed = await token();
  const parts = signed.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()), sub: 'tampered' })).toString('base64url');
  assert.equal(await new GoogleOAuth(() => config, resolver, async () => jsonResponse(parts.join('.'))).exchange('code', verifier, nonce), null);
  const validMultiple = await token({ iss: 'accounts.google.com', aud: [clientId, 'other-client'], azp: clientId, email: 'OWNER@example.com' });
  assert.deepEqual(await new GoogleOAuth(() => config, resolver, async () => jsonResponse(validMultiple)).exchange('code', verifier, nonce), { email: 'owner@example.com', subject: '112233445566' });
});

test('Google rejects redirects, oversized/malformed responses and config rotation during exchange', async () => {
  let calls = 0, cancelled = false;
  const redirect = new GoogleOAuth(() => config, resolver, async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://untrusted-fixture.test/collect' } }); });
  assert.equal(await redirect.exchange('code', verifier, nonce), null); assert.equal(calls, 1);
  const huge = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(40_000)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  assert.equal(await new GoogleOAuth(() => config, resolver, async () => new Response(huge, { headers: { 'Content-Type': 'application/json' } })).exchange('code', verifier, nonce), null);
  assert.equal(cancelled, true);
  for (const response of [new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('{', { headers: { 'Content-Type': 'application/json' } }), Response.json([]), Response.json({ id_token: 'x'.repeat(20_000) })]) {
    assert.equal(await new GoogleOAuth(() => config, resolver, async () => response).exchange('code', verifier, nonce), null);
  }
  let current = { ...config };
  const signed = await token();
  const rotated = new GoogleOAuth(() => current, resolver, async () => { current = { ...current, ADMIN_OWNER_EMAIL: 'replacement@example.com' }; return jsonResponse(signed); });
  assert.equal(await rotated.exchange('code', verifier, nonce), null);
});
