import path from 'node:path';
import {
  canonicalWorkersDevStatusCapturePayload,
  canonicalWorkersDevStatusPayload,
  fetchWorkersDevStatusCapture,
} from './lib/cloudflare-workers-dev.mjs';
import {
  cloudflareControlPlaneReadCredentials,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256, loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

installStructuredErrorHandler('cloudflare-staging-workers-dev-status');
const capturePath = process.env.CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH;
const evidencePath = process.env.CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH;
if (![capturePath, evidencePath].every((value) => typeof value === 'string' && path.isAbsolute(value))
  || capturePath === evidencePath) throw new Error('CLOUDFLARE_E_WORKERS_DEV_ARGUMENT');
await Promise.all([
  assertSecureCreateOnlyDestination(capturePath),
  assertSecureCreateOnlyDestination(evidencePath),
]);
const controlPlane = cloudflareControlPlaneReadCredentials(process.env);
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(process.cwd());
if (cloudflareAccountIdSha256(controlPlane.accountId.toLowerCase())
  !== releasePolicy.staging.accountIdSha256) throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
const capture = await fetchWorkersDevStatusCapture({
  accountId: controlPlane.accountId,
  apiToken: controlPlane.apiToken,
});
await writeCanonicalEvidenceCreateOnly(
  capturePath, capture, canonicalWorkersDevStatusCapturePayload,
);
await writeCanonicalEvidenceCreateOnly(
  evidencePath, capture.evidence, canonicalWorkersDevStatusPayload,
);
console.log(JSON.stringify({
  contract: capture.evidence.contract,
  environment: 'staging',
  workerName: capture.evidence.workerName,
  origin: capture.evidence.origin,
  enabled: capture.evidence.enabled,
  previewUrlsEnabled: capture.evidence.previewUrlsEnabled,
  observabilityEnabled: capture.evidence.observabilityEnabled,
  logsHeadSamplingRate: capture.evidence.logsHeadSamplingRate,
  readOnly: true,
  signed: false,
}, null, 2));
