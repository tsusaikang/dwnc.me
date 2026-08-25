import path from 'node:path';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { promotionRecoveryStatus } from './lib/cloudflare-promotion-store.mjs';

installStructuredErrorHandler('cloudflare-promotion-lock-status');
const directory = process.env.CLOUDFLARE_PROMOTION_STATE_DIR;
if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
  throw new Error('CLOUDFLARE_E_PROMOTION_STORE');
}
const includeToken = process.argv.includes('--include-recovery-token');
const status = await promotionRecoveryStatus(directory);
const output = {
  contract: 'dwnc-cloudflare-promotion-lock-status-v1',
  lockPresent: status.lockPresent,
  pendingPresent: status.pendingPresent,
  ownerAlive: status.ownerAlive,
  ageMs: status.ageMs,
  recoveryEligible: status.recoveryEligible,
  ...(includeToken && status.recoveryEligible ? { recoveryToken: status.recoveryToken } : {}),
};
process.stdout.write(`${JSON.stringify(output)}\n`);
