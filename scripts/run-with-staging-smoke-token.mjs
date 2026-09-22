import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateStagingUploadArtifactDirectory } from './lib/cloudflare-artifact.mjs';
import {
  installStructuredErrorHandler,
  runBoundedStagingSmokeChild,
  runStagingSmokeAfterLocalPreflight,
  sanitizedEnvironment,
  STAGING_SMOKE_SECRET_READ_OBSERVER,
  STAGING_SMOKE_RUNNER_LIMITS,
  stagingSmokeTokenBytesFromSecretsFile,
} from './lib/cloudflare-process.mjs';
import { loadStagingSmokeRedirectAuthority } from './lib/cloudflare-redirects.mjs';
import {
  loadTrackedPublicMediaManifest,
  loadTrackedPublicMediaReleasePolicy,
} from './lib/public-media-manifest.mjs';
import { readSecureFile } from './lib/cloudflare-signing-key.mjs';

const COMMON_ENVIRONMENT_NAMES = Object.freeze([
  'CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR',
  'CLOUDFLARE_STAGING_SYNTHETIC_ORIGIN',
  'CLOUDFLARE_STAGING_VERSION_ATTESTATION_RECEIPT_PATH',
  'CLOUDFLARE_STAGING_VERSION_ATTESTATION_SIGNATURE_PATH',
  'CLOUDFLARE_STAGING_VERSION_ATTESTATION_PUBLIC_KEY_PATH',
  'CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_RECEIPT_PATH',
  'CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_SIGNATURE_PATH',
  'CLOUDFLARE_STAGING_DEPLOYMENT_STATUS_PUBLIC_KEY_PATH',
  'CLOUDFLARE_STAGING_MEDIA_PROBE_RECEIPT_PATH',
  'CLOUDFLARE_STAGING_MEDIA_PROBE_SIGNATURE_PATH',
  'CLOUDFLARE_STAGING_MEDIA_PROBE_PUBLIC_KEY_PATH',
]);
const COMMANDS = Object.freeze({
  smoke: {
    script: 'scripts/collect-cloudflare-staging-smoke.mjs',
    environmentNames: [
      ...COMMON_ENVIRONMENT_NAMES,
      'CLOUDFLARE_STAGING_SMOKE_CANDIDATE_PATH',
      'CLOUDFLARE_VERSION_ATTESTATION_RECEIPT_PATH',
      'CLOUDFLARE_VERSION_ATTESTATION_SIGNATURE_PATH',
      'CLOUDFLARE_VERSION_ATTESTATION_PUBLIC_KEY_PATH',
    ],
  },
  'admission-smoke': {
    script: 'scripts/collect-cloudflare-staging-admission-smoke.mjs',
    environmentNames: [
      ...COMMON_ENVIRONMENT_NAMES,
      'CLOUDFLARE_STAGING_ADMISSION_SMOKE_CANDIDATE_PATH',
    ],
  },
});

async function readProductionSmokeSecret(file, maximumBytes) {
  const observer = globalThis[STAGING_SMOKE_SECRET_READ_OBSERVER];
  if (observer !== undefined) {
    if (typeof observer !== 'function') {
      throw new Error('CLOUDFLARE_E_SMOKE_SECRET_READ_OBSERVER');
    }
    observer();
  }
  return readSecureFile(file, maximumBytes);
}

function runnerOutputError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function writeRunnerOutput(stream, bytes, deadlineEpochMs) {
  if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(deadlineEpochMs)
    || !stream || typeof stream.write !== 'function' || typeof stream.on !== 'function'
    || typeof stream.off !== 'function') {
    throw runnerOutputError('CLOUDFLARE_E_SMOKE_RUNNER_OUTPUT');
  }
  if (bytes.length === 0) return;
  const remaining = deadlineEpochMs - Date.now();
  if (remaining <= 0) {
    try { stream.destroy?.(); } catch { /* best effort */ }
    throw runnerOutputError('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
  }
  await new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    let writeReturned = false;
    let callbackDone = false;
    let drainObserved = false;
    let drainRequired = false;
    let deferredFailure;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      stream.off('drain', onDrain);
      stream.off('error', onError);
      stream.off('close', onClose);
      if (deferredFailure !== undefined) clearImmediate(deferredFailure);
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const fail = (code, destroy = false) => {
      if (settled || deferredFailure !== undefined) return;
      deferredFailure = null;
      if (destroy) {
        try { stream.destroy?.(); } catch { /* best effort */ }
      }
      if (code === 'CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT') {
        // Settle before the outer deadline can win the race. Deferring this to
        // setImmediate leaves the output buffer and listeners alive on a busy loop.
        finish(runnerOutputError(code));
        return;
      }
      // Node writable streams can emit `error` immediately after invoking a failed
      // write callback. Keep the listener through that turn so the error is never unhandled.
      deferredFailure = setImmediate(() => finish(runnerOutputError(code)));
    };
    const maybeFinish = () => {
      if (writeReturned && callbackDone && (!drainRequired || drainObserved)) finish();
    };
    const onDrain = () => { drainObserved = true; maybeFinish(); };
    const onError = () => fail('CLOUDFLARE_E_SMOKE_RUNNER_OUTPUT');
    const onClose = () => {
      if (!callbackDone || drainRequired && !drainObserved) {
        fail('CLOUDFLARE_E_SMOKE_RUNNER_OUTPUT');
      }
    };
    stream.on('drain', onDrain);
    stream.on('error', onError);
    stream.on('close', onClose);
    timer = setTimeout(() => {
      fail('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT', true);
    }, Math.max(1, remaining));
    try {
      const accepted = stream.write(bytes, (error) => {
        if (error) { fail('CLOUDFLARE_E_SMOKE_RUNNER_OUTPUT', true); return; }
        callbackDone = true;
        maybeFinish();
      });
      drainRequired = accepted === false;
      writeReturned = true;
      maybeFinish();
    } catch {
      fail('CLOUDFLARE_E_SMOKE_RUNNER_OUTPUT', true);
    }
  });
}

