import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import YAML from 'yaml';
import {
  inspectPublicMapBlocks,
  loadTrackedPublicMapLinkPolicy,
  publicMapLinkPolicySha256,
  removePolicyMapBlocks,
  replacePolicyMapBlocks,
  validatePublicMapLinkPolicy,
} from './lib/public-map-link-policy.mjs';

const ROOT = process.cwd();
let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
const throwsCode = (action, code) => {
  assert.throws(action, (error) => error?.message === code);
  assertions += 1;
};

function parsePost(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  assert.ok(match);
  return { data: YAML.parse(match[1]), body: raw.slice(match[0].length) };
}

const policy = await loadTrackedPublicMapLinkPolicy(ROOT);
equal(policy.mapBlockCount, 16);
equal(policy.excludedAssetCount, 99);

const identities = [...new Set(policy.maps.map((record) => `${record.source}:${record.sourceId}`))];
const excluded = new Set();
let mapBlocks = 0;
let directPlaceLinks = 0;
let searchLinks = 0;
for (const identity of identities) {
  const [source, sourceId] = identity.split(':');
  const post = parsePost(await readFile(path.join(ROOT, `src/data/posts/${source}/${sourceId}.md`), 'utf8'));
  const inspected = inspectPublicMapBlocks(post.body, post.data, policy);
  const removed = removePolicyMapBlocks(post.body, post.data, policy);
  const replaced = replacePolicyMapBlocks(post.body, post.data, policy);
  const $ = cheerio.load(replaced.html, null, false);
  mapBlocks += inspected.blocks.length;
  for (const asset of inspected.excludedAssets) excluded.add(asset);
  equal(removed.mapBlocks, inspected.blocks.length);
  equal(replaced.mapBlocks, inspected.blocks.length);
  equal($('.public-map-link').length, inspected.blocks.length);
  equal($('.se_component.se_map, .se-component.se-map, figure.tistory-map').length, 0);
  equal($('.public-map-link__action[target="_blank"][rel="external noopener noreferrer"][referrerpolicy="no-referrer"]').length,
    inspected.blocks.length);
  const expectedRecords = policy.maps.filter((record) => (
    record.source === post.data.source && record.sourceId === String(post.data.sourceId)
  ));
  $('.public-map-link__action').toArray().forEach((element, index) => {
    const record = expectedRecords[index];
    const expectedLabel = record.linkKind === 'naver-search'
      ? '네이버 지도에서 검색'
      : '네이버 지도에서 보기';
    equal($(element).text(), expectedLabel);
    equal($(element).attr('aria-label'), `${record.title} ${expectedLabel}`);
    if (record.linkKind === 'naver-search') searchLinks += 1;
    else directPlaceLinks += 1;
  });
  equal(policy.excludedAssets.some((asset) => replaced.html.includes(asset)), false);
}
equal(mapBlocks, policy.mapBlockCount);
equal(excluded.size, policy.excludedAssetCount);
equal(directPlaceLinks, 15);
equal(searchLinks, 1);

{
  const mutated = structuredClone(policy);
  mutated.policySha256 = '0'.repeat(64);
  throwsCode(() => validatePublicMapLinkPolicy(mutated), 'MAP_E_POLICY_SUMMARY');
}
{
  const mutated = structuredClone(policy);
  mutated.maps[0].href = 'https://example.com/not-a-map';
  mutated.policySha256 = publicMapLinkPolicySha256(mutated);
  throwsCode(() => validatePublicMapLinkPolicy(mutated), 'MAP_E_POLICY_RECORD');
}
{
  const record = policy.maps[0];
  const raw = await readFile(path.join(ROOT, `src/data/posts/${record.source}/${record.sourceId}.md`), 'utf8');
  const post = parsePost(raw);
  const $ = cheerio.load(post.body, null, false);
  $('.se_component.se_map, .se-component.se-map, figure.tistory-map').first().remove();
  throwsCode(
    () => inspectPublicMapBlocks($.root().html() ?? '', post.data, policy),
    'MAP_E_BLOCK_COUNT',
  );
}

console.log(JSON.stringify({
  suite: 'public-map-links',
  mapBlocks,
  excludedAssets: excluded.size,
  directPlaceLinks,
  searchLinks,
  assertions,
  status: 'PASS',
}, null, 2));
