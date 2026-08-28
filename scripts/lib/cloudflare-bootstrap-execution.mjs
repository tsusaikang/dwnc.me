import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assertBootstrapCaptureHasNoSensitiveValues,
  bootstrapArguments,
  bootstrapConfig,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  bootstrapWorkerName,
  canonicalAccountWorkersDevSubdomainCapturePayload,
  canonicalBootstrapAttestationPayload,
  canonicalBootstrapAuthorizationPayload,
  canonicalBootstrapDeployOutputCapturePayload,
  canonicalBootstrapPostStateCapturePayload,
  canonicalServiceExistenceCapturePayload,
  createBootstrapDeployOutputCapture,
  defaultBootstrapProtectedEvidencePaths,
  DENY_ALL_WORKER_SOURCE,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  fetchAccountWorkersDevSubdomainCapture,
  fetchBootstrapPostStateCapture,
  fetchServiceExistenceCapture,
  validateAccountWorkersDevSubdomainCapture,
  validateBootstrapAttestation,
  validateBootstrapAuthorization,
  validateBootstrapPostStatePair,
  validateServiceExistenceCapture,
  verifyBootstrapAttestationFixedCaptures,
} from './cloudflare-bootstrap.mjs';
import {
  canonicalJson,
  sha256Hex,
} from './cloudflare-release.mjs';
import {
  assertCloudflareAccountTarget,
  assertPinnedWranglerInstalled,
  claimOneTimeAuthorization,
} from './cloudflare-process.mjs';
import { assertCloudflareAccountTargetOutsideRepository }
  from './cloudflare-account-target.mjs';
import {
  assertSecureCreateOnlyDestination,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';
import {
  canonicalBootstrapPreparedRecord,
  canonicalBootstrapResultRecord,
  canonicalBootstrapStartedRecord,
} from './cloudflare-bootstrap-attempt.mjs';
import {
  bootstrapPreparedSha256,
  bootstrapStartedSha256,
  normalizeBootstrapWranglerResult,
  recoverBootstrapStatusCore,
} from './cloudflare-bootstrap-recovery.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_DEPLOY_OUTPUT_BYTES = 1024 * 1024;
const EXACT_PLAN_KEYS = [
  'repositoryRoot', 'environment', 'targetAccountIdSha256', 'authorization',
  'authorizationSha256', 'serviceEvidenceSha256', 'accountSubdomainEvidenceSha256',
  'controlPlane',
];
const EXACT_DEPENDENCY_KEYS = [
  'fetchImpl', 'execFileAsync', 'now', 'userHome', 'temporaryRoot',
  'wranglerSourceEnvironment', 'inspectGit', 'assertPinnedWranglerInstalled',
  'assertOutsideRepository', 'assertSecureCreateOnlyDestination',
  'claimOneTimeAuthorization', 'writeCanonicalEvidenceCreateOnly',
  'readSecureFile', 'fileSystem',
];
const EXACT_FILE_SYSTEM_KEYS = ['lstat', 'mkdir', 'mkdtemp', 'open', 'rm', 'writeFile'];
const GIT_OID = /^[a-f0-9]{40}$/u;

const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

function instant(now) {
  let value;
  try { value = now(); }
  catch { fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_TIME'); }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_TIME');
  }
  return value;
}

function assertAbsoluteDirectory(value, code) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    fail(code);
  }
  return value;
}

