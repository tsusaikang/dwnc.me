import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectionBackedPublicContent } from './public-content-preflight.mjs';

export const PUBLIC_MEDIA_SCHEMA_VERSION = 1;
export const PUBLIC_MEDIA_CONTRACT = 'dwnc-public-media-r2-v1';
export const PUBLIC_MEDIA_KEY_RULE = 'publicPath.slice(1)';
export const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const PUBLIC_MEDIA_MANIFEST_PATH = 'src/data/public-media-r2-v1.json';
export const PUBLIC_MEDIA_RELEASE_POLICY_PATH = 'src/data/public-media-release-policy-v1.json';
export const PUBLIC_MEDIA_BASELINE_OBJECTS = 2_758;
export const PUBLIC_MEDIA_BASELINE_BYTES = 2_346_220_246;
export const PUBLIC_MEDIA_BASELINE_SHA256 = '61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const BUCKET_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const RELEASE_ENVIRONMENTS = new Set(['staging', 'production']);
const VERIFICATION_LEVELS = new Set(['head-exact', 'full-get-sha256']);
const EXACT_ENTRY_KEYS = Object.freeze([
  'publicPath', 'key', 'size', 'sha256', 'contentType', 'cacheControl',
]);

export class PublicMediaError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PublicMediaError';
    this.code = code;
  }
}

const fail = (code) => { throw new PublicMediaError(code); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const byteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && Object.keys(value).every((key) => expected.includes(key));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(byteCompare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validatePublicMediaPath(publicPath, key) {
  if (typeof publicPath !== 'string'
    || typeof key !== 'string'
    || !/^\/media\/[A-Za-z0-9._/-]+$/u.test(publicPath)
    || publicPath.includes('//')
    || publicPath.includes('..')
    || publicPath.includes('\\')
    || publicPath.includes('%')
    || publicPath.normalize('NFC') !== publicPath
    || key !== publicPath.slice(1)) fail('MEDIA_E_PATH');
  return publicPath;
}

export function canonicalPublicMediaPayload(manifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    contract: manifest.contract,
    keyRule: manifest.keyRule,
    entries: manifest.entries,
  });
}

export function publicMediaManifestDigest(manifest) {
  return sha256(canonicalPublicMediaPayload(manifest));
}

export function canonicalPublicMediaEntryPayload(entry) {
  return JSON.stringify({
    publicPath: entry.publicPath,
    key: entry.key,
    size: entry.size,
    sha256: entry.sha256,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
  });
}

export function publicMediaEntryManifestSha256(entry) {
  return sha256(canonicalPublicMediaEntryPayload(entry));
}

