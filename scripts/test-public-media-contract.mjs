import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  remoteValidationEnvironment, sanitizedEnvironment, writeAnonymousInheritedInput,
} from './lib/cloudflare-process.mjs';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import {
  assertManifestEqual,
  collectProjectedPublicMedia,
  loadTrackedPublicMediaReleasePolicy,
  validatePublicMediaReleasePolicy,
  loadTrackedPublicMediaManifest,
  validatePublicMediaManifest,
} from './lib/public-media-manifest.mjs';
import {
  assertR2RunnerCredentialEnvironment,
  buildR2RunnerInvocation,
} from './lib/r2-command-runner.mjs';

const ROOT = process.cwd();
let assertions = 0;
const throwsCode = (action, code) => {
  assert.throws(action, (error) => error?.code === code || error?.message === code);
  assertions += 1;
};

async function spawnFailure(script, args, expectedCode, extraEnvironment = {}, r2Credentials = null) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extraEnvironment,
      ...(r2Credentials ? { R2_CREDENTIALS_FD: '3' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe', ...(r2Credentials ? ['pipe'] : [])],
  });
  const credentialWrite = r2Credentials
    ? writeAnonymousInheritedInput(child.stdio[3], canonicalJson(r2Credentials), {
      descriptor: 3, maximumBytes: 4096,
    })
    : Promise.resolve();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [, code] = await Promise.all([credentialWrite, new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  })]);
  assert.notEqual(code, 0);
  assert.match(`${stdout}\n${stderr}`, new RegExp(expectedCode, 'u'));
  assert.doesNotMatch(`${stdout}\n${stderr}`, /r2\.cloudflarestorage\.com|AWS4-HMAC-SHA256 Credential=/u);
  assert.doesNotMatch(`${stdout}\n${stderr}`, /SYNTHETIC_SECRET_DO_NOT_LOG/u);
  assertions += 4;
  if (typeof r2Credentials?.secretAccessKey === 'string') {
    assert.equal(`${stdout}\n${stderr}`.includes(r2Credentials.secretAccessKey), false);
    assertions += 1;
  }
}

const tracked = await loadTrackedPublicMediaManifest(ROOT);

assert.deepEqual(buildR2RunnerInvocation('staging-sync', ['--concurrency=4']).args,
  ['--environment=staging', '--concurrency=4']);
assert.deepEqual(buildR2RunnerInvocation('staging-sync', [
  '--apply', '--concurrency=6', `--expected-manifest-sha256=${'a'.repeat(64)}`,
]).args, [
  '--environment=staging', '--apply', '--concurrency=6',
  `--expected-manifest-sha256=${'a'.repeat(64)}`,
]);
assert.equal(buildR2RunnerInvocation('staging-sync', ['--apply']).args
  .filter((value) => value === '--apply').length, 1);
assert.deepEqual(buildR2RunnerInvocation('staging-audit-full', ['--concurrency=2']).args,
  ['--environment=staging', '--concurrency=2']);
