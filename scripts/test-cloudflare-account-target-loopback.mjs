import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';

const nativeSpawnGuardSymbol = Symbol.for(
  'dwnc.cloudflare.account-target.native-spawn-guard.v1',
);
if (nativeSpawnGuardSymbol in globalThis) {
  throw new Error('TEST_E_ACCOUNT_TARGET_LOOPBACK_NATIVE_GUARD_EXISTS');
}
let unexpectedActualNativeSpawnCalls = 0;
globalThis[nativeSpawnGuardSymbol] = () => {
  unexpectedActualNativeSpawnCalls += 1;
  throw new Error('CLOUDFLARE_E_ACCOUNT_TEST_NATIVE_SPAWN');
};
process.once('exit', () => { delete globalThis[nativeSpawnGuardSymbol]; });

const [{
  CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
  CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_FRAME_BYTES,
  CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
  cloudflareAccountTargetLoopbackFailure,
  openCloudflareAccountTargetLoopbackBridge,
  sendCloudflareAccountTargetLoopbackPayload,
  serializeCloudflareAccountTargetLoopbackMessage,
  validateCloudflareAccountTargetLoopbackMessage,
}, {
  CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
}, {
  cloudflareAccountIdSha256,
}, {
  CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_EXECUTION_TIMEOUT_MS,
  CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_RUNTIME_ROOT,
  armCloudflareAccountTargetLoopbackWatchdog,
  assertCloudflareAccountTargetLoopbackRuntimeRoot,
  runCloudflareAccountTargetLoopback,
}] = await Promise.all([
  import('./lib/cloudflare-account-target-loopback.mjs'),
  import('./lib/cloudflare-account-target.mjs'),
  import('./lib/public-media-manifest.mjs'),
  import('./run-cloudflare-account-target-loopback.mjs'),
]);

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const ok = (value) => { assert.ok(value); assertions += 1; };
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.message === code);
  assertions += 1;
};
const throws = (action, code) => {
  assert.throws(action, (error) => error?.message === code);
  assertions += 1;
};
const zeroed = (value) => Buffer.isBuffer(value)
  && value.every((byte) => byte === 0);

const accountId = 'a'.repeat(32);
const accountIdBytes = () => Buffer.from(accountId, 'ascii');
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const policySha256 = 'b'.repeat(64);
const commit = 'c'.repeat(40);
const tree = 'd'.repeat(40);
const safeCanary = 'loopback-sensitive-canary';
const metadataOutput = '/private/tmp/dwnc-loopback-account-target.json';
const recoveryMetadataOutput = '/private/tmp/dwnc-loopback-account-target-recovery.json';
const FRAME_MAGIC = Buffer.from('DWNCATLB', 'ascii');
const FRAME_VERSION_OFFSET = 8;
const FRAME_POLICY_OFFSET = 9;
const FRAME_NONCE_OFFSET = 41;
const FRAME_ACCOUNT_OFFSET = 73;

equal(CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_FRAME_BYTES, 105);
equal(CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST, '127.0.0.1');

function makeFrame(ready, selectedAccount = accountId) {
  const frame = Buffer.alloc(CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_FRAME_BYTES);
  FRAME_MAGIC.copy(frame, 0);
  frame[FRAME_VERSION_OFFSET] = 1;
  Buffer.from(ready.policySha256, 'hex').copy(frame, FRAME_POLICY_OFFSET);
  Buffer.from(ready.nonceBase64url, 'base64url').copy(frame, FRAME_NONCE_OFFSET);
  Buffer.from(selectedAccount, 'ascii').copy(frame, FRAME_ACCOUNT_OFFSET);
  return frame;
}

async function writeChunks(port, chunks) {
  const owned = chunks.map((chunk) => Buffer.from(chunk));
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST, port });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('TEST_E_LOOPBACK_SOCKET_TIMEOUT'));
    }, 2_000);
    socket.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect', async () => {
      try {
        for (const chunk of owned) {
          await new Promise((written, failed) => {
            socket.write(chunk, (error) => error ? failed(error) : written());
          });
        }
        socket.end();
      } catch (error) {
        socket.destroy();
        reject(error);
      } finally {
        for (const chunk of owned) chunk.fill(0);
      }
    });
  });
  for (const chunk of owned) equal(zeroed(chunk), true);
}

