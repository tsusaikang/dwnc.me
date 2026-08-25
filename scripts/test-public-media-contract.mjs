import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, rmdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { remoteValidationEnvironment, sanitizedEnvironment } from './lib/cloudflare-process.mjs';
import {
  assertManifestEqual,
  collectProjectedPublicMedia,
  loadTrackedPublicMediaReleasePolicy,
  validatePublicMediaReleasePolicy,
  loadTrackedPublicMediaManifest,
  validatePublicMediaManifest,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
let assertions = 0;
const throwsCode = (action, code) => {
  assert.throws(action, (error) => error?.code === code || error?.message === code);
  assertions += 1;
};

async function spawnFailure(script, args, expectedCode, extraEnvironment = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extraEnvironment },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.notEqual(code, 0);
  assert.match(`${stdout}\n${stderr}`, new RegExp(expectedCode, 'u'));
  assert.doesNotMatch(`${stdout}\n${stderr}`, /r2\.cloudflarestorage\.com|AWS4-HMAC-SHA256 Credential=/u);
  assert.doesNotMatch(`${stdout}\n${stderr}`, /SYNTHETIC_SECRET_DO_NOT_LOG/u);
  assertions += 4;
}

const tracked = await loadTrackedPublicMediaManifest(ROOT);
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(ROOT);
assert.equal(releasePolicy.production.bucket, 'dwnc-me-public-media-production');
assert.equal(releasePolicy.staging.bucket, 'dwnc-me-public-media-staging');
assert.equal(releasePolicy.staging.accountIdSha256,
  '6ef9d1a2e2a398e755e1d4108acabacde0f5218f9f455abf79f1af56a154ea0f');
assert.equal(releasePolicy.staging.publicKeySpkiSha256, null);
assert.equal(releasePolicy.staging.releasePublicKeySpkiSha256, null);
assert.equal(releasePolicy.staging.smokeAccessPolicySha256, null);
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
    R2_ACCESS_KEY_ID: 'synthetic-access',
    R2_SECRET_ACCESS_KEY: 'synthetic-secret-value',
    PUBLIC_MEDIA_REMOTE_RECEIPT_PATH: '/synthetic/receipt',
    UNRELATED_SECRET: 'must-not-pass',
  };
  const buildEnvironment = sanitizedEnvironment(syntheticEnvironment);
  assert.deepEqual(buildEnvironment, { PATH: '/safe/bin' });
  const remoteEnvironment = remoteValidationEnvironment(syntheticEnvironment);
  assert.equal(remoteEnvironment.R2_SECRET_ACCESS_KEY, 'synthetic-secret-value');
  assert.equal('UNRELATED_SECRET' in remoteEnvironment, false);
  assertions += 3;
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
await spawnFailure('scripts/sync-public-media-r2.mjs', ['--environment=staging'], 'MEDIA_E_RELEASE_TARGET');
await spawnFailure('scripts/sync-public-media-r2.mjs', ['--environment=production'], 'MEDIA_E_RELEASE_POLICY_INCOMPLETE');
await spawnFailure('scripts/sync-public-media-r2.mjs', [
  '--apply', '--environment=staging', `--expected-manifest-sha256=${'0'.repeat(64)}`,
  '--expected-orphan-count=0', '--receipt-output=/tmp/dwnc-synthetic-apply-receipt.json',
], 'MEDIA_E_EXPECTED_MANIFEST');
await spawnFailure('scripts/sync-public-media-r2.mjs', ['--environment=staging'], 'MEDIA_E_RELEASE_TARGET', {
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_BUCKET_NAME: 'dwnc-me-public-media-production',
  R2_ACCESS_KEY_ID: 'SYNTHETIC_ACCESS_KEY',
  R2_SECRET_ACCESS_KEY: 'SYNTHETIC_SECRET_DO_NOT_LOG',
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
