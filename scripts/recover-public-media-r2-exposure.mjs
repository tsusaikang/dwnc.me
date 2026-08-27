import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { runStagingR2ExposureRecoveryCommand } from './lib/cloudflare-r2-exposure-command.mjs';

installStructuredErrorHandler('cloudflare-r2-exposure-recovery');
const summary = await runStagingR2ExposureRecoveryCommand();
console.log(JSON.stringify(summary, null, 2));
