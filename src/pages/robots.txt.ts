import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://dwnc.me');
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap-index.xml', base)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