const validatorInspection = buildR2RunnerInvocation('staging-inspect', [
  '--concurrency=16', `--expected-manifest-sha256=${tracked.manifestSha256}`,
  `--expected-git-commit=${'a'.repeat(40)}`, `--expected-git-tree=${'b'.repeat(40)}`,
  '--expected-exact=2758', '--expected-missing=0', '--expected-mismatch=0',
  '--expected-orphan-count=0',
  '--receipt-output=/approved/staging-r2-inspection.json',
]);
assert.deepEqual({
  script: validatorInspection.script,
  environment: validatorInspection.environment,
  role: validatorInspection.role,
  allowApply: validatorInspection.allowApply,
  args: validatorInspection.args,
}, {
  script: 'scripts/inspect-public-media-r2.mjs',
  environment: 'staging',
  role: 'validator',
  allowApply: false,
  args: [
    '--environment=staging', '--concurrency=16',
    `--expected-manifest-sha256=${tracked.manifestSha256}`,
    `--expected-git-commit=${'a'.repeat(40)}`, `--expected-git-tree=${'b'.repeat(40)}`,
    '--expected-exact=2758', '--expected-missing=0', '--expected-mismatch=0',
    '--expected-orphan-count=0',
    '--receipt-output=/approved/staging-r2-inspection.json',
  ],
});
const oneObjectValidation = buildR2RunnerInvocation('staging-validate-one', [
  `--key=${tracked.entries[0].key}`,
  `--expected-manifest-sha256=${tracked.manifestSha256}`,
  `--expected-git-sha=${'a'.repeat(40)}`,
  '--receipt-output=/approved/staging-r2-one-object.json',
]);
assert.deepEqual({
  script: oneObjectValidation.script,
  environment: oneObjectValidation.environment,
  role: oneObjectValidation.role,
  allowApply: oneObjectValidation.allowApply,
  args: oneObjectValidation.args,
}, {
  script: 'scripts/validate-public-media-r2-staging-object.mjs',
  environment: 'staging',
  role: 'validator',
  allowApply: false,
  args: [
    `--key=${tracked.entries[0].key}`,
    `--expected-manifest-sha256=${tracked.manifestSha256}`,
    `--expected-git-sha=${'a'.repeat(40)}`,
    '--receipt-output=/approved/staging-r2-one-object.json',
  ],
});
assert.equal(assertR2RunnerCredentialEnvironment({ PATH: '/safe/bin' }), true);
assertions += 7;
throwsCode(() => buildR2RunnerInvocation('staging-sync', ['--environment=production']),
  'MEDIA_E_R2_RUNNER_TARGET');
throwsCode(() => buildR2RunnerInvocation('staging-sync', ['--environment=staging']),
  'MEDIA_E_R2_RUNNER_TARGET');
throwsCode(() => buildR2RunnerInvocation('staging-sync', ['--apply', '--apply']),
  'MEDIA_E_R2_RUNNER_APPLY');
throwsCode(() => buildR2RunnerInvocation('staging-audit-full', ['--apply']),
  'MEDIA_E_R2_RUNNER_APPLY');
throwsCode(() => buildR2RunnerInvocation('staging-inspect', ['--apply']),
  'MEDIA_E_R2_RUNNER_APPLY');
throwsCode(() => buildR2RunnerInvocation('staging-inspect', ['--environment=production']),
  'MEDIA_E_R2_RUNNER_TARGET');
throwsCode(() => buildR2RunnerInvocation('staging-inspect', ['--role=uploader']),
  'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-inspect', [
  '--credential-metadata=/tmp/uploader.json',
]), 'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-inspect', ['--delete']),
  'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-inspect', ['--overwrite']),
  'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-inspect', [
  '--concurrency=4', '--concurrency=8',
]), 'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-validate-one', ['--apply']),
  'MEDIA_E_R2_RUNNER_APPLY');
throwsCode(() => buildR2RunnerInvocation('staging-validate-one', ['--environment=production']),
  'MEDIA_E_R2_RUNNER_TARGET');
throwsCode(() => buildR2RunnerInvocation('staging-validate-one', ['--role=uploader']),
  'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-validate-one', ['--delete']),
  'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-validate-one', ['--overwrite']),
  'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => buildR2RunnerInvocation('staging-validate-one', [
  `--key=${tracked.entries[0].key}`, `--key=${tracked.entries[0].key}`,
]), 'MEDIA_E_R2_RUNNER_ARGUMENT');
throwsCode(() => assertR2RunnerCredentialEnvironment({ R2_CREDENTIALS_FD: '3' }),
  'MEDIA_E_R2_RUNNER_CREDENTIAL_AMBIGUOUS');
