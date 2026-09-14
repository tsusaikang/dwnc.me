import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { parse as parseYaml } from 'yaml';
import {
  CATEGORY_PAGE_SIZE,
  TAG_PAGE_SIZE,
  TAXONOMY,
} from '../src/lib/taxonomy.ts';
import { categoryDisplayId, categoryDisplayLabel, categoryDisplayNode, categoryDisplayNodes } from '../src/lib/category-display.ts';
import { BOOTSTRAP_PUBLIC_PROJECTION_SHA256, publicProjectionDigest } from './lib/global-sequence.mjs';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const EXPECTED_IMPORTED_POSTS = 349;
const EXPECTED_NODES = 18;
const EXPECTED_ROOTS = 8;
const EXPECTED_CHILDREN = 10;
const EXPECTED_TAGS = 660;
const EXPECTED_TAG_ASSIGNMENTS = 740;
const EXPECTED_CATEGORY_ROUTES = 40;
const EXPECTED_SITEMAP_ROUTES = 1054;
const EXPECTED_HTML_FILES = 1404;
const issues = new Map();

function issue(code, message) {
  const bucket = issues.get(code) ?? { count: 0, examples: [] };
  bucket.count += 1;
  if (bucket.examples.length < 8) bucket.examples.push(message);
  issues.set(code, bucket);
}

const normalize = (value) => String(value ?? '').normalize('NFC').trim();
const normalizedRoute = (value) => {
  try { return decodeURIComponent(String(value)).normalize('NFC').replace(/\/$/, '') || '/'; }
  catch { return String(value).normalize('NFC').replace(/\/$/, '') || '/'; }
};
const ordered = (posts) => [...posts].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()
  || b.globalSequence - a.globalSequence);
const slugify = (value) => normalize(value)
  .toLocaleLowerCase('ko-KR')
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '') || 'tag';

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

function readFrontmatter(raw, file) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    issue('taxonomy.frontmatter', `${path.relative(ROOT, file)} has no frontmatter.`);
    return null;
  }
  try {
    const data = parseYaml(match[1]);
    const source = normalize(data.source);
    const sourceId = normalize(data.sourceId);
    const address = projectionByIdentity.get(`${source}:${sourceId}`);
    if (!address) return null;
    return {
      source,
      sourceId,
      categoryId: normalize(data.categoryId),
      title: normalize(data.title),
      provenanceCanonicalPath: normalizedRoute(data.canonicalPath),
      canonicalPath: normalizedRoute(address?.canonicalPath ?? '/missing-sequence'),
      globalSequence: Number(address?.globalSequence ?? -1),
      publishedAt: new Date(data.publishedAt),
      featured: Boolean(data.featured),
      cover: normalize(data.cover),
      visibility: normalize(data.visibility),
      draft: Boolean(data.draft),
      categories: Array.isArray(data.categories) ? data.categories.map(normalize) : [],
      tags: Array.isArray(data.tags) ? data.tags.map(normalize).filter(Boolean) : [],
    };
  } catch (error) {
    issue('taxonomy.frontmatter', `${path.relative(ROOT, file)} could not be parsed: ${error.message}`);
    return null;
  }
}

const publicProjection = JSON.parse(await readFile(path.join(ROOT, 'src/data/public-sequence-v1.json'), 'utf8'));
const projectionByIdentity = new Map(publicProjection.map((entry) => [`${entry.source}:${entry.sourceId}`, entry]));
const baselineProjection = publicProjection.length === EXPECTED_IMPORTED_POSTS
  && publicProjectionDigest(publicProjection) === BOOTSTRAP_PUBLIC_PROJECTION_SHA256;

const sourceFiles = (await walk(path.join(ROOT, 'src/data/posts')))
  .filter((file) => /\.mdx?$/.test(file));
const publicPosts = ordered((await Promise.all(sourceFiles.map(async (file) => (
  readFrontmatter(await readFile(file, 'utf8'), file)
))))
  .filter((post) => post && post.visibility === 'public' && !post.draft));

const importedPosts = publicPosts.filter((post) => post.source === 'tistory' || post.source === 'naver');
const nativePosts = publicPosts.filter((post) => post.source === 'native');
if (baselineProjection && importedPosts.length !== EXPECTED_IMPORTED_POSTS) {
  issue('taxonomy.post-count', `Found ${importedPosts.length} imported public source posts; expected ${EXPECTED_IMPORTED_POSTS}.`);
}
if (new Set(publicPosts.map((post) => post.canonicalPath)).size !== publicPosts.length) {
  issue('taxonomy.post-path', 'Public canonical paths are not unique.');
}
if (publicProjection.length !== publicPosts.length || projectionByIdentity.size !== publicPosts.length) {
  issue('taxonomy.sequence', `Projection/public content count differs (${publicProjection.length}/${publicPosts.length}).`);
}
for (const post of importedPosts) {
  const expectedLegacy = post.source === 'tistory' ? `/${post.sourceId}` : `/naver/${post.sourceId}`;
  const address = projectionByIdentity.get(`${post.source}:${post.sourceId}`);
  if (post.provenanceCanonicalPath !== expectedLegacy
    || JSON.stringify(address?.legacyPaths) !== JSON.stringify([expectedLegacy])
    || post.canonicalPath !== `/posts/${post.globalSequence}`) {
    issue('taxonomy.sequence', 'An imported provenance path or derived sequence canonical is inconsistent.');
  }
}

