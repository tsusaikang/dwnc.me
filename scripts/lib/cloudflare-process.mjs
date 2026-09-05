import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, fstatSync, readSync } from 'node:fs';
import {
  chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BOOTSTRAP_ATTEMPT_IDENTITY_KEYS,
  validateBootstrapAttemptIdentity,
} from './cloudflare-bootstrap-attempt.mjs';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';
import { readSecureFile, writeSecureCreateOnly } from './cloudflare-signing-key.mjs';
import { validateStagingSmokeToken } from '../../src/lib/staging-smoke-token.js';

const SAFE_ENVIRONMENT_NAMES = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'CI', 'NO_COLOR', 'FORCE_COLOR',
]);

export const R2_VALIDATION_ENVIRONMENT_NAMES = Object.freeze([
  'R2_CREDENTIALS_FD',
  'PUBLIC_MEDIA_REMOTE_RECEIPT_PATH', 'PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH',
  'PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH',
]);
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,80}$/u;
export const PINNED_WRANGLER_VERSION = '4.125.0';
export const PINNED_WRANGLER_CLI_SIZE = 20_524_522;
export const PINNED_WRANGLER_CLI_SHA256
  = '8642ffb286871a94617969aa64d351097a49783361834d8c4aec75adbddfa773';
export const PINNED_WRANGLER_PACKAGE_JSON_SHA256
  = '2acd581fd6f773f5d5e2aab1433bac9ff5b40d352d18786503dfdfa009823eb8';
export const PINNED_WRANGLER_RUNTIME_FILE_COUNT = 660;
export const PINNED_WRANGLER_RUNTIME_BYTES = 207_434_085;
export const PINNED_WRANGLER_RUNTIME_SHA256
  = 'a3c3dcd0bcecb7cb78994c96ac1711dd2fe985c7e698bfae1456e7610e0ae2eb';
export const STAGING_SMOKE_RUNNER_LIMITS = Object.freeze({
  totalTimeoutMs: 8 * 60 * 1_000,
  gracefulTerminationMs: 1_500,
  forcedSettleMs: 1_500,
  maximumOutputBytes: 1024 * 1024,
});
export const STAGING_SMOKE_NATIVE_CHILD_GUARD = Symbol.for(
  'dwnc.cloudflare.staging-smoke.native-child-guard.v1',
);
export const STAGING_SMOKE_SECRET_READ_OBSERVER = Symbol.for(
  'dwnc.cloudflare.staging-smoke.secret-read-observer.v1',
);
const SEALED_WRANGLER_RESOLUTION_GUARD = `'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const allowedRoot = fs.realpathSync(__dirname) + path.sep;
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function sealedResolveFilename(request, parent, isMain, options) {
  const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
  if (typeof resolved === 'string' && !resolved.startsWith('node:')
      && !Module.builtinModules.includes(resolved)) {
    let actual;
    try { actual = fs.realpathSync(resolved); }
    catch {
      const error = new Error('sealed module resolution blocked');
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    if (!actual.startsWith(allowedRoot)) {
      const error = new Error('sealed module resolution blocked');
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
  }
  return resolved;
};
`;
export const SEALED_WRANGLER_RESOLUTION_GUARD_BYTES = 946;
export const SEALED_WRANGLER_RESOLUTION_GUARD_SHA256
  = '49eb9466fe48a6b9ce55414933fc9034181d54107ea43626888858b6f0303416';
const PINNED_WRANGLER_PACKAGE_INTEGRITY
  = 'sha512-yFpvggu+xk1Hdm/Uxwaqa19bb7GArME4CrCS3Vov68a2TZq2MPO+wLocKbbnIC9K0oLowcdau7/ycxbbNHKCEg==';
const PINNED_WRANGLER_RESOLVED
  = 'https://registry.npmjs.org/wrangler/-/wrangler-4.125.0.tgz';
const PINNED_WRANGLER_RUNTIME_ROOTS = Object.freeze([
  'node_modules/wrangler/wrangler-dist/cli.js',
  'node_modules/wrangler/node_modules/esbuild',
  'node_modules/miniflare',
  'node_modules/undici',
  'node_modules/workerd',
  'node_modules/blake3-wasm',
  'node_modules/ws',
  'node_modules/@cloudflare/workerd-darwin-arm64',
  'node_modules/@esbuild/darwin-arm64',
]);
const CONTROL_PLANE_TOKEN_DESCRIPTOR = 3;
const CONTROL_PLANE_TOKEN_MAXIMUM_BYTES = 256;
const CONTROL_PLANE_TOKEN_FRAME_MAGIC = Buffer.from('DWNCCT1\0', 'ascii');
const CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES = CONTROL_PLANE_TOKEN_FRAME_MAGIC.length + 2;
const CONTROL_PLANE_TOKEN_FRAME_DIGEST_BYTES = 32;
const CONTROL_PLANE_TOKEN_FRAME_MAXIMUM_BYTES = CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES
  + CONTROL_PLANE_TOKEN_MAXIMUM_BYTES + CONTROL_PLANE_TOKEN_FRAME_DIGEST_BYTES;
const CONTROL_PLANE_LEGACY_TOKEN_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
]);
export const CLOUDFLARE_STAGING_CONTROL_OPERATIONS = Object.freeze([
  'staging-service-existence',
  'staging-bootstrap',
  'staging-bootstrap-recover',
  'staging-version-upload',
  'staging-version-detail',
  'staging-deployment-status',
  'staging-activate',
  'staging-workers-dev-status',
  'staging-workers-dev-enable',
]);
export const CLOUDFLARE_STAGING_WRANGLER_EXTRA_ALLOWLIST = Object.freeze([
  'WRANGLER_OUTPUT_FILE_PATH',
]);
const CLOUDFLARE_STAGING_CONTROL_OPERATION_SET
  = new Set(CLOUDFLARE_STAGING_CONTROL_OPERATIONS);
const SHA256 = /^[a-f0-9]{64}$/u;
const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const execFileAsync = promisify(execFile);

function isContainedPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function structuredErrorCode(error, fallback = 'CLOUDFLARE_E_UNEXPECTED') {
  const candidate = typeof error?.code === 'string'
    ? error.code
    : typeof error?.message === 'string' ? error.message : '';
  return SAFE_ERROR_CODE.test(candidate) ? candidate : fallback;
}

export function installStructuredErrorHandler(scope) {
  if (typeof scope !== 'string' || !/^[a-z][a-z0-9-]{2,40}$/u.test(scope)) {
    throw new Error('CLOUDFLARE_E_OBSERVABILITY_SCOPE');
  }
  const handler = (error) => {
    process.stderr.write(`${JSON.stringify({
      event: 'dwnc_cloudflare_error', scope, code: structuredErrorCode(error),
    })}\n`);
    process.exit(1);
  };
  process.once('uncaughtException', handler);
  process.once('unhandledRejection', handler);
}

