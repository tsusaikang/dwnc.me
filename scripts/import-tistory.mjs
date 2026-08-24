import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import YAML from 'yaml';

const ROOT = process.cwd();
const SOURCE_BASE = 'https://dwnc.me';
const SITEMAP_URL = `${SOURCE_BASE}/sitemap.xml`;
const USER_AGENT = 'dwnc.me owner migration/0.1 (+https://dwnc.me)';
const EXPECTED_PUBLIC_POSTS = 164;
const RAW_ROOT = path.join(ROOT, 'migration/raw/tistory');
const CONTENT_ROOT = path.join(ROOT, 'src/data/posts/tistory');
const MEDIA_ROOT = path.join(ROOT, 'public/media/tistory');
const INVENTORY_PATH = path.join(ROOT, 'migration/source-inventory/tistory-posts.json');

const args = process.argv.slice(2);
const optionValue = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const limit = Number(optionValue('--limit') ?? 0);
const requestedIds = new Set((optionValue('--ids') ?? '').split(',').filter(Boolean));
const includeMedia = args.includes('--media');
const inventoryOnly = args.includes('--inventory-only');
const pendingMedia = args.includes('--pending-media');
const force = args.includes('--force');
let previousById = new Map();

if (args.includes('--help')) {
  console.log(`Usage: node scripts/import-tistory.mjs [options]

Options:
  --limit=N          Import the first N sitemap posts (for a sample run)
  --ids=1,173        Import only specific post IDs
  --media            Download post images and rewrite body URLs
  --inventory-only   Save raw HTML and metadata without creating content files
  --pending-media    Process only posts that are not yet media-verified
  --force            Replace an existing raw HTML snapshot
`);
  process.exit(0);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function loadPostUrls() {
  const response = await fetchWithRetry(SITEMAP_URL);
  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const posts = $('loc')
    .map((_, element) => $(element).text().trim())
    .get()
    .filter((url) => /^https:\/\/dwnc\.me\/\d+$/.test(url))
    .map((url) => ({ id: url.split('/').pop(), url }));

  if (new Set(posts.map((post) => post.id)).size !== posts.length) {
    throw new Error('Tistory sitemap contains duplicate numeric post IDs.');
  }
  return posts;
}

function parseJsonLd($) {
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const value = JSON.parse($(element).text());
      const candidates = Array.isArray(value) ? value : [value];
      const posting = candidates.find((item) => item?.['@type'] === 'BlogPosting');
      if (posting) return posting;
    } catch {
      // Ignore unrelated or malformed JSON-LD blocks and continue.
    }
  }
  return {};
}

function parseTiara($) {
  for (const element of $('script').toArray()) {
    const script = $(element).text();
    const match = script.match(/window\.tiara\s*=\s*(\{.*?\});?\s*$/s);
    if (!match) continue;
    try {
      return JSON.parse(match[1]);
    } catch {
      return {};
    }
  }
  return {};
}

function categoryTrail(value) {
  const pieces = value.split('/').map((piece) => piece.trim()).filter(Boolean);
  return pieces.map((_, index) => pieces.slice(0, index + 1).join('/'));
}

function cleanDescription(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 260);
}

