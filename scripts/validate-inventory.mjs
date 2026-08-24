import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as cheerio from 'cheerio';
import YAML from 'yaml';
import { readPrivateLedger } from './lib/global-sequence.mjs';
import { indexPreparedPublicContent, selectProjectionBackedContent } from './lib/public-content-preflight.mjs';

const ROOT = process.cwd();
const PUBLIC_VISIBILITY = '전체공개';
const PRIVATE_VISIBILITY = '비공개';
const EXPECTED_TISTORY = 164;
const EXPECTED_NAVER_PUBLIC = 185;
const EXPECTED_NAVER_PRIVATE = 247;
const EXPECTED_DERIVED_VERSION = 2;
const EXPECTED_NORMALIZATION_VERSION = 3;
const PRIVATE_ROOT = path.join(ROOT, 'migration/private');
const issueBuckets = new Map();

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const relative = (filePath) => path.relative(ROOT, filePath) || '.';
const inside = (filePath, directory) => {
  const candidate = path.resolve(filePath);
  const resolvedDirectory = path.resolve(directory);
  return candidate === resolvedDirectory || candidate.startsWith(`${resolvedDirectory}${path.sep}`);
};

function issue(code, message) {
  const bucket = issueBuckets.get(code) ?? { count: 0, examples: [] };
  bucket.count += 1;
  if (bucket.examples.length < 8) bucket.examples.push(message);
  issueBuckets.set(code, bucket);
}

async function loadJson(relativePath, code = 'json.read') {
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
    if (!optional || error?.code !== 'ENOENT') issue('filesystem.walk', `${relative(directory)} could not be read.`);
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

async function walkEntries(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    results.push(absolute);
    if (entry.isDirectory()) results.push(...await walkEntries(absolute));
  }
  return results;
}

function serializedRootIsClosed(text, metadata) {
  const withoutDoctype = String(text).replace(/^\s*<!doctype[^>]*>\s*/i, '');
  const rootTag = metadata.browser_outer_html?.root_tag
    || withoutDoctype.match(/^\s*<([a-z][a-z0-9:-]*)\b/i)?.[1];
  return Boolean(rootTag && new RegExp(`</${rootTag}>\\s*$`, 'i').test(withoutDoctype));
}

function validateCanonicalVerification(metadata, captureMethod, role, label) {
  if (metadata?.canonical !== true || metadata?.role !== role || metadata?.verification?.verified_complete !== true) {
    issue('naver.raw.v2-canonical', `${label} lacks canonical role or completion evidence.`);
    return;
  }
  const verification = metadata.verification;
  if (captureMethod === 'authenticated-rendered-dom-chunked') {
    for (const field of [
      'browser_stable_before_after', 'browser_length_match', 'browser_bytes_match',
      'browser_sha256_match', 'local_root_closed',
    ]) {
      if (verification[field] !== true) issue('naver.raw.v2-verification', `${label} lacks ${field}.`);
    }
  } else if (captureMethod === 'authenticated-rendered-dom-v1-verified-complete') {
    for (const field of ['legacy_manifest_bytes_match', 'legacy_manifest_sha256_match', 'local_root_closed']) {
      if (verification[field] !== true) issue('naver.raw.v2-verification', `${label} lacks ${field}.`);
    }
    if (role === 'canonical-article-html' && verification.browser_inner_characters_match !== true) {
      issue('naver.raw.v2-verification', `${label} lacks browser character verification.`);
    }
  } else {
    issue('naver.raw.v2-method', `${label} has an unsupported capture method.`);
  }
}

async function verifyRecordedFile(metadata, expectedRoot, label, { captureMethod = null, role = null, requireClosedRoot = false } = {}) {
  if (role) validateCanonicalVerification(metadata, captureMethod, role, label);
  if (!metadata?.path || !Number.isInteger(metadata.bytes) || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? '')) {
    issue('naver.raw.manifest', `${label} has incomplete file metadata.`);
    return null;
  }
  const absolute = path.resolve(ROOT, metadata.path);
  if (!inside(absolute, expectedRoot)) {
    issue('naver.raw.boundary', `${label} points outside its expected storage root.`);
    return null;
  }
  try {
    const fileStat = await lstat(absolute);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      issue('naver.raw.type', `${label} is not a regular file.`);
      return null;
    }
    const bytes = await readFile(absolute);
    if (bytes.length !== metadata.bytes) issue('naver.raw.size', `${label} size differs from its manifest.`);
    if (sha256(bytes) !== metadata.sha256) issue('naver.raw.sha256', `${label} SHA-256 differs from its manifest.`);
    const text = bytes.toString('utf8');
    if (Number.isInteger(metadata.characters) && text.length !== metadata.characters) {
      issue('naver.raw.characters', `${label} character count differs from its manifest.`);
    }
    if (requireClosedRoot && !serializedRootIsClosed(text, metadata)) {
      issue('naver.raw.root-close', `${label} does not have a closed serialized root.`);
    }
    return bytes;
  } catch {
    issue('naver.raw.missing', `${label} is missing.`);
    return null;
  }
}

function frontmatterOf(text, label) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    issue('content.frontmatter', `${label} has no YAML frontmatter.`);
    return null;
  }
  try {
    return YAML.parse(match[1]);
  } catch {
    issue('content.frontmatter', `${label} has invalid YAML frontmatter.`);
    return null;
  }
}

function naverBodyOf(text, label) {
  const match = text.match(/\n<div class="naver-content naver-content--[^"]+">\n([\s\S]*)\n<\/div>\n?$/);
  if (!match) issue('naver.normalized.wrapper', `${label} has no normalized Naver body wrapper.`);
  return match?.[1] ?? null;
}