export function sanitizedEnvironment(source = process.env, extra = {}) {
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (typeof source[name] === 'string') environment[name] = source[name];
  }
  return { ...environment, ...extra };
}

export function remoteValidationEnvironment(source = process.env) {
  const environment = sanitizedEnvironment(source);
  for (const name of R2_VALIDATION_ENVIRONMENT_NAMES) {
    if (typeof source[name] === 'string') environment[name] = source[name];
  }
  return environment;
}

export function cloudflareWranglerEnvironment(source = process.env, extra = {}) {
  if (Object.hasOwn(source, 'CLOUDFLARE_API_TOKEN')
    || Object.hasOwn(source, 'CF_API_TOKEN')
    || Object.hasOwn(extra, 'CLOUDFLARE_API_TOKEN')
    || Object.hasOwn(extra, 'CF_API_TOKEN')) {
    throw new Error('CLOUDFLARE_E_WRANGLER_TOKEN_ENV_FORBIDDEN');
  }
  if (typeof source.CLOUDFLARE_ACCOUNT_ID !== 'string'
    || !/^[A-Fa-f0-9]{32}$/u.test(source.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error('CLOUDFLARE_E_WRANGLER_ACCOUNT');
  }
  return sanitizedEnvironment(source, {
    CLOUDFLARE_ACCOUNT_ID: source.CLOUDFLARE_ACCOUNT_ID,
    ...(typeof source.CLOUDFLARE_COMPLIANCE_REGION === 'string'
      ? { CLOUDFLARE_COMPLIANCE_REGION: source.CLOUDFLARE_COMPLIANCE_REGION } : {}),
    ...extra,
  });
}

export function cloudflareOAuthWranglerEnvironment(source = process.env, extra = {}) {
  const forbidden = [
    'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN',
    'CLOUDFLARE_API_KEY', 'CF_API_KEY', 'CLOUDFLARE_EMAIL',
  ];
  if (forbidden.some((name) => Object.hasOwn(source, name) || Object.hasOwn(extra, name))) {
    throw new Error('CLOUDFLARE_E_WRANGLER_OAUTH_ENV_FORBIDDEN');
  }
  return sanitizedEnvironment(source, {
    ...(typeof source.CLOUDFLARE_COMPLIANCE_REGION === 'string'
      ? { CLOUDFLARE_COMPLIANCE_REGION: source.CLOUDFLARE_COMPLIANCE_REGION } : {}),
    ...extra,
  });
}

export async function inspectCloudflareOAuthAccount({
  root = process.cwd(),
  expectedAccountIdSha256,
  environment = process.env,
  execFileImpl = execFileAsync,
} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)
    || !SHA256.test(expectedAccountIdSha256 ?? '')
    || typeof execFileImpl !== 'function') {
    throw new Error('CLOUDFLARE_E_WRANGLER_OAUTH_ACCOUNT');
  }
  let stdout = '';
  try {
    ({ stdout } = await execFileImpl(path.join(root, 'node_modules/.bin/wrangler'), [
      'whoami', '--json',
    ], {
      cwd: root,
      env: cloudflareOAuthWranglerEnvironment(environment, {
        WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
        WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true', NO_COLOR: '1',
      }),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }));
    const value = JSON.parse(stdout);
    if (value?.loggedIn !== true || value.authType !== 'OAuth Token'
      || !Array.isArray(value.accounts) || value.accounts.length !== 1
      || !ACCOUNT_ID.test(value.accounts[0]?.id ?? '')
      || cloudflareAccountIdSha256(value.accounts[0].id.toLowerCase())
        !== expectedAccountIdSha256) {
      throw new Error('CLOUDFLARE_E_WRANGLER_OAUTH_ACCOUNT');
    }
    return Object.freeze({
      authenticated: true,
      authType: 'OAuth Token',
      accountCount: 1,
      accountIdSha256: expectedAccountIdSha256,
    });
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_E_WRANGLER_OAUTH_ACCOUNT') throw error;
    throw new Error('CLOUDFLARE_E_WRANGLER_OAUTH_ACCOUNT');
  } finally {
    stdout = '';
  }
}

export function assertStagingControlOperationEnvelope(source = process.env, expectedOperation) {
  if (!CLOUDFLARE_STAGING_CONTROL_OPERATION_SET.has(expectedOperation)
    || source.CLOUDFLARE_STAGING_CONTROL_VERIFIED !== 'v1'
    || source.CLOUDFLARE_STAGING_CONTROL_OPERATION !== expectedOperation
    || source.CLOUDFLARE_API_TOKEN_FD !== '3'
    || !ACCOUNT_ID.test(source.CLOUDFLARE_ACCOUNT_ID ?? '')
    || !SHA256.test(source.CLOUDFLARE_STAGING_CONTROL_METADATA_SHA256 ?? '')
    || !SHA256.test(source.CLOUDFLARE_STAGING_CONTROL_PREFLIGHT_SHA256 ?? '')
    || !SHA256.test(source.CLOUDFLARE_STAGING_CONTROL_ACCOUNT_SHA256 ?? '')
    || !SHA256.test(source.CLOUDFLARE_STAGING_CONTROL_TOKEN_SHA256 ?? '')
    || !SHA256.test(source.CLOUDFLARE_STAGING_CONTROL_PERMISSION_SHA256 ?? '')
    || CONTROL_PLANE_LEGACY_TOKEN_NAMES
      .some((name) => Object.hasOwn(source, name))) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ENVELOPE');
  }
  const authRoot = source.CLOUDFLARE_STAGING_CONTROL_AUTH_ROOT;
  const isolatedHome = source.HOME;
  const xdgConfig = source.XDG_CONFIG_HOME;
  const xdgCache = source.XDG_CACHE_HOME;
  const xdgData = source.XDG_DATA_HOME;
  const temporary = source.TMPDIR;
  const envFile = source.CLOUDFLARE_STAGING_CONTROL_ENV_FILE;
  const recoveryHomeOverride = source.CLOUDFLARE_BOOTSTRAP_RECOVERY_HOME;
  const recoveryAuthenticationGetCountOverride
    = source.CLOUDFLARE_STAGING_CONTROL_AUTHENTICATION_GET_COUNT;
  if (![authRoot, isolatedHome, xdgConfig, xdgCache, xdgData, temporary, envFile]
    .every((value) => typeof value === 'string' && path.isAbsolute(value)
      && path.resolve(value) === value)
    || ![isolatedHome, xdgConfig, xdgCache, xdgData, temporary, envFile]
      .every((value) => value !== authRoot && isContainedPath(authRoot, value))
    || new Set([isolatedHome, xdgConfig, xdgCache, xdgData, temporary, envFile]).size !== 6
    || source.TMP !== temporary || source.TEMP !== temporary
    || source.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV !== 'false'
    || source.CLOUDFLARE_INCLUDE_PROCESS_ENV !== 'false'
    || source.WRANGLER_SEND_METRICS !== 'false'
    || source.WRANGLER_SEND_ERROR_REPORTS !== 'false'
    || !['0', 'false'].includes(source.WRANGLER_WRITE_LOGS)
    || recoveryHomeOverride !== undefined
    || recoveryAuthenticationGetCountOverride !== undefined
    || source.CI !== '1') {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_ISOLATION');
  }
  return {
    operation: expectedOperation,
    accountId: source.CLOUDFLARE_ACCOUNT_ID,
    metadataSha256: source.CLOUDFLARE_STAGING_CONTROL_METADATA_SHA256,
    preflightSha256: source.CLOUDFLARE_STAGING_CONTROL_PREFLIGHT_SHA256,
    accountIdSha256: source.CLOUDFLARE_STAGING_CONTROL_ACCOUNT_SHA256,
    apiTokenSha256: source.CLOUDFLARE_STAGING_CONTROL_TOKEN_SHA256,
    permissionContractSha256: source.CLOUDFLARE_STAGING_CONTROL_PERMISSION_SHA256,
    authRoot,
    envFile,
    authenticationRequestCounts: expectedOperation === 'staging-bootstrap-recover'
      ? { GET: 2, HEAD: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 } : null,
  };
}

