import { execFile, spawn } from 'node:child_process';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signPayload,
} from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';
import { publicKeySpkiSha256 } from './public-media-manifest.mjs';

const ENVIRONMENTS = new Set(['staging', 'production']);
const ROLE_CONTRACTS = Object.freeze({
  'media-receipt': new Set(['dwnc-public-media-r2-receipt-v1']),
  'release-control': new Set([
    'dwnc-cloudflare-service-existence-v1',
    'dwnc-cloudflare-account-workers-dev-subdomain-v1',
    'dwnc-cloudflare-bootstrap-authorization-v1',
    'dwnc-cloudflare-deny-bootstrap-attestation-v2',
    'dwnc-cloudflare-upload-authorization-v1',
    'dwnc-cloudflare-staging-secret-authorization-v1',
    'dwnc-cloudflare-version-attestation-v1',
    'dwnc-cloudflare-deployment-status-evidence-v1',
    'dwnc-cloudflare-staging-activation-authorization-v1',
    'dwnc-cloudflare-staging-one-object-probe-v1',
    'dwnc-cloudflare-staging-admission-smoke-v1',
    'dwnc-cloudflare-staging-smoke-v1',
    'dwnc-cloudflare-promotion-authorization-v1',
    'dwnc-cloudflare-workers-dev-enable-authorization-v1',
    'dwnc-cloudflare-workers-dev-status-v1',
    'dwnc-cloudflare-r2-private-exposure-v1',
  ]),
});
const SAFE_KEYCHAIN_NAME = /^[a-z0-9:._-]{3,160}$/u;
const BASE64URL = /^[A-Za-z0-9_-]{40,512}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const OPENAT_HELPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../libexec/secure_openat.py',
);
const OPENAT_PYTHON = '/usr/bin/python3';

function fail(code) { throw new Error(code); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function assertSigningKeyRole(environment, role, contract = null) {
  if (!ENVIRONMENTS.has(environment) || !Object.hasOwn(ROLE_CONTRACTS, role)
    || contract !== null && !ROLE_CONTRACTS[role].has(contract)) {
    fail('CLOUDFLARE_E_SIGNING_ROLE');
  }
  return { environment, role };
}

export function signingKeyIdentity(environment, role) {
  assertSigningKeyRole(environment, role);
  return {
    service: 'me.dwnc.cloudflare-signing.v1',
    account: `dwnc:${environment}:${role}`,
  };
}

function validateEd25519PrivateKey(privateKeyDer) {
  if (!Buffer.isBuffer(privateKeyDer) || privateKeyDer.length === 0) {
    fail('CLOUDFLARE_E_SIGNING_KEY');
  }
  let privateKey;
  try {
    privateKey = createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  } catch { fail('CLOUDFLARE_E_SIGNING_KEY'); }
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    fail('CLOUDFLARE_E_SIGNING_KEY');
  }
  const canonicalDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  if (!Buffer.from(canonicalDer).equals(privateKeyDer)) fail('CLOUDFLARE_E_SIGNING_KEY');
  return privateKey;
}

function validateEd25519PublicKey(publicKeyPem) {
  if (typeof publicKeyPem !== 'string') fail('CLOUDFLARE_E_SIGNING_KEY');
  let publicKey;
  try { publicKey = createPublicKey(publicKeyPem); }
  catch { fail('CLOUDFLARE_E_SIGNING_KEY'); }
  if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    fail('CLOUDFLARE_E_SIGNING_KEY');
  }
  const canonicalPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  if (canonicalPem !== publicKeyPem) fail('CLOUDFLARE_E_SIGNING_KEY');
  return publicKey;
}

