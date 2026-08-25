import assert from 'node:assert/strict';
import {
  bootstrapArguments,
  bootstrapConfig,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  canonicalBootstrapAttestationPayload,
  canonicalBootstrapAuthorizationPayload,
  canonicalServiceExistenceCapturePayload,
  canonicalServiceExistenceEvidencePayload,
  createBootstrapPromotionBaseline,
  fetchServiceExistenceCapture,
  parseBootstrapDeployNdjson,
  serviceExistenceRequestSha256,
  validateBootstrapAttestation,
  validateBootstrapAuthorization,
  validateServiceExistenceCapture,
  validateServiceExistenceEvidence,
} from './lib/cloudflare-bootstrap.mjs';
import { sha256Hex } from './lib/cloudflare-release.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';

let assertions = 0;
const now = new Date('2026-08-25T00:02:00.000Z');
const accountId = 'a'.repeat(32);
for (const environment of ['production', 'staging']) {
  const workerName = environment === 'production' ? 'dwnc-me' : 'dwnc-me-staging';
  const evidence = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-service-existence-v1', environment,
    workerName, accountIdSha256: cloudflareAccountIdSha256(accountId), exists: false, httpStatus: 404,
    rawEvidenceSha256: 'b'.repeat(64), observedAt: '2026-08-25T00:00:00.000Z',
    expiresAt: '2026-08-25T00:05:00.000Z',
  };
  validateServiceExistenceEvidence(evidence, { now }); assertions += 1;
  assert.throws(() => validateServiceExistenceEvidence({ ...evidence, exists: true }, { now }),
    /CLOUDFLARE_E_SERVICE_EXISTENCE/u); assertions += 1;
  const capture = await fetchServiceExistenceCapture({
    environment, accountId, apiToken: 'fixture-token', now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({
      success: false, result: null, errors: [{ code: 10007, message: 'not found' }],
    }), { status: 404 }),
  });
  validateServiceExistenceCapture(capture, {
    expected: { environment, workerName, accountIdSha256: evidence.accountIdSha256, exists: false }, now,
  }); assertions += 1;
  assert.throws(() => validateServiceExistenceCapture({
    ...capture, rawBody: JSON.stringify({ success: false, result: null, errors: [{ code: 99999 }] }),
  }, { now }), /CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE/u); assertions += 1;
  assert.equal(capture.requestSha256, serviceExistenceRequestSha256({
    environment, accountIdSha256: evidence.accountIdSha256,
  })); assertions += 1;
  await assert.rejects(() => fetchServiceExistenceCapture({
    environment, accountId, apiToken: 'fixture-token', now: () => now,
    fetchImpl: async () => new Response('<html>not found</html>', { status: 404 }),
  }), /CLOUDFLARE_E_SERVICE_EXISTENCE_RESPONSE/u); assertions += 1;
  const existsCapture = await fetchServiceExistenceCapture({
    environment, accountId, apiToken: 'fixture-token', now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({ success: true, result: { id: workerName }, errors: [] }),
      { status: 200 }),
  });
  assert.equal(existsCapture.evidence.exists, true); assertions += 1;
  const authorization = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-bootstrap-authorization-v1', environment,
    workerName, accountIdSha256: evidence.accountIdSha256, sourceGitSha: '1'.repeat(40),
    denyWorkerSha256: bootstrapDenyWorkerSha256(), bootstrapConfigSha256: bootstrapConfigSha256(environment),
    serviceEvidenceSha256: sha256Hex(canonicalServiceExistenceEvidencePayload(evidence)),
    freshAbsenceRequired: true,
    freshAbsenceRequestSha256: capture.requestSha256,
    maxFreshAbsenceAgeSeconds: 15,
    buildUuid: '12345678-1234-4123-8123-123456789abc', nonceSha256: 'c'.repeat(64),
    createdAt: '2026-08-25T00:00:00.000Z', expiresAt: '2026-08-25T00:10:00.000Z',
  };
  validateBootstrapAuthorization(authorization, { now }); assertions += 1;
  const authorizationSha256 = sha256Hex(canonicalBootstrapAuthorizationPayload(authorization));
  const args = bootstrapArguments({ environment, directory: '/tmp/dwnc-bootstrap', authorizationSha256 });
  assert.equal(args.includes('--no-bundle'), true); assertions += 1;
  assert.equal(args.includes('--x-provision=false'), true); assertions += 1;
  const output = `${JSON.stringify({
    type: 'wrangler-session', version: 1, wrangler_version: '4.125.0',
    command_line_args: args, log_file_path: null, timestamp: '2026-08-25T00:01:00.000Z',
  })}\n${JSON.stringify({
    type: 'deploy', version: 1, worker_name: workerName, worker_tag: null,
    version_id: '22345678-1234-4123-8123-123456789abc', targets: [],
    wrangler_environment: undefined, worker_name_overridden: false,
    timestamp: '2026-08-25T00:01:01.000Z',
  })}\n`;
  const event = parseBootstrapDeployNdjson(output, { environment, expectedArguments: args });
  assert.equal(event.targets.length, 0); assertions += 1;
  const attestation = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-deny-bootstrap-attestation-v1', environment,
    workerName, accountIdSha256: evidence.accountIdSha256, sourceGitSha: authorization.sourceGitSha,
    versionId: event.version_id, denyWorkerSha256: authorization.denyWorkerSha256,
    bootstrapConfigSha256: authorization.bootstrapConfigSha256,
    serviceEvidenceSha256: authorization.serviceEvidenceSha256,
    freshAbsenceCaptureSha256: sha256Hex(canonicalServiceExistenceCapturePayload(capture)),
    deploymentOutputSha256: sha256Hex(output), versionDetailSha256: 'd'.repeat(64),
    deploymentStatusSha256: 'e'.repeat(64), denyScriptVerified: true, bindingsEmpty: true,
    assetsAbsent: true, externalSurfaceCount: 0, deployment100: true,
    attestedAt: '2026-08-25T00:02:00.000Z',
  };
  validateBootstrapAttestation(attestation); assertions += 1;
  assert.equal(canonicalBootstrapAttestationPayload(attestation).includes('private'), false); assertions += 1;
  if (environment === 'production') {
    const baseline = createBootstrapPromotionBaseline(attestation);
    assert.equal(baseline.generation, 0); assertions += 1;
    assert.equal(baseline.versionId, attestation.versionId); assertions += 1;
  }
  const config = bootstrapConfig(environment);
  assert.equal(config.workers_dev, false); assertions += 1;
  assert.equal('routes' in config || 'assets' in config || 'r2_buckets' in config, false); assertions += 1;
}
console.log(JSON.stringify({
  suite: 'cloudflare-deny-bootstrap', assertions,
  productionAndStaging: true, externalSurfaceCount: 0,
  liveNetworkCalls: 0, deploymentAttempts: 0, status: 'PASS',
}, null, 2));
