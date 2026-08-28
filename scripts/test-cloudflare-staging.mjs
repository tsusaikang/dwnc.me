import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import edgeRedirectManifest from '../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import publicSequence from '../src/data/public-sequence-v1.json' with { type: 'json' };
import {
  collectStagingAdmissionSmokeEvidence,
  collectStagingSmokeEvidence,
  probeStagingMediaObject,
  validateStagingAdmissionSmokeReceipt,
} from './lib/cloudflare-staging.mjs';
import {
  renderCloudflareRedirects,
  validateStagingSmokeRedirectAuthority,
} from './lib/cloudflare-redirects.mjs';
import {
  runBoundedStagingSmokeChild,
  runStagingSmokeAfterLocalPreflight,
} from './lib/cloudflare-process.mjs';
import { validateStagingSmokeReceipt } from './lib/cloudflare-release.mjs';
import { publicMediaEntryManifestSha256 } from './lib/public-media-manifest.mjs';
import { R2S3Client } from './lib/r2-s3-client.mjs';
import { MockAgent, fetch as undiciFetch } from 'undici';

const bytes = Buffer.from('fixture-media');
const entry = {
  publicPath: '/media/native/fixture.bin', key: 'media/native/fixture.bin', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), contentType: 'application/octet-stream',
  cacheControl: 'public, max-age=31536000, immutable',
};
const staticBytes = Buffer.from('fixture-about');
const staticEntry = {
  publicPath: '/about', size: staticBytes.length,
  sha256: createHash('sha256').update(staticBytes).digest('hex'), contentType: 'text/html',
};
const redirects = structuredClone(edgeRedirectManifest.redirects);
const stagingVersionId = '22345678-1234-4123-8123-123456789abc';
let assertions = 0;
const equal = (...args) => { assert.equal(...args); assertions += 1; };
const throws = (...args) => { assert.throws(...args); assertions += 1; };
const rejects = async (...args) => { await assert.rejects(...args); assertions += 1; };
const responseAt = (response, input) => {
  Object.defineProperty(response, 'url', {
    configurable: true, value: new URL(input).href,
  });
  return response;
};
const deniedRedirectModes = [];
const deniedFetcher = async (input, init = {}) => {
  deniedRedirectModes.push(init.redirect);
  return responseAt(new Response('denied', { status: 401 }), input);
};
const createFetcher = ({
  rangeByte = bytes[0],
  rangeEtag = '"fixture-etag"',
  rangeContentRange = `bytes 0-0/${entry.size}`,
  rangeContentLength = '1',
  redirectHeadStatus = 308,
  redirectBody = false,
  echoRedirectQuery = false,
  notFoundCacheControl = 'no-store',
  aboutBody = staticBytes,
  aboutContentType = 'text/html; charset=utf-8',
  aboutContentLength = String(aboutBody.length),
  cacheBody = bytes,
  cacheEtag = '"fixture-etag"',
  cacheContentType = entry.contentType,
  cacheContentLength = String(cacheBody.length),
  conditionalEtag = '"fixture-etag"',
  conditionalBody = null,
  invalidRangeEtag = '"fixture-etag"',
  invalidRangeContentRange = `bytes */${entry.size}`,
  invalidRangeBody = null,
  onUnusedBodyCancel = () => undefined,
  onBoundedBodyCancel = () => undefined,
} = {}) => {
  const calls = [];
  let abortEvents = 0;
  const trackedOpenBody = (body) => new ReadableStream({
    start(controller) {
      if (body !== null) controller.enqueue(Buffer.from(body));
    },
    cancel() { onBoundedBodyCancel(); },
  });
  const responseForStatus = (body, status, headers, input) => {
    if (body !== null && status === 304) {
      return {
        status, headers: new Headers(headers), body: trackedOpenBody(body), url: new URL(input).href,
      };
    }
    return responseAt(new Response(body, { status, headers }), input);
  };
  const fixtureFetcher = async (input, init = {}) => {
    const url = new URL(input);
    const requestHeaders = new Headers(init.headers);
    const headers = new Headers();
    init.signal?.addEventListener('abort', () => { abortEvents += 1; }, { once: true });
    calls.push({
      url: url.href, method: init.method ?? 'GET', redirect: init.redirect, headers: requestHeaders,
    });
    headers.set('x-dwnc-staging-version', stagingVersionId);
    if (url.pathname === entry.publicPath) {
      headers.set('etag', '"fixture-etag"');
      headers.set('content-type', entry.contentType);
      headers.set('content-length', String(entry.size));
      if (init.method === 'HEAD') return responseAt(new Response(null, { status: 200, headers }), input);
      if (requestHeaders.has('if-none-match')) {
        headers.delete('content-length');
        if (conditionalEtag === null) headers.delete('etag');
        else headers.set('etag', conditionalEtag);
        return responseForStatus(conditionalBody, 304, headers, input);
      }
      if (requestHeaders.get('range') === 'bytes=0-0,2-2') {
        headers.set('content-length', String(invalidRangeBody?.length ?? 0));
        if (invalidRangeEtag === null) headers.delete('etag');
        else headers.set('etag', invalidRangeEtag);
        if (invalidRangeContentRange === null) headers.delete('content-range');
        else headers.set('content-range', invalidRangeContentRange);
        if (invalidRangeBody !== null) {
          return {
            status: 416, headers, body: trackedOpenBody(invalidRangeBody), url: url.href,
          };
        }
        return responseAt(new Response(null, { status: 416, headers }), input);
      }
      if (requestHeaders.get('range') === 'bytes=0-0') {
        headers.set('etag', rangeEtag);
        headers.set('content-length', rangeContentLength);
        if (rangeContentRange !== null) headers.set('content-range', rangeContentRange);
        return responseAt(new Response(Buffer.from([rangeByte]), { status: 206, headers }), input);
      }
      if (requestHeaders.has('x-dwnc-smoke-cache-probe')) {
        headers.set('x-dwnc-cache-probe', 'HIT');
        headers.set('etag', cacheEtag);
        headers.set('content-type', cacheContentType);
        headers.set('content-length', cacheContentLength);
        return responseAt(new Response(cacheBody, { status: 200, headers }), input);
      }
      return responseAt(new Response(bytes, { status: 200, headers }), input);
    }
    if (url.pathname === '/about') {
      headers.set('content-type', aboutContentType);
      headers.set('content-length', aboutContentLength);
      return responseAt(new Response(
        init.method === 'HEAD' ? null : aboutBody, { status: 200, headers },
      ), input);
    }
    if (url.pathname === '/404.html') {
      headers.set('cache-control', notFoundCacheControl);
      if (init.method === 'HEAD') return responseAt(new Response(null, { status: 404, headers }), input);
      const body = new ReadableStream({
        start(controller) { controller.enqueue(Buffer.from('not found')); },
        cancel() { onUnusedBodyCancel(); },
      });
      return responseAt(new Response(body, { status: 404, headers }), input);
    }
    const redirect = redirects.find((value) => value.from === url.pathname);
    if (redirect) {
      headers.set('location', `${redirect.to}${echoRedirectQuery ? url.search : ''}`);
      return responseAt(new Response(redirectBody && init.method !== 'HEAD' ? 'unexpected body' : null, {
        status: init.method === 'HEAD' ? redirectHeadStatus : 308,
        headers,
      }), input);
    }
    return responseAt(new Response('not found', { status: 404 }), input);
  };
  fixtureFetcher.calls = calls;
  fixtureFetcher.abortEvents = () => abortEvents;
  return fixtureFetcher;
};
let unusedBodyCancellations = 0;
const fetcher = createFetcher({ onUnusedBodyCancel: () => { unusedBodyCancellations += 1; } });
const fastLimits = { requestTimeoutMs: 200, totalTimeoutMs: 30_000, cancelTimeoutMs: 20 };

