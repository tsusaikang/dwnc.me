import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import * as cheerio from 'cheerio';
import { prepareImportedPresentation } from '../src/lib/imported-presentation.ts';
import {
  createPublicLinkRegistry,
  IMPORTED_PUBLIC_BASELINE,
  NAVER_ALWAYS_PLATFORM_LINK_CONTAINERS,
  NAVER_PLATFORM_SELF_LINK_CONTAINERS,
  parsePublicPostReference,
  PUBLIC_LINK_METADATA_ATTRIBUTES,
  PUBLIC_LINK_UNAVAILABLE_ALLOWLIST,
} from '../src/lib/public-links.ts';
import { runPublicLinkSelfTest } from './test-public-links.mjs';
import { BOOTSTRAP_PUBLIC_PROJECTION_SHA256, publicProjectionDigest } from './lib/global-sequence.mjs';
import { loadProjectionBackedPublicContent } from './lib/public-content-preflight.mjs';
import {
  loadTrackedPublicMapLinkPolicy,
  replacePolicyMapBlocks,
} from './lib/public-map-link-policy.mjs';
import {
  applyPublicMediaCuration,
  loadTrackedPublicMediaCurationPolicy,
} from './lib/public-media-curation.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const publicMapLinkPolicy = await loadTrackedPublicMapLinkPolicy(ROOT);
const publicMediaCurationPolicy = await loadTrackedPublicMediaCurationPolicy(ROOT);
const EXPECTED_IMPORTED_INTERNAL = Object.freeze({ tistory: 39, naver: 36, total: 75 });
const EXPECTED_IMPORTED_EXTERNAL = Object.freeze({ tistory: 268, naver: 67, total: 335 });
const EXPECTED_NAVER_PLATFORM_SELF = 1_326;
const EXPECTED_SENSITIVE_NEUTRAL = Object.freeze({ occurrences: 3, posts: 2 });
const EXPECTED_IMPORTED_LEGACY_DISPLAY_TEXT = 21;
const EXPECTED_IMPORTED_LEGACY_DATA_ATTRIBUTES = 57;
const EXPECTED_TISTORY_SEMANTICS = Object.freeze({ images: 812, videos: 0, iframes: 11, pre: 11, code: 14 });
const EXPECTED_TISTORY_SEMANTIC_SHA256 = '597335df18808226f13efa4298435908cbec8d24ddcce7a1be2821c562e817a0';
const EXPECTED_NAVER_SEMANTIC_SHA256 = '31c69f60e6ae68ec88967c623f7a95fefbcc5cf17800ed8f2e0a069fde2645f2';
const issues = new Map();
const markdownProcessor = await createSatteriMarkdownProcessor({
  syntaxHighlight: { type: 'shiki', excludeLangs: ['math'] },
  shikiConfig: { theme: 'github-dark-default', wrap: true },
  smartypants: true,
});

