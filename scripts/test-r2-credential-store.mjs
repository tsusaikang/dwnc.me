import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod, link, lstat, mkdtemp, open, readFile, realpath, rm, symlink, unlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import { writeAnonymousInheritedInput } from './lib/cloudflare-process.mjs';
import {
  initializeR2CredentialFromClipboard,
  loadR2Credential,
  recoverR2CredentialMetadata,
  r2CredentialIdentity,
} from './lib/r2-credential-store.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';
import {
  r2CredentialsFromEnvironment,
  validateR2Credentials,
} from './lib/r2-s3-client.mjs';

class MemoryClipboard {
  constructor(value, { preflightError = null } = {}) {
    this.value = value;
    this.clearCount = 0;
    this.preflightCount = 0;
    this.readCount = 0;
    this.preflightError = preflightError;
  }
  async preflight() {
    this.preflightCount += 1;
    if (this.preflightError !== null) throw new Error(this.preflightError);
  }
  async clear() { this.value = ''; this.clearCount += 1; }
  async readAndClear() {
    const value = this.value;
    this.readCount += 1;
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
    if (this.values.has(key)) throw new Error('MEDIA_E_R2_CREDENTIAL_EXISTS');
    this.values.set(key, value);
  }
}

const credentials = Object.freeze({
  schemaVersion: 1,
  contract: 'dwnc-r2-s3-credentials-v1',
  accountId: 'a'.repeat(32),
  bucket: 'dwnc-me-public-media-staging',
  accessKeyId: 'b'.repeat(32),
  secretAccessKey: 'c'.repeat(64),
});
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const throws = (action, code) => {
  assert.throws(action, (error) => error?.code === code || error?.message === code);
  assertions += 1;
};
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.code === code || error?.message === code);
  assertions += 1;
};

async function runFdReader({ value = null, diskFd = null, extraEnvironment = {} } = {}) {
  const usePipe = diskFd === null;
  const child = spawn(process.execPath, ['scripts/test-r2-credential-fd-reader.mjs'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      R2_CREDENTIALS_FD: '3',
      ...extraEnvironment,
    },
    stdio: ['ignore', 'pipe', 'pipe', usePipe ? 'pipe' : diskFd],
  });
  const writePromise = usePipe
    ? writeAnonymousInheritedInput(child.stdio[3], value, { descriptor: 3, maximumBytes: 4096 })
    : Promise.resolve();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [, code] = await Promise.all([writePromise, new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  })]);
  const output = `${stdout}\n${stderr}`;
  equal(output.includes(credentials.accountId), false);
  equal(output.includes(credentials.accessKeyId), false);
  equal(output.includes(credentials.secretAccessKey), false);
  return { code, stdout, stderr };
}

validateR2Credentials(credentials);
assertions += 1;
throws(() => validateR2Credentials({ ...credentials, accountId: 'g'.repeat(32) }),
  'MEDIA_E_R2_ACCOUNT_ID');
throws(() => validateR2Credentials({ ...credentials, accessKeyId: 'b'.repeat(31) }),
  'MEDIA_E_R2_ACCESS_KEY_ID');
throws(() => validateR2Credentials({ ...credentials, secretAccessKey: 'c'.repeat(63) }),
  'MEDIA_E_R2_SECRET_ACCESS_KEY');
throws(() => r2CredentialsFromEnvironment({
  R2_CREDENTIALS_FD: '3', R2_ACCOUNT_ID: credentials.accountId,
}), 'MEDIA_E_R2_CREDENTIALS_ENV_FORBIDDEN');

