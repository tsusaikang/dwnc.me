import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { userInfo } from 'node:os';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';

export const CLOUDFLARE_ACCOUNT_TARGET_SERVICE = 'me.dwnc.cloudflare-account-target.v1';
export const CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT = 'dwnc:staging:account-id';
export const CLOUDFLARE_ACCOUNT_TARGET_PURPOSE = 'staging-cloudflare-read-target';
export const CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND =
  'in-app-browser-visible-account-id-buffer-v1';

const PAYLOAD_CONTRACT = 'dwnc-cloudflare-account-target-v1';
const METADATA_CONTRACT = 'dwnc-cloudflare-account-target-metadata-v1';
const SOURCE_EVIDENCE_CONTRACT = 'dwnc-cloudflare-account-id-source-evidence-v1';
const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ACCOUNT_ID_BYTES = 32;
const ACCOUNT_FINGERPRINT_PREFIX = Buffer.from('cloudflare-account-id-v1\0', 'ascii');
const PAYLOAD_PREFIX = Buffer.from('{"accountId":"', 'ascii');
const PAYLOAD_SUFFIX = Buffer.from(
  `","contract":"${PAYLOAD_CONTRACT}","schemaVersion":1}`, 'ascii',
);
const BASE64URL_ALPHABET = Buffer.from(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', 'ascii',
);
const CHILD_TIMEOUT_MS = 15_000;
const CHILD_TERMINATE_GRACE_MS = 250;
const CHILD_KILL_GRACE_MS = 250;
const CHILD_STDERR_MAX_BYTES = 4096;
const CLIPBOARD_CLEARED_MARKER = 'dwnc.me clipboard cleared';
const NATIVE_SPAWN_GUARD = Symbol.for('dwnc.cloudflare.account-target.native-spawn-guard.v1');
const TEST_NATIVE_SPAWN_ERROR = 'CLOUDFLARE_E_ACCOUNT_TEST_NATIVE_SPAWN';
const NATIVE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const NATIVE_ENVIRONMENT_KEYS = Object.freeze([
  'HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', '__CF_USER_TEXT_ENCODING',
]);
const SAFE_USERNAME = /^[A-Za-z0-9._-]{1,255}$/u;

function fail(code) { throw new Error(code); }
function zeroBuffer(value) { if (Buffer.isBuffer(value)) value.fill(0); }
function zeroBuffers(values) {
  for (const value of values) zeroBuffer(value);
  values.length = 0;
}

function childLifecycleOptions({
  timeoutMs = CHILD_TIMEOUT_MS,
  terminateGraceMs = CHILD_TERMINATE_GRACE_MS,
  killGraceMs = CHILD_KILL_GRACE_MS,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CHILD_TIMEOUT_MS
    || !Number.isInteger(terminateGraceMs) || terminateGraceMs < 1
    || terminateGraceMs > CHILD_TERMINATE_GRACE_MS
    || !Number.isInteger(killGraceMs) || killGraceMs < 1
    || killGraceMs > CHILD_KILL_GRACE_MS
    || typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  return Object.freeze({
    timeoutMs, terminateGraceMs, killGraceMs, setTimeoutImpl, clearTimeoutImpl,
  });
}

function asOwnedBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function safeDestroy(stream) {
  try { stream?.destroy?.(); } catch { /* bounded cleanup is best effort */ }
}

function safeKill(child, signal) {
  try { child?.kill?.(signal); } catch { /* the final timer still settles */ }
}

function createNativeMacEnvironment(readUserInfo = userInfo) {
  if (typeof readUserInfo !== 'function') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  let info;
  try { info = readUserInfo(); }
  catch { fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION'); }
  if (!info || typeof info !== 'object' || Array.isArray(info)
    || typeof info.homedir !== 'string' || !path.isAbsolute(info.homedir)
    || path.resolve(info.homedir) !== info.homedir || info.homedir.includes('\0')
    || info.homedir.includes('\n') || info.homedir.includes('\r')
    || !SAFE_USERNAME.test(info.username ?? '')
    || !Number.isSafeInteger(info.uid) || info.uid < 0 || info.uid > 0xffff_ffff) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  const environment = Object.create(null);
  environment.HOME = info.homedir;
  environment.USER = info.username;
  environment.LOGNAME = info.username;
  environment.PATH = NATIVE_PATH;
  environment.LANG = 'C';
  environment.LC_ALL = 'C';
  environment.__CF_USER_TEXT_ENCODING = `0x${info.uid.toString(16).toUpperCase()}:0x0:0x0`;
  return Object.freeze(environment);
}

function isExactNativeMacEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)
    || Object.getPrototypeOf(environment) !== null || !Object.isFrozen(environment)
    || Object.keys(environment).length !== NATIVE_ENVIRONMENT_KEYS.length
    || !Object.keys(environment).every((key) => NATIVE_ENVIRONMENT_KEYS.includes(key))) {
    return false;
  }
  return typeof environment.HOME === 'string' && path.isAbsolute(environment.HOME)
    && path.resolve(environment.HOME) === environment.HOME
    && !environment.HOME.includes('\0') && !environment.HOME.includes('\n')
    && !environment.HOME.includes('\r') && SAFE_USERNAME.test(environment.USER ?? '')
    && environment.LOGNAME === environment.USER && environment.PATH === NATIVE_PATH
    && environment.LANG === 'C' && environment.LC_ALL === 'C'
    && /^0x[0-9A-F]{1,8}:0x0:0x0$/u.test(environment.__CF_USER_TEXT_ENCODING ?? '');
}

function spawnNativeAccountTargetChild(file, args, options) {
  if (NATIVE_SPAWN_GUARD in globalThis) throw new Error(TEST_NATIVE_SPAWN_ERROR);
  return spawn(file, args, options);
}

