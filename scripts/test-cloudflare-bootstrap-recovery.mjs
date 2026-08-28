import assert from 'node:assert/strict';
import { mkdir, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  bootstrapArguments,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  canonicalAccountWorkersDevSubdomainCapturePayload,
  canonicalServiceExistenceCapturePayload,
  defaultBootstrapProtectedEvidencePaths,
  DENY_ALL_WORKER_SOURCE,
  fetchAccountWorkersDevSubdomainCapture,
  fetchServiceExistenceCapture,
} from './lib/cloudflare-bootstrap.mjs';
import {
  bootstrapPreparedSha256,
  bootstrapStartedSha256,
  inspectExistingBootstrapRecoveryStatus,
  normalizeBootstrapWranglerResult,
  recoverBootstrapStatusCore,
} from './lib/cloudflare-bootstrap-recovery.mjs';
import {
  bootstrapInstantMilliseconds,
  canonicalBootstrapPreparedRecord,
  canonicalBootstrapResultRecord,
  canonicalBootstrapStartedRecord,
  validateBootstrapResultRecord,
  validateBootstrapStatusRecord,
} from './lib/cloudflare-bootstrap-attempt.mjs';
import { assertCloudflareAccountTargetOutsideRepository }
  from './lib/cloudflare-account-target.mjs';
import { claimOneTimeAuthorization } from './lib/cloudflare-process.mjs';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
const accountId = 'a'.repeat(32);
const apiToken = 'synthetic-token-never-store';
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const authorizationSha256 = '4'.repeat(64);
const sourceGitSha = '1'.repeat(40);
const sourceGitTree = '2'.repeat(40);
const metadataSha256 = '5'.repeat(64);
const preflightSha256 = '6'.repeat(64);
const permissionSha256 = '7'.repeat(64);
const versionIds = [
  '22345678-1234-4123-8123-123456789abc',
  '42345678-1234-4123-8123-123456789abc',
];
const deploymentIds = [
  '32345678-1234-4123-8123-123456789abc',
  '52345678-1234-4123-8123-123456789abc',
];
const pagedVersionIds = Array.from({ length: 501 }, (_, index) => {
  const suffix = (index + 1).toString(16).padStart(12, '0');
  return `62345678-1234-4123-8123-${suffix}`;
});
const expectedTag = `dwnc-bootstrap-${authorizationSha256.slice(0, 24)}`;
const expectedMessage = `dwnc-deny-bootstrap:${authorizationSha256}`;
const multipartBoundary = 'dwnc-recovery-fixture';
const multipart = Buffer.from(
  `--${multipartBoundary}\r\n`
  + 'Content-Disposition: form-data; name="deny-all-worker.js"; filename="deny-all-worker.js"\r\n'
  + 'Content-Type: application/javascript+module\r\n\r\n'
  + `${DENY_ALL_WORKER_SOURCE}\r\n--${multipartBoundary}--\r\n`,
  'utf8',
);
const envelope = (result) => JSON.stringify({ success: true, result, errors: [], messages: [] });
const jsonResponse = (body, status = 200) => new Response(body, {
  status,
  headers: {
    'content-type': 'application/json; charset=UTF-8',
    'content-length': String(Buffer.byteLength(body)),
  },
});
const settings = {
  logpush: false,
  tail_consumers: [],
  tags: [],
  observability: {
    enabled: true,
    head_sampling_rate: 1,
    redact_query_string: false,
    logs: {
      enabled: true,
      head_sampling_rate: 1,
      invocation_logs: false,
      persist: true,
      destinations: [],
    },
    traces: {
      enabled: false,
      head_sampling_rate: 1,
      persist: true,
      destinations: [],
      propagation_policy: null,
    },
  },
};

let assertions = 0;
let fakeGetCalls = 0;
let fakeMutationCalls = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const ok = (value) => { assert.ok(value); assertions += 1; };
const rejects = async (operation, pattern) => {
  await assert.rejects(operation, pattern); assertions += 1;
};

function clock() {
  let value = Date.parse('2026-08-28T00:00:03.000Z') - 1;
  return () => new Date(value += 1);
}