export function cloudflareStagingWranglerEnvironment(source, credentials, {
  expectedOperation,
  extra = {},
} = {}) {
  const envelope = assertStagingControlOperationEnvelope(source, expectedOperation);
  if (!credentials || credentials.accountId !== envelope.accountId
    || !ACCOUNT_ID.test(credentials.accountId ?? '')
    || typeof credentials.apiToken !== 'string'
    || !/^cfat_[A-Za-z0-9]{40}[a-f0-9]{8}$/u.test(credentials.apiToken)
    || !extra || typeof extra !== 'object' || Array.isArray(extra)
    || Object.keys(extra).some((name) => !CLOUDFLARE_STAGING_WRANGLER_EXTRA_ALLOWLIST
      .includes(name))
    || Object.hasOwn(extra, 'WRANGLER_OUTPUT_FILE_PATH')
      && (typeof extra.WRANGLER_OUTPUT_FILE_PATH !== 'string'
        || !path.isAbsolute(extra.WRANGLER_OUTPUT_FILE_PATH)
        || path.resolve(extra.WRANGLER_OUTPUT_FILE_PATH) !== extra.WRANGLER_OUTPUT_FILE_PATH
        || !isContainedPath(source.TMPDIR, extra.WRANGLER_OUTPUT_FILE_PATH))) {
    throw new Error('CLOUDFLARE_E_STAGING_CONTROL_WRANGLER');
  }
  return sanitizedEnvironment(source, {
    PATH: '/usr/bin:/bin',
    HOME: source.HOME,
    TMPDIR: source.TMPDIR,
    TMP: source.TMP,
    TEMP: source.TEMP,
    XDG_CONFIG_HOME: source.XDG_CONFIG_HOME,
    XDG_CACHE_HOME: source.XDG_CACHE_HOME,
    XDG_DATA_HOME: source.XDG_DATA_HOME,
    CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
    CLOUDFLARE_API_TOKEN: credentials.apiToken,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    WRANGLER_WRITE_LOGS: '0',
    WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
    WS_NO_BUFFER_UTIL: '1',
    WS_NO_UTF_8_VALIDATE: '1',
    CI: '1',
    NO_COLOR: '1',
    ...extra,
  });
}

export function encodeCloudflareControlPlaneTokenFrame(apiToken) {
  if (typeof apiToken !== 'string'
    || !/^[A-Za-z0-9._~+\/-]{20,256}={0,2}$/u.test(apiToken)) {
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  }
  const tokenBytes = Buffer.from(apiToken, 'utf8');
  const frame = Buffer.alloc(CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES + tokenBytes.length
    + CONTROL_PLANE_TOKEN_FRAME_DIGEST_BYTES);
  try {
    CONTROL_PLANE_TOKEN_FRAME_MAGIC.copy(frame, 0);
    frame.writeUInt16BE(tokenBytes.length, CONTROL_PLANE_TOKEN_FRAME_MAGIC.length);
    tokenBytes.copy(frame, CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES);
    createHash('sha256').update(tokenBytes).digest().copy(
      frame, CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES + tokenBytes.length,
    );
    return frame;
  } finally { tokenBytes.fill(0); }
}