function issue(code, message) {
  const bucket = issues.get(code) ?? { count: 0, examples: [] };
  bucket.count += 1;
  if (bucket.examples.length < 8) bucket.examples.push(message);
  issues.set(code, bucket);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonicalRoute = (value) => {
  try { return decodeURIComponent(String(value)).normalize('NFC').replace(/\/$/, '') || '/'; }
  catch { return String(value).normalize('NFC').replace(/\/$/, '') || '/'; }
};
const publicProjection = JSON.parse(await readFile(path.join(ROOT, 'src/data/public-sequence-v1.json'), 'utf8'));
const mediaMode = process.env.DWNC_MEDIA_MODE ?? 'local';
if (!['local', 'remote'].includes(mediaMode)) throw new Error('MEDIA_E_MODE');
const projectionByIdentity = new Map(publicProjection.map((entry) => [`${entry.source}:${entry.sourceId}`, entry]));
const baselineProjection = publicProjection.length === IMPORTED_PUBLIC_BASELINE.total
  && publicProjectionDigest(publicProjection) === BOOTSTRAP_PUBLIC_PROJECTION_SHA256;

let posts = [];
try {
  posts = (await loadProjectionBackedPublicContent(ROOT, publicProjection, {
    assetMode: mediaMode === 'remote' ? 'manifest' : 'local',
  })).map((post) => ({
    ...post,
    canonicalPath: canonicalRoute(post.canonicalPath),
    provenanceCanonicalPath: canonicalRoute(post.provenanceCanonicalPath),
    visibility: 'public',
  }));
} catch {
  issue('links.sequence', 'Public projection and prepared content could not be joined safely.');
}
const importedPosts = posts.filter((post) => post.imported);
const nativePosts = posts.filter((post) => !post.imported);
// Preserve the original semantic-report ordering without depending on ignored
// migration inventories. Tistory inventory order is published-at descending;
// Naver inventory order is the monotonic log number descending. The immutable
// baseline hashes below still prove this derivation matches the preservation
// audit, while future projected posts remain deterministic.
const compareIdentityBytes = (left, right) => Buffer.compare(
  Buffer.from(`${left.source}:${left.sourceId}`), Buffer.from(`${right.source}:${right.sourceId}`),
);
const semanticOrderRows = {
  tistory: importedPosts.filter((post) => post.source === 'tistory')
    .sort((left, right) => Date.parse(right.data.publishedAt) - Date.parse(left.data.publishedAt)
      || compareIdentityBytes(left, right)),
  naver: importedPosts.filter((post) => post.source === 'naver')
    .sort((left, right) => {
      const leftId = BigInt(left.sourceId);
      const rightId = BigInt(right.sourceId);
      return leftId === rightId ? compareIdentityBytes(left, right) : leftId > rightId ? -1 : 1;
    }),
};
const legacySemanticOrder = {
  tistory: new Map(semanticOrderRows.tistory.map((post, index) => [post.sourceId, index])),
  naver: new Map(semanticOrderRows.naver.map((post, index) => [post.sourceId, index])),
};
const importedCounts = {
  tistory: importedPosts.filter((post) => post.source === 'tistory').length,
  naver: importedPosts.filter((post) => post.source === 'naver').length,
};
if (baselineProjection && (importedCounts.tistory !== IMPORTED_PUBLIC_BASELINE.tistory
  || importedCounts.naver !== IMPORTED_PUBLIC_BASELINE.naver
  || importedPosts.length !== IMPORTED_PUBLIC_BASELINE.total)) {
  issue('links.registry-imported-baseline', `Imported registry is ${importedCounts.tistory}/${importedCounts.naver}/${importedPosts.length}.`);
}
if (publicProjection.length !== posts.length || projectionByIdentity.size !== posts.length) {
  issue('links.sequence', `Public sequence projection/content counts differ (${publicProjection.length}/${posts.length}).`);
}

let registry;
try {
  registry = createPublicLinkRegistry(posts.map(({
    source, sourceId, globalSequence, canonicalPath, legacyPaths, visibility,
  }) => ({
    source, sourceId, globalSequence, canonicalPath, legacyPaths, visibility,
  })));
} catch (error) {
  issue('links.registry', error.message);
  registry = createPublicLinkRegistry([]);
}
if (registry.entries.length !== publicProjection.length
  || registry.byCanonicalPath.size !== registry.entries.length
  || registry.bySourceIdentity.size !== registry.entries.length) {
  issue('links.registry-count', `Registry has ${registry.entries.length} entries for ${nativePosts.length} native posts.`);
}

const counters = {
  sourceInternal: { tistory: 0, naver: 0, native: 0 },
  builtInternal: { tistory: 0, naver: 0, native: 0 },
  sourceExternal: { tistory: 0, naver: 0, native: 0 },
  builtExternal: { tistory: 0, naver: 0, native: 0 },
  sourceUnavailable: 0,
  builtUnavailable: 0,
  sourceNaverPlatformSelf: 0,
  builtNaverPlatformSelf: 0,
  brokenLocal: 0,
  internalTargets: 0,
  sensitiveNeutral: 0,
  sensitiveNeutralPosts: 0,
  sourceLegacyDisplayText: 0,
  builtLegacyDisplayText: 0,
  sourceLegacyDataAttributes: 0,
  builtLegacyDataAttributes: 0,
};
const expectedInternal = new Map();
const builtInternal = new Map();
const expectedCanonicalDisplay = new Map();
const builtCanonicalDisplay = new Map();
const expectedCanonicalData = new Map();
const builtCanonicalData = new Map();
const sourceExternal = new Map();
const builtExternal = new Map();
const unavailableBySource = new Map();
const unavailableRawHrefs = new Set();
const sourceSemantic = [];
const expectedPresentedSemantic = [];
const builtSemantic = [];
const naverSourceSemantic = [];
const naverBuiltSemantic = [];
const tistorySemanticCounts = { images: 0, videos: 0, iframes: 0, pre: 0, code: 0 };
const localExistenceCache = new Map();

function addMultiset(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sameMultiset(actual, expected, code, label) {
  const keys = new Set([...actual.keys(), ...expected.keys()]);
  for (const key of keys) {
    if ((actual.get(key) ?? 0) !== (expected.get(key) ?? 0)) {
      issue(code, `${label} differs for ${JSON.stringify(key)}: ${actual.get(key) ?? 0}/${expected.get(key) ?? 0}.`);
    }
  }
}

function mediaTokens($, root) {
  return root.find('img, video, iframe').toArray().map((element) => {
    const item = $(element);
    return [element.tagName, item.attr('src') ?? '', item.attr('poster') ?? ''].join('|');
  });
}

function codeTokens($, root) {
  return root.find('pre, code').toArray().map((element) => {
    const item = $(element);
    return `${element.tagName}|${item.attr('class') ?? ''}|${item.text()}`;
  });
}

async function sourceRoot(post) {
  const normalizedHtml = post.source === 'naver'
    ? post.body
    : (await markdownProcessor.render(post.body, { frontmatter: post.data })).code;
  const mapPrepared = replacePolicyMapBlocks(normalizedHtml, post.data, publicMapLinkPolicy).html;
  const html = applyPublicMediaCuration(mapPrepared, post.data, publicMediaCurationPolicy).html;
  const $ = cheerio.load(html, null, false);
  const root = post.source === 'naver'
    ? $('.naver-content').first()
    : post.source === 'tistory'
      ? $('.legacy-content').first()
      : $.root();
  if (!root.length) issue('links.source-wrapper', `${post.canonicalPath} lacks its source presentation wrapper.`);
  return { $, root };
}

function sourceAnchorAudit(post, $, root) {
  root.find('a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href') ?? '';
    const reference = parsePublicPostReference(href);
    if (post.source === 'naver') {
      const currentPostAction = reference?.source === 'naver'
        && reference.lookupKey === `naver:${post.sourceId}`
        && anchor.closest(NAVER_PLATFORM_SELF_LINK_CONTAINERS).length > 0;
      if (currentPostAction) counters.sourceNaverPlatformSelf += 1;
      if (currentPostAction || anchor.closest(NAVER_ALWAYS_PLATFORM_LINK_CONTAINERS).length) return;
    }
    if (reference) {
      const target = registry.resolve(reference);
      if (target) {
        counters.sourceInternal[post.source] += 1;
        addMultiset(expectedInternal, target.canonicalPath);
        const displayedReference = parsePublicPostReference(anchor.text().normalize('NFC').trim());
        const displayedTarget = displayedReference ? registry.resolve(displayedReference) : null;
        if (displayedTarget?.canonicalPath === target.canonicalPath) {
          addMultiset(expectedCanonicalDisplay, `${post.canonicalPath}\0${target.canonicalPath}`);
        }
        if (displayedReference
          && anchor.text().normalize('NFC').trim() !== target.canonicalPath
          && displayedTarget?.canonicalPath === target.canonicalPath) {
          counters.sourceLegacyDisplayText += 1;
        }
      } else {
        counters.sourceUnavailable += 1;
        unavailableRawHrefs.add(href.trim());
        const sourceIdentity = `${post.source}:${post.sourceId}`;
        unavailableBySource.set(sourceIdentity, (unavailableBySource.get(sourceIdentity) ?? 0) + 1);
      }
      return;
    }
    counters.sourceExternal[post.source] += 1;
    addMultiset(sourceExternal, `${post.source}\0${href}`);
  });
}

