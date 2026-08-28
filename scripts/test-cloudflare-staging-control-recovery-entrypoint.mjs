import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { accessSync, readFileSync } from 'node:fs';
import {
  chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  accountWorkersDevSubdomainRequestSha256,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  canonicalAccountWorkersDevSubdomainCapturePayload,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
  canonicalBootstrapAuthorizationPayload,
  canonicalServiceExistenceCapturePayload,
  canonicalServiceExistenceEvidencePayload,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  fetchAccountWorkersDevSubdomainCapture,
  fetchServiceExistenceCapture,
  serviceExistenceRequestSha256,
} from './lib/cloudflare-bootstrap.mjs';
import { bootstrapPreparedSha256 } from './lib/cloudflare-bootstrap-recovery.mjs';
import { loadBootstrapRecoveryLocalContext }
  from './lib/cloudflare-bootstrap-recovery-context.mjs';
import {
  canonicalBootstrapPreparedRecord, canonicalBootstrapStartedRecord,
  validateBootstrapStatusRecord,
} from './lib/cloudflare-bootstrap-attempt.mjs';
import {
  assertStagingControlOperationEnvelope,
  claimOneTimeAuthorization,
} from './lib/cloudflare-process.mjs';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import {
  cloudflareStagingControlPermissionContractSha256,
  cloudflareStagingControlTokenIdSha256,
  cloudflareStagingControlTokenSha256,
} from './lib/cloudflare-staging-control-token.mjs';
import {
  cloudflareAccountIdSha256, loadTrackedPublicMediaReleasePolicy, publicKeySpkiSha256,
} from './lib/public-media-manifest.mjs';
import { runCloudflareStagingControl } from './run-cloudflare-staging-control.mjs';
import { runCloudflareStagingControlWithTestHome }
  from './lib/test-only-cloudflare-staging-control.mjs';

const ROOT = process.cwd();
const execFileAsync = promisify(execFile);
const accountId = 'c'.repeat(32);
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const apiToken = `cfat_${'R'.repeat(40)}${'2'.repeat(8)}`;
const tokenId = `token_${'Q'.repeat(28)}`;
const apiTokenSha256 = cloudflareStagingControlTokenSha256(apiToken);
const tokenIdSha256 = cloudflareStagingControlTokenIdSha256(tokenId);
const permissionContractSha256
  = cloudflareStagingControlPermissionContractSha256(accountIdSha256);
const tokenNow = new Date('2026-08-28T05:00:00.000Z');
const versionId = '72345678-1234-4123-8123-123456789abc';
const exec = async (args, cwd) => (await execFileAsync('git', args, {
  cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
})).stdout.trim();
let assertions = 0;
let actualChildSpawns = 0;
let wranglerInvocations = 0;
let mutationRequests = 0;
let liveNetworkRequests = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message); assertions += 1;
};
const rejects = async (operation, pattern) => {
  await assert.rejects(operation, pattern); assertions += 1;
};

function response(result, { status = 200, success = true, errors = [] } = {}) {
  const body = JSON.stringify({ success, result, errors, messages: [] });
  return new Response(body, { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  } });
}

async function writeSigned(directory, name, payload, canonicalPayload, privateKey, publicKeyPem) {
  const receiptPath = path.join(directory, `${name}.json`);
  const signaturePath = path.join(directory, `${name}.sig`);
  const publicKeyPath = path.join(directory, `${name}.pem`);
  const signature = sign(null, Buffer.from(canonicalPayload(payload)), privateKey);
  await Promise.all([
    writeFile(receiptPath, `${canonicalPayload(payload)}\n`, { flag: 'wx', mode: 0o600 }),
    writeFile(signaturePath, `${signature.toString('base64')}\n`, { flag: 'wx', mode: 0o600 }),
    writeFile(publicKeyPath, publicKeyPem, { flag: 'wx', mode: 0o600 }),
  ]);
  return { receiptPath, signaturePath, publicKeyPath };
}

function signedEnvironment(service, subdomain, authorization) {
  return {
    CLOUDFLARE_SERVICE_EXISTENCE_RECEIPT_PATH: service.receiptPath,
    CLOUDFLARE_SERVICE_EXISTENCE_SIGNATURE_PATH: service.signaturePath,
    CLOUDFLARE_SERVICE_EXISTENCE_PUBLIC_KEY_PATH: service.publicKeyPath,
    CLOUDFLARE_ACCOUNT_SUBDOMAIN_RECEIPT_PATH: subdomain.receiptPath,
    CLOUDFLARE_ACCOUNT_SUBDOMAIN_SIGNATURE_PATH: subdomain.signaturePath,
    CLOUDFLARE_ACCOUNT_SUBDOMAIN_PUBLIC_KEY_PATH: subdomain.publicKeyPath,
    CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_RECEIPT_PATH: authorization.receiptPath,
    CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_SIGNATURE_PATH: authorization.signaturePath,
    CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_PUBLIC_KEY_PATH: authorization.publicKeyPath,
    CLOUDFLARE_DENY_BOOTSTRAP_RECOVERY_APPROVED:
      'staging:dwnc-me-staging:status-only',
  };
}