function decodeCloudflareControlPlaneTokenFrame(frame) {
  if (!Buffer.isBuffer(frame)
    || frame.length < CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES
      + 20 + CONTROL_PLANE_TOKEN_FRAME_DIGEST_BYTES
    || frame.length > CONTROL_PLANE_TOKEN_FRAME_MAXIMUM_BYTES
    || !frame.subarray(0, CONTROL_PLANE_TOKEN_FRAME_MAGIC.length)
      .equals(CONTROL_PLANE_TOKEN_FRAME_MAGIC)) {
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  }
  const length = frame.readUInt16BE(CONTROL_PLANE_TOKEN_FRAME_MAGIC.length);
  const expectedLength = CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES + length
    + CONTROL_PLANE_TOKEN_FRAME_DIGEST_BYTES;
  if (length < 20 || length > CONTROL_PLANE_TOKEN_MAXIMUM_BYTES
    || frame.length !== expectedLength) {
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  }
  const tokenBytes = frame.subarray(
    CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES,
    CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES + length,
  );
  const digest = frame.subarray(CONTROL_PLANE_TOKEN_FRAME_HEADER_BYTES + length);
  if (!createHash('sha256').update(tokenBytes).digest().equals(digest)) {
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  }
  let apiToken;
  try { apiToken = new TextDecoder('utf-8', { fatal: true }).decode(tokenBytes); }
  catch { throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD'); }
  if (Buffer.byteLength(apiToken, 'utf8') !== length
    || !/^[A-Za-z0-9._~+\/-]{20,256}={0,2}$/u.test(apiToken)) {
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  }
  return apiToken;
}

export function cloudflareControlPlaneCredentials(source = process.env) {
  const fdDefined = Object.hasOwn(source, 'CLOUDFLARE_API_TOKEN_FD');
  const legacyDefined = Object.hasOwn(source, 'CLOUDFLARE_API_TOKEN');
  const r2S3Defined = [
    'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_CREDENTIALS_FD',
  ].some((name) => Object.hasOwn(source, name));
  if (r2S3Defined) throw new Error('CLOUDFLARE_E_CONTROL_CREDENTIAL_AMBIGUOUS');
  if (fdDefined && legacyDefined) throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_AMBIGUOUS');
  if (legacyDefined || !fdDefined) throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD_REQUIRED');
  if (source.CLOUDFLARE_API_TOKEN_FD !== '3'
    || typeof source.CLOUDFLARE_ACCOUNT_ID !== 'string'
    || !/^[A-Fa-f0-9]{32}$/u.test(source.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  }
  let bytes;
  try {
    const stats = fstatSync(3);
    if (!(stats.isFIFO() || stats.isSocket()) || stats.nlink !== 0
      || ![0o600, 0o666].includes(stats.mode & 0o777)
      || typeof process.getuid === 'function' && stats.uid !== process.getuid()
      || stats.size < 0 || stats.size > 4096) {
      throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
    }
    bytes = Buffer.alloc(4097);
    let total = 0;
    while (true) {
      const count = readSync(3, bytes, total, bytes.length - total, null);
      if (count === 0) break;
      total += count;
      if (total > 4096) throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
    }
    const apiToken = bytes.subarray(0, total).toString('utf8');
    if (!/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/u.test(apiToken)) {
      throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
    }
    return {
      accountId: source.CLOUDFLARE_ACCOUNT_ID,
      apiToken,
      environment: sanitizedEnvironment(source, {
        CLOUDFLARE_ACCOUNT_ID: source.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN_FD: '3',
      }),
    };
  } catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_CONTROL_TOKEN_')) throw error;
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  } finally { bytes?.fill(0); }
}

export function cloudflareControlPlaneReadCredentials(source = process.env, {
  descriptor = CONTROL_PLANE_TOKEN_DESCRIPTOR,
  fstat = fstatSync,
  read = readSync,
  getuid = typeof process.getuid === 'function' ? () => process.getuid() : null,
} = {}) {
  const fdDefined = Object.hasOwn(source, 'CLOUDFLARE_API_TOKEN_FD');
  const legacyDefined = CONTROL_PLANE_LEGACY_TOKEN_NAMES
    .some((name) => Object.hasOwn(source, name));
  const r2S3Defined = [
    'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_CREDENTIALS_FD',
  ].some((name) => Object.hasOwn(source, name));
  if (r2S3Defined) throw new Error('CLOUDFLARE_E_CONTROL_CREDENTIAL_AMBIGUOUS');
  if (fdDefined && legacyDefined) throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_AMBIGUOUS');
  if (legacyDefined || !fdDefined) throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD_REQUIRED');
  if (descriptor !== CONTROL_PLANE_TOKEN_DESCRIPTOR
    || source.CLOUDFLARE_API_TOKEN_FD !== String(descriptor)
    || typeof source.CLOUDFLARE_ACCOUNT_ID !== 'string'
    || !/^[A-Fa-f0-9]{32}$/u.test(source.CLOUDFLARE_ACCOUNT_ID)) {
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  }
  let bytes;
  try {
    const stats = fstat(descriptor);
    if (!(stats.isFIFO() || stats.isSocket()) || stats.nlink !== 0
      || ![0o600, 0o666].includes(stats.mode & 0o777)
      || getuid !== null && stats.uid !== getuid()
      || stats.size < 0 || stats.size > CONTROL_PLANE_TOKEN_FRAME_MAXIMUM_BYTES) {
      throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
    }
    bytes = Buffer.alloc(CONTROL_PLANE_TOKEN_FRAME_MAXIMUM_BYTES + 1);
    let total = 0;
    while (true) {
      const remaining = bytes.length - total;
      if (remaining <= 0) throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
      const count = read(descriptor, bytes, total, remaining, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > remaining) {
        throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
      }
      if (count === 0) break;
      total += count;
      if (total > CONTROL_PLANE_TOKEN_FRAME_MAXIMUM_BYTES) {
        throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
      }
    }
    if (total === 0) throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
    const apiToken = decodeCloudflareControlPlaneTokenFrame(bytes.subarray(0, total));
    return {
      accountId: source.CLOUDFLARE_ACCOUNT_ID,
      apiToken,
      environment: sanitizedEnvironment(source, {
        CLOUDFLARE_ACCOUNT_ID: source.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN_FD: String(descriptor),
      }),
    };
  } catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_CONTROL_TOKEN_')) throw error;
    throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
  } finally {
    bytes?.fill(0);
  }
}

export function stagingSmokeTokenFromEnvironment(source = process.env, {
  descriptor = 3,
} = {}) {
  if (Object.hasOwn(source, 'CLOUDFLARE_STAGING_SMOKE_TOKEN')) {
    throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_ENV_FORBIDDEN');
  }
  if (!Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 64
    || source.CLOUDFLARE_STAGING_SMOKE_TOKEN_FD !== String(descriptor)) {
    throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_FD_REQUIRED');
  }
  let bytes;
  try {
    const stats = fstatSync(descriptor);
    if (!(stats.isFIFO() || stats.isSocket()) || stats.nlink !== 0
      || ![0o600, 0o666].includes(stats.mode & 0o777)
      || typeof process.getuid === 'function' && stats.uid !== process.getuid()
      || stats.size < 0) {
      throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_FD');
    }
    bytes = Buffer.alloc(44);
    let total = 0;
    while (true) {
      const count = readSync(descriptor, bytes, total, bytes.length - total, null);
      if (count === 0) break;
      total += count;
      if (total > 43) throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_BYTES');
    }
    if (total !== 43) throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_BYTES');
    let token;
    try { token = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)); }
    catch { throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_BYTES'); }
    if (Buffer.byteLength(token, 'utf8') !== total) throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_BYTES');
    return validateStagingSmokeToken(token);
  } catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_SMOKE_TOKEN_')) throw error;
    throw new Error('CLOUDFLARE_E_SMOKE_TOKEN_FD');
  } finally { bytes?.fill(0); }
}

export async function runStagingSmokeAfterLocalPreflight({
  preflight,
  readToken,
  startChild,
  signal,
}) {
  if (typeof preflight !== 'function' || typeof readToken !== 'function'
    || typeof startChild !== 'function'
    || signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_BOUNDARY');
  }
  const assertActive = () => {
    if (signal?.aborted) throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
  };
  assertActive();
  await preflight(signal);
  assertActive();
  let tokenBytes;
  try {
    tokenBytes = await readToken();
    assertActive();
    if (!Buffer.isBuffer(tokenBytes) || tokenBytes.length !== 43) {
      throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_BOUNDARY');
    }
    return await startChild(tokenBytes, signal);
  } finally {
    tokenBytes?.fill(0);
  }
}

