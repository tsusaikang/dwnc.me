import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalPromotionStatePayload,
  createPromotionGenesisState,
  sha256Hex,
} from './lib/cloudflare-release.mjs';
import {
  acquirePromotionLock,
  beginPromotionAttempt,
  commitPromotionHead,
  createSignedPromotionHead,
  initializePromotionStore,
  loadPromotionAttempt,
  loadPromotionHead,
  promotionStoreStatus,
  promotionRecoveryStatus,
  recoverPromotionLock,
  releasePromotionLock,
  writePromotionOutcomeEvidence,
} from './lib/cloudflare-promotion-store.mjs';
import { publicKeySpkiSha256 } from './lib/public-media-manifest.mjs';
import { claimOneTimeAuthorization } from './lib/cloudflare-process.mjs';

const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dwnc-promotion-store-')));
const store = path.join(temporary, 'store');
await mkdir(store, { mode: 0o700 });
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
try {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const fingerprint = publicKeySpkiSha256(publicKeyPem);
  const attempts = path.join(temporary, 'attempts');
  await mkdir(attempts, { mode: 0o700 });
  await claimOneTimeAuthorization({
    directory: attempts, authorizationSha256: '9'.repeat(64),
    scope: 'production-upload', target: 'dwnc-me',
  });
  await assert.rejects(() => claimOneTimeAuthorization({
    directory: attempts, authorizationSha256: '9'.repeat(64),
    scope: 'production-upload', target: 'dwnc-me',
  }), /CLOUDFLARE_E_AUTHORIZATION_REPLAY/u);
  assertions += 1;
  const genesis = createPromotionGenesisState();
  const genesisHead = createSignedPromotionHead({ state: genesis, privateKeyPem, publicKeyPem });
  await initializePromotionStore({
    directory: store, head: genesisHead, publicKeyPem, expectedFingerprint: fingerprint,
  });
  await assert.rejects(() => initializePromotionStore({
    directory: store, head: genesisHead, publicKeyPem, expectedFingerprint: fingerprint,
  }), /CLOUDFLARE_E_PROMOTION_STORE_EXISTS/u);
  assertions += 1;
  const loaded = await loadPromotionHead({ directory: store, publicKeyPem, expectedFingerprint: fingerprint });
  equal(loaded.stateSha256, sha256Hex(canonicalPromotionStatePayload(genesis)));
  const lock = await acquirePromotionLock(store, loaded.stateSha256);
  await assert.rejects(() => acquirePromotionLock(store, loaded.stateSha256),
    /CLOUDFLARE_E_PROMOTION_LOCKED/u);
  assertions += 1;
  const versionId = '12345678-1234-4123-8123-123456789abc';
  const planSha256 = 'd'.repeat(64);
  await beginPromotionAttempt({
    lock,
    attempt: {
      schemaVersion: 1,
      contract: 'dwnc-cloudflare-promotion-attempt-v1',
      attemptId: '22345678-1234-4123-8123-123456789abc',
      expectedStateSha256: loaded.stateSha256,
      promotionAuthorizationSha256: 'c'.repeat(64),
      promotionPlanSha256: planSha256,
      freshStatusSha256: '8'.repeat(64),
      targetVersionId: versionId,
      startedAt: '2026-08-25T00:00:00.000Z',
    },
  });
  const activeAttempt = await loadPromotionAttempt(lock);
  equal(activeAttempt.targetVersionId, versionId);
  const outcome = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-outcome-v1',
    attemptId: activeAttempt.attemptId,
    expectedStateSha256: activeAttempt.expectedStateSha256,
    promotionAuthorizationSha256: activeAttempt.promotionAuthorizationSha256,
    promotionPlanSha256: activeAttempt.promotionPlanSha256,
    freshStatusSha256: activeAttempt.freshStatusSha256,
    targetVersionId: activeAttempt.targetVersionId,
    classification: 'committed',
    commandResult: 'succeeded',
    deploymentOutputSha256: '7'.repeat(64),
    rawStatusSha256: sha256Hex(JSON.stringify({ versions: [] })),
    rawStatus: { versions: [] },
    deploymentArgumentsSha256: '6'.repeat(64),
    statusArgumentsSha256: '5'.repeat(64),
    observedAt: '2026-08-25T00:00:30.000Z',
  };
  const outcomePath = await writePromotionOutcomeEvidence({
    lock, attemptId: activeAttempt.attemptId, evidence: outcome,
  });
  equal(await writePromotionOutcomeEvidence({
    lock, attemptId: activeAttempt.attemptId, evidence: outcome,
  }), outcomePath);
  const allowed = [sha256Hex('/posts/1')];
  const nextState = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-promotion-state-v1',
    generation: 1,
    previousPromotionSha256: loaded.stateSha256,
    artifactSha256: 'a'.repeat(64),
    payloadSha256: 'b'.repeat(64),
    sourceGitSha: '1'.repeat(40),
    versionId,
    mediaManifestSha256: 'e'.repeat(64),
    allowedKeysSha256: sha256Hex(allowed.join('\n')),
    withdrawnKeyHashes: [],
    allowedKeyHashes: allowed,
    retiredArtifactSha256: [],
    retiredPayloadSha256: [],
    retiredVersionIds: [],
    promotionPlanSha256: planSha256,
    deploymentStatusSha256: 'f'.repeat(64),
    activatedAt: '2026-08-25T00:01:00.000Z',
  };
  const nextHead = createSignedPromotionHead({ state: nextState, privateKeyPem, publicKeyPem });
  const committed = await commitPromotionHead({
    lock, expectedStateSha256: loaded.stateSha256, current: loaded.head, nextHead,
    publicKeyPem, expectedFingerprint: fingerprint,
  });
  equal(committed.head.state.generation, 1);
  equal((await promotionStoreStatus(store)).pendingPresent, false);
  await releasePromotionLock(lock);
  equal(await promotionStoreStatus(store), { lockPresent: false, pendingPresent: false });

  const orphanLock = await acquirePromotionLock(store, committed.stateSha256);
  const orphanPayload = {
    ...orphanLock.payload,
    pid: 2_147_483_647,
    createdAt: '2026-08-25T00:00:00.000Z',
  };
  await writeFile(orphanLock.lockPath, `${JSON.stringify(orphanPayload)}\n`, { mode: 0o600 });
  const recoveredLock = await recoverPromotionLock(store, orphanLock.token, {
    now: new Date('2026-08-25T00:10:00.000Z'),
  });
  equal(recoveredLock.pendingPresent, false);
  equal((await promotionRecoveryStatus(store, {
    now: new Date('2026-08-25T00:10:00.000Z'),
  })).recoveryToken, orphanLock.token);
  await releasePromotionLock(recoveredLock);

  const tamperLock = await acquirePromotionLock(store, committed.stateSha256);
  await beginPromotionAttempt({
    lock: tamperLock,
    attempt: {
      schemaVersion: 1, contract: 'dwnc-cloudflare-promotion-attempt-v1',
      attemptId: '32345678-1234-4123-8123-123456789abc',
      expectedStateSha256: committed.stateSha256,
      promotionAuthorizationSha256: '1'.repeat(64), promotionPlanSha256: '2'.repeat(64),
      freshStatusSha256: '3'.repeat(64),
      targetVersionId: '42345678-1234-4123-8123-123456789abc',
      startedAt: '2026-08-25T00:02:00.000Z',
    },
  });
  const pendingPath = path.join(store, 'promotion.pending.json');
  const pending = JSON.parse(await readFile(pendingPath, 'utf8'));
  await writeFile(pendingPath, `${JSON.stringify({ ...pending, targetVersionId: versionId })}\n`, { mode: 0o600 });
  await assert.rejects(() => commitPromotionHead({
    lock: tamperLock, expectedStateSha256: committed.stateSha256, current: committed.head,
    nextHead, publicKeyPem, expectedFingerprint: fingerprint,
  }), /CLOUDFLARE_E_PROMOTION_PENDING/u);
  assertions += 1;
  console.log(JSON.stringify({
    suite: 'cloudflare-authoritative-promotion-store', assertions,
    atomicHead: true, generationCas: true, pendingBound: true,
    liveNetworkCalls: 0, status: 'PASS',
  }, null, 2));
} finally {
  await chmod(store, 0o700).catch(() => undefined);
  for (const file of ['active-head.json', 'promotion.lock', 'promotion.pending.json']) {
    await chmod(path.join(store, file), 0o600).catch(() => undefined);
  }
  await rm(temporary, { recursive: true, force: true });
}
