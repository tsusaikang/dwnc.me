import assert from 'node:assert/strict';
import {
  chmod, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  accountWorkersDevSubdomainRequestSha256,
  bootstrapArguments,
  bootstrapConfig,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  canonicalBootstrapAuthorizationPayload,
  defaultBootstrapProtectedEvidencePaths,
  DENY_ALL_WORKER_SOURCE,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  serviceExistenceRequestSha256,
} from './lib/cloudflare-bootstrap.mjs';
import {
  executeBootstrapMutationCore,
  executeBootstrapMutationProduction,
} from './lib/cloudflare-bootstrap-execution.mjs';
import { assertCloudflareAccountTargetOutsideRepository } from './lib/cloudflare-account-target.mjs';
import {
  assertPinnedWranglerInstalled,
  claimOneTimeAuthorization,
} from './lib/cloudflare-process.mjs';
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
const versionId = '22345678-1234-4123-8123-123456789abc';
const deploymentId = '32345678-1234-4123-8123-123456789abc';
const evidenceAt = '2026-08-25T00:00:00.000Z';
const serviceEvidenceSha256 = '2'.repeat(64);
const accountSubdomainEvidenceSha256 = '3'.repeat(64);
let assertions = 0;
let fakeApiCalls = 0;
let fakeWranglerProcesses = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const ok = (value) => { assert.ok(value); assertions += 1; };
const rejects = async (operation, pattern) => {
  await assert.rejects(operation, pattern); assertions += 1;
};
const rejection = async (operation) => {
  try { await operation(); }
  catch (error) { assertions += 1; return error; }
  assert.fail('expected rejection');
};

const authorization = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-bootstrap-authorization-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  sourceGitSha: '1'.repeat(40),
  denyWorkerSha256: bootstrapDenyWorkerSha256(),
  bootstrapConfigSha256: bootstrapConfigSha256('staging'),
  serviceEvidenceSha256,
  accountSubdomainEvidenceSha256,
  freshAbsenceRequired: true,
  freshAbsenceRequestSha256: serviceExistenceRequestSha256({
    environment: 'staging', accountIdSha256,
  }),
  freshAccountSubdomainRequired: true,
  freshAccountSubdomainRequestSha256: accountWorkersDevSubdomainRequestSha256({
    environment: 'staging', accountIdSha256,
  }),
  maxFreshAbsenceAgeSeconds: 15,
  maxFreshAccountSubdomainAgeSeconds: 15,
  buildUuid: '12345678-1234-4123-8123-123456789abc',
  nonceSha256: '9'.repeat(64),
  createdAt: evidenceAt,
  expiresAt: '2026-08-25T00:10:00.000Z',
};
const authorizationSha256 = sha256Hex(canonicalBootstrapAuthorizationPayload(authorization));
const goodGitSnapshot = Object.freeze({
  commit: authorization.sourceGitSha,
  tree: '2'.repeat(40),
  clean: true,
});
const expectedArguments = bootstrapArguments({
  environment: 'staging', authorizationSha256,
});
const expectedTag = `dwnc-bootstrap-${authorizationSha256.slice(0, 24)}`;
const expectedMessage = `dwnc-deny-bootstrap:${authorizationSha256}`;
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
const multipartBoundary = 'dwnc-execution-fixture';
const multipart = Buffer.from(
  `--${multipartBoundary}\r\n`
  + 'Content-Disposition: form-data; name="deny-all-worker.js"; filename="deny-all-worker.js"\r\n'
  + 'Content-Type: application/javascript+module\r\n\r\n'
  + `${DENY_ALL_WORKER_SOURCE}\r\n--${multipartBoundary}--\r\n`,
  'utf8',
);

function monotonicClock() {
  let time = Date.parse(evidenceAt) - 1;
  return () => new Date(time += 1);
}

function plan() {
  return {
    repositoryRoot: ROOT,
    environment: 'staging',
    targetAccountIdSha256: accountIdSha256,
    authorization,
    authorizationSha256,
    serviceEvidenceSha256,
    accountSubdomainEvidenceSha256,
    controlPlane: { accountId, apiToken },
  };
}

