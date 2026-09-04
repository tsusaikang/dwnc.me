import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  appendFile, chmod, link, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCloudflareStagingBootstrapAuthorization }
  from './lib/cloudflare-bootstrap-authorization.mjs';
import {
  accountWorkersDevSubdomainRequestSha256,
  canonicalAccountWorkersDevSubdomainEvidencePayload,
  canonicalServiceExistenceEvidencePayload,
  EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  serviceExistenceRequestSha256,
  validateBootstrapAuthorization,
} from './lib/cloudflare-bootstrap.mjs';
import { canonicalJson, sha256Hex } from './lib/cloudflare-release.mjs';
import { publicKeySpkiSha256 } from './lib/public-media-manifest.mjs';
import { writeCanonicalEvidenceCreateOnly } from './lib/cloudflare-signing-key.mjs';
import { createCloudflareStagingBootstrapAuthorizationCommand }
  from './create-cloudflare-staging-bootstrap-authorization.mjs';

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = async (operation, pattern) => {
  await assert.rejects(operation, pattern); assertions += 1;
};

const repositoryRoot = process.cwd();
const accountIdSha256 = sha256Hex('synthetic-account-fingerprint');
const rawAccountSentinel = 'a'.repeat(32);
const rawTokenSentinel = `cfat_${'S'.repeat(40)}${'0'.repeat(8)}`;
const nowIso = '2026-09-04T02:00:00.000Z';
const observedIso = '2026-09-04T01:59:00.000Z';
const expiresIso = '2026-09-04T02:04:00.000Z';
const snapshot = Object.freeze({
  commit: '1'.repeat(40), tree: '2'.repeat(40), clean: true,
});
const serviceReceipt = Object.freeze({
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-service-existence-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  exists: false,
  httpStatus: 404,
  rawEvidenceSha256: sha256Hex('service-absence-response'),
  requestStartedAt: '2026-09-04T01:58:59.000Z',
  requestCompletedAt: observedIso,
  observedAt: observedIso,
  expiresAt: expiresIso,
});
const subdomainReceipt = Object.freeze({
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-account-workers-dev-subdomain-v1',
  environment: 'staging',
  workerName: 'dwnc-me-staging',
  accountIdSha256,
  accountSubdomain: EXPECTED_ACCOUNT_WORKERS_DEV_SUBDOMAIN,
  origin: 'https://dwnc-me-staging.dwnc.workers.dev',
  rawEvidenceSha256: sha256Hex('account-subdomain-response'),
  requestStartedAt: '2026-09-04T01:58:59.100Z',
  requestCompletedAt: '2026-09-04T01:59:00.100Z',
  observedAt: '2026-09-04T01:59:00.100Z',
  expiresAt: '2026-09-04T02:04:00.100Z',
});
const keyPair = generateKeyPairSync('ed25519');
const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const releasePublicKeySpkiSha256 = publicKeySpkiSha256(publicKeyPem);
const signed = (receipt, canonicalPayload) => ({
  receipt,
  signature: sign(null, Buffer.from(canonicalPayload(receipt)), keyPair.privateKey),
  publicKeyPem,
});
const serviceSigned = signed(serviceReceipt, canonicalServiceExistenceEvidencePayload);
const subdomainSigned = signed(
  subdomainReceipt, canonicalAccountWorkersDevSubdomainEvidencePayload,
);
const paths = (root, prefix) => ({
  receiptPath: path.join(root, `${prefix}.json`),
  signaturePath: path.join(root, `${prefix}.sig`),
  publicKeyPath: path.join(root, `${prefix}.pem`),
});

