import { execFile } from 'node:child_process';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateStagingUploadArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalDeploymentStatusEvidencePayload,
  canonicalJson,
  canonicalStagingActivationAuthorizationPayload,
  canonicalVersionAttestationPayload,
  classifyDeploymentStatus,
  createDeploymentStatusEvidence,
  loadSignedJsonFiles,
  sha256Hex,
  stagingActivationArguments,
  validateDeploymentStatusEvidence,
  validateStagingActivationAuthorization,
  validateVersionAttestation,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import {
  assertCloudflareAccountTarget,
  assertOneTimeAuthorizationClaim,
  assertPinnedWranglerInstalled,
  claimOneTimeAuthorization,
  cloudflareWranglerEnvironment,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import {
  acquireStagingActivationLock,
  beginStagingActivation,
  loadStagingActivationOutcomes,
  loadStagingActivationAttempt,
  markStagingActivationInvoking,
  recoverStagingActivationLock,
  releaseStagingActivationLock,
  stagingActivationInvoking,
  writeStagingActivationOutcome,
} from './lib/cloudflare-staging-activation-store.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-staging-activation');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('CLOUDFLARE_E_STAGING_ACTIVATION_PATH');
  }
  return value;
};
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
if (process.env.CLOUDFLARE_STAGING_ACTIVATION_APPROVED !== 'staging:dwnc-me-staging:exact-version-100') {
  throw new Error('CLOUDFLARE_E_STAGING_ACTIVATION_APPROVAL');
}
const recoveryToken = process.env.CLOUDFLARE_STAGING_ACTIVATION_RECOVERY_TOKEN;
const recoveryMode = typeof recoveryToken === 'string' && recoveryToken.length > 0;
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const stateDirectory = absolute(process.env.CLOUDFLARE_STAGING_ACTIVATION_STATE_DIR);
const candidatePath = absolute(process.env.CLOUDFLARE_STAGING_ACTIVATION_STATUS_CANDIDATE_PATH);
const deploymentOutputPath = recoveryMode ? null
  : absolute(process.env.CLOUDFLARE_STAGING_ACTIVATION_NDJSON_PATH);
let existingCandidate = false;
for (const file of [candidatePath, ...(deploymentOutputPath ? [deploymentOutputPath] : [])]) {
  const parent = await lstat(path.dirname(file));
  const existing = await lstat(file).catch(() => null);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700
    || existing && (!recoveryMode || file !== candidatePath || !existing.isFile()
      || existing.isSymbolicLink() || existing.nlink !== 1 || (existing.mode & 0o777) !== 0o600)) {
    throw new Error('CLOUDFLARE_E_STAGING_ACTIVATION_OUTPUT');
  }
  if (file === candidatePath) existingCandidate = existing !== null;
}

const [policy, versionFiles, authorizationFiles, beforeFiles] = await Promise.all([
  loadTrackedPublicMediaReleasePolicy(ROOT),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_VERSION_ATTESTATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_ACTIVATION_AUTHORIZATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_BEFORE')),
]);
const { receipt: artifact, artifactSha256 } = await validateStagingUploadArtifactDirectory(
  artifactDirectory,
  async () => ({ policy, manifest: await loadTrackedPublicMediaManifest(ROOT) }),
);
const target = policy.staging;
assertCloudflareAccountTarget(process.env.CLOUDFLARE_ACCOUNT_ID, artifact.stagingAccountIdSha256);
if (target.accountIdSha256 !== artifact.stagingAccountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
await assertPinnedWranglerInstalled(ROOT);
verifySignedPayload({
  payload: versionFiles.receipt,
  canonicalPayload: canonicalVersionAttestationPayload,
  validator: validateVersionAttestation,
  signature: versionFiles.signature,
  publicKeyPem: versionFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: { environment: 'staging', workerName: 'dwnc-me-staging', artifactSha256 },
    now: recoveryMode ? new Date(versionFiles.receipt.createdAt) : new Date(),
  },
});
verifySignedPayload({
  payload: beforeFiles.receipt,
  canonicalPayload: canonicalDeploymentStatusEvidencePayload,
  validator: validateDeploymentStatusEvidence,
  signature: beforeFiles.signature,
  publicKeyPem: beforeFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      environment: 'staging',
      workerName: 'dwnc-me-staging',
      targetVersionId: beforeFiles.receipt.targetVersionId,
    },
  },
});
const beforeAge = Date.now() - Date.parse(beforeFiles.receipt.observedAt);
if (!recoveryMode && (beforeAge < -120000 || beforeAge > 5 * 60 * 1000)) {
  throw new Error('CLOUDFLARE_E_STAGING_ACTIVATION_STATUS_STALE');
}
const deploymentArguments = stagingActivationArguments({
  versionId: versionFiles.receipt.versionId, artifactDirectory, artifactSha256,
});
verifySignedPayload({
  payload: authorizationFiles.receipt,
  canonicalPayload: canonicalStagingActivationAuthorizationPayload,
  validator: validateStagingActivationAuthorization,
  signature: authorizationFiles.signature,
  publicKeyPem: authorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      artifactSha256, payloadSha256: artifact.payloadSha256,
      versionId: versionFiles.receipt.versionId, accountIdSha256: artifact.stagingAccountIdSha256,
      originSha256: sha256Hex(target.smokeOrigin),
      accessPolicySha256: target.smokeAccessPolicySha256,
      deploymentStatusBeforeSha256: sha256Hex(
        canonicalDeploymentStatusEvidencePayload(beforeFiles.receipt)),
      deploymentArgumentsSha256: sha256Hex(canonicalJson(deploymentArguments)),
    },
    now: recoveryMode ? new Date(authorizationFiles.receipt.createdAt) : new Date(),
  },
});

