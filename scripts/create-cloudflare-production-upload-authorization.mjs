import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCloudflareAccountTargetOutsideRepository }
  from './lib/cloudflare-account-target.mjs';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { inspectPublicMediaGit } from './lib/public-media-git.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';
import {
  canonicalJson,
  canonicalUploadAuthorizationPayload,
  sha256Hex,
  validateUploadAuthorization,
} from './lib/cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const GIT_OID = /^[a-f0-9]{40}$/u;
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

const fail = (code) => { throw new Error(code); };

function validateGitSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || Object.keys(snapshot).length !== 3
    || !['commit', 'tree', 'clean'].every((key) => Object.hasOwn(snapshot, key))
    || !GIT_OID.test(snapshot.commit ?? '') || !GIT_OID.test(snapshot.tree ?? '')
    || snapshot.clean !== true) fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_GIT');
  return snapshot;
}

function currentInstant(now) {
  const value = typeof now === 'function' ? now() : null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_TIME');
  }
  return value;
}

export async function createCloudflareProductionUploadAuthorization({
  repositoryRoot = process.cwd(),
  artifactDirectory,
  buildUuid,
  outputPath,
  validateArtifact = validateArtifactDirectory,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  inspectGit = inspectPublicMediaGit,
  assertOutsideRepository = assertCloudflareAccountTargetOutsideRepository,
  assertDestination = assertSecureCreateOnlyDestination,
  writeCandidate = writeCanonicalEvidenceCreateOnly,
  now = () => new Date(),
  randomBytesImpl = randomBytes,
} = {}) {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)
    || path.resolve(repositoryRoot) !== repositoryRoot
    || typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)
    || path.resolve(artifactDirectory) !== artifactDirectory
    || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)
    || path.resolve(outputPath) !== outputPath || !UUID.test(buildUuid ?? '')
    || [validateArtifact, loadPolicy, inspectGit, assertOutsideRepository, assertDestination,
      writeCandidate, now, randomBytesImpl].some((value) => typeof value !== 'function')) {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_ARGUMENT');
  }
  await assertOutsideRepository(outputPath, repositoryRoot);
  await assertDestination(outputPath);
  const artifactResult = await validateArtifact(artifactDirectory);
  const artifact = artifactResult?.receipt;
  const artifactSha256 = artifactResult?.artifactSha256;
  const policy = await loadPolicy(repositoryRoot, { requireComplete: true });
  if (artifact?.environment !== 'production' || artifact?.workerName !== 'dwnc-me'
    || !/^[a-f0-9]{64}$/u.test(artifactSha256 ?? '')
    || !/^[a-f0-9]{64}$/u.test(artifact.accountIdSha256 ?? '')
    || policy?.production?.environment !== 'production'
    || policy.production.accountIdSha256 !== artifact.accountIdSha256
    || !/^[a-f0-9]{64}$/u.test(policy.production.releasePublicKeySpkiSha256 ?? '')) {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_ARTIFACT');
  }
  const firstGit = validateGitSnapshot(await inspectGit(repositoryRoot));
  if (firstGit.commit !== artifact.sourceGitSha) {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_GIT');
  }
  const observedAt = currentInstant(now);
  let nonce;
  let nonceSha256;
  try {
    nonce = randomBytesImpl(32);
    if (!Buffer.isBuffer(nonce) || nonce.length !== 32) {
      fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_RANDOM');
    }
    nonceSha256 = sha256Hex(nonce);
  } finally { nonce?.fill?.(0); }
  const candidate = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-upload-authorization-v1',
    environment: 'production',
    artifactSha256,
    accountIdSha256: artifact.accountIdSha256,
    workerName: artifact.workerName,
    sourceGitSha: artifact.sourceGitSha,
    buildUuid,
    nonceSha256,
    createdAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + AUTHORIZATION_TTL_MS).toISOString(),
  };
  validateUploadAuthorization(candidate, {
    expected: {
      environment: 'production', artifactSha256,
      accountIdSha256: artifact.accountIdSha256, workerName: artifact.workerName,
      sourceGitSha: artifact.sourceGitSha, buildUuid,
    },
    now: observedAt,
    maxLifetimeSeconds: 15 * 60,
  });
  const secondGit = validateGitSnapshot(await inspectGit(repositoryRoot));
  if (canonicalJson(firstGit) !== canonicalJson(secondGit)) {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_GIT');
  }
  await assertDestination(outputPath);
  await writeCandidate(outputPath, candidate, canonicalUploadAuthorizationPayload);
  return Object.freeze({
    contract: candidate.contract,
    environment: candidate.environment,
    workerName: candidate.workerName,
    sourceGitSha: candidate.sourceGitSha,
    artifactSha256: candidate.artifactSha256,
    buildUuid: candidate.buildUuid,
    authorizationSha256: sha256Hex(canonicalUploadAuthorizationPayload(candidate)),
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    candidateWritten: true,
    signed: false,
    rawAccountPrinted: false,
    rawTokenPrinted: false,
  });
}

const OPTION_KEYS = Object.freeze(['artifact', 'build-uuid', 'output']);

export async function createCloudflareProductionUploadAuthorizationCommand({
  argv = process.argv.slice(2),
  root = process.cwd(),
  createAuthorization = createCloudflareProductionUploadAuthorization,
} = {}) {
  if (!Array.isArray(argv) || typeof root !== 'string' || !path.isAbsolute(root)
    || path.resolve(root) !== root || typeof createAuthorization !== 'function') {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_ARGUMENT');
  }
  const options = Object.create(null);
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match || !OPTION_KEYS.includes(match[1]) || Object.hasOwn(options, match[1])) {
      fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_ARGUMENT');
    }
    options[match[1]] = match[2];
  }
  if (Object.keys(options).length !== OPTION_KEYS.length
    || ![options.artifact, options.output].every((value) => typeof value === 'string'
      && path.isAbsolute(value) && path.resolve(value) === value)
    || !UUID.test(options['build-uuid'] ?? '')) {
    fail('CLOUDFLARE_E_UPLOAD_AUTHORIZATION_CREATE_ARGUMENT');
  }
  return createAuthorization({
    repositoryRoot: root,
    artifactDirectory: options.artifact,
    buildUuid: options['build-uuid'],
    outputPath: options.output,
  });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-production-upload-auth');
  console.log(JSON.stringify(await createCloudflareProductionUploadAuthorizationCommand(), null, 2));
}
