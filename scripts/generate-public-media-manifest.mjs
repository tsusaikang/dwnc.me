import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertManifestEqual,
  collectProjectedPublicMedia,
  loadTrackedPublicMediaManifest,
  PUBLIC_MEDIA_MANIFEST_PATH,
  validatePublicMediaManifest,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => arg !== '--write')) throw new Error('MEDIA_E_ARGUMENT');

const { manifest } = await collectProjectedPublicMedia(ROOT, { assetMode: 'manifest' });
validatePublicMediaManifest(manifest, { enforceBaseline: false });

if (args.has('--write')) {
  const target = path.join(ROOT, PUBLIC_MEDIA_MANIFEST_PATH);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  await rename(temporary, target);
} else {
  const tracked = await loadTrackedPublicMediaManifest(ROOT);
  assertManifestEqual(manifest, tracked);
}

console.log(JSON.stringify({
  mode: args.has('--write') ? 'write' : 'check',
  objectCount: manifest.objectCount,
  totalBytes: manifest.totalBytes,
  manifestSha256: manifest.manifestSha256,
}, null, 2));
