import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { canonicalPhotoSource, formatPhotoBytes, publishedPhotoMetadata, renderPostPhotoSummary, summarizePostPhotos } from '../src/lib/photo-media-summary.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
import manifest from '../src/data/public-media-r2-v1.json' with {type:'json'};

const pathFor=index=>'/media/native/123e4567-e89b-42d3-a456-426614175'+String(index).padStart(3,'0')+'.png';
const image=path=>'<img src="'+path+'" alt="합성 사진">';
const file=(index,bytes)=>({path:pathFor(index),bytes,mime:'image/png'});
const known=[file(1,1500),file(2,2500)];
for(const [bytes,expected] of [[0,'0 B'],[999,'999 B'],[1000,'1 KB'],[1500,'1.5 KB'],[1234567,'1.23 MB'],[1000000,'1 MB']])assert.equal(formatPhotoBytes(bytes),expected);
assert.equal(formatPhotoBytes(Number.NaN),'확인 불가');
assert.equal(canonicalPhotoSource('https://dwnc.me'+pathFor(1)+'?v=2#part'),pathFor(1));
assert.equal(canonicalPhotoSource('https://admin.dwnc.me'+pathFor(1)),pathFor(1));
assert.equal(canonicalPhotoSource('https://external.example'+pathFor(1)),'https://external.example'+pathFor(1));
assert.equal(canonicalPhotoSource(pathFor(1).replace('123e','%31%32%33e')),pathFor(1));
assert.equal(canonicalPhotoSource(pathFor(1).slice(1)),pathFor(1).slice(1),'Page-relative paths cannot inherit root media metadata');
const duplicates=summarizePostPhotos(image(pathFor(1))+image('https://dwnc.me'+pathFor(1)+'?v=2')+image(pathFor(2)),known);
assert.deepEqual(duplicates,{count:3,uniqueCount:2,duplicateCount:1,unknownCount:0,totalBytes:4000});
assert.match(renderPostPhotoSummary(duplicates),/본문 사진 3장 · 총 4 KB/);assert.match(renderPostPhotoSummary(duplicates),/같은 파일은 용량에 한 번만 계산/);
const group='<div class="dwnc-image-layout dwnc-image-cols-3">'+[1,2,1].map(index=>'<div class="dwnc-image-item">'+image(pathFor(index))+'<figcaption>설명</figcaption></div>').join('')+'<div class="dwnc-image-caption">공통 설명</div></div>';
assert.deepEqual(summarizePostPhotos(group,known),duplicates);
const cards=['<figure data-ke-type="opengraph">','<div class="se_component se_oglink">','<div class="se-component se-oglink">'].map(open=>open+image(pathFor(1))+(open.startsWith('<figure')?'</figure>':'</div>')).join('');
assert.equal(summarizePostPhotos(cards,known).count,0);assert.equal(renderPostPhotoSummary(summarizePostPhotos('<p>사진 없음</p>')),'');
const unknown=summarizePostPhotos(image(pathFor(1))+image(pathFor(9))+image('https://external.example'+pathFor(1)),known);
assert.equal(unknown.count,3);assert.equal(unknown.totalBytes,null);assert.equal(unknown.unknownCount,2);assert.match(renderPostPhotoSummary(unknown),/총용량 확인 불가/);assert.ok(!renderPostPhotoSummary(unknown).includes('1.5 KB'));
for(const bytes of [0,-1,null,Number.NaN,Infinity])assert.equal(summarizePostPhotos(image(pathFor(1)),[file(1,bytes)]).totalBytes,null);
const imported=manifest.entries.find(item=>item.contentType.startsWith('image/'));
assert.equal(publishedPhotoMetadata(imported.publicPath).bytes,imported.size);assert.equal(summarizePostPhotos(image(imported.publicPath)).totalBytes,imported.size);
assert.equal(summarizePostPhotos(image(imported.publicPath+'?version=2')).totalBytes,null,'Immutable imported-media serving rejects queries');

