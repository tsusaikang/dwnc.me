import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EXACT_MANIFEST_KEYS = ['schemaVersion', 'canonicalOrigin', 'redirects'];
const EXACT_REDIRECT_KEYS = ['from', 'to', 'status'];

function fail(code) { throw new Error(code); }
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function safeRelativePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    && !value.endsWith('/') && !value.includes('\\') && !/[?#*%\s\u0000-\u001f\u007f]/u.test(value)
    && !value.split('/').some((segment, index) => index > 0
      && (segment === '' || segment === '.' || segment === '..'));
}

export function validateEdgeRedirectManifest(manifest, projection) {
  if (!exactKeys(manifest, EXACT_MANIFEST_KEYS)
    || manifest.schemaVersion !== 1
    || manifest.canonicalOrigin !== 'https://dwnc.me'
    || !Array.isArray(manifest.redirects)
    || manifest.redirects.length !== 349
    || !Array.isArray(projection)) fail('REDIRECT_E_SCHEMA');
  const from = new Set();
  const to = new Set();
  const toPairs = [];
  for (const redirect of manifest.redirects) {
    if (!exactKeys(redirect, EXACT_REDIRECT_KEYS)
      || redirect.status !== 308
      || typeof redirect.from !== 'string'
      || typeof redirect.to !== 'string'
      || !/^\/(?:[1-9]\d*|naver\/[1-9]\d*)$/u.test(redirect.from)
      || !/^\/posts\/[1-9]\d*$/u.test(redirect.to)
      || !safeRelativePath(redirect.from)
      || !safeRelativePath(redirect.to)
      || redirect.from === '/media'
      || redirect.from.startsWith('/media/')
      || redirect.to === '/media'
      || redirect.to.startsWith('/media/')
      || /[?#*\s\\%]/u.test(redirect.from)
      || /[?#*\s\\%]/u.test(redirect.to)
      || from.has(redirect.from)
      || to.has(redirect.to)) fail('REDIRECT_E_ENTRY');
    from.add(redirect.from);
    to.add(redirect.to);
    toPairs.push(redirect);
  }
  const expected = projection.flatMap((entry) => entry.legacyPaths.map((legacyPath) => ({
    from: legacyPath,
    to: entry.canonicalPath,
    status: 308,
  })));
  if (JSON.stringify(toPairs) !== JSON.stringify(expected)) fail('REDIRECT_E_PROJECTION');
  return { redirects: toPairs.length, uniqueFrom: from.size, uniqueTo: to.size };
}

export function renderCloudflareRedirects(manifest, projection) {
  validateEdgeRedirectManifest(manifest, projection);
  return `${manifest.redirects.map((redirect) => `${redirect.from} ${redirect.to} ${redirect.status}`).join('\n')}\n`;
}

export async function loadCloudflareRedirectInputs(root) {
  let manifest;
  let projection;
  try {
    [manifest, projection] = await Promise.all([
      readFile(path.join(root, 'docs/EDGE_REDIRECTS_V1.json'), 'utf8').then(JSON.parse),
      readFile(path.join(root, 'src/data/public-sequence-v1.json'), 'utf8').then(JSON.parse),
    ]);
  } catch { fail('REDIRECT_E_READ'); }
  validateEdgeRedirectManifest(manifest, projection);
  return { manifest, projection };
}

export function validateStagingSmokeRedirectAuthority({
  manifest,
  projection,
  trackedRedirects,
  sealedRedirects,
  receiptRedirectsSha256,
}) {
  validateEdgeRedirectManifest(manifest, projection);
  if (!Buffer.isBuffer(trackedRedirects) || !Buffer.isBuffer(sealedRedirects)
    || !/^[a-f0-9]{64}$/u.test(receiptRedirectsSha256 ?? '')) {
    fail('REDIRECT_E_SMOKE_AUTHORITY');
  }
  const rendered = Buffer.from(renderCloudflareRedirects(manifest, projection), 'utf8');
  const renderedSha256 = sha256(rendered);
  if (!trackedRedirects.equals(rendered) || !sealedRedirects.equals(rendered)
    || receiptRedirectsSha256 !== renderedSha256) {
    fail('REDIRECT_E_SMOKE_AUTHORITY');
  }
  return Object.freeze({
    redirects: Object.freeze(manifest.redirects.map((redirect) => Object.freeze({
      from: redirect.from,
      to: redirect.to,
      status: redirect.status,
    }))),
    redirectsSha256: renderedSha256,
    redirectCount: manifest.redirects.length,
  });
}

export async function loadStagingSmokeRedirectAuthority(root, artifactDirectory, artifactReceipt) {
  if (typeof root !== 'string' || !path.isAbsolute(root)
    || typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)) {
    fail('REDIRECT_E_SMOKE_AUTHORITY');
  }
  let inputs;
  let trackedRedirects;
  let sealedRedirects;
  try {
    [inputs, trackedRedirects, sealedRedirects] = await Promise.all([
      loadCloudflareRedirectInputs(root),
      readFile(path.join(root, 'public/_redirects')),
      readFile(path.join(artifactDirectory, 'static/_redirects')),
    ]);
  } catch (error) {
    if (error?.message?.startsWith('REDIRECT_E_')) throw error;
    fail('REDIRECT_E_SMOKE_AUTHORITY');
  }
  return validateStagingSmokeRedirectAuthority({
    ...inputs,
    trackedRedirects,
    sealedRedirects,
    receiptRedirectsSha256: artifactReceipt?.redirectsSha256,
  });
}
