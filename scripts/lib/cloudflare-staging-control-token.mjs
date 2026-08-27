import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import {
  MAX_BOOTSTRAP_RESPONSE_BYTES,
  parseBootstrapJsonBytes,
  readBootstrapResponseBody,
} from './cloudflare-bootstrap-http.mjs';
import { canonicalJson } from './cloudflare-release.mjs';
import {
  assertMacOSKeychainSecret,
  assertSecureCreateOnlyDestination,
  MacOSKeychainStore,
  parseCanonicalEvidenceStorage,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './cloudflare-signing-key.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';

export const CLOUDFLARE_STAGING_CONTROL_TOKEN_SERVICE
  = 'me.dwnc.cloudflare-staging-worker-control.v1';
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_ACCOUNT
  = 'dwnc:staging:workers-scripts-edit';
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_PURPOSE
  = 'staging-worker-control';
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_PERMISSION_UI_NAME
  = 'Workers Scripts Edit';
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_PERMISSION_API_NAME
  = 'Workers Scripts Write';

const PAYLOAD_CONTRACT = 'dwnc-cloudflare-staging-control-token-v1';
const METADATA_CONTRACT = 'dwnc-cloudflare-staging-control-token-metadata-v1';
const PERMISSION_CONTRACT = 'dwnc-cloudflare-staging-control-permission-v1';
const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const ACCOUNT_API_TOKEN = /^cfat_[A-Za-z0-9]{40}[a-f0-9]{8}$/u;
const TOKEN_ID = /^[A-Za-z0-9_-]{16,128}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TOKEN_PAYLOAD_BYTES = 402;
export const CLOUDFLARE_STAGING_CONTROL_TOKEN_PAYLOAD_CHARACTERS = 536;
const TOKEN_PAYLOAD_BASE64URL = /^[A-Za-z0-9_-]{536}$/u;
const MINIMUM_REMAINING_MS = 60 * 60 * 1000;
const MAXIMUM_LIFETIME_MS = 48 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const EXPECTED_ACCOUNT_SUBDOMAIN = 'dwnc';

function fail(code) { throw new Error(code); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}
function sha256Domain(domain, value) {
  return createHash('sha256').update(`${domain}\0${value}`).digest('hex');
}
function validDate(value, code) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail(code);
  return value;
}
function parseInstant(value, code) {
  if (typeof value !== 'string' || value.length > 64) fail(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(code);
  return parsed;
}

export function cloudflareStagingControlTokenIdentity() {
  return {
    service: CLOUDFLARE_STAGING_CONTROL_TOKEN_SERVICE,
    account: CLOUDFLARE_STAGING_CONTROL_TOKEN_ACCOUNT,
  };
}

export function defaultCloudflareStagingControlTokenMetadataPath(home) {
  let selectedHome = home;
  if (selectedHome === undefined) {
    try { selectedHome = userInfo().homedir; }
    catch { fail('CLOUDFLARE_E_STAGING_CONTROL_STORE_PATH'); }
  }
  if (typeof selectedHome !== 'string' || !path.isAbsolute(selectedHome)
    || path.resolve(selectedHome) !== selectedHome) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STORE_PATH');
  }
  return path.join(
    selectedHome,
    'Library', 'Application Support', 'dwnc.me', 'stage3',
    'staging-cloudflare-worker-control-token.json',
  );
}

export function cloudflareStagingControlTokenRecoveryMetadataPath(metadataPath) {
  if (typeof metadataPath !== 'string' || !path.isAbsolute(metadataPath)
    || path.resolve(metadataPath) !== metadataPath || path.extname(metadataPath) !== '.json'
    || path.basename(metadataPath) === '.json') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STORE_PATH');
  }
  const parsed = path.parse(metadataPath);
  return path.join(parsed.dir, `${parsed.name}-recovery.json`);
}

export function cloudflareStagingControlTokenSha256(apiToken) {
  if (!ACCOUNT_API_TOKEN.test(apiToken ?? '')) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_TOKEN_FORMAT');
  }
  return sha256Domain('cloudflare-api-token-v1', apiToken);
}

