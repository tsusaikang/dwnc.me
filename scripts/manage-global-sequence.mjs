import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  allocateSequence,
  assertBootstrapMayInitialize,
  assertBootstrapEvidence,
  assertSecureDirectory,
  BOOTSTRAP_ENTRY_COUNT,
  BOOTSTRAP_PRIVATE_COUNT,
  BOOTSTRAP_PUBLIC_COUNT,
  BOOTSTRAP_SEAL_FILENAME,
  buildPublicProjection,
  clearLockTransfer,
  commitSequenceTransaction,
  createBootstrapSeal,
  createInitializationMarker,
  createInitialLedger,
  createJournalEvent,
  DEFAULT_STALE_LOCK_AGE_MS,
  inspectSequenceLock,
  INITIALIZATION_FILENAME,
  JOURNAL_DIRECTORYNAME,
  LOCK_FILENAME,
  LOCK_TRANSFER_FILENAME,
  objectDigest,
  PRIVATE_METADATA_FILENAME,
  privateBootstrapSidecarFromGenesisLedger,
  publicProjectionDigest,
  readJournal,
  readLockTransfer,
  readPendingInitialization,
  readJsonSecure,
  readPendingTransaction,
  readPrivateLedger,
  readSecureFile,
  removeStaleSequenceLock,
  reconcilePendingTransaction,
  reconcileInitialization,
  replayJournal,
  SequenceError,
  setSequenceVisibility,
  stableJson,
  tombstoneSequence,
  TRANSACTION_FILENAME,
  validateBootstrapSeal,
  validatePrivateBootstrapSidecar,
  validatePublicProjection,
  withSequenceLock,
  writeNoReplaceFile,
  writePrivateLedger,
  writePublicProjection,
} from './lib/global-sequence.mjs';
import {
  assertPreparedPublicIdentity,
  indexPreparedPublicContent,
  selectProjectionBackedContent,
} from './lib/public-content-preflight.mjs';

const ROOT = process.cwd();
const PRIVATE_DIRECTORY = path.join(ROOT, 'migration/private/sequence');
const PRIVATE_ROOT = path.dirname(PRIVATE_DIRECTORY);
const LEDGER_FILE = path.join(PRIVATE_DIRECTORY, 'global-sequence-v1.json');
const PRIVATE_METADATA_FILE = path.join(PRIVATE_DIRECTORY, PRIVATE_METADATA_FILENAME);
const SEAL_FILE = path.join(PRIVATE_DIRECTORY, BOOTSTRAP_SEAL_FILENAME);
const JOURNAL_DIRECTORY = path.join(PRIVATE_DIRECTORY, JOURNAL_DIRECTORYNAME);
const TRANSACTION_FILE = path.join(PRIVATE_DIRECTORY, TRANSACTION_FILENAME);
const LOCK_FILE = path.join(PRIVATE_DIRECTORY, LOCK_FILENAME);
const LOCK_TRANSFER_FILE = path.join(PRIVATE_DIRECTORY, LOCK_TRANSFER_FILENAME);
const INITIALIZATION_FILE = path.join(PRIVATE_DIRECTORY, INITIALIZATION_FILENAME);
const PUBLIC_PROJECTION_FILE = path.join(ROOT, 'src/data/public-sequence-v1.json');
const TISTORY_PUBLIC_DIRECTORY = path.join(ROOT, 'src/data/posts/tistory');
const NAVER_PUBLIC_DIRECTORY = path.join(ROOT, 'src/data/posts/naver');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const prettyJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fail(code) { throw new SequenceError(code); }

async function parseJsonInput() {
  const index = process.argv.indexOf('--input');
  if (index < 0 || !process.argv[index + 1]) fail('SEQ_E_COMMAND_INPUT');
  try { return JSON.parse(await readSecureFile(path.resolve(ROOT, process.argv[index + 1]))); }
  catch { fail('SEQ_E_COMMAND_INPUT'); }
}

function exactInput(input, requiredKeys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== requiredKeys.size
    || Object.keys(input).some((key) => !requiredKeys.has(key))) fail('SEQ_E_COMMAND_INPUT');
  return input;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) fail('SEQ_E_COMMAND_INPUT');
  return process.argv[index + 1];
}

