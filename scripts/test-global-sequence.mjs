import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  allocateSequence,
  appendJournalEvent,
  assertBootstrapMayInitialize,
  assertSecureDirectory,
  buildPublicProjection,
  clearLockTransfer,
  commitSequenceTransaction,
  compareAsciiBytes,
  createInitializationMarker,
  createJournalEvent,
  INITIALIZATION_FILENAME,
  inspectSequenceLock,
  LOCK_FILENAME,
  LOCK_TRANSFER_FILENAME,
  objectDigest,
  prepareSecureDirectory,
  readJournal,
  readJsonSecure,
  readLockTransfer,
  readPendingInitialization,
  readPendingTransaction,
  readPrivateLedger,
  reconcileInitialization,
  reconcilePendingTransaction,
  removeStaleSequenceLock,
  replayJournal,
  SequenceError,
  setSequenceVisibility,
  tombstoneSequence,
  validateLedger,
  validatePrivateBootstrapSidecar,
  validatePublicProjection,
  withSequenceLock,
  writePrivateLedger,
  writeNoReplaceFile,
  writePublicProjection,
} from './lib/global-sequence.mjs';
import {
  assertPreparedPublicIdentity,
  indexPreparedPublicContent,
  loadProjectionBackedPublicContent,
  projectedPublicSurface,
  selectProjectionBackedContent,
  validateProjectedPublicSurface,
} from './lib/public-content-preflight.mjs';
import { validateProjectedDistAssets } from './lib/public-dist-assets.mjs';

let fixtures = 0;
const pass = () => { fixtures += 1; };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expectCode = async (operation, code, forbidden = []) => {
  let caught;
  try { await operation(); }
  catch (error) { caught = error; }
  assert(caught instanceof SequenceError, `Expected SequenceError ${code}`);
  assert.equal(caught.code, code);
  for (const secret of forbidden) assert.equal(caught.message.includes(secret), false);
  pass();
};

const ledger = {
  schemaVersion: 1,
  allocationPolicy: 'test',
  bootstrap: {},
  generation: 0,
  nextSequence: 3,
  entries: [
    {
      globalSequence: 1,
      source: 'naver',
      sourceId: '101',
      visibility: 'public',
      publishedAt: '2020-01-01T00:00:00Z',
      status: 'active',
    },
    {
      globalSequence: 2,
      source: 'naver',
      sourceId: '102',
      visibility: 'private',
      publishedAt: '2020-01-02T00:00:00Z',
      status: 'active',
    },
  ],
};

validateLedger(ledger, { requireBootstrapDigests: false });
assert.equal(compareAsciiBytes('naver:z', 'tistory:a') < 0, true);
assert.deepEqual(buildPublicProjection(ledger).map((entry) => entry.globalSequence), [1]);
pass();

const publicAllocation = allocateSequence(ledger, {
  source: 'native',
  sourceId: 'backdated-public',
  visibility: 'public',
  publishedAt: '1990-01-01T00:00:00Z',
}, { requireBootstrapDigests: false });
assert.equal(publicAllocation.allocatedSequence, 3);
assert.equal(publicAllocation.ledger.generation, 1);
assert.deepEqual(publicAllocation.ledger.entries.map((entry) => entry.globalSequence), [1, 2, 3]);
pass();

const privateAllocation = allocateSequence(publicAllocation.ledger, {
  source: 'native',
  sourceId: 'private-new',
  visibility: 'private',
  publishedAt: '2030-01-01T00:00:00Z',
}, { requireBootstrapDigests: false });
assert.equal(privateAllocation.allocatedSequence, 4);
assert.equal(privateAllocation.ledger.nextSequence, 5);
pass();

const immutableBeforePromotion = ledger.entries[1];
const published = setSequenceVisibility(privateAllocation.ledger, {
  source: 'naver',
  sourceId: '102',
  visibility: 'public',
}, { requireBootstrapDigests: false });
assert.equal(published.globalSequence, 2);
assert.equal(published.ledger.entries[1].globalSequence, immutableBeforePromotion.globalSequence);
assert.equal(published.ledger.entries[1].publishedAt, immutableBeforePromotion.publishedAt);
assert.equal(published.ledger.nextSequence, 5);
assert.deepEqual(buildPublicProjection(published.ledger).map((entry) => entry.globalSequence), [1, 2, 3]);
pass();

await expectCode(() => setSequenceVisibility(published.ledger, {
  source: 'naver', sourceId: '101', visibility: 'private',
}, { requireBootstrapDigests: false }), 'SEQ_E_PUBLIC_RETRACTION_POLICY');

const tombstoned = tombstoneSequence(published.ledger, {
  source: 'native', sourceId: 'backdated-public',
}, { requireBootstrapDigests: false });
assert.equal(tombstoned.globalSequence, 3);
assert.equal(tombstoned.ledger.nextSequence, 5);
assert.equal(tombstoned.ledger.entries[2].status, 'tombstone');
assert.deepEqual(buildPublicProjection(tombstoned.ledger).map((entry) => entry.globalSequence), [1, 2]);
validatePublicProjection(buildPublicProjection(tombstoned.ledger), tombstoned.ledger);
pass();

const contentRows = [
  { source: 'naver', sourceId: '101', draft: false },
  { source: 'naver', sourceId: '102', draft: false },
  { source: 'native', sourceId: 'backdated-public', draft: false },
];
assert.deepEqual(
  selectProjectionBackedContent(contentRows, buildPublicProjection(tombstoned.ledger)).map((row) => row.sourceId),
  ['101', '102'],
);
pass();

const preparedIndex = new Map([
  ['naver:102', [{ source: 'naver', sourceId: '102', draft: false, assetReferences: 2 }]],
]);
assert.equal(assertPreparedPublicIdentity(preparedIndex, { source: 'naver', sourceId: '102' }).assetReferences, 2);
pass();
await expectCode(() => Promise.resolve(assertPreparedPublicIdentity(new Map(), {
  source: 'naver', sourceId: '102',
})), 'SEQ_E_PROMOTION_CONTENT_NOT_READY');

await expectCode(() => Promise.resolve(selectProjectionBackedContent(
  [{ source: 'naver', sourceId: '101', draft: false }],
  buildPublicProjection(tombstoned.ledger),
)), 'SEQ_E_PUBLIC_CONTENT_PROJECTION');

