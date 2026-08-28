import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import { bootstrapDenyWorkerSha256, bootstrapSettingsPolicySha256 }
  from './cloudflare-bootstrap.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OID = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_ERROR = /^CLOUDFLARE_E_[A-Z0-9_]{1,96}$/u;

const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

export function bootstrapInstantMilliseconds(value, errorCode) {
  if (!ISO_INSTANT.test(value ?? '')) fail(errorCode);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail(errorCode);
  return parsed.getTime();
}

export const BOOTSTRAP_ATTEMPT_IDENTITY_KEYS = Object.freeze([
  'environment', 'workerName', 'accountIdSha256', 'authorizationSha256',
  'sourceGitSha', 'sourceGitTree', 'denyWorkerSha256', 'bootstrapConfigSha256',
  'serviceEvidenceSha256', 'accountSubdomainEvidenceSha256', 'commandArgumentsSha256',
]);

export function validateBootstrapAttemptIdentity(record, errorCode) {
  if (record.environment !== 'staging' || record.workerName !== 'dwnc-me-staging'
    || !SHA256.test(record.accountIdSha256 ?? '')
    || !SHA256.test(record.authorizationSha256 ?? '')
    || !GIT_OID.test(record.sourceGitSha ?? '') || !GIT_OID.test(record.sourceGitTree ?? '')
    || ![record.denyWorkerSha256, record.bootstrapConfigSha256,
      record.serviceEvidenceSha256, record.accountSubdomainEvidenceSha256,
      record.commandArgumentsSha256].every((value) => SHA256.test(value ?? ''))) {
    fail(errorCode);
  }
  return record;
}

function validateExpected(record, expected, keys, errorCode) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) fail(errorCode);
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || canonicalJson(record[key]) !== canonicalJson(value)) fail(errorCode);
  }
}

const PREPARED_KEYS = Object.freeze([
  'schemaVersion', 'contract', ...BOOTSTRAP_ATTEMPT_IDENTITY_KEYS,
  'runnerMetadataSha256', 'runnerPreflightSha256', 'runnerPermissionSha256', 'preparedAt',
]);

export function validateBootstrapPreparedRecord(record, { expected = {} } = {}) {
  if (!exactKeys(record, PREPARED_KEYS) || record.schemaVersion !== 1
    || record.contract !== 'dwnc-cloudflare-deny-bootstrap-prepared-v1'
    || ![record.denyWorkerSha256, record.bootstrapConfigSha256,
      record.serviceEvidenceSha256, record.accountSubdomainEvidenceSha256,
      record.commandArgumentsSha256, record.runnerMetadataSha256,
      record.runnerPreflightSha256, record.runnerPermissionSha256]
      .every((value) => SHA256.test(value ?? ''))
    || !ISO_INSTANT.test(record.preparedAt ?? '')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_PREPARED_RECORD');
  }
  bootstrapInstantMilliseconds(record.preparedAt, 'CLOUDFLARE_E_BOOTSTRAP_PREPARED_RECORD');
  validateBootstrapAttemptIdentity(record, 'CLOUDFLARE_E_BOOTSTRAP_PREPARED_RECORD');
  validateExpected(record, expected, PREPARED_KEYS, 'CLOUDFLARE_E_BOOTSTRAP_PREPARED_RECORD');
  return record;
}

export function canonicalBootstrapPreparedRecord(record) {
  validateBootstrapPreparedRecord(record);
  return canonicalJson(record);
}

const STARTED_KEYS = Object.freeze([
  'schemaVersion', 'contract', ...BOOTSTRAP_ATTEMPT_IDENTITY_KEYS,
  'preparedSha256', 'claimSha256', 'freshAbsenceCaptureSha256',
  'freshAccountSubdomainCaptureSha256', 'startedAt',
]);

export function validateBootstrapStartedRecord(record, { expected = {} } = {}) {
  if (!exactKeys(record, STARTED_KEYS) || record.schemaVersion !== 1
    || record.contract !== 'dwnc-cloudflare-deny-bootstrap-started-v1'
    || ![record.preparedSha256, record.claimSha256, record.freshAbsenceCaptureSha256,
      record.freshAccountSubdomainCaptureSha256]
      .every((value) => SHA256.test(value ?? ''))
    || !ISO_INSTANT.test(record.startedAt ?? '')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STARTED_RECORD');
  }
  bootstrapInstantMilliseconds(record.startedAt, 'CLOUDFLARE_E_BOOTSTRAP_STARTED_RECORD');
  validateBootstrapAttemptIdentity(record, 'CLOUDFLARE_E_BOOTSTRAP_STARTED_RECORD');
  validateExpected(record, expected, STARTED_KEYS, 'CLOUDFLARE_E_BOOTSTRAP_STARTED_RECORD');
  return record;
}

