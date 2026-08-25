import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  collectPublicRequestSurface,
  loadTrackedPublicRequestSurface,
} from './lib/cloudflare-surface.mjs';
import { canonicalJson } from './lib/cloudflare-release.mjs';

const ROOT = process.cwd();
const output = path.join(ROOT, 'src/data/public-request-surface-v1.json');
const expected = await collectPublicRequestSurface(path.join(ROOT, 'dist'));
if (process.argv.includes('--write')) {
  const temporary = `${output}.tmp`;
  await writeFile(temporary, `${canonicalJson(expected)}\n`, { mode: 0o644, flag: 'w' });
  await rename(temporary, output);
} else {
  const tracked = await loadTrackedPublicRequestSurface(ROOT);
  if (canonicalJson(tracked) !== canonicalJson(expected)) {
    throw new Error('CLOUDFLARE_E_PUBLIC_SURFACE_DRIFT');
  }
}
console.log(JSON.stringify({
  contract: expected.contract,
  paths: expected.pathCount,
  surfaceSha256: expected.surfaceSha256,
  write: process.argv.includes('--write'),
  status: 'PASS',
}, null, 2));
