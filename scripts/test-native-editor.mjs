import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { Script } from 'node:vm';
import { load } from 'cheerio';
import adminWorker from '../src/admin-worker.ts';
import mediaManifest from '../src/data/public-media-r2-v1.json' with { type: 'json' };
import { clearAccessKeyCacheForTests, verifyAccessIdentity } from '../src/lib/access-auth.ts';
import { adminHtml } from '../src/lib/admin-ui.ts';
import { nativeImagePaths, renderNativeMarkdown } from '../src/lib/native-content.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { DEFAULT_CATEGORIES } from '../src/lib/cms-configuration.ts';

let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
const ok = (value) => { assert.ok(value); assertions += 1; };
const rejects = async (callback, pattern) => { await assert.rejects(callback, pattern); assertions += 1; };

class Statement {
  constructor(database, sql, args = []) { this.database = database; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.database, this.sql, args); }
  first() { return this.database.prepare(this.sql).get(...this.args) ?? null; }
  all() { return { success: true, results: this.database.prepare(this.sql).all(...this.args), meta: {} }; }
  run() { const result = this.database.prepare(this.sql).run(...this.args); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }
}

class Database {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        const rows = this.sqlite.prepare(statement.sql).all(...statement.args);
        return { success: true, results: rows, meta: { changes: this.sqlite.changes ?? 0 } };
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

function createDatabase() {
  const database = new Database();
  database.sqlite.exec(awaitableMigration);
  database.sqlite.exec(legacyMigration);
  database.sqlite.exec(legacyImportStateMigration);
  database.sqlite.exec(workingCopyMigration);
  database.sqlite.exec(bodyFormatMigration);
  database.sqlite.exec(managementMigration);
  database.sqlite.exec(operationsMigration);
  database.sqlite.exec(templatesMigration);
  return database;
}

const awaitableMigration = await readFile(new URL('../migrations/0001_native_editor.sql', import.meta.url), 'utf8');
const legacyMigration = await readFile(new URL('../migrations/0002_legacy_editor.sql', import.meta.url), 'utf8');
const legacyImportStateMigration = await readFile(new URL('../migrations/0003_legacy_import_state.sql', import.meta.url), 'utf8');
const workingCopyMigration = await readFile(new URL('../migrations/0004_editor_working_copies.sql', import.meta.url), 'utf8');
const bodyFormatMigration = await readFile(new URL('../migrations/0005_editor_body_format.sql', import.meta.url), 'utf8');
const operationsMigration = await readFile(new URL('../migrations/0007_content_operations.sql', import.meta.url), 'utf8');
const templatesMigration = await readFile(new URL('../migrations/0008_cms_templates_media.sql', import.meta.url), 'utf8');
const managementMigration = await readFile(new URL('../migrations/0006_cms_management.sql', import.meta.url), 'utf8');
const defaultInput = {
  title: '웹에서 쓴 첫 글', description: '새 편집기 설명', bodyMarkdown: '# 본문\n\n안전한 **내용**',
  categoryId: 'daily', tags: ['웹 기록'], coverMediaId: null,
};

equal(renderNativeMarkdown('<script>alert(1)</script>').includes('<script>'), false);
equal(renderNativeMarkdown('![x](javascript:alert(1))').includes('<img'), false);
equal(renderNativeMarkdown('![사진](/media/native/123e4567-e89b-42d3-a456-426614174000.webp)').includes('<img'), true);
equal(nativeImagePaths('[다운로드](/media/native/123e4567-e89b-42d3-a456-426614174000.webp)').length, 0);
equal(nativeImagePaths('![사진](/media/native/123e4567-e89b-42d3-a456-426614174000.webp)')[0], '/media/native/123e4567-e89b-42d3-a456-426614174000.webp');
equal(nativeImagePaths('```\n![사진](/media/native/123e4567-e89b-42d3-a456-426614174000.webp)\n```').length, 0);

const database = createDatabase();
const clock = () => new Date('2026-09-06T03:00:00.000Z');
const store = new NativePostStore(database, clock);
const draft = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
equal(draft.status, 'draft'); equal(draft.globalSequence, null); equal(draft.revision, 0);
const updated = await store.update(draft.id, 0, defaultInput);
equal(updated.revision, 1); equal(updated.bodyHtml.includes('<strong>내용</strong>'), true);
await rejects(() => store.update(draft.id, 0, defaultInput), /NATIVE_E_REVISION/u);
const published = await store.publish(draft.id, 1);
equal(published.globalSequence, 597); equal(published.status, 'published'); equal(published.revision, 2);
const secondDraft = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
const secondSaved = await store.update(secondDraft.id, 0, { ...defaultInput, title: '두 번째 글' });
const second = await store.publish(secondDraft.id, secondSaved.revision);
equal(second.globalSequence, 598);
equal((await store.listPublished()).map((post) => post.globalSequence).join(','), '598,597');

const mediaId = '123e4567-e89b-42d3-a456-426614174000';
const publicPath = `/media/native/${mediaId}.webp`;
await store.addMedia({ id: mediaId, postId: draft.id, publicPath, objectKey: publicPath.slice(1), sha256: 'a'.repeat(64), bytes: 3, mime: 'image/webp', alt: '사진', createdAt: clock().toISOString() });
equal(await store.getPublicMedia(publicPath), null);
const withRawReference = await store.update(draft.id, published.revision, { ...defaultInput, bodyMarkdown: `[파일](${publicPath})` });
equal(await store.getPublicMedia(publicPath), null);
const withImage = await store.update(draft.id, withRawReference.revision, { ...defaultInput, bodyMarkdown: `![사진](${publicPath})` });
equal(await store.getPublicMedia(publicPath), null);
const imagePublished = await store.publish(draft.id, withImage.revision);
equal((await store.getPublicMedia(publicPath))?.postId, draft.id);
equal(withImage.status, 'published');
const withCover = await store.update(draft.id, imagePublished.revision, { ...defaultInput, coverMediaId: mediaId });
equal((await store.getPublicMedia(publicPath))?.coverMediaId, null);
await store.publish(draft.id, withCover.revision);
equal((await store.getPublicMedia(publicPath))?.coverMediaId, mediaId);
const emptyWorking = await store.update(draft.id, withCover.revision + 1, { ...defaultInput, title: '', bodyMarkdown: '' });
equal(emptyWorking.title, '');
await rejects(() => store.publish(draft.id, emptyWorking.revision), /NATIVE_E_INPUT/u);
equal((await store.getPublishedBySequence(597))?.title, defaultInput.title);
equal((await store.getForAdmin(draft.id))?.title, '');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }); Object.assign(jwk, { kid: 'key-1', alg: 'RS256', use: 'sig' });
const teamDomain = 'https://dwnc-example.cloudflareaccess.com';
const accessEnv = { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: 'abcdefghijklmnopqrstuvwx', ACCESS_ALLOWED_EMAIL: 'owner@example.com' };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function accessToken(overrides = {}) {
  const head = b64({ alg: 'RS256', kid: 'key-1' });
  const payload = b64({ iss: teamDomain, aud: accessEnv.ACCESS_AUD, sub: 'user-1', email: 'owner@example.com', exp: 2_000_000_000, ...overrides });
  return `${head}.${payload}.${sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), privateKey).toString('base64url')}`;
}
const certFetch = async () => Response.json({ keys: [jwk] });
clearAccessKeyCacheForTests();
const identity = await verifyAccessIdentity(new Request('https://admin.example.test/', { headers: { 'cf-access-jwt-assertion': accessToken() } }), accessEnv, { fetcher: certFetch, now: () => 1_900_000_000_000 });
equal(identity.email, 'owner@example.com');
await rejects(() => verifyAccessIdentity(new Request('https://admin.example.test/', { headers: { 'cf-access-jwt-assertion': accessToken({ email: 'other@example.com' }) } }), accessEnv, { fetcher: certFetch, now: () => 1_900_000_000_000 }), /ACCESS_E_IDENTITY/u);

