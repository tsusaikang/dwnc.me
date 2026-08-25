import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import {
  acquireStagingActivationLock,
  beginStagingActivation,
  loadStagingActivationAttempt,
  markStagingActivationInvoking,
  recoverStagingActivationLock,
  releaseStagingActivationLock,
  stagingActivationInvoking,
  stagingActivationRecoveryStatus,
  writeStagingActivationOutcome,
} from './lib/cloudflare-staging-activation-store.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-staging-store-'));
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const context = {
  attemptId: '12345678-1234-4123-8123-123456789abc',
  authorizationSha256: sha256Hex('authorization'),
  artifactSha256: sha256Hex('artifact'),
  payloadSha256: sha256Hex('payload'),
  targetVersionId: '22345678-1234-4123-8123-123456789abc',
  previousVersionId: '32345678-1234-4123-8123-123456789abc',
  deploymentArgumentsSha256: sha256Hex('arguments'),
};
const rawStatus = { id: '42345678-1234-4123-8123-123456789abc', versions: [
  { version_id: context.previousVersionId, percentage: 100 },
] };
try {
  const lock = await acquireStagingActivationLock(temporary, context);
  equal((await stagingActivationRecoveryStatus(temporary)).lockPresent, true);
  const pending = await beginStagingActivation(lock, { freshStatusSha256: sha256Hex('fresh') });
  equal((await loadStagingActivationAttempt(lock)).attemptId, pending.attemptId);
  equal(await stagingActivationInvoking(lock), false);
  await markStagingActivationInvoking(lock);
  equal(await stagingActivationInvoking(lock), true);
  const outcome = {
    schemaVersion: 1, contract: 'dwnc-cloudflare-staging-activation-outcome-v1',
    attemptId: context.attemptId, authorizationSha256: context.authorizationSha256,
    artifactSha256: context.artifactSha256, payloadSha256: context.payloadSha256,
    targetVersionId: context.targetVersionId, previousVersionId: context.previousVersionId,
    freshStatusSha256: pending.freshStatusSha256,
    classification: 'ambiguous', commandResult: 'failed',
    deploymentOutputSha256: sha256Hex('deployment-output'),
    rawStatusSha256: sha256Hex(canonicalJson(rawStatus)), rawStatus,
    deploymentArgumentsSha256: context.deploymentArgumentsSha256,
    statusArgumentsSha256: sha256Hex('status-arguments'),
    observedAt: '2026-08-25T00:00:00.000Z',
  };
  const firstOutcome = await writeStagingActivationOutcome(lock, outcome);
  equal(await writeStagingActivationOutcome(lock, outcome), firstOutcome);
  const lockPath = path.join(temporary, 'staging-activation.lock');
  const lockPayload = JSON.parse(await readFile(lockPath, 'utf8'));
  lockPayload.pid = 2147483646;
  lockPayload.createdAt = '2026-08-24T00:00:00.000Z';
  await writeFile(lockPath, `${canonicalJson(lockPayload)}\n`, { mode: 0o600 });
  const status = await stagingActivationRecoveryStatus(temporary, {
    now: new Date('2026-08-25T00:00:00.000Z'),
  });
  equal(status.recoveryEligible, true);
  await assert.rejects(() => recoverStagingActivationLock(temporary,
    '52345678-1234-4123-8123-123456789abc', { now: new Date('2026-08-25T00:00:00.000Z') }));
  assertions += 1;
  const recovered = await recoverStagingActivationLock(temporary, status.recoveryToken, {
    now: new Date('2026-08-25T00:00:00.000Z'),
  });
  equal(recovered.pendingPresent, true);
  equal(await stagingActivationInvoking(recovered), true);
  await releaseStagingActivationLock(recovered, { committed: true });
  const clean = await stagingActivationRecoveryStatus(temporary);
  equal(clean.lockPresent, false);
  equal(clean.pendingPresent, false);
  equal((await readdir(temporary)).filter((name) => name.startsWith('staging-activation-outcome-')).length, 1);

  const unstarted = await acquireStagingActivationLock(temporary, context);
  const unstartedPayload = JSON.parse(await readFile(unstarted.lockPath, 'utf8'));
  unstartedPayload.pid = 2147483646;
  unstartedPayload.createdAt = '2026-08-24T00:00:00.000Z';
  await writeFile(unstarted.lockPath, `${canonicalJson(unstartedPayload)}\n`, { mode: 0o600 });
  const unstartedStatus = await stagingActivationRecoveryStatus(temporary, {
    now: new Date('2026-08-25T00:00:00.000Z'),
  });
  const unstartedRecovery = await recoverStagingActivationLock(temporary,
    unstartedStatus.recoveryToken, { now: new Date('2026-08-25T00:00:00.000Z') });
  equal(unstartedRecovery.pendingPresent, false);
  await releaseStagingActivationLock(unstartedRecovery, { committed: false });
  equal((await stagingActivationRecoveryStatus(temporary)).lockPresent, false);
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log(JSON.stringify({
  suite: 'cloudflare-staging-activation-store', assertions,
  ambiguousPreserved: true, ownerDeadRecovery: true, liveNetworkCalls: 0, status: 'PASS',
}, null, 2));
