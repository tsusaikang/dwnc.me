import path from 'node:path';
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
  cloudflareWranglerEnvironment,
} from './cloudflare-process.mjs';
import {
  parseCanonicalEvidenceStorage,
} from './cloudflare-signing-key.mjs';

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
const EXACT_FILE_SYSTEM_KEYS = ['mkdtemp', 'open', 'rm', 'writeFile'];
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
    || !exactKeys(plan.controlPlane, ['accountId', 'apiToken'])
    || typeof plan.controlPlane.apiToken !== 'string'
    || plan.controlPlane.apiToken.length < 1 || plan.controlPlane.apiToken.length > 4096) {
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

function allProtectedOutputPaths(paths, plan) {
  const pairs = [
    paths.freshAbsence, paths.freshAccountSubdomain, paths.deployOutput,
    paths.before, paths.after, paths.attestation,
  ];
  return [bootstrapClaimPath(paths, plan), ...pairs.flatMap((pair) => [
    pair.primary, pair.recovery,
  ])];
}

function remainingProtectedOutputPaths(paths, plan) {
  return [
    bootstrapClaimPath(paths, plan),
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
    await assertProtectedOutputsReady(
      remainingProtectedOutputPaths(protectedPaths, plan), plan, deps,
    );
    await assertAuthorizationAndGit(plan, deps, initialBoundary.git);
    await deps.claimOneTimeAuthorization({
      directory: protectedPaths.directory,
      authorizationSha256: plan.authorizationSha256,
      scope: `${plan.environment}-bootstrap`,
      target: workerName,
    });

    outputHandle = await deps.fileSystem.open(outputPath, 'wx+', 0o600);
    const outputInitialMetadata = await outputHandle.stat({ bigint: true });
    const args = bootstrapArguments({
      environment: plan.environment, authorizationSha256: plan.authorizationSha256,
    });
    const wranglerEnvironment = cloudflareWranglerEnvironment(
      deps.wranglerSourceEnvironment,
      {
        CI: '1',
        WRANGLER_OUTPUT_FILE_PATH: outputPath,
        WRANGLER_WRITE_LOGS: '0',
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
      },
    );
    const mutationBoundary = await assertAuthorizationAndGit(
      plan, deps, initialBoundary.git,
    );
    const commandStarted = mutationBoundary.checkedAt;
    assertFreshAtDeployment(freshCapture, commandStarted.toISOString());
    assertFreshAtDeployment(freshAccountSubdomainCapture, commandStarted.toISOString());
    await deps.execFileAsync(path.join(plan.repositoryRoot, 'node_modules/.bin/wrangler'), args, {
      cwd: temporary,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      env: wranglerEnvironment,
    });
    const commandCompleted = instant(deps.now);
    deploymentOutput = await readPreparedDeployOutput(
      outputHandle, outputPath, outputInitialMetadata, deps.fileSystem.open,
    );
    const deployCapture = createBootstrapDeployOutputCapture(deploymentOutput, {
      environment: plan.environment,
      authorizationSha256: plan.authorizationSha256,
      commandStartedAt: commandStarted.toISOString(),
      commandCompletedAt: commandCompleted.toISOString(),
    });
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

export async function executeBootstrapMutationProduction() {
  fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECOVERY_REQUIRED');
}