// Published and working bodies deliberately diverge. Unreferenced uploads,
// cover-only media and a different post's private files never enter the sum.
const database=await createEditorDatabase();seedLegacy(database);const store=new NativePostStore(database),category={id:'daily',slug:'일상',label:'일상'};
const draft=await store.createDraft(category),foreign=await store.createDraft(category);
for(const [index,bytes,postId] of [[1,1500,draft.id],[2,2500,draft.id],[3,9000,draft.id],[4,8000,draft.id],[5,6000,foreign.id]])await store.addMedia({id:pathFor(index).split('/').at(-1).replace('.png',''),postId,publicPath:pathFor(index),objectKey:pathFor(index).slice(1),sha256:String(index).repeat(64),bytes,mime:'image/png',alt:'합성 파일',createdAt:'2026-10-05T00:00:00Z'});
const initial=await store.update(draft.id,draft.revision,{title:'공개 사진 요약 합성',description:'',bodyFormat:'html',bodyMarkdown:image(pathFor(1))+image(pathFor(1))+'<figure data-ke-type="opengraph">'+image(pathFor(1))+'</figure>',categoryId:'daily',tags:[],coverMediaId:null,coverPath:pathFor(4),coverAlt:'본문에 없는 대표사진'});
const published=await store.publish(draft.id,initial.revision);
await store.update(draft.id,published.revision,{...published,bodyMarkdown:image(pathFor(2)),coverPath:pathFor(4)});
const released=await store.getPublishedBySequence(published.globalSequence),working=await store.getForAdmin(draft.id);
assert.deepEqual(await store.photoSummaryForSnapshot(released),{count:2,uniqueCount:1,duplicateCount:1,unknownCount:0,totalBytes:1500});
assert.equal((await store.photoSummaryForSnapshot(working)).totalBytes,2500);
const metadata=await store.mediaForPost(draft.id);assert.equal(metadata.length,4);assert.equal(metadata.find(item=>item.path===pathFor(2)).bytes,2500);assert.equal(metadata.find(item=>item.path===pathFor(2)).mime,'image/png');
assert.equal((await store.photoSummaryForSnapshot({...released,bodyHtml:image(pathFor(5))})).totalBytes,null,'Another post media is not an owned byte source');
assert.equal((await store.photoSummaryForSnapshot({...released,bodyHtml:cards})).count,0);
const legacy=await store.getForAdmin('legacy-1');database.sqlite.prepare('UPDATE legacy_posts SET body_html=? WHERE id=?').run(image('https://dwnc.me'+imported.publicPath),'legacy-1');
assert.equal((await store.mediaForPost(legacy.id)).find(item=>item.path===imported.publicPath).bytes,imported.size);
assert.equal((await store.photoSummaryForSnapshot(await store.getPublishedBySequence(1))).totalBytes,imported.size);

class Rewriter {handlers=[];on(selector,handler){this.handlers.push([selector,handler]);return this}async transform(response){const doc=load(await response.text());for(const [selector,handler] of this.handlers)doc(selector).each((_,node)=>handler.element({setInnerContent:(value,options={})=>options.html?doc(node).html(value):doc(node).text(value),setAttribute:(key,value)=>doc(node).attr(key,value),remove:()=>doc(node).remove(),append:value=>doc(node).append(value)}));return new Response(doc.html(),{status:response.status,headers:response.headers})}}
globalThis.HTMLRewriter=Rewriter;
const worker=createNativePublicWorker(async request=>new URL(request.url).pathname==='/search-index.json'?Response.json([]):new Response('<html><head><title></title></head><body><main id="main"></main></body></html>',{headers:{'content-type':'text/html'}}));
const before=database.sqlite.prepare('SELECT id,revision,body_html FROM native_posts ORDER BY id').all();
const response=await worker(new Request('https://dwnc.me'+published.publicPath),{NATIVE_DB:database},{});assert.equal(response.status,200);const html=await response.text(),page=load(html);
assert.equal(page('.post-photo-summary').length,1);assert.match(page('.post-photo-summary').text(),/^본문 사진 2장 · 총 1.5 KB/);assert.equal(page('.post-photo-summary').closest('.prose').length,0);
assert.ok(!page('.post-photo-summary').text().includes('2500'));assert.equal(page('.prose img[src="'+pathFor(2)+'"]').length,0);assert.equal(page('.post-cover').length,1);assert.equal(page('.post-photo-summary img').length,0);
assert.deepEqual(database.sqlite.prepare('SELECT id,revision,body_html FROM native_posts ORDER BY id').all(),before);
const prepare=database.prepare.bind(database);
database.prepare=sql=>{if(sql.startsWith('SELECT public_path, bytes, mime FROM'))throw new Error('Synthetic metadata unavailable');return prepare(sql)};
const withoutMetadata=await worker(new Request('https://dwnc.me'+published.publicPath),{NATIVE_DB:database},{});assert.equal(withoutMetadata.status,200);const fallbackPage=load(await withoutMetadata.text());assert.match(fallbackPage('.post-photo-summary').text(),/본문 사진 2장 · 총용량 확인 불가/);assert.equal(fallbackPage('.prose img[src="'+pathFor(1)+'"]').length,3,'A summary metadata failure preserves the complete public body');
database.prepare=prepare;
const staticLayout=await readFile(new URL('../src/layouts/PostLayout.astro',import.meta.url),'utf8');assert.ok(staticLayout.includes('summarizePostPhotos(presentationHtml)'));assert.ok(staticLayout.includes('set:html={photoSummary}'));
database.sqlite.close();
console.log(JSON.stringify({suite:'photo-media-summary',status:'PASS',behavior:'published snapshot only, unique-file bytes, repeated-photo count, native/imported metadata, owned files, card/cover/unreferenced exclusion, unknown sizes, public render and static summary'}));