function normalizeLegacyBody($body) {
  $body.find('iframe[data-ke-type="map"][data-maps-thumbnail]').each((_, element) => {
    const $map = $body.find(element);
    const thumbnail = $map.attr('data-maps-thumbnail');
    if (!thumbnail) return;

    const parameters = new URLSearchParams($map.attr('data-maps-data') ?? '');
    const title = parameters.get('title')?.trim() || '지도';
    const address = parameters.get('addr')?.trim();
    const fragment = cheerio.load(
      '<figure class="tistory-map"><img loading="lazy" decoding="async"><figcaption></figcaption></figure>',
      null,
      false,
    );
    fragment('img').attr({ src: thumbnail, alt: `${title} 지도`, width: '540', height: '350' });
    fragment('figcaption').text(address ? `${title} · ${address}` : title);
    $map.replaceWith(fragment('figure'));
  });

  $body.find('figure[data-ke-type="opengraph"]').each((_, element) => {
    const $figure = $body.find(element);
    const sourceUrl = $figure.attr('data-og-image');
    const linkedUrl = $figure.attr('data-og-source-url') || $figure.attr('data-og-url');
    const $imageHolder = $figure.find('.og-image').first();
    if (!sourceUrl || !$imageHolder.length) return;

    let ownedLink = false;
    try {
      ownedLink = ['dwnc.me', 'www.dwnc.me'].includes(new URL(linkedUrl).hostname.toLowerCase());
    } catch {
      // An unparseable card URL is treated as an external reference.
    }

    $imageHolder.empty().removeAttr('style');
    if (ownedLink) {
      const fragment = cheerio.load('<img loading="lazy" decoding="async" alt="">', null, false);
      fragment('img').attr({ src: sourceUrl, 'data-optional-asset': 'link-preview' });
      $imageHolder.append(fragment('img'));
    } else {
      $figure.attr('data-asset-policy', 'external-reference');
      const fragment = cheerio.load('<span class="og-image__label" aria-hidden="true">외부 링크</span>', null, false);
      $imageHolder.append(fragment('span'));
    }
  });

  $body.find('iframe[src]').each((_, element) => {
    const $frame = $body.find(element);
    const src = $frame.attr('src');
    if (src) {
      try {
        $frame.attr('src', new URL(src, SOURCE_BASE).href);
      } catch {
        // The raw snapshot retains malformed legacy embeds for later review.
      }
    }

    const width = Number.parseFloat($frame.attr('width') ?? '');
    const height = Number.parseFloat($frame.attr('height') ?? '');
    if (width > 0 && height > 0) {
      const existingStyle = $frame.attr('style')?.trim().replace(/;?$/, ';') ?? '';
      $frame.attr('style', `${existingStyle}aspect-ratio:${width}/${height};max-width:${width}px`);
    }
    $frame.attr('loading', 'lazy');
    if (!$frame.attr('title')) $frame.attr('title', '삽입 콘텐츠');
  });

  $body.find('a[target="_blank"]').attr('rel', 'noopener noreferrer');
}

function extensionFor(contentType, url) {
  const type = contentType?.split(';')[0].trim().toLowerCase();
  const known = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
  };
  if (known[type]) return known[type];
  const pathname = new URL(url).pathname;
  const extension = path.extname(pathname).toLowerCase();
  return /^\.(jpe?g|png|gif|webp|avif|svg)$/.test(extension) ? extension : '.bin';
}

async function acquireMedia($body, postId) {
  const imageElements = $body.find('img').toArray();
  const byUrl = new Map();

  for (const element of imageElements) {
    const $image = $body.find(element);
    const $holder = $image.closest('[data-url]');
    const sourceUrl = $holder.attr('data-url') || $image.attr('data-origin-src') || $image.attr('data-src') || $image.attr('src');
    if (!sourceUrl || sourceUrl.startsWith('data:')) continue;
    try {
      const absolute = new URL(sourceUrl, SOURCE_BASE).href;
      const optional = $image.attr('data-optional-asset') === 'link-preview';
      const previous = byUrl.get(absolute);
      byUrl.set(absolute, {
        localPath: previous?.localPath ?? null,
        optional: previous ? previous.optional && optional : optional,
      });
    } catch {
      // Invalid legacy source URL remains visible in the raw snapshot for later review.
    }
  }

  const mediaDirectory = path.join(MEDIA_ROOT, postId);
  await mkdir(mediaDirectory, { recursive: true });
  const manifest = [];
  let sequence = 0;

  for (const [sourceUrl, mediaState] of byUrl.entries()) {
    sequence += 1;
    try {
      const response = await fetchWithRetry(sourceUrl);
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = sha256(bytes);
      const contentType = response.headers.get('content-type');
      const extension = extensionFor(contentType, sourceUrl);
      const filename = `${String(sequence).padStart(3, '0')}-${digest.slice(0, 12)}${extension}`;
      const diskPath = path.join(mediaDirectory, filename);
      const publicPath = `/media/tistory/${postId}/${filename}`;
      await writeFile(diskPath, bytes);
      mediaState.localPath = publicPath;
      manifest.push({
        source_url: sourceUrl,
        local_path: publicPath,
        sha256: digest,
        size: bytes.length,
        mime: contentType,
        status: 'downloaded',
        optional: mediaState.optional,
      });
    } catch (error) {
      manifest.push({
        source_url: sourceUrl,
        local_path: null,
        sha256: null,
        size: null,
        mime: null,
        status: mediaState.optional ? 'omitted-optional' : 'failed',
        optional: mediaState.optional,
        error: String(error?.message ?? error),
      });
    }
    await sleep(120);
  }

  for (const element of imageElements) {
    const $image = $body.find(element);
    const $holder = $image.closest('[data-url]');
    const sourceUrl = $holder.attr('data-url') || $image.attr('data-origin-src') || $image.attr('data-src') || $image.attr('src');
    if (!sourceUrl) continue;
    let absolute;
    try {
      absolute = new URL(sourceUrl, SOURCE_BASE).href;
    } catch {
      continue;
    }
    const mediaState = byUrl.get(absolute);
    const localPath = mediaState?.localPath;
    if (!localPath && mediaState?.optional) {
      const fragment = cheerio.load('<span class="og-image__label">미리보기 없음</span>', null, false);
      $image.replaceWith(fragment('span'));
      continue;
    }
    if (!localPath) continue;
    $image.attr('src', localPath);
    $image.removeAttr('srcset');
    $image.removeAttr('onerror');
    $image.attr('loading', 'lazy');
    $image.attr('decoding', 'async');
    if ($holder.length) {
      $holder.attr('data-url', localPath);
      $holder.attr('data-phocus', localPath);
    }
  }

  return manifest;
}

