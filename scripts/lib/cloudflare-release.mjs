import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { publicKeySpkiSha256 } from './public-media-manifest.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA1 = /^[a-f0-9]{40}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const ETAG = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const WORKER_NAME = 'dwnc-me';
const PREUPLOAD_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'sourceGitSha', 'ciSourceGitSha',
  'workerName', 'accountIdSha256', 'stagingAccountIdSha256',
  'workerScriptSha256', 'workerScriptBytes', 'payloadSha256',
  'staticTreeSha256', 'staticFiles', 'publicRequestSurfaceSha256', 'publicRequestPaths',
  'uploadConfigSha256', 'stagingUploadConfigSha256', 'promotionConfigSha256', 'redirectsSha256',
  'stagingPromotionConfigSha256',
  'environmentFileSha256',
  'mediaManifestSha256', 'mediaRemoteReceiptSha256', 'bindingsSha256',
  'mediaRemoteSignatureSha256', 'mediaRemotePublicKeySpkiSha256',
  'assetsConfigSha256', 'stagingBindingsSha256', 'stagingAssetsConfigSha256',
  'wranglerVersion', 'compatibilityDate',
]);
const STAGING_PREUPLOAD_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'sourceGitSha', 'ciSourceGitSha',
  'workerName', 'stagingAccountIdSha256',
  'workerScriptSha256', 'workerScriptBytes', 'payloadSha256',
  'staticTreeSha256', 'staticFiles', 'publicRequestSurfaceSha256', 'publicRequestPaths',
  'stagingUploadConfigSha256', 'stagingPromotionConfigSha256', 'environmentFileSha256',
  'redirectsSha256', 'mediaManifestSha256', 'mediaRemoteReceiptSha256',
  'mediaRemoteSignatureSha256', 'mediaRemotePublicKeySpkiSha256',
  'stagingBindingsSha256', 'stagingAssetsConfigSha256',
  'wranglerVersion', 'compatibilityDate',
]);
const ATTESTATION_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'artifactSha256', 'payloadSha256', 'versionId', 'scriptEtag',
  'bindingsSha256', 'assetsConfigSha256', 'workerName', 'accountIdSha256', 'sourceGitSha',
  'buildUuid', 'rawVersionDetailSha256', 'createdAt', 'expiresAt',
]);
const SMOKE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'artifactSha256', 'payloadSha256',
  'versionId', 'stagingVersionId', 'originSha256', 'accessPolicySha256',
  'stagingVersionAttestationSha256', 'stagingDeploymentStatusSha256', 'rawProbeEvidenceSha256',
  'stagingMediaProbeSha256',
  'syntheticNonAccessOrigin', 'get200', 'head200', 'notModified304', 'range206',
  'range416', 'mimeVerified', 'etagVerified', 'static200', 'redirects308',
  'redirectCount', 'cachePathVerified', 'stagingDeployment100', 'unauthenticatedDenied',
  'versionMarkerVerified',
  'observedAt', 'expiresAt',
]);
const UPLOAD_AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'artifactSha256', 'accountIdSha256',
  'workerName', 'sourceGitSha', 'buildUuid', 'nonceSha256', 'createdAt', 'expiresAt',
]);
const STAGING_SECRET_AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'workerName', 'accountIdSha256',
  'artifactSha256', 'sourceGitSha', 'uploadAuthorizationSha256',
  'secretName', 'secretValueSha256', 'secretBytes', 'secretsFileSha256',
  'uploadArgumentsSha256', 'buildUuid', 'nonceSha256', 'createdAt', 'expiresAt',
]);
const PROMOTION_PLAN_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'expectedGeneration', 'previousPromotionSha256',
  'artifactSha256', 'payloadSha256', 'sourceGitSha', 'versionId', 'mediaManifestSha256',
  'allowedKeysSha256', 'withdrawnKeyHashes', 'allowedKeyHashes',
  'retiredArtifactSha256', 'retiredPayloadSha256', 'retiredVersionIds',
]);
const PROMOTION_STATE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'generation', 'previousPromotionSha256', 'artifactSha256',
  'payloadSha256', 'sourceGitSha', 'versionId', 'mediaManifestSha256', 'allowedKeysSha256',
  'withdrawnKeyHashes', 'allowedKeyHashes', 'retiredArtifactSha256', 'retiredPayloadSha256',
  'retiredVersionIds', 'promotionPlanSha256', 'deploymentStatusSha256', 'activatedAt',
]);
const PROMOTION_AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'artifactSha256', 'versionId',
  'activePromotionSha256', 'promotionPlanSha256', 'deploymentStatusBeforeSha256',
  'deploymentArgumentsSha256', 'buildUuid', 'nonceSha256', 'createdAt', 'expiresAt',
]);
const STAGING_ACTIVATION_AUTHORIZATION_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'artifactSha256', 'payloadSha256',
  'versionId', 'accountIdSha256', 'workerName', 'originSha256', 'accessPolicySha256',
  'deploymentStatusBeforeSha256', 'deploymentArgumentsSha256', 'buildUuid',
  'nonceSha256', 'createdAt', 'expiresAt',
]);

export class CloudflareReleaseError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CloudflareReleaseError';
    this.code = code;
  }
}