throwsCode(() => assertR2RunnerCredentialEnvironment({
  R2_ACCOUNT_ID: 'a'.repeat(32),
}), 'MEDIA_E_R2_RUNNER_CREDENTIAL_AMBIGUOUS');
throwsCode(() => assertR2RunnerCredentialEnvironment({
  R2_RUNNER_ROLE: 'validator',
}), 'MEDIA_E_R2_RUNNER_CREDENTIAL_AMBIGUOUS');
const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
assert.equal(packageJson.scripts['media:r2:staging:inspect:secure'],
  'node scripts/run-with-r2-credentials.mjs --command=staging-inspect --');
assert.equal(packageJson.scripts['media:r2:staging:validate-one:secure'],
  'node scripts/run-with-r2-credentials.mjs --command=staging-validate-one --');
assertions += 2;
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(ROOT);
assert.equal(releasePolicy.production.bucket, 'dwnc-me-public-media-production');
assert.equal(releasePolicy.staging.bucket, 'dwnc-me-public-media-staging');
assert.equal(releasePolicy.staging.accountIdSha256,
  '6ef9d1a2e2a398e755e1d4108acabacde0f5218f9f455abf79f1af56a154ea0f');
assert.equal(releasePolicy.staging.publicKeySpkiSha256,
  '69cb5866228f1624693b0903e60d52b0c046464040da621b2d144cb8bffb2182');
assert.equal(releasePolicy.staging.releasePublicKeySpkiSha256,
  '2655be4122fb2238d47ba539b8e86aa9d39899631a7d713106ce711ea2de1ac2');
assert.equal(releasePolicy.staging.smokeAccessPolicySha256,
  'd6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a');
assert.equal(releasePolicy.production.accountIdSha256, null);
assert.equal(releasePolicy.production.publicKeySpkiSha256, null);
assertions += 8;
throwsCode(
  () => validatePublicMediaReleasePolicy(releasePolicy, { requireComplete: true }),
  'MEDIA_E_RELEASE_POLICY_INCOMPLETE',
);

{
  const syntheticEnvironment = {
    PATH: '/safe/bin',
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_BUCKET_NAME: 'synthetic-bucket',
    R2_ACCESS_KEY_ID: 'b'.repeat(32),
    R2_SECRET_ACCESS_KEY: 'c'.repeat(64),
    R2_CREDENTIALS_FD: '3',
    PUBLIC_MEDIA_REMOTE_RECEIPT_PATH: '/synthetic/receipt',
    UNRELATED_SECRET: 'must-not-pass',
  };
  const buildEnvironment = sanitizedEnvironment(syntheticEnvironment);
  assert.deepEqual(buildEnvironment, { PATH: '/safe/bin' });
  const remoteEnvironment = remoteValidationEnvironment(syntheticEnvironment);
  assert.equal(remoteEnvironment.R2_CREDENTIALS_FD, '3');
  assert.equal('R2_SECRET_ACCESS_KEY' in remoteEnvironment, false);
  assert.equal('UNRELATED_SECRET' in remoteEnvironment, false);
  assertions += 4;
}
const { manifest } = await collectProjectedPublicMedia(ROOT, { assetMode: 'manifest' });
assertManifestEqual(tracked, manifest);
assertions += 1;

{
  const mutated = structuredClone(tracked);
  [mutated.entries[0], mutated.entries[1]] = [mutated.entries[1], mutated.entries[0]];
  throwsCode(() => validatePublicMediaManifest(mutated, { enforceBaseline: false }), 'MEDIA_E_MANIFEST_ORDER');
}
{
  const mutated = structuredClone(tracked);
  mutated.entries[0].publicPath = '/media/../private';
  mutated.entries[0].key = 'media/../private';
  throwsCode(() => validatePublicMediaManifest(mutated, { enforceBaseline: false }), 'MEDIA_E_PATH');
}
{
  const mutated = structuredClone(tracked);
  mutated.entries[0].contentType = 'text/html';
  throwsCode(() => validatePublicMediaManifest(mutated, { enforceBaseline: false }), 'MEDIA_E_MANIFEST_SUMMARY');
}

