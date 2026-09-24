import postcss from 'postcss';
import {load} from 'cheerio';
import {IMPORTED_PRESENTATION_CSS} from '../src/lib/imported-presentation.ts';
import assert from 'node:assert/strict';
import {standaloneCardCandidates,prepareUrlLinkCards,resolveCardHtml,publicMetadataUrl,publicAddress} from '../src/lib/url-link-cards.ts';
const body='<p>https://dwnc.me/posts/594</p><div><a href="https://example.com/">https://example.com/</a></div><p>본문 https://example.com/</p><pre><p>https://example.com/</p></pre><table><tr><td><p>https://example.com/</p></td></tr></table><p><a href="https://other.example/">https://example.com/</a></p><p>https://example.com/<br></p>';
assert.equal(standaloneCardCandidates(body).candidates.length,3);
assert.equal(standaloneCardCandidates('<p>https://exa<br>mple.com/</p>').candidates.length,0);
const withDns=handler=>async(url,init)=>String(url).startsWith('https://cloudflare-dns.com/dns-query?')?Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]}):handler(url,init);
const fetcher=withDns(async()=>new Response('<head><meta property="og:title" content="외부 &amp; 제목"><meta name="description" content="설명"></head>',{headers:{'content-type':'text/html'}}));
const transformed=await prepareUrlLinkCards(body,[{path:'/posts/594',title:'현재 공개 제목',description:'공개 설명',cover:'/media/native/public.jpg'}],fetcher);
assert.match(transformed,/현재 공개 제목/);assert.match(transformed,/외부 &amp; 제목/);assert.match(transformed,/<p>본문 https:\/\/example.com\/<\/p>/);
assert.equal(await prepareUrlLinkCards(transformed,[],fetcher),transformed);
let calls=0;const noFetch=async()=>{calls++;throw new Error('must not fetch internal')};
const privateCard=await resolveCardHtml('https://dwnc.me/posts/999',[],noFetch);
assert.equal(calls,0);assert.match(privateCard,/https:\/\/dwnc.me\/posts\/999/);
for(const url of ['http://127.0.0.1/','http://2130706433/','http://[::1]/','https://a.local/','https://user:pass@example.com/','ftp://example.com/','https://example.com:22/'])assert.equal(publicMetadataUrl(url),null,url);
const seen=[];const redirected=await resolveCardHtml('https://redirect.example/',[],withDns(async(url)=>{seen.push(url);return new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data'}})}));
assert.equal(seen.length,1);assert.match(redirected,/redirect.example/);
const huge=await resolveCardHtml('https://huge.example/',[],withDns(async()=>new Response('ignored',{headers:{'content-type':'text/html','content-length':'9999999'}})));assert.match(huge,/huge.example/);
const unsafe=await resolveCardHtml('https://unsafe.example/',[],withDns(async()=>new Response('<meta property="og:title" content="&lt;script&gt;bad&lt;/script&gt;">',{headers:{'content-type':'text/html'}})));assert.ok(!unsafe.includes('<script>'));assert.match(unsafe,/&lt;script&gt;/);
console.log('URL card classification, public-only metadata, idempotency, redirects, bounds and escaping passed');

for(const address of ['10.0.0.1','127.0.0.1','169.254.1.1','192.168.0.1','::1','fc00::1','fe80::1'])assert.equal(publicAddress(address),false);
let remoteCalls=0;await resolveCardHtml('https://private-dns.example/',[],async(url)=>{if(String(url).startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:1,data:'127.0.0.1'}]});remoteCalls++;return fetcher(url)});assert.equal(remoteCalls,0);

const loose=await prepareUrlLinkCards('<a href="https://dwnc.me/posts/594">https://dwnc.me/posts/594</a><br><p id="reference" style="text-align:center">https://dwnc.me/posts/594</p><div class="se_oglink"><p>https://dwnc.me/posts/594</p></div>',[{path:'/posts/594',title:'공개 제목'}],noFetch);
assert.equal((loose.match(/data-ke-type="opengraph"/g)||[]).length,2);assert.match(loose,/<figure[^>]*id="reference"[^>]*style="text-align:center"/);assert.match(loose,/<div class="se_oglink"><p>https:\/\/dwnc.me\/posts\/594<\/p>/);

assert.equal(standaloneCardCandidates('https://example.test/a').candidates.length,1);
const rootMixed=await prepareUrlLinkCards('https://example.test/a<p>https://example.test/b</p>',[],fetch,false);
assert.equal((rootMixed.match(/data-ke-type="opengraph"/g)||[]).length,2);assert.match(rootMixed,/href="https:\/\/example.test\/a"/);assert.match(rootMixed,/href="https:\/\/example.test\/b"/);
assert.equal(await prepareUrlLinkCards('앞부분 <b>본문</b><p>일반 본문</p> 뒷부분',[],fetch,false),'앞부분 <b>본문</b><p>일반 본문</p> 뒷부분');

const cardRules=[];postcss.parse(IMPORTED_PRESENTATION_CSS).walkRules(rule=>{if(rule.selector.includes('opengraph'))cardRules.push(rule)});
for(const surface of ['prose','html-editor']){
  const $=load(`<div class="${surface}">${rootMixed}</div>`,null,false);
  for(const field of ['og-title','og-desc','og-host']){
    const element=$('.'+field).first(),styles={};for(const rule of cardRules)if(element.is(rule.selector))for(const declaration of rule.nodes)if(declaration.type==='decl')styles[declaration.prop]=declaration.value;
    assert.equal(styles.display,'block',surface+' '+field+' must have its own line');assert.equal(styles['overflow-wrap'],'anywhere');assert.equal(styles['white-space'],'normal');
  }
}
