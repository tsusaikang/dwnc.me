import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EXACT_MANIFEST_KEYS = ['schemaVersion', 'canonicalOrigin', 'redirects'];
const EXACT_REDIRECT_KEYS = ['from', 'to', 'status'];

function fail(code) { throw new Error(code); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

export function validateEdgeRedirectManifest(manifest, projection) {
  if (!exactKeys(manifest, EXACT_MANIFEST_KEYS)
    || manifest.schemaVersion !== 1
    || manifest.canonicalOrigin !== 'https://dwnc.me'
    || !Array.isArray(manifest.redirects)
    || !Array.isArray(projection)) fail('REDIRECT_E_SCHEMA');
  const from = new Set();
  const toPairs = [];
  for (const redirect of manifest.redirects) {
    if (!exactKeys(redirect, EXACT_REDIRECT_KEYS)
      || redirect.status !== 308
      || typeof redirect.from !== 'string'
      || typeof redirect.to !== 'string'
      || !/^\/(?:[1-9]\d*|naver\/[1-9]\d*)$/u.test(redirect.from)
      || !/^\/posts\/[1-9]\d*$/u.test(redirect.to)
      || redirect.from.startsWith('/media/')
      || /[?#*\s\\%]/u.test(redirect.from)
      || /[?#*\s\\%]/u.test(redirect.to)
      || from.has(redirect.from)) fail('REDIRECT_E_ENTRY');
    from.add(redirect.from);
    toPairs.push(redirect);
  }
  const expected = projection.flatMap((entry) => entry.legacyPaths.map((legacyPath) => ({
    from: legacyPath,
    to: entry.canonicalPath,
    status: 308,
  })));
  if (JSON.stringify(toPairs) !== JSON.stringify(expected)) fail('REDIRECT_E_PROJECTION');
  return { redirects: toPairs.length, uniqueFrom: from.size };
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
