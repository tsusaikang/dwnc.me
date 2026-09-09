import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { load } from 'cheerio';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { verifyAccessIdentity, clearAccessKeyCacheForTests } from '../src/lib/access-auth.ts';
import admin from '../src/admin-worker.ts';

// Only synthetic records are used. The imported snapshot and its policy become
// visible in one transaction, as required by the private importer contract.
const db = await createEditorDatabase();
seedLegacy(db);
const publicBefore = db.sqlite.prepare('SELECT * FROM legacy_posts').all();
const mediaId = '123e4567-e89b-42d3-a456-426614174088';
const mediaPath = `/media/native/${mediaId}.png`;
const html = `<p>PRIVATE_SYNTHETIC_BODY</p><table><tr><td colspan="2">preserved</td></tr></table><img src="${mediaPath}" alt="fixture"><img src="${mediaPath.replace('.png','.svg')}" alt="vector"><video controls src="${mediaPath.replace('.png','.mp4')}" poster="${mediaPath}"></video>`;
await db.batch([
  db.prepare(`INSERT INTO legacy_posts(id,global_sequence,source,source_id,source_url,legacy_path,title,description,body_html,body_text,category_id,category_slug,category_label,tags_json,legacy_categories_json,cover_path,cover_alt,cover_media_id,created_at,updated_at,published_at,import_complete)
    VALUES('legacy-2',2,'naver','synthetic-private','https://example.test/private','/naver/synthetic-private','PRIVATE_SYNTHETIC_TITLE','PRIVATE_SYNTHETIC_DESCRIPTION',?1,'PRIVATE_SYNTHETIC_BODY','private-import','private-import','SYNTHETIC_ORIGINAL_CATEGORY','[]','[]',?2,'fixture',?3,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',1)`).bind(html, mediaPath, mediaId),
  db.prepare("INSERT INTO content_operations(post_id,kind,visibility) VALUES('legacy-2','post','private')"),
]);
const store = new NativePostStore(db);
const bytes = new TextEncoder().encode('synthetic image');
const hash = await crypto.subtle.digest('SHA-256', bytes), sha256 = Buffer.from(hash).toString('hex');
await store.addMedia({id:mediaId,postId:'legacy-2',publicPath:mediaPath,objectKey:mediaPath.slice(1),sha256,bytes:bytes.length,mime:'image/png',alt:'fixture',createdAt:'2026-09-01T00:00:00Z'});
const variants = new Map([[mediaPath,{bytes,mime:'image/png',hash,sha256}]]);
for (const [suffix,mime] of [['svg','image/svg+xml'],['ico','image/x-icon'],['mp4','video/mp4']]) {
 const path=mediaPath.replace('.png','.'+suffix), data=new TextEncoder().encode(suffix==='svg'?'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>':'synthetic mp4'), digest=await crypto.subtle.digest('SHA-256',data), hex=Buffer.from(digest).toString('hex');
 variants.set(path,{bytes:data,mime,hash:digest,sha256:hex});
 await store.addMedia({id:mediaId.replace(/088$/,suffix==='svg'?'089':suffix==='ico'?'091':'090'),postId:'legacy-2',publicPath:path,objectKey:path.slice(1),sha256:hex,bytes:data.length,mime,alt:'fixture',createdAt:'2026-09-01T00:00:00Z'});
}
let reads = 0;
const object = (key, options) => { reads++; const data=variants.get('/'+key);return {size:data.bytes.length,httpMetadata:{contentType:data.mime},customMetadata:{sha256:data.sha256,contract:'dwnc-native-media-v1'},checksums:{sha256:data.hash},httpEtag:'"fixture"',body:options?.range?data.bytes.slice(options.range.offset,options.range.offset+options.range.length):data.bytes}; };
const env = {NATIVE_DB:db,NATIVE_MEDIA_BUCKET:{get:async (key,options)=>object(key,options),head:async key=>object(key)},ACCESS_TEAM_DOMAIN:'https://private-fixture.cloudflareaccess.com',ACCESS_AUD:'abcdefghijklmnopqrstuvwx',ACCESS_ALLOWED_EMAIL:'owner@example.test'};
const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const jwk = {...publicKey.export({format:'jwk'}),kid:'private-fixture',alg:'RS256',use:'sig'};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const header = encode({alg:'RS256',kid:jwk.kid}), payload = encode({iss:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD,sub:'fixture',email:env.ACCESS_ALLOWED_EMAIL,exp:Math.floor(Date.now()/1000)+3600});
const token = `${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
clearAccessKeyCacheForTests();
await verifyAccessIdentity(new Request('https://admin.dwnc.me',{headers:{'cf-access-jwt-assertion':token}}),env,{fetcher:async()=>Response.json({keys:[jwk]})});
const adminGet = (path,authenticated=true,method='GET',headers={}) => admin.fetch(new Request(`https://admin.dwnc.me${path}`,{method,headers:authenticated?{'cf-access-jwt-assertion':token,...headers}:headers}),env,{});
for (const path of ['/api/posts?status=private','/api/posts/legacy-2','/api/posts/legacy-2/media',mediaPath]) assert.equal((await adminGet(path,false)).status,401);
assert.equal(reads,0);
const listing = await (await adminGet('/api/posts?status=private')).json();
assert.equal(listing.total,1); assert.equal(listing.posts[0].id,'legacy-2'); assert.equal(listing.posts[0].visibility,'private');
assert.equal((await (await adminGet('/api/posts/legacy-2')).json()).post.bodyHtml,html);
assert.equal((await (await adminGet('/api/posts/legacy-2/media')).json()).media[0].path,mediaPath);
for (const method of ['GET','HEAD']) { const response=await adminGet(mediaPath,true,method); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store'); }
for(const path of variants.keys()){assert.equal((await adminGet(path,false)).status,401);const response=await adminGet(path);assert.equal(response.status,200);if(path.endsWith('.svg'))assert.match(response.headers.get('content-security-policy'),/^sandbox; default-src 'none'/);}
assert.equal((await store.mediaForPost('legacy-2')).length,3);
const rangeResponse=await adminGet(mediaPath.replace('.png','.mp4'),true,'GET',{range:'bytes=0-3'});assert.equal(rangeResponse.status,206);assert.equal(rangeResponse.headers.get('content-length'),'4');assert.equal((await rangeResponse.arrayBuffer()).byteLength,4);assert.match(rangeResponse.headers.get('content-range'),/^bytes 0-3\//);
assert.equal((await adminGet(mediaPath.replace('.png','.mp4'),true,'GET',{range:'bytes=999999-'})).status,416);
const beforePublicReads = reads;
class Rewriter { handlers=[]; on(selector,handler){this.handlers.push([selector,handler]);return this;} async transform(response){const $=load(await response.text());for(const [selector,handler] of this.handlers)$(selector).each((_i,node)=>handler.element({setInnerContent:(value,options={})=>options.html?$(node).html(value):$(node).text(value),setAttribute:(key,value)=>$(node).attr(key,value),remove:()=>$(node).remove(),append:value=>$(node).append(value)}));return new Response($.html(),{status:response.status,headers:response.headers});} }
globalThis.HTMLRewriter = Rewriter;
const worker = createNativePublicWorker(async request => {const path=new URL(request.url).pathname;if(path==='/search-index.json')return Response.json([]);if(path.startsWith('/naver/')||path.startsWith('/media/'))return new Response('Not found',{status:404});return new Response('<html><head><title>fixture</title></head><body><main id="main"></main></body></html>',{headers:{'content-type':'text/html'}});});
const get = (path,method='GET') => worker(new Request(`https://dwnc.me${path}`,{method}),env,{});
for (const path of ['/posts/2','/posts/2/','/posts/2/index.html','/posts/%32','/naver/synthetic-private',mediaPath]) for(const method of ['GET','HEAD']) assert.equal((await get(path,method)).status,404,path);
for(const path of variants.keys())assert.equal((await get(path)).status,404);
assert.equal(reads,beforePublicReads);
for (const path of ['/','/archive','/category','/tags','/search-index.json','/rss.xml','/sitemap-0.xml']) { const body=await(await get(path)).text(); assert.ok(!body.includes('PRIVATE_SYNTHETIC'),path); assert.ok(!body.includes(mediaPath),path); }
let post=await store.getForAdmin('legacy-2');
post=await store.update(post.id,post.revision,{...post,title:'PRIVATE_SYNTHETIC_EDIT',bodyMarkdown:html});
assert.equal(post.visibility,'private');assert.equal(post.categoryId,'private-import');
await assert.rejects(()=>store.update(post.id,post.revision,{...post,categoryId:'invented-category'}),/NATIVE_E_INPUT/);
await assert.rejects(()=>store.publish(post.id,post.revision,{visibility:'public'}),/NATIVE_E_PUBLIC_CATEGORY/);assert.ok(post.bodyHtml.includes('colspan="2"'));assert.ok(post.bodyHtml.includes(mediaPath));assert.ok(post.bodyHtml.includes('.svg'));assert.ok(post.bodyHtml.includes('.mp4'));assert.match(post.bodyHtml,/<video[^>]*controls/);
assert.equal(db.sqlite.prepare("SELECT title FROM legacy_posts WHERE id='legacy-2'").get().title,'PRIVATE_SYNTHETIC_TITLE');
assert.equal((await get('/posts/2')).status,404);
assert.deepEqual(db.sqlite.prepare("SELECT * FROM legacy_posts WHERE id='legacy-1'").all(),publicBefore);
console.log(JSON.stringify({suite:'private-legacy-runtime',status:'PASS',behavior:'authenticated list/edit/media, no-store media, private public-route and discovery isolation, working-copy and existing-public preservation'}));