const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedJwk = rotated.publicKey.export({ format: 'jwk' }); Object.assign(rotatedJwk, { kid: 'key-2', alg: 'RS256', use: 'sig' });
function rotatedToken() {
  const head = b64({ alg: 'RS256', kid: 'key-2' });
  const payload = b64({ iss: teamDomain, aud: accessEnv.ACCESS_AUD, sub: 'user-1', email: 'owner@example.com', exp: 2_000_000_000 });
  return `${head}.${payload}.${sign('RSA-SHA256', Buffer.from(`${head}.${payload}`), rotated.privateKey).toString('base64url')}`;
}
clearAccessKeyCacheForTests(); let keyFetches = 0;
const rotatingFetch = async () => Response.json({ keys: [keyFetches++ === 0 ? jwk : rotatedJwk] });
await verifyAccessIdentity(new Request('https://admin.example.test/', { headers: { 'cf-access-jwt-assertion': accessToken() } }), accessEnv, { fetcher: rotatingFetch, now: () => 1_900_000_000_000 });
equal((await verifyAccessIdentity(new Request('https://admin.example.test/', { headers: { 'cf-access-jwt-assertion': rotatedToken() } }), accessEnv, { fetcher: rotatingFetch, now: () => 1_900_000_000_000 })).email, 'owner@example.com');
equal(keyFetches, 2);

