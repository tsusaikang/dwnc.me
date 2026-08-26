import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  canonicalJson,
  canonicalVersionAttestationPayload,
  createVersionAttestationFromDetail,
  sha256Hex,
  validateVersionUploadResult,
} from './lib/cloudflare-release.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';

installStructuredErrorHandler('cloudflare-attest-version');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_ATTEST_PATH');
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const uploadResultPath = absolute(process.env.CLOUDFLARE_VERSION_UPLOAD_RESULT_PATH);
const versionDetailPath = absolute(process.env.CLOUDFLARE_VERSION_DETAIL_EVIDENCE_PATH);
const outputPath = absolute(process.env.CLOUDFLARE_VERSION_ATTESTATION_CANDIDATE_PATH);
const createdAt = process.env.CLOUDFLARE_VERSION_ATTESTED_AT;
const expiresAt = process.env.CLOUDFLARE_VERSION_ATTESTATION_EXPIRES_AT;
const { receipt: artifact, artifactSha256 } = await validateArtifactDirectory(artifactDirectory);
let uploadResult;
let evidence;
try {
  uploadResult = JSON.parse(await readFile(uploadResultPath, 'utf8'));
  evidence = JSON.parse(await readFile(versionDetailPath, 'utf8'));
} catch { throw new Error('CLOUDFLARE_E_ATTEST_INPUT'); }
validateVersionUploadResult(uploadResult, { artifactSha256 });
const evidenceKeys = ['schemaVersion', 'contract', 'artifactSha256', 'versionId', 'workerName',
  'environment', 'commandSha256', 'rawStdoutSha256', 'rawStdout', 'startedAt', 'completedAt', 'detail'];
if (!evidence || Object.keys(evidence).length !== evidenceKeys.length
  || Object.keys(evidence).some((key) => !evidenceKeys.includes(key))
  || evidence.schemaVersion !== 1 || evidence.contract !== 'dwnc-cloudflare-version-detail-evidence-v1'
  || evidence.artifactSha256 !== artifactSha256 || evidence.versionId !== uploadResult.versionId
  || evidence.workerName !== 'dwnc-me' || evidence.environment !== 'production'
  || !/^[a-f0-9]{64}$/u.test(evidence.commandSha256 ?? '')
  || !/^[a-f0-9]{64}$/u.test(evidence.rawStdoutSha256 ?? '')
  || typeof evidence.rawStdout !== 'string'
  || Number.isNaN(Date.parse(evidence.startedAt ?? ''))
  || Number.isNaN(Date.parse(evidence.completedAt ?? ''))
  || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)
  || Date.parse(evidence.completedAt) - Date.parse(evidence.startedAt) > 60000) {
  throw new Error('CLOUDFLARE_E_ATTEST_EVIDENCE');
}
let parsedRawDetail;
try { parsedRawDetail = JSON.parse(evidence.rawStdout); }
catch { throw new Error('CLOUDFLARE_E_ATTEST_EVIDENCE'); }
if (sha256Hex(evidence.rawStdout) !== evidence.rawStdoutSha256
  || canonicalJson(parsedRawDetail) !== canonicalJson(evidence.detail)) {
  throw new Error('CLOUDFLARE_E_ATTEST_EVIDENCE');
}
const expectedViewArguments = [
  'versions', 'view', uploadResult.versionId, '--json', '--env', 'production',
  '--config', path.join(artifactDirectory, 'wrangler-upload.jsonc'),
  '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
];
if (evidence.commandSha256 !== sha256Hex(canonicalJson(expectedViewArguments))) {
  throw new Error('CLOUDFLARE_E_ATTEST_EVIDENCE');
}
const attestation = createVersionAttestationFromDetail({
  artifact, uploadResult, detail: evidence.detail, now: createdAt, expiresAt,
});
await writeCanonicalEvidenceCreateOnly(outputPath, attestation, canonicalVersionAttestationPayload);
console.log(JSON.stringify({
  contract: attestation.contract,
  artifactSha256,
  versionId: attestation.versionId,
  versionDetailBound: true,
  signed: false,
  signingRequiredBeforePromotion: true,
  trafficChanged: false,
}, null, 2));