const smoke = await collectStagingSmokeEvidence({
  fetcher, unauthenticatedFetcher: deniedFetcher,
  origin: 'https://synthetic-staging.example.test', artifactSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64), versionId: '12345678-1234-4123-8123-123456789abc',
  stagingVersionId,
  accessPolicySha256: 'c'.repeat(64), stagingVersionAttestationSha256: 'd'.repeat(64),
  stagingDeploymentStatusSha256: 'e'.repeat(64), stagingDeployment100: true, mediaEntry: entry,
  stagingMediaProbeSha256: 'f'.repeat(64),
  staticEntry, redirects, limits: fastLimits, observedAt: '2026-08-25T00:00:00.000Z',
  expiresAt: '2026-08-25T00:10:00.000Z',
});
validateStagingSmokeReceipt(smoke, { now: new Date('2026-08-25T00:05:00.000Z') });
equal(smoke.redirectCount, 349);
equal(smoke.redirectGetRequestCount, 349);
equal(smoke.redirectHeadRequestCount, 349);
equal(smoke.redirectRequestCount, 698);
equal(smoke.redirectBodiesEmpty, true);
equal(smoke.redirectQueryDiscarded, true);
equal(smoke.staticRequestCount, 2);
equal(smoke.notFound404, true);
equal(smoke.notFoundRequestCount, 2);
equal(smoke.mediaRequestCount, 5);
equal(smoke.cacheProbeRequestCount, 1);
equal(smoke.authenticatedRequestCount, 708);
equal(smoke.unauthenticatedRequestCount, 1);
equal(smoke.totalRequestCount, 709);
equal(fetcher.calls.length, 708);
equal(fetcher.calls.every((call) => call.redirect === 'manual'), true);
equal(deniedRedirectModes.every((mode) => mode === 'manual'), true);
equal(smoke.cachePathVerified, true);
equal(unusedBodyCancellations > 0, true);
await new Promise((resolve) => setTimeout(resolve, 250));
equal(fetcher.abortEvents(), 0);