const adminDatabase = createDatabase();
const objects = new Map();
const legacyEntry = mediaManifest.entries.find((entry) => entry.publicPath.startsWith('/media/tistory/'))
  ?? mediaManifest.entries[0];
const legacyEntrySha = createHash('sha256').update(JSON.stringify({
  publicPath: legacyEntry.publicPath, key: legacyEntry.key, size: legacyEntry.size,
  sha256: legacyEntry.sha256, contentType: legacyEntry.contentType, cacheControl: legacyEntry.cacheControl,
})).digest('hex');
const legacyObject = {
  key: legacyEntry.key, size: legacyEntry.size, version: 'legacy-version', etag: 'legacy-etag',
  httpEtag: '"legacy-etag"', uploaded: new Date('2026-09-06T00:00:00.000Z'),
  httpMetadata: { contentType: legacyEntry.contentType, cacheControl: legacyEntry.cacheControl },
  customMetadata: { sha256: legacyEntry.sha256, contract: 'dwnc-public-media-r2-v1', 'manifest-entry-sha256': legacyEntrySha },
  checksums: { sha256: Uint8Array.from(Buffer.from(legacyEntry.sha256, 'hex')).buffer },
};
const adminEnv = { ...accessEnv, NATIVE_DB: adminDatabase, MEDIA_BUCKET: {
  async head(key) { return key === legacyEntry.key ? legacyObject : null; },
  async get(key) { return key === legacyEntry.key ? { ...legacyObject, body: Buffer.from('legacy-image') } : null; },
}, NATIVE_MEDIA_BUCKET: {
  async put(key, body, options) { const bytes = new Uint8Array(await new Response(body).arrayBuffer()); const sha256 = createHash('sha256').update(bytes).digest('hex'); if (sha256 !== options.sha256) return null; const object = { key, size: bytes.length, customMetadata: options.customMetadata }; objects.set(key, { ...object, bytes, httpMetadata: options.httpMetadata, httpEtag: '"native"', checksums: { sha256: Uint8Array.from(Buffer.from(sha256, 'hex')).buffer }, body: bytes }); return object; },
  async get(key) { return objects.get(key) ?? null; },
  async head(key) { return objects.get(key) ?? null; },
} };
const authHeaders = { 'cf-access-jwt-assertion': accessToken(), origin: 'https://admin.example.test', 'content-type': 'application/json' };
clearAccessKeyCacheForTests();
globalThis.fetch = certFetch;
equal((await adminWorker.fetch(new Request('https://admin.example.test/'), adminEnv)).status, 401);
const createResponse = await adminWorker.fetch(new Request('https://admin.example.test/api/posts', { method: 'POST', headers: authHeaders, body: '{}' }), adminEnv);
equal(createResponse.status, 201);
const adminDraft = (await createResponse.json()).post;
const saveResponse = await adminWorker.fetch(new Request(`https://admin.example.test/api/posts/${adminDraft.id}`, { method: 'PUT', headers: authHeaders, body: JSON.stringify({ expectedRevision: 0, input: defaultInput }) }), adminEnv);
equal(saveResponse.status, 200);
const adminSaved = (await saveResponse.json()).post;
const publishResponse = await adminWorker.fetch(new Request(`https://admin.example.test/api/posts/${adminDraft.id}/publish`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ expectedRevision: adminSaved.revision }) }), adminEnv);
equal(publishResponse.status, 200); equal((await publishResponse.json()).post.globalSequence, 597);
const imageBytes = Buffer.from('image-bytes');
const imageSha = createHash('sha256').update(imageBytes).digest('hex');
const beforeRejectedUploads = objects.size;
equal((await adminWorker.fetch(new Request('https://admin.example.test/api/posts/123e4567-e89b-42d3-a456-426614174999/media', { method: 'POST', headers: { ...authHeaders, 'content-type': 'image/png', 'x-dwnc-file-size': String(imageBytes.length), 'x-dwnc-file-sha256': imageSha }, body: imageBytes }), adminEnv)).status, 400);
equal((await adminWorker.fetch(new Request(`https://admin.example.test/api/posts/${adminDraft.id}/media`, { method: 'POST', headers: { ...authHeaders, 'content-type': 'image/png', 'x-dwnc-file-size': String(25 * 1024 * 1024 + 1), 'x-dwnc-file-sha256': imageSha }, body: imageBytes }), adminEnv)).status, 400);
equal((await adminWorker.fetch(new Request(`https://admin.example.test/api/posts/${adminDraft.id}/media`, { method: 'POST', headers: { ...authHeaders, 'content-type': 'image/png', 'x-dwnc-file-size': String(imageBytes.length + 1), 'x-dwnc-file-sha256': imageSha }, body: imageBytes }), adminEnv)).status, 400);
equal(objects.size, beforeRejectedUploads);
const imageResponse = await adminWorker.fetch(new Request(`https://admin.example.test/api/posts/${adminDraft.id}/media`, { method: 'POST', headers: { ...authHeaders, 'content-type': 'image/png', 'x-dwnc-file-size': String(imageBytes.length), 'x-dwnc-file-sha256': imageSha, 'x-dwnc-file-name': 'photo.png' }, body: imageBytes }), adminEnv);
equal(imageResponse.status, 201); const uploadedMedia = (await imageResponse.json()).media; ok(uploadedMedia.publicPath.endsWith('.png')); equal(objects.size, 1);
const legacyImageGet = await adminWorker.fetch(new Request(`https://admin.example.test${legacyEntry.publicPath}`, { headers: { 'cf-access-jwt-assertion': accessToken() } }), adminEnv);
equal(legacyImageGet.status, 200); equal(legacyImageGet.headers.get('content-type'), legacyEntry.contentType);
const legacyImageHead = await adminWorker.fetch(new Request(`https://admin.example.test${legacyEntry.publicPath}`, { method: 'HEAD', headers: { 'cf-access-jwt-assertion': accessToken() } }), adminEnv);
equal(legacyImageHead.status, 200); equal(await legacyImageHead.text(), '');
const nativeImageGet = await adminWorker.fetch(new Request(`https://admin.example.test${uploadedMedia.publicPath}`, { headers: { 'cf-access-jwt-assertion': accessToken() } }), adminEnv);
equal(nativeImageGet.status, 200); equal(await nativeImageGet.text(), imageBytes.toString());
const nativeImageHead = await adminWorker.fetch(new Request(`https://admin.example.test${uploadedMedia.publicPath}`, { method: 'HEAD', headers: { 'cf-access-jwt-assertion': accessToken() } }), adminEnv);
equal(nativeImageHead.status, 200); equal(await nativeImageHead.text(), '');
equal((await adminWorker.fetch(new Request(`https://admin.example.test${legacyEntry.publicPath}`), adminEnv)).status, 401);
equal((await adminWorker.fetch(new Request('https://admin.example.test/api/posts', { method: 'POST', headers: { ...authHeaders, origin: 'https://evil.example' }, body: '{}' }), adminEnv)).status, 403);