function validatePlan(plan, now) {
  if (!exactKeys(plan, EXACT_PLAN_KEYS)
    || !['production', 'staging'].includes(plan.environment)
    || plan.targetAccountIdSha256 !== plan.authorization?.accountIdSha256
    || !SHA256.test(plan.targetAccountIdSha256 ?? '')
    || !SHA256.test(plan.authorizationSha256 ?? '')
    || !SHA256.test(plan.serviceEvidenceSha256 ?? '')
    || !SHA256.test(plan.accountSubdomainEvidenceSha256 ?? '')
    || plan.authorizationSha256
      !== sha256Hex(canonicalBootstrapAuthorizationPayload(plan.authorization))
    || plan.serviceEvidenceSha256 !== plan.authorization.serviceEvidenceSha256
    || plan.accountSubdomainEvidenceSha256
      !== plan.authorization.accountSubdomainEvidenceSha256
    || !plan.controlPlane || typeof plan.controlPlane !== 'object'
    || Array.isArray(plan.controlPlane)
    || typeof plan.controlPlane.apiToken !== 'string'
    || plan.controlPlane.apiToken.length < 1 || plan.controlPlane.apiToken.length > 4096
    || plan.environment === 'staging' && (
      plan.controlPlane.environment !== 'staging'
      || plan.controlPlane.envelope?.operation !== 'staging-bootstrap'
      || plan.controlPlane.envelope?.accountIdSha256 !== plan.targetAccountIdSha256
      || ![plan.controlPlane.envelope?.metadataSha256,
        plan.controlPlane.envelope?.preflightSha256,
        plan.controlPlane.envelope?.permissionContractSha256]
        .every((value) => SHA256.test(value ?? ''))
      || typeof plan.controlPlane.wranglerEnvironment !== 'function'
    )) {
    fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_PLAN');
  }
  assertAbsoluteDirectory(plan.repositoryRoot, 'CLOUDFLARE_E_BOOTSTRAP_EXECUTION_PLAN');
  validateBootstrapAuthorization(plan.authorization, {
    expected: {
      environment: plan.environment,
      workerName: bootstrapWorkerName(plan.environment),
      accountIdSha256: plan.targetAccountIdSha256,
      expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
      denyWorkerSha256: bootstrapDenyWorkerSha256(),
      bootstrapConfigSha256: bootstrapConfigSha256(plan.environment),
      serviceEvidenceSha256: plan.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: plan.accountSubdomainEvidenceSha256,
      freshAbsenceRequired: true,
      freshAccountSubdomainRequired: true,
    },
    now,
  });
  assertCloudflareAccountTarget(plan.controlPlane.accountId, plan.targetAccountIdSha256);
  return plan;
}

function dependencies(value) {
  if (!exactKeys(value, EXACT_DEPENDENCY_KEYS)
    || !exactKeys(value.fileSystem, EXACT_FILE_SYSTEM_KEYS)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_DEPENDENCIES');
  }
  const requiredFunctions = [
    value.fetchImpl, value.execFileAsync, value.now, value.inspectGit,
    value.assertPinnedWranglerInstalled, value.assertOutsideRepository,
    value.assertSecureCreateOnlyDestination, value.claimOneTimeAuthorization,
    value.writeCanonicalEvidenceCreateOnly, value.readSecureFile,
    ...EXACT_FILE_SYSTEM_KEYS.map((key) => value.fileSystem[key]),
  ];
  if (requiredFunctions.some((entry) => typeof entry !== 'function')
    || !value.wranglerSourceEnvironment
    || typeof value.wranglerSourceEnvironment !== 'object'
    || Array.isArray(value.wranglerSourceEnvironment)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_DEPENDENCIES');
  }
  assertAbsoluteDirectory(value.userHome, 'CLOUDFLARE_E_BOOTSTRAP_EXECUTION_DEPENDENCIES');
  assertAbsoluteDirectory(
    value.temporaryRoot, 'CLOUDFLARE_E_BOOTSTRAP_EXECUTION_DEPENDENCIES',
  );
  return value;
}

function validateGitSnapshot(snapshot, plan) {
  if (!exactKeys(snapshot, ['commit', 'tree', 'clean'])
    || !GIT_OID.test(snapshot.commit ?? '') || !GIT_OID.test(snapshot.tree ?? '')
    || snapshot.commit !== plan.authorization.sourceGitSha || snapshot.clean !== true) {
    fail('CLOUDFLARE_E_BOOTSTRAP_GIT');
  }
  return snapshot;
}

async function assertAuthorizationAndGit(plan, deps, previousGit = null) {
  let observed;
  try { observed = validateGitSnapshot(await deps.inspectGit(plan.repositoryRoot), plan); }
  catch (error) {
    if (error?.message === 'CLOUDFLARE_E_BOOTSTRAP_GIT') throw error;
    fail('CLOUDFLARE_E_BOOTSTRAP_GIT');
  }
  if (previousGit && canonicalJson(previousGit) !== canonicalJson(observed)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_GIT');
  }
  const checkedAt = instant(deps.now);
  validateBootstrapAuthorization(plan.authorization, {
    expected: {
      environment: plan.environment,
      workerName: bootstrapWorkerName(plan.environment),
      accountIdSha256: plan.targetAccountIdSha256,
      sourceGitSha: plan.authorization.sourceGitSha,
    },
    now: checkedAt,
  });
  return { git: observed, checkedAt };
}

function bootstrapClaimPath(paths, plan) {
  return path.join(
    paths.directory,
    `${plan.environment}-bootstrap-${plan.authorizationSha256}.json`,
  );
}

