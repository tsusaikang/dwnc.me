import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  chmod, mkdir, open, readFile, readdir, rename, unlink,
} from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import YAML from 'yaml';

const ROOT = process.cwd();
const INVENTORY_PATH = path.join(ROOT, 'migration/source-inventory/naver-posts.json');
const PUBLIC_INVENTORY_PATH = path.join(ROOT, 'migration/source-inventory/naver-public-posts.json');
const PRIVATE_SUMMARY_PATH = path.join(ROOT, 'migration/private/naver-inventory.json');
const PUBLIC_CONTENT_ROOT = path.join(ROOT, 'src/data/posts/naver');
const PUBLIC_MEDIA_ROOT = path.join(ROOT, 'public/media/naver');
const PRIVATE_ROOT = path.join(ROOT, 'migration/private/naver');
const PUBLIC_VISIBILITY = '전체공개';
const PRIVATE_VISIBILITY = '비공개';
const USER_AGENT = 'dwnc.me owner migration/0.2 (+https://dwnc.me)';
const ALLOWED_NAVER_IFRAME_HOSTS = [
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'mashup.map.naver.com',
];
const DERIVED_MANIFEST_VERSION = 2;
const NORMALIZATION_VERSION = 3;
let privateSourceIds = new Set();

const args = process.argv.slice(2);
const optionValue = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const requestedIds = new Set((optionValue('--ids') ?? '').split(',').filter(Boolean));
const limit = Number(optionValue('--limit') ?? 0);
const includeMedia = args.includes('--media');
const publicOnly = args.includes('--public-only');
const privateOnly = args.includes('--private-only');
const pendingMedia = args.includes('--pending-media');
const force = args.includes('--force');
const quiet = args.includes('--quiet');

if (args.includes('--help')) {
  console.log(`Usage: node scripts/import-naver.mjs [options]

Options:
  --ids=ID,ID       Normalize only specific Naver post IDs
  --limit=N         Normalize the first N selected posts
  --media           Download owned images, direct video files, and resolvable attachments
  --public-only     Process only public posts
  --private-only    Process only private posts
  --pending-media   Process only posts not already media-verified
  --force           Regenerate derived files; immutable raw captures are untouched
  --quiet           Suppress per-post identifiers and detailed failure output
  --self-test       Run normalization fixtures without reading or writing migration data
  --verify-canonical-raw  Verify all v2 canonical raw files without generating outputs
`);
  process.exit(0);
}

