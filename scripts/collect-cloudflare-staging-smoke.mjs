import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalDeploymentStatusEvidencePayload,
  canonicalStagingSmokePayload,
  canonicalVersionAttestationPayload,
  loadSignedJsonFiles,
  sha256Hex,
  validateDeploymentStatusEvidence,
  validateStagingSmokeReceipt,
  validateVersionAttestation,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import { stagingSmokeAuthorizationHeader } from '../src/lib/staging-smoke-token.js';
import { collectStagingSmokeEvidence } from './lib/cloudflare-staging.mjs';
import {
  canonicalStagingMediaProbePayload,
  validateStagingMediaProbeReceipt,
} from './lib/cloudflare-staging.mjs';
import {
  installStructuredErrorHandler,
  stagingSmokeTokenFromEnvironment,
} from './lib/cloudflare-process.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import { loadTrackedPublicMediaManifest } from './lib/public-media-manifest.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-staging-smoke');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_SMOKE_PATH');
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const outputPath = absolute(process.env.CLOUDFLARE_STAGING_SMOKE_CANDIDATE_PATH);
const origin = process.env.CLOUDFLARE_STAGING_SYNTHETIC_ORIGIN;
const token = stagingSmokeTokenFromEnvironment(process.env, { descriptor: 3 });
if (!/^https:\/\//u.test(origin ?? '')) {
  throw new Error('CLOUDFLARE_E_SMOKE_CREDENTIALS');
}
const [{ artifactSha256 }, manifest, redirectsRaw] = await Promise.all([
  validateArtifactDirectory(artifactDirectory),
  loadTrackedPublicMediaManifest(ROOT),
  readFile(path.join(ROOT, 'public/_redirects'), 'utf8'),
]);
const { receipt: artifact } = await validateArtifactDirectory(artifactDirectory);
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const signedPaths = (prefix) => ({
  receiptPath: absolute(process.env[`${prefix}_RECEIPT_PATH`]),
  signaturePath: absolute(process.env[`${prefix}_SIGNATURE_PATH`]),
  publicKeyPath: absolute(process.env[`${prefix}_PUBLIC_KEY_PATH`]),
});
const [productionVersionFiles, stagingVersionFiles, stagingStatusFiles, stagingProbeFiles] = await Promise.all([
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_VERSION_ATTESTATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_VERSION_ATTESTATION')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_DEPLOYMENT_STATUS')),
  loadSignedJsonFiles(signedPaths('CLOUDFLARE_STAGING_MEDIA_PROBE')),
]);
if (origin !== policy.staging.smokeOrigin
  || !/^[a-f0-9]{64}$/u.test(policy.staging.smokeAccessPolicySha256 ?? '')
  || !/^[a-f0-9]{64}$/u.test(policy.staging.releasePublicKeySpkiSha256 ?? '')
  || !/^[a-f0-9]{64}$/u.test(policy.production.releasePublicKeySpkiSha256 ?? '')) {
  throw new Error('CLOUDFLARE_E_SMOKE_POLICY');
}
verifySignedPayload({
  payload: productionVersionFiles.receipt,
  canonicalPayload: canonicalVersionAttestationPayload,
  validator: validateVersionAttestation,
  signature: productionVersionFiles.signature,
  publicKeyPem: productionVersionFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: policy.production.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      artifactSha256, payloadSha256: artifact.payloadSha256,
      environment: 'production', workerName: 'dwnc-me',
    },
    now: new Date(),
  },
});
verifySignedPayload({
  payload: stagingProbeFiles.receipt,
  canonicalPayload: canonicalStagingMediaProbePayload,
  validator: validateStagingMediaProbeReceipt,
  signature: stagingProbeFiles.signature,
  publicKeyPem: stagingProbeFiles.publicKeyPem,
  expectedPublicKeySpkiSha256: policy.staging.releasePublicKeySpkiSha256,
  validation: {
    expected: {
      artifactSha256, payloadSha256: artifact.payloadSha256,
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
      artifactSha256, payloadSha256: artifact.payloadSha256,
      environment: 'staging', workerName: 'dwnc-me-staging',
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
      environment: 'staging', workerName: 'dwnc-me-staging',
      targetVersionId: stagingVersionFiles.receipt.versionId,
    },
  },
});
if (Date.now() - Date.parse(stagingStatusFiles.receipt.observedAt) > 15 * 60 * 1000
  || Date.parse(stagingStatusFiles.receipt.observedAt) > Date.now() + 120000) {
  throw new Error('CLOUDFLARE_E_SMOKE_STATUS_EXPIRED');
}
const redirects = redirectsRaw.trim().split('\n').map((line) => {
  const [from, to, status] = line.trim().split(/\s+/u);
  if (status !== '308') throw new Error('CLOUDFLARE_E_SMOKE_REDIRECTS');
  return { from, to };
});
const fetcher = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('authorization', stagingSmokeAuthorizationHeader(token));
  return fetch(input, { ...init, headers });
};
const unauthenticatedFetcher = (input, init = {}) => fetch(input, init);
const receipt = await collectStagingSmokeEvidence({
  fetcher,
  unauthenticatedFetcher,
  origin,
  artifactSha256,
  payloadSha256: artifact.payloadSha256,
  versionId: productionVersionFiles.receipt.versionId,
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
  staticPath: '/about',
  redirects,
  observedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
});
validateStagingSmokeReceipt(receipt);
await writeCanonicalEvidenceCreateOnly(outputPath, receipt, canonicalStagingSmokePayload);
console.log(JSON.stringify({
  contract: receipt.contract, artifactSha256, redirectCount: receipt.redirectCount,
  candidateUnsigned: true, signingRequired: true, secretPrinted: false,
}, null, 2));
