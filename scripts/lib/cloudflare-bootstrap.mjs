import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import {
  canonicalJson,
  createPromotionGenesisState,
  sha256Hex,
} from './cloudflare-release.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';
import { assertCloudflareAccountTargetOutsideRepository } from './cloudflare-account-target.mjs';
import {
  parseCanonicalEvidenceStorage,
  readSecureFile,
} from './cloudflare-signing-key.mjs';
import {
  bootstrapRequestTargetSha256,
  fetchBootstrapGet,
  MAX_BOOTSTRAP_REQUEST_DURATION_MS,
  MAX_BOOTSTRAP_RESPONSE_BYTES,
  parseBootstrapJsonBytes,
  validateBootstrapResponseDescriptor,
} from './cloudflare-bootstrap-http.mjs';

const fail = (code) => { throw new Error(code); };
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA1 = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ACCOUNT_SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_CONTROL_PLANE_BODY_BYTES = MAX_BOOTSTRAP_RESPONSE_BYTES;
const MAX_POST_STATE_DURATION_MS = 30_000;
const MAX_DOUBLE_SNAPSHOT_DURATION_MS = 60_000;
const MAX_POST_STATE_AGE_MS = 15_000;
const MAX_FUTURE_SKEW_MS = 2_000;

export const EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN = 'dwnc';
export const BOOTSTRAP_OBSERVABILITY = Object.freeze({
  enabled: true,
  head_sampling_rate: 1,
  logs: Object.freeze({
    enabled: true,
    head_sampling_rate: 1,
    invocation_logs: false,
    persist: true,
    destinations: Object.freeze([]),
  }),
  traces: Object.freeze({
    enabled: false,
    head_sampling_rate: 1,
    persist: true,
    destinations: Object.freeze([]),
  }),
});

export const DENY_ALL_WORKER_SOURCE = `export default {\n  async fetch() {\n    return new Response("Not found.\\n", { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });\n  }\n};\n`;

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

function parseSuccessEnvelopeValue(parsed, kind) {
  if (!parsed || parsed.success !== true || !Array.isArray(parsed.errors)
    || parsed.errors.length !== 0 || !Array.isArray(parsed.messages)
    || !parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)) {
    fail(`CLOUDFLARE_E_BOOTSTRAP_${kind}_RESPONSE`);
  }
  return parsed.result;
}

function parseAccountSubdomain(rawBody, errorCode) {
  let parsed;
  try { parsed = JSON.parse(rawBody); }
  catch { fail(`CLOUDFLARE_E_BOOTSTRAP_${errorCode}_RESPONSE`); }
  return parseAccountSubdomainValue(parsed, errorCode);
}

function parseAccountSubdomainValue(parsed, errorCode) {
  const result = parseSuccessEnvelopeValue(parsed, errorCode);
  if (!exactKeys(result, ['subdomain'])
    || !ACCOUNT_SUBDOMAIN.test(result.subdomain ?? '')
    || result.subdomain !== EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN) {
    fail(`CLOUDFLARE_E_BOOTSTRAP_${errorCode}_RESPONSE`);
  }
  return result.subdomain;
}

function parseScriptSubdomainValue(parsed) {
  const result = parseSuccessEnvelopeValue(parsed, 'POST_STATE');
  if (!exactKeys(result, ['enabled', 'previews_enabled'])
    || result.enabled !== false || result.previews_enabled !== false) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_RESPONSE');
  }
  return { workersDevEnabled: false, previewsEnabled: false };
}

function optionalEmptyArray(value) {
  return value === undefined || value === null || Array.isArray(value) && value.length === 0;
}

function optionalUnitSampling(value) {
  return value === undefined || value === null || value === 1;
}

function parseScriptSettingsValue(parsed) {
  const result = parseSuccessEnvelopeValue(parsed, 'POST_STATE');
  const allowedResultKeys = ['logpush', 'tail_consumers', 'tags', 'observability'];
  const observability = result.observability;
  const logs = observability?.logs;
  const traces = observability?.traces;
  const allowedObservabilityKeys = [
    'enabled', 'head_sampling_rate', 'logs', 'redact_query_string', 'traces',
  ];
  const allowedLogsKeys = ['enabled', 'head_sampling_rate', 'invocation_logs', 'persist', 'destinations'];
  const allowedTracesKeys = [
    'enabled', 'head_sampling_rate', 'persist', 'destinations', 'propagation_policy',
  ];
  if (Object.keys(result).some((key) => !allowedResultKeys.includes(key))
    || result.logpush !== undefined && result.logpush !== false
    || !optionalEmptyArray(result.tail_consumers) || !optionalEmptyArray(result.tags)
    || !observability || typeof observability !== 'object' || Array.isArray(observability)
    || Object.keys(observability).some((key) => !allowedObservabilityKeys.includes(key))
    || observability?.enabled !== BOOTSTRAP_OBSERVABILITY.enabled
    || !optionalUnitSampling(observability.head_sampling_rate)
    || observability.redact_query_string !== undefined
      && observability.redact_query_string !== false
    || !logs || typeof logs !== 'object' || Array.isArray(logs)
    || Object.keys(logs).some((key) => !allowedLogsKeys.includes(key))
    || logs?.enabled !== BOOTSTRAP_OBSERVABILITY.logs.enabled
    || !optionalUnitSampling(logs?.head_sampling_rate)
    || logs?.invocation_logs !== BOOTSTRAP_OBSERVABILITY.logs.invocation_logs
    || logs?.persist !== undefined && logs.persist !== BOOTSTRAP_OBSERVABILITY.logs.persist
    || !optionalEmptyArray(logs.destinations)
    || traces !== undefined && traces !== null
      && (typeof traces !== 'object' || Array.isArray(traces)
      || Object.keys(traces).some((key) => !allowedTracesKeys.includes(key))
      || traces.enabled !== undefined && traces.enabled !== false
      || !optionalUnitSampling(traces.head_sampling_rate)
      || traces.persist !== undefined && traces.persist !== true
      || !optionalEmptyArray(traces.destinations)
      || traces.propagation_policy !== undefined && traces.propagation_policy !== null)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_RESPONSE');
  }
  const normalized = {
    logpush: false,
    tailConsumers: [],
    tags: [],
    observabilityEnabled: observability.enabled,
    observabilityHeadSamplingRate: observability.head_sampling_rate ?? 1,
    redactQueryString: observability.redact_query_string ?? false,
    logsEnabled: logs.enabled,
    logsHeadSamplingRate: logs.head_sampling_rate ?? 1,
    invocationLogs: logs.invocation_logs,
    logsPersist: logs.persist ?? true,
    logsDestinations: [],
    tracesEnabled: false,
    tracesHeadSamplingRate: traces?.head_sampling_rate ?? 1,
    tracesPersist: traces?.persist ?? true,
    tracesDestinations: [],
    tracesPropagationPolicy: traces?.propagation_policy ?? null,
  };
  return { ...normalized, settingsPolicySha256: sha256Hex(canonicalJson(normalized)) };
}

export function bootstrapWorkerName(environment) {
  if (environment === 'production') return 'dwnc-me';
  if (environment === 'staging') return 'dwnc-me-staging';
  fail('CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT');
}

export function serviceExistenceRequestSha256({ environment, accountIdSha256 }) {
  const workerName = bootstrapWorkerName(environment);
  if (!SHA256.test(accountIdSha256 ?? '')) fail('CLOUDFLARE_E_SERVICE_EXISTENCE_REQUEST');
  return sha256Hex(canonicalJson({
    method: 'GET', environment, workerName, accountIdSha256,
    resource: 'cloudflare-workers-service-existence-v1',
  }));
}

