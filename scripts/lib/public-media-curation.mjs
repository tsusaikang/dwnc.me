import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

export const PUBLIC_MEDIA_CURATION_POLICY_PATH = 'src/data/public-media-curation-v1.json';
export const PUBLIC_MEDIA_CURATION_CONTRACT = 'dwnc-public-media-curation-v1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MEDIA_PATH_PATTERN = /^\/media\/naver\/[1-9]\d{7,13}\/[A-Za-z0-9._-]+$/u;
const byteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw new Error(code); };
const EXPECTED_STICKER_PATHS = Object.freeze([
  '/media/naver/220522768720/003-507546e2d704.png',
  '/media/naver/220522768720/004-7268af2e360f.png',
  '/media/naver/220522768720/005-c098d249d2c2.png',
  '/media/naver/220535695526/009-432c56cfbed8.png',
  '/media/naver/220535695526/010-c1c17b98960e.png',
]);
const EXPECTED_AUTHORED_SBS_GIF = Object.freeze({
  id: 'authored-sbs-gif',
  source: 'naver',
  sourceId: '221172590451',
  publicPath: '/media/naver/221172590451/001-e467d08a3a01.gif',
  size: 1_299_862,
  sha256: 'e467d08a3a01bf5bcc53c79f2a40e89d0181a8c920e08b62a1a513c3d93656d9',
  contentType: 'image/gif',
});
const EXPECTED_PLACEHOLDER_POSTERS_SHA256 = 'c3f60db499dc05a8ce4be1616b2544c7e63010233772c353b7fe30e5262bc090';
const EXPECTED_PLACEHOLDER_COVERS_SHA256 = 'd4c3a01c76032ac2a6a0f056dbfc0b747da804336bff40a0107e33729079633a';

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && Object.keys(value).every((key) => expected.includes(key));
}

function isSortedUnique(values) {
  return values.every((value, index) => index === 0 || byteCompare(values[index - 1], value) < 0);
}

