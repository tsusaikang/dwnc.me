import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';
import {
  STAGING_WORKER_NAME,
  STAGING_WORKERS_DEV_ORIGIN,
} from './staging-smoke-access-policy.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ACCOUNT_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function fail(code) { throw new Error(code); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function parseEnvelope(raw, kind) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { fail('CLOUDFLARE_E_WORKERS_DEV_RESPONSE'); }
  if (!parsed || parsed.success !== true || !Array.isArray(parsed.errors)
    || parsed.errors.length !== 0 || !Array.isArray(parsed.messages)
    || !parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)) {
    fail('CLOUDFLARE_E_WORKERS_DEV_RESPONSE');
  }
  if (kind === 'account') {
    if (!ACCOUNT_SUBDOMAIN.test(parsed.result.subdomain ?? '')) {
      fail('CLOUDFLARE_E_WORKERS_DEV_RESPONSE');
    }
    return { subdomain: parsed.result.subdomain };
  }
  if (kind === 'settings') {
    const observability = parsed.result.observability;
    const logs = observability?.logs;
    if (observability?.enabled !== true || logs?.enabled !== true
      || logs?.head_sampling_rate !== 1 || logs?.invocation_logs !== false
      || logs?.persist !== true) fail('CLOUDFLARE_E_WORKERS_DEV_RESPONSE');
    return {
      observabilityEnabled: observability.enabled,
      logsEnabled: logs.enabled,
      logsHeadSamplingRate: logs.head_sampling_rate,
      invocationLogs: logs.invocation_logs,
      logsPersist: logs.persist,
    };
  }
  if (typeof parsed.result.enabled !== 'boolean'
    || typeof parsed.result.previews_enabled !== 'boolean') {
    fail('CLOUDFLARE_E_WORKERS_DEV_RESPONSE');
  }
  return { enabled: parsed.result.enabled, previewUrlsEnabled: parsed.result.previews_enabled };
}

export function workersDevMutationRequestSha256({ accountIdSha256 }) {
  if (!SHA256.test(accountIdSha256 ?? '')) fail('CLOUDFLARE_E_WORKERS_DEV_REQUEST');
  return sha256Hex(canonicalJson({
    method: 'POST',
    environment: 'staging',
    workerName: STAGING_WORKER_NAME,
    accountIdSha256,
    resource: 'workers-script-subdomain-v1',
    body: { enabled: true, previews_enabled: false },
    apiDate: '2025-08-01',
  }));
}

export function canonicalWorkersDevStatusPayload(evidence) { return canonicalJson(evidence); }

export function validateWorkersDevStatus(evidence, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 300,
} = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'origin', 'enabled', 'previewUrlsEnabled', 'accountSubdomainSha256',
    'scriptSubdomainSha256', 'scriptSettingsSha256', 'observabilityEnabled',
    'logsEnabled', 'logsHeadSamplingRate', 'invocationLogs', 'logsPersist',
    'observedAt', 'expiresAt'];
  if (!exactKeys(evidence, keys) || evidence.schemaVersion !== 1
    || evidence.contract !== 'dwnc-cloudflare-workers-dev-status-v1'
    || evidence.environment !== 'staging' || evidence.workerName !== STAGING_WORKER_NAME
    || !SHA256.test(evidence.accountIdSha256 ?? '')
    || evidence.origin !== STAGING_WORKERS_DEV_ORIGIN
    || typeof evidence.enabled !== 'boolean' || typeof evidence.previewUrlsEnabled !== 'boolean'
    || !SHA256.test(evidence.accountSubdomainSha256 ?? '')
    || !SHA256.test(evidence.scriptSubdomainSha256 ?? '')
    || !SHA256.test(evidence.scriptSettingsSha256 ?? '')
    || evidence.observabilityEnabled !== true || evidence.logsEnabled !== true
    || evidence.logsHeadSamplingRate !== 1 || evidence.invocationLogs !== false
    || evidence.logsPersist !== true
    || Number.isNaN(Date.parse(evidence.observedAt ?? ''))
    || Number.isNaN(Date.parse(evidence.expiresAt ?? ''))) fail('CLOUDFLARE_E_WORKERS_DEV_STATUS');
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || evidence[key] !== value) fail('CLOUDFLARE_E_WORKERS_DEV_STATUS_EXPECTED');
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const observed = Date.parse(evidence.observedAt);
  const expires = Date.parse(evidence.expiresAt);
  if (Number.isNaN(nowMs) || nowMs < observed - 120000 || nowMs >= expires
    || expires <= observed || expires - observed > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_WORKERS_DEV_STATUS_EXPIRED');
  }
  return evidence;
}

