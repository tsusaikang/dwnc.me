import { readFile } from 'node:fs/promises';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const adminConfig = JSON.parse(await readFile('wrangler.admin.jsonc', 'utf8'));
const releasePolicy = await loadTrackedPublicMediaReleasePolicy(process.cwd());
const expectedBuckets = {
  staging: ['dwnc-me-staging', 'dwnc-me-public-media-staging', 'dwnc-me-native-media-staging', 'dwnc-me-native-staging'],
  production: ['dwnc-me', 'dwnc-me-public-media-production', 'dwnc-me-native-media-production', 'dwnc-me-native-production'],
};
const expectedObservability = {
  enabled: true,
  logs: { enabled: true, head_sampling_rate: 0.1, invocation_logs: false, persist: true },
};
const expectedAdminProductionVars = {
  ACCESS_TEAM_DOMAIN: 'https://ancient-term-4cf0.cloudflareaccess.com',
  ACCESS_AUD: 'e2607628d16bd1707b60ac68a33326591c72c0accf6e5e3da33514ad410555fb',
  ACCESS_ALLOWED_EMAIL: 'tsusaikang@gmail.com',
};
const d1DatabaseId = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const validOptionalD1Id = (entry) => !Object.hasOwn(entry, 'database_id')
  || d1DatabaseId.test(entry.database_id ?? '');
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
  || productionBinding.length !== 2
  || productionBinding[0]?.binding !== releasePolicy.production.binding
  || productionBinding[0]?.bucket_name !== releasePolicy.production.bucket) {
  throw new Error('CLOUDFLARE_E_RELEASE_POLICY');
}
for (const [environment, [name, bucket, nativeBucket, database]] of Object.entries(expectedBuckets)) {
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
    || value.r2_buckets.length !== 2
    || value.r2_buckets[0]?.binding !== 'MEDIA_BUCKET'
    || value.r2_buckets[0]?.bucket_name !== bucket
    || value.r2_buckets[1]?.binding !== 'NATIVE_MEDIA_BUCKET'
    || value.r2_buckets[1]?.bucket_name !== nativeBucket
    || value.r2_buckets.some((entry) => Object.keys(entry).some((key) => !['binding', 'bucket_name'].includes(key)))
    || !Array.isArray(value.d1_databases)
    || value.d1_databases.length !== 1
    || value.d1_databases[0]?.binding !== 'NATIVE_DB'
    || value.d1_databases[0]?.database_name !== database
    || value.d1_databases[0]?.migrations_dir !== 'migrations'
    || !validOptionalD1Id(value.d1_databases[0])
    || Object.keys(value.d1_databases[0]).some(
      (key) => !['binding', 'database_name', 'database_id', 'migrations_dir'].includes(key))) {
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
if (adminConfig.name !== 'dwnc-me-admin-inert-unconfigured'
  || adminConfig.main !== './src/admin-worker.ts'
  || adminConfig.compatibility_date !== config.compatibility_date
  || adminConfig.workers_dev !== false || adminConfig.preview_urls !== false
  || 'routes' in adminConfig || 'route' in adminConfig || 'account_id' in adminConfig
  || 'vars' in adminConfig || 'secrets' in adminConfig) throw new Error('CLOUDFLARE_E_ADMIN_CONFIG');
for (const [environment, [, , nativeBucket, database]] of Object.entries(expectedBuckets)) {
  const value = adminConfig.env?.[environment];
  if (value?.name !== `dwnc-me-admin${environment === 'staging' ? '-staging' : ''}`
    || value?.workers_dev !== false || value?.preview_urls !== false
    || value?.r2_buckets?.length !== 1
    || value.r2_buckets[0]?.binding !== 'NATIVE_MEDIA_BUCKET'
    || value.r2_buckets[0]?.bucket_name !== nativeBucket
    || value?.d1_databases?.length !== 1
    || value.d1_databases[0]?.binding !== 'NATIVE_DB'
    || value.d1_databases[0]?.database_name !== database
    || value.d1_databases[0]?.migrations_dir !== 'migrations'
    || !validOptionalD1Id(value.d1_databases[0])
    || (environment === 'production'
      ? !exactObject(value.vars, expectedAdminProductionVars)
      : 'vars' in value)
    || 'secrets' in value || 'routes' in value || 'route' in value) {
    throw new Error('CLOUDFLARE_E_ADMIN_BINDING');
  }
}
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
  nativeEditorBindingsConfigured: true,
  adminWorker: adminConfig.name,
  requiredStagingSecrets: [],
}, null, 2));