async function runBoundedChild({
  spawnChild,
  file,
  args,
  input = null,
  maxStdoutBytes,
  maxStderrBytes = CHILD_STDERR_MAX_BYTES,
  errorCode,
  lifecycle,
  environment,
}) {
  if (typeof spawnChild !== 'function' || typeof file !== 'string'
    || !Array.isArray(args) || !Number.isInteger(maxStdoutBytes) || maxStdoutBytes < 0
    || !Number.isInteger(maxStderrBytes) || maxStderrBytes < 0
    || typeof errorCode !== 'string' || !lifecycle
    || !isExactNativeMacEnvironment(environment)
    || input !== null && !Buffer.isBuffer(input)) {
    zeroBuffer(input);
    fail(errorCode);
  }
  let child;
  try {
    child = spawnChild(file, args, {
      env: environment,
      stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    zeroBuffer(input);
    if (error?.message === TEST_NATIVE_SPAWN_ERROR) throw error;
    fail(errorCode);
  }

  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let failure = null;
    let inputReleased = input === null;
    let timeoutTimer;
    let terminateTimer;
    let killTimer;

    const releaseInput = () => {
      if (!inputReleased) {
        inputReleased = true;
        zeroBuffer(input);
      }
    };
    const clearTimer = (timer) => {
      if (timer === undefined) return;
      try { lifecycle.clearTimeoutImpl(timer); } catch { /* cleanup only */ }
    };
    const settle = (code = null, signal = null) => {
      if (settled) return;
      settled = true;
      clearTimer(timeoutTimer);
      clearTimer(terminateTimer);
      clearTimer(killTimer);
      releaseInput();
      safeDestroy(child?.stdin);
      safeDestroy(child?.stdout);
      safeDestroy(child?.stderr);
      let stdout;
      let stderr;
      try {
        if (failure === null) {
          stdout = Buffer.concat(stdoutChunks, stdoutBytes);
          stderr = Buffer.concat(stderrChunks, stderrBytes);
        }
      } catch {
        failure = errorCode;
      } finally {
        zeroBuffers(stdoutChunks);
        zeroBuffers(stderrChunks);
      }
      if (failure !== null) {
        zeroBuffer(stdout);
        zeroBuffer(stderr);
        reject(new Error(errorCode));
        return;
      }
      resolve({
        code: Number.isInteger(code) ? code : null,
        signal: signal === undefined ? null : signal,
        stdout,
        stderr,
      });
    };
    const beginTermination = () => {
      if (settled) return;
      if (failure === null) failure = errorCode;
      releaseInput();
      safeDestroy(child?.stdin);
      if (terminateTimer !== undefined) return;
      safeKill(child, 'SIGTERM');
      if (settled) return;
      try {
        terminateTimer = lifecycle.setTimeoutImpl(() => {
          if (settled) return;
          safeKill(child, 'SIGKILL');
          if (settled) return;
          try {
            killTimer = lifecycle.setTimeoutImpl(() => settle(null, 'SIGKILL'),
              lifecycle.killGraceMs);
          } catch { settle(null, 'SIGKILL'); }
        }, lifecycle.terminateGraceMs);
      } catch { settle(null, 'SIGTERM'); }
    };
    const collect = (chunks, byteState, maximum, value) => {
      const owned = asOwnedBuffer(value);
      if (settled) {
        zeroBuffer(owned);
        return;
      }
      if (owned === null || failure !== null || byteState.bytes > maximum - owned.length) {
        zeroBuffer(owned);
        zeroBuffers(chunks);
        byteState.bytes = 0;
        beginTermination();
        return;
      }
      chunks.push(owned);
      byteState.bytes += owned.length;
    };
    const stdoutState = { get bytes() { return stdoutBytes; }, set bytes(value) { stdoutBytes = value; } };
    const stderrState = { get bytes() { return stderrBytes; }, set bytes(value) { stderrBytes = value; } };

    try {
      if (!child || typeof child.once !== 'function' || typeof child.on !== 'function'
        || typeof child.kill !== 'function'
        || !child.stdout || typeof child.stdout.on !== 'function'
        || !child.stderr || typeof child.stderr.on !== 'function'
        || input !== null && (!child.stdin || typeof child.stdin.on !== 'function'
          || typeof child.stdin.end !== 'function')) {
        beginTermination();
      } else {
        child.stdout.on('data', (chunk) => collect(
          stdoutChunks, stdoutState, maxStdoutBytes, chunk,
        ));
        child.stderr.on('data', (chunk) => collect(
          stderrChunks, stderrState, maxStderrBytes, chunk,
        ));
        child.stdout.on('error', beginTermination);
        child.stderr.on('error', beginTermination);
        child.on('error', beginTermination);
        child.once('close', settle);
        timeoutTimer = lifecycle.setTimeoutImpl(beginTermination, lifecycle.timeoutMs);
        if (input !== null) {
          child.stdin.on('error', beginTermination);
          try { child.stdin.end(input, releaseInput); }
          catch { releaseInput(); beginTermination(); }
        }
      }
    } catch {
      beginTermination();
    }
  });
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function cloudflareAccountTargetIdentity() {
  return {
    service: CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
    account: CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  };
}

export function defaultCloudflareAccountTargetMetadataPath(home) {
  let selectedHome = home;
  if (selectedHome === undefined) {
    try { selectedHome = userInfo().homedir; }
    catch { fail('CLOUDFLARE_E_ACCOUNT_STORE_PATH'); }
  }
  if (typeof selectedHome !== 'string' || !path.isAbsolute(selectedHome)
    || path.resolve(selectedHome) !== selectedHome) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PATH');
  }
  return path.join(
    selectedHome,
    'Library', 'Application Support', 'dwnc.me', 'stage3',
    'staging-cloudflare-account-target.json',
  );
}

function isContainedPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function resolveWithoutSymlinkAncestors(candidate) {
  const parsed = path.parse(candidate);
  const components = path.relative(parsed.root, candidate).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < components.length; index += 1) {
    const next = path.join(current, components[index]);
    let stats;
    try { stats = await lstat(next); }
    catch (error) {
      if (error?.code !== 'ENOENT') fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
      let canonicalParent;
      try { canonicalParent = await realpath(current); }
      catch { fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION'); }
      return path.join(canonicalParent, ...components.slice(index));
    }
    if (stats.isSymbolicLink()
      || index < components.length - 1 && !stats.isDirectory()) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
    }
    current = next;
  }
  try { return await realpath(current); }
  catch { fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION'); }
}

export async function assertCloudflareAccountTargetOutsideRepository(
  metadataPath, repositoryRoot,
) {
  if (typeof metadataPath !== 'string' || !path.isAbsolute(metadataPath)
    || path.resolve(metadataPath) !== metadataPath
    || typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)
    || path.resolve(repositoryRoot) !== repositoryRoot) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  }
  let repositoryReal;
  try {
    repositoryReal = await realpath(repositoryRoot);
    const repositoryStats = await lstat(repositoryReal);
    const confirmedRepositoryReal = await realpath(repositoryRoot);
    if (!repositoryStats.isDirectory() || confirmedRepositoryReal !== repositoryReal) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
    }
  }
  catch { fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION'); }
  if (isContainedPath(repositoryRoot, metadataPath)) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  }
  const firstResolved = await resolveWithoutSymlinkAncestors(metadataPath);
  const secondResolved = await resolveWithoutSymlinkAncestors(metadataPath);
  if (firstResolved !== secondResolved || isContainedPath(repositoryReal, firstResolved)) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  }
}

