import assert from 'node:assert/strict';
import {
  chmod, link, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT,
  CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
  CLOUDFLARE_ACCOUNT_TARGET_SERVICE,
  assertCloudflareAccountTargetOutsideRepository,
  cloudflareAccountTargetRecoveryMetadataPath,
  cloudflareAccountTargetIdentity,
  defaultCloudflareAccountTargetMetadataPath,
  initializeCloudflareAccountTarget,
  loadCloudflareAccountTarget,
  recoverCloudflareAccountTargetMetadata,
  validateCloudflareAccountTargetMetadata,
  validateCloudflareAccountTargetPayload,
} from './lib/cloudflare-account-target.mjs';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import {
  parseCanonicalEvidenceStorage,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';
import { manageCloudflareAccountTarget } from './manage-cloudflare-account-target.mjs';

const accountId = 'a'.repeat(32);
const wrongAccountId = 'b'.repeat(32);
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
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

class MemoryClipboard {
  constructor(value, { preflightError = null, clearErrorAt = null } = {}) {
    this.value = value;
    this.preflightError = preflightError;
    this.clearErrorAt = clearErrorAt;
    this.preflightCount = 0;
    this.readCount = 0;
    this.clearCount = 0;
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
  async readOnceAndClear() {
    this.readCount += 1;
    if (this.readCount > 1) throw new Error('TEST_E_CLIPBOARD_MULTI_READ');
    const value = this.value;
    await this.clear();
    return value;
  }
}

class MemoryKeychainStore {
  values = new Map();
  calls = [];
  key(service, account) { return `${service}\0${account}`; }
  async get(service, account) {
    this.calls.push({ operation: 'get', service, account });
    return this.values.get(this.key(service, account)) ?? null;
  }
  async putCreateOnly(service, account, value) {
    this.calls.push({ operation: 'putCreateOnly', service, account });
    const key = this.key(service, account);
    if (this.values.has(key)) throw new Error('CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
    this.values.set(key, value);
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
  equal(clipboard.clearCount, 2);
  equal(clipboard.value, '');
  equal(metadata.accountIdSha256, accountIdSha256);
  equal(metadata.purpose, CLOUDFLARE_ACCOUNT_TARGET_PURPOSE);
  equal(metadata.keychainService, CLOUDFLARE_ACCOUNT_TARGET_SERVICE);
  equal(metadata.keychainAccount, CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT);
  const metadataStats = await lstat(metadataPath);
  equal(metadataStats.mode & 0o777, 0o600);
  equal(metadataStats.nlink, 1);
  const metadataRaw = await readFile(metadataPath);
  equal(metadataRaw.includes(Buffer.from(accountId)), false);
  const parsedMetadata = parseCanonicalEvidenceStorage(metadataRaw);
  equal(parsedMetadata.payload, metadata);
  metadataRaw.fill(0);
  parsedMetadata.canonicalBytes.fill(0);

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
  }]);
  equal(store.calls.some((call) => call.account.includes('uploader')
    || call.account.includes('validator')), false);

  const collisionClipboard = new MemoryClipboard(accountId);
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'collision.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: collisionClipboard,
    store,
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
  equal(collisionClipboard.preflightCount, 0);
  equal(collisionClipboard.readCount, 0);
  equal(collisionClipboard.clearCount, 1);

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
  equal(failedPreflight.value, '');

  const clearFailure = new MemoryClipboard(accountId, { clearErrorAt: 1 });
  await rejects(() => initializeCloudflareAccountTarget({
    metadataOutput: path.join(directory, 'clear-failure.json'),
    expectedAccountIdSha256: accountIdSha256,
    clipboard: clearFailure,
    store: new MemoryKeychainStore(),
  }), 'CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
  equal(clearFailure.readCount, 1);
  equal(clearFailure.value, '');

  for (const [name, prepare] of [
    ['preexisting', async (target) => writeFile(target, '{}', { mode: 0o600 })],
    ['symlink', async (target) => symlink(metadataPath, target)],
    ['hardlink', async (target) => {
      const source = path.join(directory, 'hardlink-source.json');
      await writeFile(source, '{}', { mode: 0o600 });
      await link(source, target);
    }],
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
    }), /CLOUDFLARE_E_SIGNING_FILE/u);
    assertions += 1;
    equal(rejectedClipboard.readCount, 0);
    equal(rejectedStore.calls.length, 0);
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
  equal(exhaustedClipboard.clearCount, 2);

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
    Buffer.from(canonicalJson({
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-account-target-v1',
      accountId: wrongAccountId,
    })).toString('base64url'));
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
    load: async () => { throw new Error('TEST_E_ACCOUNT_TARGET_LOAD'); },
  }), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
  equal(insideRepositoryPolicyReads, 0);

  const managed = await manageCloudflareAccountTarget({
    argv: ['--mode=inspect'],
    root: process.cwd(),
    metadataPath,
    loadPolicy: async () => ({
      staging: {
        environment: 'staging',
        bucket: 'dwnc-me-public-media-staging',
        accountIdSha256,
      },
    }),
    load: async () => ({ metadata, accountId }),
  });
  equal(managed.status, '완료');
  equal(managed.accountNumberPrinted, false);
  equal(managed.uploadKeyRead, false);
  equal(JSON.stringify(managed).includes(accountId), false);

  const [accountSource, keychainSource, runnerSource] = await Promise.all([
    readFile('scripts/lib/cloudflare-account-target.mjs', 'utf8'),
    readFile('scripts/lib/cloudflare-signing-key.mjs', 'utf8'),
    readFile('scripts/run-cloudflare-read-control-plane.mjs', 'utf8'),
  ]);
  equal(accountSource.includes("'-A'"), false);
  equal(accountSource.includes("'-U'"), false);
  equal(keychainSource.includes("'-A'"), false);
  equal(keychainSource.includes("'-U'"), false);
  equal(runnerSource.includes('r2-credential-store'), false);
  equal(runnerSource.includes('R2_CREDENTIAL_METADATA_PATH'), false);
  equal(runnerSource.includes('R2_SECRET_ACCESS_KEY'), false);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  suite: 'cloudflare-account-target-keychain',
  assertions,
  realKeychainCalls: 0,
  realClipboardCalls: 0,
  liveNetworkCalls: 0,
  uploadCredentialReads: 0,
  status: 'PASS',
}, null, 2));
