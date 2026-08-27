import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, open, realpath, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  cloudflareControlPlaneReadCredentials,
  cloudflareWranglerEnvironment,
  encodeCloudflareControlPlaneTokenFrame,
} from './lib/cloudflare-process.mjs';
import { cloudflareAccountIdSha256 } from './lib/public-media-manifest.mjs';
import { runCloudflareReadControlPlane } from './run-cloudflare-read-control-plane.mjs';

const accountId = 'a'.repeat(32);
const apiToken = 'synthetic_read_only_token_1234567890';
const expectedGitCommit = 'c'.repeat(40);
const expectedGitTree = 'd'.repeat(40);
const syntheticPolicy = Object.freeze({
  staging: Object.freeze({
    environment: 'staging',
    bucket: 'dwnc-me-public-media-staging',
    accountIdSha256: cloudflareAccountIdSha256(accountId),
  }),
});
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
  async readOnceAndClear() {
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

const runnerDirectory = await realpath(await mkdtemp(path.join(
  os.tmpdir(), 'dwnc-control-runner-test-',
)));
await chmod(runnerDirectory, 0o700);
const validRunnerEnvironment = Object.freeze({
  CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: path.join(runnerDirectory, 'r2-exposure-capture.json'),
  CLOUDFLARE_R2_EXPOSURE_EVIDENCE_PATH: path.join(runnerDirectory, 'r2-exposure-evidence.json'),
  CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_COMMIT: expectedGitCommit,
  CLOUDFLARE_R2_EXPOSURE_EXPECTED_GIT_TREE: expectedGitTree,
});
const loadSyntheticPolicy = async () => syntheticPolicy;
let accountTargetReadCount = 0;
const loadSyntheticAccountTarget = async ({ expectedAccountIdSha256 }) => {
  accountTargetReadCount += 1;
  equal(expectedAccountIdSha256, syntheticPolicy.staging.accountIdSha256);
  return {
    metadata: { accountIdSha256: expectedAccountIdSha256 },
    accountId,
  };
};
const syntheticAccountTargetMetadataPath = path.join(
  runnerDirectory, 'staging-cloudflare-account-target.json',
);
const unexpectedSpawn = () => { throw new Error('TEST_E_UNEXPECTED_SPAWN'); };

const insideRepositoryClipboard = new MemoryClipboard(apiToken);
let insideRepositoryPolicyReads = 0;
let insideRepositoryAccountReads = 0;
await rejects(() => runCloudflareReadControlPlane({
  argv: ['--command=staging-r2-exposure'],
  environment: validRunnerEnvironment,
  root: process.cwd(),
  clipboard: insideRepositoryClipboard,
  spawnChild: unexpectedSpawn,
  loadPolicy: async () => {
    insideRepositoryPolicyReads += 1;
    return syntheticPolicy;
  },
  loadAccountTarget: async () => {
    insideRepositoryAccountReads += 1;
    return { accountId, metadata: {} };
  },
  accountTargetMetadataPath: path.join(process.cwd(), 'synthetic-account-target.json'),
}), 'CLOUDFLARE_E_ACCOUNT_STORE_LOCATION');
equal(insideRepositoryPolicyReads, 0);
equal(insideRepositoryAccountReads, 0);
equal(insideRepositoryClipboard.preflightCount, 0);
equal(insideRepositoryClipboard.readCount, 0);
equal(insideRepositoryClipboard.value, '');

const invalidOutputClipboard = new MemoryClipboard(apiToken);
await rejects(() => runCloudflareReadControlPlane({
  argv: ['--command=staging-r2-exposure'],
  environment: {
    ...validRunnerEnvironment,
    CLOUDFLARE_R2_EXPOSURE_CAPTURE_PATH: 'relative-capture.json',
  },
  clipboard: invalidOutputClipboard,
  spawnChild: unexpectedSpawn,
  loadPolicy: loadSyntheticPolicy,
  loadAccountTarget: loadSyntheticAccountTarget,
  accountTargetMetadataPath: syntheticAccountTargetMetadataPath,
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
  loadPolicy: loadSyntheticPolicy,
  loadAccountTarget: loadSyntheticAccountTarget,
  accountTargetMetadataPath: syntheticAccountTargetMetadataPath,
}), 'MEDIA_E_R2_CLIPBOARD_PREFLIGHT');
equal(failedPreflightClipboard.preflightCount, 1);
equal(failedPreflightClipboard.readCount, 0);
equal(failedPreflightClipboard.clearCount >= 1, true);
equal(failedPreflightClipboard.value, '');

for (const [environmentOverride, expectedCode] of [
  [{ CF_API_TOKEN: apiToken }, 'CLOUDFLARE_E_CONTROL_TOKEN_AMBIGUOUS'],
  [{ CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) }, 'CLOUDFLARE_E_CONTROL_ACCOUNT_AMBIGUOUS'],
]) {
  const rejectedClipboard = new MemoryClipboard(apiToken);
  await rejects(() => runCloudflareReadControlPlane({
    argv: ['--command=staging-r2-exposure'],
    environment: { ...validRunnerEnvironment, ...environmentOverride },
    clipboard: rejectedClipboard,
    spawnChild: unexpectedSpawn,
    loadPolicy: loadSyntheticPolicy,
    loadAccountTarget: loadSyntheticAccountTarget,
    accountTargetMetadataPath: syntheticAccountTargetMetadataPath,
  }), expectedCode);
  equal(rejectedClipboard.readCount, 0);
  equal(rejectedClipboard.value, '');
}
const wrongPurposeClipboard = new MemoryClipboard(apiToken);
await rejects(() => runCloudflareReadControlPlane({
  argv: ['--command=staging-r2-exposure', `--purpose=${apiToken}`],
  environment: validRunnerEnvironment,
  clipboard: wrongPurposeClipboard,
  spawnChild: unexpectedSpawn,
  loadPolicy: loadSyntheticPolicy,
  loadAccountTarget: loadSyntheticAccountTarget,
  accountTargetMetadataPath: syntheticAccountTargetMetadataPath,
}), 'CLOUDFLARE_E_CONTROL_RUNNER_ARGUMENT');
equal(wrongPurposeClipboard.readCount, 0);
equal(wrongPurposeClipboard.value, '');