function metadataAttributeAudit(post, $, root, phase) {
  const selector = `[${PUBLIC_LINK_METADATA_ATTRIBUTES.join('], [')}]`;
  root.find(selector).add(root.filter(selector)).each((_, element) => {
    const node = $(element);
    for (const attribute of PUBLIC_LINK_METADATA_ATTRIBUTES) {
      const value = node.attr(attribute);
      if (!value) continue;
      const reference = parsePublicPostReference(value);
      const target = reference ? registry.resolve(reference) : null;
      if (!target) continue;
      const signature = `${post.canonicalPath}\0${attribute}\0${target.canonicalPath}`;
      if (phase === 'source') {
        addMultiset(expectedCanonicalData, signature);
        if (value !== target.canonicalPath) counters.sourceLegacyDataAttributes += 1;
      } else if (value === target.canonicalPath) addMultiset(builtCanonicalData, signature);
      else {
        counters.builtLegacyDataAttributes += 1;
        issue('links.legacy-data-attribute', `${post.canonicalPath} retains ${attribute}=${JSON.stringify(value)}.`);
      }
    }
  });
}

async function localTargetExists(pathname) {
  if (localExistenceCache.has(pathname)) return localExistenceCache.get(pathname);
  const relative = pathname.replace(/^\/+/, '');
  const candidates = pathname === '/'
    ? [path.join(DIST, 'index.html')]
    : [path.join(DIST, relative), path.join(DIST, relative, 'index.html')];
  let exists = false;
  for (const candidate of candidates) {
    try {
      const stats = await lstat(candidate);
      if (stats.isFile()) { exists = true; break; }
    } catch {
      // Try the route form.
    }
  }
  localExistenceCache.set(pathname, exists);
  return exists;
}

