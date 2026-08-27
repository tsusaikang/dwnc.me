import { createHash, createHmac } from 'node:crypto';
import { fstatSync, readSync } from 'node:fs';
import { canonicalJson } from './cloudflare-release.mjs';
import { publicMediaEntryManifestSha256 } from './public-media-manifest.mjs';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const SAFE_ACCOUNT = /^[a-f0-9]{32}$/u;
const SAFE_BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/u;
const SAFE_ACCESS_KEY = /^[A-Fa-f0-9]{32}$/u;
const SAFE_SECRET_KEY = /^[A-Fa-f0-9]{64}$/u;
const LEGACY_CREDENTIAL_NAMES = Object.freeze([
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
]);

export class R2S3Error extends Error {
  constructor(code, { status = undefined, retryable = false } = {}) {
    super(code);
    this.name = 'R2S3Error';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const fail = (code, options) => { throw new R2S3Error(code, options); };
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encodeRfc3986 = (value) => encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

function canonicalUri(bucket, key = '') {
  return `/${[bucket, ...key.split('/')].map(encodeRfc3986).join('/')}`;
}

export function validateR2AccountId(accountId) {
  if (!SAFE_ACCOUNT.test(accountId ?? '')) fail('MEDIA_E_R2_ACCOUNT_ID');
  return accountId;
}

export function validateR2AccessKeyId(accessKeyId) {
  if (!SAFE_ACCESS_KEY.test(accessKeyId ?? '')) fail('MEDIA_E_R2_ACCESS_KEY_ID');
  return accessKeyId;
}

export function validateR2SecretAccessKey(secretAccessKey) {
  if (!SAFE_SECRET_KEY.test(secretAccessKey ?? '')) fail('MEDIA_E_R2_SECRET_ACCESS_KEY');
  return secretAccessKey;
}

export function validateR2Credentials(credentials) {
  const keys = ['schemaVersion', 'contract', 'accountId', 'bucket', 'accessKeyId', 'secretAccessKey'];
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)
    || Object.keys(credentials).length !== keys.length
    || Object.keys(credentials).some((key) => !keys.includes(key))
    || credentials.schemaVersion !== 1
    || credentials.contract !== 'dwnc-r2-s3-credentials-v1'
    || !SAFE_BUCKET.test(credentials.bucket ?? '')
    || typeof credentials.accountId !== 'string'
    || typeof credentials.accessKeyId !== 'string'
    || typeof credentials.secretAccessKey !== 'string') fail('MEDIA_E_R2_CREDENTIALS');
  validateR2AccountId(credentials.accountId);
  validateR2AccessKeyId(credentials.accessKeyId);
  validateR2SecretAccessKey(credentials.secretAccessKey);
  return credentials;
}

export function r2CredentialsFromEnvironment(environment = process.env) {
  const fdDefined = Object.hasOwn(environment, 'R2_CREDENTIALS_FD');
  const legacyDefined = LEGACY_CREDENTIAL_NAMES.some((name) => Object.hasOwn(environment, name));
  if (legacyDefined) fail('MEDIA_E_R2_CREDENTIALS_ENV_FORBIDDEN');
  if (fdDefined) {
    if (environment.R2_CREDENTIALS_FD !== '3') fail('MEDIA_E_R2_CREDENTIALS_FD');
    let stats;
    let bytes;
    try {
      stats = fstatSync(3);
      if (!(stats.isFIFO() || stats.isSocket()) || stats.nlink !== 0
        || ![0o600, 0o666].includes(stats.mode & 0o777)
        || typeof process.getuid === 'function' && stats.uid !== process.getuid()
        || stats.size < 0 || stats.size > 4096) fail('MEDIA_E_R2_CREDENTIALS_FD');
      bytes = Buffer.alloc(4097);
      let total = 0;
      while (true) {
        const read = readSync(3, bytes, total, bytes.length - total, null);
        if (read === 0) break;
        total += read;
        if (total > 4096) fail('MEDIA_E_R2_CREDENTIALS_FD');
      }
      bytes = bytes.subarray(0, total);
    } catch (error) {
      if (error instanceof R2S3Error) throw error;
      fail('MEDIA_E_R2_CREDENTIALS_FD');
    }
    try {
      const raw = bytes.toString('utf8');
      let credentials;
      try { credentials = JSON.parse(raw); }
      catch { fail('MEDIA_E_R2_CREDENTIALS'); }
      validateR2Credentials(credentials);
      if (canonicalJson(credentials) !== raw) fail('MEDIA_E_R2_CREDENTIALS_CANONICAL');
      return credentials;
    } finally {
      bytes.fill(0);
    }
  }
  fail('MEDIA_E_R2_CREDENTIALS_FD_REQUIRED');
}

