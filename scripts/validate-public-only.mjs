import { spawn } from 'node:child_process';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const authoritativePrivateRoot = path.join(ROOT, 'migration/private');
const temporaryRoot = await mkdtemp('/private/tmp/dwnc-public-only-validation-');
const injectedPrivateRoot = path.join(temporaryRoot, 'private-state-must-stay-absent');

function sameStat(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.mode === after.mode
    && before.mtimeMs === after.mtimeMs;
}

async function runValidator() {
  const child = spawn(process.execPath, ['scripts/validate-build.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DWNC_SEQUENCE_PRIVATE_ROOT: injectedPrivateRoot,
    },
    stdio: 'inherit',
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (exitCode !== 0) throw new Error('SEQ_E_PUBLIC_ONLY_VALIDATION');
}

const authoritativeBefore = await lstat(authoritativePrivateRoot);
try {
  await lstat(injectedPrivateRoot).then(
    () => { throw new Error('SEQ_E_PUBLIC_ONLY_ROOT_PRESENT'); },
    (error) => { if (error?.code !== 'ENOENT') throw error; },
  );
  await runValidator();
  await lstat(injectedPrivateRoot).then(
    () => { throw new Error('SEQ_E_PUBLIC_ONLY_ROOT_CREATED'); },
    (error) => { if (error?.code !== 'ENOENT') throw error; },
  );
  const authoritativeAfter = await lstat(authoritativePrivateRoot);
  if (!sameStat(authoritativeBefore, authoritativeAfter)) {
    throw new Error('SEQ_E_AUTHORITATIVE_PRIVATE_ROOT_MUTATED');
  }
  console.log(JSON.stringify({
    validationScope: 'public-only',
    privateStateInjectedAbsent: true,
    privateDirectoriesCreated: 0,
    authoritativePrivateRootMutated: false,
  }, null, 2));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
