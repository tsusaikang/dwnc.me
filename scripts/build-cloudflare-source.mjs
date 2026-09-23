import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sanitizedEnvironment } from './lib/cloudflare-process.mjs';
import imageCodecAssets from '../src/data/image-codec-assets.json' with { type: 'json' };

const ROOT = process.cwd();
const temporaryPublic = await mkdtemp(path.join(os.tmpdir(), 'dwnc-cloudflare-public-'));
const injectedPrivateRoot = `${temporaryPublic}-private-state-must-stay-absent`;
const authoritativePrivateRoot = path.join(ROOT, 'migration/private');

async function optionalStat(target) {
  try { return await lstat(target); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('CLOUDFLARE_E_PRIVATE_ROOT');
  }
}

function sameStat(left, right) {
  return left === null && right === null
    || Boolean(left && right && left.dev === right.dev && left.ino === right.ino
      && left.mode === right.mode && left.mtimeMs === right.mtimeMs);
}

async function run(command, args, extraEnvironment = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: {
      ...sanitizedEnvironment(process.env),
      ASTRO_TELEMETRY_DISABLED: '1',
      DWNC_MEDIA_MODE: 'remote',
      DWNC_CLOUDFLARE_PUBLIC_DIR: temporaryPublic,
      DWNC_SEQUENCE_PRIVATE_ROOT: injectedPrivateRoot,
      ...extraEnvironment,
    },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error('CLOUDFLARE_E_BUILD_STEP');
}

const authoritativeBefore = await optionalStat(authoritativePrivateRoot);
if (await optionalStat(injectedPrivateRoot)) throw new Error('CLOUDFLARE_E_PRIVATE_ROOT');
try {
  await writeFile(path.join(temporaryPublic, '_redirects'), await readFile(path.join(ROOT, 'public/_redirects')),
    { mode: 0o644, flag: 'wx' });
  await writeFile(path.join(temporaryPublic, '.assetsignore'), await readFile(path.join(ROOT, 'public/.assetsignore')),
    { mode: 0o644, flag: 'wx' });
  // Remote builds still need the fonts used by imported public articles.
  // Copy only the six reviewed files and their notices, never public/media.
  const fontDirectory = path.join(temporaryPublic, 'fonts/nanum');
  await mkdir(fontDirectory, { recursive: true });
  for (const name of ['NanumGothic.woff', 'NanumGothicBold.ttf', 'NanumMyeongjo.woff', 'NanumMyeongjoBold.woff', 'NanumBarunGothic.woff', 'NanumBarunGothicBold.woff', 'LICENSE.txt', 'README.txt']) {
    const source = path.join(ROOT, 'public/fonts/nanum', name);
    if (!(await lstat(source)).isFile()) throw new Error('CLOUDFLARE_E_FONT_FILE');
    await writeFile(path.join(fontDirectory, name), await readFile(source), { mode: 0o644, flag: 'wx' });
  }
  // Fixed reviewed codec files and notices only; never copy an arbitrary folder.
  const codecDirectory = path.join(temporaryPublic, 'image-codecs');
  await mkdir(codecDirectory, { recursive: true });
  for (const name of Object.keys(imageCodecAssets)) {
    const source = path.join(ROOT, 'public/image-codecs', name);
    if (!(await lstat(source)).isFile()) throw new Error('CLOUDFLARE_E_IMAGE_CODEC_FILE');
    await writeFile(path.join(codecDirectory, name), await readFile(source), { mode: 0o644, flag: 'wx' });
  }
  await run(process.execPath, ['scripts/check-runtime.mjs']);
  await run(process.execPath, ['scripts/check-wrangler-pin.mjs', '--require-installed']);
  await run(process.execPath, ['scripts/validate-public-media-source.mjs']);
  await run(process.execPath, ['scripts/generate-cloudflare-redirects.mjs']);
  await run(process.execPath, ['scripts/validate-cloudflare-config.mjs']);
  await run(process.execPath, ['scripts/test-media-worker.mjs']);
  await run(process.execPath, ['scripts/test-public-media-r2.mjs']);
  await run(process.execPath, ['scripts/test-public-media-contract.mjs']);
  await run(process.execPath, ['scripts/test-cloudflare-artifact.mjs']);
  await run(process.execPath, ['scripts/test-cloudflare-release.mjs']);
  await run(process.execPath, ['scripts/test-cloudflare-staging.mjs']);
  await run(process.execPath, ['scripts/test-cloudflare-redirects.mjs']);
  await run(path.join(ROOT, 'node_modules/.bin/astro'), ['check']);
  await run(path.join(ROOT, 'node_modules/.bin/astro'), ['build']);
  await run(process.execPath, ['scripts/generate-public-request-surface.mjs']);
  await run(process.execPath, ['scripts/validate-build.mjs']);
  await run(process.execPath, ['scripts/validate-cloudflare-bundle.mjs']);
  if (await optionalStat(injectedPrivateRoot)) throw new Error('CLOUDFLARE_E_PRIVATE_ROOT_CREATED');
  const authoritativeAfter = await optionalStat(authoritativePrivateRoot);
  if (!sameStat(authoritativeBefore, authoritativeAfter)) throw new Error('CLOUDFLARE_E_PRIVATE_ROOT_MUTATED');
} finally {
  await rm(temporaryPublic, { recursive: true, force: true });
}
