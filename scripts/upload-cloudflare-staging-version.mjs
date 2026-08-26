import { execFile } from 'node:child_process';
import { lstat, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateStagingUploadArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalUploadAuthorizationPayload,
  canonicalStagingSecretAuthorizationPayload,
  canonicalJson,
  loadSignedJsonFiles,
  parseWranglerVersionUploadNdjson,
  sha256Hex,
  stagingUploadArtifactSha256,
  stagingVersionUploadArguments,
  validateUploadAuthorization,
  validateStagingSecretAuthorization,
  validateVersionUploadResult,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import {
  assertCloudflareAccountTarget,
  assertPinnedWranglerInstalled,
  cloudflareWranglerEnvironment,
  claimOneTimeAuthorization,
  installStructuredErrorHandler,
  runCheckedWithAnonymousInput,
} from './lib/cloudflare-process.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';
import { validateStagingSmokeToken } from '../src/lib/staging-smoke-token.js';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-upload-staging-version');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_UPLOAD_PATH');
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const outputPath = absolute(process.env.CLOUDFLARE_STAGING_VERSION_UPLOAD_NDJSON_PATH);
const resultPath = absolute(process.env.CLOUDFLARE_STAGING_VERSION_UPLOAD_RESULT_PATH);
const secretBindingResultPath = absolute(process.env.CLOUDFLARE_STAGING_SECRET_BINDING_RESULT_PATH);
const secretsFile = absolute(process.env.CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE);
for (const file of [outputPath, resultPath, secretBindingResultPath]) {
  const parentStats = await lstat(path.dirname(file));
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()
    || (parentStats.mode & 0o777) !== 0o700) throw new Error('CLOUDFLARE_E_UPLOAD_OUTPUT_PARENT');
}
const secretParent = await lstat(path.dirname(secretsFile));
const secretStats = await lstat(secretsFile);
if (!secretParent.isDirectory() || secretParent.isSymbolicLink()
  || (secretParent.mode & 0o777) !== 0o700
  || !secretStats.isFile() || secretStats.isSymbolicLink() || secretStats.nlink !== 1
  || (secretStats.mode & 0o777) !== 0o600
  || !path.relative(ROOT, secretsFile).startsWith('..')) {
  throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE');
}
const sourceSecretHandle = await open(secretsFile, 'r');
let secretsFileRaw;
try {
  const before = await sourceSecretHandle.stat();
  if (before.dev !== secretStats.dev || before.ino !== secretStats.ino || before.nlink !== 1) {
    throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE');
  }
  secretsFileRaw = await sourceSecretHandle.readFile('utf8');
  const after = await sourceSecretHandle.stat();
  const current = await lstat(secretsFile);
  if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
    || current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1) {
    throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE');
  }
} finally { await sourceSecretHandle.close(); }
let secretsPayload;
try { secretsPayload = JSON.parse(secretsFileRaw); }
catch { throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE'); }
const secretName = 'DWNC_STAGING_SMOKE_TOKEN';
if (!secretsPayload || Object.keys(secretsPayload).length !== 1
  || secretsFileRaw !== `${JSON.stringify({ [secretName]: secretsPayload[secretName] })}\n`) {
  throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE');
}
try { validateStagingSmokeToken(secretsPayload[secretName]); }
catch { throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE'); }
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const { receipt: artifact, artifactSha256 } = await validateStagingUploadArtifactDirectory(
  artifactDirectory,
  async () => ({ policy, manifest: await loadTrackedPublicMediaManifest(ROOT) }),
);
const target = policy.staging;
assertCloudflareAccountTarget(process.env.CLOUDFLARE_ACCOUNT_ID, target.accountIdSha256);
if (target.accountIdSha256 !== artifact.stagingAccountIdSha256
  || !/^[a-f0-9]{64}$/u.test(target.releasePublicKeySpkiSha256 ?? '')) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
await assertPinnedWranglerInstalled(ROOT);
const [authorizationFiles, secretAuthorizationFiles] = await Promise.all([
  loadSignedJsonFiles({
    receiptPath: absolute(process.env.CLOUDFLARE_STAGING_UPLOAD_AUTHORIZATION_RECEIPT_PATH),
    signaturePath: absolute(process.env.CLOUDFLARE_STAGING_UPLOAD_AUTHORIZATION_SIGNATURE_PATH),
    publicKeyPath: absolute(process.env.CLOUDFLARE_STAGING_UPLOAD_AUTHORIZATION_PUBLIC_KEY_PATH),
  }),
  loadSignedJsonFiles({
    receiptPath: absolute(process.env.CLOUDFLARE_STAGING_SECRET_AUTHORIZATION_RECEIPT_PATH),
    signaturePath: absolute(process.env.CLOUDFLARE_STAGING_SECRET_AUTHORIZATION_SIGNATURE_PATH),
    publicKeyPath: absolute(process.env.CLOUDFLARE_STAGING_SECRET_AUTHORIZATION_PUBLIC_KEY_PATH),
  }),
]);
verifySignedPayload({
  payload: authorizationFiles.receipt,
  canonicalPayload: canonicalUploadAuthorizationPayload,
  validator: validateUploadAuthorization,
  signature: authorizationFiles.signature,
  publicKeyPem: authorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      environment: 'staging', artifactSha256, accountIdSha256: artifact.stagingAccountIdSha256,
      sourceGitSha: artifact.sourceGitSha, workerName: 'dwnc-me-staging',
    },
    now: new Date(),
  },
});
const uploadAuthorizationSha256 = sha256Hex(
  canonicalUploadAuthorizationPayload(authorizationFiles.receipt));
