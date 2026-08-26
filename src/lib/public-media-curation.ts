import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import mediaCurationPolicy from '../data/public-media-curation-v1.json';
import type { PostEntry } from './posts';

type StickerRecord = {
  source: 'naver';
  sourceId: string;
  publicPath: string;
  href: string;
  alt: string;
};

type PlaceholderPosterRecord = {
  source: 'naver';
  sourceId: string;
  publicPath: string;
  occurrences: number;
};

type PlaceholderSpacingRecord = {
  source: 'naver';
  sourceId: string;
  publicPath: string;
  occurrences: number;
  alt: string;
  requiredClass: string;
};

type PlaceholderCoverReplacement = {
  source: 'naver';
  sourceId: string;
  excludedCover: string;
  sourceCoverAlt: string;
  replacementCover: string | null;
  replacementCoverAlt: string;
};

const stickerRecords = mediaCurationPolicy.stickerExclusions as StickerRecord[];
const stickerPaths = new Set(stickerRecords.map((record) => record.publicPath));
const placeholderPosterRecords = mediaCurationPolicy.placeholderExclusion
  .videoPosters as PlaceholderPosterRecord[];
const placeholderPosterPaths = new Set(placeholderPosterRecords.map((record) => record.publicPath));
const placeholderSpacingRecord = mediaCurationPolicy.placeholderExclusion
  .spacingGif as PlaceholderSpacingRecord;
const placeholderCoverReplacements = mediaCurationPolicy.placeholderExclusion
  .coverReplacements as PlaceholderCoverReplacement[];

export function preparePublicMediaPost(post: PostEntry): PostEntry {
  const cover = post.data.cover;
  if (!cover) return post;
  if (stickerPaths.has(cover)) {
    const sticker = stickerRecords.find((record) => record.publicPath === cover);
    if (!sticker
      || sticker.source !== post.data.source
      || sticker.sourceId !== post.data.sourceId
      || sticker.alt !== post.data.coverAlt) throw new Error('CURATION_E_STICKER_COVER');
    return {
      ...post,
      data: {
        ...post.data,
        cover: undefined,
        coverAlt: '',
      },
    };
  }
  const replacement = placeholderCoverReplacements.find((record) => record.excludedCover === cover);
  if (!replacement) return post;
  if (replacement.source !== post.data.source
    || replacement.sourceId !== post.data.sourceId
    || replacement.sourceCoverAlt !== post.data.coverAlt) {
    throw new Error('CURATION_E_PLACEHOLDER_COVER');
  }
  return {
    ...post,
    data: {
      ...post.data,
      cover: replacement.replacementCover ?? undefined,
      coverAlt: replacement.replacementCoverAlt,
    },
  };
}

