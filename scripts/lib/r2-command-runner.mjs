const COMMANDS = Object.freeze({
  'staging-admit-one': Object.freeze({
    script: 'scripts/admit-public-media-r2-staging-object.mjs',
    environment: 'staging',
    role: 'uploader',
    injectEnvironment: false,
    allowApply: false,
  }),
  'staging-sync': Object.freeze({
    script: 'scripts/sync-public-media-r2.mjs',
    environment: 'staging',
    role: 'uploader',
    injectEnvironment: true,
    allowApply: true,
  }),
  'staging-inspect': Object.freeze({
    script: 'scripts/inspect-public-media-r2.mjs',
    environment: 'staging',
    role: 'validator',
    injectEnvironment: true,
    allowApply: false,
    allowedForwardedNames: Object.freeze([
      '--concurrency', '--expected-manifest-sha256', '--receipt-output',
    ]),
  }),
  'staging-validate-one': Object.freeze({
    script: 'scripts/validate-public-media-r2-staging-object.mjs',
    environment: 'staging',
    role: 'validator',
    injectEnvironment: false,
    allowApply: false,
    allowedForwardedNames: Object.freeze([
      '--key', '--expected-manifest-sha256', '--expected-git-sha', '--receipt-output',
    ]),
  }),
  'staging-audit-full': Object.freeze({
    script: 'scripts/audit-public-media-r2-full.mjs',
    environment: 'staging',
    role: 'validator',
    injectEnvironment: true,
    allowApply: false,
  }),
  'staging-media-probe': Object.freeze({
    script: 'scripts/probe-cloudflare-staging-media.mjs',
    environment: 'staging',
    role: 'validator',
    injectEnvironment: false,
    allowApply: false,
    smokeToken: true,
  }),
  'production-sync': Object.freeze({
    script: 'scripts/sync-public-media-r2.mjs',
    environment: 'production',
    role: 'uploader',
    injectEnvironment: true,
    allowApply: true,
  }),
  'production-audit-full': Object.freeze({
    script: 'scripts/audit-public-media-r2-full.mjs',
    environment: 'production',
    role: 'validator',
    injectEnvironment: true,
    allowApply: false,
  }),
});

const AMBIGUOUS_CREDENTIAL_ENVIRONMENT_NAMES = Object.freeze([
  'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_CREDENTIALS_FD', 'R2_RUNNER_ENVIRONMENT', 'R2_RUNNER_ROLE',
]);

export function assertR2RunnerCredentialEnvironment(environment = {}) {
  if (!environment || typeof environment !== 'object'
    || AMBIGUOUS_CREDENTIAL_ENVIRONMENT_NAMES.some((name) => Object.hasOwn(environment, name))) {
    throw new Error('MEDIA_E_R2_RUNNER_CREDENTIAL_AMBIGUOUS');
  }
  return true;
}

export function buildR2RunnerInvocation(command, forwarded = []) {
  const selected = COMMANDS[command];
  if (!selected || !Array.isArray(forwarded)
    || forwarded.some((value) => typeof value !== 'string' || /[\u0000\r\n]/u.test(value))) {
    throw new Error('MEDIA_E_R2_RUNNER_ARGUMENT');
  }
  if (forwarded.some((value) => value === '--environment'
    || value.startsWith('--environment='))) throw new Error('MEDIA_E_R2_RUNNER_TARGET');
  const applyCount = forwarded.filter((value) => value === '--apply').length;
  if (applyCount > 1 || applyCount === 1 && !selected.allowApply) {
    throw new Error('MEDIA_E_R2_RUNNER_APPLY');
  }
  if (selected.allowedForwardedNames) {
    const seen = new Set();
    for (const value of forwarded) {
      const separator = value.indexOf('=');
      const name = separator > 0 ? value.slice(0, separator) : value;
      if (separator < 1 || !selected.allowedForwardedNames.includes(name) || seen.has(name)) {
        throw new Error('MEDIA_E_R2_RUNNER_ARGUMENT');
      }
      seen.add(name);
    }
  }
  return {
    ...selected,
    args: [
      ...(selected.injectEnvironment ? [`--environment=${selected.environment}`] : []),
      ...forwarded,
    ],
  };
}