function sanitizeBody(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img', 'figure', 'figcaption', 'picture', 'source', 'video', 'audio', 'iframe',
      'details', 'summary', 'mark', 's', 'del', 'ins', 'ruby', 'rt', 'rp',
    ],
    allowedAttributes: {
      '*': ['class', 'id', 'style', 'title', 'data-*'],
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'width', 'height', 'loading', 'decoding', 'data-optional-asset'],
      iframe: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy'],
      video: ['src', 'controls', 'poster', 'width', 'height', 'preload'],
      audio: ['src', 'controls', 'preload'],
      source: ['src', 'srcset', 'type', 'media'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'], source: ['http', 'https'] },
    allowProtocolRelative: true,
    exclusiveFilter(frame) {
      return ['script', 'style', 'form', 'input', 'button'].includes(frame.tag);
    },
  });
}

async function importPost(post) {
  const rawDirectory = path.join(RAW_ROOT, post.id);
  const rawPath = path.join(rawDirectory, 'page.html');
  await mkdir(rawDirectory, { recursive: true });

  let html;
  if (!force) {
    try {
      html = await readFile(rawPath, 'utf8');
    } catch {
      html = undefined;
    }
  }

  let fetchedAt = null;
  if (!html) {
    const response = await fetchWithRetry(post.url);
    html = await response.text();
    fetchedAt = new Date().toISOString();
    await writeFile(rawPath, html, 'utf8');
  }

  const rawDigest = sha256(html);
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLd($);
  const tiara = parseTiara($);
  const title = ($('.title-article').first().text() || $('meta[property="og:title"]').attr('content') || jsonLd.headline || '').trim();
  const description = cleanDescription($('meta[property="og:description"]').attr('content') || jsonLd.description || '');
  const publishedAt = jsonLd.datePublished || $('meta[property="article:published_time"]').attr('content');
  const updatedAt = jsonLd.dateModified || undefined;
  const category = ($('.article-header .category').first().text() || tiara?.entry?.categoryName || '').trim();
  const tags = Array.isArray(tiara?.entry?.tags) ? tiara.entry.tags : [];
  const $body = $('#article-view .tt_article_useless_p_margin.contents_style, #article-view > .contents_style')
    .first()
    .clone();

  if (!title || !publishedAt || !$body.length) {
    throw new Error(`Required fields missing for Tistory post ${post.id}.`);
  }

  $body.find('script, style, form, input, button').remove();
  normalizeLegacyBody($body);
  const media = includeMedia ? await acquireMedia($body, post.id) : [];
  const bodyHtml = sanitizeBody($body.html() ?? '');
  const bodyDigest = sha256(bodyHtml);
  const downloadedMedia = media.filter((item) => item.status === 'downloaded');
  const failedMedia = media.filter((item) => item.status === 'failed');
  const cover = downloadedMedia[0]?.local_path;
  const coverAlt = ($body.find('img').first().attr('alt') || $body.find('figcaption').first().text() || '').trim();
  const migrationStatus = includeMedia
    ? (failedMedia.length ? 'media-partial' : 'verified')
    : 'body-imported';

  const record = {
    source: 'tistory',
    source_id: post.id,
    source_url: post.url,
    canonical_path: `/${post.id}`,
    title,
    description,
    published_at: publishedAt,
    updated_at: updatedAt ?? null,
    categories: categoryTrail(category),
    tags,
    visibility: 'public',
    raw_path: path.relative(ROOT, rawPath),
    raw_sha256: rawDigest,
    body_sha256: bodyDigest,
    content_path: inventoryOnly ? null : `src/data/posts/tistory/${post.id}.md`,
    migration_status: inventoryOnly ? 'inventory' : migrationStatus,
    fetched_at: fetchedAt,
    media,
  };

  const previousRecord = previousById.get(post.id);
  const preserveRicherMigration = !includeMedia
    && previousRecord?.content_path
    && ['verified', 'media-partial'].includes(previousRecord.migration_status)
    && previousRecord.raw_sha256 === rawDigest;
  if ((inventoryOnly || preserveRicherMigration) && previousRecord?.content_path) {
    record.body_sha256 = previousRecord.body_sha256;
    record.content_path = previousRecord.content_path;
    record.migration_status = previousRecord.migration_status;
    record.media = previousRecord.media ?? [];
  }
  if (!record.fetched_at && previousRecord?.fetched_at) {
    record.fetched_at = previousRecord.fetched_at;
  }

  await writeFile(
    path.join(rawDirectory, 'manifest.json'),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  );

  if (!inventoryOnly && !preserveRicherMigration) {
    await mkdir(CONTENT_ROOT, { recursive: true });
    const frontmatter = {
      title,
      description,
      publishedAt,
      ...(updatedAt ? { updatedAt } : {}),
      source: 'tistory',
      sourceId: post.id,
      sourceUrl: post.url,
      canonicalPath: `/${post.id}`,
      visibility: 'public',
      categories: categoryTrail(category),
      tags,
      ...(cover ? { cover } : {}),
      coverAlt,
      featured: post.id === '173',
      draft: false,
      migrationStatus,
      rawSha256: rawDigest,
    };
    const markdown = `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n<div class="legacy-content">\n${bodyHtml}\n</div>\n`;
    await writeFile(path.join(CONTENT_ROOT, `${post.id}.md`), markdown, 'utf8');
  }

  return record;
}

