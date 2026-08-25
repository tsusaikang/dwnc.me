import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizedEnvironment } from './lib/cloudflare-process.mjs';

const ROOT = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-wrangler-startup-'));
const profile = path.join(temporary, 'startup.cpuprofile');
try {
  const child = spawn(path.join(ROOT, 'node_modules/.bin/wrangler'), [
    'check', 'startup', '--env', 'production', '--config', 'wrangler.jsonc',
    '--outfile', profile, '--args=--no-autoconfig',
  ], {
    cwd: ROOT,
    env: sanitizedEnvironment(process.env, {
      CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
      WRANGLER_NO_SKILLS_UPDATE_PROMPTS: 'true', XDG_CONFIG_HOME: temporary,
      WRANGLER_LOG_PATH: path.join(temporary, 'wrangler.log'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0 || /\b(?:EPERM|Error:)\b/u.test(output)) {
    throw new Error('CLOUDFLARE_E_WORKER_STARTUP');
  }
  let document;
  try { document = JSON.parse(await readFile(profile, 'utf8')); }
  catch { throw new Error('CLOUDFLARE_E_WORKER_STARTUP_PROFILE'); }
  if (!Array.isArray(document.nodes) || document.nodes.length === 0) {
    throw new Error('CLOUDFLARE_E_WORKER_STARTUP_PROFILE');
  }
  console.log(JSON.stringify({
    wranglerEnvironment: 'production',
    workerdStartup: true,
    profileNodes: document.nodes.length,
    networkRequests: 0,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
