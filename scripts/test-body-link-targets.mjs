import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { prepareBodyLinkTargets } from '../src/lib/body-link-targets.ts';
import { createPublicLinkRegistry, transformPublicPostLinks } from '../src/lib/public-links.ts';
import { prepareUrlLinkCards } from '../src/lib/url-link-cards.ts';
import { prepareImportedPresentation } from '../src/lib/imported-presentation.ts';

const input = `<p id="same" style="color:red"><a href="/posts/14#section" rel="tag">내부 <strong>글</strong></a>
<a href="https://example.test/p?a=1&amp;b=2#한글" target="_self" rel="nofollow noreferrer">외부</a>
<a href="//example.test/path" target="named" rel="external">프로토콜 상대</a>
<a href="../posts/14" target="_top">상대</a><a href="?view=full#section">query</a>
<a href="https://example.test/" rel="NoOpEnEr license">이미 새 탭</a><a href="/posts/14" rel="opener">명시 token</a>
<a href="#same" target="_self" rel="tag">같은 글 위치</a><a href="mailto:example@example.test">메일</a>
<a href="tel:01012345678">전화</a><a href="/file.pdf" download="file.pdf" target="_self">다운로드</a>
<a href="javascript:void(0)">다른 동작</a><a href="">빈 주소</a></p>
<figure data-ke-type="opengraph"><a href="/posts/14"><p class="og-title">카드 제목</p></a></figure>
<a href="https://example.test/photo"><img src="/photo.jpg" alt="사진"></a><img src="/unlinked.jpg" alt="링크 없는 사진">`;
const before = load(input, null, false), output = prepareBodyLinkTargets(input), after = load(output, null, false);
function semantic($) { return $.root().find('*').toArray().map(node => ({ tag: node.name, attrs: Object.fromEntries(Object.entries(node.attribs).filter(([name]) => !['target','rel'].includes(name))), text: $(node).contents().filter((_, child) => child.type === 'text').text() })); }
assert.deepEqual(semantic(after), semantic(before), 'Only target and rel change; URL, fragment, text, inline style and photo structure stay intact');
for (const index of [0,1,2,3,4,5,6,13,14]) { assert.equal(after('a').eq(index).attr('target'), '_blank'); assert.ok(after('a').eq(index).attr('rel').toLowerCase().split(/\s+/).includes('noopener')); }
for (const index of [7,8,9,10,11,12]) { assert.equal(after('a').eq(index).prop('outerHTML'), before('a').eq(index).prop('outerHTML')); }
assert.equal(after('a').eq(0).attr('rel'), 'tag noopener');
assert.equal(after('a').eq(1).attr('rel'), 'nofollow noreferrer noopener');
assert.equal(after('a').eq(5).attr('rel'), 'NoOpEnEr license');
assert.equal(after('a').eq(6).attr('rel'), 'opener noopener');
assert.ok(!after('a').eq(0).attr('rel').includes('noreferrer'));
assert.equal(prepareBodyLinkTargets(output), output, 'Repeated presentation is idempotent');
const exceptions = '<a href="#same">위치</a><a href="mailto:x@example.test">메일</a><a href="tel:0101">전화</a><a href="/file" download>파일</a>';
assert.equal(prepareBodyLinkTargets(exceptions), exceptions, 'An exception-only fragment keeps its original bytes');

const preview = load(prepareBodyLinkTargets(input, { baseUrl:'https://dwnc.me/posts/607', absoluteRelativeLinks:true }), null, false);
assert.equal(preview('a').eq(0).attr('href'), 'https://dwnc.me/posts/14#section');
assert.equal(preview('a').eq(3).attr('href'), 'https://dwnc.me/posts/14');
assert.equal(preview('a').eq(4).attr('href'), 'https://dwnc.me/posts/607?view=full#section');
assert.equal(preview('a').eq(7).attr('href'), '#same');
assert.equal(preview('a').eq(10).attr('target'), '_self');
assert.equal(preview('a').eq(10).attr('href'), 'https://dwnc.me/file.pdf');

// The final display policy runs after canonicalization and generated cards.
// Historical/import canonicalization still has its previous default behavior.
const registry = createPublicLinkRegistry([{source:'tistory',sourceId:'171',canonicalPath:'/posts/14',globalSequence:14,legacyPaths:['/171'],visibility:'public'}]);
const authored = '<p><a href="https://dwnc.me/171" target="_self" rel="tag noreferrer external">이전 글</a></p>';
const context = {post:{source:'tistory',sourceId:'172',canonicalPath:'/posts/15'},registry};
const historical = load(transformPublicPostLinks(authored,context).html,null,false);
assert.equal(historical('a').attr('target'),undefined); assert.equal(historical('a').attr('rel'),'tag');
const finalBody = prepareBodyLinkTargets(prepareImportedPresentation(transformPublicPostLinks(authored,{...context,preserveLinkAttributes:true}).html,{source:'tistory',sourceId:'172'}));
const finalDom = load(finalBody,null,false);
assert.equal(finalDom('a').attr('href'),'/posts/14'); assert.equal(finalDom('a').attr('target'),'_blank'); assert.equal(finalDom('a').attr('rel'),'tag noreferrer external noopener');
const withCard = await prepareUrlLinkCards('<p>https://dwnc.me/posts/14</p>',[{path:'/posts/14',title:'현재 공개 제목'}]);
const cardDom = load(prepareBodyLinkTargets(prepareImportedPresentation(withCard)),null,false);
assert.equal(cardDom('figure a').attr('target'),'_blank'); assert.ok(cardDom('figure a').attr('rel').includes('noopener')); assert.equal(cardDom('p').first().text(),'https://dwnc.me/posts/14');
console.log('PASS body-link-targets: web links/cards/linked photos, preserved rel/markup/fragments, semantic exceptions, preview public-origin resolution and final normalization order');
