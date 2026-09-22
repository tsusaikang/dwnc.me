import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { generateKeyPairSync, sign } from 'node:crypto';
import { categoryDisplayNodes, categoryEditorChoices } from '../src/lib/category-display.ts';
import { TAXONOMY, categoryStats, postsForCategory, resolvePostCategoryId, resolvePostCategory, taxonomyRoots, taxonomyNodeBySlug, postCategoryAliases } from '../src/lib/taxonomy.ts';
import { CmsConfigurationStore } from '../src/lib/cms-configuration.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import { verifyAccessIdentity, clearAccessKeyCacheForTests } from '../src/lib/access-auth.ts';
import adminWorker from '../src/admin-worker.ts';
const originals=structuredClone(TAXONOMY);
const synthetic=[{data:{source:'naver',categories:['일상']}},{data:{source:'tistory',categories:['일상 이야기']}},{data:{source:'naver',categories:['수영 일기']}}];
assert.deepEqual(synthetic.slice(0,2).map(resolvePostCategoryId),['daily','daily-stories']);
assert.deepEqual(synthetic.slice(0,2).map(p=>resolvePostCategory(p).label),['일상','일상']);
assert.equal(taxonomyRoots().filter(n=>n.label==='일상').length,1);
for(const id of ['daily','daily-stories']) {assert.equal(postsForCategory(synthetic,id).length,2);assert.equal(categoryStats(synthetic).find(n=>n.id===id).totalCount,2);}
assert.equal(taxonomyNodeBySlug('일상-이야기').id,'daily-stories');
assert.ok(postCategoryAliases(synthetic[1]).includes('일상 이야기'));
assert.equal(postsForCategory(synthetic,'swimming').length,1);
assert.deepEqual(TAXONOMY,originals);
const choices=categoryEditorChoices(TAXONOMY,'daily-stories');assert.equal(choices.filter(n=>n.label==='일상').length,1);assert.equal(choices.find(n=>n.label==='일상').id,'daily-stories');assert.equal(categoryEditorChoices(TAXONOMY).find(n=>n.label==='일상').id,'daily');
const db=await createEditorDatabase();seedLegacy(db);const config=new CmsConfigurationStore(db),store=new NativePostStore(db),categories=(await config.categories()).value;
const make=async(id,visibility='public')=>{let post=await store.createDraft(categories.find(n=>n.id===id));post=await store.update(post.id,post.revision,{...post,title:`합성 ${id} ${visibility}`,bodyFormat:'html',bodyMarkdown:'<p>합성 카테고리 시험</p>'});return store.publish(post.id,post.revision,{visibility});};
const alias=await make('daily-stories');await make('daily-stories','private');await make('swimming-diary');
// Typing into an existing alias post keeps its stored original category ID and public snapshot.
const beforePublished=await store.getPublishedBySequence(alias.globalSequence);const editable=await store.getForAdmin(alias.id);const retained=categoryEditorChoices(categories,editable.categoryId).find(c=>c.label==='일상');
await store.update(alias.id,editable.revision,{...editable,title:'아직 공개하지 않은 합성 수정',categoryId:retained.id});
assert.equal((await store.getForAdmin(alias.id)).categoryId,'daily-stories');assert.deepEqual(await store.getPublishedBySequence(alias.globalSequence),beforePublished);
const tables=['native_posts','legacy_posts','editor_working_copies','cms_configuration'];const preserved=Object.fromEntries(tables.map(t=>[t,db.sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));
class Rewriter {handlers=[];on(selector,handler){this.handlers.push([selector,handler]);return this;}async transform(response){const $=load(await response.text());for(const[selector,handler]of this.handlers)$(selector).each((_,node)=>handler.element({setInnerContent:(v,o={})=>o.html?$(node).html(v):$(node).text(v),setAttribute:(k,v)=>$(node).attr(k,v),remove:()=>$(node).remove(),append:v=>$(node).append(v)}));return new Response($.html(),{status:response.status,headers:response.headers});}}
globalThis.HTMLRewriter=Rewriter;
const shell='<html><head><title></title><link rel="canonical"></head><body><nav class="site-nav"></nav><dialog id="category-drawer"><nav></nav></dialog><main id="main"></main></body></html>';
const worker=createNativePublicWorker(async request=>new URL(request.url).pathname==='/search-index.json'?Response.json([]):new Response(shell,{headers:{'content-type':'text/html'}}));
const request=path=>worker(new Request(`https://dwnc.me${path}`,{headers:{accept:'text/html','user-agent':'Mozilla/5.0','sec-fetch-dest':'document'}}),{NATIVE_DB:db},{});
const html=async path=>load(await(await request(path)).text());
const home=await html('/');assert.equal(home('.home-category-list strong').filter((_,n)=>home(n).text()==='일상').length,1);assert.equal(home('.home-category-list a').first().find('small').text(),'2편');
const index=await html('/category');assert.equal(index('h1').text(),'카테고리');assert.equal(index('.category-tree-index__root').length,categoryDisplayNodes(categories).filter(n=>!n.parentId).length);
for(const slug of ['일상','일상-이야기']) {const page=await html(`/category/${encodeURIComponent(slug)}`);assert.equal(page('h1').text(),'일상');assert.equal(page('.post-card').length,2);assert.ok(!page('#main').text().includes('private'));assert.equal(page('#category-drawer [data-category-id="daily"] a').attr('aria-current'),'page');assert.equal(page('.breadcrumbs [aria-current="page"]').text(),'일상');assert.equal(page('link[rel="canonical"]').attr('href'),`https://dwnc.me/category/${encodeURIComponent(slug)}`);}
const swimming=await html('/category/'+encodeURIComponent('수영-일기'));const parent=swimming('[data-category-id="swimming"]');assert.equal(parent.find('> .category-branch__row > a').length,0);assert.equal(parent.find('> .category-branch__row > button').attr('aria-expanded'),'true');assert.equal(parent.find('> ul').attr('hidden'),undefined);assert.equal(parent.find('> ul > li').first().text(),'수영 전체 보기');assert.equal(parent.find('.category-branch__chevron').text(),'⌄');assert.equal(swimming('.breadcrumbs a').last().text(),'수영');
const article=await html(alias.publicPath+'?preview=1');assert.equal(article('.post-header__kicker').text(),'일상');assert.equal(article('#category-drawer [data-category-id="daily"] a').attr('aria-current'),'page');assert.ok(article('.post-related').text().includes('합성 기존 공개 글'));assert.ok(!article('#main').text().includes('아직 공개하지 않은'));
for(const page of [home,index,swimming,article]){const entry=page('.site-nav [data-public-admin-entry]');assert.equal(entry.length,1);assert.equal(entry.attr('href'),'https://admin.dwnc.me/#view=posts');assert.equal(entry.attr('target'),'_blank');assert.equal(entry.attr('rel'),'noopener noreferrer');assert.equal(entry.text(),'관리자 로그인 ↗');assert.equal(entry.closest('[hidden]').length,0)}
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'category-test',alg:'RS256',use:'sig'};
const env={ACCESS_TEAM_DOMAIN:'https://category-test.cloudflareaccess.com',ACCESS_AUD:'abcdefghijklmnopqrstuvwx',ACCESS_ALLOWED_EMAIL:'owner@example.test',NATIVE_DB:db};const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),head=b64({alg:'RS256',kid:jwk.kid}),payload=b64({iss:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD,sub:'synthetic',email:env.ACCESS_ALLOWED_EMAIL,exp:2_000_000_000}),jwt=`${head}.${payload}.${sign('RSA-SHA256',Buffer.from(`${head}.${payload}`),privateKey).toString('base64url')}`;clearAccessKeyCacheForTests();const headers={'cf-access-jwt-assertion':jwt};await verifyAccessIdentity(new Request('https://admin.example.test',{headers}),env,{fetcher:async()=>Response.json({keys:[jwk]})});
for(const id of ['daily','daily-stories']){const response=await adminWorker.fetch(new Request(`https://admin.example.test/api/posts?categoryId=${id}`,{headers}),env,{});assert.equal(response.status,200);const result=await response.json();assert.equal(result.total,3);assert.ok(result.posts.some(p=>p.categoryId==='daily-stories'));assert.ok(result.posts.some(p=>p.categoryId==='daily'));}
assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM post_view_daily').get().count,0);
for(const [table,rows]of Object.entries(preserved))assert.deepEqual(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),rows);
assert.deepEqual((await config.categories()).value,categories);
console.log(JSON.stringify({suite:'category-display',status:'PASS',behavior:'merged daily counts and aliases, retained source categories and working copies, parent-row navigation and active lineage, matching admin filters, excluded preview views'}));
