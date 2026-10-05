import assert from 'node:assert/strict';
import vm from 'node:vm';
import { load } from 'cheerio';
import { imageDirectScript, imageDirectToolsHtml, imageDirectOverlayHtml, imageDirectCss } from '../src/lib/admin-image-direct.ts';
import { IMAGE_LAYOUT_DOM_SCRIPT } from '../src/lib/image-layout.ts';
import { imageLayoutScript } from '../src/lib/admin-image-layout.ts';
import { adminHtml } from '../src/lib/admin-ui.ts';
import { editorHistoryScript } from '../src/lib/admin-editor-history.ts';
import { sanitizeNativeHtml, sanitizeLegacyHtml } from '../src/lib/native-content.ts';

// Cheerio supplies parsing/selector semantics; this adapter supplies DOM moves.
// Pointer hit testing below uses deterministic rectangles. Actual browser layout
// and pointer input are exercised in serve-editor-fixture.mjs.
const $html=load('<div id="editorHeader"></div><div id="editorFooter"></div><div id="bodyHtml"></div><div id="markdownMedia"></div><div id="formatToolbar"></div><div id="linkPanel"></div><div id="tablePanel"></div><button id="deleteImage"></button><div id="imageTools">'+imageDirectToolsHtml+'</div>'+imageDirectOverlayHtml);
const wrappers=new WeakMap(),listeners=new Map(),widths=new Map(),scrollRequests=[];
let hit=null,caretNode=null,timerSerial=0;const timerCallbacks=new Map();const flushInfoTimers=()=>{for(const [id,callback] of [...timerCallbacks]){timerCallbacks.delete(id);callback()}};
class Element {
  constructor(node){this.node=node;this.listeners=new Map();this.dataset=new Proxy({},{get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()))??undefined,set:(_,key,value)=>{this.setAttribute('data-'+String(key).replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()),value);return true},deleteProperty:(_,key)=>{this.removeAttribute('data-'+String(key).replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase()));return true}});this.hidden='hidden' in (node.attribs||{});this.value='';this.scrollTop=0;this.rect={left:0,top:0,right:800,bottom:100,width:800,height:100};this.style={getPropertyValue:name=>this.styles()[name]?.replace(/\s*!important$/,'' )||'',getPropertyPriority:name=>/!important$/.test(this.styles()[name]||'')?'important':'',setProperty:(name,value,priority)=>{const styles=this.styles();styles[name]=value+(priority?' !important':'');this.writeStyles(styles)},removeProperty:name=>{const styles=this.styles();delete styles[name];this.writeStyles(styles)}};this.classList={contains:name=>(this.node.attribs.class||'').split(/\s+/).includes(name),add:(...names)=>this.node.attribs.class=[...new Set((this.node.attribs.class||'').split(/\s+/).filter(Boolean).concat(names))].join(' '),remove:(...names)=>this.node.attribs.class=(this.node.attribs.class||'').split(/\s+/).filter(name=>!names.includes(name)).join(' ')};}
  styles(){return Object.fromEntries((this.node.attribs.style||'').split(';').filter(value=>value.includes(':')).map(value=>{const index=value.indexOf(':');return[value.slice(0,index).trim(),value.slice(index+1).trim()]}))}
  writeStyles(styles){const value=Object.entries(styles).map(([key,value])=>key+':'+value).join(';');if(value)this.node.attribs.style=value;else delete this.node.attribs.style}
  get tagName(){return this.node.name?.toUpperCase()}
  get nodeType(){return this.node.type==='text'?3:1}
  get className(){return this.node.attribs.class||''} set className(value){this.node.attribs.class=value}
  get innerHTML(){return $html(this.node).html()} set innerHTML(value){$html(this.node).html(value)}
  get outerHTML(){return $html.html(this.node)}
  get textContent(){return $html(this.node).text()} set textContent(value){$html(this.node).text(value)}
  get childNodes(){return(this.node.children||[]).map(wrap)}
  get children(){return(this.node.children||[]).filter(node=>node.type==='tag').map(wrap)}
  get parentNode(){return this.node.parent?wrap(this.node.parent):null} get parentElement(){return this.parentNode}
  get nextSibling(){return this.node.next?wrap(this.node.next):null}
  get nextElementSibling(){return wrap($html(this.node).next()[0])} get previousElementSibling(){return wrap($html(this.node).prev()[0])}
  get complete(){return true} get naturalWidth(){return widths.get(this.getAttribute('src'))||0}get naturalHeight(){return this.naturalWidth*.75}
  get options(){return this.children}
  matches(selector){return $html(this.node).is(selector)}
  closest(selector){return wrap($html(this.node).closest(selector)[0])}
  querySelectorAll(selector){return $html(this.node).find(selector).toArray().map(wrap)} querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  contains(node){while(node){if(node===this)return true;node=node.parentNode}return false}
  getAttribute(name){return this.node.attribs[name]??null} hasAttribute(name){return name in this.node.attribs} setAttribute(name,value){this.node.attribs[name]=String(value)} removeAttribute(name){delete this.node.attribs[name]}
  replaceChildren(...nodes){$html(this.node).empty();this.append(...nodes)}
  append(...nodes){for(const node of nodes)$html(this.node).append(node.node)}
  before(node){$html(this.node).before(node.node)}
  insertBefore(node,before){if(before)$html(before.node).before(node.node);else this.append(node)}
  remove(){$html(this.node).remove()}
  cloneNode(){return wrap($html(this.node).clone()[0])}
  getBoundingClientRect(){return this.measureRect?this.measureRect():this.rect}
  setPointerCapture(id){assert.equal(field('imageTools').hidden,false,'Capture must precede hiding the floating tools');this.captured=id}
  hasPointerCapture(id){return this.captured===id} releasePointerCapture(){this.captured=null}
  focus(){document.activeElement=this} scrollIntoView(){} showModal(){this.open=true} close(){this.open=false;listeners.get(this.getAttribute('id')+':close')?.()} addEventListener(name,fn){this.listeners.set(name,fn);listeners.set(this.getAttribute('id')+':'+name,fn)}
  click(){
    if(this.disabled)return;
    const path=[];for(let node=this;node;node=node.parentNode)path.push(node);
    const event={target:this,currentTarget:this,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true},stopImmediatePropagation(){this.propagationStopped=true},composedPath:()=>path};
    let result;for(const node of path){event.currentTarget=node;result=node.listeners.get('click')?.(event);if(event.propagationStopped)return result}
    listeners.get('document:click')?.(event);return result;
  }
}
function wrap(node){if(!node)return null;if(!wrappers.has(node))wrappers.set(node,new Element(node));return wrappers.get(node)}
const field=id=>wrap($html('#'+id)[0]),body=field('bodyHtml');
const document={body:wrap($html('body')[0]),createElement:tag=>wrap($html('<'+tag+'>')[0]),createRange:()=>({selectNodeContents(node){caretNode=node},collapse(){}}),elementFromPoint:()=>hit,addEventListener(name,fn){listeners.set('document:'+name,fn)}};
const headerResizeObservers=[];class HeaderResizeObserver{constructor(callback){this.callback=callback;this.targets=[];headerResizeObservers.push(this)}observe(target){this.targets.push(target)}}
const context=vm.createContext({document,Element,ResizeObserver:HeaderResizeObserver,URL,$:field,window:{getSelection:()=>({removeAllRanges(){},addRange(){}}),addEventListener(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},scrollY:0,scrollBy(...args){scrollRequests.push({method:'scrollBy',args});this.scrollY+=typeof args[0]==='object'?args[0].top||0:args[1]||0},scrollTo(...args){scrollRequests.push({method:'scrollTo',args});this.scrollY=typeof args[0]==='object'?args[0].top||0:args[1]||0},innerHeight:900,innerWidth:1000},Promise,Date,JSON,console,setTimeout:callback=>{const id=++timerSerial;timerCallbacks.set(id,callback);return id},clearTimeout:id=>timerCallbacks.delete(id)});
vm.runInContext(`let current={id:'synthetic-photo'},busy=false,selectedMedia=null,uploadRange=null,formatRange=null,pendingFontSpans=null,pastedImageNodes=null;function status(message){lastStatus=message}let lastStatus='';function bodyRange(){return null}function captureFormatRange(){}function updateFormatState(){}function positionMediaSelection(){}function clearMediaSelection(){selectedMedia=null;if(typeof closeDirectPhotoOrder==='function')closeDirectPhotoOrder()}function selectMedia(image){selectedMedia={image};updateDirectPhotoTools()}function schedule(){rememberEditorChange()}`,context);
vm.runInContext(editorHistoryScript,context);vm.runInContext(IMAGE_LAYOUT_DOM_SCRIPT,context);
for(const [start,end] of [['function layoutRoot','function openImageLayout'],['function layoutSizeAvailability','function updateLayoutSizes'],['function prepareLayoutItem','function applyImageLayout']])vm.runInContext(imageLayoutScript.slice(imageLayoutScript.indexOf(start),imageLayoutScript.indexOf(end)),context);
vm.runInContext(imageDirectScript,context);
const run=source=>vm.runInContext(source,context),tick=()=>new Promise(resolve=>setImmediate(resolve));
const src=letter=>'/media/native/'+letter.repeat(8)+'-'+letter.repeat(4)+'-4'+letter.repeat(3)+'-8'+letter.repeat(3)+'-'+letter.repeat(12)+'.png';
for(const [letter,width] of [['a',1400],['b',1400],['c',1400],['d',320]])widths.set(src(letter),width);
const photo=letter=>'<figure class="imageblock"><a href="https://example.test/'+letter+'"><img src="'+src(letter)+'" alt="'+letter+'" style="width:80%;height:30px"></a><figcaption><em>caption '+letter+'</em></figcaption></figure>';
field('editorHeader').rect={left:0,right:1000,top:0,bottom:0,width:1000,height:0};field('editorFooter').hidden=true;
const original='<h2>Heading</h2><p>Before <strong>bold</strong></p>'+photo('a')+'<p>Middle <em>italic</em></p>'+photo('b')+photo('c')+'<table><tbody><tr><td>Untouched</td></tr></tbody></table>'+photo('d')+'<p>After</p>';
body.innerHTML=original;run('resetEditorHistory()');
const image=letter=>body.querySelector('img[alt="'+letter+'"]');
function move(letter,target){context.moving=image(letter);context.target=target;return run('moveDirectPhoto(moving,target)')}
const group=(letter,other,side='after')=>move(letter,{type:'group',image:image(other),side});
const order=()=>body.querySelectorAll('img').map(node=>node.getAttribute('alt')).join('');
const checkpoint=()=>body.innerHTML;
const originalParagraphs=()=>body.querySelectorAll('h2,p,table').filter(node=>!node.closest('.dwnc-image-item')).map(node=>node.outerHTML).join('');
const surrounding=originalParagraphs();

assert.equal(group('b','a'),true);await tick();
assert.equal(body.querySelector('.dwnc-image-cols-2').querySelectorAll('.dwnc-image-caption').length,1);
assert.equal(originalParagraphs(),surrounding,'Text between the original photos must stay in place');
assert.equal(group('c','b'),true);await tick();assert.equal(body.querySelector('.dwnc-image-cols-3').querySelectorAll('.dwnc-image-item').length,3);
assert.equal(group('c','a','before'),true);await tick();assert.equal(order(),'cabd');
const beforeRejected=checkpoint();assert.equal(group('d','a'),false);assert.equal(checkpoint(),beforeRejected,'A fourth photo must not modify either side');
const grouped=checkpoint();
const middle=body.querySelectorAll('p').find(node=>node.textContent.startsWith('Middle'));
assert.equal(move('a',{type:'move',parent:body,before:middle.nextSibling}),true);await tick();
assert.equal(body.querySelector('.dwnc-image-cols-2').querySelectorAll('img').map(node=>node.getAttribute('alt')).join(''),'cb');
assert.equal(originalParagraphs(),surrounding);
const split=checkpoint();run("editorHistoryCommand('undo')");assert.equal(checkpoint(),grouped);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),split);
assert.equal(move('b',{type:'move',parent:body,before:body.children.at(-1)}),true);await tick();
assert.equal(body.querySelectorAll('.dwnc-image-cols-2,.dwnc-image-cols-3').length,0);
assert.equal(body.querySelectorAll('figcaption,.dwnc-image-caption').length,2);assert.equal(body.querySelectorAll('figcaption em,.dwnc-image-caption em').length,4);assert.equal(body.querySelectorAll('a').length,4);
assert.equal(originalParagraphs(),surrounding);

