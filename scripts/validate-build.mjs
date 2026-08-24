import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { createPublicLinkRegistry, transformPublicPostLinks } from '../src/lib/public-links.ts';
import { BOOTSTRAP_PUBLIC_PROJECTION_SHA256, publicProjectionDigest, readPrivateLedger } from './lib/global-sequence.mjs';
import {
  loadProjectionBackedPublicContent,
  validateProjectedPublicSurface,
} from './lib/public-content-preflight.mjs';
import { validateProjectedDistAssets } from './lib/public-dist-assets.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const PRIVATE_STATE_ROOT = process.env.DWNC_SEQUENCE_PRIVATE_ROOT
  ? path.resolve(process.env.DWNC_SEQUENCE_PRIVATE_ROOT)
  : path.join(ROOT, 'migration/private');
const EXPECTED_TISTORY = 164;
const EXPECTED_NAVER_PUBLIC = 185;
const EXPECTED_NAVER_PRIVATE = 247;
const EXPECTED_IMPORTED_PUBLIC_TOTAL = EXPECTED_TISTORY + EXPECTED_NAVER_PUBLIC;
const EXPECTED_NAVER_VIDEOS = 81;
const EXPECTED_NAVER_LOCAL_VIDEOS = 28;
const EXPECTED_NAVER_VIDEO_FALLBACKS = 53;
const EXPECTED_NAVER_VIDEO_CAPTIONS = 23;
const EXPECTED_STRUCTURAL_PHOTO_POSTS = 149;
const EXPECTED_STRUCTURAL_LONGFORM_POSTS = 200;
const EXPECTED_SHORT_VISUAL_POSTS = 12;
const EXPECTED_RAW_STRUCTURAL_DIFFERENCES = 19;
const EXPECTED_DERIVED_VERSION = 2;
const EXPECTED_NORMALIZATION_VERSION = 3;
const issueBuckets = new Map();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const relative = (filePath) => path.relative(ROOT, filePath) || '.';

function issue(code, message) {
  const bucket = issueBuckets.get(code) ?? { count: 0, examples: [] };
  bucket.count += 1;
  if (bucket.examples.length < 8) bucket.examples.push(message);
  issueBuckets.set(code, bucket);
}

async function loadJson(relativePath, code) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
  } catch (error) {
    issue(code, `${relativePath}: ${error?.code ?? error?.message ?? 'read failure'}`);
    return null;
  }
}

async function walk(directory, { optional = false } = {}) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!optional || error?.code !== 'ENOENT') issue('build.walk', `${relative(directory)} could not be read.`);
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

async function loadPrivateAllowedRecords() {
  const ledgerFile = path.join(PRIVATE_STATE_ROOT, 'sequence/global-sequence-v1.json');
  try {
    const ledger = await readPrivateLedger(ledgerFile);
    return {
      authoritative: true,
      records: ledger.entries
      .filter((entry) => entry.source === 'naver'
        && (entry.visibility !== 'public' || entry.status !== 'active'))
      .map((entry) => ({
        source: entry.source,
        source_id: entry.sourceId,
        visibility: entry.visibility,
        published_at: entry.publishedAt,
        canonical_path: `/naver/${entry.sourceId}`,
      })),
    };
  } catch (error) {
    if (error?.code === 'SEQ_E_PATH_MISSING') return { authoritative: false, records: [] };
    issue('privacy.private-metadata', 'The metadata-only private sequence ledger is invalid.');
    return { authoritative: true, records: [] };
  }
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value)
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (match, number) => {
      try { return String.fromCodePoint(Number(number)); } catch { return match; }
    })
    .replace(/&#x([a-f0-9]+);/gi, (match, number) => {
      try { return String.fromCodePoint(Number.parseInt(number, 16)); } catch { return match; }
    });
}

function visibleText(value) {
  return decodeEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .trim();
}

