import { Buffer } from 'node:buffer';
import { fstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_FILE = fileURLToPath(import.meta.url);
const DERIVED_ROOT = path.resolve(path.dirname(MODULE_FILE), '..');

export const CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT
  = 'dwnc-cloudflare-staging-control-token-stdin-v1';
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES = 53;
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_MAX_BYTES = 54;
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_TIMEOUT_MS = 60_000;
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE
  = `cfat_${'P'.repeat(40)}${'0'.repeat(8)}`;

const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ACCOUNT_ID = /[A-Fa-f0-9]{32}/u;
const ACCOUNT_API_TOKEN = /cfat_[A-Za-z0-9]{40}[a-f0-9]{8}/u;
const ALLOWED_ENVIRONMENT_NAMES = Object.freeze([
  'HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', '__CF_USER_TEXT_ENCODING',
]);
const ALLOWED_ENVIRONMENT_NAME_SET = new Set(ALLOWED_ENVIRONMENT_NAMES);
const GUARDED_SIGNALS = Object.freeze([
  'SIGTERM', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGUSR1',
]);
const SAFE_ERROR_CODES = new Set([
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_ARGUMENT',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_ENVIRONMENT',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_FAILED',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_PROBE',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_SOURCE_REUSED',
  'CLOUDFLARE_E_STAGING_CONTROL_STDIN_TIMEOUT',
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
  'CLOUDFLARE_E_KEYCHAIN',
  'CLOUDFLARE_E_SIGNING_CANONICAL',
  'CLOUDFLARE_E_SIGNING_FILE',
  'CLOUDFLARE_E_SIGNING_FILE_EXISTS',
  'CLOUDFLARE_E_SIGNING_FILE_RACE',
  'CLOUDFLARE_E_SIGNING_KEY_EXISTS',
  'CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT',
  'CLOUDFLARE_E_STAGING_CONTROL_ARGUMENT',
  'CLOUDFLARE_E_STAGING_CONTROL_EXISTS',
  'CLOUDFLARE_E_STAGING_CONTROL_IMPLEMENTATION',
  'CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN',
  'CLOUDFLARE_E_STAGING_CONTROL_METADATA',
  'CLOUDFLARE_E_STAGING_CONTROL_PARENT_CREDENTIAL',
  'CLOUDFLARE_E_STAGING_CONTROL_PERMISSION',
  'CLOUDFLARE_E_STAGING_CONTROL_RECOVERY_EXHAUSTED',
  'CLOUDFLARE_E_STAGING_CONTROL_RECOVERY_REQUIRED',
  'CLOUDFLARE_E_STAGING_CONTROL_STORE_PATH',
  'CLOUDFLARE_E_STAGING_CONTROL_TIME',
  'CLOUDFLARE_E_STAGING_CONTROL_TOKEN_FORMAT',
  'CLOUDFLARE_E_STAGING_CONTROL_VERIFY',
]);

const PROBE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'mode', 'input', 'inputBytes',
  'inputKind', 'inputReads', 'bufferZeroed', 'sideEffects', 'clipboardRead',
  'clipboardCleared', 'rawTokenPrinted',
]);
const COMPLETE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'mode', 'input', 'inputBytes',
  'inputKind', 'inputReads', 'bufferZeroed', 'durableState', 'environment', 'purpose',
  'accountIdSha256', 'apiTokenSha256', 'tokenIdSha256', 'statusAtVerification',
  'notBefore', 'expiresAt', 'permissionContractSha256', 'clipboardRead',
  'clipboardCleared', 'rawAccountPrinted', 'rawTokenPrinted', 'rawTokenIdPrinted',
]);
const FAILED_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'mode', 'errorCode', 'durableState',
  'inputReads', 'bufferZeroed', 'clipboardRead', 'clipboardCleared',
  'rawTokenPrinted',
]);

function fail(code) { throw new Error(code); }
function zeroBuffer(value) { if (Buffer.isBuffer(value)) value.fill(0); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}
function safeErrorCode(error) {
  const candidate = error?.message;
  return typeof candidate === 'string' && SAFE_ERROR_CODES.has(candidate)
    ? candidate : 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_FAILED';
}
function inferredMode(argv) {
  return Array.isArray(argv) && argv.length === 1 && argv[0] === '--probe'
    ? 'probe' : Array.isArray(argv) && argv.length === 0 ? 'initialize' : 'unknown';
}

async function loadDefaultManager() {
  const loaded = await import('./manage-cloudflare-staging-control-token.mjs');
  if (typeof loaded?.manageCloudflareStagingControlToken !== 'function') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
  }
  return loaded.manageCloudflareStagingControlToken;
}

function validateRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || root !== DERIVED_ROOT || process.cwd() !== DERIVED_ROOT) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_ARGUMENT');
  }
}

function validateEnvironment(environment, execArgv) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)
    || !Array.isArray(execArgv) || execArgv.length !== 0) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_ENVIRONMENT');
  }
  const names = Object.keys(environment);
  if (names.length !== ALLOWED_ENVIRONMENT_NAMES.length
    || names.some((name) => !ALLOWED_ENVIRONMENT_NAME_SET.has(name))) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_ENVIRONMENT');
  }
  for (const value of Object.values(environment)) {
    if (typeof value !== 'string'
      || ACCOUNT_API_TOKEN.test(value) || ACCOUNT_ID.test(value)) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_ENVIRONMENT');
    }
  }
}

function inspectStdinPipeInput(input) {
  if (input !== process.stdin || !Number.isInteger(input.fd)) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  }
  try {
    const stat = fstatSync(input.fd);
    return stat.isFIFO() ? 'fifo' : stat.isSocket() ? 'socket' : 'other';
  }
  catch { fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT'); }
}

function validateInput(input, inspectInput) {
  if (!input || input.isTTY === true || typeof input.on !== 'function'
    || typeof input.removeListener !== 'function' || typeof input.resume !== 'function'
    || typeof input.pause !== 'function' || typeof inspectInput !== 'function') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  }
  try {
    const inputKind = inspectInput(input);
    if (!['fifo', 'socket'].includes(inputKind)) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
    }
    return inputKind;
  }
  catch (error) {
    if (error?.message === 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT') throw error;
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  }
}

function asOwnedBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export async function readCloudflareStagingControlTokenPipe({
  input = process.stdin,
  inspectInput = inspectStdinPipeInput,
  signalEmitter = process,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  registerCancel = () => undefined,
  unregisterCancel = () => undefined,
} = {}) {
  validateInput(input, inspectInput);
  if (!signalEmitter || typeof signalEmitter.on !== 'function'
    || typeof signalEmitter.removeListener !== 'function'
    || typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function'
    || typeof registerCancel !== 'function' || typeof unregisterCancel !== 'function') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
  }
  const received = Buffer.alloc(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_MAX_BYTES);
  let receivedBytes = 0;
  let returned;
  try {
    returned = await new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const remove = (emitter, event, listener) => {
        try { emitter.removeListener(event, listener); } catch { /* cleanup only */ }
      };
      const cleanup = () => {
        try { unregisterCancel(); } catch { /* cleanup only */ }
        try { clearTimeoutImpl(timer); } catch { /* cleanup only */ }
        remove(input, 'data', onData);
        remove(input, 'error', onError);
        remove(input, 'end', onEnd);
        remove(input, 'close', onClose);
        for (const signal of GUARDED_SIGNALS) remove(signalEmitter, signal, onSignal);
        remove(signalEmitter, 'exit', onExit);
        try { input.pause(); } catch { /* cleanup only */ }
      };
      const finish = (error = null, value = null) => {
        if (settled) { zeroBuffer(value); return; }
        settled = true;
        cleanup();
        received.fill(0);
        if (error === null) resolve(value);
        else { zeroBuffer(value); reject(error); }
      };
      const inputFailure = () => finish(
        new Error('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT'),
      );
      const onError = inputFailure;
      const onClose = inputFailure;
      const onSignal = () => finish(
        new Error('CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL'),
      );
      const onExit = () => { received.fill(0); cleanup(); };
      const onEnd = () => {
        if (receivedBytes !== CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES) {
          inputFailure();
          return;
        }
        const value = Buffer.from(received.subarray(
          0, CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES,
        ));
        finish(null, value);
      };
      const onData = (chunk) => {
        const owned = asOwnedBuffer(chunk);
        try {
          if (owned === null || receivedBytes > received.length - owned.length
            || owned.includes(0x0a) || owned.includes(0x0d)) {
            inputFailure();
            return;
          }
          owned.copy(received, receivedBytes);
          receivedBytes += owned.length;
          if (receivedBytes > CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES) {
            inputFailure();
          }
        } finally { zeroBuffer(owned); }
      };
      try {
        registerCancel(() => finish(
          new Error('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT'),
        ));
      } catch { inputFailure(); return; }
      let setupComplete = false;
      try {
        timer = setTimeoutImpl(
          () => finish(new Error('CLOUDFLARE_E_STAGING_CONTROL_STDIN_TIMEOUT')),
          CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_TIMEOUT_MS,
        );
        input.on('data', onData);
        input.on('error', onError);
        input.on('end', onEnd);
        input.on('close', onClose);
        for (const signal of GUARDED_SIGNALS) signalEmitter.on(signal, onSignal);
        signalEmitter.on('exit', onExit);
        input.resume();
        setupComplete = true;
      } finally {
        if (!setupComplete) inputFailure();
      }
    });
    return returned;
  } catch (error) {
    zeroBuffer(returned);
    if (SAFE_ERROR_CODES.has(error?.message)) throw error;
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  } finally { received.fill(0); }
}

