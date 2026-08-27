import { execFile, spawn } from 'node:child_process';
import { userInfo } from 'node:os';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { canonicalJson } from './cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  MacOSKeychainStore,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';

export const CLOUDFLARE_ACCOUNT_TARGET_SERVICE = 'me.dwnc.cloudflare-account-target.v1';
export const CLOUDFLARE_ACCOUNT_TARGET_ACCOUNT = 'dwnc:staging:account-id';
export const CLOUDFLARE_ACCOUNT_TARGET_PURPOSE = 'staging-cloudflare-read-target';

const PAYLOAD_CONTRACT = 'dwnc-cloudflare-account-target-v1';
const METADATA_CONTRACT = 'dwnc-cloudflare-account-target-metadata-v1';
const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]{40,512}$/u;

function fail(code) { throw new Error(code); }
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

function encodeAccountTarget(accountId) {
  validateCloudflareAccountTargetPayload({
    schemaVersion: 1,
    contract: PAYLOAD_CONTRACT,
    accountId,
  });
  return Buffer.from(canonicalJson({
    schemaVersion: 1,
    contract: PAYLOAD_CONTRACT,
    accountId,
  }), 'utf8').toString('base64url');
}

function decodeAccountTarget(secret) {
  if (typeof secret !== 'string' || !BASE64URL.test(secret)) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
  }
  let decoded;
  try {
    decoded = Buffer.from(secret, 'base64url');
    if (decoded.toString('base64url') !== secret) fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    const payload = validateCloudflareAccountTargetPayload(JSON.parse(raw));
    if (canonicalJson(payload) !== raw) fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
    return payload;
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD') throw error;
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
  } finally { decoded?.fill(0); }
}

function createMetadata(accountId, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
  }
  const identity = cloudflareAccountTargetIdentity();
  return validateCloudflareAccountTargetMetadata({
    schemaVersion: 1,
    contract: METADATA_CONTRACT,
    keychainService: identity.service,
    keychainAccount: identity.account,
    accountIdSha256: cloudflareAccountIdSha256(accountId),
    createdAt: now.toISOString(),
    purpose: CLOUDFLARE_ACCOUNT_TARGET_PURPOSE,
  });
}

function assertAccountTarget(accountId, expectedAccountIdSha256) {
  validateExpectedFingerprint(expectedAccountIdSha256);
  if (!ACCOUNT_ID.test(accountId ?? '')
    || cloudflareAccountIdSha256(accountId) !== expectedAccountIdSha256) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_TARGET');
  }
}

export class MacOSSingleReadClipboard {
  async preflight() {
    try {
      await Promise.all([
        access('/usr/bin/pbpaste', fsConstants.X_OK),
        access('/usr/bin/pbcopy', fsConstants.X_OK),
      ]);
    } catch { fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_PREFLIGHT'); }
  }

  async clear() {
    const child = spawn('/usr/bin/pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end();
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).catch(() => fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR'));
    if (code !== 0) fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD_CLEAR');
  }

  async readOnceAndClear() {
    let raw;
    try {
      ({ stdout: raw } = await promisify(execFile)('/usr/bin/pbpaste', [], {
        encoding: 'utf8', maxBuffer: 16 * 1024, timeout: 15000,
      }));
    } catch {
      await this.clear().catch(() => undefined);
      fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD');
    }
    await this.clear();
    if (typeof raw !== 'string' || Buffer.byteLength(raw) === 0
      || Buffer.byteLength(raw) > 4096) fail('CLOUDFLARE_E_ACCOUNT_CLIPBOARD');
    return raw;
  }
}

async function readMetadata(metadataPath, expectedAccountIdSha256, readFile = readSecureFile, {
  allowPartial = false,
} = {}) {
  let stored;
  let canonicalBytes;
  try {
    stored = await readFile(metadataPath, 64 * 1024, { allowEmpty: allowPartial });
    const parsed = parseCanonicalEvidenceStorage(stored);
    canonicalBytes = parsed.canonicalBytes;
    return validateCloudflareAccountTargetMetadata(parsed.payload, {
      expectedAccountIdSha256,
    });
  } catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_SIGNING_FILE')) throw error;
    if (error?.message === 'CLOUDFLARE_E_SIGNING_CANONICAL') throw error;
    if (error?.message?.startsWith('CLOUDFLARE_E_ACCOUNT_STORE')) throw error;
    fail('CLOUDFLARE_E_ACCOUNT_STORE_METADATA');
  } finally {
    stored?.fill(0);
    canonicalBytes?.fill(0);
  }
}

export async function initializeCloudflareAccountTarget({
  metadataOutput = defaultCloudflareAccountTargetMetadataPath(),
  expectedAccountIdSha256,
  clipboard = new MacOSSingleReadClipboard(),
  store = new MacOSKeychainStore(),
  now = new Date(),
  assertDestination = assertSecureCreateOnlyDestination,
  writeMetadata = writeCanonicalEvidenceCreateOnly,
} = {}) {
  let raw = '';
  let secret = '';
  const identity = cloudflareAccountTargetIdentity();
  try {
    validateExpectedFingerprint(expectedAccountIdSha256);
    await assertDestination(metadataOutput);
    if (await store.get(identity.service, identity.account) !== null) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
    }
    await clipboard.preflight();
    raw = await clipboard.readOnceAndClear();
    if (!ACCOUNT_ID.test(raw)) fail('CLOUDFLARE_E_ACCOUNT_STORE_PAYLOAD');
    assertAccountTarget(raw, expectedAccountIdSha256);
    secret = encodeAccountTarget(raw);
    try { await store.putCreateOnly(identity.service, identity.account, secret); }
    catch (error) {
      if (['CLOUDFLARE_E_SIGNING_KEY_EXISTS', 'CLOUDFLARE_E_ACCOUNT_STORE_EXISTS']
        .includes(error?.message)) fail('CLOUDFLARE_E_ACCOUNT_STORE_EXISTS');
      throw error;
    }
    if (await store.get(identity.service, identity.account) !== secret) {
      fail('CLOUDFLARE_E_ACCOUNT_STORE_KEYCHAIN');
    }
    const metadata = createMetadata(raw, now);
    await writeMetadata(metadataOutput, metadata);
    return metadata;
  } finally {
    raw = '';
    secret = '';
    await clipboard.clear();
  }
}

