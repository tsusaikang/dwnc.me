import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeMediaReplacementSql } from './lib/native-media-replacement.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4 || path.resolve(input) === path.resolve(output)) {
  throw new Error('Usage: node scripts/prepare-native-media-replacement.mjs PRIVATE_INPUT.json PRIVATE_OUTPUT.sql');
}
const replacements = JSON.parse(await readFile(input, 'utf8'));
const sql = nativeMediaReplacementSql(replacements);
await writeFile(output, sql, { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ prepared: replacements.length, executed: false, requiresVerifiedNewR2Objects: true }));
