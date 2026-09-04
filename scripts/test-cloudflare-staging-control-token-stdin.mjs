import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { initializeCloudflareStagingControlToken }
  from './lib/cloudflare-staging-control-token.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';
import {
  StdinPipeStagingControlTokenSource,
  CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES,
  CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT,
  CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_MAX_BYTES,
  CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE,
  CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_TIMEOUT_MS,
  runCloudflareStagingControlTokenStdin,
  runCloudflareStagingControlTokenStdinCli,
  serializeCloudflareStagingControlTokenStdinMessage,
  validateCloudflareStagingControlTokenStdinMessage,
} from './run-cloudflare-staging-control-token-stdin.mjs';

const SAFE_ENVIRONMENT = Object.freeze({
  HOME: '/private/tmp/dwnc-probe-home',
  USER: 'dwnc-probe',
  LOGNAME: 'dwnc-probe',
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'C',
  LC_ALL: 'C',
  __CF_USER_TEXT_ENCODING: '0x0:0x0:0x0',
});
const SYNTHETIC_ACCOUNT_ID = 'a'.repeat(32);
const SYNTHETIC_ACCOUNT_SHA256 = cloudflareAccountIdSha256(SYNTHETIC_ACCOUNT_ID);
const SYNTHETIC_NOW = new Date('2026-09-04T01:00:00.000Z');
const SYNTHETIC_METADATA_PATH = '/private/tmp/dwnc-stdin-test/control-token.json';

function apiResponse(result) {
  const body = JSON.stringify({ success: true, errors: [], messages: [], result });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
    },
  });
}

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = async (action, code) => {
  await assert.rejects(async () => action(), (error) => error?.message === code);
  assertions += 1;
};
const zeroed = (value) => Buffer.isBuffer(value) && value.every((byte) => byte === 0);

class FakePipe extends EventEmitter {
  constructor(chunks = [], {
    isTTY = false,
    endAfterChunks = true,
    errorAfterChunks = false,
    delayed = false,
    pipeKind = 'fifo',
  } = {}) {
    super();
    this.isTTY = isTTY;
    this.chunks = chunks.map((value) => Buffer.from(value));
    this.endAfterChunks = endAfterChunks;
    this.errorAfterChunks = errorAfterChunks;
    this.delayed = delayed;
    this.pipeKind = pipeKind;
    this.paused = false;
  }

  resume() {
    this.paused = false;
    const emitNext = (index) => {
      if (this.paused) return;
      if (index < this.chunks.length) {
        this.emit('data', this.chunks[index]);
        if (this.delayed) queueMicrotask(() => emitNext(index + 1));
        else emitNext(index + 1);
        return;
      }
      if (this.errorAfterChunks) this.emit('error', new Error('TEST_E_PIPE'));
      else if (this.endAfterChunks) this.emit('end');
    };
    queueMicrotask(() => emitNext(0));
  }

  pause() { this.paused = true; }
}

class ThrowingListenerPipe extends FakePipe {
  constructor(chunks, eventToThrow) {
    super(chunks, { endAfterChunks: false });
    this.eventToThrow = eventToThrow;
    this.thrown = false;
  }

  on(event, listener) {
    const result = super.on(event, listener);
    if (!this.thrown && event === this.eventToThrow) {
      this.thrown = true;
      throw new Error('TEST_E_LISTENER_REGISTRATION');
    }
    return result;
  }
}

const inspectFakePipe = (input) => input.pipeKind;
const createSource = (input, signalEmitter = new EventEmitter(), extra = {}) =>
  new StdinPipeStagingControlTokenSource({
    input, inspectInput: inspectFakePipe, signalEmitter, ...extra,
  });