export function validatePublicMediaManifest(manifest, {
  enforceBaseline = true,
  expectedManifestSha256 = PUBLIC_MEDIA_BASELINE_SHA256,
} = {}) {
  const manifestKeys = [
    'schemaVersion', 'contract', 'keyRule', 'objectCount', 'totalBytes',
    'manifestSha256', 'entries',
  ];
  if (!exactKeys(manifest, manifestKeys)
    || manifest.schemaVersion !== PUBLIC_MEDIA_SCHEMA_VERSION
    || manifest.contract !== PUBLIC_MEDIA_CONTRACT
    || manifest.keyRule !== PUBLIC_MEDIA_KEY_RULE
    || !Array.isArray(manifest.entries)
    || !Number.isSafeInteger(manifest.objectCount)
    || !Number.isSafeInteger(manifest.totalBytes)
    || !SHA256_PATTERN.test(manifest.manifestSha256 ?? '')) fail('MEDIA_E_MANIFEST_SCHEMA');

  const paths = new Set();
  const keys = new Set();
  let totalBytes = 0;
  let previous = null;
  for (const entry of manifest.entries) {
    if (!exactKeys(entry, EXACT_ENTRY_KEYS)
      || !Number.isSafeInteger(entry.size)
      || entry.size <= 0
      || !SHA256_PATTERN.test(entry.sha256 ?? '')
      || typeof entry.contentType !== 'string'
      || !MIME_PATTERN.test(entry.contentType)
      || entry.contentType !== entry.contentType.toLowerCase()
      || entry.cacheControl !== PUBLIC_MEDIA_CACHE_CONTROL) fail('MEDIA_E_MANIFEST_ENTRY');
    validatePublicMediaPath(entry.publicPath, entry.key);
    if (paths.has(entry.publicPath) || keys.has(entry.key)) fail('MEDIA_E_MANIFEST_COLLISION');
    if (previous !== null && byteCompare(previous, entry.publicPath) >= 0) fail('MEDIA_E_MANIFEST_ORDER');
    paths.add(entry.publicPath);
    keys.add(entry.key);
    totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes)) fail('MEDIA_E_MANIFEST_BYTES');
    previous = entry.publicPath;
  }
  const digest = publicMediaManifestDigest(manifest);
  if (manifest.objectCount !== manifest.entries.length
    || manifest.totalBytes !== totalBytes
    || manifest.manifestSha256 !== digest) fail('MEDIA_E_MANIFEST_SUMMARY');
  if (enforceBaseline && (manifest.objectCount !== PUBLIC_MEDIA_BASELINE_OBJECTS
    || manifest.totalBytes !== PUBLIC_MEDIA_BASELINE_BYTES
    || digest !== expectedManifestSha256)) fail('MEDIA_E_MANIFEST_BASELINE');
  return { objectCount: manifest.objectCount, totalBytes, manifestSha256: digest };
}

export function createPublicMediaManifest(assetEvidence) {
  const byPath = new Map();
  for (const evidence of assetEvidence) {
    const publicPath = evidence?.path;
    const entry = {
      publicPath,
      key: typeof publicPath === 'string' ? publicPath.slice(1) : '',
      size: evidence?.size,
      sha256: evidence?.sha256,
      contentType: String(evidence?.mime ?? '').toLowerCase(),
      cacheControl: PUBLIC_MEDIA_CACHE_CONTROL,
    };
    validatePublicMediaPath(entry.publicPath, entry.key);
    const existing = byPath.get(entry.publicPath);
    if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) fail('MEDIA_E_MANIFEST_COLLISION');
    byPath.set(entry.publicPath, entry);
  }
  const entries = [...byPath.values()].sort((left, right) => byteCompare(left.publicPath, right.publicPath));
  const manifest = {
    schemaVersion: PUBLIC_MEDIA_SCHEMA_VERSION,
    contract: PUBLIC_MEDIA_CONTRACT,
    keyRule: PUBLIC_MEDIA_KEY_RULE,
    objectCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    manifestSha256: '',
    entries,
  };
  manifest.manifestSha256 = publicMediaManifestDigest(manifest);
  validatePublicMediaManifest(manifest, { enforceBaseline: false });
  return manifest;
}

async function readJson(file, code) {
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch { fail(code); }
  try { return JSON.parse(raw); }
  catch { fail(code); }
}

export async function loadPublicProjection(root) {
  const projection = await readJson(path.join(root, 'src/data/public-sequence-v1.json'), 'MEDIA_E_PROJECTION');
  if (!Array.isArray(projection)) fail('MEDIA_E_PROJECTION');
  return projection;
}

export async function collectProjectedPublicMedia(root, { assetMode = 'manifest' } = {}) {
  const projection = await loadPublicProjection(root);
  const contentRows = await loadProjectionBackedPublicContent(root, projection, { assetMode });
  const assetEvidence = contentRows.flatMap((row) => row.assetEvidence);
  const manifest = createPublicMediaManifest(assetEvidence);
  return { projection, contentRows, manifest };
}

export async function loadTrackedPublicMediaManifest(root, options = {}) {
  const manifest = await readJson(path.join(root, PUBLIC_MEDIA_MANIFEST_PATH), 'MEDIA_E_MANIFEST_READ');
  validatePublicMediaManifest(manifest, options);
  return manifest;
}

