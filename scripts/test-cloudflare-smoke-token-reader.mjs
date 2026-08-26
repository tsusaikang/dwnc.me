import { stagingSmokeTokenFromEnvironment } from './lib/cloudflare-process.mjs';

try {
  const token = stagingSmokeTokenFromEnvironment(process.env, { descriptor: 3 });
  process.stdout.write(`${JSON.stringify({
    byteLength: Buffer.byteLength(token, 'utf8'),
    secretPrinted: false,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error?.message ?? 'CLOUDFLARE_E_SMOKE_TOKEN'}\n`);
  process.exitCode = 1;
}
