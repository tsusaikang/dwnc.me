import path from 'node:path';
import {
  canonicalDeploymentStatusEvidencePayload,
  loadSignedJsonFiles,
  sha256Hex,
  validateDeploymentStatusEvidence,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import {
  assertCloudflareAccountTarget,
  claimOneTimeAuthorization,
  cloudflareControlPlaneCredentials,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import {
  canonicalWorkersDevEnableAuthorizationPayload,
  canonicalWorkersDevActiveDeploymentCapturePayload,
  canonicalWorkersDevExecutionCapturePayload,
  canonicalWorkersDevStatusCapturePayload,
  canonicalWorkersDevStatusPayload,
  enableWorkersDevAndReadBack,
  fetchWorkersDevStatusCapture,
  validateWorkersDevEnableAuthorization,
  validateWorkersDevExecutionCapture,
  validateWorkersDevStatus,
  validateWorkersDevStatusCapture,
  workersDevMutationRequestSha256,
} from './lib/cloudflare-workers-dev.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';
import {
  loadTrackedStagingSmokeAccessPolicy,
  stagingSmokeAccessPolicySha256,
} from './lib/staging-smoke-access-policy.mjs';

installStructuredErrorHandler('cloudflare-staging-workers-dev-enable');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('CLOUDFLARE_E_WORKERS_DEV_ARGUMENT');
  }
  return value;
};
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
if (process.env.CLOUDFLARE_STAGING_WORKERS_DEV_APPROVED
  !== 'staging:dwnc-me-staging:workers-dev-enable') {
  throw new Error('CLOUDFLARE_E_WORKERS_DEV_APPROVAL');
}
const stateDirectory = absolute(process.env.CLOUDFLARE_STAGING_WORKERS_DEV_STATE_DIR);
const executionCapturePath = absolute(
  process.env.CLOUDFLARE_STAGING_WORKERS_DEV_EXECUTION_CAPTURE_PATH,
);
const afterEvidencePath = absolute(
  process.env.CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_AFTER_EVIDENCE_PATH,
);
const [policy, smokePolicy, authorizationFiles, beforeFiles, deploymentFiles] = await Promise.all([
  loadTrackedPublicMediaReleasePolicy(process.cwd()),
  loadTrackedStagingSmokeAccessPolicy(process.cwd()),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_WORKERS_DEV_AUTHORIZATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_BEFORE')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_DEPLOYMENT_STATUS')),
]);
const target = policy.staging;
if (target.smokeOrigin !== smokePolicy.origin
  || target.smokeAccessPolicySha256 !== stagingSmokeAccessPolicySha256(smokePolicy)
  || !/^[a-f0-9]{64}$/u.test(target.releasePublicKeySpkiSha256 ?? '')) {
  throw new Error('CLOUDFLARE_E_WORKERS_DEV_POLICY');
}
const controlPlane = cloudflareControlPlaneCredentials(process.env);
assertCloudflareAccountTarget(controlPlane.accountId, target.accountIdSha256);
const releaseFingerprint = target.releasePublicKeySpkiSha256;
verifySignedPayload({
  payload: beforeFiles.receipt,
  canonicalPayload: canonicalWorkersDevStatusPayload,
  validator: validateWorkersDevStatus,
  signature: beforeFiles.signature,
  publicKeyPem: beforeFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: releaseFingerprint,
  validation: {
    expected: {
      environment: 'staging', workerName: 'dwnc-me-staging',
      accountIdSha256: target.accountIdSha256, origin: smokePolicy.origin,
      enabled: false, previewUrlsEnabled: false,
    },
    now: new Date(),
  },
});
verifySignedPayload({
  payload: deploymentFiles.receipt,
  canonicalPayload: canonicalDeploymentStatusEvidencePayload,
  validator: validateDeploymentStatusEvidence,
  signature: deploymentFiles.signature,
  publicKeyPem: deploymentFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: releaseFingerprint,
  validation: {
    expected: {
      environment: 'staging', workerName: 'dwnc-me-staging',
      targetVersionId: authorizationFiles.receipt.versionId,
    },
  },
});
const beforeStatusSha256 = sha256Hex(canonicalWorkersDevStatusPayload(beforeFiles.receipt));
const deploymentStatusSha256 = sha256Hex(
  canonicalDeploymentStatusEvidencePayload(deploymentFiles.receipt),
);
verifySignedPayload({
  payload: authorizationFiles.receipt,
  canonicalPayload: canonicalWorkersDevEnableAuthorizationPayload,
  validator: validateWorkersDevEnableAuthorization,
  signature: authorizationFiles.signature,
  publicKeyPem: authorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: releaseFingerprint,
  validation: {
    expected: {
      accountIdSha256: target.accountIdSha256,
      beforeStatusSha256,
      deploymentStatusSha256,
      mutationRequestSha256: workersDevMutationRequestSha256({
        accountIdSha256: target.accountIdSha256,
      }),
    },
    now: new Date(),
  },
});

