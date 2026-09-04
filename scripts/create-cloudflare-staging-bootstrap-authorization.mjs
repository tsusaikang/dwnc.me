import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudflareStagingBootstrapAuthorization }
  from './lib/cloudflare-bootstrap-authorization.mjs';
import { installStructuredErrorHandler } from './lib/cloudflare-process.mjs';

const OPTION_KEYS = Object.freeze([
  'service-receipt', 'service-signature', 'service-public-key',
  'subdomain-receipt', 'subdomain-signature', 'subdomain-public-key', 'output',
]);

export async function createCloudflareStagingBootstrapAuthorizationCommand({
  argv = process.argv.slice(2),
  root = process.cwd(),
  createAuthorization = createCloudflareStagingBootstrapAuthorization,
} = {}) {
  if (!Array.isArray(argv) || typeof root !== 'string' || !path.isAbsolute(root)
    || path.resolve(root) !== root || typeof createAuthorization !== 'function') {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_ARGUMENT');
  }
  const options = Object.create(null);
  for (const argument of argv) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match || !OPTION_KEYS.includes(match[1]) || Object.hasOwn(options, match[1])) {
      throw new Error('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_ARGUMENT');
    }
    options[match[1]] = match[2];
  }
  if (Object.keys(options).length !== OPTION_KEYS.length
    || OPTION_KEYS.some((key) => typeof options[key] !== 'string'
      || !path.isAbsolute(options[key]) || path.resolve(options[key]) !== options[key])) {
    throw new Error('CLOUDFLARE_E_BOOTSTRAP_AUTHORIZATION_ARGUMENT');
  }
  return createAuthorization({
    repositoryRoot: root,
    serviceEvidencePaths: {
      receiptPath: options['service-receipt'],
      signaturePath: options['service-signature'],
      publicKeyPath: options['service-public-key'],
    },
    accountSubdomainEvidencePaths: {
      receiptPath: options['subdomain-receipt'],
      signaturePath: options['subdomain-signature'],
      publicKeyPath: options['subdomain-public-key'],
    },
    outputPath: options.output,
  });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  installStructuredErrorHandler('cloudflare-bootstrap-authorization-create');
  console.log(JSON.stringify(await createCloudflareStagingBootstrapAuthorizationCommand(), null, 2));
}