async function publicFrontmatterRows(directory, expectedSource) {
  const directoryBefore = await assertSecureDirectory(directory);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { fail('SEQ_E_PUBLIC_BOOTSTRAP_SOURCE'); }
  if (entries.some((entry) => !entry.isFile() || !entry.name.endsWith('.md'))) fail('SEQ_E_PUBLIC_BOOTSTRAP_SOURCE');
  const rows = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    const raw = await readSecureFile(file);
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) fail('SEQ_E_PUBLIC_BOOTSTRAP_SOURCE');
    let data;
    try { data = parseYaml(match[1]); }
    catch { fail('SEQ_E_PUBLIC_BOOTSTRAP_SOURCE'); }
    if (typeof data.source !== 'string' || typeof data.sourceId !== 'string'
      || typeof data.publishedAt !== 'string' || data.source !== expectedSource
      || data.visibility !== 'public') fail('SEQ_E_PUBLIC_BOOTSTRAP_SOURCE');
    const expectedLegacy = expectedSource === 'tistory' ? `/${data.sourceId}` : `/naver/${data.sourceId}`;
    if (data.canonicalPath !== expectedLegacy) fail('SEQ_E_PUBLIC_BOOTSTRAP_SOURCE');
    rows.push({ source: data.source, sourceId: data.sourceId, visibility: 'public', publishedAt: data.publishedAt });
  }
  const directoryAfter = await assertSecureDirectory(directory);
  if (directoryBefore.dev !== directoryAfter.dev || directoryBefore.ino !== directoryAfter.ino) {
    fail('SEQ_E_PUBLIC_BOOTSTRAP_SOURCE');
  }
  return rows;
}

async function bootstrapInputFromSidecar(sidecar) {
  validatePrivateBootstrapSidecar(sidecar);
  const privateIdentities = new Set(sidecar.entries.map((entry) => `${entry.source}:${entry.sourceId}`));
  const [tistoryRows, allNaverRows] = await Promise.all([
    publicFrontmatterRows(TISTORY_PUBLIC_DIRECTORY, 'tistory'),
    publicFrontmatterRows(NAVER_PUBLIC_DIRECTORY, 'naver'),
  ]);
  const naverRows = allNaverRows.filter((row) => !privateIdentities.has(`naver:${row.sourceId}`));
  const privateRows = sidecar.entries.map(({ source, sourceId, visibility, publishedAt }) => ({
    source, sourceId, visibility, publishedAt,
  }));
  if (tistoryRows.length !== 164 || naverRows.length !== 185 || privateRows.length !== BOOTSTRAP_PRIVATE_COUNT) {
    fail('SEQ_E_BOOTSTRAP_SOURCE_COUNTS');
  }
  const ledger = createInitialLedger([...tistoryRows, ...naverRows, ...privateRows]);
  if (ledger.entries.length !== BOOTSTRAP_ENTRY_COUNT
    || buildPublicProjection(ledger).length !== BOOTSTRAP_PUBLIC_COUNT) fail('SEQ_E_BOOTSTRAP_SOURCE_COUNTS');
  return ledger;
}

async function readProjection({ allowMissing = false } = {}) {
  const projection = await readJsonSecure(PUBLIC_PROJECTION_FILE, { mode: 0o644, allowMissing });
  if (projection === null) return null;
  return validatePublicProjection(projection);
}

function genesisLedgerFromCurrent(currentLedger, sidecar) {
  const entries = assertBootstrapEvidence(currentLedger, sidecar);
  return {
    schemaVersion: currentLedger.schemaVersion,
    allocationPolicy: currentLedger.allocationPolicy,
    bootstrap: structuredClone(currentLedger.bootstrap),
    generation: 0,
    nextSequence: BOOTSTRAP_ENTRY_COUNT + 1,
    entries,
  };
}

async function ensureNoPendingState() {
  if (await readPendingInitialization(INITIALIZATION_FILE)) fail('SEQ_E_INITIALIZATION_PENDING');
  if (await readPendingTransaction(TRANSACTION_FILE)) fail('SEQ_E_TRANSACTION_PENDING');
}