const statusArguments = ['deployments', 'status', '--json', '--env', 'staging',
  '--config', path.join(artifactDirectory, 'wrangler-staging-promotion.jsonc'),
  '--env-file', path.join(artifactDirectory, 'wrangler-empty.env')];
const fetchRawStatus = async () => {
  try {
    const { stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), statusArguments, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60000,
      env: cloudflareWranglerEnvironment(process.env, {
        CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
        WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
      }),
    });
    return JSON.parse(stdout);
  } catch { return { unavailable: true }; }
};
const authorizationSha256 = sha256Hex(
  canonicalStagingActivationAuthorizationPayload(authorizationFiles.receipt));
const context = {
  attemptId: authorizationFiles.receipt.buildUuid,
  authorizationSha256,
  artifactSha256,
  payloadSha256: artifact.payloadSha256,
  targetVersionId: versionFiles.receipt.versionId,
  previousVersionId: beforeFiles.receipt.targetVersionId,
  deploymentArgumentsSha256: sha256Hex(canonicalJson(deploymentArguments)),
};
const lock = recoveryMode
  ? await recoverStagingActivationLock(stateDirectory, recoveryToken)
  : await acquireStagingActivationLock(stateDirectory, context);
for (const [key, value] of Object.entries(context)) {
  if (lock.payload[key] !== value) throw new Error('CLOUDFLARE_E_STAGING_RECOVERY');
}