// The approved argument is a stable inherited descriptor, never the mutable source pathname.
const inheritedSecretsFile = '/dev/fd/3';
const args = stagingVersionUploadArguments({
  artifactDirectory, artifact, secretsFile: inheritedSecretsFile,
});
const secretValueSha256 = sha256Hex(secretsPayload[secretName]);
const secretsFileSha256 = sha256Hex(secretsFileRaw);
verifySignedPayload({
  payload: secretAuthorizationFiles.receipt,
  canonicalPayload: canonicalStagingSecretAuthorizationPayload,
  validator: validateStagingSecretAuthorization,
  signature: secretAuthorizationFiles.signature,
  publicKeyPem: secretAuthorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      accountIdSha256: artifact.stagingAccountIdSha256, artifactSha256,
      sourceGitSha: artifact.sourceGitSha, uploadAuthorizationSha256,
      secretName, secretValueSha256, secretBytes: Buffer.byteLength(secretsPayload[secretName]),
      secretsFileSha256, uploadArgumentsSha256: sha256Hex(canonicalJson(args)),
      buildUuid: authorizationFiles.receipt.buildUuid,
    },
    now: new Date(),
  },
});
const sourceGitSha = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
const gitStatus = (await promisify(execFile)('git', ['status', '--porcelain=v1'], { cwd: ROOT })).stdout.trim();
if (gitStatus || sourceGitSha !== artifact.sourceGitSha
  || process.env.WORKERS_CI_COMMIT_SHA !== artifact.ciSourceGitSha
  || process.env.WORKERS_CI_BUILD_UUID !== authorizationFiles.receipt.buildUuid) {
  throw new Error('CLOUDFLARE_E_UPLOAD_SOURCE');
}
await claimOneTimeAuthorization({
  directory: absolute(process.env.CLOUDFLARE_UPLOAD_ATTEMPT_DIR),
  authorizationSha256: sha256Hex(`${canonicalUploadAuthorizationPayload(authorizationFiles.receipt)}\n${canonicalStagingSecretAuthorizationPayload(secretAuthorizationFiles.receipt)}`),
  scope: 'staging-upload',
  target: 'dwnc-me-staging',
});
const handle = await open(outputPath, 'wx', 0o600);
const identity = await handle.stat();
await handle.close();
const secretBytes = Buffer.from(secretsFileRaw);
try {
  const sealedInput = await runCheckedWithAnonymousInput(
    path.join(ROOT, 'node_modules/.bin/wrangler'), args, secretBytes, {
      cwd: ROOT,
      env: cloudflareWranglerEnvironment(process.env, {
        CI: '1', WRANGLER_OUTPUT_FILE_PATH: outputPath, WRANGLER_WRITE_LOGS: '0',
        WRANGLER_SEND_METRICS: 'false', WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
      }),
      descriptor: 3,
    },
  );
  if (sealedInput.path !== inheritedSecretsFile || sealedInput.sha256 !== secretsFileSha256) {
    throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE');
  }
} finally { secretBytes.fill(0); }
const rawOutput = await readFile(outputPath, 'utf8');
const stats = await lstat(outputPath);
if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
  || stats.dev !== identity.dev || stats.ino !== identity.ino || (stats.mode & 0o777) !== 0o600) {
  throw new Error('CLOUDFLARE_E_UPLOAD_OUTPUT_RACE');
}
const event = parseWranglerVersionUploadNdjson(rawOutput, {
  expectedArguments: args, expectedEnvironment: 'staging', expectedWorkerName: 'dwnc-me-staging',
});
const result = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-version-upload-result-v1',
  artifactSha256: stagingUploadArtifactSha256(artifact),
  versionId: event.version_id,
  workerName: event.worker_name,
  environment: 'staging',
  wranglerOutputSha256: sha256Hex(rawOutput),
  uploadAuthorizationSha256: sha256Hex(canonicalUploadAuthorizationPayload(authorizationFiles.receipt)),
  buildUuid: authorizationFiles.receipt.buildUuid,
  uploadedAt: event.timestamp,
};
validateVersionUploadResult(result, { artifactSha256 });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const secretBindingResult = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-staging-secret-binding-result-v1',
  artifactSha256,
  versionId: result.versionId,
  workerName: 'dwnc-me-staging',
  accountIdSha256: artifact.stagingAccountIdSha256,
  secretName,
  secretValueSha256,
  secretsFileSha256,
  stagingSecretAuthorizationSha256: sha256Hex(
    canonicalStagingSecretAuthorizationPayload(secretAuthorizationFiles.receipt)),
  uploadResultSha256: sha256Hex(canonicalJson(result)),
};
await writeFile(secretBindingResultPath, `${canonicalJson(secretBindingResult)}\n`,
  { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  contract: result.contract, artifactSha256, versionId: result.versionId,
  environment: 'staging', trafficChanged: false, deploymentAttempted: false,
}, null, 2));
