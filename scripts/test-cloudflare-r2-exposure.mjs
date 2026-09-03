import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalR2ExposureCapturePayload,
  canonicalR2ExposureEvidencePayload,
  fetchR2ExposureCapture,
  r2ExposureRequestAudit,
  remoteReceiptBucketExposure,
  STAGING_R2_EXPOSURE_BUCKET,
  STAGING_R2_EXPOSURE_PURPOSE,
  validateR2ExposureCapture,
  validateR2ExposureEvidence,
  validateR2ExposureRequestAudit,
} from './lib/cloudflare-r2-exposure.mjs';
import {
  parseStagingR2ExposureCommand,
  parseStagingR2ExposureRecoveryCommand,
  runStagingR2ExposureCommand,
  runStagingR2ExposureRecoveryCommand,
  STAGING_R2_EXPOSURE_RECOVERY_PURPOSE,
} from './lib/cloudflare-r2-exposure-command.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';

const accountId = 'a'.repeat(32);
const apiToken = 'synthetic-control-plane-token-1234567890';
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const environment = 'staging';
const bucket = STAGING_R2_EXPOSURE_BUCKET;
const sourceCommit = 'c'.repeat(40);
const sourceTree = 'd'.repeat(40);
const now = new Date('2026-08-27T05:30:00.000Z');
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const throws = (action, code) => {
  assert.throws(action, (error) => error?.message === code);
  assertions += 1;
};
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.message === code);
  assertions += 1;
};
const rejectsPrefix = async (action, code) => {
  await assert.rejects(action, (error) => error?.message?.startsWith(code));
  assertions += 1;
};

function cloudflareEnvelope(result) {
  return { success: true, errors: [], messages: [], result };
}

function createFixture({
  bucketResult = {}, managedResult = {}, customResult = {}, status = 200,
  networkErrorAt = 0, rawBodyAt = {}, gitSnapshots = null,
} = {}) {
  const calls = [];
  let gitChecks = 0;
  const bucketBody = cloudflareEnvelope({
    name: bucket,
    creation_date: '2026-08-27T00:00:00.000Z',
    jurisdiction: 'default',
    location: 'APAC',
    storage_class: 'Standard',
    ...bucketResult,
  });
  const managedBody = cloudflareEnvelope({
    enabled: false,
    domain: 'not-reported.example.invalid',
    ...managedResult,
  });
  const customBody = cloudflareEnvelope({ domains: [], ...customResult });
  return {
    calls,
    gitCheckCount: () => gitChecks,
    inspectGit: async () => {
      const snapshot = gitSnapshots?.[gitChecks]
        ?? { commit: sourceCommit, tree: sourceTree, clean: true };
      gitChecks += 1;
      return snapshot;
    },
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        authorization: init.headers.authorization,
        jurisdiction: init.headers['cf-r2-jurisdiction'],
        redirect: init.redirect,
        body: init.body,
      });
      if (networkErrorAt === calls.length) throw new Error(`${apiToken}:${accountId}`);
      const index = calls.length - 1;
      const body = Object.hasOwn(rawBodyAt, index)
        ? rawBodyAt[index]
        : JSON.stringify([bucketBody, managedBody, customBody][index]);
      return new Response(body, { status: Array.isArray(status) ? status[index] : status });
    },
  };
}

function baseOptions(fixture, overrides = {}) {
  return {
    purpose: STAGING_R2_EXPOSURE_PURPOSE,
    environment,
    bucket,
    accountId,
    expectedAccountIdSha256: accountIdSha256,
    apiToken,
    expectedGitCommit: sourceCommit,
    expectedGitTree: sourceTree,
    inspectGit: fixture.inspectGit,
    fetchImpl: fixture.fetchImpl,
    now: () => now,
    ...overrides,
  };
}