const fail = (code) => { throw new CloudflareReleaseError(code); };
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const byteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(byteCompare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalPreuploadArtifactPayload(receipt) {
  return canonicalJson(Object.fromEntries(PREUPLOAD_KEYS.map((key) => [key, receipt[key]])));
}

export function preuploadArtifactSha256(receipt) {
  return sha256Hex(canonicalPreuploadArtifactPayload(receipt));
}

export function canonicalStagingPreuploadArtifactPayload(receipt) {
  return canonicalJson(Object.fromEntries(STAGING_PREUPLOAD_KEYS.map((key) => [key, receipt[key]])));
}

export function stagingPreuploadArtifactSha256(receipt) {
  return sha256Hex(canonicalStagingPreuploadArtifactPayload(receipt));
}

export function cloudflarePayloadSha256(workerScriptSha256, staticTreeSha256) {
  if (!SHA256.test(workerScriptSha256 ?? '') || !SHA256.test(staticTreeSha256 ?? '')) {
    fail('CLOUDFLARE_E_ARTIFACT_PAYLOAD');
  }
  return sha256Hex(`dwnc-cloudflare-payload-v1\0${workerScriptSha256}\0${staticTreeSha256}`);
}

export function validatePreuploadArtifact(receipt, expected = {}) {
  if (!exactKeys(receipt, PREUPLOAD_KEYS)
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-preupload-artifact-v1'
    || receipt.environment !== 'production'
    || !GIT_SHA1.test(receipt.sourceGitSha ?? '')
    || receipt.ciSourceGitSha !== receipt.sourceGitSha
    || receipt.workerName !== WORKER_NAME
    || !SHA256.test(receipt.accountIdSha256 ?? '')
    || !SHA256.test(receipt.stagingAccountIdSha256 ?? '')
    || !SHA256.test(receipt.workerScriptSha256 ?? '')
    || !Number.isSafeInteger(receipt.workerScriptBytes) || receipt.workerScriptBytes <= 0
    || receipt.payloadSha256 !== cloudflarePayloadSha256(
      receipt.workerScriptSha256, receipt.staticTreeSha256)
    || !SHA256.test(receipt.staticTreeSha256 ?? '')
    || !Number.isSafeInteger(receipt.staticFiles) || receipt.staticFiles <= 0
    || !SHA256.test(receipt.publicRequestSurfaceSha256 ?? '')
    || !Number.isSafeInteger(receipt.publicRequestPaths) || receipt.publicRequestPaths <= 0
    || !SHA256.test(receipt.uploadConfigSha256 ?? '')
    || !SHA256.test(receipt.stagingUploadConfigSha256 ?? '')
    || !SHA256.test(receipt.environmentFileSha256 ?? '')
    || !SHA256.test(receipt.promotionConfigSha256 ?? '')
    || !SHA256.test(receipt.stagingPromotionConfigSha256 ?? '')
    || !SHA256.test(receipt.redirectsSha256 ?? '')
    || !SHA256.test(receipt.mediaManifestSha256 ?? '')
    || !SHA256.test(receipt.mediaRemoteReceiptSha256 ?? '')
    || !SHA256.test(receipt.mediaRemoteSignatureSha256 ?? '')
    || !SHA256.test(receipt.mediaRemotePublicKeySpkiSha256 ?? '')
    || !SHA256.test(receipt.bindingsSha256 ?? '')
    || !SHA256.test(receipt.assetsConfigSha256 ?? '')
    || !SHA256.test(receipt.stagingBindingsSha256 ?? '')
    || !SHA256.test(receipt.stagingAssetsConfigSha256 ?? '')
    || receipt.wranglerVersion !== '4.125.0'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(receipt.compatibilityDate ?? '')) {
    fail('CLOUDFLARE_E_PREUPLOAD_ARTIFACT');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!PREUPLOAD_KEYS.includes(key) || receipt[key] !== value) fail('CLOUDFLARE_E_PREUPLOAD_EXPECTED');
  }
  return receipt;
}

export function validateStagingPreuploadArtifact(receipt, expected = {}) {
  if (!exactKeys(receipt, STAGING_PREUPLOAD_KEYS)
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-preupload-artifact-v1'
    || receipt.environment !== 'staging'
    || !GIT_SHA1.test(receipt.sourceGitSha ?? '')
    || receipt.ciSourceGitSha !== receipt.sourceGitSha
    || receipt.workerName !== 'dwnc-me-staging'
    || !SHA256.test(receipt.stagingAccountIdSha256 ?? '')
    || !SHA256.test(receipt.workerScriptSha256 ?? '')
    || !Number.isSafeInteger(receipt.workerScriptBytes) || receipt.workerScriptBytes <= 0
    || receipt.payloadSha256 !== cloudflarePayloadSha256(
      receipt.workerScriptSha256, receipt.staticTreeSha256)
    || !SHA256.test(receipt.staticTreeSha256 ?? '')
    || !Number.isSafeInteger(receipt.staticFiles) || receipt.staticFiles <= 0
    || !SHA256.test(receipt.publicRequestSurfaceSha256 ?? '')
    || !Number.isSafeInteger(receipt.publicRequestPaths) || receipt.publicRequestPaths <= 0
    || !SHA256.test(receipt.stagingUploadConfigSha256 ?? '')
    || !SHA256.test(receipt.stagingPromotionConfigSha256 ?? '')
    || !SHA256.test(receipt.environmentFileSha256 ?? '')
    || !SHA256.test(receipt.redirectsSha256 ?? '')
    || !SHA256.test(receipt.mediaManifestSha256 ?? '')
    || !SHA256.test(receipt.mediaRemoteReceiptSha256 ?? '')
    || !SHA256.test(receipt.mediaRemoteSignatureSha256 ?? '')
    || !SHA256.test(receipt.mediaRemotePublicKeySpkiSha256 ?? '')
    || !SHA256.test(receipt.stagingBindingsSha256 ?? '')
    || !SHA256.test(receipt.stagingAssetsConfigSha256 ?? '')
    || receipt.wranglerVersion !== '4.125.0'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(receipt.compatibilityDate ?? '')) {
    fail('CLOUDFLARE_E_STAGING_PREUPLOAD_ARTIFACT');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!STAGING_PREUPLOAD_KEYS.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_STAGING_PREUPLOAD_EXPECTED');
    }
  }
  return receipt;
}

export function stagingUploadArtifactSha256(artifact) {
  if (artifact?.contract === 'dwnc-cloudflare-staging-preupload-artifact-v1') {
    validateStagingPreuploadArtifact(artifact);
    return stagingPreuploadArtifactSha256(artifact);
  }
  validatePreuploadArtifact(artifact);
  return preuploadArtifactSha256(artifact);
}

export function versionUploadTag(artifactSha256) {
  if (!SHA256.test(artifactSha256 ?? '')) fail('CLOUDFLARE_E_UPLOAD_ARTIFACT');
  return `dwnc-${artifactSha256.slice(0, 32)}`;
}

export function versionUploadMessage(artifact) {
  validatePreuploadArtifact(artifact);
  return `dwnc-artifact:${preuploadArtifactSha256(artifact)}`;
}

export function stagingVersionUploadMessage(artifact) {
  return `dwnc-artifact:${stagingUploadArtifactSha256(artifact)}`;
}