const wrongStoredAccountClipboard = new MemoryClipboard(apiToken);
await rejects(() => runCloudflareReadControlPlane({
  argv: ['--command=staging-r2-exposure'],
  environment: validRunnerEnvironment,
  clipboard: wrongStoredAccountClipboard,
  spawnChild: unexpectedSpawn,
  loadPolicy: loadSyntheticPolicy,
  loadAccountTarget: async () => ({ accountId: 'b'.repeat(32), metadata: {} }),
  accountTargetMetadataPath: syntheticAccountTargetMetadataPath,
}), 'CLOUDFLARE_E_ACCOUNT_TARGET');
equal(wrongStoredAccountClipboard.readCount, 0);
equal(wrongStoredAccountClipboard.value, '');

const successfulClipboard = new MemoryClipboard(apiToken);
const writtenFrameChunks = [];
let spawned = null;
const spawnChild = (command, args, options) => {
  const child = new EventEmitter();
  const tokenPipe = new PassThrough();
  tokenPipe.on('data', (chunk) => writtenFrameChunks.push(Buffer.from(chunk)));
  tokenPipe.once('finish', () => queueMicrotask(() => child.emit('close', 0)));
  child.stdio = [null, null, null, tokenPipe];
  child.kill = () => undefined;
  spawned = { command, args, options };
  return child;
};
await runCloudflareReadControlPlane({
  argv: ['--command=staging-r2-exposure'],
  environment: validRunnerEnvironment,
  clipboard: successfulClipboard,
  spawnChild,
  loadPolicy: loadSyntheticPolicy,
  loadAccountTarget: loadSyntheticAccountTarget,
  accountTargetMetadataPath: syntheticAccountTargetMetadataPath,
});
equal(successfulClipboard.readCount, 1);
equal(successfulClipboard.value, '');
equal(spawned.args.some((value) => value.includes(apiToken)), false);
equal(spawned.args.some((value) => value.includes(accountId)), false);
equal(Object.values(spawned.options.env).some((value) => value === apiToken), false);
equal(spawned.options.env.CLOUDFLARE_API_TOKEN_FD, '3');
equal(spawned.options.env.CLOUDFLARE_ACCOUNT_ID, accountId);
equal(accountTargetReadCount, 2);
const capturedFrame = Buffer.concat(writtenFrameChunks);
equal(capturedFrame.includes(Buffer.from(accountId)), false);
let capturedReadCount = 0;
let capturedOffset = 0;
const capturedCredentials = cloudflareControlPlaneReadCredentials({
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN_FD: '3',
}, {
  fstat: () => ({
    isFIFO: () => true, isSocket: () => false, nlink: 0, mode: 0o600, uid: 501, size: 0,
  }),
  getuid: () => 501,
  read: (descriptor, buffer, offset, length) => {
    capturedReadCount += 1;
    if (capturedOffset === capturedFrame.length) return 0;
    const count = Math.min(length, capturedFrame.length - capturedOffset);
    capturedFrame.copy(buffer, offset, capturedOffset, capturedOffset + count);
    capturedOffset += count;
    return count;
  },
});
equal(capturedCredentials.apiToken, apiToken);
equal(capturedReadCount, 2);
capturedFrame.fill(0);