function makeInitializerHarness({ initializeError = null, verifyResult = null } = {}) {
  const observation = {
    initializeCalls: 0,
    verifyCalls: 0,
    sourceBuffers: [],
    initializerArguments: [],
    verifyArguments: [],
  };
  const initialize = async (options) => {
    observation.initializeCalls += 1;
    observation.initializerArguments.push(options);
    if (initializeError !== null) throw new Error(initializeError);
    await options.accountIdSource.preflight();
    const raw = await options.accountIdSource.readOnce();
    observation.sourceBuffers.push(raw);
    equal(raw.toString('ascii'), accountId);
    raw.fill(0);
    await options.accountIdSource.cleanup();
    return {
      accountIdSha256: options.expectedAccountIdSha256,
      purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
    };
  };
  const verify = async (options) => {
    observation.verifyCalls += 1;
    observation.verifyArguments.push(options);
    return verifyResult ?? {
      accountIdSha256: options.expectedAccountIdSha256,
      purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
    };
  };
  return { observation, initialize, verify };
}

async function openHarness(overrides = {}) {
  const nonceSeed = overrides.nonceSeed ?? Buffer.alloc(32, 0x11);
  const harness = overrides.harness ?? makeInitializerHarness();
  let authenticated = 0;
  const bridge = await openCloudflareAccountTargetLoopbackBridge({
    metadataOutput,
    recoveryMetadataOutput,
    expectedAccountIdSha256: accountIdSha256,
    expectedPolicySha256: policySha256,
    store: overrides.store ?? Object.freeze({ kind: 'memory-store' }),
    initialize: harness.initialize,
    verify: harness.verify,
    assertBeforeInitialize: overrides.assertBeforeInitialize ?? (async () => undefined),
    onAuthenticated: () => {
      authenticated += 1;
      overrides.onAuthenticated?.();
    },
    randomBytesImpl: () => nonceSeed,
    ...(overrides.createServerImpl ? { createServerImpl: overrides.createServerImpl } : {}),
    ...(overrides.setTimeoutImpl ? { setTimeoutImpl: overrides.setTimeoutImpl } : {}),
    ...(overrides.clearTimeoutImpl ? { clearTimeoutImpl: overrides.clearTimeoutImpl } : {}),
  });
  return { bridge, harness, nonceSeed, authenticated: () => authenticated };
}

// A complete frame remains valid when TCP divides it into arbitrary chunks.
{
  const opened = await openHarness();
  const frame = makeFrame(opened.bridge.ready);
  await writeChunks(opened.bridge.ready.port, [
    frame.subarray(0, 1), frame.subarray(1, 17), frame.subarray(17, 104), frame.subarray(104),
  ]);
  const final = await opened.bridge.completion;
  frame.fill(0);
  equal(final.status, 'complete');
  equal(final.durableState, 'complete');
  equal(opened.authenticated(), 1);
  equal(opened.harness.observation.initializeCalls, 1);
  equal(opened.harness.observation.verifyCalls, 1);
  equal(opened.harness.observation.initializerArguments[0].metadataOutput, metadataOutput);
  equal(opened.harness.observation.initializerArguments[0].recoveryMetadataOutput,
    recoveryMetadataOutput);
  equal(opened.harness.observation.verifyArguments[0].metadataPath, metadataOutput);
  equal(opened.harness.observation.verifyArguments[0].recoveryMetadataPath,
    recoveryMetadataOutput);
  equal(opened.harness.observation.sourceBuffers.every(zeroed), true);
  equal(zeroed(opened.nonceSeed), true);
  equal(final.clipboardRead, false);
  equal(final.clipboardCleared, false);
  equal(JSON.stringify(final).includes(accountId), false);
  equal(JSON.stringify(final).includes(safeCanary), false);
}