async function assertAuthoritativeDirectoryModes({ journalRequired = true } = {}) {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  if (journalRequired) await assertSecureDirectory(JOURNAL_DIRECTORY, { mode: 0o700 });
}

async function loadAuthoritativeState({ lockOwned = false, lockTransferId = null } = {}) {
  await assertAuthoritativeDirectoryModes();
  if (!lockOwned && await readSecureFile(LOCK_FILE, { mode: 0o600, allowMissing: true }) !== null) fail('SEQ_E_LOCKED');
  const transfer = await readLockTransfer(LOCK_TRANSFER_FILE, { allowMissing: true });
  if (transfer && transfer.transferId !== lockTransferId) fail('SEQ_E_LOCK_TRANSFER_PENDING');
  if (!transfer && lockTransferId !== null) fail('SEQ_E_LOCK_TRANSFER_TOKEN');
  await ensureNoPendingState();
  const [ledger, projection, sidecar, events, seal] = await Promise.all([
    readPrivateLedger(LEDGER_FILE),
    readProjection(),
    readJsonSecure(PRIVATE_METADATA_FILE, { mode: 0o600 }),
    readJournal(JOURNAL_DIRECTORY),
    readJsonSecure(SEAL_FILE, { mode: 0o600 }),
  ]);
  validatePrivateBootstrapSidecar(sidecar);
  validatePublicProjection(projection, ledger);
  const genesisLedger = genesisLedgerFromCurrent(ledger, sidecar);
  const replayed = replayJournal(genesisLedger, events);
  validateBootstrapSeal(seal, sidecar, genesisLedger, events[0]);
  if (stableJson(replayed.ledger) !== stableJson(ledger)
    || stableJson(replayed.projection) !== stableJson(projection)
    || replayed.head.generationTo !== ledger.generation) fail('SEQ_E_JOURNAL_STATE');
  return { ledger, projection, sidecar, events, seal, genesisLedger };
}

async function validateProjectedContent(projection, { requiredIdentity = null } = {}) {
  const index = await indexPreparedPublicContent(ROOT);
  if (requiredIdentity) assertPreparedPublicIdentity(index, requiredIdentity);
  const rows = [...index.values()].flat();
  const selected = selectProjectionBackedContent(rows, projection, { development: false });
  const addresses = new Map(projection.map((entry) => [`${entry.source}:${entry.sourceId}`, entry]));
  for (const row of selected) {
    if (row.source === 'native'
      && row.data.canonicalPath !== addresses.get(`native:${row.sourceId}`)?.canonicalPath) {
      fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER');
    }
  }
  return index;
}

async function adoptExisting() {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  return withSequenceLock(PRIVATE_DIRECTORY, async () => {
    if (await readSecureFile(SEAL_FILE, { mode: 0o600, allowMissing: true }) !== null
      || await readSecureFile(PRIVATE_METADATA_FILE, { mode: 0o600, allowMissing: true }) !== null
      || (await readJournal(JOURNAL_DIRECTORY, { allowMissing: true })).length > 0
      || await readPendingInitialization(INITIALIZATION_FILE)
      || await readSecureFile(TRANSACTION_FILE, { mode: 0o600, allowMissing: true }) !== null) {
      fail('SEQ_E_ADOPTION_ALREADY_INITIALIZED');
    }
    const legacyRaw = await readSecureFile(LEDGER_FILE, { mode: 0o600 });
    try { JSON.parse(legacyRaw); }
    catch { fail('SEQ_E_JSON'); }
    const ledger = await readPrivateLedger(LEDGER_FILE, { allowLegacyGeneration: true });
    if (Object.prototype.hasOwnProperty.call(ledger, 'generation')) fail('SEQ_E_ADOPTION_ALREADY_INITIALIZED');
    ledger.generation = 0;
    const projection = await readProjection();
    validatePublicProjection(projection, ledger);
    await validateProjectedContent(projection);
    const sidecar = privateBootstrapSidecarFromGenesisLedger(ledger);
    const genesisEvent = createJournalEvent({ afterLedger: ledger, afterProjection: projection, operation: { type: 'genesis' } });
    const seal = createBootstrapSeal(sidecar, ledger, genesisEvent);
    const projectionRaw = await readSecureFile(PUBLIC_PROJECTION_FILE, { mode: 0o644 });
    const marker = createInitializationMarker({
      operation: 'adopt-existing',
      beforeLedgerRawSha256: sha256(legacyRaw),
      beforeProjectionRawSha256: sha256(projectionRaw),
      targetLedger: ledger,
      targetProjection: projection,
      targetSidecar: sidecar,
      targetGenesisEvent: genesisEvent,
      targetSeal: seal,
    });
    await writeNoReplaceFile(INITIALIZATION_FILE, prettyJson(marker), { mode: 0o600 });
    await reconcileInitialization({
      directory: PRIVATE_DIRECTORY,
      markerFile: INITIALIZATION_FILE,
      ledgerFile: LEDGER_FILE,
      projectionFile: PUBLIC_PROJECTION_FILE,
      sidecarFile: PRIVATE_METADATA_FILE,
      journalDirectory: JOURNAL_DIRECTORY,
      sealFile: SEAL_FILE,
    });
    return { adopted: true, generation: 0, entries: ledger.entries.length, publicEntries: projection.length };
  });
}

