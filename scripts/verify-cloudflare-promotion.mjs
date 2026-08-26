import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalJson,
  canonicalDeploymentStatusEvidencePayload,
  canonicalPromotionAuthorizationPayload,
  canonicalPromotionPlanPayload,
  canonicalStagingSmokePayload,
  canonicalVersionAttestationPayload,
  createPromotionPlan,
  loadSignedJsonFiles,
  productionPromotionArguments,
  sha256Hex,
  validateDeploymentStatusEvidence,
  validatePromotionAuthorization,
  validateStagingSmokeReceipt,
  validateVersionAttestation,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import { loadPromotionHead } from './lib/cloudflare-promotion-store.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { collectPublicRequestSurface } from './lib/cloudflare-surface.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  validateProductionReleaseTarget,
  validateRemoteReceipt,
  verifyRemoteReceiptSignature,
} from './lib/public-media-manifest.mjs';
import { loadRemoteReceiptFiles } from './lib/public-media-remote.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-promotion-verify');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_PROMOTION_FILES');
  return value;
};
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const promotionPlanOutputPath = absolute(process.env.CLOUDFLARE_PROMOTION_PLAN_OUTPUT_PATH);
const { receipt: artifact, artifactSha256 } = await validateArtifactDirectory(artifactDirectory);
const [policy, manifest, versionFiles, smokeFiles, promotionAuthorizationFiles,
  statusBeforeFiles, remoteFiles, wranglerConfig] = await Promise.all([
  loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true }),
  loadTrackedPublicMediaManifest(ROOT),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_VERSION_ATTESTATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_SMOKE')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_PROMOTION_AUTHORIZATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_DEPLOYMENT_STATUS_BEFORE')),
  loadRemoteReceiptFiles({
    receiptPath: absolute(process.env.PUBLIC_MEDIA_REMOTE_RECEIPT_PATH),
    signaturePath: absolute(process.env.PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH),
    publicKeyPath: absolute(process.env.PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH),
  }),
  readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8').then(JSON.parse),
]);
const releaseFingerprint = policy.production.releasePublicKeySpkiSha256;
if (!/^[a-f0-9]{64}$/u.test(policy.staging.releasePublicKeySpkiSha256 ?? '')
  || !/^[a-f0-9]{64}$/u.test(policy.staging.smokeAccessPolicySha256 ?? '')
  || policy.staging.smokeOrigin !== 'https://dwnc-me-staging.dwnc.workers.dev') {
  throw new Error('CLOUDFLARE_E_PROMOTION_STAGING_POLICY');
}
verifySignedPayload({
  payload: versionFiles.receipt,
  canonicalPayload: canonicalVersionAttestationPayload,
  validator: validateVersionAttestation,
  signature: versionFiles.signature,
  publicKeyPem: versionFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: releaseFingerprint,
  validation: {
    expected: {
      artifactSha256,
      payloadSha256: artifact.payloadSha256,
      environment: 'production',
      workerName: 'dwnc-me',
    },
    now: new Date(),
  },
});
verifySignedPayload({
  payload: smokeFiles.receipt,
  canonicalPayload: canonicalStagingSmokePayload,
  validator: validateStagingSmokeReceipt,
  signature: smokeFiles.signature,
  publicKeyPem: smokeFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: releaseFingerprint,
  validation: {
    expected: {
      artifactSha256,
      payloadSha256: artifact.payloadSha256,
      versionId: versionFiles.receipt.versionId,
      originSha256: sha256Hex(policy.staging.smokeOrigin),
      accessPolicySha256: policy.staging.smokeAccessPolicySha256,
    },
    now: new Date(),
  },
});
const activePublicKeyPem = await readFile(absolute(
  process.env.CLOUDFLARE_ACTIVE_PROMOTION_PUBLIC_KEY_PATH), 'utf8');
