import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  canonicalBootstrapRecoveryChildResult,
  recoverBootstrapStatusCore,
} from './lib/cloudflare-bootstrap-recovery.mjs';
import { loadBootstrapRecoveryLocalContext }
  from './lib/cloudflare-bootstrap-recovery-context.mjs';
import { assertCloudflareAccountTargetOutsideRepository }
  from './lib/cloudflare-account-target.mjs';
import { readCloudflareStagingControlOperation }
  from './lib/cloudflare-staging-control-operation.mjs';
import {
  assertStagingControlOperationEnvelope,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import {
  assertSecureCreateOnlyDestination,
  readSecureFile,
  writeCanonicalEvidenceCreateOnly,
} from './lib/cloudflare-signing-key.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-deny-bootstrap-recovery');
if (process.argv.length !== 3 || process.argv[2] !== '--environment=staging') {
  throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_ARGUMENT');
}
assertStagingControlOperationEnvelope(process.env, 'staging-bootstrap-recover');
if (process.env.CLOUDFLARE_DENY_BOOTSTRAP_RECOVERY_APPROVED
  !== 'staging:dwnc-me-staging:status-only') {
  throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_APPROVAL');
}
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_RECOVERY_PATH');
  }
  return value;
};
for (const name of [
  'CLOUDFLARE_SERVICE_EXISTENCE_RECEIPT_PATH',
  'CLOUDFLARE_SERVICE_EXISTENCE_SIGNATURE_PATH',
  'CLOUDFLARE_SERVICE_EXISTENCE_PUBLIC_KEY_PATH',
  'CLOUDFLARE_ACCOUNT_SUBDOMAIN_RECEIPT_PATH',
  'CLOUDFLARE_ACCOUNT_SUBDOMAIN_SIGNATURE_PATH',
  'CLOUDFLARE_ACCOUNT_SUBDOMAIN_PUBLIC_KEY_PATH',
  'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_RECEIPT_PATH',
  'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_SIGNATURE_PATH',
  'CLOUDFLARE_BOOTSTRAP_AUTHORIZATION_PUBLIC_KEY_PATH',
]) absolute(process.env[name]);
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const recoveryHome = userInfo().homedir;
const context = await loadBootstrapRecoveryLocalContext({
  repositoryRoot: ROOT, source: process.env, policy, home: recoveryHome,
});
const inspectGit = async (repositoryRoot) => {
  const run = async (args) => (await promisify(execFile)('git', args, {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  })).stdout.trim();
  const [commit, tree, status] = await Promise.all([
    run(['rev-parse', 'HEAD']), run(['rev-parse', 'HEAD^{tree}']),
    run(['status', '--porcelain=v1', '--untracked-files=normal']),
  ]);
  return { commit, tree, clean: status.length === 0 };
};
const operation = readCloudflareStagingControlOperation(
  process.env, 'staging-bootstrap-recover',
);
try {
  const envelope = operation.envelope;
  const recovered = await recoverBootstrapStatusCore({
    ...context.plan,
    controlPlane: {
      accountId: operation.accountId,
      apiToken: operation.apiToken,
      envelope: {
        operation: 'staging-bootstrap-recover',
        accountIdSha256: context.plan.targetAccountIdSha256,
        metadataSha256: envelope.metadataSha256,
        preflightSha256: envelope.preflightSha256,
        permissionContractSha256: envelope.permissionContractSha256,
        authenticationRequestCounts: envelope.authenticationRequestCounts,
      },
    },
  }, context.paths, {
    fetchImpl: globalThis.fetch,
    now: () => new Date(),
    userHome: recoveryHome,
    inspectGit,
    lstat,
    readSecureFile,
    writeCanonicalEvidenceCreateOnly,
    assertOutsideRepository: assertCloudflareAccountTargetOutsideRepository,
    assertSecureCreateOnlyDestination,
  });
  console.log(canonicalBootstrapRecoveryChildResult({
    schemaVersion: 1,
    contract: 'dwnc-cloudflare-deny-bootstrap-recovery-result-v1',
    classification: recovered.status.classification,
    versionId: recovered.status.observationB.versionId,
    deploymentId: recovered.status.observationB.deploymentId,
    existing: recovered.existing,
    recordedRequestCounts: recovered.status.requestCounts,
    currentStateRequestCounts: recovered.currentStateRequestCounts,
  }));
} finally { operation.clear(); }
