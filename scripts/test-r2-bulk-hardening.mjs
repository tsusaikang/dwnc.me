import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import { writeAnonymousInheritedInput } from './lib/cloudflare-process.mjs';
import {
  cloudflareAccountIdSha256,
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
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
const productionCredentials = Object.freeze({
  ...credentials,
  bucket: 'dwnc-me-public-media-production',
});
let assertions = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
};

const temporaryDirectories = [];
async function secureTemporaryDirectory(prefix) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  temporaryDirectories.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

async function absent(file) {
  return (await lstat(file).catch((error) => error?.code)) === 'ENOENT';
}

try {
  const manifest = await loadTrackedPublicMediaManifest(ROOT);
  const fixtureRoot = await secureTemporaryDirectory('dwnc-r2-bulk-root-');
  const evidenceDirectory = await secureTemporaryDirectory('dwnc-r2-bulk-evidence-');
  await mkdir(path.join(fixtureRoot, 'src/data'), { recursive: true });
  await copyFile(
    path.join(ROOT, 'src/data/public-media-r2-v1.json'),
    path.join(fixtureRoot, 'src/data/public-media-r2-v1.json'),
  );
  const policy = structuredClone(await loadTrackedPublicMediaReleasePolicy(ROOT));
  policy.staging.accountIdSha256 = cloudflareAccountIdSha256(credentials.accountId);
  policy.production.accountIdSha256 = cloudflareAccountIdSha256(credentials.accountId);
  await writeFile(
    path.join(fixtureRoot, 'src/data/public-media-release-policy-v1.json'),
    `${JSON.stringify(policy, null, 2)}\n`,
  );
  const wranglerPath = path.join(fixtureRoot, 'wrangler.jsonc');
  const wranglerBytes = Buffer.from(`${JSON.stringify({
    env: {
      staging: { r2_buckets: [{
        binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket,
      }] },
      production: { r2_buckets: [{
        binding: 'MEDIA_BUCKET', bucket_name: productionCredentials.bucket,
      }] },
    },
  }, null, 2)}\n`);
  await writeFile(wranglerPath, wranglerBytes);

  const selected = manifest.entries.slice().sort((left, right) => left.size - right.size).slice(0, 2)
    .sort((left, right) => manifest.entries.indexOf(left) - manifest.entries.indexOf(right));
  for (const entry of selected) {
    const destination = path.join(fixtureRoot, 'public', entry.key);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(ROOT, 'public', entry.key), destination);
  }
  await git(fixtureRoot, ['init', '-q']);
  await git(fixtureRoot, ['config', 'user.name', 'dwnc fixture']);
  await git(fixtureRoot, ['config', 'user.email', 'fixture@invalid.example']);
  await git(fixtureRoot, ['add', '.']);
  await git(fixtureRoot, ['commit', '-qm', 'fixture']);
  const gitCommit = (await git(fixtureRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const gitTree = (await git(fixtureRoot, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
  const branchRef = (await git(fixtureRoot, ['symbolic-ref', 'HEAD'])).stdout.trim();

  const preloadPath = path.join(evidenceDirectory, 'r2-bulk-preload.mjs');
  await writeFile(preloadPath, [
    "import { createHash } from 'node:crypto';",
    "import { execFileSync } from 'node:child_process';",
    "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
    "const manifest = JSON.parse(readFileSync('src/data/public-media-r2-v1.json', 'utf8'));",
    'const entries = new Map(manifest.entries.map((entry) => [entry.key, entry]));',
    "const statePath = process.env.R2_TEST_STATE_PATH;",
    "const methodsPath = process.env.R2_TEST_METHODS_PATH;",
    "const state = JSON.parse(readFileSync(statePath, 'utf8'));",
    'const methods = [];',
    'const save = () => writeFileSync(statePath, JSON.stringify(state));',
    'const missing = () => new Set(state.missingKeys);',
    'const entryDigest = (entry) => createHash("sha256").update(JSON.stringify({',
    '  publicPath: entry.publicPath, key: entry.key, size: entry.size, sha256: entry.sha256,',
    '  contentType: entry.contentType, cacheControl: entry.cacheControl,',
    '})).digest("hex");',
    'const objectHeaders = (entry) => ({',
    '  "content-length": String(entry.size),',
    '  "content-type": entry.contentType,',
    '  "cache-control": entry.cacheControl,',
    '  etag: `"fixture-${entry.sha256.slice(0, 16)}"`,',
    '  "last-modified": "Thu, 27 Aug 2026 00:00:00 GMT",',
    '  "x-amz-meta-sha256": entry.sha256,',
    '  "x-amz-meta-contract": "dwnc-public-media-r2-v1",',
    '  "x-amz-meta-manifest-entry-sha256": entryDigest(entry),',
    '  "x-amz-checksum-sha256": Buffer.from(entry.sha256, "hex").toString("base64"),',
    '});',
    'const xml = (url) => {',
    '  const offset = Number(url.searchParams.get("continuation-token") ?? "0");',
    '  const keys = manifest.entries.map((entry) => entry.key).filter((key) => !missing().has(key));',
    '  if (state.addOrphanAfterPut && state.putOccurred) keys.push("media/synthetic-orphan.bin");',
    '  keys.sort();',
    '  const page = keys.slice(offset, offset + 1000);',
    '  const next = offset + page.length;',
    '  const truncated = next < keys.length;',
    '  return `<ListBucketResult><IsTruncated>${truncated}</IsTruncated>${truncated',
    '    ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}${page.map((key) => {',
    '      const entry = entries.get(key);',
    '      return `<Contents><Key>${encodeURIComponent(key)}</Key><Size>${entry?.size ?? 1}</Size>`',
    '        + `<ETag>&quot;fixture&quot;</ETag></Contents>`;',
    '    }).join("")}</ListBucketResult>`;',
    '};',
    'const applyGitMutation = () => {',
    '  if (state.gitMutationApplied) return;',
    '  if (state.gitTrackedDrift) {',
    '    appendFileSync("wrangler.jsonc", " ");',
    '    state.gitMutationApplied = true;',
    '    save();',
    '  } else if (state.gitHeadMove) {',
    '    execFileSync("git", ["commit", "--allow-empty", "-qm", "synthetic head move"]);',
    '    state.gitMutationApplied = true;',
    '    save();',
    '  }',
    '};',
    'if (process.env.R2_TEST_RACE_OUTPUT) {',
    '  setTimeout(() => {',
    '    try { writeFileSync(process.env.R2_TEST_RACE_OUTPUT, "competing-writer\\n", { flag: "wx" }); }',
    '    catch { /* The secure preflight remains authoritative. */ }',
    '  }, 0);',
    '}',
    'globalThis.fetch = async (input, init = {}) => {',
    '  const url = new URL(input);',
    '  const method = init.method ?? "GET";',
    '  const list = method === "GET" && url.searchParams.get("list-type") === "2";',
    '  const marker = `/${process.env.R2_TEST_BUCKET}/`;',
    '  const key = list ? null : decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));',
    '  methods.push({ method, list, key, ifNoneMatch: init.headers?.get?.("if-none-match") ?? null });',
    '  applyGitMutation();',
    '  if (list) return new Response(xml(url), { status: 200 });',
    '  const entry = entries.get(key);',
    '  if (method === "HEAD") {',
    '    if (!entry || missing().has(key)) return new Response(null, { status: 404 });',
    '    return new Response(null, { status: 200, headers: objectHeaders(entry) });',
    '  }',
    '  if (method === "PUT") {',
    '    state.putOccurred = true;',
    '    state.putKeys.push(key);',
    '    if (init.headers?.get?.("if-none-match") !== "*") state.nonConditionalPut = true;',
    '    if (!entry || !missing().has(key)) { save(); return new Response(null, { status: 412 }); }',
    '    if (state.failOnKey === key && !state.failed) {',
    '      state.failed = true;',
    '      save();',
    '      return new Response("synthetic failure", { status: 403 });',
    '    }',
    '    state.missingKeys = state.missingKeys.filter((candidate) => candidate !== key);',
    '    if (state.raceKey === key && !state.raced) {',
    '      state.raced = true;',
    '      save();',
    '      return new Response(null, { status: 412 });',
    '    }',
    '    if (process.env.R2_TEST_COMPETE_AFTER_PUT_OUTPUT && !state.competitorWritten) {',
    '      writeFileSync(process.env.R2_TEST_COMPETE_AFTER_PUT_OUTPUT, "post-put-competitor\\n",',
    '        { flag: "wx", mode: 0o600 });',
    '      state.competitorWritten = true;',
    '    }',
    '    save();',
    '    return new Response(null, { status: 201 });',
    '  }',
    '  throw new Error("R2_TEST_UNEXPECTED_METHOD");',
    '};',
    'process.on("exit", () => { save(); writeFileSync(methodsPath, JSON.stringify(methods)); });',
    '',
  ].join('\n'), { mode: 0o600 });

  let caseNumber = 0;
  const baseState = (overrides = {}) => ({
    missingKeys: [],
    putKeys: [],
    nonConditionalPut: false,
    failOnKey: null,
    failed: false,
    raceKey: null,
    raced: false,
    addOrphanAfterPut: false,
    putOccurred: false,
    gitTrackedDrift: false,
    gitHeadMove: false,
    gitMutationApplied: false,
    competitorWritten: false,
    ...overrides,
  });
  const runCommand = async ({
    name,
    script = 'scripts/sync-public-media-r2.mjs',
    role = 'uploader',
    output,
    state = null,
    statePath = null,
    args = null,
    environment = {},
    targetEnvironment = 'staging',
    targetCredentials = credentials,
  }) => {
    caseNumber += 1;
    const currentStatePath = statePath ?? path.join(evidenceDirectory, `${caseNumber}-${name}-state.json`);
    if (state !== null) await writeFile(currentStatePath, JSON.stringify(state), { mode: 0o600 });
    const methodsPath = path.join(evidenceDirectory, `${caseNumber}-${name}-methods.json`);
    const forwarded = args ?? [
      '--apply', `--environment=${targetEnvironment}`, '--concurrency=1',
      `--expected-manifest-sha256=${manifest.manifestSha256}`,
      '--expected-orphan-count=0',
      `--expected-git-commit=${gitCommit}`,
      `--expected-git-tree=${gitTree}`,
      `--receipt-output=${output}`,
    ];
    const child = spawn(process.execPath, [
      `--import=${pathToFileURL(preloadPath).href}`,
      path.join(ROOT, script),
      ...forwarded,
    ], {
      cwd: fixtureRoot,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
        LANG: 'C',
        TZ: 'UTC',
        R2_CREDENTIALS_FD: '3',
        R2_RUNNER_ENVIRONMENT: targetEnvironment,
        R2_RUNNER_ROLE: role,
        R2_TEST_STATE_PATH: currentStatePath,
        R2_TEST_METHODS_PATH: methodsPath,
        R2_TEST_BUCKET: targetCredentials.bucket,
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
        child.stdio[3], Buffer.from(canonicalJson(targetCredentials)),
        { descriptor: 3, maximumBytes: 4096 },
      ),
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      }),
    ]);
    const combined = `${stdout}\n${stderr}`;
    equal(combined.includes(targetCredentials.accountId), false, `${name}: account id leaked`);
    equal(combined.includes(targetCredentials.accessKeyId), false, `${name}: access key leaked`);
    equal(combined.includes(targetCredentials.secretAccessKey), false, `${name}: secret leaked`);
    return {
      code,
      stdout,
      stderr,
      combined,
      state: JSON.parse(await readFile(currentStatePath, 'utf8')),
      methods: JSON.parse(await readFile(methodsPath, 'utf8')),
      statePath: currentStatePath,
    };
  };

  const [firstMissing, secondMissing] = selected;
  const mixedOutput = path.join(evidenceDirectory, 'mixed-receipt.json');
  const mixed = await runCommand({
    name: 'mixed-positive',
    output: mixedOutput,
    state: baseState({ missingKeys: selected.map((entry) => entry.key) }),
  });
  equal(mixed.code, 0, mixed.combined);
  equal(mixed.state.missingKeys, []);
  equal(mixed.state.nonConditionalPut, false);
  equal(mixed.state.putKeys, selected.map((entry) => entry.key));
  const exactKey = manifest.entries.find((entry) => !selected.includes(entry)).key;
  equal(mixed.state.putKeys.includes(exactKey), false, 'existing exact object must never be PUT');
  const mixedReceipt = JSON.parse(await readFile(mixedOutput, 'utf8'));
  equal(mixedReceipt.contract, 'dwnc-public-media-r2-bulk-sync-v1');
  equal(mixedReceipt.preInspection, {
    listed: 2_756, exact: 2_756, missing: 2, mismatch: 0, orphan: 0,
  });
  equal(mixedReceipt.postInspection, {
    listed: 2_758, exact: 2_758, missing: 0, mismatch: 0, orphan: 0,
  });
  equal(mixedReceipt.writes, {
    initialMissing: 2,
    exactSkipped: 2_756,
    conditionalCreateOperations: 2,
    conditionalIfNoneMatchRequests: 2,
    actualCreated: 2,
    preconditionRecovered: 0,
    overwrite: 0,
    delete: 0,
  });
  equal(mixedReceipt.requestCounts, { LIST: 6, HEAD: 5_516, GET: 0, PUT: 2, DELETE: 0 });
  equal(mixedReceipt.source, {
    gitCommit, gitTree, clean: true, gitCheckCount: 3,
  });

  const productionOutput = path.join(evidenceDirectory, 'production-receipt.json');
  const production = await runCommand({
    name: 'production-positive',
    output: productionOutput,
    state: baseState({ missingKeys: selected.map((entry) => entry.key) }),
    targetEnvironment: 'production',
    targetCredentials: productionCredentials,
  });
  equal(production.code, 0, production.combined);
  equal(production.state.nonConditionalPut, false);
  equal(production.methods.filter((request) => request.method === 'PUT').length, 2);
  equal(production.methods.some((request) => request.method === 'DELETE'), false);
  const productionReceipt = JSON.parse(await readFile(productionOutput, 'utf8'));
  equal(productionReceipt.target, {
    environment: 'production',
    bucket: productionCredentials.bucket,
    accountIdSha256: cloudflareAccountIdSha256(productionCredentials.accountId),
  });
  equal(productionReceipt.writes.overwrite, 0);
  equal(productionReceipt.writes.delete, 0);

  const partialOutput = path.join(evidenceDirectory, 'partial-receipt.json');
  const partial = await runCommand({
    name: 'partial-first-run',
    output: partialOutput,
    state: baseState({
      missingKeys: selected.map((entry) => entry.key), failOnKey: secondMissing.key,
    }),
  });
  equal(partial.code === 0, false, 'partial first run must fail');
  equal(partial.combined.includes('MEDIA_E_R2_PUT'), true, partial.combined);
  equal(partial.state.missingKeys, [secondMissing.key]);
  equal(await absent(partialOutput), true, 'partial first run receipt must be absent');
  const resumed = await runCommand({
    name: 'partial-resume',
    output: partialOutput,
    statePath: partial.statePath,
  });
  equal(resumed.code, 0, resumed.combined);
  const resumedReceipt = JSON.parse(await readFile(partialOutput, 'utf8'));
  equal(resumedReceipt.preInspection.missing, 1);
  equal(resumedReceipt.writes.actualCreated, 1);
  equal(resumedReceipt.writes.exactSkipped, 2_757);
  equal(resumed.methods.filter((request) => request.method === 'PUT').map((request) => request.key),
    [secondMissing.key]);

  const raceOutput = path.join(evidenceDirectory, 'race-receipt.json');
  const raced = await runCommand({
    name: 'precondition-race',
    output: raceOutput,
    state: baseState({ missingKeys: [firstMissing.key], raceKey: firstMissing.key }),
  });
  equal(raced.code, 0, raced.combined);
  const raceReceipt = JSON.parse(await readFile(raceOutput, 'utf8'));
  equal(raceReceipt.writes.actualCreated, 0);
  equal(raceReceipt.writes.preconditionRecovered, 1);
  equal(raceReceipt.writes.conditionalIfNoneMatchRequests, 1);
  equal(raceReceipt.requestCounts.HEAD, 5_517);

  const orphanOutput = path.join(evidenceDirectory, 'orphan-receipt.json');
  const orphan = await runCommand({
    name: 'post-orphan',
    output: orphanOutput,
    state: baseState({ missingKeys: [firstMissing.key], addOrphanAfterPut: true }),
  });
  equal(orphan.code === 0, false);
  equal(orphan.combined.includes('MEDIA_E_REMOTE_POST_UPLOAD'), true, orphan.combined);
  equal(await absent(orphanOutput), true, 'post-orphan receipt must be absent');

  const strictOutput = path.join(evidenceDirectory, 'strict-inspection.json');
  const strict = await runCommand({
    name: 'strict-inspection',
    script: 'scripts/inspect-public-media-r2.mjs',
    role: 'validator',
    output: strictOutput,
    state: baseState(),
    args: [
      '--environment=staging', '--concurrency=16',
      `--expected-manifest-sha256=${manifest.manifestSha256}`,
      `--expected-git-commit=${gitCommit}`,
      `--expected-git-tree=${gitTree}`,
      '--expected-exact=2758', '--expected-missing=0', '--expected-mismatch=0',
      '--expected-orphan-count=0', `--receipt-output=${strictOutput}`,
    ],
  });
  equal(strict.code, 0, strict.combined);
  const strictReceipt = JSON.parse(await readFile(strictOutput, 'utf8'));
  equal(strictReceipt.observed, {
    listed: 2_758, exact: 2_758, missing: 0, mismatch: 0, orphan: 0,
  });
  equal(strictReceipt.requestCounts, { LIST: 3, HEAD: 2_758, GET: 0, PUT: 0, DELETE: 0 });

  const wrongStrictOutput = path.join(evidenceDirectory, 'wrong-strict-inspection.json');
  const wrongStrict = await runCommand({
    name: 'wrong-strict-inspection',
    script: 'scripts/inspect-public-media-r2.mjs',
    role: 'validator',
    output: wrongStrictOutput,
    state: baseState(),
    args: [
      '--environment=staging', '--concurrency=16',
      `--expected-manifest-sha256=${manifest.manifestSha256}`,
      `--expected-git-commit=${gitCommit}`,
      `--expected-git-tree=${gitTree}`,
      '--expected-exact=2757', '--expected-missing=1', '--expected-mismatch=0',
      '--expected-orphan-count=0', `--receipt-output=${wrongStrictOutput}`,
    ],
  });
  equal(wrongStrict.code === 0, false);
  equal(wrongStrict.combined.includes('MEDIA_E_R2_INSPECTION_COUNTS'), true, wrongStrict.combined);
  equal(await absent(wrongStrictOutput), true);
  equal(wrongStrict.methods.some((request) => request.method === 'PUT'), false);

  const existingOutput = path.join(evidenceDirectory, 'preexisting.json');
  await writeFile(existingOutput, 'do-not-overwrite\n', { mode: 0o600 });
  const preexisting = await runCommand({
    name: 'preexisting-output', output: existingOutput, state: baseState(),
  });
  equal(preexisting.code === 0, false);
  equal(preexisting.combined.includes('CLOUDFLARE_E_SIGNING_FILE_EXISTS'), true,
    preexisting.combined);
  equal(preexisting.methods, []);
  equal(await readFile(existingOutput, 'utf8'), 'do-not-overwrite\n');

  const symlinkTarget = path.join(evidenceDirectory, 'symlink-target.json');
  const symlinkOutput = path.join(evidenceDirectory, 'symlink-output.json');
  await writeFile(symlinkTarget, 'target\n', { mode: 0o600 });
  await symlink(symlinkTarget, symlinkOutput);
  const symlinked = await runCommand({
    name: 'symlink-output', output: symlinkOutput, state: baseState(),
  });
  equal(symlinked.code === 0, false);
  equal(symlinked.methods, []);
  equal(await readFile(symlinkTarget, 'utf8'), 'target\n');

  const hardlinkTarget = path.join(evidenceDirectory, 'hardlink-target.json');
  const hardlinkOutput = path.join(evidenceDirectory, 'hardlink-output.json');
  await writeFile(hardlinkTarget, 'target\n', { mode: 0o600 });
  await link(hardlinkTarget, hardlinkOutput);
  const hardlinked = await runCommand({
    name: 'hardlink-output', output: hardlinkOutput, state: baseState(),
  });
  equal(hardlinked.code === 0, false);
  equal(hardlinked.methods, []);
  equal((await lstat(hardlinkTarget)).nlink, 2);

  for (const [name, mode] of [['unsafe-parent', 0o755], ['unwritable-parent', 0o500]]) {
    const parent = await secureTemporaryDirectory(`dwnc-${name}-`);
    await chmod(parent, mode);
    const output = path.join(parent, 'receipt.json');
    const result = await runCommand({ name, output, state: baseState() });
    equal(result.code === 0, false);
    equal(result.methods, []);
    equal(await absent(output), true);
    await chmod(parent, 0o700);
  }

  const competingOutput = path.join(evidenceDirectory, 'competing-output.json');
  const competing = await runCommand({
    name: 'competing-output',
    output: competingOutput,
    state: baseState(),
    environment: { R2_TEST_RACE_OUTPUT: competingOutput },
  });
  equal(competing.code === 0, false);
  equal(competing.methods, []);
  equal(await readFile(competingOutput, 'utf8'), 'competing-writer\n');

  const postPutCompetingOutput = path.join(evidenceDirectory, 'post-put-competing-output.json');
  const postPutCompeting = await runCommand({
    name: 'post-put-competing-output',
    output: postPutCompetingOutput,
    state: baseState({ missingKeys: [firstMissing.key] }),
    environment: { R2_TEST_COMPETE_AFTER_PUT_OUTPUT: postPutCompetingOutput },
  });
  equal(postPutCompeting.code === 0, false);
  equal(postPutCompeting.combined.includes('CLOUDFLARE_E_SIGNING_FILE_EXISTS'), true,
    postPutCompeting.combined);
  equal(await readFile(postPutCompetingOutput, 'utf8'), 'post-put-competitor\n');
  equal(postPutCompeting.state.missingKeys, []);
  equal(postPutCompeting.methods.filter((request) => request.method === 'PUT').map(
    (request) => ({ key: request.key, ifNoneMatch: request.ifNoneMatch }),
  ), [{ key: firstMissing.key, ifNoneMatch: '*' }]);

  const postPutRecoveryOutput = path.join(evidenceDirectory, 'post-put-recovery-output.json');
  const postPutRecovery = await runCommand({
    name: 'post-put-recovery',
    output: postPutRecoveryOutput,
    statePath: postPutCompeting.statePath,
  });
  equal(postPutRecovery.code, 0, postPutRecovery.combined);
  equal(postPutRecovery.methods.some((request) => request.method === 'PUT'), false);
  const postPutRecoveryReceipt = JSON.parse(await readFile(postPutRecoveryOutput, 'utf8'));
  equal(postPutRecoveryReceipt.writes.initialMissing, 0);
  equal(postPutRecoveryReceipt.writes.exactSkipped, 2_758);
  equal(postPutRecoveryReceipt.writes.actualCreated, 0);
  equal(postPutRecoveryReceipt.writes.preconditionRecovered, 0);
  equal(postPutRecoveryReceipt.requestCounts.PUT, 0);
  equal(postPutRecoveryReceipt.writes.overwrite, 0);
  equal(postPutRecoveryReceipt.writes.delete, 0);

  const wrongGitOutput = path.join(evidenceDirectory, 'wrong-git.json');
  const wrongGit = await runCommand({
    name: 'wrong-git',
    output: wrongGitOutput,
    state: baseState(),
    args: [
      '--apply', '--environment=staging', '--concurrency=1',
      `--expected-manifest-sha256=${manifest.manifestSha256}`,
      '--expected-orphan-count=0', `--expected-git-commit=${'0'.repeat(40)}`,
      `--expected-git-tree=${gitTree}`, `--receipt-output=${wrongGitOutput}`,
    ],
  });
  equal(wrongGit.code === 0, false);
  equal(wrongGit.combined.includes('MEDIA_E_R2_GIT'), true, wrongGit.combined);
  equal(wrongGit.methods, []);
  equal(await absent(wrongGitOutput), true);

  const driftOutput = path.join(evidenceDirectory, 'git-drift.json');
  const drift = await runCommand({
    name: 'git-drift-during-remote',
    output: driftOutput,
    state: baseState({ gitTrackedDrift: true }),
  });
  equal(drift.code === 0, false);
  equal(drift.combined.includes('MEDIA_E_R2_GIT'), true, drift.combined);
  equal(await absent(driftOutput), true);
  await writeFile(wranglerPath, wranglerBytes);
  equal((await git(fixtureRoot, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout, '');

  const movedOutput = path.join(evidenceDirectory, 'git-head-move.json');
  const moved = await runCommand({
    name: 'git-head-move-during-remote',
    output: movedOutput,
    state: baseState({ gitHeadMove: true }),
  });
  equal(moved.code === 0, false);
  equal(moved.combined.includes('MEDIA_E_R2_GIT'), true, moved.combined);
  equal(await absent(movedOutput), true);
  const movedCommit = (await git(fixtureRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  equal(movedCommit === gitCommit, false);
  await git(fixtureRoot, ['update-ref', branchRef, gitCommit, movedCommit]);
  equal((await git(fixtureRoot, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout, '');

  const fullAuditExisting = path.join(evidenceDirectory, 'full-audit-existing.json');
  await writeFile(fullAuditExisting, 'do-not-overwrite\n', { mode: 0o600 });
  const fullAudit = await runCommand({
    name: 'full-audit-preflight',
    script: 'scripts/audit-public-media-r2-full.mjs',
    role: 'validator',
    output: fullAuditExisting,
    state: baseState(),
    args: [
      '--environment=staging', '--concurrency=8',
      `--expected-manifest-sha256=${manifest.manifestSha256}`,
      '--expected-orphan-count=0', `--expected-git-commit=${gitCommit}`,
      `--expected-git-tree=${gitTree}`,
      `--bucket-exposure-capture=${path.join(evidenceDirectory, 'not-read-capture.json')}`,
      `--receipt-output=${fullAuditExisting}`,
    ],
  });
  equal(fullAudit.code === 0, false);
  equal(fullAudit.combined.includes('CLOUDFLARE_E_SIGNING_FILE_EXISTS'), true,
    fullAudit.combined);
  equal(fullAudit.methods, []);
  equal(await readFile(fullAuditExisting, 'utf8'), 'do-not-overwrite\n');
} finally {
  await Promise.all(temporaryDirectories.reverse().map((directory) => rm(
    directory, { recursive: true, force: true },
  )));
}

console.log(JSON.stringify({
  suite: 'r2-bulk-hardening',
  assertions,
  liveNetworkCalls: 0,
  realKeychainCalls: 0,
  overwriteCalls: 0,
  deleteCalls: 0,
  status: 'PASS',
}, null, 2));
