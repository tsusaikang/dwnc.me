import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import {
  canonicalR2ExposureCapturePayload,
  r2ExposureRequestAudit,
  r2ExposureRequestSha256,
  STAGING_R2_EXPOSURE_BUCKET,
  STAGING_R2_EXPOSURE_JURISDICTION,
  STAGING_R2_EXPOSURE_LOCATION,
  STAGING_R2_EXPOSURE_PURPOSE,
  STAGING_R2_EXPOSURE_STORAGE_CLASS,
  validateR2ExposureCapture,
} from './lib/cloudflare-r2-exposure.mjs';
import { writeAnonymousInheritedInput } from './lib/cloudflare-process.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import {
  PUBLIC_MEDIA_BASELINE_BYTES,
  PUBLIC_MEDIA_BASELINE_FULL_OBJECT_SET_SHA256,
  PUBLIC_MEDIA_BASELINE_OBJECTS,
  PUBLIC_MEDIA_BASELINE_SHA256,
  canonicalRemoteReceiptPayload,
  cloudflareAccountIdSha256,
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  publicMediaFullGetObjectSetSha256,
  publicMediaManifestDigest,
  validatePublicMediaManifest,
  validateRemoteReceipt,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
const execFileAsync = promisify(execFile);
const GIT_OID = /^[a-f0-9]{40}$/u;
const EXPECTED_REQUEST_COUNTS = Object.freeze({
  LIST: 3, HEAD: 2_758, GET: 2_758, PUT: 0, DELETE: 0,
});
const credentials = Object.freeze({
  schemaVersion: 1,
  contract: 'dwnc-r2-s3-credentials-v1',
  accountId: 'a'.repeat(32),
  bucket: STAGING_R2_EXPOSURE_BUCKET,
  accessKeyId: 'b'.repeat(32),
  secretAccessKey: 'c'.repeat(64),
});
const FIXED_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const GIT_ENVIRONMENT_KEYS = Object.freeze([
  'GIT_ATTR_NOSYSTEM', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE', 'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_KEY_1',
  'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_VALUE_0',
  'GIT_CONFIG_VALUE_1', 'GIT_OPTIONAL_LOCKS', 'GIT_TEMPLATE_DIR',
  'GIT_TERMINAL_PROMPT', 'HOME', 'LANG', 'LC_ALL', 'PATH', 'TZ',
  'XDG_CONFIG_HOME', '__CF_USER_TEXT_ENCODING',
]);
const BOUNDARY_ONLY = process.argv.length === 3 && process.argv[2] === '--boundary-only';
if (!BOUNDARY_ONLY && process.argv.length !== 2) throw new Error('R2_OFFLINE_E_ARGUMENT');
const BLOCKED_COUNTER_KEYS = Object.freeze([
  'blockedNetworkAttempts',
  'blockedHttpAttempts',
  'blockedSocketAttempts',
  'blockedDnsAttempts',
  'blockedWebSocketAttempts',
  'blockedEventSourceAttempts',
  'blockedInspectorAttempts',
  'blockedWorkerAttempts',
  'blockedClusterAttempts',
  'blockedChildNetworkToolAttempts',
  'blockedForbiddenChildAttempts',
  'blockedKeychainAttempts',
  'blockedClipboardAttempts',
]);
let assertions = 0;

function equal(actual, expected, message = undefined) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function matches(action, matcher, message = undefined) {
  assert.throws(action, matcher, message);
  assertions += 1;
}

function zeroBlockedCounters() {
  return Object.fromEntries(BLOCKED_COUNTER_KEYS.map((key) => [key, 0]));
}

function expectedBlockedProbe(probe) {
  const counters = zeroBlockedCounters();
  let kind;
  let trace;
  if (['fetch', 'http', 'http2', 'https'].includes(probe)) {
    counters.blockedNetworkAttempts = 1;
    counters.blockedHttpAttempts = 1;
    const method = probe === 'fetch' ? 'fetch' : `${probe}.${probe === 'http2' ? 'connect' : 'request'}`;
    kind = `network.${method}`;
    trace = `network:${method}`;
  } else if (['net', 'tls', 'dgram'].includes(probe)) {
    counters.blockedNetworkAttempts = 1;
    counters.blockedSocketAttempts = 1;
    const method = probe === 'dgram' ? 'dgram.createSocket' : `${probe}.connect`;
    kind = `network.${method}`;
    trace = `network:${method}`;
  } else if (['dns', 'dnsPromises'].includes(probe)) {
    counters.blockedNetworkAttempts = 1;
    counters.blockedDnsAttempts = 1;
    kind = 'network.dns.lookup';
    trace = 'network:dns.lookup';
  } else if (probe === 'websocket') {
    counters.blockedNetworkAttempts = 1;
    counters.blockedWebSocketAttempts = 1;
    kind = 'network.WebSocket';
    trace = 'network:WebSocket';
  } else if (probe === 'eventsource') {
    counters.blockedNetworkAttempts = 1;
    counters.blockedEventSourceAttempts = 1;
    kind = 'network.EventSource';
    trace = 'network:EventSource';
  } else if (['inspectorOpen', 'inspectorSession'].includes(probe)) {
    counters.blockedNetworkAttempts = 1;
    counters.blockedInspectorAttempts = 1;
    const method = probe === 'inspectorOpen' ? 'inspector.open' : 'inspector.Session.connect';
    kind = `network.${method}`;
    trace = `network:${method}`;
  } else if (probe === 'worker' || probe === 'cluster') {
    counters[probe === 'worker' ? 'blockedWorkerAttempts' : 'blockedClusterAttempts'] = 1;
    kind = `execution.${probe}`;
    trace = `execution:${probe}`;
  } else {
    counters.blockedForbiddenChildAttempts = 1;
    let childKind = 'forbidden';
    if (probe === 'security') {
      counters.blockedKeychainAttempts = 1;
      childKind = 'keychain';
    } else if (probe === 'pbpaste' || probe === 'pbcopy') {
      counters.blockedClipboardAttempts = 1;
      childKind = 'clipboard';
    } else if (probe === 'curl' || probe === 'wget') {
      counters.blockedNetworkAttempts = 1;
      counters.blockedChildNetworkToolAttempts = 1;
      childKind = 'network-tool';
    } else if (probe === 'shell') childKind = 'shell';
    else if (probe === 'python') childKind = 'python';
    else if (probe === 'git') childKind = 'git';
    kind = `child.${childKind}`;
    trace = `child:${childKind}`;
  }
  return { counters, kind, trace };
}