export function productionVersionUploadArguments({ artifactDirectory, artifact }) {
  if (typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)) {
    fail('CLOUDFLARE_E_UPLOAD_ARTIFACT');
  }
  validatePreuploadArtifact(artifact);
  const artifactSha = preuploadArtifactSha256(artifact);
  return [
    'versions', 'upload', path.join(artifactDirectory, 'worker.js'), '--no-bundle', '--strict',
    '--env', 'production', '--config', path.join(artifactDirectory, 'wrangler-upload.jsonc'),
    '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
    '--x-provision=false', '--x-auto-create=false',
    '--assets', path.join(artifactDirectory, 'static'), '--tag', versionUploadTag(artifactSha),
    '--message', versionUploadMessage(artifact),
  ];
}

export function stagingVersionUploadArguments({ artifactDirectory, artifact, secretsFile }) {
  if (typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)
    || typeof secretsFile !== 'string' || !path.isAbsolute(secretsFile)) {
    fail('CLOUDFLARE_E_UPLOAD_ARTIFACT');
  }
  const artifactSha = stagingUploadArtifactSha256(artifact);
  return [
    'versions', 'upload', path.join(artifactDirectory, 'worker.js'), '--no-bundle', '--strict',
    '--env', 'staging', '--config', path.join(artifactDirectory, 'wrangler-staging-upload.jsonc'),
    '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
    '--secrets-file', secretsFile,
    '--x-provision=false', '--x-auto-create=false',
    '--assets', path.join(artifactDirectory, 'static'), '--tag', versionUploadTag(artifactSha),
    '--message', stagingVersionUploadMessage(artifact),
  ];
}

export function parseWranglerVersionUploadNdjson(raw, {
  expectedWorkerName = WORKER_NAME, expectedEnvironment = 'production', expectedArguments = null,
} = {}) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024 * 1024) {
    fail('CLOUDFLARE_E_UPLOAD_OUTPUT');
  }
  let events;
  try { events = raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)); }
  catch { fail('CLOUDFLARE_E_UPLOAD_OUTPUT'); }
  if (events.length !== 2) fail('CLOUDFLARE_E_UPLOAD_EVENT_COUNT');
  const [session, event] = events;
  const sessionKeys = ['type', 'version', 'wrangler_version', 'command_line_args', 'log_file_path', 'timestamp'];
  if (!exactKeys(session, sessionKeys) || session.type !== 'wrangler-session' || session.version !== 1
    || session.wrangler_version !== '4.125.0' || !Array.isArray(session.command_line_args)
    || session.command_line_args.some((value) => typeof value !== 'string')
    || (expectedArguments && canonicalJson(session.command_line_args) !== canonicalJson(expectedArguments))
    || (session.log_file_path !== null && typeof session.log_file_path !== 'string')
    || Number.isNaN(Date.parse(session.timestamp ?? ''))) fail('CLOUDFLARE_E_UPLOAD_SESSION');
  const requiredKeys = ['type', 'version', 'worker_name', 'worker_tag', 'version_id',
    'wrangler_environment', 'worker_name_overridden', 'timestamp'];
  const optionalKeys = ['preview_url', 'preview_alias_url'];
  if (!event || typeof event !== 'object'
    || Object.keys(event).some((key) => ![...requiredKeys, ...optionalKeys].includes(key))
    || requiredKeys.some((key) => !(key in event))
    || event.type !== 'version-upload' || event.version !== 1
    || event.worker_name !== expectedWorkerName || event.wrangler_environment !== expectedEnvironment
    || event.worker_name_overridden !== false || !UUID.test(event.version_id ?? '')
    || ![null, undefined].includes(event.worker_tag) && (typeof event.worker_tag !== 'string' || event.worker_tag.length === 0)
    || ![undefined, null].includes(event.preview_url) || ![undefined, null].includes(event.preview_alias_url)
    || Number.isNaN(Date.parse(event.timestamp ?? ''))) fail('CLOUDFLARE_E_UPLOAD_OUTPUT');
  return event;
}

export function validateVersionUploadResult(result, expected = {}) {
  const keys = ['schemaVersion', 'contract', 'artifactSha256', 'versionId', 'workerName',
    'environment', 'wranglerOutputSha256', 'uploadAuthorizationSha256', 'buildUuid', 'uploadedAt'];
  if (!exactKeys(result, keys) || result.schemaVersion !== 1
    || result.contract !== 'dwnc-cloudflare-version-upload-result-v1'
    || !SHA256.test(result.artifactSha256 ?? '') || !UUID.test(result.versionId ?? '')
    || !['production', 'staging'].includes(result.environment)
    || result.workerName !== (result.environment === 'production' ? WORKER_NAME : 'dwnc-me-staging')
    || !SHA256.test(result.wranglerOutputSha256 ?? '')
    || !SHA256.test(result.uploadAuthorizationSha256 ?? '') || !UUID.test(result.buildUuid ?? '')
    || Number.isNaN(Date.parse(result.uploadedAt ?? ''))) fail('CLOUDFLARE_E_UPLOAD_RESULT');
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || result[key] !== value) fail('CLOUDFLARE_E_UPLOAD_RESULT_EXPECTED');
  }
  return result;
}

export function canonicalUploadAuthorizationPayload(receipt) {
  return canonicalJson(Object.fromEntries(UPLOAD_AUTHORIZATION_KEYS.map((key) => [key, receipt[key]])));
}