export function cloudflareStagingControlTokenIdSha256(tokenId) {
  if (!TOKEN_ID.test(tokenId ?? '')) fail('CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
  return sha256Domain('cloudflare-api-token-id-v1', tokenId);
}

export function cloudflareStagingControlPermissionContract(accountIdSha256) {
  if (!SHA256.test(accountIdSha256 ?? '')) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_PERMISSION');
  }
  return Object.freeze({
    schemaVersion: 1,
    contract: PERMISSION_CONTRACT,
    environment: 'staging',
    accountIdSha256,
    tokenType: 'Account API Token',
    permissions: Object.freeze([Object.freeze({
      scope: 'Account',
      resource: 'Workers Scripts',
      access: 'Edit',
      dashboardName: CLOUDFLARE_STAGING_CONTROL_TOKEN_PERMISSION_UI_NAME,
      apiName: CLOUDFLARE_STAGING_CONTROL_TOKEN_PERMISSION_API_NAME,
    })]),
    excludedCapabilities: Object.freeze([
      'production', 'dns', 'zones', 'routes', 'r2', 'kv', 'd1', 'delete',
    ]),
  });
}

export function cloudflareStagingControlPermissionContractSha256(accountIdSha256) {
  return createHash('sha256')
    .update(canonicalJson(cloudflareStagingControlPermissionContract(accountIdSha256)))
    .digest('hex');
}

export function validateCloudflareStagingControlTokenMetadata(metadata, {
  expectedAccountIdSha256,
  expectedApiTokenSha256,
  expectedTokenIdSha256,
  now = new Date(),
  requireUsable = true,
} = {}) {
  const keys = [
    'schemaVersion', 'contract', 'keychainService', 'keychainAccount',
    'purpose', 'environment', 'accountIdSha256', 'apiTokenSha256',
    'tokenIdSha256', 'tokenType', 'status', 'notBefore', 'expiresAt',
    'verifiedAt', 'permissionContractSha256',
  ];
  if (!exactKeys(metadata, keys) || metadata.schemaVersion !== 1
    || metadata.contract !== METADATA_CONTRACT
    || metadata.keychainService !== CLOUDFLARE_STAGING_CONTROL_TOKEN_SERVICE
    || metadata.keychainAccount !== CLOUDFLARE_STAGING_CONTROL_TOKEN_ACCOUNT
    || metadata.purpose !== CLOUDFLARE_STAGING_CONTROL_TOKEN_PURPOSE
    || metadata.environment !== 'staging'
    || !SHA256.test(metadata.accountIdSha256 ?? '')
    || !SHA256.test(metadata.apiTokenSha256 ?? '')
    || !SHA256.test(metadata.tokenIdSha256 ?? '')
    || metadata.tokenType !== 'Account API Token'
    || metadata.status !== 'active'
    || !SHA256.test(metadata.permissionContractSha256 ?? '')
    || metadata.permissionContractSha256
      !== cloudflareStagingControlPermissionContractSha256(metadata.accountIdSha256)
    || expectedAccountIdSha256 !== undefined
      && metadata.accountIdSha256 !== expectedAccountIdSha256
    || expectedApiTokenSha256 !== undefined
      && metadata.apiTokenSha256 !== expectedApiTokenSha256
    || expectedTokenIdSha256 !== undefined
      && metadata.tokenIdSha256 !== expectedTokenIdSha256) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_METADATA');
  }
  const notBefore = parseInstant(metadata.notBefore, 'CLOUDFLARE_E_STAGING_CONTROL_METADATA');
  const expiresAt = parseInstant(metadata.expiresAt, 'CLOUDFLARE_E_STAGING_CONTROL_METADATA');
  const verifiedAt = parseInstant(metadata.verifiedAt, 'CLOUDFLARE_E_STAGING_CONTROL_METADATA');
  if (notBefore.toISOString() !== metadata.notBefore
    || expiresAt.toISOString() !== metadata.expiresAt
    || verifiedAt.toISOString() !== metadata.verifiedAt
    || expiresAt.getTime() <= notBefore.getTime()
    || expiresAt.getTime() - notBefore.getTime() > MAXIMUM_LIFETIME_MS
    || verifiedAt.getTime() < notBefore.getTime()
    || verifiedAt.getTime() >= expiresAt.getTime()) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_METADATA');
  }
  if (requireUsable) {
    validDate(now, 'CLOUDFLARE_E_STAGING_CONTROL_TIME');
    if (now.getTime() < notBefore.getTime()
      || expiresAt.getTime() - now.getTime() < MINIMUM_REMAINING_MS) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_TIME');
    }
  }
  return metadata;
}