function expectedAllowedBoundary({
  childCalls, gitCalls, pythonCalls, gitCommands, pythonOperations, orderedTrace,
}) {
  return {
    guardInstalled: true,
    ...zeroBlockedCounters(),
    blockedAttemptKinds: {},
    orderedBlockedTrace: [],
    childProcessAttempts: childCalls,
    allowedOriginalChildCalls: childCalls,
    allowedGitCalls: gitCalls,
    allowedPythonCalls: pythonCalls,
    childArgumentChecks: childCalls,
    childEnvironmentChecks: childCalls,
    gitCommands,
    pythonOperations,
    orderedAllowedChildTrace: orderedTrace,
  };
}

function createGitEnvironment({ home, xdgConfigHome, templateDirectory, hooksDirectory }) {
  const environment = Object.create(null);
  Object.assign(environment, {
    PATH: FIXED_PATH,
    HOME: home,
    XDG_CONFIG_HOME: xdgConfigHome,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TEMPLATE_DIR: templateDirectory,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: hooksDirectory,
    GIT_CONFIG_KEY_1: 'core.fsmonitor',
    GIT_CONFIG_VALUE_1: 'false',
    GIT_AUTHOR_DATE: '2026-08-28T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-08-28T00:00:00Z',
    __CF_USER_TEXT_ENCODING: `0x${process.getuid().toString(16).toUpperCase()}:0x0:0x0`,
  });
  return Object.freeze(environment);
}

function createEntrypointEnvironment({
  gitEnvironment,
  gitControlRoot,
  evidenceDirectory,
  manifestPath,
  summaryPath,
  receiptPath,
  capturePath,
  probe = null,
}) {
  const environment = Object.create(null);
  Object.assign(environment, gitEnvironment, {
    TMPDIR: evidenceDirectory,
    R2_CREDENTIALS_FD: '3',
    R2_RUNNER_ENVIRONMENT: 'staging',
    R2_RUNNER_ROLE: 'validator',
    R2_OFFLINE_MANIFEST_PATH: manifestPath,
    R2_OFFLINE_MEDIA_ROOT: path.join(ROOT, 'public'),
    R2_OFFLINE_SUMMARY_PATH: summaryPath,
    R2_OFFLINE_RECEIPT_PATH: receiptPath,
    R2_OFFLINE_CAPTURE_PATH: capturePath,
    R2_OFFLINE_GIT_CONTROL_ROOT: gitControlRoot,
    ...(probe === null ? {} : { R2_OFFLINE_PROBE: probe }),
  });
  return Object.freeze(environment);
}

async function git(root, environment, args) {
  return execFileAsync('/usr/bin/git', args, {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function scriptTreeSha256(directory) {
  const hash = createHash('sha256');
  let files = 0;
  async function visit(current, prefix = '') {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target, relative);
      else if (entry.isFile()) {
        const bytes = await readFile(target);
        hash.update(relative);
        hash.update('\0');
        hash.update(String(bytes.length));
        hash.update('\0');
        hash.update(bytes);
        files += 1;
      } else throw new Error('R2_OFFLINE_E_SOURCE_LAYOUT');
    }
  }
  await visit(directory);
  return { files, sha256: hash.digest('hex') };
}

async function productionSourceSnapshot(root) {
  const scripts = await scriptTreeSha256(path.join(root, 'scripts'));
  const sourceLibrary = await scriptTreeSha256(path.join(root, 'src/lib'));
  return {
    files: scripts.files + sourceLibrary.files,
    sha256: sha256Hex(canonicalJson({
      scriptsSha256: scripts.sha256,
      sourceLibrarySha256: sourceLibrary.sha256,
    })),
  };
}

const temporaryPaths = [];
async function secureTemporaryDirectory(prefix) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  if (!path.basename(directory).startsWith(prefix)) throw new Error('R2_OFFLINE_E_TEMP');
  await chmod(directory, 0o700);
  temporaryPaths.push(directory);
  return directory;
}

async function removeTemporaryDirectory(directory) {
  const temporaryRoot = await realpath(os.tmpdir());
  if (!temporaryPaths.includes(directory)
    || !directory.startsWith(`${temporaryRoot}${path.sep}`)
    || !path.basename(directory).startsWith('dwnc-r2-full-audit-')) {
    throw new Error('R2_OFFLINE_E_TEMP');
  }
  await rm(directory, { recursive: true, force: false, maxRetries: 2 });
}