// Regroup differently, then carry format/text edits through the same history.
assert.equal(group('a','c','before'),true);await tick();
context.selected=image('a');run("selectMedia(selected);setDirectPhotoLayout('align','right');setDirectPhotoLayout('size','full')");await tick();
assert.equal(image('a').closest('.dwnc-image-layout').classList.contains('dwnc-image-full'),true);
context.selected=image('d');run("selectMedia(selected);setDirectPhotoLayout('size','full')");await tick();assert.equal(image('d').closest('.dwnc-image-layout'),null,'Small originals cannot get full-width layout');
const beforeTyping=checkpoint();body.children[0].innerHTML='Heading <strong>edited</strong>';run('schedule()');await tick();run("editorHistoryCommand('undo')");assert.equal(checkpoint(),beforeTyping);run("editorHistoryCommand('redo')");assert.ok(checkpoint().includes('Heading <strong>edited</strong>'));
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const clean=sanitize(checkpoint()),parsed=load(clean);assert.equal(parsed('figcaption,.dwnc-image-caption').length,2);assert.equal(parsed('figcaption em,.dwnc-image-caption em').length,4);assert.equal(parsed('img').length,4);assert.equal(parsed('.dwnc-image-cols-2').length,1);assert.equal(parsed('.dwnc-image-full').length,1);assert.equal(sanitize(clean),clean);assert.ok(!clean.includes('photo-drop'));}

// Group shrink must re-evaluate the new per-image requirement (354 -> 720px).
body.innerHTML=photo('d')+photo('a');run('resetEditorHistory()');assert.equal(group('d','a'),true);await tick();
widths.set(src('d'),400);context.selected=image('d');run("selectMedia(selected);setDirectPhotoLayout('size','paragraph')");await tick();assert.equal(image('d').closest('.dwnc-image-layout').classList.contains('dwnc-image-paragraph'),true);
assert.equal(move('a',{type:'move',parent:body,before:null}),true);await tick();assert.equal(image('d').closest('.dwnc-image-layout').classList.contains('dwnc-image-original'),true);

// Hit targets: middle sides group, upper/lower edges split/move, captions/text move.
body.innerHTML=original;run('resetEditorHistory()');body.rect={left:10,right:810,top:100,bottom:1400,width:800,height:1300};
image('a').rect={left:20,right:720,top:200,bottom:500,width:700,height:300};image('a').closest('figure').rect=image('a').rect;
hit=image('a');context.moving=image('b');let target=run('directPhotoDropTarget(22,340,moving)');assert.equal(target.type,'group');assert.equal(target.side,'before');assert.equal(target.label,'옆에 놓아 함께 묶기');
target=run('directPhotoDropTarget(718,340,moving)');assert.equal(target.side,'after');
target=run('directPhotoDropTarget(100,207,moving)');assert.equal(target.type,'move');assert.equal(target.before,image('a').closest('figure'));
target=run('directPhotoDropTarget(100,493,moving)');assert.equal(target.type,'move');assert.equal(target.before,image('a').closest('figure').nextSibling);
hit=body.querySelector('p');hit.rect={left:10,right:810,top:120,bottom:160,width:800,height:40};target=run('directPhotoDropTarget(100,158,moving)');assert.equal(target.type,'move');assert.equal(target.before,hit.nextSibling);
assert.equal(checkpoint(),original,'Hit previews must never enter saved content');
// Inline photos may move out of text, but a block wrapper must never be inserted
// inside a text paragraph (HTML parsing would otherwise split its formatting).
body.innerHTML='<p style="text-align:right">앞 <a href="https://example.test/inline"><img src="'+src('a')+'" alt="a"></a> 뒤 <strong>서식</strong></p>'+photo('b');run('resetEditorHistory()');
const mixed=checkpoint();context.selected=image('a');run("selectMedia(selected);setDirectPhotoLayout('align','left')");assert.equal(checkpoint(),mixed);assert.equal(group('b','a'),false);assert.equal(checkpoint(),mixed);
assert.equal(move('a',{type:'move',parent:body,before:null}),true);await tick();assert.equal(body.children[0].outerHTML,'<p style="text-align:right">앞  뒤 <strong>서식</strong></p>');
assert.equal(group('b','a'),true);await tick();assert.equal(body.querySelector('.dwnc-image-cols-2').querySelectorAll('img').length,2);assert.equal(body.querySelector('p div'),null);
// The mobile handle uses the same drop path and keeps pointer capture until up.
body.innerHTML=original;run('resetEditorHistory()');context.selected=image('b');run('selectMedia(selected)');hit=image('a');hit.rect={left:20,right:720,top:200,bottom:500,width:700,height:300};
const handle=field('dragSelectedPhoto');let prevented=0;
const pointer={button:0,pointerId:11,currentTarget:handle,clientX:700,clientY:340,preventDefault(){prevented++}};
listeners.get('dragSelectedPhoto:pointerdown')(pointer);assert.equal(handle.captured,11);assert.equal(field('imageTools').hidden,true);
listeners.get('document:pointermove')(pointer);listeners.get('document:pointerup')(pointer);await tick();assert.equal(handle.captured,null);assert.equal(body.querySelector('.dwnc-image-cols-2').querySelectorAll('.dwnc-image-item').length,2);assert.equal(field('photoDropIndicator').hidden,true);assert.equal(prevented,3);
// Consecutive upload figures have no text block between them. Only their outer
// vertical margins accept a paragraph; an image, caption or row gutter does not.
body.innerHTML=photo('a')+photo('b');run('resetEditorHistory()');
body.rect={left:10,right:810,top:100,bottom:900,width:800,height:800};
function box(node,top,bottom){node.rect={left:20,right:720,top,bottom,width:700,height:bottom-top}}
box(body.children[0],130,330);box(body.children[1],370,570);
context.hit=body;
const gapTarget=(x,y,node=body)=>{context.hit=node;return run(`directPhotoTextTarget(${x},${y},hit)`)};
assert.ok(gapTarget(300,115),'First photo top margin is writable');
assert.ok(gapTarget(300,350),'Adjacent photo margin is writable');
assert.ok(gapTarget(300,590),'Last photo bottom margin is writable');
assert.equal(gapTarget(300,800),null,'A distant blank page area is not a photo gap');
assert.equal(gapTarget(300,200,image('a')),null);
assert.equal(gapTarget(300,320,body.querySelector('figcaption em')),null);
assert.equal(gapTarget(800,200),null,'Side whitespace beside a photo must not create a paragraph');
assert.equal(gapTarget(5,350),null);
const photosBefore=checkpoint();context.target=gapTarget(300,350);
const clickGap={button:0,clientX:300,clientY:350,target:body,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};
listeners.get('bodyHtml:pointerdown')(clickGap);listeners.get('bodyHtml:click')(clickGap);await tick();
assert.equal(clickGap.prevented,true);assert.equal(clickGap.stopped,true);
assert.equal(body.children[1].outerHTML,'<p><br></p>');assert.equal(caretNode,body.children[1]);assert.equal(order(),'ab');
const gapInserted=checkpoint();assert.equal(gapInserted,photo('a')+'<p><br></p>'+photo('b'));
box(body.children[1],338,362);
context.target=gapTarget(300,350,body.children[1]);assert.equal(context.target.paragraph,body.children[1]);assert.equal(run('enterPhotoText(target)'),true);await tick();assert.equal(checkpoint(),gapInserted,'Reentering an empty paragraph must not duplicate it');
context.target=gapTarget(300,365);assert.equal(context.target.paragraph,body.children[1]);run('enterPhotoText(target)');assert.equal(checkpoint(),gapInserted,'Clicking next to an existing empty paragraph reuses it');
run("editorHistoryCommand('undo')");assert.equal(checkpoint(),photosBefore);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),gapInserted);
body.children[1].innerHTML='Between <strong>photos</strong>';run('schedule()');await tick();
const withText=checkpoint();assert.equal(gapTarget(300,350,body.children[1]),null,'Existing text editing is left to the browser');
run("editorHistoryCommand('undo')");assert.equal(checkpoint(),gapInserted);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),withText);
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const clean=sanitize(withText);assert.ok(clean.includes('<p>Between <strong>photos</strong></p>'));assert.equal(load(clean)('img').length,2);assert.equal(load(clean)('figcaption em').length,2);assert.ok(!clean.includes('photo-text-hint'));assert.equal(sanitize(clean),clean)}
body.innerHTML=photosBefore;run('resetEditorHistory()');box(body.children[0],130,330);box(body.children[1],370,570);
listeners.get('bodyHtml:pointerdown')(clickGap);listeners.get('bodyHtml:pointermove')({...clickGap,buttons:1,clientY:380});listeners.get('bodyHtml:click')(clickGap);assert.equal(checkpoint(),photosBefore,'Dragging from a margin must not insert text');
run('busy=true');assert.equal(gapTarget(300,350),null);run('busy=false;editorComposing=true');assert.equal(gapTarget(300,350),null);run('editorComposing=false');
assert.equal(group('b','a'),true);await tick();const row=body.querySelector('.dwnc-image-layout');box(row,130,330);assert.equal(gapTarget(300,250,row),null,'A grouped row interior is not a paragraph gap');
context.selected=image('a');run('startDirectPhotoDrag(selected)');assert.equal(gapTarget(300,350),null,'Photo dragging disables paragraph insertion');run('stopDirectPhotoDrag()');
// All boundaries use the same insertion path, including a single photo and an
// intact grouped row. The real fixture additionally verifies that editor CSS
// keeps the leading/trailing margin inside the editable element's hit area.
function clickTextMargin(y,node=body){const event={...clickGap,clientY:y,target:node};listeners.get('bodyHtml:pointerdown')(event);listeners.get('bodyHtml:click')(event);return event}
for(const kind of ['single','consecutive','group']){
  body.innerHTML=photo('a')+(kind==='single'?'':photo('b'));run('resetEditorHistory()');
  if(kind==='group'){assert.equal(group('b','a'),true);await tick()}
  const pristine=checkpoint(),imageOrder=order();
  for(const edge of ['before','after']){
    body.innerHTML=pristine;run('resetEditorHistory()');
    const roots=body.children;roots.forEach((node,index)=>box(node,136+240*index,336+240*index));
    const y=edge==='before'?118:roots.at(-1).getBoundingClientRect().bottom+18;
    assert.equal(clickTextMargin(y).stopped,true,kind+' '+edge+' must accept the real click path');await tick();
    const paragraph=edge==='before'?body.children[0]:body.children.at(-1);
    assert.equal(paragraph.outerHTML,'<p><br></p>');assert.equal(caretNode,paragraph);assert.equal(order(),imageOrder);
    assert.equal(checkpoint(),edge==='before'?'<p><br></p>'+pristine:pristine+'<p><br></p>');
    const inserted=checkpoint();box(paragraph,y-10,y+10);clickTextMargin(y,paragraph);await tick();assert.equal(checkpoint(),inserted,kind+' '+edge+' empty paragraph is reused');
    run("editorHistoryCommand('undo')");assert.equal(checkpoint(),pristine);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),inserted);
    const textParagraph=edge==='before'?body.children[0]:body.children.at(-1);textParagraph.innerHTML='Boundary <strong>text</strong>';run('schedule()');await tick();
    const written=checkpoint();for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const saved=sanitize(written),reopened=load(saved);assert.equal(reopened('img').length,kind==='single'?1:2);assert.equal(reopened('figcaption em,.dwnc-image-caption em').length,kind==='single'?1:2);assert.ok(saved.includes('<p>Boundary <strong>text</strong></p>'));assert.equal(reopened('.dwnc-image-cols-2').length,kind==='group'?1:0);assert.ok(!saved.includes('photoTextHint'))}
  }
}
// Position moves keep captions/text and split only the destination group in
// one history step. Final-index coverage exercises the same anchor API as slots.
body.innerHTML=original;run('resetEditorHistory()');
const selectPhoto=letter=>{context.selected=image(letter);run('selectMedia(selected);updateDirectPhotoTools()')};
const positionMove=(letter,anchor,side)=>{selectPhoto(letter);context.anchor=image(anchor);context.side=side;return run('moveDirectPhotoToPosition(anchor,side)')};
const finalPositionMove=(letter,value)=>{const images=body.querySelectorAll('img'),from=images.indexOf(image(letter));return positionMove(letter,images[value-1].getAttribute('alt'),value<from+1?'before':'after')};
assert.equal(finalPositionMove('a',4),true);await tick();assert.equal(order(),'bcda');assert.equal(field('directPhotoNumber').textContent,'사진 4 / 4');assert.equal(originalParagraphs(),surrounding);
assert.equal(finalPositionMove('a',1),true);await tick();assert.equal(order(),'abcd');
const valid=checkpoint(),history=run('editorUndoStates.length');
assert.equal(positionMove('a','a','before'),false);assert.equal(positionMove('a','a','after'),false);assert.equal(positionMove('a','b','invalid'),false);await tick();assert.equal(checkpoint(),valid);assert.equal(run('editorUndoStates.length'),history,'Unchanged positions create no history');
assert.equal(group('b','a'),true);assert.equal(group('c','b'),true);await tick();
const three=checkpoint();assert.equal(finalPositionMove('c',1),true);await tick();assert.equal(order(),'cabd');assert.equal(image('c').closest('.dwnc-image-layout'),image('a').closest('.dwnc-image-layout'));
run("editorHistoryCommand('undo')");assert.equal(checkpoint(),three);run("editorHistoryCommand('redo')");assert.equal(order(),'cabd');
assert.equal(finalPositionMove('d',2),true);await tick();assert.equal(order(),'cdab');
assert.equal(body.querySelectorAll('.dwnc-image-layout').length,2,'Only destination row is split; independent photo stays separate');
assert.equal(image('d').closest('.dwnc-image-layout'),null);assert.equal(image('c').closest('.dwnc-image-layout').querySelectorAll('.dwnc-image-caption').length,1,'Shared caption stays on first destination row');
assert.equal(image('a').closest('.dwnc-image-layout').querySelectorAll('.dwnc-image-caption').length,0);
assert.equal(body.querySelectorAll('figcaption em,.dwnc-image-caption em').length,4);assert.equal(originalParagraphs(),surrounding);
const between=checkpoint();run("editorHistoryCommand('undo')");assert.equal(order(),'cabd');assert.equal(body.querySelectorAll('.dwnc-image-layout').length,1,'One undo restores split and move');run("editorHistoryCommand('redo')");assert.equal(checkpoint(),between);
body.innerHTML=original;run('resetEditorHistory()');assert.equal(group('b','a'),true);assert.equal(group('d','c'),true);await tick();
const paired=checkpoint();assert.equal(finalPositionMove('d',2),true);await tick();assert.equal(order(),'adbc');assert.equal(body.querySelectorAll('img').length,4);assert.equal(originalParagraphs(),surrounding);assert.equal(body.querySelectorAll('figcaption em,.dwnc-image-caption em').length,4);
run("editorHistoryCommand('undo')");assert.equal(checkpoint(),paired);
assert.equal(finalPositionMove('a',3),true);await tick();assert.equal(order(),'bcad');assert.equal(body.querySelectorAll('img').length,4);assert.equal(body.querySelectorAll('figcaption em,.dwnc-image-caption em').length,4);
// Check all original/final positions in representative 1/2/3-photo rows.
for(const arrangement of [[['a','b','c']],[['b','c','d']],[['a','b'],['c','d']],[['c','d']]])for(let from=0;from<4;from++)for(let to=0;to<4;to++){
  body.innerHTML=['a','b','c','d'].map(photo).join('');run('resetEditorHistory()');
  for(const row of arrangement)for(let index=1;index<row.length;index++)assert.equal(group(row[index],row[index-1]),true);
  await tick();const prior=checkpoint(),letters=['a','b','c','d'],letter=letters.splice(from,1)[0];letters.splice(to,0,letter);
  assert.equal(finalPositionMove(letter,to+1),from!==to);await tick();assert.equal(order(),letters.join(''),JSON.stringify({arrangement,from,to}));
  assert.equal(body.querySelectorAll('figcaption em,.dwnc-image-caption em').length,4);
  if(from!==to){run("editorHistoryCommand('undo')");assert.equal(checkpoint(),prior,'One undo restores original rows');run("editorHistoryCommand('redo')");assert.equal(order(),letters.join(''))}
}
body.innerHTML=original;run('resetEditorHistory()');finalPositionMove('a',3);await tick();
body.rect={left:0,right:800,top:0,bottom:800,width:800,height:800};run('refreshDirectPhotoNumbers()');assert.equal(field('photoNumberOverlay').querySelectorAll('.photo-number-badge').length,4);assert.equal(checkpoint().includes('photo-number'),false);assert.equal(field('directPhotoNumber').textContent,'사진 3 / 4');
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const saved=sanitize(checkpoint());assert.equal(load(saved)('img').length,4);assert.equal(load(saved)('figcaption em,.dwnc-image-caption em').length,4);assert.equal(saved.includes('photo-number'),false);assert.equal(saved.includes('photoOrderPanel'),false);assert.equal(sanitize(saved),saved)}
body.innerHTML=photo('a')+'<figure data-ke-type="opengraph"><img src="card.png"></figure>'+photo('b');run('resetEditorHistory();refreshDirectPhotoNumbers()');assert.equal(field('photoNumberOverlay').querySelectorAll('.photo-number-badge').length,2,'URL card thumbnails have no photo number');
body.innerHTML=photo('b');run('resetEditorHistory();refreshDirectPhotoNumbers()');selectPhoto('b');assert.equal(field('directPhotoNumber').textContent,'사진 1 / 1');
const singlePhoto=checkpoint();for(const button of field('photoOrderList').querySelectorAll('.photo-order-slot'))button.click();assert.equal(checkpoint(),singlePhoto,'A single photo cannot move relative to itself');
body.innerHTML=photo('a')+photo('b');run('resetEditorHistory();refreshDirectPhotoNumbers()');assert.equal(field('photoNumberOverlay').querySelectorAll('.photo-number-badge').map(node=>node.textContent).join(','),'1,2');
run('busy=true');assert.equal(positionMove('a','b','after'),false);run('busy=false;editorComposing=true');assert.equal(positionMove('a','b','after'),false);run('editorComposing=false');