export class StdinPipeStagingControlTokenSource {
  constructor({
    input = process.stdin,
    inspectInput = inspectStdinPipeInput,
    signalEmitter = process,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    this.input = input;
    this.inspectInput = inspectInput;
    this.signalEmitter = signalEmitter;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.preflightCount = 0;
    this.channelCheckCount = 0;
    this.readCount = 0;
    this.clearCount = 0;
    this.inputKind = null;
    this.bufferZeroed = true;
    this.cancelRead = null;
    this.beforeRead = () => undefined;
    this.onInputOwned = () => undefined;
  }

  bindSignalPhase({ beforeRead, onInputOwned } = {}) {
    if (this.channelCheckCount !== 0 || this.preflightCount !== 0 || this.readCount !== 0
      || typeof beforeRead !== 'function' || typeof onInputOwned !== 'function') {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
    }
    this.beforeRead = beforeRead;
    this.onInputOwned = onInputOwned;
  }

  validateChannel() {
    if (this.channelCheckCount !== 0 || this.preflightCount !== 0 || this.readCount !== 0) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_SOURCE_REUSED');
    }
    this.inputKind = validateInput(this.input, this.inspectInput);
    this.channelCheckCount += 1;
  }

  async preflight() {
    if (this.channelCheckCount !== 1 || this.preflightCount !== 0 || this.readCount !== 0) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_SOURCE_REUSED');
    }
    validateInput(this.input, this.inspectInput);
    this.beforeRead();
    this.preflightCount += 1;
  }

  async readOnceAndClear() {
    if (this.preflightCount !== 1 || this.readCount !== 0) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_SOURCE_REUSED');
    }
    this.readCount += 1;
    this.bufferZeroed = false;
    let raw;
    try {
      this.beforeRead();
      raw = await readCloudflareStagingControlTokenPipe({
        input: this.input,
        inspectInput: this.inspectInput,
        signalEmitter: this.signalEmitter,
        setTimeoutImpl: this.setTimeoutImpl,
        clearTimeoutImpl: this.clearTimeoutImpl,
        registerCancel: (cancel) => {
          if (this.cancelRead !== null || typeof cancel !== 'function') {
            fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
          }
          this.cancelRead = cancel;
        },
        unregisterCancel: () => { this.cancelRead = null; },
      });
      this.onInputOwned();
      try { return new TextDecoder('utf-8', { fatal: true }).decode(raw); }
      catch { fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT'); }
    } finally {
      zeroBuffer(raw);
      this.bufferZeroed = true;
      await this.clear();
    }
  }

  async clear() {
    this.clearCount += 1;
    const cancel = this.cancelRead;
    this.cancelRead = null;
    try { cancel?.(); } catch { /* memory cleanup remains best effort */ }
    this.bufferZeroed = true;
  }

  evidence() {
    return Object.freeze({
      preflightCount: this.preflightCount,
      channelCheckCount: this.channelCheckCount,
      readCount: this.readCount,
      clearCount: this.clearCount,
      inputKind: this.inputKind,
      bufferZeroed: this.bufferZeroed,
      clipboardRead: false,
      clipboardCleared: false,
    });
  }
}

class StagingControlTokenSignalGuard {
  constructor(signalEmitter) {
    this.signalEmitter = signalEmitter;
    this.installed = false;
    this.inputOwned = false;
    this.preOwnershipSignal = false;
    this.ignoredAfterOwnership = 0;
    this.onSignal = () => {
      if (this.inputOwned) this.ignoredAfterOwnership += 1;
      else this.preOwnershipSignal = true;
    };
  }

  install() {
    if (this.installed || !this.signalEmitter
      || typeof this.signalEmitter.on !== 'function'
      || typeof this.signalEmitter.removeListener !== 'function') {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
    }
    this.installed = true;
    try {
      for (const signal of GUARDED_SIGNALS) {
        this.signalEmitter.on(signal, this.onSignal);
      }
    } catch {
      this.cleanup();
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
    }
  }

