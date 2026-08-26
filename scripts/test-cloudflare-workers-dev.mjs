import assert from 'node:assert/strict';
import {
  canonicalWorkersDevEnableAuthorizationPayload,
  canonicalWorkersDevActiveDeploymentCapturePayload,
  canonicalWorkersDevExecutionCapturePayload,
  canonicalWorkersDevStatusCapturePayload,
  enableWorkersDevAndReadBack,
  fetchWorkersDevStatusCapture,
  validateWorkersDevEnableAuthorization,
  validateWorkersDevExecutionCapture,
  validateWorkersDevStatus,
  validateWorkersDevStatusCapture,
  workersDevMutationRequestSha256,
} from './lib/cloudflare-workers-dev.mjs';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';

const accountId = 'a'.repeat(32);
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const now = new Date('2026-08-26T00:00:00.000Z');
const versionId = '12345678-1234-4123-8123-123456789abc';
const deploymentId = '32345678-1234-4123-8123-123456789abc';
const envelope = (result) => ({ success: true, errors: [], messages: [], result });
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const throws = (action, code) => {
  assert.throws(action, (error) => error?.message === code);
  assertions += 1;
};
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.message === code);
  assertions += 1;
};

const statusFetcher = (enabled, previewsEnabled = false, calls = [], deployment = {
  id: deploymentId,
  versions: [{ version_id: versionId, percentage: 100 }],
}) => async (url, init) => {
  calls.push({ url, init });
  if (url.endsWith('/scripts/dwnc-me-staging/deployments')) {
    return Response.json(envelope({ deployments: [deployment] }));
  }
  if (url.endsWith('/workers/subdomain')) return Response.json(envelope({ subdomain: 'dwnc' }));
  if (url.endsWith('/scripts/dwnc-me-staging/settings')) {
    return Response.json(envelope({
      observability: {
        enabled: true,
        logs: {
          enabled: true, head_sampling_rate: 1, invocation_logs: false, persist: true,
        },
      },
    }));
  }
  if (url.endsWith('/scripts/dwnc-me-staging/subdomain')) {
    return Response.json(envelope({ enabled, previews_enabled: previewsEnabled }));
  }
  throw new Error('unexpected URL');
};
const calls = [];
const before = await fetchWorkersDevStatusCapture({
  accountId,
  apiToken: 'synthetic-workers-token',
  fetchImpl: statusFetcher(false, false, calls),
  now: () => now,
});
equal(calls.length, 3);
equal(calls.every(({ init }) => init.method === 'GET'), true);
validateWorkersDevStatusCapture(before, {
  expected: {
    environment: 'staging', workerName: 'dwnc-me-staging', accountIdSha256,
    origin: 'https://dwnc-me-staging.dwnc.workers.dev', enabled: false,
    previewUrlsEnabled: false,
  },
  now,
});
assertions += 1;
equal(before.evidence.observabilityEnabled, true);
equal(before.evidence.logsHeadSamplingRate, 1);
throws(() => validateWorkersDevStatusCapture({
  ...before,
  settingsRawBody: JSON.stringify(envelope({ observability: { enabled: false } })),
}, { now }), 'CLOUDFLARE_E_WORKERS_DEV_STATUS_CAPTURE');
throws(() => validateWorkersDevStatus(before.evidence, {
  expected: { workerName: 'wrong-worker' }, now,
}), 'CLOUDFLARE_E_WORKERS_DEV_STATUS_EXPECTED');

await rejects(() => fetchWorkersDevStatusCapture({
  accountId,
  apiToken: 'synthetic-workers-token',
  now: () => now,
  fetchImpl: async (url) => {
    if (url.endsWith('/workers/subdomain')) {
      return Response.json(envelope({ subdomain: 'wrong' }));
    }
    if (url.endsWith('/settings')) {
      return Response.json(envelope({
        observability: {
          enabled: true,
          logs: {
            enabled: true, head_sampling_rate: 1, invocation_logs: false, persist: true,
          },
        },
      }));
    }
    return Response.json(envelope({ enabled: false, previews_enabled: false }));
  },
}), 'CLOUDFLARE_E_WORKERS_DEV_STATUS');

