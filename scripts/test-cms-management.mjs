import { load } from 'cheerio';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import { CmsConfigurationStore } from '../src/lib/cms-configuration.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { verifyAccessIdentity, clearAccessKeyCacheForTests } from '../src/lib/access-auth.ts';
import adminWorker from '../src/admin-worker.ts';
import manifest from '../src/data/public-media-r2-v1.json' with { type: 'json' };
const db=await createEditorDatabase();seedLegacy(db); const config=new CmsConfigurationStore(db), store=new NativePostStore(db);
const original={...db.sqlite.prepare('SELECT * FROM legacy_posts').get()};
const baseline=await config.categories();assert.equal(baseline.revision,0);assert.equal(baseline.value.length,18);
const parentId='new-123e4567-e89b-42d3-a456-426614174001', childId='new-123e4567-e89b-42d3-a456-426614174002';
const nodes=[...baseline.value,{id:parentId,label:'합성 분류',parentId:null,sortOrder:1},{id:childId,label:'합성 하위',parentId,sortOrder:2}];
const first=await config.saveCategories(0,nodes);assert.equal(first.revision,1);
await assert.rejects(()=>config.saveCategories(0,nodes),/REVISION/);
assert.equal(first.value.find(n=>n.id==='daily').slug,baseline.value.find(n=>n.id==='daily').slug);
await assert.rejects(()=>config.saveCategories(1,first.value.filter(n=>n.id!=='daily')),/CATEGORY_IN_USE/);
await assert.rejects(()=>config.saveCategories(1,first.value.map(n=>n.id==='daily'?{...n,slug:'changed'}:n)),/CATEGORIES/);
await assert.rejects(()=>config.saveCategories(1,[...first.value,{id:'new-123e4567-e89b-42d3-a456-426614174003',label:'3단계',parentId:childId,sortOrder:3}]),/CATEGORIES/);
const renamed=await config.saveCategories(1,first.value.map(n=>n.id==='daily'?{...n,label:'새 이름'}:n));
assert.equal((await store.listForAdmin())[0].categoryLabel,'새 이름');assert.deepEqual({...db.sqlite.prepare('SELECT * FROM legacy_posts').get()},original);
const draft=await store.createDraft(renamed.value.find(n=>n.id===childId));
const input={title:'검색용 합성',description:'설명',bodyFormat:'html',bodyMarkdown:'<p>저장된 문단</p>',categoryId:childId,tags:['태그','Exact'],coverMediaId:null};
const saved=await store.update(draft.id,0,input);
assert.equal(saved.categoryId,childId);await assert.rejects(()=>config.saveCategories(2,renamed.value.filter(n=>n.id!==childId)),/CATEGORY_IN_USE/);
const media={id:'123e4567-e89b-42d3-a456-426614174000',postId:draft.id,publicPath:'/media/native/123e4567-e89b-42d3-a456-426614174000.png',objectKey:'media/native/123e4567-e89b-42d3-a456-426614174000.png',sha256:'a'.repeat(64),bytes:1,mime:'image/png',alt:'대표사진',createdAt:'2026-09-01T00:00:00Z'};
await store.addMedia(media);
const coverSaved=await store.update(draft.id,saved.revision,{...input,coverPath:media.publicPath,coverAlt:'설명 사진'});
assert.equal(coverSaved.coverPath,media.publicPath);assert.equal(await store.getPublicMedia(media.publicPath),null);
const pub=await store.publish(draft.id,coverSaved.revision);assert.equal(pub.globalSequence,597);assert.equal(pub.coverPath,media.publicPath);assert.equal((await store.getPublicMedia(media.publicPath)).id,media.id);
await assert.rejects(()=>store.update('legacy-1',0,{...input,categoryId:'daily',coverPath:media.publicPath}),/COVER/);
const legacyImage=manifest.entries.find(e=>e.contentType.startsWith('image/'));
const legacy=await store.getForAdmin('legacy-1');const legacyBody=await store.update(legacy.id,legacy.revision,{...legacy,bodyMarkdown:`${legacy.bodyHtml}<img src="${legacyImage.publicPath}" alt="원래 사진">`});
assert.ok((await store.mediaForPost(legacy.id)).some(m=>m.path===legacyImage.publicPath));
const legacyCover=await store.update(legacy.id,legacyBody.revision,{...legacyBody,coverPath:legacyImage.publicPath,coverAlt:'원래 사진'});
assert.equal((await store.getPublishedBySequence(1)).coverPath,null);assert.equal(legacyCover.coverPath,legacyImage.publicPath);
const settings=await config.settings(); const configured=await config.saveSettings(0,{...settings.value,title:'합성 블로그',menu:[{label:'새 분류',path:`/category/${first.value.find(n=>n.id===parentId).slug}`}],rssCount:20});
assert.equal(configured.revision,1);await assert.rejects(()=>config.saveSettings(0,settings.value),/REVISION/);
await assert.rejects(()=>config.saveSettings(1,{...settings.value,menu:[{label:'나쁜 링크',path:'javascript:alert(1)'}]}),/SETTINGS/);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'cms-test',alg:'RS256',use:'sig'};
const env={ACCESS_TEAM_DOMAIN:'https://cms-test.cloudflareaccess.com',ACCESS_AUD:'abcdefghijklmnopqrstuvwx',ACCESS_ALLOWED_EMAIL:'owner@example.test',NATIVE_DB:db};
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const head=b64({alg:'RS256',kid:jwk.kid}),payload=b64({iss:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD,sub:'synthetic',email:env.ACCESS_ALLOWED_EMAIL,exp:2_000_000_000});const jwt=`${head}.${payload}.${sign('RSA-SHA256',Buffer.from(`${head}.${payload}`),privateKey).toString('base64url')}`;
clearAccessKeyCacheForTests();const headers={'cf-access-jwt-assertion':jwt,origin:'https://admin.example.test','content-type':'application/json'};
await verifyAccessIdentity(new Request('https://admin.example.test',{headers}),env,{fetcher:async()=>Response.json({keys:[jwk]})});
const api=async(path,method='GET',body)=>adminWorker.fetch(new Request(`https://admin.example.test${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),env,{});
const browserHeaders={...headers,accept:'text/html,application/xhtml+xml'};
const missingPage=await adminWorker.fetch(new Request('https://admin.example.test/archive',{headers:browserHeaders}),env,{});
assert.equal(missingPage.status,404);assert.equal(missingPage.headers.get('location'),null);assert.match(missingPage.headers.get('content-type'),/^text\/html/u);assert.equal(missingPage.headers.get('cache-control'),'no-store');
const missingHtml=load(await missingPage.text());assert.equal(missingHtml('html').attr('lang'),'ko');assert.equal(missingHtml('h1').text(),'페이지를 찾을 수 없습니다');assert.equal(missingHtml('a').eq(0).attr('href'),'/');assert.equal(missingHtml('a').eq(1).attr('href'),'https://dwnc.me/archive');
const missingHead=await adminWorker.fetch(new Request('https://admin.example.test/archive',{method:'HEAD',headers:browserHeaders}),env,{});assert.equal(missingHead.status,404);assert.match(missingHead.headers.get('content-type'),/^text\/html/u);assert.equal(await missingHead.text(),'');
for(const path of ['/api','/api/missing','/api/posts/not-a-post']){const response=await adminWorker.fetch(new Request(`https://admin.example.test${path}`,{headers:browserHeaders}),env,{});assert.equal(response.status,404);assert.match(response.headers.get('content-type'),/^application\/json/u);assert.deepEqual(await response.json(),{error:'찾을 수 없습니다.'});}
assert.deepEqual(await (await api('/archive')).json(),{error:'찾을 수 없습니다.'});
const anonymousPage=await adminWorker.fetch(new Request('https://admin.example.test/archive',{headers:{accept:'text/html'}}),env,{});assert.equal(anonymousPage.status,401);assert.equal((await anonymousPage.json()).code,'authentication_required');
const crossOriginWrite=await adminWorker.fetch(new Request('https://admin.example.test/archive',{method:'POST',headers:{...browserHeaders,origin:'https://other.example.test'}}),env,{});assert.equal(crossOriginWrite.status,403);
const originalFetch=globalThis.fetch;const fontRequests=[];globalThis.fetch=async(url,options)=>{fontRequests.push({url,options});return new Response('synthetic-font',{headers:{'content-type':'font/woff'}});};
try { assert.equal((await api('/fonts/nanum/NanumGothic.woff')).status,200);assert.equal(fontRequests[0].url,'https://dwnc.me/fonts/nanum/NanumGothic.woff');assert.equal(fontRequests[0].options.headers,undefined);assert.equal((await api('/fonts/nanum/not-allowed.woff')).status,404);assert.equal(fontRequests.length,1); } finally {globalThis.fetch=originalFetch;}
assert.equal((await api('/api/categories')).status,200);assert.equal((await api('/api/settings')).status,200);
const filtered=await (await api(`/api/posts?q=검색용&categoryId=${childId}&status=published&page=1&pageSize=1`)).json();assert.equal(filtered.total,1);assert.equal(filtered.posts[0].id,draft.id);assert.equal(filtered.posts[0].hasUnpublishedChanges,false);assert.ok(!Object.hasOwn(filtered.posts[0],'bodyHtml'));
assert.equal((await api('/api/posts?pageSize=0')).status,400);assert.equal((await api('/api/posts?arbitrary=yes')).status,400);
const blank=await store.createDraft(renamed.value.find(node=>node.id==='daily'));const changes=await (await api('/api/posts?status=changed')).json();assert.ok(changes.posts.some(post=>post.id==='legacy-1'));assert.ok(!changes.posts.some(post=>post.id===blank.id));
const tags=await (await api('/api/tags')).json();assert.ok(tags.tags.some(t=>t.label==='Exact'));
const stale=await api('/api/categories','PUT',{expectedRevision:1,categories:renamed.value});assert.equal(stale.status,409);
const preview=await (await api(`/api/posts/${draft.id}/preview`,'POST',{input:{...input,bodyMarkdown:'<p>안전<script>bad()</script></p>'}})).json();assert.ok(preview.editorHtml.includes('안전'));assert.ok(!preview.editorHtml.includes('script'));assert.equal(typeof preview.css,'string');
const cleared=await store.update(draft.id,pub.revision,{...input,coverPath:null});assert.equal(cleared.coverPath,null);assert.equal((await store.getPublishedBySequence(597)).coverPath,media.publicPath);
await store.publish(draft.id,cleared.revision);assert.equal(await store.getPublicMedia(media.publicPath),null);
// Public reads use the same metadata, preserve query semantics and consume no
// full HTML for discovery. A local HTMLRewriter stand-in exercises real routes.
class Rewriter { handlers=[]; on(selector,handler){this.handlers.push([selector,handler]);return this;} async transform(response){const $=load(await response.text());for(const [selector,handler] of this.handlers)$(selector).each((_i,node)=>handler.element({setInnerContent:(v,o={})=>o.html?$(node).html(v):$(node).text(v),setAttribute:(k,v)=>$(node).attr(k,v),remove:()=>$(node).remove(),append:(v,o={})=>$(node).append(o.html?v:$.escapeSelector(v))}));return new Response($.html(),{status:response.status,headers:response.headers});} }
globalThis.HTMLRewriter=Rewriter;
const shell='<!doctype html><html><head><title>기존</title><meta name="description"><link rel="canonical"><meta property="og:title"><meta property="og:description"><meta property="og:url"><meta property="og:site_name"><meta property="og:type"><meta name="twitter:card"></head><body><header><a class="brand"></a><nav class="site-nav"></nav></header><dialog id="category-drawer"><nav></nav></dialog><main id="main"></main></body></html>';
const worker=createNativePublicWorker(async(request)=>new URL(request.url).pathname==='/search-index.json'?Response.json([]):new Response(shell,{headers:{'content-type':'text/html'}}));
const publicGet=path=>worker(new Request(`https://dwnc.me${path}`),{NATIVE_DB:db},{});
const latest=await store.getForAdmin(draft.id); const withCover=await store.update(draft.id,latest.revision,{...input,coverPath:media.publicPath}); await store.publish(draft.id,withCover.revision);
const bodyFiltered=await (await api('/api/posts?q=저장된&page=1&pageSize=20')).json();assert.ok(bodyFiltered.posts.some(post=>post.id===draft.id));
assert.equal((await store.listPublished(false))[0].bodyHtml,'');assert.ok((await store.listPublished())[0].bodyHtml);
const article=load(await (await publicGet('/posts/597?from=reader')).text());assert.equal(article('title').text(),'검색용 합성 — 합성 블로그');assert.equal(article('meta[property="og:image"]').attr('content'),`https://dwnc.me${media.publicPath}`);assert.ok(article('.breadcrumbs').text().includes('합성 하위'));assert.ok(article('.site-nav').text().includes('새 분류'));
const cleanList=await (await publicGet('/archive')).text(),queryList=await (await publicGet('/archive?from=reader')).text();assert.equal(queryList,cleanList);
const slug=first.value.find(n=>n.id===childId).slug;const category=await publicGet(`/category/${encodeURIComponent(slug)}?from=reader`);assert.equal(category.status,200);assert.ok((await category.text()).includes(media.publicPath));
const rss=await (await publicGet('/rss.xml')).text();assert.ok(rss.includes('합성 블로그'));assert.ok(rss.includes('/posts/597'));
const sitemap=await (await publicGet('/sitemap-0.xml?updated=1')).text();assert.ok(sitemap.includes(`/category/${slug}`));assert.ok(sitemap.includes('/posts/597'));assert.ok(sitemap.includes('<lastmod>'));
// Sort the whole mixed-source result before paging, including working-copy dates.
const sortDb=await createEditorDatabase();seedLegacy(sortDb);
let sortNow='2026-01-01T00:00:00Z';
const sortStore=new NativePostStore(sortDb,()=>new Date(sortNow));
const sortCategory={id:'daily',slug:'일상',label:'일상'};
const sortA=await sortStore.createDraft(sortCategory);
sortNow='2026-02-01T00:00:00Z';const sortB=await sortStore.createDraft(sortCategory);
const sortC=await sortStore.createDraft(sortCategory);
sortDb.sqlite.prepare('UPDATE legacy_posts SET created_at=?,updated_at=?,title=?').run('2018-01-01T00:00:00Z','2026-04-01T00:00:00Z','정렬 합성 이관');
for(const post of [sortA,sortB,sortC])await sortStore.update(post.id,post.revision,{...input,title:'정렬 합성 새 글',categoryId:'daily'});
// Same instant, different offsets; these must tie rather than sort as text.
sortDb.sqlite.prepare('UPDATE native_posts SET created_at=? WHERE id=?').run('2026-02-01T09:00:00+09:00',sortC.id);
sortDb.sqlite.prepare('UPDATE editor_working_copies SET updated_at=? WHERE post_id=?').run('2026-05-01T00:00:00Z',sortA.id);
sortDb.sqlite.prepare('UPDATE editor_working_copies SET updated_at=? WHERE post_id=?').run('2026-03-01T00:00:00Z',sortB.id);
sortDb.sqlite.prepare('UPDATE editor_working_copies SET updated_at=? WHERE post_id=?').run('2026-03-01T09:00:00+09:00',sortC.id);
const tiedIds=[sortB.id,sortC.id].sort();
const expectedOrders={
  'created-asc':['legacy-1',sortA.id,...tiedIds],
  'created-desc':[...tiedIds,sortA.id,'legacy-1'],
  'updated-asc':[...tiedIds,'legacy-1',sortA.id],
  'updated-desc':[sortA.id,'legacy-1',...tiedIds],
};
env.NATIVE_DB=sortDb;
for(const [sort,expected] of Object.entries(expectedOrders)){
  const collected=[];
  for(let page=1;page<=2;page++){
    const result=await (await api('/api/posts?sort='+sort+'&q=정렬&categoryId=daily&kind=post&status=all&pageSize=2&page='+page)).json();
    assert.equal(result.total,4);assert.equal(result.totalPages,2);
    collected.push(...result.posts.map(post=>post.id));
  }
  assert.deepEqual(collected,expected);
  const drafts=await (await api('/api/posts?sort='+sort+'&status=draft&pageSize=100')).json();
  assert.deepEqual(drafts.posts.map(post=>post.id),expected.filter(id=>id!=='legacy-1'));
}
const defaultList=await (await api('/api/posts')).json();
assert.deepEqual(defaultList.posts.map(post=>post.id),expectedOrders['updated-desc']);
assert.equal(defaultList.posts.find(post=>post.id==='legacy-1').createdAt,'2018-01-01T00:00:00Z');
assert.equal(defaultList.posts.find(post=>post.id===sortA.id).createdAt,sortA.createdAt);
assert.equal(defaultList.posts[0].updatedAt,'2026-05-01T00:00:00Z');
for(const sort of ['title-asc','title-desc','unexpected','created_at DESC; DROP TABLE native_posts'])assert.equal((await api('/api/posts?sort='+encodeURIComponent(sort))).status,400);
assert.equal(sortDb.sqlite.prepare('SELECT COUNT(*) AS count FROM native_posts').get().count,3);
env.NATIVE_DB=db;
console.log(JSON.stringify({suite:'cms-management',status:'PASS',behavior:'taxonomy CAS and constraints, settings, search/filter pagination, native/legacy cover ownership and publication isolation, sanitized preview'}));
