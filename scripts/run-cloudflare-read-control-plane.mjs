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
import { parseStagingR2ExposureCommand } from './lib/cloudflare-r2-exposure-command.mjs';
import { assertSecureCreateOnlyDestination } from './lib/cloudflare-signing-key.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';
import { MacOSClipboard } from './lib/r2-credential-store.mjs';

const commands = Object.freeze({
  'staging-r2-exposure': {
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
  'staging-workers-dev-status': {
    script: 'scripts/fetch-cloudflare-staging-workers-dev-status.mjs',
    args: [],
    outputVariables: [
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH',
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH',
    ],
    requiredVariables: [],
  },
});

const LEGACY_CONTROL_PLANE_TOKEN_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
]);

export async function runCloudflareReadControlPlane({
  argv = process.argv.slice(2),
  environment = process.env,
  root = process.cwd(),
  clipboard = new MacOSClipboard(),
  spawnChild = spawn,
  loadPolicy = loadTrackedPublicMediaReleasePolicy,
  assertAccount = assertCloudflareAccountTarget,
  assertDestination = assertSecureCreateOnlyDestination,
} = {}) {
  let apiToken = '';
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
    const selected = commands[argument.slice('--command='.length)];
    const accountId = environment.CLOUDFLARE_ACCOUNT_ID;
    if (!selected || typeof accountId !== 'string' || !/^[A-Fa-f0-9]{32}$/u.test(accountId)) {
      throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
    }
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
    if (argument === '--command=staging-r2-exposure') {
      const parsed = parseStagingR2ExposureCommand({
        argv: selected.args, environment: { ...environment, ...outputEnvironment }, root,
      });
      await Promise.all([
        assertDestination(parsed.capturePath),
        assertDestination(parsed.evidencePath),
      ]);
      const policy = await loadPolicy(root);
      if (policy.staging?.bucket !== 'dwnc-me-public-media-staging') {
        throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_TARGET');
      }
      assertAccount(accountId, policy.staging.accountIdSha256);
    }
    // Clipboard capability is checked before any attempt to read a token.
    await clipboard.preflight();
    apiToken = await clipboard.readAndClear();
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
    tokenFrame?.fill(0);
    await clipboard.clear();
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-read-control-plane-runner');
  await runCloudflareReadControlPlane();
}