const ui = adminHtml('owner@example.com');
const uiDocument = load(ui);
const uiScript = uiDocument('script').text();
assert.doesNotThrow(() => new Script(uiScript)); assertions += 1;
equal(uiDocument('#publish').text(), '공개 반영');
equal(uiDocument('#saveIssue #loadLatest').length, 1);
equal(uiDocument('#saveIssue #keepLocal').length, 1);
equal(uiDocument('#saveIssue #resumeLogin').length, 1);
equal(uiDocument('#bodyHtmlShell > #bodyHtml + #mediaSelectionOutline').length, 1);
equal(uiDocument('#imageTools[role="toolbar"] #deleteImage').text(), '선택 항목 삭제');
equal(uiDocument('#markdownMedia[aria-label="본문 이미지"]').length, 1);
ok(ui.includes('.media-selection-outline{'));
ok(ui.includes('.image-tools{position:fixed;z-index:20'));
ok(ui.includes('figure[data-ke-type="opengraph"]>a'));
ok(ui.includes('.html-editor .og-title,.html-editor .se-oglink-title'));
ok(ui.includes('-webkit-line-clamp:2'));
ok(ui.includes('-webkit-line-clamp:3'));
ok(uiScript.includes("node.closest('figure[data-ke-type=\"opengraph\"],.se_component.se_oglink,.se-component.se-oglink')"));
ok(uiScript.includes("node.closest('figure.imageblock,.se_component.se_image,.se-component.se-image')"));
ok(uiScript.includes("event.key==='Delete'||event.key==='Backspace'"));
ok(uiScript.includes("event.key==='Escape'&&selectedMedia"));
ok(uiScript.includes("if(link)event.preventDefault()"));
ok(uiScript.includes("target.remove();placeCaret(parent,next);schedule()"));
ok(uiScript.includes('box.top-tool.height-gap'));
ok(uiScript.includes('if(top<topLimit)top=box.bottom+gap'));
ok(uiScript.includes('bottomLimit-tool.height'));
ok(uiScript.includes('window.innerWidth-tool.width-margin'));
ok(uiScript.includes("window.addEventListener('scroll',positionMediaSelection,true)"));
ok(uiScript.includes("selectedMedia.kind==='markdown-image'"));
ok(uiScript.includes("$('body').setRangeText('',start,end,'end')"));
equal(uiDocument('#formatToolbar[role="toolbar"]').length, 1);
equal(uiDocument('#formatToolbar [data-format-command="bold"]').length, 1);
equal(uiDocument('#formatToolbar #fontSize').length, 1);
ok(uiScript.includes("figure.className='imageblock alignCenter'"));
equal(uiScript.includes('data-editor-selected'), false);