let mockS3Calls = 0;
const client = new R2S3Client({
  accountId: 'a'.repeat(32),
  bucket: 'dwnc-me-public-media-staging',
  accessKeyId: 'b'.repeat(32),
  secretAccessKey: 'c'.repeat(64),
  fetchImpl: async (_url, init) => {
    mockS3Calls += 1;
    equal(init.method, 'HEAD');
    return new Response(null, { status: 200, headers: {
      'content-length': String(entry.size),
      'content-type': entry.contentType,
      'cache-control': entry.cacheControl,
      etag: '"fixture-etag"',
      'x-amz-meta-sha256': entry.sha256,
      'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
      'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(entry),
      'x-amz-checksum-sha256': Buffer.from(entry.sha256, 'hex').toString('base64'),
      'last-modified': 'Thu, 27 Aug 2026 00:00:00 GMT',
    } });
  },
  delay: async () => undefined,
  maxAttempts: 1,
});
const probe = await probeStagingMediaObject({
  client,
  fetcher,
  origin: 'https://synthetic-staging.example.test',
  entry,
  stagingVersionId,
});
equal(probe.s3HeadVerified, true);
equal(probe.workerBindingVerified, true);
equal(mockS3Calls, 1);

const invalidRangeFetchers = [
  createFetcher({ rangeByte: bytes[0] ^ 0xff }),
  createFetcher({ rangeEtag: '"wrong-etag"' }),
  createFetcher({ rangeContentRange: null }),
  createFetcher({ rangeContentRange: `bytes 1-1/${entry.size}` }),
  createFetcher({ rangeContentLength: '2' }),
];
for (const invalidFetcher of invalidRangeFetchers) {
  await rejects(() => probeStagingMediaObject({
    client,
    fetcher: invalidFetcher,
    origin: 'https://synthetic-staging.example.test',
    entry,
    stagingVersionId,
  }));
}

