import assert from 'node:assert/strict';
import vm from 'node:vm';
import { load } from 'cheerio';
import { categoryPostPages, renderPostCategoryPagination, POST_CATEGORY_PAGINATION_SCRIPT } from '../src/lib/post-category-pagination.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

const posts = Array.from({ length: 73 }, (_, index) => ({
  title: `합성 글 ${index + 1}`, path: `/posts/${index + 1}`,
  publishedAt: new Date(Date.UTC(2025, 0, index + 1)).toISOString(), date: '2025.01.01',
  categoryId: index % 2 ? 'daily-stories' : 'daily',
}));
posts.push({ ...posts[0], path: '/posts/900', title: '다른 카테고리', categoryId: 'swimming' });
const before = structuredClone(posts);
for (const [path, page] of [['/posts/73', 1], ['/posts/35', 8], ['/posts/1', 15]]) {
  const result = categoryPostPages(posts, 'daily', path);
  assert.equal(result.initialPage, page);
  assert.equal(result.pages.length, 15);
  assert.equal(result.pages.flat().length, 73);
  assert.equal(result.pages.at(-1).length, 3);
  assert.equal(result.pages[page - 1].some(post => post.path === path), true);
  assert.deepEqual(result.pages.flat().map(post => post.path), Array.from({ length: 73 }, (_, i) => `/posts/${73 - i}`));
}
assert.deepEqual(posts, before, 'Selection must not mutate original category data');
assert.deepEqual(categoryPostPages([posts[0], { ...posts[0], path: '/posts/2' }], 'daily', '/posts/1').pages[0].map(p => p.path), ['/posts/2', '/posts/1'], 'Tied dates use descending stable sequence');
assert.equal(renderPostCategoryPagination([], 'daily', '/posts/1', '/category/daily'), '');
const single = load(renderPostCategoryPagination([posts[0]], 'daily', '/posts/1', '/category/daily'));
assert.equal(single('.post-related__pagination').length, 0);
assert.equal(single('[aria-current="page"]').length, 1);
const escaped = load(renderPostCategoryPagination([{ ...posts[0], title: '<img src=x onerror=alert(1)>' }], 'daily', '/posts/1', '/category/daily'));
assert.equal(escaped('.post-related img').length, 0);
assert.match(escaped('.post-related a').text(), /^<img/);

// Run the real event handler over the rendered DOM; no fetch, location, or history
// is provided, so list changes cannot silently become page requests/view events.
const $ = load(renderPostCategoryPagination(posts, 'daily', '/posts/35', '/category/daily'));
const nodes = new Map(); let focused = null, listener;
function wrap(node) {
  if (!node) return null;
  if (nodes.has(node)) return nodes.get(node);
  const element = {
    dataset: new Proxy({}, { get: (_, key) => $(node).attr('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())), set: (_, key, value) => { $(node).attr('data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value); return true; } }),
    get hidden() { return $(node).attr('hidden') !== undefined; }, set hidden(value) { value ? $(node).attr('hidden', '') : $(node).removeAttr('hidden'); },
    get disabled() { return $(node).attr('disabled') !== undefined; }, set disabled(value) { value ? $(node).attr('disabled', '') : $(node).removeAttr('disabled'); },
    set textContent(value) { $(node).text(value); },
    setAttribute(key, value) { $(node).attr(key, value); }, removeAttribute(key) { $(node).removeAttr(key); },
    querySelector(selector) { return wrap($(node).find(selector)[0]); }, querySelectorAll(selector) { return $(node).find(selector).toArray().map(wrap); },
    closest(selector) { return wrap($(node).closest(selector)[0]); },
    contains(child) { return [...nodes].some(([other, value]) => value === child && $.contains(node, other)); },
    addEventListener(type, callback) { assert.equal(type, 'click'); listener = callback; },
    focus() { focused = $(node).attr('data-category-page-button'); },
  };
  nodes.set(node, element); return element;
}
vm.runInNewContext(POST_CATEGORY_PAGINATION_SCRIPT, { document: { querySelectorAll: selector => $(selector).toArray().map(wrap) } });
const shown = () => $('[data-category-page]:not([hidden])');
const numbers = () => $('[data-category-page-button]:not([hidden])').toArray().map(node => Number($(node).text()));
const click = selector => { const button = wrap($(selector)[0]); listener({ target: button }); };
assert.equal(shown().attr('data-category-page'), '8');
assert.deepEqual(numbers(), [8, 9, 10, 11, 12, 13, 14]);
click('[data-category-page-next]');
assert.equal(shown().attr('data-category-page'), '15'); assert.equal(shown().find('li').length, 3);
assert.deepEqual(numbers(), [15]); assert.equal(focused, '15');
assert.equal($('[data-category-page-next]').attr('disabled'), 'disabled');
click('[data-category-page-next]'); assert.equal(shown().attr('data-category-page'), '15');
click('[data-category-page-previous]'); assert.equal(shown().attr('data-category-page'), '14');
click('[data-category-page-previous]'); assert.equal(shown().attr('data-category-page'), '7');
assert.deepEqual(numbers(), [1, 2, 3, 4, 5, 6, 7]);
click('[data-category-page-button="1"]'); assert.equal(shown().attr('data-category-page'), '1');
assert.equal($('[data-category-page-previous]').attr('disabled'), 'disabled');
assert.equal($('[data-category-page-status]').text(), '1 / 15 페이지');
assert.equal($('[data-category-page-button][aria-current="page"]').length, 1);
assert.equal($('a[aria-current="page"]').attr('href'), '/posts/35');

