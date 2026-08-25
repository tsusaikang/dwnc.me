import { rename, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadCloudflareRedirectInputs,
  renderCloudflareRedirects,
} from './lib/cloudflare-redirects.mjs';

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
if ([...args].some((argument) => argument !== '--write')) throw new Error('REDIRECT_E_ARGUMENT');
const { manifest, projection } = await loadCloudflareRedirectInputs(ROOT);
const rendered = renderCloudflareRedirects(manifest, projection);
const target = path.join(ROOT, 'public/_redirects');

if (args.has('--write')) {
  const temporary = `${target}.tmp`;
  await writeFile(temporary, rendered, { encoding: 'utf8', mode: 0o644 });
  await rename(temporary, target);
} else {
  let tracked;
  try { tracked = await readFile(target, 'utf8'); }
  catch { throw new Error('REDIRECT_E_TRACKED_MISSING'); }
  if (tracked !== rendered) throw new Error('REDIRECT_E_TRACKED_DRIFT');
}

console.log(JSON.stringify({
  mode: args.has('--write') ? 'write' : 'check',
  redirects: manifest.redirects.length,
  status: 308,
  mediaRules: 0,
}, null, 2));
