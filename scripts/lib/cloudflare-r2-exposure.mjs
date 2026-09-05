import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify, TextDecoder } from 'node:util';
import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import {
  cloudflareOAuthWranglerEnvironment,
  inspectCloudflareOAuthAccount,
} from './cloudflare-process.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OID = /^[a-f0-9]{40}$/u;
const ACCOUNT_ID = /^[A-Fa-f0-9]{32}$/u;
const API_TOKEN = /^[A-Za-z0-9._~+\/-]{20,256}={0,2}$/u;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const SAFE_BUCKET_PROPERTY = /^[A-Za-z0-9_-]{1,64}$/u;
const REQUEST_METHOD_KEYS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MAXIMUM_RESPONSE_BODY_BYTES = 1024 * 1024;

export const STAGING_R2_EXPOSURE_PURPOSE = 'staging-r2-private-exposure-read';
export const STAGING_R2_EXPOSURE_BUCKET = 'dwnc-me-public-media-staging';
export const PRODUCTION_R2_EXPOSURE_PURPOSE = 'production-r2-private-exposure-read';
export const PRODUCTION_R2_EXPOSURE_BUCKET = 'dwnc-me-public-media-production';
export const STAGING_R2_EXPOSURE_JURISDICTION = 'default';
export const STAGING_R2_EXPOSURE_LOCATION = 'apac';
export const STAGING_R2_EXPOSURE_STORAGE_CLASS = 'Standard';
export const R2_EXPOSURE_TARGETS = Object.freeze({
  staging: Object.freeze({
    environment: 'staging',
    purpose: STAGING_R2_EXPOSURE_PURPOSE,
    bucket: STAGING_R2_EXPOSURE_BUCKET,
    location: STAGING_R2_EXPOSURE_LOCATION,
    storageClass: STAGING_R2_EXPOSURE_STORAGE_CLASS,
  }),
  production: Object.freeze({
    environment: 'production',
    purpose: PRODUCTION_R2_EXPOSURE_PURPOSE,
    bucket: PRODUCTION_R2_EXPOSURE_BUCKET,
    location: null,
    storageClass: null,
  }),
});

function fail(code) { throw new Error(code); }
function exposureTarget(environment) {
  return Object.hasOwn(R2_EXPOSURE_TARGETS, environment)
    ? R2_EXPOSURE_TARGETS[environment] : null;
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

async function readBoundedUtf8ResponseBody(response,
  maximumBytes = MAXIMUM_RESPONSE_BODY_BYTES) {
  if (!response?.body || typeof response.body.getReader !== 'function'
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
  }
  let reader;
  let byob = false;
  try {
    reader = response.body.getReader({ mode: 'byob' });
    byob = true;
  } catch {
    try { reader = response.body.getReader(); }
    catch { fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH'); }
  }
  const chunks = [];
  let total = 0;
  let complete = false;
  let cancelRequested = false;
  const cancel = async () => {
    if (cancelRequested) return;
    cancelRequested = true;
    try { await reader.cancel('CLOUDFLARE_E_R2_EXPOSURE_FETCH'); }
    catch { /* The bounded failure remains authoritative. */ }
  };
  try {
    while (true) {
      const result = byob
        ? await reader.read(new Uint8Array(Math.min(
          64 * 1024,
          maximumBytes + 1 - total,
        )))
        : await reader.read();
      if (!result || typeof result.done !== 'boolean') {
        await cancel();
        fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
      }
      if (result.done) {
        complete = true;
        break;
      }
      if (!(result.value instanceof Uint8Array) || result.value.byteLength === 0) {
        await cancel();
        fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
      }
      if (total + result.value.byteLength > maximumBytes) {
        await cancel();
        fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
      }
      const copy = Buffer.from(result.value);
      chunks.push(copy);
      total += copy.length;
    }
    if (!complete || total === 0) fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
    const bytes = Buffer.concat(chunks, total);
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH'); }
    finally { bytes.fill(0); }
  } catch (error) {
    if (!complete) await cancel();
    if (error?.message === 'CLOUDFLARE_E_R2_EXPOSURE_FETCH') throw error;
    fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    try { reader.releaseLock(); }
    catch { /* The body is already rejected or completely consumed. */ }
  }
}

function parseEnvelope(rawBody, kind, jurisdiction = STAGING_R2_EXPOSURE_JURISDICTION) {
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
    const result = parsed.result;
    const responseJurisdiction = result?.jurisdiction ?? jurisdiction;
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || !BUCKET.test(result.name ?? '')
      || typeof result.creation_date !== 'string'
      || Number.isNaN(Date.parse(result.creation_date))
      || typeof result.location !== 'string'
      || !SAFE_BUCKET_PROPERTY.test(result.location)
      || typeof result.storage_class !== 'string'
      || !SAFE_BUCKET_PROPERTY.test(result.storage_class)
      || responseJurisdiction !== jurisdiction) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
    }
    return {
      name: result.name,
      createdAt: new Date(Date.parse(result.creation_date)).toISOString(),
      jurisdiction: responseJurisdiction,
      location: result.location.toLowerCase(),
      storageClass: result.storage_class,
    };
  }
  if (!parsed.result || typeof parsed.result !== 'object' || Array.isArray(parsed.result)
    || !Array.isArray(parsed.result.domains)) fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  return { domains: parsed.result.domains };
}