const invalidAllocations = [
  [{ source: 'naver', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'naver', sourceId: undefined, visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'naver', sourceId: 123, visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'naver', sourceId: ' 123', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'naver', sourceId: '0', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'naver', sourceId: '01', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'native', sourceId: '../unsafe', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'native', sourceId: 'unsafe%2fpath', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'native', sourceId: 'bad\u0001id', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'native', sourceId: '.', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'native', sourceId: '..', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
  [{ source: 'native', sourceId: 'x'.repeat(161), visibility: 'public', publishedAt: '2040-01-01T00:00:00Z' }, 'SEQ_E_IDENTITY_SOURCE_ID'],
];
for (const [input, code] of invalidAllocations) {
  await expectCode(() => allocateSequence(ledger, input, { requireBootstrapDigests: false }), code);
}

await expectCode(() => allocateSequence(ledger, {
  source: 'naver', sourceId: '101', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z',
}, { requireBootstrapDigests: false }), 'SEQ_E_ALLOCATION_SOURCE_FROZEN');
await expectCode(() => allocateSequence(ledger, {
  source: 'tistory', sourceId: '200', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z',
}, { requireBootstrapDigests: false }), 'SEQ_E_ALLOCATION_SOURCE_FROZEN');
await expectCode(() => allocateSequence(publicAllocation.ledger, {
  source: 'native', sourceId: 'backdated-public', visibility: 'public', publishedAt: '2040-01-01T00:00:00Z',
}, { requireBootstrapDigests: false }), 'SEQ_E_IDENTITY_COLLISION');

const frozenNamespaceLedger = {
  schemaVersion: 1,
  allocationPolicy: 'synthetic-frozen-namespace',
  bootstrap: {},
  generation: 0,
  nextSequence: 598,
  entries: [
    ...Array.from({ length: 596 }, (_, index) => ({
      globalSequence: index + 1,
      source: 'native',
      sourceId: `bootstrap-${index + 1}`,
      visibility: 'private',
      publishedAt: '2020-01-01T00:00:00Z',
      status: 'active',
    })),
    {
      globalSequence: 597,
      source: 'naver',
      sourceId: '999999',
      visibility: 'private',
      publishedAt: '2040-01-01T00:00:00Z',
      status: 'active',
    },
  ],
};
await expectCode(() => Promise.resolve(validateLedger(frozenNamespaceLedger, {
  requireBootstrapDigests: false,
})), 'SEQ_E_ALLOCATION_SOURCE_FROZEN');

await expectCode(() => Promise.resolve(validatePublicProjection([{
  globalSequence: 404,
  source: 'tistory',
  sourceId: '404',
  canonicalPath: '/posts/404',
  legacyPaths: ['/404'],
}])), 'SEQ_E_ROUTE_COLLISION');

assert.equal(assertBootstrapMayInitialize({
  sealPresent: false,
  ledgerPresent: false,
  journalEventCount: 0,
  transactionPresent: false,
}), true);
pass();
await expectCode(() => Promise.resolve(assertBootstrapMayInitialize({
  sealPresent: true,
  ledgerPresent: false,
  journalEventCount: 1,
  transactionPresent: false,
})), 'SEQ_E_BOOTSTRAP_ALREADY_SEALED');
await expectCode(() => Promise.resolve(assertBootstrapMayInitialize({
  sealPresent: false,
  ledgerPresent: false,
  journalEventCount: 1,
  transactionPresent: false,
})), 'SEQ_E_BOOTSTRAP_HISTORY_CONFLICT');

const readOnlyModeFixture = await mkdtemp('/private/tmp/dwnc-sequence-mode-test-');
try {
  const sequenceDirectory = path.join(readOnlyModeFixture, 'sequence');
  await mkdir(sequenceDirectory, { mode: 0o755 });
  await chmod(sequenceDirectory, 0o755);
  const before = await lstat(sequenceDirectory);
  await expectCode(() => assertSecureDirectory(sequenceDirectory, { mode: 0o700 }), 'SEQ_E_FILE_MODE');
  const after = await lstat(sequenceDirectory);
  assert.equal(after.mode, before.mode);
  assert.equal(after.mtimeMs, before.mtimeMs);
  pass();
} finally {
  await rm(readOnlyModeFixture, { recursive: true, force: true });
}

async function writeSyntheticPublicProject(root) {
  const postRoot = path.join(root, 'src/data/posts');
  const naverRoot = path.join(postRoot, 'naver');
  const assetRoot = path.join(root, 'public/media/naver/102');
  await mkdir(path.join(postRoot, 'tistory'), { recursive: true });
  await mkdir(naverRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await mkdir(path.join(root, 'migration/source-inventory'), { recursive: true });
  const publicBody = [
    '<div class="naver-content naver-content--smarteditor-3">',
    '<img src="/media/naver/102/image.bin" srcset="/media/naver/102/srcset-a.bin 1x, /media/naver/102/srcset-b.bin 2x">',
    '<video src="/media/naver/102/video.bin" poster="/media/naver/102/poster.bin"></video>',
    '<a href="/media/naver/102/attachment.bin">fixture attachment</a>',
    '<input type="image" src="/media/naver/102/input.bin">',
    '<track src="/media/naver/102/track.bin" kind="captions">',
    '<table background="/media/naver/102/background.bin"><tr><td>fixture</td></tr></table>',
    '<style>@import "/media/naver/102/import.bin";</style>',
    '<span style="background-image:url(/media/naver/102/style.bin)">fixture</span>',
    '![fixture image](/media/naver/102/markdown.bin)',
    '[fixture reference][asset-ref]',
    '[asset-ref]: /media/naver/102/reference.bin',
    '</div>',
  ].join('\n');
  const privatePreparedRaw = [
    '---',
    'source: naver',
    'sourceId: "102"',
    'visibility: public',
    'canonicalPath: /naver/102',
    'cover: /media/naver/102/cover.bin',
    '---',
    publicBody,
    '',
  ].join('\n');
  const genesisRaw = [
    '---',
    'source: naver',
    'sourceId: "101"',
    'visibility: public',
    'canonicalPath: /naver/101',
    '---',
    '<div class="naver-content">genesis fixture</div>',
    '',
  ].join('\n');
  await writeFile(path.join(naverRoot, '101.md'), genesisRaw, { mode: 0o600 });
  const preparedFile = path.join(naverRoot, '102.md');
  await writeFile(preparedFile, privatePreparedRaw, { mode: 0o600 });
  const assetNames = [
    'attachment.bin', 'background.bin', 'cover.bin', 'image.bin', 'import.bin',
    'input.bin', 'markdown.bin', 'poster.bin', 'reference.bin', 'srcset-a.bin',
    'srcset-b.bin', 'style.bin', 'track.bin', 'video.bin',
  ];
  const assets = [];
  for (const name of assetNames) {
    const bytes = Buffer.from(`public-fixture-${name}`);
    await writeFile(path.join(assetRoot, name), bytes, { mode: 0o600 });
    assets.push({
      path: `/media/naver/102/${name}`,
      sha256: sha256(bytes),
      size: bytes.length,
      mime: 'application/octet-stream',
    });
  }
  await writeFile(
    path.join(root, 'migration/source-inventory/tistory-posts.json'),
    JSON.stringify({ posts: [] }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(root, 'migration/source-inventory/naver-public-posts.json'),
    JSON.stringify({ posts: [{ source_id: '101', images: [], videos: [], attachments: [] }] }),
    { mode: 0o600 },
  );
  const receiptFile = path.join(root, 'src/data/public-asset-receipts-v1.json');
  await writeFile(receiptFile, JSON.stringify({
    schemaVersion: 1,
    receipts: [{
      source: 'naver',
      sourceId: '102',
      contentSha256: sha256(privatePreparedRaw),
      assets,
    }],
  }), { mode: 0o600 });
  return {
    postRoot,
    naverRoot,
    assetRoot,
    preparedFile,
    privatePreparedRaw,
    receiptFile,
    assets,
    genesisIdentityEvidence: {
      tistory: 0,
      naver: 1,
      sha256: sha256('naver:101'),
    },
  };
}

const publicLifecycleFixture = await mkdtemp('/private/tmp/dwnc-public-lifecycle-test-');
try {
  const fixture = await writeSyntheticPublicProject(publicLifecycleFixture);
  const fixtureEvidence = { genesisIdentityEvidence: fixture.genesisIdentityEvidence };
  const indexFixture = () => indexPreparedPublicContent(publicLifecycleFixture, fixtureEvidence);
  const joinFixture = (projection) => loadProjectionBackedPublicContent(
    publicLifecycleFixture,
    projection,
    fixtureEvidence,
  );
  const archiveRoot = path.join(publicLifecycleFixture, 'private-archive');
  await mkdir(archiveRoot, { mode: 0o700 });
  const archiveSentinel = path.join(archiveRoot, 'immutable.bin');
  await writeFile(archiveSentinel, 'synthetic-private-archive-sentinel', { mode: 0o600 });
  const archiveBefore = await lstat(archiveSentinel);
  const archiveBeforeDigest = sha256(await readFile(archiveSentinel));

  const preparedIndex = await indexFixture();
  assert.equal(preparedIndex.get('naver:102')?.[0].assetReferences, fixture.assets.length);
  const initialProjection = buildPublicProjection(ledger);
  const initialJoined = await joinFixture(initialProjection);
  assert.deepEqual(initialJoined.map((row) => row.sourceId), ['101']);
  const initialSurface = projectedPublicSurface(initialJoined);
  assert.deepEqual(initialSurface, {
    canonicalPaths: ['/posts/1'],
    aliases: ['/naver/101'],
    searchPaths: ['/posts/1'],
    rssPaths: ['/posts/1'],
    sitemapPaths: ['/posts/1'],
  });
  assert.deepEqual(validateProjectedPublicSurface(initialJoined, initialSurface), {
    canonical: 1, aliases: 1, search: 1, rss: 1, sitemap: 1,
  });
  pass();

  const promoted = setSequenceVisibility(ledger, {
    source: 'naver', sourceId: '102', visibility: 'public',
  }, { requireBootstrapDigests: false });
  const promotedJoined = await joinFixture(buildPublicProjection(promoted.ledger));
  assert.deepEqual(promotedJoined.map((row) => row.globalSequence), [1, 2]);
  assert.equal(promoted.ledger.nextSequence, ledger.nextSequence);
  const promotedSurface = projectedPublicSurface(promotedJoined);
  assert.deepEqual(promotedSurface.canonicalPaths, ['/posts/1', '/posts/2']);
  assert.deepEqual(validateProjectedPublicSurface(promotedJoined, promotedSurface), {
    canonical: 2, aliases: 2, search: 2, rss: 2, sitemap: 2,
  });
  assert.equal(sha256(await readFile(archiveSentinel)), archiveBeforeDigest);
  assert.equal((await lstat(archiveSentinel)).mtimeMs, archiveBefore.mtimeMs);
  pass();

  const syntheticDist = path.join(publicLifecycleFixture, 'dist');
  for (const row of promotedJoined) {
    for (const evidence of row.assetEvidence) {
      const sourceFile = path.join(publicLifecycleFixture, 'public', evidence.path.replace(/^\/+/, ''));
      const distFile = path.join(syntheticDist, evidence.path.replace(/^\/+/, ''));
      await mkdir(path.dirname(distFile), { recursive: true });
      await writeFile(distFile, await readFile(sourceFile), { mode: 0o600 });
    }
  }
  const distAssetReport = await validateProjectedDistAssets(syntheticDist, promotedJoined);
  assert.equal(distAssetReport.total, fixture.assets.length);
  assert.equal(distAssetReport.bySource.naver, fixture.assets.length);
  pass();

  const syntheticDistAsset = path.join(syntheticDist, 'media/naver/102/image.bin');
  const syntheticDistAssetBytes = await readFile(syntheticDistAsset);
  await rm(syntheticDistAsset);
  await expectCode(() => validateProjectedDistAssets(syntheticDist, promotedJoined), 'SEQ_E_DIST_ASSET_MISSING');
  await writeFile(syntheticDistAsset, syntheticDistAssetBytes, { mode: 0o600 });
  const corruptDistAssetBytes = Buffer.from(syntheticDistAssetBytes);
  corruptDistAssetBytes[0] ^= 0xff;
  await writeFile(syntheticDistAsset, corruptDistAssetBytes, { mode: 0o600 });
  await expectCode(() => validateProjectedDistAssets(syntheticDist, promotedJoined), 'SEQ_E_DIST_ASSET_SHA256');
  await writeFile(syntheticDistAsset, syntheticDistAssetBytes, { mode: 0o600 });

  const htmlMimeRows = structuredClone(promotedJoined);
  const htmlEvidence = htmlMimeRows.find((row) => row.sourceId === '102').assetEvidence
    .find((evidence) => evidence.path.endsWith('/attachment.bin'));
  htmlEvidence.mime = 'text/html';
  await expectCode(() => validateProjectedDistAssets(syntheticDist, htmlMimeRows), 'SEQ_E_DIST_ASSET_HTML');

  const signatureMimeRows = structuredClone(promotedJoined);
  const signatureMimeEvidence = signatureMimeRows.find((row) => row.sourceId === '102').assetEvidence
    .find((evidence) => evidence.path.endsWith('/image.bin'));
  signatureMimeEvidence.mime = 'image/png';
  await expectCode(() => validateProjectedDistAssets(syntheticDist, signatureMimeRows), 'SEQ_E_DIST_ASSET_MIME');

  const removed = tombstoneSequence(promoted.ledger, {
    source: 'naver', sourceId: '102',
  }, { requireBootstrapDigests: false });
  const removedJoined = await joinFixture(buildPublicProjection(removed.ledger));
  const removedSurface = projectedPublicSurface(removedJoined);
  assert.equal(removed.ledger.entries[1].globalSequence, 2);
  assert.equal(removed.ledger.nextSequence, ledger.nextSequence);
  assert.equal(JSON.stringify(removedSurface).includes('/posts/2'), false);
  assert.equal(JSON.stringify(removedSurface).includes('/naver/102'), false);
  await expectCode(() => Promise.resolve(validateProjectedPublicSurface(
    removedJoined,
    promotedSurface,
  )), 'SEQ_E_PUBLIC_SURFACE');
  assert.deepEqual(validateProjectedPublicSurface(removedJoined, removedSurface), {
    canonical: 1, aliases: 1, search: 1, rss: 1, sitemap: 1,
  });
  assert.equal(sha256(await readFile(archiveSentinel)), archiveBeforeDigest);
  pass();

  const missingAsset = path.join(fixture.assetRoot, 'image.bin');
  const missingAssetBytes = await readFile(missingAsset);
  await rm(missingAsset);
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_MISSING');
  await writeFile(missingAsset, missingAssetBytes, { mode: 0o600 });

  await writeFile(missingAsset, 'tampered-public-fixture', { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_HASH');
  await writeFile(missingAsset, missingAssetBytes, { mode: 0o600 });

  const originalPrepared = await readFile(fixture.preparedFile, 'utf8');
  await writeFile(fixture.preparedFile, originalPrepared.replace(
    '/media/naver/102/image.bin',
    '/media/../outside.bin',
  ), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_PATH');
  await writeFile(fixture.preparedFile, originalPrepared, { mode: 0o600 });

  await writeFile(fixture.preparedFile, originalPrepared.replace(
    'src="/media/naver/102/image.bin"',
    'src={"/media/naver/102/image.bin"}',
  ), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_PATH');
  await writeFile(fixture.preparedFile, originalPrepared, { mode: 0o600 });

  await writeFile(fixture.preparedFile, originalPrepared.replace(
    '<img src="/media/naver/102/image.bin"',
    '<object data="/media/naver/102/image.bin"',
  ), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_ACTIVE_EMBED');
  await writeFile(fixture.preparedFile, originalPrepared, { mode: 0o600 });

  await writeFile(fixture.preparedFile, originalPrepared.replace(
    '<img src="/media/naver/102/image.bin"',
    '<embed src="/media/naver/102/image.bin"',
  ), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_ACTIVE_EMBED');
  await writeFile(fixture.preparedFile, originalPrepared, { mode: 0o600 });

  await writeFile(fixture.preparedFile, originalPrepared.replace(
    '/media/naver/102/image.bin',
    '&#47;media/naver/102/image.bin',
  ), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_PATH');
  await writeFile(fixture.preparedFile, originalPrepared, { mode: 0o600 });

  const originalReceipt = await readFile(fixture.receiptFile, 'utf8');
  await writeFile(fixture.receiptFile, JSON.stringify({ schemaVersion: 1, receipts: [] }), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_RECEIPT_REQUIRED');
  await writeFile(fixture.receiptFile, originalReceipt, { mode: 0o600 });

  const genesisInventoryFile = path.join(
    publicLifecycleFixture,
    'migration/source-inventory/naver-public-posts.json',
  );
  const originalGenesisInventory = await readFile(genesisInventoryFile, 'utf8');
  const injectedGenesisInventory = JSON.parse(originalGenesisInventory);
  injectedGenesisInventory.posts.push({
    source_id: '102', images: [], videos: [], attachments: [],
  });
  await writeFile(genesisInventoryFile, JSON.stringify(injectedGenesisInventory), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_GENESIS');
  await writeFile(genesisInventoryFile, originalGenesisInventory, { mode: 0o600 });

  const orphanReceiptDocument = JSON.parse(originalReceipt);
  orphanReceiptDocument.receipts.push({
    source: 'native',
    sourceId: 'orphan-receipt',
    contentSha256: 'a'.repeat(64),
    assets: [],
  });
  await writeFile(fixture.receiptFile, JSON.stringify(orphanReceiptDocument), { mode: 0o600 });
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_ASSET_RECEIPT_ORPHAN');
  await writeFile(fixture.receiptFile, originalReceipt, { mode: 0o600 });

  const assetSymlink = path.join(fixture.assetRoot, 'image.bin');
  await rm(assetSymlink);
  await symlink(path.join(fixture.assetRoot, 'cover.bin'), assetSymlink);
  await expectCode(indexFixture, 'SEQ_E_FILE_SYMLINK');
  await rm(assetSymlink);
  await writeFile(assetSymlink, missingAssetBytes, { mode: 0o600 });

  await rm(assetSymlink);
  await link(path.join(fixture.assetRoot, 'cover.bin'), assetSymlink);
  await expectCode(indexFixture, 'SEQ_E_FILE_HARDLINK');
  await rm(assetSymlink);
  await rm(path.join(fixture.assetRoot, 'cover.bin'));
  await writeFile(path.join(fixture.assetRoot, 'cover.bin'), Buffer.from('public-fixture-cover.bin'), { mode: 0o600 });
  await writeFile(assetSymlink, missingAssetBytes, { mode: 0o600 });

  const heldAssetRoot = `${fixture.assetRoot}-held`;
  await import('node:fs/promises').then(({ rename }) => rename(fixture.assetRoot, heldAssetRoot));
  await symlink(heldAssetRoot, fixture.assetRoot);
  await expectCode(indexFixture, 'SEQ_E_ANCESTOR_SYMLINK');
  await rm(fixture.assetRoot);
  await import('node:fs/promises').then(({ rename }) => rename(heldAssetRoot, fixture.assetRoot));

  const preparedLink = path.join(fixture.naverRoot, '102-link.md');
  await symlink(fixture.preparedFile, preparedLink);
  await expectCode(indexFixture, 'SEQ_E_FILE_SYMLINK');
  await rm(preparedLink);

  const preparedHardlink = path.join(fixture.naverRoot, '102-hardlink.md');
  await link(fixture.preparedFile, preparedHardlink);
  await expectCode(indexFixture, 'SEQ_E_PUBLIC_CONTENT_PATH');
  await rm(preparedHardlink);

  const heldNaverRoot = `${fixture.naverRoot}-held`;
  await import('node:fs/promises').then(({ rename }) => rename(fixture.naverRoot, heldNaverRoot));
  await symlink(heldNaverRoot, fixture.naverRoot);
  await expectCode(indexFixture, 'SEQ_E_FILE_SYMLINK');
  await rm(fixture.naverRoot);
  await import('node:fs/promises').then(({ rename }) => rename(heldNaverRoot, fixture.naverRoot));

  const heldPostRoot = `${fixture.postRoot}-held`;
  await import('node:fs/promises').then(({ rename }) => rename(fixture.postRoot, heldPostRoot));
  await symlink(heldPostRoot, fixture.postRoot);
  await expectCode(indexFixture, 'SEQ_E_FILE_SYMLINK');
  await rm(fixture.postRoot);
  await import('node:fs/promises').then(({ rename }) => rename(heldPostRoot, fixture.postRoot));
  pass();
} finally {
  await rm(publicLifecycleFixture, { recursive: true, force: true });
}

const syntheticPrivateEntries = Array.from({ length: 247 }, (_, index) => ({
  source: 'naver',
  sourceId: String(10_000 + index),
  visibility: 'private',
  publishedAt: '2020-01-01T00:00:00Z',
  canonicalPath: `/naver/${10_000 + index}`,
}));
const forbiddenPrivateMetadata = {
  schemaVersion: 1,
  kind: 'private-bootstrap-metadata',
  entries: syntheticPrivateEntries.map((entry, index) => (
    index === 0 ? { ...entry, title: 'SECRET_FIXTURE_TITLE' } : entry
  )),
};
await expectCode(() => Promise.resolve(validatePrivateBootstrapSidecar(forbiddenPrivateMetadata)),
  'SEQ_E_PRIVATE_METADATA_SCHEMA', ['SECRET_FIXTURE_TITLE', '/private/secret/path']);

async function createTransactionFixture(baseLedger) {
  const directory = await mkdtemp('/private/tmp/dwnc-sequence-transaction-test-');
  const privateDirectory = path.join(directory, 'state');
  const ledgerFile = path.join(privateDirectory, 'ledger.json');
  const projectionFile = path.join(directory, 'projection.json');
  const journalDirectory = path.join(privateDirectory, 'events');
  const transactionFile = path.join(privateDirectory, 'transaction.json');
  await prepareSecureDirectory(privateDirectory, { mode: 0o700 });
  await prepareSecureDirectory(journalDirectory, { mode: 0o700 });
  const projection = buildPublicProjection(baseLedger);
  await writePrivateLedger(ledgerFile, baseLedger, {
    expectedRawDigest: null, allowMissing: true, requireBootstrapDigests: false,
  });
  await writePublicProjection(projectionFile, projection, {
    expectedRawDigest: null, allowMissing: true,
  });
  const genesisEvent = createJournalEvent({
    afterLedger: baseLedger,
    afterProjection: projection,
    operation: { type: 'genesis' },
    requireBootstrapDigests: false,
  });
  await appendJournalEvent(journalDirectory, genesisEvent);
  return {
    directory,
    privateDirectory,
    ledgerFile,
    projectionFile,
    journalDirectory,
    transactionFile,
    projection,
    genesisEvent,
  };
}

async function removeTransactionFixture(fixture) {
  await chmod(fixture.directory, 0o700).catch(() => {});
  await rm(fixture.directory, { recursive: true, force: true });
}

async function exerciseTransactionFault({ mode, faultPoint }) {
  const fixture = await createTransactionFixture(ledger);
  try {
    const result = mode === 'publish'
      ? allocateSequence(ledger, {
        source: 'native', sourceId: 'transaction-public', visibility: 'public', publishedAt: '2041-01-01T00:00:00Z',
      }, { requireBootstrapDigests: false })
      : tombstoneSequence(ledger, { source: 'naver', sourceId: '101' }, { requireBootstrapDigests: false });
    const operation = mode === 'publish'
      ? {
        type: 'allocate', source: 'native', sourceId: 'transaction-public', visibility: 'public',
        publishedAt: '2041-01-01T00:00:00Z', allocatedSequence: result.allocatedSequence,
      }
      : {
        type: 'tombstone', source: 'naver', sourceId: '101', fromStatus: result.previousStatus,
        globalSequence: result.globalSequence,
      };
    await assert.rejects(commitSequenceTransaction({
      directory: fixture.privateDirectory,
      ledgerFile: fixture.ledgerFile,
      projectionFile: fixture.projectionFile,
      journalDirectory: fixture.journalDirectory,
      transactionFile: fixture.transactionFile,
      beforeLedger: ledger,
      beforeProjection: fixture.projection,
      afterLedger: result.ledger,
      operation,
      previousEvent: fixture.genesisEvent,
      requireBootstrapDigests: false,
      faultInjector: async (point) => {
        if (point === faultPoint) throw new Error(`FAULT_${mode}_${faultPoint}`);
      },
    }), new RegExp(`FAULT_${mode}_${faultPoint}`));

    const intermediateLedger = await readPrivateLedger(fixture.ledgerFile, { requireBootstrapDigests: false });
    const intermediateProjection = await readJsonSecure(fixture.projectionFile, { mode: 0o644 });
    validatePublicProjection(intermediateProjection);
    const projectedIdentities = new Set(intermediateProjection.map((entry) => `${entry.source}:${entry.sourceId}`));
    if (mode === 'publish' && projectedIdentities.has('native:transaction-public')) {
      const ledgerEntry = intermediateLedger.entries.find((entry) => entry.source === 'native' && entry.sourceId === 'transaction-public');
      assert.equal(ledgerEntry?.visibility, 'public');
      assert.equal(ledgerEntry?.status, 'active');
    }
    if (mode === 'tombstone' && projectedIdentities.has('naver:101')) {
      const ledgerEntry = intermediateLedger.entries.find((entry) => entry.source === 'naver' && entry.sourceId === '101');
      assert.equal(ledgerEntry?.status, 'active');
    }
    const recovered = await reconcilePendingTransaction({
      directory: fixture.privateDirectory,
      ledgerFile: fixture.ledgerFile,
      projectionFile: fixture.projectionFile,
      journalDirectory: fixture.journalDirectory,
      transactionFile: fixture.transactionFile,
      requireBootstrapDigests: false,
    });
    assert.equal(objectDigest(recovered.ledger), objectDigest(result.ledger));
    assert.equal(objectDigest(recovered.projection), objectDigest(buildPublicProjection(result.ledger)));
    assert.equal(await readPendingTransaction(fixture.transactionFile, {
      requireBootstrapDigests: false,
    }), null);
    assert.equal((await readJournal(fixture.journalDirectory)).length, 2);
    pass();
  } finally {
    await removeTransactionFixture(fixture);
  }
}

for (const mode of ['publish', 'tombstone']) {
  for (const faultPoint of ['after-marker', 'after-journal', 'after-first-state', 'after-second-state', 'before-cleanup']) {
    await exerciseTransactionFault({ mode, faultPoint });
  }
}

const conflictFixture = await createTransactionFixture(ledger);
try {
  const result = allocateSequence(ledger, {
    source: 'native', sourceId: 'transaction-conflict', visibility: 'private', publishedAt: '2042-01-01T00:00:00Z',
  }, { requireBootstrapDigests: false });
  await assert.rejects(commitSequenceTransaction({
    directory: conflictFixture.privateDirectory,
    ledgerFile: conflictFixture.ledgerFile,
    projectionFile: conflictFixture.projectionFile,
    journalDirectory: conflictFixture.journalDirectory,
    transactionFile: conflictFixture.transactionFile,
    beforeLedger: ledger,
    beforeProjection: conflictFixture.projection,
    afterLedger: result.ledger,
    operation: {
      type: 'allocate', source: 'native', sourceId: 'transaction-conflict', visibility: 'private',
      publishedAt: '2042-01-01T00:00:00Z', allocatedSequence: result.allocatedSequence,
    },
    previousEvent: conflictFixture.genesisEvent,
    requireBootstrapDigests: false,
    faultInjector: async (point) => {
      if (point === 'after-marker') throw new Error('FAULT_CONFLICT');
    },
  }), /FAULT_CONFLICT/);
  await writePublicProjection(conflictFixture.projectionFile, [], { allowMissing: false });
  await expectCode(() => reconcilePendingTransaction({
    directory: conflictFixture.privateDirectory,
    ledgerFile: conflictFixture.ledgerFile,
    projectionFile: conflictFixture.projectionFile,
    journalDirectory: conflictFixture.journalDirectory,
    transactionFile: conflictFixture.transactionFile,
    requireBootstrapDigests: false,
  }), 'SEQ_E_STATE_HASH_CONFLICT');
} finally {
  await removeTransactionFixture(conflictFixture);
}

const operationMismatchFixture = await createTransactionFixture(ledger);
try {
  const result = allocateSequence(ledger, {
    source: 'native', sourceId: 'transaction-intended', visibility: 'private', publishedAt: '2043-01-01T00:00:00Z',
  }, { requireBootstrapDigests: false });
  await expectCode(() => commitSequenceTransaction({
    directory: operationMismatchFixture.privateDirectory,
    ledgerFile: operationMismatchFixture.ledgerFile,
    projectionFile: operationMismatchFixture.projectionFile,
    journalDirectory: operationMismatchFixture.journalDirectory,
    transactionFile: operationMismatchFixture.transactionFile,
    beforeLedger: ledger,
    beforeProjection: operationMismatchFixture.projection,
    afterLedger: result.ledger,
    operation: {
      type: 'allocate', source: 'native', sourceId: 'transaction-other', visibility: 'private',
      publishedAt: '2043-01-01T00:00:00Z', allocatedSequence: result.allocatedSequence,
    },
    previousEvent: operationMismatchFixture.genesisEvent,
    requireBootstrapDigests: false,
  }), 'SEQ_E_JOURNAL_STATE');
  assert.equal(await readPendingTransaction(operationMismatchFixture.transactionFile, {
    requireBootstrapDigests: false,
  }), null);
  assert.equal((await readJournal(operationMismatchFixture.journalDirectory)).length, 1);
  pass();
} finally {
  await removeTransactionFixture(operationMismatchFixture);
}

const temporary = await mkdtemp('/private/tmp/dwnc-sequence-self-test-');
try {
  const privateDirectory = path.join(temporary, 'state');
  const ledgerFile = path.join(privateDirectory, 'ledger.json');
  const projectionFile = path.join(temporary, 'projection.json');
  const journalDirectory = path.join(privateDirectory, 'events');
  const transactionFile = path.join(privateDirectory, 'transaction.json');
  await prepareSecureDirectory(privateDirectory, { mode: 0o700 });
  await prepareSecureDirectory(journalDirectory, { mode: 0o700 });
  await writePrivateLedger(ledgerFile, ledger, {
    expectedRawDigest: null, allowMissing: true, requireBootstrapDigests: false,
  });
  await writePublicProjection(projectionFile, buildPublicProjection(ledger), {
    expectedRawDigest: null, allowMissing: true,
  });

  const beforeRead = await lstat(ledgerFile);
  const beforeReadDirectory = await lstat(privateDirectory);
  await readPrivateLedger(ledgerFile, { requireBootstrapDigests: false });
  const afterRead = await lstat(ledgerFile);
  const afterReadDirectory = await lstat(privateDirectory);
  assert.equal(beforeRead.mode, afterRead.mode);
  assert.equal(beforeRead.mtimeMs, afterRead.mtimeMs);
  assert.equal(beforeReadDirectory.mode, afterReadDirectory.mode);
  assert.equal(beforeReadDirectory.mtimeMs, afterReadDirectory.mtimeMs);
  pass();

  const missingParent = path.join(temporary, 'does-not-exist');
  await expectCode(() => readPrivateLedger(path.join(missingParent, 'ledger.json'), {
    requireBootstrapDigests: false,
  }), 'SEQ_E_PATH_MISSING');
  await assert.rejects(lstat(missingParent), { code: 'ENOENT' });
  pass();

  const linkedParent = path.join(temporary, 'linked-state');
  await symlink(privateDirectory, linkedParent);
  const targetBefore = await lstat(ledgerFile);
  await expectCode(() => readPrivateLedger(path.join(linkedParent, 'ledger.json'), {
    requireBootstrapDigests: false,
  }), 'SEQ_E_ANCESTOR_SYMLINK', [linkedParent, 'secret-private-id']);
  const targetAfter = await lstat(ledgerFile);
  assert.equal(targetBefore.mtimeMs, targetAfter.mtimeMs);
  pass();
  await expectCode(() => writePrivateLedger(path.join(linkedParent, 'ledger.json'), ledger, {
    requireBootstrapDigests: false,
  }), 'SEQ_E_ANCESTOR_SYMLINK');
  assert.equal((await lstat(ledgerFile)).mtimeMs, targetAfter.mtimeMs);
  pass();

  const symlinkLeaf = path.join(privateDirectory, 'ledger-link.json');
  await symlink(ledgerFile, symlinkLeaf);
  await expectCode(() => readPrivateLedger(symlinkLeaf, {
    requireBootstrapDigests: false,
  }), 'SEQ_E_FILE_SYMLINK', [symlinkLeaf, 'secret-private-id']);
  await expectCode(() => writePrivateLedger(symlinkLeaf, ledger, {
    requireBootstrapDigests: false,
  }), 'SEQ_E_FILE_SYMLINK');

  const hardlinkLeaf = path.join(privateDirectory, 'ledger-hardlink.json');
  await link(ledgerFile, hardlinkLeaf);
  await expectCode(() => readPrivateLedger(ledgerFile, {
    requireBootstrapDigests: false,
  }), 'SEQ_E_FILE_HARDLINK', [hardlinkLeaf, 'secret-private-id']);
  await expectCode(() => writePrivateLedger(ledgerFile, ledger, {
    requireBootstrapDigests: false,
  }), 'SEQ_E_FILE_HARDLINK');
  await rm(hardlinkLeaf);

  await withSequenceLock(privateDirectory, async () => {
    await expectCode(() => withSequenceLock(privateDirectory, async () => {}), 'SEQ_E_LOCKED');
  });
  pass();

  const genesisProjection = buildPublicProjection(ledger);
  const genesisEvent = createJournalEvent({
    afterLedger: ledger,
    afterProjection: genesisProjection,
    operation: { type: 'genesis' },
    requireBootstrapDigests: false,
  });
  await appendJournalEvent(journalDirectory, genesisEvent);
  const nextResult = allocateSequence(ledger, {
    source: 'native', sourceId: 'transaction-private', visibility: 'private', publishedAt: '2041-01-01T00:00:00Z',
  }, { requireBootstrapDigests: false });
  const operation = {
    type: 'allocate', source: 'native', sourceId: 'transaction-private', visibility: 'private',
    publishedAt: '2041-01-01T00:00:00Z', allocatedSequence: nextResult.allocatedSequence,
  };
  let injected = false;
  await assert.rejects(commitSequenceTransaction({
    directory: privateDirectory,
    ledgerFile,
    projectionFile,
    journalDirectory,
    transactionFile,
    beforeLedger: ledger,
    beforeProjection: genesisProjection,
    afterLedger: nextResult.ledger,
    operation,
    previousEvent: genesisEvent,
    requireBootstrapDigests: false,
    faultInjector: async (point) => {
      if (point === 'after-journal') {
        injected = true;
        throw new Error('FAULT_INJECTED');
      }
    },
  }), /FAULT_INJECTED/);
  assert.equal(injected, true);
  assert.equal((await readPrivateLedger(ledgerFile, { requireBootstrapDigests: false })).generation, 0);
  assert.equal((await readJournal(journalDirectory)).length, 2);
  const recovered = await reconcilePendingTransaction({
    directory: privateDirectory,
    ledgerFile,
    projectionFile,
    journalDirectory,
    transactionFile,
    requireBootstrapDigests: false,
  });
  assert.equal(recovered.ledger.generation, 1);
  assert.equal((await readPrivateLedger(ledgerFile, { requireBootstrapDigests: false })).nextSequence, 4);
  assert.equal(objectDigest(await readFile(projectionFile, 'utf8')).length, 64);
  pass();

  const immutableSealFile = path.join(privateDirectory, 'seal.json');
  await writeNoReplaceFile(immutableSealFile, '{"kind":"synthetic-seal"}\n', { mode: 0o600 });
  await expectCode(() => writeNoReplaceFile(immutableSealFile, '{"kind":"replacement"}\n', {
    mode: 0o600,
  }), 'SEQ_E_NO_REPLACE');
  const recoveredEvents = await readJournal(journalDirectory);
  await rm(ledgerFile);
  assert.equal(await readPrivateLedger(ledgerFile, {
    allowMissing: true,
    requireBootstrapDigests: false,
  }), null);
  await expectCode(() => Promise.resolve(assertBootstrapMayInitialize({
    sealPresent: true,
    ledgerPresent: false,
    journalEventCount: recoveredEvents.length,
    transactionPresent: false,
  })), 'SEQ_E_BOOTSTRAP_ALREADY_SEALED');
  const replayedAfterLoss = replayJournal(ledger, recoveredEvents, { requireBootstrapDigests: false });
  assert.equal(replayedAfterLoss.ledger.generation, 1);
  assert.equal(replayedAfterLoss.ledger.nextSequence, 4);
  await writePrivateLedger(ledgerFile, replayedAfterLoss.ledger, {
    expectedRawDigest: null,
    allowMissing: true,
    requireBootstrapDigests: false,
  });
  pass();
} finally {
  await chmod(temporary, 0o700).catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}

async function createInitializationFixture({ existingLedgerRaw = null } = {}) {
  const root = await mkdtemp('/private/tmp/dwnc-sequence-init-test-');
  const directory = path.join(root, 'state');
  const markerFile = path.join(directory, INITIALIZATION_FILENAME);
  const ledgerFile = path.join(directory, 'ledger.json');
  const projectionFile = path.join(root, 'projection.json');
  const sidecarFile = path.join(directory, 'sidecar.json');
  const journalDirectory = path.join(directory, 'events');
  const sealFile = path.join(directory, 'seal.json');
  await prepareSecureDirectory(directory, { mode: 0o700 });
  if (existingLedgerRaw !== null) await writeFile(ledgerFile, existingLedgerRaw, { mode: 0o600 });
  const projection = buildPublicProjection(ledger);
  const genesisEvent = createJournalEvent({
    afterLedger: ledger,
    afterProjection: projection,
    operation: { type: 'genesis' },
    requireBootstrapDigests: false,
  });
  const targetSidecar = { schemaVersion: 1, kind: 'synthetic-private-metadata', entries: [] };
  const targetSeal = { schemaVersion: 1, kind: 'synthetic-bootstrap-seal' };
  const marker = createInitializationMarker({
    operation: existingLedgerRaw === null ? 'bootstrap' : 'adopt-existing',
    beforeLedgerRawSha256: existingLedgerRaw === null ? null : sha256(existingLedgerRaw),
    beforeProjectionRawSha256: null,
    targetLedger: ledger,
    targetProjection: projection,
    targetSidecar,
    targetGenesisEvent: genesisEvent,
    targetSeal,
    requireBootstrapDigests: false,
  });
  await writeNoReplaceFile(markerFile, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  return {
    root,
    directory,
    markerFile,
    ledgerFile,
    projectionFile,
    sidecarFile,
    journalDirectory,
    sealFile,
    marker,
  };
}

async function reconcileSyntheticInitialization(fixture, faultInjector = async () => {}) {
  return reconcileInitialization({
    directory: fixture.directory,
    markerFile: fixture.markerFile,
    ledgerFile: fixture.ledgerFile,
    projectionFile: fixture.projectionFile,
    sidecarFile: fixture.sidecarFile,
    journalDirectory: fixture.journalDirectory,
    sealFile: fixture.sealFile,
    faultInjector,
    requireBootstrapDigests: false,
  });
}

for (const faultPoint of ['after-sidecar', 'after-journal', 'after-ledger', 'after-seal', 'after-projection', 'before-cleanup']) {
  const fixture = await createInitializationFixture();
  try {
    await assert.rejects(reconcileSyntheticInitialization(fixture, async (point) => {
      if (point === faultPoint) throw new Error(`INIT_FAULT_${faultPoint}`);
    }), new RegExp(`INIT_FAULT_${faultPoint}`));
    assert.equal((await readPendingInitialization(fixture.markerFile, {
      requireBootstrapDigests: false,
    }))?.initializationId, fixture.marker.initializationId);
    const recovered = await reconcileSyntheticInitialization(fixture);
    assert.equal(objectDigest(recovered.ledger), objectDigest(ledger));
    assert.equal(await readPendingInitialization(fixture.markerFile, {
      requireBootstrapDigests: false,
    }), null);
    assert.equal((await readJournal(fixture.journalDirectory)).length, 1);
    pass();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

const lostInitializationLedger = await createInitializationFixture();
try {
  await assert.rejects(reconcileSyntheticInitialization(lostInitializationLedger, async (point) => {
    if (point === 'after-seal') throw new Error('INIT_FAULT_AFTER_SEAL');
  }), /INIT_FAULT_AFTER_SEAL/);
  await rm(lostInitializationLedger.ledgerFile);
  const recovered = await reconcileSyntheticInitialization(lostInitializationLedger);
  assert.equal(objectDigest(recovered.ledger), objectDigest(ledger));
  assert.equal(objectDigest(await readPrivateLedger(lostInitializationLedger.ledgerFile, {
    requireBootstrapDigests: false,
  })), objectDigest(ledger));
  pass();
} finally {
  await rm(lostInitializationLedger.root, { recursive: true, force: true });
}

const adoptionInitialization = await createInitializationFixture({ existingLedgerRaw: '{"legacy":true}\n' });
try {
  await assert.rejects(reconcileSyntheticInitialization(adoptionInitialization, async (point) => {
    if (point === 'after-journal') throw new Error('INIT_ADOPTION_FAULT');
  }), /INIT_ADOPTION_FAULT/);
  await reconcileSyntheticInitialization(adoptionInitialization);
  assert.equal(objectDigest(await readPrivateLedger(adoptionInitialization.ledgerFile, {
    requireBootstrapDigests: false,
  })), objectDigest(ledger));
  pass();
} finally {
  await rm(adoptionInitialization.root, { recursive: true, force: true });
}

await expectCode(() => Promise.resolve(assertBootstrapMayInitialize({
  sealPresent: false,
  ledgerPresent: false,
  journalEventCount: 0,
  transactionPresent: false,
  initializationPresent: true,
})), 'SEQ_E_BOOTSTRAP_HISTORY_CONFLICT');

async function leaveHardExitLock(directory, observedGeneration = null) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), 'scripts/lib/global-sequence.mjs')).href;
  const source = [
    `import { withSequenceLock } from ${JSON.stringify(moduleUrl)};`,
    'const generation = process.argv[2] === "null" ? null : Number(process.argv[2]);',
    'await withSequenceLock(process.argv[1], async () => { process.exit(17); }, { observedGeneration: generation });',
  ].join('\n');
  const child = spawn(process.execPath, [
    '--input-type=module', '-e', source, directory, String(observedGeneration),
  ], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 17);
}

async function leaveHardExitAfterTransferReceipt(lockFile, token) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), 'scripts/lib/global-sequence.mjs')).href;
  const source = [
    `import { removeStaleSequenceLock } from ${JSON.stringify(moduleUrl)};`,
    'await removeStaleSequenceLock(process.argv[1], process.argv[2], {',
    '  staleAfterMs: 0,',
    '  processAlive: () => false,',
    '  afterTransferWrite: async () => { process.exit(23); },',
    '});',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, lockFile, token], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 23);
}

async function leaveHardExitTransferRecovery(directory, transferId, stage, stateFile) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), 'scripts/lib/global-sequence.mjs')).href;
  const source = [
    "import { writeFile } from 'node:fs/promises';",
    `import { withSequenceLock } from ${JSON.stringify(moduleUrl)};`,
    'const [directory, transferId, stage, stateFile] = process.argv.slice(1);',
    'await withSequenceLock(directory, async () => {',
    '  if (stateFile !== "-") await writeFile(stateFile, "reconciled\\n", { mode: 0o600 });',
    '}, {',
    '  lockTransferId: transferId,',
    '  afterAcquire: async () => { if (stage === "after-acquire") process.exit(24); },',
    '  afterOperationBeforeRelease: async () => { if (stage === "after-operation") process.exit(25); },',
    '});',
  ].join('\n');
  const child = spawn(process.execPath, [
    '--input-type=module', '-e', source, directory, transferId, stage, stateFile,
  ], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, stage === 'after-acquire' ? 24 : 25);
}

const staleLockFixture = await mkdtemp('/private/tmp/dwnc-sequence-stale-lock-test-');
try {
  const directory = path.join(staleLockFixture, 'state');
  await prepareSecureDirectory(directory, { mode: 0o700 });
  const lockFile = path.join(directory, LOCK_FILENAME);
  const transferFile = path.join(directory, LOCK_TRANSFER_FILENAME);
  await leaveHardExitLock(directory);
  const firstStatus = await inspectSequenceLock(lockFile, { staleAfterMs: 0 });
  assert.equal(firstStatus.present, true);
  assert.equal(firstStatus.ownerAlive, false);
  assert.equal(firstStatus.stale, true);
  pass();
  await expectCode(() => removeStaleSequenceLock(lockFile, '0'.repeat(40), {
    staleAfterMs: 0,
  }), 'SEQ_E_LOCK_TOKEN');
  await expectCode(() => removeStaleSequenceLock(lockFile, firstStatus.token, {
    staleAfterMs: 0,
    beforeUnlink: async () => {
      await rm(lockFile);
      await writeFile(lockFile, `${JSON.stringify({
        schemaVersion: 1,
        token: 'f'.repeat(40),
        pid: process.pid,
        createdAt: new Date().toISOString(),
        observedGeneration: null,
      })}\n`, { mode: 0o600 });
    },
    processAlive: () => false,
  }), 'SEQ_E_LOCK_REPLACED');
  const failedTransfer = await readLockTransfer(transferFile, { allowMissing: false });
  assert.equal((await inspectSequenceLock(lockFile, { staleAfterMs: 0, processAlive: () => false })).token, 'f'.repeat(40));
  await rm(lockFile);
  await clearLockTransfer(transferFile, failedTransfer.transferId);
  pass();

  await leaveHardExitLock(directory, 7);
  const secondStatus = await inspectSequenceLock(lockFile, { staleAfterMs: 0 });
  assert.equal(secondStatus.observedGeneration, 7);
  await leaveHardExitAfterTransferReceipt(lockFile, secondStatus.token);
  const pendingTransfer = await readLockTransfer(transferFile, { allowMissing: false });
  assert.equal((await inspectSequenceLock(lockFile, { staleAfterMs: 0 })).present, true);
  assert.equal(pendingTransfer.lockToken, secondStatus.token);
  assert.equal(pendingTransfer.lockObservedGeneration, 7);
  pass();

  const exactTransferRaw = await readFile(transferFile, 'utf8');
  const tamperedTransfer = JSON.parse(exactTransferRaw);
  tamperedTransfer.observedAt = new Date(Date.parse(tamperedTransfer.observedAt) + 1).toISOString();
  await writeFile(transferFile, `${JSON.stringify(tamperedTransfer, null, 2)}\n`, { mode: 0o600 });
  await expectCode(() => readLockTransfer(transferFile, { allowMissing: false }), 'SEQ_E_LOCK_TRANSFER_SCHEMA');
  assert.equal((await lstat(lockFile)).isFile(), true);
  assert.equal((await lstat(transferFile)).isFile(), true);
  await writeFile(transferFile, exactTransferRaw, { mode: 0o600 });

  await expectCode(() => removeStaleSequenceLock(lockFile, '0'.repeat(40), {
    staleAfterMs: 0,
  }), 'SEQ_E_LOCK_TOKEN');

  const exactLockRaw = await readFile(lockFile, 'utf8');
  const wrongGenerationLock = JSON.parse(exactLockRaw);
  wrongGenerationLock.observedGeneration = 8;
  await writeFile(lockFile, `${JSON.stringify(wrongGenerationLock, null, 2)}\n`, { mode: 0o600 });
  await expectCode(() => removeStaleSequenceLock(lockFile, secondStatus.token, {
    staleAfterMs: 0,
  }), 'SEQ_E_LOCK_REPLACED');
  assert.equal((await lstat(lockFile)).isFile(), true);
  assert.equal((await lstat(transferFile)).isFile(), true);
  await writeFile(lockFile, exactLockRaw, { mode: 0o600 });

  await writeFile(lockFile, `${exactLockRaw.trimEnd()}  \n`, { mode: 0o600 });
  await expectCode(() => removeStaleSequenceLock(lockFile, secondStatus.token, {
    staleAfterMs: 0,
  }), 'SEQ_E_LOCK_REPLACED');
  assert.equal((await lstat(lockFile)).isFile(), true);
  assert.equal((await lstat(transferFile)).isFile(), true);
  await writeFile(lockFile, exactLockRaw, { mode: 0o600 });

  const removed = await removeStaleSequenceLock(lockFile, secondStatus.token, { staleAfterMs: 0 });
  assert.equal(removed.removed, true);
  assert.equal(removed.resumed, true);
  assert.equal((await readLockTransfer(transferFile, { allowMissing: false })).transferId, removed.transferId);
  const alreadyRemoved = await removeStaleSequenceLock(lockFile, secondStatus.token, { staleAfterMs: 0 });
  assert.equal(alreadyRemoved.removed, true);
  assert.equal(alreadyRemoved.resumed, true);
  pass();
  await expectCode(() => withSequenceLock(directory, async () => {}), 'SEQ_E_LOCK_TRANSFER_PENDING');
  await expectCode(() => clearLockTransfer(transferFile, '0'.repeat(40)), 'SEQ_E_LOCK_TRANSFER_TOKEN');
  const removedTransfer = await readLockTransfer(transferFile, { allowMissing: false });
  await withSequenceLock(directory, async () => {}, { lockTransferId: removed.transferId });
  await clearLockTransfer(transferFile, removed.transferId, {
    receiptSha256: removedTransfer.receiptSha256,
  });
  assert.equal(await readLockTransfer(transferFile), null);
  await withSequenceLock(directory, async () => {});
  pass();

  await leaveHardExitLock(directory, 9);
  const thirdStatus = await inspectSequenceLock(lockFile, { staleAfterMs: 0 });
  const originalRemoved = await removeStaleSequenceLock(lockFile, thirdStatus.token, { staleAfterMs: 0 });
  const recoveryTransfer = await readLockTransfer(transferFile, { allowMissing: false });
  assert.equal(recoveryTransfer.transferId, originalRemoved.transferId);
  assert.equal(recoveryTransfer.lockObservedGeneration, 9);
  pass();

  await leaveHardExitTransferRecovery(directory, recoveryTransfer.transferId, 'after-acquire', '-');
  const firstRecoveryLease = await inspectSequenceLock(lockFile, { staleAfterMs: 0 });
  assert.equal(firstRecoveryLease.kind, 'global-sequence-transfer-recovery');
  assert.equal(firstRecoveryLease.token, recoveryTransfer.recoveryToken);
  assert.equal(firstRecoveryLease.transferId, recoveryTransfer.transferId);
  assert.equal(firstRecoveryLease.receiptSha256, recoveryTransfer.receiptSha256);
  assert.equal(firstRecoveryLease.observedGeneration, 9);
  assert.equal(firstRecoveryLease.ownerAlive, false);
  pass();

  const linkedRetry = await removeStaleSequenceLock(lockFile, thirdStatus.token, { staleAfterMs: 0 });
  assert.equal(linkedRetry.linkedRecoveryLease, true);
  const exactRecoveryRaw = await readFile(lockFile, 'utf8');
  const foreignRecovery = JSON.parse(exactRecoveryRaw);
  foreignRecovery.receiptSha256 = 'f'.repeat(64);
  await writeFile(lockFile, `${JSON.stringify(foreignRecovery, null, 2)}\n`, { mode: 0o600 });
  await expectCode(() => withSequenceLock(directory, async () => {}, {
    lockTransferId: recoveryTransfer.transferId,
  }), 'SEQ_E_LOCKED');
  assert.equal((await lstat(lockFile)).isFile(), true);
  assert.equal((await lstat(transferFile)).isFile(), true);
  await writeFile(lockFile, exactRecoveryRaw, { mode: 0o600 });

  const reconciledState = path.join(directory, 'synthetic-reconciled-state');
  await leaveHardExitTransferRecovery(
    directory,
    recoveryTransfer.transferId,
    'after-operation',
    reconciledState,
  );
  assert.equal(await readFile(reconciledState, 'utf8'), 'reconciled\n');
  assert.equal((await inspectSequenceLock(lockFile, { staleAfterMs: 0 })).ownerAlive, false);
  pass();

  await withSequenceLock(directory, async ({ resumed }) => {
    assert.equal(resumed, true);
    assert.equal(await readFile(reconciledState, 'utf8'), 'reconciled\n');
  }, { lockTransferId: recoveryTransfer.transferId });
  assert.equal((await inspectSequenceLock(lockFile)).present, false);
  assert.equal((await readLockTransfer(transferFile, { allowMissing: false })).receiptSha256, recoveryTransfer.receiptSha256);
  await clearLockTransfer(transferFile, recoveryTransfer.transferId, {
    receiptSha256: recoveryTransfer.receiptSha256,
  });
  assert.equal(await readLockTransfer(transferFile), null);
  pass();
} finally {
  await rm(staleLockFixture, { recursive: true, force: true });
}

console.log(JSON.stringify({ fixtures, status: 'PASS' }, null, 2));