const publicStore = new NativePostStore(adminDatabase);
const adminCurrent = await publicStore.getForAdmin(adminDraft.id);
const publicWorking = await publicStore.update(adminDraft.id, adminCurrent.revision, {
  ...defaultInput, tags: ['A B', 'Native Only'], bodyMarkdown: `# 본문\n\n![사진](${uploadedMedia.publicPath})`,
});

const publicPost = await publicStore.publish(adminDraft.id, publicWorking.revision);

adminDatabase.sqlite.prepare(`INSERT INTO legacy_posts (
  id, global_sequence, source, source_id, source_url, legacy_path, title, description,
  body_html, body_text, category_id, category_slug, category_label, tags_json,
  legacy_categories_json, cover_path, cover_alt, revision, created_at, updated_at,
  published_at, source_updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  'legacy-1', 1, 'tistory', '1', 'https://dwnc.me/1', '/1', '수정 전 예전 글 1', '예전 설명',
  '<p>예전 본문 <img src="/media/tistory/1/original.jpg" alt="원본"></p>', '예전 본문',
  'daily', '일상', '일상', JSON.stringify(['A B']), JSON.stringify(['일상']),
  '/media/tistory/1/cover.jpg', '대표', 0, '2025-01-16T00:00:00.000Z',
  '2025-01-16T00:00:00.000Z', '2025-01-16T00:00:00.000Z', null,
);
adminDatabase.sqlite.prepare('UPDATE legacy_posts SET import_complete = 1 WHERE id = ?').run('legacy-1');
const adminList = await (await adminWorker.fetch(new Request('https://admin.example.test/api/posts', { headers: authHeaders }), adminEnv)).json();
equal(adminList.posts.length, 2); equal(Object.hasOwn(adminList.posts.find((post) => post.id === 'legacy-1'), 'bodyMarkdown'), false);
const legacyGet = await adminWorker.fetch(new Request('https://admin.example.test/api/posts/legacy-1', { headers: authHeaders }), adminEnv);
equal(legacyGet.status, 200); const legacyPost = (await legacyGet.json()).post; equal(legacyPost.bodyFormat, 'html');
const legacyInput = { ...defaultInput, title: '수정된 예전 글 1',
  bodyMarkdown: '<p onclick="bad()">고친 본문 <img src="/media/tistory/1/original.jpg" alt="원본"></p><script>bad()</script>',
  tags: ['A B'] };
const legacyPut = await adminWorker.fetch(new Request('https://admin.example.test/api/posts/legacy-1', {
  method: 'PUT', headers: authHeaders, body: JSON.stringify({ expectedRevision: 0, input: legacyInput }),
}), adminEnv);
equal(legacyPut.status, 200); const legacySaved = (await legacyPut.json()).post;
equal(legacySaved.globalSequence, 1); equal(legacySaved.publishedAt, legacyPost.publishedAt);
equal(legacySaved.bodyHtml.includes('onclick'), false); equal(legacySaved.bodyHtml.includes('<script'), false);
equal(legacySaved.bodyHtml.includes('/media/tistory/1/original.jpg'), true);
equal((await adminWorker.fetch(new Request('https://admin.example.test/api/posts/legacy-1', {
  method: 'PUT', headers: authHeaders, body: JSON.stringify({ expectedRevision: 0, input: legacyInput }),
}), adminEnv)).status, 409);

equal((await publicStore.getPublishedBySequence(1)).title, '수정 전 예전 글 1');
equal(legacySaved.publishedRevision, 0);
const legacyPublished = await publicStore.publish('legacy-1', legacySaved.revision);
equal(legacyPublished.publishedRevision, legacyPublished.revision);
equal(legacyPublished.globalSequence, 1);
equal(legacyPublished.publishedAt, legacyPost.publishedAt);

class TestHtmlRewriter {
  handlers = [];
  on(selector, handler) { this.handlers.push([selector, handler]); return this; }
  async transform(response) {
    const headers = new Headers(response.headers); const status = response.status;
    const $ = load(await response.text());
    for (const [selector, handler] of this.handlers) {
      $(selector).each((_index, node) => handler.element({
        setInnerContent(value, options = {}) { options.html ? $(node).html(value) : $(node).text(value); },
        setAttribute(name, value) { $(node).attr(name, value); },
        append(value, options = {}) { $(node).append(options.html ? value : $('<span></span>').text(value).html()); },
        remove() { $(node).remove(); },
      }));
    }
    headers.delete('content-length');
    return new Response($.html(), { status, headers });
  }
}
globalThis.HTMLRewriter = TestHtmlRewriter;

const legacyPosts = Array.from({ length: 16 }, (_unused, index) => ({
  title: `예전 글 ${index + 1}`, description: `설명 ${index + 1}`, path: `/posts/${index + 1}`,
  date: `2025.01.${String(16 - index).padStart(2, '0')}`, publishedAt: `2025-01-${String(16 - index).padStart(2, '0')}T00:00:00.000Z`,
  categoryId: 'daily', categories: ['일상'], tags: [index % 2 ? 'A-B' : 'A B'], categoryPath: ['일상'],
  leafCategory: { label: '일상', path: '/category/일상' }, searchText: `예전 글 ${index + 1} 일상`.toLocaleLowerCase('ko-KR'),
}));
Object.assign(legacyPosts[0], { featured: true, cover: '/media/legacy-feature.webp', coverAlt: '기존 대표 이미지' });
const shellHtml = '<!doctype html><html><head><title>기존</title><meta name="description" content="기존"><link rel="canonical" href="https://dwnc.me/about"><meta property="og:title" content="기존"><meta property="og:description" content="기존"><meta property="og:url" content="https://dwnc.me/about"><meta property="og:type" content="website"></head><body><header><nav class="site-nav"></nav></header><dialog id="category-drawer"><nav></nav></dialog><main id="main">기존</main></body></html>';
const routeHtml = (name, script = '') => shellHtml.replace('기존</main>', `<p data-static-page="${name}">기존</p></main>${script}`);
const staticRequests = [];
const staticHandler = async (request) => {
  const pathname = new URL(request.url).pathname;
  staticRequests.push(pathname);
  if (pathname === '/search-index.json') return Response.json(legacyPosts);
  if (pathname === '/rss.xml') return new Response('<?xml version="1.0"?><rss><channel><item><title>old</title></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } });
  if (pathname === '/sitemap-0.xml') return new Response('<?xml version="1.0"?><urlset></urlset>', { headers: { 'content-type': 'application/xml' } });
  if (pathname === '/') return new Response(routeHtml('home', '<script id="home-page-script">home()</script>'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (pathname === '/tags') return new Response(routeHtml('tags', '<script id="tag-filter-script">filterTags()</script>'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (pathname === '/posts/1') return new Response(routeHtml('legacy-post', '<script id="legacy-post-script">post()</script>'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (pathname === '/tag/upstream-failure') return new Response('upstream failure', { status: 503, headers: { 'content-type': 'text/plain' } });
  if (pathname === '/archive' || pathname === '/category' || pathname.startsWith('/category/%EC%9D%BC%EC%83%81') || pathname.startsWith('/tag/a-b--')) return new Response(routeHtml('known'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (pathname === '/about') return new Response(shellHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
};
const publicWorker = createNativePublicWorker(staticHandler);
const versionId = '123e4567-e89b-42d3-a456-426614174000';
const publicEnv = { NATIVE_DB: adminDatabase, NATIVE_MEDIA_BUCKET: adminEnv.NATIVE_MEDIA_BUCKET, ASSETS: {}, MEDIA_BUCKET: {}, DWNC_DEPLOYMENT_ENVIRONMENT: 'staging', CF_VERSION_METADATA: { id: versionId } };
const searchResponse = await publicWorker(new Request('https://dwnc.me/search-index.json'), publicEnv, {});
equal(searchResponse.status, 200); const mergedSearch = await searchResponse.json();
equal(mergedSearch[0].path, `/posts/${publicPost.globalSequence}`); equal(mergedSearch.length, 17);
equal(mergedSearch.find((post) => post.path === '/posts/1').title, '수정된 예전 글 1');
equal(searchResponse.headers.get('x-dwnc-staging-version'), versionId);
equal((await publicWorker(new Request('https://dwnc.me/posts/9999'), publicEnv, {})).status, 404);

const home = await (await publicWorker(new Request('https://dwnc.me/'), publicEnv, {})).text();
ok(home.includes(defaultInput.title));
equal((home.match(/<li><a href="\/posts\//gu) ?? []).length, 7);
ok(home.includes('/media/tistory/1/cover.jpg')); ok(home.includes('대표')); ok(home.includes('id="home-page-script"'));
const archive = await (await publicWorker(new Request('https://dwnc.me/archive'), publicEnv, {})).text();
ok(archive.includes('<h2>2026</h2>')); ok(archive.includes('<h2>2025</h2>'));

// Dynamic category output must use the same responsive hierarchy and navigation
// contract as the static page, rather than putting labels in a 28px number cell.
const categoryIndex = load(await (await publicWorker(new Request('https://dwnc.me/category'), publicEnv, {})).text());
const roots = DEFAULT_CATEGORIES.filter((node) => !node.parentId);
equal(categoryIndex('.category-tree-index__root').length, roots.length);
equal(categoryIndex('#main .home-category-list').length, 0);
for (const [index, root] of roots.entries()) {
  const section = categoryIndex('.category-tree-index__root').eq(index);
  const rootLink = section.find('.category-tree-index__root-link');
  equal(rootLink.children().map((_i, node) => node.tagName).get().join(','), 'span,strong,small');
  equal(rootLink.children('span').text(), String(index + 1).padStart(2, '0'));
  equal(rootLink.children('strong').text(), root.label);
  const children = DEFAULT_CATEGORIES.filter((node) => node.parentId === root.id);
  equal(section.find('.category-tree-index__children > li').length, children.length);
  equal(section.find('.category-tree-index__children strong').map((_i, node) => categoryIndex(node).text()).get().join('|'), children.map((node) => node.label).join('|'));
}
equal(categoryIndex('.site-nav a[href="/category"]').length, 1);
equal(categoryIndex('.site-nav__category.is-active > a').attr('aria-current'), 'page');
equal(categoryIndex('.site-nav__category > button[data-category-open]').length, 1);
equal(categoryIndex('.site-nav > button[data-category-open]').length, 0);
equal(categoryIndex('[data-category-open]').attr('aria-controls'), 'category-drawer');
equal(categoryIndex('.search-trigger > span').text(), '찾기');
equal(categoryIndex('#category-drawer .category-tree > li').length, roots.length);

const categoryOne = await (await publicWorker(new Request('https://dwnc.me/category/%EC%9D%BC%EC%83%81'), publicEnv, {})).text();
equal((categoryOne.match(/class="post-card"/gu) ?? []).length, 15); ok(categoryOne.includes('Category · 17편'));
const categoryTwoResponse = await publicWorker(new Request('https://dwnc.me/category/%EC%9D%BC%EC%83%81/page/2'), publicEnv, {});
const categoryTwo = await categoryTwoResponse.text();
equal((categoryTwo.match(/class="post-card"/gu) ?? []).length, 2);
equal(load(categoryTwo)('link[rel="canonical"]').attr('href'), 'https://dwnc.me/category/%EC%9D%BC%EC%83%81/page/2');
equal(load(categoryTwo)('meta[property="og:url"]').attr('content'), 'https://dwnc.me/category/%EC%9D%BC%EC%83%81/page/2');

const suffix = (label) => Buffer.from(label, 'utf8').toString('base64url');
const abSpaceSlug = `a-b--${suffix('A B')}`; const abDashSlug = `a-b--${suffix('A-B')}`;
const tagsIndex = await (await publicWorker(new Request('https://dwnc.me/tags'), publicEnv, {})).text();
ok(tagsIndex.includes(`/tag/${abSpaceSlug}`)); ok(tagsIndex.includes(`/tag/${abDashSlug}`));
ok(tagsIndex.includes('data-tag-filter')); ok(tagsIndex.includes('data-tag-list')); ok(tagsIndex.includes('id="tag-filter-script"'));
const exactTagPage = await (await publicWorker(new Request(`https://dwnc.me/tag/${abDashSlug}`), publicEnv, {})).text();
ok(exactTagPage.includes('Tag · 8편')); equal((exactTagPage.match(/class="post-card"/gu) ?? []).length, 8); equal(exactTagPage.includes(defaultInput.title), false);

const nativePostResponse = await publicWorker(new Request(`https://dwnc.me/posts/${publicPost.globalSequence}?from=test`), publicEnv, {});
const nativePostHtml = await nativePostResponse.text();
equal(nativePostResponse.status, 200); equal(nativePostResponse.headers.get('x-dwnc-staging-version'), versionId);
equal(load(nativePostHtml)('link[rel="canonical"]').attr('href'), `https://dwnc.me/posts/${publicPost.globalSequence}`);
equal(load(nativePostHtml)('meta[property="og:type"]').attr('content'), 'article');
ok(nativePostHtml.includes(`/tag/${abSpaceSlug}`));
const editedLegacyResponse = await publicWorker(new Request('https://dwnc.me/posts/1'), publicEnv, {});
const editedLegacyHtml = await editedLegacyResponse.text();
equal(editedLegacyResponse.status, 200); ok(editedLegacyHtml.includes('고친 본문'));
ok(editedLegacyHtml.includes('/media/tistory/1/original.jpg')); ok(editedLegacyHtml.includes('id="legacy-post-script"'));
for (const [documentHtml, post] of [[nativePostHtml, publicPost], [editedLegacyHtml, legacyPublished]]) {
  const document = load(documentHtml);
  equal(document('.post-header__meta time').length, 1);
  equal(document('.post-header__meta').text().includes('읽는 데'), false);
  equal(document('.prose').html(), load(post.bodyHtml, null, false).html());
}

const nativeOnlyTag = await (await publicWorker(new Request('https://dwnc.me/tag/native-only'), publicEnv, {})).text();
ok(nativeOnlyTag.includes('Tag · 1편')); ok(nativeOnlyTag.includes(defaultInput.title));
ok(staticRequests.includes('/tag/native-only')); ok(staticRequests.includes('/about'));
const aboutBeforeFailure = staticRequests.filter((path) => path === '/about').length;
equal((await publicWorker(new Request('https://dwnc.me/tag/upstream-failure'), publicEnv, {})).status, 503);
equal(staticRequests.filter((path) => path === '/about').length, aboutBeforeFailure);

const nativeMediaResponse = await publicWorker(new Request(`https://dwnc.me${uploadedMedia.publicPath}?download=1`), publicEnv, {});
equal(nativeMediaResponse.status, 200); equal(nativeMediaResponse.headers.get('x-dwnc-staging-version'), versionId);
equal(Buffer.from(await nativeMediaResponse.arrayBuffer()).toString(), imageBytes.toString());

const rss = await (await publicWorker(new Request('https://dwnc.me/rss.xml'), publicEnv, {})).text();
equal((rss.match(/<item>/gu) ?? []).length, 17); ok(rss.indexOf(defaultInput.title) < rss.indexOf('예전 글 1'));

const aggregateGet = await publicWorker(new Request('https://dwnc.me/search-index.json'), publicEnv, {});
const getHeaders = Object.fromEntries(aggregateGet.headers);
const aggregateHead = await publicWorker(new Request('https://dwnc.me/search-index.json', { method: 'HEAD' }), publicEnv, {});
equal(aggregateHead.status, aggregateGet.status); equal(await aggregateHead.text(), '');
equal(JSON.stringify(Object.fromEntries(aggregateHead.headers)), JSON.stringify(getHeaders));

console.log(JSON.stringify({ suite: 'native-editor', assertions, status: 'PASS' }, null, 2));
