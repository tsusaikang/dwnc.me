import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { PUBLIC_PHOTO_INFO_BOOTSTRAP } from '../src/lib/public-photo-info.ts';

const $=load('<body><article class="article-page"><img class="post-cover" src="/media/cover.jpg"><div class="prose"><p>앞 문단</p><div class="dwnc-image-layout"><figure><a href="https://example.test"><img src="/media/native/first.jpg"></a><figcaption>첫 설명</figcaption></figure><figure><img src="/media/native/second.jpg"><figcaption>둘째 설명</figcaption></figure></div><img src="https://external.example/media/native/first.jpg"><img src="/media/native/failure.jpg"><figure data-ke-type="opengraph"><img src="/media/card.jpg"></figure><p>뒤 문단</p></div></article><dialog id="otherDialog"></dialog></body>');
const wrappers=new WeakMap(),listeners=new Map(),requests=[],frames=[];
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
  append(...nodes){for(const node of nodes)$(this.node).append(node.node)}
  replaceChildren(...nodes){$(this.node).empty();this.append(...nodes)}
  addEventListener(name,handler){this.listeners.set(name,handler)}
  getBoundingClientRect(){return this.rect}
  focus(options){document.activeElement=this;this.focusOptions=options}
  showModal(){this.setAttribute('open','')}
  close(){delete this.node.attribs.open;this.listeners.get('close')?.({target:this})}
  event(name,extra={}){const event={target:this,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true},...extra};this.listeners.get(name)?.(event);return event}
  click(){return this.event('click')}
}
function wrap(node){if(!node)return null;if(!wrappers.has(node))wrappers.set(node,new Element(node));return wrappers.get(node)}
const document={body:wrap($('body')[0]),getElementById:id=>wrap($('#'+id)[0]),querySelector:selector=>wrap($(selector)[0]),createElement:tag=>wrap($('<'+tag+'>')[0]),activeElement:null};
const window={scrollX:0,scrollY:0,requestAnimationFrame:handler=>{frames.push(handler);return frames.length},addEventListener:(name,handler)=>listeners.set(name,handler)};
const fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
const context=vm.createContext({document,window,fetch,location:new URL('http://127.0.0.1:4322/posts/1'),URL,ResizeObserver:class{observe(){}},console});
const body=document.querySelector('.prose');
body.querySelectorAll('img')[1].setAttribute('src','http://127.0.0.1:4322/media/native/second.jpg');
const initialBody=body.innerHTML;
vm.runInContext(PUBLIC_PHOTO_INFO_BOOTSTRAP,context);
const buttons=$('.public-photo-info-button').toArray().map(wrap);
const dialog=document.getElementById('publicPhotoInfoDialog'),content=dialog.querySelector('[data-photo-info-content]');
const close=()=>dialog.querySelector('[data-photo-info-close]').click(),tick=()=>new Promise(resolve=>setImmediate(resolve));
const info={format:'JPEG',bytes:1234567,width:2560,height:1928,colorSpace:'Display P3',profileName:'<script>private()</script>',hdr:'metadata-present',metadataComplete:true};
assert.equal(buttons.length,4,'Only body photos receive buttons, excluding cover and URL cards');
assert.equal(requests.length,0,'No metadata or original image is fetched on initial rendering');
assert.equal(body.innerHTML,initialBody,'Groups, linked photos and captions are not mutated');
buttons[0].click();assert.equal(dialog.open,true);assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/photo-info?path=%2Fmedia%2Fnative%2Ffirst.jpg');assert.equal(requests[0].options.credentials,'same-origin');
close();assert.equal(document.activeElement,buttons[0]);assert.equal(document.activeElement.focusOptions.preventScroll,true);
buttons[1].click();assert.equal(requests.length,2);assert.equal(requests[1].url,'/api/photo-info?path=%2Fmedia%2Fnative%2Fsecond.jpg','Same-origin local aliases drop their development port');requests[0].resolve(Response.json({info}));await tick();assert.match(content.textContent,/확인하고/,'A late response cannot replace the newly opened photo');
requests[1].resolve(Response.json({info:{...info,width:1200,height:800,colorSpace:null,profileName:null,hdr:'not-indicated'}}));await tick();assert.match(content.textContent,/1200 × 800 px/);assert.match(content.textContent,/색영역미확인/);assert.match(content.textContent,/HDR 표시 없음/);assert.ok(!content.textContent.includes('SDR'));
close();buttons[0].click();await tick();assert.equal(requests.length,2,'Reopening a successfully read file reuses its metadata');assert.match(content.textContent,/2560 × 1928 px/);assert.match(content.textContent,/1\.23 MB \(1,234,567 바이트\)/);assert.match(content.textContent,/Display P3/);assert.equal(content.querySelectorAll('script').length,0,'Metadata is rendered as text');
const escape=dialog.event('keydown',{key:'Escape'});assert.equal(escape.defaultPrevented,true);assert.equal(escape.stopped,true);assert.equal(dialog.open,false);assert.equal(document.activeElement,buttons[0]);
buttons[2].click();await tick();assert.match(content.textContent,/외부 사진/);assert.equal(requests.length,2,'An external URL sharing an internal pathname is never fetched');close();
buttons[3].click();requests[2].resolve(new Response('',{status:404}));await tick();assert.match(content.textContent,/불러오지 못했습니다/);close();buttons[3].click();assert.equal(requests.length,4,'A failed lookup can be retried');requests[3].resolve(Response.json({info:{format:null,bytes:100,width:null,height:null,colorSpace:null,profileName:null,hdr:'unknown',metadataComplete:false}}));await tick();assert.match(content.textContent,/해상도미확인/);assert.match(content.textContent,/HDR 정보미확인/);close();
const lastPhoto=body.querySelectorAll('img')[3];lastPhoto.complete=true;lastPhoto.naturalWidth=4096;lastPhoto.naturalHeight=2160;
buttons[3].click();await tick();assert.match(content.textContent,/4096 × 2160 px/,'Already-loaded raster dimensions fill an unknown header result');assert.match(content.textContent,/100 B \(100 바이트\)/,'Only server bytes are shown');close();
lastPhoto.setAttribute('src','/media/native/vector.svg');buttons[3].click();requests[4].resolve(Response.json({info:{...info,format:'SVG'}}));await tick();assert.match(content.textContent,/해상도벡터 이미지/,'Vector information is not mistaken for intrinsic raster pixels');close();lastPhoto.setAttribute('src','/media/native/failure.jpg');
const other=document.getElementById('otherDialog');other.showModal();buttons[0].click();assert.equal(dialog.open,false,'Existing dialogs are not stacked');other.close();
body.querySelectorAll('img')[0].rect={left:30,right:100,top:200,bottom:240,width:70,height:40};buttons[0].focus();listeners.get('resize')();frames.shift()();assert.equal(buttons[0].textContent,'정보');assert.equal(buttons[0].style.width,'44px');assert.equal(document.activeElement,buttons[0],'Layout refresh keeps the existing focused control');
assert.equal(body.innerHTML,initialBody);assert.equal(requests.length,5);vm.runInContext(PUBLIC_PHOTO_INFO_BOOTSTRAP,context);assert.equal($('.public-photo-info-controls').length,1,'Bootstrap is idempotent');
const layout=await readFile(new URL('../src/layouts/PostLayout.astro',import.meta.url),'utf8');assert.match(layout,/set:html=\{PUBLIC_PHOTO_INFO_BOOTSTRAP\}/);
assert.ok(!PUBLIC_PHOTO_INFO_BOOTSTRAP.includes('mediaManifest')&&!PUBLIC_PHOTO_INFO_BOOTSTRAP.includes('cheerio'));
console.log(JSON.stringify({suite:'public-photo-info',status:'PASS',behavior:'on-demand one-file metadata, no external fetch, group/link/caption preservation, response race and retry, escaped fields, modal isolation, keyboard dismissal and focus restore'}));
