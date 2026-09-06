import { chmod, cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalJson,
  cloudflarePayloadSha256,
  cloudflareResourceDigest,
  directoryArtifactSha256,
  preuploadArtifactSha256,
  sha256Hex,
  stagingPreuploadArtifactSha256,
  validatePreuploadArtifact,
  validateStagingPreuploadArtifact,
} from './cloudflare-release.mjs';
import {
  canonicalRemoteReceiptPayload,
  publicKeySpkiSha256,
  verifyRemoteReceiptSignature,
} from './public-media-manifest.mjs';
import { collectPublicRequestSurface } from './cloudflare-surface.mjs';

const fail = (code) => { throw new Error(code); };
const WRANGLER_VERSION = '4.125.0';
const COMPATIBILITY_DATE = '2026-08-24';
const D1_DATABASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

const NATIVE_RELEASE_TARGETS = Object.freeze({
  production: Object.freeze({
    nativeBucket: 'dwnc-me-native-media-production',
    databaseName: 'dwnc-me-native-production',
  }),
  staging: Object.freeze({
    nativeBucket: 'dwnc-me-native-media-staging',
    databaseName: 'dwnc-me-native-staging',
  }),
});

function validateNativeReleaseResources(resources, environment) {
  const target = NATIVE_RELEASE_TARGETS[environment];
  if (!target || !resources || typeof resources !== 'object' || Array.isArray(resources)
    || resources.nativeBucket !== target.nativeBucket
    || resources.databaseName !== target.databaseName
    || !D1_DATABASE_ID.test(resources.databaseId ?? '')) {
    fail('CLOUDFLARE_E_NATIVE_RELEASE_BINDING');
  }
  return Object.freeze({
    nativeBucket: resources.nativeBucket,
    databaseName: resources.databaseName,
    databaseId: resources.databaseId,
  });
}

export function nativeReleaseResourcesFromConfig(config, environment) {
  const target = NATIVE_RELEASE_TARGETS[environment];
  const value = config?.env?.[environment];
  if (!target || !value || !Array.isArray(value.r2_buckets)
    || !Array.isArray(value.d1_databases)) {
    fail('CLOUDFLARE_E_NATIVE_RELEASE_BINDING');
  }
  const nativeBuckets = value.r2_buckets.filter(
    (entry) => entry?.binding === 'NATIVE_MEDIA_BUCKET');
  const databases = value.d1_databases.filter((entry) => entry?.binding === 'NATIVE_DB');
  if (nativeBuckets.length !== 1 || databases.length !== 1
    || nativeBuckets[0].bucket_name !== target.nativeBucket
    || databases[0].database_name !== target.databaseName) {
    fail('CLOUDFLARE_E_NATIVE_RELEASE_BINDING');
  }
  if (!D1_DATABASE_ID.test(databases[0].database_id ?? '')) {
    fail('CLOUDFLARE_E_NATIVE_DATABASE_ID_REQUIRED');
  }
  return validateNativeReleaseResources({
    nativeBucket: nativeBuckets[0].bucket_name,
    databaseName: databases[0].database_name,
    databaseId: databases[0].database_id,
  }, environment);
}

function smokeStaticEntryFromReceipt(receipt) {
  return Object.freeze({
    publicPath: receipt.smokeStaticPath,
    size: receipt.smokeStaticBytes,
    sha256: receipt.smokeStaticSha256,
    contentType: receipt.smokeStaticMime,
  });
}