const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dwnc-r2-credential-test-')));
await chmod(directory, 0o700);
try {
  const store = new MemoryKeychainStore();
  const clipboard = new MemoryClipboard(JSON.stringify(credentials, null, 2));
  const metadataPath = path.join(directory, 'staging-uploader.json');
  const uploaderEvidencePath = path.join(directory, 'staging-uploader-dashboard.json');
  const uploaderEvidence = {
    schemaVersion: 1,
    contract: 'dwnc-r2-dashboard-credential-evidence-v1',
    environment: 'staging',
    role: 'uploader',
    bucket: credentials.bucket,
    permission: 'object-read-write',
    accountIdSha256: cloudflareAccountIdSha256(credentials.accountId),
    accessKeyIdSha256: sha256Hex(credentials.accessKeyId),
    observedAt: '2026-08-27T00:00:00.000Z',
  };
  await writeCanonicalEvidenceCreateOnly(uploaderEvidencePath, uploaderEvidence);
  const metadata = await initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'uploader', metadataOutput: metadataPath,
    dashboardEvidencePath: uploaderEvidencePath,
    clipboard, store, now: new Date('2026-08-27T00:00:00.000Z'),
  });
  equal(clipboard.preflightCount, 1);
  equal(clipboard.clearCount, 2);
  equal(clipboard.value, '');
  equal(metadata.environment, 'staging');
  equal(metadata.role, 'uploader');
  const stats = await lstat(metadataPath);
  equal(stats.mode & 0o777, 0o600);
  equal(stats.nlink, 1);
  const metadataRaw = await readFile(metadataPath, 'utf8');
  equal(metadataRaw.includes(credentials.accountId), false);
  equal(metadataRaw.includes(credentials.accessKeyId), false);
  equal(metadataRaw.includes(credentials.secretAccessKey), false);
  equal(store.calls.every((call) => !Object.hasOwn(call, 'value')), true);

  const loaded = await loadR2Credential({
    environment: 'staging', role: 'uploader', metadataPath, store,
  });
  equal(loaded.credentials, credentials);

  const putsBeforeRecovery = store.calls.filter((call) => call.operation === 'putCreateOnly').length;
  const recoveredWithoutClipboard = await recoverR2CredentialMetadata({
    environment: 'staging', role: 'uploader',
    metadataOutput: path.join(directory, 'metadata-only-recovery.json'),
    dashboardEvidencePath: uploaderEvidencePath,
    store, now: new Date('2026-08-27T00:01:00.000Z'),
  });
  equal(recoveredWithoutClipboard.dashboardEvidenceSha256,
    sha256Hex(canonicalJson(uploaderEvidence)));
  equal(store.calls.filter((call) => call.operation === 'putCreateOnly').length,
    putsBeforeRecovery);

  const wrongAccountEvidencePath = path.join(directory, 'wrong-account-dashboard.json');
  await writeCanonicalEvidenceCreateOnly(wrongAccountEvidencePath, {
    ...uploaderEvidence, accountIdSha256: 'f'.repeat(64),
  });
  await rejects(() => recoverR2CredentialMetadata({
    environment: 'staging', role: 'uploader',
    metadataOutput: path.join(directory, 'wrong-account-recovery.json'),
    dashboardEvidencePath: wrongAccountEvidencePath, store,
  }), 'MEDIA_E_R2_DASHBOARD_EVIDENCE_CROSSOVER');

  const wrongKeyEvidencePath = path.join(directory, 'wrong-key-dashboard.json');
  await writeCanonicalEvidenceCreateOnly(wrongKeyEvidencePath, {
    ...uploaderEvidence, accessKeyIdSha256: 'e'.repeat(64),
  });
  await rejects(() => recoverR2CredentialMetadata({
    environment: 'staging', role: 'uploader',
    metadataOutput: path.join(directory, 'wrong-key-recovery.json'),
    dashboardEvidencePath: wrongKeyEvidencePath, store,
  }), 'MEDIA_E_R2_DASHBOARD_EVIDENCE_CROSSOVER');

  const wrongBucketStore = new MemoryKeychainStore();
  const uploaderIdentity = r2CredentialIdentity('staging', 'uploader');
  wrongBucketStore.values.set(wrongBucketStore.key(
    uploaderIdentity.service, uploaderIdentity.account,
  ), Buffer.from(canonicalJson({
    ...credentials, bucket: 'dwnc-me-public-media-production',
  })).toString('base64url'));
  await rejects(() => recoverR2CredentialMetadata({
    environment: 'staging', role: 'uploader',
    metadataOutput: path.join(directory, 'wrong-bucket-recovery.json'),
    dashboardEvidencePath: uploaderEvidencePath, store: wrongBucketStore,
  }), 'MEDIA_E_R2_CREDENTIAL_TARGET');

  await rejects(() => recoverR2CredentialMetadata({
    environment: 'staging', role: 'validator',
    metadataOutput: path.join(directory, 'wrong-role-recovery.json'),
    dashboardEvidencePath: uploaderEvidencePath, store,
  }), 'MEDIA_E_R2_DASHBOARD_EVIDENCE');

  const duplicateClipboard = new MemoryClipboard(canonicalJson(credentials));
  const recoveredMetadata = await initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'uploader',
    metadataOutput: path.join(directory, 'duplicate.json'),
    dashboardEvidencePath: uploaderEvidencePath,
    clipboard: duplicateClipboard, store,
  });
  equal(recoveredMetadata.accessKeyIdSha256, metadata.accessKeyIdSha256);
  equal(duplicateClipboard.clearCount, 2);

  const wrongRecoveryClipboard = new MemoryClipboard(canonicalJson({
    ...credentials, accessKeyId: 'd'.repeat(32), secretAccessKey: 'e'.repeat(64),
  }));
  await rejects(() => initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'uploader',
    metadataOutput: path.join(directory, 'wrong-recovery.json'),
    dashboardEvidencePath: uploaderEvidencePath,
    clipboard: wrongRecoveryClipboard, store,
  }), 'MEDIA_E_R2_DASHBOARD_EVIDENCE_CROSSOVER');
  equal(wrongRecoveryClipboard.clearCount, 2);

  const wrongTargetClipboard = new MemoryClipboard(canonicalJson({
    ...credentials, bucket: 'dwnc-me-public-media-production',
  }));
  const validatorEvidencePath = path.join(directory, 'staging-validator-dashboard.json');
  await writeCanonicalEvidenceCreateOnly(validatorEvidencePath, {
    ...uploaderEvidence,
    role: 'validator',
    permission: 'object-read-only',
  });
  await rejects(() => initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'validator',
    metadataOutput: path.join(directory, 'wrong-target.json'),
    dashboardEvidencePath: validatorEvidencePath,
    clipboard: wrongTargetClipboard, store: new MemoryKeychainStore(),
  }), 'MEDIA_E_R2_CREDENTIAL_TARGET');
  equal(wrongTargetClipboard.clearCount, 2);

  const crossoverClipboard = new MemoryClipboard(canonicalJson(credentials));
  await rejects(() => initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'validator',
    metadataOutput: path.join(directory, 'role-crossover.json'),
    dashboardEvidencePath: uploaderEvidencePath,
    clipboard: crossoverClipboard, store: new MemoryKeychainStore(),
  }), 'MEDIA_E_R2_DASHBOARD_EVIDENCE');
  equal(crossoverClipboard.readCount, 0);
  equal(crossoverClipboard.clearCount >= 1, true);
  equal(crossoverClipboard.value, '');

  const existingMetadataClipboard = new MemoryClipboard(canonicalJson(credentials));
  await rejects(() => initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'validator', metadataOutput: metadataPath,
    dashboardEvidencePath: validatorEvidencePath,
    clipboard: existingMetadataClipboard, store: new MemoryKeychainStore(),
  }), 'CLOUDFLARE_E_SIGNING_FILE_EXISTS');
  equal(existingMetadataClipboard.clearCount >= 1, true);
  equal(existingMetadataClipboard.value, '');

  const invalidPathClipboard = new MemoryClipboard(canonicalJson(credentials));
  await rejects(() => initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'uploader', metadataOutput: 'relative-output.json',
    dashboardEvidencePath: uploaderEvidencePath,
    clipboard: invalidPathClipboard, store: new MemoryKeychainStore(),
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  equal(invalidPathClipboard.clearCount >= 1, true);
  equal(invalidPathClipboard.value, '');

  const failedPreflightClipboard = new MemoryClipboard(canonicalJson(credentials), {
    preflightError: 'MEDIA_E_R2_CLIPBOARD_PREFLIGHT',
  });
  await rejects(() => initializeR2CredentialFromClipboard({
    environment: 'staging', role: 'uploader',
    metadataOutput: path.join(directory, 'failed-preflight.json'),
    dashboardEvidencePath: uploaderEvidencePath,
    clipboard: failedPreflightClipboard, store: new MemoryKeychainStore(),
  }), 'MEDIA_E_R2_CLIPBOARD_PREFLIGHT');
  equal(failedPreflightClipboard.preflightCount, 1);
  equal(failedPreflightClipboard.readCount, 0);
  equal(failedPreflightClipboard.clearCount >= 1, true);
  equal(failedPreflightClipboard.value, '');

  const looseMetadata = path.join(directory, 'loose.json');
  await writeFile(looseMetadata, metadataRaw, { mode: 0o644 });
  await rejects(() => loadR2Credential({
    environment: 'staging', role: 'uploader', metadataPath: looseMetadata, store,
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  const linkedMetadata = path.join(directory, 'linked.json');
  await link(metadataPath, linkedMetadata);
  await rejects(() => loadR2Credential({
    environment: 'staging', role: 'uploader', metadataPath, store,
  }), 'CLOUDFLARE_E_SIGNING_FILE');
  const symlinkMetadata = path.join(directory, 'symlink.json');
  await symlink(looseMetadata, symlinkMetadata);
  await rejects(() => loadR2Credential({
    environment: 'staging', role: 'uploader', metadataPath: symlinkMetadata, store,
  }), 'CLOUDFLARE_E_SIGNING_FILE');

  const result = await runFdReader({ value: canonicalJson(credentials) });
  equal(result.code, 0);
  equal(JSON.parse(result.stdout).bucket, credentials.bucket);
  const ambiguous = await runFdReader({
    value: canonicalJson(credentials),
    extraEnvironment: { R2_ACCOUNT_ID: credentials.accountId },
  });
  equal(ambiguous.code, 1);
  equal(ambiguous.stderr.trim(), 'MEDIA_E_R2_CREDENTIALS_ENV_FORBIDDEN');
  const wrongDescriptor = await runFdReader({
    value: canonicalJson(credentials), extraEnvironment: { R2_CREDENTIALS_FD: '4' },
  });
  equal(wrongDescriptor.code, 1);
  equal(wrongDescriptor.stderr.trim(), 'MEDIA_E_R2_CREDENTIALS_FD');

  const noncanonicalResult = await runFdReader({ value: JSON.stringify(credentials) });
  equal(noncanonicalResult.code, 1);
  equal(noncanonicalResult.stderr.trim(), 'MEDIA_E_R2_CREDENTIALS_CANONICAL');

  const linkedPath = path.join(directory, 'linked-credential.json');
  const linkedHandle = await open(linkedPath, 'wx+', 0o600);
  try {
    await linkedHandle.writeFile(canonicalJson(credentials));
    await linkedHandle.sync();
    const result = await runFdReader({ diskFd: linkedHandle.fd });
    equal(result.code, 1);
    equal(result.stderr.trim(), 'MEDIA_E_R2_CREDENTIALS_FD');
  } finally { await linkedHandle.close(); }

  const loosePath = path.join(directory, 'loose-credential.json');
  const looseHandle = await open(loosePath, 'wx+', 0o644);
  try {
    await looseHandle.writeFile(canonicalJson(credentials));
    await looseHandle.sync();
    await unlink(loosePath);
    const result = await runFdReader({ diskFd: looseHandle.fd });
    equal(result.code, 1);
    equal(result.stderr.trim(), 'MEDIA_E_R2_CREDENTIALS_FD');
  } finally { await looseHandle.close(); }

  const [keychainSource, runnerSource] = await Promise.all([
    readFile('scripts/lib/cloudflare-signing-key.mjs', 'utf8'),
    readFile('scripts/run-with-r2-credentials.mjs', 'utf8'),
  ]);
  equal(keychainSource.includes("'-A'"), false);
  equal(keychainSource.includes("'-U'"), false);
  equal(runnerSource.includes('R2_SECRET_ACCESS_KEY'), false);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  suite: 'r2-credential-store-and-sealed-fd',
  assertions,
  realKeychainCalls: 0,
  realClipboardCalls: 0,
  liveNetworkCalls: 0,
  status: 'PASS',
}, null, 2));
