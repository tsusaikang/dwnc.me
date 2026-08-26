import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import YAML from 'yaml';
import {
  PUBLIC_MAP_LINK_CONTRACT,
  PUBLIC_MAP_LINK_POLICY_PATH,
  inspectPublicMapBlocks,
  loadTrackedPublicMapLinkPolicy,
  publicMapLinkPolicySha256,
  replacePolicyMapBlocks,
  validatePublicMapLinkPolicy,
} from './lib/public-map-link-policy.mjs';

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => arg !== '--write-from-preservation')) throw new Error('MAP_E_ARGUMENT');
const byteCompare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const compactText = (value) => String(value ?? '').replace(/\s+/gu, ' ').normalize('NFC').trim();

function frontmatterAndBody(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new Error('MAP_E_CONTENT_FRONTMATTER');
  return { data: YAML.parse(match[1]), body: raw.slice(match[0].length) };
}

function normalizedMapDetails(source, body) {
  const $ = cheerio.load(body, null, false);
  const blocks = source === 'naver'
    ? $('.se_component.se_map, .se-component.se-map')
    : $('figure.tistory-map');
  return blocks.toArray().map((element) => {
    const block = $(element);
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
  });
}

async function naverEvidence(sourceId) {
  const manifestPath = path.join(ROOT, `migration/raw/naver/${sourceId}/recapture-v2/manifest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const raw = await readFile(path.join(ROOT, manifest.files.content.path), 'utf8');
  const normalizedRaw = await readFile(path.join(ROOT, `src/data/posts/naver/${sourceId}.md`), 'utf8');
  const normalized = frontmatterAndBody(normalizedRaw);
  const details = normalizedMapDetails('naver', normalized.body);
  const $ = cheerio.load(raw, null, false);
  const blocks = $('.se_component.se_map, .se-component.se-map');
  if (blocks.length !== details.length) throw new Error('MAP_E_PRESERVATION_BLOCK_COUNT');
  return blocks.toArray().map((element, index) => {
    const block = $(element);
    const article = block.find('.se_map_article, .se-map-article').first();
    const title = compactText(article.find('.se_title, .se-title').first().text());
    const address = compactText(article.find('.se_address, .se-address').first().text());
    const metadata = block.find('[data-linkdata]').toArray()
      .map((node) => {
        try { return JSON.parse($(node).attr('data-linkdata') ?? ''); }
        catch { return null; }
      })
      .find((value) => value?.eventTarget === 'button');
    if (!metadata
      || metadata.searchEngine !== 'NAVER'
      || !/^[1-9]\d*$/u.test(String(metadata.locationId ?? ''))
      || title !== details[index]?.title
      || address !== details[index]?.address) throw new Error('MAP_E_PRESERVATION_METADATA');
    return {
      source: 'naver',
      sourceId,
      blockIndex: index + 1,
      title,
      address,
      linkKind: 'naver-place',
      href: `https://map.naver.com/p/entry/place/${metadata.locationId}`,
    };
  });
}

async function tistoryEvidence(sourceId) {
  const raw = await readFile(path.join(ROOT, `migration/raw/tistory/${sourceId}/page.html`), 'utf8');
  const normalizedRaw = await readFile(path.join(ROOT, `src/data/posts/tistory/${sourceId}.md`), 'utf8');
  const normalized = frontmatterAndBody(normalizedRaw);
  const details = normalizedMapDetails('tistory', normalized.body);
  const $ = cheerio.load(raw);
  const frames = $('iframe[data-ke-type="map"][data-maps-data]');
  if (frames.length !== details.length) throw new Error('MAP_E_PRESERVATION_BLOCK_COUNT');
  return frames.toArray().map((element, index) => {
    const parameters = new URLSearchParams($(element).attr('data-maps-data') ?? '');
    const title = compactText(parameters.get('title'));
    const address = compactText(parameters.get('addr'));
    if (title !== details[index]?.title || address !== details[index]?.address) {
      throw new Error('MAP_E_PRESERVATION_METADATA');
    }
    const existingNaverPlace = sourceId === '130'
      ? $('figure[data-ke-type="opengraph"][data-og-url^="https://map.naver.com/p/entry/place/"]')
        .first().attr('data-og-url')
      : null;
    return {
      source: 'tistory',
      sourceId,
      blockIndex: index + 1,
      title,
      address,
      linkKind: existingNaverPlace ? 'naver-place-existing' : 'naver-search',
      href: existingNaverPlace
        ?? `https://map.naver.com/p/search/${encodeURIComponent(`${title} ${address}`)}`,
    };
  });
}

async function allContentRows() {
  const rows = [];
  for (const source of ['naver', 'tistory']) {
    const directory = path.join(ROOT, `src/data/posts/${source}`);
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.md')) continue;
      const parsed = frontmatterAndBody(await readFile(path.join(directory, name), 'utf8'));
      rows.push(parsed);
    }
  }
  return rows;
}

