import path from 'node:path';
import {
  canonicalAccountWorkersDevSubdomainCapturePayload,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
  canonicalServiceExistenceCapturePayload,
  canonicalServiceExistenceEvidencePayload,
  fetchAccountWorkersDevSubdomainCapture,
  fetchServiceExistenceCapture,
  validateAccountWorkersDevSubdomainEvidence,
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
const accountSubdomainOutputPath = process.env.CLOUDFLARE_ACCOUNT_SUBDOMAIN_EVIDENCE_PATH;
const accountSubdomainCapturePath = process.env.CLOUDFLARE_ACCOUNT_SUBDOMAIN_CAPTURE_PATH;
if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)
  || typeof capturePath !== 'string' || !path.isAbsolute(capturePath)
  || typeof accountSubdomainOutputPath !== 'string' || !path.isAbsolute(accountSubdomainOutputPath)
  || typeof accountSubdomainCapturePath !== 'string' || !path.isAbsolute(accountSubdomainCapturePath)
  || new Set([outputPath, capturePath, accountSubdomainOutputPath,
    accountSubdomainCapturePath]).size !== 4) {
  throw new Error('CLOUDFLARE_E_SERVICE_EXISTENCE_PATH');
}
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const controlPlane = cloudflareControlPlaneCredentials(process.env);
if (cloudflareAccountIdSha256(controlPlane.accountId.toLowerCase())
  !== policy[environment].accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
const [capture, accountSubdomainCapture] = await Promise.all([
  fetchServiceExistenceCapture({
    environment, accountId: controlPlane.accountId, apiToken: controlPlane.apiToken,
  }),
  fetchAccountWorkersDevSubdomainCapture({
    environment, accountId: controlPlane.accountId, apiToken: controlPlane.apiToken,
  }),
]);
const receipt = capture.evidence;
const accountSubdomainReceipt = accountSubdomainCapture.evidence;
validateServiceExistenceEvidence(receipt);
validateAccountWorkersDevSubdomainEvidence(accountSubdomainReceipt, {
  expected: { accountIdSha256: receipt.accountIdSha256, environment },
});
await writeCanonicalEvidenceCreateOnly(
  accountSubdomainCapturePath, accountSubdomainCapture,
  canonicalAccountWorkersDevSubdomainCapturePayload,
);
await writeCanonicalEvidenceCreateOnly(
  accountSubdomainOutputPath, accountSubdomainReceipt,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
);
await writeCanonicalEvidenceCreateOnly(
  capturePath, capture, canonicalServiceExistenceCapturePayload,
);
await writeCanonicalEvidenceCreateOnly(
  outputPath, receipt, canonicalServiceExistenceEvidencePayload,
);
console.log(JSON.stringify({
  contract: receipt.contract, environment, exists: receipt.exists,
  accountSubdomainVerified: true, capturesWritten: 2, evidenceFilesWritten: 2, signed: false,
}));
