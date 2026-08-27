import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { promisify } from 'node:util';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import {
  assertPinnedWranglerEntrypointInstalled,
  assertStagingControlOperationEnvelope,
  cloudflareControlPlaneReadCredentials,
  cloudflareStagingWranglerEnvironment,
  encodeCloudflareControlPlaneTokenFrame,
  sealPinnedWranglerRuntime,
} from './lib/cloudflare-process.mjs';
import {
  assertMacOSKeychainSecret,
  MACOS_KEYCHAIN_SECRET_MAXIMUM_CHARACTERS,
} from './lib/cloudflare-signing-key.mjs';
import { readCloudflareStagingControlOperation }
  from './lib/cloudflare-staging-control-operation.mjs';
import {
  cloudflareStagingControlPermissionContractSha256,
  CLOUDFLARE_STAGING_CONTROL_TOKEN_PAYLOAD_CHARACTERS,
  cloudflareStagingControlTokenIdSha256,
  cloudflareStagingControlTokenRecoveryMetadataPath,
  cloudflareStagingControlTokenSha256,
  initializeCloudflareStagingControlToken,
  loadCloudflareStagingControlToken,
  recoverCloudflareStagingControlTokenMetadata,
  validateCloudflareStagingControlTokenMetadata,
  verifyCloudflareStagingControlToken,
} from './lib/cloudflare-staging-control-token.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';
import { manageCloudflareStagingControlToken }
  from './manage-cloudflare-staging-control-token.mjs';
import { fetchCloudflareServiceExistence }
  from './fetch-cloudflare-service-existence.mjs';
import { fetchCloudflareStagingWorkersDevStatus }
  from './fetch-cloudflare-staging-workers-dev-status.mjs';
import { runCloudflareReadControlPlane } from './run-cloudflare-read-control-plane.mjs';
import { runCloudflareStagingControl } from './run-cloudflare-staging-control.mjs';

const accountId = 'a'.repeat(32);
const wrongAccountId = 'b'.repeat(32);
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const apiToken = `cfat_${'T'.repeat(40)}${'0'.repeat(8)}`;
const tokenId = `token_${'I'.repeat(28)}`;
const now = new Date('2026-08-28T05:00:00.000Z');
const notBefore = '2026-08-28T04:50:00.000Z';
const expiresAt = '2026-08-28T07:00:00.000Z';
const apiTokenSha256 = cloudflareStagingControlTokenSha256(apiToken);
const tokenIdSha256 = cloudflareStagingControlTokenIdSha256(tokenId);
const permissionContractSha256
  = cloudflareStagingControlPermissionContractSha256(accountIdSha256);
let assertions = 0;
let liveNetworkCalls = 0;
let realKeychainCalls = 0;
let realClipboardCalls = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.message === code);
  assertions += 1;
};

function apiResponse(result, {
  status = 200, success = true, encoding = null, errors = [], messages = [],
} = {}) {
  const body = JSON.stringify({ success, errors, messages, result });
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  };
  if (encoding !== null) headers['content-encoding'] = encoding;
  return new Response(body, { status, headers });
}

function successfulFetch({
  tokenStatus = 'active', tokenNotBefore = notBefore, tokenExpiresAt = expiresAt,
  subdomain = 'dwnc', calls = [],
} = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    equal(options.method, 'GET');
    equal(options.redirect, 'error');
    equal(options.headers.Authorization, `Bearer ${apiToken}`);
    equal(options.headers.Accept, 'application/json');
    equal(options.headers['Accept-Encoding'], 'identity');
    if (url.endsWith('/tokens/verify')) return apiResponse({
      id: tokenId,
      status: tokenStatus,
      not_before: tokenNotBefore,
      expires_on: tokenExpiresAt,
    });
    if (url.endsWith('/workers/subdomain')) return apiResponse({ subdomain });
    throw new Error('TEST_E_UNEXPECTED_URL');
  };
}

const verificationCalls = [];
const verification = await verifyCloudflareStagingControlToken({
  accountId, apiToken, expectedAccountIdSha256: accountIdSha256,
  fetchImpl: successfulFetch({ calls: verificationCalls }), now,
});
equal(verificationCalls.map((entry) => entry.url), [
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
]);
equal(verification, {
  status: 'active', tokenIdSha256, notBefore, expiresAt,
  verifiedAt: now.toISOString(), accountIdSha256, accountCapabilityVerified: true,
  apiTokenSha256, permissionContractSha256,
});
equal(JSON.stringify(verification).includes(apiToken), false);
equal(JSON.stringify(verification).includes(tokenId), false);
equal(JSON.stringify(verification).includes(accountId), false);

equal(apiToken.length, 53);
for (const invalidToken of [
  `cfat_${'T'.repeat(39)}${'0'.repeat(8)}`,
  `cfat_${'T'.repeat(41)}${'0'.repeat(8)}`,
  `cfat_${'T'.repeat(39)}_${'0'.repeat(8)}`,
  `cfat_${'T'.repeat(40)}${'g'.repeat(8)}`,
  `${'T'.repeat(40)}${'0'.repeat(8)}`,
]) {
  assert.throws(
    () => cloudflareStagingControlTokenSha256(invalidToken),
    /CLOUDFLARE_E_STAGING_CONTROL_TOKEN_FORMAT/u,
  );
  assertions += 1;
}

let messageEnvelopeCalls = 0;
const messageEnvelopeVerification = await verifyCloudflareStagingControlToken({
  accountId, apiToken, expectedAccountIdSha256: accountIdSha256, now,
  fetchImpl: async (url) => {
    messageEnvelopeCalls += 1;
    return url.endsWith('/tokens/verify')
      ? apiResponse({ id: tokenId, status: 'active', not_before: notBefore,
        expires_on: expiresAt }, { messages: [{ code: 1000, message: 'informational' }] })
      : apiResponse({ subdomain: 'dwnc' }, { messages: ['allowed'] });
  },
});
equal(messageEnvelopeCalls, 2);
equal(messageEnvelopeVerification.apiTokenSha256, apiTokenSha256);

