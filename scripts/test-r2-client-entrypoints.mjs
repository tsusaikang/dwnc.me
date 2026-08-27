import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import { writeAnonymousInheritedInput } from './lib/cloudflare-process.mjs';
import {
  canonicalRemoteReceiptPayload,
  cloudflareAccountIdSha256,
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  publicMediaEntryManifestSha256,
} from './lib/public-media-manifest.mjs';
import { createUnsignedRemoteReceipt } from './lib/public-media-remote.mjs';

const ROOT = process.cwd();
const MANIFEST_SHA256 = '61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532';
const credentials = Object.freeze({
  schemaVersion: 1,
  contract: 'dwnc-r2-s3-credentials-v1',
  accountId: 'a'.repeat(32),
  bucket: 'dwnc-me-public-media-staging',
  accessKeyId: 'b'.repeat(32),
  secretAccessKey: 'c'.repeat(64),
});
let assertions = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
};

async function runEntrypoint({
  script,
  args = [],
  cwd = ROOT,
  environment = {},
  credential = credentials,
  preload = null,
  smokeToken = null,
}) {
  const nodeArgs = [
    ...(preload ? [`--import=${pathToFileURL(preload).href}`] : []),
    path.join(ROOT, script),
    ...args,
  ];
  const child = spawn(process.execPath, nodeArgs, {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      LANG: 'C',
      TZ: 'UTC',
      R2_CREDENTIALS_FD: '3',
      ...environment,
      ...(smokeToken === null ? {} : { CLOUDFLARE_STAGING_SMOKE_TOKEN_FD: '4' }),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', ...(smokeToken === null ? [] : ['pipe'])],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const writes = [writeAnonymousInheritedInput(
    child.stdio[3], Buffer.from(canonicalJson(credential)),
    { descriptor: 3, maximumBytes: 4096 },
  )];
  if (smokeToken !== null) {
    writes.push(writeAnonymousInheritedInput(
      child.stdio[4], Buffer.from(smokeToken), { descriptor: 4, maximumBytes: 43 },
    ));
  }
  const [, code] = await Promise.all([
    Promise.all(writes),
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
  ]);
  const output = `${stdout}\n${stderr}`;
  equal(output.includes(credential.accountId), false, `${script}: raw account id`);
  equal(output.includes(credential.accessKeyId), false, `${script}: access key`);
  equal(output.includes(credential.secretAccessKey), false, `${script}: secret key`);
  return { code, stdout, stderr, output };
}

const temporaryPaths = [];
async function secureTemporaryDirectory(prefix) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  temporaryPaths.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

