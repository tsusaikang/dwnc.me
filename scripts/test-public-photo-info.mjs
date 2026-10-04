import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { PUBLIC_PHOTO_INFO_BOOTSTRAP } from '../src/lib/public-photo-info.ts';

const $=load('<body><article class="article-page"><img class="post-cover" src="/media/cover.jpg"><div class="prose"><p>앞 문단</p><div class="dwnc-image-layout"><figure><a href="https://example.test"><img src="/media/native/first.jpg"></a><figcaption>첫 설명</figcaption></figure><figure><img src="/media/native/second.jpg"><figcaption>둘째 설명</figcaption></figure></div><img src="https://external.example/media/native/first.jpg"><img src="/media/native/failure.jpg"><figure data-ke-type="opengraph"><img src="/media/card.jpg"></figure><p>뒤 문단</p></div></article><dialog id="otherDialog"></dialog></body>');
const wrappers=new WeakMap(),listeners=new Map(),requests=[],frames=[],timers=new Map();let timerId=0;
const setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId},clearTimeout=id=>timers.delete(id);
const advanceTimers=delay=>{for(const [id,timer] of [...timers])if(timer.delay<=delay){timers.delete(id);timer.callback()}};
class Element {
  constructor(node){this.node=node;this.listeners=new Map();this.style={};this.rect={left:30,right:430,top:200,bottom:500,width:400,height:300};this.hidden=false;}
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
const context=vm.createContext({document,window,fetch,setTimeout,clearTimeout,location:new URL('http://127.0.0.1:4322/posts/1'),URL,ResizeObserver:class{observe(){}},console});
const body=document.querySelector('.prose');
const group=body.querySelector('.dwnc-image-layout');group.rect={left:30,right:900,top:200,bottom:500,width:870,height:300};
body.querySelectorAll('img')[1].setAttribute('src','http://127.0.0.1:4322/media/native/second.jpg');
for(const image of body.querySelectorAll('img')){image.complete=true;image.naturalWidth=2560;image.naturalHeight=1928}
const seed=document.createElement('script');seed.id='publicPhotoMetadata';seed.setAttribute('type','application/json');seed.textContent=JSON.stringify([{path:'/media/native/first.jpg',bytes:1234567,mime:'image/jpeg'},{path:'/media/native/second.jpg',bytes:2000,mime:'image/jpeg'}]);document.body.append(seed);
const initialBody=body.innerHTML;
vm.runInContext(PUBLIC_PHOTO_INFO_BOOTSTRAP,context);
const buttons=$('.public-photo-info-button').toArray().map(wrap);
const popover=document.getElementById('publicPhotoInfoPopover'),content=popover.querySelector('[data-photo-info-content]');
const close=()=>popover.querySelector('[data-photo-info-close]').click(),tick=()=>new Promise(resolve=>setImmediate(resolve));
const info={format:'JPEG',bytes:1234567,width:2560,height:1928,colorSpace:'Display P3',profileName:'<script>private()</script>',hdr:'metadata-present',metadataComplete:true};
assert.equal(buttons.length,4,'Only body photos receive buttons, excluding cover and URL cards');
assert.equal(buttons[0].textContent,'2560 × 1928 px1.23 MB');assert.match(buttons[0].getAttribute('aria-label'),/1번 사진.*상세 정보/);assert.equal(buttons[1].textContent,'2560 × 1928 px2 KB');assert.match(buttons[2].textContent,/용량 미확인/,'External paths never inherit another file byte size');
assert.equal(document.getElementById('publicPhotoInfoDialog'),null,'Detailed information is nonmodal');
assert.equal(buttons[0].style.left,'290px');assert.equal(buttons[0].style.top,'456px','Basic values stay at the lower-right photo edge');
assert.equal(requests.length,0,'No metadata or original image is fetched on initial rendering');
assert.equal(body.innerHTML,initialBody,'Groups, linked photos and captions are not mutated');
buttons[0].click();assert.equal(popover.hidden,false);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/photo-info?path=%2Fmedia%2Fnative%2Ffirst.jpg');assert.equal(requests[0].options.credentials,'same-origin');
close();assert.equal(document.activeElement,buttons[0]);assert.equal(document.activeElement.focusOptions.preventScroll,true);
buttons[1].focus();paint();assert.equal(popover.hidden,false,'Keyboard focus opens the details without trapping focus');assert.equal(document.activeElement,buttons[1]);assert.equal(requests.length,2);assert.equal(requests[1].url,'/api/photo-info?path=%2Fmedia%2Fnative%2Fsecond.jpg','Same-origin local aliases drop their development port');requests[0].resolve(Response.json({info}));await tick();assert.match(content.textContent,/확인하고/,'A late response cannot replace the newly opened photo');
requests[1].resolve(Response.json({info:{...info,width:1200,height:800,colorSpace:null,profileName:null,hdr:'not-indicated'}}));await tick();assert.match(content.textContent,/1200 × 800 px/);assert.match(content.textContent,/색영역미확인/);assert.match(content.textContent,/HDR 표시 없음/);assert.ok(!content.textContent.includes('SDR'));
close();buttons[0].click();await tick();assert.equal(requests.length,2,'Reopening a successfully read file reuses its metadata');assert.match(content.textContent,/2560 × 1928 px/);assert.match(content.textContent,/1\.23 MB \(1,234,567 바이트\)/);assert.match(content.textContent,/Display P3/);assert.equal(content.querySelectorAll('script').length,0,'Metadata is rendered as text');
const escape={key:'Escape',preventDefault(){this.defaultPrevented=true}};listeners.get('document:keydown')(escape);assert.equal(escape.defaultPrevented,true);assert.equal(popover.hidden,true);assert.equal(document.activeElement,buttons[1],'Escape preserves current reading focus');
buttons[2].click();await tick();assert.match(content.textContent,/외부 사진/);assert.equal(requests.length,2,'An external URL sharing an internal pathname is never fetched');close();
body.querySelectorAll('img')[3].naturalWidth=0;body.querySelectorAll('img')[3].naturalHeight=0;
buttons[3].click();requests[2].resolve(new Response('',{status:404}));await tick();assert.match(content.textContent,/불러오지 못했습니다/);close();buttons[3].click();assert.equal(requests.length,4,'A failed lookup can be retried');requests[3].resolve(Response.json({info:{format:null,bytes:100,width:null,height:null,colorSpace:null,profileName:null,hdr:'unknown',metadataComplete:false}}));await tick();assert.match(content.textContent,/해상도미확인/);assert.match(content.textContent,/HDR 정보미확인/);close();
const lastPhoto=body.querySelectorAll('img')[3];lastPhoto.complete=true;lastPhoto.naturalWidth=4096;lastPhoto.naturalHeight=2160;
buttons[3].click();await tick();assert.match(content.textContent,/4096 × 2160 px/,'Already-loaded raster dimensions fill an unknown header result');assert.match(content.textContent,/100 B \(100 바이트\)/,'Only server bytes are shown');close();
lastPhoto.setAttribute('src','/media/native/vector.svg');buttons[3].click();requests[4].resolve(Response.json({info:{...info,format:'SVG'}}));await tick();assert.match(content.textContent,/해상도벡터 이미지/,'Vector information is not mistaken for intrinsic raster pixels');close();lastPhoto.setAttribute('src','/media/native/failure.jpg');
const other=document.getElementById('otherDialog');other.showModal();buttons[0].click();assert.equal(popover.hidden,true,'No photo details appear over an existing modal');other.close();
buttons[0].event('pointerenter',{pointerType:'mouse'});advanceTimers(140);await tick();assert.equal(popover.hidden,false,'Hover opens cached detail');assert.equal(popover.style.top,'506px','Grouped photos use space below the whole row before covering a neighboring photo');buttons[0].event('pointerleave');body.querySelectorAll('img')[0].event('pointerenter');advanceTimers(180);assert.equal(popover.hidden,false,'Moving across the source photo towards an outside detail keeps it open');body.querySelectorAll('img')[0].event('pointerleave');popover.event('pointerenter');advanceTimers(180);assert.equal(popover.hidden,false,'Moving onto the detail keeps it open');popover.event('pointerleave');advanceTimers(180);assert.equal(popover.hidden,true);
buttons[0].event('pointerenter',{pointerType:'touch'});advanceTimers(140);assert.equal(popover.hidden,true);buttons[0].event('pointerdown');buttons[0].focus();buttons[0].click();advanceTimers(0);await tick();assert.equal(popover.hidden,false,'One touch opens details despite its focus event');buttons[0].click();assert.equal(popover.hidden,true,'A second touch closes details');
const summary=buttons[0].querySelector('.public-photo-info-summary');body.querySelectorAll('img')[0].rect={left:30,right:100,top:200,bottom:240,width:70,height:40};window.innerWidth=390;buttons[0].focus();listeners.get('resize')();paint();assert.equal(buttons[0].querySelector('.public-photo-info-summary'),summary,'Resize preserves the basic information node');assert.match(buttons[0].textContent,/2560×1928/);assert.equal(buttons[0].style.left,'30px');assert.equal(buttons[0].style.top,'200px');assert.equal(document.activeElement,buttons[0],'Layout refresh keeps the existing focused control');
buttons[0].click();await tick();assert.ok(Number.parseFloat(popover.style.left)>=8);assert.ok(Number.parseFloat(popover.style.left)+300<=390-8,'Narrow viewports keep the complete detail within the screen');listeners.get('document:click')({target:body});assert.equal(popover.hidden,true,'Reading outside the detail closes it without blocking the page');
for(const [vw,vh,left,right,top,bottom] of [[390,360,0,390,0,360],[390,600,10,380,400,600],[390,400,8,382,140,380],[844,260,80,760,0,250],[390,300,20,370,-800,900]]){
  window.innerWidth=vw;window.innerHeight=vh;body.querySelectorAll('img')[0].rect={left,right,top,bottom,width:right-left,height:bottom-top};group.rect={...body.querySelectorAll('img')[0].rect};buttons[0].click();await tick();listeners.get('resize')();paint();
  const x=Number.parseFloat(popover.style.left),y=Number.parseFloat(popover.style.top),width=Number.parseFloat(popover.style.width),height=Number.parseFloat(popover.style.maxHeight),cx=(Math.max(0,left)+Math.min(vw,right))/2,cy=(Math.max(0,top)+Math.min(vh,bottom))/2;
  assert.ok(x>=8&&y>=8&&x+width<=vw-8&&y+height<=vh-8,'The bounded detail fits narrow and short viewports');assert.ok(!(x<=cx&&cx<=x+width&&y<=cy&&cy<=y+height),'The visible photo center remains clear');
  for(const state of [{isComposing:true},{keyCode:229}]){const event={key:'Escape',...state,preventDefault(){this.prevented=true}};listeners.get('document:keydown')(event);assert.equal(popover.hidden,false);assert.equal(event.prevented,undefined,'IME Escape remains untouched')}
  close();
}
window.innerWidth=390;window.innerHeight=700;
const second=body.querySelectorAll('img')[1];second.rect={left:20,right:370,top:1100,bottom:1400,width:350,height:300};buttons[1].focus();assert.equal(popover.hidden,true,'Focus defers placement until the browser scrolls the target into view');
second.rect={...second.rect,top:250,bottom:550};group.rect={...second.rect};window.scrollY=850;listeners.get('scroll')();paint();await tick();assert.equal(popover.hidden,false,'An offscreen Tab target opens after native focus scrolling');assert.match(content.textContent,/1200 × 800 px/);close();
buttons[0].focus();document.body.focus();paint();assert.equal(popover.hidden,true,'A stale deferred focus does not reopen a photo after focus has moved away');
assert.equal(body.innerHTML,initialBody);assert.equal(requests.length,5);vm.runInContext(PUBLIC_PHOTO_INFO_BOOTSTRAP,context);assert.equal($('.public-photo-info-controls').length,1,'Bootstrap is idempotent');
const layout=await readFile(new URL('../src/layouts/PostLayout.astro',import.meta.url),'utf8');assert.match(layout,/set:html=\{PUBLIC_PHOTO_INFO_BOOTSTRAP\}/);
assert.ok(!PUBLIC_PHOTO_INFO_BOOTSTRAP.includes('mediaManifest')&&!PUBLIC_PHOTO_INFO_BOOTSTRAP.includes('cheerio'));
console.log(JSON.stringify({suite:'public-photo-info',status:'PASS',behavior:'inline metadata without extra requests, nonmodal hover/focus/touch detail, edge placement, no external fetch, preserved body, cache/race/retry, keyboard dismissal'}));
