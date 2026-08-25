import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateStagingUploadArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalVersionAttestationPayload,
  loadSignedJsonFiles,
  sha256Hex,
  validateVersionAttestation,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import {
  canonicalStagingMediaProbePayload,
  probeStagingMediaObject,
  validateStagingMediaProbeReceipt,
} from './lib/cloudflare-staging.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  cloudflareAccountIdSha256,
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  validateConfiguredReleaseTarget,
} from './lib/public-media-manifest.mjs';
import { r2ClientFromEnvironment } from './lib/r2-s3-client.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-staging-media-probe');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_STAGING_PROBE_INPUT');
  return value;
};
const outputPath = absolute(process.env.CLOUDFLARE_STAGING_MEDIA_PROBE_PATH);
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const origin = process.env.CLOUDFLARE_STAGING_SYNTHETIC_ORIGIN;
const token = process.env.CLOUDFLARE_STAGING_SMOKE_TOKEN;
if (typeof token !== 'string' || token.length < 32) throw new Error('CLOUDFLARE_E_STAGING_PROBE_INPUT');
const [manifest, policy, wranglerConfig] = await Promise.all([
  loadTrackedPublicMediaManifest(ROOT),
  loadTrackedPublicMediaReleasePolicy(ROOT),
  readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8').then(JSON.parse),
]);
const { receipt: artifact, artifactSha256 } = await validateStagingUploadArtifactDirectory(
  artifactDirectory, { policy, manifest },
);
const target = validateConfiguredReleaseTarget({
  policy,
  environment: 'staging',
  accountId: process.env.R2_ACCOUNT_ID,
  bucket: process.env.R2_BUCKET_NAME,
  wranglerConfig,
});
if (origin !== target.smokeOrigin || artifact.stagingAccountIdSha256 !== target.accountIdSha256
  || !/^[a-f0-9]{64}$/u.test(target.releasePublicKeySpkiSha256 ?? '')) {
  throw new Error('CLOUDFLARE_E_STAGING_PROBE_TARGET');
}
const versionFiles = await loadSignedJsonFiles({
  receiptPath: absolute(process.env.CLOUDFLARE_STAGING_VERSION_ATTESTATION_RECEIPT_PATH),
  signaturePath: absolute(process.env.CLOUDFLARE_STAGING_VERSION_ATTESTATION_SIGNATURE_PATH),
  publicKeyPath: absolute(process.env.CLOUDFLARE_STAGING_VERSION_ATTESTATION_PUBLIC_KEY_PATH),
});
verifySignedPayload({
  payload: versionFiles.receipt,
  canonicalPayload: canonicalVersionAttestationPayload,
  validator: validateVersionAttestation,
  signature: versionFiles.signature,
  publicKeyPem: versionFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      artifactSha256, payloadSha256: artifact.payloadSha256,
      environment: 'staging', workerName: 'dwnc-me-staging',
      accountIdSha256: artifact.stagingAccountIdSha256,
    },
    now: new Date(),
  },
});
const client = r2ClientFromEnvironment(process.env);
const fetcher = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};
const evidence = await probeStagingMediaObject({
  client, fetcher, origin, entry: manifest.entries[0],
  stagingVersionId: versionFiles.receipt.versionId,
});
const observedAt = new Date().toISOString();
const receipt = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-staging-one-object-probe-v1',
  environment: 'staging',
  artifactSha256,
  payloadSha256: artifact.payloadSha256,
  stagingVersionId: versionFiles.receipt.versionId,
  originSha256: sha256Hex(origin),
  accountIdSha256: cloudflareAccountIdSha256(process.env.R2_ACCOUNT_ID),
  bucket: target.bucket,
  manifestSha256: manifest.manifestSha256,
  keySha256: evidence.keySha256,
  versionSha256: evidence.versionSha256,
  httpEtagSha256: evidence.httpEtagSha256,
  s3HeadVerified: evidence.s3HeadVerified,
  workerBindingVerified: evidence.workerBindingVerified,
  fullBodySha256Verified: evidence.fullBodySha256Verified,
  rangeVerified: evidence.rangeVerified,
  observedAt,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
};
validateStagingMediaProbeReceipt(receipt);
await writeFile(outputPath, `${canonicalStagingMediaProbePayload(receipt)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  contract: receipt.contract, artifactSha256, stagingVersionId: receipt.stagingVersionId,
  candidateUnsigned: true, signingRequired: true, secretPrinted: false,
}, null, 2));