const admissionSmoke = await collectStagingAdmissionSmokeEvidence({
  fetcher, unauthenticatedFetcher: deniedFetcher,
  origin: 'https://synthetic-staging.example.test', artifactSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64), stagingVersionId,
  accessPolicySha256: 'c'.repeat(64), stagingVersionAttestationSha256: 'd'.repeat(64),
  stagingDeploymentStatusSha256: 'e'.repeat(64), stagingDeployment100: true,
  stagingMediaProbeSha256: 'f'.repeat(64), mediaEntry: entry, staticEntry, redirects,
  observedAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-25T00:10:00.000Z',
});
validateStagingAdmissionSmokeReceipt(admissionSmoke, {
  now: new Date('2026-08-25T00:05:00.000Z'),
});
equal(admissionSmoke.redirectCount, 349);
equal(admissionSmoke.redirectRequestCount, 698);
equal(admissionSmoke.totalRequestCount, 709);
equal('versionId' in admissionSmoke, false);
throws(() => validateStagingSmokeReceipt(admissionSmoke, {
  now: new Date('2026-08-25T00:05:00.000Z'),
}));
throws(() => validateStagingAdmissionSmokeReceipt(smoke, {
  now: new Date('2026-08-25T00:05:00.000Z'),
}));
for (const invalidFetcher of invalidRangeFetchers) {
  await rejects(() => collectStagingAdmissionSmokeEvidence({
    fetcher: invalidFetcher,
    unauthenticatedFetcher: deniedFetcher,
    origin: 'https://synthetic-staging.example.test', artifactSha256: 'a'.repeat(64),
    payloadSha256: 'b'.repeat(64), stagingVersionId,
    accessPolicySha256: 'c'.repeat(64), stagingVersionAttestationSha256: 'd'.repeat(64),
    stagingDeploymentStatusSha256: 'e'.repeat(64), stagingDeployment100: true,
    stagingMediaProbeSha256: 'f'.repeat(64), mediaEntry: entry, staticEntry, redirects,
    observedAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-25T00:10:00.000Z',
  }));
}

for (const [invalidFetcher, expectedCalls] of [
  [createFetcher({ redirectHeadStatus: 307 }), 708],
  [createFetcher({ redirectBody: true }), 10],
  [createFetcher({ echoRedirectQuery: true }), 708],
  [createFetcher({ notFoundCacheControl: 'public, max-age=60' }), 708],
]) {
  await rejects(() => collectStagingAdmissionSmokeEvidence({
    fetcher: invalidFetcher,
    unauthenticatedFetcher: deniedFetcher,
    origin: 'https://synthetic-staging.example.test', artifactSha256: 'a'.repeat(64),
    payloadSha256: 'b'.repeat(64), stagingVersionId,
    accessPolicySha256: 'c'.repeat(64), stagingVersionAttestationSha256: 'd'.repeat(64),
    stagingDeploymentStatusSha256: 'e'.repeat(64), stagingDeployment100: true,
    stagingMediaProbeSha256: 'f'.repeat(64), mediaEntry: entry, staticEntry, redirects,
    observedAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-25T00:10:00.000Z',
  }));
  equal(invalidFetcher.calls.length, expectedCalls);
}

const admissionArguments = ({
  candidateFetcher,
  unauthenticatedFetcher = deniedFetcher,
  candidateRedirects = redirects,
  candidateStaticEntry = staticEntry,
  candidateLimits = fastLimits,
}) => ({
  fetcher: candidateFetcher,
  unauthenticatedFetcher,
  origin: 'https://synthetic-staging.example.test',
  artifactSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64),
  stagingVersionId,
  accessPolicySha256: 'c'.repeat(64),
  stagingVersionAttestationSha256: 'd'.repeat(64),
  stagingDeploymentStatusSha256: 'e'.repeat(64),
  stagingMediaProbeSha256: 'f'.repeat(64),
  stagingDeployment100: true,
  mediaEntry: entry,
  staticEntry: candidateStaticEntry,
  redirects: candidateRedirects,
  limits: candidateLimits,
  observedAt: '2026-08-25T00:00:00.000Z',
  expiresAt: '2026-08-25T00:10:00.000Z',
});

const canonicalRedirectBytes = Buffer.from(
  renderCloudflareRedirects(edgeRedirectManifest, publicSequence), 'utf8',
);
const canonicalRedirectSha256 = createHash('sha256')
  .update(canonicalRedirectBytes).digest('hex');
const canonicalRedirectAuthority = validateStagingSmokeRedirectAuthority({
  manifest: edgeRedirectManifest,
  projection: publicSequence,
  trackedRedirects: canonicalRedirectBytes,
  sealedRedirects: canonicalRedirectBytes,
  receiptRedirectsSha256: canonicalRedirectSha256,
});
equal(canonicalRedirectAuthority.redirectCount, 349);

