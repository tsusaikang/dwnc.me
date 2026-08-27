import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalWorkersDevStatusCapturePayload,
  canonicalWorkersDevStatusPayload,
  fetchWorkersDevStatusCapture,
} from './lib/cloudflare-workers-dev.mjs';
import {
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { readCloudflareStagingControlOperation }
  from './lib/cloudflare-staging-control-operation.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256, loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

export async function fetchCloudflareStagingWorkersDevStatus({
  source = process.env,
  root = process.cwd(),
  assertDestination = assertSecureCreateOnlyDestination,
  readOperation = readCloudflareStagingControlOperation,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  fetchStatus = fetchWorkersDevStatusCapture,
  writeEvidence = writeCanonicalEvidenceCreateOnly,
} = {}) {
  const capturePath = source.CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH;
  const evidencePath = source.CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH;
  if (![capturePath, evidencePath]
    .every((value) => typeof value === 'string' && path.isAbsolute(value))
    || capturePath === evidencePath) throw new Error('CLOUDFLARE_E_WORKERS_DEV_ARGUMENT');
  await Promise.all([
    assertDestination(capturePath),
    assertDestination(evidencePath),
  ]);
  const controlPlane = readOperation(source, 'staging-workers-dev-status');
  let capture;
  try {
    const releasePolicy = await loadPolicy(root);
    if (cloudflareAccountIdSha256(controlPlane.accountId.toLowerCase())
      !== releasePolicy.staging.accountIdSha256) {
      throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
    }
    capture = await fetchStatus({
      accountId: controlPlane.accountId,
      apiToken: controlPlane.apiToken,
    });
  } finally { controlPlane.clear(); }
  await writeEvidence(capturePath, capture, canonicalWorkersDevStatusCapturePayload);
  await writeEvidence(evidencePath, capture.evidence, canonicalWorkersDevStatusPayload);
  return {
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
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-staging-workers-dev-status');
  console.log(JSON.stringify(await fetchCloudflareStagingWorkersDevStatus(), null, 2));
}
