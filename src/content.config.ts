import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({
    base: './src/data/posts',
    pattern: '**/*.{md,mdx}',
    deferRender: true,
  }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().default(''),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    source: z.enum(['tistory', 'naver', 'native']),
    sourceId: z.string().min(1),
    sourceUrl: z.url().optional(),
    canonicalPath: z.string().startsWith('/'),
    visibility: z.enum(['public', 'private', 'neighbor', 'mutual-neighbor']).default('private'),
    categories: z.array(z.string()).default([]),
    categoryId: z.string().min(1).optional(),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    coverAlt: z.string().default(''),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    migrationStatus: z.enum(['inventory', 'body-imported', 'media-partial', 'verified']).default('inventory'),
    rawSha256: z.string().optional(),
  }),
});

export const collections = { posts };