export function canonicalBootstrapStartedRecord(record) {
  validateBootstrapStartedRecord(record);
  return canonicalJson(record);
}

const RESULT_KEYS = Object.freeze([
  'schemaVersion', 'contract', ...BOOTSTRAP_ATTEMPT_IDENTITY_KEYS,
  'preparedSha256', 'startedSha256', 'wranglerOutcome', 'exitCode', 'signal',
  'errorCode', 'stdoutBytes', 'stdoutSha256', 'stderrBytes', 'stderrSha256',
  'deployOutputState', 'deployOutputSha256', 'versionId', 'completedAt',
]);

export function validateBootstrapResultRecord(record, { expected = {} } = {}) {
  const outcome = record?.wranglerOutcome;
  const succeeded = outcome === 'success';
  if (!exactKeys(record, RESULT_KEYS) || record.schemaVersion !== 1
    || record.contract !== 'dwnc-cloudflare-deny-bootstrap-result-v1'
    || !['success', 'exit-nonzero', 'signal', 'timeout', 'spawn-error'].includes(outcome)
    || record.exitCode !== null && (!Number.isSafeInteger(record.exitCode)
      || record.exitCode < 0 || record.exitCode > 255)
    || record.signal !== null && !/^SIG[A-Z0-9]{1,16}$/u.test(record.signal)
    || record.errorCode !== null && !SAFE_ERROR.test(record.errorCode)
    || !Number.isSafeInteger(record.stdoutBytes) || record.stdoutBytes < 0
    || !Number.isSafeInteger(record.stderrBytes) || record.stderrBytes < 0
    || ![record.preparedSha256, record.startedSha256, record.stdoutSha256,
      record.stderrSha256].every((value) => SHA256.test(value ?? ''))
    || !['absent', 'invalid', 'valid'].includes(record.deployOutputState)
    || record.deployOutputSha256 !== null && !SHA256.test(record.deployOutputSha256)
    || record.versionId !== null && !UUID.test(record.versionId)
    || record.deployOutputState === 'valid'
      !== (record.deployOutputSha256 !== null && record.versionId !== null)
    || record.deployOutputState !== 'valid'
      && (record.deployOutputSha256 !== null || record.versionId !== null)
    || succeeded && (record.exitCode !== 0 || record.signal !== null || record.errorCode !== null)
    || succeeded && record.deployOutputState === 'absent'
    || outcome === 'exit-nonzero' && (!(record.exitCode > 0)
      || record.signal !== null || record.errorCode === null)
    || outcome === 'signal' && (record.exitCode !== null
      || record.signal === null || record.errorCode === null)
    || outcome === 'timeout' && (record.exitCode !== null || record.errorCode === null)
    || outcome === 'spawn-error' && (record.exitCode !== null
      || record.signal !== null || record.errorCode === null)
    || !succeeded && (record.deployOutputState !== 'absent'
      || record.deployOutputSha256 !== null || record.versionId !== null)
    || !ISO_INSTANT.test(record.completedAt ?? '')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RESULT_RECORD');
  }
  bootstrapInstantMilliseconds(record.completedAt, 'CLOUDFLARE_E_BOOTSTRAP_RESULT_RECORD');
  validateBootstrapAttemptIdentity(record, 'CLOUDFLARE_E_BOOTSTRAP_RESULT_RECORD');
  validateExpected(record, expected, RESULT_KEYS, 'CLOUDFLARE_E_BOOTSTRAP_RESULT_RECORD');
  return record;
}

export function canonicalBootstrapResultRecord(record) {
  validateBootstrapResultRecord(record);
  return canonicalJson(record);
}

export function bootstrapAttemptRecordSha256(record, validator) {
  validator(record);
  return sha256Hex(canonicalJson(record));
}

const PHASE_STATE_KEYS = Object.freeze(['state', 'sha256']);
export function validateBootstrapPhaseState(value) {
  if (!exactKeys(value, PHASE_STATE_KEYS)
    || !['absent', 'partial', 'invalid', 'valid'].includes(value.state)
    || value.sha256 !== null && !SHA256.test(value.sha256)
    || value.state === 'valid' !== (value.sha256 !== null)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  }
  return value;
}

const OBSERVATION_KEYS = Object.freeze([
  'state', 'serviceCaptureSha256', 'discoveryResponseSha256',
  'deployableVersionsSha256', 'deployableVersionsPageCount', 'getCount',
  'postStateCaptureSha256', 'versionId', 'deploymentId', 'semanticStateSha256',
  'accountSubdomain', 'workersDevEnabled', 'previewsEnabled', 'denyWorkerSha256',
  'settingsPolicySha256', 'errorCode', 'observedAt',
]);