const validFixture = createFixture();
const capture = await fetchR2ExposureCapture(baseOptions(validFixture));
equal(validFixture.calls.length, 3);
equal(validFixture.gitCheckCount(), 3);
equal(validFixture.calls.map((call) => call.method), ['GET', 'GET', 'GET']);
equal(validFixture.calls.every((call) => call.authorization === `Bearer ${apiToken}`), true);
equal(validFixture.calls.every((call) => call.jurisdiction === 'default'), true);
equal(validFixture.calls.every((call) => call.redirect === 'error' && call.body === undefined), true);
equal(validFixture.calls.map((call) => new URL(call.url).pathname), [
  `/client/v4/accounts/${accountId}/r2/buckets/${bucket}`,
  `/client/v4/accounts/${accountId}/r2/buckets/${bucket}/domains/managed`,
  `/client/v4/accounts/${accountId}/r2/buckets/${bucket}/domains/custom`,
]);
validateR2ExposureCapture(capture, {
  expected: {
    purpose: STAGING_R2_EXPOSURE_PURPOSE,
    environment,
    bucket,
    accountIdSha256,
    sourceCommit,
    sourceTree,
  },
  now,
});
assertions += 1;
equal(capture.evidence.gitCheckCount, 3);
equal(capture.evidence.location, 'apac');
equal(capture.evidence.storageClass, 'Standard');
equal(capture.evidence.requestAudit, r2ExposureRequestAudit());
equal(capture.evidence.requestAudit.methods,
  { GET: 3, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 });
const exposure = remoteReceiptBucketExposure(capture, {
  expected: { environment, bucket, accountIdSha256 }, now,
});
equal(exposure.verification, 'cloudflare-control-plane');
equal(exposure.jurisdiction, 'default');
equal(exposure.location, 'apac');
equal(exposure.storageClass, 'Standard');
equal(exposure.r2DevEnabled, false);
equal(exposure.customDomainCount, 0);
equal(exposure.evidenceSha256.length, 64);
const canonicalEvidence = canonicalR2ExposureEvidencePayload(capture.evidence);
equal(canonicalEvidence.includes(accountId), false);
equal(canonicalEvidence.includes(apiToken), false);
equal(canonicalEvidence.includes('api.cloudflare.com'), false);
const exposureBoundAtAuditStart = remoteReceiptBucketExposure(capture, {
  expected: { environment, bucket, accountIdSha256 },
  now: new Date(Date.parse(capture.evidence.expiresAt) - 1),
});
equal(exposureBoundAtAuditStart.evidenceSha256, exposure.evidenceSha256);
throws(() => remoteReceiptBucketExposure(capture, {
  expected: { environment, bucket, accountIdSha256 },
  now: new Date(capture.evidence.expiresAt),
}), 'CLOUDFLARE_E_R2_EXPOSURE_EXPIRED');

for (const [overrides, code] of [
  [{ purpose: 'production-r2-private-exposure-read' }, 'CLOUDFLARE_E_R2_EXPOSURE_REQUEST'],
  [{ environment: 'production' }, 'CLOUDFLARE_E_R2_EXPOSURE_REQUEST'],
  [{ bucket: 'dwnc-me-public-media-production' }, 'CLOUDFLARE_E_R2_EXPOSURE_REQUEST'],
  [{ expectedAccountIdSha256: '0'.repeat(64) }, 'CLOUDFLARE_E_R2_EXPOSURE_REQUEST'],
]) {
  const fixture = createFixture();
  await rejects(() => fetchR2ExposureCapture(baseOptions(fixture, overrides)), code);
  equal(fixture.calls.length, 0);
}

for (const [bucketResult, code] of [
  [{ jurisdiction: 'eu' }, 'CLOUDFLARE_E_R2_EXPOSURE_RESPONSE'],
  [{ location: 'ENAM' }, 'CLOUDFLARE_E_R2_EXPOSURE_EXPECTED'],
  [{ storage_class: 'InfrequentAccess' }, 'CLOUDFLARE_E_R2_EXPOSURE_EXPECTED'],
  [{ creation_date: null }, 'CLOUDFLARE_E_R2_EXPOSURE_RESPONSE'],
]) {
  const fixture = createFixture({ bucketResult });
  await rejects(() => fetchR2ExposureCapture(baseOptions(fixture)), code);
  equal(fixture.calls.length, 1);
}