const authorization = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-workers-dev-enable-authorization-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  originSha256: sha256Hex('https://dwnc-me-staging.dwnc.workers.dev'),
  versionId,
  deploymentStatusSha256: 'b'.repeat(64),
  beforeStatusSha256: sha256Hex(canonicalJson(before.evidence)),
  mutationRequestSha256: workersDevMutationRequestSha256({ accountIdSha256 }),
  buildUuid: '22345678-1234-4123-8123-123456789abc',
  nonceSha256: 'c'.repeat(64),
  createdAt: '2026-08-26T00:00:00.000Z',
  expiresAt: '2026-08-26T00:10:00.000Z',
};
validateWorkersDevEnableAuthorization(authorization, {
  expected: { accountIdSha256, versionId: authorization.versionId }, now,
});
assertions += 1;
equal(canonicalWorkersDevEnableAuthorizationPayload(authorization).includes(accountId), false);
for (const expected of [
  { environment: 'production' },
  { workerName: 'dwnc-me' },
  { versionId: '32345678-1234-4123-8123-123456789abc' },
]) {
  throws(() => validateWorkersDevEnableAuthorization(authorization, { expected, now }),
    'CLOUDFLARE_E_WORKERS_DEV_AUTHORIZATION_EXPECTED');
}

const mutationCalls = [];
const outcome = await enableWorkersDevAndReadBack({
  accountId,
  apiToken: 'synthetic-workers-token',
  expectedVersionId: versionId,
  expectedDeploymentId: deploymentId,
  now: () => now,
  fetchImpl: async (url, init) => {
    mutationCalls.push({ url, init });
    if (init.method === 'POST') {
      equal(init.headers['cloudflare-workers-script-api-date'], '2025-08-01');
      equal(init.body, canonicalJson({ enabled: true, previews_enabled: false }));
      return Response.json(envelope({ enabled: true, previews_enabled: false }));
    }
    return statusFetcher(true)(url, init);
  },
});
equal(outcome.classification, 'committed');
equal(outcome.after.evidence.enabled, true);
equal(outcome.after.evidence.previewUrlsEnabled, false);
equal(outcome.deploymentUnchanged, true);
equal(mutationCalls.filter(({ init }) => init.method === 'POST').length, 1);
equal(mutationCalls.filter(({ url }) => url.endsWith('/deployments')).length, 2);

const execution = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-workers-dev-enable-execution-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  authorizationSha256: sha256Hex(canonicalWorkersDevEnableAuthorizationPayload(authorization)),
  deploymentStatusSha256: authorization.deploymentStatusSha256,
  signedBeforeStatusSha256: authorization.beforeStatusSha256,
  approvedVersionId: versionId,
  approvedDeploymentId: deploymentId,
  freshBeforeCaptureSha256: sha256Hex(canonicalWorkersDevStatusCapturePayload(before)),
  freshDeploymentBeforeCaptureSha256: sha256Hex(
    canonicalWorkersDevActiveDeploymentCapturePayload(outcome.deploymentBefore)),
  freshDeploymentAfterCaptureSha256: sha256Hex(
    canonicalWorkersDevActiveDeploymentCapturePayload(outcome.deploymentAfter)),
  deploymentBefore: outcome.deploymentBefore,
  deploymentAfter: outcome.deploymentAfter,
  deploymentUnchanged: outcome.deploymentUnchanged,
  mutationRequestSha256: authorization.mutationRequestSha256,
  mutationResult: outcome.mutationResult,
  mutationHttpStatus: outcome.mutationHttpStatus,
  mutationRawBody: outcome.mutationRawBody,
  mutationRawBodySha256: outcome.mutationRawBodySha256,
  classification: outcome.classification,
  afterCaptureSha256: sha256Hex(canonicalWorkersDevStatusCapturePayload(outcome.after)),
  after: outcome.after,
  completedAt: now.toISOString(),
};
validateWorkersDevExecutionCapture(execution, { now });
assertions += 1;
equal(canonicalWorkersDevExecutionCapturePayload(execution).includes(accountId), false);

