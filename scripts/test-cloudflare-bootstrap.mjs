import assert from 'node:assert/strict';
import {
  accountWorkersDevSubdomainRequestSha256,
  assertBootstrapCaptureHasNoSensitiveValues,
  BOOTSTRAP_OBSERVABILITY,
  bootstrapArguments,
  bootstrapConfig,
  bootstrapConfigSha256,
  bootstrapDenyWorkerSha256,
  canonicalAccountWorkersDevSubdomainCapturePayload,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
  canonicalBootstrapAttestationPayload,
  canonicalBootstrapAuthorizationPayload,
  canonicalBootstrapDeployOutputCapturePayload,
  canonicalBootstrapPostStateCapturePayload,
  canonicalServiceExistenceCapturePayload,
  canonicalServiceExistenceEvidencePayload,
  createBootstrapPromotionBaseline,
  createBootstrapDeployOutputCapture,
  defaultBootstrapProtectedEvidencePaths,
  DENY_ALL_WORKER_SOURCE,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  fetchAccountWorkersDevSubdomainCapture,
  fetchBootstrapPostStateCapture,
  fetchServiceExistenceCapture,
  parseBootstrapDeployNdjson,
  serviceExistenceRequestSha256,
  validateAccountWorkersDevSubdomainCapture,
  validateAccountWorkersDevSubdomainEvidence,
  validateBootstrapAttestation,
  validateBootstrapAuthorization,
  validateBootstrapPostStateCapture,
  validateBootstrapPostStatePair,
  validateServiceExistenceCapture,
  validateServiceExistenceEvidence,
  verifyBootstrapAttestationFixedCaptures,
} from './lib/cloudflare-bootstrap.mjs';
import {
  fetchBootstrapGet,
  MAX_BOOTSTRAP_RESPONSE_BYTES,
  parseBootstrapJsonBytes,
  readBootstrapResponseBody,
  validateBootstrapResponseDescriptor,
} from './lib/cloudflare-bootstrap-http.mjs';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const throws = (operation, pattern) => { assert.throws(operation, pattern); assertions += 1; };
const rejects = async (operation, pattern) => {
  await assert.rejects(operation, pattern); assertions += 1;
};

const accountId = 'a'.repeat(32);
const apiToken = 'synthetic-token-never-store';
const accountIdSha256 = cloudflareAccountIdSha256(accountId);
const versionId = '22345678-1234-4123-8123-123456789abc';
const deploymentId = '32345678-1234-4123-8123-123456789abc';
const authorizationSha256 = '4'.repeat(64);
const expectedTag = `dwnc-bootstrap-${authorizationSha256.slice(0, 24)}`;
const expectedMessage = `dwnc-deny-bootstrap:${authorizationSha256}`;
const envelope = (result) => JSON.stringify({ success: true, result, errors: [], messages: [] });
const jsonHeaders = (body, extra = {}) => ({
  'content-type': 'application/json; charset=UTF-8',
  'content-length': String(Buffer.byteLength(body)),
  ...extra,
});
const clock = (iso = '2026-08-25T00:02:00.000Z', stepMs = 1) => {
  let current = Date.parse(iso) - stepMs;
  return () => { current += stepMs; return new Date(current); };
};

function assertGetOptions(options, expectedAccept) {
  equal(options.method, 'GET');
  equal(options.redirect, 'error');
  equal(options.headers.authorization, `Bearer ${apiToken}`);
  equal(options.headers.accept, expectedAccept);
  equal(options.headers['accept-encoding'], 'identity');
  equal(Object.keys(options.headers).sort(), ['accept', 'accept-encoding', 'authorization']);
  equal(options.signal instanceof AbortSignal, true);
}

function settingsResult(overrides = {}) {
  const base = {
    logpush: false,
    tail_consumers: [],
    tags: [],
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      redact_query_string: false,
      logs: {
        enabled: true,
        head_sampling_rate: 1,
        invocation_logs: false,
        persist: true,
        destinations: [],
      },
      traces: {
        enabled: false,
        head_sampling_rate: 1,
        persist: true,
        destinations: [],
        propagation_policy: null,
      },
    },
  };
  return { ...base, ...overrides };
}

function multipartBody({
  boundary = 'dwnc-fixture-boundary',
  moduleName = 'deny-all-worker.js',
  moduleSource = DENY_ALL_WORKER_SOURCE,
  filename = true,
  mediaType = true,
  mediaTypeValue = null,
  extraPart = false,
  tolerantWire = false,
  preamble = '',
  epilogue = '',
  transportPadding = '',
} = {}) {
  const disposition = tolerantWire
    ? `cOnTeNt-DisPosiTion: FORM-DATA; filename="${moduleName}"; name="${moduleName}"`
    : `Content-Disposition: form-data; name="${moduleName}"${filename ? `; filename="${moduleName}"` : ''}`;
  const headers = [disposition];
  if (mediaType) headers.push(tolerantWire
    ? `cOnTeNt-TyPe: ${mediaTypeValue ?? 'Application/JavaScript+Module'}`
    : `Content-Type: ${mediaTypeValue ?? 'application/javascript+module'}`);
  if (tolerantWire) headers.push(`Content-Length: ${Buffer.byteLength(moduleSource)}`, 'X-Harmless: yes');
  const parts = [
    `${preamble}--${boundary}${transportPadding}\r\n${headers.join('\r\n')}\r\n\r\n${moduleSource}\r\n`,
  ];
  if (extraPart) {
    parts.push(`--${boundary}${transportPadding}\r\nContent-Disposition: form-data; name="extra.js"\r\n\r\nextra\r\n`);
  }
  parts.push(`--${boundary}--${transportPadding}\r\n${epilogue}`);
  return Buffer.from(parts.join(''), 'utf8');
}

