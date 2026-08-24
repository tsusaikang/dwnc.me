import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  assertBootstrapEvidence,
  assertSecureDirectory,
  BOOTSTRAP_ALLOCATION_SHA256,
  BOOTSTRAP_ENTRY_COUNT,
  BOOTSTRAP_PRIVATE_COUNT,
  BOOTSTRAP_PUBLIC_COUNT,
  BOOTSTRAP_PUBLIC_PROJECTION_SHA256,
  BOOTSTRAP_SEAL_FILENAME,
  JOURNAL_DIRECTORYNAME,
  INITIALIZATION_FILENAME,
  LOCK_FILENAME,
  LOCK_TRANSFER_FILENAME,
  objectDigest,
  PRIVATE_METADATA_FILENAME,
  publicProjectionDigest,
  readJournal,
  readLockTransfer,
  readJsonSecure,
  readPendingTransaction,
  readPendingInitialization,
  readPrivateLedger,
  readSecureFile,
  replayJournal,
  stableJson,
  TRANSACTION_FILENAME,
  validateBootstrapSeal,
  validatePrivateBootstrapSidecar,
  validatePublicProjection,
} from './lib/global-sequence.mjs';
import { indexPreparedPublicContent, selectProjectionBackedContent } from './lib/public-content-preflight.mjs';

const ROOT = process.cwd();
const privateRootOverride = process.env.DWNC_SEQUENCE_PRIVATE_ROOT;
if (privateRootOverride && !path.isAbsolute(privateRootOverride)) throw new Error('SEQ_E_PRIVATE_ROOT_OVERRIDE');
const PRIVATE_ROOT = privateRootOverride
  ? path.resolve(privateRootOverride)
  : path.join(ROOT, 'migration/private');
const PRIVATE_DIRECTORY = path.join(PRIVATE_ROOT, 'sequence');
const LEDGER_FILE = path.join(PRIVATE_DIRECTORY, 'global-sequence-v1.json');
const PRIVATE_METADATA_FILE = path.join(PRIVATE_DIRECTORY, PRIVATE_METADATA_FILENAME);
const SEAL_FILE = path.join(PRIVATE_DIRECTORY, BOOTSTRAP_SEAL_FILENAME);
const JOURNAL_DIRECTORY = path.join(PRIVATE_DIRECTORY, JOURNAL_DIRECTORYNAME);
const TRANSACTION_FILE = path.join(PRIVATE_DIRECTORY, TRANSACTION_FILENAME);
const LOCK_FILE = path.join(PRIVATE_DIRECTORY, LOCK_FILENAME);
const LOCK_TRANSFER_FILE = path.join(PRIVATE_DIRECTORY, LOCK_TRANSFER_FILENAME);
const INITIALIZATION_FILE = path.join(PRIVATE_DIRECTORY, INITIALIZATION_FILENAME);
const PROJECTION_FILE = path.join(ROOT, 'src/data/public-sequence-v1.json');
const EDGE_MANIFEST_FILE = path.join(ROOT, 'docs/EDGE_REDIRECTS_V1.json');
const DIST = path.join(ROOT, 'dist');
const issues = new Map();

function issue(code) {
  issues.set(code, (issues.get(code) ?? 0) + 1);
}

async function exists(target) {
  try { await lstat(target); return true; }
  catch (error) {
    if (error?.code === 'ENOENT') return false;
    issue('SEQ_V_PATH');
    return false;
  }
}

async function walk(directory, optional = false) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (!optional || error?.code !== 'ENOENT') issue('SEQ_V_WALK');
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { issue('SEQ_V_SYMLINK'); continue; }
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

let projection = [];
try {
  projection = await readJsonSecure(PROJECTION_FILE, { mode: 0o644 });
  validatePublicProjection(projection);
} catch {
  issue('SEQ_V_PUBLIC_PROJECTION');
}

const authoritative = await exists(PRIVATE_DIRECTORY);
let ledger = null;
let sidecar = null;
let events = [];
let currentPrivateOrReserved = null;
let nextSequence = null;
let generation = null;

