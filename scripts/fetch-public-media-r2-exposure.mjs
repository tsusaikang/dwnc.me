import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { runStagingR2ExposureCommand } from './lib/cloudflare-r2-exposure-command.mjs';

installStructuredErrorHandler('cloudflare-r2-private-exposure-fetch');
const summary = await runStagingR2ExposureCommand();
console.log(JSON.stringify(summary, null, 2));