async function createPoisonedGitSources(directory) {
  const home = path.join(directory, 'home');
  const xdgConfigHome = path.join(directory, 'xdg');
  const hooks = path.join(directory, 'hooks');
  const template = path.join(directory, 'template');
  const templateHooks = path.join(template, 'hooks');
  await Promise.all([
    mkdir(home, { recursive: true, mode: 0o700 }),
    mkdir(path.join(xdgConfigHome, 'git'), { recursive: true, mode: 0o700 }),
    mkdir(hooks, { recursive: true, mode: 0o700 }),
    mkdir(templateHooks, { recursive: true, mode: 0o700 }),
  ]);
  const hookMarker = path.join(directory, 'hook-executed');
  const fsmonitorMarker = path.join(directory, 'fsmonitor-executed');
  const hook = path.join(hooks, 'post-commit');
  const templateHook = path.join(templateHooks, 'post-commit');
  const fsmonitor = path.join(directory, 'fsmonitor');
  const executable = (marker) => `#!/bin/sh\n/usr/bin/touch ${JSON.stringify(marker)}\n`;
  await Promise.all([
    writeFile(hook, executable(hookMarker), { flag: 'wx', mode: 0o700 }),
    writeFile(templateHook, executable(hookMarker), { flag: 'wx', mode: 0o700 }),
    writeFile(fsmonitor, executable(fsmonitorMarker), { flag: 'wx', mode: 0o700 }),
  ]);
  const config = [
    '[core]',
    `\thooksPath = ${JSON.stringify(hooks)}`,
    `\tfsmonitor = ${JSON.stringify(fsmonitor)}`,
    '[init]',
    `\ttemplateDir = ${JSON.stringify(template)}`,
    '',
  ].join('\n');
  const globalConfig = path.join(directory, 'global.gitconfig');
  const systemConfig = path.join(directory, 'system.gitconfig');
  await Promise.all([
    writeFile(path.join(home, '.gitconfig'), config, { flag: 'wx', mode: 0o600 }),
    writeFile(path.join(xdgConfigHome, 'git/config'), config, { flag: 'wx', mode: 0o600 }),
    writeFile(globalConfig, config, { flag: 'wx', mode: 0o600 }),
    writeFile(systemConfig, config, { flag: 'wx', mode: 0o600 }),
  ]);
  return {
    home,
    xdgConfigHome,
    globalConfig,
    systemConfig,
    template,
    hookMarker,
    fsmonitorMarker,
  };
}

async function runEntrypoint({
  fixtureRoot,
  environment,
  receiptPath,
  capturePath,
  gitCommit,
  gitTree,
}) {
  const child = spawn(process.execPath, [
    `--import=${pathToFileURL(path.join(
      fixtureRoot, 'scripts/fixtures/r2-full-audit-offline-preload.mjs',
    )).href}`,
    path.join(fixtureRoot, 'scripts/audit-public-media-r2-full.mjs'),
    '--environment=staging',
    '--concurrency=8',
    `--expected-manifest-sha256=${PUBLIC_MEDIA_BASELINE_SHA256}`,
    '--expected-orphan-count=0',
    `--expected-git-commit=${gitCommit}`,
    `--expected-git-tree=${gitTree}`,
    `--bucket-exposure-capture=${capturePath}`,
    `--receipt-output=${receiptPath}`,
  ], {
    cwd: fixtureRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });

  const outputs = { stdout: [], stderr: [] };
  let outputBytes = 0;
  let timedOut = false;
  const collect = (kind, value) => {
    const chunk = Buffer.from(value);
    outputBytes += chunk.length;
    if (outputBytes > 1024 * 1024) child.kill('SIGTERM');
    else outputs[kind].push(chunk);
  };
  child.stdout.on('data', (value) => collect('stdout', value));
  child.stderr.on('data', (value) => collect('stderr', value));
  const close = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1000).unref();
  }, 9 * 60 * 1000);
  const credentialBytes = Buffer.from(canonicalJson(credentials));
  const [writeResult, closeResult] = await Promise.allSettled([
    writeAnonymousInheritedInput(child.stdio[3], credentialBytes, {
      descriptor: 3, maximumBytes: 4096,
    }),
    close,
  ]);
  credentialBytes.fill(0);
  clearTimeout(timeout);
  if (closeResult.status === 'rejected') throw closeResult.reason;
  const stdout = Buffer.concat(outputs.stdout).toString('utf8');
  const stderr = Buffer.concat(outputs.stderr).toString('utf8');
  for (const chunks of Object.values(outputs)) for (const chunk of chunks) chunk.fill(0);
  if (timedOut || outputBytes > 1024 * 1024) throw new Error('R2_OFFLINE_E_CHILD_BOUND');
  if (writeResult.status === 'rejected' && closeResult.value.code === 0) throw writeResult.reason;
  const combined = `${stdout}\n${stderr}`;
  equal(combined.includes(credentials.accountId), false, 'raw account id is absent from output');
  equal(combined.includes(credentials.accessKeyId), false, 'access key is absent from output');
  equal(combined.includes(credentials.secretAccessKey), false, 'secret key is absent from output');
  return { ...closeResult.value, stdout, stderr, credentialWrite: writeResult.status };
}

