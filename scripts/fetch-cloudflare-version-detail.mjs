import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import { canonicalJson, sha256Hex, validateVersionUploadResult } from './lib/cloudflare-release.mjs';
import {
  assertPinnedWranglerInstalled,
  cloudflareOAuthWranglerEnvironment,
  inspectCloudflareOAuthAccount,
  installStructuredErrorHandler,
} from './lib/cloudflare-process.mjs';
import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
installStructuredErrorHandler('cloudflare-fetch-version-detail');
const absolute = (value) => {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('CLOUDFLARE_E_VERSION_FETCH_PATH');
  return value;
};
const artifactDirectory = absolute(process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR);
const uploadResultPath = absolute(process.env.CLOUDFLARE_VERSION_UPLOAD_RESULT_PATH);
const outputPath = absolute(process.env.CLOUDFLARE_VERSION_DETAIL_EVIDENCE_PATH);
const { receipt: artifact, artifactSha256 } = await validateArtifactDirectory(artifactDirectory);
const policy = await loadTrackedPublicMediaReleasePolicy(ROOT, { requireComplete: true });
if (policy.production.accountIdSha256 !== artifact.accountIdSha256) {
  throw new Error('CLOUDFLARE_E_ACCOUNT_TARGET');
}
await assertPinnedWranglerInstalled(ROOT);
await inspectCloudflareOAuthAccount({
  root: ROOT,
  expectedAccountIdSha256: artifact.accountIdSha256,
});
let uploadResult;
try { uploadResult = JSON.parse(await readFile(uploadResultPath, 'utf8')); }
catch { throw new Error('CLOUDFLARE_E_UPLOAD_RESULT'); }
validateVersionUploadResult(uploadResult, { artifactSha256 });
const args = [
  'versions', 'view', uploadResult.versionId, '--json', '--env', 'production',
  '--config', path.join(artifactDirectory, 'wrangler-upload.jsonc'),
  '--env-file', path.join(artifactDirectory, 'wrangler-empty.env'),
];
const startedAt = new Date().toISOString();
let stdout;
try {
  ({ stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/wrangler'), args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60000,
    env: cloudflareOAuthWranglerEnvironment(process.env, {
      CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
      WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
    }),
  }));
} catch { throw new Error('CLOUDFLARE_E_VERSION_FETCH'); }
let detail;
try { detail = JSON.parse(stdout); }
catch { throw new Error('CLOUDFLARE_E_VERSION_FETCH_JSON'); }
if (detail?.id !== uploadResult.versionId) throw new Error('CLOUDFLARE_E_VERSION_FETCH_ID');
const evidence = {
  schemaVersion: 1,
  contract: 'dwnc-cloudflare-version-detail-evidence-v1',
  artifactSha256,
  versionId: uploadResult.versionId,
  workerName: uploadResult.workerName,
  environment: 'production',
  commandSha256: sha256Hex(canonicalJson(args)),
  rawStdoutSha256: sha256Hex(stdout),
  rawStdout: stdout,
  startedAt,
  completedAt: new Date().toISOString(),
  detail,
};
await writeFile(outputPath, `${canonicalJson(evidence)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({
  contract: evidence.contract,
  artifactSha256,
  versionId: evidence.versionId,
  rawStdoutSha256: evidence.rawStdoutSha256,
  trafficChanged: false,
}, null, 2));