async function invalidFrameScenario(mutator, expectedCode) {
  const opened = await openHarness();
  const frame = makeFrame(opened.bridge.ready);
  const selected = mutator(frame) ?? [frame];
  await writeChunks(opened.bridge.ready.port, selected);
  const final = await opened.bridge.completion;
  frame.fill(0);
  equal(final.status, 'failed');
  equal(final.errorCode, expectedCode);
  equal(final.durableState, 'none');
  equal(opened.authenticated(), 0);
  equal(opened.harness.observation.initializeCalls, 0);
  equal(opened.harness.observation.verifyCalls, 0);
  equal(zeroed(opened.nonceSeed), true);
}

await invalidFrameScenario((frame) => [frame.subarray(0, 104)], 'BRIDGE_E_PROTOCOL');
await invalidFrameScenario((frame) => [frame, Buffer.from([0])], 'BRIDGE_E_PROTOCOL');
await invalidFrameScenario((frame) => [Buffer.concat([frame, Buffer.from([0, 1])])],
  'BRIDGE_E_PROTOCOL');
await invalidFrameScenario((frame) => { frame[0] ^= 1; }, 'BRIDGE_E_PROTOCOL');
await invalidFrameScenario((frame) => { frame[FRAME_VERSION_OFFSET] = 2; },
  'BRIDGE_E_PROTOCOL');
await invalidFrameScenario((frame) => { frame[FRAME_POLICY_OFFSET] ^= 1; },
  'BRIDGE_E_PROTOCOL');
await invalidFrameScenario((frame) => { frame[FRAME_NONCE_OFFSET] ^= 1; }, 'BRIDGE_E_AUTH');
await invalidFrameScenario((frame) => { frame[FRAME_ACCOUNT_OFFSET] = 0x41; },
  'BRIDGE_E_PROTOCOL');

