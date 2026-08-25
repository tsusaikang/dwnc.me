import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { sha256Hex } from './lib/cloudflare-release.mjs';
import { createSealedInheritedInput } from './lib/cloudflare-process.mjs';

let assertions = 0;
const secret = `${'A'.repeat(43)}\n`;
const sealed = await createSealedInheritedInput(secret, {
  descriptor: 3, prefix: 'dwnc-secret-fixture-',
});
try {
  assert.equal(sealed.path, '/dev/fd/3'); assertions += 1;
  assert.equal(sealed.sha256, sha256Hex(secret)); assertions += 1;
  const child = spawn(process.execPath, ['-e', `
    const { readFileSync, createHash } = require('node:fs').readFileSync
      ? { readFileSync: require('node:fs').readFileSync, createHash: require('node:crypto').createHash }
      : {};
    const input = readFileSync('/dev/fd/3');
    process.stdout.write(createHash('sha256').update(input).digest('hex'));
  `], { stdio: ['ignore', 'pipe', 'pipe', sealed.fd] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  });
  assert.equal(code, 0, stderr); assertions += 1;
  assert.equal(stdout, sha256Hex(secret)); assertions += 1;
  assert.equal(stdout.includes(secret.trim()), false); assertions += 1;
} finally { await sealed.close(); }

await assert.rejects(() => createSealedInheritedInput('', {
  descriptor: 3, prefix: 'dwnc-secret-fixture-',
}), /CLOUDFLARE_E_SEALED_INPUT/u);
assertions += 1;

console.log(JSON.stringify({
  suite: 'cloudflare-sealed-inherited-input', assertions,
  inheritedDescriptor: 3, plaintextOutput: 0, status: 'PASS',
}, null, 2));