export async function recoverCloudflareAccountTargetMetadata({
  metadataOutput = defaultCloudflareAccountTargetMetadataPath(),
  recoveryMetadataOutput,
  expectedAccountIdSha256,
  store = new MacOSKeychainStore(),
  now = new Date(),
  assertDestination = assertSecureCreateOnlyDestination,
  readFile = readSecureFile,
  writeMetadata = writeCanonicalEvidenceCreateOnly,
} = {}) {
  validateExpectedFingerprint(expectedAccountIdSha256);
  const fixedRecoveryMetadataOutput = cloudflareAccountTargetRecoveryMetadataPath(metadataOutput);
  if (recoveryMetadataOutput !== undefined
    && recoveryMetadataOutput !== fixedRecoveryMetadataOutput) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PATH');
  }
  let destinationAbsent = false;
  try {
    await assertDestination(metadataOutput);
    destinationAbsent = true;
  } catch (error) {
    if (error?.message !== 'CLOUDFLARE_E_SIGNING_FILE_EXISTS') throw error;
  }
  const identity = cloudflareAccountTargetIdentity();
  const secret = await store.get(identity.service, identity.account);
  let payload;
  try {
    payload = decodeAccountTarget(secret);
    assertAccountTarget(payload.accountId, expectedAccountIdSha256);
    if (!destinationAbsent) {
      try {
        return await readMetadata(metadataOutput, expectedAccountIdSha256, readFile, {
          allowPartial: true,
        });
      }
      catch (error) {
        if (error?.message !== 'CLOUDFLARE_E_SIGNING_CANONICAL') throw error;
        let recoveryAbsent = false;
        try {
          await assertDestination(fixedRecoveryMetadataOutput);
          recoveryAbsent = true;
        } catch (destinationError) {
          if (destinationError?.message !== 'CLOUDFLARE_E_SIGNING_FILE_EXISTS') {
            throw destinationError;
          }
        }
        if (!recoveryAbsent) {
          try {
            return await readMetadata(
              fixedRecoveryMetadataOutput, expectedAccountIdSha256, readFile,
              { allowPartial: true },
            );
          } catch (recoveryError) {
            if (recoveryError?.message === 'CLOUDFLARE_E_SIGNING_CANONICAL') {
              fail('CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_EXHAUSTED');
            }
            throw recoveryError;
          }
        }
        const metadata = createMetadata(payload.accountId, now);
        await writeMetadata(fixedRecoveryMetadataOutput, metadata);
        return metadata;
      }
    }
    const metadata = createMetadata(payload.accountId, now);
    await writeMetadata(metadataOutput, metadata);
    return metadata;
  } finally {
    payload = null;
  }
}

export async function loadCloudflareAccountTarget({
  metadataPath = defaultCloudflareAccountTargetMetadataPath(),
  recoveryMetadataPath,
  expectedAccountIdSha256,
  store = new MacOSKeychainStore(),
  readFile = readSecureFile,
  assertDestination = assertSecureCreateOnlyDestination,
} = {}) {
  validateExpectedFingerprint(expectedAccountIdSha256);
  const fixedRecoveryMetadataPath = cloudflareAccountTargetRecoveryMetadataPath(metadataPath);
  if (recoveryMetadataPath !== undefined
    && recoveryMetadataPath !== fixedRecoveryMetadataPath) {
    fail('CLOUDFLARE_E_ACCOUNT_STORE_PATH');
  }
  let metadata;
  try {
    metadata = await readMetadata(metadataPath, expectedAccountIdSha256, readFile, {
      allowPartial: true,
    });
  }
  catch (error) {
    if (error?.message !== 'CLOUDFLARE_E_SIGNING_CANONICAL') throw error;
    try {
      metadata = await readMetadata(
        fixedRecoveryMetadataPath, expectedAccountIdSha256, readFile, { allowPartial: true },
      );
    } catch (recoveryError) {
      if (recoveryError?.message === 'CLOUDFLARE_E_SIGNING_CANONICAL') {
        fail('CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_EXHAUSTED');
      }
      if (recoveryError?.message !== 'CLOUDFLARE_E_SIGNING_FILE') throw recoveryError;
      try { await assertDestination(fixedRecoveryMetadataPath); }
      catch (destinationError) { throw destinationError; }
      fail('CLOUDFLARE_E_ACCOUNT_STORE_RECOVERY_REQUIRED');
    }
  }
  const secret = await store.get(metadata.keychainService, metadata.keychainAccount);
  let payload;
  try {
    payload = decodeAccountTarget(secret);
    assertAccountTarget(payload.accountId, expectedAccountIdSha256);
    return { metadata, accountId: payload.accountId };
  } finally {
    payload = null;
  }
}
