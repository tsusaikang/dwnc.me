import { readFile } from 'node:fs/promises';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  validateProductionReleaseTarget,
  validateRemoteReceipt,
  verifyRemoteReceiptSignature,
} from './lib/public-media-manifest.mjs';
import {
  inspectRemotePublicMedia,
  loadRemoteReceiptFiles,
} from './lib/public-media-remote.mjs';
import {
  r2ClientContextFromEnvironment,
} from './lib/r2-s3-client.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('media-r2-remote-validate');
const manifest = await loadTrackedPublicMediaManifest(ROOT);
const receiptFiles = await loadRemoteReceiptFiles({
  receiptPath: process.env.PUBLIC_MEDIA_REMOTE_RECEIPT_PATH,
  signaturePath: process.env.PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH,
  publicKeyPath: process.env.PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH,
});
validateRemoteReceipt(receiptFiles.receipt, manifest);
const { credentials: r2Credentials, client } = r2ClientContextFromEnvironment(process.env);
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true });
const wranglerConfig = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
validateProductionReleaseTarget({
  policy,
  receipt: receiptFiles.receipt,
  accountId: r2Credentials.accountId,
  bucket: r2Credentials.bucket,
  publicKeyPem: receiptFiles.publicKeyPem,
  wranglerConfig,
});
verifyRemoteReceiptSignature(receiptFiles.receipt, receiptFiles.signature, receiptFiles.publicKeyPem);

const inspection = await inspectRemotePublicMedia(client, manifest, { concurrency: 8 });
if (inspection.missing.length > 0 || inspection.mismatch.length > 0) throw new Error('MEDIA_E_REMOTE_VALIDATION');
if (inspection.orphanCount !== receiptFiles.receipt.audit.orphanCount
  || inspection.orphanCount !== policy.production.approvedOrphanCount) {
  throw new Error('MEDIA_E_ORPHAN_APPROVAL');
}
const receiptByKey = new Map(receiptFiles.receipt.objects.map((object) => [object.key, object]));
for (const remote of inspection.heads) {
  const receipt = receiptByKey.get(remote.key);
  if (!receipt
    || receipt.httpEtag !== remote.httpEtag
    || receipt.version !== remote.version
    || receipt.platformChecksumSha256 !== remote.platformChecksumSha256
    || receipt.manifestEntrySha256 !== remote.manifestEntrySha256) {
    throw new Error('MEDIA_E_REMOTE_RECEIPT_DRIFT');
  }
}

console.log(JSON.stringify({
  validationScope: 'public-media-remote-head',
  manifestSha256: manifest.manifestSha256,
  signatureVerified: true,
  exact: inspection.exact.length,
  missing: 0,
  mismatch: 0,
  orphan: inspection.orphanCount,
  signedFullGetObjects: receiptFiles.receipt.audit.fullGetObjects,
  signedFullGetBytes: receiptFiles.receipt.audit.fullGetBytes,
  bodyBytesDownloaded: 0,
}, null, 2));