export async function fetchServiceExistenceCapture({
  environment,
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  ttlSeconds = 300,
}) {
  const workerName = bootstrapWorkerName(environment);
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length === 0 || apiToken.length > 4096
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 15 || ttlSeconds > 300
    || typeof fetchImpl !== 'function') fail('CLOUDFLARE_E_SERVICE_EXISTENCE_REQUEST');
  const accountIdSha256 = cloudflareAccountIdSha256(accountId.toLowerCase());
  const requestSha256 = serviceExistenceRequestSha256({ environment, accountIdSha256 });
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${workerName}`;
  const fetched = await fetchBootstrapGet({
    url, apiToken, role: 'service-existence', environment, workerName, accountIdSha256,
    expectedStatuses: [200, 404], bodyKind: 'json', fetchImpl, now,
    errorCode: 'CLOUDFLARE_E_SERVICE_EXISTENCE_FETCH',
  });
  try {
  const rawBody = fetched.text;
  const parsed = fetched.json;
  if (!Buffer.from(rawBody, 'utf8').equals(fetched.bytes)) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_RESPONSE');
  }
  const notFoundCodes = new Set([10007, 10090]);
  const missing = fetched.descriptor.httpStatus === 404
    && parsed?.success === false && parsed?.result === null
    && Array.isArray(parsed?.errors) && parsed.errors.length > 0
    && parsed.errors.every((error) => notFoundCodes.has(error?.code));
  const exists = fetched.descriptor.httpStatus === 200
    && parsed?.success === true && parsed?.result !== null;
  if (!missing && !exists) fail('CLOUDFLARE_E_SERVICE_EXISTENCE_RESPONSE');
  const observedAt = new Date(fetched.descriptor.requestCompletedAt);
  const evidence = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-service-existence-v1', environment,
    workerName, accountIdSha256, exists, httpStatus: fetched.descriptor.httpStatus,
    rawEvidenceSha256: fetched.descriptor.decodedBodySha256,
    requestStartedAt: fetched.descriptor.requestStartedAt,
    requestCompletedAt: fetched.descriptor.requestCompletedAt,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
  validateServiceExistenceEvidence(evidence, { now: observedAt });
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-service-existence-capture-v1',
    requestSha256,
    rawBodySha256: fetched.descriptor.decodedBodySha256,
    rawBody,
    responseDescriptor: fetched.descriptor,
    evidence,
  };
  validateServiceExistenceCapture(capture, { now: observedAt, maxAgeSeconds: ttlSeconds });
  await assertBootstrapCaptureHasNoSensitiveValues(capture, { accountId, apiToken });
  return capture;
  } finally { fetched.bytes.fill(0); }
}

export function accountWorkersDevSubdomainRequestSha256({ environment, accountIdSha256 }) {
  const workerName = bootstrapWorkerName(environment);
  if (!SHA256.test(accountIdSha256 ?? '')) {
    fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_REQUEST');
  }
  return sha256Hex(canonicalJson({
    method: 'GET',
    environment,
    workerName,
    accountIdSha256,
    expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    resource: 'cloudflare-account-workers-dev-subdomain-v1',
  }));
}

export async function fetchAccountWorkersDevSubdomainCapture({
  environment,
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  ttlSeconds = 300,
}) {
  const workerName = bootstrapWorkerName(environment);
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length === 0 || apiToken.length > 4096
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 15 || ttlSeconds > 300
    || typeof fetchImpl !== 'function') fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_REQUEST');
  const accountIdSha256 = cloudflareAccountIdSha256(accountId.toLowerCase());
  const requestSha256 = accountWorkersDevSubdomainRequestSha256({ environment, accountIdSha256 });
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
  const fetched = await fetchBootstrapGet({
    url, apiToken, role: 'account-workers-dev-subdomain', environment, workerName,
    accountIdSha256, expectedStatuses: [200], bodyKind: 'json', fetchImpl, now,
    errorCode: 'CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_FETCH',
  });
  try {
  const rawBody = fetched.text;
  if (!Buffer.from(rawBody, 'utf8').equals(fetched.bytes)) {
    fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_RESPONSE');
  }
  const accountSubdomain = parseAccountSubdomainValue(fetched.json, 'ACCOUNT_SUBDOMAIN');
  const observedAt = new Date(fetched.descriptor.requestCompletedAt);
  const evidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-account-workers-dev-subdomain-v1',
    environment,
    workerName,
    accountIdSha256,
    accountSubdomain,
    origin: `https://${workerName}.${accountSubdomain}.workers.dev`,
    rawEvidenceSha256: fetched.descriptor.decodedBodySha256,
    requestStartedAt: fetched.descriptor.requestStartedAt,
    requestCompletedAt: fetched.descriptor.requestCompletedAt,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
  validateAccountWorkersDevSubdomainEvidence(evidence, { now: observedAt });
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-account-workers-dev-subdomain-capture-v1',
    requestSha256,
    rawBodySha256: fetched.descriptor.decodedBodySha256,
    rawBody,
    responseDescriptor: fetched.descriptor,
    evidence,
  };
  validateAccountWorkersDevSubdomainCapture(capture, {
    now: observedAt, maxAgeSeconds: ttlSeconds,
  });
  await assertBootstrapCaptureHasNoSensitiveValues(capture, { accountId, apiToken });
  return capture;
  } finally { fetched.bytes.fill(0); }
}

export function bootstrapConfig(environment) {
  return {
    name: bootstrapWorkerName(environment),
    main: './deny-all-worker.js',
    compatibility_date: '2026-08-24',
    workers_dev: false,
    preview_urls: false,
    find_additional_modules: false,
    logpush: false,
    tail_consumers: [],
    observability: BOOTSTRAP_OBSERVABILITY,
  };
}

export function bootstrapArguments({ environment, authorizationSha256 }) {
  bootstrapWorkerName(environment);
  if (!SHA256.test(authorizationSha256 ?? '')) fail('CLOUDFLARE_E_BOOTSTRAP_ARGUMENTS');
  return [
    'deploy', 'deny-all-worker.js', '--no-bundle', '--strict', '--yes',
    '--config', 'wrangler-bootstrap.jsonc',
    '--env-file', 'wrangler-empty.env',
    '--x-provision=false', '--x-auto-create=false',
    '--tag', `dwnc-bootstrap-${authorizationSha256.slice(0, 24)}`,
    '--message', `dwnc-deny-bootstrap:${authorizationSha256}`,
  ];
}

export function canonicalServiceExistenceEvidencePayload(receipt) { return canonicalJson(receipt); }
export function validateServiceExistenceEvidence(receipt, { expected = {}, now = new Date() } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'exists', 'httpStatus', 'rawEvidenceSha256', 'requestStartedAt', 'requestCompletedAt',
    'observedAt', 'expiresAt'];
  if (!receipt || Object.keys(receipt).length !== keys.length
    || Object.keys(receipt).some((key) => !keys.includes(key))
    || receipt.schemaVersion !== 1 || receipt.contract !== 'dwnc-cloudflare-service-existence-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || receipt.workerName !== bootstrapWorkerName(receipt.environment)
    || !SHA256.test(receipt.accountIdSha256 ?? '') || typeof receipt.exists !== 'boolean'
    || ![200, 404].includes(receipt.httpStatus) || receipt.exists !== (receipt.httpStatus === 200)
    || !SHA256.test(receipt.rawEvidenceSha256 ?? '')
    || ![receipt.requestStartedAt, receipt.requestCompletedAt, receipt.observedAt,
      receipt.expiresAt].every((value) => ISO_INSTANT.test(value ?? ''))) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE');
  }
  for (const [key, value] of Object.entries(expected)) if (receipt[key] !== value) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_EXPECTED');
  }
  const observed = Date.parse(receipt.observedAt);
  const started = Date.parse(receipt.requestStartedAt);
  const completed = Date.parse(receipt.requestCompletedAt);
  const expires = Date.parse(receipt.expiresAt);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (Number.isNaN(nowMs) || completed !== observed || completed < started
    || completed - started > MAX_BOOTSTRAP_REQUEST_DURATION_MS
    || nowMs < observed - MAX_FUTURE_SKEW_MS || nowMs >= expires
    || expires <= observed || expires - observed > 5 * 60 * 1000) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_EXPIRED');
  }
  return receipt;
}

export function canonicalServiceExistenceCapturePayload(capture) { return canonicalJson(capture); }
export function validateServiceExistenceCapture(capture, {
  expected = {}, now = new Date(), maxAgeSeconds = 15,
} = {}) {
  const keys = ['schemaVersion', 'contract', 'requestSha256', 'rawBodySha256', 'rawBody',
    'responseDescriptor', 'evidence'];
  if (!capture || Object.keys(capture).length !== keys.length
    || Object.keys(capture).some((key) => !keys.includes(key))
    || capture.schemaVersion !== 1
    || capture.contract !== 'dwnc-cloudflare-service-existence-capture-v1'
    || !SHA256.test(capture.requestSha256 ?? '') || !SHA256.test(capture.rawBodySha256 ?? '')
    || typeof capture.rawBody !== 'string' || Buffer.byteLength(capture.rawBody) > 1024 * 1024
    || sha256Hex(capture.rawBody) !== capture.rawBodySha256
    || capture.rawBodySha256 !== capture.evidence?.rawEvidenceSha256) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE');
  }
  let parsed;
  try { parsed = JSON.parse(capture.rawBody); }
  catch { fail('CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE'); }
  const exactMissing = capture.evidence.exists === false
    && parsed?.success === false && parsed?.result === null
    && Array.isArray(parsed?.errors) && parsed.errors.length > 0
    && parsed.errors.every((error) => [10007, 10090].includes(error?.code));
  const exactPresent = capture.evidence.exists === true
    && parsed?.success === true && parsed?.result !== null;
  if (!exactMissing && !exactPresent) fail('CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE');
  validateServiceExistenceEvidence(capture.evidence, { expected, now });
  validateBootstrapResponseDescriptor(capture.responseDescriptor, { role: 'service-existence' });
  if (capture.requestSha256 !== serviceExistenceRequestSha256({
    environment: capture.evidence.environment,
    accountIdSha256: capture.evidence.accountIdSha256,
  }) || capture.responseDescriptor.requestTargetSha256 !== bootstrapRequestTargetSha256({
    role: 'service-existence', environment: capture.evidence.environment,
    workerName: capture.evidence.workerName,
    accountIdSha256: capture.evidence.accountIdSha256,
  }) || capture.responseDescriptor.decodedBodySha256 !== capture.rawBodySha256
    || capture.responseDescriptor.decodedBodyBytes !== Buffer.byteLength(capture.rawBody)
    || capture.responseDescriptor.httpStatus !== capture.evidence.httpStatus
    || capture.responseDescriptor.requestStartedAt !== capture.evidence.requestStartedAt
    || capture.responseDescriptor.requestCompletedAt !== capture.evidence.requestCompletedAt) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE');
  }
  const age = now.getTime() - Date.parse(capture.evidence.observedAt);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 300
    || age < -MAX_FUTURE_SKEW_MS || age > maxAgeSeconds * 1000) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE_EXPIRED');
  }
  return capture;
}

export function canonicalAccountWorkersDevSubdomainEvidencePayload(receipt) {
  return canonicalJson(receipt);
}

export function validateAccountWorkersDevSubdomainEvidence(receipt, {
  expected = {}, now = new Date(),
} = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'accountSubdomain', 'origin', 'rawEvidenceSha256', 'requestStartedAt',
    'requestCompletedAt', 'observedAt', 'expiresAt'];
  if (!exactKeys(receipt, keys) || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-account-workers-dev-subdomain-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || receipt.workerName !== bootstrapWorkerName(receipt.environment)
    || !SHA256.test(receipt.accountIdSha256 ?? '')
    || receipt.accountSubdomain !== EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN
    || receipt.origin !== `https://${receipt.workerName}.${receipt.accountSubdomain}.workers.dev`
    || !SHA256.test(receipt.rawEvidenceSha256 ?? '')
    || ![receipt.requestStartedAt, receipt.requestCompletedAt, receipt.observedAt,
      receipt.expiresAt].every((value) => ISO_INSTANT.test(value ?? ''))) {
    fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_EXPECTED');
    }
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const observed = Date.parse(receipt.observedAt);
  const started = Date.parse(receipt.requestStartedAt);
  const completed = Date.parse(receipt.requestCompletedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (Number.isNaN(nowMs) || completed !== observed || completed < started
    || completed - started > MAX_BOOTSTRAP_REQUEST_DURATION_MS
    || nowMs < observed - MAX_FUTURE_SKEW_MS || nowMs >= expires
    || expires <= observed || expires - observed > 5 * 60 * 1000) {
    fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_EXPIRED');
  }
  return receipt;
}

