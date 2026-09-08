import { eligiblePostView, PostViewStatistics } from './post-view-statistics.ts';
import { ContentOperations, boundedBody } from './content-operations.ts';
import edgeRedirects from '../../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import { SITE_MEDIA_PATH_PATTERN } from './cms-configuration.ts';
import { prepareImportedPresentation, IMPORTED_PRESENTATION_CSS, ENGINE_DIAGRAM_CSS, ENGINE_DIAGRAM_BOOTSTRAP } from './imported-presentation.ts';
import { escapeHtml, NATIVE_MEDIA_PATH_PATTERN } from './native-content.ts';
import { CmsConfigurationStore, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, categoryDescendants, categoryLineage, type CmsCategory, type CmsSettings } from './cms-configuration.ts';
import publicSequence from '../data/public-sequence-v1.json' with { type: 'json' };
import { NativePostStore, snapshotVisible, type NativePost } from './native-post-store.ts';
import {
  CATEGORY_PAGE_SIZE, TAG_PAGE_SIZE, TAXONOMY, slugifyLabel,
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
  kind?: 'post' | 'notice';
  title: string; description: string; path: string; date: string; publishedAt: string;
  updatedAt?: string; featured?: boolean; cover?: string | null; coverAlt?: string;
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
function dateLabel(iso: string, timezone = 'Asia/Seoul') { if (!iso || !Number.isFinite(Date.parse(iso))) return ''; return new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)).replaceAll('-','.'); }
function sequenceOf(path: string) { return Number(path.match(/^\/posts\/(\d+)$/u)?.[1] ?? 0); }
function comparePosts(left: DiscoveryPost, right: DiscoveryPost) {
  return right.publishedAt.localeCompare(left.publishedAt) || sequenceOf(right.path) - sequenceOf(left.path);
}
function nativeDiscovery(post: NativePost, categories: CmsCategory[] = DEFAULT_CATEGORIES): DiscoveryPost {
  const publishedAt = post.publishedAt ?? post.updatedAt;
  const lineage = categoryLineage(post.categoryId, categories); const category = lineage.at(-1) ?? {label:post.categoryLabel,slug:post.categorySlug};
  return {
    kind: post.kind === 'notice' ? 'notice' : 'post', title: post.title, description: post.description || post.bodyText.slice(0, 160),
    path: `/posts/${post.globalSequence}`, date: dateLabel(publishedAt), publishedAt,
    updatedAt: post.updatedAt, featured: false, cover: post.coverPath, coverAlt: post.coverAlt,
    categoryId: post.categoryId, categories: [category.label], tags: [...post.tags],
    categoryPath: lineage.map((node) => node.label), leafCategory: { label: category.label, path: `/category/${category.slug}` },
    searchText: [post.title, post.description, ...lineage.map((node) => node.label), ...TAXONOMY.filter((node)=>lineage.some((entry)=>entry.id===node.id)).flatMap((node)=>node.legacyMatchers.map((matcher)=>matcher.value)), ...post.tags, post.bodyText].join(' ').toLocaleLowerCase('ko-KR'),
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
  return `<article class="post-card">${post.cover ? `<a class="post-card__image" href="${escapeHtml(post.path)}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(post.cover)}" alt="${escapeHtml(post.coverAlt ?? '')}" loading="lazy" decoding="async"></a>` : ''}<div class="post-card__body"><p class="post-card__meta"><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.date)}</time><span>${escapeHtml(post.leafCategory.label)}</span></p><h2><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a></h2><a class="post-card__more" href="${escapeHtml(post.path)}">읽기 <span aria-hidden="true">→</span></a></div></article>`;
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
function homeMain(posts: DiscoveryPost[], categories: CmsCategory[]) {
  if (!posts.length) return '<section class="section shell"><h1>아직 공개된 글이 없습니다.</h1></section>';
  const featured = posts.find((post) => post.featured) ?? posts.find((post) => post.cover) ?? posts[0];
  const latest = posts.filter((post) => post.path !== featured.path).slice(0, 7); const roots = categories.filter((node) => node.parentId === null);
  const cover = featured.cover ? `<a class="home-feature__image" href="${escapeHtml(featured.path)}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(featured.cover)}" alt="${escapeHtml(featured.coverAlt ?? '')}" decoding="async" fetchpriority="high"></a>` : '';
  return `${posts.some(post=>post.kind==='notice')?`<section class="shell notices" aria-label="공지"><h2>공지</h2><ul>${posts.filter(post=>post.kind==='notice').map(post=>`<li><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a></li>`).join('')}</ul></section>`:''}<section class="home-journal" aria-labelledby="featured-title"><article class="home-feature">${cover}<div class="home-feature__copy"><p class="home-feature__meta"><time datetime="${escapeHtml(featured.publishedAt)}">${escapeHtml(featured.date)}</time><span>${escapeHtml(featured.leafCategory.label)}</span></p><h1 id="featured-title"><a href="${escapeHtml(featured.path)}">${escapeHtml(featured.title)}</a></h1><a class="text-link" href="${escapeHtml(featured.path)}">이 글 읽기 <span aria-hidden="true">↗</span></a></div></article><aside class="home-index" aria-label="최근 글"><div class="home-index__heading"><div><p>${posts.at(-1)?.publishedAt.slice(0, 4) ?? ''}—${new Date().getUTCFullYear()}</p><h2>최근 글</h2></div><button type="button" data-search-open>찾기</button></div><ol>${latest.map((post) => `<li><a href="${escapeHtml(post.path)}">${escapeHtml(post.title)}</a><time datetime="${escapeHtml(post.publishedAt)}">${escapeHtml(post.date)}</time></li>`).join('')}</ol><a class="text-link" href="/archive">모든 글 보기 <span aria-hidden="true">↗</span></a></aside></section><section class="home-categories"><header><p class="eyebrow">Subjects</p><h2>갈래별로 읽기</h2></header><div class="home-category-list">${roots.map((category, index) => { const accepted = new Set([category.id, ...categoryDescendants(category.id, categories).map((item) => item.id)]); return `<a href="/category/${encodeURIComponent(category.slug)}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(category.label)}</strong><small>${posts.filter((post) => accepted.has(post.categoryId)).length}편</small></a>`; }).join('')}</div></section>`;
}
function tagsMain(tags: TagNode[]) {
  return `<header class="page-header tag-index-header"><div class="shell"><p class="eyebrow">Index · ${tags.length}</p><h1>태그</h1></div></header><section class="section tag-index-section"><div class="shell tag-index"><label for="tag-filter">태그 찾기</label><input id="tag-filter" type="search" placeholder="태그 이름을 입력하세요" autocomplete="off" data-tag-filter><p class="tag-index__status" data-tag-status aria-live="polite">전체 ${tags.length}개</p><ol data-tag-list>${tags.map((tag) => `<li data-tag-item data-tag-label="${escapeHtml(tag.label.toLocaleLowerCase('ko-KR'))}"><a href="/tag/${encodeURIComponent(tag.slug)}"><strong>#${escapeHtml(tag.label)}</strong><small>${tag.count}편</small></a></li>`).join('')}</ol></div></section>`;
}
function categoryIndexMain(posts: DiscoveryPost[], categories: CmsCategory[]) {
  return `<header class="page-header"><div class="shell"><p class="eyebrow">Categories</p><h1>갈래</h1></div></header><section class="section"><div class="shell home-category-list">${categories.filter((node)=>!node.parentId).flatMap((node)=>[node,...categoryDescendants(node.id,categories)]).map((category) => { const accepted = new Set([category.id, ...categoryDescendants(category.id, categories).map((item) => item.id)]); return `<a href="/category/${encodeURIComponent(category.slug)}"><strong>${escapeHtml(category.label)}</strong><small>${posts.filter((post) => accepted.has(post.categoryId)).length}편</small></a>`; }).join('')}</div></section>`;
}
function categoryTree(categories: CmsCategory[], current?: string) {
  const branch = (node: CmsCategory): string => {
    const children = categoryDescendants(node.id,categories); const active = node.id === current; const expanded = active || children.some((item) => item.id === current);
    return `<li class="category-branch${active?' is-current':''}" data-category-id="${escapeHtml(node.id)}"><div class="category-branch__row"><a href="/category/${encodeURIComponent(node.slug)}"${active?' aria-current="page"':''}>${escapeHtml(node.label)}</a>${children.length?`<button type="button" data-category-branch-toggle aria-controls="category-branch-${escapeHtml(node.id)}" aria-expanded="${expanded}"><span aria-hidden="true">${expanded?'−':'+'}</span><span class="visually-hidden">${escapeHtml(node.label)} 하위 갈래</span></button>`:''}</div>${children.length?`<ul id="category-branch-${escapeHtml(node.id)}"${expanded?'':' hidden'}>${children.map(branch).join('')}</ul>`:''}</li>`;
  };
  return `<ul class="category-tree">${categories.filter((node)=>!node.parentId).map(branch).join('')}</ul>`;
}
async function rewriteDocument(response: Response, main: string | null, title: string, description: string, canonical: string,
  article = false, settings: CmsSettings = DEFAULT_SETTINGS, categories: CmsCategory[] = DEFAULT_CATEGORIES, post?: NativePost, socialCover?: string | null) {
  const coverPath=post?.coverPath??socialCover; const image = coverPath ? `https://dwnc.me${coverPath}` : null;
  const rewriter = new HTMLRewriter()
    .on('title', { element(element) { element.setInnerContent(title); } })
    .on('meta[name="description"], meta[property="og:description"]', { element(element) { element.setAttribute('content', description); } })
    .on('link[rel="canonical"]', { element(element) { element.setAttribute('href', canonical); } })
    .on('meta[property="og:title"]', { element(element) { element.setAttribute('content', title); } })
    .on('meta[property="og:url"]', { element(element) { element.setAttribute('content', canonical); } })
    .on('meta[property="og:site_name"]', { element(element) { element.setAttribute('content', settings.title); } })
    .on('meta[property="og:type"]', { element(element) { element.setAttribute('content',article?'article':'website'); } })
    .on('meta[property="og:image"], meta[name="twitter:image"], script[type="application/ld+json"]', { element(element) { element.remove(); } })
    .on('meta[name="twitter:card"]', { element(element) { element.setAttribute('content',image?'summary_large_image':'summary'); } })
    .on('.site-header__note', {element(element){element.setInnerContent(settings.author);}})
    .on('.site-footer__links > span', {element(element){element.setInnerContent(`© ${new Date().getUTCFullYear()} ${settings.title}`);}})
    .on('.site-footer__inner > p > a', {element(element){element.setInnerContent(settings.title);}})
    .on('.site-footer__inner > p > span', {element(element){element.setInnerContent(settings.description);}})
    .on('.brand', { element(element) { element.setInnerContent(settings.title); element.setAttribute('aria-label',`${settings.title} 홈`); } })
    .on('.site-nav', { element(element) { element.setInnerContent(settings.menu.map((item)=>`<a href="${escapeHtml(item.path)}"${new URL(item.path,canonical).pathname===new URL(canonical).pathname?' aria-current="page"':''}>${escapeHtml(item.label)}</a>`).join('') + '<button type="button" data-category-open aria-controls="category-drawer" aria-expanded="false" aria-haspopup="dialog" aria-label="전체 갈래 열기">갈래 +</button><button class="search-trigger" type="button" data-search-open aria-label="글 검색 열기">찾기</button>',{html:true}); } })
    .on('#category-drawer nav', { element(element) { element.setInnerContent(categoryTree(categories,post?.categoryId),{html:true}); } })
    .on('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]', {element(element){if(settings.iconPath)element.setAttribute('href',settings.iconPath);}})
    .on('head', { element(element) {
      if(settings.iconPath)element.append(`<link rel="icon" href="${escapeHtml(settings.iconPath)}">`,{html:true});
      element.append(`<meta name="author" content="${escapeHtml(settings.author)}">${image?`<meta property="og:image" content="${escapeHtml(image)}"><meta name="twitter:image" content="${escapeHtml(image)}">`:''}${!settings.paragraphSpacing?'<style>.prose p{margin-block:0}</style>':''}`,{html:true});
      if (post) {
        const schema = { '@context':'https://schema.org','@type':'BlogPosting',headline:post.title,description,url:canonical,datePublished:post.publishedAt,dateModified:post.updatedAt,author:{'@type':'Person',name:settings.author},...(image?{image}: {}) };
        element.append(`<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<','\\u003c')}</script>`,{html:true});
      }
    } });
  if (main !== null) rewriter.on('#main',{element(element){element.setInnerContent(main,{html:true});}});
  return rewriter.transform(response);
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
async function combinedPosts(staticHandler: StaticHandler, request: Request, env: NativePublicEnvironment, context: ExecutionContext, store: NativePostStore, categories: CmsCategory[], includeSearchText = false) {
  const published = (await store.listPublished(includeSearchText)).filter(post=>post.kind!=='page');
  const managed = await store.managedSequences();
  const dynamic = new Map(published.map((post) => [`/posts/${post.globalSequence}`, post]));
  // A complete imported database already holds all public metadata. Do not
  // fetch the large static search index on every page or list request.
  let legacy: DiscoveryPost[] = [];
  const baselineCount = publicSequence.length;
  if (published.filter((post)=>post.sourceKind==='legacy').length < baselineCount) {
    const response = await staticHandler(new Request(new URL('/search-index.json',request.url),{method:'GET'}),env,context);
    if (!response.ok) throw new Error('NATIVE_E_DISCOVERY');
    const value: unknown = await response.json(); if (!Array.isArray(value) || !value.every(validDiscovery)) throw new Error('NATIVE_E_DISCOVERY'); legacy = value;
  }
  const merged = legacy.filter(staticPost=>!managed.has(sequenceOf(staticPost.path)) || dynamic.has(staticPost.path)).map((staticPost) => {
    const post = dynamic.get(staticPost.path); if (!post) {
      const lineage = categoryLineage(staticPost.categoryId,categories), leaf=lineage.at(-1);
      return leaf ? {...staticPost,categoryPath:lineage.map((node)=>node.label),leafCategory:{label:leaf.label,path:`/category/${leaf.slug}`}} : staticPost;
    }
    dynamic.delete(staticPost.path); return {...staticPost,...nativeDiscovery(post,categories),featured:staticPost.featured};
  });
  return [...merged,...[...dynamic.values()].map((post)=>nativeDiscovery(post,categories))].sort(comparePosts);
}
async function postDocument(response: Response, post: NativePost, canonical: string, posts: DiscoveryPost[], settings: CmsSettings, categories: CmsCategory[]) {
  const title = `${post.title} — ${settings.title}`, description = post.description || post.bodyText.slice(0,160);
  const lineage = categoryLineage(post.categoryId,categories), category = lineage.at(-1) ?? {label:post.categoryLabel,slug:post.categorySlug};
  const tags=tagNodes(posts); const tagLinks=post.tags.map((label)=>{const tag=tags.find((item)=>item.label===label.normalize('NFC').trim());return tag?`<a rel="tag" href="/tag/${encodeURIComponent(tag.slug)}">#${escapeHtml(label)}</a>`:'';}).join('');
  const breadcrumb=`<nav class="breadcrumbs" aria-label="현재 위치"><ol><li><a href="/category">갈래</a></li>${lineage.map((node)=>`<li><a href="/category/${encodeURIComponent(node.slug)}">${escapeHtml(node.label)}</a></li>`).join('')}<li><span aria-current="page">${escapeHtml(post.title)}</span></li></ol></nav>`;
  const index=posts.findIndex((item)=>item.path===new URL(canonical).pathname), previous=posts[index+1], next=index>0?posts[index-1]:null;
  const related=posts.filter((item)=>item.categoryId===post.categoryId&&item.path!==new URL(canonical).pathname).sort((a,b)=>Math.abs(Date.parse(a.publishedAt)-Date.parse(post.publishedAt!))-Math.abs(Date.parse(b.publishedAt)-Date.parse(post.publishedAt!))).slice(0,5);
  const neighbor=(item:DiscoveryPost|null|undefined,rel:string,label:string)=>item?`<a rel="${rel}" href="${escapeHtml(item.path)}"><span>${label}</span><strong>${escapeHtml(item.title)}</strong><time datetime="${escapeHtml(item.publishedAt)}">${item.date}</time></a>`:'<span></span>';
  const bodyHtml=prepareImportedPresentation(post.bodyHtml,post.source&&post.sourceId?{source:post.source,sourceId:post.sourceId}:undefined);
  const presentation=`<style>${IMPORTED_PRESENTATION_CSS}${bodyHtml.includes('data-engine-diagram')?ENGINE_DIAGRAM_CSS:''}</style>${bodyHtml.includes('data-engine-diagram')?`<script>${ENGINE_DIAGRAM_BOOTSTRAP}</script>`:''}`;
  const images=(post.bodyHtml.match(/<img\b/giu)??[]).length;const photo=images>=8||(images>=4&&post.bodyText.length/images<400)||(images>=1&&images<=3&&post.bodyText.length<120);
  const cover=post.coverPath&&!post.bodyHtml.includes(post.coverPath)?`<img class="post-cover" src="${escapeHtml(post.coverPath)}" alt="${escapeHtml(post.coverAlt)}" decoding="async">`:'';
  const main=`<article class="article-page article-page--${photo?'photo':'longform'}" data-category-id="${escapeHtml(post.categoryId)}"><header class="post-header"><div class="post-header__inner">${breadcrumb}<p class="post-header__kicker">${escapeHtml(category.label)}</p><p class="post-header__meta"><a href="/category/${encodeURIComponent(category.slug)}">${escapeHtml(category.label)}</a><time datetime="${escapeHtml(post.publishedAt??'')}">${dateLabel(post.publishedAt??post.updatedAt,settings.timezone)}</time></p><h1>${escapeHtml(post.title)}</h1></div></header>${cover}<div class="prose">${bodyHtml}</div>${settings.ccl!=='none'?`<p class="shell post-license"><a rel="license" href="https://creativecommons.org/licenses/${settings.ccl}/4.0/">CC ${settings.ccl.toUpperCase()} 4.0</a></p>`:''}${presentation}<footer class="post-footer"><div class="post-footer__inner"><div class="post-tags"><a href="/category/${encodeURIComponent(category.slug)}">${escapeHtml(category.label)}</a>${tagLinks}</div>${related.length?`<section class="post-related" aria-labelledby="post-related-title"><h2 id="post-related-title">같은 갈래의 글</h2><ol>${related.map((item)=>`<li><a href="${escapeHtml(item.path)}">${escapeHtml(item.title)}</a><time datetime="${escapeHtml(item.publishedAt)}">${item.date}</time></li>`).join('')}</ol></section>`:''}<nav class="post-sequence" aria-label="시간순 글 이동">${neighbor(previous,'prev','이전 글')}${neighbor(next,'next','다음 글')}</nav></div></footer></article>`;
  return rewriteDocument(response,main,title,description,canonical,true,settings,categories,post);
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
    : await store.getPublicMedia(new URL(request.url).pathname,request);
  if (!media) return withVersion(unavailable(request.method), env);
  const object = request.method === 'HEAD' ? await env.NATIVE_MEDIA_BUCKET.head(media.objectKey) : await env.NATIVE_MEDIA_BUCKET.get(media.objectKey);
  if (!object || object.size !== media.bytes || object.httpMetadata?.contentType?.toLowerCase() !== media.mime
    || object.customMetadata?.contract !== 'dwnc-native-media-v1' || object.customMetadata?.sha256 !== media.sha256
    || !SHA256_PATTERN.test(media.sha256) || !(object.checksums?.sha256 instanceof ArrayBuffer)
    || bytesToHex(object.checksums.sha256) !== media.sha256) return withVersion(unavailable(request.method), env);
  const headers = new Headers({ 'content-type': media.mime, 'content-length': String(media.bytes), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', etag: object.httpEtag });
  return withVersion(new Response(request.method === 'HEAD' ? null : (object as R2ObjectBody).body, { headers }), env);
}

export function serveAdminNativeMedia(request: Request, env: NativeMediaEnvironment) {
  return dynamicMedia(request, env, new NativePostStore(env.NATIVE_DB), 'admin');
}

export async function serveSiteMedia(request: Request, env: NativeMediaEnvironment, admin = false) {
  if(!['GET','HEAD'].includes(request.method))return unavailable(request.method);
  const path=new URL(request.url).pathname;
  if(!admin && (await new CmsConfigurationStore(env.NATIVE_DB).settings()).value.iconPath!==path)return unavailable(request.method);
  const row=await env.NATIVE_DB.prepare('SELECT * FROM cms_media WHERE public_path=?1').bind(path).first<{object_key:string;mime:string;bytes:number;sha256:string}>();
  if(!row)return unavailable(request.method);
  const object=request.method==='HEAD'?await env.NATIVE_MEDIA_BUCKET.head(row.object_key):await env.NATIVE_MEDIA_BUCKET.get(row.object_key);
  if(!object || object.size!==row.bytes || object.httpMetadata?.contentType!==row.mime || object.customMetadata?.contract!=='dwnc-site-media-v1' || object.customMetadata?.sha256!==row.sha256 || !(object.checksums?.sha256 instanceof ArrayBuffer) || bytesToHex(object.checksums.sha256)!==row.sha256)return unavailable(request.method);
  return new Response(request.method==='HEAD'?null:(object as R2ObjectBody).body,{headers:{'content-type':row.mime,'content-length':String(row.bytes),'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
async function allowedImportedMedia(path: string, request: Request, env: NativePublicEnvironment) {
  const source=path.match(/^\/media\/(naver|tistory)\/([^/]+)\//u);
  if(!source)return false;
  // The indexed original owner is enough for ordinary public images. Only a
  // restricted owner requires checking whether another public snapshot shares it.
  const owner=await env.NATIVE_DB.prepare('SELECT id FROM legacy_posts WHERE import_complete=1 AND source=?1 AND source_id=?2').bind(source[1],source[2]).first<{id:string}>();
  if(!owner)return true; // Original public media whose owner is not yet imported.
  const ops=new ContentOperations(env.NATIVE_DB);
  if(await ops.authorized(owner.id,request))return true;
  // Working-copy-only references never authorize delivery.
  const rows=await env.NATIVE_DB.prepare(`SELECT id FROM legacy_posts WHERE import_complete=1 AND id!=?1 AND (instr(body_html,?2)>0 OR cover_path=?2)
    UNION SELECT id FROM native_posts WHERE status='published' AND (instr(body_html,?2)>0 OR cover_path=?2)`).bind(owner.id,path).all<{id:string}>();
  for(const row of rows.results??[])if(await ops.authorized(row.id,request))return true;
  return false;
}
function protectedPrompt(path: string, failed = false) {
 return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>보호 글</title><main><h1>보호 글</h1><p>비밀번호를 입력하면 이 글과 사진을 1시간 동안 볼 수 있습니다.</p>${failed?'<p role="alert">비밀번호를 확인하거나 잠시 후 다시 시도해 주세요.</p>':''}<form method="post" action="${escapeHtml(path)}"><label>비밀번호 <input name="password" type="password" maxlength="128" required autocomplete="current-password"></label><button type="submit">글 보기</button></form></main></html>`,{status:failed?403:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow','content-security-policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'}});
}

async function countedPostResponse(request: Request, post: Pick<NativePost,'id'|'status'|'visibility'|'scheduledAt'>,
  response: Response, env: NativePublicEnvironment, context: ExecutionContext, timezone: string, countViews: boolean) {
  if (countViews && env.DWNC_DEPLOYMENT_ENVIRONMENT !== 'staging' && eligiblePostView(request,post,response)) {
    const recording = new PostViewStatistics(env.NATIVE_DB).increment(post.id,timezone)
      .catch(() => { console.error(JSON.stringify({event:'dwnc_statistics_error',code:'STATS_W_WRITE'})); });
    if (typeof context.waitUntil === 'function') context.waitUntil(recording); else await recording;
  }
  return response;
}

export function createNativePublicWorker(staticHandler: StaticHandler) {
  const handle = async (request: Request, env: NativePublicEnvironment, context: ExecutionContext, countViews = true): Promise<Response> => {
    const originalRequest = request;
    const url = new URL(request.url); const store = new NativePostStore(env.NATIVE_DB);
    let normalized: string;try{normalized=decodeURIComponent(url.pathname).replace(/\/index\.html$/u,'').replace(/\/$/u,'')||'/';}catch{return unavailable(request.method);}
    if(normalized.includes('%')||normalized.includes('\\')||normalized.includes('//'))return unavailable(request.method);
    const alias=edgeRedirects.redirects.find(entry=>entry.from===normalized);
    const originalPath=url.pathname;
    const target=alias?.to??normalized;
    if(target!==url.pathname){url.pathname=target;request=new Request(url,request);}
    if(SITE_MEDIA_PATH_PATTERN.test(url.pathname))return serveSiteMedia(request,env);
    if(url.pathname.startsWith('/media/')&&!NATIVE_MEDIA_PATH_PATTERN.test(url.pathname)){
      if(!await allowedImportedMedia(url.pathname,request,env))return unavailable(request.method);
      const response=await staticHandler(request,env,context);const headers=new Headers(response.headers);headers.set('cache-control','no-store');return new Response(response.body,{status:response.status,headers});
    }
    if (NATIVE_MEDIA_PATH_PATTERN.test(url.pathname)) return dynamicMedia(request, env, store);
    const postMatch = url.pathname.match(/^\/posts\/(\d+)$/u);
    const pageMatch=url.pathname.match(/^\/pages\/([a-f0-9-]{36})$/u);
    const aggregate = url.pathname === '/about' || url.pathname === '/' || url.pathname === '/archive' || url.pathname === '/category'
      || url.pathname === '/tags' || url.pathname === '/search-index.json' || url.pathname === '/rss.xml'
      || url.pathname === '/sitemap-0.xml' || /^\/(?:category|tag)\/[^/]+(?:\/page\/[1-9]\d*)?$/u.test(url.pathname);
    if (request.method === 'HEAD' && (aggregate || postMatch || pageMatch)) {
      const response = await handle(new Request(originalRequest, { method: 'GET' }), env, context, false);
      try { await response.body?.cancel(); } catch {}
      return headOf(response);
    }
    if (!aggregate && !postMatch && !pageMatch) return staticHandler(request,env,context);
    if (url.search) {url.search='';request=new Request(url,request);}
    const config = new CmsConfigurationStore(env.NATIVE_DB);
    const [{value:categories},{value:settings}] = await Promise.all([config.categories(),config.settings()]);
    if (postMatch || pageMatch) {
      const raw = pageMatch ? await store.releasedPage(pageMatch[1]) : await store.getReleasedBySequence(Number(postMatch![1]));
      const ops = new ContentOperations(env.NATIVE_DB);
      if (raw && raw.visibility === 'protected' && !await ops.authorized(raw.id,request,true,raw.revision)) {
        if(request.method==='POST') {
          if(request.headers.get('origin')!==url.origin || !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded') || Number(request.headers.get('content-length')??0)>2048)return unavailable();
          let text:string;try{text=new TextDecoder().decode(await boundedBody(request,2048));}catch{return unavailable();}
          const cookie=await ops.unlock(raw.id,new URLSearchParams(text).get('password')??'',request);
          if(cookie)return new Response(null,{status:303,headers:{location:url.pathname,'set-cookie':cookie,'cache-control':'no-store'}});
          return protectedPrompt(url.pathname,true);
        }
        return protectedPrompt(url.pathname);
      }
      if (raw && raw.visibility!=='protected' && !snapshotVisible(raw))return unavailable();
      if (request.method !== 'GET') return withVersion(new Response('Method not allowed.\n', { status: 405, headers: { allow: 'GET, HEAD' } }), env);
      const post = raw;
      if (!post && alias && !(await store.managedSequences()).has(Number(postMatch![1])))return new Response(null,{status:308,headers:{location:alias.to,'cache-control':'no-store'}});
      if (!post) {
        const sequence=Number(postMatch?.[1]);
        if(pageMatch || sequence>=597 || (await store.managedSequences()).has(sequence))return withVersion(unavailable(),env);
        const fallback=await staticHandler(request,env,context);
        return publicSequence.some(entry=>entry.globalSequence===sequence)
          ? countedPostResponse(originalRequest,{id:`legacy-${sequence}`,status:'published',visibility:'public'},fallback,env,context,settings.timezone,countViews)
          : fallback;
      }
      if(post.kind==='page' && !pageMatch)return new Response(null,{status:308,headers:{location:post.publicPath!,'cache-control':'no-store'}});
      if(alias || originalPath!==url.pathname)return new Response(null,{status:308,headers:{location:url.pathname,'cache-control':'no-store'}});
      const base = await pageShell(staticHandler, request, env, context);
      if (!base.ok || !base.headers.get('content-type')?.toLowerCase().startsWith('text/html')) return withVersion(base,env);
      const posts = await combinedPosts(staticHandler, request, env, context, store,categories);
      const response = await postDocument(base, post, `https://dwnc.me${post.publicPath}`, posts,settings,categories);
      const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
      const delivered = withVersion(new Response(response.body, { status: 200, headers }), env);
      return countedPostResponse(originalRequest,post,delivered,env,context,settings.timezone,countViews);
    }
    if (!aggregate || request.method !== 'GET') return staticHandler(request, env, context);
    let posts: DiscoveryPost[];
    try { posts = await combinedPosts(staticHandler, request, env, context, store,categories,url.pathname === '/search-index.json'); }
    catch { return new Response('잠시 후 다시 시도해 주세요.',{status:503,headers:{'cache-control':'no-store'}}); }
    posts = posts.map(post=>({...post,date:dateLabel(post.publishedAt,settings.timezone)}));
    if (url.pathname === '/search-index.json') {
      return withVersion(new Response(JSON.stringify(posts), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }), env);
    }
    if (url.pathname === '/rss.xml') {
      const selected=posts.slice(0,settings.rssCount); const encoder=new TextEncoder(); let cursor=-1;
      const body=new ReadableStream<Uint8Array>({ async pull(controller) {
        if(cursor===-1){cursor=0;controller.enqueue(encoder.encode(`<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>${xmlEscape(settings.title)}</title><description>${xmlEscape(settings.description)}</description><link>https://dwnc.me/</link><language>ko</language>`));return;}
        if(cursor>=selected.length){controller.enqueue(encoder.encode('</channel></rss>'));controller.close();return;}
        const post=selected[cursor++];let description=post.description;
        if(settings.rssMode==='full'){const detail=await store.getPublishedBySequence(sequenceOf(post.path));if(detail)description=prepareImportedPresentation(detail.bodyHtml,detail.source&&detail.sourceId?{source:detail.source,sourceId:detail.sourceId}:undefined).replace(/(href|src)=(['"])\/(?!\/)/gu,'$1=$2https://dwnc.me/');}
        controller.enqueue(encoder.encode(`<item><title>${xmlEscape(post.title)}</title><description>${xmlEscape(description)}</description><link>https://dwnc.me${xmlEscape(post.path)}</link><guid isPermaLink="true">https://dwnc.me${xmlEscape(post.path)}</guid><pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate><category>${xmlEscape(post.leafCategory.label)}</category></item>`));
      }});
      return withVersion(new Response(body,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store'}}),env);
    }
    if (url.pathname === '/sitemap-0.xml') {
      const paths=new Map<string,string|undefined>([['/',undefined],['/archive',undefined],['/category',undefined],['/tags',undefined],['/about',undefined]]);
      for(const post of posts)paths.set(post.path,post.updatedAt??post.publishedAt);
      for(const page of (await store.listPublished(false)).filter(post=>post.kind==='page'))paths.set(`/pages/${page.id}`,page.updatedAt);
      for(const category of categories){const ids=new Set([category.id,...categoryDescendants(category.id,categories).map((node)=>node.id)]);const count=posts.filter((post)=>ids.has(post.categoryId)).length;for(let page=1;page<=Math.max(1,Math.ceil(count/CATEGORY_PAGE_SIZE));page++)paths.set(`/category/${category.slug}${page>1?`/page/${page}`:''}`,undefined);}
      for(const tag of tagNodes(posts))for(let page=1;page<=Math.max(1,Math.ceil(tag.count/TAG_PAGE_SIZE));page++)paths.set(`/tag/${tag.slug}${page>1?`/page/${page}`:''}`,undefined);
      const xml=`<?xml version="1.0" encoding="utf-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...paths].map(([path,updated])=>`<url><loc>https://dwnc.me${xmlEscape(path)}</loc>${updated?`<lastmod>${xmlEscape(updated)}</lastmod>`:''}</url>`).join('')}</urlset>`;
      return withVersion(new Response(xml,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'no-store'}}),env);
    }
    const base = await pageShell(staticHandler, request, env, context); let main: string | null = ''; let title = settings.title; let description = settings.description; let canonical = `https://dwnc.me${url.pathname}`;
    if (!base.ok || !base.headers.get('content-type')?.toLowerCase().startsWith('text/html')) return withVersion(base, env);
    if (url.pathname === '/about') {main=null;title=`소개 — ${settings.title}`;}
    else if (url.pathname === '/') { main = homeMain(posts,categories); canonical = 'https://dwnc.me/'; }
    else if (url.pathname === '/archive') { main = archiveMain(posts); title = '모든 글 — dwnc.me'; description = `${settings.author}의 전체 기록 ${posts.length}편`; }
    else if (url.pathname === '/category') { main = categoryIndexMain(posts,categories); title = '갈래 — dwnc.me'; description = `${settings.title} 글 갈래`; }
    else if (url.pathname === '/tags') { const tags = tagNodes(posts); main = tagsMain(tags); title = '태그 — dwnc.me'; description = `${settings.title}의 태그 ${tags.length}개`; }
    else {
      const match = url.pathname.match(/^\/(category|tag)\/([^/]+)(?:\/page\/([1-9]\d*))?$/u)!;
      let slug: string; try { slug = decodeURIComponent(match[2]).normalize('NFC'); } catch { return withVersion(unavailable(), env); }
      const page = Number(match[3] ?? 1);
      if (match[1] === 'category') {
        const category = categories.find((node)=>node.slug===slug); if (!category) return withVersion(unavailable(), env);
        const accepted = new Set([category.id, ...categoryDescendants(category.id, categories).map((item) => item.id)]);
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
    title=title.replace(/ — dwnc\.me$/u,` — ${settings.title}`);
    const response = await rewriteDocument(base, main, title, description, canonical,false,settings,categories,undefined,url.pathname==='/'?(posts.find((post)=>post.featured)?.cover??posts.find((post)=>post.cover)?.cover):undefined);
    const headers = new Headers(response.headers); headers.set('cache-control', 'no-store'); headers.delete('content-length');
    return withVersion(new Response(response.body, { status: 200, headers }), env);
  };
  return handle;
}