function compactText(value) {
  return String(value ?? '')
    .replace(/[\u00a0\u200b-\u200d\ufeff]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .normalize('NFC')
    .trim();
}

function validAssetMetadata(value) {
  return Number.isSafeInteger(value?.size)
    && value.size > 0
    && SHA256_PATTERN.test(value?.sha256 ?? '')
    && typeof value?.contentType === 'string'
    && /^image\/[a-z0-9.+-]+$/u.test(value.contentType);
}

export function canonicalPublicMediaCurationPayload(policy) {
  return JSON.stringify({
    schemaVersion: policy.schemaVersion,
    contract: policy.contract,
    stickerExclusionCount: policy.stickerExclusionCount,
    authoredPlatformAssetCount: policy.authoredPlatformAssetCount,
    stickerExclusions: policy.stickerExclusions,
    authoredPlatformAssets: policy.authoredPlatformAssets,
    placeholderExclusion: policy.placeholderExclusion,
  });
}

export function publicMediaCurationPolicySha256(policy) {
  return sha256(canonicalPublicMediaCurationPayload(policy));
}

export function validatePublicMediaCurationPolicy(policy) {
  const documentKeys = [
    'schemaVersion', 'contract', 'stickerExclusionCount', 'authoredPlatformAssetCount',
    'policySha256', 'stickerExclusions', 'authoredPlatformAssets', 'placeholderExclusion',
  ];
  if (!exactKeys(policy, documentKeys)
    || policy.schemaVersion !== 1
    || policy.contract !== PUBLIC_MEDIA_CURATION_CONTRACT
    || !Number.isSafeInteger(policy.stickerExclusionCount)
    || !Number.isSafeInteger(policy.authoredPlatformAssetCount)
    || !SHA256_PATTERN.test(policy.policySha256 ?? '')
    || !Array.isArray(policy.stickerExclusions)
    || !Array.isArray(policy.authoredPlatformAssets)) fail('CURATION_E_POLICY_SCHEMA');

  const stickerKeys = ['source', 'sourceId', 'publicPath', 'href', 'alt', 'size', 'sha256', 'contentType'];
  const stickerPaths = [];
  for (const record of policy.stickerExclusions) {
    if (!exactKeys(record, stickerKeys)
      || record.source !== 'naver'
      || typeof record.sourceId !== 'string'
      || record.publicPath !== `/media/naver/${record.sourceId}/${path.posix.basename(record.publicPath ?? '')}`
      || !MEDIA_PATH_PATTERN.test(record.publicPath ?? '')
      || !/^http:\/\/m\.gfmarket\.naver\.com\/sticker\/detail\/code\/[a-z0-9_]+$/u.test(record.href ?? '')
      || typeof record.alt !== 'string'
      || !record.alt
      || !validAssetMetadata(record)
      || record.contentType !== 'image/png') fail('CURATION_E_STICKER_POLICY');
    stickerPaths.push(record.publicPath);
  }
  if (policy.stickerExclusionCount !== 5
    || policy.stickerExclusionCount !== policy.stickerExclusions.length
    || !isSortedUnique(stickerPaths)
    || JSON.stringify(stickerPaths) !== JSON.stringify(EXPECTED_STICKER_PATHS)) {
    fail('CURATION_E_STICKER_POLICY');
  }

  const authoredKeys = ['id', 'source', 'sourceId', 'publicPath', 'size', 'sha256', 'contentType'];
  if (policy.authoredPlatformAssetCount !== 1
    || policy.authoredPlatformAssets.length !== 1
    || !exactKeys(policy.authoredPlatformAssets[0], authoredKeys)
    || JSON.stringify(policy.authoredPlatformAssets[0]) !== JSON.stringify(EXPECTED_AUTHORED_SBS_GIF)) {
    fail('CURATION_E_AUTHORED_PLATFORM_ASSET');
  }

  const placeholders = policy.placeholderExclusion;
  const placeholderKeys = [
    'objectCount', 'videoPosterOccurrenceCount', 'videoPosterSize', 'videoPosterSha256',
    'videoPosterContentType', 'videoPosters', 'spacingGif', 'coverReplacements',
  ];
  const posterKeys = ['source', 'sourceId', 'publicPath', 'occurrences'];
  const spacingKeys = [
    'source', 'sourceId', 'publicPath', 'size', 'sha256', 'contentType',
    'occurrences', 'alt', 'requiredClass',
  ];
  const coverKeys = [
    'source', 'sourceId', 'excludedCover', 'sourceCoverAlt', 'replacementCover',
    'replacementCoverAlt', 'selectionRule', 'eligibleCandidateCount',
  ];
  if (!exactKeys(placeholders, placeholderKeys)
    || placeholders.objectCount !== 27
    || placeholders.videoPosterOccurrenceCount !== 53
    || placeholders.videoPosterSize !== 62
    || placeholders.videoPosterSha256 !== 'ffc9f5e4fdeea83920c171e2bd17577127c5d1a2c3c76f07440e10d387132280'
    || placeholders.videoPosterContentType !== 'image/svg+xml'
    || !Array.isArray(placeholders.videoPosters)
    || placeholders.videoPosters.length !== 26
    || sha256(JSON.stringify(placeholders.videoPosters)) !== EXPECTED_PLACEHOLDER_POSTERS_SHA256
    || !Array.isArray(placeholders.coverReplacements)
    || placeholders.coverReplacements.length !== 13
    || sha256(JSON.stringify(placeholders.coverReplacements)) !== EXPECTED_PLACEHOLDER_COVERS_SHA256
    || !exactKeys(placeholders.spacingGif, spacingKeys)
    || placeholders.spacingGif.source !== 'naver'
    || placeholders.spacingGif.sourceId !== '220543741334'
    || placeholders.spacingGif.publicPath !== '/media/naver/220543741334/002-5ac70de1d3f9.gif'
    || placeholders.spacingGif.size !== 85
    || placeholders.spacingGif.sha256 !== '5ac70de1d3f9da395373417a30ae3667e5e2067600c861ccf2a255e1694874d8'
    || placeholders.spacingGif.contentType !== 'image/gif'
    || placeholders.spacingGif.occurrences !== 1
    || placeholders.spacingGif.alt !== ''
    || placeholders.spacingGif.requiredClass !== '_attach_space') fail('CURATION_E_PLACEHOLDER_POLICY');

  const posterPaths = [];
  let posterOccurrences = 0;
  for (const poster of placeholders.videoPosters) {
    if (!exactKeys(poster, posterKeys)
      || poster.source !== 'naver'
      || typeof poster.sourceId !== 'string'
      || !MEDIA_PATH_PATTERN.test(poster.publicPath ?? '')
      || poster.publicPath !== `/media/naver/${poster.sourceId}/${path.posix.basename(poster.publicPath ?? '')}`
      || !poster.publicPath.endsWith('-ffc9f5e4fdee.svg')
      || !Number.isSafeInteger(poster.occurrences)
      || poster.occurrences < 1) fail('CURATION_E_PLACEHOLDER_POLICY');
    posterPaths.push(poster.publicPath);
    posterOccurrences += poster.occurrences;
  }
  const coverPaths = [];
  for (const replacement of placeholders.coverReplacements) {
    if (!exactKeys(replacement, coverKeys)
      || replacement.source !== 'naver'
      || typeof replacement.sourceId !== 'string'
      || replacement.excludedCover !== `/media/naver/${replacement.sourceId}/${path.posix.basename(replacement.excludedCover ?? '')}`
      || !posterPaths.includes(replacement.excludedCover)
      || replacement.sourceCoverAlt !== ''
      || replacement.replacementCover !== null
      || replacement.replacementCoverAlt !== ''
      || replacement.selectionRule !== 'first-body-owned-nonexcluded-image'
      || replacement.eligibleCandidateCount !== 0) fail('CURATION_E_PLACEHOLDER_POLICY');
    coverPaths.push(replacement.excludedCover);
  }
  if (!isSortedUnique(posterPaths)
    || posterOccurrences !== placeholders.videoPosterOccurrenceCount
    || !isSortedUnique(coverPaths)) {
    fail('CURATION_E_PLACEHOLDER_POLICY');
  }

  const excludedPlaceholders = new Set([...posterPaths, placeholders.spacingGif.publicPath]);
  const authored = new Set(policy.authoredPlatformAssets.map((record) => record.publicPath));
  if (stickerPaths.some((publicPath) => excludedPlaceholders.has(publicPath) || authored.has(publicPath))
    || [...authored].some((publicPath) => excludedPlaceholders.has(publicPath))) fail('CURATION_E_POLICY_OVERLAP');
  if (policy.policySha256 !== publicMediaCurationPolicySha256(policy)) fail('CURATION_E_POLICY_SUMMARY');
  return policy;
}

export async function loadTrackedPublicMediaCurationPolicy(root, { allowMissing = false } = {}) {
  let raw;
  try { raw = await readFile(path.join(root, PUBLIC_MEDIA_CURATION_POLICY_PATH), 'utf8'); }
  catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    fail('CURATION_E_POLICY_READ');
  }
  let policy;
  try { policy = JSON.parse(raw); }
  catch { fail('CURATION_E_POLICY_READ'); }
  return validatePublicMediaCurationPolicy(policy);
}

