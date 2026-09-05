import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  canonicalRemoteReceiptPayload,
  cloudflareAccountIdSha256,
  createPublicMediaManifest,
  publicMediaEntryManifestSha256,
  publicKeySpkiSha256,
  validateConfiguredReleaseTarget,
  validateProductionReleaseTarget,
  validatePublicMediaReleasePolicy,
  validateRemoteReceipt,
  validateStagingReleaseTarget,
  verifyRemoteReceiptSignature,
} from './lib/public-media-manifest.mjs';
import {
  admitOneStagingPublicMediaObject,
  auditRemotePublicMediaFull,
  createBulkSyncReceipt,
  createRemoteInspectionReceipt,
  createUnsignedRemoteReceipt,
  inspectRemotePublicMedia,
  validateBulkSyncReceipt,
  validateRemoteInspectionReceipt,
} from './lib/public-media-remote.mjs';
import {
  parseR2Head,
  parseR2ListObjectsV2,
  R2S3Client,
  remoteObjectGenerationMatches,
  r2ClientFromEnvironment,
  signR2S3Request,
} from './lib/r2-s3-client.mjs';

let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
const rejectsCode = async (action, code) => {
  await assert.rejects(async () => action(), (error) => error?.code === code || error?.message === code);
  assertions += 1;
};

const credentials = {
  accountId: 'a'.repeat(32),
  bucket: 'dwnc-media-test',
  accessKeyId: 'b'.repeat(32),
  secretAccessKey: 'c'.repeat(64),
};
const now = new Date('2026-08-25T01:02:03.000Z');

{
  const signed = signR2S3Request({
    ...credentials,
    method: 'PUT',
    key: 'media/native/sample/a b.jpg',
    headers: { 'if-none-match': '*', 'content-type': 'image/jpeg' },
    payloadSha256: 'c'.repeat(64),
    now,
  });
  equal(new URL(signed.url).pathname.endsWith('/media/native/sample/a%20b.jpg'), true);
  equal(signed.headers.get('authorization')?.startsWith(`AWS4-HMAC-SHA256 Credential=${'b'.repeat(32)}/20260825/auto/s3/aws4_request`), true);
  equal(signed.headers.get('authorization'), `AWS4-HMAC-SHA256 Credential=${'b'.repeat(32)}/20260825/auto/s3/aws4_request, SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date, Signature=1e4151229bff0d6677aa13873fcefcc21e627ede57862defa63362b007ee6657`);
  equal(signed.canonicalRequest, [
    'PUT',
    '/dwnc-media-test/media/native/sample/a%20b.jpg',
    '',
    'content-type:image/jpeg\nhost:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com\nif-none-match:*\nx-amz-content-sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\nx-amz-date:20260825T010203Z\n',
    'content-type;host;if-none-match;x-amz-content-sha256;x-amz-date',
    'c'.repeat(64),
  ].join('\n'));
  equal(signed.signedHeaders.includes('if-none-match'), true);
  equal(signed.canonicalRequest.includes('x-amz-content-sha256'), true);
}

{
  const parsed = parseR2ListObjectsV2(`<?xml version="1.0"?><ListBucketResult>
    <IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken>
    <Contents><Key>media%2Fa.jpg</Key><Size>12</Size><ETag>&quot;e1&quot;</ETag></Contents>
  </ListBucketResult>`);
  equal(parsed.objects[0].key, 'media/a.jpg');
  equal(parsed.objects[0].size, 12);
  equal(parsed.truncated, true);
  equal(parsed.nextContinuationToken, 'next&token');
}

const evidence = [
  { path: '/media/native/sample/one.jpg', size: 3, sha256: '1'.repeat(64), mime: 'image/jpeg' },
  { path: '/media/native/sample/two.mp4', size: 4, sha256: '2'.repeat(64), mime: 'video/mp4' },
];
const manifest = createPublicMediaManifest(evidence);
const syntheticTarget = {
  environment: 'staging',
  bucket: credentials.bucket,
  accountIdSha256: cloudflareAccountIdSha256(credentials.accountId),
};
const syntheticSource = Object.freeze({
  gitCommit: 'a'.repeat(40), gitTree: 'b'.repeat(40), clean: true, gitCheckCount: 3,
});
const fullAuditEvidence = Object.freeze({
  requestCounts: Object.freeze({ LIST: 1, HEAD: 2, GET: 2, PUT: 0, DELETE: 0 }),
  sourceCommit: syntheticSource.gitCommit,
  sourceTree: syntheticSource.gitTree,
  gitCheckCount: 3,
  startedAt: '2026-08-24T23:59:00.000Z',
  exposureCaptureSha256: 'f'.repeat(64),
});

