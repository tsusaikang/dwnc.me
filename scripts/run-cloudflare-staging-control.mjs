import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  assertCloudflareAccountTarget,
  assertPinnedWranglerEntrypointInstalled,
  assertPinnedWranglerDescriptor,
  assertSealedWranglerDescriptor,
  cloudflareStagingWranglerEnvironment,
  encodeCloudflareControlPlaneTokenFrame,
  installStructuredErrorHandler,
  sanitizedEnvironment,
  sealPinnedWranglerRuntime,
  writeAnonymousInheritedInput,
} from './lib/cloudflare-process.mjs';
import {
  assertCloudflareAccountTargetOutsideRepository,
  defaultCloudflareAccountTargetMetadataPath,
  loadCloudflareAccountTarget,
} from './lib/cloudflare-account-target.mjs';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination, readSecureFile,
} from './lib/cloudflare-signing-key.mjs';
import { inspectExistingBootstrapRecoveryStatus }
  from './lib/cloudflare-bootstrap-recovery.mjs';
import {
  canonicalBootstrapRecoveryChildResult,
  emptyBootstrapRequestCounts,
  validateBootstrapRecoveryChildResult,
} from './lib/cloudflare-bootstrap-recovery.mjs';
import { loadBootstrapRecoveryLocalContext }
  from './lib/cloudflare-bootstrap-recovery-context.mjs';
import {
  defaultCloudflareStagingControlTokenMetadataPath,
  cloudflareStagingControlTokenRecoveryMetadataPath,
  loadCloudflareStagingControlToken,
  verifyCloudflareStagingControlToken,
} from './lib/cloudflare-staging-control-token.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMANDS = Object.freeze({
  'staging-service-existence': Object.freeze({
    integrated: true,
    script: 'scripts/fetch-cloudflare-service-existence.mjs',
    args: ['--environment=staging'],
    pathVariables: [
      'CLOUDFLARE_SERVICE_EXISTENCE_EVIDENCE_PATH',
      'CLOUDFLARE_SERVICE_EXISTENCE_CAPTURE_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_EVIDENCE_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_CAPTURE_PATH',
    ],
    createOnlyPathVariables: [
      'CLOUDFLARE_SERVICE_EXISTENCE_EVIDENCE_PATH',
      'CLOUDFLARE_SERVICE_EXISTENCE_CAPTURE_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_EVIDENCE_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_CAPTURE_PATH',
    ],
    valueVariables: [],
  }),
  'staging-bootstrap': Object.freeze({
    integrated: true,
    script: 'scripts/bootstrap-cloudflare-service.mjs',
    args: ['--environment=staging'],
    pathVariables: [
      'CLOUDFLARE_SERVICE_EXISTENCE_RECEIPT_PATH',
      'CLOUDFLARE_SERVICE_EXISTENCE_SIGNATURE_PATH',
      'CLOUDFLARE_SERVICE_EXISTENCE_PUBLIC_KEY_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_RECEIPT_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_SIGNATURE_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_PUBLIC_KEY_PATH',
      'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_RECEIPT_PATH',
      'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_SIGNATURE_PATH',
      'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_PUBLIC_KEY_PATH',
    ],
    createOnlyPathVariables: [],
    valueVariables: ['CLOUDFLARE_DENY_BOOTSTRAP_APPROVED'],
    fixedValues: Object.freeze({
      CLOUDFLARE_DENY_BOOTSTRAP_APPROVED:
        'staging:dwnc-me-staging:workers-dev-disabled',
    }),
  }),
  'staging-bootstrap-recover': Object.freeze({
    integrated: true,
    script: 'scripts/recover-cloudflare-service-bootstrap.mjs',
    args: ['--environment=staging'],
    pathVariables: [
      'CLOUDFLARE_SERVICE_EXISTENCE_RECEIPT_PATH',
      'CLOUDFLARE_SERVICE_EXISTENCE_SIGNATURE_PATH',
      'CLOUDFLARE_SERVICE_EXISTENCE_PUBLIC_KEY_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_RECEIPT_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_SIGNATURE_PATH',
      'CLOUDFLARE_ACCOUNT_SUBDOMAIN_PUBLIC_KEY_PATH',
      'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_RECEIPT_PATH',
      'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_SIGNATURE_PATH',
      'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_PUBLIC_KEY_PATH',
    ],
    createOnlyPathVariables: [],
    valueVariables: ['CLOUDFLARE_DENY_BOOTSTRAP_RECOVERY_APPROVED'],
    fixedValues: Object.freeze({
      CLOUDFLARE_DENY_BOOTSTRAP_RECOVERY_APPROVED:
        'staging:dwnc-me-staging:status-only',
    }),
  }),
  'staging-version-upload': Object.freeze({ integrated: false }),
  'staging-version-detail': Object.freeze({ integrated: false }),
  'staging-deployment-status': Object.freeze({ integrated: false }),
  'staging-activate': Object.freeze({ integrated: false }),
  'staging-workers-dev-status': Object.freeze({
    integrated: true,
    script: 'scripts/fetch-cloudflare-staging-workers-dev-status.mjs',
    args: [],
    pathVariables: [
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH',
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH',
    ],
    createOnlyPathVariables: [
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH',
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH',
    ],
    valueVariables: [],
  }),
  'staging-workers-dev-enable': Object.freeze({ integrated: false }),
});
const FORBIDDEN_PARENT_CREDENTIALS = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN_FD',
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_CREDENTIALS_FD',
  'CLOUDFLARE_BOOTSTRAP_RECOVERY_HOME',
  'CLOUDFLARE_STAGING_CONTROL_AUTHENTICATION_GET_COUNT',
]);
const DEFAULT_CHILD_EXECUTION_TIMEOUT_MS = 120_000;
const DEFAULT_CHILD_TERMINATION_TIMEOUT_MS = 2_000;
const DEFAULT_CHILD_FORCE_KILL_TIMEOUT_MS = 2_000;
const MAX_RECOVERY_CHILD_STDOUT_BYTES = 4 * 1024;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateChildTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10 * 60 * 1000) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
  }
  return value;
}

