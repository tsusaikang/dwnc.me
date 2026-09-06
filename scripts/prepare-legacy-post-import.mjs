import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { legacyImportSqlChunks, loadLegacyPublicPosts } from './lib/legacy-post-import.mjs';

const outputArgument = process.argv.find((value) => value.startsWith('--output='));
const output = outputArgument ? path.resolve(outputArgument.slice('--output='.length)) : null;
if (!output || process.argv.length !== 3) throw new Error('LEGACY_IMPORT_E_ARGUMENT');
const posts = await loadLegacyPublicPosts(process.cwd());
const chunks = legacyImportSqlChunks(posts);
await mkdir(output, { recursive: false });
await Promise.all(chunks.map((sql, index) => writeFile(
  path.join(output, `${String(index + 1).padStart(2, '0')}.sql`), sql, { flag: 'wx', mode: 0o600 },
)));
console.log(JSON.stringify({ posts: posts.length, chunks: chunks.length,
  firstSequence: posts[0].globalSequence, lastSequence: posts.at(-1).globalSequence }));