function controlPlan(operation = 'staging-bootstrap-recover', overrides = {}) {
  return {
    repositoryRoot: ROOT,
    environment: 'staging',
    targetAccountIdSha256: accountIdSha256,
    authorizationSha256,
    sourceGitSha,
    serviceEvidenceSha256: '8'.repeat(64),
    accountSubdomainEvidenceSha256: '9'.repeat(64),
    denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256('staging'),
    commandArgumentsSha256: sha256Hex(canonicalJson(bootstrapArguments({
      environment: 'staging', authorizationSha256,
    }))),
    controlPlane: {
      accountId: overrides.accountId ?? accountId,
      apiToken: overrides.apiToken ?? apiToken,
      envelope: {
        operation,
        accountIdSha256,
        metadataSha256: overrides.metadataSha256 ?? metadataSha256,
        preflightSha256: overrides.preflightSha256 ?? preflightSha256,
        permissionContractSha256: overrides.permissionSha256 ?? permissionSha256,
        ...(operation === 'staging-bootstrap-recover' ? {
          authenticationRequestCounts: {
            GET: 2, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0,
          },
        } : {}),
      },
    },
  };
}

function preparedRecord() {
  return {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-deny-bootstrap-prepared-v1',
    environment: 'staging',
    workerName: 'dwnc-me-staging',
    accountIdSha256,
    authorizationSha256,
    sourceGitSha,
    sourceGitTree,
    denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256('staging'),
    serviceEvidenceSha256: '8'.repeat(64),
    accountSubdomainEvidenceSha256: '9'.repeat(64),
    commandArgumentsSha256: sha256Hex(canonicalJson(bootstrapArguments({
      environment: 'staging', authorizationSha256,
    }))),
    runnerMetadataSha256: metadataSha256,
    runnerPreflightSha256: preflightSha256,
    runnerPermissionSha256: permissionSha256,
    preparedAt: '2026-08-28T00:00:00.000Z',
  };
}

function apiFixture({
  states = ['absent', 'absent'],
  multipleVersions = false,
  multipleDeployments = false,
  splitTraffic = false,
  drift = false,
  pagination = null,
  acceptedToken = apiToken,
} = {}) {
  const calls = [];
  let observation = -1;
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options?.method !== 'GET') {
      fakeMutationCalls += 1;
      throw new Error('SYNTHETIC_MUTATION_FORBIDDEN');
    }
    fakeGetCalls += 1;
    equal(options.redirect, 'error');
    equal(options.headers.authorization, `Bearer ${acceptedToken}`);
    if (url === `${base}/services/dwnc-me-staging`) {
      observation += 1;
      if (states[observation] === 'absent') {
        return jsonResponse(JSON.stringify({
          success: false, result: null, errors: [{ code: 10007, message: 'not found' }],
        }), 404);
      }
      return jsonResponse(envelope({ id: 'dwnc-me-staging' }));
    }
    const selectedVersion = versionIds[drift ? Math.min(observation, 1) : 0];
    const selectedDeployment = deploymentIds[drift ? Math.min(observation, 1) : 0];
    if (url === `${base}/scripts/dwnc-me-staging/deployments`) {
      const versions = splitTraffic
        ? [{ version_id: selectedVersion, percentage: 50 },
          { version_id: versionIds[1], percentage: 50 }]
        : [{ version_id: selectedVersion, percentage: 100 }];
      const deployments = [{
        id: selectedDeployment,
        strategy: 'percentage',
        versions,
        annotations: { 'workers/message': expectedMessage },
      }];
      if (multipleDeployments) deployments.push({
        id: deploymentIds[1], strategy: 'percentage', versions,
        annotations: { 'workers/message': expectedMessage },
      });
      return jsonResponse(envelope({ deployments }));
    }
    const pageMatch = /\/versions\?deployable=true&page=(\d+)&per_page=50$/u.exec(url);
    if (pageMatch) {
      const page = Number(pageMatch[1]);
      let ids = multipleVersions ? [selectedVersion, versionIds[1]] : [selectedVersion];
      let totalCount = ids.length;
      if (pagination !== null) {
        const maximumBoundary = ['max-500', 'too-many-501', 'page-11',
          'duplicate-max', 'change-max'].includes(pagination);
        totalCount = pagination === 'too-many-501' ? 501
          : maximumBoundary ? 500
            : page === 2 && pagination === 'change' ? 52 : 51;
        if (page === 2 && pagination === 'change-max') totalCount = 499;
        ids = maximumBoundary
          ? pagedVersionIds.slice((page - 1) * 50, page * 50)
          : page === 1 ? pagedVersionIds.slice(0, 50)
            : [pagination === 'duplicate' ? pagedVersionIds[0] : pagedVersionIds[50]];
        if (page === 2 && pagination === 'duplicate-max') ids[0] = pagedVersionIds[0];
      }
      const items = ids.map((id) => ({ id }));
      const body = JSON.parse(envelope({ items }));
      body.result_info = {
        page, per_page: 50, count: items.length, total_count: totalCount,
        total_pages: pagination === 'page-11' ? 11 : Math.ceil(totalCount / 50),
      };
      return jsonResponse(JSON.stringify(body));
    }
    if (url === `${base}/scripts/dwnc-me-staging/versions?deployable=true`) {
      return jsonResponse(envelope({ items: multipleVersions
        ? [{ id: selectedVersion }, { id: versionIds[1] }]
        : [{ id: selectedVersion }] }));
    }
    if (url === `${base}/subdomain`) return jsonResponse(envelope({ subdomain: 'dwnc' }));
    if (url === `${base}/scripts/dwnc-me-staging/subdomain`) {
      return jsonResponse(envelope({ enabled: false, previews_enabled: false }));
    }
    if (url === `${base}/scripts/dwnc-me-staging/script-settings`) {
      return jsonResponse(envelope(settings));
    }
    if (url === `${base}/scripts/dwnc-me-staging/content/v2`) {
      return new Response(multipart, { status: 200, headers: {
        'content-type': `multipart/form-data; boundary="${multipartBoundary}"`,
        'content-length': String(multipart.length),
        'cf-entrypoint': 'deny-all-worker.js',
      } });
    }
    if (url === `${base}/scripts/dwnc-me-staging/versions/${selectedVersion}`) {
      return jsonResponse(envelope({
        id: selectedVersion,
        annotations: { 'workers/tag': expectedTag, 'workers/message': expectedMessage },
        resources: { script: { handlers: ['fetch'] }, bindings: [], assets: null },
      }));
    }
    throw new Error('SYNTHETIC_UNEXPECTED_GET');
  };
  return { calls, fetchImpl };
}