export function canonicalAccountWorkersDevSubdomainCapturePayload(capture) {
  return canonicalJson(capture);
}

export function validateAccountWorkersDevSubdomainCapture(capture, {
  expected = {}, now = new Date(), maxAgeSeconds = 15,
} = {}) {
  const keys = ['schemaVersion', 'contract', 'requestSha256', 'rawBodySha256', 'rawBody',
    'responseDescriptor', 'evidence'];
  if (!exactKeys(capture, keys) || capture.schemaVersion !== 1
    || capture.contract !== 'dwnc-cloudflare-account-workers-dev-subdomain-capture-v1'
    || !SHA256.test(capture.requestSha256 ?? '') || !SHA256.test(capture.rawBodySha256 ?? '')
    || typeof capture.rawBody !== 'string'
    || Buffer.byteLength(capture.rawBody) > MAX_CONTROL_PLANE_BODY_BYTES
    || sha256Hex(capture.rawBody) !== capture.rawBodySha256
    || capture.rawBodySha256 !== capture.evidence?.rawEvidenceSha256) {
    fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_CAPTURE');
  }
  let accountSubdomain;
  try { accountSubdomain = parseAccountSubdomain(capture.rawBody, 'ACCOUNT_SUBDOMAIN'); }
  catch { fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_CAPTURE'); }
  validateAccountWorkersDevSubdomainEvidence(capture.evidence, { expected, now });
  validateBootstrapResponseDescriptor(capture.responseDescriptor, {
    role: 'account-workers-dev-subdomain',
  });
  if (accountSubdomain !== capture.evidence.accountSubdomain
    || capture.requestSha256 !== accountWorkersDevSubdomainRequestSha256({
      environment: capture.evidence.environment,
      accountIdSha256: capture.evidence.accountIdSha256,
    }) || capture.responseDescriptor.requestTargetSha256 !== bootstrapRequestTargetSha256({
    role: 'account-workers-dev-subdomain', environment: capture.evidence.environment,
    workerName: capture.evidence.workerName,
    accountIdSha256: capture.evidence.accountIdSha256,
  }) || capture.responseDescriptor.decodedBodySha256 !== capture.rawBodySha256
    || capture.responseDescriptor.decodedBodyBytes !== Buffer.byteLength(capture.rawBody)
    || capture.responseDescriptor.requestStartedAt !== capture.evidence.requestStartedAt
    || capture.responseDescriptor.requestCompletedAt !== capture.evidence.requestCompletedAt) {
    fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_CAPTURE');
  }
  const age = now.getTime() - Date.parse(capture.evidence.observedAt);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 300
    || age < -MAX_FUTURE_SKEW_MS || age > maxAgeSeconds * 1000) {
    fail('CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_CAPTURE_EXPIRED');
  }
  return capture;
}

function multipartBoundary(contentType) {
  if (typeof contentType !== 'string' || contentType.length > 512) {
    fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  }
  const parameters = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index <= contentType.length; index += 1) {
    const character = contentType[index];
    if (index === contentType.length || character === ';' && !quoted) {
      parameters.push(contentType.slice(start, index).trim());
      start = index + 1;
      continue;
    }
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
  }
  if (quoted || parameters.shift()?.toLowerCase() !== 'multipart/form-data') {
    fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  }
  let boundary = null;
  for (const parameter of parameters) {
    const equals = parameter.indexOf('=');
    if (equals < 1) continue;
    const name = parameter.slice(0, equals).trim().toLowerCase();
    if (name !== 'boundary') continue;
    if (boundary !== null) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
    const rawValue = parameter.slice(equals + 1).trim();
    if (rawValue.startsWith('"')) {
      if (!rawValue.endsWith('"') || rawValue.length < 2) {
        fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
      }
      let value = '';
      for (let index = 1; index < rawValue.length - 1; index += 1) {
        if (rawValue[index] === '\\') {
          index += 1;
          if (index >= rawValue.length - 1) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
        }
        value += rawValue[index];
      }
      boundary = value;
    } else boundary = rawValue;
  }
  // RFC 2046 permits these ASCII bchars, with no trailing space and a 70-byte limit.
  if (boundary === null || !/^(?:[0-9A-Za-z'()+_,\-./:=?]|[0-9A-Za-z'()+_,\-./:=?][0-9A-Za-z'()+_,\-./:=? ]{0,68}[0-9A-Za-z'()+_,\-./:=?])$/u
    .test(boundary)) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  return boundary;
}

function normalizeMultipartFraming(rawBody, contentType) {
  const boundary = multipartBoundary(contentType);
  const wire = rawBody.toString('latin1');
  const prefix = `--${boundary}`;
  const delimiters = [];
  for (let index = wire.indexOf(prefix); index >= 0; index = wire.indexOf(prefix, index + 1)) {
    if (index !== 0 && wire.slice(index - 2, index) !== '\r\n') continue;
    let cursor = index + prefix.length;
    let closing = false;
    if (wire.slice(cursor, cursor + 2) === '--') {
      closing = true;
      cursor += 2;
    }
    while (wire[cursor] === ' ' || wire[cursor] === '\t') cursor += 1;
    if (wire.slice(cursor, cursor + 2) === '\r\n') cursor += 2;
    else if (!(closing && cursor === wire.length)) continue;
    delimiters.push({ start: index, end: cursor, closing });
  }
  const first = delimiters.findIndex((delimiter) => !delimiter.closing);
  if (first < 0) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  const closing = delimiters.findIndex((delimiter, index) => index > first && delimiter.closing);
  if (closing < 0) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  const normalized = [];
  let cursor = delimiters[first].start;
  for (let index = first; index <= closing; index += 1) {
    const delimiter = delimiters[index];
    if (delimiter.start < cursor || index < closing && delimiter.closing) {
      fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
    }
    normalized.push(wire.slice(cursor, delimiter.start));
    normalized.push(delimiter.closing ? `${prefix}--\r\n` : `${prefix}\r\n`);
    cursor = delimiter.end;
  }
  return {
    boundary,
    bytes: Buffer.from(normalized.join(''), 'latin1'),
  };
}

function firstMultipartPartMediaType(normalizedBytes, boundary) {
  const prefix = Buffer.from(`--${boundary}\r\n`, 'latin1');
  if (!normalizedBytes.subarray(0, prefix.length).equals(prefix)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  }
  const headerEnd = normalizedBytes.indexOf(Buffer.from('\r\n\r\n', 'latin1'), prefix.length);
  if (headerEnd < 0) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  let headerText;
  try {
    headerText = new TextDecoder('utf-8', { fatal: true })
      .decode(normalizedBytes.subarray(prefix.length, headerEnd));
  } catch { fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT'); }
  const unfolded = headerText.replace(/\r\n[ \t]+/gu, ' ');
  const contentTypes = [];
  for (const line of unfolded.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(line.slice(0, colon))) {
      fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
    }
    if (line.slice(0, colon).toLowerCase() === 'content-type') {
      contentTypes.push(line.slice(colon + 1).trim());
    }
  }
  if (contentTypes.length > 1) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  if (contentTypes.length === 0) return { mediaTypeSource: 'absent', mediaType: null };
  const mediaType = contentTypes[0].split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/javascript+module') {
    fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  }
  return { mediaTypeSource: 'part-header', mediaType };
}

async function parseDenyWorkerMultipart(rawBody, contentType, entrypoint) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0
    || rawBody.length > MAX_CONTROL_PLANE_BODY_BYTES
    || typeof contentType !== 'string' || contentType.length > 512
    || entrypoint !== null && entrypoint !== 'deny-all-worker.js') {
    fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  }
  let form;
  let partMetadata;
  let normalizedBytes;
  try {
    const normalized = normalizeMultipartFraming(rawBody, contentType);
    normalizedBytes = normalized.bytes;
    partMetadata = firstMultipartPartMediaType(normalized.bytes, normalized.boundary);
    const normalizedContentType = `multipart/form-data; boundary="${normalized.boundary}"`;
    form = await new Response(normalized.bytes, {
      headers: { 'content-type': normalizedContentType },
    }).formData();
  } catch { fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT'); }
  finally { normalizedBytes?.fill(0); }
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'deny-all-worker.js') {
    fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  }
  const value = entries[0][1];
  let moduleBytes;
  let filenameSource;
  if (typeof value === 'string') {
    moduleBytes = Buffer.from(value, 'utf8');
    filenameSource = 'absent';
  } else if (value && typeof value.arrayBuffer === 'function') {
    const parsedFileMediaType = String(value.type).split(';', 1)[0].trim().toLowerCase();
    if (value.name !== 'deny-all-worker.js'
      || partMetadata.mediaTypeSource === 'part-header'
        && parsedFileMediaType !== 'application/javascript+module') {
      fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
    }
    moduleBytes = Buffer.from(await value.arrayBuffer());
    filenameSource = 'filename';
  } else fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
  const expectedBytes = Buffer.from(DENY_ALL_WORKER_SOURCE, 'utf8');
  try {
    if (!moduleBytes.equals(expectedBytes)) fail('CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT');
    return {
      denyModuleSha256: sha256Hex(moduleBytes),
      denyModuleBytes: moduleBytes.length,
      entrypointSource: entrypoint === null ? 'single-module-inference' : 'cf-entrypoint',
      mediaTypeSource: partMetadata.mediaTypeSource,
      filenameSource,
    };
  } finally {
    moduleBytes.fill(0);
    expectedBytes.fill(0);
  }
}

