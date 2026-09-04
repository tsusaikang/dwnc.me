import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createStagingPreuploadArtifact } from './lib/cloudflare-artifact.mjs';
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
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-prepare-staging');
const execFileAsync = promisify(execFile);
const sourceGitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
const gitStatus = (await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: ROOT })).stdout.trimEnd();
const ciSourceGitSha = process.env.WORKERS_CI_COMMIT_SHA ?? sourceGitSha;
const localPrepareChanges = new Set([
  'scripts/prepare-cloudflare-staging.mjs',
  'scripts/lib/cloudflare-artifact.mjs',
  'scripts/lib/cloudflare-release.mjs',
  'scripts/test-cloudflare-artifact.mjs',
]);
const changedPaths = gitStatus ? gitStatus.split('\n').map((line) => line.slice(3)) : [];
if (changedPaths.some((changedPath) => !localPrepareChanges.has(changedPath))
  || sourceGitSha !== ciSourceGitSha) {
  throw new Error('CLOUDFLARE_E_STAGING_PREPARE_SOURCE');
}
await assertPinnedWranglerInstalled(ROOT);

const [manifest, policy] = await Promise.all([
  loadTrackedPublicMediaManifest(ROOT),
  loadTrackedPublicMediaReleasePolicy(ROOT),
]);

const publicEnvironment = sanitizedEnvironment(process.env, { DWNC_MEDIA_MODE: 'remote' });
await runChecked(process.execPath, ['scripts/build-cloudflare-source.mjs'], {
  cwd: ROOT, env: publicEnvironment,
});
const firstStaticBuild = await directoryArtifactSha256(path.join(ROOT, 'dist'));
await runChecked(process.execPath, ['scripts/build-cloudflare-source.mjs'], {
  cwd: ROOT, env: publicEnvironment,
});
const secondStaticBuild = await directoryArtifactSha256(path.join(ROOT, 'dist'));
if (firstStaticBuild.sha256 !== secondStaticBuild.sha256
  || firstStaticBuild.files !== secondStaticBuild.files) {
  throw new Error('CLOUDFLARE_E_STATIC_NONDETERMINISTIC');
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-staging-preupload-bundle-'));
const bundleDirectories = [path.join(temporary, 'bundle-a'), path.join(temporary, 'bundle-b')];
const emptyEnvironmentPath = path.join(temporary, 'wrangler-empty.env');
try {
  await writeFile(emptyEnvironmentPath, '', { flag: 'wx', mode: 0o600 });
  for (const [index, bundleDirectory] of bundleDirectories.entries()) {
    await runChecked(path.join(ROOT, 'node_modules/.bin/wrangler'), [
      'deploy', '--dry-run', '--env', 'staging', '--config', 'wrangler.jsonc',
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
  const artifactRoot = await mkdtemp('/private/tmp/dwnc-staging-preupload-');
  const result = await createStagingPreuploadArtifact({
    sourceRoot: ROOT,
    artifactRoot,
    bundleDirectory: bundleDirectories[0],
    sourceGitSha,
    ciSourceGitSha,
    stagingAccountIdSha256: policy.staging.accountIdSha256,
    stagingBucket: policy.staging.bucket,
    mediaManifest: manifest,
  });
  console.log(JSON.stringify({
    contract: result.receipt.contract,
    environment: 'staging',
    artifactSha256: result.artifactSha256,
    artifactDirectory: result.directory,
    sourceGitSha,
    workerScriptSha256: result.receipt.workerScriptSha256,
    staticTreeSha256: result.receipt.staticTreeSha256,
    payloadSha256: result.receipt.payloadSha256,
    workerVersionId: null,
    uploadAttempted: false,
    deploymentAttempted: false,
    liveNetworkCalls: 0,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