// A fresh readback immediately before the mutation is the final compare-and-set guard.
const freshBefore = await fetchWorkersDevStatusCapture({
  accountId: controlPlane.accountId,
  apiToken: controlPlane.apiToken,
});
validateWorkersDevStatusCapture(freshBefore, {
  expected: {
    accountIdSha256: target.accountIdSha256,
    origin: smokePolicy.origin,
    enabled: false,
    previewUrlsEnabled: false,
  },
  now: new Date(),
});
const authorizationSha256 = sha256Hex(
  canonicalWorkersDevEnableAuthorizationPayload(authorizationFiles.receipt),
);
await claimOneTimeAuthorization({
  directory: stateDirectory,
  authorizationSha256,
  scope: 'staging-workers-dev',
  target: 'dwnc-me-staging',
});
const outcome = await enableWorkersDevAndReadBack({
  accountId: controlPlane.accountId,
  apiToken: controlPlane.apiToken,
  expectedVersionId: authorizationFiles.receipt.versionId,
  expectedDeploymentId: deploymentFiles.receipt.deploymentId,
});
const completedAt = new Date().toISOString();
const execution = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-workers-dev-enable-execution-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256: target.accountIdSha256,
  authorizationSha256,
  deploymentStatusSha256,
  signedBeforeStatusSha256: beforeStatusSha256,
  approvedVersionId: authorizationFiles.receipt.versionId,
  approvedDeploymentId: deploymentFiles.receipt.deploymentId,
  freshBeforeCaptureSha256: sha256Hex(canonicalWorkersDevStatusCapturePayload(freshBefore)),
  freshDeploymentBeforeCaptureSha256: sha256Hex(
    canonicalWorkersDevActiveDeploymentCapturePayload(outcome.deploymentBefore)),
  freshDeploymentAfterCaptureSha256: sha256Hex(
    canonicalWorkersDevActiveDeploymentCapturePayload(outcome.deploymentAfter)),
  deploymentBefore: outcome.deploymentBefore,
  deploymentAfter: outcome.deploymentAfter,
  deploymentUnchanged: outcome.deploymentUnchanged,
  mutationRequestSha256: authorizationFiles.receipt.mutationRequestSha256,
  mutationResult: outcome.mutationResult,
  mutationHttpStatus: outcome.mutationHttpStatus,
  mutationRawBody: outcome.mutationRawBody,
  mutationRawBodySha256: outcome.mutationRawBodySha256,
  classification: outcome.classification,
  afterCaptureSha256: sha256Hex(canonicalWorkersDevStatusCapturePayload(outcome.after)),
  after: outcome.after,
  completedAt,
};
validateWorkersDevExecutionCapture(execution, {
  expected: { authorizationSha256, deploymentStatusSha256 },
  now: new Date(completedAt),
});
await writeCanonicalEvidenceCreateOnly(
  executionCapturePath, execution, canonicalWorkersDevExecutionCapturePayload,
);
await writeCanonicalEvidenceCreateOnly(
  afterEvidencePath, outcome.after.evidence, canonicalWorkersDevStatusPayload,
);
if (outcome.classification !== 'committed') {
  throw new Error('CLOUDFLARE_E_WORKERS_DEV_AMBIGUOUS');
}
console.log(JSON.stringify({
  contract: execution.contract,
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  origin: outcome.after.evidence.origin,
  enabled: true,
  previewUrlsEnabled: false,
  readbackVerified: true,
  oneTimeAuthorizationConsumed: true,
}, null, 2));
