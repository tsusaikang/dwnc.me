import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const GLOBAL_SEQUENCE_SCHEMA_VERSION = 1;
export const BOOTSTRAP_ENTRY_COUNT = 596;
export const BOOTSTRAP_PUBLIC_COUNT = 349;
export const BOOTSTRAP_PRIVATE_COUNT = 247;
export const BOOTSTRAP_ALLOCATION_SHA256 = '2b71c38d4032f306419117ffbf120e888883e8da4e3e2d51f4392b350e026b66';
export const BOOTSTRAP_PUBLIC_PROJECTION_SHA256 = '94c9769ea5cd3f61560943afc7032003dd2ff375b8d5c7841d947bdaf4977d01';
export const BOOTSTRAP_METADATA_SEAL_SHA256 = 'de93d0619a7b0def89c0e51f0fe5cbe2997e93f13f49a7ba271e2cf2d81ac552';

export const PRIVATE_METADATA_FILENAME = 'bootstrap-private-metadata-v1.json';
export const BOOTSTRAP_SEAL_FILENAME = 'global-sequence-v1.seal.json';
export const JOURNAL_DIRECTORYNAME = 'events-v1';
export const TRANSACTION_FILENAME = '.global-sequence-v1.transaction.json';
export const LOCK_FILENAME = '.global-sequence-v1.lock';
export const LOCK_TRANSFER_FILENAME = '.global-sequence-v1.lock-transfer.json';
export const INITIALIZATION_FILENAME = '.global-sequence-v1.initialization.json';
export const DEFAULT_STALE_LOCK_AGE_MS = 5 * 60 * 1000;

const SOURCES = new Set(['tistory', 'naver', 'native']);
const VISIBILITIES = new Set(['public', 'private']);
const STATUSES = new Set(['active', 'tombstone']);
const LEDGER_KEYS = new Set(['schemaVersion', 'allocationPolicy', 'bootstrap', 'generation', 'nextSequence', 'entries']);
const BOOTSTRAP_KEYS = new Set(['entries', 'publicEntries', 'privateEntries', 'allocationSha256', 'publicProjectionSha256']);
const ENTRY_KEYS = new Set(['globalSequence', 'source', 'sourceId', 'visibility', 'publishedAt', 'status']);
const PROJECTION_KEYS = new Set(['globalSequence', 'source', 'sourceId', 'canonicalPath', 'legacyPaths']);
const PRIVATE_SIDECAR_KEYS = new Set(['schemaVersion', 'kind', 'entries']);
const PRIVATE_SIDECAR_ENTRY_KEYS = new Set(['source', 'sourceId', 'visibility', 'publishedAt', 'canonicalPath']);
const SEAL_KEYS = new Set([
  'schemaVersion', 'kind', 'allocationSha256', 'bootstrapMetadataSha256',
  'genesisPublicProjectionSha256', 'privateMetadataSha256', 'genesisLedgerSha256',
  'genesisEventSha256',
]);
const JOURNAL_EVENT_KEYS = new Set([
  'schemaVersion', 'kind', 'generationFrom', 'generationTo', 'previousEventSha256',
  'operation', 'beforeLedgerSha256', 'afterLedgerSha256', 'beforeProjectionSha256',
  'afterProjectionSha256', 'eventSha256',
]);
const TRANSACTION_KEYS = new Set([
  'schemaVersion', 'kind', 'transactionId', 'commitOrder', 'baseGeneration',
  'targetGeneration', 'beforeLedgerSha256', 'afterLedgerSha256',
  'beforeProjectionSha256', 'afterProjectionSha256', 'targetLedger',
  'targetProjection', 'journalEvent',
]);
const LOCK_KEYS = new Set(['schemaVersion', 'token', 'pid', 'createdAt', 'observedGeneration']);
const TRANSFER_RECOVERY_LOCK_KEYS = new Set([
  'schemaVersion', 'kind', 'token', 'pid', 'createdAt', 'observedGeneration',
  'transferId', 'receiptSha256',
]);
const LOCK_TRANSFER_KEYS = new Set([
  'schemaVersion', 'kind', 'transferId', 'lockToken', 'lockDevice', 'lockInode',
  'lockObservedGeneration', 'lockRawSha256', 'ownerPid', 'ownerCreatedAt',
  'observedAt', 'staleAfterMs', 'recoveryStaleAfterMs', 'ownerAlive', 'reason',
  'recoveryToken', 'receiptSha256',
]);
const INITIALIZATION_KEYS = new Set([
  'schemaVersion', 'kind', 'operation', 'initializationId', 'beforeLedgerRawSha256',
  'beforeProjectionRawSha256', 'targetLedger', 'targetProjection', 'targetSidecar',
  'targetGenesisEvent', 'targetSeal',
]);

export const FIXED_PUBLIC_ROUTES = Object.freeze([
  '/', '/404', '/about', '/archive', '/category', '/rss.xml', '/search-index.json', '/tags',
]);

export class SequenceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SequenceError';
    this.code = code;
  }
}