const temporary = await realpath(
  await mkdtemp(path.join(os.tmpdir(), 'dwnc-bootstrap-auth-test-')),
);
await chmod(temporary, 0o700);
try {
  const servicePaths = paths(temporary, 'service');
  const subdomainPaths = paths(temporary, 'subdomain');
  let externalCalls = 0;
  let keychainCalls = 0;
  const base = (outputPath, overrides = {}) => {
    const nonce = Buffer.alloc(32, 7);
    const selectedService = overrides.serviceSigned ?? serviceSigned;
    const selectedSubdomain = overrides.subdomainSigned ?? subdomainSigned;
    let gitIndex = 0;
    const gitValues = overrides.gitValues ?? [snapshot, snapshot, snapshot];
    return {
      arguments: {
        repositoryRoot,
        serviceEvidencePaths: servicePaths,
        accountSubdomainEvidencePaths: subdomainPaths,
        outputPath,
        loadPolicy: async () => ({ staging: {
          environment: 'staging', bucket: 'dwnc-me-public-media-staging',
          accountIdSha256,
          releasePublicKeySpkiSha256:
            overrides.releasePublicKeySpkiSha256 ?? releasePublicKeySpkiSha256,
        } }),
        loadSignedFiles: async (selected) => selected.receiptPath === servicePaths.receiptPath
          ? selectedService : selectedSubdomain,
        inspectGit: async () => gitValues[Math.min(gitIndex++, gitValues.length - 1)],
        now: () => overrides.now ?? new Date(nowIso),
        randomUUIDImpl: () => overrides.uuid ?? '12345678-1234-4234-8234-123456789abc',
        randomBytesImpl: () => overrides.randomBytes ?? nonce,
        ...(overrides.dependencies ?? {}),
      },
      nonce,
      sideEffects: () => ({ externalCalls, keychainCalls }),
      bumpExternal: () => { externalCalls += 1; },
      bumpKeychain: () => { keychainCalls += 1; },
    };
  };

  const output = path.join(temporary, 'authorization.json');
  const positive = base(output);
  const summary = await createCloudflareStagingBootstrapAuthorization(positive.arguments);
  equal(summary.contract, 'dwnc-cloudflare-bootstrap-authorization-v1');
  equal(summary.environment, 'staging');
  equal(summary.workerName, 'dwnc-me-staging');
  equal(summary.sourceGitSha, snapshot.commit);
  equal(summary.candidateWritten, true);
  equal(summary.signed, false);
  equal(summary.rawAccountPrinted, false);
  equal(summary.rawTokenPrinted, false);
  equal(positive.nonce.every((value) => value === 0), true);
  equal(positive.sideEffects(), { externalCalls: 0, keychainCalls: 0 });
  const stored = await readFile(output, 'utf8');
  const storedStats = await lstat(output);
  const candidate = JSON.parse(stored);
  equal(stored, `${canonicalJson(candidate)}\n`);
  equal(storedStats.mode & 0o777, 0o600);
  equal(storedStats.nlink, 1);
  equal(Object.keys(candidate).length, 21);
  equal(candidate.sourceGitSha, snapshot.commit);
  equal(candidate.serviceEvidenceSha256,
    sha256Hex(canonicalServiceExistenceEvidencePayload(serviceReceipt)));
  equal(candidate.accountSubdomainEvidenceSha256,
    sha256Hex(canonicalAccountWorkersDevSubdomainEvidencePayload(subdomainReceipt)));
  equal(candidate.freshAbsenceRequestSha256, serviceExistenceRequestSha256(candidate));
  equal(candidate.freshAccountSubdomainRequestSha256,
    accountWorkersDevSubdomainRequestSha256(candidate));
  equal(candidate.maxFreshAbsenceAgeSeconds, 15);
  equal(candidate.maxFreshAccountSubdomainAgeSeconds, 15);
  equal(Date.parse(candidate.expiresAt) - Date.parse(candidate.createdAt), 5 * 60 * 1000);
  equal(validateBootstrapAuthorization(candidate, { now: new Date(nowIso) }), candidate);
  equal(stored.includes(rawAccountSentinel), false);
  equal(stored.includes(rawTokenSentinel), false);
  equal(JSON.stringify(summary).includes(rawAccountSentinel), false);
  equal(JSON.stringify(summary).includes(rawTokenSentinel), false);

  const runFailure = async (name, overrides, pattern) => {
    const fixture = base(path.join(temporary, `${name}.json`), overrides);
    await rejects(
      () => createCloudflareStagingBootstrapAuthorization(fixture.arguments), pattern,
    );
  };
  const resignService = (receipt) => signed(receipt, canonicalServiceExistenceEvidencePayload);
  const resignSubdomain = (receipt) => signed(
    receipt, canonicalAccountWorkersDevSubdomainEvidencePayload,
  );
  await runFailure('exists', {
    serviceSigned: resignService({ ...serviceReceipt, exists: true, httpStatus: 200 }),
  }, /CLOUDFLARE_E_SERVICE_EXISTENCE_EXPECTED/u);
  await runFailure('expired', {
    serviceSigned: resignService({
      ...serviceReceipt, observedAt: '2026-09-04T01:50:00.000Z',
      requestCompletedAt: '2026-09-04T01:50:00.000Z', expiresAt: '2026-09-04T01:55:00.000Z',
    }),
  }, /CLOUDFLARE_E_SERVICE_EXISTENCE_EXPIRED/u);
  await runFailure('wrong-account', {
    serviceSigned: resignService({ ...serviceReceipt, accountIdSha256: 'f'.repeat(64) }),
  }, /CLOUDFLARE_E_SERVICE_EXISTENCE_EXPECTED/u);
  await runFailure('wrong-subdomain', {
    subdomainSigned: resignSubdomain({
      ...subdomainReceipt, accountSubdomain: 'wrong',
      origin: 'https://dwnc-me-staging.wrong.workers.dev',
    }),
  }, /CLOUDFLARE_E_ACCOUNT_SUBDOMAIN/u);
  const invalidSignature = Buffer.from(serviceSigned.signature);
  invalidSignature[0] ^= 0xff;
  await runFailure('signature', {
    serviceSigned: { ...serviceSigned, signature: invalidSignature },
  }, /CLOUDFLARE_E_RELEASE_SIGNATURE/u);
  await runFailure('wrong-release-key', {
    releasePublicKeySpkiSha256: 'f'.repeat(64),
  }, /CLOUDFLARE_E_RELEASE_SIGNATURE/u);
  await runFailure('dirty', {
    gitValues: [{ ...snapshot, clean: false }],
  }, /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_GIT/u);
  await runFailure('head-drift', {
    gitValues: [snapshot, { ...snapshot, commit: '3'.repeat(40) }],
  }, /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_GIT/u);
  await runFailure('tree-drift', {
    gitValues: [snapshot, { ...snapshot, tree: '4'.repeat(40) }],
  }, /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_GIT/u);
  await runFailure('final-head-drift', {
    gitValues: [snapshot, snapshot, { ...snapshot, commit: '3'.repeat(40) }],
  }, /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_GIT/u);
  await runFailure('bad-time', { now: new Date('invalid') },
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_TIME/u);
  await runFailure('bad-uuid', { uuid: 'not-a-uuid' },
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_RANDOM/u);
  const shortRandom = Buffer.alloc(31, 7);
  await runFailure('bad-random', { randomBytes: shortRandom },
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_RANDOM/u);
  equal(shortRandom.every((value) => value === 0), true);

  const existing = path.join(temporary, 'existing.json');
  await writeFile(existing, '{}\n', { mode: 0o600 });
  await rejects(() => createCloudflareStagingBootstrapAuthorization(
    base(path.join(repositoryRoot, 'authorization.json')).arguments,
  ), /CLOUDFLARE_E_ACCOUNT_STORE_LOCATION/u);
  await rejects(() => createCloudflareStagingBootstrapAuthorization(base(existing).arguments),
    /CLOUDFLARE_E_SIGNING_FILE_EXISTS/u);
  const symlinkOutput = path.join(temporary, 'symlink.json');
  await symlink(existing, symlinkOutput);
  await rejects(() => createCloudflareStagingBootstrapAuthorization(base(symlinkOutput).arguments),
    /CLOUDFLARE_E_ACCOUNT_STORE_LOCATION|CLOUDFLARE_E_SIGNING_FILE/u);
  const hardlinkOutput = path.join(temporary, 'hardlink.json');
  await link(existing, hardlinkOutput);
  await rejects(() => createCloudflareStagingBootstrapAuthorization(base(hardlinkOutput).arguments),
    /CLOUDFLARE_E_SIGNING_FILE_EXISTS/u);

  const racedOutput = path.join(temporary, 'raced.json');
  const raced = base(racedOutput, { dependencies: {
    writeCandidate: async (...args) => {
      await writeCanonicalEvidenceCreateOnly(...args);
      await appendFile(racedOutput, 'drift');
    },
  } });
  await rejects(() => createCloudflareStagingBootstrapAuthorization(raced.arguments),
    /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_OUTPUT/u);

  const cliPaths = [...Object.values(servicePaths), ...Object.values(subdomainPaths),
    path.join(temporary, 'cli-output.json')];
  let cliObserved;
  const cliSummary = await createCloudflareStagingBootstrapAuthorizationCommand({
    root: repositoryRoot,
    argv: [
      `--service-receipt=${cliPaths[0]}`,
      `--service-signature=${cliPaths[1]}`,
      `--service-public-key=${cliPaths[2]}`,
      `--subdomain-receipt=${cliPaths[3]}`,
      `--subdomain-signature=${cliPaths[4]}`,
      `--subdomain-public-key=${cliPaths[5]}`,
      `--output=${cliPaths[6]}`,
    ],
    createAuthorization: async (value) => {
      cliObserved = value;
      return { status: 'fixed' };
    },
  });
  equal(cliSummary, { status: 'fixed' });
  equal(cliObserved.repositoryRoot, repositoryRoot);
  equal(cliObserved.outputPath, cliPaths[6]);
  equal(cliObserved.serviceEvidencePaths.receiptPath, cliPaths[0]);
  equal(cliObserved.accountSubdomainEvidencePaths.publicKeyPath, cliPaths[5]);
  await rejects(() => createCloudflareStagingBootstrapAuthorizationCommand({
    root: repositoryRoot, argv: ['--output=relative'], createAuthorization: async () => ({}),
  }), /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_ARGUMENT/u);
  await rejects(() => createCloudflareStagingBootstrapAuthorizationCommand({
    root: repositoryRoot,
    argv: cliPaths.map((value, index) => `--${[
      'service-receipt', 'service-signature', 'service-public-key',
      'subdomain-receipt', 'subdomain-signature', 'subdomain-public-key', 'output',
    ][index]}=${value}`).concat(`--output=${cliPaths[6]}`),
    createAuthorization: async () => ({}),
  }), /CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_ARGUMENT/u);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({
  suite: 'cloudflare-bootstrap-authorization-creator',
  assertions,
  liveNetworkCalls: 0,
  realKeychainCalls: 0,
  realClipboardCalls: 0,
  rawAccountPrinted: false,
  rawTokenPrinted: false,
  status: 'PASS',
}, null, 2));