async function fixture(options = {}) {
  const root = await mkdtemp('/private/tmp/dwnc-bootstrap-recovery-test-');
  const home = path.join(root, 'home');
  await mkdir(home, { mode: 0o700 });
  const paths = defaultBootstrapProtectedEvidencePaths({
    environment: 'staging', authorizationSha256, home,
  });
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const api = apiFixture(options.api);
  const gitCalls = [];
  const deps = {
    fetchImpl: api.fetchImpl,
    now: clock(),
    userHome: home,
    async inspectGit(repositoryRoot) {
      gitCalls.push(repositoryRoot);
      return options.git ?? { commit: sourceGitSha, tree: sourceGitTree, clean: true };
    },
    lstat,
    readSecureFile,
    writeCanonicalEvidenceCreateOnly,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
  };
  const prepared = preparedRecord();
  const preparedSha256 = bootstrapPreparedSha256(prepared);
  if (options.prepared !== false) {
    if (options.partialPrepared) await writeFile(paths.prepared, '', { mode: 0o600 });
    else await writeCanonicalEvidenceCreateOnly(
      paths.prepared, prepared, canonicalBootstrapPreparedRecord,
    );
  }
  let freshAbsenceSha256 = null;
  let freshSubdomainSha256 = null;
  if (options.claim) {
    let captureTime = Date.parse('2026-08-28T00:00:00.100Z');
    const captureNow = () => new Date(captureTime += 1);
    const captureFetch = async (url, request) => {
      equal(request.method, 'GET');
      if (url.endsWith('/workers/services/dwnc-me-staging')) {
        return jsonResponse(JSON.stringify({
          success: false, result: null, errors: [{ code: 10007, message: 'not found' }],
        }), 404);
      }
      if (url.endsWith('/workers/subdomain')) {
        return jsonResponse(envelope({ subdomain: 'dwnc' }));
      }
      throw new Error('SYNTHETIC_CAPTURE_GET');
    };
    const freshAbsence = await fetchServiceExistenceCapture({
      environment: 'staging', accountId, apiToken, ttlSeconds: 15,
      fetchImpl: captureFetch, now: captureNow,
    });
    const freshSubdomain = await fetchAccountWorkersDevSubdomainCapture({
      environment: 'staging', accountId, apiToken, ttlSeconds: 15,
      fetchImpl: captureFetch, now: captureNow,
    });
    await writeCanonicalEvidenceCreateOnly(
      paths.freshAbsence.primary, freshAbsence, canonicalServiceExistenceCapturePayload,
    );
    await writeCanonicalEvidenceCreateOnly(
      paths.freshAccountSubdomain.primary, freshSubdomain,
      canonicalAccountWorkersDevSubdomainCapturePayload,
    );
    freshAbsenceSha256 = sha256Hex(canonicalServiceExistenceCapturePayload(freshAbsence));
    freshSubdomainSha256 = sha256Hex(
      canonicalAccountWorkersDevSubdomainCapturePayload(freshSubdomain),
    );
  }
  let claimSha256 = null;
  if (options.claim) {
    const claimFile = await claimOneTimeAuthorization({
      directory: paths.directory,
      authorizationSha256,
      scope: 'staging-bootstrap',
      target: 'dwnc-me-staging',
      binding: {
        environment: 'staging', workerName: 'dwnc-me-staging', accountIdSha256,
        authorizationSha256, sourceGitSha, sourceGitTree,
        denyWorkerSha256: prepared.denyWorkerSha256,
        bootstrapConfigSha256: prepared.bootstrapConfigSha256,
        serviceEvidenceSha256: prepared.serviceEvidenceSha256,
        accountSubdomainEvidenceSha256: prepared.accountSubdomainEvidenceSha256,
        commandArgumentsSha256: prepared.commandArgumentsSha256,
        preparedSha256,
        freshAbsenceCaptureSha256: freshAbsenceSha256,
        freshAccountSubdomainCaptureSha256: freshSubdomainSha256,
      },
      now: () => new Date('2026-08-28T00:00:00.500Z'),
    });
    const claimBytes = await readFile(claimFile);
    try {
      claimSha256 = sha256Hex(claimBytes.subarray(0, claimBytes.length - 1));
    } finally { claimBytes.fill(0); }
  }
  let started = null;
  if (options.started) {
    started = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-deny-bootstrap-started-v1',
      environment: 'staging',
      workerName: 'dwnc-me-staging',
      accountIdSha256,
      authorizationSha256,
      sourceGitSha,
      sourceGitTree,
      denyWorkerSha256: prepared.denyWorkerSha256,
      bootstrapConfigSha256: prepared.bootstrapConfigSha256,
      serviceEvidenceSha256: prepared.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: prepared.accountSubdomainEvidenceSha256,
      commandArgumentsSha256: prepared.commandArgumentsSha256,
      preparedSha256,
      claimSha256,
      freshAbsenceCaptureSha256: freshAbsenceSha256,
      freshAccountSubdomainCaptureSha256: freshSubdomainSha256,
      startedAt: '2026-08-28T00:00:01.000Z',
    };
    if (options.partialStarted) await writeFile(paths.started, '', { mode: 0o600 });
    else await writeCanonicalEvidenceCreateOnly(
      paths.started, started, canonicalBootstrapStartedRecord,
    );
  }
  if (options.partialResult) await writeFile(paths.result, '', { mode: 0o600 });
  if (options.result) {
    const success = options.result === 'success';
    const result = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-deny-bootstrap-result-v1',
      environment: 'staging',
      workerName: 'dwnc-me-staging',
      accountIdSha256,
      authorizationSha256,
      sourceGitSha,
      sourceGitTree,
      denyWorkerSha256: prepared.denyWorkerSha256,
      bootstrapConfigSha256: prepared.bootstrapConfigSha256,
      serviceEvidenceSha256: prepared.serviceEvidenceSha256,
      accountSubdomainEvidenceSha256: prepared.accountSubdomainEvidenceSha256,
      commandArgumentsSha256: prepared.commandArgumentsSha256,
      preparedSha256,
      startedSha256: bootstrapStartedSha256(started),
      wranglerOutcome: success ? 'success' : 'exit-nonzero',
      exitCode: success ? 0 : 1,
      signal: null,
      errorCode: success ? null : 'CLOUDFLARE_E_BOOTSTRAP_WRANGLER_FAILED',
      stdoutBytes: 0,
      stdoutSha256: sha256Hex(''),
      stderrBytes: 0,
      stderrSha256: sha256Hex(''),
      deployOutputState: success ? 'valid' : 'absent',
      deployOutputSha256: success ? sha256Hex('synthetic-deploy-output') : null,
      versionId: success ? versionIds[0] : null,
      completedAt: '2026-08-28T00:00:02.000Z',
    };
    await writeCanonicalEvidenceCreateOnly(paths.result, result, canonicalBootstrapResultRecord);
  }
  if (options.partialStatus) await writeFile(paths.status.primary, '', { mode: 0o600 });
  return {
    api, deps, gitCalls, home, paths, root,
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

async function runCase(options, expected, expectedGets) {
  const item = await fixture(options);
  try {
    const recovered = await recoverBootstrapStatusCore(controlPlan(), item.paths, item.deps);
    equal(recovered.status.classification, expected);
    equal(recovered.status.authenticationRequestCounts.GET, 2);
    equal(recovered.status.stateRequestCounts.GET, expectedGets);
    equal(recovered.status.requestCounts.GET, expectedGets + 2);
    equal(recovered.status.requestCounts.POST, 0);
    equal(recovered.status.requestCounts.PUT, 0);
    equal(recovered.status.requestCounts.PATCH, 0);
    equal(recovered.status.requestCounts.DELETE, 0);
    equal(recovered.status.wranglerInvocations, 0);
    validateBootstrapStatusRecord(recovered.status); assertions += 1;
    const storedPath = options.partialStatus
      ? item.paths.status.recovery : item.paths.status.primary;
    const storedText = await readFile(storedPath, 'utf8');
    equal(storedText.includes(accountId), false);
    equal(storedText.includes(apiToken), false);
    equal(storedText.includes(item.home), false);
    return { item, recovered };
  } catch (error) {
    await item.cleanup();
    throw error;
  }
}

for (const item of [
  [{ claim: false, started: false, api: { states: ['absent', 'absent'] } },
    'never-started', 2],
  [{ claim: true, started: false, api: { states: ['absent', 'absent'] } },
    'never-started', 2],
  [{ claim: true, started: true, result: 'failure', api: { states: ['absent', 'absent'] } },
    'absent-after-start', 2],
  [{ claim: true, started: true, api: { states: ['present', 'present'] } },
    'exact-recovered', 22],
  [{ claim: true, started: false, api: { states: ['present', 'present'] } },
    'ambiguous', 22],
  [{ claim: true, started: true, result: 'success', api: { states: ['absent', 'absent'] } },
    'ambiguous', 2],
  [{ claim: true, started: true, api: { states: ['present', 'present'], multipleVersions: true } },
    'ambiguous', 6],
  [{ claim: true, started: true, api: { states: ['present', 'present'], multipleDeployments: true } },
    'ambiguous', 4],
  [{ claim: true, started: true, api: { states: ['present', 'present'], splitTraffic: true } },
    'ambiguous', 4],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'next' } }, 'ambiguous', 8],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'duplicate' } }, 'ambiguous', 8],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'change' } }, 'ambiguous', 8],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'max-500' } }, 'ambiguous', 24],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'too-many-501' } }, 'ambiguous', 6],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'page-11' } }, 'ambiguous', 6],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'duplicate-max' } }, 'ambiguous', 8],
  [{ claim: true, started: true,
    api: { states: ['present', 'present'], pagination: 'change-max' } }, 'ambiguous', 8],
  [{ claim: true, started: true, api: { states: ['present', 'present'] }, partialStatus: true },
    'exact-recovered', 22],
  [{ claim: true, started: true, partialResult: true,
    api: { states: ['absent', 'absent'] } }, 'absent-after-start', 2],
  [{ claim: true, started: true, partialResult: true,
    api: { states: ['present', 'present'] } }, 'exact-recovered', 22],
]) {
  const { item: created } = await runCase(item[0], item[1], item[2]);
  await created.cleanup();
}

