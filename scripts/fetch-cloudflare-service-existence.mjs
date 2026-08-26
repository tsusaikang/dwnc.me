import path from 'node:path';
import {
  canonicalServiceExistenceCapturePayload,
  canonicalServiceExistenceEvidencePayload,
  fetchServiceExistenceCapture,
  validateServiceExistenceEvidence,
} from './lib/cloudflare-bootstrap.mjs';
import {
  cloudflareControlPlaneCredentials,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256, loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-service-existence-fetch');
const environment = process.argv.find((value) => value.startsWith('--environment='))?.split('=')[1];
if (!['production', 'staging'].includes(environment)) throw new Error('CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT');
const outputPath = process.env.CLOUDFLARE_SERVICE_EXISTENCE_EVIDENCE_PATH;
const capturePath = process.env.CLOUDFLARE_SERVICE_EXISTENCE_CAPTURE_PATH;
if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)
  || typeof capturePath !== 'string' || !path.isAbsolute(capturePath)
  || capturePath === outputPath) throw new Error('CLOUDFLARE_E_SERVICE_EXISTENCE_PATH');
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const controlPlane = cloudflareControlPlaneCredentials(process.env);
if (cloudflareAccountIdSha256(controlPlane.accountId.toLowerCase())
  !== policy[environment].accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
const capture = await fetchServiceExistenceCapture({
  environment, accountId: controlPlane.accountId, apiToken: controlPlane.apiToken,
});
const receipt = capture.evidence;
validateServiceExistenceEvidence(receipt);
await writeCanonicalEvidenceCreateOnly(
  capturePath, capture, canonicalServiceExistenceCapturePayload,
);
await writeCanonicalEvidenceCreateOnly(
  outputPath, receipt, canonicalServiceExistenceEvidencePayload,
);
console.log(JSON.stringify({
  contract: receipt.contract, environment, exists: receipt.exists,
  captureWritten: true, signed: false,
}));
