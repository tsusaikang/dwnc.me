import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Execute the production request expression in workerd, not Node's fetch mock:
// workerd rejects redirect:'error' before making any service request.
const source = await readFile(new URL('../src/admin-worker.ts', import.meta.url), 'utf8');
const expression = source.match(/await env\.PUBLIC_SITE\.fetch\([^;]+\);/u)?.[0];
assert.ok(expression, 'Find the actual production codec request');
const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
  { name: 'admin-check', modules: true, compatibilityDate: '2026-08-24',
    serviceBindings: { PUBLIC_SITE: 'asset-check' },
    script: `export default { async fetch(request, env) { const url=new URL(request.url); return ${expression} } };` },
  { name: 'asset-check', modules: true, compatibilityDate: '2026-08-24',
    script: `export default { fetch(request) { const path=new URL(request.url).pathname; return path.endsWith('redirect') ? Response.redirect('https://never-follow.invalid/',302) : new Response('codec fixture',{headers:{'content-type':'text/javascript'}}); } };` },
] }));
try {
  const response = await runtime.dispatchFetch('http://localhost/image-codecs/hdr-worker.js');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'codec fixture');
  const redirect = await runtime.dispatchFetch('http://localhost/image-codecs/redirect', { redirect: 'manual' });
  assert.equal(redirect.status, 302, 'Upstream redirect is returned for rejection, never followed');
  console.log(JSON.stringify({ suite: 'codec-worker-runtime', status: 'PASS' }));
} finally { await runtime.dispose(); }