const fail = (code) => { throw new SequenceError(code); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identity = (entry) => `${entry.source}:${entry.sourceId}`;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export const stableJson = (value) => JSON.stringify(stableValue(value));
export const objectDigest = (value) => sha256(stableJson(value));

export function compareAsciiBytes(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function validateExactString(input, key, code) {
  if (!input || typeof input !== 'object' || !own(input, key) || typeof input[key] !== 'string') fail(code);
  const value = input[key];
  if (!value || value !== value.trim() || value !== value.normalize('NFC')) fail(code);
  return value;
}

export function validateSourceIdentityInput(input) {
  const source = validateExactString(input, 'source', 'SEQ_E_IDENTITY_SOURCE');
  const sourceId = validateExactString(input, 'sourceId', 'SEQ_E_IDENTITY_SOURCE_ID');
  if (!SOURCES.has(source)) fail('SEQ_E_IDENTITY_SOURCE');
  if (source === 'tistory' || source === 'naver') {
    if (!/^[1-9]\d*$/.test(sourceId)) fail('SEQ_E_IDENTITY_SOURCE_ID');
  } else if (sourceId.length > 160
    || /[\\/%\u0000-\u001f\u007f]/u.test(sourceId)
    || sourceId === '.'
    || sourceId === '..') {
    fail('SEQ_E_IDENTITY_SOURCE_ID');
  }
  return { source, sourceId };
}

function validatePublishedAt(input) {
  const publishedAt = validateExactString(input, 'publishedAt', 'SEQ_E_PUBLISHED_AT');
  if (!Number.isFinite(Date.parse(publishedAt))) fail('SEQ_E_PUBLISHED_AT');
  return publishedAt;
}

function validateVisibility(input) {
  const visibility = validateExactString(input, 'visibility', 'SEQ_E_VISIBILITY');
  if (!VISIBILITIES.has(visibility)) fail('SEQ_E_VISIBILITY');
  return visibility;
}

export function allocationDigest(entries, count = entries.length) {
  return sha256(entries.slice(0, count).map((entry) => (
    `${entry.globalSequence}\0${identity(entry)}\0${entry.publishedAt}`
  )).join('\n'));
}

export function bootstrapMetadataDigest(entries) {
  return sha256(entries.slice(0, BOOTSTRAP_ENTRY_COUNT).map((entry) => (
    `${entry.globalSequence}\0${identity(entry)}\0${entry.visibility}\0${entry.publishedAt}\0${entry.status}`
  )).join('\n'));
}

export function publicProjectionDigest(entries) {
  return sha256(entries.map((entry) => (
    `${entry.globalSequence}\0${identity(entry)}\0${entry.canonicalPath}`
  )).join('\n'));
}

function legacyPathsFor(entry) {
  validateSourceIdentityInput(entry);
  if (entry.source === 'tistory') return [`/${entry.sourceId}`];
  if (entry.source === 'naver') return [`/naver/${entry.sourceId}`];
  return [];
}

function validateRouteNamespace(projection) {
  const canonicalOwners = new Map();
  const aliasOwners = new Map();
  const fixedRoutes = new Set(FIXED_PUBLIC_ROUTES);
  for (const entry of projection) {
    if (canonicalOwners.has(entry.canonicalPath)
      || aliasOwners.has(entry.canonicalPath)
      || fixedRoutes.has(entry.canonicalPath)) fail('SEQ_E_ROUTE_COLLISION');
    canonicalOwners.set(entry.canonicalPath, identity(entry));
  }
  for (const entry of projection) {
    for (const alias of entry.legacyPaths) {
      if (fixedRoutes.has(alias) || canonicalOwners.has(alias) || aliasOwners.has(alias)) fail('SEQ_E_ROUTE_COLLISION');
      aliasOwners.set(alias, identity(entry));
    }
  }
}

export function buildPublicProjection(ledger) {
  return ledger.entries
    .filter((entry) => entry.visibility === 'public' && entry.status === 'active')
    .map((entry) => ({
      globalSequence: entry.globalSequence,
      source: entry.source,
      sourceId: entry.sourceId,
      canonicalPath: `/posts/${entry.globalSequence}`,
      legacyPaths: legacyPathsFor(entry),
    }));
}

export function createInitialLedger(input) {
  if (!Array.isArray(input)) fail('SEQ_E_BOOTSTRAP_INPUT');
  const rows = input.map((row) => {
    const { source, sourceId } = validateSourceIdentityInput(row);
    return {
      source,
      sourceId,
      visibility: validateVisibility(row),
      publishedAt: validatePublishedAt(row),
      timestamp: Date.parse(row.publishedAt),
    };
  });
  const identities = new Set(rows.map(identity));
  if (identities.size !== rows.length) fail('SEQ_E_IDENTITY_COLLISION');
  rows.sort((left, right) => left.timestamp - right.timestamp
    || compareAsciiBytes(identity(left), identity(right)));
  const entries = rows.map(({ timestamp: _timestamp, ...row }, index) => ({
    globalSequence: index + 1,
    ...row,
    status: 'active',
  }));
  const projection = buildPublicProjection({ entries });
  const ledger = {
    schemaVersion: GLOBAL_SEQUENCE_SCHEMA_VERSION,
    allocationPolicy: 'publishedAt-utc-asc_then_source-qualified-identity-ascii-bytewise-asc_bootstrap-only_append-only',
    bootstrap: {
      entries: BOOTSTRAP_ENTRY_COUNT,
      publicEntries: BOOTSTRAP_PUBLIC_COUNT,
      privateEntries: BOOTSTRAP_PRIVATE_COUNT,
      allocationSha256: allocationDigest(entries),
      publicProjectionSha256: publicProjectionDigest(projection),
    },
    generation: 0,
    nextSequence: entries.length + 1,
    entries,
  };
  validateLedger(ledger, { requireBootstrapDigests: entries.length === BOOTSTRAP_ENTRY_COUNT });
  return ledger;
}

export function assertBootstrapMayInitialize({
  sealPresent,
  ledgerPresent,
  journalEventCount,
  transactionPresent,
  initializationPresent = false,
}) {
  if (sealPresent) fail('SEQ_E_BOOTSTRAP_ALREADY_SEALED');
  if (ledgerPresent
    || !Number.isSafeInteger(journalEventCount)
    || journalEventCount < 0
    || journalEventCount > 0
    || transactionPresent
    || initializationPresent) fail('SEQ_E_BOOTSTRAP_HISTORY_CONFLICT');
  return true;
}

export function validateLedger(ledger, { requireBootstrapDigests = true, allowLegacyGeneration = false } = {}) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)
    || ledger.schemaVersion !== GLOBAL_SEQUENCE_SCHEMA_VERSION
    || !Array.isArray(ledger.entries)) fail('SEQ_E_LEDGER_SCHEMA');
  const actualKeys = Object.keys(ledger);
  if (actualKeys.some((key) => !LEDGER_KEYS.has(key))
    || (!allowLegacyGeneration && !own(ledger, 'generation'))
    || !ledger.bootstrap
    || typeof ledger.bootstrap !== 'object'
    || Array.isArray(ledger.bootstrap)
    || Object.keys(ledger.bootstrap).some((key) => !BOOTSTRAP_KEYS.has(key))) fail('SEQ_E_LEDGER_SCHEMA');
  if (!allowLegacyGeneration && (!Number.isSafeInteger(ledger.generation) || ledger.generation < 0)) {
    fail('SEQ_E_LEDGER_GENERATION');
  }
  const seenSequences = new Set();
  const seenIdentities = new Set();
  for (let index = 0; index < ledger.entries.length; index += 1) {
    const entry = ledger.entries[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !ENTRY_KEYS.has(key))
      || Object.keys(entry).length !== ENTRY_KEYS.size) fail('SEQ_E_LEDGER_ENTRY');
    validateSourceIdentityInput(entry);
    if (index >= BOOTSTRAP_ENTRY_COUNT && entry.source !== 'native') fail('SEQ_E_ALLOCATION_SOURCE_FROZEN');
    validatePublishedAt(entry);
    validateVisibility(entry);
    if (!Number.isSafeInteger(entry.globalSequence)
      || entry.globalSequence !== index + 1
      || !STATUSES.has(entry.status)) fail('SEQ_E_LEDGER_ENTRY');
    if (seenSequences.has(entry.globalSequence) || seenIdentities.has(identity(entry))) fail('SEQ_E_LEDGER_COLLISION');
    seenSequences.add(entry.globalSequence);
    seenIdentities.add(identity(entry));
  }
  if (ledger.nextSequence !== ledger.entries.length + 1) fail('SEQ_E_NEXT_SEQUENCE');
  if (requireBootstrapDigests) {
    if (ledger.entries.length < BOOTSTRAP_ENTRY_COUNT
      || ledger.bootstrap.entries !== BOOTSTRAP_ENTRY_COUNT
      || ledger.bootstrap.publicEntries !== BOOTSTRAP_PUBLIC_COUNT
      || ledger.bootstrap.privateEntries !== BOOTSTRAP_PRIVATE_COUNT
      || ledger.bootstrap.allocationSha256 !== BOOTSTRAP_ALLOCATION_SHA256
      || ledger.bootstrap.publicProjectionSha256 !== BOOTSTRAP_PUBLIC_PROJECTION_SHA256
      || allocationDigest(ledger.entries, BOOTSTRAP_ENTRY_COUNT) !== BOOTSTRAP_ALLOCATION_SHA256) {
      fail('SEQ_E_BOOTSTRAP_ALLOCATION');
    }
  }
  validatePublicProjection(buildPublicProjection(ledger));
  return ledger;
}

export function validatePublicProjection(projection, ledger = null) {
  if (!Array.isArray(projection)) fail('SEQ_E_PROJECTION_SCHEMA');
  const sequences = new Set();
  const identities = new Set();
  for (const entry of projection) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !PROJECTION_KEYS.has(key))
      || Object.keys(entry).length !== PROJECTION_KEYS.size) fail('SEQ_E_PROJECTION_SCHEMA');
    validateSourceIdentityInput(entry);
    if (!Number.isSafeInteger(entry.globalSequence)
      || entry.globalSequence < 1
      || entry.canonicalPath !== `/posts/${entry.globalSequence}`
      || !/^\/posts\/[1-9]\d*$/.test(entry.canonicalPath)
      || !Array.isArray(entry.legacyPaths)
      || JSON.stringify(entry.legacyPaths) !== JSON.stringify(legacyPathsFor(entry))) fail('SEQ_E_PROJECTION_ENTRY');
    if (sequences.has(entry.globalSequence) || identities.has(identity(entry))) fail('SEQ_E_PROJECTION_COLLISION');
    sequences.add(entry.globalSequence);
    identities.add(identity(entry));
  }
  validateRouteNamespace(projection);
  if (ledger && stableJson(projection) !== stableJson(buildPublicProjection(ledger))) fail('SEQ_E_PROJECTION_LEDGER_MISMATCH');
  return projection;
}

function nextOperationLedger(ledger) {
  const next = structuredClone(ledger);
  next.generation += 1;
  return next;
}

export function allocateSequence(ledger, input, { requireBootstrapDigests = true } = {}) {
  validateLedger(ledger, { requireBootstrapDigests });
  const { source, sourceId } = validateSourceIdentityInput(input);
  if (source !== 'native') fail('SEQ_E_ALLOCATION_SOURCE_FROZEN');
  const entry = {
    globalSequence: ledger.nextSequence,
    source,
    sourceId,
    visibility: validateVisibility(input),
    publishedAt: validatePublishedAt(input),
    status: 'active',
  };
  if (ledger.entries.some((existing) => identity(existing) === identity(entry))) fail('SEQ_E_IDENTITY_COLLISION');
  const next = nextOperationLedger(ledger);
  next.entries.push(entry);
  next.nextSequence += 1;
  validateLedger(next, { requireBootstrapDigests });
  validatePublicProjection(buildPublicProjection(next));
  return { ledger: next, allocatedSequence: entry.globalSequence };
}

function resolveOperationEntry(ledger, input, { active = false } = {}) {
  const { source, sourceId } = validateSourceIdentityInput(input);
  const matches = ledger.entries.filter((entry) => entry.source === source && entry.sourceId === sourceId);
  if (matches.length !== 1 || (active && matches[0].status !== 'active')) fail('SEQ_E_IDENTITY_RESOLUTION');
  return matches[0];
}

export function setSequenceVisibility(ledger, input, { requireBootstrapDigests = true } = {}) {
  validateLedger(ledger, { requireBootstrapDigests });
  const visibility = validateVisibility(input);
  const current = resolveOperationEntry(ledger, input, { active: true });
  if (current.visibility === 'public' && visibility === 'private') fail('SEQ_E_PUBLIC_RETRACTION_POLICY');
  const next = nextOperationLedger(ledger);
  const target = next.entries[current.globalSequence - 1];
  target.visibility = visibility;
  validateLedger(next, { requireBootstrapDigests });
  return { ledger: next, globalSequence: target.globalSequence, previousVisibility: current.visibility };
}