function canonicalQuery(parameters) {
  return [...parameters]
    .map(([key, value]) => [encodeRfc3986(String(key)), encodeRfc3986(String(value))])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey, 'en')
      || leftValue.localeCompare(rightValue, 'en'))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/gu, ' ');
}

function amzDates(now) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function signR2S3Request({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucket,
  method,
  key = '',
  query = [],
  headers = {},
  payloadSha256 = sha256Hex(''),
  now = new Date(),
}) {
  validateR2AccountId(accountId);
  validateR2AccessKeyId(accessKeyId);
  validateR2SecretAccessKey(secretAccessKey);
  if (!SAFE_BUCKET.test(bucket ?? '') || !['GET', 'HEAD', 'PUT'].includes(method)
    || typeof key !== 'string' || key.startsWith('/') || key.includes('..') || key.includes('\\')
    || !/^[a-f0-9]{64}$/u.test(payloadSha256)) fail('MEDIA_E_R2_CONFIG');
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const host = new URL(endpoint).host;
  const uri = canonicalUri(bucket, key);
  const queryString = canonicalQuery(query);
  const { amzDate, dateStamp } = amzDates(now);
  const requestHeaders = new Map([
    ['host', host],
    ['x-amz-content-sha256', payloadSha256],
    ['x-amz-date', amzDate],
  ]);
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (['authorization', 'host'].includes(normalizedName)) fail('MEDIA_E_R2_HEADER');
    requestHeaders.set(normalizedName, normalizeHeaderValue(value));
  }
  const orderedHeaders = [...requestHeaders.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'));
  const canonicalHeaders = `${orderedHeaders.map(([name, value]) => `${name}:${value}`).join('\n')}\n`;
  const signedHeaders = orderedHeaders.map(([name]) => name).join(';');
  const canonicalRequest = [
    method, uri, queryString, canonicalHeaders, signedHeaders, payloadSha256,
  ].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`), dateStamp);
  const regionKey = hmac(dateKey, 'auto');
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const fetchHeaders = new Headers();
  for (const [name, value] of requestHeaders) {
    if (name !== 'host') fetchHeaders.set(name, value);
  }
  fetchHeaders.set('authorization', authorization);
  return {
    url: `${endpoint}${uri}${queryString ? `?${queryString}` : ''}`,
    headers: fetchHeaders,
    canonicalRequest,
    signedHeaders,
  };
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function firstXml(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'u'));
  return match ? decodeXml(match[1]) : null;
}

export function parseR2ListObjectsV2(xml) {
  if (typeof xml !== 'string' || !/<ListBucketResult(?:\s|>)/u.test(xml)) fail('MEDIA_E_R2_LIST_XML');
  const objects = [];
  for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)) {
    const encodedKey = firstXml(match[1], 'Key');
    const rawSize = firstXml(match[1], 'Size');
    const etag = firstXml(match[1], 'ETag');
    let key;
    try { key = decodeURIComponent(encodedKey ?? ''); }
    catch { fail('MEDIA_E_R2_LIST_XML'); }
    const size = Number(rawSize);
    if (!key || !Number.isSafeInteger(size) || size < 0 || typeof etag !== 'string') fail('MEDIA_E_R2_LIST_XML');
    objects.push({ key, size, etag });
  }
  const truncated = firstXml(xml, 'IsTruncated') === 'true';
  const nextContinuationToken = firstXml(xml, 'NextContinuationToken');
  if (truncated && !nextContinuationToken) fail('MEDIA_E_R2_LIST_XML');
  return { objects, truncated, nextContinuationToken };
}

function safeHeader(headers, name) {
  const value = headers.get(name);
  return value === null ? null : value;
}

function validR2VersionId(value) {
  return value === null || (typeof value === 'string'
    && value.length >= 1 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(value));
}

function normalizedLastModified(value) {
  if (typeof value !== 'string') return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function parseR2Head(response, key) {
  const rawSize = safeHeader(response.headers, 'content-length');
  const size = /^(?:0|[1-9][0-9]*)$/u.test(rawSize ?? '') ? Number(rawSize) : Number.NaN;
  const contentType = safeHeader(response.headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? null;
  const cacheControl = safeHeader(response.headers, 'cache-control');
  const sha256 = safeHeader(response.headers, 'x-amz-meta-sha256');
  const contract = safeHeader(response.headers, 'x-amz-meta-contract');
  const manifestEntrySha256 = safeHeader(response.headers, 'x-amz-meta-manifest-entry-sha256');
  const httpEtag = safeHeader(response.headers, 'etag');
  const version = safeHeader(response.headers, 'x-amz-version-id');
  const lastModified = normalizedLastModified(safeHeader(response.headers, 'last-modified'));
  const checksumHeader = safeHeader(response.headers, 'x-amz-checksum-sha256');
  let platformChecksumSha256 = null;
  if (typeof checksumHeader === 'string' && /^[A-Za-z0-9+/]{43}=$/u.test(checksumHeader)) {
    const decoded = Buffer.from(checksumHeader, 'base64');
    if (decoded.length === 32 && decoded.toString('base64') === checksumHeader) {
      platformChecksumSha256 = decoded.toString('hex');
    }
  }
  if (!Number.isSafeInteger(size) || size < 0 || !contentType
    || !/^"[^"\r\n]+"$/u.test(httpEtag ?? '')
    || !validR2VersionId(version) || lastModified === null) fail('MEDIA_E_R2_HEAD');
  return {
    key, size, contentType, cacheControl, sha256, contract, manifestEntrySha256,
    platformChecksumSha256, version, httpEtag, lastModified,
  };
}

export function remoteObjectMatches(entry, remote) {
  return Boolean(remote)
    && remote.key === entry.key
    && remote.size === entry.size
    && remote.contentType === entry.contentType
    && remote.cacheControl === entry.cacheControl
    && remote.sha256 === entry.sha256
    && remote.contract === 'dwnc-public-media-r2-v1'
    && remote.manifestEntrySha256 === publicMediaEntryManifestSha256(entry)
    && remote.platformChecksumSha256 === entry.sha256
    && validR2VersionId(remote.version)
    && /^"[^"\r\n]+"$/u.test(remote.httpEtag ?? '')
    && normalizedLastModified(remote.lastModified) === remote.lastModified;
}

export function remoteObjectGenerationMatches(left, right) {
  if (!left || !right || !validR2VersionId(left.version) || !validR2VersionId(right.version)) {
    return false;
  }
  return left.key === right.key
    && left.size === right.size
    && left.contentType === right.contentType
    && left.cacheControl === right.cacheControl
    && left.sha256 === right.sha256
    && left.contract === right.contract
    && left.manifestEntrySha256 === right.manifestEntrySha256
    && left.platformChecksumSha256 === right.platformChecksumSha256
    && left.httpEtag === right.httpEtag
    && left.lastModified === right.lastModified
    && left.version === right.version;
}

export class R2S3Client {
  constructor({
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    maxAttempts = 5,
    timeoutMilliseconds = 30_000,
  }) {
    if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof delay !== 'function'
      || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8
      || !Number.isSafeInteger(timeoutMilliseconds)
      || timeoutMilliseconds < 1 || timeoutMilliseconds > 120_000) fail('MEDIA_E_R2_CONFIG');
    this.config = { accountId, bucket, accessKeyId, secretAccessKey };
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.delay = delay;
    this.maxAttempts = maxAttempts;
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.requestCounts = new Map();
    this.operationCounts = new Map();
    this.conditionalIfNoneMatchPutRequests = 0;
    signR2S3Request({ ...this.config, method: 'HEAD', now: this.now() });
  }

  requestMethodCounts() {
    return Object.freeze({
      HEAD: this.requestCounts.get('HEAD') ?? 0,
      GET: this.requestCounts.get('GET') ?? 0,
      PUT: this.requestCounts.get('PUT') ?? 0,
      DELETE: this.requestCounts.get('DELETE') ?? 0,
    });
  }

  requestOperationCounts() {
    return Object.freeze({
      LIST: this.operationCounts.get('LIST') ?? 0,
      HEAD: this.operationCounts.get('HEAD') ?? 0,
      GET: this.operationCounts.get('GET') ?? 0,
      PUT: this.operationCounts.get('PUT') ?? 0,
      DELETE: this.operationCounts.get('DELETE') ?? 0,
    });
  }

  conditionalIfNoneMatchPutRequestCount() {
    return this.conditionalIfNoneMatchPutRequests;
  }

  async request({ method, key = '', query = [], headers = {}, body = undefined, payloadSha256 = sha256Hex('') }) {
    let lastError;
    const operation = method === 'GET' && key === ''
      && query.some(([name, value]) => name === 'list-type' && value === '2') ? 'LIST' : method;
    const conditionalCreatePut = method === 'PUT'
      && Object.entries(headers).some(([name, value]) => name.toLowerCase() === 'if-none-match'
        && value === '*');
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const signed = signR2S3Request({
        ...this.config, method, key, query, headers, payloadSha256, now: this.now(),
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('MEDIA_E_R2_TIMEOUT'), this.timeoutMilliseconds);
      try {
        this.requestCounts.set(method, (this.requestCounts.get(method) ?? 0) + 1);
        this.operationCounts.set(operation, (this.operationCounts.get(operation) ?? 0) + 1);
        if (conditionalCreatePut) this.conditionalIfNoneMatchPutRequests += 1;
        const response = await this.fetchImpl(signed.url, {
          method,
          headers: signed.headers,
          body,
          redirect: 'error',
          signal: controller.signal,
        });
        if (!RETRYABLE_STATUS.has(response.status) || attempt === this.maxAttempts) return response;
        await response.arrayBuffer().catch(() => undefined);
        lastError = new R2S3Error('MEDIA_E_R2_RETRY', { status: response.status, retryable: true });
      } catch (error) {
        lastError = controller.signal.aborted
          ? new R2S3Error('MEDIA_E_R2_TIMEOUT', { retryable: true })
          : error instanceof R2S3Error
          ? error
          : new R2S3Error('MEDIA_E_R2_NETWORK', { retryable: true });
        if (attempt === this.maxAttempts) throw lastError;
      } finally {
        clearTimeout(timeout);
      }
      await this.delay(Math.min(2_000, 100 * (2 ** (attempt - 1))) + ((attempt * 37) % 83));
    }
    throw lastError ?? new R2S3Error('MEDIA_E_R2_NETWORK');
  }

  async listAll(prefix = 'media/') {
    const objects = [];
    const seen = new Set();
    let continuationToken;
    do {
      const query = [
        ['encoding-type', 'url'], ['list-type', '2'], ['max-keys', '1000'], ['prefix', prefix],
      ];
      if (continuationToken) query.push(['continuation-token', continuationToken]);
      const response = await this.request({ method: 'GET', query });
      if (response.status !== 200) fail('MEDIA_E_R2_LIST', { status: response.status });
      const page = parseR2ListObjectsV2(await response.text());
      for (const object of page.objects) {
        if (seen.has(object.key)) fail('MEDIA_E_R2_LIST_DUPLICATE');
        seen.add(object.key);
        objects.push(object);
      }
      continuationToken = page.truncated ? page.nextContinuationToken : undefined;
    } while (continuationToken);
    return objects.sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
  }

  async head(key) {
    const response = await this.request({
      method: 'HEAD', key, headers: { 'x-amz-checksum-mode': 'ENABLED' },
    });
    if (response.status === 404) return null;
    if (response.status !== 200) fail('MEDIA_E_R2_HEAD', { status: response.status });
    return parseR2Head(response, key);
  }

  async getFull(key) {
    const response = await this.request({
      method: 'GET', key, headers: { 'x-amz-checksum-mode': 'ENABLED' },
    });
    if (response.status === 404) return null;
    if (response.status !== 200) fail('MEDIA_E_R2_GET', { status: response.status });
    if (response.headers.get('content-range') !== null) fail('MEDIA_E_R2_GET_PARTIAL');
    const metadata = parseR2Head(response, key);
    const digest = createHash('sha256');
    let bodyBytes = 0;
    const reader = response.body?.getReader();
    if (!reader) fail('MEDIA_E_R2_GET_BODY');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || value.byteLength === 0) {
          fail('MEDIA_E_R2_GET_BODY');
        }
        bodyBytes += value.byteLength;
        if (!Number.isSafeInteger(bodyBytes) || bodyBytes > metadata.size) {
          await reader.cancel().catch(() => undefined);
          fail('MEDIA_E_R2_GET_BODY');
        }
        digest.update(value);
      }
    } catch (error) {
      if (error instanceof R2S3Error) throw error;
      fail('MEDIA_E_R2_GET_BODY');
    } finally {
      reader.releaseLock();
    }
    if (bodyBytes !== metadata.size) fail('MEDIA_E_R2_GET_BODY');
    return {
      ...metadata,
      bodyBytes,
      bodySha256: digest.digest('hex'),
    };
  }

  async putCreateOnly(entry, bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
      fail('MEDIA_E_UPLOAD_LOCAL_HASH');
    }
    const checksum = Buffer.from(entry.sha256, 'hex').toString('base64');
    const headers = {
      'cache-control': entry.cacheControl,
      'content-length': String(bytes.length),
      'content-type': entry.contentType,
      'if-none-match': '*',
      'x-amz-checksum-sha256': checksum,
      'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
      'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(entry),
      'x-amz-meta-sha256': entry.sha256,
    };
    const response = await this.request({
      method: 'PUT', key: entry.key, headers, body: bytes, payloadSha256: entry.sha256,
    });
    if (response.status === 412) return { created: false, preconditionFailed: true };
    if (![200, 201].includes(response.status)) fail('MEDIA_E_R2_PUT', { status: response.status });
    return { created: true, preconditionFailed: false };
  }
}

export function r2ClientFromEnvironment(environment = process.env, options = {}) {
  const credentials = r2CredentialsFromEnvironment(environment);
  return r2ClientFromCredentials(credentials, options);
}

export function r2ClientFromCredentials(credentials, options = {}) {
  validateR2Credentials(credentials);
  return new R2S3Client({
    accountId: credentials.accountId,
    bucket: credentials.bucket,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...options,
  });
}

export function r2ClientContextFromEnvironment(environment = process.env, options = {}) {
  const credentials = r2CredentialsFromEnvironment(environment);
  return {
    credentials,
    client: r2ClientFromCredentials(credentials, options),
  };
}
