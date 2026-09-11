import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { CmsConfigurationStore } from '../src/lib/cms-configuration.ts';
import { verifyAccessIdentity, clearAccessKeyCacheForTests } from '../src/lib/access-auth.ts';
import worker from '../src/admin-worker.ts';
const db=await createEditorDatabase();seedLegacy(db);
const store=new NativePostStore(db), category=(await new CmsConfigurationStore(db).categories()).value[0];
const make=async(kind)=>{let p=await store.createDraft(category,kind);p=await store.update(p.id,p.revision,{...p,title:'Synthetic deep link',bodyFormat:'html',bodyMarkdown:'<p>Published fixture</p>'});p=await store.publish(p.id,p.revision);return store.update(p.id,p.revision,{...p,title:'Unsaved publication fixture',bodyMarkdown:'<p>Working copy fixture</p>'});};
const post=await make('post'),page=await make('page');
const before=db.sqlite.prepare('SELECT * FROM editor_working_copies ORDER BY post_id').all();
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'session-test',alg:'RS256',use:'sig'};
const env={ACCESS_TEAM_DOMAIN:'https://session-test.cloudflareaccess.com',ACCESS_AUD:'abcdefghijklmnopqrstuvwx',ACCESS_ALLOWED_EMAIL:'owner@example.test',NATIVE_DB:db};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const token=(overrides={})=>{const head=encode({alg:'RS256',kid:jwk.kid}),body=encode({iss:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD,sub:'fixture-owner',email:env.ACCESS_ALLOWED_EMAIL,exp:Math.floor(Date.now()/1000)+3600,...overrides});return `${head}.${body}.${sign('RSA-SHA256',Buffer.from(`${head}.${body}`),privateKey).toString('base64url')}`;};
const jwt=token();clearAccessKeyCacheForTests();await verifyAccessIdentity(new Request('https://admin.dwnc.me',{headers:{'cf-access-jwt-assertion':jwt}}),env,{fetcher:async()=>Response.json({keys:[jwk]})});
const request=(path='/api/session',headers={},options={})=>worker.fetch(new Request(`https://admin.dwnc.me${path}`,{headers:{'cf-access-jwt-assertion':jwt,origin:'https://dwnc.me',...headers},...options}),env,{});
let response=await request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{authenticated:true});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('vary'),'Origin');assert.equal(response.headers.get('access-control-allow-origin'),'https://dwnc.me');assert.equal(response.headers.get('access-control-allow-credentials'),'true');assert.equal(response.headers.get('set-cookie'),null);
for(const assertion of ['',token({exp:Math.floor(Date.now()/1000)-1}),token({email:'other@example.test'}),token({aud:'other-audience'}),jwt.slice(0,-8)+'invalid!']){response=await request('/api/session',{'cf-access-jwt-assertion':assertion});assert.equal(response.status,401);assert.deepEqual(await response.json(),{authenticated:false});assert.equal(response.headers.get('access-control-allow-origin'),'https://dwnc.me');}
// A second exact account receives the same session and editor access only while configured.
const secondHeaders={'cf-access-jwt-assertion':token({email:'second@example.test'})};
assert.equal((await request('/api/session',secondHeaders)).status,401);
env.ACCESS_ADDITIONAL_ALLOWED_EMAILS='Second@example.test';
response=await request('/api/session',secondHeaders);assert.equal(response.status,200);assert.deepEqual(await response.json(),{authenticated:true});
assert.equal((await request('/',secondHeaders)).status,200);
assert.equal((await request('/api/posts/resolve?path=/posts/1',secondHeaders)).status,200);
assert.equal((await request('/api/session',{'cf-access-jwt-assertion':token({email:'other@example.test'})})).status,401);
delete env.ACCESS_ADDITIONAL_ALLOWED_EMAILS;
assert.equal((await request('/api/session',secondHeaders)).status,401);
assert.equal((await request('/api/session')).status,200);
for(const origin of ['null','https://evil.test','https://dwnc.me.evil.test','http://dwnc.me','https://www.dwnc.me','https://dwnc.me:444']){response=await request('/api/session',{origin});assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.deepEqual(await response.json(),{authenticated:false});}
for(const method of ['POST','OPTIONS','HEAD'])assert.equal((await request('/api/session',{}, {method})).status,405);
assert.equal((await request('/api/session?token=unused')).status,403);
response=await request('/api/session',{origin:'https://admin.dwnc.me'});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),null);
for(const fixture of [post,page,{id:'legacy-1',publicPath:'/posts/1'}]){response=await request('/api/posts/resolve?'+new URLSearchParams({path:fixture.publicPath}));assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),null);const result=await response.json();assert.equal(result.post.id,fixture.id);if(fixture.id!=='legacy-1')assert.equal(result.post.title,'Unsaved publication fixture');}
for(const path of ['/posts/01','/posts/1/','https://dwnc.me/posts/1','//evil.test/posts/1','/posts/1?x=1','/pages/legacy-1'])assert.equal((await request('/api/posts/resolve?'+new URLSearchParams({path}))).status,400);
assert.equal((await request('/api/posts/resolve?path=/posts/1&path=/posts/2')).status,400);assert.equal((await request('/api/posts/resolve?path=/posts/999999')).status,404);
assert.equal((await request('/api/posts/resolve?path=/posts/1',{'cf-access-jwt-assertion':''})).status,401);
assert.deepEqual(db.sqlite.prepare('SELECT * FROM editor_working_copies ORDER BY post_id').all(),before);
// HTML conversion is authenticated, same-origin, and has no database writes.
const convert=(headers={},body={html:'<p>붙여넣기 <strong>서식</strong></p>'})=>request('/api/html-paste',{origin:'https://admin.dwnc.me','content-type':'application/json',...headers},{method:'POST',body:JSON.stringify(body)});
response=await convert();assert.equal(response.status,200);assert.deepEqual(await response.json(),{html:'<p>붙여넣기 <strong>서식</strong></p>',omitted:false});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);
assert.equal((await convert({origin:'https://dwnc.me'})).status,403);assert.equal((await convert({'cf-access-jwt-assertion':''})).status,401);assert.equal((await convert({}, {html:'not html'})).status,400);assert.equal((await request('/api/html-paste')).status,404);
assert.deepEqual(db.sqlite.prepare('SELECT * FROM editor_working_copies ORDER BY post_id').all(),before);
console.log(JSON.stringify({suite:'admin-session',status:'PASS',behavior:'strict authenticated boolean only, exact credentialed CORS, fail closed, canonical working-copy resolution, no writes'}));