export function stagingSmokeTokenBytesFromSecretsFile(stored) {
  if (!Buffer.isBuffer(stored) || stored.length === 0 || stored.length > 4096) {
    throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE');
  }
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(stored); }
  catch { throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE'); }
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE'); }
  const token = payload?.DWNC_STAGING_SMOKE_TOKEN;
  if (!payload || Object.keys(payload).length !== 1
    || raw !== `${JSON.stringify({ DWNC_STAGING_SMOKE_TOKEN: token })}\n`) {
    throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE');
  }
  try { validateStagingSmokeToken(token); }
  catch { throw new Error('CLOUDFLARE_E_STAGING_SECRET_FILE'); }
  return Buffer.from(token, 'utf8');
}

export function assertCloudflareAccountTarget(accountId, expectedSha256) {
  if (typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)
    || !/^[a-f0-9]{64}$/u.test(expectedSha256 ?? '')
    || cloudflareAccountIdSha256(accountId.toLowerCase()) !== expectedSha256) {
    throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
  }
}

function stableFileIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino
    && before.size === after.size && before.nlink === after.nlink
    && before.mode === after.mode && before.mtimeMs === after.mtimeMs
    && before.ctimeMs === after.ctimeMs;
}

function runtimeTreeDigest(entries) {
  const canonical = entries.map((entry) => `${JSON.stringify(entry.relativePath)}\t${entry.mode}`
    + `\t${entry.size}\t${entry.sha256}\n`).join('');
  return createHash('sha256').update(canonical).digest('hex');
}

async function inspectPinnedWranglerRuntime(root, { sealed = false } = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
  }
  const entries = [];
  const walk = async (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    const before = await lstat(absolutePath);
    const resolved = await realpath(absolutePath);
    if (resolved !== absolutePath || before.isSymbolicLink()
      || (before.mode & 0o022) !== 0
      || typeof process.getuid === 'function' && before.uid !== process.getuid()) {
      throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
    }
    if (before.isDirectory()) {
      if (sealed && (before.mode & 0o777) !== 0o700) {
        throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
      }
      const names = await readdir(absolutePath);
      names.sort();
      for (const name of names) await walk(path.join(relativePath, name));
      const after = await lstat(absolutePath);
      if (!stableFileIdentity(before, after)) {
        throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
      }
      return;
    }
    if (!before.isFile() || before.nlink !== 1 || before.size < 0) {
      throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
    }
    let bytes;
    try {
      bytes = await readFile(absolutePath);
      const after = await lstat(absolutePath);
      if (!stableFileIdentity(before, after) || bytes.length !== before.size) {
        throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
      }
      entries.push({
        absolutePath,
        relativePath: relativePath.split(path.sep).join('/'),
        mode: before.mode & 0o111 ? 'x' : 'r',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } finally { bytes?.fill(0); }
  };
  for (const relativePath of PINNED_WRANGLER_RUNTIME_ROOTS) await walk(relativePath);
  entries.sort((left, right) => left.relativePath < right.relativePath
    ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  const runtimeSha256 = runtimeTreeDigest(entries);
  if (entries.length !== PINNED_WRANGLER_RUNTIME_FILE_COUNT
    || totalBytes !== PINNED_WRANGLER_RUNTIME_BYTES
    || runtimeSha256 !== PINNED_WRANGLER_RUNTIME_SHA256) {
    throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
  }
  const cli = entries.find((entry) => entry.relativePath
    === 'node_modules/wrangler/wrangler-dist/cli.js');
  if (!cli || cli.size !== PINNED_WRANGLER_CLI_SIZE
    || cli.sha256 !== PINNED_WRANGLER_CLI_SHA256 || cli.mode !== 'r') {
    throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
  }
  return { entries, totalBytes, runtimeSha256, cli };
}

export function assertPinnedWranglerDescriptor(descriptor, root = process.cwd()) {
  const expectedCli = path.join(root, 'node_modules/wrangler/wrangler-dist/cli.js');
  const keys = [
    'version', 'cli', 'cliSize', 'cliSha256', 'runtimeFileCount', 'runtimeBytes',
    'runtimeSha256', 'packageJsonSha256',
  ];
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || !descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
    || Object.keys(descriptor).length !== keys.length
    || Object.keys(descriptor).some((key) => !keys.includes(key))
    || descriptor.version !== PINNED_WRANGLER_VERSION
    || descriptor.cli !== expectedCli || !path.isAbsolute(descriptor.cli)
    || path.resolve(descriptor.cli) !== descriptor.cli
    || descriptor.cliSize !== PINNED_WRANGLER_CLI_SIZE
    || descriptor.cliSha256 !== PINNED_WRANGLER_CLI_SHA256
    || descriptor.runtimeFileCount !== PINNED_WRANGLER_RUNTIME_FILE_COUNT
    || descriptor.runtimeBytes !== PINNED_WRANGLER_RUNTIME_BYTES
    || descriptor.runtimeSha256 !== PINNED_WRANGLER_RUNTIME_SHA256
    || descriptor.packageJsonSha256 !== PINNED_WRANGLER_PACKAGE_JSON_SHA256) {
    throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
  }
  return Object.freeze({ ...descriptor });
}

export function assertSealedWranglerDescriptor(descriptor, authRoot) {
  const expectedCli = path.join(
    authRoot, 'sealed-wrangler/node_modules/wrangler/wrangler-dist/cli.js',
  );
  const expectedGuard = path.join(authRoot, 'sealed-wrangler/resolution-guard.cjs');
  const keys = [
    'version', 'cli', 'cliSize', 'cliSha256', 'runtimeFileCount', 'runtimeBytes',
    'runtimeSha256', 'guard', 'guardBytes', 'guardSha256',
  ];
  if (typeof authRoot !== 'string' || !path.isAbsolute(authRoot)
    || path.resolve(authRoot) !== authRoot
    || !descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
    || Object.keys(descriptor).length !== keys.length
    || Object.keys(descriptor).some((key) => !keys.includes(key))
    || descriptor.version !== PINNED_WRANGLER_VERSION || descriptor.cli !== expectedCli
    || !path.isAbsolute(descriptor.cli) || path.resolve(descriptor.cli) !== descriptor.cli
    || descriptor.guard !== expectedGuard || !path.isAbsolute(descriptor.guard)
    || path.resolve(descriptor.guard) !== descriptor.guard
    || descriptor.cliSize !== PINNED_WRANGLER_CLI_SIZE
    || descriptor.cliSha256 !== PINNED_WRANGLER_CLI_SHA256
    || descriptor.runtimeFileCount !== PINNED_WRANGLER_RUNTIME_FILE_COUNT
    || descriptor.runtimeBytes !== PINNED_WRANGLER_RUNTIME_BYTES
    || descriptor.runtimeSha256 !== PINNED_WRANGLER_RUNTIME_SHA256
    || descriptor.guardBytes !== SEALED_WRANGLER_RESOLUTION_GUARD_BYTES
    || descriptor.guardSha256 !== SEALED_WRANGLER_RESOLUTION_GUARD_SHA256) {
    throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
  }
  return Object.freeze({ ...descriptor });
}

export async function assertPinnedWranglerInstalled(root = process.cwd()) {
  let packageVersion;
  let installedVersion;
  try {
    packageVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
      .config?.wranglerVersion;
    installedVersion = JSON.parse(await readFile(
      path.join(root, 'node_modules/wrangler/package.json'), 'utf8')).version;
  } catch { throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED'); }
  if (packageVersion !== PINNED_WRANGLER_VERSION || installedVersion !== packageVersion) {
    throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
  }
  return installedVersion;
}

export async function assertPinnedWranglerEntrypointInstalled(root = process.cwd()) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root) {
    throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
  }
  const packageRoot = path.join(root, 'node_modules/wrangler');
  const packageJsonPath = path.join(packageRoot, 'package.json');
  let projectPackageBytes;
  let lockBytes;
  let installedPackageBytes;
  try {
    const [packageRootStats, packageJsonStats,
      resolvedPackageRoot, resolvedPackageJson] = await Promise.all([
      lstat(packageRoot), lstat(packageJsonPath),
      realpath(packageRoot), realpath(packageJsonPath),
    ]);
    if (!packageRootStats.isDirectory() || packageRootStats.isSymbolicLink()
      || !packageJsonStats.isFile() || packageJsonStats.isSymbolicLink()
      || packageJsonStats.nlink !== 1
      || packageJsonStats.size < 1 || packageJsonStats.size > 64 * 1024
      || resolvedPackageRoot !== packageRoot || resolvedPackageJson !== packageJsonPath
      || (packageRootStats.mode & 0o022) !== 0 || (packageJsonStats.mode & 0o022) !== 0) {
      throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
    }
    [projectPackageBytes, lockBytes, installedPackageBytes] = await Promise.all([
      readFile(path.join(root, 'package.json')),
      readFile(path.join(root, 'package-lock.json')),
      readFile(packageJsonPath),
    ]);
    if (projectPackageBytes.length > 64 * 1024 || lockBytes.length > 16 * 1024 * 1024
      || installedPackageBytes.length !== packageJsonStats.size) {
      throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
    }
    const projectPackage = JSON.parse(projectPackageBytes.toString('utf8'));
    const lock = JSON.parse(lockBytes.toString('utf8'));
    const installedPackage = JSON.parse(installedPackageBytes.toString('utf8'));
    const locked = lock.packages?.['node_modules/wrangler'];
    if (projectPackage.config?.wranglerVersion !== PINNED_WRANGLER_VERSION
      || projectPackage.devDependencies?.wrangler !== PINNED_WRANGLER_VERSION
      || lock.packages?.['']?.devDependencies?.wrangler !== PINNED_WRANGLER_VERSION
      || locked?.version !== PINNED_WRANGLER_VERSION
      || locked?.resolved !== PINNED_WRANGLER_RESOLVED
      || locked?.integrity !== PINNED_WRANGLER_PACKAGE_INTEGRITY
      || installedPackage.version !== PINNED_WRANGLER_VERSION
      || installedPackage.main !== 'wrangler-dist/cli.js'
      || installedPackage.bin?.wrangler !== './bin/wrangler.js') {
      throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
    }
    const runtime = await inspectPinnedWranglerRuntime(root);
    return assertPinnedWranglerDescriptor({
      version: installedPackage.version,
      cli: runtime.cli.absolutePath,
      cliSize: runtime.cli.size,
      cliSha256: runtime.cli.sha256,
      runtimeFileCount: runtime.entries.length,
      runtimeBytes: runtime.totalBytes,
      runtimeSha256: runtime.runtimeSha256,
      packageJsonSha256: createHash('sha256').update(installedPackageBytes).digest('hex'),
    }, root);
  } catch (error) {
    if (error?.message === 'CLOUDFLARE_E_WRANGLER_VERSION') throw error;
    throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
  }
  finally {
    projectPackageBytes?.fill(0);
    lockBytes?.fill(0);
    installedPackageBytes?.fill(0);
  }
}