async function validateAgainstNormalizedContent(policy) {
  const actualAssets = new Set();
  let mapBlocks = 0;
  for (const row of await allContentRows()) {
    const inspected = inspectPublicMapBlocks(row.body, row.data, policy);
    mapBlocks += inspected.blocks.length;
    for (const publicPath of inspected.excludedAssets) actualAssets.add(publicPath);
    const replaced = replacePolicyMapBlocks(row.body, row.data, policy);
    const replacementDocument = cheerio.load(replaced.html, null, false);
    const replacementLinks = replacementDocument('.public-map-link__action').toArray();
    const expectedRecords = policy.maps.filter((record) => (
      record.source === row.data.source && record.sourceId === String(row.data.sourceId)
    ));
    const presentationExact = replacementLinks.length === expectedRecords.length
      && replacementLinks.every((element, index) => {
        const record = expectedRecords[index];
        const label = record.linkKind === 'naver-search'
          ? '네이버 지도에서 검색'
          : '네이버 지도에서 보기';
        const link = replacementDocument(element);
        return compactText(link.text()) === label
          && link.attr('aria-label') === `${record.title} ${label}`;
      });
    if (replaced.mapBlocks !== inspected.blocks.length
      || replaced.html.includes('class="tistory-map"')
      || /class="[^"]*(?:se_map|se-map)[^"]*"/u.test(replaced.html)
      || replaced.excludedAssets.some((asset) => replaced.html.includes(asset))
      || !presentationExact) {
      throw new Error('MAP_E_REPLACEMENT');
    }
  }
  const actual = [...actualAssets].sort(byteCompare);
  if (mapBlocks !== policy.mapBlockCount
    || JSON.stringify(actual) !== JSON.stringify(policy.excludedAssets)) {
    throw new Error('MAP_E_POLICY_CONTENT_DRIFT');
  }
  return { mapBlocks, excludedAssets: actual.length };
}

async function generateFromPreservation() {
  const maps = [
    ...await naverEvidence('220811045462'),
    ...await naverEvidence('220815478695'),
    ...await naverEvidence('221065933692'),
    ...await tistoryEvidence('7'),
    ...await tistoryEvidence('130'),
  ].sort((left, right) => byteCompare(
    `${left.source}:${left.sourceId}:${String(left.blockIndex).padStart(4, '0')}`,
    `${right.source}:${right.sourceId}:${String(right.blockIndex).padStart(4, '0')}`,
  ));
  const draft = {
    schemaVersion: 1,
    contract: PUBLIC_MAP_LINK_CONTRACT,
    mapBlockCount: maps.length,
    excludedAssetCount: 0,
    policySha256: '',
    maps,
    excludedAssets: [],
  };

  // The normalized public bodies are the exact join between preserved map blocks
  // and their local platform assets. A temporary policy with a broad candidate set
  // lets the strict inspector derive the final unique exclusion set.
  const candidateAssets = new Set();
  for (const { data, body } of await allContentRows()) {
    const $ = cheerio.load(body, null, false);
    const blocks = data.source === 'naver'
      ? $('.se_component.se_map, .se-component.se-map')
      : $('figure.tistory-map');
    blocks.find('*').addBack().each((_index, element) => {
      for (const attribute of ['src', 'poster', 'href', 'xlink:href', 'background']) {
        const value = $(element).attr(attribute);
        if (value?.startsWith('/media/')) candidateAssets.add(value.split(/[?#]/u, 1)[0]);
      }
      for (const match of String($(element).attr('style') ?? '')
        .matchAll(/url\(\s*(['"]?)(\/media\/.*?)\1\s*\)/giu)) {
        candidateAssets.add(match[2].split(/[?#]/u, 1)[0]);
      }
    });
  }
  draft.excludedAssets = [...candidateAssets].sort(byteCompare);
  draft.excludedAssetCount = draft.excludedAssets.length;
  draft.policySha256 = publicMapLinkPolicySha256(draft);
  validatePublicMapLinkPolicy(draft);
  await validateAgainstNormalizedContent(draft);
  return draft;
}

let policy;
if (args.has('--write-from-preservation')) {
  policy = await generateFromPreservation();
  const target = path.join(ROOT, PUBLIC_MAP_LINK_POLICY_PATH);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  await rename(temporary, target);
} else {
  policy = await loadTrackedPublicMapLinkPolicy(ROOT);
}
const report = await validateAgainstNormalizedContent(policy);
console.log(JSON.stringify({
  mode: args.has('--write-from-preservation') ? 'write-from-preservation' : 'check',
  ...report,
  policySha256: policy.policySha256,
}, null, 2));
