import { randomUUID, sign as signPayload } from 'node:crypto';
import {
  lstat, open, readFile, rename, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalPromotionStatePayload,
  canonicalJson,
  sha256Hex,
  validatePromotionState,
  verifySignedPayload,
} from './cloudflare-release.mjs';
import { publicKeySpkiSha256 } from './public-media-manifest.mjs';

const fail = (code) => { throw new Error(code); };
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HEAD_FILE = 'active-head.json';
const LOCK_FILE = 'promotion.lock';
const PENDING_FILE = 'promotion.pending.json';

async function secureDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('CLOUDFLARE_E_PROMOTION_STORE');
  const stats = await lstat(directory).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700) {
    fail('CLOUDFLARE_E_PROMOTION_STORE');
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
    || (stats.mode & 0o777) !== 0o600) fail('CLOUDFLARE_E_PROMOTION_STORE');
  return stats;
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export function canonicalPromotionHeadPayload(head) {
  return canonicalJson({
    schemaVersion: head.schemaVersion,
    contract: head.contract,
    state: head.state,
    signatureBase64: head.signatureBase64,
    publicKeySpkiSha256: head.publicKeySpkiSha256,
  });
}

export function createSignedPromotionHead({ state, privateKeyPem, publicKeyPem }) {
  validatePromotionState(state);
  if (typeof privateKeyPem !== 'string' || typeof publicKeyPem !== 'string') {
    fail('CLOUDFLARE_E_PROMOTION_SIGNER');
  }
  let signature;
  try {
    signature = signPayload(null, Buffer.from(canonicalPromotionStatePayload(state)), privateKeyPem);
  } catch { fail('CLOUDFLARE_E_PROMOTION_SIGNER'); }
  if (signature.length !== 64) fail('CLOUDFLARE_E_PROMOTION_SIGNER');
  return {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-authoritative-promotion-head-v1',
    state,
    signatureBase64: signature.toString('base64'),
    publicKeySpkiSha256: publicKeySpkiSha256(publicKeyPem),
  };
}

export function validateSignedPromotionHead(head, { publicKeyPem, expectedFingerprint } = {}) {
  const keys = ['schemaVersion', 'contract', 'state', 'signatureBase64', 'publicKeySpkiSha256'];
  if (!head || Object.keys(head).length !== keys.length
    || Object.keys(head).some((key) => !keys.includes(key))
    || head.schemaVersion !== 1
    || head.contract !== 'dwnc-cloudflare-authoritative-promotion-head-v1'
    || !/^[A-Za-z0-9+/]{86}==$/u.test(head.signatureBase64 ?? '')
    || !SHA256.test(head.publicKeySpkiSha256 ?? '')
    || head.publicKeySpkiSha256 !== expectedFingerprint) fail('CLOUDFLARE_E_PROMOTION_HEAD');
  verifySignedPayload({
    payload: head.state,
    canonicalPayload: canonicalPromotionStatePayload,
    validator: validatePromotionState,
    signature: Buffer.from(head.signatureBase64, 'base64'),
    publicKeyPem,
    expectedPublicKeySpkiSha256: expectedFingerprint,
  });
  return head;
}

export async function initializePromotionStore({ directory, head, publicKeyPem, expectedFingerprint }) {
  await secureDirectory(directory);
  validateSignedPromotionHead(head, { publicKeyPem, expectedFingerprint });
  if (head.state.generation !== 0) fail('CLOUDFLARE_E_PROMOTION_STORE_GENESIS');
  for (const file of [HEAD_FILE, LOCK_FILE, PENDING_FILE]) {
    if (await secureFile(path.join(directory, file), { optional: true })) {
      fail('CLOUDFLARE_E_PROMOTION_STORE_EXISTS');
    }
  }
  await writeFile(path.join(directory, HEAD_FILE), `${canonicalPromotionHeadPayload(head)}\n`, {
    flag: 'wx', mode: 0o600,
  });
  await syncDirectory(directory);
}

export async function loadPromotionHead({ directory, publicKeyPem, expectedFingerprint }) {
  await secureDirectory(directory);
  const file = path.join(directory, HEAD_FILE);
  await secureFile(file);
  let head;
  try { head = JSON.parse(await readFile(file, 'utf8')); }
  catch { fail('CLOUDFLARE_E_PROMOTION_HEAD'); }
  validateSignedPromotionHead(head, { publicKeyPem, expectedFingerprint });
  return {
    head,
    stateSha256: sha256Hex(canonicalPromotionStatePayload(head.state)),
    headSha256: sha256Hex(canonicalPromotionHeadPayload(head)),
  };
}

