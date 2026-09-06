import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import edgeRedirectManifest from '../docs/EDGE_REDIRECTS_V1.json' with { type: 'json' };
import publicSequence from '../src/data/public-sequence-v1.json' with { type: 'json' };
import {
  createPreuploadArtifact,
  createStagingPreuploadArtifact,
  expectedProductionVersionBindings,
  expectedStagingVersionBindings,
  nativeReleaseResourcesFromConfig,
  validateArtifactDirectory,
  validateStagingArtifactDirectory,
  validateStagingUploadArtifactDirectory,
} from './lib/cloudflare-artifact.mjs';
import { cloudflareResourceDigest } from './lib/cloudflare-release.mjs';
import { renderCloudflareRedirects } from './lib/cloudflare-redirects.mjs';
import {
  STAGING_SMOKE_NATIVE_CHILD_GUARD,
  STAGING_SMOKE_SECRET_READ_OBSERVER,
} from './lib/cloudflare-process.mjs';
import { runStagingSmokeTokenRunner } from './run-with-staging-smoke-token.mjs';
import { readSecureFile } from './lib/cloudflare-signing-key.mjs';
import {
  canonicalRemoteReceiptPayload,
  loadTrackedPublicMediaReleasePolicy,
  publicMediaFullGetObjectSetSha256,
  publicKeySpkiSha256,
} from './lib/public-media-manifest.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-artifact-fixture-'));
const releaseConfigFixture = {
  env: {
    production: {
      r2_buckets: [{
        binding: 'NATIVE_MEDIA_BUCKET', bucket_name: 'dwnc-me-native-media-production',
      }],
      d1_databases: [{
        binding: 'NATIVE_DB', database_name: 'dwnc-me-native-production',
        database_id: '11111111-1111-4111-8111-111111111111',
      }],
    },
    staging: {
      r2_buckets: [{
        binding: 'NATIVE_MEDIA_BUCKET', bucket_name: 'dwnc-me-native-media-staging',
      }],
      d1_databases: [{
        binding: 'NATIVE_DB', database_name: 'dwnc-me-native-staging',
        database_id: '22222222-2222-4222-8222-222222222222',
      }],
    },
  },
};
const productionNativeResources = nativeReleaseResourcesFromConfig(
  releaseConfigFixture, 'production');