const nodesById = new Map(TAXONOMY.map((node) => [node.id, node]));
const nodesBySlug = new Map(TAXONOMY.map((node) => [normalize(node.slug), node]));
const roots = TAXONOMY.filter((node) => node.parentId === null);
const children = TAXONOMY.filter((node) => node.parentId !== null);
if (TAXONOMY.length !== EXPECTED_NODES || roots.length !== EXPECTED_ROOTS || children.length !== EXPECTED_CHILDREN) {
  issue('taxonomy.shape', `Taxonomy is ${TAXONOMY.length}/${roots.length}/${children.length}; expected ${EXPECTED_NODES}/${EXPECTED_ROOTS}/${EXPECTED_CHILDREN}.`);
}
if (nodesById.size !== TAXONOMY.length) issue('taxonomy.id-collision', 'Taxonomy IDs collide.');
if (nodesBySlug.size !== TAXONOMY.length) issue('taxonomy.slug-collision', 'Taxonomy slugs collide.');
if (new Set(TAXONOMY.map((node) => node.order)).size !== TAXONOMY.length) issue('taxonomy.order-collision', 'Taxonomy order values collide.');

const legacyKeys = new Set();
for (const node of TAXONOMY) {
  if (!node.id || !node.label || !node.slug || !Number.isInteger(node.order)) {
    issue('taxonomy.node', `Taxonomy node ${node.id || '[missing]'} is incomplete.`);
  }
  if (node.parentId && !nodesById.has(node.parentId)) issue('taxonomy.orphan', `${node.id} points to a missing parent.`);
  for (const matcher of node.legacyMatchers) {
    const key = JSON.stringify([matcher.source, normalize(matcher.value)]);
    if (legacyKeys.has(key)) issue('taxonomy.matcher-collision', `${node.id} repeats a source/category matcher.`);
    legacyKeys.add(key);
  }
  const seen = new Set();
  let current = node;
  while (current?.parentId) {
    if (seen.has(current.id)) {
      issue('taxonomy.cycle', `Cycle detected from ${node.id}.`);
      break;
    }
    seen.add(current.id);
    current = nodesById.get(current.parentId);
  }
}

const childrenOf = (id) => TAXONOMY.filter((node) => node.parentId === id);
const descendantsOf = (id) => {
  const result = [];
  const visit = (parentId) => {
    for (const child of childrenOf(parentId)) {
      result.push(child);
      visit(child.id);
    }
  };
  visit(id);
  return result;
};
const lineageOf = (id) => {
  const result = [];
  let current = nodesById.get(id);
  const seen = new Set();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId ? nodesById.get(current.parentId) : null;
  }
  return result;
};
const categoryForPost = new Map();
for (const post of publicPosts) {
  const deepest = normalize(post.categories.at(-1));
  const matches = post.categoryId
    ? TAXONOMY.filter((node) => node.id === post.categoryId)
    : TAXONOMY.filter((node) => node.legacyMatchers.some((matcher) => (
        matcher.source === post.source && normalize(matcher.value) === deepest
      )));
  if (matches.length !== 1) {
    issue('taxonomy.resolve', `${post.canonicalPath} resolves to ${matches.length} categories.`);
    continue;
  }
  categoryForPost.set(post.canonicalPath, matches[0]);
}
if (categoryForPost.size !== publicPosts.length) {
  issue('taxonomy.resolve-count', `Resolved ${categoryForPost.size} public posts; expected ${publicPosts.length}.`);
}

const directCountsFor = (posts) => {
  const counts = new Map(TAXONOMY.map((node) => [node.id, 0]));
  for (const post of posts) {
    const node = categoryForPost.get(post.canonicalPath);
    if (node) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  }
  return counts;
};
const directCounts = directCountsFor(publicPosts);
const importedDirectCounts = directCountsFor(importedPosts);
const countFor = (counts, id) => [nodesById.get(id), ...descendantsOf(id)]
  .filter(Boolean)
  .reduce((sum, node) => sum + (counts.get(node.id) ?? 0), 0);