const canonicalRedirectLines = canonicalRedirectBytes.toString('utf8').trimEnd().split('\n');
const alteredRedirectFiles = [
  ['absolute', ['https://attacker.example/steal', ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
  ['protocol-relative', ['//attacker.example/steal', ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
  ['query', [`${canonicalRedirectLines[0].split(' ')[0]}?leak=1`, ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
  ['backslash', [`${canonicalRedirectLines[0].split(' ')[0]}\\leak`, ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
  ['duplicate', canonicalRedirectLines[1]],
  ['extra-token', `${canonicalRedirectLines[0]} unexpected`],
].map(([name, firstLine]) => [
  name,
  Buffer.from(`${[firstLine, ...canonicalRedirectLines.slice(1)].join('\n')}\n`, 'utf8'),
]);
for (const [, alteredRedirectBytes] of alteredRedirectFiles) {
  let tokenReadCount = 0;
  let childStartCount = 0;
  await rejects(() => runStagingSmokeAfterLocalPreflight({
    preflight: async () => validateStagingSmokeRedirectAuthority({
      manifest: edgeRedirectManifest,
      projection: publicSequence,
      trackedRedirects: alteredRedirectBytes,
      sealedRedirects: canonicalRedirectBytes,
      receiptRedirectsSha256: canonicalRedirectSha256,
    }),
    readToken: async () => {
      tokenReadCount += 1;
      return Buffer.alloc(43, 0x61);
    },
    startChild: async () => { childStartCount += 1; },
  }), /REDIRECT_E_SMOKE_AUTHORITY/u);
  equal(tokenReadCount, 0);
  equal(childStartCount, 0);
}

{
  const controller = new AbortController();
  let releasePreflight;
  let secretReadCount = 0;
  let childStartCount = 0;
  const preflight = new Promise((resolve) => { releasePreflight = resolve; });
  const workflow = runStagingSmokeAfterLocalPreflight({
    signal: controller.signal,
    preflight: async () => preflight,
    readToken: async () => { secretReadCount += 1; return Buffer.alloc(43, 0x41); },
    startChild: async () => { childStartCount += 1; },
  });
  controller.abort('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
  releasePreflight();
  await rejects(() => workflow, /CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT/u);
  equal(secretReadCount, 0);
  equal(childStartCount, 0);
}

const alteredRedirectRosters = [
  redirects.map((value, index) => index === 0
    ? { ...value, from: 'https://attacker.example/steal' } : value),
  redirects.map((value, index) => index === 0
    ? { ...value, from: '//attacker.example/steal' } : value),
  redirects.map((value, index) => index === 0 ? { ...value, from: `${value.from}?leak=1` } : value),
  redirects.map((value, index) => index === 0 ? { ...value, from: `${value.from}\\leak` } : value),
  redirects.map((value, index) => index === 1 ? { ...value, from: redirects[0].from } : value),
  redirects.map((value, index) => index === 0 ? { ...value, unexpected: true } : value),
];
for (const alteredRoster of alteredRedirectRosters) {
  let fetchCount = 0;
  const mustNotFetch = async () => {
    fetchCount += 1;
    throw new Error('unexpected fetch');
  };
  await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
    candidateFetcher: mustNotFetch,
    unauthenticatedFetcher: mustNotFetch,
    candidateRedirects: alteredRoster,
  })), /CLOUDFLARE_E_SMOKE_REDIRECTS/u);
  equal(fetchCount, 0);
}

for (const brokenFetcher of [
  createFetcher({ aboutBody: Buffer.from('fixture-abouu') }),
  createFetcher({ aboutBody: staticBytes.subarray(0, staticBytes.length - 1) }),
  createFetcher({ aboutContentLength: String(staticBytes.length - 1) }),
  createFetcher({ aboutContentType: 'application/octet-stream' }),
  createFetcher({ cacheBody: Buffer.from('fixture-mediZ') }),
  createFetcher({ cacheBody: bytes.subarray(0, bytes.length - 1) }),
  createFetcher({ cacheContentLength: String(bytes.length - 1) }),
  createFetcher({ cacheEtag: '"wrong-etag"' }),
  createFetcher({ cacheContentType: 'text/plain' }),
  createFetcher({ conditionalEtag: null }),
  createFetcher({ invalidRangeEtag: null }),
  createFetcher({ invalidRangeEtag: '"wrong-etag"' }),
  createFetcher({ invalidRangeContentRange: null }),
  createFetcher({ invalidRangeContentRange: `bytes */${entry.size + 1}` }),
]) {
  await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
    candidateFetcher: brokenFetcher,
  })));
}

let conditionalBodyCancellationCount = 0;
await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
  candidateFetcher: createFetcher({
    conditionalBody: Buffer.from('x'),
    onBoundedBodyCancel: () => { conditionalBodyCancellationCount += 1; },
  }),
})), /CLOUDFLARE_E_SMOKE_BODY_LIMIT/u);
equal(conditionalBodyCancellationCount > 0, true);

