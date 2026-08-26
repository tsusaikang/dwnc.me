import assert from 'node:assert/strict';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createMediaWorker } from '../src/lib/media-worker.ts';
import { publicMediaEntryManifestSha256 } from './lib/public-media-manifest.mjs';

// Node 24's Web Crypto surface does not yet expose the Workers-only method.
// The production Worker calls crypto.subtle.timingSafeEqual directly; this shim
// keeps the Node fixture behavior equivalent without changing Worker code.
if (typeof crypto.subtle.timingSafeEqual !== 'function') {
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    value: (left, right) => timingSafeEqual(
      Buffer.from(left.buffer ?? left, left.byteOffset ?? 0, left.byteLength),
      Buffer.from(right.buffer ?? right, right.byteOffset ?? 0, right.byteLength),
    ),
  });
}

const manifestSha256 = 'a'.repeat(64);
const bytes = Buffer.from('0123456789abcdef');
const entry = {
  publicPath: '/media/native/example/video.mp4',
  key: 'media/native/example/video.mp4',
  size: bytes.length,
  sha256: 'b'.repeat(64),
  contentType: 'video/mp4',
  cacheControl: 'public, max-age=31536000, immutable',
};
const pathHash = (value) => createHash('sha256').update(value).digest('hex');
const publicSurface = {
  schemaVersion: 1,
  contract: 'dwnc-public-request-surface-v1',
  pathCount: 3,
  surfaceSha256: 'c'.repeat(64),
  allowedPathHashes: [pathHash('/'), pathHash('/about'), pathHash('/1')].sort(),
};

function object(body = bytes) {
  const checksumBytes = Uint8Array.from(Buffer.from(entry.sha256, 'hex')).buffer;
  return {
    key: entry.key,
    size: entry.size,
    etag: 'etag-value',
    httpEtag: '"etag-value"',
    version: 'version-1',
    checksums: { sha256: checksumBytes },
    uploaded: new Date('2026-08-25T00:00:00.000Z'),
    httpMetadata: { contentType: entry.contentType, cacheControl: entry.cacheControl },
    customMetadata: {
      sha256: entry.sha256,
      contract: 'dwnc-public-media-r2-v1',
      manifestEntrySha256: publicMediaEntryManifestSha256(entry),
    },
    body: new Response(body).body,
  };
}

function environment({
  missing = false, headError = false, getError = false, mutate = undefined,
  mutateHead = undefined, mutateGet = undefined,
  cached = undefined, cacheMatchError = false, cachePutError = false,
  workerEnvironment = {}, withoutInjectedCache = false,
} = {}) {
  const calls = { head: [], get: [], assets: [], cacheMatch: [], cachePut: [], waitUntil: [] };
  const base = object();
  if (mutate) mutate(base);
  return {
    calls,
    env: {
      ...workerEnvironment,
      MEDIA_BUCKET: {
        async head(key) {
          calls.head.push(key);
          if (headError) throw new Error('hidden upstream error');
          if (missing) return null;
          const value = { ...base, body: undefined };
          if (mutateHead) mutateHead(value);
          return value;
        },
        async get(key, options) {
          calls.get.push({ key, options });
          if (getError) throw new Error('hidden upstream error');
          if (missing) return null;
          let body = bytes;
          const range = options?.range;
          if (range) body = bytes.subarray(range.offset, range.offset + range.length);
          const value = { ...base, body: new Response(body).body };
          if (mutateGet) mutateGet(value);
          return value;
        },
      },
      ASSETS: {
        async fetch(request) {
          calls.assets.push(request.url);
          return new Response('asset fallback', { status: 200 });
        },
      },
      ...(withoutInjectedCache ? {} : { MEDIA_CACHE: {
        async match(request) {
          calls.cacheMatch.push(request.url);
          if (cacheMatchError) throw new Error('hidden cache error');
          return cached?.clone();
        },
        async put(request, response) {
          calls.cachePut.push({ request: request.url, response: response.clone() });
          if (cachePutError) throw new Error('hidden cache error');
        },
      } }),
    },
    context: {
      waitUntil(promise) {
        calls.waitUntil.push(promise);
      },
    },
  };
}

const handle = createMediaWorker([entry], manifestSha256, publicSurface);
let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };

