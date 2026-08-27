import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalEvidenceStorageBytes,
  initializeSigningKey,
  loadSigningKey,
  readSecureFile,
  signCanonicalEvidence,
  validateSigningKeyMetadata,
  writeCanonicalEvidenceCreateOnly,
  writeSecureCreateOnly,
  writeSignedEvidenceOutputs,
} from './lib/cloudflare-signing-key.mjs';
import {
  canonicalDeploymentStatusCapturePayload,
  canonicalDeploymentStatusEvidencePayload,
  canonicalJson,
  createDeploymentStatusEvidence,
  loadSignedJsonFiles,
  validateDeploymentStatusCapture,
  validateDeploymentStatusEvidence,
  verifySignedPayload,
} from './lib/cloudflare-release.mjs';
import { claimOneTimeAuthorization } from './lib/cloudflare-process.mjs';
import { produceDeploymentStatusCaptureAndEvidence } from './lib/cloudflare-deployment-status.mjs';

class MemoryKeychainStore {
  values = new Map();
  calls = [];
  key(service, account) { return `${service}\0${account}`; }
  async get(service, account) {
    this.calls.push({ operation: 'get', service, account });
    return this.values.get(this.key(service, account)) ?? null;
  }
  async putCreateOnly(service, account, value) {
    this.calls.push({ operation: 'putCreateOnly', service, account });
    const key = this.key(service, account);
    if (this.values.has(key)) throw new Error('CLOUDFLARE_E_SIGNING_KEY_EXISTS');
    this.values.set(key, value);
  }
}

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.message === code);
  assertions += 1;
};