export function createSigningKeyMaterial(generate = () => generateKeyPairSync('ed25519')) {
  const generated = generate();
  const privateKey = generated?.privateKey;
  const publicKey = generated?.publicKey;
  if (!privateKey || !publicKey || privateKey.asymmetricKeyType !== 'ed25519'
    || publicKey.asymmetricKeyType !== 'ed25519') fail('CLOUDFLARE_E_SIGNING_KEY');
  const privateKeyDer = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'der' }));
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const derived = createPublicKey(validateEd25519PrivateKey(privateKeyDer))
    .export({ type: 'spki', format: 'der' });
  const declared = validateEd25519PublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  if (!Buffer.from(derived).equals(Buffer.from(declared))) fail('CLOUDFLARE_E_SIGNING_KEY');
  return {
    privateKeySecret: privateKeyDer.toString('base64url'),
    publicKeyPem,
    publicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
  };
}

export function validateSigningKeyMetadata(metadata, { environment, role } = {}) {
  const keys = ['schemaVersion', 'contract', 'environment', 'role', 'algorithm', 'keychainService',
    'keychainAccount', 'publicKeyPem', 'publicKeySpkiSha256', 'createdAt'];
  if (!exactKeys(metadata, keys) || metadata.schemaVersion !== 1
    || metadata.contract !== 'dwnc-cloudflare-signing-key-metadata-v1'
    || !ENVIRONMENTS.has(metadata.environment) || !Object.hasOwn(ROLE_CONTRACTS, metadata.role)
    || metadata.algorithm !== 'Ed25519'
    || !SAFE_KEYCHAIN_NAME.test(metadata.keychainService ?? '')
    || !SAFE_KEYCHAIN_NAME.test(metadata.keychainAccount ?? '')
    || metadata.keychainService !== signingKeyIdentity(metadata.environment, metadata.role).service
    || metadata.keychainAccount !== signingKeyIdentity(metadata.environment, metadata.role).account
    || !SHA256.test(metadata.publicKeySpkiSha256 ?? '')
    || publicKeySpkiSha256(metadata.publicKeyPem) !== metadata.publicKeySpkiSha256
    || validateEd25519PublicKey(metadata.publicKeyPem).asymmetricKeyType !== 'ed25519'
    || Number.isNaN(Date.parse(metadata.createdAt ?? ''))
    || environment !== undefined && metadata.environment !== environment
    || role !== undefined && metadata.role !== role) fail('CLOUDFLARE_E_SIGNING_METADATA');
  return metadata;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function snapshotAncestors(directory) {
  const parsed = path.parse(directory);
  const components = path.relative(parsed.root, directory).split(path.sep).filter(Boolean);
  const paths = [parsed.root];
  for (const component of components) paths.push(path.join(paths.at(-1), component));
  const snapshots = [];
  for (const ancestor of paths) {
    const stats = await lstat(ancestor).catch(() => null);
    if (!stats?.isDirectory() || stats.isSymbolicLink()) fail('CLOUDFLARE_E_SIGNING_FILE');
    snapshots.push({
      path: ancestor,
      dev: stats.dev,
      ino: stats.ino,
      mode: stats.mode & 0o777,
      uid: stats.uid,
    });
  }
  return snapshots;
}

function sameAncestorSnapshots(left, right) {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.path === other.path && entry.dev === other.dev && entry.ino === other.ino
      && entry.mode === other.mode && entry.uid === other.uid;
  });
}

async function openSecureParent(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.resolve(file) !== file
    || ['.', '..'].includes(path.basename(file)) || path.basename(file).includes(path.sep)) {
    fail('CLOUDFLARE_E_SIGNING_FILE');
  }
  const parent = path.dirname(file);
  const ancestors = await snapshotAncestors(parent);
  const stats = await lstat(parent).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
    || typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    fail('CLOUDFLARE_E_SIGNING_FILE');
  }
  let handle;
  try {
    handle = await open(parent,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isDirectory() || !sameIdentity(opened, stats)
      || (opened.mode & 0o777) !== 0o700
      || typeof process.getuid === 'function' && opened.uid !== process.getuid()) {
      fail('CLOUDFLARE_E_SIGNING_FILE');
    }
    const confirmedAncestors = await snapshotAncestors(parent);
    if (!sameAncestorSnapshots(ancestors, confirmedAncestors)) {
      fail('CLOUDFLARE_E_SIGNING_FILE_RACE');
    }
    return { parent, handle, identity: opened, ancestors };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error?.message?.startsWith('CLOUDFLARE_E_SIGNING_FILE')) throw error;
    fail('CLOUDFLARE_E_SIGNING_FILE');
  }
}