// Initializer and post-verification failures remain sanitized and clean the owned source.
{
  const harness = makeInitializerHarness({
    initializeError: 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS',
  });
  const opened = await openHarness({ harness });
  const frame = makeFrame(opened.bridge.ready);
  await writeChunks(opened.bridge.ready.port, [frame]);
  const final = await opened.bridge.completion;
  frame.fill(0);
  equal(final.status, 'failed');
  equal(final.errorCode, 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
  equal(final.durableState, 'unknown');
  equal(opened.authenticated(), 1);
  equal(harness.observation.initializeCalls, 1);
  equal(harness.observation.verifyCalls, 0);
  equal(zeroed(opened.nonceSeed), true);
}

{
  const harness = makeInitializerHarness({
    verifyResult: {
      accountIdSha256: 'f'.repeat(64),
      purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
    },
  });
  const opened = await openHarness({ harness });
  const frame = makeFrame(opened.bridge.ready);
  await writeChunks(opened.bridge.ready.port, [frame]);
  const final = await opened.bridge.completion;
  frame.fill(0);
  equal(final.status, 'failed');
  equal(final.errorCode, 'BRIDGE_E_POSTCONDITION');
  equal(final.durableState, 'unknown');
  equal(harness.observation.initializeCalls, 1);
  equal(harness.observation.verifyCalls, 1);
  equal(harness.observation.sourceBuffers.every(zeroed), true);
  equal(zeroed(opened.nonceSeed), true);
}

// Only the first accepted connection can use a ready nonce; concurrent and replay attempts fail.
{
  const opened = await openHarness();
  const first = createConnection({
    host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
    port: opened.bridge.ready.port,
  });
  await new Promise((resolve, reject) => {
    first.once('connect', resolve);
    first.once('error', reject);
  });
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = await new Promise((resolve) => {
    const socket = createConnection({
      host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
      port: opened.bridge.ready.port,
    });
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
    socket.once('error', () => resolve('rejected'));
  });
  equal(concurrent, 'rejected');
  const frame = makeFrame(opened.bridge.ready);
  await new Promise((resolve, reject) => {
    first.once('error', reject);
    first.once('close', resolve);
    first.end(frame, () => frame.fill(0));
  });
  const final = await opened.bridge.completion;
  equal(final.status, 'complete');
  equal(opened.harness.observation.initializeCalls, 1);
  equal(zeroed(frame), true);
  const replay = await new Promise((resolve) => {
    const socket = createConnection({
      host: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_HOST,
      port: opened.bridge.ready.port,
    });
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
    socket.once('error', () => resolve('rejected'));
  });
  equal(replay, 'rejected');
}

// The 15-second handshake timer fails closed without touching the initializer.
{
  let fireHandshake;
  const cleared = [];
  const opened = await openHarness({
    setTimeoutImpl(callback, delay) {
      equal(delay, 15_000);
      fireHandshake = callback;
      return Object.freeze({ kind: 'handshake-timer' });
    },
    clearTimeoutImpl(timer) { cleared.push(timer); },
  });
  ok(typeof fireHandshake === 'function');
  fireHandshake();
  const final = await opened.bridge.completion;
  equal(final.status, 'failed');
  equal(final.errorCode, 'BRIDGE_E_TIMEOUT');
  equal(final.durableState, 'none');
  equal(opened.harness.observation.initializeCalls, 0);
  equal(zeroed(opened.nonceSeed), true);
  ok(cleared.length >= 1);
}

// A fake socket exposes every client-owned buffer so cleanup can be asserted.
function fakeClientSocket({ responseByte = false, neverConnect = false } = {}) {
  const socket = new EventEmitter();
  socket.destroyed = false;
  socket.destroy = () => { socket.destroyed = true; };
  socket.end = (payload, callback) => {
    socket.payload = payload;
    socket.payloadSnapshot = Buffer.from(payload);
    queueMicrotask(() => {
      callback?.();
      if (responseByte) {
        socket.responseChunk = Buffer.from([0x78]);
        socket.emit('data', socket.responseChunk);
      }
      socket.emit('close');
    });
  };
  if (!neverConnect) queueMicrotask(() => socket.emit('connect'));
  return socket;
}

{
  const raw = accountIdBytes();
  const socket = fakeClientSocket();
  const sent = await sendCloudflareAccountTargetLoopbackPayload({
    port: 12345,
    nonceBase64url: Buffer.alloc(32, 0x22).toString('base64url'),
    policySha256,
    accountIdBytes: raw,
    createConnectionImpl: (options) => {
      equal(options, { host: '127.0.0.1', port: 12345 });
      return socket;
    },
  });
  equal(sent.bytes, 105);
  equal(sent.status, 'sent');
  equal(zeroed(raw), true);
  equal(socket.payloadSnapshot.subarray(0, 8).toString('ascii'), 'DWNCATLB');
  equal(socket.payloadSnapshot[8], 1);
  equal(socket.payloadSnapshot.subarray(73).toString('ascii'), accountId);
  equal(zeroed(socket.payload), true);
  socket.payloadSnapshot.fill(0);
}

{
  const raw = accountIdBytes();
  const socket = fakeClientSocket({ responseByte: true });
  await rejects(() => sendCloudflareAccountTargetLoopbackPayload({
    port: 12345,
    nonceBase64url: Buffer.alloc(32, 0x23).toString('base64url'),
    policySha256,
    accountIdBytes: raw,
    createConnectionImpl: () => socket,
  }), 'BRIDGE_E_CLIENT_PROTOCOL');
  equal(zeroed(raw), true);
  equal(zeroed(socket.payload), true);
  equal(zeroed(socket.responseChunk), true);
}

{
  const raw = accountIdBytes();
  const socket = fakeClientSocket({ neverConnect: true });
  await rejects(() => sendCloudflareAccountTargetLoopbackPayload({
    port: 12345,
    nonceBase64url: Buffer.alloc(32, 0x24).toString('base64url'),
    policySha256,
    accountIdBytes: raw,
    createConnectionImpl: () => socket,
    setTimeoutImpl(callback, delay) {
      equal(delay, 5_000);
      queueMicrotask(callback);
      return Object.freeze({ kind: 'client-timer' });
    },
    clearTimeoutImpl: () => undefined,
  }), 'BRIDGE_E_CLIENT_TIMEOUT');
  equal(socket.destroyed, true);
  equal(zeroed(raw), true);
}

{
  const invalid = Buffer.from('A'.repeat(32), 'ascii');
  await rejects(() => sendCloudflareAccountTargetLoopbackPayload({
    port: 12345,
    nonceBase64url: Buffer.alloc(32, 0x25).toString('base64url'),
    policySha256,
    accountIdBytes: invalid,
    createConnectionImpl: () => { throw new Error('TEST_E_MUST_NOT_CONNECT'); },
  }), 'BRIDGE_E_CLIENT_ARGUMENT');
  equal(zeroed(invalid), true);
}

// A fake server makes the exact inbound chunk observable after bridge cleanup.
{
  class FakeServer extends EventEmitter {
    maxConnections = 0;
    closed = false;
    listen(options, callback) { this.options = options; queueMicrotask(callback); }
    close() { this.closed = true; }
    address() { return { address: '127.0.0.1', family: 'IPv4', port: 23456 }; }
  }
  class FakeSocket extends EventEmitter {
    destroy() { this.destroyed = true; }
    end() { this.ended = true; }
  }
  const server = new FakeServer();
  const opened = await openHarness({ createServerImpl: () => server });
  const socket = new FakeSocket();
  const inbound = makeFrame(opened.bridge.ready);
  server.emit('connection', socket);
  socket.emit('data', inbound);
  socket.emit('end');
  const final = await opened.bridge.completion;
  equal(final.status, 'complete');
  equal(zeroed(inbound), true);
  equal(zeroed(opened.nonceSeed), true);
  equal(server.maxConnections, 1);
  equal(server.closed, true);
}

// Safe result schemas have no paths, raw identifiers, stacks, or arbitrary errors.
{
  const ready = validateCloudflareAccountTargetLoopbackMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
    status: 'ready',
    host: '127.0.0.1',
    port: 12345,
    nonceEncoding: 'base64url',
    nonceBase64url: Buffer.alloc(32, 0x31).toString('base64url'),
    policySha256,
    expiresInMs: 15_000,
  });
  const serialized = serializeCloudflareAccountTargetLoopbackMessage(ready);
  equal(serialized.endsWith('\n'), true);
  ok(Buffer.byteLength(serialized) <= 4096);
  equal(JSON.parse(serialized).status, 'ready');
  equal(serialized.includes(accountId), false);
  equal(serialized.includes(metadataOutput), false);
  const sanitized = cloudflareAccountTargetLoopbackFailure(
    new Error(`${safeCanary}:${metadataOutput}`), 'unknown',
  );
  equal(sanitized.errorCode, 'BRIDGE_E_CHILD');
  equal(JSON.stringify(sanitized).includes(safeCanary), false);
  equal(JSON.stringify(sanitized).includes(metadataOutput), false);
  throws(() => validateCloudflareAccountTargetLoopbackMessage({ ...ready, extra: true }),
    'BRIDGE_E_OUTPUT');
  throws(() => validateCloudflareAccountTargetLoopbackMessage({ ...ready, port: 0 }),
    'BRIDGE_E_OUTPUT');
  throws(() => serializeCloudflareAccountTargetLoopbackMessage({
    ...ready, padding: 'x'.repeat(4096),
  }), 'BRIDGE_E_OUTPUT');
  throws(() => cloudflareAccountTargetLoopbackFailure(new Error('BRIDGE_E_AUTH'), 'complete'),
    'BRIDGE_E_ARGUMENT');
}

