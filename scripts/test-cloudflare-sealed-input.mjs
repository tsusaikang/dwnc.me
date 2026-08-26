import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { sha256Hex } from './lib/cloudflare-release.mjs';
import { writeAnonymousInheritedInput } from './lib/cloudflare-process.mjs';

let assertions = 0;
const secret = `${'A'.repeat(43)}\n`;
const child = spawn(process.execPath, ['-e', `
    const { readFileSync, createHash } = require('node:fs').readFileSync
      ? { readFileSync: require('node:fs').readFileSync, createHash: require('node:crypto').createHash }
      : {};
    const input = readFileSync('/dev/fd/3');
    process.stdout.write(createHash('sha256').update(input).digest('hex'));
  `], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
const writeResultPromise = writeAnonymousInheritedInput(child.stdio[3], secret, { descriptor: 3 });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
const [sealed, code] = await Promise.all([writeResultPromise, new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  })]);
assert.equal(sealed.path, '/dev/fd/3'); assertions += 1;
assert.equal(sealed.sha256, sha256Hex(secret)); assertions += 1;
assert.equal(code, 0, stderr); assertions += 1;
assert.equal(stdout, sha256Hex(secret)); assertions += 1;
assert.equal(stdout.includes(secret.trim()), false); assertions += 1;

await assert.rejects(() => writeAnonymousInheritedInput(null, '', {
  descriptor: 3,
}), /CLOUDFLARE_E_SEALED_INPUT/u);
assertions += 1;

console.log(JSON.stringify({
  suite: 'cloudflare-sealed-inherited-input', assertions,
  inheritedDescriptor: 3, plaintextOutput: 0, status: 'PASS',
}, null, 2));