async function builtAnchorAudit(post, $, root) {
  for (const element of root.find('a[href]').toArray()) {
    const anchor = $(element);
    const href = anchor.attr('href') ?? '';
    const reference = parsePublicPostReference(href);
    if (post.source === 'naver') {
      const currentPostAction = reference?.source === 'naver'
        && reference.lookupKey === `naver:${post.sourceId}`
        && anchor.closest(NAVER_PLATFORM_SELF_LINK_CONTAINERS).length > 0;
      if (currentPostAction) counters.builtNaverPlatformSelf += 1;
      if (currentPostAction || anchor.closest(NAVER_ALWAYS_PLATFORM_LINK_CONTAINERS).length) {
        issue('links.naver-platform-anchor', `${post.canonicalPath} retains a platform chrome anchor.`);
      }
    }
    const target = reference ? registry.resolve(reference) : null;
    if (target) {
      counters.builtInternal[post.source] += 1;
      addMultiset(builtInternal, target.canonicalPath);
      const canonicalHref = canonicalRoute(href.split('#', 1)[0]);
      if (canonicalHref !== target.canonicalPath || href.includes('?')) {
        issue('links.old-joinable-residue', `${post.canonicalPath} kept a non-canonical owned href.`);
      }
      if (anchor.attr('target')) counters.internalTargets += 1;
      const badRel = (anchor.attr('rel') ?? '').split(/\s+/).some((token) => /^(?:external|noopener|noreferrer)$/i.test(token));
      if (badRel) issue('links.internal-rel', `${post.canonicalPath} kept external rel tokens on ${href}.`);
      if (!(await localTargetExists(target.canonicalPath))) issue('links.internal-target-missing', `${href} has no built target.`);
      const displayedReference = parsePublicPostReference(anchor.text().normalize('NFC').trim());
      if (displayedReference?.legacyExternal && registry.resolve(displayedReference)) {
        counters.builtLegacyDisplayText += 1;
        issue('links.legacy-display-text', `${post.canonicalPath} retains a legacy URL as authored display text.`);
      }
      if (anchor.text().normalize('NFC').trim() === href) {
        addMultiset(builtCanonicalDisplay, `${post.canonicalPath}\0${target.canonicalPath}`);
      }
      const fragment = href.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : '';
      if (fragment) {
        const targetHtml = await readFile(path.join(DIST, target.canonicalPath.replace(/^\/+/, ''), 'index.html'), 'utf8');
        const escapedId = fragment.replaceAll('"', '&quot;');
        if (cheerio.load(targetHtml)(`[id="${escapedId}"]`).length !== 1) {
          issue('links.fragment-target', `${href} has no unique built fragment target.`);
        }
      }
      continue;
    }
    if (reference) issue('links.owned-miss-anchor', `${post.canonicalPath} still has an owned registry-miss href.`);
    else {
      counters.builtExternal[post.source] += 1;
      addMultiset(builtExternal, `${post.source}\0${href}`);
    }

    let resolved;
    try { resolved = new URL(href, `https://dwnc.me${post.canonicalPath}`); }
    catch { continue; }
    if (!['dwnc.me', 'www.dwnc.me'].includes(resolved.hostname.toLowerCase())) continue;
    const exists = await localTargetExists(canonicalRoute(resolved.pathname));
    if (!exists) {
      counters.brokenLocal += 1;
      issue('links.local-broken', `${post.canonicalPath} links to missing local target ${href}.`);
    }
    if (resolved.hash && exists) {
      const route = canonicalRoute(resolved.pathname);
      const file = route === '/' ? path.join(DIST, 'index.html') : path.join(DIST, route.replace(/^\/+/, ''), 'index.html');
      const targetHtml = await readFile(file, 'utf8');
      const id = decodeURIComponent(resolved.hash.slice(1));
      if (!id || cheerio.load(targetHtml)(`[id="${id.replaceAll('"', '&quot;')}"]`).length !== 1) {
        counters.brokenLocal += 1;
        issue('links.local-fragment-broken', `${post.canonicalPath} links to missing fragment ${href}.`);
      }
    }
  }
}