export function cloudflareAccountIdSha256(accountId) {
  if (typeof accountId !== 'string' || !/^[a-f0-9]{32}$/u.test(accountId)) fail('MEDIA_E_RELEASE_TARGET');
  return sha256(`cloudflare-account-id-v1\0${accountId}`);
}

export function publicKeySpkiSha256(publicKeyPem) {
  let der;
  try { der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }); }
  catch { fail('MEDIA_E_REMOTE_SIGNATURE'); }
  return sha256(der);
}

export function validatePublicMediaReleasePolicy(policy, { requireComplete = false } = {}) {
  const targetKeys = [
    'environment', 'wranglerEnvironment', 'binding', 'bucket', 'accountIdSha256',
    'publicKeySpkiSha256', 'releasePublicKeySpkiSha256',
    'smokeOrigin', 'smokeAccessPolicySha256',
    'requiredVerificationLevel', 'requiredBucketExposure',
    'maxBucketExposureAgeSeconds', 'maxBucketExposureFutureSkewSeconds', 'approvedOrphanCount',
  ];
  if (!exactKeys(policy, ['schemaVersion', 'contract', 'staging', 'production'])
    || policy.schemaVersion !== 1
    || policy.contract !== 'dwnc-public-media-release-policy-v1') fail('MEDIA_E_RELEASE_POLICY');
  for (const environment of RELEASE_ENVIRONMENTS) {
    const target = policy[environment];
    if (!exactKeys(target, targetKeys)
      || target.environment !== environment
      || target.wranglerEnvironment !== environment
      || target.binding !== 'MEDIA_BUCKET'
      || !BUCKET_PATTERN.test(target.bucket ?? '')
      || ![null, undefined].includes(target.accountIdSha256)
        && !SHA256_PATTERN.test(target.accountIdSha256)
      || ![null, undefined].includes(target.publicKeySpkiSha256)
        && !SHA256_PATTERN.test(target.publicKeySpkiSha256)
      || ![null, undefined].includes(target.releasePublicKeySpkiSha256)
        && !SHA256_PATTERN.test(target.releasePublicKeySpkiSha256)
      || (environment === 'staging'
        ? target.smokeOrigin !== 'https://dwnc-me-staging.dwnc.workers.dev'
          || ![null, undefined].includes(target.smokeAccessPolicySha256)
            && !SHA256_PATTERN.test(target.smokeAccessPolicySha256)
        : target.smokeOrigin !== null || target.smokeAccessPolicySha256 !== null)
      || !VERIFICATION_LEVELS.has(target.requiredVerificationLevel)
      || target.requiredBucketExposure !== 'cloudflare-control-plane-private'
      || target.maxBucketExposureAgeSeconds !== 900
      || target.maxBucketExposureFutureSkewSeconds !== 120
      || !Number.isSafeInteger(target.approvedOrphanCount)
      || target.approvedOrphanCount < 0) fail('MEDIA_E_RELEASE_POLICY');
  }
  if (requireComplete && (!SHA256_PATTERN.test(policy.production.accountIdSha256 ?? '')
    || !SHA256_PATTERN.test(policy.production.publicKeySpkiSha256 ?? '')
    || !SHA256_PATTERN.test(policy.production.releasePublicKeySpkiSha256 ?? ''))) {
    fail('MEDIA_E_RELEASE_POLICY_INCOMPLETE');
  }
  return policy;
}

export async function loadTrackedPublicMediaReleasePolicy(root, options = {}) {
  const policy = await readJson(path.join(root, PUBLIC_MEDIA_RELEASE_POLICY_PATH), 'MEDIA_E_RELEASE_POLICY');
  return validatePublicMediaReleasePolicy(policy, options);
}

export function assertManifestEqual(left, right) {
  const leftDigest = publicMediaManifestDigest(left);
  const rightDigest = publicMediaManifestDigest(right);
  const leftBytes = Buffer.from(leftDigest, 'hex');
  const rightBytes = Buffer.from(rightDigest, 'hex');
  if (leftBytes.length !== rightBytes.length || !timingSafeEqual(leftBytes, rightBytes)
    || JSON.stringify(left) !== JSON.stringify(right)) fail('MEDIA_E_MANIFEST_DRIFT');
}

