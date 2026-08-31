import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCloudflareAccountTargetOutsideRepository,
  cloudflareAccountTargetRecoveryMetadataPath,
  defaultCloudflareAccountTargetMetadataPath,
} from './lib/cloudflare-account-target.mjs';
import {
  cloudflareAccountTargetLoopbackFailure,
  openCloudflareAccountTargetLoopbackBridge,
  serializeCloudflareAccountTargetLoopbackMessage,
} from './lib/cloudflare-account-target-loopback.mjs';
import {
  PUBLIC_MEDIA_RELEASE_POLICY_PATH,
  validatePublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';
import {
  inspectPublicMediaGit,
  validatePublicMediaGitSnapshot,
} from './lib/public-media-git.mjs';

const MODULE_FILE = fileURLToPath(import.meta.url);
export const CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_RUNTIME_ROOT =
  '/Users/jusang/projects/dwnc.me';
export const CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_EXECUTION_TIMEOUT_MS = 60_000;

const DERIVED_ROOT = path.resolve(path.dirname(MODULE_FILE), '..');
const GIT_OID = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function fail(code) { throw new Error(code); }

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 2
    || typeof argv[0] !== 'string' || typeof argv[1] !== 'string') {
    fail('BRIDGE_E_ARGUMENT');
  }
  const parsed = Object.create(null);
  for (const argument of argv) {
    const match = /^--(expected-git-commit|expected-git-tree)=([a-f0-9]{40})$/u.exec(argument);
    if (!match || parsed[match[1]] !== undefined) fail('BRIDGE_E_ARGUMENT');
    parsed[match[1]] = match[2];
  }
  if (!GIT_OID.test(parsed['expected-git-commit'] ?? '')
    || !GIT_OID.test(parsed['expected-git-tree'] ?? '')) fail('BRIDGE_E_ARGUMENT');
  return Object.freeze({
    expectedCommit: parsed['expected-git-commit'],
    expectedTree: parsed['expected-git-tree'],
  });
}

export function assertCloudflareAccountTargetLoopbackRuntimeRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || root !== CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_RUNTIME_ROOT) fail('BRIDGE_E_ROOT');
  return root;
}

async function assertGitBoundary(root, expectedCommit, expectedTree, inspectGit) {
  try {
    const snapshot = await inspectGit(root);
    return validatePublicMediaGitSnapshot(snapshot, expectedCommit, expectedTree);
  } catch { fail('BRIDGE_E_GIT'); }
}

async function loadPolicySnapshot(root, readPolicyFile, validatePolicy) {
  let bytes;
  try {
    bytes = await readPolicyFile(path.join(root, PUBLIC_MEDIA_RELEASE_POLICY_PATH));
    if (!Buffer.isBuffer(bytes)) fail('BRIDGE_E_POLICY');
    const policySha256 = createHash('sha256').update(bytes).digest('hex');
    const policy = validatePolicy(JSON.parse(bytes.toString('utf8')));
    const expectedAccountIdSha256 = policy?.staging?.accountIdSha256;
    if (policy?.staging?.environment !== 'staging'
      || policy?.staging?.bucket !== 'dwnc-me-public-media-staging'
      || !SHA256.test(expectedAccountIdSha256 ?? '')
      || !SHA256.test(policySha256)) fail('BRIDGE_E_POLICY');
    return Object.freeze({ policySha256, expectedAccountIdSha256 });
  } catch (error) {
    if (error?.message === 'BRIDGE_E_POLICY') throw error;
    fail('BRIDGE_E_POLICY');
  } finally {
    if (Buffer.isBuffer(bytes)) bytes.fill(0);
  }
}

function productionWriteFinalAndExit(message) {
  const serialized = serializeCloudflareAccountTargetLoopbackMessage(message);
  try { writeSync(process.stdout.fd, serialized, null, 'utf8'); }
  finally { process.exit(1); }
}

export function armCloudflareAccountTargetLoopbackWatchdog({
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  writeFinalAndExit = productionWriteFinalAndExit,
} = {}) {
  if ([setTimeoutImpl, clearTimeoutImpl, writeFinalAndExit]
    .some((value) => typeof value !== 'function')) fail('BRIDGE_E_IMPLEMENTATION');
  let active = true;
  const timer = setTimeoutImpl(() => {
    if (!active) return;
    active = false;
    writeFinalAndExit(cloudflareAccountTargetLoopbackFailure(
      new Error('BRIDGE_E_EXECUTION_TIMEOUT'), 'unknown',
    ));
  }, CLOUDFLARE_ACCOUNT_TARGET_LOOPBACK_EXECUTION_TIMEOUT_MS);
  return () => {
    if (!active) return;
    active = false;
    clearTimeoutImpl(timer);
  };
}

