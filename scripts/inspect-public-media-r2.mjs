import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  validateConfiguredReleaseTarget,
} from './lib/public-media-manifest.mjs';
import {
  createRemoteInspectionReceipt,
  inspectRemotePublicMedia,
  r2OperationDelta,
} from './lib/public-media-remote.mjs';
import { r2ClientContextFromEnvironment } from './lib/r2-s3-client.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import {
  assertExactCleanPublicMediaGit,
  isPublicMediaGitOid,
} from './lib/public-media-git.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('media-r2-read-only-inspection');

function parseArguments(argv) {
  const options = {
    environment: null,
    concurrency: 8,
    expectedManifestSha256: null,
    expectedGitCommit: null,
    expectedGitTree: null,
    expectedExact: null,
    expectedMissing: null,
    expectedMismatch: null,
    expectedOrphanCount: null,
    receiptOutput: null,
  };
  const properties = Object.freeze({
    '--environment': 'environment',
    '--concurrency': 'concurrency',
    '--expected-manifest-sha256': 'expectedManifestSha256',
    '--expected-git-commit': 'expectedGitCommit',
    '--expected-git-tree': 'expectedGitTree',
    '--expected-exact': 'expectedExact',
    '--expected-missing': 'expectedMissing',
    '--expected-mismatch': 'expectedMismatch',
    '--expected-orphan-count': 'expectedOrphanCount',
    '--receipt-output': 'receiptOutput',
  });
  const seen = new Set();
  for (const argument of argv) {
    const separator = argument.indexOf('=');
    const name = separator > 0 ? argument.slice(0, separator) : argument;
    const value = separator > 0 ? argument.slice(separator + 1) : '';
    const property = properties[name];
    if (!property || !value || seen.has(name)) throw new Error('MEDIA_E_R2_INSPECTION_ARGUMENT');
    seen.add(name);
    options[property] = ['concurrency', 'expectedExact', 'expectedMissing',
      'expectedMismatch', 'expectedOrphanCount'].includes(property) ? Number(value) : value;
  }
  const relativeOutput = typeof options.receiptOutput === 'string'
    ? path.relative(ROOT, options.receiptOutput) : null;
  if (options.environment !== 'staging'
    || !Number.isSafeInteger(options.concurrency)
    || options.concurrency < 1 || options.concurrency > 16
    || !/^[a-f0-9]{64}$/u.test(options.expectedManifestSha256 ?? '')
    || !isPublicMediaGitOid(options.expectedGitCommit)
    || !isPublicMediaGitOid(options.expectedGitTree)
    || !['expectedExact', 'expectedMissing', 'expectedMismatch', 'expectedOrphanCount']
      .every((property) => Number.isSafeInteger(options[property]) && options[property] >= 0)
    || typeof options.receiptOutput !== 'string'
    || !path.isAbsolute(options.receiptOutput)
    || path.resolve(options.receiptOutput) !== options.receiptOutput
    || relativeOutput === '' || relativeOutput === '..'
    || !relativeOutput.startsWith(`..${path.sep}`)) {
    throw new Error('MEDIA_E_R2_INSPECTION_ARGUMENT');
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (process.env.R2_RUNNER_ENVIRONMENT !== 'staging'
  || process.env.R2_RUNNER_ROLE !== 'validator') {
  throw new Error('MEDIA_E_R2_INSPECTION_ROLE');
}
await assertSecureCreateOnlyDestination(options.receiptOutput);
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
const { credentials, client } = r2ClientContextFromEnvironment(process.env);
const [manifest, policy, wranglerConfig] = await Promise.all([
  loadTrackedPublicMediaManifest(ROOT),
  loadTrackedPublicMediaReleasePolicy(ROOT),
  readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8').then(JSON.parse),
]);
if (manifest.manifestSha256 !== options.expectedManifestSha256) {
  throw new Error('MEDIA_E_EXPECTED_MANIFEST');
}
if (options.expectedExact + options.expectedMissing + options.expectedMismatch
  !== manifest.objectCount) throw new Error('MEDIA_E_R2_INSPECTION_ARGUMENT');
const target = validateConfiguredReleaseTarget({
  policy,
  environment: 'staging',
  accountId: credentials.accountId,
  bucket: credentials.bucket,
  wranglerConfig,
});
const requestCountsBefore = client.requestOperationCounts();
const startedAt = new Date().toISOString();
const inspection = await inspectRemotePublicMedia(
  client, manifest, { concurrency: options.concurrency },
);
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
const receipt = createRemoteInspectionReceipt(manifest, inspection, {
  target: {
    environment: 'staging',
    accountIdSha256: target.accountIdSha256,
    bucket: target.bucket,
  },
  source: {
    gitCommit: options.expectedGitCommit,
    gitTree: options.expectedGitTree,
    clean: true,
    gitCheckCount: 3,
  },
  expected: {
    exact: options.expectedExact,
    missing: options.expectedMissing,
    mismatch: options.expectedMismatch,
    orphan: options.expectedOrphanCount,
  },
  requestCounts: r2OperationDelta(requestCountsBefore, client.requestOperationCounts()),
  startedAt,
});
await assertExactCleanPublicMediaGit(
  ROOT, options.expectedGitCommit, options.expectedGitTree,
);
await writeCanonicalEvidenceCreateOnly(options.receiptOutput, receipt);
console.log(JSON.stringify({
  mode: 'read-only-inspection',
  environment: receipt.target.environment,
  manifestSha256: receipt.manifestSha256,
  desired: receipt.desired,
  exact: receipt.observed.exact,
  missing: receipt.observed.missing,
  mismatch: receipt.observed.mismatch,
  orphan: receipt.observed.orphan,
  requestCounts: receipt.requestCounts,
  receiptWritten: true,
  overwrite: 0,
  delete: 0,
}, null, 2));
