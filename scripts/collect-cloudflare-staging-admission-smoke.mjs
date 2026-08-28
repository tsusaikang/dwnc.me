import path from 'node:path';
import { validateStagingArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalDeploymentStatusEvidencePayload,
  canonicalVersionAttestationPayload,
  loadSignedJsonFiles,
  sha256Hex,
  validateDeploymentStatusEvidence,
  validateVersionAttestation,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import { stagingSmokeAuthorizationHeader } from '../src/lib/staging-smoke-token.js';
import {
  canonicalStagingAdmissionSmokePayload,
  canonicalStagingMediaProbePayload,
  collectStagingAdmissionSmokeEvidence,
  stagingSmokeLimitsFromEnvironment,
  validateStagingAdmissionSmokeReceipt,
  validateStagingMediaProbeReceipt,
} from './lib/cloudflare-staging.mjs';
import {
  installStructuredErrorHandler,
  stagingSmokeTokenFromEnvironment,
} from './lib/cloudflare-process.mjs';
import { loadStagingSmokeRedirectAuthority } from './lib/cloudflare-redirects.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-staging-admission-smoke');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_PATH');
  }
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const outputPath = absolute(process.env.CLOUDFLARE_STAGING_ADMISSION_SMOKE_CANDIDATE_PATH);
const origin = process.env.CLOUDFLARE_STAGING_SYNTHETIC_ORIGIN;
if (!/^https:\/\//u.test(origin ?? '')) {
  throw new Error('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_CREDENTIALS');
}
const [manifest, policy] = await Promise.all([
  loadTrackedPublicMediaManifest(ROOT),
  loadTrackedPublicMediaReleasePolicy(ROOT),
]);
const { receipt: artifact, artifactSha256, staticEntry } = await validateStagingArtifactDirectory(
  artifactDirectory, { policy, manifest },
);
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
const [stagingVersionFiles, stagingStatusFiles, stagingProbeFiles] = await Promise.all([
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_VERSION_ATTESTATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_DEPLOYMENT_STATUS')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_MEDIA_PROBE')),
]);
if (origin !== policy.staging.smokeOrigin
  || artifact.stagingAccountIdSha256 !== policy.staging.accountIdSha256
  || !/^[a-f0-9]{64}$/u.test(policy.staging.smokeAccessPolicySha256 ?? '')
  || !/^[a-f0-9]{64}$/u.test(policy.staging.releasePublicKeySpkiSha256 ?? '')) {
  throw new Error('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_POLICY');
}
verifySignedPayload({
  payload: stagingProbeFiles.receipt,
  canonicalPayload: canonicalStagingMediaProbePayload,
  validator: validateStagingMediaProbeReceipt,
  signature: stagingProbeFiles.signature,
  publicKeyPem: stagingProbeFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: policy.staging.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      artifactSha256,
      payloadSha256: artifact.payloadSha256,
      stagingVersionId: stagingVersionFiles.receipt.versionId,
      originSha256: sha256Hex(origin),
      accountIdSha256: artifact.stagingAccountIdSha256,
      bucket: policy.staging.bucket,
      manifestSha256: manifest.manifestSha256,
    },
    now: new Date(),
  },
});
verifySignedPayload({
  payload: stagingVersionFiles.receipt,
  canonicalPayload: canonicalVersionAttestationPayload,
  validator: validateVersionAttestation,
  signature: stagingVersionFiles.signature,
  publicKeyPem: stagingVersionFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: policy.staging.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      artifactSha256,
      payloadSha256: artifact.payloadSha256,
      environment: 'staging',
      workerName: 'dwnc-me-staging',
      accountIdSha256: artifact.stagingAccountIdSha256,
    },
    now: new Date(),
  },
});
verifySignedPayload({
  payload: stagingStatusFiles.receipt,
  canonicalPayload: canonicalDeploymentStatusEvidencePayload,
  validator: validateDeploymentStatusEvidence,
  signature: stagingStatusFiles.signature,
  publicKeyPem: stagingStatusFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: policy.staging.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      environment: 'staging',
      workerName: 'dwnc-me-staging',
      targetVersionId: stagingVersionFiles.receipt.versionId,
    },
  },
});
if (Date.now() - Date.parse(stagingStatusFiles.receipt.observedAt) > 15 * 60 * 1000
  || Date.parse(stagingStatusFiles.receipt.observedAt) > Date.now() + 120000) {
  throw new Error('CLOUDFLARE_E_STAGING_ADMISSION_SMOKE_STATUS_EXPIRED');
}
const { redirects } = await loadStagingSmokeRedirectAuthority(
  ROOT, artifactDirectory, artifact,
);
const token = stagingSmokeTokenFromEnvironment(process.env, { descriptor: 3 });
const fetcher = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('authorization', stagingSmokeAuthorizationHeader(token));
  headers.set('accept-encoding', 'identity');
  return fetch(input, { ...init, redirect: 'manual', headers });
};
const observedAt = new Date().toISOString();
const receipt = await collectStagingAdmissionSmokeEvidence({
  fetcher,
  unauthenticatedFetcher: (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('accept-encoding', 'identity');
    return fetch(input, { ...init, redirect: 'manual', headers });
  },
  origin,
  artifactSha256,
  payloadSha256: artifact.payloadSha256,
  stagingVersionId: stagingVersionFiles.receipt.versionId,
  accessPolicySha256: policy.staging.smokeAccessPolicySha256,
  stagingVersionAttestationSha256: sha256Hex(
    canonicalVersionAttestationPayload(stagingVersionFiles.receipt)),
  stagingDeploymentStatusSha256: sha256Hex(
    canonicalDeploymentStatusEvidencePayload(stagingStatusFiles.receipt)),
  stagingMediaProbeSha256: sha256Hex(
    canonicalStagingMediaProbePayload(stagingProbeFiles.receipt)),
  stagingDeployment100: true,
  mediaEntry: manifest.entries[0],
  staticEntry,
  redirects,
  limits: stagingSmokeLimitsFromEnvironment(),
  observedAt,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
});
validateStagingAdmissionSmokeReceipt(receipt);
await writeCanonicalEvidenceCreateOnly(
  outputPath, receipt, canonicalStagingAdmissionSmokePayload,
);
console.log(JSON.stringify({
  contract: receipt.contract,
  artifactSha256,
  stagingVersionId: receipt.stagingVersionId,
  redirectCount: receipt.redirectCount,
  redirectRequestCount: receipt.redirectRequestCount,
  totalRequestCount: receipt.totalRequestCount,
  cacheProbeRequestCount: receipt.cacheProbeRequestCount,
  productionVersionAttestationRequired: false,
  candidateUnsigned: true,
  signingRequired: true,
  secretPrinted: false,
}, null, 2));