function normalizedMime(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function beginsWithHtmlDocument(bytes) {
  const prefix = bytes.subarray(0, 4096).toString('utf8').replace(/^(?:\uFEFF|\s)+/u, '');
  return /^(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(prefix);
}

async function expectMissing(filePath) {
  try {
    await lstat(filePath);
    issue('privacy.private-route', 'A private Naver route was emitted into dist.');
  } catch (error) {
    if (error?.code !== 'ENOENT') issue('privacy.private-route', 'A private Naver route could not be checked.');
  }
}

async function verifyBuiltMedia(item, expectedPrefix, label, referenced, kind = null) {
  if (!item.local_path || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') || !Number.isInteger(item.size)) {
    issue('build.media.metadata', `${label} has incomplete source manifest metadata.`);
    return;
  }
  const builtPath = path.resolve(DIST, item.local_path.replace(/^\/+/, ''));
  if (!item.local_path.startsWith(expectedPrefix)
    || !(builtPath === DIST || builtPath.startsWith(`${DIST}${path.sep}`))) {
    issue('build.media.path', `${label} has an unexpected built path.`);
    return;
  }
  referenced.add(path.resolve(builtPath));
  try {
    const fileStat = await lstat(builtPath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      issue('build.media.type', `${label} is not a regular built file.`);
      return;
    }
    const bytes = await readFile(builtPath);
    if (bytes.length !== item.size) issue('build.media.size', `${label} size differs from its source manifest.`);
    if (sha256(bytes) !== item.sha256) issue('build.media.sha256', `${label} SHA-256 differs from its source manifest.`);
    if (kind === 'attachment'
      && (['text/html', 'application/xhtml+xml'].includes(normalizedMime(item.mime))
        || beginsWithHtmlDocument(bytes))) {
      issue('build.attachment.html', `${relative(builtPath)} contains an HTML document instead of an attachment payload.`);
    }
  } catch {
    issue('build.media.missing', `${label} is missing from dist.`);
  }
}

function normalizeLeakText(value) {
  return decodeEntities(String(value))
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\u003f/gi, '?')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\x2f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/%2f/gi, '/')
    .normalize('NFC');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsPrivateIdLiteral(value, id) {
  return new RegExp(`(^|[^0-9])${escapeRegExp(id)}(?=$|[^0-9])`).test(value);
}

function containsPrivateCanonicalPath(value, id) {
  return new RegExp(`/naver/${escapeRegExp(id)}(?=$|[^0-9])`, 'i').test(value);
}

function ownerOriginCandidates(value) {
  return value.match(/(?<![a-z0-9.-])(?:(?:https?:)?\/\/)?(?:(?:m\.)?blog\.naver\.com|tsusai\.blog\.me)(?::\d+)?\/[^\s"'<>`\\]*/gi) ?? [];
}

function containsOwnerOrigin(value, id) {
  for (let candidate of ownerOriginCandidates(value)) {
    candidate = candidate.replace(/[),.;]+$/g, '');
    if (candidate.startsWith('//')) candidate = `https:${candidate}`;
    else if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      const segments = decodeURIComponent(parsed.pathname).split('/').filter(Boolean);
      const parameters = new Map([...parsed.searchParams].map(([key, item]) => [key.toLowerCase(), item]));
      const logNumber = parameters.get('logno') ?? parameters.get('postno');
      if (host === 'tsusai.blog.me') {
        if (segments.length === 1 && segments[0] === id) return true;
        continue;
      }
      if (!['blog.naver.com', 'm.blog.naver.com'].includes(host)) continue;
      const ownerPath = segments[0]?.toLowerCase() === 'tsusai';
      const ownerQuery = parameters.get('blogid')?.toLowerCase() === 'tsusai';
      if ((ownerPath && (segments[1] === id || logNumber === id)) || (ownerQuery && logNumber === id)) return true;
    } catch {
      // A malformed candidate is still covered by the exact private-ID scan.
    }
  }
  return false;
}

function safePublicArtifactLabel(filePath, privateRecords) {
  let label = relative(filePath);
  for (const record of privateRecords) label = label.replaceAll(String(record.source_id), '[private-id]');
  return label;
}

function sortedElementSources($root, selector) {
  return $root(selector).toArray()
    .map((element) => $root(element).attr('src'))
    .filter(Boolean)
    .sort();
}

const NAVER_CHROME_MARKERS = [
  /URL\s*복사/u,
  /본문\s*기타\s*기능/u,
  /수정하기\s*공유하기\s*삭제하기/u,
];

function containsNaverChrome(value) {
  const text = decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').normalize('NFC');
  return NAVER_CHROME_MARKERS.some((marker) => marker.test(text));
}

function compactPublicText(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .trim();
}

function zeroWidthCount(value) {
  return String(value ?? '').match(/[\u200B-\u200D\uFEFF]/g)?.length ?? 0;
}

function expectedNaverPresentationText(normalizedBody, post, registry) {
  const canonicalPath = projectionByIdentity.get(`naver:${post.source_id}`)?.canonicalPath ?? '/missing-sequence/naver';
  const transformed = transformPublicPostLinks(normalizedBody, {
    post: {
      source: 'naver',
      sourceId: String(post.source_id),
      canonicalPath,
    },
    registry,
  }).html;
  const $ = cheerio.load(transformed, null, false);
  $('.se_documentTitle').each((_, element) => {
    const wrapper = $(element).closest('.se_component_wrap');
    (wrapper.length ? wrapper : $(element)).remove();
  });
  $(
    '.se_doc_header_start, .se_viewer_head, .se_doc_header_end, .se_doc_contents_start, '
    + '.naver-media-placeholder, ._naverVideo, .prismplayer-area, video, '
    + 'script, style, noscript, template',
  ).remove();
  const bodyText = compactPublicText($.root().text());
  return {
    bodyText,
    description: bodyText.slice(0, 260),
    visibleImageCount: $('img').length,
  };
}

function expectedRenderedPresentationText(body) {
  const presentation = body.clone();
  presentation.find('script, style, noscript, template').remove();
  return {
    bodyText: compactPublicText(presentation.text()),
    visibleImageCount: presentation.find('img').length,
  };
}

function isStructuralPhotoPost({ bodyText, visibleImageCount }) {
  return visibleImageCount >= 8
    || (visibleImageCount >= 4 && bodyText.length / visibleImageCount < 400)
    || (visibleImageCount >= 1 && visibleImageCount <= 3 && bodyText.length < 120);
}

function isRawPhotoPost(normalizedBody) {
  const imageCount = normalizedBody.match(/<img\b|!\[[^\]]*\]\(/g)?.length ?? 0;
  const textLength = normalizedBody
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>\[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
  return imageCount >= 8 || (imageCount >= 4 && textLength / imageCount < 400);
}

function relativeLuminance(hex) {
  const channels = hex.match(/[a-f0-9]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const linear = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function mediaSequence($root, selector) {
  return $root(selector).toArray().map((element) => {
    const item = $root(element);
    return [
      element.tagName,
      item.attr('src') ?? '',
      item.attr('poster') ?? '',
    ].join('|');
  });
}

function videoSource($root, element) {
  const video = $root(element);
  return video.attr('src')?.trim() || video.find('source[src]').first().attr('src')?.trim() || '';
}

const tistory = await loadJson('migration/source-inventory/tistory-posts.json', 'tistory.inventory.read');
const naverPublic = await loadJson('migration/source-inventory/naver-public-posts.json', 'naver.public-summary.read');
const publicProjection = await loadJson('src/data/public-sequence-v1.json', 'sequence.public-projection.read');

const tistoryPosts = tistory?.posts ?? [];
const naverPublicPosts = naverPublic?.posts ?? [];
const privateState = await loadPrivateAllowedRecords();
const privateRecords = privateState.records;
if (tistoryPosts.length !== EXPECTED_TISTORY) issue('build.expected-count', `Tistory source has ${tistoryPosts.length} posts; expected 164.`);
if (naverPublicPosts.length < EXPECTED_NAVER_PUBLIC) issue('build.expected-count', `Naver public source lost one or more of its 185 genesis posts.`);
if (naverPublicPosts.some((post) => post.migration_status !== 'verified')) issue('build.source-status', 'The Naver public summary includes unverified posts.');
if (naverPublicPosts.some((post) => (
  post.version !== EXPECTED_DERIVED_VERSION
  || post.normalization_version !== EXPECTED_NORMALIZATION_VERSION
))) {
  issue('build.source-version', 'The Naver public summary must use derived schema 2 and normalization version 3.');
}

const projectionEntries = Array.isArray(publicProjection) ? publicProjection : [];
const projectionByIdentity = new Map(projectionEntries.map((entry) => [`${entry.source}:${entry.sourceId}`, entry]));
const baselineProjection = projectionEntries.length === EXPECTED_IMPORTED_PUBLIC_TOTAL
  && publicProjectionDigest(projectionEntries) === BOOTSTRAP_PUBLIC_PROJECTION_SHA256;
const expectedPublicTotal = projectionEntries.length;
if (baselineProjection && privateState.authoritative && privateRecords.length !== EXPECTED_NAVER_PRIVATE) {
  issue('build.expected-count', `Naver current private metadata has ${privateRecords.length} posts at the genesis projection; expected 247.`);
}
function projectedPost(source, id) {
  const address = projectionByIdentity.get(`${source}:${id}`);
  if (!address) {
    issue('build.public-projection', `A public ${source} source has no sequence projection.`);
    return { source, id, path: `/missing-sequence/${source}`, globalSequence: -1, legacyPaths: [] };
  }
  return {
    source,
    id,
    path: address.canonicalPath,
    globalSequence: address.globalSequence,
    legacyPaths: address.legacyPaths,
  };
}
const tistoryById = new Map(tistoryPosts.map((post) => [String(post.source_id), post]));
const naverById = new Map(naverPublicPosts.map((post) => [String(post.source_id), post]));
let projectedContent = [];
try {
  projectedContent = await loadProjectionBackedPublicContent(ROOT, projectionEntries);
} catch {
  issue('build.public-projection', 'Public projection and prepared public content could not be joined safely.');
}
const projectedContentByIdentity = new Map(projectedContent.map((post) => [`${post.source}:${post.sourceId}`, post]));
for (const entry of projectionEntries) {
  if (!projectedContentByIdentity.has(`${entry.source}:${entry.sourceId}`)) {
    issue('build.public-projection', 'A projected public identity has no prepared public content entry.');
  }
}
function inferredNaverEditorGeneration(body) {
  if (/naver-content--smarteditor-3/u.test(body)) return 'smarteditor-3';
  if (/naver-content--smarteditor-one/u.test(body)) return 'smarteditor-one';
  return 'legacy-smarteditor';
}
const activeTistoryPosts = projectedContent
  .filter((post) => post.source === 'tistory')
  .map((post) => {
    const manifest = tistoryById.get(post.sourceId);
    return {
      ...(manifest ?? {}),
      source_id: post.sourceId,
      content_path: path.relative(ROOT, post.file),
      media: manifest?.media ?? [],
      projection_content: post,
      manifest_backed: Boolean(manifest),
    };
  });
const activeNaverPublicPosts = projectedContent
  .filter((post) => post.source === 'naver')
  .map((post) => {
    const manifest = naverById.get(post.sourceId);
    const derivedVideoPaths = post.assetPaths
      .filter((assetPath) => assetPath.startsWith(`/media/naver/${post.sourceId}/videos/`))
      .map((local_path) => ({ status: 'downloaded', local_path }));
    return {
      ...(manifest ?? {}),
      source_id: post.sourceId,
      normalized_path: path.relative(ROOT, post.file),
      editor_generation: manifest?.editor_generation ?? inferredNaverEditorGeneration(post.body),
      images: manifest?.images ?? [],
      videos: manifest?.videos ?? derivedVideoPaths,
      attachments: manifest?.attachments ?? [],
      projection_content: post,
      manifest_backed: Boolean(manifest),
    };
  });
const activeNativePosts = projectedContent.filter((post) => post.source === 'native');
const expectedPosts = projectedContent.map((post) => projectedPost(post.source, post.sourceId));
const expectedPaths = new Set(expectedPosts.map((post) => post.path));
const projectedPath = (source, sourceId) => projectionByIdentity.get(`${source}:${sourceId}`)?.canonicalPath
  ?? `/missing-sequence/${source}`;
if (expectedPosts.length !== expectedPublicTotal || expectedPaths.size !== expectedPublicTotal) {
  issue('build.expected-count', `Expected public route set has ${expectedPaths.size}/${expectedPublicTotal} unique paths.`);
}
if (projectionEntries.length !== expectedPublicTotal
  || projectionByIdentity.size !== expectedPublicTotal
  || projectionEntries.some((entry) => !expectedPaths.has(entry.canonicalPath))) {
  issue('build.public-projection', `Public projection has inconsistent entry, identity, or route counts.`);
}
let publicLinkRegistry;
try {
  publicLinkRegistry = createPublicLinkRegistry(expectedPosts.map((post) => ({
    source: post.source,
    sourceId: post.id,
    globalSequence: post.globalSequence,
    canonicalPath: post.path,
    legacyPaths: post.legacyPaths,
    visibility: 'public',
  })));
} catch (error) {
  issue('build.public-link-registry', error.message);
  publicLinkRegistry = createPublicLinkRegistry([]);
}

for (const post of expectedPosts) {
  const routeFile = path.join(DIST, post.path.replace(/^\/+/, ''), 'index.html');
  try {
    const html = await readFile(routeFile, 'utf8');
    const $ = cheerio.load(html);
    const expectedUrl = `https://dwnc.me${post.path}`;
    if ($('link[rel="canonical"]').attr('href') !== expectedUrl
      || $('meta[property="og:url"]').attr('content') !== expectedUrl) {
      issue('build.route.canonical', `${relative(routeFile)} has no exact matching canonical and Open Graph URL.`);
    }
  } catch {
    issue('build.route.missing', `Built ${post.source} route is missing (${post.id}).`);
  }
}

let renderedNaverBodies = 0;
let renderedNaverBodyImages = 0;
let smartEditor3MetadataPosts = 0;
let metadataChromeMatches = 0;
let metadataDerivedMismatches = 0;
let naverVideoTotal = 0;
let naverLocalVideos = 0;
let naverGifLoops = 0;
let naverControlledVideos = 0;
let naverUnavailableVideos = 0;
let naverFallbacksWithDuration = 0;
let naverVideoCaptions = 0;
let recoverableUnlinkedVideos = 0;
let accessibleNamedFallbacks = 0;
const fallbackLabelIds = new Set();
let structuralPhotoPosts = 0;
let structuralLongformPosts = 0;
let shortVisualPosts = 0;
let classificationMismatches = 0;
let rawStructuralDifferences = 0;
let routeDescriptionZeroWidthCharacters = 0;
let routeOgDescriptionZeroWidthCharacters = 0;
const expectedNaverMetadata = new Map();
for (const post of activeNaverPublicPosts) {
  const canonicalPath = projectedPath('naver', post.source_id);
  const routeFile = path.join(DIST, canonicalPath.replace(/^\/+/, ''), 'index.html');
  try {
    const [builtHtml, normalizedMarkdown] = await Promise.all([
      readFile(routeFile, 'utf8'),
      readFile(path.join(ROOT, post.normalized_path), 'utf8'),
    ]);
    const normalizedBody = normalizedMarkdown.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    const expectedMetadata = expectedNaverPresentationText(normalizedBody, post, publicLinkRegistry);
    expectedNaverMetadata.set(canonicalPath, expectedMetadata);
    const $expected = cheerio.load(normalizedBody, null, false);
    const $built = cheerio.load(builtHtml);
    const expectedBodies = $expected('.naver-content');
    const builtBodies = $built('.prose > .naver-content');
    if (expectedBodies.length !== 1 || builtBodies.length !== 1) {
      issue('build.naver.render-wrapper', `${relative(routeFile)} does not contain exactly one rendered Naver body wrapper.`);
      continue;
    }
    renderedNaverBodies += 1;
    const expectedPhoto = isStructuralPhotoPost(expectedMetadata);
    const builtArticle = $built('.article-page').first();
    const builtPhoto = builtArticle.hasClass('article-page--photo');
    const builtLongform = builtArticle.hasClass('article-page--longform');
    if (expectedPhoto) structuralPhotoPosts += 1;
    else structuralLongformPosts += 1;
    if (expectedMetadata.visibleImageCount >= 1
      && expectedMetadata.visibleImageCount <= 3
      && expectedMetadata.bodyText.length < 120) shortVisualPosts += 1;
    if (isRawPhotoPost(normalizedBody) !== expectedPhoto) rawStructuralDifferences += 1;
    if ((expectedPhoto && !builtPhoto) || (!expectedPhoto && !builtLongform)) {
      classificationMismatches += 1;
      issue('build.article.classification', `${relative(routeFile)} differs from its structural photo/longform classification.`);
    }
    const routeDescription = $built('meta[name="description"]').attr('content') ?? '';
    const routeOgDescription = $built('meta[property="og:description"]').attr('content') ?? '';
    routeDescriptionZeroWidthCharacters += zeroWidthCount(routeDescription);
    routeOgDescriptionZeroWidthCharacters += zeroWidthCount(routeOgDescription);
    if (zeroWidthCount(routeDescription) || zeroWidthCount(routeOgDescription)) {
      issue('build.metadata.zero-width', `${relative(routeFile)} exposes zero-width characters in derived metadata.`);
    }
    if (post.editor_generation === 'smarteditor-3') {
      smartEditor3MetadataPosts += 1;
      const descriptions = [
        $built('meta[name="description"]').attr('content') ?? '',
        $built('meta[property="og:description"]').attr('content') ?? '',
      ];
      for (const description of descriptions) {
        if (description !== expectedMetadata.description) {
          metadataDerivedMismatches += 1;
          issue('build.naver.metadata-derived', `${relative(routeFile)} has metadata that differs from the structurally derived excerpt.`);
        }
        if (!containsNaverChrome(description)) continue;
        metadataChromeMatches += 1;
        issue('build.naver.metadata-chrome', `${relative(routeFile)} exposes SmartEditor chrome in derived metadata.`);
      }
    }
    if (builtBodies.find('pre.astro-code').length || builtBodies.find('pre code').text().includes('<div')) {
      issue('build.naver.render-code-block', `${relative(routeFile)} rendered normalized Naver HTML as a code block.`);
    }
    const expectedImages = sortedElementSources($expected, '.naver-content img[src]');
    const builtImages = sortedElementSources($built, '.prose > .naver-content img[src]');
    if (JSON.stringify(expectedImages) !== JSON.stringify(builtImages)) {
      issue('build.naver.render-images', `${relative(routeFile)} has a rendered body-image mismatch.`);
    }
    renderedNaverBodyImages += builtImages.length;
    const expectedIframes = sortedElementSources($expected, '.naver-content iframe[src]');
    const builtIframes = sortedElementSources($built, '.prose > .naver-content iframe[src]');
    if (JSON.stringify(expectedIframes) !== JSON.stringify(builtIframes)) {
      issue('build.naver.render-iframes', `${relative(routeFile)} has a rendered iframe mismatch.`);
    }

    const expectedMedia = mediaSequence($expected, '.naver-content :is(img, video, iframe)');
    const builtMedia = mediaSequence($built, '.prose > .naver-content :is(img, video, iframe)');
    if (JSON.stringify(expectedMedia) !== JSON.stringify(builtMedia)) {
      issue('build.naver.render-media-order', `${relative(routeFile)} changed the normalized media sequence.`);
    }

    const expectedVideos = expectedBodies.find('video').toArray();
    const builtVideos = builtBodies.find('video').toArray();
    if (expectedVideos.length !== builtVideos.length) {
      issue('build.naver.video-count', `${relative(routeFile)} changed the normalized video count.`);
    }
    naverVideoTotal += builtVideos.length;

    const expectedLocalSources = expectedVideos
      .map((element) => videoSource($expected, element))
      .filter(Boolean)
      .sort();
    const manifestLocalSources = (post.videos ?? [])
      .filter((video) => video.status === 'downloaded' && video.local_path)
      .map((video) => video.local_path)
      .sort();
    if (JSON.stringify(expectedLocalSources) !== JSON.stringify(manifestLocalSources)) {
      const expectedSet = new Set(expectedLocalSources);
      const manifestSet = new Set(manifestLocalSources);
      recoverableUnlinkedVideos += [
        ...expectedLocalSources.filter((source) => !manifestSet.has(source)),
        ...manifestLocalSources.filter((source) => !expectedSet.has(source)),
      ].length;
      issue('build.naver.video-manifest', `${relative(routeFile)} has an unlinked local video or a stale video manifest reference.`);
    }

    const expectedCaptions = expectedBodies.find('.se_component.se_video .se_mediaCaption').toArray()
      .map((element) => compactPublicText($expected(element).text()))
      .filter(Boolean);
    const builtCaptions = builtBodies.find('.se_component.se_video .se_mediaCaption').toArray()
      .map((element) => compactPublicText($built(element).text()))
      .filter(Boolean);
    naverVideoCaptions += builtCaptions.length;
    if (JSON.stringify(expectedCaptions) !== JSON.stringify(builtCaptions)) {
      issue('build.naver.video-caption', `${relative(routeFile)} changed an author-written video caption.`);
    }

    for (const [videoIndex, element] of builtVideos.entries()) {
      const video = $built(element);
      const source = videoSource($built, element);
      if (source) {
        naverLocalVideos += 1;
        if (!source.startsWith(`/media/naver/${post.source_id}/videos/`)) {
          issue('build.naver.video-path', `${relative(routeFile)} has a non-local direct video source.`);
        }
        if (video.hasClass('_gifmp4')) {
          naverGifLoops += 1;
          for (const attribute of ['autoplay', 'muted', 'loop', 'playsinline']) {
            if (!video.is(`[${attribute}]`)) {
              issue('build.naver.video-policy', `${relative(routeFile)} has a GIF-style video without ${attribute}.`);
            }
          }
          if (video.is('[controls]')) issue('build.naver.video-policy', `${relative(routeFile)} gives GIF-style video controls.`);
        } else {
          naverControlledVideos += 1;
          if (!video.is('[controls][playsinline]')) {
            issue('build.naver.video-policy', `${relative(routeFile)} has a direct video without accessible controls.`);
          }
        }
        continue;
      }

      naverUnavailableVideos += 1;
      const fallback = video.siblings('[data-video-fallback="unavailable"]').first();
      const fallbackRoot = video.closest('.se_component.se_video, ._naverVideo._vnl');
      const fallbackText = visibleText(fallback.html() ?? '');
      const expectedLabelId = `naver-video-${post.source_id}-${String(videoIndex + 1).padStart(3, '0')}-title`;
      const labelledBy = fallback.attr('aria-labelledby') ?? '';
      const fallbackLabel = fallback.find('strong[id]').first();
      const hasUniqueLabel = labelledBy === expectedLabelId
        && fallbackLabel.attr('id') === expectedLabelId
        && compactPublicText(fallbackLabel.text()).length > 0
        && !fallbackLabelIds.has(labelledBy);
      if (fallback.attr('role') === 'note' && hasUniqueLabel) accessibleNamedFallbacks += 1;
      else issue('build.naver.video-fallback-a11y', `${relative(routeFile)} has a fallback without its deterministic accessible label.`);
      if (labelledBy) fallbackLabelIds.add(labelledBy);
      if (/영상 길이\s+\d{2}:\d{2}/u.test(fallbackText)) naverFallbacksWithDuration += 1;
      if (!video.hasClass('naver-video--unavailable')
        || video.attr('aria-hidden') !== 'true'
        || fallback.length !== 1
        || !fallbackText.includes('현재 재생할 수 없습니다')
        || fallbackRoot.find('.pzp, .prismplayer-area, .webplayer-internal-core-shadow').length) {
        issue('build.naver.video-fallback', `${relative(routeFile)} has an inoperable source-less video without an explicit fallback.`);
      }
    }
  } catch {
    issue('build.naver.render-read', `A public Naver route or normalized source could not be inspected (${post.source_id}).`);
  }
}

let renderedTistoryBodies = 0;
for (const post of activeTistoryPosts) {
  const canonicalPath = projectedPath('tistory', post.source_id);
  const routeFile = path.join(DIST, canonicalPath.replace(/^\/+/, ''), 'index.html');
  try {
    const [builtHtml, normalizedMarkdown] = await Promise.all([
      readFile(routeFile, 'utf8'),
      readFile(path.join(ROOT, post.content_path), 'utf8'),
    ]);
    const normalizedBody = normalizedMarkdown.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    const $built = cheerio.load(builtHtml);
    const builtBodies = $built('.prose > .legacy-content');
    if (builtBodies.length !== 1) {
      issue('build.tistory.render-regression', `${relative(routeFile)} no longer renders exactly one legacy body.`);
    } else {
      renderedTistoryBodies += 1;
    }
    const expectedPresentation = expectedRenderedPresentationText(builtBodies);
    const expectedPhoto = isStructuralPhotoPost(expectedPresentation);
    const builtArticle = $built('.article-page').first();
    const builtPhoto = builtArticle.hasClass('article-page--photo');
    const builtLongform = builtArticle.hasClass('article-page--longform');
    if (expectedPhoto) structuralPhotoPosts += 1;
    else structuralLongformPosts += 1;
    if (expectedPresentation.visibleImageCount >= 1
      && expectedPresentation.visibleImageCount <= 3
      && expectedPresentation.bodyText.length < 120) shortVisualPosts += 1;
    if (isRawPhotoPost(normalizedBody) !== expectedPhoto) rawStructuralDifferences += 1;
    if ((expectedPhoto && !builtPhoto) || (!expectedPhoto && !builtLongform)) {
      classificationMismatches += 1;
      issue('build.article.classification', `${relative(routeFile)} differs from its structural photo/longform classification.`);
    }
    const routeDescription = $built('meta[name="description"]').attr('content') ?? '';
    const routeOgDescription = $built('meta[property="og:description"]').attr('content') ?? '';
    routeDescriptionZeroWidthCharacters += zeroWidthCount(routeDescription);
    routeOgDescriptionZeroWidthCharacters += zeroWidthCount(routeOgDescription);
    if (zeroWidthCount(routeDescription) || zeroWidthCount(routeOgDescription)) {
      issue('build.metadata.zero-width', `${relative(routeFile)} exposes zero-width characters in derived metadata.`);
    }
  } catch {
    issue('build.tistory.render-read', `A public Tistory route could not be inspected (${post.source_id}).`);
  }
}
for (const post of activeNativePosts) {
  const routeFile = path.join(DIST, post.canonicalPath.replace(/^\/+/, ''), 'index.html');
  try {
    const builtHtml = await readFile(routeFile, 'utf8');
    const $built = cheerio.load(builtHtml);
    const builtBody = $built('.prose').first();
    if (builtBody.length !== 1) {
      issue('build.native.render-regression', `${relative(routeFile)} no longer renders exactly one public body.`);
      continue;
    }
    const expectedPresentation = expectedRenderedPresentationText(builtBody);
    const expectedPhoto = isStructuralPhotoPost(expectedPresentation);
    const builtArticle = $built('.article-page').first();
    if (expectedPhoto) structuralPhotoPosts += 1;
    else structuralLongformPosts += 1;
    if (expectedPresentation.visibleImageCount >= 1
      && expectedPresentation.visibleImageCount <= 3
      && expectedPresentation.bodyText.length < 120) shortVisualPosts += 1;
    if (isRawPhotoPost(post.body) !== expectedPhoto) rawStructuralDifferences += 1;
    if ((expectedPhoto && !builtArticle.hasClass('article-page--photo'))
      || (!expectedPhoto && !builtArticle.hasClass('article-page--longform'))) {
      classificationMismatches += 1;
      issue('build.article.classification', `${relative(routeFile)} differs from its structural photo/longform classification.`);
    }
    for (const description of [
      $built('meta[name="description"]').attr('content') ?? '',
      $built('meta[property="og:description"]').attr('content') ?? '',
    ]) {
      if (zeroWidthCount(description)) issue('build.metadata.zero-width', `${relative(routeFile)} exposes zero-width characters in derived metadata.`);
    }
  } catch {
    issue('build.native.render-read', 'A projected native route could not be inspected.');
  }
}
for (const record of privateRecords) {
  await expectMissing(path.join(DIST, 'naver', String(record.source_id), 'index.html'));
}

const actualTistoryRoutes = new Set();
for (const entry of await readdir(DIST, { withFileTypes: true }).catch(() => [])) {
  if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
  try {
    const routeStat = await lstat(path.join(DIST, entry.name, 'index.html'));
    if (routeStat.isFile()) actualTistoryRoutes.add(`/${entry.name}`);
  } catch {
    // A numeric asset directory without a route is not a post route.
  }
}
const actualNaverRoutes = new Set();
for (const entry of await readdir(path.join(DIST, 'naver'), { withFileTypes: true }).catch(() => [])) {
  if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
  try {
    const routeStat = await lstat(path.join(DIST, 'naver', entry.name, 'index.html'));
    if (routeStat.isFile()) actualNaverRoutes.add(`/naver/${entry.name}`);
  } catch {
    // Ignore incomplete non-route directories; the expected-route check reports missing pages.
  }
}
const actualCanonicalRoutes = new Set();
for (const entry of await readdir(path.join(DIST, 'posts'), { withFileTypes: true }).catch(() => [])) {
  if (!entry.isDirectory() || !/^[1-9]\d*$/.test(entry.name)) continue;
  try {
    const routeStat = await lstat(path.join(DIST, 'posts', entry.name, 'index.html'));
    if (routeStat.isFile()) actualCanonicalRoutes.add(`/posts/${entry.name}`);
  } catch {
    // Ignore incomplete non-route directories; the expected-route check reports missing pages.
  }
}
const expectedTistoryAliases = new Set(expectedPosts.filter((post) => post.source === 'tistory').flatMap((post) => post.legacyPaths));
const expectedNaverAliases = new Set(expectedPosts.filter((post) => post.source === 'naver').flatMap((post) => post.legacyPaths));
for (const route of actualTistoryRoutes) if (!expectedTistoryAliases.has(route)) issue('build.route.unexpected', `Unexpected numeric alias route was built (${route}).`);
for (const route of actualNaverRoutes) if (!expectedNaverAliases.has(route)) issue('build.route.unexpected', `Unexpected Naver alias route was built (${route}).`);
for (const route of actualCanonicalRoutes) if (!expectedPaths.has(route)) issue('build.route.unexpected', `Unexpected sequence canonical route was built (${route}).`);
if (actualTistoryRoutes.size !== expectedTistoryAliases.size) issue('build.route.count', `Built Tistory route count differs from the current projection.`);
if (actualNaverRoutes.size !== expectedNaverAliases.size) issue('build.route.count', `Built Naver route count differs from the current projection.`);
if (actualCanonicalRoutes.size !== expectedPublicTotal) issue('build.route.count', `Built sequence canonical route count is ${actualCanonicalRoutes.size}; expected ${expectedPublicTotal}.`);

let validatedAliases = 0;
for (const post of expectedPosts) {
  for (const legacyPath of post.legacyPaths) {
    const file = path.join(DIST, legacyPath.replace(/^\/+/, ''), 'index.html');
    try {
      const html = await readFile(file, 'utf8');
      const $ = cheerio.load(html);
      const canonical = $('link[rel="canonical"]').attr('href');
      const robots = $('meta[name="robots"]').attr('content') ?? '';
      const refresh = $('meta[http-equiv="refresh" i]').attr('content') ?? '';
      const scripts = $('script').text();
      const fallbackLinks = $('body a').toArray().map((element) => $(element).attr('href'));
      if (canonical !== `https://dwnc.me${post.path}`
        || !robots.toLowerCase().split(/\s*,\s*/).includes('noindex')
        || refresh !== `0;url=${post.path}`
        || !scripts.includes(`window.location.replace(${JSON.stringify(post.path)})`)
        || fallbackLinks.length !== 1
        || fallbackLinks[0] !== post.path
        || $('.article-page').length
        || visibleText($('body').html() ?? '') !== '글로 이동합니다. 계속하기') {
        issue('build.alias-contract', 'A legacy alias does not satisfy the generic noindex/canonical/refresh/JS/fallback contract.');
      }
      validatedAliases += 1;
    } catch {
      issue('build.alias-contract', 'A required public legacy alias is missing or unreadable.');
    }
  }
}
const expectedAliasTotal = expectedPosts.reduce((sum, post) => sum + post.legacyPaths.length, 0);
if (validatedAliases !== expectedAliasTotal) {
  issue('build.alias-count', `Validated ${validatedAliases} legacy aliases; expected ${expectedAliasTotal}.`);
}

let searchIndex = [];
try {
  searchIndex = JSON.parse(await readFile(path.join(DIST, 'search-index.json'), 'utf8'));
} catch {
  issue('build.search.read', 'dist/search-index.json is missing or invalid.');
}
const searchPaths = new Set(searchIndex.map((post) => post.path));
if (searchIndex.length !== expectedPublicTotal || searchPaths.size !== expectedPublicTotal) {
  issue('build.search.count', `Search index has ${searchIndex.length} records and ${searchPaths.size} unique paths; expected ${expectedPublicTotal}.`);
}
for (const expectedPath of expectedPaths) if (!searchPaths.has(expectedPath)) issue('build.search.missing', `Search index is missing a public route (${expectedPath}).`);
for (const searchPath of searchPaths) if (!expectedPaths.has(searchPath)) issue('build.search.unexpected', `Search index contains an unexpected route (${searchPath}).`);
let searchDescriptionZeroWidthCharacters = 0;
let searchTextZeroWidthCharacters = 0;
for (const entry of searchIndex) {
  searchDescriptionZeroWidthCharacters += zeroWidthCount(entry?.description);
  searchTextZeroWidthCharacters += zeroWidthCount(entry?.searchText);
}
if (searchDescriptionZeroWidthCharacters || searchTextZeroWidthCharacters) {
  issue(
    'build.search.zero-width',
    `Search output contains ${searchDescriptionZeroWidthCharacters} description and ${searchTextZeroWidthCharacters} search-text zero-width characters.`,
  );
}
for (const post of activeNaverPublicPosts.filter((item) => item.editor_generation === 'smarteditor-3')) {
  const canonicalPath = projectedPath('naver', post.source_id);
  const entry = searchIndex.find((item) => item.path === canonicalPath);
  const expectedMetadata = expectedNaverMetadata.get(canonicalPath);
  if (!expectedMetadata
    || entry?.description !== expectedMetadata.description
    || !String(entry?.searchText ?? '').endsWith(expectedMetadata.bodyText.toLocaleLowerCase('ko-KR'))) {
    metadataDerivedMismatches += 1;
    issue('build.naver.metadata-derived', `Search metadata differs from the structurally derived SmartEditor content (${post.source_id}).`);
  }
  for (const value of [entry?.description ?? '', entry?.searchText ?? '']) {
    if (!containsNaverChrome(value)) continue;
    metadataChromeMatches += 1;
    issue('build.naver.metadata-chrome', `Search metadata exposes SmartEditor chrome (${post.source_id}).`);
  }
}

let rss = '';
try { rss = await readFile(path.join(DIST, 'rss.xml'), 'utf8'); } catch { issue('build.rss.read', 'dist/rss.xml is missing.'); }
const rssItems = rss.match(/<item>/g)?.length ?? 0;
if (rssItems !== expectedPublicTotal) issue('build.rss.count', `RSS has ${rssItems} items; expected ${expectedPublicTotal}.`);
const $rss = cheerio.load(rss, { xmlMode: true });
const rssDescriptions = new Map();
const expectedRssUrls = new Map([...expectedPaths].map((expectedPath) => [new URL(expectedPath, 'https://dwnc.me').href, expectedPath]));
const seenRssUrls = new Map();
let rssDescriptionZeroWidthCharacters = 0;
$rss('item').each((_, item) => {
  const link = $rss(item).find('link').first().text().trim();
  const guidNode = $rss(item).find('guid').first();
  const guid = guidNode.text().trim();
  const description = $rss(item).find('description').first().text();
  rssDescriptionZeroWidthCharacters += zeroWidthCount(description);
  const expectedPath = expectedRssUrls.get(link);
  if (!expectedPath) issue('build.rss.exact', `RSS has an unexpected non-canonical link (${link || '[empty]'}).`);
  else {
    seenRssUrls.set(link, (seenRssUrls.get(link) ?? 0) + 1);
    rssDescriptions.set(expectedPath, description);
  }
  if (guid !== link) issue('build.rss.exact', `RSS guid differs from its exact canonical link (${guid || '[empty]'} / ${link || '[empty]'}).`);
  if (guidNode.attr('isPermaLink') !== 'true') issue('build.rss.exact', `RSS guid is not marked as a permalink (${link || '[empty]'}).`);
});
for (const expectedUrl of expectedRssUrls.keys()) {
  if (seenRssUrls.get(expectedUrl) !== 1) {
    issue('build.rss.exact', `RSS canonical URL occurs ${seenRssUrls.get(expectedUrl) ?? 0} times (${expectedUrl}).`);
  }
}
if (rssDescriptionZeroWidthCharacters) {
  issue('build.rss.zero-width', `RSS descriptions contain ${rssDescriptionZeroWidthCharacters} zero-width characters.`);
}
for (const post of activeNaverPublicPosts.filter((item) => item.editor_generation === 'smarteditor-3')) {
  const canonicalPath = projectedPath('naver', post.source_id);
  const description = rssDescriptions.get(canonicalPath) ?? '';
  const expectedDescription = expectedNaverMetadata.get(canonicalPath)?.description ?? '';
  if (description !== expectedDescription) {
    metadataDerivedMismatches += 1;
    issue('build.naver.metadata-derived', `RSS metadata differs from the structurally derived excerpt (${post.source_id}).`);
  }
  if (!containsNaverChrome(description)) continue;
  metadataChromeMatches += 1;
  issue('build.naver.metadata-chrome', `RSS metadata exposes SmartEditor chrome (${post.source_id}).`);
}

const activeSmartEditor3 = activeNaverPublicPosts.filter((post) => post.editor_generation === 'smarteditor-3').length;
if (smartEditor3MetadataPosts !== activeSmartEditor3) {
  issue('build.naver.metadata-count', `Metadata audit covered ${smartEditor3MetadataPosts}/${activeSmartEditor3} projected SmartEditor3 posts.`);
}
if (baselineProjection && (naverVideoTotal !== EXPECTED_NAVER_VIDEOS
  || naverLocalVideos !== EXPECTED_NAVER_LOCAL_VIDEOS
  || naverUnavailableVideos !== EXPECTED_NAVER_VIDEO_FALLBACKS)) {
  issue(
    'build.naver.video-count',
    `Video audit found ${naverVideoTotal} total, ${naverLocalVideos} local, and ${naverUnavailableVideos} fallback videos; expected ${EXPECTED_NAVER_VIDEOS}/${EXPECTED_NAVER_LOCAL_VIDEOS}/${EXPECTED_NAVER_VIDEO_FALLBACKS}.`,
  );
}
if (baselineProjection && naverVideoCaptions !== EXPECTED_NAVER_VIDEO_CAPTIONS) {
  issue('build.naver.video-caption', `Built Naver posts preserve ${naverVideoCaptions} video captions; expected ${EXPECTED_NAVER_VIDEO_CAPTIONS}.`);
}
if (naverFallbacksWithDuration !== naverUnavailableVideos) {
  issue('build.naver.video-fallback', `${naverFallbacksWithDuration}/${naverUnavailableVideos} projected video fallbacks preserve a duration.`);
}
if (accessibleNamedFallbacks !== naverUnavailableVideos
  || fallbackLabelIds.size !== naverUnavailableVideos) {
  issue(
    'build.naver.video-fallback-a11y',
    `${accessibleNamedFallbacks}/${naverUnavailableVideos} fallbacks have accessible names across ${fallbackLabelIds.size} unique IDs.`,
  );
}
if (structuralPhotoPosts + structuralLongformPosts !== expectedPublicTotal) {
  issue('build.article.classification-count', `Structural classification covered ${structuralPhotoPosts + structuralLongformPosts}/${expectedPublicTotal} projected posts.`);
}
if (baselineProjection && (structuralPhotoPosts !== EXPECTED_STRUCTURAL_PHOTO_POSTS
  || structuralLongformPosts !== EXPECTED_STRUCTURAL_LONGFORM_POSTS)) {
  issue(
    'build.article.classification-count',
    `Structural classification produced ${structuralPhotoPosts} photo and ${structuralLongformPosts} longform posts; expected ${EXPECTED_STRUCTURAL_PHOTO_POSTS}/${EXPECTED_STRUCTURAL_LONGFORM_POSTS}.`,
  );
}
if (baselineProjection && shortVisualPosts !== EXPECTED_SHORT_VISUAL_POSTS) {
  issue('build.article.short-visual-count', `Structural classification found ${shortVisualPosts} short visual posts; expected ${EXPECTED_SHORT_VISUAL_POSTS}.`);
}
if (baselineProjection && rawStructuralDifferences !== EXPECTED_RAW_STRUCTURAL_DIFFERENCES) {
  issue('build.article.raw-difference', `Raw and structural classification differ for ${rawStructuralDifferences} posts; expected ${EXPECTED_RAW_STRUCTURAL_DIFFERENCES}.`);
}

const fallbackBackground = '#e7e0d2';
const fallbackTitleColor = '#131313';
const fallbackDescriptionColor = '#625f58';
const fallbackTitleContrast = contrastRatio(fallbackTitleColor, fallbackBackground);
const fallbackDescriptionContrast = contrastRatio(fallbackDescriptionColor, fallbackBackground);
if (fallbackTitleContrast < 4.5 || fallbackDescriptionContrast < 4.5) {
  issue(
    'build.naver.video-fallback-contrast',
    `Fallback contrast is ${fallbackTitleContrast.toFixed(4)}:1 for the title and ${fallbackDescriptionContrast.toFixed(4)}:1 for the description.`,
  );
}
const builtCss = (await Promise.all(
  (await walk(path.join(DIST, '_astro'), { optional: true }))
    .filter((file) => path.extname(file).toLowerCase() === '.css')
    .map((file) => readFile(file, 'utf8')),
)).join('\n');
const fallbackRootRule = builtCss.match(/:has\(\.naver-video-fallback\)\{[^}]+\}/g)?.at(-1) ?? '';
const fallbackTextRule = builtCss.match(/\.naver-video-fallback\{[^}]+\}/g)?.at(-1) ?? '';
const fallbackDescriptionRule = builtCss.match(/\.naver-video-fallback p\{[^}]+\}/g)?.at(-1) ?? '';
const usesExpectedFallbackColors = builtCss.lastIndexOf('--paper-deep:#e7e0d2') > builtCss.lastIndexOf('--paper-deep:#ebe4d5')
  && builtCss.lastIndexOf('--ink:#131313') > builtCss.lastIndexOf('--ink:#172025')
  && builtCss.lastIndexOf('--ink-soft:#625f58') > builtCss.lastIndexOf('--ink-soft:#5d6669')
  && /background:(?:var\(--paper-deep\)|#e7e0d2)/.test(fallbackRootRule)
  && /color:(?:var\(--ink\)|#131313)/.test(fallbackTextRule)
  && /color:(?:var\(--ink-soft\)|#625f58)/.test(fallbackDescriptionRule);
if (!usesExpectedFallbackColors) {
  issue('build.naver.video-fallback-contrast', 'Built CSS does not use the verified AA fallback color tokens.');
}

const sitemapFiles = (await readdir(DIST).catch(() => []))
  .filter((name) => /^sitemap(?:-index|-\d+)?\.xml$/.test(name));
const sitemap = (await Promise.all(sitemapFiles.map((name) => readFile(path.join(DIST, name), 'utf8')))).join('\n');
if (!sitemapFiles.length) issue('build.sitemap.read', 'No built sitemap XML files were found.');
for (const expectedPath of expectedPaths) {
  if (!sitemap.includes(`<loc>https://dwnc.me${expectedPath}</loc>`)) issue('build.sitemap.missing', `Sitemap is missing a public route (${expectedPath}).`);
}
try {
  const rssPaths = $rss('item link').toArray().map((item) => {
    try { return new URL($rss(item).text().trim()).pathname; }
    catch { return ''; }
  }).filter((value) => /^\/posts\/[1-9]\d*$/u.test(value));
  const $sitemap = cheerio.load(sitemap, { xmlMode: true });
  const sitemapPaths = $sitemap('loc').toArray().map((item) => {
    try { return new URL($sitemap(item).text().trim()).pathname; }
    catch { return ''; }
  }).filter((value) => /^\/posts\/[1-9]\d*$/u.test(value));
  validateProjectedPublicSurface(projectedContent, {
    canonicalPaths: [...actualCanonicalRoutes],
    aliases: [...actualTistoryRoutes, ...actualNaverRoutes],
    searchPaths: searchIndex.map((entry) => entry.path),
    rssPaths,
    sitemapPaths,
  });
} catch {
  issue('build.public-surface', 'Canonical, alias, search, RSS, and sitemap publication sets do not exactly match the projection-backed content set.');
}

const referencedTistoryMedia = new Set();
let projectedDistAssets = {
  total: 0,
  bySource: { tistory: 0, naver: 0, native: 0 },
  paths: [],
};
try {
  projectedDistAssets = await validateProjectedDistAssets(DIST, projectedContent);
} catch {
  issue('build.projected-media', 'A current projection asset is missing, corrupt, unsafe, or differs from its manifest/receipt evidence.');
}
for (const post of activeTistoryPosts) {
  if (!post.manifest_backed) continue;
  for (const media of post.media ?? []) {
    if (media.status !== 'downloaded') continue;
    await verifyBuiltMedia(media, `/media/tistory/${post.source_id}/`, `Tistory ${post.source_id} media`, referencedTistoryMedia);
  }
}
const referencedNaverMedia = new Set();
for (const post of activeNaverPublicPosts) {
  if (!post.manifest_backed) continue;
  const assets = [
    ...(post.images ?? []).map((asset) => ({ asset, kind: 'image' })),
    ...(post.videos ?? []).map((asset) => ({ asset, kind: 'video' })),
    ...(post.attachments ?? []).map((asset) => ({ asset, kind: 'attachment' })),
  ];
  for (const { asset, kind } of assets) {
    if (asset.status !== 'downloaded') continue;
    await verifyBuiltMedia(
      asset,
      `/media/naver/${post.source_id}/`,
      `Naver ${post.source_id} ${kind}`,
      referencedNaverMedia,
      kind,
    );
  }
}
if (baselineProjection) {
  for (const [mediaRoot, referenced, code] of [
    [path.join(DIST, 'media/tistory'), referencedTistoryMedia, 'build.media.tistory-unreferenced'],
    [path.join(DIST, 'media/naver'), referencedNaverMedia, 'build.media.naver-unreferenced'],
  ]) {
    for (const file of await walk(mediaRoot, { optional: true })) {
      if (!referenced.has(path.resolve(file))) issue(code, `${relative(file)} is not referenced by a public media manifest.`);
    }
  }
}

const distTextExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt', '.webmanifest', '.xml']);
const distDocuments = [];
for (const file of await walk(DIST, { optional: true })) {
  if (!distTextExtensions.has(path.extname(file).toLowerCase())) continue;
  try {
    const raw = (await readFile(file, 'utf8')).normalize('NFC');
    distDocuments.push({ file, raw, leakText: normalizeLeakText(raw), visible: visibleText(raw) });
  } catch {
    issue('privacy.build-read', `${relative(file)} could not be read.`);
  }
}

const idLeakFiles = new Set();
const routeLeakFiles = new Set();
const originLeakFiles = new Set();
let privateSearchLeak = false;
let privateRssLeak = false;
let privateSitemapLeak = false;
for (const record of privateRecords) {
  const id = String(record.source_id);
  for (const document of distDocuments) {
    if (containsPrivateIdLiteral(document.leakText, id)) idLeakFiles.add(document.file);
    if (containsPrivateCanonicalPath(document.leakText, id)) routeLeakFiles.add(document.file);
    if (containsOwnerOrigin(document.leakText, id)) originLeakFiles.add(document.file);
  }
  if (searchIndex.some((entry) => entry.path === `/naver/${id}`)) privateSearchLeak = true;
  if (rss.includes(`https://dwnc.me/naver/${id}`)) privateRssLeak = true;
  if (sitemap.includes(`<loc>https://dwnc.me/naver/${id}</loc>`)) privateSitemapLeak = true;
}
for (const file of idLeakFiles) {
  issue('privacy.private-id-leak', `${safePublicArtifactLabel(file, privateRecords)} contains a private Naver source identifier.`);
}
for (const file of routeLeakFiles) {
  issue('privacy.private-route-leak', `${safePublicArtifactLabel(file, privateRecords)} contains a private Naver canonical path.`);
}
for (const file of originLeakFiles) {
  issue('privacy.private-origin-leak', `${safePublicArtifactLabel(file, privateRecords)} contains a private owner-origin Naver URL.`);
}
if (privateSearchLeak) issue('privacy.private-search', 'dist/search-index.json contains a private Naver route.');
if (privateRssLeak) issue('privacy.private-rss', 'dist/rss.xml contains a private Naver route.');
if (privateSitemapLeak) issue('privacy.private-sitemap', 'A built sitemap contains a private Naver route.');

if (issueBuckets.size) {
  const lines = [];
  for (const [code, bucket] of [...issueBuckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${code}: ${bucket.count} issue(s)`);
    for (const example of bucket.examples) lines.push(`  - ${example}`);
    if (bucket.count > bucket.examples.length) lines.push(`  - ... ${bucket.count - bucket.examples.length} more`);
  }
  console.error(lines.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  routes: {
    canonical: actualCanonicalRoutes.size,
    tistoryAliases: actualTistoryRoutes.size,
    naverAliases: actualNaverRoutes.size,
    aliases: validatedAliases,
    totalArticleHtml: actualCanonicalRoutes.size + actualTistoryRoutes.size + actualNaverRoutes.size,
  },
  searchEntries: searchIndex.length,
  rssItems,
  sitemapFiles: sitemapFiles.length,
  builtMedia: {
    tistory: referencedTistoryMedia.size,
    naver: referencedNaverMedia.size,
    currentProjection: {
      total: projectedDistAssets.total,
      bySource: projectedDistAssets.bySource,
    },
  },
  renderedBodies: {
    tistory: renderedTistoryBodies,
    naver: renderedNaverBodies,
    naverBodyImages: renderedNaverBodyImages,
  },
  publicMetadata: {
    smartEditor3Posts: smartEditor3MetadataPosts,
    chromeMatches: metadataChromeMatches,
    derivedMismatches: metadataDerivedMismatches,
    zeroWidthCharacters: {
      descriptionMeta: routeDescriptionZeroWidthCharacters,
      ogDescriptionMeta: routeOgDescriptionZeroWidthCharacters,
      searchDescription: searchDescriptionZeroWidthCharacters,
      searchText: searchTextZeroWidthCharacters,
      rssDescription: rssDescriptionZeroWidthCharacters,
    },
  },
  articleClassification: {
    photo: structuralPhotoPosts,
    longform: structuralLongformPosts,
    shortVisualRule: shortVisualPosts,
    builtVsStructuralMismatches: classificationMismatches,
    historicalRawVsStructuralDifferences: rawStructuralDifferences,
  },
  naverVideos: {
    total: naverVideoTotal,
    localPlayable: naverLocalVideos,
    gifLoops: naverGifLoops,
    controlled: naverControlledVideos,
    unavailableFallbacks: naverUnavailableVideos,
    fallbacksWithDuration: naverFallbacksWithDuration,
    preservedCaptions: naverVideoCaptions,
    recoverableUnlinked: recoverableUnlinkedVideos,
    accessibleNamedFallbacks,
    uniqueFallbackLabelIds: fallbackLabelIds.size,
    fallbackTitleContrast: Number(fallbackTitleContrast.toFixed(4)),
    fallbackDescriptionContrast: Number(fallbackDescriptionContrast.toFixed(4)),
  },
  privacyBoundary: {
    validationScope: privateState.authoritative ? 'authoritative' : 'public-only',
    privateRecords: privateState.authoritative ? privateRecords.length : null,
    leakedRoutesOrMarkers: 0,
  },
}, null, 2));

await import('./validate-global-sequence.mjs');
await import('./validate-taxonomy-build.mjs');
await import('./validate-public-links-build.mjs');
