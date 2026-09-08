import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { editablePublicPath, mountPublicAdminLinks } from '../src/lib/public-admin-links.ts';

for (const path of ['/posts/1','/pages/123e4567-e89b-42d3-a456-426614174000']) assert.equal(editablePublicPath(path,'https://dwnc.me'),path);
for (const path of ['/about','/posts/0','/posts/1?preview=1','/posts/1#part','/posts/%31','/pages/not-a-page','https://other.test/posts/1']) assert.equal(editablePublicPath(path,'https://dwnc.me'),null);
const $=load('<body><nav data-public-admin-tools hidden></nav><main><article class="article-page"><header class="post-header__inner"><h1>본문</h1></header></article><article class="post-card"><div class="post-card__body"><h2><a href="/posts/2">카드</a></h2><a href="/posts/2">읽기</a></div></article><section class="archive-year"><li><a href="/posts/3">행</a></li></section></main><div class="search-results"></div></body>');
const wrappers=new WeakMap(), events={}, calls=[];let observer,authenticated=false,failure=false;
const nodeFor=node=>{
 if(!node)return null;if(wrappers.has(node))return wrappers.get(node);
 const value={
  get hidden(){return $(node).attr('hidden')!==undefined},set hidden(value){value?$(node).attr('hidden',''):$(node).removeAttr('hidden')},
  get isConnected(){return $(node).parents().length>0},get textContent(){return $(node).text()},set textContent(value){$(node).text(value)},
  get className(){return $(node).attr('class')??''},set className(value){$(node).attr('class',value)},
  get href(){return new URL($(node).attr('href')??'',location.origin).href},set href(value){$(node).attr('href',value)},
  get target(){return $(node).attr('target')},set target(value){$(node).attr('target',value)},set rel(value){$(node).attr('rel',value)},
  setAttribute:(key,value)=>$(node).attr(key,value),getAttribute:key=>$(node).attr(key)??null,
  classList:{contains:name=>$(node).hasClass(name)},closest:selector=>nodeFor($(node).closest(selector)[0]),
  querySelector:selector=>nodeFor($(node).find(selector)[0]),appendChild:child=>$(node).append(child.node),
  get nextSibling(){return nodeFor(node.next)},get parentNode(){const parent=node.parent;return parent?{insertBefore:(child,next)=>next?$(next.node).before(child.node):$(parent).append(child.node)}:null},node,
 };wrappers.set(node,value);return value;
};
const saved=Object.fromEntries(['document','window','location','MutationObserver','requestAnimationFrame','fetch'].map(key=>[key,globalThis[key]]));
try{
 globalThis.location=new URL('https://dwnc.me/posts/1');
 globalThis.document={visibilityState:'visible',body:nodeFor($('body')[0]),querySelector:selector=>nodeFor($(selector)[0]),querySelectorAll:selector=>$(selector).toArray().map(nodeFor),createElement:tag=>nodeFor($(`<${tag}>`)[0]),addEventListener:(name,handler)=>events[name]=handler};
 globalThis.window={addEventListener:(name,handler)=>events[name]=handler};
 globalThis.MutationObserver=class{constructor(callback){observer=callback}observe(){}};
 globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(failure)throw Error('synthetic unavailable');return Response.json({authenticated})};
 const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
 mountPublicAdminLinks();await settle();assert.notEqual($('[data-public-admin-tools]').attr('hidden'),undefined);assert.equal($('.public-edit-link').length,0);
 authenticated=true;await events.focus();await settle();assert.equal($('[data-public-admin-tools]').attr('hidden'),undefined);assert.equal($('.public-edit-link').length,3);
 assert.equal($('a a').length,0);assert.equal($('.post-card .public-edit-link').attr('href'),'https://admin.dwnc.me/#edit=%2Fposts%2F2');
 assert.equal($('.public-edit-link').first().attr('target'),'_blank');assert.match($('.public-edit-link').first().attr('rel'),/noopener/);
 $('.search-results').html('<a href="/posts/4"><strong>검색 결과</strong></a>');observer();await settle();assert.equal($('.search-results .public-edit-link').length,1);assert.equal($('a a').length,0);
 $('.post-card h2 a').attr('href','/posts/5');observer();await settle();assert.equal($('.post-card .public-edit-link').attr('href'),'https://admin.dwnc.me/#edit=%2Fposts%2F5');
 failure=true;await events.pageshow();await settle();assert.equal($('.public-edit-link:not([hidden])').length,0);assert.notEqual($('[data-public-admin-tools]').attr('hidden'),undefined);
 failure=false;await events.focus();await settle();assert.equal($('.public-edit-link:not([hidden])').length,4);
 const fastFetch=globalThis.fetch;let resolveSlow;globalThis.fetch=()=>new Promise(resolve=>{resolveSlow=resolve});
 const pending=events.focus();events.pagehide();resolveSlow(Response.json({authenticated:true}));await pending;await settle();assert.equal($('.public-edit-link:not([hidden])').length,0);
 globalThis.fetch=fastFetch;await events.pageshow();await settle();assert.equal($('.public-edit-link:not([hidden])').length,4);
 document.visibilityState='hidden';await events.visibilitychange();assert.equal($('.public-edit-link:not([hidden])').length,0);
 assert(calls.every(call=>call.url==='https://admin.dwnc.me/api/session'&&call.options.credentials==='include'&&call.options.cache==='no-store'&&call.options.redirect==='error'&&!call.options.headers));
 const count=calls.length;location=new URL('http://127.0.0.1:4324/posts/1');mountPublicAdminLinks();await settle();assert.equal(calls.length,count);
 console.log(JSON.stringify({suite:'public-admin-links',status:'PASS',behavior:'hidden by default, exact bool session, refreshed auth/failure hiding, safe paths, no nested anchors, search/pagination updates, no real admin fetch from localhost'}));
}finally{for(const[key,value]of Object.entries(saved))value===undefined?delete globalThis[key]:globalThis[key]=value}
