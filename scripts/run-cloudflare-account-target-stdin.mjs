import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
  InAppBrowserAccountIdBufferSource,
  assertCloudflareAccountTargetOutsideRepository,
  cloudflareAccountTargetRecoveryMetadataPath,
  defaultCloudflareAccountTargetMetadataPath,
  initializeCloudflareAccountTarget,
} from './lib/cloudflare-account-target.mjs';
import {
  PUBLIC_MEDIA_RELEASE_POLICY_PATH,
  validatePublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';
import {
  inspectPublicMediaGit,
  validatePublicMediaGitSnapshot,
} from './lib/public-media-git.mjs';

const MODULE_FILE = fileURLToPath(import.meta.url);
export const CLOUDFLARE_ACCOUNT_TARGET_STDIN_RUNTIME_ROOT =
  '/Users/jusang/projects/dwnc.me';
export const CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT =
  'dwnc-cloudflare-account-target-stdin-v1';
export const CLOUDFLARE_ACCOUNT_TARGET_STDIN_MAX_BYTES = 33;
export const CLOUDFLARE_ACCOUNT_TARGET_STDIN_TIMEOUT_MS = 60_000;

const DERIVED_ROOT = path.resolve(path.dirname(MODULE_FILE), '..');
const GIT_OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const READY_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'input', 'maxBytes', 'expiresInMs',
  'echoDisabled', 'clipboardRead', 'clipboardCleared', 'rawPrinted',
]);
const COMPLETE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'durableState', 'purpose',
  'echoRestored', 'clipboardRead', 'clipboardCleared', 'rawPrinted',
]);
const FAILED_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'errorCode', 'durableState',
  'echoRestored', 'clipboardRead', 'clipboardCleared', 'rawPrinted',
]);
const SAFE_ERROR_CODES = new Set([
  'ACCOUNT_STDIN_E_ARGUMENT',
  'ACCOUNT_STDIN_E_CHILD',
  'ACCOUNT_STDIN_E_ECHO_RESTORE',
  'ACCOUNT_STDIN_E_GIT',
  'ACCOUNT_STDIN_E_IMPLEMENTATION',
  'ACCOUNT_STDIN_E_INPUT',
  'ACCOUNT_STDIN_E_INPUT_TIMEOUT',
  'ACCOUNT_STDIN_E_OUTPUT',
  'ACCOUNT_STDIN_E_POLICY',
  'ACCOUNT_STDIN_E_ROOT',
  'ACCOUNT_STDIN_E_TTY',
  'ACCOUNT_STDIN_E_SIGNAL',
  'CLOUDFLARE_E_ACCOUNT_SOURCE_REUSED',
  'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS',
  'CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION',
  'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN',
  'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION',
  'CLOUDFLARE_E_ACCOUNT_STORE_METADATA',
  'CLOUDFLARE_E_ACCOUNT_STORE_PATH',
  'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD',
  'CLOUDFLARE_E_ACCOUNT_STORE_POSTCONDITION',
  'CLOUDFLARE_E_ACCOUNT_STORE_RACE',
  'CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_EXHAUSTED',
  'CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_REQUIRED',
  'CLOUDFLARE_E_ACCOUNT_STORE_STATE',
  'CLOUDFLARE_E_ACCOUNT_STORE_TARGET',
  'CLOUDFLARE_E_SIGNING_CANONICAL',
  'CLOUDFLARE_E_SIGNING_FILE',
  'CLOUDFLARE_E_SIGNING_FILE_EXISTS',
  'CLOUDFLARE_E_SIGNING_FILE_RACE',
  'CLOUDFLARE_E_SIGNING_KEY_EXISTS',
]);

function fail(code) { throw new Error(code); }
function zeroBuffer(value) { if (Buffer.isBuffer(value)) value.fill(0); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}
function isLowerHexByte(value) {
  return value >= 0x30 && value <= 0x39 || value >= 0x61 && value <= 0x66;
}
function safeErrorCode(error) {
  const candidate = error?.message;
  return typeof candidate === 'string' && SAFE_ERROR_CODES.has(candidate)
    ? candidate : 'ACCOUNT_STDIN_E_CHILD';
}