export function canonicalWorkersDevStatusCapturePayload(capture) { return canonicalJson(capture); }

export function validateWorkersDevStatusCapture(capture, options = {}) {
  const keys = ['schemaVersion', 'contract', 'accountRawBody', 'accountRawBodySha256',
    'scriptRawBody', 'scriptRawBodySha256', 'settingsRawBody', 'settingsRawBodySha256',
    'evidence'];
  if (!exactKeys(capture, keys) || capture.schemaVersion !== 1
    || capture.contract !== 'dwnc-cloudflare-workers-dev-status-capture-v1'
    || typeof capture.accountRawBody !== 'string' || typeof capture.scriptRawBody !== 'string'
    || typeof capture.settingsRawBody !== 'string'
    || Buffer.byteLength(capture.accountRawBody) > 1024 * 1024
    || Buffer.byteLength(capture.scriptRawBody) > 1024 * 1024
    || Buffer.byteLength(capture.settingsRawBody) > 1024 * 1024
    || sha256Hex(capture.accountRawBody) !== capture.accountRawBodySha256
    || sha256Hex(capture.scriptRawBody) !== capture.scriptRawBodySha256
    || sha256Hex(capture.settingsRawBody) !== capture.settingsRawBodySha256) {
    fail('CLOUDFLARE_E_WORKERS_DEV_STATUS_CAPTURE');
  }
  const account = parseEnvelope(capture.accountRawBody, 'account');
  const script = parseEnvelope(capture.scriptRawBody, 'script');
  const settings = parseEnvelope(capture.settingsRawBody, 'settings');
  validateWorkersDevStatus(capture.evidence, options);
  const origin = `https://${STAGING_WORKER_NAME}.${account.subdomain}.workers.dev`;
  if (origin !== capture.evidence.origin
    || script.enabled !== capture.evidence.enabled
    || script.previewUrlsEnabled !== capture.evidence.previewUrlsEnabled
    || capture.accountRawBodySha256 !== capture.evidence.accountSubdomainSha256
    || capture.scriptRawBodySha256 !== capture.evidence.scriptSubdomainSha256
    || capture.settingsRawBodySha256 !== capture.evidence.scriptSettingsSha256
    || settings.observabilityEnabled !== capture.evidence.observabilityEnabled
    || settings.logsEnabled !== capture.evidence.logsEnabled
    || settings.logsHeadSamplingRate !== capture.evidence.logsHeadSamplingRate
    || settings.invocationLogs !== capture.evidence.invocationLogs
    || settings.logsPersist !== capture.evidence.logsPersist) {
    fail('CLOUDFLARE_E_WORKERS_DEV_STATUS_CAPTURE');
  }
  return capture;
}

async function fetchEnvelope(url, apiToken, fetchImpl) {
  let response;
  let raw;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    raw = await response.text();
  } catch { fail('CLOUDFLARE_E_WORKERS_DEV_FETCH'); }
  if (response.status !== 200 || typeof raw !== 'string'
    || Buffer.byteLength(raw) > 1024 * 1024) fail('CLOUDFLARE_E_WORKERS_DEV_FETCH');
  return raw;
}

function parseDeploymentList(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT'); }
  const deployments = parsed?.result?.deployments;
  if (parsed?.success !== true || !Array.isArray(parsed.errors) || parsed.errors.length !== 0
    || !Array.isArray(parsed.messages) || !Array.isArray(deployments) || deployments.length < 1) {
    fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT');
  }
  const active = deployments[0];
  if (!UUID.test(active?.id ?? '') || !Array.isArray(active?.versions)
    || ![1, 2].includes(active.versions.length)
    || active.versions.some((entry) => !UUID.test(entry?.version_id ?? '')
      || typeof entry.percentage !== 'number' || entry.percentage <= 0 || entry.percentage > 100)
    || active.versions.reduce((sum, entry) => sum + entry.percentage, 0) !== 100) {
    fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT');
  }
  return {
    deploymentId: active.id,
    versions: active.versions.map((entry) => ({
      versionId: entry.version_id,
      percentage: entry.percentage,
    })),
  };
}

export function canonicalWorkersDevActiveDeploymentCapturePayload(capture) {
  return canonicalJson(capture);
}

