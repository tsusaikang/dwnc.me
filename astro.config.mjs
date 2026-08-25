import { defineConfig } from 'astro/config';
import os from 'node:os';
import path from 'node:path';
import sitemap from '@astrojs/sitemap';
import publicSequence from './src/data/public-sequence-v1.json' with { type: 'json' };

const legacyPaths = new Set(publicSequence.flatMap((entry) => entry.legacyPaths));
const mediaMode = process.env.DWNC_MEDIA_MODE ?? 'local';
if (!['local', 'remote'].includes(mediaMode)) throw new Error('MEDIA_E_VALIDATION_MODE');
let publicDir = './public';
if (mediaMode === 'remote') {
  const temporaryRoot = path.resolve(os.tmpdir());
  const candidate = path.resolve(process.env.DWNC_CLOUDFLARE_PUBLIC_DIR ?? '');
  if (!candidate.startsWith(`${temporaryRoot}${path.sep}dwnc-cloudflare-public-`)) {
    throw new Error('MEDIA_E_CLOUDFLARE_PUBLIC_DIR');
  }
  publicDir = candidate;
}

export default defineConfig({
  site: 'https://dwnc.me',
  output: 'static',
  publicDir,
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
