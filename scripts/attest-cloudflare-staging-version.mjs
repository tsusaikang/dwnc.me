import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateStagingUploadArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalJson,
  canonicalVersionAttestationPayload,
  createVersionAttestationFromDetail,
  sha256Hex,
  validateVersionUploadResult,
} from './lib/cloudflare-release.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-attest-staging-version');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_ATTEST_PATH');
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const uploadResultPath = absolute(process.env.CLOUDFLARE_STAGING_VERSION_UPLOAD_RESULT_PATH);
const detailPath = absolute(process.env.CLOUDFLARE_STAGING_VERSION_DETAIL_EVIDENCE_PATH);
const outputPath = absolute(process.env.CLOUDFLARE_STAGING_VERSION_ATTESTATION_CANDIDATE_PATH);
const { receipt: artifact, artifactSha256 } = await validateStagingUploadArtifactDirectory(
  artifactDirectory,
  async () => {
    const [policy, manifest] = await Promise.all([
      loadTrackedPublicMediaReleasePolicy(ROOT),
      loadTrackedPublicMediaManifest(ROOT),
    ]);
    return { policy, manifest };
  },
);
let uploadResult;
let evidence;
try {
  uploadResult = JSON.parse(await readFile(uploadResultPath, 'utf8'));
  evidence = JSON.parse(await readFile(detailPath, 'utf8'));
} catch { throw new Error('CLOUDFLARE_E_ATTEST_INPUT'); }
validateVersionUploadResult(uploadResult, {
  artifactSha256, environment: 'staging', workerName: 'dwnc-me-staging',
});
let parsed;
try { parsed = JSON.parse(evidence.rawStdout); }
catch { throw new Error('CLOUDFLARE_E_ATTEST_EVIDENCE'); }
const expectedArgs = [
  'versions', 'view', uploadResult.versionId, '--json', '--env', 'staging',
  '--config', path.join(artifactDirectory, 'wrangler-staging-upload.jsonc'),
  '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
];
if (evidence?.contract !== 'dwnc-cloudflare-version-detail-evidence-v1'
  || evidence.environment !== 'staging' || evidence.workerName !== 'dwnc-me-staging'
  || evidence.artifactSha256 !== artifactSha256 || evidence.versionId !== uploadResult.versionId
  || sha256Hex(evidence.rawStdout) !== evidence.rawStdoutSha256
  || canonicalJson(parsed) !== canonicalJson(evidence.detail)
  || evidence.commandSha256 !== sha256Hex(canonicalJson(expectedArgs))) {
  throw new Error('CLOUDFLARE_E_ATTEST_EVIDENCE');
}
const attestation = createVersionAttestationFromDetail({
  artifact,
  uploadResult,
  detail: evidence.detail,
  now: process.env.CLOUDFLARE_VERSION_ATTESTED_AT,
  expiresAt: process.env.CLOUDFLARE_VERSION_ATTESTATION_EXPIRES_AT,
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  expectedBindingsSha256: artifact.stagingBindingsSha256,
  expectedAssetsConfigSha256: artifact.stagingAssetsConfigSha256,
});
await writeFile(outputPath, `${canonicalVersionAttestationPayload(attestation)}\n`, {
  flag: 'wx', mode: 0o600,
});
console.log(JSON.stringify({
  contract: attestation.contract, artifactSha256, payloadSha256: attestation.payloadSha256,
  versionId: attestation.versionId, environment: 'staging', signed: false,
}, null, 2));
