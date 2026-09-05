import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizedEnvironment } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
const wrangler = path.join(ROOT, 'node_modules/.bin/wrangler');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-wrangler-types-'));
const environment = sanitizedEnvironment(process.env, {
  CI: '1',
  WRANGLER_WRITE_LOGS: '0',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
  XDG_CONFIG_HOME: temporary,
});

async function run(args) {
  const child = spawn(wrangler, args, { cwd: ROOT, env: environment, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error('CLOUDFLARE_E_WRANGLER_TYPES');
}

try {
  await run([
    'types', 'worker-configuration.d.ts', '--config', 'wrangler.jsonc',
    '--env-interface', 'CloudflareBindings', '--check',
  ]);
  const productionTypes = path.join(temporary, 'production-bindings.d.ts');
  await run([
    'types', productionTypes, '--config', 'wrangler.jsonc', '--env', 'production',
    '--env-interface', 'ProductionBindings', '--include-runtime=false',
  ]);
  const [canonical, production] = await Promise.all([
    readFile(path.join(ROOT, 'worker-configuration.d.ts'), 'utf8'),
    readFile(productionTypes, 'utf8'),
  ]);
  if (!canonical.includes('interface ProductionEnv')
    || !canonical.includes('MEDIA_BUCKET: R2Bucket;')
    || !canonical.includes('NATIVE_MEDIA_BUCKET: R2Bucket;')
    || !canonical.includes('NATIVE_DB: D1Database;')
    || !canonical.includes('ASSETS: Fetcher;')
    || !production.includes('MEDIA_BUCKET: R2Bucket;')
    || !production.includes('NATIVE_MEDIA_BUCKET: R2Bucket;')
    || !production.includes('NATIVE_DB: D1Database;')
    || !production.includes('CF_VERSION_METADATA: WorkerVersionMetadata;')
    || canonical.includes('DWNC_STAGING_SMOKE_TOKEN: string;')
    || production.includes('DWNC_STAGING_SMOKE_TOKEN: string;')) {
    throw new Error('CLOUDFLARE_E_WRANGLER_TYPES_BINDINGS');
  }
  console.log(JSON.stringify({
    wrangler: '4.125.0',
    canonicalTypesDrift: 0,
    canonicalBindings: ['ASSETS', 'MEDIA_BUCKET', 'NATIVE_DB', 'NATIVE_MEDIA_BUCKET'],
    productionEnvironmentProbe: true,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
