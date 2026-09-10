import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { deployFromGit, deliveryEnvironment, uploadedVersion, forwardBuildUpload } from './deploy-cloudflare-git.mjs';

import os from 'node:os';
import path from 'node:path';

const id = '10000000-0000-4000-8000-000000000001';
const environment = { CI: '1', CLOUDFLARE_API_TOKEN: 'synthetic-not-a-token',
  CLOUDFLARE_ACCOUNT_ID: '0'.repeat(32), WRANGLER_CI_MATCH_TAG: 'synthetic-tag' };
function receipt(name) {
  return { type: 'version-upload', version: 1, worker_name: name,
    wrangler_environment: 'production', version_id: id };
}
async function scenario(target, failure, badReceipt = false) {
  const calls = [], events = [];
  const name = target === 'public' ? 'dwnc-me' : 'dwnc-me-admin';
  const operation = deployFromGit({ target,
    environment: { ...environment, WRANGLER_CI_OVERRIDE_NAME: name },
    report: (event) => events.push(event), run: async (args, options) => {
      calls.push(args);
      assert.equal(options.env.WRANGLER_CI_MATCH_TAG, 'synthetic-tag');
      assert.equal(options.env.WRANGLER_CI_OVERRIDE_NAME, name);
      if (calls.length === failure) throw new Error('synthetic secret must not be reported');
      if (args[2] === 'upload') {
        await writeFile(options.env.WRANGLER_OUTPUT_FILE_PATH,
          JSON.stringify(receipt(badReceipt ? 'wrong-worker' : name)) + '\n');
      }
    } });
  if (failure || badReceipt) await assert.rejects(operation);
  else await operation;
  assert(!JSON.stringify(events).includes('synthetic secret'));
  return { calls, events };
}
for (const target of ['public', 'admin']) {
  const success = await scenario(target);
  assert.equal(success.calls.length, 3);
  assert.deepEqual(success.calls.slice(1).map((args) => args.slice(1, 3)),
    [['versions', 'upload'], ['versions', 'deploy']]);
  assert.equal(success.calls[2][3], `${id}@100%`);
  assert(success.calls[1].includes('--keep-vars'));
  assert(success.calls[1].includes('--no-experimental-auto-create'));
  for (const failure of [1, 2]) {
    const result = await scenario(target, failure);
    assert(!result.calls.some((args) => args[2] === 'deploy'));
  }
  const bad = await scenario(target, undefined, true);
  assert(!bad.calls.some((args) => args[2] === 'deploy'));
  const failedActivation = await scenario(target, 3);
  assert.equal(failedActivation.events.at(-1).activationMayHaveSucceeded, true);
  assert(!failedActivation.events.some((event) => event.event === 'git-delivery-complete'));
}
for (const bad of [{ ...receipt('dwnc-me'), version_id: null },
  { ...receipt('dwnc-me'), wrangler_environment: 'staging' }]) {
  assert.throws(() => uploadedVersion(JSON.stringify(bad), 'dwnc-me'));
}
assert.throws(() => uploadedVersion(JSON.stringify(receipt('dwnc-me')) + '\n'
  + JSON.stringify(receipt('dwnc-me')), 'dwnc-me'));
assert.equal(uploadedVersion(JSON.stringify(receipt('dwnc-me')), 'dwnc-me'), id);
await assert.rejects(deployFromGit({ target: 'admin',
  environment: { ...environment, WRANGLER_CI_OVERRIDE_NAME: 'dwnc-me' },
  run: () => assert.fail('must reject before process invocation') }));
for (const key of ['WRANGLER_CI_OVERRIDE_NAME', 'WRANGLER_CI_MATCH_TAG']) {
  assert.equal(deliveryEnvironment({ [key]: 'preserved' }, '/tmp/fake')[key], 'preserved');
}
await assert.rejects(deployFromGit({ target: 'public', environment: {},
  run: () => assert.fail('requires CI') }));
const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'dwnc-git-output-test-'));
try {
  const outputFile = path.join(outputRoot, 'file.json');
  const outputDirectory = path.join(outputRoot, 'directory');
  const nativeEvent = { ...receipt('dwnc-me'), timestamp: '2026-09-10T00:00:00.000Z' };
  const eventText = JSON.stringify({ type: 'wrangler-session', command_line_args: ['not forwarded'] })
    + '\n' + JSON.stringify(nativeEvent) + '\n';
  await writeFile(outputFile, 'existing\n');
  await forwardBuildUpload(eventText, { WRANGLER_OUTPUT_FILE_PATH: outputFile,
    WRANGLER_OUTPUT_FILE_DIRECTORY: outputDirectory }, 'dwnc-me');
  assert.equal(await readFile(outputFile, 'utf8'), 'existing\n' + JSON.stringify(nativeEvent) + '\n');
  await assert.rejects(readdir(outputDirectory));
  await forwardBuildUpload(eventText, { WRANGLER_OUTPUT_FILE_DIRECTORY: outputDirectory }, 'dwnc-me');
  const files = await readdir(outputDirectory);
  assert.equal(files.length, 1);
  assert.equal(await readFile(path.join(outputDirectory, files[0]), 'utf8'), JSON.stringify(nativeEvent) + '\n');
  await assert.rejects(forwardBuildUpload(eventText, { WRANGLER_OUTPUT_FILE_PATH: outputFile }, 'dwnc-me-admin'));
} finally { await rm(outputRoot, { recursive: true, force: true }); }
console.log('cloudflare-git-delivery: PASS (mock only, no network or deployment)');
