import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './cloudflare-release.mjs';
import {
  STAGING_SMOKE_TOKEN_BYTES,
  STAGING_SMOKE_TOKEN_CHARACTERS,
} from '../../src/lib/staging-smoke-token.js';

export const STAGING_SMOKE_ACCESS_POLICY_PATH = 'src/data/staging-smoke-access-policy-v1.json';
export const STAGING_WORKER_NAME = 'dwnc-me-staging';
export const STAGING_WORKERS_DEV_ORIGIN = 'https://dwnc-me-staging.dwnc.workers.dev';
export const STAGING_SMOKE_SECRET_BINDING = 'DWNC_STAGING_SMOKE_TOKEN';
export const STAGING_SMOKE_POLICY_NAME = 'bearer-token-non-access-origin';

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key));

export function validateStagingSmokeAccessPolicy(policy) {
  if (!exactKeys(policy, [
    'schemaVersion', 'contract', 'environment', 'workerName', 'origin', 'authentication',
    'unauthenticatedResponse', 'workersDevRequired', 'previewUrlsEnabled',
  ])
    || policy.schemaVersion !== 1
    || policy.contract !== 'dwnc-staging-smoke-access-policy-v1'
    || policy.environment !== 'staging'
    || policy.workerName !== STAGING_WORKER_NAME
    || policy.origin !== STAGING_WORKERS_DEV_ORIGIN
    || !exactKeys(policy.authentication, [
      'scheme', 'requestHeader', 'secretBinding', 'randomBytes', 'encodedCharacters',
      'encoding', 'padding', 'canonicalEncodingRequired',
    ])
    || policy.authentication.scheme !== 'Bearer'
    || policy.authentication.requestHeader !== 'authorization'
    || policy.authentication.secretBinding !== STAGING_SMOKE_SECRET_BINDING
    || policy.authentication.randomBytes !== STAGING_SMOKE_TOKEN_BYTES
    || policy.authentication.encodedCharacters !== STAGING_SMOKE_TOKEN_CHARACTERS
    || policy.authentication.encoding !== 'base64url'
    || policy.authentication.padding !== 'forbidden'
    || policy.authentication.canonicalEncodingRequired !== true
    || !exactKeys(policy.unauthenticatedResponse, ['status', 'cacheControl'])
    || policy.unauthenticatedResponse.status !== 404
    || policy.unauthenticatedResponse.cacheControl !== 'no-store'
    || policy.workersDevRequired !== true
    || policy.previewUrlsEnabled !== false) {
    throw new Error('CLOUDFLARE_E_STAGING_SMOKE_ACCESS_POLICY');
  }
  return policy;
}

export function canonicalStagingSmokeAccessPolicyPayload(policy) {
  validateStagingSmokeAccessPolicy(policy);
  return canonicalJson(policy);
}

export function stagingSmokeAccessPolicySha256(policy) {
  return createHash('sha256').update(canonicalStagingSmokeAccessPolicyPayload(policy)).digest('hex');
}

export async function loadTrackedStagingSmokeAccessPolicy(root = process.cwd()) {
  let policy;
  try {
    policy = JSON.parse(await readFile(path.join(root, STAGING_SMOKE_ACCESS_POLICY_PATH), 'utf8'));
  } catch {
    throw new Error('CLOUDFLARE_E_STAGING_SMOKE_ACCESS_POLICY');
  }
  return validateStagingSmokeAccessPolicy(policy);
}
