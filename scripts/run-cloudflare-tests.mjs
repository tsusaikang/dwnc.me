import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const TESTS = Object.freeze([
  'test-media-worker.mjs',
  'test-public-media-r2.mjs',
  'test-public-media-contract.mjs',
  'test-r2-client-entrypoints.mjs',
  'test-r2-bulk-hardening.mjs',
  'test-r2-full-audit-entrypoint.mjs',
  'test-r2-one-object-validator.mjs',
  'test-r2-credential-store.mjs',
  'test-cloudflare-account-target.mjs',
  'test-cloudflare-account-target-loopback.mjs',
  'test-cloudflare-account-target-stdin.mjs',
  'test-cloudflare-control-plane-auth.mjs',
  'test-cloudflare-staging-control-token-stdin.mjs',
  'test-cloudflare-staging-control-token.mjs',
  'test-cloudflare-staging-control-recovery-entrypoint.mjs',
  'test-cloudflare-r2-exposure.mjs',
  'test-cloudflare-signing-key.mjs',
  'test-cloudflare-workers-dev.mjs',
  'test-cloudflare-artifact.mjs',
  'test-cloudflare-release.mjs',
  'test-cloudflare-upload-authorization-creator.mjs',
  'test-cloudflare-promotion-store.mjs',
  'test-cloudflare-promotion-executor.mjs',
  'test-cloudflare-staging-activation-store.mjs',
  'test-cloudflare-bootstrap.mjs',
  'test-cloudflare-bootstrap-authorization.mjs',
  'test-cloudflare-bootstrap-recovery.mjs',
  'test-cloudflare-bootstrap-execution.mjs',
  'test-cloudflare-sealed-input.mjs',
  'test-cloudflare-smoke-token.mjs',
  'test-cloudflare-staging.mjs',
  'test-cloudflare-redirects.mjs',
]);

export async function runCloudflareTests({
  root = ROOT,
  execute = promisify(execFile),
} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || typeof execute !== 'function') throw new Error('CLOUDFLARE_E_TEST_RUNNER');
  const results = [];
  for (const file of TESTS) {
    let stdout;
    let stderr;
    try {
      ({ stdout, stderr } = await execute(process.execPath, [path.join(root, 'scripts', file)], {
        cwd: root, env: process.env, encoding: 'utf8', timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      }));
    } catch (error) {
      throw new Error(`CLOUDFLARE_E_TEST_RUNNER:${file}:${error?.message ?? 'failed'}`);
    }
    let result;
    try { result = JSON.parse(stdout); }
    catch { throw new Error(`CLOUDFLARE_E_TEST_RUNNER:${file}:output`); }
    if (!result || result.status !== 'PASS' || typeof result.suite !== 'string'
      || !Number.isSafeInteger(result.assertions) || result.assertions < 1) {
      throw new Error(`CLOUDFLARE_E_TEST_RUNNER:${file}:result`);
    }
    results.push({
      file, suite: result.suite, assertions: result.assertions,
      expectedDiagnosticBytes: Buffer.byteLength(stderr),
    });
  }
  return {
    contract: 'dwnc-cloudflare-local-test-summary-v1',
    suites: results.length,
    assertions: results.reduce((sum, result) => sum + result.assertions, 0),
    results,
    automaticallyVerified: {
      everySuiteReportedPass: results.every((result) => result.assertions > 0),
      suiteResultCount: results.length,
    },
    status: 'PASS',
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('CLOUDFLARE_E_TEST_RUNNER');
  console.log(JSON.stringify(await runCloudflareTests(), null, 2));
}