{
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  try {
    delete globalThis.caches;
    const absent = environment({ withoutInjectedCache: true });
    const absentResponse = await handle(new Request(`https://dwnc.me${entry.publicPath}`),
      absent.env, absent.context);
    equal(absentResponse.status, 200);
    equal(absent.calls.head.length, 1);
    equal(absent.calls.get.length, 1);
    equal(absent.calls.waitUntil.length, 0);

    const globalCacheCalls = [];
    const globalCachedResponse = new Response(bytes, {
      status: 200,
      headers: {
        'accept-ranges': 'bytes',
        'cache-control': entry.cacheControl,
        'content-length': String(entry.size),
        'content-type': entry.contentType,
        etag: '"global-cache-etag"',
        'last-modified': 'Tue, 25 Aug 2026 00:00:00 GMT',
        'x-content-type-options': 'nosniff',
      },
    });
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {
        default: {
          async match(request) {
            globalCacheCalls.push(request.url);
            return globalCachedResponse.clone();
          },
          async put() {},
        },
      },
    });
    const present = environment({ withoutInjectedCache: true });
    const presentResponse = await handle(new Request(`https://dwnc.me${entry.publicPath}`),
      present.env, present.context);
    equal(presentResponse.status, 200);
    equal(presentResponse.headers.get('etag'), '"global-cache-etag"');
    equal(globalCacheCalls.length, 1);
    equal(present.calls.head.length, 0);
    equal(present.calls.get.length, 0);
  } finally {
    if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches);
    else delete globalThis.caches;
  }
}

{
  const smokeToken = 'A'.repeat(43);
  const workerEnvironment = {
    DWNC_DEPLOYMENT_ENVIRONMENT: 'staging',
    DWNC_STAGING_SMOKE_POLICY: 'bearer-token-non-access-origin',
    DWNC_STAGING_SMOKE_ORIGIN: 'https://dwnc-me-staging.dwnc.workers.dev',
    DWNC_STAGING_SMOKE_TOKEN: smokeToken,
    CF_VERSION_METADATA: { id: '22345678-1234-4123-8123-123456789abc' },
  };
  const denied = environment({ workerEnvironment });
  const deniedResponse = await handle(new Request('https://dwnc-me-staging.dwnc.workers.dev/about'), denied.env);
  equal(deniedResponse.status, 404);
  equal(denied.calls.assets.length, 0);

  for (const authorization of [
    `Bearer ${smokeToken.slice(0, -1)}`,
    `Bearer ${smokeToken}x`,
    `Bearer ${'x'.repeat(smokeToken.length)}`,
    `Bearer ${'A'.repeat(44)}`,
    smokeToken,
  ]) {
    const invalid = environment({ workerEnvironment });
    const invalidResponse = await handle(new Request('https://dwnc-me-staging.dwnc.workers.dev/about', {
      headers: { authorization },
    }), invalid.env);
    equal(invalidResponse.status, 404);
    equal(invalid.calls.assets.length, 0);
  }

  const legacyPolicy = environment({
    workerEnvironment: { ...workerEnvironment, DWNC_STAGING_SMOKE_POLICY: 'signed-header-non-access-origin' },
  });
  const legacyPolicyResponse = await handle(new Request('https://dwnc-me-staging.dwnc.workers.dev/about', {
    headers: { authorization: `Bearer ${smokeToken}` },
  }), legacyPolicy.env);
  equal(legacyPolicyResponse.status, 404);
  equal(legacyPolicy.calls.assets.length, 0);

  const oversizedConfiguredToken = environment({
    workerEnvironment: { ...workerEnvironment, DWNC_STAGING_SMOKE_TOKEN: 'A'.repeat(44) },
  });
  const oversizedConfiguredTokenResponse = await handle(new Request(
    'https://dwnc-me-staging.dwnc.workers.dev/about', {
      headers: { authorization: `Bearer ${'A'.repeat(44)}` },
    },
  ), oversizedConfiguredToken.env);
  equal(oversizedConfiguredTokenResponse.status, 404);
  equal(oversizedConfiguredToken.calls.assets.length, 0);

  const allowed = environment({ workerEnvironment });
  const allowedResponse = await handle(new Request('https://dwnc-me-staging.dwnc.workers.dev/about', {
    headers: { authorization: `Bearer ${smokeToken}` },
  }), allowed.env);
  equal(allowedResponse.status, 200);
  equal(allowedResponse.headers.get('x-dwnc-staging-version'), workerEnvironment.CF_VERSION_METADATA.id);
  equal(allowed.calls.assets.length, 1);

  const cached = new Response(bytes, {
    status: 200,
    headers: {
      'accept-ranges': 'bytes',
      'cache-control': entry.cacheControl,
      'content-length': String(entry.size),
      'content-type': entry.contentType,
      etag: '"staging-cache-etag"',
      'last-modified': 'Tue, 25 Aug 2026 00:00:00 GMT',
      'x-content-type-options': 'nosniff',
    },
  });
  const cacheHit = environment({ cached, workerEnvironment });
  const cacheHitResponse = await handle(new Request(
    `https://dwnc-me-staging.dwnc.workers.dev${entry.publicPath}`,
    { headers: { authorization: `Bearer ${smokeToken}`, 'x-dwnc-smoke-cache-probe': '1' } },
  ), cacheHit.env);
  equal(cacheHitResponse.status, 200);
  equal(cacheHitResponse.headers.get('x-dwnc-cache-probe'), 'HIT');
  equal(cacheHitResponse.headers.get('x-dwnc-staging-version'), workerEnvironment.CF_VERSION_METADATA.id);
  equal(cacheHit.calls.cacheMatch.length, 1);
}