export async function sealPinnedWranglerRuntime(descriptor, authRoot,
  root = process.cwd()) {
  assertPinnedWranglerDescriptor(descriptor, root);
  if (typeof authRoot !== 'string' || !path.isAbsolute(authRoot)
    || path.resolve(authRoot) !== authRoot) {
    throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
  }
  const authStats = await lstat(authRoot);
  if (!authStats.isDirectory() || authStats.isSymbolicLink()
    || (authStats.mode & 0o777) !== 0o700
    || typeof process.getuid === 'function' && authStats.uid !== process.getuid()
    || await realpath(authRoot) !== authRoot) {
    throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
  }
  const runtimeRoot = path.join(authRoot, 'sealed-wrangler');
  await mkdir(runtimeRoot, { mode: 0o700 });
  const guard = path.join(runtimeRoot, 'resolution-guard.cjs');
  let guardBytes;
  let storedGuardBytes;
  try {
    guardBytes = Buffer.from(SEALED_WRANGLER_RESOLUTION_GUARD, 'utf8');
    if (guardBytes.length !== SEALED_WRANGLER_RESOLUTION_GUARD_BYTES
      || createHash('sha256').update(guardBytes).digest('hex')
        !== SEALED_WRANGLER_RESOLUTION_GUARD_SHA256) {
      throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
    }
    await writeFile(guard, guardBytes, { flag: 'wx', mode: 0o400 });
    const before = await lstat(guard);
    storedGuardBytes = await readFile(guard);
    const after = await lstat(guard);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || (before.mode & 0o777) !== 0o400 || !stableFileIdentity(before, after)
      || await realpath(guard) !== guard
      || storedGuardBytes.length !== SEALED_WRANGLER_RESOLUTION_GUARD_BYTES
      || createHash('sha256').update(storedGuardBytes).digest('hex')
        !== SEALED_WRANGLER_RESOLUTION_GUARD_SHA256) {
      throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
    }
  } finally {
    guardBytes?.fill(0);
    storedGuardBytes?.fill(0);
  }
  const source = await inspectPinnedWranglerRuntime(root);
  const createdDirectories = new Set([runtimeRoot]);
  for (const entry of source.entries) {
    const destination = path.join(runtimeRoot, entry.relativePath);
    const parent = path.dirname(destination);
    if (!createdDirectories.has(parent)) {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      createdDirectories.add(parent);
    }
    const before = await lstat(entry.absolutePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size !== entry.size || (before.mode & 0o022) !== 0
      || (before.mode & 0o111 ? 'x' : 'r') !== entry.mode
      || typeof process.getuid === 'function' && before.uid !== process.getuid()) {
      throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
    }
    await copyFile(entry.absolutePath, destination,
      fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE);
    const after = await lstat(entry.absolutePath);
    if (!stableFileIdentity(before, after)) {
      throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
    }
    await chmod(destination, entry.mode === 'x' ? 0o500 : 0o400);
  }
  const sealed = await inspectPinnedWranglerRuntime(runtimeRoot, { sealed: true });
  return assertSealedWranglerDescriptor({
    version: descriptor.version,
    cli: sealed.cli.absolutePath,
    cliSize: sealed.cli.size,
    cliSha256: sealed.cli.sha256,
    runtimeFileCount: sealed.entries.length,
    runtimeBytes: sealed.totalBytes,
    runtimeSha256: sealed.runtimeSha256,
    guard,
    guardBytes: SEALED_WRANGLER_RESOLUTION_GUARD_BYTES,
    guardSha256: SEALED_WRANGLER_RESOLUTION_GUARD_SHA256,
  }, authRoot);
}