await mkdir(path.dirname(INVENTORY_PATH), { recursive: true });
const allPosts = await loadPostUrls();
let previousInventory;
try {
  previousInventory = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
} catch {
  previousInventory = null;
}
previousById = new Map((previousInventory?.posts ?? []).map((post) => [post.source_id, post]));

let selected = allPosts;
if (requestedIds.size) selected = selected.filter((post) => requestedIds.has(post.id));
if (pendingMedia) selected = selected.filter((post) => previousById.get(post.id)?.migration_status !== 'verified');
if (limit > 0) selected = selected.slice(0, limit);

const records = [];
const failures = [];
for (const [index, post] of selected.entries()) {
  process.stdout.write(`[${index + 1}/${selected.length}] ${post.url}\n`);
  try {
    records.push(await importPost(post));
  } catch (error) {
    failures.push({ id: post.id, url: post.url, error: String(error?.message ?? error) });
  }
  await sleep(180);
}

const inventory = {
  generated_at: new Date().toISOString(),
  source: SITEMAP_URL,
  expected_public_posts: EXPECTED_PUBLIC_POSTS,
  sitemap_numeric_posts: allPosts.length,
  selected_posts: selected.length,
  imported_posts: records.length,
  inventory_posts: 0,
  complete: false,
  media_verified_posts: 0,
  media_partial_posts: 0,
  migration_complete: false,
  options: { include_media: includeMedia, inventory_only: inventoryOnly, pending_media: pendingMedia },
  failures,
  posts: [],
};

const mergedById = new Map(previousById);
for (const record of records) mergedById.set(record.source_id, record);
inventory.posts = allPosts.map((post) => mergedById.get(post.id)).filter(Boolean);
inventory.inventory_posts = inventory.posts.length;
inventory.complete = inventory.posts.length === EXPECTED_PUBLIC_POSTS
  && allPosts.length === EXPECTED_PUBLIC_POSTS
  && failures.length === 0;
inventory.media_verified_posts = inventory.posts.filter((post) => post.migration_status === 'verified').length;
inventory.media_partial_posts = inventory.posts.filter((post) => post.migration_status === 'media-partial').length;
inventory.migration_complete = inventory.media_verified_posts === EXPECTED_PUBLIC_POSTS
  && inventory.media_partial_posts === 0;

await writeFile(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
console.log(`Imported ${records.length}/${selected.length}; failures: ${failures.length}; complete: ${inventory.complete}`);

if (allPosts.length !== EXPECTED_PUBLIC_POSTS || failures.length) process.exitCode = 1;