function snapshotFixture({
  environment = 'staging',
  accountSubdomain = EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  workersDevEnabled = false,
  previewsEnabled = false,
  scriptSubdomainExtra = {},
  settings = settingsResult(),
  content = multipartBody(),
  contentType = 'multipart/form-data; boundary=dwnc-fixture-boundary',
  entrypoint = 'deny-all-worker.js',
  version = versionId,
  deployment = deploymentId,
  deploymentAfter = deployment,
  strategy = 'percentage',
  percentage = 100,
  deploymentAfterHistory = [],
  deployableVersions = [{ id: versionId }],
  versionOverrides = {},
  failureSuffix = null,
  calls = [],
} = {}) {
  const workerName = environment === 'staging' ? 'dwnc-me-staging' : 'dwnc-me';
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers`;
  const responses = new Map([
    [`${base}/subdomain`, envelope({ subdomain: accountSubdomain })],
    [`${base}/scripts/${workerName}/subdomain`, envelope({
      enabled: workersDevEnabled, previews_enabled: previewsEnabled, ...scriptSubdomainExtra,
    })],
    [`${base}/scripts/${workerName}/script-settings`, envelope(settings)],
    [`${base}/scripts/${workerName}/versions/${versionId}`, envelope({
      id: version,
      annotations: { 'workers/tag': expectedTag, 'workers/message': expectedMessage },
      resources: { script: { handlers: ['fetch'] }, bindings: [], assets: null },
      ...versionOverrides,
    })],
  ]);
  const contentUrl = `${base}/scripts/${workerName}/content/v2`;
  const versionsUrl = `${base}/scripts/${workerName}/versions?deployable=true`;
  const deploymentsUrl = `${base}/scripts/${workerName}/deployments`;
  let deploymentsCalls = 0;
  return async (url, options) => {
    calls.push({ url, options });
    if (!responses.has(url) && url !== contentUrl && url !== versionsUrl
      && url !== deploymentsUrl) {
      throw new Error('unexpected fixture URL');
    }
    assertGetOptions(options, url === contentUrl
      ? 'multipart/form-data' : 'application/json');
    if (failureSuffix && url.endsWith(failureSuffix)) {
      const body = JSON.stringify({ success: false, result: null, errors: [{ code: 999 }] });
      return new Response(body, { status: 500, headers: jsonHeaders(body) });
    }
    if (url === contentUrl) {
      return new Response(content, { status: 200, headers: {
        'content-type': contentType,
        'content-length': String(content.length),
        ...(entrypoint === null ? {} : { 'cf-entrypoint': entrypoint }),
      } });
    }
    if (url === versionsUrl) {
      const body = envelope({ items: deployableVersions });
      return new Response(body, { status: 200, headers: jsonHeaders(body) });
    }
    if (url === deploymentsUrl) {
      deploymentsCalls += 1;
      if (deploymentsCalls > 2) throw new Error('unexpected deployments call');
      const body = envelope({ deployments: [{
        id: deploymentsCalls === 1 ? deployment : deploymentAfter,
        strategy,
        versions: [{ version_id: versionId, percentage }],
        annotations: { 'workers/message': expectedMessage },
      }, ...(deploymentsCalls === 2 ? deploymentAfterHistory : [])] });
      return new Response(body, { status: 200, headers: jsonHeaders(body) });
    }
    const body = responses.get(url);
    return new Response(body, { status: 200, headers: jsonHeaders(body) });
  };
}

async function createSnapshot(options = {}) {
  return fetchBootstrapPostStateCapture({
    environment: options.environment ?? 'staging',
    accountId,
    apiToken,
    versionId,
    expectedTag,
    expectedMessage,
    fetchImpl: snapshotFixture(options),
    now: options.now ?? clock(),
  });
}

// The common reader accepts exactly 1 MiB and cancels at the first byte beyond it.
const exactLimit = Buffer.alloc(MAX_BOOTSTRAP_RESPONSE_BYTES, 0x61);
equal((await readBootstrapResponseBody(new Response(exactLimit, { headers: {
  'content-length': String(exactLimit.length),
} }))).bytes.length, MAX_BOOTSTRAP_RESPONSE_BYTES);

const producerChunks = [Uint8Array.from([0x61, 0x62]), Uint8Array.from([0x63])];
let producerIndex = 0;
const produced = await readBootstrapResponseBody({
  headers: new Headers({ 'content-length': '3' }),
  body: { getReader: () => ({
    read: async () => producerIndex < producerChunks.length
      ? { done: false, value: producerChunks[producerIndex++] }
      : { done: true },
    cancel: async () => undefined,
  }) },
});
equal(produced.bytes.toString('utf8'), 'abc');
equal([...producerChunks[0]], [0, 0]);
equal([...producerChunks[1]], [0]);
produced.bytes.fill(0);

let precheckCancelled = 0;
await rejects(() => readBootstrapResponseBody({
  headers: new Headers({ 'content-length': String(MAX_BOOTSTRAP_RESPONSE_BYTES + 1) }),
  body: { cancel: async () => { precheckCancelled += 1; } },
}), /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_BODY/u);
equal(precheckCancelled, 1);

let streamedCancelled = 0;
const overflowStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(MAX_BOOTSTRAP_RESPONSE_BYTES));
    controller.enqueue(new Uint8Array(1));
  },
  cancel() { streamedCancelled += 1; },
});
await rejects(() => readBootstrapResponseBody(new Response(overflowStream)),
  /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_BODY/u);
equal(streamedCancelled, 1);

let infiniteCancelled = 0;
const infiniteStream = new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(64 * 1024)); },
  cancel() { infiniteCancelled += 1; },
});
await rejects(() => readBootstrapResponseBody(new Response(infiniteStream)),
  /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_BODY/u);
equal(infiniteCancelled, 1);

let zeroChunkCancelled = 0;
const zeroChunkStream = new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(0)); },
  cancel() { zeroChunkCancelled += 1; },
});
await rejects(() => readBootstrapResponseBody(new Response(zeroChunkStream)),
  /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_BODY/u);
equal(zeroChunkCancelled, 1);

let invalidLengthCancelled = 0;
await rejects(() => readBootstrapResponseBody({
  headers: new Headers({ 'content-length': '1.5' }),
  body: { cancel: async () => { invalidLengthCancelled += 1; } },
}), /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_BODY/u);
equal(invalidLengthCancelled, 1);
await rejects(() => readBootstrapResponseBody(new Response('a', {
  headers: { 'content-length': '2' },
})), /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_BODY/u);

equal(parseBootstrapJsonBytes(Buffer.from('{"ok":true}'),
  'Application/JSON; Charset="UTF-8"', 'JSON_E').value.ok, true);
for (const [bytes, type] of [
  [Buffer.from([0xc3, 0x28]), 'application/json'],
  [Buffer.from('{}'), 'text/json'],
  [Buffer.from('{}'), 'application/json; charset=iso-8859-1'],
  [Buffer.from('{}'), 'application/problem+json'],
]) {
  throws(() => parseBootstrapJsonBytes(bytes, type, 'JSON_E'), /JSON_E/u);
}

for (const contentEncoding of ['gzip', 'br']) {
  let bodyCancelled = 0;
  let bodyReaderCalls = 0;
  await rejects(() => fetchBootstrapGet({
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
    apiToken,
    role: 'account-workers-dev-subdomain',
    environment: 'staging',
    workerName: 'dwnc-me-staging',
    accountIdSha256,
    expectedStatuses: [200],
    bodyKind: 'json',
    now: clock(),
    errorCode: 'SYNTHETIC_ENCODING_E',
    fetchImpl: async (url, options) => {
      equal(url,
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`);
      assertGetOptions(options, 'application/json');
      return {
        status: 200,
        headers: new Headers({
          'content-encoding': contentEncoding,
          'content-type': 'application/json',
        }),
        body: {
          async cancel() { bodyCancelled += 1; },
          getReader() { bodyReaderCalls += 1; throw new Error('must not read'); },
        },
      };
    },
  }), /SYNTHETIC_ENCODING_E/u);
  equal(bodyCancelled, 1);
  equal(bodyReaderCalls, 0);
}