// Selecting a photo opens a persistent, nonmodal array. Thumbnail selection
// changes only the moving source; an explicit gap click performs the move.
const panel=field('photoOrderPanel'),list=field('photoOrderList');
assert.ok(panel);assert.equal(panel.tagName,'ASIDE');
for(const id of ['directPhotoPosition','movePhotoByNumber','openPhotoOrder','photoOrderDialog'])assert.equal(field(id),null,id+' is removed');
body.innerHTML=original;run('resetEditorHistory()');assert.equal(group('b','a'),true);await tick();selectPhoto('b');
assert.equal(panel.hidden,false,'Selecting a photo automatically shows the arrangement');
const panelBefore=checkpoint(),historyBefore=run('editorUndoStates.length');
const panelUi=adminHtml('fixture@example.test');
run(panelUi.split('\n').find(line=>line.startsWith("document.addEventListener('click',event=>{const element=")));
listeners.get('document:click')({target:field('photoOrderHeading')});assert.equal(run('selectedMedia.image'),image('b'),'Clicking the panel retains the source');
assert.equal(list.querySelectorAll('.photo-order-row').length,3);
let choices=list.querySelectorAll('.photo-order-choice');
assert.equal(choices.length,4);assert.equal(list.querySelectorAll('img').map(node=>node.getAttribute('src')).join(','),[src('a'),src('b'),src('c'),src('d')].join(','));
assert.equal(choices[1].dataset.selected,'true');
choices[3].click();assert.equal(run('selectedMedia.image'),image('d'));assert.equal(panel.hidden,false);assert.equal(checkpoint(),panelBefore);assert.equal(run('editorUndoStates.length'),historyBefore,'Choosing a source must not alter history');
const slot=(anchor,side)=>list.querySelectorAll('.photo-order-slot').find(button=>button.dataset.photoOrderAnchor===String(anchor)&&button.dataset.photoOrderSide===side);
const clickSlot=(anchor,side)=>{const button=slot(anchor,side);assert.ok(button,'Visible slot '+anchor+' '+side);assert.equal(button.disabled,false,'Available slot '+anchor+' '+side);button.click()};
clickSlot(2,'before');await tick();assert.equal(order(),'adbc');assert.equal(panel.hidden,false);assert.equal(body.querySelectorAll('.dwnc-image-layout').length,2);assert.equal(run('selectedMedia.image'),image('d'));
const panelKey=(key,options={})=>{const event={key,metaKey:true,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...options};listeners.get('photoOrderPanel:keydown')(event);return event};
const undoFromPanel=panelKey('z');assert.equal(undoFromPanel.prevented,true);assert.equal(undoFromPanel.stopped,true);assert.equal(checkpoint(),panelBefore,'One keyboard undo from the panel restores move and destination row');assert.equal(panel.hidden,true,'Undo clears the stale selected photo');
selectPhoto('b');const redoFromPanel=panelKey('z',{shiftKey:true});assert.equal(redoFromPanel.prevented,true);assert.equal(order(),'adbc');run("editorHistoryCommand('undo')");assert.equal(checkpoint(),panelBefore);
// First, last, forward and backward slots all execute with a single click.
for(const [source,anchor,side,expected] of [['d',1,'before','dabc'],['a',4,'after','bcda'],['b',4,'before','acbd'],['c',2,'before','acbd']]){
  body.innerHTML=original;run('resetEditorHistory()');selectPhoto(source);const before=checkpoint();clickSlot(anchor,side);await tick();assert.equal(order(),expected);assert.equal(originalParagraphs(),surrounding);run("editorHistoryCommand('undo')");assert.equal(checkpoint(),before);
}
// Same-group inner gaps reorder; gaps immediately adjoining the source do not.
body.innerHTML=photo('a')+photo('b')+photo('c')+photo('d');run('resetEditorHistory()');assert.equal(group('b','a'),true);assert.equal(group('c','b'),true);await tick();selectPhoto('c');const rowBefore=checkpoint();clickSlot(2,'before');await tick();assert.equal(order(),'acbd');assert.equal(body.querySelectorAll('.dwnc-image-layout').length,1);run("editorHistoryCommand('undo')");assert.equal(checkpoint(),rowBefore);
selectPhoto('b');const noOpBefore=checkpoint(),noOpHistory=run('editorUndoStates.length');const adjacent=slot(3,'before');assert.ok(adjacent);adjacent.click();await tick();assert.equal(checkpoint(),noOpBefore);assert.equal(run('editorUndoStates.length'),noOpHistory);
// At an adjacent group boundary, an outside source gets one inter-row slot.
// A source in that group additionally gets a visibly internal "same row end"
// slot; it must keep the group, unlike the next row's leading slot.
body.innerHTML=photo('a')+photo('b')+photo('c')+photo('d');run('resetEditorHistory()');assert.equal(group('b','a'),true);await tick();selectPhoto('d');
assert.equal(list.querySelectorAll('.photo-order-slot').length,5);assert.equal(slot(2,'after'),undefined,'An outside photo has no duplicate trailing group slot');assert.ok(slot(3,'before'));
const boundaryBefore=checkpoint();clickSlot(3,'before');await tick();assert.equal(order(),'abdc');assert.equal(image('d').closest('.dwnc-image-layout'),null);run("editorHistoryCommand('undo')");assert.equal(checkpoint(),boundaryBefore);
selectPhoto('a');assert.equal(list.querySelectorAll('.photo-order-slot').length,6);
const sameRowEnd=slot(2,'after');assert.equal(sameRowEnd.textContent,'같은 줄 끝');assert.equal(sameRowEnd.dataset.photoOrderPlacement,'row-end');assert.equal(sameRowEnd.parentElement.className,'photo-order-row');assert.equal(slot(3,'before').textContent,'다음 줄 앞으로 이동');
assert.equal(list.querySelectorAll('.photo-order-slot').filter(button=>button.dataset.photoOrderAnchor==='2'&&button.dataset.photoOrderSide==='after').length,1,'Same-row end appears only inside the row');
clickSlot(2,'after');await tick();assert.equal(order(),'bacd');assert.equal(image('a').closest('.dwnc-image-layout'),image('b').closest('.dwnc-image-layout'),'Same-row end preserves grouping');run("editorHistoryCommand('undo')");assert.equal(checkpoint(),boundaryBefore);
selectPhoto('a');clickSlot(3,'before');await tick();assert.equal(order(),'bacd');assert.equal(image('a').closest('.dwnc-image-layout')===image('b').closest('.dwnc-image-layout'),false,'Next-row leading slot moves the photo outside its original group');assert.equal(image('a').closest('.dwnc-image-layout').querySelectorAll('img').length,1);run("editorHistoryCommand('undo')");assert.equal(checkpoint(),boundaryBefore);
// A paragraph creates genuinely different positions, so both sides remain.
body.innerHTML=photo('a')+photo('b')+'<p>Group gap</p>'+photo('c')+photo('d');run('resetEditorHistory()');assert.equal(group('b','a'),true);await tick();selectPhoto('d');
assert.equal(list.querySelectorAll('.photo-order-slot').length,6);assert.equal(slot(2,'after').parentElement,list);assert.equal(slot(3,'before').parentElement,list);assert.equal(list.querySelectorAll('.photo-order-gap').length,1);
const groupGapBefore=checkpoint();clickSlot(2,'after');await tick();assert.equal(order(),'abdc');assert.equal(image('d').closest('figure').nextElementSibling.textContent,'Group gap');run("editorHistoryCommand('undo')");assert.equal(checkpoint(),groupGapBefore);
selectPhoto('a');assert.equal(slot(2,'after').dataset.photoOrderPlacement,'row-end');assert.equal(list.querySelectorAll('.photo-order-slot').filter(button=>button.dataset.photoOrderAnchor==='2'&&button.dataset.photoOrderSide==='after').length,1);assert.ok(slot(3,'before'));
// The document's final position stays reachable for either kind of source.
body.innerHTML=photo('a')+photo('b')+photo('c')+photo('d');run('resetEditorHistory()');assert.equal(group('d','c'),true);await tick();selectPhoto('a');
assert.equal(slot(4,'after').parentElement,list);assert.equal(slot(4,'after').dataset.photoOrderPlacement,'boundary');const finalGroupBefore=checkpoint();clickSlot(4,'after');await tick();assert.equal(order(),'bcda');assert.equal(image('a').closest('.dwnc-image-layout'),null);run("editorHistoryCommand('undo')");assert.equal(checkpoint(),finalGroupBefore);
selectPhoto('c');assert.equal(slot(4,'after').dataset.photoOrderPlacement,'row-end');assert.equal(list.querySelectorAll('.photo-order-slot').filter(button=>button.dataset.photoOrderAnchor==='4'&&button.dataset.photoOrderSide==='after').length,1);clickSlot(4,'after');await tick();assert.equal(order(),'abdc');assert.equal(image('c').closest('.dwnc-image-layout'),image('d').closest('.dwnc-image-layout'));run("editorHistoryCommand('undo')");assert.equal(checkpoint(),finalGroupBefore);
// Equal photo order can still be a different position relative to a paragraph.
body.innerHTML=photo('a')+'<p>Between photos</p>'+photo('b')+photo('c');run('resetEditorHistory()');selectPhoto('c');assert.ok(slot(1,'after'));assert.ok(slot(2,'before'));const textBefore=checkpoint();clickSlot(1,'after');await tick();assert.equal(order(),'acb');assert.equal(image('c').closest('figure').nextElementSibling.textContent,'Between photos');run("editorHistoryCommand('undo')");assert.equal(checkpoint(),textBefore);
selectPhoto('c');clickSlot(2,'before');await tick();assert.equal(order(),'acb');assert.equal(image('c').closest('figure').previousElementSibling.textContent,'Between photos');