function compactText(value: string) {
  return value
    .replace(/[\u00a0\u200b-\u200d\ufeff]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .normalize('NFC')
    .trim();
}

const EMPTY_INLINE_TAGS = new Set([
  'a', 'b', 'em', 'i', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u',
]);

function nodeTagName(node: AnyNode) {
  return 'tagName' in node ? String(node.tagName).toLowerCase() : '';
}

function isPresentationEmptyNode(
  $: cheerio.CheerioAPI,
  node: AnyNode,
  { allowBlock = false } = {},
): boolean {
  if (node.type === 'text') return compactText(node.data ?? '') === '';
  if (node.type === 'comment') return true;
  const tagName = nodeTagName(node);
  if (tagName === 'br') return true;
  if (!EMPTY_INLINE_TAGS.has(tagName)
    && !(allowBlock && (tagName === 'p' || tagName === 'div'))) return false;
  return $(node).contents().toArray().every((child) => isPresentationEmptyNode($, child));
}

function stickerBoundaryIsEmpty(
  $: cheerio.CheerioAPI,
  anchor: cheerio.Cheerio<AnyNode>,
  block: cheerio.Cheerio<AnyNode>,
  direction: 'before' | 'after',
) {
  const siblingKey = direction === 'before' ? 'prev' : 'next';
  const blockNode = block.get(0);
  let current: AnyNode | null | undefined = anchor.get(0);
  while (current && current !== blockNode) {
    for (let sibling = current[siblingKey]; sibling; sibling = sibling[siblingKey]) {
      if (!isPresentationEmptyNode($, sibling)) return false;
    }
    current = current.parent;
  }
  return current === blockNode;
}

function adjacentMeaningfulNode(
  node: AnyNode | undefined,
  direction: 'before' | 'after',
): AnyNode | null {
  const siblingKey = direction === 'before' ? 'prev' : 'next';
  let sibling = node?.[siblingKey] ?? null;
  while (sibling && (sibling.type === 'comment'
    || sibling.type === 'text' && compactText(sibling.data ?? '') === '')) sibling = sibling[siblingKey];
  return sibling;
}

function adjacentEmptyBlocks(
  $: cheerio.CheerioAPI,
  block: cheerio.Cheerio<AnyNode>,
  direction: 'before' | 'after',
) {
  const blocks: AnyNode[] = [];
  let sibling = adjacentMeaningfulNode(block.get(0), direction);
  while (sibling) {
    const tagName = nodeTagName(sibling);
    if (!['p', 'div'].includes(tagName)
      || !isPresentationEmptyNode($, sibling, { allowBlock: true })) break;
    blocks.push(sibling);
    sibling = adjacentMeaningfulNode(sibling, direction);
  }
  return blocks;
}

function pruneEmptyBoundaryNodes(
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>,
  direction: 'before' | 'after',
) {
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
    if (!EMPTY_INLINE_TAGS.has(nodeTagName(node))) break;
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

export function preparePublicMediaCuration(post: PostEntry, html: string) {
  preparePublicMediaPost(post);
  const expected = stickerRecords.filter((record) => (
    record.source === post.data.source && record.sourceId === post.data.sourceId
  ));
  const $ = cheerio.load(html, null, false);
  const observed = $('img[src]').toArray().filter((element) => stickerPaths.has($(element).attr('src') ?? ''));
  if (observed.length !== expected.length) throw new Error('CURATION_E_STICKER_COUNT');

  expected.forEach((record, index) => {
    const image = observed[index] ? $(observed[index]) : null;
    const anchor = image?.parent();
    if (!image
      || image.attr('src') !== record.publicPath
      || image.attr('alt') !== record.alt
      || anchor?.get(0)?.tagName !== 'a'
      || anchor.attr('href') !== record.href
      || anchor.find('img').length !== 1
      || compactText(anchor.text()) !== '') throw new Error('CURATION_E_STICKER_MARKUP');
    const block = image.closest('p, div').first();
    if (!block.length) throw new Error('CURATION_E_STICKER_MARKUP');
    const emptyBefore = stickerBoundaryIsEmpty($, anchor, block, 'before');
    const emptyAfter = stickerBoundaryIsEmpty($, anchor, block, 'after');
    const beforeBlocks = emptyBefore ? adjacentEmptyBlocks($, block, 'before') : [];
    const afterBlocks = emptyAfter ? adjacentEmptyBlocks($, block, 'after') : [];
    anchor.remove();
    if (emptyBefore) pruneEmptyBoundaryNodes($, block, 'before');
    if (emptyAfter) pruneEmptyBoundaryNodes($, block, 'after');
    if (isPresentationEmptyNode($, block.get(0)!, { allowBlock: true })) block.remove();
    for (const emptyBlock of [...beforeBlocks, ...afterBlocks]) {
      if (emptyBlock.parent) $(emptyBlock).remove();
    }
  });

  if (stickerRecords.some((record) => ($.root().html() ?? '').includes(record.publicPath))) {
    throw new Error('CURATION_E_STICKER_REMAINS');
  }

  const expectedPosters = placeholderPosterRecords.filter((record) => (
    record.source === post.data.source && record.sourceId === post.data.sourceId
  ));
  const observedPosters = $('video[poster]').toArray().filter((element) => (
    placeholderPosterPaths.has($(element).attr('poster') ?? '')
  ));
  const expectedPosterOccurrences = expectedPosters.reduce((sum, record) => sum + record.occurrences, 0);
  if (observedPosters.length !== expectedPosterOccurrences) {
    throw new Error('CURATION_E_PLACEHOLDER_POSTER_COUNT');
  }
  for (const record of expectedPosters) {
    const matches = observedPosters.filter((element) => $(element).attr('poster') === record.publicPath);
    if (matches.length !== record.occurrences) throw new Error('CURATION_E_PLACEHOLDER_POSTER_COUNT');
    for (const element of matches) {
      const video = $(element);
      if (video.attr('src')?.trim() || video.find('source[src]').length) {
        throw new Error('CURATION_E_PLACEHOLDER_POSTER_ROLE');
      }
      video.removeAttr('poster');
    }
  }

  const expectedSpacing = placeholderSpacingRecord.source === post.data.source
    && placeholderSpacingRecord.sourceId === post.data.sourceId
    ? placeholderSpacingRecord
    : null;
  const spacingImages = $('img[src]').toArray().filter((element) => (
    $(element).attr('src') === placeholderSpacingRecord.publicPath
  ));
  if (spacingImages.length !== (expectedSpacing?.occurrences ?? 0)) {
    throw new Error('CURATION_E_PLACEHOLDER_SPACING_COUNT');
  }
  for (const element of spacingImages) {
    const image = $(element);
    if (!expectedSpacing
      || image.attr('alt') !== expectedSpacing.alt
      || !image.hasClass(expectedSpacing.requiredClass)) {
      throw new Error('CURATION_E_PLACEHOLDER_SPACING_ROLE');
    }
    const wrapper = image.closest('div').first();
    image.remove();
    if (wrapper.length && isPresentationEmptyNode($, wrapper.get(0)!, { allowBlock: true })) {
      wrapper.remove();
    }
  }

  const remainingPlaceholder = $('[src], [poster], [href], [background]').toArray().some((element) => {
    const item = $(element);
    return ['src', 'poster', 'href', 'background'].some((attribute) => {
      const value = item.attr(attribute) ?? '';
      return placeholderPosterPaths.has(value) || value === placeholderSpacingRecord.publicPath;
    });
  });
  if (remainingPlaceholder) throw new Error('CURATION_E_PLACEHOLDER_REMAINS');
  const transformed = $.root().html() ?? html;
  return transformed;
}
