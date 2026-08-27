import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createPreuploadArtifact } from './lib/cloudflare-artifact.mjs';
import {
  accountWorkersDevSubdomainRequestSha256,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
  canonicalBootstrapAuthorizationPayload,
  canonicalServiceExistenceEvidencePayload,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  serviceExistenceRequestSha256,
} from './lib/cloudflare-bootstrap.mjs';
import {
  canonicalDeploymentStatusEvidencePayload,
  canonicalJson,
  canonicalPromotionAuthorizationPayload,
  canonicalPromotionPlanPayload,
  canonicalStagingSecretAuthorizationPayload,
  canonicalStagingActivationAuthorizationPayload,
  canonicalUploadAuthorizationPayload,
  canonicalVersionAttestationPayload,
  createDeploymentStatusEvidence,
  createPromotionGenesisState,
  createPromotionPlan,
  preuploadArtifactSha256,
  productionPromotionArguments,
  sha256Hex,
  stagingActivationArguments,
  stagingVersionUploadArguments,
} from './lib/cloudflare-release.mjs';
import {
  createSignedPromotionHead,
  initializePromotionStore,
  loadPromotionHead,
  promotionStoreStatus,
} from './lib/cloudflare-promotion-store.mjs';
import {
  stagingActivationRecoveryStatus,
} from './lib/cloudflare-staging-activation-store.mjs';
import {
  canonicalRemoteReceiptPayload,
  cloudflareAccountIdSha256,
  publicMediaFullGetObjectSetSha256,
  publicKeySpkiSha256,
} from './lib/public-media-manifest.mjs';
import { writeAnonymousInheritedInput } from './lib/cloudflare-process.mjs';

const exec = promisify(execFile);
const executor = path.resolve('scripts/execute-cloudflare-production-promotion.mjs');
const stagingExecutor = path.resolve('scripts/activate-cloudflare-staging-version.mjs');
const stagingUploadExecutor = path.resolve('scripts/upload-cloudflare-staging-version.mjs');
const bootstrapExecutor = path.resolve('scripts/bootstrap-cloudflare-service.mjs');
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dwnc-promotion-executor-')));
const accountId = 'a'.repeat(32);
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const bootstrapVersionId = '12345678-1234-4123-8123-123456789abc';
const targetVersionId = '22345678-1234-4123-8123-123456789abc';
const deploymentId = '32345678-1234-4123-8123-123456789abc';
let assertions = 0;

async function execWithAnonymousToken(command, args, { cwd, env, token, maxBuffer }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, CLOUDFLARE_API_TOKEN_FD: '3' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  const output = [];
  const errors = [];
  let outputBytes = 0;
  let errorBytes = 0;
  child.stdout.on('data', (chunk) => { outputBytes += chunk.length; if (outputBytes <= maxBuffer) output.push(chunk); });
  child.stderr.on('data', (chunk) => { errorBytes += chunk.length; if (errorBytes <= maxBuffer) errors.push(chunk); });
  const [, code] = await Promise.all([
    writeAnonymousInheritedInput(child.stdio[3], token, { descriptor: 3, maximumBytes: 4096 }),
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
  ]);
  const stdout = Buffer.concat(output).toString('utf8');
  const stderr = Buffer.concat(errors).toString('utf8');
  if (code !== 0 || outputBytes > maxBuffer || errorBytes > maxBuffer) {
    const error = new Error('synthetic child failed');
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }
  return { stdout, stderr };
}

const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const unlock = async (directory) => {
  await chmod(directory, 0o700).catch(() => undefined);
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await unlock(target);
    else await chmod(target, 0o600).catch(() => undefined);
  }
};
const writeSigned = async (directory, name, payload, canonicalPayload, privateKey, publicKeyPem) => {
  const receiptPath = path.join(directory, `${name}.json`);
  const signaturePath = path.join(directory, `${name}.sig`);
  const publicKeyPath = path.join(directory, `${name}.pem`);
  const signature = sign(null, Buffer.from(canonicalPayload(payload)), privateKey);
  await writeFile(receiptPath, `${canonicalPayload(payload)}\n`, { mode: 0o600 });
  await writeFile(signaturePath, `${signature.toString('base64')}\n`, { mode: 0o600 });
  await writeFile(publicKeyPath, publicKeyPem, { mode: 0o600 });
  return { receiptPath, signaturePath, publicKeyPath };
};

async function makeFixture(name, mode) {
  const root = path.join(temporary, name);
  const bundle = path.join(root, 'bundle');
  const secrets = path.join(root, 'secrets');
  const state = path.join(root, 'promotion-state');
  const output = path.join(root, 'output');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await mkdir(path.join(root, 'public'), { recursive: true });
  await mkdir(path.join(root, 'src/data'), { recursive: true });
  await mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
  await mkdir(path.join(root, 'node_modules/wrangler'), { recursive: true });
  for (const directory of [bundle, secrets, state, output]) await mkdir(directory, { mode: 0o700 });

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = publicKeySpkiSha256(publicKeyPem);
  const privateKeyPath = path.join(secrets, 'release-private.pem');
  const publicKeyPath = path.join(secrets, 'release-public.pem');
  await writeFile(privateKeyPath, privateKeyPem, { mode: 0o600 });
  await writeFile(publicKeyPath, publicKeyPem, { mode: 0o600 });

  const policyTarget = (environment) => ({
    environment,
    wranglerEnvironment: environment,
    binding: 'MEDIA_BUCKET',
    bucket: `dwnc-me-public-media-${environment}`,
    accountIdSha256,
    publicKeySpkiSha256: fingerprint,
    releasePublicKeySpkiSha256: fingerprint,
    smokeOrigin: environment === 'staging' ? 'https://dwnc-me-staging.dwnc.workers.dev' : null,
    smokeAccessPolicySha256: environment === 'staging' ? sha256Hex('staging-policy') : null,
    requiredVerificationLevel: 'full-get-sha256',
    requiredBucketExposure: 'cloudflare-control-plane-private',
    maxBucketExposureAgeSeconds: 900,
    maxBucketExposureFutureSkewSeconds: 120,
    approvedOrphanCount: 0,
  });
  await writeFile(path.join(root, 'src/data/public-media-release-policy-v1.json'), `${JSON.stringify({
    schemaVersion: 1,
    contract: 'dwnc-public-media-release-policy-v1',
    staging: policyTarget('staging'),
    production: policyTarget('production'),
  })}\n`);
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    private: true, type: 'module', config: { wranglerVersion: '4.125.0' },
  })}\n`);
  await writeFile(path.join(root, 'node_modules/wrangler/package.json'), `${JSON.stringify({
    name: 'wrangler', version: '4.125.0',
  })}\n`);
  const fakeWrangler = `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const file = '.fake-wrangler-state.json';
