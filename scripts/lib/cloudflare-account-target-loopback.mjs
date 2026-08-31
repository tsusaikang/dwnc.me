import { Buffer } from 'node:buffer';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import {
  CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND,
  CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
  InAppBrowserAccountIdBufferSource,
  MacOSAccountTargetKeychainStore,
  initializeCloudflareAccountTarget,
  verifyCloudflareAccountTarget,
} from './cloudflare-account-target.mjs';

export const CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT =
  'dwnc-cloudflare-account-target-loopback-v1';
export const CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST = '127.0.0.1';

const FRAME_MAGIC = Buffer.from('DWNCATLB', 'ascii');
const FRAME_VERSION = 1;
const POLICY_SHA256_BYTES = 32;
const NONCE_BYTES = 32;
const ACCOUNT_ID_BYTES = 32;
const MAGIC_OFFSET = 0;
const VERSION_OFFSET = MAGIC_OFFSET + FRAME_MAGIC.length;
const POLICY_OFFSET = VERSION_OFFSET + 1;
const NONCE_OFFSET = POLICY_OFFSET + POLICY_SHA256_BYTES;
const ACCOUNT_OFFSET = NONCE_OFFSET + NONCE_BYTES;
const FRAME_BYTES = ACCOUNT_OFFSET + ACCOUNT_ID_BYTES;
const HANDSHAKE_TIMEOUT_MS = 15_000;
const CLIENT_TIMEOUT_MS = 5_000;
const MAX_SAFE_JSON_BYTES = 4096;
const SHA256 = /^[a-f0-9]{64}$/u;
const NONCE_BASE64URL = /^[A-Za-z0-9_-]{43}$/u;

const SAFE_ERROR_CODES = new Set([
  'BRIDGE_E_ARGUMENT',
  'BRIDGE_E_AUTH',
  'BRIDGE_E_BIND',
  'BRIDGE_E_CHILD',
  'BRIDGE_E_CLIENT_ARGUMENT',
  'BRIDGE_E_CLIENT_CONNECT',
  'BRIDGE_E_CLIENT_PROTOCOL',
  'BRIDGE_E_CLIENT_TIMEOUT',
  'BRIDGE_E_EXECUTION_TIMEOUT',
  'BRIDGE_E_GIT',
  'BRIDGE_E_IMPLEMENTATION',
  'BRIDGE_E_OUTPUT',
  'BRIDGE_E_POLICY',
  'BRIDGE_E_POSTCONDITION',
  'BRIDGE_E_PROTOCOL',
  'BRIDGE_E_RANDOM',
  'BRIDGE_E_ROOT',
  'BRIDGE_E_TIMEOUT',
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
  'CLOUDFLARE_E_SIGNING_FILE_RACE',
  'CLOUDFLARE_E_SIGNING_KEY_EXISTS',
]);

const READY_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'host', 'port', 'nonceEncoding',
  'nonceBase64url', 'policySha256', 'expiresInMs',
]);
const COMPLETE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'durableState', 'accountIdSha256',
  'purpose', 'sourceEvidence', 'clipboardRead', 'clipboardCleared', 'rawPrinted',
]);
const FAILED_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'status', 'errorCode', 'durableState',
  'clipboardRead', 'clipboardCleared', 'rawPrinted',
]);
const EVIDENCE_KEYS = Object.freeze([
  'schemaVersion', 'contract', 'kind', 'preflightCount', 'readCount',
  'ownershipTransferred', 'sourceRetainedBytes', 'cleanupComplete',
  'clipboardRead', 'clipboardCleared',
]);