function observeChild(child) {
  if (!child || typeof child.once !== 'function' || typeof child.removeListener !== 'function'
    || typeof child.kill !== 'function') {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_CHILD');
  }
  let spawnError = null;
  let settled = false;
  let resolveError;
  let resolveTermination;
  const errorSignal = new Promise((resolve) => { resolveError = resolve; });
  const termination = new Promise((resolve) => { resolveTermination = resolve; });
  const onError = (error) => {
    spawnError = error instanceof Error ? error : new Error('child spawn error');
    resolveError(spawnError);
  };
  const finish = (code, signal) => {
    if (settled) return;
    settled = true;
    child.removeListener('close', onClose);
    child.removeListener('error', onError);
    resolveTermination({ event: 'close', code, signal });
  };
  // `exit` can precede the closing of inherited descriptors. Only `close`
  // proves that the child and its stdio are finished and cleanup is safe.
  const onClose = (code, signal) => finish(code, signal);
  child.once('error', onError);
  child.once('close', onClose);
  return {
    errorSignal,
    termination,
    getSpawnError: () => spawnError,
    release() {
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
    },
  };
}

async function boundedWait(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false, value })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function closeTokenWriteDescriptor(stream) {
  if (!stream) return;
  try {
    // Calling destroy() after a successful end() changes the inherited socket's
    // mode to read-only on macOS before the child can inspect it. Leave an
    // already-ended descriptor alone; end an open descriptor normally.
    if (!stream.destroyed && !stream.writableEnded && typeof stream.end === 'function') {
      stream.end();
    }
  } catch { /* the child termination check below remains authoritative */ }
}

