import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import { runR2ExposureCommand } from './lib/cloudflare-r2-exposure-command.mjs';

installStructuredErrorHandler('cloudflare-r2-private-exposure-fetch');
const summary = await runR2ExposureCommand();
console.log(JSON.stringify(summary, null, 2));
