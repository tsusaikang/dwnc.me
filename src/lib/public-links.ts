import * as cheerio from 'cheerio';
import type { AnyNode, Element, Text } from 'domhandler';
import type { PublicPostSource } from './public-address';

export type { PublicPostSource } from './public-address';

export interface PublicLinkRegistryEntry {
  source: PublicPostSource;
  sourceId: string;
  globalSequence: number;
  canonicalPath: string;
  legacyPaths: readonly string[];
  visibility: 'public';
}

export interface ParsedPublicPostReference {
  source: PublicPostSource | 'canonical';
  lookupKey: string;
  fragment: string | null;
  legacyExternal: boolean;
}

export interface PublicLinkRegistry {
  entries: readonly PublicLinkRegistryEntry[];
  byCanonicalPath: ReadonlyMap<string, PublicLinkRegistryEntry>;
  bySourceIdentity: ReadonlyMap<string, PublicLinkRegistryEntry>;
  resolve(reference: ParsedPublicPostReference): PublicLinkRegistryEntry | null;
  preservesFragment(canonicalPath: string, fragment: string): boolean;
}

export interface PublicLinkTransformContext {
  post: Pick<PublicLinkRegistryEntry, 'source' | 'sourceId' | 'canonicalPath'>;
  registry: PublicLinkRegistry;
}

export interface PublicLinkTransformReport {
  rewritten: number;
  displayTextRewritten: number;
  metadataRewritten: number;
  unavailable: number;
  naverPlatformSelfLinksRemoved: number;
}

export const IMPORTED_PUBLIC_BASELINE = Object.freeze({
  tistory: 164,
  naver: 185,
  total: 349,
});

// Evidence is intentionally keyed by the public source route, never by the unavailable target.
export const PUBLIC_LINK_UNAVAILABLE_ALLOWLIST = Object.freeze([
  Object.freeze({ sourceIdentity: 'tistory:64', occurrences: 2 }),
]);

export const NAVER_PLATFORM_SELF_LINK_CONTAINERS = [
  '.se_component.se_documentTitle',
  '.se-component.se-documentTitle',
  '.blog2_post_function',
  '.se_imageStripArea',
  '.se_component.se_image',
  '.se-component.se-image',
  '.se_mediaArea',
  '.se_component.se_map',
  '.se-component.se-map',
  '.__se_map',
  '.map_copyright',
  '.se_info_btn',
  '.se_caption_group.is-contact',
  '.se_component.se_video',
  '.se-component.se-video',
  '._naverVideo',
  '.prismplayer-area',
  '.webplayer-internal-core-shadow',
  '.pzp',
].join(', ');

export const NAVER_ALWAYS_PLATFORM_LINK_CONTAINERS = [
  '.se_component.se_documentTitle',
  '.se-component.se-documentTitle',
  '.blog2_post_function',
  '.se_component.se_video .prismplayer-area',
  '.se-component.se-video .prismplayer-area',
  '._naverVideo',
  '.prismplayer-area',
  '.webplayer-internal-core-shadow',
  '.pzp',
].join(', ');

const LOCAL_HOSTS = new Set(['dwnc.me', 'www.dwnc.me']);
const NAVER_HOSTS = new Set(['blog.naver.com', 'm.blog.naver.com']);
const EXTERNAL_REL_TOKENS = new Set(['external', 'noopener', 'noreferrer']);
export const PUBLIC_LINK_METADATA_ATTRIBUTES = [
  'data-og-source-url',
  'data-og-url',
  'data-source-url',
  'data-link-url',
  'data-href',
] as const;

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFC').trim();
}