async function assertSecureParentUnchanged(context) {
  const [current, opened, ancestors] = await Promise.all([
    lstat(context.parent).catch(() => null),
    context.handle.stat().catch(() => null),
    snapshotAncestors(context.parent).catch(() => null),
  ]);
  if (!current?.isDirectory() || current.isSymbolicLink() || !opened?.isDirectory()
    || !sameIdentity(current, context.identity) || !sameIdentity(opened, context.identity)
    || (current.mode & 0o777) !== 0o700 || (opened.mode & 0o777) !== 0o700
    || typeof process.getuid === 'function'
      && (current.uid !== process.getuid() || opened.uid !== process.getuid())
    || !Array.isArray(ancestors) || !sameAncestorSnapshots(context.ancestors, ancestors)) {
    fail('CLOUDFLARE_E_SIGNING_FILE_RACE');
  }
}

function validateOpenAtMetadata(value) {
  const keys = ['ctimeNs', 'dev', 'ino', 'mode', 'mtimeNs', 'nlink', 'size'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))
    || !['dev', 'ino', 'mode', 'nlink', 'size']
      .every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
    || !['ctimeNs', 'mtimeNs'].every((key) => /^\d{1,30}$/u.test(value[key] ?? ''))) {
    fail('CLOUDFLARE_E_SIGNING_FILE');
  }
  return value;
}

async function runOpenAt(context, operation, maximumBytes, input = null) {
  if (!['absent', 'read', 'read-partial', 'create'].includes(operation)
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > 16 * 1024 * 1024
    || input !== null && !Buffer.isBuffer(input)) fail('CLOUDFLARE_E_SIGNING_FILE');
  const child = spawn(OPENAT_PYTHON, [
    OPENAT_HELPER, operation, path.basename(context.file),
    String(maximumBytes),
  ], {
    env: {
      PATH: '/usr/bin:/bin',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      LANG: process.env.LANG ?? 'C',
      PYTHONDONTWRITEBYTECODE: '1',
      ...(typeof process.env.__CF_USER_TEXT_ENCODING === 'string'
        ? { __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING } : {}),
    },
    stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'pipe', context.handle.fd],
  });
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= maximumBytes) stdout.push(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= 4096) stderr.push(chunk);
  });
  if (input !== null) child.stdin.end(input);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  }).catch(() => fail('CLOUDFLARE_E_SIGNING_FILE'));
  const errorOutput = Buffer.concat(stderr).toString('utf8');
  if (code !== 0) {
    if (code === 17 && errorOutput === 'CLOUDFLARE_E_SIGNING_FILE_EXISTS\n') {
      fail('CLOUDFLARE_E_SIGNING_FILE_EXISTS');
    }
    if (errorOutput === 'CLOUDFLARE_E_SIGNING_FILE_RACE\n') {
      fail('CLOUDFLARE_E_SIGNING_FILE_RACE');
    }
    fail('CLOUDFLARE_E_SIGNING_FILE');
  }
  if (stdoutBytes > maximumBytes || stderrBytes > 4096 || !errorOutput.endsWith('\n')) {
    fail('CLOUDFLARE_E_SIGNING_FILE');
  }
  let metadata;
  try { metadata = validateOpenAtMetadata(JSON.parse(errorOutput)); }
  catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_')) throw error;
    fail('CLOUDFLARE_E_SIGNING_FILE');
  }
  return { bytes: Buffer.concat(stdout), metadata };
}

