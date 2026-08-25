import { readFile } from 'node:fs/promises';

const requireInstalled = process.argv.includes('--require-installed');
const packageDocument = JSON.parse(await readFile('package.json', 'utf8'));
const lockDocument = JSON.parse(await readFile('package-lock.json', 'utf8'));
const expected = packageDocument.config?.wranglerVersion;
if (expected !== '4.125.0') throw new Error('CLOUDFLARE_E_WRANGLER_PIN');
const locked = lockDocument.packages?.['node_modules/wrangler'];
if (packageDocument.devDependencies?.wrangler !== expected
  || lockDocument.packages?.['']?.devDependencies?.wrangler !== expected
  || locked?.version !== expected
  || typeof locked.resolved !== 'string'
  || !locked.resolved.endsWith(`/wrangler-${expected}.tgz`)
  || typeof locked.integrity !== 'string'
  || !locked.integrity.startsWith('sha512-')) throw new Error('CLOUDFLARE_E_WRANGLER_LOCK');
let installed = null;
try { installed = JSON.parse(await readFile('node_modules/wrangler/package.json', 'utf8')).version; }
catch { installed = null; }
if (installed !== null && installed !== expected) throw new Error('CLOUDFLARE_E_WRANGLER_VERSION');
if (requireInstalled && installed !== expected) throw new Error('CLOUDFLARE_E_WRANGLER_REQUIRED');
console.log(JSON.stringify({
  expected,
  locked: locked.version,
  installed,
  deploymentReady: installed === expected,
}, null, 2));