// Real Worker/store integration: only already-public snapshots enter the list,
// including both original daily category IDs, with drafts and access policy intact.
const db = await createEditorDatabase(); seedLegacy(db); const store = new NativePostStore(db);
const make = async (title, visibility = 'public', options = {}) => {
  let post = await store.createDraft({ id: 'daily-stories', slug: '일상-이야기', label: '일상 이야기' });
  post = await store.update(post.id, post.revision, { ...post, title, bodyFormat: 'html', bodyMarkdown: '<p>합성 본문</p>' });
  return visibility === 'draft' ? post : store.publish(post.id, post.revision, { visibility, ...options });
};
let publicPost;
for (let index = 0; index < 7; index++) publicPost = await make(`공개 합성 ${index}`);
for (const visibility of ['draft', 'private', 'protected', 'scheduled']) await make(`HIDDEN_${visibility}`, visibility, { password: 'synthetic password', scheduledAt: new Date(Date.now() + 3600000).toISOString() });
await store.update(publicPost.id, publicPost.revision, { ...publicPost, title: 'UNRELEASED_TITLE' });
const tables = ['native_posts', 'legacy_posts', 'editor_working_copies', 'content_operations'];
const records = Object.fromEntries(tables.map(table => [table, db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
class Rewriter { handlers = []; on(selector, handler) { this.handlers.push([selector, handler]); return this; } async transform(response) { const doc = load(await response.text()); for (const [selector, handler] of this.handlers) doc(selector).each((_, node) => handler.element({ setInnerContent: (value, options = {}) => options.html ? doc(node).html(value) : doc(node).text(value), setAttribute: (key, value) => doc(node).attr(key, value), remove: () => doc(node).remove(), append: value => doc(node).append(value) })); return new Response(doc.html(), { status: response.status, headers: response.headers }); } }
globalThis.HTMLRewriter = Rewriter;
const worker = createNativePublicWorker(async request => new URL(request.url).pathname === '/search-index.json' ? Response.json([]) : new Response('<html><head><title></title></head><body><main id="main"></main></body></html>', { headers: { 'content-type': 'text/html' } }));
const response = await worker(new Request(`https://dwnc.me${publicPost.publicPath}?preview=1`, { headers: { 'user-agent': 'Mozilla/5.0', 'sec-fetch-dest': 'document' } }), { NATIVE_DB: db }, {});
assert.equal(response.status, 200);
const output = await response.text(), article = load(output);
assert.equal(article('.post-related li').length, 8, 'Includes public imported daily and native daily-stories');
assert.equal(article('[data-category-page]:not([hidden]) li').length, 5);
assert.equal(article('.post-related a[aria-current="page"]').attr('href'), publicPost.publicPath);
assert.ok(!output.includes('HIDDEN_')); assert.ok(!output.includes('UNRELEASED_TITLE'));
assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM post_view_daily').get().count, 0);
for (const [table, rows] of Object.entries(records)) assert.deepEqual(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(), rows);
db.sqlite.close();
console.log('PASS post category pagination: all pages, five rows, seven-page groups, current position, date ties, boundary/focus controls, escaping, merged category display, public snapshot policy and no view/write changes');