export function validateWorkersDevActiveDeploymentCapture(capture, { expected = {} } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'rawBody', 'rawBodySha256', 'deploymentId', 'versions', 'observedAt'];
  if (!exactKeys(capture, keys) || capture.schemaVersion !== 1
    || capture.contract !== 'dwnc-cloudflare-active-deployment-capture-v1'
    || capture.environment !== 'staging' || capture.workerName !== STAGING_WORKER_NAME
    || !SHA256.test(capture.accountIdSha256 ?? '') || typeof capture.rawBody !== 'string'
    || Buffer.byteLength(capture.rawBody) > 1024 * 1024
    || sha256Hex(capture.rawBody) !== capture.rawBodySha256
    || !UUID.test(capture.deploymentId ?? '') || !Array.isArray(capture.versions)
    || ![1, 2].includes(capture.versions.length)
    || capture.versions.some((entry) => !exactKeys(entry, ['versionId', 'percentage'])
      || !UUID.test(entry.versionId ?? '') || typeof entry.percentage !== 'number'
      || entry.percentage <= 0 || entry.percentage > 100)
    || capture.versions.reduce((sum, entry) => sum + entry.percentage, 0) !== 100
    || Number.isNaN(Date.parse(capture.observedAt ?? ''))) {
    fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT');
  }
  const parsed = parseDeploymentList(capture.rawBody);
  if (parsed.deploymentId !== capture.deploymentId
    || canonicalJson(parsed.versions) !== canonicalJson(capture.versions)) {
    fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'versionId') {
      if (capture.versions.length !== 1 || capture.versions[0].versionId !== value
        || capture.versions[0].percentage !== 100) {
        fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT_CAS');
      }
    } else if (!keys.includes(key) || capture[key] !== value) {
      fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT_CAS');
    }
  }
  return capture;
}

export async function fetchWorkersDevActiveDeploymentCapture({
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length === 0 || apiToken.length > 4096
    || typeof fetchImpl !== 'function') fail('CLOUDFLARE_E_WORKERS_DEV_REQUEST');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${STAGING_WORKER_NAME}/deployments`;
  const rawBody = await fetchEnvelope(url, apiToken, fetchImpl);
  const active = parseDeploymentList(rawBody);
  const observed = now();
  if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
    fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT');
  }
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-active-deployment-capture-v1',
    environment: 'staging',
    workerName: STAGING_WORKER_NAME,
    accountIdSha256: cloudflareAccountIdSha256(accountId.toLowerCase()),
    rawBody,
    rawBodySha256: sha256Hex(rawBody),
    ...active,
    observedAt: observed.toISOString(),
  };
  return validateWorkersDevActiveDeploymentCapture(capture);
}

function exactApprovedDeployment(capture, expectedVersionId, expectedDeploymentId) {
  return capture.deploymentId === expectedDeploymentId
    && capture.versions.length === 1
    && capture.versions[0].versionId === expectedVersionId
    && capture.versions[0].percentage === 100;
}

export async function fetchWorkersDevStatusCapture({
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  ttlSeconds = 300,
}) {
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length === 0 || apiToken.length > 4096
    || typeof fetchImpl !== 'function' || !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < 15 || ttlSeconds > 300) fail('CLOUDFLARE_E_WORKERS_DEV_REQUEST');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const [accountRawBody, scriptRawBody, settingsRawBody] = await Promise.all([
    fetchEnvelope(`${base}/subdomain`, apiToken, fetchImpl),
    fetchEnvelope(`${base}/scripts/${STAGING_WORKER_NAME}/subdomain`, apiToken, fetchImpl),
    fetchEnvelope(`${base}/scripts/${STAGING_WORKER_NAME}/settings`, apiToken, fetchImpl),
  ]);
  const account = parseEnvelope(accountRawBody, 'account');
  const script = parseEnvelope(scriptRawBody, 'script');
  const settings = parseEnvelope(settingsRawBody, 'settings');
  const observed = now();
  if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
    fail('CLOUDFLARE_E_WORKERS_DEV_RESPONSE');
  }
  const evidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-workers-dev-status-v1',
    environment: 'staging',
    workerName: STAGING_WORKER_NAME,
    accountIdSha256: cloudflareAccountIdSha256(accountId.toLowerCase()),
    origin: `https://${STAGING_WORKER_NAME}.${account.subdomain}.workers.dev`,
    enabled: script.enabled,
    previewUrlsEnabled: script.previewUrlsEnabled,
    accountSubdomainSha256: sha256Hex(accountRawBody),
    scriptSubdomainSha256: sha256Hex(scriptRawBody),
    scriptSettingsSha256: sha256Hex(settingsRawBody),
    ...settings,
    observedAt: observed.toISOString(),
    expiresAt: new Date(observed.getTime() + ttlSeconds * 1000).toISOString(),
  };
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-workers-dev-status-capture-v1',
    accountRawBody,
    accountRawBodySha256: evidence.accountSubdomainSha256,
    scriptRawBody,
    scriptRawBodySha256: evidence.scriptSubdomainSha256,
    settingsRawBody,
    settingsRawBodySha256: evidence.scriptSettingsSha256,
    evidence,
  };
  validateWorkersDevStatusCapture(capture, { now: observed });
  return capture;
}