export async function claimOneTimeAuthorization({
  directory, authorizationSha256, scope, target, binding = null,
  now = () => new Date(), hooks = {},
}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || !/^[a-f0-9]{64}$/u.test(authorizationSha256 ?? '')
    || !/^[a-z][a-z0-9-]{2,40}$/u.test(scope ?? '')
    || typeof target !== 'string' || target.length === 0 || target.length > 128
    || /[\u0000-\u001f\u007f]/u.test(target)) {
    throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  }
  const file = path.join(directory, `${scope}-${authorizationSha256}.json`);
  let claimedAt;
  try { claimedAt = now(); }
  catch { throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT'); }
  if (!(claimedAt instanceof Date) || Number.isNaN(claimedAt.getTime())) {
    throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  }
  let payloadValue;
  if (binding === null) {
    payloadValue = {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-one-time-authorization-attempt-v1',
      authorizationSha256,
      scope,
      targetSha256: createHash('sha256').update(target).digest('hex'),
      claimedAt: claimedAt.toISOString(),
    };
  } else {
    const bindingKeys = [
      ...BOOTSTRAP_ATTEMPT_IDENTITY_KEYS, 'preparedSha256',
      'freshAbsenceCaptureSha256', 'freshAccountSubdomainCaptureSha256',
    ];
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)
      || Object.keys(binding).length !== bindingKeys.length
      || Object.keys(binding).some((key) => !bindingKeys.includes(key))
      || ![binding.preparedSha256, binding.freshAbsenceCaptureSha256,
        binding.freshAccountSubdomainCaptureSha256]
        .every((value) => /^[a-f0-9]{64}$/u.test(value ?? ''))) {
      throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
    }
    try { validateBootstrapAttemptIdentity(binding, 'CLOUDFLARE_E_AUTHORIZATION_ATTEMPT'); }
    catch { throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT'); }
    payloadValue = {
      schemaVersion: 3,
      contract: 'dwnc-cloudflare-one-time-authorization-attempt-v3',
      authorizationSha256,
      scope,
      targetSha256: createHash('sha256').update(target).digest('hex'),
      binding,
      claimedAt: claimedAt.toISOString(),
    };
  }
  const payload = JSON.stringify(payloadValue);
  try { await writeSecureCreateOnly(file, `${payload}\n`, { hooks }); }
  catch (error) {
    if (error?.message === 'CLOUDFLARE_E_SIGNING_FILE_EXISTS') {
      throw new Error('CLOUDFLARE_E_AUTHORIZATION_REPLAY');
    }
    if (error?.message?.startsWith('CLOUDFLARE_E_SIGNING_FILE')) {
      throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
    }
    throw error;
  }
  return file;
}

export async function assertOneTimeAuthorizationClaim({
  directory, authorizationSha256, scope, target,
}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || !/^[a-f0-9]{64}$/u.test(authorizationSha256 ?? '')
    || !/^[a-z][a-z0-9-]{2,40}$/u.test(scope ?? '')
    || typeof target !== 'string' || target.length === 0 || target.length > 128) {
    throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  }
  const file = path.join(directory, `${scope}-${authorizationSha256}.json`);
  let stored;
  let payload;
  try {
    stored = await readSecureFile(file, 64 * 1024);
    payload = JSON.parse(stored.toString('utf8'));
  } catch { throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT'); }
  finally { stored?.fill(0); }
  const keys = ['schemaVersion', 'contract', 'authorizationSha256', 'scope', 'targetSha256', 'claimedAt'];
  if (!payload || Object.keys(payload).length !== keys.length
    || Object.keys(payload).some((key) => !keys.includes(key))
    || payload.schemaVersion !== 1
    || payload.contract !== 'dwnc-cloudflare-one-time-authorization-attempt-v1'
    || payload.authorizationSha256 !== authorizationSha256 || payload.scope !== scope
    || payload.targetSha256 !== createHash('sha256').update(target).digest('hex')
    || Number.isNaN(Date.parse(payload.claimedAt ?? ''))) {
    throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  }
  return file;
}

export async function writeAnonymousInheritedInput(stream, value, {
  descriptor = 3, maximumBytes = 1024 * 1024, signal,
} = {}) {
  const bytes = Buffer.isBuffer(value) ? Buffer.from(value)
    : typeof value === 'string' ? Buffer.from(value) : null;
  if (!bytes || bytes.length === 0 || bytes.length > maximumBytes
    || !Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 64
    || !stream || typeof stream.end !== 'function' || typeof stream.once !== 'function'
    || typeof stream.off !== 'function'
    || signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error('CLOUDFLARE_E_SEALED_INPUT');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const byteLength = bytes.length;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        stream.off('error', onError);
        signal?.removeEventListener('abort', onAbort);
        if (error !== null && error !== undefined) {
          reject(new Error('CLOUDFLARE_E_SEALED_INPUT'));
        } else resolve();
      };
      const onError = (error) => finish(error ?? new Error('sealed input error'));
      const onAbort = () => {
        try { stream.destroy?.(); } catch { /* best effort */ }
        finish(new Error('sealed input aborted'));
      };
      stream.once('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      stream.end(bytes, (error) => finish(error));
    });
    return { descriptor, path: `/dev/fd/${descriptor}`, sha256, bytes: byteLength };
  } finally { bytes.fill(0); }
}

