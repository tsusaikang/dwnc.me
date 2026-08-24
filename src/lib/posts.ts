import { getCollection, type CollectionEntry } from 'astro:content';
import { isProjectedPublicIdentity, publicAddressEntries, publicPostSequence } from './public-address';

export type PostEntry = CollectionEntry<'posts'>;

export async function getPublicPosts(): Promise<PostEntry[]> {
  const posts = await getCollection('posts', ({ data }) => {
    if (!isProjectedPublicIdentity(data.source, data.sourceId)) return false;
    if (data.visibility !== 'public') return false;
    return import.meta.env.DEV || !data.draft;
  });

  const selectedIdentities = new Set(posts.map((post) => `${post.data.source}:${post.data.sourceId}`));
  const projection = publicAddressEntries();
  if (posts.length !== projection.length
    || selectedIdentities.size !== projection.length
    || projection.some((entry) => !selectedIdentities.has(`${entry.source}:${entry.sourceId}`))) {
    throw new Error('Public sequence projection and prepared content do not match exactly.');
  }

  return posts.sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime()
      || publicPostSequence(b) - publicPostSequence(a),
  );
}

export function formatDate(date: Date, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options,
  }).format(date);
}

export function formatCompactDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replaceAll('. ', '.')
    .replace(/\.$/, '');
}

export function categorySlug(category: string) {
  return category
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function collectCategories(posts: PostEntry[]) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const category of post.data.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, slug: categorySlug(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}
