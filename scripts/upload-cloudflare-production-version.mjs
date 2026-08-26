import { execFile } from 'node:child_process';
import { lstat, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalUploadAuthorizationPayload,
  loadSignedJsonFiles,
  parseWranglerVersionUploadNdjson,
  productionVersionUploadArguments,
  sha256Hex,
  validateUploadAuthorization,
  validateVersionUploadResult,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import {
  assertCloudflareAccountTarget,
  assertPinnedWranglerInstalled,
  cloudflareWranglerEnvironment,
  claimOneTimeAuthorization,
  installStructuredErrorHandler,
  runChecked,
} from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-upload-version');
const absolute = (value, code) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(code);
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR,
  'CLOUDFLARE_E_UPLOAD_ARTIFACT');
const outputPath = absolute(process.env.CLOUDFLARE_VERSION_UPLOAD_NDJSON_PATH,
  'CLOUDFLARE_E_UPLOAD_OUTPUT');
const resultPath = absolute(process.env.CLOUDFLARE_VERSION_UPLOAD_RESULT_PATH,
  'CLOUDFLARE_E_UPLOAD_RESULT');
for (const file of [outputPath, resultPath]) {
  const parentStats = await lstat(path.dirname(file));
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()
    || (parentStats.mode & 0o777) !== 0o700) throw new Error('CLOUDFLARE_E_UPLOAD_OUTPUT_PARENT');
}
const { receipt, artifactSha256 } = await validateArtifactDirectory(artifactDirectory);
const authorizationFiles = await loadSignedJsonFiles({
  receiptPath: absolute(process.env.CLOUDFLARE_UPLOAD_AUTHORIZATION_RECEIPT_PATH,
    'CLOUDFLARE_E_UPLOAD_AUTHORIZATION'),
  signaturePath: absolute(process.env.CLOUDFLARE_UPLOAD_AUTHORIZATION_SIGNATURE_PATH,
    'CLOUDFLARE_E_UPLOAD_AUTHORIZATION'),
  publicKeyPath: absolute(process.env.CLOUDFLARE_UPLOAD_AUTHORIZATION_PUBLIC_KEY_PATH,
    'CLOUDFLARE_E_UPLOAD_AUTHORIZATION'),
});
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true });
assertCloudflareAccountTarget(process.env.CLOUDFLARE_ACCOUNT_ID, receipt.accountIdSha256);
if (policy.production.accountIdSha256 !== receipt.accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
await assertPinnedWranglerInstalled(ROOT);
verifySignedPayload({
  payload: authorizationFiles.receipt,
  canonicalPayload: canonicalUploadAuthorizationPayload,
  validator: validateUploadAuthorization,
  signature: authorizationFiles.signature,
  publicKeyPem: authorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: policy.production.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      artifactSha256,
      accountIdSha256: receipt.accountIdSha256,
      sourceGitSha: receipt.sourceGitSha,
      workerName: receipt.workerName,
    },
    now: new Date(),
  },
});
const execFileAsync = promisify(execFile);
const sourceGitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
const gitStatus = (await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: ROOT })).stdout.trim();
if (gitStatus || sourceGitSha !== receipt.sourceGitSha
  || process.env.WORKERS_CI_COMMIT_SHA !== receipt.ciSourceGitSha
  || process.env.WORKERS_CI_BUILD_UUID !== authorizationFiles.receipt.buildUuid) {
  throw new Error('CLOUDFLARE_E_UPLOAD_SOURCE');
}
await claimOneTimeAuthorization({
  directory: absolute(process.env.CLOUDFLARE_UPLOAD_ATTEMPT_DIR,
    'CLOUDFLARE_E_AUTHORIZATION_ATTEMPT'),
  authorizationSha256: sha256Hex(canonicalUploadAuthorizationPayload(authorizationFiles.receipt)),
  scope: 'production-upload',
  target: 'dwnc-me',
});
const outputHandle = await open(outputPath, 'wx', 0o600);
const outputIdentity = await outputHandle.stat();
await outputHandle.close();
const args = productionVersionUploadArguments({ artifactDirectory, artifact: receipt });
await runChecked(path.join(ROOT, 'node_modules/.bin/wrangler'), args, {
  cwd: ROOT,
  env: cloudflareWranglerEnvironment(process.env, {
    CI: '1', WRANGLER_OUTPUT_FILE_PATH: outputPath, WRANGLER_WRITE_LOGS: '0',
    WRANGLER_SEND_METRICS: 'false', WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
  }),
});
const rawOutput = await readFile(outputPath, 'utf8');
const outputStats = await lstat(outputPath);
if (!outputStats.isFile() || outputStats.isSymbolicLink() || outputStats.nlink !== 1
  || outputStats.dev !== outputIdentity.dev || outputStats.ino !== outputIdentity.ino
  || (outputStats.mode & 0o777) !== 0o600) throw new Error('CLOUDFLARE_E_UPLOAD_OUTPUT_RACE');
const event = parseWranglerVersionUploadNdjson(rawOutput, { expectedArguments: args });
const session = JSON.parse(rawOutput.split(/\r?\n/u).filter(Boolean)[0]);
const authorizationCreated = Date.parse(authorizationFiles.receipt.createdAt);
const authorizationExpires = Date.parse(authorizationFiles.receipt.expiresAt);
const sessionAt = Date.parse(session.timestamp);
const uploadedAt = Date.parse(event.timestamp);
if (sessionAt < authorizationCreated - 120000 || sessionAt >= authorizationExpires
  || uploadedAt < sessionAt || uploadedAt >= authorizationExpires) {
  throw new Error('CLOUDFLARE_E_UPLOAD_OUTPUT_WINDOW');
}
const result = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-version-upload-result-v1',
  artifactSha256,
  versionId: event.version_id,
  workerName: event.worker_name,
  environment: event.wrangler_environment,
  wranglerOutputSha256: sha256Hex(rawOutput),
  uploadAuthorizationSha256: sha256Hex(canonicalUploadAuthorizationPayload(authorizationFiles.receipt)),
  buildUuid: authorizationFiles.receipt.buildUuid,
  uploadedAt: event.timestamp,
};
validateVersionUploadResult(result, { artifactSha256 });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  contract: result.contract,
  artifactSha256,
  versionId: result.versionId,
  versionUploaded: true,
  trafficChanged: false,
  deploymentAttempted: false,
}, null, 2));