function fail(code) { throw new Error(code); }
function zeroBuffer(value) { if (Buffer.isBuffer(value)) value.fill(0); }
function frozen(value) { return Object.freeze(value); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}
function isLowerHexByte(value) {
  return value >= 0x30 && value <= 0x39 || value >= 0x61 && value <= 0x66;
}
function exactAccountIdBuffer(value) {
  return Buffer.isBuffer(value) && value.length === ACCOUNT_ID_BYTES
    && value.every(isLowerHexByte);
}
function validateInjectedFunctions(values) {
  if (values.some((value) => typeof value !== 'function')) {
    fail('BRIDGE_E_IMPLEMENTATION');
  }
}
function safeErrorCode(error) {
  const code = error?.message;
  return typeof code === 'string' && code.length <= 96 && SAFE_ERROR_CODES.has(code)
    ? code : 'BRIDGE_E_CHILD';
}

function validSourceEvidence(value) {
  return exactKeys(value, EVIDENCE_KEYS)
    && value.schemaVersion === 1
    && value.contract === 'dwnc-cloudflare-account-id-source-evidence-v1'
    && value.kind === CLOUDFLARE_ACCOUNT_ID_SOURCE_KIND
    && value.preflightCount === 1 && value.readCount === 1
    && value.ownershipTransferred === true && value.sourceRetainedBytes === 0
    && value.cleanupComplete === true && value.clipboardRead === false
    && value.clipboardCleared === false;
}

export function validateCloudflareAccountTargetLoopbackMessage(value) {
  if (!value || value.schemaVersion !== 1
    || value.contract !== CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT) {
    fail('BRIDGE_E_OUTPUT');
  }
  if (value.status === 'ready') {
    if (!exactKeys(value, READY_KEYS)
      || value.host !== CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST
      || !Number.isInteger(value.port) || value.port < 1 || value.port > 65_535
      || value.nonceEncoding !== 'base64url'
      || !NONCE_BASE64URL.test(value.nonceBase64url ?? '')
      || !SHA256.test(value.policySha256 ?? '')
      || value.expiresInMs !== HANDSHAKE_TIMEOUT_MS) fail('BRIDGE_E_OUTPUT');
  } else if (value.status === 'complete') {
    if (!exactKeys(value, COMPLETE_KEYS) || value.durableState !== 'complete'
      || !SHA256.test(value.accountIdSha256 ?? '')
      || value.purpose !== CLOUDFLARE_ACCOUNT_TARGET_PURPOSE
      || !validSourceEvidence(value.sourceEvidence)
      || value.clipboardRead !== false || value.clipboardCleared !== false
      || value.rawPrinted !== false) fail('BRIDGE_E_OUTPUT');
  } else if (value.status === 'failed') {
    if (!exactKeys(value, FAILED_KEYS) || !SAFE_ERROR_CODES.has(value.errorCode)
      || !['none', 'unknown'].includes(value.durableState)
      || value.clipboardRead !== false || value.clipboardCleared !== false
      || value.rawPrinted !== false) fail('BRIDGE_E_OUTPUT');
  } else fail('BRIDGE_E_OUTPUT');
  return value;
}

export function serializeCloudflareAccountTargetLoopbackMessage(value) {
  let serialized;
  try { serialized = `${JSON.stringify(value)}\n`; }
  catch { fail('BRIDGE_E_OUTPUT'); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SAFE_JSON_BYTES) {
    fail('BRIDGE_E_OUTPUT');
  }
  validateCloudflareAccountTargetLoopbackMessage(value);
  return serialized;
}

function failedResult(error, durableState) {
  return frozen(validateCloudflareAccountTargetLoopbackMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
    status: 'failed',
    errorCode: safeErrorCode(error),
    durableState,
    clipboardRead: false,
    clipboardCleared: false,
    rawPrinted: false,
  }));
}

