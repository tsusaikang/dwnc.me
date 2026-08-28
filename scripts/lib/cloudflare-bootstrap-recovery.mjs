import path from 'node:path';
import {
  assertBootstrapCaptureHasNoSensitiveValues,
  bootstrapArguments,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  bootstrapWorkerName,
  canonicalBootstrapPostStateCapturePayload,
  canonicalServiceExistenceCapturePayload,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  fetchBootstrapPostStateCapture,
  fetchServiceExistenceCapture,
  validateAccountWorkersDevSubdomainCapture,
  validateServiceExistenceCapture,
} from './cloudflare-bootstrap.mjs';
import {
  bootstrapAttemptRecordSha256,
  bootstrapInstantMilliseconds,
  canonicalBootstrapStatusRecord,
  classifyBootstrapStatusSemantics,
  safeBootstrapErrorCode,
  validateBootstrapPreparedRecord,
  validateBootstrapRecoveryObservation,
  validateBootstrapResultRecord,
  validateBootstrapStartedRecord,
  validateBootstrapStatusRecord,
} from './cloudflare-bootstrap-attempt.mjs';
import { fetchBootstrapGet } from './cloudflare-bootstrap-http.mjs';
import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import { parseCanonicalEvidenceStorage } from './cloudflare-signing-key.mjs';
import { assertCloudflareAccountTarget } from './cloudflare-process.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OID = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SAFE_SIGNAL = /^SIG[A-Z0-9]{1,16}$/u;
const REQUEST_COUNT_KEYS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const RECOVERY_CHILD_RESULT_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'classification', 'versionId', 'deploymentId', 'existing',
  'recordedRequestCounts', 'currentStateRequestCounts',
]);

const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

export function emptyBootstrapRequestCounts() {
  return { GET: 0, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 };
}

function validateRecoveryRequestCounts(value) {
  if (!exactKeys(value, REQUEST_COUNT_KEYS)
    || Object.values(value).some((count) => !Number.isSafeInteger(count) || count < 0)
    || REQUEST_COUNT_KEYS.filter((key) => key !== 'GET')
      .some((key) => value[key] !== 0)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
  }
  return value;
}

export function validateBootstrapRecoveryChildResult(value) {
  if (!exactKeys(value, RECOVERY_CHILD_RESULT_KEYS) || value.schemaVersion !== 1
    || value.contract !== 'dwnc-cloudflare-deny-bootstrap-recovery-result-v1'
    || !['never-started', 'absent-after-start', 'exact-recovered', 'ambiguous']
      .includes(value.classification)
    || value.versionId !== null && !UUID.test(value.versionId ?? '')
    || value.deploymentId !== null && !UUID.test(value.deploymentId ?? '')
    || typeof value.existing !== 'boolean') {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
  }
  validateRecoveryRequestCounts(value.recordedRequestCounts);
  validateRecoveryRequestCounts(value.currentStateRequestCounts);
  if (value.existing && value.currentStateRequestCounts.GET !== 0
    || !value.existing
      && value.currentStateRequestCounts.GET !== value.recordedRequestCounts.GET
        - 2
    || value.recordedRequestCounts.GET < 2) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
  }
  return value;
}

export function canonicalBootstrapRecoveryChildResult(value) {
  validateBootstrapRecoveryChildResult(value);
  return canonicalJson(value);
}

function instant(now) {
  let value;
  try { value = now(); } catch { fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_TIME'); }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_TIME');
  }
  return value;
}

function commonObservation(state, observedAt, values = {}) {
  const observation = {
    state,
    serviceCaptureSha256: values.serviceCaptureSha256 ?? null,
    discoveryResponseSha256: values.discoveryResponseSha256 ?? null,
    deployableVersionsSha256: values.deployableVersionsSha256 ?? null,
    deployableVersionsPageCount: values.deployableVersionsPageCount ?? 0,
    getCount: values.getCount ?? 0,
    postStateCaptureSha256: values.postStateCaptureSha256 ?? null,
    versionId: values.versionId ?? null,
    deploymentId: values.deploymentId ?? null,
    semanticStateSha256: values.semanticStateSha256 ?? null,
    accountSubdomain: values.accountSubdomain ?? null,
    workersDevEnabled: values.workersDevEnabled ?? null,
    previewsEnabled: values.previewsEnabled ?? null,
    denyWorkerSha256: values.denyWorkerSha256 ?? null,
    settingsPolicySha256: values.settingsPolicySha256 ?? null,
    errorCode: values.errorCode ?? null,
    observedAt: observedAt.toISOString(),
  };
  validateBootstrapRecoveryObservation(observation);
  return observation;
}

const DEPLOYABLE_VERSION_PAGE_SIZE = 50;
const MAX_DEPLOYABLE_VERSION_PAGES = 10;
const MAX_DEPLOYABLE_VERSIONS = DEPLOYABLE_VERSION_PAGE_SIZE * MAX_DEPLOYABLE_VERSION_PAGES;