{
  const { env, calls } = environment();
  const response = await handle(new Request('https://dwnc.me/about'), env);
  equal(response.status, 200);
  equal(calls.assets.length, 1);
  equal(calls.head.length, 0);
}
{
  const { env, calls } = environment();
  const response = await handle(new Request('https://dwnc.me/1'), env);
  equal(response.status, 200);
  equal(calls.assets.length, 1);
  equal(calls.cacheMatch.length, 0);
}
for (const url of [
  'https://dwnc.me/withdrawn-post',
  'https://dwnc.me/174',
  'https://dwnc.me/about%252fwithdrawn',
  'https://dwnc.me/%2e%2e/withdrawn',
]) {
  const { env, calls } = environment();
  const response = await handle(new Request(url), env);
  equal(response.status, 404);
  equal(response.headers.get('cache-control'), 'no-store');
  equal(calls.assets.length, 0);
  equal(calls.cacheMatch.length, 0);
}
{
  const { env, calls, context } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env, context);
  equal(response.status, 200);
  equal(await response.text(), bytes.toString());
  equal(response.headers.get('content-type'), 'video/mp4');
  equal(response.headers.get('content-length'), String(bytes.length));
  equal(response.headers.get('etag'), '"etag-value"');
  equal(response.headers.get('accept-ranges'), 'bytes');
  equal(response.headers.get('x-content-type-options'), 'nosniff');
  equal(calls.head.length, 1);
  equal(calls.get.length, 1);
  equal(calls.waitUntil.length, 1);
  await Promise.all(calls.waitUntil);
  equal(calls.cachePut.length, 1);
  equal(new URL(calls.cachePut[0].request).searchParams.get('__dwnc_media_sha256'), entry.sha256);
}
{
  const { env, calls } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, { method: 'HEAD' }), env);
  equal(response.status, 200);
  equal(await response.text(), '');
  equal(calls.get.length, 0);
}
{
  const { env, calls } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    headers: { 'if-none-match': 'W/"etag-value"' },
  }), env);
  equal(response.status, 304);
  equal(calls.get.length, 0);
}
{
  const { env, calls, context } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    headers: { range: 'bytes=2-5' },
  }), env, context);
  equal(response.status, 206);
  equal(await response.text(), '2345');
  equal(response.headers.get('content-range'), `bytes 2-5/${bytes.length}`);
  equal(response.headers.get('content-length'), '4');
  equal(calls.get[0].options.range.offset, 2);
  equal(calls.get[0].options.range.length, 4);
  equal(calls.cacheMatch.length, 0);
  equal(calls.cachePut.length, 0);
}