export function tombstoneSequence(ledger, input, { requireBootstrapDigests = true } = {}) {
  validateLedger(ledger, { requireBootstrapDigests });
  const current = resolveOperationEntry(ledger, input);
  if (current.status === 'tombstone') fail('SEQ_E_ALREADY_TOMBSTONED');
  const next = nextOperationLedger(ledger);
  next.entries[current.globalSequence - 1].status = 'tombstone';
  validateLedger(next, { requireBootstrapDigests });
  return { ledger: next, globalSequence: current.globalSequence, previousStatus: current.status };
}

export function privateBootstrapSidecarFromGenesisLedger(ledger) {
  validateLedger(ledger);
  if (ledger.entries.length !== BOOTSTRAP_ENTRY_COUNT
    || publicProjectionDigest(buildPublicProjection(ledger)) !== BOOTSTRAP_PUBLIC_PROJECTION_SHA256
    || bootstrapMetadataDigest(ledger.entries) !== BOOTSTRAP_METADATA_SEAL_SHA256) fail('SEQ_E_ADOPTION_BASELINE');
  const entries = ledger.entries
    .filter((entry) => entry.globalSequence <= BOOTSTRAP_ENTRY_COUNT && entry.visibility === 'private')
    .map((entry) => ({
      source: entry.source,
      sourceId: entry.sourceId,
      visibility: 'private',
      publishedAt: entry.publishedAt,
      canonicalPath: entry.source === 'naver' ? `/naver/${entry.sourceId}` : `/${entry.sourceId}`,
    }));
  return validatePrivateBootstrapSidecar({ schemaVersion: 1, kind: 'private-bootstrap-metadata', entries });
}

export function validatePrivateBootstrapSidecar(sidecar) {
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)
    || Object.keys(sidecar).some((key) => !PRIVATE_SIDECAR_KEYS.has(key))
    || Object.keys(sidecar).length !== PRIVATE_SIDECAR_KEYS.size
    || sidecar.schemaVersion !== 1
    || sidecar.kind !== 'private-bootstrap-metadata'
    || !Array.isArray(sidecar.entries)
    || sidecar.entries.length !== BOOTSTRAP_PRIVATE_COUNT) fail('SEQ_E_PRIVATE_METADATA_SCHEMA');
  const identities = new Set();
  for (const entry of sidecar.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some((key) => !PRIVATE_SIDECAR_ENTRY_KEYS.has(key))
      || Object.keys(entry).length !== PRIVATE_SIDECAR_ENTRY_KEYS.size) fail('SEQ_E_PRIVATE_METADATA_SCHEMA');
    validateSourceIdentityInput(entry);
    validatePublishedAt(entry);
    if (entry.visibility !== 'private'
      || entry.canonicalPath !== (entry.source === 'naver' ? `/naver/${entry.sourceId}` : `/${entry.sourceId}`)
      || identities.has(identity(entry))) fail('SEQ_E_PRIVATE_METADATA_SCHEMA');
    identities.add(identity(entry));
  }
  return sidecar;
}

export function assertBootstrapEvidence(ledger, sidecar) {
  validateLedger(ledger);
  validatePrivateBootstrapSidecar(sidecar);
  const initialEntries = ledger.entries.slice(0, BOOTSTRAP_ENTRY_COUNT);
  const sidecarByIdentity = new Map(sidecar.entries.map((entry) => [identity(entry), entry]));
  for (const privateEntry of sidecar.entries) {
    const current = initialEntries.find((entry) => identity(entry) === identity(privateEntry));
    if (!current || current.publishedAt !== privateEntry.publishedAt) fail('SEQ_E_BOOTSTRAP_SIDECAR_MISMATCH');
  }
  const genesisEntries = initialEntries.map((entry) => ({
    ...entry,
    visibility: sidecarByIdentity.has(identity(entry)) ? 'private' : 'public',
    status: 'active',
  }));
  if (bootstrapMetadataDigest(genesisEntries) !== BOOTSTRAP_METADATA_SEAL_SHA256
    || publicProjectionDigest(buildPublicProjection({ entries: genesisEntries })) !== BOOTSTRAP_PUBLIC_PROJECTION_SHA256) {
    fail('SEQ_E_BOOTSTRAP_SEAL_MISMATCH');
  }
  return genesisEntries;
}

function journalEventPayload(event) {
  const { eventSha256: _digest, ...payload } = event;
  return payload;
}

export function createJournalEvent({
  previousEvent = null,
  beforeLedger = null,
  beforeProjection = [],
  afterLedger,
  afterProjection,
  operation,
  requireBootstrapDigests = true,
}) {
  validateLedger(afterLedger, { requireBootstrapDigests });
  validatePublicProjection(afterProjection, afterLedger);
  const genesis = previousEvent === null;
  const event = {
    schemaVersion: 1,
    kind: genesis ? 'genesis' : 'commit',
    generationFrom: genesis ? -1 : beforeLedger.generation,
    generationTo: afterLedger.generation,
    previousEventSha256: previousEvent?.eventSha256 ?? null,
    operation: genesis ? { type: 'genesis' } : operation,
    beforeLedgerSha256: genesis ? null : objectDigest(beforeLedger),
    afterLedgerSha256: objectDigest(afterLedger),
    beforeProjectionSha256: genesis ? null : objectDigest(beforeProjection),
    afterProjectionSha256: objectDigest(afterProjection),
  };
  event.eventSha256 = objectDigest(event);
  return validateJournalEvent(event, previousEvent);
}

function validateJournalOperation(operation, kind) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) || typeof operation.type !== 'string') {
    fail('SEQ_E_JOURNAL_SCHEMA');
  }
  if (kind === 'genesis') {
    if (stableJson(operation) !== stableJson({ type: 'genesis' })) fail('SEQ_E_JOURNAL_SCHEMA');
    return;
  }
  const allowedByType = {
    allocate: new Set(['type', 'source', 'sourceId', 'visibility', 'publishedAt', 'allocatedSequence']),
    'set-visibility': new Set(['type', 'source', 'sourceId', 'fromVisibility', 'toVisibility', 'globalSequence']),
    tombstone: new Set(['type', 'source', 'sourceId', 'fromStatus', 'globalSequence']),
  };
  const allowed = allowedByType[operation.type];
  if (!allowed || Object.keys(operation).some((key) => !allowed.has(key)) || Object.keys(operation).length !== allowed.size) {
    fail('SEQ_E_JOURNAL_SCHEMA');
  }
  validateSourceIdentityInput(operation);
  if (operation.type === 'allocate') {
    if (operation.source !== 'native') fail('SEQ_E_ALLOCATION_SOURCE_FROZEN');
    validateVisibility(operation);
    validatePublishedAt(operation);
    if (!Number.isSafeInteger(operation.allocatedSequence) || operation.allocatedSequence < 1) fail('SEQ_E_JOURNAL_SCHEMA');
  } else if (operation.type === 'set-visibility') {
    if (!VISIBILITIES.has(operation.fromVisibility) || !VISIBILITIES.has(operation.toVisibility)
      || !Number.isSafeInteger(operation.globalSequence)) fail('SEQ_E_JOURNAL_SCHEMA');
  } else if (operation.fromStatus !== 'active' || !Number.isSafeInteger(operation.globalSequence)) {
    fail('SEQ_E_JOURNAL_SCHEMA');
  }
}