function parseDeployableVersionPage(fetched, page, expectedTotal = null) {
  const parsed = fetched.json;
  const info = parsed?.result_info;
  const allowedInfoKeys = ['page', 'per_page', 'count', 'total_count', 'total_pages'];
  if (!parsed || parsed.success !== true || !Array.isArray(parsed.errors)
    || parsed.errors.length !== 0 || !Array.isArray(parsed.messages)
    || !parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)
    || !exactKeys(parsed.result, ['items']) || !Array.isArray(parsed.result.items)
    || !info || typeof info !== 'object' || Array.isArray(info)
    || Object.keys(info).some((key) => !allowedInfoKeys.includes(key))
    || !['page', 'per_page', 'count', 'total_count']
      .every((key) => Object.hasOwn(info, key))
    || info.page !== page || info.per_page !== DEPLOYABLE_VERSION_PAGE_SIZE
    || info.count !== parsed.result.items.length
    || !Number.isSafeInteger(info.count) || info.count < 0
    || info.count > DEPLOYABLE_VERSION_PAGE_SIZE
    || !Number.isSafeInteger(info.total_count) || info.total_count < 0
    || info.total_count > MAX_DEPLOYABLE_VERSIONS
    || expectedTotal !== null && info.total_count !== expectedTotal) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
  }
  const totalPages = Math.max(1, Math.ceil(info.total_count / DEPLOYABLE_VERSION_PAGE_SIZE));
  if (totalPages > MAX_DEPLOYABLE_VERSION_PAGES
    || info.total_pages !== undefined && info.total_pages !== totalPages
    || page > totalPages
    || page < totalPages && info.count !== DEPLOYABLE_VERSION_PAGE_SIZE
    || page === totalPages && info.count !== info.total_count
      - DEPLOYABLE_VERSION_PAGE_SIZE * (page - 1)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
  }
  const ids = parsed.result.items.map((item) => item?.id);
  if (ids.some((id) => !UUID.test(id ?? '')) || new Set(ids).size !== ids.length) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
  }
  return { ids, totalCount: info.total_count, totalPages, info };
}