await spawnFailure('scripts/validate-public-media-remote.mjs', [], 'MEDIA_E_REMOTE_RECEIPT_REQUIRED');
await spawnFailure('scripts/run-with-r2-credentials.mjs', [
  '--command=staging-inspect', '--',
  `--expected-manifest-sha256=${tracked.manifestSha256}`,
  '--receipt-output=/tmp/dwnc-synthetic-inspection.json',
], 'MEDIA_E_R2_RUNNER_CREDENTIAL_AMBIGUOUS', {
  R2_ACCOUNT_ID: 'a'.repeat(32),
});
const validSyntheticR2Environment = {
  schemaVersion: 1,
  contract: 'dwnc-r2-s3-credentials-v1',
  accountId: 'a'.repeat(32),
  bucket: 'dwnc-me-public-media-staging',
  accessKeyId: 'b'.repeat(32),
  secretAccessKey: 'c'.repeat(64),
};
await spawnFailure('scripts/sync-public-media-r2.mjs', ['--environment=staging'],
  'MEDIA_E_RELEASE_TARGET', {
    R2_RUNNER_ENVIRONMENT: 'staging', R2_RUNNER_ROLE: 'uploader',
  }, validSyntheticR2Environment);
await spawnFailure('scripts/sync-public-media-r2.mjs', ['--environment=production'],
  'MEDIA_E_RELEASE_POLICY_INCOMPLETE', {
    R2_RUNNER_ENVIRONMENT: 'production', R2_RUNNER_ROLE: 'uploader',
  }, {
    ...validSyntheticR2Environment, bucket: 'dwnc-me-public-media-production',
  });
await spawnFailure('scripts/sync-public-media-r2.mjs', [
  '--apply', '--environment=staging', `--expected-manifest-sha256=${'0'.repeat(64)}`,
  '--expected-orphan-count=0', '--receipt-output=/tmp/dwnc-synthetic-apply-receipt.json',
], 'MEDIA_E_APPLY_EVIDENCE_REQUIRED', {
  R2_RUNNER_ENVIRONMENT: 'staging', R2_RUNNER_ROLE: 'uploader',
}, validSyntheticR2Environment);
await spawnFailure('scripts/sync-public-media-r2.mjs', ['--environment=staging'],
  'MEDIA_E_RELEASE_TARGET', {
    R2_RUNNER_ENVIRONMENT: 'staging', R2_RUNNER_ROLE: 'uploader',
  }, {
    ...validSyntheticR2Environment,
    bucket: 'dwnc-me-public-media-production',
    accessKeyId: 'd'.repeat(32),
    secretAccessKey: 'e'.repeat(64),
  });
await spawnFailure('scripts/admit-public-media-r2-staging-object.mjs', [],
  'MEDIA_E_STAGING_ADMISSION_ARGUMENT');
const outputSymlinkFixture = await mkdtemp(path.join(os.tmpdir(), 'dwnc-admission-output-'));
let repositoryOutputFixture = null;
try {
  repositoryOutputFixture = await mkdtemp(path.join(ROOT, 'src/.dwnc-admission-output-'));
  await symlink(path.join(ROOT, 'src'), path.join(outputSymlinkFixture, 'repo-src'));
  await spawnFailure('scripts/admit-public-media-r2-staging-object.mjs', [
    '--key=media/native/fixture.bin',
    `--expected-manifest-sha256=${'0'.repeat(64)}`,
    `--receipt-output=${path.join(
      outputSymlinkFixture, 'repo-src', path.basename(repositoryOutputFixture), 'receipt.json')}`,
  ], 'MEDIA_E_STAGING_ADMISSION_OUTPUT');
} finally {
  await rm(outputSymlinkFixture, { recursive: true, force: true });
  if (repositoryOutputFixture !== null) await rmdir(repositoryOutputFixture);
}
await spawnFailure('scripts/audit-public-media-r2-full.mjs', [], 'MEDIA_E_FULL_AUDIT_EVIDENCE_REQUIRED');

console.log(JSON.stringify({ suite: 'public-media-contract', assertions, liveNetworkCalls: 0, status: 'PASS' }, null, 2));