export function validateJournalEvent(event, previousEvent = undefined) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || Object.keys(event).some((key) => !JOURNAL_EVENT_KEYS.has(key))
    || Object.keys(event).length !== JOURNAL_EVENT_KEYS.size
    || event.schemaVersion !== 1
    || !['genesis', 'commit'].includes(event.kind)) fail('SEQ_E_JOURNAL_SCHEMA');
  validateJournalOperation(event.operation, event.kind);
  if (event.eventSha256 !== objectDigest(journalEventPayload(event))) fail('SEQ_E_JOURNAL_HASH');
  if (event.kind === 'genesis') {
    if (event.generationFrom !== -1 || event.generationTo !== 0 || event.previousEventSha256 !== null
      || event.beforeLedgerSha256 !== null || event.beforeProjectionSha256 !== null) fail('SEQ_E_JOURNAL_SCHEMA');
  } else if (previousEvent !== undefined) {
    if (!previousEvent
      || event.generationFrom !== previousEvent.generationTo
      || event.generationTo !== previousEvent.generationTo + 1
      || event.previousEventSha256 !== previousEvent.eventSha256
      || event.beforeLedgerSha256 !== previousEvent.afterLedgerSha256
      || event.beforeProjectionSha256 !== previousEvent.afterProjectionSha256) fail('SEQ_E_JOURNAL_CHAIN');
  } else if (event.generationTo !== event.generationFrom + 1
    || !/^[a-f0-9]{64}$/.test(event.previousEventSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(event.beforeLedgerSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(event.beforeProjectionSha256 ?? '')) {
    fail('SEQ_E_JOURNAL_SCHEMA');
  }
  for (const key of ['afterLedgerSha256', 'afterProjectionSha256']) {
    if (!/^[a-f0-9]{64}$/.test(event[key])) fail('SEQ_E_JOURNAL_SCHEMA');
  }
  return event;
}

function applyJournalOperation(ledger, operation, { requireBootstrapDigests = true } = {}) {
  if (operation.type === 'allocate') {
    const result = allocateSequence(ledger, operation, { requireBootstrapDigests });
    if (result.allocatedSequence !== operation.allocatedSequence) fail('SEQ_E_JOURNAL_STATE');
    return result.ledger;
  }
  if (operation.type === 'set-visibility') {
    const current = resolveOperationEntry(ledger, operation, { active: true });
    if (current.visibility !== operation.fromVisibility
      || current.globalSequence !== operation.globalSequence) fail('SEQ_E_JOURNAL_STATE');
    return setSequenceVisibility(
      ledger,
      { ...operation, visibility: operation.toVisibility },
      { requireBootstrapDigests },
    ).ledger;
  }
  const current = resolveOperationEntry(ledger, operation);
  if (current.status !== operation.fromStatus
    || current.globalSequence !== operation.globalSequence) fail('SEQ_E_JOURNAL_STATE');
  return tombstoneSequence(ledger, operation, { requireBootstrapDigests }).ledger;
}

export function replayJournal(genesisLedger, events, { requireBootstrapDigests = true } = {}) {
  validateLedger(genesisLedger, { requireBootstrapDigests });
  if (!Array.isArray(events) || events.length === 0) fail('SEQ_E_JOURNAL_MISSING');
  let previous = null;
  let ledger = structuredClone(genesisLedger);
  for (const event of events) {
    validateJournalEvent(event, previous);
    if (!previous) {
      if (event.afterLedgerSha256 !== objectDigest(ledger)
        || event.afterProjectionSha256 !== objectDigest(buildPublicProjection(ledger))) fail('SEQ_E_JOURNAL_STATE');
    } else {
      ledger = applyJournalOperation(ledger, event.operation, { requireBootstrapDigests });
      if (event.afterLedgerSha256 !== objectDigest(ledger)
        || event.afterProjectionSha256 !== objectDigest(buildPublicProjection(ledger))) fail('SEQ_E_JOURNAL_STATE');
    }
    previous = event;
  }
  return { ledger, projection: buildPublicProjection(ledger), head: previous };
}

function modeOf(stats) { return stats.mode & 0o777; }
function statSignature(stats) { return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}`; }
function ancestorSignature(stats) { return `${stats.dev}:${stats.ino}:${modeOf(stats)}:${stats.isDirectory()}`; }

function pathAncestorsStable(beforeSnapshot, afterSnapshot, { includeLeaf = false } = {}) {
  const beforeChain = includeLeaf ? beforeSnapshot.chain : beforeSnapshot.chain.slice(0, -1);
  const afterChain = includeLeaf ? afterSnapshot.chain : afterSnapshot.chain.slice(0, -1);
  return beforeChain.length === afterChain.length
    && beforeChain.every((entry, index) => (
      entry.path === afterChain[index]?.path
      && ancestorSignature(entry.stats) === ancestorSignature(afterChain[index].stats)
    ));
}

async function lstatOrNull(target) {
  try { return await lstat(target); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('SEQ_E_PATH_INSPECTION');
  }
}

async function snapshotRealPathChain(target, { allowMissingLeaf = false } = {}) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  const chain = [];
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stats = await lstatOrNull(current);
    const leaf = index === parts.length - 1;
    if (!stats) {
      if (leaf && allowMissingLeaf) return { resolved, chain, leaf: null };
      fail('SEQ_E_PATH_MISSING');
    }
    if (stats.isSymbolicLink()) fail(leaf ? 'SEQ_E_FILE_SYMLINK' : 'SEQ_E_ANCESTOR_SYMLINK');
    if (!leaf && !stats.isDirectory()) fail('SEQ_E_ANCESTOR_TYPE');
    chain.push({ path: current, stats });
  }
  return { resolved, chain, leaf: chain.at(-1)?.stats ?? await lstatOrNull(resolved) };
}

export async function inspectRealPathChain(target, { allowMissingLeaf = false } = {}) {
  return (await snapshotRealPathChain(target, { allowMissingLeaf })).leaf;
}

async function inspectRealDirectory(directory) {
  try {
    const stats = await inspectRealPathChain(directory);
    if (!stats?.isDirectory()) fail('SEQ_E_ANCESTOR_TYPE');
    return stats;
  } catch (error) {
    if (error instanceof SequenceError && error.code === 'SEQ_E_FILE_SYMLINK') fail('SEQ_E_ANCESTOR_SYMLINK');
    throw error;
  }
}

export async function assertSecureDirectory(directory, { mode = undefined } = {}) {
  const stats = await inspectRealDirectory(directory);
  if (stats.nlink < 1 || (mode !== undefined && modeOf(stats) !== mode)) fail('SEQ_E_FILE_MODE');
  return stats;
}

export async function readSecureBytes(file, { mode, allowMissing = false } = {}) {
  const beforeSnapshot = await snapshotRealPathChain(file, { allowMissingLeaf: allowMissing });
  const before = beforeSnapshot.leaf;
  if (!before) {
    const afterSnapshot = await snapshotRealPathChain(file, { allowMissingLeaf: true });
    if (afterSnapshot.leaf || !pathAncestorsStable(beforeSnapshot, afterSnapshot, { includeLeaf: true })) {
      fail('SEQ_E_READ_RACE');
    }
    return null;
  }
  if (!before.isFile() || before.isSymbolicLink()) fail('SEQ_E_FILE_TYPE');
  if (before.nlink !== 1) fail('SEQ_E_FILE_HARDLINK');
  if (mode !== undefined && modeOf(before) !== mode) fail('SEQ_E_FILE_MODE');
  let handle;
  try {
    handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) fail('SEQ_E_READ_RACE');
    const raw = await handle.readFile();
    const afterHandle = await handle.stat();
    const afterSnapshot = await snapshotRealPathChain(file);
    const afterPath = afterSnapshot.leaf;
    const ancestorsStable = pathAncestorsStable(beforeSnapshot, afterSnapshot);
    if (statSignature(before) !== statSignature(afterHandle)
      || !ancestorsStable
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino || afterPath.nlink !== 1) fail('SEQ_E_READ_RACE');
    return raw;
  } catch (error) {
    if (error instanceof SequenceError) throw error;
    if (allowMissing && error?.code === 'ENOENT') return null;
    fail('SEQ_E_READ');
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readSecureFile(file, options = {}) {
  const bytes = await readSecureBytes(file, options);
  return bytes === null ? null : bytes.toString('utf8');
}

async function syncDirectory(directory) {
  let handle;
  try {
    const before = await inspectRealDirectory(directory);
    handle = await open(
      directory,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_DIRECTORY ?? 0),
    );
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) fail('SEQ_E_DIRECTORY_SYNC');
    await handle.sync();
    const after = await inspectRealDirectory(directory);
    if (after.dev !== opened.dev || after.ino !== opened.ino) fail('SEQ_E_DIRECTORY_SYNC');
  } catch {
    fail('SEQ_E_DIRECTORY_SYNC');
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function prepareSecureDirectory(directory, { mode = 0o700 } = {}) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  const parts = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    let stats = await lstatOrNull(current);
    if (!stats) {
      try { await mkdir(current, { mode }); }
      catch { fail('SEQ_E_DIRECTORY_CREATE'); }
      stats = await lstatOrNull(current);
    }
    if (!stats?.isDirectory() || stats.isSymbolicLink()) fail('SEQ_E_ANCESTOR_SYMLINK');
  }
  const final = await lstat(resolved);
  if (modeOf(final) !== mode) fail('SEQ_E_FILE_MODE');
}

async function writeTemporary(directory, basename, raw, mode) {
  const temporary = path.join(directory, `.${basename}.${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', mode);
    await handle.chmod(mode);
    await handle.writeFile(raw, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    return temporary;
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (error instanceof SequenceError) throw error;
    fail('SEQ_E_WRITE_STAGE');
  }
}

export async function atomicWriteFile(file, raw, { mode, expectedDigest = undefined, allowMissing = false } = {}) {
  const directory = path.dirname(file);
  const directoryBefore = await inspectRealDirectory(directory);
  const existingRaw = await readSecureFile(file, { mode, allowMissing });
  if (expectedDigest !== undefined && rawDigest(existingRaw) !== expectedDigest) fail('SEQ_E_STATE_HASH_CONFLICT');
  const temporary = await writeTemporary(directory, path.basename(file), raw, mode);
  try {
    const currentRaw = await readSecureFile(file, { mode, allowMissing });
    if (expectedDigest !== undefined && rawDigest(currentRaw) !== expectedDigest) fail('SEQ_E_STATE_HASH_CONFLICT');
    await rename(temporary, file);
    const directoryAfter = await inspectRealDirectory(directory);
    if (directoryBefore.dev !== directoryAfter.dev || directoryBefore.ino !== directoryAfter.ino) fail('SEQ_E_WRITE_COMMIT');
    const stats = await inspectRealPathChain(file);
    if (!stats?.isFile() || stats.nlink !== 1 || modeOf(stats) !== mode) fail('SEQ_E_WRITE_COMMIT');
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (error instanceof SequenceError) throw error;
    fail('SEQ_E_WRITE_COMMIT');
  }
}

export async function writeNoReplaceFile(file, raw, { mode } = {}) {
  const directory = path.dirname(file);
  const directoryBefore = await inspectRealDirectory(directory);
  if (await inspectRealPathChain(file, { allowMissingLeaf: true })) fail('SEQ_E_NO_REPLACE');
  const temporary = await writeTemporary(directory, path.basename(file), raw, mode);
  try {
    await link(temporary, file);
    await unlink(temporary);
    const directoryAfter = await inspectRealDirectory(directory);
    if (directoryBefore.dev !== directoryAfter.dev || directoryBefore.ino !== directoryAfter.ino) fail('SEQ_E_WRITE_COMMIT');
    const stats = await inspectRealPathChain(file);
    if (!stats?.isFile() || stats.nlink !== 1 || modeOf(stats) !== mode) fail('SEQ_E_WRITE_COMMIT');
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (error instanceof SequenceError) throw error;
    if (error?.code === 'EEXIST') fail('SEQ_E_NO_REPLACE');
    fail('SEQ_E_WRITE_COMMIT');
  }
}

export async function readJsonSecure(file, options) {
  const raw = await readSecureFile(file, options);
  if (raw === null) return null;
  try { return JSON.parse(raw); }
  catch { fail('SEQ_E_JSON'); }
}

const prettyJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const rawDigest = (raw) => (raw === null ? null : sha256(raw));

export async function readPrivateLedger(file, {
  allowMissing = false,
  allowLegacyGeneration = false,
  requireBootstrapDigests = true,
} = {}) {
  const raw = await readSecureFile(file, { mode: 0o600, allowMissing });
  if (raw === null) return null;
  let ledger;
  try { ledger = JSON.parse(raw); }
  catch { fail('SEQ_E_JSON'); }
  return validateLedger(ledger, { allowLegacyGeneration, requireBootstrapDigests });
}

export async function writePrivateLedger(file, ledger, {
  expectedRawDigest = undefined,
  allowMissing = false,
  requireBootstrapDigests = true,
} = {}) {
  validateLedger(ledger, { requireBootstrapDigests });
  await atomicWriteFile(file, prettyJson(ledger), { mode: 0o600, expectedDigest: expectedRawDigest, allowMissing });
}

export async function writePublicProjection(file, projection, { expectedRawDigest = undefined, allowMissing = false } = {}) {
  validatePublicProjection(projection);
  await atomicWriteFile(file, prettyJson(projection), { mode: 0o644, expectedDigest: expectedRawDigest, allowMissing });
}

export async function readJournal(directory, { allowMissing = false } = {}) {
  const stats = await inspectRealPathChain(directory, { allowMissingLeaf: allowMissing });
  if (!stats) return [];
  if (!stats.isDirectory() || modeOf(stats) !== 0o700) fail('SEQ_E_JOURNAL_SCHEMA');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { fail('SEQ_E_JOURNAL_READ'); }
  if (entries.some((entry) => !entry.isFile() || !/^\d{12}-[a-f0-9]{64}\.json$/.test(entry.name))) fail('SEQ_E_JOURNAL_SCHEMA');
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const events = [];
  let previous = null;
  for (let index = 0; index < entries.length; index += 1) {
    const event = await readJsonSecure(path.join(directory, entries[index].name), { mode: 0o600 });
    validateJournalEvent(event, previous);
    const expectedName = `${String(event.generationTo).padStart(12, '0')}-${event.eventSha256}.json`;
    if (entries[index].name !== expectedName || event.generationTo !== index) fail('SEQ_E_JOURNAL_CHAIN');
    events.push(event);
    previous = event;
  }
  const after = await inspectRealPathChain(directory);
  if (after.dev !== stats.dev || after.ino !== stats.ino) fail('SEQ_E_JOURNAL_READ');
  if (!allowMissing && events.length === 0) fail('SEQ_E_JOURNAL_MISSING');
  return events;
}

export async function appendJournalEvent(directory, event, previousEvent = null) {
  validateJournalEvent(event, previousEvent);
  const file = path.join(directory, `${String(event.generationTo).padStart(12, '0')}-${event.eventSha256}.json`);
  await writeNoReplaceFile(file, prettyJson(event), { mode: 0o600 });
  return file;
}

export function createBootstrapSeal(sidecar, genesisLedger, genesisEvent) {
  validatePrivateBootstrapSidecar(sidecar);
  validateLedger(genesisLedger);
  validateJournalEvent(genesisEvent, null);
  return validateBootstrapSeal({
    schemaVersion: 1,
    kind: 'global-sequence-bootstrap-seal',
    allocationSha256: BOOTSTRAP_ALLOCATION_SHA256,
    bootstrapMetadataSha256: BOOTSTRAP_METADATA_SEAL_SHA256,
    genesisPublicProjectionSha256: BOOTSTRAP_PUBLIC_PROJECTION_SHA256,
    privateMetadataSha256: objectDigest(sidecar),
    genesisLedgerSha256: objectDigest(genesisLedger),
    genesisEventSha256: genesisEvent.eventSha256,
  }, sidecar, genesisLedger, genesisEvent);
}

export function validateBootstrapSeal(seal, sidecar, genesisLedger, genesisEvent) {
  if (!seal || typeof seal !== 'object' || Array.isArray(seal)
    || Object.keys(seal).some((key) => !SEAL_KEYS.has(key))
    || Object.keys(seal).length !== SEAL_KEYS.size
    || seal.schemaVersion !== 1
    || seal.kind !== 'global-sequence-bootstrap-seal'
    || seal.allocationSha256 !== BOOTSTRAP_ALLOCATION_SHA256
    || seal.bootstrapMetadataSha256 !== BOOTSTRAP_METADATA_SEAL_SHA256
    || seal.genesisPublicProjectionSha256 !== BOOTSTRAP_PUBLIC_PROJECTION_SHA256
    || seal.privateMetadataSha256 !== objectDigest(sidecar)
    || seal.genesisLedgerSha256 !== objectDigest(genesisLedger)
    || seal.genesisEventSha256 !== genesisEvent.eventSha256) fail('SEQ_E_BOOTSTRAP_SEAL_MISMATCH');
  return seal;
}

export function createInitializationMarker({
  operation,
  beforeLedgerRawSha256,
  beforeProjectionRawSha256,
  targetLedger,
  targetProjection,
  targetSidecar,
  targetGenesisEvent,
  targetSeal,
  requireBootstrapDigests = true,
}) {
  const marker = {
    schemaVersion: 1,
    kind: 'global-sequence-initialization',
    operation,
    initializationId: randomBytes(20).toString('hex'),
    beforeLedgerRawSha256,
    beforeProjectionRawSha256,
    targetLedger,
    targetProjection,
    targetSidecar,
    targetGenesisEvent,
    targetSeal,
  };
  return validateInitializationMarker(marker, { requireBootstrapDigests });
}

export function validateInitializationMarker(marker, { requireBootstrapDigests = true } = {}) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)
    || Object.keys(marker).some((key) => !INITIALIZATION_KEYS.has(key))
    || Object.keys(marker).length !== INITIALIZATION_KEYS.size
    || marker.schemaVersion !== 1
    || marker.kind !== 'global-sequence-initialization'
    || !['bootstrap', 'adopt-existing'].includes(marker.operation)
    || !/^[a-f0-9]{40}$/u.test(marker.initializationId ?? '')
    || (marker.beforeLedgerRawSha256 !== null && !/^[a-f0-9]{64}$/u.test(marker.beforeLedgerRawSha256))
    || (marker.beforeProjectionRawSha256 !== null && !/^[a-f0-9]{64}$/u.test(marker.beforeProjectionRawSha256))) {
    fail('SEQ_E_INITIALIZATION_SCHEMA');
  }
  validateLedger(marker.targetLedger, { requireBootstrapDigests });
  validatePublicProjection(marker.targetProjection, marker.targetLedger);
  validateJournalEvent(marker.targetGenesisEvent, null);
  if (marker.targetGenesisEvent.afterLedgerSha256 !== objectDigest(marker.targetLedger)
    || marker.targetGenesisEvent.afterProjectionSha256 !== objectDigest(marker.targetProjection)) {
    fail('SEQ_E_INITIALIZATION_SCHEMA');
  }
  if (requireBootstrapDigests) {
    validatePrivateBootstrapSidecar(marker.targetSidecar);
    validateBootstrapSeal(
      marker.targetSeal,
      marker.targetSidecar,
      marker.targetLedger,
      marker.targetGenesisEvent,
    );
  } else if (!marker.targetSidecar || typeof marker.targetSidecar !== 'object'
    || !marker.targetSeal || typeof marker.targetSeal !== 'object') {
    fail('SEQ_E_INITIALIZATION_SCHEMA');
  }
  return marker;
}