function parseVersionDetailValue(parsed, { expectedVersionId, expectedTag, expectedMessage }) {
  const result = parseSuccessEnvelopeValue(parsed, 'POST_STATE');
  const handlers = result.resources?.script?.handlers;
  const bindings = result.resources?.bindings;
  if (result.id !== expectedVersionId || !Array.isArray(handlers)
    || handlers.length !== 1 || handlers[0] !== 'fetch'
    || bindings !== undefined && (!Array.isArray(bindings) || bindings.length !== 0)
    || ![undefined, null].includes(result.resources?.assets)
    || result.annotations?.['workers/tag'] !== expectedTag
    || result.annotations?.['workers/message'] !== expectedMessage) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_RESPONSE');
  }
  return {
    versionId: result.id,
    versionHandlers: ['fetch'],
    bindingsEmpty: true,
    assetsAbsent: true,
    versionTag: expectedTag,
    versionMessage: expectedMessage,
  };
}

function parseDeployableVersionsValue(parsed, expectedVersionId) {
  const result = parseSuccessEnvelopeValue(parsed, 'POST_STATE');
  if (!exactKeys(result, ['items']) || !Array.isArray(result.items)
    || result.items.length !== 1 || result.items[0]?.id !== expectedVersionId) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS');
  }
  return { deployableVersionIds: [expectedVersionId] };
}

function parseDeploymentCandidate(parsed, expectedMessage) {
  const result = parseSuccessEnvelopeValue(parsed, 'POST_STATE');
  if (!Array.isArray(result.deployments) || result.deployments.length !== 1) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS');
  }
  const current = result.deployments[0];
  if (!UUID.test(current?.id ?? '') || current.strategy !== 'percentage'
    || !Array.isArray(current.versions) || current.versions.length !== 1
    || !UUID.test(current.versions[0]?.version_id ?? '')
    || current.versions[0]?.percentage !== 100
    || current.annotations?.['workers/message'] !== expectedMessage) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS');
  }
  return {
    deploymentId: current.id,
    deploymentStrategy: current.strategy,
    deploymentVersions: [{ versionId: current.versions[0].version_id, percentage: 100 }],
    deploymentMessage: expectedMessage,
  };
}

function parseDeploymentValue(parsed, expectedVersionId, expectedMessage) {
  const values = parseDeploymentCandidate(parsed, expectedMessage);
  if (values.deploymentVersions[0].versionId !== expectedVersionId) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS');
  }
  return values;
}

const SNAPSHOT_ROLES = Object.freeze([
  'deployments-before',
  'versions-list',
  'account-workers-dev-subdomain',
  'script-workers-dev-subdomain',
  'script-settings',
  'script-content-v2',
  'version-detail',
  'deployments-after',
]);

function safeCapturedResponse(fetched) {
  return {
    role: fetched.descriptor.role,
    descriptor: fetched.descriptor,
    decodedBodyBase64: fetched.decodedBodyBase64,
    entrypoint: fetched.descriptor.role === 'script-content-v2' ? fetched.entrypoint : null,
  };
}

function snapshotSemantic(values) {
  return {
    accountSubdomain: values.accountSubdomain,
    workersDevEnabled: values.workersDevEnabled,
    previewsEnabled: values.previewsEnabled,
    settingsPolicySha256: values.settingsPolicySha256,
    versionId: values.versionId,
    versionHandlers: values.versionHandlers,
    bindingsEmpty: values.bindingsEmpty,
    assetsAbsent: values.assetsAbsent,
    versionTag: values.versionTag,
    versionMessage: values.versionMessage,
    deployableVersionIds: values.deployableVersionIds,
    deploymentId: values.deploymentId,
    deploymentStrategy: values.deploymentStrategy,
    deploymentVersions: values.deploymentVersions,
    deploymentMessage: values.deploymentMessage,
    denyModuleSha256: values.denyModuleSha256,
    denyModuleBytes: values.denyModuleBytes,
    entrypointSource: values.entrypointSource,
    mediaTypeSource: values.mediaTypeSource,
    filenameSource: values.filenameSource,
  };
}

async function parsedSnapshotValues(responses, expected) {
  const byRole = new Map(responses.map((response) => [response.role, response]));
  if (byRole.size !== SNAPSHOT_ROLES.length) fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
  const decoded = new Map();
  try {
  for (const role of SNAPSHOT_ROLES) {
    const captured = byRole.get(role);
    if (!captured || captured.entrypoint !== null && role !== 'script-content-v2'
      || typeof captured.decodedBodyBase64 !== 'string') {
      fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
    }
    let bytes;
    try { bytes = Buffer.from(captured.decodedBodyBase64, 'base64'); }
    catch { fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE'); }
    if (bytes.length === 0 || bytes.length > MAX_CONTROL_PLANE_BODY_BYTES
      || bytes.toString('base64') !== captured.decodedBodyBase64
      || sha256Hex(bytes) !== captured.descriptor?.decodedBodySha256
      || bytes.length !== captured.descriptor?.decodedBodyBytes) {
      bytes.fill(0);
      fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
    }
    decoded.set(role, bytes);
    validateBootstrapResponseDescriptor(captured.descriptor, { role });
  }
  const json = (role) => parseBootstrapJsonBytes(
    decoded.get(role), byRole.get(role).descriptor.contentType,
    'CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE',
  ).value;
  const accountSubdomain = parseAccountSubdomainValue(
    json('account-workers-dev-subdomain'), 'POST_STATE',
  );
  const scriptValues = parseScriptSubdomainValue(json('script-workers-dev-subdomain'));
  const settingsValues = parseScriptSettingsValue(json('script-settings'));
  const versionValues = parseVersionDetailValue(json('version-detail'), expected);
  const versionListValues = parseDeployableVersionsValue(
    json('versions-list'), expected.expectedVersionId,
  );
  const deploymentBeforeJson = json('deployments-before');
  const deploymentAfterJson = json('deployments-after');
  const deploymentValues = parseDeploymentValue(
    deploymentBeforeJson, expected.expectedVersionId, expected.expectedMessage,
  );
  const deploymentAfterValues = parseDeploymentValue(
    deploymentAfterJson, expected.expectedVersionId, expected.expectedMessage,
  );
  if (canonicalJson(deploymentBeforeJson) !== canonicalJson(deploymentAfterJson)
    || canonicalJson(deploymentValues) !== canonicalJson(deploymentAfterValues)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS');
  }
  const moduleValues = await parseDenyWorkerMultipart(
    decoded.get('script-content-v2'),
    byRole.get('script-content-v2').descriptor.contentType,
    byRole.get('script-content-v2').entrypoint,
  );
  return {
    accountSubdomain,
    ...scriptValues,
    ...settingsValues,
    ...versionValues,
    ...versionListValues,
    ...deploymentValues,
    ...moduleValues,
  };
  } finally {
    for (const bytes of decoded.values()) bytes.fill(0);
  }
}

export async function fetchBootstrapPostStateCapture({
  environment,
  accountId,
  apiToken,
  versionId,
  expectedTag,
  expectedMessage,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const workerName = bootstrapWorkerName(environment);
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length === 0 || apiToken.length > 4096
    || !UUID.test(versionId ?? '')
    || typeof expectedTag !== 'string' || expectedTag.length < 1 || expectedTag.length > 128
    || typeof expectedMessage !== 'string' || expectedMessage.length < 1
    || expectedMessage.length > 256 || typeof fetchImpl !== 'function' || typeof now !== 'function') {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_REQUEST');
  }
  const observationStarted = now();
  if (!(observationStarted instanceof Date) || Number.isNaN(observationStarted.getTime())) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_REQUEST');
  }
  const accountIdSha256 = cloudflareAccountIdSha256(accountId.toLowerCase());
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const common = {
    apiToken, environment, workerName, accountIdSha256, expectedStatuses: [200],
    fetchImpl, now, errorCode: 'CLOUDFLARE_E_BOOTSTRAP_POST_STATE_FETCH',
  };
  const fetched = [];
  try {
    const deploymentBefore = await fetchBootstrapGet({
      ...common, url: `${base}/scripts/${workerName}/deployments`,
      role: 'deployments-before', versionId, bodyKind: 'json',
    });
    fetched.push(deploymentBefore);
    const middleSettled = await Promise.allSettled([
      fetchBootstrapGet({ ...common,
        url: `${base}/scripts/${workerName}/versions?deployable=true`,
        role: 'versions-list', bodyKind: 'json' }),
      fetchBootstrapGet({ ...common, url: `${base}/subdomain`,
        role: 'account-workers-dev-subdomain', bodyKind: 'json' }),
      fetchBootstrapGet({ ...common, url: `${base}/scripts/${workerName}/subdomain`,
        role: 'script-workers-dev-subdomain', bodyKind: 'json' }),
      fetchBootstrapGet({ ...common, url: `${base}/scripts/${workerName}/script-settings`,
        role: 'script-settings', bodyKind: 'json' }),
      fetchBootstrapGet({ ...common, url: `${base}/scripts/${workerName}/content/v2`,
        role: 'script-content-v2', bodyKind: 'multipart' }),
      fetchBootstrapGet({ ...common, url: `${base}/scripts/${workerName}/versions/${versionId}`,
        role: 'version-detail', versionId, bodyKind: 'json' }),
    ]);
    for (const result of middleSettled) if (result.status === 'fulfilled') fetched.push(result.value);
    const rejected = middleSettled.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    const deploymentAfter = await fetchBootstrapGet({
      ...common, url: `${base}/scripts/${workerName}/deployments`,
      role: 'deployments-after', versionId, bodyKind: 'json',
    });
    fetched.push(deploymentAfter);
    const observationCompleted = now();
    if (!(observationCompleted instanceof Date) || Number.isNaN(observationCompleted.getTime())
      || observationCompleted < observationStarted
      || observationCompleted.getTime() - observationStarted.getTime() > MAX_POST_STATE_DURATION_MS) {
      fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_RESPONSE');
    }
    const responses = fetched.map(safeCapturedResponse);
    const values = await parsedSnapshotValues(responses, {
      expectedVersionId: versionId, expectedTag, expectedMessage,
    });
    const semanticStateSha256 = sha256Hex(canonicalJson(snapshotSemantic(values)));
    const responseDescriptorsSha256 = sha256Hex(canonicalJson(
      responses.map((response) => response.descriptor),
    ));
    const evidence = {
    schemaVersion: 2,
    contract: 'dwnc-cloudflare-deny-bootstrap-post-state-v2',
    environment,
    workerName,
    accountIdSha256,
    accountSubdomain: values.accountSubdomain,
    origin: `https://${workerName}.${values.accountSubdomain}.workers.dev`,
    ...values,
    semanticStateSha256,
    responseDescriptorsSha256,
    observationStartedAt: observationStarted.toISOString(),
    observationCompletedAt: observationCompleted.toISOString(),
    observedAt: observationCompleted.toISOString(),
    };
    const capture = {
    schemaVersion: 2,
    contract: 'dwnc-cloudflare-deny-bootstrap-post-state-capture-v2',
    observationStartedAt: evidence.observationStartedAt,
    observationCompletedAt: evidence.observationCompletedAt,
    responses,
    evidence,
    };
    await validateBootstrapPostStateCapture(capture, {
    expected: {
      environment, workerName, accountIdSha256, versionId, versionTag: expectedTag,
      versionMessage: expectedMessage,
    },
    now: observationCompleted,
    });
    return capture;
  } finally {
    for (const response of fetched) response.bytes.fill(0);
  }
}