function tistoryBodyOf(text) {
  return text.match(/\n<div class="legacy-content">\n([\s\S]*)\n<\/div>\n?$/)?.[1] ?? null;
}

function countBy(items, key) {
  return items.reduce((result, item) => {
    result[item[key]] = (result[item[key]] ?? 0) + 1;
    return result;
  }, {});
}

function assertNaverFrontmatter(data, record, derived, isPrivate, label) {
  if (!data) return;
  const expected = {
    source: 'naver',
    sourceId: String(record.source_id),
    canonicalPath: `/naver/${record.source_id}`,
    visibility: isPrivate ? 'private' : 'public',
    rawSha256: derived.raw_content_sha256,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (String(data[key]) !== String(value)) issue('naver.normalized.frontmatter', `${label} has inconsistent ${key}.`);
  }
  if (data.title !== record.title) issue('naver.normalized.frontmatter', `${label} has a title mismatch.`);
  if (isPrivate && data.draft !== true) issue('naver.private.draft', `${label} is not permanently draft.`);
  if (!isPrivate && data.draft !== (derived.migration_status !== 'verified')) {
    issue('naver.public.draft', `${label} draft state differs from migration status.`);
  }
  if (data.migrationStatus !== derived.migration_status) {
    issue('naver.normalized.frontmatter', `${label} migration status differs from its manifest.`);
  }
}

function normalizedMime(value) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase();
}

function beginsWithHtmlDocument(bytes) {
  const prefix = bytes.subarray(0, 4096).toString('utf8').replace(/^(?:\uFEFF|\s)+/u, '');
  return /^(?:<!doctype\s+html\b|<html(?:\s|>))/i.test(prefix);
}

async function verifyNaverAsset(asset, { id, isPrivate, normalizedPath, mediaRoot, kind }) {
  const label = `Naver ${id} ${kind}`;
  if (asset?.status !== 'downloaded') {
    if (asset?.local_path || asset?.sha256 || asset?.size) {
      issue('naver.media.metadata', `${label} has local metadata without downloaded status.`);
    }
    return null;
  }
  if (!asset.local_path || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || !Number.isInteger(asset.size)) {
    issue('naver.media.metadata', `${label} has incomplete downloaded metadata.`);
    return null;
  }

  const absolute = isPrivate
    ? path.resolve(path.dirname(normalizedPath), asset.local_path)
    : path.resolve(ROOT, 'public', asset.local_path.replace(/^\/+/, ''));
  const expectedPrefix = isPrivate ? '../media/' : `/media/naver/${id}/`;
  if (!asset.local_path.startsWith(expectedPrefix) || !inside(absolute, mediaRoot)) {
    issue('naver.media.boundary', `${label} points outside its expected media root.`);
    return null;
  }
  try {
    const fileStat = await lstat(absolute);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      issue('naver.media.type', `${label} is not a regular file.`);
      return null;
    }
    const bytes = await readFile(absolute);
    const digest = sha256(bytes);
    if (bytes.length !== asset.size) issue('naver.media.size', `${label} size differs from its manifest.`);
    if (digest !== asset.sha256) issue('naver.media.sha256', `${label} SHA-256 differs from its manifest.`);
    if (kind === 'attachment'
      && (['text/html', 'application/xhtml+xml'].includes(normalizedMime(asset.mime))
        || beginsWithHtmlDocument(bytes))) {
      const artifact = isPrivate ? 'A private Naver attachment' : relative(absolute);
      issue('naver.attachment.html', `${artifact} contains an HTML document instead of an attachment payload.`);
    }
    return { absolute, digest };
  } catch {
    issue('naver.media.missing', `${label} is missing.`);
    return null;
  }
}

function validateAssetStates(derived, id, isPrivate) {
  const artifact = isPrivate ? 'A private Naver manifest' : `Naver ${id}`;
  const allAssets = [...(derived.images ?? []), ...(derived.videos ?? []), ...(derived.attachments ?? [])];
  const hasFailures = allAssets.some((asset) => ['failed', 'unresolved'].includes(asset.status));
  const hasPending = allAssets.some((asset) => asset.status === 'pending');
  if (derived.migration_status === 'verified' && (hasFailures || hasPending)) {
    issue('naver.status', `${artifact} is verified but still has unresolved assets.`);
  }
  if (derived.migration_status === 'media-partial' && !hasFailures) {
    issue('naver.status', `${artifact} is media-partial without a failed or unresolved asset.`);
  }
  if (derived.migration_status === 'body-imported' && hasFailures) {
    issue('naver.status', `${artifact} is body-imported but has a failed or unresolved asset.`);
  }
  if (!['verified', 'media-partial', 'body-imported'].includes(derived.migration_status)) {
    issue('naver.status', `${artifact} has an unsupported migration status.`);
  }
  for (const image of derived.images ?? []) {
    const permitted = {
      'owned-upload': new Set(['downloaded', 'pending', 'failed']),
      'platform-asset': new Set(['downloaded', 'pending', 'failed']),
      'embedded-data': new Set(['downloaded', 'pending', 'failed']),
      'external-reference': new Set(['external-reference', 'pending']),
      'platform-placeholder': new Set(['omitted-placeholder']),
    }[image.classification];
    if (!permitted?.has(image.status)) issue('naver.media.state', `${artifact} has an inconsistent image state.`);
  }
  for (const video of derived.videos ?? []) {
    const permitted = {
      'direct-binary': new Set(['downloaded', 'pending', 'failed']),
      'streaming-or-player': new Set(['external-reference']),
      'external-reference': new Set(['external-reference']),
      unresolved: new Set(['unresolved']),
    }[video.classification];
    if (!permitted?.has(video.status)) issue('naver.media.state', `${artifact} has an inconsistent video state.`);
  }
  for (const attachment of derived.attachments ?? []) {
    if (!new Set(['downloaded', 'pending', 'failed', 'unresolved']).has(attachment.status)) {
      issue('naver.media.state', `${artifact} has an inconsistent attachment state.`);
    }
  }
  const expectedCover = (derived.images ?? []).find((image) => image.status === 'downloaded')?.local_path ?? null;
  if ((derived.cover ?? null) !== expectedCover) {
    issue('naver.media.cover', `${artifact} cover does not match its first downloaded image.`);
  }
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (match, number) => {
      try { return String.fromCodePoint(Number(number)); } catch { return match; }
    })
    .replace(/&#x([a-f0-9]+);/gi, (match, number) => {
      try { return String.fromCodePoint(Number.parseInt(number, 16)); } catch { return match; }
    });
}