const drift = await runCase({
  claim: true, started: true, api: { states: ['present', 'present'], drift: true },
}, 'ambiguous', 22);
equal(drift.recovered.status.observationA.versionId, versionIds[0]);
equal(drift.recovered.status.observationB.versionId, versionIds[1]);
await drift.item.cleanup();

for (const damagedOptions of [
  { partialPrepared: true },
  { claim: true, started: true, partialStarted: true },
]) {
  const damaged = await fixture(damagedOptions);
  try {
    await rejects(() => recoverBootstrapStatusCore(
      controlPlan(), damaged.paths, damaged.deps,
    ), /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE/u);
    equal(damaged.api.calls.length, 0);
  } finally { await damaged.cleanup(); }
}

const localPartialResult = await fixture({ claim: true, started: true, partialResult: true });
try {
  const local = await inspectExistingBootstrapRecoveryStatus({
    ...controlPlan(), controlPlane: null,
  }, localPartialResult.paths, {
    inspectGit: localPartialResult.deps.inspectGit,
    lstat,
    readSecureFile,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
  });
  equal(local.state, 'needs-recovery');
  equal(localPartialResult.api.calls.length, 0);
} finally { await localPartialResult.cleanup(); }

const damagedFreshCapture = await fixture({ claim: true, started: true });
try {
  await writeFile(damagedFreshCapture.paths.freshAbsence.primary, '{}\n', { mode: 0o600 });
  await rejects(() => inspectExistingBootstrapRecoveryStatus({
    ...controlPlan(), controlPlane: null,
  }, damagedFreshCapture.paths, {
    inspectGit: damagedFreshCapture.deps.inspectGit,
    lstat,
    readSecureFile,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
  }), /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE/u);
  equal(damagedFreshCapture.api.calls.length, 0);
} finally { await damagedFreshCapture.cleanup(); }

