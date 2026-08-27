import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { sha256Hex } from './lib/cloudflare-release.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  validateConfiguredReleaseTarget,
} from './lib/public-media-manifest.mjs';
import {
  createOneObjectValidationReceipt,
  validateOneRemotePublicMediaObject,
} from './lib/public-media-remote.mjs';
import { r2ClientContextFromEnvironment } from './lib/r2-s3-client.mjs';
import {
  assertSecureCreateOnlyDestination,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';

const ROOT = process.cwd();
const execFileAsync = promisify(execFile);
installStructuredErrorHandler('media-r2-staging-one-object-validation');

function parseArguments(argv) {
  const options = {
    key: null,
    expectedManifestSha256: null,
    expectedGitSha: null,
    receiptOutput: null,
  };
  const properties = Object.freeze({
    '--key': 'key',
    '--expected-manifest-sha256': 'expectedManifestSha256',
    '--expected-git-sha': 'expectedGitSha',
    '--receipt-output': 'receiptOutput',
  });
  const seen = new Set();
  for (const argument of argv) {
    const separator = argument.indexOf('=');
    const name = separator > 0 ? argument.slice(0, separator) : argument;
    const value = separator > 0 ? argument.slice(separator + 1) : '';
    const property = properties[name];
    if (!property || !value || seen.has(name)) throw new Error('MEDIA_E_R2_ONE_OBJECT_ARGUMENT');
    seen.add(name);
    options[property] = value;
  }
  const relativeOutput = typeof options.receiptOutput === 'string'
    ? path.relative(ROOT, options.receiptOutput) : null;
  if (typeof options.key !== 'string' || !/^media\/[A-Za-z0-9._/-]+$/u.test(options.key)
    || options.key.includes('//') || options.key.includes('..') || options.key.includes('\\')
    || !/^[a-f0-9]{64}$/u.test(options.expectedManifestSha256 ?? '')
    || !/^[a-f0-9]{40}$/u.test(options.expectedGitSha ?? '')
    || typeof options.receiptOutput !== 'string' || !path.isAbsolute(options.receiptOutput)
    || path.resolve(options.receiptOutput) !== options.receiptOutput
    || relativeOutput === '' || relativeOutput === '..'
    || !relativeOutput.startsWith(`..${path.sep}`)) {
    throw new Error('MEDIA_E_R2_ONE_OBJECT_ARGUMENT');
  }
  return options;
}

function requestDelta(before, after) {
  const methods = ['HEAD', 'GET', 'PUT', 'DELETE'];
  const delta = Object.fromEntries(methods.map((method) => [method, after[method] - before[method]]));
  if (methods.some((method) => !Number.isSafeInteger(delta[method]) || delta[method] < 0)
    || delta.HEAD !== 1 || delta.GET !== 1 || delta.PUT !== 0 || delta.DELETE !== 0) {
    throw new Error('MEDIA_E_R2_ONE_OBJECT_METHODS');
  }
  return delta;
}

async function assertExactCleanGit(expectedGitSha) {
  const firstHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024,
  })).stdout.trim();
  const status = (await execFileAsync(
    'git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024,
    },
  )).stdout;
  const secondHead = (await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024,
  })).stdout.trim();
  if (firstHead !== expectedGitSha || secondHead !== expectedGitSha
    || firstHead !== secondHead || status !== '') {
    throw new Error('MEDIA_E_R2_ONE_OBJECT_GIT');
  }
  return expectedGitSha;
}

const options = parseArguments(process.argv.slice(2));
if (process.env.R2_RUNNER_ENVIRONMENT !== 'staging'
  || process.env.R2_RUNNER_ROLE !== 'validator') {
  throw new Error('MEDIA_E_R2_ONE_OBJECT_ROLE');
}
await assertSecureCreateOnlyDestination(options.receiptOutput);
const gitCommitSha = await assertExactCleanGit(options.expectedGitSha);
const { credentials, client } = r2ClientContextFromEnvironment(process.env, { maxAttempts: 1 });
const [manifest, policy, wranglerConfig] = await Promise.all([
  loadTrackedPublicMediaManifest(ROOT),
  loadTrackedPublicMediaReleasePolicy(ROOT),
  readFile(path.join(ROOT, 'wrangler.jsonc'), 'utf8').then(JSON.parse),
]);
if (manifest.manifestSha256 !== options.expectedManifestSha256) {
  throw new Error('MEDIA_E_EXPECTED_MANIFEST');
}
const target = validateConfiguredReleaseTarget({
  policy,
  environment: 'staging',
  accountId: credentials.accountId,
  bucket: credentials.bucket,
  wranglerConfig,
});
const members = manifest.entries.filter((entry) => entry.key === options.key);
if (members.length !== 1) throw new Error('MEDIA_E_R2_ONE_OBJECT_MANIFEST_MEMBER');
const entry = members[0];
const requestCountsBefore = client.requestMethodCounts();
const validation = await validateOneRemotePublicMediaObject(client, entry);
const requestMethods = requestDelta(requestCountsBefore, client.requestMethodCounts());
await assertExactCleanGit(gitCommitSha);
const receipt = createOneObjectValidationReceipt(manifest, entry, validation, {
  target: {
    environment: 'staging',
    accountIdSha256: target.accountIdSha256,
    bucket: target.bucket,
  },
  gitCommitSha,
  requestMethods,
});
await assertExactCleanGit(gitCommitSha);
await writeCanonicalEvidenceCreateOnly(options.receiptOutput, receipt);
console.log(JSON.stringify({
  mode: 'read-only-single-object-validation',
  environment: receipt.environment,
  credentialRole: receipt.credentialRole,
  gitCommitSha: receipt.gitCommitSha,
  manifestSha256: receipt.manifestSha256,
  manifestEntrySha256: receipt.manifestEntrySha256,
  keySha256: sha256Hex(receipt.key),
  headExact: receipt.headExact,
  fullGetSha256Verified: true,
  sameGeneration: receipt.sameGeneration,
  requestMethods: receipt.requestMethods,
  receiptWritten: true,
  overwrite: 0,
  delete: 0,
  credentialPrinted: false,
  endpointPrinted: false,
  bodyPrinted: false,
}, null, 2));
