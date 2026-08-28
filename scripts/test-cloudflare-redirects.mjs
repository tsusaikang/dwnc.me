import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  loadCloudflareRedirectInputs,
  renderCloudflareRedirects,
  validateEdgeRedirectManifest,
} from './lib/cloudflare-redirects.mjs';
import { publicRequestSurfaceFromRelativeFiles } from './lib/cloudflare-surface.mjs';

const ROOT = process.cwd();
const { manifest, projection } = await loadCloudflareRedirectInputs(ROOT);
let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
const result = validateEdgeRedirectManifest(manifest, projection);
equal(result.redirects, 349);
equal(result.uniqueFrom, 349);
equal(result.uniqueTo, 349);
const rendered = renderCloudflareRedirects(manifest, projection);
equal(rendered.trimEnd().split('\n').length, 349);
equal(rendered.includes('/media/'), false);
equal(rendered.includes('*'), false);
equal(await readFile('public/_redirects', 'utf8'), rendered);

const injected = structuredClone(manifest);
injected.redirects[0].from = '/media/*';
assert.throws(() => validateEdgeRedirectManifest(injected, projection), /REDIRECT_E_ENTRY/u);
assertions += 1;
const duplicate = structuredClone(manifest);
duplicate.redirects[1].from = duplicate.redirects[0].from;
assert.throws(() => validateEdgeRedirectManifest(duplicate, projection), /REDIRECT_E_ENTRY/u);
assertions += 1;
const duplicateTarget = structuredClone(manifest);
duplicateTarget.redirects[1].to = duplicateTarget.redirects[0].to;
assert.throws(() => validateEdgeRedirectManifest(duplicateTarget, projection), /REDIRECT_E_ENTRY/u);
assertions += 1;

const surface = publicRequestSurfaceFromRelativeFiles([
  'index.html', '404.html', 'posts/404/index.html', 'about/index.html', '_redirects',
]);
equal(surface.pathCount, 3);
equal(surface.allowedPathHashes.length, 3);
equal(surface.surfaceSha256,
  '99d3e89013e4cd740570f4a20061892c67217e99f40103953d493de1f7c87f1f');

console.log(JSON.stringify({ suite: 'cloudflare-redirects', assertions, status: 'PASS' }, null, 2));
