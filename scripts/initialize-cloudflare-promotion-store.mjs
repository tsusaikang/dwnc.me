import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalBootstrapAttestationPayload,
  createBootstrapPromotionBaseline,
  validateBootstrapAttestation,
} from './lib/cloudflare-bootstrap.mjs';
import { loadSignedJsonFiles, verifySignedPayload } from './lib/cloudflare-release.mjs';
import {
  createSignedPromotionHead,
  initializePromotionStore,
} from './lib/cloudflare-promotion-store.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-promotion-store-initialize');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_PROMOTION_STORE');
  return value;
};
if (process.env.CLOUDFLARE_PROMOTION_STORE_INITIALIZE_APPROVED !== 'production:deny-bootstrap-baseline') {
  throw new Error('CLOUDFLARE_E_PROMOTION_STORE_APPROVAL');
}
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true });
const files = await loadSignedJsonFiles({
  receiptPath: absolute(process.env.CLOUDFLARE_BOOTSTRAP_ATTESTATION_RECEIPT_PATH),
  signaturePath: absolute(process.env.CLOUDFLARE_BOOTSTRAP_ATTESTATION_SIGNATURE_PATH),
  publicKeyPath: absolute(process.env.CLOUDFLARE_BOOTSTRAP_ATTESTATION_PUBLIC_KEY_PATH),
});
verifySignedPayload({
  payload: files.receipt,
  canonicalPayload: canonicalBootstrapAttestationPayload,
  validator: validateBootstrapAttestation,
  signature: files.signature,
  publicKeyPem: files.publicKeyPem,
  expectedPublicKeySpkiSha256: policy.production.releasePublicKeySpkiSha256,
  validation: { expected: { environment: 'production', workerName: 'dwnc-me' } },
});
const privateKeyPath = absolute(process.env.CLOUDFLARE_ACTIVE_PROMOTION_PRIVATE_KEY_PATH);
const privateStats = await lstat(privateKeyPath);
if (!privateStats.isFile() || privateStats.isSymbolicLink() || privateStats.nlink !== 1
  || (privateStats.mode & 0o777) !== 0o600) throw new Error('CLOUDFLARE_E_PROMOTION_SIGNER');
const baseline = createBootstrapPromotionBaseline(files.receipt);
const head = createSignedPromotionHead({
  state: baseline,
  privateKeyPem: await readFile(privateKeyPath, 'utf8'),
  publicKeyPem: files.publicKeyPem,
});
await initializePromotionStore({
  directory: absolute(process.env.CLOUDFLARE_PROMOTION_STATE_DIR),
  head,
  publicKeyPem: files.publicKeyPem,
  expectedFingerprint: policy.production.releasePublicKeySpkiSha256,
});
console.log(JSON.stringify({
  contract: head.contract, generation: 0, bootstrapBaseline: true,
  versionId: baseline.versionId, externalSurfaceCount: 0,
}));
