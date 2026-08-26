import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import {
  assertSecureCreateOnlyDestination,
  MacOSKeychainStore,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';
import { validateR2Credentials } from './r2-s3-client.mjs';

const TARGETS = Object.freeze({
  staging: 'dwnc-me-public-media-staging',
  production: 'dwnc-me-public-media-production',
});
const ROLES = new Set(['uploader', 'validator']);
const SHA256 = /^[a-f0-9]{64}$/u;
const PERMISSIONS = Object.freeze({
  uploader: 'object-read-write',
  validator: 'object-read-only',
});

function fail(code) { throw new Error(code); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function assertR2CredentialRole(environment, role) {
  if (!Object.hasOwn(TARGETS, environment) || !ROLES.has(role)) {
    fail('MEDIA_E_R2_CREDENTIAL_ROLE');
  }
  return { environment, role, bucket: TARGETS[environment] };
}

export function r2CredentialIdentity(environment, role) {
  assertR2CredentialRole(environment, role);
  return {
    service: 'me.dwnc.r2-s3-credentials.v1',
    account: `dwnc:${environment}:${role}`,
  };
}

export function validateR2CredentialMetadata(metadata, { environment, role } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'role', 'bucket', 'accountIdSha256',
    'permission', 'accessKeyIdSha256', 'secretAccessKeySha256', 'dashboardEvidenceSha256',
    'keychainService', 'keychainAccount', 'createdAt'];
  if (!exactKeys(metadata, keys) || metadata.schemaVersion !== 1
    || metadata.contract !== 'dwnc-r2-s3-credential-metadata-v1'
    || !Object.hasOwn(TARGETS, metadata.environment) || !ROLES.has(metadata.role)
    || metadata.bucket !== TARGETS[metadata.environment]
    || metadata.permission !== PERMISSIONS[metadata.role]
    || ![metadata.accountIdSha256, metadata.accessKeyIdSha256,
      metadata.secretAccessKeySha256, metadata.dashboardEvidenceSha256]
      .every((value) => SHA256.test(value ?? ''))
    || metadata.keychainService !== r2CredentialIdentity(metadata.environment, metadata.role).service
    || metadata.keychainAccount !== r2CredentialIdentity(metadata.environment, metadata.role).account
    || Number.isNaN(Date.parse(metadata.createdAt ?? ''))
    || environment !== undefined && metadata.environment !== environment
    || role !== undefined && metadata.role !== role) fail('MEDIA_E_R2_CREDENTIAL_METADATA');
  return metadata;
}

export function validateR2CredentialDashboardEvidence(evidence, { environment, role } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'role', 'bucket', 'permission',
    'accountIdSha256', 'accessKeyIdSha256', 'observedAt'];
  if (!exactKeys(evidence, keys) || evidence.schemaVersion !== 1
    || evidence.contract !== 'dwnc-r2-dashboard-credential-evidence-v1'
    || !Object.hasOwn(TARGETS, evidence.environment) || !ROLES.has(evidence.role)
    || evidence.bucket !== TARGETS[evidence.environment]
    || evidence.permission !== PERMISSIONS[evidence.role]
    || !SHA256.test(evidence.accountIdSha256 ?? '')
    || !SHA256.test(evidence.accessKeyIdSha256 ?? '')
    || Number.isNaN(Date.parse(evidence.observedAt ?? ''))
    || environment !== undefined && evidence.environment !== environment
    || role !== undefined && evidence.role !== role) fail('MEDIA_E_R2_DASHBOARD_EVIDENCE');
  return evidence;
}

export class MacOSClipboard {
  async preflight() {
    try {
      await Promise.all([
        access('/usr/bin/pbpaste', fsConstants.X_OK),
        access('/usr/bin/pbcopy', fsConstants.X_OK),
      ]);
    } catch { fail('MEDIA_E_R2_CLIPBOARD_PREFLIGHT'); }
  }

  async clear() {
    const child = spawn('/usr/bin/pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end();
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).catch(() => fail('MEDIA_E_R2_CLIPBOARD_CLEAR'));
    if (code !== 0) fail('MEDIA_E_R2_CLIPBOARD_CLEAR');
  }