export function publicMediaCurationExcludedAssets(policy) {
  validatePublicMediaCurationPolicy(policy);
  const excluded = new Set([
    ...policy.stickerExclusions.map((record) => record.publicPath),
    ...policy.placeholderExclusion.videoPosters.map((record) => record.publicPath),
    policy.placeholderExclusion.spacingGif.publicPath,
  ]);
  for (const authored of policy.authoredPlatformAssets) excluded.delete(authored.publicPath);
  return excluded;
}

export function effectivePublicMediaPresentationData(data, policy) {
  validatePublicMediaCurationPolicy(policy);
  const cover = typeof data?.cover === 'string' ? data.cover : undefined;
  const coverAlt = typeof data?.coverAlt === 'string' ? data.coverAlt : '';
  if (!cover) return {
    cover,
    coverAlt,
    suppressedStickerCover: false,
    replacedPlaceholderCover: false,
  };

  const sticker = policy.stickerExclusions.find((record) => record.publicPath === cover);
  if (sticker) {
    if (sticker.source !== String(data?.source ?? '')
      || sticker.sourceId !== String(data?.sourceId ?? '')
      || sticker.alt !== coverAlt) fail('CURATION_E_STICKER_COVER');
    return {
      cover: undefined,
      coverAlt: '',
      suppressedStickerCover: true,
      replacedPlaceholderCover: false,
    };
  }

  const replacement = policy.placeholderExclusion.coverReplacements.find((record) => (
    record.excludedCover === cover
  ));
  if (!replacement) return {
    cover,
    coverAlt,
    suppressedStickerCover: false,
    replacedPlaceholderCover: false,
  };
  if (replacement.source !== String(data?.source ?? '')
    || replacement.sourceId !== String(data?.sourceId ?? '')
    || replacement.sourceCoverAlt !== coverAlt) fail('CURATION_E_PLACEHOLDER_COVER');
  return {
    cover: replacement.replacementCover ?? undefined,
    coverAlt: replacement.replacementCoverAlt,
    suppressedStickerCover: false,
    replacedPlaceholderCover: true,
  };
}