// Processing is bounded independently after authentication and can be cancelled once.
{
  let fire;
  let timeoutDelay;
  const writes = [];
  const cleared = [];
  const cancel = armCloudflareAccountTargetLoopbackWatchdog({
    setTimeoutImpl(callback, delay) {
      fire = callback;
      timeoutDelay = delay;
      return Object.freeze({ kind: 'processing-timer' });
    },
    clearTimeoutImpl(timer) { cleared.push(timer); },
    writeFinalAndExit(message) { writes.push(message); },
  });
  equal(timeoutDelay, CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_EXECUTION_TIMEOUT_MS);
  fire();
  equal(writes.length, 1);
  equal(writes[0].errorCode, 'BRIDGE_E_EXECUTION_TIMEOUT');
  equal(writes[0].durableState, 'unknown');
  cancel();
  equal(cleared.length, 0);

  let cancelledFire;
  const cancelledWrites = [];
  const cancelBeforeFire = armCloudflareAccountTargetLoopbackWatchdog({
    setTimeoutImpl(callback) { cancelledFire = callback; return 7; },
    clearTimeoutImpl(timer) { equal(timer, 7); },
    writeFinalAndExit(message) { cancelledWrites.push(message); },
  });
  cancelBeforeFire();
  cancelledFire();
  equal(cancelledWrites.length, 0);
}