async function runBoundaryProbe({ fixtureRoot, environment }) {
  const child = spawn(process.execPath, [
    `--import=${pathToFileURL(path.join(
      fixtureRoot, 'scripts/fixtures/r2-full-audit-offline-preload.mjs',
    )).href}`,
    path.join(fixtureRoot, 'scripts/fixtures/r2-full-audit-offline-probe.mjs'),
  ], {
    cwd: fixtureRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  const collect = (target, chunk) => {
    bytes += chunk.length;
    if (bytes > 64 * 1024) child.kill('SIGKILL');
    else target.push(Buffer.from(chunk));
  };
  child.stdout.on('data', (chunk) => collect(stdout, chunk));
  child.stderr.on('data', (chunk) => collect(stderr, chunk));
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const stdoutText = Buffer.concat(stdout).toString('utf8');
  const stderrText = Buffer.concat(stderr).toString('utf8');
  for (const chunk of [...stdout, ...stderr]) chunk.fill(0);
  if (bytes > 64 * 1024) throw new Error('R2_OFFLINE_E_PROBE_OUTPUT');
  return { ...result, stdout: stdoutText, stderr: stderrText };
}

function createPrivateExposureCapture({ accountIdSha256, sourceCommit, sourceTree }) {
  const bucketRawBody = JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result: {
      name: STAGING_R2_EXPOSURE_BUCKET,
      creation_date: '2026-08-27T00:00:00.000Z',
      jurisdiction: STAGING_R2_EXPOSURE_JURISDICTION,
      location: STAGING_R2_EXPOSURE_LOCATION,
      storage_class: STAGING_R2_EXPOSURE_STORAGE_CLASS,
    },
  });
  const managedRawBody = JSON.stringify({
    success: true, errors: [], messages: [], result: { enabled: false },
  });
  const customRawBody = JSON.stringify({
    success: true, errors: [], messages: [], result: { domains: [] },
  });
  const observed = new Date(Date.now() - 1000);
  const evidence = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-r2-private-exposure-v1',
    purpose: STAGING_R2_EXPOSURE_PURPOSE,
    environment: 'staging',
    bucket: STAGING_R2_EXPOSURE_BUCKET,
    accountIdSha256,
    sourceCommit,
    sourceTree,
    gitCheckCount: 3,
    requestAudit: r2ExposureRequestAudit(),
    jurisdiction: STAGING_R2_EXPOSURE_JURISDICTION,
    location: STAGING_R2_EXPOSURE_LOCATION,
    storageClass: STAGING_R2_EXPOSURE_STORAGE_CLASS,
    bucketCreatedAt: '2026-08-27T00:00:00.000Z',
    bucketPropertiesSha256: sha256Hex(bucketRawBody),
    r2DevEnabled: false,
    customDomainCount: 0,
    managedDomainSha256: sha256Hex(managedRawBody),
    customDomainsSha256: sha256Hex(customRawBody),
    observedAt: observed.toISOString(),
    expiresAt: new Date(observed.getTime() + 6_000).toISOString(),
  };
  const capture = {
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-r2-private-exposure-capture-v1',
    requestSha256: r2ExposureRequestSha256(evidence),
    bucketRawBody,
    bucketRawBodySha256: evidence.bucketPropertiesSha256,
    managedRawBody,
    managedRawBodySha256: evidence.managedDomainSha256,
    customRawBody,
    customRawBodySha256: evidence.customDomainsSha256,
    evidence,
  };
  validateR2ExposureCapture(capture, {
    expected: {
      purpose: STAGING_R2_EXPOSURE_PURPOSE,
      environment: 'staging',
      bucket: STAGING_R2_EXPOSURE_BUCKET,
      accountIdSha256,
      jurisdiction: STAGING_R2_EXPOSURE_JURISDICTION,
      sourceCommit,
      sourceTree,
    },
    now: observed,
    requirePrivate: true,
    maxLifetimeSeconds: 900,
    maxFutureSkewSeconds: 120,
  });
  return capture;
}