export function canonicalRemoteReceiptPayload(receipt) {
  return canonicalJson({
    schemaVersion: receipt.schemaVersion,
    contract: receipt.contract,
    manifestSha256: receipt.manifestSha256,
    objectCount: receipt.objectCount,
    totalBytes: receipt.totalBytes,
    target: receipt.target,
    verificationLevel: receipt.verificationLevel,
    bucketExposure: receipt.bucketExposure,
    verifiedAt: receipt.verifiedAt,
    audit: receipt.audit,
    objects: receipt.objects,
  });
}

export function validateRemoteReceipt(receipt, manifest) {
  const keys = [
    'schemaVersion', 'contract', 'manifestSha256', 'objectCount', 'totalBytes',
    'target', 'verificationLevel', 'bucketExposure', 'verifiedAt', 'audit', 'objects',
  ];
  if (!exactKeys(receipt, keys)
    || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-public-media-r2-receipt-v1'
    || receipt.manifestSha256 !== manifest.manifestSha256
    || receipt.objectCount !== manifest.objectCount
    || receipt.totalBytes !== manifest.totalBytes
    || !exactKeys(receipt.target, ['environment', 'bucket', 'accountIdSha256'])
    || !RELEASE_ENVIRONMENTS.has(receipt.target.environment)
    || !BUCKET_PATTERN.test(receipt.target.bucket ?? '')
    || !SHA256_PATTERN.test(receipt.target.accountIdSha256 ?? '')
    || !VERIFICATION_LEVELS.has(receipt.verificationLevel)
    || !exactKeys(receipt.bucketExposure, [
      'verification', 'jurisdiction', 'location', 'storageClass', 'bucketPropertiesSha256',
      'r2DevEnabled', 'customDomainCount', 'verifiedAt', 'evidenceSha256',
    ])
    || typeof receipt.verifiedAt !== 'string'
    || Number.isNaN(Date.parse(receipt.verifiedAt))
    || !exactKeys(receipt.audit, ['headObjects', 'fullGetObjects', 'fullGetBytes', 'orphanCount'])
    || receipt.audit.headObjects !== manifest.objectCount
    || !Number.isSafeInteger(receipt.audit.fullGetObjects)
    || !Number.isSafeInteger(receipt.audit.fullGetBytes)
    || !Number.isSafeInteger(receipt.audit.orphanCount)
    || receipt.audit.orphanCount < 0
    || (receipt.verificationLevel === 'head-exact'
      && (receipt.audit.fullGetObjects !== 0 || receipt.audit.fullGetBytes !== 0))
    || (receipt.verificationLevel === 'full-get-sha256'
      && (receipt.audit.fullGetObjects !== manifest.objectCount
        || receipt.audit.fullGetBytes !== manifest.totalBytes))
    || !Array.isArray(receipt.objects)
    || receipt.objects.length !== manifest.entries.length) fail('MEDIA_E_REMOTE_RECEIPT');
  const exposure = receipt.bucketExposure;
  const unverifiedExposure = exposure.verification === 'unverified'
    && exposure.jurisdiction === null
    && exposure.location === null
    && exposure.storageClass === null
    && exposure.bucketPropertiesSha256 === null
    && exposure.r2DevEnabled === null
    && exposure.customDomainCount === null
    && exposure.verifiedAt === null
    && exposure.evidenceSha256 === null;
  const verifiedPrivateExposure = exposure.verification === 'cloudflare-control-plane'
    && exposure.jurisdiction === 'default'
    && /^[A-Za-z0-9_-]{1,64}$/u.test(exposure.location ?? '')
    && /^[A-Za-z0-9_-]{1,64}$/u.test(exposure.storageClass ?? '')
    && SHA256_PATTERN.test(exposure.bucketPropertiesSha256 ?? '')
    && exposure.r2DevEnabled === false
    && exposure.customDomainCount === 0
    && typeof exposure.verifiedAt === 'string'
    && !Number.isNaN(Date.parse(exposure.verifiedAt))
    && SHA256_PATTERN.test(exposure.evidenceSha256 ?? '');
  if (!unverifiedExposure && !verifiedPrivateExposure) fail('MEDIA_E_REMOTE_RECEIPT');
  const expectedByKey = new Map(manifest.entries.map((entry) => [entry.key, entry]));
  let previous = null;
  for (const object of receipt.objects) {
    const objectKeys = [
      'key', 'size', 'sha256', 'contentType', 'manifestEntrySha256',
      'platformChecksumSha256', 'version', 'httpEtag', 'lastModified',
    ];
    if (!exactKeys(object, objectKeys)
      || typeof object.key !== 'string'
      || !Number.isSafeInteger(object.size)
      || !SHA256_PATTERN.test(object.sha256 ?? '')
      || !SHA256_PATTERN.test(object.manifestEntrySha256 ?? '')
      || !SHA256_PATTERN.test(object.platformChecksumSha256 ?? '')
      || typeof object.contentType !== 'string'
      || (object.version !== null && (typeof object.version !== 'string'
        || object.version.length < 1 || object.version.length > 256
        || /[\u0000-\u001f\u007f]/u.test(object.version)))
      || typeof object.httpEtag !== 'string'
      || !/^"[^"\r\n]+"$/u.test(object.httpEtag)
      || typeof object.lastModified !== 'string'
      || Number.isNaN(Date.parse(object.lastModified))
      || new Date(object.lastModified).toISOString() !== object.lastModified
      || (previous !== null && byteCompare(previous, object.key) >= 0)) fail('MEDIA_E_REMOTE_RECEIPT');
    const expected = expectedByKey.get(object.key);
    if (!expected || expected.size !== object.size || expected.sha256 !== object.sha256
      || expected.contentType !== object.contentType
      || object.manifestEntrySha256 !== publicMediaEntryManifestSha256(expected)
      || object.platformChecksumSha256 !== expected.sha256) fail('MEDIA_E_REMOTE_RECEIPT');
    previous = object.key;
  }
  return receipt;
}