export function containsUncuratedStickerMarkup(html) {
  const $ = cheerio.load(html, null, false);
  return $('a[href^="http://m.gfmarket.naver.com/sticker/detail/code/"] img[src^="/media/"]').length > 0;
}

function stickerRecordsFor(data, policy) {
  return policy.stickerExclusions.filter((record) => (
    record.source === String(data?.source ?? '') && record.sourceId === String(data?.sourceId ?? '')
  ));
}

const EMPTY_INLINE_TAGS = new Set([
  'a', 'b', 'em', 'i', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u',
]);

function isPresentationEmptyNode($, node, { allowBlock = false } = {}) {
  if (node.type === 'text') return compactText(node.data ?? '') === '';
  if (node.type === 'comment') return true;
  const tagName = String(node.tagName ?? '').toLowerCase();
  if (tagName === 'br') return true;
  if (!EMPTY_INLINE_TAGS.has(tagName)
    && !(allowBlock && (tagName === 'p' || tagName === 'div'))) return false;
  return $(node).contents().toArray().every((child) => isPresentationEmptyNode($, child));
}

function stickerBoundaryIsEmpty($, anchor, block, direction) {
  const siblingKey = direction === 'before' ? 'prev' : 'next';
  const blockNode = block.get(0);
  let current = anchor.get(0);
  while (current && current !== blockNode) {
    for (let sibling = current[siblingKey]; sibling; sibling = sibling[siblingKey]) {
      if (!isPresentationEmptyNode($, sibling)) return false;
    }
    current = current.parent;
  }
  return current === blockNode;
}

function adjacentMeaningfulNode(node, direction) {
  const siblingKey = direction === 'before' ? 'prev' : 'next';
  let sibling = node?.[siblingKey] ?? null;
  while (sibling && (sibling.type === 'comment'
    || sibling.type === 'text' && compactText(sibling.data ?? '') === '')) sibling = sibling[siblingKey];
  return sibling;
}

function adjacentEmptyBlocks($, block, direction) {
  const blocks = [];
  let sibling = adjacentMeaningfulNode(block.get(0), direction);
  while (sibling) {
    const tagName = String(sibling.tagName ?? '').toLowerCase();
    if (!['p', 'div'].includes(tagName)
      || !isPresentationEmptyNode($, sibling, { allowBlock: true })) break;
    blocks.push(sibling);
    sibling = adjacentMeaningfulNode(sibling, direction);
  }
  return blocks;
}

function pruneEmptyBoundaryNodes($, container, direction) {
  let removed = 0;
  while (container.length) {
    const contents = container.contents().toArray();
    const node = direction === 'before' ? contents[0] : contents.at(-1);
    if (!node) break;
    if (isPresentationEmptyNode($, node)) {
      $(node).remove();
      removed += 1;
      continue;
    }
    const tagName = String(node.tagName ?? '').toLowerCase();
    if (!EMPTY_INLINE_TAGS.has(tagName)) break;
    const nested = $(node);
    const nestedRemoved = pruneEmptyBoundaryNodes($, nested, direction);
    removed += nestedRemoved;
    if (!nestedRemoved) break;
    if (isPresentationEmptyNode($, node)) {
      nested.remove();
      removed += 1;
      continue;
    }
    break;
  }
  return removed;
}