export function productionUploadConfig(bucket, nativeResources) {
  if (typeof bucket !== 'string' || !/^dwnc-me-public-media-production$/u.test(bucket)) {
    fail('CLOUDFLARE_E_ARTIFACT_TARGET');
  }
  const native = validateNativeReleaseResources(nativeResources, 'production');
  return {
    name: 'dwnc-me-upload-contract',
    main: './worker.js',
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: false,
    preview_urls: false,
    find_additional_modules: false,
    assets: {
      directory: './static',
      binding: 'ASSETS',
      html_handling: 'drop-trailing-slash',
      not_found_handling: '404-page',
      run_worker_first: true,
    },
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    env: {
      production: {
        name: 'dwnc-me',
        workers_dev: false,
        preview_urls: false,
        version_metadata: { binding: 'CF_VERSION_METADATA' },
        vars: { DWNC_DEPLOYMENT_ENVIRONMENT: 'production' },
        r2_buckets: [
          { binding: 'MEDIA_BUCKET', bucket_name: bucket },
          { binding: 'NATIVE_MEDIA_BUCKET', bucket_name: native.nativeBucket },
        ],
        d1_databases: [{
          binding: 'NATIVE_DB',
          database_name: native.databaseName,
          database_id: native.databaseId,
        }],
      },
    },
  };
}

export function stagingUploadConfig(bucket, nativeResources) {
  if (typeof bucket !== 'string' || !/^dwnc-me-public-media-staging$/u.test(bucket)) {
    fail('CLOUDFLARE_E_ARTIFACT_TARGET');
  }
  const native = validateNativeReleaseResources(nativeResources, 'staging');
  return {
    name: 'dwnc-me-staging-upload-contract',
    main: './worker.js',
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: false,
    preview_urls: false,
    find_additional_modules: false,
    assets: {
      directory: './static',
      binding: 'ASSETS',
      html_handling: 'drop-trailing-slash',
      not_found_handling: '404-page',
      run_worker_first: true,
    },
    version_metadata: { binding: 'CF_VERSION_METADATA' },
    env: {
      staging: {
        name: 'dwnc-me-staging',
        workers_dev: false,
        preview_urls: false,
        version_metadata: { binding: 'CF_VERSION_METADATA' },
        vars: {
          DWNC_DEPLOYMENT_ENVIRONMENT: 'staging',
        },
        r2_buckets: [
          { binding: 'MEDIA_BUCKET', bucket_name: bucket },
          { binding: 'NATIVE_MEDIA_BUCKET', bucket_name: native.nativeBucket },
        ],
        d1_databases: [{
          binding: 'NATIVE_DB',
          database_name: native.databaseName,
          database_id: native.databaseId,
        }],
      },
    },
  };
}

export function productionPromotionConfig() {
  return {
    name: 'dwnc-me-promotion-contract',
    compatibility_date: COMPATIBILITY_DATE,
    env: { production: { name: 'dwnc-me' } },
  };
}

export function stagingPromotionConfig() {
  return {
    name: 'dwnc-me-staging-promotion-contract',
    compatibility_date: COMPATIBILITY_DATE,
    env: { staging: { name: 'dwnc-me-staging' } },
  };
}

export function expectedProductionVersionBindings(bucket, nativeResources) {
  const native = validateNativeReleaseResources(nativeResources, 'production');
  return [
    { name: 'ASSETS', type: 'assets' },
    { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
    { name: 'DWNC_DEPLOYMENT_ENVIRONMENT', text: 'production', type: 'plain_text' },
    { name: 'MEDIA_BUCKET', bucket_name: bucket, type: 'r2_bucket' },
    { name: 'NATIVE_DB', id: native.databaseId, type: 'd1' },
    { name: 'NATIVE_MEDIA_BUCKET', bucket_name: native.nativeBucket, type: 'r2_bucket' },
  ];
}

export function expectedProductionAssetsResource() {
  return {
    html_handling: 'drop-trailing-slash',
    not_found_handling: '404-page',
    run_worker_first: true,
  };
}

export function expectedStagingVersionBindings(bucket, nativeResources) {
  const native = validateNativeReleaseResources(nativeResources, 'staging');
  return [
    { name: 'ASSETS', type: 'assets' },
    { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
    { name: 'DWNC_DEPLOYMENT_ENVIRONMENT', text: 'staging', type: 'plain_text' },
    { name: 'MEDIA_BUCKET', bucket_name: bucket, type: 'r2_bucket' },
    { name: 'NATIVE_DB', id: native.databaseId, type: 'd1' },
    { name: 'NATIVE_MEDIA_BUCKET', bucket_name: native.nativeBucket, type: 'r2_bucket' },
  ];
}

async function assertRegularFile(file, code) {
  let stats;
  try { stats = await lstat(file); }
  catch { fail(code); }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) fail(code);
  return stats;
}

async function assertDirectory(directory, code) {
  let stats;
  try { stats = await lstat(directory); }
  catch { fail(code); }
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail(code);
  return stats;
}

async function sealTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) fail('CLOUDFLARE_E_ARTIFACT_SEAL');
    if (entry.isDirectory()) {
      await sealTree(target);
      await chmod(target, 0o500);
    } else if (entry.isFile() && stats.nlink === 1) await chmod(target, 0o400);
    else fail('CLOUDFLARE_E_ARTIFACT_SEAL');
  }
  await chmod(directory, 0o500);
}

