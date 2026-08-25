import { runChecked, sanitizedEnvironment } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
const node = process.execPath;
const environment = sanitizedEnvironment(process.env);
for (const script of [
  'scripts/check-runtime.mjs',
  'scripts/check-wrangler-pin.mjs',
  'scripts/check-wrangler-types.mjs',
  'scripts/validate-cloudflare-config.mjs',
  'scripts/build-cloudflare-source.mjs',
  'scripts/validate-wrangler-bundle.mjs',
  'scripts/validate-wrangler-startup.mjs',
]) await runChecked(node, [script, ...(script.endsWith('check-wrangler-pin.mjs') ? ['--require-installed'] : [])], {
  cwd: ROOT, env: environment,
});
console.log(JSON.stringify({
  localVerification: true,
  externalCalls: 0,
  versionUploadAttempted: false,
  deploymentAttempted: false,
  nextRequiredCommand: 'npm run cloudflare:prepare:production',
  twoPhaseReleaseRequired: true,
}, null, 2));
