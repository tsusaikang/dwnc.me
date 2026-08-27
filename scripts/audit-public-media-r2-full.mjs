import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  canonicalRemoteReceiptPayload,
  validateConfiguredReleaseTarget,
} from './lib/public-media-manifest.mjs';
import {
  auditRemotePublicMediaFull,
  createUnsignedRemoteReceipt,
  inspectRemotePublicMedia,
} from './lib/public-media-remote.mjs';
import {
  r2ClientContextFromEnvironment,
} from './lib/r2-s3-client.mjs';
import {
  remoteReceiptBucketExposure,
  validateR2ExposureCapture,
} from './lib/cloudflare-r2-exposure.mjs';
import {
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('media-r2-full-audit');

function parseArguments(argv) {
  const options = {
    environment: null,
    concurrency: 2,
    receiptOutput: null,
    expectedManifestSha256: null,
    expectedOrphanCount: null,
    bucketExposureCapture: null,
  };
  for (const argument of argv) {
    if (argument.startsWith('--environment=')) options.environment = argument.slice(14);
    else if (argument.startsWith('--concurrency=')) options.concurrency = Number(argument.slice(14));
    else if (argument.startsWith('--receipt-output=')) options.receiptOutput = argument.slice(17);
    else if (argument.startsWith('--expected-manifest-sha256=')) options.expectedManifestSha256 = argument.slice(27);
    else if (argument.startsWith('--expected-orphan-count=')) options.expectedOrphanCount = Number(argument.slice(24));
    else if (argument.startsWith('--bucket-exposure-capture=')) {
      options.bucketExposureCapture = argument.slice('--bucket-exposure-capture='.length);
    }
    else throw new Error('MEDIA_E_ARGUMENT');
  }
  if (!['staging', 'production'].includes(options.environment)
    || !Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8
    || !/^[a-f0-9]{64}$/u.test(options.expectedManifestSha256 ?? '')
    || typeof options.receiptOutput !== 'string' || !path.isAbsolute(options.receiptOutput)
    || typeof options.bucketExposureCapture !== 'string'
    || !path.isAbsolute(options.bucketExposureCapture)
    || path.resolve(options.receiptOutput).startsWith(`${path.resolve(ROOT)}${path.sep}`)
    || !Number.isSafeInteger(options.expectedOrphanCount) || options.expectedOrphanCount < 0) {
    throw new Error('MEDIA_E_FULL_AUDIT_EVIDENCE_REQUIRED');
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const { credentials: r2Credentials, client } = r2ClientContextFromEnvironment(process.env);
const manifest = await loadTrackedPublicMediaManifest(ROOT);
if (manifest.manifestSha256 !== options.expectedManifestSha256) throw new Error('MEDIA_E_EXPECTED_MANIFEST');
const wranglerConfig = JSON.parse(await readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const targetPolicy = validateConfiguredReleaseTarget({
  policy: releasePolicy,
  environment: options.environment,
  accountId: r2Credentials.accountId,
  bucket: r2Credentials.bucket,
  wranglerConfig,
});
let exposureCapture;
try {
  exposureCapture = JSON.parse((await readSecureFile(
    options.bucketExposureCapture, 3 * 1024 * 1024,
  )).toString('utf8'));
} catch (error) {
  if (error?.message?.startsWith('CLOUDFLARE_E_')) throw error;
  throw new Error('CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');
}
validateR2ExposureCapture(exposureCapture, {
  expected: {
    environment: options.environment,
    bucket: targetPolicy.bucket,
    accountIdSha256: targetPolicy.accountIdSha256,
    jurisdiction: 'default',
  },
  now: new Date(),
  requirePrivate: true,
  maxLifetimeSeconds: targetPolicy.maxBucketExposureAgeSeconds,
  maxFutureSkewSeconds: targetPolicy.maxBucketExposureFutureSkewSeconds,
});
if (options.expectedOrphanCount !== targetPolicy.approvedOrphanCount) {
  throw new Error('MEDIA_E_ORPHAN_APPROVAL');
}

// No remote request is issued until every immutable target field above has
// been bound to the selected Wrangler environment and account hash.
const inspection = await inspectRemotePublicMedia(client, manifest, { concurrency: options.concurrency });
if (inspection.missing.length || inspection.mismatch.length) throw new Error('MEDIA_E_REMOTE_VALIDATION');
if (inspection.orphanCount !== options.expectedOrphanCount) throw new Error('MEDIA_E_ORPHAN_APPROVAL');
const fullAudit = await auditRemotePublicMediaFull(client, manifest, { concurrency: options.concurrency });
const receipt = createUnsignedRemoteReceipt(manifest, fullAudit.objects, {
  target: {
    environment: options.environment,
    bucket: targetPolicy.bucket,
    accountIdSha256: targetPolicy.accountIdSha256,
  },
  verificationLevel: 'full-get-sha256',
  orphanCount: inspection.orphanCount,
  bucketExposure: remoteReceiptBucketExposure(exposureCapture, {
    expected: {
      environment: options.environment,
      bucket: targetPolicy.bucket,
      accountIdSha256: targetPolicy.accountIdSha256,
      jurisdiction: 'default',
    },
    now: new Date(),
    requirePrivate: true,
    maxLifetimeSeconds: targetPolicy.maxBucketExposureAgeSeconds,
    maxFutureSkewSeconds: targetPolicy.maxBucketExposureFutureSkewSeconds,
  }),
});
await writeCanonicalEvidenceCreateOnly(
  options.receiptOutput, receipt, canonicalRemoteReceiptPayload,
);
console.log(JSON.stringify({
  validationScope: 'public-media-remote-full-get',
  environment: options.environment,
  manifestSha256: manifest.manifestSha256,
  objects: fullAudit.objectCount,
  bytes: fullAudit.totalBytes,
  orphan: inspection.orphanCount,
  receiptWritten: true,
  receiptSigned: false,
  bucketExposureBound: true,
  liveNetworkCallsInFixture: 0,
}, null, 2));