try {
  const manifest = await loadTrackedPublicMediaManifest(ROOT);
  equal(manifest.manifestSha256, MANIFEST_SHA256);
  equal(manifest.objectCount, 2_758);

  const fixtureRoot = await secureTemporaryDirectory('dwnc-r2-inspect-root-');
  const evidenceDirectory = await secureTemporaryDirectory('dwnc-r2-inspect-evidence-');
  await mkdir(path.join(fixtureRoot, 'src/data'), { recursive: true });
  await copyFile(
    path.join(ROOT, 'src/data/public-media-r2-v1.json'),
    path.join(fixtureRoot, 'src/data/public-media-r2-v1.json'),
  );
  const fixturePolicy = structuredClone(await loadTrackedPublicMediaReleasePolicy(ROOT));
  fixturePolicy.staging.accountIdSha256 = cloudflareAccountIdSha256(credentials.accountId);
  await writeFile(
    path.join(fixtureRoot, 'src/data/public-media-release-policy-v1.json'),
    `${JSON.stringify(fixturePolicy, null, 2)}\n`,
  );
  await writeFile(path.join(fixtureRoot, 'wrangler.jsonc'), `${JSON.stringify({
    env: {
      staging: {
        r2_buckets: [{
          binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
        }],
      },
    },
  }, null, 2)}\n`);

  const methodsPath = path.join(evidenceDirectory, 'methods.json');
  const preloadPath = path.join(evidenceDirectory, 'empty-r2-preload.mjs');
  await writeFile(preloadPath, [
    "import { writeFileSync } from 'node:fs';",
    'const methods = [];',
    'globalThis.fetch = async (input, init = {}) => {',
    "  const method = init.method ?? 'GET';",
    '  methods.push(method);',
    '  const url = new URL(input);',
    "  if (method === 'GET' && url.searchParams.get('list-type') === '2') {",
    "    return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>', { status: 200 });",
    '  }',
    "  if (method === 'HEAD') return new Response(null, { status: 404 });",
    "  throw new Error('R2_TEST_UNEXPECTED_METHOD');",
    '};',
    "process.on('exit', () => writeFileSync(process.env.R2_TEST_METHODS_PATH, JSON.stringify(methods)));",
    '',
  ].join('\n'), { mode: 0o600 });
  const inspectionOutput = path.join(evidenceDirectory, 'staging-inspection.json');
  const inspection = await runEntrypoint({
    script: 'scripts/inspect-public-media-r2.mjs',
    cwd: fixtureRoot,
    preload: preloadPath,
    environment: { R2_TEST_METHODS_PATH: methodsPath },
    args: [
      '--environment=staging', '--concurrency=16',
      `--expected-manifest-sha256=${manifest.manifestSha256}`,
      `--receipt-output=${inspectionOutput}`,
    ],
  });
  equal(inspection.code, 0, inspection.output);
  const inspectionSummary = JSON.parse(inspection.stdout);
  equal({
    desired: inspectionSummary.desired,
    exact: inspectionSummary.exact,
    missing: inspectionSummary.missing,
    mismatch: inspectionSummary.mismatch,
    orphan: inspectionSummary.orphan,
    overwrite: inspectionSummary.overwrite,
    delete: inspectionSummary.delete,
  }, {
    desired: 2_758, exact: 0, missing: 2_758, mismatch: 0, orphan: 0,
    overwrite: 0, delete: 0,
  });
  const receipt = JSON.parse(await readFile(inspectionOutput, 'utf8'));
  equal(receipt.contract, 'dwnc-public-media-r2-inspection-v1');
  equal(receipt.verificationLevel, 'list-and-head');
  equal({
    desired: receipt.desired,
    exact: receipt.exact,
    missing: receipt.missing,
    mismatch: receipt.mismatch,
    orphan: receipt.orphan,
  }, { desired: 2_758, exact: 0, missing: 2_758, mismatch: 0, orphan: 0 });
  const receiptStats = await lstat(inspectionOutput);
  equal(receiptStats.mode & 0o777, 0o600);
  equal(receiptStats.nlink, 1);
  const methods = JSON.parse(await readFile(methodsPath, 'utf8'));
  equal(methods.filter((method) => method === 'GET').length, 1);
  equal(methods.filter((method) => method === 'HEAD').length, 2_758);
  equal(methods.filter((method) => method === 'PUT').length, 0);
  equal(methods.filter((method) => method === 'DELETE').length, 0);
  equal([...new Set(methods)].sort(), ['GET', 'HEAD']);

  const negativeDirectory = await secureTemporaryDirectory('dwnc-r2-entrypoint-negative-');
  const firstEntry = manifest.entries[0];
  const singleReadCases = [
    {
      name: 'sync',
      script: 'scripts/sync-public-media-r2.mjs',
      args: ['--environment=staging'],
      expected: 'MEDIA_E_RELEASE_TARGET',
    },
    {
      name: 'admission',
      script: 'scripts/admit-public-media-r2-staging-object.mjs',
      args: [
        `--key=${firstEntry.key}`,
        `--expected-manifest-sha256=${manifest.manifestSha256}`,
        `--receipt-output=${path.join(negativeDirectory, 'admission.json')}`,
      ],
      expected: 'MEDIA_E_RELEASE_TARGET',
    },
    {
      name: 'full-audit',
      script: 'scripts/audit-public-media-r2-full.mjs',
      args: [
        '--environment=staging', `--expected-manifest-sha256=${manifest.manifestSha256}`,
        '--expected-orphan-count=0',
        `--receipt-output=${path.join(negativeDirectory, 'full-audit.json')}`,
        `--bucket-exposure-capture=${path.join(negativeDirectory, 'not-read-exposure.json')}`,
      ],
      expected: 'MEDIA_E_RELEASE_TARGET',
    },
  ];
  for (const fixture of singleReadCases) {
    const result = await runEntrypoint(fixture);
    equal(result.code === 0, false, `${fixture.name}: expected failure`);
    equal(result.output.includes(fixture.expected), true, `${fixture.name}: ${result.output}`);
    equal(/MEDIA_E_R2_CREDENTIALS_(?:FD|CANONICAL)/u.test(result.output), false,
      `${fixture.name}: FD was read more than once`);
  }

  const artifactDirectory = path.join(negativeDirectory, 'empty-artifact');
  await mkdir(artifactDirectory, { mode: 0o700 });
  const smokeResult = await runEntrypoint({
    script: 'scripts/probe-cloudflare-staging-media.mjs',
    smokeToken: 'A'.repeat(43),
    environment: {
      CLOUDFLARE_STAGING_MEDIA_PROBE_PATH: path.join(negativeDirectory, 'probe.json'),
      CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR: artifactDirectory,
      CLOUDFLARE_STAGING_SYNTHETIC_ORIGIN: 'https://dwnc-me-staging.dwnc.workers.dev',
      CLOUDFLARE_STAGING_VERSION_ATTESTATION_RECEIPT_PATH: path.join(negativeDirectory, 'version.json'),
      CLOUDFLARE_STAGING_VERSION_ATTESTATION_SIGNATURE_PATH: path.join(negativeDirectory, 'version.sig'),
      CLOUDFLARE_STAGING_VERSION_ATTESTATION_PUBLIC_KEY_PATH: path.join(negativeDirectory, 'version.pem'),
    },
  });
  equal(smokeResult.code === 0, false);
  equal(/CLOUDFLARE_E_(?:ARTIFACT|SIGNING_FILE)/u.test(smokeResult.output), true,
    smokeResult.output);
  equal(/MEDIA_E_R2_CREDENTIALS_(?:FD|CANONICAL)/u.test(smokeResult.output), false);

  const heads = manifest.entries.map((entry) => ({
    key: entry.key,
    size: entry.size,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
    sha256: entry.sha256,
    contract: 'dwnc-public-media-r2-v1',
    manifestEntrySha256: publicMediaEntryManifestSha256(entry),
    platformChecksumSha256: entry.sha256,
    version: null,
    httpEtag: `"fixture-${entry.sha256.slice(0, 16)}"`,
    lastModified: '2026-08-27T00:00:00.000Z',
  }));
  const remoteReceipt = createUnsignedRemoteReceipt(manifest, heads, {
    target: {
      environment: 'production',
      bucket: 'dwnc-me-public-media-production',
      accountIdSha256: cloudflareAccountIdSha256(credentials.accountId),
    },
  });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signature = sign(
    null, Buffer.from(canonicalRemoteReceiptPayload(remoteReceipt)), privateKey,
  ).toString('base64');
  const remoteReceiptPath = path.join(negativeDirectory, 'remote-receipt.json');
  const remoteSignaturePath = path.join(negativeDirectory, 'remote-receipt.sig');
  const remotePublicKeyPath = path.join(negativeDirectory, 'remote-receipt.pem');
  await Promise.all([
    writeFile(remoteReceiptPath, `${JSON.stringify(remoteReceipt)}\n`),
    writeFile(remoteSignaturePath, `${signature}\n`),
    writeFile(remotePublicKeyPath, publicKeyPem),
  ]);
  const remoteResult = await runEntrypoint({
    script: 'scripts/validate-public-media-remote.mjs',
    environment: {
      PUBLIC_MEDIA_REMOTE_RECEIPT_PATH: remoteReceiptPath,
      PUBLIC_MEDIA_REMOTE_SIGNATURE_PATH: remoteSignaturePath,
      PUBLIC_MEDIA_REMOTE_PUBLIC_KEY_PATH: remotePublicKeyPath,
    },
  });
  equal(remoteResult.code === 0, false);
  equal(remoteResult.output.includes('MEDIA_E_RELEASE_POLICY_INCOMPLETE'), true,
    remoteResult.output);
  equal(/MEDIA_E_R2_CREDENTIALS_(?:FD|CANONICAL)/u.test(remoteResult.output), false);

  const entrypoints = [
    'scripts/inspect-public-media-r2.mjs',
    'scripts/validate-public-media-r2-staging-object.mjs',
    'scripts/sync-public-media-r2.mjs',
    'scripts/admit-public-media-r2-staging-object.mjs',
    'scripts/audit-public-media-r2-full.mjs',
    'scripts/probe-cloudflare-staging-media.mjs',
    'scripts/validate-public-media-remote.mjs',
  ];
  for (const file of entrypoints) {
    const source = await readFile(path.join(ROOT, file), 'utf8');
    equal(source.includes('r2ClientContextFromEnvironment'), true, file);
    equal(source.includes('r2ClientFromEnvironment'), false, file);
    equal(source.includes('r2CredentialsFromEnvironment'), false, file);
  }
} finally {
  await Promise.all(temporaryPaths.reverse().map((directory) => rm(
    directory, { recursive: true, force: true },
  )));
}

console.log(JSON.stringify({
  suite: 'r2-client-entrypoints-single-read',
  assertions,
  inspectedObjects: 2_758,
  inspectNetworkMethods: ['GET', 'HEAD'],
  inspectPutCalls: 0,
  inspectDeleteCalls: 0,
  liveNetworkCalls: 0,
  realKeychainCalls: 0,
  status: 'PASS',
}, null, 2));