export async function readPendingInitialization(file, {
  allowMissing = true,
  requireBootstrapDigests = true,
} = {}) {
  const marker = await readJsonSecure(file, { mode: 0o600, allowMissing });
  if (marker === null) return null;
  return validateInitializationMarker(marker, { requireBootstrapDigests });
}

async function ensureInitializationJsonTarget(file, target, mode, beforeRawSha256) {
  const raw = await readSecureFile(file, { mode, allowMissing: true });
  if (raw !== null) {
    let current;
    try { current = JSON.parse(raw); }
    catch { fail('SEQ_E_INITIALIZATION_STATE'); }
    if (objectDigest(current) === objectDigest(target)) return;
    if (rawDigest(raw) !== beforeRawSha256) fail('SEQ_E_INITIALIZATION_STATE');
  }
  await atomicWriteFile(file, prettyJson(target), {
    mode,
    expectedDigest: rawDigest(raw),
    allowMissing: true,
  });
}

async function ensureInitializationNoReplaceTarget(file, target, mode) {
  const raw = await readSecureFile(file, { mode, allowMissing: true });
  if (raw !== null) {
    let current;
    try { current = JSON.parse(raw); }
    catch { fail('SEQ_E_INITIALIZATION_STATE'); }
    if (objectDigest(current) !== objectDigest(target)) fail('SEQ_E_INITIALIZATION_STATE');
    return;
  }
  await writeNoReplaceFile(file, prettyJson(target), { mode });
}