const idempotent = await fixture({ api: { states: ['absent', 'absent'] } });
try {
  const first = await recoverBootstrapStatusCore(controlPlan(), idempotent.paths, idempotent.deps);
  equal(first.existing, false);
  equal(idempotent.api.calls.length, 2);
  const second = await recoverBootstrapStatusCore(controlPlan(), idempotent.paths, idempotent.deps);
  equal(second.existing, true);
  equal(second.status, first.status);
  equal(idempotent.api.calls.length, 2);
  const local = await inspectExistingBootstrapRecoveryStatus({
    ...controlPlan(), controlPlane: null,
  }, idempotent.paths, {
    inspectGit: idempotent.deps.inspectGit,
    lstat,
    readSecureFile,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
  });
  equal(local.state, 'complete');
  equal(local.status, first.status);
  equal(idempotent.api.calls.length, 2);
} finally { await idempotent.cleanup(); }

const recoveredSlot = await fixture({
  claim: true, started: true, partialStatus: true,
  api: { states: ['present', 'present'] },
});
try {
  const first = await recoverBootstrapStatusCore(controlPlan(), recoveredSlot.paths,
    recoveredSlot.deps);
  equal(first.existing, false);
  equal(first.status.classification, 'exact-recovered');
  equal(recoveredSlot.api.calls.length, 22);
  const second = await recoverBootstrapStatusCore(controlPlan(), recoveredSlot.paths,
    recoveredSlot.deps);
  equal(second.existing, true);
  equal(second.status, first.status);
  equal(recoveredSlot.api.calls.length, 22);
} finally { await recoveredSlot.cleanup(); }

