import path from 'node:path';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { stagingActivationRecoveryStatus } from './lib/cloudflare-staging-activation-store.mjs';

installStructuredErrorHandler('cloudflare-staging-activation-lock-status');
const directory = process.env.CLOUDFLARE_STAGING_ACTIVATION_STATE_DIR;
if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
  throw new Error('CLOUDFLARE_E_STAGING_STORE');
}
const includeToken = process.argv.includes('--include-recovery-token');
const status = await stagingActivationRecoveryStatus(directory);
console.log(JSON.stringify({
  lockPresent: status.lockPresent,
  pendingPresent: status.pendingPresent,
  ownerAlive: status.ownerAlive,
  ageMs: status.ageMs,
  recoveryEligible: status.recoveryEligible,
  recoveryToken: includeToken && status.recoveryEligible ? status.recoveryToken : null,
}, null, 2));