function unsafeEncodedReference(value: string) {
  if (value.includes('\\') || /%(?![0-9a-f]{2})/i.test(value) || /%(?:2f|5c|25)/i.test(value)) return true;
  try {
    decodeURIComponent(value);
  } catch {
    return true;
  }
  const withoutAuthority = value
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '')
    .replace(/^\/\/[^/]+/, '');
  const rawPath = withoutAuthority.split(/[?#]/, 1)[0];
  try {
    const decodedPath = decodeURIComponent(rawPath).normalize('NFC');
    return decodedPath.includes('\\')
      || decodedPath.split('/').some((segment) => segment === '.' || segment === '..');
  } catch {
    return true;
  }
}

function uniqueQueryValue(url: URL, names: readonly string[]) {
  const accepted = new Set(names.map((name) => name.toLowerCase()));
  const values = [...url.searchParams]
    .filter(([key]) => accepted.has(key.toLowerCase()))
    .map(([, value]) => normalized(value));
  if (!values.length || new Set(values).size !== 1) return null;
  return values[0];
}

function decodedFragment(url: URL) {
  if (!url.hash) return null;
  try {
    const fragment = decodeURIComponent(url.hash.slice(1)).normalize('NFC').trim();
    return fragment || null;
  } catch {
    return null;
  }
}

function parsedReference(
  source: PublicPostSource | 'canonical',
  lookupKey: string,
  url: URL,
  legacyExternal: boolean,
): ParsedPublicPostReference {
  return { source, lookupKey, fragment: decodedFragment(url), legacyExternal };
}

export function parsePublicPostReference(href: string): ParsedPublicPostReference | null {
  const raw = normalized(href);
  if (!raw || unsafeEncodedReference(raw)) return null;

  const isProtocolRelative = raw.startsWith('//');
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:/i.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(isProtocolRelative ? `https:${raw}` : raw, 'https://dwnc.me/current-post');
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname).normalize('NFC');
  } catch {
    return null;
  }
  if (decodedPath.includes('\\') || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const isRelative = !hasScheme && !isProtocolRelative;
  const segments = decodedPath.split('/').filter(Boolean);
  const legacyExternal = !isRelative;

  if (isRelative || LOCAL_HOSTS.has(host) || host === 'dwnc.tistory.com') {
    if (host === 'dwnc.tistory.com'
      && !(segments.length === 1 || (segments.length === 2 && segments[0].toLowerCase() === 'm'))) {
      return null;
    }
    if (segments.length === 1 && /^\d{1,10}$/.test(segments[0])) {
      return parsedReference('tistory', `tistory:${segments[0]}`, url, legacyExternal);
    }
    if (segments.length === 2
      && segments[0].toLowerCase() === 'm'
      && /^\d{1,10}$/.test(segments[1])) {
      return parsedReference('tistory', `tistory:${segments[1]}`, url, legacyExternal);
    }
    if (host === 'dwnc.tistory.com') return null;
    if (segments.length === 2 && segments[0] === 'naver' && /^\d{8,14}$/.test(segments[1])) {
      return parsedReference('naver', `naver:${segments[1]}`, url, legacyExternal);
    }
    if (segments.length === 2 && segments[0] === 'posts' && /^[1-9]\d*$/.test(segments[1])) {
      return parsedReference('canonical', `canonical:/posts/${segments[1]}`, url, legacyExternal);
    }
    return null;
  }

  if (host === 'tsusai.blog.me') {
    if (segments.length === 1 && /^\d{8,14}$/.test(segments[0])) {
      return parsedReference('naver', `naver:${segments[0]}`, url, true);
    }
    return null;
  }

  if (!NAVER_HOSTS.has(host)) return null;
  if (segments.length === 2
    && segments[0].toLowerCase() === 'tsusai'
    && /^\d{8,14}$/.test(segments[1])) {
    return parsedReference('naver', `naver:${segments[1]}`, url, true);
  }

  const logNumber = uniqueQueryValue(url, ['logNo', 'postNo']);
  if (!logNumber || !/^\d{8,14}$/.test(logNumber)) return null;
  if (segments.length === 1 && segments[0].toLowerCase() === 'tsusai') {
    const redirect = uniqueQueryValue(url, ['Redirect']);
    if (redirect?.toLowerCase() !== 'log') return null;
    return parsedReference('naver', `naver:${logNumber}`, url, true);
  }
  if (segments.length === 1 && /^postview\.(?:naver|nhn)$/i.test(segments[0])) {
    const blogId = uniqueQueryValue(url, ['blogId']);
    if (blogId?.toLowerCase() !== 'tsusai') return null;
    return parsedReference('naver', `naver:${logNumber}`, url, true);
  }
  return null;
}