let invalidRangeBodyCancellationCount = 0;
await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
  candidateFetcher: createFetcher({
    invalidRangeBody: Buffer.from('x'),
    onBoundedBodyCancel: () => { invalidRangeBodyCancellationCount += 1; },
  }),
})), /CLOUDFLARE_E_SMOKE_BODY_LIMIT/u);
equal(invalidRangeBodyCancellationCount > 0, true);

let requestTimeoutFetchCount = 0;
let requestTimeoutAbortCount = 0;
const requestTimeoutFetcher = async (_input, init) => {
  requestTimeoutFetchCount += 1;
  return new Promise(() => {
    init.signal.addEventListener('abort', () => { requestTimeoutAbortCount += 1; }, { once: true });
  });
};
await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
  candidateFetcher: requestTimeoutFetcher,
  candidateLimits: { requestTimeoutMs: 20, totalTimeoutMs: 500, cancelTimeoutMs: 10 },
})), /CLOUDFLARE_E_SMOKE_REQUEST_TIMEOUT/u);
equal(requestTimeoutFetchCount, 1);
equal(requestTimeoutAbortCount, 1);

let totalTimeoutFetchCount = 0;
let totalTimeoutAbortCount = 0;
const totalTimeoutFetcher = async (_input, init) => {
  totalTimeoutFetchCount += 1;
  return new Promise(() => {
    init.signal.addEventListener('abort', () => { totalTimeoutAbortCount += 1; }, { once: true });
  });
};
await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
  candidateFetcher: totalTimeoutFetcher,
  candidateLimits: { requestTimeoutMs: 200, totalTimeoutMs: 20, cancelTimeoutMs: 10 },
})), /CLOUDFLARE_E_SMOKE_TOTAL_TIMEOUT/u);
equal(totalTimeoutFetchCount, 1);
equal(totalTimeoutAbortCount, 1);

let lateResponseResolve;
let lateResponsePending = 0;
let lateResponseCancelCount = 0;
let lateResponseBody;
const lateResponseFetcher = async (input, init) => {
  lateResponsePending += 1;
  return new Promise((resolve) => {
    lateResponseResolve = () => {
      lateResponsePending -= 1;
      lateResponseBody = new ReadableStream({
        cancel() { lateResponseCancelCount += 1; },
      });
      resolve({
        status: 200,
        headers: new Headers({
          'content-length': String(entry.size),
          'content-type': entry.contentType,
          etag: '"fixture-etag"',
          'x-dwnc-staging-version': stagingVersionId,
        }),
        url: new URL(input).href,
        body: lateResponseBody,
      });
    };
    init.signal.addEventListener('abort', () => undefined, { once: true });
  });
};
await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
  candidateFetcher: lateResponseFetcher,
  candidateLimits: { requestTimeoutMs: 20, totalTimeoutMs: 500, cancelTimeoutMs: 10 },
})), /CLOUDFLARE_E_SMOKE_REQUEST_TIMEOUT/u);
equal(lateResponsePending, 1);
lateResponseResolve();
for (let attempt = 0; attempt < 20 && lateResponseCancelCount === 0; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
equal(lateResponseCancelCount, 1);
equal(lateResponseBody.locked, false);
equal(lateResponsePending, 0);

let endlessBodyCancelCount = 0;
let endlessBodyAbortCount = 0;
const endlessBodyFetcher = async (input, init) => {
  init.signal.addEventListener('abort', () => { endlessBodyAbortCount += 1; }, { once: true });
  const headers = new Headers({
    'content-length': String(entry.size),
    'content-type': entry.contentType,
    etag: '"fixture-etag"',
    'x-dwnc-staging-version': stagingVersionId,
  });
  return {
    status: 200,
    headers,
    url: new URL(input).href,
    body: new ReadableStream({ cancel() { endlessBodyCancelCount += 1; } }),
  };
};
await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
  candidateFetcher: endlessBodyFetcher,
  candidateLimits: { requestTimeoutMs: 20, totalTimeoutMs: 500, cancelTimeoutMs: 10 },
})), /CLOUDFLARE_E_SMOKE_REQUEST_TIMEOUT/u);
equal(endlessBodyAbortCount, 1);
equal(endlessBodyCancelCount > 0, true);

