import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  canonicalJson,
  canonicalStagingSmokePayload,
  canonicalStagingActivationAuthorizationPayload,
  canonicalStagingSecretAuthorizationPayload,
  canonicalDeploymentStatusEvidencePayload,
  canonicalPromotionAuthorizationPayload,
  canonicalPromotionPlanPayload,
  canonicalPromotionStatePayload,
  canonicalUploadAuthorizationPayload,
  cloudflarePayloadSha256,
  canonicalVersionAttestationPayload,
  cloudflareResourceDigest,
  classifyDeploymentStatus,
  createDeploymentStatusEvidence,
  createPromotionPlan,
  createPromotionGenesisState,
  createVersionAttestationFromDetail,
  parseWranglerVersionUploadNdjson,
  preuploadArtifactSha256,
  productionVersionUploadArguments,
  promotionCommand,
  productionPromotionArguments,
  reconcilePromotionState,
  sha256Hex,
  stagingActivationArguments,
  stagingVersionUploadArguments,
  validatePreuploadArtifact,
  validatePromotionState,
  validatePromotionAuthorization,
  validateStagingSmokeReceipt,
  validateStagingActivationAuthorization,
  validateStagingSecretAuthorization,
  validateUploadAuthorization,
  validateDeploymentStatusEvidence,
  validateVersionAttestation,
  verifySignedPayload,
  versionUploadMessage,
  versionUploadTag,
} from './lib/cloudflare-release.mjs';
import { assertCloudflareAccountTarget } from './lib/cloudflare-process.mjs';
import { cloudflareAccountIdSha256, publicKeySpkiSha256 } from './lib/public-media-manifest.mjs';

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = (action, code) => {
  assert.throws(action, (error) => error?.code === code || error?.message === code);
  assertions += 1;
};
const hash = (value) => sha256Hex(value);
const syntheticAccountId = 'a'.repeat(32);
assert.doesNotThrow(() => assertCloudflareAccountTarget(
  syntheticAccountId, cloudflareAccountIdSha256(syntheticAccountId)));
assertions += 1;
assert.throws(() => assertCloudflareAccountTarget(syntheticAccountId, hash(syntheticAccountId)),
  /CLOUDFLARE_E_ACCOUNT_TARGET/u);
assertions += 1;