for (const fixtureOptions of [
  { managedResult: { enabled: true } },
  { customResult: { domains: [{ domain: 'public.example' }] } },
]) {
  const fixture = createFixture(fixtureOptions);
  await rejects(() => fetchR2ExposureCapture(baseOptions(fixture)),
    'CLOUDFLARE_E_R2_EXPOSURE_PUBLIC');
  equal(fixture.calls.length, 3);
}

for (const rawBodyAt of [
  { 0: '{' },
  { 1: JSON.stringify(cloudflareEnvelope({})) },
  { 2: JSON.stringify(cloudflareEnvelope({ domains: null })) },
]) {
  const fixture = createFixture({ rawBodyAt });
  await rejects(() => fetchR2ExposureCapture(baseOptions(fixture)),
    'CLOUDFLARE_E_R2_EXPOSURE_RESPONSE');
}

for (const failure of [
  { status: [500, 200, 200] },
  { networkErrorAt: 1 },
]) {
  const fixture = createFixture(failure);
  await rejects(() => fetchR2ExposureCapture(baseOptions(fixture)),
    'CLOUDFLARE_E_R2_EXPOSURE_FETCH');
  equal(fixture.calls.length, 1);
  equal(fixture.gitCheckCount(), 1);
}

function createOversizedResponse({ status = 200, maximumChunks = null } = {}) {
  const chunkBytes = 64 * 1024;
  const stats = { pulls: 0, producedBytes: 0, cancelCalls: 0, closed: false };
  const body = new ReadableStream({
    type: 'bytes',
    pull(controller) {
      stats.pulls += 1;
      const remaining = maximumChunks === null
        ? Number.POSITIVE_INFINITY : maximumChunks * chunkBytes - stats.producedBytes;
      if (remaining <= 0) {
        stats.closed = true;
        controller.close();
        return;
      }
      const request = controller.byobRequest;
      const count = Math.min(chunkBytes, remaining, request?.view.byteLength ?? chunkBytes);
      if (request) {
        request.view.subarray(0, count).fill(0x61);
        request.respond(count);
      } else {
        controller.enqueue(new Uint8Array(count).fill(0x61));
      }
      stats.producedBytes += count;
      if (maximumChunks !== null && stats.producedBytes >= maximumChunks * chunkBytes) {
        stats.closed = true;
        controller.close();
      }
    },
    cancel() { stats.cancelCalls += 1; },
  }, { highWaterMark: 0 });
  return { response: new Response(body, { status }), stats };
}

for (const oversized of [
  createOversizedResponse(),
  createOversizedResponse({ status: 500, maximumChunks: 128 }),
]) {
  const fixture = createFixture();
  let fetchCalls = 0;
  await rejects(() => fetchR2ExposureCapture(baseOptions(fixture, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return oversized.response;
    },
  })), 'CLOUDFLARE_E_R2_EXPOSURE_FETCH');
  equal(fetchCalls, 1);
  equal(oversized.stats.cancelCalls, 1);
  equal(oversized.stats.closed, false);
  equal(oversized.stats.producedBytes <= 1024 * 1024 + 1, true);
}

const malformedUtf8Fixture = createFixture();
let malformedUtf8Calls = 0;
await rejects(() => fetchR2ExposureCapture(baseOptions(malformedUtf8Fixture, {
  fetchImpl: async () => {
    malformedUtf8Calls += 1;
    return new Response(new Uint8Array([0xc3, 0x28]), { status: 200 });
  },
})), 'CLOUDFLARE_E_R2_EXPOSURE_FETCH');
equal(malformedUtf8Calls, 1);

const afterRequestDrift = createFixture({
  gitSnapshots: [
    { commit: sourceCommit, tree: sourceTree, clean: true },
    { commit: 'e'.repeat(40), tree: sourceTree, clean: true },
  ],
});
await rejects(() => fetchR2ExposureCapture(baseOptions(afterRequestDrift)),
  'CLOUDFLARE_E_R2_EXPOSURE_GIT');
equal(afterRequestDrift.calls.length, 3);
equal(afterRequestDrift.gitCheckCount(), 2);

