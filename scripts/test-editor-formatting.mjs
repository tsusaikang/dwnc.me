import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { renderNativeMarkdown, sanitizeLegacyHtml } from '../src/lib/native-content.ts';
import { createEditorDatabase, EditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

const category = { id: 'daily', slug: '일상', label: '일상' };
const base = { title: '서식 합성 시험', description: '설명', categoryId: 'daily', tags: ['시험'], coverMediaId: null };
const formatted = '<h2>소제목</h2><p><strong>굵게</strong> <em>기울임</em> <u>밑줄</u> <s>취소선</s></p>'
  + '<p style="text-align:center"><span style="font-size:24px!important;color:#336699;background-color:#fff2ac">크기와 색상</span></p>'
  + '<blockquote><p>인용</p></blockquote><ul><li>목록<ul><li>중첩</li></ul></li></ul>'
  + '<ol start="3" reversed><li value="5">번호</li></ol><hr>'
  + '<table><tbody><tr><th colspan="2">병합 제목</th></tr><tr><td rowspan="2">세로 병합</td><td>내용</td></tr><tr><td>내용</td></tr></tbody></table>'
  + '<p><a href="https://example.test/article">링크</a></p><pre><code>const value = 1;</code></pre>';

function assertFormatting(html) {
  const $ = load(html);
  for (const selector of ['h2', 'strong', 'em', 'u', 's', 'blockquote', 'ul ul', 'ol', 'hr', 'table', 'pre code']) {
    assert.ok($(selector).length, `Missing formatting: ${selector}`);
  }
  assert.equal($('th').attr('colspan'), '2');
  assert.equal($('td').first().attr('rowspan'), '2');
  assert.equal($('ol').attr('start'), '3');
  assert.ok($('ol').is('[reversed]'));
  assert.equal($('ol li').attr('value'), '5');
  assert.ok($('p[style]').attr('style').includes('text-align:center'));
  for (const style of ['font-size:24px', 'color:#336699', 'background-color:#fff2ac']) {
    assert.ok($('span').attr('style').includes(style), `Missing style: ${style}`);
  }
  assert.ok($('span').attr('style').includes('!important'), 'Explicit editor size must override legacy public size rules');
  assert.equal($('a').attr('href'), 'https://example.test/article');
}

const database = await createEditorDatabase();
seedLegacy(database);
const store = new NativePostStore(database);
const native = await store.createDraft(category);
assert.equal(native.sourceKind, 'native');
assert.equal(native.bodyFormat, 'markdown');
const htmlWorking = await store.update(native.id, 0, { ...base, bodyFormat: 'html', bodyMarkdown: formatted });
assert.equal(htmlWorking.sourceKind, 'native');
assert.equal(htmlWorking.bodyFormat, 'html');
assertFormatting(htmlWorking.bodyHtml);
assert.equal((await store.listPublished()).some((post) => post.id === native.id), false);
const firstPublished = await store.publish(native.id, htmlWorking.revision);
assert.equal(firstPublished.globalSequence, 597);
assert.equal(firstPublished.bodyFormat, 'html');
assertFormatting((await store.getPublishedBySequence(597)).bodyHtml);
const changed = await store.update(native.id, firstPublished.revision, { ...base, bodyMarkdown: '<p><u>공개 대기</u></p>' });
assert.equal(changed.bodyFormat, 'html');
assertFormatting((await store.getPublishedBySequence(597)).bodyHtml);
const republished = await store.publish(native.id, changed.revision);
assert.equal(republished.globalSequence, 597);
assert.equal(republished.publishedAt, firstPublished.publishedAt);

const mediaId = '323e4567-e89b-42d3-a456-426614174000';
const mediaPath = `/media/native/${mediaId}.png`;
await store.addMedia({ id: mediaId, postId: native.id, publicPath: mediaPath, objectKey: mediaPath.slice(1), sha256: 'a'.repeat(64), bytes: 1, mime: 'image/png', alt: '사진', createdAt: new Date().toISOString() });
assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM native_media WHERE post_id = ?').get(native.id).n, 1);
assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM legacy_media WHERE post_id = ?').get(native.id).n, 0);
const imageWorking = await store.update(native.id, republished.revision, { ...base, bodyFormat: 'html', bodyMarkdown: `<figure class="imageblock"><img src="${mediaPath}" alt="사진"><figcaption>설명</figcaption></figure>` });
assert.equal(await store.getPublicMedia(mediaPath), null);
await store.publish(native.id, imageWorking.revision);
assert.equal((await store.getPublicMedia(mediaPath)).id, mediaId);

const legacy = await store.getForAdmin('legacy-1');
const legacyPublicBefore = (await store.getPublishedBySequence(1)).bodyHtml;
assert.equal(legacy.sourceKind, 'legacy');
const legacySaved = await store.update(legacy.id, legacy.revision, { ...base, bodyFormat: 'html', bodyMarkdown: formatted + legacy.bodyHtml });
assertFormatting(legacySaved.bodyHtml);
assert.equal((await store.getPublishedBySequence(1)).bodyHtml, legacyPublicBefore);
const preserved = load(legacySaved.bodyHtml);
assert.equal(preserved('figure[data-ke-type="opengraph"]').length, 1);
assert.equal(preserved('figure.imageblock img').length, 1);
assert.equal(preserved('figure.imageblock figcaption').text(), '이미지 설명 예시');
await store.publish(legacy.id, legacySaved.revision);
assertFormatting((await store.getPublishedBySequence(1)).bodyHtml);

const unsafe = await store.update(native.id, imageWorking.revision + 1, { ...base, bodyFormat: 'html', bodyMarkdown: '<p onclick="bad()">정상 글<script>bad()</script><em>기울임</em><a href="javascript:bad()">위험 링크</a><img src="javascript:bad()"></p>' });
assert.equal(/<script|onclick=|javascript:/iu.test(unsafe.bodyHtml), false);
assert.equal(load(unsafe.bodyHtml)('em').length, 1);

const blankRichDraft = await store.createDraft(category);
let blankRich = blankRichDraft;
for (const bodyMarkdown of ['<p><br></p>', '<p>&nbsp;</p>', '<p>\u200b</p>']) {
  blankRich = await store.update(blankRich.id, blankRich.revision, { ...base, bodyFormat: 'html', bodyMarkdown });
  await assert.rejects(() => store.publish(blankRich.id, blankRich.revision), /NATIVE_E_INPUT/u);
}
const imageOnly = await store.update(blankRich.id, blankRich.revision, { ...base, bodyFormat: 'html', bodyMarkdown: `<p><img src="${mediaPath}" alt="사진"></p>` });
assert.equal((await store.publish(imageOnly.id, imageOnly.revision)).status, 'published');

// Upgrade both an existing Markdown publication and its later working copy.
const old = new EditorDatabase();
for (const file of ['0001_native_editor.sql', '0002_legacy_editor.sql', '0003_legacy_import_state.sql', '0004_editor_working_copies.sql']) old.sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
seedLegacy(old);
const oldId = '423e4567-e89b-42d3-a456-426614174000';
const markdown = '# 기존 제목\n\n**굵게**와 *기울임*\n\n- 목록\n\n[링크](https://example.test)';
old.sqlite.prepare(`INSERT INTO native_posts (id, global_sequence, status, title, description, body_markdown, body_html, body_text, category_id, category_slug, category_label, tags_json, revision, created_at, updated_at, published_at) VALUES (?, 597, 'published', '기존 Markdown', '', ?, ?, '합성', 'daily', '일상', '일상', '[]', 2, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`).run(oldId, markdown, renderNativeMarkdown(markdown));
old.sqlite.exec(`INSERT INTO editor_working_copies (post_id,title,description,body_markdown,body_html,body_text,category_id,category_slug,category_label,tags_json,cover_media_id,revision,published_revision,updated_at) SELECT id,title,description,body_markdown,body_html,body_text,category_id,category_slug,category_label,tags_json,cover_media_id,revision+1,revision,updated_at FROM native_posts`);
const oldPublic = { ...old.sqlite.prepare('SELECT * FROM native_posts').get() };
old.sqlite.exec(await readFile(new URL('../migrations/0005_editor_body_format.sql', import.meta.url), 'utf8'));
old.sqlite.exec(await readFile(new URL('../migrations/0006_cms_management.sql', import.meta.url), 'utf8'));
const upgradedStore = new NativePostStore(old);
const upgraded = await upgradedStore.getForAdmin(oldId);
assert.equal(upgraded.bodyFormat, 'markdown');
assert.equal(upgraded.sourceKind, 'native');
assert.equal(upgraded.bodyMarkdown, markdown);
const { body_format, cover_path, cover_alt, ...upgradedPublicRow } = old.sqlite.prepare('SELECT * FROM native_posts').get();
assert.equal(body_format, 'markdown'); assert.equal(cover_path,null); assert.equal(cover_alt,'');
assert.deepEqual(upgradedPublicRow, oldPublic);
const converted = await upgradedStore.update(oldId, upgraded.revision, { ...base, bodyFormat: 'html', bodyMarkdown: upgraded.bodyHtml });
assert.equal(converted.bodyFormat, 'html');
assert.equal(load(converted.bodyHtml)('em').length, 1);
assert.equal((await upgradedStore.getPublishedBySequence(597)).bodyMarkdown, markdown);
await upgradedStore.publish(oldId, converted.revision);
assert.equal((await upgradedStore.getPublishedBySequence(597)).bodyFormat, 'html');
assert.equal(sanitizeLegacyHtml(formatted), sanitizeLegacyHtml(sanitizeLegacyHtml(formatted)));

// Use only the explicitly public built corpus. Report no source text; assert
// that saving its HTML preserves authored text, media, and formatting structure.
const publicIdentities = JSON.parse(await readFile(new URL('../src/data/public-sequence-v1.json', import.meta.url), 'utf8'));
const comparableAttribute = ($, node, attribute) => {
  const value = $(node).attr(attribute) ?? null;
  return attribute === 'style' && value !== null ? value.replace(/\s*([:;,])\s*/gu, '$1').replace(/;$/u, '') : value;
};
const structure = ($) => $('h1,h2,h3,h4,h5,h6,strong,b,em,i,u,s,del,blockquote,ul,ol,li,table,thead,tbody,tr,td,th,pre,code,hr,figure,figcaption,img,a,span[style],p[style]')
  .toArray().map((node) => [node.tagName, ...['style', 'class', 'colspan', 'rowspan', 'start', 'value', 'reversed', 'href', 'src', 'alt'].map((attribute) => comparableAttribute($, node, attribute))]);
for (const identity of publicIdentities) {
  const page = load(await readFile(new URL(`../dist/posts/${identity.globalSequence}/index.html`, import.meta.url), 'utf8'));
  const original = load(page('.prose').first().html());
  const normalized = load(sanitizeLegacyHtml(page('.prose').first().html()));
  assert.ok(original.root().text().normalize('NFC') === normalized.root().text(), 'Published text changed during normalization');
  assert.ok(JSON.stringify(structure(original)) === JSON.stringify(structure(normalized)), 'Published formatting structure changed during normalization');
}

console.log(JSON.stringify({ suite: 'editor-formatting', status: 'PASS', behavior: 'native/legacy HTML formatting roundtrip, Markdown upgrade isolation, source/media ownership, preserved structures and sanitization' }));