function assertGet(url, options) {
  equal(options.method, 'GET');
  equal(options.redirect, 'error');
  equal(options.headers.authorization, `Bearer ${apiToken}`);
  equal(options.headers['accept-encoding'], 'identity');
  equal(options.headers.accept, url.endsWith('/content/v2')
    ? 'multipart/form-data' : 'application/json');
  equal(Object.keys(options.headers).sort(), ['accept', 'accept-encoding', 'authorization']);
  equal(options.signal instanceof AbortSignal, true);
}

function apiFixture({
  secretInFreshResponse = false,
  unsafeSnapshot = false,
  contentEntrypoint = 'deny-all-worker.js',
} = {}) {
  const calls = [];
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const serviceUrl = `${base}/services/dwnc-me-staging`;
  const accountUrl = `${base}/subdomain`;
  const scriptUrl = `${base}/scripts/dwnc-me-staging/subdomain`;
  const settingsUrl = `${base}/scripts/dwnc-me-staging/script-settings`;
  const contentUrl = `${base}/scripts/dwnc-me-staging/content/v2`;
  const versionUrl = `${base}/scripts/dwnc-me-staging/versions/${versionId}`;
  const deploymentsUrl = `${base}/scripts/dwnc-me-staging/deployments`;
  const fetchImpl = async (url, options) => {
    calls.push(url);
    fakeApiCalls += 1;
    assertGet(url, options);
    if (url === serviceUrl) {
      const body = JSON.stringify({
        success: false,
        result: null,
        errors: [{
          code: 10007,
          message: secretInFreshResponse ? `missing ${accountId}` : 'not found',
        }],
      });
      return jsonResponse(body, 404);
    }
    if (url === accountUrl) return jsonResponse(envelope({ subdomain: 'dwnc' }));
    if (url === scriptUrl) return jsonResponse(envelope({
      enabled: unsafeSnapshot,
      previews_enabled: false,
    }));
    if (url === settingsUrl) return jsonResponse(envelope(settings));
    if (url === contentUrl) return new Response(multipart, {
      status: 200,
      headers: {
        'content-type': `multipart/form-data; boundary="${multipartBoundary}"`,
        'content-length': String(multipart.length),
        'cf-entrypoint': contentEntrypoint,
      },
    });
    if (url === versionUrl) return jsonResponse(envelope({
      id: versionId,
      annotations: { 'workers/tag': expectedTag, 'workers/message': expectedMessage },
      resources: { script: { handlers: ['fetch'] }, bindings: [], assets: null },
    }));
    if (url === deploymentsUrl) return jsonResponse(envelope({ deployments: [{
      id: deploymentId,
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
    }] }));
    throw new Error('SYNTHETIC_UNEXPECTED_REQUEST');
  };
  return { calls, fetchImpl, urls: {
    serviceUrl, accountUrl, deploymentsUrl, scriptUrl, settingsUrl, contentUrl, versionUrl,
  } };
}

function deployNdjson() {
  return `${JSON.stringify({
    type: 'wrangler-session',
    version: 1,
    wrangler_version: '4.125.0',
    command_line_args: expectedArguments,
    log_file_path: null,
    timestamp: evidenceAt,
  })}\n${JSON.stringify({
    type: 'deploy',
    version: 1,
    worker_name: 'dwnc-me-staging',
    worker_tag: null,
    version_id: versionId,
    targets: [],
    worker_name_overridden: false,
    timestamp: evidenceAt,
  })}\n`;
}