export function validateUploadAuthorization(receipt, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 900,
} = {}) {
  if (!exactKeys(receipt, UPLOAD_AUTHORIZATION_KEYS) || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-upload-authorization-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || !SHA256.test(receipt.artifactSha256 ?? '')
    || !SHA256.test(receipt.accountIdSha256 ?? '')
    || receipt.workerName !== (receipt.environment === 'production' ? WORKER_NAME : 'dwnc-me-staging')
    || !GIT_SHA1.test(receipt.sourceGitSha ?? '') || !UUID.test(receipt.buildUuid ?? '')
    || !SHA256.test(receipt.nonceSha256 ?? '') || Number.isNaN(Date.parse(receipt.createdAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION');
  for (const [key, value] of Object.entries(expected)) {
    if (!UPLOAD_AUTHORIZATION_KEYS.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_EXPECTED');
    }
  }
  const created = Date.parse(receipt.createdAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < created - 120000 || now.getTime() >= expires
    || expires <= created || expires - created > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_EXPIRED');
  }
  return receipt;
}

export function canonicalStagingSecretAuthorizationPayload(receipt) {
  return canonicalJson(Object.fromEntries(
    STAGING_SECRET_AUTHORIZATION_KEYS.map((key) => [key, receipt[key]])));
}

export function validateStagingSecretAuthorization(receipt, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 900,
} = {}) {
  if (!exactKeys(receipt, STAGING_SECRET_AUTHORIZATION_KEYS)
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-secret-authorization-v1'
    || receipt.environment !== 'staging' || receipt.workerName !== 'dwnc-me-staging'
    || ![receipt.accountIdSha256, receipt.artifactSha256, receipt.uploadAuthorizationSha256,
      receipt.secretValueSha256, receipt.secretsFileSha256, receipt.uploadArgumentsSha256,
      receipt.nonceSha256].every((value) => SHA256.test(value ?? ''))
    || !GIT_SHA1.test(receipt.sourceGitSha ?? '') || !UUID.test(receipt.buildUuid ?? '')
    || receipt.secretName !== 'DWNC_STAGING_SMOKE_TOKEN'
    || !Number.isInteger(receipt.secretBytes) || receipt.secretBytes < 32 || receipt.secretBytes > 128
    || Number.isNaN(Date.parse(receipt.createdAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) {
    fail('CLOUDFLARE_E_STAGING_SECRET_AUTHORIZATION');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!STAGING_SECRET_AUTHORIZATION_KEYS.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_STAGING_SECRET_AUTHORIZATION_EXPECTED');
    }
  }
  const created = Date.parse(receipt.createdAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < created - 120000 || now.getTime() >= expires
    || expires <= created || expires - created > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_STAGING_SECRET_AUTHORIZATION_EXPIRED');
  }
  return receipt;
}

export function cloudflareResourceDigest(value) {
  const normalized = Array.isArray(value)
    ? [...value].sort((left, right) => byteCompare(canonicalJson(left), canonicalJson(right)))
    : value;
  return sha256Hex(canonicalJson(normalized));
}

export function createVersionAttestationFromDetail({
  artifact,
  uploadResult,
  detail,
  now,
  expiresAt,
  environment = 'production',
  workerName = WORKER_NAME,
  expectedBindingsSha256 = artifact?.bindingsSha256,
  expectedAssetsConfigSha256 = artifact?.assetsConfigSha256,
}) {
  const artifactSha = environment === 'staging'
    ? stagingUploadArtifactSha256(artifact)
    : preuploadArtifactSha256(validatePreuploadArtifact(artifact));
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)
    || detail.id !== uploadResult?.versionId || !UUID.test(detail.id ?? '')
    || !ETAG.test(detail.resources?.script?.etag ?? '')
    || !Array.isArray(detail.resources?.bindings)
    || !detail.resources?.assets || typeof detail.resources.assets !== 'object'
    || !Array.isArray(detail.resources.script.handlers)
    || !detail.resources.script.handlers.includes('fetch')
    || detail.resources.script_runtime?.compatibility_date !== artifact.compatibilityDate
    || !Array.isArray(detail.resources.script_runtime?.compatibility_flags)
    || detail.resources.script_runtime.compatibility_flags.length !== 0
    || Number.isNaN(Date.parse(detail.metadata?.created_on ?? ''))
    || detail.annotations?.['workers/tag'] !== versionUploadTag(artifactSha)
    || detail.annotations?.['workers/message'] !== (environment === 'staging'
      ? stagingVersionUploadMessage(artifact) : versionUploadMessage(artifact))) {
    fail('CLOUDFLARE_E_VERSION_DETAIL');
  }
  const bindingsSha256 = cloudflareResourceDigest(detail.resources.bindings);
  const assetsConfigSha256 = cloudflareResourceDigest(detail.resources.assets);
  if (bindingsSha256 !== expectedBindingsSha256 || assetsConfigSha256 !== expectedAssetsConfigSha256) {
    fail('CLOUDFLARE_E_VERSION_DETAIL_BINDINGS');
  }
  const createdMs = Date.parse(detail.metadata.created_on);
  const uploadedMs = Date.parse(uploadResult.uploadedAt ?? '');
  const attestedMs = Date.parse(now ?? '');
  if (Number.isNaN(uploadedMs) || Number.isNaN(attestedMs)
    || Math.abs(uploadedMs - createdMs) > 5 * 60 * 1000 || createdMs > attestedMs + 120000) {
    fail('CLOUDFLARE_E_VERSION_DETAIL_WINDOW');
  }
  const receipt = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-version-attestation-v1',
    environment,
    artifactSha256: artifactSha,
    payloadSha256: artifact.payloadSha256,
    versionId: detail.id,
    scriptEtag: detail.resources.script.etag,
    bindingsSha256,
    assetsConfigSha256,
    workerName,
    accountIdSha256: environment === 'production'
      ? artifact.accountIdSha256
      : artifact.stagingAccountIdSha256,
    sourceGitSha: artifact.sourceGitSha,
    buildUuid: uploadResult.buildUuid,
    rawVersionDetailSha256: sha256Hex(canonicalJson(detail)),
    createdAt: now,
    expiresAt,
  };
  validateVersionAttestation(receipt, {
    expected: { environment, workerName, payloadSha256: artifact.payloadSha256 },
    now: new Date(now),
  });
  return receipt;
}

export function canonicalVersionAttestationPayload(receipt) {
  return canonicalJson(Object.fromEntries(ATTESTATION_KEYS.map((key) => [key, receipt[key]])));
}

