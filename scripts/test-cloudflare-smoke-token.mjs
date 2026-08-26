import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  sanitizedEnvironment,
  stagingSmokeTokenBytesFromSecretsFile,
  writeAnonymousInheritedInput,
} from './lib/cloudflare-process.mjs';
import {
  isCanonicalStagingSmokeToken,
  stagingSmokeAuthorizationHeader,
  validateStagingSmokeToken,
} from '../src/lib/staging-smoke-token.js';
import {
  loadTrackedStagingSmokeAccessPolicy,
  stagingSmokeAccessPolicySha256,
  validateStagingSmokeAccessPolicy,
} from './lib/staging-smoke-access-policy.mjs';

const ROOT = process.cwd();
const reader = path.join(ROOT, 'scripts/test-cloudflare-smoke-token-reader.mjs');
let assertions = 0;
const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  assertions += 1;
};

async function runToken(token, { legacyEnvironment = false } = {}) {
  const tokenBytes = Buffer.from(token, 'utf8');
  const child = spawn(process.execPath, [reader], {
    cwd: ROOT,
    env: sanitizedEnvironment(process.env, {
      CLOUDFLARE_STAGING_SMOKE_TOKEN_FD: '3',
      ...(legacyEnvironment ? { CLOUDFLARE_STAGING_SMOKE_TOKEN: token } : {}),
    }),
    stdio: ['ignore', 'pipe', 'pipe', legacyEnvironment ? 'ignore' : 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const writes = legacyEnvironment
    ? Promise.resolve()
    : writeAnonymousInheritedInput(child.stdio[3], tokenBytes, {
      descriptor: 3, maximumBytes: 256,
    });
  try {
    const [, code] = await Promise.all([
      writes,
      new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      }),
    ]);
    return { code, stdout, stderr };
  } finally {
    tokenBytes.fill(0);
  }
}

const validToken = 'A'.repeat(43);
for (const [label, token, expectedCode, expectedBytes] of [
  ['canonical-32-byte-base64url', validToken, 0, 43],
  ['too-short', 'A'.repeat(42), 1, null],
  ['too-long', 'A'.repeat(44), 1, null],
  ['noncanonical-tail-bits', `${'A'.repeat(42)}B`, 1, null],
  ['padding-forbidden', `${'A'.repeat(42)}=`, 1, null],
  ['header-control-forbidden', `${'A'.repeat(41)}\r\n`, 1, null],
  ['unicode-forbidden', `${'A'.repeat(42)}가`, 1, null],
]) {
  const result = await runToken(token);
  equal(result.code, expectedCode, label);
  if (expectedBytes === null) {
    equal(result.stdout, '', `${label} stdout`);
    equal(result.stderr.includes('CLOUDFLARE_E_SMOKE_TOKEN_BYTES'), true, `${label} error`);
  } else {
    equal(JSON.parse(result.stdout).byteLength, expectedBytes, `${label} bytes`);
    equal(JSON.parse(result.stdout).secretPrinted, false, `${label} output`);
  }
}

{
  const result = await runToken(validToken, { legacyEnvironment: true });
  equal(result.code, 1);
  equal(result.stderr.includes('CLOUDFLARE_E_SMOKE_TOKEN_ENV_FORBIDDEN'), true);
}

for (const [token, accepted] of [
  [validToken, true],
  ['A'.repeat(42), false],
  ['A'.repeat(44), false],
  [`${'A'.repeat(42)}B`, false],
  [`${'A'.repeat(42)}=`, false],
  [`${'A'.repeat(42)}가`, false],
]) {
  const stored = Buffer.from(`${JSON.stringify({ DWNC_STAGING_SMOKE_TOKEN: token })}\n`);
  try {
    if (accepted) {
      const parsed = stagingSmokeTokenBytesFromSecretsFile(stored);
      equal(parsed.byteLength, Buffer.byteLength(token, 'utf8'));
      parsed.fill(0);
    } else {
      assert.throws(() => stagingSmokeTokenBytesFromSecretsFile(stored),
        /CLOUDFLARE_E_STAGING_SECRET_FILE/u);
      assertions += 1;
    }
  } finally { stored.fill(0); }
}

for (const malformed of [
  `${JSON.stringify({ DWNC_STAGING_SMOKE_TOKEN: validToken })}\r\n`,
  `${JSON.stringify({ DWNC_STAGING_SMOKE_TOKEN: validToken })}\n\n`,
  `${JSON.stringify({ DWNC_STAGING_SMOKE_TOKEN: validToken }, null, 2)}\n`,
]) {
  const stored = Buffer.from(malformed);
  try {
    assert.throws(() => stagingSmokeTokenBytesFromSecretsFile(stored),
      /CLOUDFLARE_E_STAGING_SECRET_FILE/u);
    assertions += 1;
  } finally { stored.fill(0); }
}

equal(isCanonicalStagingSmokeToken(validToken), true);
equal(validateStagingSmokeToken(validToken), validToken);
equal(stagingSmokeAuthorizationHeader(validToken), `Bearer ${validToken}`);
for (const invalid of [`${validToken}\r\n`, `${'A'.repeat(42)}B`, `x ${validToken}`]) {
  equal(isCanonicalStagingSmokeToken(invalid), false);
  assert.throws(() => stagingSmokeAuthorizationHeader(invalid), /CLOUDFLARE_E_SMOKE_TOKEN_BYTES/u);
  assertions += 1;
}
const headers = new Headers({ authorization: stagingSmokeAuthorizationHeader(validToken) });
equal(headers.get('authorization'), `Bearer ${validToken}`);

const accessPolicy = await loadTrackedStagingSmokeAccessPolicy(ROOT);
equal(accessPolicy.authentication.randomBytes, 32);
equal(accessPolicy.authentication.encodedCharacters, 43);
equal(accessPolicy.authentication.encoding, 'base64url');
equal(accessPolicy.authentication.padding, 'forbidden');
equal(accessPolicy.authentication.canonicalEncodingRequired, true);
equal(stagingSmokeAccessPolicySha256(accessPolicy),
  'd6c554c1d80c68c08605636f12f26a411f7826bc40eddaee9233a30b6551781a');
for (const authentication of [
  { ...accessPolicy.authentication, randomBytes: 31 },
  { ...accessPolicy.authentication, encodedCharacters: 44 },
  { ...accessPolicy.authentication, encoding: 'base64' },
  { ...accessPolicy.authentication, padding: 'required' },
  { ...accessPolicy.authentication, canonicalEncodingRequired: false },
]) {
  assert.throws(() => validateStagingSmokeAccessPolicy({ ...accessPolicy, authentication }),
    /CLOUDFLARE_E_STAGING_SMOKE_ACCESS_POLICY/u);
  assertions += 1;
}

const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
for (const name of [
  'cloudflare:staging:smoke', 'cloudflare:staging:admission-smoke',
]) {
  equal(packageJson.scripts[name].includes('run-with-staging-smoke-token.mjs'), true, name);
}
equal(packageJson.scripts['cloudflare:staging:media-probe']
  .includes('run-with-r2-credentials.mjs --command=staging-media-probe'), true);
for (const name of [
  'media:r2:dry-run', 'media:r2:apply', 'media:r2:staging:admit-one', 'media:r2:audit:full',
]) {
  equal(packageJson.scripts[name].includes('run-with-r2-credentials.mjs'), true, name);
}

console.log(JSON.stringify({
  suite: 'cloudflare-staging-smoke-token', assertions,
  decodedRandomBytes: 32, encodedCharacters: 43, canonicalBase64Url: true,
  plaintextOutput: 0, status: 'PASS',
}, null, 2));