async function makeCase({
  secretInFreshResponse = false,
  unsafeSnapshot = false,
  contentEntrypoint = 'deny-all-worker.js',
  execFailure = false,
  oversizedOutput = false,
  existingCandidate = false,
  existingRecovery = false,
  partialFreshOutput = false,
  claimCollision = false,
  insecureEvidenceDirectory = false,
  gitSnapshots = null,
  nowOverride = null,
  expireDuringInitialGit = false,
  expireBeforeSecondBoundary = false,
  expireAfterClaim = false,
  cleanupCloseFailure = false,
  cleanupDeleteFailure = false,
} = {}) {
  const caseRoot = await realpath(await mkdtemp('/private/tmp/dwnc-bootstrap-core-test-'));
  const home = path.join(caseRoot, 'home');
  const temporaryRoot = path.join(caseRoot, 'temporary');
  const paths = defaultBootstrapProtectedEvidencePaths({
    environment: 'staging', authorizationSha256, home,
  });
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await chmod(paths.directory, 0o700);
  await mkdir(temporaryRoot, { mode: 0o700 });
  if (existingCandidate) {
    await writeFile(paths.attestation.primary, '{}\n', { mode: 0o600 });
  }
  if (existingRecovery) {
    await writeFile(paths.after.recovery, '{}\n', { mode: 0o600 });
  }
  if (partialFreshOutput) {
    await writeFile(paths.freshAbsence.primary, '', { mode: 0o600 });
  }
  if (claimCollision) {
    await writeFile(
      path.join(paths.directory, `staging-bootstrap-${authorizationSha256}.json`),
      '{}\n', { mode: 0o600 },
    );
  }
  if (insecureEvidenceDirectory) await chmod(paths.directory, 0o755);
  const api = apiFixture({ secretInFreshResponse, unsafeSnapshot, contentEntrypoint });
  const wranglerCalls = [];
  const claimCalls = [];
  const gitCalls = [];
  const pinnedWranglerCalls = [];
  const outputPreflightCalls = [];
  const selectedGitSnapshots = gitSnapshots ?? [goodGitSnapshot, goodGitSnapshot];
  const ordinaryClock = monotonicClock();
  const execFileAsync = async (binary, args, options) => {
    wranglerCalls.push({ binary, args, options });
    fakeWranglerProcesses += 1;
    equal(binary, path.join(ROOT, 'node_modules/.bin/wrangler'));
    equal(args, expectedArguments);
    equal(args.some((argument) => path.isAbsolute(argument)), false);
    equal(path.dirname(options.env.WRANGLER_OUTPUT_FILE_PATH), options.cwd);
    equal(options.cwd.startsWith(`${temporaryRoot}${path.sep}`), true);
    equal(options.env.CLOUDFLARE_ACCOUNT_ID, accountId);
    equal(Object.hasOwn(options.env, 'CLOUDFLARE_API_TOKEN'), false);
    equal(Object.hasOwn(options.env, 'CF_API_TOKEN'), false);
    equal(await readFile(path.join(options.cwd, 'deny-all-worker.js'), 'utf8'),
      DENY_ALL_WORKER_SOURCE);
    equal(await readFile(path.join(options.cwd, 'wrangler-bootstrap.jsonc'), 'utf8'),
      `${canonicalJson(bootstrapConfig('staging'))}\n`);
    equal(await readFile(path.join(options.cwd, 'wrangler-empty.env'), 'utf8'), '');
    if (execFailure) throw new Error('SYNTHETIC_WRANGLER_FAILURE');
    await writeFile(options.env.WRANGLER_OUTPUT_FILE_PATH,
      oversizedOutput ? Buffer.alloc(1024 * 1024 + 1, 0x61) : deployNdjson());
    return { stdout: '', stderr: '' };
  };
  const openFixture = async (...args) => {
    const handle = await open(...args);
    if (!cleanupCloseFailure || args[1] !== 'wx+') return handle;
    return {
      stat: handle.stat.bind(handle),
      read: handle.read.bind(handle),
      async close() {
        await handle.close();
        throw new Error(`SYNTHETIC_CLOSE_FAILURE:${home}`);
      },
    };
  };
  const removeFixture = async (target, options) => {
    if (cleanupDeleteFailure && target.startsWith(`${temporaryRoot}${path.sep}`)) {
      throw new Error(`SYNTHETIC_DELETE_FAILURE:${home}`);
    }
    return rm(target, options);
  };
  const dependencies = {
    fetchImpl: api.fetchImpl,
    execFileAsync,
    now: nowOverride ?? (() => {
      if (expireAfterClaim && claimCalls.length > 0
        || expireBeforeSecondBoundary && gitCalls.length >= 2
        || expireDuringInitialGit && gitCalls.length >= 1) {
        return new Date('2026-08-25T00:11:00.000Z');
      }
      return ordinaryClock();
    }),
    userHome: home,
    temporaryRoot,
    wranglerSourceEnvironment: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: home,
      CLOUDFLARE_ACCOUNT_ID: accountId,
    },
    async inspectGit(root) {
      gitCalls.push(root);
      equal(root, ROOT);
      return selectedGitSnapshots[Math.min(gitCalls.length - 1, selectedGitSnapshots.length - 1)];
    },
    async assertPinnedWranglerInstalled(root) {
      pinnedWranglerCalls.push(root);
      return assertPinnedWranglerInstalled(root);
    },
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    async assertSecureCreateOnlyDestination(file) {
      outputPreflightCalls.push(file);
      return assertSecureCreateOnlyDestination(file);
    },
    async claimOneTimeAuthorization(input) {
      claimCalls.push(input);
      return claimOneTimeAuthorization(input);
    },
    writeCanonicalEvidenceCreateOnly,
    readSecureFile,
    fileSystem: {
      mkdtemp,
      open: openFixture,
      rm: removeFixture,
      writeFile,
    },
  };
  return {
    api,
    caseRoot,
    claimCalls,
    dependencies,
    gitCalls,
    home,
    outputPreflightCalls,
    paths,
    pinnedWranglerCalls,
    temporaryRoot,
    wranglerCalls,
    async cleanup() { await rm(caseRoot, { recursive: true, force: true }); },
  };
}