async function fetchAllDeployableVersions({
  environment, workerName, accountId, accountIdSha256, apiToken, fetchImpl, now,
}) {
  const ids = [];
  const pages = [];
  let totalCount = null;
  let totalPages = 1;
  try {
    for (let page = 1; page <= totalPages; page += 1) {
      const fetched = await fetchBootstrapGet({
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/`
          + `${workerName}/versions?deployable=true&page=${page}`
          + `&per_page=${DEPLOYABLE_VERSION_PAGE_SIZE}`,
        apiToken,
        role: 'versions-list-page',
        page,
        perPage: DEPLOYABLE_VERSION_PAGE_SIZE,
        environment,
        workerName,
        accountIdSha256,
        expectedStatuses: [200],
        bodyKind: 'json',
        fetchImpl,
        now,
        errorCode: 'CLOUDFLARE_E_BOOTSTRAP_RECOVERY_FETCH',
      });
      pages.push(fetched);
      const parsed = parseDeployableVersionPage(fetched, page, totalCount);
      totalCount ??= parsed.totalCount;
      totalPages = parsed.totalPages;
      for (const id of parsed.ids) {
        if (ids.includes(id)) fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
        ids.push(id);
      }
    }
    if (ids.length !== totalCount || ids.length !== 1) {
      fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
    }
    return {
      ids,
      pageCount: pages.length,
      sha256: sha256Hex(canonicalJson({
        ids,
        pages: pages.map((page) => ({
          requestTargetSha256: page.descriptor.requestTargetSha256,
          decodedBodySha256: page.descriptor.decodedBodySha256,
        })),
      })),
    };
  } finally {
    for (const page of pages) page.bytes?.fill(0);
  }
}

function parseDiscovery(fetched, expectedMessage) {
  const parsed = fetched.json;
  if (!parsed || parsed.success !== true || !Array.isArray(parsed.errors)
    || parsed.errors.length !== 0 || !Array.isArray(parsed.messages)
    || !parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)
    || !Array.isArray(parsed.result.deployments) || parsed.result.deployments.length !== 1) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
  }
  const deployment = parsed.result.deployments[0];
  if (!UUID.test(deployment?.id ?? '') || deployment.strategy !== 'percentage'
    || !Array.isArray(deployment.versions) || deployment.versions.length !== 1
    || !UUID.test(deployment.versions[0]?.version_id ?? '')
    || deployment.versions[0]?.percentage !== 100
    || deployment.annotations?.['workers/message'] !== expectedMessage) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
  }
  return { deploymentId: deployment.id, versionId: deployment.versions[0].version_id };
}

export async function fetchBootstrapCurrentStateObservation({
  environment,
  accountId,
  apiToken,
  authorizationSha256,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const workerName = bootstrapWorkerName(environment);
  const observedAt = instant(now);
  let getCount = 0;
  const countedFetch = async (url, options) => {
    if (options?.method !== 'GET') fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_METHOD');
    getCount += 1;
    return fetchImpl(url, options);
  };
  let serviceCapture;
  try {
    serviceCapture = await fetchServiceExistenceCapture({
      environment, accountId, apiToken, ttlSeconds: 15, fetchImpl: countedFetch, now,
    });
  } catch (error) {
    return commonObservation('invalid', observedAt, {
      getCount,
      errorCode: safeBootstrapErrorCode(error),
    });
  }
  const serviceCaptureSha256 = sha256Hex(canonicalServiceExistenceCapturePayload(serviceCapture));
  if (serviceCapture.evidence.exists === false) {
    return commonObservation('absent', instant(now), { serviceCaptureSha256, getCount });
  }

  const accountIdSha256 = serviceCapture.evidence.accountIdSha256;
  const expectedTag = `dwnc-bootstrap-${authorizationSha256.slice(0, 24)}`;
  const expectedMessage = `dwnc-deny-bootstrap:${authorizationSha256}`;
  let discovery;
  let discoveryResponseSha256 = null;
  let deployableVersionsSha256 = null;
  let deployableVersionsPageCount = 0;
  try {
    discovery = await fetchBootstrapGet({
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/`
        + `${workerName}/deployments`,
      apiToken,
      role: 'deployment-discovery',
      environment,
      workerName,
      accountIdSha256,
      expectedStatuses: [200],
      bodyKind: 'json',
      fetchImpl: countedFetch,
      now,
      errorCode: 'CLOUDFLARE_E_BOOTSTRAP_RECOVERY_FETCH',
    });
    discoveryResponseSha256 = sha256Hex(canonicalJson({
      descriptor: discovery.descriptor,
      decodedBodySha256: discovery.descriptor.decodedBodySha256,
    }));
    const selected = parseDiscovery(discovery, expectedMessage);
    const deployable = await fetchAllDeployableVersions({
      environment, workerName, accountId, accountIdSha256, apiToken,
      fetchImpl: countedFetch, now,
    });
    deployableVersionsSha256 = deployable.sha256;
    deployableVersionsPageCount = deployable.pageCount;
    if (deployable.ids[0] !== selected.versionId) {
      fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
    }
    const postState = await fetchBootstrapPostStateCapture({
      environment, accountId, apiToken, versionId: selected.versionId,
      expectedTag, expectedMessage, fetchImpl: countedFetch, now,
    });
    if (postState.evidence.deploymentId !== selected.deploymentId) {
      fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_REMOTE');
    }
    await assertBootstrapCaptureHasNoSensitiveValues(serviceCapture, { accountId, apiToken });
    await assertBootstrapCaptureHasNoSensitiveValues(postState, { accountId, apiToken });
    return commonObservation('present-exact', instant(now), {
      serviceCaptureSha256,
      discoveryResponseSha256,
      deployableVersionsSha256,
      deployableVersionsPageCount,
      getCount,
      postStateCaptureSha256: sha256Hex(canonicalBootstrapPostStateCapturePayload(postState)),
      versionId: selected.versionId,
      deploymentId: selected.deploymentId,
      semanticStateSha256: postState.evidence.semanticStateSha256,
      accountSubdomain: postState.evidence.accountSubdomain,
      workersDevEnabled: postState.evidence.workersDevEnabled,
      previewsEnabled: postState.evidence.previewsEnabled,
      denyWorkerSha256: postState.evidence.denyModuleSha256,
      settingsPolicySha256: postState.evidence.settingsPolicySha256,
    });
  } catch (error) {
    return commonObservation('invalid', instant(now), {
      serviceCaptureSha256,
      discoveryResponseSha256,
      deployableVersionsSha256,
      deployableVersionsPageCount,
      getCount,
      errorCode: safeBootstrapErrorCode(error),
    });
  } finally {
    discovery?.bytes?.fill(0);
  }
}

function validatePlan(plan, { requireControlPlane = true } = {}) {
  const keys = [
    'repositoryRoot', 'environment', 'targetAccountIdSha256', 'authorizationSha256',
    'sourceGitSha', 'serviceEvidenceSha256', 'accountSubdomainEvidenceSha256',
    'denyWorkerSha256', 'bootstrapConfigSha256', 'commandArgumentsSha256', 'controlPlane',
  ];
  const baseEnvelopeKeys = [
    'operation', 'accountIdSha256', 'metadataSha256', 'preflightSha256',
    'permissionContractSha256',
  ];
  if (!exactKeys(plan, keys) || plan.environment !== 'staging'
    || typeof plan.repositoryRoot !== 'string' || !path.isAbsolute(plan.repositoryRoot)
    || path.resolve(plan.repositoryRoot) !== plan.repositoryRoot
    || !SHA256.test(plan.targetAccountIdSha256 ?? '')
    || ![plan.authorizationSha256, plan.serviceEvidenceSha256,
      plan.accountSubdomainEvidenceSha256, plan.denyWorkerSha256,
      plan.bootstrapConfigSha256, plan.commandArgumentsSha256]
      .every((value) => SHA256.test(value ?? ''))
    || plan.denyWorkerSha256 !== bootstrapDenyWorkerSha256()
    || plan.bootstrapConfigSha256 !== bootstrapConfigSha256('staging')
    || plan.commandArgumentsSha256 !== sha256Hex(canonicalJson(bootstrapArguments({
      environment: 'staging', authorizationSha256: plan.authorizationSha256,
    })))
    || !GIT_OID.test(plan.sourceGitSha ?? '')
    || requireControlPlane !== true && requireControlPlane !== false
    || requireControlPlane && (!exactKeys(plan.controlPlane, ['accountId', 'apiToken', 'envelope'])
      || !/^[A-Fa-f0-9]{32}$/u.test(plan.controlPlane.accountId ?? '')
      || typeof plan.controlPlane.apiToken !== 'string' || plan.controlPlane.apiToken.length < 1
      || !exactKeys(plan.controlPlane.envelope, [
        ...baseEnvelopeKeys,
        ...(plan.controlPlane.envelope?.operation === 'staging-bootstrap-recover'
          ? ['authenticationRequestCounts'] : []),
      ])
      || !['staging-bootstrap', 'staging-bootstrap-recover']
        .includes(plan.controlPlane.envelope.operation)
      || plan.controlPlane.envelope.accountIdSha256 !== plan.targetAccountIdSha256
      || ![plan.controlPlane.envelope.metadataSha256, plan.controlPlane.envelope.preflightSha256,
        plan.controlPlane.envelope.permissionContractSha256]
        .every((value) => SHA256.test(value ?? ''))
      || plan.controlPlane.envelope.operation === 'staging-bootstrap-recover'
        && canonicalJson(plan.controlPlane.envelope.authenticationRequestCounts)
          !== canonicalJson({ GET: 2, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 }))
    || !requireControlPlane && plan.controlPlane !== null) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PLAN');
  }
  return plan;
}