if (publicOnly && privateOnly) throw new Error('--public-only and --private-only cannot be combined.');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cleanSpace = (value) => String(value ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const errorMessage = (error) => [
  error?.message,
  error?.cause?.code,
  error?.cause?.message,
].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(': ') || String(error);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfPresent(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sourcePaths(record) {
  const isPrivate = record.visibility === PRIVATE_VISIBILITY;
  const rawDirectory = isPrivate
    ? path.join(PRIVATE_ROOT, record.source_id, 'raw')
    : path.join(ROOT, 'migration/raw/naver', record.source_id);
  const postDirectory = isPrivate ? path.join(PRIVATE_ROOT, record.source_id) : rawDirectory;
  return {
    isPrivate,
    rawDirectory,
    rawManifest: path.join(rawDirectory, 'recapture-v2/manifest.json'),
    derivedManifest: path.join(postDirectory, 'migration.json'),
    normalizedDirectory: isPrivate ? path.join(postDirectory, 'normalized') : PUBLIC_CONTENT_ROOT,
    normalizedPost: isPrivate
      ? path.join(postDirectory, 'normalized/post.md')
      : path.join(PUBLIC_CONTENT_ROOT, `${record.source_id}.md`),
    mediaDirectory: isPrivate ? path.join(postDirectory, 'media') : path.join(PUBLIC_MEDIA_ROOT, record.source_id),
    quarantineDirectory: path.join(postDirectory, 'quarantine/importer-recovery'),
  };
}

function pathInside(filePath, directory) {
  const candidate = path.resolve(filePath);
  const root = path.resolve(directory);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function serializedRootIsClosed(text, metadata) {
  const withoutDoctype = String(text).replace(/^\s*<!doctype[^>]*>\s*/i, '');
  const rootTag = metadata.browser_outer_html?.root_tag
    || withoutDoctype.match(/^\s*<([a-z][a-z0-9:-]*)\b/i)?.[1];
  return Boolean(rootTag && new RegExp(`</${rootTag}>\\s*$`, 'i').test(withoutDoctype));
}

function assertV2Verification(metadata, captureMethod, role, sourceId) {
  if (metadata?.canonical !== true || metadata?.role !== role || metadata?.verification?.verified_complete !== true) {
    throw new Error(`Canonical raw metadata is incomplete for ${sourceId} (${role}).`);
  }
  const verification = metadata.verification;
  if (captureMethod === 'authenticated-rendered-dom-chunked') {
    for (const field of [
      'browser_stable_before_after', 'browser_length_match', 'browser_bytes_match',
      'browser_sha256_match', 'local_root_closed',
    ]) {
      if (verification[field] !== true) throw new Error(`Canonical chunk verification failed for ${sourceId} (${role}/${field}).`);
    }
  } else if (captureMethod === 'authenticated-rendered-dom-v1-verified-complete') {
    for (const field of ['legacy_manifest_bytes_match', 'legacy_manifest_sha256_match', 'local_root_closed']) {
      if (verification[field] !== true) throw new Error(`Canonical promotion verification failed for ${sourceId} (${role}/${field}).`);
    }
    if (role === 'canonical-article-html' && verification.browser_inner_characters_match !== true) {
      throw new Error(`Canonical promoted article lacks browser character verification for ${sourceId}.`);
    }
  } else {
    throw new Error(`Unsupported canonical capture method for ${sourceId}: ${captureMethod}.`);
  }
}

async function readVerifiedManifestFile(metadata, rawDirectory, captureMethod, role, sourceId) {
  assertV2Verification(metadata, captureMethod, role, sourceId);
  if (!metadata.path || !Number.isInteger(metadata.bytes) || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? '')) {
    throw new Error(`Canonical file metadata is invalid for ${sourceId} (${role}).`);
  }
  const diskPath = path.resolve(ROOT, metadata.path);
  if (!pathInside(diskPath, rawDirectory)) throw new Error(`Canonical raw path escaped its storage root for ${sourceId} (${role}).`);
  const bytes = await readFile(diskPath);
  if (bytes.length !== metadata.bytes || sha256(bytes) !== metadata.sha256) {
    throw new Error(`Canonical raw integrity mismatch for ${sourceId} (${role}).`);
  }
  const text = bytes.toString('utf8');
  if (Number.isInteger(metadata.characters) && text.length !== metadata.characters) {
    throw new Error(`Canonical raw character count mismatch for ${sourceId} (${role}).`);
  }
  if (!serializedRootIsClosed(text, metadata)) throw new Error(`Canonical raw root is not closed for ${sourceId} (${role}).`);
  return text;
}

async function readCanonicalRaw(paths, record) {
  const manifest = await readJson(paths.rawManifest);
  const id = String(record.source_id);
  if (manifest.version !== 2
    || manifest.source !== 'naver'
    || String(manifest.source_id) !== id
    || manifest.visibility !== record.visibility) {
    throw new Error(`Canonical raw manifest identity mismatch for ${id}.`);
  }
  if (manifest.canonical_policy?.article_html !== 'files.content'
    || manifest.canonical_policy?.source_wrapper !== 'files.wrapper'
    || manifest.canonical_policy?.frame_page_canonical !== false) {
    throw new Error(`Canonical raw policy mismatch for ${id}.`);
  }

  const [contentHtml] = await Promise.all([
    readVerifiedManifestFile(
      manifest.files?.content,
      paths.rawDirectory,
      manifest.capture_method,
      'canonical-article-html',
      id,
    ),
    readVerifiedManifestFile(
      manifest.files?.wrapper,
      paths.rawDirectory,
      manifest.capture_method,
      'canonical-source-wrapper',
      id,
    ),
  ]);

  const page = manifest.diagnostic?.legacy_page_v1;
  if (!page?.path || page.canonical !== false || page.known_transport_truncated !== true
    || !Number.isInteger(page.bytes) || !/^[a-f0-9]{64}$/.test(page.sha256 ?? '')) {
    throw new Error(`Legacy frame-page diagnostic metadata is invalid for ${id}.`);
  }
  const pagePath = path.resolve(ROOT, page.path);
  if (!pathInside(pagePath, paths.rawDirectory)) throw new Error(`Legacy frame-page diagnostic escaped its storage root for ${id}.`);
  const pageBytes = await readFile(pagePath);
  if (pageBytes.length !== page.bytes || sha256(pageBytes) !== page.sha256) {
    throw new Error(`Legacy frame-page diagnostic integrity mismatch for ${id}.`);
  }
  return { manifest, contentHtml, pageHtml: pageBytes.toString('utf8') };
}

function categoryTrail(value) {
  const pieces = String(value ?? '').split('/').map((piece) => piece.trim()).filter(Boolean);
  return pieces.map((_, index) => pieces.slice(0, index + 1).join('/'));
}

function parseJsonAttribute(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function absoluteUrl(value, baseUrl) {
  if (!value || /^(data|blob|javascript):/i.test(value)) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function isLocalMediaReference(value) {
  return typeof value === 'string'
    && (value.startsWith('../media/') || value.startsWith('/media/naver/'));
}

function naverPostIdFromUrl(value, baseUrl) {
  if (!value || isLocalMediaReference(value)) return null;
  const absolute = absoluteUrl(value, baseUrl);
  if (!absolute) return null;
  const url = new URL(absolute);
  if (url.hostname.toLowerCase() === 'tsusai.blog.me') {
    const ownerAliasMatch = url.pathname.match(/^\/(\d{8,})(?:\D|$)/);
    return ownerAliasMatch?.[1] ?? null;
  }
  if (!/^(?:m\.)?blog\.naver\.com$/i.test(url.hostname)) return null;
  const queryId = url.searchParams.get('logNo');
  if (/^\d{8,}$/.test(queryId ?? '')) return queryId;
  const pathMatch = url.pathname.match(/\/(\d{8,})(?:\D|$)/);
  return pathMatch?.[1] ?? null;
}

function isPrivateNaverPostLink(value, baseUrl) {
  const sourceId = naverPostIdFromUrl(value, baseUrl);
  return sourceId ? privateSourceIds.has(sourceId) : false;
}

function containsPrivateNaverSourceId(value) {
  const text = String(value ?? '');
  for (const sourceId of privateSourceIds) if (text.includes(sourceId)) return true;
  return false;
}

function highResolutionNaverUrl(value, baseUrl) {
  const absolute = absoluteUrl(value, baseUrl);
  if (!absolute) return null;
  const url = new URL(absolute);
  if (/^(postfiles|blogfiles)\.pstatic\.net$/i.test(url.hostname)) {
    url.searchParams.set('type', 'w3840');
  }
  return url.href;
}

function classifyImage(url) {
  if (!url) return 'unresolved';
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (/^(postfiles|blogfiles)\.pstatic\.net$/.test(host) || /(^|\.)blogfiles\.naver\.net$/.test(host)) {
    return 'owned-upload';
  }
  if (host === 'dthumb-phinf.pstatic.net' || host === 'blogpfthumb-phinf.pstatic.net') {
    return 'external-reference';
  }
  if (host.endsWith('.pstatic.net') || host.endsWith('.naver.net')) {
    if (parsed.pathname.includes('/static/blog/blank.gif')) return 'platform-placeholder';
    return 'platform-asset';
  }
  return 'external-reference';
}

function parseImageDataUrl(value) {
  if (!/^data:image\//i.test(value ?? '')) return null;
  const match = String(value).match(/^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  try {
    return {
      mime: match[1].toLowerCase(),
      bytes: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])),
    };
  } catch {
    return null;
  }
}

function selectedImageSource($image, sourceUrl) {
  const dataLink = parseJsonAttribute($image.closest('[data-linkdata]').attr('data-linkdata'));
  const original = dataLink.src
    || dataLink.originalSrc
    || dataLink.originalUrl
    || dataLink.imageUrl
    || null;
  const observed = $image.attr('data-origin-src')
    || $image.attr('data-lazy-src')
    || $image.attr('data-src')
    || $image.attr('src')
    || null;
  const source = original || observed;
  return {
    original_url: absoluteUrl(original, sourceUrl),
    observed_url: absoluteUrl(observed, sourceUrl),
    download_url: highResolutionNaverUrl(source, sourceUrl),
    embedded: parseImageDataUrl(source),
  };
}

function extractBody(contentHtml, editorGeneration, sourceId) {
  const $ = cheerio.load(contentHtml, null, false);
  let $body;
  if (editorGeneration === 'smarteditor-one') {
    $body = $('.se-main-container').first().clone();
  } else if (editorGeneration === 'smarteditor-3') {
    $body = $(`[id^="post-view${sourceId}"], [id^="post-view"]`).first().clone();
  } else {
    $body = $(`#post-view${sourceId}, #postViewArea, [id^="post-view"]`).first().clone();
  }
  if (!$body?.length) throw new Error(`Normalized body root is missing for ${sourceId}.`);
  return $body;
}

function parsePublishedAt(pageHtml, recordDate) {
  const $ = cheerio.load(pageHtml);
  const selectorText = [
    '.se_publishDate', '.postdate', '.post-date', '._postAddDate', '[class*="publishDate"]',
  ].map((selector) => cleanSpace($(selector).first().text())).find(Boolean);
  const [year, month, day] = recordDate.split('-').map(Number);
  const candidates = [selectorText, cleanSpace($.root().text())].filter(Boolean);
  const expression = new RegExp(
    `${year}\\s*[.\\-/]\\s*0?${month}\\s*[.\\-/]\\s*0?${day}\\s*[.]?\\s*(?:(\\d{1,2})\\s*:\\s*(\\d{2}))?`,
  );
  for (const candidate of candidates) {
    const match = candidate.match(expression);
    if (!match) continue;
    const hour = String(Number(match[1] ?? 0)).padStart(2, '0');
    const minute = String(Number(match[2] ?? 0)).padStart(2, '0');
    return `${recordDate}T${hour}:${minute}:00+09:00`;
  }
  return `${recordDate}T00:00:00+09:00`;
}

function tagsFromBody($body) {
  return [...new Set(
    $body.find('.__se-hash-tag, .se-hash-tag, a[href*="PostList.naver?tag="]')
      .toArray()
      .map((element) => cleanSpace($body.find(element).text()).replace(/^#+/, ''))
      .filter(Boolean),
  )];
}

function extensionFor(contentType, url, fallback = '.bin') {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  const known = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-m4v': '.m4v',
    'video/ogg': '.ogv',
    'audio/mpeg': '.mp3',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
  };
  if (known[type]) return known[type];
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(extension)) return extension;
  } catch {
    // Use the fallback for unparseable URLs.
  }
  return fallback;
}

function detectedImageMime(bytes, contentType) {
  const declared = contentType?.split(';')[0].trim().toLowerCase();
  if (declared?.startsWith('image/')) return declared;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 6
    && bytes[0] === 0x00 && bytes[1] === 0x00
    && (bytes[2] === 0x01 || bytes[2] === 0x02) && bytes[3] === 0x00) return 'image/x-icon';
  const prefix = bytes.subarray(0, 16).toString('ascii');
  if (/^GIF8[79]a/.test(prefix)) return 'image/gif';
  if (prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP') return 'image/webp';
  const textPrefix = bytes.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml[\s\S]*?\?>\s*)?<svg\b/i.test(textPrefix)) return 'image/svg+xml';
  return null;
}

