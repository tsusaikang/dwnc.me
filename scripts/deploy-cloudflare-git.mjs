import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGETS = {
  public: { name: 'dwnc-me', config: 'wrangler.jsonc' },
  admin: { name: 'dwnc-me-admin', config: 'wrangler.admin.jsonc' },
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

export function deliveryEnvironment(source, outputFile) {
  const env = { ...source };
  for (const key of ['WRANGLER_OUTPUT_FILE_DIRECTORY', 'WRANGLER_OUTPUT_FILE_PATH']) delete env[key];
  return { ...env, CI: '1', WRANGLER_WRITE_LOGS: '0', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_CI_GENERATE_PREVIEW_ALIAS: 'false', WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_OUTPUT_FILE_PATH: outputFile };
}

export function uploadedVersion(text, expectedName) {
  const entries = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const uploaded = entries.filter((entry) => entry.type === 'version-upload');
  if (uploaded.length !== 1 || uploaded[0].version !== 1
    || uploaded[0].worker_name !== expectedName
    || uploaded[0].wrangler_environment !== 'production'
    || !UUID.test(uploaded[0].version_id ?? '')) throw new Error('upload-receipt');
  return uploaded[0].version_id;
}

export async function forwardBuildUpload(text, environment, expectedName) {
  // Wrangler's output contract is JSON Lines, with an explicit file taking
  // precedence over its output directory. Forward only the verified upload
  // event; session arguments and any other records are not build artifacts.
  uploadedVersion(text, expectedName);
  const destination = environment.WRANGLER_OUTPUT_FILE_PATH
    || (environment.WRANGLER_OUTPUT_FILE_DIRECTORY
      ? path.join(environment.WRANGLER_OUTPUT_FILE_DIRECTORY, `dwnc-upload-${randomUUID()}.json`) : null);
  if (!destination) return;
  const event = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .find((entry) => entry.type === 'version-upload');
  await mkdir(path.dirname(destination), { recursive: true });
  await appendFile(destination, `${JSON.stringify(event)}\n`, { mode: 0o600 });
}

function runProcess(args, { cwd, env, visible = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd, env, stdio: visible ? ['ignore', 'inherit', 'inherit'] : 'ignore',
    });
    child.once('error', () => reject(new Error('process-start')));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('process-failed')));
  });
}

export async function deployFromGit({ target: targetKey, root = process.cwd(), environment = process.env,
  run = runProcess, report = (event) => console.log(JSON.stringify(event)) } = {}) {
  const target = TARGETS[targetKey];
  if (!target || !['1', 'true'].includes(environment.CI)
    || !environment.CLOUDFLARE_API_TOKEN
    || !/^[a-f0-9]{32}$/iu.test(environment.CLOUDFLARE_ACCOUNT_ID ?? '')) {
    throw new Error('An explicit target, CI and Cloudflare build credentials are required');
  }
  // Preserve Builds' Worker name/tag checks; never override its connected target.
  if (environment.WRANGLER_CI_OVERRIDE_NAME
    && environment.WRANGLER_CI_OVERRIDE_NAME !== target.name) {
    throw new Error('Connected Worker does not match the selected target');
  }
  const config = JSON.parse(await readFile(path.join(root, target.config), 'utf8'));
  if (config.env?.production?.name !== target.name) throw new Error('Configuration target mismatch');
  let phase = 'build';
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dwnc-git-delivery-'));
  const cli = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
  try {
    // Always build from this checkout. Never consume a previous deployment bundle.
    await run(['scripts/build-cloudflare-source.mjs'], {
      cwd: root, env: environment, visible: true,
    });
    phase = 'upload';
    const output = path.join(temporary, 'upload.jsonl');
    await run([cli, 'versions', 'upload', '--config', target.config,
      '--env', 'production', '--keep-vars', '--no-experimental-auto-create'], {
      cwd: root, env: deliveryEnvironment(environment, output),
    });
    const uploadText = await readFile(output, 'utf8');
    const version = uploadedVersion(uploadText, target.name);
    await forwardBuildUpload(uploadText, environment, target.name);
    report({ event: 'git-delivery-uploaded', worker: target.name });
    phase = 'activate';
    await run([cli, 'versions', 'deploy', `${version}@100%`, '--yes',
      '--config', target.config, '--env', 'production'], {
      cwd: root, env: deliveryEnvironment(environment, path.join(temporary, 'activate.jsonl')),
    });
    report({ event: 'git-delivery-complete', worker: target.name });
  } catch {
    // Do not echo Wrangler output, tokens, binding values, or arbitrary errors.
    report({ event: 'git-delivery-failed', worker: target.name, phase,
      activationMayHaveSucceeded: phase === 'activate' });
    throw new Error('Git delivery failed; inspect the reported phase and live deployment');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || !Object.hasOwn(TARGETS, process.argv[2])) {
    console.error('Specify public or admin');
    process.exitCode = 1;
  } else {
    await deployFromGit({ target: process.argv[2] }).catch(() => {
      console.error('Git delivery did not complete. Check CI credentials or the reported phase.');
      process.exitCode = 1;
    });
  }
}
