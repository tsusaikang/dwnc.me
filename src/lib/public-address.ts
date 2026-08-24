import projectionJson from '../data/public-sequence-v1.json' with { type: 'json' };

export type PublicPostSource = 'tistory' | 'naver' | 'native';

export interface PublicPostAddress {
  globalSequence: number;
  source: PublicPostSource;
  sourceId: string;
  canonicalPath: string;
  legacyPaths: readonly string[];
}

export interface AddressablePublicPost {
  data: {
    source: PublicPostSource;
    sourceId: string;
    canonicalPath: string;
  };
}

const projection = projectionJson as PublicPostAddress[];
const byIdentity = new Map<string, PublicPostAddress>();
const byCanonicalPath = new Map<string, PublicPostAddress>();
const byLegacyPath = new Map<string, PublicPostAddress>();
const fixedRoutes = new Set([
  '/',
  '/404',
  '/about',
  '/archive',
  '/category',
  '/rss.xml',
  '/search-index.json',
  '/tags',
]);

const identity = (source: PublicPostSource, sourceId: string) => `${source}:${sourceId}`;
const validSourceId = (source: PublicPostSource, sourceId: unknown): sourceId is string => {
  if (typeof sourceId !== 'string'
    || !sourceId
    || sourceId !== sourceId.trim()
    || sourceId !== sourceId.normalize('NFC')) return false;
  if (source === 'tistory' || source === 'naver') return /^[1-9]\d*$/.test(sourceId);
  return sourceId.length <= 160
    && !/[\\/%\u0000-\u001f\u007f]/u.test(sourceId)
    && sourceId !== '.'
    && sourceId !== '..';
};

const canonicalPaths = new Set(projection.map((entry) => entry.canonicalPath));
const allLegacyPaths = projection.flatMap((entry) => entry.legacyPaths);
const legacyPaths = new Set(allLegacyPaths);
if (canonicalPaths.size !== projection.length
  || legacyPaths.size !== allLegacyPaths.length
  || [...canonicalPaths].some((route) => legacyPaths.has(route) || fixedRoutes.has(route))
  || [...legacyPaths].some((route) => fixedRoutes.has(route))) {
  throw new Error('Public address projection contains a route namespace collision.');
}

for (const entry of projection) {
  const expectedCanonical = `/posts/${entry.globalSequence}`;
  const expectedLegacy = entry.source === 'tistory'
    ? [`/${entry.sourceId}`]
    : entry.source === 'naver'
      ? [`/naver/${entry.sourceId}`]
      : [];
  if (!['tistory', 'naver', 'native'].includes(entry.source)
    || !validSourceId(entry.source, entry.sourceId)
    || !Number.isSafeInteger(entry.globalSequence)
    || entry.globalSequence < 1
    || entry.canonicalPath !== expectedCanonical
    || !/^\/posts\/[1-9]\d*$/.test(entry.canonicalPath)
    || JSON.stringify(entry.legacyPaths) !== JSON.stringify(expectedLegacy)) {
    throw new Error('Public address projection contains an invalid entry.');
  }
  const sourceIdentity = identity(entry.source, entry.sourceId);
  if (byIdentity.has(sourceIdentity) || byCanonicalPath.has(entry.canonicalPath)) {
    throw new Error('Public address projection contains an identity or canonical collision.');
  }
  byIdentity.set(sourceIdentity, entry);
  byCanonicalPath.set(entry.canonicalPath, entry);
  for (const legacyPath of entry.legacyPaths) {
    if (byLegacyPath.has(legacyPath) || byCanonicalPath.has(legacyPath)) {
      throw new Error('Public address projection contains a legacy path collision.');
    }
    byLegacyPath.set(legacyPath, entry);
  }
}

export function publicAddressEntries(): readonly PublicPostAddress[] {
  return projection;
}

export function publicAddressForIdentity(source: PublicPostSource, sourceId: string) {
  return byIdentity.get(identity(source, sourceId)) ?? null;
}

export function isProjectedPublicIdentity(source: PublicPostSource, sourceId: string) {
  return byIdentity.has(identity(source, sourceId));
}

export function publicAddressForCanonicalPath(canonicalPath: string) {
  return byCanonicalPath.get(canonicalPath.normalize('NFC').replace(/\/$/, '')) ?? null;
}

export function publicAddressForLegacyPath(legacyPath: string) {
  return byLegacyPath.get(legacyPath.normalize('NFC').replace(/\/$/, '')) ?? null;
}

export function publicAddressForPost(post: AddressablePublicPost): PublicPostAddress {
  const address = publicAddressForIdentity(post.data.source, post.data.sourceId);
  if (!address) throw new Error('A public post has no global sequence assignment.');
  if (post.data.source !== 'native' && !address.legacyPaths.includes(post.data.canonicalPath)) {
    throw new Error('A public post legacy canonical differs from its sequence projection.');
  }
  return address;
}

export function publicPostPath(post: AddressablePublicPost) {
  return publicAddressForPost(post).canonicalPath;
}

export function publicPostSequence(post: AddressablePublicPost) {
  return publicAddressForPost(post).globalSequence;
}

export function publicLegacyRedirects() {
  return projection.flatMap((entry) => entry.legacyPaths.map((legacyPath) => ({
    legacyPath,
    canonicalPath: entry.canonicalPath,
  })));
}
