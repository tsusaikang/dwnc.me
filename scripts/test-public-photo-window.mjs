import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { photoWindowSource, PUBLIC_PHOTO_WINDOW_BOOTSTRAP, PHOTO_VIEWER_BOOTSTRAP } from '../src/lib/public-photo-window.ts';

const base='https://dwnc.me/posts/606';
assert.equal(photoWindowSource('/media/native/photo.jpg?access=abc%2Bdef&v=7',base),'/media/native/photo.jpg?access=abc%2Bdef&v=7');
assert.equal(photoWindowSource('http://127.0.0.1:4322/media/native/photo.jpg?v=1','http://127.0.0.1:4322/posts/606'),'/media/native/photo.jpg?v=1');
assert.equal(photoWindowSource('/media/tistory/12/한글.jpg',base),'/media/tistory/12/%ED%95%9C%EA%B8%80.jpg');
assert.equal(photoWindowSource('/media/tistory/12/space%20name.jpg',base),'/media/tistory/12/space%20name.jpg');
assert.equal(photoWindowSource('/media/tistory/12/photo%3F%23.jpg',base),'/media/tistory/12/photo%3F%23.jpg');
for(const source of ['https://external.example/media/native/photo.jpg','//external.example/media/native/photo.jpg','https://user:password@dwnc.me/media/native/photo.jpg','javascript:alert(1)','data:image/png;base64,abc','/api/private','/media/%252e/photo.jpg','/media/%5cphoto.jpg','/media//photo.jpg','/media/tistory/12/photo.jpg?token=1'])assert.equal(photoWindowSource(source,base),null,source);

