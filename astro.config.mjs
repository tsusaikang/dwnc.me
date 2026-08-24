import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import publicSequence from './src/data/public-sequence-v1.json' with { type: 'json' };

const legacyPaths = new Set(publicSequence.flatMap((entry) => entry.legacyPaths));

export default defineConfig({
  site: 'https://dwnc.me',
  output: 'static',
  trailingSlash: 'never',
  integrations: [
    sitemap({
      filter: (page) => {
        const pathname = new URL(page).pathname.replace(/\/$/, '') || '/';
        return !page.endsWith('/search-index.json') && !legacyPaths.has(pathname);
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: true,
    },
  },
});
