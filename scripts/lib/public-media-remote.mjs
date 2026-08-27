import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  publicMediaFullGetObjectSetSha256,
  publicMediaEntryManifestSha256,
  validateRemoteReceipt,
} from './public-media-manifest.mjs';
import {
  remoteObjectGenerationMatches,
  remoteObjectMatches,
} from './r2-s3-client.mjs';
import { readSecureBytes } from './global-sequence.mjs';

const GIT_OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const R2_OPERATION_KEYS = Object.freeze(['LIST', 'HEAD', 'GET', 'PUT', 'DELETE']);
const INSPECTION_KEYS = Object.freeze(['listed', 'exact', 'missing', 'mismatch', 'orphan']);

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function validateR2OperationCounts(counts, {
  allowGet = true, allowPut = true,
} = {}) {
  if (!exactKeys(counts, R2_OPERATION_KEYS)
    || R2_OPERATION_KEYS.some((key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0)
    || !allowGet && counts.GET !== 0 || !allowPut && counts.PUT !== 0
    || counts.DELETE !== 0) throw new Error('MEDIA_E_R2_OPERATION_COUNTS');
  return counts;
}

export function r2OperationDelta(before, after) {
  validateR2OperationCounts(before);
  validateR2OperationCounts(after);
  const delta = Object.fromEntries(R2_OPERATION_KEYS.map((key) => [key, after[key] - before[key]]));
  if (R2_OPERATION_KEYS.some((key) => delta[key] < 0)) {
    throw new Error('MEDIA_E_R2_OPERATION_COUNTS');
  }
  return delta;
}

export function remoteInspectionCounts(inspection) {
  if (!inspection || !Array.isArray(inspection.exact) || !Array.isArray(inspection.missing)
    || !Array.isArray(inspection.mismatch) || !Array.isArray(inspection.heads)
    || !Number.isSafeInteger(inspection.listedCount) || inspection.listedCount < 0
    || !Number.isSafeInteger(inspection.orphanCount) || inspection.orphanCount < 0) {
    throw new Error('MEDIA_E_R2_INSPECTION_COUNTS');
  }
  return {
    listed: inspection.listedCount,
    exact: inspection.exact.length,
    missing: inspection.missing.length,
    mismatch: inspection.mismatch.length,
    orphan: inspection.orphanCount,
  };
}

export function validateRemoteInspectionCounts(counts, manifest, expected = null) {
  if (!exactKeys(counts, INSPECTION_KEYS)
    || INSPECTION_KEYS.some((key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0)
    || counts.exact + counts.missing + counts.mismatch !== manifest.objectCount
    || counts.listed !== counts.exact + counts.mismatch + counts.orphan
    || expected !== null && (!exactKeys(expected, ['exact', 'missing', 'mismatch', 'orphan'])
      || ['exact', 'missing', 'mismatch', 'orphan'].some((key) => counts[key] !== expected[key]))) {
    throw new Error('MEDIA_E_R2_INSPECTION_COUNTS');
  }
  return counts;
}

export async function mapWithConcurrency(values, concurrency, mapper) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error('MEDIA_E_CONCURRENCY');
  }
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index], index);
    }
  }));
  return results;
}

export async function inspectRemotePublicMedia(client, manifest, { concurrency = 8 } = {}) {
  const desiredKeys = new Set(manifest.entries.map((entry) => entry.key));
  const listed = await client.listAll('media/');
  const orphanCount = listed.reduce((count, object) => count + (desiredKeys.has(object.key) ? 0 : 1), 0);
  const heads = await mapWithConcurrency(manifest.entries, concurrency, (entry) => client.head(entry.key));
  const missing = [];
  const mismatch = [];
  const exact = [];
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index];
    const remote = heads[index];
    if (!remote) missing.push(entry);
    else if (remoteObjectMatches(entry, remote)) exact.push({ entry, remote });
    else mismatch.push({ entry, remote });
  }
  return { listedCount: listed.length, orphanCount, missing, mismatch, exact, heads };
}

