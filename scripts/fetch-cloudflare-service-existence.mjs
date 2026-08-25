import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalServiceExistenceCapturePayload,
  canonicalServiceExistenceEvidencePayload,
  fetchServiceExistenceCapture,
  validateServiceExistenceEvidence,
} from './lib/cloudflare-bootstrap.mjs';
import { cloudflareUploadEnvironment, installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
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
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (cloudflareAccountIdSha256(accountId?.toLowerCase()) !== policy[environment].accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
const childEnvironment = cloudflareUploadEnvironment(process.env);
const capture = await fetchServiceExistenceCapture({
  environment, accountId, apiToken: childEnvironment.CLOUDFLARE_API_TOKEN,
});
const receipt = capture.evidence;
validateServiceExistenceEvidence(receipt);
await writeFile(capturePath, `${canonicalServiceExistenceCapturePayload(capture)}\n`,
  { flag: 'wx', mode: 0o600 });
await writeFile(outputPath, `${canonicalServiceExistenceEvidencePayload(receipt)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  contract: receipt.contract, environment, exists: receipt.exists,
  captureWritten: true, signed: false,
}));
