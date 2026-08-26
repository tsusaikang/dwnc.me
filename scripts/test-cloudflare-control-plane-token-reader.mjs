import { createHash } from 'node:crypto';
import { cloudflareControlPlaneReadCredentials } from './lib/cloudflare-process.mjs';

try {
  const credentials = cloudflareControlPlaneReadCredentials(process.env);
  process.stdout.write(`${JSON.stringify({
    accountIdSha256: createHash('sha256').update(credentials.accountId).digest('hex'),
    apiTokenSha256: createHash('sha256').update(credentials.apiToken).digest('hex'),
    tokenPrinted: false,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error?.message ?? 'CLOUDFLARE_E_CONTROL_TOKEN_FD'}\n`);
  process.exitCode = 1;
}
