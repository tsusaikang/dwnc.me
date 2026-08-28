import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import edgeRedirectManifest from '../../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import publicSequence from '../../src/data/public-sequence-v1.json' with { type: 'json' };
import { remoteObjectMatches } from './r2-s3-client.mjs';
import { validateEdgeRedirectManifest } from './cloudflare-redirects.mjs';

const fail = (code) => { throw new Error(code); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CANONICAL_REDIRECTS_JSON = JSON.stringify(edgeRedirectManifest.redirects);
export const STAGING_SMOKE_LIMITS = Object.freeze({
  requestTimeoutMs: 10_000,
  totalTimeoutMs: 8 * 60 * 1_000,
  cancelTimeoutMs: 100,
});

export function stagingSmokeLimitsFromEnvironment(source = process.env, now = Date.now()) {
  const raw = source.CLOUDFLARE_STAGING_SMOKE_DEADLINE_EPOCH_MS;
  if (!/^[1-9]\d{12}$/u.test(raw ?? '') || !Number.isSafeInteger(now)) {
    fail('CLOUDFLARE_E_SMOKE_DEADLINE');
  }
  const remaining = Number(raw) - now;
  if (!Number.isSafeInteger(remaining) || remaining < 1
    || remaining > STAGING_SMOKE_LIMITS.totalTimeoutMs) {
    fail('CLOUDFLARE_E_SMOKE_DEADLINE');
  }
  return Object.freeze({ ...STAGING_SMOKE_LIMITS, totalTimeoutMs: remaining });
}

validateEdgeRedirectManifest(edgeRedirectManifest, publicSequence);

function r2S3VersionEvidence(value) {
  return value === null ? 'r2-s3-version-id-v1\0absent' : `r2-s3-version-id-v1\0present\0${value}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const canonicalStagingMediaProbePayload = canonicalJson;

export function validateStagingMediaProbeReceipt(receipt, { expected = {}, now = new Date() } = {}) {
  const keys = [
    'schemaVersion', 'contract', 'environment', 'artifactSha256', 'payloadSha256',
    'stagingVersionId', 'originSha256', 'accountIdSha256', 'bucket', 'manifestSha256',
    'keySha256', 'versionSha256', 'httpEtagSha256', 's3HeadVerified',
    'workerBindingVerified', 'fullBodySha256Verified', 'rangeVerified', 'observedAt', 'expiresAt',
  ];
  if (!receipt || Object.keys(receipt).length !== keys.length
    || Object.keys(receipt).some((key) => !keys.includes(key))
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-one-object-probe-v1'
    || receipt.environment !== 'staging'
    || ![receipt.artifactSha256, receipt.payloadSha256, receipt.originSha256,
      receipt.accountIdSha256, receipt.manifestSha256, receipt.keySha256,
      receipt.versionSha256, receipt.httpEtagSha256].every((value) => SHA256.test(value ?? ''))
    || !UUID.test(receipt.stagingVersionId ?? '')
    || receipt.bucket !== 'dwnc-me-public-media-staging'
    || !['s3HeadVerified', 'workerBindingVerified', 'fullBodySha256Verified', 'rangeVerified']
      .every((key) => receipt[key] === true)
    || Number.isNaN(Date.parse(receipt.observedAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_STAGING_PROBE_RECEIPT');
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || receipt[key] !== value) fail('CLOUDFLARE_E_STAGING_PROBE_EXPECTED');
  }
  const observed = Date.parse(receipt.observedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < observed - 120000 || now.getTime() >= expires
    || expires <= observed || expires - observed > 15 * 60 * 1000) {
    fail('CLOUDFLARE_E_STAGING_PROBE_EXPIRED');
  }
  return receipt;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function validateSmokeRedirectRoster(redirects) {
  if (!Array.isArray(redirects) || redirects.length !== 349
    || redirects.some((redirect) => !exactKeys(redirect, ['from', 'to', 'status']))
    || JSON.stringify(redirects) !== CANONICAL_REDIRECTS_JSON) {
    fail('CLOUDFLARE_E_SMOKE_REDIRECTS');
  }
  return redirects;
}

function validateSmokeLimits(value = STAGING_SMOKE_LIMITS) {
  if (!exactKeys(value, ['requestTimeoutMs', 'totalTimeoutMs', 'cancelTimeoutMs'])
    || ![value.requestTimeoutMs, value.totalTimeoutMs, value.cancelTimeoutMs]
      .every((item) => Number.isSafeInteger(item) && item >= 1)
    || value.requestTimeoutMs > 30_000 || value.totalTimeoutMs > 15 * 60 * 1_000
    || value.cancelTimeoutMs > 1_000) {
    fail('CLOUDFLARE_E_SMOKE_LIMITS');
  }
  return value;
}

function validateSmokeOrigin(origin) {
  let url;
  try { url = new URL(origin); }
  catch { fail('CLOUDFLARE_E_SMOKE_INPUT'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || url.origin !== origin) fail('CLOUDFLARE_E_SMOKE_INPUT');
  return url.origin;
}

function validateSmokeStaticEntry(entry) {
  if (!exactKeys(entry, ['publicPath', 'size', 'sha256', 'contentType'])
    || entry.publicPath !== '/about'
    || !Number.isSafeInteger(entry.size) || entry.size <= 0
    || !SHA256.test(entry.sha256 ?? '') || entry.contentType !== 'text/html') {
    fail('CLOUDFLARE_E_SMOKE_INPUT');
  }
  return entry;
}

function validateSmokeMediaEntry(entry) {
  if (!entry || typeof entry.publicPath !== 'string' || !/^\/media\/[A-Za-z0-9._/-]+$/u.test(entry.publicPath)
    || !Number.isSafeInteger(entry.size) || entry.size <= 0
    || !SHA256.test(entry.sha256 ?? '') || typeof entry.contentType !== 'string') {
    fail('CLOUDFLARE_E_SMOKE_INPUT');
  }
  return entry;
}

function normalizedMime(response) {
  return response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? null;
}

async function settleCancellation(promise, timeoutMs) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve(promise).catch(() => undefined),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function cancelResponseBody(response, cancelTimeoutMs) {
  if (!response?.body || response.body.locked || typeof response.body.cancel !== 'function') return;
  await settleCancellation(response.body.cancel('CLOUDFLARE_SMOKE_BODY_UNUSED'), cancelTimeoutMs);
}

async function readBoundedResponseBody(
  response, maximumBytes, signal, cancelTimeoutMs, enforceDeclaredLength = true,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) fail('CLOUDFLARE_E_SMOKE_LIMITS');
  const rawLength = response.headers.get('content-length');
  if (enforceDeclaredLength && rawLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/u.test(rawLength) || Number(rawLength) > maximumBytes) {
      await cancelResponseBody(response, cancelTimeoutMs);
      fail('CLOUDFLARE_E_SMOKE_BODY_LIMIT');
    }
  }
  if (!response.body) return Buffer.alloc(0);
  if (typeof response.body.getReader !== 'function') fail('CLOUDFLARE_E_SMOKE_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let complete = false;
  const cancelOnAbort = () => {
    void Promise.resolve(reader.cancel('CLOUDFLARE_SMOKE_ABORT')).catch(() => undefined);
  };
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    if (signal.aborted) {
      cancelOnAbort();
      fail(typeof signal.reason === 'string'
        ? signal.reason : 'CLOUDFLARE_E_SMOKE_ABORTED');
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      if (!(value instanceof Uint8Array)) fail('CLOUDFLARE_E_SMOKE_RESPONSE');
      total += value.byteLength;
      if (total > maximumBytes) fail('CLOUDFLARE_E_SMOKE_BODY_LIMIT');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
    if (!complete) await settleCancellation(reader.cancel(), cancelTimeoutMs);
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

function createSmokeRequestGuard(limitsInput, canonicalOrigin) {
  const limits = validateSmokeLimits(limitsInput);
  validateSmokeOrigin(canonicalOrigin);
  const operationDeadline = performance.now() + limits.totalTimeoutMs;
  const remaining = () => operationDeadline - performance.now();
  return Object.freeze({
    async request(fetcher, input, init, consume, { allowRedirectResponse = false } = {}) {
      let requestUrl;
      try { requestUrl = new URL(input); }
      catch { fail('CLOUDFLARE_E_SMOKE_REQUEST_URL'); }
      if (typeof input !== 'string' || requestUrl.href !== input
        || requestUrl.protocol !== 'https:' || requestUrl.origin !== canonicalOrigin
        || requestUrl.username || requestUrl.password) fail('CLOUDFLARE_E_SMOKE_REQUEST_URL');
      const totalRemaining = remaining();
      if (totalRemaining <= 0) fail('CLOUDFLARE_E_SMOKE_TOTAL_TIMEOUT');
      const requestBudget = Math.min(limits.requestTimeoutMs, totalRemaining);
      const timeoutCode = totalRemaining <= limits.requestTimeoutMs
        ? 'CLOUDFLARE_E_SMOKE_TOTAL_TIMEOUT' : 'CLOUDFLARE_E_SMOKE_REQUEST_TIMEOUT';
      const controller = new AbortController();
      let response;
      let timer;
      let timedOut = false;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort(timeoutCode);
          reject(new Error(timeoutCode));
        }, Math.max(1, Math.ceil(requestBudget)));
      });
      const action = Promise.resolve().then(async () => {
        response = await fetcher(input, {
          ...init,
          redirect: 'manual',
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          await cancelResponseBody(response, limits.cancelTimeoutMs);
          fail(typeof controller.signal.reason === 'string'
            ? controller.signal.reason : timeoutCode);
        }
        if (!response || !Number.isSafeInteger(response.status)
          || typeof response.headers?.get !== 'function') fail('CLOUDFLARE_E_SMOKE_RESPONSE');
        let responseUrl;
        try { responseUrl = new URL(response.url); }
        catch { fail('CLOUDFLARE_E_SMOKE_RESPONSE_URL'); }
        if (response.url !== requestUrl.href || responseUrl.href !== requestUrl.href
          || responseUrl.protocol !== 'https:' || responseUrl.origin !== canonicalOrigin
          || responseUrl.username || responseUrl.password
          || !allowRedirectResponse && REDIRECT_STATUSES.has(response.status)) {
          fail('CLOUDFLARE_E_SMOKE_RESPONSE_URL');
        }
        return consume(response, controller.signal, limits.cancelTimeoutMs);
      });
      try {
        return await Promise.race([action, timeout]);
      } catch (error) {
        if (!controller.signal.aborted) controller.abort('CLOUDFLARE_SMOKE_FAILURE');
        if (timedOut) throw new Error(timeoutCode);
        throw error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await cancelResponseBody(response, limits.cancelTimeoutMs);
      }
    },
    async delay(milliseconds) {
      const totalRemaining = remaining();
      if (totalRemaining <= milliseconds) {
        if (totalRemaining > 0) await new Promise((resolve) => setTimeout(resolve, totalRemaining));
        fail('CLOUDFLARE_E_SMOKE_TOTAL_TIMEOUT');
      }
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    },
    readBody(response, maximumBytes, signal, { enforceDeclaredLength = true } = {}) {
      return readBoundedResponseBody(
        response, maximumBytes, signal, limits.cancelTimeoutMs, enforceDeclaredLength,
      );
    },
    cancelBody(response) {
      return cancelResponseBody(response, limits.cancelTimeoutMs);
    },
  });
}

export async function loadStagingSmokeStaticEntry(artifactDirectory) {
  if (typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)) {
    fail('CLOUDFLARE_E_SMOKE_STATIC_AUTHORITY');
  }
  let bytes;
  try { bytes = await readFile(path.join(artifactDirectory, 'static/about/index.html')); }
  catch { fail('CLOUDFLARE_E_SMOKE_STATIC_AUTHORITY'); }
  if (bytes.length === 0) fail('CLOUDFLARE_E_SMOKE_STATIC_AUTHORITY');
  return Object.freeze({
    publicPath: '/about',
    size: bytes.length,
    sha256: sha256(bytes),
    contentType: 'text/html',
  });
}

async function collectStagingHttpContract({
  fetcher, unauthenticatedFetcher, origin, stagingVersionId, stagingDeployment100,
  mediaEntry, staticEntry, redirects, limits = STAGING_SMOKE_LIMITS,
}) {
  if (typeof fetcher !== 'function' || typeof unauthenticatedFetcher !== 'function'
    || !UUID.test(stagingVersionId ?? '')) fail('CLOUDFLARE_E_SMOKE_INPUT');
  const canonicalOrigin = validateSmokeOrigin(origin);
  validateSmokeMediaEntry(mediaEntry);
  validateSmokeStaticEntry(staticEntry);
  validateSmokeRedirectRoster(redirects);
  const guard = createSmokeRequestGuard(limits, canonicalOrigin);
  const mediaUrl = new URL(mediaEntry.publicPath, canonicalOrigin).href;
  const isCandidateVersion = (response) => response.headers.get('x-dwnc-staging-version') === stagingVersionId;
  const requestCounts = {
    media: 0, static: 0, notFound: 0, redirectGet: 0, redirectHead: 0,
    cacheProbe: 0, unauthenticated: 0,
  };
  let versionMarkerVerified = true;
  const authenticatedFetch = async (kind, input, init, consume, requestOptions = {}) => {
    requestCounts[kind] += 1;
    return guard.request(fetcher, input, init, async (response, signal) => {
      versionMarkerVerified = versionMarkerVerified && isCandidateVersion(response);
      const value = await consume(response, signal);
      return { response, value };
    }, requestOptions);
  };
  const { response: get, value: getBody } = await authenticatedFetch(
    'media', mediaUrl, { method: 'GET' },
    (response, signal) => guard.readBody(response, mediaEntry.size, signal),
  );
  const etag = get.headers.get('etag');
  const contentType = get.headers.get('content-type');
  const get200 = get.status === 200 && getBody.length === mediaEntry.size
    && sha256(getBody) === mediaEntry.sha256;
  const { response: head, value: headBody } = await authenticatedFetch(
    'media', mediaUrl, { method: 'HEAD' },
    (response, signal) => guard.readBody(
      response, 0, signal, { enforceDeclaredLength: false },
    ),
  );
  const head200 = head.status === 200 && head.headers.get('etag') === etag
    && head.headers.get('content-length') === String(mediaEntry.size)
    && normalizedMime(head) === mediaEntry.contentType && headBody.length === 0;
  const { response: notModified, value: notModifiedBody } = await authenticatedFetch(
    'media', mediaUrl, { headers: { 'if-none-match': etag ?? '' } },
    (response, signal) => guard.readBody(
      response, 0, signal, { enforceDeclaredLength: false },
    ),
  );
  const { response: range, value: rangeBody } = await authenticatedFetch(
    'media', mediaUrl, { headers: { range: 'bytes=0-0' } },
    (response, signal) => guard.readBody(response, 1, signal),
  );
  const { response: invalidRange, value: invalidRangeBody } = await authenticatedFetch(
    'media', mediaUrl, { headers: { range: 'bytes=0-0,2-2' } },
    (response, signal) => guard.readBody(
      response, 0, signal, { enforceDeclaredLength: false },
    ),
  );
  const staticUrl = new URL(staticEntry.publicPath, canonicalOrigin).href;
  const { response: staticGet, value: staticGetBody } = await authenticatedFetch(
    'static', staticUrl, { method: 'GET' },
    (response, signal) => guard.readBody(response, staticEntry.size, signal),
  );
  const { response: staticHead, value: staticHeadBody } = await authenticatedFetch(
    'static', staticUrl, { method: 'HEAD' },
    (response, signal) => guard.readBody(
      response, 0, signal, { enforceDeclaredLength: false },
    ),
  );
  const notFoundUrl = new URL('/404.html', canonicalOrigin).href;
  const { response: notFoundGet } = await authenticatedFetch(
    'notFound', notFoundUrl, { method: 'GET' },
    async (response) => { await guard.cancelBody(response); },
  );
  const { response: notFoundHead, value: notFoundHeadBody } = await authenticatedFetch(
    'notFound', notFoundUrl, { method: 'HEAD' },
    (response, signal) => guard.readBody(
      response, 0, signal, { enforceDeclaredLength: false },
    ),
  );
  let redirects308 = true;
  let redirectBodiesEmpty = true;
  let redirectQueryDiscarded = false;
  for (const [index, redirect] of redirects.entries()) {
    for (const method of ['GET', 'HEAD']) {
      const redirectUrl = new URL(redirect.from, canonicalOrigin);
      if (index === 0 && method === 'GET') redirectUrl.search = '?dwnc-smoke-query=discard-me';
      const kind = method === 'GET' ? 'redirectGet' : 'redirectHead';
      const { response, value: body } = await authenticatedFetch(
        kind,
        redirectUrl.href,
        { method, redirect: 'manual' },
        (candidate, signal) => guard.readBody(
          candidate, 0, signal, { enforceDeclaredLength: method === 'GET' },
        ),
        { allowRedirectResponse: true },
      );
      const location = response.headers.get('location');
      redirects308 = redirects308 && response.status === 308 && location === redirect.to;
      redirectBodiesEmpty = redirectBodiesEmpty && body.length === 0;
      if (index === 0 && method === 'GET') {
        redirectQueryDiscarded = redirectUrl.search.length > 0 && location === redirect.to
          && !location.includes('?') && !location.includes('#');
      }
    }
  }
  let cached;
  let cachedBody = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await authenticatedFetch(
      'cacheProbe',
      mediaUrl,
      { headers: { 'x-dwnc-smoke-cache-probe': '1' } },
      async (response, signal) => {
        if (response.status === 200 && response.headers.get('x-dwnc-cache-probe') === 'HIT') {
          return guard.readBody(response, mediaEntry.size, signal);
        }
        await guard.cancelBody(response);
        return null;
      },
    );
    cached = result.response;
    cachedBody = result.value;
    if (cachedBody !== null) break;
    if (attempt < 2) await guard.delay(100 * (attempt + 1));
  }
  requestCounts.unauthenticated += 1;
  const unauthenticated = await guard.request(
    unauthenticatedFetcher,
    mediaUrl,
    { method: 'GET' },
    async (response) => { await guard.cancelBody(response); return response; },
  );
  const authenticatedRequestCount = requestCounts.media + requestCounts.static
    + requestCounts.notFound + requestCounts.redirectGet + requestCounts.redirectHead
    + requestCounts.cacheProbe;
  const totalRequestCount = authenticatedRequestCount + requestCounts.unauthenticated;
  const rawProbeEvidenceSha256 = sha256(JSON.stringify({
    get: get.status, head: head.status, conditional: notModified.status, range: range.status,
    invalidRange: invalidRange.status, staticGet: staticGet.status, staticHead: staticHead.status,
    staticBodySha256: sha256(staticGetBody), staticBodyBytes: staticGetBody.length,
    staticMime: normalizedMime(staticGet), conditionalEtag: notModified.headers.get('etag'),
    conditionalBodyBytes: notModifiedBody.length,
    invalidRangeEtag: invalidRange.headers.get('etag'),
    invalidRangeContentRange: invalidRange.headers.get('content-range'),
    invalidRangeBodyBytes: invalidRangeBody.length,
    notFoundGet: notFoundGet.status, notFoundHead: notFoundHead.status,
    redirects308, redirectBodiesEmpty, redirectQueryDiscarded,
    cache: cached.headers.get('x-dwnc-cache-probe'), unauthenticated: unauthenticated.status,
    cacheBodySha256: cachedBody === null ? null : sha256(cachedBody),
    cacheBodyBytes: cachedBody?.length ?? null,
    cacheEtag: cached.headers.get('etag'), cacheMime: normalizedMime(cached),
    etag, contentType, versionMarkerVerified, requestCounts, authenticatedRequestCount,
    totalRequestCount,
    rangeEtag: range.headers.get('etag'), rangeContentRange: range.headers.get('content-range'),
    rangeContentLength: range.headers.get('content-length'), rangeBodySha256: sha256(rangeBody),
  }));
  return {
    rawProbeEvidenceSha256,
    syntheticNonAccessOrigin: true,
    get200,
    head200,
    notModified304: notModified.status === 304 && notModified.headers.get('etag') === etag
      && notModifiedBody.length === 0,
    range206: range.status === 206
      && range.headers.get('etag') === etag
      && range.headers.get('content-range') === `bytes 0-0/${mediaEntry.size}`
      && range.headers.get('content-length') === '1'
      && rangeBody.length === 1 && getBody.length > 0 && rangeBody[0] === getBody[0],
    range416: invalidRange.status === 416 && invalidRange.headers.get('etag') === etag
      && invalidRange.headers.get('content-range') === `bytes */${mediaEntry.size}`
      && invalidRangeBody.length === 0,
    mimeVerified: contentType === mediaEntry.contentType,
    etagVerified: typeof etag === 'string' && /^"[^"\r\n]+"$/u.test(etag),
    static200: staticGet.status === 200 && staticHead.status === 200
      && staticGetBody.length === staticEntry.size && sha256(staticGetBody) === staticEntry.sha256
      && staticGet.headers.get('content-length') === String(staticEntry.size)
      && normalizedMime(staticGet) === staticEntry.contentType
      && staticHead.headers.get('content-length') === String(staticEntry.size)
      && normalizedMime(staticHead) === staticEntry.contentType && staticHeadBody.length === 0,
    notFound404: notFoundGet.status === 404 && notFoundHead.status === 404
      && notFoundGet.headers.get('cache-control') === 'no-store'
      && notFoundHead.headers.get('cache-control') === 'no-store' && notFoundHeadBody.length === 0,
    redirects308,
    redirectBodiesEmpty,
    redirectQueryDiscarded,
    redirectCount: redirects.length,
    redirectGetRequestCount: requestCounts.redirectGet,
    redirectHeadRequestCount: requestCounts.redirectHead,
    redirectRequestCount: requestCounts.redirectGet + requestCounts.redirectHead,
    mediaRequestCount: requestCounts.media,
    staticRequestCount: requestCounts.static,
    notFoundRequestCount: requestCounts.notFound,
    cacheProbeRequestCount: requestCounts.cacheProbe,
    authenticatedRequestCount,
    unauthenticatedRequestCount: requestCounts.unauthenticated,
    totalRequestCount,
    cachePathVerified: cached.status === 200 && cached.headers.get('x-dwnc-cache-probe') === 'HIT'
      && cachedBody?.length === mediaEntry.size && sha256(cachedBody) === mediaEntry.sha256
      && cached.headers.get('content-length') === String(mediaEntry.size)
      && cached.headers.get('etag') === etag && normalizedMime(cached) === mediaEntry.contentType,
    stagingDeployment100: stagingDeployment100 === true,
    unauthenticatedDenied: [401, 403, 404].includes(unauthenticated.status)
      && unauthenticated.headers.get('x-dwnc-staging-version') === null,
    versionMarkerVerified,
  };
}

export async function collectStagingSmokeEvidence({
  fetcher,
  unauthenticatedFetcher,
  origin,
  artifactSha256,
  payloadSha256,
  versionId,
  stagingVersionId,
  accessPolicySha256,
  stagingVersionAttestationSha256,
  stagingDeploymentStatusSha256,
  stagingMediaProbeSha256,
  stagingDeployment100,
  mediaEntry,
  staticEntry,
  redirects,
  limits = STAGING_SMOKE_LIMITS,
  observedAt,
  expiresAt,
}) {
  const evidence = await collectStagingHttpContract({
    fetcher, unauthenticatedFetcher, origin, stagingVersionId, stagingDeployment100,
    mediaEntry, staticEntry, redirects, limits,
  });
  return {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-staging-smoke-v1',
    environment: 'staging',
    artifactSha256,
    payloadSha256,
    versionId,
    stagingVersionId,
    originSha256: sha256(origin),
    accessPolicySha256,
    stagingVersionAttestationSha256,
    stagingDeploymentStatusSha256,
    stagingMediaProbeSha256,
    ...evidence,
    observedAt,
    expiresAt,
  };
}

const STAGING_ADMISSION_SMOKE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'artifactSha256', 'payloadSha256',
  'stagingVersionId', 'originSha256', 'accessPolicySha256',
  'stagingVersionAttestationSha256', 'stagingDeploymentStatusSha256',
  'rawProbeEvidenceSha256', 'stagingMediaProbeSha256',
  'syntheticNonAccessOrigin', 'get200', 'head200', 'notModified304', 'range206',
  'range416', 'mimeVerified', 'etagVerified', 'static200', 'notFound404', 'redirects308',
  'redirectBodiesEmpty', 'redirectQueryDiscarded', 'redirectCount',
  'redirectGetRequestCount', 'redirectHeadRequestCount', 'redirectRequestCount',
  'mediaRequestCount', 'staticRequestCount', 'notFoundRequestCount',
  'cacheProbeRequestCount', 'authenticatedRequestCount', 'unauthenticatedRequestCount',
  'totalRequestCount', 'cachePathVerified', 'stagingDeployment100', 'unauthenticatedDenied',
  'versionMarkerVerified', 'observedAt', 'expiresAt',
]);

export function canonicalStagingAdmissionSmokePayload(receipt) {
  return canonicalJson(Object.fromEntries(
    STAGING_ADMISSION_SMOKE_KEYS.map((key) => [key, receipt[key]])));
}

export function validateStagingAdmissionSmokeReceipt(receipt, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 900,
} = {}) {
  if (!receipt || Object.keys(receipt).length !== STAGING_ADMISSION_SMOKE_KEYS.length
    || Object.keys(receipt).some((key) => !STAGING_ADMISSION_SMOKE_KEYS.includes(key))
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-admission-smoke-v1'
    || receipt.environment !== 'staging'
    || ![receipt.artifactSha256, receipt.payloadSha256, receipt.originSha256,
      receipt.accessPolicySha256, receipt.stagingVersionAttestationSha256,
      receipt.stagingDeploymentStatusSha256, receipt.rawProbeEvidenceSha256,
      receipt.stagingMediaProbeSha256].every((value) => SHA256.test(value ?? ''))
    || !UUID.test(receipt.stagingVersionId ?? '')
    || receipt.syntheticNonAccessOrigin !== true
    || !['get200', 'head200', 'notModified304', 'range206', 'range416', 'mimeVerified',
      'etagVerified', 'static200', 'notFound404', 'redirects308', 'redirectBodiesEmpty',
      'redirectQueryDiscarded', 'cachePathVerified',
      'versionMarkerVerified'].every((key) => receipt[key] === true)
    || receipt.stagingDeployment100 !== true || receipt.unauthenticatedDenied !== true
    || receipt.redirectCount !== 349
    || receipt.redirectGetRequestCount !== 349 || receipt.redirectHeadRequestCount !== 349
    || receipt.redirectRequestCount !== 698 || receipt.mediaRequestCount !== 5
    || receipt.staticRequestCount !== 2 || receipt.notFoundRequestCount !== 2
    || !Number.isSafeInteger(receipt.cacheProbeRequestCount)
    || receipt.cacheProbeRequestCount < 1 || receipt.cacheProbeRequestCount > 3
    || receipt.authenticatedRequestCount !== 707 + receipt.cacheProbeRequestCount
    || receipt.unauthenticatedRequestCount !== 1
    || receipt.totalRequestCount !== 708 + receipt.cacheProbeRequestCount
    || Number.isNaN(Date.parse(receipt.observedAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) {
    fail('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!STAGING_ADMISSION_SMOKE_KEYS.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_EXPECTED');
    }
  }
  const observed = Date.parse(receipt.observedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < observed - 120000 || now.getTime() >= expires
    || expires <= observed || expires - observed > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_EXPIRED');
  }
  return receipt;
}

export async function collectStagingAdmissionSmokeEvidence({
  fetcher,
  unauthenticatedFetcher,
  origin,
  artifactSha256,
  payloadSha256,
  stagingVersionId,
  accessPolicySha256,
  stagingVersionAttestationSha256,
  stagingDeploymentStatusSha256,
  stagingMediaProbeSha256,
  stagingDeployment100,
  mediaEntry,
  staticEntry,
  redirects,
  limits = STAGING_SMOKE_LIMITS,
  observedAt,
  expiresAt,
}) {
  const evidence = await collectStagingHttpContract({
    fetcher, unauthenticatedFetcher, origin, stagingVersionId, stagingDeployment100,
    mediaEntry, staticEntry, redirects, limits,
  });
  const receipt = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-staging-admission-smoke-v1',
    environment: 'staging',
    artifactSha256,
    payloadSha256,
    stagingVersionId,
    originSha256: sha256(origin),
    accessPolicySha256,
    stagingVersionAttestationSha256,
    stagingDeploymentStatusSha256,
    stagingMediaProbeSha256,
    ...evidence,
    observedAt,
    expiresAt,
  };
  validateStagingAdmissionSmokeReceipt(receipt, { now: new Date(observedAt) });
  return receipt;
}

export async function probeStagingMediaObject({
  client,
  fetcher,
  origin,
  entry,
  stagingVersionId,
  limits = STAGING_SMOKE_LIMITS,
}) {
  if (!client || typeof client.head !== 'function' || typeof fetcher !== 'function') {
    fail('CLOUDFLARE_E_STAGING_PROBE_INPUT');
  }
  const canonicalOrigin = validateSmokeOrigin(origin);
  validateSmokeMediaEntry(entry);
  if (!UUID.test(stagingVersionId ?? '')) fail('CLOUDFLARE_E_STAGING_PROBE_INPUT');
  const guard = createSmokeRequestGuard(limits, canonicalOrigin);
  const remote = await client.head(entry.key);
  if (!remoteObjectMatches(entry, remote)) {
    fail('CLOUDFLARE_E_STAGING_PROBE_S3');
  }
  const url = new URL(entry.publicPath, canonicalOrigin).href;
  const fullResult = await guard.request(
    fetcher,
    url,
    { method: 'GET' },
    async (response, signal) => ({
      response,
      body: await guard.readBody(response, entry.size, signal),
    }),
  );
  const rangeResult = await guard.request(
    fetcher,
    url,
    { headers: { range: 'bytes=0-0' } },
    async (response, signal) => ({
      response,
      body: await guard.readBody(response, 1, signal),
    }),
  );
  const { response: full, body: fullBody } = fullResult;
  const { response: range, body: rangeBody } = rangeResult;
  if (full.status !== 200 || fullBody.length !== entry.size || sha256(fullBody) !== entry.sha256
    || full.headers.get('etag') !== remote.httpEtag
    || normalizedMime(full) !== entry.contentType
    || range.status !== 206 || range.headers.get('etag') !== remote.httpEtag
    || normalizedMime(range) !== entry.contentType
    || range.headers.get('content-range') !== `bytes 0-0/${entry.size}`
    || range.headers.get('content-length') !== '1'
    || rangeBody.length !== 1 || fullBody.length === 0 || rangeBody[0] !== fullBody[0]
    || full.headers.get('x-dwnc-staging-version') !== stagingVersionId
    || range.headers.get('x-dwnc-staging-version') !== stagingVersionId) {
    fail('CLOUDFLARE_E_STAGING_PROBE_WORKER');
  }
  return {
    keySha256: sha256(entry.key),
    versionSha256: sha256(r2S3VersionEvidence(remote.version)),
    httpEtagSha256: sha256(remote.httpEtag),
    s3HeadVerified: true,
    workerBindingVerified: true,
    fullBodySha256Verified: true,
    rangeVerified: true,
  };
}
