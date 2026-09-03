import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

const nativeSpawnGuardSymbol = Symbol.for(
  'dwnc.cloudflare.account-target.native-spawn-guard.v1',
);
if (nativeSpawnGuardSymbol in globalThis) {
  throw new Error('TEST_E_ACCOUNT_TARGET_STDIN_NATIVE_GUARD_EXISTS');
}
let unexpectedActualNativeSpawnCalls = 0;
globalThis[nativeSpawnGuardSymbol] = () => {
  unexpectedActualNativeSpawnCalls += 1;
  throw new Error('CLOUDFLARE_E_ACCOUNT_TEST_NATIVE_SPAWN');
};
process.once('exit', () => { delete globalThis[nativeSpawnGuardSymbol]; });

const [{
  CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT,
  CLOUDFLARE_ACCOUNT_TARGET_STDIN_MAX_BYTES,
  CLOUDFLARE_ACCOUNT_TARGET_STDIN_RUNTIME_ROOT,
  CLOUDFLARE_ACCOUNT_TARGET_STDIN_TIMEOUT_MS,
  assertCloudflareAccountTargetStdinRuntimeRoot,
  readCloudflareAccountTargetStdinLine,
  runCloudflareAccountTargetStdin,
  serializeCloudflareAccountTargetStdinMessage,
  validateCloudflareAccountTargetStdinMessage,
}, {
  CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
}, {
  cloudflareAccountIdSha256,
}] = await Promise.all([
  import('./run-cloudflare-account-target-stdin.mjs'),
  import('./lib/cloudflare-account-target.mjs'),
  import('./lib/public-media-manifest.mjs'),
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
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const commit = 'c'.repeat(40);
const tree = 'd'.repeat(40);
const cleanSnapshot = Object.freeze({ commit, tree, clean: true });
const metadataOutput = '/private/tmp/dwnc-stdin-account-target.json';
const recoveryMetadataOutput = '/private/tmp/dwnc-stdin-account-target-recovery.json';
const policyBytes = Buffer.from(JSON.stringify({ staging: { marker: 'policy-only' } }));
const validatedPolicy = Object.freeze({
  staging: Object.freeze({
    environment: 'staging',
    bucket: 'dwnc-me-public-media-staging',
    accountIdSha256,
  }),
});

equal(CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT,
  'dwnc-cloudflare-account-target-stdin-v1');
equal(CLOUDFLARE_ACCOUNT_TARGET_STDIN_MAX_BYTES, 33);
equal(CLOUDFLARE_ACCOUNT_TARGET_STDIN_TIMEOUT_MS, 60_000);

class FakeTTY extends EventEmitter {
  constructor(chunks = [], {
    isTTY = true,
    endAfterChunks = false,
    rawEnableError = false,
    rawRestoreError = false,
  } = {}) {
    super();
    this.isTTY = isTTY;
    this.chunks = chunks.map((value) => Buffer.from(value));
    this.endAfterChunks = endAfterChunks;
    this.rawEnableError = rawEnableError;
    this.rawRestoreError = rawRestoreError;
    this.rawModeCalls = [];
    this.paused = false;
  }
  setRawMode(value) {
    this.rawModeCalls.push(value);
    if (value && this.rawEnableError) throw new Error('TEST_E_RAW_ENABLE');
    if (!value && this.rawRestoreError) throw new Error('TEST_E_RAW_RESTORE');
  }
  resume() {
    this.paused = false;
    queueMicrotask(() => {
      for (const chunk of this.chunks) {
        if (this.paused) break;
        this.emit('data', chunk);
      }
      if (!this.paused && this.endAfterChunks) this.emit('end');
    });
  }
  pause() { this.paused = true; }
}

function readyMessage() {
  return {
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT,
    status: 'ready',
    input: 'non-echo-tty-line',
    maxBytes: 33,
    expiresInMs: 60_000,
    echoDisabled: true,
    clipboardRead: false,
    clipboardCleared: false,
    rawPrinted: false,
  };
}

{
  const input = new FakeTTY([
    accountId.slice(0, 7), accountId.slice(7), '\r',
  ]);
  let readyWrites = 0;
  const returned = await readCloudflareAccountTargetStdinLine({
    input,
    writeReady() { readyWrites += 1; },
  });
  equal(returned.toString('ascii'), accountId);
  returned.fill(0);
  equal(readyWrites, 1);
  equal(input.rawModeCalls, [true, false]);
  equal(input.chunks.every(zeroed), true);
}

{
  const input = new FakeTTY([`${accountId}\n`]);
  const returned = await readCloudflareAccountTargetStdinLine({ input, writeReady() {} });
  equal(returned.length, 32);
  returned.fill(0);
  equal(input.rawModeCalls, [true, false]);
}

for (const chunks of [
  [`${'A'.repeat(32)}\r`],
  [`${'a'.repeat(31)}\r`],
  [`${'a'.repeat(33)}\r`],
  [`${accountId}\rtrailing`],
]) {
  const input = new FakeTTY(chunks);
  await rejects(() => readCloudflareAccountTargetStdinLine({
    input, writeReady() {},
  }), 'ACCOUNT_STDIN_E_INPUT');
  equal(input.rawModeCalls, [true, false]);
  equal(input.chunks.every(zeroed), true);
}

await rejects(() => readCloudflareAccountTargetStdinLine({
  input: new FakeTTY([], { isTTY: false }), writeReady() {},
}), 'ACCOUNT_STDIN_E_TTY');
await rejects(() => readCloudflareAccountTargetStdinLine({
  input: new FakeTTY([], { rawEnableError: true }), writeReady() {},
}), 'ACCOUNT_STDIN_E_TTY');
{
  const input = new FakeTTY([], { endAfterChunks: true });
  await rejects(() => readCloudflareAccountTargetStdinLine({
    input, writeReady() {},
  }), 'ACCOUNT_STDIN_E_INPUT');
  equal(input.rawModeCalls, [true, false]);
}
{
  const input = new FakeTTY([]);
  await rejects(() => readCloudflareAccountTargetStdinLine({
    input,
    writeReady() { throw new Error('TEST_E_READY_WRITE'); },
  }), 'ACCOUNT_STDIN_E_INPUT');
  equal(input.rawModeCalls, [true, false]);
}
{
  const input = new FakeTTY([`${accountId}\r`], { rawRestoreError: true });
  await rejects(() => readCloudflareAccountTargetStdinLine({
    input, writeReady() {},
  }), 'ACCOUNT_STDIN_E_ECHO_RESTORE');
  equal(input.chunks.every(zeroed), true);
}

{
  const input = new FakeTTY([]);
  const signals = new EventEmitter();
  let fireTimeout;
  const cleared = [];
  const pending = readCloudflareAccountTargetStdinLine({
    input,
    signalEmitter: signals,
    setTimeoutImpl(callback, delay) {
      equal(delay, 60_000);
      fireTimeout = callback;
      return 17;
    },
    clearTimeoutImpl(timer) { cleared.push(timer); },
    writeReady() {},
  });
  fireTimeout();
  await rejects(() => pending, 'ACCOUNT_STDIN_E_INPUT_TIMEOUT');
  equal(input.rawModeCalls, [true, false]);
  equal(cleared, [17]);
  equal(signals.listenerCount('SIGTERM'), 0);
  equal(signals.listenerCount('SIGHUP'), 0);
  equal(signals.listenerCount('exit'), 0);
}

for (const selectedSignal of ['SIGTERM', 'SIGHUP']) {
  const input = new FakeTTY([]);
  const signals = new EventEmitter();
  const pending = readCloudflareAccountTargetStdinLine({
    input, signalEmitter: signals, writeReady() {},
  });
  signals.emit(selectedSignal);
  await rejects(() => pending, 'ACCOUNT_STDIN_E_SIGNAL');
  equal(input.rawModeCalls, [true, false]);
  equal(signals.listenerCount(selectedSignal), 0);
}

{
  const input = new FakeTTY([]);
  const signals = new EventEmitter();
  const pending = readCloudflareAccountTargetStdinLine({
    input, signalEmitter: signals, writeReady() {},
  });
  signals.emit('exit');
  equal(input.rawModeCalls, [true, false]);
  signals.emit('SIGTERM');
  await rejects(() => pending, 'ACCOUNT_STDIN_E_SIGNAL');
  equal(input.rawModeCalls, [true, false]);
}

async function runHarness({
  input = new FakeTTY([accountId, '\r']),
  snapshot = cleanSnapshot,
  snapshots,
  initializeError = null,
  initializeReadsSource = true,
  argv = [`--expected-git-commit=${commit}`, `--expected-git-tree=${tree}`],
} = {}) {
  const observation = {
    order: [],
    outsidePaths: [],
    initializeCalls: 0,
    source: null,
    sourceBuffers: [],
    writes: [],
  };
  const snapshotQueue = [...(snapshots ?? [snapshot, snapshot])];
  const result = await runCloudflareAccountTargetStdin({
    argv,
    testOnly: {
      runtimeRoot: CLOUDFLARE_ACCOUNT_TARGET_STDIN_RUNTIME_ROOT,
      metadataOutput,
      input,
      inspectGit: async () => {
        observation.order.push('git');
        return snapshotQueue.shift();
      },
      readPolicyFile: async () => Buffer.from(policyBytes),
      validatePolicy: () => validatedPolicy,
      assertOutsideRepository: async (selectedPath) => {
        observation.outsidePaths.push(selectedPath);
      },
      initialize: async (options) => {
        observation.order.push('initialize');
        observation.initializeCalls += 1;
        observation.source = options.accountIdSource;
        equal(options.metadataOutput, metadataOutput);
        equal(options.recoveryMetadataOutput, recoveryMetadataOutput);
        equal(options.expectedAccountIdSha256, accountIdSha256);
        if (initializeError !== null) throw new Error(initializeError);
        if (initializeReadsSource) {
          await options.accountIdSource.preflight();
          const bytes = await options.accountIdSource.readOnce();
          observation.sourceBuffers.push(bytes);
          equal(bytes.toString('ascii'), accountId);
          bytes.fill(0);
        }
        await options.accountIdSource.cleanup();
        return {
          purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
          accountIdSha256,
        };
      },
      write: (serialized) => {
        observation.order.push(`write:${JSON.parse(serialized).status}`);
        observation.writes.push(serialized);
      },
    },
  });
  return { result, observation, input };
}

{
  const { result, observation, input } = await runHarness();
  equal(result.status, 'complete');
  equal(result.durableState, 'complete');
  equal(result.echoRestored, true);
  equal(observation.order, [
    'git', 'write:ready', 'git', 'initialize', 'write:complete',
  ]);
  equal(observation.outsidePaths, [metadataOutput, recoveryMetadataOutput]);
  equal(observation.initializeCalls, 1);
  equal(observation.sourceBuffers.every(zeroed), true);
  equal(observation.source.evidence().cleanupComplete, true);
  equal(input.rawModeCalls, [true, false]);
  equal(input.chunks.every(zeroed), true);
  equal(observation.writes.every((value) => !value.includes(accountId)), true);
  equal(observation.writes.every((value) => JSON.parse(value).rawPrinted === false), true);
}

{
  const input = new FakeTTY([accountId, '\r']);
  const { result, observation } = await runHarness({
    input,
    snapshots: [cleanSnapshot, { commit, tree: 'e'.repeat(40), clean: true }],
  });
  equal(result.status, 'failed');
  equal(result.errorCode, 'ACCOUNT_STDIN_E_GIT');
  equal(result.durableState, 'none');
  equal(observation.order, ['git', 'write:ready', 'git', 'write:failed']);
  equal(observation.initializeCalls, 0);
  equal(input.chunks.every(zeroed), true);
}

{
  const { result, observation } = await runHarness({
    snapshot: { commit: 'e'.repeat(40), tree, clean: true },
  });
  equal(result.status, 'failed');
  equal(result.errorCode, 'ACCOUNT_STDIN_E_GIT');
  equal(result.durableState, 'none');
  equal(observation.initializeCalls, 0);
  equal(observation.writes.map((value) => JSON.parse(value).status), ['failed']);
}

{
  const { result, observation, input } = await runHarness({
    input: new FakeTTY(['b'.repeat(31), '\r']),
  });
  equal(result.status, 'failed');
  equal(result.errorCode, 'ACCOUNT_STDIN_E_INPUT');
  equal(result.durableState, 'none');
  equal(result.echoRestored, true);
  equal(observation.initializeCalls, 0);
  equal(observation.writes.map((value) => JSON.parse(value).status), ['ready', 'failed']);
  equal(input.chunks.every(zeroed), true);
}

{
  const safeFailure = 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS';
  const { result, observation } = await runHarness({ initializeError: safeFailure });
  equal(result.status, 'failed');
  equal(result.errorCode, safeFailure);
  equal(result.durableState, 'unknown');
  equal(observation.source.evidence().cleanupComplete, true);
  equal(observation.writes.join('').includes(accountId), false);
}

{
  const { result, observation } = await runHarness({
    initializeError: `unexpected-${accountId}`,
  });
  equal(result.errorCode, 'ACCOUNT_STDIN_E_CHILD');
  equal(observation.writes.join('').includes(accountId), false);
}

{
  const arbitrarySuffix = `CLOUDFLARE_E_ACCOUNT_STORE_${accountId.toUpperCase()}`;
  const { result, observation } = await runHarness({ initializeError: arbitrarySuffix });
  equal(result.errorCode, 'ACCOUNT_STDIN_E_CHILD');
  equal(observation.writes.join('').includes(arbitrarySuffix), false);
}

throws(() => assertCloudflareAccountTargetStdinRuntimeRoot('/private/tmp'),
  'ACCOUNT_STDIN_E_ROOT');
await rejects(() => runCloudflareAccountTargetStdin({
  argv: [`--expected-git-commit=${commit.slice(0, 12)}`, `--expected-git-tree=${tree}`],
  testOnly: {},
}), 'ACCOUNT_STDIN_E_ARGUMENT');

{
  const ready = validateCloudflareAccountTargetStdinMessage(readyMessage());
  const serialized = serializeCloudflareAccountTargetStdinMessage(ready);
  equal(JSON.parse(serialized).status, 'ready');
  equal(Buffer.byteLength(serialized) <= 1024, true);
  throws(() => validateCloudflareAccountTargetStdinMessage({ ...ready, extra: true }),
    'ACCOUNT_STDIN_E_OUTPUT');
  throws(() => validateCloudflareAccountTargetStdinMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_ACCOUNT_TARGET_STDIN_CONTRACT,
    status: 'failed',
    errorCode: 'CLOUDFLARE_E_ACCOUNT_STORE_ARBITRARY_SUFFIX',
    durableState: 'unknown',
    echoRestored: true,
    clipboardRead: false,
    clipboardCleared: false,
    rawPrinted: false,
  }), 'ACCOUNT_STDIN_E_OUTPUT');
}