export async function reconcileInitialization({
  directory,
  markerFile,
  ledgerFile,
  projectionFile,
  sidecarFile,
  journalDirectory,
  sealFile,
  faultInjector = async () => {},
  requireBootstrapDigests = true,
}) {
  const marker = await readPendingInitialization(markerFile, { allowMissing: false, requireBootstrapDigests });
  await ensureInitializationNoReplaceTarget(sidecarFile, marker.targetSidecar, 0o600);
  await faultInjector('after-sidecar');
  const journalStats = await inspectRealPathChain(journalDirectory, { allowMissingLeaf: true });
  if (!journalStats) await prepareSecureDirectory(journalDirectory, { mode: 0o700 });
  else if (!journalStats.isDirectory() || modeOf(journalStats) !== 0o700) fail('SEQ_E_INITIALIZATION_STATE');
  const events = await readJournal(journalDirectory, { allowMissing: true });
  if (events.length === 0) await appendJournalEvent(journalDirectory, marker.targetGenesisEvent);
  else if (events.length !== 1 || events[0].eventSha256 !== marker.targetGenesisEvent.eventSha256) {
    fail('SEQ_E_INITIALIZATION_STATE');
  }
  await faultInjector('after-journal');
  await ensureInitializationJsonTarget(
    ledgerFile,
    marker.targetLedger,
    0o600,
    marker.beforeLedgerRawSha256,
  );
  await faultInjector('after-ledger');
  await ensureInitializationNoReplaceTarget(sealFile, marker.targetSeal, 0o600);
  await faultInjector('after-seal');
  await ensureInitializationJsonTarget(
    projectionFile,
    marker.targetProjection,
    0o644,
    marker.beforeProjectionRawSha256,
  );
  await faultInjector('after-projection');
  const currentMarker = await readPendingInitialization(markerFile, { allowMissing: false, requireBootstrapDigests });
  if (currentMarker.initializationId !== marker.initializationId) fail('SEQ_E_INITIALIZATION_STATE');
  await faultInjector('before-cleanup');
  await unlink(markerFile).catch(() => fail('SEQ_E_INITIALIZATION_CLEANUP'));
  await syncDirectory(directory);
  return {
    operation: marker.operation,
    ledger: marker.targetLedger,
    projection: marker.targetProjection,
    recovered: true,
  };
}

function projectionChangeOrder(beforeProjection, afterProjection) {
  const before = new Set(beforeProjection.map(identity));
  const after = new Set(afterProjection.map(identity));
  if ([...before].some((item) => !after.has(item))) return 'projection-first';
  if ([...after].some((item) => !before.has(item))) return 'ledger-first';
  return objectDigest(beforeProjection) === objectDigest(afterProjection) ? 'ledger-only' : 'ledger-first';
}

function validateTransaction(marker, { requireBootstrapDigests = true } = {}) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)
    || Object.keys(marker).some((key) => !TRANSACTION_KEYS.has(key))
    || Object.keys(marker).length !== TRANSACTION_KEYS.size
    || marker.schemaVersion !== 1
    || marker.kind !== 'global-sequence-transaction'
    || !/^[a-f0-9]{32}$/.test(marker.transactionId)
    || !['ledger-first', 'projection-first', 'ledger-only'].includes(marker.commitOrder)) fail('SEQ_E_TRANSACTION_SCHEMA');
  validateLedger(marker.targetLedger, { requireBootstrapDigests });
  validatePublicProjection(marker.targetProjection, marker.targetLedger);
  validateJournalEvent(marker.journalEvent);
  if (marker.baseGeneration + 1 !== marker.targetGeneration
    || marker.targetGeneration !== marker.targetLedger.generation
    || marker.beforeLedgerSha256 !== marker.journalEvent.beforeLedgerSha256
    || marker.afterLedgerSha256 !== marker.journalEvent.afterLedgerSha256
    || marker.beforeProjectionSha256 !== marker.journalEvent.beforeProjectionSha256
    || marker.afterProjectionSha256 !== marker.journalEvent.afterProjectionSha256
    || marker.afterLedgerSha256 !== objectDigest(marker.targetLedger)
    || marker.afterProjectionSha256 !== objectDigest(marker.targetProjection)) fail('SEQ_E_TRANSACTION_SCHEMA');
  return marker;
}

export async function readPendingTransaction(file, { allowMissing = true, requireBootstrapDigests = true } = {}) {
  const marker = await readJsonSecure(file, { mode: 0o600, allowMissing });
  if (marker === null) return null;
  return validateTransaction(marker, { requireBootstrapDigests });
}

export async function commitSequenceTransaction({
  directory, ledgerFile, projectionFile, journalDirectory, transactionFile,
  beforeLedger, beforeProjection, afterLedger, operation, previousEvent,
  faultInjector = async () => {},
  requireBootstrapDigests = true,
}) {
  validateLedger(beforeLedger, { requireBootstrapDigests });
  validatePublicProjection(beforeProjection, beforeLedger);
  validateLedger(afterLedger, { requireBootstrapDigests });
  if (afterLedger.generation !== beforeLedger.generation + 1) fail('SEQ_E_GENERATION_CONFLICT');
  const afterProjection = buildPublicProjection(afterLedger);
  validatePublicProjection(afterProjection, afterLedger);
  const event = createJournalEvent({
    previousEvent,
    beforeLedger,
    beforeProjection,
    afterLedger,
    afterProjection,
    operation,
    requireBootstrapDigests,
  });
  const operationLedger = applyJournalOperation(beforeLedger, operation, { requireBootstrapDigests });
  if (stableJson(operationLedger) !== stableJson(afterLedger)) fail('SEQ_E_JOURNAL_STATE');
  const ledgerRaw = await readSecureFile(ledgerFile, { mode: 0o600 });
  const projectionRaw = await readSecureFile(projectionFile, { mode: 0o644 });
  if (objectDigest(beforeLedger) !== previousEvent.afterLedgerSha256
    || objectDigest(beforeProjection) !== previousEvent.afterProjectionSha256
    || beforeLedger.generation !== previousEvent.generationTo) fail('SEQ_E_GENERATION_CONFLICT');
  const marker = validateTransaction({
    schemaVersion: 1,
    kind: 'global-sequence-transaction',
    transactionId: randomBytes(16).toString('hex'),
    commitOrder: projectionChangeOrder(beforeProjection, afterProjection),
    baseGeneration: beforeLedger.generation,
    targetGeneration: afterLedger.generation,
    beforeLedgerSha256: objectDigest(beforeLedger),
    afterLedgerSha256: objectDigest(afterLedger),
    beforeProjectionSha256: objectDigest(beforeProjection),
    afterProjectionSha256: objectDigest(afterProjection),
    targetLedger: afterLedger,
    targetProjection: afterProjection,
    journalEvent: event,
  }, { requireBootstrapDigests });
  if (await readSecureFile(transactionFile, { mode: 0o600, allowMissing: true }) !== null) fail('SEQ_E_TRANSACTION_PENDING');
  await writeNoReplaceFile(transactionFile, prettyJson(marker), { mode: 0o600 });
  await faultInjector('after-marker');
  await appendJournalEvent(journalDirectory, event, previousEvent);
  await faultInjector('after-journal');
  const commitLedger = async () => writePrivateLedger(ledgerFile, afterLedger, {
    expectedRawDigest: rawDigest(ledgerRaw),
    requireBootstrapDigests,
  });
  const commitProjection = async () => writePublicProjection(projectionFile, afterProjection, { expectedRawDigest: rawDigest(projectionRaw) });
  if (marker.commitOrder === 'projection-first') {
    await commitProjection();
    await faultInjector('after-first-state');
    await commitLedger();
    await faultInjector('after-second-state');
  } else {
    await commitLedger();
    await faultInjector('after-first-state');
    if (marker.commitOrder !== 'ledger-only') await commitProjection();
    await faultInjector('after-second-state');
  }
  await faultInjector('before-cleanup');
  const committedLedger = await readPrivateLedger(ledgerFile, { requireBootstrapDigests });
  const committedProjection = await readJsonSecure(projectionFile, { mode: 0o644 });
  if (objectDigest(committedLedger) !== marker.afterLedgerSha256
    || objectDigest(committedProjection) !== marker.afterProjectionSha256) fail('SEQ_E_STATE_HASH_CONFLICT');
  await unlink(transactionFile).catch(() => fail('SEQ_E_TRANSACTION_CLEANUP'));
  await syncDirectory(directory);
  return { ledger: committedLedger, projection: committedProjection, event };
}

