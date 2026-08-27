import path from 'node:path';
import {
  accountWorkersDevSubdomainRequestSha256,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  bootstrapWorkerName,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
  canonicalBootstrapAuthorizationPayload,
  canonicalServiceExistenceEvidencePayload,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  serviceExistenceRequestSha256,
  validateAccountWorkersDevSubdomainEvidence,
  validateBootstrapAuthorization,
  validateServiceExistenceEvidence,
} from './lib/cloudflare-bootstrap.mjs';
import {
  loadSignedJsonFiles,
  sha256Hex,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import { executeBootstrapMutationProduction } from './lib/cloudflare-bootstrap-execution.mjs';
import {
  cloudflareControlPlaneCredentials,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-deny-bootstrap');
const environment = process.argv.find((value) => value.startsWith('--environment='))?.split('=')[1];
if (!['production', 'staging'].includes(environment)) {
  throw new Error('CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT');
}
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_PATH');
  }
  return value;
};
if (process.env.CLOUDFLARE_DENY_BOOTSTRAP_APPROVED
  !== `${environment}:${bootstrapWorkerName(environment)}:workers-dev-disabled`) {
  throw new Error('CLOUDFLARE_E_BOOTSTRAP_APPROVAL');
}
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
const [policy, evidenceFiles, accountSubdomainFiles, authorizationFiles] = await Promise.all([
  loadTrackedPublicMediaReleasePolicy(ROOT),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_SERVICE_EXISTENCE')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_ACCOUNT_SUBDOMAIN')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_BOOTSTRAP_AUTHORIZATION')),
]);
const target = policy[environment];
verifySignedPayload({
  payload: evidenceFiles.receipt,
  canonicalPayload: canonicalServiceExistenceEvidencePayload,
  validator: validateServiceExistenceEvidence,
  signature: evidenceFiles.signature,
  publicKeyPem: evidenceFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: { environment, workerName: bootstrapWorkerName(environment), exists: false },
    now: new Date(),
  },
});
const evidenceSha256 = sha256Hex(canonicalServiceExistenceEvidencePayload(evidenceFiles.receipt));
verifySignedPayload({
  payload: accountSubdomainFiles.receipt,
  canonicalPayload: canonicalAccountWorkersDevSubdomainEvidencePayload,
  validator: validateAccountWorkersDevSubdomainEvidence,
  signature: accountSubdomainFiles.signature,
  publicKeyPem: accountSubdomainFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      environment,
      workerName: bootstrapWorkerName(environment),
      accountIdSha256: target.accountIdSha256,
      accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    },
    now: new Date(),
  },
});
const accountSubdomainEvidenceSha256 = sha256Hex(
  canonicalAccountWorkersDevSubdomainEvidencePayload(accountSubdomainFiles.receipt),
);
verifySignedPayload({
  payload: authorizationFiles.receipt,
  canonicalPayload: canonicalBootstrapAuthorizationPayload,
  validator: validateBootstrapAuthorization,
  signature: authorizationFiles.signature,
  publicKeyPem: authorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      environment,
      workerName: bootstrapWorkerName(environment),
      accountIdSha256: target.accountIdSha256,
      denyWorkerSha256: bootstrapDenyWorkerSha256(),
      bootstrapConfigSha256: bootstrapConfigSha256(environment),
      serviceEvidenceSha256: evidenceSha256,
      accountSubdomainEvidenceSha256,
      expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
      freshAbsenceRequired: true,
      freshAbsenceRequestSha256: serviceExistenceRequestSha256({
        environment, accountIdSha256: target.accountIdSha256,
      }),
      freshAccountSubdomainRequired: true,
      freshAccountSubdomainRequestSha256: accountWorkersDevSubdomainRequestSha256({
        environment, accountIdSha256: target.accountIdSha256,
      }),
      maxFreshAbsenceAgeSeconds: 15,
      maxFreshAccountSubdomainAgeSeconds: 15,
    },
    now: new Date(),
  },
});
const authorizationSha256 = sha256Hex(
  canonicalBootstrapAuthorizationPayload(authorizationFiles.receipt),
);
// No flag or environment variable can bypass this stop. The separate status-only
// recovery protocol must be implemented and reviewed before this local constant changes.
const statusOnlyRecoveryImplemented = () => false;
if (!statusOnlyRecoveryImplemented()) {
  throw new Error('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECOVERY_REQUIRED');
}
const controlPlane = cloudflareControlPlaneCredentials(process.env);
const execution = await executeBootstrapMutationProduction({
  repositoryRoot: ROOT,
  environment,
  targetAccountIdSha256: target.accountIdSha256,
  authorization: authorizationFiles.receipt,
  authorizationSha256,
  serviceEvidenceSha256: evidenceSha256,
  accountSubdomainEvidenceSha256,
  controlPlane,
});
console.log(JSON.stringify(execution.result));
