import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const byteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

function requestPathForFile(relative) {
  const normalized = relative.split(path.sep).join('/').normalize('NFC');
  if (normalized === '.assetsignore' || normalized === '_redirects' || normalized.startsWith('media/')
    || normalized.endsWith('.map')) return null;
  if (normalized === 'index.html') return '/';
  if (normalized.endsWith('/index.html')) return `/${normalized.slice(0, -'/index.html'.length)}`;
  return `/${normalized}`;
}

async function walk(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE_TYPE');
    if (entry.isDirectory()) files.push(...await walk(root, absolute));
    else if (entry.isFile() && stats.nlink === 1) files.push(path.relative(root, absolute));
    else throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE_TYPE');
  }
  return files;
}

export function publicRequestSurfaceFromRelativeFiles(relativeFiles) {
  if (!Array.isArray(relativeFiles) || relativeFiles.some((value) => typeof value !== 'string')) {
    throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE');
  }
  const paths = [...new Set(relativeFiles.map(requestPathForFile).filter(Boolean))].sort(byteCompare);
  if (!paths.length || paths.some((value) => !value.startsWith('/') || value.includes('\\')
    || value.includes('\0') || value !== value.normalize('NFC'))) {
    throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE');
  }
  const allowedPathHashes = paths.map((value) => sha256Hex(value)).sort(byteCompare);
  return {
    schemaVersion: 1,
    contract: 'dwnc-public-request-surface-v1',
    pathCount: paths.length,
    surfaceSha256: sha256Hex(paths.join('\n')),
    allowedPathHashes,
  };
}

export async function collectPublicRequestSurface(directory) {
  return publicRequestSurfaceFromRelativeFiles(await walk(directory));
}

export function validatePublicRequestSurface(surface) {
  if (!surface || typeof surface !== 'object' || Array.isArray(surface)
    || Object.keys(surface).sort().join(',') !== 'allowedPathHashes,contract,pathCount,schemaVersion,surfaceSha256'
    || surface.schemaVersion !== 1 || surface.contract !== 'dwnc-public-request-surface-v1'
    || !Number.isSafeInteger(surface.pathCount) || surface.pathCount <= 0
    || !/^[a-f0-9]{64}$/u.test(surface.surfaceSha256 ?? '')
    || !Array.isArray(surface.allowedPathHashes)
    || surface.allowedPathHashes.length !== surface.pathCount
    || surface.allowedPathHashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))
    || surface.allowedPathHashes.some((value, index) => index > 0
      && byteCompare(surface.allowedPathHashes[index - 1], value) >= 0)) {
    throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE');
  }
  return surface;
}

export async function loadTrackedPublicRequestSurface(root) {
  let value;
  try { value = JSON.parse(await readFile(path.join(root, 'src/data/public-request-surface-v1.json'), 'utf8')); }
  catch { throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE_TRACKED'); }
  return validatePublicRequestSurface(value);
}