export function createPublicLinkRegistry(
  input: readonly PublicLinkRegistryEntry[],
  fragmentIdsByCanonicalPath: Readonly<Record<string, readonly string[]>> = {},
): PublicLinkRegistry {
  const entries = input.map((entry) => ({
    source: entry.source,
    sourceId: normalized(entry.sourceId),
    globalSequence: entry.globalSequence,
    canonicalPath: normalized(entry.canonicalPath).replace(/\/$/, '') || '/',
    legacyPaths: entry.legacyPaths.map((legacyPath) => normalized(legacyPath).replace(/\/$/, '') || '/'),
    visibility: entry.visibility,
  }));
  const byCanonicalPath = new Map<string, PublicLinkRegistryEntry>();
  const bySourceIdentity = new Map<string, PublicLinkRegistryEntry>();
  const byLookupKey = new Map<string, PublicLinkRegistryEntry>();

  for (const entry of entries) {
    if (entry.visibility !== 'public') throw new Error('Public URL registry received a non-public entry.');
    if (!entry.sourceId) throw new Error(`Public URL registry received an empty source identity: ${entry.canonicalPath}`);
    const expectedCanonical = `/posts/${entry.globalSequence}`;
    const expectedLegacy = entry.source === 'tistory'
      ? [`/${entry.sourceId}`]
      : entry.source === 'naver'
        ? [`/naver/${entry.sourceId}`]
        : [];
    if (!Number.isSafeInteger(entry.globalSequence)
      || entry.globalSequence < 1
      || entry.canonicalPath !== expectedCanonical
      || JSON.stringify(entry.legacyPaths) !== JSON.stringify(expectedLegacy)) {
      throw new Error(`Invalid public sequence canonical contract: ${entry.canonicalPath}`);
    }
    const lookupKey = `${entry.source}:${entry.sourceId}`;
    const canonicalLookupKey = `canonical:${entry.canonicalPath}`;
    const sourceIdentity = `${entry.source}:${entry.sourceId}`;
    if (byCanonicalPath.has(entry.canonicalPath)
      || bySourceIdentity.has(sourceIdentity)
      || byLookupKey.has(lookupKey)
      || byLookupKey.has(canonicalLookupKey)) {
      throw new Error(`Public URL registry collision: ${entry.canonicalPath}`);
    }
    byCanonicalPath.set(entry.canonicalPath, entry);
    bySourceIdentity.set(sourceIdentity, entry);
    byLookupKey.set(lookupKey, entry);
    byLookupKey.set(canonicalLookupKey, entry);
  }

  const fragments = new Map(Object.entries(fragmentIdsByCanonicalPath).map(([canonicalPath, ids]) => [
    normalized(canonicalPath).replace(/\/$/, '') || '/',
    new Set(ids.map(normalized).filter(Boolean)),
  ]));
  return {
    entries: Object.freeze(entries),
    byCanonicalPath,
    bySourceIdentity,
    resolve(reference) {
      return byLookupKey.get(reference.lookupKey) ?? null;
    },
    preservesFragment(canonicalPath, fragment) {
      return fragments.get(canonicalPath)?.has(normalized(fragment)) ?? false;
    },
  };
}

function unwrapAnchor($: cheerio.CheerioAPI, anchor: Element) {
  const node = $(anchor);
  if (node.contents().length) node.replaceWith(node.contents());
  else node.remove();
}

function unavailablePresentation($: cheerio.CheerioAPI) {
  return $('<span class="public-link-unavailable" data-public-link-unavailable="owned-post" role="note"></span>')
    .text('연결할 수 없는 이전 글');
}

function unavailableCardPresentation(
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  anchor: cheerio.Cheerio<Element>,
) {
  const mediaWrapper = anchor.find('.og-image, .se_oglink_image, .se-oglink-image').first().clone();
  const presentation = $('<div class="public-link-unavailable-card"></div>');
  if (mediaWrapper.length) presentation.append(mediaWrapper);
  else anchor.find('img, video, iframe').each((_, media) => {
    presentation.append($(media).clone());
  });
  presentation.append(unavailablePresentation($));
  card
    .removeAttr('data-og-title data-og-description data-og-host data-og-source-url data-og-url data-source-url')
    .empty()
    .append(presentation);
}

