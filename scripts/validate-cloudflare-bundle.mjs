import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  assertManifestEqual,
  collectProjectedPublicMedia,
  loadTrackedPublicMediaManifest,
} from './lib/public-media-manifest.mjs';
import { loadCloudflareRedirectInputs, renderCloudflareRedirects } from './lib/cloudflare-redirects.mjs';
import {
  collectPublicRequestSurface,
  loadTrackedPublicRequestSurface,
} from './lib/cloudflare-surface.mjs';
import { canonicalJson } from './lib/cloudflare-release.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

async function walk(directory, optional = false) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (optional && error?.code === 'ENOENT') return [];
    throw new Error('CLOUDFLARE_E_BUNDLE_READ');
  }
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
    else throw new Error('CLOUDFLARE_E_BUNDLE_TYPE');
  }
  return files;
}

const tracked = await loadTrackedPublicMediaManifest(ROOT);
const trackedSurface = await loadTrackedPublicRequestSurface(ROOT);
const { manifest } = await collectProjectedPublicMedia(ROOT, { assetMode: 'manifest' });
assertManifestEqual(manifest, tracked);
const mediaFiles = await walk(path.join(DIST, 'media'), true);
if (mediaFiles.length > 0) throw new Error('CLOUDFLARE_E_BUNDLED_MEDIA');
if (await readFile(path.join(DIST, '.assetsignore'), 'utf8') !== 'media/\n*.map\n') {
  throw new Error('CLOUDFLARE_E_ASSETSIGNORE');
}
const { manifest: edgeManifest, projection } = await loadCloudflareRedirectInputs(ROOT);
const expectedRedirects = renderCloudflareRedirects(edgeManifest, projection);
if (await readFile(path.join(DIST, '_redirects'), 'utf8') !== expectedRedirects) {
  throw new Error('CLOUDFLARE_E_REDIRECTS');
}
const builtSurface = await collectPublicRequestSurface(DIST);
if (canonicalJson(builtSurface) !== canonicalJson(trackedSurface)) {
  throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE_DRIFT');
}
const forbidden = /migration\/(?:private|raw)|global-sequence-v1|private-metadata|R2_SECRET|ACCESS_KEY_ID/iu;
let leakMatches = 0;
for (const file of await walk(DIST)) {
  if (!/\.(?:css|html|js|json|map|svg|txt|webmanifest|xml)$/iu.test(file)) continue;
  const raw = await readFile(file, 'utf8');
  if (forbidden.test(raw)) leakMatches += 1;
}
if (leakMatches) throw new Error('CLOUDFLARE_E_PRIVATE_LEAK');
console.log(JSON.stringify({
  validationScope: 'cloudflare-source-only-bundle',
  manifestObjects: tracked.objectCount,
  manifestBytes: tracked.totalBytes,
  distMediaFiles: 0,
  redirects: edgeManifest.redirects.length,
  publicRequestPaths: trackedSurface.pathCount,
  publicRequestSurfaceSha256: trackedSurface.surfaceSha256,
  privateLeakMatches: 0,
}, null, 2));