export function inspectPolicyStickerAssets(html, data, policy) {
  validatePublicMediaCurationPolicy(policy);
  const expected = stickerRecordsFor(data, policy);
  const allPaths = new Set(policy.stickerExclusions.map((record) => record.publicPath));
  effectivePublicMediaPresentationData(data, policy);
  const $ = cheerio.load(html, null, false);
  const observed = $('img[src]').toArray().filter((element) => allPaths.has($(element).attr('src')));
  if (observed.length !== expected.length) fail('CURATION_E_STICKER_COUNT');

  const occurrences = [];
  for (const [index, record] of expected.entries()) {
    const image = observed[index] ? $(observed[index]) : null;
    if (!image
      || image.attr('src') !== record.publicPath
      || image.attr('alt') !== record.alt
      || image.parent().prop('tagName')?.toLowerCase() !== 'a'
      || image.parent().attr('href') !== record.href
      || image.parent().find('img').length !== 1
      || compactText(image.parent().text()) !== '') fail('CURATION_E_STICKER_MARKUP');
    const anchor = image.parent();
    const block = image.closest('p, div').first();
    if (!block.length) fail('CURATION_E_STICKER_MARKUP');
    occurrences.push({
      record,
      anchor,
      block,
      emptyBefore: stickerBoundaryIsEmpty($, anchor, block, 'before'),
      emptyAfter: stickerBoundaryIsEmpty($, anchor, block, 'after'),
    });
  }
  return { $, occurrences };
}

export function removePolicyStickerAssets(html, data, policy) {
  const inspected = inspectPolicyStickerAssets(html, data, policy);
  let removedParagraphs = 0;
  let removedAdjacentEmptyWrappers = 0;
  let removedInlineSpacingNodes = 0;
  for (const occurrence of inspected.occurrences) {
    const beforeBlocks = occurrence.emptyBefore
      ? adjacentEmptyBlocks(inspected.$, occurrence.block, 'before')
      : [];
    const afterBlocks = occurrence.emptyAfter
      ? adjacentEmptyBlocks(inspected.$, occurrence.block, 'after')
      : [];
    occurrence.anchor.remove();
    if (occurrence.emptyBefore) {
      removedInlineSpacingNodes += pruneEmptyBoundaryNodes(inspected.$, occurrence.block, 'before');
    }
    if (occurrence.emptyAfter) {
      removedInlineSpacingNodes += pruneEmptyBoundaryNodes(inspected.$, occurrence.block, 'after');
    }
    if (isPresentationEmptyNode(inspected.$, occurrence.block.get(0), { allowBlock: true })) {
      if (occurrence.block.get(0)?.tagName?.toLowerCase() === 'p') removedParagraphs += 1;
      occurrence.block.remove();
    }
    for (const block of [...beforeBlocks, ...afterBlocks]) {
      if (block.parent) {
        inspected.$(block).remove();
        removedAdjacentEmptyWrappers += 1;
      }
    }
  }
  const transformed = inspected.$.root().html() ?? html;
  if (policy.stickerExclusions.some((record) => transformed.includes(record.publicPath))) {
    fail('CURATION_E_STICKER_REMAINS');
  }
  return {
    html: transformed,
    excludedAssets: inspected.occurrences.map(({ record }) => record.publicPath),
    removedStickers: inspected.occurrences.length,
    removedParagraphs,
    removedAdjacentEmptyWrappers,
    removedInlineSpacingNodes,
  };
}

function placeholderPosterRecordsFor(data, policy) {
  return policy.placeholderExclusion.videoPosters.filter((record) => (
    record.source === String(data?.source ?? '') && record.sourceId === String(data?.sourceId ?? '')
  ));
}

function placeholderSpacingRecordFor(data, policy) {
  const record = policy.placeholderExclusion.spacingGif;
  return record.source === String(data?.source ?? '') && record.sourceId === String(data?.sourceId ?? '')
    ? record
    : null;
}