if (authoritative) {
  try {
    await assertSecureDirectory(PRIVATE_ROOT, { mode: 0o700 });
    await assertSecureDirectory(PRIVATE_DIRECTORY, { mode: 0o700 });
    await assertSecureDirectory(JOURNAL_DIRECTORY, { mode: 0o700 });
    if (await readSecureFile(LOCK_FILE, { mode: 0o600, allowMissing: true }) !== null) issue('SEQ_V_LOCKED');
    if (await readLockTransfer(LOCK_TRANSFER_FILE, { allowMissing: true })) issue('SEQ_V_LOCK_TRANSFER_PENDING');
    if (await readPendingInitialization(INITIALIZATION_FILE)) issue('SEQ_V_INITIALIZATION_PENDING');
    if (await readPendingTransaction(TRANSACTION_FILE)) issue('SEQ_V_TRANSACTION_PENDING');
    [ledger, sidecar, events] = await Promise.all([
      readPrivateLedger(LEDGER_FILE),
      readJsonSecure(PRIVATE_METADATA_FILE, { mode: 0o600 }),
      readJournal(JOURNAL_DIRECTORY),
    ]);
    const seal = await readJsonSecure(SEAL_FILE, { mode: 0o600 });
    validatePrivateBootstrapSidecar(sidecar);
    const genesisEntries = assertBootstrapEvidence(ledger, sidecar);
    const genesisLedger = {
      schemaVersion: ledger.schemaVersion,
      allocationPolicy: ledger.allocationPolicy,
      bootstrap: structuredClone(ledger.bootstrap),
      generation: 0,
      nextSequence: BOOTSTRAP_ENTRY_COUNT + 1,
      entries: genesisEntries,
    };
    validateBootstrapSeal(seal, sidecar, genesisLedger, events[0]);
    const replayed = replayJournal(genesisLedger, events);
    if (stableJson(replayed.ledger) !== stableJson(ledger)
      || stableJson(replayed.projection) !== stableJson(projection)
      || replayed.head.generationTo !== ledger.generation) issue('SEQ_V_JOURNAL_STATE');
    validatePublicProjection(projection, ledger);
    if (ledger.bootstrap.allocationSha256 !== BOOTSTRAP_ALLOCATION_SHA256
      || ledger.bootstrap.publicProjectionSha256 !== BOOTSTRAP_PUBLIC_PROJECTION_SHA256) issue('SEQ_V_GENESIS_DIGEST');
    currentPrivateOrReserved = ledger.entries.length - projection.length;
    nextSequence = ledger.nextSequence;
    generation = ledger.generation;

    let privateRoutes = 0;
    for (const entry of ledger.entries) {
      if (entry.visibility === 'public' && entry.status === 'active') continue;
      if (await exists(path.join(DIST, 'posts', String(entry.globalSequence), 'index.html'))) privateRoutes += 1;
    }
    if (privateRoutes) issue('SEQ_V_PRIVATE_ROUTE');
  } catch {
    issue('SEQ_V_AUTHORITATIVE_STATE');
  }
}

try {
  const index = await indexPreparedPublicContent(ROOT);
  const rows = [...index.values()].flat();
  selectProjectionBackedContent(rows, projection, { development: false });
} catch {
  issue('SEQ_V_PUBLIC_CONTENT');
}

try {
  const edgeManifest = JSON.parse(await readFile(EDGE_MANIFEST_FILE, 'utf8'));
  const expectedRedirects = projection.flatMap((entry) => entry.legacyPaths.map((legacyPath) => ({
    from: legacyPath,
    to: entry.canonicalPath,
    status: 308,
  })));
  if (edgeManifest.schemaVersion !== 1
    || edgeManifest.canonicalOrigin !== 'https://dwnc.me'
    || stableJson(edgeManifest.redirects) !== stableJson(expectedRedirects)) issue('SEQ_V_EDGE_MANIFEST');
} catch {
  issue('SEQ_V_EDGE_MANIFEST');
}

const publicRuntimeFiles = [
  ...(await walk(path.join(ROOT, 'src'))),
  path.join(ROOT, 'astro.config.mjs'),
].filter((file) => !file.endsWith('public-sequence-v1.json'));
for (const file of publicRuntimeFiles) {
  let raw = '';
  try { raw = await readFile(file, 'utf8'); }
  catch { issue('SEQ_V_PUBLIC_RUNTIME_READ'); continue; }
  if (/migration\/private|global-sequence-v1\.json|bootstrap-private-metadata-v1\.json|events-v1/iu.test(raw)) {
    issue('SEQ_V_PUBLIC_RUNTIME_PRIVATE_REFERENCE');
  }
}
for (const file of (await walk(DIST, true)).filter((item) => /\.(?:html|js|json|xml|txt|css)$/i.test(item))) {
  let raw = '';
  try { raw = await readFile(file, 'utf8'); }
  catch { issue('SEQ_V_PUBLIC_ARTIFACT_READ'); continue; }
  if (/migration\/private|global-sequence-v1\.json|bootstrap-private-metadata-v1\.json|events-v1/iu.test(raw)) {
    issue('SEQ_V_PUBLIC_ARTIFACT_PRIVATE_REFERENCE');
  }
}

if (issues.size) {
  console.error(JSON.stringify({
    error: 'SEQ_E_VALIDATION_FAILED',
    issues: Object.fromEntries([...issues.entries()].sort(([a], [b]) => a.localeCompare(b))),
  }));
  process.exit(1);
}

console.log(JSON.stringify({
  globalSequence: {
    validationScope: authoritative ? 'authoritative' : 'public-only',
    bootstrapEntries: BOOTSTRAP_ENTRY_COUNT,
    bootstrapPublic: BOOTSTRAP_PUBLIC_COUNT,
    bootstrapPrivate: BOOTSTRAP_PRIVATE_COUNT,
    currentEntries: ledger?.entries.length ?? null,
    currentPublic: projection.length,
    currentPrivateOrReserved,
    generation,
    nextSequence,
    allocationSha256: authoritative ? BOOTSTRAP_ALLOCATION_SHA256 : null,
    genesisPublicProjectionSha256: BOOTSTRAP_PUBLIC_PROJECTION_SHA256,
    currentPublicProjectionSha256: publicProjectionDigest(projection),
    journalEvents: events.length,
    privateRoutesEmitted: authoritative ? 0 : null,
    edgeRedirects: projection.reduce((sum, entry) => sum + entry.legacyPaths.length, 0),
    stateDigest: authoritative && ledger ? objectDigest(ledger) : null,
  },
}, null, 2));