export function validateVersionAttestation(receipt, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 900, maxFutureSkewSeconds = 120,
} = {}) {
  if (!exactKeys(receipt, ATTESTATION_KEYS)
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-version-attestation-v1'
    || !['production', 'staging'].includes(receipt.environment)
    || !SHA256.test(receipt.artifactSha256 ?? '') || !SHA256.test(receipt.payloadSha256 ?? '')
    || !UUID.test(receipt.versionId ?? '')
    || !ETAG.test(receipt.scriptEtag ?? '') || !SHA256.test(receipt.bindingsSha256 ?? '')
    || !SHA256.test(receipt.assetsConfigSha256 ?? '')
    || receipt.workerName !== (receipt.environment === 'production' ? WORKER_NAME : 'dwnc-me-staging')
    || !SHA256.test(receipt.accountIdSha256 ?? '') || !GIT_SHA1.test(receipt.sourceGitSha ?? '')
    || !UUID.test(receipt.buildUuid ?? '') || !SHA256.test(receipt.rawVersionDetailSha256 ?? '')
    || Number.isNaN(Date.parse(receipt.createdAt ?? '')) || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) {
    fail('CLOUDFLARE_E_VERSION_ATTESTATION');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!ATTESTATION_KEYS.includes(key) || receipt[key] !== value) fail('CLOUDFLARE_E_VERSION_EXPECTED');
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const createdMs = Date.parse(receipt.createdAt);
  const expiresMs = Date.parse(receipt.expiresAt);
  if (Number.isNaN(nowMs) || expiresMs <= createdMs
    || expiresMs - createdMs > maxLifetimeSeconds * 1000
    || createdMs - nowMs > maxFutureSkewSeconds * 1000 || nowMs >= expiresMs) {
    fail('CLOUDFLARE_E_VERSION_ATTESTATION_EXPIRED');
  }
  return receipt;
}

export function canonicalStagingSmokePayload(receipt) {
  return canonicalJson(Object.fromEntries(SMOKE_KEYS.map((key) => [key, receipt[key]])));
}

