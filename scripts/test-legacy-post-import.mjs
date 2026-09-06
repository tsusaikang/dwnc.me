import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { legacyImportSqlChunks, loadLegacyPublicPosts } from './lib/legacy-post-import.mjs';

const posts = await loadLegacyPublicPosts(process.cwd());
assert.equal(posts.length, 349);
assert.equal(posts.filter((post) => post.source === 'tistory').length, 164);
assert.equal(posts.filter((post) => post.source === 'naver').length, 185);
assert.equal(posts[0].globalSequence, 1);
assert.equal(posts.at(-1).globalSequence, 596);
assert.equal(posts.every((post) => post.bodyHtml && post.legacyPath
  && post.categoryId && post.categorySlug && post.categoryLabel), true);
assert.equal(posts.some((post) => post.bodyHtml.includes('/media/tistory/')), true);
assert.equal(posts.some((post) => post.bodyHtml.includes('/media/naver/')), true);

const chunks = legacyImportSqlChunks(posts);
assert.equal(chunks.length, 18);
const database = new DatabaseSync(':memory:');
database.exec(await readFile(new URL('../migrations/0002_legacy_editor.sql', import.meta.url), 'utf8'));
for (const sql of chunks) database.exec(sql);
assert.deepEqual({ ...database.prepare(`SELECT COUNT(*) AS count, MIN(global_sequence) AS minimum,
  MAX(global_sequence) AS maximum FROM legacy_posts`).get() }, { count: 349, minimum: 1, maximum: 596 });
assert.deepEqual(database.prepare('SELECT source, COUNT(*) AS count FROM legacy_posts GROUP BY source ORDER BY source').all().map((row) => ({ ...row })), [
  { source: 'naver', count: 185 }, { source: 'tistory', count: 164 },
]);
for (const sql of chunks) database.exec(sql);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM legacy_posts').get().count, 349);

console.log(JSON.stringify({ suite: 'legacy-post-import', posts: 349, chunks: chunks.length, status: 'PASS' }));
