import assert from 'node:assert/strict';
import {
  createPublicLinkRegistry,
  parsePublicPostReference,
  transformPublicPostLinks,
} from '../src/lib/public-links.ts';

export function runPublicLinkSelfTest() {
  const registry = createPublicLinkRegistry([
    { source: 'tistory', sourceId: '171', globalSequence: 10, canonicalPath: '/posts/10', legacyPaths: ['/171'], visibility: 'public' },
    { source: 'naver', sourceId: '220901832348', globalSequence: 11, canonicalPath: '/posts/11', legacyPaths: ['/naver/220901832348'], visibility: 'public' },
    { source: 'naver', sourceId: '220901832349', globalSequence: 12, canonicalPath: '/posts/12', legacyPaths: ['/naver/220901832349'], visibility: 'public' },
    { source: 'native', sourceId: 'native-1', globalSequence: 13, canonicalPath: '/posts/13', legacyPaths: [], visibility: 'public' },
  ], {
    '/posts/10': ['kept-section'],
  });
  assert.equal(registry.bySourceIdentity.size, registry.entries.length);

  const positives = [
    ['https://dwnc.me/171/', 'tistory:171'],
    ['HTTP://WWW.DWNC.ME/171?utm_source=old', 'tistory:171'],
    ['//dwnc.tistory.com/171', 'tistory:171'],
    ['https://dwnc.tistory.com/m/171/', 'tistory:171'],
    ['/171/', 'tistory:171'],
    ['/m/171', 'tistory:171'],
    ['171', 'tistory:171'],
    ['/naver/220901832348/', 'naver:220901832348'],
    ['http://blog.naver.com/tsusai/220901832348', 'naver:220901832348'],
    ['https://m.blog.naver.com/tsusai/220901832348?tracking=x', 'naver:220901832348'],
    ['https://tsusai.blog.me/220901832348', 'naver:220901832348'],
    ['https://blog.naver.com/PostView.naver?blogId=tsusai&logNo=220901832348', 'naver:220901832348'],
    ['https://blog.naver.com/PostView.nhn?BLOGID=TSUSAI&POSTNO=220901832348', 'naver:220901832348'],
    ['https://blog.naver.com/tsusai?Redirect=Log&logNo=220901832348', 'naver:220901832348'],
    ['/posts/10/', 'canonical:/posts/10'],
    ['/posts/%31%30', 'canonical:/posts/10'],
  ];
  for (const [href, lookupKey] of positives) {
    assert.equal(parsePublicPostReference(href)?.lookupKey, lookupKey, href);
  }

  const negatives = [
    'https://blog.naver.com/another-user/220901832348',
    'https://blog.naver.com/PostView.naver?blogId=another-user&logNo=220901832348',
    'https://naver.me/abc123',
    '/naver%2F220901832348',
    '/naver%5C220901832348',
    '/posts/%2e%2e/171',
    '/naver%252F220901832348',
    '/posts/%ZZ',
    '/posts/0',
    '/posts/01',
    '/posts/native-post',
    '/171?tracking=%ZZ',
    '/171#section-%',
    '/171?tracking=%E0%A4',
    '/171#%C0%AF',
    'javascript:/171',
    'https://blog.naver.com/tsusai?Redirect=Other&logNo=220901832348',
    'https://blog.naver.com/tsusai/220901832348/extra',
    'https://user@dwnc.me/171',
    'https://dwnc.me:444/171',
    'https://blog.naver.com/PostView.naver?blogId=tsusai&logNo=220901832348&logNo=220901832349',
  ];
  for (const href of negatives) assert.equal(parsePublicPostReference(href), null, href);

  const common = transformPublicPostLinks(`
    <figure data-og-source-url="https://www.dwnc.me/171/?utm_source=old" data-og-url="https://dwnc.me/171">
      <a data-source-url="https://dwnc.tistory.com/171" href="https://www.dwnc.me/171/?utm_source=old#drop" target="_blank" rel="tag noopener noreferrer external">https://www.dwnc.me/171/?utm_source=old#drop</a>
    </figure>
    <a href="https://dwnc.me/171#kept-section" target="_blank" rel="noopener">fragment</a>
    <a href="https://www.dwnc.me/999" target="_blank">missing 999</a>
    <figure data-og-source-url="https://example.com/source" data-og-url="https://example.com/path" data-source-url="https://example.com/source">
      <a href="https://example.com/path" target="_blank" rel="noopener noreferrer">external</a>
      <img src="/external-card.jpg" alt="">
    </figure>
  `, {
    post: { source: 'tistory', sourceId: '171', canonicalPath: '/posts/10' },
    registry,
  });
  assert.match(common.html, /href="\/posts\/10" rel="tag"/);
  assert.match(common.html, /href="\/posts\/10" rel="tag">\/posts\/10<\/a>/);
  assert.match(common.html, /href="\/posts\/10#kept-section"/);
  assert.match(common.html, /data-og-source-url="\/posts\/10" data-og-url="\/posts\/10"/);
  assert.match(common.html, /data-source-url="\/posts\/10"/);
  assert.doesNotMatch(common.html, /href="\/posts\/10(?:#[^"]+)?"[^>]*target=/);
  assert.doesNotMatch(common.html, /999/);
  assert.match(common.html, /data-public-link-unavailable="owned-post"/);
  assert.match(common.html, /href="https:\/\/example\.com\/path" target="_blank" rel="noopener noreferrer"/);
  assert.match(common.html, /data-og-source-url="https:\/\/example\.com\/source" data-og-url="https:\/\/example\.com\/path" data-source-url="https:\/\/example\.com\/source"/);
  assert.match(common.html, /<img src="\/external-card\.jpg" alt="">/);
  assert.deepEqual(common.report, {
    rewritten: 2,
    displayTextRewritten: 1,
    metadataRewritten: 3,
    unavailable: 1,
    naverPlatformSelfLinksRemoved: 0,
  });

  const naver = transformPublicPostLinks(`
    <div class="se_component se_image"><a class="__se_link" href="https://blog.naver.com/tsusai/220901832348"><img src="/kept.jpg"></a></div>
    <p><a href="https://blog.naver.com/tsusai/220901832349" target="_blank" rel="noopener noreferrer">authored</a></p>
  `, {
    post: { source: 'naver', sourceId: '220901832348', canonicalPath: '/posts/11' },
    registry,
  });
  assert.match(naver.html, /<img src="\/kept\.jpg">/);
  assert.doesNotMatch(naver.html, /__se_link/);
  assert.match(naver.html, /href="\/posts\/12"/);
  assert.doesNotMatch(naver.html, /target=|rel=/);
  assert.deepEqual(naver.report, {
    rewritten: 1,
    displayTextRewritten: 0,
    metadataRewritten: 0,
    unavailable: 0,
    naverPlatformSelfLinksRemoved: 1,
  });

  assert.throws(() => createPublicLinkRegistry([
    { source: 'native', sourceId: 'native-1', globalSequence: 20, canonicalPath: '/posts/20', legacyPaths: [], visibility: 'public' },
    { source: 'native', sourceId: 'native-2', globalSequence: 20, canonicalPath: '/posts/20', legacyPaths: [], visibility: 'public' },
  ]));
  assert.throws(() => createPublicLinkRegistry([
    { source: 'native', sourceId: 'duplicate', globalSequence: 21, canonicalPath: '/posts/21', legacyPaths: [], visibility: 'public' },
    { source: 'native', sourceId: 'duplicate', globalSequence: 22, canonicalPath: '/posts/22', legacyPaths: [], visibility: 'public' },
  ]));
  const sourceQualified = createPublicLinkRegistry([
    { source: 'tistory', sourceId: '171', globalSequence: 23, canonicalPath: '/posts/23', legacyPaths: ['/171'], visibility: 'public' },
    { source: 'native', sourceId: '171', globalSequence: 24, canonicalPath: '/posts/24', legacyPaths: [], visibility: 'public' },
  ]);
  assert.equal(sourceQualified.bySourceIdentity.size, 2);
  assert.throws(() => createPublicLinkRegistry([
    { source: 'tistory', sourceId: '171', globalSequence: 25, canonicalPath: '/posts/25', legacyPaths: ['/171'], visibility: 'private' },
  ]));
  return { fixtures: positives.length + negatives.length + 7 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runPublicLinkSelfTest(), null, 2));
}