export function validateCloudflareAccountTargetStdinMessage(value) {
  if (!value || value.schemaVersion !== 1
    || value.contract !== CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT) {
    fail('ACCOUNT_STDIN_E_OUTPUT');
  }
  if (value.status === 'ready') {
    if (!exactKeys(value, READY_KEYS)
      || value.input !== 'non-echo-tty-line'
      || value.maxBytes !== CLOUDFLARE_ACCOUNT_TARGET_STDIN_MAX_BYTES
      || value.expiresInMs !== CLOUDFLARE_ACCOUNT_TARGET_STDIN_TIMEOUT_MS
      || value.echoDisabled !== true || value.clipboardRead !== false
      || value.clipboardCleared !== false || value.rawPrinted !== false) {
      fail('ACCOUNT_STDIN_E_OUTPUT');
    }
  } else if (value.status === 'complete') {
    if (!exactKeys(value, COMPLETE_KEYS) || value.durableState !== 'complete'
      || value.purpose !== CLOUDFLARE_ACCOUNT_TARGET_PURPOSE
      || value.echoRestored !== true || value.clipboardRead !== false
      || value.clipboardCleared !== false || value.rawPrinted !== false) {
      fail('ACCOUNT_STDIN_E_OUTPUT');
    }
  } else if (value.status === 'failed') {
    if (!exactKeys(value, FAILED_KEYS)
      || !SAFE_ERROR_CODES.has(value.errorCode)
      || !['none', 'unknown'].includes(value.durableState)
      || typeof value.echoRestored !== 'boolean'
      || value.clipboardRead !== false || value.clipboardCleared !== false
      || value.rawPrinted !== false) fail('ACCOUNT_STDIN_E_OUTPUT');
  } else fail('ACCOUNT_STDIN_E_OUTPUT');
  return value;
}

export function serializeCloudflareAccountTargetStdinMessage(value) {
  validateCloudflareAccountTargetStdinMessage(value);
  let serialized;
  try { serialized = `${JSON.stringify(value)}\n`; }
  catch { fail('ACCOUNT_STDIN_E_OUTPUT'); }
  if (Buffer.byteLength(serialized, 'utf8') > 1024) fail('ACCOUNT_STDIN_E_OUTPUT');
  return serialized;
}

function readyResult() {
  return Object.freeze(validateCloudflareAccountTargetStdinMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT,
    status: 'ready',
    input: 'non-echo-tty-line',
    maxBytes: CLOUDFLARE_ACCOUNT_TARGET_STDIN_MAX_BYTES,
    expiresInMs: CLOUDFLARE_ACCOUNT_TARGET_STDIN_TIMEOUT_MS,
    echoDisabled: true,
    clipboardRead: false,
    clipboardCleared: false,
    rawPrinted: false,
  }));
}

function failedResult(error, durableState = 'none') {
  return Object.freeze(validateCloudflareAccountTargetStdinMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT,
    status: 'failed',
    errorCode: safeErrorCode(error),
    durableState,
    echoRestored: error?.message !== 'ACCOUNT_STDIN_E_ECHO_RESTORE',
    clipboardRead: false,
    clipboardCleared: false,
    rawPrinted: false,
  }));
}

export function assertCloudflareAccountTargetStdinRuntimeRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || root !== CLOUDFLARE_ACCOUNT_TARGET_STDIN_RUNTIME_ROOT) fail('ACCOUNT_STDIN_E_ROOT');
  return root;
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 2) fail('ACCOUNT_STDIN_E_ARGUMENT');
  const parsed = Object.create(null);
  for (const argument of argv) {
    const match = /^--(expected-git-commit|expected-git-tree)=([a-f0-9]{40})$/u.exec(argument);
    if (!match || parsed[match[1]] !== undefined) fail('ACCOUNT_STDIN_E_ARGUMENT');
    parsed[match[1]] = match[2];
  }
  if (!GIT_OID.test(parsed['expected-git-commit'] ?? '')
    || !GIT_OID.test(parsed['expected-git-tree'] ?? '')) fail('ACCOUNT_STDIN_E_ARGUMENT');
  return Object.freeze({
    expectedCommit: parsed['expected-git-commit'],
    expectedTree: parsed['expected-git-tree'],
  });
}

async function assertGitBoundary(root, expectedCommit, expectedTree, inspectGit) {
  try {
    return validatePublicMediaGitSnapshot(
      await inspectGit(root), expectedCommit, expectedTree,
    );
  } catch { fail('ACCOUNT_STDIN_E_GIT'); }
}

async function loadPolicySnapshot(root, readPolicyFile, validatePolicy) {
  let bytes;
  try {
    bytes = await readPolicyFile(path.join(root, PUBLIC_MEDIA_RELEASE_POLICY_PATH));
    if (!Buffer.isBuffer(bytes)) fail('ACCOUNT_STDIN_E_POLICY');
    const policy = validatePolicy(JSON.parse(bytes.toString('utf8')));
    const expectedAccountIdSha256 = policy?.staging?.accountIdSha256;
    if (policy?.staging?.environment !== 'staging'
      || policy?.staging?.bucket !== 'dwnc-me-public-media-staging'
      || !SHA256.test(expectedAccountIdSha256 ?? '')) {
      fail('ACCOUNT_STDIN_E_POLICY');
    }
    return Object.freeze({ expectedAccountIdSha256 });
  } catch (error) {
    if (error?.message === 'ACCOUNT_STDIN_E_POLICY') throw error;
    fail('ACCOUNT_STDIN_E_POLICY');
  } finally { zeroBuffer(bytes); }
}