export function canonicalBootstrapPostStateCapturePayload(capture) { return canonicalJson(capture); }

export async function validateBootstrapPostStateCapture(capture, {
  expected = {}, now = new Date(), maxAgeSeconds = 15,
} = {}) {
  const captureKeys = ['schemaVersion', 'contract', 'observationStartedAt',
    'observationCompletedAt', 'responses', 'evidence'];
  if (!exactKeys(capture, captureKeys) || capture.schemaVersion !== 2
    || capture.contract !== 'dwnc-cloudflare-deny-bootstrap-post-state-capture-v2'
    || !ISO_INSTANT.test(capture.observationStartedAt ?? '')
    || !ISO_INSTANT.test(capture.observationCompletedAt ?? '')
    || !Array.isArray(capture.responses) || capture.responses.length !== SNAPSHOT_ROLES.length
    || capture.responses.some((response, index) => !exactKeys(response,
      ['role', 'descriptor', 'decodedBodyBase64', 'entrypoint'])
      || response.role !== SNAPSHOT_ROLES[index])) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
  }
  const started = Date.parse(capture.observationStartedAt);
  const completed = Date.parse(capture.observationCompletedAt);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (completed < started || completed - started > MAX_POST_STATE_DURATION_MS
    || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 300
    || Number.isNaN(nowMs) || nowMs < completed - MAX_FUTURE_SKEW_MS
    || nowMs - completed > maxAgeSeconds * 1000) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_EXPIRED');
  }
  for (const response of capture.responses) {
    validateBootstrapResponseDescriptor(response.descriptor, {
      role: response.role,
      observationStartedAt: capture.observationStartedAt,
      observationCompletedAt: capture.observationCompletedAt,
    });
  }
  const deploymentBeforeDescriptor = capture.responses[0].descriptor;
  const deploymentAfterDescriptor = capture.responses.at(-1).descriptor;
  const middleDescriptors = capture.responses.slice(1, -1).map((response) => response.descriptor);
  if (middleDescriptors.some((descriptor) =>
    Date.parse(descriptor.requestStartedAt)
      < Date.parse(deploymentBeforeDescriptor.requestCompletedAt)
    || Date.parse(descriptor.requestCompletedAt)
      > Date.parse(deploymentAfterDescriptor.requestStartedAt))) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
  }
  const evidence = capture.evidence;
  const evidenceKeys = [
    'schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'accountSubdomain', 'origin', 'workersDevEnabled', 'previewsEnabled', 'logpush',
    'tailConsumers', 'tags', 'observabilityEnabled', 'observabilityHeadSamplingRate',
    'redactQueryString',
    'logsEnabled', 'logsHeadSamplingRate', 'invocationLogs', 'logsPersist',
    'logsDestinations', 'tracesEnabled', 'tracesHeadSamplingRate', 'tracesPersist',
    'tracesDestinations', 'tracesPropagationPolicy', 'settingsPolicySha256',
    'versionId', 'versionHandlers',
    'bindingsEmpty', 'assetsAbsent', 'versionTag', 'versionMessage', 'deployableVersionIds',
    'deploymentId', 'deploymentStrategy', 'deploymentVersions', 'deploymentMessage',
    'denyModuleSha256', 'denyModuleBytes',
    'entrypointSource', 'mediaTypeSource', 'filenameSource', 'semanticStateSha256',
    'responseDescriptorsSha256', 'observationStartedAt', 'observationCompletedAt', 'observedAt',
  ];
  if (!exactKeys(evidence, evidenceKeys) || evidence.schemaVersion !== 2
    || evidence.contract !== 'dwnc-cloudflare-deny-bootstrap-post-state-v2'
    || !['production', 'staging'].includes(evidence.environment)
    || evidence.workerName !== bootstrapWorkerName(evidence.environment)
    || !SHA256.test(evidence.accountIdSha256 ?? '')
    || evidence.accountSubdomain !== EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN
    || evidence.origin !== `https://${evidence.workerName}.${evidence.accountSubdomain}.workers.dev`
    || evidence.workersDevEnabled !== false || evidence.previewsEnabled !== false
    || evidence.logpush !== false || !Array.isArray(evidence.tailConsumers)
    || evidence.tailConsumers.length !== 0 || !Array.isArray(evidence.tags)
    || evidence.tags.length !== 0 || evidence.observabilityEnabled !== true
    || evidence.observabilityHeadSamplingRate !== 1 || evidence.redactQueryString !== false
    || evidence.logsEnabled !== true
    || evidence.logsHeadSamplingRate !== 1 || evidence.invocationLogs !== false
    || evidence.logsPersist !== true || !Array.isArray(evidence.logsDestinations)
    || evidence.logsDestinations.length !== 0 || evidence.tracesEnabled !== false
    || evidence.tracesHeadSamplingRate !== 1 || evidence.tracesPersist !== true
    || !Array.isArray(evidence.tracesDestinations) || evidence.tracesDestinations.length !== 0
    || evidence.tracesPropagationPolicy !== null
    || ![evidence.settingsPolicySha256, evidence.semanticStateSha256,
      evidence.responseDescriptorsSha256, evidence.denyModuleSha256]
      .every((value) => SHA256.test(value ?? ''))
    || evidence.denyModuleSha256 !== bootstrapDenyWorkerSha256()
    || evidence.denyModuleBytes !== Buffer.byteLength(DENY_ALL_WORKER_SOURCE)
    || !UUID.test(evidence.versionId ?? '') || !UUID.test(evidence.deploymentId ?? '')
    || evidence.deploymentStrategy !== 'percentage'
    || canonicalJson(evidence.deploymentVersions)
      !== canonicalJson([{ versionId: evidence.versionId, percentage: 100 }])
    || canonicalJson(evidence.deployableVersionIds) !== canonicalJson([evidence.versionId])
    || evidence.deploymentMessage !== evidence.versionMessage
    || canonicalJson(evidence.versionHandlers) !== canonicalJson(['fetch'])
    || evidence.bindingsEmpty !== true || evidence.assetsAbsent !== true
    || !['single-module-inference', 'cf-entrypoint'].includes(evidence.entrypointSource)
    || !['absent', 'part-header'].includes(evidence.mediaTypeSource)
    || !['absent', 'filename'].includes(evidence.filenameSource)
    || evidence.observationStartedAt !== capture.observationStartedAt
    || evidence.observationCompletedAt !== capture.observationCompletedAt
    || evidence.observedAt !== capture.observationCompletedAt) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!evidenceKeys.includes(key) || canonicalJson(evidence[key]) !== canonicalJson(value)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_EXPECTED');
    }
  }
  let values;
  try {
    values = await parsedSnapshotValues(capture.responses, {
      expectedVersionId: evidence.versionId,
      expectedTag: evidence.versionTag,
      expectedMessage: evidence.versionMessage,
    });
  } catch { fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE'); }
  if (canonicalJson(snapshotSemantic(values)) !== canonicalJson(snapshotSemantic(evidence))
    || sha256Hex(canonicalJson(snapshotSemantic(values))) !== evidence.semanticStateSha256
    || sha256Hex(canonicalJson(capture.responses.map((response) => response.descriptor)))
      !== evidence.responseDescriptorsSha256) {
    fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
  }
  for (const response of capture.responses) {
    const expectedRequestTarget = bootstrapRequestTargetSha256({
      role: response.role,
      environment: evidence.environment,
      workerName: evidence.workerName,
      accountIdSha256: evidence.accountIdSha256,
      versionId: ['version-detail', 'deployments-before', 'deployments-after']
        .includes(response.role)
        ? evidence.versionId : null,
    });
    if (response.descriptor.requestTargetSha256 !== expectedRequestTarget) {
      fail('CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE');
    }
  }
  return capture;
}

export async function validateBootstrapPostStatePair(before, after, {
  expected = {}, now = new Date(), maxAgeSeconds = 15,
} = {}) {
  await validateBootstrapPostStateCapture(before, { expected, now, maxAgeSeconds });
  await validateBootstrapPostStateCapture(after, { expected, now, maxAgeSeconds });
  const beforeStarted = Date.parse(before.observationStartedAt);
  const beforeCompleted = Date.parse(before.observationCompletedAt);
  const afterStarted = Date.parse(after.observationStartedAt);
  const afterCompleted = Date.parse(after.observationCompletedAt);
  if (beforeCompleted > afterStarted || afterCompleted - beforeStarted > MAX_DOUBLE_SNAPSHOT_DURATION_MS
    || before.evidence.semanticStateSha256 !== after.evidence.semanticStateSha256
    || before.evidence.deploymentId !== after.evidence.deploymentId
    || before.evidence.deploymentStrategy !== after.evidence.deploymentStrategy
    || canonicalJson(before.evidence.deploymentVersions)
      !== canonicalJson(after.evidence.deploymentVersions)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS');
  }
  return { before, after };
}