function observeRecoveryChildStdout(child) {
  const stream = child?.stdout;
  if (!stream || typeof stream.on !== 'function' || typeof stream.removeListener !== 'function') {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
  }
  const chunks = [];
  let combined = null;
  let totalBytes = 0;
  let oversized = false;
  let streamFailed = false;
  let scrubbed = false;
  let resolveStreamError;
  const errorSignal = new Promise((resolve) => { resolveStreamError = resolve; });
  const scrub = (extra = null) => {
    if (Buffer.isBuffer(extra)) extra.fill(0);
    if (scrubbed) return;
    scrubbed = true;
    combined?.fill(0);
    combined = null;
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
  };
  const onData = (chunk) => {
    let bytes = null;
    try {
      bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk));
      totalBytes = Math.min(MAX_RECOVERY_CHILD_STDOUT_BYTES + 1, totalBytes + bytes.length);
      if (!scrubbed && totalBytes <= MAX_RECOVERY_CHILD_STDOUT_BYTES) chunks.push(bytes);
      else {
        oversized = true;
        scrub(bytes);
      }
    } catch (error) {
      scrub(bytes);
      onError(error);
    }
  };
  const onError = (error) => {
    streamFailed = true;
    scrub();
    resolveStreamError(error instanceof Error ? error : new Error('child stdout error'));
  };
  try {
    stream.on('data', onData);
    stream.on('error', onError);
  } catch {
    try { stream.removeListener('data', onData); } catch { /* scrubbed handler is harmless */ }
    try { stream.removeListener('error', onError); } catch { /* scrubbed handler is harmless */ }
    scrub();
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
  }
  return {
    errorSignal,
    parse() {
      try {
        if (streamFailed || oversized || totalBytes < 1
          || totalBytes > MAX_RECOVERY_CHILD_STDOUT_BYTES) {
          throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
        }
        combined = Buffer.concat(chunks, totalBytes);
        if (combined.length < 3 || combined.at(-1) !== 0x0a
          || combined.at(-2) === 0x0a || combined.at(-2) === 0x0d) {
          throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
        }
        const canonicalBytes = combined.subarray(0, combined.length - 1);
        if (canonicalBytes.includes(0x0a) || canonicalBytes.includes(0x0d)) {
          throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
        }
        let text;
        let payload;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes);
          payload = JSON.parse(text);
        } catch { throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT'); }
        const value = validateBootstrapRecoveryChildResult(payload);
        if (canonicalBootstrapRecoveryChildResult(value) !== text) {
          throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
        }
        return value;
      } catch {
        throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
      } finally { scrub(); }
    },
    release() {
      try { stream.removeListener('data', onData); } catch { /* scrub still has priority */ }
      try { stream.removeListener('error', onError); } catch { /* scrub still has priority */ }
      scrub();
    },
  };
}

function addRequestCounts(left, right) {
  const output = emptyBootstrapRequestCounts();
  for (const key of Object.keys(output)) output[key] = left[key] + right[key];
  return output;
}

async function terminateChild(child, lifecycle, tokenPipe, {
  terminationTimeoutMs,
  forceKillTimeoutMs,
}) {
  closeTokenWriteDescriptor(tokenPipe);
  try { child.kill('SIGTERM'); } catch { /* continue to the bounded wait */ }
  let observed = await boundedWait(lifecycle.termination, terminationTimeoutMs);
  if (!observed.timedOut) return observed.value;
  try { child.kill('SIGKILL'); } catch { /* continue to the final bounded wait */ }
  observed = await boundedWait(lifecycle.termination, forceKillTimeoutMs);
  if (observed.timedOut) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_CHILD_LIFECYCLE');
  }
  return observed.value;
}

async function createIsolatedAuthenticationRoot(parent = '/private/tmp') {
  if (typeof parent !== 'string' || !path.isAbsolute(parent)) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ISOLATION');
  }
  let root = null;
  try {
    root = await realpath(await mkdtemp(path.join(parent, 'dwnc-staging-control-')));
    await chmod(root, 0o700);
    const home = path.join(root, 'home');
    const xdgConfig = path.join(root, 'xdg-config');
    const xdgCache = path.join(root, 'xdg-cache');
    const xdgData = path.join(root, 'xdg-data');
    const temporary = path.join(root, 'tmp');
    const envFile = path.join(root, 'empty.env');
    await Promise.all([home, xdgConfig, xdgCache, xdgData, temporary]
      .map((directory) => mkdir(directory, { mode: 0o700 })));
    const envHandle = await open(envFile, 'wx', 0o600);
    await envHandle.close();
    const stats = await Promise.all([root, home, xdgConfig, xdgCache, xdgData, temporary]
      .map((directory) => lstat(directory)));
    if (stats.some((entry) => !entry.isDirectory() || entry.isSymbolicLink()
      || (entry.mode & 0o777) !== 0o700
      || typeof process.getuid === 'function' && entry.uid !== process.getuid())) {
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ISOLATION');
    }
    const envStats = await lstat(envFile);
    if (!envStats.isFile() || envStats.isSymbolicLink() || envStats.nlink !== 1
      || envStats.size !== 0 || (envStats.mode & 0o777) !== 0o600
      || typeof process.getuid === 'function' && envStats.uid !== process.getuid()) {
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ISOLATION');
    }
    return { root, home, xdgConfig, xdgCache, xdgData, temporary, envFile };
  } catch {
    if (root !== null) await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ISOLATION');
  }
}

