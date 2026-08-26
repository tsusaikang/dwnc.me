import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, open, realpath, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cloudflareWranglerEnvironment } from './lib/cloudflare-process.mjs';
import { runCloudflareReadControlPlane } from './run-cloudflare-read-control-plane.mjs';

const accountId = 'a'.repeat(32);
const apiToken = 'synthetic_read_only_token_1234567890';
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = async (action, code) => {
  await assert.rejects(action, (error) => error?.message === code);
  assertions += 1;
};

class MemoryClipboard {
  constructor(value, { preflightError = null } = {}) {
    this.value = value;
    this.preflightError = preflightError;
    this.preflightCount = 0;
    this.readCount = 0;
    this.clearCount = 0;
  }
  async preflight() {
    this.preflightCount += 1;
    if (this.preflightError !== null) throw new Error(this.preflightError);
  }
  async readAndClear() {
    this.readCount += 1;
    const value = this.value;
    await this.clear();
    return value;
  }
  async clear() {
    this.clearCount += 1;
    this.value = '';
  }
}

const wranglerEnvironment = cloudflareWranglerEnvironment({
  PATH: '/usr/bin:/bin', HOME: '/synthetic/home', CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN_FD: '3', UNRELATED_SECRET: apiToken,
}, { CI: '1' });
equal(wranglerEnvironment, {
  PATH: '/usr/bin:/bin', HOME: '/synthetic/home', CLOUDFLARE_ACCOUNT_ID: accountId, CI: '1',
});
equal(JSON.stringify(wranglerEnvironment).includes(apiToken), false);
assert.throws(() => cloudflareWranglerEnvironment({
  PATH: '/usr/bin:/bin', CLOUDFLARE_API_TOKEN: apiToken,
}), /CLOUDFLARE_E_WRANGLER_TOKEN_ENV_FORBIDDEN/u);
assertions += 1;
assert.throws(() => cloudflareWranglerEnvironment({}, { CF_API_TOKEN: apiToken }),
  /CLOUDFLARE_E_WRANGLER_TOKEN_ENV_FORBIDDEN/u);
assertions += 1;

const validRunnerEnvironment = Object.freeze({
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: '/synthetic/r2-exposure-capture.json',
  CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: '/synthetic/r2-exposure-evidence.json',
});
const unexpectedSpawn = () => { throw new Error('TEST_E_UNEXPECTED_SPAWN'); };

const invalidOutputClipboard = new MemoryClipboard(apiToken);
await rejects(() => runCloudflareReadControlPlane({
  argv: ['--command=staging-r2-exposure'],
  environment: {
    ...validRunnerEnvironment,
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: 'relative-capture.json',
  },
  clipboard: invalidOutputClipboard,
  spawnChild: unexpectedSpawn,
}), 'CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
equal(invalidOutputClipboard.preflightCount, 0);
equal(invalidOutputClipboard.readCount, 0);
equal(invalidOutputClipboard.clearCount >= 1, true);
equal(invalidOutputClipboard.value, '');

const failedPreflightClipboard = new MemoryClipboard(apiToken, {
  preflightError: 'MEDIA_E_R2_CLIPBOARD_PREFLIGHT',
});
await rejects(() => runCloudflareReadControlPlane({
  argv: ['--command=staging-r2-exposure'],
  environment: validRunnerEnvironment,
  clipboard: failedPreflightClipboard,
  spawnChild: unexpectedSpawn,
}), 'MEDIA_E_R2_CLIPBOARD_PREFLIGHT');
equal(failedPreflightClipboard.preflightCount, 1);
equal(failedPreflightClipboard.readCount, 0);
equal(failedPreflightClipboard.clearCount >= 1, true);
equal(failedPreflightClipboard.value, '');

async function runReader({ token = apiToken, environment = {}, diskFd = null } = {}) {
  const usePipe = diskFd === null;
  const child = spawn(process.execPath, ['scripts/test-cloudflare-control-plane-token-reader.mjs'], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN_FD: '3',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe', usePipe ? 'pipe' : diskFd],
  });
  if (usePipe) {
    child.stdio[3].on('error', () => undefined);
    child.stdio[3].end(token);
  }
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const output = `${stdout}\n${stderr}`;
  equal(output.includes(token), false);
  return { code, stdout, stderr };
}

const accepted = await runReader();
equal(accepted.code, 0);
equal(JSON.parse(accepted.stdout).tokenPrinted, false);

const ambiguous = await runReader({ environment: { CLOUDFLARE_API_TOKEN: apiToken } });
equal(ambiguous.code, 1);
equal(ambiguous.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_AMBIGUOUS');

const envOnly = await runReader({
  environment: { CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_API_TOKEN_FD: undefined },
});
equal(envOnly.code, 1);
equal(envOnly.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_FD_REQUIRED');

const wrongDescriptor = await runReader({ environment: { CLOUDFLARE_API_TOKEN_FD: '4' } });
equal(wrongDescriptor.code, 1);
equal(wrongDescriptor.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');

const mixedWithS3 = await runReader({ environment: { R2_ACCESS_KEY_ID: 'b'.repeat(32) } });
equal(mixedWithS3.code, 1);
equal(mixedWithS3.stderr.trim(), 'CLOUDFLARE_E_CONTROL_CREDENTIAL_AMBIGUOUS');

const newline = await runReader({ token: `${apiToken}\n` });
equal(newline.code, 1);
equal(newline.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');

const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dwnc-control-token-test-')));
await chmod(directory, 0o700);
try {
  const file = path.join(directory, 'token');
  const handle = await open(file, 'wx+', 0o600);
  try {
    await handle.writeFile(apiToken);
    await handle.sync();
    await unlink(file);
    const diskBacked = await runReader({ diskFd: handle.fd });
    equal(diskBacked.code, 1);
    equal(diskBacked.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');
  } finally { await handle.close(); }
} finally { await rm(directory, { recursive: true, force: true }); }

console.log(JSON.stringify({
  suite: 'cloudflare-control-plane-sealed-fd-auth',
  assertions,
  tokenEnvironmentAccepted: false,
  diskBackedTokenAccepted: false,
  realTokenCalls: 0,
  liveNetworkCalls: 0,
  status: 'PASS',
}, null, 2));
