import { createHash } from 'node:crypto';

const fail = (code) => { throw new Error(code); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const canonicalStagingMediaProbePayload = canonicalJson;

export function validateStagingMediaProbeReceipt(receipt, { expected = {}, now = new Date() } = {}) {
  const keys = [
    'schemaVersion', 'contract', 'environment', 'artifactSha256', 'payloadSha256',
    'stagingVersionId', 'originSha256', 'accountIdSha256', 'bucket', 'manifestSha256',
    'keySha256', 'versionSha256', 'httpEtagSha256', 's3HeadVerified',
    'workerBindingVerified', 'fullBodySha256Verified', 'rangeVerified', 'observedAt', 'expiresAt',
  ];
  if (!receipt || Object.keys(receipt).length !== keys.length
    || Object.keys(receipt).some((key) => !keys.includes(key))
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-one-object-probe-v1'
    || receipt.environment !== 'staging'
    || ![receipt.artifactSha256, receipt.payloadSha256, receipt.originSha256,
      receipt.accountIdSha256, receipt.manifestSha256, receipt.keySha256,
      receipt.versionSha256, receipt.httpEtagSha256].every((value) => SHA256.test(value ?? ''))
    || !UUID.test(receipt.stagingVersionId ?? '')
    || receipt.bucket !== 'dwnc-me-public-media-staging'
    || !['s3HeadVerified', 'workerBindingVerified', 'fullBodySha256Verified', 'rangeVerified']
      .every((key) => receipt[key] === true)
    || Number.isNaN(Date.parse(receipt.observedAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) fail('CLOUDFLARE_E_STAGING_PROBE_RECEIPT');
  for (const [key, value] of Object.entries(expected)) {
    if (!keys.includes(key) || receipt[key] !== value) fail('CLOUDFLARE_E_STAGING_PROBE_EXPECTED');
  }
  const observed = Date.parse(receipt.observedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < observed - 120000 || now.getTime() >= expires
    || expires <= observed || expires - observed > 15 * 60 * 1000) {
    fail('CLOUDFLARE_E_STAGING_PROBE_EXPIRED');
  }
  return receipt;
}

async function responseBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

async function collectStagingHttpContract({
  fetcher, unauthenticatedFetcher, origin, stagingVersionId, stagingDeployment100,
  mediaEntry, staticPath, redirects,
}) {
  if (typeof fetcher !== 'function' || typeof unauthenticatedFetcher !== 'function'
    || !/^https:\/\//u.test(origin ?? '')
    || !Array.isArray(redirects) || redirects.length !== 349) fail('CLOUDFLARE_E_SMOKE_INPUT');
  const mediaUrl = new URL(mediaEntry.publicPath, origin).href;
  const isCandidateVersion = (response) => response.headers.get('x-dwnc-staging-version') === stagingVersionId;
  const get = await fetcher(mediaUrl, { method: 'GET' });
  const etag = get.headers.get('etag');
  const contentType = get.headers.get('content-type');
  const getBody = await responseBytes(get.clone());
  const get200 = get.status === 200 && sha256(getBody) === mediaEntry.sha256;
  const head = await fetcher(mediaUrl, { method: 'HEAD' });
  const head200 = head.status === 200 && head.headers.get('etag') === etag
    && head.headers.get('content-length') === String(mediaEntry.size);
  const notModified = await fetcher(mediaUrl, { headers: { 'if-none-match': etag ?? '' } });
  const range = await fetcher(mediaUrl, { headers: { range: 'bytes=0-0' } });
  const rangeBody = await responseBytes(range.clone());
  const invalidRange = await fetcher(mediaUrl, { headers: { range: 'bytes=0-0,2-2' } });
  const staticResponse = await fetcher(new URL(staticPath, origin).href);
  let redirects308 = true;
  for (const redirect of redirects) {
    const response = await fetcher(new URL(redirect.from, origin).href, { redirect: 'manual' });
    if (response.status !== 308 || response.headers.get('location') !== redirect.to
      || !isCandidateVersion(response)) {
      redirects308 = false;
      break;
    }
  }
  let cached;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    cached = await fetcher(mediaUrl, { headers: { 'x-dwnc-smoke-cache-probe': '1' } });
    if (cached.status === 200 && cached.headers.get('x-dwnc-cache-probe') === 'HIT') break;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  const unauthenticated = await unauthenticatedFetcher(mediaUrl, { method: 'GET' });
  const versionMarkerVerified = [get, head, notModified, range, invalidRange, staticResponse, cached]
    .every((response) => isCandidateVersion(response));
  const rawProbeEvidenceSha256 = sha256(JSON.stringify({
    get: get.status, head: head.status, conditional: notModified.status, range: range.status,
    invalidRange: invalidRange.status, static: staticResponse.status, redirects308,
    cache: cached.headers.get('x-dwnc-cache-probe'), unauthenticated: unauthenticated.status,
    etag, contentType, versionMarkerVerified,
    rangeEtag: range.headers.get('etag'), rangeContentRange: range.headers.get('content-range'),
    rangeContentLength: range.headers.get('content-length'), rangeBodySha256: sha256(rangeBody),
  }));
  return {
    rawProbeEvidenceSha256,
    syntheticNonAccessOrigin: true,
    get200,
    head200,
    notModified304: notModified.status === 304,
    range206: range.status === 206
      && range.headers.get('etag') === etag
      && range.headers.get('content-range') === `bytes 0-0/${mediaEntry.size}`
      && range.headers.get('content-length') === '1'
      && rangeBody.length === 1 && getBody.length > 0 && rangeBody[0] === getBody[0],
    range416: invalidRange.status === 416,
    mimeVerified: contentType === mediaEntry.contentType,
    etagVerified: typeof etag === 'string' && /^"[^"\r\n]+"$/u.test(etag),
    static200: staticResponse.status === 200,
    redirects308,
    redirectCount: redirects.length,
    cachePathVerified: cached.status === 200 && cached.headers.get('x-dwnc-cache-probe') === 'HIT',
    stagingDeployment100: stagingDeployment100 === true,
    unauthenticatedDenied: [401, 403, 404].includes(unauthenticated.status),
    versionMarkerVerified,
  };
}

export async function collectStagingSmokeEvidence({
  fetcher,
  unauthenticatedFetcher,
  origin,
  artifactSha256,
  payloadSha256,
  versionId,
  stagingVersionId,
  accessPolicySha256,
  stagingVersionAttestationSha256,
  stagingDeploymentStatusSha256,
  stagingMediaProbeSha256,
  stagingDeployment100,
  mediaEntry,
  staticPath,
  redirects,
  observedAt,
  expiresAt,
}) {
  const evidence = await collectStagingHttpContract({
    fetcher, unauthenticatedFetcher, origin, stagingVersionId, stagingDeployment100,
    mediaEntry, staticPath, redirects,
  });
  return {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-staging-smoke-v1',
    environment: 'staging',
    artifactSha256,
    payloadSha256,
    versionId,
    stagingVersionId,
    originSha256: sha256(origin),
    accessPolicySha256,
    stagingVersionAttestationSha256,
    stagingDeploymentStatusSha256,
    stagingMediaProbeSha256,
    ...evidence,
    observedAt,
    expiresAt,
  };
}

const STAGING_ADMISSION_SMOKE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'environment', 'artifactSha256', 'payloadSha256',
  'stagingVersionId', 'originSha256', 'accessPolicySha256',
  'stagingVersionAttestationSha256', 'stagingDeploymentStatusSha256',
  'rawProbeEvidenceSha256', 'stagingMediaProbeSha256',
  'syntheticNonAccessOrigin', 'get200', 'head200', 'notModified304', 'range206',
  'range416', 'mimeVerified', 'etagVerified', 'static200', 'redirects308',
  'redirectCount', 'cachePathVerified', 'stagingDeployment100', 'unauthenticatedDenied',
  'versionMarkerVerified', 'observedAt', 'expiresAt',
]);