export function r2ExposureRequestAudit(bucket = STAGING_R2_EXPOSURE_BUCKET,
  jurisdiction = STAGING_R2_EXPOSURE_JURISDICTION) {
  const base = `/accounts/{account_id}/r2/buckets/${bucket}`;
  return {
    attempts: 1,
    count: 3,
    methods: { GET: 3, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 },
    requests: [
      { attempt: 1, method: 'GET', path: base, jurisdiction },
      { attempt: 1, method: 'GET', path: `${base}/domains/managed`, jurisdiction },
      { attempt: 1, method: 'GET', path: `${base}/domains/custom`, jurisdiction },
    ],
  };
}

export function productionR2ExposureRequestAudit(
  bucket = PRODUCTION_R2_EXPOSURE_BUCKET,
  jurisdiction = STAGING_R2_EXPOSURE_JURISDICTION,
) {
  const base = `/accounts/{account_id}/r2/buckets/${bucket}`;
  return {
    scope: 'r2-state-calls-after-oauth-preflight',
    authenticationPreflight: {
      includedInCount: false,
      kind: 'wrangler',
      argv: ['whoami', '--json'],
    },
    attempts: 1,
    count: 4,
    methods: { GET: 3, HEAD: 0, POST: 1, PUT: 0, PATCH: 0, DELETE: 0 },
    requests: [
      {
        attempt: 1, method: 'GET', transport: 'REST',
        path: base, jurisdiction, command: 'r2 bucket info --json',
      },
      {
        attempt: 1, method: 'POST', transport: 'GraphQL',
        path: '/graphql', jurisdiction, command: 'r2 bucket info --json',
        operation: 'getR2StorageMetrics',
      },
      {
        attempt: 1, method: 'GET', transport: 'REST',
        path: `${base}/domains/managed`, jurisdiction, command: 'r2 bucket dev-url get',
      },
      {
        attempt: 1, method: 'GET', transport: 'REST',
        path: `${base}/domains/custom`, jurisdiction, command: 'r2 bucket domain list',
      },
    ],
    commands: [
      { attempt: 1, kind: 'wrangler', argv: ['r2', 'bucket', 'info', bucket, '--json'] },
      { attempt: 1, kind: 'wrangler', argv: ['r2', 'bucket', 'dev-url', 'get', bucket] },
      { attempt: 1, kind: 'wrangler', argv: ['r2', 'bucket', 'domain', 'list', bucket] },
    ],
  };
}