function visibleText(value) {
  return decodeEntities(String(value))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .normalize('NFC')
    .trim();
}

function bodyMarkers(value) {
  const text = visibleText(value).replace(/\b이미지 보존 대기\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 80) return [];
  const width = Math.min(112, text.length);
  const starts = [0, Math.max(0, Math.floor((text.length - width) / 2)), Math.max(0, text.length - width)];
  return [...new Set(starts.map((start) => text.slice(start, start + width).trim()).filter((item) => item.length >= 80))];
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

const ALLOWED_NAVER_IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
  'mashup.map.naver.com',
]);

function validateNaverHtmlSafety(body, { id, isPrivate, normalizedPath }) {
  const artifact = isPrivate ? 'A private normalized Naver document' : relative(normalizedPath);
  const $ = cheerio.load(body, null, false);
  let safe = true;
  const forbiddenSelector = [
    'script', 'style', 'form', 'input', 'button', 'textarea', 'select', 'option',
    'object', 'embed', 'applet', 'base', 'meta', 'link', 'frame', 'frameset',
    'template', 'svg', 'math',
  ].join(',');
  if ($(forbiddenSelector).length) {
    safe = false;
    issue('naver.normalized.active-tag', `${artifact} contains a forbidden active HTML element.`);
  }

  let eventAttribute = false;
  let activeUrl = false;
  let unsafeStyle = false;
  $('*').each((_, element) => {
    const $element = $(element);
    for (const [name, rawValue] of Object.entries(element.attribs ?? {})) {
      const value = String(rawValue).trim();
      if (/^on/i.test(name) || name.toLowerCase() === 'srcdoc') eventAttribute = true;
      if (['href', 'src', 'poster', 'action', 'formaction', 'xlink:href'].includes(name.toLowerCase())
        && (/^(?:javascript|vbscript|data):/i.test(value) || value.startsWith('//'))) {
        activeUrl = true;
      }
    }
    const inlineStyle = $element.attr('style') ?? '';
    if (/(?:@import|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:|-moz-binding|behavior\s*:)/i.test(inlineStyle)) {
      unsafeStyle = true;
    }
    for (const match of inlineStyle.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
      const cssUrl = match[2].trim();
      const expectedPrefix = isPrivate ? '../media/' : `/media/naver/${id}/`;
      if (!cssUrl.startsWith(expectedPrefix)) unsafeStyle = true;
    }
  });
  if (eventAttribute) {
    safe = false;
    issue('naver.normalized.event-handler', `${artifact} contains an event handler or iframe srcdoc attribute.`);
  }
  if (activeUrl) {
    safe = false;
    issue('naver.normalized.active-url', `${artifact} contains an executable or protocol-relative URL.`);
  }
  if (unsafeStyle) {
    safe = false;
    issue('naver.normalized.active-style', `${artifact} contains an unsafe or non-local CSS URL.`);
  }

  let unsafeIframe = false;
  $('iframe').each((_, element) => {
    try {
      const source = new URL($(element).attr('src'));
      if (source.protocol !== 'https:'
        || source.username || source.password
        || !ALLOWED_NAVER_IFRAME_HOSTS.has(source.hostname.toLowerCase())) unsafeIframe = true;
    } catch {
      unsafeIframe = true;
    }
  });
  if (unsafeIframe) {
    safe = false;
    issue('naver.normalized.iframe-allowlist', `${artifact} contains an iframe outside the explicit host allowlist.`);
  }
  return safe;
}

function iframeSources(body) {
  const sources = [];
  const iframePattern = /<iframe\b([^>]*)>/gi;
  let iframeMatch;
  while ((iframeMatch = iframePattern.exec(body))) {
    const sourceMatch = iframeMatch[1].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const source = sourceMatch?.[1] ?? sourceMatch?.[2] ?? sourceMatch?.[3];
    if (source) sources.push(decodeEntities(source).trim());
  }
  return sources;
}

function comparableUrl(value) {
  const decoded = decodeEntities(String(value ?? '')).trim();
  try { return new URL(decoded).href; } catch { return decoded; }
}