export function canonicalStagingAdmissionSmokePayload(receipt) {
  return canonicalJson(Object.fromEntries(
    STAGING_ADMISSION_SMOKE_KEYS.map((key) => [key, receipt[key]])));
}

export function validateStagingAdmissionSmokeReceipt(receipt, {
  expected = {}, now = new Date(), maxLifetimeSeconds = 900,
} = {}) {
  if (!receipt || Object.keys(receipt).length !== STAGING_ADMISSION_SMOKE_KEYS.length
    || Object.keys(receipt).some((key) => !STAGING_ADMISSION_SMOKE_KEYS.includes(key))
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-cloudflare-staging-admission-smoke-v1'
    || receipt.environment !== 'staging'
    || ![receipt.artifactSha256, receipt.payloadSha256, receipt.originSha256,
      receipt.accessPolicySha256, receipt.stagingVersionAttestationSha256,
      receipt.stagingDeploymentStatusSha256, receipt.rawProbeEvidenceSha256,
      receipt.stagingMediaProbeSha256].every((value) => SHA256.test(value ?? ''))
    || !UUID.test(receipt.stagingVersionId ?? '')
    || receipt.syntheticNonAccessOrigin !== true
    || !['get200', 'head200', 'notModified304', 'range206', 'range416', 'mimeVerified',
      'etagVerified', 'static200', 'redirects308', 'cachePathVerified',
      'versionMarkerVerified'].every((key) => receipt[key] === true)
    || receipt.stagingDeployment100 !== true || receipt.unauthenticatedDenied !== true
    || receipt.redirectCount !== 349
    || Number.isNaN(Date.parse(receipt.observedAt ?? ''))
    || Number.isNaN(Date.parse(receipt.expiresAt ?? ''))) {
    fail('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!STAGING_ADMISSION_SMOKE_KEYS.includes(key) || receipt[key] !== value) {
      fail('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_EXPECTED');
    }
  }
  const observed = Date.parse(receipt.observedAt);
  const expires = Date.parse(receipt.expiresAt);
  if (now.getTime() < observed - 120000 || now.getTime() >= expires
    || expires <= observed || expires - observed > maxLifetimeSeconds * 1000) {
    fail('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_EXPIRED');
  }
  return receipt;
}