const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dwnc-signing-key-test-')));
await chmod(directory, 0o700);
try {
  const metadataPath = path.join(directory, 'staging-release-control.json');
  const store = new MemoryKeychainStore();
  const metadata = await initializeSigningKey({
    environment: 'staging',
    role: 'release-control',
    metadataOutput: metadataPath,
    store,
    now: new Date('2026-08-26T00:00:00.000Z'),
  });
  equal(metadata.algorithm, 'Ed25519');
  equal(metadata.publicKeySpkiSha256.length, 64);
  const metadataStats = await lstat(metadataPath);
  equal(metadataStats.mode & 0o777, 0o600);
  equal(metadataStats.nlink, 1);
  validateSigningKeyMetadata(metadata, { environment: 'staging', role: 'release-control' });
  assertions += 1;
  const loaded = await loadSigningKey({
    environment: 'staging', role: 'release-control', metadataPath, store,
  });
  equal(loaded.metadata.publicKeySpkiSha256, metadata.publicKeySpkiSha256);
  await rejects(() => initializeSigningKey({
    environment: 'staging', role: 'release-control', metadataOutput: metadataPath, store,
  }), 'CLOUDFLARE_E_SIGNING_FILE_EXISTS');

  const statusVersionId = '12345678-1234-4123-8123-123456789abc';
  const rawStatus = {
    id: '22345678-1234-4123-8123-123456789abc',
    versions: [{ version_id: statusVersionId, percentage: 100 }],
  };
  const statusStartedAt = '2026-08-27T00:01:00.000Z';
  const statusCompletedAt = '2026-08-27T00:01:01.000Z';
  const statusEvidence = createDeploymentStatusEvidence({
    rawStatus,
    targetVersionId: statusVersionId,
    observedAt: statusCompletedAt,
    environment: 'staging',
    workerName: 'dwnc-me-staging',
  });
  const statusCapturePath = path.join(directory, 'staging-deployment-status.capture.json');
  const statusEvidencePath = path.join(directory, 'staging-deployment-status.evidence.json');
  const statusArgs = ['deployments', 'status', '--json', '--env', 'staging'];
  const statusStdout = `${JSON.stringify(rawStatus, null, 2)}\n`;
  const statusCapture = await produceDeploymentStatusCaptureAndEvidence({
    capturePath: statusCapturePath,
    evidencePath: statusEvidencePath,
    args: statusArgs,
    stdout: statusStdout,
    startedAt: statusStartedAt,
    completedAt: statusCompletedAt,
    evidence: statusEvidence,
    rawStatus,
  });
  validateDeploymentStatusCapture(statusCapture);
  assertions += 1;
  equal(await readFile(statusCapturePath, 'utf8'),
    `${canonicalDeploymentStatusCapturePayload(statusCapture)}\n`);
  equal(await readFile(statusEvidencePath, 'utf8'),
    `${canonicalDeploymentStatusEvidencePayload(statusEvidence)}\n`);
  const statusStored = await readSecureFile(statusEvidencePath);
  const signedStatus = await signCanonicalEvidence({
    environment: 'staging', role: 'release-control', metadataPath,
    canonicalBytes: statusStored, store,
    expectedPublicKeySpkiSha256: metadata.publicKeySpkiSha256,
  });
  statusStored.fill(0);
  const statusSignaturePath = path.join(directory, 'staging-deployment-status.sig');
  const statusPublicKeyPath = path.join(directory, 'staging-deployment-status.pem');
  await writeSignedEvidenceOutputs({
    signaturePath: statusSignaturePath,
    publicKeyPath: statusPublicKeyPath,
    signature: signedStatus.signature,
    publicKeyPem: signedStatus.publicKeyPem,
  });
  const loadedStatus = await loadSignedJsonFiles({
    receiptPath: statusEvidencePath,
    signaturePath: statusSignaturePath,
    publicKeyPath: statusPublicKeyPath,
  });
  equal(verifySignedPayload({
    payload: loadedStatus.receipt,
    canonicalPayload: canonicalDeploymentStatusEvidencePayload,
    validator: validateDeploymentStatusEvidence,
    signature: loadedStatus.signature,
    publicKeyPem: loadedStatus.publicKeyPem,
    expectedPublicKeySpkiSha256: metadata.publicKeySpkiSha256,
    validation: { expected: { environment: 'staging', targetVersionId: statusVersionId } },
  }), true);
  const captureStored = await readSecureFile(statusCapturePath);
  await rejects(() => signCanonicalEvidence({
    environment: 'staging', role: 'release-control', metadataPath,
    canonicalBytes: captureStored, store,
  }), 'CLOUDFLARE_E_SIGNING_ROLE');
  captureStored.fill(0);
  assert.throws(() => validateDeploymentStatusCapture({
    ...statusCapture,
    evidence: { ...statusCapture.evidence, targetPercentage: 99 },
  }), /CLOUDFLARE_E_DEPLOYMENT_STATUS/u);
  assertions += 1;
  await rejects(() => produceDeploymentStatusCaptureAndEvidence({
    capturePath: path.join(directory, 'same-status.json'),
    evidencePath: path.join(directory, 'same-status.json'),
    args: statusArgs,
    stdout: statusStdout,
    startedAt: statusStartedAt,
    completedAt: statusCompletedAt,
    evidence: statusEvidence,
    rawStatus,
  }), 'CLOUDFLARE_E_STATUS_PATH');
  const [stagingFetcherSource, productionFetcherSource] = await Promise.all([
    readFile('scripts/fetch-cloudflare-staging-deployment-status.mjs', 'utf8'),
    readFile('scripts/fetch-cloudflare-deployment-status.mjs', 'utf8'),
  ]);
  equal(stagingFetcherSource.includes('CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_CAPTURE_PATH'), true);
  equal(stagingFetcherSource.includes('CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_EVIDENCE_PATH'), true);
  equal(productionFetcherSource.includes('CLOUDFLARE_DEPLOYMENT_STATUS_CAPTURE_PATH'), true);
  equal(productionFetcherSource.includes('CLOUDFLARE_DEPLOYMENT_STATUS_EVIDENCE_PATH'), true);

  const releaseContracts = [
    'dwnc-cloudflare-service-existence-v1',
    'dwnc-cloudflare-bootstrap-authorization-v1',
    'dwnc-cloudflare-deny-bootstrap-attestation-v1',
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
  ];
  for (const [index, contract] of releaseContracts.entries()) {
    const payloadObject = { schemaVersion: 1, contract, environment: 'staging' };
    const candidatePath = path.join(directory, `candidate-${index}.json`);
    await writeCanonicalEvidenceCreateOnly(candidatePath, payloadObject);
    const stored = await readSecureFile(candidatePath);
    equal(stored.toString(), `${canonicalJson(payloadObject)}\n`);
    const signed = await signCanonicalEvidence({
      environment: 'staging', role: 'release-control', metadataPath,
      canonicalBytes: stored, store,
      expectedPublicKeySpkiSha256: metadata.publicKeySpkiSha256,
    });
    equal(signed.publicKeySpkiSha256, metadata.publicKeySpkiSha256);
    equal(verify(null, Buffer.from(canonicalJson(payloadObject)), metadata.publicKeyPem,
      signed.signature), true);
  }
  const payload = canonicalJson({
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-workers-dev-status-v1',
    environment: 'staging',
  });
  await rejects(() => signCanonicalEvidence({
    environment: 'staging', role: 'media-receipt', metadataPath,
    canonicalBytes: Buffer.from(`${payload}\n`), store,
  }), 'CLOUDFLARE_E_SIGNING_ROLE');
  await rejects(() => signCanonicalEvidence({
    environment: 'staging', role: 'release-control', metadataPath,
    canonicalBytes: Buffer.from(payload), store,
  }), 'CLOUDFLARE_E_SIGNING_CANONICAL');
  for (const noncanonical of [
    `${payload}\r\n`,
    `${payload}\n\n`,
    `${JSON.stringify(JSON.parse(payload), null, 2)}\n`,
    '{"environment":"staging","contract":"dwnc-cloudflare-workers-dev-status-v1","schemaVersion":1}\n',
  ]) {
    await rejects(() => signCanonicalEvidence({
      environment: 'staging', role: 'release-control', metadataPath,
      canonicalBytes: Buffer.from(noncanonical), store,
    }), 'CLOUDFLARE_E_SIGNING_CANONICAL');
  }
  await rejects(() => signCanonicalEvidence({
    environment: 'production', role: 'release-control', metadataPath,
    canonicalBytes: Buffer.from(`${payload}\n`), store,
  }), 'CLOUDFLARE_E_SIGNING_ROLE');
  await rejects(() => signCanonicalEvidence({
    environment: 'staging', role: 'release-control', metadataPath,
    canonicalBytes: Buffer.from(canonicalJson({
      schemaVersion: 2,
      contract: 'dwnc-cloudflare-workers-dev-status-v1',
      environment: 'staging',
    }) + '\n'), store,
  }), 'CLOUDFLARE_E_SIGNING_CANONICAL');
  await rejects(() => signCanonicalEvidence({
    environment: 'staging', role: 'release-control', metadataPath,
    canonicalBytes: Buffer.from(`${payload}\n`),
    expectedPublicKeySpkiSha256: '0'.repeat(64),
    store,
  }), 'CLOUDFLARE_E_SIGNING_PIN');

  const mediaMetadataPath = path.join(directory, 'staging-media-receipt.json');
  const mediaMetadata = await initializeSigningKey({
    environment: 'staging', role: 'media-receipt', metadataOutput: mediaMetadataPath, store,
    now: new Date('2026-08-26T00:00:00.000Z'),
  });
  equal(mediaMetadata.publicKeySpkiSha256 === metadata.publicKeySpkiSha256, false);
  const mediaPayload = canonicalJson({
    schemaVersion: 1,
    contract: 'dwnc-public-media-r2-receipt-v1',
    target: { environment: 'staging' },
  });
  const mediaSigned = await signCanonicalEvidence({
    environment: 'staging', role: 'media-receipt', metadataPath: mediaMetadataPath,
    canonicalBytes: Buffer.from(`${mediaPayload}\n`), store,
    expectedPublicKeySpkiSha256: mediaMetadata.publicKeySpkiSha256,
  });
  equal(verify(null, Buffer.from(mediaPayload), mediaMetadata.publicKeyPem, mediaSigned.signature), true);
  const bulkOperationalPayload = canonicalJson({
    schemaVersion: 1,
    contract: 'dwnc-public-media-r2-bulk-sync-v1',
    target: { environment: 'staging' },
  });
  await rejects(() => signCanonicalEvidence({
    environment: 'staging', role: 'media-receipt', metadataPath: mediaMetadataPath,
    canonicalBytes: Buffer.from(`${bulkOperationalPayload}\n`), store,
    expectedPublicKeySpkiSha256: mediaMetadata.publicKeySpkiSha256,
  }), 'CLOUDFLARE_E_SIGNING_ROLE');

  const rsaMetadata = path.join(directory, 'rsa.json');
  await rejects(() => initializeSigningKey({
    environment: 'production', role: 'release-control', metadataOutput: rsaMetadata,
    store: new MemoryKeychainStore(), generate: () => generateKeyPairSync('rsa', { modulusLength: 2048 }),
  }), 'CLOUDFLARE_E_SIGNING_KEY');

  const recoveryPath = path.join(directory, 'staging-recovery.json');
  const recoveryStore = new MemoryKeychainStore();
  const crashedMetadata = await initializeSigningKey({
    environment: 'staging', role: 'release-control', metadataOutput: recoveryPath,
    store: recoveryStore, now: new Date('2026-08-26T00:00:00.000Z'),
  });
  await rm(recoveryPath);
  await rejects(() => initializeSigningKey({
    environment: 'staging', role: 'release-control', metadataOutput: recoveryPath,
    store: recoveryStore, recoveryPublicKeySpkiSha256: '0'.repeat(64),
  }), 'CLOUDFLARE_E_SIGNING_RECOVERY');
  const recoveredMetadata = await initializeSigningKey({
    environment: 'staging', role: 'release-control', metadataOutput: recoveryPath,
    store: recoveryStore,
    recoveryPublicKeySpkiSha256: crashedMetadata.publicKeySpkiSha256,
    now: new Date('2026-08-26T00:01:00.000Z'),
  });
  equal(recoveredMetadata.publicKeySpkiSha256, crashedMetadata.publicKeySpkiSha256);

  const outputPayload = canonicalEvidenceStorageBytes({
    schemaVersion: 1, contract: 'dwnc-cloudflare-workers-dev-status-v1', environment: 'staging',
  });
  const outputSigned = await signCanonicalEvidence({
    environment: 'staging', role: 'release-control', metadataPath,
    canonicalBytes: outputPayload, store,
  });
  const signatureOutput = path.join(directory, 'evidence.sig');
  const publicKeyOutput = path.join(directory, 'evidence.pem');
  await rejects(() => writeSignedEvidenceOutputs({
    signaturePath: signatureOutput, publicKeyPath: publicKeyOutput,
    signature: outputSigned.signature, publicKeyPem: outputSigned.publicKeyPem,
    hooks: { afterSignatureReady: () => { throw new Error('SYNTHETIC_CRASH'); } },
  }), 'SYNTHETIC_CRASH');
  equal((await lstat(signatureOutput)).isFile(), true);
  equal(await lstat(publicKeyOutput).catch(() => null), null);
  const outputRecovery = await writeSignedEvidenceOutputs({
    signaturePath: signatureOutput, publicKeyPath: publicKeyOutput,
    signature: outputSigned.signature, publicKeyPem: outputSigned.publicKeyPem,
  });
  equal(outputRecovery.recovered, true);
  await rejects(() => writeSignedEvidenceOutputs({
    signaturePath: signatureOutput, publicKeyPath: publicKeyOutput,
    signature: Buffer.alloc(64, 7), publicKeyPem: outputSigned.publicKeyPem,
  }), 'CLOUDFLARE_E_SIGNING_OUTPUT_MISMATCH');

  const secureFile = path.join(directory, 'secure.txt');
  await writeSecureCreateOnly(secureFile, 'secure');
  equal((await readSecureFile(secureFile)).toString(), 'secure');
  await rejects(() => writeSecureCreateOnly(secureFile, 'overwrite'), 'CLOUDFLARE_E_SIGNING_FILE_EXISTS');
  const hardlink = path.join(directory, 'hardlink.txt');
  await link(secureFile, hardlink);
  await rejects(() => readSecureFile(secureFile), 'CLOUDFLARE_E_SIGNING_FILE');
  const symlinkPath = path.join(directory, 'symlink.txt');
  await symlink(metadataPath, symlinkPath);
  await rejects(() => readSecureFile(symlinkPath), 'CLOUDFLARE_E_SIGNING_FILE');
  const loose = path.join(directory, 'loose.txt');
  await writeFile(loose, 'loose', { mode: 0o644 });
  await rejects(() => readSecureFile(loose), 'CLOUDFLARE_E_SIGNING_FILE');

  const raceParent = path.join(directory, 'race-parent');
  const movedRaceParent = path.join(directory, 'race-parent-original');
  await mkdir(raceParent, { mode: 0o700 });
  await rejects(() => writeSecureCreateOnly(path.join(raceParent, 'output'), 'secret', {
    hooks: {
      afterParentOpened: async () => {
        await rename(raceParent, movedRaceParent);
        await mkdir(raceParent, { mode: 0o700 });
      },
    },
  }), 'CLOUDFLARE_E_SIGNING_FILE_RACE');
  equal(await lstat(path.join(raceParent, 'output')).catch(() => null), null);
  equal(await lstat(path.join(movedRaceParent, 'output')).catch(() => null), null);

  const readRaceParent = path.join(directory, 'read-race-parent');
  const movedReadRaceParent = path.join(directory, 'read-race-parent-original');
  await mkdir(readRaceParent, { mode: 0o700 });
  await writeSecureCreateOnly(path.join(readRaceParent, 'input'), 'trusted');
  await rejects(() => readSecureFile(path.join(readRaceParent, 'input'), 64, {
    hooks: {
      afterParentOpened: async () => {
        await rename(readRaceParent, movedReadRaceParent);
        await mkdir(readRaceParent, { mode: 0o700 });
        await writeFile(path.join(readRaceParent, 'input'), 'attacker', { mode: 0o600 });
      },
    },
  }), 'CLOUDFLARE_E_SIGNING_FILE_RACE');
  equal(await readFile(path.join(readRaceParent, 'input'), 'utf8'), 'attacker');
  equal(await readFile(path.join(movedReadRaceParent, 'input'), 'utf8'), 'trusted');

  const claimRaceParent = path.join(directory, 'claim-race-parent');
  const movedClaimRaceParent = path.join(directory, 'claim-race-parent-original');
  await mkdir(claimRaceParent, { mode: 0o700 });
  const claimSha256 = '8'.repeat(64);
  await rejects(() => claimOneTimeAuthorization({
    directory: claimRaceParent,
    authorizationSha256: claimSha256,
    scope: 'aba-claim',
    target: 'dwnc-me-staging',
    hooks: {
      afterParentOpened: async () => {
        await rename(claimRaceParent, movedClaimRaceParent);
        await mkdir(claimRaceParent, { mode: 0o700 });
      },
    },
  }), 'CLOUDFLARE_E_AUTHORIZATION_ATTEMPT');
  const claimLeaf = `aba-claim-${claimSha256}.json`;
  equal(await lstat(path.join(claimRaceParent, claimLeaf)).catch(() => null), null);
  equal(await lstat(path.join(movedClaimRaceParent, claimLeaf)).catch(() => null), null);

  const symlinkRace = path.join(directory, 'symlink-race');
  await rejects(() => writeSecureCreateOnly(symlinkRace, 'secret', {
    hooks: { afterParentOpened: () => symlink(metadataPath, symlinkRace) },
  }), 'CLOUDFLARE_E_SIGNING_FILE_EXISTS');

  const hardlinkRace = path.join(directory, 'hardlink-race');
  const hardlinkRaceAlias = path.join(directory, 'hardlink-race-alias');
  await rejects(() => writeSecureCreateOnly(hardlinkRace, 'secret', {
    hooks: { afterLeafOpened: () => link(hardlinkRace, hardlinkRaceAlias) },
  }), 'CLOUDFLARE_E_SIGNING_FILE_RACE');

  const [initializerSource, signerSource, keychainSource] = await Promise.all([
    readFile('scripts/initialize-cloudflare-signing-key.mjs', 'utf8'),
    readFile('scripts/sign-cloudflare-evidence.mjs', 'utf8'),
    readFile('scripts/lib/cloudflare-signing-key.mjs', 'utf8'),
  ]);
  equal(initializerSource.includes('/^--([a-z0-9-]+)=(.+)$/u'), true);
  equal(signerSource.includes('/^--([a-z0-9-]+)=(.+)$/u'), true);
  equal(keychainSource.includes('![0, 1].includes(code)'), true);

  equal(store.calls.some((call) => call.operation === 'putCreateOnly'), true);
  equal(store.calls.every((call) => !('value' in call)), true);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(JSON.stringify({
  suite: 'cloudflare-signing-key',
  assertions,
  realKeychainCalls: 0,
  externalWrites: 0,
  status: 'PASS',
}, null, 2));
