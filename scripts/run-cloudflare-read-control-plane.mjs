import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installStructuredErrorHandler,
  sanitizedEnvironment,
  writeAnonymousInheritedInput,
} from './lib/cloudflare-process.mjs';
import { MacOSClipboard } from './lib/r2-credential-store.mjs';

const commands = Object.freeze({
  'staging-r2-exposure': {
    script: 'scripts/fetch-public-media-r2-exposure.mjs',
    args: ['--environment=staging'],
    outputVariables: [
      'CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH',
      'CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH',
    ],
  },
  'staging-workers-dev-status': {
    script: 'scripts/fetch-cloudflare-staging-workers-dev-status.mjs',
    args: [],
    outputVariables: [
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_CAPTURE_PATH',
      'CLOUDFLARE_STAGING_WORKERS_DEV_STATUS_EVIDENCE_PATH',
    ],
  },
});

export async function runCloudflareReadControlPlane({
  argv = process.argv.slice(2),
  environment = process.env,
  root = process.cwd(),
  clipboard = new MacOSClipboard(),
  spawnChild = spawn,
} = {}) {
  let apiToken = '';
  let tokenBytes;
  try {
    const [argument] = argv;
    if (!argument?.startsWith('--command=') || argv.length !== 1) {
      throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
    }
    if (Object.hasOwn(environment, 'CLOUDFLARE_API_TOKEN')
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
    // Clipboard capability is checked before any attempt to read a token.
    await clipboard.preflight();
    apiToken = await clipboard.readAndClear();
    if (!/^[A-Za-z0-9._~+\/-]{20,4096}={0,2}$/u.test(apiToken)) {
      throw new Error('CLOUDFLARE_E_CONTROL_TOKEN_FD');
    }
    tokenBytes = Buffer.from(apiToken);
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
      writeAnonymousInheritedInput(tokenPipe, tokenBytes, { descriptor: 3, maximumBytes: 4096 }),
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      }),
    ]);
    if (code !== 0) throw new Error('CLOUDFLARE_E_CONTROL_RUNNER_CHILD');
  } finally {
    apiToken = '';
    tokenBytes?.fill(0);
    await clipboard.clear();
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-read-control-plane-runner');
  await runCloudflareReadControlPlane();
}