const stagingNativeResources = nativeReleaseResourcesFromConfig(releaseConfigFixture, 'staging');
async function unlock(directory) {
  await chmod(directory, 0o700).catch(() => undefined);
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) await unlock(path.join(directory, entry.name));
    else await chmod(path.join(directory, entry.name), 0o600).catch(() => undefined);
  }
}
async function lock(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await lock(target);
    else await chmod(target, 0o400);
  }
  await chmod(directory, 0o500);
}
try {
  const sourceRoot = path.join(temporary, 'source');
  const bundleDirectory = path.join(temporary, 'bundle');
  await mkdir(path.join(sourceRoot, 'dist/about'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'public'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'docs'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'src/data'), { recursive: true });
  await mkdir(bundleDirectory);
  await writeFile(path.join(sourceRoot, 'dist/index.html'), 'static');
  await writeFile(path.join(sourceRoot, 'dist/about/index.html'), 'fixture-about');
  await writeFile(path.join(sourceRoot, 'dist/.assetsignore'), 'media/\n*.map\n');
  const canonicalRedirects = renderCloudflareRedirects(edgeRedirectManifest, publicSequence);
  await writeFile(path.join(sourceRoot, 'public/_redirects'), canonicalRedirects);
  await writeFile(path.join(sourceRoot, 'dist/_redirects'), canonicalRedirects);
  await writeFile(path.join(sourceRoot, 'docs/EDGE_REDIRECTS_V1.json'),
    `${JSON.stringify(edgeRedirectManifest)}\n`);
  await writeFile(path.join(sourceRoot, 'src/data/public-sequence-v1.json'),
    `${JSON.stringify(publicSequence)}\n`);
  await writeFile(path.join(bundleDirectory, 'worker.js'), 'export default { fetch() {} };');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const stagingPolicy = structuredClone(await loadTrackedPublicMediaReleasePolicy(process.cwd()));
  stagingPolicy.staging.accountIdSha256 = 'b'.repeat(64);
  stagingPolicy.staging.publicKeySpkiSha256 = publicKeySpkiSha256(publicKeyPem);
  const stagingManifest = {
    manifestSha256: 'a'.repeat(64), objectCount: 0, totalBytes: 0, entries: [],
  };
  const remoteReceipt = {
    schemaVersion: 1, contract: 'dwnc-public-media-r2-receipt-v1', manifestSha256: 'a'.repeat(64),
    objectCount: 0, totalBytes: 0,
    target: { environment: 'production', bucket: 'dwnc-me-public-media-production', accountIdSha256: 'b'.repeat(64) },
    verificationLevel: 'full-get-sha256',
    bucketExposure: {
      verification: 'cloudflare-control-plane', jurisdiction: 'default', location: 'ENAM',
      storageClass: 'Standard', bucketPropertiesSha256: 'd'.repeat(64), r2DevEnabled: false,
      customDomainCount: 0, verifiedAt: '2026-08-25T00:00:00.000Z', evidenceSha256: 'c'.repeat(64),
    },
    verifiedAt: '2026-08-25T00:00:00.000Z',
    audit: {
      headObjects: 0,
      fullGetObjects: 0,
      fullGetBytes: 0,
      fullGetContract: 'all-manifest-objects-streamed-sha256-v1',
      fullObjectSetSha256: publicMediaFullGetObjectSetSha256([]),
      orphanCount: 0,
      requestCounts: { LIST: 1, HEAD: 0, GET: 0, PUT: 0, DELETE: 0 },
      sourceCommit: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      gitCheckCount: 3,
      startedAt: '2026-08-24T23:59:00.000Z',
      exposureCaptureSha256: 'f'.repeat(64),
    },
    objects: [],
  };
  const signature = sign(null, Buffer.from(canonicalRemoteReceiptPayload(remoteReceipt)), privateKey);
  const signaturePath = path.join(temporary, 'remote.sig');
  const publicKeyPath = path.join(temporary, 'remote.pem');
  await writeFile(signaturePath, `${signature.toString('base64')}\n`, { mode: 0o600 });
  await writeFile(publicKeyPath, publicKeyPem, { mode: 0o600 });
  const stagingRemoteReceipt = {
    ...remoteReceipt,
    target: {
      environment: 'staging',
      bucket: 'dwnc-me-public-media-staging',
      accountIdSha256: 'b'.repeat(64),
    },
  };
  const stagingSignature = sign(
    null, Buffer.from(canonicalRemoteReceiptPayload(stagingRemoteReceipt)), privateKey);
  const stagingSignaturePath = path.join(temporary, 'staging-remote.sig');
  await writeFile(stagingSignaturePath, `${stagingSignature.toString('base64')}\n`, { mode: 0o600 });
  const input = {
    sourceRoot,
    bundleDirectory,
    sourceGitSha: '1'.repeat(40),
    ciSourceGitSha: '1'.repeat(40),
    accountIdSha256: 'b'.repeat(64),
    stagingAccountIdSha256: 'b'.repeat(64),
    bucket: 'dwnc-me-public-media-production',
    stagingBucket: 'dwnc-me-public-media-staging',
    productionNativeResources,
    stagingNativeResources,
    mediaManifest: { manifestSha256: 'a'.repeat(64) },
    mediaRemoteReceipt: remoteReceipt,
    mediaReceiptFiles: { signaturePath, publicKeyPath },
  };
  const first = await createPreuploadArtifact({ ...input, artifactRoot: path.join(temporary, 'artifacts-a') });
  const second = await createPreuploadArtifact({ ...input, artifactRoot: path.join(temporary, 'artifacts-b') });
  assert.equal(first.artifactSha256, second.artifactSha256);
  assert.equal(first.receipt.payloadSha256, second.receipt.payloadSha256);
  const validated = await validateArtifactDirectory(first.directory);
  assert.equal(validated.artifactSha256, first.artifactSha256);
  assert.equal((await stat(first.directory)).mode & 0o777, 0o500);
  assert.equal((await stat(path.join(first.directory, 'worker.js'))).mode & 0o777, 0o400);
  assert.equal((await readFile(path.join(first.directory, 'worker.js'), 'utf8')).includes('fetch'), true);
  assert.equal(first.receipt.publicRequestPaths, 2);
  assert.equal(first.receipt.publicRequestSurfaceSha256.length, 64);
  assert.equal(first.receipt.bindingsSha256, cloudflareResourceDigest(
    expectedProductionVersionBindings(
      'dwnc-me-public-media-production', productionNativeResources)));
  assert.equal(first.receipt.stagingBindingsSha256, cloudflareResourceDigest(
    expectedStagingVersionBindings(
      'dwnc-me-public-media-staging', stagingNativeResources)));
  assert.deepEqual(validated.staticEntry, {
    publicPath: '/about', size: 13,
    sha256: first.receipt.smokeStaticSha256, contentType: 'text/html',
  });
  const productionUpload = JSON.parse(await readFile(
    path.join(first.directory, 'wrangler-upload.jsonc'), 'utf8'));
  assert.deepEqual(productionUpload.env.production.r2_buckets, [
    { binding: 'MEDIA_BUCKET', bucket_name: 'dwnc-me-public-media-production' },
    { binding: 'NATIVE_MEDIA_BUCKET', bucket_name: productionNativeResources.nativeBucket },
  ]);
  assert.deepEqual(productionUpload.env.production.d1_databases, [{
    binding: 'NATIVE_DB', database_name: productionNativeResources.databaseName,
    database_id: productionNativeResources.databaseId,
  }]);
  assert.throws(() => nativeReleaseResourcesFromConfig({
    env: { production: {
      r2_buckets: [{
        binding: 'NATIVE_MEDIA_BUCKET', bucket_name: productionNativeResources.nativeBucket,
      }],
      d1_databases: [{
        binding: 'NATIVE_DB', database_name: productionNativeResources.databaseName,
      }],
    } },
  }, 'production'), /CLOUDFLARE_E_NATIVE_DATABASE_ID_REQUIRED/u);
  const secureRunnerDirectory = path.join(temporary, 'runner-secret');
  await mkdir(secureRunnerDirectory, { mode: 0o700 });
  const secureRunnerDirectoryResolved = await realpath(secureRunnerDirectory);
  const runnerEnvironment = {
    CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE: path.join(
      secureRunnerDirectoryResolved, 'smoke-secret.json',
    ),
    CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR: first.directory,
  };
  const runnerArgv = [
    process.execPath,
    path.join(process.cwd(), 'scripts/run-with-staging-smoke-token.mjs'),
    '--command=admission-smoke',
    '--',
  ];
  const validSmokeSecret = Buffer.from(
    `${JSON.stringify({ DWNC_STAGING_SMOKE_TOKEN: 'A'.repeat(43) })}\n`, 'utf8',
  );
  const canonicalRedirectLines = canonicalRedirects.trimEnd().split('\n');
  const malformedRedirects = [
    ['absolute', ['https://attacker.example/steal', ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
    ['protocol-relative', ['//attacker.example/steal', ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
    ['query', [`${canonicalRedirectLines[0].split(' ')[0]}?leak=1`, ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
    ['backslash', [`${canonicalRedirectLines[0].split(' ')[0]}\\leak`, ...canonicalRedirectLines[0].split(' ').slice(1)].join(' ')],
    ['duplicate', canonicalRedirectLines[1]],
    ['extra-token', `${canonicalRedirectLines[0]} unexpected`],
  ].map(([name, firstLine]) => [
    name, `${[firstLine, ...canonicalRedirectLines.slice(1)].join('\n')}\n`,
  ]);
  for (const [, malformed] of malformedRedirects) {
    await writeFile(path.join(sourceRoot, 'public/_redirects'), malformed);
    let secretReadCount = 0;
    let childStartCount = 0;
    let requestCount = 0;
    await assert.rejects(() => runStagingSmokeTokenRunner({
      root: sourceRoot,
      argv: runnerArgv,
      environment: runnerEnvironment,
      readSecret: async () => { secretReadCount += 1; return Buffer.from(validSmokeSecret); },
      spawnChild: () => { childStartCount += 1; requestCount += 1; throw new Error('unexpected'); },
      stdout: { write() {} },
      stderr: { write() {} },
    }), /REDIRECT_E_SMOKE_AUTHORITY/u);
    assert.equal(secretReadCount, 0);
    assert.equal(childStartCount, 0);
    assert.equal(requestCount, 0);
  }
  await writeFile(path.join(sourceRoot, 'public/_redirects'), canonicalRedirects);
  let nativeGuardSecretReads = 0;
  globalThis[STAGING_SMOKE_NATIVE_CHILD_GUARD] = true;
  try {
    await assert.rejects(() => runStagingSmokeTokenRunner({
      root: sourceRoot,
      argv: runnerArgv,
      environment: runnerEnvironment,
      readSecret: async () => {
        nativeGuardSecretReads += 1;
        return Buffer.from(validSmokeSecret);
      },
      stdout: { write() {} },
      stderr: { write() {} },
    }), /CLOUDFLARE_E_SMOKE_NATIVE_CHILD_GUARD/u);
  } finally {
    delete globalThis[STAGING_SMOKE_NATIVE_CHILD_GUARD];
  }
  assert.equal(nativeGuardSecretReads, 1);

  await writeFile(runnerEnvironment.CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE,
    validSmokeSecret, { mode: 0o600 });
  const locallyReadSecret = await readSecureFile(
    runnerEnvironment.CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE, 4096,
  );
  assert.equal(locallyReadSecret.equals(validSmokeSecret), true);
  locallyReadSecret.fill(0);
  const nativeGuardPreload = path.join(temporary, 'native-child-guard.mjs');
  const nativeSecretReadAttempts = path.join(temporary, 'native-secret-read-attempts.bin');
  const nativeChildAttempts = path.join(temporary, 'native-child-attempts.bin');
  const nativeRequestAttempts = path.join(temporary, 'native-request-attempts.bin');
  await writeFile(nativeGuardPreload,
    `import { appendFileSync } from 'node:fs';\n`
    + `const secretMarker = ${JSON.stringify(nativeSecretReadAttempts)};\n`
    + `const childMarker = ${JSON.stringify(nativeChildAttempts)};\n`
    + `const requestMarker = ${JSON.stringify(nativeRequestAttempts)};\n`
    + `globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(STAGING_SMOKE_SECRET_READ_OBSERVER))})] = () => appendFileSync(secretMarker, Buffer.from([1]));\n`
    + `globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(STAGING_SMOKE_NATIVE_CHILD_GUARD))})] = () => appendFileSync(childMarker, Buffer.from([1]));\n`
    + `globalThis.fetch = async () => { appendFileSync(requestMarker, Buffer.from([1])); throw new Error('fixture request blocked'); };\n`);
  const runnerPath = path.join(process.cwd(), 'scripts/run-with-staging-smoke-token.mjs');
  const npmPath = path.join(path.dirname(process.execPath), 'npm');
  await writeFile(path.join(sourceRoot, 'package.json'), `${JSON.stringify({
    private: true,
    type: 'module',
    scripts: {
      'smoke-entry': `${process.execPath} ${runnerPath} --command=admission-smoke --`,
    },
  })}\n`);
  const runActualEntrypoint = () => new Promise((resolve, reject) => {
    const child = spawn(npmPath, ['run', 'smoke-entry', '--silent'], {
      cwd: sourceRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        NODE_OPTIONS: `--import=${nativeGuardPreload}`,
        ...runnerEnvironment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
  for (const [, malformed] of malformedRedirects) {
    await writeFile(path.join(sourceRoot, 'public/_redirects'), malformed);
    const result = await runActualEntrypoint();
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('REDIRECT_E_SMOKE_AUTHORITY'), true);
    assert.equal(result.stderr.includes('CLOUDFLARE_E_STAGING_SECRET_FILE'), false);
    assert.equal(result.stderr.includes('CLOUDFLARE_E_SMOKE_NATIVE_CHILD_GUARD'), false);
    assert.equal((await readFile(nativeSecretReadAttempts).catch(() => Buffer.alloc(0))).length, 0);
    assert.equal((await readFile(nativeChildAttempts).catch(() => Buffer.alloc(0))).length, 0);
    assert.equal((await readFile(nativeRequestAttempts).catch(() => Buffer.alloc(0))).length, 0);
  }
  await writeFile(path.join(sourceRoot, 'public/_redirects'), canonicalRedirects);
  const actualNormal = await runActualEntrypoint();
  assert.equal(actualNormal.code, 1);
  assert.equal(actualNormal.signal, null);
  assert.equal(actualNormal.stdout, '');
  assert.equal(actualNormal.stderr.includes('CLOUDFLARE_E_SMOKE_NATIVE_CHILD_GUARD'), true,
    actualNormal.stderr);
  assert.equal((await readFile(nativeSecretReadAttempts)).length, 1);
  assert.equal((await readFile(nativeChildAttempts)).length, 1);
  assert.equal((await readFile(nativeRequestAttempts).catch(() => Buffer.alloc(0))).length, 0);

  const outputRunnerLimits = {
    totalTimeoutMs: 1_000,
    gracefulTerminationMs: 100,
    forcedSettleMs: 100,
    maximumOutputBytes: 1024 * 1024,
  };
  const shortOutputRunnerLimits = {
    totalTimeoutMs: 250,
    gracefulTerminationMs: 25,
    forcedSettleMs: 25,
    maximumOutputBytes: 1024 * 1024,
  };
  const fakeOutputChild = (output) => {
    const child = new EventEmitter();
    const childStdout = new PassThrough();
    const childStderr = new PassThrough();
    const tokenInput = new PassThrough();
    tokenInput.resume();
    child.stdio = ['ignore', childStdout, childStderr, tokenInput];
    child.kill = () => true;
    setImmediate(() => {
      childStdout.end(output);
      childStderr.end();
      child.emit('close', 0, null);
    });
    return child;
  };
  const runOutputPath = (output, stdout, limits = outputRunnerLimits) =>
    runStagingSmokeTokenRunner({
      root: sourceRoot,
      argv: runnerArgv,
      environment: runnerEnvironment,
      readSecret: async () => Buffer.from(validSmokeSecret),
      spawnChild: () => fakeOutputChild(output),
      stdout,
      stderr: new PassThrough(),
      limits,
    });

  const largeOutput = Buffer.alloc(1024 * 1024, 0x5a);
  const deliveredOutput = [];
  const slowOutput = new Writable({
    highWaterMark: 64 * 1024,
    write(chunk, _encoding, callback) {
      setTimeout(() => {
        deliveredOutput.push(Buffer.from(chunk));
        callback();
      }, 10);
    },
  });
  await runOutputPath(largeOutput, slowOutput);
  assert.equal(Buffer.concat(deliveredOutput).equals(largeOutput), true);
  assert.equal(slowOutput.writableLength, 0);
  assert.equal(slowOutput.listenerCount('drain'), 0);
  assert.equal(slowOutput.listenerCount('error'), 0);
  assert.equal(slowOutput.listenerCount('close'), 0);

  let callbackErrorChunk;
  const callbackErrorOutput = new Writable({
    write(chunk, _encoding, callback) {
      callbackErrorChunk = chunk;
      setImmediate(() => callback(new Error('fixture output failure')));
    },
  });
  await assert.rejects(
    () => runOutputPath(Buffer.alloc(64 * 1024, 0x45), callbackErrorOutput),
    /CLOUDFLARE_E_SMOKE_RUNNER_OUTPUT/u,
  );
  assert.equal(callbackErrorOutput.destroyed, true);
  assert.equal(callbackErrorChunk.every((value) => value === 0), true);
  assert.equal(callbackErrorOutput.listenerCount('drain'), 0);
  assert.equal(callbackErrorOutput.listenerCount('error'), 0);
  assert.equal(callbackErrorOutput.listenerCount('close'), 0);

  let hangingOutputChunk;
  let pendingOutputWrites = 0;
  const hangingOutput = new Writable({
    highWaterMark: 1,
    write(chunk) {
      hangingOutputChunk = chunk;
      pendingOutputWrites += 1;
    },
    destroy(_error, callback) {
      pendingOutputWrites = 0;
      callback();
    },
  });
  const hangingOutputStartedAt = Date.now();
  await assert.rejects(
    () => runOutputPath(Buffer.alloc(64 * 1024, 0x48), hangingOutput, shortOutputRunnerLimits),
    /CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT/u,
  );
  assert.equal(Date.now() - hangingOutputStartedAt < 1_000, true);
  assert.equal(hangingOutput.destroyed, true);
  assert.equal(pendingOutputWrites, 0);
  assert.equal(hangingOutputChunk.every((value) => value === 0), true);
  assert.equal(hangingOutput.listenerCount('drain'), 0);
  assert.equal(hangingOutput.listenerCount('error'), 0);
  assert.equal(hangingOutput.listenerCount('close'), 0);

  await validateArtifactDirectory(second.directory);
  await unlock(second.directory);
  await writeFile(path.join(second.directory, 'static/about/index.html'), 'fixture-abouu');
  await lock(second.directory);
  let replacedSecretReads = 0;
  let replacedChildStarts = 0;
  await assert.rejects(() => runStagingSmokeTokenRunner({
    root: sourceRoot,
    argv: runnerArgv,
    environment: {
      ...runnerEnvironment,
      CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR: second.directory,
    },
    readSecret: async () => { replacedSecretReads += 1; return Buffer.from(validSmokeSecret); },
    spawnChild: () => { replacedChildStarts += 1; throw new Error('unexpected'); },
    stdout: { write() {} },
    stderr: { write() {} },
  }), /CLOUDFLARE_E_ARTIFACT_DRIFT/u);
  assert.equal(replacedSecretReads, 0);
  assert.equal(replacedChildStarts, 0);
  const stagingInput = {
    sourceRoot,
    bundleDirectory,
    sourceGitSha: '1'.repeat(40),
    ciSourceGitSha: '1'.repeat(40),
    stagingAccountIdSha256: 'b'.repeat(64),
    stagingBucket: 'dwnc-me-public-media-staging',
    stagingNativeResources,
    mediaManifest: stagingManifest,
    mediaRemoteReceipt: stagingRemoteReceipt,
    mediaReceiptFiles: { signaturePath: stagingSignaturePath, publicKeyPath },
  };
  const stagingFirst = await createStagingPreuploadArtifact({
    ...stagingInput, artifactRoot: path.join(temporary, 'staging-artifacts-a'),
  });
  const stagingSecond = await createStagingPreuploadArtifact({
    ...stagingInput, artifactRoot: path.join(temporary, 'staging-artifacts-b'),
  });
  assert.equal(stagingFirst.artifactSha256, stagingSecond.artifactSha256);
  assert.equal(stagingFirst.receipt.payloadSha256, stagingSecond.receipt.payloadSha256);
  assert.equal(stagingFirst.receipt.payloadSha256, first.receipt.payloadSha256);
  assert.equal(stagingFirst.receipt.stagingBindingsSha256, cloudflareResourceDigest(
    expectedStagingVersionBindings(
      'dwnc-me-public-media-staging', stagingNativeResources)));
  assert.notEqual(stagingFirst.artifactSha256, first.artifactSha256);
  const stagingAuthority = { policy: stagingPolicy, manifest: stagingManifest };
  const stagingValidated = await validateStagingArtifactDirectory(
    stagingFirst.directory, stagingAuthority,
  );
  assert.equal(stagingValidated.artifactSha256, stagingFirst.artifactSha256);
  let productionAuthorityLoads = 0;
  const productionViaStagingUpload = await validateStagingUploadArtifactDirectory(
    first.directory,
    async () => { productionAuthorityLoads += 1; throw new Error('authority must stay lazy'); },
  );
  assert.equal(productionViaStagingUpload.artifactSha256, first.artifactSha256);
  assert.equal(productionAuthorityLoads, 0);
  let stagingAuthorityLoads = 0;
  const stagingViaUpload = await validateStagingUploadArtifactDirectory(
    stagingFirst.directory,
    async () => { stagingAuthorityLoads += 1; return stagingAuthority; },
  );
  assert.equal(stagingViaUpload.artifactSha256, stagingFirst.artifactSha256);
  assert.equal(stagingAuthorityLoads, 1);
  await assert.rejects(() => validateArtifactDirectory(stagingFirst.directory));
  await assert.rejects(() => validateStagingArtifactDirectory(first.directory, stagingAuthority));
  assert.equal((await readdir(stagingFirst.directory)).includes('wrangler-upload.jsonc'), false);

  await assert.rejects(() => validateStagingArtifactDirectory(stagingFirst.directory, {
    policy: stagingPolicy, manifest: { ...stagingManifest, manifestSha256: 'e'.repeat(64) },
  }));

  console.log(JSON.stringify({
    suite: 'cloudflare-preupload-artifact', assertions: 138,
    repeatedArtifactDigestStable: true, timestampInCore: false, buildUuidInCore: false,
    versionIdInCore: false, stagingPayloadComparable: true,
    productionValidatorRejectsStagingArtifact: true,
    liveNetworkCalls: 0, deploymentAttempts: 0, status: 'PASS',
  }, null, 2));
} finally {
  await unlock(temporary);
  await rm(temporary, { recursive: true, force: true });
}