export function cloudflareAccountTargetRecoveryMetadataPath(metadataPath) {
  if (typeof metadataPath !== 'string' || !path.isAbsolute(metadataPath)
    || path.resolve(metadataPath) !== metadataPath || path.extname(metadataPath) !== '.json'
    || path.basename(metadataPath) === '.json') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PATH');
  }
  const parsed = path.parse(metadataPath);
  return path.join(parsed.dir, `${parsed.name}-recovery.json`);
}

export function validateCloudflareAccountTargetPayload(payload) {
  const keys = ['schemaVersion', 'contract', 'accountId'];
  if (!exactKeys(payload, keys) || payload.schemaVersion !== 1
    || payload.contract !== PAYLOAD_CONTRACT || !ACCOUNT_ID.test(payload.accountId ?? '')) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
  }
  return payload;
}

export function validateCloudflareAccountTargetMetadata(metadata, {
  expectedAccountIdSha256,
} = {}) {
  const keys = [
    'schemaVersion', 'contract', 'keychainService', 'keychainAccount',
    'accountIdSha256', 'createdAt', 'purpose',
  ];
  if (!exactKeys(metadata, keys) || metadata.schemaVersion !== 1
    || metadata.contract !== METADATA_CONTRACT
    || metadata.keychainService !== CLOUDFLARE_ACCOUNT_TARGET_SERVICE
    || metadata.keychainAccount !== CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT
    || !SHA256.test(metadata.accountIdSha256 ?? '')
    || metadata.purpose !== CLOUDFLARE_ACCOUNT_TARGET_PURPOSE
    || Number.isNaN(Date.parse(metadata.createdAt ?? ''))
    || expectedAccountIdSha256 !== undefined
      && metadata.accountIdSha256 !== expectedAccountIdSha256) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
  }
  return metadata;
}

function validateExpectedFingerprint(expectedAccountIdSha256) {
  if (!SHA256.test(expectedAccountIdSha256 ?? '')) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
  }
  return expectedAccountIdSha256;
}

function isLowerHexByte(value) {
  return value >= 0x30 && value <= 0x39 || value >= 0x61 && value <= 0x66;
}

function assertAccountIdBytes(accountIdBytes, code = 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD') {
  if (!Buffer.isBuffer(accountIdBytes) || accountIdBytes.length !== ACCOUNT_ID_BYTES
    || !accountIdBytes.every(isLowerHexByte)) {
    fail(code);
  }
  return accountIdBytes;
}

export class InAppBrowserAccountIdBufferSource {
  #accountIdBytes = null;
  #preflightCount = 0;
  #readCount = 0;
  #cleanupComplete = false;

  constructor(accountIdBytes) {
    let owned;
    try {
      assertAccountIdBytes(accountIdBytes);
      owned = Buffer.from(accountIdBytes);
    } finally {
      zeroBuffer(accountIdBytes);
    }
    this.#accountIdBytes = owned;
    Object.freeze(this);
  }

  get kind() { return CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND; }