for (const post of posts) {
  const source = await sourceRoot(post);
  sourceAnchorAudit(post, source.$, source.root);
  metadataAttributeAudit(post, source.$, source.root, 'source');
  const routeFile = path.join(DIST, post.canonicalPath.replace(/^\/+/, ''), 'index.html');
  let html;
  try { html = await readFile(routeFile, 'utf8'); }
  catch { issue('links.route-missing', `${post.canonicalPath} has no built route.`); continue; }
  for (const unavailableHref of unavailableRawHrefs) {
    if (unavailableHref && html.includes(unavailableHref)) {
      issue('links.unavailable-metadata', `${post.canonicalPath} exposes an unavailable URL in built HTML.`);
    }
  }
  const $ = cheerio.load(html);
  const root = post.source === 'naver'
    ? $('.article-page .prose > .naver-content').first()
    : post.source === 'tistory'
      ? $('.article-page .prose > .legacy-content').first()
      : $('.article-page .prose').first();
  if (!root.length) { issue('links.built-wrapper', `${post.canonicalPath} lacks its built presentation wrapper.`); continue; }
  await builtAnchorAudit(post, $, root);
  metadataAttributeAudit(post, $, root, 'built');

  const unavailable = root.find('[data-public-link-unavailable="owned-post"]');
  counters.builtUnavailable += unavailable.length;
  unavailable.each((_, element) => {
    const note = $(element);
    if (!note.is('[role="note"]') || note.attr('id') || note.find('[id], a[href]').length || note.closest('a[href]').length) {
      issue('links.unavailable-presentation', `${post.canonicalPath} has a non-neutral unavailable presentation.`);
    }
  });
  const sensitive = root.find('.naver-private-link-placeholder');
  if (sensitive.length) counters.sensitiveNeutralPosts += 1;
  counters.sensitiveNeutral += sensitive.length;
  if (sensitive.closest('a[href]').length || sensitive.find('a[href]').length) {
    issue('links.sensitive-neutral', `${post.canonicalPath} turned a sensitive neutral placeholder into a link.`);
  }

  const sourceMedia = mediaTokens(source.$, source.root);
  const routeMedia = mediaTokens($, root);
  if (JSON.stringify(sourceMedia) !== JSON.stringify(routeMedia)) {
    issue('links.media-sequence', `${post.canonicalPath} changed its media sequence.`);
  }
  if (post.source === 'tistory') {
    const sourceCode = codeTokens(source.$, source.root);
    // Approved exact-fragment repairs restore the authored diagram in place of
    // its accidentally rendered HTML code. Preserve the original source seal,
    // while comparing the build with the same narrowly matched presentation.
    const presented = cheerio.load(prepareImportedPresentation(source.root.toString(), { source: post.source, sourceId: post.sourceId }), null, false);
    const expectedCode = codeTokens(presented, presented.root());
    const routeCode = codeTokens($, root);
    if (JSON.stringify(expectedCode) !== JSON.stringify(routeCode)) {
      issue('links.tistory-code', `${post.canonicalPath} changed its rendered pre/code semantics.`);
    }
    tistorySemanticCounts.images += source.root.find('img').length;
    tistorySemanticCounts.videos += source.root.find('video').length;
    tistorySemanticCounts.iframes += source.root.find('iframe').length;
    tistorySemanticCounts.pre += source.root.find('pre').length;
    tistorySemanticCounts.code += source.root.find('code').length;
    const semanticIdentity = `/${post.sourceId}`;
    sourceSemantic.push(`${semanticIdentity}\0${sourceMedia.join('\u001e')}\0${sourceCode.join('\u001e')}`);
    expectedPresentedSemantic.push(`${semanticIdentity}\0${sourceMedia.join('\u001e')}\0${expectedCode.join('\u001e')}`);
    builtSemantic.push(`${semanticIdentity}\0${routeMedia.join('\u001e')}\0${routeCode.join('\u001e')}`);
  } else if (post.source === 'naver') {
    const semanticIdentity = `/naver/${post.sourceId}`;
    naverSourceSemantic.push(`${semanticIdentity}\0${sourceMedia.join('\u001e')}`);
    naverBuiltSemantic.push(`${semanticIdentity}\0${routeMedia.join('\u001e')}`);
  }
}