const receiptDrift = createFixture({
  gitSnapshots: [
    { commit: sourceCommit, tree: sourceTree, clean: true },
    { commit: sourceCommit, tree: sourceTree, clean: true },
    { commit: sourceCommit, tree: sourceTree, clean: false },
  ],
});
await rejects(() => fetchR2ExposureCapture(baseOptions(receiptDrift)),
  'CLOUDFLARE_E_R2_EXPOSURE_GIT');
equal(receiptDrift.calls.length, 3);
equal(receiptDrift.gitCheckCount(), 3);

const leakingFailure = createFixture({ networkErrorAt: 1 });
try { await fetchR2ExposureCapture(baseOptions(leakingFailure)); }
catch (error) {
  equal(error.message, 'CLOUDFLARE_E_R2_EXPOSURE_FETCH');
  equal(JSON.stringify(error).includes(apiToken), false);
  equal(JSON.stringify(error).includes(accountId), false);
}

const writeAudit = r2ExposureRequestAudit();
writeAudit.requests[1] = { ...writeAudit.requests[1], method: 'POST' };
writeAudit.methods = { ...writeAudit.methods, GET: 2, POST: 1 };
throws(() => validateR2ExposureRequestAudit(writeAudit),
  'CLOUDFLARE_E_R2_EXPOSURE_METHODS');
const retryAudit = r2ExposureRequestAudit();
retryAudit.attempts = 2;
retryAudit.requests[2] = { ...retryAudit.requests[2], attempt: 2 };
throws(() => validateR2ExposureRequestAudit(retryAudit),
  'CLOUDFLARE_E_R2_EXPOSURE_METHODS');
throws(() => validateR2ExposureCapture({
  ...capture,
  evidence: { ...capture.evidence, location: 'enam' },
}, { now }), 'CLOUDFLARE_E_R2_EXPOSURE');
throws(() => validateR2ExposureEvidence({ ...capture.evidence, r2DevEnabled: true }, { now }),
  'CLOUDFLARE_E_R2_EXPOSURE_PUBLIC');
throws(() => validateR2ExposureEvidence(capture.evidence, {
  expected: { bucket: 'wrong-bucket' }, now,
}), 'CLOUDFLARE_E_R2_EXPOSURE_EXPECTED');
throws(() => validateR2ExposureEvidence(capture.evidence, {
  now: new Date('2026-08-27T05:45:00.000Z'),
}), 'CLOUDFLARE_E_R2_EXPOSURE_EXPIRED');

const commandDirectory = await realpath(await mkdtemp(path.join(
  os.tmpdir(), 'dwnc-r2-exposure-command-',
)));
await chmod(commandDirectory, 0o700);
const commandEnvironment = {
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN_FD: '3',
  CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(commandDirectory, 'capture.json'),
  CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(commandDirectory, 'evidence.json'),
  CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT: sourceCommit,
  CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE: sourceTree,
};
const commandArgv = [`--purpose=${STAGING_R2_EXPOSURE_PURPOSE}`];
const syntheticPolicy = {
  staging: { environment: 'staging', bucket, accountIdSha256 },
};
const parsedCommand = parseStagingR2ExposureCommand({
  argv: commandArgv, environment: commandEnvironment, root: process.cwd(),
});
equal(parsedCommand.purpose, STAGING_R2_EXPOSURE_PURPOSE);
let credentialReads = 0;
const summary = await runStagingR2ExposureCommand({
  argv: commandArgv,
  environment: commandEnvironment,
  root: process.cwd(),
  readCredentials: () => {
    credentialReads += 1;
    return { accountId, apiToken };
  },
  loadPolicy: async () => syntheticPolicy,
  fetchCapture: async () => capture,
});
equal(credentialReads, 1);
equal(summary.accountIdSha256, accountIdSha256);
equal(summary.requestAudit.methods,
  { GET: 3, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 });
equal(JSON.stringify(summary).includes(accountId), false);
equal(JSON.stringify(summary).includes(apiToken), false);
equal(JSON.stringify(summary).includes('not-reported.example.invalid'), false);
equal(JSON.stringify(summary).includes('api.cloudflare.com'), false);
equal((await lstat(commandEnvironment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH)).mode & 0o777, 0o600);
equal((await lstat(commandEnvironment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH)).mode & 0o777, 0o600);
equal((await readFile(commandEnvironment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH, 'utf8'))
  .includes(accountId), false);

