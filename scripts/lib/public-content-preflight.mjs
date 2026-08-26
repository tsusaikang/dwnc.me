import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { parse as parseYaml } from 'yaml';
import {
  inspectRealPathChain,
  readSecureBytes,
  readSecureFile,
  SequenceError,
  validateSourceIdentityInput,
} from './global-sequence.mjs';
import {
  loadTrackedPublicMapLinkPolicy,
  removePolicyMapBlocks,
} from './public-map-link-policy.mjs';
import {
  applyPublicMediaCuration,
  containsUncuratedStickerMarkup,
  effectivePublicMediaPresentationData,
  loadTrackedPublicMediaCurationPolicy,
  publicMediaCurationExcludedAssets,
} from './public-media-curation.mjs';

const fail = (code) => { throw new SequenceError(code); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const PUBLIC_ASSET_RECEIPTS_PATH = 'src/data/public-asset-receipts-v1.json';
const PUBLIC_MEDIA_MANIFEST_PATH = 'src/data/public-media-r2-v1.json';
const GENESIS_PUBLIC_IDENTITIES_PATH = 'src/data/genesis-public-identities-v1.json';
const PUBLIC_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const GENESIS_PUBLIC_IDENTITY_SHA256 = '2190984504722fd7b8f4b5a0ac38ecf29948e4e18b9c890ad0a76f54f059ea69';
const DEFAULT_GENESIS_IDENTITY_EVIDENCE = Object.freeze({
  tistory: 164,
  naver: 185,
  sha256: GENESIS_PUBLIC_IDENTITY_SHA256,
});

function inside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

async function assertRealDirectory(directory) {
  const stats = await inspectRealPathChain(directory);
  if (!stats?.isDirectory()) fail('SEQ_E_PUBLIC_CONTENT_PATH');
  return stats;
}

async function walkRealFiles(directory, { optional = false, allowedRoot = directory } = {}) {
  if (!inside(allowedRoot, directory)) fail('SEQ_E_PUBLIC_CONTENT_PATH');
  let before;
  try { before = await assertRealDirectory(directory); }
  catch (error) {
    if (optional && error instanceof SequenceError && error.code === 'SEQ_E_PATH_MISSING') return [];
    if (error instanceof SequenceError) throw error;
    fail('SEQ_E_PUBLIC_CONTENT_READ');
  }
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { fail('SEQ_E_PUBLIC_CONTENT_READ'); }
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (!inside(allowedRoot, absolute)) fail('SEQ_E_PUBLIC_CONTENT_PATH');
    const stats = await inspectRealPathChain(absolute);
    if (stats.isDirectory()) files.push(...await walkRealFiles(absolute, { allowedRoot }));
    else if (stats.isFile() && stats.nlink === 1) files.push(absolute);
    else fail('SEQ_E_PUBLIC_CONTENT_PATH');
  }
  const after = await assertRealDirectory(directory);
  if (before.dev !== after.dev || before.ino !== after.ino) fail('SEQ_E_PUBLIC_CONTENT_RACE');
  return files;
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER');
  let data;
  try { data = parseYaml(match[1]); }
  catch { fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER');
  return { data, body: raw.slice(match[0].length) };
}

function expectedLegacyPath(source, sourceId) {
  if (source === 'tistory') return `/${sourceId}`;
  if (source === 'naver') return `/naver/${sourceId}`;
  return null;
}

function decodeReferenceEntities(value) {
  return String(value)
    .replace(/&quot;|&apos;|&amp;|&sol;/giu, (match) => ({
      '&quot;': '"', '&apos;': "'", '&amp;': '&', '&sol;': '/',
    })[match.toLowerCase()])
    .replace(/&#(\d+);/gu, (match, codePoint) => {
      try { return String.fromCodePoint(Number(codePoint)); } catch { return match; }
    })
    .replace(/&#x([a-f0-9]+);/giu, (match, codePoint) => {
      try { return String.fromCodePoint(Number.parseInt(codePoint, 16)); } catch { return match; }
    });
}