const importedInternal = counters.sourceInternal.tistory + counters.sourceInternal.naver;
if (baselineProjection && (counters.sourceInternal.tistory !== EXPECTED_IMPORTED_INTERNAL.tistory
  || counters.sourceInternal.naver !== EXPECTED_IMPORTED_INTERNAL.naver
  || importedInternal !== EXPECTED_IMPORTED_INTERNAL.total)) {
  issue('links.internal-baseline', `Imported joinable links are ${counters.sourceInternal.tistory}/${counters.sourceInternal.naver}/${importedInternal}.`);
}
const importedExternal = counters.sourceExternal.tistory + counters.sourceExternal.naver;
if (baselineProjection && (counters.sourceExternal.tistory !== EXPECTED_IMPORTED_EXTERNAL.tistory
  || counters.sourceExternal.naver !== EXPECTED_IMPORTED_EXTERNAL.naver
  || importedExternal !== EXPECTED_IMPORTED_EXTERNAL.total)) {
  issue('links.external-baseline', `Imported external links are ${counters.sourceExternal.tistory}/${counters.sourceExternal.naver}/${importedExternal}.`);
}
if ((baselineProjection && counters.sourceNaverPlatformSelf !== EXPECTED_NAVER_PLATFORM_SELF)
  || counters.builtNaverPlatformSelf !== 0) {
  issue('links.naver-platform-self', `Naver platform self anchors are source ${counters.sourceNaverPlatformSelf}, built ${counters.builtNaverPlatformSelf}.`);
}
if ((baselineProjection && counters.sourceLegacyDisplayText !== EXPECTED_IMPORTED_LEGACY_DISPLAY_TEXT)
  || counters.builtLegacyDisplayText !== 0) {
  issue('links.legacy-display-count', `Legacy URL display text is source ${counters.sourceLegacyDisplayText}, built ${counters.builtLegacyDisplayText}.`);
}
if ((baselineProjection && counters.sourceLegacyDataAttributes !== EXPECTED_IMPORTED_LEGACY_DATA_ATTRIBUTES)
  || counters.builtLegacyDataAttributes !== 0) {
  issue('links.legacy-data-count', `Legacy exploration data attributes are source ${counters.sourceLegacyDataAttributes}, built ${counters.builtLegacyDataAttributes}.`);
}
sameMultiset(builtInternal, expectedInternal, 'links.internal-multiset', 'Rewritten internal target multiset');
sameMultiset(builtCanonicalDisplay, expectedCanonicalDisplay, 'links.canonical-display-multiset', 'Canonical URL display-text multiset');
sameMultiset(builtCanonicalData, expectedCanonicalData, 'links.canonical-data-multiset', 'Canonical exploration metadata multiset');
sameMultiset(builtExternal, sourceExternal, 'links.external-multiset', 'External authored href multiset');

