import path from 'node:path';
import {
  canonicalR2ExposureCapturePayload,
  canonicalR2ExposureEvidencePayload,
  fetchR2ExposureCapture,
} from './lib/cloudflare-r2-exposure.mjs';
import {
  cloudflareControlPlaneReadCredentials,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import {
  cloudflareAccountIdSha256,
  loadTrackedPublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';

installStructuredErrorHandler('cloudflare-r2-private-exposure-fetch');
const environment = process.argv.find((value) => value.startsWith('--environment='))?.slice(14);
const capturePath = process.env.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH;
const evidencePath = process.env.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH;
if (!['staging', 'production'].includes(environment)
  || ![capturePath, evidencePath].every((value) => typeof value === 'string' && path.isAbsolute(value))
  || capturePath === evidencePath) throw new Error('CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
await Promise.all([
  assertSecureCreateOnlyDestination(capturePath),
  assertSecureCreateOnlyDestination(evidencePath),
]);
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(process.cwd());
const target = releasePolicy[environment];
const controlPlane = cloudflareControlPlaneReadCredentials(process.env);
const accountId = controlPlane.accountId;
if (cloudflareAccountIdSha256(accountId.toLowerCase()) !== target.accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
const capture = await fetchR2ExposureCapture({
  environment,
  bucket: target.bucket,
  accountId,
  apiToken: controlPlane.apiToken,
  jurisdiction: 'default',
});
await writeCanonicalEvidenceCreateOnly(
  capturePath, capture, canonicalR2ExposureCapturePayload,
);
await writeCanonicalEvidenceCreateOnly(
  evidencePath, capture.evidence, canonicalR2ExposureEvidencePayload,
);
console.log(JSON.stringify({
  contract: capture.evidence.contract,
  environment,
  bucket: target.bucket,
  jurisdiction: capture.evidence.jurisdiction,
  location: capture.evidence.location,
  storageClass: capture.evidence.storageClass,
  r2DevEnabled: false,
  customDomainCount: 0,
  captureWritten: true,
  signed: false,
}, null, 2));