function boundedChildOutput(stream, maximumBytes, signal) {
  if (!stream || typeof stream.on !== 'function' || typeof stream.off !== 'function'
    || typeof stream.destroy !== 'function') {
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_PIPE');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const erase = () => { for (const chunk of chunks) chunk.fill(0); };
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('close', onEnd);
      stream.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        erase();
        reject(error);
        return;
      }
      const output = Buffer.concat(chunks, total);
      erase();
      resolve(output);
    };
    const onData = (value) => {
      const chunk = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value));
      total += chunk.length;
      if (total > maximumBytes) {
        chunk.fill(0);
        try { stream.destroy(); } catch { /* best effort */ }
        finish(new Error('CLOUDFLARE_E_SMOKE_RUNNER_OUTPUT_LIMIT'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onError = () => finish(new Error('CLOUDFLARE_E_SMOKE_RUNNER_PIPE'));
    const onAbort = () => {
      try { stream.destroy(); } catch { /* best effort */ }
      finish(new Error('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT'));
    };
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('close', onEnd);
    stream.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function waitUntilOrTimeout(promise, milliseconds) {
  if (milliseconds <= 0) return Promise.resolve(false);
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(() => true, () => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

export async function runBoundedStagingSmokeChild({
  command,
  args,
  cwd,
  env,
  tokenBytes,
  operationDeadlineEpochMs,
  finalDeadlineEpochMs,
  spawnChild,
  limits = STAGING_SMOKE_RUNNER_LIMITS,
}) {
  const keys = [
    'totalTimeoutMs', 'gracefulTerminationMs', 'forcedSettleMs', 'maximumOutputBytes',
  ];
  if (typeof command !== 'string' || !path.isAbsolute(command)
    || !Array.isArray(args) || args.some((value) => typeof value !== 'string')
    || typeof cwd !== 'string' || !path.isAbsolute(cwd)
    || !env || typeof env !== 'object' || Array.isArray(env)
    || !Buffer.isBuffer(tokenBytes) || tokenBytes.length !== 43
    || !Number.isSafeInteger(operationDeadlineEpochMs)
    || !Number.isSafeInteger(finalDeadlineEpochMs)
    || operationDeadlineEpochMs >= finalDeadlineEpochMs
    || Date.now() >= finalDeadlineEpochMs
    || !limits || Object.keys(limits).length !== keys.length
    || Object.keys(limits).some((key) => !keys.includes(key))
    || !keys.every((key) => Number.isSafeInteger(limits[key]) && limits[key] >= 1)
    || limits.gracefulTerminationMs + limits.forcedSettleMs >= limits.totalTimeoutMs
    || limits.maximumOutputBytes > 16 * 1024 * 1024
    || spawnChild !== undefined && typeof spawnChild !== 'function') {
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_BOUNDARY');
  }
  if (spawnChild === undefined
    && Object.hasOwn(globalThis, STAGING_SMOKE_NATIVE_CHILD_GUARD)) {
    const observer = globalThis[STAGING_SMOKE_NATIVE_CHILD_GUARD];
    if (typeof observer === 'function') observer();
    throw new Error('CLOUDFLARE_E_SMOKE_NATIVE_CHILD_GUARD');
  }
  const child = (spawnChild ?? spawn)(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  if (!child || typeof child.once !== 'function' || typeof child.kill !== 'function'
    || !Array.isArray(child.stdio) || !child.stdio[1] || !child.stdio[2] || !child.stdio[3]) {
    try { child?.kill?.('SIGKILL'); } catch { /* best effort */ }
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_CHILD');
  }
  const controller = new AbortController();
  let operationTimer;
  let closed = false;
  const closePromise = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('CLOUDFLARE_E_SMOKE_RUNNER_CHILD')));
    child.once('close', (code, signal) => {
      closed = true;
      resolve({ code, signal });
    });
  });
  const operationRemaining = operationDeadlineEpochMs - Date.now();
  if (operationRemaining <= 0) controller.abort('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
  else operationTimer = setTimeout(() => {
    controller.abort('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
  }, operationRemaining);
  let stdout;
  let stderr;
  const terminate = async () => {
    if (!closed) {
      try { child.kill('SIGTERM'); } catch { /* best effort */ }
      await waitUntilOrTimeout(closePromise,
        Math.min(limits.gracefulTerminationMs, Math.max(0, finalDeadlineEpochMs - Date.now())));
    }
    if (!closed) {
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
      await waitUntilOrTimeout(closePromise,
        Math.min(limits.forcedSettleMs, Math.max(0, finalDeadlineEpochMs - Date.now())));
    }
  };
  try {
    const inputWrite = writeAnonymousInheritedInput(child.stdio[3], tokenBytes, {
      descriptor: 3,
      maximumBytes: 43,
      signal: controller.signal,
    });
    const stdoutRead = boundedChildOutput(
      child.stdio[1], limits.maximumOutputBytes, controller.signal,
    );
    const stderrRead = boundedChildOutput(
      child.stdio[2], limits.maximumOutputBytes, controller.signal,
    );
    const result = await Promise.all([closePromise, inputWrite, stdoutRead, stderrRead]);
    const [{ code, signal }, , stdoutBytes, stderrBytes] = result;
    stdout = stdoutBytes;
    stderr = stderrBytes;
    if (controller.signal.aborted) throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
    if (signal !== null) throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_CHILD_SIGNAL');
    if (code !== 0) throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_CHILD');
    if (stdout.indexOf(tokenBytes) !== -1 || stderr.indexOf(tokenBytes) !== -1) {
      throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_SECRET_OUTPUT');
    }
    return { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
  } catch (error) {
    if (!controller.signal.aborted) controller.abort('CLOUDFLARE_E_SMOKE_RUNNER_FAILURE');
    await terminate();
    if (Date.now() >= operationDeadlineEpochMs
      || controller.signal.reason === 'CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT') {
      throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
    }
    throw error;
  } finally {
    if (operationTimer !== undefined) clearTimeout(operationTimer);
    for (const stream of child.stdio.slice(1, 4)) {
      try { stream?.destroy?.(); } catch { /* best effort */ }
    }
    stdout?.fill(0);
    stderr?.fill(0);
  }
}

export async function runCheckedWithAnonymousInput(command, args, input, {
  cwd = process.cwd(), env, descriptor = 3, maximumBytes = 1024 * 1024,
} = {}) {
  if (!Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 64) {
    throw new Error('CLOUDFLARE_E_SEALED_INPUT');
  }
  const stdio = ['ignore', 'inherit', 'inherit'];
  while (stdio.length < descriptor) stdio.push('ignore');
  stdio.push('pipe');
  const child = spawn(command, args, { cwd, env, stdio });
  const pipe = child.stdio[descriptor];
  if (!pipe) {
    child.kill();
    throw new Error('CLOUDFLARE_E_SEALED_INPUT');
  }
  const [result, code] = await Promise.all([
    writeAnonymousInheritedInput(pipe, input, { descriptor, maximumBytes }),
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
  ]);
  if (code !== 0) throw new Error('CLOUDFLARE_E_VERIFICATION_STEP');
  return result;
}

export async function runChecked(command, args, { cwd = process.cwd(), env, stdio = 'inherit' } = {}) {
  const child = spawn(command, args, { cwd, env, stdio });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error('CLOUDFLARE_E_VERIFICATION_STEP');
}
