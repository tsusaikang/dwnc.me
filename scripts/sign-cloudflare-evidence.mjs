import path from 'node:path';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';
import {
  readSecureFile,
  signCanonicalEvidence,
  writeSignedEvidenceOutputs,
} from './lib/cloudflare-signing-key.mjs';

installStructuredErrorHandler('cloudflare-evidence-sign');
const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = argument.match(/^--([a-z0-9-]+)=(.+)$/u);
  if (!match) throw new Error('CLOUDFLARE_E_SIGNING_ARGUMENT');
  return [match[1], match[2]];
}));
const pathKeys = ['metadata', 'candidate', 'signature-output', 'public-key-output'];
if (!['environment', 'role', 'expected-public-key-spki-sha256', ...pathKeys]
  .every((key) => typeof options[key] === 'string')
  || Object.keys(options).length !== 7
  || !/^[a-f0-9]{64}$/u.test(options['expected-public-key-spki-sha256'])
  || pathKeys.some((key) => !path.isAbsolute(options[key]))) {
  throw new Error('CLOUDFLARE_E_SIGNING_ARGUMENT');
}
const candidate = await readSecureFile(options.candidate);
const result = await signCanonicalEvidence({
  environment: options.environment,
  role: options.role,
  metadataPath: options.metadata,
  canonicalBytes: candidate,
  expectedPublicKeySpkiSha256: options['expected-public-key-spki-sha256'],
});
const outputs = await writeSignedEvidenceOutputs({
  signaturePath: options['signature-output'],
  publicKeyPath: options['public-key-output'],
  signature: result.signature,
  publicKeyPem: result.publicKeyPem,
});
console.log(JSON.stringify({
  contract: result.contract,
  environment: options.environment,
  role: options.role,
  payloadSha256: result.payloadSha256,
  publicKeySpkiSha256: result.publicKeySpkiSha256,
  signatureOutputsReady: true,
  crashRecoveryUsed: outputs.recovered,
  privateKeyPrinted: false,
}, null, 2));
