import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
  publicMediaEntryManifestSha256,
  validateConfiguredReleaseTarget,
} from './lib/public-media-manifest.mjs';
import {
  admitOneStagingPublicMediaObject,
  loadLocalMediaBytes,
} from './lib/public-media-remote.mjs';
import {
  r2ClientContextFromEnvironment,
} from './lib/r2-s3-client.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('media-r2-staging-object-admission');

function parseArguments(argv) {
  const options = { key: null, expectedManifestSha256: null, receiptOutput: null };
  for (const argument of argv) {
    const [name, value] = argument.split('=', 2);
    if (!value || !['--key', '--expected-manifest-sha256', '--receipt-output'].includes(name)) {
      throw new Error('MEDIA_E_STAGING_ADMISSION_ARGUMENT');
    }
    const property = name === '--key' ? 'key'
      : name === '--expected-manifest-sha256' ? 'expectedManifestSha256' : 'receiptOutput';
    if (options[property] !== null) throw new Error('MEDIA_E_STAGING_ADMISSION_ARGUMENT');
    options[property] = value;
  }
  if (typeof options.key !== 'string' || !/^media\/[A-Za-z0-9._/-]+$/u.test(options.key)
    || options.key.includes('//') || options.key.includes('..') || options.key.includes('\\')
    || !/^[a-f0-9]{64}$/u.test(options.expectedManifestSha256 ?? '')
    || typeof options.receiptOutput !== 'string' || !path.isAbsolute(options.receiptOutput)) {
    throw new Error('MEDIA_E_STAGING_ADMISSION_ARGUMENT');
  }
  const relative = path.relative(ROOT, options.receiptOutput);
  if (relative === '' || relative === '..' || !relative.startsWith(`..${path.sep}`)) {
    throw new Error('MEDIA_E_STAGING_ADMISSION_OUTPUT');
  }
  return options;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function inspectSecureOutput(outputPath, expected = null) {
  const parentPath = path.dirname(outputPath);
  const repositoryRealPath = await realpath(ROOT);
  const parentRealPath = await realpath(parentPath);
  const parent = await lstat(parentPath);
  const confirmedParentRealPath = await realpath(parentPath);
  const canonicalOutputPath = path.join(parentRealPath, path.basename(outputPath));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700
    || parentRealPath !== confirmedParentRealPath
    || isWithin(repositoryRealPath, canonicalOutputPath)
    || expected && (repositoryRealPath !== expected.repositoryRealPath
      || parentRealPath !== expected.parentRealPath
      || parent.dev !== expected.parentDev || parent.ino !== expected.parentIno
      || (parent.mode & 0o777) !== expected.parentMode)) {
    throw new Error('MEDIA_E_STAGING_ADMISSION_OUTPUT');
  }
  try {
    await lstat(outputPath);
    throw new Error('MEDIA_E_STAGING_ADMISSION_OUTPUT_EXISTS');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return {
    repositoryRealPath,
    parentRealPath,
    parentDev: parent.dev,
    parentIno: parent.ino,
    parentMode: parent.mode & 0o777,
  };
}

async function assertSecureOutputWritten(outputPath, expected) {
  const parentPath = path.dirname(outputPath);
  const [repositoryRealPath, parentRealPath, parent, output] = await Promise.all([
    realpath(ROOT), realpath(parentPath), lstat(parentPath), lstat(outputPath),
  ]);
  if (repositoryRealPath !== expected.repositoryRealPath
    || parentRealPath !== expected.parentRealPath
    || parent.dev !== expected.parentDev || parent.ino !== expected.parentIno
    || !parent.isDirectory() || parent.isSymbolicLink()
    || (parent.mode & 0o777) !== 0o700
    || !output.isFile() || output.isSymbolicLink() || output.nlink !== 1
    || (output.mode & 0o777) !== 0o600) {
    throw new Error('MEDIA_E_STAGING_ADMISSION_OUTPUT');
  }
}

const options = parseArguments(process.argv.slice(2));
const initialOutputIdentity = await inspectSecureOutput(options.receiptOutput);
const { credentials: r2Credentials, client } = r2ClientContextFromEnvironment(process.env);
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
  accountId: r2Credentials.accountId,
  bucket: r2Credentials.bucket,
  wranglerConfig,
});
const members = manifest.entries.filter((entry) => entry.key === options.key);
if (members.length !== 1) throw new Error('MEDIA_E_STAGING_ADMISSION_MANIFEST_MEMBER');
const entry = members[0];
const admitted = await admitOneStagingPublicMediaObject(
  client,
  entry,
  (selected) => loadLocalMediaBytes(ROOT, selected),
);
const receipt = {
  schemaVersion: 1,
  contract: 'dwnc-public-media-r2-staging-object-admission-v1',
  environment: 'staging',
  accountIdSha256: target.accountIdSha256,
  bucket: target.bucket,
  manifestSha256: manifest.manifestSha256,
  manifestEntrySha256: publicMediaEntryManifestSha256(entry),
  key: entry.key,
  size: entry.size,
  sha256: entry.sha256,
  contentType: entry.contentType,
  cacheControl: entry.cacheControl,
  outcome: admitted.outcome,
  putAttempted: admitted.putAttempted,
  created: admitted.created,
  preconditionRaced: admitted.preconditionRaced,
  preHeadExact: admitted.preHeadExact,
  postHeadExact: true,
  fullGetBodyBytes: admitted.full.bodyBytes,
  fullGetBodySha256: admitted.full.bodySha256,
  platformChecksumSha256: admitted.full.platformChecksumSha256,
  version: admitted.full.version,
  httpEtag: admitted.full.httpEtag,
  lastModified: admitted.full.lastModified,
  verifiedAt: new Date().toISOString(),
};
const prewriteOutputIdentity = await inspectSecureOutput(
  options.receiptOutput, initialOutputIdentity,
);
await writeFile(options.receiptOutput, `${canonicalJson(receipt)}\n`, {
  flag: 'wx', mode: 0o600,
});
await assertSecureOutputWritten(options.receiptOutput, prewriteOutputIdentity);
console.log(JSON.stringify({
  contract: receipt.contract,
  environment: receipt.environment,
  manifestSha256: receipt.manifestSha256,
  manifestEntrySha256: receipt.manifestEntrySha256,
  keySha256: sha256Hex(receipt.key),
  outcome: receipt.outcome,
  putAttempted: receipt.putAttempted,
  created: receipt.created,
  preconditionRaced: receipt.preconditionRaced,
  postHeadExact: true,
  fullGetSha256Verified: true,
  credentialPrinted: false,
  endpointPrinted: false,
  bodyPrinted: false,
}, null, 2));