function readyMessage() {
  return validateCloudflareAccountTargetLoopbackMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
    status: 'ready',
    host: '127.0.0.1',
    port: 34567,
    nonceEncoding: 'base64url',
    nonceBase64url: Buffer.alloc(32, 0x32).toString('base64url'),
    policySha256,
    expiresInMs: 15_000,
  });
}

function completeMessage() {
  return validateCloudflareAccountTargetLoopbackMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_CONTRACT,
    status: 'complete',
    durableState: 'complete',
    accountIdSha256,
    purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
    sourceEvidence: {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-account-id-source-evidence-v1',
      kind: 'in-app-browser-visible-account-id-buffer-v1',
      preflightCount: 1,
      readCount: 1,
      ownershipTransferred: true,
      sourceRetainedBytes: 0,
      cleanupComplete: true,
      clipboardRead: false,
      clipboardCleared: false,
    },
    clipboardRead: false,
    clipboardCleared: false,
    rawPrinted: false,
  });
}

const policyBytes = Buffer.from(JSON.stringify({ staging: { marker: 'policy-only' } }), 'utf8');
const validatedPolicy = {
  staging: {
    environment: 'staging',
    bucket: 'dwnc-me-public-media-staging',
    accountIdSha256,
  },
};
const cleanSnapshot = Object.freeze({ commit, tree, clean: true });

async function runRunnerScenario({
  runtimeRoot = CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_RUNTIME_ROOT,
  snapshots = [cleanSnapshot, cleanSnapshot],
  argv = [`--expected-git-commit=${commit}`, `--expected-git-tree=${tree}`],
  invokeAuthenticated = true,
} = {}) {
  const observation = {
    gitCalls: 0,
    policyReads: 0,
    outsideCalls: [],
    openCalls: 0,
    watchdogArms: 0,
    watchdogCancels: 0,
    writes: [],
    openOptions: null,
  };
  const queue = [...snapshots];
  const result = await runCloudflareAccountTargetLoopback({
    argv,
    testOnly: {
      runtimeRoot,
      metadataOutput,
      inspectGit: async (root) => {
        equal(root, CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_RUNTIME_ROOT);
        observation.gitCalls += 1;
        return queue.shift();
      },
      readPolicyFile: async (selectedPath) => {
        observation.policyReads += 1;
        equal(selectedPath.endsWith('/src/data/public-media-release-policy-v1.json'), true);
        return Buffer.from(policyBytes);
      },
      validatePolicy: () => validatedPolicy,
      assertOutsideRepository: async (selectedPath, root) => {
        observation.outsideCalls.push({ selectedPath, root });
      },
      armWatchdog: () => {
        observation.watchdogArms += 1;
        return () => { observation.watchdogCancels += 1; };
      },
      openBridge: async (options) => {
        observation.openCalls += 1;
        observation.openOptions = options;
        let resolveCompletion;
        const completion = new Promise((resolve, reject) => {
          resolveCompletion = () => resolve(completeMessage());
          queueMicrotask(async () => {
            try {
              await options.assertBeforeInitialize();
              if (invokeAuthenticated) options.onAuthenticated();
              resolveCompletion();
            } catch (error) { reject(error); }
          });
        });
        return Object.freeze({ ready: readyMessage(), completion });
      },
      write: (serialized) => { observation.writes.push(serialized); },
    },
  });
  return { result, observation };
}

