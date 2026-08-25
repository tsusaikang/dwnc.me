import { readFile } from 'node:fs/promises';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(process.cwd());
const expectedBuckets = {
  staging: ['dwnc-me-staging', 'dwnc-me-public-media-staging'],
  production: ['dwnc-me', 'dwnc-me-public-media-production'],
};
const expectedObservability = {
  enabled: true,
  logs: { enabled: true, head_sampling_rate: 0.1, invocation_logs: false, persist: true },
};
if (config.name !== 'dwnc-me-inert-unconfigured'
  || config.main !== './src/worker.ts'
  || config.compatibility_date !== '2026-08-24'
  || config.workers_dev !== false
  || config.preview_urls !== false
  || JSON.stringify(config.observability) !== JSON.stringify(expectedObservability)
  || 'routes' in config || 'route' in config || 'account_id' in config
  || config.assets?.directory !== './dist'
  || config.assets?.binding !== 'ASSETS'
  || config.assets?.html_handling !== 'drop-trailing-slash'
  || config.assets?.not_found_handling !== '404-page'
  || config.assets?.run_worker_first !== true) {
  throw new Error('CLOUDFLARE_E_CONFIG');
}
const productionBinding = config.env?.[releasePolicy.production.wranglerEnvironment]?.r2_buckets;
if (config.env?.production?.name !== 'dwnc-me'
  || !Array.isArray(productionBinding)
  || productionBinding.length !== 1
  || productionBinding[0]?.binding !== releasePolicy.production.binding
  || productionBinding[0]?.bucket_name !== releasePolicy.production.bucket) {
  throw new Error('CLOUDFLARE_E_RELEASE_POLICY');
}
for (const [environment, [name, bucket]] of Object.entries(expectedBuckets)) {
  const value = config.env?.[environment];
  if (value?.name !== name
    || value?.workers_dev !== false
    || value?.preview_urls !== false
    || value?.version_metadata?.binding !== 'CF_VERSION_METADATA'
    || releasePolicy[environment]?.environment !== environment
    || releasePolicy[environment]?.wranglerEnvironment !== environment
    || releasePolicy[environment]?.binding !== 'MEDIA_BUCKET'
    || releasePolicy[environment]?.bucket !== bucket
    || !Array.isArray(value.r2_buckets)
    || value.r2_buckets.length !== 1
    || value.r2_buckets[0]?.binding !== 'MEDIA_BUCKET'
    || value.r2_buckets[0]?.bucket_name !== bucket
    || Object.keys(value.r2_buckets[0]).some((key) => !['binding', 'bucket_name'].includes(key))) {
    throw new Error('CLOUDFLARE_E_BINDING');
  }
}
if (JSON.stringify(config.env.staging.vars) !== JSON.stringify({
  DWNC_DEPLOYMENT_ENVIRONMENT: 'staging',
  DWNC_STAGING_SMOKE_POLICY: 'signed-header-non-access-origin',
  DWNC_STAGING_SMOKE_ORIGIN: 'https://smoke-staging.dwnc.me',
}) || JSON.stringify(config.env.production.vars) !== JSON.stringify({
  DWNC_DEPLOYMENT_ENVIRONMENT: 'production',
})) throw new Error('CLOUDFLARE_E_STAGING_SMOKE_POLICY');
if (JSON.stringify(config.env.staging.observability) !== JSON.stringify({
  enabled: true,
  logs: { enabled: true, head_sampling_rate: 1, invocation_logs: false, persist: true },
})) throw new Error('CLOUDFLARE_E_STAGING_OBSERVABILITY');
const serialized = JSON.stringify(config);
if (/secret|token|access[_-]?key|private[_-]?key/iu.test(serialized)) throw new Error('CLOUDFLARE_E_SECRET');
console.log(JSON.stringify({
  worker: config.name,
  compatibilityDate: config.compatibility_date,
  workerFirst: config.assets.run_worker_first,
  r2Environments: Object.keys(expectedBuckets),
  routesConfigured: 0,
  resourcesCreated: 0,
}, null, 2));
