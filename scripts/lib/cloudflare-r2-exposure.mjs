import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const ENVIRONMENTS = new Set(['staging', 'production']);
const SAFE_BUCKET_PROPERTY = /^[A-Za-z0-9_-]{1,64}$/u;
const R2_JURISDICTION = 'default';

function fail(code) { throw new Error(code); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function parseEnvelope(rawBody, kind) {
  let parsed;
  try { parsed = JSON.parse(rawBody); }
  catch { fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE'); }
  if (!parsed || parsed.success !== true || !Array.isArray(parsed.errors)
    || parsed.errors.length !== 0 || !Array.isArray(parsed.messages)) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  }
  if (kind === 'managed') {
    if (!parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)
      || typeof parsed.result.enabled !== 'boolean') fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
    return { enabled: parsed.result.enabled };
  }
  if (kind === 'bucket') {
    if (!parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)
      || !BUCKET.test(parsed.result.name ?? '')
      || !SAFE_BUCKET_PROPERTY.test(parsed.result.location ?? '')
      || !SAFE_BUCKET_PROPERTY.test(parsed.result.storage_class ?? '')) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
    }
    return {
      name: parsed.result.name,
      location: parsed.result.location,
      storageClass: parsed.result.storage_class,
    };
  }
  if (!parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)
    || !Array.isArray(parsed.result.domains)) fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  return { domains: parsed.result.domains };
}

export function r2ExposureRequestSha256({ environment, bucket, accountIdSha256 }) {
  if (!ENVIRONMENTS.has(environment) || !BUCKET.test(bucket ?? '')
    || !SHA256.test(accountIdSha256 ?? '')) fail('CLOUDFLARE_E_R2_EXPOSURE_REQUEST');
  return sha256Hex(canonicalJson({
    method: 'GET',
    environment,
    bucket,
    accountIdSha256,
    jurisdiction: R2_JURISDICTION,
    resources: ['r2-bucket-properties', 'r2-managed-domain', 'r2-custom-domains'],
  }));
}

export function canonicalR2ExposureEvidencePayload(evidence) { return canonicalJson(evidence); }

export function validateR2ExposureEvidence(evidence, {
  expected = {}, now = new Date(), requirePrivate = true, maxLifetimeSeconds = 900,
  maxFutureSkewSeconds = 120,
} = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'bucket', 'accountIdSha256',
    'jurisdiction', 'location', 'storageClass', 'bucketPropertiesSha256',
    'r2DevEnabled', 'customDomainCount', 'managedDomainSha256', 'customDomainsSha256',
    'observedAt', 'expiresAt'];
  if (!exactKeys(evidence, keys) || evidence.schemaVersion !== 1
    || evidence.contract !== 'dwnc-cloudflare-r2-private-exposure-v1'
    || !ENVIRONMENTS.has(evidence.environment) || !BUCKET.test(evidence.bucket ?? '')
    || !SHA256.test(evidence.accountIdSha256 ?? '')
    || evidence.jurisdiction !== R2_JURISDICTION
    || !SAFE_BUCKET_PROPERTY.test(evidence.location ?? '')
    || !SAFE_BUCKET_PROPERTY.test(evidence.storageClass ?? '')
    || !SHA256.test(evidence.bucketPropertiesSha256 ?? '')
    || typeof evidence.r2DevEnabled !== 'boolean'
    || !Number.isSafeInteger(evidence.customDomainCount) || evidence.customDomainCount < 0
    || !SHA256.test(evidence.managedDomainSha256 ?? '')
    || !SHA256.test(evidence.customDomainsSha256 ?? '')
    || Number.isNaN(Date.parse(evidence.observedAt ?? ''))
    || Number.isNaN(Date.parse(evidence.expiresAt ?? ''))) fail('CLOUDFLARE_E_R2_EXPOSURE');
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || evidence[key] !== value) fail('CLOUDFLARE_E_R2_EXPOSURE_EXPECTED');
  }
  if (requirePrivate && (evidence.r2DevEnabled !== false || evidence.customDomainCount !== 0)) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_PUBLIC');
  }
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const observed = Date.parse(evidence.observedAt);
  const expires = Date.parse(evidence.expiresAt);
  if (!Number.isSafeInteger(maxLifetimeSeconds) || maxLifetimeSeconds < 1
    || !Number.isSafeInteger(maxFutureSkewSeconds) || maxFutureSkewSeconds < 0
    || Number.isNaN(nowMs) || nowMs < observed - maxFutureSkewSeconds * 1000 || nowMs >= expires
    || expires <= observed || expires - observed > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_EXPIRED');
  }
  return evidence;
}

export function canonicalR2ExposureCapturePayload(capture) { return canonicalJson(capture); }

