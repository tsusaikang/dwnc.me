import { execFile } from 'node:child_process';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalDeploymentStatusEvidencePayload,
  canonicalJson,
  canonicalPromotionAuthorizationPayload,
  canonicalPromotionPlanPayload,
  classifyDeploymentStatus,
  createDeploymentStatusEvidence,
  loadSignedJsonFiles,
  productionPromotionArguments,
  reconcilePromotionState,
  sha256Hex,
  validateDeploymentStatusEvidence,
  validatePromotionAuthorization,
  validatePromotionPlan,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import {
  acquirePromotionLock,
  beginPromotionAttempt,
  commitPromotionHead,
  createSignedPromotionHead,
  finalizeAlreadyCommittedAttempt,
  loadPromotionAttempt,
  loadPromotionHead,
  recoverPromotionLock,
  releasePromotionLock,
  writePromotionOutcomeEvidence,
} from './lib/cloudflare-promotion-store.mjs';
import {
  assertCloudflareAccountTarget,
  assertPinnedWranglerInstalled,
  claimOneTimeAuthorization,
  cloudflareWranglerEnvironment,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-production-promotion-execute');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_PROMOTION_PATH');
  return value;
};
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const stateDirectory = absolute(process.env.CLOUDFLARE_PROMOTION_STATE_DIR);
const planPath = absolute(process.env.CLOUDFLARE_PROMOTION_PLAN_PATH);
const deploymentOutputPath = absolute(process.env.CLOUDFLARE_PROMOTION_DEPLOY_NDJSON_PATH);
const recoveryToken = process.env.CLOUDFLARE_PROMOTION_RECOVERY_TOKEN;
const recoveryMode = typeof recoveryToken === 'string' && recoveryToken.length > 0;
const publicKeyPath = absolute(process.env.CLOUDFLARE_ACTIVE_PROMOTION_PUBLIC_KEY_PATH);
const privateKeyPath = absolute(process.env.CLOUDFLARE_ACTIVE_PROMOTION_PRIVATE_KEY_PATH);
const [{ receipt: artifact, artifactSha256 }, policy, authorizationFiles, statusBeforeFiles,
  publicKeyPem, privateKeyPem, planRaw] = await Promise.all([
  validateArtifactDirectory(artifactDirectory),
  loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true }),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_PROMOTION_AUTHORIZATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_DEPLOYMENT_STATUS_BEFORE')),
  readFile(publicKeyPath, 'utf8'),
  readFile(privateKeyPath, 'utf8'),
  readFile(planPath, 'utf8'),
]);
for (const keyFile of [publicKeyPath, privateKeyPath]) {
  const stats = await lstat(keyFile);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
    || (stats.mode & 0o777) !== 0o600) throw new Error('CLOUDFLARE_E_PROMOTION_SIGNER');
}
let plan;
try { plan = JSON.parse(planRaw); } catch { throw new Error('CLOUDFLARE_E_PROMOTION_PLAN'); }
validatePromotionPlan(plan);
if (plan.artifactSha256 !== artifactSha256 || plan.sourceGitSha !== artifact.sourceGitSha
  || plan.payloadSha256 !== artifact.payloadSha256) throw new Error('CLOUDFLARE_E_PROMOTION_ARTIFACT');
assertCloudflareAccountTarget(process.env.CLOUDFLARE_ACCOUNT_ID, artifact.accountIdSha256);
if (policy.production.accountIdSha256 !== artifact.accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
await assertPinnedWranglerInstalled(ROOT);
const fingerprint = policy.production.releasePublicKeySpkiSha256;
let authoritative = await loadPromotionHead({
  directory: stateDirectory, publicKeyPem, expectedFingerprint: fingerprint,
});
const planSha256 = sha256Hex(canonicalPromotionPlanPayload(plan));
const deploymentArguments = productionPromotionArguments({
  versionId: plan.versionId, artifactDirectory, planSha256,
});
verifySignedPayload({
  payload: statusBeforeFiles.receipt,
  canonicalPayload: canonicalDeploymentStatusEvidencePayload,
  validator: validateDeploymentStatusEvidence,
  signature: statusBeforeFiles.signature,
  publicKeyPem: statusBeforeFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: fingerprint,
  validation: {
    environment: 'production', workerName: 'dwnc-me',
    ...(recoveryMode ? {} : { targetVersionId: authoritative.head.state.versionId }),
  },
});
const now = new Date();
const statusAge = now.getTime() - Date.parse(statusBeforeFiles.receipt.observedAt);
if (!recoveryMode && (statusAge < -120000 || statusAge > 5 * 60 * 1000)) {
  throw new Error('CLOUDFLARE_E_PROMOTION_STATUS_STALE');
}
verifySignedPayload({
  payload: authorizationFiles.receipt,
  canonicalPayload: canonicalPromotionAuthorizationPayload,
  validator: validatePromotionAuthorization,
  signature: authorizationFiles.signature,
  publicKeyPem: authorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: fingerprint,
  validation: {
    expected: {
      artifactSha256,
      versionId: plan.versionId,
      promotionPlanSha256: planSha256,
      deploymentArgumentsSha256: sha256Hex(canonicalJson(deploymentArguments)),
      ...(recoveryMode ? {} : {
        activePromotionSha256: authoritative.stateSha256,
        deploymentStatusBeforeSha256: sha256Hex(
          canonicalDeploymentStatusEvidencePayload(statusBeforeFiles.receipt)),
      }),
    },
    now: recoveryMode ? new Date(authorizationFiles.receipt.createdAt) : now,
  },
});
try {
  await promisify(execFile)('git', [
    'merge-base', '--is-ancestor', authoritative.head.state.sourceGitSha, artifact.sourceGitSha,
  ], { cwd: ROOT, timeout: 10000 });
} catch { throw new Error('CLOUDFLARE_E_PROMOTION_SOURCE_ANCESTRY'); }

const statusArguments = [
  'deployments', 'status', '--json', '--env', 'production',
  '--config', path.join(artifactDirectory, 'wrangler-promotion.jsonc'),
  '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
];
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
  } catch { throw new Error('CLOUDFLARE_E_PROMOTION_STATUS_UNKNOWN'); }
};
const authorizationSha256 = sha256Hex(
  canonicalPromotionAuthorizationPayload(authorizationFiles.receipt));