export function validateR2ExposureRequestAudit(audit, {
  bucket = STAGING_R2_EXPOSURE_BUCKET,
  jurisdiction = STAGING_R2_EXPOSURE_JURISDICTION,
  environment = 'staging',
} = {}) {
  if (environment === 'production') {
    const expected = productionR2ExposureRequestAudit(bucket, jurisdiction);
    if (!exactKeys(audit, [
      'scope', 'authenticationPreflight', 'attempts', 'count', 'methods', 'requests', 'commands',
    ])
      || canonicalJson(audit) !== canonicalJson(expected)) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_METHODS');
    }
    return audit;
  }
  if (environment !== 'staging') fail('CLOUDFLARE_E_R2_EXPOSURE_METHODS');
  const expected = r2ExposureRequestAudit(bucket, jurisdiction);
  if (!exactKeys(audit, ['attempts', 'count', 'methods', 'requests'])
    || audit.attempts !== 1 || audit.count !== 3
    || !exactKeys(audit.methods, REQUEST_METHOD_KEYS)
    || REQUEST_METHOD_KEYS.some((method) => audit.methods[method] !== expected.methods[method])
    || !Array.isArray(audit.requests) || audit.requests.length !== expected.requests.length
    || audit.requests.some((request, index) => !exactKeys(
      request, ['attempt', 'method', 'path', 'jurisdiction'],
    ) || request.attempt !== expected.requests[index].attempt
      || request.method !== expected.requests[index].method
      || request.path !== expected.requests[index].path
      || request.jurisdiction !== expected.requests[index].jurisdiction)) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_METHODS');
  }
  return audit;
}

export function validateR2ExposureGitSnapshot(snapshot, expectedCommit, expectedTree) {
  if (!exactKeys(snapshot, ['commit', 'tree', 'clean'])
    || snapshot.commit !== expectedCommit || snapshot.tree !== expectedTree
    || snapshot.clean !== true) fail('CLOUDFLARE_E_R2_EXPOSURE_GIT');
  return snapshot;
}

export async function inspectR2ExposureGit(root = process.cwd()) {
  if (typeof root !== 'string' || root.length === 0) fail('CLOUDFLARE_E_R2_EXPOSURE_GIT');
  try {
    const firstCommit = (await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: root, encoding: 'utf8', maxBuffer: 1024,
    })).stdout.trim();
    const firstTree = (await execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: root, encoding: 'utf8', maxBuffer: 1024,
    })).stdout.trim();
    const status = (await execFileAsync(
      'git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
      },
    )).stdout;
    const secondCommit = (await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: root, encoding: 'utf8', maxBuffer: 1024,
    })).stdout.trim();
    const secondTree = (await execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: root, encoding: 'utf8', maxBuffer: 1024,
    })).stdout.trim();
    if (!GIT_OID.test(firstCommit) || !GIT_OID.test(firstTree)
      || firstCommit !== secondCommit || firstTree !== secondTree) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_GIT');
    }
    return { commit: firstCommit, tree: firstTree, clean: status === '' };
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_E_R2_EXPOSURE_GIT') throw error;
    fail('CLOUDFLARE_E_R2_EXPOSURE_GIT');
  }
}

export function r2ExposureRequestSha256({
  purpose, environment, bucket, accountIdSha256, sourceCommit, sourceTree, requestAudit,
}) {
  const target = exposureTarget(environment);
  if (!target || purpose !== target.purpose || bucket !== target.bucket
    || !SHA256.test(accountIdSha256 ?? '')
    || !GIT_OID.test(sourceCommit ?? '') || !GIT_OID.test(sourceTree ?? '')) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_REQUEST');
  }
  validateR2ExposureRequestAudit(requestAudit, { bucket, environment });
  return sha256Hex(canonicalJson({
    purpose, environment, bucket, accountIdSha256, sourceCommit, sourceTree, requestAudit,
  }));
}

export function canonicalR2ExposureEvidencePayload(evidence) { return canonicalJson(evidence); }