export function validateStagingSmokeReceipt(receipt, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 900,
} = {}) {
  if (!exactKeys(receipt, SMOKE_KEYS) || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-smoke-v1'
    || receipt.environment !== 'staging' || !SHA256.test(receipt.artifactSha256 ?? '')
    || !SHA256.test(receipt.payloadSha256 ?? '')
    || !UUID.test(receipt.versionId ?? '') || !UUID.test(receipt.stagingVersionId ?? '')
    || receipt.versionId === receipt.stagingVersionId
    || !SHA256.test(receipt.originSha256 ?? '') || !SHA256.test(receipt.accessPolicySha256 ?? '')
    || !SHA256.test(receipt.stagingVersionAttestationSha256 ?? '')
    || !SHA256.test(receipt.stagingDeploymentStatusSha256 ?? '')
    || !SHA256.test(receipt.rawProbeEvidenceSha256 ?? '')
    || !SHA256.test(receipt.stagingMediaProbeSha256 ?? '')
    || receipt.syntheticNonAccessOrigin !== true
    || !['get200', 'head200', 'notModified304', 'range206', 'range416', 'mimeVerified',
      'etagVerified', 'static200', 'redirects308', 'cachePathVerified',
      'versionMarkerVerified'].every((key) => receipt[key] === true)
    || receipt.stagingDeployment100 !== true || receipt.unauthenticatedDenied !== true
    || receipt.redirectCount !== 349 || Number.isNaN(Date.parse(receipt.observedAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_STAGING_SMOKE');
  for (const [key, value] of Object.entries(expected)) {
    if (!SMOKE_KEYS.includes(key) || receipt[key] !== value) fail('CLOUDFLARE_E_STAGING_SMOKE_EXPECTED');
  }
  const observed = Date.parse(receipt.observedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < observed - 120000 || now.getTime() >= expires
    || expires <= observed || expires - observed > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_STAGING_SMOKE_EXPIRED');
  }
  return receipt;
}

function sortedUniqueSha256(values) {
  if (!Array.isArray(values) || values.some((value) => !SHA256.test(value ?? ''))) {
    fail('CLOUDFLARE_E_PROMOTION_STATE');
  }
  const result = [...new Set(values)].sort(byteCompare);
  if (result.length !== values.length) fail('CLOUDFLARE_E_PROMOTION_STATE');
  return result;
}

function promotionSurface({
  previous, artifact, attestation, mediaManifest, publicPaths = null, publicPathHashes = null,
}) {
  validatePreuploadArtifact(artifact);
  validateVersionAttestation(attestation, {
    expected: {
      artifactSha256: preuploadArtifactSha256(artifact),
      payloadSha256: artifact.payloadSha256,
      environment: 'production',
      workerName: WORKER_NAME,
    },
    now: new Date(attestation.createdAt),
  });
  const providedPaths = Array.isArray(publicPaths)
    && publicPaths.every((value) => typeof value === 'string')
    ? publicPaths.map((value) => sha256Hex(value)) : null;
  const providedHashes = Array.isArray(publicPathHashes)
    && publicPathHashes.every((value) => SHA256.test(value ?? '')) ? publicPathHashes : null;
  if (!mediaManifest || mediaManifest.manifestSha256 !== artifact.mediaManifestSha256
    || (providedPaths === null) === (providedHashes === null)) {
    fail('CLOUDFLARE_E_PROMOTION_STATE');
  }
  if (previous) validatePromotionState(previous);
  const currentHashes = new Set(providedPaths ?? providedHashes);
  const previousAllowed = previous?.allowedKeyHashes ?? [];
  const withdrawn = new Set(previous?.withdrawnKeyHashes ?? []);
  for (const hash of previousAllowed) if (!currentHashes.has(hash)) withdrawn.add(hash);
  for (const hash of currentHashes) if (withdrawn.has(hash)) fail('CLOUDFLARE_E_PROMOTION_ROLLBACK');
  const allowedKeyHashes = [...currentHashes].sort(byteCompare);
  return { allowedKeyHashes, withdrawnKeyHashes: [...withdrawn].sort(byteCompare) };
}

export function createPromotionPlan({
  previous, artifact, attestation, mediaManifest, publicPaths = null, publicPathHashes = null,
}) {
  validatePromotionState(previous);
  const surface = promotionSurface({
    previous, artifact, attestation, mediaManifest, publicPaths, publicPathHashes,
  });
  const retiredArtifactSha256 = [...previous.retiredArtifactSha256];
  const retiredPayloadSha256 = [...previous.retiredPayloadSha256];
  const retiredVersionIds = [...previous.retiredVersionIds];
  if (previous.artifactSha256) retiredArtifactSha256.push(previous.artifactSha256);
  if (previous.payloadSha256) retiredPayloadSha256.push(previous.payloadSha256);
  if (previous.versionId) retiredVersionIds.push(previous.versionId);
  for (const values of [retiredArtifactSha256, retiredPayloadSha256, retiredVersionIds]) {
    values.sort(byteCompare);
  }
  const artifactSha256 = preuploadArtifactSha256(artifact);
  if (retiredArtifactSha256.includes(artifactSha256)
    || retiredPayloadSha256.includes(artifact.payloadSha256)
    || retiredVersionIds.includes(attestation.versionId)) fail('CLOUDFLARE_E_PROMOTION_ROLLBACK');
  return {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-plan-v1',
    expectedGeneration: previous.generation + 1,
    previousPromotionSha256: sha256Hex(canonicalPromotionStatePayload(previous)),
    artifactSha256,
    payloadSha256: artifact.payloadSha256,
    sourceGitSha: artifact.sourceGitSha,
    versionId: attestation.versionId,
    mediaManifestSha256: artifact.mediaManifestSha256,
    allowedKeysSha256: sha256Hex(surface.allowedKeyHashes.join('\n')),
    withdrawnKeyHashes: surface.withdrawnKeyHashes,
    allowedKeyHashes: surface.allowedKeyHashes,
    retiredArtifactSha256,
    retiredPayloadSha256,
    retiredVersionIds,
  };
}

export function validatePromotionPlan(plan) {
  if (!exactKeys(plan, PROMOTION_PLAN_KEYS) || plan.schemaVersion !== 1
    || plan.contract !== 'dwnc-cloudflare-promotion-plan-v1'
    || !Number.isSafeInteger(plan.expectedGeneration) || plan.expectedGeneration <= 0
    || !SHA256.test(plan.previousPromotionSha256 ?? '')
    || !SHA256.test(plan.artifactSha256 ?? '') || !SHA256.test(plan.payloadSha256 ?? '')
    || !GIT_SHA1.test(plan.sourceGitSha ?? '') || !UUID.test(plan.versionId ?? '')
    || !SHA256.test(plan.mediaManifestSha256 ?? '') || !SHA256.test(plan.allowedKeysSha256 ?? '')) {
    fail('CLOUDFLARE_E_PROMOTION_PLAN');
  }
  sortedUniqueSha256(plan.withdrawnKeyHashes);
  sortedUniqueSha256(plan.retiredArtifactSha256);
  sortedUniqueSha256(plan.retiredPayloadSha256);
  if (!Array.isArray(plan.retiredVersionIds)
    || plan.retiredVersionIds.some((value) => !UUID.test(value ?? ''))
    || new Set(plan.retiredVersionIds).size !== plan.retiredVersionIds.length
    || canonicalJson([...plan.retiredVersionIds].sort(byteCompare)) !== canonicalJson(plan.retiredVersionIds)) {
    fail('CLOUDFLARE_E_PROMOTION_PLAN');
  }
  if (sha256Hex(sortedUniqueSha256(plan.allowedKeyHashes).join('\n')) !== plan.allowedKeysSha256
    || plan.allowedKeyHashes.some((value) => plan.withdrawnKeyHashes.includes(value))) {
    fail('CLOUDFLARE_E_PROMOTION_PLAN');
  }
  return plan;
}

export const canonicalPromotionPlanPayload = canonicalJson;

export function createDeploymentStatusEvidence({
  rawStatus,
  targetVersionId,
  observedAt,
  environment = 'production',
  workerName = environment === 'production' ? WORKER_NAME : 'dwnc-me-staging',
}) {
  if (!rawStatus || typeof rawStatus !== 'object' || Array.isArray(rawStatus)
    || !UUID.test(rawStatus.id ?? '') || !Array.isArray(rawStatus.versions)
    || rawStatus.versions.length !== 1
    || rawStatus.versions[0]?.version_id !== targetVersionId
    || rawStatus.versions[0]?.percentage !== 100
    || !UUID.test(targetVersionId ?? '') || Number.isNaN(Date.parse(observedAt ?? ''))) {
    fail('CLOUDFLARE_E_DEPLOYMENT_STATUS');
  }
  return {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-deployment-status-evidence-v1',
    environment,
    workerName,
    targetVersionId,
    deploymentId: rawStatus.id,
    rawStatusSha256: sha256Hex(canonicalJson(rawStatus)),
    observedAt,
  };
}

export function validateDeploymentStatusEvidence(evidence, expected = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'workerName', 'targetVersionId',
    'deploymentId', 'rawStatusSha256', 'observedAt'];
  if (!exactKeys(evidence, keys) || evidence.schemaVersion !== 1
    || evidence.contract !== 'dwnc-cloudflare-deployment-status-evidence-v1'
    || !['production', 'staging'].includes(evidence.environment)
    || evidence.workerName !== (evidence.environment === 'production' ? WORKER_NAME : 'dwnc-me-staging')
    || !UUID.test(evidence.targetVersionId ?? '') || !UUID.test(evidence.deploymentId ?? '')
    || !SHA256.test(evidence.rawStatusSha256 ?? '')
    || Number.isNaN(Date.parse(evidence.observedAt ?? ''))) fail('CLOUDFLARE_E_DEPLOYMENT_STATUS');
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || evidence[key] !== value) fail('CLOUDFLARE_E_DEPLOYMENT_STATUS_EXPECTED');
  }
  return evidence;
}

export const canonicalDeploymentStatusEvidencePayload = canonicalJson;

export function classifyDeploymentStatus(rawStatus, { targetVersionId, previousVersionId = null }) {
  if (!rawStatus || typeof rawStatus !== 'object' || !Array.isArray(rawStatus.versions)
    || !rawStatus.versions.every((entry) => UUID.test(entry?.version_id ?? '')
      && typeof entry.percentage === 'number' && entry.percentage >= 0 && entry.percentage <= 100)
    || rawStatus.versions.reduce((sum, entry) => sum + entry.percentage, 0) !== 100) return 'unknown';
  if (rawStatus.versions.length === 1 && rawStatus.versions[0].version_id === targetVersionId
    && rawStatus.versions[0].percentage === 100) return 'committed';
  if (previousVersionId && rawStatus.versions.length === 1
    && rawStatus.versions[0].version_id === previousVersionId
    && rawStatus.versions[0].percentage === 100) return 'unchanged';
  return 'ambiguous';
}

