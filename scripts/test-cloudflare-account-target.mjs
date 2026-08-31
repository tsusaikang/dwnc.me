import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  chmod, link, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
  CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
  MacOSAccountTargetKeychainStore,
  MacOSSingleReadClipboard,
  assertCloudflareAccountTargetOutsideRepository,
  cloudflareAccountTargetRecoveryMetadataPath,
  cloudflareAccountTargetIdentity,
  defaultCloudflareAccountTargetMetadataPath,
  initializeCloudflareAccountTarget,
  loadCloudflareAccountTarget,
  preflightCloudflareAccountTargetInitialization,
  recoverCloudflareAccountTargetMetadata,
  verifyCloudflareAccountTarget,
  validateCloudflareAccountTargetMetadata,
  validateCloudflareAccountTargetPayload,
} from './lib/cloudflare-account-target.mjs';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  parseCanonicalEvidenceStorage,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';
import { manageCloudflareAccountTarget } from './manage-cloudflare-account-target.mjs';
import { manageCloudflareStagingControlToken } from './manage-cloudflare-staging-control-token.mjs';
import { runCloudflareReadControlPlane } from './run-cloudflare-read-control-plane.mjs';
import { runCloudflareStagingControl } from './run-cloudflare-staging-control.mjs';

const accountId = 'a'.repeat(32);
const wrongAccountId = 'b'.repeat(32);
const clipboardClearedMarker = 'dwnc.me clipboard cleared';
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const accountSecret = (value) => Buffer.from(Buffer.from(canonicalJson({
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-account-target-v1',
  accountId: value,
})).toString('base64url'), 'ascii');
const isZeroed = (value) => Buffer.isBuffer(value) && value.every((byte) => byte === 0);
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.message === code);
  assertions += 1;
};
const throws = (action, code) => {
  assert.throws(action, (error) => error?.message === code);
  assertions += 1;
};
const nativeSpawnGuardSymbol = Symbol.for(
  'dwnc.cloudflare.account-target.native-spawn-guard.v1',
);
if (nativeSpawnGuardSymbol in globalThis) {
  throw new Error('TEST_E_ACCOUNT_TARGET_NATIVE_GUARD_EXISTS');
}
let unexpectedNativeSpawnCalls = 0;
globalThis[nativeSpawnGuardSymbol] = () => {
  unexpectedNativeSpawnCalls += 1;
  throw new Error('CLOUDFLARE_E_ACCOUNT_TEST_NATIVE_SPAWN');
};
process.once('exit', () => { delete globalThis[nativeSpawnGuardSymbol]; });

