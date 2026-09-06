import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { parse } from 'yaml';
import { sanitizeLegacyHtml } from '../../src/lib/native-content.ts';
import { taxonomyNodeById } from '../../src/lib/taxonomy.ts';

const PUBLIC_COUNT = 349;
const MAX_SEQUENCE = 596;

function fail() { throw new Error('LEGACY_IMPORT_E_INPUT'); }
function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}
function splitMarkdown(raw) {
  if (!raw.startsWith('---\n')) fail();
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) fail();
  return { data: parse(raw.slice(4, end)), body: raw.slice(end + 5) };
}
function iso(value) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) fail();
  return date.toISOString();
}
function mediaPaths(html) {
  return [...html.matchAll(/(?:src|poster)=(?:"([^"]+)"|'([^']+)')/giu)]
    .map((match) => match[1] ?? match[2]).filter((value) => value.startsWith('/media/')).sort();
}

export async function loadLegacyPublicPosts(root) {
  const sequence = JSON.parse(await readFile(path.join(root, 'src/data/public-sequence-v1.json'), 'utf8'));
  const search = JSON.parse(await readFile(path.join(root, 'dist/search-index.json'), 'utf8'));
  if (!Array.isArray(sequence) || sequence.length !== PUBLIC_COUNT || !Array.isArray(search)
    || search.length !== PUBLIC_COUNT) fail();
  const searchByPath = new Map(search.map((post) => [post.path, post]));
  const posts = [];
  for (const identity of sequence) {
    const number = identity.globalSequence;
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_SEQUENCE
      || !['tistory', 'naver'].includes(identity.source)
      || !Array.isArray(identity.legacyPaths) || identity.legacyPaths.length !== 1
      || identity.canonicalPath !== `/posts/${number}`) fail();
    const sourcePath = path.join(root, 'src/data/posts', identity.source, `${identity.sourceId}.md`);
    const { data } = splitMarkdown(await readFile(sourcePath, 'utf8'));
    const discovery = searchByPath.get(identity.canonicalPath);
    const page = load(await readFile(path.join(root, 'dist/posts', String(number), 'index.html'), 'utf8'));
    const originalHtml = page('.prose').first().html();
    if (!discovery || originalHtml === null || data.source !== identity.source
      || String(data.sourceId) !== String(identity.sourceId) || data.visibility !== 'public'
      || data.canonicalPath !== identity.legacyPaths[0]
      || (data.categoryId !== undefined && discovery.categoryId !== data.categoryId)) fail();
    const category = taxonomyNodeById(discovery.categoryId);
    const bodyHtml = sanitizeLegacyHtml(originalHtml);
    if (!category || !bodyHtml.trim()
      || JSON.stringify(mediaPaths(originalHtml)) !== JSON.stringify(mediaPaths(bodyHtml))) fail();
    const bodyText = load(bodyHtml).root().text().replace(/[\u200B-\u200D\uFEFF]/gu, '')
      .replace(/\s+/gu, ' ').normalize('NFC').trim();
    const publishedAt = iso(data.publishedAt);
    const updatedAt = data.updatedAt ? iso(data.updatedAt) : publishedAt;
    posts.push({
      id: `legacy-${number}`,
      globalSequence: number,
      source: identity.source,
      sourceId: String(identity.sourceId),
      sourceUrl: data.sourceUrl ? String(data.sourceUrl) : null,
      legacyPath: identity.legacyPaths[0],
      title: String(data.title).normalize('NFC').trim(),
      description: String(data.description ?? '').replace(/\s+/gu, ' ').normalize('NFC').trim(),
      bodyHtml,
      bodyText,
      categoryId: category.id,
      categorySlug: category.slug,
      categoryLabel: category.label,
      tags: data.tags ?? [],
      legacyCategories: data.categories ?? [],
      coverPath: data.cover ? String(data.cover) : null,
      coverAlt: String(data.coverAlt ?? ''),
      publishedAt,
      updatedAt,
      sourceUpdatedAt: data.updatedAt ? updatedAt : null,
    });
  }
  if (new Set(posts.map((post) => post.globalSequence)).size !== PUBLIC_COUNT
    || new Set(posts.map((post) => `${post.source}:${post.sourceId}`)).size !== PUBLIC_COUNT) fail();
  return posts.sort((left, right) => left.globalSequence - right.globalSequence);
}

export function legacyImportSqlChunks(posts, size = 20) {
  if (!Array.isArray(posts) || posts.length !== PUBLIC_COUNT || !Number.isSafeInteger(size) || size < 1) fail();
  const literalChunks = (value, maximumBytes = 48 * 1024) => {
    const chunks = []; let chunk = ''; let bytes = 0;
    for (const character of value) {
      const escaped = character === "'" ? "''" : character;
      const next = Buffer.byteLength(escaped);
      if (chunk && bytes + next > maximumBytes) { chunks.push(chunk); chunk = ''; bytes = 0; }
      chunk += escaped; bytes += next;
    }
    if (chunk || !chunks.length) chunks.push(chunk);
    return chunks;
  };
  const statementsFor = (post) => {
    const insert = `INSERT OR IGNORE INTO legacy_posts (
  id, global_sequence, status, source, source_id, source_url, legacy_path, title, description,
  body_html, body_text, category_id, category_slug, category_label, tags_json,
  legacy_categories_json, cover_path, cover_alt, cover_media_id, revision,
  created_at, updated_at, published_at, source_updated_at, import_complete
) VALUES (${[
  post.id, post.globalSequence, 'published', post.source, post.sourceId, post.sourceUrl,
  post.legacyPath, post.title, post.description, '', '', post.categoryId,
  post.categorySlug, post.categoryLabel, JSON.stringify(post.tags), JSON.stringify(post.legacyCategories),
  post.coverPath, post.coverAlt, null, 0, post.publishedAt, post.updatedAt, post.publishedAt,
  post.sourceUpdatedAt, 0,
].map(sql).join(', ')});`;
    const reset = `UPDATE legacy_posts SET body_html = '', body_text = '' WHERE id = ${sql(post.id)} AND import_complete = 0;`;
    const append = (column, value) => literalChunks(value).map((chunk) =>
      `UPDATE legacy_posts SET ${column} = ${column} || '${chunk}' WHERE id = ${sql(post.id)} AND import_complete = 0;`);
    const complete = `UPDATE legacy_posts SET import_complete = 1 WHERE id = ${sql(post.id)} AND import_complete = 0;`;
    return [insert, reset, ...append('body_html', post.bodyHtml), ...append('body_text', post.bodyText), complete];
  };
  const chunks = [];
  for (let offset = 0; offset < posts.length; offset += size) {
    const statements = posts.slice(offset, offset + size).flatMap(statementsFor);
    chunks.push(`${statements.join('\n')}\n`);
  }
  return chunks;
}