const activeIdentities = new Set(posts.map((post) => `${post.source}:${post.sourceId}`));
const unavailableAllowlist = new Map(PUBLIC_LINK_UNAVAILABLE_ALLOWLIST
  .filter((entry) => activeIdentities.has(entry.sourceIdentity))
  .map((entry) => [entry.sourceIdentity, entry.occurrences]));
if (baselineProjection) {
  for (const route of new Set([...unavailableBySource.keys(), ...unavailableAllowlist.keys()])) {
    if ((unavailableBySource.get(route) ?? 0) !== (unavailableAllowlist.get(route) ?? 0)) {
      issue('links.unavailable-allowlist', `${route} has ${(unavailableBySource.get(route) ?? 0)}/${(unavailableAllowlist.get(route) ?? 0)} unavailable references.`);
    }
  }
}
if (counters.sourceUnavailable !== counters.builtUnavailable
  || (baselineProjection && counters.sourceUnavailable !== 2)) {
  issue('links.unavailable-count', `Unavailable references are source ${counters.sourceUnavailable}, built ${counters.builtUnavailable}.`);
}
if (baselineProjection && (counters.sensitiveNeutral !== EXPECTED_SENSITIVE_NEUTRAL.occurrences
  || counters.sensitiveNeutralPosts !== EXPECTED_SENSITIVE_NEUTRAL.posts)) {
  issue('links.sensitive-neutral', `Sensitive neutral placeholders are ${counters.sensitiveNeutral}/${counters.sensitiveNeutralPosts}.`);
}
if (baselineProjection) {
  for (const [key, expected] of Object.entries(EXPECTED_TISTORY_SEMANTICS)) {
    if (tistorySemanticCounts[key] !== expected) {
      issue('links.tistory-semantics', `Tistory ${key} count is ${tistorySemanticCounts[key]}; expected ${expected}.`);
    }
  }
}
const orderedLegacyIdentity = (source) => (left, right) => {
  const leftId = left.slice(0, left.indexOf('\0')).split('/').at(-1);
  const rightId = right.slice(0, right.indexOf('\0')).split('/').at(-1);
  const leftOrder = legacySemanticOrder[source].get(leftId) ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = legacySemanticOrder[source].get(rightId) ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return leftId.localeCompare(rightId, 'en');
};
sourceSemantic.sort(orderedLegacyIdentity('tistory'));
expectedPresentedSemantic.sort(orderedLegacyIdentity('tistory'));
builtSemantic.sort(orderedLegacyIdentity('tistory'));
naverSourceSemantic.sort(orderedLegacyIdentity('naver'));
naverBuiltSemantic.sort(orderedLegacyIdentity('naver'));
const sourceSemanticSha = sha256(sourceSemantic.join('\n'));
const expectedPresentedSemanticSha = sha256(expectedPresentedSemantic.join('\n'));
const builtSemanticSha = sha256(builtSemantic.join('\n'));
if (expectedPresentedSemanticSha !== builtSemanticSha) {
  issue('links.tistory-semantic-sha', `Tistory media/pre/code semantic SHA changed in the build (${expectedPresentedSemanticSha}/${builtSemanticSha}).`);
}
const naverSourceSemanticSha = sha256(naverSourceSemantic.join('\n'));
const naverBuiltSemanticSha = sha256(naverBuiltSemantic.join('\n'));
if (naverSourceSemanticSha !== naverBuiltSemanticSha) {
  issue('links.naver-semantic-sha', `Naver media semantic SHA changed in the build (${naverSourceSemanticSha}/${naverBuiltSemanticSha}).`);
}
if (baselineProjection && sourceSemanticSha !== EXPECTED_TISTORY_SEMANTIC_SHA256) {
  issue('links.tistory-semantic-baseline', `Tistory original legacy-identity semantic SHA is ${sourceSemanticSha}; expected ${EXPECTED_TISTORY_SEMANTIC_SHA256}.`);
}
if (baselineProjection && naverBuiltSemanticSha !== EXPECTED_NAVER_SEMANTIC_SHA256) {
  issue('links.naver-semantic-baseline', `Naver legacy-identity semantic SHA is ${naverBuiltSemanticSha}; expected ${EXPECTED_NAVER_SEMANTIC_SHA256}.`);
}
if (counters.internalTargets) issue('links.internal-target', `${counters.internalTargets} internal post anchors still open a target context.`);
if (counters.brokenLocal) issue('links.local-broken', `${counters.brokenLocal} local authored links are broken.`);