// Reordering/source URL changes refresh live; controls remain outside saved HTML.
body.innerHTML=original;run('resetEditorHistory()');selectPhoto('a');
body.insertBefore(image('d').closest('figure'),body.children[0]);image('c').setAttribute('src','/media/native/changed.png');run('refreshDirectPhotoOrder()');
assert.equal(list.querySelectorAll('img')[0].getAttribute('src'),src('d'));assert.equal(list.querySelectorAll('img')[3].getAttribute('src'),'/media/native/changed.png');
selectPhoto('c');assert.equal(list.querySelectorAll('.photo-order-choice')[3].dataset.selected,'true','Selecting another body photo updates the source');
run('busy=true;refreshDirectPhotoOrder()');assert.ok(list.querySelectorAll('button').every(button=>button.disabled));const locked=checkpoint();context.destination=image('d');run('chooseDirectPhotoOrder(destination)');assert.equal(run('selectedMedia.image'),image('c'));assert.equal(checkpoint(),locked);run('busy=false;editorComposing=true;refreshDirectPhotoOrder()');assert.ok(list.querySelectorAll('.photo-order-slot').every(button=>button.disabled));assert.equal(positionMove('c','d','before'),false);run('editorComposing=false');
run('clearMediaSelection();refreshDirectPhotoOrder()');assert.equal(panel.hidden,true,'Clearing photo selection closes the panel');
selectPhoto('a');const staleSlot=slot(1,'before'),staleBody=checkpoint();run('current={id:"other-post"};refreshDirectPhotoOrder()');assert.equal(panel.hidden,true,'Switching posts closes the stale panel');staleSlot.click();assert.equal(checkpoint(),staleBody,'A detached old-post control cannot move current content');
run('current={id:"synthetic-photo"}');selectPhoto('a');image('a').closest('figure').remove();run('refreshDirectPhotoOrder()');assert.equal(panel.hidden,true,'Deleted sources close the panel');
body.innerHTML=photo('a')+'<figure data-ke-type="opengraph"><img src="card.png"></figure>'+photo('b');selectPhoto('a');assert.equal(list.querySelectorAll('.photo-order-choice').length,2,'Cards are excluded from the arrangement');assert.equal(checkpoint().includes('photo-order'),false);
for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const saved=sanitize(checkpoint());assert.equal(saved.includes('photoOrderPanel'),false);assert.equal(saved.includes('photo-order-slot'),false)}
selectPhoto('a');const escaped=panelKey('Escape',{metaKey:false});assert.equal(escaped.prevented,true);assert.equal(panel.hidden,true);assert.equal(document.activeElement,body,'Escape restores editor focus');
// Ordinary inline text/table structures are not split to manufacture a gap.
body.innerHTML=photo('a')+'<p>Text before <img src="'+src('b')+'" alt="b"> between <img src="'+src('c')+'" alt="c"> after</p>'+photo('d');run('resetEditorHistory()');const inlineBefore=checkpoint();assert.equal(positionMove('a','c','before'),false);assert.equal(positionMove('d','b','after'),false);assert.equal(checkpoint(),inlineBefore);

// Long-distance moving preserves the source node. The follow-up defect is a
// stale body viewport, not a transfer of selection to photo 41. Model document
// positions so moving photo 40 to photo 18 also moves its measured rectangle.
const longNumbers=Array.from({length:41},(_,index)=>index+1);
const longPhotos=longNumbers.map(number=>'<figure class="imageblock"><img src="/media/native/123e4567-e89b-42d3-a456-426614175'+String(number).padStart(3,'0')+'.png" alt="synthetic-'+number+'"><figcaption><em>caption '+number+'</em></figcaption></figure>').join('');
const longOrder=()=>body.querySelectorAll('img').map(node=>Number(node.getAttribute('alt').split('-').at(-1)));
const measureLongPhotos=(height=500)=>{
  for(const item of body.querySelectorAll('img')){
    const measure=()=>{const top=body.querySelectorAll('img').indexOf(item)*600-context.window.scrollY;return{left:30,right:650,width:620,top,bottom:top+height,height}};
    item.measureRect=measure;item.closest('figure').measureRect=measure;
  }
};
const resetLongPhotos=()=>{
  run('clearMediaSelection()');body.innerHTML=longPhotos;run('resetEditorHistory()');
  context.window.innerWidth=1200;context.window.innerHeight=900;context.window.scrollY=39*600-160;
  field('editorHeader').rect={left:0,right:1200,top:0,bottom:80,width:1200,height:80};field('editorFooter').hidden=false;field('editorFooter').rect={left:0,right:1200,top:820,bottom:900,width:1200,height:80};
  panel.rect={left:868,right:1188,top:88,bottom:812,width:320,height:724};measureLongPhotos();scrollRequests.length=0;
};
for(const side of ['before','after']){
  resetLongPhotos();selectPhoto('synthetic-40');const source40=image('synthetic-40'),last41=image('synthetic-41'),beforeMove=checkpoint();list.scrollTop=2400;
  run('refreshDirectPhotoOrder();refreshDirectPhotoNumbers();updateDirectPhotoTools();positionDirectPhotoOrder()');assert.equal(scrollRequests.length,0,'Passive refresh and ordinary selection do not reposition the body');
  if(side==='before')clickSlot(18,side);else assert.equal(positionMove('synthetic-40','synthetic-18',side),true);
  await tick();const expected=longNumbers.filter(number=>number!==40);expected.splice(side==='before'?17:18,0,40);
  assert.deepEqual(longOrder(),expected);assert.equal(run('selectedMedia.image')===source40,true,'The moved DOM image remains selected');assert.equal(run('selectedMedia.image')===last41,false,'The last photo never becomes the source');
  assert.equal(field('directPhotoNumber').textContent,'사진 '+(side==='before'?18:19)+' / 41');assert.equal(list.querySelectorAll('.photo-order-choice').filter(button=>button.dataset.selected==='true').length,1);assert.equal(list.querySelectorAll('.photo-order-choice').find(button=>button.dataset.selected==='true').photoOrderImage===source40,true);
  assert.equal(list.scrollTop,2400,'Revealing the moved body photo retains the array scroll position');assert.equal(scrollRequests.length,1,'A successful distant move repositions the body once');assert.equal(scrollRequests[0].method,'scrollBy');assert.ok(scrollRequests[0].args[1]<0);const visible=source40.getBoundingClientRect();assert.ok(visible.top>=80&&visible.bottom<=820,'The selected photo enters the usable body viewport');
  const movedBody=checkpoint(),requestsAfterMove=scrollRequests.length;run('refreshDirectPhotoOrder();refreshDirectPhotoNumbers();updateDirectPhotoTools()');assert.equal(scrollRequests.length,requestsAfterMove,'Later selection/number refresh must not pull the reader back');
  run("editorHistoryCommand('undo')");assert.equal(checkpoint(),beforeMove);assert.deepEqual(longOrder(),longNumbers);run("editorHistoryCommand('redo')");assert.equal(checkpoint(),movedBody);assert.deepEqual(longOrder(),expected);assert.equal(scrollRequests.length,requestsAfterMove,'History restore does not initiate another source jump');
}
resetLongPhotos();selectPhoto('synthetic-40');const beforeChoice=checkpoint(),choiceHistory=run('editorUndoStates.length');
list.querySelectorAll('.photo-order-choice')[17].click();assert.equal(run('selectedMedia.image')===image('synthetic-18'),true);assert.equal(checkpoint(),beforeChoice);assert.equal(run('editorUndoStates.length'),choiceHistory);assert.equal(scrollRequests.length,1,'An explicit distant thumbnail choice reveals its source');assert.ok(image('synthetic-18').getBoundingClientRect().top>=80);
// Busy, composition, no-op and invalid targets must not move either the body
// or its viewport. A normal refresh must also permit manual reading elsewhere.
context.window.scrollY=39*600-160;scrollRequests.length=0;
assert.equal(positionMove('synthetic-18','synthetic-18','before'),false);assert.equal(positionMove('synthetic-18','synthetic-19','before'),false);assert.equal(positionMove('synthetic-18','synthetic-19','invalid'),false);
run('busy=true');assert.equal(positionMove('synthetic-18','synthetic-20','before'),false);context.destination=image('synthetic-20');run('chooseDirectPhotoOrder(destination)');run('busy=false;editorComposing=true');assert.equal(positionMove('synthetic-18','synthetic-20','before'),false);run('chooseDirectPhotoOrder(destination);editorComposing=false;refreshDirectPhotoOrder();refreshDirectPhotoNumbers()');assert.equal(scrollRequests.length,0);assert.equal(checkpoint(),beforeChoice);assert.equal(run('selectedMedia.image')===image('synthetic-18'),true);
// On compact screens, the array and footer reduce the available photo area.
context.window.innerWidth=390;panel.rect={left:12,right:378,top:520,bottom:812,width:366,height:292};measureLongPhotos(180);context.destination=image('synthetic-20');run('chooseDirectPhotoOrder(destination)');const compactPhoto=image('synthetic-20').getBoundingClientRect();assert.ok(compactPhoto.top>=80&&compactPhoto.bottom<=520,'Explicit selection fits above the compact panel');assert.equal(scrollRequests.length,1);
run('clearMediaSelection()');context.window.innerWidth=1000;context.window.scrollY=0;field('editorHeader').rect={left:0,right:1000,top:0,bottom:0,width:1000,height:0};field('editorFooter').hidden=true;
console.log(JSON.stringify({suite:'photo-order-panel',status:'PASS',behavior:'automatic nonmodal array, real rows, source thumbnail selection, click slots at first/last/inner positions, paragraph boundary distinction, one-step undo, live refresh, busy/IME and post/deletion guards, card exclusion and external UI'}));
console.log(JSON.stringify({suite:'photo-order-source-visibility',status:'PASS',behavior:'41-photo distant moves retain photo 40 identity, source/number agreement, explicit move/thumbnail reveal only, desktop/compact viewport, passive refresh/no-op/busy/composition preservation, undo/redo'}));
console.log(JSON.stringify({suite:'image-direct',status:'PASS',behavior:'move/group/reorder/split, cap at three, captions and text preserved, shared undo/redo, sanitizer reopen, no-upscale, photo margin text insertion/reuse/caret, anchor positions, atomic row split and external labels'}));

