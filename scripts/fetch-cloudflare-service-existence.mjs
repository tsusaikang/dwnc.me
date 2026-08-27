import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { readCloudflareStagingControlOperation }
  from './lib/cloudflare-staging-control-operation.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256, loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

export async function fetchCloudflareServiceExistence({
  argv = process.argv.slice(2),
  source = process.env,
  root = process.cwd(),
  assertDestination = assertSecureCreateOnlyDestination,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  readStagingOperation = readCloudflareStagingControlOperation,
  readProductionCredentials = cloudflareControlPlaneCredentials,
  fetchService = fetchServiceExistenceCapture,
  fetchSubdomain = fetchAccountWorkersDevSubdomainCapture,
  writeEvidence = writeCanonicalEvidenceCreateOnly,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT');
  }
  const environment = argv.find((value) => value.startsWith('--environment='))?.split('=')[1];
  if (!['production', 'staging'].includes(environment)) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT');
  }
  const outputPath = source.CLOUDFLARE_SERVICE_EXISTENCE_EVIDENCE_PATH;
  const capturePath = source.CLOUDFLARE_SERVICE_EXISTENCE_CAPTURE_PATH;
  const accountSubdomainOutputPath = source.CLOUDFLARE_ACCOUNT_SUBDOMAIN_EVIDENCE_PATH;
  const accountSubdomainCapturePath = source.CLOUDFLARE_ACCOUNT_SUBDOMAIN_CAPTURE_PATH;
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)
    || typeof capturePath !== 'string' || !path.isAbsolute(capturePath)
    || typeof accountSubdomainOutputPath !== 'string' || !path.isAbsolute(accountSubdomainOutputPath)
    || typeof accountSubdomainCapturePath !== 'string' || !path.isAbsolute(accountSubdomainCapturePath)
    || new Set([outputPath, capturePath, accountSubdomainOutputPath,
      accountSubdomainCapturePath]).size !== 4) {
    throw new Error('CLOUDFLARE_E_SERVICE_EXISTENCE_PATH');
  }
  await Promise.all([
    outputPath, capturePath, accountSubdomainOutputPath, accountSubdomainCapturePath,
  ].map((file) => assertDestination(file)));
  const controlPlane = environment === 'staging'
    ? readStagingOperation(source, 'staging-service-existence')
    : readProductionCredentials(source);
  let capture;
  let accountSubdomainCapture;
  try {
    const policy = await loadPolicy(root);
    if (cloudflareAccountIdSha256(controlPlane.accountId.toLowerCase())
      !== policy[environment].accountIdSha256) {
      throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
    }
    [capture, accountSubdomainCapture] = await Promise.all([
      fetchService({
        environment, accountId: controlPlane.accountId, apiToken: controlPlane.apiToken,
      }),
      fetchSubdomain({
        environment, accountId: controlPlane.accountId, apiToken: controlPlane.apiToken,
      }),
    ]);
  } finally { controlPlane.clear?.(); }
  const receipt = capture.evidence;
  const accountSubdomainReceipt = accountSubdomainCapture.evidence;
  validateServiceExistenceEvidence(receipt);
  validateAccountWorkersDevSubdomainEvidence(accountSubdomainReceipt, {
    expected: { accountIdSha256: receipt.accountIdSha256, environment },
  });
  await writeEvidence(
    accountSubdomainCapturePath, accountSubdomainCapture,
    canonicalAccountWorkersDevSubdomainCapturePayload,
  );
  await writeEvidence(
    accountSubdomainOutputPath, accountSubdomainReceipt,
    canonicalAccountWorkersDevSubdomainEvidencePayload,
  );
  await writeEvidence(capturePath, capture, canonicalServiceExistenceCapturePayload);
  await writeEvidence(outputPath, receipt, canonicalServiceExistenceEvidencePayload);
  return {
    contract: receipt.contract, environment, exists: receipt.exists,
    accountSubdomainVerified: true, capturesWritten: 2, evidenceFilesWritten: 2, signed: false,
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-service-existence-fetch');
  console.log(JSON.stringify(await fetchCloudflareServiceExistence()));
}
