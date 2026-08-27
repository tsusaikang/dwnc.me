import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadTrackedPublicMediaReleasePolicy,
  loadTrackedPublicMediaManifest,
  validateConfiguredReleaseTarget,
} from './lib/public-media-manifest.mjs';
import {
  createBulkSyncReceipt,
  inspectRemotePublicMedia,
  loadLocalMediaBytes,
  mapWithConcurrency,
  r2OperationDelta,
} from './lib/public-media-remote.mjs';
import {
  r2ClientContextFromEnvironment,
} from './lib/r2-s3-client.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import {
  assertExactCleanPublicMediaGit,
  isPublicMediaGitOid,
} from './lib/public-media-git.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('media-r2-sync');

function parseArguments(argv) {
  const options = {
    apply: false, concurrency: 6, receiptOutput: null, expectedManifestSha256: null,
    expectedOrphanCount: null, expectedGitCommit: null, expectedGitTree: null,
    environment: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') options.apply = true;
    else if (argument.startsWith('--concurrency=')) options.concurrency = Number(argument.slice('--concurrency='.length));
    else if (argument.startsWith('--expected-manifest-sha256=')) options.expectedManifestSha256 = argument.slice('--expected-manifest-sha256='.length);
    else if (argument.startsWith('--receipt-output=')) options.receiptOutput = argument.slice('--receipt-output='.length);
    else if (argument.startsWith('--environment=')) options.environment = argument.slice('--environment='.length);
    else if (argument.startsWith('--expected-orphan-count=')) options.expectedOrphanCount = Number(argument.slice('--expected-orphan-count='.length));
    else if (argument.startsWith('--expected-git-commit=')) options.expectedGitCommit = argument.slice('--expected-git-commit='.length);
    else if (argument.startsWith('--expected-git-tree=')) options.expectedGitTree = argument.slice('--expected-git-tree='.length);
    else throw new Error('MEDIA_E_ARGUMENT');
  }
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16) {
    throw new Error('MEDIA_E_CONCURRENCY');
  }
  if (!['staging', 'production'].includes(options.environment)) throw new Error('MEDIA_E_ARGUMENT');
  if (options.apply && (!/^[a-f0-9]{64}$/u.test(options.expectedManifestSha256 ?? '')
    || typeof options.receiptOutput !== 'string' || !path.isAbsolute(options.receiptOutput)
    || path.resolve(options.receiptOutput).startsWith(`${path.resolve(ROOT)}${path.sep}`)
    || !Number.isSafeInteger(options.expectedOrphanCount) || options.expectedOrphanCount < 0
    || !isPublicMediaGitOid(options.expectedGitCommit)
    || !isPublicMediaGitOid(options.expectedGitTree))) {
    throw new Error('MEDIA_E_APPLY_EVIDENCE_REQUIRED');
  }
  if (!options.apply && (options.expectedManifestSha256 || options.receiptOutput
    || options.expectedOrphanCount !== null || options.expectedGitCommit
    || options.expectedGitTree)) throw new Error('MEDIA_E_ARGUMENT');
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (process.env.R2_RUNNER_ENVIRONMENT !== options.environment
  || process.env.R2_RUNNER_ROLE !== 'uploader') throw new Error('MEDIA_E_R2_SYNC_ROLE');
if (options.apply) {
  await assertSecureCreateOnlyDestination(options.receiptOutput);
  await assertExactCleanPublicMediaGit(
    ROOT, options.expectedGitCommit, options.expectedGitTree,
  );
}
const { credentials: r2Credentials, client } = r2ClientContextFromEnvironment(process.env);
const manifest = await loadTrackedPublicMediaManifest(ROOT);
if (options.apply && options.expectedManifestSha256 !== manifest.manifestSha256) {
  throw new Error('MEDIA_E_EXPECTED_MANIFEST');
}
const wranglerConfig = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const policyTarget = validateConfiguredReleaseTarget({
  policy: releasePolicy,
  environment: options.environment,
  accountId: r2Credentials.accountId,
  bucket: r2Credentials.bucket,
  wranglerConfig,
});
const target = {
  environment: options.environment,
  bucket: r2Credentials.bucket,
  accountIdSha256: policyTarget.accountIdSha256,
};
const requestCountsBefore = client.requestOperationCounts();
const conditionalRequestsBefore = client.conditionalIfNoneMatchPutRequestCount();
const startedAt = new Date().toISOString();
let inspection = await inspectRemotePublicMedia(client, manifest, { concurrency: options.concurrency });
const preInspection = inspection;
const initiallyMissing = inspection.missing.length;