function removeExternalLinkAttributes(anchor: cheerio.Cheerio<Element>) {
  anchor.removeAttr('target');
  const rel = (anchor.attr('rel') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !EXTERNAL_REL_TOKENS.has(token.toLowerCase()));
  if (rel.length) anchor.attr('rel', [...new Set(rel)].join(' '));
  else anchor.removeAttr('rel');
}

function replaceExactAnchorText(anchor: cheerio.Cheerio<Element>, value: string) {
  const textNodes = anchor.find('*').addBack().contents().toArray()
    .filter((node): node is Text => node.type === 'text');
  const firstText = textNodes.find((node) => normalized(node.data));
  if (!firstText) {
    anchor.text(value);
    return;
  }
  for (const node of textNodes) node.data = node === firstText ? value : '';
}

export function transformPublicPostLinks(
  html: string,
  context: PublicLinkTransformContext,
): { html: string; report: PublicLinkTransformReport } {
  const $ = cheerio.load(html, null, false);
  const report: PublicLinkTransformReport = {
    rewritten: 0,
    displayTextRewritten: 0,
    metadataRewritten: 0,
    unavailable: 0,
    naverPlatformSelfLinksRemoved: 0,
  };

  if (context.post.source === 'naver') {
    $('a[href]').each((_, element) => {
      const reference = parsePublicPostReference($(element).attr('href') ?? '');
      const platformChrome = $(element).closest(NAVER_ALWAYS_PLATFORM_LINK_CONTAINERS).length > 0;
      const currentPostAction = reference?.source === 'naver'
        && reference.lookupKey === `naver:${context.post.sourceId}`
        && $(element).closest(NAVER_PLATFORM_SELF_LINK_CONTAINERS).length > 0;
      if (!platformChrome && !currentPostAction) return;
      unwrapAnchor($, element);
      report.naverPlatformSelfLinksRemoved += 1;
    });
  }

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const originalHref = anchor.attr('href') ?? '';
    const reference = parsePublicPostReference(originalHref);
    if (!reference) return;
    const target = context.registry.resolve(reference);
    if (!target) {
      const card = anchor.closest(
        'figure[data-ke-type="opengraph"], .se_component.se_oglink, .se-component.se-oglink',
      );
      if (card.length) unavailableCardPresentation($, card.first(), anchor);
      else anchor.replaceWith(unavailablePresentation($));
      report.unavailable += 1;
      return;
    }

    const fragment = reference.fragment
      && context.registry.preservesFragment(target.canonicalPath, reference.fragment)
      ? `#${encodeURIComponent(reference.fragment)}`
      : '';
    const canonicalHref = `${target.canonicalPath}${fragment}`;
    const displayedText = normalized(anchor.text());
    const displayedReference = parsePublicPostReference(displayedText);
    const displayedTarget = displayedReference ? context.registry.resolve(displayedReference) : null;
    if (displayedText !== canonicalHref
      && (displayedText === normalized(originalHref)
        || displayedTarget?.canonicalPath === target.canonicalPath)) {
      replaceExactAnchorText(anchor, canonicalHref);
      report.displayTextRewritten += 1;
    }
    anchor.attr('href', canonicalHref);
    removeExternalLinkAttributes(anchor);
    report.rewritten += 1;
  });

  $(`[${PUBLIC_LINK_METADATA_ATTRIBUTES.join('], [')}]`).each((_, element) => {
    const node = $(element);
    for (const attribute of PUBLIC_LINK_METADATA_ATTRIBUTES) {
      const value = node.attr(attribute);
      if (!value) continue;
      const reference = parsePublicPostReference(value);
      if (!reference) continue;
      const target = context.registry.resolve(reference);
      if (!target || value === target.canonicalPath) continue;
      node.attr(attribute, target.canonicalPath);
      report.metadataRewritten += 1;
    }
  });

  return { html: $.root().html() ?? html, report };
}
