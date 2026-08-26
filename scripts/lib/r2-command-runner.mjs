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
  return {
    ...selected,
    args: [
      ...(selected.injectEnvironment ? [`--environment=${selected.environment}`] : []),
      ...forwarded,
    ],
  };
}