async function bootstrap() {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  return withSequenceLock(PRIVATE_DIRECTORY, async () => {
    const bootstrapState = await Promise.all([
      readSecureFile(SEAL_FILE, { mode: 0o600, allowMissing: true }),
      readSecureFile(LEDGER_FILE, { mode: 0o600, allowMissing: true }),
      readJournal(JOURNAL_DIRECTORY, { allowMissing: true }),
      readSecureFile(TRANSACTION_FILE, { mode: 0o600, allowMissing: true }),
      readPendingInitialization(INITIALIZATION_FILE),
    ]);
    assertBootstrapMayInitialize({
      sealPresent: bootstrapState[0] !== null,
      ledgerPresent: bootstrapState[1] !== null,
      journalEventCount: bootstrapState[2].length,
      transactionPresent: bootstrapState[3] !== null,
      initializationPresent: bootstrapState[4] !== null,
    });
    const sidecar = await readJsonSecure(PRIVATE_METADATA_FILE, { mode: 0o600 });
    validatePrivateBootstrapSidecar(sidecar);
    const ledger = await bootstrapInputFromSidecar(sidecar);
    const projection = buildPublicProjection(ledger);
    const existingProjection = await readProjection({ allowMissing: true });
    if (existingProjection && stableJson(existingProjection) !== stableJson(projection)) fail('SEQ_E_PROJECTION_LEDGER_MISMATCH');
    await validateProjectedContent(projection);
    const genesisEvent = createJournalEvent({ afterLedger: ledger, afterProjection: projection, operation: { type: 'genesis' } });
    const seal = createBootstrapSeal(sidecar, ledger, genesisEvent);
    const projectionRaw = existingProjection
      ? await readSecureFile(PUBLIC_PROJECTION_FILE, { mode: 0o644 })
      : null;
    const marker = createInitializationMarker({
      operation: 'bootstrap',
      beforeLedgerRawSha256: null,
      beforeProjectionRawSha256: projectionRaw === null ? null : sha256(projectionRaw),
      targetLedger: ledger,
      targetProjection: projection,
      targetSidecar: sidecar,
      targetGenesisEvent: genesisEvent,
      targetSeal: seal,
    });
    await writeNoReplaceFile(INITIALIZATION_FILE, prettyJson(marker), { mode: 0o600 });
    await reconcileInitialization({
      directory: PRIVATE_DIRECTORY,
      markerFile: INITIALIZATION_FILE,
      ledgerFile: LEDGER_FILE,
      projectionFile: PUBLIC_PROJECTION_FILE,
      sidecarFile: PRIVATE_METADATA_FILE,
      journalDirectory: JOURNAL_DIRECTORY,
      sealFile: SEAL_FILE,
    });
    return { entries: ledger.entries.length, publicEntries: projection.length, nextSequence: ledger.nextSequence };
  });
}

