import { canonicalJson, sha256Hex } from './cloudflare-release.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RESPONSE_ROLES = new Set([
  'service-existence',
  'account-workers-dev-subdomain',
  'script-workers-dev-subdomain',
  'script-settings',
  'script-content-v2',
  'deployment-discovery',
  'versions-list',
  'versions-list-page',
  'version-detail',
  'deployments-before',
  'deployments-after',
]);

export const MAX_BOOTSTRAP_RESPONSE_BYTES = 1024 * 1024;
export const MAX_BOOTSTRAP_REQUEST_DURATION_MS = 15_000;

const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

function instant(now, errorCode) {
  let value;
  try { value = now(); }
  catch { fail(errorCode); }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail(errorCode);
  return value;
}

function contentLengthValue(response, errorCode) {
  const raw = response?.headers?.get?.('content-length');
  if (raw === null || raw === undefined) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) fail(errorCode);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail(errorCode);
  return value;
}

async function cancelBody(body, reader = null) {
  try {
    if (reader) await reader.cancel();
    else if (body && typeof body.cancel === 'function') await body.cancel();
  } catch {
    // The caller still fails closed. Cancellation is best-effort after a protocol violation.
  }
}

export async function readBootstrapResponseBody(response, {
  maximumBytes = MAX_BOOTSTRAP_RESPONSE_BYTES,
  errorCode = 'CLOUDFLARE_E_BOOTSTRAP_RESPONSE_BODY',
} = {}) {
  if (!response || typeof response !== 'object'
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > MAX_BOOTSTRAP_RESPONSE_BYTES) fail(errorCode);
  let declaredBytes;
  try { declaredBytes = contentLengthValue(response, errorCode); }
  catch (error) {
    await cancelBody(response.body);
    throw error;
  }
  if (declaredBytes !== null && declaredBytes > maximumBytes) {
    await cancelBody(response.body);
    fail(errorCode);
  }
  if (response.body === null || response.body === undefined) {
    if (declaredBytes !== null && declaredBytes !== 0) fail(errorCode);
    return { bytes: Buffer.alloc(0), declaredBytes };
  }
  if (typeof response.body.getReader !== 'function') {
    await cancelBody(response.body);
    fail(errorCode);
  }
  let reader;
  try { reader = response.body.getReader(); }
  catch {
    await cancelBody(response.body);
    fail(errorCode);
  }
  const chunks = [];
  let observedBytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (!item || typeof item.done !== 'boolean'
        || !item.done && (!(item.value instanceof Uint8Array) || item.value.byteLength === 0)) {
        await cancelBody(response.body, reader);
        fail(errorCode);
      }
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      item.value.fill(0);
      observedBytes += chunk.length;
      if (observedBytes > maximumBytes) {
        chunk.fill(0);
        await cancelBody(response.body, reader);
        fail(errorCode);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    await cancelBody(response.body, reader);
    for (const chunk of chunks) chunk.fill(0);
    if (error?.message === errorCode) throw error;
    fail(errorCode);
  }
  if (declaredBytes !== null && declaredBytes !== observedBytes) {
    for (const chunk of chunks) chunk.fill(0);
    fail(errorCode);
  }
  let bytes;
  try { bytes = Buffer.concat(chunks, observedBytes); }
  finally { for (const chunk of chunks) chunk.fill(0); }
  return { bytes, declaredBytes };
}

export function parseBootstrapJsonBytes(bytes, contentType, errorCode) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BOOTSTRAP_RESPONSE_BYTES
    || typeof contentType !== 'string' || contentType.length === 0 || contentType.length > 512) {
    fail(errorCode);
  }
  const parts = contentType.split(';').map((part) => part.trim());
  if (parts.shift()?.toLowerCase() !== 'application/json') fail(errorCode);
  let charsetSeen = false;
  for (const parameter of parts) {
    const match = /^charset\s*=\s*(?:"([^"]+)"|([^\s;]+))$/iu.exec(parameter);
    const charset = (match?.[1] ?? match?.[2] ?? '').toLowerCase();
    if (!match || charsetSeen || !['utf-8', 'utf8'].includes(charset)) fail(errorCode);
    charsetSeen = true;
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(errorCode); }
  let value;
  try { value = JSON.parse(text); }
  catch { fail(errorCode); }
  return { text, value };
}