const replacementSession = await fixture({
  claim: true, started: true,
  api: { states: ['present', 'present'], acceptedToken: 'synthetic-replacement-token' },
});
try {
  const replacementPlan = controlPlan('staging-bootstrap-recover', {
    metadataSha256: 'a'.repeat(64),
    preflightSha256: 'b'.repeat(64),
    permissionSha256: 'c'.repeat(64),
    apiToken: 'synthetic-replacement-token',
  });
  const recovered = await recoverBootstrapStatusCore(
    replacementPlan, replacementSession.paths, replacementSession.deps,
  );
  equal(recovered.status.classification, 'exact-recovered');
  equal(recovered.status.recoveryRunnerMetadataSha256, 'a'.repeat(64));
  equal(recovered.status.recoveryRunnerPreflightSha256, 'b'.repeat(64));
  equal(recovered.status.recoveryRunnerPermissionSha256, 'c'.repeat(64));
  const prepared = JSON.parse(await readFile(replacementSession.paths.prepared, 'utf8'));
  equal(prepared.runnerMetadataSha256, metadataSha256);
} finally { await replacementSession.cleanup(); }

const semanticReceipt = await fixture({
  claim: true, started: true, api: { states: ['present', 'present'] },
});
try {
  const recovered = await recoverBootstrapStatusCore(
    controlPlan(), semanticReceipt.paths, semanticReceipt.deps,
  );
  for (const mutate of [
    (value) => { value.classification = 'never-started'; },
    (value) => { value.observationA.workersDevEnabled = true; },
    (value) => { value.observationB.previewsEnabled = true; },
    (value) => { value.observationA.denyWorkerSha256 = 'f'.repeat(64); },
    (value) => { value.observationB.settingsPolicySha256 = 'f'.repeat(64); },
    (value) => { value.requestCounts.GET += 1; },
    (value) => { value.resultOutcome = 'success'; },
  ]) {
    const changed = structuredClone(recovered.status);
    mutate(changed);
    assert.throws(() => validateBootstrapStatusRecord(changed),
      /CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD/u);
    assertions += 1;
  }
  const prepared = JSON.parse(await readFile(semanticReceipt.paths.prepared, 'utf8'));
  prepared.runnerMetadataSha256 = 'd'.repeat(64);
  await writeFile(semanticReceipt.paths.prepared, `${canonicalJson(prepared)}\n`, { mode: 0o600 });
  await rejects(() => recoverBootstrapStatusCore(
    controlPlan(), semanticReceipt.paths, semanticReceipt.deps,
  ), /CLOUDFLARE_E_BOOTSTRAP_(?:STATUS_RECORD|RESULT_RECORD|STARTED_RECORD)/u);
  equal(semanticReceipt.api.calls.length, 22);
} finally { await semanticReceipt.cleanup(); }