let postAttempts = 0;
const committedAfterTransportFailure = await enableWorkersDevAndReadBack({
  accountId,
  apiToken: 'synthetic-workers-token',
  expectedVersionId: versionId,
  expectedDeploymentId: deploymentId,
  now: () => now,
  fetchImpl: async (url, init) => {
    if (init.method === 'POST') { postAttempts += 1; throw new Error('transport lost after commit'); }
    return statusFetcher(true)(url, init);
  },
});
equal(postAttempts, 1);
equal(committedAfterTransportFailure.mutationResult, 'failed');
equal(committedAfterTransportFailure.classification, 'committed');

const ambiguous = await enableWorkersDevAndReadBack({
  accountId,
  apiToken: 'synthetic-workers-token',
  expectedVersionId: versionId,
  expectedDeploymentId: deploymentId,
  now: () => now,
  fetchImpl: async (url, init) => {
    if (init.method === 'POST') throw new Error('not committed');
    return statusFetcher(false)(url, init);
  },
});
equal(ambiguous.classification, 'ambiguous');

let preconditionPosts = 0;
await rejects(() => enableWorkersDevAndReadBack({
  accountId,
  apiToken: 'synthetic-workers-token',
  expectedVersionId: versionId,
  expectedDeploymentId: deploymentId,
  now: () => now,
  fetchImpl: async (url, init) => {
    if (init.method === 'POST') preconditionPosts += 1;
    return statusFetcher(false, false, [], {
      id: deploymentId,
      versions: [
        { version_id: versionId, percentage: 50 },
        { version_id: '42345678-1234-4123-8123-123456789abc', percentage: 50 },
      ],
    })(url, init);
  },
}), 'CLOUDFLARE_E_WORKERS_DEV_DEPLOYMENT_CAS');
equal(preconditionPosts, 0);

let deploymentReads = 0;
const raced = await enableWorkersDevAndReadBack({
  accountId,
  apiToken: 'synthetic-workers-token',
  expectedVersionId: versionId,
  expectedDeploymentId: deploymentId,
  now: () => now,
  fetchImpl: async (url, init) => {
    if (url.endsWith('/deployments')) {
      deploymentReads += 1;
      const deployment = deploymentReads === 1
        ? { id: deploymentId, versions: [{ version_id: versionId, percentage: 100 }] }
        : {
          id: '52345678-1234-4123-8123-123456789abc',
          versions: [{ version_id: versionId, percentage: 100 }],
        };
      return Response.json(envelope({ deployments: [deployment] }));
    }
    if (init.method === 'POST') {
      return Response.json(envelope({ enabled: true, previews_enabled: false }));
    }
    return statusFetcher(true)(url, init);
  },
});
equal(raced.classification, 'ambiguous');
equal(raced.deploymentUnchanged, false);

let splitReads = 0;
const splitAfter = await enableWorkersDevAndReadBack({
  accountId,
  apiToken: 'synthetic-workers-token',
  expectedVersionId: versionId,
  expectedDeploymentId: deploymentId,
  now: () => now,
  fetchImpl: async (url, init) => {
    if (url.endsWith('/deployments')) {
      splitReads += 1;
      const versions = splitReads === 1
        ? [{ version_id: versionId, percentage: 100 }]
        : [
          { version_id: versionId, percentage: 50 },
          { version_id: '62345678-1234-4123-8123-123456789abc', percentage: 50 },
        ];
      return Response.json(envelope({ deployments: [{ id: deploymentId, versions }] }));
    }
    if (init.method === 'POST') {
      return Response.json(envelope({ enabled: true, previews_enabled: false }));
    }
    return statusFetcher(true)(url, init);
  },
});
equal(splitAfter.classification, 'ambiguous');
equal(splitAfter.deploymentUnchanged, false);

console.log(JSON.stringify({
  suite: 'cloudflare-workers-dev-control-plane',
  assertions,
  liveNetworkCalls: 0,
  realMutations: 0,
  status: 'PASS',
}, null, 2));
