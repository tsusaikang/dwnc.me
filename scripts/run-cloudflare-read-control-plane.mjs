import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCloudflareAccountTarget,
  encodeCloudflareControlPlaneTokenFrame,
  installStructuredErrorHandler,
  sanitizedEnvironment,
  writeAnonymousInheritedInput,
} from './lib/cloudflare-process.mjs';
import {
  assertCloudflareAccountTargetOutsideRepository,
  defaultCloudflareAccountTargetMetadataPath,
  loadCloudflareAccountTarget,
  MacOSSingleReadClipboard,
} from './lib/cloudflare-account-target.mjs';
import { parseR2ExposureCommand } from './lib/cloudflare-r2-exposure-command.mjs';
import { R2_EXPOSURE_TARGETS } from './lib/cloudflare-r2-exposure.mjs';
import { assertSecureCreateOnlyDestination } from './lib/cloudflare-signing-key.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const commands = Object.freeze({
  'staging-r2-exposure': {
    environment: 'staging',
    script: 'scripts/fetch-public-media-r2-exposure.mjs',
    args: ['--purpose=staging-r2-private-exposure-read'],
    outputVariables: [
      'CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH',
      'CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH',
    ],
    requiredVariables: [
      'CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT',
      'CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE',
    ],
  },
  'production-r2-exposure': {
    environment: 'production',
    script: 'scripts/fetch-public-media-r2-exposure.mjs',
    args: ['--purpose=production-r2-private-exposure-read'],
    outputVariables: [
      'CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH',
      'CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH',
    ],
    requiredVariables: [
      'CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT',
      'CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE',
    ],
  },
});

const LEGACY_CONTROL_PLANE_TOKEN_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
]);
const FORBIDDEN_PARENT_ACCOUNT_NAMES = Object.freeze([
  'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'R2_ACCOUNT_ID',
  'CLOUDFLARE_ACCOUNT_TARGET_METADATA_PATH',
]);

export async function runCloudflareReadControlPlane({
  argv = process.argv.slice(2),
  environment = process.env,
  root = process.cwd(),
  clipboard = new MacOSSingleReadClipboard(),
  spawnChild = spawn,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  loadAccountTarget = loadCloudflareAccountTarget,
  accountTargetMetadataPath,
  assertAccount = assertCloudflareAccountTarget,
  assertDestination = assertSecureCreateOnlyDestination,
} = {}) {
  let apiToken = '';
  let accountId = '';
  let tokenFrame;
  try {
    const [argument] = argv;
    if (!argument?.startsWith('--command=') || argv.length !== 1) {
      throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
    }
    if (LEGACY_CONTROL_PLANE_TOKEN_NAMES.some((name) => Object.hasOwn(environment, name))
      || Object.hasOwn(environment, 'CLOUDFLARE_API_TOKEN_FD')) {
      throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_AMBIGUOUS');
    }
    if (FORBIDDEN_PARENT_ACCOUNT_NAMES.some((name) => Object.hasOwn(environment, name))) {
      throw new Error('CLOUDFLARE_E_CONTROL_ACCOUNT_AMBIGUOUS');
    }
    const selected = commands[argument.slice('--command='.length)];
    if (!selected || typeof root !== 'string' || !path.isAbsolute(root)
      || path.resolve(root) !== root
      || accountTargetMetadataPath !== undefined
        && (typeof accountTargetMetadataPath !== 'string'
          || !path.isAbsolute(accountTargetMetadataPath)
          || path.resolve(accountTargetMetadataPath) !== accountTargetMetadataPath)) {
      throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
    }
    const selectedAccountTargetMetadataPath = accountTargetMetadataPath
      ?? defaultCloudflareAccountTargetMetadataPath();
    await assertCloudflareAccountTargetOutsideRepository(
      selectedAccountTargetMetadataPath, root,
    );
    const outputEnvironment = {};
    for (const name of selected.outputVariables) {
      const value = environment[name];
      if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
      }
      outputEnvironment[name] = value;
    }
    for (const name of selected.requiredVariables) {
      const value = environment[name];
      if (typeof value !== 'string') throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
      outputEnvironment[name] = value;
    }
    const policy = await loadPolicy(root);
    const configuredTarget = R2_EXPOSURE_TARGETS[selected.environment];
    const target = policy?.[selected.environment];
    if (!configuredTarget || target?.environment !== selected.environment
      || target?.bucket !== configuredTarget.bucket
      || typeof target?.accountIdSha256 !== 'string') {
      throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_TARGET');
    }
    const parsed = parseR2ExposureCommand({
      argv: selected.args, environment: { ...environment, ...outputEnvironment }, root,
    });
    if (parsed.environment !== selected.environment) {
      throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_TARGET');
    }
    await Promise.all([
      assertDestination(parsed.capturePath),
      assertDestination(parsed.evidencePath),
    ]);
    const loadedAccountTarget = await loadAccountTarget({
      metadataPath: selectedAccountTargetMetadataPath,
      expectedAccountIdSha256: target.accountIdSha256,
    });
    accountId = loadedAccountTarget?.accountId ?? '';
    assertAccount(accountId, target.accountIdSha256);
    // Clipboard capability is checked before any attempt to read a token.
    await clipboard.preflight();
    apiToken = await clipboard.readOnceAndClear();
    tokenFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
    apiToken = '';
    const child = spawnChild(process.execPath, [path.join(root, selected.script), ...selected.args], {
      cwd: root,
      env: sanitizedEnvironment(environment, {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN_FD: '3',
        ...outputEnvironment,
      }),
      stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
    });
    const tokenPipe = child.stdio[3];
    if (!tokenPipe) {
      child.kill();
      throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
    }
    const [, code] = await Promise.all([
      writeAnonymousInheritedInput(tokenPipe, tokenFrame, { descriptor: 3, maximumBytes: 512 }),
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      }),
    ]);
    if (code !== 0) throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_CHILD');
  } finally {
    apiToken = '';
    accountId = '';
    tokenFrame?.fill(0);
    await clipboard.clear();
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-read-control-plane-runner');
  await runCloudflareReadControlPlane();
}