export function defaultBootstrapProtectedEvidencePaths({
  environment, authorizationSha256, home,
}) {
  bootstrapWorkerName(environment);
  if (!SHA256.test(authorizationSha256 ?? '')) fail('CLOUDFLARE_E_BOOTSTRAP_EVIDENCE_PATH');
  let selectedHome = home;
  if (selectedHome === undefined) {
    try { selectedHome = userInfo().homedir; }
    catch { fail('CLOUDFLARE_E_BOOTSTRAP_EVIDENCE_PATH'); }
  }
  if (typeof selectedHome !== 'string' || !path.isAbsolute(selectedHome)
    || path.resolve(selectedHome) !== selectedHome) fail('CLOUDFLARE_E_BOOTSTRAP_EVIDENCE_PATH');
  const directory = path.join(
    selectedHome, 'Library', 'Application Support', 'dwnc.me', 'stage3', 'bootstrap',
    environment, authorizationSha256,
  );
  const pair = (name) => ({
    primary: path.join(directory, `${name}.json`),
    recovery: path.join(directory, `${name}-recovery.json`),
  });
  return {
    directory,
    prepared: path.join(directory, 'attempt-prepared.json'),
    started: path.join(directory, 'attempt-started.json'),
    result: path.join(directory, 'attempt-result.json'),
    status: pair('attempt-status'),
    freshAbsence: pair('fresh-service-absence'),
    freshAccountSubdomain: pair('fresh-account-subdomain'),
    deployOutput: pair('wrangler-deploy-output'),
    before: pair('post-state-before'),
    after: pair('post-state-after'),
    attestation: pair('attestation-candidate'),
  };
}

function containsPosixAbsolutePath(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '/' || value[index + 1] === '/') continue;
    const previous = index === 0 ? '' : value[index - 1];
    if (previous && /[A-Za-z0-9._~\\/]/u.test(previous)) continue;
    // A single-slash URI such as urn:/value is not a local path. HTTP(S)
    // URLs are already protected by the slash and hostname boundaries above.
    if (/[A-Za-z][A-Za-z0-9+.-]*:$/u.test(value.slice(0, index))) continue;
    return true;
  }
  return false;
}

function containsWindowsAbsolutePath(value) {
  return /(?:^|[^A-Za-z0-9._~\\/])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])/u.test(value);
}

function sensitiveStringScanner(accountId, apiToken) {
  const accountNeedle = accountId.toLowerCase();
  const tokenNeedle = apiToken.toLowerCase();
  return (value) => {
    if (typeof value !== 'string') return;
    const normalized = value.toLowerCase();
    const slashDecoded = value.replaceAll('\\/', '/');
    if (normalized.includes(accountNeedle) || normalized.includes(tokenNeedle)
      || /https?:\/\/api\.cloudflare\.com(?::\d+)?(?:\/|$)/iu.test(slashDecoded)
      || /^(?:authorization|proxy-authorization|x-auth-key|x-auth-email)$/iu.test(value)
      || /\b(?:authorization\s*:|bearer\s+[A-Za-z0-9._~+\/-]{8,})/iu.test(value)
      || /(?:^|[^A-Za-z0-9._~\\/])file:(?:\/\/)?/iu.test(slashDecoded)
      || /(?:^|[^A-Za-z0-9._~\\/])~[\\/]/u.test(slashDecoded)
      || containsPosixAbsolutePath(slashDecoded)
      || containsWindowsAbsolutePath(value)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
    }
  };
}

function scanStructuredStrings(value, scan, skippedKeys = new Set(), seen = new WeakSet()) {
  if (typeof value === 'string') {
    scan(value);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) scanStructuredStrings(item, scan, skippedKeys, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      scan(key);
      if (!skippedKeys.has(key)) scanStructuredStrings(item, scan, skippedKeys, seen);
    }
  }
}