const artifact = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-preupload-artifact-v1',
  environment: 'production',
  sourceGitSha: '1'.repeat(40),
  ciSourceGitSha: '1'.repeat(40),
  workerName: 'dwnc-me',
  accountIdSha256: hash('account'),
  stagingAccountIdSha256: hash('staging-account'),
  workerScriptSha256: hash('worker'),
  workerScriptBytes: 123,
  payloadSha256: '',
  staticTreeSha256: hash('static'),
  staticFiles: 2,
  publicRequestSurfaceSha256: hash('public-surface'),
  publicRequestPaths: 2,
  smokeStaticPath: '/about',
  smokeStaticBytes: 12,
  smokeStaticSha256: hash('about'),
  smokeStaticMime: 'text/html',
  uploadConfigSha256: hash('upload-config'),
  stagingUploadConfigSha256: hash('staging-upload-config'),
  environmentFileSha256: hash(''),
  promotionConfigSha256: hash('promotion-config'),
  stagingPromotionConfigSha256: hash('staging-promotion-config'),
  redirectsSha256: hash('redirects'),
  mediaManifestSha256: hash('media'),
  mediaRemoteReceiptSha256: hash('remote'),
  mediaRemoteSignatureSha256: hash('remote-signature'),
  mediaRemotePublicKeySpkiSha256: hash('remote-public-key'),
  bindingsSha256: '',
  assetsConfigSha256: '',
  stagingBindingsSha256: hash('staging-bindings'),
  stagingAssetsConfigSha256: hash('staging-assets'),
  wranglerVersion: '4.125.0',
  compatibilityDate: '2026-08-24',
};
artifact.payloadSha256 = cloudflarePayloadSha256(artifact.workerScriptSha256, artifact.staticTreeSha256);
const bindings = [
  { name: 'ASSETS', type: 'assets' },
  { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
  { name: 'MEDIA_BUCKET', bucket_name: 'dwnc-me-public-media-production', type: 'r2_bucket' },
  { name: 'DWNC_DEPLOYMENT_ENVIRONMENT', text: 'production', type: 'plain_text' },
];
const assets = { html_handling: 'drop-trailing-slash', not_found_handling: '404-page', run_worker_first: true };
const runtimeAssets = {
  html_handling: assets.html_handling,
  not_found_handling: assets.not_found_handling,
  raw_redirects: 'redirects',
  raw_run_worker_first: assets.run_worker_first,
  redirects: { rules: {}, staticRules: {}, version: 1 },
  serve_directly: false,
};
artifact.bindingsSha256 = cloudflareResourceDigest(bindings);
artifact.assetsConfigSha256 = cloudflareResourceDigest(assets);
const stagingBindings = [
  { name: 'ASSETS', type: 'assets' },
  { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
  { name: 'DWNC_DEPLOYMENT_ENVIRONMENT', text: 'staging', type: 'plain_text' },
  { name: 'DWNC_STAGING_SMOKE_ORIGIN', text: 'https://dwnc-me-staging.dwnc.workers.dev', type: 'plain_text' },
  { name: 'DWNC_STAGING_SMOKE_POLICY', text: 'bearer-token-non-access-origin', type: 'plain_text' },
  { name: 'DWNC_STAGING_SMOKE_TOKEN', type: 'secret_text' },
  { name: 'MEDIA_BUCKET', bucket_name: 'dwnc-me-public-media-staging', type: 'r2_bucket' },
];
artifact.stagingBindingsSha256 = cloudflareResourceDigest(stagingBindings);
artifact.stagingAssetsConfigSha256 = cloudflareResourceDigest(assets);
validatePreuploadArtifact(artifact);
assertions += 1;
const artifactSha = preuploadArtifactSha256(artifact);
equal(artifactSha.length, 64);
equal(versionUploadTag(artifactSha), `dwnc-${artifactSha.slice(0, 32)}`);
equal(versionUploadMessage(artifact), `dwnc-artifact:${artifactSha}`);
const uploadArgs = productionVersionUploadArguments({ artifactDirectory: '/tmp/artifact', artifact });
equal(uploadArgs.includes('--no-bundle'), true);
equal(uploadArgs.includes('--strict'), true);
equal(uploadArgs.includes('--assets'), true);
equal(uploadArgs.includes('deploy'), false);

const uploadEvent = {
  type: 'version-upload', version: 1, worker_name: 'dwnc-me', worker_tag: 'opaque-service-tag',
  version_id: '12345678-1234-4123-8123-123456789abc', preview_url: null,
  preview_alias_url: null, wrangler_environment: 'production', worker_name_overridden: false,
  timestamp: '2026-08-25T00:01:00.000Z',
};
const sessionEvent = {
  type: 'wrangler-session', version: 1, wrangler_version: '4.125.0',
  command_line_args: uploadArgs, log_file_path: null, timestamp: '2026-08-25T00:00:59.000Z',
};
const uploadOutput = `${JSON.stringify(sessionEvent)}\n${JSON.stringify(uploadEvent)}\n`;
equal(parseWranglerVersionUploadNdjson(uploadOutput, { expectedArguments: uploadArgs }), uploadEvent);
rejects(() => parseWranglerVersionUploadNdjson(`${uploadOutput}${JSON.stringify(uploadEvent)}\n`),
  'CLOUDFLARE_E_UPLOAD_EVENT_COUNT');
rejects(() => parseWranglerVersionUploadNdjson(`${JSON.stringify(sessionEvent)}\n${JSON.stringify({ ...uploadEvent, type: 'version-deploy' })}\n`),
  'CLOUDFLARE_E_UPLOAD_OUTPUT');
rejects(() => parseWranglerVersionUploadNdjson(`${JSON.stringify(sessionEvent)}\n${JSON.stringify({ ...uploadEvent, worker_name_overridden: true })}\n`),
  'CLOUDFLARE_E_UPLOAD_OUTPUT');

const uploadAuthorization = {
  schemaVersion: 1, contract: 'dwnc-cloudflare-upload-authorization-v1', environment: 'production',
  artifactSha256: artifactSha, accountIdSha256: artifact.accountIdSha256, workerName: 'dwnc-me',
  sourceGitSha: artifact.sourceGitSha, buildUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  nonceSha256: hash('one-time-nonce'), createdAt: '2026-08-25T00:00:00.000Z',
  expiresAt: '2026-08-25T00:10:00.000Z',
};
validateUploadAuthorization(uploadAuthorization, { now: new Date('2026-08-25T00:05:00.000Z') });
assertions += 1;
const stagingUploadAuthorization = {
  ...uploadAuthorization,
  environment: 'staging',
  accountIdSha256: artifact.stagingAccountIdSha256,
  workerName: 'dwnc-me-staging',
};
const secretsFile = '/dev/fd/3';
const stagingUploadArgs = stagingVersionUploadArguments({
  artifactDirectory: '/tmp/artifact', artifact, secretsFile,
});
equal(stagingUploadArgs.slice(stagingUploadArgs.indexOf('--secrets-file'),
  stagingUploadArgs.indexOf('--secrets-file') + 2), ['--secrets-file', secretsFile]);
equal(uploadArgs.includes('--secrets-file'), false);
const secretValue = 'A'.repeat(43);
const secretsFileRaw = `${JSON.stringify({ DWNC_STAGING_SMOKE_TOKEN: secretValue })}\n`;
const stagingSecretAuthorization = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-staging-secret-authorization-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256: artifact.stagingAccountIdSha256,
  artifactSha256: artifactSha,
  sourceGitSha: artifact.sourceGitSha,
  uploadAuthorizationSha256: hash(canonicalUploadAuthorizationPayload(stagingUploadAuthorization)),
  secretName: 'DWNC_STAGING_SMOKE_TOKEN',
  secretValueSha256: hash(secretValue),
  secretBytes: Buffer.byteLength(secretValue),
  secretsFileSha256: hash(secretsFileRaw),
  uploadArgumentsSha256: hash(canonicalJson(stagingUploadArgs)),
  buildUuid: stagingUploadAuthorization.buildUuid,
  nonceSha256: hash('staging-secret-nonce'),
  createdAt: '2026-08-25T00:00:00.000Z',
  expiresAt: '2026-08-25T00:10:00.000Z',
};
validateStagingSecretAuthorization(stagingSecretAuthorization, {
  expected: { artifactSha256: artifactSha, secretValueSha256: hash(secretValue) },
  now: new Date('2026-08-25T00:05:00.000Z'),
}); assertions += 1;
equal(canonicalStagingSecretAuthorizationPayload(stagingSecretAuthorization).includes(secretValue), false);
rejects(() => validateStagingSecretAuthorization({
  ...stagingSecretAuthorization, secretBytes: 16,
}, { now: new Date('2026-08-25T00:05:00.000Z') }),
'CLOUDFLARE_E_STAGING_SECRET_AUTHORIZATION');

const detail = {
  id: uploadEvent.version_id,
  metadata: { created_on: '2026-08-25T00:01:00.000Z' },
  annotations: {
    'workers/tag': versionUploadTag(artifactSha),
    'workers/message': versionUploadMessage(artifact),
  },
  resources: {
    script: { etag: '"script-etag"', handlers: ['fetch'] },
    script_runtime: { compatibility_date: '2026-08-24', assets: runtimeAssets },
    bindings,
  },
};
const uploadResult = {
  schemaVersion: 1, contract: 'dwnc-cloudflare-version-upload-result-v1',
  artifactSha256: artifactSha, versionId: uploadEvent.version_id, workerName: 'dwnc-me',
  environment: 'production', wranglerOutputSha256: hash(uploadOutput),
  uploadAuthorizationSha256: hash(canonicalUploadAuthorizationPayload(uploadAuthorization)),
  buildUuid: uploadAuthorization.buildUuid, uploadedAt: uploadEvent.timestamp,
};
const attestation = createVersionAttestationFromDetail({
  artifact, uploadResult, detail, now: '2026-08-25T00:02:00.000Z', expiresAt: '2026-08-25T00:12:00.000Z',
});
validateVersionAttestation(attestation, { now: new Date('2026-08-25T00:05:00.000Z') });
assertions += 1;
equal(attestation.artifactSha256, artifactSha);
equal(attestation.payloadSha256, artifact.payloadSha256);
const stagingUploadResult = {
  ...uploadResult,
  versionId: '22345678-1234-4123-8123-123456789abc',
  workerName: 'dwnc-me-staging',
  environment: 'staging',
};
const stagingDetail = {
  ...detail,
  id: stagingUploadResult.versionId,
  resources: { ...detail.resources, bindings: stagingBindings },
};
const stagingAttestation = createVersionAttestationFromDetail({
  artifact,
  uploadResult: stagingUploadResult,
  detail: stagingDetail,
  now: '2026-08-25T00:02:00.000Z',
  expiresAt: '2026-08-25T00:12:00.000Z',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  expectedBindingsSha256: artifact.stagingBindingsSha256,
  expectedAssetsConfigSha256: artifact.stagingAssetsConfigSha256,
});
equal(stagingAttestation.payloadSha256, attestation.payloadSha256);
equal(stagingAttestation.versionId === attestation.versionId, false);
equal(stagingAttestation.accountIdSha256, artifact.stagingAccountIdSha256);
rejects(() => createVersionAttestationFromDetail({
  artifact, uploadResult, detail: { ...detail, id: '22345678-1234-4123-8123-123456789abc' },
  now: attestation.createdAt, expiresAt: attestation.expiresAt,
}), 'CLOUDFLARE_E_VERSION_DETAIL');
rejects(() => createVersionAttestationFromDetail({
  artifact, uploadResult, detail: { ...detail, resources: { ...detail.resources, bindings: [] } },
  now: attestation.createdAt, expiresAt: attestation.expiresAt,
}), 'CLOUDFLARE_E_VERSION_DETAIL_BINDINGS');
rejects(() => createVersionAttestationFromDetail({
  artifact, uploadResult,
  detail: {
    ...detail,
    resources: {
      ...detail.resources,
      script_runtime: { ...detail.resources.script_runtime, compatibility_flags: ['nodejs_compat'] },
    },
  },
  now: attestation.createdAt, expiresAt: attestation.expiresAt,
}), 'CLOUDFLARE_E_VERSION_DETAIL');
const missingRuntimeAssets = Object.fromEntries(
  Object.entries(runtimeAssets).filter(([key]) => key !== 'raw_redirects'),
);
rejects(() => createVersionAttestationFromDetail({
  artifact, uploadResult,
  detail: {
    ...detail,
    resources: {
      ...detail.resources,
      script_runtime: { ...detail.resources.script_runtime, assets: missingRuntimeAssets },
    },
  },
  now: attestation.createdAt, expiresAt: attestation.expiresAt,
}), 'CLOUDFLARE_E_VERSION_DETAIL');
rejects(() => createVersionAttestationFromDetail({
  artifact, uploadResult,
  detail: {
    ...detail,
    resources: {
      ...detail.resources,
      script_runtime: {
        ...detail.resources.script_runtime,
        assets: { ...runtimeAssets, unexpected: true },
      },
    },
  },
  now: attestation.createdAt, expiresAt: attestation.expiresAt,
}), 'CLOUDFLARE_E_VERSION_DETAIL');
rejects(() => createVersionAttestationFromDetail({
  artifact, uploadResult,
  detail: { ...detail, annotations: { ...detail.annotations, 'workers/tag': 'wrong-artifact-tag' } },
  now: attestation.createdAt, expiresAt: attestation.expiresAt,
}), 'CLOUDFLARE_E_VERSION_DETAIL');
rejects(() => validateVersionAttestation({ ...attestation, artifactSha256: hash('tamper') }, {
  expected: { artifactSha256: artifactSha }, now: new Date('2026-08-25T00:05:00.000Z'),
}), 'CLOUDFLARE_E_VERSION_EXPECTED');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const uploadAuthorizationSignature = sign(null,
  Buffer.from(canonicalUploadAuthorizationPayload(uploadAuthorization)), privateKey);
equal(verifySignedPayload({
  payload: uploadAuthorization,
  canonicalPayload: canonicalUploadAuthorizationPayload,
  validator: validateUploadAuthorization,
  signature: uploadAuthorizationSignature,
  publicKeyPem,
  expectedPublicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
  validation: { now: new Date('2026-08-25T00:05:00.000Z') },
}), true);
rejects(() => validateUploadAuthorization(uploadAuthorization, {
  now: new Date('2026-08-25T00:10:00.000Z'),
}), 'CLOUDFLARE_E_UPLOAD_AUTHORIZATION_EXPIRED');
const signature = sign(null, Buffer.from(canonicalVersionAttestationPayload(attestation)), privateKey);
equal(verifySignedPayload({
  payload: attestation,
  canonicalPayload: canonicalVersionAttestationPayload,
  validator: validateVersionAttestation,
  signature,
  publicKeyPem,
  expectedPublicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
  validation: { now: new Date('2026-08-25T00:05:00.000Z') },
}), true);

const smoke = {
  schemaVersion: 1, contract: 'dwnc-cloudflare-staging-smoke-v1', environment: 'staging',
  artifactSha256: artifactSha, payloadSha256: artifact.payloadSha256,
  versionId: attestation.versionId, stagingVersionId: stagingAttestation.versionId,
  originSha256: hash('smoke-origin'), accessPolicySha256: hash('smoke-auth-policy'),
  stagingVersionAttestationSha256: hash(canonicalVersionAttestationPayload(stagingAttestation)),
  stagingDeploymentStatusSha256: hash('staging-status'), rawProbeEvidenceSha256: hash('raw-probe'),
  stagingMediaProbeSha256: hash('staging-media-probe'),
  syntheticNonAccessOrigin: true, get200: true, head200: true, notModified304: true,
  range206: true, range416: true, mimeVerified: true, etagVerified: true, static200: true,
  notFound404: true, redirects308: true, redirectBodiesEmpty: true,
  redirectQueryDiscarded: true, redirectCount: 349, redirectGetRequestCount: 349,
  redirectHeadRequestCount: 349, redirectRequestCount: 698, mediaRequestCount: 5,
  staticRequestCount: 2, notFoundRequestCount: 2, cacheProbeRequestCount: 1,
  authenticatedRequestCount: 708, unauthenticatedRequestCount: 1, totalRequestCount: 709,
  cachePathVerified: true,
  stagingDeployment100: true, unauthenticatedDenied: true,
  versionMarkerVerified: true,
  observedAt: '2026-08-25T00:03:00.000Z', expiresAt: '2026-08-25T00:13:00.000Z',
};
validateStagingSmokeReceipt(smoke, { now: new Date('2026-08-25T00:05:00.000Z') });
assertions += 1;
const smokeSignature = sign(null, Buffer.from(canonicalStagingSmokePayload(smoke)), privateKey);
equal(verifySignedPayload({
  payload: smoke,
  canonicalPayload: canonicalStagingSmokePayload,
  validator: validateStagingSmokeReceipt,
  signature: smokeSignature,
  publicKeyPem,
  expectedPublicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
  validation: { now: new Date('2026-08-25T00:05:00.000Z') },
}), true);
rejects(() => validateStagingSmokeReceipt({ ...smoke, syntheticNonAccessOrigin: false }, {
  now: new Date('2026-08-25T00:05:00.000Z'),
}), 'CLOUDFLARE_E_STAGING_SMOKE');

const stagingStatusBefore = createDeploymentStatusEvidence({
  rawStatus: {
    id: '73345678-1234-4123-8123-123456789abc',
    versions: [{ version_id: '83345678-1234-4123-8123-123456789abc', percentage: 100 }],
  },
  targetVersionId: '83345678-1234-4123-8123-123456789abc',
  observedAt: '2026-08-25T00:04:00.000Z',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
});
validateDeploymentStatusEvidence(stagingStatusBefore, {
  expected: {
    environment: 'staging',
    workerName: 'dwnc-me-staging',
    targetVersionId: '83345678-1234-4123-8123-123456789abc',
  },
});
assertions += 1;
for (const expected of [
  { environment: 'production' },
  { workerName: 'dwnc-me' },
  { targetVersionId: '93345678-1234-4123-8123-123456789abc' },
]) {
  rejects(() => validateDeploymentStatusEvidence(stagingStatusBefore, { expected }),
    'CLOUDFLARE_E_DEPLOYMENT_STATUS_EXPECTED');
}
const stagingActivationArgs = stagingActivationArguments({
  versionId: stagingAttestation.versionId,
  artifactDirectory: '/tmp/artifact',
  artifactSha256: artifactSha,
});
const stagingActivationAuthorization = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-staging-activation-authorization-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  artifactSha256: artifactSha,
  payloadSha256: artifact.payloadSha256,
  versionId: stagingAttestation.versionId,
  accountIdSha256: artifact.stagingAccountIdSha256,
  originSha256: hash('https://dwnc-me-staging.dwnc.workers.dev'),
  accessPolicySha256: hash('staging-access-policy'),
  deploymentStatusBeforeSha256: hash(
    canonicalDeploymentStatusEvidencePayload(stagingStatusBefore)),
  deploymentArgumentsSha256: hash(canonicalJson(stagingActivationArgs)),
  buildUuid: '92345678-1234-4123-8123-123456789abc',
  nonceSha256: hash('staging-activation-nonce'),
  createdAt: '2026-08-25T00:04:00.000Z',
  expiresAt: '2026-08-25T00:14:00.000Z',
};
validateStagingActivationAuthorization(stagingActivationAuthorization, {
  expected: { artifactSha256: artifactSha, versionId: stagingAttestation.versionId },
  now: new Date('2026-08-25T00:05:00.000Z'),
});
assertions += 1;
equal(stagingActivationArgs.includes('deploy'), true);
equal(stagingActivationArgs.includes(`${stagingAttestation.versionId}@100%`), true);
rejects(() => validateStagingActivationAuthorization({
  ...stagingActivationAuthorization,
  deploymentArgumentsSha256: hash('wrong-staging-arguments'),
}, {
  expected: { deploymentArgumentsSha256: stagingActivationAuthorization.deploymentArgumentsSha256 },
  now: new Date('2026-08-25T00:05:00.000Z'),
}), 'CLOUDFLARE_E_STAGING_ACTIVATION_AUTH_EXPECTED');
equal(canonicalStagingActivationAuthorizationPayload(stagingActivationAuthorization).includes('private'), false);

