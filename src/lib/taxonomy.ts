import { publicPostSequence } from './public-address.ts';

export type PublicPostSource = 'tistory' | 'naver' | 'native';

export interface LegacyCategoryMatcher {
  source: PublicPostSource;
  value: string;
}

export interface TaxonomyNode {
  id: string;
  label: string;
  slug: string;
  parentId: string | null;
  order: number;
  legacyMatchers: readonly LegacyCategoryMatcher[];
}

export interface TaxonomyPost {
  data: {
    source: PublicPostSource;
    sourceId: string;
    categoryId?: string;
    categories: readonly string[];
    tags: readonly string[];
    publishedAt: Date;
    canonicalPath: string;
    title: string;
    visibility: string;
  };
}

export interface CategoryStat extends TaxonomyNode {
  directCount: number;
  totalCount: number;
  depth: number;
}

export interface TagNode {
  label: string;
  slug: string;
  count: number;
}

export interface ChronologicalNeighbors<T extends TaxonomyPost> {
  previous: T | null;
  next: T | null;
}

export interface PageSlice<T> {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
}

export const TAXONOMY: readonly TaxonomyNode[] = [
  {
    id: 'daily', label: '일상', slug: '일상', parentId: null, order: 10,
    legacyMatchers: [{ source: 'naver', value: '일상' }],
  },
  {
    id: 'swimming', label: '수영', slug: '수영-swimming', parentId: null, order: 20,
    legacyMatchers: [{ source: 'naver', value: '수영 (Swimming)' }],
  },
  {
    id: 'swimming-skills', label: '수영 잘하는 법', slug: '수영-잘하는-법', parentId: 'swimming', order: 21,
    legacyMatchers: [{ source: 'naver', value: '수영 잘하는 법' }],
  },
  {
    id: 'swimming-diary', label: '수영 일기', slug: '수영-일기', parentId: 'swimming', order: 22,
    legacyMatchers: [{ source: 'naver', value: '수영 일기' }],
  },
  {
    id: 'swimming-events', label: '대회 출전', slug: '대회-출전', parentId: 'swimming', order: 23,
    legacyMatchers: [{ source: 'naver', value: '대회 출전' }],
  },
  {
    id: 'thoughts', label: '생각 정리', slug: '생각-정리', parentId: null, order: 30,
    legacyMatchers: [{ source: 'tistory', value: '생각 정리' }],
  },
  {
    id: 'daily-stories', label: '일상 이야기', slug: '일상-이야기', parentId: null, order: 40,
    legacyMatchers: [{ source: 'tistory', value: '일상 이야기' }],
  },
  {
    id: 'knowledge', label: '잡지식 정리 정돈', slug: '잡지식-정리-정돈', parentId: null, order: 50,
    legacyMatchers: [{ source: 'tistory', value: '잡지식 정리 정돈' }],
  },
  {
    id: 'cars', label: '자동차', slug: '자동차', parentId: null, order: 60,
    legacyMatchers: [{ source: 'tistory', value: '자동차' }],
  },
  {
    id: 'car-carnival-2020', label: '2020 Kia Carnival 3.5', slug: '자동차-2020-kia-carnival-3-5', parentId: 'cars', order: 61,
    legacyMatchers: [{ source: 'tistory', value: '자동차/2020 Kia Carnival 3.5' }],
  },
  {
    id: 'car-sm5-2006', label: '2006 르노삼성 뉴 SM5 2.0 MT', slug: '자동차-2006-르노삼성-뉴-sm5-2-0-mt', parentId: 'cars', order: 62,
    legacyMatchers: [{ source: 'tistory', value: '자동차/2006 르노삼성 뉴 SM5 2.0 MT' }],
  },
  {
    id: 'car-genesis-coupe-2010', label: '2010 현대 제네시스 쿠페 2.0 Turbo MT', slug: '자동차-2010-현대-제네시스-쿠페-2-0-turbo-mt', parentId: 'cars', order: 63,
    legacyMatchers: [{ source: 'tistory', value: '자동차/2010 현대 제네시스 쿠페 2.0 Turbo MT' }],
  },
  {
    id: 'car-glc-2024', label: '2024 Benz GLC 300 4MATIC', slug: '자동차-2024-benz-glc-300-4matic', parentId: 'cars', order: 64,
    legacyMatchers: [{ source: 'tistory', value: '자동차/2024 Benz GLC 300 4MATIC' }],
  },
  {
    id: 'car-bmw-740li-2012', label: '2012 BMW 740Li', slug: '자동차-2012-bmw-740li', parentId: 'cars', order: 65,
    legacyMatchers: [{ source: 'tistory', value: '자동차/2012 BMW 740Li' }],
  },
  {
    id: 'car-chairmanw-2010', label: '(판매완료) 2010 쌍용 체어맨W CW700 4TRONIC', slug: '자동차-판매완료-2010-쌍용-체어맨w-cw700-4tronic', parentId: 'cars', order: 66,
    legacyMatchers: [{ source: 'tistory', value: '자동차/(판매완료) 2010 쌍용 체어맨W CW700 4TRONIC' }],
  },
  {
    id: 'car-audi-a5-2019', label: '(판매완료) 2019 AUDI A5 Sportback 45TFSI', slug: '자동차-판매완료-2019-audi-a5-sportback-45tfsi', parentId: 'cars', order: 67,
    legacyMatchers: [{ source: 'tistory', value: '자동차/(판매완료) 2019 AUDI A5 Sportback 45TFSI' }],
  },
  {
    id: 'reviews', label: '구매 후기', slug: '구매-후기', parentId: null, order: 70,
    legacyMatchers: [{ source: 'tistory', value: '구매 후기' }],
  },
  {
    id: 'old-blog', label: '옛날 블로그 파보기', slug: '옛날-블로그-파보기', parentId: null, order: 80,
    legacyMatchers: [{ source: 'tistory', value: '옛날 블로그 파보기' }],
  },
] as const;