export function validateRemoteInspectionReceipt(receipt, manifest) {
  const topKeys = ['schemaVersion', 'contract', 'target', 'source', 'manifestSha256',
    'desired', 'expected', 'observed', 'requestCounts', 'verificationLevel',
    'overwrite', 'delete', 'startedAt', 'inspectedAt'];
  if (!exactKeys(receipt, topKeys) || receipt.schemaVersion !== 2
    || receipt.contract !== 'dwnc-public-media-r2-inspection-v2'
    || !exactKeys(receipt.target, ['environment', 'accountIdSha256', 'bucket'])
    || receipt.target.environment !== 'staging' || !BUCKET.test(receipt.target.bucket ?? '')
    || !SHA256.test(receipt.target.accountIdSha256 ?? '')
    || !exactKeys(receipt.source, ['gitCommit', 'gitTree', 'clean', 'gitCheckCount'])
    || !GIT_OID.test(receipt.source.gitCommit ?? '') || !GIT_OID.test(receipt.source.gitTree ?? '')
    || receipt.source.clean !== true || receipt.source.gitCheckCount !== 3
    || receipt.manifestSha256 !== manifest.manifestSha256
    || receipt.desired !== manifest.objectCount
    || !exactKeys(receipt.expected, ['exact', 'missing', 'mismatch', 'orphan'])
    || receipt.verificationLevel !== 'list-and-head-strict'
    || receipt.overwrite !== 0 || receipt.delete !== 0
    || !validTimestamp(receipt.startedAt) || !validTimestamp(receipt.inspectedAt)
    || Date.parse(receipt.inspectedAt) < Date.parse(receipt.startedAt)) {
    throw new Error('MEDIA_E_R2_INSPECTION_RECEIPT');
  }
  validateRemoteInspectionCounts(receipt.observed, manifest, receipt.expected);
  validateR2OperationCounts(receipt.requestCounts, { allowGet: false, allowPut: false });
  if (receipt.requestCounts.LIST < 1 || receipt.requestCounts.HEAD < manifest.objectCount) {
    throw new Error('MEDIA_E_R2_INSPECTION_RECEIPT');
  }
  return receipt;
}

export function createRemoteInspectionReceipt(manifest, inspection, {
  target, source, expected, requestCounts,
  startedAt, inspectedAt = new Date().toISOString(),
} = {}) {
  const receipt = {
    schemaVersion: 2,
    contract: 'dwnc-public-media-r2-inspection-v2',
    target,
    source,
    manifestSha256: manifest.manifestSha256,
    desired: manifest.objectCount,
    expected,
    observed: remoteInspectionCounts(inspection),
    requestCounts,
    verificationLevel: 'list-and-head-strict',
    overwrite: 0,
    delete: 0,
    startedAt,
    inspectedAt,
  };
  return validateRemoteInspectionReceipt(receipt, manifest);
}

export function validateBulkSyncReceipt(receipt, manifest) {
  const topKeys = ['schemaVersion', 'contract', 'target', 'source', 'manifestSha256',
    'objectCount', 'totalBytes', 'expectedOrphanCount', 'preInspection',
    'postInspection', 'writes', 'requestCounts', 'verificationLevel', 'startedAt',
    'completedAt'];
  if (!exactKeys(receipt, topKeys) || receipt.schemaVersion !== 1
    || receipt.contract !== 'dwnc-public-media-r2-bulk-sync-v1'
    || !exactKeys(receipt.target, ['environment', 'accountIdSha256', 'bucket'])
    || !['staging', 'production'].includes(receipt.target.environment)
    || !BUCKET.test(receipt.target.bucket ?? '')
    || !SHA256.test(receipt.target.accountIdSha256 ?? '')
    || !exactKeys(receipt.source, ['gitCommit', 'gitTree', 'clean', 'gitCheckCount'])
    || !GIT_OID.test(receipt.source.gitCommit ?? '') || !GIT_OID.test(receipt.source.gitTree ?? '')
    || receipt.source.clean !== true || receipt.source.gitCheckCount !== 3
    || receipt.manifestSha256 !== manifest.manifestSha256
    || receipt.objectCount !== manifest.objectCount || receipt.totalBytes !== manifest.totalBytes
    || !Number.isSafeInteger(receipt.expectedOrphanCount) || receipt.expectedOrphanCount < 0
    || receipt.verificationLevel !== 'post-list-and-head-exact'
    || !validTimestamp(receipt.startedAt) || !validTimestamp(receipt.completedAt)
    || Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) {
    throw new Error('MEDIA_E_R2_BULK_RECEIPT');
  }
  validateRemoteInspectionCounts(receipt.preInspection, manifest);
  validateRemoteInspectionCounts(receipt.postInspection, manifest, {
    exact: manifest.objectCount, missing: 0, mismatch: 0, orphan: receipt.expectedOrphanCount,
  });
  const writeKeys = ['initialMissing', 'exactSkipped', 'conditionalCreateOperations',
    'conditionalIfNoneMatchRequests', 'actualCreated', 'preconditionRecovered',
    'overwrite', 'delete'];
  const writes = receipt.writes;
  if (!exactKeys(writes, writeKeys)
    || writeKeys.some((key) => !Number.isSafeInteger(writes[key]) || writes[key] < 0)
    || receipt.preInspection.mismatch !== 0
    || receipt.preInspection.orphan !== receipt.expectedOrphanCount
    || writes.initialMissing !== receipt.preInspection.missing
    || writes.exactSkipped !== receipt.preInspection.exact
    || writes.conditionalCreateOperations !== writes.initialMissing
    || writes.actualCreated + writes.preconditionRecovered !== writes.conditionalCreateOperations
    || writes.overwrite !== 0 || writes.delete !== 0) {
    throw new Error('MEDIA_E_R2_BULK_RECEIPT');
  }
  validateR2OperationCounts(receipt.requestCounts, { allowGet: false, allowPut: true });
  if (receipt.requestCounts.LIST < 2
    || receipt.requestCounts.HEAD < (2 * manifest.objectCount) + writes.preconditionRecovered
    || receipt.requestCounts.PUT < writes.conditionalCreateOperations
    || writes.conditionalIfNoneMatchRequests !== receipt.requestCounts.PUT) {
    throw new Error('MEDIA_E_R2_BULK_RECEIPT');
  }
  return receipt;
}