const manifest = { manifestSha256: artifact.mediaManifestSha256 };
const genesis = createPromotionGenesisState();
validatePromotionState(genesis);
assertions += 1;
const plan1 = createPromotionPlan({
  previous: genesis, artifact, attestation, mediaManifest: manifest,
  publicPaths: ['/posts/1', '/naver/100', '/search-index.json', '/rss.xml',
    '/media/a.jpg', '/media/b.jpg'],
});
const statusRaw1 = {
  id: '33345678-1234-4123-8123-123456789abc',
  versions: [{ version_id: attestation.versionId, percentage: 100 }],
};
equal(classifyDeploymentStatus(statusRaw1, { targetVersionId: attestation.versionId }), 'committed');
const status1 = createDeploymentStatusEvidence({
  rawStatus: statusRaw1, targetVersionId: attestation.versionId,
  observedAt: '2026-08-25T00:06:00.000Z',
});
const state1 = reconcilePromotionState({
  previous: genesis, plan: plan1, deploymentStatus: status1, activatedAt: status1.observedAt,
});
validatePromotionState(state1);
assertions += 1;
const artifact2 = {
  ...artifact,
  sourceGitSha: '2'.repeat(40),
  ciSourceGitSha: '2'.repeat(40),
  workerScriptSha256: hash('worker-v2'),
};
artifact2.payloadSha256 = cloudflarePayloadSha256(
  artifact2.workerScriptSha256, artifact2.staticTreeSha256);