// Runner pins root, full commit and tree, checks clean state twice, then arms processing timeout.
{
  const { result, observation } = await runRunnerScenario();
  equal(result.status, 'complete');
  equal(observation.gitCalls, 2);
  equal(observation.policyReads, 1);
  equal(observation.outsideCalls.length, 2);
  equal(observation.openCalls, 1);
  equal(observation.watchdogArms, 1);
  equal(observation.watchdogCancels, 1);
  equal(observation.writes.length, 2);
  equal(observation.writes.map((value) => JSON.parse(value).status), ['ready', 'complete']);
  equal(observation.writes.every((value) => Buffer.byteLength(value) <= 4096), true);
  equal(observation.writes.join('').includes(accountId), false);
  equal(observation.writes.join('').includes(safeCanary), false);
  equal(JSON.stringify(observation.openOptions).includes(accountId), false);
  equal(observation.openOptions.expectedAccountIdSha256, accountIdSha256);
  equal(observation.openOptions.expectedPolicySha256.length, 64);
}

throws(() => assertCloudflareAccountTargetLoopbackRuntimeRoot('/private/tmp'), 'BRIDGE_E_ROOT');
await rejects(() => runRunnerScenario({ runtimeRoot: '/private/tmp' }), 'BRIDGE_E_ROOT');
await rejects(() => runRunnerScenario({
  argv: [`--expected-git-commit=${commit.slice(0, 12)}`, `--expected-git-tree=${tree}`],
}), 'BRIDGE_E_ARGUMENT');
await rejects(() => runRunnerScenario({
  snapshots: [{ commit: 'e'.repeat(40), tree, clean: true }],
}), 'BRIDGE_E_GIT');
await rejects(() => runRunnerScenario({
  snapshots: [{ commit, tree: 'e'.repeat(40), clean: true }],
}), 'BRIDGE_E_GIT');
await rejects(() => runRunnerScenario({
  snapshots: [{ commit, tree, clean: false }],
}), 'BRIDGE_E_GIT');
await rejects(() => runRunnerScenario({
  snapshots: [cleanSnapshot, { commit: 'e'.repeat(40), tree, clean: true }],
}), 'BRIDGE_E_GIT');
await rejects(() => runRunnerScenario({
  snapshots: [cleanSnapshot, { commit, tree: 'e'.repeat(40), clean: true }],
}), 'BRIDGE_E_GIT');
await rejects(() => runRunnerScenario({
  snapshots: [cleanSnapshot, { commit, tree, clean: false }],
}), 'BRIDGE_E_GIT');

// No raw account ID is placed in argv, environment, files, clipboard, or JSON output.
{
  equal(process.argv.join('\0').includes(accountId), false);
  equal(Object.values(process.env).some((value) => value?.includes(accountId)), false);
  equal(policyBytes.includes(Buffer.from(accountId, 'ascii')), false);
  const [loopbackSource, runnerSource, packageSource] = await Promise.all([
    readFile('scripts/lib/cloudflare-account-target-loopback.mjs', 'utf8'),
    readFile('scripts/run-cloudflare-account-target-loopback.mjs', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  equal(loopbackSource.includes("from 'node:fs'"), false);
  equal(loopbackSource.includes('pbpaste'), false);
  equal(loopbackSource.includes('pbcopy'), false);
  equal(runnerSource.includes('process.env'), false);
  equal(JSON.parse(packageSource).scripts['cloudflare:account-target:loopback:init'],
    'node scripts/run-cloudflare-account-target-loopback.mjs');
}

equal(unexpectedActualNativeSpawnCalls, 0);
delete globalThis[nativeSpawnGuardSymbol];

console.log(JSON.stringify({
  suite: 'cloudflare-account-target-loopback',
  assertions,
  localhostOnlyConnections: true,
  unexpectedActualNativeSpawnCalls,
  realKeychainCalls: 0,
  realClipboardCalls: 0,
  externalNetworkCalls: 0,
  rawAccountArgvWrites: 0,
  rawAccountEnvironmentWrites: 0,
  rawAccountFileWrites: 0,
  status: 'PASS',
}, null, 2));
