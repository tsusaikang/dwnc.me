import path from 'node:path';
import { validateArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';

installStructuredErrorHandler('cloudflare-artifact-validate');
const artifactDirectory = process.env.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR;
if (typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)) {
  throw new Error('CLOUDFLARE_E_ARTIFACT_DIRECTORY');
}
const result = await validateArtifactDirectory(artifactDirectory);
console.log(JSON.stringify({
  contract: result.receipt.contract,
  artifactSha256: result.artifactSha256,
  sourceGitSha: result.receipt.sourceGitSha,
  workerVersionId: null,
  uploadAttempted: false,
  trafficChanged: false,
}, null, 2));