export function inspectPolicyPlaceholderAssets(html, data, policy) {
  validatePublicMediaCurationPolicy(policy);
  effectivePublicMediaPresentationData(data, policy);
  const expectedPosters = placeholderPosterRecordsFor(data, policy);
  const expectedSpacing = placeholderSpacingRecordFor(data, policy);
  const allPosterPaths = new Set(
    policy.placeholderExclusion.videoPosters.map((record) => record.publicPath),
  );
  const spacingPath = policy.placeholderExclusion.spacingGif.publicPath;
  const $ = cheerio.load(html, null, false);
  const observedPosterElements = $('video[poster]').toArray().filter((element) => (
    allPosterPaths.has($(element).attr('poster'))
  ));
  const expectedPosterOccurrences = expectedPosters.reduce((sum, record) => sum + record.occurrences, 0);
  if (observedPosterElements.length !== expectedPosterOccurrences) fail('CURATION_E_PLACEHOLDER_POSTER_COUNT');

  const posters = [];
  for (const record of expectedPosters) {
    const elements = observedPosterElements.filter((element) => $(element).attr('poster') === record.publicPath);
    if (elements.length !== record.occurrences) fail('CURATION_E_PLACEHOLDER_POSTER_COUNT');
    for (const element of elements) {
      const video = $(element);
      if (video.attr('src')?.trim() || video.find('source[src]').length) {
        fail('CURATION_E_PLACEHOLDER_POSTER_ROLE');
      }
      posters.push({ record, video });
    }
  }

  const observedSpacingElements = $('img[src]').toArray().filter((element) => (
    $(element).attr('src') === spacingPath
  ));
  if (observedSpacingElements.length !== (expectedSpacing?.occurrences ?? 0)) {
    fail('CURATION_E_PLACEHOLDER_SPACING_COUNT');
  }
  const spacingImages = observedSpacingElements.map((element) => {
    const image = $(element);
    if (!expectedSpacing
      || image.attr('alt') !== expectedSpacing.alt
      || !image.hasClass(expectedSpacing.requiredClass)) fail('CURATION_E_PLACEHOLDER_SPACING_ROLE');
    return { record: expectedSpacing, image };
  });
  return { $, posters, spacingImages };
}

export function removePolicyPlaceholderAssets(html, data, policy) {
  const inspected = inspectPolicyPlaceholderAssets(html, data, policy);
  let removedVideoPosters = 0;
  let removedSpacingGifs = 0;
  let removedSpacingWrappers = 0;
  const excludedAssets = new Set();

  for (const { record, video } of inspected.posters) {
    video.removeAttr('poster');
    removedVideoPosters += 1;
    excludedAssets.add(record.publicPath);
  }
  for (const { record, image } of inspected.spacingImages) {
    const wrapper = image.closest('div').first();
    image.remove();
    removedSpacingGifs += 1;
    excludedAssets.add(record.publicPath);
    if (wrapper.length
      && isPresentationEmptyNode(inspected.$, wrapper.get(0), { allowBlock: true })) {
      wrapper.remove();
      removedSpacingWrappers += 1;
    }
  }

  const transformed = inspected.$.root().html() ?? html;
  const remaining = inspected.$('[src], [poster], [href], [background]').toArray().some((element) => {
    const item = inspected.$(element);
    return ['src', 'poster', 'href', 'background'].some((attribute) => (
      policy.placeholderExclusion.videoPosters.some((record) => record.publicPath === item.attr(attribute))
        || policy.placeholderExclusion.spacingGif.publicPath === item.attr(attribute)
    ));
  });
  if (remaining) fail('CURATION_E_PLACEHOLDER_REMAINS');
  return {
    html: transformed,
    excludedAssets: [...excludedAssets],
    removedVideoPosters,
    removedSpacingGifs,
    removedSpacingWrappers,
  };
}

export function applyPublicMediaCuration(html, data, policy) {
  const stickers = removePolicyStickerAssets(html, data, policy);
  const placeholders = removePolicyPlaceholderAssets(stickers.html, data, policy);
  return {
    html: placeholders.html,
    excludedAssets: [...new Set([...stickers.excludedAssets, ...placeholders.excludedAssets])],
    removedStickers: stickers.removedStickers,
    removedVideoPosters: placeholders.removedVideoPosters,
    removedSpacingGifs: placeholders.removedSpacingGifs,
    removedSpacingWrappers: placeholders.removedSpacingWrappers,
    removedParagraphs: stickers.removedParagraphs,
    removedAdjacentEmptyWrappers: stickers.removedAdjacentEmptyWrappers,
    removedInlineSpacingNodes: stickers.removedInlineSpacingNodes,
  };
}