const framedToken = encodeCloudflareControlPlaneTokenFrame(apiToken);
let singleReadCount = 0;
let singleReadOffset = 0;
const syntheticPipeStats = {
  isFIFO: () => true,
  isSocket: () => false,
  nlink: 0,
  mode: 0o600,
  uid: 501,
  size: 0,
};
const singleReadCredentials = cloudflareControlPlaneReadCredentials({
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN_FD: '3',
}, {
  fstat: () => syntheticPipeStats,
  getuid: () => 501,
  read: (descriptor, buffer, offset, length) => {
    equal(descriptor, 3);
    singleReadCount += 1;
    if (singleReadOffset === framedToken.length) return 0;
    const chunkLength = Math.min(
      length,
      singleReadOffset === 0 ? Math.floor(framedToken.length / 2) : framedToken.length,
      framedToken.length - singleReadOffset,
    );
    framedToken.copy(buffer, offset, singleReadOffset, singleReadOffset + chunkLength);
    singleReadOffset += chunkLength;
    return chunkLength;
  },
});
equal(singleReadCredentials.apiToken, apiToken);
equal(singleReadCount, 3);
const trailingFrame = Buffer.concat([framedToken, Buffer.from([0])]);
let trailingOffset = 0;
assert.throws(() => cloudflareControlPlaneReadCredentials({
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN_FD: '3',
}, {
  fstat: () => syntheticPipeStats,
  getuid: () => 501,
  read: (descriptor, buffer, offset, length) => {
    const count = Math.min(
      length,
      trailingOffset === 0 ? framedToken.length : 1,
      trailingFrame.length - trailingOffset,
    );
    trailingFrame.copy(buffer, offset, trailingOffset, trailingOffset + count);
    trailingOffset += count;
    return count;
  },
}), /CLOUDFLARE_E_CONTROL_TOKEN_FD/u);
assertions += 1;
equal(trailingOffset, trailingFrame.length);
framedToken.fill(0);
trailingFrame.fill(0);