// A foreign paragraph in an imported/hand-authored layout must never be erased
// by extracting its final image.
body.innerHTML='<div class="dwnc-image-layout"><div class="dwnc-image-item">'+photo('a')+'</div><p>그룹 안 별도 본문 보존</p></div>'+photo('b');run('resetEditorHistory()');const foreignBody=checkpoint();assert.equal(group('a','b'),false);assert.equal(checkpoint(),foreignBody);

// Exercise the real deletion entry points, including immediate history flushes.
const ui=adminHtml('fixture@example.test');
run(ui.slice(ui.indexOf('function deleteSelectedMedia'),ui.indexOf('function fill(')));
run("function selectMedia(image){selectedMedia={image,node:image.closest('figure.imageblock')||image,kind:'image'}}function placeCaret(parent,next){caretParent=parent;caretNext=next}let caretParent=null,caretNext=null;");
run(ui.split('\n').find(line=>line.startsWith("$('bodyHtml').addEventListener('keydown',event=>{if(selectedMedia")));
run(ui.split('\n').find(line=>line.startsWith("$('deleteImage').onclick=")));
body.innerHTML='<p>Before</p>'+photo('a')+photo('b')+photo('c')+'<p>After</p>';run('resetEditorHistory()');assert.equal(group('b','a'),true);assert.equal(group('c','a'),true);await tick();
const deletionStates=[checkpoint()];
for(const [index,letter] of ['a','b','c'].entries()){
  context.selected=image(letter);run('selectMedia(selected)');
  if(index===0)field('deleteImage').onclick();else{const event={key:index===1?'Backspace':'Delete',preventDefault(){this.prevented=true}};listeners.get('bodyHtml:keydown')(event);assert.equal(event.prevented,true)}
  await tick();const remaining=2-index,row=body.querySelector('.dwnc-image-layout');
  assert.equal(body.querySelectorAll('img').length,remaining);assert.equal(body.querySelectorAll('.dwnc-image-item').length,remaining);
  assert.equal(body.querySelectorAll('.dwnc-image-caption').length,1,'Deleting the final photo must retain the shared description');
  assert.equal(body.querySelectorAll('.dwnc-image-caption em').length,3);
  assert.equal(run('caretParent'),body,'Typing resumes outside the surviving group or caption');
  if(remaining===2){assert.equal(row.classList.contains('dwnc-image-cols-2'),true);assert.equal(row.classList.contains('dwnc-image-cols-3'),false);assert.equal(row.style.getPropertyValue('--dwnc-image-columns').split(' ').length,2)}
  if(remaining===1){assert.equal(row.classList.contains('dwnc-image-cols-2'),false);assert.equal(row.style.getPropertyValue('--dwnc-image-columns'),'');assert.equal(row.style.getPropertyValue('--dwnc-original-layout-width'),'1200px')}
  if(!remaining)assert.equal(row,null);
  const after=checkpoint();run("editorHistoryCommand('undo')");assert.equal(checkpoint(),deletionStates.at(-1));run("editorHistoryCommand('redo')");assert.equal(checkpoint(),after);deletionStates.push(after);
  for(const sanitize of [sanitizeNativeHtml,sanitizeLegacyHtml]){const clean=sanitize(after),saved=load(clean);assert.equal(saved('img').length,remaining);assert.equal(saved('.dwnc-image-item').length,remaining);assert.equal(saved('.dwnc-image-caption em').length,3);assert.equal(sanitize(clean),clean)}
}
// Old saved rows can already contain a blank cell and stale two/three-column
// weights. Reopen/preview/public use this same non-writing projection helper.
const damaged='<p>Before</p><div class="dwnc-image-layout dwnc-image-original dwnc-image-cols-3" style="--dwnc-original-layout-width:1200px;--dwnc-image-columns:1fr 2fr 1fr"><div class="dwnc-image-item"><figure><br></figure></div><div class="dwnc-image-item">'+photo('d')+'</div><div class="dwnc-image-item"></div><div class="dwnc-image-caption"><em>보존 설명</em></div></div><p>After</p>';
body.innerHTML=damaged;run("refreshImageGroups($('bodyHtml'))");const healed=checkpoint(),healedRow=body.querySelector('.dwnc-image-layout');assert.equal(body.querySelectorAll('.dwnc-image-item').length,1);assert.equal(body.querySelectorAll('.dwnc-image-cols-2,.dwnc-image-cols-3').length,0);assert.equal(healedRow.style.getPropertyValue('--dwnc-image-columns'),'');assert.equal(healedRow.style.getPropertyValue('--dwnc-original-layout-width'),'400px');assert.equal(body.querySelector('.dwnc-image-caption em').textContent,'보존 설명');run("refreshImageGroups($('bodyHtml'))");assert.equal(checkpoint(),healed,'Reopen projection is idempotent');
body.innerHTML='<div class="dwnc-image-layout dwnc-image-cols-2"><div class="dwnc-image-item"><p>보존할 본문</p></div><div class="dwnc-image-item"></div><div class="dwnc-image-caption" style="text-align:right"><em>사진 없는 설명</em></div></div>';run("refreshImageGroups($('bodyHtml'))");assert.equal(body.querySelector('.dwnc-image-layout'),null);assert.equal(body.querySelector('p').textContent,'보존할 본문');assert.equal(body.querySelector('.dwnc-image-caption').style.getPropertyValue('text-align'),'right');
console.log(JSON.stringify({suite:'image-group-deletion',status:'PASS',behavior:'button/Backspace/Delete 3→2→1→0, shared captions and rich markup kept, exact undo/redo, sanitizer/reopen, stale empty-cell repair and no-upscale width'}));


// File information is read-only UI. Metadata races cannot cross post boundaries,
// and newly uploaded files remain known when an older inventory request ends.
const metadataRequests=[];
context.api=path=>new Promise((resolve,reject)=>metadataRequests.push({path,resolve,reject}));
body.innerHTML=photo('a')+photo('b');run("current={id:'metadata-post'};resetEditorHistory();clearMediaSelection()");
const metadataBody=checkpoint(),metadataHistory=run('editorUndoStates.length');
const metadataLoad=run('loadDirectPhotoMetadata(current.id)');
assert.equal(metadataRequests.at(-1).path,'/posts/metadata-post/media');
context.infoImage=image('a');assert.equal(run('directPhotoFileInfo(infoImage).size'),'용량 확인 중');
assert.equal(run('directPhotoFileInfo(infoImage).dimensions'),'1400 × 1050 px','Intrinsic pixels do not use HTML width/height styles');
metadataRequests.at(-1).resolve({media:[{path:src('a'),bytes:2500000,mime:'image/png'},{path:src('b'),bytes:1500,mime:'image/png'}]});await metadataLoad;
assert.equal(run('directPhotoFileInfo(infoImage).size'),'2.5 MB');assert.equal(run('directPhotoFileInfo(infoImage).title'),'1400 × 1050 px · 저장 파일 2,500,000 바이트');
context.infoImage=image('b');assert.equal(run('directPhotoFileInfo(infoImage).size'),'1.5 KB');
run('refreshDirectPhotoNumbers()');assert.equal(field('photoNumberOverlay').querySelectorAll('.photo-file-info').length,2);assert.equal(checkpoint(),metadataBody);assert.equal(run('editorUndoStates.length'),metadataHistory);assert.equal(checkpoint().includes('photo-file-info'),false);
// A mobile grouped row retains each photo's number selection. Per-photo
// summary panels are hidden in favor of the single current-photo information bar.
const beforeNarrow=checkpoint(),previousWidth=context.window.innerWidth;
context.window.innerWidth=390;
const originalRectA=image('a').rect,originalRectB=image('b').rect;
image('a').rect={left:20,right:98,top:160,bottom:254,width:78,height:94};
image('b').rect={left:102,right:222,top:160,bottom:254,width:120,height:94};
run('refreshDirectPhotoNumbers()');
let mobileMarkers=field('photoNumberOverlay').querySelectorAll('.photo-number-marker');
const narrowInfo=mobileMarkers[0].querySelector('.photo-info-panel'),nextInfo=mobileMarkers[1].querySelector('.photo-info-panel');
assert.equal(mobileMarkers[0].style.width,'44px');assert.equal(narrowInfo.style.width,'66px');
assert.ok(parseFloat(narrowInfo.style.left)+66<=image('a').rect.right);
assert.ok(parseFloat(narrowInfo.style.left)+66<parseFloat(nextInfo.style.left),'Adjacent summaries stay within their own photo width');
assert.ok(parseFloat(narrowInfo.style.top)+44<=image('a').rect.top,'A narrow photo summary sits above the photo and its left-hand number');
assert.ok(parseFloat(mobileMarkers[0].style.top)>=image('a').rect.top);
assert.match(imageDirectCss,/\.photo-info-panel\{[^}]*background:transparent/);assert.match(imageDirectCss,/text-shadow:[^;]*rgb\(0 0 0 \/ 95%\)/);assert.equal(imageDirectCss.includes('backdrop-filter'),false);
assert.match(imageDirectCss,/photo-file-info\{[^}]*min-width:44px;min-height:44px/);assert.match(imageDirectCss,/font:14px\/1.5 system-ui/);assert.match(imageDirectCss,/\.photo-file-info span\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/,'A narrow desktop photo keeps two readable-size single lines without clipping extra wrapped rows');assert.equal(imageDirectCss.includes('font-size:9px'),false);assert.match(imageDirectCss,/@media\(max-width:767px\)\{\.editor-header\{flex-wrap:wrap\}\.photo-info-panel\{display:none\}\}/);assert.equal(field('photoMobileInfo').hidden,false);assert.ok(field('photoMobileInfo').textContent.includes(' / '));
mobileMarkers[0].querySelector('.photo-number-badge').click();assert.equal(run('selectedMedia.image'),image('a'),'The narrow photo number still selects that exact image');
assert.equal(checkpoint(),beforeNarrow);
image('a').rect=originalRectA;image('b').rect=originalRectB;context.window.innerWidth=previousWidth;run('clearMediaSelection();refreshDirectPhotoNumbers()');
assert.equal(run("directPhotoMediaPath('https://admin.dwnc.me"+src('a')+"?v=2#photo')"),src('a'));
assert.equal(run("directPhotoMediaPath('https://example.test"+src('a')+"')"),null);assert.equal(run("directPhotoMediaPath('media/native/example.png')"),null);
context.window.location={origin:'http://127.0.0.1:4322'};assert.equal(run("directPhotoMediaPath('http://127.0.0.1:4322"+src('a')+"')"),src('a'),'The same local fixture origin must not retain its port when canonicalized');delete context.window.location;
image('b').currentSrc='https://outside.test'+src('a');assert.equal(run('directPhotoFileInfo(infoImage).size'),'용량 미확인','An external alias cannot inherit local bytes');delete image('b').currentSrc;
context.infoImage=image('a');image('a').currentSrc='/media/native/diagram.svg';context.vector={path:'/media/native/diagram.svg',bytes:901,mime:'image/svg+xml'};run('rememberDirectPhotoMetadata(current.id,vector)');assert.equal(run('directPhotoFileInfo(infoImage).dimensions'),'벡터 이미지');delete image('a').currentSrc;
// A pending/rejected metadata read never invents zero bytes.
const failedLoad=run('loadDirectPhotoMetadata(current.id)');metadataRequests.at(-1).reject(new Error('read failed'));await failedLoad;assert.equal(run('directPhotoFileInfo(infoImage).size'),'용량 미확인');
context.uploaded={publicPath:src('a'),bytes:98765,mime:'image/png'};
const racingLoad=run('loadDirectPhotoMetadata(current.id)');run('rememberDirectPhotoMetadata(current.id,uploaded)');assert.equal(run('directPhotoFileInfo(infoImage).size'),'98.77 KB');metadataRequests.at(-1).resolve({media:[]});await racingLoad;assert.equal(run('directPhotoFileInfo(infoImage).size'),'98.77 KB');
// Undo recreates image nodes, so file lookups remain path-based.
context.selected=image('a');run('selectMedia(selected);deleteSelectedMedia()');await tick();run("editorHistoryCommand('undo')");context.infoImage=image('a');assert.equal(run('directPhotoFileInfo(infoImage).size'),'98.77 KB');assert.equal(checkpoint(),metadataBody);
const oldPostLoad=run('loadDirectPhotoMetadata(current.id)'),oldRequest=metadataRequests.at(-1);run("current={id:'next-metadata-post'}");const nextPostLoad=run('loadDirectPhotoMetadata(current.id)');metadataRequests.at(-1).resolve({media:[{path:src('a'),bytes:2222,mime:'image/png'}]});await nextPostLoad;oldRequest.resolve({media:[{path:src('a'),bytes:999999,mime:'image/png'}]});await oldPostLoad;assert.equal(run('directPhotoFileInfo(infoImage).size'),'2.22 KB');
const earlierLoad=run('loadDirectPhotoMetadata(current.id)'),earlierRequest=metadataRequests.at(-1),latestLoad=run('loadDirectPhotoMetadata(current.id)');metadataRequests.at(-1).resolve({media:[{path:src('a'),bytes:3333,mime:'image/png'}]});await latestLoad;earlierRequest.resolve({media:[{path:src('a'),bytes:1111,mime:'image/png'}]});await earlierLoad;assert.equal(run('directPhotoFileInfo(infoImage).size'),'3.33 KB');
assert.ok(ui.includes('void loadDirectPhotoMetadata(p.id)'));assert.ok(ui.includes('rememberDirectPhotoMetadata(postId,j.media)'));assert.ok(listeners.has('bodyHtml:error'));
console.log(JSON.stringify({suite:'photo-file-info',status:'PASS',behavior:'intrinsic pixels and saved bytes, shared decimal units, external/unknown/vector handling, read-only overlay, upload/read race, cross-post and same-post stale responses, deletion undo and image load/error refresh'}));