const success = await makeCase();
try {
  const execution = await executeBootstrapMutationCore(plan(), success.dependencies);
  equal(execution.result, {
    contract: 'dwnc-cloudflare-deny-bootstrap-result-v2',
    environment: 'staging',
    workerName: 'dwnc-me-staging',
    versionId,
    deploymentId,
    workersDevEnabled: false,
    previewsEnabled: false,
    attestationRequired: true,
    candidateWritten: true,
  });
  equal(success.wranglerCalls.length, 1);
  equal(success.api.calls.length, 16);
  equal(success.gitCalls.length, 3);
  equal(success.claimCalls.length, 1);
  equal(success.pinnedWranglerCalls, [ROOT]);
  const claimPath = path.join(
    success.paths.directory, `staging-bootstrap-${authorizationSha256}.json`,
  );
  const allOutputs = [
    claimPath,
    success.paths.freshAbsence.primary, success.paths.freshAbsence.recovery,
    success.paths.freshAccountSubdomain.primary, success.paths.freshAccountSubdomain.recovery,
    success.paths.deployOutput.primary, success.paths.deployOutput.recovery,
    success.paths.before.primary, success.paths.before.recovery,
    success.paths.after.primary, success.paths.after.recovery,
    success.paths.attestation.primary, success.paths.attestation.recovery,
  ];
  const remainingOutputs = [
    claimPath,
    success.paths.freshAbsence.recovery,
    success.paths.freshAccountSubdomain.recovery,
    success.paths.deployOutput.primary, success.paths.deployOutput.recovery,
    success.paths.before.primary, success.paths.before.recovery,
    success.paths.after.primary, success.paths.after.recovery,
    success.paths.attestation.primary, success.paths.attestation.recovery,
  ];
  equal(success.outputPreflightCalls, [...allOutputs, ...remainingOutputs]);
  const expectedSnapshot = [
    success.api.urls.deploymentsUrl,
    success.api.urls.accountUrl,
    success.api.urls.scriptUrl,
    success.api.urls.settingsUrl,
    success.api.urls.contentUrl,
    success.api.urls.versionUrl,
    success.api.urls.deploymentsUrl,
  ];
  equal(success.api.calls, [
    success.api.urls.serviceUrl,
    success.api.urls.accountUrl,
    ...expectedSnapshot,
    ...expectedSnapshot,
  ]);
  equal((await readdir(success.temporaryRoot)).length, 0);
  equal((await readdir(success.paths.directory)).sort(), [
    'attestation-candidate.json',
    'fresh-account-subdomain.json',
    'fresh-service-absence.json',
    'post-state-after.json',
    'post-state-before.json',
    `staging-bootstrap-${authorizationSha256}.json`,
    'wrangler-deploy-output.json',
  ]);
  const candidate = await readFile(success.paths.attestation.primary, 'utf8');
  equal(candidate, `${canonicalJson(execution.attestation)}\n`);
  equal(candidate.includes(accountId), false);
  equal(candidate.includes(apiToken), false);
  equal(candidate.includes(success.home), false);
  equal(Object.hasOwn(execution.result, 'attestationPath'), false);
} finally { await success.cleanup(); }

const secretFailure = await makeCase({ secretInFreshResponse: true });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), secretFailure.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
  equal(secretFailure.api.calls.length, 1);
  equal(secretFailure.wranglerCalls.length, 0);
  equal(await readdir(secretFailure.paths.directory), []);
  equal(await readdir(secretFailure.temporaryRoot), []);
} finally { await secretFailure.cleanup(); }