export function bootstrapRequestTargetSha256({
  role, environment, workerName, accountIdSha256, versionId = null,
  page = null, perPage = null,
}) {
  if (!RESPONSE_ROLES.has(role) || !['production', 'staging'].includes(environment)
    || typeof workerName !== 'string' || !/^[a-z0-9-]{1,64}$/u.test(workerName)
    || !SHA256.test(accountIdSha256 ?? '')
    || versionId !== null
      && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u
        .test(versionId)
    || ['version-detail', 'deployments-before', 'deployments-after'].includes(role)
      !== (versionId !== null)
    || role === 'versions-list-page' !== (Number.isSafeInteger(page)
      && page >= 1 && page <= 10 && perPage === 50)) {
    fail('CLOUDFLARE_E_BOOTSTRAP_REQUEST_TARGET');
  }
  return sha256Hex(canonicalJson({
    method: 'GET', role, environment, workerName, accountIdSha256, versionId,
    contract: 'dwnc-cloudflare-bootstrap-request-target-v1',
    ...(role === 'versions-list-page' ? { page, perPage } : {}),
  }));
}

function assertBootstrapRequestUrl(url, {
  role, workerName, accountIdSha256, versionId, bodyKind, page, perPage,
}, errorCode) {
  let parsed;
  try { parsed = new URL(url); }
  catch { fail(errorCode); }
  const expectedSearch = role === 'versions-list' ? '?deployable=true'
    : role === 'versions-list-page'
      ? `?deployable=true&page=${page}&per_page=${perPage}` : '';
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.cloudflare.com'
    || parsed.port !== '' || parsed.username !== '' || parsed.password !== ''
    || parsed.search !== expectedSearch || parsed.hash !== '') fail(errorCode);
  const match = /^\/client\/v4\/accounts\/([A-Fa-f0-9]{32})\/workers(\/.*)$/u
    .exec(parsed.pathname);
  if (!match || sha256Hex(`cloudflare-account-id-v1\0${match[1].toLowerCase()}`)
    !== accountIdSha256) fail(errorCode);
  const rolePath = {
    'service-existence': `/services/${workerName}`,
    'account-workers-dev-subdomain': '/subdomain',
    'script-workers-dev-subdomain': `/scripts/${workerName}/subdomain`,
    'script-settings': `/scripts/${workerName}/script-settings`,
    'script-content-v2': `/scripts/${workerName}/content/v2`,
    'deployment-discovery': `/scripts/${workerName}/deployments`,
    'versions-list': `/scripts/${workerName}/versions`,
    'versions-list-page': `/scripts/${workerName}/versions`,
    'version-detail': `/scripts/${workerName}/versions/${versionId}`,
    'deployments-before': `/scripts/${workerName}/deployments`,
    'deployments-after': `/scripts/${workerName}/deployments`,
  }[role];
  if (match[2] !== rolePath
    || bodyKind !== (role === 'script-content-v2' ? 'multipart' : 'json')) fail(errorCode);
}