const POISONED_PARENT_KEYS = Object.freeze([
  'HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
  'GIT_TEMPLATE_DIR', 'GIT_CONFIG_NOSYSTEM', 'GIT_ATTR_NOSYSTEM',
]);
const originalParentEnvironment = new Map(POISONED_PARENT_KEYS.map((key) => [
  key, Object.hasOwn(process.env, key) ? process.env[key] : null,
]));
let finalEvidence = null;
try {
  const fixtureRoot = await secureTemporaryDirectory('dwnc-r2-full-audit-root-');
  const evidenceDirectory = await secureTemporaryDirectory('dwnc-r2-full-audit-evidence-');
  const gitControlRoot = await secureTemporaryDirectory('dwnc-r2-full-audit-git-');
  const poisonRoot = await secureTemporaryDirectory('dwnc-r2-full-audit-poison-');
  const gitHome = path.join(gitControlRoot, 'home');
  const gitXdg = path.join(gitControlRoot, 'xdg');
  const gitTemplate = path.join(gitControlRoot, 'empty-template');
  const gitHooks = path.join(gitControlRoot, 'empty-hooks');
  await Promise.all([
    mkdir(gitHome, { mode: 0o700 }),
    mkdir(gitXdg, { mode: 0o700 }),
    mkdir(gitTemplate, { mode: 0o700 }),
    mkdir(gitHooks, { mode: 0o700 }),
  ]);
  const isolatedGitPaths = await Promise.all([
    realpath(gitHome), realpath(gitXdg), realpath(gitTemplate), realpath(gitHooks),
    realpath(evidenceDirectory),
  ]);
  equal(new Set(isolatedGitPaths).size, 5);
  equal(isolatedGitPaths.slice(0, 4).every(
    (value) => value.startsWith(`${gitControlRoot}${path.sep}`),
  ), true);
  equal(isolatedGitPaths[4], evidenceDirectory);
  equal(await readdir(gitTemplate), []);
  equal(await readdir(gitHooks), []);
  for (const directory of isolatedGitPaths) {
    equal((await lstat(directory)).mode & 0o777, 0o700);
  }
  const poisonedGit = await createPoisonedGitSources(poisonRoot);
  Object.assign(process.env, {
    HOME: poisonedGit.home,
    XDG_CONFIG_HOME: poisonedGit.xdgConfigHome,
    GIT_CONFIG_GLOBAL: poisonedGit.globalConfig,
    GIT_CONFIG_SYSTEM: poisonedGit.systemConfig,
    GIT_TEMPLATE_DIR: poisonedGit.template,
    GIT_CONFIG_NOSYSTEM: '0',
    GIT_ATTR_NOSYSTEM: '0',
  });
  const gitEnvironment = createGitEnvironment({
    home: gitHome,
    xdgConfigHome: gitXdg,
    templateDirectory: gitTemplate,
    hooksDirectory: gitHooks,
  });
  equal(Object.getPrototypeOf(gitEnvironment), null);
  equal(Object.isFrozen(gitEnvironment), true);
  equal(Object.keys(gitEnvironment).sort(), [...GIT_ENVIRONMENT_KEYS].sort());
  matches(() => { gitEnvironment.HOME = poisonedGit.home; }, TypeError);

  const repositoryHead = (await git(ROOT, gitEnvironment, ['rev-parse', 'HEAD'])).stdout.trim();
  const repositoryTree = (await git(ROOT, gitEnvironment, ['rev-parse', 'HEAD^{tree}']))
    .stdout.trim();
  if (!GIT_OID.test(repositoryHead) || !GIT_OID.test(repositoryTree)) {
    throw new Error('The repository HEAD or tree is not a canonical Git object ID.');
  }

  const manifest = await loadTrackedPublicMediaManifest(ROOT);
  equal(manifest.objectCount, PUBLIC_MEDIA_BASELINE_OBJECTS);
  equal(manifest.totalBytes, PUBLIC_MEDIA_BASELINE_BYTES);
  equal(manifest.manifestSha256, PUBLIC_MEDIA_BASELINE_SHA256);
  equal(publicMediaFullGetObjectSetSha256(manifest.entries),
    PUBLIC_MEDIA_BASELINE_FULL_OBJECT_SET_SHA256);

  const altered = structuredClone(manifest);
  altered.entries[0].sha256 = altered.entries[0].sha256 === 'f'.repeat(64)
    ? 'e'.repeat(64) : 'f'.repeat(64);
  altered.manifestSha256 = publicMediaManifestDigest(altered);
  matches(() => validatePublicMediaManifest(altered, {
    enforceBaseline: true,
    expectedManifestSha256: altered.manifestSha256,
  }), (error) => error?.code === 'MEDIA_E_MANIFEST_BASELINE');

  await cp(path.join(ROOT, 'scripts'), path.join(fixtureRoot, 'scripts'), {
    recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
  });
  await cp(path.join(ROOT, 'package.json'), path.join(fixtureRoot, 'package.json'), {
    force: false, errorOnExist: true,
  });
  await cp(path.join(ROOT, 'package-lock.json'), path.join(fixtureRoot, 'package-lock.json'), {
    force: false, errorOnExist: true,
  });
  equal(await lstat(path.join(fixtureRoot, 'node_modules')).then(
    () => 'present', (error) => error?.code,
  ), 'ENOENT');
  await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await cp(path.join(ROOT, 'src/lib'), path.join(fixtureRoot, 'src/lib'), {
    recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
  });
  await mkdir(path.join(fixtureRoot, 'src/data'), { recursive: true });
  const manifestPath = path.join(fixtureRoot, 'src/data/public-media-r2-v1.json');
  await cp(path.join(ROOT, 'src/data/public-media-r2-v1.json'), manifestPath, {
    force: false, errorOnExist: true,
  });
  const releasePolicy = structuredClone(await loadTrackedPublicMediaReleasePolicy(ROOT));
  const accountIdSha256 = cloudflareAccountIdSha256(credentials.accountId);
  releasePolicy.staging.accountIdSha256 = accountIdSha256;
  await writeFile(
    path.join(fixtureRoot, 'src/data/public-media-release-policy-v1.json'),
    `${JSON.stringify(releasePolicy, null, 2)}\n`, { flag: 'wx', mode: 0o600 },
  );
  await writeFile(path.join(fixtureRoot, 'wrangler.jsonc'), `${JSON.stringify({
    env: {
      staging: {
        r2_buckets: [{ binding: 'MEDIA_BUCKET', bucket_name: credentials.bucket }],
      },
    },
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

  const sourceSnapshot = await productionSourceSnapshot(ROOT);
  const fixtureSourceSnapshot = await productionSourceSnapshot(fixtureRoot);
  equal(fixtureSourceSnapshot, sourceSnapshot);
  const auditEntrypointSource = await readFile(
    path.join(fixtureRoot, 'scripts/audit-public-media-r2-full.mjs'), 'utf8',
  );
  const exposureBindingIndex = auditEntrypointSource.indexOf(
    'const bucketExposure = remoteReceiptBucketExposure(exposureCapture,',
  );
  const firstRemoteInspectionIndex = auditEntrypointSource.indexOf(
    'const inspection = await inspectRemotePublicMedia(',
  );
  equal(exposureBindingIndex >= 0, true);
  equal(exposureBindingIndex < firstRemoteInspectionIndex, true);
  equal((auditEntrypointSource.match(/remoteReceiptBucketExposure\(/gu) ?? []).length, 1);
  equal(auditEntrypointSource.includes('deadlineMilliseconds'), false);
  equal(auditEntrypointSource.includes('assertBeforeDeadline'), false);
  equal(auditEntrypointSource.includes('now: receiptVerifiedAt'), false);
  await git(fixtureRoot, gitEnvironment, ['init', '-q', `--template=${gitTemplate}`]);
  await git(fixtureRoot, gitEnvironment, ['config', 'user.name', 'dwnc offline fixture']);
  await git(fixtureRoot, gitEnvironment, ['config', 'user.email', 'fixture@invalid.example']);
  await git(fixtureRoot, gitEnvironment, ['config', 'commit.gpgsign', 'false']);
  await git(fixtureRoot, gitEnvironment, ['add', '.']);
  await git(fixtureRoot, gitEnvironment, ['commit', '-qm', 'offline full audit fixture']);
  const fixtureGitCommit = (await git(fixtureRoot, gitEnvironment, ['rev-parse', 'HEAD']))
    .stdout.trim();
  const fixtureGitTree = (await git(fixtureRoot, gitEnvironment, ['rev-parse', 'HEAD^{tree}']))
    .stdout.trim();
  equal((await git(fixtureRoot, gitEnvironment, [
    'status', '--porcelain=v1', '--untracked-files=all',
  ])).stdout, '');
  equal(await lstat(path.join(fixtureRoot, '.git/hooks')).then(
    () => 'present', (error) => error?.code,
  ), 'ENOENT');
  equal(await lstat(poisonedGit.hookMarker).then(
    () => 'present', (error) => error?.code,
  ), 'ENOENT');
  equal(await lstat(poisonedGit.fsmonitorMarker).then(
    () => 'present', (error) => error?.code,
  ), 'ENOENT');

  const capturePath = path.join(evidenceDirectory, 'private-exposure-capture.json');
  const receiptPath = path.join(evidenceDirectory, 'full-audit-receipt.json');
  const probeKinds = [
    'fetch', 'http', 'http2', 'https', 'net', 'tls', 'dns', 'dnsPromises', 'dgram',
    'childProcess', 'childProcessClass', 'security', 'pbpaste', 'pbcopy', 'curl', 'wget',
    'shell', 'python', 'git',
    'worker', 'cluster', 'inspectorOpen', 'inspectorSession',
    ...(typeof globalThis.WebSocket === 'function' ? ['websocket'] : []),
    ...(typeof globalThis.EventSource === 'function' ? ['eventsource'] : []),
  ];
  const blockedProbeTotals = zeroBlockedCounters();
  const orderedBlockedProbeTrace = [];
  for (const probe of probeKinds) {
    const probeSummaryPath = path.join(evidenceDirectory, `probe-${probe}.json`);
    const probeEnvironment = createEntrypointEnvironment({
      gitEnvironment,
      gitControlRoot,
      evidenceDirectory,
      manifestPath,
      summaryPath: probeSummaryPath,
      receiptPath,
      capturePath,
      probe,
    });
    equal(Object.getPrototypeOf(probeEnvironment), null);
    equal(Object.isFrozen(probeEnvironment), true);
    const probeResult = await runBoundaryProbe({ fixtureRoot, environment: probeEnvironment });
    equal({ code: probeResult.code, signal: probeResult.signal, stderr: probeResult.stderr }, {
      code: 0, signal: null, stderr: '',
    });
    equal(JSON.parse(probeResult.stdout), { probe, blocked: true });
    const probeSummary = JSON.parse(await readFile(probeSummaryPath, 'utf8'));
    const isChildProbe = [
      'childProcess', 'childProcessClass', 'security', 'pbpaste', 'pbcopy', 'curl', 'wget',
      'shell', 'python', 'git',
    ].includes(probe);
    const expectedBlocked = expectedBlockedProbe(probe);
    for (const key of BLOCKED_COUNTER_KEYS) {
      blockedProbeTotals[key] += probeSummary.boundary[key];
    }
    orderedBlockedProbeTrace.push(...probeSummary.boundary.orderedBlockedTrace);
    equal({
      localMediaBytesRead: probeSummary.localMediaBytesRead,
      operations: probeSummary.operations,
      blocked: Object.fromEntries(BLOCKED_COUNTER_KEYS.map(
        (key) => [key, probeSummary.boundary[key]],
      )),
      blockedAttemptKinds: probeSummary.boundary.blockedAttemptKinds,
      orderedBlockedTrace: probeSummary.boundary.orderedBlockedTrace,
      childProcessAttempts: probeSummary.boundary.childProcessAttempts,
      allowedOriginalChildCalls: probeSummary.boundary.allowedOriginalChildCalls,
    }, {
      localMediaBytesRead: 0,
      operations: { LIST: 0, HEAD: 0, GET: 0, PUT: 0, DELETE: 0 },
      blocked: expectedBlocked.counters,
      blockedAttemptKinds: { [expectedBlocked.kind]: 1 },
      orderedBlockedTrace: [expectedBlocked.trace],
      childProcessAttempts: isChildProbe ? 1 : 0,
      allowedOriginalChildCalls: 0,
    });
  }

  if (BOUNDARY_ONLY) {
    const positiveSummaryPath = path.join(evidenceDirectory, 'positive-boundary-summary.json');
    const positiveEnvironment = createEntrypointEnvironment({
      gitEnvironment,
      gitControlRoot,
      evidenceDirectory,
      manifestPath,
      summaryPath: positiveSummaryPath,
      receiptPath,
      capturePath,
    });
    const positiveRun = await runEntrypoint({
      fixtureRoot,
      environment: positiveEnvironment,
      receiptPath,
      capturePath,
      gitCommit: fixtureGitCommit,
      gitTree: fixtureGitTree,
    });
    equal(positiveRun.code === 0, false);
    equal(positiveRun.signal, null);
    equal(positiveRun.stderr.includes('CLOUDFLARE_E_SIGNING_FILE'), true);
    const positiveSummary = JSON.parse(await readFile(positiveSummaryPath, 'utf8'));
    equal({
      operations: positiveSummary.operations,
      localMediaBytesRead: positiveSummary.localMediaBytesRead,
      boundary: positiveSummary.boundary,
    }, {
      operations: { LIST: 0, HEAD: 0, GET: 0, PUT: 0, DELETE: 0 },
      localMediaBytesRead: 0,
      boundary: expectedAllowedBoundary({
        childCalls: 7,
        gitCalls: 5,
        pythonCalls: 2,
        gitCommands: { revParseHead: 2, revParseTree: 2, status: 1 },
        pythonOperations: { absent: 1, read: 1, create: 0 },
        orderedTrace: [
          'python:absent:receipt',
          'git:revParseHead', 'git:revParseTree', 'git:status',
          'git:revParseHead', 'git:revParseTree',
          'python:read:capture',
        ],
      }),
    });
    finalEvidence = {
      mode: 'boundary-only',
      repositoryHead,
      repositoryTree,
      blockedBoundaryProbes: probeKinds.length,
      localMediaBytesRead: positiveSummary.localMediaBytesRead,
      preCallBlockedProbeAttempts: probeKinds.length,
      blockedProbeTotals,
      orderedBlockedProbeTrace,
      allowedOriginalChildCalls: positiveSummary.boundary.allowedOriginalChildCalls,
    };
  } else {
  const capture = createPrivateExposureCapture({
    accountIdSha256,
    sourceCommit: fixtureGitCommit,
    sourceTree: fixtureGitTree,
  });
  await writeCanonicalEvidenceCreateOnly(
    capturePath, capture, canonicalR2ExposureCapturePayload,
  );
  const captureStats = await lstat(capturePath);
  equal(captureStats.mode & 0o777, 0o600);
  equal(captureStats.nlink, 1);

  const requestSummaryPath = path.join(evidenceDirectory, 'request-summary.json');
  const entrypointEnvironment = createEntrypointEnvironment({
    gitEnvironment,
    gitControlRoot,
    evidenceDirectory,
    manifestPath,
    summaryPath: requestSummaryPath,
    receiptPath,
    capturePath,
  });
  equal(Object.getPrototypeOf(entrypointEnvironment), null);
  equal(Object.isFrozen(entrypointEnvironment), true);
  equal(Object.keys(entrypointEnvironment).sort(), [
    ...GIT_ENVIRONMENT_KEYS,
    'TMPDIR', 'R2_CREDENTIALS_FD', 'R2_RUNNER_ENVIRONMENT', 'R2_RUNNER_ROLE',
    'R2_OFFLINE_MANIFEST_PATH', 'R2_OFFLINE_MEDIA_ROOT', 'R2_OFFLINE_SUMMARY_PATH',
    'R2_OFFLINE_RECEIPT_PATH', 'R2_OFFLINE_CAPTURE_PATH',
    'R2_OFFLINE_GIT_CONTROL_ROOT',
  ].sort());
  const firstRun = await runEntrypoint({
    fixtureRoot,
    environment: entrypointEnvironment,
    receiptPath,
    capturePath,
    gitCommit: fixtureGitCommit,
    gitTree: fixtureGitTree,
  });
  const firstRunFailureSummary = firstRun.code === 0 ? ''
    : await readFile(requestSummaryPath, 'utf8').catch(() => 'request summary absent');
  equal(firstRun.code, 0,
    `${firstRun.stdout}\n${firstRun.stderr}\n${firstRunFailureSummary}`);
  equal(firstRun.signal, null);
  equal(firstRun.credentialWrite, 'fulfilled');
  equal(firstRun.stderr, '');
  const entrypointSummary = JSON.parse(firstRun.stdout);
  equal({
    validationScope: entrypointSummary.validationScope,
    environment: entrypointSummary.environment,
    manifestSha256: entrypointSummary.manifestSha256,
    objects: entrypointSummary.objects,
    bytes: entrypointSummary.bytes,
    orphan: entrypointSummary.orphan,
    requestCounts: entrypointSummary.requestCounts,
    fullObjectSetSha256: entrypointSummary.fullObjectSetSha256,
    receiptWritten: entrypointSummary.receiptWritten,
    receiptSigned: entrypointSummary.receiptSigned,
    bucketExposureBound: entrypointSummary.bucketExposureBound,
    offlineBoundary: entrypointSummary.offlineBoundary,
  }, {
    validationScope: 'public-media-remote-full-get',
    environment: 'staging',
    manifestSha256: PUBLIC_MEDIA_BASELINE_SHA256,
    objects: PUBLIC_MEDIA_BASELINE_OBJECTS,
    bytes: PUBLIC_MEDIA_BASELINE_BYTES,
    orphan: 0,
    requestCounts: EXPECTED_REQUEST_COUNTS,
    fullObjectSetSha256: PUBLIC_MEDIA_BASELINE_FULL_OBJECT_SET_SHA256,
    receiptWritten: true,
    receiptSigned: false,
    bucketExposureBound: true,
    offlineBoundary: expectedAllowedBoundary({
      childCalls: 20,
      gitCalls: 15,
      pythonCalls: 5,
      gitCommands: { revParseHead: 6, revParseTree: 6, status: 3 },
      pythonOperations: { absent: 1, read: 3, create: 1 },
      orderedTrace: [
        'python:absent:receipt',
        'git:revParseHead', 'git:revParseTree', 'git:status',
        'git:revParseHead', 'git:revParseTree',
        'python:read:capture', 'python:read:capture',
        'git:revParseHead', 'git:revParseTree', 'git:status',
        'git:revParseHead', 'git:revParseTree',
        'git:revParseHead', 'git:revParseTree', 'git:status',
        'git:revParseHead', 'git:revParseTree',
        'python:create:receipt', 'python:read:receipt',
      ],
    }),
  });

  const receiptBytes = await readFile(receiptPath);
  const receiptSha256 = sha256Hex(receiptBytes);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  validateRemoteReceipt(receipt, manifest);
  equal(receiptBytes.toString('utf8'), `${canonicalRemoteReceiptPayload(receipt)}\n`);
  equal(receipt.verificationLevel, 'full-get-sha256');
  equal(receipt.audit.requestCounts, EXPECTED_REQUEST_COUNTS);
  equal(receipt.audit.fullObjectSetSha256, PUBLIC_MEDIA_BASELINE_FULL_OBJECT_SET_SHA256);
  equal(receipt.audit.sourceCommit, fixtureGitCommit);
  equal(receipt.audit.sourceTree, fixtureGitTree);
  equal(receipt.audit.gitCheckCount, 3);
  equal(receipt.audit.fullGetObjects, PUBLIC_MEDIA_BASELINE_OBJECTS);
  equal(receipt.audit.fullGetBytes, PUBLIC_MEDIA_BASELINE_BYTES);
  equal(Date.parse(receipt.verifiedAt) >= Date.parse(capture.evidence.expiresAt), true);
  equal(receipt.target, {
    environment: 'staging', bucket: credentials.bucket, accountIdSha256,
  });
  equal(receipt.bucketExposure.r2DevEnabled, false);
  equal(receipt.bucketExposure.customDomainCount, 0);
  const receiptStats = await lstat(receiptPath);
  equal(receiptStats.mode & 0o777, 0o600);
  equal(receiptStats.nlink, 1);

  const requestSummary = JSON.parse(await readFile(requestSummaryPath, 'utf8'));
  equal(requestSummary, {
    contract: 'dwnc-r2-full-audit-offline-summary-v2',
    manifestSha256: PUBLIC_MEDIA_BASELINE_SHA256,
    objectCount: PUBLIC_MEDIA_BASELINE_OBJECTS,
    totalBytes: PUBLIC_MEDIA_BASELINE_BYTES,
    operations: EXPECTED_REQUEST_COUNTS,
    totalRequests: 5_519,
    uniqueHeadObjects: PUBLIC_MEDIA_BASELINE_OBJECTS,
    uniqueGetObjects: PUBLIC_MEDIA_BASELINE_OBJECTS,
    completedGetObjects: PUBLIC_MEDIA_BASELINE_OBJECTS,
    localMediaBytesRead: PUBLIC_MEDIA_BASELINE_BYTES,
    retryCount: 0,
    phaseViolations: 0,
    unauthorizedRequests: 0,
    invariantFailures: 0,
    failureCodes: [],
    boundary: expectedAllowedBoundary({
      childCalls: 20,
      gitCalls: 15,
      pythonCalls: 5,
      gitCommands: { revParseHead: 6, revParseTree: 6, status: 3 },
      pythonOperations: { absent: 1, read: 3, create: 1 },
      orderedTrace: [
        'python:absent:receipt',
        'git:revParseHead', 'git:revParseTree', 'git:status',
        'git:revParseHead', 'git:revParseTree',
        'python:read:capture', 'python:read:capture',
        'git:revParseHead', 'git:revParseTree', 'git:status',
        'git:revParseHead', 'git:revParseTree',
        'git:revParseHead', 'git:revParseTree', 'git:status',
        'git:revParseHead', 'git:revParseTree',
        'python:create:receipt', 'python:read:receipt',
      ],
    }),
  });

  const secondSummaryPath = path.join(evidenceDirectory, 'create-only-summary.json');
  const secondEnvironment = createEntrypointEnvironment({
    gitEnvironment,
    gitControlRoot,
    evidenceDirectory,
    manifestPath,
    summaryPath: secondSummaryPath,
    receiptPath,
    capturePath,
  });
  const secondRun = await runEntrypoint({
    fixtureRoot,
    environment: secondEnvironment,
    receiptPath,
    capturePath,
    gitCommit: fixtureGitCommit,
    gitTree: fixtureGitTree,
  });
  equal(secondRun.code === 0, false);
  equal(secondRun.signal, null);
  equal(secondRun.stderr.includes('CLOUDFLARE_E_SIGNING_FILE_EXISTS'), true,
    secondRun.stderr);
  const secondSummary = JSON.parse(await readFile(secondSummaryPath, 'utf8'));
  equal(secondSummary.operations, { LIST: 0, HEAD: 0, GET: 0, PUT: 0, DELETE: 0 });
  equal(secondSummary.totalRequests, 0);
  equal(secondSummary.localMediaBytesRead, 0);
  equal({
    retryCount: secondSummary.retryCount,
    phaseViolations: secondSummary.phaseViolations,
    unauthorizedRequests: secondSummary.unauthorizedRequests,
    invariantFailures: secondSummary.invariantFailures,
    failureCodes: secondSummary.failureCodes,
    boundary: secondSummary.boundary,
  }, {
    retryCount: 0,
    phaseViolations: 0,
    unauthorizedRequests: 0,
    invariantFailures: 0,
    failureCodes: [],
    boundary: expectedAllowedBoundary({
      childCalls: 1,
      gitCalls: 0,
      pythonCalls: 1,
      gitCommands: { revParseHead: 0, revParseTree: 0, status: 0 },
      pythonOperations: { absent: 1, read: 0, create: 0 },
      orderedTrace: ['python:absent:receipt'],
    }),
  });
  equal(sha256Hex(await readFile(receiptPath)), receiptSha256);
  equal((await lstat(receiptPath)).ino, receiptStats.ino);

  equal((await git(fixtureRoot, gitEnvironment, ['rev-parse', 'HEAD'])).stdout.trim(),
    fixtureGitCommit);
  equal((await git(fixtureRoot, gitEnvironment, ['rev-parse', 'HEAD^{tree}'])).stdout.trim(),
    fixtureGitTree);
  equal((await git(fixtureRoot, gitEnvironment, [
    'status', '--porcelain=v1', '--untracked-files=all',
  ])).stdout, '');
  equal(await productionSourceSnapshot(ROOT), sourceSnapshot);
  equal(await productionSourceSnapshot(fixtureRoot), fixtureSourceSnapshot);
  equal((await git(ROOT, gitEnvironment, ['rev-parse', 'HEAD'])).stdout.trim(), repositoryHead);
  equal((await git(ROOT, gitEnvironment, ['rev-parse', 'HEAD^{tree}'])).stdout.trim(),
    repositoryTree);
  equal(await lstat(poisonedGit.hookMarker).then(
    () => 'present', (error) => error?.code,
  ), 'ENOENT');
  equal(await lstat(poisonedGit.fsmonitorMarker).then(
    () => 'present', (error) => error?.code,
  ), 'ENOENT');

  finalEvidence = {
    repositoryHead,
    repositoryTree,
    fixtureGitCommit,
    fixtureGitTree,
    productionSourceSha256: sourceSnapshot.sha256,
    productionSourceFiles: sourceSnapshot.files,
    manifestSha256: manifest.manifestSha256,
    fullObjectSetSha256: PUBLIC_MEDIA_BASELINE_FULL_OBJECT_SET_SHA256,
    objects: manifest.objectCount,
    bytes: manifest.totalBytes,
    requestCounts: EXPECTED_REQUEST_COUNTS,
    totalRequests: 5_519,
    retry: requestSummary.retryCount,
    overwrite: requestSummary.operations.PUT,
    delete: requestSummary.operations.DELETE,
    receiptCreateOnly: true,
    localMediaBytesRead: requestSummary.localMediaBytesRead,
    successfulRunBlockedAttempts: Object.fromEntries(BLOCKED_COUNTER_KEYS.map(
      (key) => [key, requestSummary.boundary[key]],
    )),
    allowedOriginalChildCalls: requestSummary.boundary.allowedOriginalChildCalls,
    blockedBoundaryProbes: probeKinds.length,
    blockedProbeTotals,
    orderedBlockedProbeTrace,
  };
  }
} finally {
  for (const [key, value] of originalParentEnvironment) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  for (const directory of temporaryPaths.reverse()) await removeTemporaryDirectory(directory);
}

console.log(JSON.stringify({
  suite: 'r2-full-audit-entrypoint',
  assertions,
  ...finalEvidence,
  temporaryEvidenceRetained: 0,
  status: 'PASS',
}, null, 2));
