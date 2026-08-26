import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

export const PUBLIC_MAP_LINK_POLICY_PATH = 'src/data/public-map-links-v1.json';
export const PUBLIC_MAP_LINK_CONTRACT = 'dwnc-public-map-links-v1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAP_PATH_PATTERN = /^\/media\/(?:naver|tistory)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;
const SOURCE_SET = new Set(['naver', 'tistory']);
const LINK_KIND_SET = new Set(['naver-place', 'naver-place-existing', 'naver-search']);
const byteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw new Error(code); };

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && Object.keys(value).every((key) => expected.includes(key));
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').normalize('NFC').trim();
}

function mapIdentity(record) {
  return `${record.source}:${record.sourceId}:${String(record.blockIndex).padStart(4, '0')}`;
}

function expectedHref(record) {
  if (record.linkKind === 'naver-search') {
    return `https://map.naver.com/p/search/${encodeURIComponent(`${record.title} ${record.address}`)}`;
  }
  if (record.linkKind === 'naver-place') {
    const placeId = record.href.match(/^https:\/\/map\.naver\.com\/p\/entry\/place\/([1-9]\d*)$/u)?.[1];
    return placeId ? `https://map.naver.com/p/entry/place/${placeId}` : null;
  }
  const placeId = record.href.match(
    /^https:\/\/map\.naver\.com\/p\/entry\/place\/([1-9]\d*)\?placePath=\/home$/u,
  )?.[1];
  return placeId ? `https://map.naver.com/p/entry/place/${placeId}?placePath=/home` : null;
}

export function canonicalPublicMapLinkPolicyPayload(policy) {
  return JSON.stringify({
    schemaVersion: policy.schemaVersion,
    contract: policy.contract,
    mapBlockCount: policy.mapBlockCount,
    excludedAssetCount: policy.excludedAssetCount,
    maps: policy.maps,
    excludedAssets: policy.excludedAssets,
  });
}

export function publicMapLinkPolicySha256(policy) {
  return sha256(canonicalPublicMapLinkPolicyPayload(policy));
}

export function validatePublicMapLinkPolicy(policy) {
  const documentKeys = [
    'schemaVersion', 'contract', 'mapBlockCount', 'excludedAssetCount',
    'policySha256', 'maps', 'excludedAssets',
  ];
  if (!exactKeys(policy, documentKeys)
    || policy.schemaVersion !== 1
    || policy.contract !== PUBLIC_MAP_LINK_CONTRACT
    || !Number.isSafeInteger(policy.mapBlockCount)
    || policy.mapBlockCount < 0
    || !Number.isSafeInteger(policy.excludedAssetCount)
    || policy.excludedAssetCount < 0
    || !SHA256_PATTERN.test(policy.policySha256 ?? '')
    || !Array.isArray(policy.maps)
    || !Array.isArray(policy.excludedAssets)) fail('MAP_E_POLICY_SCHEMA');

  const identities = new Set();
  let previousIdentity = null;
  for (const record of policy.maps) {
    const recordKeys = ['source', 'sourceId', 'blockIndex', 'title', 'address', 'linkKind', 'href'];
    if (!exactKeys(record, recordKeys)
      || !SOURCE_SET.has(record.source)
      || typeof record.sourceId !== 'string'
      || !/^(?:[1-9]\d{0,9}|[1-9]\d{7,13})$/u.test(record.sourceId)
      || !Number.isSafeInteger(record.blockIndex)
      || record.blockIndex < 1
      || typeof record.title !== 'string'
      || compactText(record.title) !== record.title
      || !record.title
      || typeof record.address !== 'string'
      || compactText(record.address) !== record.address
      || !record.address
      || !LINK_KIND_SET.has(record.linkKind)
      || typeof record.href !== 'string'
      || expectedHref(record) !== record.href) fail('MAP_E_POLICY_RECORD');
    const identity = mapIdentity(record);
    if (identities.has(identity)
      || previousIdentity !== null && byteCompare(previousIdentity, identity) >= 0) {
      fail('MAP_E_POLICY_ORDER');
    }
    identities.add(identity);
    previousIdentity = identity;
  }

  const excluded = new Set();
  let previousAsset = null;
  for (const publicPath of policy.excludedAssets) {
    if (typeof publicPath !== 'string'
      || !MAP_PATH_PATTERN.test(publicPath)
      || publicPath.normalize('NFC') !== publicPath
      || excluded.has(publicPath)
      || previousAsset !== null && byteCompare(previousAsset, publicPath) >= 0) {
      fail('MAP_E_POLICY_ASSET');
    }
    excluded.add(publicPath);
    previousAsset = publicPath;
  }
  if (policy.mapBlockCount !== policy.maps.length
    || policy.excludedAssetCount !== policy.excludedAssets.length
    || policy.policySha256 !== publicMapLinkPolicySha256(policy)) fail('MAP_E_POLICY_SUMMARY');
  return policy;
}