export async function acquirePromotionLock(directory, expectedStateSha256) {
  await secureDirectory(directory);
  if (!SHA256.test(expectedStateSha256 ?? '')) fail('CLOUDFLARE_E_PROMOTION_LOCK');
  if (await secureFile(path.join(directory, PENDING_FILE), { optional: true })) {
    fail('CLOUDFLARE_E_PROMOTION_PENDING');
  }
  const lockPath = path.join(directory, LOCK_FILE);
  const token = randomUUID();
  const handle = await open(lockPath, 'wx', 0o600).catch(() => fail('CLOUDFLARE_E_PROMOTION_LOCKED'));
  const payload = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-lock-v1',
    token,
    expectedStateSha256,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  await handle.writeFile(`${canonicalJson(payload)}\n`);
  await handle.sync();
  const identity = await handle.stat();
  await handle.close();
  await syncDirectory(directory);
  return { directory, lockPath, token, identity, payload };
}

export async function recoverPromotionLock(directory, token, {
  now = new Date(), minimumAgeMs = 5 * 60 * 1000,
} = {}) {
  await secureDirectory(directory);
  if (!UUID.test(token ?? '') || !(now instanceof Date) || Number.isNaN(now.getTime())
    || !Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < 60_000) {
    fail('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
  const lockPath = path.join(directory, LOCK_FILE);
  const identity = await secureFile(lockPath);
  let payload;
  try { payload = JSON.parse(await readFile(lockPath, 'utf8')); }
  catch { fail('CLOUDFLARE_E_PROMOTION_RECOVERY'); }
  if (payload.token !== token || !Number.isSafeInteger(payload.pid) || payload.pid <= 0
    || Number.isNaN(Date.parse(payload.createdAt ?? ''))
    || now.getTime() - Date.parse(payload.createdAt) < minimumAgeMs) {
    fail('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
  let alive = true;
  try { process.kill(payload.pid, 0); }
  catch (error) { if (error?.code === 'ESRCH') alive = false; else fail('CLOUDFLARE_E_PROMOTION_RECOVERY'); }
  if (alive) fail('CLOUDFLARE_E_PROMOTION_RECOVERY');
  const pending = await secureFile(path.join(directory, PENDING_FILE), { optional: true });
  return {
    directory, lockPath, token, identity, payload, recovered: true,
    pendingPresent: pending !== null,
  };
}

async function assertOwnedLock(lock) {
  const stats = await secureFile(lock.lockPath);
  if (stats.dev !== lock.identity.dev || stats.ino !== lock.identity.ino) fail('CLOUDFLARE_E_PROMOTION_LOCK_RACE');
  let payload;
  try { payload = JSON.parse(await readFile(lock.lockPath, 'utf8')); }
  catch { fail('CLOUDFLARE_E_PROMOTION_LOCK_RACE'); }
  if (payload.token !== lock.token || canonicalJson(payload) !== canonicalJson(lock.payload)) {
    fail('CLOUDFLARE_E_PROMOTION_LOCK_RACE');
  }
}

export async function beginPromotionAttempt({ lock, attempt }) {
  await assertOwnedLock(lock);
  const keys = ['schemaVersion', 'contract', 'attemptId', 'expectedStateSha256',
    'promotionAuthorizationSha256', 'promotionPlanSha256', 'freshStatusSha256',
    'targetVersionId', 'startedAt'];
  if (!attempt || Object.keys(attempt).length !== keys.length
    || Object.keys(attempt).some((key) => !keys.includes(key))
    || attempt.schemaVersion !== 1 || attempt.contract !== 'dwnc-cloudflare-promotion-attempt-v1'
    || !UUID.test(attempt.attemptId ?? '') || !SHA256.test(attempt.expectedStateSha256 ?? '')
    || !SHA256.test(attempt.promotionAuthorizationSha256 ?? '')
    || !SHA256.test(attempt.promotionPlanSha256 ?? '')
    || !SHA256.test(attempt.freshStatusSha256 ?? '') || !UUID.test(attempt.targetVersionId ?? '')
    || Number.isNaN(Date.parse(attempt.startedAt ?? ''))
    || attempt.expectedStateSha256 !== lock.payload.expectedStateSha256) {
    fail('CLOUDFLARE_E_PROMOTION_ATTEMPT');
  }
  await writeFile(path.join(lock.directory, PENDING_FILE), `${canonicalJson(attempt)}\n`, {
    flag: 'wx', mode: 0o600,
  }).catch(() => fail('CLOUDFLARE_E_PROMOTION_PENDING'));
  await syncDirectory(lock.directory);
  return attempt;
}

export async function loadPromotionAttempt(lock) {
  await assertOwnedLock(lock);
  const pendingPath = path.join(lock.directory, PENDING_FILE);
  await secureFile(pendingPath);
  let attempt;
  try { attempt = JSON.parse(await readFile(pendingPath, 'utf8')); }
  catch { fail('CLOUDFLARE_E_PROMOTION_PENDING'); }
  const keys = ['schemaVersion', 'contract', 'attemptId', 'expectedStateSha256',
    'promotionAuthorizationSha256', 'promotionPlanSha256', 'freshStatusSha256',
    'targetVersionId', 'startedAt'];
  if (!attempt || Object.keys(attempt).length !== keys.length
    || Object.keys(attempt).some((key) => !keys.includes(key))
    || attempt.schemaVersion !== 1 || attempt.contract !== 'dwnc-cloudflare-promotion-attempt-v1'
    || !UUID.test(attempt.attemptId ?? '') || !SHA256.test(attempt.expectedStateSha256 ?? '')
    || !SHA256.test(attempt.promotionAuthorizationSha256 ?? '')
    || !SHA256.test(attempt.promotionPlanSha256 ?? '')
    || !SHA256.test(attempt.freshStatusSha256 ?? '') || !UUID.test(attempt.targetVersionId ?? '')
    || Number.isNaN(Date.parse(attempt.startedAt ?? ''))
    || attempt.expectedStateSha256 !== lock.payload.expectedStateSha256) {
    fail('CLOUDFLARE_E_PROMOTION_PENDING');
  }
  return attempt;
}

export async function commitPromotionHead({
  lock, expectedStateSha256, current, nextHead, publicKeyPem, expectedFingerprint,
}) {
  await assertOwnedLock(lock);
  validateSignedPromotionHead(nextHead, { publicKeyPem, expectedFingerprint });
  const pendingPath = path.join(lock.directory, PENDING_FILE);
  await secureFile(pendingPath);
  let pending;
  try { pending = JSON.parse(await readFile(pendingPath, 'utf8')); }
  catch { fail('CLOUDFLARE_E_PROMOTION_PENDING'); }
  if (pending.expectedStateSha256 !== expectedStateSha256
    || pending.targetVersionId !== nextHead.state.versionId
    || pending.promotionPlanSha256 !== nextHead.state.promotionPlanSha256) {
    fail('CLOUDFLARE_E_PROMOTION_PENDING');
  }
  const loaded = await loadPromotionHead({
    directory: lock.directory, publicKeyPem, expectedFingerprint,
  });
  const nextStateSha256 = sha256Hex(canonicalPromotionStatePayload(nextHead.state));
  if (loaded.stateSha256 === nextStateSha256
    && canonicalPromotionHeadPayload(loaded.head) === canonicalPromotionHeadPayload(nextHead)) {
    await rm(pendingPath);
    await syncDirectory(lock.directory);
    return loaded;
  }
  if (loaded.stateSha256 !== expectedStateSha256
    || canonicalPromotionHeadPayload(loaded.head) !== canonicalPromotionHeadPayload(current)) {
    fail('CLOUDFLARE_E_PROMOTION_CAS');
  }
  if (nextHead.state.generation !== current.state.generation + 1
    || nextHead.state.previousPromotionSha256 !== expectedStateSha256) {
    fail('CLOUDFLARE_E_PROMOTION_CAS');
  }
  const temporary = path.join(lock.directory, `.active-head.${lock.token}.tmp`);
  await writeFile(temporary, `${canonicalPromotionHeadPayload(nextHead)}\n`, { flag: 'wx', mode: 0o600 });
  const handle = await open(temporary, 'r');
  await handle.sync();
  await handle.close();
  await rename(temporary, path.join(lock.directory, HEAD_FILE));
  await syncDirectory(lock.directory);
  await rm(pendingPath);
  await syncDirectory(lock.directory);
  return loadPromotionHead({ directory: lock.directory, publicKeyPem, expectedFingerprint });
}

export async function releasePromotionLock(lock) {
  await assertOwnedLock(lock);
  await rm(lock.lockPath);
  await syncDirectory(lock.directory);
}

export async function abortPromotionAttempt(lock) {
  await assertOwnedLock(lock);
  const pendingPath = path.join(lock.directory, PENDING_FILE);
  await secureFile(pendingPath);
  await rm(pendingPath);
  await syncDirectory(lock.directory);
}

export async function writePromotionOutcomeEvidence({ lock, attemptId, evidence }) {
  await assertOwnedLock(lock);
  const keys = ['schemaVersion', 'contract', 'attemptId', 'expectedStateSha256',
    'promotionAuthorizationSha256', 'promotionPlanSha256', 'freshStatusSha256',
    'targetVersionId', 'classification', 'commandResult', 'deploymentOutputSha256',
    'rawStatusSha256', 'rawStatus', 'deploymentArgumentsSha256', 'statusArgumentsSha256',
    'observedAt'];
  if (!UUID.test(attemptId ?? '') || !evidence || typeof evidence !== 'object'
    || Object.keys(evidence).length !== keys.length
    || Object.keys(evidence).some((key) => !keys.includes(key))
    || evidence.schemaVersion !== 1 || evidence.contract !== 'dwnc-cloudflare-promotion-outcome-v1'
    || evidence.attemptId !== attemptId
    || ![evidence.expectedStateSha256, evidence.promotionAuthorizationSha256,
      evidence.promotionPlanSha256, evidence.freshStatusSha256, evidence.rawStatusSha256,
      evidence.deploymentArgumentsSha256, evidence.statusArgumentsSha256]
      .every((value) => SHA256.test(value ?? ''))
    || !UUID.test(evidence.targetVersionId ?? '')
    || !['committed', 'ambiguous', 'unknown'].includes(evidence.classification)
    || !['succeeded', 'failed', 'not-run'].includes(evidence.commandResult)
    || evidence.deploymentOutputSha256 !== null
      && !SHA256.test(evidence.deploymentOutputSha256 ?? '')
    || !evidence.rawStatus || typeof evidence.rawStatus !== 'object'
      || Array.isArray(evidence.rawStatus)
    || sha256Hex(canonicalJson(evidence.rawStatus)) !== evidence.rawStatusSha256
    || Number.isNaN(Date.parse(evidence.observedAt ?? ''))) {
    fail('CLOUDFLARE_E_PROMOTION_OUTCOME');
  }
  const serialized = `${canonicalJson(evidence)}\n`;
  const evidenceSha256 = sha256Hex(canonicalJson(evidence));
  const file = path.join(lock.directory,
    `promotion-outcome-${attemptId}-${evidence.rawStatusSha256}-${evidenceSha256}.json`);
  try {
    await writeFile(file, serialized, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    await secureFile(file);
    if (await readFile(file, 'utf8') !== serialized) fail('CLOUDFLARE_E_PROMOTION_OUTCOME_EXISTS');
  }
  await syncDirectory(lock.directory);
  return file;
}

export async function finalizeAlreadyCommittedAttempt({
  lock, current, publicKeyPem, expectedFingerprint,
}) {
  await assertOwnedLock(lock);
  validateSignedPromotionHead(current, { publicKeyPem, expectedFingerprint });
  const pendingPath = path.join(lock.directory, PENDING_FILE);
  await secureFile(pendingPath);
  let pending;
  try { pending = JSON.parse(await readFile(pendingPath, 'utf8')); }
  catch { fail('CLOUDFLARE_E_PROMOTION_PENDING'); }
  if (current.state.promotionPlanSha256 !== pending.promotionPlanSha256
    || current.state.versionId !== pending.targetVersionId
    || current.state.previousPromotionSha256 !== pending.expectedStateSha256) {
    fail('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
  await rm(pendingPath);
  await syncDirectory(lock.directory);
}

export async function promotionStoreStatus(directory) {
  await secureDirectory(directory);
  const [lock, pending] = await Promise.all([
    secureFile(path.join(directory, LOCK_FILE), { optional: true }),
    secureFile(path.join(directory, PENDING_FILE), { optional: true }),
  ]);
  return { lockPresent: lock !== null, pendingPresent: pending !== null };
}

export async function promotionRecoveryStatus(directory, { now = new Date(), minimumAgeMs = 5 * 60 * 1000 } = {}) {
  await secureDirectory(directory);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())
    || !Number.isSafeInteger(minimumAgeMs) || minimumAgeMs < 60_000) {
    fail('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
  const lockPath = path.join(directory, LOCK_FILE);
  const lockStats = await secureFile(lockPath, { optional: true });
  const pendingPresent = await secureFile(path.join(directory, PENDING_FILE), { optional: true }) !== null;
  if (lockStats === null) return {
    lockPresent: false, pendingPresent, ownerAlive: null, ageMs: null,
    recoveryEligible: false, recoveryToken: null,
  };
  let payload;
  try { payload = JSON.parse(await readFile(lockPath, 'utf8')); }
  catch { fail('CLOUDFLARE_E_PROMOTION_RECOVERY'); }
  if (payload.schemaVersion !== 1 || payload.contract !== 'dwnc-cloudflare-promotion-lock-v1'
    || !UUID.test(payload.token ?? '') || !SHA256.test(payload.expectedStateSha256 ?? '')
    || !Number.isSafeInteger(payload.pid) || payload.pid <= 0
    || Number.isNaN(Date.parse(payload.createdAt ?? ''))) {
    fail('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
  let ownerAlive = true;
  try { process.kill(payload.pid, 0); }
  catch (error) {
    if (error?.code === 'ESRCH') ownerAlive = false;
    else fail('CLOUDFLARE_E_PROMOTION_RECOVERY');
  }
  const ageMs = now.getTime() - Date.parse(payload.createdAt);
  const recoveryEligible = !ownerAlive && ageMs >= minimumAgeMs;
  return {
    lockPresent: true, pendingPresent, ownerAlive, ageMs, recoveryEligible,
    recoveryToken: recoveryEligible ? payload.token : null,
  };
}