function validateTestOnlyDependencies(testOnly) {
  if (testOnly === undefined) return Object.freeze({});
  const allowedKeys = [
    'runtimeRoot', 'inspectGit', 'readPolicyFile', 'validatePolicy',
    'assertOutsideRepository', 'openBridge', 'armWatchdog', 'write',
    'metadataOutput',
  ];
  if (!testOnly || typeof testOnly !== 'object' || Array.isArray(testOnly)
    || !Object.keys(testOnly).every((key) => allowedKeys.includes(key))) {
    fail('BRIDGE_E_IMPLEMENTATION');
  }
  return testOnly;
}

export async function runCloudflareAccountTargetLoopback({
  argv = process.argv.slice(2),
  testOnly,
} = {}) {
  const parsed = parseArguments(argv);
  const injected = validateTestOnlyDependencies(testOnly);
  const root = assertCloudflareAccountTargetLoopbackRuntimeRoot(
    injected.runtimeRoot ?? DERIVED_ROOT,
  );
  const inspectGit = injected.inspectGit ?? inspectPublicMediaGit;
  const readPolicyFile = injected.readPolicyFile ?? readFile;
  const validatePolicy = injected.validatePolicy ?? validatePublicMediaReleasePolicy;
  const assertOutsideRepository = injected.assertOutsideRepository
    ?? assertCloudflareAccountTargetOutsideRepository;
  const openBridge = injected.openBridge ?? openCloudflareAccountTargetLoopbackBridge;
  const armWatchdog = injected.armWatchdog ?? armCloudflareAccountTargetLoopbackWatchdog;
  const write = injected.write ?? ((serialized) => process.stdout.write(serialized));
  if ([inspectGit, readPolicyFile, validatePolicy, assertOutsideRepository,
    openBridge, armWatchdog, write].some((value) => typeof value !== 'function')) {
    fail('BRIDGE_E_IMPLEMENTATION');
  }

  const selectedMetadataOutput = injected.metadataOutput
    ?? defaultCloudflareAccountTargetMetadataPath();
  if (typeof selectedMetadataOutput !== 'string'
    || !path.isAbsolute(selectedMetadataOutput)
    || path.resolve(selectedMetadataOutput) !== selectedMetadataOutput) {
    fail('BRIDGE_E_ARGUMENT');
  }
  const recoveryMetadataOutput = cloudflareAccountTargetRecoveryMetadataPath(
    selectedMetadataOutput,
  );
  await assertOutsideRepository(selectedMetadataOutput, root);
  await assertOutsideRepository(recoveryMetadataOutput, root);
  const policy = await loadPolicySnapshot(root, readPolicyFile, validatePolicy);
  await assertGitBoundary(root, parsed.expectedCommit, parsed.expectedTree, inspectGit);

  let cancelWatchdog = () => undefined;
  let watchdogArmed = false;
  const bridge = await openBridge({
    metadataOutput: selectedMetadataOutput,
    recoveryMetadataOutput,
    expectedAccountIdSha256: policy.expectedAccountIdSha256,
    expectedPolicySha256: policy.policySha256,
    onAuthenticated: () => {
      if (watchdogArmed) fail('BRIDGE_E_IMPLEMENTATION');
      cancelWatchdog = armWatchdog();
      if (typeof cancelWatchdog !== 'function') fail('BRIDGE_E_IMPLEMENTATION');
      watchdogArmed = true;
    },
    assertBeforeInitialize: async () => {
      await assertGitBoundary(root, parsed.expectedCommit, parsed.expectedTree, inspectGit);
    },
  });
  write(serializeCloudflareAccountTargetLoopbackMessage(bridge.ready));
  const final = await bridge.completion;
  cancelWatchdog();
  write(serializeCloudflareAccountTargetLoopbackMessage(final));
  return final;
}

if (path.resolve(process.argv[1] ?? '') === MODULE_FILE) {
  let final;
  try { final = await runCloudflareAccountTargetLoopback(); }
  catch (error) {
    final = cloudflareAccountTargetLoopbackFailure(error, 'none');
    process.stdout.write(serializeCloudflareAccountTargetLoopbackMessage(final));
  }
  if (final.status !== 'complete') process.exitCode = 1;
}
