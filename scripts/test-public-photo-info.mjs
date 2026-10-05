import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { PUBLIC_PHOTO_INFO_BOOTSTRAP } from '../src/lib/public-photo-info.ts';

const $=load('<body><article class="article-page"><img class="post-cover" src="/media/cover.jpg"><div class="prose"><p>앞 문단</p><div class="dwnc-image-layout"><figure><a href="https://example.test"><img src="/media/native/first.jpg"></a><figcaption>첫 설명</figcaption></figure><figure><img src="/media/native/second.jpg"><figcaption>둘째 설명</figcaption></figure></div><img src="https://external.example/media/native/first.jpg"><img src="/media/native/failure.jpg"><figure data-ke-type="opengraph"><img src="/media/card.jpg"></figure><p>뒤 문단</p></div></article><dialog id="otherDialog"></dialog></body>');
const wrappers=new WeakMap(),listeners=new Map(),requests=[],frames=[],timers=new Map(),mutationObservers=[];let timerId=0;
const setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId},clearTimeout=id=>timers.delete(id);
const advanceTimers=delay=>{for(const [id,timer] of [...timers])if(timer.delay<=delay){timers.delete(id);timer.callback()}};
class Element {
  constructor(node){this.node=node;this.listeners=new Map();this.style={setProperty(name,value){this[name]=value}};this.rect={left:30,right:430,top:200,bottom:500,width:400,height:300};this.hidden=false;}
  get id(){return this.getAttribute('id')}set id(value){this.setAttribute('id',value)}
  get className(){return this.getAttribute('class')}set className(value){this.setAttribute('class',value)}
  get innerHTML(){return $(this.node).html()}set innerHTML(value){$(this.node).html(value)}
  get textContent(){return $(this.node).text()}set textContent(value){$(this.node).text(value)}
  get isConnected(){return $(this.node).parents('body').length>0||this.node.name==='body'}
  get open(){return this.getAttribute('open')!==null}
  getAttribute(name){return this.node.attribs[name]??null}setAttribute(name,value){this.node.attribs[name]=String(value)}
  querySelectorAll(selector){return $(this.node).find(selector).toArray().map(wrap)}querySelector(selector){return this.querySelectorAll(selector)[0]??null}
  closest(selector){return wrap($(this.node).closest(selector)[0])}
  contains(node){return Boolean(node&&(node===this||$(node.node).parents().toArray().includes(this.node)))}
  append(...nodes){for(const node of nodes)$(this.node).append(node.node)}
  replaceChildren(...nodes){$(this.node).empty();this.append(...nodes)}
  addEventListener(name,handler){this.listeners.set(name,handler)}
  getBoundingClientRect(){return this.rect}
  focus(options){const previous=document.activeElement;document.activeElement=this;this.focusOptions=options;if(previous!==this){previous?.event('blur',{relatedTarget:this});this.event('focus')}}
  showModal(){this.setAttribute('open','')}
  close(){delete this.node.attribs.open;this.listeners.get('close')?.({target:this})}
  event(name,extra={}){const event={target:this,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true},...extra};this.listeners.get(name)?.(event);return event}
  click(){return this.event('click')}
}
function wrap(node){if(!node)return null;if(!wrappers.has(node))wrappers.set(node,new Element(node));return wrappers.get(node)}
const document={body:wrap($('body')[0]),getElementById:id=>wrap($('#'+id)[0]),querySelector:selector=>wrap($(selector)[0]),createElement:tag=>wrap($('<'+tag+'>')[0]),activeElement:null,addEventListener:(name,handler)=>listeners.set('document:'+name,handler)};
const window={innerWidth:1024,innerHeight:900,scrollX:0,scrollY:0,requestAnimationFrame:handler=>{frames.push(handler);return frames.length},addEventListener:(name,handler)=>listeners.set(name,handler)};
const paint=()=>{for(const callback of frames.splice(0))callback()};
const fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
class MutationObserver {
  constructor(callback){this.callback=callback;this.targets=[];mutationObservers.push(this)}
  observe(target,options){this.targets.push({target,options})}
}
const mutate=record=>{for(const observer of mutationObservers)if(observer.targets.some(({target,options})=>(target===record.target||options.subtree&&target.contains(record.target))&&(record.type!=='attributes'||options.attributes&&options.attributeFilter.includes(record.attributeName))))observer.callback([record])};
const context=vm.createContext({document,window,fetch,setTimeout,clearTimeout,location:new URL('http://127.0.0.1:4322/posts/1'),URL,ResizeObserver:class{observe(){}},MutationObserver,console});
const body=document.querySelector('.prose');
const group=body.querySelector('.dwnc-image-layout');group.rect={left:30,right:900,top:200,bottom:500,width:870,height:300};
body.querySelectorAll('img')[1].setAttribute('src','http://127.0.0.1:4322/media/native/second.jpg');
for(const image of body.querySelectorAll('img')){image.complete=true;image.naturalWidth=2560;image.naturalHeight=1928}
const seed=document.createElement('script');seed.id='publicPhotoMetadata';seed.setAttribute('type','application/json');seed.textContent=JSON.stringify([{path:'/media/native/first.jpg',bytes:1234567,mime:'image/jpeg'},{path:'/media/native/second.jpg',bytes:2000,mime:'image/jpeg'}]);document.body.append(seed);
const initialBody=body.innerHTML;
vm.runInContext(PUBLIC_PHOTO_INFO_BOOTSTRAP,context);
const basics=$('.public-photo-info-basic').toArray().map(wrap);
const cards=$('.public-photo-info-card').toArray().map(wrap);
const refresh=()=>{listeners.get('scroll')();paint()},resize=()=>{listeners.get('resize')();paint()};
const summaryOf=index=>basics[index].querySelector('.public-photo-info-summary');
const first=body.querySelectorAll('img')[0],second=body.querySelectorAll('img')[1],third=body.querySelectorAll('img')[2],last=body.querySelectorAll('img')[3];
const firstSummary=summaryOf(0);
assert.equal(basics.length,4,'Only body photos receive information, excluding cover and URL cards');
assert.equal(basics[0].textContent,'JPEG · 2560 × 1928 · 1.23 MB');assert.equal(basics[1].textContent,'JPEG · 2560 × 1928 · 2 KB');assert.match(basics[2].textContent,/형식 미확인.*용량 미확인/,'External paths do not inherit internal metadata or extension assumptions');
assert.equal(cards[0].style.left,'166px');assert.equal(cards[0].style.top,'204px');assert.equal(requests.length,0,'Basic labels do not fetch metadata or originals');assert.equal(body.innerHTML,initialBody);
assert.equal(document.getElementById('publicPhotoInfoPopover'),null);assert.equal(document.querySelector('.public-photo-info-panel'),null);assert.equal(document.querySelector('.public-photo-info-button'),null);
for(const basic of basics){
  assert.equal(basic.node.name,'div');assert.equal(basic.getAttribute('tabindex'),null);assert.equal(basic.getAttribute('aria-controls'),null);assert.equal(basic.getAttribute('aria-expanded'),null);assert.equal(basic.listeners.size,0);
  const press=basic.event('pointerdown',{pointerType:'touch'}),click=basic.click();basic.event('pointerenter',{pointerType:'mouse'});basic.focus();paint();
  assert.equal(press.defaultPrevented,undefined);assert.equal(press.stopped,undefined);assert.equal(click.defaultPrevented,undefined);assert.equal(click.stopped,undefined);
}
assert.equal(requests.length,0,'Hover, focus and click cannot request detail metadata');assert.equal(listeners.has('document:click'),false);assert.equal(listeners.has('document:keydown'),false);
last.naturalWidth=0;last.naturalHeight=0;resize();assert.equal(basics[3].textContent,'JPEG · 해상도 미확인 · 용량 미확인');
last.naturalWidth=4096;last.naturalHeight=2160;body.event('load',{target:last});paint();assert.match(basics[3].textContent,/4096 × 2160/,'Loaded natural dimensions update basic information');
last.setAttribute('src','/media/native/vector.svg');refresh();assert.equal(basics[3].textContent,'SVG · 벡터 이미지 · 용량 미확인');last.setAttribute('src','/media/native/failure.jpg');refresh();
// A small desktop photo keeps all basic values, allowing wrapping above it.
first.rect={left:30,right:100,top:200,bottom:240,width:70,height:40};window.innerWidth=800;resize();assert.equal(summaryOf(0),firstSummary);assert.equal(basics[0].textContent,'JPEG · 2560 × 1928 · 1.23 MB');assert.equal(basics[0].style.maxWidth,'62px');assert.equal(cards[0].style.left,'34px');assert.equal(cards[0].style.top,'156px');assert.equal(cards[0].hidden,false);
// Responsive placement retains the same text node and every photo's own label.
const header=document.createElement('header');header.className='site-header';header.rect={left:0,right:390,top:0,bottom:52,width:390,height:52};document.body.append(header);const headerBefore=header.innerHTML;
window.innerWidth=390;window.innerHeight=700;first.rect={left:8,right:190,top:100,bottom:500,width:182,height:400};second.rect={left:198,right:382,top:100,bottom:500,width:184,height:400};third.rect={left:8,right:382,top:600,bottom:1000,width:374,height:400};last.rect={left:8,right:382,top:1100,bottom:1500,width:374,height:400};resize();
assert.equal(document.querySelector('.public-photo-info-mobile'),null);assert.equal(header.innerHTML,headerBefore);assert.ok(cards.every(card=>!card.hidden));assert.equal(cards[0].style.left,'12px');assert.equal(cards[1].style.left,'202px');assert.equal(cards[0].style.top,'104px');assert.equal(cards[1].style.top,'104px');assert.equal(summaryOf(0),firstSummary);assert.equal(basics[0].textContent,'JPEG · 2560 × 1928 · 1.23 MB');assert.equal(requests.length,0);
const article=body.closest('.article-page'),editLink=document.createElement('a');editLink.className='public-edit-link';editLink.textContent='편집하기';$(body.node).before(editLink.node);
first.rect={...first.rect,top:130,bottom:530};second.rect={...second.rect,top:130,bottom:530};assert.equal(cards[0].style.top,'104px');
mutate({type:'childList',target:article,addedNodes:[editLink]});mutate({type:'childList',target:article,addedNodes:[editLink]});assert.equal(frames.length,1,'Layout changes coalesce into one placement frame');paint();assert.equal(cards[0].style.top,'134px');assert.equal(cards[1].style.top,'134px');assert.equal(summaryOf(0),firstSummary);
editLink.hidden=true;first.rect={...first.rect,top:100,bottom:500};second.rect={...second.rect,top:100,bottom:500};mutate({type:'attributes',target:editLink,attributeName:'hidden'});paint();assert.equal(cards[0].style.top,'104px');mutate({type:'childList',target:firstSummary,addedNodes:[]});assert.equal(frames.length,0,'Detached label updates do not create a placement loop');$(editLink.node).remove();
const mobilePress=second.event('pointerdown',{pointerType:'touch'});assert.equal(mobilePress.defaultPrevented,undefined);assert.equal(mobilePress.stopped,undefined,'Existing photo links retain their event path');
first.setAttribute('src','/media/native/mobile-new.jpg');last.setAttribute('src','/media/native/unknown.bin');last.naturalWidth=0;last.naturalHeight=0;refresh();assert.equal(basics[0].textContent,'JPEG · 2560 × 1928 · 용량 미확인');assert.equal(basics[3].textContent,'형식 미확인 · 해상도 미확인 · 용량 미확인');assert.ok(!basics[0].textContent.includes('Display P3')&&!basics[0].textContent.includes('HDR')&&!basics[0].textContent.includes('px'));
first.setAttribute('src','/media/native/first.jpg');last.setAttribute('src','/media/native/failure.jpg');window.innerWidth=1024;resize();assert.equal(summaryOf(0),firstSummary);assert.equal(basics[0].textContent,'JPEG · 2560 × 1928 · 1.23 MB');assert.equal(cards[0].style.left,'12px');assert.equal(cards[0].style.top,'104px');assert.equal(requests.length,0);assert.equal(header.innerHTML,headerBefore);assert.equal(body.innerHTML,initialBody);
// Repeated bootstraps add no duplicate layer; unavailable photos hide cleanly.
vm.runInContext(PUBLIC_PHOTO_INFO_BOOTSTRAP,context);assert.equal($('.public-photo-info-controls').length,1);first.rect={...first.rect,width:0};refresh();assert.equal(cards[0].hidden,true);first.rect={...first.rect,width:182};refresh();assert.equal(cards[0].hidden,false);
const layout=await readFile(new URL('../src/layouts/PostLayout.astro',import.meta.url),'utf8');assert.match(layout,/set:html=\{PUBLIC_PHOTO_INFO_BOOTSTRAP\}/);
const css=await readFile(new URL('../src/styles/photo-info.css',import.meta.url),'utf8');assert.match(css,/text-shadow: [^;]*rgb\(0 0 0 \/ 95%\)/);assert.match(css,/\.public-photo-info-card\s*\{[^}]*pointer-events: none/);assert.match(css,/\.public-photo-info-basic\s*\{[^}]*pointer-events: none/);assert.match(css,/\.public-photo-info-summary\s*\{[^}]*overflow-wrap: anywhere/);assert.ok(!css.includes('popover')&&!css.includes('cursor: pointer')&&!css.includes('opacity: 0'));
assert.ok(!PUBLIC_PHOTO_INFO_BOOTSTRAP.includes('fetch(')&&!PUBLIC_PHOTO_INFO_BOOTSTRAP.includes('photoHdrRows')&&!PUBLIC_PHOTO_INFO_BOOTSTRAP.includes('photoColorLines'));
console.log(JSON.stringify({suite:'public-photo-info',status:'PASS',behavior:'desktop/mobile basic format/pixels/bytes only, noninteractive wrapping labels, no detail panel or requests, late edit-link placement and unchanged body/links'}));