function validateDependencies(deps) {
  const keys = [
    'fetchImpl', 'now', 'userHome', 'inspectGit', 'lstat', 'readSecureFile',
    'writeCanonicalEvidenceCreateOnly', 'assertOutsideRepository',
    'assertSecureCreateOnlyDestination',
  ];
  if (!exactKeys(deps, keys) || keys.filter((key) => !['userHome'].includes(key))
    .some((key) => typeof deps[key] !== 'function')
    || typeof deps.userHome !== 'string' || !path.isAbsolute(deps.userHome)
    || path.resolve(deps.userHome) !== deps.userHome) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_DEPENDENCIES');
  }
  return deps;
}

function validateLocalDependencies(deps) {
  const keys = [
    'inspectGit', 'lstat', 'readSecureFile', 'assertOutsideRepository',
    'assertSecureCreateOnlyDestination',
  ];
  if (!exactKeys(deps, keys) || keys.some((key) => typeof deps[key] !== 'function')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_DEPENDENCIES');
  }
  return deps;
}

async function protectedFileState(file, lstat) {
  try {
    const stats = await lstat(file);
    return stats.isFile() && !stats.isSymbolicLink() ? 'regular' : 'invalid';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'absent';
    return 'invalid';
  }
}

async function inspectRecord(file, validator, deps) {
  const fileState = await protectedFileState(file, deps.lstat);
  if (fileState === 'absent') return { state: 'absent', sha256: null, record: null };
  if (fileState === 'invalid') return { state: 'invalid', sha256: null, record: null };
  let stored;
  let canonicalBytes;
  try {
    stored = await deps.readSecureFile(file, 16 * 1024 * 1024, { allowEmpty: true });
    let parsed;
    try { parsed = parseCanonicalEvidenceStorage(stored); }
    catch { return { state: 'partial', sha256: null, record: null }; }
    canonicalBytes = parsed.canonicalBytes;
    try { validator(parsed.payload); }
    catch { return { state: 'invalid', sha256: null, record: null }; }
    return { state: 'valid', sha256: sha256Hex(canonicalBytes), record: parsed.payload };
  } catch {
    return { state: 'invalid', sha256: null, record: null };
  } finally {
    stored?.fill(0);
    canonicalBytes?.fill(0);
  }
}

async function inspectClaimRecord(file, plan, prepared, freshAbsence, freshSubdomain, deps) {
  const fileState = await protectedFileState(file, deps.lstat);
  if (fileState === 'absent') return { state: 'absent', sha256: null, record: null };
  if (fileState === 'invalid') return { state: 'invalid', sha256: null, record: null };
  let stored;
  try {
    stored = await deps.readSecureFile(file, 64 * 1024, { allowEmpty: true });
    if (stored.length < 3 || stored.at(-1) !== 0x0a
      || stored.subarray(0, stored.length - 1).includes(0x0a)
      || stored.subarray(0, stored.length - 1).includes(0x0d)) {
      return { state: 'partial', sha256: null, record: null };
    }
    const raw = stored.subarray(0, stored.length - 1);
    let record;
    try { record = JSON.parse(raw.toString('utf8')); }
    catch { return { state: 'partial', sha256: null, record: null }; }
    try { validateClaim(record, plan, prepared, freshAbsence, freshSubdomain); }
    catch { return { state: 'invalid', sha256: null, record: null }; }
    return { state: 'valid', sha256: sha256Hex(raw), record };
  } catch {
    return { state: 'invalid', sha256: null, record: null };
  } finally { stored?.fill(0); }
}