async function verify() {
  const state = await loadAuthoritativeState();
  await validateProjectedContent(state.projection);
  return {
    validationScope: 'authoritative',
    generation: state.ledger.generation,
    entries: state.ledger.entries.length,
    publicEntries: state.projection.length,
    privateOrReservedEntries: state.ledger.entries.length - state.projection.length,
    nextSequence: state.ledger.nextSequence,
    allocationSha256: state.ledger.bootstrap.allocationSha256,
    genesisPublicProjectionSha256: state.ledger.bootstrap.publicProjectionSha256,
    currentPublicProjectionSha256: publicProjectionDigest(state.projection),
    journalEvents: state.events.length,
    pendingTransaction: false,
  };
}

async function lockStatus() {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  const transfer = await readLockTransfer(LOCK_TRANSFER_FILE, { allowMissing: true });
  const status = await inspectSequenceLock(LOCK_FILE, { staleAfterMs: DEFAULT_STALE_LOCK_AGE_MS });
  if (!status.present) return { present: false, transfer };
  return {
    present: true,
    token: status.token,
    pid: status.pid,
    createdAt: status.createdAt,
    ageMs: status.ageMs,
    ownerAlive: status.ownerAlive,
    stale: status.stale,
    transfer,
  };
}

async function unlockStale() {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  return removeStaleSequenceLock(LOCK_FILE, optionValue('--token'), {
    staleAfterMs: DEFAULT_STALE_LOCK_AGE_MS,
  });
}

function operationFor(command, input, result) {
  if (command === 'allocate') return {
    type: 'allocate',
    source: input.source,
    sourceId: input.sourceId,
    visibility: input.visibility,
    publishedAt: input.publishedAt,
    allocatedSequence: result.allocatedSequence,
  };
  if (command === 'set-visibility') return {
    type: 'set-visibility',
    source: input.source,
    sourceId: input.sourceId,
    fromVisibility: result.previousVisibility,
    toVisibility: input.visibility,
    globalSequence: result.globalSequence,
  };
  return {
    type: 'tombstone',
    source: input.source,
    sourceId: input.sourceId,
    fromStatus: result.previousStatus,
    globalSequence: result.globalSequence,
  };
}

async function update(command, input, operation) {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  return withSequenceLock(PRIVATE_DIRECTORY, async () => {
    const state = await loadAuthoritativeState({ lockOwned: true });
    if (!Number.isSafeInteger(input.expectedGeneration)) fail('SEQ_E_GENERATION_REQUIRED');
    if (input.expectedGeneration !== state.ledger.generation) fail('SEQ_E_GENERATION_CONFLICT');
    const result = operation(state.ledger);
    const nextProjection = buildPublicProjection(result.ledger);
    const currentIdentities = new Set(state.projection.map((entry) => `${entry.source}:${entry.sourceId}`));
    const added = nextProjection.find((entry) => !currentIdentities.has(`${entry.source}:${entry.sourceId}`));
    await validateProjectedContent(nextProjection, { requiredIdentity: added ?? null });
    const committed = await commitSequenceTransaction({
      directory: PRIVATE_DIRECTORY,
      ledgerFile: LEDGER_FILE,
      projectionFile: PUBLIC_PROJECTION_FILE,
      journalDirectory: JOURNAL_DIRECTORY,
      transactionFile: TRANSACTION_FILE,
      beforeLedger: state.ledger,
      beforeProjection: state.projection,
      afterLedger: result.ledger,
      operation: operationFor(command, input, result),
      previousEvent: state.events.at(-1),
    });
    return {
      globalSequence: result.allocatedSequence ?? result.globalSequence,
      generation: committed.ledger.generation,
      entries: committed.ledger.entries.length,
      publicEntries: committed.projection.length,
      nextSequence: committed.ledger.nextSequence,
    };
  }, { observedGeneration: input.expectedGeneration });
}

async function finalizeTransferredRecovery(transfer) {
  if (!transfer) return null;
  const lock = await inspectSequenceLock(LOCK_FILE, { staleAfterMs: 0 });
  if (lock.present) fail('SEQ_E_LOCK_TRANSFER_PENDING');
  if (await readPendingInitialization(INITIALIZATION_FILE)) fail('SEQ_E_INITIALIZATION_PENDING');
  if (await readPendingTransaction(TRANSACTION_FILE)) fail('SEQ_E_TRANSACTION_PENDING');
  const state = await loadAuthoritativeState({ lockTransferId: transfer.transferId });
  await validateProjectedContent(state.projection);
  await clearLockTransfer(LOCK_TRANSFER_FILE, transfer.transferId, {
    receiptSha256: transfer.receiptSha256,
  });
  return state;
}