export function validateR2ExposureCapture(capture, options = {}) {
  const keys = ['schemaVersion', 'contract', 'requestSha256', 'bucketRawBody',
    'bucketRawBodySha256', 'managedRawBody',
    'managedRawBodySha256', 'customRawBody', 'customRawBodySha256', 'evidence'];
  if (!exactKeys(capture, keys) || capture.schemaVersion !== 1
    || capture.contract !== 'dwnc-cloudflare-r2-private-exposure-capture-v1'
    || !SHA256.test(capture.requestSha256 ?? '')
    || typeof capture.bucketRawBody !== 'string'
    || typeof capture.managedRawBody !== 'string' || typeof capture.customRawBody !== 'string'
    || Buffer.byteLength(capture.bucketRawBody) > 1024 * 1024
    || Buffer.byteLength(capture.managedRawBody) > 1024 * 1024
    || Buffer.byteLength(capture.customRawBody) > 1024 * 1024
    || sha256Hex(capture.bucketRawBody) !== capture.bucketRawBodySha256
    || sha256Hex(capture.managedRawBody) !== capture.managedRawBodySha256
    || sha256Hex(capture.customRawBody) !== capture.customRawBodySha256) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');
  }
  const bucketProperties = parseEnvelope(capture.bucketRawBody, 'bucket');
  const managed = parseEnvelope(capture.managedRawBody, 'managed');
  const custom = parseEnvelope(capture.customRawBody, 'custom');
  validateR2ExposureEvidence(capture.evidence, options);
  if (bucketProperties.name !== capture.evidence.bucket
    || bucketProperties.location !== capture.evidence.location
    || bucketProperties.storageClass !== capture.evidence.storageClass
    || capture.bucketRawBodySha256 !== capture.evidence.bucketPropertiesSha256
    || capture.evidence.r2DevEnabled !== managed.enabled
    || capture.evidence.customDomainCount !== custom.domains.length
    || capture.evidence.managedDomainSha256 !== capture.managedRawBodySha256
    || capture.evidence.customDomainsSha256 !== capture.customRawBodySha256
    || capture.requestSha256 !== r2ExposureRequestSha256(capture.evidence)) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');
  }
  return capture;
}

export async function fetchR2ExposureCapture({
  environment,
  bucket,
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  ttlSeconds = 900,
  jurisdiction = R2_JURISDICTION,
}) {
  if (!ENVIRONMENTS.has(environment) || !BUCKET.test(bucket ?? '')
    || typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || typeof apiToken !== 'string' || apiToken.length === 0 || apiToken.length > 4096
    || jurisdiction !== R2_JURISDICTION
    || typeof fetchImpl !== 'function' || !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < 15 || ttlSeconds > 900) fail('CLOUDFLARE_E_R2_EXPOSURE_REQUEST');
  const accountIdSha256 = cloudflareAccountIdSha256(accountId.toLowerCase());
  const bucketUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}`;
  const read = async (url) => {
    let response;
    let rawBody;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'cf-r2-jurisdiction': jurisdiction,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      rawBody = await response.text();
    } catch { fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH'); }
    if (response.status !== 200 || typeof rawBody !== 'string'
      || Buffer.byteLength(rawBody) > 1024 * 1024) fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
    return rawBody;
  };
  const bucketRawBody = await read(bucketUrl);
  const bucketProperties = parseEnvelope(bucketRawBody, 'bucket');
  if (bucketProperties.name !== bucket) fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  const [managedRawBody, customRawBody] = await Promise.all([
    read(`${bucketUrl}/domains/managed`), read(`${bucketUrl}/domains/custom`),
  ]);
  const managed = parseEnvelope(managedRawBody, 'managed');
  const custom = parseEnvelope(customRawBody, 'custom');
  const observed = now();
  if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  }
  const evidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-r2-private-exposure-v1',
    environment,
    bucket,
    accountIdSha256,
    jurisdiction,
    location: bucketProperties.location,
    storageClass: bucketProperties.storageClass,
    bucketPropertiesSha256: sha256Hex(bucketRawBody),
    r2DevEnabled: managed.enabled,
    customDomainCount: custom.domains.length,
    managedDomainSha256: sha256Hex(managedRawBody),
    customDomainsSha256: sha256Hex(customRawBody),
    observedAt: observed.toISOString(),
    expiresAt: new Date(observed.getTime() + ttlSeconds * 1000).toISOString(),
  };
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-r2-private-exposure-capture-v1',
    requestSha256: r2ExposureRequestSha256(evidence),
    bucketRawBody,
    bucketRawBodySha256: evidence.bucketPropertiesSha256,
    managedRawBody,
    managedRawBodySha256: evidence.managedDomainSha256,
    customRawBody,
    customRawBodySha256: evidence.customDomainsSha256,
    evidence,
  };
  validateR2ExposureCapture(capture, { now: observed, requirePrivate: true });
  return capture;
}

export function remoteReceiptBucketExposure(capture, options = {}) {
  validateR2ExposureCapture(capture, options);
  return {
    verification: 'cloudflare-control-plane',
    jurisdiction: capture.evidence.jurisdiction,
    location: capture.evidence.location,
    storageClass: capture.evidence.storageClass,
    bucketPropertiesSha256: capture.evidence.bucketPropertiesSha256,
    r2DevEnabled: capture.evidence.r2DevEnabled,
    customDomainCount: capture.evidence.customDomainCount,
    verifiedAt: capture.evidence.observedAt,
    evidenceSha256: sha256Hex(canonicalR2ExposureEvidencePayload(capture.evidence)),
  };
}