  async checkpointBeforeOwnership() {
    await Promise.resolve();
    if (this.preOwnershipSignal) fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL');
  }

  claimInputOwnership() {
    if (this.preOwnershipSignal) fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL');
    this.inputOwned = true;
  }

  cleanup() {
    for (const signal of GUARDED_SIGNALS) {
      try { this.signalEmitter?.removeListener?.(signal, this.onSignal); }
      catch { /* cleanup only */ }
    }
    this.installed = false;
  }
}

export function validateCloudflareStagingControlTokenStdinMessage(value) {
  if (!value || value.schemaVersion !== 1
    || value.contract !== CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT');
  }
  if (value.status === 'complete' && value.mode === 'probe') {
    if (!exactKeys(value, PROBE_KEYS) || value.input !== 'stdin-fifo-or-socket-exact-eof'
      || value.inputBytes !== CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES
      || !['fifo', 'socket'].includes(value.inputKind)
      || value.inputReads !== 1 || value.bufferZeroed !== true
      || value.sideEffects !== 0 || value.clipboardRead !== false
      || value.clipboardCleared !== false || value.rawTokenPrinted !== false) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT');
    }
  } else if (value.status === 'complete' && value.mode === 'initialize') {
    if (!exactKeys(value, COMPLETE_KEYS) || value.input !== 'stdin-fifo-or-socket-exact-eof'
      || value.inputBytes !== CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES
      || !['fifo', 'socket'].includes(value.inputKind)
      || value.inputReads !== 1 || value.bufferZeroed !== true
      || value.durableState !== 'complete' || value.environment !== 'staging'
      || value.purpose !== 'staging-worker-control'
      || ![value.accountIdSha256, value.apiTokenSha256, value.tokenIdSha256,
        value.permissionContractSha256].every((item) => SHA256.test(item ?? ''))
      || value.statusAtVerification !== 'active'
      || !ISO_INSTANT.test(value.notBefore ?? '') || !ISO_INSTANT.test(value.expiresAt ?? '')
      || value.clipboardRead !== false || value.clipboardCleared !== false
      || value.rawAccountPrinted !== false || value.rawTokenPrinted !== false
      || value.rawTokenIdPrinted !== false) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT');
    }
  } else if (value.status === 'failed') {
    if (!exactKeys(value, FAILED_KEYS) || !['initialize', 'probe', 'unknown'].includes(value.mode)
      || !SAFE_ERROR_CODES.has(value.errorCode)
      || !['none', 'unknown'].includes(value.durableState)
      || ![0, 1].includes(value.inputReads) || typeof value.bufferZeroed !== 'boolean'
      || value.clipboardRead !== false || value.clipboardCleared !== false
      || value.rawTokenPrinted !== false) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT');
    }
  } else fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT');
  return value;
}

export function serializeCloudflareStagingControlTokenStdinMessage(value) {
  validateCloudflareStagingControlTokenStdinMessage(value);
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > 2048) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT');
  }
  return serialized;
}

function probeResult(source) {
  const evidence = source.evidence();
  return Object.freeze(validateCloudflareStagingControlTokenStdinMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT,
    status: 'complete',
    mode: 'probe',
    input: 'stdin-fifo-or-socket-exact-eof',
    inputBytes: CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES,
    inputKind: evidence.inputKind,
    inputReads: 1,
    bufferZeroed: true,
    sideEffects: 0,
    clipboardRead: false,
    clipboardCleared: false,
    rawTokenPrinted: false,
  }));
}

function completeResult(result, source) {
  const evidence = source.evidence();
  return Object.freeze(validateCloudflareStagingControlTokenStdinMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT,
    status: 'complete',
    mode: 'initialize',
    input: 'stdin-fifo-or-socket-exact-eof',
    inputBytes: CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES,
    inputKind: evidence.inputKind,
    inputReads: evidence.readCount,
    bufferZeroed: evidence.bufferZeroed,
    durableState: 'complete',
    environment: result?.environment,
    purpose: result?.purpose,
    accountIdSha256: result?.accountIdSha256,
    apiTokenSha256: result?.apiTokenSha256,
    tokenIdSha256: result?.tokenIdSha256,
    statusAtVerification: result?.statusAtVerification,
    notBefore: result?.notBefore,
    expiresAt: result?.expiresAt,
    permissionContractSha256: result?.permissionContractSha256,
    clipboardRead: false,
    clipboardCleared: false,
    rawAccountPrinted: false,
    rawTokenPrinted: false,
    rawTokenIdPrinted: false,
  }));
}