const execFailure = await makeCase({ execFailure: true });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), execFailure.dependencies),
    /SYNTHETIC_WRANGLER_FAILURE/u);
  equal(execFailure.api.calls.length, 2);
  equal(execFailure.wranglerCalls.length, 1);
  equal((await readdir(execFailure.paths.directory)).sort(), [
    'fresh-account-subdomain.json',
    'fresh-service-absence.json',
    `staging-bootstrap-${authorizationSha256}.json`,
  ]);
  equal(await readdir(execFailure.temporaryRoot), []);
} finally { await execFailure.cleanup(); }

const oversizedFailure = await makeCase({ oversizedOutput: true });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), oversizedFailure.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_DEPLOY_OUTPUT_FILE/u);
  equal(oversizedFailure.api.calls.length, 2);
  equal(oversizedFailure.wranglerCalls.length, 1);
  equal((await readdir(oversizedFailure.paths.directory)).includes(
    'wrangler-deploy-output.json'), false);
  equal(await readdir(oversizedFailure.temporaryRoot), []);
} finally { await oversizedFailure.cleanup(); }

const snapshotFailure = await makeCase({ unsafeSnapshot: true });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), snapshotFailure.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_RESPONSE/u);
  equal(snapshotFailure.wranglerCalls.length, 1);
  equal(snapshotFailure.api.calls.length, 9);
  equal((await readdir(snapshotFailure.paths.directory)).sort(), [
    'fresh-account-subdomain.json',
    'fresh-service-absence.json',
    `staging-bootstrap-${authorizationSha256}.json`,
    'wrangler-deploy-output.json',
  ]);
  equal(await readdir(snapshotFailure.temporaryRoot), []);
} finally { await snapshotFailure.cleanup(); }

const entrypointFailure = await makeCase({ contentEntrypoint: apiToken });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), entrypointFailure.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_SCRIPT_CONTENT/u);
  equal(entrypointFailure.wranglerCalls.length, 1);
  equal(entrypointFailure.api.calls.length, 9);
  equal((await readdir(entrypointFailure.paths.directory)).sort(), [
    'fresh-account-subdomain.json',
    'fresh-service-absence.json',
    `staging-bootstrap-${authorizationSha256}.json`,
    'wrangler-deploy-output.json',
  ]);
  equal(await readdir(entrypointFailure.temporaryRoot), []);
} finally { await entrypointFailure.cleanup(); }

for (const fixture of [
  { options: { existingCandidate: true }, preserved: 'candidate' },
  { options: { existingRecovery: true }, preserved: 'recovery' },
  { options: { partialFreshOutput: true }, preserved: 'partial' },
  { options: { claimCollision: true }, preserved: 'claim' },
  { options: { insecureEvidenceDirectory: true }, preserved: 'insecure-parent' },
]) {
  const preflightFailure = await makeCase(fixture.options);
  try {
    await rejects(() => executeBootstrapMutationCore(plan(), preflightFailure.dependencies),
      /CLOUDFLARE_E_BOOTSTRAP_OUTPUT_PREFLIGHT/u);
    equal(preflightFailure.api.calls.length, 0);
    equal(preflightFailure.wranglerCalls.length, 0);
    equal(preflightFailure.claimCalls.length, 0);
    equal(preflightFailure.gitCalls.length, 0);
    equal(await readdir(preflightFailure.temporaryRoot), []);
    if (fixture.preserved === 'candidate') {
      equal(await readFile(preflightFailure.paths.attestation.primary, 'utf8'), '{}\n');
    }
    if (fixture.preserved === 'recovery') {
      equal(await readFile(preflightFailure.paths.after.recovery, 'utf8'), '{}\n');
    }
    if (fixture.preserved === 'partial') {
      equal((await readFile(preflightFailure.paths.freshAbsence.primary)).length, 0);
    }
  } finally { await preflightFailure.cleanup(); }
}