export function createBulkSyncReceipt(manifest, {
  target, source, expectedOrphanCount, preInspection, postInspection,
  writes, requestCounts, startedAt, completedAt = new Date().toISOString(),
} = {}) {
  const receipt = {
    schemaVersion: 1,
    contract: 'dwnc-public-media-r2-bulk-sync-v1',
    target,
    source,
    manifestSha256: manifest.manifestSha256,
    objectCount: manifest.objectCount,
    totalBytes: manifest.totalBytes,
    expectedOrphanCount,
    preInspection: remoteInspectionCounts(preInspection),
    postInspection: remoteInspectionCounts(postInspection),
    writes,
    requestCounts,
    verificationLevel: 'post-list-and-head-exact',
    startedAt,
    completedAt,
  };
  return validateBulkSyncReceipt(receipt, manifest);
}

export function fullGetObjectSetSha256(objects) {
  try { return publicMediaFullGetObjectSetSha256(objects); }
  catch { throw new Error('MEDIA_E_REMOTE_FULL_AUDIT'); }
}

function validVersion(value) {
  return value === null || typeof value === 'string'
    && value.length >= 1 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export async function validateOneRemotePublicMediaObject(client, entry) {
  if (!client || typeof client.head !== 'function' || typeof client.getFull !== 'function') {
    throw new Error('MEDIA_E_R2_ONE_OBJECT_INPUT');
  }
  const head = await client.head(entry.key);
  if (head === null) throw new Error('MEDIA_E_R2_ONE_OBJECT_MISSING');
  if (!remoteObjectMatches(entry, head)) throw new Error('MEDIA_E_R2_ONE_OBJECT_HEAD_MISMATCH');
  const full = await client.getFull(entry.key);
  if (!remoteObjectMatches(entry, full)
    || !remoteObjectGenerationMatches(head, full)
    || full.bodyBytes !== entry.size || full.bodySha256 !== entry.sha256) {
    throw new Error('MEDIA_E_R2_ONE_OBJECT_FULL_GET_MISMATCH');
  }
  return { head, full };
}

export function createOneObjectValidationReceipt(manifest, entry, validation, {
  target,
  gitCommitSha,
  requestMethods,
  verifiedAt = new Date().toISOString(),
} = {}) {
  const head = validation?.head;
  const full = validation?.full;
  const methodKeys = ['HEAD', 'GET', 'PUT', 'DELETE'];
  if (!manifest?.entries?.some((candidate) => candidate.key === entry?.key
      && publicMediaEntryManifestSha256(candidate) === publicMediaEntryManifestSha256(entry))
    || !remoteObjectMatches(entry, head) || !remoteObjectMatches(entry, full)
    || !remoteObjectGenerationMatches(head, full)
    || full.bodyBytes !== entry.size || full.bodySha256 !== entry.sha256
    || !target || Object.keys(target).length !== 3 || target.environment !== 'staging'
    || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u.test(target.bucket ?? '')
    || !/^[a-f0-9]{64}$/u.test(target.accountIdSha256 ?? '')
    || !/^[a-f0-9]{40}$/u.test(gitCommitSha ?? '')
    || !requestMethods || Object.keys(requestMethods).length !== methodKeys.length
    || Object.keys(requestMethods).some((method) => !methodKeys.includes(method))
    || !methodKeys.every((method) => Number.isSafeInteger(requestMethods[method])
      && requestMethods[method] >= 0)
    || requestMethods.HEAD !== 1 || requestMethods.GET !== 1
    || requestMethods.PUT !== 0 || requestMethods.DELETE !== 0
    || !validVersion(full.version)
    || typeof verifiedAt !== 'string' || Number.isNaN(Date.parse(verifiedAt))) {
    throw new Error('MEDIA_E_R2_ONE_OBJECT_RECEIPT');
  }
  return {
    schemaVersion: 1,
    contract: 'dwnc-public-media-r2-staging-one-object-validation-v1',
    environment: target.environment,
    credentialRole: 'validator',
    gitCommitSha,
    accountIdSha256: target.accountIdSha256,
    bucket: target.bucket,
    manifestSha256: manifest.manifestSha256,
    manifestEntrySha256: publicMediaEntryManifestSha256(entry),
    key: entry.key,
    size: entry.size,
    sha256: entry.sha256,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
    platformChecksumSha256: full.platformChecksumSha256,
    version: full.version,
    httpEtag: full.httpEtag,
    lastModified: full.lastModified,
    verificationLevel: 'head-and-full-get-sha256',
    headExact: true,
    fullGetBodyBytes: full.bodyBytes,
    fullGetBodySha256: full.bodySha256,
    sameGeneration: true,
    requestMethods: { ...requestMethods },
    overwrite: 0,
    delete: 0,
    verifiedAt,
  };
}

export async function admitOneStagingPublicMediaObject(client, entry, loadBytes) {
  if (!client || typeof client.head !== 'function' || typeof client.putCreateOnly !== 'function'
    || typeof client.getFull !== 'function' || typeof loadBytes !== 'function') {
    throw new Error('MEDIA_E_STAGING_ADMISSION_INPUT');
  }
  const preHead = await client.head(entry.key);
  if (preHead && !remoteObjectMatches(entry, preHead)) {
    throw new Error('MEDIA_E_STAGING_ADMISSION_PRE_HEAD_MISMATCH');
  }

  let generationAnchor = preHead;
  let putAttempted = false;
  let created = false;
  let preconditionRaced = false;
  if (!preHead) {
    const bytes = await loadBytes(entry);
    putAttempted = true;
    const put = await client.putCreateOnly(entry, bytes);
    if (put?.preconditionFailed === true) {
      preconditionRaced = true;
      const raced = await client.head(entry.key);
      if (!remoteObjectMatches(entry, raced)) {
        throw new Error('MEDIA_E_STAGING_ADMISSION_RACE_MISMATCH');
      }
      generationAnchor = raced;
    } else if (put?.created === true && put?.preconditionFailed === false) created = true;
    else throw new Error('MEDIA_E_STAGING_ADMISSION_PUT_RESULT');
  }

  const postHead = await client.head(entry.key);
  if (!remoteObjectMatches(entry, postHead)
    || (generationAnchor && !remoteObjectGenerationMatches(generationAnchor, postHead))) {
    throw new Error('MEDIA_E_STAGING_ADMISSION_POST_HEAD_MISMATCH');
  }
  const full = await client.getFull(entry.key);
  if (!remoteObjectMatches(entry, full)
    || !remoteObjectGenerationMatches(postHead, full)
    || full.bodyBytes !== entry.size || full.bodySha256 !== entry.sha256) {
    throw new Error('MEDIA_E_STAGING_ADMISSION_FULL_GET_MISMATCH');
  }
  return {
    outcome: preHead ? 'already-exact' : preconditionRaced ? 'raced-exact' : 'created',
    putAttempted,
    created,
    preconditionRaced,
    preHeadExact: Boolean(preHead),
    postHead,
    full,
  };
}

export async function auditRemotePublicMediaFull(client, manifest, {
  concurrency = 2,
  expectedHeads = null,
} = {}) {
  if (expectedHeads !== null
    && (!Array.isArray(expectedHeads) || expectedHeads.length !== manifest.entries.length)) {
    throw new Error('MEDIA_E_REMOTE_FULL_AUDIT');
  }
  const objects = await mapWithConcurrency(
    manifest.entries,
    concurrency,
    (entry) => client.getFull(entry.key),
  );
  let totalBytes = 0;
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index];
    const object = objects[index];
    if (!remoteObjectMatches(entry, object)
      || (expectedHeads !== null
        && !remoteObjectGenerationMatches(expectedHeads[index], object))
      || object.bodyBytes !== entry.size
      || object.bodySha256 !== entry.sha256) throw new Error('MEDIA_E_REMOTE_FULL_AUDIT');
    totalBytes += object.bodyBytes;
    if (!Number.isSafeInteger(totalBytes)) throw new Error('MEDIA_E_REMOTE_FULL_AUDIT');
  }
  if (totalBytes !== manifest.totalBytes) throw new Error('MEDIA_E_REMOTE_FULL_AUDIT');
  return { objects, objectCount: objects.length, totalBytes };
}