function environment(html,url=base){
  const $=load(html),wrappers=new WeakMap(),mutations=[];
  class Element {
    constructor(node){this.node=node;this.listeners=new Map();this.style={};this.hidden=false;this.naturalWidth=2560;this.naturalHeight=1928;}
    get tagName(){return this.node.name.toUpperCase()}
    get textContent(){return $(this.node).text()}set textContent(value){$(this.node).text(value)}
    get innerHTML(){return $(this.node).html()}
    get className(){return this.getAttribute('class')}set className(value){this.setAttribute('class',value)}
    get src(){return this.getAttribute('src')}set src(value){this.setAttribute('src',value)}
    get href(){return this.getAttribute('href')}set href(value){this.setAttribute('href',value)}
    get target(){return this.getAttribute('target')}set target(value){this.setAttribute('target',value)}
    get rel(){return this.getAttribute('rel')}set rel(value){this.setAttribute('rel',value)}
    getAttribute(name){return this.node.attribs[name]??null}
    setAttribute(name,value){this.node.attribs[name]=String(value)}
    removeAttribute(name){delete this.node.attribs[name]}
    hasAttribute(name){return Object.hasOwn(this.node.attribs,name)}
    closest(selector){return wrap($(this.node).closest(selector)[0])}
    contains(target){return target===this||$(target?.node).parents().toArray().includes(this.node)}
    querySelectorAll(selector){return $(this.node).find(selector).toArray().map(wrap)}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null}
    append(...nodes){for(const node of nodes)$(this.node).append(node.node)}
    remove(){$(this.node).remove()}
    addEventListener(name,handler){this.listeners.set(name,handler)}
    focus(options){document.activeElement=this;this.focusOptions=options}
    event(name,extra={}){const event={target:this,button:0,preventDefault(){this.defaultPrevented=true},...extra};this.listeners.get(name)?.(event);return event}
  }
  function wrap(node){if(!node)return null;if(!wrappers.has(node))wrappers.set(node,new Element(node));return wrappers.get(node)}
  const document={body:wrap($('body')[0]),title:'',activeElement:null,querySelector:selector=>wrap($(selector)[0]),getElementById:id=>wrap($('#'+id)[0]),createElement:tag=>wrap($('<'+tag+'>')[0])};
  const calls=[],navigations=[];let blocked=false,selection=false;
  const window={screen:{availWidth:1440,availHeight:900},getSelection:()=>({isCollapsed:!selection}),open(...args){calls.push(args);if(blocked)return null;const popup={opener:window,location:{replace(url){assert.equal(popup.opener,null,'Opener is detached before navigation');navigations.push(url)}}};return popup}};
  const context=vm.createContext({document,window,location:new URL(url),URL,MutationObserver:class{constructor(callback){mutations.push(callback)}observe(){}},console});
  return{document,window,context,calls,navigations,refresh:()=>mutations.forEach(callback=>callback()),block:value=>blocked=value,selection:value=>selection=value};
}
const env=environment('<body><article class="article-page"><img class="post-cover" src="/media/cover.jpg"><div class="prose"><p>앞 문단</p><figure><img src="/media/native/photo.jpg?access=abc%2Bdef" alt="여행 사진"><figcaption>그대로인 설명</figcaption></figure><a href="https://example.test"><img src="/media/linked.jpg"></a><figure data-ke-type="opengraph"><img src="/media/card.jpg"></figure><img src="https://external.example/photo.jpg"><img src="/media/custom.jpg" role="img" tabindex="-1"><p>뒤 문단</p></div></article></body>');
const body=env.document.querySelector('.prose'),before=body.innerHTML;
vm.runInContext(PUBLIC_PHOTO_WINDOW_BOOTSTRAP,env.context);
const photos=body.querySelectorAll('img'),photo=photos[0];
assert.equal(photo.getAttribute('role'),'button');assert.equal(photo.getAttribute('tabindex'),'0');assert.equal(photo.getAttribute('aria-label'),'여행 사진 · 원본 크기로 새 창에서 보기');
assert.equal(body.querySelectorAll('[data-public-photo-window]').length,1);
for(const image of photos.slice(1))assert.equal(image.hasAttribute('data-public-photo-window'),false);
assert.equal(env.document.querySelector('.post-cover').hasAttribute('data-public-photo-window'),false);
const click=extra=>body.event('click',{target:photo,...extra});
assert.equal(click().defaultPrevented,true);assert.equal(env.calls.length,1);assert.equal(env.calls[0][0],'about:blank');assert.equal(env.calls[0][1],'_blank');assert.match(env.calls[0][2],/popup=yes,width=1360,height=800.*resizable=yes,scrollbars=yes/);assert.match(env.calls[0][2],/toolbar=no,menubar=no,location=no,status=no/);
assert.equal(env.navigations[0],'/photo-viewer?src=%2Fmedia%2Fnative%2Fphoto.jpg%3Faccess%3Dabc%252Bdef');
for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}])click(extra);
env.selection(true);click();env.selection(false);assert.equal(env.calls.length,1,'Selection and modifier/middle clicks do not open a popup');
for(const image of photos.slice(1))body.event('click',{target:image});assert.equal(env.calls.length,1,'Links, cards, external images, and authored controls keep their behavior');
for(const key of ['Enter',' '])assert.equal(body.event('keydown',{target:photo,key}).defaultPrevented,true);
assert.equal(env.calls.length,3);
for(const extra of [{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true}])body.event('keydown',{target:photo,key:'Enter',...extra});
assert.equal(env.calls.length,3);
vm.runInContext(PUBLIC_PHOTO_WINDOW_BOOTSTRAP,env.context);click();assert.equal(env.calls.length,4,'Bootstrap is idempotent');
env.block(true);click();const fallback=env.document.querySelector('.public-photo-window-fallback'),link=fallback.querySelector('a');assert.match(fallback.textContent,/차단/);assert.equal(link.href,env.navigations[0]);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener');assert.equal(env.document.activeElement,link,'A blocked window exposes an actionable keyboard fallback');
click();assert.equal(env.document.body.querySelectorAll('.public-photo-window-fallback').length,1,'Repeated blocks do not stack notices');
env.block(false);click();assert.equal(env.document.querySelector('.public-photo-window-fallback'),null);
photo.setAttribute('src','https://external.example/photo.jpg');env.refresh();assert.equal(photo.hasAttribute('role'),false);assert.equal(photo.hasAttribute('tabindex'),false);click();assert.equal(env.calls.length,7,'Changed sources are checked when clicked');
photo.setAttribute('src','/media/native/photo.jpg?access=abc%2Bdef');env.refresh();photo.setAttribute('alt','수정된 설명');env.refresh();assert.equal(photo.getAttribute('aria-label'),'수정된 설명 · 원본 크기로 새 창에서 보기');
const added=env.document.createElement('img');added.src='/media/native/new.jpg';body.append(added);env.refresh();assert.equal(added.getAttribute('role'),'button');
added.remove();
for(const image of body.querySelectorAll('[data-public-photo-window]'))for(const name of ['role','tabindex','aria-label','data-public-photo-window'])image.removeAttribute(name);
photo.setAttribute('alt','여행 사진');assert.equal(body.innerHTML,before,'Only transient accessibility attributes change; source links, paragraphs, groups and captions remain intact');
env.refresh();let closedFailedWindow=false;env.window.open=()=>({opener:env.window,location:{replace(){throw new Error('navigation failed')}},close(){closedFailedWindow=true}});assert.doesNotThrow(()=>click());assert.equal(closedFailedWindow,true);assert.ok(env.document.querySelector('.public-photo-window-fallback a'),'A failed WindowProxy navigation still provides the usable fallback');

