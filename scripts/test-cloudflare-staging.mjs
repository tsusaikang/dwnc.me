import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  collectStagingAdmissionSmokeEvidence,
  collectStagingSmokeEvidence,
  probeStagingMediaObject,
  validateStagingAdmissionSmokeReceipt,
} from './lib/cloudflare-staging.mjs';
import { validateStagingSmokeReceipt } from './lib/cloudflare-release.mjs';
import { publicMediaEntryManifestSha256 } from './lib/public-media-manifest.mjs';
import { R2S3Client } from './lib/r2-s3-client.mjs';

const bytes = Buffer.from('fixture-media');
const entry = {
  publicPath: '/media/native/fixture.bin', key: 'media/native/fixture.bin', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), contentType: 'application/octet-stream',
};
const redirects = Array.from({ length: 349 }, (_, index) => ({
  from: `/legacy-${index}`, to: `/posts/${index + 1}`,
}));
const stagingVersionId = '22345678-1234-4123-8123-123456789abc';
const createFetcher = ({
  rangeByte = bytes[0],
  rangeEtag = '"fixture-etag"',
  rangeContentRange = `bytes 0-0/${entry.size}`,
  rangeContentLength = '1',
} = {}) => async (input, init = {}) => {
  const url = new URL(input);
  const requestHeaders = new Headers(init.headers);
  const headers = new Headers();
  headers.set('x-dwnc-staging-version', stagingVersionId);
  if (url.pathname === entry.publicPath) {
    headers.set('etag', '"fixture-etag"');
    headers.set('content-type', entry.contentType);
    headers.set('content-length', String(entry.size));
    if (requestHeaders.has('x-dwnc-smoke-cache-probe')) headers.set('x-dwnc-cache-probe', 'HIT');
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers });
    if (requestHeaders.has('if-none-match')) return new Response(null, { status: 304, headers });
    if (requestHeaders.get('range') === 'bytes=0-0,2-2') {
      return new Response(null, { status: 416, headers });
    }
    if (requestHeaders.get('range') === 'bytes=0-0') {
      headers.set('etag', rangeEtag);
      headers.set('content-length', rangeContentLength);
      if (rangeContentRange !== null) headers.set('content-range', rangeContentRange);
      return new Response(Buffer.from([rangeByte]), { status: 206, headers });
    }
    return new Response(bytes, { status: 200, headers });
  }
  if (url.pathname === '/about') return new Response('about', { status: 200, headers });
  const redirect = redirects.find((value) => value.from === url.pathname);
  if (redirect) {
    headers.set('location', redirect.to);
    return new Response(null, { status: 308, headers });
  }
  return new Response('not found', { status: 404 });
};
const fetcher = createFetcher();

const smoke = await collectStagingSmokeEvidence({
  fetcher, unauthenticatedFetcher: async () => new Response('denied', { status: 401 }),
  origin: 'https://synthetic-staging.example.test', artifactSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64), versionId: '12345678-1234-4123-8123-123456789abc',
  stagingVersionId,
  accessPolicySha256: 'c'.repeat(64), stagingVersionAttestationSha256: 'd'.repeat(64),
  stagingDeploymentStatusSha256: 'e'.repeat(64), stagingDeployment100: true, mediaEntry: entry,
  stagingMediaProbeSha256: 'f'.repeat(64),
  staticPath: '/about', redirects, observedAt: '2026-08-25T00:00:00.000Z',
  expiresAt: '2026-08-25T00:10:00.000Z',
});
validateStagingSmokeReceipt(smoke, { now: new Date('2026-08-25T00:05:00.000Z') });
assert.equal(smoke.redirectCount, 349);
assert.equal(smoke.cachePathVerified, true);