export function createUnsignedRemoteReceipt(manifest, heads, {
  verifiedAt = new Date().toISOString(),
  target,
  verificationLevel = 'head-exact',
  orphanCount = 0,
  bucketExposure = {
    verification: 'unverified', jurisdiction: null, location: null, storageClass: null,
    bucketPropertiesSha256: null, r2DevEnabled: null, customDomainCount: null,
    verifiedAt: null, evidenceSha256: null,
  },
  fullAuditEvidence = null,
} = {}) {
  if (!Array.isArray(heads) || heads.length !== manifest.entries.length) throw new Error('MEDIA_E_REMOTE_RECEIPT');
  if (!Number.isSafeInteger(orphanCount) || orphanCount < 0) throw new Error('MEDIA_E_REMOTE_RECEIPT');
  const objects = manifest.entries.map((entry, index) => {
    const remote = heads[index];
    if (!remoteObjectMatches(entry, remote)
      || verificationLevel === 'full-get-sha256'
        && (remote.bodyBytes !== entry.size || remote.bodySha256 !== entry.sha256)) {
      throw new Error('MEDIA_E_REMOTE_RECEIPT');
    }
    return {
      key: entry.key,
      size: entry.size,
      sha256: entry.sha256,
      contentType: entry.contentType,
      manifestEntrySha256: publicMediaEntryManifestSha256(entry),
      platformChecksumSha256: remote.platformChecksumSha256,
      version: remote.version,
      httpEtag: remote.httpEtag,
      lastModified: remote.lastModified,
    };
  });
  const audit = verificationLevel === 'full-get-sha256' ? {
    headObjects: manifest.objectCount,
    fullGetObjects: manifest.objectCount,
    fullGetBytes: manifest.totalBytes,
    fullGetContract: 'all-manifest-objects-streamed-sha256-v1',
    fullObjectSetSha256: fullGetObjectSetSha256(heads),
    orphanCount,
    requestCounts: fullAuditEvidence?.requestCounts,
    sourceCommit: fullAuditEvidence?.sourceCommit,
    sourceTree: fullAuditEvidence?.sourceTree,
    gitCheckCount: fullAuditEvidence?.gitCheckCount,
    startedAt: fullAuditEvidence?.startedAt,
    exposureCaptureSha256: fullAuditEvidence?.exposureCaptureSha256,
  } : {
    headObjects: manifest.objectCount,
    fullGetObjects: 0,
    fullGetBytes: 0,
    orphanCount,
  };
  const receipt = {
    schemaVersion: 1,
    contract: 'dwnc-public-media-r2-receipt-v1',
    manifestSha256: manifest.manifestSha256,
    objectCount: manifest.objectCount,
    totalBytes: manifest.totalBytes,
    target,
    verificationLevel,
    bucketExposure,
    verifiedAt,
    audit,
    objects,
  };
  validateRemoteReceipt(receipt, manifest);
  return receipt;
}

