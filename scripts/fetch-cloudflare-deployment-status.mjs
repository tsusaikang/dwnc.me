import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  createDeploymentStatusEvidence,
} from './lib/cloudflare-release.mjs';
import { produceDeploymentStatusCaptureAndEvidence } from './lib/cloudflare-deployment-status.mjs';
import {
  assertPinnedWranglerInstalled,
  cloudflareOAuthWranglerEnvironment,
  inspectCloudflareOAuthAccount,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-deployment-status-fetch');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_STATUS_PATH');
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const capturePath = absolute(process.env.CLOUDFLARE_DEPLOYMENT_STATUS_CAPTURE_PATH);
const evidencePath = absolute(process.env.CLOUDFLARE_DEPLOYMENT_STATUS_EVIDENCE_PATH);
if (capturePath === evidencePath) throw new Error('CLOUDFLARE_E_STATUS_PATH');
const targetVersionId = process.env.CLOUDFLARE_EXPECTED_DEPLOYMENT_VERSION_ID;
const { receipt: artifact } = await validateArtifactDirectory(artifactDirectory);
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true });
if (policy.production.accountIdSha256 !== artifact.accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
await assertPinnedWranglerInstalled(ROOT);
await inspectCloudflareOAuthAccount({
  root: ROOT,
  expectedAccountIdSha256: artifact.accountIdSha256,
});
const args = ['deployments', 'status', '--json', '--env', 'production', '--config',
  path.join(artifactDirectory, 'wrangler-promotion.jsonc'),
  '--env-file', path.join(artifactDirectory, 'wrangler-empty.env')];
const startedAt = new Date().toISOString();
let stdout;
try {
  ({ stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 60000,
    env: cloudflareOAuthWranglerEnvironment(process.env, {
      CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
      WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
    }),
  }));
} catch { throw new Error('CLOUDFLARE_E_STATUS_FETCH'); }
let rawStatus;
try { rawStatus = JSON.parse(stdout); }
catch { throw new Error('CLOUDFLARE_E_STATUS_JSON'); }
const observedAt = new Date().toISOString();
const evidence = createDeploymentStatusEvidence({ rawStatus, targetVersionId, observedAt });
const capture = await produceDeploymentStatusCaptureAndEvidence({
  capturePath,
  evidencePath,
  args,
  stdout,
  startedAt,
  completedAt: observedAt,
  evidence,
  rawStatus,
});
console.log(JSON.stringify({
  contract: capture.contract,
  targetVersionId,
  deploymentId: evidence.deploymentId,
  traffic: '100%',
  captureWritten: true,
  evidenceWritten: true,
  readOnly: true,
}, null, 2));
