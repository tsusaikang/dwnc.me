import { randomBytes, randomUUID } from 'node:crypto';
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
} from './cloudflare-bootstrap.mjs';
import { assertCloudflareAccountTargetOutsideRepository }
  from './cloudflare-account-target.mjs';
import { inspectPublicMediaGit } from './public-media-git.mjs';
import {
  canonicalJson,
  loadSignedJsonFiles,
  sha256Hex,
  verifySignedPayload,
} from './cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  canonicalEvidenceStorageBytes,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './public-media-manifest.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_OID = /^[a-f0-9]{40}$/u;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SIGNED_PATH_KEYS = ['receiptPath', 'signaturePath', 'publicKeyPath'];
const AUTHORIZATION_TTL_MS = 5 * 60 * 1000;

const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

function validateSignedPaths(value) {
  if (!exactKeys(value, SIGNED_PATH_KEYS)
    || SIGNED_PATH_KEYS.some((key) => typeof value[key] !== 'string'
      || !path.isAbsolute(value[key]) || path.resolve(value[key]) !== value[key])) {
    fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_PATH');
  }
  return value;
}

function validateSnapshot(snapshot) {
  if (!exactKeys(snapshot, ['commit', 'tree', 'clean'])
    || !GIT_OID.test(snapshot.commit ?? '') || !GIT_OID.test(snapshot.tree ?? '')
    || snapshot.clean !== true) fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_GIT');
  return snapshot;
}

function currentInstant(now) {
  const value = typeof now === 'function' ? now() : null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_TIME');
  }
  return value;
}

function sameSnapshot(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export async function createCloudflareStagingBootstrapAuthorization({
  repositoryRoot = process.cwd(),
  serviceEvidencePaths,
  accountSubdomainEvidencePaths,
  outputPath,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  loadSignedFiles = loadSignedJsonFiles,
  verifySigned = verifySignedPayload,
  inspectGit = inspectPublicMediaGit,
  assertOutsideRepository = assertCloudflareAccountTargetOutsideRepository,
  assertDestination = assertSecureCreateOnlyDestination,
  writeCandidate = writeCanonicalEvidenceCreateOnly,
  readCandidate = readSecureFile,
  now = () => new Date(),
  randomUUIDImpl = randomUUID,
  randomBytesImpl = randomBytes,
} = {}) {
  const servicePaths = validateSignedPaths(serviceEvidencePaths);
  const subdomainPaths = validateSignedPaths(accountSubdomainEvidencePaths);
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)
    || path.resolve(repositoryRoot) !== repositoryRoot
    || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)
    || path.resolve(outputPath) !== outputPath
    || new Set([...Object.values(servicePaths), ...Object.values(subdomainPaths), outputPath]).size !== 7
    || [loadPolicy, loadSignedFiles, verifySigned, inspectGit, assertOutsideRepository,
      assertDestination, writeCandidate, readCandidate, now, randomUUIDImpl, randomBytesImpl]
      .some((value) => typeof value !== 'function')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_ARGUMENT');
  }
  await assertOutsideRepository(outputPath, repositoryRoot);
  await assertDestination(outputPath);
  const policy = await loadPolicy(repositoryRoot);
  const target = policy?.staging;
  if (target?.environment !== 'staging' || target?.bucket !== 'dwnc-me-public-media-staging'
    || !SHA256.test(target?.accountIdSha256 ?? '')
    || !SHA256.test(target?.releasePublicKeySpkiSha256 ?? '')) {
    fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_POLICY');
  }
  const observedAt = currentInstant(now);
  const [serviceFiles, subdomainFiles] = await Promise.all([
    loadSignedFiles(servicePaths), loadSignedFiles(subdomainPaths),
  ]);
  verifySigned({
    payload: serviceFiles.receipt,
    canonicalPayload: canonicalServiceExistenceEvidencePayload,
    validator: validateServiceExistenceEvidence,
    signature: serviceFiles.signature,
    publicKeyPem: serviceFiles.publicKeyPem,
    expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
    validation: {
      expected: {
        environment: 'staging', workerName: bootstrapWorkerName('staging'),
        accountIdSha256: target.accountIdSha256, exists: false,
      },
      now: observedAt,
    },
  });
  verifySigned({
    payload: subdomainFiles.receipt,
    canonicalPayload: canonicalAccountWorkersDevSubdomainEvidencePayload,
    validator: validateAccountWorkersDevSubdomainEvidence,
    signature: subdomainFiles.signature,
    publicKeyPem: subdomainFiles.publicKeyPem,
    expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
    validation: {
      expected: {
        environment: 'staging', workerName: bootstrapWorkerName('staging'),
        accountIdSha256: target.accountIdSha256,
        accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
      },
      now: observedAt,
    },
  });
  const firstGit = validateSnapshot(await inspectGit(repositoryRoot));
  const buildUuid = randomUUIDImpl();
  if (!UUID_V4.test(buildUuid ?? '')) fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_RANDOM');
  let nonce;
  let nonceSha256;
  try {
    nonce = randomBytesImpl(32);
    if (!Buffer.isBuffer(nonce) || nonce.length !== 32) {
      fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_RANDOM');
    }
    nonceSha256 = sha256Hex(nonce);
  } finally { nonce?.fill?.(0); }
  const candidate = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-bootstrap-authorization-v1',
    environment: 'staging',
    workerName: bootstrapWorkerName('staging'),
    accountIdSha256: target.accountIdSha256,
    expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    sourceGitSha: firstGit.commit,
    denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256('staging'),
    serviceEvidenceSha256: sha256Hex(
      canonicalServiceExistenceEvidencePayload(serviceFiles.receipt),
    ),
    accountSubdomainEvidenceSha256: sha256Hex(
      canonicalAccountWorkersDevSubdomainEvidencePayload(subdomainFiles.receipt),
    ),
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
    buildUuid,
    nonceSha256,
    createdAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + AUTHORIZATION_TTL_MS).toISOString(),
  };
  validateBootstrapAuthorization(candidate, { now: observedAt });
  const secondGit = validateSnapshot(await inspectGit(repositoryRoot));
  if (!sameSnapshot(firstGit, secondGit)) fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_GIT');
  await assertDestination(outputPath);
  await writeCandidate(outputPath, candidate, canonicalBootstrapAuthorizationPayload);
  let actual;
  let expected;
  let parsedCanonical;
  try {
    actual = await readCandidate(outputPath, 64 * 1024);
    expected = canonicalEvidenceStorageBytes(candidate, canonicalBootstrapAuthorizationPayload);
    if (!Buffer.isBuffer(actual) || !actual.equals(expected)) {
      fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_OUTPUT');
    }
    const parsed = parseCanonicalEvidenceStorage(actual);
    parsedCanonical = parsed.canonicalBytes;
    validateBootstrapAuthorization(parsed.payload, { now: observedAt });
  } finally {
    actual?.fill?.(0);
    expected?.fill?.(0);
    parsedCanonical?.fill?.(0);
  }
  const finalGit = validateSnapshot(await inspectGit(repositoryRoot));
  if (!sameSnapshot(firstGit, finalGit)) fail('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_GIT');
  return Object.freeze({
    contract: candidate.contract,
    environment: candidate.environment,
    workerName: candidate.workerName,
    sourceGitSha: candidate.sourceGitSha,
    authorizationSha256: sha256Hex(canonicalBootstrapAuthorizationPayload(candidate)),
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    candidateWritten: true,
    signed: false,
    rawAccountPrinted: false,
    rawTokenPrinted: false,
  });
}