export async function loadRemoteReceiptFiles({ receiptPath, signaturePath, publicKeyPath }) {
  if (![receiptPath, signaturePath, publicKeyPath].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('MEDIA_E_REMOTE_RECEIPT_REQUIRED');
  }
  let receiptRaw;
  let signatureRaw;
  let publicKeyPem;
  try {
    [receiptRaw, signatureRaw, publicKeyPem] = await Promise.all([
      readFile(receiptPath, 'utf8'), readFile(signaturePath, 'utf8'), readFile(publicKeyPath, 'utf8'),
    ]);
  } catch { throw new Error('MEDIA_E_REMOTE_RECEIPT_REQUIRED'); }
  let receipt;
  try { receipt = JSON.parse(receiptRaw); }
  catch { throw new Error('MEDIA_E_REMOTE_RECEIPT'); }
  const compactSignature = signatureRaw.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/u.test(compactSignature)) throw new Error('MEDIA_E_REMOTE_SIGNATURE');
  const signature = Buffer.from(compactSignature, 'base64');
  return { receipt, signature, publicKeyPem };
}

export async function loadLocalMediaBytes(root, entry) {
  const publicRoot = path.resolve(root, 'public');
  const target = path.resolve(publicRoot, entry.key);
  if (!target.startsWith(`${publicRoot}${path.sep}`)) throw new Error('MEDIA_E_UPLOAD_LOCAL_PATH');
  let bytes;
  try { bytes = await readSecureBytes(target); }
  catch { throw new Error('MEDIA_E_UPLOAD_LOCAL_READ'); }
  return bytes;
}