function attemptIdentity(plan, sourceGitTree) {
  return {
    environment: 'staging',
    workerName: bootstrapWorkerName('staging'),
    accountIdSha256: plan.targetAccountIdSha256,
    authorizationSha256: plan.authorizationSha256,
    sourceGitSha: plan.sourceGitSha,
    sourceGitTree,
    denyWorkerSha256: plan.denyWorkerSha256,
    bootstrapConfigSha256: plan.bootstrapConfigSha256,
    serviceEvidenceSha256: plan.serviceEvidenceSha256,
    accountSubdomainEvidenceSha256: plan.accountSubdomainEvidenceSha256,
    commandArgumentsSha256: plan.commandArgumentsSha256,
  };
}

function validateClaim(record, plan, prepared, freshAbsence, freshSubdomain) {
  const keys = [
    'schemaVersion', 'contract', 'authorizationSha256', 'scope',
    'targetSha256', 'binding', 'claimedAt',
  ];
  const binding = prepared?.state === 'valid'
    ? {
      ...attemptIdentity(plan, prepared.record.sourceGitTree),
      preparedSha256: prepared.sha256,
      freshAbsenceCaptureSha256: freshAbsence?.sha256 ?? null,
      freshAccountSubdomainCaptureSha256: freshSubdomain?.sha256 ?? null,
    }
    : null;
  if (!exactKeys(record, keys) || record.schemaVersion !== 3
    || record.contract !== 'dwnc-cloudflare-one-time-authorization-attempt-v3'
    || record.authorizationSha256 !== plan.authorizationSha256
    || record.scope !== 'staging-bootstrap'
    || record.targetSha256 !== sha256Hex(bootstrapWorkerName('staging'))
    || canonicalJson(record.binding) !== canonicalJson(binding)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_CLAIM_RECORD');
  }
  bootstrapInstantMilliseconds(record.claimedAt, 'CLOUDFLARE_E_BOOTSTRAP_CLAIM_RECORD');
  return record;
}

function phaseState(phase) { return { state: phase.state, sha256: phase.sha256 }; }

export function classifyBootstrapRecovery({ phaseGraph, resultRecord, observationA, observationB }) {
  return classifyBootstrapStatusSemantics({
    phaseGraph,
    resultOutcome: resultRecord?.wranglerOutcome ?? null,
    resultVersionId: resultRecord?.versionId ?? null,
    observationA,
    observationB,
  });
}

function validateGit(snapshot, expectedCommit, expectedTree = null) {
  if (!exactKeys(snapshot, ['commit', 'tree', 'clean'])
    || snapshot.clean !== true || snapshot.commit !== expectedCommit
    || !GIT_OID.test(snapshot.tree ?? '')
    || expectedTree !== null && snapshot.tree !== expectedTree) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_GIT');
  }
  return snapshot;
}

function markInvalid(phase) {
  phase.state = 'invalid';
  phase.sha256 = null;
  phase.record = null;
}

async function inspectFixedRecordPair(pair, validator, deps) {
  const primary = await inspectRecord(pair.primary, validator, deps);
  const recovery = await inspectRecord(pair.recovery, validator, deps);
  if (primary.state === 'valid' && recovery.state === 'absent') return primary;
  if (primary.state === 'partial' && recovery.state === 'valid') return recovery;
  if (primary.state === 'absent' && recovery.state === 'absent') return primary;
  return { state: 'invalid', sha256: null, record: null };
}

function recordTime(record, key) {
  if (!record) return null;
  try { return bootstrapInstantMilliseconds(record[key], 'CLOUDFLARE_E_BOOTSTRAP_RECOVERY_TIME'); }
  catch { return null; }
}

function captureTime(phase) {
  if (phase.state !== 'valid') return null;
  try {
    const evidence = phase.record?.evidence;
    const descriptor = phase.record?.responseDescriptor;
    for (const value of [
      evidence?.requestStartedAt, evidence?.requestCompletedAt,
      evidence?.observedAt, evidence?.expiresAt,
      descriptor?.requestStartedAt, descriptor?.requestCompletedAt,
    ]) bootstrapInstantMilliseconds(value, 'CLOUDFLARE_E_BOOTSTRAP_RECOVERY_TIME');
    return bootstrapInstantMilliseconds(
      evidence.observedAt, 'CLOUDFLARE_E_BOOTSTRAP_RECOVERY_TIME',
    );
  } catch { return null; }
}