function validateAccountId(accountId) {
  if (!ACCOUNT_ID.test(accountId ?? '')) fail('CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');
  return accountId;
}

function encodeTokenPayload(apiToken, verification) {
  cloudflareStagingControlTokenSha256(apiToken);
  if (!verification || verification.apiTokenSha256
    !== cloudflareStagingControlTokenSha256(apiToken)
    || !SHA256.test(verification.accountIdSha256 ?? '')
    || !SHA256.test(verification.tokenIdSha256 ?? '')
    || !SHA256.test(verification.permissionContractSha256 ?? '')) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
  }
  const bytes = Buffer.from(canonicalJson({
    schemaVersion: 1,
    contract: PAYLOAD_CONTRACT,
    apiToken,
    accountIdSha256: verification.accountIdSha256,
    tokenIdSha256: verification.tokenIdSha256,
    permissionContractSha256: verification.permissionContractSha256,
  }), 'utf8');
  let encoded = '';
  try {
    if (bytes.length !== TOKEN_PAYLOAD_BYTES) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
    }
    encoded = bytes.toString('base64url');
    if (encoded.length !== CLOUDFLARE_STAGING_CONTROL_TOKEN_PAYLOAD_CHARACTERS) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
    }
    assertMacOSKeychainSecret(encoded);
    return encoded;
  } finally { bytes.fill(0); }
}

function decodeTokenPayload(secret) {
  if (typeof secret !== 'string' || !TOKEN_PAYLOAD_BASE64URL.test(secret)) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
  }
  try { assertMacOSKeychainSecret(secret); }
  catch { fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN'); }
  let decoded;
  try {
    decoded = Buffer.from(secret, 'base64url');
    if (decoded.length !== TOKEN_PAYLOAD_BYTES
      || decoded.toString('base64url') !== secret) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
    const payload = JSON.parse(raw);
    if (!exactKeys(payload, [
      'schemaVersion', 'contract', 'apiToken', 'accountIdSha256',
      'tokenIdSha256', 'permissionContractSha256',
    ])
      || payload.schemaVersion !== 1 || payload.contract !== PAYLOAD_CONTRACT
      || canonicalJson(payload) !== raw
      || !SHA256.test(payload.accountIdSha256 ?? '')
      || !SHA256.test(payload.tokenIdSha256 ?? '')
      || !SHA256.test(payload.permissionContractSha256 ?? '')
      || payload.permissionContractSha256
        !== cloudflareStagingControlPermissionContractSha256(payload.accountIdSha256)) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
    }
    cloudflareStagingControlTokenSha256(payload.apiToken);
    return payload;
  } catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_STAGING_CONTROL_')) throw error;
    fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
  } finally { decoded?.fill(0); }
}

async function parseApiResponse(response) {
  const contentEncoding = response?.headers?.get?.('content-encoding');
  if (response?.status !== 200 || response?.ok !== true
    || contentEncoding !== null && contentEncoding !== undefined
      && contentEncoding.toLowerCase() !== 'identity') {
    try { await response?.body?.cancel?.(); } catch { /* rejection remains fail closed */ }
    fail('CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
  }
  let bytes;
  try {
    ({ bytes } = await readBootstrapResponseBody(response, {
      maximumBytes: MAX_BOOTSTRAP_RESPONSE_BYTES,
      errorCode: 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY',
    }));
    const { value } = parseBootstrapJsonBytes(
      bytes,
      response.headers?.get?.('content-type') ?? '',
      'CLOUDFLARE_E_STAGING_CONTROL_VERIFY',
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.success !== true || !Array.isArray(value.errors) || value.errors.length !== 0
      || !Array.isArray(value.messages) || !value.result
      || typeof value.result !== 'object' || Array.isArray(value.result)) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
    }
    return value.result;
  } finally { bytes?.fill(0); }
}

