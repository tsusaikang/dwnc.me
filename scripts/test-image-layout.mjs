import assert from 'node:assert/strict';
import vm from 'node:vm';
import { imageLayoutScript } from '../src/lib/admin-image-layout.ts';
import { load } from 'cheerio';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { sanitizeNativeHtml, sanitizeLegacyHtml } from '../src/lib/native-content.ts';
import { IMAGE_LAYOUT_CSS } from '../src/lib/image-layout.ts';
import { adminHtml } from '../src/lib/admin-ui.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';
const media = '/media/native/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
const item = '<div class="dwnc-image-item"><figure class="imageblock"><a href="https://example.test/photo"><img src="'+media+'" width="120" height="80" alt="합성 사진"></a><figcaption>유지할 설명</figcaption></figure></div>';
const database = await createEditorDatabase();
seedLegacy(database);
const store = new NativePostStore(database);
const post = await store.createDraft({ id: 'daily', slug: '일상', label: '일상' });
for (const align of ['left','center','right']) for (const size of ['original','paragraph','full']) for (const columns of [1,2,3]) {
  const html = '<p>앞 문단</p><div class="dwnc-image-layout dwnc-image-'+align+' dwnc-image-'+size+(columns>1?' dwnc-image-cols-'+columns:'')+'">'+item.repeat(columns)+'</div><p>뒤 문단</p>';
  for (const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]) {
    const clean = sanitize(html), $ = load(clean);
    assert.equal($('.dwnc-image-item').length,columns);
    assert.equal($('.dwnc-image-'+align).length,1);
    assert.equal($('.dwnc-image-'+size).length,1);
    assert.equal($('img').first().attr('width'),'120');
    assert.equal($('figcaption').first().text(),'유지할 설명');
    assert.equal($('a').first().attr('href'),'https://example.test/photo');
    assert.equal(sanitize(clean),clean);
  }
}
const html='<div class="dwnc-image-layout dwnc-image-right dwnc-image-full dwnc-image-cols-2">'+item.repeat(2)+'</div>';
await store.addMedia({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',postId:post.id,publicPath:media,objectKey:media.slice(1),sha256:'a'.repeat(64),bytes:1,mime:'image/png',alt:'합성',createdAt:new Date().toISOString()});
const updated=await store.update(post.id,post.revision,{title:'합성 사진 배치',description:'',categoryId:'daily',tags:[],bodyFormat:'html',bodyMarkdown:html,coverMediaId:null});
assert.equal(load((await store.getForAdmin(post.id)).bodyHtml)('.dwnc-image-cols-2').length,1);
assert.equal(await store.getPublicMedia(media),null);
const published=await store.publish(post.id,updated.revision);
assert.equal(load((await store.getPublishedBySequence(published.globalSequence)).bodyHtml)('.dwnc-image-cols-2').length,1);
assert.equal((await store.getPublicMedia(media)).postId,post.id);
const legacy=await store.getForAdmin('legacy-1');
const legacySaved=await store.update(legacy.id,legacy.revision,{title:'이전 글 합성 사진 배치',description:'',categoryId:'daily',tags:[],bodyFormat:'html',bodyMarkdown:html.replaceAll(media,'https://example.test/synthetic.png'),coverMediaId:null});
assert.equal(load((await store.getForAdmin(legacy.id)).bodyHtml)('.dwnc-image-cols-2 figcaption').length,2);
await store.publish(legacy.id,legacySaved.revision);
assert.equal(load((await store.getPublishedBySequence(1)).bodyHtml)('.dwnc-image-cols-2 figcaption').length,2);
assert.ok(!sanitizeNativeHtml('<div class="arbitrary dwnc-image-layout" onclick="alert(1)">safe</div>').includes('arbitrary'));
assert.ok(!sanitizeNativeHtml('<div onclick="alert(1)">safe</div>').includes('onclick'));
assert.ok(IMAGE_LAYOUT_CSS.includes('repeat(3,minmax(0,1fr))'));
assert.ok(adminHtml('fixture@example.test').includes('id="openImageLayout"'));
const availabilitySource=imageLayoutScript.slice(imageLayoutScript.indexOf('function layoutSizeAvailability'),imageLayoutScript.indexOf('function updateLayoutSizes'));
const context=vm.createContext({window:{innerWidth:1400},getComputedStyle:()=>({getPropertyValue:()=>''}),$:()=>({getBoundingClientRect:()=>({width:860})})});
vm.runInContext(availabilitySource,context);
const image=(width,complete=true)=>({naturalWidth:width,complete});
for(const [width,columns,paragraph,full] of [[160,1,false,false],[720,1,true,false],[1800,1,true,true],[160,2,false,false],[400,2,true,false],[600,2,true,true],[250,3,true,false]]) {
 const result=context.layoutSizeAvailability(Array(columns).fill(image(width)),columns);
 assert.equal(result.paragraph,paragraph);assert.equal(result.full,full);
}
assert.equal(context.layoutSizeAvailability([image(1800,false)],1).paragraph,false);
assert.equal(context.layoutSizeAvailability([image(0)],1).full,false);
const capped=sanitizeNativeHtml('<div class="dwnc-image-item"><img src="'+media+'" style="width:1800px!important" data-dwnc-original-width="none"></div>');
assert.ok(capped.includes('1800px !important'));assert.ok(capped.includes('data-dwnc-original-width="none"'));
context.window.innerWidth=390;
assert.equal(context.layoutSizeAvailability([image(400)],1).paragraph,false,'Mobile selection must still fill the desktop paragraph');
assert.ok(IMAGE_LAYOUT_CSS.includes('--dwnc-current-layout-width'));
assert.ok(sanitizeNativeHtml('<div class="dwnc-image-layout dwnc-image-original" style="--dwnc-original-layout-width:1000px">photo</div>').includes('--dwnc-original-layout-width:1000px'));
console.log(JSON.stringify({suite:'image-layout',status:'PASS',behavior:'27 layout combinations, native/legacy sanitizer round trips, captions and links preserved, bounded classes, original-width caps, no-upscale size availability'}));