// Detailed metadata is fetched only for a clicked photo, without replacing the
// selected moving source or changing the saved body/history.
const detailRequests=[];context.api=(path,options)=>new Promise((resolve,reject)=>detailRequests.push({path,options,resolve,reject}));
body.innerHTML=photo('a')+photo('b');for(const letter of ['a','b'])image(letter).rect={left:100,right:900,top:160,bottom:660,width:800,height:500};run("current={id:'photo-detail'};photoMetadataOwner=current.id;photoMetadataByPath=new Map();photoFileDetailsByPath=new Map();resetEditorHistory()");context.selected=image('b');run('selectMedia(selected)');context.infoImage=image('a');const detailBody=checkpoint(),detailHistory=run('editorUndoStates.length');
const detailLoad=run('openDirectPhotoInfo(infoImage,null)');assert.equal(field('photoInfoDialog').open,true);assert.equal(detailRequests.at(-1).path,'/posts/photo-detail/media-info');assert.equal(detailRequests.at(-1).options.method,'POST');assert.equal(JSON.parse(detailRequests.at(-1).options.body).path,src('a'));assert.equal(run('selectedMedia.image'),image('b'));
detailRequests.at(-1).resolve({info:{format:'JPEG',bytes:456789,width:2560,height:1928,colorSpace:'Display P3',profileName:'Display P3',hdr:'metadata-present',metadataComplete:true}});await detailLoad;
const detailsText=()=>field('photoInfoDetails').textContent;
assert.equal(field('photoInfoDetails').querySelectorAll('.photo-info-row').length,6);assert.ok(field('photoInfoDetails').children.every(row=>row.children.map(node=>node.tagName).join(',')==='DT,DD'),'Each detail row keeps its term/value pair together');assert.ok(detailsText().includes('2560 × 1928 px'));assert.ok(detailsText().includes('456.79 KB (456,789 바이트)'));assert.ok(detailsText().includes('Display P3'));assert.ok(detailsText().includes('실제 HDR 지원 여부 미확인'));assert.equal(checkpoint(),detailBody);assert.equal(run('editorUndoStates.length'),detailHistory);
field('photoInfoDialog').close();const cachedRequests=detailRequests.length;await run('openDirectPhotoInfo(infoImage,null)');assert.equal(detailRequests.length,cachedRequests,'Reopening the same stored file uses the result cache');field('photoInfoDialog').close();
context.infoImage=image('b');const partialLoad=run('openDirectPhotoInfo(infoImage,null)');detailRequests.at(-1).resolve({info:{format:'PNG',bytes:3333,width:null,height:null,colorSpace:null,profileName:null,hdr:'unknown',metadataComplete:false}});await partialLoad;assert.ok(detailsText().includes('색영역미확인'));assert.ok(detailsText().includes('HDR 정보확인 불가'));assert.match(field('photoInfoStatus').textContent,/이 파일에서 일부 정보/);field('photoInfoDialog').close();
run('photoFileDetailsByPath=new Map()');const lateDetails=run('openDirectPhotoInfo(infoImage,null)'),lateRequest=detailRequests.at(-1);field('photoInfoDialog').close();context.infoImage=image('a');const currentDetails=run('openDirectPhotoInfo(infoImage,null)');detailRequests.at(-1).resolve({info:{format:'JPEG',bytes:3333,width:1400,height:1050,colorSpace:'sRGB',profileName:null,hdr:'not-indicated',metadataComplete:true}});await currentDetails;lateRequest.resolve({info:{format:'PNG',bytes:1,width:1,height:1,colorSpace:'Rec.2020',profileName:null,hdr:'metadata-present',metadataComplete:true}});await lateDetails;assert.ok(detailsText().includes('색영역sRGB'));assert.equal(detailsText().includes('Rec.2020'),false);assert.ok(detailsText().includes('SDR 여부는 미확인'));field('photoInfoDialog').close();
image('a').currentSrc='https://outside.test/photo.jpg';const externalRequests=detailRequests.length;await run('openDirectPhotoInfo(infoImage,null)');assert.equal(detailRequests.length,externalRequests,'External sources are never downloaded for metadata');assert.match(field('photoInfoStatus').textContent,/외부 사진/);field('photoInfoDialog').close();delete image('a').currentSrc;
run('refreshDirectPhotoNumbers()');assert.equal(field('photoNumberOverlay').querySelectorAll('.photo-file-info').length,2);assert.equal(checkpoint().includes('photoInfoDialog'),false);
console.log(JSON.stringify({suite:'photo-file-details',status:'PASS',behavior:'explicit single-photo request, cached details, stored dimensions/bytes/format, declared color and HDR wording, incomplete metadata, stale response, unchanged source/history/body and no external fetch'}));

