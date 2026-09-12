import type { APIRoute } from 'astro';
import { formatCompactDate, getPublicPosts } from '../lib/posts';
import { derivePublicPostMetadata } from '../lib/public-post';
import { createPublicLinkRegistry } from '../lib/public-links';
import { publicAddressEntries, publicPostPath } from '../lib/public-address';
import { postCategoryAliases, resolvePostCategoryId, resolvePostCategory, taxonomyLineage } from '../lib/taxonomy';

export const prerender = true;

export const GET: APIRoute = async () => {
  const posts = await getPublicPosts();
  const registry = createPublicLinkRegistry(publicAddressEntries().map((address) => ({
    ...address,
    visibility: 'public' as const,
  })));
  const index = await Promise.all(posts.map(async (post) => {
    const { bodyText, description } = await derivePublicPostMetadata(post, registry);
    const category = resolvePostCategory(post);
    const categoryPath = taxonomyLineage(category.id).map((node) => node.label);
    const searchText = [
      post.data.title,
      description,
      ...postCategoryAliases(post),
      ...post.data.tags,
      bodyText,
    ].join(' ').toLocaleLowerCase('ko-KR');

    return {
      title: post.data.title,
      description,
      path: publicPostPath(post),
      date: formatCompactDate(post.data.publishedAt),
    publishedAt: post.data.publishedAt.toISOString(),
    featured: Boolean(post.data.featured),
    cover: post.data.cover ?? null,
    coverAlt: post.data.coverAlt ?? '',
    categoryId: resolvePostCategoryId(post),
      categories: [category.label],
      tags: [...post.data.tags],
      categoryPath,
      leafCategory: { label: category.label, path: `/category/${category.slug}` },
      searchText,
    };
  }));

  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