function readSyntheticFrame(candidate) {
  let offset = 0;
  return () => cloudflareControlPlaneReadCredentials({
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN_FD: '3',
  }, {
    fstat: () => syntheticPipeStats,
    getuid: () => 501,
    read: (descriptor, buffer, bufferOffset, length) => {
      if (offset === candidate.length) return 0;
      const count = Math.min(length, candidate.length - offset);
      candidate.copy(buffer, bufferOffset, offset, offset + count);
      offset += count;
      return count;
    },
  });
}

const lengthMismatchFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
lengthMismatchFrame.writeUInt16BE(
  lengthMismatchFrame.readUInt16BE(8) + 1,
  8,
);
assert.throws(readSyntheticFrame(lengthMismatchFrame), /CLOUDFLARE_E_CONTROL_TOKEN_FD/u);
assertions += 1;
lengthMismatchFrame.fill(0);

const digestMismatchFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
digestMismatchFrame[digestMismatchFrame.length - 1] ^= 0xff;
assert.throws(readSyntheticFrame(digestMismatchFrame), /CLOUDFLARE_E_CONTROL_TOKEN_FD/u);
assertions += 1;
digestMismatchFrame.fill(0);

const maximumFrame = encodeCloudflareControlPlaneTokenFrame('a'.repeat(256));
const oversizedFrame = Buffer.concat([maximumFrame, Buffer.from([0])]);
assert.throws(readSyntheticFrame(oversizedFrame), /CLOUDFLARE_E_CONTROL_TOKEN_FD/u);
assertions += 1;
maximumFrame.fill(0);
oversizedFrame.fill(0);

async function runReader({
  token = apiToken, frame = null, environment = {}, diskFd = null, delayedSplitAt = null,
} = {}) {
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
    const input = frame ?? encodeCloudflareControlPlaneTokenFrame(token);
    if (delayedSplitAt === null) child.stdio[3].end(input);
    else {
      child.stdio[3].write(input.subarray(0, delayedSplitAt));
      await new Promise((resolve) => setTimeout(resolve, 100));
      child.stdio[3].end(input.subarray(delayedSplitAt));
    }
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

const delayedFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
const delayedAccepted = await runReader({
  frame: delayedFrame,
  delayedSplitAt: Math.floor(delayedFrame.length / 2),
});
equal(delayedAccepted.code, 0);
delayedFrame.fill(0);

const completeFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
const delayedTrailingFrame = Buffer.concat([completeFrame, Buffer.from([0])]);
const delayedTrailing = await runReader({
  frame: delayedTrailingFrame,
  delayedSplitAt: completeFrame.length,
});
equal(delayedTrailing.code, 1);
equal(delayedTrailing.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');
completeFrame.fill(0);
delayedTrailingFrame.fill(0);

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

const newline = await runReader({ frame: Buffer.from(`${apiToken}\n`) });
equal(newline.code, 1);
equal(newline.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');

const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dwnc-control-token-test-')));
await chmod(directory, 0o700);
try {
  const file = path.join(directory, 'token');
  const handle = await open(file, 'wx+', 0o600);
  try {
    const diskFrame = encodeCloudflareControlPlaneTokenFrame(apiToken);
    await handle.writeFile(diskFrame);
    diskFrame.fill(0);
    await handle.sync();
    await unlink(file);
    const diskBacked = await runReader({ diskFd: handle.fd });
    equal(diskBacked.code, 1);
    equal(diskBacked.stderr.trim(), 'CLOUDFLARE_E_CONTROL_TOKEN_FD');
  } finally { await handle.close(); }
} finally { await rm(directory, { recursive: true, force: true }); }

await rm(runnerDirectory, { recursive: true, force: true });

console.log(JSON.stringify({
  suite: 'cloudflare-control-plane-sealed-fd-auth',
  assertions,
  tokenEnvironmentAccepted: false,
  diskBackedTokenAccepted: false,
  realTokenCalls: 0,
  liveNetworkCalls: 0,
  status: 'PASS',
}, null, 2));
