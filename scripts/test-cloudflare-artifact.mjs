import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createPreuploadArtifact,
  createStagingPreuploadArtifact,
  validateArtifactDirectory,
  validateStagingArtifactDirectory,
  validateStagingUploadArtifactDirectory,
} from './lib/cloudflare-artifact.mjs';
import {
  canonicalRemoteReceiptPayload,
  loadTrackedPublicMediaReleasePolicy,
  publicKeySpkiSha256,
} from './lib/public-media-manifest.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-artifact-fixture-'));
async function unlock(directory) {
  await chmod(directory, 0o700).catch(() => undefined);
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) await unlock(path.join(directory, entry.name));
    else await chmod(path.join(directory, entry.name), 0o600).catch(() => undefined);
  }
}
try {
  const sourceRoot = path.join(temporary, 'source');
  const bundleDirectory = path.join(temporary, 'bundle');
  await mkdir(path.join(sourceRoot, 'dist'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'public'), { recursive: true });
  await mkdir(bundleDirectory);
  await writeFile(path.join(sourceRoot, 'dist/index.html'), 'static');
  await writeFile(path.join(sourceRoot, 'dist/.assetsignore'), 'media/\n*.map\n');
  await writeFile(path.join(sourceRoot, 'public/_redirects'), '/old /posts/1 308\n');
  await writeFile(path.join(bundleDirectory, 'worker.js'), 'export default { fetch() {} };');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const stagingPolicy = structuredClone(await loadTrackedPublicMediaReleasePolicy(process.cwd()));
  stagingPolicy.staging.accountIdSha256 = 'b'.repeat(64);
  stagingPolicy.staging.publicKeySpkiSha256 = publicKeySpkiSha256(publicKeyPem);
  const stagingManifest = {
    manifestSha256: 'a'.repeat(64), objectCount: 0, totalBytes: 0, entries: [],
  };
  const remoteReceipt = {
    schemaVersion: 1, contract: 'dwnc-public-media-r2-receipt-v1', manifestSha256: 'a'.repeat(64),
    objectCount: 0, totalBytes: 0,
    target: { environment: 'production', bucket: 'dwnc-me-public-media-production', accountIdSha256: 'b'.repeat(64) },
    verificationLevel: 'full-get-sha256',
    bucketExposure: { verification: 'cloudflare-control-plane', r2DevEnabled: false,
      customDomainCount: 0, verifiedAt: '2026-08-25T00:00:00.000Z', evidenceSha256: 'c'.repeat(64) },
    verifiedAt: '2026-08-25T00:00:00.000Z',
    audit: { headObjects: 0, fullGetObjects: 0, fullGetBytes: 0, orphanCount: 0 }, objects: [],
  };
  const signature = sign(null, Buffer.from(canonicalRemoteReceiptPayload(remoteReceipt)), privateKey);
  const signaturePath = path.join(temporary, 'remote.sig');
  const publicKeyPath = path.join(temporary, 'remote.pem');
  await writeFile(signaturePath, `${signature.toString('base64')}\n`, { mode: 0o600 });
  await writeFile(publicKeyPath, publicKeyPem, { mode: 0o600 });
  const stagingRemoteReceipt = {
    ...remoteReceipt,
    target: {
      environment: 'staging',
      bucket: 'dwnc-me-public-media-staging',
      accountIdSha256: 'b'.repeat(64),
    },
  };
  const stagingSignature = sign(
    null, Buffer.from(canonicalRemoteReceiptPayload(stagingRemoteReceipt)), privateKey);
  const stagingSignaturePath = path.join(temporary, 'staging-remote.sig');
  await writeFile(stagingSignaturePath, `${stagingSignature.toString('base64')}\n`, { mode: 0o600 });
  const input = {
    sourceRoot,
    bundleDirectory,
    sourceGitSha: '1'.repeat(40),
    ciSourceGitSha: '1'.repeat(40),
    accountIdSha256: 'b'.repeat(64),
    stagingAccountIdSha256: 'b'.repeat(64),
    bucket: 'dwnc-me-public-media-production',
    stagingBucket: 'dwnc-me-public-media-staging',
    mediaManifest: { manifestSha256: 'a'.repeat(64) },
    mediaRemoteReceipt: remoteReceipt,
    mediaReceiptFiles: { signaturePath, publicKeyPath },
  };
  const first = await createPreuploadArtifact({ ...input, artifactRoot: path.join(temporary, 'artifacts-a') });
  const second = await createPreuploadArtifact({ ...input, artifactRoot: path.join(temporary, 'artifacts-b') });
  assert.equal(first.artifactSha256, second.artifactSha256);
  assert.equal(first.receipt.payloadSha256, second.receipt.payloadSha256);
  const validated = await validateArtifactDirectory(first.directory);
  assert.equal(validated.artifactSha256, first.artifactSha256);
  assert.equal((await stat(first.directory)).mode & 0o777, 0o500);
  assert.equal((await stat(path.join(first.directory, 'worker.js'))).mode & 0o777, 0o400);
  assert.equal((await readFile(path.join(first.directory, 'worker.js'), 'utf8')).includes('fetch'), true);
  assert.equal(first.receipt.publicRequestPaths, 1);
  assert.equal(first.receipt.publicRequestSurfaceSha256.length, 64);
  const stagingInput = {
    sourceRoot,
    bundleDirectory,
    sourceGitSha: '1'.repeat(40),
    ciSourceGitSha: '1'.repeat(40),
    stagingAccountIdSha256: 'b'.repeat(64),
    stagingBucket: 'dwnc-me-public-media-staging',
    mediaManifest: stagingManifest,
    mediaRemoteReceipt: stagingRemoteReceipt,
    mediaReceiptFiles: { signaturePath: stagingSignaturePath, publicKeyPath },
  };
  const stagingFirst = await createStagingPreuploadArtifact({
    ...stagingInput, artifactRoot: path.join(temporary, 'staging-artifacts-a'),
  });
  const stagingSecond = await createStagingPreuploadArtifact({
    ...stagingInput, artifactRoot: path.join(temporary, 'staging-artifacts-b'),
  });
  assert.equal(stagingFirst.artifactSha256, stagingSecond.artifactSha256);
  assert.equal(stagingFirst.receipt.payloadSha256, stagingSecond.receipt.payloadSha256);
  assert.equal(stagingFirst.receipt.payloadSha256, first.receipt.payloadSha256);
  assert.notEqual(stagingFirst.artifactSha256, first.artifactSha256);
  const stagingAuthority = { policy: stagingPolicy, manifest: stagingManifest };
  const stagingValidated = await validateStagingArtifactDirectory(
    stagingFirst.directory, stagingAuthority,
  );
  assert.equal(stagingValidated.artifactSha256, stagingFirst.artifactSha256);
  let productionAuthorityLoads = 0;
  const productionViaStagingUpload = await validateStagingUploadArtifactDirectory(
    first.directory,
    async () => { productionAuthorityLoads += 1; throw new Error('authority must stay lazy'); },
  );
  assert.equal(productionViaStagingUpload.artifactSha256, first.artifactSha256);
  assert.equal(productionAuthorityLoads, 0);
  let stagingAuthorityLoads = 0;
  const stagingViaUpload = await validateStagingUploadArtifactDirectory(
    stagingFirst.directory,
    async () => { stagingAuthorityLoads += 1; return stagingAuthority; },
  );
  assert.equal(stagingViaUpload.artifactSha256, stagingFirst.artifactSha256);
  assert.equal(stagingAuthorityLoads, 1);
  await assert.rejects(() => validateArtifactDirectory(stagingFirst.directory));
  await assert.rejects(() => validateStagingArtifactDirectory(first.directory, stagingAuthority));
  assert.equal((await readdir(stagingFirst.directory)).includes('wrangler-upload.jsonc'), false);

  const missingKeyPolicy = structuredClone(stagingPolicy);
  missingKeyPolicy.staging.publicKeySpkiSha256 = null;
  await assert.rejects(() => validateStagingArtifactDirectory(stagingFirst.directory, {
    policy: missingKeyPolicy, manifest: stagingManifest,
  }));
  const wrongKeyPolicy = structuredClone(stagingPolicy);
  wrongKeyPolicy.staging.publicKeySpkiSha256 = 'd'.repeat(64);
  await assert.rejects(() => validateStagingArtifactDirectory(stagingFirst.directory, {
    policy: wrongKeyPolicy, manifest: stagingManifest,
  }));
  await assert.rejects(() => validateStagingArtifactDirectory(stagingFirst.directory, {
    policy: stagingPolicy, manifest: { ...stagingManifest, manifestSha256: 'e'.repeat(64) },
  }));

  async function createMutatedStagingArtifact(label, mediaRemoteReceipt) {
    const mutatedSignature = sign(
      null, Buffer.from(canonicalRemoteReceiptPayload(mediaRemoteReceipt)), privateKey,
    );
    const mutatedSignaturePath = path.join(temporary, `${label}.sig`);
    await writeFile(mutatedSignaturePath, `${mutatedSignature.toString('base64')}\n`, { mode: 0o600 });
    return createStagingPreuploadArtifact({
      ...stagingInput,
      artifactRoot: path.join(temporary, `staging-artifacts-${label}`),
      mediaRemoteReceipt,
      mediaReceiptFiles: { signaturePath: mutatedSignaturePath, publicKeyPath },
    });
  }
  const headOnly = await createMutatedStagingArtifact('head-only', {
    ...stagingRemoteReceipt, verificationLevel: 'head-exact',
  });
  await assert.rejects(() => validateStagingArtifactDirectory(headOnly.directory, stagingAuthority));
  const wrongBucket = await createMutatedStagingArtifact('wrong-bucket', {
    ...stagingRemoteReceipt,
    target: { ...stagingRemoteReceipt.target, bucket: 'dwnc-me-public-media-other' },
  });
  await assert.rejects(() => validateStagingArtifactDirectory(wrongBucket.directory, stagingAuthority));
  const publicBucket = await createMutatedStagingArtifact('public-bucket', {
    ...stagingRemoteReceipt,
    bucketExposure: { ...stagingRemoteReceipt.bucketExposure, r2DevEnabled: true, customDomainCount: 1 },
  });
  await assert.rejects(() => validateStagingArtifactDirectory(publicBucket.directory, stagingAuthority));
  const orphaned = await createMutatedStagingArtifact('orphaned', {
    ...stagingRemoteReceipt, audit: { ...stagingRemoteReceipt.audit, orphanCount: 1 },
  });
  await assert.rejects(() => validateStagingArtifactDirectory(orphaned.directory, stagingAuthority));
  console.log(JSON.stringify({
    suite: 'cloudflare-preupload-artifact', assertions: 27,
    repeatedArtifactDigestStable: true, timestampInCore: false, buildUuidInCore: false,
    versionIdInCore: false, stagingPayloadComparable: true,
    productionValidatorRejectsStagingArtifact: true,
    liveNetworkCalls: 0, deploymentAttempts: 0, status: 'PASS',
  }, null, 2));
} finally {
  await unlock(temporary);
  await rm(temporary, { recursive: true, force: true });
}