async function fetchExactJson(url, apiToken, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    return await parseApiResponse(response);
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY') throw error;
    fail('CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
  } finally { clearTimeout(timeout); }
}

export async function verifyCloudflareStagingControlToken({
  accountId,
  apiToken,
  expectedAccountIdSha256,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  validateAccountId(accountId);
  cloudflareStagingControlTokenSha256(apiToken);
  validDate(now, 'CLOUDFLARE_E_STAGING_CONTROL_TIME');
  if (typeof fetchImpl !== 'function') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_IMPLEMENTATION');
  }
  if (!SHA256.test(expectedAccountIdSha256 ?? '')
    || cloudflareAccountIdSha256(accountId) !== expectedAccountIdSha256) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');
  }
  const verifyUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`;
  const capabilityUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
  const verified = await fetchExactJson(verifyUrl, apiToken, fetchImpl);
  if (verified.status !== 'active' || !TOKEN_ID.test(verified.id ?? '')
    || typeof verified.not_before !== 'string' || typeof verified.expires_on !== 'string') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
  }
  const notBefore = parseInstant(verified.not_before, 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
  const expiresAt = parseInstant(verified.expires_on, 'CLOUDFLARE_E_STAGING_CONTROL_VERIFY');
  if (expiresAt.getTime() <= notBefore.getTime()
    || expiresAt.getTime() - notBefore.getTime() > MAXIMUM_LIFETIME_MS
    || now.getTime() < notBefore.getTime()
    || expiresAt.getTime() - now.getTime() < MINIMUM_REMAINING_MS) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_TIME');
  }
  const capability = await fetchExactJson(capabilityUrl, apiToken, fetchImpl);
  if (capability.subdomain !== EXPECTED_ACCOUNT_SUBDOMAIN) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');
  }
  return Object.freeze({
    status: 'active',
    tokenIdSha256: cloudflareStagingControlTokenIdSha256(verified.id),
    notBefore: notBefore.toISOString(),
    expiresAt: expiresAt.toISOString(),
    verifiedAt: now.toISOString(),
    accountIdSha256: expectedAccountIdSha256,
    accountCapabilityVerified: true,
    apiTokenSha256: cloudflareStagingControlTokenSha256(apiToken),
    permissionContractSha256:
      cloudflareStagingControlPermissionContractSha256(expectedAccountIdSha256),
  });
}

function createMetadata(verification) {
  return validateCloudflareStagingControlTokenMetadata({
    schemaVersion: 1,
    contract: METADATA_CONTRACT,
    keychainService: CLOUDFLARE_STAGING_CONTROL_TOKEN_SERVICE,
    keychainAccount: CLOUDFLARE_STAGING_CONTROL_TOKEN_ACCOUNT,
    purpose: CLOUDFLARE_STAGING_CONTROL_TOKEN_PURPOSE,
    environment: 'staging',
    accountIdSha256: verification.accountIdSha256,
    apiTokenSha256: verification.apiTokenSha256,
    tokenIdSha256: verification.tokenIdSha256,
    tokenType: 'Account API Token',
    status: verification.status,
    notBefore: verification.notBefore,
    expiresAt: verification.expiresAt,
    verifiedAt: verification.verifiedAt,
    permissionContractSha256: verification.permissionContractSha256,
  }, { now: new Date(verification.verifiedAt) });
}

async function readMetadata(metadataPath, expectedAccountIdSha256, readFile, now, {
  allowPartial = false,
} = {}) {
  let stored;
  let canonicalBytes;
  try {
    stored = await readFile(metadataPath, 64 * 1024, { allowEmpty: allowPartial });
    const parsed = parseCanonicalEvidenceStorage(stored);
    canonicalBytes = parsed.canonicalBytes;
    return validateCloudflareStagingControlTokenMetadata(parsed.payload, {
      expectedAccountIdSha256, now,
    });
  } catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_SIGNING_')
      || error?.message?.startsWith('CLOUDFLARE_E_STAGING_CONTROL_')) throw error;
    fail('CLOUDFLARE_E_STAGING_CONTROL_METADATA');
  } finally {
    stored?.fill(0);
    canonicalBytes?.fill(0);
  }
}

async function classifyMetadataDestination({
  metadataPath,
  expectedAccountIdSha256,
  assertDestination,
  readFile,
  now,
}) {
  try {
    await assertDestination(metadataPath);
    return Object.freeze({ state: 'absent', metadata: null });
  } catch (error) {
    if (error?.message !== 'CLOUDFLARE_E_SIGNING_FILE_EXISTS') throw error;
  }
  try {
    const metadata = await readMetadata(
      metadataPath, expectedAccountIdSha256, readFile, now, { allowPartial: true },
    );
    return Object.freeze({ state: 'valid', metadata });
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_E_SIGNING_CANONICAL') {
      return Object.freeze({ state: 'partial', metadata: null });
    }
    throw error;
  }
}

export async function initializeCloudflareStagingControlToken({
  accountId,
  expectedAccountIdSha256,
  metadataOutput = defaultCloudflareStagingControlTokenMetadataPath(),
  clipboard,
  store = new MacOSKeychainStore(),
  fetchImpl = globalThis.fetch,
  now = new Date(),
  assertDestination = assertSecureCreateOnlyDestination,
  writeMetadata = writeCanonicalEvidenceCreateOnly,
} = {}) {
  const recovery = cloudflareStagingControlTokenRecoveryMetadataPath(metadataOutput);
  const identity = cloudflareStagingControlTokenIdentity();
  let apiToken = '';
  let secret = '';
  let clipboardTouched = false;
  validateAccountId(accountId);
  if (!clipboard || typeof clipboard.preflight !== 'function'
    || typeof clipboard.readOnceAndClear !== 'function'
    || typeof clipboard.clear !== 'function') fail('CLOUDFLARE_E_STAGING_CONTROL_CLIPBOARD');
  try {
    await assertDestination(metadataOutput);
    await assertDestination(recovery);
    if (await store.get(identity.service, identity.account) !== null) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_EXISTS');
    }
    await clipboard.preflight();
    clipboardTouched = true;
    apiToken = await clipboard.readOnceAndClear();
    cloudflareStagingControlTokenSha256(apiToken);
    const verification = await verifyCloudflareStagingControlToken({
      accountId, apiToken, expectedAccountIdSha256, fetchImpl, now,
    });
    secret = encodeTokenPayload(apiToken, verification);
    try { await store.putCreateOnly(identity.service, identity.account, secret); }
    catch (error) {
      if (error?.message === 'CLOUDFLARE_E_SIGNING_KEY_EXISTS') {
        fail('CLOUDFLARE_E_STAGING_CONTROL_EXISTS');
      }
      throw error;
    }
    if (await store.get(identity.service, identity.account) !== secret) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
    }
    const metadata = createMetadata(verification);
    await assertDestination(metadataOutput);
    await writeMetadata(metadataOutput, metadata);
    return metadata;
  } finally {
    apiToken = '';
    secret = '';
    if (clipboardTouched) await clipboard.clear().catch(() => undefined);
  }
}

export async function recoverCloudflareStagingControlTokenMetadata({
  accountId,
  expectedAccountIdSha256,
  metadataOutput = defaultCloudflareStagingControlTokenMetadataPath(),
  recoveryMetadataOutput,
  store = new MacOSKeychainStore(),
  fetchImpl = globalThis.fetch,
  now = new Date(),
  assertDestination = assertSecureCreateOnlyDestination,
  readFile = readSecureFile,
  writeMetadata = writeCanonicalEvidenceCreateOnly,
} = {}) {
  const recovery = cloudflareStagingControlTokenRecoveryMetadataPath(metadataOutput);
  if (recoveryMetadataOutput !== undefined && recoveryMetadataOutput !== recovery) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STORE_PATH');
  }
  validateAccountId(accountId);
  const identity = cloudflareStagingControlTokenIdentity();
  const primaryClassification = await classifyMetadataDestination({
    metadataPath: metadataOutput,
    expectedAccountIdSha256,
    assertDestination,
    readFile,
    now,
  });
  const recoveryClassification = await classifyMetadataDestination({
    metadataPath: recovery,
    expectedAccountIdSha256,
    assertDestination,
    readFile,
    now,
  });
  if (primaryClassification.state === 'valid') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_EXISTS');
  }
  if (recoveryClassification.state !== 'absent') {
    fail('CLOUDFLARE_E_STAGING_CONTROL_RECOVERY_EXHAUSTED');
  }
  const destination = primaryClassification.state === 'absent' ? metadataOutput : recovery;
  let payload;
  try {
    payload = decodeTokenPayload(await store.get(identity.service, identity.account));
    const verification = await verifyCloudflareStagingControlToken({
      accountId, apiToken: payload.apiToken, expectedAccountIdSha256, fetchImpl, now,
    });
    if (payload.accountIdSha256 !== verification.accountIdSha256
      || payload.tokenIdSha256 !== verification.tokenIdSha256
      || payload.permissionContractSha256 !== verification.permissionContractSha256) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
    }
    const metadata = createMetadata(verification);
    await assertDestination(destination);
    await writeMetadata(destination, metadata);
    return metadata;
  } finally { payload = null; }
}

export async function loadCloudflareStagingControlToken({
  accountId,
  expectedAccountIdSha256,
  metadataPath = defaultCloudflareStagingControlTokenMetadataPath(),
  recoveryMetadataPath,
  store = new MacOSKeychainStore(),
  readFile = readSecureFile,
  now = new Date(),
} = {}) {
  validateAccountId(accountId);
  if (cloudflareAccountIdSha256(accountId) !== expectedAccountIdSha256) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_ACCOUNT');
  }
  const recovery = cloudflareStagingControlTokenRecoveryMetadataPath(metadataPath);
  if (recoveryMetadataPath !== undefined && recoveryMetadataPath !== recovery) {
    fail('CLOUDFLARE_E_STAGING_CONTROL_STORE_PATH');
  }
  let metadata;
  try {
    metadata = await readMetadata(metadataPath, expectedAccountIdSha256, readFile, now, {
      allowPartial: true,
    });
  } catch (error) {
    if (error?.message !== 'CLOUDFLARE_E_SIGNING_CANONICAL') throw error;
    try {
      metadata = await readMetadata(recovery, expectedAccountIdSha256, readFile, now, {
        allowPartial: true,
      });
    } catch (recoveryError) {
      if (recoveryError?.message === 'CLOUDFLARE_E_SIGNING_CANONICAL') {
        fail('CLOUDFLARE_E_STAGING_CONTROL_RECOVERY_EXHAUSTED');
      }
      if (recoveryError?.message?.startsWith('CLOUDFLARE_E_SIGNING_FILE')) {
        fail('CLOUDFLARE_E_STAGING_CONTROL_RECOVERY_REQUIRED');
      }
      throw recoveryError;
    }
  }
  let payload;
  try {
    payload = decodeTokenPayload(await store.get(metadata.keychainService, metadata.keychainAccount));
    const apiTokenSha256 = cloudflareStagingControlTokenSha256(payload.apiToken);
    if (payload.accountIdSha256 !== expectedAccountIdSha256
      || payload.permissionContractSha256
        !== cloudflareStagingControlPermissionContractSha256(expectedAccountIdSha256)) {
      fail('CLOUDFLARE_E_STAGING_CONTROL_KEYCHAIN');
    }
    validateCloudflareStagingControlTokenMetadata(metadata, {
      expectedAccountIdSha256, expectedApiTokenSha256: apiTokenSha256,
      expectedTokenIdSha256: payload.tokenIdSha256, now,
    });
    return { metadata, apiToken: payload.apiToken };
  } finally { payload = null; }
}
