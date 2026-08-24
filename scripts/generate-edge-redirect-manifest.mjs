import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const projection = (await import('../src/data/public-sequence-v1.json', { with: { type: 'json' } })).default;
const redirects = projection.flatMap((entry) => entry.legacyPaths.map((legacyPath) => ({
  from: legacyPath,
  to: entry.canonicalPath,
  status: 308,
})));
const manifest = {
  schemaVersion: 1,
  canonicalOrigin: 'https://dwnc.me',
  redirects,
};

await writeFile(
  path.join(ROOT, 'docs/EDGE_REDIRECTS_V1.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o644 },
);
console.log(JSON.stringify({ redirects: redirects.length, status: 308 }, null, 2));