export async function loadTrackedPublicMapLinkPolicy(root, { allowMissing = false } = {}) {
  let raw;
  try { raw = await readFile(path.join(root, PUBLIC_MAP_LINK_POLICY_PATH), 'utf8'); }
  catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    fail('MAP_E_POLICY_READ');
  }
  let policy;
  try { policy = JSON.parse(raw); }
  catch { fail('MAP_E_POLICY_READ'); }
  return validatePublicMapLinkPolicy(policy);
}

function localMediaReferences($, node) {
  const references = new Set();
  node.find('*').addBack().each((_index, element) => {
    for (const attribute of ['src', 'poster', 'href', 'xlink:href', 'background']) {
      const value = $(element).attr(attribute);
      if (typeof value === 'string' && value.startsWith('/media/')) {
        references.add(value.split(/[?#]/u, 1)[0]);
      }
    }
    const style = $(element).attr('style') ?? '';
    for (const match of String(style).matchAll(/url\(\s*(['"]?)(\/media\/.*?)\1\s*\)/giu)) {
      references.add(match[2].split(/[?#]/u, 1)[0]);
    }
  });
  return references;
}

function blockDetails(block, source) {
  if (source === 'naver') {
    const article = block.find('.se_map_article, .se-map-article').first();
    return {
      title: compactText(article.find('.se_title, .se-title').first().text()),
      address: compactText(article.find('.se_address, .se-address').first().text()),
    };
  }
  const caption = compactText(block.find('figcaption').first().text());
  const separator = caption.indexOf(' · ');
  return separator > 0
    ? { title: caption.slice(0, separator), address: caption.slice(separator + 3) }
    : { title: caption, address: '' };
}

function blocksFor($, source) {
  return source === 'naver'
    ? $('.se_component.se_map, .se-component.se-map')
    : $('figure.tistory-map');
}

export function inspectPublicMapBlocks(html, data, policy) {
  const source = String(data?.source ?? '');
  const sourceId = String(data?.sourceId ?? '');
  const expected = policy.maps.filter((record) => record.source === source && record.sourceId === sourceId);
  const $ = cheerio.load(html, null, false);
  const blocks = SOURCE_SET.has(source) ? blocksFor($, source) : cheerio.load('', null, false)('missing');
  if (!expected.length && !blocks.length) return { $, blocks: [], records: [], excludedAssets: [] };
  if (!SOURCE_SET.has(source) || blocks.length !== expected.length) fail('MAP_E_BLOCK_COUNT');

  const excludedPolicy = new Set(policy.excludedAssets);
  const excludedAssets = new Set();
  const blockArray = blocks.toArray().map((element) => $(element));
  for (const [index, block] of blockArray.entries()) {
    const record = expected[index];
    if (!record || record.blockIndex !== index + 1) fail('MAP_E_BLOCK_ORDER');
    const details = blockDetails(block, source);
    if (details.title !== record.title || details.address !== record.address) fail('MAP_E_BLOCK_METADATA');
    for (const publicPath of localMediaReferences($, block)) {
      if (!excludedPolicy.has(publicPath)) fail('MAP_E_BLOCK_ASSET');
      excludedAssets.add(publicPath);
    }
  }
  return { $, blocks: blockArray, records: expected, excludedAssets: [...excludedAssets] };
}

export function removePolicyMapBlocks(html, data, policy) {
  const inspected = inspectPublicMapBlocks(html, data, policy);
  for (const block of inspected.blocks) block.remove();
  return {
    html: inspected.$.root().html() ?? html,
    excludedAssets: inspected.excludedAssets,
    mapBlocks: inspected.blocks.length,
  };
}

export function replacePolicyMapBlocks(html, data, policy) {
  const inspected = inspectPublicMapBlocks(html, data, policy);
  for (const [index, block] of inspected.blocks.entries()) {
    const record = inspected.records[index];
    const actionLabel = record.linkKind === 'naver-search'
      ? '네이버 지도에서 검색'
      : '네이버 지도에서 보기';
    const replacement = inspected.$('<aside class="public-map-link" data-map-provider="naver"></aside>');
    replacement.append(inspected.$('<strong class="public-map-link__title"></strong>').text(record.title));
    replacement.append(inspected.$('<span class="public-map-link__address"></span>').text(record.address));
    replacement.append(inspected.$('<a class="public-map-link__action"></a>')
      .attr({
        href: record.href,
        target: '_blank',
        rel: 'external noopener noreferrer',
        referrerpolicy: 'no-referrer',
        'aria-label': `${record.title} ${actionLabel}`,
      })
      .text(actionLabel));
    block.replaceWith(replacement);
  }
  return {
    html: inspected.$.root().html() ?? html,
    excludedAssets: inspected.excludedAssets,
    mapBlocks: inspected.blocks.length,
  };
}
