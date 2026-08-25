import path from 'node:path';
import { directoryArtifactSha256 } from './lib/cloudflare-release.mjs';
import { installStructuredErrorHandler, runChecked, sanitizedEnvironment } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-deterministic-build');
const environment = sanitizedEnvironment(process.env, { DWNC_MEDIA_MODE: 'remote' });
const hashes = [];
for (let run = 0; run < 2; run += 1) {
  await runChecked(process.execPath, ['scripts/build-cloudflare-source.mjs'], {
    cwd: ROOT,
    env: environment,
  });
  hashes.push(await directoryArtifactSha256(path.join(ROOT, 'dist')));
}
if (hashes[0].sha256 !== hashes[1].sha256 || hashes[0].files !== hashes[1].files) {
  throw new Error('CLOUDFLARE_E_STATIC_NONDETERMINISTIC');
}
console.log(JSON.stringify({
  contract: 'dwnc-cloudflare-static-determinism-v1',
  runs: 2,
  files: hashes[0].files,
  staticTreeSha256: hashes[0].sha256,
  status: 'PASS',
}, null, 2));