function phaseIdentity(plan, sourceGitTree) {
  return {
    environment: 'staging', workerName: 'dwnc-me-staging',
    accountIdSha256: plan.targetAccountIdSha256,
    authorizationSha256: plan.authorizationSha256,
    sourceGitSha: plan.sourceGitSha, sourceGitTree,
    denyWorkerSha256: plan.denyWorkerSha256,
    bootstrapConfigSha256: plan.bootstrapConfigSha256,
    serviceEvidenceSha256: plan.serviceEvidenceSha256,
    accountSubdomainEvidenceSha256: plan.accountSubdomainEvidenceSha256,
    commandArgumentsSha256: plan.commandArgumentsSha256,
  };
}

async function makeFixture(name, {
  started = true, result = 'partial', status = 'absent', remote = 'absent',
} = {}) {
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), `dwnc-recovery-${name}-`)));
  await chmod(temporary, 0o700);
  const repositoryRoot = path.join(temporary, 'repo');
  const evidence = path.join(temporary, 'evidence');
  const recoveryHome = path.join(temporary, 'home');
  await Promise.all([
    mkdir(repositoryRoot, { recursive: true, mode: 0o700 }),
    mkdir(evidence, { mode: 0o700 }), mkdir(recoveryHome, { mode: 0o700 }),
  ]);
  await Promise.all([
    cp(path.join(ROOT, 'scripts'), path.join(repositoryRoot, 'scripts'), { recursive: true }),
    cp(path.join(ROOT, 'src'), path.join(repositoryRoot, 'src'), { recursive: true }),
  ]);
  await symlink(path.join(ROOT, 'node_modules'), path.join(repositoryRoot, 'node_modules'), 'dir');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const policy = structuredClone(await loadTrackedPublicMediaReleasePolicy(ROOT));
  policy.staging.accountIdSha256 = accountIdSha256;
  policy.staging.releasePublicKeySpkiSha256 = publicKeySpkiSha256(publicKeyPem);
  await writeFile(
    path.join(repositoryRoot, 'src/data/public-media-release-policy-v1.json'),
    `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 },
  );
  await exec(['init', '-q'], repositoryRoot);
  await exec(['config', 'user.name', 'dwnc recovery fixture'], repositoryRoot);
  await exec(['config', 'user.email', 'recovery-fixture@invalid.example'], repositoryRoot);
  await exec(['add', '.'], repositoryRoot);
  await exec(['commit', '-qm', 'fixture'], repositoryRoot);
  const sourceGitSha = await exec(['rev-parse', 'HEAD'], repositoryRoot);
  const sourceGitTree = await exec(['rev-parse', 'HEAD^{tree}'], repositoryRoot);

  const serviceEvidence = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-service-existence-v1',
    environment: 'staging', workerName: 'dwnc-me-staging', accountIdSha256,
    exists: false, httpStatus: 404, rawEvidenceSha256: sha256Hex('signed-absence'),
    requestStartedAt: '2026-08-27T22:59:59.900Z',
    requestCompletedAt: '2026-08-27T23:00:00.000Z',
    observedAt: '2026-08-27T23:00:00.000Z',
    expiresAt: '2026-08-27T23:05:00.000Z',
  };
  const subdomainEvidence = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-account-workers-dev-subdomain-v1',
    environment: 'staging', workerName: 'dwnc-me-staging', accountIdSha256,
    accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    origin: 'https://dwnc-me-staging.dwnc.workers.dev',
    rawEvidenceSha256: sha256Hex('signed-subdomain'),
    requestStartedAt: '2026-08-27T22:59:59.900Z',
    requestCompletedAt: '2026-08-27T23:00:00.000Z',
    observedAt: '2026-08-27T23:00:00.000Z',
    expiresAt: '2026-08-27T23:05:00.000Z',
  };
  const authorization = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-bootstrap-authorization-v1',
    environment: 'staging', workerName: 'dwnc-me-staging', accountIdSha256,
    expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    sourceGitSha, denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256('staging'),
    serviceEvidenceSha256: sha256Hex(canonicalServiceExistenceEvidencePayload(serviceEvidence)),
    accountSubdomainEvidenceSha256:
      sha256Hex(canonicalAccountWorkersDevSubdomainEvidencePayload(subdomainEvidence)),
    freshAbsenceRequired: true,
    freshAbsenceRequestSha256: serviceExistenceRequestSha256({
      environment: 'staging', accountIdSha256,
    }),
    freshAccountSubdomainRequired: true,
    freshAccountSubdomainRequestSha256: accountWorkersDevSubdomainRequestSha256({
      environment: 'staging', accountIdSha256,
    }),
    maxFreshAbsenceAgeSeconds: 15, maxFreshAccountSubdomainAgeSeconds: 15,
    buildUuid: '82345678-1234-4123-8123-123456789abc',
    nonceSha256: sha256Hex(`fixture-${name}`),
    createdAt: '2026-08-27T23:00:00.100Z',
    expiresAt: '2026-08-27T23:10:00.000Z',
  };
  const [serviceFiles, subdomainFiles, authorizationFiles] = await Promise.all([
    writeSigned(evidence, 'service', serviceEvidence,
      canonicalServiceExistenceEvidencePayload, privateKey, publicKeyPem),
    writeSigned(evidence, 'subdomain', subdomainEvidence,
      canonicalAccountWorkersDevSubdomainEvidencePayload, privateKey, publicKeyPem),
    writeSigned(evidence, 'authorization', authorization,
      canonicalBootstrapAuthorizationPayload, privateKey, publicKeyPem),
  ]);
  const environment = signedEnvironment(serviceFiles, subdomainFiles, authorizationFiles);
  const context = await loadBootstrapRecoveryLocalContext({
    repositoryRoot, source: environment, policy, home: recoveryHome,
  });
  await mkdir(context.paths.directory, { recursive: true, mode: 0o700 });
  const identity = phaseIdentity(context.plan, sourceGitTree);
  const prepared = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-deny-bootstrap-prepared-v1',
    ...identity,
    runnerMetadataSha256: '1'.repeat(64),
    runnerPreflightSha256: '2'.repeat(64),
    runnerPermissionSha256: '3'.repeat(64),
    preparedAt: '2026-08-27T23:00:01.000Z',
  };
  await writeCanonicalEvidenceCreateOnly(
    context.paths.prepared, prepared, canonicalBootstrapPreparedRecord,
  );
  const captureClock = (() => {
    let milliseconds = Date.parse('2026-08-27T23:00:02.000Z');
    return () => new Date(milliseconds += 1);
  })();
  const captureFetch = async (url, options) => {
    if (options?.method !== 'GET') {
      mutationRequests += 1;
      throw new Error('TEST_E_MUTATION');
    }
    if (String(url).endsWith('/workers/services/dwnc-me-staging')) {
      return response(null, { status: 404, success: false,
        errors: [{ code: 10007, message: 'not found' }] });
    }
    if (String(url).endsWith('/workers/subdomain')) return response({ subdomain: 'dwnc' });
    throw new Error('TEST_E_CAPTURE_URL');
  };
  const freshAbsence = await fetchServiceExistenceCapture({
    environment: 'staging', accountId, apiToken, ttlSeconds: 15,
    fetchImpl: captureFetch, now: captureClock,
  });
  const freshSubdomain = await fetchAccountWorkersDevSubdomainCapture({
    environment: 'staging', accountId, apiToken, ttlSeconds: 15,
    fetchImpl: captureFetch, now: captureClock,
  });
  await writeCanonicalEvidenceCreateOnly(
    context.paths.freshAbsence.primary, freshAbsence,
    canonicalServiceExistenceCapturePayload,
  );
  await writeCanonicalEvidenceCreateOnly(
    context.paths.freshAccountSubdomain.primary, freshSubdomain,
    canonicalAccountWorkersDevSubdomainCapturePayload,
  );
  const preparedSha256 = bootstrapPreparedSha256(prepared);
  const freshAbsenceCaptureSha256
    = sha256Hex(canonicalServiceExistenceCapturePayload(freshAbsence));
  const freshAccountSubdomainCaptureSha256
    = sha256Hex(canonicalAccountWorkersDevSubdomainCapturePayload(freshSubdomain));
  const claimFile = await claimOneTimeAuthorization({
    directory: context.paths.directory, authorizationSha256: context.plan.authorizationSha256,
    scope: 'staging-bootstrap', target: 'dwnc-me-staging',
    binding: {
      ...identity, preparedSha256, freshAbsenceCaptureSha256,
      freshAccountSubdomainCaptureSha256,
    },
    now: () => new Date('2026-08-27T23:00:03.000Z'),
  });
  const claimBytes = await readFile(claimFile);
  const claimSha256 = sha256Hex(claimBytes.subarray(0, claimBytes.length - 1));
  claimBytes.fill(0);
  let startedRecord = null;
  if (started) {
    startedRecord = {
      schemaVersion: 1, contract: 'dwnc-cloudflare-deny-bootstrap-started-v1',
      ...identity, preparedSha256, claimSha256, freshAbsenceCaptureSha256,
      freshAccountSubdomainCaptureSha256,
      startedAt: '2026-08-27T23:00:04.000Z',
    };
    await writeCanonicalEvidenceCreateOnly(
      context.paths.started, startedRecord, canonicalBootstrapStartedRecord,
    );
  }
  if (result === 'partial') {
    await writeFile(context.paths.result, '', { flag: 'wx', mode: 0o600 });
  } else if (result === 'invalid') {
    await writeFile(context.paths.result,
      `${canonicalJson({ schemaVersion: 1, contract: 'dwnc-invalid-result-v1' })}\n`,
      { flag: 'wx', mode: 0o600 });
  }
  if (status === 'partial-primary') {
    await writeFile(context.paths.status.primary, '', { flag: 'wx', mode: 0o600 });
  }
  const stateLog = path.join(evidence, 'state-requests.ndjson');
  const preload = path.join(evidence, 'mock-state-fetch.mjs');
  const preloadSource = [
    "import { appendFileSync } from 'node:fs';",
    "import os from 'node:os';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const nativeUserInfo = os.userInfo;',
    'os.userInfo = () => ({ ...nativeUserInfo(), homedir: process.env.DWNC_TEST_NATIVE_HOME });',
    'syncBuiltinESMExports();',
    'const log = (role, method) => appendFileSync(process.env.DWNC_TEST_STATE_LOG,',
    "  `${JSON.stringify({ role, method })}\\n`, { encoding: 'utf8' });",
    'globalThis.fetch = async (input, options = {}) => {',
    "  const method = options.method ?? 'GET';",
    "  if (method !== 'GET') { log('mutation', method); throw new Error('TEST_E_MUTATION'); }",
    '  const url = new URL(input);',
    "  const prefix = `/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers`;",
    "  if (url.pathname === `${prefix}/services/dwnc-me-staging`) {",
    "    log('service-existence', method);",
    remote === 'absent'
      ? `    return new Response(${JSON.stringify(JSON.stringify({
        success: false, result: null, errors: [{ code: 10007, message: 'not found' }], messages: [],
      }))}, { status: 404, headers: { 'content-type': 'application/json', 'content-length': '${Buffer.byteLength(JSON.stringify({ success: false, result: null, errors: [{ code: 10007, message: 'not found' }], messages: [] }))}' } });`
      : "    return new Response(JSON.stringify({ success: true, result: { id: 'dwnc-me-staging' }, errors: [], messages: [] }), { status: 200, headers: { 'content-type': 'application/json' } });",
    '  }',
    ...(remote === 'pagination-invalid' ? [
      "  if (url.pathname === `${prefix}/scripts/dwnc-me-staging/deployments`) {",
      "    log('deployments', method);",
      `    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { deployments: [{ id: '92345678-1234-4123-8123-123456789abc', strategy: 'percentage', versions: [{ version_id: '${versionId}', percentage: 100 }], annotations: { 'workers/message': 'dwnc-deny-bootstrap:${context.plan.authorizationSha256}' } }] } }), { status: 200, headers: { 'content-type': 'application/json' } });`,
      '  }',
      "  if (url.pathname === `${prefix}/scripts/dwnc-me-staging/versions`) {",
      "    log('versions-page-1-invalid', method);",
      `    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { items: [{ id: '${versionId}' }] }, result_info: { page: 1, per_page: 50, count: 1, total_count: 51, total_pages: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });`,
      '  }',
    ] : []),
    "  log('unexpected', method);",
    "  throw new Error('TEST_E_UNEXPECTED_STATE_URL');",
    '};',
    '',
  ].join('\n');
  await writeFile(preload, preloadSource, { flag: 'wx', mode: 0o600 });
  return {
    temporary, repositoryRoot, evidence, recoveryHome, environment, context,
    sourceGitSha, sourceGitTree, prepared, startedRecord, stateLog, preload,
    accountTargetMetadataPath: path.join(evidence, 'account-target.json'),
    tokenMetadataPath: path.join(evidence, 'control-token.json'),
    async cleanup() { await rm(temporary, { recursive: true, force: true }); },
  };
}

function tokenMetadata() {
  return {
    apiTokenSha256, tokenIdSha256, accountIdSha256, permissionContractSha256,
  };
}

async function runActualRecovery(fixture, {
  countCredentials = null,
  afterLocalPrecheck = null,
} = {}) {
  const authenticationCalls = [];
  const childOutput = [];
  const fetchImpl = async (url, options = {}) => {
    authenticationCalls.push({ url: String(url), method: options.method ?? 'GET' });
    if ((options.method ?? 'GET') !== 'GET') mutationRequests += 1;
    if (String(url) === `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`) {
      return response({ id: tokenId, status: 'active',
        not_before: '2026-08-28T04:50:00.000Z', expires_on: '2026-08-28T07:00:00.000Z' });
    }
    if (String(url)
      === `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`) {
      return response({ subdomain: 'dwnc' });
    }
    liveNetworkRequests += 1;
    throw new Error('TEST_E_UNEXPECTED_AUTH_URL');
  };
  let result;
  let afterLocalPrecheckCalled = false;
  try {
    result = await runCloudflareStagingControlWithTestHome({
    argv: ['--command=staging-bootstrap-recover'], environment: fixture.environment,
    root: fixture.repositoryRoot,
    accountTargetMetadataPath: fixture.accountTargetMetadataPath,
    tokenMetadataPath: fixture.tokenMetadataPath,
    now: tokenNow, fetchImpl,
    loadAccountTarget: async () => {
      if (countCredentials) countCredentials.account += 1;
      if (afterLocalPrecheck !== null && !afterLocalPrecheckCalled) {
        afterLocalPrecheckCalled = true;
        await afterLocalPrecheck();
      }
      return { accountId, metadata: { accountIdSha256 } };
    },
    loadControlToken: async () => {
      if (countCredentials) countCredentials.token += 1;
      return { apiToken, metadata: tokenMetadata() };
    },
    requireWrangler: async () => {
      wranglerInvocations += 1; throw new Error('TEST_E_WRANGLER');
    },
    sealWrangler: async () => {
      wranglerInvocations += 1; throw new Error('TEST_E_WRANGLER');
    },
    execWrangler: async () => {
      wranglerInvocations += 1; throw new Error('TEST_E_WRANGLER');
    },
    spawnChild(command, args, options) {
      actualChildSpawns += 1;
      equal(command, process.execPath);
      const exactChildPath = path.join(
        fixture.repositoryRoot, 'scripts/recover-cloudflare-service-bootstrap.mjs',
      );
      equal(args, [exactChildPath, '--environment=staging']);
      accessSync(args[0]);
      equal(readFileSync(args[0]).equals(readFileSync(path.join(
        ROOT, 'scripts/recover-cloudflare-service-bootstrap.mjs',
      ))), true);
      equal(Object.hasOwn(options.env, 'CLOUDFLARE_BOOTSTRAP_RECOVERY_HOME'), false);
      equal(Object.hasOwn(options.env,
        'CLOUDFLARE_STAGING_CONTROL_AUTHENTICATION_GET_COUNT'), false);
      assert.throws(() => assertStagingControlOperationEnvelope({
        ...options.env,
        CLOUDFLARE_BOOTSTRAP_RECOVERY_HOME: fixture.recoveryHome,
      }, 'staging-bootstrap-recover'), /CLOUDFLARE_E_STAGING_CONTROL_ISOLATION/u);
      assertions += 1;
      const child = spawn(command, [
        `--import=${pathToFileURL(fixture.preload).href}`,
        ...args,
      ], {
        ...options,
        env: {
          ...options.env,
          DWNC_TEST_STATE_LOG: fixture.stateLog,
          DWNC_TEST_NATIVE_HOME: fixture.recoveryHome,
        },
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => childOutput.push(chunk.toString('utf8')));
      child.stderr.on('data', (chunk) => childOutput.push(chunk.toString('utf8')));
      return child;
    },
    }, fixture.recoveryHome);
  } catch (error) {
    const safeChildError = /CLOUDFLARE_E_[A-Z0-9_]+/u.exec(childOutput.join(''))?.[0]
      ?? 'TEST_E_CHILD_NO_SAFE_ERROR';
    throw new Error(`${error?.message ?? 'TEST_E_RUNNER'}:${safeChildError}`);
  }
  return { result, authenticationCalls, childOutput: childOutput.join('') };
}

async function assertForbiddenAuthenticationRequest(fixture, url, method = 'GET') {
  let underlyingFetches = 0;
  let children = 0;
  await rejects(() => runCloudflareStagingControlWithTestHome({
    argv: ['--command=staging-bootstrap-recover'], environment: fixture.environment,
    root: fixture.repositoryRoot,
    accountTargetMetadataPath: fixture.accountTargetMetadataPath,
    tokenMetadataPath: fixture.tokenMetadataPath,
    now: tokenNow,
    loadAccountTarget: async () => ({ accountId, metadata: { accountIdSha256 } }),
    loadControlToken: async () => ({ apiToken, metadata: tokenMetadata() }),
    verifyControlToken: async ({ fetchImpl: guardedFetch }) => {
      await guardedFetch(url, { method });
      throw new Error('TEST_E_FORBIDDEN_REQUEST_WAS_SENT');
    },
    fetchImpl: async () => {
      underlyingFetches += 1;
      throw new Error('TEST_E_FORBIDDEN_REQUEST_WAS_SENT');
    },
    spawnChild: () => { children += 1; throw new Error('TEST_E_CHILD'); },
  }, fixture.recoveryHome),
  /CLOUDFLARE_E_STAGING_CONTROL_PREFLIGHT/u);
  equal(underlyingFetches, 0);
  equal(children, 0);
}

async function assertRejectedChildOutput(fixture, output, {
  exitCode = 0,
  signal = null,
  pattern = /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT/u,
  registrationFailureOutput = null,
} = {}) {
  let children = 0;
  let authenticationGets = 0;
  await rejects(() => runCloudflareStagingControlWithTestHome({
    argv: ['--command=staging-bootstrap-recover'], environment: fixture.environment,
    root: fixture.repositoryRoot,
    accountTargetMetadataPath: fixture.accountTargetMetadataPath,
    tokenMetadataPath: fixture.tokenMetadataPath,
    now: tokenNow,
    loadAccountTarget: async () => ({ accountId, metadata: { accountIdSha256 } }),
    loadControlToken: async () => ({ apiToken, metadata: tokenMetadata() }),
    fetchImpl: async (url, options = {}) => {
      authenticationGets += 1;
      if ((options.method ?? 'GET') !== 'GET') throw new Error('TEST_E_MUTATION');
      if (String(url)
        === `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`) {
        return response({ id: tokenId, status: 'active',
          not_before: '2026-08-28T04:50:00.000Z',
          expires_on: '2026-08-28T07:00:00.000Z' });
      }
      if (String(url)
        === `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`) {
        return response({ subdomain: 'dwnc' });
      }
      throw new Error('TEST_E_AUTH_URL');
    },
    spawnChild(command, args, options) {
      children += 1;
      equal(command, process.execPath);
      equal(args, [path.join(fixture.repositoryRoot,
        'scripts/recover-cloudflare-service-bootstrap.mjs'), '--environment=staging']);
      equal(options.stdio, ['ignore', 'pipe', 'inherit', 'pipe']);
      const child = new EventEmitter();
      const stdout = new PassThrough();
      const tokenPipe = new PassThrough();
      child.stdout = stdout;
      child.stdio = [null, stdout, null, tokenPipe];
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        child.emit('close', exitCode, signal);
      };
      child.kill = () => { queueMicrotask(close); return true; };
      if (registrationFailureOutput === null) {
        tokenPipe.once('finish', () => {
          stdout.end(output);
          queueMicrotask(close);
        });
      } else {
        const nativeOn = stdout.on.bind(stdout);
        stdout.on = (event, listener) => {
          if (event === 'data') {
            nativeOn(event, listener);
            listener(registrationFailureOutput);
            return stdout;
          }
          if (event === 'error') throw new Error('TEST_E_STDOUT_LISTENER_REGISTRATION');
          return nativeOn(event, listener);
        };
      }
      return child;
    },
  }, fixture.recoveryHome), pattern);
  equal(authenticationGets, 2);
  equal(children, 1);
}

async function assertProductionOutputCopiesAreScrubbed(output, operation) {
  const tracked = [];
  const originalFrom = Buffer.from;
  const originalConcat = Buffer.concat;
  const producedInsideRunner = () => new Error().stack
    ?.includes('run-cloudflare-staging-control.mjs') === true;
  Buffer.from = function trackedFrom(...args) {
    const value = originalFrom.apply(Buffer, args);
    if (producedInsideRunner() && value.length === output.length && value.equals(output)) {
      tracked.push(value);
    }
    return value;
  };
  Buffer.concat = function trackedConcat(...args) {
    const value = originalConcat.apply(Buffer, args);
    if (producedInsideRunner() && value.length === output.length && value.equals(output)) {
      tracked.push(value);
    }
    return value;
  };
  try { await operation(); }
  finally {
    Buffer.from = originalFrom;
    Buffer.concat = originalConcat;
  }
  assert.ok(tracked.length >= 1); assertions += 1;
  for (const value of tracked) equal(value.every((byte) => byte === 0), true);
  equal(output.every((byte) => byte === 0), false);
}

async function assertLocalFailure(fixture, pattern) {
  const counts = { account: 0, token: 0, verify: 0, child: 0, fetch: 0, wrangler: 0 };
  await rejects(() => runCloudflareStagingControlWithTestHome({
    argv: ['--command=staging-bootstrap-recover'], environment: fixture.environment,
    root: fixture.repositoryRoot,
    accountTargetMetadataPath: fixture.accountTargetMetadataPath,
    tokenMetadataPath: fixture.tokenMetadataPath,
    loadAccountTarget: async () => { counts.account += 1; return {}; },
    loadControlToken: async () => { counts.token += 1; return {}; },
    verifyControlToken: async () => { counts.verify += 1; return {}; },
    requireWrangler: async () => { counts.wrangler += 1; return {}; },
    sealWrangler: async () => { counts.wrangler += 1; return {}; },
    execWrangler: async () => { counts.wrangler += 1; return {}; },
    fetchImpl: async () => { counts.fetch += 1; throw new Error('TEST_E_FETCH'); },
    spawnChild: () => { counts.child += 1; throw new Error('TEST_E_CHILD'); },
  }, fixture.recoveryHome), pattern);
  equal(counts, { account: 0, token: 0, verify: 0, child: 0, fetch: 0, wrangler: 0 });
}

const fixtures = [];
try {
  const primary = await makeFixture('primary', { result: 'partial' });
  fixtures.push(primary);
  const primaryRun = await runActualRecovery(primary);
  equal(primaryRun.result.classification, 'absent-after-start');
  equal(primaryRun.result.currentInvocationRequestCounts.GET, 4);
  equal(primaryRun.result.recordedRequestCounts.GET, 4);
  equal(primaryRun.authenticationCalls.map(({ url, method }) => ({ url, method })), [
    { url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
      method: 'GET' },
    { url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
      method: 'GET' },
  ]);
  const primaryStatus = JSON.parse(await readFile(primary.context.paths.status.primary, 'utf8'));
  validateBootstrapStatusRecord(primaryStatus); assertions += 1;
  equal(primaryStatus.authenticationRequestCounts.GET, 2);
  equal(primaryStatus.stateRequestCounts.GET, 2);
  equal(primaryStatus.requestCounts.GET, 4);
  equal(primaryStatus.wranglerInvocations, 0);
  equal(primaryStatus.recoveryRunnerMetadataSha256 === primary.prepared.runnerMetadataSha256,
    false);
  const primaryStateCalls = (await readFile(primary.stateLog, 'utf8')).trim()
    .split('\n').map((line) => JSON.parse(line));
  equal(primaryStateCalls, [
    { role: 'service-existence', method: 'GET' },
    { role: 'service-existence', method: 'GET' },
  ]);
  equal(primaryRun.childOutput.includes(apiToken), false);
  equal(primaryRun.childOutput.includes(accountId), false);
  equal(primaryRun.childOutput.includes(primary.recoveryHome), false);

  const authGuard = await makeFixture('auth-guard', { result: 'partial' });
  fixtures.push(authGuard);
  for (const [url, method] of [
    ['https://api.cloudflare.com/client/v4/user/tokens/verify', 'GET'],
    ['https://api.cloudflare.com/client/v4/accounts', 'GET'],
    ['https://api.cloudflare.com/client/v4/memberships', 'GET'],
    [`https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`, 'POST'],
    [`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/`
      + 'dwnc-me-staging', 'GET'],
  ]) await assertForbiddenAuthenticationRequest(authGuard, url, method);

  let overrideAccesses = 0;
  await rejects(() => runCloudflareStagingControl({
    argv: ['--command=staging-bootstrap-recover'], environment: primary.environment,
    root: primary.repositoryRoot, recoveryHome: primary.recoveryHome,
    loadPolicy: async () => { overrideAccesses += 1; return {}; },
  }), /CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT/u);
  await rejects(() => runCloudflareStagingControl({
    argv: ['--command=staging-bootstrap-recover',
      `--recovery-home=${primary.recoveryHome}`],
    environment: primary.environment, root: primary.repositoryRoot,
    loadPolicy: async () => { overrideAccesses += 1; return {}; },
  }), /CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT/u);
  await rejects(() => runCloudflareStagingControlWithTestHome({
    argv: ['--command=staging-bootstrap-recover'],
    environment: {
      ...primary.environment,
      CLOUDFLARE_BOOTSTRAP_RECOVERY_HOME: primary.recoveryHome,
    },
    root: primary.repositoryRoot,
    loadPolicy: async () => { overrideAccesses += 1; return {}; },
  }, primary.recoveryHome),
  /CLOUDFLARE_E_STAGING_CONTROL_PARENT_CREDENTIAL/u);
  equal(overrideAccesses, 0);

  const childOutputGuard = await makeFixture('child-output-guard', { result: 'partial' });
  fixtures.push(childOutputGuard);
  const listenerFailureOutput = Buffer.alloc(129, 0x77);
  await assertProductionOutputCopiesAreScrubbed(listenerFailureOutput,
    () => assertRejectedChildOutput(childOutputGuard, listenerFailureOutput, {
      registrationFailureOutput: listenerFailureOutput,
    }));
  await assertRejectedChildOutput(childOutputGuard, '{"not":"canonical-contract"}\n');
  const oversizedOutput = Buffer.alloc(4 * 1024 + 1, 0x78);
  await assertProductionOutputCopiesAreScrubbed(oversizedOutput,
    () => assertRejectedChildOutput(childOutputGuard, oversizedOutput));
  const nonzeroOutput = Buffer.alloc(257, 0x79);
  await assertProductionOutputCopiesAreScrubbed(nonzeroOutput,
    () => assertRejectedChildOutput(childOutputGuard, nonzeroOutput, {
      exitCode: 1,
      pattern: /CLOUDFLARE_E_STAGING_CONTROL_CHILD/u,
    }));
  await assertRejectedChildOutput(childOutputGuard, `${canonicalJson({
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-deny-bootstrap-recovery-result-v1',
    classification: 'absent-after-start',
    versionId: null,
    deploymentId: null,
    existing: false,
    recordedRequestCounts: {
      GET: 4, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0,
    },
    currentStateRequestCounts: {
      GET: 1, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0,
    },
  })}\n`);

  const noCredentials = { account: 0, token: 0 };
  const second = await runCloudflareStagingControlWithTestHome({
    argv: ['--command=staging-bootstrap-recover'], environment: primary.environment,
    root: primary.repositoryRoot,
    accountTargetMetadataPath: primary.accountTargetMetadataPath,
    tokenMetadataPath: primary.tokenMetadataPath,
    loadAccountTarget: async () => { noCredentials.account += 1; throw new Error('bad'); },
    loadControlToken: async () => { noCredentials.token += 1; throw new Error('bad'); },
    verifyControlToken: async () => { throw new Error('bad'); },
    requireWrangler: async () => { throw new Error('bad'); },
    spawnChild: () => { throw new Error('bad'); },
    fetchImpl: async () => { throw new Error('bad'); },
  }, primary.recoveryHome);
  equal(second.existing, true);
  equal(second.currentInvocationRequestCounts.GET, 0);
  equal(second.recordedRequestCounts.GET, 4);
  equal(noCredentials, { account: 0, token: 0 });

  const recoverySlot = await makeFixture('recovery-slot', {
    result: 'partial', status: 'partial-primary',
  });
  fixtures.push(recoverySlot);
  const recoveryRun = await runActualRecovery(recoverySlot);
  equal(recoveryRun.result.classification, 'absent-after-start');
  validateBootstrapStatusRecord(JSON.parse(
    await readFile(recoverySlot.context.paths.status.recovery, 'utf8'),
  )); assertions += 1;
  const recoveryAgain = await runCloudflareStagingControlWithTestHome({
    argv: ['--command=staging-bootstrap-recover'], environment: recoverySlot.environment,
    root: recoverySlot.repositoryRoot,
    accountTargetMetadataPath: recoverySlot.accountTargetMetadataPath,
    tokenMetadataPath: recoverySlot.tokenMetadataPath,
    loadAccountTarget: async () => { throw new Error('TEST_E_CREDENTIAL'); },
    loadControlToken: async () => { throw new Error('TEST_E_CREDENTIAL'); },
  }, recoverySlot.recoveryHome);
  equal(recoveryAgain.existing, true);
  equal(recoveryAgain.currentInvocationRequestCounts.GET, 0);

  const race = await makeFixture('race', { result: 'partial' });
  fixtures.push(race);
  const raceSpawnStart = actualChildSpawns;
  let winningRun = null;
  const raceRun = await runActualRecovery(race, {
    afterLocalPrecheck: async () => { winningRun = await runActualRecovery(race); },
  });
  equal(winningRun.result.existing, false);
  equal(winningRun.result.currentInvocationRequestCounts.GET, 4);
  equal(raceRun.result.existing, true);
  equal(raceRun.result.recordedRequestCounts.GET, 4);
  equal(raceRun.result.currentInvocationRequestCounts.GET, 2);
  equal(actualChildSpawns - raceSpawnStart, 2);
  const raceStateCalls = (await readFile(race.stateLog, 'utf8')).trim()
    .split('\n').map((line) => JSON.parse(line));
  equal(raceStateCalls, [
    { role: 'service-existence', method: 'GET' },
    { role: 'service-existence', method: 'GET' },
  ]);

  const invalidResult = await makeFixture('invalid-result', { result: 'invalid' });
  fixtures.push(invalidResult);
  await assertLocalFailure(invalidResult, /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE/u);

  const absentStartedPartialResult = await makeFixture('absent-started', {
    started: false, result: 'partial',
  });
  fixtures.push(absentStartedPartialResult);
  await assertLocalFailure(absentStartedPartialResult,
    /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE/u);

  const brokenClaim = await makeFixture('broken-claim', { result: 'partial' });
  fixtures.push(brokenClaim);
  const brokenClaimPath = path.join(
    brokenClaim.context.paths.directory,
    `staging-bootstrap-${brokenClaim.context.plan.authorizationSha256}.json`,
  );
  await writeFile(brokenClaimPath, '{}\n', { mode: 0o600 });
  await assertLocalFailure(brokenClaim, /CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PHASE/u);

  const unsafeStatus = await makeFixture('unsafe-status', { result: 'partial' });
  fixtures.push(unsafeStatus);
  const outside = path.join(unsafeStatus.evidence, 'outside-status.json');
  await writeFile(outside, '', { flag: 'wx', mode: 0o600 });
  await symlink(outside, unsafeStatus.context.paths.status.primary);
  await assertLocalFailure(unsafeStatus,
    /CLOUDFLARE_E_ACCOUNT_STORE_LOCATION/u);

  const nonemptyStatus = await makeFixture('nonempty-status', {
    result: 'partial', status: 'partial-primary',
  });
  fixtures.push(nonemptyStatus);
  await writeFile(nonemptyStatus.context.paths.status.recovery, 'occupied\n', {
    flag: 'wx', mode: 0o600,
  });
  await assertLocalFailure(nonemptyStatus,
    /CLOUDFLARE_E_BOOTSTRAP_STATUS_RECOVERY_EXHAUSTED/u);

  const pagination = await makeFixture('pagination', {
    result: 'partial', remote: 'pagination-invalid',
  });
  fixtures.push(pagination);
  const paginationRun = await runActualRecovery(pagination);
  equal(paginationRun.result.classification, 'ambiguous');
  const paginationStatus = JSON.parse(
    await readFile(pagination.context.paths.status.primary, 'utf8'),
  );
  equal(paginationStatus.stateRequestCounts.GET, 6);
  equal(paginationStatus.requestCounts.GET, 8);
  equal(paginationStatus.observationA.state, 'invalid');
  equal(paginationStatus.observationB.state, 'invalid');
  const paginationCalls = (await readFile(pagination.stateLog, 'utf8')).trim()
    .split('\n').map((line) => JSON.parse(line));
  equal(paginationCalls, [
    { role: 'service-existence', method: 'GET' },
    { role: 'deployments', method: 'GET' },
    { role: 'versions-page-1-invalid', method: 'GET' },
    { role: 'service-existence', method: 'GET' },
    { role: 'deployments', method: 'GET' },
    { role: 'versions-page-1-invalid', method: 'GET' },
  ]);
  equal(paginationCalls.some(({ method }) => method !== 'GET'), false);
  equal(primaryRun.authenticationCalls.some(({ url }) => {
    const pathname = new URL(url).pathname;
    return pathname === '/client/v4/accounts' || pathname === '/client/v4/accounts/'
      || pathname.startsWith('/client/v4/user') || pathname.includes('/memberships');
  }), false);
} finally {
  for (const fixture of fixtures.reverse()) await fixture.cleanup();
}

equal(wranglerInvocations, 0);
equal(mutationRequests, 0);
equal(liveNetworkRequests, 0);
equal(actualChildSpawns, 5);
console.log(JSON.stringify({
  suite: 'cloudflare-staging-bootstrap-recovery-entrypoint', assertions,
  actualChildSpawns, wranglerInvocations, mutationRequests, liveNetworkRequests,
  realKeychainCalls: 0, realClipboardCalls: 0, actualDeployments: 0, status: 'PASS',
}, null, 2));