{
  const [runnerSource, packageSource, testsSource] = await Promise.all([
    readFile('scripts/run-cloudflare-account-target-stdin.mjs', 'utf8'),
    readFile('package.json', 'utf8'),
    readFile('scripts/run-cloudflare-tests.mjs', 'utf8'),
  ]);
  equal(runnerSource.includes('/usr/bin/pbpaste'), false);
  equal(runnerSource.includes('/usr/bin/pbcopy'), false);
  equal(runnerSource.includes('process.env'), false);
  equal(runnerSource.includes('CLOUDFLARE_ACCOUNT_ID'), false);
  equal(JSON.parse(packageSource).scripts['cloudflare:account-target:stdin:init'],
    'node scripts/run-cloudflare-account-target-stdin.mjs');
  equal(testsSource.includes("'test-cloudflare-account-target-stdin.mjs'"), true);
  equal(process.argv.join('\0').includes(accountId), false);
  equal(Object.values(process.env).some((value) => value?.includes(accountId)), false);
}

equal(unexpectedActualNativeSpawnCalls, 0);
delete globalThis[nativeSpawnGuardSymbol];

console.log(JSON.stringify({
  suite: 'cloudflare-account-target-stdin',
  assertions,
  realKeychainCalls: 0,
  realClipboardCalls: 0,
  externalNetworkCalls: 0,
  rawAccountArgvWrites: 0,
  rawAccountEnvironmentWrites: 0,
  rawAccountFileWrites: 0,
  status: 'PASS',
}, null, 2));