async function stateObjectOrNull(file, mode, validator) {
  const value = await readJsonSecure(file, { mode, allowMissing: true });
  if (value === null) return null;
  validator(value);
  return value;
}

export async function reconcilePendingTransaction({
  directory,
  ledgerFile,
  projectionFile,
  journalDirectory,
  transactionFile,
  requireBootstrapDigests = true,
}) {
  const marker = await readPendingTransaction(transactionFile, { requireBootstrapDigests });
  if (!marker) return null;
  const events = await readJournal(journalDirectory);
  const head = events.at(-1);
  if (head.eventSha256 === marker.journalEvent.previousEventSha256) {
    await appendJournalEvent(journalDirectory, marker.journalEvent, head);
  } else if (head.eventSha256 !== marker.journalEvent.eventSha256) {
    fail('SEQ_E_JOURNAL_FORK');
  }
  const ledger = await stateObjectOrNull(
    ledgerFile,
    0o600,
    (value) => validateLedger(value, { requireBootstrapDigests }),
  );
  const projection = await stateObjectOrNull(projectionFile, 0o644, validatePublicProjection);
  const ledgerSha = ledger ? objectDigest(ledger) : null;
  const projectionSha = projection ? objectDigest(projection) : null;
  if (![null, marker.beforeLedgerSha256, marker.afterLedgerSha256].includes(ledgerSha)
    || ![null, marker.beforeProjectionSha256, marker.afterProjectionSha256].includes(projectionSha)) fail('SEQ_E_STATE_HASH_CONFLICT');
  const writeLedgerTarget = async () => {
    if (ledgerSha === marker.afterLedgerSha256) return;
    const raw = await readSecureFile(ledgerFile, { mode: 0o600, allowMissing: true });
    await writePrivateLedger(ledgerFile, marker.targetLedger, {
      expectedRawDigest: rawDigest(raw),
      allowMissing: true,
      requireBootstrapDigests,
    });
  };
  const writeProjectionTarget = async () => {
    if (projectionSha === marker.afterProjectionSha256) return;
    const raw = await readSecureFile(projectionFile, { mode: 0o644, allowMissing: true });
    await writePublicProjection(projectionFile, marker.targetProjection, { expectedRawDigest: rawDigest(raw), allowMissing: true });
  };
  if (marker.commitOrder === 'projection-first') {
    await writeProjectionTarget();
    await writeLedgerTarget();
  } else {
    await writeLedgerTarget();
    if (marker.commitOrder !== 'ledger-only') await writeProjectionTarget();
  }
  await unlink(transactionFile).catch(() => fail('SEQ_E_TRANSACTION_CLEANUP'));
  await syncDirectory(directory);
  return { ledger: marker.targetLedger, projection: marker.targetProjection, recovered: true };
}

function validateSequenceLock(value) {
  const transferRecovery = value?.kind === 'global-sequence-transfer-recovery';
  const expectedKeys = transferRecovery ? TRANSFER_RECOVERY_LOCK_KEYS : LOCK_KEYS;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !expectedKeys.has(key))
    || Object.keys(value).length !== expectedKeys.size
    || value.schemaVersion !== 1
    || !/^[a-f0-9]{40}$/u.test(value.token ?? '')
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || (value.observedGeneration !== null
      && (!Number.isSafeInteger(value.observedGeneration) || value.observedGeneration < 0))
    || (transferRecovery && (!/^[a-f0-9]{40}$/u.test(value.transferId ?? '')
      || !/^[a-f0-9]{64}$/u.test(value.receiptSha256 ?? '')))) {
    fail('SEQ_E_LOCK_SCHEMA');
  }
  return value;
}

function linkedRecoveryLockMatches(lock, transfer) {
  return lock?.kind === 'global-sequence-transfer-recovery'
    && lock.token === transfer.recoveryToken
    && lock.transferId === transfer.transferId
    && lock.receiptSha256 === transfer.receiptSha256
    && lock.observedGeneration === transfer.lockObservedGeneration;
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    fail('SEQ_E_LOCK_PROCESS_EVIDENCE');
  }
}

export async function inspectSequenceLock(lockPath, {
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_LOCK_AGE_MS,
  processAlive = defaultProcessAlive,
} = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(staleAfterMs) || staleAfterMs < 0) fail('SEQ_E_LOCK_EVIDENCE');
  const raw = await readSecureFile(lockPath, { mode: 0o600, allowMissing: true });
  if (raw === null) return { present: false };
  let value;
  try { value = validateSequenceLock(JSON.parse(raw)); }
  catch (error) {
    if (error instanceof SequenceError) throw error;
    fail('SEQ_E_LOCK_SCHEMA');
  }
  const stats = await inspectRealPathChain(lockPath);
  if (!stats?.isFile() || stats.nlink !== 1 || modeOf(stats) !== 0o600) fail('SEQ_E_LOCK_SCHEMA');
  const createdAtMs = Date.parse(value.createdAt);
  const ageMs = Math.max(0, now - createdAtMs);
  const ownerAlive = processAlive(value.pid);
  if (typeof ownerAlive !== 'boolean') fail('SEQ_E_LOCK_PROCESS_EVIDENCE');
  return {
    present: true,
    ...value,
    rawSha256: sha256(raw),
    ageMs,
    ownerAlive,
    stale: ageMs >= staleAfterMs && ownerAlive === false,
    device: stats.dev,
    inode: stats.ino,
  };
}

function lockTransferReceiptDigest(value) {
  const { receiptSha256: _receiptSha256, ...payload } = value;
  return objectDigest(payload);
}

function validateLockTransfer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !LOCK_TRANSFER_KEYS.has(key))
    || Object.keys(value).length !== LOCK_TRANSFER_KEYS.size
    || value.schemaVersion !== 2
    || value.kind !== 'global-sequence-stale-lock-transfer'
    || !/^[a-f0-9]{40}$/u.test(value.transferId ?? '')
    || !/^[a-f0-9]{40}$/u.test(value.lockToken ?? '')
    || !Number.isSafeInteger(value.lockDevice)
    || !Number.isSafeInteger(value.lockInode)
    || (value.lockObservedGeneration !== null
      && (!Number.isSafeInteger(value.lockObservedGeneration) || value.lockObservedGeneration < 0))
    || !/^[a-f0-9]{64}$/u.test(value.lockRawSha256 ?? '')
    || !Number.isSafeInteger(value.ownerPid)
    || value.ownerPid < 1
    || !Number.isFinite(Date.parse(value.ownerCreatedAt ?? ''))
    || !Number.isFinite(Date.parse(value.observedAt ?? ''))
    || !Number.isFinite(value.staleAfterMs)
    || value.staleAfterMs < 0
    || !Number.isFinite(value.recoveryStaleAfterMs)
    || value.recoveryStaleAfterMs < 0
    || value.ownerAlive !== false
    || value.reason !== 'owner-process-absent-after-minimum-age'
    || !/^[a-f0-9]{40}$/u.test(value.recoveryToken ?? '')
    || value.recoveryToken === value.lockToken
    || !/^[a-f0-9]{64}$/u.test(value.receiptSha256 ?? '')
    || value.receiptSha256 !== lockTransferReceiptDigest(value)) fail('SEQ_E_LOCK_TRANSFER_SCHEMA');
  return value;
}

export async function readLockTransfer(file, { allowMissing = true } = {}) {
  const value = await readJsonSecure(file, { mode: 0o600, allowMissing });
  if (value === null) return null;
  return validateLockTransfer(value);
}