export async function assertBootstrapCaptureHasNoSensitiveValues(capture, { accountId, apiToken }) {
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length < 1 || apiToken.length > 4096) {
    fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
  }
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)
    || ![
      'dwnc-cloudflare-service-existence-capture-v1',
      'dwnc-cloudflare-account-workers-dev-subdomain-capture-v1',
      'dwnc-cloudflare-deny-bootstrap-post-state-capture-v2',
      'dwnc-cloudflare-deny-bootstrap-deploy-output-capture-v1',
    ].includes(capture.contract)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
  }
  const scan = sensitiveStringScanner(accountId, apiToken);
  scanStructuredStrings(capture, scan, new Set(['rawBody', 'decodedBodyBase64']));
  if (Object.hasOwn(capture, 'rawBody')) {
    if (typeof capture.rawBody !== 'string') fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
    let parsed;
    try { parsed = JSON.parse(capture.rawBody); }
    catch { fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET'); }
    scanStructuredStrings(parsed, scan);
  }
  if (capture.contract === 'dwnc-cloudflare-deny-bootstrap-deploy-output-capture-v1') {
    let decoded;
    try { decoded = Buffer.from(capture.decodedBodyBase64, 'base64'); }
    catch { fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET'); }
    try {
      if (decoded.length < 1 || decoded.length > MAX_CONTROL_PLANE_BODY_BYTES
        || decoded.toString('base64') !== capture.decodedBodyBase64) {
        fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
      }
      let raw;
      try { raw = new TextDecoder('utf-8', { fatal: true }).decode(decoded); }
      catch { fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET'); }
      const events = raw.split(/\r?\n/u).filter(Boolean).map((line) => {
        try { return JSON.parse(line); }
        catch { fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET'); }
      });
      scanStructuredStrings(events, scan);
    } finally { decoded.fill(0); }
  }
  if (capture.responses !== undefined && !Array.isArray(capture.responses)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
  }
  for (const response of capture.responses ?? []) {
    if (typeof response?.decodedBodyBase64 !== 'string') {
      fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
    }
    let decoded;
    try { decoded = Buffer.from(response.decodedBodyBase64, 'base64'); }
    catch { fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET'); }
    try {
      if (decoded.length === 0 || decoded.length > MAX_CONTROL_PLANE_BODY_BYTES
        || decoded.toString('base64') !== response.decodedBodyBase64) {
        fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET');
      }
      if (response.role === 'script-content-v2') {
        scan(decoded.toString('latin1'));
        await parseDenyWorkerMultipart(
          decoded, response.descriptor?.contentType, response.entrypoint,
        );
      } else {
        const parsed = parseBootstrapJsonBytes(
          decoded, response.descriptor?.contentType,
          'CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET',
        ).value;
        scanStructuredStrings(parsed, scan);
      }
    } finally { decoded.fill(0); }
  }
  return capture;
}

async function readFixedCapture(primary, recovery, readFile, validate) {
  const readOne = async (file) => {
    let bytes;
    let canonicalBytes;
    try {
      bytes = await readFile(file, 16 * 1024 * 1024, { allowEmpty: true });
      const parsed = parseCanonicalEvidenceStorage(bytes);
      canonicalBytes = parsed.canonicalBytes;
      await validate(parsed.payload);
      return { capture: parsed.payload, canonicalBytes };
    } catch (error) {
      canonicalBytes?.fill(0);
      throw error;
    } finally { bytes?.fill(0); }
  };
  try { return await readOne(primary); }
  catch (error) {
    // Only an interrupted, non-canonical primary write can select the one fixed
    // recovery slot. A secure-open error or a canonical-but-invalid capture is
    // a target/tamper failure and must never be bypassed by recovery.
    if (error?.message !== 'CLOUDFLARE_E_SIGNING_CANONICAL') throw error;
  }
  try { return await readOne(recovery); }
  catch (error) {
    if (error?.message === 'CLOUDFLARE_E_SIGNING_CANONICAL') {
      fail('CLOUDFLARE_E_BOOTSTRAP_CAPTURE_RECOVERY_EXHAUSTED');
    }
    throw error;
  }
}

export async function verifyBootstrapAttestationFixedCaptures({
  attestation,
  authorizationSha256,
  repositoryRoot,
  home,
  accountId,
  apiToken,
  readFile = readSecureFile,
  assertOutsideRepository = assertCloudflareAccountTargetOutsideRepository,
  now = new Date(),
}) {
  validateBootstrapAttestation(attestation, { now, maxAgeSeconds: 300 });
  const paths = defaultBootstrapProtectedEvidencePaths({
    environment: attestation.environment, authorizationSha256, home,
  });
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)
    || path.resolve(repositoryRoot) !== repositoryRoot || typeof readFile !== 'function'
    || typeof assertOutsideRepository !== 'function') fail('CLOUDFLARE_E_BOOTSTRAP_EVIDENCE_PATH');
  const protectedPairs = [
    paths.freshAbsence, paths.freshAccountSubdomain, paths.deployOutput,
    paths.before, paths.after,
  ];
  for (const file of protectedPairs.flatMap((pair) => [pair.primary, pair.recovery])) {
    await assertOutsideRepository(file, repositoryRoot);
  }
  let freshAbsenceStored;
  let freshAccountStored;
  let deployOutputStored;
  let beforeStored;
  let afterStored;
  try {
    freshAbsenceStored = await readFixedCapture(
      paths.freshAbsence.primary, paths.freshAbsence.recovery, readFile,
      async (capture) => validateServiceExistenceCapture(capture, {
        expected: {
          environment: attestation.environment,
          workerName: attestation.workerName,
          accountIdSha256: attestation.accountIdSha256,
          exists: false,
        },
        now: new Date(capture.evidence?.observedAt), maxAgeSeconds: 15,
      }),
    );
    freshAccountStored = await readFixedCapture(
      paths.freshAccountSubdomain.primary, paths.freshAccountSubdomain.recovery, readFile,
      async (capture) => validateAccountWorkersDevSubdomainCapture(capture, {
        expected: {
          environment: attestation.environment,
          workerName: attestation.workerName,
          accountIdSha256: attestation.accountIdSha256,
          accountSubdomain: attestation.accountSubdomain,
        },
        now: new Date(capture.evidence?.observedAt), maxAgeSeconds: 15,
      }),
    );
    deployOutputStored = await readFixedCapture(
      paths.deployOutput.primary, paths.deployOutput.recovery, readFile,
      async (capture) => validateBootstrapDeployOutputCapture(capture, {
        authorizationSha256,
        expected: {
          environment: attestation.environment,
          workerName: attestation.workerName,
          versionId: attestation.versionId,
          commandStartedAt: attestation.deploymentStartedAt,
          commandCompletedAt: attestation.deploymentCompletedAt,
          rawOutputSha256: attestation.deploymentOutputSha256,
        },
      }),
    );
    beforeStored = await readFixedCapture(
      paths.before.primary, paths.before.recovery, readFile,
      async (capture) => validateBootstrapPostStateCapture(capture, {
        now: new Date(capture.observationCompletedAt), maxAgeSeconds: 15,
      }),
    );
    afterStored = await readFixedCapture(
      paths.after.primary, paths.after.recovery, readFile,
      async (capture) => validateBootstrapPostStateCapture(capture, {
        now: new Date(capture.observationCompletedAt), maxAgeSeconds: 15,
      }),
    );
    await assertBootstrapCaptureHasNoSensitiveValues(freshAbsenceStored.capture, {
      accountId, apiToken,
    });
    await assertBootstrapCaptureHasNoSensitiveValues(freshAccountStored.capture, {
      accountId, apiToken,
    });
    await assertBootstrapCaptureHasNoSensitiveValues(deployOutputStored.capture, {
      accountId, apiToken,
    });
    await assertBootstrapCaptureHasNoSensitiveValues(beforeStored.capture, { accountId, apiToken });
    await assertBootstrapCaptureHasNoSensitiveValues(afterStored.capture, { accountId, apiToken });
    await validateBootstrapPostStatePair(beforeStored.capture, afterStored.capture, {
      expected: {
        environment: attestation.environment,
        workerName: attestation.workerName,
        accountIdSha256: attestation.accountIdSha256,
        versionId: attestation.versionId,
        deploymentId: attestation.deploymentId,
      },
      now,
      maxAgeSeconds: 300,
    });
    const beforeDescriptors = beforeStored.capture.responses.map((response) => response.descriptor);
    const afterDescriptors = afterStored.capture.responses.map((response) => response.descriptor);
    const deployStarted = Date.parse(attestation.deploymentStartedAt);
    const freshObserved = [
      Date.parse(freshAbsenceStored.capture.evidence.observedAt),
      Date.parse(freshAccountStored.capture.evidence.observedAt),
    ];
    if (freshObserved.some((observed) => observed > deployStarted || deployStarted - observed > 15_000)
      || Date.parse(attestation.deploymentCompletedAt)
        > Date.parse(beforeStored.capture.observationStartedAt)
      || sha256Hex(freshAbsenceStored.canonicalBytes)
        !== attestation.freshAbsenceCaptureSha256
      || sha256Hex(freshAccountStored.canonicalBytes)
        !== attestation.freshAccountSubdomainCaptureSha256
      || sha256Hex(deployOutputStored.canonicalBytes)
        !== attestation.deploymentOutputCaptureSha256
      || sha256Hex(beforeStored.canonicalBytes) !== attestation.beforeCaptureSha256
      || sha256Hex(afterStored.canonicalBytes) !== attestation.afterCaptureSha256
      || canonicalJson(beforeDescriptors) !== canonicalJson(attestation.beforeResponses)
      || canonicalJson(afterDescriptors) !== canonicalJson(attestation.afterResponses)
      || beforeStored.capture.evidence.semanticStateSha256 !== attestation.semanticStateSha256
      || afterStored.capture.evidence.semanticStateSha256 !== attestation.semanticStateSha256
      || beforeStored.capture.evidence.settingsPolicySha256 !== attestation.settingsPolicySha256
      || beforeStored.capture.evidence.deploymentId !== attestation.deploymentId
      || afterStored.capture.evidence.deploymentId !== attestation.deploymentId
      || beforeStored.capture.evidence.entrypointSource !== attestation.entrypointSource) {
      fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAPTURE_BINDING');
    }
    return {
      freshAbsenceCaptureSha256: attestation.freshAbsenceCaptureSha256,
      freshAccountSubdomainCaptureSha256: attestation.freshAccountSubdomainCaptureSha256,
      deploymentOutputCaptureSha256: attestation.deploymentOutputCaptureSha256,
      beforeCaptureSha256: attestation.beforeCaptureSha256,
      afterCaptureSha256: attestation.afterCaptureSha256,
      semanticStateSha256: attestation.semanticStateSha256,
      deploymentId: attestation.deploymentId,
    };
  } finally {
    freshAbsenceStored?.canonicalBytes.fill(0);
    freshAccountStored?.canonicalBytes.fill(0);
    deployOutputStored?.canonicalBytes.fill(0);
    beforeStored?.canonicalBytes.fill(0);
    afterStored?.canonicalBytes.fill(0);
  }
}

export function canonicalBootstrapAuthorizationPayload(receipt) { return canonicalJson(receipt); }
export function validateBootstrapAuthorization(receipt, { expected = {}, now = new Date() } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'expectedAccountSubdomain', 'sourceGitSha', 'denyWorkerSha256', 'bootstrapConfigSha256',
    'serviceEvidenceSha256', 'accountSubdomainEvidenceSha256', 'freshAbsenceRequired',
    'freshAbsenceRequestSha256', 'freshAccountSubdomainRequired',
    'freshAccountSubdomainRequestSha256', 'maxFreshAbsenceAgeSeconds',
    'maxFreshAccountSubdomainAgeSeconds',
    'buildUuid', 'nonceSha256', 'createdAt', 'expiresAt'];
  if (!receipt || Object.keys(receipt).length !== keys.length
    || Object.keys(receipt).some((key) => !keys.includes(key))
    || receipt.schemaVersion !== 1 || receipt.contract !== 'dwnc-cloudflare-bootstrap-authorization-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || receipt.workerName !== bootstrapWorkerName(receipt.environment)
    || receipt.expectedAccountSubdomain !== EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN
    || ![receipt.accountIdSha256, receipt.denyWorkerSha256, receipt.bootstrapConfigSha256,
      receipt.serviceEvidenceSha256, receipt.accountSubdomainEvidenceSha256,
      receipt.freshAbsenceRequestSha256, receipt.freshAccountSubdomainRequestSha256,
      receipt.nonceSha256].every((value) => SHA256.test(value ?? ''))
    || receipt.freshAbsenceRequired !== true || receipt.freshAccountSubdomainRequired !== true
    || receipt.maxFreshAbsenceAgeSeconds !== 15
    || receipt.maxFreshAccountSubdomainAgeSeconds !== 15
    || receipt.freshAbsenceRequestSha256 !== serviceExistenceRequestSha256(receipt)
    || receipt.freshAccountSubdomainRequestSha256
      !== accountWorkersDevSubdomainRequestSha256(receipt)
    || !GIT_SHA1.test(receipt.sourceGitSha ?? '') || !UUID.test(receipt.buildUuid ?? '')
    || Number.isNaN(Date.parse(receipt.createdAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION');
  for (const [key, value] of Object.entries(expected)) if (receipt[key] !== value) {
    fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_EXPECTED');
  }
  const created = Date.parse(receipt.createdAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < created - 120000 || now.getTime() >= expires
    || expires <= created || expires - created > 10 * 60 * 1000) fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_EXPIRED');
  return receipt;
}

export function parseBootstrapDeployNdjson(raw, { environment, expectedArguments }) {
  let events;
  try { events = raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)); }
  catch { fail('CLOUDFLARE_E_BOOTSTRAP_OUTPUT'); }
  if (events.length !== 2 || events[0]?.type !== 'wrangler-session'
    || events[0]?.wrangler_version !== '4.125.0'
    || canonicalJson(events[0]?.command_line_args) !== canonicalJson(expectedArguments)
    || events[1]?.type !== 'deploy' || events[1]?.version !== 1
    || events[1]?.worker_name !== bootstrapWorkerName(environment)
    || events[1]?.worker_name_overridden !== false || !UUID.test(events[1]?.version_id ?? '')
    || !Array.isArray(events[1]?.targets) || events[1].targets.length !== 0) {
    fail('CLOUDFLARE_E_BOOTSTRAP_OUTPUT');
  }
  return events[1];
}

export function canonicalBootstrapDeployOutputCapturePayload(capture) {
  return canonicalJson(capture);
}

export function validateBootstrapDeployOutputCapture(capture, {
  expected = {}, authorizationSha256,
} = {}) {
  const keys = [
    'schemaVersion', 'contract', 'environment', 'workerName', 'versionId',
    'commandArgumentsSha256', 'rawOutputSha256', 'decodedBodyBytes', 'decodedBodyBase64',
    'commandStartedAt', 'commandCompletedAt',
  ];
  if (!exactKeys(capture, keys) || capture.schemaVersion !== 1
    || capture.contract !== 'dwnc-cloudflare-deny-bootstrap-deploy-output-capture-v1'
    || !['production', 'staging'].includes(capture.environment)
    || capture.workerName !== bootstrapWorkerName(capture.environment)
    || !UUID.test(capture.versionId ?? '')
    || !SHA256.test(capture.commandArgumentsSha256 ?? '')
    || !SHA256.test(capture.rawOutputSha256 ?? '')
    || !Number.isSafeInteger(capture.decodedBodyBytes) || capture.decodedBodyBytes < 1
    || capture.decodedBodyBytes > MAX_CONTROL_PLANE_BODY_BYTES
    || typeof capture.decodedBodyBase64 !== 'string'
    || !ISO_INSTANT.test(capture.commandStartedAt ?? '')
    || !ISO_INSTANT.test(capture.commandCompletedAt ?? '')
    || !SHA256.test(authorizationSha256 ?? '')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE');
  }
  const started = Date.parse(capture.commandStartedAt);
  const completed = Date.parse(capture.commandCompletedAt);
  if (completed < started || completed - started > 60_000) {
    fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE');
  }
  let bytes;
  try {
    bytes = Buffer.from(capture.decodedBodyBase64, 'base64');
    if (bytes.length !== capture.decodedBodyBytes
      || bytes.toString('base64') !== capture.decodedBodyBase64
      || sha256Hex(bytes) !== capture.rawOutputSha256) {
      fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE');
    }
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE'); }
    const expectedArguments = bootstrapArguments({
      environment: capture.environment, authorizationSha256,
    });
    if (capture.commandArgumentsSha256 !== sha256Hex(canonicalJson(expectedArguments))) {
      fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE');
    }
    const event = parseBootstrapDeployNdjson(raw, {
      environment: capture.environment, expectedArguments,
    });
    if (event.version_id !== capture.versionId) {
      fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE');
    }
  } finally { bytes?.fill(0); }
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || canonicalJson(capture[key]) !== canonicalJson(value)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE');
    }
  }
  return capture;
}