const rssRaw = await readFile(path.join(ROOT, 'dist/rss.xml'), 'utf8');
const $rss = cheerio.load(rssRaw, { xmlMode: true });
const expectedRssUrls = new Map(posts.map((post) => [new URL(post.canonicalPath, 'https://dwnc.me').href, post.canonicalPath]));
const seenRssUrls = new Map();
$rss('item').each((_, item) => {
  const link = $rss(item).find('link').first().text().trim();
  const guidNode = $rss(item).find('guid').first();
  const guid = guidNode.text().trim();
  if (!expectedRssUrls.has(link)) issue('links.rss-exact', `RSS has an unexpected non-canonical link ${JSON.stringify(link)}.`);
  else seenRssUrls.set(link, (seenRssUrls.get(link) ?? 0) + 1);
  if (guid !== link) issue('links.rss-exact', `RSS guid ${JSON.stringify(guid)} differs from link ${JSON.stringify(link)}.`);
  if (guidNode.attr('isPermaLink') !== 'true') issue('links.rss-exact', `RSS guid for ${JSON.stringify(link)} is not marked as a permalink.`);
});
for (const expectedUrl of expectedRssUrls.keys()) {
  if (seenRssUrls.get(expectedUrl) !== 1) {
    issue('links.rss-exact', `RSS canonical ${expectedUrl} occurs ${seenRssUrls.get(expectedUrl) ?? 0} times.`);
  }
}

for (const artifact of ['dist/search-index.json', 'dist/rss.xml']) {
  const raw = await readFile(path.join(ROOT, artifact), 'utf8');
  for (const unavailableHref of unavailableRawHrefs) {
    if (unavailableHref && raw.includes(unavailableHref)) {
      issue('links.unavailable-metadata', `${artifact} exposes an unavailable URL.`);
    }
  }
}

let fixtureResult;
try { fixtureResult = runPublicLinkSelfTest(); }
catch (error) { issue('links.fixture', error.message); fixtureResult = { fixtures: 0 }; }

if (issues.size) {
  const lines = [];
  for (const [code, bucket] of [...issues.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${code}: ${bucket.count} issue(s)`);
    for (const example of bucket.examples) lines.push(`  - ${example}`);
    if (bucket.count > bucket.examples.length) lines.push(`  - ... ${bucket.count - bucket.examples.length} more`);
  }
  console.error(lines.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  publicUrlRegistry: {
    imported: importedPosts.length,
    native: nativePosts.length,
    total: registry.entries.length,
    collisions: 0,
    sourceIdentityCollisions: 0,
  },
  publicBodyLinks: {
    internal: counters.builtInternal,
    internalTotal: [...builtInternal.values()].reduce((sum, count) => sum + count, 0),
    unavailableNeutral: counters.builtUnavailable,
    external: counters.builtExternal,
    externalTotal: [...builtExternal.values()].reduce((sum, count) => sum + count, 0),
    naverPlatformSelf: counters.builtNaverPlatformSelf,
    internalTargetAttributes: counters.internalTargets,
    brokenLocal: counters.brokenLocal,
    sensitiveNeutral: { occurrences: counters.sensitiveNeutral, posts: counters.sensitiveNeutralPosts },
    legacyDisplayText: counters.builtLegacyDisplayText,
    canonicalDisplayText: [...builtCanonicalDisplay.values()].reduce((sum, count) => sum + count, 0),
    legacyDataAttributes: counters.builtLegacyDataAttributes,
    canonicalDataAttributes: [...builtCanonicalData.values()].reduce((sum, count) => sum + count, 0),
  },
  rssExactCanonical: { links: seenRssUrls.size, guids: seenRssUrls.size },
  tistoryPresentation: {
    ...tistorySemanticCounts,
    semanticSha256: builtSemanticSha,
    semanticKey: 'legacy route derived from source:sourceId',
  },
  naverPresentation: {
    semanticSha256: naverBuiltSemanticSha,
    semanticKey: 'legacy route derived from source:sourceId',
  },
  fixtures: fixtureResult.fixtures,
}, null, 2));
