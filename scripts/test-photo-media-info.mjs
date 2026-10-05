import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import sharp from 'sharp';
import { inspectPhotoPrefix, inspectPhotoWithAuxiliary, photoAuxiliaryRange, PHOTO_METADATA_PREFIX_BYTES } from '../src/lib/photo-file-metadata.ts';
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
assert.deepEqual(inspect(srgb),{format:'JPEG',bytes:srgb.length,width:32,height:24,colorSpace:'sRGB',profileName:'sRGB',colorProfileFormat:'ICC',hdr:'not-indicated',metadataComplete:true});
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
assert.deepEqual(inspect(inject(plain,xmp)).hdrDetails,{formats:['Adobe HDR 게인맵'],versions:['Adobe 1.0']},'A version-only declaration never gains default brightness values');
assert.deepEqual(inspect(inject(plain,iso)).hdrDetails,{formats:['ISO 21496-1 게인맵']},'An incomplete ISO version remains a declaration');
const adobeNs='http://ns.adobe.com/hdr-gain-map/1.0/',rdfNs='http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const packet=xml=>segment(0xe1,Buffer.from('http://ns.adobe.com/xap/1.0/\0'+xml));
const exifColor=Buffer.from('4578696600004d4d002a000000080001a0010003000000010001000000000000','hex');
assert.equal(inspect(inject(plain,segment(0xe1,exifColor))).colorProfileFormat,'EXIF','An EXIF sRGB color-space declaration is distinguished from an embedded ICC profile');
const adobe=(attributes='',children='')=>packet(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${rdfNs}"><rdf:Description xmlns:gain="${adobeNs}" gain:Version="1.0" ${attributes}>${children}</rdf:Description></rdf:RDF></x:xmpmeta>`);
const adobeDetails=adobe('gain:GainMapMin="-.5" gain:GainMapMax="4.25" gain:HDRCapacityMin="0" gain:HDRCapacityMax="4.5" gain:BaseRenditionIsHDR="False"');
assert.deepEqual(inspect(inject(plain,adobeDetails)).hdrDetails,{formats:['Adobe HDR 게인맵'],versions:['Adobe 1.0'],gainMapMin:[-.5],gainMapMax:[4.25],hdrCapacityMin:0,hdrCapacityMax:4.5,baseRenditionIsHDR:false,parameterSource:'adobe'},'Recorded log2 values retain their unit, including explicit zero and false');
const rgbDetails=adobe('',`<gain:GainMapMin><rdf:Seq><rdf:li>-1</rdf:li><rdf:li>-.5</rdf:li><rdf:li>0</rdf:li></rdf:Seq></gain:GainMapMin><gain:GainMapMax><rdf:Seq><rdf:li>2</rdf:li><rdf:li>3</rdf:li><rdf:li>4</rdf:li></rdf:Seq></gain:GainMapMax><gain:HDRCapacityMax>4&#46;5</gain:HDRCapacityMax>`);
assert.deepEqual(inspect(inject(plain,rgbDetails)).hdrDetails.gainMapMin,[-1,-.5,0]);assert.deepEqual(inspect(inject(plain,rgbDetails)).hdrDetails.gainMapMax,[2,3,4]);assert.equal(inspect(inject(plain,rgbDetails)).hdrDetails.hdrCapacityMax,4.5,'Qualified child values and RGB ordered sequences work with alternate prefixes');
for(const metadata of [adobe('gain:GainMapMax="NaN"'),adobe('gain:GainMapMax="1e999"'),adobe('gain:GainMapMin="5" gain:GainMapMax="2"'),adobe('',`<gain:GainMapMax><rdf:Seq><rdf:li>1</rdf:li><rdf:li>2</rdf:li></rdf:Seq></gain:GainMapMax>`),adobe('gain:GainMapMax="4"','<gain:GainMapMax>6</gain:GainMapMax>')])assert.equal(inspect(inject(plain,metadata)).hdrDetails.gainMapMax,undefined,'Malformed, conflicting, or unsupported values cannot become usable numbers');
assert.equal(inspect(inject(plain,adobe('gain:HDRCapacityMin="4" gain:HDRCapacityMax="2"'))).hdrDetails.hdrCapacityMax,undefined,'A reversed display capacity range is omitted');
assert.equal(inspect(inject(plain,packet(`<meta xmlns:a="${adobeNs}" a:Version="2.0" a:GainMapMax="4"/>`))).hdrDetails.gainMapMax,undefined,'Future metadata versions keep their declaration without guessing numeric semantics');
assert.equal(inspect(inject(plain,packet(`<meta xmlns:a="${adobeNs}" a:Version="1.0"><child xmlns:a="https://unrelated.example/" a:GainMapMax="4"/></meta>`))).hdrDetails.gainMapMax,undefined,'A rebound prefix never borrows another namespace');
assert.equal(inspect(inject(plain,packet(`<meta xmlns:a="${adobeNs}" xmlns:b="${adobeNs}" a:Version="1.0" a:GainMapMax="1" b:GainMapMax="4"/>`))).hdrDetails,undefined,'Duplicate expanded XML attributes cannot overwrite the first recorded value');
assert.equal(inspect(inject(plain,packet(`<!-- <meta xmlns:a="${adobeNs}" a:Version="1.0" a:GainMapMax="4"/> --><meta/>`))).hdrDetails,undefined,'Text in an XML comment is not recorded HDR detail');
assert.equal(inspect(inject(plain,packet(`<!DOCTYPE meta [<!ENTITY number "4">]><meta xmlns:a="${adobeNs}" a:Version="1.0" a:GainMapMax="&number;"/>`))).hdrDetails,undefined,'XMP entity declarations are never expanded');
assert.equal(inspect(inject(plain,adobe('gain:GainMapMax="4"'),adobe('gain:GainMapMax="5"'))).hdrDetails.parameterSource,undefined,'Conflicting repeated packets do not silently select one brightness range');
const apple=(headroom='4',type='urn:com:apple:photo:2020:aux:hdrgainmap')=>packet(`<meta xmlns:p="http://ns.apple.com/pixeldatainfo/1.0/" xmlns:g="http://ns.apple.com/HDRGainMap/1.0/" p:AuxiliaryImageType="${type}" g:HDRGainMapVersion="65536"${headroom===null?'':` g:HDRGainMapHeadroom="${headroom}"`}/>`);
assert.deepEqual(inspect(inject(plain,apple())).hdrDetails,{formats:['Apple HDR 게인맵'],versions:['Apple 65536'],appleHeadroom:4,parameterSource:'apple'},'Apple headroom is the recorded linear SDR-white ratio');
assert.equal(inspect(inject(plain,apple(null))).hdrDetails.appleHeadroom,undefined,'Apple headroom is not inferred from a version');
assert.equal(inspect(inject(plain,apple('4','urn:com:apple:photo:2020:aux:depth'))).hdrDetails.appleHeadroom,undefined,'A different auxiliary image type does not supply HDR headroom');
assert.equal(inspect(inject(plain,apple('0.5'))).hdrDetails.appleHeadroom,undefined,'Invalid Apple headroom is omitted');
function isoBody(channels=1){const bytes=Buffer.alloc(21+channels*40);bytes[4]=0x40|(channels===3?0x80:0);let at=5;const fraction=(n,d=1)=>{bytes.writeInt32BE(n,at);bytes.writeUInt32BE(d,at+4);at+=8};fraction(0);fraction(4);for(let c=0;c<channels;c++){fraction(-1,2);fraction(3+c);fraction(1);fraction(0);fraction(0)}return bytes}
const isoPacket=body=>segment(0xe2,Buffer.concat([Buffer.from('urn:iso:std:iso:ts:21496:-1\0'),body]));
const isoDetailed=isoPacket(isoBody());
assert.deepEqual(inspect(inject(plain,isoDetailed)).hdrDetails,{formats:['ISO 21496-1 게인맵'],versions:['ISO 작성 0 · 최소 0'],parameterSource:'iso',gainMapMin:[-.5],gainMapMax:[3],hdrCapacityMin:0,hdrCapacityMax:4},'Known ISO rational fields are retained as log2 stops');
assert.deepEqual(inspect(inject(plain,isoPacket(isoBody(3)))).hdrDetails.gainMapMax,[3,4,5],'The ISO high channel-count bit selects RGB, not a low reserved bit');
const zeroDenominator=isoBody();zeroDenominator.writeUInt32BE(0,9);
const zeroMaximumDenominator=isoBody();zeroMaximumDenominator.writeUInt32BE(0,17);
const invalidRange=isoBody();invalidRange.writeInt32BE(9,21);
const reservedLayout=isoBody();reservedLayout[4]|=8;
const futureVersion=isoBody();futureVersion.writeUInt16BE(1,2);
for(const body of [zeroDenominator,zeroMaximumDenominator,invalidRange,reservedLayout,futureVersion,isoBody().subarray(0,60)])assert.equal(inspect(inject(plain,isoPacket(body))).hdrDetails.gainMapMax,undefined,'Invalid/truncated/future ISO records expose no guessed rationals');
assert.deepEqual(inspect(inject(plain,adobeDetails,isoDetailed)).hdrDetails.gainMapMax,[3],'ISO and Adobe numeric schemes are not mixed');
assert.equal(inspect(Buffer.concat([plain,adobeDetails])).hdrDetails,undefined,'Metadata appended after the primary scan is outside prefix inspection');
assert.equal(inspect(inject(plain,segment(0xe2,Buffer.from('MPF\0stereo')))).hdr,'not-indicated','MPF alone does not imply HDR');
function linkedJpeg(auxiliary, padding=0, mutate=()=>{}) {
  const body=Buffer.alloc(86);body.write('MPF\0',0,'latin1');const tiff=body.subarray(4);tiff.write('MM',0);tiff.writeUInt16BE(42,2);tiff.writeUInt32BE(8,4);tiff.writeUInt16BE(3,8);
  const entry=(at,tag,type,count,value)=>{tiff.writeUInt16BE(tag,at);tiff.writeUInt16BE(type,at+2);tiff.writeUInt32BE(count,at+4);tiff.writeUInt32BE(value,at+8)};
  entry(10,0xb000,7,4,0);tiff.write('0100',18);entry(22,0xb001,4,1,2);entry(34,0xb002,7,32,50);
  const primarySize=srgb.length+body.length+4+padding;
  tiff.writeUInt32BE(0x00030000,50);tiff.writeUInt32BE(primarySize,54);tiff.writeUInt32BE(auxiliary.length,70);tiff.writeUInt32BE(primarySize-10,74);mutate(tiff);
  const primary=inject(srgb,segment(0xe2,body));
  return Buffer.concat([primary.subarray(0,-2),Buffer.alloc(padding),primary.subarray(-2),auxiliary]);
}
const gainMap=inject(await create().toColourspace('b-w').jpeg().toBuffer(),adobeDetails,isoDetailed);
const linked=linkedJpeg(gainMap,300000),linkedRange=photoAuxiliaryRange(linked,linked.length);
assert.ok(linkedRange.offset>PHOTO_METADATA_PREFIX_BYTES);
const linkedInfo=inspectPhotoWithAuxiliary(linked,linked.length,'image/jpeg',linked.subarray(linkedRange.offset),linked.subarray(-2));
assert.deepEqual(linkedInfo.hdrDetails.gainMapImage,{format:'JPEG',width:32,height:24,channels:1},'An MPF-linked gain map exposes actual JPEG header dimensions/channels');
assert.equal(linkedInfo.colorSpace,'sRGB');assert.equal(linkedInfo.colorProfileFormat,'ICC','Auxiliary metadata never replaces primary color information');
assert.equal(linkedInfo.hdrDetails.parameterSource,'iso');assert.deepEqual(linkedInfo.hdrDetails.gainMapMax,[3]);assert.equal(linkedInfo.hdrDetails.baseRenditionIsHDR,false,'Explicit Adobe base rendition survives a separate ISO numeric scheme');
const stereo=linkedJpeg(p3),stereoRange=photoAuxiliaryRange(stereo,stereo.length);
assert.equal(inspectPhotoWithAuxiliary(stereo,stereo.length,'image/jpeg',stereo.subarray(stereoRange.offset),stereo.subarray(-2)).hdrDetails,undefined,'Ordinary MPF stereo is never identified as a gain map');
for(const bad of [linkedJpeg(gainMap,0,t=>t.writeUInt32BE(3,30)),linkedJpeg(gainMap,0,t=>t.writeUInt32BE(0xffffffff,74)),linkedJpeg(gainMap,0,t=>t.writeUInt32BE(0xffffffff,70)),linkedJpeg(gainMap,0,t=>t.writeUInt32BE(9,58)),linkedJpeg(gainMap,0,t=>t.writeUInt32BE(0x01000000,66))])assert.equal(photoAuxiliaryRange(bad,bad.length),null,'Unsupported counts, offsets, sizes, primary offsets and non-JPEG entries stay unresolved');
for(const end of [Buffer.from([255]),Buffer.from([255,0])])assert.equal(inspectPhotoWithAuxiliary(linked,linked.length,'image/jpeg',gainMap,end).hdrDetails,undefined,'A missing gain-map EOI cannot verify its JPEG storage structure');
assert.equal(inspectPhotoWithAuxiliary(linked,linked.length,'image/jpeg',gainMap.subarray(0,20),gainMap.subarray(-2)).hdrDetails,undefined,'A truncated auxiliary header cannot verify a gain-map image');
assert.equal(inspect(inject(plain,segment(0xe1,Buffer.from('http://ns.adobe.com/xmp/extension/\0unparsed')))).hdr,'unknown');
const padded=inject(plain,...Array.from({length:5},()=>segment(0xe0,Buffer.alloc(60000))));
assert.equal(inspect(padded).metadataComplete,false);assert.equal(inspect(padded).hdr,'unknown');assert.equal(inspect(padded).width,null);
assert.equal(inspect(Buffer.concat([padded,adobeDetails])).hdrDetails,undefined,'HDR records beyond 256 KiB are not scanned');
for(let length=0;length<isoBody().length;length++)assert.doesNotThrow(()=>inspect(inject(plain,isoPacket(isoBody().subarray(0,length)))),'Every ISO truncation remains bounded');
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
const draft=await store.createDraft(category),draftPath=await add(draft),largePath=await add(draft,Buffer.concat([srgb,Buffer.alloc(700000)])),hdrPath=await add(draft,inject(srgb,adobeDetails)),linkedPath=await add(draft,linked);
const imported=manifest.entries.find(entry=>entry.contentType==='image/jpeg');let importedReads=0,importedPayload=null,importedRangeFault=false;
const worker=createNativePublicWorker(async request=>{const url=new URL(request.url);if(url.pathname!==imported.publicPath)return new Response('Not found',{status:404});importedReads++;const [,start,last]=request.headers.get('range').match(/^bytes=(\d+)-(\d+)$/),offset=Number(start),length=Number(last)-offset+1,body=importedPayload?importedPayload.subarray(offset,offset+length):Buffer.alloc(length);if(!importedPayload)srgb.copy(body);return new Response(body,{status:206,headers:{'content-type':imported.contentType,'content-length':String(length),'content-range':`bytes ${offset}-${offset+length-1}/${imported.size+(importedRangeFault&&offset>0?1:0)}`}})});
const get=(path,headers={},method='GET')=>worker(new Request('https://dwnc.me/api/photo-info?path='+encodeURIComponent(path),{method,headers}),env,{});
let response=await get(publicPath);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).info.colorSpace,'sRGB');
const beforeDenied=reads.length;
for(const path of [unused,draftPath,'https://external.example'+publicPath,publicPath.slice(1),'/media/native/no.jpg',publicPath+'%25'])assert.equal((await get(path)).status,404,path);
assert.equal(reads.length,beforeDenied,'Unauthorized requests do not read a file prefix');
assert.equal((await get(publicPath,{},'POST')).status,405);
assert.equal((await get('https://dwnc.me'+publicPath+'?version=2')).status,200);
assert.equal((await serveAdminPhotoInfo(publicPath,draft.id,env,store,async()=>new Response())).status,404,'A post-scoped admin request cannot inspect another post file');
response=await serveAdminPhotoInfo(largePath,draft.id,env,store,async()=>new Response());assert.equal(response.status,200);assert.equal((await response.json()).info.bytes,assets.get(largePath.slice(1)).bytes.length);assert.deepEqual(reads.at(-1).range,{offset:0,length:PHOTO_METADATA_PREFIX_BYTES});
response=await serveAdminPhotoInfo(hdrPath,draft.id,env,store,async()=>new Response());assert.equal(response.status,200);assert.deepEqual((await response.json()).info.hdrDetails,inspect(assets.get(hdrPath.slice(1)).bytes).hdrDetails,'The same bounded API read forwards optional recorded HDR details');
const beforeLinked=reads.length;
response=await serveAdminPhotoInfo(linkedPath,draft.id,env,store,async()=>new Response());assert.equal(response.status,200);assert.deepEqual((await response.json()).info,linkedInfo);
assert.deepEqual(reads.slice(beforeLinked).map(read=>read.range),[{offset:0,length:PHOTO_METADATA_PREFIX_BYTES},{offset:linkedRange.offset-2,length:gainMap.length+2}],'Only the authorized primary prefix and one MPF-linked auxiliary are read');
const largeGainMap=Buffer.concat([gainMap.subarray(0,-2),Buffer.alloc(300000),gainMap.subarray(-2)]),largeLinked=linkedJpeg(largeGainMap,300000),largeLinkedPath=await add(draft,largeLinked),largeLinkedRange=photoAuxiliaryRange(largeLinked,largeLinked.length),beforeLargeLinked=reads.length;
response=await serveAdminPhotoInfo(largeLinkedPath,draft.id,env,store,async()=>new Response());assert.equal(response.status,200);assert.deepEqual((await response.json()).info.hdrDetails.gainMapImage,{format:'JPEG',width:32,height:24,channels:1});
assert.deepEqual(reads.slice(beforeLargeLinked).map(read=>read.range),[{offset:0,length:PHOTO_METADATA_PREFIX_BYTES},{offset:largeLinkedRange.offset-2,length:PHOTO_METADATA_PREFIX_BYTES+2},{offset:largeLinked.length-2,length:2}],'A large gain map adds only its two exact end bytes after the bounded auxiliary prefix');
assert.ok(reads.slice(beforeLargeLinked).reduce((sum,read)=>sum+read.range.length,0)<=2*PHOTO_METADATA_PREFIX_BYTES+4,'A complete metadata request never buffers the full photo or full large gain map');
const originalBucketGet=bucket.get;
for(const failure of ['checksum','short','throw','primary-eoi']){
  bucket.get=async(key,options)=>{const object=await originalBucketGet(key,options);if(options?.range.offset===0)return object;if(failure==='throw')throw Error('synthetic auxiliary failure');if(failure==='checksum')object.customMetadata.sha256='0'.repeat(64);if(failure==='short')object.body=new Response(gainMap.subarray(0,2)).body;if(failure==='primary-eoi'){const data=Buffer.from(linked.subarray(options.range.offset,options.range.offset+options.range.length));data[0]=0;object.body=new Response(data).body}return object};
  response=await serveAdminPhotoInfo(linkedPath,draft.id,env,store,async()=>new Response());assert.equal(response.status,200);const info=(await response.json()).info;assert.equal(info.colorSpace,'sRGB');assert.equal(info.hdrDetails?.gainMapImage,undefined,'Auxiliary failures retain primary metadata without claiming a linked gain map');
}
bucket.get=originalBucketGet;
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
importedPayload=linkedJpeg(gainMap,imported.size-srgb.length-90-gainMap.length);
assert.equal(importedPayload.length,imported.size);
response=await get(imported.publicPath);assert.equal(response.status,200);assert.deepEqual((await response.json()).info.hdrDetails.gainMapImage,{format:'JPEG',width:32,height:24,channels:1},'Imported immutable media uses the same linked auxiliary inspection');
importedRangeFault=true;
response=await get(imported.publicPath);assert.equal(response.status,200);assert.equal((await response.json()).info.hdrDetails?.gainMapImage,undefined,'An incorrect auxiliary content-range retains only primary metadata');
// Access and same-origin checks still wrap the read-only admin POST route.
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'metadata-fixture',alg:'RS256',use:'sig'};
Object.assign(env,{ACCESS_TEAM_DOMAIN:'https://metadata-fixture.cloudflareaccess.com',ACCESS_AUD:'synthetic-metadata-audience',ACCESS_ALLOWED_EMAIL:'owner@example.test'});
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),header=encode({alg:'RS256',kid:jwk.kid}),payload=encode({iss:env.ACCESS_TEAM_DOMAIN,aud:env.ACCESS_AUD,sub:'fixture',email:env.ACCESS_ALLOWED_EMAIL,exp:Math.floor(Date.now()/1000)+3600}),token=header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
clearAccessKeyCacheForTests();await verifyAccessIdentity(new Request('https://admin.dwnc.me',{headers:{'cf-access-jwt-assertion':token}}),env,{fetcher:async()=>Response.json({keys:[jwk]})});
const adminRequest=(authenticated=true,origin='https://admin.dwnc.me')=>admin.fetch(new Request('https://admin.dwnc.me/api/posts/'+draft.id+'/media-info',{method:'POST',headers:{...(authenticated?{'cf-access-jwt-assertion':token}:{}),origin,'content-type':'application/json'},body:JSON.stringify({path:largePath})}),env,{});
assert.equal((await adminRequest(false)).status,401);assert.equal((await adminRequest(true,'https://external.example')).status,403);
const revisions=database.sqlite.prepare('SELECT id,revision FROM native_posts ORDER BY id').all();assert.equal((await adminRequest()).status,200);assert.deepEqual(database.sqlite.prepare('SELECT id,revision FROM native_posts ORDER BY id').all(),revisions,'Photo information POST never edits content');
assert.ok(reads.every(read=>Number.isSafeInteger(read.range.offset)&&read.range.offset>=0&&read.range.length<=PHOTO_METADATA_PREFIX_BYTES+2),'Every information range is bounded to a prefix plus two end-marker bytes');
database.sqlite.close();
console.log(JSON.stringify({suite:'photo-media-info',status:'PASS',behavior:'actual ICC/EXIF sRGB/P3 and orientation, recorded Adobe/Apple/ISO HDR details without defaults, MPF-linked auxiliary JPEG header/end structure, conflicting/invalid/truncated metadata, bounded primary/auxiliary ranges and failure fallback, published/private/scheduled/protected/admin ownership and same-origin checks'}));
