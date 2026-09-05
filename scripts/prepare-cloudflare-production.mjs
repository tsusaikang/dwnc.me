import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createPreuploadArtifact,
  nativeReleaseResourcesFromConfig,
} from './lib/cloudflare-artifact.mjs';
import { directoryArtifactSha256 } from './lib/cloudflare-release.mjs';
import {
  assertPinnedWranglerInstalled,
  installStructuredErrorHandler,
  runChecked,
  sanitizedEnvironment,
} from './lib/cloudflare-process.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  validateProductionReleaseTarget,
  validateRemoteReceipt,
  verifyRemoteReceiptSignature,
} from './lib/public-media-manifest.mjs';
import { loadRemoteReceiptFiles } from './lib/public-media-remote.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-prepare-production');
const wranglerConfig = JSON.parse(await readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
const productionNativeResources = nativeReleaseResourcesFromConfig(wranglerConfig, 'production');
const stagingNativeResources = nativeReleaseResourcesFromConfig(wranglerConfig, 'staging');
if (['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID']
  .some((name) => Object.hasOwn(process.env, name))) {
  throw new Error('CLOUDFLARE_E_PREPARE_ACCOUNT_ENV_FORBIDDEN');
}
const execFileAsync = promisify(execFile);
const requireAbsolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_PREPARE_PATH');
  return value;
};
const sourceGitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
const gitStatus = (await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: ROOT })).stdout.trim();
const ciSourceGitSha = process.env.WORKERS_CI_COMMIT_SHA;
if (gitStatus || sourceGitSha !== ciSourceGitSha) throw new Error('CLOUDFLARE_E_PREPARE_SOURCE');
await assertPinnedWranglerInstalled(ROOT);

const mediaReceiptFiles = {
  receiptPath: requireAbsolute(process.env.PUBLIC_MEDIA_REMOTE_RECEIPT_PATH),
  signaturePath: requireAbsolute(process.env.PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH),
  publicKeyPath: requireAbsolute(process.env.PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH),
};
const [manifest, policy, remoteFiles] = await Promise.all([
  loadTrackedPublicMediaManifest(ROOT),
  loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true }),
  loadRemoteReceiptFiles(mediaReceiptFiles),
]);
validateRemoteReceipt(remoteFiles.receipt, manifest);
validateProductionReleaseTarget({
  policy,
  receipt: remoteFiles.receipt,
  accountIdSha256: remoteFiles.receipt.target.accountIdSha256,
  bucket: policy.production.bucket,
  publicKeyPem: remoteFiles.publicKeyPem,
  wranglerConfig,
});
verifyRemoteReceiptSignature(remoteFiles.receipt, remoteFiles.signature, remoteFiles.publicKeyPem);
const publicEnvironment = sanitizedEnvironment(process.env, { DWNC_MEDIA_MODE: 'remote' });
await runChecked(process.execPath, ['scripts/build-cloudflare-source.mjs'], { cwd: ROOT, env: publicEnvironment });
const firstStaticBuild = await directoryArtifactSha256(path.join(ROOT, 'dist'));
await runChecked(process.execPath, ['scripts/build-cloudflare-source.mjs'], { cwd: ROOT, env: publicEnvironment });
const secondStaticBuild = await directoryArtifactSha256(path.join(ROOT, 'dist'));
if (firstStaticBuild.sha256 !== secondStaticBuild.sha256
  || firstStaticBuild.files !== secondStaticBuild.files) {
  throw new Error('CLOUDFLARE_E_STATIC_NONDETERMINISTIC');
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-preupload-bundle-'));
const bundleDirectories = [path.join(temporary, 'bundle-a'), path.join(temporary, 'bundle-b')];
const emptyEnvironmentPath = path.join(temporary, 'wrangler-empty.env');
try {
  await writeFile(emptyEnvironmentPath, '', { flag: 'wx', mode: 0o600 });
  for (const [index, bundleDirectory] of bundleDirectories.entries()) {
    await runChecked(path.join(ROOT, 'node_modules/.bin/wrangler'), [
      'deploy', '--dry-run', '--env', 'production', '--config', 'wrangler.jsonc',
      '--env-file', emptyEnvironmentPath,
      '--outdir', bundleDirectory, '--no-autoconfig',
    ], {
      cwd: ROOT,
      env: sanitizedEnvironment(process.env, {
        CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
        WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
        XDG_CONFIG_HOME: path.join(temporary, `xdg-${index}`),
      }),
    });
  }
  const [firstWorker, secondWorker] = await Promise.all(bundleDirectories.map(
    (directory) => readFile(path.join(directory, 'worker.js'))));
  if (!firstWorker.equals(secondWorker)) throw new Error('CLOUDFLARE_E_WORKER_NONDETERMINISTIC');
  const result = await createPreuploadArtifact({
    sourceRoot: ROOT,
    artifactRoot: requireAbsolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_ROOT),
    bundleDirectory: bundleDirectories[0],
    sourceGitSha,
    ciSourceGitSha,
    accountIdSha256: policy.production.accountIdSha256,
    stagingAccountIdSha256: policy.staging.accountIdSha256,
    bucket: policy.production.bucket,
    stagingBucket: policy.staging.bucket,
    productionNativeResources,
    stagingNativeResources,
    mediaManifest: manifest,
    mediaRemoteReceipt: remoteFiles.receipt,
    mediaReceiptFiles,
  });
  console.log(JSON.stringify({
    contract: result.receipt.contract,
    artifactSha256: result.artifactSha256,
    artifactDirectory: result.directory,
    sourceGitSha,
    workerScriptSha256: result.receipt.workerScriptSha256,
    staticTreeSha256: result.receipt.staticTreeSha256,
    workerVersionId: null,
    uploadAttempted: false,
    deploymentAttempted: false,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
