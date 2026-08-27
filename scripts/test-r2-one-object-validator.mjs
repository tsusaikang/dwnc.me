import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import { writeAnonymousInheritedInput } from './lib/cloudflare-process.mjs';
import {
  createOneObjectValidationReceipt,
} from './lib/public-media-remote.mjs';
import {
  cloudflareAccountIdSha256,
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  publicMediaEntryManifestSha256,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
const execFileAsync = promisify(execFile);
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

const temporaryPaths = [];
async function secureTemporaryDirectory(prefix) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  temporaryPaths.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

async function runChild({
  cwd,
  preload,
  args,
  scenarioPath,
  methodsPath,
  bodyPath,
  environment = {},
}) {
  const child = spawn(process.execPath, [
    `--import=${pathToFileURL(preload).href}`,
    path.join(ROOT, 'scripts/validate-public-media-r2-staging-object.mjs'),
    ...args,
  ], {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      LANG: 'C',
      TZ: 'UTC',
      R2_CREDENTIALS_FD: '3',
      R2_RUNNER_ENVIRONMENT: 'staging',
      R2_RUNNER_ROLE: 'validator',
      R2_TEST_SCENARIO_PATH: scenarioPath,
      R2_TEST_METHODS_PATH: methodsPath,
      R2_TEST_BODY_PATH: bodyPath,
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [, code] = await Promise.all([
    writeAnonymousInheritedInput(
      child.stdio[3], Buffer.from(canonicalJson(credentials)),
      { descriptor: 3, maximumBytes: 4096 },
    ),
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
  ]);
  const output = `${stdout}\n${stderr}`;
  equal(output.includes(credentials.accountId), false, 'raw account id leaked');
  equal(output.includes(credentials.accessKeyId), false, 'access key leaked');
  equal(output.includes(credentials.secretAccessKey), false, 'secret key leaked');
  const methods = JSON.parse(await readFile(methodsPath, 'utf8'));
  return { code, stdout, stderr, output, methods };
}

try {
  const fixtureRoot = await secureTemporaryDirectory('dwnc-r2-one-object-root-');
  const evidenceDirectory = await secureTemporaryDirectory('dwnc-r2-one-object-evidence-');
  await mkdir(path.join(fixtureRoot, 'src/data'), { recursive: true });
  await copyFile(
    path.join(ROOT, 'src/data/public-media-r2-v1.json'),
    path.join(fixtureRoot, 'src/data/public-media-r2-v1.json'),
  );
  const manifest = await loadTrackedPublicMediaManifest(ROOT);
  const entry = manifest.entries[0];
  const bodyPath = path.join(evidenceDirectory, 'body.bin');
  await copyFile(path.join(ROOT, 'public', entry.key), bodyPath);
  const fixturePolicy = structuredClone(await loadTrackedPublicMediaReleasePolicy(ROOT));
  fixturePolicy.staging.accountIdSha256 = cloudflareAccountIdSha256(credentials.accountId);
  await writeFile(
    path.join(fixtureRoot, 'src/data/public-media-release-policy-v1.json'),
    `${JSON.stringify(fixturePolicy, null, 2)}\n`,
  );
  await writeFile(path.join(fixtureRoot, 'wrangler.jsonc'), `${JSON.stringify({
    env: {
      staging: {
        r2_buckets: [{ binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket }],
      },
    },
  }, null, 2)}\n`);
  await git(fixtureRoot, ['init', '-q']);
  await git(fixtureRoot, ['config', 'user.name', 'dwnc fixture']);
  await git(fixtureRoot, ['config', 'user.email', 'fixture@invalid.example']);
  await git(fixtureRoot, ['add', '.']);
  await git(fixtureRoot, ['commit', '-qm', 'fixture']);
  const gitCommitSha = (await git(fixtureRoot, ['rev-parse', 'HEAD'])).stdout.trim();

  const preloadPath = path.join(evidenceDirectory, 'r2-preload.mjs');
  await writeFile(preloadPath, [
    "import { execFileSync } from 'node:child_process';",
    "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
    'const scenario = JSON.parse(readFileSync(process.env.R2_TEST_SCENARIO_PATH, "utf8"));',
    'const expectedBody = readFileSync(process.env.R2_TEST_BODY_PATH);',
    'const methods = [];',
    'function headers(kind, bodyLength = scenario.size) {',
    '  const values = {',
    '    "content-length": String(bodyLength),',
    '    "content-type": scenario.contentType,',
    '    "cache-control": scenario.cacheControl,',
    '    "etag": kind === "GET" && scenario.generationDrift ? "\\\"changed-etag\\\"" : scenario.httpEtag,',
    '    "last-modified": scenario.lastModified,',
    '    "x-amz-meta-sha256": scenario.headDrift && kind === "HEAD" ? "f".repeat(64) : scenario.sha256,',
    '    "x-amz-meta-contract": "dwnc-public-media-r2-v1",',
    '    "x-amz-meta-manifest-entry-sha256": scenario.manifestEntrySha256,',
    '    "x-amz-checksum-sha256": Buffer.from(scenario.sha256, "hex").toString("base64"),',
    '  };',
    '  if (scenario.version !== null) values["x-amz-version-id"] = scenario.version;',
    '  if (kind === "GET" && scenario.getVersion !== undefined) {',
    '    if (scenario.getVersion === null) delete values["x-amz-version-id"];',
    '    else values["x-amz-version-id"] = scenario.getVersion;',
    '  }',
    '  return values;',
    '}',
    'globalThis.fetch = async (_input, init = {}) => {',
    '  const method = init.method ?? "GET";',
    '  methods.push(method);',
    '  if (method === "HEAD") {',
    '    if (scenario.headNetworkError) throw new Error("synthetic head network error");',
    '    if (scenario.head500) return new Response(null, { status: 500 });',
    '    if (scenario.missing) return new Response(null, { status: 404 });',
    '    return new Response(null, { status: 200, headers: headers("HEAD") });',
    '  }',
    '  if (method === "GET") {',
    '    if (scenario.getNetworkError) throw new Error("synthetic get network error");',
    '    if (scenario.get500) return new Response(null, { status: 500 });',
    '    if (scenario.gitTrackedDrift) appendFileSync("wrangler.jsonc", " ");',
    '    if (scenario.gitHeadMove) execFileSync("git", ["commit", "--allow-empty", "-qm", "synthetic head move"]);',
    '    if (scenario.partialStatus) {',
    '      return new Response(expectedBody.subarray(0, 1), { status: 206, headers: {',
    '        ...headers("GET", 1), "content-range": `bytes 0-0/${scenario.size}`,',
    '      } });',
    '    }',
    '    let body = expectedBody;',
    '    if (scenario.bodyDrift) {',
    '      body = Buffer.from(expectedBody);',
    '      body[0] ^= 0xff;',
    '    }',
    '    const responseHeaders = headers("GET");',
    '    if (scenario.partialHeader) responseHeaders["content-range"] = `bytes 0-${scenario.size - 1}/${scenario.size}`;',
    '    return new Response(body, { status: 200, headers: responseHeaders });',
    '  }',
    '  throw new Error("R2_TEST_UNEXPECTED_METHOD");',
    '};',
    'process.on("exit", () => writeFileSync(process.env.R2_TEST_METHODS_PATH, JSON.stringify(methods)));',
    '',
  ].join('\n'), { mode: 0o600 });

  const baseScenario = Object.freeze({
    size: entry.size,
    sha256: entry.sha256,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
    manifestEntrySha256: publicMediaEntryManifestSha256(entry),
    version: null,
    httpEtag: '"one-object-etag"',
    lastModified: 'Thu, 27 Aug 2026 00:00:00 GMT',
  });
  let caseNumber = 0;
  const runCase = async ({
    name,
    scenario = {},
    argumentOverrides = {},
    environment = {},
    existingOutput = false,
  }) => {
    caseNumber += 1;
    const scenarioPath = path.join(evidenceDirectory, `${caseNumber}-${name}-scenario.json`);
    const methodsPath = path.join(evidenceDirectory, `${caseNumber}-${name}-methods.json`);
    const receiptOutput = path.join(evidenceDirectory, `${caseNumber}-${name}-receipt.json`);
    await writeFile(scenarioPath, `${JSON.stringify({ ...baseScenario, ...scenario })}\n`, {
      mode: 0o600,
    });
    if (existingOutput) await writeFile(receiptOutput, 'do-not-overwrite\n', { mode: 0o600 });
    const values = {
      key: entry.key,
      manifest: manifest.manifestSha256,
      git: gitCommitSha,
      output: receiptOutput,
      ...argumentOverrides,
    };
    const args = [
      `--key=${values.key}`,
      `--expected-manifest-sha256=${values.manifest}`,
      `--expected-git-sha=${values.git}`,
      `--receipt-output=${values.output}`,
      ...(values.extra ?? []),
    ];
    const result = await runChild({
      cwd: fixtureRoot,
      preload: preloadPath,
      args,
      scenarioPath,
      methodsPath,
      bodyPath,
      environment,
    });
    return { ...result, receiptOutput };
  };

  const exact = await runCase({ name: 'exact' });
  equal(exact.code, 0, exact.output);
  equal(exact.methods, ['HEAD', 'GET']);
  const summary = JSON.parse(exact.stdout);
  equal(summary.requestMethods, { HEAD: 1, GET: 1, PUT: 0, DELETE: 0 });
  equal(summary.credentialRole, 'validator');
  equal(summary.gitCommitSha, gitCommitSha);
  const receipt = JSON.parse(await readFile(exact.receiptOutput, 'utf8'));
  equal(receipt.contract, 'dwnc-public-media-r2-staging-one-object-validation-v1');
  equal(receipt.environment, 'staging');
  equal(receipt.credentialRole, 'validator');
  equal(receipt.gitCommitSha, gitCommitSha);
  equal(receipt.manifestSha256, manifest.manifestSha256);
  equal(receipt.manifestEntrySha256, publicMediaEntryManifestSha256(entry));
  equal(receipt.key, entry.key);
  equal(receipt.fullGetBodyBytes, entry.size);
  equal(receipt.fullGetBodySha256, entry.sha256);
  equal(receipt.platformChecksumSha256, entry.sha256);
  equal(receipt.version, null);
  equal(receipt.httpEtag, baseScenario.httpEtag);
  equal(receipt.lastModified, '2026-08-27T00:00:00.000Z');
  equal(receipt.requestMethods, { HEAD: 1, GET: 1, PUT: 0, DELETE: 0 });
  equal({ overwrite: receipt.overwrite, delete: receipt.delete }, { overwrite: 0, delete: 0 });
  const receiptStats = await lstat(exact.receiptOutput);
  equal(receiptStats.mode & 0o777, 0o600);
  equal(receiptStats.nlink, 1);
  const validatedRemote = {
    key: entry.key,
    size: entry.size,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
    sha256: entry.sha256,
    contract: 'dwnc-public-media-r2-v1',
    manifestEntrySha256: publicMediaEntryManifestSha256(entry),
    platformChecksumSha256: entry.sha256,
    version: null,
    httpEtag: baseScenario.httpEtag,
    lastModified: '2026-08-27T00:00:00.000Z',
  };
  assert.throws(() => createOneObjectValidationReceipt(
    manifest,
    entry,
    {
      head: validatedRemote,
      full: { ...validatedRemote, bodyBytes: entry.size, bodySha256: entry.sha256 },
    },
    {
      target: {
        environment: 'staging',
        bucket: credentials.bucket,
        accountIdSha256: cloudflareAccountIdSha256(credentials.accountId),
      },
      gitCommitSha,
      requestMethods: { HEAD: 2, GET: 1, PUT: 0, DELETE: 0 },
    },
  ), /MEDIA_E_R2_ONE_OBJECT_RECEIPT/u);
  assertions += 1;

  const negativeCases = [
    { name: 'head-500', scenario: { head500: true }, code: 'MEDIA_E_R2_HEAD', methods: ['HEAD'] },
    { name: 'head-network', scenario: { headNetworkError: true }, code: 'MEDIA_E_R2_NETWORK', methods: ['HEAD'] },
    { name: 'get-500', scenario: { get500: true }, code: 'MEDIA_E_R2_GET', methods: ['HEAD', 'GET'] },
    { name: 'get-network', scenario: { getNetworkError: true }, code: 'MEDIA_E_R2_NETWORK', methods: ['HEAD', 'GET'] },
    { name: 'missing', scenario: { missing: true }, code: 'MEDIA_E_R2_ONE_OBJECT_MISSING', methods: ['HEAD'] },
    { name: 'head-drift', scenario: { headDrift: true }, code: 'MEDIA_E_R2_ONE_OBJECT_HEAD_MISMATCH', methods: ['HEAD'] },
    { name: 'partial-status', scenario: { partialStatus: true }, code: 'MEDIA_E_R2_GET', methods: ['HEAD', 'GET'] },
    { name: 'partial-header', scenario: { partialHeader: true }, code: 'MEDIA_E_R2_GET_PARTIAL', methods: ['HEAD', 'GET'] },
    { name: 'body-drift', scenario: { bodyDrift: true }, code: 'MEDIA_E_R2_ONE_OBJECT_FULL_GET_MISMATCH', methods: ['HEAD', 'GET'] },
    { name: 'generation-drift', scenario: { generationDrift: true }, code: 'MEDIA_E_R2_ONE_OBJECT_FULL_GET_MISMATCH', methods: ['HEAD', 'GET'] },
    { name: 'version-drift', scenario: { version: 'one', getVersion: 'two' }, code: 'MEDIA_E_R2_ONE_OBJECT_FULL_GET_MISMATCH', methods: ['HEAD', 'GET'] },
  ];
  for (const fixture of negativeCases) {
    const result = await runCase(fixture);
    equal(result.code === 0, false, `${fixture.name}: expected failure`);
    equal(result.output.includes(fixture.code), true, `${fixture.name}: ${result.output}`);
    equal(result.methods, fixture.methods, fixture.name);
    const absent = await lstat(result.receiptOutput).catch((error) => error?.code);
    equal(absent, 'ENOENT', `${fixture.name}: receipt must be absent`);
  }

  const wranglerPath = path.join(fixtureRoot, 'wrangler.jsonc');
  const wranglerBeforeRace = await readFile(wranglerPath);
  const trackedRace = await runCase({
    name: 'git-tracked-drift-during-get',
    scenario: { gitTrackedDrift: true },
  });
  equal(trackedRace.code === 0, false, 'tracked Git drift must fail');
  equal(trackedRace.output.includes('MEDIA_E_R2_ONE_OBJECT_GIT'), true, trackedRace.output);
  equal(trackedRace.methods, ['HEAD', 'GET']);
  equal(await lstat(trackedRace.receiptOutput).catch((error) => error?.code), 'ENOENT');
  await writeFile(wranglerPath, wranglerBeforeRace);
  equal((await git(fixtureRoot, ['status', '--porcelain=v1'])).stdout, '', 'tracked fixture restored');

  const branchRef = (await git(fixtureRoot, ['symbolic-ref', 'HEAD'])).stdout.trim();
  const headRace = await runCase({
    name: 'git-head-move-during-get',
    scenario: { gitHeadMove: true },
  });
  equal(headRace.code === 0, false, 'moved HEAD must fail');
  equal(headRace.output.includes('MEDIA_E_R2_ONE_OBJECT_GIT'), true, headRace.output);
  equal(headRace.methods, ['HEAD', 'GET']);
  equal(await lstat(headRace.receiptOutput).catch((error) => error?.code), 'ENOENT');
  const movedGitSha = (await git(fixtureRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  equal(movedGitSha === gitCommitSha, false, 'fixture HEAD must have moved');
  await git(fixtureRoot, ['update-ref', branchRef, gitCommitSha, movedGitSha]);
  equal((await git(fixtureRoot, ['rev-parse', 'HEAD'])).stdout.trim(), gitCommitSha,
    'fixture HEAD restored');
  equal((await git(fixtureRoot, ['status', '--porcelain=v1'])).stdout, '', 'HEAD fixture clean');

  const preflightCases = [
    {
      name: 'uploader-role',
      environment: { R2_RUNNER_ROLE: 'uploader' },
      code: 'MEDIA_E_R2_ONE_OBJECT_ROLE',
    },
    {
      name: 'production-role-injection',
      argumentOverrides: { extra: ['--environment=production'] },
      code: 'MEDIA_E_R2_ONE_OBJECT_ARGUMENT',
    },
    {
      name: 'apply',
      argumentOverrides: { extra: ['--apply'] },
      code: 'MEDIA_E_R2_ONE_OBJECT_ARGUMENT',
    },
    {
      name: 'legacy-credentials',
      environment: { R2_ACCOUNT_ID: 'd'.repeat(32) },
      code: 'MEDIA_E_R2_CREDENTIALS_ENV_FORBIDDEN',
    },
    {
      name: 'wrong-key',
      argumentOverrides: { key: 'media/not-in-manifest.bin' },
      code: 'MEDIA_E_R2_ONE_OBJECT_MANIFEST_MEMBER',
    },
    {
      name: 'wrong-manifest',
      argumentOverrides: { manifest: '0'.repeat(64) },
      code: 'MEDIA_E_EXPECTED_MANIFEST',
    },
    {
      name: 'wrong-git',
      argumentOverrides: { git: '0'.repeat(40) },
      code: 'MEDIA_E_R2_ONE_OBJECT_GIT',
    },
    {
      name: 'existing-output',
      existingOutput: true,
      code: 'CLOUDFLARE_E_SIGNING_FILE_EXISTS',
    },
  ];
  for (const fixture of preflightCases) {
    const result = await runCase(fixture);
    equal(result.code === 0, false, `${fixture.name}: expected failure`);
    equal(result.output.includes(fixture.code), true, `${fixture.name}: ${result.output}`);
    equal(result.methods, [], `${fixture.name}: no R2 request allowed`);
    if (fixture.existingOutput) {
      equal(await readFile(result.receiptOutput, 'utf8'), 'do-not-overwrite\n');
    } else {
      const absent = await lstat(result.receiptOutput).catch((error) => error?.code);
      equal(absent, 'ENOENT', `${fixture.name}: receipt must be absent`);
    }
  }

  equal(
    createHash('sha256').update(await readFile(bodyPath)).digest('hex'),
    entry.sha256,
    'fixture body must match manifest',
  );
} finally {
  await Promise.all(temporaryPaths.reverse().map((directory) => rm(
    directory, { recursive: true, force: true },
  )));
}

console.log(JSON.stringify({
  suite: 'r2-validator-one-object-read-only',
  assertions,
  exactRequestMethods: { HEAD: 1, GET: 1, PUT: 0, DELETE: 0 },
  liveNetworkCalls: 0,
  realKeychainCalls: 0,
  status: 'PASS',
}, null, 2));