// An HTTP error body is still bounded and cancelled before its status is rejected.
let errorFetchCalls = 0;
let errorBodyCancelled = 0;
await rejects(() => fetchBootstrapGet({
  url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
  apiToken,
  role: 'account-workers-dev-subdomain',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  expectedStatuses: [200],
  bodyKind: 'json',
  now: clock(),
  errorCode: 'SYNTHETIC_FETCH_E',
  fetchImpl: async (url, options) => {
    errorFetchCalls += 1;
    equal(url,
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`);
    assertGetOptions(options, 'application/json');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700 * 1024));
        controller.enqueue(new Uint8Array(400 * 1024));
      },
      cancel() { errorBodyCancelled += 1; },
    });
    return new Response(body, { status: 500, headers: { 'content-type': 'application/json' } });
  },
}), /SYNTHETIC_FETCH_E/u);
equal(errorFetchCalls, 1);
equal(errorBodyCancelled, 1);

let rejectedTargetFetches = 0;
for (const targetUrl of [
  `https://api.cloudflare.com/client/v4/accounts/${'b'.repeat(32)}/workers/subdomain`,
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/dwnc-me-staging/subdomain`,
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain?unexpected=1`,
]) {
  await rejects(() => fetchBootstrapGet({
    url: targetUrl,
    apiToken,
    role: 'account-workers-dev-subdomain',
    environment: 'staging',
    workerName: 'dwnc-me-staging',
    accountIdSha256,
    expectedStatuses: [200],
    bodyKind: 'json',
    now: clock(),
    errorCode: 'SYNTHETIC_TARGET_E',
    fetchImpl: async () => { rejectedTargetFetches += 1; return new Response('{}'); },
  }), /SYNTHETIC_TARGET_E/u);
}
equal(rejectedTargetFetches, 0);

// Service absence and account subdomain captures use the exact safe GET options.
for (const environment of ['production', 'staging']) {
  const workerName = environment === 'production' ? 'dwnc-me' : 'dwnc-me-staging';
  const missingBody = JSON.stringify({
    success: false, result: null, errors: [{ code: 10007, message: 'not found' }],
  });
  let serviceCalls = 0;
  const serviceClock = clock();
  const serviceCapture = await fetchServiceExistenceCapture({
    environment, accountId, apiToken, now: serviceClock,
    fetchImpl: async (url, options) => {
      serviceCalls += 1;
      equal(url,
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${workerName}`);
      assertGetOptions(options, 'application/json');
      return new Response(missingBody, { status: 404, headers: jsonHeaders(missingBody) });
    },
  });
  equal(serviceCalls, 1);
  equal(serviceCapture.evidence.requestCompletedAt, serviceCapture.evidence.observedAt);
  validateServiceExistenceCapture(serviceCapture, {
    expected: { environment, workerName, accountIdSha256, exists: false },
    now: new Date(serviceCapture.evidence.observedAt),
  }); assertions += 1;
  throws(() => validateServiceExistenceCapture(serviceCapture, {
    now: new Date(serviceCapture.evidence.observedAt), maxAgeSeconds: 0,
  }), /CLOUDFLARE_E_SERVICE_EXISTENCE_CAPTURE_EXPIRED/u);
  equal(serviceCapture.requestSha256,
    serviceExistenceRequestSha256({ environment, accountIdSha256 }));
  let accountCalls = 0;
  const accountBody = envelope({ subdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN });
  const accountCapture = await fetchAccountWorkersDevSubdomainCapture({
    environment, accountId, apiToken, now: clock(),
    fetchImpl: async (url, options) => {
      accountCalls += 1;
      equal(url,
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`);
      assertGetOptions(options, 'application/json');
      return new Response(accountBody, { status: 200, headers: jsonHeaders(accountBody) });
    },
  });
  equal(accountCalls, 1);
  validateAccountWorkersDevSubdomainCapture(accountCapture, {
    expected: { environment, workerName, accountIdSha256 },
    now: new Date(accountCapture.evidence.observedAt),
  }); assertions += 1;
  throws(() => validateAccountWorkersDevSubdomainCapture(accountCapture, {
    now: new Date(accountCapture.evidence.observedAt), maxAgeSeconds: 301,
  }), /CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_CAPTURE_EXPIRED/u);
  validateAccountWorkersDevSubdomainEvidence(accountCapture.evidence, {
    now: new Date(accountCapture.evidence.observedAt),
  }); assertions += 1;
  equal(accountCapture.requestSha256,
    accountWorkersDevSubdomainRequestSha256({ environment, accountIdSha256 }));

  const config = bootstrapConfig(environment);
  equal(config.workers_dev, false);
  equal(config.preview_urls, false);
  equal(config.logpush, false);
  equal(config.tail_consumers, []);
  equal(config.observability, BOOTSTRAP_OBSERVABILITY);
  equal(config.observability.traces.enabled, false);
  equal(config.observability.logs.destinations, []);
  equal(config.observability.traces.destinations, []);
}

const badJsonBytes = Buffer.from([0xc3, 0x28]);
await rejects(() => fetchServiceExistenceCapture({
  environment: 'staging', accountId, apiToken, now: clock(),
  fetchImpl: async () => new Response(badJsonBytes, {
    status: 404, headers: { 'content-type': 'application/json' },
  }),
}), /CLOUDFLARE_E_SERVICE_EXISTENCE_FETCH/u);
for (const contentType of ['text/plain', 'application/json; charset=latin1']) {
  await rejects(() => fetchAccountWorkersDevSubdomainCapture({
    environment: 'staging', accountId, apiToken, now: clock(),
    fetchImpl: async () => new Response(envelope({ subdomain: 'dwnc' }), {
      status: 200, headers: { 'content-type': contentType },
    }),
  }), /CLOUDFLARE_E_ACCOUNT_SUBDOMAIN_FETCH/u);
}
await rejects(() => fetchAccountWorkersDevSubdomainCapture({
  environment: 'staging', accountId, apiToken, now: clock(),
  fetchImpl: async () => {
    const body = envelope({ subdomain: 'wrong-account' });
    return new Response(body, { status: 200, headers: jsonHeaders(body) });
  },
}), /CLOUDFLARE_E_BOOTSTRAP_ACCOUNT_SUBDOMAIN_RESPONSE/u);

const mixedCaseToken = [...apiToken]
  .map((character, index) => index % 2 === 0 ? character.toUpperCase() : character.toLowerCase())
  .join('');
const escapedLeakLiterals = [
  '\\u0061'.repeat(32),
  mixedCaseToken,
  String.raw`HTTPS:\/\/API.CLOUDFLARE.COM\/client\/v4\/accounts\/hidden`,
  String.raw`HTTP:\/\/API.CLOUDFLARE.COM:80\/client\/v4\/accounts\/hidden`,
  'Bearer unrelated-secret-value',
  String.raw`FiLe:\/\/\/Users\/synthetic\/secret.json`,
  String.raw`C:\\Sensitive\\secret.json`,
  String.raw`\\\\server\\share\\secret.json`,
];
for (const literal of escapedLeakLiterals) {
  const body = `{"success":false,"result":null,"errors":[{"code":10007,"message":"${literal}"}]}`;
  await rejects(() => fetchServiceExistenceCapture({
    environment: 'staging', accountId, apiToken, now: clock(),
    fetchImpl: async () => new Response(body, {
      status: 404, headers: jsonHeaders(body),
    }),
  }), /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
}
for (const message of [accountId.toUpperCase(), mixedCaseToken,
  'HTTPS://API.CLOUDFLARE.COM/client/v4/accounts/hidden']) {
  const body = JSON.stringify({
    success: true, result: { subdomain: 'dwnc' }, errors: [], messages: [{ message }],
  });
  await rejects(() => fetchAccountWorkersDevSubdomainCapture({
    environment: 'staging', accountId, apiToken, now: clock(),
    fetchImpl: async () => new Response(body, { status: 200, headers: jsonHeaders(body) }),
  }), /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
}
const safeRelativeMessageBody = JSON.stringify({
  success: true, result: { subdomain: 'dwnc' }, errors: [],
  messages: [{ message: 'docs/evidence/relative-name.json' }],
});
await fetchAccountWorkersDevSubdomainCapture({
  environment: 'staging', accountId, apiToken, now: clock(),
  fetchImpl: async () => new Response(safeRelativeMessageBody, {
    status: 200, headers: jsonHeaders(safeRelativeMessageBody),
  }),
}); assertions += 1;
await rejects(() => fetchAccountWorkersDevSubdomainCapture({
  environment: 'staging', accountId, apiToken, now: clock(),
  fetchImpl: async () => {
    const body = envelope({ subdomain: 'dwnc', unexpected_surface: false });
    return new Response(body, { status: 200, headers: jsonHeaders(body) });
  },
}), /CLOUDFLARE_E_BOOTSTRAP_ACCOUNT_SUBDOMAIN_RESPONSE/u);

// A full snapshot binds every authoritative endpoint and exact request options.
const calls = [];
const validSnapshot = await createSnapshot({ calls, now: clock() });
equal(calls.length, 8);
equal(validSnapshot.responses.map((response) => response.role), [
  'deployments-before',
  'versions-list',
  'account-workers-dev-subdomain', 'script-workers-dev-subdomain', 'script-settings',
  'script-content-v2', 'version-detail', 'deployments-after',
]);
equal(validSnapshot.evidence.deploymentId, deploymentId);
equal(validSnapshot.evidence.deploymentStrategy, 'percentage');
equal(validSnapshot.evidence.deploymentVersions, [{ versionId, percentage: 100 }]);
equal(validSnapshot.evidence.deployableVersionIds, [versionId]);
equal(validSnapshot.evidence.deploymentMessage, expectedMessage);
equal(validSnapshot.evidence.workersDevEnabled, false);
equal(validSnapshot.evidence.previewsEnabled, false);
equal(validSnapshot.evidence.tracesEnabled, false);
equal(validSnapshot.evidence.redactQueryString, false);
equal(validSnapshot.evidence.tracesPropagationPolicy, null);
equal(validSnapshot.evidence.denyModuleSha256, bootstrapDenyWorkerSha256());
equal(validSnapshot.evidence.denyModuleBytes, Buffer.byteLength(DENY_ALL_WORKER_SOURCE));
await validateBootstrapPostStateCapture(validSnapshot, {
  expected: { accountIdSha256, versionId, deploymentId },
  now: new Date(validSnapshot.observationCompletedAt),
}); assertions += 1;

const descriptor = validSnapshot.responses[0].descriptor;
throws(() => validateBootstrapResponseDescriptor({
  ...descriptor, requestCompletedAt: new Date(Date.parse(descriptor.requestStartedAt) - 1).toISOString(),
}), /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_DESCRIPTOR/u);
throws(() => validateBootstrapResponseDescriptor({
  ...descriptor,
  requestCompletedAt: new Date(Date.parse(descriptor.requestStartedAt) + 15_001).toISOString(),
}), /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_DESCRIPTOR/u);
throws(() => validateBootstrapResponseDescriptor(descriptor, {
  observationStartedAt: new Date(Date.parse(descriptor.requestStartedAt) + 1).toISOString(),
  observationCompletedAt: validSnapshot.observationCompletedAt,
}), /CLOUDFLARE_E_BOOTSTRAP_RESPONSE_DESCRIPTOR/u);

const pairClock = clock('2026-08-25T00:03:00.000Z');
const before = await createSnapshot({ now: pairClock });
const after = await createSnapshot({ now: pairClock });
await validateBootstrapPostStatePair(before, after, {
  expected: { accountIdSha256, versionId, deploymentId },
  now: new Date(after.observationCompletedAt),
}); assertions += 1;

const overlappingBefore = await createSnapshot({ now: clock('2026-08-25T00:03:30.000Z') });
const overlappingAfter = await createSnapshot({ now: clock('2026-08-25T00:03:30.000Z') });
await rejects(() => validateBootstrapPostStatePair(overlappingBefore, overlappingAfter, {
  now: new Date(overlappingAfter.observationCompletedAt),
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS/u);
const longWindowBefore = await createSnapshot({ now: clock('2026-08-25T00:10:00.000Z') });
const longWindowAfter = await createSnapshot({ now: clock('2026-08-25T00:11:00.001Z') });
await rejects(() => validateBootstrapPostStatePair(longWindowBefore, longWindowAfter, {
  now: new Date(longWindowAfter.observationCompletedAt), maxAgeSeconds: 300,
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS/u);

// Standard multipart variations are accepted while the one-module byte contract stays exact.
const tolerantBoundary = 'DwncQuotedBoundary-123';
const tolerantSnapshot = await createSnapshot({
  now: clock(),
  content: multipartBody({ boundary: tolerantBoundary, tolerantWire: true }),
  contentType: `MULTIPART/FORM-DATA; x-harmless=1; boundary="${tolerantBoundary}"`,
});
equal(tolerantSnapshot.evidence.mediaTypeSource, 'part-header');
equal(tolerantSnapshot.evidence.entrypointSource, 'cf-entrypoint');
const inferredSnapshot = await createSnapshot({
  now: clock(),
  content: multipartBody({ filename: false, mediaType: false }),
  entrypoint: null,
});
equal(inferredSnapshot.evidence.mediaTypeSource, 'absent');
equal(inferredSnapshot.evidence.filenameSource, 'absent');
equal(inferredSnapshot.evidence.entrypointSource, 'single-module-inference');
const omittedFilenameSnapshot = await createSnapshot({
  now: clock(), content: multipartBody({ filename: false }),
});
equal(omittedFilenameSnapshot.evidence.mediaTypeSource, 'part-header');
equal(omittedFilenameSnapshot.evidence.filenameSource, 'absent');
const omittedMediaTypeSnapshot = await createSnapshot({
  now: clock(), content: multipartBody({ mediaType: false }),
});
equal(omittedMediaTypeSnapshot.evidence.mediaTypeSource, 'absent');
equal(omittedMediaTypeSnapshot.evidence.filenameSource, 'filename');
const parameterizedMediaTypeSnapshot = await createSnapshot({
  now: clock(),
  content: multipartBody({ mediaTypeValue: 'Application/JavaScript+Module; Charset=UTF-8' }),
});
equal(parameterizedMediaTypeSnapshot.evidence.mediaTypeSource, 'part-header');
const framedSnapshot = await createSnapshot({
  now: clock(),
  content: multipartBody({
    preamble: 'This preamble is not a form field.\r\n',
    epilogue: 'This epilogue is not a form field.\r\n',
    transportPadding: ' \t',
  }),
});
equal(framedSnapshot.evidence.denyModuleSha256, bootstrapDenyWorkerSha256());
const omittedOptionalSettings = settingsResult();
delete omittedOptionalSettings.logpush;
delete omittedOptionalSettings.tail_consumers;
delete omittedOptionalSettings.tags;
delete omittedOptionalSettings.observability.head_sampling_rate;
delete omittedOptionalSettings.observability.redact_query_string;
delete omittedOptionalSettings.observability.logs.destinations;
delete omittedOptionalSettings.observability.logs.persist;
delete omittedOptionalSettings.observability.traces;
const omittedSettingsSnapshot = await createSnapshot({
  now: clock(), settings: omittedOptionalSettings,
});
equal(omittedSettingsSnapshot.evidence.logpush, false);
equal(omittedSettingsSnapshot.evidence.logsPersist, true);
equal(omittedSettingsSnapshot.evidence.tracesEnabled, false);
equal(omittedSettingsSnapshot.evidence.tracesPropagationPolicy, null);
const nullableSettings = settingsResult();
nullableSettings.tail_consumers = null;
nullableSettings.tags = null;
nullableSettings.observability.head_sampling_rate = null;
nullableSettings.observability.logs.head_sampling_rate = null;
nullableSettings.observability.logs.destinations = null;
nullableSettings.observability.traces = null;
const nullableSettingsSnapshot = await createSnapshot({ now: clock(), settings: nullableSettings });
equal(nullableSettingsSnapshot.evidence.observabilityHeadSamplingRate, 1);
equal(nullableSettingsSnapshot.evidence.logsHeadSamplingRate, 1);
equal(nullableSettingsSnapshot.evidence.tracesEnabled, false);
const omittedBindingsSnapshot = await createSnapshot({
  now: clock(),
  versionOverrides: { resources: { script: { handlers: ['fetch'] }, assets: null } },
});
equal(omittedBindingsSnapshot.evidence.bindingsEmpty, true);

for (const options of [
  { content: multipartBody({ extraPart: true }) },
  { content: multipartBody({ moduleName: 'other.js' }) },
  { content: multipartBody({ moduleSource: `${DENY_ALL_WORKER_SOURCE} ` }) },
  { entrypoint: 'other.js' },
  { contentType: 'application/javascript' },
  { contentType: 'multipart/form-data; boundary=dwnc-fixture-boundary; boundary=duplicate' },
  { content: Buffer.from('--dwnc-fixture-boundary\r\nmissing close', 'utf8') },
]) {
  await rejects(() => createSnapshot({ ...options, now: clock() }),
    /CLOUDFLARE_E_BOOTSTRAP_(?:SCRIPT_CONTENT|POST_STATE_FETCH|POST_STATE_CAPTURE)/u);
}

const unsafeSettings = [
  { ...settingsResult(), logpush: true },
  { ...settingsResult(), tail_consumers: [{ service: 'tail' }] },
  { ...settingsResult(), tags: ['unsafe'] },
  { ...settingsResult(), unknown_field: true },
  { ...settingsResult(), observability: { ...settingsResult().observability, enabled: false } },
  { ...settingsResult(), observability: { ...settingsResult().observability, head_sampling_rate: 0.5 } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    redact_query_string: true } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    logs: { ...settingsResult().observability.logs, enabled: false } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    logs: { ...settingsResult().observability.logs, invocation_logs: true } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    logs: { ...settingsResult().observability.logs, head_sampling_rate: 0.5 } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    logs: { ...settingsResult().observability.logs, destinations: ['sink'] } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    logs: { ...settingsResult().observability.logs, persist: false } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    logs: { ...settingsResult().observability.logs, persist: null } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    traces: { ...settingsResult().observability.traces, enabled: true } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    traces: { ...settingsResult().observability.traces, head_sampling_rate: 0.5 } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    traces: { ...settingsResult().observability.traces, destinations: ['sink'] } } },
  { ...settingsResult(), observability: { ...settingsResult().observability,
    traces: { ...settingsResult().observability.traces, propagation_policy: 'authenticated' } } },
];
for (const settings of unsafeSettings) {
  await rejects(() => createSnapshot({ settings, now: clock() }),
    /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_(?:RESPONSE|CAPTURE)/u);
}
for (const options of [
  { workersDevEnabled: true },
  { previewsEnabled: true },
  { scriptSubdomainExtra: { unexpected_surface: false } },
  { version: '42345678-1234-4123-8123-123456789abc' },
  { versionOverrides: { resources: { script: { handlers: ['fetch', 'scheduled'] }, bindings: [], assets: null } } },
  { versionOverrides: { resources: { script: { handlers: ['fetch'] }, bindings: [{}], assets: null } } },
  { versionOverrides: { resources: { script: { handlers: ['fetch'] }, bindings: null, assets: null } } },
  { versionOverrides: { resources: { script: { handlers: ['fetch'] }, bindings: [], assets: {} } } },
  { deployment: 'not-a-uuid' },
  { strategy: 'gradual' },
  { percentage: 99 },
  { deployableVersions: [{ id: versionId }, { id: '42345678-1234-4123-8123-123456789abc' }] },
  { failureSuffix: '/script-settings' },
]) {
  await rejects(() => createSnapshot({ ...options, now: clock() }),
    /CLOUDFLARE_E_BOOTSTRAP_(?:POST_STATE|ATTESTATION)/u);
}

await rejects(() => createSnapshot({
  now: clock(), deploymentAfter: '52345678-1234-4123-8123-123456789abc',
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS/u);
await rejects(() => createSnapshot({
  now: clock(),
  deploymentAfterHistory: [{
    id: '52345678-1234-4123-8123-123456789abc',
    strategy: 'percentage',
    versions: [{ version_id: versionId, percentage: 100 }],
  }],
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS/u);

// Same 100% version with a different deployment identity is a CAS failure.
const driftClock = clock('2026-08-25T00:04:00.000Z');
const stableBefore = await createSnapshot({ now: driftClock });
const changedDeployment = await createSnapshot({
  now: driftClock, deployment: '52345678-1234-4123-8123-123456789abc',
});
await rejects(() => validateBootstrapPostStatePair(stableBefore, changedDeployment, {
  now: new Date(changedDeployment.observationCompletedAt),
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS/u);
const sourceShiftClock = clock('2026-08-25T00:05:00.000Z');
const headerEntrypoint = await createSnapshot({ now: sourceShiftClock });
const inferredEntrypoint = await createSnapshot({
  now: sourceShiftClock,
  content: multipartBody({ filename: false, mediaType: false }), entrypoint: null,
});
await rejects(() => validateBootstrapPostStatePair(headerEntrypoint, inferredEntrypoint, {
  now: new Date(inferredEntrypoint.observationCompletedAt),
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAS/u);

const tamperedResponse = structuredClone(validSnapshot);
tamperedResponse.responses[2].descriptor.requestTargetSha256 = 'f'.repeat(64);
await rejects(() => validateBootstrapPostStateCapture(tamperedResponse, {
  now: new Date(validSnapshot.observationCompletedAt),
}), /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE/u);
const staleSnapshot = structuredClone(validSnapshot);
await rejects(() => validateBootstrapPostStateCapture(staleSnapshot, {
  now: new Date(Date.parse(staleSnapshot.observationCompletedAt) + 15_001),
}), /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_EXPIRED/u);
const futureSnapshot = structuredClone(validSnapshot);
await rejects(() => validateBootstrapPostStateCapture(futureSnapshot, {
  now: new Date(Date.parse(futureSnapshot.observationCompletedAt) - 2_001),
}), /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_EXPIRED/u);
const refreshDescriptorSha = (snapshot) => {
  snapshot.evidence.responseDescriptorsSha256 = sha256Hex(canonicalJson(
    snapshot.responses.map((response) => response.descriptor),
  ));
};
const middleStartedBeforeFence = structuredClone(validSnapshot);
middleStartedBeforeFence.responses[1].descriptor.requestStartedAt = new Date(
  Date.parse(middleStartedBeforeFence.responses[0].descriptor.requestCompletedAt) - 1,
).toISOString();
refreshDescriptorSha(middleStartedBeforeFence);
await rejects(() => validateBootstrapPostStateCapture(middleStartedBeforeFence, {
  now: new Date(middleStartedBeforeFence.observationCompletedAt),
}), /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE/u);
const middleCompletedAfterFence = structuredClone(validSnapshot);
middleCompletedAfterFence.responses[1].descriptor.requestCompletedAt = new Date(
  Date.parse(middleCompletedAfterFence.responses.at(-1).descriptor.requestStartedAt) + 1,
).toISOString();
refreshDescriptorSha(middleCompletedAfterFence);
await rejects(() => validateBootstrapPostStateCapture(middleCompletedAfterFence, {
  now: new Date(middleCompletedAfterFence.observationCompletedAt),
}), /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE/u);

const fixedFreshAbsence = await fetchServiceExistenceCapture({
  environment: 'staging', accountId, apiToken, ttlSeconds: 15,
  now: clock('2026-08-25T00:02:58.000Z'),
  fetchImpl: async () => {
    const body = JSON.stringify({
      success: false, result: null, errors: [{ code: 10007, message: 'not found' }],
    });
    return new Response(body, { status: 404, headers: jsonHeaders(body) });
  },
});
const fixedFreshAccount = await fetchAccountWorkersDevSubdomainCapture({
  environment: 'staging', accountId, apiToken, ttlSeconds: 15,
  now: clock('2026-08-25T00:02:58.100Z'),
  fetchImpl: async () => {
    const body = envelope({ subdomain: 'dwnc' });
    return new Response(body, { status: 200, headers: jsonHeaders(body) });
  },
});
const deployArguments = bootstrapArguments({ environment: 'staging', authorizationSha256 });
const deployOutputBytes = Buffer.from(`${JSON.stringify({
  type: 'wrangler-session', wrangler_version: '4.125.0', command_line_args: deployArguments,
})}\n${JSON.stringify({
  type: 'deploy', version: 1, worker_name: 'dwnc-me-staging',
  worker_name_overridden: false, version_id: versionId, targets: [],
})}\n`, 'utf8');
const fixedDeployOutput = createBootstrapDeployOutputCapture(deployOutputBytes, {
  environment: 'staging', authorizationSha256,
  commandStartedAt: '2026-08-25T00:02:59.000Z',
  commandCompletedAt: '2026-08-25T00:02:59.999Z',
});
await assertBootstrapCaptureHasNoSensitiveValues(fixedDeployOutput, {
  accountId, apiToken,
}); assertions += 1;
deployOutputBytes.fill(0);

function attestationFromSnapshots(snapshotBefore, snapshotAfter, environment = 'staging') {
  const state = snapshotBefore.evidence;
  const attestedAt = new Date(Date.parse(snapshotAfter.observationCompletedAt) + 1).toISOString();
  return {
    schemaVersion: 2,
    contract: 'dwnc-cloudflare-deny-bootstrap-attestation-v2',
    environment,
    workerName: environment === 'staging' ? 'dwnc-me-staging' : 'dwnc-me',
    accountIdSha256,
    accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
    sourceGitSha: '1'.repeat(40),
    versionId,
    deploymentId: state.deploymentId,
    deploymentStrategy: state.deploymentStrategy,
    deploymentVersions: state.deploymentVersions,
    denyWorkerSha256: bootstrapDenyWorkerSha256(),
    bootstrapConfigSha256: bootstrapConfigSha256(environment),
    serviceEvidenceSha256: '2'.repeat(64),
    accountSubdomainEvidenceSha256: '3'.repeat(64),
    freshAbsenceCaptureSha256: sha256Hex(
      canonicalServiceExistenceCapturePayload(fixedFreshAbsence),
    ),
    freshAccountSubdomainCaptureSha256: sha256Hex(
      canonicalAccountWorkersDevSubdomainCapturePayload(fixedFreshAccount),
    ),
    deploymentOutputSha256: fixedDeployOutput.rawOutputSha256,
    deploymentOutputCaptureSha256: sha256Hex(
      canonicalBootstrapDeployOutputCapturePayload(fixedDeployOutput),
    ),
    beforeCaptureSha256: sha256Hex(canonicalBootstrapPostStateCapturePayload(snapshotBefore)),
    afterCaptureSha256: sha256Hex(canonicalBootstrapPostStateCapturePayload(snapshotAfter)),
    beforeResponseDescriptorsSha256: state.responseDescriptorsSha256,
    afterResponseDescriptorsSha256: snapshotAfter.evidence.responseDescriptorsSha256,
    beforeResponses: snapshotBefore.responses.map((response) => response.descriptor),
    afterResponses: snapshotAfter.responses.map((response) => response.descriptor),
    semanticStateSha256: state.semanticStateSha256,
    settingsPolicySha256: state.settingsPolicySha256,
    denyModuleSha256: state.denyModuleSha256,
    denyModuleBytes: state.denyModuleBytes,
    workersDevEnabled: false,
    previewsEnabled: false,
    logpush: false,
    tailConsumersEmpty: true,
    tagsEmpty: true,
    observabilityEnabled: true,
    tracesEnabled: false,
    logsDestinationsEmpty: true,
    tracesDestinationsEmpty: true,
    bindingsEmpty: true,
    assetsAbsent: true,
    entrypointSource: state.entrypointSource,
    deploymentStartedAt: fixedDeployOutput.commandStartedAt,
    deploymentCompletedAt: fixedDeployOutput.commandCompletedAt,
    snapshotBeforeStartedAt: snapshotBefore.observationStartedAt,
    snapshotBeforeCompletedAt: snapshotBefore.observationCompletedAt,
    snapshotAfterStartedAt: snapshotAfter.observationStartedAt,
    snapshotAfterCompletedAt: snapshotAfter.observationCompletedAt,
    attestedAt,
  };
}

const attestation = attestationFromSnapshots(before, after);
validateBootstrapAttestation(attestation, { now: new Date(attestation.attestedAt) }); assertions += 1;
throws(() => validateBootstrapAttestation({
  ...attestation,
  attestedAt: new Date(Date.parse(attestation.snapshotAfterCompletedAt) + 15_001).toISOString(),
}, { now: new Date(Date.parse(attestation.snapshotAfterCompletedAt) + 15_001) }),
/CLOUDFLARE_E_BOOTSTRAP_ATTESTATION/u);
throws(() => validateBootstrapAttestation(attestation, {
  now: new Date(Date.parse(attestation.attestedAt) - 2_001),
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION/u);
throws(() => validateBootstrapAttestation(attestation, {
  now: new Date(Date.parse(attestation.attestedAt) + 300_001),
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION/u);
equal('externalSurfaceCount' in attestation, false);
equal('denyScriptVerified' in attestation, false);
for (const mutation of [
  { deploymentStrategy: 'other' },
  { workersDevEnabled: true },
  { previewsEnabled: true },
  { logpush: true },
  { tailConsumersEmpty: false },
  { tracesEnabled: true },
]) {
  throws(() => validateBootstrapAttestation({ ...attestation, ...mutation }),
    /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION/u);
}

// Fixed paths cannot be selected through argv/env and the verifier re-reads raw captures.
const paths = defaultBootstrapProtectedEvidencePaths({
  environment: 'staging', authorizationSha256, home: '/synthetic/home',
});
equal(paths.directory,
  `/synthetic/home/Library/Application Support/dwnc.me/stage3/bootstrap/staging/${authorizationSha256}`);
equal(paths.before.recovery, pathJoin(paths.directory, 'post-state-before-recovery.json'));
equal(paths.after.recovery, pathJoin(paths.directory, 'post-state-after-recovery.json'));
equal(paths.deployOutput.recovery, pathJoin(paths.directory, 'wrangler-deploy-output-recovery.json'));
equal(paths.prepared, pathJoin(paths.directory, 'attempt-prepared.json'));
equal(paths.started, pathJoin(paths.directory, 'attempt-started.json'));
equal(paths.result, pathJoin(paths.directory, 'attempt-result.json'));
equal(paths.status.recovery, pathJoin(paths.directory, 'attempt-status-recovery.json'));
throws(() => defaultBootstrapProtectedEvidencePaths({
  environment: 'staging', authorizationSha256, home: 'relative',
}), /CLOUDFLARE_E_BOOTSTRAP_EVIDENCE_PATH/u);
await assertBootstrapCaptureHasNoSensitiveValues(before, { accountId, apiToken }); assertions += 1;
await rejects(() => assertBootstrapCaptureHasNoSensitiveValues({ ...before, apiToken }, {
  accountId, apiToken,
}), /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
await rejects(() => assertBootstrapCaptureHasNoSensitiveValues({ ...before,
  requestUrl: 'https://api.cloudflare.com/client/v4/accounts/raw' }, { accountId, apiToken }),
  /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
for (const secret of [accountId.toUpperCase(), apiToken,
  'https://api.cloudflare.com/client/v4/accounts/raw', '/Users/synthetic/private/capture.json',
  '/Applications/Synthetic.app/private.json', '/srv/dwnc/private.json']) {
  const bodySecret = structuredClone(before);
  bodySecret.responses[0].decodedBodyBase64 = Buffer.from(secret, 'utf8').toString('base64');
  await rejects(() => assertBootstrapCaptureHasNoSensitiveValues(bodySecret, { accountId, apiToken }),
    /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
}
const malformedBodyEncoding = structuredClone(before);
malformedBodyEncoding.responses[0].decodedBodyBase64 = '***not-base64***';
await rejects(() => assertBootstrapCaptureHasNoSensitiveValues(malformedBodyEncoding, {
  accountId, apiToken,
}), /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
await rejects(() => assertBootstrapCaptureHasNoSensitiveValues({ ...before,
  capturePath: '/synthetic/capture.json' }, { accountId, apiToken }),
/CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
for (const secret of [
  ',/Users/synthetic/private.json', ';/Applications/Synthetic.app/private.json',
  '[/srv/dwnc/private.json]', '(/private/tmp/secret.json)', '"/var/tmp/secret.json"',
  "'/opt/private.json'", '\n/Volumes/private/secret.json', '\u0001/etc/private.json',
  ',C:\\Sensitive\\secret.json', ';\\\\server\\share\\secret.json',
  String.raw`[\/Users/synthetic/escaped-secret.json]`,
]) {
  await rejects(() => assertBootstrapCaptureHasNoSensitiveValues({ ...before, note: secret }, {
    accountId, apiToken,
  }), /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_SECRET/u);
}
for (const safeValue of [
  'docs/evidence/relative-name.json', './relative-name.json', '../parent/relative-name.json',
  String.raw`docs\/evidence\/escaped-relative.json`,
  'https://dwnc-me-staging.dwnc.workers.dev/path', 'urn:/synthetic-resource',
  versionId, deploymentId, 'f'.repeat(64),
]) {
  await assertBootstrapCaptureHasNoSensitiveValues({ ...before, note: safeValue }, {
    accountId, apiToken,
  });
  assertions += 1;
}

const stored = new Map([
  [paths.freshAbsence.primary,
    Buffer.from(`${canonicalServiceExistenceCapturePayload(fixedFreshAbsence)}\n`)],
  [paths.freshAccountSubdomain.primary,
    Buffer.from(`${canonicalAccountWorkersDevSubdomainCapturePayload(fixedFreshAccount)}\n`)],
  [paths.deployOutput.primary,
    Buffer.from(`${canonicalBootstrapDeployOutputCapturePayload(fixedDeployOutput)}\n`)],
  [paths.before.primary, Buffer.from(`${canonicalBootstrapPostStateCapturePayload(before)}\n`)],
  [paths.after.primary, Buffer.from(`${canonicalBootstrapPostStateCapturePayload(after)}\n`)],
]);
const outsideChecks = [];
const verification = await verifyBootstrapAttestationFixedCaptures({
  attestation,
  authorizationSha256,
  repositoryRoot: '/synthetic/repository',
  home: '/synthetic/home',
  accountId,
  apiToken,
  now: new Date(attestation.attestedAt),
  readFile: async (file) => {
    if (!stored.has(file)) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    return Buffer.from(stored.get(file));
  },
  assertOutsideRepository: async (file, root) => { outsideChecks.push([file, root]); },
});
equal(verification.deploymentId, deploymentId);
equal(outsideChecks.length, 10);
const recoveryStored = new Map(stored);
recoveryStored.set(paths.before.primary, Buffer.alloc(0));
recoveryStored.set(paths.before.recovery,
  Buffer.from(`${canonicalBootstrapPostStateCapturePayload(before)}\n`));
const recoveredVerification = await verifyBootstrapAttestationFixedCaptures({
  attestation,
  authorizationSha256,
  repositoryRoot: '/synthetic/repository',
  home: '/synthetic/home',
  accountId,
  apiToken,
  now: new Date(attestation.attestedAt),
  readFile: async (file) => {
    if (!recoveryStored.has(file)) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    return Buffer.from(recoveryStored.get(file));
  },
  assertOutsideRepository: async () => undefined,
});
equal(recoveredVerification.beforeCaptureSha256, attestation.beforeCaptureSha256);

for (const pair of [paths.freshAbsence, paths.freshAccountSubdomain, paths.deployOutput]) {
  const missing = new Map(stored);
  missing.delete(pair.primary);
  await rejects(() => verifyBootstrapAttestationFixedCaptures({
    attestation, authorizationSha256, repositoryRoot: '/synthetic/repository',
    home: '/synthetic/home', accountId, apiToken, now: new Date(attestation.attestedAt),
    readFile: async (file) => {
      if (!missing.has(file)) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
      return Buffer.from(missing.get(file));
    },
    assertOutsideRepository: async () => undefined,
  }), /CLOUDFLARE_E_SIGNING_FILE/u);
  const partial = new Map(stored);
  partial.set(pair.primary, Buffer.alloc(0));
  partial.set(pair.recovery, Buffer.alloc(0));
  await rejects(() => verifyBootstrapAttestationFixedCaptures({
    attestation, authorizationSha256, repositoryRoot: '/synthetic/repository',
    home: '/synthetic/home', accountId, apiToken, now: new Date(attestation.attestedAt),
    readFile: async (file) => {
      if (!partial.has(file)) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
      return Buffer.from(partial.get(file));
    },
    assertOutsideRepository: async () => undefined,
  }), /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_RECOVERY_EXHAUSTED/u);
}

const tamperedFixedPayloads = [
  [paths.freshAbsence, canonicalServiceExistenceCapturePayload, {
    ...fixedFreshAbsence, rawBodySha256: 'f'.repeat(64),
  }],
  [paths.freshAccountSubdomain, canonicalAccountWorkersDevSubdomainCapturePayload, {
    ...fixedFreshAccount, rawBodySha256: 'f'.repeat(64),
  }],
  [paths.deployOutput, canonicalBootstrapDeployOutputCapturePayload, {
    ...fixedDeployOutput, versionId: '52345678-1234-4123-8123-123456789abc',
  }],
];
for (const [pair, canonicalPayload, payload] of tamperedFixedPayloads) {
  const tampered = new Map(stored);
  tampered.set(pair.primary, Buffer.from(`${canonicalPayload(payload)}\n`));
  await rejects(() => verifyBootstrapAttestationFixedCaptures({
    attestation, authorizationSha256, repositoryRoot: '/synthetic/repository',
    home: '/synthetic/home', accountId, apiToken, now: new Date(attestation.attestedAt),
    readFile: async (file) => {
      if (!tampered.has(file)) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
      return Buffer.from(tampered.get(file));
    },
    assertOutsideRepository: async () => undefined,
  }), /CLOUDFLARE_E_(?:SERVICE_EXISTENCE|ACCOUNT_SUBDOMAIN|BOOTSTRAP_DEPLOY_OUTPUT)/u);
}

const trackedReadBuffers = [];
await rejects(() => verifyBootstrapAttestationFixedCaptures({
  attestation, authorizationSha256, repositoryRoot: '/synthetic/repository',
  home: '/synthetic/home', accountId, apiToken, now: new Date(attestation.attestedAt),
  readFile: async (file) => {
    if (file === paths.freshAccountSubdomain.primary) {
      throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    }
    const bytes = Buffer.from(stored.get(file));
    trackedReadBuffers.push(bytes);
    return bytes;
  },
  assertOutsideRepository: async () => undefined,
}), /CLOUDFLARE_E_SIGNING_FILE/u);
equal(trackedReadBuffers.length, 1);
equal(trackedReadBuffers[0].every((byte) => byte === 0), true);

const canonicalTamper = structuredClone(before);
canonicalTamper.evidence.deploymentId = '52345678-1234-4123-8123-123456789abc';
const tamperedPrimaryStored = new Map(recoveryStored);
tamperedPrimaryStored.set(paths.before.primary,
  Buffer.from(`${canonicalBootstrapPostStateCapturePayload(canonicalTamper)}\n`));
await rejects(() => verifyBootstrapAttestationFixedCaptures({
  attestation,
  authorizationSha256,
  repositoryRoot: '/synthetic/repository',
  home: '/synthetic/home',
  accountId,
  apiToken,
  now: new Date(attestation.attestedAt),
  readFile: async (file) => Buffer.from(tamperedPrimaryStored.get(file)),
  assertOutsideRepository: async () => undefined,
}), /CLOUDFLARE_E_BOOTSTRAP_POST_STATE_CAPTURE/u);

const exhaustedStored = new Map(recoveryStored);
exhaustedStored.set(paths.before.recovery, Buffer.alloc(0));
await rejects(() => verifyBootstrapAttestationFixedCaptures({
  attestation,
  authorizationSha256,
  repositoryRoot: '/synthetic/repository',
  home: '/synthetic/home',
  accountId,
  apiToken,
  now: new Date(attestation.attestedAt),
  readFile: async (file) => Buffer.from(exhaustedStored.get(file)),
  assertOutsideRepository: async () => undefined,
}), /CLOUDFLARE_E_BOOTSTRAP_CAPTURE_RECOVERY_EXHAUSTED/u);

const secureReadAttempts = [];
await rejects(() => verifyBootstrapAttestationFixedCaptures({
  attestation,
  authorizationSha256,
  repositoryRoot: '/synthetic/repository',
  home: '/synthetic/home',
  accountId,
  apiToken,
  now: new Date(attestation.attestedAt),
  readFile: async (file) => {
    secureReadAttempts.push(file);
    if (file === paths.before.primary) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    return Buffer.from(stored.get(file));
  },
  assertOutsideRepository: async () => undefined,
}), /CLOUDFLARE_E_SIGNING_FILE/u);
equal(secureReadAttempts.includes(paths.before.recovery), false);
await rejects(() => verifyBootstrapAttestationFixedCaptures({
  attestation: { ...attestation, beforeCaptureSha256: 'f'.repeat(64) },
  authorizationSha256,
  repositoryRoot: '/synthetic/repository',
  home: '/synthetic/home',
  accountId,
  apiToken,
  now: new Date(attestation.attestedAt),
  readFile: async (file) => {
    if (!stored.has(file)) throw new Error('CLOUDFLARE_E_SIGNING_FILE');
    return Buffer.from(stored.get(file));
  },
  assertOutsideRepository: async () => undefined,
}), /CLOUDFLARE_E_BOOTSTRAP_ATTESTATION_CAPTURE_BINDING/u);

// Authorization and deploy output remain exact and version-pinned.
const evidenceAt = '2026-08-25T00:00:00.000Z';
const evidence = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-service-existence-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  exists: false,
  httpStatus: 404,
  rawEvidenceSha256: '7'.repeat(64),
  requestStartedAt: evidenceAt,
  requestCompletedAt: evidenceAt,
  observedAt: evidenceAt,
  expiresAt: '2026-08-25T00:05:00.000Z',
};
validateServiceExistenceEvidence(evidence, { now: new Date(evidenceAt) }); assertions += 1;
const authorization = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-bootstrap-authorization-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  expectedAccountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  sourceGitSha: '1'.repeat(40),
  denyWorkerSha256: bootstrapDenyWorkerSha256(),
  bootstrapConfigSha256: bootstrapConfigSha256('staging'),
  serviceEvidenceSha256: sha256Hex(canonicalServiceExistenceEvidencePayload(evidence)),
  accountSubdomainEvidenceSha256: '8'.repeat(64),
  freshAbsenceRequired: true,
  freshAbsenceRequestSha256: serviceExistenceRequestSha256({
    environment: 'staging', accountIdSha256,
  }),
  freshAccountSubdomainRequired: true,
  freshAccountSubdomainRequestSha256: accountWorkersDevSubdomainRequestSha256({
    environment: 'staging', accountIdSha256,
  }),
  maxFreshAbsenceAgeSeconds: 15,
  maxFreshAccountSubdomainAgeSeconds: 15,
  buildUuid: '12345678-1234-4123-8123-123456789abc',
  nonceSha256: '9'.repeat(64),
  createdAt: evidenceAt,
  expiresAt: '2026-08-25T00:10:00.000Z',
};
validateBootstrapAuthorization(authorization, { now: new Date(evidenceAt) }); assertions += 1;
const authHash = sha256Hex(canonicalBootstrapAuthorizationPayload(authorization));
const args = bootstrapArguments({
  environment: 'staging', authorizationSha256: authHash,
});
equal(args[0], 'deploy');
equal(args[1], 'deny-all-worker.js');
equal(args.some((argument) => typeof argument === 'string' && argument.startsWith('/')), false);
equal(args.includes('--no-bundle'), true);
equal(args.includes('--x-provision=false'), true);
const ndjson = `${JSON.stringify({
  type: 'wrangler-session', version: 1, wrangler_version: '4.125.0',
  command_line_args: args, log_file_path: null, timestamp: evidenceAt,
})}\n${JSON.stringify({
  type: 'deploy', version: 1, worker_name: 'dwnc-me-staging', worker_tag: null,
  version_id: versionId, targets: [], worker_name_overridden: false, timestamp: evidenceAt,
})}\n`;
equal(parseBootstrapDeployNdjson(ndjson, {
  environment: 'staging', expectedArguments: args,
}).version_id, versionId);

const productionClock = clock('2026-08-25T00:06:00.000Z');
const productionBefore = await createSnapshot({ environment: 'production', now: productionClock });
const productionAfter = await createSnapshot({ environment: 'production', now: productionClock });
const productionAttestation = attestationFromSnapshots(
  productionBefore, productionAfter, 'production',
);
equal(createBootstrapPromotionBaseline(productionAttestation).versionId, versionId);
equal(canonicalBootstrapAttestationPayload(attestation).includes(apiToken), false);
equal(canonicalAccountWorkersDevSubdomainEvidencePayload({
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-account-workers-dev-subdomain-v1',
  environment: 'staging', workerName: 'dwnc-me-staging', accountIdSha256,
  accountSubdomain: 'dwnc', origin: 'https://dwnc-me-staging.dwnc.workers.dev',
  rawEvidenceSha256: 'b'.repeat(64), requestStartedAt: evidenceAt,
  requestCompletedAt: evidenceAt, observedAt: evidenceAt,
  expiresAt: '2026-08-25T00:05:00.000Z',
}).includes(accountId), false);
const fixedAbsenceCanonical = canonicalServiceExistenceCapturePayload(fixedFreshAbsence);
const fixedAccountCanonical = canonicalAccountWorkersDevSubdomainCapturePayload(fixedFreshAccount);
equal(fixedAbsenceCanonical, canonicalJson(fixedFreshAbsence));
equal(fixedAccountCanonical, canonicalJson(fixedFreshAccount));
equal(sha256Hex(fixedAbsenceCanonical), attestation.freshAbsenceCaptureSha256);
equal(sha256Hex(fixedAccountCanonical), attestation.freshAccountSubdomainCaptureSha256);

console.log(JSON.stringify({
  suite: 'cloudflare-deny-bootstrap',
  assertions,
  boundedStreamingReader: true,
  fullSnapshotTwice: true,
  deploymentIdentityCas: true,
  exactDenyModuleReadBack: true,
  fixedProtectedCaptureVerifier: true,
  liveNetworkCalls: 0,
  deploymentAttempts: 0,
  status: 'PASS',
}, null, 2));

function pathJoin(...parts) {
  return parts.join('/').replace(/\/+/gu, '/');
}
