import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  installStructuredErrorHandler,
  sanitizedEnvironment,
  stagingSmokeTokenBytesFromSecretsFile,
  writeAnonymousInheritedInput,
} from './lib/cloudflare-process.mjs';
import { readSecureFile } from './lib/cloudflare-signing-key.mjs';

installStructuredErrorHandler('staging-smoke-token-runner');
const ROOT = process.cwd();
const commandArgument = process.argv[2];
if (!commandArgument?.startsWith('--command=')) {
  throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_ARGUMENT');
}
const command = commandArgument.slice('--command='.length);
if (process.argv[3] !== '--' || process.argv.length !== 4) {
  throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_ARGUMENT');
}

const COMMON_ENVIRONMENT_NAMES = Object.freeze([
  'CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR',
  'CLOUDFLARE_STAGING_SYNTHETIC_ORIGIN',
  'CLOUDFLARE_STAGING_VERSION_ATTESTATION_RECEIPT_PATH',
  'CLOUDFLARE_STAGING_VERSION_ATTESTATION_SIGNATURE_PATH',
  'CLOUDFLARE_STAGING_VERSION_ATTESTATION_PUBLIC_KEY_PATH',
  'CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_RECEIPT_PATH',
  'CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_SIGNATURE_PATH',
  'CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_PUBLIC_KEY_PATH',
  'CLOUDFLARE_STAGING_MEDIA_PROBE_RECEIPT_PATH',
  'CLOUDFLARE_STAGING_MEDIA_PROBE_SIGNATURE_PATH',
  'CLOUDFLARE_STAGING_MEDIA_PROBE_PUBLIC_KEY_PATH',
]);
const commands = Object.freeze({
  smoke: {
    script: 'scripts/collect-cloudflare-staging-smoke.mjs',
    environmentNames: [
      ...COMMON_ENVIRONMENT_NAMES,
      'CLOUDFLARE_STAGING_SMOKE_CANDIDATE_PATH',
      'CLOUDFLARE_VERSION_ATTESTATION_RECEIPT_PATH',
      'CLOUDFLARE_VERSION_ATTESTATION_SIGNATURE_PATH',
      'CLOUDFLARE_VERSION_ATTESTATION_PUBLIC_KEY_PATH',
    ],
  },
  'admission-smoke': {
    script: 'scripts/collect-cloudflare-staging-admission-smoke.mjs',
    environmentNames: [
      ...COMMON_ENVIRONMENT_NAMES,
      'CLOUDFLARE_STAGING_ADMISSION_SMOKE_CANDIDATE_PATH',
    ],
  },
});
const selected = commands[command];
const secretsFile = process.env.CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE;
if (!selected || typeof secretsFile !== 'string' || !path.isAbsolute(secretsFile)
  || Object.hasOwn(process.env, 'CLOUDFLARE_STAGING_SMOKE_TOKEN')) {
  throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_ARGUMENT');
}

const stored = await readSecureFile(secretsFile, 4096);
let tokenBytes;
try {
  tokenBytes = stagingSmokeTokenBytesFromSecretsFile(stored);
} finally {
  stored.fill(0);
}

const passthrough = {};
for (const name of selected.environmentNames) {
  if (typeof process.env[name] === 'string') passthrough[name] = process.env[name];
}
try {
  const child = spawn(process.execPath, [path.join(ROOT, selected.script)], {
    cwd: ROOT,
    env: sanitizedEnvironment(process.env, {
      ...passthrough,
      CLOUDFLARE_STAGING_SMOKE_TOKEN_FD: '3',
    }),
    stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
  });
  const pipe = child.stdio[3];
  if (!pipe) throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_FD');
  const [, code] = await Promise.all([
    writeAnonymousInheritedInput(pipe, tokenBytes, { descriptor: 3, maximumBytes: 43 }),
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
  ]);
  if (code !== 0) throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_CHILD');
} finally {
  tokenBytes?.fill(0);
}