const failureCases = [
  { name: 'preexisting', prepare: async (directory, env) => {
    await writeFile(env.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH, 'existing\n', { mode: 0o600 });
  } },
  { name: 'symlink', prepare: async (directory, env) => {
    const target = path.join(directory, 'target');
    await writeFile(target, 'target\n', { mode: 0o600 });
    await symlink(target, env.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH);
  } },
  { name: 'bad-mode', mode: 0o755 },
];
for (const failureCase of failureCases) {
  const directory = await realpath(await mkdtemp(path.join(
    os.tmpdir(), `dwnc-r2-exposure-${failureCase.name}-`,
  )));
  await chmod(directory, failureCase.mode ?? 0o700);
  const environmentForFailure = {
    ...commandEnvironment,
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(directory, 'capture.json'),
    CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(directory, 'evidence.json'),
  };
  await failureCase.prepare?.(directory, environmentForFailure);
  let reads = 0;
  let fetches = 0;
  await rejectsPrefix(() => runStagingR2ExposureCommand({
    argv: commandArgv,
    environment: environmentForFailure,
    root: process.cwd(),
    readCredentials: () => { reads += 1; return { accountId, apiToken }; },
    loadPolicy: async () => syntheticPolicy,
    fetchCapture: async () => { fetches += 1; return capture; },
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  equal(reads, 0);
  equal(fetches, 0);
  await rm(directory, { recursive: true, force: true });
}

const noReceiptDirectory = await realpath(await mkdtemp(path.join(
  os.tmpdir(), 'dwnc-r2-exposure-no-receipt-',
)));
await chmod(noReceiptDirectory, 0o700);
const noReceiptEnvironment = {
  ...commandEnvironment,
  CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(noReceiptDirectory, 'capture.json'),
  CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(noReceiptDirectory, 'evidence.json'),
};
await rejects(() => runStagingR2ExposureCommand({
  argv: commandArgv,
  environment: noReceiptEnvironment,
  root: process.cwd(),
  readCredentials: () => ({ accountId, apiToken }),
  loadPolicy: async () => syntheticPolicy,
  fetchCapture: async () => { throw new Error('CLOUDFLARE_E_R2_EXPOSURE_GIT'); },
}), 'CLOUDFLARE_E_R2_EXPOSURE_GIT');
for (const output of [
  noReceiptEnvironment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH,
  noReceiptEnvironment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH,
]) {
  await assert.rejects(() => lstat(output), (error) => error?.code === 'ENOENT');
  assertions += 1;
}

const recoveryArgv = [`--purpose=${STAGING_R2_EXPOSURE_RECOVERY_PURPOSE}`];
const recoveryNow = new Date('2026-08-27T05:35:00.000Z');
const recoveryGitSnapshot = { commit: sourceCommit, tree: sourceTree, clean: true };
const recoveryDirectories = [];
for (const failedOutput of ['capture', 'evidence']) {
  const directory = await realpath(await mkdtemp(path.join(
    os.tmpdir(), `dwnc-r2-exposure-recover-${failedOutput}-`,
  )));
  recoveryDirectories.push(directory);
  await chmod(directory, 0o700);
  const initialEnvironment = {
    ...commandEnvironment,
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(directory, 'capture.json'),
    CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(directory, 'evidence.json'),
  };
  let initialCredentialReads = 0;
  let initialApiCalls = 0;
  let outputWrites = 0;
  const failureCode = failedOutput === 'capture'
    ? 'TEST_E_CAPTURE_OUTPUT_UNCERTAIN' : 'TEST_E_EVIDENCE_OUTPUT_FAILED';
  await rejects(() => runStagingR2ExposureCommand({
    argv: commandArgv,
    environment: initialEnvironment,
    root: process.cwd(),
    readCredentials: () => {
      initialCredentialReads += 1;
      return { accountId, apiToken };
    },
    loadPolicy: async () => syntheticPolicy,
    fetchCapture: async () => { initialApiCalls += 1; return capture; },
    writeEvidence: async (...args) => {
      outputWrites += 1;
      if (failedOutput === 'capture') {
        await writeCanonicalEvidenceCreateOnly(...args);
        throw new Error(failureCode);
      }
      if (outputWrites === 2) throw new Error(failureCode);
      await writeCanonicalEvidenceCreateOnly(...args);
    },
  }), failureCode);
  equal(initialCredentialReads, 1);
  equal(initialApiCalls, 1);
  equal(outputWrites, failedOutput === 'capture' ? 1 : 2);
  const beforeRecoveryCapture = await readFile(
    initialEnvironment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH,
  );
  await assert.rejects(
    () => lstat(initialEnvironment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH),
    (error) => error?.code === 'ENOENT',
  );
  assertions += 1;
  const recoveryEnvironment = {
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH:
      initialEnvironment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH,
    CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH:
      initialEnvironment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH,
    CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT: sourceCommit,
    CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE: sourceTree,
  };
  const parsedRecovery = parseStagingR2ExposureRecoveryCommand({
    argv: recoveryArgv, environment: recoveryEnvironment, root: process.cwd(),
  });
  equal(parsedRecovery.purpose, STAGING_R2_EXPOSURE_RECOVERY_PURPOSE);
  const recovered = await runStagingR2ExposureRecoveryCommand({
    argv: recoveryArgv,
    environment: recoveryEnvironment,
    root: process.cwd(),
    loadPolicy: async () => syntheticPolicy,
    inspectGit: async () => recoveryGitSnapshot,
    now: () => recoveryNow,
  });
  equal(recovered.credentialReads, 0);
  equal(recovered.apiRequests, 0);
  equal(recovered.captureReused, true);
  equal(recovered.receiptWritten, true);
  equal(initialCredentialReads, 1);
  equal(initialApiCalls, 1);
  equal(await readFile(initialEnvironment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH),
    beforeRecoveryCapture);
  equal((await lstat(initialEnvironment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH)).mode & 0o777,
    0o600);
  equal(JSON.stringify(recovered).includes(accountId), false);
  equal(JSON.stringify(recovered).includes(apiToken), false);
}

async function createRecoveryFixture(name, capturePayload = capture, {
  createEvidence = false,
} = {}) {
  const directory = await realpath(await mkdtemp(path.join(
    os.tmpdir(), `dwnc-r2-exposure-recovery-negative-${name}-`,
  )));
  recoveryDirectories.push(directory);
  await chmod(directory, 0o700);
  const environmentForRecovery = {
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(directory, 'capture.json'),
    CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(directory, 'evidence.json'),
    CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT: sourceCommit,
    CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE: sourceTree,
  };
  await writeCanonicalEvidenceCreateOnly(
    environmentForRecovery.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH,
    capturePayload,
    capturePayload.contract === capture.contract
      ? canonicalR2ExposureCapturePayload : canonicalR2ExposureEvidencePayload,
  );
  if (createEvidence) {
    await writeCanonicalEvidenceCreateOnly(
      environmentForRecovery.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH,
      capture.evidence,
      canonicalR2ExposureEvidencePayload,
    );
  }
  return environmentForRecovery;
}

const tamperedCaptureEnvironment = await createRecoveryFixture('tampered', {
  ...capture,
  managedRawBody: capture.managedRawBody.replace('false', 'true'),
});
await rejects(() => runStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: tamperedCaptureEnvironment,
  root: process.cwd(),
  loadPolicy: async () => syntheticPolicy,
  inspectGit: async () => recoveryGitSnapshot,
  now: () => recoveryNow,
}), 'CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');

const expiredCaptureEnvironment = await createRecoveryFixture('expired');
await rejects(() => runStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: expiredCaptureEnvironment,
  root: process.cwd(),
  loadPolicy: async () => syntheticPolicy,
  inspectGit: async () => recoveryGitSnapshot,
  now: () => new Date(capture.evidence.expiresAt),
}), 'CLOUDFLARE_E_R2_EXPOSURE_EXPIRED');