const initialDirty = await makeCase({
  gitSnapshots: [{ ...goodGitSnapshot, clean: false }],
});
try {
  await rejects(() => executeBootstrapMutationCore(plan(), initialDirty.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_GIT/u);
  equal(initialDirty.gitCalls.length, 1);
  equal(initialDirty.api.calls.length, 0);
  equal(initialDirty.claimCalls.length, 0);
  equal(initialDirty.wranglerCalls.length, 0);
  equal(await readdir(initialDirty.paths.directory), []);
  equal(await readdir(initialDirty.temporaryRoot), []);
} finally { await initialDirty.cleanup(); }

for (const secondSnapshot of [
  { ...goodGitSnapshot, clean: false },
  { ...goodGitSnapshot, tree: '3'.repeat(40) },
]) {
  const gitRace = await makeCase({ gitSnapshots: [goodGitSnapshot, secondSnapshot] });
  try {
    await rejects(() => executeBootstrapMutationCore(plan(), gitRace.dependencies),
      /CLOUDFLARE_E_BOOTSTRAP_GIT/u);
    equal(gitRace.gitCalls.length, 2);
    equal(gitRace.api.calls.length, 2);
    equal(gitRace.claimCalls.length, 0);
    equal(gitRace.wranglerCalls.length, 0);
    equal((await readdir(gitRace.paths.directory)).sort(), [
      'fresh-account-subdomain.json', 'fresh-service-absence.json',
    ]);
    equal(await readdir(gitRace.temporaryRoot), []);
  } finally { await gitRace.cleanup(); }
}

const expiredInitially = await makeCase({
  nowOverride: () => new Date('2026-08-25T00:11:00.000Z'),
});
try {
  await rejects(() => executeBootstrapMutationCore(plan(), expiredInitially.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_EXPIRED/u);
  equal(expiredInitially.api.calls.length, 0);
  equal(expiredInitially.claimCalls.length, 0);
  equal(expiredInitially.wranglerCalls.length, 0);
  equal(expiredInitially.gitCalls.length, 0);
} finally { await expiredInitially.cleanup(); }

const initialInspectionExpiry = await makeCase({ expireDuringInitialGit: true });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), initialInspectionExpiry.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_EXPIRED/u);
  equal(initialInspectionExpiry.api.calls.length, 0);
  equal(initialInspectionExpiry.claimCalls.length, 0);
  equal(initialInspectionExpiry.wranglerCalls.length, 0);
  equal(initialInspectionExpiry.gitCalls.length, 1);
  equal(await readdir(initialInspectionExpiry.temporaryRoot), []);
} finally { await initialInspectionExpiry.cleanup(); }

const preClaimExpiry = await makeCase({ expireBeforeSecondBoundary: true });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), preClaimExpiry.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_EXPIRED/u);
  equal(preClaimExpiry.api.calls.length, 2);
  equal(preClaimExpiry.claimCalls.length, 0);
  equal(preClaimExpiry.wranglerCalls.length, 0);
  equal(preClaimExpiry.gitCalls.length, 2);
  equal(await readdir(preClaimExpiry.temporaryRoot), []);
} finally { await preClaimExpiry.cleanup(); }

const postClaimExpiry = await makeCase({ expireAfterClaim: true });
try {
  await rejects(() => executeBootstrapMutationCore(plan(), postClaimExpiry.dependencies),
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_EXPIRED/u);
  equal(postClaimExpiry.api.calls.length, 2);
  equal(postClaimExpiry.claimCalls.length, 1);
  equal(postClaimExpiry.wranglerCalls.length, 0);
  equal(postClaimExpiry.gitCalls.length, 3);
  equal((await readdir(postClaimExpiry.paths.directory)).sort(), [
    'fresh-account-subdomain.json',
    'fresh-service-absence.json',
    `staging-bootstrap-${authorizationSha256}.json`,
  ]);
  equal(await readdir(postClaimExpiry.temporaryRoot), []);
} finally { await postClaimExpiry.cleanup(); }

for (const finalSnapshot of [
  { ...goodGitSnapshot, clean: false },
  { ...goodGitSnapshot, tree: '4'.repeat(40) },
]) {
  const postClaimGitRace = await makeCase({
    gitSnapshots: [goodGitSnapshot, goodGitSnapshot, finalSnapshot],
  });
  try {
    await rejects(() => executeBootstrapMutationCore(plan(), postClaimGitRace.dependencies),
      /CLOUDFLARE_E_BOOTSTRAP_GIT/u);
    equal(postClaimGitRace.api.calls.length, 2);
    equal(postClaimGitRace.claimCalls.length, 1);
    equal(postClaimGitRace.wranglerCalls.length, 0);
    equal(postClaimGitRace.gitCalls.length, 3);
    equal((await readdir(postClaimGitRace.paths.directory)).sort(), [
      'fresh-account-subdomain.json',
      'fresh-service-absence.json',
      `staging-bootstrap-${authorizationSha256}.json`,
    ]);
    equal(await readdir(postClaimGitRace.temporaryRoot), []);
  } finally { await postClaimGitRace.cleanup(); }
}

