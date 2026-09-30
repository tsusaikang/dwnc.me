import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { clearAccessKeyCacheForTests, verifyAccessIdentity } from '../src/lib/access-auth.ts';
import { handlePublicAuth, safePublicLoginReturn } from '../src/lib/public-auth.ts';
import worker from '../src/worker.ts';

const origin = 'https://dwnc.me';
const env = {
  ACCESS_TEAM_DOMAIN: 'https://public-auth-test.cloudflareaccess.com',
  ACCESS_AUD: 'public-auth-abcdefghijklmnopqrstuvwx',
  ACCESS_ALLOWED_EMAIL: 'owner@example.test',
};
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'public-auth-test', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (overrides = {}) => {
  const head = encode({ alg: 'RS256', kid: jwk.kid });
  const body = encode({ iss: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, sub: 'fixture-owner',
    email: env.ACCESS_ALLOWED_EMAIL, exp: Math.floor(Date.now() / 1000) + 3600, ...overrides });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
};
const jwt = token();
clearAccessKeyCacheForTests();
await verifyAccessIdentity(new Request(origin, { headers: { 'cf-access-jwt-assertion': jwt } }), env,
  { fetcher: async () => Response.json({ keys: [jwk] }) });

const request = (path = '/auth/session', { assertion = jwt, headers = {}, method = 'GET', environment = env } = {}) =>
  handlePublicAuth(new Request(origin + path, { method, headers: {
    'cf-access-jwt-assertion': assertion, ...headers,
  } }), environment);
const assertPrivateHeaders = response => {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(response.headers.get('set-cookie'), null);
};
let response = await request();
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { authenticated: true });
assertPrivateHeaders(response);
response = await request('/auth/session', { method: 'HEAD' });
assert.equal(response.status, 200); assert.equal(await response.text(), ''); assertPrivateHeaders(response);
for (const assertion of ['', token({ exp: Math.floor(Date.now() / 1000) - 1 }),
  token({ exp: Math.floor(Date.now() / 1000) }), token({ email: 'other@example.test' }),
  token({ aud: 'different-audience' }), token({ iss: 'https://different.cloudflareaccess.com' }),
  token({ nbf: Math.floor(Date.now() / 1000) + 120 }), jwt.slice(0, -8) + 'forged!!']) {
  response = await request('/auth/session', { assertion });
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { authenticated: false });
  assertPrivateHeaders(response);
}
// A cookie alone never replaces the edge assertion or bypasses Access enforcement.
response = await request('/auth/session', { assertion: '', headers: { cookie: `CF_Authorization=${jwt}` } });
assert.equal(response.status, 401);
response = await request('/auth/session', { environment: {} });
assert.equal(response.status, 401);
for (const foreign of ['null', 'https://evil.test', 'https://admin.dwnc.me', 'https://dwnc.me.evil.test', 'http://dwnc.me']) {
  response = await request('/auth/session', { headers: { origin: foreign } });
  assert.equal(response.status, 403); assertPrivateHeaders(response);
}
assert.equal((await request('/auth/session', { headers: { origin } })).status, 200);
for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
  response = await request('/auth/session', { method });
  assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD');
}
assert.equal((await request('/auth/session?return=/')).status, 403);
for (const path of ['/auth', '/auth/', '/auth/unknown', '/auth/session/']) assert.equal((await request(path)).status, 404);

for (const value of ['/posts/1', '/archive?page=2', '/posts/1#본문', '/category/개발', '/category/%EA%B0%9C%EB%B0%9C',
  '/search?q=hello%20world', '/search?q=%ED%95%9C%EA%B8%80%20%EA%B2%80%EC%83%89',
  '/search?q=한글 검색', '/posts/1#한글 위치', '/posts/1#%ED%95%9C%EA%B8%80%20%EC%9C%84%EC%B9%98']) {
  response = await request('/auth/login?' + new URLSearchParams({ return: value }));
  assert.equal(response.status, 303);
  const target = new URL(value, origin);
  assert.equal(response.headers.get('location'), target.pathname + target.search + target.hash);
  assertPrivateHeaders(response);
}
for (const value of ['https://evil.test', '//evil.test', '/foo/..//evil.test', '/%2e%2e//evil.test', '/\\evil.test', '/%2Fevil.test', '/%252Fevil.test',
  '/%5Cevil.test', '/%255Cevil.test', '/posts/1\nLocation: evil', '/posts/1%0aLocation:evil',
  '/auth', '/auth/login', '/AUTH/login', '/%61uth/login', '/%2561uth/login', '/posts/../auth/login',
  '/cdn-cgi/access/login', '/%63dn-cgi/access/logout', '/%ZZ', '', null, 'relative/path']) {
  assert.equal(safePublicLoginReturn(value, origin), '/', `Unsafe return accepted: ${JSON.stringify(value)}`);
  response = await request('/auth/login?' + new URLSearchParams({ return: value ?? '' }));
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/');
}
assert.equal((await request('/auth/login')).headers.get('location'), '/');
assert.equal((await request('/auth/login?return=/posts/1&return=/archive')).status, 400);
assert.equal((await request('/auth/login?next=/posts/1')).status, 400);
response = await request('/auth/login?return=/posts/1', { method: 'HEAD' });
assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/posts/1'); assert.equal(await response.text(), '');
response = await request('/auth/login?return=/posts/1', { assertion: '' });
assert.equal(response.status, 401); assert.equal(response.headers.get('location'), null);

// Public routes do not inspect identity or need Access configuration.
for (const path of ['/', '/posts/1', '/archive', '/search-index.json', '/api/session', '/authentic']) {
  assert.equal(await request(path, { environment: {}, assertion: '' }), null);
}
// Authentication routing happens before content/database handling in the real entrypoint.
response = await worker.fetch(new Request(origin + '/auth/session', { headers: { 'cf-access-jwt-assertion': jwt } }), env, {});
assert.equal(response.status, 200); assert.deepEqual(await response.json(), { authenticated: true });
response = await worker.fetch(new Request(origin + '/auth/session'), {}, {});
assert.equal(response.status, 401);
let publicAssetRequests = 0;
response = await worker.fetch(new Request(origin + '/robots.txt'), { ASSETS: { fetch: async () => {
  publicAssetRequests++; return new Response('public robots fixture');
} } }, {});
assert.equal(response.status, 200); assert.equal(await response.text(), 'public robots fixture');
assert.equal(publicAssetRequests, 1);

const publicConfig = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const adminConfig = JSON.parse(await readFile(new URL('../wrangler.admin.jsonc', import.meta.url), 'utf8'));
for (const name of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ACCESS_ALLOWED_EMAIL']) {
  assert.equal(publicConfig.env.production.vars[name], adminConfig.env.production.vars[name]);
  assert.equal(publicConfig.env.staging.vars[name], undefined);
}
console.log(JSON.stringify({ suite: 'public-auth', status: 'PASS', behavior:
  'strict signed identity, no cookie bypass, same-origin no-store session, safe login return, public routes unaffected, no database access' }));