const viewer=environment('<body><p id="status"></p><img id="photo"></body>','https://dwnc.me/photo-viewer?src='+encodeURIComponent('/media/native/photo.jpg?access=abc%2Bdef'));
vm.runInContext(PHOTO_VIEWER_BOOTSTRAP,viewer.context);const image=viewer.document.getElementById('photo'),status=viewer.document.getElementById('status');assert.equal(image.src,'/media/native/photo.jpg?access=abc%2Bdef');image.event('load');assert.equal(image.style.width,'2560px');assert.equal(image.style.height,'1928px');assert.equal(image.hidden,false);assert.equal(status.hidden,true);assert.equal(viewer.document.title,'사진 · 2560 × 1928');image.event('error');assert.equal(image.hidden,true);assert.match(status.textContent,/불러오지 못/);
const invalid=environment('<body><p id="status"></p><img id="photo"></body>','https://dwnc.me/photo-viewer?src='+encodeURIComponent('https://external.example/media/photo.jpg'));vm.runInContext(PHOTO_VIEWER_BOOTSTRAP,invalid.context);assert.equal(invalid.document.getElementById('photo').src,null);assert.match(invalid.document.getElementById('status').textContent,/주소/);
const layout=await readFile(new URL('../src/layouts/PostLayout.astro',import.meta.url),'utf8'),worker=await readFile(new URL('../src/lib/native-public-worker.ts',import.meta.url),'utf8'),page=await readFile(new URL('../src/pages/photo-viewer.astro',import.meta.url),'utf8'),config=await readFile(new URL('../astro.config.mjs',import.meta.url),'utf8');
assert.match(layout,/set:html=\{PUBLIC_PHOTO_WINDOW_BOOTSTRAP\}/);assert.match(worker,/<script>\$\{PUBLIC_PHOTO_WINDOW_BOOTSTRAP\}<\/script>/);assert.match(page,/max-width: none; max-height: none/);assert.match(page,/overflow: auto/);assert.match(page,/noindex, nofollow/);assert.match(config,/pathname !== '\/photo-viewer'/);
console.log(JSON.stringify({suite:'public-photo-window',status:'PASS',behavior:'natural-size original in requested browser popup, faithful native query, detached opener, actionable blocked fallback, keyboard access, preserved links/cards/gestures/body content and admin scope'}));
