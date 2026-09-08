import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { CmsConfigurationStore } from '../src/lib/cms-configuration.ts';
import { PostViewStatistics, statisticsDay } from '../src/lib/post-view-statistics.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { verifyAccessIdentity, clearAccessKeyCacheForTests } from '../src/lib/access-auth.ts';
import adminWorker from '../src/admin-worker.ts';
const db=await createEditorDatabase();seedLegacy(db);
const store=new NativePostStore(db),settings=new CmsConfigurationStore(db),stats=new PostViewStatistics(db),category=(await settings.categories()).value[0];
const initial=await stats.summary(new URLSearchParams());assert.equal(initial.todayViews,0);assert.equal(initial.totalViews,0);assert.equal(initial.periodViews,0);assert.equal(initial.daily.length,30);assert.ok(initial.daily.every(row=>row.views===0));assert.equal(initial.posts[0].views,0);
const make=async(kind='post',visibility='public',options={})=>{let post=await store.createDraft(category,kind);post=await store.update(post.id,post.revision,{...post,title:`synthetic ${kind} ${visibility}`,bodyFormat:'html',bodyMarkdown:'<p>Statistics synthetic body</p>'});return store.publish(post.id,post.revision,{visibility,...options});};
const publicPost=await make(),page=await make('page'),privatePost=await make('post','private'),protectedPost=await make('post','protected',{password:'synthetic-password'}),scheduledPost=await make('post','scheduled',{scheduledAt:new Date(Date.now()+3600000).toISOString()}),draft=await store.createDraft(category);
const preserved=Object.fromEntries(['native_posts','legacy_posts','editor_working_copies'].map(table=>[table,db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
class Rewriter{handlers=[];on(selector,handler){this.handlers.push([selector,handler]);return this;}async transform(response){const $=load(await response.text());for(const [selector,handler]of this.handlers)$(selector).each((_,node)=>handler.element({setInnerContent:(value,o={})=>o.html?$(node).html(value):$(node).text(value),setAttribute:(name,value)=>$(node).attr(name,value),remove:()=>$(node).remove(),append:value=>$(node).append(value)}));return new Response($.html(),{status:response.status,headers:response.headers});}}
globalThis.HTMLRewriter=Rewriter;
const shell='<html><head><title>Fixture</title></head><body><main id="main"></main></body></html>';
const assets=async request=>new URL(request.url).pathname==='/search-index.json'?Response.json([]):new Response(shell,{headers:{'content-type':'text/html'}});
const worker=createNativePublicWorker(assets),pending=[];
const browser={'user-agent':'Mozilla/5.0 AppleWebKit/537.36 Chrome/145.0 Safari/537.36',accept:'text/html,application/xhtml+xml','sec-fetch-dest':'document'};
const request=async(path,{headers={},method='GET',environment={}}={})=>worker(new Request(`https://dwnc.me${path}`,{method,headers:{...browser,...headers}}),{NATIVE_DB:db,...environment},{waitUntil:promise=>pending.push(promise)});
const flush=async()=>{await Promise.all(pending.splice(0));};
assert.equal((await request(publicPost.publicPath)).status,200);await flush();assert.equal((await stats.summary(new URLSearchParams())).totalViews,1);
const excluded=[
 {method:'HEAD'},
 {headers:{'user-agent':'Googlebot/2.1'}},{headers:{'user-agent':'bingbot'}},{headers:{'user-agent':'HeadlessChrome/145'}},
 {headers:{'user-agent':''}},{headers:{accept:'application/json'}},{headers:{'sec-fetch-dest':'iframe'}},
 {headers:{'sec-purpose':'prefetch;prerender'}},{headers:{purpose:'preview'}},
 {headers:{'cf-access-jwt-assertion':'synthetic-admin-assertion'}},{headers:{cookie:'CF_Authorization=synthetic-admin-cookie'}},
 {headers:{referer:'https://admin.dwnc.me/?synthetic-private-editor-context'}},{environment:{DWNC_DEPLOYMENT_ENVIRONMENT:'staging',CF_VERSION_METADATA:{id:'123e4567-e89b-42d3-a456-426614174000'}}},
];
for(const options of excluded)assert.equal((await request(publicPost.publicPath,options)).status,200);
for(const path of ['/', '/archive','/rss.xml','/search-index.json',`${publicPost.publicPath}?preview=1`])assert.equal((await request(path)).status,200);
assert.equal((await request('/naver/220404726308')).status,308);assert.equal((await request(`${publicPost.publicPath}/`)).status,308);
assert.equal((await request(privatePost.publicPath)).status,404);assert.equal((await request(scheduledPost.publicPath)).status,404);assert.equal((await request(protectedPost.publicPath)).status,200);assert.equal((await request('/posts/999999')).status,404);
await flush();assert.equal((await stats.summary(new URLSearchParams())).totalViews,1);
await Promise.all(Array.from({length:12},()=>request(publicPost.publicPath)));await request(page.publicPath);await request('/posts/1');await flush();
const after=await stats.summary(new URLSearchParams());assert.equal(after.totalViews,15);assert.equal(after.periodViews,15);assert.equal(after.todayViews,15);assert.equal(after.posts.find(p=>p.id===publicPost.id).views,13);assert.equal(after.posts.find(p=>p.id===page.id).views,1);assert.equal(after.posts.find(p=>p.id==='legacy-1').views,1);assert.equal(after.posts.find(p=>p.id===draft.id).path,null);assert.equal(after.posts.find(p=>p.id===draft.id).views,0);
for(const [table,rows]of Object.entries(preserved))assert.deepEqual(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),rows);
assert.deepEqual(db.sqlite.prepare('PRAGMA table_info(post_view_daily)').all().map(row=>row.name),['post_id','day','views']);
// A logging/storage outage must not turn a successfully rendered article into an error.
const actualPrepare=db.prepare.bind(db),logs=[],originalError=console.error;console.error=value=>logs.push(value);
try{db.prepare=sql=>{if(sql.includes('INSERT INTO post_view_daily'))throw new Error('synthetic request details must not be logged');return actualPrepare(sql);};assert.equal((await request(publicPost.publicPath)).status,200);await flush();}finally{db.prepare=actualPrepare;console.error=originalError;}
assert.deepEqual(logs,[JSON.stringify({event:'dwnc_statistics_error',code:'STATS_W_WRITE'})]);
const failedWorker=createNativePublicWorker(async()=>new Response('<p>Unavailable</p>',{status:503,headers:{'content-type':'text/html'}}));assert.equal((await failedWorker(new Request(`https://dwnc.me${publicPost.publicPath}`,{headers:browser}),{NATIVE_DB:db},{waitUntil:p=>pending.push(p)})).status,503);await flush();assert.equal((await stats.summary(new URLSearchParams())).totalViews,15);
// Missing imported metadata still uses the public allowlisted static fallback.
const fallbackDb=await createEditorDatabase(),fallbackPending=[];
const fallbackResponse=await worker(new Request('https://dwnc.me/posts/1',{headers:browser}),{NATIVE_DB:fallbackDb},{waitUntil:p=>fallbackPending.push(p)});
assert.equal(fallbackResponse.status,200);await Promise.all(fallbackPending);
const fallbackReport=await new PostViewStatistics(fallbackDb).summary(new URLSearchParams());assert.equal(fallbackReport.totalViews,1);assert.equal(fallbackReport.posts[0].path,'/posts/1');assert.equal(fallbackReport.posts[0].views,1);
await worker(new Request('https://dwnc.me/posts/1',{method:'HEAD',headers:browser}),{NATIVE_DB:fallbackDb},{waitUntil:p=>fallbackPending.push(p)});await Promise.all(fallbackPending);assert.equal((await new PostViewStatistics(fallbackDb).summary(new URLSearchParams())).totalViews,1);
// Fixed-clock day boundaries and historical buckets, no per-visitor identifiers.
const dated=await createEditorDatabase();seedLegacy(dated);let now=new Date('2026-09-01T14:59:59Z');const datedStats=new PostViewStatistics(dated,()=>now);
assert.equal(statisticsDay(now,'Asia/Seoul'),'2026-09-01');await datedStats.increment('legacy-1','Asia/Seoul');now=new Date('2026-09-01T15:00:00Z');assert.equal(statisticsDay(now,'Asia/Seoul'),'2026-09-02');await Promise.all(Array.from({length:30},()=>datedStats.increment('legacy-1','Asia/Seoul')));now=new Date('2026-09-04T03:00:00Z');
const historical=await datedStats.summary(new URLSearchParams('startDate=2026-09-01&endDate=2026-09-03'));assert.deepEqual(historical.daily,[{date:'2026-09-01',views:1},{date:'2026-09-02',views:30},{date:'2026-09-03',views:0}]);assert.equal(historical.todayViews,0);assert.equal(historical.periodViews,31);assert.equal(historical.totalViews,31);
for(const query of ['startDate=2026-02-30','startDate=2026-09-05&endDate=2026-09-04','startDate=2024-01-01&endDate=2026-09-04','endDate=2026-09-05','unexpected=1','endDate=2026-09-03&endDate=2026-09-04'])await assert.rejects(()=>datedStats.summary(new URLSearchParams(query)),/STATISTICS_RANGE/);
// Authenticated API is read-only; requests to the administrator never collect views.
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'statistics-test',alg:'RS256',use:'sig'};
const env={ACCESS_TEAM_DOMAIN:'https://statistics-test.cloudflareaccess.com',ACCESS_AUD:'abcdefghijklmnopqrstuvwx',ACCESS_ALLOWED_EMAIL:'owner@example.test',NATIVE_DB:db};
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),head=b64({alg:'RS256',kid:jwk.kid}),payload=b64({iss:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD,sub:'synthetic',email:env.ACCESS_ALLOWED_EMAIL,exp:2_000_000_000});const jwt=`${head}.${payload}.${sign('RSA-SHA256',Buffer.from(`${head}.${payload}`),privateKey).toString('base64url')}`;
clearAccessKeyCacheForTests();const headers={'cf-access-jwt-assertion':jwt,origin:'https://admin.example.test','content-type':'application/json'};await verifyAccessIdentity(new Request('https://admin.example.test',{headers}),env,{fetcher:async()=>Response.json({keys:[jwk]})});
const api=(path,opts={})=>adminWorker.fetch(new Request(`https://admin.example.test${path}`,{headers,...opts}),env,{});
assert.equal((await api('/api/statistics',{headers:{}})).status,401);const report=await api('/api/statistics');assert.equal(report.status,200);assert.equal(report.headers.get('cache-control'),'no-store');assert.equal((await report.json()).totalViews,15);assert.equal((await api('/api/statistics?startDate=bad')).status,400);assert.equal((await api('/api/statistics',{method:'POST',body:'{}'})).status,404);assert.equal((await stats.summary(new URLSearchParams())).totalViews,15);
console.log(JSON.stringify({suite:'post-view-statistics',status:'PASS',behavior:'zero baseline, real public document reads only, HEAD/bots/admin/prefetch/privacy exclusion, concurrent counts, daily range and zero filling, authenticated read-only API, failure isolation and unchanged post rows'}));
