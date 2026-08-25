import {
  assertManifestEqual,
  collectProjectedPublicMedia,
  loadTrackedPublicMediaManifest,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
const tracked = await loadTrackedPublicMediaManifest(ROOT);
const { manifest, contentRows } = await collectProjectedPublicMedia(ROOT, { assetMode: 'manifest' });
assertManifestEqual(manifest, tracked);

console.log(JSON.stringify({
  validationScope: 'public-media-source-only',
  publicPosts: contentRows.length,
  localMediaBytesRead: 0,
  objectCount: tracked.objectCount,
  totalBytes: tracked.totalBytes,
  manifestSha256: tracked.manifestSha256,
}, null, 2));
