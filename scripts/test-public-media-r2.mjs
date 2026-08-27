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
  createRemoteInspectionReceipt,
  createUnsignedRemoteReceipt,
  inspectRemotePublicMedia,
} from './lib/public-media-remote.mjs';
import {
  parseR2ListObjectsV2,
  R2S3Client,
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
    version: `version-${entry.sha256.slice(0, 12)}`,
    httpEtag: `"${entry.sha256.slice(0, 12)}"`,
    ...overrides,
  };
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
      'x-amz-version-id': 'admission-version',
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
    inspectedAt: '2026-08-25T01:02:03.000Z',
  });
  equal(inspectionReceipt.verificationLevel, 'list-and-head');
  equal(inspectionReceipt.exact, 1);
  equal(inspectionReceipt.missing, 1);
  equal(inspectionReceipt.orphan, 1);
  await rejectsCode(() => Promise.resolve(createRemoteInspectionReceipt(manifest, inspection, {
    target: { ...syntheticTarget, environment: 'production' },
  })), 'MEDIA_E_R2_INSPECTION_RECEIPT');
}

{
  const heads = manifest.entries.map((entry) => headFor(entry));
  const receipt = createUnsignedRemoteReceipt(manifest, heads, {
    verifiedAt: '2026-08-25T00:00:00.000Z', target: syntheticTarget,
  });
  validateRemoteReceipt(receipt, manifest);
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
  await rejectsCode(() => Promise.resolve(validateProductionReleaseTarget({
    policy,
    receipt: productionReceipt,
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    publicKeyPem,
    now: new Date('2026-08-25T00:16:00.001Z'),
    wranglerConfig: { env: { production: { r2_buckets: [{
      binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
    }] } } },
  })), 'MEDIA_E_RELEASE_TARGET');
}

{
  const calls = [];
  let listAttempt = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), method: init.method, headers: init.headers });
    if (init.method === 'GET') {
      listAttempt += 1;
      if (listAttempt === 1) return new Response('retry', { status: 503 });
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
        'x-amz-version-id': 'version-one',
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
  const uploadEntry = { ...manifest.entries[0], size: 3, sha256: '1'.repeat(64) };
  const result = await client.putCreateOnly(uploadEntry, Buffer.from('synthetic fixture').subarray(0, 3))
    .catch((error) => error);
  equal(result.code, 'MEDIA_E_UPLOAD_LOCAL_HASH');
  const bytes = Buffer.from('abc');
  uploadEntry.sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  const created = await client.putCreateOnly(uploadEntry, bytes);
  equal(created.created, true);
  equal(calls.some((call) => call.url.searchParams.get('continuation-token') === 'page-two'), true);
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
  const audit = await auditRemotePublicMediaFull(fullClient, manifest, { concurrency: 2 });
  equal(audit.objectCount, 2);
  equal(audit.totalBytes, 7);
  const fullReceipt = createUnsignedRemoteReceipt(manifest, audit.objects, {
    target: syntheticTarget,
    verificationLevel: 'full-get-sha256',
    orphanCount: 0,
  });
  equal(fullReceipt.audit.fullGetObjects, 2);
  equal(fullReceipt.audit.fullGetBytes, 7);
  await rejectsCode(() => auditRemotePublicMediaFull({
    async getFull(key) {
      const entry = manifest.entries.find((candidate) => candidate.key === key);
      return { ...headFor(entry), bodyBytes: entry.size, bodySha256: 'f'.repeat(64) };
    },
  }, manifest, { concurrency: 1 }), 'MEDIA_E_REMOTE_FULL_AUDIT');
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

await rejectsCode(
  () => Promise.resolve(r2ClientFromEnvironment({})),
  'MEDIA_E_R2_CREDENTIALS_FD_REQUIRED',
);

console.log(JSON.stringify({ suite: 'public-media-r2', assertions, liveNetworkCalls: 0, status: 'PASS' }, null, 2));