console.log(JSON.stringify({
  mode: options.apply ? 'apply-preflight' : 'dry-run',
  manifestSha256: manifest.manifestSha256,
  desired: manifest.objectCount,
  exact: inspection.exact.length,
  missing: inspection.missing.length,
  mismatch: inspection.mismatch.length,
  orphan: inspection.orphanCount,
  overwrite: 0,
  delete: 0,
}, null, 2));

if (inspection.mismatch.length > 0) throw new Error('MEDIA_E_REMOTE_MISMATCH');
if (!options.apply) process.exit(0);
if (inspection.orphanCount !== options.expectedOrphanCount
  || inspection.orphanCount !== policyTarget.approvedOrphanCount) {
  throw new Error('MEDIA_E_ORPHAN_APPROVAL');
}

const writeResults = await mapWithConcurrency(inspection.missing, options.concurrency, async (entry) => {
  const bytes = await loadLocalMediaBytes(ROOT, entry);
  const result = await client.putCreateOnly(entry, bytes);
  if (result.preconditionFailed) {
    const raced = await client.head(entry.key);
    const { remoteObjectMatches } = await import('./lib/r2-s3-client.mjs');
    if (!remoteObjectMatches(entry, raced)) throw new Error('MEDIA_E_REMOTE_RACE');
    return 'precondition-recovered';
  }
  if (result.created !== true) throw new Error('MEDIA_E_R2_PUT_RESULT');
  return 'created';
});

inspection = await inspectRemotePublicMedia(client, manifest, { concurrency: options.concurrency });
if (inspection.exact.length !== manifest.objectCount || inspection.missing.length > 0
  || inspection.mismatch.length > 0 || inspection.orphanCount !== options.expectedOrphanCount
  || inspection.orphanCount !== policyTarget.approvedOrphanCount) {
  throw new Error('MEDIA_E_REMOTE_POST_UPLOAD');
}
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
const requestCounts = r2OperationDelta(requestCountsBefore, client.requestOperationCounts());
const conditionalIfNoneMatchRequests = client.conditionalIfNoneMatchPutRequestCount()
  - conditionalRequestsBefore;
const actualCreated = writeResults.filter((outcome) => outcome === 'created').length;
const preconditionRecovered = writeResults.filter(
  (outcome) => outcome === 'precondition-recovered',
).length;
const receipt = createBulkSyncReceipt(manifest, {
  target,
  source: {
    gitCommit: options.expectedGitCommit,
    gitTree: options.expectedGitTree,
    clean: true,
    gitCheckCount: 3,
  },
  expectedOrphanCount: options.expectedOrphanCount,
  preInspection,
  postInspection: inspection,
  writes: {
    initialMissing: initiallyMissing,
    exactSkipped: preInspection.exact.length,
    conditionalCreateOperations: writeResults.length,
    conditionalIfNoneMatchRequests,
    actualCreated,
    preconditionRecovered,
    overwrite: 0,
    delete: 0,
  },
  requestCounts,
  startedAt,
});
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
await writeCanonicalEvidenceCreateOnly(options.receiptOutput, receipt);
console.log(JSON.stringify({
  mode: 'apply-complete',
  initialMissing: initiallyMissing,
  conditionalCreateOperations: writeResults.length,
  actualCreated,
  preconditionRecovered,
  exact: inspection.exact.length,
  orphan: inspection.orphanCount,
  requestCounts,
  receiptWritten: true,
  receiptSigned: false,
  overwrite: 0,
  delete: 0,
}, null, 2));