function propagateInvalidPhases({ prepared, claim, started, result, freshAbsence, freshSubdomain }) {
  if (claim.state === 'valid' && (prepared.state !== 'valid'
      || freshAbsence.state !== 'valid' || freshSubdomain.state !== 'valid')) markInvalid(claim);
  if (started.state === 'valid' && (prepared.state !== 'valid' || claim.state !== 'valid'
      || freshAbsence.state !== 'valid' || freshSubdomain.state !== 'valid')) markInvalid(started);
  if (started.state === 'absent' && result.state !== 'absent') markInvalid(result);
  if (result.state === 'valid' && started.state !== 'valid') markInvalid(result);
}

async function inspectAttemptPhases(paths, plan, deps) {
  const claimFile = path.join(
    paths.directory, `staging-bootstrap-${plan.authorizationSha256}.json`,
  );
  await deps.assertOutsideRepository(claimFile, plan.repositoryRoot);
  const prepared = await inspectRecord(paths.prepared, (record) =>
    validateBootstrapPreparedRecord(record, { expected: {
      ...attemptIdentity(plan, record.sourceGitTree),
    } }), deps);
  const freshAbsence = await inspectFixedRecordPair(paths.freshAbsence, (record) =>
    validateServiceExistenceCapture(record, {
      expected: {
        environment: 'staging', workerName: bootstrapWorkerName('staging'),
        accountIdSha256: plan.targetAccountIdSha256, exists: false,
      },
      now: new Date(record.evidence?.observedAt), maxAgeSeconds: 15,
    }), deps);
  const freshSubdomain = await inspectFixedRecordPair(paths.freshAccountSubdomain, (record) =>
    validateAccountWorkersDevSubdomainCapture(record, {
      expected: {
        environment: 'staging', workerName: bootstrapWorkerName('staging'),
        accountIdSha256: plan.targetAccountIdSha256,
        accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
      },
      now: new Date(record.evidence?.observedAt), maxAgeSeconds: 15,
    }), deps);
  const claim = await inspectClaimRecord(
    claimFile, plan, prepared, freshAbsence, freshSubdomain, deps,
  );
  const identity = prepared.state === 'valid'
    ? attemptIdentity(plan, prepared.record.sourceGitTree) : attemptIdentity(plan, '0'.repeat(40));
  const started = await inspectRecord(paths.started, (record) =>
    validateBootstrapStartedRecord(record, { expected: {
      ...identity,
      preparedSha256: prepared.sha256,
      claimSha256: claim.sha256,
      freshAbsenceCaptureSha256: freshAbsence.sha256,
      freshAccountSubdomainCaptureSha256: freshSubdomain.sha256,
    } }), deps);
  const result = await inspectRecord(paths.result, (record) =>
    validateBootstrapResultRecord(record, { expected: {
      ...identity,
      preparedSha256: prepared.sha256,
      startedSha256: started.sha256,
    } }), deps);

  propagateInvalidPhases({ prepared, claim, started, result, freshAbsence, freshSubdomain });

  const preparedAt = recordTime(prepared.record, 'preparedAt');
  const freshAbsenceAt = captureTime(freshAbsence);
  const freshSubdomainAt = captureTime(freshSubdomain);
  const claimedAt = recordTime(claim.record, 'claimedAt');
  const startedAt = recordTime(started.record, 'startedAt');
  const completedAt = recordTime(result.record, 'completedAt');
  for (const [phase, observedAt] of [
    [freshAbsence, freshAbsenceAt], [freshSubdomain, freshSubdomainAt],
  ]) {
    if (phase.state === 'valid'
      && (preparedAt === null || observedAt === null || observedAt < preparedAt)) {
      markInvalid(phase);
    }
  }
  propagateInvalidPhases({ prepared, claim, started, result, freshAbsence, freshSubdomain });
  if (claim.state === 'valid' && (preparedAt === null || freshAbsenceAt === null
      || freshSubdomainAt === null || claimedAt === null
      || freshAbsenceAt < preparedAt || freshSubdomainAt < preparedAt
      || claimedAt < freshAbsenceAt || claimedAt < freshSubdomainAt)) markInvalid(claim);
  if (started.state === 'valid' && (claimedAt === null || startedAt < claimedAt)) markInvalid(started);
  if (started.state === 'valid') {
    for (const observedAt of [freshAbsenceAt, freshSubdomainAt]) {
      if (observedAt === null || observedAt > startedAt || startedAt - observedAt > 15_000) {
        markInvalid(started);
        break;
      }
    }
  }
  if (result.state === 'valid' && (startedAt === null || completedAt < startedAt)) markInvalid(result);
  propagateInvalidPhases({ prepared, claim, started, result, freshAbsence, freshSubdomain });
  return {
    prepared, claim, started, result, freshAbsence, freshSubdomain,
    phaseGraph: {
      prepared: phaseState(prepared), claim: phaseState(claim),
      started: phaseState(started), result: phaseState(result),
    },
  };
}