// The visible pixels/bytes themselves open a nonmodal edge tooltip. Keep the
// actual trigger node through overlay refreshes and a pending metadata request.
const hoverRequests=[];context.api=(path,options)=>new Promise((resolve,reject)=>hoverRequests.push({path,options,resolve,reject}));
body.innerHTML=photo('a')+photo('b');run("current={id:'hover-details'};photoMetadataOwner=current.id;photoMetadataByPath=new Map();photoFileDetailsByPath=new Map();photoFilePendingByPath=new Map();resetEditorHistory()");
image('a').rect={left:100,right:700,top:150,bottom:650,width:600,height:500};image('b').rect={left:100,right:700,top:660,bottom:860,width:600,height:200};
context.window.innerWidth=1000;context.window.innerHeight=900;document.activeElement=body;
context.selected=image('b');run('selectMedia(selected);refreshDirectPhotoNumbers()');
const hoverBody=checkpoint(),hoverHistory=run('editorUndoStates.length'),hoverDialog=field('photoInfoDialog');hoverDialog.rect={left:0,right:320,top:0,bottom:260,width:320,height:260};hoverDialog.showModal=()=>assert.fail('Photo details must never show a modal');
Object.defineProperty(hoverDialog,'scrollHeight',{get(){assert.equal(this.parentElement.style.width,Math.min(440,context.window.innerWidth-16)+'px','The current expanded width is applied before measuring the detail height');return 260}});
const infoTrigger=letter=>field('photoNumberOverlay').querySelectorAll('.photo-file-info').find(node=>node.photoInfoImage===image(letter));
const trigger=infoTrigger('a');trigger.rect={left:150,right:310,top:160,bottom:204,width:160,height:44};
assert.match(trigger.textContent,/1400×1050px/);assert.equal(field('photoNumberOverlay').querySelectorAll('.photo-file-info-button').length,0);assert.equal(trigger.textContent.includes('사진 정보'),false);
trigger.listeners.get('pointerenter')({pointerType:'mouse'});assert.equal(hoverDialog.open,true);assert.equal(hoverRequests.length,1);assert.equal(document.activeElement,body,'Hover must not steal editor focus');assert.equal(run('selectedMedia.image'),image('b'));
const firstRequest=hoverRequests[0];run('refreshDirectPhotoNumbers()');assert.equal(infoTrigger('a'),trigger,'Refreshing metadata reuses the live hover/focus trigger');
trigger.focus();trigger.listeners.get('focus')();assert.equal(hoverRequests.length,1,'Focus and hover share an in-flight read');run('refreshDirectPhotoNumbers()');assert.equal(document.activeElement,trigger);
const escapeInfo=(extra={})=>{const event={key:'Escape',...extra,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};listeners.get('document:keydown')(event);return event};
run('editorComposing=true');assert.equal(escapeInfo().stopped,undefined);run('editorComposing=false');assert.equal(escapeInfo({isComposing:true}).prevented,undefined);assert.equal(escapeInfo({keyCode:229}).prevented,undefined);assert.equal(hoverDialog.open,true,'An IME cancel key belongs to composition');assert.equal(escapeInfo().stopped,true);assert.equal(hoverDialog.open,false);assert.equal(run('selectedMedia.image'),image('b'),'Closing photo details preserves the moving selection');trigger.listeners.get('focus')();assert.equal(hoverDialog.open,false,'Escape suppresses immediate reopening from the same focus');
trigger.listeners.get('pointerenter')({pointerType:'mouse'});assert.equal(hoverDialog.open,true);assert.equal(hoverRequests.length,1,'Reentering while the read is pending does not download it again');
firstRequest.resolve({info:{format:'JPEG',bytes:9876,width:1400,height:1050,colorSpace:'sRGB',profileName:null,hdr:'not-indicated',metadataComplete:true}});await tick();assert.match(detailsText(),/sRGB/);assert.equal(trigger.getAttribute('aria-expanded'),'true');
const popupRect=()=>{const panel=trigger.parentElement;return{left:parseFloat(panel.style.left),top:parseFloat(panel.style.top),width:parseFloat(panel.style.width),height:parseFloat(panel.style.height)}};
const assertInfoReadable=()=>{const popup=popupRect(),top=Math.max(8,field('editorHeader').rect.bottom+6),bottom=field('editorFooter').hidden?context.window.innerHeight-8:field('editorFooter').rect.top-6;assert.ok(popup.left>=8&&popup.top>=top&&popup.left+popup.width<=context.window.innerWidth-8&&popup.top+popup.height<=bottom);const bubble=trigger.parentElement.dataset.presentation==='bubble',tail=bubble?8:0,anchor=Math.min(Math.max(image('a').rect.top+6,top),Math.max(top,Math.min(bottom,image('a').rect.bottom-6))),down=trigger.parentElement.dataset.direction==='down',space=bubble?(down?bottom-anchor:anchor-top):bottom-top;assert.equal(popup.height,Math.min(hoverDialog.scrollHeight+tail,space),'Details fit the actual-photo anchor space, otherwise scroll within the popup');if(bubble)assert.equal(down?popup.top:popup.top+popup.height,anchor,'The speech tail points to the current photo rather than the tool-avoiding summary');assert.equal(parseFloat(hoverDialog.style.maxHeight),popup.height-tail);const tailLeft=parseFloat(trigger.parentElement.style.getPropertyValue('--photo-tail-left'));assert.ok(tailLeft>=16&&tailLeft<=popup.width-16,'The speech tail stays inside the popup width');};
assertInfoReadable();
const expandingPanel=trigger.parentElement;
assert.equal(hoverDialog.parentElement,expandingPanel);assert.equal(expandingPanel.dataset.expanded,'true');assert.equal(expandingPanel.dataset.presentation,'overlay','A large photo retains the background-free information overlay');image('a').rect={...image('a').rect,bottom:330,height:180};run('refreshDirectPhotoNumbers()');assert.equal(expandingPanel.dataset.presentation,'bubble','A wide but short photo uses the readable speech popup too');assertInfoReadable();image('a').rect={...image('a').rect,bottom:650,height:500};run('refreshDirectPhotoNumbers()');assert.equal(expandingPanel.dataset.presentation,'overlay','Restoring photo space restores the ordinary overlay');
assert.equal(trigger.listeners.has('pointerleave'),false,'The whole expanding area owns hover leave');
expandingPanel.listeners.get('pointerleave')({relatedTarget:expandingPanel});hoverDialog.listeners.get('pointerleave')({relatedTarget:expandingPanel});flushInfoTimers();assert.equal(hoverDialog.open,true,'Crossing into the expanded background keeps one continuous area open');
assert.match(imageDirectCss,/body:has\(#photoInfoDialog\[open\]\):not\(:has\(dialog\[open\]:not\(#photoInfoDialog\)\)\)\{overflow:visible\}/,'A photo expansion must not apply the other dialogs’ document scroll lock');
assert.match(imageDirectCss,/\.photo-info-panel \.photo-file-info\{[^}]*background:transparent/,'The summary background rule has enough specificity to override the shared button:hover background');
// Mouse may cross the small gap and read the tooltip; leaving both closes it.
document.activeElement=body;trigger.parentElement.listeners.get('pointerleave')({relatedTarget:null});hoverDialog.listeners.get('pointerenter')();flushInfoTimers();assert.equal(hoverDialog.open,true);hoverDialog.listeners.get('pointerleave')({relatedTarget:null});flushInfoTimers();assert.equal(hoverDialog.open,false);
trigger.listeners.get('pointerenter')({pointerType:'touch'});assert.equal(hoverDialog.open,false,'Touch hover is ignored');trigger.click();assert.equal(hoverDialog.open,true);trigger.click();assert.equal(hoverDialog.open,false,'Touch/click on the same metadata toggles the tooltip');
trigger.click();listeners.get('document:pointerdown')({target:body});assert.equal(hoverDialog.open,false,'Outside pointer closes without changing content or selection');assert.equal(hoverDialog.parentElement,field('photoInfoHost'),'Closed details return to the hidden shared host');
// A tall photo still allows every row when the usable screen is tall enough.
context.window.innerWidth=800;context.window.innerHeight=720;image('a').rect={left:12,right:378,top:70,bottom:970,width:366,height:900};trigger.rect={left:62,right:202,top:76,bottom:120,width:140,height:44};trigger.click();assertInfoReadable();assert.ok(parseFloat(trigger.parentElement.style.height)<720);assert.equal(hoverDialog.parentElement,trigger.parentElement,'Summary and details share the same expanding panel');
context.window.innerHeight=260;run('positionDirectPhotoInfo()');assertInfoReadable();assert.ok(parseFloat(hoverDialog.style.maxHeight)<hoverDialog.scrollHeight,'Only a short usable screen requires scrolling inside the details');context.window.innerHeight=720;run('positionDirectPhotoInfo()');assertInfoReadable();assert.equal(parseFloat(hoverDialog.style.maxHeight),hoverDialog.scrollHeight,'A taller screen restores the full detail height');
// Small grouped photos retain pixels and bytes, and their complete details.
image('a').rect={left:20,right:98,top:160,bottom:254,width:78,height:94};image('b').rect={left:102,right:222,top:160,bottom:254,width:120,height:94};run('refreshDirectPhotoNumbers()');assert.equal(infoTrigger('a'),trigger);assert.equal(trigger.textContent,'ⓘ 정보');assert.match(trigger.getAttribute('aria-label'),/1400 × 1050 px/);assert.match(trigger.getAttribute('aria-label'),/9.88 KB/);assert.equal(trigger.parentElement.dataset.presentation,'bubble');assert.ok(parseFloat(trigger.parentElement.style.width)>image('a').rect.width,'Small grouped photos keep a readable popup wider than their individual photo');assertInfoReadable();
trigger.listeners.get('blur')({relatedTarget:field('closePhotoInfo')});assert.equal(hoverDialog.open,true);hoverDialog.listeners.get('focusout')({relatedTarget:body});assert.equal(hoverDialog.open,false);
trigger.click();run('busy=true;refreshDirectPhotoNumbers()');assert.equal(hoverDialog.open,false,'Busy operations close the tooltip');run('busy=false;refreshDirectPhotoNumbers()');trigger.click();image('a').rect.top=-20;image('a').rect.bottom=74;run('refreshDirectPhotoNumbers()');assert.equal(hoverDialog.open,true,'A bubble follows the still-visible photo even when its collapsed summary would be above the viewport');assertInfoReadable();image('a').rect.bottom=0;run('positionDirectPhotoInfo()');assert.equal(hoverDialog.open,false,'A bubble closes once its photo is fully offscreen');
assert.equal(checkpoint(),hoverBody);assert.equal(run('editorUndoStates.length'),hoverHistory);assert.equal(run('selectedMedia.image'),image('b'));assert.equal(hoverRequests.length,1);
// The former mobile summary geometry also exercises grouped desktop photos: the narrow
// summary's center hit the selected-photo Delete button underneath it.
field('editorHeader').rect={left:0,right:390,top:0,bottom:102,width:390,height:102};
image('a').rect={left:20,right:91.85,top:374.27,bottom:470.07,width:71.85,height:95.8};
image('b').rect={left:102,right:222,top:374.27,bottom:470.07,width:120,height:95.8};
const imageTools=field('imageTools');imageTools.hidden=false;imageTools.rect={left:12,right:378,top:192.27,bottom:366.27,width:366,height:174};
panel.hidden=false;panel.rect={left:12,right:378,top:490,bottom:710,width:366,height:220};list.scrollTop=67;
context.selected=image('a');run('selectMedia(selected);refreshDirectPhotoNumbers()');
const collisionBody=checkpoint(),collisionHistory=run('editorUndoStates.length'),collisionScroll=context.window.scrollY;
const containsPoint=(rect,x,y)=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;
const realHit=(x,y)=>document.body.dataset.photoInfo!=='open'&&containsPoint(imageTools.rect,x,y)?field('deleteImage'):containsPoint(trigger.parentElement.photoBaseRect,x,y)?trigger:null;
assert.equal(realHit(55.925,350.27)===field('deleteImage'),true,'The original reported summary center really intersects Delete');
const safeAnchor={...trigger.parentElement.photoBaseRect};
assert.ok(safeAnchor.bottom<=imageTools.rect.top-6,'The collapsed summary must be above the actual toolbar hit region');
assert.ok(safeAnchor.top>=field('editorHeader').rect.bottom+6,'The safe summary remains below the fixed header');
const actualTarget=realHit((safeAnchor.left+safeAnchor.right)/2,(safeAnchor.top+safeAnchor.bottom)/2);
assert.equal(actualTarget===trigger,true);actualTarget.click();assert.equal(hoverDialog.open,true);assert.equal(document.body.dataset.photoInfo,'open');
assert.match(imageDirectCss,/body\[data-photo-info="open"\] #imageTools,body\[data-photo-info="open"\] #photoOrderPanel\{visibility:hidden;pointer-events:none\}/,'Expanded details fold controls without moving or resetting them');
let expandedSafe=popupRect();assert.equal(trigger.parentElement.dataset.direction,'up');assert.equal(expandedSafe.top+expandedSafe.height,image('a').rect.top+6,'A bubble anchored above the selected photo does not point to the displaced toolbar-safe summary');assert.ok(expandedSafe.top+expandedSafe.height>safeAnchor.bottom);const bridgeHeight=parseFloat(trigger.parentElement.style.getPropertyValue('--photo-bridge-height'));assert.ok(bridgeHeight>=0);assert.match(imageDirectCss,/\[data-presentation="bubble"\]::before\{[^}]*background:transparent;pointer-events:auto/,'A transparent bridge retains hover while moving from a displaced summary to its photo popup');
assert.ok(expandedSafe.top>=field('editorHeader').rect.bottom+6);
assertInfoReadable();assert.equal(parseFloat(hoverDialog.style.maxHeight),hoverDialog.scrollHeight,'The complete details remain readable after avoiding the collapsed toolbar');
run('refreshDirectPhotoNumbers()');assert.deepEqual({...trigger.parentElement.photoBaseRect},safeAnchor,'Metadata refresh retains the safe basic anchor while controls are folded');
assert.equal(list.scrollTop,67);assert.equal(imageTools.hidden,false);assert.equal(panel.hidden,false);
// Reproduce the reported grouped-photo case: editing tools pushed the summary
// up to the prior photo, while the actual selected photo starts at y327.
const savedPhotoRect={...image('a').rect},savedToolsRect={...imageTools.rect};image('a').rect={left:114,right:262,top:327,bottom:524,width:148,height:197};imageTools.rect={...imageTools.rect,top:203.6,bottom:377.6};run('refreshDirectPhotoNumbers()');
assert.equal(trigger.parentElement.photoBaseRect.top,153.6);assert.equal(trigger.parentElement.dataset.presentation,'bubble');assert.equal(trigger.parentElement.dataset.direction,'down');const actualPhotoPopup=popupRect();assert.equal(actualPhotoPopup.top,333,'The popup follows photo 6 at y327, not its displaced summary at y153');assert.equal(actualPhotoPopup.left+parseFloat(trigger.parentElement.style.getPropertyValue('--photo-tail-left')),188,'The speech tail meets the actual selected photo center');
const bridgeTop=parseFloat(trigger.parentElement.style.getPropertyValue('--photo-bridge-top')),reportedBridgeHeight=parseFloat(trigger.parentElement.style.getPropertyValue('--photo-bridge-height'));assert.equal(actualPhotoPopup.top+bridgeTop,153.6);assert.ok(actualPhotoPopup.top+bridgeTop+reportedBridgeHeight>=actualPhotoPopup.top,'The transparent hover bridge connects the old trigger with its popup');assertInfoReadable();
image('a').rect=savedPhotoRect;imageTools.rect=savedToolsRect;run('refreshDirectPhotoNumbers()');
escapeInfo();assert.equal(hoverDialog.open,false);assert.equal(document.body.dataset.photoInfo,undefined,'Closing restores the same editing controls');assert.equal(imageTools.hidden,false);assert.equal(panel.hidden,false);assert.equal(list.scrollTop,67);
assert.equal(checkpoint(),collisionBody);assert.equal(run('editorUndoStates.length'),collisionHistory);assert.equal(run('selectedMedia.image'),image('a'));assert.equal(body.querySelectorAll('img').length,2);assert.equal(context.window.scrollY,collisionScroll);
console.log(JSON.stringify({suite:'photo-info-tooltip',status:'PASS',behavior:'pixels/bytes hover and keyboard focus, no separate info button/modal/focus theft, trigger and in-flight request reuse, click/touch toggle, Escape/outside/leave cleanup, transparent panel with dark text shadows, upper-right/above-photo summary, desktop/group geometry, enlarged aligned details without duplicate summary or blank space, Delete-button hit avoidance, readable expansion below header, editing controls restored, busy/offscreen and source/history/body preservation'}));

// Mobile always shows one wrapping slash-separated bar for the visible selected
// photo, otherwise the first visible photo. It never opens a dialog or hides the
// editing tools, and its automatic file reads share desktop cache/race guards.
const mobileRequests=[];context.api=(path,options)=>new Promise((resolve,reject)=>mobileRequests.push({path,options,resolve,reject}));
body.innerHTML=photo('a')+photo('b');body.rect={left:12,right:378,top:110,bottom:1500,width:366,height:1390};
field('editorHeader').rect={left:0,right:390,top:0,bottom:102,width:390,height:102};field('editorFooter').hidden=true;
context.window.innerWidth=390;context.window.innerHeight=720;image('a').rect={left:12,right:378,top:140,bottom:640,width:366,height:500};image('b').rect={left:12,right:378,top:650,bottom:1150,width:366,height:500};
run("current={id:'mobile-photo-info'};selectedMedia=null;photoMetadataOwner=current.id;photoMetadataState='ready';photoMetadataByPath=new Map();photoFileDetailsByPath=new Map();photoFilePendingByPath=new Map();resetEditorHistory();refreshDirectPhotoNumbers()");
const mobileBar=field('photoMobileInfo'),mobileBody=checkpoint(),mobileHistory=run('editorUndoStates.length');
assert.equal(mobileBar.hidden,false);assert.equal(mobileBar.parentElement,field('editorHeader'));assert.equal(field('editorHeader').children.at(-1),mobileBar,'Photo information occupies the last header row instead of floating over body text');mobileBar.rect={left:8,right:382,top:102,bottom:222,width:374,height:120};assert.match(mobileBar.textContent,/^사진 1 \/ 1400 × 1050 px \/ 용량 미확인 \/ 파일 형식 미확인/);assert.equal(hoverDialog.open,false);assert.equal(document.body.dataset.photoInfo,undefined);assert.equal(mobileRequests.length,1);assert.equal(JSON.parse(mobileRequests[0].options.body).path,src('a'));
const plainHeaderRect={...field('editorHeader').rect},plainMobilePhoto={...image('a').rect};field('editorHeader').rect={...plainHeaderRect,bottom:222,height:222};image('a').rect={...plainMobilePhoto,bottom:180,height:40};run('refreshDirectPhotoNumbers();refreshDirectPhotoNumbers()');assert.equal(mobileBar.hidden,false,'The added information row does not cause its own visible-photo test to hide it');assert.match(mobileBar.textContent,/^사진 1 \/ /,'Growing the header does not switch away from a photo that intersects the stable menu-row boundary');assert.equal(mobileRequests.length,1,'Passive refresh reuses the in-flight current-photo read');field('editorHeader').rect=plainHeaderRect;image('a').rect=plainMobilePhoto;
const headerPhotoObserver=headerResizeObservers.find(observer=>observer.targets.includes(field('editorHeader')));assert.ok(headerPhotoObserver,'Header height changes schedule photo overlay repositioning');
run('refreshDirectPhotoNumbers()');const resizeFrames=[],originalRequestFrame=context.window.requestAnimationFrame,preHeaderMarker=field('photoNumberOverlay').querySelectorAll('.photo-number-marker').find(marker=>marker.photoImage===image('a')),oldMarkerTop=preHeaderMarker.style.top;context.window.requestAnimationFrame=callback=>{resizeFrames.push(callback);return 900+resizeFrames.length};image('a').rect={...plainMobilePhoto,top:260,bottom:760};field('editorHeader').rect={...plainHeaderRect,bottom:222,height:222};run('photoNumberFrame=null');headerPhotoObserver.callback();headerPhotoObserver.callback();assert.equal(resizeFrames.length,1,'Consecutive header resize events coalesce into one layout frame');assert.equal(preHeaderMarker.style.top,oldMarkerTop);resizeFrames.shift()();assert.equal(preHeaderMarker.style.top,'266px','The number follows the photo moved by header-height spacing without a scroll event');assert.equal(checkpoint(),mobileBody);assert.equal(run('editorUndoStates.length'),mobileHistory);context.window.requestAnimationFrame=originalRequestFrame;image('a').rect=plainMobilePhoto;field('editorHeader').rect=plainHeaderRect;run('refreshDirectPhotoNumbers()');
context.selected=image('b');run('selectMedia(selected);refreshDirectPhotoNumbers()');assert.match(mobileBar.textContent,/^사진 2 \/ /);assert.equal(mobileRequests.length,2);assert.equal(JSON.parse(mobileRequests[1].options.body).path,src('b'));
mobileRequests[0].resolve({info:{format:'JPEG',bytes:9876,width:1400,height:1050,colorSpace:'Display P3',profileName:'Display P3',hdr:'metadata-present',metadataComplete:true}});await tick();run('refreshDirectPhotoNumbers()');assert.match(mobileBar.textContent,/^사진 2 \/ /);assert.equal(mobileBar.textContent.includes('Display P3'),false,'A late response for the formerly visible photo cannot replace the current bar');
const longProfile='sRGB EOTF with DCI-P3 Color Gamut '+('long profile '.repeat(12));
mobileRequests[1].resolve({info:{format:'PNG',bytes:3333,width:1920,height:1080,colorSpace:'sRGB',profileName:longProfile,hdr:'not-indicated',metadataComplete:true}});await tick();run('refreshDirectPhotoNumbers()');
assert.match(mobileBar.textContent,/^사진 2 \/ 1920 × 1080 px \/ 3.33 KB \/ PNG \/ sRGB \/ 색상 프로필:/);assert.ok(mobileBar.textContent.includes(longProfile));assert.ok(mobileBar.textContent.includes('HDR 표시 없음 (SDR 여부 미확인)'));assert.equal(mobileBar.textContent.includes('3,333 바이트'),false,'Mobile does not repeat the same size in bytes');assert.equal(hoverDialog.open,false);assert.equal(document.body.dataset.photoInfo,undefined);assert.equal(imageTools.hidden,false,'Always-visible mobile information leaves the editing tools available');
image('b').rect={...image('b').rect,top:800,bottom:1300};run('refreshDirectPhotoNumbers()');assert.match(mobileBar.textContent,/^사진 1 \/ /);assert.ok(mobileBar.textContent.includes('HDR 메타데이터 있음 (실제 지원 미확인)'),'An offscreen selection falls back to the visible photo with conservative HDR wording');assert.equal(mobileRequests.length,2,'Returning to a photo uses its file-detail cache');
image('a').rect={...image('a').rect,top:-600,bottom:-100};run('refreshDirectPhotoNumbers()');assert.equal(mobileBar.hidden,true);assert.equal(mobileBar.textContent,'','No visible photo means no stale information remains at the top');
image('a').rect={...image('a').rect,top:140,bottom:640};run('busy=true;refreshDirectPhotoNumbers()');assert.equal(mobileBar.hidden,true);run('busy=false;refreshDirectPhotoNumbers()');assert.equal(mobileBar.hidden,false);
context.window.innerWidth=768;run('refreshDirectPhotoNumbers()');assert.equal(mobileBar.hidden,true);assert.equal(mobileBar.textContent,'');assert.equal(infoTrigger('a').parentElement.dataset.expanded,'false','Crossing back to desktop restores the collapsed summary');assert.equal(checkpoint(),mobileBody);assert.equal(run('editorUndoStates.length'),mobileHistory);

// A failed automatic read stays failed while scrolling. Desktop can explicitly
// retry it, and a successful retry must clear the former mobile failure text.
context.window.innerWidth=390;run("current={id:'mobile-failure'};selectedMedia=null;photoMetadataOwner=current.id;photoFileDetailsByPath=new Map();photoFilePendingByPath=new Map();refreshDirectPhotoNumbers()");const failedMobile=mobileRequests.at(-1);failedMobile.reject(new Error('metadata unavailable'));await tick();run('refreshDirectPhotoNumbers()');assert.ok(mobileBar.textContent.includes('추가 파일 정보 불러오기 실패'));const failedMobileCount=mobileRequests.length;run('refreshDirectPhotoNumbers();refreshDirectPhotoNumbers()');assert.equal(mobileRequests.length,failedMobileCount,'A failure does not create a scroll-driven retry loop');
context.window.innerWidth=1000;context.infoImage=image('a');run('refreshDirectPhotoNumbers()');const retryDesktop=run('openDirectPhotoInfo(infoImage,null)');assert.equal(mobileRequests.length,failedMobileCount+1);mobileRequests.at(-1).resolve({info:{format:'JPEG',bytes:9876,width:1400,height:1050,colorSpace:'Display P3',profileName:'Display P3',hdr:'metadata-present',metadataComplete:true}});await retryDesktop;assert.equal(hoverDialog.open,true);
context.window.innerWidth=390;run('refreshDirectPhotoNumbers()');assert.equal(hoverDialog.open,false);assert.equal(document.body.dataset.photoInfo,undefined);assert.ok(mobileBar.textContent.includes('Display P3'));assert.equal(mobileBar.textContent.includes('실패'),false,'Successful desktop retry clears the mobile failure marker');

// An outstanding old-post response must neither populate the new post cache nor
// replace its bar. Resizing to desktop during the new read shares that request.
run("current={id:'mobile-old-post'};photoMetadataOwner=current.id;photoFileDetailsByPath=new Map();photoFilePendingByPath=new Map();refreshDirectPhotoNumbers()");const oldMobile=mobileRequests.at(-1);
run("current={id:'mobile-new-post'};photoMetadataOwner=current.id;photoFileDetailsByPath=new Map();photoFilePendingByPath=new Map();refreshDirectPhotoNumbers()");const newMobile=mobileRequests.at(-1);oldMobile.resolve({info:{format:'JPEG',bytes:1,width:1,height:1,colorSpace:'Rec.2020',profileName:'obsolete',hdr:'metadata-present',metadataComplete:true}});await tick();run('refreshDirectPhotoNumbers()');assert.equal(mobileBar.textContent.includes('Rec.2020'),false);assert.equal(run('photoFileDetailsByPath.size'),0);
const newMobileCount=mobileRequests.length;context.window.innerWidth=1000;run('refreshDirectPhotoNumbers()');const sharedDesktop=run('openDirectPhotoInfo(infoImage,null)');assert.equal(mobileRequests.length,newMobileCount,'Mobile and desktop share a pending metadata read');newMobile.resolve({info:{format:'JPEG',bytes:1000,width:1400,height:1050,colorSpace:'sRGB',profileName:null,hdr:'unknown',metadataComplete:false}});await sharedDesktop;assert.ok(detailsText().includes('sRGB'));
context.window.innerWidth=390;run('refreshDirectPhotoNumbers()');assert.equal(hoverDialog.open,false);assert.equal(mobileBar.hidden,false);assert.ok(mobileBar.textContent.includes('색상 프로필: 미확인'));assert.ok(mobileBar.textContent.includes('HDR 정보 확인 불가'));assert.ok(mobileBar.textContent.includes('일부 파일 정보 미확인'));assert.equal(checkpoint(),mobileBody);assert.equal(run('editorUndoStates.length'),mobileHistory);
assert.match(imageDirectCss,/\.photo-info-panel\[data-expanded="true"\] \.photo-file-info\{[^}]*position:absolute[^}]*opacity:0;pointer-events:none/,'Expanded desktop hides duplicate summary without removing its keyboard focus node');assert.match(imageDirectCss,/\.photo-info-dialog dd\{[^}]*text-align:right;overflow-wrap:anywhere/);assert.match(imageDirectCss,/\.photo-info-row\{[^}]*justify-content:flex-end;gap:10px/,'Each label stays close to its value and the whole row meets the right edge');assert.match(imageDirectCss,/\.photo-info-heading\{[^}]*justify-content:flex-end/);assert.match(imageDirectCss,/\.photo-info-panel\[data-expanded="true"\]\[data-presentation="bubble"\]\{overflow:visible;text-shadow:none\}/);assert.match(imageDirectCss,/\[data-presentation="bubble"\] \.photo-info-dialog\{background:rgb\(20 27 38 \/ 94%\)/);assert.match(imageDirectCss,/\[data-presentation="bubble"\] \.photo-info-row\{display:grid;grid-template-columns:80px minmax\(0,1fr\)/);assert.match(imageDirectCss,/clip-path:polygon\(50% 0,0 100%,100% 100%\)/);assert.match(imageDirectCss,/\.photo-mobile-info\{position:static;flex:0 0 100%;width:100%[^}]*pointer-events:none[^}]*font:13px\/1.5 system-ui[^}]*overflow-wrap:anywhere/);assert.match(adminHtml('synthetic@example.test'),/main\{padding:calc\(var\(--editor-header-height\)/,'Existing header-height spacing moves the body below the normal-flow information row');
console.log(JSON.stringify({suite:'photo-mobile-file-info',status:'PASS',behavior:'single always-visible slash bar, visible selection/scroll switching and no-photo cleanup, desktop return and dialog cleanup, shared cache/in-flight read, failed-read retry suppression and successful retry cleanup, stale post/photo guards, HDR/unknown wording, long profiles, unchanged body/history and available editing tools'}));