function stagingEnvelopeEvidence(plan) {
  const envelope = plan.controlPlane.envelope;
  if (plan.environment !== 'staging' || envelope?.operation !== 'staging-bootstrap') {
    fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_PLAN');
  }
  return {
    metadataSha256: envelope.metadataSha256,
    preflightSha256: envelope.preflightSha256,
    permissionContractSha256: envelope.permissionContractSha256,
  };
}

async function claimSha256(file, deps) {
  let bytes;
  try {
    bytes = await deps.readSecureFile(file, 64 * 1024);
    if (bytes.length < 3 || bytes.at(-1) !== 0x0a) {
      fail('CLOUDFLARE_E_BOOTSTRAP_CLAIM_RECORD');
    }
    return sha256Hex(bytes.subarray(0, bytes.length - 1));
  } finally { bytes?.fill(0); }
}

function recoveryControlPlane(plan) {
  const evidence = stagingEnvelopeEvidence(plan);
  return {
    accountId: plan.controlPlane.accountId,
    apiToken: plan.controlPlane.apiToken,
    envelope: {
      operation: 'staging-bootstrap',
      accountIdSha256: plan.targetAccountIdSha256,
      ...evidence,
    },
  };
}

function sealedWranglerCommand(plan, args, outputPath) {
  const authRoot = plan.controlPlane.envelope?.authRoot;
  if (typeof authRoot !== 'string' || !path.isAbsolute(authRoot)
    || path.resolve(authRoot) !== authRoot) {
    fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_PLAN');
  }
  const runtimeRoot = path.join(authRoot, 'sealed-wrangler');
  return {
    binary: process.execPath,
    args: [
      '--no-warnings', '--permission',
      `--allow-fs-read=${authRoot}`,
      `--allow-fs-write=${authRoot}`,
      '--require', path.join(runtimeRoot, 'resolution-guard.cjs'),
      path.join(runtimeRoot, 'node_modules/wrangler/wrangler-dist/cli.js'),
      ...args,
    ],
    environment: plan.controlPlane.wranglerEnvironment({
      WRANGLER_OUTPUT_FILE_PATH: outputPath,
    }),
  };
}

function allProtectedOutputPaths(paths, plan) {
  const pairs = [
    paths.freshAbsence, paths.freshAccountSubdomain, paths.deployOutput,
    paths.before, paths.after, paths.attestation,
  ];
  return [
    bootstrapClaimPath(paths, plan), paths.prepared, paths.started, paths.result,
    paths.status.primary, paths.status.recovery,
    ...pairs.flatMap((pair) => [
    pair.primary, pair.recovery,
    ]),
  ];
}

function remainingProtectedOutputPaths(paths, plan) {
  return [
    bootstrapClaimPath(paths, plan),
    paths.started,
    paths.result,
    paths.status.primary,
    paths.status.recovery,
    paths.freshAbsence.recovery,
    paths.freshAccountSubdomain.recovery,
    paths.deployOutput.primary,
    paths.deployOutput.recovery,
    paths.before.primary,
    paths.before.recovery,
    paths.after.primary,
    paths.after.recovery,
    paths.attestation.primary,
    paths.attestation.recovery,
  ];
}

async function assertProtectedOutputsReady(files, plan, deps) {
  try {
    for (const file of files) {
      await deps.assertOutsideRepository(file, plan.repositoryRoot);
      await deps.assertSecureCreateOnlyDestination(file);
    }
  } catch {
    fail('CLOUDFLARE_E_BOOTSTRAP_OUTPUT_PREFLIGHT');
  }
}

function assertFreshAtDeployment(capture, deploymentStartedAt) {
  const observed = Date.parse(capture.evidence?.observedAt ?? '');
  const started = Date.parse(deploymentStartedAt);
  if (Number.isNaN(observed) || Number.isNaN(started)
    || observed > started || started - observed > 15_000) {
    fail('CLOUDFLARE_E_BOOTSTRAP_FRESHNESS');
  }
}