export async function assertSecureCreateOnlyDestination(file, { hooks = {} } = {}) {
  const parent = await openSecureParent(file);
  parent.file = file;
  try {
    await hooks.afterParentOpened?.({ file, parent: parent.parent });
    await assertSecureParentUnchanged(parent);
    await runOpenAt(parent, 'absent', 1);
    await assertSecureParentUnchanged(parent);
    return parent.parent;
  } finally {
    await parent.handle.close().catch(() => undefined);
  }
}

export async function writeSecureCreateOnly(file, bytes, { hooks = {} } = {}) {
  const payload = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(String(bytes));
  if (payload.length === 0 || payload.length > 16 * 1024 * 1024) fail('CLOUDFLARE_E_SIGNING_FILE');
  const parent = await openSecureParent(file);
  parent.file = file;
  try {
    await hooks.afterParentOpened?.({ file, parent: parent.parent });
    await assertSecureParentUnchanged(parent);
    const created = await runOpenAt(parent, 'create', payload.length, payload);
    await hooks.afterLeafOpened?.({ file, parent: parent.parent });
    let observed;
    try { observed = await runOpenAt(parent, 'read', payload.length); }
    catch (error) {
      if (error?.message?.startsWith('CLOUDFLARE_E_SIGNING_FILE')) {
        fail('CLOUDFLARE_E_SIGNING_FILE_RACE');
      }
      throw error;
    }
    if (!observed.bytes.equals(payload)
      || created.metadata.dev !== observed.metadata.dev
      || created.metadata.ino !== observed.metadata.ino) fail('CLOUDFLARE_E_SIGNING_FILE_RACE');
    await hooks.beforeParentRecheck?.({ file, parent: parent.parent });
    await assertSecureParentUnchanged(parent);
    await parent.handle.sync();
  } finally {
    payload.fill(0);
    await parent.handle.close().catch(() => undefined);
  }
}

export async function readSecureFile(file, maximumBytes = 16 * 1024 * 1024, {
  hooks = {}, allowEmpty = false,
} = {}) {
  if (typeof allowEmpty !== 'boolean') fail('CLOUDFLARE_E_SIGNING_FILE');
  const operation = allowEmpty ? 'read-partial' : 'read';
  const parent = await openSecureParent(file);
  parent.file = file;
  try {
    await hooks.afterParentOpened?.({ file, parent: parent.parent });
    await assertSecureParentUnchanged(parent);
    const first = await runOpenAt(parent, operation, maximumBytes);
    await hooks.afterLeafOpened?.({ file, parent: parent.parent });
    let second;
    try { second = await runOpenAt(parent, operation, maximumBytes); }
    catch (error) {
      first.bytes.fill(0);
      if (error?.message?.startsWith('CLOUDFLARE_E_SIGNING_FILE')) {
        fail('CLOUDFLARE_E_SIGNING_FILE_RACE');
      }
      throw error;
    }
    if (!first.bytes.equals(second.bytes)
      || first.metadata.dev !== second.metadata.dev || first.metadata.ino !== second.metadata.ino
      || first.metadata.mtimeNs !== second.metadata.mtimeNs
      || first.metadata.ctimeNs !== second.metadata.ctimeNs) {
      first.bytes.fill(0);
      second.bytes.fill(0);
      fail('CLOUDFLARE_E_SIGNING_FILE_RACE');
    }
    second.bytes.fill(0);
    await hooks.beforeParentRecheck?.({ file, parent: parent.parent });
    await assertSecureParentUnchanged(parent);
    return first.bytes;
  } finally {
    await parent.handle.close().catch(() => undefined);
  }
}

export function canonicalEvidenceStorageBytes(payload, canonicalPayload = canonicalJson) {
  if (typeof canonicalPayload !== 'function') fail('CLOUDFLARE_E_SIGNING_CANONICAL');
  let canonical;
  try { canonical = canonicalPayload(payload); }
  catch { fail('CLOUDFLARE_E_SIGNING_CANONICAL'); }
  if (typeof canonical !== 'string' || canonical.length === 0
    || canonical !== canonicalJson(payload) || /[\r\n]/u.test(canonical)) {
    fail('CLOUDFLARE_E_SIGNING_CANONICAL');
  }
  return Buffer.from(`${canonical}\n`);
}