export function validateR2ExposureEvidence(evidence, {
  expected = {}, now = new Date(), requirePrivate = true, maxLifetimeSeconds = 900,
  maxFutureSkewSeconds = 120,
} = {}) {
  const target = exposureTarget(evidence?.environment);
  const keys = ['schemaVersion', 'contract', 'purpose', 'environment', 'bucket',
    'accountIdSha256', 'sourceCommit', 'sourceTree', 'gitCheckCount', 'requestAudit',
    'jurisdiction', 'location', 'storageClass', 'bucketCreatedAt', 'bucketPropertiesSha256',
    'r2DevEnabled', 'customDomainCount', 'managedDomainSha256', 'customDomainsSha256',
    'observedAt', 'expiresAt'];
  if (!exactKeys(evidence, keys) || evidence.schemaVersion !== 1
    || evidence.contract !== 'dwnc-cloudflare-r2-private-exposure-v1'
    || !target || evidence.purpose !== target.purpose || evidence.bucket !== target.bucket
    || !SHA256.test(evidence.accountIdSha256 ?? '')
    || !GIT_OID.test(evidence.sourceCommit ?? '') || !GIT_OID.test(evidence.sourceTree ?? '')
    || evidence.gitCheckCount !== 3
    || evidence.jurisdiction !== STAGING_R2_EXPOSURE_JURISDICTION
    || typeof evidence.location !== 'string'
    || !SAFE_BUCKET_PROPERTY.test(evidence.location)
    || evidence.location !== evidence.location.toLowerCase()
    || typeof evidence.storageClass !== 'string'
    || !SAFE_BUCKET_PROPERTY.test(evidence.storageClass)
    || target.location !== null && evidence.location !== target.location
    || target.storageClass !== null && evidence.storageClass !== target.storageClass
    || Number.isNaN(Date.parse(evidence.bucketCreatedAt ?? ''))
    || !SHA256.test(evidence.bucketPropertiesSha256 ?? '')
    || typeof evidence.r2DevEnabled !== 'boolean'
    || !Number.isSafeInteger(evidence.customDomainCount) || evidence.customDomainCount < 0
    || !SHA256.test(evidence.managedDomainSha256 ?? '')
    || !SHA256.test(evidence.customDomainsSha256 ?? '')
    || Number.isNaN(Date.parse(evidence.observedAt ?? ''))
    || Number.isNaN(Date.parse(evidence.expiresAt ?? ''))) fail('CLOUDFLARE_E_R2_EXPOSURE');
  validateR2ExposureRequestAudit(evidence.requestAudit, {
    bucket: evidence.bucket,
    environment: evidence.environment,
  });
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

function parseProductionBucketInfo(rawBody) {
  let parsed;
  try { parsed = JSON.parse(rawBody); }
  catch { fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE'); }
  const keys = ['name', 'created', 'location', 'default_storage_class',
    'object_count', 'bucket_size'];
  if (!exactKeys(parsed, keys)
    || !BUCKET.test(parsed.name ?? '')
    || typeof parsed.created !== 'string' || Number.isNaN(Date.parse(parsed.created))
    || typeof parsed.location !== 'string' || !SAFE_BUCKET_PROPERTY.test(parsed.location)
    || typeof parsed.default_storage_class !== 'string'
    || !SAFE_BUCKET_PROPERTY.test(parsed.default_storage_class)
    || typeof parsed.object_count !== 'string' || !/^[0-9][0-9,]*$/u.test(parsed.object_count)
    || typeof parsed.bucket_size !== 'string' || !/^[0-9]+(?:\.[0-9]+)? [A-Za-z]+$/u.test(parsed.bucket_size)) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  }
  return {
    name: parsed.name,
    createdAt: new Date(Date.parse(parsed.created)).toISOString(),
    jurisdiction: STAGING_R2_EXPOSURE_JURISDICTION,
    location: parsed.location.toLowerCase(),
    storageClass: parsed.default_storage_class,
  };
}

function parseProductionManagedOutput(rawBody) {
  const output = rawBody.trim();
  if (output === 'Public access via the r2.dev URL is disabled.') return { enabled: false };
  if (/^Public access is enabled at 'https:\/\/[^']+'\.$/u.test(output)) return { enabled: true };
  fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
}

function parseProductionCustomDomainsOutput(rawBody, bucket) {
  const output = rawBody.trim();
  const empty = `Listing custom domains connected to bucket '${bucket}'...\n`
    + 'There are no custom domains connected to this bucket.';
  if (output === empty) return { domains: [] };
  if (output.startsWith(`Listing custom domains connected to bucket '${bucket}'...`)) {
    return { domains: [{}] };
  }
  fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
}

export function validateR2ExposureCapture(capture, options = {}) {
  const keys = ['schemaVersion', 'contract', 'requestSha256', 'bucketRawBody',
    'bucketRawBodySha256', 'managedRawBody', 'managedRawBodySha256', 'customRawBody',
    'customRawBodySha256', 'evidence'];
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
  const production = capture.evidence?.environment === 'production';
  const bucketProperties = production
    ? parseProductionBucketInfo(capture.bucketRawBody)
    : parseEnvelope(capture.bucketRawBody, 'bucket', capture.evidence?.jurisdiction);
  const managed = production
    ? parseProductionManagedOutput(capture.managedRawBody)
    : parseEnvelope(capture.managedRawBody, 'managed');
  const custom = production
    ? parseProductionCustomDomainsOutput(capture.customRawBody, capture.evidence?.bucket)
    : parseEnvelope(capture.customRawBody, 'custom');
  validateR2ExposureEvidence(capture.evidence, options);
  if (bucketProperties.name !== capture.evidence.bucket
    || bucketProperties.createdAt !== capture.evidence.bucketCreatedAt
    || bucketProperties.jurisdiction !== capture.evidence.jurisdiction
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
  purpose,
  environment,
  bucket,
  accountId,
  expectedAccountIdSha256,
  apiToken,
  expectedGitCommit,
  expectedGitTree,
  root = process.cwd(),
  inspectGit = inspectR2ExposureGit,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  ttlSeconds = 900,
}) {
  const target = exposureTarget(environment);
  if (!target || environment !== 'staging'
    || purpose !== target.purpose || bucket !== target.bucket
    || !ACCOUNT_ID.test(accountId ?? '')
    || !SHA256.test(expectedAccountIdSha256 ?? '')
    || cloudflareAccountIdSha256(accountId.toLowerCase()) !== expectedAccountIdSha256
    || !API_TOKEN.test(apiToken ?? '') || !GIT_OID.test(expectedGitCommit ?? '')
    || !GIT_OID.test(expectedGitTree ?? '') || typeof inspectGit !== 'function'
    || typeof fetchImpl !== 'function' || !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < 15 || ttlSeconds > 900) fail('CLOUDFLARE_E_R2_EXPOSURE_REQUEST');
  const requestAudit = r2ExposureRequestAudit(bucket);
  validateR2ExposureRequestAudit(requestAudit, { bucket, environment });
  const checkGit = async () => validateR2ExposureGitSnapshot(
    await inspectGit(root), expectedGitCommit, expectedGitTree,
  );
  await checkGit();
  const bucketUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}`;
  const rawBodies = [];
  const read = async (url, request) => {
    if (request.method !== 'GET' || request.attempt !== 1
      || request.jurisdiction !== STAGING_R2_EXPOSURE_JURISDICTION) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_METHODS');
    }
    let response;
    let rawBody;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'cf-r2-jurisdiction': request.jurisdiction,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      rawBody = await readBoundedUtf8ResponseBody(response);
    } catch { fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH'); }
    if (response.status !== 200 || typeof rawBody !== 'string' || rawBody.length === 0
      || Buffer.byteLength(rawBody) > MAXIMUM_RESPONSE_BODY_BYTES) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
    }
    rawBodies.push(rawBody);
    return rawBody;
  };
  const bucketRawBody = await read(bucketUrl, requestAudit.requests[0]);
  const bucketProperties = parseEnvelope(
    bucketRawBody, 'bucket', STAGING_R2_EXPOSURE_JURISDICTION,
  );
  if (bucketProperties.name !== bucket
    || bucketProperties.jurisdiction !== STAGING_R2_EXPOSURE_JURISDICTION
    || target.location !== null && bucketProperties.location !== target.location
    || target.storageClass !== null && bucketProperties.storageClass !== target.storageClass) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_EXPECTED');
  }
  const managedRawBody = await read(`${bucketUrl}/domains/managed`, requestAudit.requests[1]);
  const customRawBody = await read(`${bucketUrl}/domains/custom`, requestAudit.requests[2]);
  if (rawBodies.length !== 3) fail('CLOUDFLARE_E_R2_EXPOSURE_METHODS');
  const managed = parseEnvelope(managedRawBody, 'managed');
  const custom = parseEnvelope(customRawBody, 'custom');
  if (managed.enabled !== false || custom.domains.length !== 0) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_PUBLIC');
  }
  await checkGit();
  const observed = now();
  if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  }
  const evidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-r2-private-exposure-v1',
    purpose,
    environment,
    bucket,
    accountIdSha256: expectedAccountIdSha256,
    sourceCommit: expectedGitCommit,
    sourceTree: expectedGitTree,
    gitCheckCount: 3,
    requestAudit,
    jurisdiction: bucketProperties.jurisdiction,
    location: bucketProperties.location,
    storageClass: bucketProperties.storageClass,
    bucketCreatedAt: bucketProperties.createdAt,
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
  await checkGit();
  return capture;
}

export async function fetchProductionR2ExposureCapture({
  purpose,
  environment,
  bucket,
  expectedAccountIdSha256,
  expectedGitCommit,
  expectedGitTree,
  root = process.cwd(),
  environmentVariables = process.env,
  inspectGit = inspectR2ExposureGit,
  inspectOAuthAccount = inspectCloudflareOAuthAccount,
  execFileImpl = execFileAsync,
  now = () => new Date(),
  ttlSeconds = 900,
}) {
  const target = exposureTarget(environment);
  if (!target || environment !== 'production' || purpose !== target.purpose
    || bucket !== target.bucket || !SHA256.test(expectedAccountIdSha256 ?? '')
    || !GIT_OID.test(expectedGitCommit ?? '') || !GIT_OID.test(expectedGitTree ?? '')
    || typeof root !== 'string' || !path.isAbsolute(root)
    || typeof inspectGit !== 'function' || typeof inspectOAuthAccount !== 'function'
    || typeof execFileImpl !== 'function' || !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < 15 || ttlSeconds > 900) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_REQUEST');
  }
  const requestAudit = productionR2ExposureRequestAudit(bucket);
  validateR2ExposureRequestAudit(requestAudit, { bucket, environment });
  const checkGit = async () => validateR2ExposureGitSnapshot(
    await inspectGit(root), expectedGitCommit, expectedGitTree,
  );
  await checkGit();
  const account = await inspectOAuthAccount({
    root, expectedAccountIdSha256, environment: environmentVariables, execFileImpl,
  });
  if (account?.authenticated !== true || account.authType !== 'OAuth Token'
    || account.accountCount !== 1 || account.accountIdSha256 !== expectedAccountIdSha256) {
    fail('CLOUDFLARE_E_WRANGLER_OAUTH_ACCOUNT');
  }
  const wrangler = `${root}/node_modules/.bin/wrangler`;
  const wranglerEnvironment = cloudflareOAuthWranglerEnvironment(environmentVariables, {
    CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true', NO_COLOR: '1',
  });
  const outputs = [];
  for (const command of requestAudit.commands) {
    let result;
    try {
      result = await execFileImpl(wrangler, command.argv, {
        cwd: root, env: wranglerEnvironment, encoding: 'utf8', maxBuffer: MAXIMUM_RESPONSE_BODY_BYTES,
      });
    } catch { fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH'); }
    if (typeof result?.stdout !== 'string' || result.stdout.length === 0
      || Buffer.byteLength(result.stdout) > MAXIMUM_RESPONSE_BODY_BYTES
      || typeof result.stderr !== 'string' || result.stderr.length !== 0) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_FETCH');
    }
    outputs.push(result.stdout);
  }
  if (outputs.length !== 3) fail('CLOUDFLARE_E_R2_EXPOSURE_METHODS');
  const [bucketRawBody, managedRawBody, customRawBody] = outputs;
  const bucketProperties = parseProductionBucketInfo(bucketRawBody);
  const managed = parseProductionManagedOutput(managedRawBody);
  const custom = parseProductionCustomDomainsOutput(customRawBody, bucket);
  if (bucketProperties.name !== bucket) fail('CLOUDFLARE_E_R2_EXPOSURE_EXPECTED');
  if (managed.enabled !== false || custom.domains.length !== 0) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_PUBLIC');
  }
  await checkGit();
  const observed = now();
  if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
  }
  const evidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-r2-private-exposure-v1',
    purpose,
    environment,
    bucket,
    accountIdSha256: expectedAccountIdSha256,
    sourceCommit: expectedGitCommit,
    sourceTree: expectedGitTree,
    gitCheckCount: 3,
    requestAudit,
    jurisdiction: bucketProperties.jurisdiction,
    location: bucketProperties.location,
    storageClass: bucketProperties.storageClass,
    bucketCreatedAt: bucketProperties.createdAt,
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
  await checkGit();
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