function validateInput(input) {
  if (!input || input.isTTY !== true || typeof input.setRawMode !== 'function'
    || typeof input.on !== 'function' || typeof input.removeListener !== 'function'
    || typeof input.resume !== 'function' || typeof input.pause !== 'function') {
    fail('ACCOUNT_STDIN_E_TTY');
  }
}

export async function readCloudflareAccountTargetStdinLine({
  input = process.stdin,
  signalEmitter = process,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  writeReady = () => process.stdout.write(
    serializeCloudflareAccountTargetStdinMessage(readyResult()),
  ),
} = {}) {
  validateInput(input);
  if (!signalEmitter || typeof signalEmitter.on !== 'function'
    || typeof signalEmitter.removeListener !== 'function'
    || typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function'
    || typeof writeReady !== 'function') fail('ACCOUNT_STDIN_E_IMPLEMENTATION');
  const received = Buffer.alloc(CLOUDFLARE_ACCOUNT_TARGET_STDIN_MAX_BYTES);
  let receivedBytes = 0;
  let rawModeEnabled = false;
  let returned;
  let restored = true;
  let failure = null;
  const restore = () => {
    if (!rawModeEnabled) return;
    rawModeEnabled = false;
    try { input.setRawMode(false); }
    catch { restored = false; }
  };
  try {
    try {
      input.setRawMode(true);
      rawModeEnabled = true;
    } catch { fail('ACCOUNT_STDIN_E_TTY'); }
    returned = await new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const cleanup = () => {
        try { clearTimeoutImpl(timer); } catch { /* cleanup only */ }
        input.removeListener('data', onData);
        input.removeListener('error', onError);
        input.removeListener('end', onEnd);
        signalEmitter.removeListener('SIGTERM', onSignal);
        signalEmitter.removeListener('SIGHUP', onSignal);
        signalEmitter.removeListener('SIGINT', onSignal);
        signalEmitter.removeListener('exit', onExit);
        try { input.pause(); } catch { /* cleanup only */ }
      };
      const finish = (error = null, value = null) => {
        if (settled) { zeroBuffer(value); return; }
        settled = true;
        cleanup();
        if (error === null) resolve(value);
        else { zeroBuffer(value); reject(error); }
      };
      const onError = () => finish(new Error('ACCOUNT_STDIN_E_INPUT'));
      const onEnd = () => finish(new Error('ACCOUNT_STDIN_E_INPUT'));
      const onSignal = () => finish(new Error('ACCOUNT_STDIN_E_SIGNAL'));
      const onExit = () => restore();
      const onData = (chunk) => {
        const owned = Buffer.isBuffer(chunk)
          ? chunk : ArrayBuffer.isView(chunk)
            ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : null;
        try {
          if (owned === null || receivedBytes > received.length - owned.length) {
            finish(new Error('ACCOUNT_STDIN_E_INPUT'));
            return;
          }
          for (let index = 0; index < owned.length; index += 1) {
            const byte = owned[index];
            if (byte === 0x0a || byte === 0x0d) {
              if (receivedBytes !== 32 || index !== owned.length - 1) {
                finish(new Error('ACCOUNT_STDIN_E_INPUT'));
                return;
              }
              const value = Buffer.from(received.subarray(0, 32));
              finish(null, value);
              return;
            }
            if (receivedBytes >= 32 || !isLowerHexByte(byte)) {
              finish(new Error('ACCOUNT_STDIN_E_INPUT'));
              return;
            }
            received[receivedBytes] = byte;
            receivedBytes += 1;
          }
        } finally { zeroBuffer(owned); }
      };
      input.on('data', onData);
      input.on('error', onError);
      input.on('end', onEnd);
      signalEmitter.on('SIGTERM', onSignal);
      signalEmitter.on('SIGHUP', onSignal);
      signalEmitter.on('SIGINT', onSignal);
      signalEmitter.on('exit', onExit);
      try {
        timer = setTimeoutImpl(
          () => finish(new Error('ACCOUNT_STDIN_E_INPUT_TIMEOUT')),
          CLOUDFLARE_ACCOUNT_TARGET_STDIN_TIMEOUT_MS,
        );
        writeReady();
        input.resume();
      }
      catch { finish(new Error('ACCOUNT_STDIN_E_INPUT')); }
    });
  } catch (error) {
    failure = error;
  } finally {
    restore();
    zeroBuffer(received);
    if (!restored) {
      zeroBuffer(returned);
      returned = null;
    }
  }
  if (!restored) fail('ACCOUNT_STDIN_E_ECHO_RESTORE');
  if (failure !== null) throw failure;
  return returned;
}

