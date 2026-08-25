import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';

const fail = (code) => { throw new Error(code); };
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const LOCK_FILE = 'staging-activation.lock';
const PENDING_FILE = 'staging-activation.pending.json';
const INVOKING_FILE = 'staging-activation.invoking.json';
const exactKeys = (value, keys) => value && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));
const CONTEXT_KEYS = ['attemptId', 'authorizationSha256', 'artifactSha256', 'payloadSha256',
  'targetVersionId', 'previousVersionId', 'deploymentArgumentsSha256'];

async function secureDirectory(directory) {
  const stats = typeof directory === 'string' && path.isAbsolute(directory)
    ? await lstat(directory).catch(() => null) : null;
  if (!stats?.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700) {
    fail('CLOUDFLARE_E_STAGING_STORE');
  }
  return stats;
}

async function secureFile(file, { optional = false } = {}) {
  const stats = await lstat(file).catch((error) => {
    if (optional && error?.code === 'ENOENT') return null;
    throw error;
  });
  if (stats === null) return null;
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1
    || (stats.mode & 0o777) !== 0o600) fail('CLOUDFLARE_E_STAGING_STORE');
  return stats;
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function validContext(value) {
  return value && UUID.test(value.attemptId ?? '')
    && [value.authorizationSha256, value.artifactSha256, value.payloadSha256,
      value.deploymentArgumentsSha256].every((item) => SHA256.test(item ?? ''))
    && UUID.test(value.targetVersionId ?? '') && UUID.test(value.previousVersionId ?? '');
}