const authoritative = await loadPromotionHead({
  directory: absolute(process.env.CLOUDFLARE_PROMOTION_STATE_DIR),
  publicKeyPem: activePublicKeyPem,
  expectedFingerprint: releaseFingerprint,
});
const active = authoritative.head.state;
if (active.versionId === null || active.sourceGitSha === null) {
  throw new Error('CLOUDFLARE_E_PROMOTION_BOOTSTRAP_REQUIRED');
}
validateRemoteReceipt(remoteFiles.receipt, manifest);
validateProductionReleaseTarget({
  policy, receipt: remoteFiles.receipt, accountId: process.env.R2_ACCOUNT_ID,
  bucket: process.env.R2_BUCKET_NAME, publicKeyPem: remoteFiles.publicKeyPem,
  wranglerConfig,
});
verifyRemoteReceiptSignature(remoteFiles.receipt, remoteFiles.signature, remoteFiles.publicKeyPem);
if (manifest.manifestSha256 !== artifact.mediaManifestSha256
  || remoteFiles.receipt.manifestSha256 !== artifact.mediaManifestSha256) {
  throw new Error('CLOUDFLARE_E_PROMOTION_MEDIA');
}

const publicSurface = await collectPublicRequestSurface(path.join(artifactDirectory, 'static'));
if (publicSurface.surfaceSha256 !== artifact.publicRequestSurfaceSha256
  || publicSurface.pathCount !== artifact.publicRequestPaths) {
  throw new Error('CLOUDFLARE_E_PROMOTION_SURFACE');
}
const requestSurfaceHashes = [
  ...publicSurface.allowedPathHashes,
  ...manifest.entries.map((entry) => sha256Hex(entry.publicPath)),
];
const promotionPlan = createPromotionPlan({
  previous: active,
  artifact,
  attestation: versionFiles.receipt,
  mediaManifest: manifest,
  publicPathHashes: requestSurfaceHashes,
});
const deploymentArguments = productionPromotionArguments({
  versionId: versionFiles.receipt.versionId,
  artifactDirectory,
  planSha256: sha256Hex(canonicalPromotionPlanPayload(promotionPlan)),
});
if (canonicalJson(promotionPlan).length > 20 * 1024 * 1024) throw new Error('CLOUDFLARE_E_PROMOTION_STATE');
verifySignedPayload({
  payload: statusBeforeFiles.receipt,
  canonicalPayload: canonicalDeploymentStatusEvidencePayload,
  validator: validateDeploymentStatusEvidence,
  signature: statusBeforeFiles.signature,
  publicKeyPem: statusBeforeFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: releaseFingerprint,
  validation: {
    environment: 'production', workerName: 'dwnc-me', targetVersionId: active.versionId,
  },
});
const statusAgeMs = Date.now() - Date.parse(statusBeforeFiles.receipt.observedAt);
if (statusAgeMs < -120000 || statusAgeMs > 5 * 60 * 1000) {
  throw new Error('CLOUDFLARE_E_PROMOTION_STATUS_STALE');
}
try {
  await promisify(execFile)('git', ['merge-base', '--is-ancestor', active.sourceGitSha, artifact.sourceGitSha], {
    cwd: ROOT, timeout: 10000,
  });
} catch { throw new Error('CLOUDFLARE_E_PROMOTION_SOURCE_ANCESTRY'); }
verifySignedPayload({
  payload: promotionAuthorizationFiles.receipt,
  canonicalPayload: canonicalPromotionAuthorizationPayload,
  validator: validatePromotionAuthorization,
  signature: promotionAuthorizationFiles.signature,
  publicKeyPem: promotionAuthorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: releaseFingerprint,
  validation: {
    expected: {
      artifactSha256,
      versionId: versionFiles.receipt.versionId,
      activePromotionSha256: authoritative.stateSha256,
      promotionPlanSha256: sha256Hex(canonicalPromotionPlanPayload(promotionPlan)),
      deploymentStatusBeforeSha256: sha256Hex(
        canonicalDeploymentStatusEvidencePayload(statusBeforeFiles.receipt)),
      deploymentArgumentsSha256: sha256Hex(canonicalJson(deploymentArguments)),
      buildUuid: versionFiles.receipt.buildUuid,
    },
    now: new Date(),
  },
});
await writeFile(promotionPlanOutputPath, `${canonicalPromotionPlanPayload(promotionPlan)}\n`, {
  flag: 'wx', mode: 0o600,
});

process.stdout.write(`${JSON.stringify({
  command: 'wrangler', arguments: deploymentArguments, traffic: '100%',
  executionAttempted: false, authorizationRequired: true,
})}\n`);