async function recover(explicitTransferId = undefined, {
  lockHooks = {},
  afterRecoveryLockRelease = async () => {},
} = {}) {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  const transfer = await readLockTransfer(LOCK_TRANSFER_FILE, { allowMissing: true });
  const transferId = transfer
    ? (explicitTransferId === undefined ? optionValue('--transfer') : explicitTransferId)
    : null;
  if (transfer && transfer.transferId !== transferId) fail('SEQ_E_LOCK_TRANSFER_TOKEN');
  const result = await withSequenceLock(PRIVATE_DIRECTORY, async () => {
    if (await readPendingInitialization(INITIALIZATION_FILE)) fail('SEQ_E_INITIALIZATION_PENDING');
    await assertAuthoritativeDirectoryModes();
    const marker = await readPendingTransaction(TRANSACTION_FILE);
    if (marker) {
      await validateProjectedContent(marker.targetProjection);
      const recovered = await reconcilePendingTransaction({
        directory: PRIVATE_DIRECTORY,
        ledgerFile: LEDGER_FILE,
        projectionFile: PUBLIC_PROJECTION_FILE,
        journalDirectory: JOURNAL_DIRECTORY,
        transactionFile: TRANSACTION_FILE,
      });
      return { recovered: true, generation: recovered.ledger.generation, publicEntries: recovered.projection.length };
    }
    const [sidecar, seal, events] = await Promise.all([
      readJsonSecure(PRIVATE_METADATA_FILE, { mode: 0o600 }),
      readJsonSecure(SEAL_FILE, { mode: 0o600 }),
      readJournal(JOURNAL_DIRECTORY),
    ]);
    validatePrivateBootstrapSidecar(sidecar);
    const bootstrapLedger = await bootstrapInputFromSidecar(sidecar);
    const replayed = replayJournal(bootstrapLedger, events);
    validateBootstrapSeal(seal, sidecar, bootstrapLedger, events[0]);
    await validateProjectedContent(replayed.projection);
    const currentLedger = await readPrivateLedger(LEDGER_FILE, { allowMissing: true });
    if (currentLedger && objectDigest(currentLedger) !== objectDigest(replayed.ledger)) fail('SEQ_E_STATE_HASH_CONFLICT');
    if (!currentLedger) await writePrivateLedger(LEDGER_FILE, replayed.ledger, { expectedRawDigest: null, allowMissing: true });
    const currentProjection = await readProjection({ allowMissing: true });
    if (!currentProjection) {
      await writePublicProjection(PUBLIC_PROJECTION_FILE, replayed.projection, { expectedRawDigest: null, allowMissing: true });
    } else if (objectDigest(currentProjection) !== objectDigest(replayed.projection)) {
      const knownHistorical = new Set(events.map((event) => event.afterProjectionSha256));
      if (!knownHistorical.has(objectDigest(currentProjection))) fail('SEQ_E_STATE_HASH_CONFLICT');
      const raw = await readSecureFile(PUBLIC_PROJECTION_FILE, { mode: 0o644 });
      await writePublicProjection(PUBLIC_PROJECTION_FILE, replayed.projection, { expectedRawDigest: sha256(raw) });
    }
    return { recovered: !currentLedger || !currentProjection, generation: replayed.ledger.generation, publicEntries: replayed.projection.length };
  }, { lockTransferId: transferId, ...lockHooks });
  if (transfer) await afterRecoveryLockRelease({ transferId: transfer.transferId });
  if (transfer) await finalizeTransferredRecovery(transfer);
  return result;
}

