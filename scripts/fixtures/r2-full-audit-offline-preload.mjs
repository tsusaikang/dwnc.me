import { createHash } from 'node:crypto';
import {
  createReadStream,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';

const EXPECTED_ACCOUNT_ID = 'a'.repeat(32);
const EXPECTED_ACCESS_KEY_ID = 'b'.repeat(32);
const EXPECTED_BUCKET = 'dwnc-me-public-media-staging';
const EXPECTED_ORIGIN = `https://${EXPECTED_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const LAST_MODIFIED = 'Thu, 27 Aug 2026 00:24:12 GMT';
const OPERATION_KEYS = Object.freeze(['LIST', 'HEAD', 'GET', 'PUT', 'DELETE']);
const BOUNDARY_SYMBOL = Symbol.for('dwnc.r2-full-audit.offline-boundary.v1');
const FIXED_GIT_ARGUMENTS = Object.freeze(new Map([
  ['rev-parse\0HEAD', 'revParseHead'],
  ['rev-parse\0HEAD^{tree}', 'revParseTree'],
  ['status\0--porcelain=v1\0--untracked-files=all', 'status'],
]));
const GIT_ENVIRONMENT_KEYS = Object.freeze([
  'GIT_CONFIG_COUNT',
  'GIT_AUTHOR_DATE',
  'GIT_ATTR_NOSYSTEM',
  'GIT_COMMITTER_DATE',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_KEY_1',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_VALUE_0',
  'GIT_CONFIG_VALUE_1',
  'GIT_OPTIONAL_LOCKS',
  'GIT_TEMPLATE_DIR',
  'GIT_TERMINAL_PROMPT',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'R2_CREDENTIALS_FD',
  'R2_OFFLINE_CAPTURE_PATH',
  'R2_OFFLINE_GIT_CONTROL_ROOT',
  'R2_OFFLINE_MANIFEST_PATH',
  'R2_OFFLINE_MEDIA_ROOT',
  'R2_OFFLINE_RECEIPT_PATH',
  'R2_OFFLINE_SUMMARY_PATH',
  'R2_RUNNER_ENVIRONMENT',
  'R2_RUNNER_ROLE',
  'TMPDIR',
  'TZ',
  'XDG_CONFIG_HOME',
  '__CF_USER_TEXT_ENCODING',
]);

const boundaryCounters = {
  blockedNetworkAttempts: 0,
  blockedHttpAttempts: 0,
  blockedSocketAttempts: 0,
  blockedDnsAttempts: 0,
  blockedWebSocketAttempts: 0,
  blockedEventSourceAttempts: 0,
  blockedInspectorAttempts: 0,
  blockedWorkerAttempts: 0,
  blockedClusterAttempts: 0,
  blockedChildNetworkToolAttempts: 0,
  blockedAttemptKinds: Object.create(null),
  orderedBlockedTrace: [],
  childProcessAttempts: 0,
  allowedOriginalChildCalls: 0,
  blockedForbiddenChildAttempts: 0,
  allowedGitCalls: 0,
  allowedPythonCalls: 0,
  childArgumentChecks: 0,
  childEnvironmentChecks: 0,
  gitCommands: { revParseHead: 0, revParseTree: 0, status: 0 },
  pythonOperations: { absent: 0, read: 0, create: 0 },
  orderedAllowedChildTrace: [],
  blockedKeychainAttempts: 0,
  blockedClipboardAttempts: 0,
  lastDeniedReason: null,
};

function boundaryFail(code = 'R2_OFFLINE_E_BOUNDARY') {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, expected) {
  return value && typeof value === 'object'
    && Object.keys(value).length === expected.length
    && Object.keys(value).every((key) => expected.includes(key));
}

function incrementBlockedKind(kind, trace) {
  boundaryCounters.blockedAttemptKinds[kind]
    = (boundaryCounters.blockedAttemptKinds[kind] ?? 0) + 1;
  boundaryCounters.orderedBlockedTrace.push(trace);
}

function recordNetworkAttempt(kind) {
  boundaryCounters.blockedNetworkAttempts += 1;
  if (kind === 'fetch' || /^(?:http|http2|https)\./u.test(kind)) {
    boundaryCounters.blockedHttpAttempts += 1;
  } else if (/^(?:net|tls|dgram)\./u.test(kind)) {
    boundaryCounters.blockedSocketAttempts += 1;
  } else if (kind.startsWith('dns.')) {
    boundaryCounters.blockedDnsAttempts += 1;
  } else if (kind === 'WebSocket' || kind === 'http.WebSocket') {
    boundaryCounters.blockedWebSocketAttempts += 1;
  } else if (kind === 'EventSource') {
    boundaryCounters.blockedEventSourceAttempts += 1;
  } else if (kind.startsWith('inspector.')) {
    boundaryCounters.blockedInspectorAttempts += 1;
  } else {
    boundaryFail('R2_OFFLINE_E_BOUNDARY_KIND');
  }
  incrementBlockedKind(`network.${kind}`, `network:${kind}`);
  boundaryFail();
}

function recordExecutionContextAttempt(kind) {
  if (kind === 'worker') boundaryCounters.blockedWorkerAttempts += 1;
  else if (kind === 'cluster') boundaryCounters.blockedClusterAttempts += 1;
  else boundaryFail('R2_OFFLINE_E_BOUNDARY_KIND');
  incrementBlockedKind(`execution.${kind}`, `execution:${kind}`);
  boundaryFail();
}

function validateGitProcessEnvironment() {
  let controlRoot;
  let home;
  let xdg;
  let template;
  let hooks;
  let temporary;
  try {
    controlRoot = realpathSync(process.env.R2_OFFLINE_GIT_CONTROL_ROOT ?? '');
    home = realpathSync(process.env.HOME ?? '');
    xdg = realpathSync(process.env.XDG_CONFIG_HOME ?? '');
    template = realpathSync(process.env.GIT_TEMPLATE_DIR ?? '');
    hooks = realpathSync(process.env.GIT_CONFIG_VALUE_0 ?? '');
    temporary = realpathSync(process.env.TMPDIR ?? '');
  } catch { boundaryFail('R2_OFFLINE_E_CHILD_ENVIRONMENT'); }
  if (!exactKeys(process.env, GIT_ENVIRONMENT_KEYS)
    || process.env.PATH !== '/usr/bin:/bin:/usr/sbin:/sbin'
    || process.env.LANG !== 'C' || process.env.LC_ALL !== 'C' || process.env.TZ !== 'UTC'
    || process.env.GIT_CONFIG_NOSYSTEM !== '1'
    || process.env.GIT_ATTR_NOSYSTEM !== '1'
    || process.env.GIT_CONFIG_GLOBAL !== '/dev/null'
    || process.env.GIT_CONFIG_SYSTEM !== '/dev/null'
    || process.env.GIT_TERMINAL_PROMPT !== '0'
    || process.env.GIT_OPTIONAL_LOCKS !== '0'
    || process.env.GIT_CONFIG_COUNT !== '2'
    || process.env.GIT_CONFIG_KEY_0 !== 'core.hooksPath'
    || process.env.GIT_CONFIG_VALUE_0 !== hooks
    || process.env.GIT_CONFIG_KEY_1 !== 'core.fsmonitor'
    || process.env.GIT_CONFIG_VALUE_1 !== 'false'
    || process.env.GIT_AUTHOR_DATE !== '2026-08-28T00:00:00Z'
    || process.env.GIT_COMMITTER_DATE !== '2026-08-28T00:00:00Z'
    || process.env.__CF_USER_TEXT_ENCODING
      !== `0x${process.getuid().toString(16).toUpperCase()}:0x0:0x0`
    || !['HOME', 'XDG_CONFIG_HOME', 'GIT_TEMPLATE_DIR', 'TMPDIR',
      'R2_OFFLINE_GIT_CONTROL_ROOT']
      .every((key) => typeof process.env[key] === 'string' && path.isAbsolute(process.env[key]))
    || !path.basename(controlRoot).startsWith('dwnc-r2-full-audit-git-')
    || !path.basename(temporary).startsWith('dwnc-r2-full-audit-evidence-')
    || ![home, xdg, template, hooks].every(
      (value) => value.startsWith(`${controlRoot}${path.sep}`),
    )
    || new Set([home, xdg, template, hooks, temporary]).size !== 5
    || readdirSync(template).length !== 0 || readdirSync(hooks).length !== 0
    || [controlRoot, home, xdg, template, hooks, temporary].some((value) => {
      const stats = lstatSync(value);
      return !stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
        || typeof process.getuid === 'function' && stats.uid !== process.getuid();
    })) {
    boundaryFail('R2_OFFLINE_E_CHILD_ENVIRONMENT');
  }
  boundaryCounters.childEnvironmentChecks += 1;
}

function validateGitCall(file, args, options) {
  const command = Array.isArray(args) ? FIXED_GIT_ARGUMENTS.get(args.join('\0')) : null;
  const expectedMaximum = command === 'status' ? 1024 * 1024 : 1024;
  if (file !== 'git' || command === null
    || !exactKeys(options, ['cwd', 'encoding', 'maxBuffer'])
    || options.cwd !== process.cwd() || options.encoding !== 'utf8'
    || options.maxBuffer !== expectedMaximum) return false;
  validateGitProcessEnvironment();
  boundaryCounters.allowedGitCalls += 1;
  boundaryCounters.gitCommands[command] += 1;
  boundaryCounters.orderedAllowedChildTrace.push(`git:${command}`);
  boundaryCounters.childArgumentChecks += 1;
  return true;
}

function validatePythonCall(file, args, options) {
  const helper = path.join(process.cwd(), 'scripts/libexec/secure_openat.py');
  const operation = args?.[4];
  const leaf = args?.[5];
  const maximumBytes = Number(args?.[6]);
  const receiptLeaf = path.basename(process.env.R2_OFFLINE_RECEIPT_PATH ?? '');
  const captureLeaf = path.basename(process.env.R2_OFFLINE_CAPTURE_PATH ?? '');
  const expectedLeaf = operation === 'read' && leaf === captureLeaf
    ? captureLeaf : receiptLeaf;
  const validOperation = operation === 'absent' || operation === 'read' || operation === 'create';
  const validStandardInput = operation === 'create' ? 'pipe' : 'ignore';
  const expectedEnvironment = {
    PATH: '/usr/bin:/bin',
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: 'C',
    PYTHONDONTWRITEBYTECODE: '1',
    __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING,
  };
  const checks = [
    ['executable', file === '/usr/bin/python3'],
    ['argument-count', Array.isArray(args) && args.length === 7],
    ['flags', JSON.stringify(args?.slice(0, 3)) === JSON.stringify(['-I', '-S', '-B'])],
    ['helper', args?.[3] === helper],
    ['operation', validOperation],
    ['leaf', leaf === expectedLeaf],
    ['maximum', Number.isSafeInteger(maximumBytes) && maximumBytes >= 1
      && maximumBytes <= 16 * 1024 * 1024
      && (operation !== 'absent' || maximumBytes === 1)
      && (operation !== 'read' || leaf !== captureLeaf || maximumBytes === 3 * 1024 * 1024)],
    ['options', exactKeys(options, ['env', 'stdio'])],
    ['environment-keys', exactKeys(options?.env, Object.keys(expectedEnvironment))],
    ['environment-values', Object.entries(expectedEnvironment)
      .every(([key, value]) => options?.env?.[key] === value)],
    ['stdio', Array.isArray(options?.stdio) && options.stdio.length === 4
      && options.stdio[0] === validStandardInput && options.stdio[1] === 'pipe'
      && options.stdio[2] === 'pipe' && Number.isInteger(options.stdio[3])
      && options.stdio[3] >= 3],
  ];
  const failed = checks.find(([, valid]) => !valid);
  if (failed) {
    boundaryCounters.lastDeniedReason = `python:${failed[0]}`;
    return false;
  }
  boundaryCounters.allowedPythonCalls += 1;
  boundaryCounters.pythonOperations[operation] += 1;
  boundaryCounters.orderedAllowedChildTrace.push(
    `python:${operation}:${leaf === captureLeaf ? 'capture' : 'receipt'}`,
  );
  boundaryCounters.childArgumentChecks += 1;
  boundaryCounters.childEnvironmentChecks += 1;
  return true;
}

function recordForbiddenChild(file) {
  boundaryCounters.blockedForbiddenChildAttempts += 1;
  let kind = 'forbidden';
  if (file === '/usr/bin/security' || file === 'security') {
    boundaryCounters.blockedKeychainAttempts += 1;
    kind = 'keychain';
  }
  if (['/usr/bin/pbpaste', '/usr/bin/pbcopy', 'pbpaste', 'pbcopy'].includes(file)) {
    boundaryCounters.blockedClipboardAttempts += 1;
    kind = 'clipboard';
  }
  if (['/usr/bin/curl', '/usr/bin/wget', 'curl', 'wget'].includes(file)) {
    boundaryCounters.blockedNetworkAttempts += 1;
    boundaryCounters.blockedChildNetworkToolAttempts += 1;
    kind = 'network-tool';
  }
  if (file === '/bin/sh' || file === 'sh') kind = 'shell';
  if (file === '/usr/bin/python3' || file === 'python3') kind = 'python';
  if (file === '/usr/bin/git' || file === 'git') kind = 'git';
  incrementBlockedKind(`child.${kind}`, `child:${kind}`);
  boundaryFail();
}

function probeForbiddenChild(file) {
  if (typeof process.env.R2_OFFLINE_PROBE !== 'string') boundaryFail();
  boundaryCounters.childProcessAttempts += 1;
  return recordForbiddenChild(file);
}

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const http = require('node:http');
const http2 = require('node:http2');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const dnsPromises = require('node:dns/promises');
const dgram = require('node:dgram');
const inspector = require('node:inspector');
const workerThreads = require('node:worker_threads');
const cluster = require('node:cluster');
const originalSpawn = childProcess.spawn;
const originalExecFile = childProcess.execFile;
const originalChildProcessSpawn = childProcess.ChildProcess.prototype.spawn;
let allowedNativeSpawnDepth = 0;

childProcess.spawn = function guardedSpawn(file, args, options) {
  boundaryCounters.childProcessAttempts += 1;
  if (!validatePythonCall(file, args, options)) return recordForbiddenChild(file);
  boundaryCounters.allowedOriginalChildCalls += 1;
  allowedNativeSpawnDepth += 1;
  try { return originalSpawn.call(this, file, args, options); }
  finally { allowedNativeSpawnDepth -= 1; }
};
function guardedExecFile(file, args, options, callback) {
  boundaryCounters.childProcessAttempts += 1;
  if (!validateGitCall(file, args, options)) return recordForbiddenChild(file);
  boundaryCounters.allowedOriginalChildCalls += 1;
  allowedNativeSpawnDepth += 1;
  try { return originalExecFile.call(this, file, args, options, callback); }
  finally { allowedNativeSpawnDepth -= 1; }
}
Object.defineProperty(guardedExecFile, Symbol.for('nodejs.util.promisify.custom'), {
  value: (file, args, options) => new Promise((resolve, reject) => {
    guardedExecFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  }),
  configurable: false,
  enumerable: false,
  writable: false,
});
childProcess.execFile = guardedExecFile;
childProcess.ChildProcess.prototype.spawn = function guardedChildProcessSpawn(options) {
  if (allowedNativeSpawnDepth > 0) return originalChildProcessSpawn.call(this, options);
  boundaryCounters.childProcessAttempts += 1;
  return recordForbiddenChild(options?.file);
};
for (const method of ['exec', 'execSync', 'execFileSync', 'fork', 'spawnSync']) {
  childProcess[method] = function forbiddenChildBoundary(...args) {
    boundaryCounters.childProcessAttempts += 1;
    return recordForbiddenChild(args[0]);
  };
}

for (const [prefix, module, methods] of [
  ['http', http, ['request', 'get']],
  ['http2', http2, ['connect', 'createServer', 'createSecureServer']],
  ['https', https, ['request', 'get']],
  ['net', net, ['connect', 'createConnection', 'createServer']],
  ['tls', tls, ['connect', 'createServer']],
  ['dns', dns, [
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
    'setServers',
  ]],
  ['dns', dnsPromises, [
    'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
    'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
    'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse',
    'setServers',
  ]],
  ['dgram', dgram, ['createSocket']],
]) {
  for (const method of methods) module[method] = () => recordNetworkAttempt(`${prefix}.${method}`);
}
cluster.fork = () => recordExecutionContextAttempt('cluster');
workerThreads.Worker = class BlockedOfflineWorker {
  constructor() { recordExecutionContextAttempt('worker'); }
};
for (const module of [dns, dnsPromises]) {
  module.Resolver = class BlockedOfflineResolver {
    constructor() { recordNetworkAttempt('dns.Resolver'); }
  };
}
if (typeof http.WebSocket === 'function') {
  Object.defineProperty(http, 'WebSocket', {
    value: class BlockedOfflineHttpWebSocket {
      constructor() { recordNetworkAttempt('http.WebSocket'); }
    },
    configurable: false,
    enumerable: true,
    writable: false,
  });
}
inspector.open = () => recordNetworkAttempt('inspector.open');
if (inspector.Session?.prototype) {
  inspector.Session.prototype.connect = () => recordNetworkAttempt('inspector.Session.connect');
}
net.Socket.prototype.connect = () => recordNetworkAttempt('net.Socket.connect');
net.Server.prototype.listen = () => recordNetworkAttempt('net.Server.listen');
for (const Agent of [http.Agent, https.Agent]) {
  if (Agent?.prototype) {
    Agent.prototype.createConnection = () => recordNetworkAttempt('http.Agent.createConnection');
  }
}
if (tls.TLSSocket?.prototype) {
  tls.TLSSocket.prototype.connect = () => recordNetworkAttempt('tls.TLSSocket.connect');
}
if (dgram.Socket?.prototype) {
  for (const method of ['bind', 'connect', 'send']) {
    dgram.Socket.prototype[method] = () => recordNetworkAttempt(`dgram.Socket.${method}`);
  }
}
syncBuiltinESMExports();

for (const name of ['WebSocket', 'EventSource']) {
  if (typeof globalThis[name] === 'function') {
    Object.defineProperty(globalThis, name, {
      value: class BlockedOfflineNetworkClient {
        constructor() { recordNetworkAttempt(name); }
      },
      configurable: false,
      enumerable: true,
      writable: false,
    });
  }
}

function boundarySnapshot() {
  return {
    guardInstalled: true,
    blockedNetworkAttempts: boundaryCounters.blockedNetworkAttempts,
    blockedHttpAttempts: boundaryCounters.blockedHttpAttempts,
    blockedSocketAttempts: boundaryCounters.blockedSocketAttempts,
    blockedDnsAttempts: boundaryCounters.blockedDnsAttempts,
    blockedWebSocketAttempts: boundaryCounters.blockedWebSocketAttempts,
    blockedEventSourceAttempts: boundaryCounters.blockedEventSourceAttempts,
    blockedInspectorAttempts: boundaryCounters.blockedInspectorAttempts,
    blockedWorkerAttempts: boundaryCounters.blockedWorkerAttempts,
    blockedClusterAttempts: boundaryCounters.blockedClusterAttempts,
    blockedChildNetworkToolAttempts: boundaryCounters.blockedChildNetworkToolAttempts,
    blockedAttemptKinds: { ...boundaryCounters.blockedAttemptKinds },
    orderedBlockedTrace: [...boundaryCounters.orderedBlockedTrace],
    childProcessAttempts: boundaryCounters.childProcessAttempts,
    allowedOriginalChildCalls: boundaryCounters.allowedOriginalChildCalls,
    blockedForbiddenChildAttempts: boundaryCounters.blockedForbiddenChildAttempts,
    allowedGitCalls: boundaryCounters.allowedGitCalls,
    allowedPythonCalls: boundaryCounters.allowedPythonCalls,
    childArgumentChecks: boundaryCounters.childArgumentChecks,
    childEnvironmentChecks: boundaryCounters.childEnvironmentChecks,
    gitCommands: { ...boundaryCounters.gitCommands },
    pythonOperations: { ...boundaryCounters.pythonOperations },
    orderedAllowedChildTrace: [...boundaryCounters.orderedAllowedChildTrace],
    blockedKeychainAttempts: boundaryCounters.blockedKeychainAttempts,
    blockedClipboardAttempts: boundaryCounters.blockedClipboardAttempts,
    ...(boundaryCounters.lastDeniedReason === null
      ? {} : { lastDeniedReason: boundaryCounters.lastDeniedReason }),
  };
}
Object.defineProperty(globalThis, BOUNDARY_SYMBOL, {
  value: Object.freeze({
    snapshot: boundarySnapshot,
    probeForbiddenChild,
  }),
  configurable: false,
  enumerable: false,
  writable: false,
});

const requiredEnvironment = (name) => {
  const value = process.env[name];
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error('R2_OFFLINE_E_ENVIRONMENT');
  }
  return value;
};

const manifestPath = requiredEnvironment('R2_OFFLINE_MANIFEST_PATH');
const mediaRoot = realpathSync(requiredEnvironment('R2_OFFLINE_MEDIA_ROOT'));
const summaryPath = requiredEnvironment('R2_OFFLINE_SUMMARY_PATH');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.objectCount !== 2_758 || manifest.totalBytes !== 2_346_220_246
  || manifest.manifestSha256
    !== '61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532'
  || !Array.isArray(manifest.entries) || manifest.entries.length !== manifest.objectCount) {
  throw new Error('R2_OFFLINE_E_MANIFEST');
}
const entriesByKey = new Map(manifest.entries.map((entry) => [entry.key, entry]));
if (entriesByKey.size !== manifest.objectCount) throw new Error('R2_OFFLINE_E_MANIFEST');

const operations = Object.fromEntries(OPERATION_KEYS.map((key) => [key, 0]));
const attempted = new Set();
const headKeys = new Set();
const getKeys = new Set();
const completedGetKeys = new Set();
let localMediaBytesRead = 0;
let retryCount = 0;
let phaseViolations = 0;
let unauthorizedRequests = 0;
let invariantFailures = 0;
const failureCodes = [];

function fail(code) {
  invariantFailures += 1;
  failureCodes.push(code);
  throw new Error(code);
}

function publicMediaEntryManifestSha256(entry) {
  return createHash('sha256').update(JSON.stringify({
    publicPath: entry.publicPath,
    key: entry.key,
    size: entry.size,
    sha256: entry.sha256,
    contentType: entry.contentType,
    cacheControl: entry.cacheControl,
  })).digest('hex');
}

function record(operation, identity) {
  if (!OPERATION_KEYS.includes(operation)) fail('R2_OFFLINE_E_OPERATION');
  operations[operation] += 1;
  const attempt = `${operation}\0${identity}`;
  if (attempted.has(attempt)) {
    retryCount += 1;
    fail('R2_OFFLINE_E_RETRY');
  }
  attempted.add(attempt);
}

function objectHeaders(entry) {
  return {
    'cache-control': entry.cacheControl,
    'content-length': String(entry.size),
    'content-type': entry.contentType,
    etag: `"${entry.sha256.slice(0, 32)}"`,
    'last-modified': LAST_MODIFIED,
    'x-amz-checksum-sha256': Buffer.from(entry.sha256, 'hex').toString('base64'),
    'x-amz-meta-contract': 'dwnc-public-media-r2-v1',
    'x-amz-meta-manifest-entry-sha256': publicMediaEntryManifestSha256(entry),
    'x-amz-meta-sha256': entry.sha256,
  };
}

function listResponse(continuationToken) {
  const expectedTokens = [null, 'page-1000', 'page-2000'];
  const pageIndex = operations.LIST;
  if (continuationToken !== expectedTokens[pageIndex]) fail('R2_OFFLINE_E_LIST_PAGE');
  record('LIST', continuationToken ?? 'first');
  const offset = pageIndex * 1000;
  const entries = manifest.entries.slice(offset, offset + 1000);
  const truncated = offset + entries.length < manifest.entries.length;
  const nextToken = truncated ? `page-${offset + entries.length}` : null;
  const contents = entries.map((entry) => [
    '<Contents>',
    `<Key>${encodeURIComponent(entry.key)}</Key>`,
    `<Size>${entry.size}</Size>`,
    `<ETag>&quot;${entry.sha256.slice(0, 32)}&quot;</ETag>`,
    '</Contents>',
  ].join('')).join('');
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ListBucketResult>',
    `<Name>${EXPECTED_BUCKET}</Name>`,
    '<Prefix>media%2F</Prefix>',
    `<KeyCount>${entries.length}</KeyCount>`,
    '<MaxKeys>1000</MaxKeys>',
    '<EncodingType>url</EncodingType>',
    `<IsTruncated>${truncated}</IsTruncated>`,
    ...(nextToken === null ? [] : [`<NextContinuationToken>${nextToken}</NextContinuationToken>`]),
    contents,
    '</ListBucketResult>',
  ].join('');
  return new Response(xml, {
    status: 200,
    headers: { 'content-type': 'application/xml', 'content-length': String(Buffer.byteLength(xml)) },
  });
}

async function* meteredBody(entry, file) {
  let objectBytes = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    objectBytes += chunk.length;
    localMediaBytesRead += chunk.length;
    yield chunk;
  }
  if (objectBytes !== entry.size) fail('R2_OFFLINE_E_SOURCE_SIZE');
  completedGetKeys.add(entry.key);
}

function localSource(entry) {
  const candidate = path.resolve(mediaRoot, entry.key);
  if (!candidate.startsWith(`${mediaRoot}${path.sep}`)) fail('R2_OFFLINE_E_SOURCE_PATH');
  const candidateStats = lstatSync(candidate);
  if (!candidateStats.isFile() || candidateStats.isSymbolicLink()
    || candidateStats.nlink !== 1 || candidateStats.size !== entry.size) {
    fail('R2_OFFLINE_E_SOURCE_FILE');
  }
  const actual = realpathSync(candidate);
  if (!actual.startsWith(`${mediaRoot}${path.sep}`)) fail('R2_OFFLINE_E_SOURCE_PATH');
  const stats = lstatSync(actual);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size !== entry.size) {
    fail('R2_OFFLINE_E_SOURCE_FILE');
  }
  return actual;
}

const offlineFetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.origin !== EXPECTED_ORIGIN) recordNetworkAttempt('fetch');
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  const authorization = headers.get('authorization') ?? '';
  if (url.origin !== EXPECTED_ORIGIN || init.redirect !== 'error'
    || !authorization.startsWith(
      `AWS4-HMAC-SHA256 Credential=${EXPECTED_ACCESS_KEY_ID}/`,
    )) fail('R2_OFFLINE_E_SIGNED_REQUEST');

  if (method === 'PUT' || method === 'DELETE') {
    operations[method] += 1;
    unauthorizedRequests += 1;
    fail('R2_OFFLINE_E_MUTATION');
  }
  if (!['GET', 'HEAD'].includes(method)) {
    unauthorizedRequests += 1;
    fail('R2_OFFLINE_E_METHOD');
  }

  const bucketPath = `/${EXPECTED_BUCKET}`;
  const bucketRoot = `${bucketPath}/`;
  const isList = method === 'GET' && url.pathname === bucketRoot
    && url.searchParams.get('list-type') === '2';
  if (isList) {
    const queryKeys = [...url.searchParams.keys()].sort();
    const continuationToken = url.searchParams.get('continuation-token');
    const expectedQueryKeys = [
      ...(continuationToken === null ? [] : ['continuation-token']),
      'encoding-type', 'list-type', 'max-keys', 'prefix',
    ].sort();
    if (url.searchParams.get('encoding-type') !== 'url'
      || url.searchParams.get('max-keys') !== '1000'
      || url.searchParams.get('prefix') !== 'media/'
      || JSON.stringify(queryKeys) !== JSON.stringify(expectedQueryKeys)
      || operations.HEAD !== 0 || operations.GET !== 0) fail('R2_OFFLINE_E_LIST_REQUEST');
    return listResponse(continuationToken);
  }

  if (!url.pathname.startsWith(bucketRoot) || url.search !== '') {
    fail('R2_OFFLINE_E_OBJECT_REQUEST');
  }
  let key;
  try { key = decodeURIComponent(url.pathname.slice(bucketRoot.length)); }
  catch { fail('R2_OFFLINE_E_OBJECT_REQUEST'); }
  const entry = entriesByKey.get(key);
  if (!entry || headers.get('x-amz-checksum-mode') !== 'ENABLED'
    || operations.LIST !== 3) fail('R2_OFFLINE_E_OBJECT_REQUEST');

  if (method === 'HEAD') {
    if (operations.GET !== 0 || headKeys.has(key)) fail('R2_OFFLINE_E_HEAD_PHASE');
    record('HEAD', key);
    headKeys.add(key);
    return new Response(null, { status: 200, headers: objectHeaders(entry) });
  }

  if (headKeys.size !== manifest.objectCount || getKeys.has(key)) {
    phaseViolations += 1;
    fail('R2_OFFLINE_E_GET_PHASE');
  }
  record('GET', key);
  getKeys.add(key);
  const body = Readable.toWeb(Readable.from(meteredBody(entry, localSource(entry))));
  return new Response(body, { status: 200, headers: objectHeaders(entry) });
};
Object.defineProperty(globalThis, 'fetch', {
  value: offlineFetch,
  configurable: false,
  enumerable: true,
  writable: false,
});

process.once('exit', () => {
  const boundary = boundarySnapshot();
  const summary = {
    contract: 'dwnc-r2-full-audit-offline-summary-v2',
    manifestSha256: manifest.manifestSha256,
    objectCount: manifest.objectCount,
    totalBytes: manifest.totalBytes,
    operations,
    totalRequests: Object.values(operations).reduce((sum, value) => sum + value, 0),
    uniqueHeadObjects: headKeys.size,
    uniqueGetObjects: getKeys.size,
    completedGetObjects: completedGetKeys.size,
    localMediaBytesRead,
    retryCount,
    phaseViolations,
    unauthorizedRequests,
    invariantFailures,
    failureCodes,
    boundary,
  };
  writeFileSync(summaryPath, `${JSON.stringify(summary)}\n`, { flag: 'wx', mode: 0o600 });
});