export function reconcilePromotionState({ previous, plan, deploymentStatus, activatedAt }) {
  validatePromotionState(previous);
  validatePromotionPlan(plan);
  validateDeploymentStatusEvidence(deploymentStatus, { targetVersionId: plan.versionId });
  if (plan.previousPromotionSha256 !== sha256Hex(canonicalPromotionStatePayload(previous))
    || plan.expectedGeneration !== previous.generation + 1
    || Number.isNaN(Date.parse(activatedAt ?? ''))
    || activatedAt !== deploymentStatus.observedAt) fail('CLOUDFLARE_E_PROMOTION_CAS');
  return validatePromotionState({
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-state-v1',
    generation: plan.expectedGeneration,
    previousPromotionSha256: plan.previousPromotionSha256,
    artifactSha256: plan.artifactSha256,
    payloadSha256: plan.payloadSha256,
    sourceGitSha: plan.sourceGitSha,
    versionId: plan.versionId,
    mediaManifestSha256: plan.mediaManifestSha256,
    allowedKeysSha256: plan.allowedKeysSha256,
    withdrawnKeyHashes: plan.withdrawnKeyHashes,
    allowedKeyHashes: plan.allowedKeyHashes,
    retiredArtifactSha256: plan.retiredArtifactSha256,
    retiredPayloadSha256: plan.retiredPayloadSha256,
    retiredVersionIds: plan.retiredVersionIds,
    promotionPlanSha256: sha256Hex(canonicalPromotionPlanPayload(plan)),
    deploymentStatusSha256: sha256Hex(canonicalJson(deploymentStatus)),
    activatedAt,
  });
}

export function createPromotionGenesisState({ bootstrapVersionId = null, sourceGitSha = null } = {}) {
  if ((bootstrapVersionId === null) !== (sourceGitSha === null)
    || bootstrapVersionId !== null && (!UUID.test(bootstrapVersionId) || !GIT_SHA1.test(sourceGitSha))) {
    fail('CLOUDFLARE_E_PROMOTION_BOOTSTRAP');
  }
  return {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-state-v1',
    generation: 0,
    previousPromotionSha256: null,
    artifactSha256: null,
    payloadSha256: null,
    sourceGitSha,
    versionId: bootstrapVersionId,
    mediaManifestSha256: null,
    allowedKeysSha256: sha256Hex(''),
    withdrawnKeyHashes: [],
    allowedKeyHashes: [],
    retiredArtifactSha256: [],
    retiredPayloadSha256: [],
    retiredVersionIds: [],
    promotionPlanSha256: null,
    deploymentStatusSha256: null,
    activatedAt: null,
  };
}

export function validatePromotionState(state) {
  if (!exactKeys(state, PROMOTION_STATE_KEYS) || state.schemaVersion !== 1
    || state.contract !== 'dwnc-cloudflare-promotion-state-v1'
    || !Number.isSafeInteger(state.generation) || state.generation < 0
    || (state.previousPromotionSha256 !== null && !SHA256.test(state.previousPromotionSha256))
    || (state.generation === 0
      ? state.previousPromotionSha256 !== null || state.artifactSha256 !== null
        || state.payloadSha256 !== null
        || (state.versionId === null) !== (state.sourceGitSha === null)
        || state.versionId !== null && (!UUID.test(state.versionId) || !GIT_SHA1.test(state.sourceGitSha))
        || state.mediaManifestSha256 !== null
        || state.promotionPlanSha256 !== null || state.deploymentStatusSha256 !== null
        || state.activatedAt !== null
      : !SHA256.test(state.artifactSha256 ?? '') || !SHA256.test(state.payloadSha256 ?? '')
        || !GIT_SHA1.test(state.sourceGitSha ?? '') || !UUID.test(state.versionId ?? '')
        || !SHA256.test(state.mediaManifestSha256 ?? '')
        || !SHA256.test(state.promotionPlanSha256 ?? '')
        || !SHA256.test(state.deploymentStatusSha256 ?? '')
        || Number.isNaN(Date.parse(state.activatedAt ?? '')))
    || !SHA256.test(state.allowedKeysSha256 ?? '')) {
    fail('CLOUDFLARE_E_PROMOTION_STATE');
  }
  sortedUniqueSha256(state.withdrawnKeyHashes);
  sortedUniqueSha256(state.retiredArtifactSha256);
  sortedUniqueSha256(state.retiredPayloadSha256);
  if (!Array.isArray(state.retiredVersionIds)
    || state.retiredVersionIds.some((value) => !UUID.test(value ?? ''))
    || new Set(state.retiredVersionIds).size !== state.retiredVersionIds.length
    || canonicalJson([...state.retiredVersionIds].sort(byteCompare)) !== canonicalJson(state.retiredVersionIds)) {
    fail('CLOUDFLARE_E_PROMOTION_STATE');
  }
  if (sha256Hex(sortedUniqueSha256(state.allowedKeyHashes).join('\n')) !== state.allowedKeysSha256) {
    fail('CLOUDFLARE_E_PROMOTION_STATE');
  }
  return state;
}

export const canonicalPromotionStatePayload = canonicalJson;

export function canonicalPromotionAuthorizationPayload(receipt) {
  return canonicalJson(Object.fromEntries(PROMOTION_AUTHORIZATION_KEYS.map((key) => [key, receipt[key]])));
}

