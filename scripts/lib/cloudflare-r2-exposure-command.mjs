import path from 'node:path';
import {
  canonicalR2ExposureCapturePayload,
  canonicalR2ExposureEvidencePayload,
  fetchR2ExposureCapture,
  inspectR2ExposureGit,
  R2_EXPOSURE_TARGETS,
  STAGING_R2_EXPOSURE_BUCKET,
  STAGING_R2_EXPOSURE_PURPOSE,
  validateR2ExposureCapture,
  validateR2ExposureGitSnapshot,
} from './cloudflare-r2-exposure.mjs';
import {
  assertCloudflareAccountTarget,
  cloudflareControlPlaneReadCredentials,
} from './cloudflare-process.mjs';
import {
  assertSecureCreateOnlyDestination,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './public-media-manifest.mjs';

const GIT_OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RECOVERY_FORBIDDEN_CREDENTIAL_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
  'CLOUDFLARE_API_TOKEN_FD', 'R2_CREDENTIALS_FD', 'R2_CREDENTIAL_METADATA_PATH',
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
]);

export const STAGING_R2_EXPOSURE_RECOVERY_PURPOSE =
  'staging-r2-private-exposure-recover';

function fail(code) { throw new Error(code); }

function parseExposurePaths(environment, root) {
  if (!environment || typeof environment !== 'object'
    || typeof root !== 'string' || !path.isAbsolute(root)) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
  }
  const capturePath = environment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH;
  const evidencePath = environment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH;
  const expectedGitCommit = environment.CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT;
  const expectedGitTree = environment.CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE;
  const outputs = [capturePath, evidencePath];
  if (!outputs.every((value) => typeof value === 'string' && path.isAbsolute(value)
      && path.resolve(value) === value)
    || capturePath === evidencePath || path.dirname(capturePath) !== path.dirname(evidencePath)
    || !GIT_OID.test(expectedGitCommit ?? '') || !GIT_OID.test(expectedGitTree ?? '')) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
  }
  for (const output of outputs) {
    const relative = path.relative(root, output);
    if (relative === '' || relative === '..' || !relative.startsWith(`..${path.sep}`)) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
    }
  }
  return { capturePath, evidencePath, expectedGitCommit, expectedGitTree };
}

export function parseR2ExposureCommand({
  argv = process.argv.slice(2), environment = process.env, root = process.cwd(),
} = {}) {
  const purpose = Array.isArray(argv) && argv.length === 1
    && argv[0].startsWith('--purpose=') ? argv[0].slice('--purpose='.length) : null;
  const target = Object.values(R2_EXPOSURE_TARGETS).find(
    (candidate) => candidate.purpose === purpose,
  );
  if (!target || typeof root !== 'string' || !path.isAbsolute(root)) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
  }
  const paths = parseExposurePaths(environment, root);
  return {
    purpose: target.purpose,
    environment: target.environment,
    ...paths,
  };
}

export function parseStagingR2ExposureCommand(options = {}) {
  const parsed = parseR2ExposureCommand(options);
  if (parsed.environment !== 'staging') fail('CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
  return parsed;
}

export function parseStagingR2ExposureRecoveryCommand({
  argv = process.argv.slice(2), environment = process.env, root = process.cwd(),
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1
    || argv[0] !== `--purpose=${STAGING_R2_EXPOSURE_RECOVERY_PURPOSE}`
    || !environment || typeof environment !== 'object'
    || RECOVERY_FORBIDDEN_CREDENTIAL_NAMES.some((name) => Object.hasOwn(environment, name))) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_RECOVERY_ARGUMENT');
  }
  let paths;
  try { paths = parseExposurePaths(environment, root); }
  catch { fail('CLOUDFLARE_E_R2_EXPOSURE_RECOVERY_ARGUMENT'); }
  return {
    purpose: STAGING_R2_EXPOSURE_RECOVERY_PURPOSE,
    environment: 'staging',
    ...paths,
  };
}