function addReference(references, value, kind) {
  if (typeof value !== 'string') return;
  const decodedValue = decodeReferenceEntities(value.trim());
  const candidate = decodedValue
    .replace(/^<|>$/g, '')
    .replace(/^(['"])([\s\S]*)\1$/u, '$2');
  if (!candidate || /^(?:data:|https?:|\/\/|#|mailto:|tel:|javascript:)/iu.test(candidate)) return;
  const withoutSuffix = candidate.split(/[?#]/u, 1)[0];
  if (!withoutSuffix) return;
  if (withoutSuffix.startsWith('/media/')) {
    references.add(withoutSuffix);
    return;
  }
  if (withoutSuffix.includes('/media/')) fail('SEQ_E_PUBLIC_ASSET_PATH');
  if (kind !== 'href' && (/^(?:\.\.?\/|media\/)/u.test(withoutSuffix) || withoutSuffix.startsWith('/'))) {
    fail('SEQ_E_PUBLIC_ASSET_PATH');
  }
}

export function collectRenderableLocalAssetReferences(data, body, {
  mapLinkPolicy = null,
  mediaCurationPolicy = null,
} = {}) {
  const references = new Set();
  let assetBody = body;
  if (mapLinkPolicy) {
    assetBody = removePolicyMapBlocks(body, data, mapLinkPolicy).html;
  } else {
    const mapCheck = cheerio.load(body, null, false);
    if (mapCheck('.se_component.se_map, .se-component.se-map, figure.tistory-map').length) {
      fail('SEQ_E_PUBLIC_MAP_POLICY');
    }
  }
  if (mediaCurationPolicy) {
    assetBody = applyPublicMediaCuration(assetBody, data, mediaCurationPolicy).html;
  } else if (containsUncuratedStickerMarkup(assetBody)) {
    fail('SEQ_E_PUBLIC_MEDIA_CURATION_POLICY');
  }
  const presentationData = mediaCurationPolicy
    ? effectivePublicMediaPresentationData(data, mediaCurationPolicy)
    : { cover: data?.cover };
  addReference(references, presentationData.cover, 'cover');
  const $ = cheerio.load(assetBody, null, false);
  if ($('object, embed').length) fail('SEQ_E_PUBLIC_ASSET_ACTIVE_EMBED');
  if (/(?:&#0*47;|&#x0*2f;|&sol;|\\u0*02f|\\x2f|\\\/)media(?:\/|\\|%2f)/iu.test(assetBody)
    || /\b(?:src|poster|href|data|background)\s*=\s*\{[^}]*\/media\//iu.test(assetBody)) {
    fail('SEQ_E_PUBLIC_ASSET_PATH');
  }
  $('*').each((_index, element) => {
    for (const attribute of ['src', 'poster', 'href', 'xlink:href', 'background']) {
      addReference(references, $(element).attr(attribute), attribute === 'href' ? 'href' : 'media');
    }
  });
  $('[srcset]').each((_index, element) => {
    for (const candidate of String($(element).attr('srcset') ?? '').split(',')) {
      addReference(references, candidate.trim().split(/\s+/u, 1)[0], 'media');
    }
  });
  $('[style]').each((_index, element) => {
    for (const match of String($(element).attr('style') ?? '').matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/giu)) {
      addReference(references, match[2], 'media');
    }
  });
  for (const match of assetBody.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/gu)) {
    addReference(references, match[1] ?? match[2], match[0].startsWith('!') ? 'media' : 'href');
  }
  for (const match of assetBody.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gmu)) {
    addReference(references, match[1] ?? match[2], 'href');
  }
  for (const match of assetBody.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/giu)) addReference(references, match[2], 'media');
  for (const match of assetBody.matchAll(/@import\s+(?!url\()(['"])(.*?)\1/giu)) {
    addReference(references, match[2], 'media');
  }
  for (const match of assetBody.matchAll(/<((?:\/media\/)[^>\s]+)>/giu)) addReference(references, match[1], 'media');
  return [...references].sort((left, right) => left.localeCompare(right, 'en'));
}

async function loadOptionalJson(file) {
  let raw;
  try { raw = await readSecureFile(file, { allowMissing: true }); }
  catch (error) {
    if (error instanceof SequenceError && error.code === 'SEQ_E_PATH_MISSING') return null;
    throw error;
  }
  if (raw === null) return null;
  try { return JSON.parse(raw); }
  catch { fail('SEQ_E_PUBLIC_ASSET_MANIFEST'); }
}

function addManifestAsset(index, publicPath, value) {
  if (typeof publicPath !== 'string'
    || !/^\/media\/[A-Za-z0-9._/-]+$/u.test(publicPath)
    || publicPath.includes('//') || publicPath.includes('/./') || publicPath.includes('/../')
    || publicPath.endsWith('/.') || publicPath.endsWith('/..') || publicPath.includes('\\')
    || publicPath.includes('%') || publicPath.normalize('NFC') !== publicPath
    || !/^[a-f0-9]{64}$/u.test(value?.sha256 ?? '')
    || !Number.isSafeInteger(value?.size) || value.size <= 0
    || typeof value?.mime !== 'string'
    || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value.mime)) {
    fail('SEQ_E_PUBLIC_ASSET_MANIFEST');
  }
  const existing = index.get(publicPath);
  if (existing && (existing.sha256 !== value.sha256
    || existing.size !== value.size
    || existing.mime !== value.mime)) fail('SEQ_E_PUBLIC_ASSET_MANIFEST');
  index.set(publicPath, value);
}

function identitySetDigest(identities) {
  return sha256([...identities]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .join('\n'));
}

export async function loadPublicAssetEvidence(root, {
  genesisIdentityEvidence = DEFAULT_GENESIS_IDENTITY_EVIDENCE,
} = {}) {
  const mapLinkPolicy = await loadTrackedPublicMapLinkPolicy(root, { allowMissing: true });
  const mapExcludedAssets = new Set(mapLinkPolicy?.excludedAssets ?? []);
  const mediaCurationPolicy = await loadTrackedPublicMediaCurationPolicy(root, { allowMissing: true });
  const curatedExcludedAssets = mediaCurationPolicy
    ? publicMediaCurationExcludedAssets(mediaCurationPolicy)
    : new Set();
  if (!genesisIdentityEvidence || typeof genesisIdentityEvidence !== 'object'
    || !Number.isSafeInteger(genesisIdentityEvidence.tistory)
    || genesisIdentityEvidence.tistory < 0
    || !Number.isSafeInteger(genesisIdentityEvidence.naver)
    || genesisIdentityEvidence.naver < 0
    || !/^[a-f0-9]{64}$/u.test(genesisIdentityEvidence.sha256 ?? '')) {
    fail('SEQ_E_PUBLIC_ASSET_GENESIS');
  }
  const receiptDocument = await loadOptionalJson(path.join(root, PUBLIC_ASSET_RECEIPTS_PATH))
    ?? { schemaVersion: 1, receipts: [] };
  if (receiptDocument.schemaVersion !== 1 || !Array.isArray(receiptDocument.receipts)) {
    fail('SEQ_E_PUBLIC_ASSET_RECEIPT');
  }
  const receiptIndex = new Map();
  const receiptAssets = new Map();
  for (const receipt of receiptDocument.receipts) {
    const validated = validateSourceIdentityInput(receipt);
    const key = `${validated.source}:${validated.sourceId}`;
    if (receiptIndex.has(key)
      || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || Object.keys(receipt).some((field) => !['source', 'sourceId', 'contentSha256', 'assets'].includes(field))
      || Object.keys(receipt).length !== 4
      || !/^[a-f0-9]{64}$/u.test(receipt.contentSha256 ?? '')
      || !Array.isArray(receipt.assets)) fail('SEQ_E_PUBLIC_ASSET_RECEIPT');
    const assets = new Map();
    for (const asset of receipt.assets) {
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)
        || Object.keys(asset).some((field) => !['path', 'sha256', 'size', 'mime'].includes(field))
        || Object.keys(asset).length !== 4
        || typeof asset.path !== 'string' || !/^\/media\//u.test(asset.path)
        || !/^[a-f0-9]{64}$/u.test(asset.sha256 ?? '')
        || !Number.isSafeInteger(asset.size) || asset.size <= 0
        || typeof asset.mime !== 'string'
        || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(asset.mime.trim())
        || assets.has(asset.path)) fail('SEQ_E_PUBLIC_ASSET_RECEIPT');
      const evidence = {
        sha256: asset.sha256,
        size: asset.size,
        mime: asset.mime.trim().toLowerCase(),
      };
      assets.set(asset.path, evidence);
      const existing = receiptAssets.get(asset.path);
      if (existing && (existing.sha256 !== evidence.sha256
        || existing.size !== evidence.size || existing.mime !== evidence.mime)) {
        fail('SEQ_E_PUBLIC_ASSET_RECEIPT');
      }
      receiptAssets.set(asset.path, evidence);
    }
    receiptIndex.set(key, { ...receipt, assets });
  }

  // The tracked public media manifest is the build-safe evidence available in a
  // fresh checkout. Imported inventories remain preservation evidence, but are
  // intentionally not a build dependency because they are local and ignored.
  const mediaDocument = await loadOptionalJson(path.join(root, PUBLIC_MEDIA_MANIFEST_PATH));
  const manifestKeys = [
    'schemaVersion', 'contract', 'keyRule', 'objectCount', 'totalBytes',
    'manifestSha256', 'entries',
  ];
  if (!mediaDocument || typeof mediaDocument !== 'object' || Array.isArray(mediaDocument)
    || Object.keys(mediaDocument).length !== manifestKeys.length
    || Object.keys(mediaDocument).some((key) => !manifestKeys.includes(key))
    || mediaDocument.schemaVersion !== 1
    || mediaDocument.contract !== 'dwnc-public-media-r2-v1'
    || mediaDocument.keyRule !== 'publicPath.slice(1)'
    || !Array.isArray(mediaDocument.entries)
    || !Number.isSafeInteger(mediaDocument.objectCount)
    || !Number.isSafeInteger(mediaDocument.totalBytes)
    || !/^[a-f0-9]{64}$/u.test(mediaDocument.manifestSha256 ?? '')) {
    fail('SEQ_E_PUBLIC_ASSET_MANIFEST');
  }
  const index = new Map();
  let totalBytes = 0;
  let previousPath = null;
  for (const entry of mediaDocument.entries) {
    const entryKeys = ['publicPath', 'key', 'size', 'sha256', 'contentType', 'cacheControl'];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).length !== entryKeys.length
      || Object.keys(entry).some((key) => !entryKeys.includes(key))
      || entry.key !== String(entry.publicPath ?? '').slice(1)
      || entry.cacheControl !== PUBLIC_MEDIA_CACHE_CONTROL
      || typeof entry.contentType !== 'string'
      || entry.contentType !== entry.contentType.toLowerCase()
      || previousPath !== null
        && Buffer.compare(Buffer.from(previousPath), Buffer.from(entry.publicPath ?? '')) >= 0) {
      fail('SEQ_E_PUBLIC_ASSET_MANIFEST');
    }
    addManifestAsset(index, entry.publicPath, {
      sha256: entry.sha256, size: entry.size, mime: entry.contentType,
    });
    totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes)) fail('SEQ_E_PUBLIC_ASSET_MANIFEST');
    previousPath = entry.publicPath;
  }
  const manifestDigest = sha256(JSON.stringify({
    schemaVersion: mediaDocument.schemaVersion,
    contract: mediaDocument.contract,
    keyRule: mediaDocument.keyRule,
    entries: mediaDocument.entries,
  }));
  if (mediaDocument.objectCount !== mediaDocument.entries.length
    || mediaDocument.totalBytes !== totalBytes
    || mediaDocument.manifestSha256 !== manifestDigest) fail('SEQ_E_PUBLIC_ASSET_MANIFEST');
  const trackedManifestIndex = new Map(index);
  for (const [assetPath, evidence] of receiptAssets) {
    const existing = index.get(assetPath);
    if (existing && (existing.sha256 !== evidence.sha256
      || existing.size !== evidence.size || existing.mime !== evidence.mime)) {
      fail('SEQ_E_PUBLIC_ASSET_RECEIPT');
    }
    index.set(assetPath, evidence);
  }

  // Genesis membership is a tracked immutable public-only sidecar. It cannot be
  // inferred from mutable content, projection, receipt, or local inventories.
  const genesisDocument = await loadOptionalJson(path.join(root, GENESIS_PUBLIC_IDENTITIES_PATH));
  if (!genesisDocument || typeof genesisDocument !== 'object' || Array.isArray(genesisDocument)
    || Object.keys(genesisDocument).length !== 5
    || Object.keys(genesisDocument).some((field) => ![
      'schemaVersion', 'contract', 'count', 'sha256', 'identities',
    ].includes(field))
    || genesisDocument.schemaVersion !== 1
    || genesisDocument.contract !== 'dwnc-genesis-public-identities-v1'
    || !Number.isSafeInteger(genesisDocument.count)
    || !Array.isArray(genesisDocument.identities)
    || genesisDocument.count !== genesisDocument.identities.length
    || !/^[a-f0-9]{64}$/u.test(genesisDocument.sha256 ?? '')) {
    fail('SEQ_E_PUBLIC_ASSET_GENESIS');
  }
  const genesisIdentities = new Set();
  const genesisCounts = { tistory: 0, naver: 0 };
  let previousIdentity = null;
  for (const identity of genesisDocument.identities) {
    if (typeof identity !== 'string' || identity.normalize('NFC') !== identity) {
      fail('SEQ_E_PUBLIC_ASSET_GENESIS');
    }
    const separator = identity.indexOf(':');
    if (separator <= 0 || separator !== identity.lastIndexOf(':')) fail('SEQ_E_PUBLIC_ASSET_GENESIS');
    let validated;
    try {
      validated = validateSourceIdentityInput({
        source: identity.slice(0, separator), sourceId: identity.slice(separator + 1),
      });
    } catch { fail('SEQ_E_PUBLIC_ASSET_GENESIS'); }
    const key = `${validated.source}:${validated.sourceId}`;
    if (!['tistory', 'naver'].includes(validated.source)
      || key !== identity
      || genesisIdentities.has(key)
      || previousIdentity !== null
        && Buffer.compare(Buffer.from(previousIdentity), Buffer.from(key)) >= 0) {
      fail('SEQ_E_PUBLIC_ASSET_GENESIS');
    }
    genesisIdentities.add(key);
    genesisCounts[validated.source] += 1;
    previousIdentity = key;
  }
  if (genesisDocument.sha256 !== identitySetDigest(genesisIdentities)
    || genesisDocument.sha256 !== genesisIdentityEvidence.sha256
    || genesisCounts.tistory !== genesisIdentityEvidence.tistory
    || genesisCounts.naver !== genesisIdentityEvidence.naver
    || genesisDocument.count !== genesisCounts.tistory + genesisCounts.naver) {
    fail('SEQ_E_PUBLIC_ASSET_GENESIS');
  }
  if ([...receiptIndex.keys()].some((identity) => genesisIdentities.has(identity))) {
    fail('SEQ_E_PUBLIC_ASSET_RECEIPT_ORPHAN');
  }
  const genesisAssetPaths = new Map([...genesisIdentities].map((identity) => {
    const separator = identity.indexOf(':');
    const prefix = `/media/${identity.slice(0, separator)}/${identity.slice(separator + 1)}/`;
    return [identity, [...trackedManifestIndex.keys()]
      .filter((assetPath) => assetPath.startsWith(prefix)
        && !mapExcludedAssets.has(assetPath)
        && !curatedExcludedAssets.has(assetPath))
      .sort((left, right) => left.localeCompare(right, 'en'))];
  }));
  return {
    manifestIndex: index,
    trackedManifestIndex,
    genesisIdentities,
    genesisAssetPaths,
    receiptIndex,
    mapLinkPolicy,
    mediaCurationPolicy,
  };
}

export async function loadPublicAssetManifestIndex(root) {
  return (await loadPublicAssetEvidence(root)).manifestIndex;
}

async function validateAssetReferences(root, data, body, manifestIndex, {
  assetMode = 'local', allowMissingManifest = false, mapLinkPolicy = null,
  mediaCurationPolicy = null,
} = {}) {
  if (!['local', 'manifest'].includes(assetMode)) fail('SEQ_E_PUBLIC_ASSET_MODE');
  const publicRoot = path.join(root, 'public');
  if (assetMode === 'local') await assertRealDirectory(publicRoot);
  const references = collectRenderableLocalAssetReferences(data, body, {
    mapLinkPolicy,
    mediaCurationPolicy,
  });
  for (const reference of references) {
    let decoded;
    try { decoded = decodeURIComponent(reference).normalize('NFC'); }
    catch { fail('SEQ_E_PUBLIC_ASSET_PATH'); }
    if (decoded !== reference.normalize('NFC')
      || decoded.includes('..')
      || decoded.includes('\\')
      || !decoded.startsWith('/media/')) fail('SEQ_E_PUBLIC_ASSET_PATH');
    const file = path.resolve(publicRoot, decoded.slice(1));
    if (!inside(publicRoot, file)) fail('SEQ_E_PUBLIC_ASSET_PATH');
    const manifest = manifestIndex.get(decoded);
    if (!manifest) {
      if (allowMissingManifest) continue;
      fail('SEQ_E_PUBLIC_ASSET_RECEIPT_REQUIRED');
    }
    if (assetMode === 'manifest') continue;
    let bytes;
    try { bytes = await readSecureBytes(file); }
    catch (error) {
      if (error instanceof SequenceError && ['SEQ_E_PATH_MISSING', 'SEQ_E_READ'].includes(error.code)) {
        fail('SEQ_E_PUBLIC_ASSET_MISSING');
      }
      throw error;
    }
    if (!bytes || bytes.length <= 0) fail('SEQ_E_PUBLIC_ASSET_MISSING');
    if (bytes.length !== manifest.size || sha256(bytes) !== manifest.sha256) fail('SEQ_E_PUBLIC_ASSET_HASH');
  }
  return references;
}

export async function indexPreparedPublicContent(root, {
  assetManifestIndex = undefined,
  trackedAssetManifestIndex = undefined,
  genesisIdentities = undefined,
  genesisAssetPaths = undefined,
  assetReceiptIndex = undefined,
  genesisIdentityEvidence = undefined,
  mapLinkPolicy = undefined,
  mediaCurationPolicy = undefined,
  assetMode = 'local',
} = {}) {
  if (!['local', 'manifest'].includes(assetMode)) fail('SEQ_E_PUBLIC_ASSET_MODE');
  const contentRoot = path.join(root, 'src/data/posts');
  await assertRealDirectory(contentRoot);
  const evidence = assetManifestIndex === undefined
    || trackedAssetManifestIndex === undefined
    || genesisIdentities === undefined
    || genesisAssetPaths === undefined
    || assetReceiptIndex === undefined
    ? await loadPublicAssetEvidence(root, { genesisIdentityEvidence })
    : null;
  const manifestIndex = assetManifestIndex ?? evidence.manifestIndex;
  const trackedManifestIndex = trackedAssetManifestIndex ?? evidence.trackedManifestIndex;
  const genesisIdentitySet = genesisIdentities ?? evidence.genesisIdentities;
  const genesisAssetPathIndex = genesisAssetPaths ?? evidence.genesisAssetPaths;
  const receiptIndex = assetReceiptIndex ?? evidence.receiptIndex;
  const resolvedMapLinkPolicy = mapLinkPolicy === undefined
    ? evidence?.mapLinkPolicy ?? await loadTrackedPublicMapLinkPolicy(root, { allowMissing: true })
    : mapLinkPolicy;
  const resolvedMediaCurationPolicy = mediaCurationPolicy === undefined
    ? evidence?.mediaCurationPolicy ?? await loadTrackedPublicMediaCurationPolicy(root, { allowMissing: true })
    : mediaCurationPolicy;
  const roots = [
    ['tistory', path.join(contentRoot, 'tistory'), false],
    ['naver', path.join(contentRoot, 'naver'), false],
    ['native', path.join(contentRoot, 'native'), true],
  ];
  const index = new Map();
  for (const [expectedSource, directory, optional] of roots) {
    const files = (await walkRealFiles(directory, { optional, allowedRoot: contentRoot })).filter((file) => /\.mdx?$/iu.test(file));
    for (const file of files) {
      const raw = await readSecureFile(file);
      if (/migration\/private|global-sequence-v1\.json/iu.test(raw)) fail('SEQ_E_PUBLIC_CONTENT_PRIVATE_REFERENCE');
      const { data, body } = parseFrontmatter(raw);
      const validated = validateSourceIdentityInput(data);
      if (validated.source !== expectedSource || data.visibility !== 'public') fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER');
      const expectedLegacy = expectedLegacyPath(validated.source, validated.sourceId);
      if (expectedLegacy && data.canonicalPath !== expectedLegacy) fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER');
      if (!expectedLegacy && (typeof data.canonicalPath !== 'string' || !/^\/posts\/[1-9]\d*$/u.test(data.canonicalPath))) {
        fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER');
      }
      const key = `${validated.source}:${validated.sourceId}`;
      const values = index.get(key) ?? [];
      const receipt = receiptIndex.get(key);
      const genesisIdentity = genesisIdentitySet.has(key);
      const assetPaths = await validateAssetReferences(root, data, body, manifestIndex, {
        assetMode,
        allowMissingManifest: genesisIdentity,
        mapLinkPolicy: resolvedMapLinkPolicy,
        mediaCurationPolicy: resolvedMediaCurationPolicy,
      });
      const identityAssetPrefix = `/media/${validated.source}/${validated.sourceId}/`;
      if (assetPaths.some((assetPath) => !assetPath.startsWith(identityAssetPrefix))) {
        fail('SEQ_E_PUBLIC_ASSET_PATH');
      }
      if (!genesisIdentity && !receipt) fail('SEQ_E_PUBLIC_ASSET_RECEIPT_REQUIRED');
      if (receipt) {
        const expectedPaths = [...receipt.assets.keys()].sort((left, right) => left.localeCompare(right, 'en'));
        if (receipt.contentSha256 !== sha256(raw)
          || JSON.stringify(expectedPaths) !== JSON.stringify(assetPaths)) fail('SEQ_E_PUBLIC_ASSET_RECEIPT');
        for (const assetPath of assetPaths) {
          const receiptAsset = receipt.assets.get(assetPath);
          const manifestAsset = manifestIndex.get(assetPath);
          if (!receiptAsset
            || (manifestAsset && (manifestAsset.sha256 !== receiptAsset.sha256
              || manifestAsset.size !== receiptAsset.size
              || manifestAsset.mime !== receiptAsset.mime))) {
            fail('SEQ_E_PUBLIC_ASSET_RECEIPT');
          }
          manifestIndex.set(assetPath, receiptAsset);
        }
      }
      const assetEvidenceComplete = assetPaths.every((assetPath) => trackedManifestIndex.has(assetPath))
        && (!genesisIdentity || JSON.stringify(genesisAssetPathIndex.get(key) ?? []) === JSON.stringify(assetPaths));
      values.push({
        source: validated.source,
        sourceId: validated.sourceId,
        draft: Boolean(data.draft),
        file,
        data,
        body,
        assetReferences: assetPaths.length,
        assetPaths,
        assetEvidenceComplete,
        assetEvidence: assetPaths.map((assetPath) => ({
          path: assetPath,
          ...manifestIndex.get(assetPath),
        })),
      });
      index.set(key, values);
    }
  }
  for (const key of receiptIndex.keys()) {
    if ((index.get(key) ?? []).length !== 1) fail('SEQ_E_PUBLIC_ASSET_RECEIPT_ORPHAN');
  }
  return index;
}

export function selectProjectionBackedContent(contentRows, projection, { development = false } = {}) {
  const projectionKeys = projection.map((entry) => `${entry.source}:${entry.sourceId}`);
  const projected = new Set(projectionKeys);
  if (projected.size !== projection.length) fail('SEQ_E_PUBLIC_CONTENT_PROJECTION');
  const selected = contentRows.filter((row) => projected.has(`${row.source}:${row.sourceId}`)
    && (development || !row.draft));
  const counts = new Map();
  for (const row of selected) {
    const key = `${row.source}:${row.sourceId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (projection.some((entry) => counts.get(`${entry.source}:${entry.sourceId}`) !== 1)) {
    fail('SEQ_E_PUBLIC_CONTENT_PROJECTION');
  }
  if (selected.length !== projection.length) fail('SEQ_E_PUBLIC_CONTENT_PROJECTION');
  return selected;
}

export async function loadProjectionBackedPublicContent(root, projection, options = {}) {
  const index = await indexPreparedPublicContent(root, options);
  const selected = selectProjectionBackedContent([...index.values()].flat(), projection, { development: false });
  if (selected.some((row) => !row.assetEvidenceComplete
    || row.assetEvidence.length !== row.assetPaths.length
    || row.assetEvidence.some((evidence) => !evidence.sha256))) {
    fail('SEQ_E_PUBLIC_ASSET_MANIFEST');
  }
  const byIdentity = new Map(projection.map((entry) => [`${entry.source}:${entry.sourceId}`, entry]));
  return selected.map((row) => {
    const address = byIdentity.get(`${row.source}:${row.sourceId}`);
    if (!address) fail('SEQ_E_PUBLIC_CONTENT_PROJECTION');
    if (row.source === 'native' && row.data.canonicalPath !== address.canonicalPath) fail('SEQ_E_PUBLIC_CONTENT_FRONTMATTER');
    return {
      ...row,
      globalSequence: address.globalSequence,
      canonicalPath: address.canonicalPath,
      legacyPaths: address.legacyPaths,
      provenanceCanonicalPath: row.data.canonicalPath,
      imported: row.source !== 'native',
    };
  }).sort((left, right) => left.globalSequence - right.globalSequence);
}

export function projectedPublicSurface(contentRows) {
  const canonicalPaths = contentRows.map((row) => row.canonicalPath);
  const aliases = contentRows.flatMap((row) => row.legacyPaths);
  return {
    canonicalPaths,
    aliases,
    searchPaths: [...canonicalPaths],
    rssPaths: [...canonicalPaths],
    sitemapPaths: [...canonicalPaths],
  };
}

const PUBLIC_SURFACE_KEYS = Object.freeze([
  'canonicalPaths', 'aliases', 'searchPaths', 'rssPaths', 'sitemapPaths',
]);

function exactSurfacePaths(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail('SEQ_E_PUBLIC_SURFACE');
  }
  const unique = new Set(value);
  if (unique.size !== value.length) fail('SEQ_E_PUBLIC_SURFACE');
  return [...unique].sort((left, right) => left.localeCompare(right, 'en'));
}

export function validateProjectedPublicSurface(contentRows, surface) {
  if (!surface || typeof surface !== 'object' || Array.isArray(surface)
    || Object.keys(surface).length !== PUBLIC_SURFACE_KEYS.length
    || Object.keys(surface).some((key) => !PUBLIC_SURFACE_KEYS.includes(key))) {
    fail('SEQ_E_PUBLIC_SURFACE');
  }
  const expected = projectedPublicSurface(contentRows);
  for (const key of PUBLIC_SURFACE_KEYS) {
    if (JSON.stringify(exactSurfacePaths(surface[key]))
      !== JSON.stringify(exactSurfacePaths(expected[key]))) fail('SEQ_E_PUBLIC_SURFACE');
  }
  return {
    canonical: expected.canonicalPaths.length,
    aliases: expected.aliases.length,
    search: expected.searchPaths.length,
    rss: expected.rssPaths.length,
    sitemap: expected.sitemapPaths.length,
  };
}

export function assertPreparedPublicIdentity(index, input) {
  const { source, sourceId } = validateSourceIdentityInput(input);
  const matches = index.get(`${source}:${sourceId}`) ?? [];
  if (matches.length !== 1 || matches[0].draft || !matches[0].assetEvidenceComplete) {
    fail('SEQ_E_PROMOTION_CONTENT_NOT_READY');
  }
  return matches[0];
}