if (!recoveryMode) {
  const outputParent = await lstat(path.dirname(deploymentOutputPath));
  if (!outputParent.isDirectory() || outputParent.isSymbolicLink()
    || (outputParent.mode & 0o777) !== 0o700
    || await lstat(deploymentOutputPath).catch(() => null)) {
    throw new Error('CLOUDFLARE_E_PROMOTION_OUTPUT');
  }
}
const lock = recoveryToken
  ? await recoverPromotionLock(stateDirectory, recoveryToken)
  : await acquirePromotionLock(stateDirectory, authoritative.stateSha256);
authoritative = await loadPromotionHead({
  directory: stateDirectory, publicKeyPem, expectedFingerprint: fingerprint,
});
if (recoveryMode) {
  const activeAuthorizationSha = authorizationFiles.receipt.activePromotionSha256;
  const stateMatchesOriginal = authoritative.stateSha256 === activeAuthorizationSha;
  const stateMatchesCommitted = authoritative.head.state.previousPromotionSha256 === activeAuthorizationSha
    && authoritative.head.state.promotionPlanSha256 === planSha256
    && authoritative.head.state.versionId === plan.versionId;
  if (!stateMatchesOriginal && !stateMatchesCommitted) {
    throw new Error('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
}
if (recoveryToken && lock.pendingPresent === false) {
  const safelyUnstarted = authoritative.stateSha256 === lock.payload.expectedStateSha256;
  const safelyCommitted = authoritative.head.state.previousPromotionSha256
    === lock.payload.expectedStateSha256;
  if (!safelyUnstarted && !safelyCommitted) throw new Error('CLOUDFLARE_E_PROMOTION_RECOVERY');
  await releasePromotionLock(lock);
  process.stdout.write(`${JSON.stringify({
    contract: 'dwnc-cloudflare-promotion-execution-v1',
    result: safelyCommitted ? 'committed-lock-cleaned' : 'unstarted-lock-cleaned',
    generation: authoritative.head.state.generation,
    versionId: authoritative.head.state.versionId,
  })}\n`);
  process.exit(0);
}
if (recoveryToken && authoritative.head.state.promotionPlanSha256 === planSha256
  && authoritative.head.state.versionId === plan.versionId) {
  await finalizeAlreadyCommittedAttempt({
    lock, current: authoritative.head, publicKeyPem, expectedFingerprint: fingerprint,
  });
  await releasePromotionLock(lock);
  process.stdout.write(`${JSON.stringify({
    contract: 'dwnc-cloudflare-promotion-execution-v1',
    result: 'already-committed', generation: authoritative.head.state.generation,
    versionId: plan.versionId, traffic: '100%',
  })}\n`);
  process.exit(0);
}
let pendingAttempt = null;
if (recoveryMode) {
  pendingAttempt = await loadPromotionAttempt(lock);
  if (pendingAttempt.attemptId !== authorizationFiles.receipt.buildUuid
    || pendingAttempt.expectedStateSha256 !== authorizationFiles.receipt.activePromotionSha256
    || pendingAttempt.promotionAuthorizationSha256 !== authorizationSha256
    || pendingAttempt.promotionPlanSha256 !== planSha256
    || pendingAttempt.targetVersionId !== plan.versionId) {
    throw new Error('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
}
if (authoritative.stateSha256 !== plan.previousPromotionSha256
  || plan.expectedGeneration !== authoritative.head.state.generation + 1) {
  throw new Error('CLOUDFLARE_E_PROMOTION_CAS');
}
if (!recoveryToken) {
  const freshStatus = await fetchRawStatus();
  if (classifyDeploymentStatus(freshStatus, {
    targetVersionId: authoritative.head.state.versionId,
  }) !== 'committed') {
    await releasePromotionLock(lock);
    throw new Error('CLOUDFLARE_E_PROMOTION_PRESTATUS_CAS');
  }
  const freshStatusSha256 = sha256Hex(canonicalJson(freshStatus));
  const outputParent = await lstat(path.dirname(deploymentOutputPath));
  if (!outputParent.isDirectory() || outputParent.isSymbolicLink()
    || (outputParent.mode & 0o777) !== 0o700
    || await lstat(deploymentOutputPath).catch(() => null)) {
    await releasePromotionLock(lock);
    throw new Error('CLOUDFLARE_E_PROMOTION_OUTPUT');
  }
  await claimOneTimeAuthorization({
    directory: stateDirectory,
    authorizationSha256,
    scope: 'production-promotion', target: 'dwnc-me',
  });
  await beginPromotionAttempt({
    lock,
    attempt: {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-promotion-attempt-v1',
      attemptId: authorizationFiles.receipt.buildUuid,
      expectedStateSha256: authoritative.stateSha256,
      promotionAuthorizationSha256: sha256Hex(
        canonicalPromotionAuthorizationPayload(authorizationFiles.receipt)),
      promotionPlanSha256: planSha256,
      freshStatusSha256,
      targetVersionId: plan.versionId,
      startedAt: new Date().toISOString(),
    },
  });
  pendingAttempt = await loadPromotionAttempt(lock);
  const outputHandle = await open(deploymentOutputPath, 'wx', 0o600);
  await outputHandle.close();
  let deploymentCommandSucceeded = false;
  try {
    await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), deploymentArguments, {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60000,
      env: cloudflareWranglerEnvironment(process.env, {
        CI: '1', WRANGLER_OUTPUT_FILE_PATH: deploymentOutputPath,
        WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
        WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
      }),
    });
    deploymentCommandSucceeded = true;
  } catch {
    // The deployment API may have committed before the command failed. Status is authoritative below.
  }
  pendingAttempt.deploymentCommandSucceeded = deploymentCommandSucceeded;
}

let rawStatus;
rawStatus = await fetchRawStatus();
const classification = classifyDeploymentStatus(rawStatus, {
  targetVersionId: plan.versionId,
  previousVersionId: authoritative.head.state.versionId,
});
const outcomeObservedAt = new Date().toISOString();
let deploymentOutputSha256 = null;
if (!recoveryMode) {
  const deploymentOutput = await readFile(deploymentOutputPath).catch(() => null);
  if (deploymentOutput !== null) deploymentOutputSha256 = sha256Hex(deploymentOutput);
}
await writePromotionOutcomeEvidence({
  lock,
  attemptId: authorizationFiles.receipt.buildUuid,
  evidence: {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-outcome-v1',
    attemptId: authorizationFiles.receipt.buildUuid,
    expectedStateSha256: pendingAttempt.expectedStateSha256,
    promotionAuthorizationSha256: pendingAttempt.promotionAuthorizationSha256,
    promotionPlanSha256: pendingAttempt.promotionPlanSha256,
    freshStatusSha256: pendingAttempt.freshStatusSha256,
    targetVersionId: pendingAttempt.targetVersionId,
    classification: classification === 'committed' ? 'committed' : 'ambiguous',
    commandResult: recoveryMode ? 'not-run'
      : pendingAttempt.deploymentCommandSucceeded ? 'succeeded' : 'failed',
    deploymentOutputSha256,
    rawStatusSha256: sha256Hex(canonicalJson(rawStatus)),
    rawStatus,
    deploymentArgumentsSha256: sha256Hex(canonicalJson(deploymentArguments)),
    statusArgumentsSha256: sha256Hex(canonicalJson(statusArguments)),
    observedAt: outcomeObservedAt,
  },
});
if (classification === 'committed') {
  const observedAt = outcomeObservedAt;
  const evidence = createDeploymentStatusEvidence({
    rawStatus, targetVersionId: plan.versionId, observedAt,
  });
  const nextState = reconcilePromotionState({
    previous: authoritative.head.state, plan, deploymentStatus: evidence, activatedAt: observedAt,
  });
  const nextHead = createSignedPromotionHead({ state: nextState, privateKeyPem, publicKeyPem });
  const committed = await commitPromotionHead({
    lock, expectedStateSha256: authoritative.stateSha256, current: authoritative.head, nextHead,
    publicKeyPem, expectedFingerprint: fingerprint,
  });
  await releasePromotionLock(lock);
  process.stdout.write(`${JSON.stringify({
    contract: 'dwnc-cloudflare-promotion-execution-v1', result: 'committed',
    generation: committed.head.state.generation, versionId: plan.versionId, traffic: '100%',
  })}\n`);
} else {
  throw new Error('CLOUDFLARE_E_PROMOTION_AMBIGUOUS');
}
