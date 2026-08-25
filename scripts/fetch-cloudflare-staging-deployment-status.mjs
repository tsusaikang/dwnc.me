import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateStagingUploadArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import { canonicalJson, createDeploymentStatusEvidence, sha256Hex } from './lib/cloudflare-release.mjs';
import {
  assertCloudflareAccountTarget,
  assertPinnedWranglerInstalled,
  cloudflareUploadEnvironment,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-staging-status-fetch');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_STATUS_PATH');
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const outputPath = absolute(process.env.CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_EVIDENCE_PATH);
const targetVersionId = process.env.CLOUDFLARE_STAGING_EXPECTED_DEPLOYMENT_VERSION_ID;
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT);
const { receipt: artifact } = await validateStagingUploadArtifactDirectory(
  artifactDirectory,
  async () => ({ policy, manifest: await loadTrackedPublicMediaManifest(ROOT) }),
);
assertCloudflareAccountTarget(process.env.CLOUDFLARE_ACCOUNT_ID, artifact.stagingAccountIdSha256);
if (policy.staging.accountIdSha256 !== artifact.stagingAccountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
await assertPinnedWranglerInstalled(ROOT);
const args = ['deployments', 'status', '--json', '--env', 'staging', '--config',
  path.join(artifactDirectory, 'wrangler-staging-upload.jsonc'),
  '--env-file', path.join(artifactDirectory, 'wrangler-empty.env')];
const startedAt = new Date().toISOString();
let stdout;
try {
  ({ stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60000,
    env: cloudflareUploadEnvironment(process.env, {
      CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
      WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
    }),
  }));
} catch { throw new Error('CLOUDFLARE_E_STATUS_FETCH'); }
let rawStatus;
try { rawStatus = JSON.parse(stdout); }
catch { throw new Error('CLOUDFLARE_E_STATUS_JSON'); }
const observedAt = new Date().toISOString();
const evidence = createDeploymentStatusEvidence({
  rawStatus, targetVersionId, observedAt,
  environment: 'staging', workerName: 'dwnc-me-staging',
});
const capture = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-deployment-status-capture-v1',
  commandSha256: sha256Hex(canonicalJson(args)),
  rawStdoutSha256: sha256Hex(stdout),
  rawStdout: stdout,
  startedAt,
  completedAt: observedAt,
  evidence,
  rawStatus,
};
await writeFile(outputPath, `${canonicalJson(capture)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  contract: capture.contract, targetVersionId, deploymentId: evidence.deploymentId,
  environment: 'staging', traffic: '100%', readOnly: true,
}, null, 2));