let oversizedBodyFetchCount = 0;
let oversizedBodyCancelCount = 0;
const oversizedBodyFetcher = async (input) => {
  oversizedBodyFetchCount += 1;
  const headers = new Headers({
    'content-length': String(entry.size + 1),
    'content-type': entry.contentType,
    etag: '"fixture-etag"',
    'x-dwnc-staging-version': stagingVersionId,
  });
  return {
    status: 200,
    headers,
    url: new URL(input).href,
    body: new ReadableStream({ cancel() { oversizedBodyCancelCount += 1; } }),
  };
};
await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
  candidateFetcher: oversizedBodyFetcher,
})), /CLOUDFLARE_E_SMOKE_BODY_LIMIT/u);
equal(oversizedBodyFetchCount, 1);
equal(oversizedBodyCancelCount, 1);

for (const observedUrl of [
  'https://synthetic-staging.example.test/wrong',
  'https://attacker.example/wrong',
]) {
  const responseUrlMismatchFetcher = async (input, init) => {
    const response = await createFetcher()(input, init);
    Object.defineProperty(response, 'url', { configurable: true, value: observedUrl });
    return response;
  };
  await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
    candidateFetcher: responseUrlMismatchFetcher,
  })), /CLOUDFLARE_E_SMOKE_RESPONSE_URL/u);
}

for (const status of [301, 302, 307, 308]) {
  for (const target of ['/followed', 'https://attacker.example/followed']) {
    const agent = new MockAgent();
    agent.disableNetConnect();
    let targetRequestCount = 0;
    agent.get('https://synthetic-staging.example.test')
      .intercept({ path: entry.publicPath, method: 'GET' })
      .reply(status, '', { headers: { location: target } });
    if (target.startsWith('/')) {
      agent.get('https://synthetic-staging.example.test')
        .intercept({ path: target, method: 'GET' })
        .reply(() => { targetRequestCount += 1; return { statusCode: 200, data: 'followed' }; });
    } else {
      agent.get('https://attacker.example')
        .intercept({ path: '/followed', method: 'GET' })
        .reply(() => { targetRequestCount += 1; return { statusCode: 200, data: 'followed' }; });
    }
    let initialRequestCount = 0;
    const realManualFetcher = async (input, init) => {
      initialRequestCount += 1;
      equal(init.redirect, 'manual');
      return undiciFetch(input, { ...init, dispatcher: agent });
    };
    await rejects(() => collectStagingAdmissionSmokeEvidence(admissionArguments({
      candidateFetcher: realManualFetcher,
    })), /CLOUDFLARE_E_SMOKE_RESPONSE_URL/u);
    equal(initialRequestCount, 1);
    equal(targetRequestCount, 0);
    await agent.close();
  }
}