function validateStatusChronology(status, phases) {
  const preparedAt = recordTime(phases.prepared.record, 'preparedAt');
  const freshTimes = [captureTime(phases.freshAbsence), captureTime(phases.freshSubdomain)]
    .filter((value) => value !== null);
  const claimedAt = recordTime(phases.claim.record, 'claimedAt');
  const startedAt = recordTime(phases.started.record, 'startedAt');
  const completedAt = recordTime(phases.result.record, 'completedAt');
  const observationAAt = bootstrapInstantMilliseconds(
    status.observationA.observedAt, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD',
  );
  const observationBAt = bootstrapInstantMilliseconds(
    status.observationB.observedAt, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD',
  );
  const statusAt = bootstrapInstantMilliseconds(
    status.observedAt, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD',
  );
  let latest = preparedAt;
  if (latest === null || freshTimes.some((value) => value < latest)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  }
  if (freshTimes.length > 0) latest = Math.max(latest, ...freshTimes);
  for (const phaseAt of [claimedAt, startedAt, completedAt]) {
    if (phaseAt === null) continue;
    if (phaseAt < latest) fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
    latest = phaseAt;
  }
  if (observationAAt < latest || observationBAt < observationAAt || statusAt < observationBAt) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  }
}

async function statusDestination(paths, plan, phases, git, deps) {
  const primary = await inspectRecord(paths.status.primary, validateBootstrapStatusRecord, deps);
  const recovery = await inspectRecord(paths.status.recovery, validateBootstrapStatusRecord, deps);
  let selected = null;
  let output = null;
  if (primary.state === 'valid' && recovery.state === 'absent') selected = primary;
  else if (primary.state === 'partial' && recovery.state === 'valid') selected = recovery;
  else if (primary.state === 'absent' && recovery.state === 'absent') output = paths.status.primary;
  else if (primary.state === 'partial' && recovery.state === 'absent') {
    output = paths.status.recovery;
  } else if (primary.state === 'valid' || primary.state === 'absent') {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_ORPHAN');
  } else fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECOVERY_EXHAUSTED');
  if (selected !== null) {
    const expected = {
      ...attemptIdentity(plan, git.tree),
      phaseGraph: phases.phaseGraph,
      resultOutcome: phases.result.state === 'valid'
        ? phases.result.record.wranglerOutcome : null,
      resultVersionId: phases.result.state === 'valid'
        ? phases.result.record.versionId : null,
    };
    validateBootstrapStatusRecord(selected.record, { expected });
    validateStatusChronology(selected.record, phases);
    return { existing: selected.record, output: null };
  }
  return { existing: null, output };
}

function protectedRecoveryFiles(paths) {
  return [
    paths.prepared, paths.started, paths.result,
    paths.status?.primary, paths.status?.recovery,
    paths.freshAbsence?.primary, paths.freshAbsence?.recovery,
    paths.freshAccountSubdomain?.primary, paths.freshAccountSubdomain?.recovery,
  ];
}

async function inspectBootstrapRecoveryLocal(plan, paths, deps) {
  if (!paths || typeof paths !== 'object' || typeof paths.directory !== 'string'
    || !path.isAbsolute(paths.directory)) fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PATH');
  const protectedFiles = protectedRecoveryFiles(paths);
  if (protectedFiles.some((file) => typeof file !== 'string' || !path.isAbsolute(file))) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PATH');
  }
  for (const file of protectedFiles) await deps.assertOutsideRepository(file, plan.repositoryRoot);
  const phases = await inspectAttemptPhases(paths, plan, deps);
  const expectedTree = phases.prepared.state === 'valid' ? phases.prepared.record.sourceGitTree : null;
  const git = validateGit(await deps.inspectGit(plan.repositoryRoot), plan.sourceGitSha, expectedTree);
  const selectedStatus = await statusDestination(paths, plan, phases, git, deps);
  if (selectedStatus.existing === null) {
    await deps.assertSecureCreateOnlyDestination(selectedStatus.output);
  }
  return { phases, git, selectedStatus };
}

export async function inspectExistingBootstrapRecoveryStatus(planInput, paths, dependencyInput) {
  const plan = validatePlan(planInput, { requireControlPlane: false });
  const deps = validateLocalDependencies(dependencyInput);
  const inspected = await inspectBootstrapRecoveryLocal(plan, paths, deps);
  if (inspected.phases.prepared.state !== 'valid'
    || ['partial', 'invalid'].includes(inspected.phases.claim.state)
    || ['partial', 'invalid'].includes(inspected.phases.started.state)
    || inspected.phases.result.state === 'invalid'
    || [inspected.phases.freshAbsence.state, inspected.phases.freshSubdomain.state]
      .some((state) => ['partial', 'invalid'].includes(state))) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE');
  }
  return inspected.selectedStatus.existing === null ? { state: 'needs-recovery' }
    : { state: 'complete', status: inspected.selectedStatus.existing };
}

