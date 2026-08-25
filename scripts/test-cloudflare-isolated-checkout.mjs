import { execFile, spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { sanitizedEnvironment } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
const modeArgument = process.argv.find((argument) => argument.startsWith('--mode='));
const mode = modeArgument?.slice('--mode='.length) ?? 'source-isolation';
if (!['source-isolation', 'lock-offline', 'clean-install'].includes(mode)
  || process.argv.length !== (modeArgument ? 3 : 2)) throw new Error('CLOUDFLARE_E_ISOLATED_ARGUMENT');

const FORBIDDEN_PATH = /^(?:\.git(?:\/|$)|node_modules(?:\/|$)|dist(?:\/|$)|migration\/(?:private|raw)(?:\/|$)|public\/media(?:\/|$)|\.env(?:\.|$)|.*(?:\.log|\.tmp))$/iu;

async function run(command, args, cwd, { capture = false, environment = {} } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...sanitizedEnvironment(process.env),
      ASTRO_TELEMETRY_DISABLED: '1',
      WRANGLER_WRITE_LOGS: '0',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true',
      CI: '1',
      ...environment,
    },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  let stdout = '';
  let stderr = '';
  if (capture) {
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
  }
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error('CLOUDFLARE_E_ISOLATED_STEP');
  return { stdout, stderr };
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-git-checkout-'));
try {
  const { stdout } = await promisify(execFile)('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z',
  ], { cwd: ROOT, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  const candidates = stdout.toString('utf8').split('\0').filter(Boolean);
  if (!candidates.length || candidates.some((relative) => path.isAbsolute(relative)
    || relative.split('/').includes('..') || FORBIDDEN_PATH.test(relative))) {
    throw new Error('CLOUDFLARE_E_ISOLATED_FILESET');
  }
  for (const relative of candidates) {
    const source = path.join(ROOT, relative);
    const stats = await lstat(source);
    if (!stats.isFile() || stats.nlink !== 1) throw new Error('CLOUDFLARE_E_ISOLATED_FILESET');
    const destination = path.join(temporary, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  for (const forbidden of ['migration/private', 'migration/raw', 'public/media', '.git']) {
    try { await lstat(path.join(temporary, forbidden)); throw new Error('CLOUDFLARE_E_ISOLATED_PRIVATE'); }
    catch (error) {
      if (error?.code !== 'ENOENT' && error?.message !== 'CLOUDFLARE_E_ISOLATED_PRIVATE') throw error;
      if (error?.message === 'CLOUDFLARE_E_ISOLATED_PRIVATE') throw error;
    }
  }

  if (mode === 'source-isolation') {
    const localModules = await lstat(path.join(ROOT, 'node_modules'));
    if (!localModules.isDirectory()) throw new Error('CLOUDFLARE_E_ISOLATED_DEPENDENCIES');
    await symlink(path.join(ROOT, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    await run(process.execPath, ['scripts/build-cloudflare-source.mjs'], temporary);
  } else {
    const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
    if (mode === 'lock-offline') args.push('--dry-run', '--offline');
    await run('npm', args, temporary, { capture: mode === 'lock-offline' });
    if (mode === 'clean-install') await run('npm', ['run', 'cloudflare:build:source'], temporary);
  }

  const lock = JSON.parse(await readFile(path.join(temporary, 'package-lock.json'), 'utf8'));
  if (lock.packages?.['node_modules/wrangler']?.version !== '4.125.0') {
    throw new Error('CLOUDFLARE_E_ISOLATED_WRANGLER');
  }
  console.log(JSON.stringify({
    suite: 'cloudflare-isolated-checkout',
    mode,
    gitStyleFiles: candidates.length,
    privateRawLocalMediaPresent: 0,
    exactWrangler: '4.125.0',
    sourceBuild: mode !== 'lock-offline',
    externalNetworkRequired: mode === 'clean-install',
    status: 'PASS',
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