export async function clearLockTransfer(file, transferId, { receiptSha256 = null } = {}) {
  if (typeof transferId !== 'string' || !/^[a-f0-9]{40}$/u.test(transferId)) fail('SEQ_E_LOCK_TRANSFER_TOKEN');
  if (receiptSha256 !== null && !/^[a-f0-9]{64}$/u.test(receiptSha256)) fail('SEQ_E_LOCK_TRANSFER_TOKEN');
  const before = await readLockTransfer(file, { allowMissing: false });
  if (before.transferId !== transferId
    || (receiptSha256 !== null && before.receiptSha256 !== receiptSha256)) fail('SEQ_E_LOCK_TRANSFER_TOKEN');
  const stats = await inspectRealPathChain(file);
  const current = await readLockTransfer(file, { allowMissing: false });
  const currentStats = await inspectRealPathChain(file);
  if (current.transferId !== transferId
    || (receiptSha256 !== null && current.receiptSha256 !== receiptSha256)
    || stats.dev !== currentStats.dev
    || stats.ino !== currentStats.ino) fail('SEQ_E_LOCK_TRANSFER_REPLACED');
  await unlink(file).catch(() => fail('SEQ_E_LOCK_TRANSFER_CLEANUP'));
  await syncDirectory(path.dirname(file));
  return { cleared: true, transferId };
}

export async function removeStaleSequenceLock(lockPath, token, {
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_LOCK_AGE_MS,
  processAlive = defaultProcessAlive,
  afterTransferWrite = async () => {},
  beforeUnlink = async () => {},
} = {}) {
  if (typeof token !== 'string' || !/^[a-f0-9]{40}$/u.test(token)) fail('SEQ_E_LOCK_TOKEN');
  const transferPath = path.join(path.dirname(lockPath), LOCK_TRANSFER_FILENAME);
  let transfer = await readLockTransfer(transferPath, { allowMissing: true });
  const resumed = Boolean(transfer);
  let observed = await inspectSequenceLock(lockPath, {
    now,
    staleAfterMs: transfer ? 0 : staleAfterMs,
    processAlive,
  });
  if (transfer) {
    if (transfer.lockToken !== token) fail('SEQ_E_LOCK_TOKEN');
    if (!observed.present) {
      return {
        removed: true,
        resumed: true,
        token,
        transferId: transfer.transferId,
        pid: transfer.ownerPid,
        createdAt: transfer.ownerCreatedAt,
        ageMs: null,
        ownerAlive: false,
      };
    }
    if (observed.kind === 'global-sequence-transfer-recovery') {
      if (!linkedRecoveryLockMatches(observed, transfer)) fail('SEQ_E_LOCK_REPLACED');
      if (observed.ownerAlive || observed.ageMs < transfer.recoveryStaleAfterMs) fail('SEQ_E_LOCKED');
      return {
        removed: true,
        resumed: true,
        linkedRecoveryLease: true,
        token,
        transferId: transfer.transferId,
        pid: transfer.ownerPid,
        createdAt: transfer.ownerCreatedAt,
        ageMs: observed.ageMs,
        ownerAlive: false,
      };
    }
    if (observed.token !== transfer.lockToken
      || observed.device !== transfer.lockDevice
      || observed.inode !== transfer.lockInode
      || observed.observedGeneration !== transfer.lockObservedGeneration
      || observed.rawSha256 !== transfer.lockRawSha256
      || observed.pid !== transfer.ownerPid
      || observed.createdAt !== transfer.ownerCreatedAt) fail('SEQ_E_LOCK_REPLACED');
  } else {
    if (!observed.present) fail('SEQ_E_LOCK_MISSING');
    if (observed.token !== token) fail('SEQ_E_LOCK_TOKEN');
    if (!observed.stale) fail('SEQ_E_LOCK_NOT_STALE');
    const transferPayload = {
      schemaVersion: 2,
      kind: 'global-sequence-stale-lock-transfer',
      transferId: randomBytes(20).toString('hex'),
      lockToken: observed.token,
      lockDevice: observed.device,
      lockInode: observed.inode,
      lockObservedGeneration: observed.observedGeneration,
      lockRawSha256: observed.rawSha256,
      ownerPid: observed.pid,
      ownerCreatedAt: observed.createdAt,
      observedAt: new Date(now).toISOString(),
      staleAfterMs,
      recoveryStaleAfterMs: staleAfterMs,
      ownerAlive: false,
      reason: 'owner-process-absent-after-minimum-age',
      recoveryToken: randomBytes(20).toString('hex'),
    };
    transfer = validateLockTransfer({
      ...transferPayload,
      receiptSha256: objectDigest(transferPayload),
    });
    await writeNoReplaceFile(transferPath, prettyJson(transfer), { mode: 0o600 });
    await afterTransferWrite(transfer);
  }
  await beforeUnlink();
  const current = await inspectSequenceLock(lockPath, {
    now,
    staleAfterMs: transfer.staleAfterMs,
    processAlive: () => false,
  });
  if (!current.present
    || current.token !== transfer.lockToken
    || current.device !== transfer.lockDevice
    || current.inode !== transfer.lockInode
    || current.observedGeneration !== transfer.lockObservedGeneration
    || current.rawSha256 !== transfer.lockRawSha256
    || !current.stale) fail('SEQ_E_LOCK_REPLACED');
  await unlink(lockPath).catch(() => fail('SEQ_E_LOCK_RELEASE'));
  await syncDirectory(path.dirname(lockPath));
  return {
    removed: true,
    resumed,
    token,
    transferId: transfer.transferId,
    pid: observed.pid,
    createdAt: observed.createdAt,
    ageMs: observed.ageMs,
    ownerAlive: false,
  };
}

export async function withSequenceLock(directory, operation, {
  observedGeneration = null,
  lockTransferId = null,
  afterAcquire = async () => {},
  afterOperationBeforeRelease = async () => {},
} = {}) {
  await prepareSecureDirectory(directory, { mode: 0o700 });
  const lockPath = path.join(directory, LOCK_FILENAME);
  const transferPath = path.join(directory, LOCK_TRANSFER_FILENAME);
  const transfer = await readLockTransfer(transferPath, { allowMissing: true });
  if (transfer && transfer.transferId !== lockTransferId) fail('SEQ_E_LOCK_TRANSFER_PENDING');
  if (!transfer && lockTransferId !== null) fail('SEQ_E_LOCK_TRANSFER_TOKEN');
  if (transfer && observedGeneration !== null
    && observedGeneration !== transfer.lockObservedGeneration) fail('SEQ_E_GENERATION_CONFLICT');
  const token = transfer ? transfer.recoveryToken : randomBytes(20).toString('hex');
  const lockValue = transfer
    ? {
        schemaVersion: 1,
        kind: 'global-sequence-transfer-recovery',
        token,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        observedGeneration: transfer.lockObservedGeneration,
        transferId: transfer.transferId,
        receiptSha256: transfer.receiptSha256,
      }
    : {
        schemaVersion: 1,
        token,
        pid: process.pid,
        createdAt: new Date().toISOString(),
        observedGeneration,
      };
  validateSequenceLock(lockValue);
  let lease;
  const existing = await inspectSequenceLock(lockPath, {
    staleAfterMs: transfer?.recoveryStaleAfterMs ?? 0,
  });
  if (existing.present) {
    if (!transfer || !linkedRecoveryLockMatches(existing, transfer)) fail('SEQ_E_LOCKED');
    if (!existing.stale) fail('SEQ_E_LOCKED');
    const current = await inspectSequenceLock(lockPath, {
      staleAfterMs: transfer.recoveryStaleAfterMs,
      processAlive: () => false,
    });
    if (!current.present
      || !linkedRecoveryLockMatches(current, transfer)
      || current.device !== existing.device
      || current.inode !== existing.inode
      || current.rawSha256 !== existing.rawSha256) fail('SEQ_E_LOCK_REPLACED');
    await unlink(lockPath).catch(() => fail('SEQ_E_LOCK_REPLACED'));
    await syncDirectory(directory);
  }
  {
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.chmod(0o600);
      await handle.writeFile(prettyJson(lockValue), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code === 'EEXIST') fail('SEQ_E_LOCKED');
      if (error instanceof SequenceError) throw error;
      fail('SEQ_E_LOCK_CREATE');
    }
    lease = await inspectSequenceLock(lockPath, {
      staleAfterMs: transfer?.recoveryStaleAfterMs ?? 0,
    });
    if (!lease.present || lease.token !== token) fail('SEQ_E_LOCK_REPLACED');
  }
  await afterAcquire({
    token,
    transferId: transfer?.transferId ?? null,
    resumed: Boolean(existing.present),
  });
  try {
    const result = await operation({ token, lockPath, transfer, resumed: Boolean(existing.present) });
    await afterOperationBeforeRelease({ token, transferId: transfer?.transferId ?? null });
    return result;
  } finally {
    const current = await inspectSequenceLock(lockPath, { staleAfterMs: 0, processAlive: () => false });
    if (!current.present
      || current.token !== token
      || current.device !== lease.device
      || current.inode !== lease.inode
      || current.rawSha256 !== lease.rawSha256
      || (transfer && !linkedRecoveryLockMatches(current, transfer))) fail('SEQ_E_LOCK_REPLACED');
    await unlink(lockPath).catch(() => fail('SEQ_E_LOCK_RELEASE'));
    await syncDirectory(directory);
  }
}
