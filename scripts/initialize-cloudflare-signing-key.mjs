import path from 'node:path';
import {
  initializeSigningKey,
} from './lib/cloudflare-signing-key.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';

installStructuredErrorHandler('cloudflare-signing-key-init');
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([a-z-]+)=(.+)$/u);
  if (!match) throw new Error('CLOUDFLARE_E_SIGNING_ARGUMENT');
  return [match[1], match[2]];
}));
const allowed = ['environment', 'role', 'metadata-output', 'recovery-public-key-spki-sha256'];
if (!['environment', 'role', 'metadata-output'].every((key) => typeof options[key] === 'string')
  || Object.keys(options).some((key) => !allowed.includes(key))
  || options['recovery-public-key-spki-sha256'] !== undefined
    && !/^[a-f0-9]{64}$/u.test(options['recovery-public-key-spki-sha256'])
  || !path.isAbsolute(options['metadata-output'])) {
  throw new Error('CLOUDFLARE_E_SIGNING_ARGUMENT');
}
const metadata = await initializeSigningKey({
  environment: options.environment,
  role: options.role,
  metadataOutput: options['metadata-output'],
  recoveryPublicKeySpkiSha256: options['recovery-public-key-spki-sha256'] ?? null,
});
console.log(JSON.stringify({
  contract: metadata.contract,
  environment: metadata.environment,
  role: metadata.role,
  publicKeySpkiSha256: metadata.publicKeySpkiSha256,
  privateKeyStoredInKeychain: true,
  privateKeyPrinted: false,
}, null, 2));
