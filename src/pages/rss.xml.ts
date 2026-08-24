import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getPublicPosts } from '../lib/posts';
import { derivePublicPostMetadata } from '../lib/public-post';
import { createPublicLinkRegistry } from '../lib/public-links';
import { publicAddressEntries, publicPostPath } from '../lib/public-address';
import { resolvePostCategory } from '../lib/taxonomy';

export const GET: APIRoute = async (context) => {
  const posts = await getPublicPosts();
  const registry = createPublicLinkRegistry(publicAddressEntries().map((address) => ({
    ...address,
    visibility: 'public' as const,
  })));
  return rss({
    title: '대왕날치',
    description: '자동차와 수영, 생활의 발견과 생각의 기록',
    site: context.site ?? new URL('https://dwnc.me'),
    trailingSlash: false,
    items: await Promise.all(posts.map(async (post) => {
      const { description } = await derivePublicPostMetadata(post, registry);
      const category = resolvePostCategory(post);
      return {
        title: post.data.title,
        description,
        pubDate: post.data.publishedAt,
        link: publicPostPath(post),
        categories: [category.label],
      };
    })),
    customData: '<language>ko-kr</language>',
  });
};