const closeCleanupFailure = await makeCase({ cleanupCloseFailure: true });
try {
  const error = await rejection(
    () => executeBootstrapMutationCore(plan(), closeCleanupFailure.dependencies),
  );
  equal(error.message, 'CLOUDFLARE_E_BOOTSTRAP_CLEANUP');
  equal(error.message.includes(closeCleanupFailure.home), false);
  equal(error.message.includes(apiToken), false);
  equal(closeCleanupFailure.api.calls.length, 16);
  equal(closeCleanupFailure.wranglerCalls.length, 1);
  equal(await readdir(closeCleanupFailure.temporaryRoot), []);
} finally { await closeCleanupFailure.cleanup(); }

const deleteCleanupFailure = await makeCase({ cleanupDeleteFailure: true });
try {
  const error = await rejection(
    () => executeBootstrapMutationCore(plan(), deleteCleanupFailure.dependencies),
  );
  equal(error.message, 'CLOUDFLARE_E_BOOTSTRAP_CLEANUP');
  equal(error.message.includes(deleteCleanupFailure.home), false);
  equal(error.message.includes(apiToken), false);
  equal(deleteCleanupFailure.api.calls.length, 16);
  equal(deleteCleanupFailure.wranglerCalls.length, 1);
  equal((await readdir(deleteCleanupFailure.temporaryRoot)).length, 1);
} finally { await deleteCleanupFailure.cleanup(); }

const primaryAndCleanupFailure = await makeCase({
  execFailure: true, cleanupDeleteFailure: true,
});
try {
  const error = await rejection(
    () => executeBootstrapMutationCore(plan(), primaryAndCleanupFailure.dependencies),
  );
  equal(error.message, 'CLOUDFLARE_E_BOOTSTRAP_CLEANUP');
  equal(error.message.includes(primaryAndCleanupFailure.home), false);
  equal(error.message.includes(apiToken), false);
  equal(primaryAndCleanupFailure.api.calls.length, 2);
  equal(primaryAndCleanupFailure.wranglerCalls.length, 1);
  equal((await readdir(primaryAndCleanupFailure.temporaryRoot)).length, 1);
} finally { await primaryAndCleanupFailure.cleanup(); }

let invalidFetchCalls = 0;
let invalidWranglerCalls = 0;
for (const invalidDependencies of [
  undefined,
  {},
  {
    fetchImpl: async () => { invalidFetchCalls += 1; },
    execFileAsync: async () => { invalidWranglerCalls += 1; },
  },
]) {
  await rejects(() => executeBootstrapMutationCore(plan(), invalidDependencies),
    /CLOUDFLARE_E_BOOTSTRAP_EXECUTION_DEPENDENCIES/u);
}
equal(invalidFetchCalls, 0);
equal(invalidWranglerCalls, 0);

const invalidPlan = await makeCase();
try {
  await rejects(() => executeBootstrapMutationCore(
    { ...plan(), unexpected: true }, invalidPlan.dependencies,
  ), /CLOUDFLARE_E_BOOTSTRAP_EXECUTION_PLAN/u);
  equal(invalidPlan.api.calls.length, 0);
  equal(invalidPlan.wranglerCalls.length, 0);
  equal(invalidPlan.gitCalls.length, 0);
  equal(invalidPlan.outputPreflightCalls.length, 0);
} finally { await invalidPlan.cleanup(); }

for (const directInput of [undefined, plan()]) {
  await rejects(() => executeBootstrapMutationProduction(directInput),
    /CLOUDFLARE_E_BOOTSTRAP_STATUS_RECOVERY_REQUIRED/u);
}

ok(assertions > 200);
console.log(JSON.stringify({
  suite: 'cloudflare-deny-bootstrap-execution',
  assertions,
  fakeApiCalls,
  fakeWranglerProcesses,
  liveNetworkCalls: 0,
  externalWrites: 0,
  actualDeployments: 0,
  recoveryGuardStillRequired: true,
  status: 'PASS',
}, null, 2));
