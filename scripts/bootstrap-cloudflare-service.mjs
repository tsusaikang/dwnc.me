import { execFile } from 'node:child_process';
import { lstat, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  bootstrapArguments,
  bootstrapConfig,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  bootstrapWorkerName,
  canonicalBootstrapAuthorizationPayload,
  canonicalBootstrapAttestationPayload,
  canonicalServiceExistenceCapturePayload,
  canonicalServiceExistenceEvidencePayload,
  DENY_ALL_WORKER_SOURCE,
  fetchServiceExistenceCapture,
  parseBootstrapDeployNdjson,
  serviceExistenceRequestSha256,
  validateBootstrapAuthorization,
  validateBootstrapAttestation,
  validateServiceExistenceCapture,
  validateServiceExistenceEvidence,
} from './lib/cloudflare-bootstrap.mjs';
import { canonicalJson, loadSignedJsonFiles, sha256Hex, verifySignedPayload } from './lib/cloudflare-release.mjs';
import {
  assertCloudflareAccountTarget,
  assertPinnedWranglerInstalled,
  claimOneTimeAuthorization,
  cloudflareUploadEnvironment,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-deny-bootstrap');
const environment = process.argv.find((value) => value.startsWith('--environment='))?.split('=')[1];
if (!['production', 'staging'].includes(environment)) throw new Error('CLOUDFLARE_E_BOOTSTRAP_ENVIRONMENT');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_BOOTSTRAP_PATH');
  return value;
};
if (process.env.CLOUDFLARE_DENY_BOOTSTRAP_APPROVED !== `${environment}:${bootstrapWorkerName(environment)}:external-surface-0`) {
  throw new Error('CLOUDFLARE_E_BOOTSTRAP_APPROVAL');
}
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
const [policy, evidenceFiles, authorizationFiles] = await Promise.all([
  loadTrackedPublicMediaReleasePolicy(ROOT),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_SERVICE_EXISTENCE')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_BOOTSTRAP_AUTHORIZATION')),
]);
const target = policy[environment];
assertCloudflareAccountTarget(process.env.CLOUDFLARE_ACCOUNT_ID, target.accountIdSha256);
await assertPinnedWranglerInstalled(ROOT);
const outputPath = absolute(process.env.CLOUDFLARE_BOOTSTRAP_NDJSON_PATH);
const candidatePath = absolute(process.env.CLOUDFLARE_BOOTSTRAP_ATTESTATION_CANDIDATE_PATH);
const freshCapturePath = absolute(process.env.CLOUDFLARE_BOOTSTRAP_FRESH_ABSENCE_CAPTURE_PATH);
for (const file of [outputPath, candidatePath, freshCapturePath]) {
  const parent = await lstat(path.dirname(file));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_OUTPUT');
  }
  if (await lstat(file).catch(() => null)) throw new Error('CLOUDFLARE_E_BOOTSTRAP_OUTPUT');
}
verifySignedPayload({
  payload: evidenceFiles.receipt,
  canonicalPayload: canonicalServiceExistenceEvidencePayload,
  validator: validateServiceExistenceEvidence,
  signature: evidenceFiles.signature,
  publicKeyPem: evidenceFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: { expected: { environment, workerName: bootstrapWorkerName(environment), exists: false }, now: new Date() },
});
const evidenceSha256 = sha256Hex(canonicalServiceExistenceEvidencePayload(evidenceFiles.receipt));
verifySignedPayload({
  payload: authorizationFiles.receipt,
  canonicalPayload: canonicalBootstrapAuthorizationPayload,
  validator: validateBootstrapAuthorization,
  signature: authorizationFiles.signature,
  publicKeyPem: authorizationFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: target.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      environment, workerName: bootstrapWorkerName(environment), accountIdSha256: target.accountIdSha256,
      denyWorkerSha256: bootstrapDenyWorkerSha256(), bootstrapConfigSha256: bootstrapConfigSha256(environment),
      serviceEvidenceSha256: evidenceSha256,
      freshAbsenceRequired: true,
      freshAbsenceRequestSha256: serviceExistenceRequestSha256({
        environment, accountIdSha256: target.accountIdSha256,
      }),
      maxFreshAbsenceAgeSeconds: 15,
    }, now: new Date(),
  },
});
const authorizationSha256 = sha256Hex(canonicalBootstrapAuthorizationPayload(authorizationFiles.receipt));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-cloudflare-bootstrap-'));
try {
  await writeFile(path.join(temporary, 'deny-all-worker.js'), DENY_ALL_WORKER_SOURCE, { mode: 0o600 });
  await writeFile(path.join(temporary, 'wrangler-bootstrap.jsonc'),
    `${canonicalJson(bootstrapConfig(environment))}\n`, { mode: 0o600 });
  await writeFile(path.join(temporary, 'wrangler-empty.env'), '', { mode: 0o600 });
  const uploadEnvironment = cloudflareUploadEnvironment(process.env);
  const freshCapture = await fetchServiceExistenceCapture({
    environment,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: uploadEnvironment.CLOUDFLARE_API_TOKEN,
    ttlSeconds: 15,
  });
  validateServiceExistenceCapture(freshCapture, {
    expected: {
      environment, workerName: bootstrapWorkerName(environment),
      accountIdSha256: target.accountIdSha256, exists: false,
    },
    now: new Date(), maxAgeSeconds: authorizationFiles.receipt.maxFreshAbsenceAgeSeconds,
  });
  const freshCapturePayload = canonicalServiceExistenceCapturePayload(freshCapture);
  await writeFile(freshCapturePath, `${freshCapturePayload}\n`, { flag: 'wx', mode: 0o600 });
  await claimOneTimeAuthorization({
    directory: absolute(process.env.CLOUDFLARE_BOOTSTRAP_ATTEMPT_DIR), authorizationSha256,
    scope: `${environment}-bootstrap`, target: bootstrapWorkerName(environment),
  });
  const handle = await open(outputPath, 'wx', 0o600); await handle.close();
  const args = bootstrapArguments({ environment, directory: temporary, authorizationSha256 });
  await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), args, {
    cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024,
    env: cloudflareUploadEnvironment(process.env, {
      CI: '1', WRANGLER_OUTPUT_FILE_PATH: outputPath, WRANGLER_WRITE_LOGS: '0',
      WRANGLER_SEND_METRICS: 'false', WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
    }),
  });
  const event = parseBootstrapDeployNdjson(await readFile(outputPath, 'utf8'), {
    environment, expectedArguments: args,
  });
  const commonReadArguments = ['--config', path.join(temporary, 'wrangler-bootstrap.jsonc'),
    '--env-file', path.join(temporary, 'wrangler-empty.env')];
  let detail;
  let status;
  try {
    const [{ stdout: detailRaw }, { stdout: statusRaw }] = await Promise.all([
      promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), [
        'versions', 'view', event.version_id, '--json', ...commonReadArguments,
      ], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024,
        env: cloudflareUploadEnvironment(process.env, { CI: '1', WRANGLER_WRITE_LOGS: '0' }),
      }),
      promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), [
        'deployments', 'status', '--json', ...commonReadArguments,
      ], {
        cwd: ROOT, encoding: 'utf8', timeout: 60000, maxBuffer: 2 * 1024 * 1024,
        env: cloudflareUploadEnvironment(process.env, { CI: '1', WRANGLER_WRITE_LOGS: '0' }),
      }),
    ]);
    detail = { raw: detailRaw, value: JSON.parse(detailRaw) };
    status = { raw: statusRaw, value: JSON.parse(statusRaw) };
  } catch { throw new Error('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_FETCH'); }
  const expectedTag = `dwnc-bootstrap-${authorizationSha256.slice(0, 24)}`;
  const expectedMessage = `dwnc-deny-bootstrap:${authorizationSha256}`;
  if (detail.value?.id !== event.version_id
    || !detail.value.resources?.script?.handlers?.includes('fetch')
    || detail.value.resources?.bindings?.length !== 0
    || ![undefined, null].includes(detail.value.resources?.assets)
    || detail.value.annotations?.['workers/tag'] !== expectedTag
    || detail.value.annotations?.['workers/message'] !== expectedMessage
    || !Array.isArray(status.value?.versions) || status.value.versions.length !== 1
    || status.value.versions[0]?.version_id !== event.version_id
    || status.value.versions[0]?.percentage !== 100) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_ATTESTATION');
  }
  const attestation = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-deny-bootstrap-attestation-v1',
    environment,
    workerName: bootstrapWorkerName(environment),
    accountIdSha256: target.accountIdSha256,
    sourceGitSha: authorizationFiles.receipt.sourceGitSha,
    versionId: event.version_id,
    denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256(environment),
    serviceEvidenceSha256: evidenceSha256,
    freshAbsenceCaptureSha256: sha256Hex(freshCapturePayload),
    deploymentOutputSha256: sha256Hex(await readFile(outputPath)),
    versionDetailSha256: sha256Hex(detail.raw),
    deploymentStatusSha256: sha256Hex(status.raw),
    denyScriptVerified: true,
    bindingsEmpty: true,
    assetsAbsent: true,
    externalSurfaceCount: 0,
    deployment100: true,
    attestedAt: new Date().toISOString(),
  };
  validateBootstrapAttestation(attestation);
  await writeFile(candidatePath,
    `${canonicalBootstrapAttestationPayload(attestation)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({
    contract: 'dwnc-cloudflare-deny-bootstrap-result-v1', environment,
    workerName: event.worker_name, versionId: event.version_id,
    externalSurfaceCount: 0, attestationRequired: true, candidateWritten: true,
  }));
} finally { await rm(temporary, { recursive: true, force: true }); }
