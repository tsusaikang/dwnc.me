import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCloudflareProductionUploadAuthorization,
  createCloudflareProductionUploadAuthorizationCommand,
} from './create-cloudflare-production-upload-authorization.mjs';
import {
  canonicalJson,
  canonicalUploadAuthorizationPayload,
  sha256Hex,
  validateUploadAuthorization,
} from './lib/cloudflare-release.mjs';

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = async (operation, pattern) => {
  await assert.rejects(operation, pattern); assertions += 1;
};

const repositoryRoot = process.cwd();
const sourceGitSha = '1'.repeat(40);
const artifactSha256 = sha256Hex('production-artifact');
const accountIdSha256 = sha256Hex('production-account');
const buildUuid = '12345678-1234-4234-8234-123456789abc';
const snapshot = Object.freeze({ commit: sourceGitSha, tree: '2'.repeat(40), clean: true });
const artifactResult = Object.freeze({
  receipt: Object.freeze({
    environment: 'production', workerName: 'dwnc-me', sourceGitSha, accountIdSha256,
  }),
  artifactSha256,
});
const temporary = await realpath(
  await mkdtemp(path.join(os.tmpdir(), 'dwnc-upload-authorization-test-')),
);
await chmod(temporary, 0o700);
try {
  const artifactDirectory = path.join(temporary, 'artifact');
  const outputPath = path.join(temporary, 'candidate.json');
  const nonce = Buffer.alloc(32, 7);
  const base = (output = outputPath, overrides = {}) => ({
    repositoryRoot,
    artifactDirectory,
    buildUuid,
    outputPath: output,
    validateArtifact: async () => overrides.artifactResult ?? artifactResult,
    loadPolicy: async () => overrides.policy ?? ({
      production: {
        environment: 'production', accountIdSha256,
        releasePublicKeySpkiSha256: sha256Hex('release-key'),
      },
    }),
    inspectGit: async () => overrides.snapshot ?? snapshot,
    now: () => overrides.now ?? new Date('2026-09-05T00:00:00.000Z'),
    randomBytesImpl: () => overrides.nonce ?? nonce,
  });
  const summary = await createCloudflareProductionUploadAuthorization(base());
  const stored = await readFile(outputPath, 'utf8');
  const candidate = JSON.parse(stored);
  const stats = await lstat(outputPath);
  equal(stored, `${canonicalJson(candidate)}\n`);
  equal(Object.keys(candidate).length, 11);
  equal(Object.keys(candidate).sort(), [
    'accountIdSha256', 'artifactSha256', 'buildUuid', 'contract', 'createdAt',
    'environment', 'expiresAt', 'nonceSha256', 'schemaVersion', 'sourceGitSha', 'workerName',
  ].sort());
  equal(candidate.artifactSha256, artifactSha256);
  equal(candidate.accountIdSha256, accountIdSha256);
  equal(candidate.workerName, 'dwnc-me');
  equal(candidate.sourceGitSha, sourceGitSha);
  equal(candidate.buildUuid, buildUuid);
  equal(Date.parse(candidate.expiresAt) - Date.parse(candidate.createdAt), 10 * 60 * 1000);
  equal(validateUploadAuthorization(candidate, {
    expected: {
      environment: 'production', artifactSha256, accountIdSha256,
      workerName: 'dwnc-me', sourceGitSha, buildUuid,
    },
    now: new Date(candidate.createdAt), maxLifetimeSeconds: 15 * 60,
  }), candidate);
  equal(stats.mode & 0o777, 0o600);
  equal(stats.nlink, 1);
  equal(nonce.every((value) => value === 0), true);
  equal(summary.authorizationSha256, sha256Hex(canonicalUploadAuthorizationPayload(candidate)));
  equal(summary.candidateWritten, true);
  equal(summary.signed, false);
  equal(summary.rawAccountPrinted, false);
  equal(summary.rawTokenPrinted, false);
  await rejects(() => createCloudflareProductionUploadAuthorization(base()),
    /CLOUDFLARE_E_SIGNING_FILE_EXISTS/u);
  await rejects(() => createCloudflareProductionUploadAuthorization(base(
    path.join(temporary, 'dirty.json'), { snapshot: { ...snapshot, clean: false } },
  )), /CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_GIT/u);
  await rejects(() => createCloudflareProductionUploadAuthorization({
    ...base(path.join(temporary, 'wrong-source.json')),
    validateArtifact: async () => ({
      ...artifactResult, receipt: { ...artifactResult.receipt, sourceGitSha: '3'.repeat(40) },
    }),
  }), /CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_GIT/u);
  await rejects(() => createCloudflareProductionUploadAuthorization({
    ...base(path.join(temporary, 'wrong-environment.json')),
    validateArtifact: async () => ({
      ...artifactResult, receipt: { ...artifactResult.receipt, environment: 'staging' },
    }),
  }), /CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_ARTIFACT/u);

  let cliObserved;
  equal(await createCloudflareProductionUploadAuthorizationCommand({
    root: repositoryRoot,
    argv: [
      `--artifact=${artifactDirectory}`, `--build-uuid=${buildUuid}`,
      `--output=${path.join(temporary, 'cli.json')}`,
    ],
    createAuthorization: async (value) => { cliObserved = value; return { status: 'fixed' }; },
  }), { status: 'fixed' });
  equal(cliObserved, {
    repositoryRoot,
    artifactDirectory,
    buildUuid,
    outputPath: path.join(temporary, 'cli.json'),
  });
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  equal(packageJson.scripts['cloudflare:upload:production-authorization:create'],
    'node scripts/create-cloudflare-production-upload-authorization.mjs');
  await rejects(() => createCloudflareProductionUploadAuthorizationCommand({
    root: repositoryRoot,
    argv: [`--artifact=${artifactDirectory}`, `--build-uuid=${buildUuid}`],
    createAuthorization: async () => ({}),
  }), /CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_ARGUMENT/u);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  suite: 'cloudflare-upload-authorization-creator',
  assertions,
  authorizationFields: 11,
  maximumLifetimeSeconds: 900,
  liveNetworkCalls: 0,
  credentialReads: 0,
  status: 'PASS',
}, null, 2));
