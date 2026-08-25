import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdtemp, open, readFile, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cloudflareAccountIdSha256 } from './public-media-manifest.mjs';

const SAFE_ENVIRONMENT_NAMES = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'CI', 'NO_COLOR', 'FORCE_COLOR',
]);

export const R2_VALIDATION_ENVIRONMENT_NAMES = Object.freeze([
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'PUBLIC_MEDIA_REMOTE_RECEIPT_PATH', 'PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH',
  'PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH',
]);
export const CLOUDFLARE_UPLOAD_ENVIRONMENT_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_COMPLIANCE_REGION',
]);

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,80}$/u;

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

export function cloudflareUploadEnvironment(source = process.env, extra = {}) {
  const environment = sanitizedEnvironment(source);
  for (const name of CLOUDFLARE_UPLOAD_ENVIRONMENT_NAMES) {
    if (typeof source[name] === 'string') environment[name] = source[name];
  }
  if (typeof environment.CLOUDFLARE_API_TOKEN !== 'string'
    || typeof environment.CLOUDFLARE_ACCOUNT_ID !== 'string') {
    throw new Error('CLOUDFLARE_E_UPLOAD_CREDENTIALS');
  }
  return { ...environment, ...extra };
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

export async function claimOneTimeAuthorization({ directory, authorizationSha256, scope, target }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || !/^[a-f0-9]{64}$/u.test(authorizationSha256 ?? '')
    || !/^[a-z][a-z0-9-]{2,40}$/u.test(scope ?? '')
    || typeof target !== 'string' || target.length === 0 || target.length > 128
    || /[\u0000-\u001f\u007f]/u.test(target)) {
    throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  }
  const directoryStats = await lstat(directory).catch(() => null);
  if (!directoryStats?.isDirectory() || directoryStats.isSymbolicLink()
    || (directoryStats.mode & 0o777) !== 0o700) {
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
  const handle = await open(file, 'wx', 0o600).catch(() => {
    throw new Error('CLOUDFLARE_E_AUTHORIZATION_REPLAY');
  });
  await handle.writeFile(`${payload}\n`);
  await handle.sync();
  await handle.close();
  const directoryHandle = await open(directory, 'r');
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
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
  const stats = await lstat(file).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
    || (stats.mode & 0o777) !== 0o600) throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  let payload;
  try { payload = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error('CLOUDFLARE_E_AUTHORIZATION_ATTEMPT'); }
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

export async function createSealedInheritedInput(value, {
  descriptor = 3, prefix = 'dwnc-sealed-input-', maximumBytes = 1024 * 1024,
} = {}) {
  const bytes = Buffer.isBuffer(value) ? Buffer.from(value)
    : typeof value === 'string' ? Buffer.from(value) : null;
  if (!bytes || bytes.length === 0 || bytes.length > maximumBytes
    || !Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 64
    || !/^[a-z][a-z0-9-]{2,40}$/u.test(prefix)) {
    throw new Error('CLOUDFLARE_E_SEALED_INPUT');
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  await chmod(directory, 0o700);
  const file = path.join(directory, 'input');
  let handle;
  try {
    handle = await open(file, 'wx+', 0o600);
    let written = 0;
    while (written < bytes.length) {
      const result = await handle.write(bytes, written, bytes.length - written, written);
      if (result.bytesWritten <= 0) throw new Error('CLOUDFLARE_E_SEALED_INPUT');
      written += result.bytesWritten;
    }
    await handle.sync();
    const stats = await handle.stat();
    const verification = Buffer.alloc(bytes.length);
    let read = 0;
    while (read < verification.length) {
      const result = await handle.read(verification, read, verification.length - read, read);
      if (result.bytesRead <= 0) throw new Error('CLOUDFLARE_E_SEALED_INPUT');
      read += result.bytesRead;
    }
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o600
      || stats.size !== bytes.length || verification.length !== bytes.length
      || !createHash('sha256').update(verification).digest().equals(
        createHash('sha256').update(bytes).digest())) {
      throw new Error('CLOUDFLARE_E_SEALED_INPUT');
    }
    await rm(file);
    await rmdir(directory);
    let closed = false;
    return {
      descriptor,
      path: `/dev/fd/${descriptor}`,
      fd: handle.fd,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      close: async () => {
        if (closed) return;
        closed = true;
        await handle.close();
      },
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function runChecked(command, args, { cwd = process.cwd(), env, stdio = 'inherit' } = {}) {
  const child = spawn(command, args, { cwd, env, stdio });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error('CLOUDFLARE_E_VERIFICATION_STEP');
}