const wrongGitEnvironment = await createRecoveryFixture('wrong-git');
await rejects(() => runStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: wrongGitEnvironment,
  root: process.cwd(),
  loadPolicy: async () => syntheticPolicy,
  inspectGit: async () => ({ ...recoveryGitSnapshot, commit: 'e'.repeat(40) }),
  now: () => recoveryNow,
}), 'CLOUDFLARE_E_R2_EXPOSURE_GIT');

const wrongCaptureEnvironment = await createRecoveryFixture('wrong-capture', capture.evidence);
await rejects(() => runStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: wrongCaptureEnvironment,
  root: process.cwd(),
  loadPolicy: async () => syntheticPolicy,
  inspectGit: async () => recoveryGitSnapshot,
  now: () => recoveryNow,
}), 'CLOUDFLARE_E_R2_EXPOSURE_CAPTURE');

const wrongAccountEnvironment = await createRecoveryFixture('wrong-account');
await rejects(() => runStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: wrongAccountEnvironment,
  root: process.cwd(),
  loadPolicy: async () => ({
    staging: { ...syntheticPolicy.staging, accountIdSha256: '0'.repeat(64) },
  }),
  inspectGit: async () => recoveryGitSnapshot,
  now: () => recoveryNow,
}), 'CLOUDFLARE_E_R2_EXPOSURE_EXPECTED');