const childLimits = {
  totalTimeoutMs: 100,
  gracefulTerminationMs: 10,
  forcedSettleMs: 10,
  maximumOutputBytes: 1024,
};
const childArguments = (spawnChild) => {
  const startedAt = Date.now();
  return {
    command: process.execPath,
    args: ['fixture-child'],
    cwd: process.cwd(),
    env: {},
    tokenBytes: Buffer.from('A'.repeat(43)),
    operationDeadlineEpochMs: startedAt + 80,
    finalDeadlineEpochMs: startedAt + 100,
    spawnChild,
    limits: childLimits,
  };
};
function fakeChild({
  closeCode,
  closeSignal = null,
  closeDelayMs = 0,
  closeOnSignal = null,
  hangingOutput = false,
  hangingInput = false,
} = {}) {
  const child = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const tokenPipe = hangingInput ? new Writable({ write() {} }) : new PassThrough();
  if (!hangingInput) tokenPipe.resume();
  child.stdio = ['ignore', stdout, stderr, tokenPipe];
  child.kills = [];
  let closed = false;
  const close = (code = closeCode, signal = closeSignal) => {
    if (closed) return;
    closed = true;
    if (!hangingOutput) {
      stdout.end('fixture-output');
      stderr.end();
    }
    child.emit('close', code, signal);
  };
  child.kill = (signal) => {
    child.kills.push(signal);
    if (signal === closeOnSignal) setTimeout(() => close(null, signal), closeDelayMs);
    return true;
  };
  if (closeCode !== undefined) setTimeout(close, closeDelayMs);
  return child;
}

{
  let child;
  const result = await runBoundedStagingSmokeChild(childArguments(() => {
    child = fakeChild({ closeCode: 0 });
    return child;
  }));
  equal(result.stdout.toString('utf8'), 'fixture-output');
  equal(result.stderr.length, 0);
  equal(child.kills.length, 0);
  result.stdout.fill(0);
  result.stderr.fill(0);
}
{
  let child;
  await rejects(() => runBoundedStagingSmokeChild(childArguments(() => {
    child = fakeChild({ closeCode: null, closeSignal: 'SIGUSR1' });
    return child;
  })), /CLOUDFLARE_E_SMOKE_RUNNER_CHILD_SIGNAL/u);
  equal(child.kills.length, 0);
}
{
  let child;
  await rejects(() => runBoundedStagingSmokeChild(childArguments(() => {
    child = fakeChild();
    return child;
  })), /CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT/u);
  equal(child.kills.join(','), 'SIGTERM,SIGKILL');
}
{
  let child;
  await rejects(() => runBoundedStagingSmokeChild(childArguments(() => {
    child = fakeChild({ closeOnSignal: 'SIGTERM', closeDelayMs: 2 });
    return child;
  })), /CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT/u);
  equal(child.kills.join(','), 'SIGTERM');
}
{
  let child;
  await rejects(() => runBoundedStagingSmokeChild(childArguments(() => {
    child = fakeChild({ closeCode: 0, hangingOutput: true });
    return child;
  })), /CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT/u);
  equal(child.kills.length, 0);
}
{
  let child;
  await rejects(() => runBoundedStagingSmokeChild(childArguments(() => {
    child = fakeChild({ hangingInput: true });
    return child;
  })), /CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT/u);
  equal(child.kills.join(','), 'SIGTERM,SIGKILL');
}

for (const [key, value] of [
  ['redirectGetRequestCount', 348],
  ['redirectHeadRequestCount', 350],
  ['redirectRequestCount', 697],
  ['mediaRequestCount', 4],
  ['staticRequestCount', 1],
  ['notFoundRequestCount', 1],
  ['cacheProbeRequestCount', 0],
  ['authenticatedRequestCount', 707],
  ['unauthenticatedRequestCount', 0],
  ['totalRequestCount', 708],
]) {
  throws(() => validateStagingAdmissionSmokeReceipt({ ...admissionSmoke, [key]: value }, {
    now: new Date('2026-08-25T00:05:00.000Z'),
  }));
}
console.log(JSON.stringify({
  suite: 'cloudflare-staging-evidence', assertions, redirects: 349,
  redirectRequests: 698, totalRequestsWithFirstCacheHit: 709,
  actualR2ClientIntegrated: true, productionSmokeContractPreserved: true,
  stagingAdmissionRequiresProductionAttestation: false,
  accessProtectedCacheAssumed: false, liveNetworkCalls: 0, deploymentAttempts: 0, status: 'PASS',
}, null, 2));