function validateTestOnly(testOnly) {
  if (testOnly === undefined) return Object.freeze({});
  const allowed = [
    'runtimeRoot', 'inspectGit', 'readPolicyFile', 'validatePolicy',
    'assertOutsideRepository', 'initialize', 'input', 'write', 'metadataOutput',
    'signalEmitter', 'setTimeoutImpl', 'clearTimeoutImpl',
  ];
  if (!testOnly || typeof testOnly !== 'object' || Array.isArray(testOnly)
    || !Object.keys(testOnly).every((key) => allowed.includes(key))) {
    fail('ACCOUNT_STDIN_E_IMPLEMENTATION');
  }
  return testOnly;
}

export async function runCloudflareAccountTargetStdin({
  argv = process.argv.slice(2),
  testOnly,
} = {}) {
  const parsed = parseArguments(argv);
  const injected = validateTestOnly(testOnly);
  const root = assertCloudflareAccountTargetStdinRuntimeRoot(
    injected.runtimeRoot ?? DERIVED_ROOT,
  );
  const inspectGit = injected.inspectGit ?? inspectPublicMediaGit;
  const readPolicyFile = injected.readPolicyFile ?? readFile;
  const validatePolicy = injected.validatePolicy ?? validatePublicMediaReleasePolicy;
  const assertOutsideRepository = injected.assertOutsideRepository
    ?? assertCloudflareAccountTargetOutsideRepository;
  const initialize = injected.initialize ?? initializeCloudflareAccountTarget;
  const input = injected.input ?? process.stdin;
  const write = injected.write ?? ((serialized) => process.stdout.write(serialized));
  if ([inspectGit, readPolicyFile, validatePolicy, assertOutsideRepository, initialize, write]
    .some((value) => typeof value !== 'function')) fail('ACCOUNT_STDIN_E_IMPLEMENTATION');

  let accountIdBytes;
  let source;
  let initializationStarted = false;
  let final;
  try {
    const metadataOutput = injected.metadataOutput
      ?? defaultCloudflareAccountTargetMetadataPath();
    const recoveryMetadataOutput = cloudflareAccountTargetRecoveryMetadataPath(metadataOutput);
    await assertOutsideRepository(metadataOutput, root);
    await assertOutsideRepository(recoveryMetadataOutput, root);
    const policy = await loadPolicySnapshot(root, readPolicyFile, validatePolicy);
    await assertGitBoundary(root, parsed.expectedCommit, parsed.expectedTree, inspectGit);
    accountIdBytes = await readCloudflareAccountTargetStdinLine({
      input,
      signalEmitter: injected.signalEmitter ?? process,
      setTimeoutImpl: injected.setTimeoutImpl ?? globalThis.setTimeout,
      clearTimeoutImpl: injected.clearTimeoutImpl ?? globalThis.clearTimeout,
      writeReady: () => write(serializeCloudflareAccountTargetStdinMessage(readyResult())),
    });
    await assertGitBoundary(root, parsed.expectedCommit, parsed.expectedTree, inspectGit);
    source = new InAppBrowserAccountIdBufferSource(accountIdBytes);
    accountIdBytes = null;
    initializationStarted = true;
    const metadata = await initialize({
      metadataOutput,
      recoveryMetadataOutput,
      expectedAccountIdSha256: policy.expectedAccountIdSha256,
      accountIdSource: source,
    });
    if (metadata?.purpose !== CLOUDFLARE_ACCOUNT_TARGET_PURPOSE
      || metadata?.accountIdSha256 !== policy.expectedAccountIdSha256) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_POSTCONDITION');
    }
    final = Object.freeze(validateCloudflareAccountTargetStdinMessage({
      schemaVersion: 1,
      contract: CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT,
      status: 'complete',
      durableState: 'complete',
      purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
      echoRestored: true,
      clipboardRead: false,
      clipboardCleared: false,
      rawPrinted: false,
    }));
  } catch (error) {
    final = failedResult(error, initializationStarted ? 'unknown' : 'none');
  } finally {
    zeroBuffer(accountIdBytes);
    await source?.cleanup().catch(() => undefined);
  }
  write(serializeCloudflareAccountTargetStdinMessage(final));
  return final;
}

if (path.resolve(process.argv[1] ?? '') === MODULE_FILE) {
  let final;
  try { final = await runCloudflareAccountTargetStdin(); }
  catch (error) {
    final = failedResult(error, 'none');
    process.stdout.write(serializeCloudflareAccountTargetStdinMessage(final));
  }
  if (final.status !== 'complete') process.exitCode = 1;
}