export function validateConfiguredReleaseTarget({
  policy, environment, accountId, bucket, wranglerConfig,
}) {
  validatePublicMediaReleasePolicy(policy);
  if (!RELEASE_ENVIRONMENTS.has(environment)) fail('MEDIA_E_RELEASE_TARGET');
  const target = policy[environment];
  const binding = wranglerConfig?.env?.[target.wranglerEnvironment]?.r2_buckets;
  if (!SHA256_PATTERN.test(target.accountIdSha256 ?? '')) fail('MEDIA_E_RELEASE_POLICY_INCOMPLETE');
  if (!Array.isArray(binding) || binding.length !== 1
    || binding[0]?.binding !== target.binding
    || binding[0]?.bucket_name !== target.bucket
    || bucket !== target.bucket
    || cloudflareAccountIdSha256(accountId) !== target.accountIdSha256) {
    fail('MEDIA_E_RELEASE_TARGET');
  }
  return target;
}

export function verifyRemoteReceiptSignature(receipt, signature, publicKeyPem) {
  if (!Buffer.isBuffer(signature) || signature.length !== 64
    || typeof publicKeyPem !== 'string' || !publicKeyPem.includes('BEGIN PUBLIC KEY')) {
    fail('MEDIA_E_REMOTE_SIGNATURE');
  }
  const payload = Buffer.from(canonicalRemoteReceiptPayload(receipt));
  let valid = false;
  try { valid = verifySignature(null, payload, publicKeyPem, signature); }
  catch { fail('MEDIA_E_REMOTE_SIGNATURE'); }
  if (!valid) fail('MEDIA_E_REMOTE_SIGNATURE');
  return true;
}