async function recoverInitialization(explicitTransferId = undefined, {
  lockHooks = {},
  afterRecoveryLockRelease = async () => {},
} = {}) {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  const transfer = await readLockTransfer(LOCK_TRANSFER_FILE, { allowMissing: true });
  const transferId = transfer
    ? (explicitTransferId === undefined ? optionValue('--transfer') : explicitTransferId)
    : null;
  if (transfer && transfer.transferId !== transferId) fail('SEQ_E_LOCK_TRANSFER_TOKEN');
  const result = await withSequenceLock(PRIVATE_DIRECTORY, async () => {
    const marker = await readPendingInitialization(INITIALIZATION_FILE, { allowMissing: false });
    await validateProjectedContent(marker.targetProjection);
    const recovered = await reconcileInitialization({
      directory: PRIVATE_DIRECTORY,
      markerFile: INITIALIZATION_FILE,
      ledgerFile: LEDGER_FILE,
      projectionFile: PUBLIC_PROJECTION_FILE,
      sidecarFile: PRIVATE_METADATA_FILE,
      journalDirectory: JOURNAL_DIRECTORY,
      sealFile: SEAL_FILE,
    });
    return {
      recovered: true,
      operation: recovered.operation,
      generation: recovered.ledger.generation,
      publicEntries: recovered.projection.length,
    };
  }, { lockTransferId: transferId, ...lockHooks });
  if (transfer) await afterRecoveryLockRelease({ transferId: transfer.transferId });
  if (transfer) await finalizeTransferredRecovery(transfer);
  return result;
}

async function recoverTransfer({
  lockHooks = {},
  staleAfterMs = DEFAULT_STALE_LOCK_AGE_MS,
  afterRecoveryLockRelease = async () => {},
} = {}) {
  await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
  await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
  const removed = await removeStaleSequenceLock(LOCK_FILE, optionValue('--token'), {
    staleAfterMs,
  });
  const initialization = await readPendingInitialization(INITIALIZATION_FILE);
  const result = initialization
    ? await recoverInitialization(removed.transferId, { lockHooks, afterRecoveryLockRelease })
    : await recover(removed.transferId, { lockHooks, afterRecoveryLockRelease });
  return { ...result, staleLockTransferRecovered: true };
}

function cliRecoveryTestOptions() {
  const stage = process.env.DWNC_SEQUENCE_TEST_RECOVERY_EXIT;
  if (!stage) return {};
  if (process.env.NODE_ENV !== 'test'
    || !ROOT.startsWith('/private/tmp/dwnc-sequence-cli-test-')
    || !['after-acquire', 'after-operation', 'after-lock-release', 'resume'].includes(stage)) {
    fail('SEQ_E_COMMAND_INPUT');
  }
  return {
    staleAfterMs: 0,
    lockHooks: {
      afterAcquire: async () => {
        if (stage === 'after-acquire') process.exit(74);
      },
      afterOperationBeforeRelease: async () => {
        if (stage === 'after-operation') process.exit(75);
      },
    },
    afterRecoveryLockRelease: async () => {
      if (stage === 'after-lock-release') process.exit(76);
    },
  };
}

async function main() {
  const command = process.argv[2] ?? 'verify';
  if (command === 'adopt-existing') return adoptExisting();
  if (command === 'bootstrap') return bootstrap();
  if (command === 'verify') return verify();
  if (command === 'lock-status') return lockStatus();
  if (command === 'unlock-stale') return unlockStale();
  if (command === 'recover') return recover();
  if (command === 'recover-init') return recoverInitialization();
  if (command === 'recover-transfer') return recoverTransfer(cliRecoveryTestOptions());
  if (command === 'allocate') {
    const input = exactInput(await parseJsonInput(), new Set(['source', 'sourceId', 'visibility', 'publishedAt', 'expectedGeneration']));
    return update(command, input, (ledger) => allocateSequence(ledger, input));
  }
  if (command === 'set-visibility') {
    const input = exactInput(await parseJsonInput(), new Set(['source', 'sourceId', 'visibility', 'expectedGeneration']));
    return update(command, input, (ledger) => setSequenceVisibility(ledger, input));
  }
  if (command === 'tombstone') {
    const input = exactInput(await parseJsonInput(), new Set(['source', 'sourceId', 'expectedGeneration']));
    return update(command, input, (ledger) => tombstoneSequence(ledger, input));
  }
  fail('SEQ_E_COMMAND_UNKNOWN');
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  const code = error instanceof SequenceError ? error.code : 'SEQ_E_COMMAND_FAILED';
  console.error(JSON.stringify({ error: code }));
  process.exit(1);
}