class MemoryClipboard {
  constructor(value, { preflightError = null, readError = null, clearErrorAt = null } = {}) {
    this.value = value;
    this.preflightError = preflightError;
    this.readError = readError;
    this.clearErrorAt = clearErrorAt;
    this.preflightCount = 0;
    this.readCount = 0;
    this.clearCount = 0;
    this.returnedBuffers = [];
  }
  async preflight() {
    this.preflightCount += 1;
    if (this.preflightError !== null) throw new Error(this.preflightError);
  }
  async clear() {
    this.clearCount += 1;
    this.value = '';
    if (this.clearErrorAt === this.clearCount) {
      throw new Error('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
    }
  }
  async readOnce() {
    this.readCount += 1;
    if (this.readCount > 1) throw new Error('TEST_E_CLIPBOARD_MULTI_READ');
    if (this.readError !== null) throw new Error(this.readError);
    const returned = Buffer.from(this.value, 'utf8');
    this.returnedBuffers.push(returned);
    return returned;
  }
  async readOnceAndClear() {
    let returned;
    try {
      returned = await this.readOnce();
      return returned.toString('utf8');
    } finally {
      returned?.fill(0);
      await this.clear();
    }
  }
}

class MemoryKeychainStore {
  values = new Map();
  calls = [];
  returnedBuffers = [];
  putBuffers = [];
  key(service, account) { return `${service}\0${account}`; }
  async get(service, account) {
    this.calls.push({ operation: 'get', service, account });
    const stored = this.values.get(this.key(service, account));
    if (stored === undefined) return null;
    const returned = Buffer.from(stored);
    this.returnedBuffers.push(returned);
    return returned;
  }
  async putCreateOnly(service, account, value) {
    this.calls.push({ operation: 'putCreateOnly', service, account });
    this.putBuffers.push(value);
    const key = this.key(service, account);
    if (this.values.has(key)) throw new Error('CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
    this.values.set(key, Buffer.from(value));
  }
}

class SequencedKeychainStore {
  constructor(values) {
    this.values = values.map((value) => value === null ? null : Buffer.from(value));
    this.calls = [];
    this.returnedBuffers = [];
  }
  async get(service, account) {
    this.calls.push({ operation: 'get', service, account });
    const selected = this.values.shift();
    if (selected === null || selected === undefined) return null;
    const returned = Buffer.from(selected);
    this.returnedBuffers.push(returned);
    return returned;
  }
  async putCreateOnly() { throw new Error('TEST_E_SEQUENCE_STORE_PUT'); }
}

class NativeFakeStream extends EventEmitter {
  destroyed = false;
  destroy() { this.destroyed = true; }
}

function nativeChildScenario({
  stdoutChunks = [],
  stderrChunks = [],
  code = 0,
  signal = null,
  childError = false,
  stdoutError = false,
  stderrError = false,
  stdinError = false,
  stdinThrow = false,
  writeCallback = true,
  neverClose = false,
  closeOnKill = null,
} = {}) {
  const child = new EventEmitter();
  const stdout = new NativeFakeStream();
  const stderr = new NativeFakeStream();
  const stdin = new NativeFakeStream();
  const record = {
    stdoutChunks,
    stderrChunks,
    kills: [],
    input: null,
    inputSnapshot: null,
    stdinCallbacks: 0,
  };
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = stdin;
  child.kill = (selectedSignal) => {
    record.kills.push(selectedSignal);
    if (neverClose && closeOnKill === selectedSignal) {
      queueMicrotask(() => child.emit('close', null, selectedSignal));
    }
    return true;
  };
  stdin.end = (value, callback) => {
    if (Buffer.isBuffer(value)) {
      record.input = value;
      record.inputSnapshot = Buffer.from(value);
    }
    if (stdinThrow) throw new Error('TEST_E_NATIVE_STDIN_THROW');
    if (writeCallback && typeof callback === 'function') {
      queueMicrotask(() => { record.stdinCallbacks += 1; callback(); });
    }
    if (stdinError) queueMicrotask(() => stdin.emit('error', new Error('TEST_E_NATIVE_STDIN')));
  };
  queueMicrotask(() => queueMicrotask(() => {
    if (childError) child.emit('error', new Error('TEST_E_NATIVE_CHILD'));
    for (const chunk of stdoutChunks) stdout.emit('data', chunk);
    for (const chunk of stderrChunks) stderr.emit('data', chunk);
    if (stdoutError) stdout.emit('error', new Error('TEST_E_NATIVE_STDOUT'));
    if (stderrError) stderr.emit('error', new Error('TEST_E_NATIVE_STDERR'));
    if (!neverClose) child.emit('close', code, signal);
  }));
  return { child, record };
}

const nativeEnvironmentObservations = [];
function nativeSpawnQueue(scenarios) {
  const remaining = [...scenarios];
  const records = [];
  const calls = [];
  return {
    records,
    calls,
    spawnChild(file, args, options) {
      const scenario = remaining.shift();
      calls.push({ file, args, options });
      nativeEnvironmentObservations.push({ file, args, options });
      if (scenario?.spawnError) throw new Error('TEST_E_NATIVE_SPAWN');
      if (scenario === undefined) throw new Error('TEST_E_NATIVE_UNEXPECTED_SPAWN');
      const created = nativeChildScenario(scenario);
      records.push(created.record);
      return created.child;
    },
    remaining: () => remaining.length,
  };
}

const shortNativeLifecycle = {
  timeoutMs: 5,
  terminateGraceMs: 2,
  killGraceMs: 2,
  readUserInfo: () => ({
    username: 'synthetic-user',
    homedir: '/Users/synthetic-user',
    uid: 501,
  }),
};
const expectedNativeEnvironment = Object.assign(Object.create(null), {
  HOME: '/Users/synthetic-user',
  USER: 'synthetic-user',
  LOGNAME: 'synthetic-user',
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'C',
  LC_ALL: 'C',
  __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0',
});
Object.freeze(expectedNativeEnvironment);

async function trackConcatBuffers(action) {
  const originalConcat = Buffer.concat;
  const originalAlloc = Buffer.alloc;
  const originalFrom = Buffer.from;
  const buffers = [];
  Buffer.concat = (...args) => {
    const result = originalConcat(...args);
    buffers.push(result);
    return result;
  };
  Buffer.alloc = (...args) => {
    const result = originalAlloc(...args);
    buffers.push(result);
    return result;
  };
  Buffer.from = (...args) => {
    const result = originalFrom(...args);
    if (result.length >= 40 && result.length <= 512
      && result.every((value) => value >= 0x30 && value <= 0x39
        || value >= 0x41 && value <= 0x5a
        || value >= 0x61 && value <= 0x7a
        || value === 0x2d || value === 0x5f)) {
      buffers.push(result);
    }
    return result;
  };
  try { return { result: await action(), buffers }; }
  catch (error) { error.trackedConcatBuffers = buffers; throw error; }
  finally {
    Buffer.concat = originalConcat;
    Buffer.alloc = originalAlloc;
    Buffer.from = originalFrom;
  }
}

const identity = cloudflareAccountTargetIdentity();
equal(identity, {
  service: CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
  account: CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
});
equal(defaultCloudflareAccountTargetMetadataPath('/synthetic/home'),
  '/synthetic/home/Library/Application Support/dwnc.me/stage3/staging-cloudflare-account-target.json');
const originalHome = process.env.HOME;
try {
  process.env.HOME = process.cwd();
  const defaultPathWithSpoofedHome = defaultCloudflareAccountTargetMetadataPath();
  const relativeToRepository = path.relative(process.cwd(), defaultPathWithSpoofedHome);
  equal(relativeToRepository === '' || relativeToRepository !== '..'
    && !relativeToRepository.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativeToRepository), false);
} finally {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
}
equal(cloudflareAccountTargetRecoveryMetadataPath(
  '/synthetic/home/Library/Application Support/dwnc.me/stage3/staging-cloudflare-account-target.json',
), '/synthetic/home/Library/Application Support/dwnc.me/stage3/staging-cloudflare-account-target-recovery.json');
throws(() => defaultCloudflareAccountTargetMetadataPath('relative'),
  'CLOUDFLARE_E_ACCOUNT_STORE_PATH');
validateCloudflareAccountTargetPayload({
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-account-target-v1',
  accountId,
});
assertions += 1;
throws(() => validateCloudflareAccountTargetPayload({
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-account-target-v1',
  accountId: accountId.toUpperCase(),
}), 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');

const preflightAccessCalls = [];
let preflightSpawnCalls = 0;
const nativeClipboardPreflight = new MacOSSingleReadClipboard({
  accessFile: async (...args) => { preflightAccessCalls.push(args); },
  spawnChild: () => { preflightSpawnCalls += 1; },
  readUserInfo: shortNativeLifecycle.readUserInfo,
});
await nativeClipboardPreflight.preflight();
equal(preflightAccessCalls, [
  ['/usr/bin/pbpaste', 1],
  ['/usr/bin/pbcopy', 1],
]);
equal(preflightSpawnCalls, 0);

const suiteNativeSpawnGuard = globalThis[nativeSpawnGuardSymbol];
let returningGuardCalls = 0;
const returningGuardObservations = [];
try {
  delete globalThis[nativeSpawnGuardSymbol];
  globalThis[nativeSpawnGuardSymbol] = (...received) => {
    returningGuardCalls += 1;
    returningGuardObservations.push(received);
    if (received[2]?.env) received[2].env.NODE_OPTIONS = 'attempted-mutation';
    return nativeChildScenario({ stdoutChunks: [Buffer.from(accountId)] }).child;
  };
  await rejects(() => new MacOSSingleReadClipboard({
    accessFile: async () => undefined,
    readUserInfo: shortNativeLifecycle.readUserInfo,
    ...shortNativeLifecycle,
  }).readOnce(), 'CLOUDFLARE_E_ACCOUNT_TEST_NATIVE_SPAWN');
  equal(returningGuardCalls, 0);
  equal(returningGuardObservations, []);

  delete globalThis[nativeSpawnGuardSymbol];
  globalThis[nativeSpawnGuardSymbol] = Object.freeze({ testOnly: true });
  await rejects(() => new MacOSSingleReadClipboard({
    accessFile: async () => undefined,
    readUserInfo: shortNativeLifecycle.readUserInfo,
    ...shortNativeLifecycle,
  }).readOnce(), 'CLOUDFLARE_E_ACCOUNT_TEST_NATIVE_SPAWN');
  equal(returningGuardCalls, 0);
  equal(returningGuardObservations, []);
} finally {
  delete globalThis[nativeSpawnGuardSymbol];
  globalThis[nativeSpawnGuardSymbol] = suiteNativeSpawnGuard;
}

function allScenarioBuffers(records) {
  return records.flatMap((record) => [
    ...record.stdoutChunks,
    ...record.stderrChunks,
    ...(record.input === null ? [] : [record.input]),
  ]);
}

async function expectTrackedFailure(action, code) {
  let tracked = [];
  try {
    await trackConcatBuffers(action);
    assert.fail('TEST_E_EXPECTED_NATIVE_FAILURE');
  } catch (error) {
    tracked = error.trackedConcatBuffers ?? [];
    equal(error.message, code);
  }
  equal(tracked.every(isZeroed), true);
}

const nativeClipboardSuccessChunks = [
  Buffer.from(accountId.slice(0, 11), 'ascii'),
  Buffer.from(accountId.slice(11), 'ascii'),
];
const nativeClipboardSuccessSpawn = nativeSpawnQueue([{
  stdoutChunks: nativeClipboardSuccessChunks,
}]);
const nativeClipboardRead = new MacOSSingleReadClipboard({
  accessFile: async () => undefined,
  spawnChild: nativeClipboardSuccessSpawn.spawnChild,
  ...shortNativeLifecycle,
});
const nativeClipboardSuccess = await trackConcatBuffers(() => nativeClipboardRead.readOnce());
equal(nativeClipboardSuccess.result.toString('ascii'), accountId);
nativeClipboardSuccess.result.fill(0);
equal(nativeClipboardSuccessSpawn.calls, [{
  file: '/usr/bin/pbpaste', args: [], options: {
    env: expectedNativeEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
}]);
equal(nativeClipboardSuccessChunks.every(isZeroed), true);
equal(nativeClipboardSuccess.buffers.every(isZeroed), true);

for (const [name, scenario] of [
  ['malformed-empty', { stdoutChunks: [] }],
  ['malformed-stderr', { stdoutChunks: [Buffer.from(accountId)], stderrChunks: [Buffer.from('x')] }],
  ['oversize', { stdoutChunks: [Buffer.alloc(4097, 0x61)] }],
  ['nonzero', { stdoutChunks: [Buffer.from(accountId)], code: 2 }],
  ['signal', { stdoutChunks: [Buffer.from(accountId)], code: null, signal: 'SIGTERM' }],
  ['child-error', { stdoutChunks: [Buffer.from(accountId)], childError: true }],
  ['stdout-error', { stdoutChunks: [Buffer.from(accountId)], stdoutError: true }],
  ['stderr-error', { stdoutChunks: [Buffer.from(accountId)], stderrError: true }],
  ['timeout', {
    stdoutChunks: [Buffer.from(accountId)], neverClose: true, closeOnKill: 'SIGTERM',
  }],
  ['never-close', { stdoutChunks: [Buffer.from(accountId)], neverClose: true }],
]) {
  const queued = nativeSpawnQueue([scenario]);
  const clipboard = new MacOSSingleReadClipboard({
    accessFile: async () => undefined,
    spawnChild: queued.spawnChild,
    ...shortNativeLifecycle,
  });
  await expectTrackedFailure(() => clipboard.readOnce(), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD');
  equal(allScenarioBuffers(queued.records).every(isZeroed), true);
  equal(queued.remaining(), 0);
  if (name === 'timeout') equal(queued.records[0].kills, ['SIGTERM']);
  if (name === 'never-close') {
    equal(queued.records[0].kills, ['SIGTERM', 'SIGKILL']);
    equal(queued.records[0].stdoutChunks.every(isZeroed), true);
  }
}

const clipboardSpawnFailure = nativeSpawnQueue([{ spawnError: true }]);
await expectTrackedFailure(() => new MacOSSingleReadClipboard({
  accessFile: async () => undefined,
  spawnChild: clipboardSpawnFailure.spawnChild,
  ...shortNativeLifecycle,
}).readOnce(), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD');
equal(clipboardSpawnFailure.calls.length, 1);

const legacyReadChunks = [Buffer.from('synthetic-'), Buffer.from('token-value')];
const legacyClearVerificationChunks = [Buffer.from(clipboardClearedMarker, 'ascii')];
const legacyClipboardSpawn = nativeSpawnQueue([
  { stdoutChunks: legacyReadChunks },
  {},
  { stdoutChunks: legacyClearVerificationChunks },
]);
const legacyClipboardRead = new MacOSSingleReadClipboard({
  accessFile: async () => undefined,
  spawnChild: legacyClipboardSpawn.spawnChild,
  ...shortNativeLifecycle,
});
equal(await legacyClipboardRead.readOnceAndClear(), 'synthetic-token-value');
equal(legacyClipboardSpawn.calls.map((call) => [call.file, call.args, call.options.stdio]), [
  ['/usr/bin/pbpaste', [], ['ignore', 'pipe', 'pipe']],
  ['/usr/bin/pbcopy', [], ['pipe', 'pipe', 'pipe']],
  ['/usr/bin/pbpaste', [], ['ignore', 'pipe', 'pipe']],
]);
equal(legacyReadChunks.every(isZeroed), true);
equal(legacyClearVerificationChunks.every(isZeroed), true);
equal(legacyClipboardSpawn.records[1].inputSnapshot.toString('ascii'), clipboardClearedMarker);
legacyClipboardSpawn.records[1].inputSnapshot.fill(0);
equal(legacyClipboardSpawn.records[1].input.length, clipboardClearedMarker.length);
equal(isZeroed(legacyClipboardSpawn.records[1].input), true);

const staleSensitiveClipboardChunks = [Buffer.from(accountId, 'ascii')];
const staleSensitiveClipboardSpawn = nativeSpawnQueue([
  {},
  { stdoutChunks: staleSensitiveClipboardChunks },
]);
await expectTrackedFailure(() => new MacOSSingleReadClipboard({
  accessFile: async () => undefined,
  spawnChild: staleSensitiveClipboardSpawn.spawnChild,
  ...shortNativeLifecycle,
}).clear(), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
equal(staleSensitiveClipboardSpawn.calls.map(({ file }) => file), [
  '/usr/bin/pbcopy', '/usr/bin/pbpaste',
]);
equal(allScenarioBuffers(staleSensitiveClipboardSpawn.records).every(isZeroed), true);
staleSensitiveClipboardSpawn.records[0].inputSnapshot.fill(0);

for (const [name, scenario] of [
  ['stdin-error', { stdinError: true, writeCallback: false }],
  ['nonzero', { code: 2 }],
  ['signal', { code: null, signal: 'SIGTERM' }],
  ['child-error', { childError: true }],
  ['stdout-output', { stdoutChunks: [Buffer.from('x')] }],
  ['stderr-output', { stderrChunks: [Buffer.from('x')] }],
  ['stdout-error', { stdoutError: true }],
  ['stderr-error', { stderrError: true }],
  ['timeout', { neverClose: true, closeOnKill: 'SIGTERM', writeCallback: false }],
  ['never-close', { neverClose: true, writeCallback: false }],
]) {
  const queued = nativeSpawnQueue([scenario]);
  const clipboard = new MacOSSingleReadClipboard({
    accessFile: async () => undefined,
    spawnChild: queued.spawnChild,
    ...shortNativeLifecycle,
  });
  await expectTrackedFailure(() => clipboard.clear(), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
  equal(allScenarioBuffers(queued.records).every(isZeroed), true);
  if (name === 'timeout') equal(queued.records[0].kills, ['SIGTERM']);
  if (name === 'never-close') equal(queued.records[0].kills, ['SIGTERM', 'SIGKILL']);
}

const clearSpawnFailure = nativeSpawnQueue([{ spawnError: true }]);
await expectTrackedFailure(() => new MacOSSingleReadClipboard({
  accessFile: async () => undefined,
  spawnChild: clearSpawnFailure.spawnChild,
  ...shortNativeLifecycle,
}).clear(), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
equal(clearSpawnFailure.calls.length, 1);

const nativeSecret = accountSecret(accountId);
const nativeKeychainChunks = [
  Buffer.from(nativeSecret.subarray(0, 31)),
  Buffer.concat([nativeSecret.subarray(31), Buffer.from('\n')]),
];
const nativeKeychainSpawn = nativeSpawnQueue([{ stdoutChunks: nativeKeychainChunks }]);
const nativeKeychainRead = new MacOSAccountTargetKeychainStore({
  spawnChild: nativeKeychainSpawn.spawnChild,
  ...shortNativeLifecycle,
});
const nativeKeychainTracked = await trackConcatBuffers(() => nativeKeychainRead.get(
  CLOUDFLARE_ACCOUNT_TARGET_SERVICE, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
));
equal(nativeKeychainTracked.result, nativeSecret);
equal(nativeKeychainTracked.result === nativeSecret, false);
equal(nativeKeychainSpawn.calls[0], {
  file: '/usr/bin/security',
  args: [
    'find-generic-password', '-s', CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
    '-a', CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT, '-w',
  ],
  options: { env: expectedNativeEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
});
nativeKeychainTracked.result.fill(0);
nativeSecret.fill(0);
equal(nativeKeychainChunks.every(isZeroed), true);
equal(nativeKeychainTracked.buffers.every(isZeroed), true);

for (const [name, scenario] of [
  ['malformed', { stdoutChunks: [Buffer.from('not-canonical\n')] }],
  ['oversize', { stdoutChunks: [Buffer.alloc(514, 0x61)] }],
  ['nonzero', { stdoutChunks: [Buffer.from('x')], code: 2 }],
  ['signal', { code: null, signal: 'SIGTERM' }],
  ['child-error', { childError: true }],
  ['stdout-error', { stdoutError: true }],
  ['stderr-error', { stderrError: true }],
  ['timeout', {
    stdoutChunks: [Buffer.from('x')], neverClose: true, closeOnKill: 'SIGTERM',
  }],
  ['never-close', { stdoutChunks: [Buffer.from('x')], neverClose: true }],
]) {
  const queued = nativeSpawnQueue([scenario]);
  const keychain = new MacOSAccountTargetKeychainStore({
    spawnChild: queued.spawnChild,
    ...shortNativeLifecycle,
  });
  await expectTrackedFailure(() => keychain.get(
    CLOUDFLARE_ACCOUNT_TARGET_SERVICE, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  ), name === 'malformed'
    ? 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD' : 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(allScenarioBuffers(queued.records).every(isZeroed), true);
  if (name === 'timeout') equal(queued.records[0].kills, ['SIGTERM']);
  if (name === 'never-close') equal(queued.records[0].kills, ['SIGTERM', 'SIGKILL']);
}

const keychainSpawnFailure = nativeSpawnQueue([{ spawnError: true }]);
await expectTrackedFailure(() => new MacOSAccountTargetKeychainStore({
  spawnChild: keychainSpawnFailure.spawnChild,
  ...shortNativeLifecycle,
}).get(CLOUDFLARE_ACCOUNT_TARGET_SERVICE, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT),
'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');

const missingStderrChunk = Buffer.from('not found');
const missingKeychainSpawn = nativeSpawnQueue([{
  code: 44, stderrChunks: [missingStderrChunk],
}]);
equal(await new MacOSAccountTargetKeychainStore({
  spawnChild: missingKeychainSpawn.spawnChild,
  ...shortNativeLifecycle,
}).get(CLOUDFLARE_ACCOUNT_TARGET_SERVICE, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT), null);
equal(isZeroed(missingStderrChunk), true);

const nativePutSecret = accountSecret(accountId);
const nativePutVerified = accountSecret(accountId);
const nativePutSpawn = nativeSpawnQueue([
  { code: 44, stderrChunks: [Buffer.from('not found')] },
  { code: 1, stdoutChunks: [Buffer.from('security prompt')] },
  { stdoutChunks: [nativePutVerified, Buffer.from('\n')] },
]);
const nativeKeychainWrite = new MacOSAccountTargetKeychainStore({
  spawnChild: nativePutSpawn.spawnChild,
  ...shortNativeLifecycle,
});
const nativePutTracked = await trackConcatBuffers(() => nativeKeychainWrite.putCreateOnly(
  CLOUDFLARE_ACCOUNT_TARGET_SERVICE, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT, nativePutSecret,
));
equal(nativePutSpawn.calls.map((call) => [call.file, call.args, call.options.stdio]), [
  ['/usr/bin/security', [
    'find-generic-password', '-s', CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
    '-a', CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT, '-w',
  ], ['ignore', 'pipe', 'pipe']],
  ['/usr/bin/security', ['-i'], ['pipe', 'pipe', 'pipe']],
  ['/usr/bin/security', [
    'find-generic-password', '-s', CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
    '-a', CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT, '-w',
  ], ['ignore', 'pipe', 'pipe']],
]);
equal(isZeroed(nativePutSecret), true);
equal(isZeroed(nativePutSpawn.records[1].input), true);
equal(nativePutSpawn.records[1].stdinCallbacks, 1);
const nativePutRawNeedle = Buffer.from(accountId, 'ascii');
equal(nativePutSpawn.records[1].inputSnapshot.includes(nativePutRawNeedle), false);
nativePutRawNeedle.fill(0);
nativePutSpawn.records[1].inputSnapshot.fill(0);
equal(allScenarioBuffers(nativePutSpawn.records).every(isZeroed), true);
equal(nativePutTracked.buffers.every(isZeroed), true);

const existingCallerSecret = accountSecret(accountId);
const existingStoredSecret = accountSecret(accountId);
const existingNativeSpawn = nativeSpawnQueue([{
  stdoutChunks: [existingStoredSecret, Buffer.from('\n')],
}]);
await expectTrackedFailure(() => new MacOSAccountTargetKeychainStore({
  spawnChild: existingNativeSpawn.spawnChild,
  ...shortNativeLifecycle,
}).putCreateOnly(
  CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
  CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  existingCallerSecret,
), 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
equal(isZeroed(existingCallerSecret), true);
equal(allScenarioBuffers(existingNativeSpawn.records).every(isZeroed), true);

for (const [name, putScenario] of [
  ['stdin-error', { stdinError: true, writeCallback: false }],
  ['stdin-throw', { stdinThrow: true, writeCallback: false }],
  ['nonzero', { code: 2 }],
  ['signal', { code: null, signal: 'SIGTERM' }],
  ['child-error', { childError: true }],
  ['stdout-error', { stdoutError: true }],
  ['stderr-error', { stderrError: true }],
  ['stdout-oversize', { stdoutChunks: [Buffer.alloc(4097, 0x61)] }],
  ['timeout', {
    neverClose: true, closeOnKill: 'SIGTERM', writeCallback: false,
  }],
  ['never-close', { neverClose: true, writeCallback: false }],
  ['spawn-error', { spawnError: true }],
]) {
  const callerSecret = accountSecret(accountId);
  const queued = nativeSpawnQueue([
    { code: 44, stderrChunks: [Buffer.from('not found')] },
    putScenario,
  ]);
  const keychain = new MacOSAccountTargetKeychainStore({
    spawnChild: queued.spawnChild,
    ...shortNativeLifecycle,
  });
  await expectTrackedFailure(() => keychain.putCreateOnly(
    CLOUDFLARE_ACCOUNT_TARGET_SERVICE, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT, callerSecret,
  ), 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(isZeroed(callerSecret), true);
  equal(allScenarioBuffers(queued.records).every(isZeroed), true);
  const putRecord = queued.records[1];
  if (putRecord?.inputSnapshot !== null && putRecord?.inputSnapshot !== undefined) {
    const rawNeedle = Buffer.from(accountId, 'ascii');
    equal(putRecord.inputSnapshot.includes(rawNeedle), false);
    rawNeedle.fill(0);
    putRecord.inputSnapshot.fill(0);
  }
  if (name === 'timeout') equal(putRecord.kills, ['SIGTERM']);
  if (name === 'never-close') equal(putRecord.kills, ['SIGTERM', 'SIGKILL']);
  if (name === 'spawn-error') equal(queued.calls.length, 2);
}

const invalidVerificationCallerSecret = accountSecret(accountId);
const invalidVerificationSpawn = nativeSpawnQueue([
  { code: 44, stderrChunks: [Buffer.from('not found')] },
  { code: 0 },
  { stdoutChunks: [Buffer.from('malformed\n')] },
]);
await expectTrackedFailure(() => new MacOSAccountTargetKeychainStore({
  spawnChild: invalidVerificationSpawn.spawnChild,
  ...shortNativeLifecycle,
}).putCreateOnly(
  CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
  CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  invalidVerificationCallerSecret,
), 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
equal(isZeroed(invalidVerificationCallerSecret), true);
equal(allScenarioBuffers(invalidVerificationSpawn.records).every(isZeroed), true);
invalidVerificationSpawn.records[1].inputSnapshot.fill(0);

const poisonedParentKeys = [
  'HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', '__CF_USER_TEXT_ENCODING',
  'TMPDIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
  'NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NODE_PATH', 'NODE_DEBUG',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'R2_SECRET_ACCESS_KEY',
  'AWS_SECRET_ACCESS_KEY',
];
const priorParentEnvironment = new Map(poisonedParentKeys.map((key) => [key, process.env[key]]));
const environmentObservationStart = nativeEnvironmentObservations.length;
try {
  for (const key of poisonedParentKeys) process.env[key] = `poison-${key}`;

  const poisonedClipboardChunks = [Buffer.from(accountId, 'ascii')];
  const poisonedClipboardSpawn = nativeSpawnQueue([
    { stdoutChunks: poisonedClipboardChunks },
    {},
    { stdoutChunks: [Buffer.from(clipboardClearedMarker, 'ascii')] },
  ]);
  const poisonedClipboard = new MacOSSingleReadClipboard({
    accessFile: async () => undefined,
    spawnChild: poisonedClipboardSpawn.spawnChild,
    ...shortNativeLifecycle,
  });
  const forbiddenReplacementEnvironment = Object.assign(Object.create(null),
    expectedNativeEnvironment, {
      NODE_OPTIONS: 'attempted-replacement',
      NODE_V8_COVERAGE: '/attempted/replacement',
    });
  Object.freeze(forbiddenReplacementEnvironment);
  assert.throws(() => {
    poisonedClipboard.environment = forbiddenReplacementEnvironment;
  }, TypeError);
  assertions += 1;
  const poisonedClipboardValue = await poisonedClipboard.readOnce();
  poisonedClipboardValue.fill(0);
  await poisonedClipboard.clear();
  equal(allScenarioBuffers(poisonedClipboardSpawn.records).every(isZeroed), true);

  const poisonedGetSecret = accountSecret(accountId);
  const poisonedGetSpawn = nativeSpawnQueue([{
    stdoutChunks: [poisonedGetSecret, Buffer.from('\n')],
  }]);
  const poisonedGetValue = await new MacOSAccountTargetKeychainStore({
    spawnChild: poisonedGetSpawn.spawnChild,
    ...shortNativeLifecycle,
  }).get(CLOUDFLARE_ACCOUNT_TARGET_SERVICE, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT);
  poisonedGetValue.fill(0);
  equal(allScenarioBuffers(poisonedGetSpawn.records).every(isZeroed), true);

  const poisonedPutCaller = accountSecret(accountId);
  const poisonedPutVerified = accountSecret(accountId);
  const poisonedPutSpawn = nativeSpawnQueue([
    { code: 44, stderrChunks: [Buffer.from('not found')] },
    { code: 1, stdoutChunks: [Buffer.from('security prompt')] },
    { stdoutChunks: [poisonedPutVerified, Buffer.from('\n')] },
  ]);
  await new MacOSAccountTargetKeychainStore({
    spawnChild: poisonedPutSpawn.spawnChild,
    ...shortNativeLifecycle,
  }).putCreateOnly(
    CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
    CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
    poisonedPutCaller,
  );
  equal(isZeroed(poisonedPutCaller), true);
  equal(allScenarioBuffers(poisonedPutSpawn.records).every(isZeroed), true);
  poisonedPutSpawn.records[1].inputSnapshot.fill(0);
} finally {
  for (const [key, value] of priorParentEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const poisonedEnvironmentObservations = nativeEnvironmentObservations.slice(
  environmentObservationStart,
);
equal(new Set(poisonedEnvironmentObservations.map(({ file, args }) => {
  if (file === '/usr/bin/pbpaste') return 'pbpaste';
  if (file === '/usr/bin/pbcopy') return 'pbcopy';
  if (file === '/usr/bin/security' && args[0] === 'find-generic-password') {
    return 'security-get';
  }
  if (file === '/usr/bin/security' && args[0] === '-i') return 'security-put';
  return 'unexpected';
})), new Set(['pbpaste', 'pbcopy', 'security-get', 'security-put']));
for (const observation of poisonedEnvironmentObservations) {
  equal(observation.options.env, expectedNativeEnvironment);
  equal(Object.getPrototypeOf(observation.options.env), null);
  equal(Object.isFrozen(observation.options.env), true);
  equal(Object.keys(observation.options.env), Object.keys(expectedNativeEnvironment));
  equal(poisonedParentKeys.some((key) => !Object.hasOwn(expectedNativeEnvironment, key)
    && Object.hasOwn(observation.options.env, key)), false);
  equal(Object.values(observation.options.env)
    .some((value) => typeof value === 'string' && value.startsWith('poison-')), false);
}
assert.throws(() => { poisonedEnvironmentObservations[0].options.env.EXTRA = 'blocked'; }, TypeError);
assertions += 1;
assert.throws(() => {
  poisonedEnvironmentObservations[0].options.env.NODE_V8_COVERAGE = '/blocked';
}, TypeError);
assertions += 1;
assert.throws(() => Object.defineProperty(
  poisonedEnvironmentObservations[0].options.env,
  'NODE_OPTIONS',
  { value: 'blocked' },
), TypeError);
assertions += 1;

const directory = await realpath(await mkdtemp(path.join(
  os.tmpdir(), 'dwnc-account-target-test-',
)));
await chmod(directory, 0o700);
try {
  const metadataPath = path.join(directory, 'account-target.json');
  await assertCloudflareAccountTargetOutsideRepository(metadataPath, process.cwd());
  assertions += 1;
  await rejects(() => assertCloudflareAccountTargetOutsideRepository(
    path.join(process.cwd(), 'synthetic-account-target.json'), process.cwd(),
  ), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  const linkedRepositoryRoot = path.join(directory, 'linked-repository-root');
  await symlink(process.cwd(), linkedRepositoryRoot);
  await rejects(() => assertCloudflareAccountTargetOutsideRepository(
    path.join(process.cwd(), 'synthetic-account-target.json'), linkedRepositoryRoot,
  ), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  const linkedRepository = path.join(directory, 'linked-repository');
  await symlink(process.cwd(), linkedRepository);
  await rejects(() => assertCloudflareAccountTargetOutsideRepository(
    path.join(linkedRepository, 'synthetic-account-target.json'), process.cwd(),
  ), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');

  const readyPath = path.join(directory, 'ready-preflight.json');
  const readyClipboard = new MemoryClipboard('existing-user-clipboard');
  const readyStore = new MemoryKeychainStore();
  const ready = await preflightCloudflareAccountTargetInitialization({
    metadataOutput: readyPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: readyClipboard,
    store: readyStore,
  });
  equal(Object.isFrozen(ready), true);
  equal(ready, {
    purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
    accountIdSha256,
    state: 'ready',
    primaryState: 'absent',
    recoveryState: 'absent',
    keychainState: 'absent',
    clipboardRead: false,
    clipboardCleared: false,
    readyForInitialize: true,
  });
  equal(readyClipboard.preflightCount, 1);
  equal(readyClipboard.readCount, 0);
  equal(readyClipboard.clearCount, 0);
  equal(readyClipboard.value, 'existing-user-clipboard');
  equal(readyStore.calls.map((call) => call.operation), ['get']);
  equal(readyStore.values.size, 0);
  equal(await lstat(readyPath).catch((error) => error?.code), 'ENOENT');

  for (const fingerprint of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    const invalidFingerprintClipboard = new MemoryClipboard('preserve-me');
    const invalidFingerprintStore = new MemoryKeychainStore();
    await rejects(() => preflightCloudflareAccountTargetInitialization({
      metadataOutput: path.join(directory, `invalid-${fingerprint.length}.json`),
      expectedAccountIdSha256: fingerprint,
      clipboard: invalidFingerprintClipboard,
      store: invalidFingerprintStore,
    }), 'CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
    equal(invalidFingerprintClipboard.preflightCount, 0);
    equal(invalidFingerprintClipboard.readCount, 0);
    equal(invalidFingerprintClipboard.clearCount, 0);
    equal(invalidFingerprintClipboard.value, 'preserve-me');
    equal(invalidFingerprintStore.calls.length, 0);
  }

  const preflightToolFailureClipboard = new MemoryClipboard('preserve-tool-failure', {
    preflightError: 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_PREFLIGHT',
  });
  await rejects(() => preflightCloudflareAccountTargetInitialization({
    metadataOutput: path.join(directory, 'preflight-tool-failure.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: preflightToolFailureClipboard,
    store: new MemoryKeychainStore(),
  }), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_PREFLIGHT');
  equal(preflightToolFailureClipboard.preflightCount, 1);
  equal(preflightToolFailureClipboard.readCount, 0);
  equal(preflightToolFailureClipboard.clearCount, 0);
  equal(preflightToolFailureClipboard.value, 'preserve-tool-failure');

  const store = new MemoryKeychainStore();
  const clipboard = new MemoryClipboard(accountId);
  const metadata = await initializeCloudflareAccountTarget({
    metadataOutput: metadataPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard,
    store,
    now: new Date('2026-08-28T00:00:00.000Z'),
  });
  equal(clipboard.preflightCount, 1);
  equal(clipboard.readCount, 1);
  equal(clipboard.clearCount, 1);
  equal(clipboard.value, '');
  equal(metadata.accountIdSha256, accountIdSha256);
  equal(metadata.purpose, CLOUDFLARE_ACCOUNT_TARGET_PURPOSE);
  equal(metadata.keychainService, CLOUDFLARE_ACCOUNT_TARGET_SERVICE);
  equal(metadata.keychainAccount, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT);
  const expectedStoredSecret = accountSecret(accountId);
  equal([...store.values.values()][0], expectedStoredSecret);
  expectedStoredSecret.fill(0);
  const metadataStats = await lstat(metadataPath);
  equal(metadataStats.mode & 0o777, 0o600);
  equal(metadataStats.nlink, 1);
  const metadataRaw = await readFile(metadataPath);
  equal(metadataRaw.includes(Buffer.from(accountId)), false);
  const parsedMetadata = parseCanonicalEvidenceStorage(metadataRaw);
  equal(parsedMetadata.payload, metadata);
  metadataRaw.fill(0);
  parsedMetadata.canonicalBytes.fill(0);
  equal(await lstat(cloudflareAccountTargetRecoveryMetadataPath(metadataPath))
    .catch((error) => error?.code), 'ENOENT');

  const payloadByteLength = Buffer.byteLength(canonicalJson({
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-account-target-v1',
    accountId,
  }));
  const encodedPayloadByteLength = Math.floor(payloadByteLength / 3) * 4
    + (payloadByteLength % 3 === 0 ? 0 : payloadByteLength % 3 + 1);
  const sensitiveAllocations = [];
  const originalBufferAlloc = Buffer.alloc;
  const allocationSpyStore = new MemoryKeychainStore();
  const allocationSpyClipboard = new MemoryClipboard(accountId);
  try {
    Buffer.alloc = function observedBufferAlloc(size, ...args) {
      const allocated = originalBufferAlloc.call(Buffer, size, ...args);
      if ([payloadByteLength, encodedPayloadByteLength].includes(size)) {
        sensitiveAllocations.push(allocated);
      }
      return allocated;
    };
    await initializeCloudflareAccountTarget({
      metadataOutput: path.join(directory, 'allocation-spy.json'),
      expectedAccountIdSha256: accountIdSha256,
      clipboard: allocationSpyClipboard,
      store: allocationSpyStore,
      now: new Date('2026-08-28T00:00:30.000Z'),
    });
  } finally { Buffer.alloc = originalBufferAlloc; }
  equal(sensitiveAllocations.length >= 4, true);
  equal(sensitiveAllocations.every(isZeroed), true);
  equal(allocationSpyClipboard.returnedBuffers.every(isZeroed), true);
  equal(allocationSpyStore.putBuffers.every(isZeroed), true);
  equal(allocationSpyStore.returnedBuffers.every(isZeroed), true);

  const completeClipboard = new MemoryClipboard('leave-complete-clipboard-alone');
  const completePreflight = await preflightCloudflareAccountTargetInitialization({
    metadataOutput: metadataPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: completeClipboard,
    store,
  });
  equal(completePreflight.state, 'complete');
  equal(completePreflight.primaryState, 'valid');
  equal(completePreflight.recoveryState, 'absent');
  equal(completePreflight.keychainState, 'matching');
  equal(completePreflight.readyForInitialize, false);
  equal(completeClipboard.preflightCount, 1);
  equal(completeClipboard.readCount, 0);
  equal(completeClipboard.clearCount, 0);
  equal(completeClipboard.value, 'leave-complete-clipboard-alone');

  const orphanedKeychainStore = new MemoryKeychainStore();
  orphanedKeychainStore.values.set(
    orphanedKeychainStore.key(identity.service, identity.account), accountSecret(accountId),
  );
  const orphanedClipboard = new MemoryClipboard('leave-recovery-clipboard-alone');
  const orphanedPreflight = await preflightCloudflareAccountTargetInitialization({
    metadataOutput: path.join(directory, 'keychain-without-metadata.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: orphanedClipboard,
    store: orphanedKeychainStore,
  });
  equal(orphanedPreflight.state, 'recovery-required');
  equal(orphanedPreflight.primaryState, 'absent');
  equal(orphanedPreflight.recoveryState, 'absent');
  equal(orphanedPreflight.keychainState, 'matching');
  equal(orphanedPreflight.readyForInitialize, false);
  equal(orphanedClipboard.preflightCount, 1);
  equal(orphanedClipboard.readCount, 0);
  equal(orphanedClipboard.clearCount, 0);
  equal(orphanedClipboard.value, 'leave-recovery-clipboard-alone');

  const wrongPreflightStore = new MemoryKeychainStore();
  wrongPreflightStore.values.set(
    wrongPreflightStore.key(identity.service, identity.account), accountSecret(wrongAccountId),
  );
  const wrongPreflightClipboard = new MemoryClipboard('preserve-on-mismatch');
  await rejects(() => preflightCloudflareAccountTargetInitialization({
    metadataOutput: path.join(directory, 'wrong-keychain-target.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: wrongPreflightClipboard,
    store: wrongPreflightStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
  equal(wrongPreflightClipboard.preflightCount, 0);
  equal(wrongPreflightClipboard.readCount, 0);
  equal(wrongPreflightClipboard.clearCount, 0);
  equal(wrongPreflightClipboard.value, 'preserve-on-mismatch');

  const orphanRecoveryPrimary = path.join(directory, 'orphan-recovery-primary.json');
  await writeCanonicalEvidenceCreateOnly(
    cloudflareAccountTargetRecoveryMetadataPath(orphanRecoveryPrimary), metadata,
  );
  const orphanRecoveryClipboard = new MemoryClipboard('preserve-orphan-recovery');
  const orphanRecoveryStore = new MemoryKeychainStore();
  await rejects(() => preflightCloudflareAccountTargetInitialization({
    metadataOutput: orphanRecoveryPrimary,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: orphanRecoveryClipboard,
    store: orphanRecoveryStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_STATE');
  equal(orphanRecoveryClipboard.preflightCount, 0);
  equal(orphanRecoveryClipboard.readCount, 0);
  equal(orphanRecoveryClipboard.clearCount, 0);
  equal(orphanRecoveryClipboard.value, 'preserve-orphan-recovery');
  equal(orphanRecoveryStore.calls.length, 0);

  const duplicatePrimary = path.join(directory, 'duplicate-primary.json');
  await writeCanonicalEvidenceCreateOnly(duplicatePrimary, metadata);
  await writeCanonicalEvidenceCreateOnly(
    cloudflareAccountTargetRecoveryMetadataPath(duplicatePrimary), metadata,
  );
  const duplicateClipboard = new MemoryClipboard('preserve-duplicate');
  const duplicateStore = new MemoryKeychainStore();
  await rejects(() => preflightCloudflareAccountTargetInitialization({
    metadataOutput: duplicatePrimary,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: duplicateClipboard,
    store: duplicateStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_STATE');
  equal(duplicateClipboard.preflightCount, 0);
  equal(duplicateClipboard.readCount, 0);
  equal(duplicateClipboard.clearCount, 0);
  equal(duplicateClipboard.value, 'preserve-duplicate');
  equal(duplicateStore.calls.length, 0);

  store.calls = [];
  const loaded = await loadCloudflareAccountTarget({
    metadataPath,
    expectedAccountIdSha256: accountIdSha256,
    store,
  });
  equal(loaded.accountId, accountId);
  equal(store.calls, [{
    operation: 'get',
    service: CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
    account: CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  }, {
    operation: 'get',
    service: CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
    account: CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  }]);
  equal(store.calls.some((call) => call.account.includes('uploader')
    || call.account.includes('validator')), false);
  equal(store.returnedBuffers.every(isZeroed), true);
  equal(store.putBuffers.every(isZeroed), true);
  equal(clipboard.returnedBuffers.every(isZeroed), true);

  const changedBetweenReadsStore = new SequencedKeychainStore([
    accountSecret(accountId), accountSecret(wrongAccountId),
  ]);
  await rejects(() => loadCloudflareAccountTarget({
    metadataPath,
    expectedAccountIdSha256: accountIdSha256,
    store: changedBetweenReadsStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(changedBetweenReadsStore.calls.length, 2);
  equal(changedBetweenReadsStore.returnedBuffers.length, 2);
  equal(changedBetweenReadsStore.returnedBuffers.every(isZeroed), true);

  const removedBetweenReadsStore = new SequencedKeychainStore([
    accountSecret(accountId), null,
  ]);
  await rejects(() => loadCloudflareAccountTarget({
    metadataPath,
    expectedAccountIdSha256: accountIdSha256,
    store: removedBetweenReadsStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(removedBetweenReadsStore.calls.length, 2);
  equal(removedBetweenReadsStore.returnedBuffers.length, 1);
  equal(removedBetweenReadsStore.returnedBuffers.every(isZeroed), true);

  const stableBetweenReadsStore = new SequencedKeychainStore([
    accountSecret(accountId), accountSecret(accountId),
  ]);
  const stableBetweenReads = await loadCloudflareAccountTarget({
    metadataPath,
    expectedAccountIdSha256: accountIdSha256,
    store: stableBetweenReadsStore,
  });
  equal(stableBetweenReads.accountId, accountId);
  equal(stableBetweenReadsStore.calls.length, 2);
  equal(stableBetweenReadsStore.returnedBuffers.length, 2);
  equal(stableBetweenReadsStore.returnedBuffers.every(isZeroed), true);

  const collisionClipboard = new MemoryClipboard(accountId);
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'collision.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: collisionClipboard,
    store,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
  equal(collisionClipboard.preflightCount, 1);
  equal(collisionClipboard.readCount, 0);
  equal(collisionClipboard.clearCount, 0);
  equal(collisionClipboard.value, accountId);

  for (const [name, value, code] of [
    ['empty', '', 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD'],
    ['short', 'a'.repeat(31), 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD'],
    ['newline', `${accountId}\n`, 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD'],
    ['wrong-account', wrongAccountId, 'CLOUDFLARE_E_ACCOUNT_STORE_TARGET'],
  ]) {
    const rejectedStore = new MemoryKeychainStore();
    const rejectedClipboard = new MemoryClipboard(value);
    await rejects(() => initializeCloudflareAccountTarget({
      metadataOutput: path.join(directory, `${name}.json`),
      expectedAccountIdSha256: accountIdSha256,
      clipboard: rejectedClipboard,
      store: rejectedStore,
    }), code);
    equal(rejectedClipboard.readCount, 1);
    equal(rejectedClipboard.value, '');
    equal(rejectedClipboard.returnedBuffers.length, 1);
    equal(rejectedClipboard.returnedBuffers.every(isZeroed), true);
    equal(rejectedStore.calls.some((call) => call.operation === 'putCreateOnly'), false);
  }

  const failedPreflight = new MemoryClipboard(accountId, {
    preflightError: 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_PREFLIGHT',
  });
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'failed-preflight.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: failedPreflight,
    store: new MemoryKeychainStore(),
  }), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_PREFLIGHT');
  equal(failedPreflight.readCount, 0);
  equal(failedPreflight.clearCount, 0);
  equal(failedPreflight.value, accountId);

  const invalidClockClipboard = new MemoryClipboard('preserve-invalid-clock');
  const invalidClockStore = new MemoryKeychainStore();
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'invalid-clock.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: invalidClockClipboard,
    store: invalidClockStore,
    now: new Date('invalid'),
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
  equal(invalidClockClipboard.preflightCount, 0);
  equal(invalidClockClipboard.readCount, 0);
  equal(invalidClockClipboard.clearCount, 0);
  equal(invalidClockClipboard.value, 'preserve-invalid-clock');
  equal(invalidClockStore.calls.length, 0);

  const readFailure = new MemoryClipboard('clear-after-read-attempt', {
    readError: 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD',
  });
  const readFailureStore = new MemoryKeychainStore();
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'read-failure.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: readFailure,
    store: readFailureStore,
  }), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD');
  equal(readFailure.preflightCount, 1);
  equal(readFailure.readCount, 1);
  equal(readFailure.clearCount, 1);
  equal(readFailure.value, '');
  equal(readFailure.returnedBuffers.length, 0);
  equal(readFailureStore.calls.some((call) => call.operation === 'putCreateOnly'), false);

  const clearFailure = new MemoryClipboard(accountId, { clearErrorAt: 1 });
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'clear-failure.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: clearFailure,
    store: new MemoryKeychainStore(),
  }), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
  equal(clearFailure.readCount, 1);
  equal(clearFailure.clearCount, 2);
  equal(clearFailure.value, '');
  equal(clearFailure.returnedBuffers.length, 1);
  equal(clearFailure.returnedBuffers.every(isZeroed), true);

  for (const [name, prepare, errorPattern, expectedStoreReads] of [
    ['preexisting', async (target) => writeFile(target, '{}', { mode: 0o600 }),
      /CLOUDFLARE_E_ACCOUNT_STORE_STATE/u, 1],
    ['symlink', async (target) => symlink(metadataPath, target),
      /CLOUDFLARE_E_SIGNING_FILE/u, 0],
    ['hardlink', async (target) => {
      const source = path.join(directory, 'hardlink-source.json');
      await writeFile(source, '{}', { mode: 0o600 });
      await link(source, target);
    }, /CLOUDFLARE_E_SIGNING_FILE/u, 0],
  ]) {
    const target = path.join(directory, `${name}-destination.json`);
    await prepare(target);
    const rejectedClipboard = new MemoryClipboard(accountId);
    const rejectedStore = new MemoryKeychainStore();
    await assert.rejects(() => initializeCloudflareAccountTarget({
      metadataOutput: target,
      expectedAccountIdSha256: accountIdSha256,
      clipboard: rejectedClipboard,
      store: rejectedStore,
    }), errorPattern);
    assertions += 1;
    equal(rejectedClipboard.readCount, 0);
    equal(rejectedStore.calls.length, expectedStoreReads);
  }

  const looseParent = path.join(directory, 'loose-parent');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(looseParent, { mode: 0o755 }));
  const looseClipboard = new MemoryClipboard(accountId);
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(looseParent, 'metadata.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: looseClipboard,
    store: new MemoryKeychainStore(),
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  equal(looseClipboard.readCount, 0);

  const raceClipboard = new MemoryClipboard(accountId);
  const raceStore = new MemoryKeychainStore();
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'race.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: raceClipboard,
    store: raceStore,
    assertDestination: async () => { throw new Error('CLOUDFLARE_E_SIGNING_FILE_RACE'); },
  }), 'CLOUDFLARE_E_SIGNING_FILE_RACE');
  equal(raceClipboard.readCount, 0);
  equal(raceStore.calls.length, 0);

  const recoverySymlinkPrimary = path.join(directory, 'recovery-symlink-primary.json');
  const recoverySymlink = cloudflareAccountTargetRecoveryMetadataPath(recoverySymlinkPrimary);
  await symlink(metadataPath, recoverySymlink);
  const recoverySymlinkClipboard = new MemoryClipboard('preserve-recovery-symlink');
  const recoverySymlinkStore = new MemoryKeychainStore();
  await assert.rejects(() => preflightCloudflareAccountTargetInitialization({
    metadataOutput: recoverySymlinkPrimary,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: recoverySymlinkClipboard,
    store: recoverySymlinkStore,
  }), /CLOUDFLARE_E_SIGNING_FILE/u);
  assertions += 1;
  equal(recoverySymlinkClipboard.preflightCount, 0);
  equal(recoverySymlinkClipboard.readCount, 0);
  equal(recoverySymlinkClipboard.clearCount, 0);
  equal(recoverySymlinkClipboard.value, 'preserve-recovery-symlink');
  equal(recoverySymlinkStore.calls.length, 0);

  const pathToctou = path.join(directory, 'path-toctou.json');
  const pathToctouClipboard = new MemoryClipboard(accountId);
  const pathToctouStore = new MemoryKeychainStore();
  let pathToctouChecks = 0;
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: pathToctou,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: pathToctouClipboard,
    store: pathToctouStore,
    assertDestination: async (target) => {
      pathToctouChecks += 1;
      if (pathToctouChecks === 3) {
        await writeFile(pathToctou, 'interrupted', { flag: 'wx', mode: 0o600 });
      }
      return assertSecureCreateOnlyDestination(target);
    },
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_STATE');
  equal(pathToctouChecks >= 4, true);
  equal(pathToctouClipboard.preflightCount, 1);
  equal(pathToctouClipboard.readCount, 1);
  equal(pathToctouClipboard.clearCount, 1);
  equal(pathToctouClipboard.value, '');
  equal(pathToctouClipboard.returnedBuffers.every(isZeroed), true);
  equal(pathToctouStore.returnedBuffers.every(isZeroed), true);
  equal(pathToctouStore.calls.some((call) => call.operation === 'putCreateOnly'), false);

  class KeychainAppearsStore extends MemoryKeychainStore {
    getCount = 0;
    async get(service, account) {
      this.getCount += 1;
      if (this.getCount === 2) {
        this.values.set(this.key(service, account), accountSecret(accountId));
      }
      return super.get(service, account);
    }
  }
  const keychainToctouStore = new KeychainAppearsStore();
  const keychainToctouClipboard = new MemoryClipboard(accountId);
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'keychain-toctou.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: keychainToctouClipboard,
    store: keychainToctouStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_STATE');
  equal(keychainToctouStore.getCount, 2);
  equal(keychainToctouStore.calls.some((call) => call.operation === 'putCreateOnly'), false);
  equal(keychainToctouStore.values.size, 1);
  equal(keychainToctouClipboard.readCount, 1);
  equal(keychainToctouClipboard.clearCount, 1);
  equal(keychainToctouClipboard.value, '');
  equal(keychainToctouClipboard.returnedBuffers.every(isZeroed), true);
  equal(keychainToctouStore.returnedBuffers.every(isZeroed), true);

  class KeychainPutRaceStore extends MemoryKeychainStore {
    async putCreateOnly(service, account, value) {
      this.calls.push({ operation: 'putCreateOnly', service, account });
      this.putBuffers.push(value);
      this.values.set(this.key(service, account), accountSecret(wrongAccountId));
      throw new Error('CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
    }
  }
  const keychainPutRaceStore = new KeychainPutRaceStore();
  const keychainPutRaceClipboard = new MemoryClipboard(accountId);
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'keychain-put-race.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: keychainPutRaceClipboard,
    store: keychainPutRaceStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
  equal([...keychainPutRaceStore.values.values()], [accountSecret(wrongAccountId)]);
  equal(keychainPutRaceStore.calls.filter((call) => call.operation === 'putCreateOnly').length, 1);
  equal(keychainPutRaceClipboard.readCount, 1);
  equal(keychainPutRaceClipboard.clearCount, 1);
  equal(keychainPutRaceClipboard.value, '');
  equal(keychainPutRaceClipboard.returnedBuffers.every(isZeroed), true);
  equal(keychainPutRaceStore.putBuffers.length, 1);
  equal(keychainPutRaceStore.putBuffers.every(isZeroed), true);

  const partialStore = new MemoryKeychainStore();
  const partialPath = path.join(directory, 'partial-metadata.json');
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: partialPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: new MemoryClipboard(accountId),
    store: partialStore,
    writeMetadata: async () => { throw new Error('CLOUDFLARE_E_SIGNING_FILE'); },
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  equal(partialStore.values.size, 1);
  const recovered = await recoverCloudflareAccountTargetMetadata({
    metadataOutput: partialPath,
    expectedAccountIdSha256: accountIdSha256,
    store: partialStore,
    now: new Date('2026-08-28T00:01:00.000Z'),
  });
  equal(recovered.accountIdSha256, accountIdSha256);
  equal((await lstat(partialPath)).mode & 0o777, 0o600);
  equal(partialStore.putBuffers.every(isZeroed), true);
  equal(partialStore.returnedBuffers.every(isZeroed), true);

  const wrongPostconditionStore = new MemoryKeychainStore();
  const wrongPostconditionClipboard = new MemoryClipboard(accountId);
  const wrongPostconditionPath = path.join(directory, 'wrong-postcondition.json');
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: wrongPostconditionPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: wrongPostconditionClipboard,
    store: wrongPostconditionStore,
    now: new Date('2026-08-28T00:03:00.000Z'),
    writeMetadata: async (file, value) => writeCanonicalEvidenceCreateOnly(file, {
      ...value,
      createdAt: '2026-08-28T00:03:01.000Z',
    }),
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_POSTCONDITION');
  equal(wrongPostconditionClipboard.readCount, 1);
  equal(wrongPostconditionClipboard.clearCount, 1);
  equal(wrongPostconditionClipboard.returnedBuffers.every(isZeroed), true);
  equal(wrongPostconditionStore.values.size, 1);
  equal(wrongPostconditionStore.putBuffers.every(isZeroed), true);
  equal(wrongPostconditionStore.returnedBuffers.every(isZeroed), true);
  equal((await lstat(wrongPostconditionPath)).mode & 0o777, 0o600);
  equal(await lstat(cloudflareAccountTargetRecoveryMetadataPath(wrongPostconditionPath))
    .catch((error) => error?.code), 'ENOENT');

  const uncertainStore = new MemoryKeychainStore();
  const uncertainPath = path.join(directory, 'uncertain-metadata.json');
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: uncertainPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: new MemoryClipboard(accountId),
    store: uncertainStore,
    writeMetadata: async (file, value) => {
      await writeCanonicalEvidenceCreateOnly(file, value);
      throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    },
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  const uncertainRecovered = await recoverCloudflareAccountTargetMetadata({
    metadataOutput: uncertainPath,
    expectedAccountIdSha256: accountIdSha256,
    store: uncertainStore,
  });
  equal(uncertainRecovered.accountIdSha256, accountIdSha256);

  const interruptedStore = new MemoryKeychainStore();
  const interruptedPath = path.join(directory, 'interrupted-metadata.json');
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: interruptedPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: new MemoryClipboard(accountId),
    store: interruptedStore,
    writeMetadata: async (file) => {
      await writeFile(file, '', { flag: 'wx', mode: 0o600 });
      throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    },
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  equal((await readFile(interruptedPath)).length, 0);
  const interruptedRecoveryPath = cloudflareAccountTargetRecoveryMetadataPath(interruptedPath);
  const interruptedRecovered = await recoverCloudflareAccountTargetMetadata({
    metadataOutput: interruptedPath,
    expectedAccountIdSha256: accountIdSha256,
    store: interruptedStore,
    now: new Date('2026-08-28T00:02:00.000Z'),
  });
  equal(interruptedRecovered.accountIdSha256, accountIdSha256);
  equal((await readFile(interruptedPath)).length, 0);
  equal((await lstat(interruptedRecoveryPath)).mode & 0o777, 0o600);
  const interruptedLoaded = await loadCloudflareAccountTarget({
    metadataPath: interruptedPath,
    expectedAccountIdSha256: accountIdSha256,
    store: interruptedStore,
  });
  equal(interruptedLoaded.accountId, accountId);
  const repeatedInterruptedRecovery = await recoverCloudflareAccountTargetMetadata({
    metadataOutput: interruptedPath,
    expectedAccountIdSha256: accountIdSha256,
    store: interruptedStore,
  });
  equal(repeatedInterruptedRecovery.accountIdSha256, accountIdSha256);
  const injectedRecoveryPath = path.join(directory, 'operator-selected-recovery.json');
  let interruptedCallsBeforeInjection = interruptedStore.calls.length;
  await rejects(() => recoverCloudflareAccountTargetMetadata({
    metadataOutput: interruptedPath,
    recoveryMetadataOutput: injectedRecoveryPath,
    expectedAccountIdSha256: accountIdSha256,
    store: interruptedStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_PATH');
  equal(interruptedStore.calls.length, interruptedCallsBeforeInjection);
  await rejects(() => loadCloudflareAccountTarget({
    metadataPath: interruptedPath,
    recoveryMetadataPath: injectedRecoveryPath,
    expectedAccountIdSha256: accountIdSha256,
    store: interruptedStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_PATH');
  equal(interruptedStore.calls.length, interruptedCallsBeforeInjection);
  equal((await lstat(injectedRecoveryPath).catch((error) => error?.code)), 'ENOENT');

  const exhaustedStore = new MemoryKeychainStore();
  const exhaustedClipboard = new MemoryClipboard(accountId);
  const exhaustedPath = path.join(directory, 'exhausted-metadata.json');
  const exhaustedRecoveryPath = cloudflareAccountTargetRecoveryMetadataPath(exhaustedPath);
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: exhaustedPath,
    expectedAccountIdSha256: accountIdSha256,
    clipboard: exhaustedClipboard,
    store: exhaustedStore,
    writeMetadata: async (file) => {
      await writeFile(file, '', { flag: 'wx', mode: 0o600 });
      throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    },
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  const preservedKeychainValue = [...exhaustedStore.values.values()][0];
  let recoveryWriteCount = 0;
  await rejects(() => recoverCloudflareAccountTargetMetadata({
    metadataOutput: exhaustedPath,
    expectedAccountIdSha256: accountIdSha256,
    store: exhaustedStore,
    writeMetadata: async (file) => {
      recoveryWriteCount += 1;
      equal(file, exhaustedRecoveryPath);
      await writeFile(file, '', { flag: 'wx', mode: 0o600 });
      throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    },
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  equal(recoveryWriteCount, 1);
  equal((await readFile(exhaustedPath)).length, 0);
  equal((await readFile(exhaustedRecoveryPath)).length, 0);
  const callsBeforeExhaustedLoad = exhaustedStore.calls.length;
  await rejects(() => loadCloudflareAccountTarget({
    metadataPath: exhaustedPath,
    expectedAccountIdSha256: accountIdSha256,
    store: exhaustedStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_EXHAUSTED');
  equal(exhaustedStore.calls.length, callsBeforeExhaustedLoad);
  await rejects(() => recoverCloudflareAccountTargetMetadata({
    metadataOutput: exhaustedPath,
    expectedAccountIdSha256: accountIdSha256,
    store: exhaustedStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_EXHAUSTED');
  equal([...exhaustedStore.values.values()][0], preservedKeychainValue);
  equal(exhaustedStore.values.size, 1);
  equal(exhaustedStore.calls.some((call) => !['get', 'putCreateOnly'].includes(call.operation)), false);
  equal(exhaustedClipboard.readCount, 1);
  equal(exhaustedClipboard.clearCount, 1);

  for (const [name, replacement] of [
    ['wrong-fingerprint', { accountIdSha256: cloudflareAccountIdSha256(wrongAccountId) }],
    ['wrong-purpose', { purpose: 'production-cloudflare-read-target' }],
    ['wrong-service', { keychainService: 'me.dwnc.r2-s3-credentials.v1' }],
    ['wrong-account-name', { keychainAccount: 'dwnc:staging:validator' }],
  ]) {
    const tamperedPath = path.join(directory, `tampered-${name}.json`);
    await writeCanonicalEvidenceCreateOnly(tamperedPath, { ...metadata, ...replacement });
    const callsBefore = store.calls.length;
    await rejects(() => loadCloudflareAccountTarget({
      metadataPath: tamperedPath,
      expectedAccountIdSha256: accountIdSha256,
      store,
    }), 'CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
    equal(store.calls.length, callsBefore);
  }

  const looseMetadataPath = path.join(directory, 'loose-metadata.json');
  await writeFile(looseMetadataPath, `${canonicalJson(metadata)}\n`, { mode: 0o644 });
  await rejects(() => loadCloudflareAccountTarget({
    metadataPath: looseMetadataPath,
    expectedAccountIdSha256: accountIdSha256,
    store,
  }), 'CLOUDFLARE_E_SIGNING_FILE');

  const wrongSecretStore = new MemoryKeychainStore();
  wrongSecretStore.values.set(wrongSecretStore.key(identity.service, identity.account),
    accountSecret(wrongAccountId));
  await rejects(() => loadCloudflareAccountTarget({
    metadataPath,
    expectedAccountIdSha256: accountIdSha256,
    store: wrongSecretStore,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_TARGET');

  validateCloudflareAccountTargetMetadata(metadata, { expectedAccountIdSha256: accountIdSha256 });
  assertions += 1;
  throws(() => validateCloudflareAccountTargetMetadata({ ...metadata, extra: true }, {
    expectedAccountIdSha256: accountIdSha256,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_METADATA');

  let insideRepositoryPolicyReads = 0;
  await rejects(() => manageCloudflareAccountTarget({
    argv: ['--mode=inspect'],
    root: process.cwd(),
    metadataPath: path.join(process.cwd(), 'synthetic-account-target.json'),
    loadPolicy: async () => {
      insideRepositoryPolicyReads += 1;
      return null;
    },
    verify: async () => { throw new Error('TEST_E_ACCOUNT_TARGET_VERIFY'); },
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  equal(insideRepositoryPolicyReads, 0);

  let recoverySymlinkPolicyReads = 0;
  await rejects(() => manageCloudflareAccountTarget({
    argv: ['--mode=preflight'],
    root: process.cwd(),
    metadataPath: recoverySymlinkPrimary,
    loadPolicy: async () => {
      recoverySymlinkPolicyReads += 1;
      return null;
    },
    preflight: async () => { throw new Error('TEST_E_ACCOUNT_TARGET_PREFLIGHT'); },
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  equal(recoverySymlinkPolicyReads, 0);

  const trackedPolicy = async () => ({
    staging: {
      environment: 'staging',
      bucket: 'dwnc-me-public-media-staging',
      accountIdSha256,
    },
  });
  for (const invalidPolicyFingerprint of ['a'.repeat(63), 'A'.repeat(64)]) {
    let invalidPolicyOperationCalls = 0;
    await rejects(() => manageCloudflareAccountTarget({
      argv: ['--mode=preflight'],
      root: process.cwd(),
      metadataPath,
      loadPolicy: async () => ({
        staging: {
          environment: 'staging',
          bucket: 'dwnc-me-public-media-staging',
          accountIdSha256: invalidPolicyFingerprint,
        },
      }),
      preflight: async () => { invalidPolicyOperationCalls += 1; },
    }), 'CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
    equal(invalidPolicyOperationCalls, 0);
  }

  const managerChangedStore = new SequencedKeychainStore([
    accountSecret(accountId), accountSecret(wrongAccountId),
  ]);
  await rejects(() => manageCloudflareAccountTarget({
    argv: ['--mode=inspect'],
    root: process.cwd(),
    metadataPath,
    loadPolicy: trackedPolicy,
    verify: (options) => verifyCloudflareAccountTarget({
      ...options,
      store: managerChangedStore,
    }),
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(managerChangedStore.calls.length, 2);
  equal(managerChangedStore.returnedBuffers.every(isZeroed), true);

  const runnerChangedStore = new SequencedKeychainStore([
    accountSecret(accountId), accountSecret(wrongAccountId),
  ]);
  const runnerClipboard = new MemoryClipboard('synthetic-api-token');
  let runnerChildStarts = 0;
  await rejects(() => runCloudflareReadControlPlane({
    argv: ['--command=staging-r2-exposure'],
    environment: {
      CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(directory, 'runner-capture.json'),
      CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(directory, 'runner-evidence.json'),
      CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT: 'c'.repeat(40),
      CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE: 'd'.repeat(40),
    },
    root: process.cwd(),
    clipboard: runnerClipboard,
    spawnChild: () => { runnerChildStarts += 1; },
    loadPolicy: trackedPolicy,
    loadAccountTarget: (options) => loadCloudflareAccountTarget({
      ...options,
      store: runnerChangedStore,
    }),
    accountTargetMetadataPath: metadataPath,
    assertDestination: async () => undefined,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(runnerChangedStore.calls.length, 2);
  equal(runnerChangedStore.returnedBuffers.every(isZeroed), true);
  equal(runnerClipboard.preflightCount, 0);
  equal(runnerClipboard.readCount, 0);
  equal(runnerClipboard.clearCount, 1);
  equal(runnerChildStarts, 0);

  const tokenManagerChangedStore = new SequencedKeychainStore([
    accountSecret(accountId), accountSecret(wrongAccountId),
  ]);
  const tokenManagerClipboard = new MemoryClipboard('synthetic-control-token');
  let tokenManagerFetches = 0;
  let tokenManagerInitializations = 0;
  await rejects(() => manageCloudflareStagingControlToken({
    argv: ['--mode=initialize'],
    environment: {},
    root: process.cwd(),
    accountTargetMetadataPath: metadataPath,
    metadataPath: path.join(directory, 'runner-control-token.json'),
    loadPolicy: trackedPolicy,
    loadAccountTarget: (options) => loadCloudflareAccountTarget({
      ...options,
      store: tokenManagerChangedStore,
    }),
    initialize: async () => { tokenManagerInitializations += 1; },
    clipboard: tokenManagerClipboard,
    fetchImpl: async () => { tokenManagerFetches += 1; },
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(tokenManagerChangedStore.calls.length, 2);
  equal(tokenManagerChangedStore.returnedBuffers.every(isZeroed), true);
  equal(tokenManagerClipboard.preflightCount, 0);
  equal(tokenManagerClipboard.readCount, 0);
  equal(tokenManagerClipboard.clearCount, 0);
  equal(tokenManagerFetches, 0);
  equal(tokenManagerInitializations, 0);

  const stagingRunnerChangedStore = new SequencedKeychainStore([
    accountSecret(accountId), accountSecret(wrongAccountId),
  ]);
  const stagingRunnerCounts = {
    requireWrangler: 0,
    controlToken: 0,
    verify: 0,
    fetch: 0,
    whoami: 0,
    child: 0,
    auth: 0,
  };
  await rejects(() => runCloudflareStagingControl({
    argv: ['--command=staging-workers-dev-status'],
    environment: {
      CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH:
        path.join(directory, 'staging-runner-status-capture.json'),
      CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH:
        path.join(directory, 'staging-runner-status-evidence.json'),
    },
    root: process.cwd(),
    accountTargetMetadataPath: metadataPath,
    tokenMetadataPath: path.join(directory, 'staging-runner-token.json'),
    loadPolicy: trackedPolicy,
    loadAccountTarget: (options) => loadCloudflareAccountTarget({
      ...options,
      store: stagingRunnerChangedStore,
    }),
    loadControlToken: async () => { stagingRunnerCounts.controlToken += 1; },
    verifyControlToken: async () => { stagingRunnerCounts.verify += 1; },
    requireWrangler: async () => { stagingRunnerCounts.requireWrangler += 1; },
    fetchImpl: async () => { stagingRunnerCounts.fetch += 1; },
    execWrangler: async () => { stagingRunnerCounts.whoami += 1; },
    spawnChild: () => { stagingRunnerCounts.child += 1; },
    createAuth: async () => { stagingRunnerCounts.auth += 1; },
    assertDestination: async () => undefined,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
  equal(stagingRunnerChangedStore.calls.length, 2);
  equal(stagingRunnerChangedStore.returnedBuffers.every(isZeroed), true);
  equal(stagingRunnerCounts, {
    requireWrangler: 0,
    controlToken: 0,
    verify: 0,
    fetch: 0,
    whoami: 0,
    child: 0,
    auth: 0,
  });

  const expectedRecoveryPath = cloudflareAccountTargetRecoveryMetadataPath(metadataPath);
  let preflightEntrypointArgs;
  const managerPreflightClipboard = new MemoryClipboard('preserve-manager-preflight');
  const managedPreflight = await manageCloudflareAccountTarget({
    argv: ['--mode=preflight'],
    root: process.cwd(),
    metadataPath,
    loadPolicy: trackedPolicy,
    preflight: async (options) => {
      preflightEntrypointArgs = options;
      return preflightCloudflareAccountTargetInitialization({
        ...options,
        clipboard: managerPreflightClipboard,
        store,
      });
    },
    initialize: async () => { throw new Error('TEST_E_UNEXPECTED_INITIALIZE'); },
    recover: async () => { throw new Error('TEST_E_UNEXPECTED_RECOVER'); },
    verify: async () => { throw new Error('TEST_E_UNEXPECTED_VERIFY'); },
  });
  equal(preflightEntrypointArgs, {
    metadataOutput: metadataPath,
    recoveryMetadataOutput: expectedRecoveryPath,
    expectedAccountIdSha256: accountIdSha256,
  });
  equal(managedPreflight.mode, 'preflight');
  equal(managedPreflight.state, 'complete');
  equal(managedPreflight.clipboardRead, false);
  equal(managedPreflight.clipboardCleared, false);
  equal(managedPreflight.readyForInitialize, false);
  equal(managerPreflightClipboard.preflightCount, 1);
  equal(managerPreflightClipboard.readCount, 0);
  equal(managerPreflightClipboard.clearCount, 0);
  equal(managerPreflightClipboard.value, 'preserve-manager-preflight');
  equal(JSON.stringify(managedPreflight).includes(accountId), false);

  const managerLifecyclePath = path.join(directory, 'manager-lifecycle.json');
  const managerLifecycleRecoveryPath = cloudflareAccountTargetRecoveryMetadataPath(
    managerLifecyclePath,
  );
  const managerLifecycleStore = new MemoryKeychainStore();
  const managerLifecycleClipboard = new MemoryClipboard(accountId);
  let initializeEntrypointArgs;
  const managedInitialize = await manageCloudflareAccountTarget({
    argv: ['--mode=initialize'],
    root: process.cwd(),
    metadataPath: managerLifecyclePath,
    loadPolicy: trackedPolicy,
    initialize: async (options) => {
      initializeEntrypointArgs = options;
      return initializeCloudflareAccountTarget({
        ...options,
        clipboard: managerLifecycleClipboard,
        store: managerLifecycleStore,
        now: new Date('2026-08-28T00:04:00.000Z'),
      });
    },
  });
  equal(initializeEntrypointArgs, {
    metadataOutput: managerLifecyclePath,
    recoveryMetadataOutput: managerLifecycleRecoveryPath,
    expectedAccountIdSha256: accountIdSha256,
  });
  equal(managedInitialize.mode, 'initialize');
  equal(managerLifecycleClipboard.preflightCount, 1);
  equal(managerLifecycleClipboard.readCount, 1);
  equal(managerLifecycleClipboard.clearCount, 1);
  equal(managerLifecycleClipboard.value, '');
  equal((await readFile(managerLifecyclePath)).includes(Buffer.from(accountId)), false);
  equal(await lstat(managerLifecycleRecoveryPath).catch((error) => error?.code), 'ENOENT');
  equal(JSON.stringify(managedInitialize).includes(accountId), false);

  let recoverEntrypointArgs;
  let unexpectedNormalRecoveryWrites = 0;
  const managedRecover = await manageCloudflareAccountTarget({
    argv: ['--mode=recover'],
    root: process.cwd(),
    metadataPath: managerLifecyclePath,
    loadPolicy: trackedPolicy,
    recover: async (options) => {
      recoverEntrypointArgs = options;
      return recoverCloudflareAccountTargetMetadata({
        ...options,
        store: managerLifecycleStore,
        writeMetadata: async () => { unexpectedNormalRecoveryWrites += 1; },
      });
    },
  });
  equal(recoverEntrypointArgs, {
    metadataOutput: managerLifecyclePath,
    recoveryMetadataOutput: managerLifecycleRecoveryPath,
    expectedAccountIdSha256: accountIdSha256,
  });
  equal(managedRecover.mode, 'recover');
  equal(unexpectedNormalRecoveryWrites, 0);
  equal(await lstat(managerLifecycleRecoveryPath).catch((error) => error?.code), 'ENOENT');
  equal(JSON.stringify(managedRecover).includes(accountId), false);

  let inspectEntrypointArgs;
  const originalBufferToString = Buffer.prototype.toString;
  const rawAccountNeedle = Buffer.from(accountId, 'ascii');
  let inspectRawAccountStringCalls = 0;
  Buffer.prototype.toString = function guardedAccountToString(...args) {
    if (this.length === rawAccountNeedle.length && this.equals(rawAccountNeedle)) {
      inspectRawAccountStringCalls += 1;
    }
    return originalBufferToString.apply(this, args);
  };
  let managed;
  try {
    managed = await manageCloudflareAccountTarget({
      argv: ['--mode=inspect'],
      root: process.cwd(),
      metadataPath: managerLifecyclePath,
      loadPolicy: trackedPolicy,
      verify: async (options) => {
        inspectEntrypointArgs = options;
        return verifyCloudflareAccountTarget({ ...options, store: managerLifecycleStore });
      },
    });
  } finally {
    Buffer.prototype.toString = originalBufferToString;
    rawAccountNeedle.fill(0);
  }
  equal(inspectEntrypointArgs, {
    metadataPath: managerLifecyclePath,
    recoveryMetadataPath: managerLifecycleRecoveryPath,
    expectedAccountIdSha256: accountIdSha256,
  });
  equal(managed.status, '완료');
  equal(managed.accountNumberPrinted, false);
  equal(managed.uploadKeyRead, false);
  equal(JSON.stringify(managed).includes(accountId), false);
  equal(inspectRawAccountStringCalls, 0);

  const consumerNeedle = Buffer.from(accountId, 'ascii');
  let consumerRawAccountStringCalls = 0;
  Buffer.prototype.toString = function guardedConsumerAccountToString(...args) {
    if (this.length === consumerNeedle.length && this.equals(consumerNeedle)) {
      consumerRawAccountStringCalls += 1;
    }
    return originalBufferToString.apply(this, args);
  };
  let consumerLoaded;
  try {
    consumerLoaded = await loadCloudflareAccountTarget({
      metadataPath: managerLifecyclePath,
      expectedAccountIdSha256: accountIdSha256,
      store: managerLifecycleStore,
    });
  } finally {
    Buffer.prototype.toString = originalBufferToString;
    consumerNeedle.fill(0);
  }
  equal(consumerLoaded.accountId, accountId);
  equal(consumerRawAccountStringCalls, 1);

  const [accountSource, keychainSource, managerSource, runnerSource, packageSource]
    = await Promise.all([
    readFile('scripts/lib/cloudflare-account-target.mjs', 'utf8'),
    readFile('scripts/lib/cloudflare-signing-key.mjs', 'utf8'),
    readFile('scripts/manage-cloudflare-account-target.mjs', 'utf8'),
    readFile('scripts/run-cloudflare-read-control-plane.mjs', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  equal(accountSource.includes("'-A'"), false);
  equal(accountSource.includes("'-U'"), false);
  equal(keychainSource.includes("'-A'"), false);
  equal(keychainSource.includes("'-U'"), false);
  equal(runnerSource.includes('r2-credential-store'), false);
  equal(runnerSource.includes('R2_CREDENTIAL_METADATA_PATH'), false);
  equal(runnerSource.includes('R2_SECRET_ACCESS_KEY'), false);
  equal(JSON.parse(packageSource).scripts['cloudflare:account-target:preflight'],
    'node scripts/manage-cloudflare-account-target.mjs --mode=preflight');
  equal(accountSource.includes('/usr/bin/pbpaste'), true);
  equal(accountSource.includes('/usr/bin/pbcopy'), true);
  equal(accountSource.includes('promisify(execFile)'), false);
  equal(accountSource.includes('process.env'), false);
  equal(accountSource.includes('env: process'), false);
  equal(accountSource.includes('NATIVE_SPAWN_GUARD in globalThis'), true);
  equal(accountSource.includes('globalThis[NATIVE_SPAWN_GUARD]'), false);
  equal((accountSource.match(/accountIdBytes\.toString\('ascii'\)/gu) ?? []).length, 1);
  equal(managerSource.includes('loadCloudflareAccountTarget'), false);
  equal(managerSource.includes('verifyCloudflareAccountTarget'), true);
} finally {
  await rm(directory, { recursive: true, force: true });
}

equal(unexpectedNativeSpawnCalls, 0);
delete globalThis[nativeSpawnGuardSymbol];

console.log(JSON.stringify({
  suite: 'cloudflare-account-target-keychain',
  assertions,
  realKeychainCalls: 0,
  realClipboardCalls: 0,
  liveNetworkCalls: 0,
  uploadCredentialReads: 0,
  status: 'PASS',
}, null, 2));