export async function recoverBootstrapStatusCore(planInput, paths, dependencyInput) {
  const plan = validatePlan(planInput);
  assertCloudflareAccountTarget(plan.controlPlane.accountId, plan.targetAccountIdSha256);
  const deps = validateDependencies(dependencyInput);
  const local = await inspectBootstrapRecoveryLocal(plan, paths, deps);
  if (local.selectedStatus.existing) {
    return {
      status: local.selectedStatus.existing,
      existing: true,
      currentStateRequestCounts: emptyBootstrapRequestCounts(),
    };
  }
  await deps.assertSecureCreateOnlyDestination(local.selectedStatus.output);
  const { phases, git: firstGit } = local;
  let observationA;
  let observationB;
  const phaseDamaged = ['prepared', 'claim', 'started'].some((key) =>
    ['partial', 'invalid'].includes(phases.phaseGraph[key].state))
    || phases.prepared.state !== 'valid' || phases.result.state === 'invalid'
    || [phases.freshAbsence.state, phases.freshSubdomain.state]
      .some((state) => ['partial', 'invalid'].includes(state));
  if (phaseDamaged) fail('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE');
  const arguments_ = {
    environment: 'staging',
    accountId: plan.controlPlane.accountId,
    apiToken: plan.controlPlane.apiToken,
    authorizationSha256: plan.authorizationSha256,
    fetchImpl: deps.fetchImpl,
    now: deps.now,
  };
  observationA = await fetchBootstrapCurrentStateObservation(arguments_);
  validateGit(await deps.inspectGit(plan.repositoryRoot), firstGit.commit, firstGit.tree);
  observationB = await fetchBootstrapCurrentStateObservation(arguments_);
  validateGit(await deps.inspectGit(plan.repositoryRoot), firstGit.commit, firstGit.tree);
  const identity = attemptIdentity(plan, firstGit.tree);
  const status = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-deny-bootstrap-status-v1',
    ...identity,
    recoveryRunnerMetadataSha256: plan.controlPlane.envelope.metadataSha256,
    recoveryRunnerPreflightSha256: plan.controlPlane.envelope.preflightSha256,
    recoveryRunnerPermissionSha256: plan.controlPlane.envelope.permissionContractSha256,
    classification: classifyBootstrapRecovery({
      phaseGraph: phases.phaseGraph, resultRecord: phases.result.record,
      observationA, observationB,
    }),
    phaseGraph: phases.phaseGraph,
    resultOutcome: phases.result.state === 'valid'
      ? phases.result.record.wranglerOutcome : null,
    resultVersionId: phases.result.state === 'valid'
      ? phases.result.record.versionId : null,
    observationA,
    observationB,
    authenticationRequestCounts: plan.controlPlane.envelope.operation
      === 'staging-bootstrap-recover'
      ? plan.controlPlane.envelope.authenticationRequestCounts
      : { GET: 0, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 },
    stateRequestCounts: {
      GET: observationA.getCount + observationB.getCount,
      HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0,
    },
    requestCounts: {
      GET: observationA.getCount + observationB.getCount
        + (plan.controlPlane.envelope.operation === 'staging-bootstrap-recover'
          ? plan.controlPlane.envelope.authenticationRequestCounts.GET : 0),
      HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0,
    },
    wranglerInvocations: 0,
    observedAt: instant(deps.now).toISOString(),
  };
  validateBootstrapStatusRecord(status);
  validateStatusChronology(status, phases);
  await deps.writeCanonicalEvidenceCreateOnly(
    local.selectedStatus.output, status, canonicalBootstrapStatusRecord,
  );
  return {
    status,
    existing: false,
    currentStateRequestCounts: status.stateRequestCounts,
  };
}

export function bootstrapPreparedSha256(record) {
  return bootstrapAttemptRecordSha256(record, validateBootstrapPreparedRecord);
}

export function bootstrapStartedSha256(record) {
  return bootstrapAttemptRecordSha256(record, validateBootstrapStartedRecord);
}

export function bootstrapResultSha256(record) {
  return bootstrapAttemptRecordSha256(record, validateBootstrapResultRecord);
}

export function normalizeBootstrapWranglerResult(error, value = {}) {
  const stdout = typeof value.stdout === 'string' ? value.stdout
    : typeof error?.stdout === 'string' ? error.stdout : '';
  const stderr = typeof value.stderr === 'string' ? value.stderr
    : typeof error?.stderr === 'string' ? error.stderr : '';
  const wranglerOutcome = error === null ? 'success'
    : error?.killed === true || error?.code === 'ETIMEDOUT' ? 'timeout'
    : Number.isSafeInteger(error?.code) && error.code > 0 && error.code <= 255
      ? 'exit-nonzero'
      : typeof error?.signal === 'string' && SAFE_SIGNAL.test(error.signal)
        ? 'signal' : 'spawn-error';
  const exitCode = wranglerOutcome === 'success' ? 0
    : wranglerOutcome === 'exit-nonzero' ? error.code : null;
  const signal = ['signal', 'timeout'].includes(wranglerOutcome)
    && typeof error?.signal === 'string' && SAFE_SIGNAL.test(error.signal)
    ? error.signal : null;
  return {
    wranglerOutcome,
    exitCode,
    signal,
    errorCode: error === null ? null : safeBootstrapErrorCode(error,
      'CLOUDFLARE_E_BOOTSTRAP_WRANGLER_FAILED'),
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: sha256Hex(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: sha256Hex(stderr),
  };
}