function failedResult(error, mode, source) {
  const evidence = source?.evidence?.() ?? {
    readCount: 0, bufferZeroed: true,
  };
  return Object.freeze(validateCloudflareStagingControlTokenStdinMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT,
    status: 'failed',
    mode,
    errorCode: safeErrorCode(error),
    durableState: mode === 'initialize' && error?.dwncDurableState === 'unknown'
      ? 'unknown' : 'none',
    inputReads: evidence.readCount,
    bufferZeroed: evidence.bufferZeroed,
    clipboardRead: false,
    clipboardCleared: false,
    rawTokenPrinted: false,
  }));
}

export async function runCloudflareStagingControlTokenStdin({
  argv = process.argv.slice(2),
  environment = process.env,
  execArgv = process.execArgv,
  root = process.cwd(),
  input = process.stdin,
  inspectInput = inspectStdinPipeInput,
  signalEmitter = process,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  loadManager = loadDefaultManager,
  source,
} = {}) {
  const mode = inferredMode(argv);
  if (mode === 'unknown') fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_ARGUMENT');
  validateRoot(root);
  validateEnvironment(environment, execArgv);
  if (typeof loadManager !== 'function') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
  }
  const selectedSource = source ?? new StdinPipeStagingControlTokenSource({
    input, inspectInput, signalEmitter, setTimeoutImpl, clearTimeoutImpl,
  });
  const signalGuard = new StagingControlTokenSignalGuard(signalEmitter);
  let managerStarted = false;
  let value = '';
  try {
    signalGuard.install();
    await signalGuard.checkpointBeforeOwnership();
    selectedSource.bindSignalPhase({
      beforeRead: () => {
        if (signalGuard.preOwnershipSignal) {
          fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL');
        }
      },
      onInputOwned: () => signalGuard.claimInputOwnership(),
    });
    selectedSource.validateChannel();
    await signalGuard.checkpointBeforeOwnership();
    if (mode === 'probe') {
      await selectedSource.preflight();
      value = await selectedSource.readOnceAndClear();
      if (value !== CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE) {
        fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_PROBE');
      }
      return probeResult(selectedSource);
    }
    const manage = await loadManager();
    if (typeof manage !== 'function') {
      fail('CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
    }
    let result;
    let managerError = null;
    try {
      managerStarted = true;
      result = await manage({
        argv: ['--mode=initialize'],
        environment,
        clipboard: selectedSource,
      });
    } catch (error) { managerError = error; }
    if (managerError !== null) throw managerError;
    return completeResult(result, selectedSource);
  } catch (error) {
    const classified = new Error(safeErrorCode(error));
    Object.defineProperty(classified, 'dwncDurableState', {
      value: managerStarted && signalGuard.inputOwned
        ? 'unknown' : 'none',
      enumerable: false,
      writable: false,
      configurable: false,
    });
    throw classified;
  } finally {
    value = '';
    await selectedSource.clear().catch(() => undefined);
    signalGuard.cleanup();
  }
}

export async function runCloudflareStagingControlTokenStdinCli({
  argv = process.argv.slice(2),
  environment = process.env,
  execArgv = process.execArgv,
  root = process.cwd(),
  input = process.stdin,
  inspectInput = inspectStdinPipeInput,
  signalEmitter = process,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  loadManager = loadDefaultManager,
  writeOutput = (serialized) => process.stdout.write(serialized),
  writeError = (serialized) => process.stderr.write(serialized),
} = {}) {
  const mode = inferredMode(argv);
  const source = new StdinPipeStagingControlTokenSource({
    input, inspectInput, signalEmitter, setTimeoutImpl, clearTimeoutImpl,
  });
  let final;
  try {
    final = await runCloudflareStagingControlTokenStdin({
      argv, environment, execArgv, root, signalEmitter, loadManager, source,
    });
  } catch (error) {
    await source.clear().catch(() => undefined);
    final = failedResult(error, mode, source);
  }
  const serialized = serializeCloudflareStagingControlTokenStdinMessage(final);
  try {
    if (final.status === 'complete') writeOutput(serialized);
    else writeError(serialized);
  } catch { /* process exit status remains authoritative */ }
  return final;
}

if (path.resolve(process.argv[1] ?? '') === MODULE_FILE) {
  const final = await runCloudflareStagingControlTokenStdinCli();
  if (final.status !== 'complete') process.exitCode = 1;
}