export function parseCanonicalEvidenceStorage(storedBytes) {
  const stored = Buffer.isBuffer(storedBytes) ? Buffer.from(storedBytes) : null;
  if (!stored || stored.length < 3 || stored.length > 16 * 1024 * 1024
    || stored.at(-1) !== 0x0a || stored.at(-2) === 0x0a || stored.at(-2) === 0x0d) {
    fail('CLOUDFLARE_E_SIGNING_CANONICAL');
  }
  const canonicalBytes = stored.subarray(0, stored.length - 1);
  if (canonicalBytes.includes(0x0a) || canonicalBytes.includes(0x0d)
    || Buffer.from(canonicalBytes.toString('utf8')).compare(canonicalBytes) !== 0) {
    fail('CLOUDFLARE_E_SIGNING_CANONICAL');
  }
  let payload;
  try { payload = JSON.parse(canonicalBytes.toString('utf8')); }
  catch { fail('CLOUDFLARE_E_SIGNING_CANONICAL'); }
  const contractVersion = /-v(\d+)$/u.exec(payload?.contract ?? '');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || ![1, 2].includes(payload.schemaVersion) || typeof payload.contract !== 'string'
    || Number(contractVersion?.[1]) !== payload.schemaVersion
    || canonicalJson(payload) !== canonicalBytes.toString('utf8')) {
    fail('CLOUDFLARE_E_SIGNING_CANONICAL');
  }
  return { payload, canonicalBytes: Buffer.from(canonicalBytes) };
}

export async function writeCanonicalEvidenceCreateOnly(file, payload, canonicalPayload = canonicalJson,
  options = {}) {
  const stored = canonicalEvidenceStorageBytes(payload, canonicalPayload);
  try { await writeSecureCreateOnly(file, stored, options); }
  finally { stored.fill(0); }
}

async function runSecurityInteractive(command) {
  if (typeof command !== 'string' || command.includes('\n') || command.length > 2048) {
    fail('CLOUDFLARE_E_KEYCHAIN');
  }
  const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let outputBytes = 0;
  child.stdout.on('data', (chunk) => { outputBytes += chunk.length; });
  child.stderr.on('data', (chunk) => { outputBytes += chunk.length; });
  child.stdin.end(`${command}\nquit\n`);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  }).catch(() => fail('CLOUDFLARE_E_KEYCHAIN'));
  // macOS `security -i` returns 1 for an otherwise successful session ended by
  // `quit` on the supported host. The caller still verifies the exact
  // create-only postcondition with a separate Keychain read, so accepting that
  // observed exit code does not turn a failed add into success.
  if (![0, 1].includes(code) || outputBytes > 64 * 1024) fail('CLOUDFLARE_E_KEYCHAIN');
}

export class MacOSKeychainStore {
  async get(service, account) {
    if (!SAFE_KEYCHAIN_NAME.test(service) || !SAFE_KEYCHAIN_NAME.test(account)) {
      fail('CLOUDFLARE_E_KEYCHAIN');
    }
    try {
      const { stdout } = await promisify(execFile)('/usr/bin/security', [
        'find-generic-password', '-s', service, '-a', account, '-w',
      ], { encoding: 'utf8', maxBuffer: 16 * 1024, timeout: 15000 });
      const value = stdout.trim();
      if (!BASE64URL.test(value)) fail('CLOUDFLARE_E_KEYCHAIN');
      return value;
    } catch (error) {
      if (error?.code === 44) return null;
      fail('CLOUDFLARE_E_KEYCHAIN');
    }
  }