export async function fetchBootstrapGet({
  url,
  apiToken,
  role,
  environment,
  workerName,
  accountIdSha256,
  versionId = null,
  page = null,
  perPage = null,
  expectedStatuses = [200],
  bodyKind = 'json',
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  errorCode = 'CLOUDFLARE_E_BOOTSTRAP_FETCH',
}) {
  if (typeof url !== 'string' || !url.startsWith('https://api.cloudflare.com/client/v4/')
    || typeof apiToken !== 'string' || apiToken.length < 1 || apiToken.length > 4096
    || !RESPONSE_ROLES.has(role) || !['json', 'multipart'].includes(bodyKind)
    || !Array.isArray(expectedStatuses) || expectedStatuses.length < 1
    || expectedStatuses.some((status) => !Number.isSafeInteger(status) || status < 100 || status > 599)
    || new Set(expectedStatuses).size !== expectedStatuses.length
    || typeof fetchImpl !== 'function' || typeof now !== 'function') fail(errorCode);
  assertBootstrapRequestUrl(url, {
    role, workerName, accountIdSha256, versionId, bodyKind, page, perPage,
  }, errorCode);
  const requestTargetSha256 = bootstrapRequestTargetSha256({
    role, environment, workerName, accountIdSha256, versionId, page, perPage,
  });
  const started = instant(now, errorCode);
  let response;
  let read;
  let contentEncoding = null;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: bodyKind === 'json' ? 'application/json' : 'multipart/form-data',
        'accept-encoding': 'identity',
        authorization: `Bearer ${apiToken}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(MAX_BOOTSTRAP_REQUEST_DURATION_MS),
    });
    const rawContentEncoding = response?.headers?.get?.('content-encoding') ?? null;
    contentEncoding = rawContentEncoding === null ? null : rawContentEncoding.toLowerCase();
    if (contentEncoding !== null && contentEncoding !== 'identity') {
      await cancelBody(response?.body);
      fail(errorCode);
    }
    read = await readBootstrapResponseBody(response, { errorCode });
  } catch (error) {
    if (error?.message === errorCode) throw error;
    fail(errorCode);
  }
  let returned = false;
  try {
    const completed = instant(now, errorCode);
    if (completed.getTime() < started.getTime()
      || completed.getTime() - started.getTime() > MAX_BOOTSTRAP_REQUEST_DURATION_MS) fail(errorCode);
    const contentType = response?.headers?.get?.('content-type') ?? null;
    if (!expectedStatuses.includes(response?.status) || read.bytes.length === 0) fail(errorCode);
    let json = null;
    let text = null;
    if (bodyKind === 'json') {
      ({ text, value: json } = parseBootstrapJsonBytes(read.bytes, contentType, errorCode));
    } else if (typeof contentType !== 'string'
      || !/^multipart\/form-data(?:\s*;|$)/iu.test(contentType)) fail(errorCode);
    const descriptor = {
      role,
      requestTargetSha256,
      httpStatus: response.status,
      contentType,
      contentEncoding,
      declaredBodyBytes: read.declaredBytes,
      decodedBodyBytes: read.bytes.length,
      decodedBodySha256: sha256Hex(read.bytes),
      requestStartedAt: started.toISOString(),
      requestCompletedAt: completed.toISOString(),
    };
    validateBootstrapResponseDescriptor(descriptor, { role });
    const result = {
      descriptor,
      decodedBodyBase64: read.bytes.toString('base64'),
      bytes: read.bytes,
      json,
      text,
      entrypoint: response.headers.get('cf-entrypoint'),
    };
    returned = true;
    return result;
  } finally {
    if (!returned) read?.bytes.fill(0);
  }
}

export function validateBootstrapResponseDescriptor(descriptor, {
  role,
  observationStartedAt,
  observationCompletedAt,
} = {}) {
  const keys = [
    'role', 'requestTargetSha256', 'httpStatus', 'contentType', 'contentEncoding',
    'declaredBodyBytes', 'decodedBodyBytes', 'decodedBodySha256',
    'requestStartedAt', 'requestCompletedAt',
  ];
  if (!exactKeys(descriptor, keys) || !RESPONSE_ROLES.has(descriptor.role)
    || role !== undefined && descriptor.role !== role
    || !SHA256.test(descriptor.requestTargetSha256 ?? '')
    || !Number.isSafeInteger(descriptor.httpStatus)
    || descriptor.httpStatus < 100 || descriptor.httpStatus > 599
    || typeof descriptor.contentType !== 'string' || descriptor.contentType.length > 512
    || descriptor.contentEncoding !== null && descriptor.contentEncoding !== 'identity'
    || descriptor.declaredBodyBytes !== null
      && (!Number.isSafeInteger(descriptor.declaredBodyBytes)
        || descriptor.declaredBodyBytes !== descriptor.decodedBodyBytes)
    || !Number.isSafeInteger(descriptor.decodedBodyBytes) || descriptor.decodedBodyBytes < 1
    || descriptor.decodedBodyBytes > MAX_BOOTSTRAP_RESPONSE_BYTES
    || !SHA256.test(descriptor.decodedBodySha256 ?? '')
    || !ISO_INSTANT.test(descriptor.requestStartedAt ?? '')
    || !ISO_INSTANT.test(descriptor.requestCompletedAt ?? '')) fail('CLOUDFLARE_E_BOOTSTRAP_RESPONSE_DESCRIPTOR');
  const started = Date.parse(descriptor.requestStartedAt);
  const completed = Date.parse(descriptor.requestCompletedAt);
  if (completed < started || completed - started > MAX_BOOTSTRAP_REQUEST_DURATION_MS) {
    fail('CLOUDFLARE_E_BOOTSTRAP_RESPONSE_DESCRIPTOR');
  }
  if (observationStartedAt !== undefined || observationCompletedAt !== undefined) {
    const observationStarted = Date.parse(observationStartedAt ?? '');
    const observationCompleted = Date.parse(observationCompletedAt ?? '');
    if (Number.isNaN(observationStarted) || Number.isNaN(observationCompleted)
      || started < observationStarted || completed > observationCompleted) {
      fail('CLOUDFLARE_E_BOOTSTRAP_RESPONSE_DESCRIPTOR');
    }
  }
  return descriptor;
}
