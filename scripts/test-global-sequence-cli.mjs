import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  inspectSequenceLock,
  LOCK_FILENAME,
  LOCK_TRANSFER_FILENAME,
  readLockTransfer,
} from './lib/global-sequence.mjs';
import { createPublicMediaManifest } from './lib/public-media-manifest.mjs';

const PROJECT_ROOT = process.cwd();
const MANAGER = path.join(PROJECT_ROOT, 'scripts/manage-global-sequence.mjs');
const AUTHORITATIVE_SEQUENCE = path.join(PROJECT_ROOT, 'migration/private/sequence');
const PUBLIC_PROJECTION = path.join(PROJECT_ROOT, 'src/data/public-sequence-v1.json');
const TOKEN = 'a'.repeat(40);

async function writeExact(file, bytes, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { mode });
  await chmod(file, mode);
}

async function runCli(root, stage = null) {
  const env = { ...process.env, NODE_ENV: 'test' };
  if (stage) env.DWNC_SEQUENCE_TEST_RECOVERY_EXIT = stage;
  const child = spawn(process.execPath, [MANAGER, 'recover-transfer', '--token', TOKEN], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, stdout, stderr };
}

async function runVerify(root) {
  const child = spawn(process.execPath, [MANAGER, 'verify'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, stdout, stderr };
}

async function prepareFixture(root) {
  await chmod(root, 0o700);
  const privateRoot = path.join(root, 'migration/private');
  const sequenceRoot = path.join(privateRoot, 'sequence');
  const eventsRoot = path.join(sequenceRoot, 'events-v1');
  await mkdir(eventsRoot, { recursive: true, mode: 0o700 });
  await chmod(privateRoot, 0o700);
  await chmod(sequenceRoot, 0o700);
  await chmod(eventsRoot, 0o700);

  for (const name of [
    'global-sequence-v1.json',
    'bootstrap-private-metadata-v1.json',
    'global-sequence-v1.seal.json',
  ]) {
    await writeExact(
      path.join(sequenceRoot, name),
      await readFile(path.join(AUTHORITATIVE_SEQUENCE, name)),
      0o600,
    );
  }
  for (const name of await readdir(path.join(AUTHORITATIVE_SEQUENCE, 'events-v1'))) {
    if (!name.endsWith('.json')) continue;
    await writeExact(
      path.join(eventsRoot, name),
      await readFile(path.join(AUTHORITATIVE_SEQUENCE, 'events-v1', name)),
      0o600,
    );
  }

  const projectionRaw = await readFile(PUBLIC_PROJECTION);
  await writeExact(path.join(root, 'src/data/public-sequence-v1.json'), projectionRaw, 0o644);
  await writeExact(
    path.join(root, 'src/data/public-asset-receipts-v1.json'),
    `${JSON.stringify({ schemaVersion: 1, receipts: [] }, null, 2)}\n`,
    0o644,
  );
  await writeExact(
    path.join(root, 'src/data/public-media-r2-v1.json'),
    `${JSON.stringify(createPublicMediaManifest([]), null, 2)}\n`,
    0o644,
  );
  await writeExact(
    path.join(root, 'src/data/genesis-public-identities-v1.json'),
    await readFile(path.join(PROJECT_ROOT, 'src/data/genesis-public-identities-v1.json')),
    0o644,
  );

  const ledger = JSON.parse(await readFile(path.join(sequenceRoot, 'global-sequence-v1.json'), 'utf8'));
  const publicEntries = ledger.entries.filter((entry) => entry.visibility === 'public' && entry.status === 'active');
  assert.equal(publicEntries.length, 349);
  const tistoryInventory = [];
  const naverInventory = [];
  for (const entry of publicEntries) {
    const contentDirectory = path.join(root, 'src/data/posts', entry.source);
    await mkdir(contentDirectory, { recursive: true });
    const canonicalPath = entry.source === 'tistory' ? `/${entry.sourceId}` : `/naver/${entry.sourceId}`;
    const frontmatter = [
      '---',
      `source: ${entry.source}`,
      `sourceId: ${JSON.stringify(entry.sourceId)}`,
      'visibility: public',
      `publishedAt: ${JSON.stringify(entry.publishedAt)}`,
      `canonicalPath: ${canonicalPath}`,
      '---',
      'synthetic public recovery fixture',
      '',
    ].join('\n');
    await writeExact(path.join(contentDirectory, `${entry.sourceId}.md`), frontmatter, 0o644);
    if (entry.source === 'tistory') tistoryInventory.push({ source_id: entry.sourceId, media: [] });
    else naverInventory.push({ source_id: entry.sourceId, images: [], videos: [], attachments: [] });
  }
  await mkdir(path.join(root, 'src/data/posts/native'), { recursive: true });
  await mkdir(path.join(root, 'public'), { recursive: true });
  await writeExact(
    path.join(root, 'migration/source-inventory/tistory-posts.json'),
    `${JSON.stringify({ posts: tistoryInventory })}\n`,
    0o600,
  );
  await writeExact(
    path.join(root, 'migration/source-inventory/naver-public-posts.json'),
    `${JSON.stringify({ posts: naverInventory })}\n`,
    0o600,
  );

  const lock = {
    schemaVersion: 1,
    token: TOKEN,
    pid: 2147483647,
    createdAt: '2000-01-01T00:00:00.000Z',
    observedGeneration: ledger.generation,
  };
  await writeExact(path.join(sequenceRoot, LOCK_FILENAME), `${JSON.stringify(lock, null, 2)}\n`, 0o600);
  return { sequenceRoot, generation: ledger.generation };
}

const fixtureRoot = await mkdtemp('/private/tmp/dwnc-sequence-cli-test-');
try {
  const { sequenceRoot, generation } = await prepareFixture(fixtureRoot);
  const lockFile = path.join(sequenceRoot, LOCK_FILENAME);
  const transferFile = path.join(sequenceRoot, LOCK_TRANSFER_FILENAME);

  const afterAcquire = await runCli(fixtureRoot, 'after-acquire');
  assert.equal(afterAcquire.code, 74);
  const receipt = await readLockTransfer(transferFile, { allowMissing: false });
  const acquiredLease = await inspectSequenceLock(lockFile, { staleAfterMs: 0 });
  assert.equal(acquiredLease.kind, 'global-sequence-transfer-recovery');
  assert.equal(acquiredLease.token, receipt.recoveryToken);
  assert.equal(acquiredLease.transferId, receipt.transferId);
  assert.equal(acquiredLease.receiptSha256, receipt.receiptSha256);
  assert.equal(acquiredLease.observedGeneration, generation);

  const afterOperation = await runCli(fixtureRoot, 'after-operation');
  assert.equal(afterOperation.code, 75);
  const reconciledLease = await inspectSequenceLock(lockFile, { staleAfterMs: 0 });
  assert.equal(reconciledLease.kind, 'global-sequence-transfer-recovery');
  assert.equal(reconciledLease.ownerAlive, false);
  assert.equal((await readLockTransfer(transferFile, { allowMissing: false })).receiptSha256, receipt.receiptSha256);

  const afterLockRelease = await runCli(fixtureRoot, 'after-lock-release');
  assert.equal(afterLockRelease.code, 76);
  assert.equal((await inspectSequenceLock(lockFile)).present, false);
  assert.equal(
    (await readLockTransfer(transferFile, { allowMissing: false })).receiptSha256,
    receipt.receiptSha256,
  );

  const recovered = await runCli(fixtureRoot, 'resume');
  assert.equal(recovered.code, 0, recovered.stderr.trim());
  const recoveryResult = JSON.parse(recovered.stdout);
  assert.equal(recoveryResult.staleLockTransferRecovered, true);
  assert.equal(recoveryResult.generation, generation);
  assert.equal((await inspectSequenceLock(lockFile)).present, false);
  assert.equal(await readLockTransfer(transferFile), null);

  const verified = await runVerify(fixtureRoot);
  assert.equal(verified.code, 0);
  const verification = JSON.parse(verified.stdout);
  assert.equal(verification.generation, generation);
  assert.equal(verification.pendingTransaction, false);
  console.log(JSON.stringify({ fixtures: 5, status: 'PASS' }, null, 2));
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