export function createBootstrapDeployOutputCapture(rawBytes, {
  environment, authorizationSha256, commandStartedAt, commandCompletedAt,
}) {
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length < 1
    || rawBytes.length > MAX_CONTROL_PLANE_BODY_BYTES) {
    fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE');
  }
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes); }
  catch { fail('CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_CAPTURE'); }
  const expectedArguments = bootstrapArguments({ environment, authorizationSha256 });
  const event = parseBootstrapDeployNdjson(raw, { environment, expectedArguments });
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-deny-bootstrap-deploy-output-capture-v1',
    environment,
    workerName: event.worker_name,
    versionId: event.version_id,
    commandArgumentsSha256: sha256Hex(canonicalJson(expectedArguments)),
    rawOutputSha256: sha256Hex(rawBytes),
    decodedBodyBytes: rawBytes.length,
    decodedBodyBase64: rawBytes.toString('base64'),
    commandStartedAt,
    commandCompletedAt,
  };
  return validateBootstrapDeployOutputCapture(capture, { authorizationSha256 });
}

export function canonicalBootstrapAttestationPayload(receipt) { return canonicalJson(receipt); }
function validateAttestationDescriptorSet(descriptors, startedAt, completedAt) {
  if (!Array.isArray(descriptors) || descriptors.length !== SNAPSHOT_ROLES.length) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
  }
  for (let index = 0; index < descriptors.length; index += 1) {
    if (descriptors[index]?.role !== SNAPSHOT_ROLES[index]
      || descriptors[index]?.httpStatus !== 200) fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
    try {
      validateBootstrapResponseDescriptor(descriptors[index], {
        role: SNAPSHOT_ROLES[index], observationStartedAt: startedAt,
        observationCompletedAt: completedAt,
      });
    } catch { fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION'); }
  }
  return descriptors;
}

export function validateBootstrapAttestation(receipt, {
  expected = {}, now = null, maxAgeSeconds = 300,
} = {}) {
  const keys = [
    'schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'accountSubdomain', 'sourceGitSha', 'versionId', 'deploymentId', 'deploymentStrategy',
    'deploymentVersions', 'denyWorkerSha256', 'bootstrapConfigSha256',
    'serviceEvidenceSha256', 'accountSubdomainEvidenceSha256', 'freshAbsenceCaptureSha256',
    'freshAccountSubdomainCaptureSha256', 'deploymentOutputSha256',
    'deploymentOutputCaptureSha256',
    'beforeCaptureSha256', 'afterCaptureSha256', 'beforeResponseDescriptorsSha256',
    'afterResponseDescriptorsSha256', 'beforeResponses', 'afterResponses',
    'semanticStateSha256', 'settingsPolicySha256', 'denyModuleSha256', 'denyModuleBytes',
    'workersDevEnabled', 'previewsEnabled', 'logpush', 'tailConsumersEmpty', 'tagsEmpty',
    'observabilityEnabled', 'tracesEnabled', 'logsDestinationsEmpty',
    'tracesDestinationsEmpty', 'bindingsEmpty', 'assetsAbsent', 'entrypointSource',
    'deploymentStartedAt', 'deploymentCompletedAt', 'snapshotBeforeStartedAt',
    'snapshotBeforeCompletedAt', 'snapshotAfterStartedAt', 'snapshotAfterCompletedAt', 'attestedAt',
  ];
  if (!exactKeys(receipt, keys) || receipt.schemaVersion !== 2
    || receipt.contract !== 'dwnc-cloudflare-deny-bootstrap-attestation-v2'
    || !['production', 'staging'].includes(receipt.environment)
    || receipt.workerName !== bootstrapWorkerName(receipt.environment)
    || receipt.accountSubdomain !== EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN
    || ![receipt.accountIdSha256, receipt.denyWorkerSha256, receipt.bootstrapConfigSha256,
      receipt.serviceEvidenceSha256, receipt.accountSubdomainEvidenceSha256,
      receipt.freshAbsenceCaptureSha256, receipt.freshAccountSubdomainCaptureSha256,
      receipt.deploymentOutputSha256, receipt.deploymentOutputCaptureSha256,
      receipt.beforeCaptureSha256, receipt.afterCaptureSha256,
      receipt.beforeResponseDescriptorsSha256, receipt.afterResponseDescriptorsSha256,
      receipt.semanticStateSha256, receipt.settingsPolicySha256, receipt.denyModuleSha256]
      .every((value) => SHA256.test(value ?? ''))
    || !GIT_SHA1.test(receipt.sourceGitSha ?? '') || !UUID.test(receipt.versionId ?? '')
    || !UUID.test(receipt.deploymentId ?? '') || receipt.deploymentStrategy !== 'percentage'
    || canonicalJson(receipt.deploymentVersions)
      !== canonicalJson([{ versionId: receipt.versionId, percentage: 100 }])
    || receipt.denyWorkerSha256 !== bootstrapDenyWorkerSha256()
    || receipt.denyModuleSha256 !== bootstrapDenyWorkerSha256()
    || receipt.denyModuleBytes !== Buffer.byteLength(DENY_ALL_WORKER_SOURCE)
    || receipt.workersDevEnabled !== false || receipt.previewsEnabled !== false
    || receipt.logpush !== false || receipt.tailConsumersEmpty !== true
    || receipt.tagsEmpty !== true || receipt.observabilityEnabled !== true
    || receipt.tracesEnabled !== false || receipt.logsDestinationsEmpty !== true
    || receipt.tracesDestinationsEmpty !== true || receipt.bindingsEmpty !== true
    || receipt.assetsAbsent !== true
    || !['single-module-inference', 'cf-entrypoint'].includes(receipt.entrypointSource)
    || ![receipt.deploymentStartedAt, receipt.deploymentCompletedAt,
      receipt.snapshotBeforeStartedAt, receipt.snapshotBeforeCompletedAt,
      receipt.snapshotAfterStartedAt, receipt.snapshotAfterCompletedAt, receipt.attestedAt]
      .every((value) => ISO_INSTANT.test(value ?? ''))) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
  }
  validateAttestationDescriptorSet(
    receipt.beforeResponses, receipt.snapshotBeforeStartedAt, receipt.snapshotBeforeCompletedAt,
  );
  validateAttestationDescriptorSet(
    receipt.afterResponses, receipt.snapshotAfterStartedAt, receipt.snapshotAfterCompletedAt,
  );
  if (sha256Hex(canonicalJson(receipt.beforeResponses)) !== receipt.beforeResponseDescriptorsSha256
    || sha256Hex(canonicalJson(receipt.afterResponses)) !== receipt.afterResponseDescriptorsSha256) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
  }
  const beforeStarted = Date.parse(receipt.snapshotBeforeStartedAt);
  const beforeCompleted = Date.parse(receipt.snapshotBeforeCompletedAt);
  const afterStarted = Date.parse(receipt.snapshotAfterStartedAt);
  const afterCompleted = Date.parse(receipt.snapshotAfterCompletedAt);
  const attested = Date.parse(receipt.attestedAt);
  const deploymentStarted = Date.parse(receipt.deploymentStartedAt);
  const deploymentCompleted = Date.parse(receipt.deploymentCompletedAt);
  if (deploymentCompleted < deploymentStarted
    || deploymentCompleted - deploymentStarted > 60_000
    || deploymentCompleted > beforeStarted
    || beforeCompleted < beforeStarted || afterCompleted < afterStarted
    || beforeCompleted > afterStarted || afterCompleted > attested
    || attested - afterCompleted > MAX_POST_STATE_AGE_MS
    || beforeCompleted - beforeStarted > MAX_POST_STATE_DURATION_MS
    || afterCompleted - afterStarted > MAX_POST_STATE_DURATION_MS
    || afterCompleted - beforeStarted > MAX_DOUBLE_SNAPSHOT_DURATION_MS) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
  }
  if (now !== null) {
    const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
    if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 300
      || Number.isNaN(nowMs) || nowMs < attested - MAX_FUTURE_SKEW_MS
      || nowMs - attested > maxAgeSeconds * 1000) fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || canonicalJson(receipt[key]) !== canonicalJson(value)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_EXPECTED');
    }
  }
  return receipt;
}

export function bootstrapDenyWorkerSha256() {
  return createHash('sha256').update(DENY_ALL_WORKER_SOURCE).digest('hex');
}

export function bootstrapConfigSha256(environment) {
  return sha256Hex(canonicalJson(bootstrapConfig(environment)));
}

export function bootstrapSettingsPolicySha256() {
  return sha256Hex(canonicalJson({
    logpush: false,
    tailConsumers: [],
    tags: [],
    observabilityEnabled: true,
    observabilityHeadSamplingRate: 1,
    redactQueryString: false,
    logsEnabled: true,
    logsHeadSamplingRate: 1,
    invocationLogs: false,
    logsPersist: true,
    logsDestinations: [],
    tracesEnabled: false,
    tracesHeadSamplingRate: 1,
    tracesPersist: true,
    tracesDestinations: [],
    tracesPropagationPolicy: null,
  }));
}

export function createBootstrapPromotionBaseline(attestation) {
  validateBootstrapAttestation(attestation, { expected: { environment: 'production' } });
  return createPromotionGenesisState({
    bootstrapVersionId: attestation.versionId,
    sourceGitSha: attestation.sourceGitSha,
  });
}