function headFor(entry, overrides = {}) {
  return {
    key: entry.key,
    size: entry.size,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
    sha256: entry.sha256,
    contract: 'dwnc-public-media-r2-v1',
    manifestEntrySha256: publicMediaEntryManifestSha256(entry),
    platformChecksumSha256: entry.sha256,
    version: null,
    httpEtag: `"${entry.sha256.slice(0, 12)}"`,
    lastModified: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

{
  const entry = manifest.entries[0];
  const headers = {
    'content-length': String(entry.size),
    'content-type': `${entry.contentType}; charset=binary`,
    'cache-control': entry.cacheControl,
    etag: '"live-r2-etag"',
    'last-modified': 'Thu, 27 Aug 2026 00:00:00 GMT',
    'x-amz-meta-sha256': entry.sha256,
    'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
    'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(entry),
    'x-amz-checksum-sha256': Buffer.from(entry.sha256, 'hex').toString('base64'),
  };
  const parsed = parseR2Head(new Response(null, { status: 200, headers }), entry.key);
  equal(parsed.version, null);
  equal(parsed.lastModified, '2026-08-27T00:00:00.000Z');
  equal(parsed.contentType, entry.contentType);
  const parsedWithVersion = parseR2Head(new Response(null, {
    status: 200, headers: { ...headers, 'x-amz-version-id': 'present-version' },
  }), entry.key);
  equal(parsedWithVersion.version, 'present-version');
  equal(remoteObjectGenerationMatches(parsed, { ...parsed }), true);
  equal(remoteObjectGenerationMatches(parsed, { ...parsed, version: 'present-version' }), false);
  equal(remoteObjectGenerationMatches(
    { ...parsed, version: 'version-one' },
    { ...parsed, version: 'version-two' },
  ), false);
  await rejectsCode(() => Promise.resolve(parseR2Head(new Response(null, {
    status: 200, headers: { ...headers, 'content-length': '' },
  }), entry.key)), 'MEDIA_E_R2_HEAD');
  await rejectsCode(() => Promise.resolve(parseR2Head(new Response(null, {
    status: 200, headers: { ...headers, etag: 'unquoted' },
  }), entry.key)), 'MEDIA_E_R2_HEAD');
  await rejectsCode(() => Promise.resolve(parseR2Head(new Response(null, {
    status: 200, headers: { ...headers, 'last-modified': 'not-a-date' },
  }), entry.key)), 'MEDIA_E_R2_HEAD');
  await rejectsCode(() => Promise.resolve(parseR2Head(new Response(null, {
    status: 200, headers: { ...headers, 'x-amz-version-id': '' },
  }), entry.key)), 'MEDIA_E_R2_HEAD');
}

{
  const body = Buffer.from('staging-admission-fixture');
  const entry = {
    ...manifest.entries[0],
    size: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
  const exactResponse = (responseBody = null, overrides = {}) => new Response(responseBody, {
    status: 200,
    headers: {
      'content-length': String(entry.size),
      'content-type': entry.contentType,
      'cache-control': entry.cacheControl,
      etag: '"admission-etag"',
      'x-amz-meta-sha256': entry.sha256,
      'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
      'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(entry),
      'x-amz-checksum-sha256': Buffer.from(entry.sha256, 'hex').toString('base64'),
      'last-modified': 'Thu, 27 Aug 2026 00:00:00 GMT',
      ...overrides,
    },
  });

  const methods = [];
  let firstHead = true;
  const createClient = new R2S3Client({
    ...credentials,
    fetchImpl: async (_url, init) => {
      methods.push(init.method);
      if (init.method === 'HEAD' && firstHead) {
        firstHead = false;
        return new Response(null, { status: 404 });
      }
      if (init.method === 'PUT') {
        equal(init.headers.get('if-none-match'), '*');
        return new Response(null, { status: 201 });
      }
      if (init.method === 'HEAD') return exactResponse();
      if (init.method === 'GET') return exactResponse(body);
      throw new Error('unexpected admission method');
    },
    now: () => now, delay: async () => undefined, maxAttempts: 1,
  });
  const created = await admitOneStagingPublicMediaObject(createClient, entry, async () => body);
  equal(created.outcome, 'created');
  equal(created.putAttempted, true);
  equal(created.created, true);
  equal(created.preconditionRaced, false);
  equal(methods.join(','), 'HEAD,PUT,HEAD,GET');

  const raceMethods = [];
  let raceFirstHead = true;
  const raceClient = new R2S3Client({
    ...credentials,
    fetchImpl: async (_url, init) => {
      raceMethods.push(init.method);
      if (init.method === 'HEAD' && raceFirstHead) {
        raceFirstHead = false;
        return new Response(null, { status: 404 });
      }
      if (init.method === 'PUT') return new Response(null, { status: 412 });
      if (init.method === 'HEAD') return exactResponse();
      if (init.method === 'GET') return exactResponse(body);
      throw new Error('unexpected admission race method');
    },
    now: () => now, delay: async () => undefined, maxAttempts: 1,
  });
  const raced = await admitOneStagingPublicMediaObject(raceClient, entry, async () => body);
  equal(raced.outcome, 'raced-exact');
  equal(raced.created, false);
  equal(raced.preconditionRaced, true);
  equal(raceMethods.join(','), 'HEAD,PUT,HEAD,HEAD,GET');

  let mismatchPutCalls = 0;
  await rejectsCode(() => admitOneStagingPublicMediaObject({
    async head() { return headFor(entry, { sha256: 'f'.repeat(64) }); },
    async putCreateOnly() { mismatchPutCalls += 1; return { created: true, preconditionFailed: false }; },
    async getFull() { return null; },
  }, entry, async () => body), 'MEDIA_E_STAGING_ADMISSION_PRE_HEAD_MISMATCH');
  equal(mismatchPutCalls, 0);

  await rejectsCode(() => admitOneStagingPublicMediaObject({
    headCalls: 0,
    async head() {
      this.headCalls += 1;
      return this.headCalls === 1 ? null : headFor(entry, { sha256: 'f'.repeat(64) });
    },
    async putCreateOnly() { return { created: false, preconditionFailed: true }; },
    async getFull() { return null; },
  }, entry, async () => body), 'MEDIA_E_STAGING_ADMISSION_RACE_MISMATCH');

  await rejectsCode(() => admitOneStagingPublicMediaObject({
    async head() { return headFor(entry); },
    async putCreateOnly() { throw new Error('put must not run'); },
    async getFull() {
      return { ...headFor(entry), bodyBytes: entry.size, bodySha256: 'f'.repeat(64) };
    },
  }, entry, async () => body), 'MEDIA_E_STAGING_ADMISSION_FULL_GET_MISMATCH');

  const generationCases = [
    { httpEtag: '"changed-etag"' },
    { sha256: 'f'.repeat(64) },
    { size: entry.size + 1 },
    { contentType: 'application/octet-stream' },
    { cacheControl: null },
    { manifestEntrySha256: 'f'.repeat(64) },
    { platformChecksumSha256: null },
    { version: 'unexpected-present-version' },
    { lastModified: '2026-08-27T00:00:01.000Z' },
  ];
  for (const override of generationCases) {
    await rejectsCode(() => admitOneStagingPublicMediaObject({
      async head() { return headFor(entry); },
      async putCreateOnly() { throw new Error('put must not run'); },
      async getFull() {
        return {
          ...headFor(entry), ...override, bodyBytes: entry.size, bodySha256: entry.sha256,
        };
      },
    }, entry, async () => body), 'MEDIA_E_STAGING_ADMISSION_FULL_GET_MISMATCH');
  }

  const presentGeneration = headFor(entry, { version: 'present-version' });
  const presentExact = await admitOneStagingPublicMediaObject({
    async head() { return presentGeneration; },
    async putCreateOnly() { throw new Error('put must not run'); },
    async getFull() {
      return { ...presentGeneration, bodyBytes: entry.size, bodySha256: entry.sha256 };
    },
  }, entry, async () => body);
  equal(presentExact.outcome, 'already-exact');
  await rejectsCode(() => admitOneStagingPublicMediaObject({
    async head() { return headFor(entry, { version: 'version-one' }); },
    async putCreateOnly() { throw new Error('put must not run'); },
    async getFull() {
      return {
        ...headFor(entry, { version: 'version-two' }),
        bodyBytes: entry.size,
        bodySha256: entry.sha256,
      };
    },
  }, entry, async () => body), 'MEDIA_E_STAGING_ADMISSION_FULL_GET_MISMATCH');
}

{
  const fakeClient = {
    async listAll() {
      return [
        { key: manifest.entries[0].key, size: 3, etag: '"one"' },
        { key: 'media/orphan.jpg', size: 1, etag: '"orphan"' },
      ];
    },
    async head(key) {
      if (key === manifest.entries[0].key) return headFor(manifest.entries[0]);
      return null;
    },
  };
  const inspection = await inspectRemotePublicMedia(fakeClient, manifest, { concurrency: 2 });
  equal(inspection.exact.length, 1);
  equal(inspection.missing.length, 1);
  equal(inspection.mismatch.length, 0);
  equal(inspection.orphanCount, 1);
  const inspectionReceipt = createRemoteInspectionReceipt(manifest, inspection, {
    target: syntheticTarget,
    source: syntheticSource,
    expected: { exact: 1, missing: 1, mismatch: 0, orphan: 1 },
    requestCounts: { LIST: 1, HEAD: 2, GET: 0, PUT: 0, DELETE: 0 },
    startedAt: '2026-08-25T01:02:02.000Z',
    inspectedAt: '2026-08-25T01:02:03.000Z',
  });
  validateRemoteInspectionReceipt(inspectionReceipt, manifest);
  equal(inspectionReceipt.verificationLevel, 'list-and-head-strict');
  equal(inspectionReceipt.observed.exact, 1);
  equal(inspectionReceipt.observed.missing, 1);
  equal(inspectionReceipt.observed.orphan, 1);
  await rejectsCode(() => Promise.resolve(createRemoteInspectionReceipt(manifest, inspection, {
    target: { ...syntheticTarget, environment: 'production' },
    source: syntheticSource,
    expected: { exact: 1, missing: 1, mismatch: 0, orphan: 1 },
    requestCounts: { LIST: 1, HEAD: 2, GET: 0, PUT: 0, DELETE: 0 },
    startedAt: '2026-08-25T01:02:02.000Z',
  })), 'MEDIA_E_R2_INSPECTION_RECEIPT');

  const exactInspection = {
    listedCount: 2,
    exact: manifest.entries.map((entry) => ({ entry, remote: headFor(entry) })),
    missing: [], mismatch: [], orphanCount: 0,
    heads: manifest.entries.map((entry) => headFor(entry)),
  };
  const bulkReceipt = createBulkSyncReceipt(manifest, {
    target: syntheticTarget,
    source: syntheticSource,
    expectedOrphanCount: 0,
    preInspection: { ...inspection, listedCount: 1, orphanCount: 0 },
    postInspection: exactInspection,
    writes: {
      initialMissing: 1,
      exactSkipped: 1,
      conditionalCreateOperations: 1,
      conditionalIfNoneMatchRequests: 1,
      actualCreated: 1,
      preconditionRecovered: 0,
      overwrite: 0,
      delete: 0,
    },
    requestCounts: { LIST: 2, HEAD: 4, GET: 0, PUT: 1, DELETE: 0 },
    startedAt: '2026-08-25T01:02:02.000Z',
    completedAt: '2026-08-25T01:02:03.000Z',
  });
  validateBulkSyncReceipt(bulkReceipt, manifest);
  equal(bulkReceipt.writes.actualCreated, 1);
  equal(bulkReceipt.writes.exactSkipped, 1);
}

{
  const heads = manifest.entries.map((entry) => headFor(entry));
  const receipt = createUnsignedRemoteReceipt(manifest, heads, {
    verifiedAt: '2026-08-25T00:00:00.000Z', target: syntheticTarget,
  });
  validateRemoteReceipt(receipt, manifest);
  equal(receipt.objects.every((object) => object.version === null), true);
  equal(receipt.objects.every((object) => object.lastModified === '2026-08-27T00:00:00.000Z'), true);
  for (const objectMutation of [
    { version: '' },
    { httpEtag: 'unquoted' },
    { sha256: 'f'.repeat(64) },
    { size: manifest.entries[0].size + 1 },
    { contentType: 'application/octet-stream' },
    { lastModified: 'not-a-date' },
  ]) {
    const invalid = structuredClone(receipt);
    Object.assign(invalid.objects[0], objectMutation);
    await rejectsCode(
      () => Promise.resolve(validateRemoteReceipt(invalid, manifest)),
      'MEDIA_E_REMOTE_RECEIPT',
    );
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signature = sign(null, Buffer.from(canonicalRemoteReceiptPayload(receipt)), privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  equal(verifyRemoteReceiptSignature(receipt, signature, publicKeyPem), true);
  const tampered = { ...receipt, totalBytes: receipt.totalBytes + 1 };
  await rejectsCode(() => Promise.resolve(verifyRemoteReceiptSignature(tampered, signature, publicKeyPem)), 'MEDIA_E_REMOTE_SIGNATURE');

  const productionTarget = { ...syntheticTarget, environment: 'production' };
  const productionReceipt = createUnsignedRemoteReceipt(manifest, heads.map((remote, index) => ({
    ...remote,
    bodyBytes: manifest.entries[index].size,
    bodySha256: manifest.entries[index].sha256,
  })), {
    verifiedAt: '2026-08-25T00:00:00.000Z', target: productionTarget,
    verificationLevel: 'full-get-sha256',
    bucketExposure: {
      verification: 'cloudflare-control-plane',
      jurisdiction: 'default',
      location: 'ENAM',
      storageClass: 'Standard',
      bucketPropertiesSha256: 'd'.repeat(64),
      r2DevEnabled: false,
      customDomainCount: 0,
      verifiedAt: '2026-08-25T00:00:00.000Z',
      evidenceSha256: 'e'.repeat(64),
    },
    fullAuditEvidence,
  });
  const policy = {
    schemaVersion: 1,
    contract: 'dwnc-public-media-release-policy-v1',
    staging: {
      environment: 'staging',
      wranglerEnvironment: 'staging',
      binding: 'MEDIA_BUCKET',
      bucket: credentials.bucket,
      accountIdSha256: syntheticTarget.accountIdSha256,
      publicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
      releasePublicKeySpkiSha256: null,
      smokeOrigin: 'https://dwnc-me-staging.dwnc.workers.dev',
      smokeAccessPolicySha256: null,
      requiredVerificationLevel: 'full-get-sha256',
      requiredBucketExposure: 'cloudflare-control-plane-private',
      maxBucketExposureAgeSeconds: 900,
      maxBucketExposureFutureSkewSeconds: 120,
      approvedOrphanCount: 0,
    },
    production: {
      environment: 'production',
      wranglerEnvironment: 'production',
      binding: 'MEDIA_BUCKET',
      bucket: credentials.bucket,
      accountIdSha256: syntheticTarget.accountIdSha256,
      publicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
      releasePublicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
      smokeOrigin: null,
      smokeAccessPolicySha256: null,
      requiredVerificationLevel: 'full-get-sha256',
      requiredBucketExposure: 'cloudflare-control-plane-private',
      maxBucketExposureAgeSeconds: 900,
      maxBucketExposureFutureSkewSeconds: 120,
      approvedOrphanCount: 0,
    },
  };
  validatePublicMediaReleasePolicy(policy, { requireComplete: true });
  equal(validateConfiguredReleaseTarget({
    policy,
    environment: 'staging',
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    wranglerConfig: { env: { staging: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  }).environment, 'staging');
  await rejectsCode(() => Promise.resolve(validateConfiguredReleaseTarget({
    policy: { ...policy, staging: { ...policy.staging, accountIdSha256: null } },
    environment: 'staging',
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    wranglerConfig: { env: { staging: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  })), 'MEDIA_E_RELEASE_POLICY_INCOMPLETE');
  equal(validateProductionReleaseTarget({
    policy,
    receipt: productionReceipt,
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:05:00.000Z'),
    wranglerConfig: { env: { production: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  }), true);
  const longAuditReceipt = createUnsignedRemoteReceipt(manifest, heads.map((remote, index) => ({
    ...remote,
    bodyBytes: manifest.entries[index].size,
    bodySha256: manifest.entries[index].sha256,
  })), {
    verifiedAt: '2026-08-25T00:40:00.000Z', target: productionTarget,
    verificationLevel: 'full-get-sha256',
    bucketExposure: productionReceipt.bucketExposure,
    fullAuditEvidence,
  });
  equal(validateProductionReleaseTarget({
    policy,
    receipt: longAuditReceipt,
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:41:00.000Z'),
    wranglerConfig: { env: { production: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  }), true);
  const stagingReceipt = { ...productionReceipt, target: syntheticTarget };
  equal(validateStagingReleaseTarget({
    policy,
    receipt: stagingReceipt,
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:05:00.000Z'),
    wranglerConfig: { env: { staging: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  }), true);
  await rejectsCode(() => Promise.resolve(validateStagingReleaseTarget({
    policy: { ...policy, staging: { ...policy.staging, publicKeySpkiSha256: null } },
    receipt: stagingReceipt,
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:05:00.000Z'),
    wranglerConfig: { env: { staging: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  })), 'MEDIA_E_RELEASE_POLICY_INCOMPLETE');
  await rejectsCode(() => Promise.resolve(validateProductionReleaseTarget({
    policy,
    receipt: { ...productionReceipt, target: { ...productionTarget, bucket: 'wrong-target' } },
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:05:00.000Z'),
    wranglerConfig: { env: { production: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  })), 'MEDIA_E_RELEASE_TARGET');
  const staleAtAuditStart = structuredClone(productionReceipt);
  staleAtAuditStart.bucketExposure.verifiedAt = '2026-08-24T23:43:59.000Z';
  await rejectsCode(() => Promise.resolve(validateProductionReleaseTarget({
    policy,
    receipt: staleAtAuditStart,
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:00:00.000Z'),
    wranglerConfig: { env: { production: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  })), 'MEDIA_E_RELEASE_TARGET');
  const futureAtAuditStart = structuredClone(productionReceipt);
  futureAtAuditStart.bucketExposure.verifiedAt = '2026-08-25T00:01:01.000Z';
  await rejectsCode(() => Promise.resolve(validateProductionReleaseTarget({
    policy,
    receipt: futureAtAuditStart,
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:00:00.000Z'),
    wranglerConfig: { env: { production: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  })), 'MEDIA_E_RELEASE_TARGET');
}

{
  let noRetryAttempts = 0;
  const noRetryClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => {
      noRetryAttempts += 1;
      return new Response(null, { status: 503 });
    },
    now: () => now,
    delay: async () => undefined,
    maxAttempts: 1,
  });
  await rejectsCode(() => noRetryClient.head('media/a.jpg'), 'MEDIA_E_R2_HEAD');
  equal(noRetryAttempts, 1);
  equal(noRetryClient.requestOperationCounts().HEAD, 1);
}

{
  const calls = [];
  let listAttempt = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), method: init.method, headers: init.headers });
    if (init.method === 'GET') {
      listAttempt += 1;
      if (listAttempt === 1) throw new Error('synthetic pre-response network failure');
      if (listAttempt === 2) return new Response(`<ListBucketResult><IsTruncated>true</IsTruncated>
        <NextContinuationToken>page-two</NextContinuationToken>
        <Contents><Key>media%2Fa.jpg</Key><Size>3</Size><ETag>&quot;a&quot;</ETag></Contents>
      </ListBucketResult>`, { status: 200 });
      return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>
        <Contents><Key>media%2Fb.jpg</Key><Size>4</Size><ETag>&quot;b&quot;</ETag></Contents>
      </ListBucketResult>`, { status: 200 });
    }
    if (init.method === 'HEAD') {
      return new Response(null, { status: 200, headers: {
        'content-length': '3', 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable',
        etag: '"etag"', 'x-amz-meta-sha256': '1'.repeat(64),
        'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
        'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(manifest.entries[0]),
        'x-amz-checksum-sha256': Buffer.from('1'.repeat(64), 'hex').toString('base64'),
        'last-modified': 'Thu, 27 Aug 2026 00:00:00 GMT',
      } });
    }
    if (init.method === 'PUT') {
      equal(init.headers.get('if-none-match'), '*');
      equal(/^[a-f0-9]{64}$/u.test(init.headers.get('x-amz-meta-sha256') ?? ''), true);
      equal(init.headers.get('x-amz-meta-manifest-entry-sha256'), publicMediaEntryManifestSha256(uploadEntry));
      equal(Buffer.from(init.headers.get('x-amz-checksum-sha256') ?? '', 'base64').length, 32);
      return new Response(null, { status: 201 });
    }
    throw new Error('unexpected method');
  };
  const client = new R2S3Client({
    ...credentials, fetchImpl, now: () => now, delay: async () => undefined, maxAttempts: 3,
  });
  const listed = await client.listAll();
  equal(listed.length, 2);
  equal(listAttempt, 3);
  const head = await client.head('media/a.jpg');
  equal(head.size, 3);
  equal(head.platformChecksumSha256, '1'.repeat(64));
  equal(head.version, null);
  const uploadEntry = { ...manifest.entries[0], size: 3, sha256: '1'.repeat(64) };
  const result = await client.putCreateOnly(uploadEntry, Buffer.from('synthetic fixture').subarray(0, 3))
    .catch((error) => error);
  equal(result.code, 'MEDIA_E_UPLOAD_LOCAL_HASH');
  const bytes = Buffer.from('abc');
  uploadEntry.sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const created = await client.putCreateOnly(uploadEntry, bytes);
  equal(created.created, true);
  equal(calls.some((call) => call.url.searchParams.get('continuation-token') === 'page-two'), true);
  equal(client.requestOperationCounts().LIST, 3);
  equal(client.requestOperationCounts().HEAD, 1);
  equal(client.requestOperationCounts().PUT, 1);
  equal(client.requestOperationCounts().GET, 0);
  equal(client.conditionalIfNoneMatchPutRequestCount(), 1);
}

{
  const fullClient = {
    async getFull(key) {
      const entry = manifest.entries.find((candidate) => candidate.key === key);
      return entry ? {
        ...headFor(entry), bodyBytes: entry.size, bodySha256: entry.sha256,
      } : null;
    },
  };
  const expectedHeads = manifest.entries.map((entry) => headFor(entry));
  const audit = await auditRemotePublicMediaFull(fullClient, manifest, {
    concurrency: 2, expectedHeads,
  });
  equal(audit.objectCount, 2);
  equal(audit.totalBytes, 7);
  const fullReceipt = createUnsignedRemoteReceipt(manifest, audit.objects, {
    verifiedAt: '2026-08-25T00:00:00.000Z',
    target: syntheticTarget,
    verificationLevel: 'full-get-sha256',
    orphanCount: 0,
    fullAuditEvidence,
  });
  equal(fullReceipt.audit.fullGetObjects, 2);
  equal(fullReceipt.audit.fullGetBytes, 7);
  await rejectsCode(() => auditRemotePublicMediaFull({
    async getFull(key) {
      const entry = manifest.entries.find((candidate) => candidate.key === key);
      return { ...headFor(entry), bodyBytes: entry.size, bodySha256: 'f'.repeat(64) };
    },
  }, manifest, { concurrency: 1 }), 'MEDIA_E_REMOTE_FULL_AUDIT');
  await rejectsCode(() => auditRemotePublicMediaFull({
    async getFull(key) {
      const entry = manifest.entries.find((candidate) => candidate.key === key);
      return {
        ...headFor(entry, { version: 'unexpected-present-version' }),
        bodyBytes: entry.size,
        bodySha256: entry.sha256,
      };
    },
  }, manifest, { concurrency: 1, expectedHeads }), 'MEDIA_E_REMOTE_FULL_AUDIT');
}

{
  let attempts = 0;
  const timeoutClient = new R2S3Client({
    ...credentials,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      attempts += 1;
      init.signal.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true });
    }),
    now: () => now,
    delay: async () => undefined,
    maxAttempts: 2,
    timeoutMilliseconds: 5,
  });
  await rejectsCode(() => timeoutClient.head('media/a.jpg'), 'MEDIA_E_R2_TIMEOUT');
  equal(attempts, 2);
}

{
  const bytes = Buffer.from('abc');
  const entry = {
    ...manifest.entries[0],
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const headers = {
    'content-length': String(entry.size),
    'content-type': entry.contentType,
    'cache-control': entry.cacheControl,
    etag: '"streaming-etag"',
    'x-amz-meta-sha256': entry.sha256,
    'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
    'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(entry),
    'x-amz-checksum-sha256': Buffer.from(entry.sha256, 'hex').toString('base64'),
    'last-modified': 'Thu, 27 Aug 2026 00:00:00 GMT',
  };
  const streamingClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1));
        controller.enqueue(bytes.subarray(1));
        controller.close();
      },
    }), { status: 200, headers }),
    now: () => now,
    maxAttempts: 1,
  });
  const remote = await streamingClient.getFull(entry.key);
  equal(remote.bodyBytes, entry.size);
  equal(remote.bodySha256, entry.sha256);
  equal(streamingClient.requestOperationCounts().GET, 1);
  equal(streamingClient.requestOperationCounts().PUT, 0);
  equal(streamingClient.requestOperationCounts().DELETE, 0);

  let transientBodyAttempts = 0;
  const transientBodyClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => {
      transientBodyAttempts += 1;
      if (transientBodyAttempts === 1) {
        return new Response(new ReadableStream({
          start(controller) { controller.error(new Error('synthetic body stream failure')); },
        }), { status: 200, headers });
      }
      return new Response(bytes, { status: 200, headers });
    },
    now: () => now,
    delay: async () => undefined,
    maxAttempts: 3,
  });
  const transientRecovered = await transientBodyClient.getFull(entry.key);
  equal(transientBodyAttempts, 2);
  equal(transientRecovered.bodyBytes, entry.size);
  equal(transientRecovered.bodySha256, entry.sha256);

  let persistentBodyAttempts = 0;
  const persistentBodyClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => {
      persistentBodyAttempts += 1;
      return new Response(new ReadableStream({
        start(controller) { controller.error(new Error('synthetic body stream failure')); },
      }), { status: 200, headers });
    },
    now: () => now,
    delay: async () => undefined,
    maxAttempts: 3,
  });
  await rejectsCode(() => persistentBodyClient.getFull(entry.key), 'MEDIA_E_R2_GET_BODY');
  equal(persistentBodyAttempts, 3);

  let mixedFailureAttempts = 0;
  const mixedFailureClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => {
      mixedFailureAttempts += 1;
      if (mixedFailureAttempts === 1) return new Response(null, { status: 500 });
      if (mixedFailureAttempts === 2) throw new Error('synthetic network failure');
      return new Response(new ReadableStream({
        start(controller) { controller.error(new Error('synthetic body stream failure')); },
      }), { status: 200, headers });
    },
    now: () => now,
    delay: async () => undefined,
    maxAttempts: 3,
  });
  await rejectsCode(() => mixedFailureClient.getFull(entry.key), 'MEDIA_E_R2_GET_BODY');
  equal(mixedFailureAttempts, 3);
  equal(mixedFailureClient.requestOperationCounts().GET, 3);

  let sizeMismatchAttempts = 0;
  const sizeMismatchClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => {
      sizeMismatchAttempts += 1;
      return new Response(bytes.subarray(0, 2), { status: 200, headers });
    },
    now: () => now,
    delay: async () => undefined,
    maxAttempts: 3,
  });
  await rejectsCode(() => sizeMismatchClient.getFull(entry.key), 'MEDIA_E_R2_GET_BODY');
  equal(sizeMismatchAttempts, 1);

  let cancellationCount = 0;
  const stalledClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.subarray(0, 1)); },
      cancel() { cancellationCount += 1; },
    }), { status: 200, headers }),
    now: () => now,
    maxAttempts: 1,
    timeoutMilliseconds: 5_000,
    deadlineMilliseconds: Date.now() + 500,
  });
  await rejectsCode(() => stalledClient.getFull(entry.key), 'MEDIA_E_R2_TIMEOUT');
  equal(cancellationCount, 1);
  equal(stalledClient.requestOperationCounts().GET, 1);
  equal(stalledClient.requestOperationCounts().PUT, 0);
  equal(stalledClient.requestOperationCounts().DELETE, 0);

  let afterDeadlineFetches = 0;
  const afterDeadlineClient = new R2S3Client({
    ...credentials,
    fetchImpl: async () => {
      afterDeadlineFetches += 1;
      return new Response(null, { status: 404 });
    },
    now: () => now,
    maxAttempts: 1,
    deadlineMilliseconds: Date.now() - 1,
  });
  await rejectsCode(() => afterDeadlineClient.getFull(entry.key), 'MEDIA_E_R2_TIMEOUT');
  equal(afterDeadlineFetches, 0);
  equal(afterDeadlineClient.requestOperationCounts().GET, 0);
  equal(afterDeadlineClient.requestOperationCounts().PUT, 0);
  equal(afterDeadlineClient.requestOperationCounts().DELETE, 0);
}

await rejectsCode(
  () => Promise.resolve(r2ClientFromEnvironment({})),
  'MEDIA_E_R2_CREDENTIALS_FD_REQUIRED',
);

console.log(JSON.stringify({ suite: 'public-media-r2', assertions, liveNetworkCalls: 0, status: 'PASS' }, null, 2));