function operationEnvironment(source, auth, accountId, operation,
  metadataSha256, preflightSha256, selected, {
    accountIdSha256 = '0'.repeat(64),
    apiTokenSha256 = '0'.repeat(64),
    permissionContractSha256 = '0'.repeat(64),
  } = {}) {
  const selectedValues = {};
  for (const name of selected.pathVariables) {
    const value = source[name];
    if (typeof value !== 'string' || !path.isAbsolute(value)
      || path.resolve(value) !== value) {
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
    }
    selectedValues[name] = value;
  }
  if (new Set(selected.pathVariables.map((name) => source[name])).size
    !== selected.pathVariables.length) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
  }
  for (const name of selected.valueVariables) {
    const value = source[name];
    if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || /[\u0000-\u001f\u007f]/u.test(value)
      || selected.fixedValues?.[name] !== undefined
        && selected.fixedValues[name] !== value) {
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
    }
    selectedValues[name] = value;
  }
  return sanitizedEnvironment(source, {
    ...selectedValues,
    PATH: '/usr/bin:/bin',
    HOME: auth.home,
    TMPDIR: auth.temporary,
    TMP: auth.temporary,
    TEMP: auth.temporary,
    XDG_CONFIG_HOME: auth.xdgConfig,
    XDG_CACHE_HOME: auth.xdgCache,
    XDG_DATA_HOME: auth.xdgData,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN_FD: '3',
    CLOUDFLARE_STAGING_CONTROL_VERIFIED: 'v1',
    CLOUDFLARE_STAGING_CONTROL_OPERATION: operation,
    CLOUDFLARE_STAGING_CONTROL_METADATA_SHA256: metadataSha256,
    CLOUDFLARE_STAGING_CONTROL_PREFLIGHT_SHA256: preflightSha256,
    CLOUDFLARE_STAGING_CONTROL_ACCOUNT_SHA256: accountIdSha256,
    CLOUDFLARE_STAGING_CONTROL_TOKEN_SHA256: apiTokenSha256,
    CLOUDFLARE_STAGING_CONTROL_PERMISSION_SHA256: permissionContractSha256,
    CLOUDFLARE_STAGING_CONTROL_AUTH_ROOT: auth.root,
    CLOUDFLARE_STAGING_CONTROL_ENV_FILE: auth.envFile,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    WRANGLER_WRITE_LOGS: '0',
    WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
    CI: '1',
    NO_COLOR: '1',
  });
}

function validateWhoami(stdout, accountId) {
  let value;
  try { value = JSON.parse(stdout); }
  catch { throw new Error('CLOUDFLARE_E_STAGING_CONTROL_WHOAMI'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.loggedIn !== true || value.authType !== 'Account API Token'
    || !Array.isArray(value.accounts) || value.accounts.length !== 1
    || value.accounts[0]?.id !== accountId
    || typeof value.accounts[0]?.name !== 'string'
    || value.accounts[0].name.length === 0
    || JSON.stringify(value).includes('OAuth Token')) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_WHOAMI');
  }
  return {
    loggedIn: true,
    authType: 'Account API Token',
    accountIdSha256: sha256(`cloudflare-account-id-v1\0${accountId}`),
  };
}