const artifact2Sha = preuploadArtifactSha256(artifact2);
const attestation2 = {
  ...attestation,
  artifactSha256: artifact2Sha,
  payloadSha256: artifact2.payloadSha256,
  versionId: '62345678-1234-4123-8123-123456789abc',
  sourceGitSha: artifact2.sourceGitSha,
  rawVersionDetailSha256: hash('version-detail-v2'),
};
validateVersionAttestation(attestation2, { now: new Date('2026-08-25T00:05:00.000Z') });
assertions += 1;
const plan2 = createPromotionPlan({
  previous: state1, artifact: artifact2, attestation: attestation2, mediaManifest: manifest,
  publicPaths: ['/posts/1', '/search-index.json', '/rss.xml', '/media/a.jpg'],
});
const statusRaw2 = {
  id: '43345678-1234-4123-8123-123456789abc',
  versions: [{ version_id: attestation2.versionId, percentage: 100 }],
};
const status2 = createDeploymentStatusEvidence({
  rawStatus: statusRaw2, targetVersionId: attestation2.versionId,
  observedAt: '2026-08-25T00:07:00.000Z',
});
const state2 = reconcilePromotionState({
  previous: state1, plan: plan2, deploymentStatus: status2, activatedAt: status2.observedAt,
});
equal(state2.withdrawnKeyHashes.includes(hash('/media/b.jpg')), true);
equal(state2.withdrawnKeyHashes.includes(hash('/naver/100')), true);
rejects(() => createPromotionPlan({
  previous: state2, artifact, attestation, mediaManifest: manifest,
  publicPaths: ['/posts/1', '/naver/100', '/search-index.json', '/rss.xml', '/media/a.jpg'],
}), 'CLOUDFLARE_E_PROMOTION_ROLLBACK');
rejects(() => reconcilePromotionState({
  previous: genesis, plan: plan2, deploymentStatus: status2, activatedAt: status2.observedAt,
}), 'CLOUDFLARE_E_PROMOTION_CAS');
equal(classifyDeploymentStatus({
  versions: [{ version_id: attestation2.versionId, percentage: 50 },
    { version_id: '52345678-1234-4123-8123-123456789abc', percentage: 50 }],
}, { targetVersionId: attestation2.versionId }), 'ambiguous');
const promotionAuthorization = {
  schemaVersion: 1, contract: 'dwnc-cloudflare-promotion-authorization-v1', environment: 'production',
  artifactSha256: artifact2Sha, versionId: attestation2.versionId,
  activePromotionSha256: hash(canonicalPromotionStatePayload(state1)),
  promotionPlanSha256: hash(canonicalPromotionPlanPayload(plan2)),
  deploymentStatusBeforeSha256: hash(canonicalDeploymentStatusEvidencePayload(status1)),
  deploymentArgumentsSha256: hash(canonicalJson(productionPromotionArguments({
    versionId: attestation2.versionId,
    artifactDirectory: '/tmp/artifact',
    planSha256: hash(canonicalPromotionPlanPayload(plan2)),
  }))),
  buildUuid: attestation2.buildUuid, nonceSha256: hash('promotion-nonce'),
  createdAt: '2026-08-25T00:05:00.000Z', expiresAt: '2026-08-25T00:15:00.000Z',
};
validatePromotionAuthorization(promotionAuthorization, { now: new Date('2026-08-25T00:10:00.000Z') });
assertions += 1;
rejects(() => validatePromotionAuthorization({
  ...promotionAuthorization, activePromotionSha256: hash('foreign-active-head'),
}, {
  expected: { activePromotionSha256: promotionAuthorization.activePromotionSha256 },
  now: new Date('2026-08-25T00:10:00.000Z'),
}), 'CLOUDFLARE_E_PROMOTION_AUTHORIZATION_EXPECTED');
const promotionAuthorizationSignature = sign(null,
  Buffer.from(canonicalPromotionAuthorizationPayload(promotionAuthorization)), privateKey);
equal(verifySignedPayload({
  payload: promotionAuthorization,
  canonicalPayload: canonicalPromotionAuthorizationPayload,
  validator: validatePromotionAuthorization,
  signature: promotionAuthorizationSignature,
  publicKeyPem,
  expectedPublicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
  validation: { now: new Date('2026-08-25T00:10:00.000Z') },
}), true);
equal(promotionCommand(attestation.versionId), `wrangler versions deploy ${attestation.versionId}@100%`);
equal(promotionCommand(attestation.versionId).includes('wrangler deploy'), false);

console.log(JSON.stringify({
  suite: 'cloudflare-two-phase-release', assertions,
  preuploadArtifactHasVersionId: false,
  uploadEventExactlyOne: true,
  postUploadAttestation: true,
  stagingSmokeContract: true,
  withdrawalRollbackRejected: true,
  liveNetworkCalls: 0,
  deploymentAttempts: 0,
  status: 'PASS',
}, null, 2));
