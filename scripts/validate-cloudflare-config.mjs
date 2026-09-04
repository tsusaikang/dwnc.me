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
const exactObject = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === Object.keys(expected).length
  && Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = value[key];
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      return exactObject(actualValue, expectedValue);
    }
    if (Array.isArray(expectedValue)) {
      return Array.isArray(actualValue)
        && actualValue.length === expectedValue.length
        && actualValue.every((entry, index) => entry === expectedValue[index]);
    }
    return actualValue === expectedValue;
  });
if (config.name !== 'dwnc-me-inert-unconfigured'
  || config.main !== './src/worker.ts'
  || config.compatibility_date !== '2026-08-24'
  || config.workers_dev !== false
  || config.preview_urls !== false
  || !exactObject(config.observability, expectedObservability)
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
if (!exactObject(config.env.staging.vars, {
  DWNC_DEPLOYMENT_ENVIRONMENT: 'staging',
}) || !exactObject(config.env.production.vars, {
  DWNC_DEPLOYMENT_ENVIRONMENT: 'production',
}) || 'secrets' in config.env.staging || 'secrets' in config.env.production || 'secrets' in config) {
  throw new Error('CLOUDFLARE_E_STAGING_CONFIG');
}
if (!exactObject(config.env.staging.observability, {
  enabled: true,
  logs: { enabled: true, head_sampling_rate: 1, invocation_logs: false, persist: true },
})) throw new Error('CLOUDFLARE_E_STAGING_OBSERVABILITY');
const sensitiveKeyPaths = [];
const inspectKeys = (value, segments = []) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const next = [...segments, key];
    if (/secret|token|access[_-]?key|private[_-]?key/iu.test(key)) sensitiveKeyPaths.push(next.join('.'));
    inspectKeys(child, next);
  }
};
inspectKeys(config);
if (sensitiveKeyPaths.some((value) => value !== 'env.staging.secrets')) {
  throw new Error('CLOUDFLARE_E_SECRET');
}
console.log(JSON.stringify({
  worker: config.name,
  compatibilityDate: config.compatibility_date,
  workerFirst: config.assets.run_worker_first,
  r2Environments: Object.keys(expectedBuckets),
  routesConfigured: 0,
  resourcesCreated: 0,
  requiredStagingSecrets: [],
}, null, 2));
