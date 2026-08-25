import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  expectedProductionAssetsResource,
  expectedProductionVersionBindings,
  productionPromotionConfig,
  productionUploadConfig,
} from './lib/cloudflare-artifact.mjs';
import {
  canonicalJson,
  cloudflareResourceDigest,
  directoryArtifactSha256,
  sha256Hex,
} from './lib/cloudflare-release.mjs';
import {
  collectPublicRequestSurface,
  loadTrackedPublicRequestSurface,
} from './lib/cloudflare-surface.mjs';
import { runChecked, sanitizedEnvironment } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-wrangler-artifact-'));
const bundleDirectory = path.join(temporary, 'bundle');
const secondBundleDirectory = path.join(temporary, 'bundle-second');
const verifyDirectory = path.join(temporary, 'verify');
const uploadConfig = productionUploadConfig('dwnc-me-public-media-production');
const promotionConfig = productionPromotionConfig();
const uploadConfigPath = path.join(temporary, 'wrangler-upload.jsonc');
const emptyEnvironmentPath = path.join(temporary, 'wrangler-empty.env');
const environment = sanitizedEnvironment(process.env, {
  CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
  WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true', XDG_CONFIG_HOME: temporary,
});
try {
  const mediaFiles = await readdir(path.join(ROOT, 'dist/media'), { recursive: true }).catch(() => []);
  if (mediaFiles.length !== 0) throw new Error('CLOUDFLARE_E_WRANGLER_BUNDLED_MEDIA');
  if (await readFile(path.join(ROOT, 'dist/.assetsignore'), 'utf8') !== 'media/\n*.map\n') {
    throw new Error('CLOUDFLARE_E_WRANGLER_ASSETSIGNORE');
  }
  await writeFile(uploadConfigPath, `${canonicalJson(uploadConfig)}\n`, { mode: 0o600 });
  await writeFile(emptyEnvironmentPath, '', { mode: 0o600 });
  for (const outputDirectory of [bundleDirectory, secondBundleDirectory]) {
    await runChecked(path.join(ROOT, 'node_modules/.bin/wrangler'), [
      'deploy', '--dry-run', '--env', 'production', '--config', 'wrangler.jsonc',
      '--env-file', emptyEnvironmentPath,
      '--outdir', outputDirectory, '--no-autoconfig',
    ], { cwd: ROOT, env: environment });
  }
  const worker = await readFile(path.join(bundleDirectory, 'worker.js'));
  const secondWorker = await readFile(path.join(secondBundleDirectory, 'worker.js'));
  if (!worker.equals(secondWorker)) throw new Error('CLOUDFLARE_E_WRANGLER_NONDETERMINISTIC');
  await runChecked(path.join(ROOT, 'node_modules/.bin/wrangler'), [
    'versions', 'upload', path.join(bundleDirectory, 'worker.js'), '--no-bundle', '--strict',
    '--assets', path.join(ROOT, 'dist'), '--dry-run', '--env', 'production',
    '--config', uploadConfigPath, '--env-file', emptyEnvironmentPath, '--outdir', verifyDirectory,
  ], { cwd: ROOT, env: environment });
  const verifiedWorker = await readFile(path.join(verifyDirectory, 'worker.js'));
  if (!worker.equals(verifiedWorker)) throw new Error('CLOUDFLARE_E_WRANGLER_NO_BUNDLE_DRIFT');
  const staticTree = await directoryArtifactSha256(path.join(ROOT, 'dist'), {
    exclude: (relative) => relative.startsWith('media/') || relative.endsWith('.map'),
  });
  const [builtSurface, trackedSurface] = await Promise.all([
    collectPublicRequestSurface(path.join(ROOT, 'dist')),
    loadTrackedPublicRequestSurface(ROOT),
  ]);
  if (canonicalJson(builtSurface) !== canonicalJson(trackedSurface)) {
    throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE_DRIFT');
  }
  console.log(JSON.stringify({
    wranglerEnvironment: 'production',
    wranglerVersion: '4.125.0',
    dryRun: true,
    versionUploadDryRun: true,
    repeatedWorkerBundleStable: true,
    deploymentAttempted: false,
    unstableReadmeIncluded: false,
    sourceMapIncluded: false,
    workerScriptSha256: sha256Hex(worker),
    workerScriptBytes: worker.length,
    staticTreeSha256: staticTree.sha256,
    staticFiles: staticTree.files,
    publicRequestPaths: builtSurface.pathCount,
    publicRequestSurfaceSha256: builtSurface.surfaceSha256,
    uploadConfigSha256: sha256Hex(canonicalJson(uploadConfig)),
    promotionConfigSha256: sha256Hex(canonicalJson(promotionConfig)),
    bindingsSha256: cloudflareResourceDigest(expectedProductionVersionBindings(
      'dwnc-me-public-media-production')),
    assetsConfigSha256: cloudflareResourceDigest(expectedProductionAssetsResource()),
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