  async preflight() {
    if (this.#cleanupComplete || this.#readCount !== 0 || this.#accountIdBytes === null) {
      fail('CLOUDFLARE_E_ACCOUNT_SOURCE_REUSED');
    }
    assertAccountIdBytes(this.#accountIdBytes);
    this.#preflightCount += 1;
  }

  async readOnce() {
    if (this.#cleanupComplete || this.#readCount !== 0 || this.#accountIdBytes === null) {
      fail('CLOUDFLARE_E_ACCOUNT_SOURCE_REUSED');
    }
    try { assertAccountIdBytes(this.#accountIdBytes); }
    catch (error) {
      zeroBuffer(this.#accountIdBytes);
      this.#accountIdBytes = null;
      this.#cleanupComplete = true;
      throw error;
    }
    const transferred = this.#accountIdBytes;
    this.#accountIdBytes = null;
    this.#readCount = 1;
    return transferred;
  }

  async cleanup() {
    if (this.#cleanupComplete) return;
    zeroBuffer(this.#accountIdBytes);
    this.#accountIdBytes = null;
    this.#cleanupComplete = true;
  }

  evidence() {
    return Object.freeze({
      schemaVersion: 1,
      contract: SOURCE_EVIDENCE_CONTRACT,
      kind: CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND,
      preflightCount: this.#preflightCount,
      readCount: this.#readCount,
      ownershipTransferred: this.#readCount === 1,
      sourceRetainedBytes: this.#accountIdBytes?.length ?? 0,
      cleanupComplete: this.#cleanupComplete,
      clipboardRead: false,
      clipboardCleared: false,
    });
  }
}

function accountIdBytesSha256(accountIdBytes) {
  assertAccountIdBytes(accountIdBytes);
  return createHash('sha256')
    .update(ACCOUNT_FINGERPRINT_PREFIX)
    .update(accountIdBytes)
    .digest('hex');
}

function assertAccountTargetBytes(accountIdBytes, expectedAccountIdSha256) {
  validateExpectedFingerprint(expectedAccountIdSha256);
  assertAccountIdBytes(accountIdBytes, 'CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
  if (accountIdBytesSha256(accountIdBytes) !== expectedAccountIdSha256) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
  }
}

function base64UrlIndex(value) {
  if (value >= 0x41 && value <= 0x5a) return value - 0x41;
  if (value >= 0x61 && value <= 0x7a) return value - 0x61 + 26;
  if (value >= 0x30 && value <= 0x39) return value - 0x30 + 52;
  if (value === 0x2d) return 62;
  if (value === 0x5f) return 63;
  return -1;
}

function assertEncodedSecret(secret) {
  if (!Buffer.isBuffer(secret) || secret.length < 40 || secret.length > 512
    || secret.length % 4 === 1 || !secret.every((value) => base64UrlIndex(value) >= 0)) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
  }
  return secret;
}

function encodeBase64Url(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
  }
  const remainder = input.length % 3;
  const output = Buffer.alloc(Math.floor(input.length / 3) * 4 + (remainder === 0 ? 0 : remainder + 1));
  let source = 0;
  let destination = 0;
  while (source + 2 < input.length) {
    const value = input[source] << 16 | input[source + 1] << 8 | input[source + 2];
    output[destination] = BASE64URL_ALPHABET[value >>> 18 & 0x3f];
    output[destination + 1] = BASE64URL_ALPHABET[value >>> 12 & 0x3f];
    output[destination + 2] = BASE64URL_ALPHABET[value >>> 6 & 0x3f];
    output[destination + 3] = BASE64URL_ALPHABET[value & 0x3f];
    source += 3;
    destination += 4;
  }
  if (remainder === 1) {
    const value = input[source];
    output[destination] = BASE64URL_ALPHABET[value >>> 2];
    output[destination + 1] = BASE64URL_ALPHABET[value << 4 & 0x3f];
  } else if (remainder === 2) {
    const value = input[source] << 8 | input[source + 1];
    output[destination] = BASE64URL_ALPHABET[value >>> 10 & 0x3f];
    output[destination + 1] = BASE64URL_ALPHABET[value >>> 4 & 0x3f];
    output[destination + 2] = BASE64URL_ALPHABET[value << 2 & 0x3f];
  }
  return output;
}

function decodeBase64Url(input) {
  assertEncodedSecret(input);
  const remainder = input.length % 4;
  const output = Buffer.alloc(Math.floor(input.length * 6 / 8));
  let source = 0;
  let destination = 0;
  try {
    while (source + 3 < input.length) {
      const value = base64UrlIndex(input[source]) << 18
        | base64UrlIndex(input[source + 1]) << 12
        | base64UrlIndex(input[source + 2]) << 6
        | base64UrlIndex(input[source + 3]);
      output[destination] = value >>> 16 & 0xff;
      output[destination + 1] = value >>> 8 & 0xff;
      output[destination + 2] = value & 0xff;
      source += 4;
      destination += 3;
    }
    if (remainder === 2) {
      const first = base64UrlIndex(input[source]);
      const second = base64UrlIndex(input[source + 1]);
      if ((second & 0x0f) !== 0) fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
      output[destination] = first << 2 | second >>> 4;
    } else if (remainder === 3) {
      const first = base64UrlIndex(input[source]);
      const second = base64UrlIndex(input[source + 1]);
      const third = base64UrlIndex(input[source + 2]);
      if ((third & 0x03) !== 0) fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
      output[destination] = first << 2 | second >>> 4;
      output[destination + 1] = second << 4 | third >>> 2;
    }
    let canonical;
    try {
      canonical = encodeBase64Url(output);
      if (canonical.length !== input.length || !timingSafeEqual(canonical, input)) {
        fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
      }
    } finally { zeroBuffer(canonical); }
    return output;
  } catch (error) {
    output.fill(0);
    if (error?.message === 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD') throw error;
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
  }
}

function encodeAccountTarget(accountIdBytes) {
  assertAccountIdBytes(accountIdBytes);
  const payload = Buffer.alloc(PAYLOAD_PREFIX.length + ACCOUNT_ID_BYTES + PAYLOAD_SUFFIX.length);
  try {
    PAYLOAD_PREFIX.copy(payload, 0);
    accountIdBytes.copy(payload, PAYLOAD_PREFIX.length);
    PAYLOAD_SUFFIX.copy(payload, PAYLOAD_PREFIX.length + ACCOUNT_ID_BYTES);
    return encodeBase64Url(payload);
  } finally { payload.fill(0); }
}

function decodeAccountTarget(secret) {
  assertEncodedSecret(secret);
  let decoded;
  let accountIdBytes;
  let returned = false;
  try {
    decoded = decodeBase64Url(secret);
    if (decoded.length !== PAYLOAD_PREFIX.length + ACCOUNT_ID_BYTES + PAYLOAD_SUFFIX.length
      || !decoded.subarray(0, PAYLOAD_PREFIX.length).equals(PAYLOAD_PREFIX)
      || !decoded.subarray(PAYLOAD_PREFIX.length + ACCOUNT_ID_BYTES).equals(PAYLOAD_SUFFIX)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
    }
    accountIdBytes = Buffer.from(decoded.subarray(
      PAYLOAD_PREFIX.length, PAYLOAD_PREFIX.length + ACCOUNT_ID_BYTES,
    ));
    assertAccountIdBytes(accountIdBytes);
    returned = true;
    return accountIdBytes;
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD') throw error;
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
  } finally {
    zeroBuffer(decoded);
    if (!returned) zeroBuffer(accountIdBytes);
  }
}

function createMetadata(accountIdBytes, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
  }
  const identity = cloudflareAccountTargetIdentity();
  return validateCloudflareAccountTargetMetadata({
    schemaVersion: 1,
    contract: METADATA_CONTRACT,
    keychainService: identity.service,
    keychainAccount: identity.account,
    accountIdSha256: accountIdBytesSha256(accountIdBytes),
    createdAt: now.toISOString(),
    purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
  });
}

export class MacOSSingleReadClipboard {
  constructor({
    accessFile = access,
    spawnChild = spawnNativeAccountTargetChild,
    timeoutMs,
    terminateGraceMs,
    killGraceMs,
    setTimeoutImpl,
    clearTimeoutImpl,
    readUserInfo = userInfo,
  } = {}) {
    if (typeof accessFile !== 'function' || typeof spawnChild !== 'function') {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
    }
    this.accessFile = accessFile;
    this.spawnChild = spawnChild;
    Object.defineProperty(this, 'environment', {
      value: createNativeMacEnvironment(readUserInfo),
      writable: false,
      configurable: false,
      enumerable: false,
    });
    this.lifecycle = childLifecycleOptions({
      timeoutMs, terminateGraceMs, killGraceMs, setTimeoutImpl, clearTimeoutImpl,
    });
  }

  async preflight() {
    try {
      await Promise.all([
        this.accessFile('/usr/bin/pbpaste', fsConstants.X_OK),
        this.accessFile('/usr/bin/pbcopy', fsConstants.X_OK),
      ]);
    } catch { fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_PREFLIGHT'); }
  }

  async clear() {
    let result;
    let verification;
    let marker;
    try {
      marker = Buffer.from(CLIPBOARD_CLEARED_MARKER, 'ascii');
      result = await runBoundedChild({
        spawnChild: this.spawnChild,
        file: '/usr/bin/pbcopy',
        args: [],
        input: marker,
        maxStdoutBytes: 0,
        maxStderrBytes: CHILD_STDERR_MAX_BYTES,
        errorCode: 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR',
        lifecycle: this.lifecycle,
        environment: this.environment,
      });
      if (result.code !== 0 || result.signal !== null
        || result.stdout.length !== 0 || result.stderr.length !== 0) {
        fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
      }
      marker = Buffer.from(CLIPBOARD_CLEARED_MARKER, 'ascii');
      verification = await runBoundedChild({
        spawnChild: this.spawnChild,
        file: '/usr/bin/pbpaste',
        args: [],
        maxStdoutBytes: marker.length,
        maxStderrBytes: CHILD_STDERR_MAX_BYTES,
        errorCode: 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR',
        lifecycle: this.lifecycle,
        environment: this.environment,
      });
      if (verification.code !== 0 || verification.signal !== null
        || verification.stderr.length !== 0 || verification.stdout.length !== marker.length
        || !timingSafeEqual(verification.stdout, marker)) {
        fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
      }
    } catch (error) {
      if (['CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR', TEST_NATIVE_SPAWN_ERROR]
        .includes(error?.message)) throw error;
      fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
    } finally {
      zeroBuffer(result?.stdout);
      zeroBuffer(result?.stderr);
      zeroBuffer(verification?.stdout);
      zeroBuffer(verification?.stderr);
      zeroBuffer(marker);
    }
  }

  async readOnce() {
    let result;
    let returned = false;
    try {
      result = await runBoundedChild({
        spawnChild: this.spawnChild,
        file: '/usr/bin/pbpaste',
        args: [],
        maxStdoutBytes: 4096,
        maxStderrBytes: CHILD_STDERR_MAX_BYTES,
        errorCode: 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD',
        lifecycle: this.lifecycle,
        environment: this.environment,
      });
      if (result.code !== 0 || result.signal !== null
        || result.stdout.length === 0 || result.stderr.length !== 0) {
        fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD');
      }
      returned = true;
      return result.stdout;
    } catch (error) {
      if (['CLOUDFLARE_E_ACCOUNT_CLIPBOARD', TEST_NATIVE_SPAWN_ERROR]
        .includes(error?.message)) throw error;
      fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD');
    } finally {
      if (!returned) zeroBuffer(result?.stdout);
      zeroBuffer(result?.stderr);
    }
  }

  async readOnceAndClear() {
    let raw;
    try {
      raw = await this.readOnce();
      try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); }
      catch { fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD'); }
    } finally {
      zeroBuffer(raw);
      await this.clear();
    }
  }
}

function assertAccountKeychainIdentity(service, account) {
  if (service !== CLOUDFLARE_ACCOUNT_TARGET_SERVICE
    || account !== CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  }
}

export class MacOSAccountTargetKeychainStore {
  constructor({
    spawnChild = spawnNativeAccountTargetChild,
    timeoutMs,
    terminateGraceMs,
    killGraceMs,
    setTimeoutImpl,
    clearTimeoutImpl,
    readUserInfo = userInfo,
  } = {}) {
    if (typeof spawnChild !== 'function') {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
    }
    this.spawnChild = spawnChild;
    Object.defineProperty(this, 'environment', {
      value: createNativeMacEnvironment(readUserInfo),
      writable: false,
      configurable: false,
      enumerable: false,
    });
    this.lifecycle = childLifecycleOptions({
      timeoutMs, terminateGraceMs, killGraceMs, setTimeoutImpl, clearTimeoutImpl,
    });
  }

  async get(service, account) {
    assertAccountKeychainIdentity(service, account);
    let result;
    let secret;
    let returned = false;
    try {
      result = await runBoundedChild({
        spawnChild: this.spawnChild,
        file: '/usr/bin/security',
        args: [
          'find-generic-password', '-s', service, '-a', account, '-w',
        ],
        maxStdoutBytes: 513,
        maxStderrBytes: CHILD_STDERR_MAX_BYTES,
        errorCode: 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN',
        lifecycle: this.lifecycle,
        environment: this.environment,
      });
      if (result.signal !== null) fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
      if (result.code === 44) {
        if (result.stdout.length !== 0) fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
        return null;
      }
      if (result.code !== 0 || result.stderr.length !== 0
        || result.stdout.length < 2 || result.stdout.at(-1) !== 0x0a) {
        fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
      }
      secret = Buffer.from(result.stdout.subarray(0, result.stdout.length - 1));
      assertEncodedSecret(secret);
      returned = true;
      return secret;
    } catch (error) {
      if (error?.message === 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD'
        || error?.message === 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN'
        || error?.message === TEST_NATIVE_SPAWN_ERROR) throw error;
      fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
    } finally {
      zeroBuffer(result?.stdout);
      zeroBuffer(result?.stderr);
      if (!returned) zeroBuffer(secret);
    }
  }

  async putCreateOnly(service, account, secret) {
    assertAccountKeychainIdentity(service, account);
    assertEncodedSecret(secret);
    let expected;
    let existing;
    let command;
    let result;
    let verified;
    try {
      expected = Buffer.from(secret);
      zeroBuffer(secret);
      existing = await this.get(service, account);
      if (existing !== null) fail('CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
      const prefix = Buffer.from(`add-generic-password -s ${service} -a ${account} -w `, 'ascii');
      const suffix = Buffer.from('\nquit\n', 'ascii');
      try {
        command = Buffer.alloc(prefix.length + expected.length + suffix.length);
        prefix.copy(command, 0);
        expected.copy(command, prefix.length);
        suffix.copy(command, prefix.length + expected.length);
      } finally {
        prefix.fill(0);
        suffix.fill(0);
      }
      result = await runBoundedChild({
        spawnChild: this.spawnChild,
        file: '/usr/bin/security',
        args: ['-i'],
        input: command,
        maxStdoutBytes: CHILD_STDERR_MAX_BYTES,
        maxStderrBytes: CHILD_STDERR_MAX_BYTES,
        errorCode: 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN',
        lifecycle: this.lifecycle,
        environment: this.environment,
      });
      command = null;
      if (result.signal !== null || ![0, 1].includes(result.code)) {
        fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
      }
      verified = await this.get(service, account);
      if (!exactSecretMatch(verified, expected)) {
        fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
      }
    } finally {
      zeroBuffer(secret);
      zeroBuffer(expected);
      zeroBuffer(existing);
      zeroBuffer(command);
      zeroBuffer(result?.stdout);
      zeroBuffer(result?.stderr);
      zeroBuffer(verified);
    }
  }
}

async function inspectExistingMetadata(metadataPath, expectedAccountIdSha256,
  readFile = readSecureFile) {
  let stored;
  let canonicalBytes;
  try {
    stored = await readFile(metadataPath, 64 * 1024, { allowEmpty: true });
    if (!Buffer.isBuffer(stored)) fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
    const storageSha256 = sha256Hex(stored);
    if (stored.length === 0) {
      return { state: 'partial', bytes: 0, storageSha256 };
    }
    try {
      const parsed = parseCanonicalEvidenceStorage(stored);
      canonicalBytes = parsed.canonicalBytes;
      const metadata = validateCloudflareAccountTargetMetadata(parsed.payload, {
        expectedAccountIdSha256,
      });
      return { state: 'valid', bytes: stored.length, storageSha256, metadata };
    } catch (error) {
      if (error?.message === 'CLOUDFLARE_E_SIGNING_CANONICAL') {
        return { state: 'partial', bytes: stored.length, storageSha256 };
      }
      throw error;
    }
  } catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_SIGNING_FILE')) throw error;
    if (error?.message?.startsWith('CLOUDFLARE_E_ACCOUNT_STORE')) throw error;
    fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
  } finally {
    zeroBuffer(stored);
    zeroBuffer(canonicalBytes);
  }
}

async function inspectMetadataDestination(metadataPath, expectedAccountIdSha256, {
  assertDestination = assertSecureCreateOnlyDestination,
  readFile = readSecureFile,
} = {}) {
  try {
    await assertDestination(metadataPath);
    return { state: 'absent' };
  } catch (error) {
    if (error?.message !== 'CLOUDFLARE_E_SIGNING_FILE_EXISTS') throw error;
  }
  return inspectExistingMetadata(metadataPath, expectedAccountIdSha256, readFile);
}

function classifyMetadataLayout(primary, recovery) {
  if (primary.state === 'absent' && recovery.state === 'absent') return 'empty';
  if (primary.state === 'valid' && recovery.state === 'absent') return 'primary-valid';
  if (primary.state === 'partial' && recovery.state === 'absent') return 'primary-partial';
  if (primary.state === 'partial' && recovery.state === 'valid') return 'recovery-valid';
  if (primary.state === 'partial' && recovery.state === 'partial') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_EXHAUSTED');
  }
  fail('CLOUDFLARE_E_ACCOUNT_STORE_STATE');
}

async function inspectMetadataLayout({
  metadataOutput,
  recoveryMetadataOutput,
  expectedAccountIdSha256,
  assertDestination = assertSecureCreateOnlyDestination,
  readFile = readSecureFile,
}) {
  const primary = await inspectMetadataDestination(metadataOutput, expectedAccountIdSha256, {
    assertDestination, readFile,
  });
  const recovery = await inspectMetadataDestination(
    recoveryMetadataOutput, expectedAccountIdSha256, { assertDestination, readFile },
  );
  return {
    state: classifyMetadataLayout(primary, recovery),
    primary,
    recovery,
  };
}

function metadataLayoutIdentity(layout) {
  const leaf = (value) => ({
    state: value.state,
    ...(value.state === 'absent' ? {} : {
      bytes: value.bytes,
      storageSha256: value.storageSha256,
    }),
  });
  return canonicalJson({
    state: layout.state,
    primary: leaf(layout.primary),
    recovery: leaf(layout.recovery),
  });
}

async function readMatchingKeychainTarget(store, expectedAccountIdSha256) {
  const identity = cloudflareAccountTargetIdentity();
  let secret;
  let accountIdBytes;
  try {
    secret = await store.get(identity.service, identity.account);
    if (secret === null) return { state: 'absent' };
    if (!Buffer.isBuffer(secret)) fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
    accountIdBytes = decodeAccountTarget(secret);
    assertAccountTargetBytes(accountIdBytes, expectedAccountIdSha256);
    return { state: 'matching' };
  } finally {
    zeroBuffer(secret);
    zeroBuffer(accountIdBytes);
  }
}

function exactSecretMatch(first, second) {
  return Buffer.isBuffer(first) && Buffer.isBuffer(second)
    && first.length === second.length && timingSafeEqual(first, second);
}

async function inspectInitializationState({
  metadataOutput,
  recoveryMetadataOutput,
  expectedAccountIdSha256,
  store,
  assertDestination,
  readFile,
}) {
  const layout = await inspectMetadataLayout({
    metadataOutput, recoveryMetadataOutput, expectedAccountIdSha256,
    assertDestination, readFile,
  });
  const keychain = await readMatchingKeychainTarget(store, expectedAccountIdSha256);
  let state;
  if (keychain.state === 'absent' && layout.state === 'empty') state = 'ready';
  else if (keychain.state === 'matching'
    && ['empty', 'primary-partial'].includes(layout.state)) state = 'recovery-required';
  else if (keychain.state === 'matching'
    && ['primary-valid', 'recovery-valid'].includes(layout.state)) state = 'complete';
  else fail('CLOUDFLARE_E_ACCOUNT_STORE_STATE');
  return { state, layout, keychain };
}

function fixedRecoveryPath(metadataOutput, recoveryMetadataOutput) {
  const fixed = cloudflareAccountTargetRecoveryMetadataPath(metadataOutput);
  if (recoveryMetadataOutput !== undefined && recoveryMetadataOutput !== fixed) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PATH');
  }
  return fixed;
}

function selectAccountIdSource({ clipboard, accountIdSource } = {}) {
  if (clipboard !== undefined && accountIdSource !== undefined) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  if (accountIdSource !== undefined) {
    if (!(accountIdSource instanceof InAppBrowserAccountIdBufferSource)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
    }
    return Object.freeze({ kind: CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND, source: accountIdSource });
  }
  const selectedClipboard = clipboard ?? new MacOSSingleReadClipboard();
  if (typeof selectedClipboard?.preflight !== 'function'
    || typeof selectedClipboard?.readOnce !== 'function'
    || typeof selectedClipboard?.clear !== 'function') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  return Object.freeze({ kind: 'macos-clipboard-v1', source: selectedClipboard });
}

export async function preflightCloudflareAccountTargetInitialization({
  metadataOutput = defaultCloudflareAccountTargetMetadataPath(),
  recoveryMetadataOutput,
  expectedAccountIdSha256,
  clipboard,
  accountIdSource,
  store = new MacOSAccountTargetKeychainStore(),
  assertDestination = assertSecureCreateOnlyDestination,
  readFile = readSecureFile,
} = {}) {
  validateExpectedFingerprint(expectedAccountIdSha256);
  const recovery = fixedRecoveryPath(metadataOutput, recoveryMetadataOutput);
  const selectedSource = selectAccountIdSource({ clipboard, accountIdSource });
  if (typeof store?.get !== 'function'
    || typeof assertDestination !== 'function' || typeof readFile !== 'function') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  if (selectedSource.kind === CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND) {
    await selectedSource.source.preflight();
  }
  const inspected = await inspectInitializationState({
    metadataOutput,
    recoveryMetadataOutput: recovery,
    expectedAccountIdSha256,
    store,
    assertDestination,
    readFile,
  });
  if (selectedSource.kind === 'macos-clipboard-v1') {
    await selectedSource.source.preflight();
  }
  return Object.freeze({
    purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
    accountIdSha256: expectedAccountIdSha256,
    state: inspected.state,
    primaryState: inspected.layout.primary.state,
    recoveryState: inspected.layout.recovery.state,
    keychainState: inspected.keychain.state,
    clipboardRead: false,
    clipboardCleared: false,
    readyForInitialize: inspected.state === 'ready',
    ...(selectedSource.kind === CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND ? {
      sourceKind: selectedSource.kind,
      sourceEvidence: selectedSource.source.evidence(),
    } : {}),
  });
}

export async function initializeCloudflareAccountTarget({
  metadataOutput,
  recoveryMetadataOutput,
  expectedAccountIdSha256,
  clipboard,
  accountIdSource,
  store,
  now,
  assertDestination = assertSecureCreateOnlyDestination,
  readFile = readSecureFile,
  writeMetadata = writeCanonicalEvidenceCreateOnly,
} = {}) {
  let raw;
  let accountIdBytes;
  let secret;
  let verifiedSecret;
  let clipboardTouched = false;
  let clipboardCleared = false;
  let selectedSource;
  const directSourceForCleanup = accountIdSource instanceof InAppBrowserAccountIdBufferSource
    ? accountIdSource : null;
  try {
    selectedSource = selectAccountIdSource({ clipboard, accountIdSource });
    const selectedMetadataOutput = metadataOutput === undefined
      ? defaultCloudflareAccountTargetMetadataPath() : metadataOutput;
    const selectedStore = store === undefined
      ? new MacOSAccountTargetKeychainStore() : store;
    const selectedNow = now === undefined ? new Date() : now;
    if (!(selectedNow instanceof Date) || Number.isNaN(selectedNow.getTime())) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
    }
    if (typeof selectedStore?.putCreateOnly !== 'function'
      || typeof writeMetadata !== 'function') {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
    }
    const recovery = fixedRecoveryPath(selectedMetadataOutput, recoveryMetadataOutput);
    const identity = cloudflareAccountTargetIdentity();
    const initial = await preflightCloudflareAccountTargetInitialization({
      metadataOutput: selectedMetadataOutput,
      recoveryMetadataOutput: recovery,
      expectedAccountIdSha256,
      ...(selectedSource.kind === CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND
        ? { accountIdSource: selectedSource.source }
        : { clipboard: selectedSource.source }),
      store: selectedStore,
      assertDestination,
      readFile,
    });
    if (initial.state !== 'ready') {
      fail(initial.keychainState === 'matching'
        ? 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS' : 'CLOUDFLARE_E_ACCOUNT_STORE_STATE');
    }
    clipboardTouched = selectedSource.kind === 'macos-clipboard-v1';
    raw = await selectedSource.source.readOnce();
    if (clipboardTouched) {
      await selectedSource.source.clear();
      clipboardCleared = true;
    }
    assertAccountIdBytes(raw);
    assertAccountTargetBytes(raw, expectedAccountIdSha256);
    accountIdBytes = raw;
    raw = null;
    const beforeCreate = await inspectInitializationState({
      metadataOutput: selectedMetadataOutput,
      recoveryMetadataOutput: recovery,
      expectedAccountIdSha256,
      store: selectedStore,
      assertDestination,
      readFile,
    });
    if (beforeCreate.state !== 'ready') fail('CLOUDFLARE_E_ACCOUNT_STORE_STATE');
    secret = encodeAccountTarget(accountIdBytes);
    try {
      try { await selectedStore.putCreateOnly(identity.service, identity.account, secret); }
      finally { zeroBuffer(secret); secret = null; }
    }
    catch (error) {
      if (['CLOUDFLARE_E_SIGNING_KEY_EXISTS', 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS']
        .includes(error?.message)) fail('CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
      throw error;
    }
    secret = encodeAccountTarget(accountIdBytes);
    verifiedSecret = await selectedStore.get(identity.service, identity.account);
    if (!exactSecretMatch(verifiedSecret, secret)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
    }
    verifiedSecret.fill(0);
    verifiedSecret = null;
    const beforeMetadata = await inspectMetadataLayout({
      metadataOutput: selectedMetadataOutput,
      recoveryMetadataOutput: recovery,
      expectedAccountIdSha256,
      assertDestination,
      readFile,
    });
    if (beforeMetadata.state !== 'empty') fail('CLOUDFLARE_E_ACCOUNT_STORE_STATE');
    const metadata = createMetadata(accountIdBytes, selectedNow);
    await writeMetadata(selectedMetadataOutput, metadata);
    const completed = await inspectInitializationState({
      metadataOutput: selectedMetadataOutput,
      recoveryMetadataOutput: recovery,
      expectedAccountIdSha256,
      store: selectedStore,
      assertDestination,
      readFile,
    });
    if (completed.state !== 'complete' || completed.layout.state !== 'primary-valid'
      || completed.layout.recovery.state !== 'absent'
      || canonicalJson(completed.layout.primary.metadata) !== canonicalJson(metadata)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_POSTCONDITION');
    }
    return metadata;
  } finally {
    zeroBuffer(raw);
    zeroBuffer(accountIdBytes);
    zeroBuffer(secret);
    zeroBuffer(verifiedSecret);
    if (clipboardTouched && !clipboardCleared) await selectedSource.source.clear();
    const directSource = selectedSource?.kind === CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND
      ? selectedSource.source : directSourceForCleanup;
    if (directSource !== null) await directSource.cleanup();
  }
}

export async function recoverCloudflareAccountTargetMetadata({
  metadataOutput = defaultCloudflareAccountTargetMetadataPath(),
  recoveryMetadataOutput,
  expectedAccountIdSha256,
  store = new MacOSAccountTargetKeychainStore(),
  now = new Date(),
  assertDestination = assertSecureCreateOnlyDestination,
  readFile = readSecureFile,
  writeMetadata = writeCanonicalEvidenceCreateOnly,
} = {}) {
  validateExpectedFingerprint(expectedAccountIdSha256);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
  }
  if (typeof store?.get !== 'function' || typeof assertDestination !== 'function'
    || typeof readFile !== 'function' || typeof writeMetadata !== 'function') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  const fixedRecoveryMetadataOutput = fixedRecoveryPath(
    metadataOutput, recoveryMetadataOutput,
  );
  const firstLayout = await inspectMetadataLayout({
    metadataOutput,
    recoveryMetadataOutput: fixedRecoveryMetadataOutput,
    expectedAccountIdSha256,
    assertDestination,
    readFile,
  });
  const identity = cloudflareAccountTargetIdentity();
  let secret;
  let accountIdBytes;
  let confirmedSecret;
  let finalSecret;
  try {
    secret = await store.get(identity.service, identity.account);
    if (secret === null) fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
    if (!Buffer.isBuffer(secret)) fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
    accountIdBytes = decodeAccountTarget(secret);
    assertAccountTargetBytes(accountIdBytes, expectedAccountIdSha256);
    const confirmedLayout = await inspectMetadataLayout({
      metadataOutput,
      recoveryMetadataOutput: fixedRecoveryMetadataOutput,
      expectedAccountIdSha256,
      assertDestination,
      readFile,
    });
    if (metadataLayoutIdentity(firstLayout) !== metadataLayoutIdentity(confirmedLayout)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_RACE');
    }
    confirmedSecret = await store.get(identity.service, identity.account);
    if (!exactSecretMatch(confirmedSecret, secret)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
    }
    confirmedSecret.fill(0);
    confirmedSecret = null;
    if (confirmedLayout.state === 'primary-valid') return confirmedLayout.primary.metadata;
    if (confirmedLayout.state === 'recovery-valid') return confirmedLayout.recovery.metadata;
    const metadata = createMetadata(accountIdBytes, now);
    const destination = confirmedLayout.state === 'empty'
      ? metadataOutput
      : confirmedLayout.state === 'primary-partial'
        ? fixedRecoveryMetadataOutput : null;
    if (destination === null) fail('CLOUDFLARE_E_ACCOUNT_STORE_STATE');
    await writeMetadata(destination, metadata);
    const completed = await inspectMetadataLayout({
      metadataOutput,
      recoveryMetadataOutput: fixedRecoveryMetadataOutput,
      expectedAccountIdSha256,
      assertDestination,
      readFile,
    });
    const expectedState = destination === metadataOutput ? 'primary-valid' : 'recovery-valid';
    const selected = destination === metadataOutput ? completed.primary : completed.recovery;
    finalSecret = await store.get(identity.service, identity.account);
    if (completed.state !== expectedState || selected.state !== 'valid'
      || canonicalJson(selected.metadata) !== canonicalJson(metadata)
      || !exactSecretMatch(finalSecret, secret)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_POSTCONDITION');
    }
    finalSecret.fill(0);
    finalSecret = null;
    return metadata;
  } finally {
    zeroBuffer(secret);
    zeroBuffer(accountIdBytes);
    zeroBuffer(confirmedSecret);
    zeroBuffer(finalSecret);
  }
}

async function loadCloudflareAccountTargetBytes({
  metadataPath = defaultCloudflareAccountTargetMetadataPath(),
  recoveryMetadataPath,
  expectedAccountIdSha256,
  store = new MacOSAccountTargetKeychainStore(),
  readFile = readSecureFile,
  assertDestination = assertSecureCreateOnlyDestination,
} = {}) {
  validateExpectedFingerprint(expectedAccountIdSha256);
  if (typeof store?.get !== 'function' || typeof assertDestination !== 'function'
    || typeof readFile !== 'function') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
  }
  const fixedRecoveryMetadataPath = fixedRecoveryPath(metadataPath, recoveryMetadataPath);
  const firstLayout = await inspectMetadataLayout({
    metadataOutput: metadataPath,
    recoveryMetadataOutput: fixedRecoveryMetadataPath,
    expectedAccountIdSha256,
    assertDestination,
    readFile,
  });
  if (firstLayout.state === 'empty') fail('CLOUDFLARE_E_SIGNING_FILE');
  if (firstLayout.state === 'primary-partial') {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_REQUIRED');
  }
  const selected = firstLayout.state === 'primary-valid'
    ? firstLayout.primary : firstLayout.recovery;
  const metadata = selected.metadata;
  let secret;
  let confirmedSecret;
  let accountIdBytes;
  let returned = false;
  try {
    secret = await store.get(metadata.keychainService, metadata.keychainAccount);
    if (secret === null) fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
    if (!Buffer.isBuffer(secret)) fail('CLOUDFLARE_E_ACCOUNT_STORE_IMPLEMENTATION');
    accountIdBytes = decodeAccountTarget(secret);
    assertAccountTargetBytes(accountIdBytes, expectedAccountIdSha256);
    const confirmedLayout = await inspectMetadataLayout({
      metadataOutput: metadataPath,
      recoveryMetadataOutput: fixedRecoveryMetadataPath,
      expectedAccountIdSha256,
      assertDestination,
      readFile,
    });
    if (metadataLayoutIdentity(firstLayout) !== metadataLayoutIdentity(confirmedLayout)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_RACE');
    }
    confirmedSecret = await store.get(metadata.keychainService, metadata.keychainAccount);
    if (!exactSecretMatch(confirmedSecret, secret)) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
    }
    returned = true;
    return { metadata, accountIdBytes };
  } finally {
    zeroBuffer(secret);
    zeroBuffer(confirmedSecret);
    if (!returned) zeroBuffer(accountIdBytes);
  }
}

export async function verifyCloudflareAccountTarget(options = {}) {
  let accountIdBytes;
  try {
    const verified = await loadCloudflareAccountTargetBytes(options);
    accountIdBytes = verified.accountIdBytes;
    return verified.metadata;
  } finally {
    zeroBuffer(accountIdBytes);
  }
}

export async function loadCloudflareAccountTarget(options = {}) {
  let accountIdBytes;
  try {
    const loaded = await loadCloudflareAccountTargetBytes(options);
    accountIdBytes = loaded.accountIdBytes;
    return { metadata: loaded.metadata, accountId: accountIdBytes.toString('ascii') };
  } finally {
    zeroBuffer(accountIdBytes);
  }
}
