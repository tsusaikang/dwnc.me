import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import sharp from 'sharp';
import { inspectPhotoPrefix, PHOTO_METADATA_PREFIX_BYTES } from '../src/lib/photo-file-metadata.ts';
import { serveAdminPhotoInfo } from '../src/lib/photo-media-info.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { ContentOperations } from '../src/lib/content-operations.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { verifyAccessIdentity, clearAccessKeyCacheForTests } from '../src/lib/access-auth.ts';
import admin from '../src/admin-worker.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import manifest from '../src/data/public-media-r2-v1.json' with {type:'json'};

const create = () => sharp({create:{width:32,height:24,channels:3,background:'#3070b0'}});
const srgb = await create().withIccProfile('srgb').jpeg().toBuffer();
const p3 = await create().withIccProfile('p3').jpeg().toBuffer();
const plain = await create().jpeg().toBuffer();
const inspect = (bytes, mime='image/jpeg') => inspectPhotoPrefix(bytes,bytes.length,mime);
assert.deepEqual(inspect(srgb),{format:'JPEG',bytes:srgb.length,width:32,height:24,colorSpace:'sRGB',profileName:'sRGB',hdr:'not-indicated',metadataComplete:true});
assert.equal(inspect(p3).colorSpace,'Display P3');
assert.equal(inspect(plain).colorSpace,null,'An untagged JPEG is not assumed to be sRGB');
const rotated=await create().withMetadata({orientation:6}).jpeg().toBuffer();
assert.equal(inspect(rotated).width,24);assert.equal(inspect(rotated).height,32);
const segment=(marker,body)=>{const head=Buffer.from([255,marker,0,0]);head.writeUInt16BE(body.length+2,2);return Buffer.concat([head,body])};
const inject=(source,...segments)=>Buffer.concat([source.subarray(0,2),...segments,source.subarray(2)]);
const xmp=segment(0xe1,Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/>'));
const iso=segment(0xe2,Buffer.from('urn:iso:std:iso:ts:21496:-1\0\x00\x00'));
assert.equal(inspect(inject(plain,xmp)).hdr,'metadata-present','Orphan XMP is a declaration, never proof of an HDR gain-map payload');
assert.equal(inspect(inject(plain,iso)).hdr,'metadata-present','ISO-only declaration is recognized without legacy XMP');
assert.equal(inspect(inject(plain,segment(0xe2,Buffer.from('MPF\0stereo')))).hdr,'not-indicated','MPF alone does not imply HDR');
assert.equal(inspect(inject(plain,segment(0xe1,Buffer.from('http://ns.adobe.com/xmp/extension/\0unparsed')))).hdr,'unknown');
const padded=inject(plain,...Array.from({length:5},()=>segment(0xe0,Buffer.alloc(60000))));
assert.equal(inspect(padded).metadataComplete,false);assert.equal(inspect(padded).hdr,'unknown');assert.equal(inspect(padded).width,null);
for(let length=0;length<srgb.length;length+=7)assert.doesNotThrow(()=>inspect(srgb.subarray(0,length)),'Truncated marker/ICC/EXIF input is bounded and safe');
// A deceptive ICC profile name and a wrong transfer curve cannot override the
// actual colorants. Change only metadata in synthetic files.
function mutateIcc(source,change){const bytes=Buffer.from(source);for(let at=2;at+4<=bytes.length;){const marker=bytes[at+1];if(marker===0xda)break;const length=bytes.readUInt16BE(at+2);if(marker===0xe2&&bytes.toString('ascii',at+4,at+16)==='ICC_PROFILE\0'){change(bytes.subarray(at+18,at+length+2));break}at+=length+2}return bytes}
function tag(profile,name){for(let i=0;i<profile.readUInt32BE(128);i++){const at=132+i*12;if(profile.toString('ascii',at,at+4)===name)return profile.subarray(profile.readUInt32BE(at+4),profile.readUInt32BE(at+4)+profile.readUInt32BE(at+8))}return null}
const wrongCurve=mutateIcc(srgb,profile=>tag(profile,'rTRC').writeInt32BE(65536,12));
assert.equal(inspect(wrongCurve).profileName,'sRGB');assert.equal(inspect(wrongCurve).colorSpace,null,'A name is only a declaration');
const onlyName=mutateIcc(srgb,profile=>{for(let i=0;i<profile.readUInt32BE(128);i++){const at=132+i*12;if(profile.toString('ascii',at,at+4)==='rXYZ')profile.write('zzzz',at,'ascii')}});
assert.equal(inspect(onlyName).profileName,'sRGB');assert.equal(inspect(onlyName).colorSpace,null);
for(const [format,mime,bytes] of [['PNG','image/png',await create().png().toBuffer()],['GIF','image/gif',await create().gif().toBuffer()],['WebP','image/webp',await create().webp().toBuffer()]]){
  const info=inspect(bytes,mime);assert.equal(info.format,format);assert.equal(info.width,32);assert.equal(info.height,24);assert.equal(info.hdr,'unknown');
}
const avif=await create().avif().toBuffer();assert.equal(inspect(avif,'image/avif').format,'AVIF');assert.equal(inspect(avif,'image/avif').width,null,'Unresolved AVIF item transforms are not guessed');

const database=await createEditorDatabase();seedLegacy(database);
const store=new NativePostStore(database),ops=new ContentOperations(database),category={id:'daily',slug:'일상',label:'일상'};
const assets=new Map(),reads=[];let serial=1;
async function add(post,bytes=srgb){const id='123e4567-e89b-42d3-a456-426614175'+String(serial++).padStart(3,'0'),path='/media/native/'+id+'.jpg',hash=await crypto.subtle.digest('SHA-256',bytes),sha256=Buffer.from(hash).toString('hex');assets.set(path.slice(1),{bytes,hash,sha256});await store.addMedia({id,postId:post.id,publicPath:path,objectKey:path.slice(1),sha256,bytes:bytes.length,mime:'image/jpeg',alt:'합성 사진',createdAt:new Date().toISOString()});return path}
const bucket={get:async(key,options)=>{reads.push({key,range:options?.range});const asset=assets.get(key);if(!asset)return null;const range=options?.range;return {size:asset.bytes.length,httpMetadata:{contentType:'image/jpeg'},customMetadata:{contract:'dwnc-native-media-v1',sha256:asset.sha256},checksums:{sha256:asset.hash},body:new Response(range?asset.bytes.subarray(range.offset,range.offset+range.length):asset.bytes).body}}};
const env={NATIVE_DB:database,NATIVE_MEDIA_BUCKET:bucket};
let published=await store.createDraft(category);const publicPath=await add(published),unused=await add(published,p3);
published=await store.update(published.id,published.revision,{...published,title:'메타데이터 합성',bodyFormat:'html',bodyMarkdown:'<img src="'+publicPath+'" alt="공개 사진">'});published=await store.publish(published.id,published.revision);
let working=await store.update(published.id,published.revision,{...published,bodyMarkdown:'<img src="'+unused+'" alt="작업본 사진">'});
const draft=await store.createDraft(category),draftPath=await add(draft),largePath=await add(draft,Buffer.concat([srgb,Buffer.alloc(700000)]));
const imported=manifest.entries.find(entry=>entry.contentType==='image/jpeg');let importedReads=0;
const worker=createNativePublicWorker(async request=>{const url=new URL(request.url);if(url.pathname!==imported.publicPath)return new Response('Not found',{status:404});importedReads++;const length=Math.min(imported.size,PHOTO_METADATA_PREFIX_BYTES),body=Buffer.alloc(length);srgb.copy(body);return new Response(body,{status:206,headers:{'content-type':imported.contentType,'content-length':String(length),'content-range':`bytes 0-${length-1}/${imported.size}`}})});
const get=(path,headers={},method='GET')=>worker(new Request('https://dwnc.me/api/photo-info?path='+encodeURIComponent(path),{method,headers}),env,{});
let response=await get(publicPath);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).info.colorSpace,'sRGB');
const beforeDenied=reads.length;
for(const path of [unused,draftPath,'https://external.example'+publicPath,publicPath.slice(1),'/media/native/no.jpg',publicPath+'%25'])assert.equal((await get(path)).status,404,path);
assert.equal(reads.length,beforeDenied,'Unauthorized requests do not read a file prefix');
assert.equal((await get(publicPath,{},'POST')).status,405);
assert.equal((await get('https://dwnc.me'+publicPath+'?version=2')).status,200);
assert.equal((await serveAdminPhotoInfo(publicPath,draft.id,env,store,async()=>new Response())).status,404,'A post-scoped admin request cannot inspect another post file');
response=await serveAdminPhotoInfo(largePath,draft.id,env,store,async()=>new Response());assert.equal(response.status,200);assert.equal((await response.json()).info.bytes,assets.get(largePath.slice(1)).bytes.length);assert.deepEqual(reads.at(-1).range,{offset:0,length:PHOTO_METADATA_PREFIX_BYTES});
// A removed public reference revokes metadata access; a private working-copy
// change did not revoke the still-published source before this publication.
await store.publish(working.id,working.revision);assert.equal((await get(publicPath)).status,404);assert.equal((await get(unused)).status,200);
let protectedPost=await store.createDraft(category),protectedPath=await add(protectedPost);
protectedPost=await store.update(protectedPost.id,protectedPost.revision,{...protectedPost,title:'보호 합성',bodyFormat:'html',bodyMarkdown:'<img src="'+protectedPath+'">'});
protectedPost=await store.publish(protectedPost.id,protectedPost.revision,{visibility:'protected',password:'synthetic password'});
assert.equal((await get(protectedPath)).status,404);
const cookie=await ops.unlock(protectedPost.id,'synthetic password',new Request('https://dwnc.me'));
assert.equal((await get(protectedPath,{cookie})).status,200);
protectedPost=await store.publish(protectedPost.id,protectedPost.revision,{visibility:'private'});assert.equal((await get(protectedPath,{cookie})).status,404);
protectedPost=await store.publish(protectedPost.id,protectedPost.revision,{visibility:'scheduled',scheduledAt:new Date(Date.now()+3600000).toISOString()});assert.equal((await get(protectedPath,{cookie})).status,404);
// Immutable imported assets use the same owner policy as their normal server.
const [,source,sourceId]=imported.publicPath.match(/^\/media\/([^/]+)\/([^/]+)\//);
database.sqlite.prepare('UPDATE legacy_posts SET source=?,source_id=? WHERE id=?').run(source,sourceId,'legacy-1');
let legacy=await store.getForAdmin('legacy-1');legacy=await store.publish(legacy.id,legacy.revision,{visibility:'private'});
assert.equal((await get(imported.publicPath)).status,404);assert.equal(importedReads,0);
legacy=await store.publish(legacy.id,legacy.revision,{visibility:'public'});
response=await get(imported.publicPath);assert.equal(response.status,200);assert.equal((await response.json()).info.bytes,imported.size);assert.equal(importedReads,1);
// Access and same-origin checks still wrap the read-only admin POST route.
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'metadata-fixture',alg:'RS256',use:'sig'};
Object.assign(env,{ACCESS_TEAM_DOMAIN:'https://metadata-fixture.cloudflareaccess.com',ACCESS_AUD:'synthetic-metadata-audience',ACCESS_ALLOWED_EMAIL:'owner@example.test'});
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),header=encode({alg:'RS256',kid:jwk.kid}),payload=encode({iss:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD,sub:'fixture',email:env.ACCESS_ALLOWED_EMAIL,exp:Math.floor(Date.now()/1000)+3600}),token=header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
clearAccessKeyCacheForTests();await verifyAccessIdentity(new Request('https://admin.dwnc.me',{headers:{'cf-access-jwt-assertion':token}}),env,{fetcher:async()=>Response.json({keys:[jwk]})});
const adminRequest=(authenticated=true,origin='https://admin.dwnc.me')=>admin.fetch(new Request('https://admin.dwnc.me/api/posts/'+draft.id+'/media-info',{method:'POST',headers:{...(authenticated?{'cf-access-jwt-assertion':token}:{}),origin,'content-type':'application/json'},body:JSON.stringify({path:largePath})}),env,{});
assert.equal((await adminRequest(false)).status,401);assert.equal((await adminRequest(true,'https://external.example')).status,403);
const revisions=database.sqlite.prepare('SELECT id,revision FROM native_posts ORDER BY id').all();assert.equal((await adminRequest()).status,200);assert.deepEqual(database.sqlite.prepare('SELECT id,revision FROM native_posts ORDER BY id').all(),revisions,'Photo information POST never edits content');
assert.ok(reads.every(read=>read.range.offset===0&&read.range.length<=PHOTO_METADATA_PREFIX_BYTES),'Every information request is a bounded one-image prefix read');
database.sqlite.close();
console.log(JSON.stringify({suite:'photo-media-info',status:'PASS',behavior:'actual sRGB/P3 and orientation metadata, no HDR/quality guesses, truncated and opaque formats, bounded one-image reads, published reference/private/scheduled/protected/admin ownership and same-origin checks'}));