async function inspectRecoveryGit(repositoryRoot) {
  const run = async (args) => (await promisify(execFile)('git', args, {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  })).stdout.trim();
  const [commit, tree, status] = await Promise.all([
    run(['rev-parse', 'HEAD']), run(['rev-parse', 'HEAD^{tree}']),
    run(['status', '--porcelain=v1', '--untracked-files=normal']),
  ]);
  return { commit, tree, clean: status.length === 0 };
}

export async function runCloudflareStagingControl(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.hasOwn(options, 'recoveryHome')
    || Object.hasOwn(options, 'testOnlyRecoveryHome')) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
  }
  const {
    argv = process.argv.slice(2),
    environment = process.env,
    root = process.cwd(),
    accountTargetMetadataPath,
    tokenMetadataPath,
    loadPolicy = loadTrackedPublicMediaReleasePolicy,
    loadAccountTarget = loadCloudflareAccountTarget,
    loadControlToken = loadCloudflareStagingControlToken,
    verifyControlToken = verifyCloudflareStagingControlToken,
    requireWrangler = assertPinnedWranglerEntrypointInstalled,
    sealWrangler = sealPinnedWranglerRuntime,
    fetchImpl = globalThis.fetch,
    execWrangler = promisify(execFile),
    spawnChild = spawn,
    createAuth = createIsolatedAuthenticationRoot,
    cleanupAuth = async (auth) => rm(auth.root, { recursive: true, force: true }),
    assertDestination = assertSecureCreateOnlyDestination,
    loadRecoveryContext = loadBootstrapRecoveryLocalContext,
    inspectRecoveryStatus = inspectExistingBootstrapRecoveryStatus,
    inspectRecoveryGitState = inspectRecoveryGit,
    childExecutionTimeoutMs = DEFAULT_CHILD_EXECUTION_TIMEOUT_MS,
    childTerminationTimeoutMs = DEFAULT_CHILD_TERMINATION_TIMEOUT_MS,
    childForceKillTimeoutMs = DEFAULT_CHILD_FORCE_KILL_TIMEOUT_MS,
    now = new Date(),
  } = options;
  const recoveryHome = userInfo().homedir;
  if (typeof recoveryHome !== 'string' || !path.isAbsolute(recoveryHome)
    || path.resolve(recoveryHome) !== recoveryHome) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
  }
  let apiToken = '';
  let tokenFrame;
  let auth = null;
  let recoveryContext = null;
  const argument = argv?.[0];
  validateChildTimeout(childExecutionTimeoutMs);
  validateChildTimeout(childTerminationTimeoutMs);
  validateChildTimeout(childForceKillTimeoutMs);
  if (!Array.isArray(argv) || argv.length !== 1 || !argument?.startsWith('--command=')
    || typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT');
  }
  const operation = argument.slice('--command='.length);
  const selected = COMMANDS[operation];
  if (!selected) throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ALLOWLIST');
  if (!selected.integrated) throw new Error('CLOUDFLARE_E_STAGING_CONTROL_NOT_INTEGRATED');
  if (FORBIDDEN_PARENT_CREDENTIALS.some((name) => Object.hasOwn(environment, name))) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_PARENT_CREDENTIAL');
  }
  const selectedAccountTargetPath = accountTargetMetadataPath
    ?? defaultCloudflareAccountTargetMetadataPath();
  const selectedTokenMetadataPath = tokenMetadataPath
    ?? defaultCloudflareStagingControlTokenMetadataPath();
  const selectedTokenRecoveryMetadataPath
    = cloudflareStagingControlTokenRecoveryMetadataPath(selectedTokenMetadataPath);
  await Promise.all([
    assertCloudflareAccountTargetOutsideRepository(selectedAccountTargetPath, root),
    assertCloudflareAccountTargetOutsideRepository(selectedTokenMetadataPath, root),
    assertCloudflareAccountTargetOutsideRepository(selectedTokenRecoveryMetadataPath, root),
  ]);
  // Validate the operation's complete input allowlist before reading either secret.
  operationEnvironment(
    environment,
    { root: '/private/tmp/placeholder', home: '/private/tmp/placeholder/home',
      xdgConfig: '/private/tmp/placeholder/config', xdgCache: '/private/tmp/placeholder/cache',
      xdgData: '/private/tmp/placeholder/data', temporary: '/private/tmp/placeholder/tmp',
      envFile: '/private/tmp/placeholder/empty.env' },
    '0'.repeat(32), operation, '0'.repeat(64), '0'.repeat(64), selected,
  );
  await Promise.all(selected.createOnlyPathVariables
    .map((name) => assertDestination(environment[name])));
  const policy = await loadPolicy(root);
  const target = policy?.staging;
  if (target?.environment !== 'staging' || target?.bucket !== 'dwnc-me-public-media-staging'
    || !SHA256.test(target?.accountIdSha256 ?? '')) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');
  }
  if (operation === 'staging-bootstrap-recover') {
    const context = await loadRecoveryContext({
      repositoryRoot: root, source: environment, policy, home: recoveryHome,
    });
    recoveryContext = context;
    const local = await inspectRecoveryStatus(context.plan, context.paths, {
      inspectGit: inspectRecoveryGitState,
      lstat,
      readSecureFile,
      assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
      assertSecureCreateOnlyDestination: assertDestination,
    });
    if (local.state === 'complete') {
      return {
        status: '완료',
        environment: 'staging',
        operation,
        classification: local.status.classification,
        recordedRequestCounts: local.status.requestCounts,
        currentInvocationRequestCounts: {
          GET: 0, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0,
        },
        existing: true,
        credentialAccessed: false,
        childStarted: false,
        rawTokenPrinted: false,
        oauthFallbackPossible: false,
      };
    }
    if (local.state !== 'needs-recovery') {
      throw new Error('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
    }
  }
  const accountTarget = await loadAccountTarget({
    metadataPath: selectedAccountTargetPath,
    expectedAccountIdSha256: target.accountIdSha256,
  });
  const accountId = accountTarget?.accountId ?? '';
  assertCloudflareAccountTarget(accountId, target.accountIdSha256);
  const statusOnlyRecovery = operation === 'staging-bootstrap-recover';
  const wrangler = statusOnlyRecovery ? null
    : assertPinnedWranglerDescriptor(await requireWrangler(root), root);
  try {
    auth = await createAuth();
    const sealedWrangler = statusOnlyRecovery ? null : assertSealedWranglerDescriptor(
      await sealWrangler(wrangler, auth.root, root), auth.root,
    );
    const loaded = await loadControlToken({
      accountId,
      expectedAccountIdSha256: target.accountIdSha256,
      metadataPath: selectedTokenMetadataPath,
      now,
    });
    apiToken = loaded?.apiToken ?? '';
    try { loaded.apiToken = ''; }
    catch { apiToken = ''; throw new Error('CLOUDFLARE_E_STAGING_CONTROL_PREFLIGHT'); }
    if (loaded.apiToken !== '') {
      apiToken = '';
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_PREFLIGHT');
    }
    const metadata = loaded?.metadata;
    const authenticationRequests = [];
    const allowedAuthenticationRequests = statusOnlyRecovery ? [
      {
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
        method: 'GET',
      },
      {
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
        method: 'GET',
      },
    ] : null;
    const verificationFetch = async (url, options = {}) => {
      const request = { url: String(url), method: options.method ?? 'GET' };
      if (statusOnlyRecovery
        && canonicalJson(request)
          !== canonicalJson(allowedAuthenticationRequests[authenticationRequests.length])) {
        throw new Error('CLOUDFLARE_E_STAGING_CONTROL_PREFLIGHT');
      }
      authenticationRequests.push(request);
      return fetchImpl(url, options);
    };
    const verification = await verifyControlToken({
      accountId, apiToken, expectedAccountIdSha256: target.accountIdSha256,
      fetchImpl: verificationFetch, now,
    });
    if (statusOnlyRecovery && canonicalJson(authenticationRequests)
      !== canonicalJson(allowedAuthenticationRequests)) {
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_PREFLIGHT');
    }
    if (metadata?.apiTokenSha256 !== verification.apiTokenSha256
      || metadata?.tokenIdSha256 !== verification.tokenIdSha256
      || metadata?.accountIdSha256 !== verification.accountIdSha256
      || metadata?.permissionContractSha256 !== verification.permissionContractSha256) {
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_PREFLIGHT');
    }
    const metadataSha256 = sha256(canonicalJson(metadata));
    const preWhoamiReceipt = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-staging-control-preflight-v1',
      operation,
      accountIdSha256: target.accountIdSha256,
      apiTokenSha256: verification.apiTokenSha256,
      tokenIdSha256: verification.tokenIdSha256,
      verifiedAt: verification.verifiedAt,
      permissionContractSha256: verification.permissionContractSha256,
    };
    let preflightSha256;
    if (statusOnlyRecovery) {
      preflightSha256 = sha256(canonicalJson({
        ...preWhoamiReceipt,
        statusOnly: true,
        authenticationRequestCounts: {
          GET: 2, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0,
        },
        wranglerInvocations: 0,
      }));
    } else {
      const temporaryPreflightSha256 = sha256(canonicalJson(preWhoamiReceipt));
      const envelopeSource = operationEnvironment(
        environment, auth, accountId, operation, metadataSha256,
        temporaryPreflightSha256, selected, {
          accountIdSha256: target.accountIdSha256,
          apiTokenSha256: verification.apiTokenSha256,
          permissionContractSha256: verification.permissionContractSha256,
        },
      );
      let stdout;
      let whoamiEnvironment = null;
      try {
        whoamiEnvironment = cloudflareStagingWranglerEnvironment(envelopeSource, {
          accountId, apiToken,
        }, { expectedOperation: operation });
        ({ stdout } = await execWrangler(
          process.execPath, [
            '--no-warnings', '--permission',
            `--allow-fs-read=${auth.root}`, `--allow-fs-write=${auth.root}`,
            '--require', sealedWrangler.guard,
            sealedWrangler.cli, 'whoami', '--json', '--env-file', auth.envFile,
          ], {
            cwd: auth.root,
            env: whoamiEnvironment,
            encoding: 'utf8',
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          },
        ));
      } catch { throw new Error('CLOUDFLARE_E_STAGING_CONTROL_WHOAMI'); }
      finally {
        if (whoamiEnvironment !== null) whoamiEnvironment.CLOUDFLARE_API_TOKEN = '';
      }
      const whoami = validateWhoami(stdout, accountId);
      preflightSha256 = sha256(canonicalJson({ ...preWhoamiReceipt, whoami }));
    }
    const childEnvironment = operationEnvironment(
      environment, auth, accountId, operation, metadataSha256, preflightSha256, selected, {
        accountIdSha256: target.accountIdSha256,
        apiTokenSha256: verification.apiTokenSha256,
        permissionContractSha256: verification.permissionContractSha256,
      },
    );
    tokenFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
    apiToken = '';
    let child;
    try {
      child = spawnChild(process.execPath,
        [path.join(root, selected.script), ...selected.args], {
          cwd: root,
          env: childEnvironment,
          stdio: ['ignore', statusOnlyRecovery ? 'pipe' : 'inherit', 'inherit', 'pipe'],
        });
    } catch { throw new Error('CLOUDFLARE_E_STAGING_CONTROL_CHILD'); }
    let lifecycle;
    let tokenPipe = null;
    let recoveryStdout = null;
    let recoveryChildResult = null;
    try {
      lifecycle = observeChild(child);
      tokenPipe = child.stdio?.[3] ?? null;
      if (statusOnlyRecovery) {
        try { recoveryStdout = observeRecoveryChildStdout(child); }
        catch {
          await terminateChild(child, lifecycle, tokenPipe, {
            terminationTimeoutMs: childTerminationTimeoutMs,
            forceKillTimeoutMs: childForceKillTimeoutMs,
          });
          throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
        }
      }
      if (!tokenPipe) {
        await terminateChild(child, lifecycle, tokenPipe, {
          terminationTimeoutMs: childTerminationTimeoutMs,
          forceKillTimeoutMs: childForceKillTimeoutMs,
        });
        throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
      }
      const write = writeAnonymousInheritedInput(tokenPipe, tokenFrame, {
        descriptor: 3, maximumBytes: 512,
      }).then(
        (value) => ({ type: 'written', value }),
        (error) => ({ type: 'write-error', error }),
      );
      const first = await Promise.race([
        write,
        lifecycle.errorSignal.then((error) => ({ type: 'spawn-error', error })),
        lifecycle.termination.then((value) => ({ type: 'terminated-before-write', value })),
      ]);
      if (first.type !== 'written') {
        await terminateChild(child, lifecycle, tokenPipe, {
          terminationTimeoutMs: childTerminationTimeoutMs,
          forceKillTimeoutMs: childForceKillTimeoutMs,
        });
        await boundedWait(write, childTerminationTimeoutMs);
        throw new Error(first.type === 'write-error'
          ? 'CLOUDFLARE_E_CONTROL_TOKEN_FD'
          : 'CLOUDFLARE_E_STAGING_CONTROL_CHILD');
      }
      closeTokenWriteDescriptor(tokenPipe);
      const execution = await boundedWait(Promise.race([
        lifecycle.termination.then((value) => ({ type: 'terminated', value })),
        lifecycle.errorSignal.then((error) => ({ type: 'spawn-error', error })),
        ...(statusOnlyRecovery ? [recoveryStdout.errorSignal
          .then((error) => ({ type: 'stdout-error', error }))] : []),
      ]), childExecutionTimeoutMs);
      if (execution.timedOut || ['spawn-error', 'stdout-error'].includes(execution.value.type)) {
        await terminateChild(child, lifecycle, tokenPipe, {
          terminationTimeoutMs: childTerminationTimeoutMs,
          forceKillTimeoutMs: childForceKillTimeoutMs,
        });
        throw new Error('CLOUDFLARE_E_STAGING_CONTROL_CHILD');
      }
      const { code } = execution.value.value;
      if (lifecycle.getSpawnError() !== null || code !== 0) {
        throw new Error('CLOUDFLARE_E_STAGING_CONTROL_CHILD');
      }
      if (statusOnlyRecovery) recoveryChildResult = recoveryStdout.parse();
    } finally {
      closeTokenWriteDescriptor(tokenPipe);
      recoveryStdout?.release();
      lifecycle?.release();
    }
    let recoveredStatus = null;
    if (statusOnlyRecovery) {
      const completed = await inspectRecoveryStatus(
        recoveryContext.plan, recoveryContext.paths, {
          inspectGit: inspectRecoveryGitState,
          lstat,
          readSecureFile,
          assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
          assertSecureCreateOnlyDestination: assertDestination,
        },
      );
      if (completed.state !== 'complete') {
        throw new Error('CLOUDFLARE_E_BOOTSTRAP_STATUS_RECORD');
      }
      recoveredStatus = completed.status;
      if (canonicalJson(recoveryChildResult.recordedRequestCounts)
          !== canonicalJson(recoveredStatus.requestCounts)
        || recoveryChildResult.classification !== recoveredStatus.classification
        || recoveryChildResult.versionId !== recoveredStatus.observationB.versionId
        || recoveryChildResult.deploymentId !== recoveredStatus.observationB.deploymentId) {
        throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_CHILD_RESULT');
      }
    }
    return {
      status: '완료',
      environment: 'staging',
      operation,
      accountIdSha256: target.accountIdSha256,
      apiTokenSha256: verification.apiTokenSha256,
      tokenIdSha256: verification.tokenIdSha256,
      metadataSha256,
      preflightSha256,
      ...(recoveredStatus === null ? {} : {
        classification: recoveredStatus.classification,
        recordedRequestCounts: recoveryChildResult.recordedRequestCounts,
        currentInvocationRequestCounts: addRequestCounts(
          { GET: 2, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 },
          recoveryChildResult.currentStateRequestCounts,
        ),
        existing: recoveryChildResult.existing,
      }),
      rawTokenPrinted: false,
      oauthFallbackPossible: false,
    };
  } finally {
    apiToken = '';
    tokenFrame?.fill(0);
    if (auth !== null) await cleanupAuth(auth).catch(() => {
      throw new Error('CLOUDFLARE_E_STAGING_CONTROL_CLEANUP');
    });
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-staging-control-runner');
  console.log(JSON.stringify(await runCloudflareStagingControl(), null, 2));
}