for (const [error, expected] of [
  [null, 'success'],
  [{ code: 2 }, 'exit-nonzero'],
  [{ signal: 'SIGTERM' }, 'signal'],
  [{ killed: true, signal: 'SIGTERM' }, 'timeout'],
  [{ code: 'ENOENT' }, 'spawn-error'],
]) {
  equal(normalizeBootstrapWranglerResult(error).wranglerOutcome, expected);
}
assert.throws(() => bootstrapInstantMilliseconds(
  '2026-02-30T00:00:00.000Z', 'CLOUDFLARE_E_BOOTSTRAP_TEST_TIME',
), /CLOUDFLARE_E_BOOTSTRAP_TEST_TIME/u);
assertions += 1;
const strictResultFixture = await fixture({ claim: true, started: true, result: 'failure' });
try {
  const value = JSON.parse(await readFile(strictResultFixture.paths.result, 'utf8'));
  for (const mutate of [
    (record) => {
      record.wranglerOutcome = 'signal';
      record.exitCode = 2;
      record.signal = 'SIGTERM';
    },
    (record) => {
      record.wranglerOutcome = 'success';
      record.exitCode = 0;
      record.errorCode = null;
      record.deployOutputState = 'absent';
    },
    (record) => {
      record.deployOutputState = 'invalid';
      record.deployOutputSha256 = 'f'.repeat(64);
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => validateBootstrapResultRecord(changed),
      /CLOUDFLARE_E_BOOTSTRAP_RESULT_RECORD/u);
    assertions += 1;
  }
  for (const [error, outcome, exitCode, signal] of [
    [null, 'success', 0, null],
    [{ code: 2, signal: 'SIGTERM' }, 'exit-nonzero', 2, null],
    [{ signal: 'SIGTERM' }, 'signal', null, 'SIGTERM'],
    [{ killed: true, code: 2, signal: 'SIGTERM' }, 'timeout', null, 'SIGTERM'],
    [{ code: 'ENOENT', signal: 'SIGTERM' }, 'signal', null, 'SIGTERM'],
    [{ code: 'ENOENT' }, 'spawn-error', null, null],
  ]) {
    const normalized = normalizeBootstrapWranglerResult(error);
    equal(normalized.wranglerOutcome, outcome);
    equal(normalized.exitCode, exitCode);
    equal(normalized.signal, signal);
    const normalizedRecord = {
      ...value, ...normalized,
      deployOutputState: outcome === 'success' ? 'invalid' : 'absent',
      deployOutputSha256: null, versionId: null,
    };
    validateBootstrapResultRecord(normalizedRecord); assertions += 1;
  }
} finally { await strictResultFixture.cleanup(); }

const mismatchedResultVersion = await fixture({
  claim: true, started: true, result: 'success', api: { states: ['present', 'present'] },
});
try {
  const resultRecord = JSON.parse(await readFile(mismatchedResultVersion.paths.result, 'utf8'));
  resultRecord.versionId = versionIds[1];
  await writeFile(mismatchedResultVersion.paths.result,
    `${canonicalBootstrapResultRecord(resultRecord)}\n`, { mode: 0o600 });
  const recovered = await recoverBootstrapStatusCore(
    controlPlan(), mismatchedResultVersion.paths, mismatchedResultVersion.deps,
  );
  equal(recovered.status.classification, 'ambiguous');
  equal(recovered.status.resultVersionId, versionIds[1]);
  equal(recovered.status.observationA.versionId, versionIds[0]);
  equal(recovered.status.observationB.versionId, versionIds[0]);
  const tamperedStatus = structuredClone(recovered.status);
  tamperedStatus.resultVersionId = versionIds[0];
  tamperedStatus.classification = 'exact-recovered';
  await writeFile(mismatchedResultVersion.paths.status.primary,
    `${canonicalJson(tamperedStatus)}\n`, { mode: 0o600 });
  await rejects(() => inspectExistingBootstrapRecoveryStatus({
    ...controlPlan(), controlPlane: null,
  }, mismatchedResultVersion.paths, {
    inspectGit: mismatchedResultVersion.deps.inspectGit,
    lstat, readSecureFile,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
  }), /CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD/u);
  equal(mismatchedResultVersion.api.calls.length, 22);
} finally { await mismatchedResultVersion.cleanup(); }

const resultBeforeStarted = await fixture({ claim: true, started: true, result: 'failure' });
try {
  const resultRecord = JSON.parse(await readFile(resultBeforeStarted.paths.result, 'utf8'));
  resultRecord.completedAt = '2026-08-28T00:00:00.999Z';
  await writeFile(resultBeforeStarted.paths.result,
    `${canonicalBootstrapResultRecord(resultRecord)}\n`, { mode: 0o600 });
  await rejects(() => inspectExistingBootstrapRecoveryStatus({
    ...controlPlan(), controlPlane: null,
  }, resultBeforeStarted.paths, {
    inspectGit: resultBeforeStarted.deps.inspectGit,
    lstat, readSecureFile,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
  }), /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE/u);
  equal(resultBeforeStarted.api.calls.length, 0);
} finally { await resultBeforeStarted.cleanup(); }

const wrongAccount = await fixture();
try {
  await rejects(() => recoverBootstrapStatusCore(
    controlPlan('staging-bootstrap-recover', { accountId: 'b'.repeat(32) }),
    wrongAccount.paths, wrongAccount.deps,
  ), /CLOUDFLARE_E_ACCOUNT_TARGET/u);
  equal(wrongAccount.api.calls.length, 0);
  await rejects(() => recoverBootstrapStatusCore({
    ...controlPlan(), commandArgumentsSha256: 'f'.repeat(64),
  }, wrongAccount.paths, wrongAccount.deps), /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PLAN/u);
  equal(wrongAccount.api.calls.length, 0);
} finally { await wrongAccount.cleanup(); }

const orphan = await fixture();
try {
  await writeFile(orphan.paths.status.recovery, '{}\n', { mode: 0o600 });
  await rejects(() => recoverBootstrapStatusCore(controlPlan(), orphan.paths, orphan.deps),
    /CLOUDFLARE_E_BOOTSTRAP_STATUS_ORPHAN/u);
  equal(orphan.api.calls.length, 0);
} finally { await orphan.cleanup(); }

const wrongGit = await fixture({ git: { commit: sourceGitSha, tree: '3'.repeat(40), clean: true } });
try {
  await rejects(() => recoverBootstrapStatusCore(controlPlan(), wrongGit.paths, wrongGit.deps),
    /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_GIT/u);
  equal(wrongGit.api.calls.length, 0);
} finally { await wrongGit.cleanup(); }

const recoverySource = await readFile('scripts/lib/cloudflare-bootstrap-recovery.mjs', 'utf8');
const recoveryEntrySource = await readFile('scripts/recover-cloudflare-service-bootstrap.mjs', 'utf8');
equal(recoverySource.includes("from 'node:child_process'"), false);
equal(recoverySource.includes('execFile('), false);
equal(recoveryEntrySource.includes('wrangler'), false);

equal(fakeMutationCalls, 0);
ok(assertions > 150);
console.log(JSON.stringify({
  suite: 'cloudflare-deny-bootstrap-status-recovery',
  assertions,
  fakeGetCalls,
  fakeMutationCalls,
  rawWranglerInvocations: 0,
  liveNetworkCalls: 0,
  externalWrites: 0,
  actualDeployments: 0,
  status: 'PASS',
}, null, 2));