  async readAndClear() {
    let raw;
    try {
      ({ stdout: raw } = await promisify(execFile)('/usr/bin/pbpaste', [], {
        encoding: 'utf8', maxBuffer: 16 * 1024, timeout: 15000,
      }));
    } catch {
      await this.clear().catch(() => undefined);
      fail('MEDIA_E_R2_CLIPBOARD');
    }
    try {
      await this.clear();
      const { stdout: after } = await promisify(execFile)('/usr/bin/pbpaste', [], {
        encoding: 'utf8', maxBuffer: 1024, timeout: 15000,
      });
      if (after !== '') fail('MEDIA_E_R2_CLIPBOARD_CLEAR');
    } catch (error) {
      if (error?.message === 'MEDIA_E_R2_CLIPBOARD_CLEAR') throw error;
      fail('MEDIA_E_R2_CLIPBOARD_CLEAR');
    }
    if (typeof raw !== 'string' || Buffer.byteLength(raw) === 0
      || Buffer.byteLength(raw) > 4096) fail('MEDIA_E_R2_CLIPBOARD');
    return raw;
  }
}

async function loadDashboardEvidence({ environment, role, dashboardEvidencePath }) {
  let dashboardStored;
  try { dashboardStored = await readSecureFile(dashboardEvidencePath, 64 * 1024); }
  catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_')) throw error;
    fail('MEDIA_E_R2_DASHBOARD_EVIDENCE');
  }
  try {
    const parsedDashboard = parseCanonicalEvidenceStorage(dashboardStored);
    return validateR2CredentialDashboardEvidence(parsedDashboard.payload, { environment, role });
  } finally { dashboardStored.fill(0); }
}

function credentialHashes(credentials) {
  return {
    accountIdSha256: cloudflareAccountIdSha256(credentials.accountId),
    accessKeyIdSha256: createHash('sha256').update(credentials.accessKeyId).digest('hex'),
    secretAccessKeySha256: createHash('sha256').update(credentials.secretAccessKey).digest('hex'),
  };
}

function assertDashboardCredentialBinding({ dashboardEvidence, credentials, role }) {
  const hashes = credentialHashes(credentials);
  if (dashboardEvidence.bucket !== credentials.bucket
    || dashboardEvidence.accountIdSha256 !== hashes.accountIdSha256
    || dashboardEvidence.accessKeyIdSha256 !== hashes.accessKeyIdSha256
    || dashboardEvidence.permission !== PERMISSIONS[role]) {
    fail('MEDIA_E_R2_DASHBOARD_EVIDENCE_CROSSOVER');
  }
  return hashes;
}

function createCredentialMetadata({
  environment, role, credentials, hashes, dashboardEvidence, identity, now,
}) {
  return validateR2CredentialMetadata({
    schemaVersion: 1,
    contract: 'dwnc-r2-s3-credential-metadata-v1',
    environment,
    role,
    bucket: credentials.bucket,
    accountIdSha256: hashes.accountIdSha256,
    permission: PERMISSIONS[role],
    accessKeyIdSha256: hashes.accessKeyIdSha256,
    secretAccessKeySha256: hashes.secretAccessKeySha256,
    dashboardEvidenceSha256: sha256Hex(canonicalJson(dashboardEvidence)),
    keychainService: identity.service,
    keychainAccount: identity.account,
    createdAt: now.toISOString(),
  }, { environment, role });
}

