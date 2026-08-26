import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  installStructuredErrorHandler,
  sanitizedEnvironment,
  stagingSmokeTokenBytesFromSecretsFile,
  writeAnonymousInheritedInput,
} from './lib/cloudflare-process.mjs';
import { canonicalJson } from './lib/cloudflare-release.mjs';
import { readSecureFile } from './lib/cloudflare-signing-key.mjs';
import { loadR2Credential } from './lib/r2-credential-store.mjs';
import { buildR2RunnerInvocation } from './lib/r2-command-runner.mjs';

installStructuredErrorHandler('r2-credential-runner');
const ROOT = process.cwd();
const commandArgument = process.argv[2];
if (!commandArgument?.startsWith('--command=')) throw new Error('MEDIA_E_R2_RUNNER_ARGUMENT');
const command = commandArgument.slice('--command='.length);
const separator = process.argv[3];
if (separator !== '--') throw new Error('MEDIA_E_R2_RUNNER_ARGUMENT');
const forwarded = process.argv.slice(4);
const selected = buildR2RunnerInvocation(command, forwarded);
const metadataPath = process.env.R2_CREDENTIAL_METADATA_PATH;
if (typeof metadataPath !== 'string' || !path.isAbsolute(metadataPath)) {
  throw new Error('MEDIA_E_R2_RUNNER_ARGUMENT');
}
const { credentials } = await loadR2Credential({
  environment: selected.environment,
  role: selected.role,
  metadataPath,
});
const credentialBytes = Buffer.from(canonicalJson(credentials));
let smokeTokenBytes;
try {
  if (selected.smokeToken) {
    const secretsFile = process.env.CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE;
    if (typeof secretsFile !== 'string' || !path.isAbsolute(secretsFile)
      || Object.hasOwn(process.env, 'CLOUDFLARE_STAGING_SMOKE_TOKEN')) {
      throw new Error('MEDIA_E_R2_RUNNER_ARGUMENT');
    }
    const stored = await readSecureFile(secretsFile, 4096);
    try { smokeTokenBytes = stagingSmokeTokenBytesFromSecretsFile(stored); }
    finally { stored.fill(0); }
  }
  const probeEnvironmentNames = [
    'CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR',
    'CLOUDFLARE_STAGING_MEDIA_PROBE_PATH',
    'CLOUDFLARE_STAGING_SYNTHETIC_ORIGIN',
    'CLOUDFLARE_STAGING_VERSION_ATTESTATION_RECEIPT_PATH',
    'CLOUDFLARE_STAGING_VERSION_ATTESTATION_SIGNATURE_PATH',
    'CLOUDFLARE_STAGING_VERSION_ATTESTATION_PUBLIC_KEY_PATH',
  ];
  const passthrough = {};
  if (selected.smokeToken) {
    for (const name of probeEnvironmentNames) {
      if (typeof process.env[name] === 'string') passthrough[name] = process.env[name];
    }
  }
  const stdio = selected.smokeToken
    ? ['inherit', 'inherit', 'inherit', 'pipe', 'pipe']
    : ['inherit', 'inherit', 'inherit', 'pipe'];
  const child = spawn(process.execPath, [path.join(ROOT, selected.script), ...selected.args], {
    cwd: ROOT,
    env: sanitizedEnvironment(process.env, {
      ...passthrough,
      R2_CREDENTIALS_FD: '3',
      ...(selected.smokeToken ? { CLOUDFLARE_STAGING_SMOKE_TOKEN_FD: '4' } : {}),
    }),
    stdio,
  });
  const credentialPipe = child.stdio[3];
  const smokeTokenPipe = selected.smokeToken ? child.stdio[4] : null;
  if (!credentialPipe || selected.smokeToken && !smokeTokenPipe) {
    throw new Error('MEDIA_E_R2_RUNNER_FD');
  }
  const writes = [
    writeAnonymousInheritedInput(
      credentialPipe, credentialBytes, { descriptor: 3, maximumBytes: 4096 },
    ),
  ];
  if (smokeTokenPipe) {
    writes.push(writeAnonymousInheritedInput(
      smokeTokenPipe, smokeTokenBytes, { descriptor: 4, maximumBytes: 43 },
    ));
  }
  const [, code] = await Promise.all([
    Promise.all(writes),
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }),
  ]);
  if (code !== 0) throw new Error('MEDIA_E_R2_RUNNER_CHILD');
} finally {
  credentialBytes.fill(0);
  smokeTokenBytes?.fill(0);
}