export function canonicalWorkersDevEnableAuthorizationPayload(receipt) { return canonicalJson(receipt); }

export function validateWorkersDevEnableAuthorization(receipt, {
  expected = {}, now = new Date(),
} = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'originSha256', 'versionId', 'deploymentStatusSha256', 'beforeStatusSha256',
    'mutationRequestSha256', 'buildUuid', 'nonceSha256', 'createdAt', 'expiresAt'];
  if (!exactKeys(receipt, keys) || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-workers-dev-enable-authorization-v1'
    || receipt.environment !== 'staging' || receipt.workerName !== STAGING_WORKER_NAME
    || ![receipt.accountIdSha256, receipt.originSha256, receipt.deploymentStatusSha256,
      receipt.beforeStatusSha256, receipt.mutationRequestSha256, receipt.nonceSha256]
      .every((value) => SHA256.test(value ?? ''))
    || receipt.originSha256 !== sha256Hex(STAGING_WORKERS_DEV_ORIGIN)
    || receipt.mutationRequestSha256 !== workersDevMutationRequestSha256(receipt)
    || !UUID.test(receipt.versionId ?? '') || !UUID.test(receipt.buildUuid ?? '')
    || Number.isNaN(Date.parse(receipt.createdAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) {
    fail('CLOUDFLARE_E_WORKERS_DEV_AUTHORIZATION');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_WORKERS_DEV_AUTHORIZATION_EXPECTED');
    }
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const created = Date.parse(receipt.createdAt);
  const expires = Date.parse(receipt.expiresAt);
  if (Number.isNaN(nowMs) || nowMs < created - 120000 || nowMs >= expires
    || expires <= created || expires - created > 10 * 60 * 1000) {
    fail('CLOUDFLARE_E_WORKERS_DEV_AUTHORIZATION_EXPIRED');
  }
  return receipt;
}

export async function enableWorkersDevAndReadBack({
  accountId,
  apiToken,
  expectedVersionId,
  expectedDeploymentId,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length === 0 || apiToken.length > 4096
    || !UUID.test(expectedVersionId ?? '') || !UUID.test(expectedDeploymentId ?? '')
    || typeof fetchImpl !== 'function') fail('CLOUDFLARE_E_WORKERS_DEV_REQUEST');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${STAGING_WORKER_NAME}/subdomain`;
  const deploymentBefore = await fetchWorkersDevActiveDeploymentCapture({
    accountId, apiToken, fetchImpl, now,
  });
  if (!exactApprovedDeployment(deploymentBefore, expectedVersionId, expectedDeploymentId)) {
    fail('CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT_CAS');
  }
  let mutationResult = 'failed';
  let mutationHttpStatus = null;
  let mutationRawBody = null;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        'cloudflare-workers-script-api-date': '2025-08-01',
      },
      body: canonicalJson({ enabled: true, previews_enabled: false }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    mutationHttpStatus = response.status;
    mutationRawBody = await response.text();
    if (response.status === 200 && Buffer.byteLength(mutationRawBody) <= 1024 * 1024) {
      const result = parseEnvelope(mutationRawBody, 'script');
      if (result.enabled === true && result.previewUrlsEnabled === false) mutationResult = 'succeeded';
    }
  } catch {
    mutationResult = 'failed';
  }
  const deploymentAfter = await fetchWorkersDevActiveDeploymentCapture({
    accountId, apiToken, fetchImpl, now,
  });
  const deploymentUnchanged = exactApprovedDeployment(
    deploymentAfter, expectedVersionId, expectedDeploymentId,
  );
  const after = await fetchWorkersDevStatusCapture({ accountId, apiToken, fetchImpl, now });
  const classification = deploymentUnchanged
    && after.evidence.enabled === true && after.evidence.previewUrlsEnabled === false
    ? 'committed' : 'ambiguous';
  return {
    mutationResult,
    mutationHttpStatus,
    mutationRawBody,
    mutationRawBodySha256: mutationRawBody === null ? null : sha256Hex(mutationRawBody),
    deploymentBefore,
    deploymentAfter,
    deploymentUnchanged,
    classification,
    after,
  };
}

export function canonicalWorkersDevExecutionCapturePayload(capture) { return canonicalJson(capture); }

export function validateWorkersDevExecutionCapture(capture, {
  expected = {}, now = new Date(),
} = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'authorizationSha256', 'deploymentStatusSha256', 'signedBeforeStatusSha256',
    'approvedVersionId', 'approvedDeploymentId',
    'freshBeforeCaptureSha256', 'freshDeploymentBeforeCaptureSha256',
    'freshDeploymentAfterCaptureSha256', 'deploymentBefore', 'deploymentAfter',
    'deploymentUnchanged', 'mutationRequestSha256', 'mutationResult',
    'mutationHttpStatus', 'mutationRawBody', 'mutationRawBodySha256', 'classification',
    'afterCaptureSha256', 'after', 'completedAt'];
  if (!exactKeys(capture, keys) || capture.schemaVersion !== 1
    || capture.contract !== 'dwnc-cloudflare-workers-dev-enable-execution-v1'
    || capture.environment !== 'staging' || capture.workerName !== STAGING_WORKER_NAME
    || ![capture.accountIdSha256, capture.authorizationSha256,
      capture.deploymentStatusSha256, capture.signedBeforeStatusSha256,
      capture.freshBeforeCaptureSha256, capture.freshDeploymentBeforeCaptureSha256,
      capture.freshDeploymentAfterCaptureSha256, capture.mutationRequestSha256,
      capture.afterCaptureSha256].every((value) => SHA256.test(value ?? ''))
    || !UUID.test(capture.approvedVersionId ?? '') || !UUID.test(capture.approvedDeploymentId ?? '')
    || !['succeeded', 'failed'].includes(capture.mutationResult)
    || capture.mutationHttpStatus !== null && (!Number.isInteger(capture.mutationHttpStatus)
      || capture.mutationHttpStatus < 100 || capture.mutationHttpStatus > 599)
    || (capture.mutationRawBody === null) !== (capture.mutationRawBodySha256 === null)
    || capture.mutationRawBody !== null && (typeof capture.mutationRawBody !== 'string'
      || Buffer.byteLength(capture.mutationRawBody) > 1024 * 1024
      || sha256Hex(capture.mutationRawBody) !== capture.mutationRawBodySha256)
    || typeof capture.deploymentUnchanged !== 'boolean'
    || !['committed', 'ambiguous'].includes(capture.classification)
    || sha256Hex(canonicalWorkersDevStatusCapturePayload(capture.after)) !== capture.afterCaptureSha256
    || Number.isNaN(Date.parse(capture.completedAt ?? ''))) {
    fail('CLOUDFLARE_E_WORKERS_DEV_EXECUTION');
  }
  validateWorkersDevStatusCapture(capture.after, {
    expected: { accountIdSha256: capture.accountIdSha256 }, now,
  });
  validateWorkersDevActiveDeploymentCapture(capture.deploymentBefore, {
    expected: { accountIdSha256: capture.accountIdSha256 },
  });
  validateWorkersDevActiveDeploymentCapture(capture.deploymentAfter, {
    expected: { accountIdSha256: capture.accountIdSha256 },
  });
  if (sha256Hex(canonicalWorkersDevActiveDeploymentCapturePayload(capture.deploymentBefore))
      !== capture.freshDeploymentBeforeCaptureSha256
    || sha256Hex(canonicalWorkersDevActiveDeploymentCapturePayload(capture.deploymentAfter))
      !== capture.freshDeploymentAfterCaptureSha256
    || capture.deploymentUnchanged !== (capture.deploymentBefore.deploymentId
      === capture.approvedDeploymentId
      && capture.deploymentAfter.deploymentId === capture.approvedDeploymentId
      && capture.deploymentBefore.versions.length === 1
      && capture.deploymentAfter.versions.length === 1
      && capture.deploymentBefore.versions[0].versionId === capture.approvedVersionId
      && capture.deploymentAfter.versions[0].versionId === capture.approvedVersionId
      && capture.deploymentBefore.versions[0].percentage === 100
      && capture.deploymentAfter.versions[0].percentage === 100)) {
    fail('CLOUDFLARE_E_WORKERS_DEV_EXECUTION');
  }
  if (capture.classification === 'committed'
    && (!capture.deploymentUnchanged || capture.after.evidence.enabled !== true
      || capture.after.evidence.previewUrlsEnabled !== false)
    || capture.classification === 'ambiguous'
      && capture.deploymentUnchanged
      && capture.after.evidence.enabled === true
      && capture.after.evidence.previewUrlsEnabled === false) {
    fail('CLOUDFLARE_E_WORKERS_DEV_EXECUTION');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || capture[key] !== value) fail('CLOUDFLARE_E_WORKERS_DEV_EXECUTION_EXPECTED');
  }
  return capture;
}