const totalCount = (id) => countFor(directCounts, id);
const importedTotalCount = (id) => countFor(importedDirectCounts, id);
const rootTotal = roots.reduce((sum, root) => sum + totalCount(root.id), 0);
if (rootTotal !== publicPosts.length) issue('taxonomy.root-union', `Root unions total ${rootTotal}; expected ${publicPosts.length}.`);
const swimming = nodesBySlug.get('수영-swimming');
const cars = nodesBySlug.get('자동차');
if (baselineProjection && (!swimming || importedDirectCounts.get(swimming.id) !== 57 || importedTotalCount(swimming.id) !== 117)) {
  issue('taxonomy.swimming-count', 'Swimming counts are not direct 57 / total 117.');
}
if (baselineProjection && (!cars || importedDirectCounts.get(cars.id) !== 1 || importedTotalCount(cars.id) !== 33)) {
  issue('taxonomy.cars-count', 'Car counts are not direct 1 / total 33.');
}
const inclusiveMemberships = TAXONOMY.reduce((sum, node) => sum + totalCount(node.id), 0);
const importedInclusiveMemberships = TAXONOMY.reduce((sum, node) => sum + importedTotalCount(node.id), 0);
if (baselineProjection && importedInclusiveMemberships !== 441) issue('taxonomy.memberships', `Imported inclusive category memberships are ${importedInclusiveMemberships}; expected 441.`);