export const CATEGORY_PAGE_SIZE = 15;
export const TAG_PAGE_SIZE = 15;

const normalize = (value: string) => value.normalize('NFC').trim();
const byId = new Map(TAXONOMY.map((node) => [node.id, node]));
const bySlug = new Map(TAXONOMY.map((node) => [normalize(node.slug), node]));

export function taxonomyRoots() {
  return TAXONOMY.filter((node) => node.parentId === null);
}

export function taxonomyChildren(id: string) {
  return TAXONOMY.filter((node) => node.parentId === id);
}

export function taxonomyNodeById(id: string) {
  return byId.get(id);
}

export function taxonomyNodeBySlug(slug: string) {
  return bySlug.get(normalize(slug));
}

export function taxonomyAncestors(id: string) {
  const ancestors: TaxonomyNode[] = [];
  const seen = new Set<string>();
  let current = taxonomyNodeById(id);
  while (current?.parentId) {
    if (seen.has(current.id)) throw new Error(`Taxonomy cycle detected at ${current.id}`);
    seen.add(current.id);
    const parent = taxonomyNodeById(current.parentId);
    if (!parent) throw new Error(`Taxonomy orphan detected at ${current.id}`);
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

export function taxonomyLineage(id: string) {
  const node = taxonomyNodeById(id);
  if (!node) return [];
  return [...taxonomyAncestors(id), node];
}

export function taxonomyDescendants(id: string): TaxonomyNode[] {
  const descendants: TaxonomyNode[] = [];
  const visit = (parentId: string) => {
    for (const child of taxonomyChildren(parentId)) {
      descendants.push(child);
      visit(child.id);
    }
  };
  visit(id);
  return descendants;
}

export function resolvePostCategoryId(post: TaxonomyPost) {
  if (post.data.categoryId) {
    const categoryId = normalize(post.data.categoryId);
    if (!byId.has(categoryId)) throw new Error(`Unknown taxonomy categoryId: ${categoryId}`);
    return categoryId;
  }
  const deepest = normalize(post.data.categories.at(-1) ?? '');
  const matches = TAXONOMY.filter((node) => node.legacyMatchers.some((matcher) => (
    matcher.source === post.data.source && normalize(matcher.value) === deepest
  )));
  if (matches.length !== 1) {
    throw new Error(`Expected one taxonomy leaf for ${post.data.source}:${deepest || '[empty]'}, found ${matches.length}`);
  }
  return matches[0].id;
}

export function resolvePostCategory(post: TaxonomyPost) {
  return taxonomyNodeById(resolvePostCategoryId(post))!;
}

export function postCategoryAliases(post: TaxonomyPost) {
  const node = resolvePostCategory(post);
  return [...new Set(taxonomyLineage(node.id).flatMap((item) => [
    item.label,
    ...item.legacyMatchers.map((matcher) => matcher.value),
  ]))];
}

export function categoryStats<T extends TaxonomyPost>(posts: readonly T[]): CategoryStat[] {
  const direct = new Map(TAXONOMY.map((node) => [node.id, 0]));
  for (const post of posts) {
    const id = resolvePostCategoryId(post);
    direct.set(id, (direct.get(id) ?? 0) + 1);
  }
  return TAXONOMY.map((node) => ({
    ...node,
    directCount: direct.get(node.id) ?? 0,
    totalCount: [node, ...taxonomyDescendants(node.id)]
      .reduce((sum, item) => sum + (direct.get(item.id) ?? 0), 0),
    depth: taxonomyAncestors(node.id).length,
  }));
}

export function postsForCategory<T extends TaxonomyPost>(posts: readonly T[], categoryId: string) {
  const accepted = new Set([categoryId, ...taxonomyDescendants(categoryId).map((node) => node.id)]);
  return posts.filter((post) => accepted.has(resolvePostCategoryId(post)));
}

export function normalizeTagLabel(value: string) {
  return normalize(value);
}

export function slugifyLabel(value: string) {
  return normalize(value)
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'tag';
}

export function collectTags<T extends TaxonomyPost>(posts: readonly T[]): TagNode[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const raw of post.data.tags) {
      const label = normalizeTagLabel(raw);
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  const baseGroups = new Map<string, string[]>();
  for (const label of counts.keys()) {
    const base = slugifyLabel(label);
    const labels = baseGroups.get(base) ?? [];
    labels.push(label);
    baseGroups.set(base, labels);
  }

  return [...counts.entries()]
    .map(([label, count]) => {
      const base = slugifyLabel(label);
      const collision = (baseGroups.get(base)?.length ?? 0) > 1;
      const suffix = collision ? `--${Buffer.from(label, 'utf8').toString('base64url')}` : '';
      return { label, count, slug: `${base}${suffix}` };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

export function postsForTag<T extends TaxonomyPost>(posts: readonly T[], label: string) {
  const normalizedLabel = normalizeTagLabel(label);
  return posts.filter((post) => post.data.tags.some((tag) => normalizeTagLabel(tag) === normalizedLabel));
}

export function tagNodesForPost(post: TaxonomyPost, tags: readonly TagNode[]) {
  const byLabel = new Map(tags.map((tag) => [normalizeTagLabel(tag.label), tag]));
  return post.data.tags
    .map((label) => byLabel.get(normalizeTagLabel(label)))
    .filter((tag): tag is TagNode => Boolean(tag));
}

export function relatedPosts<T extends TaxonomyPost>(posts: readonly T[], current: T, limit = 5) {
  const categoryId = resolvePostCategoryId(current);
  const currentTime = current.data.publishedAt.getTime();
  const currentSequence = publicPostSequence(current);
  return posts
    .filter((post) => publicPostSequence(post) !== currentSequence
      && resolvePostCategoryId(post) === categoryId)
    .sort((a, b) => {
      const distance = Math.abs(a.data.publishedAt.getTime() - currentTime)
        - Math.abs(b.data.publishedAt.getTime() - currentTime);
      return distance || b.data.publishedAt.getTime() - a.data.publishedAt.getTime()
        || publicPostSequence(b) - publicPostSequence(a);
    })
    .slice(0, limit);
}

export function chronologicalNeighbors<T extends TaxonomyPost>(posts: readonly T[], current: T): ChronologicalNeighbors<T> {
  const ordered = [...posts].sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime()
    || publicPostSequence(b) - publicPostSequence(a));
  const currentSequence = publicPostSequence(current);
  const index = ordered.findIndex((post) => publicPostSequence(post) === currentSequence);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: ordered[index + 1] ?? null,
    next: ordered[index - 1] ?? null,
  };
}

export function paginateItems<T>(items: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new Error(`Invalid page ${page}; expected 1-${totalPages}`);
  }
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, totalPages, totalItems };
}

export function pagedPath(basePath: string, page: number) {
  return page === 1 ? basePath : `${basePath}/page/${page}`;
}
