export interface PublicMediaWorkerEntry {
  publicPath: string;
  key: string;
  size: number;
  sha256: string;
  contentType: string;
  cacheControl: string;
}

export interface PublicRequestSurface {
  schemaVersion: number;
  contract: string;
  pathCount: number;
  surfaceSha256: string;
  allowedPathHashes: readonly string[];
}

export interface EdgeRedirectEntry {
  from: string;
  to: string;
  status: number;
}

export interface EdgeRedirectManifest {
  schemaVersion: number;
  canonicalOrigin: string;
  redirects: readonly EdgeRedirectEntry[];
}

interface MediaCacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function isMediaCacheLike(value: unknown): value is MediaCacheLike {
  return value !== null && typeof value === 'object'
    && 'match' in value && typeof value.match === 'function'
    && 'put' in value && typeof value.put === 'function';
}

export type MediaWorkerEnvironment = Pick<Cloudflare.ProductionEnv, 'MEDIA_BUCKET'> & {
  ASSETS?: Fetcher;
  MEDIA_CACHE?: MediaCacheLike;
  DWNC_DEPLOYMENT_ENVIRONMENT?: 'staging' | 'production';
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
};

export type MediaWorkerExecutionContext = Pick<ExecutionContext, 'waitUntil'>;

type R2ObjectLike = R2Object;
type R2ObjectBodyLike = R2ObjectBody;

interface ByteRange {
  offset: number;
  length: number;
  end: number;
}

const PATH_PATTERN = /^\/media\/[A-Za-z0-9._/-]+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const LEGACY_REDIRECT_PATH_PATTERN = /^\/(?:[1-9]\d*|naver\/[1-9]\d*)$/u;
const CANONICAL_REDIRECT_PATH_PATTERN = /^\/posts\/[1-9]\d*$/u;
const EDGE_REDIRECT_COUNT = 349;
const encoder = new TextEncoder();

function observe(code: string): void {
  console.error(JSON.stringify({ event: 'dwnc_media_error', code }));
}

function canonicalEntryPayload(entry: PublicMediaWorkerEntry): string {
  return JSON.stringify({
    publicPath: entry.publicPath,
    key: entry.key,
    size: entry.size,
    sha256: entry.sha256,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
  });
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function withStagingCacheProbe(response: Response, enabled: boolean): Response {
  if (!enabled) return response;
  const headers = new Headers(response.headers);
  headers.set('x-dwnc-cache-probe', 'HIT');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function normalizeStaticPath(pathname: string): string | null {
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('//')
    || /%(?![0-9A-Fa-f]{2})/u.test(pathname)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname).normalize('NFC'); }
  catch { return null; }
  if (decoded.includes('%') || decoded.includes('\\') || decoded.includes('//')
    || /[\u0000-\u001f\u007f]/u.test(decoded)) return null;
  if (decoded === '/') return decoded;
  const segments = decoded.split('/');
  if (segments.some((segment, index) => index > 0 && (segment === '' || segment === '.' || segment === '..'))) {
    return null;
  }
  return decoded.length > 1 && decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function isSafeRedirectPath(pathname: string): boolean {
  return pathname.startsWith('/') && pathname !== '/'
    && !pathname.endsWith('/') && !pathname.includes('//') && !pathname.includes('\\')
    && !/[?#*%\s\u0000-\u001f\u007f]/u.test(pathname)
    && !pathname.split('/').some((segment, index) => index > 0
      && (segment === '' || segment === '.' || segment === '..'));
}

function validateRedirectManifest(manifest: EdgeRedirectManifest): Map<string, string> {
  if (!exactKeys(manifest, ['schemaVersion', 'canonicalOrigin', 'redirects'])
    || manifest.schemaVersion !== 1
    || manifest.canonicalOrigin !== 'https://dwnc.me'
    || !Array.isArray(manifest.redirects)
    || manifest.redirects.length !== EDGE_REDIRECT_COUNT) {
    throw new Error('MEDIA_E_WORKER_REDIRECTS');
  }
  const index = new Map<string, string>();
  const targets = new Set<string>();
  for (const redirect of manifest.redirects) {
    if (!exactKeys(redirect, ['from', 'to', 'status'])
      || redirect.status !== 308
      || typeof redirect.from !== 'string'
      || typeof redirect.to !== 'string'
      || !LEGACY_REDIRECT_PATH_PATTERN.test(redirect.from)
      || !CANONICAL_REDIRECT_PATH_PATTERN.test(redirect.to)
      || !isSafeRedirectPath(redirect.from)
      || !isSafeRedirectPath(redirect.to)
      || redirect.from === '/media' || redirect.from.startsWith('/media/')
      || redirect.to === '/media' || redirect.to.startsWith('/media/')
      || index.has(redirect.from) || targets.has(redirect.to)) {
      throw new Error('MEDIA_E_WORKER_REDIRECTS');
    }
    index.set(redirect.from, redirect.to);
    targets.add(redirect.to);
  }
  return index;
}

function redirect(target: string): Response {
  return new Response(null, { status: 308, headers: { location: target } });
}

async function entryManifestSha256(entry: PublicMediaWorkerEntry): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(canonicalEntryPayload(entry))));
}

