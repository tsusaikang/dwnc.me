import { loadTrackedPublicMediaReleasePolicy } from './lib/public-media-manifest.mjs';
import {
  loadTrackedStagingSmokeAccessPolicy,
  stagingSmokeAccessPolicySha256,
} from './lib/staging-smoke-access-policy.mjs';

const [policy, releasePolicy] = await Promise.all([
  loadTrackedStagingSmokeAccessPolicy(process.cwd()),
  loadTrackedPublicMediaReleasePolicy(process.cwd()),
]);
const sha256 = stagingSmokeAccessPolicySha256(policy);
if (releasePolicy.staging.smokeOrigin !== policy.origin
  || releasePolicy.staging.smokeAccessPolicySha256 !== sha256) {
  throw new Error('CLOUDFLARE_E_STAGING_SMOKE_ACCESS_POLICY_PIN');
}
console.log(JSON.stringify({
  contract: policy.contract,
  origin: policy.origin,
  authenticationScheme: policy.authentication.scheme,
  accessPolicySha256: sha256,
  pinned: true,
}, null, 2));