  async putCreateOnly(service, account, value) {
    if (!SAFE_KEYCHAIN_NAME.test(service) || !SAFE_KEYCHAIN_NAME.test(account)
      || !BASE64URL.test(value)) fail('CLOUDFLARE_E_KEYCHAIN');
    if (await this.get(service, account) !== null) fail('CLOUDFLARE_E_SIGNING_KEY_EXISTS');
    await runSecurityInteractive(`add-generic-password -s ${service} -a ${account} -w ${value}`);
    if (await this.get(service, account) !== value) fail('CLOUDFLARE_E_KEYCHAIN');
  }
}

export async function initializeSigningKey({
  environment,
  role,
  metadataOutput,
  store = new MacOSKeychainStore(),
  generate,
  now = new Date(),
  recoveryPublicKeySpkiSha256 = null,
}) {
  assertSigningKeyRole(environment, role);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())
    || recoveryPublicKeySpkiSha256 !== null
      && !SHA256.test(recoveryPublicKeySpkiSha256)) fail('CLOUDFLARE_E_SIGNING_KEY');
  await assertSecureCreateOnlyDestination(metadataOutput);
  const identity = signingKeyIdentity(environment, role);
  const existingSecret = await store.get(identity.service, identity.account);
  let material;
  if (existingSecret !== null) {
    if (recoveryPublicKeySpkiSha256 === null || !BASE64URL.test(existingSecret)) {
      fail('CLOUDFLARE_E_SIGNING_KEY_EXISTS');
    }
    const privateKeyDer = Buffer.from(existingSecret, 'base64url');
    try {
      if (privateKeyDer.toString('base64url') !== existingSecret) fail('CLOUDFLARE_E_SIGNING_KEY');
      const privateKey = validateEd25519PrivateKey(privateKeyDer);
      const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
      const fingerprint = publicKeySpkiSha256(publicKeyPem);
      if (fingerprint !== recoveryPublicKeySpkiSha256) fail('CLOUDFLARE_E_SIGNING_RECOVERY');
      material = {
        privateKeySecret: existingSecret,
        publicKeyPem,
        publicKeySpkiSha256: fingerprint,
      };
    } finally { privateKeyDer.fill(0); }
  } else {
    if (recoveryPublicKeySpkiSha256 !== null) fail('CLOUDFLARE_E_SIGNING_RECOVERY');
    material = createSigningKeyMaterial(generate);
    await store.putCreateOnly(identity.service, identity.account, material.privateKeySecret);
    const stored = await store.get(identity.service, identity.account);
    if (stored !== material.privateKeySecret) fail('CLOUDFLARE_E_KEYCHAIN');
  }
  const metadata = validateSigningKeyMetadata({
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-signing-key-metadata-v1',
    environment,
    role,
    algorithm: 'Ed25519',
    keychainService: identity.service,
    keychainAccount: identity.account,
    publicKeyPem: material.publicKeyPem,
    publicKeySpkiSha256: material.publicKeySpkiSha256,
    createdAt: now.toISOString(),
  }, { environment, role });
  await writeCanonicalEvidenceCreateOnly(metadataOutput, metadata);
  return metadata;
}

export async function loadSigningKey({ environment, role, metadataPath, store = new MacOSKeychainStore() }) {
  assertSigningKeyRole(environment, role);
  let metadata;
  try { metadata = JSON.parse((await readSecureFile(metadataPath, 64 * 1024)).toString('utf8')); }
  catch (error) {
    if (error?.message?.startsWith('CLOUDFLARE_E_')) throw error;
    fail('CLOUDFLARE_E_SIGNING_METADATA');
  }
  validateSigningKeyMetadata(metadata, { environment, role });
  const secret = await store.get(metadata.keychainService, metadata.keychainAccount);
  if (typeof secret !== 'string' || !BASE64URL.test(secret)) fail('CLOUDFLARE_E_SIGNING_KEY');
  const privateKeyDer = Buffer.from(secret, 'base64url');
  try {
    if (privateKeyDer.toString('base64url') !== secret) fail('CLOUDFLARE_E_SIGNING_KEY');
    const privateKey = validateEd25519PrivateKey(privateKeyDer);
    const derivedFingerprint = publicKeySpkiSha256(
      createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString(),
    );
    if (derivedFingerprint !== metadata.publicKeySpkiSha256) fail('CLOUDFLARE_E_SIGNING_KEY');
    return { metadata, privateKey };
  } finally { privateKeyDer.fill(0); }
}

