import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fstatSync, readSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

export async function assertPinnedWranglerInstalled(root = process.cwd()) {
  let packageVersion;
  let installedVersion;
  try {
    packageVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
      .config?.wranglerVersion;
    installedVersion = JSON.parse(await readFile(
      path.join(root, 'node_modules/wrangler/package.json'), 'utf8')).version;
  } catch { throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED'); }
  if (packageVersion !== '4.125.0' || installedVersion !== packageVersion) {
    throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
  }
  return installedVersion;
}

export async function claimOneTimeAuthorization({
  directory, authorizationSha256, scope, target, hooks = {},
}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || !/^[a-f0-9]{64}$/u.test(authorizationSha256 ?? '')
    || !/^[a-z][a-z0-9-]{2,40}$/u.test(scope ?? '')
    || typeof target !== 'string' || target.length === 0 || target.length > 128
    || /[\u0000-\u001f\u007f]/u.test(target)) {
    throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  }
  const file = path.join(directory, `${scope}-${authorizationSha256}.json`);
  const payload = JSON.stringify({
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-one-time-authorization-attempt-v1',
    authorizationSha256,
    scope,
    targetSha256: createHash('sha256').update(target).digest('hex'),
    claimedAt: new Date().toISOString(),
  });
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
  descriptor = 3, maximumBytes = 1024 * 1024,
} = {}) {
  const bytes = Buffer.isBuffer(value) ? Buffer.from(value)
    : typeof value === 'string' ? Buffer.from(value) : null;
  if (!bytes || bytes.length === 0 || bytes.length > maximumBytes
    || !Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 64
    || !stream || typeof stream.end !== 'function' || typeof stream.once !== 'function') {
    throw new Error('CLOUDFLARE_E_SEALED_INPUT');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const byteLength = bytes.length;
  try {
    await new Promise((resolve, reject) => {
      const onError = () => reject(new Error('CLOUDFLARE_E_SEALED_INPUT'));
      stream.once('error', onError);
      stream.end(bytes, () => {
        stream.off('error', onError);
        resolve();
      });
    });
    return { descriptor, path: `/dev/fd/${descriptor}`, sha256, bytes: byteLength };
  } finally { bytes.fill(0); }
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