function assertListenersCleared(input, signals) {
  for (const event of ['data', 'error', 'end', 'close']) equal(input.listenerCount(event), 0);
  for (const event of ['SIGTERM', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGUSR1', 'exit']) {
    equal(signals.listenerCount(event), 0);
  }
}

equal(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT,
  'dwnc-cloudflare-staging-control-token-stdin-v1');
equal(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_BYTES, 53);
equal(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_MAX_BYTES, 54);
equal(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_TIMEOUT_MS, 60_000);
equal(Buffer.byteLength(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE), 53);

for (const chunks of [
  [CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE],
  [CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE.slice(0, 5),
    CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE.slice(5, 29),
    CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE.slice(29)],
]) {
  const input = new FakePipe(chunks, { delayed: chunks.length > 1 });
  const signals = new EventEmitter();
  const source = createSource(input, signals);
  source.validateChannel();
  await source.preflight();
  let value = await source.readOnceAndClear();
  equal(value, CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
  value = '';
  equal(source.evidence().preflightCount, 1);
  equal(source.evidence().readCount, 1);
  equal(source.evidence().bufferZeroed, true);
  equal(source.evidence().clipboardRead, false);
  equal(source.evidence().clipboardCleared, false);
  equal(input.chunks.every(zeroed), true);
  assertListenersCleared(input, signals);
  await rejects(() => source.readOnceAndClear(),
    'CLOUDFLARE_E_STAGING_CONTROL_STDIN_SOURCE_REUSED');
}

for (const chunks of [
  [CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE.slice(0, -1)],
  [`${CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE}X`],
  [`${CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE}\n`],
  [`${CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE}\r`],
  [`${CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE.slice(0, 20)}\n${'X'.repeat(32)}`],
]) {
  const input = new FakePipe(chunks);
  const signals = new EventEmitter();
  const source = createSource(input, signals);
  source.validateChannel();
  await source.preflight();
  await rejects(() => source.readOnceAndClear(),
    'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  equal(source.evidence().readCount, 1);
  equal(source.evidence().bufferZeroed, true);
  equal(input.chunks.every(zeroed), true);
  assertListenersCleared(input, signals);
}

{
  const input = new FakePipe([], { endAfterChunks: false });
  const signals = new EventEmitter();
  let fireTimeout;
  const cleared = [];
  const source = createSource(input, signals, {
    setTimeoutImpl(callback, delay) {
      equal(delay, 60_000);
      fireTimeout = callback;
      return 17;
    },
    clearTimeoutImpl(timer) { cleared.push(timer); },
  });
  source.validateChannel();
  await source.preflight();
  const pending = source.readOnceAndClear();
  fireTimeout();
  await rejects(() => pending, 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_TIMEOUT');
  equal(cleared, [17]);
  equal(source.evidence().bufferZeroed, true);
  assertListenersCleared(input, signals);
}

{
  const input = new FakePipe([], { errorAfterChunks: true });
  const signals = new EventEmitter();
  const source = createSource(input, signals);
  source.validateChannel();
  await source.preflight();
  await rejects(() => source.readOnceAndClear(),
    'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  assertListenersCleared(input, signals);
}

{
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  const signals = new EventEmitter();
  const source = createSource(input, signals);
  source.validateChannel();
  await source.preflight();
  await source.clear();
  equal(source.evidence().readCount, 0);
  equal(input.chunks[0].toString('ascii'), CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
  assertListenersCleared(input, signals);
  input.chunks[0].fill(0);
}

{
  const input = new FakePipe([], { endAfterChunks: false });
  const signals = new EventEmitter();
  const source = createSource(input, signals);
  source.validateChannel();
  await source.preflight();
  const pending = source.readOnceAndClear();
  for (let attempt = 0; attempt < 10 && input.listenerCount('data') === 0; attempt += 1) {
    await Promise.resolve();
  }
  equal(input.listenerCount('data'), 1);
  await source.clear();
  await rejects(() => pending, 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  equal(source.evidence().bufferZeroed, true);
  assertListenersCleared(input, signals);
}

for (const selectedSignal of ['SIGTERM', 'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGUSR1']) {
  const input = new FakePipe([], { endAfterChunks: false });
  const signals = new EventEmitter();
  const source = createSource(input, signals);
  source.validateChannel();
  await source.preflight();
  const pending = source.readOnceAndClear();
  signals.emit(selectedSignal);
  await rejects(() => pending, 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL');
  equal(source.evidence().bufferZeroed, true);
  assertListenersCleared(input, signals);
}

{
  const source = createSource(new FakePipe([], { isTTY: true }));
  await rejects(() => source.validateChannel(), 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  equal(source.evidence().readCount, 0);
}

for (const pipeKind of ['file', 'other']) {
  const source = createSource(new FakePipe([], { pipeKind }));
  await rejects(() => source.validateChannel(), 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  equal(source.evidence().readCount, 0);
}

{
  const source = createSource(new FakePipe([
    CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE,
  ], { pipeKind: 'socket' }));
  source.validateChannel();
  await source.preflight();
  let value = await source.readOnceAndClear();
  equal(value, CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
  value = '';
  equal(source.evidence().readCount, 1);
  equal(source.evidence().bufferZeroed, true);
}

for (const eventToThrow of ['error', 'end', 'close']) {
  const input = new ThrowingListenerPipe([], eventToThrow);
  const signals = new EventEmitter();
  const clearedTimers = [];
  const source = createSource(input, signals, {
    setTimeoutImpl: () => 29,
    clearTimeoutImpl: (timer) => clearedTimers.push(timer),
  });
  source.validateChannel();
  await source.preflight();
  await rejects(() => source.readOnceAndClear(),
    'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  equal(clearedTimers, [29]);
  assertListenersCleared(input, signals);
  const late = Buffer.from(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE, 'ascii');
  input.emit('data', late);
  equal(late.toString('ascii'), CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
  equal(source.evidence().bufferZeroed, true);
  late.fill(0);
}

{
  const input = new FakePipe([], { endAfterChunks: false });
  const signals = new EventEmitter();
  const originalOn = signals.on.bind(signals);
  let registrations = 0;
  signals.on = (event, listener) => {
    const result = originalOn(event, listener);
    registrations += 1;
    if (registrations === 3) throw new Error('TEST_E_SIGNAL_REGISTRATION');
    return result;
  };
  const source = createSource(input, signals);
  source.validateChannel();
  await source.preflight();
  await rejects(() => source.readOnceAndClear(),
    'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT');
  assertListenersCleared(input, signals);
}

const safeManagerResult = Object.freeze({
  environment: 'staging',
  purpose: 'staging-worker-control',
  accountIdSha256: 'a'.repeat(64),
  apiTokenSha256: 'b'.repeat(64),
  tokenIdSha256: 'c'.repeat(64),
  statusAtVerification: 'active',
  notBefore: '2026-09-04T00:00:00.000Z',
  expiresAt: '2026-09-05T00:00:00.000Z',
  permissionContractSha256: 'd'.repeat(64),
});

{
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  const source = createSource(input);
  await rejects(() => runCloudflareStagingControlTokenStdin({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [], source,
    loadManager: async () => {
      throw new Error(`TEST_E_IMPORT_${CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE}`);
    },
  }), 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_FAILED');
  equal(source.evidence().readCount, 0);
  equal(input.chunks[0].toString('ascii'), CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
  equal(source.evidence().bufferZeroed, true);
  input.chunks[0].fill(0);
}

for (const failure of ['destination', 'keychain-existing']) {
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  const source = createSource(input);
  let fetchCalls = 0;
  await rejects(() => runCloudflareStagingControlTokenStdin({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [], source,
    loadManager: async () => async ({ clipboard }) =>
      initializeCloudflareStagingControlToken({
        accountId: SYNTHETIC_ACCOUNT_ID,
        expectedAccountIdSha256: SYNTHETIC_ACCOUNT_SHA256,
        metadataOutput: SYNTHETIC_METADATA_PATH,
        clipboard,
        store: {
          async get() { return failure === 'keychain-existing' ? 'occupied' : null; },
          async putCreateOnly() { throw new Error('TEST_E_UNEXPECTED_KEYCHAIN_WRITE'); },
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error('TEST_E_UNEXPECTED_FETCH');
        },
        now: SYNTHETIC_NOW,
        assertDestination: async () => {
          if (failure === 'destination') {
            throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS');
          }
        },
        writeMetadata: async () => { throw new Error('TEST_E_UNEXPECTED_WRITE'); },
      }),
  }), failure === 'destination'
    ? 'CLOUDFLARE_E_SIGNING_FILE_EXISTS' : 'CLOUDFLARE_E_STAGING_CONTROL_EXISTS');
  equal(source.evidence().readCount, 0);
  equal(fetchCalls, 0);
  equal(input.chunks[0].toString('ascii'), CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
  input.chunks[0].fill(0);
}

{
  const events = [];
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  const source = createSource(input);
  const originalPreflight = source.preflight.bind(source);
  const originalRead = source.readOnceAndClear.bind(source);
  source.preflight = async () => {
    events.push('source:preflight');
    return originalPreflight();
  };
  source.readOnceAndClear = async () => {
    events.push('input:read');
    return originalRead();
  };
  let stored = null;
  const result = await runCloudflareStagingControlTokenStdin({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [], source,
    loadManager: async () => {
      events.push('manager:import');
      return async ({ clipboard }) => {
        events.push('manager:call');
        const metadata = await initializeCloudflareStagingControlToken({
          accountId: SYNTHETIC_ACCOUNT_ID,
          expectedAccountIdSha256: SYNTHETIC_ACCOUNT_SHA256,
          metadataOutput: SYNTHETIC_METADATA_PATH,
          clipboard,
          store: {
            async get() { events.push('keychain:get'); return stored; },
            async putCreateOnly(_service, _account, value) {
              events.push('keychain:write');
              stored = value;
            },
          },
          fetchImpl: async (url) => {
            events.push('verify:fetch');
            if (url.endsWith('/tokens/verify')) return apiResponse({
              id: `token_${'I'.repeat(28)}`,
              status: 'active',
              not_before: '2026-09-04T00:50:00.000Z',
              expires_on: '2026-09-05T01:00:00.000Z',
            });
            return apiResponse({ subdomain: 'dwnc' });
          },
          now: SYNTHETIC_NOW,
          assertDestination: async (candidate) => {
            events.push(candidate.includes('-recovery.json')
              ? 'destination:recovery' : 'destination:primary');
          },
          writeMetadata: async () => { events.push('metadata:write'); },
        });
        return {
          environment: 'staging',
          purpose: metadata.purpose,
          accountIdSha256: metadata.accountIdSha256,
          apiTokenSha256: metadata.apiTokenSha256,
          tokenIdSha256: metadata.tokenIdSha256,
          statusAtVerification: metadata.status,
          notBefore: metadata.notBefore,
          expiresAt: metadata.expiresAt,
          permissionContractSha256: metadata.permissionContractSha256,
        };
      };
    },
  });
  equal(result.status, 'complete');
  equal(events, [
    'manager:import',
    'manager:call',
    'destination:primary',
    'destination:recovery',
    'keychain:get',
    'source:preflight',
    'input:read',
    'verify:fetch',
    'verify:fetch',
    'keychain:write',
    'keychain:get',
    'destination:primary',
    'metadata:write',
  ]);
  equal(source.evidence().readCount, 1);
  equal(input.chunks.every(zeroed), true);
}

{
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  let manageCalls = 0;
  const result = await runCloudflareStagingControlTokenStdin({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [], input,
    inspectInput: inspectFakePipe,
    loadManager: async () => async ({ argv, environment, clipboard }) => {
      manageCalls += 1;
      equal(argv, ['--mode=initialize']);
      equal(environment, SAFE_ENVIRONMENT);
      await clipboard.preflight();
      let value = await clipboard.readOnceAndClear();
      equal(value, CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
      value = '';
      return safeManagerResult;
    },
  });
  equal(manageCalls, 1);
  equal(result.status, 'complete');
  equal(result.mode, 'initialize');
  equal(result.inputReads, 1);
  equal(result.bufferZeroed, true);
  equal(result.clipboardRead, false);
  equal(result.clipboardCleared, false);
  equal(JSON.stringify(result).includes(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE), false);
}

{
  const effects = {
    fetch: 0,
    keychain: 0,
    metadataWrite: 0,
    fileWrite: 0,
    nativeSpawn: 0,
    managerImport: 0,
    managerCall: 0,
  };
  const result = await runCloudflareStagingControlTokenStdin({
    argv: ['--probe'],
    environment: SAFE_ENVIRONMENT,
    execArgv: [],
    input: new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE], { delayed: true }),
    inspectInput: inspectFakePipe,
    loadManager: async () => {
      effects.managerImport += 1;
      return async () => {
        effects.managerCall += 1;
        effects.fetch += 1;
        effects.keychain += 1;
        effects.metadataWrite += 1;
        effects.fileWrite += 1;
        effects.nativeSpawn += 1;
        throw new Error('TEST_E_MANAGE');
      };
    },
  });
  equal(effects, {
    fetch: 0,
    keychain: 0,
    metadataWrite: 0,
    fileWrite: 0,
    nativeSpawn: 0,
    managerImport: 0,
    managerCall: 0,
  });
  equal(result, {
    schemaVersion: 1,
    contract: CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT,
    status: 'complete',
    mode: 'probe',
    input: 'stdin-fifo-or-socket-exact-eof',
    inputBytes: 53,
    inputKind: 'fifo',
    inputReads: 1,
    bufferZeroed: true,
    sideEffects: 0,
    clipboardRead: false,
    clipboardCleared: false,
    rawTokenPrinted: false,
  });
}

await rejects(() => runCloudflareStagingControlTokenStdin({
  argv: ['--probe'], environment: SAFE_ENVIRONMENT, execArgv: [],
  input: new FakePipe([`cfat_${'Q'.repeat(40)}${'0'.repeat(8)}`]),
  inspectInput: inspectFakePipe,
}), 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_PROBE');

for (const options of [
  {
    argv: [CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE],
    environment: SAFE_ENVIRONMENT,
    execArgv: [],
  },
  {
    argv: [],
    environment: { ...SAFE_ENVIRONMENT, EXTRA: 'not-allowed' },
    execArgv: [],
  },
  {
    argv: [],
    environment: Object.fromEntries(
      Object.entries(SAFE_ENVIRONMENT).filter(([name]) => name !== 'LOGNAME'),
    ),
    execArgv: [],
  },
  {
    argv: [],
    environment: {
      ...SAFE_ENVIRONMENT,
      HOME: `/private/tmp/prefix-${CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE}-suffix`,
    },
    execArgv: [],
  },
  {
    argv: [],
    environment: { ...SAFE_ENVIRONMENT, USER: `prefix-${'a'.repeat(32)}-suffix` },
    execArgv: [],
  },
  {
    argv: [],
    environment: { ...SAFE_ENVIRONMENT, HOME: 7 },
    execArgv: [],
  },
  { argv: [], environment: SAFE_ENVIRONMENT, execArgv: ['--inspect'] },
]) {
  let managerImports = 0;
  const source = createSource(
    new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]),
  );
  await rejects(() => runCloudflareStagingControlTokenStdin({
    ...options,
    source,
    loadManager: async () => {
      managerImports += 1;
      throw new Error('TEST_E_UNEXPECTED_MANAGER_IMPORT');
    },
  }), options.argv.length === 1 && options.argv[0] !== '--probe'
    ? 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_ARGUMENT'
    : 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_ENVIRONMENT');
  equal(managerImports, 0);
  equal(source.evidence().readCount, 0);
}

{
  let managerImports = 0;
  const source = createSource(
    new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]),
  );
  await rejects(() => runCloudflareStagingControlTokenStdin({
    argv: ['--probe'], environment: SAFE_ENVIRONMENT, execArgv: [],
    root: '/private/tmp', source,
    loadManager: async () => { managerImports += 1; return async () => undefined; },
  }), 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_ARGUMENT');
  equal(managerImports, 0);
  equal(source.evidence().readCount, 0);
}

{
  class PreManagerSignalEmitter extends EventEmitter {
    constructor() { super(); this.queued = false; }
    on(event, listener) {
      const result = super.on(event, listener);
      if (!this.queued && event === 'SIGTERM') {
        this.queued = true;
        queueMicrotask(() => this.emit('SIGTERM'));
      }
      return result;
    }
  }
  const signals = new PreManagerSignalEmitter();
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  const source = createSource(input, signals);
  let managerImports = 0;
  await rejects(() => runCloudflareStagingControlTokenStdin({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [],
    signalEmitter: signals, source,
    loadManager: async () => { managerImports += 1; return async () => undefined; },
  }), 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL');
  equal(managerImports, 0);
  equal(source.evidence().readCount, 0);
  assertListenersCleared(input, signals);
}

{
  const signals = new EventEmitter();
  const originalOn = signals.on.bind(signals);
  let registrations = 0;
  signals.on = (event, listener) => {
    const result = originalOn(event, listener);
    registrations += 1;
    if (registrations === 3) throw new Error('TEST_E_OPERATION_SIGNAL_REGISTRATION');
    return result;
  };
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  const source = createSource(input, signals);
  let managerImports = 0;
  await rejects(() => runCloudflareStagingControlTokenStdin({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [],
    signalEmitter: signals, source,
    loadManager: async () => { managerImports += 1; return async () => undefined; },
  }), 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_IMPLEMENTATION');
  equal(managerImports, 0);
  equal(source.evidence().readCount, 0);
  assertListenersCleared(input, signals);
}

{
  const input = new FakePipe([], { endAfterChunks: false });
  const signals = new EventEmitter();
  const stdout = [];
  const stderr = [];
  let managerImports = 0;
  let managerCalls = 0;
  const pending = runCloudflareStagingControlTokenStdinCli({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [], input,
    inspectInput: inspectFakePipe,
    signalEmitter: signals,
    loadManager: async () => {
      managerImports += 1;
      return async ({ clipboard }) => {
        managerCalls += 1;
        await clipboard.preflight();
        await clipboard.readOnceAndClear();
        return safeManagerResult;
      };
    },
    writeOutput: (value) => stdout.push(value),
    writeError: (value) => stderr.push(value),
  });
  for (let attempt = 0; attempt < 10 && input.listenerCount('data') === 0; attempt += 1) {
    await Promise.resolve();
  }
  equal(input.listenerCount('data'), 1);
  signals.emit('SIGINT');
  const final = await pending;
  equal(managerImports, 1);
  equal(managerCalls, 1);
  equal(final.status, 'failed');
  equal(final.errorCode, 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_SIGNAL');
  equal(final.durableState, 'none');
  equal(final.inputReads, 1);
  equal(stdout, []);
  equal(stderr.length, 1);
  equal(stderr.join('').includes(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE), false);
  assertListenersCleared(input, signals);
}

{
  const stdout = [];
  const stderr = [];
  const final = await runCloudflareStagingControlTokenStdinCli({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [],
    input: new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]),
    inspectInput: inspectFakePipe,
    loadManager: async () => async ({ clipboard }) => {
      await clipboard.preflight();
      const value = await clipboard.readOnceAndClear();
      throw new Error(`TEST_E_SECRET_${value}`);
    },
    writeOutput: (value) => stdout.push(value),
    writeError: (value) => stderr.push(value),
  });
  equal(final.status, 'failed');
  equal(final.errorCode, 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_FAILED');
  equal(final.durableState, 'unknown');
  equal(final.inputReads, 1);
  equal(final.bufferZeroed, true);
  equal(stdout, []);
  equal(stderr.length, 1);
  equal(stderr.join('').includes(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE), false);
  equal(JSON.parse(stderr[0]).rawTokenPrinted, false);
}

{
  const input = new FakePipe([CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE]);
  const signals = new EventEmitter();
  const stdout = [];
  const stderr = [];
  let managerImports = 0;
  let managerCalls = 0;
  const final = await runCloudflareStagingControlTokenStdinCli({
    argv: [], environment: SAFE_ENVIRONMENT, execArgv: [], input,
    inspectInput: inspectFakePipe,
    signalEmitter: signals,
    loadManager: async () => {
      managerImports += 1;
      return async ({ clipboard }) => {
        managerCalls += 1;
        await clipboard.preflight();
        let value = await clipboard.readOnceAndClear();
        equal(value, CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE);
        value = '';
        signals.emit('SIGQUIT');
        signals.emit('SIGUSR1');
        return safeManagerResult;
      };
    },
    writeOutput: (value) => stdout.push(value),
    writeError: (value) => stderr.push(value),
  });
  equal(managerImports, 1);
  equal(managerCalls, 1);
  equal(final.status, 'complete');
  equal(final.durableState, 'complete');
  equal(final.inputReads, 1);
  equal(final.bufferZeroed, true);
  equal(stdout.length, 1);
  equal(stderr, []);
  equal(stdout.join('').includes(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE), false);
  assertListenersCleared(input, signals);
}

{
  const inputBytes = Buffer.from(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE, 'ascii');
  const child = spawn('/usr/local/bin/node', [
    path.resolve('scripts/run-cloudflare-staging-control-token-stdin.mjs'), '--probe',
  ], {
    cwd: process.cwd(),
    env: SAFE_ENVIRONMENT,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.end(inputBytes, () => inputBytes.fill(0));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const output = Buffer.concat(stdout).toString('utf8');
  const errorOutput = Buffer.concat(stderr).toString('utf8');
  const parsed = JSON.parse(output);
  equal(code, 0);
  equal(errorOutput, '');
  equal(parsed.status, 'complete');
  equal(parsed.mode, 'probe');
  equal(parsed.input, 'stdin-fifo-or-socket-exact-eof');
  equal(parsed.inputKind, 'socket');
  equal(parsed.sideEffects, 0);
  equal(parsed.clipboardRead, false);
  equal(parsed.clipboardCleared, false);
  equal(output.includes(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE), false);
  equal(inputBytes.every((byte) => byte === 0), true);
  stdout.forEach((value) => value.fill(0));
  stderr.forEach((value) => value.fill(0));
}

{
  const failed = validateCloudflareStagingControlTokenStdinMessage({
    schemaVersion: 1,
    contract: CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_CONTRACT,
    status: 'failed',
    mode: 'initialize',
    errorCode: 'CLOUDFLARE_E_STAGING_CONTROL_STDIN_INPUT',
    durableState: 'none',
    inputReads: 0,
    bufferZeroed: true,
    clipboardRead: false,
    clipboardCleared: false,
    rawTokenPrinted: false,
  });
  equal(JSON.parse(serializeCloudflareStagingControlTokenStdinMessage(failed)), failed);
  assert.throws(
    () => validateCloudflareStagingControlTokenStdinMessage({ ...failed, extra: true }),
    /CLOUDFLARE_E_STAGING_CONTROL_STDIN_OUTPUT/u,
  );
  assertions += 1;
}

{
  const [runnerSource, packageSource, suiteSource] = await Promise.all([
    readFile('scripts/run-cloudflare-staging-control-token-stdin.mjs', 'utf8'),
    readFile('package.json', 'utf8'),
    readFile('scripts/run-cloudflare-tests.mjs', 'utf8'),
  ]);
  for (const forbidden of [
    'node:child_process', 'MacOSSingleReadClipboard', '/usr/bin/pbpaste',
    '/usr/bin/pbcopy', 'setRawMode(', 'shell:',
  ]) equal(runnerSource.includes(forbidden), false);
  equal(Object.hasOwn(
    JSON.parse(packageSource).scripts, 'cloudflare:staging:control-token:stdin:init',
  ), false);
  equal(suiteSource.includes("'test-cloudflare-staging-control-token-stdin.mjs'"), true);
  equal(process.argv.join('\0').includes(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE), false);
  equal(Object.values(process.env).some(
    (value) => value?.includes(CLOUDFLARE_STAGING_CONTROL_TOKEN_STDIN_PROBE),
  ), false);
}

console.log(JSON.stringify({
  suite: 'cloudflare-staging-control-token-stdin',
  assertions,
  realKeychainCalls: 0,
  realClipboardCalls: 0,
  externalNetworkCalls: 0,
  rawTokenArgvWrites: 0,
  rawTokenEnvironmentWrites: 0,
  rawTokenFileWrites: 0,
  status: 'PASS',
}, null, 2));