function platformSha256(object: R2ObjectLike): string | null {
  const value = object.checksums?.sha256;
  return value instanceof ArrayBuffer && value.byteLength === 32 ? bytesToHex(value) : null;
}

function unavailable(method = 'GET'): Response {
  return new Response(method === 'HEAD' ? null : 'Not found.\n', {
    status: 404,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

function upstreamFailure(): Response {
  return new Response('Media temporarily unavailable.\n', {
    status: 502,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

function invalidMethod(): Response {
  return new Response('Method not allowed.\n', {
    status: 405,
    headers: {
      allow: 'GET, HEAD',
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

function parseRange(value: string | null, size: number): ByteRange | null | false {
  if (value === null) return null;
  if (!value.startsWith('bytes=') || value.includes(',')) return false;
  const expression = value.slice('bytes='.length);
  const match = expression.match(/^(\d*)-(\d*)$/u);
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    const length = Math.min(suffix, size);
    return { offset: size - length, length, end: size - 1 };
  }
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return false;
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return false;
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1, end };
}

function etagMatches(ifNoneMatch: string | null, httpEtag: string): boolean {
  if (ifNoneMatch === null) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//u, '');
  const expected = normalize(httpEtag);
  return ifNoneMatch.split(',').some((candidate) => candidate.trim() === '*' || normalize(candidate) === expected);
}

function ifRangeAllowsRange(ifRange: string | null, object: R2ObjectLike): boolean {
  if (ifRange === null) return true;
  const value = ifRange.trim();
  if (value.startsWith('W/')) return false;
  if (value.startsWith('"')) return value === object.httpEtag;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  return Math.floor(object.uploaded.getTime() / 1_000) <= Math.floor(timestamp / 1_000);
}

function objectMatches(
  entry: PublicMediaWorkerEntry,
  object: R2ObjectLike,
  manifestEntrySha256: string,
): boolean {
  return object.key === entry.key
    && object.size === entry.size
    && object.httpMetadata?.contentType?.toLowerCase() === entry.contentType
    && object.httpMetadata?.cacheControl === entry.cacheControl
    && object.customMetadata?.sha256 === entry.sha256
    && object.customMetadata?.contract === 'dwnc-public-media-r2-v1'
    && object.customMetadata?.['manifest-entry-sha256'] === manifestEntrySha256
    && platformSha256(object) === entry.sha256
    && typeof object.version === 'string'
    && object.version.length > 0
    && object.version.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(object.version)
    && typeof object.etag === 'string'
    && object.etag.length > 0
    && object.httpEtag === `"${object.etag}"`
    && typeof object.httpEtag === 'string'
    && /^"[^"\r\n]+"$/u.test(object.httpEtag)
    && object.uploaded instanceof Date
    && !Number.isNaN(object.uploaded.getTime());
}

function sameObjectGeneration(left: R2ObjectLike, right: R2ObjectLike): boolean {
  return left.version === right.version
    && left.etag === right.etag
    && left.httpEtag === right.httpEtag
    && platformSha256(left) === platformSha256(right)
    && left.uploaded.getTime() === right.uploaded.getTime();
}

function responseHeaders(entry: PublicMediaWorkerEntry, object: R2ObjectLike): Headers {
  return new Headers({
    'accept-ranges': 'bytes',
    'cache-control': entry.cacheControl,
    'content-type': entry.contentType,
    etag: object.httpEtag,
    'last-modified': object.uploaded.toUTCString(),
    'x-content-type-options': 'nosniff',
  });
}

function cacheForEnvironment(env: MediaWorkerEnvironment): MediaCacheLike | null {
  if (env.MEDIA_CACHE) return env.MEDIA_CACHE;
  const defaultCache: unknown = typeof caches === 'undefined'
    ? undefined : Reflect.get(caches, 'default');
  return isMediaCacheLike(defaultCache) ? defaultCache : null;
}

function cacheKey(url: URL, entry: PublicMediaWorkerEntry): Request {
  const key = new URL(entry.publicPath, url.origin);
  key.searchParams.set('__dwnc_media_sha256', entry.sha256);
  return new Request(key, { method: 'GET' });
}

function cachedResponseMatches(response: Response, entry: PublicMediaWorkerEntry): boolean {
  return response.status === 200
    && response.headers.get('content-length') === String(entry.size)
    && response.headers.get('content-type')?.toLowerCase() === entry.contentType
    && response.headers.get('cache-control') === entry.cacheControl
    && response.headers.get('accept-ranges') === 'bytes'
    && response.headers.get('x-content-type-options') === 'nosniff'
    && /^"[^"\r\n]+"$/u.test(response.headers.get('etag') ?? '')
    && !Number.isNaN(Date.parse(response.headers.get('last-modified') ?? ''));
}

function conditionalCachedResponse(request: Request, cached: Response): Response {
  if (!etagMatches(request.headers.get('if-none-match'), cached.headers.get('etag') ?? '')) return cached;
  const headers = new Headers(cached.headers);
  headers.delete('content-length');
  return new Response(null, { status: 304, headers });
}

function validateEntries(entries: readonly PublicMediaWorkerEntry[]): Map<string, PublicMediaWorkerEntry> {
  const index = new Map<string, PublicMediaWorkerEntry>();
  for (const entry of entries) {
    if (!entry || typeof entry.publicPath !== 'string' || !PATH_PATTERN.test(entry.publicPath)
      || entry.publicPath.includes('//') || entry.publicPath.includes('..') || entry.publicPath.includes('\\')
      || entry.publicPath.includes('%') || entry.key !== entry.publicPath.slice(1)
      || !Number.isSafeInteger(entry.size) || entry.size <= 0
      || !SHA256_PATTERN.test(entry.sha256)
      || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(entry.contentType)
      || entry.cacheControl !== 'public, max-age=31536000, immutable'
      || index.has(entry.publicPath)) throw new Error('MEDIA_E_WORKER_MANIFEST');
    index.set(entry.publicPath, entry);
  }
  return index;
}

export function createMediaWorker(
  entries: readonly PublicMediaWorkerEntry[],
  manifestSha256: string,
  publicSurface: PublicRequestSurface,
  redirectManifest: EdgeRedirectManifest,
) {
  if (!SHA256_PATTERN.test(manifestSha256)) throw new Error('MEDIA_E_WORKER_MANIFEST');
  const index = validateEntries(entries);
  if (!publicSurface || publicSurface.schemaVersion !== 1
    || publicSurface.contract !== 'dwnc-public-request-surface-v1'
    || !Number.isSafeInteger(publicSurface.pathCount) || publicSurface.pathCount <= 0
    || !SHA256_PATTERN.test(publicSurface.surfaceSha256)
    || !Array.isArray(publicSurface.allowedPathHashes)
    || publicSurface.allowedPathHashes.length !== publicSurface.pathCount
    || publicSurface.allowedPathHashes.some((value) => !SHA256_PATTERN.test(value))) {
    throw new Error('MEDIA_E_WORKER_SURFACE');
  }
  const publicPathHashes = new Set(publicSurface.allowedPathHashes);
  if (publicPathHashes.size !== publicSurface.allowedPathHashes.length) {
    throw new Error('MEDIA_E_WORKER_SURFACE');
  }
  const redirects = validateRedirectManifest(redirectManifest);

  return async function handle(
    request: Request,
    env: MediaWorkerEnvironment,
    context?: MediaWorkerExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const staging = env.DWNC_DEPLOYMENT_ENVIRONMENT === 'staging';
    const cacheProbe = staging
      && request.headers.get('x-dwnc-smoke-cache-probe') === '1';
    const response = await (async (): Promise<Response> => {
    if (!url.pathname.startsWith('/media/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return invalidMethod();
      if (!env.ASSETS) return unavailable(request.method);
      const publicPath = normalizeStaticPath(url.pathname);
      if (!publicPath || !publicPathHashes.has(await sha256Text(publicPath))) {
        return unavailable(request.method);
      }
      const redirectTarget = redirects.get(url.pathname);
      if (redirectTarget) return redirect(redirectTarget);
      if (request.method === 'GET') return env.ASSETS.fetch(request);
      const assetResponse = await env.ASSETS.fetch(new Request(request, { method: 'GET' }));
      try { await assetResponse.body?.cancel(); } catch {}
      return new Response(null, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: assetResponse.headers,
      });
    }
    if (url.search || !PATH_PATTERN.test(url.pathname) || url.pathname.includes('//')
      || url.pathname.includes('..') || url.pathname.includes('\\') || url.pathname.includes('%')) {
      return unavailable(request.method);
    }
    const entry = index.get(url.pathname);
    if (!entry) return unavailable(request.method);
    if (!['GET', 'HEAD'].includes(request.method)) return invalidMethod();

    const cache = cacheForEnvironment(env);
    const cacheRequest = cacheKey(url, entry);
    if (cache && request.headers.get('range') === null) {
      let cached: Response | undefined;
      try { cached = await cache.match(cacheRequest); }
      catch { observe('MEDIA_W_CACHE_READ'); cached = undefined; }
      if (cached && cachedResponseMatches(cached, entry)) {
        const response = withStagingCacheProbe(
          conditionalCachedResponse(request, cached), cacheProbe,
        );
        if (request.method === 'HEAD' && response.status !== 304) {
          return new Response(null, { status: 200, headers: response.headers });
        }
        return response;
      }
    }

    const expectedManifestEntrySha256 = await entryManifestSha256(entry);
    let metadata: R2ObjectLike | null;
    try { metadata = await env.MEDIA_BUCKET.head(entry.key); }
    catch { observe('MEDIA_W_R2_HEAD'); return upstreamFailure(); }
    if (!metadata) return unavailable(request.method);
    if (!objectMatches(entry, metadata, expectedManifestEntrySha256)) {
      observe('MEDIA_W_R2_HEAD_INTEGRITY');
      return upstreamFailure();
    }

    const headers = responseHeaders(entry, metadata);
    if (etagMatches(request.headers.get('if-none-match'), metadata.httpEtag)) {
      return new Response(null, { status: 304, headers });
    }

    const range = request.method === 'GET'
      && ifRangeAllowsRange(request.headers.get('if-range'), metadata)
      ? parseRange(request.headers.get('range'), entry.size)
      : null;
    if (range === false) {
      headers.set('content-range', `bytes */${entry.size}`);
      headers.set('content-length', '0');
      return new Response(null, { status: 416, headers });
    }
    const status = range ? 206 : 200;
    const contentLength = range?.length ?? entry.size;
    headers.set('content-length', String(contentLength));
    if (range) headers.set('content-range', `bytes ${range.offset}-${range.end}/${entry.size}`);
    if (request.method === 'HEAD') return new Response(null, { status, headers });

    let object: R2ObjectBodyLike | null;
    try {
      object = await env.MEDIA_BUCKET.get(entry.key, range
        ? { range: { offset: range.offset, length: range.length } }
        : undefined);
    } catch { observe('MEDIA_W_R2_GET'); return upstreamFailure(); }
    if (!object) return unavailable(request.method);
    if (!object.body
      || !objectMatches(entry, object, expectedManifestEntrySha256)
      || !sameObjectGeneration(metadata, object)) {
      observe('MEDIA_W_R2_GET_INTEGRITY');
      return upstreamFailure();
    }
    const response = new Response(object.body, { status, headers });
    if (cache && status === 200 && context) {
      context.waitUntil(cache.put(cacheRequest, response.clone()).catch(() => {
        observe('MEDIA_W_CACHE_WRITE');
      }));
    }
    return response;
    })();
    if (staging) {
      const versionId = env.CF_VERSION_METADATA?.id;
      if (typeof versionId !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(versionId)) {
        observe('MEDIA_W_STAGING_VERSION');
        return upstreamFailure();
      }
      const headers = new Headers(response.headers);
      headers.set('x-dwnc-staging-version', versionId);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  };
}