export async function openCloudflareAccountTargetLoopbackBridge({
  metadataOutput,
  recoveryMetadataOutput,
  expectedAccountIdSha256,
  expectedPolicySha256,
  store,
  initialize = initializeCloudflareAccountTarget,
  verify = verifyCloudflareAccountTarget,
  assertBeforeInitialize = async () => undefined,
  onAuthenticated = () => undefined,
  randomBytesImpl = randomBytes,
  createServerImpl = createServer,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  if (typeof metadataOutput !== 'string' || typeof recoveryMetadataOutput !== 'string'
    || !SHA256.test(expectedAccountIdSha256 ?? '')
    || !SHA256.test(expectedPolicySha256 ?? '')) fail('BRIDGE_E_ARGUMENT');
  validateInjectedFunctions([
    initialize, verify, assertBeforeInitialize, onAuthenticated, randomBytesImpl,
    createServerImpl, setTimeoutImpl, clearTimeoutImpl,
  ]);

  let policySha256Bytes;
  let nonce;
  let receiveBuffer;
  let server;
  let acceptedSocket;
  let handshakeTimer;
  let accepted = false;
  let settled = false;
  let initializationStarted = false;
  let resolveCompletion;
  const completion = new Promise((resolve) => { resolveCompletion = resolve; });

  const settle = (result) => {
    if (settled) return;
    settled = true;
    try { clearTimeoutImpl(handshakeTimer); } catch { /* cleanup only */ }
    try { acceptedSocket?.destroy(); } catch { /* cleanup only */ }
    try { server?.close(); } catch { /* cleanup only */ }
    zeroBuffer(policySha256Bytes);
    zeroBuffer(nonce);
    zeroBuffer(receiveBuffer);
    policySha256Bytes = null;
    nonce = null;
    receiveBuffer = null;
    resolveCompletion(result);
  };
  const failBridge = (error) => settle(failedResult(
    error, initializationStarted ? 'unknown' : 'none',
  ));

  try {
    policySha256Bytes = Buffer.from(expectedPolicySha256, 'hex');
    if (policySha256Bytes.length !== POLICY_SHA256_BYTES) fail('BRIDGE_E_POLICY');
    nonce = randomBytesImpl(NONCE_BYTES);
    if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES) fail('BRIDGE_E_RANDOM');
    receiveBuffer = Buffer.alloc(FRAME_BYTES);
    server = createServerImpl();
    if (!server || typeof server.listen !== 'function' || typeof server.on !== 'function'
      || typeof server.once !== 'function' || typeof server.close !== 'function') {
      fail('BRIDGE_E_IMPLEMENTATION');
    }
    server.maxConnections = 1;

    server.on('connection', (socket) => {
      if (accepted || settled) {
        try { socket.destroy(); } catch { /* reject extra connection */ }
        return;
      }
      accepted = true;
      acceptedSocket = socket;
      try { server.close(); } catch { /* listener already closed */ }
      let receivedBytes = 0;
      let socketFinished = false;

      const finishSocket = () => {
        if (socketFinished) return;
        socketFinished = true;
        try { socket.end(); } catch { try { socket.destroy(); } catch {} }
      };
      socket.on('data', (chunk) => {
        const owned = Buffer.isBuffer(chunk)
          ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        try {
          if (settled || receivedBytes > FRAME_BYTES - owned.length) {
            failBridge(new Error('BRIDGE_E_PROTOCOL'));
            finishSocket();
            return;
          }
          owned.copy(receiveBuffer, receivedBytes);
          receivedBytes += owned.length;
        } finally { zeroBuffer(owned); }
      });
      socket.on('error', () => {
        failBridge(new Error('BRIDGE_E_PROTOCOL'));
        finishSocket();
      });
      socket.on('end', async () => {
        if (settled) { finishSocket(); return; }
        if (receivedBytes !== FRAME_BYTES
          || !timingSafeEqual(
            receiveBuffer.subarray(MAGIC_OFFSET, VERSION_OFFSET), FRAME_MAGIC,
          )
          || receiveBuffer[VERSION_OFFSET] !== FRAME_VERSION
          || !timingSafeEqual(
            receiveBuffer.subarray(POLICY_OFFSET, NONCE_OFFSET), policySha256Bytes,
          )) {
          failBridge(new Error('BRIDGE_E_PROTOCOL'));
          finishSocket();
          return;
        }
        if (!timingSafeEqual(
          receiveBuffer.subarray(NONCE_OFFSET, ACCOUNT_OFFSET), nonce,
        )) {
          failBridge(new Error('BRIDGE_E_AUTH'));
          finishSocket();
          return;
        }
        let accountIdBytes;
        let source;
        let result;
        try {
          try { clearTimeoutImpl(handshakeTimer); } catch { /* cleanup only */ }
          accountIdBytes = Buffer.from(receiveBuffer.subarray(ACCOUNT_OFFSET));
          if (!exactAccountIdBuffer(accountIdBytes)) fail('BRIDGE_E_PROTOCOL');
          zeroBuffer(receiveBuffer);
          zeroBuffer(policySha256Bytes);
          zeroBuffer(nonce);
          receiveBuffer = null;
          policySha256Bytes = null;
          nonce = null;
          finishSocket();
          onAuthenticated();
          source = new InAppBrowserAccountIdBufferSource(accountIdBytes);
          accountIdBytes = null;
          await assertBeforeInitialize();
          const selectedStore = store === undefined
            ? new MacOSAccountTargetKeychainStore() : store;
          initializationStarted = true;
          const metadata = await initialize({
            metadataOutput,
            recoveryMetadataOutput,
            expectedAccountIdSha256,
            accountIdSource: source,
            store: selectedStore,
          });
          const sourceEvidence = source.evidence();
          const verified = await verify({
            metadataPath: metadataOutput,
            recoveryMetadataPath: recoveryMetadataOutput,
            expectedAccountIdSha256,
            store: selectedStore,
          });
          if (metadata?.accountIdSha256 !== expectedAccountIdSha256
            || metadata?.purpose !== CLOUDFLARE_ACCOUNT_TARGET_PURPOSE
            || verified?.accountIdSha256 !== expectedAccountIdSha256
            || verified?.purpose !== CLOUDFLARE_ACCOUNT_TARGET_PURPOSE
            || !validSourceEvidence(sourceEvidence)) fail('BRIDGE_E_POSTCONDITION');
          result = frozen(validateCloudflareAccountTargetLoopbackMessage({
            schemaVersion: 1,
            contract: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
            status: 'complete',
            durableState: 'complete',
            accountIdSha256: expectedAccountIdSha256,
            purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
            sourceEvidence,
            clipboardRead: false,
            clipboardCleared: false,
            rawPrinted: false,
          }));
        } catch (error) {
          result = failedResult(error, initializationStarted ? 'unknown' : 'none');
        } finally {
          zeroBuffer(accountIdBytes);
          await source?.cleanup().catch(() => undefined);
        }
        settle(result);
      });
    });

    await new Promise((resolve, reject) => {
      const onError = () => reject(new Error('BRIDGE_E_BIND'));
      server.once('error', onError);
      server.listen({
        host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
        port: 0,
        exclusive: true,
      }, () => {
        server.removeListener('error', onError);
        server.on('error', () => failBridge(new Error('BRIDGE_E_BIND')));
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address !== 'object'
      || address.address !== CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST
      || address.family !== 'IPv4' || !Number.isInteger(address.port)
      || address.port < 1 || address.port > 65_535) fail('BRIDGE_E_BIND');
    handshakeTimer = setTimeoutImpl(
      () => failBridge(new Error('BRIDGE_E_TIMEOUT')), HANDSHAKE_TIMEOUT_MS,
    );
    const ready = frozen(validateCloudflareAccountTargetLoopbackMessage({
      schemaVersion: 1,
      contract: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
      status: 'ready',
      host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
      port: address.port,
      nonceEncoding: 'base64url',
      nonceBase64url: nonce.toString('base64url'),
      policySha256: expectedPolicySha256,
      expiresInMs: HANDSHAKE_TIMEOUT_MS,
    }));
    return frozen({ ready, completion });
  } catch (error) {
    try { server?.close(); } catch { /* cleanup only */ }
    zeroBuffer(policySha256Bytes);
    zeroBuffer(nonce);
    zeroBuffer(receiveBuffer);
    throw new Error(safeErrorCode(error));
  }
}

export async function sendCloudflareAccountTargetLoopbackPayload({
  port,
  nonceBase64url,
  policySha256,
  accountIdBytes,
  createConnectionImpl = createConnection,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  let policySha256Bytes;
  let nonce;
  let payload;
  let socket;
  let timer;
  try {
    validateInjectedFunctions([createConnectionImpl, setTimeoutImpl, clearTimeoutImpl]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535
      || !NONCE_BASE64URL.test(nonceBase64url ?? '')
      || !SHA256.test(policySha256 ?? '') || !exactAccountIdBuffer(accountIdBytes)) {
      fail('BRIDGE_E_CLIENT_ARGUMENT');
    }
    policySha256Bytes = Buffer.from(policySha256, 'hex');
    nonce = Buffer.from(nonceBase64url, 'base64url');
    if (policySha256Bytes.length !== POLICY_SHA256_BYTES || nonce.length !== NONCE_BYTES
      || nonce.toString('base64url') !== nonceBase64url) fail('BRIDGE_E_CLIENT_ARGUMENT');
    payload = Buffer.alloc(FRAME_BYTES);
    FRAME_MAGIC.copy(payload, MAGIC_OFFSET);
    payload[VERSION_OFFSET] = FRAME_VERSION;
    policySha256Bytes.copy(payload, POLICY_OFFSET);
    nonce.copy(payload, NONCE_OFFSET);
    accountIdBytes.copy(payload, ACCOUNT_OFFSET);
    zeroBuffer(accountIdBytes);

    await new Promise((resolve, reject) => {
      let settled = false;
      let connected = false;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        try { clearTimeoutImpl(timer); } catch { /* cleanup only */ }
        zeroBuffer(payload);
        if (error === null && connected) resolve();
        else reject(new Error(error ?? 'BRIDGE_E_CLIENT_PROTOCOL'));
      };
      try {
        socket = createConnectionImpl({
          host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
          port,
        });
      } catch { finish('BRIDGE_E_CLIENT_CONNECT'); return; }
      if (!socket || typeof socket.once !== 'function' || typeof socket.on !== 'function'
        || typeof socket.end !== 'function' || typeof socket.destroy !== 'function') {
        finish('BRIDGE_E_CLIENT_CONNECT');
        return;
      }
      socket.on('data', (chunk) => {
        const owned = Buffer.isBuffer(chunk)
          ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        zeroBuffer(owned);
        try { socket.destroy(); } catch { /* cleanup only */ }
        finish('BRIDGE_E_CLIENT_PROTOCOL');
      });
      socket.once('connect', () => {
        connected = true;
        try { socket.end(payload, () => zeroBuffer(payload)); }
        catch { finish('BRIDGE_E_CLIENT_CONNECT'); }
      });
      socket.once('error', () => finish('BRIDGE_E_CLIENT_CONNECT'));
      socket.once('close', () => finish());
      timer = setTimeoutImpl(() => {
        try { socket.destroy(); } catch { /* cleanup only */ }
        finish('BRIDGE_E_CLIENT_TIMEOUT');
      }, CLIENT_TIMEOUT_MS);
    });
    return frozen({
      schemaVersion: 1,
      contract: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
      status: 'sent',
      host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
      port,
      bytes: FRAME_BYTES,
      rawPrinted: false,
    });
  } finally {
    zeroBuffer(accountIdBytes);
    zeroBuffer(policySha256Bytes);
    zeroBuffer(nonce);
    zeroBuffer(payload);
    try { socket?.destroy(); } catch { /* cleanup only */ }
  }
}

export function cloudflareAccountTargetLoopbackFailure(error, durableState = 'none') {
  if (!['none', 'unknown'].includes(durableState)) fail('BRIDGE_E_ARGUMENT');
  return failedResult(error, durableState);
}

export const CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_FRAME_BYTES = FRAME_BYTES;