function validateRunnerArguments(argv, environment) {
  const commandArgument = argv[2];
  if (!commandArgument?.startsWith('--command=')) {
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_ARGUMENT');
  }
  const command = commandArgument.slice('--command='.length);
  const selected = COMMANDS[command];
  const secretsFile = environment.CLOUDFLARE_STAGING_SMOKE_SECRETS_FILE;
  const artifactDirectory = environment.CLOUDFLARE_PREUPLOAD_ARTIFACT_DIR;
  if (!selected || argv[3] !== '--' || argv.length !== 4
    || typeof secretsFile !== 'string' || !path.isAbsolute(secretsFile)
    || typeof artifactDirectory !== 'string' || !path.isAbsolute(artifactDirectory)
    || Object.hasOwn(environment, 'CLOUDFLARE_STAGING_SMOKE_TOKEN')) {
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_ARGUMENT');
  }
  return { selected, secretsFile, artifactDirectory };
}

export async function runStagingSmokeTokenRunner({
  root = process.cwd(),
  argv = process.argv,
  environment = process.env,
  readSecret = readProductionSmokeSecret,
  spawnChild,
  limits = STAGING_SMOKE_RUNNER_LIMITS,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)
    || !Array.isArray(argv) || typeof readSecret !== 'function'
    || !stdout || typeof stdout.write !== 'function'
    || !stderr || typeof stderr.write !== 'function') {
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_ARGUMENT');
  }
  const { selected, secretsFile, artifactDirectory } = validateRunnerArguments(argv, environment);
  const startedAt = Date.now();
  const finalDeadlineEpochMs = startedAt + limits.totalTimeoutMs;
  const operationDeadlineEpochMs = finalDeadlineEpochMs
    - limits.gracefulTerminationMs - limits.forcedSettleMs;
  if (!Number.isSafeInteger(operationDeadlineEpochMs)
    || operationDeadlineEpochMs <= startedAt) {
    throw new Error('CLOUDFLARE_E_SMOKE_RUNNER_BOUNDARY');
  }
  const passthrough = {};
  for (const name of selected.environmentNames) {
    if (typeof environment[name] === 'string') passthrough[name] = environment[name];
  }
  const controller = new AbortController();
  let operationTimer;
  let finalTimer;
  operationTimer = setTimeout(() => {
    controller.abort('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
  }, Math.max(1, operationDeadlineEpochMs - Date.now()));
  const finalTimeout = new Promise((_, reject) => {
    finalTimer = setTimeout(() => {
      controller.abort('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT');
      reject(new Error('CLOUDFLARE_E_SMOKE_RUNNER_TIMEOUT'));
    }, Math.max(1, finalDeadlineEpochMs - Date.now()));
  });
  const workflow = runStagingSmokeAfterLocalPreflight({
    signal: controller.signal,
    preflight: async () => {
      const { receipt } = await validateStagingUploadArtifactDirectory(
        artifactDirectory,
        async () => {
          const [policy, manifest] = await Promise.all([
            loadTrackedPublicMediaReleasePolicy(root),
            loadTrackedPublicMediaManifest(root),
          ]);
          return { policy, manifest };
        },
      );
      await loadStagingSmokeRedirectAuthority(root, artifactDirectory, receipt);
    },
    readToken: async () => {
      const stored = await readSecret(secretsFile, 4096);
      try { return stagingSmokeTokenBytesFromSecretsFile(stored); }
      finally { stored.fill(0); }
    },
    startChild: async (tokenBytes) => {
      const result = await runBoundedStagingSmokeChild({
        command: process.execPath,
        args: [path.join(root, selected.script)],
        cwd: root,
        env: sanitizedEnvironment(environment, {
          ...passthrough,
          CLOUDFLARE_STAGING_SMOKE_TOKEN_FD: '3',
          CLOUDFLARE_STAGING_SMOKE_DEADLINE_EPOCH_MS: String(operationDeadlineEpochMs),
        }),
        tokenBytes,
        operationDeadlineEpochMs,
        finalDeadlineEpochMs,
        spawnChild,
        limits,
      });
      try {
        const outputDeadlineEpochMs = finalDeadlineEpochMs - limits.forcedSettleMs;
        const writes = await Promise.allSettled([
          writeRunnerOutput(stdout, result.stdout, outputDeadlineEpochMs),
          writeRunnerOutput(stderr, result.stderr, outputDeadlineEpochMs),
        ]);
        const failure = writes.find((item) => item.status === 'rejected');
        if (failure) throw failure.reason;
      } finally {
        result.stdout.fill(0);
        result.stderr.fill(0);
      }
    },
  });
  try {
    return await Promise.race([workflow, finalTimeout]);
  } finally {
    if (operationTimer !== undefined) clearTimeout(operationTimer);
    if (finalTimer !== undefined) clearTimeout(finalTimer);
  }
}

const isMain = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  installStructuredErrorHandler('staging-smoke-token-runner');
  await runStagingSmokeTokenRunner();
}