export function validateProductionReleaseTarget({
  policy, receipt, accountId, bucket, publicKeyPem, wranglerConfig, now = new Date(),
}) {
  validatePublicMediaReleasePolicy(policy, { requireComplete: true });
  const production = policy.production;
  validateConfiguredReleaseTarget({
    policy, environment: 'production', accountId, bucket, wranglerConfig,
  });
  const nowTimestamp = now instanceof Date ? now.getTime() : Number.NaN;
  const exposureTimestamp = Date.parse(receipt.bucketExposure?.verifiedAt ?? '');
  const exposureAge = nowTimestamp - exposureTimestamp;
  if (receipt.target.environment !== production.environment
    || receipt.target.bucket !== production.bucket
    || receipt.target.accountIdSha256 !== production.accountIdSha256
    || cloudflareAccountIdSha256(accountId) !== production.accountIdSha256
    || publicKeySpkiSha256(publicKeyPem) !== production.publicKeySpkiSha256
    || receipt.verificationLevel !== production.requiredVerificationLevel
    || production.requiredBucketExposure !== 'cloudflare-control-plane-private'
    || receipt.bucketExposure.verification !== 'cloudflare-control-plane'
    || receipt.bucketExposure.jurisdiction !== 'default'
    || !SHA256_PATTERN.test(receipt.bucketExposure.bucketPropertiesSha256 ?? '')
    || receipt.bucketExposure.r2DevEnabled !== false
    || receipt.bucketExposure.customDomainCount !== 0
    || receipt.audit.orphanCount !== production.approvedOrphanCount
    || Number.isNaN(nowTimestamp)
    || Number.isNaN(exposureTimestamp)
    || exposureAge > production.maxBucketExposureAgeSeconds * 1_000
    || exposureAge < -(production.maxBucketExposureFutureSkewSeconds * 1_000)) {
    fail('MEDIA_E_RELEASE_TARGET');
  }
  return true;
}

export function validateStagingReleaseTarget({
  policy, receipt, accountId, bucket, publicKeyPem, wranglerConfig, now = new Date(),
}) {
  validatePublicMediaReleasePolicy(policy);
  const staging = policy.staging;
  if (!SHA256_PATTERN.test(staging.publicKeySpkiSha256 ?? '')) {
    fail('MEDIA_E_RELEASE_POLICY_INCOMPLETE');
  }
  validateConfiguredReleaseTarget({
    policy, environment: 'staging', accountId, bucket, wranglerConfig,
  });
  const nowTimestamp = now instanceof Date ? now.getTime() : Number.NaN;
  const exposureTimestamp = Date.parse(receipt.bucketExposure?.verifiedAt ?? '');
  const exposureAge = nowTimestamp - exposureTimestamp;
  if (receipt.target.environment !== staging.environment
    || receipt.target.bucket !== staging.bucket
    || receipt.target.accountIdSha256 !== staging.accountIdSha256
    || cloudflareAccountIdSha256(accountId) !== staging.accountIdSha256
    || publicKeySpkiSha256(publicKeyPem) !== staging.publicKeySpkiSha256
    || receipt.verificationLevel !== staging.requiredVerificationLevel
    || staging.requiredBucketExposure !== 'cloudflare-control-plane-private'
    || receipt.bucketExposure.verification !== 'cloudflare-control-plane'
    || receipt.bucketExposure.jurisdiction !== 'default'
    || !SHA256_PATTERN.test(receipt.bucketExposure.bucketPropertiesSha256 ?? '')
    || receipt.bucketExposure.r2DevEnabled !== false
    || receipt.bucketExposure.customDomainCount !== 0
    || receipt.audit.orphanCount !== staging.approvedOrphanCount
    || Number.isNaN(nowTimestamp)
    || Number.isNaN(exposureTimestamp)
    || exposureAge > staging.maxBucketExposureAgeSeconds * 1_000
    || exposureAge < -(staging.maxBucketExposureFutureSkewSeconds * 1_000)) {
    fail('MEDIA_E_RELEASE_TARGET');
  }
  return true;
}
