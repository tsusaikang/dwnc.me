import { userInfo } from 'node:os';
import path from 'node:path';
import {
  accountWorkersDevSubdomainRequestSha256,
  bootstrapArguments,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  bootstrapWorkerName,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
  canonicalBootstrapAuthorizationPayload,
  canonicalServiceExistenceEvidencePayload,
  defaultBootstrapProtectedEvidencePaths,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  serviceExistenceRequestSha256,
  validateAccountWorkersDevSubdomainEvidence,
  validateBootstrapAuthorization,
  validateServiceExistenceEvidence,
} from './cloudflare-bootstrap.mjs';
import {
  canonicalJson, loadSignedJsonFiles, sha256Hex, verifySignedPayload,
} from './cloudflare-release.mjs';
import { bootstrapInstantMilliseconds } from './cloudflare-bootstrap-attempt.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;

export const BOOTSTRAP_RECOVERY_SIGNED_PATH_VARIABLES = Object.freeze([
  'CLOUDFLARE_SERVICE_EXISTENCE_RECEIPT_PATH',
  'CLOUDFLARE_SERVICE_EXISTENCE_SIGNATURE_PATH',
  'CLOUDFLARE_SERVICE_EXISTENCE_PUBLIC_KEY_PATH',
  'CLOUDFLARE_ACCOUNT_SUBDOMAIN_RECEIPT_PATH',
  'CLOUDFLARE_ACCOUNT_SUBDOMAIN_SIGNATURE_PATH',
  'CLOUDFLARE_ACCOUNT_SUBDOMAIN_PUBLIC_KEY_PATH',
  'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_RECEIPT_PATH',
  'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_SIGNATURE_PATH',
  'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_PUBLIC_KEY_PATH',
]);

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PATH');
  }
  return value;
}

const signedPaths = (source, prefix) => ({
  receiptPath: absolute(source[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(source[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(source[`${prefix}_PUBLIC_KEY_PATH`]),
});

function assertExactSignedTimes(receipt, keys) {
  for (const key of keys) {
    bootstrapInstantMilliseconds(receipt?.[key], 'CLOUDFLARE_E_BOOTSTRAP_RECOVERY_TIME');
  }
}

export async function loadBootstrapRecoveryLocalContext({
  repositoryRoot,
  source,
  policy,
  home = userInfo().homedir,
  loadSignedFiles = loadSignedJsonFiles,
} = {}) {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)
    || path.resolve(repositoryRoot) !== repositoryRoot
    || !source || typeof source !== 'object' || Array.isArray(source)
    || !policy || typeof policy !== 'object' || Array.isArray(policy)
    || typeof loadSignedFiles !== 'function') {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CONTEXT');
  }
  const selectedPaths = BOOTSTRAP_RECOVERY_SIGNED_PATH_VARIABLES
    .map((name) => absolute(source[name]));
  if (new Set(selectedPaths).size !== selectedPaths.length) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PATH');
  }
  const target = policy.staging;
  if (target?.environment !== 'staging' || target?.bucket !== 'dwnc-me-public-media-staging'
    || !SHA256.test(target?.accountIdSha256 ?? '')
    || !SHA256.test(target?.releasePublicKeySpkiSha256 ?? '')) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CONTEXT');
  }
  const [serviceFiles, accountSubdomainFiles, authorizationFiles] = await Promise.all([
    loadSignedFiles(signedPaths(source, 'CLOUDFLARE_SERVICE_EXISTENCE')),
    loadSignedFiles(signedPaths(source, 'CLOUDFLARE_ACCOUNT_SUBDOMAIN')),
    loadSignedFiles(signedPaths(source, 'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION')),
  ]);
  assertExactSignedTimes(serviceFiles.receipt, [
    'requestStartedAt', 'requestCompletedAt', 'observedAt', 'expiresAt',
  ]);
  assertExactSignedTimes(accountSubdomainFiles.receipt, [
    'requestStartedAt', 'requestCompletedAt', 'observedAt', 'expiresAt',
  ]);
  assertExactSignedTimes(authorizationFiles.receipt, ['createdAt', 'expiresAt']);
  verifySignedPayload({
    payload: serviceFiles.receipt,
    canonicalPayload: canonicalServiceExistenceEvidencePayload,
    validator: validateServiceExistenceEvidence,
    signature: serviceFiles.signature,
    publicKeyPem: serviceFiles.publicKeyPem,
    expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
    validation: {
      expected: { environment: 'staging', workerName: bootstrapWorkerName('staging'), exists: false },
      now: new Date(serviceFiles.receipt.observedAt),
    },
  });
  const serviceEvidenceSha256 = sha256Hex(
    canonicalServiceExistenceEvidencePayload(serviceFiles.receipt),
  );
  verifySignedPayload({
    payload: accountSubdomainFiles.receipt,
    canonicalPayload: canonicalAccountWorkersDevSubdomainEvidencePayload,
    validator: validateAccountWorkersDevSubdomainEvidence,
    signature: accountSubdomainFiles.signature,
    publicKeyPem: accountSubdomainFiles.publicKeyPem,
    expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
    validation: {
      expected: {
        environment: 'staging', workerName: bootstrapWorkerName('staging'),
        accountIdSha256: target.accountIdSha256,
        accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
      },
      now: new Date(accountSubdomainFiles.receipt.observedAt),
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
        environment: 'staging', workerName: bootstrapWorkerName('staging'),
        accountIdSha256: target.accountIdSha256,
        denyWorkerSha256: bootstrapDenyWorkerSha256(),
        bootstrapConfigSha256: bootstrapConfigSha256('staging'),
        serviceEvidenceSha256,
        accountSubdomainEvidenceSha256,
        expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
        freshAbsenceRequired: true,
        freshAbsenceRequestSha256: serviceExistenceRequestSha256({
          environment: 'staging', accountIdSha256: target.accountIdSha256,
        }),
        freshAccountSubdomainRequired: true,
        freshAccountSubdomainRequestSha256: accountWorkersDevSubdomainRequestSha256({
          environment: 'staging', accountIdSha256: target.accountIdSha256,
        }),
        maxFreshAbsenceAgeSeconds: 15,
        maxFreshAccountSubdomainAgeSeconds: 15,
      },
      now: new Date(authorizationFiles.receipt.createdAt),
    },
  });
  const authorizationSha256 = sha256Hex(
    canonicalBootstrapAuthorizationPayload(authorizationFiles.receipt),
  );
  const plan = {
    repositoryRoot,
    environment: 'staging',
    targetAccountIdSha256: target.accountIdSha256,
    authorizationSha256,
    sourceGitSha: authorizationFiles.receipt.sourceGitSha,
    serviceEvidenceSha256,
    accountSubdomainEvidenceSha256,
    denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256('staging'),
    commandArgumentsSha256: sha256Hex(canonicalJson(bootstrapArguments({
      environment: 'staging', authorizationSha256,
    }))),
    controlPlane: null,
  };
  return {
    plan,
    paths: defaultBootstrapProtectedEvidencePaths({
      environment: 'staging', authorizationSha256, home,
    }),
    authorization: authorizationFiles.receipt,
  };
}