function sameFileMetadata(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid
    && left.nlink === right.nlink && left.mode === right.mode && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function readPreparedDeployOutput(handle, file, initialMetadata, openFile) {
  let bytes;
  let pathHandle;
  try {
    const observed = await handle.stat({ bigint: true });
    if (!observed.isFile() || observed.dev !== initialMetadata.dev
      || observed.ino !== initialMetadata.ino || observed.uid !== initialMetadata.uid
      || observed.nlink !== 1n || (observed.mode & 0o777n) !== 0o600n
      || observed.size < 1n || observed.size > BigInt(MAXIMUM_DEPLOY_OUTPUT_BYTES)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_FILE');
    }
    pathHandle = await openFile(file, 'r');
    const fromPath = await pathHandle.stat({ bigint: true });
    if (!sameFileMetadata(observed, fromPath)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_FILE');
    }
    bytes = Buffer.alloc(Number(observed.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead < 1) fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_FILE');
      offset += result.bytesRead;
    }
    const rechecked = await handle.stat({ bigint: true });
    if (!sameFileMetadata(observed, rechecked)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_FILE');
    }
    return bytes;
  } catch (error) {
    bytes?.fill(0);
    if (error?.message === 'CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_FILE') throw error;
    fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_FILE');
  } finally {
    if (pathHandle) {
      try { await pathHandle.close(); }
      catch {
        bytes?.fill(0);
        fail('CLOUDFLARE_E_BOOTSTRAP_CLEANUP');
      }
    }
  }
}

async function rereadAttestationCandidate(file, attestation, readSecureFile) {
  let stored;
  let canonicalBytes;
  try {
    stored = await readSecureFile(file);
    const parsed = parseCanonicalEvidenceStorage(stored);
    canonicalBytes = parsed.canonicalBytes;
    validateBootstrapAttestation(parsed.payload, { now: new Date(attestation.attestedAt) });
    if (canonicalJson(parsed.payload) !== canonicalJson(attestation)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CANDIDATE');
    }
  } finally {
    stored?.fill(0);
    canonicalBytes?.fill(0);
  }
}

export async function executeBootstrapMutationCore(planInput, dependencyInput) {
  const deps = dependencies(dependencyInput);
  const plan = validatePlan(planInput, instant(deps.now));
  const workerName = bootstrapWorkerName(plan.environment);
  const protectedPaths = defaultBootstrapProtectedEvidencePaths({
    environment: plan.environment,
    authorizationSha256: plan.authorizationSha256,
    home: deps.userHome,
  });
  try { await deps.fileSystem.mkdir(protectedPaths.directory, { recursive: true, mode: 0o700 }); }
  catch { fail('CLOUDFLARE_E_BOOTSTRAP_OUTPUT_PREFLIGHT'); }
  await deps.assertPinnedWranglerInstalled(plan.repositoryRoot);
  await assertProtectedOutputsReady(allProtectedOutputPaths(protectedPaths, plan), plan, deps);
  let temporary = null;
  let deploymentOutput;
  let outputHandle;
  try {
    temporary = await deps.fileSystem.mkdtemp(
      path.join(deps.temporaryRoot, 'dwnc-cloudflare-bootstrap-'),
    );
    const outputPath = path.join(temporary, 'wrangler-output.ndjson');
    await deps.fileSystem.writeFile(
      path.join(temporary, 'deny-all-worker.js'), DENY_ALL_WORKER_SOURCE, { mode: 0o600 },
    );
    await deps.fileSystem.writeFile(path.join(temporary, 'wrangler-bootstrap.jsonc'),
      `${canonicalJson(bootstrapConfig(plan.environment))}\n`, { mode: 0o600 });
    await deps.fileSystem.writeFile(
      path.join(temporary, 'wrangler-empty.env'), '', { mode: 0o600 },
    );

    const initialBoundary = await assertAuthorizationAndGit(plan, deps);
    const commandArguments = bootstrapArguments({
      environment: plan.environment, authorizationSha256: plan.authorizationSha256,
    });
    const envelopeEvidence = stagingEnvelopeEvidence(plan);
    const preparedRecord = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-deny-bootstrap-prepared-v1',
      environment: plan.environment,
      workerName,
      accountIdSha256: plan.targetAccountIdSha256,
      authorizationSha256: plan.authorizationSha256,
      sourceGitSha: initialBoundary.git.commit,
      sourceGitTree: initialBoundary.git.tree,
      denyWorkerSha256: bootstrapDenyWorkerSha256(),
      bootstrapConfigSha256: bootstrapConfigSha256(plan.environment),
      serviceEvidenceSha256: plan.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: plan.accountSubdomainEvidenceSha256,
      commandArgumentsSha256: sha256Hex(canonicalJson(commandArguments)),
      runnerMetadataSha256: envelopeEvidence.metadataSha256,
      runnerPreflightSha256: envelopeEvidence.preflightSha256,
      runnerPermissionSha256: envelopeEvidence.permissionContractSha256,
      preparedAt: initialBoundary.checkedAt.toISOString(),
    };
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.prepared, preparedRecord, canonicalBootstrapPreparedRecord,
    );
    const preparedSha256 = bootstrapPreparedSha256(preparedRecord);

    const freshCapture = await fetchServiceExistenceCapture({
      environment: plan.environment,
      accountId: plan.controlPlane.accountId,
      apiToken: plan.controlPlane.apiToken,
      ttlSeconds: 15,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    const freshAccountSubdomainCapture = await fetchAccountWorkersDevSubdomainCapture({
      environment: plan.environment,
      accountId: plan.controlPlane.accountId,
      apiToken: plan.controlPlane.apiToken,
      ttlSeconds: 15,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
    validateServiceExistenceCapture(freshCapture, {
      expected: {
        environment: plan.environment, workerName,
        accountIdSha256: plan.targetAccountIdSha256, exists: false,
      },
      now: new Date(freshCapture.evidence.observedAt), maxAgeSeconds: 15,
    });
    validateAccountWorkersDevSubdomainCapture(freshAccountSubdomainCapture, {
      expected: {
        environment: plan.environment, workerName,
        accountIdSha256: plan.targetAccountIdSha256,
        accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
      },
      now: new Date(freshAccountSubdomainCapture.evidence.observedAt), maxAgeSeconds: 15,
    });
    await assertBootstrapCaptureHasNoSensitiveValues(freshCapture, {
      accountId: plan.controlPlane.accountId, apiToken: plan.controlPlane.apiToken,
    });
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.freshAbsence.primary, freshCapture,
      canonicalServiceExistenceCapturePayload,
    );
    await assertBootstrapCaptureHasNoSensitiveValues(freshAccountSubdomainCapture, {
      accountId: plan.controlPlane.accountId, apiToken: plan.controlPlane.apiToken,
    });
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.freshAccountSubdomain.primary, freshAccountSubdomainCapture,
      canonicalAccountWorkersDevSubdomainCapturePayload,
    );
    const freshAbsenceCaptureSha256 = sha256Hex(
      canonicalServiceExistenceCapturePayload(freshCapture),
    );
    const freshAccountSubdomainCaptureSha256 = sha256Hex(
      canonicalAccountWorkersDevSubdomainCapturePayload(freshAccountSubdomainCapture),
    );
    await assertProtectedOutputsReady(
      remainingProtectedOutputPaths(protectedPaths, plan), plan, deps,
    );
    await assertAuthorizationAndGit(plan, deps, initialBoundary.git);
    const claimedFile = await deps.claimOneTimeAuthorization({
      directory: protectedPaths.directory,
      authorizationSha256: plan.authorizationSha256,
      scope: `${plan.environment}-bootstrap`,
      target: workerName,
      binding: {
        environment: plan.environment,
        workerName,
        accountIdSha256: plan.targetAccountIdSha256,
        authorizationSha256: plan.authorizationSha256,
        sourceGitSha: initialBoundary.git.commit,
        sourceGitTree: initialBoundary.git.tree,
        denyWorkerSha256: preparedRecord.denyWorkerSha256,
        bootstrapConfigSha256: preparedRecord.bootstrapConfigSha256,
        serviceEvidenceSha256: preparedRecord.serviceEvidenceSha256,
        accountSubdomainEvidenceSha256: preparedRecord.accountSubdomainEvidenceSha256,
        commandArgumentsSha256: preparedRecord.commandArgumentsSha256,
        preparedSha256,
        freshAbsenceCaptureSha256,
        freshAccountSubdomainCaptureSha256,
      },
      now: deps.now,
    });
    const claimedSha256 = await claimSha256(claimedFile, deps);

    outputHandle = await deps.fileSystem.open(outputPath, 'wx+', 0o600);
    const outputInitialMetadata = await outputHandle.stat({ bigint: true });
    const mutationBoundary = await assertAuthorizationAndGit(
      plan, deps, initialBoundary.git,
    );
    const commandStarted = mutationBoundary.checkedAt;
    assertFreshAtDeployment(freshCapture, commandStarted.toISOString());
    assertFreshAtDeployment(freshAccountSubdomainCapture, commandStarted.toISOString());
    const startedRecord = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-deny-bootstrap-started-v1',
      environment: plan.environment,
      workerName,
      accountIdSha256: plan.targetAccountIdSha256,
      authorizationSha256: plan.authorizationSha256,
      sourceGitSha: mutationBoundary.git.commit,
      sourceGitTree: mutationBoundary.git.tree,
      denyWorkerSha256: preparedRecord.denyWorkerSha256,
      bootstrapConfigSha256: preparedRecord.bootstrapConfigSha256,
      serviceEvidenceSha256: preparedRecord.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: preparedRecord.accountSubdomainEvidenceSha256,
      commandArgumentsSha256: preparedRecord.commandArgumentsSha256,
      preparedSha256,
      claimSha256: claimedSha256,
      freshAbsenceCaptureSha256,
      freshAccountSubdomainCaptureSha256,
      startedAt: commandStarted.toISOString(),
    };
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.started, startedRecord, canonicalBootstrapStartedRecord,
    );
    const startedSha256 = bootstrapStartedSha256(startedRecord);
    const sealed = sealedWranglerCommand(plan, commandArguments, outputPath);
    let wranglerError = null;
    let wranglerValue = {};
    try {
      wranglerValue = await deps.execFileAsync(sealed.binary, sealed.args, {
        cwd: temporary,
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        env: sealed.environment,
      });
    } catch (error) { wranglerError = error; }
    const commandCompleted = instant(deps.now);
    let deployCapture = null;
    let deployOutputError = null;
    if (wranglerError === null) {
      try {
        deploymentOutput = await readPreparedDeployOutput(
          outputHandle, outputPath, outputInitialMetadata, deps.fileSystem.open,
        );
        deployCapture = createBootstrapDeployOutputCapture(deploymentOutput, {
          environment: plan.environment,
          authorizationSha256: plan.authorizationSha256,
          commandStartedAt: commandStarted.toISOString(),
          commandCompletedAt: commandCompleted.toISOString(),
        });
      } catch (error) { deployOutputError = error; }
    }
    const normalized = normalizeBootstrapWranglerResult(wranglerError, wranglerValue);
    const resultRecord = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-deny-bootstrap-result-v1',
      environment: plan.environment,
      workerName,
      accountIdSha256: plan.targetAccountIdSha256,
      authorizationSha256: plan.authorizationSha256,
      sourceGitSha: mutationBoundary.git.commit,
      sourceGitTree: mutationBoundary.git.tree,
      denyWorkerSha256: preparedRecord.denyWorkerSha256,
      bootstrapConfigSha256: preparedRecord.bootstrapConfigSha256,
      serviceEvidenceSha256: preparedRecord.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: preparedRecord.accountSubdomainEvidenceSha256,
      commandArgumentsSha256: preparedRecord.commandArgumentsSha256,
      preparedSha256,
      startedSha256,
      ...normalized,
      deployOutputState: deployCapture ? 'valid'
        : wranglerError === null ? 'invalid' : 'absent',
      deployOutputSha256: deployCapture?.rawOutputSha256 ?? null,
      versionId: deployCapture?.versionId ?? null,
      completedAt: commandCompleted.toISOString(),
    };
    let resultWriteError = null;
    try {
      await deps.writeCanonicalEvidenceCreateOnly(
        protectedPaths.result, resultRecord, canonicalBootstrapResultRecord,
      );
    } catch (error) { resultWriteError = error; }
    const recovered = await recoverBootstrapStatusCore({
      repositoryRoot: plan.repositoryRoot,
      environment: plan.environment,
      targetAccountIdSha256: plan.targetAccountIdSha256,
      authorizationSha256: plan.authorizationSha256,
      sourceGitSha: plan.authorization.sourceGitSha,
      serviceEvidenceSha256: plan.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: plan.accountSubdomainEvidenceSha256,
      denyWorkerSha256: preparedRecord.denyWorkerSha256,
      bootstrapConfigSha256: preparedRecord.bootstrapConfigSha256,
      commandArgumentsSha256: preparedRecord.commandArgumentsSha256,
      controlPlane: recoveryControlPlane(plan),
    }, protectedPaths, {
      fetchImpl: deps.fetchImpl,
      now: deps.now,
      userHome: deps.userHome,
      inspectGit: deps.inspectGit,
      lstat: deps.fileSystem.lstat,
      readSecureFile: deps.readSecureFile,
      writeCanonicalEvidenceCreateOnly: deps.writeCanonicalEvidenceCreateOnly,
      assertOutsideRepository: deps.assertOutsideRepository,
      assertSecureCreateOnlyDestination: deps.assertSecureCreateOnlyDestination,
    });
    if (resultWriteError) throw resultWriteError;
    if (recovered.status.classification !== 'exact-recovered') {
      if (wranglerError) throw wranglerError;
      if (deployOutputError) throw deployOutputError;
      fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_AMBIGUOUS');
    }
    if (wranglerError) throw wranglerError;
    if (deployOutputError) throw deployOutputError;
    await assertBootstrapCaptureHasNoSensitiveValues(deployCapture, {
      accountId: plan.controlPlane.accountId, apiToken: plan.controlPlane.apiToken,
    });
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.deployOutput.primary, deployCapture,
      canonicalBootstrapDeployOutputCapturePayload,
    );

    const expectedTag = `dwnc-bootstrap-${plan.authorizationSha256.slice(0, 24)}`;
    const expectedMessage = `dwnc-deny-bootstrap:${plan.authorizationSha256}`;
    const snapshotArguments = {
      environment: plan.environment,
      accountId: plan.controlPlane.accountId,
      apiToken: plan.controlPlane.apiToken,
      versionId: deployCapture.versionId,
      expectedTag,
      expectedMessage,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    };
    const beforeCapture = await fetchBootstrapPostStateCapture(snapshotArguments);
    const afterCapture = await fetchBootstrapPostStateCapture(snapshotArguments);
    const attestedAt = instant(deps.now);
    await validateBootstrapPostStatePair(beforeCapture, afterCapture, {
      expected: {
        environment: plan.environment, workerName,
        accountIdSha256: plan.targetAccountIdSha256,
        accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
        versionId: deployCapture.versionId,
        versionTag: expectedTag,
        versionMessage: expectedMessage,
        deploymentId: beforeCapture.evidence.deploymentId,
      },
      now: attestedAt,
      maxAgeSeconds: 300,
    });
    await assertBootstrapCaptureHasNoSensitiveValues(beforeCapture, {
      accountId: plan.controlPlane.accountId, apiToken: plan.controlPlane.apiToken,
    });
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.before.primary, beforeCapture, canonicalBootstrapPostStateCapturePayload,
    );
    await assertBootstrapCaptureHasNoSensitiveValues(afterCapture, {
      accountId: plan.controlPlane.accountId, apiToken: plan.controlPlane.apiToken,
    });
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.after.primary, afterCapture, canonicalBootstrapPostStateCapturePayload,
    );

    const postState = beforeCapture.evidence;
    const attestation = {
      schemaVersion: 2,
      contract: 'dwnc-cloudflare-deny-bootstrap-attestation-v2',
      environment: plan.environment,
      workerName,
      accountIdSha256: plan.targetAccountIdSha256,
      accountSubdomain: postState.accountSubdomain,
      sourceGitSha: plan.authorization.sourceGitSha,
      versionId: deployCapture.versionId,
      deploymentId: postState.deploymentId,
      deploymentStrategy: postState.deploymentStrategy,
      deploymentVersions: postState.deploymentVersions,
      denyWorkerSha256: bootstrapDenyWorkerSha256(),
      bootstrapConfigSha256: bootstrapConfigSha256(plan.environment),
      serviceEvidenceSha256: plan.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: plan.accountSubdomainEvidenceSha256,
      freshAbsenceCaptureSha256: sha256Hex(
        canonicalServiceExistenceCapturePayload(freshCapture),
      ),
      freshAccountSubdomainCaptureSha256: sha256Hex(
        canonicalAccountWorkersDevSubdomainCapturePayload(freshAccountSubdomainCapture),
      ),
      deploymentOutputSha256: deployCapture.rawOutputSha256,
      deploymentOutputCaptureSha256: sha256Hex(
        canonicalBootstrapDeployOutputCapturePayload(deployCapture),
      ),
      beforeCaptureSha256: sha256Hex(canonicalBootstrapPostStateCapturePayload(beforeCapture)),
      afterCaptureSha256: sha256Hex(canonicalBootstrapPostStateCapturePayload(afterCapture)),
      beforeResponseDescriptorsSha256: beforeCapture.evidence.responseDescriptorsSha256,
      afterResponseDescriptorsSha256: afterCapture.evidence.responseDescriptorsSha256,
      beforeResponses: beforeCapture.responses.map((response) => response.descriptor),
      afterResponses: afterCapture.responses.map((response) => response.descriptor),
      semanticStateSha256: postState.semanticStateSha256,
      settingsPolicySha256: postState.settingsPolicySha256,
      denyModuleSha256: postState.denyModuleSha256,
      denyModuleBytes: postState.denyModuleBytes,
      workersDevEnabled: postState.workersDevEnabled,
      previewsEnabled: postState.previewsEnabled,
      logpush: postState.logpush,
      tailConsumersEmpty: postState.tailConsumers.length === 0,
      tagsEmpty: postState.tags.length === 0,
      observabilityEnabled: postState.observabilityEnabled,
      tracesEnabled: postState.tracesEnabled,
      logsDestinationsEmpty: postState.logsDestinations.length === 0,
      tracesDestinationsEmpty: postState.tracesDestinations.length === 0,
      bindingsEmpty: postState.bindingsEmpty,
      assetsAbsent: postState.assetsAbsent,
      entrypointSource: postState.entrypointSource,
      deploymentStartedAt: deployCapture.commandStartedAt,
      deploymentCompletedAt: deployCapture.commandCompletedAt,
      snapshotBeforeStartedAt: beforeCapture.observationStartedAt,
      snapshotBeforeCompletedAt: beforeCapture.observationCompletedAt,
      snapshotAfterStartedAt: afterCapture.observationStartedAt,
      snapshotAfterCompletedAt: afterCapture.observationCompletedAt,
      attestedAt: attestedAt.toISOString(),
    };
    validateBootstrapAttestation(attestation, { now: attestedAt });
    await verifyBootstrapAttestationFixedCaptures({
      attestation,
      authorizationSha256: plan.authorizationSha256,
      repositoryRoot: plan.repositoryRoot,
      home: deps.userHome,
      accountId: plan.controlPlane.accountId,
      apiToken: plan.controlPlane.apiToken,
      readFile: deps.readSecureFile,
      assertOutsideRepository: deps.assertOutsideRepository,
      now: attestedAt,
    });
    await deps.writeCanonicalEvidenceCreateOnly(
      protectedPaths.attestation.primary, attestation, canonicalBootstrapAttestationPayload,
    );
    await rereadAttestationCandidate(
      protectedPaths.attestation.primary, attestation, deps.readSecureFile,
    );
    return {
      result: {
        contract: 'dwnc-cloudflare-deny-bootstrap-result-v2',
        environment: plan.environment,
        workerName,
        versionId: deployCapture.versionId,
        deploymentId: postState.deploymentId,
        workersDevEnabled: false,
        previewsEnabled: false,
        attestationRequired: true,
        candidateWritten: true,
      },
      attestation,
    };
  } finally {
    deploymentOutput?.fill(0);
    let cleanupFailed = false;
    if (outputHandle) {
      try { await outputHandle.close(); }
      catch { cleanupFailed = true; }
    }
    if (temporary) {
      try { await deps.fileSystem.rm(temporary, { recursive: true, force: true }); }
      catch { cleanupFailed = true; }
    }
    if (cleanupFailed) fail('CLOUDFLARE_E_BOOTSTRAP_CLEANUP');
  }
}

