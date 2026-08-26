import { createHash } from 'node:crypto';
import { r2CredentialsFromEnvironment } from './lib/r2-s3-client.mjs';

try {
  const credentials = r2CredentialsFromEnvironment(process.env);
  process.stdout.write(`${JSON.stringify({
    contract: credentials.contract,
    bucket: credentials.bucket,
    accountIdSha256: createHash('sha256').update(credentials.accountId).digest('hex'),
    credentialPrinted: false,
  })}\n`);
} catch (error) {
  process.stderr.write(`${error?.code ?? error?.message ?? 'MEDIA_E_R2_CREDENTIALS'}\n`);
  process.exitCode = 1;
}