async function writeExclusive(file, value) {
  const handle = await open(file, 'wx', 0o600);
  try { await handle.writeFile(`${canonicalJson(value)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

async function readJson(file, code) {
  await secureFile(file);
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { fail(code); }
}

export async function acquireStagingActivationLock(directory, context) {
  await secureDirectory(directory);
  if (!exactKeys(context, CONTEXT_KEYS) || !validContext(context)) fail('CLOUDFLARE_E_STAGING_LOCK');
  for (const name of [LOCK_FILE, PENDING_FILE, INVOKING_FILE]) {
    if (await secureFile(path.join(directory, name), { optional: true })) {
      fail('CLOUDFLARE_E_STAGING_LOCKED');
    }
  }
  const lockPath = path.join(directory, LOCK_FILE);
  const token = randomUUID();
  const payload = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-staging-activation-lock-v1',
    token, pid: process.pid, createdAt: new Date().toISOString(), ...context,
  };
  const handle = await open(lockPath, 'wx', 0o600).catch(() => fail('CLOUDFLARE_E_STAGING_LOCKED'));
  await handle.writeFile(`${canonicalJson(payload)}\n`); await handle.sync();
  const identity = await handle.stat(); await handle.close(); await syncDirectory(directory);
  return { directory, lockPath, token, identity, payload };
}

async function assertOwnedLock(lock) {
  if (!lock || !UUID.test(lock.token ?? '')) fail('CLOUDFLARE_E_STAGING_LOCK');
  const stats = await secureFile(lock.lockPath);
  const payload = await readJson(lock.lockPath, 'CLOUDFLARE_E_STAGING_LOCK');
  if (stats.dev !== lock.identity.dev || stats.ino !== lock.identity.ino
    || payload.token !== lock.token || canonicalJson(payload) !== canonicalJson(lock.payload)) {
    fail('CLOUDFLARE_E_STAGING_LOCK');
  }
}

export async function beginStagingActivation(lock, { freshStatusSha256 }) {
  await assertOwnedLock(lock);
  if (!SHA256.test(freshStatusSha256 ?? '')) fail('CLOUDFLARE_E_STAGING_PENDING');
  const pending = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-staging-activation-attempt-v1',
    ...Object.fromEntries(['attemptId', 'authorizationSha256', 'artifactSha256', 'payloadSha256',
      'targetVersionId', 'previousVersionId', 'deploymentArgumentsSha256']
      .map((key) => [key, lock.payload[key]])),
    freshStatusSha256, startedAt: new Date().toISOString(),
  };
  await writeExclusive(path.join(lock.directory, PENDING_FILE), pending);
  await syncDirectory(lock.directory);
  return pending;
}

export async function markStagingActivationInvoking(lock) {
  await assertOwnedLock(lock);
  const pending = await loadStagingActivationAttempt(lock);
  const invoking = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-staging-activation-invoking-v1',
    attemptId: pending.attemptId, authorizationSha256: pending.authorizationSha256,
    targetVersionId: pending.targetVersionId, invokedAt: new Date().toISOString(),
  };
  await writeExclusive(path.join(lock.directory, INVOKING_FILE), invoking);
  await syncDirectory(lock.directory);
  return invoking;
}

export async function loadStagingActivationAttempt(lock) {
  await assertOwnedLock(lock);
  const pending = await readJson(path.join(lock.directory, PENDING_FILE), 'CLOUDFLARE_E_STAGING_PENDING');
  const keys = ['schemaVersion', 'contract', ...CONTEXT_KEYS, 'freshStatusSha256', 'startedAt'];
  if (!exactKeys(pending, keys) || pending.schemaVersion !== 1
    || pending.contract !== 'dwnc-cloudflare-staging-activation-attempt-v1'
    || !validContext(pending) || !SHA256.test(pending.freshStatusSha256 ?? '')
    || Number.isNaN(Date.parse(pending.startedAt ?? ''))
    || pending.authorizationSha256 !== lock.payload.authorizationSha256) {
    fail('CLOUDFLARE_E_STAGING_PENDING');
  }
  return pending;
}

export async function stagingActivationInvoking(lock) {
  await assertOwnedLock(lock);
  const file = path.join(lock.directory, INVOKING_FILE);
  if (!await secureFile(file, { optional: true })) return false;
  const value = await readJson(file, 'CLOUDFLARE_E_STAGING_PENDING');
  const keys = ['schemaVersion', 'contract', 'attemptId', 'authorizationSha256',
    'targetVersionId', 'invokedAt'];
  if (!exactKeys(value, keys) || value.schemaVersion !== 1
    || value.contract !== 'dwnc-cloudflare-staging-activation-invoking-v1'
    || value.attemptId !== lock.payload.attemptId
    || value.authorizationSha256 !== lock.payload.authorizationSha256
    || value.targetVersionId !== lock.payload.targetVersionId
    || Number.isNaN(Date.parse(value.invokedAt ?? ''))) fail('CLOUDFLARE_E_STAGING_PENDING');
  return true;
}

function validateOutcomeEvidence(lock, pending, evidence) {
  const keys = ['schemaVersion', 'contract', 'attemptId', 'authorizationSha256',
    'artifactSha256', 'payloadSha256', 'targetVersionId', 'previousVersionId',
    'freshStatusSha256', 'classification', 'commandResult', 'deploymentOutputSha256',
    'rawStatusSha256', 'rawStatus', 'deploymentArgumentsSha256', 'statusArgumentsSha256',
    'observedAt'];
  if (!exactKeys(evidence, keys) || evidence.schemaVersion !== 1
    || evidence.contract !== 'dwnc-cloudflare-staging-activation-outcome-v1'
    || evidence.attemptId !== pending.attemptId
    || evidence.authorizationSha256 !== lock.payload.authorizationSha256
    || evidence.artifactSha256 !== lock.payload.artifactSha256
    || evidence.payloadSha256 !== lock.payload.payloadSha256
    || evidence.targetVersionId !== lock.payload.targetVersionId
    || evidence.previousVersionId !== lock.payload.previousVersionId
    || evidence.freshStatusSha256 !== pending.freshStatusSha256
    || !['committed', 'ambiguous'].includes(evidence.classification)
    || !['succeeded', 'failed', 'not-run'].includes(evidence.commandResult)
    || ![evidence.rawStatusSha256, evidence.deploymentArgumentsSha256,
      evidence.statusArgumentsSha256].every((value) => SHA256.test(value ?? ''))
    || evidence.deploymentArgumentsSha256 !== lock.payload.deploymentArgumentsSha256
    || (evidence.commandResult === 'not-run'
      ? evidence.deploymentOutputSha256 !== null
      : !SHA256.test(evidence.deploymentOutputSha256 ?? ''))
    || sha256Hex(canonicalJson(evidence.rawStatus)) !== evidence.rawStatusSha256
    || Number.isNaN(Date.parse(evidence.observedAt ?? ''))) fail('CLOUDFLARE_E_STAGING_OUTCOME');
  return evidence;
}

export async function loadStagingActivationOutcomes(lock) {
  await assertOwnedLock(lock);
  const pending = await loadStagingActivationAttempt(lock);
  const outcomes = [];
  const names = (await readdir(lock.directory))
    .filter((name) => /^staging-activation-outcome-[a-f0-9]{64}\.json$/u.test(name))
    .sort();
  for (const name of names) {
    const file = path.join(lock.directory, name);
    const evidence = await readJson(file, 'CLOUDFLARE_E_STAGING_OUTCOME');
    if (evidence?.attemptId !== pending.attemptId
      || evidence?.authorizationSha256 !== pending.authorizationSha256) continue;
    validateOutcomeEvidence(lock, pending, evidence);
    const payload = canonicalJson(evidence);
    if (name !== `staging-activation-outcome-${sha256Hex(payload)}.json`) {
      fail('CLOUDFLARE_E_STAGING_OUTCOME');
    }
    outcomes.push({ file, evidence });
  }
  return outcomes;
}

export async function writeStagingActivationOutcome(lock, evidence) {
  await assertOwnedLock(lock);
  const pending = await loadStagingActivationAttempt(lock);
  validateOutcomeEvidence(lock, pending, evidence);
  const payload = canonicalJson(evidence);
  const file = path.join(lock.directory, `staging-activation-outcome-${sha256Hex(payload)}.json`);
  const existing = await secureFile(file, { optional: true });
  if (existing) {
    if ((await readFile(file, 'utf8')).trim() !== payload) fail('CLOUDFLARE_E_STAGING_OUTCOME');
    return file;
  }
  await writeFile(file, `${payload}\n`, { flag: 'wx', mode: 0o600 });
  await syncDirectory(lock.directory);
  return file;
}

export async function stagingActivationRecoveryStatus(directory, {
  now = new Date(), minimumAgeMs = 5 * 60 * 1000,
} = {}) {
  await secureDirectory(directory);
  const lockPath = path.join(directory, LOCK_FILE);
  const stats = await secureFile(lockPath, { optional: true });
  const pendingPresent = await secureFile(path.join(directory, PENDING_FILE), { optional: true }) !== null;
  if (!stats) return { lockPresent: false, pendingPresent, ownerAlive: null, ageMs: null,
    recoveryEligible: false, recoveryToken: null };
  const payload = await readJson(lockPath, 'CLOUDFLARE_E_STAGING_RECOVERY');
  const keys = ['schemaVersion', 'contract', 'token', 'pid', 'createdAt', ...CONTEXT_KEYS];
  if (!exactKeys(payload, keys) || payload.schemaVersion !== 1
    || payload.contract !== 'dwnc-cloudflare-staging-activation-lock-v1'
    || !UUID.test(payload.token ?? '') || !validContext(payload)
    || !Number.isSafeInteger(payload.pid) || payload.pid <= 0
    || Number.isNaN(Date.parse(payload.createdAt ?? ''))) fail('CLOUDFLARE_E_STAGING_RECOVERY');
  let ownerAlive = true;
  try { process.kill(payload.pid, 0); }
  catch (error) { if (error?.code === 'ESRCH') ownerAlive = false; else fail('CLOUDFLARE_E_STAGING_RECOVERY'); }
  const ageMs = now.getTime() - Date.parse(payload.createdAt);
  const recoveryEligible = !ownerAlive && ageMs >= minimumAgeMs;
  return { lockPresent: true, pendingPresent, ownerAlive, ageMs, recoveryEligible,
    recoveryToken: recoveryEligible ? payload.token : null };
}

export async function recoverStagingActivationLock(directory, token, {
  now = new Date(), minimumAgeMs = 5 * 60 * 1000,
} = {}) {
  const status = await stagingActivationRecoveryStatus(directory, { now, minimumAgeMs });
  if (!status.recoveryEligible || status.recoveryToken !== token) fail('CLOUDFLARE_E_STAGING_RECOVERY');
  const lockPath = path.join(directory, LOCK_FILE);
  const identity = await secureFile(lockPath);
  const payload = await readJson(lockPath, 'CLOUDFLARE_E_STAGING_RECOVERY');
  return { directory, lockPath, token, identity, payload, recovered: true,
    pendingPresent: status.pendingPresent };
}

export async function releaseStagingActivationLock(lock, { committed = false } = {}) {
  await assertOwnedLock(lock);
  if (committed) {
    await rm(path.join(lock.directory, INVOKING_FILE), { force: true });
    await rm(path.join(lock.directory, PENDING_FILE), { force: true });
  } else {
    if (await secureFile(path.join(lock.directory, INVOKING_FILE), { optional: true })) {
      fail('CLOUDFLARE_E_STAGING_AMBIGUOUS');
    }
    await rm(path.join(lock.directory, PENDING_FILE), { force: true });
  }
  await rm(lock.lockPath);
  await syncDirectory(lock.directory);
}
