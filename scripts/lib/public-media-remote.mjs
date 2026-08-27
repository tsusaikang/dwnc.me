import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  publicMediaEntryManifestSha256,
  validateRemoteReceipt,
} from './public-media-manifest.mjs';
import {
  remoteObjectGenerationMatches,
  remoteObjectMatches,
} from './r2-s3-client.mjs';
import { readSecureBytes } from './global-sequence.mjs';

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

export function createRemoteInspectionReceipt(manifest, inspection, {
  target,
  inspectedAt = new Date().toISOString(),
} = {}) {
  const categories = [inspection?.exact, inspection?.missing, inspection?.mismatch];
  if (!manifest || !categories.every(Array.isArray)
    || !Array.isArray(inspection?.heads)
    || categories.reduce((sum, values) => sum + values.length, 0) !== manifest.objectCount
    || inspection.heads.length !== manifest.objectCount
    || !Number.isSafeInteger(inspection.listedCount) || inspection.listedCount < 0
    || !Number.isSafeInteger(inspection.orphanCount) || inspection.orphanCount < 0
    || inspection.orphanCount > inspection.listedCount
    || !target || Object.keys(target).length !== 3
    || target.environment !== 'staging'
    || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u.test(target.bucket ?? '')
    || !/^[a-f0-9]{64}$/u.test(target.accountIdSha256 ?? '')
    || typeof inspectedAt !== 'string' || Number.isNaN(Date.parse(inspectedAt))) {
    throw new Error('MEDIA_E_R2_INSPECTION_RECEIPT');
  }
  return {
    schemaVersion: 1,
    contract: 'dwnc-public-media-r2-inspection-v1',
    environment: target.environment,
    accountIdSha256: target.accountIdSha256,
    bucket: target.bucket,
    manifestSha256: manifest.manifestSha256,
    desired: manifest.objectCount,
    listed: inspection.listedCount,
    exact: inspection.exact.length,
    missing: inspection.missing.length,
    mismatch: inspection.mismatch.length,
    orphan: inspection.orphanCount,
    verificationLevel: 'list-and-head',
    overwrite: 0,
    delete: 0,
    inspectedAt,
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
    audit: {
      headObjects: manifest.objectCount,
      fullGetObjects: verificationLevel === 'full-get-sha256' ? manifest.objectCount : 0,
      fullGetBytes: verificationLevel === 'full-get-sha256' ? manifest.totalBytes : 0,
      orphanCount,
    },
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