const categoryPosts = (node) => {
  const accepted = new Set([categoryDisplayId(node.id), ...descendantsOf(node.id).map((child) => child.id)]);
  return publicPosts.filter((post) => accepted.has(categoryDisplayId(categoryForPost.get(post.canonicalPath)?.id ?? '')));
};
const tagCounts = new Map();
let tagAssignments = 0;
for (const post of publicPosts) {
  if (new Set(post.tags).size !== post.tags.length) issue('tag.post-duplicate', `${post.canonicalPath} repeats a tag.`);
  for (const tag of post.tags) {
    tagAssignments += 1;
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
}
const importedTagCounts = new Map();
let importedTagAssignments = 0;
for (const post of importedPosts) {
  for (const tag of post.tags) {
    importedTagAssignments += 1;
    importedTagCounts.set(tag, (importedTagCounts.get(tag) ?? 0) + 1);
  }
}
const baseGroups = new Map();
for (const label of tagCounts.keys()) {
  const base = slugify(label);
  baseGroups.set(base, [...(baseGroups.get(base) ?? []), label]);
}
const tags = [...tagCounts.entries()].map(([label, count]) => {
  const base = slugify(label);
  const collision = (baseGroups.get(base)?.length ?? 0) > 1;
  const suffix = collision ? `--${Buffer.from(label, 'utf8').toString('base64url')}` : '';
  return { label, count, slug: `${base}${suffix}` };
}).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
if (baselineProjection && (importedTagCounts.size !== EXPECTED_TAGS || importedTagAssignments !== EXPECTED_TAG_ASSIGNMENTS)) {
  issue('tag.count', `Imported tag registry is ${importedTagCounts.size}/${importedTagAssignments}; expected ${EXPECTED_TAGS}/${EXPECTED_TAG_ASSIGNMENTS}.`);
}
if (new Set(tags.map((tag) => tag.slug)).size !== tags.length) issue('tag.slug-collision', 'Final tag slugs collide.');
if (tags.some((tag) => !tag.slug)) issue('tag.slug-empty', 'A tag slug is empty.');
const tagsByLabel = new Map(tags.map((tag) => [tag.label, tag]));
const postsForTag = (label) => publicPosts.filter((post) => post.tags.includes(label));

const htmlCache = new Map();
async function routeDocument(route) {
  const normalized = normalizedRoute(route);
  if (htmlCache.has(normalized)) return htmlCache.get(normalized);
  const relativePath = normalized === '/' ? 'index.html' : path.join(normalized.replace(/^\//, ''), 'index.html');
  try {
    const html = await readFile(path.join(DIST, relativePath), 'utf8');
    const document = { html, $: cheerio.load(html), file: relativePath };
    htmlCache.set(normalized, document);
    return document;
  } catch {
    issue('route.missing', `${normalized} is missing.`);
    return null;
  }
}

function canonicalFrom($) {
  const href = $('link[rel="canonical"]').attr('href') ?? '';
  try { return normalizedRoute(new URL(href).pathname); }
  catch { return ''; }
}

function compareArray(code, label, actual, expected) {
  if (actual.length === expected.length && actual.every((value, index) => value === expected[index])) return;
  issue(code, `${label} differs (${actual.length} actual / ${expected.length} expected).`);
}

function validateDrawer($, activeCategoryId, label) {
  const dialog = $('#category-drawer[data-category-dialog]');
  const opener = $('[data-category-open][aria-controls="category-drawer"][aria-expanded="false"][aria-haspopup="dialog"]');
  if (dialog.length !== 1 || opener.length !== 1) issue('drawer.contract', `${label} lacks one dialog/opener pair.`);
  const ids = new Set();
  dialog.find('[data-category-branch-toggle]').each((_, element) => {
    const button = $(element);
    const id = button.attr('aria-controls') ?? '';
    if (!id || ids.has(id) || dialog.find(`#${id}`).length !== 1) issue('drawer.controls', `${label} has a duplicate or orphan branch control.`);
    ids.add(id);
    const expanded = button.attr('aria-expanded') === 'true';
    const hidden = dialog.find(`#${id}`).is('[hidden]');
    if (expanded === hidden) issue('drawer.expanded', `${label} has inconsistent aria-expanded/hidden state.`);
  });
  if (!activeCategoryId) return;
  activeCategoryId = categoryDisplayId(activeCategoryId);
  const branch = dialog.find(`.category-branch[data-category-id="${activeCategoryId}"]`);
  const current = branch.find('> .category-branch__row > a[aria-current="page"], > ul > .category-branch--all > .category-branch__row > a[aria-current="page"]');
  if (current.length !== 1) issue('drawer.current', `${label} does not mark its current leaf exactly once.`);
  for (const ancestor of lineageOf(activeCategoryId).slice(0, -1)) {
    const branch = dialog.find(`.category-branch[data-category-id="${ancestor.id}"]`);
    const toggle = branch.children('.category-branch__row').children('[data-category-branch-toggle]');
    const target = dialog.find(`#${toggle.attr('aria-controls')}`);
    if (branch.attr('data-active-ancestor') !== 'true'
      || toggle.attr('aria-expanded') !== 'true'
      || target.is('[hidden]')) {
      issue('drawer.ancestor', `${label} does not expose active ancestor ${ancestor.id}.`);
    }
  }
}

function validatePagination($, basePath, page, totalPages, label) {
  const nav = $('.pagination');
  if (totalPages === 1) {
    if (nav.length) issue('pagination.unexpected', `${label} renders pagination for one page.`);
    return;
  }
  if (nav.length !== 1 || nav.attr('aria-label') !== `${label} 페이지`) issue('pagination.semantic', `${label} lacks semantic pagination.`);
  const pageHrefs = nav.find('ol a').toArray().map((element) => normalizedRoute($(element).attr('href')));
  const expectedHrefs = Array.from({ length: totalPages }, (_, index) => (
    index === 0 ? basePath : `${basePath}/page/${index + 1}`
  ));
  compareArray('pagination.pages', label, pageHrefs, expectedHrefs);
  if (nav.find('ol a[aria-current="page"]').text().trim() !== String(page)) issue('pagination.current', `${label} has the wrong current page.`);
  const previous = nav.find('a[rel="prev"]');
  const next = nav.find('a[rel="next"]');
  const expectedPrevious = page > 1 ? (page === 2 ? basePath : `${basePath}/page/${page - 1}`) : null;
  const expectedNext = page < totalPages ? `${basePath}/page/${page + 1}` : null;
  if ((expectedPrevious && normalizedRoute(previous.attr('href')) !== expectedPrevious) || (!expectedPrevious && previous.length)) {
    issue('pagination.previous', `${label} has the wrong previous link.`);
  }
  if ((expectedNext && normalizedRoute(next.attr('href')) !== expectedNext) || (!expectedNext && next.length)) {
    issue('pagination.next', `${label} has the wrong next link.`);
  }
}

function validateCards($, expected, label) {
  const cards = $('.posts-grid > .post-card');
  const paths = cards.find('h2 a').toArray().map((element) => normalizedRoute($(element).attr('href')));
  compareArray('listing.posts', label, paths, expected.map((post) => post.canonicalPath));
  cards.each((index, element) => {
    const post = expected[index];
    if (!post) return;
    const shown = $(element).find('.post-card__meta > span').text().trim();
    const leaf = categoryForPost.get(post.canonicalPath);
    if (shown !== categoryDisplayLabel(leaf?.id ?? '', leaf?.label)) issue('listing.leaf', `${label} displays a non-leaf category for ${post.canonicalPath}.`);
  });
}

const expectedCategoryRoutes = new Set();
for (const node of TAXONOMY) {
  const posts = categoryPosts(node);
  const totalPages = Math.max(1, Math.ceil(posts.length / CATEGORY_PAGE_SIZE));
  const seen = new Set();
  for (let page = 1; page <= totalPages; page += 1) {
    const basePath = `/category/${node.slug}`;
    const route = page === 1 ? basePath : `${basePath}/page/${page}`;
    expectedCategoryRoutes.add(route);
    const document = await routeDocument(route);
    if (!document) continue;
    const { $ } = document;
    if (canonicalFrom($) !== route) issue('category.canonical', `${route} has the wrong canonical URL.`);
    const slice = posts.slice((page - 1) * CATEGORY_PAGE_SIZE, page * CATEGORY_PAGE_SIZE);
    validateCards($, slice, route);
    for (const post of slice) {
      if (seen.has(post.canonicalPath)) issue('category.duplicate', `${basePath} repeats ${post.canonicalPath}.`);
      seen.add(post.canonicalPath);
    }
    validatePagination($, basePath, page, totalPages, categoryDisplayLabel(node.id, node.label));
    const currentCrumb = $('.breadcrumbs li:last-child [aria-current="page"]').text().trim();
    if (currentCrumb !== categoryDisplayLabel(node.id, node.label)) issue('category.breadcrumb', `${route} has the wrong breadcrumb.`);
    validateDrawer($, node.id, route);
  }
  if (seen.size !== posts.length) issue('category.union', `/category/${node.slug} covers ${seen.size}/${posts.length} posts.`);
}
const importedCategoryRoutes = TAXONOMY.reduce((sum, node) => {
  const accepted = new Set([node.id, ...descendantsOf(node.id).map((child) => child.id)]);
  const count = importedPosts.filter((post) => accepted.has(categoryForPost.get(post.canonicalPath)?.id)).length;
  return sum + Math.max(1, Math.ceil(count / CATEGORY_PAGE_SIZE));
}, 0);
if (baselineProjection && importedCategoryRoutes !== EXPECTED_CATEGORY_ROUTES) {
  issue('category.route-count', `Imported taxonomy produces ${importedCategoryRoutes} category routes; expected ${EXPECTED_CATEGORY_ROUTES}.`);
}
const categoryHtmlFiles = (await walk(path.join(DIST, 'category'))).filter((file) => path.basename(file) === 'index.html');
if (categoryHtmlFiles.length !== expectedCategoryRoutes.size + 1) {
  issue('category.route-count', `Built category HTML count is ${categoryHtmlFiles.length}; expected ${expectedCategoryRoutes.size + 1}.`);
}
if ((await walk(path.join(DIST, 'category'))).some((file) => file.includes(`${path.sep}page${path.sep}1${path.sep}`))) {
  issue('category.page-one', 'A /category/.../page/1 route exists.');
}

const categoryIndex = await routeDocument('/category');
if (categoryIndex) {
  const { $ } = categoryIndex;
  const links = new Set($('.category-tree-index a[href^="/category/"]').toArray().map((element) => normalizedRoute($(element).attr('href'))));
  if ($('.category-tree-index__root').length !== EXPECTED_ROOTS - 1 || links.size !== EXPECTED_NODES - 1) {
    issue('category.index', `Category index has ${$('.category-tree-index__root').length} roots and ${links.size} unique node links.`);
  }
  if (canonicalFrom($) !== '/category') issue('category.index-canonical', 'Category index canonical URL is wrong.');
  validateDrawer($, undefined, '/category');
}

const home = await routeDocument('/');
if (home) {
  const actual = home.$('.home-category-list > a').toArray().map((element) => normalizedRoute(home.$(element).attr('href')));
  compareArray('home.roots', 'home root list', actual, categoryDisplayNodes(roots).map((root) => `/category/${root.slug}`));
  const featured = publicPosts.find((post) => post.featured)
    ?? publicPosts.find((post) => post.cover)
    ?? publicPosts[0];
  const featureLinks = home.$('.home-feature a[href^="/posts/"]').toArray()
    .map((element) => normalizedRoute(home.$(element).attr('href')));
  if (!featured || !featureLinks.length || featureLinks.some((href) => href !== featured.canonicalPath)) {
    issue('home.posts', 'Home featured links do not use the derived sequence canonical.');
  }
  const expectedLatest = publicPosts.filter((post) => post.globalSequence !== featured?.globalSequence).slice(0, 7);
  const latestLinks = home.$('.home-index ol a').toArray().map((element) => normalizedRoute(home.$(element).attr('href')));
  compareArray('home.posts', 'home latest posts', latestLinks, expectedLatest.map((post) => post.canonicalPath));
}

const archive = await routeDocument('/archive');
if (archive) {
  const archiveLinks = archive.$('.archive-list li > a').toArray()
    .map((element) => normalizedRoute(archive.$(element).attr('href')));
  compareArray('archive.posts', 'archive post links', archiveLinks, publicPosts.map((post) => post.canonicalPath));
}

const expectedTagRoutes = new Set();
for (const tag of tags) {
  const posts = postsForTag(tag.label);
  const totalPages = Math.max(1, Math.ceil(posts.length / TAG_PAGE_SIZE));
  for (let page = 1; page <= totalPages; page += 1) {
    const basePath = `/tag/${tag.slug}`;
    const route = page === 1 ? basePath : `${basePath}/page/${page}`;
    expectedTagRoutes.add(route);
    const document = await routeDocument(route);
    if (!document) continue;
    const { $ } = document;
    if (canonicalFrom($) !== route) issue('tag.canonical', `${route} has the wrong canonical URL.`);
    validateCards($, posts.slice((page - 1) * TAG_PAGE_SIZE, page * TAG_PAGE_SIZE), route);
    validatePagination($, basePath, page, totalPages, `#${tag.label}`);
    if ($('.breadcrumbs li:last-child [aria-current="page"]').text().trim() !== `#${tag.label}`) {
      issue('tag.breadcrumb', `${route} has the wrong breadcrumb.`);
    }
  }
}
const builtTagFiles = (await walk(path.join(DIST, 'tag'))).filter((file) => path.basename(file) === 'index.html');
if (builtTagFiles.length !== expectedTagRoutes.size) {
  issue('tag.route-count', `Tag routes are expected ${expectedTagRoutes.size} / built ${builtTagFiles.length}.`);
}
if ((await walk(path.join(DIST, 'tag'))).some((file) => file.includes(`${path.sep}page${path.sep}1${path.sep}`))) {
  issue('tag.page-one', 'A /tag/.../page/1 route exists.');
}
const tagIndex = await routeDocument('/tags');
if (tagIndex) {
  const { $ } = tagIndex;
  const links = $('[data-tag-item] a').toArray().map((element) => normalizedRoute($(element).attr('href')));
  compareArray('tag.index', 'tag index', links, tags.map((tag) => `/tag/${tag.slug}`));
  if ($('[data-tag-filter]').length !== 1 || $('[data-tag-status][aria-live="polite"]').length !== 1) {
    issue('tag.search', 'Tag index lacks its searchable index controls.');
  }
}

const relatedExpected = (post) => {
  const categoryId = categoryDisplayId(categoryForPost.get(post.canonicalPath)?.id ?? '');
  return publicPosts
    .filter((candidate) => categoryDisplayId(categoryForPost.get(candidate.canonicalPath)?.id ?? '') === categoryId)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()
      || b.globalSequence - a.globalSequence);
};
let relatedLinks = 0;
let previousLinks = 0;
let nextLinks = 0;
let tagLinks = 0;
for (const [index, post] of publicPosts.entries()) {
  const document = await routeDocument(post.canonicalPath);
  if (!document) continue;
  const { $ } = document;
  const category = categoryForPost.get(post.canonicalPath);
  if ($(`.article-page[data-category-id="${category?.id}"]`).length !== 1) {
    issue('post.leaf', `${post.canonicalPath} has the wrong article leaf.`);
  }
  const breadcrumb = $('.post-header .breadcrumbs');
  const crumbLinks = breadcrumb.find('a').toArray().map((element) => normalizedRoute($(element).attr('href')));
  const expectedCrumbLinks = ['/category', ...lineageOf(categoryDisplayId(category?.id ?? '')).map((node) => `/category/${node.slug}`)];
  compareArray('post.breadcrumb-links', post.canonicalPath, crumbLinks, expectedCrumbLinks);
  if (breadcrumb.find('li:last-child [aria-current="page"]').text().trim() !== post.title) {
    issue('post.breadcrumb-current', `${post.canonicalPath} lacks its current breadcrumb title.`);
  }
  validateDrawer($, category?.id, post.canonicalPath);

  const actualTagLinks = $('.post-tags a[rel="tag"]').toArray().map((element) => normalizedRoute($(element).attr('href')));
  const expectedTagLinks = post.tags.map((label) => `/tag/${tagsByLabel.get(label)?.slug}`);
  compareArray('post.tags', post.canonicalPath, actualTagLinks, expectedTagLinks);
  tagLinks += actualTagLinks.length;

  const expectedRelated = relatedExpected(post);
  const actualRelated = $('.post-related li a').toArray().map((element) => normalizedRoute($(element).attr('href')));
  compareArray('post.related', post.canonicalPath, actualRelated, expectedRelated.map((item) => item.canonicalPath));
  if (new Set(actualRelated).size !== actualRelated.length
    || actualRelated.some((route) => !publicPosts.some((item) => item.canonicalPath === route))) {
    issue('post.related-safety', `${post.canonicalPath} has a duplicate or non-public category link.`);
  }
  const expectedPage = Math.floor(expectedRelated.findIndex((item) => item.canonicalPath === post.canonicalPath) / 5) + 1;
  const expectedPages = Math.ceil(expectedRelated.length / 5);
  const lists = $('.post-related [data-category-page]');
  const visible = lists.filter(':not([hidden])');
  if (lists.length !== expectedPages || visible.length !== 1
    || Number(visible.attr('data-category-page')) !== expectedPage
    || lists.toArray().some((element) => $(element).find('li').length > 5)) {
    issue('post.category-pages', `${post.canonicalPath} has invalid five-post pages or initial position.`);
  }
  const current = $('.post-related a[aria-current="page"]');
  if (current.length !== 1 || normalizedRoute(current.attr('href')) !== post.canonicalPath
    || visible.find('a[aria-current="page"]').length !== 1) {
    issue('post.category-current', `${post.canonicalPath} lacks its current-post marker on the visible page.`);
  }
  if (expectedPages > 1) {
    const start = Math.floor((expectedPage - 1) / 7) * 7 + 1;
    const end = Math.min(start + 6, expectedPages);
    const buttons = $('.post-related [data-category-page-button]:not([hidden])');
    compareArray('post.category-page-buttons', post.canonicalPath,
      buttons.toArray().map((element) => Number($(element).attr('data-category-page-button'))),
      Array.from({ length: end - start + 1 }, (_, index) => start + index));
    if ($('[data-category-page-previous]').is('[disabled]') !== (start === 1)
      || $('[data-category-page-next]').is('[disabled]') !== (end === expectedPages)) {
      issue('post.category-page-boundaries', `${post.canonicalPath} has invalid page-group boundaries.`);
    }
  }
  relatedLinks += actualRelated.length;

  const previous = $('.post-sequence a[rel="prev"]');
  const next = $('.post-sequence a[rel="next"]');
  const expectedPrevious = publicPosts[index + 1]?.canonicalPath;
  const expectedNext = publicPosts[index - 1]?.canonicalPath;
  if ((expectedPrevious && normalizedRoute(previous.attr('href')) !== expectedPrevious) || (!expectedPrevious && previous.length)) {
    issue('post.previous', `${post.canonicalPath} has the wrong older-post link.`);
  }
  if ((expectedNext && normalizedRoute(next.attr('href')) !== expectedNext) || (!expectedNext && next.length)) {
    issue('post.next', `${post.canonicalPath} has the wrong newer-post link.`);
  }
  if (previous.length) previousLinks += 1;
  if (next.length) nextLinks += 1;
}
if (tagLinks !== tagAssignments) issue('post.tag-assignment', `Article tag links total ${tagLinks}; expected ${tagAssignments}.`);
if (previousLinks !== publicPosts.length - 1 || nextLinks !== publicPosts.length - 1) {
  issue('post.chronology-count', `Chronology links are previous ${previousLinks} / next ${nextLinks}; expected ${publicPosts.length - 1}/${publicPosts.length - 1}.`);
}

let searchIndex = [];
try { searchIndex = JSON.parse(await readFile(path.join(DIST, 'search-index.json'), 'utf8')); }
catch { issue('taxonomy.search-read', 'Search index could not be read.'); }
const searchByPath = new Map(searchIndex.map((entry) => [normalizedRoute(entry.path), entry]));
for (const post of publicPosts) {
  const entry = searchByPath.get(post.canonicalPath);
  const originalCategory = categoryForPost.get(post.canonicalPath);
  const category = categoryDisplayNode(originalCategory?.id ?? '', TAXONOMY);
  const lineage = lineageOf(category?.id);
  const aliases = [...new Set([...originalCategory.legacyMatchers.map((matcher) => matcher.value), ...lineage.flatMap((node) => [node.label, ...node.legacyMatchers.map((matcher) => matcher.value)])])];
  if (!entry
    || JSON.stringify(entry.categories) !== JSON.stringify([category?.label])
    || JSON.stringify(entry.categoryPath) !== JSON.stringify(lineage.map((node) => node.label))
    || entry.leafCategory?.label !== category?.label
    || normalizedRoute(entry.leafCategory?.path) !== `/category/${category?.slug}`) {
    issue('taxonomy.search-leaf', `${post.canonicalPath} has inconsistent search taxonomy metadata.`);
  }
  const searchText = String(entry?.searchText ?? '');
  for (const term of [...aliases, ...post.tags]) {
    if (!searchText.includes(term.toLocaleLowerCase('ko-KR'))) {
      issue('taxonomy.search-alias', `${post.canonicalPath} search text omits a category alias or tag.`);
      break;
    }
  }
}

let rss = '';
try { rss = await readFile(path.join(DIST, 'rss.xml'), 'utf8'); }
catch { issue('taxonomy.rss-read', 'RSS could not be read.'); }
const $rss = cheerio.load(rss, { xmlMode: true });
const expectedRssUrls = new Map(publicPosts.map((post) => [new URL(post.canonicalPath, 'https://dwnc.me').href, post]));
const seenRssUrls = new Map();
$rss('item').each((_, item) => {
  const link = $rss(item).find('link').first().text().trim();
  const guidNode = $rss(item).find('guid').first();
  const guid = guidNode.text().trim();
  const post = expectedRssUrls.get(link);
  if (post) seenRssUrls.set(link, (seenRssUrls.get(link) ?? 0) + 1);
  else issue('taxonomy.rss-exact', `${link || '[empty]'} is not an exact public canonical RSS URL.`);
  if (guid !== link) issue('taxonomy.rss-exact', `${guid || '[empty]'} differs from its RSS link ${link || '[empty]'}.`);
  if (guidNode.attr('isPermaLink') !== 'true') issue('taxonomy.rss-exact', `${link || '[empty]'} has a non-permalink RSS guid.`);
  const categories = $rss(item).find('category').toArray().map((element) => $rss(element).text().trim());
  const expected = post ? categoryDisplayNode(categoryForPost.get(post.canonicalPath)?.id ?? '', TAXONOMY)?.label : undefined;
  if (!post || categories.length !== 1 || categories[0] !== expected) {
    issue('taxonomy.rss-leaf', `${post?.canonicalPath ?? link ?? '[unknown]'} has inconsistent RSS leaf category.`);
  }
});
for (const expectedUrl of expectedRssUrls.keys()) {
  if (seenRssUrls.get(expectedUrl) !== 1) {
    issue('taxonomy.rss-exact', `${expectedUrl} occurs ${seenRssUrls.get(expectedUrl) ?? 0} times in RSS.`);
  }
}

const fixedPageRoutes = ['/', '/about', '/archive', '/category', '/tags'];
const expectedSitemap = new Set([
  ...fixedPageRoutes,
  ...publicPosts.map((post) => post.canonicalPath),
  ...expectedCategoryRoutes,
  ...expectedTagRoutes,
]);
const importedSitemapRoutes = fixedPageRoutes.length + importedPosts.length + importedCategoryRoutes + EXPECTED_TAGS;
if (baselineProjection && importedSitemapRoutes !== EXPECTED_SITEMAP_ROUTES) {
  issue('sitemap.expected-count', `Imported sitemap baseline is ${importedSitemapRoutes}; expected ${EXPECTED_SITEMAP_ROUTES}.`);
}
let sitemapXml = '';
try { sitemapXml = await readFile(path.join(DIST, 'sitemap-0.xml'), 'utf8'); }
catch { issue('sitemap.read', 'sitemap-0.xml could not be read.'); }
const $sitemap = cheerio.load(sitemapXml, { xmlMode: true });
const sitemapRoutes = new Set($sitemap('loc').toArray().map((element) => {
  try { return normalizedRoute(new URL($sitemap(element).text()).pathname); }
  catch { return ''; }
}).filter(Boolean));
for (const route of expectedSitemap) if (!sitemapRoutes.has(route)) issue('sitemap.missing', `${route} is missing from sitemap.`);
for (const route of sitemapRoutes) if (!expectedSitemap.has(route)) issue('sitemap.unexpected', `${route} is unexpected in sitemap.`);
if (sitemapRoutes.size !== expectedSitemap.size) issue('sitemap.count', `Sitemap has ${sitemapRoutes.size} routes; expected ${expectedSitemap.size}.`);

const htmlFiles = (await walk(DIST)).filter((file) => path.extname(file) === '.html');
const legacyAliasCount = publicProjection.reduce((sum, entry) => sum + entry.legacyPaths.length, 0);
if (EXPECTED_HTML_FILES !== EXPECTED_SITEMAP_ROUTES + 1 + EXPECTED_IMPORTED_POSTS) {
  issue('route.html-baseline', 'Imported HTML/sitemap/alias baseline constants are inconsistent.');
}
if (htmlFiles.length !== expectedSitemap.size + 1 + legacyAliasCount) {
  issue('route.html-count', `Built HTML count is ${htmlFiles.length}; expected ${expectedSitemap.size + 1 + legacyAliasCount}.`);
}
const canonicalPostPaths = new Set(publicPosts.map((post) => post.canonicalPath));
const legacyAliasPaths = new Set(publicProjection.flatMap((entry) => entry.legacyPaths));
let globalPostHrefs = 0;
let legacyPostHrefs = 0;
for (const file of htmlFiles) {
  const $ = cheerio.load(await readFile(file, 'utf8'));
  for (const element of $('a[href]').toArray()) {
    const href = $(element).attr('href') ?? '';
    let parsed;
    try { parsed = new URL(href, 'https://dwnc.me'); }
    catch { continue; }
    if (!['dwnc.me', 'www.dwnc.me'].includes(parsed.hostname.toLowerCase())) continue;
    const route = normalizedRoute(parsed.pathname);
    if (route.startsWith('/posts/')) {
      globalPostHrefs += 1;
      if (parsed.search || parsed.hash || !canonicalPostPaths.has(route) || !/^\/posts\/[1-9]\d*$/.test(route)) {
        issue('route.post-href', 'A public HTML anchor uses an invalid or unregistered sequence post URL.');
      }
    }
    if (legacyAliasPaths.has(route)) legacyPostHrefs += 1;
  }
}
if (legacyPostHrefs) issue('route.legacy-href', `${legacyPostHrefs} public HTML anchors still target a legacy post alias.`);

if (issues.size) {
  const lines = [];
  for (const [code, bucket] of [...issues.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${code}: ${bucket.count} issue(s)`);
    for (const example of bucket.examples) lines.push(`  - ${example}`);
    if (bucket.count > bucket.examples.length) lines.push(`  - ... ${bucket.count - bucket.examples.length} more`);
  }
  console.error(lines.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  posts: { imported: importedPosts.length, native: nativePosts.length, total: publicPosts.length },
  taxonomy: {
    nodes: TAXONOMY.length,
    roots: roots.length,
    children: children.length,
    resolvedPosts: categoryForPost.size,
    inclusiveMemberships,
    rootUnion: rootTotal,
    swimming: { direct: directCounts.get(swimming.id), total: totalCount(swimming.id) },
    cars: { direct: directCounts.get(cars.id), total: totalCount(cars.id) },
  },
  categoryRoutes: expectedCategoryRoutes.size,
  tags: { nodes: tags.length, assignments: tagAssignments, routes: expectedTagRoutes.size },
  discovery: { relatedLinks, previousLinks, nextLinks },
  sitemapRoutes: sitemapRoutes.size,
  htmlFiles: htmlFiles.length,
  legacyAliasFiles: legacyAliasCount,
  postHrefs: { canonical: globalPostHrefs, legacy: legacyPostHrefs },
}, null, 2));
