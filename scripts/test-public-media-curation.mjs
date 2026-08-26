import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import YAML from 'yaml';
import { loadTrackedPublicMapLinkPolicy } from './lib/public-map-link-policy.mjs';
import {
  applyPublicMediaCuration,
  effectivePublicMediaPresentationData,
  inspectPolicyPlaceholderAssets,
  inspectPolicyStickerAssets,
  loadTrackedPublicMediaCurationPolicy,
  publicMediaCurationExcludedAssets,
  publicMediaCurationPolicySha256,
  removePolicyPlaceholderAssets,
  removePolicyStickerAssets,
  validatePublicMediaCurationPolicy,
} from './lib/public-media-curation.mjs';
import {
  collectProjectedPublicMedia,
  loadTrackedPublicMediaManifest,
} from './lib/public-media-manifest.mjs';

const ROOT = process.cwd();
let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
const deepEqual = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const throwsCode = (action, code) => {
  assert.throws(action, (error) => error?.message === code);
  assertions += 1;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function parsePost(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  assert.ok(match);
  return { data: YAML.parse(match[1]), body: raw.slice(match[0].length) };
}

async function loadPost(sourceId) {
  return parsePost(await readFile(path.join(ROOT, `src/data/posts/naver/${sourceId}.md`), 'utf8'));
}

function compactText(value) {
  return String(value)
    .replace(/[\u00a0\u200b-\u200d\ufeff]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .normalize('NFC')
    .trim();
}

function semanticText(value) {
  return compactText(value).replace(/\s+/gu, '');
}

const policy = await loadTrackedPublicMediaCurationPolicy(ROOT);
const mapPolicy = await loadTrackedPublicMapLinkPolicy(ROOT);
const trackedManifest = await loadTrackedPublicMediaManifest(ROOT);
const trackedByPath = new Map(trackedManifest.entries.map((entry) => [entry.publicPath, entry]));
equal(policy.stickerExclusionCount, 5);
equal(policy.authoredPlatformAssetCount, 1);
equal(policy.placeholderExclusion.objectCount, 27);
equal(policy.placeholderExclusion.videoPosterOccurrenceCount, 53);
equal(policy.policySha256, publicMediaCurationPolicySha256(policy));

const stickerIdentities = [...new Set(policy.stickerExclusions.map((record) => record.sourceId))];
deepEqual(stickerIdentities, ['220522768720', '220535695526']);
let removedStickers = 0;
const curatedStickerPosts = new Map();
for (const sourceId of stickerIdentities) {
  const post = await loadPost(sourceId);
  const beforeText = semanticText(cheerio.load(post.body, null, false).root().text());
  const inspected = inspectPolicyStickerAssets(post.body, post.data, policy);
  const transformed = removePolicyStickerAssets(post.body, post.data, policy);
  const $ = cheerio.load(transformed.html, null, false);
  removedStickers += transformed.removedStickers;
  curatedStickerPosts.set(sourceId, { $, transformed });
  equal(transformed.removedStickers, inspected.occurrences.length);
  equal(semanticText($.root().text()), beforeText);
  equal($('a[href^="http://m.gfmarket.naver.com/sticker/detail/code/"]').length, 0);
  for (const record of policy.stickerExclusions.filter((item) => item.sourceId === sourceId)) {
    equal(transformed.html.includes(record.publicPath), false);
  }
}
equal(removedStickers, 5);

function emptyParagraphsBetween($, leftPattern, rightPattern) {
  const paragraphs = $('.post-view > p').toArray();
  const left = paragraphs.findIndex((element) => leftPattern.test(compactText($(element).text())));
  const right = paragraphs.findIndex((element) => rightPattern.test(compactText($(element).text())));
  assert.ok(left >= 0 && right > left);
  assertions += 1;
  return paragraphs.slice(left + 1, right).filter((element) => {
    const paragraph = $(element).clone();
    paragraph.find('br').remove();
    return !compactText(paragraph.text())
      && !paragraph.find('img, video, iframe, svg, object, embed, table, ul, ol').length;
  }).length;
}

{
  const { $, transformed } = curatedStickerPosts.get('220522768720');
  equal(transformed.removedParagraphs, 3);
  equal(transformed.removedAdjacentEmptyWrappers, 6);
  equal(emptyParagraphsBetween($, /새로 바꾸고 있는 타이밍대로/u, /^에헤\?+/u), 0);
  equal(emptyParagraphsBetween($, /^으하하/u, /^선생님들이 손발 콤비/u), 0);
  equal(emptyParagraphsBetween($, /새 타이밍을 몸이 무의식적으로/u, /^아마,/u), 0);
}
{
  const { $, transformed } = curatedStickerPosts.get('220535695526');
  equal(transformed.removedParagraphs, 1);
  equal(transformed.removedAdjacentEmptyWrappers, 5);
  equal(emptyParagraphsBetween($, /나중에 안 사실인데/u, /^음\.\.\. 홈페이지 안내대로/u), 0);
  equal(emptyParagraphsBetween($, /^여기는 9시에 문을 닫기/u, /^무슨 소리인지/u), 0);
  const homepageParagraph = $('.post-view > p').filter((_index, element) => (
    /^음\.\.\. 홈페이지 안내대로/u.test(compactText($(element).text()))
  )).first();
  equal(homepageParagraph.find('br').length, 0);
}

const stickerCoverPost = await loadPost('220522768720');
equal(stickerCoverPost.data.cover, '/media/naver/220522768720/003-507546e2d704.png');
equal(stickerCoverPost.data.coverAlt, 'line_characters_in_love-5');
const stickerCoverSourceBytes = await readFile(path.join(ROOT, 'src/data/posts/naver/220522768720.md'));
const stickerCoverSourceSha256 = sha256(stickerCoverSourceBytes);
equal(stickerCoverSourceSha256, 'a00ee1a40e87fcfe20bdd8b8d8598f548e985b08a019dea33717a8974db0092b');
const stickerCoverPresentation = effectivePublicMediaPresentationData(stickerCoverPost.data, policy);
deepEqual(stickerCoverPresentation, {
  cover: undefined,
  coverAlt: '',
  suppressedStickerCover: true,
  replacedPlaceholderCover: false,
});
const reappliedStickerCoverPresentation = effectivePublicMediaPresentationData({
  ...stickerCoverPost.data,
  cover: stickerCoverPresentation.cover,
  coverAlt: stickerCoverPresentation.coverAlt,
}, policy);
equal(reappliedStickerCoverPresentation.cover, undefined);
equal(reappliedStickerCoverPresentation.coverAlt, '');
equal(stickerCoverPost.data.cover, '/media/naver/220522768720/003-507546e2d704.png');
equal(stickerCoverPost.data.coverAlt, 'line_characters_in_love-5');
equal(compactText(stickerCoverPost.body).includes('에헤?????'), true);
equal(compactText(stickerCoverPost.body).includes('으하하하하하허하허하허하허하허'), true);
const otherStickerPost = await loadPost('220535695526');
equal(compactText(otherStickerPost.body).includes('음... 홈페이지 안내대로라면'), true);
equal(compactText(otherStickerPost.body).includes('무슨 소리인지 완전히 이해가 되었다.'), true);

{
  const drifted = structuredClone(policy);
  drifted.policySha256 = '0'.repeat(64);
  throwsCode(() => validatePublicMediaCurationPolicy(drifted), 'CURATION_E_POLICY_SUMMARY');
}
{
  const drifted = structuredClone(policy);
  drifted.authoredPlatformAssets[0].size += 1;
  drifted.policySha256 = publicMediaCurationPolicySha256(drifted);
  throwsCode(() => validatePublicMediaCurationPolicy(drifted), 'CURATION_E_AUTHORED_PLATFORM_ASSET');
}
{
  const record = policy.stickerExclusions[0];
  const post = await loadPost(record.sourceId);
  const drifted = post.body.replace(`alt="${record.alt}"`, 'alt="drifted-sticker"');
  throwsCode(() => inspectPolicyStickerAssets(drifted, post.data, policy), 'CURATION_E_STICKER_MARKUP');
  throwsCode(
    () => inspectPolicyStickerAssets(post.body, {
      ...post.data,
      cover: record.publicPath,
      coverAlt: 'drifted-sticker-cover',
    }, policy),
    'CURATION_E_STICKER_COVER',
  );
}
{
  const unrelatedPath = '/media/naver/229999999999/001-not-curated.png';
  const unrelatedMarkup = `<p data-unrelated-empty-before><br></p><p>앞<a href="http://m.gfmarket.naver.com/sticker/detail/code/not_curated"><img src="${unrelatedPath}" alt="다른 스티커"></a>뒤</p><div data-unrelated-empty-after><span><br></span></div>`;
  const transformed = removePolicyStickerAssets(
    unrelatedMarkup,
    { source: 'naver', sourceId: '229999999999' },
    policy,
  );
  equal(transformed.removedStickers, 0);
  equal(transformed.html.includes(unrelatedPath), true);
  equal(semanticText(cheerio.load(transformed.html, null, false).root().text()), '앞뒤');
  const $ = cheerio.load(transformed.html, null, false);
  equal($('[data-unrelated-empty-before]').length, 1);
  equal($('[data-unrelated-empty-after]').length, 1);
}
{
  const record = policy.stickerExclusions[0];
  const post = await loadPost(record.sourceId);
  const $fixture = cheerio.load(post.body, null, false);
  const stickerBlock = $fixture(`img[src="${record.publicPath}"]`).closest('p');
  stickerBlock.before('<p data-policy-outside-empty><br></p><p data-policy-semantic-barrier>보존 장벽</p>');
  const transformed = removePolicyStickerAssets($fixture.root().html(), post.data, policy);
  const $ = cheerio.load(transformed.html, null, false);
  equal($('[data-policy-semantic-barrier]').text(), '보존 장벽');
  equal($('[data-policy-outside-empty]').length, 1);
}

const authoredSbsGif = policy.authoredPlatformAssets[0];
deepEqual(trackedByPath.get(authoredSbsGif.publicPath), {
  publicPath: authoredSbsGif.publicPath,
  key: authoredSbsGif.publicPath.slice(1),
  size: authoredSbsGif.size,
  sha256: authoredSbsGif.sha256,
  contentType: authoredSbsGif.contentType,
  cacheControl: 'public, max-age=31536000, immutable',
});
const sbsBytes = await readFile(path.join(ROOT, 'public', authoredSbsGif.publicPath.slice(1)));
equal(sbsBytes.length, authoredSbsGif.size);
equal(sha256(sbsBytes), authoredSbsGif.sha256);
equal(sbsBytes.subarray(0, 6).toString('ascii').startsWith('GIF8'), true);
const sbsPost = await loadPost(authoredSbsGif.sourceId);
equal(sbsPost.data.cover, authoredSbsGif.publicPath);
const sbsCurated = applyPublicMediaCuration(sbsPost.body, sbsPost.data, policy).html;
const $sbs = cheerio.load(sbsCurated, null, false);
equal($sbs(`img[src="${authoredSbsGif.publicPath}"]`).length, 1);

const placeholder = policy.placeholderExclusion;
const posterPaths = new Set(placeholder.videoPosters.map((record) => record.publicPath));
const curationExcludedAssets = publicMediaCurationExcludedAssets(policy);
equal(curationExcludedAssets.size, 32);
equal(curationExcludedAssets.has(authoredSbsGif.publicPath), false);
equal(policy.stickerExclusions.every((record) => curationExcludedAssets.has(record.publicPath)), true);
equal(placeholder.videoPosters.every((record) => curationExcludedAssets.has(record.publicPath)), true);
equal(curationExcludedAssets.has(placeholder.spacingGif.publicPath), true);

let posterOccurrences = 0;
let removedPosterOccurrences = 0;
const sourceFileDigests = new Map();
for (const poster of placeholder.videoPosters) {
  equal(trackedByPath.has(poster.publicPath), false);
  const sourceFile = path.join(ROOT, `src/data/posts/naver/${poster.sourceId}.md`);
  const sourceBytes = await readFile(sourceFile);
  sourceFileDigests.set(poster.sourceId, sha256(sourceBytes));
  const post = parsePost(sourceBytes.toString('utf8'));
  const $ = cheerio.load(post.body, null, false);
  const videos = $(`video[poster="${poster.publicPath}"]`);
  equal(videos.length, poster.occurrences);
  videos.each((_index, element) => {
    equal($(element).attr('src'), undefined);
    equal($(element).find('source[src]').length, 0);
  });
  const inspected = inspectPolicyPlaceholderAssets(post.body, post.data, policy);
  equal(inspected.posters.length, poster.occurrences);
  const transformed = removePolicyPlaceholderAssets(post.body, post.data, policy);
  const $derived = cheerio.load(transformed.html, null, false);
  equal(transformed.removedVideoPosters, poster.occurrences);
  equal($derived('video').length, $('video').length);
  equal($derived(`video[poster="${poster.publicPath}"]`).length, 0);
  equal($derived('.pzp-duration-indicator').text(), $('.pzp-duration-indicator').text());
  equal($derived('.se_mediaCaption').text(), $('.se_mediaCaption').text());
  equal(semanticText($derived.root().text()), semanticText($.root().text()));
  const bytes = await readFile(path.join(ROOT, 'public', poster.publicPath.slice(1)));
  equal(bytes.length, placeholder.videoPosterSize);
  equal(sha256(bytes), placeholder.videoPosterSha256);
  posterOccurrences += videos.length;
  removedPosterOccurrences += transformed.removedVideoPosters;
}
equal(posterOccurrences, placeholder.videoPosterOccurrenceCount);
equal(removedPosterOccurrences, placeholder.videoPosterOccurrenceCount);

const observedPlaceholderCovers = [];
for (const filename of await readdir(path.join(ROOT, 'src/data/posts/naver'))) {
  if (!filename.endsWith('.md')) continue;
  const post = parsePost(await readFile(path.join(ROOT, 'src/data/posts/naver', filename), 'utf8'));
  if (posterPaths.has(post.data.cover)) {
    observedPlaceholderCovers.push({
      source: post.data.source,
      sourceId: post.data.sourceId,
      excludedCover: post.data.cover,
      sourceCoverAlt: post.data.coverAlt,
    });
  }
}
observedPlaceholderCovers.sort((left, right) => (
  Buffer.compare(Buffer.from(left.excludedCover), Buffer.from(right.excludedCover))
));
deepEqual(observedPlaceholderCovers, placeholder.coverReplacements.map((record) => ({
  source: record.source,
  sourceId: record.sourceId,
  excludedCover: record.excludedCover,
  sourceCoverAlt: record.sourceCoverAlt,
})));
for (const replacement of placeholder.coverReplacements) {
  const sourceFile = path.join(ROOT, `src/data/posts/naver/${replacement.sourceId}.md`);
  const sourceBytes = await readFile(sourceFile);
  sourceFileDigests.set(replacement.sourceId, sha256(sourceBytes));
  const post = parsePost(sourceBytes.toString('utf8'));
  equal(post.data.cover, replacement.excludedCover);
  equal(post.data.coverAlt, replacement.sourceCoverAlt);
  const $ = cheerio.load(post.body, null, false);
  const eligible = $('img[src^="/media/"]').toArray().filter((element) => (
    !curationExcludedAssets.has($(element).attr('src'))
      && !mapPolicy.excludedAssets.includes($(element).attr('src'))
  ));
  equal(eligible.length, replacement.eligibleCandidateCount);
  equal(replacement.selectionRule, 'first-body-owned-nonexcluded-image');
  const presentation = effectivePublicMediaPresentationData(post.data, policy);
  deepEqual(presentation, {
    cover: undefined,
    coverAlt: '',
    suppressedStickerCover: false,
    replacedPlaceholderCover: true,
  });
  equal(post.data.cover, replacement.excludedCover);
  equal(post.data.coverAlt, replacement.sourceCoverAlt);
}

const spacingGif = placeholder.spacingGif;
equal(trackedByPath.has(spacingGif.publicPath), false);
const spacingBytes = await readFile(path.join(ROOT, 'public', spacingGif.publicPath.slice(1)));
equal(spacingBytes.length, spacingGif.size);
equal(sha256(spacingBytes), spacingGif.sha256);
const spacingSourceFile = path.join(ROOT, `src/data/posts/naver/${spacingGif.sourceId}.md`);
const spacingSourceBytes = await readFile(spacingSourceFile);
sourceFileDigests.set(spacingGif.sourceId, sha256(spacingSourceBytes));
const spacingPost = parsePost(spacingSourceBytes.toString('utf8'));
const $spacing = cheerio.load(spacingPost.body, null, false);
equal(
  $spacing(`img[src="${spacingGif.publicPath}"][alt=""].${spacingGif.requiredClass}`).length,
  spacingGif.occurrences,
);
equal(spacingPost.data.cover === spacingGif.publicPath, false);
const spacingTransformed = removePolicyPlaceholderAssets(spacingPost.body, spacingPost.data, policy);
const $spacingDerived = cheerio.load(spacingTransformed.html, null, false);
equal(spacingTransformed.removedSpacingGifs, 1);
equal(spacingTransformed.removedSpacingWrappers, 1);
equal($spacingDerived(`img[src="${spacingGif.publicPath}"]`).length, 0);
equal($spacingDerived('img[src="/media/naver/220543741334/001-2b293c1ad0fb.jpg"]').length, 1);
equal(compactText($spacingDerived.root().text()).includes('롯데백화점'), true);
equal(semanticText($spacingDerived.root().text()), semanticText($spacing.root().text()));

const normalizedPlaceholderSourceSha256 = sha256([...sourceFileDigests]
  .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  .map(([sourceId, digest]) => `${sourceId}\0${digest}`)
  .join('\n'));
equal(sourceFileDigests.size, 27);
equal(normalizedPlaceholderSourceSha256, 'b166efae0d1c9ea2ca285d289e4c5f49ecddceeca0d1c1b070e10445888e5499');

{
  const poster = placeholder.videoPosters[0];
  const post = await loadPost(poster.sourceId);
  const drifted = post.body.replace(`poster="${poster.publicPath}"`, 'poster="/media/naver/229999999999/001-unlisted.svg"');
  throwsCode(
    () => inspectPolicyPlaceholderAssets(drifted, post.data, policy),
    'CURATION_E_PLACEHOLDER_POSTER_COUNT',
  );
  const activeVideo = post.body.replace('<video ', '<video src="/media/naver/220430227110/not-a-placeholder.mp4" ');
  throwsCode(
    () => inspectPolicyPlaceholderAssets(activeVideo, post.data, policy),
    'CURATION_E_PLACEHOLDER_POSTER_ROLE',
  );
}
{
  const drifted = spacingPost.body.replace(
    `src="${spacingGif.publicPath}" class="m20 ${spacingGif.requiredClass} egjs-visible" alt=""`,
    `src="${spacingGif.publicPath}" class="m20 ${spacingGif.requiredClass} egjs-visible" alt="semantic-content"`,
  );
  throwsCode(
    () => inspectPolicyPlaceholderAssets(drifted, spacingPost.data, policy),
    'CURATION_E_PLACEHOLDER_SPACING_ROLE',
  );
}
{
  const replacement = placeholder.coverReplacements[0];
  throwsCode(() => effectivePublicMediaPresentationData({
    source: replacement.source,
    sourceId: replacement.sourceId,
    cover: replacement.excludedCover,
    coverAlt: 'drifted-cover-alt',
  }, policy), 'CURATION_E_PLACEHOLDER_COVER');
}
{
  const unrelatedPlaceholderLikePath = '/media/naver/229999999999/001-ffc9f5e4fdee.svg';
  const transformed = removePolicyPlaceholderAssets(
    `<video poster="${unrelatedPlaceholderLikePath}"></video>`,
    { source: 'naver', sourceId: '229999999999' },
    policy,
  );
  equal(transformed.html.includes(unrelatedPlaceholderLikePath), true);
  equal(transformed.removedVideoPosters, 0);
}

deepEqual([...new Set(mapPolicy.maps.map((record) => `${record.source}:${record.sourceId}`))], [
  'naver:220811045462',
  'naver:220815478695',
  'naver:221065933692',
  'tistory:130',
  'tistory:7',
]);
const { manifest: projectedCandidate } = await collectProjectedPublicMedia(ROOT, { assetMode: 'manifest' });
const candidatePaths = new Set(projectedCandidate.entries.map((entry) => entry.publicPath));
equal(projectedCandidate.objectCount, 2_758);
equal(projectedCandidate.totalBytes, 2_346_220_246);
equal(projectedCandidate.manifestSha256, '61bb577d609f97cdb014ef3a14681045fbb3bec616f2b04c8d058519b640c532');
equal(mapPolicy.excludedAssets.every((publicPath) => !candidatePaths.has(publicPath)), true);
equal(policy.stickerExclusions.every((record) => !candidatePaths.has(record.publicPath)), true);
equal(policy.authoredPlatformAssets.every((record) => candidatePaths.has(record.publicPath)), true);
equal(placeholder.videoPosters.every((record) => !candidatePaths.has(record.publicPath)), true);
equal(candidatePaths.has(spacingGif.publicPath), false);

console.log(JSON.stringify({
  suite: 'public-media-curation',
  mapExcludedAssets: mapPolicy.excludedAssetCount,
  stickerExcludedAssets: removedStickers,
  preservedAuthoredPlatformAssets: policy.authoredPlatformAssetCount,
  excludedPlaceholderObjects: placeholder.objectCount,
  normalizedSourcePreservation: {
    sourceId: '220522768720',
    sha256: stickerCoverSourceSha256,
    sourceCoverRetained: true,
    derivedCoverSuppressed: true,
    reapplicationStable: true,
    placeholderSourceFiles: sourceFileDigests.size,
    placeholderSourcesSha256: normalizedPlaceholderSourceSha256,
  },
  projectedCandidate: {
    objectCount: projectedCandidate.objectCount,
    totalBytes: projectedCandidate.totalBytes,
    manifestSha256: projectedCandidate.manifestSha256,
  },
  assertions,
  status: 'PASS',
}, null, 2));