export async function runR2ExposureCommand({
  argv = process.argv.slice(2),
  environment = process.env,
  root = process.cwd(),
  readCredentials = cloudflareControlPlaneReadCredentials,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  assertDestination = assertSecureCreateOnlyDestination,
  fetchCapture = fetchR2ExposureCapture,
  writeEvidence = writeCanonicalEvidenceCreateOnly,
} = {}) {
  const options = parseR2ExposureCommand({ argv, environment, root });
  await Promise.all([
    assertDestination(options.capturePath),
    assertDestination(options.evidencePath),
  ]);
  const policy = await loadPolicy(root);
  const configuredTarget = R2_EXPOSURE_TARGETS[options.environment];
  const target = policy?.[options.environment];
  if (!configuredTarget || !target || target.environment !== options.environment
    || target.bucket !== configuredTarget.bucket
    || typeof target.accountIdSha256 !== 'string') {
    fail('CLOUDFLARE_E_R2_EXPOSURE_TARGET');
  }
  const credentials = readCredentials(environment);
  assertCloudflareAccountTarget(credentials.accountId, target.accountIdSha256);
  const capture = await fetchCapture({
    purpose: options.purpose,
    environment: options.environment,
    bucket: target.bucket,
    accountId: credentials.accountId,
    expectedAccountIdSha256: target.accountIdSha256,
    apiToken: credentials.apiToken,
    expectedGitCommit: options.expectedGitCommit,
    expectedGitTree: options.expectedGitTree,
    root,
  });
  await writeEvidence(
    options.capturePath, capture, canonicalR2ExposureCapturePayload,
  );
  await writeEvidence(
    options.evidencePath, capture.evidence, canonicalR2ExposureEvidencePayload,
  );
  return {
    contract: capture.evidence.contract,
    purpose: capture.evidence.purpose,
    environment: capture.evidence.environment,
    bucket: capture.evidence.bucket,
    accountIdSha256: capture.evidence.accountIdSha256,
    sourceCommit: capture.evidence.sourceCommit,
    sourceTree: capture.evidence.sourceTree,
    gitCheckCount: capture.evidence.gitCheckCount,
    jurisdiction: capture.evidence.jurisdiction,
    location: capture.evidence.location,
    storageClass: capture.evidence.storageClass,
    r2DevEnabled: capture.evidence.r2DevEnabled,
    customDomainCount: capture.evidence.customDomainCount,
    requestAudit: capture.evidence.requestAudit,
    responseSha256: {
      bucketProperties: capture.evidence.bucketPropertiesSha256,
      managedDomain: capture.evidence.managedDomainSha256,
      customDomains: capture.evidence.customDomainsSha256,
    },
    captureWritten: true,
    receiptWritten: true,
    signed: false,
  };
}

export function runStagingR2ExposureCommand(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  parseStagingR2ExposureCommand({
    argv,
    environment: options.environment ?? process.env,
    root: options.root ?? process.cwd(),
  });
  return runR2ExposureCommand({ ...options, argv });
}

export async function runStagingR2ExposureRecoveryCommand({
  argv = process.argv.slice(2),
  environment = process.env,
  root = process.cwd(),
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  assertDestination = assertSecureCreateOnlyDestination,
  readCapture = readSecureFile,
  inspectGit = inspectR2ExposureGit,
  writeEvidence = writeCanonicalEvidenceCreateOnly,
  now = () => new Date(),
} = {}) {
  const options = parseStagingR2ExposureRecoveryCommand({ argv, environment, root });
  await assertDestination(options.evidencePath);
  const policy = await loadPolicy(root);
  const target = policy?.staging;
  if (!target || target.environment !== 'staging'
    || target.bucket !== STAGING_R2_EXPOSURE_BUCKET
    || !SHA256.test(target.accountIdSha256 ?? '')) {
    fail('CLOUDFLARE_E_R2_EXPOSURE_TARGET');
  }
  let stored;
  let canonicalBytes;
  try {
    stored = await readCapture(options.capturePath);
    const parsed = parseCanonicalEvidenceStorage(stored);
    canonicalBytes = parsed.canonicalBytes;
    const capture = parsed.payload;
    const observedNow = now();
    if (!(observedNow instanceof Date) || Number.isNaN(observedNow.getTime())) {
      fail('CLOUDFLARE_E_R2_EXPOSURE_RECOVERY_CAPTURE');
    }
    validateR2ExposureCapture(capture, {
      expected: {
        purpose: STAGING_R2_EXPOSURE_PURPOSE,
        environment: 'staging',
        bucket: STAGING_R2_EXPOSURE_BUCKET,
        accountIdSha256: target.accountIdSha256,
        sourceCommit: options.expectedGitCommit,
        sourceTree: options.expectedGitTree,
      },
      now: observedNow,
      requirePrivate: true,
    });
    validateR2ExposureGitSnapshot(
      await inspectGit(root), options.expectedGitCommit, options.expectedGitTree,
    );
    await writeEvidence(
      options.evidencePath, capture.evidence, canonicalR2ExposureEvidencePayload,
    );
    return {
      contract: capture.evidence.contract,
      purpose: STAGING_R2_EXPOSURE_RECOVERY_PURPOSE,
      environment: capture.evidence.environment,
      bucket: capture.evidence.bucket,
      accountIdSha256: capture.evidence.accountIdSha256,
      sourceCommit: capture.evidence.sourceCommit,
      sourceTree: capture.evidence.sourceTree,
      jurisdiction: capture.evidence.jurisdiction,
      location: capture.evidence.location,
      storageClass: capture.evidence.storageClass,
      r2DevEnabled: capture.evidence.r2DevEnabled,
      customDomainCount: capture.evidence.customDomainCount,
      requestAudit: capture.evidence.requestAudit,
      responseSha256: {
        bucketProperties: capture.evidence.bucketPropertiesSha256,
        managedDomain: capture.evidence.managedDomainSha256,
        customDomains: capture.evidence.customDomainsSha256,
      },
      captureReused: true,
      receiptWritten: true,
      credentialReads: 0,
      apiRequests: 0,
      recovered: true,
      signed: false,
    };
  } finally {
    stored?.fill(0);
    canonicalBytes?.fill(0);
  }
}