export function validateBootstrapRecoveryObservation(value, { expected = {} } = {}) {
  if (!exactKeys(value, OBSERVATION_KEYS)
    || !['absent', 'present-exact', 'invalid'].includes(value.state)
    || value.serviceCaptureSha256 !== null && !SHA256.test(value.serviceCaptureSha256)
    || value.discoveryResponseSha256 !== null && !SHA256.test(value.discoveryResponseSha256)
    || value.deployableVersionsSha256 !== null && !SHA256.test(value.deployableVersionsSha256)
    || !Number.isSafeInteger(value.deployableVersionsPageCount)
    || value.deployableVersionsPageCount < 0 || value.deployableVersionsPageCount > 10
    || !Number.isSafeInteger(value.getCount) || value.getCount < 0 || value.getCount > 64
    || value.postStateCaptureSha256 !== null && !SHA256.test(value.postStateCaptureSha256)
    || value.versionId !== null && !UUID.test(value.versionId)
    || value.deploymentId !== null && !UUID.test(value.deploymentId)
    || value.semanticStateSha256 !== null && !SHA256.test(value.semanticStateSha256)
    || value.accountSubdomain !== null && value.accountSubdomain !== 'dwnc'
    || value.workersDevEnabled !== null && typeof value.workersDevEnabled !== 'boolean'
    || value.previewsEnabled !== null && typeof value.previewsEnabled !== 'boolean'
    || value.denyWorkerSha256 !== null && !SHA256.test(value.denyWorkerSha256)
    || value.settingsPolicySha256 !== null && !SHA256.test(value.settingsPolicySha256)
    || value.errorCode !== null && !SAFE_ERROR.test(value.errorCode)
    || !ISO_INSTANT.test(value.observedAt ?? '')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  }
  bootstrapInstantMilliseconds(value.observedAt, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  const exact = value.state === 'present-exact';
  const absent = value.state === 'absent';
  if (exact !== [value.serviceCaptureSha256, value.discoveryResponseSha256,
    value.deployableVersionsSha256, value.postStateCaptureSha256,
    value.versionId, value.deploymentId,
    value.semanticStateSha256, value.accountSubdomain, value.workersDevEnabled,
    value.previewsEnabled, value.denyWorkerSha256, value.settingsPolicySha256]
    .every((entry) => entry !== null)
    || exact && value.errorCode !== null
    || exact && (value.accountSubdomain !== 'dwnc' || value.workersDevEnabled !== false
      || value.previewsEnabled !== false || value.deployableVersionsPageCount < 1
      || value.getCount !== 10 + value.deployableVersionsPageCount)
    || absent && (value.serviceCaptureSha256 === null
      || [value.discoveryResponseSha256, value.postStateCaptureSha256,
        value.deployableVersionsSha256,
        value.versionId, value.deploymentId, value.semanticStateSha256,
        value.accountSubdomain, value.workersDevEnabled, value.previewsEnabled,
        value.denyWorkerSha256, value.settingsPolicySha256, value.errorCode]
      .some((entry) => entry !== null)
    )
    || absent && (value.deployableVersionsPageCount !== 0 || value.getCount !== 1)
    || value.state === 'invalid' && value.errorCode === null) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  }
  validateExpected(value, expected, OBSERVATION_KEYS, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  return value;
}

const STATUS_KEYS = Object.freeze([
  'schemaVersion', 'contract', ...BOOTSTRAP_ATTEMPT_IDENTITY_KEYS,
  'recoveryRunnerMetadataSha256', 'recoveryRunnerPreflightSha256',
  'recoveryRunnerPermissionSha256', 'classification', 'phaseGraph', 'resultOutcome',
  'resultVersionId', 'observationA', 'observationB', 'authenticationRequestCounts',
  'stateRequestCounts', 'requestCounts', 'wranglerInvocations', 'observedAt',
]);
const REQUEST_COUNT_KEYS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PHASE_GRAPH_KEYS = Object.freeze(['prepared', 'claim', 'started', 'result']);

function sameExactObservation(left, right) {
  return left.state === 'present-exact' && right.state === 'present-exact'
    && ['versionId', 'deploymentId', 'semanticStateSha256', 'accountSubdomain',
      'workersDevEnabled', 'previewsEnabled', 'denyWorkerSha256', 'settingsPolicySha256',
      'deployableVersionsSha256'].every((key) => left[key] === right[key]);
}

export function classifyBootstrapStatusSemantics({
  phaseGraph, resultOutcome, resultVersionId, observationA, observationB,
}) {
  const required = ['prepared', 'claim', 'started'];
  if (required.some((key) => ['partial', 'invalid'].includes(phaseGraph[key].state))
    || observationA.state === 'invalid' || observationB.state === 'invalid') return 'ambiguous';
  const bothAbsent = observationA.state === 'absent' && observationB.state === 'absent';
  if (observationA.state !== observationB.state
    || observationA.state === 'present-exact'
      && !sameExactObservation(observationA, observationB)) return 'ambiguous';
  if (phaseGraph.started.state === 'absent') {
    return phaseGraph.result.state === 'absent' && bothAbsent ? 'never-started' : 'ambiguous';
  }
  if (phaseGraph.prepared.state !== 'valid' || phaseGraph.claim.state !== 'valid'
    || phaseGraph.started.state !== 'valid') return 'ambiguous';
  if (bothAbsent) return resultOutcome === 'success' ? 'ambiguous' : 'absent-after-start';
  if (phaseGraph.result.state === 'valid'
    && (resultVersionId === null || resultVersionId !== observationA.versionId
      || resultVersionId !== observationB.versionId)) return 'ambiguous';
  return sameExactObservation(observationA, observationB) ? 'exact-recovered' : 'ambiguous';
}

export function validateBootstrapStatusRecord(record, { expected = {} } = {}) {
  if (!exactKeys(record, STATUS_KEYS) || record.schemaVersion !== 1
    || record.contract !== 'dwnc-cloudflare-deny-bootstrap-status-v1'
    || !['never-started', 'absent-after-start', 'exact-recovered', 'ambiguous']
      .includes(record.classification)
    || record.resultOutcome !== null
      && !['success', 'exit-nonzero', 'signal', 'timeout', 'spawn-error']
        .includes(record.resultOutcome)
    || record.resultVersionId !== null && !UUID.test(record.resultVersionId)
    || ![record.recoveryRunnerMetadataSha256, record.recoveryRunnerPreflightSha256,
      record.recoveryRunnerPermissionSha256].every((value) => SHA256.test(value ?? ''))
    || !exactKeys(record.phaseGraph, PHASE_GRAPH_KEYS)
    || !exactKeys(record.authenticationRequestCounts, REQUEST_COUNT_KEYS)
    || !exactKeys(record.stateRequestCounts, REQUEST_COUNT_KEYS)
    || !exactKeys(record.requestCounts, REQUEST_COUNT_KEYS)
    || ![...Object.values(record.authenticationRequestCounts),
      ...Object.values(record.stateRequestCounts), ...Object.values(record.requestCounts)]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
    || [...REQUEST_COUNT_KEYS.filter((key) => key !== 'GET')].some((key) =>
      record.authenticationRequestCounts[key] !== 0 || record.stateRequestCounts[key] !== 0
      || record.requestCounts[key] !== 0)
    || record.wranglerInvocations !== 0
    || !ISO_INSTANT.test(record.observedAt ?? '')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  }
  validateBootstrapAttemptIdentity(record, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  for (const value of Object.values(record.phaseGraph)) validateBootstrapPhaseState(value);
  validateBootstrapRecoveryObservation(record.observationA, { expected: {
    denyWorkerSha256: record.observationA.state === 'present-exact'
      ? bootstrapDenyWorkerSha256() : record.observationA.denyWorkerSha256,
    settingsPolicySha256: record.observationA.state === 'present-exact'
      ? bootstrapSettingsPolicySha256() : record.observationA.settingsPolicySha256,
  } });
  validateBootstrapRecoveryObservation(record.observationB, { expected: {
    denyWorkerSha256: record.observationB.state === 'present-exact'
      ? bootstrapDenyWorkerSha256() : record.observationB.denyWorkerSha256,
    settingsPolicySha256: record.observationB.state === 'present-exact'
      ? bootstrapSettingsPolicySha256() : record.observationB.settingsPolicySha256,
  } });
  if (record.resultOutcome === null !== (record.phaseGraph.result.state !== 'valid')
    || record.resultVersionId !== null && record.phaseGraph.result.state !== 'valid'
    || record.authenticationRequestCounts.GET !== 0
      && record.authenticationRequestCounts.GET !== 2
    || record.stateRequestCounts.GET !== record.observationA.getCount + record.observationB.getCount
    || record.requestCounts.GET !== record.authenticationRequestCounts.GET
      + record.stateRequestCounts.GET
    || record.classification !== classifyBootstrapStatusSemantics(record)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  }
  bootstrapInstantMilliseconds(record.observedAt, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  validateExpected(record, expected, STATUS_KEYS, 'CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
  return record;
}

export function canonicalBootstrapStatusRecord(record) {
  validateBootstrapStatusRecord(record);
  return canonicalJson(record);
}

export function safeBootstrapErrorCode(error,
  fallback = 'CLOUDFLARE_E_BOOTSTRAP_RECOVERY_AMBIGUOUS') {
  const value = typeof error?.message === 'string' ? error.message : '';
  return SAFE_ERROR.test(value) ? value : fallback;
}
