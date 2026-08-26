import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  assertManifestEqual,
  collectProjectedPublicMedia,
  loadTrackedPublicMediaManifest,
  validatePublicMediaPath,
} from './lib/public-media-manifest.mjs';
import { validateProjectedDistAssets } from './lib/public-dist-assets.mjs';
import { loadTrackedPublicMapLinkPolicy } from './lib/public-map-link-policy.mjs';
import {
  loadTrackedPublicMediaCurationPolicy,
  publicMediaCurationExcludedAssets,
} from './lib/public-media-curation.mjs';

const ROOT = process.cwd();

async function walk(directory, publicRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) throw new Error('MEDIA_E_LOCAL_SYMLINK');
    if (entry.isDirectory() && stats.isDirectory()) files.push(...await walk(absolute, publicRoot));
    else if (entry.isFile() && stats.isFile() && stats.nlink === 1) {
      const publicPath = `/${path.relative(publicRoot, absolute).split(path.sep).join('/')}`;
      validatePublicMediaPath(publicPath, publicPath.slice(1));
      files.push(publicPath);
    } else throw new Error('MEDIA_E_LOCAL_TYPE');
  }
  return files;
}

const tracked = await loadTrackedPublicMediaManifest(ROOT);
const { manifest, contentRows } = await collectProjectedPublicMedia(ROOT, { assetMode: 'local' });
assertManifestEqual(manifest, tracked);
const distEvidence = await validateProjectedDistAssets(path.join(ROOT, 'public'), contentRows);
const mapPolicy = await loadTrackedPublicMapLinkPolicy(ROOT);
const curationPolicy = await loadTrackedPublicMediaCurationPolicy(ROOT);
const preservedExcludedPaths = new Set([
  ...mapPolicy.excludedAssets,
  ...publicMediaCurationExcludedAssets(curationPolicy),
]);
const actualPaths = (await walk(path.join(ROOT, 'public/media'), path.join(ROOT, 'public')))
  .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
const manifestPaths = new Set(tracked.entries.map((entry) => entry.publicPath));
if ([...preservedExcludedPaths].some((publicPath) => manifestPaths.has(publicPath))) {
  throw new Error('MEDIA_E_LOCAL_EXCLUSION_OVERLAP');
}
const expectedPaths = [...manifestPaths, ...preservedExcludedPaths]
  .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)
  || distEvidence.total !== tracked.objectCount) throw new Error('MEDIA_E_LOCAL_EXACT_SET');

console.log(JSON.stringify({
  validationScope: 'public-media-local-full',
  publicPosts: contentRows.length,
  objectCount: tracked.objectCount,
  totalBytes: tracked.totalBytes,
  manifestSha256: tracked.manifestSha256,
  preservedExcluded: preservedExcludedPaths.size,
  missing: 0,
  orphan: 0,
  sha256Mismatch: 0,
}, null, 2));