let nonEmptyErrorCalls = 0;
await rejects(() => verifyCloudflareStagingControlToken({
  accountId, apiToken, expectedAccountIdSha256: accountIdSha256, now,
  fetchImpl: async () => {
    nonEmptyErrorCalls += 1;
    return apiResponse({ id: tokenId, status: 'active', not_before: notBefore,
      expires_on: expiresAt }, { errors: [{ code: 1001, message: 'denied' }] });
  },
}), 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
equal(nonEmptyErrorCalls, 1);

await rejects(() => verifyCloudflareStagingControlToken({
  accountId, apiToken, expectedAccountIdSha256: accountIdSha256, now,
  fetchImpl: null,
}), 'CLOUDFLARE_E_STAGING_CONTROL_IMPLEMENTATION');

for (const [candidate, expectedCode, expectedFetches] of [
  [{ apiToken: 'cfut_wrong-token' }, 'CLOUDFLARE_E_STAGING_CONTROL_TOKEN_FORMAT', 0],
  [{ expectedAccountIdSha256: cloudflareAccountIdSha256(wrongAccountId) },
    'CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT', 0],
  [{ fetchImpl: successfulFetch({ tokenStatus: 'disabled' }) },
    'CLOUDFLARE_E_STAGING_CONTROL_VERIFY', 1],
  [{ fetchImpl: successfulFetch({ tokenNotBefore: '2026-08-28T06:00:00.000Z' }) },
    'CLOUDFLARE_E_STAGING_CONTROL_TIME', 1],
  [{ fetchImpl: successfulFetch({ tokenExpiresAt: '2026-08-28T05:59:59.999Z' }) },
    'CLOUDFLARE_E_STAGING_CONTROL_TIME', 1],
  [{ fetchImpl: successfulFetch({
    tokenNotBefore: '2026-08-25T04:00:00.000Z',
    tokenExpiresAt: '2026-08-28T07:00:00.000Z',
  }) }, 'CLOUDFLARE_E_STAGING_CONTROL_TIME', 1],
  [{ fetchImpl: successfulFetch({ subdomain: 'wrong' }) },
    'CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT', 2],
]) {
  const calls = [];
  const fetchImpl = candidate.fetchImpl ?? successfulFetch({ calls });
  let observedFetches = 0;
  const countedFetch = async (...args) => {
    observedFetches += 1;
    return fetchImpl(...args);
  };
  await rejects(() => verifyCloudflareStagingControlToken({
    accountId, apiToken, expectedAccountIdSha256: accountIdSha256,
    now, ...candidate, fetchImpl: countedFetch,
  }), expectedCode);
  equal(observedFetches, expectedFetches);
}

let redirectCalls = 0;
let badStatusBodyCancels = 0;
await rejects(() => verifyCloudflareStagingControlToken({
  accountId, apiToken, expectedAccountIdSha256: accountIdSha256, now,
  fetchImpl: async () => {
    redirectCalls += 1;
    return new Response(new ReadableStream({
      cancel() { badStatusBodyCancels += 1; },
    }), { status: 302, headers: { location: 'https://invalid.example/' } });
  },
}), 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
equal(redirectCalls, 1);
equal(badStatusBodyCancels, 1);
let compressedBodyCancels = 0;
await rejects(() => verifyCloudflareStagingControlToken({
  accountId, apiToken, expectedAccountIdSha256: accountIdSha256, now,
  fetchImpl: async () => new Response(new ReadableStream({
    cancel() { compressedBodyCancels += 1; },
  }), { status: 200, headers: { 'content-encoding': 'br' } }),
}), 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
equal(compressedBodyCancels, 1);

class MemoryStore {
  constructor(value = null) { this.value = value; this.getCount = 0; this.putCount = 0; }
  async get() {
    this.getCount += 1;
    return this.value === null ? null : assertMacOSKeychainSecret(this.value);
  }
  async putCreateOnly(service, account, value) {
    this.putCount += 1;
    if (this.value !== null) throw new Error('CLOUDFLARE_E_SIGNING_KEY_EXISTS');
    this.value = assertMacOSKeychainSecret(value);
  }
}
class MemoryClipboard {
  constructor(value) {
    this.value = value;
    this.preflightCount = 0;
    this.readCount = 0;
    this.clearCount = 0;
  }
  async preflight() { this.preflightCount += 1; }
  async readOnceAndClear() {
    this.readCount += 1;
    const value = this.value;
    await this.clear();
    return value;
  }
  async clear() { this.clearCount += 1; this.value = ''; }
}

const metadataPath = '/private/tmp/dwnc-staging-token-fixture/token.json';
const recoveryPath = cloudflareStagingControlTokenRecoveryMetadataPath(metadataPath);
equal(MACOS_KEYCHAIN_SECRET_MAXIMUM_CHARACTERS, 1024);
equal(assertMacOSKeychainSecret('A'.repeat(1024)).length, 1024);
assert.throws(() => assertMacOSKeychainSecret('A'.repeat(1025)), /CLOUDFLARE_E_KEYCHAIN/u);
assertions += 1;
const store = new MemoryStore();
const clipboard = new MemoryClipboard(apiToken);
const initializationOrder = [];
let writtenMetadata;
const metadata = await initializeCloudflareStagingControlToken({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store, clipboard, fetchImpl: async (...args) => {
    initializationOrder.push('fetch');
    return successfulFetch()(...args);
  }, now,
  assertDestination: async (candidate) => { initializationOrder.push(`absent:${candidate}`); },
  writeMetadata: async (candidate, value) => {
    initializationOrder.push(`write:${candidate}`);
    writtenMetadata = structuredClone(value);
  },
});
equal(initializationOrder.slice(0, 2), [`absent:${metadataPath}`, `absent:${recoveryPath}`]);
equal(initializationOrder.filter((value) => value === 'fetch').length, 2);
equal(initializationOrder.at(-1), `write:${metadataPath}`);
equal(store.putCount, 1);
equal(store.value.length, CLOUDFLARE_STAGING_CONTROL_TOKEN_PAYLOAD_CHARACTERS);
equal(store.value.length, 536);
equal(clipboard.preflightCount, 1);
equal(clipboard.readCount, 1);
equal(clipboard.value, '');
equal(clipboard.clearCount >= 2, true);
equal(metadata, writtenMetadata);
equal(metadata.apiTokenSha256, apiTokenSha256);
equal(metadata.tokenIdSha256, tokenIdSha256);
equal(JSON.stringify(metadata).includes(apiToken), false);
equal(JSON.stringify(metadata).includes(tokenId), false);
equal(JSON.stringify(metadata).includes(accountId), false);

for (const mutation of [
  (value) => { value.accountIdSha256 = 'f'.repeat(64); },
  (value) => { value.apiTokenSha256 = 'e'.repeat(64); },
  (value) => { value.tokenIdSha256 = 'd'.repeat(64); },
  (value) => { value.status = 'disabled'; },
  (value) => { value.permissionContractSha256 = 'c'.repeat(64); },
  (value) => { value.expiresAt = '2026-08-28T05:59:59.999Z'; },
]) {
  const tampered = structuredClone(metadata);
  mutation(tampered);
  assert.throws(() => validateCloudflareStagingControlTokenMetadata(tampered, {
    expectedAccountIdSha256: accountIdSha256,
    expectedApiTokenSha256: apiTokenSha256,
    expectedTokenIdSha256: tokenIdSha256,
    now,
  }), /CLOUDFLARE_E_STAGING_CONTROL_(?:METADATA|TIME)/u);
  assertions += 1;
}

const canonicalStoredMetadata = Buffer.from(`${canonicalJson(metadata)}\n`);
const loaded = await loadCloudflareStagingControlToken({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataPath,
  store, now,
  readFile: async () => Buffer.from(canonicalStoredMetadata),
});
equal(loaded.apiToken, apiToken);
equal(loaded.metadata, metadata);
await rejects(() => loadCloudflareStagingControlToken({
  accountId: wrongAccountId, expectedAccountIdSha256: accountIdSha256,
  metadataPath, store, now, readFile: async () => Buffer.from(canonicalStoredMetadata),
}), 'CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');

const existingStoreClipboard = new MemoryClipboard(apiToken);
await rejects(() => initializeCloudflareStagingControlToken({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store, clipboard: existingStoreClipboard, fetchImpl: () => {
    throw new Error('TEST_E_UNEXPECTED_FETCH');
  }, now, assertDestination: async () => undefined,
}), 'CLOUDFLARE_E_STAGING_CONTROL_EXISTS');
equal(existingStoreClipboard.readCount, 0);
equal(existingStoreClipboard.clearCount, 0);
equal(existingStoreClipboard.value, apiToken);

for (const occupiedPath of [metadataPath, recoveryPath]) {
  const blockedClipboard = new MemoryClipboard(apiToken);
  let blockedStoreReads = 0;
  let blockedFetches = 0;
  await rejects(() => initializeCloudflareStagingControlToken({
    accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
    store: {
      async get() { blockedStoreReads += 1; return null; },
      async putCreateOnly() { throw new Error('TEST_E_UNEXPECTED_STORE'); },
    },
    clipboard: blockedClipboard,
    fetchImpl: async () => { blockedFetches += 1; throw new Error('TEST_E_UNEXPECTED_FETCH'); },
    now,
    assertDestination: async (candidate) => {
      if (candidate === occupiedPath) throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS');
    },
  }), 'CLOUDFLARE_E_SIGNING_FILE_EXISTS');
  equal(blockedStoreReads, 0);
  equal(blockedFetches, 0);
  equal(blockedClipboard.preflightCount, 0);
  equal(blockedClipboard.readCount, 0);
  equal(blockedClipboard.clearCount, 0);
  equal(blockedClipboard.value, apiToken);
}

let unsafeInitializeStoreReads = 0;
let unsafeInitializeFetches = 0;
const unsafeInitializeClipboard = new MemoryClipboard(apiToken);
await rejects(() => initializeCloudflareStagingControlToken({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store: {
    async get() { unsafeInitializeStoreReads += 1; return null; },
    async putCreateOnly() { throw new Error('TEST_E_UNEXPECTED_STORE'); },
  },
  clipboard: unsafeInitializeClipboard,
  fetchImpl: async () => { unsafeInitializeFetches += 1; throw new Error('TEST_E_FETCH'); },
  now,
  assertDestination: async (candidate) => {
    if (candidate === recoveryPath) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
  },
}), 'CLOUDFLARE_E_SIGNING_FILE');
equal(unsafeInitializeStoreReads, 0);
equal(unsafeInitializeFetches, 0);
equal(unsafeInitializeClipboard.readCount, 0);

const recheckStore = new MemoryStore();
const recheckClipboard = new MemoryClipboard(apiToken);
let primaryDestinationChecks = 0;
let recheckWrites = 0;
await rejects(() => initializeCloudflareStagingControlToken({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store: recheckStore,
  clipboard: recheckClipboard,
  fetchImpl: successfulFetch(),
  now,
  assertDestination: async (candidate) => {
    if (candidate === metadataPath) {
      primaryDestinationChecks += 1;
      if (primaryDestinationChecks === 2) {
        throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS');
      }
    }
  },
  writeMetadata: async () => { recheckWrites += 1; },
}), 'CLOUDFLARE_E_SIGNING_FILE_EXISTS');
equal(primaryDestinationChecks, 2);
equal(recheckStore.putCount, 1);
equal(recheckClipboard.readCount, 1);
equal(recheckWrites, 0);

let postWriteMetadataCalls = 0;
const mismatchingStore = new MemoryStore();
mismatchingStore.putCreateOnly = async function putCreateOnly(service, account, value) {
  this.putCount += 1;
  this.value = `${value.slice(0, -1)}A`;
};
const mismatchClipboard = new MemoryClipboard(apiToken);
await rejects(() => initializeCloudflareStagingControlToken({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store: mismatchingStore, clipboard: mismatchClipboard,
  fetchImpl: successfulFetch(), now,
  assertDestination: async () => undefined,
  writeMetadata: async () => { postWriteMetadataCalls += 1; },
}), 'CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
equal(postWriteMetadataCalls, 0);
equal(mismatchClipboard.readCount, 1);
equal(mismatchClipboard.value, '');

let recoveredDestination = null;
const recovered = await recoverCloudflareStagingControlTokenMetadata({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store, fetchImpl: successfulFetch(), now,
  assertDestination: async (candidate) => {
    if (candidate === metadataPath) throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS');
  },
  readFile: async (candidate) => candidate === metadataPath
    ? Buffer.alloc(0) : Buffer.from(canonicalStoredMetadata),
  writeMetadata: async (candidate) => { recoveredDestination = candidate; },
});
equal(recoveredDestination, recoveryPath);
equal(recovered.apiTokenSha256, apiTokenSha256);
await rejects(() => recoverCloudflareStagingControlTokenMetadata({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store: {
    async get() { throw new Error('TEST_E_UNEXPECTED_STORE'); },
  },
  fetchImpl: async () => { throw new Error('TEST_E_UNEXPECTED_FETCH'); }, now,
  assertDestination: async () => { throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS'); },
  readFile: async () => Buffer.alloc(0),
}), 'CLOUDFLARE_E_STAGING_CONTROL_RECOVERY_EXHAUSTED');

let validCollisionStoreReads = 0;
let validCollisionFetches = 0;
await rejects(() => recoverCloudflareStagingControlTokenMetadata({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store: { async get() { validCollisionStoreReads += 1; return store.value; } },
  fetchImpl: async () => { validCollisionFetches += 1; throw new Error('TEST_E_FETCH'); },
  now,
  assertDestination: async (candidate) => {
    if (candidate === metadataPath) throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS');
  },
  readFile: async () => Buffer.from(canonicalStoredMetadata),
}), 'CLOUDFLARE_E_STAGING_CONTROL_EXISTS');
equal(validCollisionStoreReads, 0);
equal(validCollisionFetches, 0);

let unsafeRecoveryStoreReads = 0;
let unsafeRecoveryFetches = 0;
let unsafeRecoveryWrites = 0;
await rejects(() => recoverCloudflareStagingControlTokenMetadata({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataOutput: metadataPath,
  store: { async get() { unsafeRecoveryStoreReads += 1; return store.value; } },
  fetchImpl: async () => { unsafeRecoveryFetches += 1; throw new Error('TEST_E_FETCH'); },
  now,
  assertDestination: async (candidate) => {
    if (candidate === metadataPath) throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS');
    throw new Error('CLOUDFLARE_E_SIGNING_FILE');
  },
  readFile: async () => Buffer.alloc(0),
  writeMetadata: async () => { unsafeRecoveryWrites += 1; },
}), 'CLOUDFLARE_E_SIGNING_FILE');
equal(unsafeRecoveryStoreReads, 0);
equal(unsafeRecoveryFetches, 0);
equal(unsafeRecoveryWrites, 0);

const syntheticPolicy = Object.freeze({ staging: Object.freeze({
  environment: 'staging', bucket: 'dwnc-me-public-media-staging', accountIdSha256,
}) });
const managerMetadataPath = '/private/tmp/dwnc-manager-fixture/token.json';
const managerResult = await manageCloudflareStagingControlToken({
  argv: ['--mode=inspect'], environment: {}, root: process.cwd(),
  accountTargetMetadataPath: '/private/tmp/dwnc-manager-fixture/account.json',
  metadataPath: managerMetadataPath,
  loadPolicy: async () => syntheticPolicy,
  loadAccountTarget: async () => ({ accountId, metadata: { accountIdSha256 } }),
  load: async () => ({ metadata, apiToken }),
  now,
});
equal(managerResult.apiTokenSha256, apiTokenSha256);
equal(managerResult.rawAccountPrinted, false);
equal(managerResult.rawTokenPrinted, false);
equal(managerResult.rawTokenIdPrinted, false);
equal(JSON.stringify(managerResult).includes(apiToken), false);
equal(JSON.stringify(managerResult).includes(tokenId), false);
equal(JSON.stringify(managerResult).includes(accountId), false);
let managerPolicyReads = 0;
await rejects(() => manageCloudflareStagingControlToken({
  argv: ['--mode=inspect'], environment: { CLOUDFLARE_API_TOKEN: apiToken },
  root: process.cwd(), metadataPath: managerMetadataPath,
  loadPolicy: async () => { managerPolicyReads += 1; return syntheticPolicy; },
}), 'CLOUDFLARE_E_STAGING_CONTROL_PARENT_CREDENTIAL');
equal(managerPolicyReads, 0);
let insideRepositoryPolicyReads = 0;
await rejects(() => manageCloudflareStagingControlToken({
  argv: ['--mode=inspect'], environment: {}, root: process.cwd(),
  metadataPath: path.join(process.cwd(), 'staging-control-token.json'),
  loadPolicy: async () => { insideRepositoryPolicyReads += 1; return syntheticPolicy; },
}), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
equal(insideRepositoryPolicyReads, 0);

let expiredStoreReads = 0;
await rejects(() => loadCloudflareStagingControlToken({
  accountId, expectedAccountIdSha256: accountIdSha256, metadataPath,
  store: { async get() { expiredStoreReads += 1; return store.value; } },
  now: new Date('2026-08-28T06:30:00.001Z'),
  readFile: async () => Buffer.from(canonicalStoredMetadata),
}), 'CLOUDFLARE_E_STAGING_CONTROL_TIME');
equal(expiredStoreReads, 0);

const auth = Object.freeze({
  root: '/private/tmp/dwnc-auth-fixture',
  home: '/private/tmp/dwnc-auth-fixture/home',
  xdgConfig: '/private/tmp/dwnc-auth-fixture/config',
  xdgCache: '/private/tmp/dwnc-auth-fixture/cache',
  xdgData: '/private/tmp/dwnc-auth-fixture/data',
  temporary: '/private/tmp/dwnc-auth-fixture/tmp',
  envFile: '/private/tmp/dwnc-auth-fixture/empty.env',
});
const metadataSha256 = createHash('sha256').update(canonicalJson(metadata)).digest('hex');
const preflightSha256 = 'f'.repeat(64);
const envelope = {
  PATH: '/usr/bin:/bin',
  HOME: auth.home,
  XDG_CONFIG_HOME: auth.xdgConfig,
  XDG_CACHE_HOME: auth.xdgCache,
  XDG_DATA_HOME: auth.xdgData,
  TMPDIR: auth.temporary,
  TMP: auth.temporary,
  TEMP: auth.temporary,
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN_FD: '3',
  CLOUDFLARE_STAGING_CONTROL_VERIFIED: 'v1',
  CLOUDFLARE_STAGING_CONTROL_OPERATION: 'staging-workers-dev-status',
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
};
equal(assertStagingControlOperationEnvelope(
  envelope, 'staging-workers-dev-status',
).apiTokenSha256, apiTokenSha256);
const operation = readCloudflareStagingControlOperation(
  envelope, 'staging-workers-dev-status', {
    readCredentials: () => ({ accountId, apiToken, environment: {} }),
  },
);
const finalWranglerEnvironment = operation.wranglerEnvironment();
equal(finalWranglerEnvironment.CLOUDFLARE_API_TOKEN, apiToken);
equal(finalWranglerEnvironment.CLOUDFLARE_ACCOUNT_ID, accountId);
equal(finalWranglerEnvironment.HOME, auth.home);
equal(finalWranglerEnvironment.XDG_CONFIG_HOME, auth.xdgConfig);
equal(finalWranglerEnvironment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false');
equal(finalWranglerEnvironment.WRANGLER_SEND_METRICS, 'false');
equal(Object.hasOwn(finalWranglerEnvironment, 'CLOUDFLARE_API_TOKEN_FD'), false);
equal(Object.hasOwn(finalWranglerEnvironment, 'CLOUDFLARE_STAGING_CONTROL_VERIFIED'), false);
equal(cloudflareStagingWranglerEnvironment({ ...envelope, PATH: '/private/tmp/fake-node' }, {
  accountId, apiToken,
}, { expectedOperation: 'staging-workers-dev-status' }).PATH, '/usr/bin:/bin');
for (const protectedName of [
  'PATH', 'TMPDIR', 'TMP', 'TEMP', 'NODE_OPTIONS', 'HOME', 'XDG_CONFIG_HOME',
  'WRANGLER_WRITE_LOGS', 'WRANGLER_SEND_METRICS', 'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_STAGING_CONTROL_AUTH_ROOT',
]) {
  assert.throws(
    () => operation.wranglerEnvironment({ [protectedName]: '/private/tmp/poison' }),
    /CLOUDFLARE_E_STAGING_CONTROL_WRANGLER/u,
  );
  assertions += 1;
}
operation.clear();
equal(operation.apiToken, '');
assert.throws(() => operation.wranglerEnvironment(),
  /CLOUDFLARE_E_STAGING_CONTROL_WRANGLER/u);
assertions += 1;

const sealedCredentialFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
let sealedReadOffset = 0;
let sealedReadBuffer = null;
const readCredentials = cloudflareControlPlaneReadCredentials({
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN_FD: '3',
}, {
  fstat: () => ({
    isFIFO: () => true, isSocket: () => false, nlink: 0, mode: 0o600,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0, size: 0,
  }),
  read: (descriptor, target, offset, length) => {
    sealedReadBuffer = target;
    if (sealedReadOffset >= sealedCredentialFrame.length) return 0;
    const count = Math.min(length, 7, sealedCredentialFrame.length - sealedReadOffset);
    sealedCredentialFrame.copy(target, offset, sealedReadOffset, sealedReadOffset + count);
    sealedReadOffset += count;
    return count;
  },
});
equal(readCredentials.apiToken, apiToken);
equal(sealedReadOffset, sealedCredentialFrame.length);
equal(sealedReadBuffer.every((byte) => byte === 0), true);
readCredentials.apiToken = '';
sealedCredentialFrame.fill(0);
assert.throws(() => cloudflareStagingWranglerEnvironment({
  ...envelope, CLOUDFLARE_API_TOKEN: apiToken,
}, { accountId, apiToken }, { expectedOperation: 'staging-workers-dev-status' }),
/CLOUDFLARE_E_STAGING_CONTROL_ENVELOPE/u);
assertions += 1;
assert.throws(() => readCloudflareStagingControlOperation(
  envelope, 'staging-workers-dev-status', {
    readCredentials: () => ({
      accountId, apiToken: `cfat_${'W'.repeat(40)}${'1'.repeat(8)}`, environment: {},
    }),
  },
), /CLOUDFLARE_E_STAGING_CONTROL_BINDING/u);
assertions += 1;

let runnerPolicyReads = 0;
let runnerTokenReads = 0;
let runnerSpawns = 0;
for (const command of [
  'staging-version-upload', 'staging-version-detail', 'staging-deployment-status',
  'staging-activate', 'staging-workers-dev-enable',
]) {
  await rejects(() => runCloudflareStagingControl({
    argv: [`--command=${command}`], environment: {}, root: process.cwd(),
    loadPolicy: async () => { runnerPolicyReads += 1; return syntheticPolicy; },
    loadControlToken: async () => { runnerTokenReads += 1; return {}; },
    spawnChild: () => { runnerSpawns += 1; throw new Error('TEST_E_UNEXPECTED_SPAWN'); },
  }), 'CLOUDFLARE_E_STAGING_CONTROL_NOT_INTEGRATED');
}
equal(runnerPolicyReads, 0);
equal(runnerTokenReads, 0);
equal(runnerSpawns, 0);
await rejects(() => runCloudflareStagingControl({
  argv: ['--command=production-deploy'], environment: {}, root: process.cwd(),
}), 'CLOUDFLARE_E_STAGING_CONTROL_ALLOWLIST');

const statusEnvironment = {
  PATH: '/private/tmp/dwnc-poisoned-path',
  CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH: '/private/tmp/status-capture.json',
  CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH: '/private/tmp/status-evidence.json',
};
const pinnedWrangler = await assertPinnedWranglerEntrypointInstalled(process.cwd());
equal(pinnedWrangler.version, '4.125.0');
equal(pinnedWrangler.cli,
  path.join(process.cwd(), 'node_modules/wrangler/wrangler-dist/cli.js'));
equal(pinnedWrangler.cliSize, 20_524_522);
equal(pinnedWrangler.cliSha256,
  '8642ffb286871a94617969aa64d351097a49783361834d8c4aec75adbddfa773');
equal(pinnedWrangler.runtimeFileCount, 660);
equal(pinnedWrangler.runtimeBytes, 207_434_085);
const versionFixtureRoot = await mkdtemp('/private/tmp/dwnc-wrangler-version-');
await chmod(versionFixtureRoot, 0o700);
const versionAuthRoot = path.join(versionFixtureRoot, 'auth');
const ambientNodeModules = path.join(versionFixtureRoot, 'node_modules');
const ambientLoadMarker = path.join(versionFixtureRoot, 'ambient-loaded');
await Promise.all([
  mkdir(versionAuthRoot, { mode: 0o700 }),
  ...['bufferutil', 'utf-8-validate', 'dwnc-ambient-trap'].map(async (name) => {
    const directory = path.join(ambientNodeModules, name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, 'index.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(ambientLoadMarker)}, 'loaded');\n`,
      { flag: 'wx', mode: 0o600 });
  }),
]);
try {
  const sealedVersionWrangler = await sealPinnedWranglerRuntime(
    pinnedWrangler, versionAuthRoot, process.cwd(),
  );
  const isolatedWranglerEnvironment = {
    PATH: '/usr/bin:/bin', HOME: versionAuthRoot, TMPDIR: versionAuthRoot,
    TMP: versionAuthRoot, TEMP: versionAuthRoot, XDG_CONFIG_HOME: versionAuthRoot,
    XDG_CACHE_HOME: versionAuthRoot, XDG_DATA_HOME: versionAuthRoot,
    WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false',
    WRANGLER_WRITE_LOGS: '0', WS_NO_BUFFER_UTIL: '1', WS_NO_UTF_8_VALIDATE: '1',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', CI: '1', NO_COLOR: '1',
  };
  const sealedNodePrefix = [
    '--no-warnings', '--permission',
    `--allow-fs-read=${versionAuthRoot}`, `--allow-fs-write=${versionAuthRoot}`,
    '--require', sealedVersionWrangler.guard,
  ];
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    ...sealedNodePrefix, sealedVersionWrangler.cli, '--version',
  ], {
    cwd: versionAuthRoot,
    env: isolatedWranglerEnvironment,
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  equal(stdout.trim(), '4.125.0');
  equal(stderr, '');
  const emptyEnvironmentFile = path.join(versionAuthRoot, 'empty.env');
  await writeFile(emptyEnvironmentFile, '', { flag: 'wx', mode: 0o600 });
  let whoamiError;
  try {
    await promisify(execFile)(process.execPath, [
      ...sealedNodePrefix, sealedVersionWrangler.cli,
      'whoami', '--json', '--env-file', emptyEnvironmentFile,
    ], {
      cwd: versionAuthRoot, env: isolatedWranglerEnvironment,
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    });
  } catch (error) { whoamiError = error; }
  equal(whoamiError?.code, 1);
  equal(JSON.parse(whoamiError.stdout.trim()), { loggedIn: false });
  equal(whoamiError.stderr, '');
  const ambientProbe = path.join(versionAuthRoot, 'sealed-wrangler/ambient-probe.cjs');
  await writeFile(ambientProbe,
    `'use strict';\ntry { require('dwnc-ambient-trap'); process.exitCode = 9; }\n`
      + `catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_ACCESS_DENIED'].includes(error.code)) throw error; process.stdout.write('BLOCKED\\n'); }\n`,
    { flag: 'wx', mode: 0o400 });
  const probe = await promisify(execFile)(process.execPath, [
    ...sealedNodePrefix, ambientProbe,
  ], {
    cwd: versionAuthRoot, env: isolatedWranglerEnvironment,
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  equal(probe.stdout, 'BLOCKED\n');
  equal(probe.stderr, '');
  await assert.rejects(() => readFile(ambientLoadMarker), { code: 'ENOENT' });
  assertions += 1;
} finally { await rm(versionFixtureRoot, { recursive: true, force: true }); }
async function makeWranglerPinFixture(entrypointMode) {
  const outerRoot = await mkdtemp('/private/tmp/dwnc-wrangler-pin-');
  await chmod(outerRoot, 0o700);
  const sealed = await sealPinnedWranglerRuntime(pinnedWrangler, outerRoot, process.cwd());
  const fixtureRoot = path.join(outerRoot, 'sealed-wrangler');
  const fixturePackageRoot = path.join(fixtureRoot, 'node_modules/wrangler');
  await Promise.all([
    copyFile('package.json', path.join(fixtureRoot, 'package.json')),
    copyFile('package-lock.json', path.join(fixtureRoot, 'package-lock.json')),
    copyFile('node_modules/wrangler/package.json', path.join(fixturePackageRoot, 'package.json')),
  ]);
  const fixtureEntrypoint = sealed.cli;
  if (entrypointMode === 'symlink') {
    await rm(fixtureEntrypoint);
    await symlink(pinnedWrangler.cli, fixtureEntrypoint);
  } else if (entrypointMode === 'altered') {
    const altered = await readFile(fixtureEntrypoint);
    altered[0] ^= 0x01;
    try {
      await chmod(fixtureEntrypoint, 0o600);
      await writeFile(fixtureEntrypoint, altered);
      await chmod(fixtureEntrypoint, 0o400);
    }
    finally { altered.fill(0); }
  }
  return { fixtureRoot, outerRoot };
}
for (const [entrypointMode, expectedCode] of [
  ['symlink', 'CLOUDFLARE_E_WRANGLER_REQUIRED'],
  ['altered', 'CLOUDFLARE_E_WRANGLER_VERSION'],
]) {
  const { fixtureRoot, outerRoot } = await makeWranglerPinFixture(entrypointMode);
  try {
    await rejects(() => assertPinnedWranglerEntrypointInstalled(fixtureRoot), expectedCode);
  } finally { await rm(outerRoot, { recursive: true, force: true }); }
}
const swapFixture = await makeWranglerPinFixture('valid');
const swapSealRoot = await mkdtemp('/private/tmp/dwnc-wrangler-swap-seal-');
await chmod(swapSealRoot, 0o700);
try {
  const verifiedBeforeSwap = await assertPinnedWranglerEntrypointInstalled(
    swapFixture.fixtureRoot,
  );
  const altered = await readFile(verifiedBeforeSwap.cli);
  altered[0] ^= 0x01;
  try {
    await chmod(verifiedBeforeSwap.cli, 0o600);
    await writeFile(verifiedBeforeSwap.cli, altered);
    await chmod(verifiedBeforeSwap.cli, 0o400);
  } finally { altered.fill(0); }
  await rejects(() => sealPinnedWranglerRuntime(
    verifiedBeforeSwap, swapSealRoot, swapFixture.fixtureRoot,
  ), 'CLOUDFLARE_E_WRANGLER_VERSION');
} finally {
  await rm(swapSealRoot, { recursive: true, force: true });
  await rm(swapFixture.outerRoot, { recursive: true, force: true });
}
const syntheticSealedWrangler = Object.freeze({
  version: pinnedWrangler.version,
  cli: path.join(auth.root,
    'sealed-wrangler/node_modules/wrangler/wrangler-dist/cli.js'),
  cliSize: pinnedWrangler.cliSize,
  cliSha256: pinnedWrangler.cliSha256,
  runtimeFileCount: pinnedWrangler.runtimeFileCount,
  runtimeBytes: pinnedWrangler.runtimeBytes,
  runtimeSha256: pinnedWrangler.runtimeSha256,
  guard: path.join(auth.root, 'sealed-wrangler/resolution-guard.cjs'),
  guardBytes: 946,
  guardSha256: '49eb9466fe48a6b9ce55414933fc9034181d54107ea43626888858b6f0303416',
});
let parentCredentialPolicyReads = 0;
await rejects(() => runCloudflareStagingControl({
  argv: ['--command=staging-workers-dev-status'],
  environment: { ...statusEnvironment, CLOUDFLARE_API_TOKEN: apiToken },
  root: process.cwd(),
  loadPolicy: async () => { parentCredentialPolicyReads += 1; return syntheticPolicy; },
}), 'CLOUDFLARE_E_STAGING_CONTROL_PARENT_CREDENTIAL');
equal(parentCredentialPolicyReads, 0);

let occupiedOutputPolicyReads = 0;
let occupiedOutputTokenReads = 0;
await rejects(() => runCloudflareStagingControl({
  argv: ['--command=staging-workers-dev-status'], environment: statusEnvironment,
  root: process.cwd(),
  accountTargetMetadataPath: '/private/tmp/dwnc-runner/account.json',
  tokenMetadataPath: '/private/tmp/dwnc-runner/token.json',
  assertDestination: async () => { throw new Error('CLOUDFLARE_E_SIGNING_FILE_EXISTS'); },
  loadPolicy: async () => { occupiedOutputPolicyReads += 1; return syntheticPolicy; },
  loadControlToken: async () => { occupiedOutputTokenReads += 1; return {}; },
}), 'CLOUDFLARE_E_SIGNING_FILE_EXISTS');
equal(occupiedOutputPolicyReads, 0);
equal(occupiedOutputTokenReads, 0);

let swapSealTokenReads = 0;
let swapSealWhoamiProcesses = 0;
let swapSealTokenChildren = 0;
let swapSealCleanupCount = 0;
await rejects(() => runCloudflareStagingControl({
  argv: ['--command=staging-workers-dev-status'], environment: statusEnvironment,
  root: process.cwd(),
  accountTargetMetadataPath: '/private/tmp/dwnc-runner/account.json',
  tokenMetadataPath: '/private/tmp/dwnc-runner/token.json',
  loadPolicy: async () => syntheticPolicy,
  loadAccountTarget: async () => ({ accountId, metadata: { accountIdSha256 } }),
  requireWrangler: async () => pinnedWrangler,
  sealWrangler: async () => { throw new Error('CLOUDFLARE_E_WRANGLER_VERSION'); },
  loadControlToken: async () => { swapSealTokenReads += 1; return { metadata, apiToken }; },
  execWrangler: async () => { swapSealWhoamiProcesses += 1; return {}; },
  spawnChild: () => { swapSealTokenChildren += 1; return {}; },
  assertDestination: async () => undefined,
  createAuth: async () => auth,
  cleanupAuth: async () => { swapSealCleanupCount += 1; },
  now,
}), 'CLOUDFLARE_E_WRANGLER_VERSION');
equal(swapSealTokenReads, 0);
equal(swapSealWhoamiProcesses, 0);
equal(swapSealTokenChildren, 0);
equal(swapSealCleanupCount, 1);

let requireWranglerCount = 0;
let loadTokenCount = 0;
let verifyCount = 0;
let whoamiCount = 0;
let cleanupCount = 0;
let spawned = null;
const runnerLoadedToken = { metadata, apiToken };
const frameChunks = [];
const spawnChild = (command, args, options) => {
  runnerSpawns += 1;
  const child = new EventEmitter();
  const pipe = new PassThrough();
  pipe.on('data', (chunk) => frameChunks.push(Buffer.from(chunk)));
  pipe.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
  child.stdio = [null, null, null, pipe];
  child.kill = () => undefined;
  spawned = { command, args, options };
  return child;
};
let whoamiOptions;
let whoamiSawToken = false;
const runnerResult = await runCloudflareStagingControl({
  argv: ['--command=staging-workers-dev-status'],
  environment: { ...statusEnvironment, UNRELATED_SECRET: 'do-not-copy' },
  root: process.cwd(),
  accountTargetMetadataPath: '/private/tmp/dwnc-runner/account.json',
  tokenMetadataPath: '/private/tmp/dwnc-runner/token.json',
  loadPolicy: async () => syntheticPolicy,
  loadAccountTarget: async () => ({ accountId, metadata: { accountIdSha256 } }),
  requireWrangler: async () => { requireWranglerCount += 1; return pinnedWrangler; },
  sealWrangler: async () => syntheticSealedWrangler,
  loadControlToken: async () => {
    loadTokenCount += 1;
    return runnerLoadedToken;
  },
  verifyControlToken: async () => { verifyCount += 1; return verification; },
  execWrangler: async (command, args, options) => {
    whoamiCount += 1;
    whoamiSawToken = options.env.CLOUDFLARE_API_TOKEN === apiToken;
    whoamiOptions = { command, args, options };
    return { stdout: JSON.stringify({
      loggedIn: true,
      authType: 'Account API Token',
      accounts: [{ id: accountId, name: 'Synthetic account' }],
      tokenPermissions: [],
    }) };
  },
  spawnChild,
  assertDestination: async () => undefined,
  createAuth: async () => auth,
  cleanupAuth: async () => { cleanupCount += 1; },
  now,
});
equal(requireWranglerCount, 1);
equal(loadTokenCount, 1);
equal(verifyCount, 1);
equal(whoamiCount, 1);
equal(runnerSpawns, 1);
equal(cleanupCount, 1);
equal(whoamiOptions.command, process.execPath);
equal(whoamiOptions.args, [
  '--no-warnings', '--permission',
  `--allow-fs-read=${auth.root}`, `--allow-fs-write=${auth.root}`,
  '--require', syntheticSealedWrangler.guard, syntheticSealedWrangler.cli,
  'whoami', '--json', '--env-file', auth.envFile,
]);
equal(whoamiOptions.options.cwd, auth.root);
equal(whoamiSawToken, true);
equal(whoamiOptions.options.env.CLOUDFLARE_API_TOKEN, '');
equal(runnerLoadedToken.apiToken, '');
equal(whoamiOptions.options.env.CLOUDFLARE_ACCOUNT_ID, accountId);
equal(whoamiOptions.options.env.HOME, auth.home);
equal(whoamiOptions.options.env.WRANGLER_WRITE_LOGS, '0');
equal(whoamiOptions.options.env.WS_NO_BUFFER_UTIL, '1');
equal(whoamiOptions.options.env.WS_NO_UTF_8_VALIDATE, '1');
equal(whoamiOptions.options.env.PATH, '/usr/bin:/bin');
equal(Object.hasOwn(whoamiOptions.options.env, 'CLOUDFLARE_API_TOKEN_FD'), false);
equal(spawned.args, [
  path.join(process.cwd(), 'scripts/fetch-cloudflare-staging-workers-dev-status.mjs'),
]);
equal(Object.values(spawned.options.env).includes(apiToken), false);
equal(Object.values(spawned.options.env).includes('do-not-copy'), false);
equal(spawned.options.env.CLOUDFLARE_API_TOKEN_FD, '3');
equal(spawned.options.env.CLOUDFLARE_STAGING_CONTROL_VERIFIED, 'v1');
equal(spawned.options.env.CLOUDFLARE_STAGING_CONTROL_TOKEN_SHA256, apiTokenSha256);
equal(spawned.options.env.CLOUDFLARE_STAGING_CONTROL_ACCOUNT_SHA256, accountIdSha256);
equal(spawned.options.env.CLOUDFLARE_STAGING_CONTROL_PERMISSION_SHA256,
  permissionContractSha256);
equal(spawned.options.env.HOME, auth.home);
equal(spawned.options.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false');
equal(spawned.options.env.CLOUDFLARE_INCLUDE_PROCESS_ENV, 'false');
equal(runnerResult.oauthFallbackPossible, false);
equal(runnerResult.rawTokenPrinted, false);
equal(JSON.stringify(runnerResult).includes(apiToken), false);
equal(JSON.stringify(runnerResult).includes(tokenId), false);
equal(JSON.stringify(runnerResult).includes(accountId), false);
equal(Buffer.concat(frameChunks).includes(Buffer.from(apiToken)), true);
for (const chunk of frameChunks) chunk.fill(0);

function lifecycleRunnerOptions(spawnChildOverride, cleanupEvents, overrides = {}) {
  return {
    argv: ['--command=staging-workers-dev-status'],
    environment: statusEnvironment,
    root: process.cwd(),
    accountTargetMetadataPath: '/private/tmp/dwnc-runner/account.json',
    tokenMetadataPath: '/private/tmp/dwnc-runner/token.json',
    loadPolicy: async () => syntheticPolicy,
    loadAccountTarget: async () => ({ accountId, metadata: { accountIdSha256 } }),
    requireWrangler: async () => pinnedWrangler,
    sealWrangler: async () => syntheticSealedWrangler,
    loadControlToken: async () => ({ metadata, apiToken }),
    verifyControlToken: async () => verification,
    execWrangler: async () => ({ stdout: JSON.stringify({
      loggedIn: true,
      authType: 'Account API Token',
      accounts: [{ id: accountId, name: 'Synthetic account' }],
    }) }),
    spawnChild: spawnChildOverride,
    assertDestination: async () => undefined,
    createAuth: async () => auth,
    cleanupAuth: async () => { cleanupEvents.push('cleanup'); },
    now,
    ...overrides,
  };
}

const spawnFailureEvents = [];
await rejects(() => runCloudflareStagingControl(lifecycleRunnerOptions(
  () => {
    spawnFailureEvents.push('spawn-throw');
    throw new Error('synthetic spawn failure');
  }, spawnFailureEvents,
)), 'CLOUDFLARE_E_STAGING_CONTROL_CHILD');
equal(spawnFailureEvents, ['spawn-throw', 'cleanup']);

const noPipeEvents = [];
const noPipeSignals = [];
await rejects(() => runCloudflareStagingControl(lifecycleRunnerOptions(
  () => {
    const child = new EventEmitter();
    child.stdio = [null, null, null, null];
    child.kill = (signal) => {
      noPipeSignals.push(signal);
      noPipeEvents.push(`kill:${signal}`);
      queueMicrotask(() => {
        noPipeEvents.push('close');
        child.emit('close', null, signal);
      });
      return true;
    };
    return child;
  }, noPipeEvents,
)), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');
equal(noPipeSignals, ['SIGTERM']);
equal(noPipeEvents, ['kill:SIGTERM', 'close', 'cleanup']);

const delayedCloseEvents = [];
const delayedCloseSignals = [];
await rejects(() => runCloudflareStagingControl(lifecycleRunnerOptions(
  () => {
    const child = new EventEmitter();
    child.stdio = [null, null, null, null];
    child.kill = (signal) => {
      delayedCloseSignals.push(signal);
      delayedCloseEvents.push(`kill:${signal}`);
      queueMicrotask(() => {
        delayedCloseEvents.push('exit');
        child.emit('exit', null, signal);
        setTimeout(() => {
          delayedCloseEvents.push('close');
          child.emit('close', null, signal);
        }, 2);
      });
      return true;
    };
    return child;
  }, delayedCloseEvents, {
    childTerminationTimeoutMs: 20,
    childForceKillTimeoutMs: 20,
  },
)), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');
equal(delayedCloseSignals, ['SIGTERM']);
equal(delayedCloseEvents, ['kill:SIGTERM', 'exit', 'close', 'cleanup']);

const partialWriteEvents = [];
const partialWriteSignals = [];
let partialTokenBytes = null;
let partialPipe = null;
await rejects(() => runCloudflareStagingControl(lifecycleRunnerOptions(
  () => {
    const child = new EventEmitter();
    partialPipe = new Writable({
      write(chunk, encoding, callback) {
        partialTokenBytes = Buffer.from(chunk.subarray(0, Math.min(70, chunk.length)));
        callback(new Error('synthetic pipe failure'));
      },
    });
    child.stdio = [null, null, null, partialPipe];
    child.kill = (signal) => {
      partialWriteSignals.push(signal);
      partialWriteEvents.push(`kill:${signal}`);
      queueMicrotask(() => {
        partialWriteEvents.push('close');
        child.emit('close', null, signal);
      });
      return true;
    };
    return child;
  }, partialWriteEvents,
)), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');
equal(partialWriteSignals, ['SIGTERM']);
equal(partialWriteEvents, ['kill:SIGTERM', 'close', 'cleanup']);
equal(partialPipe.destroyed, true);
equal(partialTokenBytes.length > 0, true);
partialTokenBytes.fill(0);

const escalationEvents = [];
const escalationSignals = [];
await rejects(() => runCloudflareStagingControl(lifecycleRunnerOptions(
  () => {
    const child = new EventEmitter();
    const pipe = new PassThrough();
    pipe.resume();
    child.stdio = [null, null, null, pipe];
    child.kill = (signal) => {
      escalationSignals.push(signal);
      escalationEvents.push(`kill:${signal}`);
      if (signal === 'SIGKILL') queueMicrotask(() => {
        escalationEvents.push('close');
        child.emit('close', null, signal);
      });
      return true;
    };
    return child;
  }, escalationEvents, {
    childExecutionTimeoutMs: 5,
    childTerminationTimeoutMs: 5,
    childForceKillTimeoutMs: 20,
  },
)), 'CLOUDFLARE_E_STAGING_CONTROL_CHILD');
equal(escalationSignals, ['SIGTERM', 'SIGKILL']);
equal(escalationEvents, ['kill:SIGTERM', 'kill:SIGKILL', 'close', 'cleanup']);

const permanentHangEvents = [];
const permanentHangSignals = [];
await rejects(() => runCloudflareStagingControl(lifecycleRunnerOptions(
  () => {
    const child = new EventEmitter();
    const pipe = new PassThrough();
    pipe.resume();
    child.stdio = [null, null, null, pipe];
    child.kill = (signal) => {
      permanentHangSignals.push(signal);
      permanentHangEvents.push(`kill:${signal}`);
      return true;
    };
    return child;
  }, permanentHangEvents, {
    childExecutionTimeoutMs: 5,
    childTerminationTimeoutMs: 5,
    childForceKillTimeoutMs: 5,
  },
)), 'CLOUDFLARE_E_STAGING_CONTROL_CHILD_LIFECYCLE');
equal(permanentHangSignals, ['SIGTERM', 'SIGKILL']);
equal(permanentHangEvents, ['kill:SIGTERM', 'kill:SIGKILL', 'cleanup']);

let wrongWhoamiSpawnCount = 0;
let wrongWhoamiCleanupCount = 0;
await rejects(() => runCloudflareStagingControl({
  argv: ['--command=staging-workers-dev-status'], environment: statusEnvironment,
  root: process.cwd(),
  accountTargetMetadataPath: '/private/tmp/dwnc-runner/account.json',
  tokenMetadataPath: '/private/tmp/dwnc-runner/token.json',
  loadPolicy: async () => syntheticPolicy,
  loadAccountTarget: async () => ({ accountId, metadata: {} }),
  requireWrangler: async () => pinnedWrangler,
  sealWrangler: async () => syntheticSealedWrangler,
  loadControlToken: async () => ({ metadata, apiToken }),
  verifyControlToken: async () => verification,
  execWrangler: async () => ({ stdout: JSON.stringify({
    loggedIn: true, authType: 'OAuth Token',
    accounts: [{ id: accountId, name: 'Synthetic account' }],
  }) }),
  spawnChild: () => { wrongWhoamiSpawnCount += 1; throw new Error('TEST_E_UNEXPECTED'); },
  assertDestination: async () => undefined,
  createAuth: async () => auth,
  cleanupAuth: async () => { wrongWhoamiCleanupCount += 1; },
  now,
}), 'CLOUDFLARE_E_STAGING_CONTROL_WHOAMI');
equal(wrongWhoamiSpawnCount, 0);
equal(wrongWhoamiCleanupCount, 1);

let failedPreflightWhoamiCount = 0;
let failedPreflightSpawnCount = 0;
await rejects(() => runCloudflareStagingControl({
  argv: ['--command=staging-workers-dev-status'], environment: statusEnvironment,
  root: process.cwd(),
  accountTargetMetadataPath: '/private/tmp/dwnc-runner/account.json',
  tokenMetadataPath: '/private/tmp/dwnc-runner/token.json',
  loadPolicy: async () => syntheticPolicy,
  loadAccountTarget: async () => ({ accountId, metadata: {} }),
  requireWrangler: async () => pinnedWrangler,
  sealWrangler: async () => syntheticSealedWrangler,
  loadControlToken: async () => ({ metadata, apiToken }),
  verifyControlToken: async () => { throw new Error('CLOUDFLARE_E_STAGING_CONTROL_VERIFY'); },
  execWrangler: async () => { failedPreflightWhoamiCount += 1; return {}; },
  spawnChild: () => { failedPreflightSpawnCount += 1; return {}; },
  assertDestination: async () => undefined,
  createAuth: async () => auth,
  cleanupAuth: async () => undefined,
  now,
}), 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
equal(failedPreflightWhoamiCount, 0);
equal(failedPreflightSpawnCount, 0);

let serviceClearCount = 0;
let serviceFetchAfterPolicyFailure = 0;
const serviceControlPlane = {
  accountId,
  apiToken,
  clear() { serviceClearCount += 1; this.apiToken = ''; },
};
await rejects(() => fetchCloudflareServiceExistence({
  argv: ['--environment=staging'],
  source: {
    CLOUDFLARE_SERVICE_EXISTENCE_EVIDENCE_PATH: '/private/tmp/service-evidence.json',
    CLOUDFLARE_SERVICE_EXISTENCE_CAPTURE_PATH: '/private/tmp/service-capture.json',
    CLOUDFLARE_ACCOUNT_SUBDOMAIN_EVIDENCE_PATH: '/private/tmp/subdomain-evidence.json',
    CLOUDFLARE_ACCOUNT_SUBDOMAIN_CAPTURE_PATH: '/private/tmp/subdomain-capture.json',
  },
  root: process.cwd(),
  assertDestination: async () => undefined,
  readStagingOperation: () => serviceControlPlane,
  loadPolicy: async () => { throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT'); },
  fetchService: async () => { serviceFetchAfterPolicyFailure += 1; return {}; },
  fetchSubdomain: async () => { serviceFetchAfterPolicyFailure += 1; return {}; },
}), 'CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');
equal(serviceClearCount, 1);
equal(serviceControlPlane.apiToken, '');
equal(serviceFetchAfterPolicyFailure, 0);

let workersDevClearCount = 0;
let workersDevFetchAfterHashFailure = 0;
const workersDevControlPlane = {
  accountId,
  apiToken,
  clear() { workersDevClearCount += 1; this.apiToken = ''; },
};
await rejects(() => fetchCloudflareStagingWorkersDevStatus({
  source: {
    CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH: '/private/tmp/status-capture.json',
    CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH: '/private/tmp/status-evidence.json',
  },
  root: process.cwd(),
  assertDestination: async () => undefined,
  readOperation: () => workersDevControlPlane,
  loadPolicy: async () => ({ staging: { accountIdSha256: 'f'.repeat(64) } }),
  fetchStatus: async () => { workersDevFetchAfterHashFailure += 1; return {}; },
}), 'CLOUDFLARE_E_ACCOUNT_TARGET');
equal(workersDevClearCount, 1);
equal(workersDevControlPlane.apiToken, '');
equal(workersDevFetchAfterHashFailure, 0);

const staleClipboard = new MemoryClipboard(apiToken);
let staleRunnerPolicyReads = 0;
let staleRunnerSpawns = 0;
await rejects(() => runCloudflareReadControlPlane({
  argv: ['--command=staging-workers-dev-status'],
  environment: {},
  root: process.cwd(),
  clipboard: staleClipboard,
  loadPolicy: async () => { staleRunnerPolicyReads += 1; return syntheticPolicy; },
  spawnChild: () => { staleRunnerSpawns += 1; return {}; },
}), 'CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
equal(staleClipboard.preflightCount, 0);
equal(staleClipboard.readCount, 0);
equal(staleRunnerPolicyReads, 0);
equal(staleRunnerSpawns, 0);

const [bootstrapSource, packageSource] =
  await Promise.all([
    readFile('scripts/bootstrap-cloudflare-service.mjs', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
const envelopePosition = bootstrapSource.indexOf('assertStagingControlOperationEnvelope(');
const recoveryStopPosition = bootstrapSource.indexOf('statusOnlyRecoveryImplemented');
const tokenReadPosition = bootstrapSource.indexOf('readCloudflareStagingControlOperation(');
equal(envelopePosition >= 0 && envelopePosition < recoveryStopPosition, true);
equal(tokenReadPosition > recoveryStopPosition, true);
equal(bootstrapSource.includes('wrangler deploy'), false);
const packageJson = JSON.parse(packageSource);
equal(Object.hasOwn(packageJson.scripts, 'cloudflare:r2:exposure:fetch:fd'), false);
equal(Object.hasOwn(packageJson.scripts, 'cloudflare:staging:workers-dev:status:fd'), false);
for (const scriptName of [
  'cloudflare:upload:staging-version',
  'cloudflare:staging:version:fetch',
  'cloudflare:staging:status:fetch',
  'cloudflare:staging:activate',
  'cloudflare:staging:workers-dev:status',
  'cloudflare:staging:workers-dev:enable',
]) {
  equal(packageJson.scripts[scriptName].startsWith(
    'node scripts/run-cloudflare-staging-control.mjs --command=',
  ), true);
  equal(packageJson.scripts[scriptName].includes('wrangler deploy'), false);
}

canonicalStoredMetadata.fill(0);
console.log(JSON.stringify({
  suite: 'cloudflare-staging-control-token-foundation',
  assertions,
  allowedPermission: 'Account Workers Scripts Edit only',
  maximumLifetimeHours: 48,
  minimumRemainingMinutes: 60,
  liveNetworkCalls,
  realKeychainCalls,
  realClipboardCalls,
  rawTokenPrinted: false,
  status: 'PASS',
}, null, 2));
