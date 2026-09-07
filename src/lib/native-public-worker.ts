import { escapeHtml, NATIVE_MEDIA_PATH_PATTERN } from './native-content.ts';
import { NativePostStore, type NativePost } from './native-post-store.ts';
import {
  CATEGORY_PAGE_SIZE, TAG_PAGE_SIZE, TAXONOMY, slugifyLabel,
  taxonomyDescendants, taxonomyNodeBySlug,
} from './taxonomy.ts';

export interface NativePublicEnvironment {
  ASSETS: Fetcher;
  NATIVE_DB: D1Database;
  NATIVE_MEDIA_BUCKET: R2Bucket;
  MEDIA_BUCKET: R2Bucket;
  DWNC_DEPLOYMENT_ENVIRONMENT?: 'staging' | 'production';
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
}
export type NativeMediaEnvironment = Pick<NativePublicEnvironment,
  'NATIVE_DB' | 'NATIVE_MEDIA_BUCKET' | 'DWNC_DEPLOYMENT_ENVIRONMENT' | 'CF_VERSION_METADATA'>;

type StaticHandler = (request: Request, env: NativePublicEnvironment, context: ExecutionContext) => Promise<Response>;
interface DiscoveryPost {
  title: string; description: string; path: string; date: string; publishedAt: string;
  featured?: boolean; cover?: string | null; coverAlt?: string;
  categoryId: string; categories: string[]; tags: string[]; categoryPath: string[];
  leafCategory: { label: string; path: string }; searchText: string;
}
interface TagNode { label: string; slug: string; count: number }

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function bytesToHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function xmlEscape(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}
function unavailable(method = 'GET') {
  return new Response(method === 'HEAD' ? null : 'Not found.\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
function withVersion(response: Response, env: Pick<NativePublicEnvironment,
  'DWNC_DEPLOYMENT_ENVIRONMENT' | 'CF_VERSION_METADATA'>) {
  if (env.DWNC_DEPLOYMENT_ENVIRONMENT !== 'staging') return response;
  const version = env.CF_VERSION_METADATA?.id;
  if (!VERSION_PATTERN.test(version ?? '')) return new Response('Media temporarily unavailable.\n', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  const headers = new Headers(response.headers); headers.set('x-dwnc-staging-version', version!);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function headOf(response: Response) {
  const headers = new Headers(response.headers); headers.delete('content-length');
  return new Response(null, { status: response.status, statusText: response.statusText, headers });
}
function dateLabel(iso: string) { return iso.slice(0, 10).replaceAll('-', '.'); }
function sequenceOf(path: string) { return Number(path.match(/^\/posts\/(\d+)$/u)?.[1] ?? 0); }
function comparePosts(left: DiscoveryPost, right: DiscoveryPost) {
  return right.publishedAt.localeCompare(left.publishedAt) || sequenceOf(right.path) - sequenceOf(left.path);
}
function nativeDiscovery(post: NativePost): DiscoveryPost {
  const publishedAt = post.publishedAt ?? post.updatedAt;
  return {
    title: post.title, description: post.description || post.bodyText.slice(0, 160),
    path: `/posts/${post.globalSequence}`, date: dateLabel(publishedAt), publishedAt,
    featured: false, cover: null, coverAlt: '',
    categoryId: post.categoryId, categories: [post.categoryLabel], tags: [...post.tags],
    categoryPath: [post.categoryLabel], leafCategory: { label: post.categoryLabel, path: `/category/${post.categorySlug}` },
    searchText: [post.title, post.description, post.categoryLabel, ...post.tags, post.bodyText].join(' ').toLocaleLowerCase('ko-KR'),
  };
}
function validDiscovery(value: unknown): value is DiscoveryPost {
  const post = value as Partial<DiscoveryPost>;
  return Boolean(post && typeof post.title === 'string' && typeof post.description === 'string'
    && typeof post.path === 'string' && /^\/posts\/[1-9]\d*$/u.test(post.path)
    && typeof post.publishedAt === 'string' && !Number.isNaN(Date.parse(post.publishedAt))
    && (post.featured === undefined || typeof post.featured === 'boolean')
    && (post.cover === undefined || post.cover === null || typeof post.cover === 'string')
    && (post.coverAlt === undefined || typeof post.coverAlt === 'string')
    && typeof post.categoryId === 'string' && Array.isArray(post.tags)
    && post.tags.every((tag) => typeof tag === 'string') && Array.isArray(post.categoryPath)
    && post.leafCategory && typeof post.leafCategory.label === 'string' && typeof post.leafCategory.path === 'string'
    && typeof post.searchText === 'string');
}
function tagNodes(posts: DiscoveryPost[]): TagNode[] {
  const counts = new Map<string, number>();
  for (const post of posts) for (const raw of post.tags) {
    const label = raw.normalize('NFC').trim(); if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const groups = new Map<string, string[]>();
  for (const label of counts.keys()) { const base = slugifyLabel(label); groups.set(base, [...(groups.get(base) ?? []), label]); }
  const suffix = (label: string) => btoa(String.fromCharCode(...new TextEncoder().encode(label))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  return [...counts].map(([label, count]) => {
    const base = slugifyLabel(label);
    return { label, count, slug: `${base}${(groups.get(base)?.length ?? 0) > 1 ? `--${suffix(label)}` : ''}` };
  }).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}
function card(post: DiscoveryPost) {
  return `<article class="post-card"><div class="post-card__body"><p class="post-card__meta"><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.date)}</time><span>${escapeHtml(post.leafCategory.label)}</span></p><h2><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a></h2><a class="post-card__more" href="${escapeHtml(post.path)}">읽기 <span aria-hidden="true">→</span></a></div></article>`;
}
function pagination(base: string, page: number, pages: number) {
  if (pages <= 1) return '';
  const path = (value: number) => value === 1 ? base : `${base}/page/${value}`;
  return `<nav class="pagination" aria-label="페이지 이동">${page > 1 ? `<a rel="prev" href="${escapeHtml(path(page - 1))}">이전</a>` : '<span></span>'}<span>${page} / ${pages}</span>${page < pages ? `<a rel="next" href="${escapeHtml(path(page + 1))}">다음</a>` : '<span></span>'}</nav>`;
}
function listingMain(kind: 'Category' | 'Tag', label: string, posts: DiscoveryPost[], base: string, page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(posts.length / pageSize)); if (page > pages) return null;
  const items = posts.slice((page - 1) * pageSize, page * pageSize);
  return `<header class="page-header"><div class="shell"><p class="eyebrow">${kind} · ${posts.length}편</p><h1>${kind === 'Tag' ? '#' : ''}${escapeHtml(label)}</h1>${page > 1 ? `<p>${page} / ${pages}쪽</p>` : ''}</div></header><section class="section"><div class="shell posts-grid">${items.map(card).join('')}</div><div class="shell">${pagination(base, page, pages)}</div></section>`;
}
function archiveMain(posts: DiscoveryPost[]) {
  const groups = new Map<string, DiscoveryPost[]>();
  for (const post of posts) { const year = post.publishedAt.slice(0, 4); groups.set(year, [...(groups.get(year) ?? []), post]); }
  return `<header class="page-header"><div class="shell"><p class="eyebrow">Archive · ${posts.length}편</p><h1>모든 글</h1></div></header><section class="section"><div class="shell archive-list">${[...groups].map(([year, items]) => `<section class="archive-year"><h2>${year}</h2><ul>${items.map((post) => `<li><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.date.slice(5))}</time><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a><small>${escapeHtml(post.leafCategory.label)}</small></li>`).join('')}</ul></section>`).join('')}</div></section>`;
}
function homeMain(posts: DiscoveryPost[]) {
  const featured = posts.find((post) => post.featured) ?? posts.find((post) => post.cover) ?? posts[0];
  const latest = posts.filter((post) => post.path !== featured.path).slice(0, 7); const roots = TAXONOMY.filter((node) => node.parentId === null);
  const cover = featured.cover ? `<a class="home-feature__image" href="${escapeHtml(featured.path)}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(featured.cover)}" alt="${escapeHtml(featured.coverAlt ?? '')}" decoding="async" fetchpriority="high"></a>` : '';
  return `<section class="home-journal" aria-labelledby="featured-title"><article class="home-feature">${cover}<div class="home-feature__copy"><p class="home-feature__meta"><time datetime="${escapeHtml(featured.publishedAt)}">${escapeHtml(featured.date)}</time><span>${escapeHtml(featured.leafCategory.label)}</span></p><h1 id="featured-title"><a href="${escapeHtml(featured.path)}">${escapeHtml(featured.title)}</a></h1><a class="text-link" href="${escapeHtml(featured.path)}">이 글 읽기 <span aria-hidden="true">↗</span></a></div></article><aside class="home-index" aria-label="최근 글"><div class="home-index__heading"><div><p>${posts.at(-1)?.publishedAt.slice(0, 4) ?? ''}—${new Date().getUTCFullYear()}</p><h2>최근 글</h2></div><button type="button" data-search-open>찾기</button></div><ol>${latest.map((post) => `<li><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.date)}</time></li>`).join('')}</ol><a class="text-link" href="/archive">모든 글 보기 <span aria-hidden="true">↗</span></a></aside></section><section class="home-categories"><header><p class="eyebrow">Subjects</p><h2>갈래별로 읽기</h2></header><div class="home-category-list">${roots.map((category, index) => { const accepted = new Set([category.id, ...taxonomyDescendants(category.id).map((item) => item.id)]); return `<a href="/category/${encodeURIComponent(category.slug)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(category.label)}</strong><small>${posts.filter((post) => accepted.has(post.categoryId)).length}편</small></a>`; }).join('')}</div></section>`;
}
function tagsMain(tags: TagNode[]) {
  return `<header class="page-header tag-index-header"><div class="shell"><p class="eyebrow">Index · ${tags.length}</p><h1>태그</h1></div></header><section class="section tag-index-section"><div class="shell tag-index"><label for="tag-filter">태그 찾기</label><input id="tag-filter" type="search" placeholder="태그 이름을 입력하세요" autocomplete="off" data-tag-filter><p class="tag-index__status" data-tag-status aria-live="polite">전체 ${tags.length}개</p><ol data-tag-list>${tags.map((tag) => `<li data-tag-item data-tag-label="${escapeHtml(tag.label.toLocaleLowerCase('ko-KR'))}"><a href="/tag/${encodeURIComponent(tag.slug)}"><strong>#${escapeHtml(tag.label)}</strong><small>${tag.count}편</small></a></li>`).join('')}</ol></div></section>`;
}
function categoryIndexMain(posts: DiscoveryPost[]) {
  return `<header class="page-header"><div class="shell"><p class="eyebrow">Categories</p><h1>갈래</h1></div></header><section class="section"><div class="shell home-category-list">${TAXONOMY.map((category) => { const accepted = new Set([category.id, ...taxonomyDescendants(category.id).map((item) => item.id)]); return `<a href="/category/${encodeURIComponent(category.slug)}"><strong>${escapeHtml(category.label)}</strong><small>${posts.filter((post) => accepted.has(post.categoryId)).length}편</small></a>`; }).join('')}</div></section>`;
}
async function rewriteDocument(response: Response, main: string, title: string, description: string, canonical: string, article = false) {
  const rewriter = new HTMLRewriter()
    .on('title', { element(element) { element.setInnerContent(title); } })
    .on('meta[name="description"]', { element(element) { element.setAttribute('content', description); } })
    .on('link[rel="canonical"]', { element(element) { element.setAttribute('href', canonical); } })
    .on('meta[property="og:title"]', { element(element) { element.setAttribute('content', title); } })
    .on('meta[property="og:description"]', { element(element) { element.setAttribute('content', description); } })
    .on('meta[property="og:url"]', { element(element) { element.setAttribute('content', canonical); } })
    .on('#main', { element(element) { element.setInnerContent(main, { html: true }); } });
  if (article) rewriter.on('meta[property="og:type"]', { element(element) { element.setAttribute('content', 'article'); } });
  return Promise.resolve(rewriter.transform(response));
}
async function shell(staticHandler: StaticHandler, request: Request, env: NativePublicEnvironment, context: ExecutionContext) {
  return staticHandler(new Request(new URL('/about', request.url), { method: 'GET', headers: request.headers }), env, context);
}
async function pageShell(staticHandler: StaticHandler, request: Request, env: NativePublicEnvironment, context: ExecutionContext) {
  const response = await staticHandler(new Request(request, { method: 'GET' }), env, context);
  if (response.ok && response.headers.get('content-type')?.toLowerCase().startsWith('text/html')) return response;
  if (response.status !== 404) return response;
  try { await response.body?.cancel(); } catch {}
  return shell(staticHandler, request, env, context);
}
async function combinedPosts(staticHandler: StaticHandler, request: Request, env: NativePublicEnvironment, context: ExecutionContext, store: NativePostStore) {
  const response = await staticHandler(new Request(new URL('/search-index.json', request.url), { method: 'GET' }), env, context);
  if (!response.ok) throw new Error('NATIVE_E_DISCOVERY');
  const legacy = await response.json() as unknown;
  if (!Array.isArray(legacy) || !legacy.every(validDiscovery)) throw new Error('NATIVE_E_DISCOVERY');
  const dynamic = new Map((await store.listPublished()).map((post) => [`/posts/${post.globalSequence}`, post]));
  const merged = legacy.map((staticPost) => {
    const post = dynamic.get(staticPost.path);
    if (!post) return staticPost;
    dynamic.delete(staticPost.path);
    return { ...staticPost, ...nativeDiscovery(post), featured: staticPost.featured,
      cover: staticPost.cover, coverAlt: staticPost.coverAlt };
  });
  return [...merged, ...[...dynamic.values()].map(nativeDiscovery)].sort(comparePosts);
}
async function postDocument(response: Response, post: NativePost, canonical: string, tags: TagNode[]) {
  const title = `${post.title} — dwnc.me`; const description = post.description || post.bodyText.slice(0, 160);
  const tagLinks = post.tags.map((raw) => {
    const label = raw.normalize('NFC').trim(); const tag = tags.find((item) => item.label === label);
    return tag ? `<a rel="tag" href="/tag/${encodeURIComponent(tag.slug)}">#${escapeHtml(label)}</a>` : '';
  }).join('');
  const main = `<article class="article-page article-page--longform" data-category-id="${escapeHtml(post.categoryId)}"><header class="post-header"><div class="post-header__inner"><p class="post-header__kicker">${escapeHtml(post.categoryLabel)}</p><p class="post-header__meta"><a href="/category/${encodeURIComponent(post.categorySlug)}">${escapeHtml(post.categoryLabel)}</a><time datetime="${escapeHtml(post.publishedAt ?? '')}">${dateLabel(post.publishedAt ?? post.updatedAt)}</time></p><h1>${escapeHtml(post.title)}</h1></div></header><div class="prose">${post.bodyHtml}</div><footer class="post-footer"><div class="post-footer__inner"><div class="post-tags"><a href="/category/${encodeURIComponent(post.categorySlug)}">${escapeHtml(post.categoryLabel)}</a>${tagLinks}</div></div></footer></article>`;
  return await rewriteDocument(response, main, title, description, canonical, true);
}
async function dynamicMedia(
  request: Request,
  env: NativeMediaEnvironment,
  store: NativePostStore,
  audience: 'public' | 'admin' = 'public',
) {
  if (!['GET', 'HEAD'].includes(request.method)) return withVersion(new Response('Method not allowed.\n', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } }), env);
  const media = audience === 'admin'
    ? await store.getAdminMedia(new URL(request.url).pathname)
    : await store.getPublicMedia(new URL(request.url).pathname);
  if (!media) return withVersion(unavailable(request.method), env);
  const object = request.method === 'HEAD' ? await env.NATIVE_MEDIA_BUCKET.head(media.objectKey) : await env.NATIVE_MEDIA_BUCKET.get(media.objectKey);
  if (!object || object.size !== media.bytes || object.httpMetadata?.contentType?.toLowerCase() !== media.mime
    || object.customMetadata?.contract !== 'dwnc-native-media-v1' || object.customMetadata?.sha256 !== media.sha256
    || !SHA256_PATTERN.test(media.sha256) || !(object.checksums?.sha256 instanceof ArrayBuffer)
    || bytesToHex(object.checksums.sha256) !== media.sha256) return withVersion(unavailable(request.method), env);
  const headers = new Headers({ 'content-type': media.mime, 'content-length': String(media.bytes), 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', etag: object.httpEtag });
  return withVersion(new Response(request.method === 'HEAD' ? null : (object as R2ObjectBody).body, { headers }), env);
}

export function serveAdminNativeMedia(request: Request, env: NativeMediaEnvironment) {
  return dynamicMedia(request, env, new NativePostStore(env.NATIVE_DB), 'admin');
}

export function createNativePublicWorker(staticHandler: StaticHandler) {
  const handle = async (request: Request, env: NativePublicEnvironment, context: ExecutionContext): Promise<Response> => {
    const url = new URL(request.url); const store = new NativePostStore(env.NATIVE_DB);
    if (NATIVE_MEDIA_PATH_PATTERN.test(url.pathname)) return dynamicMedia(request, env, store);
    const postMatch = url.pathname.match(/^\/posts\/(\d+)$/u);
    const aggregate = url.pathname === '/' || url.pathname === '/archive' || url.pathname === '/category'
      || url.pathname === '/tags' || url.pathname === '/search-index.json' || url.pathname === '/rss.xml'
      || url.pathname === '/sitemap-0.xml' || /^\/(?:category|tag)\/[^/]+(?:\/page\/[1-9]\d*)?$/u.test(url.pathname);
    if (request.method === 'HEAD' && (aggregate || postMatch)) {
      const response = await handle(new Request(request, { method: 'GET' }), env, context);
      try { await response.body?.cancel(); } catch {}
      return headOf(response);
    }
    if (postMatch) {
      if (request.method !== 'GET') return withVersion(new Response('Method not allowed.\n', { status: 405, headers: { allow: 'GET, HEAD' } }), env);
      const post = await store.getPublishedBySequence(Number(postMatch[1]));
      if (!post) return Number(postMatch[1]) >= 597
        ? withVersion(unavailable(), env) : staticHandler(request, env, context);
      const base = await pageShell(staticHandler, request, env, context);
      let tags: TagNode[] = [];
      try { tags = tagNodes(await combinedPosts(staticHandler, request, env, context, store)); } catch {}
      const response = await postDocument(base, post, `https://dwnc.me/posts/${post.globalSequence}`, tags);
      const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
      return withVersion(new Response(response.body, { status: 200, headers }), env);
    }
    if (!aggregate || request.method !== 'GET' || (url.search && url.pathname !== '/search-index.json')) return staticHandler(request, env, context);
    let posts: DiscoveryPost[];
    try { posts = await combinedPosts(staticHandler, request, env, context, store); }
    catch { return staticHandler(request, env, context); }
    if (url.pathname === '/search-index.json') {
      return withVersion(new Response(JSON.stringify(posts), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }), env);
    }
    if (url.pathname === '/rss.xml') {
      const original = await staticHandler(request, env, context); let body = await original.text();
      const items = posts.map((post) => `<item><title>${xmlEscape(post.title)}</title><description>${xmlEscape(post.description)}</description><link>https://dwnc.me${xmlEscape(post.path)}</link><guid isPermaLink="true">https://dwnc.me${xmlEscape(post.path)}</guid><pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate><category>${xmlEscape(post.leafCategory.label)}</category></item>`).join('');
      body = body.replace(/<item>[\s\S]*<\/item>/gu, '').replace('</channel>', `${items}</channel>`);
      const headers = new Headers(original.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
      return withVersion(new Response(body, { status: original.status, headers }), env);
    }
    if (url.pathname === '/sitemap-0.xml') {
      const original = await staticHandler(request, env, context); let body = await original.text();
      const native = posts.filter((post) => sequenceOf(post.path) >= 597).map((post) => `<url><loc>https://dwnc.me${xmlEscape(post.path)}</loc><lastmod>${xmlEscape(post.publishedAt)}</lastmod></url>`).join('');
      body = body.replace('</urlset>', `${native}</urlset>`);
      const headers = new Headers(original.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
      return withVersion(new Response(body, { status: original.status, headers }), env);
    }
    const base = await pageShell(staticHandler, request, env, context); let main = ''; let title = 'dwnc.me'; let description = 'dwnc.me'; let canonical = `https://dwnc.me${url.pathname}`;
    if (!base.ok || !base.headers.get('content-type')?.toLowerCase().startsWith('text/html')) return withVersion(base, env);
    if (url.pathname === '/') { main = homeMain(posts); description = '자동차와 수영, 생활의 발견과 생각을 기록하는 개인 블로그.'; canonical = 'https://dwnc.me/'; }
    else if (url.pathname === '/archive') { main = archiveMain(posts); title = '모든 글 — dwnc.me'; description = `대왕날치의 전체 기록 ${posts.length}편`; }
    else if (url.pathname === '/category') { main = categoryIndexMain(posts); title = '갈래 — dwnc.me'; description = 'dwnc.me 글 갈래'; }
    else if (url.pathname === '/tags') { const tags = tagNodes(posts); main = tagsMain(tags); title = '태그 — dwnc.me'; description = `dwnc.me의 태그 ${tags.length}개`; }
    else {
      const match = url.pathname.match(/^\/(category|tag)\/([^/]+)(?:\/page\/([1-9]\d*))?$/u)!;
      let slug: string; try { slug = decodeURIComponent(match[2]).normalize('NFC'); } catch { return withVersion(unavailable(), env); }
      const page = Number(match[3] ?? 1);
      if (match[1] === 'category') {
        const category = taxonomyNodeBySlug(slug); if (!category) return withVersion(unavailable(), env);
        const accepted = new Set([category.id, ...taxonomyDescendants(category.id).map((item) => item.id)]);
        const filtered = posts.filter((post) => accepted.has(post.categoryId));
        main = listingMain('Category', category.label, filtered, `/category/${category.slug}`, page, CATEGORY_PAGE_SIZE) ?? '';
        title = `${category.label}${page > 1 ? ` ${page}쪽` : ''} — dwnc.me`; description = `${category.label} 갈래의 글 ${filtered.length}편`;
      } else {
        const tag = tagNodes(posts).find((item) => item.slug === slug); if (!tag) return withVersion(unavailable(), env);
        const label = tag.label.normalize('NFC').trim(); const filtered = posts.filter((post) => post.tags.some((item) => item.normalize('NFC').trim() === label));
        main = listingMain('Tag', tag.label, filtered, `/tag/${tag.slug}`, page, TAG_PAGE_SIZE) ?? '';
        title = `#${tag.label}${page > 1 ? ` ${page}쪽` : ''} — dwnc.me`; description = `${tag.label} 태그의 글 ${filtered.length}편`;
      }
      if (!main) return withVersion(unavailable(), env);
    }
    const response = await rewriteDocument(base, main, title, description, canonical);
    const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
    return withVersion(new Response(response.body, { status: 200, headers }), env);
  };
  return handle;
}