async function assertSealedTree(directory) {
  const rootStats = await lstat(directory);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || (rootStats.mode & 0o777) !== 0o500) {
    fail('CLOUDFLARE_E_ARTIFACT_SEAL');
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) fail('CLOUDFLARE_E_ARTIFACT_SEAL');
    if (entry.isDirectory()) await assertSealedTree(target);
    else if (!entry.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o400) {
      fail('CLOUDFLARE_E_ARTIFACT_SEAL');
    }
  }
}

async function removePending(directory) {
  try {
    await chmod(directory, 0o700);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await removePending(path.join(directory, entry.name));
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await rm(directory, { recursive: true, force: true });
}

export async function createPreuploadArtifact({
  sourceRoot,
  artifactRoot,
  bundleDirectory,
  sourceGitSha,
  ciSourceGitSha,
  accountIdSha256,
  stagingAccountIdSha256,
  bucket,
  stagingBucket,
  productionNativeResources,
  stagingNativeResources,
  mediaManifest,
  mediaRemoteReceipt,
  mediaReceiptFiles,
}) {
  if (![sourceRoot, artifactRoot, bundleDirectory].every((value) => typeof value === 'string' && path.isAbsolute(value))
    || sourceGitSha !== ciSourceGitSha
    || !/^[a-f0-9]{40}$/u.test(sourceGitSha ?? '')) {
    fail('CLOUDFLARE_E_ARTIFACT_INPUT');
  }
  await assertDirectory(sourceRoot, 'CLOUDFLARE_E_ARTIFACT_SOURCE');
  await assertDirectory(bundleDirectory, 'CLOUDFLARE_E_ARTIFACT_BUNDLE');
  const workerPath = path.join(bundleDirectory, 'worker.js');
  const workerStats = await assertRegularFile(workerPath, 'CLOUDFLARE_E_ARTIFACT_WORKER');
  const workerBytes = await readFile(workerPath);
  const staticSource = path.join(sourceRoot, 'dist');
  await assertDirectory(staticSource, 'CLOUDFLARE_E_ARTIFACT_STATIC');
  const localMedia = path.join(staticSource, 'media');
  try { await lstat(localMedia); fail('CLOUDFLARE_E_ARTIFACT_MEDIA'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }

  const uploadConfig = productionUploadConfig(bucket, productionNativeResources);
  const stagingConfig = stagingUploadConfig(stagingBucket, stagingNativeResources);
  const promotionConfig = productionPromotionConfig();
  const stagingPromotion = stagingPromotionConfig();
  const pending = path.join(artifactRoot, `.pending-${sourceGitSha}`);
  try {
    const artifactRootStats = await lstat(artifactRoot);
    if (!artifactRootStats.isDirectory() || artifactRootStats.isSymbolicLink()) {
      fail('CLOUDFLARE_E_ARTIFACT_ROOT');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(artifactRoot, { recursive: false, mode: 0o700 });
  }
  await assertRegularFile(mediaReceiptFiles.signaturePath, 'CLOUDFLARE_E_ARTIFACT_MEDIA_RECEIPT');
  await assertRegularFile(mediaReceiptFiles.publicKeyPath, 'CLOUDFLARE_E_ARTIFACT_MEDIA_RECEIPT');
  const mediaSignatureBytes = await readFile(mediaReceiptFiles.signaturePath);
  const mediaPublicKeyPem = await readFile(mediaReceiptFiles.publicKeyPath, 'utf8');
  await removePending(pending);
  await mkdir(pending, { mode: 0o700 });
  try {
    await cp(staticSource, path.join(pending, 'static'), {
      recursive: true,
      filter: (source) => !source.endsWith('.map') && !source.includes(`${path.sep}media${path.sep}`),
    });
    await cp(workerPath, path.join(pending, 'worker.js'));
    await writeFile(path.join(pending, 'wrangler-upload.jsonc'), `${canonicalJson(uploadConfig)}\n`, { mode: 0o600 });
    await writeFile(path.join(pending, 'wrangler-staging-upload.jsonc'), `${canonicalJson(stagingConfig)}\n`, { mode: 0o600 });
    await writeFile(path.join(pending, 'wrangler-empty.env'), '', { mode: 0o600 });
    await writeFile(path.join(pending, 'wrangler-promotion.jsonc'), `${canonicalJson(promotionConfig)}\n`, { mode: 0o600 });
    await writeFile(path.join(pending, 'wrangler-staging-promotion.jsonc'),
      `${canonicalJson(stagingPromotion)}\n`, { mode: 0o600 });
    await writeFile(path.join(pending, 'media-remote-receipt.json'),
      `${canonicalRemoteReceiptPayload(mediaRemoteReceipt)}\n`, { mode: 0o600 });
    await cp(mediaReceiptFiles.signaturePath, path.join(pending, 'media-remote-receipt.sig'));
    await cp(mediaReceiptFiles.publicKeyPath, path.join(pending, 'media-remote-public-key.pem'));
    const staticTree = await directoryArtifactSha256(path.join(pending, 'static'));
    const publicSurface = await collectPublicRequestSurface(path.join(pending, 'static'));
    const [sourceRedirects, staticRedirects, smokeStaticBytes] = await Promise.all([
      readFile(path.join(sourceRoot, 'public/_redirects')),
      readFile(path.join(pending, 'static/_redirects')),
      readFile(path.join(pending, 'static/about/index.html')),
    ]);
    if (!sourceRedirects.equals(staticRedirects)) fail('CLOUDFLARE_E_ARTIFACT_REDIRECTS');
    const receipt = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-preupload-artifact-v1',
      environment: 'production',
      sourceGitSha,
      ciSourceGitSha,
      workerName: 'dwnc-me',
      accountIdSha256,
      stagingAccountIdSha256,
      workerScriptSha256: sha256Hex(workerBytes),
      workerScriptBytes: workerStats.size,
      payloadSha256: cloudflarePayloadSha256(sha256Hex(workerBytes), staticTree.sha256),
      staticTreeSha256: staticTree.sha256,
      staticFiles: staticTree.files,
      publicRequestSurfaceSha256: publicSurface.surfaceSha256,
      publicRequestPaths: publicSurface.pathCount,
      smokeStaticPath: '/about',
      smokeStaticBytes: smokeStaticBytes.length,
      smokeStaticSha256: sha256Hex(smokeStaticBytes),
      smokeStaticMime: 'text/html',
      uploadConfigSha256: sha256Hex(canonicalJson(uploadConfig)),
      stagingUploadConfigSha256: sha256Hex(canonicalJson(stagingConfig)),
      environmentFileSha256: sha256Hex(''),
      promotionConfigSha256: sha256Hex(canonicalJson(promotionConfig)),
      stagingPromotionConfigSha256: sha256Hex(canonicalJson(stagingPromotion)),
      redirectsSha256: sha256Hex(staticRedirects),
      mediaManifestSha256: mediaManifest.manifestSha256,
      mediaRemoteReceiptSha256: sha256Hex(canonicalRemoteReceiptPayload(mediaRemoteReceipt)),
      mediaRemoteSignatureSha256: sha256Hex(mediaSignatureBytes),
      mediaRemotePublicKeySpkiSha256: publicKeySpkiSha256(mediaPublicKeyPem),
      bindingsSha256: cloudflareResourceDigest(expectedProductionVersionBindings(
        bucket, productionNativeResources)),
      assetsConfigSha256: cloudflareResourceDigest(expectedProductionAssetsResource()),
      stagingBindingsSha256: cloudflareResourceDigest(expectedStagingVersionBindings(
        stagingBucket, stagingNativeResources)),
      stagingAssetsConfigSha256: cloudflareResourceDigest(expectedProductionAssetsResource()),
      wranglerVersion: WRANGLER_VERSION,
      compatibilityDate: COMPATIBILITY_DATE,
    };
    validatePreuploadArtifact(receipt);
    const artifactSha256 = preuploadArtifactSha256(receipt);
    await writeFile(path.join(pending, 'artifact.json'), `${canonicalJson(receipt)}\n`, { mode: 0o600 });
    await sealTree(pending);
    const destination = path.join(artifactRoot, `artifact-${artifactSha256}`);
    try { await rename(pending, destination); }
    catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') fail('CLOUDFLARE_E_ARTIFACT_EXISTS');
      throw error;
    }
    return { directory: destination, artifactSha256, receipt };
  } catch (error) {
    await removePending(pending);
    throw error;
  }
}

export async function createStagingPreuploadArtifact({
  sourceRoot,
  artifactRoot,
  bundleDirectory,
  sourceGitSha,
  ciSourceGitSha,
  stagingAccountIdSha256,
  stagingBucket,
  stagingNativeResources,
  mediaManifest,
}) {
  if (![sourceRoot, artifactRoot, bundleDirectory].every(
    (value) => typeof value === 'string' && path.isAbsolute(value))
    || sourceGitSha !== ciSourceGitSha
    || !/^[a-f0-9]{40}$/u.test(sourceGitSha ?? '')) {
    fail('CLOUDFLARE_E_STAGING_ARTIFACT_INPUT');
  }
  await assertDirectory(sourceRoot, 'CLOUDFLARE_E_ARTIFACT_SOURCE');
  await assertDirectory(bundleDirectory, 'CLOUDFLARE_E_ARTIFACT_BUNDLE');
  const workerPath = path.join(bundleDirectory, 'worker.js');
  const workerStats = await assertRegularFile(workerPath, 'CLOUDFLARE_E_ARTIFACT_WORKER');
  const workerBytes = await readFile(workerPath);
  const staticSource = path.join(sourceRoot, 'dist');
  await assertDirectory(staticSource, 'CLOUDFLARE_E_ARTIFACT_STATIC');
  try { await lstat(path.join(staticSource, 'media')); fail('CLOUDFLARE_E_ARTIFACT_MEDIA'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }

  const stagingConfig = stagingUploadConfig(stagingBucket, stagingNativeResources);
  const stagingPromotion = stagingPromotionConfig();
  const pending = path.join(artifactRoot, `.pending-staging-${sourceGitSha}`);
  try {
    const artifactRootStats = await lstat(artifactRoot);
    if (!artifactRootStats.isDirectory() || artifactRootStats.isSymbolicLink()) {
      fail('CLOUDFLARE_E_ARTIFACT_ROOT');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(artifactRoot, { recursive: false, mode: 0o700 });
  }
  await removePending(pending);
  await mkdir(pending, { mode: 0o700 });
  try {
    await cp(staticSource, path.join(pending, 'static'), {
      recursive: true,
      filter: (source) => !source.endsWith('.map') && !source.includes(`${path.sep}media${path.sep}`),
    });
    await cp(workerPath, path.join(pending, 'worker.js'));
    await writeFile(path.join(pending, 'wrangler-staging-upload.jsonc'),
      `${canonicalJson(stagingConfig)}\n`, { mode: 0o600 });
    await writeFile(path.join(pending, 'wrangler-empty.env'), '', { mode: 0o600 });
    await writeFile(path.join(pending, 'wrangler-staging-promotion.jsonc'),
      `${canonicalJson(stagingPromotion)}\n`, { mode: 0o600 });
    const staticTree = await directoryArtifactSha256(path.join(pending, 'static'));
    const publicSurface = await collectPublicRequestSurface(path.join(pending, 'static'));
    const [sourceRedirects, staticRedirects, smokeStaticBytes] = await Promise.all([
      readFile(path.join(sourceRoot, 'public/_redirects')),
      readFile(path.join(pending, 'static/_redirects')),
      readFile(path.join(pending, 'static/about/index.html')),
    ]);
    if (!sourceRedirects.equals(staticRedirects)) fail('CLOUDFLARE_E_ARTIFACT_REDIRECTS');
    const receipt = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-staging-preupload-artifact-v2',
      environment: 'staging',
      sourceGitSha,
      ciSourceGitSha,
      workerName: 'dwnc-me-staging',
      stagingAccountIdSha256,
      workerScriptSha256: sha256Hex(workerBytes),
      workerScriptBytes: workerStats.size,
      payloadSha256: cloudflarePayloadSha256(sha256Hex(workerBytes), staticTree.sha256),
      staticTreeSha256: staticTree.sha256,
      staticFiles: staticTree.files,
      publicRequestSurfaceSha256: publicSurface.surfaceSha256,
      publicRequestPaths: publicSurface.pathCount,
      smokeStaticPath: '/about',
      smokeStaticBytes: smokeStaticBytes.length,
      smokeStaticSha256: sha256Hex(smokeStaticBytes),
      smokeStaticMime: 'text/html',
      stagingUploadConfigSha256: sha256Hex(canonicalJson(stagingConfig)),
      stagingPromotionConfigSha256: sha256Hex(canonicalJson(stagingPromotion)),
      environmentFileSha256: sha256Hex(''),
      redirectsSha256: sha256Hex(staticRedirects),
      mediaManifestSha256: mediaManifest.manifestSha256,
      stagingBindingsSha256: cloudflareResourceDigest(
        expectedStagingVersionBindings(stagingBucket, stagingNativeResources)),
      stagingAssetsConfigSha256: cloudflareResourceDigest(expectedProductionAssetsResource()),
      wranglerVersion: WRANGLER_VERSION,
      compatibilityDate: COMPATIBILITY_DATE,
    };
    validateStagingPreuploadArtifact(receipt);
    const artifactSha256 = stagingPreuploadArtifactSha256(receipt);
    await writeFile(path.join(pending, 'artifact.json'), `${canonicalJson(receipt)}\n`, { mode: 0o600 });
    await sealTree(pending);
    const destination = path.join(artifactRoot, `staging-artifact-${artifactSha256}`);
    try { await rename(pending, destination); }
    catch (error) {
      if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') fail('CLOUDFLARE_E_ARTIFACT_EXISTS');
      throw error;
    }
    return { directory: destination, artifactSha256, receipt };
  } catch (error) {
    await removePending(pending);
    throw error;
  }
}

export async function validateArtifactDirectory(directory) {
  await assertDirectory(directory, 'CLOUDFLARE_E_ARTIFACT_DIRECTORY');
  await assertSealedTree(directory);
  const receipt = JSON.parse(await readFile(path.join(directory, 'artifact.json'), 'utf8'));
  validatePreuploadArtifact(receipt);
  const worker = await readFile(path.join(directory, 'worker.js'));
  const staticTree = await directoryArtifactSha256(path.join(directory, 'static'));
  const publicSurface = await collectPublicRequestSurface(path.join(directory, 'static'));
  const staticRedirects = await readFile(path.join(directory, 'static/_redirects'));
  const smokeStaticBytes = await readFile(path.join(directory, 'static/about/index.html'));
  const uploadConfig = await readFile(path.join(directory, 'wrangler-upload.jsonc'), 'utf8');
  const stagingConfig = await readFile(path.join(directory, 'wrangler-staging-upload.jsonc'), 'utf8');
  const environmentFile = await readFile(path.join(directory, 'wrangler-empty.env'));
  const promotionConfig = await readFile(path.join(directory, 'wrangler-promotion.jsonc'), 'utf8');
  const stagingPromotion = await readFile(path.join(directory, 'wrangler-staging-promotion.jsonc'), 'utf8');
  const mediaReceiptRaw = await readFile(path.join(directory, 'media-remote-receipt.json'), 'utf8');
  const mediaSignatureRaw = await readFile(path.join(directory, 'media-remote-receipt.sig'));
  const mediaPublicKeyPem = await readFile(path.join(directory, 'media-remote-public-key.pem'), 'utf8');
  let mediaReceipt;
  try { mediaReceipt = JSON.parse(mediaReceiptRaw); }
  catch { fail('CLOUDFLARE_E_ARTIFACT_MEDIA_RECEIPT'); }
  const signatureText = mediaSignatureRaw.toString('utf8').trim();
  if (!/^[A-Za-z0-9+/]{86}==$/u.test(signatureText)) fail('CLOUDFLARE_E_ARTIFACT_MEDIA_RECEIPT');
  verifyRemoteReceiptSignature(mediaReceipt, Buffer.from(signatureText, 'base64'), mediaPublicKeyPem);
  if (sha256Hex(worker) !== receipt.workerScriptSha256 || worker.length !== receipt.workerScriptBytes
    || staticTree.sha256 !== receipt.staticTreeSha256 || staticTree.files !== receipt.staticFiles
    || publicSurface.surfaceSha256 !== receipt.publicRequestSurfaceSha256
    || publicSurface.pathCount !== receipt.publicRequestPaths
    || sha256Hex(staticRedirects) !== receipt.redirectsSha256
    || smokeStaticBytes.length !== receipt.smokeStaticBytes
    || sha256Hex(smokeStaticBytes) !== receipt.smokeStaticSha256
    || sha256Hex(uploadConfig.trim()) !== receipt.uploadConfigSha256
    || sha256Hex(stagingConfig.trim()) !== receipt.stagingUploadConfigSha256
    || sha256Hex(environmentFile) !== receipt.environmentFileSha256 || environmentFile.length !== 0
    || sha256Hex(promotionConfig.trim()) !== receipt.promotionConfigSha256
    || sha256Hex(stagingPromotion.trim()) !== receipt.stagingPromotionConfigSha256
    || sha256Hex(canonicalRemoteReceiptPayload(mediaReceipt)) !== receipt.mediaRemoteReceiptSha256
    || mediaReceipt.manifestSha256 !== receipt.mediaManifestSha256
    || sha256Hex(mediaSignatureRaw) !== receipt.mediaRemoteSignatureSha256
    || publicKeySpkiSha256(mediaPublicKeyPem) !== receipt.mediaRemotePublicKeySpkiSha256) {
    fail('CLOUDFLARE_E_ARTIFACT_DRIFT');
  }
  return {
    receipt,
    artifactSha256: preuploadArtifactSha256(receipt),
    staticEntry: smokeStaticEntryFromReceipt(receipt),
  };
}

function validateStagingArtifactAuthority({ artifact, policy, manifest }) {
  if (policy.staging.bucket !== 'dwnc-me-public-media-staging'
    || !/^[a-f0-9]{64}$/u.test(policy.staging.accountIdSha256 ?? '')
    || artifact.stagingAccountIdSha256 !== policy.staging.accountIdSha256
    || !/^[a-f0-9]{64}$/u.test(manifest.manifestSha256 ?? '')
    || artifact.mediaManifestSha256 !== manifest.manifestSha256) {
    fail('CLOUDFLARE_E_STAGING_ARTIFACT_AUTHORITY');
  }
}

export async function validateStagingArtifactDirectory(directory, { policy, manifest } = {}) {
  await assertDirectory(directory, 'CLOUDFLARE_E_ARTIFACT_DIRECTORY');
  await assertSealedTree(directory);
  const receipt = JSON.parse(await readFile(path.join(directory, 'artifact.json'), 'utf8'));
  validateStagingPreuploadArtifact(receipt);
  const worker = await readFile(path.join(directory, 'worker.js'));
  const staticTree = await directoryArtifactSha256(path.join(directory, 'static'));
  const publicSurface = await collectPublicRequestSurface(path.join(directory, 'static'));
  const staticRedirects = await readFile(path.join(directory, 'static/_redirects'));
  const smokeStaticBytes = await readFile(path.join(directory, 'static/about/index.html'));
  const stagingConfig = await readFile(path.join(directory, 'wrangler-staging-upload.jsonc'), 'utf8');
  const environmentFile = await readFile(path.join(directory, 'wrangler-empty.env'));
  const stagingPromotion = await readFile(
    path.join(directory, 'wrangler-staging-promotion.jsonc'), 'utf8');
  validateStagingArtifactAuthority({
    artifact: receipt, policy, manifest,
  });
  if (sha256Hex(worker) !== receipt.workerScriptSha256 || worker.length !== receipt.workerScriptBytes
    || staticTree.sha256 !== receipt.staticTreeSha256 || staticTree.files !== receipt.staticFiles
    || publicSurface.surfaceSha256 !== receipt.publicRequestSurfaceSha256
    || publicSurface.pathCount !== receipt.publicRequestPaths
    || sha256Hex(staticRedirects) !== receipt.redirectsSha256
    || smokeStaticBytes.length !== receipt.smokeStaticBytes
    || sha256Hex(smokeStaticBytes) !== receipt.smokeStaticSha256
    || sha256Hex(stagingConfig.trim()) !== receipt.stagingUploadConfigSha256
    || sha256Hex(environmentFile) !== receipt.environmentFileSha256 || environmentFile.length !== 0
    || sha256Hex(stagingPromotion.trim()) !== receipt.stagingPromotionConfigSha256) {
    fail('CLOUDFLARE_E_ARTIFACT_DRIFT');
  }
  return {
    receipt,
    artifactSha256: stagingPreuploadArtifactSha256(receipt),
    staticEntry: smokeStaticEntryFromReceipt(receipt),
  };
}

export async function validateStagingUploadArtifactDirectory(directory, stagingAuthority = {}) {
  await assertDirectory(directory, 'CLOUDFLARE_E_ARTIFACT_DIRECTORY');
  await assertSealedTree(directory);
  let receipt;
  try { receipt = JSON.parse(await readFile(path.join(directory, 'artifact.json'), 'utf8')); }
  catch { fail('CLOUDFLARE_E_ARTIFACT_DIRECTORY'); }
  if (receipt?.contract !== 'dwnc-cloudflare-staging-preupload-artifact-v2') {
    return validateArtifactDirectory(directory);
  }
  const authority = typeof stagingAuthority === 'function'
    ? await stagingAuthority() : stagingAuthority;
  return validateStagingArtifactDirectory(directory, authority);
}