export async function collectStagingAdmissionSmokeEvidence({
  fetcher,
  unauthenticatedFetcher,
  origin,
  artifactSha256,
  payloadSha256,
  stagingVersionId,
  accessPolicySha256,
  stagingVersionAttestationSha256,
  stagingDeploymentStatusSha256,
  stagingMediaProbeSha256,
  stagingDeployment100,
  mediaEntry,
  staticPath,
  redirects,
  observedAt,
  expiresAt,
}) {
  const evidence = await collectStagingHttpContract({
    fetcher, unauthenticatedFetcher, origin, stagingVersionId, stagingDeployment100,
    mediaEntry, staticPath, redirects,
  });
  const receipt = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-staging-admission-smoke-v1',
    environment: 'staging',
    artifactSha256,
    payloadSha256,
    stagingVersionId,
    originSha256: sha256(origin),
    accessPolicySha256,
    stagingVersionAttestationSha256,
    stagingDeploymentStatusSha256,
    stagingMediaProbeSha256,
    ...evidence,
    observedAt,
    expiresAt,
  };
  validateStagingAdmissionSmokeReceipt(receipt, { now: new Date(observedAt) });
  return receipt;
}

export async function probeStagingMediaObject({ client, fetcher, origin, entry, stagingVersionId }) {
  if (!client || typeof client.head !== 'function' || typeof fetcher !== 'function') {
    fail('CLOUDFLARE_E_STAGING_PROBE_INPUT');
  }
  const remote = await client.head(entry.key);
  if (!remote || remote.key !== entry.key || remote.size !== entry.size
    || remote.sha256 !== entry.sha256 || remote.platformChecksumSha256 !== entry.sha256
    || typeof remote.version !== 'string' || typeof remote.httpEtag !== 'string') {
    fail('CLOUDFLARE_E_STAGING_PROBE_S3');
  }
  const url = new URL(entry.publicPath, origin).href;
  const full = await fetcher(url);
  const range = await fetcher(url, { headers: { range: 'bytes=0-0' } });
  const [fullBody, rangeBody] = await Promise.all([
    responseBytes(full.clone()), responseBytes(range.clone()),
  ]);
  if (full.status !== 200 || fullBody.length !== entry.size || sha256(fullBody) !== entry.sha256
    || full.headers.get('etag') !== remote.httpEtag
    || range.status !== 206 || range.headers.get('etag') !== remote.httpEtag
    || range.headers.get('content-range') !== `bytes 0-0/${entry.size}`
    || range.headers.get('content-length') !== '1'
    || rangeBody.length !== 1 || fullBody.length === 0 || rangeBody[0] !== fullBody[0]
    || !UUID.test(stagingVersionId ?? '')
    || full.headers.get('x-dwnc-staging-version') !== stagingVersionId
    || range.headers.get('x-dwnc-staging-version') !== stagingVersionId) {
    fail('CLOUDFLARE_E_STAGING_PROBE_WORKER');
  }
  return {
    keySha256: sha256(entry.key),
    versionSha256: sha256(remote.version),
    httpEtagSha256: sha256(remote.httpEtag),
    s3HeadVerified: true,
    workerBindingVerified: true,
    fullBodySha256Verified: true,
    rangeVerified: true,
  };
}
