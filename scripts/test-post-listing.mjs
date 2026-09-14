import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { renderRecentJournal, renderArchiveRow } from '../src/lib/post-listing.ts';
import { createNativePublicWorker } from '../src/lib/native-public-worker.ts';
import { NativePostStore } from '../src/lib/native-post-store.ts';
import { createEditorDatabase, seedLegacy } from './fixtures/editor-database.mjs';

const posts = Array.from({ length: 10 }, (_, i) => ({
  title: `합성 제목 ${i} <&>`, path: `/posts/${10-i}`, date: '2026.09.15', publishedAt: '2026-09-15T00:00:00Z',
  cover: i % 2 ? null : `/media/selected-${i}.png`, coverAlt: '대표사진 "설명"', leafCategory: { label: '일상' }, featured: i === 9,
}));
const before = structuredClone(posts);
const recent = load(renderRecentJournal(posts, 2015, 2026));
assert.equal(recent('.recent-card').length, 8);
assert.deepEqual(recent('.recent-card h2 a').toArray().map(el => recent(el).attr('href')), posts.slice(0, 8).map(p=>p.path));
assert.equal(recent('.recent-card__image').length, 4);
assert.equal(recent('.recent-card--text img').length, 0);
assert.equal(recent('.recent-card h2').first().text(), posts[0].title);
assert.equal(recent('.recent-journal__all').attr('href'), '/archive');
for (const post of posts) {
  const row = load(renderArchiveRow(post));
  assert.equal(row('img').length, post.cover ? 1 : 0);
  assert.equal(row('.archive-entry__title').text(), post.title);
  assert.equal(row('a').attr('href'), post.path);
  assert.equal(row('small').text(), '일상');
  if (post.cover) assert.equal(row('img').attr('loading'), 'lazy');
}
assert.deepEqual(posts, before);

const db = await createEditorDatabase(); seedLegacy(db); const store = new NativePostStore(db);
const category = { id: 'daily-stories', slug: '일상-이야기', label: '일상 이야기' };
let selectedPost, selectedCover;
for (let i=0;i<10;i++) {
  let post = await store.createDraft(category);
  let coverPath = null;
  if (i===9) {
    const id='123e4567-e89b-42d3-a456-426614174020'; coverPath=`/media/native/${id}.png`;
    await store.addMedia({id,postId:post.id,publicPath:coverPath,objectKey:coverPath.slice(1),sha256:'a'.repeat(64),bytes:1,mime:'image/png',alt:'선택한 대표사진',createdAt:'2026-09-15T00:00:00Z'});
  }
  post=await store.update(post.id,post.revision,{...post,title:`공개 합성 ${i}`,bodyFormat:'html',bodyMarkdown:coverPath?`<p>합성</p><img src="${coverPath}">`:'<p>합성</p>',coverPath,coverAlt:coverPath?'선택한 대표사진':''});
  post=await store.publish(post.id,post.revision);
  if(coverPath){selectedPost=post;selectedCover=coverPath;}
}
await store.update(selectedPost.id, selectedPost.revision, {...selectedPost,title:'UNRELEASED_TITLE',coverPath:null,coverAlt:''});
for(const visibility of ['draft','private','protected','scheduled']) {
  let post=await store.createDraft(category);
  post=await store.update(post.id,post.revision,{...post,title:`HIDDEN_${visibility}`,bodyFormat:'html',bodyMarkdown:'<p>비공개 합성</p>'});
  if(visibility!=='draft')await store.publish(post.id,post.revision,{visibility,password:'synthetic password',scheduledAt:new Date(Date.now()+3600000).toISOString()});
}
const tables=['native_posts','legacy_posts','editor_working_copies','content_operations'];
const records=Object.fromEntries(tables.map(table=>[table,db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
class Rewriter {handlers=[];on(selector,handler){this.handlers.push([selector,handler]);return this;}async transform(response){const doc=load(await response.text());for(const[selector,handler]of this.handlers)doc(selector).each((_,node)=>handler.element({setInnerContent:(value,options={})=>options.html?doc(node).html(value):doc(node).text(value),setAttribute:(key,value)=>doc(node).attr(key,value),remove:()=>doc(node).remove(),append:value=>doc(node).append(value)}));return new Response(doc.html(),{status:response.status,headers:response.headers});}}
globalThis.HTMLRewriter=Rewriter;
const worker=createNativePublicWorker(async request=>new URL(request.url).pathname==='/search-index.json'?Response.json([]):new Response('<html><head><title></title></head><body><main id="main"></main></body></html>',{headers:{'content-type':'text/html'}}));
for(const path of ['/','/archive']) {
  const response=await worker(new Request(`https://dwnc.me${path}`),{NATIVE_DB:db},{});
  assert.equal(response.status,200);const html=await response.text(),page=load(html);
  assert(!html.includes('HIDDEN_'));assert(!html.includes('UNRELEASED_TITLE'));
  if(path==='/'){
    assert.equal(page('.recent-card').length,8);
    assert.equal(page('.recent-card h2 a').first().attr('href'),selectedPost.publicPath);
    assert.equal(page('.recent-card img').first().attr('src'),selectedCover);
    assert(page('.home-category-list a').length>0);
  }else{
    assert.equal(page('.archive-entry').length,11);
    assert.equal(page('.archive-entry img').length,1);
    assert.equal(page('.archive-entry img').attr('src'),selectedCover);
    assert.equal(page('.archive-entry__meta small').first().text(),'일상');
  }
}
for(const[table,rows]of Object.entries(records))assert.deepEqual(db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),rows);
assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM post_view_daily').get().count,0);
db.sqlite.close();
console.log('PASS post listing: latest eight, selected covers only, empty-image omission, titles/URLs, public snapshots, category display, drafts/content/view statistics unchanged');