async function inspectBootstrapGit(repositoryRoot) {
  const run = async (args) => (await promisify(execFile)('git', args, {
    cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15_000,
  })).stdout.trim();
  const [commit, tree, status] = await Promise.all([
    run(['rev-parse', 'HEAD']),
    run(['rev-parse', 'HEAD^{tree}']),
    run(['status', '--porcelain=v1', '--untracked-files=normal']),
  ]);
  return { commit, tree, clean: status.length === 0 };
}

export async function executeBootstrapMutationProduction(plan) {
  if (plan?.environment !== 'staging'
    || plan.controlPlane?.envelope?.operation !== 'staging-bootstrap') {
    fail('CLOUDFLARE_E_BOOTSTRAP_EXECUTION_PLAN');
  }
  const authRoot = plan.controlPlane.envelope.authRoot;
  return executeBootstrapMutationCore(plan, {
    fetchImpl: globalThis.fetch,
    execFileAsync: promisify(execFile),
    now: () => new Date(),
    userHome: userInfo().homedir,
    temporaryRoot: path.join(authRoot, 'tmp'),
    wranglerSourceEnvironment: process.env,
    inspectGit: inspectBootstrapGit,
    assertPinnedWranglerInstalled,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
    claimOneTimeAuthorization,
    writeCanonicalEvidenceCreateOnly,
    readSecureFile,
    fileSystem: { lstat, mkdir, mkdtemp, open, rm, writeFile },
  });
}