export async function initializeR2CredentialFromClipboard({
  environment,
  role,
  metadataOutput,
  dashboardEvidencePath,
  clipboard = new MacOSClipboard(),
  store = new MacOSKeychainStore(),
  now = new Date(),
}) {
  let raw = '';
  try {
    const target = assertR2CredentialRole(environment, role);
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail('MEDIA_E_R2_CREDENTIAL');
    await assertSecureCreateOnlyDestination(metadataOutput);
    const dashboardEvidence = await loadDashboardEvidence({
      environment, role, dashboardEvidencePath,
    });
    // Clipboard capability is checked before any attempt to read a credential.
    await clipboard.preflight();
    raw = await clipboard.readAndClear();
    let credentials;
    try { credentials = validateR2Credentials(JSON.parse(raw)); }
    catch { fail('MEDIA_E_R2_CREDENTIAL'); }
    if (credentials.bucket !== target.bucket) fail('MEDIA_E_R2_CREDENTIAL_TARGET');
    const hashes = assertDashboardCredentialBinding({ dashboardEvidence, credentials, role });
    const identity = r2CredentialIdentity(environment, role);
    const canonicalCredentials = canonicalJson(credentials);
    const secret = Buffer.from(canonicalCredentials).toString('base64url');
    const existing = await store.get(identity.service, identity.account);
    if (existing === null) await store.putCreateOnly(identity.service, identity.account, secret);
    else if (existing !== secret) fail('MEDIA_E_R2_CREDENTIAL_EXISTS');
    if (await store.get(identity.service, identity.account) !== secret) fail('MEDIA_E_R2_CREDENTIAL');
    const metadata = createCredentialMetadata({
      environment, role, credentials, hashes, dashboardEvidence, identity, now,
    });
    await writeCanonicalEvidenceCreateOnly(metadataOutput, metadata);
    return metadata;
  } finally {
    raw = '';
    await clipboard.clear();
  }
}

export async function recoverR2CredentialMetadata({
  environment,
  role,
  metadataOutput,
  dashboardEvidencePath,
  store = new MacOSKeychainStore(),
  now = new Date(),
}) {
  const target = assertR2CredentialRole(environment, role);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail('MEDIA_E_R2_CREDENTIAL');
  await assertSecureCreateOnlyDestination(metadataOutput);
  const dashboardEvidence = await loadDashboardEvidence({
    environment, role, dashboardEvidencePath,
  });
  const identity = r2CredentialIdentity(environment, role);
  const secret = await store.get(identity.service, identity.account);
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{40,1024}$/u.test(secret)) {
    fail('MEDIA_E_R2_CREDENTIAL_RECOVERY');
  }
  let credentials;
  let decoded;
  try {
    decoded = Buffer.from(secret, 'base64url');
    if (decoded.toString('base64url') !== secret) fail('MEDIA_E_R2_CREDENTIAL_RECOVERY');
    credentials = validateR2Credentials(JSON.parse(decoded.toString('utf8')));
  } catch (error) {
    if (error?.message === 'MEDIA_E_R2_CREDENTIAL_RECOVERY') throw error;
    fail('MEDIA_E_R2_CREDENTIAL_RECOVERY');
  } finally { decoded?.fill(0); }
  if (credentials.bucket !== target.bucket) fail('MEDIA_E_R2_CREDENTIAL_TARGET');
  const hashes = assertDashboardCredentialBinding({ dashboardEvidence, credentials, role });
  const metadata = createCredentialMetadata({
    environment, role, credentials, hashes, dashboardEvidence, identity, now,
  });
  await writeCanonicalEvidenceCreateOnly(metadataOutput, metadata);
  return metadata;
}

export async function loadR2Credential({
  environment,
  role,
  metadataPath,
  store = new MacOSKeychainStore(),
}) {
  let metadata;
  try { metadata = JSON.parse((await readSecureFile(metadataPath, 64 * 1024)).toString('utf8')); }
  catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_') || error?.message?.startsWith('MEDIA_E_')) throw error;
    fail('MEDIA_E_R2_CREDENTIAL_METADATA');
  }
  validateR2CredentialMetadata(metadata, { environment, role });
  const secret = await store.get(metadata.keychainService, metadata.keychainAccount);
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{40,1024}$/u.test(secret)) {
    fail('MEDIA_E_R2_CREDENTIAL');
  }
  let credentials;
  try { credentials = validateR2Credentials(JSON.parse(Buffer.from(secret, 'base64url').toString('utf8'))); }
  catch { fail('MEDIA_E_R2_CREDENTIAL'); }
  if (credentials.bucket !== metadata.bucket
    || cloudflareAccountIdSha256(credentials.accountId) !== metadata.accountIdSha256
    || createHash('sha256').update(credentials.accessKeyId).digest('hex') !== metadata.accessKeyIdSha256
    || createHash('sha256').update(credentials.secretAccessKey).digest('hex')
      !== metadata.secretAccessKeySha256) fail('MEDIA_E_R2_CREDENTIAL');
  return { metadata, credentials };
}