let mockS3Calls = 0;
const client = new R2S3Client({
  accountId: 'a'.repeat(32),
  bucket: 'dwnc-me-public-media-staging',
  accessKeyId: 'b'.repeat(32),
  secretAccessKey: 'c'.repeat(64),
  fetchImpl: async (_url, init) => {
    mockS3Calls += 1;
    assert.equal(init.method, 'HEAD');
    return new Response(null, { status: 200, headers: {
      'content-length': String(entry.size),
      'content-type': entry.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      etag: '"fixture-etag"',
      'x-amz-meta-sha256': entry.sha256,
      'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
      'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(entry),
      'x-amz-checksum-sha256': Buffer.from(entry.sha256, 'hex').toString('base64'),
      'x-amz-version-id': 'fixture-version',
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
assert.equal(probe.s3HeadVerified, true);
assert.equal(probe.workerBindingVerified, true);
assert.equal(mockS3Calls, 1);

const invalidRangeFetchers = [
  createFetcher({ rangeByte: bytes[0] ^ 0xff }),
  createFetcher({ rangeEtag: '"wrong-etag"' }),
  createFetcher({ rangeContentRange: null }),
  createFetcher({ rangeContentRange: `bytes 1-1/${entry.size}` }),
  createFetcher({ rangeContentLength: '2' }),
];
for (const invalidFetcher of invalidRangeFetchers) {
  await assert.rejects(() => probeStagingMediaObject({
    client,
    fetcher: invalidFetcher,
    origin: 'https://synthetic-staging.example.test',
    entry,
    stagingVersionId,
  }));
}

const admissionSmoke = await collectStagingAdmissionSmokeEvidence({
  fetcher, unauthenticatedFetcher: async () => new Response('denied', { status: 401 }),
  origin: 'https://synthetic-staging.example.test', artifactSha256: 'a'.repeat(64),
  payloadSha256: 'b'.repeat(64), stagingVersionId,
  accessPolicySha256: 'c'.repeat(64), stagingVersionAttestationSha256: 'd'.repeat(64),
  stagingDeploymentStatusSha256: 'e'.repeat(64), stagingDeployment100: true,
  stagingMediaProbeSha256: 'f'.repeat(64), mediaEntry: entry, staticPath: '/about', redirects,
  observedAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-25T00:10:00.000Z',
});
validateStagingAdmissionSmokeReceipt(admissionSmoke, {
  now: new Date('2026-08-25T00:05:00.000Z'),
});
assert.equal(admissionSmoke.redirectCount, 349);
assert.equal('versionId' in admissionSmoke, false);
assert.throws(() => validateStagingSmokeReceipt(admissionSmoke, {
  now: new Date('2026-08-25T00:05:00.000Z'),
}));
assert.throws(() => validateStagingAdmissionSmokeReceipt(smoke, {
  now: new Date('2026-08-25T00:05:00.000Z'),
}));
for (const invalidFetcher of invalidRangeFetchers) {
  await assert.rejects(() => collectStagingAdmissionSmokeEvidence({
    fetcher: invalidFetcher,
    unauthenticatedFetcher: async () => new Response('denied', { status: 401 }),
    origin: 'https://synthetic-staging.example.test', artifactSha256: 'a'.repeat(64),
    payloadSha256: 'b'.repeat(64), stagingVersionId,
    accessPolicySha256: 'c'.repeat(64), stagingVersionAttestationSha256: 'd'.repeat(64),
    stagingDeploymentStatusSha256: 'e'.repeat(64), stagingDeployment100: true,
    stagingMediaProbeSha256: 'f'.repeat(64), mediaEntry: entry, staticPath: '/about', redirects,
    observedAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-25T00:10:00.000Z',
  }));
}
console.log(JSON.stringify({
  suite: 'cloudflare-staging-evidence', assertions: 20, redirects: 349,
  actualR2ClientIntegrated: true, productionSmokeContractPreserved: true,
  stagingAdmissionRequiresProductionAttestation: false,
  accessProtectedCacheAssumed: false, liveNetworkCalls: 0, deploymentAttempts: 0, status: 'PASS',
}, null, 2));