export function validatePromotionAuthorization(receipt, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 900,
} = {}) {
  if (!exactKeys(receipt, PROMOTION_AUTHORIZATION_KEYS) || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-promotion-authorization-v1'
    || receipt.environment !== 'production' || !SHA256.test(receipt.artifactSha256 ?? '')
    || !UUID.test(receipt.versionId ?? '') || !SHA256.test(receipt.activePromotionSha256 ?? '')
    || !SHA256.test(receipt.promotionPlanSha256 ?? '')
    || !SHA256.test(receipt.deploymentStatusBeforeSha256 ?? '')
    || !SHA256.test(receipt.deploymentArgumentsSha256 ?? '')
    || !UUID.test(receipt.buildUuid ?? '') || !SHA256.test(receipt.nonceSha256 ?? '')
    || Number.isNaN(Date.parse(receipt.createdAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_PROMOTION_AUTHORIZATION');
  for (const [key, value] of Object.entries(expected)) {
    if (!PROMOTION_AUTHORIZATION_KEYS.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_PROMOTION_AUTHORIZATION_EXPECTED');
    }
  }
  const created = Date.parse(receipt.createdAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < created - 120000 || now.getTime() >= expires
    || expires <= created || expires - created > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_PROMOTION_AUTHORIZATION_EXPIRED');
  }
  return receipt;
}

export function promotionCommand(versionId) {
  if (!UUID.test(versionId ?? '')) fail('CLOUDFLARE_E_PROMOTION_VERSION');
  return `wrangler versions deploy ${versionId}@100%`;
}

export function productionPromotionArguments({ versionId, artifactDirectory, planSha256 }) {
  if (!UUID.test(versionId ?? '') || !SHA256.test(planSha256 ?? '')
    || typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)) {
    fail('CLOUDFLARE_E_PROMOTION_ARGUMENTS');
  }
  return [
    'versions', 'deploy', `${versionId}@100%`, '--yes',
    '--message', `dwnc-promotion:${planSha256}`,
    '--env', 'production', '--config', path.join(artifactDirectory, 'wrangler-promotion.jsonc'),
    '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
  ];
}

export function stagingActivationArguments({ versionId, artifactDirectory, artifactSha256 }) {
  if (!UUID.test(versionId ?? '') || !SHA256.test(artifactSha256 ?? '')
    || typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)) {
    fail('CLOUDFLARE_E_STAGING_ACTIVATION_ARGUMENTS');
  }
  return [
    'versions', 'deploy', `${versionId}@100%`, '--yes',
    '--message', `dwnc-staging-activation:${artifactSha256}`,
    '--env', 'staging', '--config', path.join(artifactDirectory, 'wrangler-staging-promotion.jsonc'),
    '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
  ];
}

export function canonicalStagingActivationAuthorizationPayload(receipt) {
  return canonicalJson(Object.fromEntries(
    STAGING_ACTIVATION_AUTHORIZATION_KEYS.map((key) => [key, receipt[key]])));
}

export function validateStagingActivationAuthorization(receipt, {
  expected = {}, now = new Date(),
} = {}) {
  if (!exactKeys(receipt, STAGING_ACTIVATION_AUTHORIZATION_KEYS)
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-activation-authorization-v1'
    || receipt.environment !== 'staging' || receipt.workerName !== 'dwnc-me-staging'
    || ![receipt.artifactSha256, receipt.payloadSha256, receipt.accountIdSha256,
      receipt.originSha256, receipt.accessPolicySha256, receipt.deploymentStatusBeforeSha256,
      receipt.deploymentArgumentsSha256, receipt.nonceSha256].every((value) => SHA256.test(value ?? ''))
    || !UUID.test(receipt.versionId ?? '') || !UUID.test(receipt.buildUuid ?? '')
    || Number.isNaN(Date.parse(receipt.createdAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_STAGING_ACTIVATION_AUTH');
  for (const [key, value] of Object.entries(expected)) {
    if (!STAGING_ACTIVATION_AUTHORIZATION_KEYS.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_STAGING_ACTIVATION_AUTH_EXPECTED');
    }
  }
  const created = Date.parse(receipt.createdAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < created - 120000 || now.getTime() >= expires
    || expires <= created || expires - created > 10 * 60 * 1000) {
    fail('CLOUDFLARE_E_STAGING_ACTIVATION_AUTH_EXPIRED');
  }
  return receipt;
}

export function verifySignedPayload({ payload, canonicalPayload, validator, signature, publicKeyPem,
  expectedPublicKeySpkiSha256, validation = {} }) {
  validator(payload, validation);
  if (!Buffer.isBuffer(signature) || signature.length !== 64
    || !SHA256.test(expectedPublicKeySpkiSha256 ?? '')
    || publicKeySpkiSha256(publicKeyPem) !== expectedPublicKeySpkiSha256) fail('CLOUDFLARE_E_RELEASE_SIGNATURE');
  let valid = false;
  try {
    createPublicKey(publicKeyPem);
    valid = verifySignature(null, Buffer.from(canonicalPayload(payload)), publicKeyPem, signature);
  } catch { fail('CLOUDFLARE_E_RELEASE_SIGNATURE'); }
  if (!valid) fail('CLOUDFLARE_E_RELEASE_SIGNATURE');
  return true;
}

export async function loadSignedJsonFiles({ receiptPath, signaturePath, publicKeyPath }) {
  if (![receiptPath, signaturePath, publicKeyPath]
    .every((value) => typeof value === 'string' && path.isAbsolute(value))) {
    fail('CLOUDFLARE_E_RELEASE_FILES_REQUIRED');
  }
  let receiptRaw;
  let signatureRaw;
  let publicKeyPem;
  try {
    [receiptRaw, signatureRaw, publicKeyPem] = await Promise.all([
      readFile(receiptPath, 'utf8'), readFile(signaturePath, 'utf8'), readFile(publicKeyPath, 'utf8'),
    ]);
  } catch { fail('CLOUDFLARE_E_RELEASE_FILES_REQUIRED'); }
  let receipt;
  try { receipt = JSON.parse(receiptRaw); }
  catch { fail('CLOUDFLARE_E_RELEASE_RECEIPT'); }
  if (!/^[A-Za-z0-9+/]{86}==$/u.test(signatureRaw.trim())) fail('CLOUDFLARE_E_RELEASE_SIGNATURE');
  return { receipt, signature: Buffer.from(signatureRaw.trim(), 'base64'), publicKeyPem };
}

async function walkFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) fail('CLOUDFLARE_E_RELEASE_ARTIFACT');
    if (stats.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (stats.isFile() && stats.nlink === 1) files.push(path.relative(root, absolute));
    else fail('CLOUDFLARE_E_RELEASE_ARTIFACT');
  }
  return files;
}

export async function directoryArtifactSha256(directory, { exclude = () => false } = {}) {
  const digest = createHash('sha256');
  const files = (await walkFiles(directory)).filter((relative) => !exclude(relative)).sort(byteCompare);
  for (const relative of files) {
    digest.update(relative).update('\0').update(await readFile(path.join(directory, relative))).update('\0');
  }
  return { sha256: digest.digest('hex'), files: files.length };
}