for (const cacheOptions of [{ cacheMatchError: true }, { cachePutError: true }]) {
  const { env, calls, context } = environment(cacheOptions);
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env, context);
  equal(response.status, 200);
  equal(await response.text(), bytes.toString());
  await Promise.all(calls.waitUntil);
  equal(calls.head.length, 1);
  equal(calls.get.length, 1);
}
{
  const observed = [];
  const originalError = console.error;
  console.error = (value) => observed.push(String(value));
  try {
    const { env, calls, context } = environment({ cachePutError: true });
    const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env, context);
    equal(response.status, 200);
    await Promise.all(calls.waitUntil);
    equal(observed.some((value) => value.includes('MEDIA_W_CACHE_WRITE')), true);
  } finally {
    console.error = originalError;
  }
}
{
  const { env } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    headers: { range: 'bytes=-4' },
  }), env);
  equal(response.status, 206);
  equal(await response.text(), 'cdef');
}
{
  const { env, calls } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    headers: { range: 'bytes=2-5', 'if-range': '"etag-value"' },
  }), env);
  equal(response.status, 206);
  equal(await response.text(), '2345');
  equal(calls.get[0].options.range.offset, 2);
}
for (const ifRange of ['"stale-etag"', 'W/"etag-value"', 'not-a-validator', 'Mon, 24 Aug 2026 23:59:59 GMT']) {
  const { env, calls } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    headers: { range: 'bytes=2-5', 'if-range': ifRange },
  }), env);
  equal(response.status, 200);
  equal(await response.text(), bytes.toString());
  equal(calls.get[0].options, undefined);
}
{
  const { env } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    headers: { range: 'bytes=2-5', 'if-range': 'Tue, 25 Aug 2026 00:00:00 GMT' },
  }), env);
  equal(response.status, 206);
  equal(await response.text(), '2345');
}
{
  const { env, calls } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    method: 'HEAD', headers: { range: 'bytes=2-5' },
  }), env);
  equal(response.status, 200);
  equal(response.headers.get('content-length'), String(bytes.length));
  equal(response.headers.get('content-range'), null);
  equal(calls.get.length, 0);
}
for (const range of ['bytes=0-1,4-5', 'bytes=999-', 'items=0-2', 'bytes=-0']) {
  const { env, calls } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, { headers: { range } }), env);
  equal(response.status, 416);
  equal(response.headers.get('content-range'), `bytes */${bytes.length}`);
  equal(calls.get.length, 0);
}
for (const url of [
  'https://dwnc.me/media/native/example/missing.mp4',
  `https://dwnc.me${entry.publicPath}?download=1`,
  'https://dwnc.me/media/%252e%252e/secret',
  'https://dwnc.me/media/native%2Fexample%2Fvideo.mp4',
]) {
  const { env, calls } = environment();
  const response = await handle(new Request(url), env);
  equal(response.status, 404);
  equal(response.headers.get('cache-control'), 'no-store');
  equal(calls.head.length, 0);
  equal(calls.assets.length, 0);
  equal(calls.cacheMatch.length, 0);
}
{
  const { env, calls } = environment();
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`, { method: 'POST' }), env);
  equal(response.status, 405);
  equal(response.headers.get('allow'), 'GET, HEAD');
  equal(calls.head.length, 0);
}
for (const options of [{ missing: true }, { headError: true }, { getError: true }]) {
  const { env } = environment(options);
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env);
  equal(response.status, options.missing ? 404 : 502);
  equal(response.headers.get('cache-control'), 'no-store');
}
{
  const { env, calls } = environment({ mutate: (value) => { value.customMetadata.sha256 = 'c'.repeat(64); } });
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env);
  equal(response.status, 502);
  equal(calls.get.length, 0);
}
for (const mutateHead of [
  (value) => { value.checksums = { sha256: Uint8Array.from(Buffer.alloc(32, 7)).buffer }; },
  (value) => { value.customMetadata.manifestEntrySha256 = 'd'.repeat(64); },
  (value) => { value.version = ''; },
]) {
  const { env, calls } = environment({ mutateHead });
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env);
  equal(response.status, 502);
  equal(response.headers.get('cache-control'), 'no-store');
  equal(calls.get.length, 0);
}
for (const mutateGet of [
  (value) => { value.version = 'version-raced'; },
  (value) => { value.etag = 'raced-etag'; value.httpEtag = '"raced-etag"'; },
  (value) => { value.checksums = { sha256: Uint8Array.from(Buffer.alloc(32, 9)).buffer }; },
]) {
  const { env } = environment({ mutateGet });
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env);
  equal(response.status, 502);
  equal(response.headers.get('cache-control'), 'no-store');
}

{
  const productionWorker = (await import('../src/worker.ts')).default;
  const { env, calls, context } = environment();
  const response = await productionWorker.fetch(new Request('https://dwnc.me/about'), env, context);
  equal(response.status, 200);
  equal(calls.assets.length, 1);
}

{
  const cached = new Response(bytes, {
    status: 200,
    headers: {
      'accept-ranges': 'bytes',
      'cache-control': entry.cacheControl,
      'content-length': String(entry.size),
      'content-type': entry.contentType,
      etag: '"cached-etag"',
      'last-modified': 'Tue, 25 Aug 2026 00:00:00 GMT',
      'x-content-type-options': 'nosniff',
    },
  });
  const { env, calls } = environment({ cached });
  const response = await handle(new Request(`https://dwnc.me${entry.publicPath}`), env);
  equal(response.status, 200);
  equal(await response.text(), bytes.toString());
  equal(calls.cacheMatch.length, 1);
  equal(calls.head.length, 0);
  equal(calls.get.length, 0);

  const conditional = await handle(new Request(`https://dwnc.me${entry.publicPath}`, {
    headers: { 'if-none-match': '"cached-etag"' },
  }), env);
  equal(conditional.status, 304);
  equal(conditional.headers.get('content-length'), null);

  const head = await handle(new Request(`https://dwnc.me${entry.publicPath}`, { method: 'HEAD' }), env);
  equal(head.status, 200);
  equal(await head.text(), '');
  equal(calls.head.length, 0);
}

console.log(JSON.stringify({ suite: 'media-worker', assertions, status: 'PASS' }, null, 2));