let pending;
let commandResult = 'not-run';
if (recoveryMode) {
  if (!lock.pendingPresent) {
    if (existingCandidate) throw new Error('CLOUDFLARE_E_STAGING_RECOVERY');
    await releaseStagingActivationLock(lock, { committed: false });
    process.stdout.write(`${JSON.stringify({
      contract: 'dwnc-cloudflare-staging-activation-result-v1',
      result: 'unstarted-lock-cleaned', versionId: context.targetVersionId,
    })}\n`);
    process.exit(0);
  }
  pending = await loadStagingActivationAttempt(lock);
  await assertOneTimeAuthorizationClaim({
    directory: stateDirectory, authorizationSha256,
    scope: 'staging-activation', target: 'dwnc-me-staging',
  });
  if (!await stagingActivationInvoking(lock)) {
    if (existingCandidate) throw new Error('CLOUDFLARE_E_STAGING_RECOVERY');
    await releaseStagingActivationLock(lock, { committed: false });
    process.stdout.write(`${JSON.stringify({
      contract: 'dwnc-cloudflare-staging-activation-result-v1',
      result: 'pre-invoke-lock-cleaned', versionId: context.targetVersionId,
    })}\n`);
    process.exit(0);
  }
  if (existingCandidate) {
    const candidatePayload = await readFile(candidatePath, 'utf8');
    const outcomes = await loadStagingActivationOutcomes(lock);
    const matching = outcomes.filter(({ evidence: outcome }) => {
      if (outcome.classification !== 'committed') return false;
      try {
        const evidence = createDeploymentStatusEvidence({
          rawStatus: outcome.rawStatus, targetVersionId: context.targetVersionId,
          observedAt: outcome.observedAt, environment: 'staging',
          workerName: 'dwnc-me-staging',
        });
        return candidatePayload === `${canonicalDeploymentStatusEvidencePayload(evidence)}\n`;
      } catch { return false; }
    });
    if (matching.length !== 1) throw new Error('CLOUDFLARE_E_STAGING_RECOVERY');
    await releaseStagingActivationLock(lock, { committed: true });
    process.stdout.write(`${JSON.stringify({
      contract: 'dwnc-cloudflare-staging-activation-result-v1',
      result: 'committed-lock-cleaned', versionId: context.targetVersionId, traffic: '100%',
    })}\n`);
    process.exit(0);
  }
} else {
  const freshStatus = await fetchRawStatus();
  if (classifyDeploymentStatus(freshStatus, {
    targetVersionId: context.previousVersionId,
  }) !== 'committed') {
    await releaseStagingActivationLock(lock, { committed: false });
    throw new Error('CLOUDFLARE_E_STAGING_ACTIVATION_PRESTATUS_CAS');
  }
  pending = await beginStagingActivation(lock, {
    freshStatusSha256: sha256Hex(canonicalJson(freshStatus)),
  });
  try {
    await claimOneTimeAuthorization({
      directory: stateDirectory, authorizationSha256,
      scope: 'staging-activation', target: 'dwnc-me-staging',
    });
  } catch (error) {
    await releaseStagingActivationLock(lock, { committed: false });
    throw error;
  }
  const handle = await open(deploymentOutputPath, 'wx', 0o600); await handle.close();
  await markStagingActivationInvoking(lock);
  try {
    await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), deploymentArguments, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60000,
      env: cloudflareWranglerEnvironment(process.env, {
        CI: '1', WRANGLER_OUTPUT_FILE_PATH: deploymentOutputPath,
        WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
        WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
      }),
    });
    commandResult = 'succeeded';
  } catch { commandResult = 'failed'; }
}

const rawStatus = await fetchRawStatus();
const classification = classifyDeploymentStatus(rawStatus, {
  targetVersionId: context.targetVersionId, previousVersionId: context.previousVersionId,
});
const observedAt = new Date().toISOString();
const deploymentOutputSha256 = recoveryMode ? null
  : sha256Hex(await readFile(deploymentOutputPath));
await writeStagingActivationOutcome(lock, {
  schemaVersion: 1, contract: 'dwnc-cloudflare-staging-activation-outcome-v1',
  attemptId: pending.attemptId, authorizationSha256,
  artifactSha256: context.artifactSha256, payloadSha256: context.payloadSha256,
  targetVersionId: context.targetVersionId, previousVersionId: context.previousVersionId,
  freshStatusSha256: pending.freshStatusSha256,
  classification: classification === 'committed' ? 'committed' : 'ambiguous',
  commandResult, deploymentOutputSha256,
  rawStatusSha256: sha256Hex(canonicalJson(rawStatus)), rawStatus,
  deploymentArgumentsSha256: context.deploymentArgumentsSha256,
  statusArgumentsSha256: sha256Hex(canonicalJson(statusArguments)), observedAt,
});
if (classification !== 'committed') {
  throw new Error('CLOUDFLARE_E_STAGING_ACTIVATION_AMBIGUOUS');
}
const evidence = createDeploymentStatusEvidence({
  rawStatus, targetVersionId: context.targetVersionId, observedAt,
  environment: 'staging', workerName: 'dwnc-me-staging',
});
await writeCanonicalEvidenceCreateOnly(
  candidatePath, evidence, canonicalDeploymentStatusEvidencePayload,
);
if (process.env.DWNC_CLOUDFLARE_TEST_MODE === '1'
  && process.env.DWNC_CLOUDFLARE_TEST_FAULT === 'staging-candidate-written') {
  process.kill(process.pid, 'SIGKILL');
}
await releaseStagingActivationLock(lock, { committed: true });
console.log(JSON.stringify({
  contract: 'dwnc-cloudflare-staging-activation-result-v1',
  result: recoveryMode ? 'committed-recovery' : 'committed',
  versionId: context.targetVersionId, traffic: '100%', signedStatusRequiredBeforeSmoke: true,
}));
