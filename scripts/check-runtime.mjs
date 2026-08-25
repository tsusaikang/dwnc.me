import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const expected = {
  node: '24.18.0',
  packageManagerNpm: '10.9.2',
  npmRange: '>=10.9.2 <12',
};
const packageDocument = JSON.parse(await readFile('package.json', 'utf8'));
const lockDocument = JSON.parse(await readFile('package-lock.json', 'utf8'));
const nodeVersion = process.versions.node;
const npmFromEnvironment = process.env.npm_config_user_agent?.match(/npm\/([^ ]+)/u)?.[1] ?? null;
let npmVersion = npmFromEnvironment;
if (npmVersion === null) {
  try { npmVersion = (await promisify(execFile)('npm', ['--version'])).stdout.trim(); }
  catch { throw new Error('RUNTIME_E_NPM'); }
}
const parseVersion = (value) => {
  const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)$/u);
  return match ? match.slice(1).map(Number) : null;
};
const npmTuple = parseVersion(npmVersion);
const npmSupported = npmTuple !== null
  && (npmTuple[0] === 10 && (npmTuple[1] > 9 || npmTuple[1] === 9 && npmTuple[2] >= 2)
    || npmTuple[0] === 11);
if (nodeVersion !== expected.node
  || packageDocument.packageManager !== `npm@${expected.packageManagerNpm}`
  || packageDocument.engines?.node !== expected.node
  || packageDocument.engines?.npm !== expected.npmRange
  || lockDocument.packages?.['']?.engines?.node !== expected.node
  || lockDocument.packages?.['']?.engines?.npm !== expected.npmRange) throw new Error('RUNTIME_E_PIN');
if (!npmSupported) throw new Error('RUNTIME_E_NPM');
console.log(JSON.stringify({
  node: nodeVersion,
  npm: npmVersion,
  cloudflareDefaultNpm: expected.packageManagerNpm,
  npmCompatibility: expected.npmRange,
  pinned: true,
}, null, 2));