const wrongBucketEnvironment = await createRecoveryFixture('wrong-bucket');
await rejects(() => runStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: wrongBucketEnvironment,
  root: process.cwd(),
  loadPolicy: async () => ({
    staging: { ...syntheticPolicy.staging, bucket: 'dwnc-me-public-media-wrong' },
  }),
  inspectGit: async () => recoveryGitSnapshot,
  now: () => recoveryNow,
}), 'CLOUDFLARE_E_R2_EXPOSURE_TARGET');

const preexistingEvidenceEnvironment = await createRecoveryFixture(
  'preexisting-evidence', capture, { createEvidence: true },
);
await rejectsPrefix(() => runStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: preexistingEvidenceEnvironment,
  root: process.cwd(),
  loadPolicy: async () => syntheticPolicy,
  inspectGit: async () => recoveryGitSnapshot,
  now: () => recoveryNow,
}), 'CLOUDFLARE_E_SIGNING_FILE');

throws(() => parseStagingR2ExposureRecoveryCommand({
  argv: recoveryArgv,
  environment: {
    CLOUDFLARE_API_TOKEN: apiToken,
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: commandEnvironment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH,
    CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: commandEnvironment.CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH,
    CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT: sourceCommit,
    CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE: sourceTree,
  },
  root: process.cwd(),
}), 'CLOUDFLARE_E_R2_EXPOSURE_RECOVERY_ARGUMENT');

throws(() => parseStagingR2ExposureCommand({
  argv: [`--purpose=${apiToken}`], environment: commandEnvironment, root: process.cwd(),
}), 'CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
throws(() => parseStagingR2ExposureCommand({
  argv: commandArgv,
  environment: {
    ...commandEnvironment,
    CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH:
      commandEnvironment.CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH,
  },
  root: process.cwd(),
}), 'CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');
throws(() => parseStagingR2ExposureCommand({
  argv: commandArgv,
  environment: {
    ...commandEnvironment,
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(process.cwd(), 'capture.json'),
    CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(process.cwd(), 'evidence.json'),
  },
  root: process.cwd(),
}), 'CLOUDFLARE_E_R2_EXPOSURE_ARGUMENT');

await rm(commandDirectory, { recursive: true, force: true });
await rm(noReceiptDirectory, { recursive: true, force: true });
for (const directory of recoveryDirectories) {
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  suite: 'cloudflare-r2-private-exposure',
  assertions,
  expectedRequests: { GET: 3, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 },
  credentialFdReads: 1,
  recoveryCredentialReads: 0,
  recoveryApiRequests: 0,
  liveNetworkCalls: 0,
  mutations: 0,
  status: 'PASS',
}, null, 2));