export async function signCanonicalEvidence({
  environment,
  role,
  metadataPath,
  canonicalBytes,
  store = new MacOSKeychainStore(),
  expectedPublicKeySpkiSha256 = null,
}) {
  const { payload: parsed, canonicalBytes: bytes } = parseCanonicalEvidenceStorage(canonicalBytes);
  assertSigningKeyRole(environment, role, parsed.contract);
  const payloadEnvironment = parsed.contract === 'dwnc-public-media-r2-receipt-v1'
    ? parsed.target?.environment : parsed.environment;
  if (payloadEnvironment !== environment) fail('CLOUDFLARE_E_SIGNING_ROLE');
  const { metadata, privateKey } = await loadSigningKey({ environment, role, metadataPath, store });
  if (expectedPublicKeySpkiSha256 !== null
    && (!SHA256.test(expectedPublicKeySpkiSha256)
      || metadata.publicKeySpkiSha256 !== expectedPublicKeySpkiSha256)) {
    fail('CLOUDFLARE_E_SIGNING_PIN');
  }
  const signature = signPayload(null, bytes, privateKey);
  if (!Buffer.isBuffer(signature) || signature.length !== 64) fail('CLOUDFLARE_E_SIGNING_KEY');
  return {
    signature,
    publicKeyPem: metadata.publicKeyPem,
    publicKeySpkiSha256: metadata.publicKeySpkiSha256,
    payloadSha256: sha256Hex(bytes),
    contract: parsed.contract,
  };
}

async function secureOutputMatches(file, expected) {
  let stats;
  try { stats = await lstat(file); }
  catch (error) {
    if (error?.code === 'ENOENT') return false;
    fail('CLOUDFLARE_E_SIGNING_OUTPUT');
  }
  if (!stats.isFile() || stats.isSymbolicLink()) fail('CLOUDFLARE_E_SIGNING_OUTPUT');
  const actual = await readSecureFile(file, Math.max(expected.length, 64 * 1024));
  try {
    if (!actual.equals(expected)) fail('CLOUDFLARE_E_SIGNING_OUTPUT_MISMATCH');
  } finally { actual.fill(0); }
  return true;
}

export async function writeSignedEvidenceOutputs({
  signaturePath,
  publicKeyPath,
  signature,
  publicKeyPem,
  hooks = {},
}) {
  if (typeof signaturePath !== 'string' || typeof publicKeyPath !== 'string'
    || signaturePath === publicKeyPath || !Buffer.isBuffer(signature) || signature.length !== 64
    || typeof publicKeyPem !== 'string') fail('CLOUDFLARE_E_SIGNING_OUTPUT');
  validateEd25519PublicKey(publicKeyPem);
  const signatureBytes = Buffer.from(`${signature.toString('base64')}\n`);
  const publicKeyBytes = Buffer.from(publicKeyPem);
  try {
    const signatureExists = await secureOutputMatches(signaturePath, signatureBytes);
    const publicKeyExists = await secureOutputMatches(publicKeyPath, publicKeyBytes);
    if (!signatureExists) await writeSecureCreateOnly(signaturePath, signatureBytes);
    await hooks.afterSignatureReady?.();
    if (!publicKeyExists) await writeSecureCreateOnly(publicKeyPath, publicKeyBytes);
    await hooks.afterPublicKeyReady?.();
    if (!await secureOutputMatches(signaturePath, signatureBytes)
      || !await secureOutputMatches(publicKeyPath, publicKeyBytes)) {
      fail('CLOUDFLARE_E_SIGNING_OUTPUT');
    }
    return { recovered: signatureExists || publicKeyExists };
  } finally {
    signatureBytes.fill(0);
    publicKeyBytes.fill(0);
  }
}
