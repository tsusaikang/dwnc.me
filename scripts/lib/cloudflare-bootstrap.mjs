import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  canonicalJson,
  createPromotionGenesisState,
  sha256Hex,
} from './cloudflare-release.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';

const fail = (code) => { throw new Error(code); };
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA1 = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export const DENY_ALL_WORKER_SOURCE = `export default {\n  async fetch() {\n    return new Response("Not found.\\n", { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });\n  }\n};\n`;

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
  let response;
  let rawBody;
  try {
    response = await fetchImpl(url, {
      method: 'GET', headers: { authorization: `Bearer ${apiToken}` },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    rawBody = await response.text();
  } catch { fail('CLOUDFLARE_E_SERVICE_EXISTENCE_FETCH'); }
  if (![200, 404].includes(response.status) || typeof rawBody !== 'string'
    || Buffer.byteLength(rawBody) > 1024 * 1024) fail('CLOUDFLARE_E_SERVICE_EXISTENCE_FETCH');
  let parsed;
  try { parsed = JSON.parse(rawBody); } catch { fail('CLOUDFLARE_E_SERVICE_EXISTENCE_RESPONSE'); }
  const notFoundCodes = new Set([10007, 10090]);
  const missing = response.status === 404
    && parsed?.success === false && parsed?.result === null
    && Array.isArray(parsed?.errors) && parsed.errors.length > 0
    && parsed.errors.every((error) => notFoundCodes.has(error?.code));
  const exists = response.status === 200 && parsed?.success === true && parsed?.result !== null;
  if (!missing && !exists) fail('CLOUDFLARE_E_SERVICE_EXISTENCE_RESPONSE');
  const observedAt = now();
  if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_RESPONSE');
  }
  const evidence = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-service-existence-v1', environment,
    workerName, accountIdSha256, exists, httpStatus: response.status,
    rawEvidenceSha256: sha256Hex(rawBody), observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
  validateServiceExistenceEvidence(evidence, { now: observedAt });
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-service-existence-capture-v1',
    requestSha256,
    rawBodySha256: sha256Hex(rawBody),
    rawBody,
    evidence,
  };
  validateServiceExistenceCapture(capture, { now: observedAt, maxAgeSeconds: ttlSeconds });
  return capture;
}

export function bootstrapConfig(environment) {
  return {
    name: bootstrapWorkerName(environment),
    main: './deny-all-worker.js',
    compatibility_date: '2026-08-24',
    workers_dev: false,
    preview_urls: false,
    find_additional_modules: false,
  };
}

export function bootstrapArguments({ environment, directory, authorizationSha256 }) {
  bootstrapWorkerName(environment);
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || !SHA256.test(authorizationSha256 ?? '')) fail('CLOUDFLARE_E_BOOTSTRAP_ARGUMENTS');
  return [
    'deploy', path.join(directory, 'deny-all-worker.js'), '--no-bundle', '--strict', '--yes',
    '--config', path.join(directory, 'wrangler-bootstrap.jsonc'),
    '--env-file', path.join(directory, 'wrangler-empty.env'),
    '--x-provision=false', '--x-auto-create=false',
    '--tag', `dwnc-bootstrap-${authorizationSha256.slice(0, 24)}`,
    '--message', `dwnc-deny-bootstrap:${authorizationSha256}`,
  ];
}

