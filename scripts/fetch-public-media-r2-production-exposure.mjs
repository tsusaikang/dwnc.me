import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { runProductionR2ExposureCommand } from './lib/cloudflare-r2-exposure-command.mjs';

installStructuredErrorHandler('cloudflare-r2-production-private-exposure-fetch');
const summary = await runProductionR2ExposureCommand();
console.log(JSON.stringify(summary, null, 2));