async function fetchWithRetry(url, referer, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: '*/*',
          Referer: referer,
          'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const responseError = new Error(`${response.status} ${response.statusText}`);
        responseError.status = response.status;
        throw responseError;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function quarantineFile(filePath, quarantineDirectory, label, isPrivate) {
  const bytes = await readFile(filePath);
  await mkdir(quarantineDirectory, { recursive: true, mode: isPrivate ? 0o700 : 0o755 });
  const quarantinePath = path.join(
    quarantineDirectory,
    `${label}-${sha256(bytes).slice(0, 12)}-${randomUUID()}`,
  );
  await rename(filePath, quarantinePath);
  await chmod(quarantinePath, isPrivate ? 0o600 : 0o644);
  return quarantinePath;
}

async function quarantineStaleTemps(directory, targetName, quarantineDirectory, isPrivate) {
  const prefix = `.${targetName}.`;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.tmp')) continue;
    const tempPath = path.join(directory, entry.name);
    await quarantineFile(tempPath, quarantineDirectory, `stale-temp-${targetName}`, isPrivate);
  }
}

async function writeAtomicFile(filePath, value, { mode, quarantineDirectory }) {
  const directory = path.dirname(filePath);
  const targetName = path.basename(filePath);
  await mkdir(directory, { recursive: true, mode: mode === 0o600 ? 0o700 : 0o755 });
  await quarantineStaleTemps(directory, targetName, quarantineDirectory, mode === 0o600);
  const tempPath = path.join(directory, `.${targetName}.${process.pid}.${randomUUID()}.tmp`);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let handle;
  try {
    handle = await open(tempPath, 'wx', mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
    const committed = await readFile(filePath);
    if (committed.length !== bytes.length || sha256(committed) !== sha256(bytes)) {
      throw new Error(`Atomic commit verification failed for ${filePath}.`);
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

async function writeHashedFile(directory, sequence, bytes, contentType, sourceUrl, paths, prefix = '') {
  const digest = sha256(bytes);
  const extension = extensionFor(contentType, sourceUrl);
  const filename = `${prefix}${String(sequence).padStart(3, '0')}-${digest.slice(0, 12)}${extension}`;
  await mkdir(directory, { recursive: true, mode: paths.isPrivate ? 0o700 : 0o755 });
  const diskPath = path.join(directory, filename);
  await quarantineStaleTemps(directory, filename, paths.quarantineDirectory, paths.isPrivate);
  try {
    const existing = await readFile(diskPath);
    if (existing.length === bytes.length && sha256(existing) === digest) {
      return { digest, filename, diskPath };
    }
    await quarantineFile(diskPath, paths.quarantineDirectory, `stale-${filename}`, paths.isPrivate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeAtomicFile(diskPath, bytes, {
    mode: paths.isPrivate ? 0o600 : 0o644,
    quarantineDirectory: paths.quarantineDirectory,
  });
  return { digest, filename, diskPath };
}

async function readReusableAsset(asset, paths) {
  if (!includeMedia
    || asset?.status !== 'downloaded'
    || !asset.local_path
    || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')
    || !Number.isInteger(asset.size)) return null;
  const diskPath = paths.isPrivate
    ? path.resolve(path.dirname(paths.normalizedPost), asset.local_path)
    : path.resolve(ROOT, 'public', asset.local_path.replace(/^\/+/, ''));
  if (!pathInside(diskPath, paths.mediaDirectory)) return null;
  try {
    const bytes = await readFile(diskPath);
    if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) return null;
    return {
      localPath: asset.local_path,
      digest: asset.sha256,
      size: asset.size,
      mime: asset.mime ?? null,
      bytes,
    };
  } catch {
    return null;
  }
}

function inlineStyleUrls(style) {
  const urls = [];
  const expression = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;
  while ((match = expression.exec(style ?? ''))) {
    if (match[2]) urls.push(match[2]);
  }
  return urls;
}

function replaceInlineStyleUrl(style, source, replacement) {
  return String(style ?? '').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, value) => (
    value === source ? replacement : match
  ));
}

function addImageUsage(byUrl, sources, usage, fallbackKey) {
  const classification = sources.embedded ? 'embedded-data' : classifyImage(sources.download_url);
  const embeddedDigest = sources.embedded ? sha256(sources.embedded.bytes) : null;
  const key = sources.download_url || sources.observed_url || (embeddedDigest ? `embedded:${embeddedDigest}` : fallbackKey);
  const item = byUrl.get(key) ?? {
    key,
    source_url: sources.original_url,
    observed_url: sources.observed_url,
    download_url: sources.download_url,
    classification,
    embedded: sources.embedded ?? null,
    usages: [],
  };
  item.usages.push(usage);
  byUrl.set(key, item);
}

async function acquireImages($body, record, paths, existingImages = []) {
  const byUrl = new Map();
  const reusableByKey = new Map(existingImages.map((asset) => [
    asset.download_url || asset.observed_url || (asset.embedded_source_sha256 ? `embedded:${asset.embedded_source_sha256}` : null),
    asset,
  ]).filter(([key]) => key));

  // Keep ordinary <img> candidates first so existing hash-named files retain their sequence names.
  for (const [index, element] of $body.find('img').toArray().entries()) {
    const $image = $body.find(element);
    addImageUsage(byUrl, selectedImageSource($image, record.source_url), {
      element,
      kind: 'img-src',
    }, `unresolved:img:${index}`);
  }

  for (const [index, element] of $body.find('video[poster]').toArray().entries()) {
    const $video = $body.find(element);
    const observed = $video.attr('poster');
    addImageUsage(byUrl, {
      original_url: absoluteUrl(observed, record.source_url),
      observed_url: absoluteUrl(observed, record.source_url),
      download_url: highResolutionNaverUrl(observed, record.source_url),
      embedded: parseImageDataUrl(observed),
    }, {
      element,
      kind: 'video-poster',
    }, `unresolved:poster:${index}`);
  }

  let styleIndex = 0;
  for (const element of $body.find('[style]').toArray()) {
    const $element = $body.find(element);
    for (const observed of inlineStyleUrls($element.attr('style'))) {
      styleIndex += 1;
      addImageUsage(byUrl, {
        original_url: absoluteUrl(observed, record.source_url),
        observed_url: absoluteUrl(observed, record.source_url),
        download_url: highResolutionNaverUrl(observed, record.source_url),
        embedded: parseImageDataUrl(observed),
      }, {
        element,
        kind: 'inline-background',
        style_source: observed,
      }, `unresolved:style:${styleIndex}`);
    }
  }

  const manifest = [];
  let sequence = 0;
  for (const item of byUrl.values()) {
    sequence += 1;
    const shouldDownload = includeMedia && (
      item.classification === 'embedded-data'
      || (['owned-upload', 'platform-asset'].includes(item.classification) && item.download_url)
    );
    let localPath = null;
    let status = includeMedia ? 'external-reference' : 'pending';
    let bytes = null;
    let digest = null;
    let mime = null;
    let error = null;
    let acquiredUrl = null;
    let preferredSourceFailure = null;
    let fallback = null;
    const reusableSource = reusableByKey.get(item.key);
    const reused = await readReusableAsset(reusableSource, paths);

    if (reused) {
      ({ localPath, digest, size: bytes, mime } = reused);
      acquiredUrl = reusableSource.acquired_url ?? item.download_url;
      preferredSourceFailure = reusableSource.preferred_source_failure ?? null;
      fallback = reusableSource.fallback ?? null;
      status = 'downloaded';
    } else if (item.classification === 'platform-placeholder') {
      status = 'omitted-placeholder';
    } else if (shouldDownload) {
      try {
        let buffer;
        let responseStatus = null;
        if (item.embedded) {
          buffer = item.embedded.bytes;
          mime = item.embedded.mime;
        } else {
          let response;
          try {
            response = await fetchWithRetry(item.download_url, record.source_url);
            acquiredUrl = item.download_url;
          } catch (preferredError) {
            const canUseObservedFallback = preferredError?.status === 404
              && item.classification === 'platform-asset'
              && item.observed_url
              && item.observed_url !== item.download_url;
            if (!canUseObservedFallback) throw preferredError;
            preferredSourceFailure = {
              url: item.download_url,
              status: 404,
              error: String(preferredError?.message ?? preferredError),
              attempts: 3,
            };
            response = await fetchWithRetry(item.observed_url, record.source_url);
            acquiredUrl = item.observed_url;
          }
          responseStatus = response.status;
          buffer = Buffer.from(await response.arrayBuffer());
          mime = response.headers.get('content-type');
        }
        const receivedMime = mime;
        mime = detectedImageMime(buffer, receivedMime);
        if (!mime) {
          throw new Error(`Unexpected image MIME: ${receivedMime ?? 'missing'}`);
        }
        const saved = await writeHashedFile(
          paths.mediaDirectory,
          sequence,
          buffer,
          mime,
          acquiredUrl ?? item.download_url ?? 'embedded',
          paths,
        );
        bytes = buffer.length;
        digest = saved.digest;
        localPath = paths.isPrivate
          ? `../media/${saved.filename}`
          : `/media/naver/${record.source_id}/${saved.filename}`;
        status = 'downloaded';
        if (preferredSourceFailure) {
          fallback = {
            source_url: acquiredUrl,
            reason: 'preferred-source-http-404',
            http_status: responseStatus,
            sha256: digest,
            size: bytes,
            mime,
          };
        }
      } catch (acquireError) {
        status = 'failed';
        error = errorMessage(acquireError);
      }
      await sleep(70);
    }

    for (const usage of item.usages) {
      const $element = $body.find(usage.element);
      if (usage.kind === 'img-src') {
        if (localPath) {
          $element.attr({ src: localPath, loading: 'lazy', decoding: 'async' });
        } else {
          $element.replaceWith('<span class="naver-media-placeholder">이미지 보존 대기</span>');
        }
      } else if (usage.kind === 'video-poster') {
        if (localPath) $element.attr('poster', localPath);
        else $element.removeAttr('poster');
      } else if (usage.kind === 'inline-background') {
        const replacement = localPath ? `url("${localPath}")` : 'none';
        $element.attr('style', replaceInlineStyleUrl($element.attr('style'), usage.style_source, replacement));
      }
    }

    manifest.push({
      source_url: item.source_url,
      observed_url: item.observed_url,
      download_url: item.download_url,
      acquired_url: acquiredUrl,
      local_path: localPath,
      sha256: digest,
      size: bytes,
      mime,
      status,
      classification: item.classification,
      occurrences: item.usages.length,
      usage_types: [...new Set(item.usages.map((usage) => usage.kind))],
      ...(preferredSourceFailure ? { preferred_source_failure: preferredSourceFailure } : {}),
      ...(fallback ? { fallback } : {}),
      ...(item.embedded ? {
        embedded_source_sha256: sha256(item.embedded.bytes),
        embedded_source_size: item.embedded.bytes.length,
      } : {}),
      ...(error ? { error } : {}),
    });
  }

  return manifest;
}

function classifyVideoSource(url, typeHint = '') {
  if (!url) return 'unresolved';
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  const type = String(typeHint).toLowerCase();
  if (/\.(?:m3u8|mpd)$/.test(pathname)
    || /(?:mpegurl|dash\+xml)/.test(type)
    || /(^|\.)(?:youtube\.com|youtu\.be|vimeo\.com)$/.test(host)
    || /\/(?:embed|player)\b/.test(pathname)) {
    return 'streaming-or-player';
  }
  if (/\.(?:mp4|webm|mov|m4v|ogv)$/.test(pathname)
    || (/^video\//.test(type) && !/(?:mpegurl|dash)/.test(type))
    || (/^(?:mblogvideo|blogvideo)-phinf\.pstatic\.net$/.test(host)
      && /^mp4/i.test(parsed.searchParams.get('type') ?? ''))) {
    return 'direct-binary';
  }
  return 'external-reference';
}

function isStableVideoResponse(contentType, url) {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  if (type?.startsWith('video/') && !/(?:mpegurl|dash)/.test(type)) return true;
  if (type === 'application/octet-stream') {
    try { return /\.(?:mp4|webm|mov|m4v|ogv)$/i.test(new URL(url).pathname); } catch { return false; }
  }
  return false;
}

async function acquireVideos($body, record, paths, existingVideos = []) {
  const byUrl = new Map();
  const reusableByUrl = new Map(existingVideos.filter((asset) => asset.source_url).map((asset) => [asset.source_url, asset]));
  const videoElements = $body.find('video[src], video[data-src], video source[src], video source[data-src]').toArray();
  const iframeElements = $body.find('iframe[src], iframe[data-src]').toArray().filter((element) => {
    const $element = $body.find(element);
    const observed = $element.attr('data-src') || $element.attr('src');
    return classifyVideoSource(absoluteUrl(observed, record.source_url), $element.attr('type')) === 'streaming-or-player';
  });
  const elements = [...videoElements, ...iframeElements];
  for (const [index, element] of elements.entries()) {
    const $element = $body.find(element);
    const observed = $element.attr('data-src') || $element.attr('src');
    const sourceUrl = absoluteUrl(observed, record.source_url);
    const key = sourceUrl || `unresolved:video:${index}`;
    const item = byUrl.get(key) ?? {
      source_url: sourceUrl,
      observed_url: absoluteUrl($element.attr('src'), record.source_url),
      classification: classifyVideoSource(sourceUrl, $element.attr('type')),
      usages: [],
    };
    item.usages.push({ element, tag: element.tagName });
    byUrl.set(key, item);
  }

  const manifest = [];
  let sequence = 0;
  for (const item of byUrl.values()) {
    sequence += 1;
    const shouldDownload = includeMedia
      && item.classification === 'direct-binary'
      && item.source_url;
    let localPath = null;
    let digest = null;
    let size = null;
    let mime = null;
    let error = null;
    let status = item.classification === 'direct-binary' && !includeMedia
      ? 'pending'
      : item.classification === 'unresolved' ? 'unresolved' : 'external-reference';
    const reused = await readReusableAsset(reusableByUrl.get(item.source_url), paths);

    if (reused) {
      ({ localPath, digest, size, mime } = reused);
      status = 'downloaded';
    } else if (shouldDownload) {
      try {
        const response = await fetchWithRetry(item.source_url, record.source_url);
        const buffer = Buffer.from(await response.arrayBuffer());
        mime = response.headers.get('content-type');
        if (!isStableVideoResponse(mime, item.source_url)) {
          throw new Error(`Unexpected or streaming video MIME: ${mime ?? 'missing'}`);
        }
        const videoDirectory = path.join(paths.mediaDirectory, 'videos');
        const saved = await writeHashedFile(
          videoDirectory,
          sequence,
          buffer,
          mime,
          item.source_url,
          paths,
          'video-',
        );
        digest = saved.digest;
        size = buffer.length;
        localPath = paths.isPrivate
          ? `../media/videos/${saved.filename}`
          : `/media/naver/${record.source_id}/videos/${saved.filename}`;
        status = 'downloaded';
      } catch (acquireError) {
        status = 'failed';
        error = errorMessage(acquireError);
      }
      await sleep(90);
    }

    for (const usage of item.usages) {
      const $element = $body.find(usage.element);
      if (localPath) {
        $element.attr('src', localPath).removeAttr('data-src');
      } else if (item.source_url) {
        // External and failed sources remain usable instead of breaking the video element.
        $element.attr('src', item.source_url).removeAttr('data-src');
      } else {
        $element.removeAttr('src').removeAttr('data-src');
      }
    }

    manifest.push({
      source_url: item.source_url,
      observed_url: item.observed_url,
      local_path: localPath,
      sha256: digest,
      size,
      mime,
      status,
      classification: item.classification,
      preservation_policy: item.classification === 'direct-binary'
        ? 'download-hash-and-rewrite'
        : 'retain-external-reference',
      occurrences: item.usages.length,
      element_types: [...new Set(item.usages.map((usage) => usage.tag))],
      ...(error ? { error } : {}),
    });
  }
  return manifest;
}

function explicitNaverAttachmentEndpoint(value, sourceUrl) {
  const absolute = absoluteUrl(value, sourceUrl);
  if (!absolute) return false;
  const url = new URL(absolute);
  const naverHost = /^(?:m\.)?blog\.naver\.com$/i.test(url.hostname)
    || /(?:^|\.)(?:naver\.net|pstatic\.net)$/i.test(url.hostname);
  return naverHost && /(?:FileDownload|AttachFile)/i.test(`${url.pathname}${url.search}`);
}

function attachmentPayloadIsHtml(bytes, contentType) {
  const declared = contentType?.split(';')[0].trim().toLowerCase();
  if (declared === 'text/html' || declared === 'application/xhtml+xml') return true;
  const prefix = bytes.subarray(0, 1024).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  return /^(?:<!doctype\s+html\b|<html\b)/i.test(prefix);
}

function attachmentCandidates($body, sourceUrl) {
  return $body.find('a').toArray().flatMap((element, index) => {
    const $anchor = $body.find(element);
    const linkType = $anchor.attr('data-linktype');
    const className = $anchor.attr('class') ?? '';
    const href = $anchor.attr('href');
    const onclick = $anchor.attr('onclick');
    const data = parseJsonAttribute($anchor.attr('data-linkdata'));
    const hasStructuredFileData = [data.downloadUrl, data.fileUrl, data.filePath].some(Boolean);
    const isAttachment = String(linkType).toLowerCase() === 'file'
      || /(^|\s)(se-(module-)?file|__se_file|_fileUnit|file_(name|download|btn))(\s|$)/i.test(className)
      || hasStructuredFileData
      || $anchor.attr('download') !== undefined
      || /FileDownload|AttachFile/i.test(onclick ?? '')
      || explicitNaverAttachmentEndpoint(href, sourceUrl);
    if (!isAttachment) return [];
    const candidate = data.downloadUrl || data.fileUrl || data.url || data.filePath || data.src || href;
    return [{
      index,
      element,
      source_url: absoluteUrl(candidate, sourceUrl),
      filename: cleanSpace(data.fileName || data.filename || data.name || $anchor.attr('download') || $anchor.text()),
      source_metadata: data,
    }];
  });
}

async function acquireAttachments($body, record, paths, existingAttachments = []) {
  const candidates = attachmentCandidates($body, record.source_url);
  const manifest = [];
  const reusableByUrl = new Map(existingAttachments.filter((asset) => asset.source_url).map((asset) => [asset.source_url, asset]));
  let sequence = 0;

  for (const candidate of candidates) {
    sequence += 1;
    let status = includeMedia ? 'unresolved' : 'pending';
    let localPath = null;
    let digest = null;
    let size = null;
    let mime = null;
    let error = null;
    let reused = await readReusableAsset(reusableByUrl.get(candidate.source_url), paths);
    if (reused && attachmentPayloadIsHtml(reused.bytes, reused.mime)) reused = null;

    if (reused) {
      ({ localPath, digest, size, mime } = reused);
      status = 'downloaded';
    } else if (includeMedia && candidate.source_url) {
      try {
        const response = await fetchWithRetry(candidate.source_url, record.source_url);
        const buffer = Buffer.from(await response.arrayBuffer());
        mime = response.headers.get('content-type');
        if (attachmentPayloadIsHtml(buffer, mime)) {
          throw new Error(`Attachment response is HTML rather than a file (${mime ?? 'undeclared'}).`);
        }
        const attachmentDirectory = path.join(paths.mediaDirectory, 'attachments');
        const saved = await writeHashedFile(
          attachmentDirectory,
          sequence,
          buffer,
          mime,
          candidate.source_url,
          paths,
          'attachment-',
        );
        digest = saved.digest;
        size = buffer.length;
        localPath = paths.isPrivate
          ? `../media/attachments/${saved.filename}`
          : `/media/naver/${record.source_id}/attachments/${saved.filename}`;
        status = 'downloaded';
      } catch (acquireError) {
        status = 'failed';
        error = errorMessage(acquireError);
      }
      await sleep(90);
    }
    if (localPath) {
      const $anchor = $body.find(candidate.element);
      $anchor.attr({ href: localPath, download: candidate.filename || path.basename(localPath) });
      $anchor.removeAttr('onclick');
    }

    manifest.push({
      source_url: candidate.source_url,
      filename: candidate.filename || null,
      local_path: localPath,
      sha256: digest,
      size,
      mime,
      status,
      source_metadata: candidate.source_metadata,
      ...(error ? { error } : {}),
    });
  }
  return manifest;
}

function cleanNormalizedBody($body, record, paths) {
  $body.find('script, style, form, input, button, noscript').remove();
  $body.find('.se-documentTitle, .se_publishDate, .post-btn, .post_footer_contents').remove();

  $body.find('a[data-linkdata]').each((_, element) => {
    const $anchor = $body.find(element);
    const observedHref = $anchor.attr('href');
    if (isLocalMediaReference(observedHref)) return;
    const data = parseJsonAttribute($anchor.attr('data-linkdata'));
    if (!paths.isPrivate && (
      isPrivateNaverPostLink(observedHref, record.source_url)
      || isPrivateNaverPostLink(data.link, record.source_url)
      || containsPrivateNaverSourceId($anchor.text())
    )) {
      $anchor.replaceWith('<span class="naver-private-link-placeholder">비공개 네이버 글 링크</span>');
      return;
    }
    if (data.linkUse === 'true' && absoluteUrl(data.link, record.source_url)) {
      $anchor.attr('href', absoluteUrl(data.link, record.source_url));
    }
  });

  $body.find('a').each((_, element) => {
    const $anchor = $body.find(element);
    const observedHref = $anchor.attr('href');
    if (isLocalMediaReference(observedHref)) {
      $anchor.removeAttr('target').removeAttr('rel');
      return;
    }
    if (!paths.isPrivate && (
      isPrivateNaverPostLink(observedHref, record.source_url)
      || containsPrivateNaverSourceId($anchor.text())
    )) {
      $anchor.replaceWith('<span class="naver-private-link-placeholder">비공개 네이버 글 링크</span>');
      return;
    }
    const href = absoluteUrl(observedHref, record.source_url);
    if (href) {
      $anchor.attr({ href, rel: 'noopener noreferrer' });
      if (new URL(href).hostname !== 'blog.naver.com') $anchor.attr('target', '_blank');
    } else if (!$anchor.attr('download')) {
      $anchor.replaceWith($anchor.contents());
    }
  });

  $body.find('iframe[src]').each((_, element) => {
    const $frame = $body.find(element);
    const src = absoluteUrl($frame.attr('src'), record.source_url);
    if (src) $frame.attr({ src, loading: 'lazy', title: $frame.attr('title') || '삽입 콘텐츠' });
  });

  $body.find('*').each((_, element) => {
    const $element = $body.find(element);
    for (const attribute of Object.keys(element.attribs ?? {})) {
      if (/^on/i.test(attribute)
        || ['contenteditable', 'data-lazy-src', 'data-origin-src', 'data-src', 'srcset', 'data-linkdata'].includes(attribute)) {
        $element.removeAttr(attribute);
      }
    }
  });
}

function sanitizeBody(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img', 'figure', 'figcaption', 'picture', 'source', 'video', 'audio', 'iframe',
      'details', 'summary', 'mark', 's', 'del', 'ins', 'ruby', 'rt', 'rp',
    ],
    allowedAttributes: {
      '*': ['class', 'style', 'title', 'aria-*'],
      a: ['href', 'name', 'target', 'rel', 'title', 'download'],
      img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
      iframe: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy'],
      video: ['src', 'controls', 'poster', 'width', 'height', 'preload'],
      audio: ['src', 'controls', 'preload'],
      source: ['src', 'srcset', 'type', 'media'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'], source: ['http', 'https'] },
    allowProtocolRelative: false,
    allowedIframeHostnames: ALLOWED_NAVER_IFRAME_HOSTS,
    allowIframeRelativeUrls: false,
    exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,
  });
}

async function runSelfTest() {
  assert.equal(includeMedia, false, '--self-test must not be combined with --media.');
  const previousPrivateIds = privateSourceIds;
  privateSourceIds = new Set(['999999999999']);
  try {
    const $ = cheerio.load(`
      <div id="fixture">
        <a id="attachment" href="../media/attachments/example.pdf" download="example.pdf"
          data-linkdata='{"linkUse":"true","link":"https://blog.naver.com/tsusai/111111111111"}'>file</a>
        <a id="private-link" href="/tsusai/999999999999"><strong>sensitive preview</strong></a>
        <a id="private-alias-link" href="https://tsusai.blog.me/999999999999">legacy sensitive preview</a>
        <a id="private-alias-data-link" href="https://tsusai.blog.me/999999999999"
          data-linkdata='{"linkUse":"true","link":"https://blog.naver.com/PostList.naver?blogId=tsusai"}'>https://tsusai.blog.me/999999999999</a>
        <a id="private-alias-malformed" href="https://tsusai.blog.me/999999999999}">malformed legacy sensitive preview</a>
        <a id="private-alias-text" href="https://blog.naver.com/PostList.naver?blogId=tsusai">https://tsusai.blog.me/999999999999}</a>
        <a id="ordinary-download-page" href="https://example.com/products/download-client">ordinary page</a>
        <video id="direct-video"
          src="https://mblogvideo-phinf.pstatic.net/20200101/example/clip.gif?type=mp4w800"
          poster="data:image/png;base64,iVBORw0KGgo="></video>
        <video id="stream-video" src="https://media.example/video.m3u8"></video>
        <iframe id="stream-iframe" src="https://www.youtube.com/embed/example"></iframe>
        <div id="background" style="color: red; background-image: url('https://postfiles.pstatic.net/example/background.jpg?type=w80')"></div>
      </div>
    `, null, false);
    const $body = $('#fixture');
    const record = {
      source_id: '111111111111',
      source_url: 'https://blog.naver.com/tsusai/111111111111',
    };
    const paths = { isPrivate: false, mediaDirectory: '/unused' };
    assert.equal(attachmentCandidates($body, record.source_url)
      .some((item) => item.element === $('#ordinary-download-page').get(0)), false);
    const images = await acquireImages($body, record, paths);
    const videos = await acquireVideos($body, record, paths);
    cleanNormalizedBody($body, record, paths);
    const html = sanitizeBody($body.html() ?? '');

    assert.match(html, /href="\.\.\/media\/attachments\/example\.pdf"/);
    assert.doesNotMatch(html, /999999999999|sensitive preview|legacy sensitive preview/);
    assert.match(html, /비공개 네이버 글 링크/);
    assert.equal(images.some((item) => item.usage_types.includes('video-poster')), true);
    assert.equal(images.some((item) => item.usage_types.includes('inline-background')), true);
    assert.equal(images.some((item) => item.classification === 'embedded-data'
      && /^[a-f0-9]{64}$/.test(item.embedded_source_sha256)), true);
    assert.doesNotMatch(html, /poster=/);
    assert.match(html, /background-image:\s*none/);
    assert.equal(videos.find((item) => item.classification === 'direct-binary')?.status, 'pending');
    assert.equal(videos.find((item) => item.classification === 'streaming-or-player')?.status, 'external-reference');
    assert.match(html, /https:\/\/media\.example\/video\.m3u8/);
    assert.equal(videos.some((item) => item.element_types.includes('iframe')
      && item.classification === 'streaming-or-player'
      && item.status === 'external-reference'), true);
    console.log(JSON.stringify({ selfTest: 'passed', images: images.length, videos: videos.length }));
  } finally {
    privateSourceIds = previousPrivateIds;
  }
}

function canonicalProvenanceMatches(existing, rawManifest, record, paths) {
  return existing?.version === DERIVED_MANIFEST_VERSION
    && existing.normalization_version === NORMALIZATION_VERSION
    && existing.source === 'naver'
    && String(existing.source_id) === String(record.source_id)
    && existing.source_url === record.source_url
    && existing.visibility === record.visibility
    && existing.canonical_path === `/naver/${record.source_id}`
    && existing.editor_generation === rawManifest.editor_generation
    && existing.raw_manifest_path === path.relative(ROOT, paths.rawManifest)
    && existing.raw_capture_version === rawManifest.version
    && existing.raw_capture_method === rawManifest.capture_method
    && existing.canonical_raw_content_path === rawManifest.files?.content?.path
    && existing.raw_content_sha256 === rawManifest.files?.content?.sha256
    && existing.normalized_path === path.relative(ROOT, paths.normalizedPost);
}

async function downloadedAssetsAreIntact(existing, paths) {
  const assets = [...(existing.images ?? []), ...(existing.videos ?? []), ...(existing.attachments ?? [])];
  for (const asset of assets) {
    if (asset.status !== 'downloaded') continue;
    if (!asset.local_path || !Number.isInteger(asset.size) || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) return false;
    const diskPath = paths.isPrivate
      ? path.resolve(path.dirname(paths.normalizedPost), asset.local_path)
      : path.resolve(ROOT, 'public', asset.local_path.replace(/^\/+/, ''));
    if (!pathInside(diskPath, paths.mediaDirectory)) return false;
    try {
      const bytes = await readFile(diskPath);
      if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function existingOutputIsCurrent(existing, rawManifest, record, paths, { requireVerified = false } = {}) {
  if (!canonicalProvenanceMatches(existing, rawManifest, record, paths)) return false;
  if (requireVerified && existing.migration_status !== 'verified') return false;
  try {
    const markdown = await readFile(paths.normalizedPost, 'utf8');
    const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    const bodyMatch = markdown.match(/\n<div class="naver-content naver-content--[^"]+">\n([\s\S]*)\n<\/div>\n?$/);
    if (!frontmatterMatch || !bodyMatch || sha256(bodyMatch[1]) !== existing.normalized_body_sha256) return false;
    const frontmatter = YAML.parse(frontmatterMatch[1]);
    if (String(frontmatter.sourceId) !== String(record.source_id)
      || frontmatter.rawSha256 !== rawManifest.files.content.sha256
      || frontmatter.migrationStatus !== existing.migration_status
      || frontmatter.visibility !== (paths.isPrivate ? 'private' : 'public')) return false;
  } catch {
    return false;
  }
  return !requireVerified || downloadedAssetsAreIntact(existing, paths);
}

async function importPost(record) {
  const paths = sourcePaths(record);
  const { manifest: rawManifest, contentHtml, pageHtml } = await readCanonicalRaw(paths, record);

  const existing = await readJsonIfPresent(paths.derivedManifest);
  if (!force && await existingOutputIsCurrent(existing, rawManifest, record, paths, {
    requireVerified: includeMedia,
  })) {
    return { ...existing, run_status: 'existing' };
  }

  const $body = extractBody(contentHtml, rawManifest.editor_generation, record.source_id);
  const tags = tagsFromBody($body);
  const images = await acquireImages($body, record, paths, existing?.images);
  const videos = await acquireVideos($body, record, paths, existing?.videos);
  const attachments = await acquireAttachments($body, record, paths, existing?.attachments);
  cleanNormalizedBody($body, record, paths);
  const normalizedHtml = sanitizeBody($body.html() ?? '');
  const bodyDigest = sha256(normalizedHtml);
  const $description = cheerio.load(normalizedHtml, null, false);
  $description('.naver-media-placeholder').remove();
  const description = cleanSpace($description.root().text()).slice(0, 260);
  const publishedAt = parsePublishedAt(`${pageHtml}\n${contentHtml}`, record.published_date);
  const failedAssets = [...images, ...videos, ...attachments].filter((item) => item.status === 'failed');
  const unresolvedAssets = [...videos, ...attachments].filter((item) => item.status === 'unresolved');
  const migrationStatus = includeMedia
    ? (failedAssets.length || unresolvedAssets.length ? 'media-partial' : 'verified')
    : 'body-imported';
  const downloadedImages = images.filter((item) => item.status === 'downloaded');
  const cover = downloadedImages[0]?.local_path;
  const coverAlt = cleanSpace($body.find('img').first().attr('alt'));
  const canonicalPath = `/naver/${record.source_id}`;

  await mkdir(paths.normalizedDirectory, { recursive: true, mode: paths.isPrivate ? 0o700 : 0o755 });
  const frontmatter = {
    title: record.title,
    description,
    publishedAt,
    source: 'naver',
    sourceId: String(record.source_id),
    sourceUrl: record.source_url,
    canonicalPath,
    visibility: paths.isPrivate ? 'private' : 'public',
    categories: categoryTrail(record.category),
    tags,
    ...(cover ? { cover } : {}),
    coverAlt,
    featured: false,
    draft: paths.isPrivate || migrationStatus !== 'verified',
    migrationStatus,
    rawSha256: rawManifest.files.content.sha256,
  };
  const markdown = `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n<div class="naver-content naver-content--${rawManifest.editor_generation}">\n${normalizedHtml}\n</div>\n`;
  await writeAtomicFile(paths.normalizedPost, markdown, {
    mode: paths.isPrivate ? 0o600 : 0o644,
    quarantineDirectory: paths.quarantineDirectory,
  });

  const derived = {
    version: DERIVED_MANIFEST_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    source: 'naver',
    source_id: String(record.source_id),
    source_url: record.source_url,
    canonical_path: canonicalPath,
    visibility: record.visibility,
    title: record.title,
    category: record.category,
    published_at: publishedAt,
    editor_generation: rawManifest.editor_generation,
    raw_manifest_path: path.relative(ROOT, paths.rawManifest),
    raw_capture_version: rawManifest.version,
    raw_capture_method: rawManifest.capture_method,
    canonical_raw_content_path: rawManifest.files.content.path,
    raw_content_sha256: rawManifest.files.content.sha256,
    normalized_path: path.relative(ROOT, paths.normalizedPost),
    normalized_body_sha256: bodyDigest,
    migration_status: migrationStatus,
    cover: cover ?? null,
    images,
    video_preservation_policy: {
      version: 1,
      direct_binary: 'download-hash-and-rewrite',
      streaming_or_player: 'retain-external-reference',
      failed_download: 'retain-external-reference-and-mark-partial',
    },
    videos,
    attachments,
    generated_at: new Date().toISOString(),
  };
  await writeAtomicFile(paths.derivedManifest, `${JSON.stringify(derived, null, 2)}\n`, {
    mode: paths.isPrivate ? 0o600 : 0o644,
    quarantineDirectory: paths.quarantineDirectory,
  });
  return { ...derived, run_status: 'generated' };
}

async function collectDerived(records, visibility) {
  const collected = [];
  for (const record of records.filter((item) => item.visibility === visibility)) {
    const derived = await readJsonIfPresent(sourcePaths(record).derivedManifest);
    if (derived) collected.push(derived);
  }
  return collected;
}

async function writeSummaries(allRecords) {
  const publicPosts = await collectDerived(allRecords, PUBLIC_VISIBILITY);
  const privatePosts = await collectDerived(allRecords, PRIVATE_VISIBILITY);
  const publicInventory = {
    version: 1,
    generated_at: new Date().toISOString(),
    source: 'migration/source-inventory/naver-posts.json',
    expected_public_posts: 185,
    migrated_public_posts: publicPosts.length,
    verified_public_posts: publicPosts.filter((post) => post.migration_status === 'verified').length,
    posts: publicPosts,
  };
  await writeAtomicFile(PUBLIC_INVENTORY_PATH, `${JSON.stringify(publicInventory, null, 2)}\n`, {
    mode: 0o644,
    quarantineDirectory: path.join(ROOT, 'migration/quarantine/importer-recovery'),
  });

  await mkdir(path.dirname(PRIVATE_SUMMARY_PATH), { recursive: true, mode: 0o700 });
  const privateSummary = {
    version: 1,
    generated_at: new Date().toISOString(),
    expected_private_posts: 247,
    migrated_private_posts: privatePosts.length,
    verified_private_posts: privatePosts.filter((post) => post.migration_status === 'verified').length,
    posts: privatePosts.map((post) => ({
      source_id: post.source_id,
      migration_status: post.migration_status,
      editor_generation: post.editor_generation,
      raw_content_sha256: post.raw_content_sha256,
      normalized_body_sha256: post.normalized_body_sha256,
      normalized_path: post.normalized_path,
      images: post.images.length,
      videos: post.videos?.length ?? 0,
      attachments: post.attachments.length,
    })),
  };
  await writeAtomicFile(PRIVATE_SUMMARY_PATH, `${JSON.stringify(privateSummary, null, 2)}\n`, {
    mode: 0o600,
    quarantineDirectory: path.join(ROOT, 'migration/private/quarantine/importer-recovery'),
  });
}

if (args.includes('--self-test')) {
  await runSelfTest();
  process.exit(0);
}

const inventory = await readJson(INVENTORY_PATH);
privateSourceIds = new Set(
  inventory.posts
    .filter((record) => record.visibility === PRIVATE_VISIBILITY)
    .map((record) => String(record.source_id)),
);
if (args.includes('--verify-canonical-raw')) {
  const methods = {};
  for (const record of inventory.posts) {
    const { manifest } = await readCanonicalRaw(sourcePaths(record), record);
    methods[manifest.capture_method] = (methods[manifest.capture_method] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    canonicalRaw: 'verified',
    posts: inventory.posts.length,
    files: inventory.posts.length * 2,
    methods,
  }, null, 2));
  process.exit(0);
}
let selected = inventory.posts;
if (requestedIds.size) selected = selected.filter((record) => requestedIds.has(record.source_id));
if (publicOnly) selected = selected.filter((record) => record.visibility === PUBLIC_VISIBILITY);
if (privateOnly) selected = selected.filter((record) => record.visibility === PRIVATE_VISIBILITY);
if (pendingMedia) {
  const pending = [];
  for (const record of selected) {
    const paths = sourcePaths(record);
    const existing = await readJsonIfPresent(paths.derivedManifest);
    const rawManifest = await readJsonIfPresent(paths.rawManifest);
    if (!rawManifest || !await existingOutputIsCurrent(existing, rawManifest, record, paths, { requireVerified: true })) {
      pending.push(record);
    }
  }
  selected = pending;
}
if (limit > 0) selected = selected.slice(0, limit);

const results = [];
const failures = [];
for (const [index, record] of selected.entries()) {
  if (!quiet) process.stdout.write(`[${index + 1}/${selected.length}] Naver ${record.source_id} (${record.visibility})\n`);
  try {
    results.push(await importPost(record));
  } catch (error) {
    failures.push({ source_id: record.source_id, visibility: record.visibility, error: String(error?.message ?? error) });
  }
}

await writeSummaries(inventory.posts);
console.log(JSON.stringify({
  selected: selected.length,
  generated: results.filter((result) => result.run_status === 'generated').length,
  existing: results.filter((result) => result.run_status === 'existing').length,
  verified: results.filter((result) => result.migration_status === 'verified').length,
  partial: results.filter((result) => result.migration_status === 'media-partial').length,
  failures: quiet ? failures.length : failures,
}, null, 2));

if (failures.length) process.exitCode = 1;