function isVideoLikeIframeSource(value) {
  try {
    const parsed = new URL(value, 'https://dwnc.me');
    const host = parsed.hostname.toLowerCase();
    return host === 'youtu.be'
      || host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'youtube-nocookie.com'
      || host.endsWith('.youtube-nocookie.com')
      || host === 'vimeo.com'
      || host.endsWith('.vimeo.com')
      || /\/(?:embed|player)(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return /(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|\/(?:embed|player)(?:\/|$))/i.test(String(value));
  }
}

function validateVideoIframeConsistency(body, derived, { isPrivate, normalizedPath }) {
  const sources = iframeSources(body);
  const externalIframeVideos = (derived.videos ?? []).filter((video) => (
    video.classification === 'streaming-or-player'
    && video.status === 'external-reference'
    && video.element_types?.includes('iframe')
  ));
  const artifact = isPrivate ? 'A private normalized Naver document' : relative(normalizedPath);
  for (const video of externalIframeVideos) {
    if (!video.source_url || !sources.some((source) => comparableUrl(source) === comparableUrl(video.source_url))) {
      issue('naver.video.iframe-manifest', `${artifact} does not retain an external player iframe recorded by its video manifest.`);
    }
  }
  for (const source of sources.filter(isVideoLikeIframeSource)) {
    if (!externalIframeVideos.some((video) => comparableUrl(source) === comparableUrl(video.source_url))) {
      issue('naver.video.iframe-body', `${artifact} contains a video-like iframe without a matching external-player manifest entry.`);
    }
  }
}

async function auditPrivateBoundary(privateRecords, privateNormalizedBodies) {
  const gitignore = await readFile(path.join(ROOT, '.gitignore'), 'utf8').catch(() => '');
  const ignoreLines = gitignore.split(/\r?\n/).map((line) => line.trim());
  if (!ignoreLines.includes('migration/private/')) issue('privacy.gitignore', 'migration/private/ is not explicitly excluded by .gitignore.');
  if (!ignoreLines.includes('migration/source-inventory/naver-posts.json')) {
    issue('privacy.gitignore', 'The private-bearing Naver source inventory is not explicitly excluded by .gitignore.');
  }

  const privateEntries = [PRIVATE_ROOT, ...await walkEntries(PRIVATE_ROOT)];
  for (const entry of privateEntries) {
    try {
      const fileStat = await lstat(entry);
      if (fileStat.isSymbolicLink()) issue('privacy.symlink', `${relative(entry)} is a symbolic link.`);
      if ((fileStat.mode & 0o077) !== 0) issue('privacy.permissions', `${relative(entry)} is accessible to group or other users.`);
    } catch {
      issue('privacy.permissions', `${relative(entry)} permissions could not be checked.`);
    }
  }

  const textExtensions = new Set([
    '.astro', '.cjs', '.css', '.html', '.js', '.json', '.map', '.md', '.mdx', '.mjs',
    '.svg', '.ts', '.tsx', '.txt', '.webmanifest', '.xml', '.yaml', '.yml',
  ]);
  const publicRoots = [path.join(ROOT, 'src'), path.join(ROOT, 'public'), path.join(ROOT, 'dist')];
  const publicTextFiles = [];
  for (const publicRoot of publicRoots) {
    for (const file of await walk(publicRoot, { optional: true })) {
      try {
        const fileStat = await lstat(file);
        if (fileStat.isSymbolicLink()) {
          issue('privacy.public-symlink', `${relative(file)} is a symbolic link in a public root.`);
          continue;
        }
        if (textExtensions.has(path.extname(file).toLowerCase())) publicTextFiles.push(file);
      } catch {
        issue('privacy.public-read', `${relative(file)} could not be inspected.`);
      }
    }
  }
  const publicDocuments = [];
  for (const file of publicTextFiles) {
    try {
      const raw = (await readFile(file, 'utf8')).normalize('NFC');
      publicDocuments.push({ file, raw, leakText: normalizeLeakText(raw), visible: visibleText(raw) });
    } catch {
      issue('privacy.public-read', `${relative(file)} could not be read.`);
    }
  }

  const idLeakFiles = new Set();
  const routeLeakFiles = new Set();
  const originLeakFiles = new Set();
  const bodyLeakFiles = new Set();
  for (const record of privateRecords) {
    const id = String(record.source_id);
    const title = String(record.title ?? '').normalize('NFC').trim();
    const markers = bodyMarkers(privateNormalizedBodies.get(id) ?? '');
    for (const document of publicDocuments) {
      if (containsPrivateIdLiteral(document.leakText, id)) idLeakFiles.add(document.file);
      if (containsPrivateCanonicalPath(document.leakText, id)) routeLeakFiles.add(document.file);
      if (containsOwnerOrigin(document.leakText, id)) originLeakFiles.add(document.file);
      const matches = markers.filter((marker) => document.visible.includes(marker)).length;
      const hasTitle = title.length >= 4 && document.visible.includes(title);
      if ((hasTitle && matches >= 1) || matches >= 2) bodyLeakFiles.add(document.file);
    }
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
  for (const file of bodyLeakFiles) {
    issue('privacy.private-body-leak', `${safePublicArtifactLabel(file, privateRecords)} contains private normalized body markers.`);
  }
}

const naver = await loadJson('migration/source-inventory/naver-posts.json', 'naver.inventory.read');
const tistory = await loadJson('migration/source-inventory/tistory-posts.json', 'tistory.inventory.read');
const naverPublicSummary = await loadJson('migration/source-inventory/naver-public-posts.json', 'naver.public-summary.read');
const naverPrivateSummary = await loadJson('migration/private/naver-inventory.json', 'naver.private-summary.read');
const publicProjection = await loadJson('src/data/public-sequence-v1.json', 'sequence.public-projection.read');

const naverRecords = naver?.posts ?? [];
const tistoryRecords = tistory?.posts ?? [];
const naverVisibility = countBy(naverRecords, 'visibility');
const publicNaverIds = new Set(naverRecords.filter((post) => post.visibility === PUBLIC_VISIBILITY).map((post) => String(post.source_id)));
const privateNaverRecords = naverRecords.filter((post) => post.visibility === PRIVATE_VISIBILITY);
const privateNaverIds = new Set(privateNaverRecords.map((post) => String(post.source_id)));
const projectedIdentities = new Set((publicProjection ?? []).map((entry) => `${entry.source}:${entry.sourceId}`));
let currentPrivateOrReservedNaverIds = new Set(privateNaverIds);
try {
  const sequenceLedger = await readPrivateLedger(path.join(ROOT, 'migration/private/sequence/global-sequence-v1.json'));
  currentPrivateOrReservedNaverIds = new Set(sequenceLedger.entries
    .filter((entry) => entry.source === 'naver' && (entry.visibility !== 'public' || entry.status !== 'active'))
    .map((entry) => entry.sourceId));
} catch {
  issue('sequence.private-boundary', 'Current private/reserved sequence metadata could not be read safely.');
}

if (naverRecords.length !== (naver?.owner_visible_total ?? -1)) issue('naver.inventory.count', 'Naver source inventory count differs from owner-visible total.');
if (naverRecords.length !== EXPECTED_NAVER_PUBLIC + EXPECTED_NAVER_PRIVATE) issue('naver.inventory.count', `Naver source inventory has ${naverRecords.length} records; expected 432.`);
if (new Set(naverRecords.map((post) => String(post.source_id))).size !== naverRecords.length) issue('naver.inventory.duplicate', 'Naver source inventory contains duplicate IDs.');
if (naverVisibility[PUBLIC_VISIBILITY] !== EXPECTED_NAVER_PUBLIC || naverVisibility[PRIVATE_VISIBILITY] !== EXPECTED_NAVER_PRIVATE) {
  issue('naver.inventory.visibility', 'Naver public/private source counts differ from 185/247.');
}

if (tistory) {
  if (tistory.sitemap_numeric_posts !== tistory.expected_public_posts) issue('tistory.inventory.count', 'Tistory sitemap count differs from expected public count.');
  if (new Set(tistoryRecords.map((post) => String(post.source_id))).size !== tistoryRecords.length) issue('tistory.inventory.duplicate', 'Tistory inventory contains duplicate IDs.');
  if (tistory.inventory_posts !== tistoryRecords.length) issue('tistory.inventory.count', 'Tistory inventory count differs from its post array.');
  if (tistoryRecords.length !== EXPECTED_TISTORY) issue('tistory.inventory.count', `Tistory inventory has ${tistoryRecords.length} records; expected ${EXPECTED_TISTORY}.`);
  const verified = tistoryRecords.filter((post) => post.migration_status === 'verified').length;
  const partial = tistoryRecords.filter((post) => post.migration_status === 'media-partial').length;
  if (tistory.media_verified_posts !== verified) issue('tistory.inventory.summary', 'Tistory verified count differs from its summary.');
  if (tistory.media_partial_posts !== partial) issue('tistory.inventory.summary', 'Tistory partial count differs from its summary.');
  if (!tistory.migration_complete || verified !== EXPECTED_TISTORY) issue('tistory.status', `Tistory has ${verified}/${EXPECTED_TISTORY} verified posts.`);
}

const referencedPublicMedia = new Set();
const referencedPrivateMedia = new Set();
const privateNormalizedBodies = new Map();
const publicDerived = new Map();
const privateDerived = new Map();
const naverCaptureMethods = {};
let naverVerified = 0;
let naverDownloadedMedia = 0;
let naverSafePublicBodies = 0;

for (const record of naverRecords) {
  const id = String(record.source_id);
  const isPrivate = record.visibility === PRIVATE_VISIBILITY;
  if (!isPrivate && record.visibility !== PUBLIC_VISIBILITY) {
    issue('naver.inventory.visibility', `Naver ${id} has an unsupported visibility.`);
    continue;
  }
  const rawRoot = isPrivate
    ? path.join(ROOT, 'migration/private/naver', id, 'raw')
    : path.join(ROOT, 'migration/raw/naver', id);
  const rawManifestPath = path.join(rawRoot, 'recapture-v2/manifest.json');
  const derivedPath = isPrivate
    ? path.join(ROOT, 'migration/private/naver', id, 'migration.json')
    : path.join(ROOT, 'migration/raw/naver', id, 'migration.json');
  const normalizedPath = isPrivate
    ? path.join(ROOT, 'migration/private/naver', id, 'normalized/post.md')
    : path.join(ROOT, 'src/data/posts/naver', `${id}.md`);
  const mediaRoot = isPrivate
    ? path.join(ROOT, 'migration/private/naver', id, 'media')
    : path.join(ROOT, 'public/media/naver', id);

  const rawManifest = await loadJson(relative(rawManifestPath), 'naver.raw.manifest');
  if (!rawManifest) continue;
  if (rawManifest.version !== 2 || rawManifest.source !== 'naver'
    || String(rawManifest.source_id) !== id
    || rawManifest.visibility !== record.visibility
    || rawManifest.source_url !== record.source_url) {
    issue('naver.raw.identity', `Naver ${id} raw manifest identity differs from source inventory.`);
  }
  naverCaptureMethods[rawManifest.capture_method] = (naverCaptureMethods[rawManifest.capture_method] ?? 0) + 1;
  if (rawManifest.canonical_policy?.article_html !== 'files.content'
    || rawManifest.canonical_policy?.source_wrapper !== 'files.wrapper'
    || rawManifest.canonical_policy?.frame_page_canonical !== false) {
    issue('naver.raw.v2-policy', `Naver ${id} has an invalid canonical raw policy.`);
  }
  await verifyRecordedFile(rawManifest.files?.content, rawRoot, `Naver ${id} canonical content`, {
    captureMethod: rawManifest.capture_method,
    role: 'canonical-article-html',
    requireClosedRoot: true,
  });
  await verifyRecordedFile(rawManifest.files?.wrapper, rawRoot, `Naver ${id} canonical wrapper`, {
    captureMethod: rawManifest.capture_method,
    role: 'canonical-source-wrapper',
    requireClosedRoot: true,
  });
  const legacyPage = rawManifest.diagnostic?.legacy_page_v1;
  if (legacyPage?.canonical !== false || legacyPage?.known_transport_truncated !== true) {
    issue('naver.raw.v2-diagnostic', `Naver ${id} legacy frame-page diagnostic policy is invalid.`);
  }
  await verifyRecordedFile(legacyPage, rawRoot, `Naver ${id} legacy frame-page diagnostic`);

  const derived = await loadJson(relative(derivedPath), 'naver.derived.read');
  if (!derived) continue;
  (isPrivate ? privateDerived : publicDerived).set(id, derived);
  if (derived.source !== 'naver' || String(derived.source_id) !== id || derived.visibility !== record.visibility) {
    issue('naver.derived.identity', `Naver ${id} derived manifest identity differs from source inventory.`);
  }
  if (derived.version !== EXPECTED_DERIVED_VERSION || derived.normalization_version !== EXPECTED_NORMALIZATION_VERSION) {
    const artifact = isPrivate ? 'A private Naver derived manifest' : `Naver ${id}`;
    issue('naver.derived.version', `${artifact} does not use derived schema 2 and normalization version 3.`);
  }
  if (derived.canonical_path !== `/naver/${id}` || derived.source_url !== record.source_url) {
    issue('naver.derived.route', `Naver ${id} derived source or canonical URL is inconsistent.`);
  }
  if (derived.editor_generation !== rawManifest.editor_generation) issue('naver.derived.editor', `Naver ${id} editor generation differs from raw capture.`);
  if (derived.raw_manifest_path !== relative(rawManifestPath) || derived.raw_content_sha256 !== rawManifest.files?.content?.sha256) {
    issue('naver.derived.raw-link', `Naver ${id} derived manifest does not match the raw content manifest.`);
  }
  if (derived.raw_capture_version !== 2
    || derived.raw_capture_method !== rawManifest.capture_method
    || derived.canonical_raw_content_path !== rawManifest.files?.content?.path) {
    issue('naver.derived.raw-link', `Naver ${id} derived manifest does not identify the v2 canonical raw source.`);
  }
  if (derived.normalized_path !== relative(normalizedPath)) issue('naver.derived.normalized-link', `Naver ${id} normalized path is inconsistent.`);
  validateAssetStates(derived, id, isPrivate);
  if (derived.migration_status === 'verified') naverVerified += 1;

  try {
    const normalizedText = await readFile(normalizedPath, 'utf8');
    const data = frontmatterOf(normalizedText, relative(normalizedPath));
    assertNaverFrontmatter(data, record, derived, isPrivate, relative(normalizedPath));
    const body = naverBodyOf(normalizedText, relative(normalizedPath));
    if (body !== null && sha256(body) !== derived.normalized_body_sha256) {
      issue('naver.normalized.sha256', `Naver ${id} normalized body SHA-256 differs from its manifest.`);
    }
    if (body !== null) {
      validateVideoIframeConsistency(body, derived, { isPrivate, normalizedPath });
      if (validateNaverHtmlSafety(body, { id, isPrivate, normalizedPath }) && !isPrivate) naverSafePublicBodies += 1;
    }
    if (isPrivate && body !== null) privateNormalizedBodies.set(id, body);
  } catch {
    issue('naver.normalized.missing', `Naver ${id} normalized post is missing.`);
  }

  const assets = [
    ...(derived.images ?? []).map((asset) => ({ asset, kind: 'image' })),
    ...(derived.videos ?? []).map((asset) => ({ asset, kind: 'video' })),
    ...(derived.attachments ?? []).map((asset) => ({ asset, kind: 'attachment' })),
  ];
  for (const { asset, kind } of assets) {
    const verified = await verifyNaverAsset(asset, { id, isPrivate, normalizedPath, mediaRoot, kind });
    if (!verified) continue;
    naverDownloadedMedia += 1;
    (isPrivate ? referencedPrivateMedia : referencedPublicMedia).add(verified.absolute);
  }
}

const referencedTistoryMedia = new Set();
for (const post of tistoryRecords) {
  const id = String(post.source_id);
  try {
    const raw = await readFile(path.join(ROOT, post.raw_path));
    if (sha256(raw) !== post.raw_sha256) issue('tistory.raw.sha256', `Tistory ${id} raw SHA-256 differs from inventory.`);
  } catch {
    issue('tistory.raw.missing', `Tistory ${id} raw snapshot is missing.`);
  }
  for (const media of post.media ?? []) {
    if (media.status !== 'downloaded' || !media.local_path) continue;
    const absolute = path.join(ROOT, 'public', media.local_path.replace(/^\/+/, ''));
    referencedTistoryMedia.add(absolute);
    try {
      const bytes = await readFile(absolute);
      if (bytes.length !== media.size) issue('tistory.media.size', `Tistory ${id} media size differs from inventory.`);
      if (sha256(bytes) !== media.sha256) issue('tistory.media.sha256', `Tistory ${id} media SHA-256 differs from inventory.`);
    } catch {
      issue('tistory.media.missing', `Tistory ${id} downloaded media is missing.`);
    }
  }
}

const contentFiles = (await walk(path.join(ROOT, 'src/data/posts'))).filter((file) => /\.mdx?$/.test(file));
const contentCounts = { tistory: 0, naver: 0, native: 0, unknown: 0 };
const publicContentIds = new Set();
for (const file of contentFiles) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { issue('content.read', `${relative(file)} could not be read.`); continue; }
  const data = frontmatterOf(text, relative(file));
  if (!data) continue;
  contentCounts[data.source] = (contentCounts[data.source] ?? 0) + 1;
  for (const field of ['title', 'publishedAt', 'source', 'sourceId', 'canonicalPath', 'visibility']) {
    if (!data[field]) issue('content.frontmatter', `${relative(file)} is missing ${field}.`);
  }
  if (data.visibility !== 'public') issue('content.private', `${relative(file)} contains non-public content in the public content tree.`);
  const identity = `${data.source}:${data.sourceId}`;
  if (publicContentIds.has(identity)) issue('content.duplicate', `${relative(file)} duplicates a public content identity.`);
  publicContentIds.add(identity);

  if (data.source === 'tistory') {
    const record = tistoryRecords.find((post) => String(post.source_id) === String(data.sourceId));
    if (!record) issue('tistory.content.inventory', `${relative(file)} has no matching Tistory inventory record.`);
    else {
      if (record.content_path !== relative(file)) issue('tistory.content.path', `${relative(file)} differs from its Tistory inventory path.`);
      if (record.canonical_path !== data.canonicalPath) issue('tistory.content.route', `${relative(file)} canonical path differs from inventory.`);
      const body = tistoryBodyOf(text);
      if (!body || sha256(body) !== record.body_sha256) issue('tistory.content.sha256', `${relative(file)} body SHA-256 differs from inventory.`);
    }
  } else if (data.source === 'naver') {
    const id = String(data.sourceId);
    if (!publicNaverIds.has(id) && !privateNaverIds.has(id)) {
      issue('privacy.private-content', `${relative(file)} does not correspond to an immutable Naver source identity.`);
    }
  }
}
if (contentCounts.tistory !== EXPECTED_TISTORY || contentCounts.naver < EXPECTED_NAVER_PUBLIC) {
  issue('content.count', `Public content counts are Tistory ${contentCounts.tistory}, Naver ${contentCounts.naver}; immutable baselines are 164/185.`);
}
if (contentFiles.length !== contentCounts.tistory + contentCounts.naver + contentCounts.native || contentCounts.unknown) {
  issue('content.count', 'Public content tree source counts are inconsistent.');
}

let preparedContentIndex = null;
try {
  preparedContentIndex = await indexPreparedPublicContent(ROOT);
  const projectedContent = selectProjectionBackedContent(
    [...preparedContentIndex.values()].flat(),
    publicProjection ?? [],
    { development: false },
  );
  if (projectedContent.length !== (publicProjection?.length ?? 0)
    || projectedContent.some((post) => !projectedIdentities.has(`${post.source}:${post.sourceId}`))) {
    issue('content.projection', 'Current public projection does not exactly join prepared public content.');
  }
} catch {
  issue('content.projection', 'Current public projection could not be joined to prepared public content safely.');
}

for (const row of preparedContentIndex ? [...preparedContentIndex.values()].flat() : []) {
  for (const assetPath of row.assetPaths ?? []) {
    const absolute = path.join(ROOT, 'public', assetPath.replace(/^\/+/, ''));
    if (row.source === 'tistory') referencedTistoryMedia.add(absolute);
    if (row.source === 'naver') referencedPublicMedia.add(absolute);
  }
}

for (const [root, referenced, code] of [
  [path.join(ROOT, 'public/media/tistory'), referencedTistoryMedia, 'tistory.media.unreferenced'],
  [path.join(ROOT, 'public/media/naver'), referencedPublicMedia, 'naver.public-media.unreferenced'],
  [path.join(ROOT, 'migration/private/naver'), referencedPrivateMedia, 'naver.private-media.unreferenced'],
]) {
  const files = await walk(root, { optional: true });
  const candidates = code === 'naver.private-media.unreferenced'
    ? files.filter((file) => file.includes(`${path.sep}media${path.sep}`))
    : files;
  for (const file of candidates) {
    if (!referenced.has(file)) issue(code, `${relative(file)} is not referenced by a downloaded asset manifest.`);
  }
}

if (naverPublicSummary) {
  if (naverPublicSummary.version !== 1
    || naverPublicSummary.source !== 'migration/source-inventory/naver-posts.json'
    || naverPublicSummary.expected_public_posts !== EXPECTED_NAVER_PUBLIC
    || naverPublicSummary.migrated_public_posts !== EXPECTED_NAVER_PUBLIC
    || naverPublicSummary.posts?.length !== EXPECTED_NAVER_PUBLIC) {
    issue('naver.public-summary.count', 'Naver public summary does not contain exactly 185 migrated posts.');
  }
  const summaryIds = new Set();
  for (const post of naverPublicSummary.posts ?? []) {
    const id = String(post.source_id);
    summaryIds.add(id);
    if (!publicNaverIds.has(id) || post.visibility !== PUBLIC_VISIBILITY) issue('naver.public-summary.boundary', `Naver public summary contains a non-public record (${id}).`);
    const canonical = publicDerived.get(id);
    if (!canonical || !isDeepStrictEqual(canonical, post)) {
      issue('naver.public-summary.consistency', 'The public Naver summary contains a stale or incomplete derived-manifest snapshot.');
    }
  }
  if (summaryIds.size !== EXPECTED_NAVER_PUBLIC) issue('naver.public-summary.count', 'Naver public summary IDs are missing or duplicated.');
  const verified = (naverPublicSummary.posts ?? []).filter((post) => post.migration_status === 'verified').length;
  if (naverPublicSummary.verified_public_posts !== verified) issue('naver.public-summary.count', 'Naver public verified summary count is inconsistent.');
}

if (naverPrivateSummary) {
  if (naverPrivateSummary.expected_private_posts !== EXPECTED_NAVER_PRIVATE
    || naverPrivateSummary.migrated_private_posts !== EXPECTED_NAVER_PRIVATE
    || naverPrivateSummary.posts?.length !== EXPECTED_NAVER_PRIVATE) {
    issue('naver.private-summary.count', 'Naver private summary does not contain exactly 247 migrated posts.');
  }
  const allowedPrivateKeys = new Set([
    'source_id', 'migration_status', 'editor_generation', 'raw_content_sha256',
    'normalized_body_sha256', 'normalized_path', 'images', 'videos', 'attachments',
  ]);
  const summaryIds = new Set();
  const serialized = JSON.stringify(naverPrivateSummary).normalize('NFC');
  for (const post of naverPrivateSummary.posts ?? []) {
    const id = String(post.source_id);
    summaryIds.add(id);
    if (!privateNaverIds.has(id)) issue('naver.private-summary.boundary', `Naver private summary contains an unexpected record (${id}).`);
    if (Object.keys(post).some((key) => !allowedPrivateKeys.has(key))) issue('naver.private-summary.sensitive-field', `Naver private summary contains a non-allowlisted field (${id}).`);
    const canonical = privateDerived.get(id);
    if (!canonical
      || canonical.migration_status !== post.migration_status
      || canonical.editor_generation !== post.editor_generation
      || canonical.raw_content_sha256 !== post.raw_content_sha256
      || canonical.normalized_body_sha256 !== post.normalized_body_sha256
      || canonical.normalized_path !== post.normalized_path) {
      issue('naver.private-summary.consistency', 'The private Naver summary contains a stale or incomplete manifest projection.');
    }
    if (canonical && (post.images !== (canonical.images?.length ?? 0)
      || post.videos !== (canonical.videos?.length ?? 0)
      || post.attachments !== (canonical.attachments?.length ?? 0))) {
      issue('naver.private-summary.consistency', 'The private Naver summary contains inconsistent asset counts.');
    }
  }
  if (summaryIds.size !== EXPECTED_NAVER_PRIVATE) issue('naver.private-summary.count', 'Naver private summary IDs are missing or duplicated.');
  for (const record of privateNaverRecords) {
    const title = String(record.title ?? '').normalize('NFC').trim();
    if (title.length >= 4 && serialized.includes(title)) issue('naver.private-summary.sensitive-field', `Naver private summary contains private title text (${record.source_id}).`);
  }
  const verified = (naverPrivateSummary.posts ?? []).filter((post) => post.migration_status === 'verified').length;
  if (naverPrivateSummary.verified_private_posts !== verified) issue('naver.private-summary.count', 'Naver private verified summary count is inconsistent.');
}

if (naverVerified !== EXPECTED_NAVER_PUBLIC + EXPECTED_NAVER_PRIVATE) {
  issue('naver.status.incomplete', `Naver media verification is ${naverVerified}/432; expected 432/432.`);
}
if (naverCaptureMethods['authenticated-rendered-dom-chunked'] !== 11
  || naverCaptureMethods['authenticated-rendered-dom-v1-verified-complete'] !== 421) {
  issue('naver.raw.v2-method', 'Canonical raw capture methods do not match 11 recaptured and 421 promoted posts.');
}

const actualPublicNaverFiles = new Set(
  contentFiles
    .filter((file) => inside(file, path.join(ROOT, 'src/data/posts/naver')))
    .map((file) => path.basename(file, path.extname(file))),
);
for (const id of publicNaverIds) if (!actualPublicNaverFiles.has(id)) issue('naver.public-content.missing', `Public Naver normalized post is missing (${id}).`);
for (const id of actualPublicNaverFiles) {
  if (!publicNaverIds.has(id) && !privateNaverIds.has(id)) {
    issue('privacy.private-content', `Unexpected Naver normalized post exists in the public tree (${id}).`);
  }
}

const currentPrivateBoundaryRecords = privateNaverRecords.filter((record) => (
  currentPrivateOrReservedNaverIds.has(String(record.source_id))
));
const currentPrivateBoundaryBodies = new Map([...privateNormalizedBodies].filter(([id]) => (
  currentPrivateOrReservedNaverIds.has(id)
)));
await auditPrivateBoundary(currentPrivateBoundaryRecords, currentPrivateBoundaryBodies);

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
  naver: {
    inventory: naverRecords.length,
    public: publicNaverIds.size,
    private: privateNaverIds.size,
    verified: naverVerified,
    downloadedMedia: naverDownloadedMedia,
    safePublicBodies: naverSafePublicBodies,
    canonicalRawMethods: naverCaptureMethods,
  },
  tistory: {
    inventory: tistoryRecords.length,
    verified: tistoryRecords.filter((post) => post.migration_status === 'verified').length,
    downloadedMedia: referencedTistoryMedia.size,
  },
  publicContent: {
    total: contentFiles.length,
    tistory: contentCounts.tistory,
    naver: contentCounts.naver,
  },
  privacyBoundary: {
    privateRecords: privateNaverIds.size,
    publicLeakMarkers: 0,
  },
}, null, 2));
