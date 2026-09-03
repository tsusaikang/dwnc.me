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
  r2OperationDelta,
} from './lib/public-media-remote.mjs';
import {
  r2ClientFromCredentials,
  r2CredentialsFromEnvironment,
} from './lib/r2-s3-client.mjs';
import {
  STAGING_R2_EXPOSURE_PURPOSE,
  remoteReceiptBucketExposure,
} from './lib/cloudflare-r2-exposure.mjs';
import {
  assertSecureCreateOnlyDestination,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { sha256Hex } from './lib/cloudflare-release.mjs';
import {
  assertExactCleanPublicMediaGit,
  isPublicMediaGitOid,
} from './lib/public-media-git.mjs';

const ROOT = process.cwd();
const OFFLINE_BOUNDARY_SYMBOL = Symbol.for('dwnc.r2-full-audit.offline-boundary.v1');
installStructuredErrorHandler('media-r2-full-audit');

function parseArguments(argv) {
  const options = {
    environment: null,
    concurrency: 2,
    receiptOutput: null,
    expectedManifestSha256: null,
    expectedOrphanCount: null,
    expectedGitCommit: null,
    expectedGitTree: null,
    bucketExposureCapture: null,
  };
  for (const argument of argv) {
    if (argument.startsWith('--environment=')) options.environment = argument.slice(14);
    else if (argument.startsWith('--concurrency=')) options.concurrency = Number(argument.slice(14));
    else if (argument.startsWith('--receipt-output=')) options.receiptOutput = argument.slice(17);
    else if (argument.startsWith('--expected-manifest-sha256=')) options.expectedManifestSha256 = argument.slice(27);
    else if (argument.startsWith('--expected-orphan-count=')) options.expectedOrphanCount = Number(argument.slice(24));
    else if (argument.startsWith('--expected-git-commit=')) options.expectedGitCommit = argument.slice('--expected-git-commit='.length);
    else if (argument.startsWith('--expected-git-tree=')) options.expectedGitTree = argument.slice('--expected-git-tree='.length);
    else if (argument.startsWith('--bucket-exposure-capture=')) {
      options.bucketExposureCapture = argument.slice('--bucket-exposure-capture='.length);
    }
    else throw new Error('MEDIA_E_ARGUMENT');
  }
  const relativeOutput = typeof options.receiptOutput === 'string'
    ? path.relative(ROOT, options.receiptOutput) : null;
  if (options.environment !== 'staging'
    || !Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8
    || !/^[a-f0-9]{64}$/u.test(options.expectedManifestSha256 ?? '')
    || typeof options.receiptOutput !== 'string' || !path.isAbsolute(options.receiptOutput)
    || typeof options.bucketExposureCapture !== 'string'
    || !path.isAbsolute(options.bucketExposureCapture)
    || path.resolve(options.bucketExposureCapture) !== options.bucketExposureCapture
    || path.resolve(options.receiptOutput) !== options.receiptOutput
    || relativeOutput === '' || relativeOutput === '..'
    || !relativeOutput.startsWith(`..${path.sep}`)
    || !isPublicMediaGitOid(options.expectedGitCommit)
    || !isPublicMediaGitOid(options.expectedGitTree)
    || !Number.isSafeInteger(options.expectedOrphanCount) || options.expectedOrphanCount < 0) {
    throw new Error('MEDIA_E_FULL_AUDIT_EVIDENCE_REQUIRED');
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (process.env.R2_RUNNER_ENVIRONMENT !== 'staging'
  || process.env.R2_RUNNER_ROLE !== 'validator') throw new Error('MEDIA_E_FULL_AUDIT_ROLE');
await assertSecureCreateOnlyDestination(options.receiptOutput);
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
const r2Credentials = r2CredentialsFromEnvironment(process.env);
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
let exposureStored;
let exposureCanonicalBytes;
let exposureCaptureSha256;
try {
  exposureStored = await readSecureFile(options.bucketExposureCapture, 3 * 1024 * 1024);
  const parsed = parseCanonicalEvidenceStorage(exposureStored);
  exposureCapture = parsed.payload;
  exposureCanonicalBytes = parsed.canonicalBytes;
  exposureCaptureSha256 = sha256Hex(exposureCanonicalBytes);
  exposureStored.fill(0);
  exposureCanonicalBytes.fill(0);
  exposureStored = null;
  exposureCanonicalBytes = null;
} catch (error) {
  exposureStored?.fill(0);
  exposureCanonicalBytes?.fill(0);
  if (error?.message?.startsWith('CLOUDFLARE_E_')) throw error;
  throw new Error('CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');
}
const auditStartedAt = new Date();
const bucketExposure = remoteReceiptBucketExposure(exposureCapture, {
  expected: {
    purpose: STAGING_R2_EXPOSURE_PURPOSE,
    environment: options.environment,
    bucket: targetPolicy.bucket,
    accountIdSha256: targetPolicy.accountIdSha256,
    jurisdiction: 'default',
    sourceCommit: options.expectedGitCommit,
    sourceTree: options.expectedGitTree,
  },
  now: auditStartedAt,
  requirePrivate: true,
  maxLifetimeSeconds: targetPolicy.maxBucketExposureAgeSeconds,
  maxFutureSkewSeconds: targetPolicy.maxBucketExposureFutureSkewSeconds,
});
const client = r2ClientFromCredentials(r2Credentials, { maxAttempts: 1 });
if (options.expectedOrphanCount !== targetPolicy.approvedOrphanCount) {
  throw new Error('MEDIA_E_ORPHAN_APPROVAL');
}

// No remote request is issued until every immutable target field above has
// been bound to the selected Wrangler environment and account hash.
const requestCountsBefore = client.requestOperationCounts();
const startedAt = auditStartedAt.toISOString();
const inspection = await inspectRemotePublicMedia(client, manifest, { concurrency: options.concurrency });
if (inspection.missing.length || inspection.mismatch.length) throw new Error('MEDIA_E_REMOTE_VALIDATION');
if (inspection.orphanCount !== options.expectedOrphanCount) throw new Error('MEDIA_E_ORPHAN_APPROVAL');
const fullAudit = await auditRemotePublicMediaFull(client, manifest, {
  concurrency: options.concurrency,
  expectedHeads: inspection.heads,
});
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
const requestCounts = r2OperationDelta(requestCountsBefore, client.requestOperationCounts());
const receiptVerifiedAt = new Date();
const receipt = createUnsignedRemoteReceipt(manifest, fullAudit.objects, {
  target: {
    environment: options.environment,
    bucket: targetPolicy.bucket,
    accountIdSha256: targetPolicy.accountIdSha256,
  },
  verificationLevel: 'full-get-sha256',
  orphanCount: inspection.orphanCount,
  bucketExposure,
  fullAuditEvidence: {
    requestCounts,
    sourceCommit: options.expectedGitCommit,
    sourceTree: options.expectedGitTree,
    gitCheckCount: 3,
    startedAt,
    exposureCaptureSha256,
  },
  verifiedAt: receiptVerifiedAt.toISOString(),
});
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
await writeCanonicalEvidenceCreateOnly(
  options.receiptOutput, receipt, canonicalRemoteReceiptPayload,
);
const offlineBoundary = globalThis[OFFLINE_BOUNDARY_SYMBOL];
const fixtureCounters = typeof offlineBoundary?.snapshot === 'function'
  ? offlineBoundary.snapshot() : null;
console.log(JSON.stringify({
  validationScope: 'public-media-remote-full-get',
  environment: options.environment,
  manifestSha256: manifest.manifestSha256,
  objects: fullAudit.objectCount,
  bytes: fullAudit.totalBytes,
  orphan: inspection.orphanCount,
  requestCounts,
  fullObjectSetSha256: receipt.audit.fullObjectSetSha256,
  exposureCaptureSha256,
  receiptWritten: true,
  receiptSigned: false,
  bucketExposureBound: true,
  ...(fixtureCounters === null ? {} : { offlineBoundary: fixtureCounters }),
}, null, 2));
exposureStored?.fill(0);
exposureCanonicalBytes?.fill(0);