const state = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
if (args[0] === 'deployments' && args[1] === 'status') {
  state.deploymentStatusCalls = (state.deploymentStatusCalls ?? 0) + 1;
  writeFileSync(file, JSON.stringify(state));
  process.stdout.write(JSON.stringify({ id: state.deploymentId, versions: [{ version_id: state.currentVersionId, percentage: 100 }] }));
  process.exit(0);
}
if (args[0] === 'deploy') {
  const configPath = args[args.indexOf('--config') + 1];
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const versionId = state.targetVersionId;
  const tag = args[args.indexOf('--tag') + 1];
  const message = args[args.indexOf('--message') + 1];
  state.currentVersionId = versionId;
  state.bootstrap = { tag, message, workerName: config.name };
  writeFileSync(file, JSON.stringify(state));
  if (process.env.WRANGLER_OUTPUT_FILE_PATH) {
    appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({
      type: 'wrangler-session', version: 1, wrangler_version: '4.125.0',
      command_line_args: args, log_file_path: null, timestamp: new Date().toISOString(),
    }) + '\\n');
    appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({
      type: 'deploy', version: 1, worker_name: config.name, worker_tag: null,
      version_id: versionId, targets: [], worker_name_overridden: false,
      timestamp: new Date().toISOString(),
    }) + '\\n');
  }
  process.exit(0);
}
if (args[0] === 'versions' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({
    id: args[2], annotations: {
      'workers/tag': state.bootstrap?.tag, 'workers/message': state.bootstrap?.message,
    }, resources: { script: { handlers: ['fetch'] }, bindings: [], assets: null },
  }));
  process.exit(0);
}
if (args[0] === 'versions' && args[1] === 'upload') {
  const secretPath = args[args.indexOf('--secrets-file') + 1];
  const secretRaw = readFileSync(secretPath);
  const secretPayload = JSON.parse(secretRaw.toString('utf8'));
  state.stagingSecretSha256 = createHash('sha256').update(secretPayload.DWNC_STAGING_SMOKE_TOKEN).digest('hex');
  state.stagingSecretPath = secretPath;
  writeFileSync(file, JSON.stringify(state));
  appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({
    type: 'wrangler-session', version: 1, wrangler_version: '4.125.0',
    command_line_args: args, log_file_path: null, timestamp: new Date().toISOString(),
  }) + '\\n');
  appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({
    type: 'version-upload', version: 1, worker_name: 'dwnc-me-staging', worker_tag: null,
    version_id: state.targetVersionId, wrangler_environment: 'staging',
    worker_name_overridden: false, timestamp: new Date().toISOString(),
  }) + '\\n');
  process.exit(0);
}
if (args[0] === 'versions' && args[1] === 'deploy') {
  if (process.env.WRANGLER_OUTPUT_FILE_PATH) appendFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, JSON.stringify({ type: 'wrangler-session', version: 1 }) + '\\n');
  state.versionsDeployCalls = (state.versionsDeployCalls ?? 0) + 1;
  if (state.mode === 'commit') {
    state.currentVersionId = state.targetVersionId;
    writeFileSync(file, JSON.stringify(state));
    process.exit(0);
  }
  writeFileSync(file, JSON.stringify(state));
  process.exit(23);
}
process.exit(24);
`;
  const fakeWranglerPath = path.join(root, 'node_modules/.bin/wrangler');
  await writeFile(fakeWranglerPath, fakeWrangler, { mode: 0o700 });
  await writeFile(path.join(root, '.fake-wrangler-state.json'), `${JSON.stringify({
    mode, deploymentId, currentVersionId: bootstrapVersionId, targetVersionId,
  })}\n`);
  await writeFile(path.join(root, 'dist/index.html'), '<h1>fixture a</h1>');
  await writeFile(path.join(root, 'dist/_redirects'), '/old / 308\n');
  await writeFile(path.join(root, 'public/_redirects'), '/old / 308\n');
  await writeFile(path.join(bundle, 'worker.js'), 'export default { async fetch() { return new Response("ok"); } };');

  await exec('git', ['init', '-b', 'main'], { cwd: root });
  await exec('git', ['add', '.'], { cwd: root });
  await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'fixture baseline'], { cwd: root });
  const { stdout: firstShaRaw } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
  const firstSha = firstShaRaw.trim();
  await writeFile(path.join(root, 'dist/index.html'), '<h1>fixture b</h1>');
  await exec('git', ['add', 'dist/index.html'], { cwd: root });
  await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'fixture candidate'], { cwd: root });
  const { stdout: sourceShaRaw } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
  const sourceGitSha = sourceShaRaw.trim();

  const mediaVerifiedAt = new Date().toISOString();
  const mediaStartedAt = new Date(Date.parse(mediaVerifiedAt) - 1_000).toISOString();
  const mediaReceipt = {
    schemaVersion: 1,
    contract: 'dwnc-public-media-r2-receipt-v1',
    manifestSha256: sha256Hex('empty-media-manifest'),
    objectCount: 0,
    totalBytes: 0,
    target: { environment: 'production', bucket: 'dwnc-me-public-media-production', accountIdSha256 },
    verificationLevel: 'full-get-sha256',
    bucketExposure: {
      verification: 'cloudflare-control-plane', jurisdiction: 'default', location: 'ENAM',
      storageClass: 'Standard', bucketPropertiesSha256: sha256Hex('bucket-properties'),
      r2DevEnabled: false, customDomainCount: 0,
      verifiedAt: mediaVerifiedAt, evidenceSha256: sha256Hex('private-bucket'),
    },
    verifiedAt: mediaVerifiedAt,
    audit: {
      headObjects: 0,
      fullGetObjects: 0,
      fullGetBytes: 0,
      fullGetContract: 'all-manifest-objects-streamed-sha256-v1',
      fullObjectSetSha256: publicMediaFullGetObjectSetSha256([]),
      orphanCount: 0,
      requestCounts: { LIST: 1, HEAD: 0, GET: 0, PUT: 0, DELETE: 0 },
      sourceCommit: sourceGitSha,
      sourceTree: '2'.repeat(40),
      gitCheckCount: 3,
      startedAt: mediaStartedAt,
      exposureCaptureSha256: 'f'.repeat(64),
    },
    objects: [],
  };
  const mediaSignaturePath = path.join(secrets, 'media.sig');
  await writeFile(mediaSignaturePath, `${sign(null,
    Buffer.from(canonicalRemoteReceiptPayload(mediaReceipt)), privateKey).toString('base64')}\n`, { mode: 0o600 });
  const artifactResult = await createPreuploadArtifact({
    sourceRoot: root,
    artifactRoot: path.join(root, 'artifacts'),
    bundleDirectory: bundle,
    sourceGitSha,
    ciSourceGitSha: sourceGitSha,
    accountIdSha256,
    stagingAccountIdSha256: accountIdSha256,
    bucket: 'dwnc-me-public-media-production',
    stagingBucket: 'dwnc-me-public-media-staging',
    mediaManifest: { manifestSha256: mediaReceipt.manifestSha256 },
    mediaRemoteReceipt: mediaReceipt,
    mediaReceiptFiles: { signaturePath: mediaSignaturePath, publicKeyPath },
  });
  const artifact = artifactResult.receipt;
  const artifactSha256 = preuploadArtifactSha256(artifact);
  const buildUuid = '42345678-1234-4123-8123-123456789abc';
  const versionAttestation = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-version-attestation-v1',
    environment: 'production',
    artifactSha256,
    payloadSha256: artifact.payloadSha256,
    versionId: targetVersionId,
    scriptEtag: 'fixture-etag',
    bindingsSha256: artifact.bindingsSha256,
    assetsConfigSha256: artifact.assetsConfigSha256,
    workerName: 'dwnc-me',
    accountIdSha256,
    sourceGitSha,
    buildUuid,
    rawVersionDetailSha256: sha256Hex('fixture-version-detail'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
  };
  const genesis = createPromotionGenesisState({ bootstrapVersionId, sourceGitSha: firstSha });
  const genesisHead = createSignedPromotionHead({ state: genesis, privateKeyPem, publicKeyPem });
  await initializePromotionStore({
    directory: state, head: genesisHead, publicKeyPem, expectedFingerprint: fingerprint,
  });
  const loaded = await loadPromotionHead({ directory: state, publicKeyPem, expectedFingerprint: fingerprint });
  const plan = createPromotionPlan({
    previous: genesis,
    artifact,
    attestation: versionAttestation,
    mediaManifest: { manifestSha256: artifact.mediaManifestSha256 },
    publicPaths: ['/', '/old'],
  });
  const planPath = path.join(secrets, 'promotion-plan.json');
  await writeFile(planPath, `${canonicalPromotionPlanPayload(plan)}\n`, { mode: 0o600 });
  const statusBefore = createDeploymentStatusEvidence({
    rawStatus: { id: deploymentId, versions: [{ version_id: bootstrapVersionId, percentage: 100 }] },
    targetVersionId: bootstrapVersionId,
    observedAt: new Date().toISOString(),
  });
  const statusPaths = await writeSigned(secrets, 'status-before', statusBefore,
    canonicalDeploymentStatusEvidencePayload, privateKey, publicKeyPem);
  const planSha256 = sha256Hex(canonicalPromotionPlanPayload(plan));
  const deploymentArguments = productionPromotionArguments({
    versionId: targetVersionId, artifactDirectory: artifactResult.directory, planSha256,
  });
  const promotionAuthorization = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-authorization-v1',
    environment: 'production',
    artifactSha256,
    versionId: targetVersionId,
    activePromotionSha256: loaded.stateSha256,
    promotionPlanSha256: planSha256,
    deploymentStatusBeforeSha256: sha256Hex(canonicalDeploymentStatusEvidencePayload(statusBefore)),
    deploymentArgumentsSha256: sha256Hex(canonicalJson(deploymentArguments)),
    buildUuid,
    nonceSha256: sha256Hex(`nonce-${name}`),
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  const authPaths = await writeSigned(secrets, 'promotion-auth', promotionAuthorization,
    canonicalPromotionAuthorizationPayload, privateKey, publicKeyPem);
  const childEnvironment = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR: artifactResult.directory,
    CLOUDFLARE_PROMOTION_STATE_DIR: state,
    CLOUDFLARE_PROMOTION_PLAN_PATH: planPath,
    CLOUDFLARE_PROMOTION_DEPLOY_NDJSON_PATH: path.join(output, 'deploy.ndjson'),
    CLOUDFLARE_ACTIVE_PROMOTION_PUBLIC_KEY_PATH: publicKeyPath,
    CLOUDFLARE_ACTIVE_PROMOTION_PRIVATE_KEY_PATH: privateKeyPath,
    CLOUDFLARE_PROMOTION_AUTHORIZATION_RECEIPT_PATH: authPaths.receiptPath,
    CLOUDFLARE_PROMOTION_AUTHORIZATION_SIGNATURE_PATH: authPaths.signaturePath,
    CLOUDFLARE_PROMOTION_AUTHORIZATION_PUBLIC_KEY_PATH: authPaths.publicKeyPath,
    CLOUDFLARE_DEPLOYMENT_STATUS_BEFORE_RECEIPT_PATH: statusPaths.receiptPath,
    CLOUDFLARE_DEPLOYMENT_STATUS_BEFORE_SIGNATURE_PATH: statusPaths.signaturePath,
    CLOUDFLARE_DEPLOYMENT_STATUS_BEFORE_PUBLIC_KEY_PATH: statusPaths.publicKeyPath,
  };
  await writeFile(path.join(root, '.git/info/exclude'), [
    'artifacts/', 'promotion-state/', 'output/', 'staging-attempts/', 'upload-attempts/',
    'secrets/*.json', 'secrets/*.sig', 'secrets/*.pem', '',
  ].join('\n'));
  return {
    root, state, output, childEnvironment, publicKeyPem, fingerprint,
    privateKey, secrets, plan, buildUuid, loaded, artifactResult,
  };
}

try {
  const stagingUpload = await makeFixture('staging-upload', 'commit');
  const stagingUploadArtifact = stagingUpload.artifactResult.receipt;
  const stagingUploadArtifactSha256 = preuploadArtifactSha256(stagingUploadArtifact);
  const stagingUploadBuildUuid = 'b2345678-1234-4123-8123-123456789abc';
  const stagingUploadAuthorization = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-upload-authorization-v1',
    environment: 'staging', artifactSha256: stagingUploadArtifactSha256,
    accountIdSha256, workerName: 'dwnc-me-staging',
    sourceGitSha: stagingUploadArtifact.sourceGitSha, buildUuid: stagingUploadBuildUuid,
    nonceSha256: sha256Hex('staging-upload-nonce'),
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
  };
  const stagingUploadAuthorizationPaths = await writeSigned(
    stagingUpload.secrets, 'staging-upload-auth', stagingUploadAuthorization,
    canonicalUploadAuthorizationPayload, stagingUpload.privateKey, stagingUpload.publicKeyPem);
  const protectedSecretDirectory = path.join(temporary, 'staging-upload-protected-secret');
  await mkdir(protectedSecretDirectory, { mode: 0o700 });
  const smokeSecretValue = 'A'.repeat(43);
  const smokeSecretsRaw = `${JSON.stringify({
    DWNC_STAGING_SMOKE_TOKEN: smokeSecretValue,
  })}\n`;
  const smokeSecretsPath = path.join(protectedSecretDirectory, 'secrets.json');
  await writeFile(smokeSecretsPath, smokeSecretsRaw, { mode: 0o600 });
  const stagingUploadArguments = stagingVersionUploadArguments({
    artifactDirectory: stagingUpload.artifactResult.directory,
    artifact: stagingUploadArtifact,
    secretsFile: '/dev/fd/3',
  });
  const stagingSecretAuthorization = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-staging-secret-authorization-v1',
    environment: 'staging', workerName: 'dwnc-me-staging', accountIdSha256,
    artifactSha256: stagingUploadArtifactSha256,
    sourceGitSha: stagingUploadArtifact.sourceGitSha,
    uploadAuthorizationSha256: sha256Hex(
      canonicalUploadAuthorizationPayload(stagingUploadAuthorization)),
    secretName: 'DWNC_STAGING_SMOKE_TOKEN',
    secretValueSha256: sha256Hex(smokeSecretValue), secretBytes: 43,
    secretsFileSha256: sha256Hex(smokeSecretsRaw),
    uploadArgumentsSha256: sha256Hex(canonicalJson(stagingUploadArguments)),
    buildUuid: stagingUploadBuildUuid, nonceSha256: sha256Hex('staging-secret-nonce'),
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
  };
  const stagingSecretAuthorizationPaths = await writeSigned(
    stagingUpload.secrets, 'staging-secret-auth', stagingSecretAuthorization,
    canonicalStagingSecretAuthorizationPayload, stagingUpload.privateKey, stagingUpload.publicKeyPem);
  const stagingUploadAttempts = path.join(stagingUpload.root, 'upload-attempts');
  await mkdir(stagingUploadAttempts, { mode: 0o700 });
  const stagingUploadResultPath = path.join(stagingUpload.output, 'staging-upload-result.json');
  const stagingSecretResultPath = path.join(stagingUpload.output, 'staging-secret-result.json');
  const stagingUploadRun = await exec(process.execPath, [stagingUploadExecutor], {
    cwd: stagingUpload.root,
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      WORKERS_CI_COMMIT_SHA: stagingUploadArtifact.ciSourceGitSha,
      WORKERS_CI_BUILD_UUID: stagingUploadBuildUuid,
      CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR: stagingUpload.artifactResult.directory,
      CLOUDFLARE_STAGING_VERSION_UPLOAD_NDJSON_PATH: path.join(
        stagingUpload.output, 'staging-upload.ndjson'),
      CLOUDFLARE_STAGING_VERSION_UPLOAD_RESULT_PATH: stagingUploadResultPath,
      CLOUDFLARE_STAGING_SECRET_BINDING_RESULT_PATH: stagingSecretResultPath,
      CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE: smokeSecretsPath,
      CLOUDFLARE_STAGING_UPLOAD_AUTHORIZATION_RECEIPT_PATH:
        stagingUploadAuthorizationPaths.receiptPath,
      CLOUDFLARE_STAGING_UPLOAD_AUTHORIZATION_SIGNATURE_PATH:
        stagingUploadAuthorizationPaths.signaturePath,
      CLOUDFLARE_STAGING_UPLOAD_AUTHORIZATION_PUBLIC_KEY_PATH:
        stagingUploadAuthorizationPaths.publicKeyPath,
      CLOUDFLARE_STAGING_SECRET_AUTHORIZATION_RECEIPT_PATH:
        stagingSecretAuthorizationPaths.receiptPath,
      CLOUDFLARE_STAGING_SECRET_AUTHORIZATION_SIGNATURE_PATH:
        stagingSecretAuthorizationPaths.signaturePath,
      CLOUDFLARE_STAGING_SECRET_AUTHORIZATION_PUBLIC_KEY_PATH:
        stagingSecretAuthorizationPaths.publicKeyPath,
      CLOUDFLARE_UPLOAD_ATTEMPT_DIR: stagingUploadAttempts,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  equal(JSON.parse(stagingUploadRun.stdout).trafficChanged, false);
  const stagingSecretResult = await readFile(stagingSecretResultPath, 'utf8');
  equal(stagingSecretResult.includes(smokeSecretValue), false);
  const stagingUploadState = JSON.parse(await readFile(
    path.join(stagingUpload.root, '.fake-wrangler-state.json'), 'utf8'));
  equal(stagingUploadState.stagingSecretSha256, sha256Hex(smokeSecretValue));
  equal(stagingUploadState.stagingSecretPath, '/dev/fd/3');

  const bootstrap = await makeFixture('bootstrap', 'commit');
  const bootstrapCreatedVersionId = '92345678-1234-4123-8123-123456789abc';
  const bootstrapObservedAt = new Date(Date.now() - 10_000).toISOString();
  const bootstrapRequestStartedAt = new Date(Date.parse(bootstrapObservedAt) - 1).toISOString();
  const bootstrapEvidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-service-existence-v1',
    environment: 'production',
    workerName: 'dwnc-me',
    accountIdSha256,
    exists: false,
    httpStatus: 404,
    rawEvidenceSha256: sha256Hex('service-absent'),
    requestStartedAt: bootstrapRequestStartedAt,
    requestCompletedAt: bootstrapObservedAt,
    observedAt: bootstrapObservedAt,
    expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
  };
  const bootstrapEvidencePaths = await writeSigned(bootstrap.secrets, 'bootstrap-existence',
    bootstrapEvidence, canonicalServiceExistenceEvidencePayload,
    bootstrap.privateKey, bootstrap.publicKeyPem);
  const bootstrapAccountSubdomainEvidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-account-workers-dev-subdomain-v1',
    environment: 'production',
    workerName: 'dwnc-me',
    accountIdSha256,
    accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    origin: 'https://dwnc-me.dwnc.workers.dev',
    rawEvidenceSha256: sha256Hex('account-subdomain-dwnc'),
    requestStartedAt: bootstrapRequestStartedAt,
    requestCompletedAt: bootstrapObservedAt,
    observedAt: bootstrapObservedAt,
    expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
  };
  const bootstrapAccountSubdomainPaths = await writeSigned(
    bootstrap.secrets, 'bootstrap-account-subdomain', bootstrapAccountSubdomainEvidence,
    canonicalAccountWorkersDevSubdomainEvidencePayload,
    bootstrap.privateKey, bootstrap.publicKeyPem);
  const bootstrapAuthorization = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-bootstrap-authorization-v1',
    environment: 'production',
    workerName: 'dwnc-me',
    accountIdSha256,
    expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    sourceGitSha: bootstrap.artifactResult.receipt.sourceGitSha,
    denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256('production'),
    serviceEvidenceSha256: sha256Hex(canonicalServiceExistenceEvidencePayload(bootstrapEvidence)),
    accountSubdomainEvidenceSha256: sha256Hex(
      canonicalAccountWorkersDevSubdomainEvidencePayload(bootstrapAccountSubdomainEvidence)),
    freshAbsenceRequired: true,
    freshAbsenceRequestSha256: serviceExistenceRequestSha256({
      environment: 'production', accountIdSha256,
    }),
    freshAccountSubdomainRequired: true,
    freshAccountSubdomainRequestSha256: accountWorkersDevSubdomainRequestSha256({
      environment: 'production', accountIdSha256,
    }),
    maxFreshAbsenceAgeSeconds: 15,
    maxFreshAccountSubdomainAgeSeconds: 15,
    buildUuid: 'a2345678-1234-4123-8123-123456789abc',
    nonceSha256: sha256Hex('bootstrap-executor-nonce'),
    createdAt: new Date(Date.now() - 10_000).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
  };
  const bootstrapAuthorizationPaths = await writeSigned(bootstrap.secrets, 'bootstrap-auth',
    bootstrapAuthorization, canonicalBootstrapAuthorizationPayload,
    bootstrap.privateKey, bootstrap.publicKeyPem);
  const bootstrapAttempts = path.join(bootstrap.root, 'bootstrap-attempts');
  await mkdir(bootstrapAttempts, { mode: 0o700 });
  await writeFile(path.join(bootstrap.root, '.fake-wrangler-state.json'), `${JSON.stringify({
    mode: 'commit', deploymentId, currentVersionId: bootstrapVersionId,
    targetVersionId: bootstrapCreatedVersionId,
  })}\n`);
  const mockFetchModule = path.join(bootstrap.root, 'mock-bootstrap-fetch.mjs');
  await writeFile(mockFetchModule,
    `globalThis.fetch = async () => { throw new Error('BOOTSTRAP_FETCH_MUST_NOT_RUN'); };\n`);
  const bootstrapToken = 'synthetic_bootstrap_token_1234567890';
  const blockedOutput = path.join(bootstrap.output, 'must-remain-absent.json');
  await assert.rejects(() => execWithAnonymousToken(
    process.execPath, [bootstrapExecutor, '--environment=production'], {
      cwd: bootstrap.root,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${mockFetchModule}`,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_DENY_BOOTSTRAP_APPROVED: 'production:dwnc-me:workers-dev-disabled',
        CLOUDFLARE_SERVICE_EXISTENCE_RECEIPT_PATH: bootstrapEvidencePaths.receiptPath,
        CLOUDFLARE_SERVICE_EXISTENCE_SIGNATURE_PATH: bootstrapEvidencePaths.signaturePath,
        CLOUDFLARE_SERVICE_EXISTENCE_PUBLIC_KEY_PATH: bootstrapEvidencePaths.publicKeyPath,
        CLOUDFLARE_ACCOUNT_SUBDOMAIN_RECEIPT_PATH: bootstrapAccountSubdomainPaths.receiptPath,
        CLOUDFLARE_ACCOUNT_SUBDOMAIN_SIGNATURE_PATH: bootstrapAccountSubdomainPaths.signaturePath,
        CLOUDFLARE_ACCOUNT_SUBDOMAIN_PUBLIC_KEY_PATH: bootstrapAccountSubdomainPaths.publicKeyPath,
        CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_RECEIPT_PATH: bootstrapAuthorizationPaths.receiptPath,
        CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_SIGNATURE_PATH: bootstrapAuthorizationPaths.signaturePath,
        CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_PUBLIC_KEY_PATH: bootstrapAuthorizationPaths.publicKeyPath,
        CLOUDFLARE_BOOTSTRAP_ATTEMPT_DIR: bootstrapAttempts,
        CLOUDFLARE_BOOTSTRAP_NDJSON_PATH: blockedOutput,
        CLOUDFLARE_BOOTSTRAP_ATTESTATION_CANDIDATE_PATH: blockedOutput,
        CLOUDFLARE_BOOTSTRAP_FRESH_ABSENCE_CAPTURE_PATH: blockedOutput,
        CLOUDFLARE_BOOTSTRAP_FRESH_ACCOUNT_SUBDOMAIN_CAPTURE_PATH: blockedOutput,
        CLOUDFLARE_BOOTSTRAP_POST_STATE_CAPTURE_PATH: blockedOutput,
      },
      token: bootstrapToken,
      maxBuffer: 2 * 1024 * 1024,
    },
  ), (error) => error?.stderr?.includes('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECOVERY_REQUIRED')
    && !error.stderr.includes(bootstrapToken)
    && !error.stderr.includes('BOOTSTRAP_FETCH_MUST_NOT_RUN'));
  assertions += 1;
  equal(await readdir(bootstrapAttempts), []);
  equal(await readFile(blockedOutput).then(() => true).catch(() => false), false);
  const blockedBootstrapState = JSON.parse(await readFile(
    path.join(bootstrap.root, '.fake-wrangler-state.json'), 'utf8'));
  equal(blockedBootstrapState.currentVersionId, bootstrapVersionId);
  equal(blockedBootstrapState.targetVersionId, bootstrapCreatedVersionId);
  const staging = await makeFixture('staging', 'commit');
  const stagingPreviousVersionId = '52345678-1234-4123-8123-123456789abc';
  const stagingVersionId = '62345678-1234-4123-8123-123456789abc';
  const stagingArtifact = staging.artifactResult.receipt;
  const stagingArtifactSha256 = preuploadArtifactSha256(stagingArtifact);
  const stagingVersionAttestation = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-version-attestation-v1',
    environment: 'staging',
    artifactSha256: stagingArtifactSha256,
    payloadSha256: stagingArtifact.payloadSha256,
    versionId: stagingVersionId,
    scriptEtag: 'staging-fixture-etag',
    bindingsSha256: stagingArtifact.stagingBindingsSha256,
    assetsConfigSha256: stagingArtifact.stagingAssetsConfigSha256,
    workerName: 'dwnc-me-staging',
    accountIdSha256: stagingArtifact.stagingAccountIdSha256,
    sourceGitSha: stagingArtifact.sourceGitSha,
    buildUuid: '72345678-1234-4123-8123-123456789abc',
    rawVersionDetailSha256: sha256Hex('staging-version-detail'),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  const stagingVersionPaths = await writeSigned(staging.secrets, 'staging-version',
    stagingVersionAttestation, canonicalVersionAttestationPayload,
    staging.privateKey, staging.publicKeyPem);
  const stagingStatusBefore = createDeploymentStatusEvidence({
    rawStatus: {
      id: deploymentId,
      versions: [{ version_id: stagingPreviousVersionId, percentage: 100 }],
    },
    targetVersionId: stagingPreviousVersionId,
    observedAt: new Date().toISOString(),
    environment: 'staging',
    workerName: 'dwnc-me-staging',
  });
  const stagingStatusPaths = await writeSigned(staging.secrets, 'staging-status-before',
    stagingStatusBefore, canonicalDeploymentStatusEvidencePayload,
    staging.privateKey, staging.publicKeyPem);
  const stagingArguments = stagingActivationArguments({
    versionId: stagingVersionId,
    artifactDirectory: staging.artifactResult.directory,
    artifactSha256: stagingArtifactSha256,
  });
  const stagingAuthorization = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-staging-activation-authorization-v1',
    environment: 'staging',
    artifactSha256: stagingArtifactSha256,
    payloadSha256: stagingArtifact.payloadSha256,
    versionId: stagingVersionId,
    accountIdSha256: accountIdSha256,
    workerName: 'dwnc-me-staging',
    originSha256: sha256Hex('https://dwnc-me-staging.dwnc.workers.dev'),
    accessPolicySha256: sha256Hex('staging-policy'),
    deploymentStatusBeforeSha256: sha256Hex(
      canonicalDeploymentStatusEvidencePayload(stagingStatusBefore)),
    deploymentArgumentsSha256: sha256Hex(canonicalJson(stagingArguments)),
    buildUuid: stagingVersionAttestation.buildUuid,
    nonceSha256: sha256Hex('staging-executor-nonce'),
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
  };
  const stagingAuthorizationPaths = await writeSigned(staging.secrets, 'staging-activation-auth',
    stagingAuthorization, canonicalStagingActivationAuthorizationPayload,
    staging.privateKey, staging.publicKeyPem);
  const stagingAttempts = path.join(staging.root, 'staging-attempts');
  await mkdir(stagingAttempts, { mode: 0o700 });
  await writeFile(path.join(staging.root, '.fake-wrangler-state.json'), `${JSON.stringify({
    mode: 'commit', deploymentId, currentVersionId: stagingPreviousVersionId,
    targetVersionId: stagingVersionId,
  })}\n`);
  const stagingCandidate = path.join(staging.output, 'staging-status-candidate.json');
  const stagingEnvironment = {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_STAGING_ACTIVATION_APPROVED: 'staging:dwnc-me-staging:exact-version-100',
      CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR: staging.artifactResult.directory,
      CLOUDFLARE_STAGING_VERSION_ATTESTATION_RECEIPT_PATH: stagingVersionPaths.receiptPath,
      CLOUDFLARE_STAGING_VERSION_ATTESTATION_SIGNATURE_PATH: stagingVersionPaths.signaturePath,
      CLOUDFLARE_STAGING_VERSION_ATTESTATION_PUBLIC_KEY_PATH: stagingVersionPaths.publicKeyPath,
      CLOUDFLARE_STAGING_ACTIVATION_AUTHORIZATION_RECEIPT_PATH: stagingAuthorizationPaths.receiptPath,
      CLOUDFLARE_STAGING_ACTIVATION_AUTHORIZATION_SIGNATURE_PATH: stagingAuthorizationPaths.signaturePath,
      CLOUDFLARE_STAGING_ACTIVATION_AUTHORIZATION_PUBLIC_KEY_PATH: stagingAuthorizationPaths.publicKeyPath,
      CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_BEFORE_RECEIPT_PATH: stagingStatusPaths.receiptPath,
      CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_BEFORE_SIGNATURE_PATH: stagingStatusPaths.signaturePath,
      CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_BEFORE_PUBLIC_KEY_PATH: stagingStatusPaths.publicKeyPath,
      CLOUDFLARE_STAGING_ACTIVATION_STATE_DIR: stagingAttempts,
      CLOUDFLARE_STAGING_ACTIVATION_NDJSON_PATH: path.join(staging.output, 'staging-deploy.ndjson'),
      CLOUDFLARE_STAGING_ACTIVATION_STATUS_CANDIDATE_PATH: stagingCandidate,
  };
  await assert.rejects(() => exec(process.execPath, [stagingExecutor], {
    cwd: staging.root,
    env: {
      ...stagingEnvironment,
      DWNC_CLOUDFLARE_TEST_MODE: '1',
      DWNC_CLOUDFLARE_TEST_FAULT: 'staging-candidate-written',
    },
    maxBuffer: 2 * 1024 * 1024,
  }), (error) => error?.signal === 'SIGKILL');
  assertions += 1;
  equal(JSON.parse(await readFile(stagingCandidate, 'utf8')).targetVersionId, stagingVersionId);
  const stagingRecoveryLockPath = path.join(stagingAttempts, 'staging-activation.lock');
  const stagingRecoveryLock = JSON.parse(await readFile(stagingRecoveryLockPath, 'utf8'));
  await writeFile(stagingRecoveryLockPath, `${canonicalJson({
    ...stagingRecoveryLock, pid: 2_147_483_647,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  })}\n`);
  const stagingRecovery = await stagingActivationRecoveryStatus(stagingAttempts);
  equal(stagingRecovery.recoveryEligible, true);
  const stagingCleanupRun = await exec(process.execPath, [stagingExecutor], {
    cwd: staging.root,
    env: {
      ...stagingEnvironment,
      CLOUDFLARE_STAGING_ACTIVATION_RECOVERY_TOKEN: stagingRecovery.recoveryToken,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  equal(JSON.parse(stagingCleanupRun.stdout).result, 'committed-lock-cleaned');
  const stagingCleanupState = JSON.parse(await readFile(
    path.join(staging.root, '.fake-wrangler-state.json'), 'utf8'));
  equal(stagingCleanupState.versionsDeployCalls, 1);

  const stagingRecoveryBuildUuid = '82345678-1234-4123-8123-123456789abc';
  const stagingRecoveryVersionAttestation = {
    ...stagingVersionAttestation, buildUuid: stagingRecoveryBuildUuid,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
  const stagingRecoveryVersionPaths = await writeSigned(
    staging.secrets, 'staging-recovery-version', stagingRecoveryVersionAttestation,
    canonicalVersionAttestationPayload, staging.privateKey, staging.publicKeyPem);
  const stagingRecoveryAuthorization = {
    ...stagingAuthorization, buildUuid: stagingRecoveryBuildUuid,
    nonceSha256: sha256Hex('staging-recovery-nonce'),
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
  };
  const stagingRecoveryAuthorizationPaths = await writeSigned(
    staging.secrets, 'staging-recovery-auth', stagingRecoveryAuthorization,
    canonicalStagingActivationAuthorizationPayload, staging.privateKey, staging.publicKeyPem);
  const stagingRecoveryState = path.join(staging.root, 'staging-recovery-attempts');
  await mkdir(stagingRecoveryState, { mode: 0o700 });
  const stagingRecoveryCandidate = path.join(staging.output, 'staging-recovery-candidate.json');
  const stagingRecoveryOutput = path.join(staging.output, 'staging-recovery-deploy.ndjson');
  await writeFile(path.join(staging.root, '.fake-wrangler-state.json'), `${JSON.stringify({
    mode: 'stay', deploymentId, currentVersionId: stagingPreviousVersionId,
    targetVersionId: stagingVersionId, versionsDeployCalls: 0,
  })}\n`);
  const stagingAmbiguousEnvironment = {
    ...stagingEnvironment,
    CLOUDFLARE_STAGING_VERSION_ATTESTATION_RECEIPT_PATH:
      stagingRecoveryVersionPaths.receiptPath,
    CLOUDFLARE_STAGING_VERSION_ATTESTATION_SIGNATURE_PATH:
      stagingRecoveryVersionPaths.signaturePath,
    CLOUDFLARE_STAGING_VERSION_ATTESTATION_PUBLIC_KEY_PATH:
      stagingRecoveryVersionPaths.publicKeyPath,
    CLOUDFLARE_STAGING_ACTIVATION_AUTHORIZATION_RECEIPT_PATH:
      stagingRecoveryAuthorizationPaths.receiptPath,
    CLOUDFLARE_STAGING_ACTIVATION_AUTHORIZATION_SIGNATURE_PATH:
      stagingRecoveryAuthorizationPaths.signaturePath,
    CLOUDFLARE_STAGING_ACTIVATION_AUTHORIZATION_PUBLIC_KEY_PATH:
      stagingRecoveryAuthorizationPaths.publicKeyPath,
    CLOUDFLARE_STAGING_ACTIVATION_STATE_DIR: stagingRecoveryState,
    CLOUDFLARE_STAGING_ACTIVATION_NDJSON_PATH: stagingRecoveryOutput,
    CLOUDFLARE_STAGING_ACTIVATION_STATUS_CANDIDATE_PATH: stagingRecoveryCandidate,
  };
  await assert.rejects(() => exec(process.execPath, [stagingExecutor], {
    cwd: staging.root, env: stagingAmbiguousEnvironment, maxBuffer: 2 * 1024 * 1024,
  }), (error) => error?.stderr?.includes('CLOUDFLARE_E_STAGING_ACTIVATION_AMBIGUOUS'));
  assertions += 1;
  const stagingAmbiguousLockPath = path.join(stagingRecoveryState, 'staging-activation.lock');
  const stagingAmbiguousLock = JSON.parse(await readFile(stagingAmbiguousLockPath, 'utf8'));
  await writeFile(stagingAmbiguousLockPath, `${canonicalJson({
    ...stagingAmbiguousLock, pid: 2_147_483_647,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  })}\n`);
  const delayedState = JSON.parse(await readFile(
    path.join(staging.root, '.fake-wrangler-state.json'), 'utf8'));
  delayedState.currentVersionId = stagingVersionId;
  await writeFile(path.join(staging.root, '.fake-wrangler-state.json'), `${JSON.stringify(delayedState)}\n`);
  const stagingRecoveryStatus = await stagingActivationRecoveryStatus(stagingRecoveryState);
  equal(stagingRecoveryStatus.recoveryEligible, true);
  const stagingRecovered = await exec(process.execPath, [stagingExecutor], {
    cwd: staging.root,
    env: {
      ...stagingAmbiguousEnvironment,
      CLOUDFLARE_STAGING_ACTIVATION_RECOVERY_TOKEN: stagingRecoveryStatus.recoveryToken,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
  equal(JSON.parse(stagingRecovered.stdout).result, 'committed-recovery');
  const recoveredStagingState = JSON.parse(await readFile(
    path.join(staging.root, '.fake-wrangler-state.json'), 'utf8'));
  equal(recoveredStagingState.versionsDeployCalls, 1);

  const success = await makeFixture('success', 'commit');
  const successRun = await exec(process.execPath, [executor], {
    cwd: success.root, env: success.childEnvironment, maxBuffer: 2 * 1024 * 1024,
  });
  equal(JSON.parse(successRun.stdout).result, 'committed');
  const successHead = await loadPromotionHead({
    directory: success.state, publicKeyPem: success.publicKeyPem,
    expectedFingerprint: success.fingerprint,
  });
  equal(successHead.head.state.generation, 1);
  equal(successHead.head.state.versionId, targetVersionId);
  equal(await promotionStoreStatus(success.state), { lockPresent: false, pendingPresent: false });
  equal((await readdir(success.state)).some((file) => file.startsWith('promotion-outcome-')), true);

  const recovery = await makeFixture('recovery', 'stay');
  await assert.rejects(() => exec(process.execPath, [executor], {
    cwd: recovery.root, env: recovery.childEnvironment, maxBuffer: 2 * 1024 * 1024,
  }), (error) => error?.stderr?.includes('CLOUDFLARE_E_PROMOTION_AMBIGUOUS'));
  assertions += 1;
  equal(await promotionStoreStatus(recovery.state), { lockPresent: true, pendingPresent: true });
  const lockPath = path.join(recovery.state, 'promotion.lock');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  await writeFile(lockPath, `${canonicalJson({
    ...lock, pid: 2_147_483_647,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  })}\n`, { mode: 0o600 });
  const fakeStatePath = path.join(recovery.root, '.fake-wrangler-state.json');
  const fakeState = JSON.parse(await readFile(fakeStatePath, 'utf8'));
  await writeFile(fakeStatePath, `${JSON.stringify({
    ...fakeState, mode: 'commit', currentVersionId: targetVersionId,
  })}\n`);
  const recoveredRun = await exec(process.execPath, [executor], {
    cwd: recovery.root,
    env: { ...recovery.childEnvironment, CLOUDFLARE_PROMOTION_RECOVERY_TOKEN: lock.token },
    maxBuffer: 2 * 1024 * 1024,
  });
  equal(JSON.parse(recoveredRun.stdout).result, 'committed');
  const recoveredHead = await loadPromotionHead({
    directory: recovery.state, publicKeyPem: recovery.publicKeyPem,
    expectedFingerprint: recovery.fingerprint,
  });
  equal(recoveredHead.head.state.generation, 1);
  equal(await promotionStoreStatus(recovery.state), { lockPresent: false, pendingPresent: false });
  equal((await readdir(recovery.state)).filter((file) => file.startsWith('promotion-outcome-')).length, 2);

  console.log(JSON.stringify({
    suite: 'cloudflare-production-promotion-executor', assertions,
    fakeWranglerProcesses: 18,
    denyBootstrapBlockedPendingRecovery: true,
    stagingSecretUploadVerified: true,
    stagingActivationCommitted: true,
    stagingAmbiguousRecoveryCommitted: true,
    successCommitted: true,
    ambiguousPreserved: true,
    explicitRecoveryCommitted: true,
    liveNetworkCalls: 0,
    status: 'PASS',
  }, null, 2));
} finally {
  await unlock(temporary);
  await rm(temporary, { recursive: true, force: true });
}
