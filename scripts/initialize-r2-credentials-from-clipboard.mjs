import path from 'node:path';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  initializeR2CredentialFromClipboard,
  recoverR2CredentialMetadata,
} from './lib/r2-credential-store.mjs';

installStructuredErrorHandler('r2-credential-init');
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([a-z-]+)=(.+)$/u);
  if (!match) throw new Error('MEDIA_E_R2_CREDENTIAL_ARGUMENT');
  return [match[1], match[2]];
}));
const allowed = ['environment', 'role', 'metadata-output', 'dashboard-evidence', 'mode'];
if (!['environment', 'role', 'metadata-output', 'dashboard-evidence']
  .every((key) => typeof options[key] === 'string')
  || Object.keys(options).some((key) => !allowed.includes(key))
  || !['clipboard', 'recover-metadata'].includes(options.mode ?? 'clipboard')
  || !path.isAbsolute(options['metadata-output'])
  || !path.isAbsolute(options['dashboard-evidence'])) {
  throw new Error('MEDIA_E_R2_CREDENTIAL_ARGUMENT');
}
const recovery = options.mode === 'recover-metadata';
const operation = recovery ? recoverR2CredentialMetadata : initializeR2CredentialFromClipboard;
const metadata = await operation({
  environment: options.environment,
  role: options.role,
  metadataOutput: options['metadata-output'],
  dashboardEvidencePath: options['dashboard-evidence'],
});
console.log(JSON.stringify({
  contract: metadata.contract,
  environment: metadata.environment,
  role: metadata.role,
  bucket: metadata.bucket,
  accountIdSha256: metadata.accountIdSha256,
  accessKeyIdSha256: metadata.accessKeyIdSha256,
  mode: recovery ? 'metadata-only-recovery' : 'clipboard-import',
  clipboardRead: !recovery,
  clipboardCleared: !recovery,
  keychainWritePolicy: recovery ? 'none' : 'create-only-if-absent',
  credentialPrinted: false,
}, null, 2));