export function canonicalServiceExistenceEvidencePayload(receipt) { return canonicalJson(receipt); }
export function validateServiceExistenceEvidence(receipt, { expected = {}, now = new Date() } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'exists', 'httpStatus', 'rawEvidenceSha256', 'observedAt', 'expiresAt'];
  if (!receipt || Object.keys(receipt).length !== keys.length
    || Object.keys(receipt).some((key) => !keys.includes(key))
    || receipt.schemaVersion !== 1 || receipt.contract !== 'dwnc-cloudflare-service-existence-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || receipt.workerName !== bootstrapWorkerName(receipt.environment)
    || !SHA256.test(receipt.accountIdSha256 ?? '') || typeof receipt.exists !== 'boolean'
    || ![200, 404].includes(receipt.httpStatus) || receipt.exists !== (receipt.httpStatus === 200)
    || !SHA256.test(receipt.rawEvidenceSha256 ?? '')
    || Number.isNaN(Date.parse(receipt.observedAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_SERVICE_EXISTENCE');
  for (const [key, value] of Object.entries(expected)) if (receipt[key] !== value) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_EXPECTED');
  }
  const observed = Date.parse(receipt.observedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < observed - 120000 || now.getTime() >= expires
    || expires <= observed || expires - observed > 5 * 60 * 1000) fail('CLOUDFLARE_E_SERVICE_EXISTENCE_EXPIRED');
  return receipt;
}

export function canonicalServiceExistenceCapturePayload(capture) { return canonicalJson(capture); }
export function validateServiceExistenceCapture(capture, {
  expected = {}, now = new Date(), maxAgeSeconds = 15,
} = {}) {
  const keys = ['schemaVersion', 'contract', 'requestSha256', 'rawBodySha256', 'rawBody', 'evidence'];
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
  if (capture.requestSha256 !== serviceExistenceRequestSha256({
    environment: capture.evidence.environment,
    accountIdSha256: capture.evidence.accountIdSha256,
  })) fail('CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE');
  const age = now.getTime() - Date.parse(capture.evidence.observedAt);
  if (age < -120000 || age > maxAgeSeconds * 1000) {
    fail('CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE_EXPIRED');
  }
  return capture;
}

export function canonicalBootstrapAuthorizationPayload(receipt) { return canonicalJson(receipt); }
export function validateBootstrapAuthorization(receipt, { expected = {}, now = new Date() } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'sourceGitSha', 'denyWorkerSha256', 'bootstrapConfigSha256', 'serviceEvidenceSha256',
    'freshAbsenceRequired', 'freshAbsenceRequestSha256', 'maxFreshAbsenceAgeSeconds',
    'buildUuid', 'nonceSha256', 'createdAt', 'expiresAt'];
  if (!receipt || Object.keys(receipt).length !== keys.length
    || Object.keys(receipt).some((key) => !keys.includes(key))
    || receipt.schemaVersion !== 1 || receipt.contract !== 'dwnc-cloudflare-bootstrap-authorization-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || receipt.workerName !== bootstrapWorkerName(receipt.environment)
    || ![receipt.accountIdSha256, receipt.denyWorkerSha256, receipt.bootstrapConfigSha256,
      receipt.serviceEvidenceSha256, receipt.freshAbsenceRequestSha256,
      receipt.nonceSha256].every((value) => SHA256.test(value ?? ''))
    || receipt.freshAbsenceRequired !== true || receipt.maxFreshAbsenceAgeSeconds !== 15
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

export function canonicalBootstrapAttestationPayload(receipt) { return canonicalJson(receipt); }
export function validateBootstrapAttestation(receipt, { expected = {} } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
    'sourceGitSha', 'versionId', 'denyWorkerSha256', 'bootstrapConfigSha256',
    'serviceEvidenceSha256', 'freshAbsenceCaptureSha256', 'deploymentOutputSha256', 'versionDetailSha256',
    'deploymentStatusSha256', 'denyScriptVerified', 'bindingsEmpty', 'assetsAbsent',
    'externalSurfaceCount', 'deployment100', 'attestedAt'];
  if (!receipt || Object.keys(receipt).length !== keys.length
    || Object.keys(receipt).some((key) => !keys.includes(key))
    || receipt.schemaVersion !== 1 || receipt.contract !== 'dwnc-cloudflare-deny-bootstrap-attestation-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || receipt.workerName !== bootstrapWorkerName(receipt.environment)
    || ![receipt.accountIdSha256, receipt.denyWorkerSha256, receipt.bootstrapConfigSha256,
      receipt.serviceEvidenceSha256, receipt.freshAbsenceCaptureSha256,
      receipt.deploymentOutputSha256, receipt.versionDetailSha256,
      receipt.deploymentStatusSha256].every((value) => SHA256.test(value ?? ''))
    || !GIT_SHA1.test(receipt.sourceGitSha ?? '') || !UUID.test(receipt.versionId ?? '')
    || receipt.denyScriptVerified !== true || receipt.bindingsEmpty !== true
    || receipt.assetsAbsent !== true || receipt.externalSurfaceCount !== 0
    || receipt.deployment100 !== true || Number.isNaN(Date.parse(receipt.attestedAt ?? ''))) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
  }
  for (const [key, value] of Object.entries(expected)) if (receipt[key] !== value) {
    fail('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_EXPECTED');
  }
  return receipt;
}

export function bootstrapDenyWorkerSha256() {
  return createHash('sha256').update(DENY_ALL_WORKER_SOURCE).digest('hex');
}

export function bootstrapConfigSha256(environment) {
  return sha256Hex(canonicalJson(bootstrapConfig(environment)));
}

export function createBootstrapPromotionBaseline(attestation) {
  validateBootstrapAttestation(attestation, { expected: { environment: 'production' } });
  return createPromotionGenesisState({
    bootstrapVersionId: attestation.versionId,
    sourceGitSha: attestation.sourceGitSha,
  });
}
